import type { AnswerValue } from '@funnel/shared';
import { progress } from '@funnel/shared';
import { type Href, router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/components/theme';
import { ErrorState, Loading, ProgressBar, Screen } from '@/components/ui';
import { stepHref, useFunnel } from '@/funnel/FunnelContext';
import { StepView } from '@/funnel/StepView';
import { flushNow, track } from '@/lib/tracker';

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
  const p = progress(d.funnel, d.answers, d.history.slice(0, pos + 1));

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

  const onCta = async (url: string) => {
    track('cta_clicked', stepParam, { url });
    await Promise.race([flushNow(), new Promise((r) => setTimeout(r, 2000))]);
    if (url.startsWith('/')) router.push(url as Href);
    else if (Platform.OS === 'web' && typeof window !== 'undefined') window.location.assign(url);
    else await Linking.openURL(url);
  };

  return (
    <Screen>
      <View style={s.header}>
        {pos > 0 ? (
          <Pressable accessibilityRole="button" onPress={goBack} hitSlop={10} style={s.back}>
            <Text style={s.backText}>‹ Назад</Text>
          </Pressable>
        ) : (
          <View style={s.back} />
        )}
        <Text style={s.counter}>
          {p.index} / {p.total}
        </Text>
      </View>
      <ProgressBar ratio={p.ratio} />
      <View style={{ height: 12 }} />
      <StepView
        key={`${stepParam}:${pos}`}
        step={step}
        funnel={d.funnel}
        answers={d.answers}
        onSubmit={onSubmit}
        onCta={onCta}
        onSecondary={(a) => track(a.event, stepParam, { label: a.label })}
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
