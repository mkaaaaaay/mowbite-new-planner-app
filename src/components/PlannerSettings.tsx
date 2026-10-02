'use client';

import {tr} from '@/lib/i18n';
import {loadPlannerSettings, savePlannerSettings, usePlannerSettings, type PlannerSetting} from '@/lib/mowerBody';
import {BODY_KEYS, COUNTED, DROPPED, DROPPED_CHOICES, FIELDS, fromInput, GROUPS, toInput, type Field, type Group} from '@/lib/plannerFields';
import {RpcError} from '@/lib/rpc';
import {useEffect, useState} from 'react';
import InfoTip from './InfoTip';
import local from './PlannerSettings.module.css';

// The MowBite Planner's settings for all areas (planner.settings / planner.settings.set). Built from what the planner
// reports, so a newer planner's settings show up too. An area can set some of them for itself (mowing settings).

type Styles = Record<string, string>;
type Value = string | string[];

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function formFrom(settings: Record<string, PlannerSetting>): Record<string, Value> {
  const out: Record<string, Value> = {};
  for (const [key, s] of Object.entries(settings)) {
    if (s.type === 'list') out[key] = Array.isArray(s.value) ? (s.value as string[]) : [];
    else if (s.type === 'string') out[key] = String(s.value ?? '');
    else if (s.type === 'boolean') out[key] = s.value ? 'true' : 'false';
    // (one from mower_logic shows as its placeholder, it's not set here)
    else out[key] = s.from && !s.stored ? '' : toInput(FIELDS[key], s.value);
  }
  return out;
}

// one setting as typed in, null: back to the default, undefined: unchanged or not valid (error set)
function change(key: string, s: PlannerSetting, value: Value): {value?: unknown; error?: string} {
  const field = FIELDS[key];
  if (s.type === 'list') return same(value, s.value) ? {} : {value: same(value, s.default) && s.stored ? null : value};
  if (s.type === 'string' || s.type === 'boolean') {
    const v = s.type === 'boolean' ? value === 'true' : value;
    return v === s.value ? {} : {value: v === s.default && s.stored ? null : v};
  }
  const v = fromInput(field, value as string);
  if (v === 'invalid') return {error: tr('{what} is not a number.', {what: tr(field?.label ?? key)})};
  if (v === null) return s.stored ? {value: null} : {};
  return typeof s.value === 'number' && Math.abs(s.value - v) < 1e-9 && s.stored ? {} : {value: v};
}

