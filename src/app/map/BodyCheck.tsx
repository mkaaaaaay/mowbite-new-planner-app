'use client';

import type {PlanRequest} from '@/lib/areaPlan';
import {tr} from '@/lib/i18n';
import {checkBody, spotPlaces, usePlannerSettings, type BodyCheck as Result, type BodySpot} from '@/lib/mowerBody';
import {RpcError} from '@/lib/rpc';
import {useEffect, useMemo, useState} from 'react';
import styles from './page.module.css';

const KINDS: Record<string, string> = {
  turn: 'turn between lanes',
  spin: 'turning on the spot',
  lane_end: 'end of a lane',
  loop: 'corner of a loop',
  transit: 'drive between parts',
};

// The plan of the selected area checked against the mower's body by the MowBite Planner: where the body would stick
// out further than the map allows, one body drawn on the map for each place. Asked on demand, the check takes a few
// seconds on the mower. Only for the plan it was asked for: anything changed (the angle, a point) and it's gone.
export function BodyCheck({request, onSpots}: {request: PlanRequest | null; onSpots: (spots: BodySpot[] | null) => void}) {
  const [state, setState] = useState<{key: string; busy?: boolean; result?: Result | null; error?: string} | null>(null);
  const recorded = usePlannerSettings()?.settings.edges?.value !== 'hard';
  const key = request ? JSON.stringify(request) : '';
  // an older answer doesn't fit what's edited now
  const current = state?.key === key ? state : null;
  const places = useMemo(() => spotPlaces(current?.result?.spots ?? []), [current]);

  // the map shows the places of the answer that fits, none otherwise
  useEffect(() => onSpots(places.length ? places.map((p) => p.spot) : null), [places, onSpots]);
  // no plan from the mower right now (it's being worked out for a change), another area: its places go too
  useEffect(() => () => onSpots(null), [onSpots]);

  if (!request) return null;

  const run = async () => {
    setState({key, busy: true});
    try {
      setState({key, result: await checkBody(request)});
    } catch (e) {
      setState({key, error: e instanceof RpcError && e.code !== 'timeout' ? e.message : tr('The mower did not answer.')});
    }
  };

  const kinds = [...new Set(places.flatMap((p) => p.kinds))].map((k) => tr(KINDS[k] ?? k));
  return (
    <div className={styles.bodyCheck}>
      <button className={styles.pillButton} onClick={run} disabled={current?.busy}>
        {current?.busy ? tr('Checking…') : tr('Check against the mower body')}
      </button>
      {current?.result === null && <span className={styles.dim}>{tr('Only with the MowBite Planner on the mower.')}</span>}
      {current?.result &&
        (places.length ? (
          <span className={styles.warningText}>
            {tr('{n} spots where the body would stick out', {n: places.length})}
            {kinds.length > 0 && `: ${kinds.join(', ')}`}
          </span>
        ) : (
          <span className={styles.dim}>{tr('The body fits everywhere.')}</span>
        ))}
      {current?.error && <span className={styles.warningText}>{current.error}</span>}
      {recorded && places.some((p) => p.kinds.includes('loop')) && (
        <span className={styles.dim}>
          {tr(
            'Corners of the outline passes on lines driven along the edge: the check takes the wall to be half the width beyond the line everywhere, the mower drove there itself when recording. An outline offset for the area moves the passes in.',
          )}
        </span>
      )}
    </div>
  );
}
