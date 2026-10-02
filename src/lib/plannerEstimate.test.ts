import {describe, expect, it} from 'vitest';
import {longestEdgeAngle, minWidthAngle, plannerEstimate, scanLanes, type PlannerEstimateInput} from './plannerEstimate';

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  {x: x0, y: y0},
  {x: x1, y: y0},
  {x: x1, y: y1},
  {x: x0, y: y1},
];

const base: PlannerEstimateInput = {
  outline: rect(0, 0, 10, 6),
  holes: [],
  spacing: 0.14,
  bladeWidth: 0.18,
  perimeterOffset: 0,
  passes: 3,
  overlapPasses: 1,
  angle: 0,
  strategy: 'longest_edge',
  angleOffset: 0,
  angleStep: (5 * Math.PI) / 180,
  fillPattern: 'lanes',
  crosshatchAngle: Math.PI / 2,
  minLaneLength: 0.1,
};

describe('estimate like the MowBite Planner', () => {
  it('spreads the rows evenly between the edges of what the lanes fill, at most a spacing apart', () => {
    const plan = plannerEstimate(base)!;
    // 3 passes, the lanes reach under one of them: the lanes fill the area shrunk by 2 spacings
    const ys = [...new Set(plan.stripes.map(([p]) => +p.y.toFixed(6)))].sort((a, b) => a - b);
    expect(ys[0]).toBeCloseTo(0.28 + 1e-4, 6);
    expect(ys.at(-1)).toBeCloseTo(6 - 0.28 - 1e-4, 6);
    const gaps = ys.slice(1).map((y, i) => y - ys[i]);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(0.14 + 1e-9);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(1e-5);
    // the lanes run from edge to edge of that region, one a row
    expect(plan.stripes).toHaveLength(ys.length);
    expect(Math.min(...plan.stripes.map(([p, q]) => Math.min(p.x, q.x)))).toBeCloseTo(0.28, 6);
    // three passes around the outline, closed rings
    expect(plan.loops).toHaveLength(3);
    expect(plan.loops[0][0]).toEqual(plan.loops[0].at(-1));
  });

  it('crosshatch adds lanes across, rings has no lanes', () => {
    const cross = plannerEstimate({...base, fillPattern: 'crosshatch'})!;
    const vertical = cross.stripes.filter(([p, q]) => Math.abs(p.x - q.x) < 1e-9);
    expect(vertical.length).toBeGreaterThan(30);
    const rings = plannerEstimate({...base, fillPattern: 'concentric'})!;
    expect(rings.stripes).toHaveLength(0);
    expect(rings.loops.length).toBeGreaterThan(15);
  });

  it('obstacles get passes of their own and split the rows', () => {
    const plan = plannerEstimate({...base, holes: [rect(4, 2, 6, 4)]})!;
    expect(plan.loops).toHaveLength(6);
    const nearest = plan.stripes.reduce((b, [p]) => (Math.abs(p.y - 3) < Math.abs(b - 3) ? p.y : b), Infinity);
    expect(plan.stripes.filter(([p]) => Math.abs(p.y - nearest) < 1e-9)).toHaveLength(2);
  });

  it('works the direction out like the planner', () => {
    const tilted = rect(0, 0, 12, 3).map((p) => ({x: p.x * Math.cos(0.5) - p.y * Math.sin(0.5), y: p.x * Math.sin(0.5) + p.y * Math.cos(0.5)}));
    expect(Math.abs(Math.sin(longestEdgeAngle(tilted) - 0.5))).toBeLessThan(1e-9);
    expect(Math.abs(Math.sin(minWidthAngle(tilted) - 0.5))).toBeLessThan(1e-9);
    const auto = plannerEstimate({...base, outline: tilted, angle: null, strategy: 'optimal'})!;
    expect(Math.abs(Math.sin(auto.angle - 0.5))).toBeLessThan(0.05);
    // a fixed direction with the planner's own offset, kept in a range
    expect(plannerEstimate({...base, angle: 0.2, angleOffset: 0.1})!.angle).toBeCloseTo(0.3);
    expect(plannerEstimate({...base, angle: 1.2, angleMin: 0.1, angleMax: 0.5})!.angle).toBeLessThanOrEqual(0.5 + 1e-9);
  });

  it('leaves out lane pieces shorter than the shortest lane', () => {
    const rows = scanLanes([rect(0, 0, 0.05, 1)], 0, 0.14, 0.1);
    expect(rows.flat()).toHaveLength(0);
  });
});
