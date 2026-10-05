import * as ClipperLib from 'clipper-lib';
import type {MapArea} from '@/hooks/useMowerMap';
import {useEffect, useMemo, useSyncExternalStore} from 'react';
import type {PlanRequest} from './areaPlan';
import {RPC} from './openmower';
import {callRpc, isMissingMethod, rpcMethods} from './rpc';
import {settingsStore, type Settings} from './settings';

// The mower's body and blade as the MowBite Planner on the mower knows them (planner.settings): a rectangle around
// the point the path is for (OpenMower's base_link, the middle between the rear drive wheels), robot_front ahead of
// it, robot_rear behind, robot_width wide, and the blade (mower_width across) blade_ahead ahead and blade_offset to
// the left. All in meters. Without the MowBite Planner (or sizes there) the ones set under Mower sizes in the settings.

export interface MowerBody {
  width: number;
  front: number;
  rear: number;
  blade: number;
  bladeAhead: number;
  bladeOffset: number;
}

export interface PlannerSetting {
  value: unknown;
  default: unknown;
  stored: boolean;
  type: string;
  unit?: string;
  min?: number;
  max?: number;
  choices?: string[];
  settable: boolean;
  // where its value comes from while it isn't set for the planner (a mower_logic parameter)
  from?: string;
  nullable?: boolean;
  // the value for "the planner works it out" (perimeter_passes -1)
  auto_value?: number;
}

export interface PlannerSettings {
  settings: Record<string, PlannerSetting>;
  own_angle?: boolean;
  file?: string | null;
  // OpenMower's controller backs up where the plan does (its back_up_with_plan): only then allow_reverse counts
  can_back_up?: boolean;
  // the angle turned further after finished mows: steps so far (each angle_increment, an area's own or the one for
  // all), finished mows since the last step, and the steps with the one for all areas (rad)
  angle_steps?: number;
  angle_mows?: number;
  angle_turned?: number;
}

// the settings the app shows as the mower's sizes, in this order
export const BODY_SETTINGS = [
  'robot_width',
  'robot_front',
  'robot_rear',
  'mower_width',
  'blade_ahead',
  'blade_offset',
  'body_tolerance',
  'min_turn_radius',
] as const;
export type BodySetting = (typeof BODY_SETTINGS)[number];

// undefined: not asked yet, null: no MowBite Planner on this mower
let current: PlannerSettings | null | undefined;
let asking: Promise<PlannerSettings | null> | null = null;
const listeners = new Set<() => void>();

function set(s: PlannerSettings | null) {
  current = s;
  listeners.forEach((l) => l());
}

export function plannerSettings(): PlannerSettings | null | undefined {
  return current;
}

// asked once per page load, again with force (the settings page). A mower without the MowBite Planner doesn't have
// the method, that's null; no answer leaves it unknown so it's asked again next time
export function loadPlannerSettings(force = false): Promise<PlannerSettings | null> {
  if (!force && current !== undefined) return Promise.resolve(current);
  if (!force && asking) return asking;
  asking = callRpc<PlannerSettings>(RPC.plannerSettings, {}, 10000).then(
    (s) => {
      asking = null;
      set(s && typeof s === 'object' && s.settings ? s : null);
      return current ?? null;
    },
    (e) => {
      asking = null;
      if (isMissingMethod(e)) set(null);
      throw e;
    },
  );
  return asking;
}

// changes some settings (null: back to the default), the planner checks them as a whole and answers like
// planner.settings
export async function savePlannerSettings(values: Record<string, unknown>): Promise<PlannerSettings> {
  const s = await callRpc<PlannerSettings>(RPC.plannerSettingsSet, values, 15000);
  set(s);
  return s;
}

// the angle turned further back to 0 (planner.angle.reset), the next finished mow counts from there
export async function resetPlannerAngle(): Promise<PlannerSettings> {
  const s = await callRpc<PlannerSettings>(RPC.plannerAngleReset, {}, 15000);
  set(s);
  return s;
}

