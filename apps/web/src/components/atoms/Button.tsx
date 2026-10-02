import { Pressable, type StyleProp, StyleSheet, type ViewStyle } from 'react-native';

import { colors, radius } from '@/theme';

import { AppText } from './AppText';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'sm';

export interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}

const palette: Record<ButtonVariant, { bg: string; fg: string }> = {
  primary: { bg: colors.accent, fg: colors.onAccent },
  secondary: { bg: colors.accentSoft, fg: colors.accent },
  ghost: { bg: 'transparent', fg: colors.accent },
  danger: { bg: colors.dangerSoft, fg: colors.danger },
};

export function Button({ title, onPress, variant = 'primary', size = 'md', disabled, loading, style }: ButtonProps) {
  const inactive = disabled || loading;
  const { bg, fg } = palette[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        s.base,
        size === 'sm' && s.small,
        { backgroundColor: bg },
        inactive && s.disabled,
        pressed && !inactive && s.pressed,
        style,
      ]}>
      {loading ? (
        <Spinner color={fg} />
      ) : (
        <AppText style={[s.text, size === 'sm' && s.textSmall, { color: fg }]}>{title}</AppText>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  base: { minHeight: 56, borderRadius: radius.lg, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' },
  small: { minHeight: 36, paddingHorizontal: 12, borderRadius: radius.md },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  text: { fontSize: 17, fontWeight: '600' },
  textSmall: { fontSize: 14 },
});
