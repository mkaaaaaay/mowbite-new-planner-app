'use client';

import {tr} from '@/lib/i18n';
import {resetPlannerAngle, savePlannerSettings, usePlannerSettings, type PlannerSetting} from '@/lib/mowerBody';
import {ownSettings, type OpenMowerOwn} from '@/lib/plannerOwn';
import {RpcError} from '@/lib/rpc';
import {useEffect, useState} from 'react';
import InfoTip from './InfoTip';
import local from './PlannerSimple.module.css';

// The planner's settings that matter for a garden, in a few sections: the pattern, the edge, obstacles, turns and the
// direction turning further. For all areas (saved on the planner right away) or for one area (its planner property,
// saved with the map, nothing set: like all areas), with what the area sets itself at the top. A setting shows only
// when the planner on the mower has it. The rest is in the lists for experts below (SIMPLE: the ones that are here).

type Area = {
  own: Record<string, unknown>;
  set: (key: string, value: unknown) => void;
  // OpenMower's own values of the area (outline_count and co.), they count while the planner has none of its own
  openmower?: OpenMowerOwn;
  // everything of its own back to like all areas
  clear?: () => void;
  // the outline passes in its plan (automatic: what the planner worked out for it)
  planned?: number;
};

const DEG = Math.PI / 180;
// degrees to a tenth, for a step
const degrees = (rad: number) => Math.round((rad / DEG) * 10) / 10;
const cm = (m: unknown) => (typeof m === 'number' ? String(Math.round(m * 1000) / 10) : '');

const PATTERNS = ['lanes', 'concentric', 'crosshatch'];
const PATTERN_LABELS: Record<string, string> = {lanes: 'Lanes', concentric: 'Rings', crosshatch: 'Crosshatch'};
const PATTERN_NOTES: Record<string, string> = {
  lanes: 'Straight lanes there and back: the quickest, even stripes.',
  concentric: 'Rounds from the outside in: few turns, tight ones in the corners.',
  crosshatch: 'Lanes and the same across them: twice as long, very thorough.',
};

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
  // for an area: the choice "as all areas"
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

// a setting: its name with what it's for behind the i, the control, a line on what the choice taken does
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

function Section({title, note, children}: {title: string; note?: string | null; children: React.ReactNode}) {
  return (
    <section className={local.section}>
      <h4 className={local.heading}>{title}</h4>
      {note && <p className={local.note}>{note}</p>}
      {children}
    </section>
  );
}