const num = (s: PlannerSettings | null | undefined, key: string) => {
  const v = s?.settings[key]?.value;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

export function bodyFrom(s: PlannerSettings | null | undefined): MowerBody | null {
  const width = num(s, 'robot_width');
  const front = num(s, 'robot_front');
  const rear = num(s, 'robot_rear');
  if (width === null || front === null || rear === null || width <= 0 || front + rear <= 0) return null;
  return {
    width,
    front,
    rear,
    blade: num(s, 'mower_width') ?? 0,
    bladeAhead: num(s, 'blade_ahead') ?? 0,
    bladeOffset: num(s, 'blade_offset') ?? 0,
  };
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

// the mower's body for drawing it, null until known (or when there's none)
export function useMowerBody(): MowerBody | null {
  const s = useSyncExternalStore(subscribe, plannerSettings, () => undefined);
  const app = useSyncExternalStore(settingsStore.subscribe, settingsStore.snapshot, settingsStore.serverSnapshot);
  useEffect(() => {
    if (current === undefined) loadPlannerSettings().catch(() => {});
  }, []);
  return useMemo(() => bodyFrom(s) ?? sizesBody(app.mower), [s, app.mower]);
}

export function usePlannerSettings(): PlannerSettings | null | undefined {
  return useSyncExternalStore(subscribe, plannerSettings, () => undefined);
}

// where the planner found the body sticking out beyond what the map allows, with what the mower does there
export interface BodySpot {
  x: number;
  y: number;
  yaw: number;
  kind: string; // turn, spin, lane_end, loop, transit
}

export interface BodyCheck {
  spots: BodySpot[];
  hard: string[];
  soft: string[];
}

// the places of the spots: the planner reports every pose of the path where the body sticks out (10 cm apart, a turn on
// the spot dozens of times), what's within a mower's length of a place is that place. Each with the pose in the middle
// of its spots, for drawing one body there, and what happens there
const PLACE = 0.75; // m
export function spotPlaces(spots: BodySpot[]): {spot: BodySpot; kinds: string[]}[] {
  const places: {x: number; y: number; spots: BodySpot[]}[] = [];
  for (const s of spots) {
    const near = places.find((p) => Math.hypot(p.x - s.x, p.y - s.y) <= PLACE);
    if (near) near.spots.push(s);
    else places.push({x: s.x, y: s.y, spots: [s]});
  }
  return places.map((p) => ({spot: p.spots[p.spots.length >> 1], kinds: [...new Set(p.spots.map((s) => s.kind))]}));
}

// the plan of an area checked against the mower's body (planner.plan with report). null when the mower has no
// MowBite Planner. A planner that doesn't check the body yet gives no spots
export async function checkBody(req: PlanRequest): Promise<BodyCheck | null> {
  const known = await rpcMethods();
  if (known && !known.has(RPC.plannerPlan)) return null;
  const answer = await callRpc<{report?: {body_out?: unknown; hard?: unknown; soft?: unknown}}>(
    RPC.plannerPlan,
    {...req, report: true},
    90000,
  );
  const r = answer?.report ?? {};
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []);
  const spots = (Array.isArray(r.body_out) ? r.body_out : []).flatMap((s: Partial<BodySpot>) =>
    typeof s?.x === 'number' && typeof s.y === 'number'
      ? [{x: s.x, y: s.y, yaw: typeof s.yaw === 'number' ? s.yaw : 0, kind: typeof s.kind === 'string' ? s.kind : ''}]
      : [],
  );
  return {spots, hard: list(r.hard), soft: list(r.soft)};
}

// the corners of the body and the blade's centre in the map, for the mower at x, y facing heading (rad, ccw)
export function bodyShape(b: MowerBody, x: number, y: number, heading: number) {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const at = (ahead: number, left: number) => ({x: x + c * ahead - s * left, y: y + s * ahead + c * left});
  return {
    corners: [at(b.front, b.width / 2), at(-b.rear, b.width / 2), at(-b.rear, -b.width / 2), at(b.front, -b.width / 2)],
    blade: at(b.bladeAhead, b.bladeOffset),
    // the middle of the body, where the icon goes
    middle: at((b.front - b.rear) / 2, 0),
    // a little arrow at the front, which way it faces without the icon
    arrow: [at(b.front - 0.1, b.width / 5), at(b.front - 0.04, 0), at(b.front - 0.1, -b.width / 5)],
  };
}

export type MowerSizes = NonNullable<Settings['mower']>;

// the widest blade the app takes, more than any mower running OpenMower cuts
export const MAX_BLADE = 0.4; // m

const metres = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// the sizes set in the app
export function sizesBody(s: MowerSizes | undefined): MowerBody | null {
  const width = metres(s?.width);
  const front = metres(s?.front);
  const rear = metres(s?.rear);
  if (width === null || front === null || rear === null || width <= 0 || front + rear <= 0) return null;
  const blade = metres(s?.blade) ?? 0;
  return {
    width,
    front,
    rear,
    blade: blade > 0 && blade <= MAX_BLADE ? blade : 0,
    bladeAhead: metres(s?.bladeAhead) ?? 0,
    bladeOffset: metres(s?.bladeOffset) ?? 0,
  };
}

// mowers measured on a real one: picking one under Mower sizes fills in the fields
export const MOWER_MODELS: {key: string; label: string; sizes: Required<MowerSizes>}[] = [
  // the same body on all three
  {key: 'yf-nx', label: 'YardForce NX60 / NX80 / NX100', sizes: {width: 0.41, front: 0.43, rear: 0.18, blade: 0.18, bladeAhead: 0.185, bladeOffset: 0}},
];

// the model with these sizes, to the millimetre
export function modelOf(s: MowerSizes | undefined): string | null {
  const b = sizesBody(s);
  if (!b) return null;
  const mm = (v: number) => Math.round(v * 1000);
  const model = MOWER_MODELS.find((m) => {
    const p = sizesBody(m.sizes)!;
    return (Object.keys(p) as (keyof MowerBody)[]).every((k) => mm(p[k]) === mm(b[k]));
  });
  return model?.key ?? null;
}

// seconds for one turn of a drawn blade: 2.5 s at 2400 rpm (the real 40 a second would only blur), in half seconds
// so a wobbling rpm doesn't keep restarting the animation
export function bladeSeconds(rpm: number): number {
  const s = Math.min(10, Math.max(0.8, 6000 / Math.abs(rpm || 1)));
  return Math.max(1, Math.round(s * 2)) / 2;
}

type P = {x: number; y: number};

// shorter steps of the track don't say which way the mower drove
const MIN_STEP = 0.05; // m
// the heading is taken over this much track, gps wobble on short steps would swing the blade about
const SMOOTH = 0.25; // m
// a step turning further than this is a turn on the spot: the blade swings round it, drawn in steps of 15°
const SPIN = Math.PI / 3;
const SWING_STEP = Math.PI / 12;
// a piece of the strip ends where the heading turned this far from where it began
const PIECE_TURN = Math.PI / 4;

const turned = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const towards = (a: P, b: P) => Math.atan2(b.y - a.y, b.x - a.x);

// The strip the blade cut along a stretch of track driven with the blades on: the blade's centre, ahead of and beside
// the point the track follows, with the heading taken from the way it drove (it mows forwards). In pieces, one per
// lane and per bit of a turn, so drawn see-through the strip shows darker where lanes overlap. Each piece begins where
// the one before ended, drawn as a line as wide as the blade they join without overlapping; the round blade's ends are
// only at the start and the end of the stretch (swathEnd).
export function swathPieces(points: readonly P[], b: MowerBody): P[][] {
  const blade = (p: P, h: number) => ({
    x: p.x + Math.cos(h) * b.bladeAhead - Math.sin(h) * b.bladeOffset,
    y: p.y + Math.sin(h) * b.bladeAhead + Math.cos(h) * b.bladeOffset,
  });
  const pieces: P[][] = [];
  let piece: P[] = [];
  let start = 0;
  const add = (p: P, h: number) => {
    if (piece.length > 1 && Math.abs(turned(h, start)) > PIECE_TURN) {
      pieces.push(piece);
      piece = [piece[piece.length - 1]];
    }
    if (piece.length < 2) start = h;
    piece.push(p);
  };
  let heading: number | null = null;
  // the track since the last turn on the spot
  let run: P[] = [];
  let from = points[0];
  for (let i = 1; i < points.length; i++) {
    const to = points[i];
    if (Math.hypot(to.x - from.x, to.y - from.y) < MIN_STEP) continue;
    const step = towards(from, to);
    if (heading === null) {
      add(blade(from, step), step);
      run = [from];
    } else if (Math.abs(turned(step, heading)) > SPIN) {
      const d = turned(step, heading);
      const steps = Math.ceil(Math.abs(d) / SWING_STEP);
      for (let s = 1; s <= steps; s++) add(blade(from, heading + (d * s) / steps), heading + (d * s) / steps);
      run = [from];
    }
    run.push(to);
    let back = run.length - 2;
    while (back > 0 && Math.hypot(to.x - run[back].x, to.y - run[back].y) < SMOOTH) back--;
    heading = towards(run[back], to);
    add(blade(to, heading), heading);
    from = to;
  }
  if (piece.length > 1) pieces.push(piece);
  return pieces;
}

// the half of the blade's circle beyond the end of a piece (at points[1], coming from points[0]): where it started or
// stopped mowing the strip is round. In whatever coordinates the points are, r in them as well
export function swathEnd(from: P, end: P, r: number): P[] {
  const len = Math.hypot(end.x - from.x, end.y - from.y) || 1;
  const d = {x: (end.x - from.x) / len, y: (end.y - from.y) / len};
  const steps = 8;
  return Array.from({length: steps + 1}, (_, i) => {
    const a = -Math.PI / 2 + (Math.PI * i) / steps;
    // turned from d by a: the left side, ahead, the right side
    return {x: end.x + r * (d.x * Math.cos(a) - d.y * Math.sin(a)), y: end.y + r * (d.x * Math.sin(a) + d.y * Math.cos(a))};
  });
}

// clipper works in integers, this is 0.01 mm
const SCALE = 1e5;
const toPath = (o: P[]) => o.map((p) => ({X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE)}));
const fromPath = (p: ClipperLib.Path): P[] => p.map((q) => ({x: q.X / SCALE, y: q.Y / SCALE}));

