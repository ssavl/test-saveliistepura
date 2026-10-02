import { StyleSheet } from 'react-native';

import { AppText } from '@/components/atoms';
import { radius, type Tone, toneColors } from '@/theme';

export interface NoticeProps {
  tone: Tone;
  message: string;
}

export function Notice({ tone, message }: NoticeProps) {
  const { fg, bg } = toneColors[tone];
  return (
    <AppText
      accessibilityRole={tone === 'danger' ? 'alert' : undefined}
      style={[s.notice, { color: fg, backgroundColor: bg }]}>
      {message}
    </AppText>
  );
}

const s = StyleSheet.create({
  notice: { padding: 12, borderRadius: radius.md, fontSize: 14 },
});
