import { type AnswerValue, progress } from '@funnel/shared';
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback } from 'react';

import { ProgressBar } from '@/components/atoms';
import { StatusView, StepTopBar } from '@/components/molecules';
import { StepRenderer } from '@/components/organisms';
import { FunnelTemplate } from '@/components/templates';
import { stepHref, useFunnel } from '@/context/FunnelContext';

export default function StepScreen() {
  const { step: stepParam } = useLocalSearchParams<{ step: string }>();
  const funnel = useFunnel();
  const { slug, getData, ensureStarted, browserBack, markViewed } = funnel;
  const navigation = useNavigation();
  const ready = funnel.status.kind === 'ready';

  useFocusEffect(
    useCallback(() => {
      if (!ready) return;
      const data = getData();
      if (!data) return;
      const idx = data.history.indexOf(stepParam);
      if (idx < 0 || !data.funnel.steps[stepParam]) {
        router.replace(stepHref(slug, ensureStarted()));
        return;
      }
      if (idx < data.history.length - 1) browserBack(stepParam);
      markViewed(stepParam);
    }, [ready, stepParam, slug, getData, ensureStarted, browserBack, markViewed]),
  );

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
  const data = funnel.data;
  const step = data?.funnel.steps[stepParam];
  if (!ready || !data || !step || !data.history.includes(stepParam)) {
    return <StatusView fullScreen kind="loading" message="Loading…" />;
  }

  const position = data.history.indexOf(stepParam);
  const isResult = step.type === 'result';
  const p = progress(data.funnel, data.answers, stepParam);
  const label = p.counted
    ? `Question ${p.index} of ${p.total}`
    : isResult
      ? 'YOUR PERSONAL PLAN'
      : 'LET’S FIND YOUR RHYTHM';

  const goBack = () => {
    const to = funnel.backFrom(stepParam);
    if (!to) return;
    const state = navigation.getState();
    const prev = state && state.index > 0 ? state.routes[state.index - 1] : undefined;
    if ((prev?.params as { step?: string } | undefined)?.step === to) navigation.goBack();
    else router.replace(stepHref(funnel.slug, to));
  };

  const submit = (value: AnswerValue | undefined) => {
    const res = funnel.submit(stepParam, value);
    if (res.error) return res.error;
    if (res.next) router.push(stepHref(funnel.slug, res.next));
    return undefined;
  };

  return (
    <FunnelTemplate title={data.config.title} complete={isResult}>
      <StepTopBar label={label} onBack={position > 0 ? goBack : undefined} />
      {p.counted || isResult ? <ProgressBar ratio={isResult ? 1 : p.ratio} /> : null}
      <StepRenderer key={`${stepParam}:${position}`} step={step} answers={data.answers} onSubmit={submit} />
    </FunnelTemplate>
  );
}