function grow(paths: ClipperLib.Paths, delta: number): P[][] {
  const co = new ClipperLib.ClipperOffset(2, 0.002 * SCALE);
  co.AddPaths(paths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const out: ClipperLib.Paths = [];
  co.Execute(out, delta * SCALE);
  return out.map(fromPath);
}

// Where the edges really are: the outlines were recorded with the middle of the mower driving along them, the body
// reached half its width further. So the mowing areas together grown by that, and obstacles shrunk by it (one the
// mower drove round smaller than that leaves nothing)
export function realEdges(areas: readonly MapArea[], width: number): {lawn: P[][]; obstacles: P[][]} {
  const mow = areas.filter((a) => a.properties.type === 'mow' && a.outline.length >= 3);
  const c = new ClipperLib.Clipper();
  c.AddPaths(mow.map((a) => toPath(a.outline)), ClipperLib.PolyType.ptSubject, true);
  const lawn: ClipperLib.Paths = [];
  c.Execute(ClipperLib.ClipType.ctUnion, lawn, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return {
    lawn: grow(lawn, width / 2),
    obstacles: areas
      .filter((a) => a.properties.type === 'obstacle' && a.outline.length >= 3)
      .flatMap((a) => grow([toPath(a.outline)], -width / 2)),
  };
}
