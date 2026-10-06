import {fmt, tr} from './i18n';
import type {PlannerSetting} from './mowerBody';
import {FIELDS} from './plannerFields';

// What an area sets for the planner itself, at a glance: its planner settings (the planner property) and OpenMower's
// own per area values the planner takes too (outline_count and co., the app doesn't offer them with the planner). In
// the planner's order: the area's planner settings, then OpenMower's of the area, then the ones for all areas.

export type OpenMowerOwn = {outline_count?: number; outline_overlap_count?: number; outline_offset?: number};

export type Own = {
  key: string;
  label: string;
  value: string;
  // why it doesn't count, null when it does
  idle: string | null;
};

// OpenMower's per area value and the planner setting it stands for
const OPENMOWER: [keyof OpenMowerOwn, string][] = [
  ['outline_count', 'perimeter_passes'],
  ['outline_overlap_count', 'lane_overlap_passes'],
  ['outline_offset', 'perimeter_offset'],
];

const short = (v: number) => fmt(v, Math.abs(v - Math.round(v)) < 0.05 ? 0 : 1);

function shown(key: string, v: unknown, s: PlannerSetting | undefined): string {
  const field = FIELDS[key];
  if (typeof v === 'boolean') return v ? tr('on') : tr('off');
  if (typeof v === 'string') return tr(field?.choices?.[v] ?? v);
  if (typeof v === 'number') {
    if (s?.auto_value !== undefined && v === s.auto_value) return tr('automatic');
    if (field?.unit === 'm') return Math.abs(v) < 1 ? `${short(v * 100)} cm` : `${fmt(v, 2)} m`;
    if (field?.unit === 'deg') return `${short((v * 180) / Math.PI)}°`;
    return short(v);
  }
  return JSON.stringify(v);
}

// collision: the planner checks the body (it has edge_margin and the sizes), edges doesn't count then
export function ownSettings(
  own: Record<string, unknown>,
  openmower: OpenMowerOwn,
  settings: Record<string, PlannerSetting>,
  collision: boolean,
): Own[] {
  const out: Own[] = [];
  for (const [key, v] of Object.entries(own)) {
    if (v === undefined || v === null) continue;
    const idle = !settings[key]
      ? tr("the planner doesn't know it")
      : key === 'edges' && collision
        ? tr('no effect with the mower sizes')
        : null;
    out.push({key, label: tr(FIELDS[key]?.label ?? key), value: shown(key, v, settings[key]), idle});
  }
  for (const [prop, key] of OPENMOWER) {
    const v = openmower[prop];
    // a count below 0 is OpenMower's "the global one", the planner leaves it out too
    if (typeof v !== 'number' || (prop !== 'outline_offset' && v < 0)) continue;
    out.push({
      key: prop,
      label: tr('{what} (OpenMower)', {what: tr(FIELDS[key]?.label ?? key)}),
      value: shown(key, v, undefined),
      idle: own[key] !== undefined && own[key] !== null ? tr("no effect, the area's planner setting counts") : null,
    });
  }
  return out;
}