export function PlannerField({
  name,
  setting,
  value,
  onChange,
  styles,
  placeholder,
  globalLabel,
  unavailable,
  warning,
}: {
  name: string;
  setting: PlannerSetting;
  value: Value;
  onChange: (v: Value) => void;
  styles: Styles;
  // for a number left empty
  placeholder?: string;
  // a choice field per area: the extra choice "as set for all areas"
  globalLabel?: string;
  // why it can't be used on this mower: shown greyed out with this under it
  unavailable?: string | null;
  // what's off about the value set, shown under it
  warning?: string | null;
}) {
  const field: Field | undefined = FIELDS[name];
  const label = (
    <span className={local.label}>
      {tr(field?.label ?? name)}
      {field?.unit === 'deg' ? ' (°)' : field?.unit === 'm' ? ' (m)' : ''}
      {field?.help && <InfoTip>{tr(field.help)}</InfoTip>}
    </span>
  );
  const choices = (setting.choices ?? []).filter((c) => !DROPPED_CHOICES[name]?.includes(c));
  if (setting.type === 'list') {
    const on = Array.isArray(value) ? value : [];
    return (
      <div className={local.wide}>
        {label}
        <div className={local.checks}>
          {choices.map((c) => (
            <label key={c} className={styles.check}>
              <input
                type="checkbox"
                checked={on.includes(c)}
                // in the planner's order of preference
                onChange={(e) => onChange(choices.filter((k) => (k === c ? e.target.checked : on.includes(k))))}
              />
              {tr(field?.choices?.[c] ?? c)}
            </label>
          ))}
        </div>
      </div>
    );
  }
  if (setting.type === 'string' && choices.length) {
    return (
      <div className={local.wide}>
        {label}
        <div className={styles.segment}>
          {globalLabel !== undefined && (
            <button className={value === '' ? styles.segmentOn : undefined} disabled={!!unavailable} onClick={() => onChange('')}>
              {globalLabel}
            </button>
          )}
          {choices.map((c) => (
            <button key={c} className={value === c ? styles.segmentOn : undefined} disabled={!!unavailable} onClick={() => onChange(c)}>
              {tr(field?.choices?.[c] ?? c)}
            </button>
          ))}
        </div>
        {unavailable && <p className={styles.dim}>{unavailable}</p>}
      </div>
    );
  }
  if (setting.type === 'boolean') {
    const check = (
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={value === 'true'}
          disabled={!!unavailable}
          onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
        />
        {label}
      </label>
    );
    return unavailable ? (
      <div>
        {check}
        <p className={styles.dim}>{unavailable}</p>
      </div>
    ) : (
      check
    );
  }
  // a number the planner can work out itself (perimeter_passes -1): a button for that next to it
  const auto = setting.auto_value !== undefined ? String(setting.auto_value) : null;
  const isAuto = auto !== null && value === auto;
  const fromText =
    setting.from && !setting.stored && toInput(field, setting.value) ? tr('OpenMower: {value}', {value: toInput(field, setting.value)}) : null;
  const input = (
    <input
      inputMode="decimal"
      value={isAuto ? '' : (value as string)}
      step={field?.step}
      placeholder={isAuto ? tr('automatic') : (placeholder ?? fromText ?? (toInput(field, setting.default) || tr('none')))}
      onChange={(e) => onChange(e.target.value)}
    />
  );
  return (
    <label className={styles.field}>
      {label}
      {auto === null ? (
        input
      ) : (
        <span className={local.withAuto}>
          {input}
          <button
            type="button"
            className={isAuto ? local.autoOn : undefined}
            onClick={(e) => {
              e.preventDefault();
              onChange(isAuto ? '' : auto);
            }}
          >
            {tr('Auto')}
          </button>
        </span>
      )}
      {warning && <span className={styles.error}>{warning}</span>}
    </label>
  );
}

// a turn radius under min_turn_radius: the planner takes min_turn_radius then, null when it's fine
export function turnRadiusWarning(all: Record<string, PlannerSetting>, radius: unknown): string | null {
  const least = all.min_turn_radius?.value;
  const r = typeof radius === 'number' ? radius : all.turn_radius?.value;
  if (typeof least !== 'number' || least <= 0 || typeof r !== 'number' || r >= least - 1e-9) return null;
  return tr('Tighter than the tightest curve radius ({min} m): the planner takes {min} m.', {min: toInput(FIELDS.turn_radius, least)});
}

