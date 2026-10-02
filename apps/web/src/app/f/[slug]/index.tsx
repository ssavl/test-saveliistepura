import { router } from 'expo-router';
import { useEffect, useRef } from 'react';

import { StatusView } from '@/components/molecules';
import { stepHref, useFunnel } from '@/context/FunnelContext';

export default function FunnelIndex() {
  const funnel = useFunnel();
  const ready = funnel.status.kind === 'ready';
  const done = useRef(false);

  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;
    router.replace(stepHref(funnel.slug, funnel.ensureStarted()));
  }, [ready, funnel]);

  if (funnel.status.kind === 'error') {
    return (
      <StatusView
        fullScreen
        kind="error"
        title="Something went wrong"
        message={funnel.status.message}
        actionLabel="Try again"
        onAction={funnel.retry}
      />
    );
  }
  return <StatusView fullScreen kind="loading" message="Loading…" />;
}
