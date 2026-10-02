import * as ClipperLib from 'clipper-lib';
import type {Point} from '@/hooks/useMowerMap';
import {angleInRange} from './mowStripes';
import type {MowPlan} from './mowPlan';

// What the MowBite Planner (OM_PLANNER=mowbite) does with an area, worked out here so the editor can show it at
// once while the angle moves, before the mower's own plan is back. Like planner.py: the area minus the obstacles,
// outline passes at perimeter_offset and then a lane spacing further in each (rounded where they bend), the lanes
// in what's left inside the passes the lanes don't reach under, the first and the last row on its edge and the
// rows between spread evenly (never further apart than the lane spacing). Crosshatch adds lanes across, rings fills
// with passes further and further in. The direction: the one mower_logic asks for, or worked out like the planner
// does (longest edge, narrowest width, fewest lanes). Not here: turns, the order, lanes carried on through the
// headland, the strips too narrow for lanes, the body check.

export interface PlannerEstimateInput {
  outline: Point[];
  holes: Point[][];
  spacing: number; // m, lane spacing (OpenMower's tool_width)
  bladeWidth: number; // m, mower_width
  perimeterOffset: number; // m, first pass inside the outline
  passes: number; // outline passes
  overlapPasses: number; // lanes reach this many passes further out
  // rad: the direction mower_logic asks for, null: worked out by strategy
  angle: number | null;
  strategy: string; // longest_edge, min_width, optimal
  angleOffset: number; // rad, the planner's own, on top
  angleMin?: number;
  angleMax?: number;
  angleStep: number; // rad, between the directions optimal tries
  fillPattern: string; // lanes, crosshatch, concentric
  crosshatchAngle: number; // rad
  minLaneLength: number; // m
}

export interface PlannerEstimate extends MowPlan {
  angle: number; // rad, 0..pi, the direction of the (first) lanes
}

// clipper works in integers, this is 0.01 mm
const SCALE = 1e5;
type Paths = ClipperLib.Paths;
const EDGE_MARGIN = 1e-4;
// m, how far a rounded corner may be off a true arc (shapely uses 9 segments a quarter circle)
const ARC_TOLERANCE = 0.002;
// the planner simplifies an outline this much to find its longest edge
const ANGLE_SIMPLIFY = 0.1;

const toPath = (o: Point[]) => o.map((p) => ({X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE)}));
const fromPath = (p: ClipperLib.Path): Point[] => p.map((q) => ({x: q.X / SCALE, y: q.Y / SCALE}));

