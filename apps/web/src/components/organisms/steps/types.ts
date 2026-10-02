import { type Answers, answerKey, type Step, type StepType } from '@funnel/shared';

import type { SubmitAnswer } from '@/hooks/useAnswerSubmit';

export type StepOf<T extends StepType> = Extract<Step, { type: T }>;

export interface StepProps<T extends StepType> {
  step: StepOf<T>;
  answers: Answers;
  onSubmit: SubmitAnswer;
}

export const savedAnswer = (step: Step, answers: Answers) => {
  const key = answerKey(step);
  return key ? answers[key] : undefined;
};
