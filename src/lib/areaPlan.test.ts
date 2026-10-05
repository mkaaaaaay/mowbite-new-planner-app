import {describe, expect, it} from 'vitest';
import {readChecks, readPlan} from './areaPlan';

describe('readPlan', () => {
  it('reads the planner answer as ROS gives it', () => {
    const pose = (x: number, y: number) => ({pose: {position: {x, y}}});
    const plan = readPlan({
      paths: [
        {is_outline: 1, path: {poses: [pose(0, 0), pose(1, 0), pose(1, 1)]}},
        {is_outline: 0, path: {poses: [pose(0.2, 0.2), pose(0.8, 0.2), pose(0.8, 0.4)]}},
      ],
    });
    expect(plan.loops).toEqual([[{x: 0, y: 0}, {x: 1, y: 0}, {x: 1, y: 1}]]);
    expect(plan.stripes).toHaveLength(2);
  });

  it('also takes plain point lists', () => {
    const plan = readPlan([{outline: true, points: [[0, 0], [2, 0], [2, 2]]}]);
    expect(plan.loops[0][1]).toEqual({x: 2, y: 0});
  });
});

describe('readChecks', () => {
  it("reads what the planner's collision mode found", () => {
    const plan = readPlan({
      paths: [],
      stats: {
        body_fit: {fixed: 2, left: 1, skipped_m: 1.25, places: [[1, 2, 0], [3, 4, 1.25], ['x']], jumps: [], tries: 3},
        headland_turns: {turns_in_field: 1, places: [[5, 6]], crossings: 0},
      },
      warnings: ['2 places driven another way', 'poses outside the space the mower may drive in at 10°', 7],
      body_space: {outlines: [[[0, 0], [4, 0], [4, 3]], [[1, 1]]], holes: [[[1, 1], [2, 1], [2, 2]]]},
    });
    expect(plan.checks).toEqual({
      space: [
        [{x: 0, y: 0}, {x: 4, y: 0}, {x: 4, y: 3}],
        [{x: 1, y: 1}, {x: 2, y: 1}, {x: 2, y: 2}],
      ],
      places: [
        {x: 1, y: 2, m: 0},
        {x: 3, y: 4, m: 1.25},
      ],
      skipped: 1.25,
      turns: [{x: 5, y: 6}],
      // the false alarm the planner gives at some angles is left out
      warnings: ['2 places driven another way'],
    });
  });

  it('has nothing from a planner without it', () => {
    expect(readChecks({paths: []})).toBeUndefined();
    expect(readPlan({paths: []}).checks).toBeUndefined();
  });
});
