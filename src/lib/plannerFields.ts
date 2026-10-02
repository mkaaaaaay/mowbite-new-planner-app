// How the app shows the MowBite Planner's settings (planner.settings gives value, default, type, range and choices,
// this adds a name, what it does, a group and how a value is typed in). Settings the planner has but this doesn't
// know show up with their own name under "More", so a newer planner's settings can be set too.

export type Group = 'spacing' | 'pattern' | 'angle' | 'loops' | 'turns' | 'route' | 'fine';

export interface Field {
  label: string;
  help: string;
  group: Group;
  // how it's typed in: degrees for an angle the planner takes in rad
  unit?: 'm' | 'deg';
  step?: number;
  // names for the choices of a setting that has them
  choices?: Record<string, string>;
  // offered per area too (the area's planner property)
  area?: boolean;
  // only under "More"
  advanced?: boolean;
}

export const GROUPS: {key: Group; label: string}[] = [
  {key: 'spacing', label: 'Lane spacing'},
  {key: 'pattern', label: 'Pattern'},
  {key: 'angle', label: 'Mowing direction'},
  {key: 'loops', label: 'Outline passes'},
  {key: 'turns', label: 'Turns'},
  {key: 'route', label: 'Order and drives'},
  {key: 'fine', label: 'Fine tuning'},
];

