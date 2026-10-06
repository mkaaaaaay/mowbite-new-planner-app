'use client';

import {tr} from '@/lib/i18n';
import {
  BODY_SETTINGS,
  bodyFrom,
  loadPlannerSettings,
  modelOf,
  MOWER_MODELS,
  measuredOutline,
  OUTLINE_LEEWAY,
  grownOutline,
  outlineOf,
  savePlannerSettings,
  usePlannerSettings,
  type BodySetting,
  type MowerBody,
  type MowerSizes,
  type Outline,
} from '@/lib/mowerBody';
import {RpcError} from '@/lib/rpc';
import {useEffect, useState} from 'react';
import local from './MowerBodySettings.module.css';

// The mower's sizes for the MowBite Planner on the mower (planner.settings): it keeps the body clear of the edges in
// turns and corners and draws the mower at its real size on the map. Kept by the planner, so every app and the
// planner itself use the same ones.

const LABELS: Record<BodySetting, string> = {
  robot_width: 'Width',
  robot_front: 'Rear axle to the front',
  robot_rear: 'Rear axle to the back',
  mower_width: 'Blade diameter',
  blade_ahead: 'Blade ahead of the rear axle',
  blade_offset: 'Blade to the left of the middle',
  body_tolerance: 'Leeway past the edges',
  // tighter, the inner wheel stands or turns backwards and scuffs the lawn: it turns on the spot there instead
  min_turn_radius: 'Tightest curve radius',
};

type Styles = Record<string, string>;
type Form = Record<BodySetting, string>;

const cm = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? String(Math.round(v * 1000) / 10) : '');

function formFrom(settings: Record<string, {value: unknown}> | undefined): Form {
  const f = {} as Form;
  for (const key of BODY_SETTINGS) f[key] = cm(settings?.[key]?.value);
  return f;
}

// the planner's names for a model's sizes
const MODEL_FIELDS = [
  ['robot_width', 'width'],
  ['robot_front', 'front'],
  ['robot_rear', 'rear'],
  ['mower_width', 'blade'],
  ['blade_ahead', 'bladeAhead'],
  ['blade_offset', 'bladeOffset'],
] as const;

const sizesOf = (f: Form): MowerSizes =>
  Object.fromEntries(
    MODEL_FIELDS.map(([key, size]) => {
      const v = parseFloat(f[key].replace(',', '.'));
      return [size, Number.isFinite(v) ? v / 100 : undefined];
    }),
  );

// the mower from above, heading right, to scale: body, blade, the point it follows
function Sketch({body}: {body: MowerBody}) {
  const pad = 0.12;
  // more room on the left, the width is written there
  const left = pad + 0.06;
  const halfW = Math.max(body.width / 2, body.blade / 2 + Math.abs(body.bladeOffset));
  const x0 = -body.rear - left;
  const w = body.front + body.rear + pad + left;
  const h = 2 * halfW + 2 * pad;
  const label = (v: number) => `${Math.round(v * 100)} cm`;
  return (
    <svg className={local.sketch} viewBox={`${x0} ${-halfW - pad} ${w} ${h}`} role="img" aria-label={tr('The mower from above')}>
      {/* y flipped: left of the mower is up */}
      <g transform="scale(1 -1)">
        {body.outline ? (
          <polygon className={local.body} points={body.outline.map(([ahead, left]) => `${ahead},${left}`).join(' ')} />
        ) : (
          <rect className={local.body} x={-body.rear} y={-body.width / 2} width={body.front + body.rear} height={body.width} rx={0.03} />
        )}
        {body.blade > 0 && <circle className={local.blade} cx={body.bladeAhead} cy={body.bladeOffset} r={body.blade / 2} />}
        <line className={local.axle} x1={0} y1={-body.width / 2} x2={0} y2={body.width / 2} />
        <circle className={local.point} cx={0} cy={0} r={0.015} />
        <path className={local.heading} d={`M ${body.front - 0.09} 0 l -0.05 0.035 m 0.05 -0.035 l -0.05 -0.035`} />
      </g>
      <text className={local.text} x={body.front / 2} y={-body.width / 2 - 0.03} textAnchor="middle">
        {label(body.front)}
      </text>
      <text className={local.text} x={-body.rear / 2} y={-body.width / 2 - 0.03} textAnchor="middle">
        {label(body.rear)}
      </text>
      <text className={local.text} x={-body.rear - 0.02} y={0.015} textAnchor="end">
        {label(body.width)}
      </text>
    </svg>
  );
}

