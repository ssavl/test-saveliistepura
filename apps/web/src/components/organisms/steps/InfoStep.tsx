import { AppText, Button, Stack } from '@/components/atoms';
import { StepHeading } from '@/components/molecules';

import type { StepProps } from './types';

export function InfoStep({ step, onSubmit }: StepProps<'info'>) {
  const { eyebrow, title, body, primaryActionLabel } = step.content;
  return (
    <Stack gap="xl">
      <StepHeading eyebrow={eyebrow} title={title} />
      {body ? <AppText variant="lead">{body}</AppText> : null}
      <Button title={primaryActionLabel || 'Continue'} onPress={() => onSubmit(undefined)} />
    </Stack>
  );
}