export const FIELDS: Record<string, Field> = {
  lane_spacing_mode: {
    label: 'Lane spacing',
    help: "Fixed: OpenMower's lane spacing (tool_width), or the overlap set here. Picked by the planner: the widest spacing between the two below that leaves nothing unmowed, fewer lanes and turns.",
    group: 'spacing',
    choices: {fixed: 'Fixed', auto: 'Picked by the planner'},
    area: true,
  },
  lane_spacing_min: {label: 'Spacing from', help: 'The narrowest spacing the planner tries. Empty: half the blade.', group: 'spacing', unit: 'm', step: 0.01, advanced: true},
  lane_spacing_max: {label: 'Spacing up to', help: 'The widest spacing the planner tries, it starts there. Empty: 85 % of the blade.', group: 'spacing', unit: 'm', step: 0.01, advanced: true},
  overlap: {
    label: 'Overlap',
    help: "How much of the blade's width the lanes overlap (0.2 = 20 %), with a fixed spacing. Empty: from OpenMower's lane spacing (tool_width).",
    group: 'spacing',
    step: 0.05,
    advanced: true,
  },
  fill_pattern: {
    label: 'Pattern',
    help: 'Inside the outline passes: parallel lanes, lanes and then lanes across them, rings further and further in, or the planner decides: lanes or rings, whichever turns on the spot less and leaves less unmowed.',
    group: 'pattern',
    choices: {lanes: 'Lanes', crosshatch: 'Crosshatch', concentric: 'Rings', auto: 'Planner decides'},
    area: true,
  },
  narrow_parts: {
    label: 'Narrow parts',
    help: "Where the area is narrower than a U-turn (a path, a strip between beds): lanes anyway, or the outline passes go on further in until it's mowed.",
    group: 'pattern',
    choices: {lanes: 'Lanes anyway', loops: 'Passes further in'},
    area: true,
  },
  crosshatch_angle: {
    label: 'Crosshatch angle',
    help: 'Direction of the second lanes to the first.',
    group: 'pattern',
    unit: 'deg',
    step: 5,
  },
  angle_strategy: {
    label: 'Direction worked out',
    help: "How the planner picks the direction of the lanes itself. Set here, it wins over the area's mow angle (an area with an angle of its own keeps it, unless its own planner setting says otherwise).",
    group: 'angle',
    choices: {longest_edge: 'Along the longest edge', min_width: 'Across the narrowest width', optimal: 'Fewest lanes and turns'},
    area: true,
  },
  angle_offset: {
    label: 'Turned by',
    help: 'Added to the direction of the lanes, also to a fixed one.',
    group: 'angle',
    unit: 'deg',
    step: 1,
    advanced: true,
  },
  angle_step: {
    label: 'Steps tried',
    help: '"Fewest lanes and turns" tries directions this far apart. Smaller takes longer.',
    group: 'angle',
    unit: 'deg',
    step: 1,
    advanced: true,
  },
  angle: {
    label: 'Fixed direction',
    help: "Lanes always this way, wins over the areas' mow angle (but for areas with an angle of their own). Empty: worked out.",
    group: 'angle',
    unit: 'deg',
    step: 1,
    advanced: true,
  },
  angle_min: {label: 'Direction from', help: 'The direction of the lanes stays between these two, set both or neither.', group: 'angle', unit: 'deg', step: 1, advanced: true},
  angle_max: {label: 'Direction to', help: 'The direction of the lanes stays between these two, set both or neither.', group: 'angle', unit: 'deg', step: 1, advanced: true},
  perimeter_passes: {
    label: 'Number of outline passes',
    help: "For all areas, an area's own outline passes still count. Automatic: as many as the lanes' turns leave unmowed along the edge. Empty: OpenMower's (outline_count).",
    group: 'loops',
    step: 1,
  },
  lane_overlap_passes: {
    label: 'Overlapping passes',
    help: "How many outline passes the lanes reach into. Empty: OpenMower's (outline_overlap_count).",
    group: 'loops',
    step: 1,
    advanced: true,
  },
  perimeter_offset: {
    label: 'Outline offset',
    help: "How far inside the outline the first pass runs. Empty: OpenMower's (outline_offset).",
    group: 'loops',
    unit: 'm',
    step: 0.05,
    advanced: true,
  },
  perimeter_order: {
    label: 'Outline passes',
    help: 'Before the lanes, or after them: last mows over the marks the turns leave at the edge.',
    group: 'loops',
    choices: {first: 'First', last: 'Last'},
    area: true,
  },
  perimeter_direction: {
    label: 'Way round',
    help: 'Which way the outline passes go round. Automatic: the way the mower already faces.',
    group: 'loops',
    choices: {auto: 'Automatic', ccw: 'Counter-clockwise', cw: 'Clockwise'},
  },
  perimeter_corner_radius: {
    label: 'Corner rounding',
    help: 'Corners of the outline passes are rounded this much, 0 = sharp.',
    group: 'loops',
    unit: 'm',
    step: 0.05,
  },
  turn_radius: {
    label: 'Turn radius',
    help: 'Radius of the turns between lanes. Larger is gentler on the lawn, but needs more room at the edge.',
    group: 'turns',
    unit: 'm',
    step: 0.05,
    area: true,
  },
  lane_order: {
    label: 'Lane order',
    help: 'Neighbour after neighbour needs tight turns. Skipping lanes leaves room for a wide turn every time, the lanes in between follow on the way back.',
    group: 'turns',
    choices: {snake: 'Neighbour after neighbour', skip: 'Skip lanes'},
  },
  turn_types: {
    label: 'Turns allowed',
    help: 'The kinds of turns the planner may use. The mower only drives forwards, so backing up is left out.',
    group: 'turns',
    choices: {u_turn: 'U-turn', bulb: 'Bulb turn', k_turn: 'Three-point turn', detour: 'Detour along the edge', pivot: 'Turn on the spot'},
    advanced: true,
  },
  smooth_spins: {
    label: 'Loop out instead of turning on the spot',
    help: 'Where a path would turn on the spot by a lot, the mower drives a small loop instead, where it fits. Gentler on the lawn.',
    group: 'turns',
  },
  allow_reverse: {
    label: 'Back up where needed',
    help: 'Three-point turns where nothing else fits. Only with an OpenMower that can back up along the plan, otherwise the mower stops there.',
    group: 'turns',
    advanced: true,
  },
  route_order: {
    label: 'Order of the parts',
    help: 'The closest part not mowed yet next, or the order with the shortest drives between them (takes a little longer to plan).',
    group: 'route',
    choices: {nearest: 'Closest next', optimized: 'Shortest drives'},
    area: true,
  },
  bend_max_gap: {
    label: 'Lanes around obstacles',
    help: 'A lane split by an obstacle no longer than this (a tree, a small bed) goes on around it instead of the area being split there. 0 = off.',
    group: 'route',
    unit: 'm',
    step: 0.5,
    area: true,
  },
  bend_max_offset: {
    label: 'How far around',
    help: 'How far a lane going around an obstacle may leave its line.',
    group: 'route',
    unit: 'm',
    step: 0.1,
  },
  nested_areas: {
    label: 'Areas inside areas',
    help: 'A mowing area lying in another (90 % of it at least) is left out of the bigger one and mowed round, it gets a plan of its own with its own settings (another angle, not mowed). Off: the bigger one mows across it.',
    group: 'route',
  },
  transit_edge_distance: {
    label: 'Drives away from edges',
    help: "Drives between the parts keep this far from walls and beds where that doesn't cost much more. 0 = the shortest way.",
    group: 'route',
    unit: 'm',
    step: 0.1,
  },
  transit_edge_cost: {
    label: 'How much more it may cost',
    help: 'Every meter closer to an edge counts this many meters more.',
    group: 'route',
    step: 0.5,
    advanced: true,
  },
  waypoint_spacing: {label: 'Point spacing', help: 'Distance between the points of the path.', group: 'fine', unit: 'm', step: 0.01, advanced: true},
  transit_clearance: {label: 'Clearance of drives', help: 'Drives keep this far from the outline passes.', group: 'fine', unit: 'm', step: 0.01, advanced: true},
  simplify_tolerance: {label: 'Outline smoothing', help: 'Outlines and obstacles are smoothed this much first.', group: 'fine', unit: 'm', step: 0.01, advanced: true},
  min_lane_length: {label: 'Shortest lane', help: 'Shorter pieces of a lane are left out.', group: 'fine', unit: 'm', step: 0.01, advanced: true},
};

// shown in their own card (Mower sizes)
export const BODY_KEYS = [
  'robot_width',
  'robot_front',
  'robot_rear',
  'mower_width',
  'blade_ahead',
  'blade_offset',
  'body_tolerance',
  'min_turn_radius',
  'edges',
];

const DEG = 180 / Math.PI;

// the value as typed in: degrees for angles, rounded so a stored rad value doesn't show 15 decimals
export function toInput(field: Field | undefined, value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  const v = field?.unit === 'deg' ? value * DEG : value;
  return String(Math.round(v * 1000) / 1000);
}

// what the planner takes: null for an empty field (back to the default), rad for degrees
export function fromInput(field: Field | undefined, text: string): number | null | 'invalid' {
  const t = text.trim().replace(',', '.');
  if (!t) return null;
  const v = Number(t);
  if (!Number.isFinite(v)) return 'invalid';
  return field?.unit === 'deg' ? v / DEG : v;
}
