'use client';

import {tr} from '@/lib/i18n';
import {
  BODY_SETTINGS,
  bodyFrom,
  loadPlannerSettings,
  savePlannerSettings,
  usePlannerSettings,
  type BodySetting,
  type MowerBody,
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

// the mower from above, heading right, to scale: body, blade, the point it follows
function Sketch({body}: {body: MowerBody}) {
  const pad = 0.12;
  const halfW = Math.max(body.width / 2, body.blade / 2 + Math.abs(body.bladeOffset));
  const x0 = -body.rear - pad;
  const w = body.front + body.rear + 2 * pad;
  const h = 2 * halfW + 2 * pad;
  const label = (v: number) => `${Math.round(v * 100)} cm`;
  return (
    <svg className={local.sketch} viewBox={`${x0} ${-halfW - pad} ${w} ${h}`} role="img" aria-label={tr('The mower from above')}>
      {/* y flipped: left of the mower is up */}
      <g transform="scale(1 -1)">
        <rect className={local.body} x={-body.rear} y={-body.width / 2} width={body.front + body.rear} height={body.width} rx={0.03} />
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
  const [state, setState] = useState<{busy?: boolean; error?: string; saved?: boolean; offline?: boolean}>({});

  useEffect(() => {
    loadPlannerSettings(true).then(
      (s) => setForm(formFrom(s?.settings)),
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
  // what the form would make of it: the sketch follows the fields while typing
  const metres = (key: BodySetting) => {
    const v = parseFloat(form[key].replace(',', '.'));
    return Number.isFinite(v) ? v / 100 : null;
  };
  const sketch = bodyFrom({
    settings: Object.fromEntries(BODY_SETTINGS.map((k) => [k, {value: metres(k)} as never])),
  });
  const missing = BODY_SETTINGS.filter((k) => !known[k]);
  // a planner from before the body check takes robot_width as "the lines are walls": its centre then keeps half the
  // width off them all the way round, so the width only goes to one that knows the rest too
  const usable = (key: BodySetting) => !!known[key] && (key !== 'robot_width' || (!!known.robot_front && !!known.edges));

  const save = async () => {
    const changes: Record<string, unknown> = {};
    for (const key of BODY_SETTINGS) {
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
    if (!Object.keys(changes).length) {
      setState({saved: true});
      return;
    }
    setState({busy: true});
    try {
      const s = await savePlannerSettings(changes);
      setForm(formFrom(s.settings));
      setState({saved: true});
    } catch (e) {
      setState({error: e instanceof RpcError && e.code !== 'timeout' ? e.message : tr('The mower did not answer.')});
    }
  };

  const set = (key: keyof Form, value: string) => {
    setForm({...form, [key]: value});
    setState({});
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
      {sketch && <Sketch body={sketch} />}
      <div className={local.grid}>
        {BODY_SETTINGS.map((key) => (
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
            which: BODY_SETTINGS.filter((k) => !usable(k))
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
        {state.error && <span className={styles.error}>{state.error}</span>}
      </div>
    </section>
  );
}
