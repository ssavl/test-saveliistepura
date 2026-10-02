import { StyleSheet, TextInput, type TextInputProps } from 'react-native';

import { colors, mono, radius } from '@/theme';

export interface TextFieldProps extends TextInputProps {
  variant?: 'default' | 'code';
  invalid?: boolean;
}

export function TextField({ variant = 'default', invalid, multiline, style, ...rest }: TextFieldProps) {
  return (
    <TextInput
      multiline={multiline}
      placeholderTextColor={colors.muted}
      autoCapitalize="none"
      style={[s.input, variant === 'code' && s.code, multiline && s.multiline, invalid && s.invalid, style]}
      {...rest}
    />
  );
}

const s = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: colors.card,
    color: colors.text,
    minWidth: 160,
  },
  code: { fontFamily: mono, fontSize: 12 },
  multiline: { minHeight: 280, textAlignVertical: 'top' },
  invalid: { borderColor: colors.danger },
});
