import type {Point} from '@/hooks/useMowerMap';
import type {MowPlan, PlanChecks, PlanChosen} from './mowPlan';
import type {PlanPath} from './planProgress';
import {RPC} from './openmower';
import {callRpc, rpcMethods} from './rpc';

// The real plan for an area, once the mower offers it (RPC.areaPlan). Read like the planner answers
// inside ROS: paths, each an outline pass or a run of stripes, as poses or plain points.
interface PlannerPath {
  is_outline?: boolean | number;
  outline?: boolean;
  points?: ([number, number] | Point)[];
  pose_index?: number[];
  path?: {poses?: {pose: {position: Point}}[]};
}

const points = (p: PlannerPath): Point[] =>
  p.points?.map((q) => (Array.isArray(q) ? {x: q[0], y: q[1]} : {x: q.x, y: q.y})) ??
  p.path?.poses?.map((q) => ({x: q.pose.position.x, y: q.pose.position.y})) ??
  [];

export function readPaths(answer: {paths?: PlannerPath[]} | PlannerPath[]): PlanPath[] {
  const paths = Array.isArray(answer) ? answer : (answer.paths ?? []);
  return paths.map((p) => {
    const pts = points(p);
    // the points come simplified, only pose_index says which pose of the full path each one is
    const index = p.pose_index?.length === pts.length ? p.pose_index : p.path?.poses ? pts.map((_, i) => i) : undefined;
    return {outline: !!(p.is_outline || p.outline), points: pts, index};
  });
}

type PlanAnswer = {
  paths?: PlannerPath[];
  angle?: number;
  stats?: {chosen?: PlanChosen; body_fit?: unknown; headland_turns?: unknown};
  warnings?: unknown;
  body_space?: unknown;
};

const xy = (v: unknown): Point | null => (Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number' ? {x: v[0], y: v[1]} : null);
const xys = (v: unknown): Point[] => (Array.isArray(v) ? v.map(xy).filter((p): p is Point => !!p) : []);
// the planner's own lines for what stats.body_fit counts, shown from the counts
const COUNTED = [/^\d+ places? driven another way where the body would stick out/, /^\d+ places? left out where the body doesn't fit/];

// what the collision mode found (stats.body_fit, stats.headland_turns, warnings, body_space), nothing from a planner
// without it
export function readChecks(answer: PlanAnswer): PlanChecks | undefined {
  const fit = (answer.stats?.body_fit ?? null) as {places?: unknown; fixed?: unknown; left?: unknown; skipped_m?: unknown} | null;
  const head = (answer.stats?.headland_turns ?? null) as {places?: unknown} | null;
  const space = (answer.body_space ?? null) as {outlines?: unknown; holes?: unknown} | null;
  const warnings = (Array.isArray(answer.warnings) ? answer.warnings : []).filter(
    (w): w is string => typeof w === 'string' && !(fit && COUNTED.some((r) => r.test(w))),
  );
  if (!fit && !head && !space && !warnings.length) return undefined;
  const places = (Array.isArray(fit?.places) ? fit.places : []).flatMap((p: unknown) => {
    const at = xy(p);
    return at ? [{...at, m: typeof (p as number[])[2] === 'number' ? (p as number[])[2] : 0}] : [];
  });
  const rings = [space?.outlines, space?.holes].flatMap((list) => (Array.isArray(list) ? list.map(xys) : [])).filter((r) => r.length >= 3);
  return {
    ...(rings.length ? {space: rings} : {}),
    places,
    fixed: typeof fit?.fixed === 'number' ? fit.fixed : places.length,
    left: typeof fit?.left === 'number' ? fit.left : 0,
    skipped: typeof fit?.skipped_m === 'number' ? fit.skipped_m : 0,
    turns: xys(head?.places),
    warnings,
  };
}

export function readPlan(answer: PlanAnswer | PlannerPath[]): MowPlan {
  const loops: Point[][] = [];
  const stripes: [Point, Point][] = [];
  for (const p of readPaths(answer)) {
    if (p.outline) loops.push(p.points);
    else for (let i = 1; i < p.points.length; i++) stripes.push([p.points[i - 1], p.points[i]]);
  }
  const chosen = Array.isArray(answer) ? undefined : answer.stats?.chosen;
  const checks = Array.isArray(answer) ? undefined : readChecks(answer);
  return {loops, stripes, angle: Array.isArray(answer) ? undefined : answer.angle, open: true, ...(chosen ? {chosen} : {}), ...(checks ? {checks} : {})};
}

// what mowing.plan takes: a saved area by id, or an area as it is right now in the editor (map.json format,
// missing settings fall back to the mower's global ones)
// what's set on the area as it is in the editor, in place of the saved one
interface PlanProps {
  angle?: number;
  outline_count?: number;
  outline_overlap_count?: number;
  outline_offset?: number;
  angle_min?: number;
  angle_max?: number;
  // the area's MowBite Planner settings as edited (its planner property)
  settings?: Record<string, unknown>;
}
export type PlanRequest = ({area_id: string} & PlanProps) | ({outline: Point[]; obstacles: Point[][]} & PlanProps);

// null when this mower can't tell, then the editor works it out itself (lib/mowPlan). With the MowBite Planner on the
// mower it plans the area directly (planner.plan, the same settings mower_logic's plans get): it takes the area's
// planner settings as edited and says what it planned with (the lane spacing it picked). mowing.plan only knows
// OpenMower's area settings
export async function mowerPlan(req: PlanRequest, viaPlanner = false): Promise<MowPlan | null> {
  const known = await rpcMethods();
  if ((viaPlanner || req.settings) && known?.has(RPC.plannerPlan)) {
    // with the body checked a plan takes the mower 10 to 20 s, more for a whole new one
    return readPlan(await callRpc(RPC.plannerPlan, req, 90000));
  }
  if (!known?.has(RPC.areaPlan)) return null;
  // mowing.plan doesn't take planner settings
  const plain = Object.fromEntries(Object.entries(req).filter(([k]) => k !== 'settings'));
  return readPlan(await callRpc(RPC.areaPlan, plain, 20000));
}

// the plan in the order it's driven, for showing the progress of a run
export async function mowerPaths(areaId: string): Promise<PlanPath[] | null> {
  if (!(await rpcMethods())?.has(RPC.areaPlan)) return null;
  return readPaths(await callRpc(RPC.areaPlan, {area_id: areaId}, 20000));
}
