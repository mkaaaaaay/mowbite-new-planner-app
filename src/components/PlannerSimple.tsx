'use client';

import {tr} from '@/lib/i18n';
import {resetPlannerAngle, savePlannerSettings, usePlannerSettings, type PlannerSetting} from '@/lib/mowerBody';
import {RpcError} from '@/lib/rpc';
import {useState} from 'react';
import InfoTip from './InfoTip';
import local from './PlannerSimple.module.css';

// The planner's settings that matter for a garden, simply: the lines of the map, the pattern, the lane spacing, the
// outline passes, the tightest curve and backing up. For all areas (saved on the planner right away) or for one area
// (its planner property, saved with the map, nothing set: like all areas). The rest is the planner's defaults, for
// experts in the full lists.

type Area = {
  own: Record<string, unknown>;
  set: (key: string, value: unknown) => void;
  // the area's OpenMower outline passes, what counts for it while the planner has none of its own
  passes?: number;
  // the outline passes in its plan (automatic: what the planner worked out for it)
  planned?: number;
  // the directions its lanes keep to (rad, its angle_min and angle_max, both or neither)
  range?: {min?: number; max?: number; set: (min: number | undefined, max: number | undefined) => void};
};

const DEG = Math.PI / 180;
// degrees -180..180 for showing an angle
const deg = (rad: number) => {
  const d = Math.round(rad / DEG);
  return ((((d + 180) % 360) + 360) % 360) - 180;
};
// degrees to a tenth, for a step
const degrees = (rad: number) => Math.round((rad / DEG) * 10) / 10;

const PATTERNS = ['lanes', 'concentric', 'crosshatch'];
const PATTERN_LABELS: Record<string, string> = {lanes: 'Lanes', concentric: 'Rings', crosshatch: 'Crosshatch'};

function Choice({
  options,
  value,
  onChange,
  like,
  disabled,
}: {
  options: [string, string][];
  value: unknown;
  onChange: (v: string | undefined) => void;
  // for an area: the choice "like all areas"
  like?: string;
  disabled?: boolean;
}) {
  return (
    <div className={local.segment}>
      {like !== undefined && (
        <button className={value === undefined ? local.on : undefined} disabled={disabled} onClick={() => onChange(undefined)}>
          {like}
        </button>
      )}
      {options.map(([k, label]) => (
        <button key={k} className={value === k ? local.on : undefined} disabled={disabled} onClick={() => onChange(k)}>
          {label}
        </button>
      ))}
    </div>
  );
}

// a setting: its name, what it's for (behind the i), the choices and what the one taken does
function Row({label, help, note, children}: {label: string; help?: string; note?: string | null; children: React.ReactNode}) {
  return (
    <div className={local.row}>
      <span className={local.label}>
        {label}
        {help && <InfoTip>{help}</InfoTip>}
      </span>
      {children}
      {note && <p className={local.note}>{note}</p>}
    </div>
  );
}

// what each choice does, shown under the one taken. The lines: with the strip the blade leaves along them (m, unknown
// for hard ones without the body's width)
function edgeNote(edges: unknown, strip: number | undefined): string | null {
  if (edges === 'hard') {
    if (strip === undefined)
      return tr(
        'The lines are the border itself (a wall, a bed, a fence): nothing of the mower goes beyond them. Along them a strip stays standing, from the side of the mower to its blade, that needs trimming.',
      );
    if (strip <= 0.005) return tr('The lines are the border itself (a wall, a bed, a fence): nothing of the mower goes beyond them, and the blade still reaches them.');
    return tr(
      'The lines are the border itself (a wall, a bed, a fence): nothing of the mower goes beyond them. Along them a strip of about {cm} cm stays standing (more in corners), that needs trimming.',
      {cm: Math.round(strip * 100)},
    );
  }
  if (edges !== 'recorded') return null;
  if (strip === undefined || strip <= 0.005)
    return tr(
      'The lines are the track the middle of the mower drove when the area was recorded: the mower may reach beyond them as far as it did then, and the blade mows right up to them.',
    );
  return tr(
    'The lines are the track the middle of the mower drove when the area was recorded: the mower may reach beyond them as far as it did then. The blade keeps about {cm} cm inside them.',
    {cm: Math.round(strip * 100)},
  );
}
const PATTERN_NOTES: Record<string, string> = {
  lanes: 'Straight lanes side by side, there and back: the quickest, with even stripes.',
  concentric: 'Rounds from the outside in: few turns, but a lot of tight turning in the corners.',
  crosshatch: 'Lanes, then the same again across them: twice as long, very thorough.',
};