// omIncrement: OpenMower's own mow_angle_increment (degrees), it adds up with the planner's turning further
export function PlannerSimple({area, toolWidth, omIncrement}: {area?: Area; toolWidth?: number; omIncrement?: number}) {
  const planner = usePlannerSettings();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [state, setState] = useState<{busy?: boolean; error?: string; saved?: number}>({});
  // "saved" shows for a moment
  useEffect(() => {
    if (!state.saved) return;
    const t = setTimeout(() => setState((s) => (s.saved === state.saved ? {} : s)), 2500);
    return () => clearTimeout(t);
  }, [state.saved]);
  if (!planner) return null;
  const all: Record<string, PlannerSetting> = planner.settings;
  const has = (k: string) => !!all[k]?.settable;
  const global = (k: string) => all[k]?.value;
  // what's set: the area's own (undefined: like all areas), or the one for all areas
  const value = (k: string) => (area ? area.own[k] : global(k));
  const effective = (k: string) => (area && area.own[k] !== undefined ? area.own[k] : global(k));
  const num = (k: string) => (typeof effective(k) === 'number' ? (effective(k) as number) : undefined);
  const save = async (k: string, v: unknown) => {
    if (area) return area.set(k, v);
    setState({busy: true});
    try {
      await savePlannerSettings({[k]: v === undefined ? null : v});
      setState((s) => ({saved: (s.saved ?? 0) + 1}));
    } catch (e) {
      setState({error: e instanceof RpcError && e.code !== 'timeout' ? e.message : tr('The mower did not answer.')});
    }
  };
  const like = (text: string) => (area ? tr('as all ({value})', {value: text}) : undefined);
  const parse = (text: string) => {
    const v = Number(text.trim().replace(',', '.'));
    return text.trim() && Number.isFinite(v) ? v : null;
  };
  // a number typed in, saved when the field is left, with its unit after it
  const numberField = (key: string, shown: string, placeholder: string, unit: string, apply: (text: string) => void) => (
    <label className={local.field}>
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
      {unit}
    </label>
  );
  // a distance in cm for a setting in m, for an area empty is "as all areas"
  const cmField = (key: string, max = 100) =>
    numberField(key, area && area.own[key] === undefined ? '' : cm(value(key)), cm(global(key)), 'cm', (text) => {
      const v = parse(text);
      void save(key, v === null ? undefined : Math.min(max, Math.max(0, v)) / 100);
    });
  // one of two ways, off first: for an area also "as all areas"
  const either = (key: string, off: string, on: string) => (
    <Choice
      options={[
        ['off', off],
        ['on', on],
      ]}
      value={value(key) === undefined ? undefined : value(key) ? 'on' : 'off'}
      like={like(global(key) ? on : off)}
      disabled={state.busy}
      onChange={(v) => void save(key, v === undefined ? undefined : v === 'on')}
    />
  );
  // on or off: a switch for all areas
  const toggle = (key: string) =>
    area ? (
      either(key, tr('off'), tr('on'))
    ) : (
      <label className={local.switch}>
        <input type="checkbox" checked={!!value(key)} disabled={state.busy} onChange={(e) => void save(key, e.target.checked)} />
        <span>{value(key) ? tr('on') : tr('off')}</span>
      </label>
    );

  const blade = typeof global('mower_width') === 'number' ? (global('mower_width') as number) : 0.18;
  // the lane spacing: worked out by the planner, or fixed (from the overlap with the blade, else OpenMower's)
  const auto = effective('lane_spacing_mode') === 'auto';
  const overlap = area?.own.overlap ?? (all.overlap?.stored ? all.overlap.value : undefined);
  const spacingCm = typeof overlap === 'number' ? blade * (1 - overlap) * 100 : toolWidth !== undefined ? toolWidth * 100 : null;
  const passes = effective('perimeter_passes');
  const autoPasses = all.perimeter_passes?.auto_value;
  const passesAuto = autoPasses !== undefined && passes === autoPasses;
  // OpenMower's per area counts below 0 are its "the global one"
  const omCount = (k: 'outline_count' | 'outline_overlap_count') => {
    const v = area?.openmower?.[k];
    return typeof v === 'number' && v >= 0 ? v : undefined;
  };
  const passesShown = area && area.own.perimeter_passes === undefined ? (omCount('outline_count') ?? global('perimeter_passes')) : passes;
  // the outline passes the lanes reach into: the area's own, OpenMower's of the area, the one for all areas
  const overlapOwn = area ? area.own.lane_overlap_passes : global('lane_overlap_passes');
  const overlapElse = area ? (omCount('outline_overlap_count') ?? global('lane_overlap_passes')) : all.lane_overlap_passes?.default;
  const reach = typeof overlapOwn === 'number' ? overlapOwn : typeof overlapElse === 'number' ? overlapElse : 0;
  // the angle turned further after finished mows: by this step every nth mow (an area's own step: its mowing settings)
  const step = typeof global('angle_increment') === 'number' ? (global('angle_increment') as number) : 0;
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
  // with the mower's sizes the planner checks its body, the lines are where its middle drove (collision mode): what the
  // lines stand for doesn't matter any more then
  const sized = ['robot_width', 'robot_front', 'robot_rear'].every((k) => (num(k) ?? -1) > 0);
  const collision = has('edge_margin') && sized;
  // how far in from the lines the blade's edge stays on the first outline pass, for the note on the lines
  const first = num('perimeter_offset') ?? 0.5 * blade;
  const width = num('robot_width');
  const strip =
    effective('edges') !== 'hard'
      ? first - 0.5 * blade
      : width === undefined
        ? undefined
        : Math.max(first, 0.5 * width - Math.abs(num('blade_offset') ?? 0)) - 0.5 * blade;
  const spot = effective('turn_on_spot') === true;
  const own = area ? ownSettings(area.own, area.openmower ?? {}, all, collision) : [];

  // for all areas, at a glance
  const summary = area
    ? null
    : [
        tr(PATTERN_LABELS[String(global('fill_pattern'))] ?? String(global('fill_pattern') ?? '')),
        auto ? tr('spacing automatic') : spacingCm !== null ? tr('{cm} cm apart', {cm: Math.round(spacingCm * 10) / 10}) : null,
        typeof passes === 'number' ? (passesAuto ? tr('outline passes automatic') : tr('{n} outline passes', {n: passes})) : null,
        has('edge_margin') ? tr('{cm} cm off the edge', {cm: cm(global('edge_margin'))}) : null,
        has('body_fit') ? (global('body_fit') ? tr('collision check on') : tr('collision check off')) : null,
      ].filter(Boolean);

  return (
    <div className={local.simple}>
      {area ? (
        <div className={local.summary}>
          <p className={local.line}>{tr('Only for this area. Saved with the map ("Save map"), the preview shows it right away.')}</p>
          {own.length ? (
            <>
              <p className={local.line}>
                {tr('This area sets itself:')}{' '}
                {own.map((o, i) => (
                  <span key={o.key} className={o.idle ? local.idle : undefined}>
                    {i > 0 && ' · '}
                    {o.label}: {o.value}
                    {o.idle && ` (${o.idle})`}
                  </span>
                ))}
              </p>
              {area.clear && (
                <div className={local.inline}>
                  <button onClick={area.clear}>{tr('All like all areas')}</button>
                </div>
              )}
            </>
          ) : (
            <p className={local.line}>{tr('Everything like all areas.')}</p>
          )}
        </div>
      ) : (
        <div className={local.summary}>
          {summary && summary.length > 0 && <p className={local.line}>{summary.join(' · ')}</p>}
          <p className={local.line}>
            {tr('For all areas, each change is saved on the mower right away.')}
            {state.saved && <strong className={local.saved}> ✓ {tr('saved')}</strong>}
          </p>
        </div>
      )}

      <Section title={tr('Pattern')}>
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
            help={tr(
              'How far apart the lanes are. The blade mows a little wider, so neighbouring lanes overlap. Automatic: the widest spacing that still leaves nothing standing, fewer lanes and turns.',
            )}
            note={auto ? tr('As wide as nothing stays standing.') : tr('Smaller overlaps more and takes longer. Empty: the spacing set in OpenMower.')}
          >
            <div className={local.inline}>
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
              {!auto &&
                has('overlap') &&
                numberField(
                  'spacing',
                  area && area.own.overlap === undefined ? '' : spacingCm !== null ? String(Math.round(spacingCm * 10) / 10) : '',
                  spacingCm !== null ? String(Math.round(spacingCm * 10) / 10) : '',
                  'cm',
                  (text) => {
                    const v = parse(text);
                    if (v === null) return void save('overlap', undefined);
                    void save('overlap', Math.min(0.95, Math.max(0, 1 - v / 100 / blade)));
                  },
                )}
            </div>
          </Row>
        )}
        {has('headland_turns') && (
          <Row
            label={tr('Clean stripes')}
            help={tr(
              'In the field of lanes the mower only drives straight along the lanes, it turns and drives across along the outline passes. The stripes stay clean, it takes about a quarter longer.',
            )}
            note={
              effective('headland_turns')
                ? tr('Turns only along the edge, about a quarter longer. With few outline passes the edge is too narrow for loops and it turns on the spot there, more passes mean less of that.')
                : tr('Turns at the end of every lane.')
            }
          >
            {toggle('headland_turns')}
          </Row>
        )}
        {/* only with clean stripes and the mower's sizes, the planner leaves it out otherwise */}
        {has('headland_corners') && effective('headland_turns') === true && sized && (
          <Row
            label={tr('Corners along the edge')}
            help={tr('How the drives along the outline passes take their corners: in a curve, gentle on the lawn, or sharp with a turn on the spot.')}
            note={effective('headland_corners') === 'sharp' ? tr('Sharp: it turns on the spot at the corners.') : tr('Rounded: the corners are driven in a curve.')}
          >
            <Choice
              options={[
                ['rounded', tr('Rounded')],
                ['sharp', tr('Sharp')],
              ]}
              value={value('headland_corners')}
              like={like(global('headland_corners') === 'sharp' ? tr('Sharp') : tr('Rounded'))}
              disabled={state.busy}
              onChange={(v) => void save('headland_corners', v)}
            />
          </Row>
        )}
      </Section>

      <Section
        title={tr('Edge')}
        note={collision ? tr('The lines of the map are where the middle of the mower drove, the real edges are half its width further out.') : null}
      >
        {has('edges') && !collision && (
          <Row
            label={tr('Lines of the map')}
            help={tr('What the lines of your map stand for. Recorded by driving the mower around: "driven along the edge". Drawn on the screen right along a wall or a bed: "the wall itself".')}
            note={
              effective('edges') === 'hard'
                ? strip !== undefined && strip > 0.005
                  ? tr('Nothing of the mower goes past them, about {cm} cm stay standing along them.', {cm: Math.round(strip * 100)})
                  : tr('Nothing of the mower goes past them.')
                : tr('The middle of the mower drove them, the blade mows up to them.')
            }
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
        {has('perimeter_passes') && (
          <Row
            label={tr('Outline passes')}
            help={tr('How many rounds the mower drives along the edge first, before it mows the inside. They leave it room to turn at the ends of the lanes. Automatic: as many as the turns need.')}
            note={
              passesAuto
                ? area?.planned !== undefined
                  ? tr('As many as the turns need room for, here {n}.', {n: area.planned})
                  : tr('As many as the turns need room for.')
                : autoPasses !== undefined
                  ? tr('Always this many.')
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
                  tr('rounds'),
                  (text) => {
                    const n = parse(text);
                    void save('perimeter_passes', n === null ? undefined : Math.max(0, Math.round(n)));
                  },
                )}
            </div>
          </Row>
        )}
        {has('lane_overlap_passes') && effective('fill_pattern') !== 'concentric' && (
          <Row
            label={tr('Overlapping passes')}
            help={tr(
              'How many outline passes the lanes reach into: they start that many passes further out, so nothing stays standing between the passes and the lanes. Not with rings.',
            )}
            note={
              reach === 0
                ? tr('The lanes start after the last outline pass.')
                : reach === 1
                  ? tr('The lanes reach 1 pass further out.')
                  : tr('The lanes reach {n} passes further out.', {n: reach})
            }
          >
            {numberField(
              'overlapPasses',
              typeof overlapOwn === 'number' ? String(overlapOwn) : '',
              typeof overlapElse === 'number' ? String(overlapElse) : '0',
              tr('rounds'),
              (text) => {
                const n = parse(text);
                void save('lane_overlap_passes', n === null ? undefined : Math.max(0, Math.round(n)));
              },
            )}
          </Row>
        )}
        {has('edge_margin') && (
          <Row
            label={tr('Distance to the edge')}
            help={tr('How far the mower keeps its whole body off the real edge, everywhere. More is safer along walls and beds, less mows closer.')}
            note={tr('The body keeps this far off the real edge.')}
          >
            {cmField('edge_margin')}
          </Row>
        )}
      </Section>

      {has('obstacle_margin') && (
        <Section title={tr('Obstacles')}>
          <Row
            label={tr('Distance to obstacles')}
            help={tr('How far the mower keeps its body off obstacles, areas not mowed and inactive ones. An obstacle can have its own distance, in the editor under the obstacle.')}
            note={tr('Each obstacle can have its own, in the editor.')}
          >
            {cmField('obstacle_margin')}
          </Row>
        </Section>
      )}

      {(has('turn_on_spot') || has('min_turn_radius') || has('body_fit') || has('spin_margin') || (has('allow_reverse') && planner.can_back_up === true)) && (
        <Section title={tr('Turns')}>
          {has('turn_on_spot') && (
            <Row
              label={tr('Turning')}
              help={tr(
                'Where a plain curve doesn’t fit (at the end of a lane, on the way into one), the mower drives a loop, gentle on the lawn, or turns on the spot, about 14 % quicker but the wheels may scuff the lawn. Curves that fit stay curves.',
              )}
              note={spot ? tr('On the spot: quicker, harder on the lawn.') : tr('In a loop: gentle on the lawn.')}
            >
              {either('turn_on_spot', tr('In a loop'), tr('On the spot'))}
            </Row>
          )}
          {has('spin_margin') && (
            <Row
              label={tr('Extra distance when turning')}
              help={tr(
                'Where the mower turns on the spot, and on the last bit before, its body keeps this much more distance to the edge and to obstacles: it often wanders a little while turning.',
              )}
              note={tr('On top of the distances to the edge and to obstacles.')}
            >
              {cmField('spin_margin')}
            </Row>
          )}
          {has('min_turn_radius') && (
            <Row
              label={tr('Tightest curve')}
              help={tr(
                "Turns, loops and drives aren't tighter than this. Where no curve this wide fits, a kink in a tight spot is rounded tighter instead of turning on the spot. The tighter a curve, the slower the inner wheel turns, at the tightest it stands still or turns backwards and tears the lawn. At half the distance between the drive wheels the inner wheel just stands still: take a little more.",
              )}
              note={tr('Larger is gentler on the lawn, needs more room at the edge.')}
            >
              {numberField(
                'least',
                area && area.own.min_turn_radius === undefined ? '' : cm(value('min_turn_radius')),
                cm(global('min_turn_radius')),
                'cm',
                (text) => {
                  const v = parse(text);
                  void save('min_turn_radius', v === null ? undefined : Math.max(0, v / 100));
                },
              )}
            </Row>
          )}
          {has('allow_reverse') && planner.can_back_up === true && (
            <Row
              label={tr('Back up where needed')}
              help={tr('Possible because OpenMower on this mower backs up along the plan. Where no turn fits going forwards (a tight corner), the mower backs up briefly instead of turning on the spot.')}
              note={effective('allow_reverse') ? tr('A three-point turn in tight corners.') : tr('Turns on the spot in tight corners.')}
            >
              {toggle('allow_reverse')}
            </Row>
          )}
          {has('body_fit') && (
            <Row
              label={tr('Collision check')}
              help={tr(
                'Every plan is checked against the mower’s body. Where it would stick out past a real edge or into an obstacle (a turn, a loop in a tight spot), the mower drives there another way and leaves a little out where nothing fits. The places show on the map with the plan. Off: the plan as it comes, the distances still count.',
              )}
              note={effective('body_fit') === false ? tr('Off: the plan stays as it comes.') : tr('Where the body would stick out, it drives another way.')}
            >
              {toggle('body_fit')}
            </Row>
          )}
        </Section>
      )}

      {/* an area's own step is with its angle, in its mowing settings */}
      {!area && has('angle_increment') && (
        <Section title={tr('Mowing direction')}>
          <Row
            label={tr('Turn further')}
            help={tr(
              "So the wheels don't wear tracks into the lawn: after finished mowing runs the lanes run a little turned each time. Within an area's angle range they swing back and forth between its ends, without one they go round all 180°.",
            )}
            note={
              !step
                ? tr('Off: the lanes run the same way every time.')
                : steps > 0
                  ? tr('So far {steps} times, {deg}° in all.', {steps, deg: degrees(steps * step)})
                  : tr('Not turned yet.')
            }
          >
            <div className={local.inline}>
              {numberField('turn', String(degrees(step)), '0', '°', (text) => {
                const d = parse(text);
                void save('angle_increment', d === null ? 0 : Math.min(180, Math.max(0, d)) * DEG);
              })}
              {has('angle_increment_every') && (
                <>
                  <span className={local.word}>{tr('each time after')}</span>
                  {numberField('every', String(every), '1', every === 1 ? tr('mowing run') : tr('mowing runs'), (text) => {
                    const n = parse(text);
                    void save('angle_increment_every', n === null ? undefined : Math.max(1, Math.round(n)));
                  })}
                </>
              )}
              {steps + mows > 0 && (
                <button disabled={state.busy} onClick={() => void resetAngle()}>
                  {tr('back to 0°')}
                </button>
              )}
            </div>
            {!!omIncrement && (
              <span className={local.error}>
                {tr('OpenMower turns the angle further as well (mow_angle_increment {deg}°), the two add up. Set it to 0 in mower_params.yaml.', {
                  deg: omIncrement,
                })}
              </span>
            )}
          </Row>
        </Section>
      )}

      {state.error && <span className={local.error}>{state.error}</span>}
    </div>
  );
}
