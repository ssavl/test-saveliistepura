import { AppText } from '@/components/atoms';

export interface FieldMessageProps {
  error?: string;
  hint?: string;
}

export function FieldMessage({ error, hint }: FieldMessageProps) {
  if (error) {
    return (
      <AppText variant="error" accessibilityRole="alert">
        {error}
      </AppText>
    );
  }
  return hint ? <AppText variant="muted">{hint}</AppText> : null;
}
