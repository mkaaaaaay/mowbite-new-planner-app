import {describe, expect, it} from 'vitest';
import type {PlannerSetting} from './mowerBody';
import {ownSettings} from './plannerOwn';

const setting = (value: unknown, more: Partial<PlannerSetting> = {}): PlannerSetting => ({
  value,
  default: value,
  stored: false,
  type: typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string',
  settable: true,
  ...more,
});
const all = {
  fill_pattern: setting('lanes', {choices: ['lanes', 'concentric']}),
  perimeter_passes: setting(2, {type: 'integer', auto_value: -1}),
  edges: setting('recorded', {choices: ['recorded', 'hard']}),
  obstacle_margin: setting(0.1),
  allow_reverse: setting(false),
};

describe('ownSettings', () => {
  it('lists what an area sets itself, in words', () => {
    const own = ownSettings({fill_pattern: 'concentric', perimeter_passes: -1, obstacle_margin: 0.03, allow_reverse: false}, {}, all, false);
    expect(own.map((o) => [o.label, o.value, o.idle])).toEqual([
      ['Pattern', 'Rings', null],
      ['Number of outline passes', 'automatic', null],
      ['Distance to obstacles', '3 cm', null],
      ['Back up where needed', 'off', null],
    ]);
  });

  it("marks what doesn't count", () => {
    const own = ownSettings({edges: 'hard', perimeter_passes: -1, gone: 1}, {outline_count: 3, outline_overlap_count: -1}, all, true);
    expect(own.map((o) => [o.key, o.value, o.idle])).toEqual([
      ['edges', 'The wall itself', 'no effect with the mower sizes'],
      ['perimeter_passes', 'automatic', null],
      ['gone', '1', "the planner doesn't know it"],
      // the area's own passes win, OpenMower's -1 is its "the global one" and left out
      ['outline_count', '3', "no effect, the area's planner setting counts"],
    ]);
  });

  it("counts OpenMower's own values while the area has no planner setting for them", () => {
    const own = ownSettings({}, {outline_count: 3, outline_offset: 0.2}, all, false);
    expect(own.map((o) => [o.label, o.value, o.idle])).toEqual([
      ['Number of outline passes (OpenMower)', '3', null],
      ['Outline offset (OpenMower)', '20 cm', null],
    ]);
  });
});
