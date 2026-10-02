import {describe, expect, it} from 'vitest';
import {bodyFrom, bodyShape, spotPlaces, type PlannerSettings} from './mowerBody';

const settings = (values: Record<string, unknown>): PlannerSettings => ({
  settings: Object.fromEntries(
    Object.entries(values).map(([k, value]) => [k, {value, default: null, stored: true, type: 'number', settable: true}]),
  ),
});

describe('mower body', () => {
  it('needs width, front and rear', () => {
    expect(bodyFrom(null)).toBeNull();
    expect(bodyFrom(settings({robot_width: 0.4, robot_front: 0.43}))).toBeNull();
    expect(bodyFrom(settings({robot_width: 0.4, robot_front: 0.43, robot_rear: null}))).toBeNull();
    expect(bodyFrom(settings({robot_width: 0, robot_front: 0.43, robot_rear: 0.14}))).toBeNull();
    expect(bodyFrom(settings({robot_width: 0.4, robot_front: 0.43, robot_rear: 0.14, mower_width: 0.18, blade_ahead: 0.17}))).toEqual({
      width: 0.4,
      front: 0.43,
      rear: 0.14,
      blade: 0.18,
      bladeAhead: 0.17,
      bladeOffset: 0,
    });
  });

  it('puts the body around the point the mower follows, turned with its heading', () => {
    const b = {width: 0.4, front: 0.43, rear: 0.14, blade: 0.18, bladeAhead: 0.17, bladeOffset: 0.05};
    const east = bodyShape(b, 1, 2, 0);
    expect(east.corners.map((c) => [+c.x.toFixed(6), +c.y.toFixed(6)])).toEqual([
      [1.43, 2.2],
      [0.86, 2.2],
      [0.86, 1.8],
      [1.43, 1.8],
    ]);
    expect(east.blade.x).toBeCloseTo(1.17);
    expect(east.blade.y).toBeCloseTo(2.05); // left of heading east is north
    expect(east.middle.x).toBeCloseTo(1.145);
    // facing north: ahead is +y, left is -x
    const north = bodyShape(b, 0, 0, Math.PI / 2);
    expect(north.blade.x).toBeCloseTo(-0.05);
    expect(north.blade.y).toBeCloseTo(0.17);
    expect(north.corners[0].x).toBeCloseTo(-0.2);
    expect(north.corners[0].y).toBeCloseTo(0.43);
  });
});

describe('body spots', () => {
  it('draws one body per place', () => {
    // a turn on the spot reported 30 times, a loop corner over half a metre of path, a drive between parts further away
    const spin = Array.from({length: 30}, (_, i) => ({x: 1, y: 1, yaw: i * 0.2, kind: 'spin'}));
    const corner = Array.from({length: 6}, (_, i) => ({x: 1.2 + i * 0.1, y: 1, yaw: 0, kind: 'loop'}));
    const transit = [{x: 5, y: 5, yaw: 1, kind: 'transit'}];
    const places = spotPlaces([...spin, ...corner, ...transit]);
    expect(places).toHaveLength(2);
    expect(places[0].kinds).toEqual(['spin', 'loop']);
    expect(places[1]).toEqual({spot: transit[0], kinds: ['transit']});
    expect(spotPlaces([])).toEqual([]);
  });
});
