import type { AnswerValue } from '@funnel/shared';
import { progress } from '@funnel/shared';
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/components/theme';
import { ErrorState, Loading, ProgressBar, Screen } from '@/components/ui';
import { stepHref, useFunnel } from '@/funnel/FunnelContext';
import { StepView } from '@/funnel/StepView';

export default function StepScreen() {
  const { step: stepParam } = useLocalSearchParams<{ step: string }>();
  const f = useFunnel();
  const navigation = useNavigation();
  const ready = f.status.kind === 'ready';

  // Only the focused screen reconciles URL vs. history (the Stack keeps earlier screens mounted).
  useFocusEffect(
    useCallback(() => {
      if (!ready) return;
      const d = f.getData();
      if (!d) return;
      const idx = d.history.indexOf(stepParam);
      if (idx < 0 || !d.funnel.steps[stepParam]) {
        const current = f.ensureStarted();
        router.replace(stepHref(f.slug, current));
        return;
      }
      if (idx < d.history.length - 1) f.browserBack(stepParam);
      f.markViewed(stepParam);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready, stepParam]),
  );

  if (f.status.kind === 'error') return <ErrorState message={f.status.message} onRetry={f.retry} />;
  const d = f.data;
  const step = d?.funnel.steps[stepParam];
  if (!ready || !d || !step || !d.history.includes(stepParam)) return <Loading />;

  const pos = d.history.indexOf(stepParam);
  const p = progress(d.funnel, d.answers, stepParam);

  const goBack = () => {
    const to = f.backFrom(stepParam);
    if (!to) return;
    const state = navigation.getState();
    const prev = state && state.index > 0 ? state.routes[state.index - 1] : undefined;
    if (prev && (prev.params as { step?: string } | undefined)?.step === to) navigation.goBack();
    else router.replace(stepHref(f.slug, to));
  };

  const onSubmit = (value: AnswerValue | undefined) => {
    const res = f.submit(stepParam, value);
    if (res.error) return res.error;
    if (res.next) router.push(stepHref(f.slug, res.next));
    return undefined;
  };

  return (
    <Screen>
      <View style={s.header}>
        {pos > 0 ? (
          <Pressable accessibilityRole="button" onPress={goBack} hitSlop={10} style={s.back}>
            <Text style={s.backText}>‹ Back</Text>
          </Pressable>
        ) : (
          <View style={s.back} />
        )}
        {p.counted ? (
          <Text style={s.counter}>
            Question {p.index} of {p.total}
          </Text>
        ) : null}
      </View>
      <ProgressBar ratio={p.ratio} />
      <View style={{ height: 12 }} />
      <StepView
        key={`${stepParam}:${pos}`}
        step={step}
        answers={d.answers}
        onSubmit={onSubmit}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 32 },
  back: { minWidth: 80, paddingVertical: 4 },
  backText: { color: colors.accent, fontSize: 16, fontWeight: '500' },
  counter: { color: colors.muted, fontSize: 14, fontVariant: ['tabular-nums'] },
});