// shrunk by d (grown if negative), round where it bends around inside corners, like the planner's inset()
function inset(paths: Paths, d: number): Paths {
  if (d === 0) return paths;
  const co = new ClipperLib.ClipperOffset(2, ARC_TOLERANCE * SCALE);
  co.AddPaths(paths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const out: Paths = [];
  co.Execute(out, -d * SCALE);
  return out;
}

const area = (p: ClipperLib.Path) => ClipperLib.Clipper.Area(p) / (SCALE * SCALE);

// the area minus the obstacles, without slivers smaller than the blade
function freeSpace(outline: Point[], holes: Point[][], half: number): Paths {
  const c = new ClipperLib.Clipper();
  c.AddPaths([toPath(outline)], ClipperLib.PolyType.ptSubject, true);
  c.AddPaths(holes.filter((h) => h.length > 2).map(toPath), ClipperLib.PolyType.ptClip, true);
  const tree = new ClipperLib.PolyTree();
  c.Execute(ClipperLib.ClipType.ctDifference, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  const out: Paths = [];
  // a part smaller than half x half goes, with its holes
  const walk = (node: ClipperLib.PolyNode) => {
    for (const child of node.Childs()) {
      if (!child.IsHole() && area(child.Contour()) >= half * half) {
        out.push(child.Contour());
        for (const hole of child.Childs()) {
          out.push(hole.Contour());
          walk(hole);
        }
      }
    }
  };
  walk(tree);
  return out;
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// douglas-peucker of a line (shapely's simplify without keeping the topology)
function simplifyLine(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points;
  let max = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = distToSegment(points[i], points[0], points[points.length - 1]);
    if (d > max) {
      max = d;
      index = i;
    }
  }
  if (max <= tolerance) return [points[0], points[points.length - 1]];
  return [...simplifyLine(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplifyLine(points.slice(index), tolerance)];
}

function longestEdgeDirection(coords: Point[]): number {
  let best = -1;
  let angle = 0;
  for (let i = 0; i + 1 < coords.length; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (l > best) {
      best = l;
      angle = Math.atan2(b.y - a.y, b.x - a.x);
    }
  }
  return angle;
}

// the direction of the longest edge of the outline (simplified first, a recorded one has a dent every few cm)
export function longestEdgeAngle(outline: Point[]): number {
  if (outline.length < 2) return 0;
  const ring = [...outline, outline[0]];
  const simple = simplifyLine(ring, ANGLE_SIMPLIFY);
  return longestEdgeDirection(simple.length >= 4 ? simple : ring);
}

function convexHull(points: Point[]): Point[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

// the direction of the long side of the smallest rectangle around the points: the fewest lanes on a convex shape
export function minWidthAngle(points: Point[]): number {
  const hull = convexHull(points);
  if (hull.length < 3) return longestEdgeDirection(points);
  let best = Infinity;
  let angle = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const e = Math.atan2(b.y - a.y, b.x - a.x);
    const c = Math.cos(e);
    const s = Math.sin(e);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of hull) {
      const x = p.x * c + p.y * s;
      const y = -p.x * s + p.y * c;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const areaRect = (maxX - minX) * (maxY - minY);
    if (areaRect < best - 1e-12) {
      best = areaRect;
      // the long side of that rectangle
      angle = maxX - minX >= maxY - minY ? e : e + Math.PI / 2;
    }
  }
  return angle;
}

type Lane = {x0: number; x1: number; y: number; row: number};

// the pieces of the rows at the angle inside the rings (even-odd), the first and the last row on the edge, the ones
// between spread evenly at most spacing apart, like the planner's scan_lanes (without carrying lanes on)
export function scanLanes(rings: Point[][], angle: number, spacing: number, minLength: number): Lane[][] {
  if (!rings.length || spacing <= 0) return [];
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const local = rings.map((r) => r.map((p) => ({x: p.x * c + p.y * s, y: -p.x * s + p.y * c})));
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of local) {
    for (const p of r) {
      lo = Math.min(lo, p.y);
      hi = Math.max(hi, p.y);
    }
  }
  if (!Number.isFinite(lo)) return [];
  const usable = hi - lo - 2 * EDGE_MARGIN;
  let count: number, step: number, y0: number;
  if (usable <= 0) [count, step, y0] = [1, spacing, (lo + hi) / 2];
  else {
    count = Math.ceil(usable / spacing - 1e-9) + 1;
    if (count > 20000) return [];
    step = usable / (count - 1);
    y0 = lo + EDGE_MARGIN;
  }
  const rows: Lane[][] = [];
  for (let j = 0; j < count; j++) {
    const y = y0 + j * step;
    const xs: number[] = [];
    for (const r of local) {
      for (let i = 0; i < r.length; i++) {
        const a = r[i];
        const b = r[(i + 1) % r.length];
        if (a.y <= y !== b.y <= y) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
    }
    xs.sort((p, q) => p - q);
    const row: Lane[] = [];
    for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] >= minLength) row.push({x0: xs[i], x1: xs[i + 1], y, row: j});
    rows.push(row);
  }
  return rows;
}

// how many cells (groups of lanes mowed in one zigzag) the rows split into, like the planner's split_cells
function countCells(rows: Lane[][]): number {
  let cells = 0;
  let prev: Lane[] = [];
  let open = new Map<number, boolean>();
  for (const lanes of rows) {
    const succ = prev.map(() => [] as number[]);
    const pred = lanes.map(() => [] as number[]);
    prev.forEach((p, i) =>
      lanes.forEach((q, k) => {
        if (p.x0 < q.x1 && q.x0 < p.x1) {
          succ[i].push(k);
          pred[k].push(i);
        }
      }),
    );
    const now = new Map<number, boolean>();
    lanes.forEach((_, k) => {
      const ps = pred[k];
      if (!(ps.length === 1 && succ[ps[0]].length === 1 && open.get(ps[0]))) cells++;
      now.set(k, true);
    });
    open = now;
    prev = lanes;
  }
  return cells;
}

function optimalAngle(rings: Point[][], input: PlannerEstimateInput, fallback: number): number {
  const candidates = new Set<number>([+((((fallback % Math.PI) + Math.PI) % Math.PI).toFixed(9))]);
  const n = Math.max(1, Math.round(Math.PI / input.angleStep));
  for (let i = 0; i < n; i++) candidates.add(+((i * Math.PI) / n).toFixed(9));
  let list = [...candidates];
  if (input.angleMin !== undefined && input.angleMax !== undefined) list = list.map((a) => angleInRange(a, input.angleMin, input.angleMax));
  list.sort((a, b) => a - b);
  const diff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  let best: {cost: number; d: number; a: number} | null = null;
  for (const a of list) {
    const rows = scanLanes(rings, a, input.spacing, input.minLaneLength);
    const cost = rows.reduce((s, r) => s + r.length, 0) + 3 * countCells(rows);
    const d = diff(2 * a, 2 * fallback);
    if (!best || cost < best.cost || (cost === best.cost && d < best.d)) best = {cost, d, a};
  }
  return best ? best.a : fallback;
}

const ringsOf = (paths: Paths) => paths.map(fromPath).filter((r) => r.length >= 3);

export function plannerEstimate(input: PlannerEstimateInput): PlannerEstimate | null {
  if (input.outline.length < 3 || input.spacing <= 0) return null;
  const width = Math.max(input.bladeWidth, input.spacing);
  const half = width / 2;
  const free = freeSpace(input.outline, input.holes, half);
  if (!free.length) return null;
  const first = input.perimeterOffset;
  const concentric = input.fillPattern === 'concentric';
  const count = Math.max(0, Math.round(input.passes));
  // rings meet at the corners, at a right angle the blade only covers up to width / sqrt 2 there
  const loopSpacing = concentric ? Math.min(input.spacing, width / Math.SQRT2) : input.spacing;

  const loops: Point[][] = [];
  for (let k = 0; concentric || k < count; k++) {
    const level = inset(free, first + k * loopSpacing);
    if (!level.length || k > 20000) break;
    // closed, the map draws them as rings
    loops.push(...ringsOf(level).map((r) => [...r, r[0]]));
  }

  const lanePasses = Math.max(0, count - Math.max(0, Math.round(input.overlapPasses)));
  const region = concentric ? [] : ringsOf(inset(free, first + lanePasses * input.spacing));
  const freeRings = ringsOf(free);
  let angle: number;
  if (input.angle !== null) angle = input.angle;
  else if (input.strategy === 'min_width') angle = minWidthAngle(freeRings.flat());
  else if (input.strategy === 'optimal' && region.length) angle = optimalAngle(region, input, longestEdgeAngle(input.outline));
  else angle = longestEdgeAngle(input.outline);
  angle = angleInRange(angle + input.angleOffset, input.angleMin, input.angleMax);
  angle = ((angle % Math.PI) + Math.PI) % Math.PI;

  const stripes: [Point, Point][] = [];
  const angles = [angle];
  if (input.fillPattern === 'crosshatch') {
    const second = (angle + input.crosshatchAngle) % Math.PI;
    angles.push(second < 0 ? second + Math.PI : second);
  }
  for (const a of angles) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const toMap = (x: number, y: number): Point => ({x: x * c - y * s, y: x * s + y * c});
    for (const row of scanLanes(region, a, input.spacing, input.minLaneLength)) {
      for (const lane of row) stripes.push([toMap(lane.x0, lane.y), toMap(lane.x1, lane.y)]);
    }
  }
  return {loops, stripes, angle};
}
