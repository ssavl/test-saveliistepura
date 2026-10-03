import { type Result, type ResultResponse, ResultSchema } from '@funnel/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useFunnel } from '@/context/FunnelContext';
import { api } from '@/lib/api';
import { flushNow, track } from '@/lib/tracker';

export type ResultState = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; result: Result };

const EXPAND_ACTION = 'expand_recommendation';

export function useStepResult(stepId: string) {
  const { getData, awaitPersist } = useFunnel();
  const [state, setState] = useState<ResultState>({ kind: 'loading' });
  const [expanded, setExpanded] = useState(false);
  const viewed = useRef<string | null>(null);

  const load = useCallback(() => {
    const data = getData();
    if (!data) return;
    awaitPersist()
      .then((saved) => {
        if (!saved) throw new Error('state not saved');
        return api<ResultResponse>(`/api/sessions/${data.session.id}/result`);
      })
      .then((res) => setState({ kind: 'ready', result: ResultSchema.parse(res.result) }))
      .catch((e) => {
        console.warn('[funnel] result failed', e);
        setState({ kind: 'error' });
      });
  }, [getData, awaitPersist]);

  useEffect(load, [load]);

  const reload = () => {
    setState({ kind: 'loading' });
    load();
  };

  const result = state.kind === 'ready' ? state.result : null;

  useEffect(() => {
    if (!result || viewed.current === result.id) return;
    viewed.current = result.id;
    track('result_viewed', stepId, { result_id: result.id });
  }, [result, stepId]);

  const clickCta = () => {
    if (!result) return;
    const { action } = result.cta;
    track('cta_clicked', stepId, { result_id: result.id, action });
    if (action === EXPAND_ACTION && !expanded) {
      setExpanded(true);
      if (getData()?.funnel.events.recommendation_expanded) {
        track('recommendation_expanded', stepId, { result_id: result.id, action, source: 'cta' });
      }
    }
    void flushNow();
  };

  return { state, expanded, reload, clickCta };
}
