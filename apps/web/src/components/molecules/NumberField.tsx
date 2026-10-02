import { StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/atoms';
import { colors, radius } from '@/theme';

export interface NumberFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit?: () => void;
  unit?: string;
  invalid?: boolean;
  accessibilityLabel?: string;
}

export function NumberField({ value, onChangeText, onSubmit, unit, invalid, accessibilityLabel }: NumberFieldProps) {
  return (
    <View style={[s.row, invalid && s.invalid]}>
      <TextInput
        value={value}
        onChangeText={(t) => onChangeText(t.replace(/[^0-9.,]/g, ''))}
        keyboardType="numeric"
        inputMode="numeric"
        placeholder="0"
        placeholderTextColor={colors.muted}
        onSubmitEditing={onSubmit}
        accessibilityLabel={accessibilityLabel}
        style={s.input}
      />
      {unit ? <AppText style={s.unit}>{unit}</AppText> : null}
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: 16,
  },
  invalid: { borderColor: colors.danger },
  input: { flex: 1, fontSize: 40, paddingVertical: 22, color: colors.text, minWidth: 0 },
  unit: { fontSize: 18, color: colors.muted, marginLeft: 8 },
});