// omIncrement: OpenMower's own mow_angle_increment (degrees), it adds up with the planner's turning further
export function PlannerSimple({area, toolWidth, omIncrement}: {area?: Area; toolWidth?: number; omIncrement?: number}) {
  const planner = usePlannerSettings();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [state, setState] = useState<{busy?: boolean; error?: string}>({});
  if (!planner) return null;
  const all: Record<string, PlannerSetting> = planner.settings;
  const has = (k: string) => !!all[k]?.settable;
  const global = (k: string) => all[k]?.value;
  // what's set: the area's own (undefined: like all areas), or the one for all areas
  const value = (k: string) => (area ? area.own[k] : global(k));
  const effective = (k: string) => (area && area.own[k] !== undefined ? area.own[k] : global(k));
  const save = async (k: string, v: unknown) => {
    if (area) return area.set(k, v);
    setState({busy: true});
    try {
      await savePlannerSettings({[k]: v === undefined ? null : v});
      setState({});
    } catch (e) {
      setState({error: e instanceof RpcError && e.code !== 'timeout' ? e.message : tr('The mower did not answer.')});
    }
  };
  const like = (text: string) => (area ? tr('like all areas ({value})', {value: text}) : undefined);
  const blade = typeof global('mower_width') === 'number' ? (global('mower_width') as number) : 0.18;
  // a number typed in, saved when the field is left
  const numberField = (key: string, shown: string, placeholder: string, apply: (text: string) => void) => (
    <input
      inputMode="decimal"
      value={drafts[key] ?? shown}
      placeholder={placeholder}
      disabled={state.busy}
      onChange={(e) => setDrafts({...drafts, [key]: e.target.value})}
      onBlur={() => {
        if (drafts[key] === undefined) return;
        apply(drafts[key]);
        const rest = {...drafts};
        delete rest[key];
        setDrafts(rest);
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
  const parse = (text: string) => {
    const v = Number(text.trim().replace(',', '.'));
    return text.trim() && Number.isFinite(v) ? v : null;
  };

  // the lane spacing: worked out by the planner, or fixed (from the overlap with the blade, else OpenMower's)
  const auto = effective('lane_spacing_mode') === 'auto';
  // an overlap set for the planner (the area's, else the one for all areas), else OpenMower's lane spacing
  const overlap = area?.own.overlap ?? (all.overlap?.stored ? all.overlap.value : undefined);
  const spacingCm = typeof overlap === 'number' ? blade * (1 - overlap) * 100 : toolWidth !== undefined ? toolWidth * 100 : null;
  const passes = effective('perimeter_passes');
  const autoPasses = all.perimeter_passes?.auto_value;
  const passesAuto = autoPasses !== undefined && passes === autoPasses;
  const passesShown = area && area.own.perimeter_passes === undefined ? (area.passes ?? global('perimeter_passes')) : passes;
  const least = value('min_turn_radius');
  // the angle turned further after finished mows: by the area's own step or the one for all areas, every nth mow
  const stepOf = (v: unknown) => (typeof v === 'number' ? v : 0);
  const step = stepOf(effective('angle_increment'));
  const every = typeof global('angle_increment_every') === 'number' ? (global('angle_increment_every') as number) : 1;
  const steps = planner.angle_steps ?? 0;
  const mows = planner.angle_mows ?? 0;
  const resetAngle = async () => {
    setState({busy: true});
    try {
      await resetPlannerAngle();
      setState({});
    } catch (e) {
      setState({error: e instanceof RpcError && e.code !== 'timeout' ? e.message : tr('The mower did not answer.')});
    }
  };
  // how far in from the lines the blade's edge stays on the first outline pass (the planner's blade_loop_offset less
  // half the blade): perimeter_offset, by default half the blade (it reaches the lines), with hard edges at least half
  // the body's width less the blade's offset
  const num = (k: string) => (typeof effective(k) === 'number' ? (effective(k) as number) : undefined);
  const first = num('perimeter_offset') ?? 0.5 * blade;
  const width = num('robot_width');
  const strip =
    effective('edges') !== 'hard'
      ? first - 0.5 * blade
      : width === undefined
        ? undefined
        : Math.max(first, 0.5 * width - Math.abs(num('blade_offset') ?? 0)) - 0.5 * blade;

  return (
    <div className={local.simple}>
      {has('edges') && (
        <Row
          label={tr('Lines of the map')}
          help={tr('What the lines of your map stand for. Recorded by driving the mower around: "driven along the edge". Drawn on the screen right along a wall or a bed: "the wall itself".')}
          note={edgeNote(effective('edges'), strip)}
        >
          <Choice
            options={[
              ['hard', tr('The wall itself')],
              ['recorded', tr('Driven along the edge')],
            ]}
            value={value('edges')}
            like={like(global('edges') === 'hard' ? tr('The wall itself') : tr('Driven along the edge'))}
            disabled={state.busy}
            onChange={(v) => void save('edges', v)}
          />
        </Row>
      )}

      {has('fill_pattern') && (
        <Row
          label={tr('Pattern')}
          help={tr('How the mower covers the inside of the area, after the outline passes.')}
          note={PATTERN_NOTES[String(effective('fill_pattern'))] ? tr(PATTERN_NOTES[String(effective('fill_pattern'))]) : null}
        >
          <Choice
            options={PATTERNS.filter((p) => all.fill_pattern.choices?.includes(p)).map((p) => [p, tr(PATTERN_LABELS[p])])}
            value={value('fill_pattern')}
            like={like(tr(PATTERN_LABELS[String(global('fill_pattern'))] ?? String(global('fill_pattern'))))}
            disabled={state.busy}
            onChange={(v) => void save('fill_pattern', v)}
          />
        </Row>
      )}

      {has('lane_spacing_mode') && (
        <Row
          label={tr('Lane spacing')}
          help={tr('How far apart the lanes are. The blade mows a little wider, so neighbouring lanes overlap.')}
          note={
            auto
              ? tr('The planner takes the widest spacing that still leaves nothing unmowed: fewer lanes and turns, done sooner.')
              : tr('Smaller means more overlap: more thorough, but it takes longer. Empty: the spacing set in OpenMower.')
          }
        >
          <Choice
            options={[
              ['auto', tr('automatic')],
              ['fixed', tr('Fixed')],
            ]}
            value={value('lane_spacing_mode')}
            like={like(global('lane_spacing_mode') === 'auto' ? tr('automatic') : tr('Fixed'))}
            disabled={state.busy}
            onChange={(v) => void save('lane_spacing_mode', v)}
          />
          {!auto && has('overlap') && (
            <label className={local.field}>
              {tr('cm apart')}
              {numberField(
                'spacing',
                area && area.own.overlap === undefined ? '' : spacingCm !== null ? String(Math.round(spacingCm * 10) / 10) : '',
                spacingCm !== null ? String(Math.round(spacingCm * 10) / 10) : '',
                (text) => {
                  const cm = parse(text);
                  if (cm === null) return void save('overlap', undefined);
                  void save('overlap', Math.min(0.95, Math.max(0, 1 - cm / 100 / blade)));
                },
              )}
            </label>
          )}
        </Row>
      )}

      {has('perimeter_passes') && (
        <Row
          label={tr('Outline passes')}
          help={tr('How many rounds the mower drives along the edge first, before it mows the inside. The rounds leave it room to turn at the ends of the lanes.')}
          note={
            passesAuto
              ? tr('As many as the turns at the ends of the lanes need room for: the further the mower reaches past its drive wheels and the wider its curves, the more.') +
                (area?.planned !== undefined ? ' ' + tr('For this area: {n}.', {n: area.planned}) : '')
              : autoPasses !== undefined
                ? tr('Always this many, however much room the turns need. "automatic" works it out to fit the mower.')
                : null
          }
        >
          <div className={local.inline}>
            {autoPasses !== undefined && (
              <button
                className={passesAuto ? local.on : undefined}
                disabled={state.busy}
                onClick={() => void save('perimeter_passes', passesAuto ? undefined : autoPasses)}
              >
                {tr('automatic')}
              </button>
            )}
            {!passesAuto &&
              numberField(
                'passes',
                area && area.own.perimeter_passes === undefined ? '' : typeof passes === 'number' ? String(passes) : '',
                typeof passesShown === 'number' ? String(passesShown) : '',
                (text) => {
                  const n = parse(text);
                  void save('perimeter_passes', n === null ? undefined : Math.max(0, Math.round(n)));
                },
              )}
          </div>
        </Row>
      )}

      {has('min_turn_radius') && (
        <Row
          label={tr('Tightest curve radius')}
          help={
            planner.can_back_up === true
              ? tr('The tighter a curve, the slower the inner wheel turns, at the tightest it stands still or turns backwards and tears the lawn. Where no curve this wide fits, the mower turns on the spot instead, or backs up briefly where that is on.')
              : tr('The tighter a curve, the slower the inner wheel turns, at the tightest it stands still or turns backwards and tears the lawn. Where no curve this wide fits, the mower turns on the spot instead.')
          }
          note={tr('Larger is gentler on the lawn but needs more room at the edge. At half the distance between the drive wheels the inner wheel just stands still: take a little more than that.')}
        >
          <label className={local.field}>
            cm
            {numberField(
              'least',
              typeof least === 'number' ? String(Math.round(least * 1000) / 10) : '',
              typeof global('min_turn_radius') === 'number' ? String(Math.round((global('min_turn_radius') as number) * 1000) / 10) : '',
              (text) => {
                const cm = parse(text);
                void save('min_turn_radius', cm === null ? undefined : Math.max(0, cm / 100));
              },
            )}
          </label>
        </Row>
      )}

      {has('angle_increment') && (
        <Row
          label={tr('Turn the angle further')}
          help={tr(
            "So the wheels don't wear tracks into the lawn: after finished mowing runs the lanes run a little turned each time. Within an area's angle range they swing back and forth between its ends, without one they go round all 180°.",
          )}
          note={
            !step
              ? tr('Off: the lanes run the same way every time.')
              : (every > 1
                  ? tr('After every {n}th finished mowing run the lanes turn {deg}° further.', {n: every, deg: degrees(step)})
                  : tr('After every finished mowing run the lanes turn {deg}° further.', {deg: degrees(step)})) +
                (steps > 0 ? ' ' + tr('So far {steps} times, {deg}° in all.', {steps, deg: degrees(steps * step)}) : '')
          }
        >
          <div className={local.inline}>
            <label className={local.field}>
              {tr('by')}
              {numberField(
                'turn',
                area && area.own.angle_increment === undefined ? '' : String(degrees(step)),
                area ? String(degrees(stepOf(global('angle_increment')))) : '0',
                (text) => {
                  const d = parse(text);
                  void save('angle_increment', d === null ? (area ? undefined : 0) : Math.min(180, Math.max(0, d)) * DEG);
                },
              )}
              °
            </label>
            {!area && has('angle_increment_every') && (
              <label className={local.field}>
                {tr('after every')}
                {numberField('every', String(every), '1', (text) => {
                  const n = parse(text);
                  void save('angle_increment_every', n === null ? undefined : Math.max(1, Math.round(n)));
                })}
                {tr('th mowing run')}
              </label>
            )}
            {!area && steps + mows > 0 && (
              <button disabled={state.busy} onClick={() => void resetAngle()}>
                {tr('back to 0°')}
              </button>
            )}
          </div>
          {!area && !!omIncrement && (
            <span className={local.error}>
              {tr('OpenMower turns the angle further as well (mow_angle_increment {deg}°), the two add up. Set it to 0 in mower_params.yaml.', {
                deg: omIncrement,
              })}
            </span>
          )}
        </Row>
      )}

      {area?.range && (
        <Row
          label={tr('Angle range')}
          help={tr(
            'The direction of the lanes stays between these two. When the angle turns further by itself after every mowing run, it swings back and forth between them. 0° and 180° give the same lanes.',
          )}
          note={
            area.range.min !== undefined && area.range.max !== undefined
              ? deg(area.range.min) === deg(area.range.max)
                ? tr('The lanes always run at {from}°.', {from: deg(area.range.min)})
                : tr('The lanes stay between {from}° and {to}°.', {from: deg(area.range.min), to: deg(area.range.max)})
              : area.range.min !== undefined || area.range.max !== undefined
                ? tr('Set both ends, one alone does nothing.')
                : tr('No range: the lanes may run any way, an angle turning further goes round all 180°.')
          }
        >
          <div className={local.inline}>
            {(['min', 'max'] as const).map((end) => (
              <label key={end} className={local.field}>
                {end === 'min' ? tr('from') : tr('to')}
                {numberField(
                  'range' + end,
                  area.range![end] !== undefined ? String(deg(area.range![end]!)) : '',
                  '',
                  (text) => {
                    const d = parse(text);
                    const v = d === null ? undefined : deg(d * DEG) * DEG;
                    if (end === 'min') area.range!.set(v, area.range!.max);
                    else area.range!.set(area.range!.min, v);
                  },
                )}
                °
              </label>
            ))}
            {(area.range.min !== undefined || area.range.max !== undefined) && (
              <button onClick={() => area.range!.set(undefined, undefined)}>{tr('none')}</button>
            )}
          </div>
        </Row>
      )}

      {has('allow_reverse') && planner.can_back_up === true && (
        <Row
          label={tr('Back up where needed')}
          help={tr('Possible because OpenMower on this mower backs up along the plan.')}
          note={tr('Where no turn fits going forwards (a tight corner), the mower backs up briefly, a three-point turn, instead of turning on the spot.')}
        >
          <Choice
            options={[
              ['on', tr('on')],
              ['off', tr('off')],
            ]}
            value={value('allow_reverse') === undefined ? undefined : value('allow_reverse') ? 'on' : 'off'}
            like={like(global('allow_reverse') ? tr('on') : tr('off'))}
            disabled={state.busy}
            onChange={(v) => void save('allow_reverse', v === undefined ? undefined : v === 'on')}
          />
        </Row>
      )}

      {state.error && <span className={local.error}>{state.error}</span>}
    </div>
  );
}
