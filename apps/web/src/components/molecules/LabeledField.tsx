import type { ReactNode } from 'react';

import { AppText, Stack } from '@/components/atoms';

export interface LabeledFieldProps {
  label: string;
  children: ReactNode;
}

export function LabeledField({ label, children }: LabeledFieldProps) {
  return (
    <Stack gap="sm">
      <AppText variant="label">{label}</AppText>
      {children}
    </Stack>
  );
}
