import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  type StyleProp,
  View,
  type ViewStyle,
} from 'react-native';

import { colors, radius } from './theme';

/** Scrollable page with centered content column. */
export function Screen({ children, maxWidth = 480 }: { children: ReactNode; maxWidth?: number }) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled">
      <View style={[styles.column, { maxWidth }]}>{children}</View>
    </ScrollView>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  title,
  onPress,
  disabled,
  loading,
  variant = 'primary',
  small,
  style,
}: {
  title: string;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: ButtonVariant;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        buttonStyles[variant],
        inactive && styles.buttonDisabled,
        pressed && !inactive && styles.pressed,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? '#fff' : colors.accent} />
      ) : (
        <Text style={[styles.buttonText, small && styles.buttonTextSmall, { color: buttonText[variant] }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** Selectable option card for single/multi steps. */
export function OptionCard({
  label,
  selected,
  onPress,
  disabled,
  multi,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  multi?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={{ checked: selected, disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.option,
        selected && styles.optionSelected,
        disabled && !selected && styles.buttonDisabled,
        pressed && styles.pressed,
      ]}>
      <View style={[styles.mark, multi ? styles.markSquare : styles.markRound, selected && styles.markOn]}>
        {selected ? <Text style={styles.markTick}>✓</Text> : null}
      </View>
      <Text style={styles.optionText}>{label}</Text>
    </Pressable>
  );
}

export function ProgressBar({ ratio }: { ratio: number }) {
  return (
    <View style={styles.track}>
      <View style={[styles.fill, { width: `${Math.max(0, Math.min(1, ratio)) * 100}%` }]} />
    </View>
  );
}

export function Loading({ text = 'Loading…' }: { text?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.accent} size="large" />
      <Text style={styles.muted}>{text}</Text>
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.center}>
      <Text style={styles.errorTitle}>Something went wrong</Text>
      <Text style={[styles.muted, { textAlign: 'center' }]}>{message}</Text>
      {onRetry ? <Button title="Try again" onPress={onRetry} style={{ alignSelf: 'stretch' }} /> : null}
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  screenContent: { flexGrow: 1, alignItems: 'center', paddingHorizontal: 16, paddingVertical: 20 },
  column: { width: '100%', flexGrow: 1, gap: 16 },
  button: {
    minHeight: 52,
    borderRadius: radius,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSmall: { minHeight: 36, paddingHorizontal: 12, borderRadius: 10 },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { fontSize: 17, fontWeight: '600' },
  buttonTextSmall: { fontSize: 14 },
  pressed: { opacity: 0.8 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 10,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  optionSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  optionText: { flex: 1, fontSize: 17, color: colors.text },
  mark: { width: 22, height: 22, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  markRound: { borderRadius: 11 },
  markSquare: { borderRadius: 6 },
  markOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  markTick: { color: '#fff', fontSize: 13, fontWeight: '700' },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.accent },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, backgroundColor: colors.bg },
  muted: { color: colors.muted, fontSize: 15 },
  errorTitle: { fontSize: 20, fontWeight: '700', color: colors.text },
  h1: { fontSize: 28, lineHeight: 34, fontWeight: '700', color: colors.text },
  h2: { fontSize: 20, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: 17, lineHeight: 24, color: colors.muted },
  body: { fontSize: 16, lineHeight: 24, color: colors.text },
  error: { color: colors.danger, fontSize: 14 },
  link: { color: colors.accent, fontSize: 15, fontWeight: '500' },
});

const buttonStyles: Record<ButtonVariant, ViewStyle> = {
  primary: { backgroundColor: colors.accent },
  secondary: { backgroundColor: colors.accentSoft },
  ghost: { backgroundColor: 'transparent' },
  danger: { backgroundColor: colors.dangerSoft },
};
const buttonText: Record<ButtonVariant, string> = {
  primary: '#FFFFFF',
  secondary: colors.accent,
  ghost: colors.accent,
  danger: colors.danger,
};
