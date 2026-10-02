import { useState } from 'react';

import { Button, Stack } from '@/components/atoms';
import { FieldMessage, NumberField, StepHeading } from '@/components/molecules';
import { useAnswerSubmit } from '@/hooks/useAnswerSubmit';

import { savedAnswer, type StepProps } from './types';

const parseNumber = (text: string) => {
  const normalized = text.trim().replace(',', '.');
  return normalized === '' ? undefined : Number(normalized);
};

export function NumberStep({ step, answers, onSubmit }: StepProps<'number'>) {
  const initial = savedAnswer(step, answers);
  const [text, setText] = useState(typeof initial === 'number' ? String(initial) : '');
  const { error, submit } = useAnswerSubmit(step, parseNumber(text), onSubmit);
  const { min, max, unit } = step.input;
  const range = min !== undefined && max !== undefined ? `From ${min} to ${max}${unit ? ` ${unit}` : ''}` : undefined;

  return (
    <Stack gap="xl">
      <StepHeading title={step.content.title} helper={step.content.helperText} />
      <Stack>
        <NumberField
          value={text}
          onChangeText={setText}
          onSubmit={() => submit()}
          unit={unit}
          invalid={!!error}
          accessibilityLabel={step.content.title}
        />
        <FieldMessage error={error} hint={range} />
        <Button title="Continue →" onPress={() => submit()} />
      </Stack>
    </Stack>
  );
}
