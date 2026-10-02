import type { Answers, Step } from '@funnel/shared';

import type { SubmitAnswer } from '@/hooks/useAnswerSubmit';

import { InfoStep } from './InfoStep';
import { MultiSelectStep } from './MultiSelectStep';
import { NumberStep } from './NumberStep';
import { ResultStep } from './ResultStep';
import { SingleSelectStep } from './SingleSelectStep';

export interface StepRendererProps {
  step: Step;
  answers: Answers;
  onSubmit: SubmitAnswer;
}

export function StepRenderer({ step, answers, onSubmit }: StepRendererProps) {
  switch (step.type) {
    case 'info':
      return <InfoStep step={step} answers={answers} onSubmit={onSubmit} />;
    case 'single-select':
      return <SingleSelectStep step={step} answers={answers} onSubmit={onSubmit} />;
    case 'multi-select':
      return <MultiSelectStep step={step} answers={answers} onSubmit={onSubmit} />;
    case 'number':
      return <NumberStep step={step} answers={answers} onSubmit={onSubmit} />;
    case 'result':
      return <ResultStep step={step} />;
  }
}
