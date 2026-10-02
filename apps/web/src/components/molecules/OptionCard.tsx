import { Pressable, StyleSheet } from 'react-native';

import { AppText, SelectionMark } from '@/components/atoms';
import { colors, radius } from '@/theme';

export interface OptionCardProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  multi?: boolean;
  disabled?: boolean;
}

export function OptionCard({ label, selected, onPress, multi, disabled }: OptionCardProps) {
  return (
    <Pressable
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={{ checked: selected, disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.option,
        selected && s.selected,
        disabled && !selected && s.disabled,
        pressed && s.pressed,
      ]}>
      <SelectionMark selected={selected} shape={multi ? 'checkbox' : 'radio'} />
      <AppText variant="option" style={s.label}>
        {label}
      </AppText>
    </Pressable>
  );
}

const s = StyleSheet.create({
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 18,
  },
  selected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  label: { flex: 1 },
});
