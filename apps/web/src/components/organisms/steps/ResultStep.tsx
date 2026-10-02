import { AppText, Badge, Button, Card, Stack } from '@/components/atoms';
import { RecommendationItem, StatusView, StepHeading } from '@/components/molecules';
import { useStepResult } from '@/hooks/useStepResult';

import type { StepOf } from './types';

export interface ResultStepProps {
  step: StepOf<'result'>;
}

export function ResultStep({ step }: ResultStepProps) {
  const { state, expanded, reload, clickCta } = useStepResult(step.id);
  const { loadingTitle, errorTitle, retryLabel } = step.content;

  if (state.kind === 'loading') return <StatusView kind="loading" title={loadingTitle || 'Loading…'} />;
  if (state.kind === 'error') {
    return (
      <StatusView
        kind="error"
        title={errorTitle || 'Something went wrong'}
        actionLabel={retryLabel || 'Try again'}
        onAction={() => void reload()}
      />
    );
  }

  const { result } = state;
  return (
    <Stack gap="xl">
      <Badge label="✓  Your recommendation is ready" />
      <StepHeading title={result.title} />
      {result.summary ? (
        <Card tone="accent">
          <AppText variant="subtitle" color="text">
            {result.summary}
          </AppText>
        </Card>
      ) : null}
      <Button title={result.cta.label} onPress={clickCta} />
      {expanded && result.recommendations.length ? (
        <Stack accessibilityRole="list">
          {result.recommendations.map((text, i) => (
            <RecommendationItem key={i} index={i + 1} text={text} />
          ))}
        </Stack>
      ) : null}
    </Stack>
  );
}
