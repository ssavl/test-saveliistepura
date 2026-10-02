import { useWindowDimensions } from 'react-native';

import { AppText, Stack } from '@/components/atoms';

export interface StepHeadingProps {
  title?: string;
  helper?: string;
  eyebrow?: string;
}

const COMPACT_WIDTH = 600;

export function StepHeading({ title, helper, eyebrow }: StepHeadingProps) {
  const { width } = useWindowDimensions();
  return (
    <Stack gap={14}>
      {eyebrow ? <AppText variant="eyebrow">{eyebrow}</AppText> : null}
      {title ? (
        <AppText variant={width < COMPACT_WIDTH ? 'displayCompact' : 'display'} accessibilityRole="header">
          {title}
        </AppText>
      ) : null}
      {helper ? <AppText variant="subtitle">{helper}</AppText> : null}
    </Stack>
  );
}
