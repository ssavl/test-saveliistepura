import { router } from 'expo-router';
import { useEffect, useRef } from 'react';

import { ErrorState, Loading } from '@/components/ui';
import { stepHref, useFunnel } from '@/funnel/FunnelContext';

// Entry point: forwards to the session's current step (or the start step for a fresh session).
export default function FunnelIndex() {
  const f = useFunnel();
  const ready = f.status.kind === 'ready';
  const done = useRef(false);
  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;
    router.replace(stepHref(f.slug, f.ensureStarted()));
  }, [ready, f]);
  if (f.status.kind === 'error') return <ErrorState message={f.status.message} onRetry={f.retry} />;
  return <Loading />;
}
