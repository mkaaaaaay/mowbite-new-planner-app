import {useEffect, useSyncExternalStore} from 'react';
import type {PlanRequest} from './areaPlan';
import {RPC} from './openmower';
import {callRpc, isMissingMethod, rpcMethods} from './rpc';

// The mower's body and blade as the MowBite Planner on the mower knows them (planner.settings): a rectangle around
// the point the path is for (OpenMower's base_link, the middle between the rear drive wheels), robot_front ahead of
// it, robot_rear behind, robot_width wide, and the blade (mower_width across) blade_ahead ahead and blade_offset to
// the left. All in meters. Nothing when the mower plans with slic3r or the sizes aren't set.

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
  useEffect(() => {
    if (current === undefined) loadPlannerSettings().catch(() => {});
  }, []);
  return bodyFrom(s);
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
  };
}