export function PlannerSettings({styles}: {styles: Styles}) {
  const settings = usePlannerSettings();
  // only what was changed here, the rest shows what the planner has
  const [form, setForm] = useState<Record<string, Value>>({});
  const [state, setState] = useState<{busy?: boolean; error?: string; saved?: boolean}>({});

  useEffect(() => {
    loadPlannerSettings(true).catch(() => {});
  }, []);

  if (settings === null) {
    return (
      <section className={styles.card}>
        <h2>{tr('Planner')}</h2>
        <p className={styles.dim}>{tr('Only with the MowBite Planner on the mower (OM_PLANNER=mowbite).')}</p>
      </section>
    );
  }
  if (!settings) return null;

  const all = settings.settings;
  const shown = {...formFrom(all), ...form};
  const keys = Object.keys(all).filter((k) => !BODY_KEYS.includes(k) && !DROPPED.includes(k) && all[k].settable);
  const fixed = Object.keys(all).filter((k) => !all[k].settable && !COUNTED.includes(k));
  const group = (k: string): Group => FIELDS[k]?.group ?? 'fine';
  const advanced = (k: string) => !FIELDS[k] || !!FIELDS[k].advanced;

  const changes = () => {
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      if (form[k] === undefined) continue;
      const c = change(k, all[k], form[k]);
      if (c.error) return {error: c.error};
      if ('value' in c) out[k] = c.value;
    }
    return {out};
  };
  const pending = changes();
  const dirty = !!pending.out && Object.keys(pending.out).length > 0;

  const save = async () => {
    if (pending.error || !pending.out) return setState({error: pending.error});
    setState({busy: true});
    try {
      await savePlannerSettings(pending.out);
      setForm({});
      setState({saved: true});
    } catch (e) {
      setState({error: e instanceof RpcError && e.code !== 'timeout' ? e.message : tr('The mower did not answer.')});
    }
  };
  const reset = async () => {
    const stored = keys.filter((k) => all[k].stored);
    if (!stored.length) return;
    setState({busy: true});
    try {
      await savePlannerSettings(Object.fromEntries(stored.map((k) => [k, null])));
      setForm({});
      setState({saved: true});
    } catch (e) {
      setState({error: e instanceof RpcError && e.code !== 'timeout' ? e.message : tr('The mower did not answer.')});
    }
  };

  // choices and lists take the whole row
  const wide = (k: string) => all[k].type === 'list' || (all[k].type === 'string' && !!all[k].choices?.length);
  // backing up needs OpenMower's controller to back up where the plan does, the planner leaves it out otherwise
  const unavailable = (k: string) =>
    k === 'allow_reverse' && settings.can_back_up !== true
      ? tr("This mower's OpenMower doesn't back up along the plan yet (back_up_with_plan), the planner leaves it out.")
      : null;
  // a number as typed, the planner's value while it's empty or not a number
  const typed = (k: string) => {
    const v = fromInput(FIELDS[k], String(shown[k] ?? ''));
    return typeof v === 'number' ? v : undefined;
  };
  const field = (k: string) => (
    <div key={k} className={[wide(k) ? local.wide : '', all[k].stored ? local.changed : ''].filter(Boolean).join(' ') || undefined}>
      <PlannerField
        name={k}
        setting={all[k]}
        value={shown[k] ?? ''}
        styles={styles}
        unavailable={unavailable(k)}
        warning={k === 'turn_radius' ? turnRadiusWarning(all, typed(k)) : null}
        onChange={(v) => {
          setForm({...form, [k]: v});
          setState({});
        }}
      />
    </div>
  );

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2>{tr('Planner')}</h2>
        <button className={styles.pillButton} onClick={reset} disabled={state.busy || !keys.some((k) => all[k].stored)}>
          {tr('Reset all')}
        </button>
      </div>
      <p className={styles.dim}>
        {tr(
          "How the MowBite Planner on the mower plans every area. An area can set some of them for itself in its mowing settings. Lane spacing, outline passes and offset come from OpenMower's mowing settings.",
        )}
      </p>
      {settings.own_angle && (
        <p className={styles.error}>
          {tr("A direction is set here: it wins over the areas' mow angle, but for areas with an angle of their own.")}
        </p>
      )}
      {GROUPS.map((g) => {
        const main = keys.filter((k) => group(k) === g.key && !advanced(k));
        if (!main.length) return null;
        return (
          <div key={g.key} className={local.group}>
            <h3>{tr(g.label)}</h3>
            <div className={local.grid}>{main.map(field)}</div>
          </div>
        );
      })}
      <details className={local.more}>
        <summary>{tr('More settings')}</summary>
        {GROUPS.map((g) => {
          const more = keys.filter((k) => group(k) === g.key && advanced(k));
          if (!more.length) return null;
          return (
            <div key={g.key} className={local.group}>
              <h3>{tr(g.label)}</h3>
              <div className={local.grid}>{more.map(field)}</div>
            </div>
          );
        })}
        {fixed.length > 0 && (
          <p className={styles.dim}>
            {tr('Set by OpenMower with every plan, not here: {which}.', {which: fixed.join(', ')})}
          </p>
        )}
      </details>
      <div className={local.actions}>
        <button className={styles.pillButton} onClick={save} disabled={state.busy || !dirty}>
          {state.busy ? tr('Saving…') : tr('Save')}
        </button>
        {state.saved && !dirty && <span className={styles.dim}>{tr('Saved. It counts from the next plan, an interrupted area starts again.')}</span>}
        {(state.error || pending.error) && <span className={styles.error}>{state.error ?? pending.error}</span>}
      </div>
    </section>
  );
}
