import { StyleSheet, View } from 'react-native';

import { radius, type Tone, toneColors } from '@/theme';

import { AppText } from './AppText';

export interface BadgeProps {
  label: string;
  tone?: Tone;
}

export function Badge({ label, tone = 'accent' }: BadgeProps) {
  const { fg, bg } = toneColors[tone];
  return (
    <View style={[s.badge, { backgroundColor: bg }]}>
      <AppText style={[s.text, { color: fg }]}>{label}</AppText>
    </View>
  );
}

const s = StyleSheet.create({
  badge: { alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
  text: { fontSize: 12, fontWeight: '600' },
});
