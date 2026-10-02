import { type Result, type ResultResponse, ResultSchema } from '@funnel/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useFunnel } from '@/context/FunnelContext';
import { api } from '@/lib/api';
import { flushNow, track } from '@/lib/tracker';

export type ResultState = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; result: Result };

const EXPAND_ACTION = 'expand_recommendation';

export function useStepResult(stepId: string) {
  const funnel = useFunnel();
  const [state, setState] = useState<ResultState>({ kind: 'loading' });
  const [expanded, setExpanded] = useState(false);
  const viewed = useRef<string | null>(null);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    const data = funnel.getData();
    if (!data) return;
    try {
      if (!(await funnel.awaitPersist())) throw new Error('state not saved');
      const res = await api<ResultResponse>(`/api/sessions/${data.session.id}/result`);
      setState({ kind: 'ready', result: ResultSchema.parse(res.result) });
    } catch (e) {
      console.warn('[funnel] result failed', e);
      setState({ kind: 'error' });
    }
  }, [funnel]);

  useEffect(() => {
    void load();
  }, []);

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
      if (funnel.getData()?.funnel.events.recommendation_expanded) {
        track('recommendation_expanded', stepId, { result_id: result.id, action, source: 'cta' });
      }
    }
    void flushNow();
  };

  return { state, expanded, reload: load, clickCta };
}
