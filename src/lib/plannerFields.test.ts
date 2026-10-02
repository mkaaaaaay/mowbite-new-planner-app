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
      'mode',
      'lane_spacing_mode',
      'fill_pattern',
      'narrow_parts',
      'angle_strategy',
      'perimeter_order',
      'turn_radius',
      'route_order',
      'bend_max_gap',
    ]);
  });

  it('a mode sets the pattern, loops instead of turning and narrow parts, slic3r all of them', async () => {
    const {modeNote} = await import('@/components/PlannerSettings');
    expect(modeNote('custom', 'fill_pattern')).toBeNull();
    expect(modeNote('gentle', 'fill_pattern')).toContain('Gentle on the lawn');
    expect(modeNote('lines', 'turn_radius')).toBeNull();
    expect(modeNote('slic3r', 'turn_radius')).toContain('old planner');
    expect(modeNote('gentle', 'mode')).toBeNull();
    // a mode this app doesn't know (a newer planner's) doesn't grey anything out
    expect(modeNote('zigzag', 'fill_pattern')).toBeNull();
  });
});
