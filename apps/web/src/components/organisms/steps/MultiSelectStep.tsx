import { useState } from 'react';

import { AppText, Button, Stack } from '@/components/atoms';
import { FieldMessage, OptionCard, StepHeading } from '@/components/molecules';
import { useAnswerSubmit } from '@/hooks/useAnswerSubmit';

import { savedAnswer, type StepProps } from './types';

export function MultiSelectStep({ step, answers, onSubmit }: StepProps<'multi-select'>) {
  const initial = savedAnswer(step, answers);
  const [selected, setSelected] = useState<string[]>(Array.isArray(initial) ? initial : []);
  const ordered = step.input.options.map((o) => o.value).filter((v) => selected.includes(v));
  const { error, submit } = useAnswerSubmit(step, ordered, onSubmit);
  const max = step.validation.maxSelections;
  const atMax = max !== undefined && selected.length >= max;

  const toggle = (value: string) =>
    setSelected((cur) => (cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]));

  return (
    <Stack gap="xl">
      <StepHeading title={step.content.title} helper={step.content.helperText} />
      <AppText variant="hint" accessibilityLiveRegion="polite">
        {selected.length} selected{max !== undefined ? ` · Choose up to ${max}` : ''}
      </AppText>
      <Stack>
        {step.input.options.map((o) => {
          const on = selected.includes(o.value);
          return (
            <OptionCard
              key={o.value}
              multi
              label={o.label}
              selected={on}
              disabled={!on && atMax}
              onPress={() => toggle(o.value)}
            />
          );
        })}
        <FieldMessage error={error} />
        <Button title="Continue →" onPress={() => submit()} />
      </Stack>
    </Stack>
  );
}