export function MowerBodySettings({styles}: {styles: Styles}) {
  const settings = usePlannerSettings();
  const [form, setForm] = useState<Form>(() => formFrom(settings?.settings));
  const [state, setState] = useState<{busy?: boolean; error?: string; saved?: boolean; offline?: boolean; picked?: boolean}>({});
  // "other mower" picked while the fields still hold a model's sizes
  const [other, setOther] = useState(false);
  // the body's real contour (robot_outline), from a model; typed sizes go back to the rectangle
  // the measured one, the planner has it 1 cm larger
  const [outline, setOutline] = useState<Outline | null>(() => measuredOutline(outlineOf(settings?.settings.robot_outline?.value)) ?? null);

  useEffect(() => {
    loadPlannerSettings(true).then(
      (s) => {
        setForm(formFrom(s?.settings));
        setOutline(measuredOutline(outlineOf(s?.settings.robot_outline?.value)) ?? null);
      },
      () => setState({offline: true}),
    );
  }, []);

  if (settings === null) {
    return (
      <section className={styles.card}>
        <h2>{tr('Mower sizes')}</h2>
        <p className={styles.dim}>
          {tr(
            'Only with the MowBite Planner on the mower (OM_PLANNER=mowbite): it keeps the body clear of the edges and the map shows the mower at its real size. With the slic3r planner the map shows the icon as before.',
          )}
        </p>
      </section>
    );
  }

  const known = settings?.settings ?? {};
  // a planner that checks the body in every plan (it has edge_margin) keeps distances of its own, body_tolerance isn't
  // a leeway past the edges there. The tightest curve is in the planner menu (Tightest curve)
  const keys = BODY_SETTINGS.filter((k) => !(k === 'body_tolerance' && known.edge_margin) && k !== 'min_turn_radius');
  // what the form would make of it: the sketch follows the fields while typing
  const metres = (key: BodySetting) => {
    const v = parseFloat(form[key].replace(',', '.'));
    return Number.isFinite(v) ? v / 100 : null;
  };
  const rect = bodyFrom({
    settings: Object.fromEntries(BODY_SETTINGS.map((k) => [k, {value: metres(k)} as never])),
  });
  const sketch = rect && outline ? {...rect, outline} : rect;
  // the model whose outline it is, named so a wrong pick shows
  const outlineModel = outline ? MOWER_MODELS.find((m) => m.outline && JSON.stringify(m.outline) === JSON.stringify(outline)) : undefined;
  const missing = keys.filter((k) => !known[k]);
  const model = other ? '' : (modelOf(sizesOf(form)) ?? '');
  // a model with a measured outline, while the rectangle is still in use: offered, not put in on its own
  const offered = !outline ? MOWER_MODELS.find((m) => m.key === model && m.outline) : undefined;
  // a planner from before the body check takes robot_width as "the lines are walls": its centre then keeps half the
  // width off them all the way round, so the width only goes to one that knows the rest too
  const usable = (key: BodySetting) => !!known[key] && (key !== 'robot_width' || (!!known.robot_front && !!known.edges));

  const save = async () => {
    const changes: Record<string, unknown> = {};
    for (const key of keys) {
      const s = known[key];
      if (!s || !usable(key)) continue;
      const text = form[key].trim();
      if (!text) {
        if (s.stored) changes[key] = null; // back to the default
        continue;
      }
      const v = metres(key);
      if (v === null) {
        setState({error: tr('{what} is not a number.', {what: tr(LABELS[key])})});
        return;
      }
      if (!s.stored || typeof s.value !== 'number' || Math.abs(s.value - v) > 1e-6) changes[key] = Math.round(v * 10000) / 10000;
    }
    // the contour only to a planner that knows it, null is the rectangle again
    const send = outline ? grownOutline(outline, OUTLINE_LEEWAY) : null;
    if (known.robot_outline && JSON.stringify(outlineOf(known.robot_outline.value) ?? null) !== JSON.stringify(send)) {
      changes.robot_outline = send;
    }
    if (!Object.keys(changes).length) {
      setState({saved: true});
      return;
    }
    setState({busy: true});
    try {
      const s = await savePlannerSettings(changes);
      setForm(formFrom(s.settings));
      setOutline(measuredOutline(outlineOf(s.settings.robot_outline?.value)) ?? null);
      setState({saved: true});
    } catch (e) {
      setState({error: e instanceof RpcError && e.code !== 'timeout' ? e.message : tr('The mower did not answer.')});
    }
  };

  const set = (key: keyof Form, value: string) => {
    setForm({...form, [key]: value});
    if (key === 'robot_width' || key === 'robot_front' || key === 'robot_rear') setOutline(null);
    setOther(false);
    setState({});
  };

  // a model fills in its sizes, saving keeps them; the leeway and the curve radius stay
  const pick = (key: string) => {
    const m = MOWER_MODELS.find((x) => x.key === key);
    setOther(!m);
    if (!m) return;
    const next = {...form};
    for (const [field, size] of MODEL_FIELDS) next[field] = cm(m.sizes[size]);
    setForm(next);
    setOutline(m.outline ?? null);
    setState({picked: true});
  };

  return (
    <section className={styles.card}>
      <h2>{tr('Mower sizes')}</h2>
      <p className={styles.dim}>
        {tr(
          'Measured from the middle between the rear drive wheels, the point the mower follows. The planner keeps the body clear of the edges in turns and corners, the map shows the mower at its real size ("Real size" under Mower icon).',
        )}
      </p>
      {state.offline && settings === undefined && <span className={styles.error}>{tr('The mower did not answer.')}</span>}
      <label className={`${styles.field} ${local.model}`}>
        {tr('Model')}
        <select value={model} onChange={(e) => pick(e.target.value)}>
          <option value="">{tr('Other mower: enter the sizes below')}</option>
          {MOWER_MODELS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      {sketch && <Sketch body={sketch} />}
      {outline && (
        <p className={styles.dim}>
          {outlineModel ? tr(known.robot_outline ? 'Outline of the {model} plus 1 cm, measured on a photo from straight above. It counts for this model only.' : 'Outline of the {model}, measured on a photo from straight above. It counts for this model only, the planner on the mower checks the rectangle until it knows outlines (newer image).', {model: outlineModel.label}) : tr('A stored outline that is none of the models: pick the model again or enter the sizes.')}
        </p>
      )}
      {offered && (
        <p className={styles.dim}>
          {tr('This model has a measured outline.')}{' '}
          <button
            className={styles.linkButton}
            onClick={() => {
              setOutline(offered.outline ?? null);
              setState({picked: true});
            }}
          >
            {tr('Use it')}
          </button>
        </p>
      )}
      <div className={local.grid}>
        {keys.map((key) => (
          <label key={key} className={styles.field}>
            {tr(LABELS[key])} (cm)
            <input
              inputMode="decimal"
              value={form[key]}
              placeholder={known[key] ? cm(known[key].default) || tr('none') : ''}
              disabled={!usable(key)}
              onChange={(e) => set(key, e.target.value)}
            />
          </label>
        ))}
      </div>
      {missing.length > 0 && settings && (
        <p className={styles.error}>
          {tr('The planner on the mower is older and does not know all sizes yet ({which}), it needs a new image.', {
            which: keys.filter((k) => !usable(k))
              .map((k) => tr(LABELS[k]))
              .join(', '),
          })}
        </p>
      )}
      <div className={local.actions}>
        <button className={styles.pillButton} onClick={save} disabled={state.busy || !settings}>
          {state.busy ? tr('Saving…') : tr('Save')}
        </button>
        {state.saved && <span className={styles.dim}>{tr('Saved. It counts from the next plan, an interrupted area starts again.')}</span>}
        {state.picked && <span className={styles.dim}>{tr('Filled in, save to keep them.')}</span>}
        {state.error && <span className={styles.error}>{state.error}</span>}
      </div>
    </section>
  );
}
