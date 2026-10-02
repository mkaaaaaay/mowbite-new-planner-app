'use client';

import {PlannerDecides, PlannerField, turnRadiusWarning} from '@/components/PlannerSettings';
import {tr} from '@/lib/i18n';
import {usePlannerSettings} from '@/lib/mowerBody';
import {FIELDS, fromInput, toInput} from '@/lib/plannerFields';
import {useState} from 'react';
import type {AreaProperties, UpdateArea} from './editing';
import local from './AreaPlanner.module.css';
import styles from './page.module.css';

// MowBite Planner settings for the selected area only (its planner property), on top of the ones for all areas.
// Only with the MowBite Planner on the mower, the plan preview shows them right away.

const AREA_KEYS = Object.keys(FIELDS).filter((k) => FIELDS[k].area);

export function AreaPlanner({
  properties,
  update,
  remember,
}: {
  properties: AreaProperties;
  update: UpdateArea;
  remember: () => void;
}) {
  const settings = usePlannerSettings();
  // numbers as typed, until the field is left
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  if (!settings) return null;
  const all = settings.settings;
  const keys = AREA_KEYS.filter((k) => all[k]?.settable);
  if (!keys.length) return null;
  const own = properties.planner ?? {};

  const set = (key: string, value: unknown, undoable: boolean) => {
    const next = {...own};
    if (value === undefined || value === null || value === '') delete next[key];
    else next[key] = value;
    update({planner: Object.keys(next).length ? next : undefined}, undoable);
  };
  const globalText = (key: string) => {
    const v = all[key].value;
    const field = FIELDS[key];
    if (typeof v === 'string') return tr(field?.choices?.[v] ?? v);
    return toInput(field, v) || tr('none');
  };

  return (
    <div className={styles.mowSettings} onBlurCapture={() => setDrafts({})} onFocusCapture={remember}>
      <span className={styles.cardTitle}>{tr('Planner for this area')}</span>
      <p className={local.note}>
        {tr('Empty or "like all areas": the setting for all areas (Settings, Planner). Counts from the next plan.')}
      </p>
      <PlannerDecides
        settings={all}
        styles={styles}
        on={own.lane_spacing_mode === 'auto' && own.perimeter_passes === all.perimeter_passes?.auto_value}
        onChange={(on) => {
          const next = {...own};
          if (on) Object.assign(next, {lane_spacing_mode: 'auto', perimeter_passes: all.perimeter_passes.auto_value});
          else {
            delete next.lane_spacing_mode;
            delete next.perimeter_passes;
          }
          update({planner: Object.keys(next).length ? next : undefined}, true);
        }}
      />
      {keys.map((key) => {
        const setting = all[key];
        const value = own[key];
        const isChoice = setting.type === 'string' && !!setting.choices?.length;
        return (
          <div key={key} className={isChoice ? local.wide : undefined}>
            <PlannerField
              name={key}
              setting={setting}
              styles={local}
              value={isChoice ? (typeof value === 'string' ? value : '') : (drafts[key] ?? toInput(FIELDS[key], value))}
              globalLabel={isChoice ? tr('like all areas ({value})', {value: globalText(key)}) : undefined}
              warning={key === 'turn_radius' ? turnRadiusWarning(all, value) : null}
              placeholder={tr('all areas: {value}', {value: globalText(key)})}
              onChange={(v) => {
                if (isChoice) return set(key, v, true);
                const text = String(v);
                setDrafts({...drafts, [key]: text});
                const n = fromInput(FIELDS[key], text);
                if (n !== 'invalid') set(key, n, false);
              }}
            />
          </div>
        );
      })}
      {typeof own.angle_strategy === 'string' && (
        <p className={local.note}>
          {tr("With a direction worked out by the planner, this area's mow angle doesn't count.")}
        </p>
      )}
    </div>
  );
}
