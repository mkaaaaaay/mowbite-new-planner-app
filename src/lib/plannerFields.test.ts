import {describe, expect, it} from 'vitest';
import {FIELDS, fromInput, toInput} from './plannerFields';

describe('planner fields', () => {
  it('shows angles in degrees and meters as they are', () => {
    expect(toInput(FIELDS.crosshatch_angle, Math.PI / 2)).toBe('90');
    expect(toInput(FIELDS.turn_radius, 0.25)).toBe('0.25');
    expect(toInput(FIELDS.angle, null)).toBe('');
    expect(toInput(undefined, 1.23456)).toBe('1.235');
  });

  it('reads what is typed in back for the planner', () => {
    expect(fromInput(FIELDS.crosshatch_angle, '45')).toBeCloseTo(Math.PI / 4);
    expect(fromInput(FIELDS.turn_radius, '0,3')).toBe(0.3);
    expect(fromInput(FIELDS.turn_radius, '  ')).toBeNull();
    expect(fromInput(FIELDS.turn_radius, 'abc')).toBe('invalid');
  });

  it('offers the main settings per area too', () => {
    expect(Object.keys(FIELDS).filter((k) => FIELDS[k].area)).toEqual([
      'lane_spacing_mode',
      'fill_pattern',
      'narrow_parts',
      'angle_strategy',
      'perimeter_order',
      'turn_radius',
      'turn_on_spot',
      'headland_turns',
      'edge_margin',
      'obstacle_margin',
      'body_fit',
      'route_order',
      'bend_max_gap',
    ]);
  });

  it('warns when the turn radius is under the tightest curve radius', async () => {
    const {turnRadiusWarning} = await import('@/components/PlannerSettings');
    const all = {
      min_turn_radius: {value: 0.3, default: 0, stored: true, type: 'number', settable: true},
      turn_radius: {value: 0.25, default: 0.25, stored: false, type: 'number', settable: true},
    };
    expect(turnRadiusWarning(all, undefined)).toContain('0.3');
    expect(turnRadiusWarning(all, 0.3)).toBeNull();
    expect(turnRadiusWarning(all, 0.4)).toBeNull();
    expect(turnRadiusWarning({...all, min_turn_radius: {...all.min_turn_radius, value: 0}}, 0.1)).toBeNull();
  });
});
