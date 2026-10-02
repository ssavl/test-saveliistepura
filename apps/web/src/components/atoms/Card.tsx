import { type StyleProp, StyleSheet, View, type ViewProps, type ViewStyle } from 'react-native';

import { colors, radius, type Tone, toneColors } from '@/theme';

export interface CardProps extends ViewProps {
  tone?: Tone;
  style?: StyleProp<ViewStyle>;
}

export function Card({ tone, style, ...rest }: CardProps) {
  const toned = tone && { backgroundColor: toneColors[tone].bg, borderColor: toneColors[tone].bg };
  return <View style={[s.card, toned, style]} {...rest} />;
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 10,
  },
});
