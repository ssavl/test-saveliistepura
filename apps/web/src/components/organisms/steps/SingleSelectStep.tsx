import { useState } from 'react';

import { AppText, Stack } from '@/components/atoms';
import { FieldMessage, OptionCard, StepHeading } from '@/components/molecules';
import { useAnswerSubmit } from '@/hooks/useAnswerSubmit';

import { savedAnswer, type StepProps } from './types';

export function SingleSelectStep({ step, answers, onSubmit }: StepProps<'single-select'>) {
  const initial = savedAnswer(step, answers);
  const [selected, setSelected] = useState(typeof initial === 'string' ? initial : undefined);
  const { error, submit } = useAnswerSubmit(step, selected, onSubmit);
  const { title, helperText } = step.content;

  const choose = (value: string) => {
    setSelected(value);
    submit(value);
  };

  return (
    <Stack gap="xl">
      <StepHeading title={title} helper={helperText} />
      <Stack accessibilityRole="radiogroup" accessibilityLabel={title}>
        {step.input.options.map((o) => (
          <OptionCard key={o.value} label={o.label} selected={selected === o.value} onPress={() => choose(o.value)} />
        ))}
        <FieldMessage error={error} />
      </Stack>
      <AppText variant="hint">Select an option to continue →</AppText>
    </Stack>
  );
}
