import { type AnswerValue, type Step, validateAnswer } from '@funnel/shared';
import { useState } from 'react';

export type SubmitAnswer = (value: AnswerValue | undefined) => string | undefined;

export function useAnswerSubmit(step: Step, value: AnswerValue | undefined, onSubmit: SubmitAnswer) {
  const [attempted, setAttempted] = useState(false);
  const [submitError, setSubmitError] = useState<string>();
  const check = validateAnswer(step, value);
  const error = attempted ? (check.ok ? submitError : check.error) : undefined;

  const submit = (next: AnswerValue | undefined = value) => {
    setAttempted(true);
    if (!validateAnswer(step, next).ok) return;
    setSubmitError(onSubmit(next));
  };

  return { error, submit };
}
