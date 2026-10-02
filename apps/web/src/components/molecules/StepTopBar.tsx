import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/atoms';

export interface StepTopBarProps {
  label: string;
  onBack?: () => void;
}

export function StepTopBar({ label, onBack }: StepTopBarProps) {
  return (
    <View style={s.bar}>
      {onBack ? (
        <Pressable accessibilityRole="button" onPress={onBack} hitSlop={10} style={s.back}>
          <AppText variant="link" style={s.backText}>
            ‹ Back
          </AppText>
        </Pressable>
      ) : (
        <View style={s.back} />
      )}
      <AppText variant="overline" style={s.label}>{label}</AppText>
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 32 },
  back: { minWidth: 64, minHeight: 44, justifyContent: 'center' },
  backText: { fontSize: 16 },
  label: { flexShrink: 1, textAlign: 'right' },
});
