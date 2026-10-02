'use client';

import type {PlanRequest} from '@/lib/areaPlan';
import {tr} from '@/lib/i18n';
import {checkBody, type BodyCheck as Result, type BodySpot} from '@/lib/mowerBody';
import {RpcError} from '@/lib/rpc';
import {useEffect, useState} from 'react';
import styles from './page.module.css';

const KINDS: Record<string, string> = {
  turn: 'turn between lanes',
  spin: 'turning on the spot',
  lane_end: 'end of a lane',
  loop: 'corner of a loop',
  transit: 'drive between parts',
};

// The plan of the selected area checked against the mower's body by the MowBite Planner: where the body would stick
// out further than the map allows, drawn on the map. Asked on demand, the check takes a few seconds on the mower.
export function BodyCheck({request, onSpots}: {request: PlanRequest | null; onSpots: (spots: BodySpot[] | null) => void}) {
  const [state, setState] = useState<{key: string; busy?: boolean; result?: Result | null; error?: string} | null>(null);
  const key = request ? JSON.stringify(request) : '';
  // an older answer doesn't fit what's edited now
  const current = state?.key === key ? state : null;

  useEffect(() => {
    if (state && state.key !== key) onSpots(null);
  }, [key, state, onSpots]);

  if (!request) return null;

  const run = async () => {
    setState({key, busy: true});
    onSpots(null);
    try {
      const result = await checkBody(request);
      setState({key, result});
      onSpots(result?.spots.length ? result.spots : null);
    } catch (e) {
      setState({key, error: e instanceof RpcError && e.code !== 'timeout' ? e.message : tr('The mower did not answer.')});
    }
  };

  const spots = current?.result?.spots ?? [];
  const kinds = [...new Set(spots.map((s) => s.kind))].map((k) => tr(KINDS[k] ?? k));
  return (
    <div className={styles.bodyCheck}>
      <button className={styles.pillButton} onClick={run} disabled={current?.busy}>
        {current?.busy ? tr('Checking…') : tr('Check against the mower body')}
      </button>
      {current?.result === null && <span className={styles.dim}>{tr('Only with the MowBite Planner on the mower.')}</span>}
      {current?.result &&
        (spots.length ? (
          <span className={styles.warningText}>
            {tr('{n} spots where the body would stick out', {n: spots.length})}
            {kinds.length > 0 && `: ${kinds.join(', ')}`}
          </span>
        ) : (
          <span className={styles.dim}>{tr('The body fits everywhere.')}</span>
        ))}
      {current?.error && <span className={styles.warningText}>{current.error}</span>}
    </div>
  );
}
