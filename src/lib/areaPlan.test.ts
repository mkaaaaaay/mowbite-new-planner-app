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
        body_fit: {fixed: 2, left: 1, skipped_m: 1.25, places: [[1, 2, 0], [3, 4, 1.25], ['x']], jumps: [[3, 4]], tries: 3},
        headland_turns: {turns_in_field: 1, places: [[5, 6]], crossings: 0},
      },
      warnings: [
        '2 places driven another way where the body would stick out, 1.2 m of loops and lanes left out there',
        "1 places left out where the body doesn't fit and no other way does, the path jumps over them at (3.00, 4.00)",
        'the area is too narrow somewhere',
        7,
      ],
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
      fixed: 2,
      left: 1,
      skipped: 1.25,
      jumps: [{x: 3, y: 4}],
      turns: [{x: 5, y: 6}],
      // the lines for the counts come from the counts
      warnings: ['the area is too narrow somewhere'],
    });
  });

  it('has nothing from a planner without it', () => {
    expect(readChecks({paths: []})).toBeUndefined();
    expect(readPlan({paths: []}).checks).toBeUndefined();
  });
});
