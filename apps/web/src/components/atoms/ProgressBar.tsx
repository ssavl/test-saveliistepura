import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';

import { colors } from '@/theme';

export interface ProgressBarProps {
  ratio: number;
  height?: number;
  label?: string;
  style?: StyleProp<ViewStyle>;
}

const clamp = (v: number) => Math.max(0, Math.min(1, v));

export function ProgressBar({ ratio, height = 6, label = 'Progress', style }: ProgressBarProps) {
  const value = clamp(ratio);
  const shape = { height, borderRadius: height / 2 };
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
      style={[s.track, shape, style]}>
      <View style={[s.fill, shape, { width: `${value * 100}%` }]} />
    </View>
  );
}

const s = StyleSheet.create({
  track: { backgroundColor: colors.border, overflow: 'hidden' },
  fill: { backgroundColor: colors.accent },
});
