import type { ReactNode } from 'react';

import { AppText, Card } from '@/components/atoms';

export interface SectionCardProps {
  title: string;
  children: ReactNode;
}

export function SectionCard({ title, children }: SectionCardProps) {
  return (
    <Card>
      <AppText variant="h2">{title}</AppText>
      {children}
    </Card>
  );
}
