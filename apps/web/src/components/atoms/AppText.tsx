import { Text, type TextProps, type TextStyle } from 'react-native';

import { type ColorName, colors, type TextVariant, typography } from '@/theme';

export interface AppTextProps extends TextProps {
  variant?: TextVariant;
  color?: ColorName;
  align?: TextStyle['textAlign'];
}

export function AppText({ variant = 'body', color, align, style, ...rest }: AppTextProps) {
  return (
    <Text
      style={[typography[variant], color && { color: colors[color] }, align && { textAlign: align }, style]}
      {...rest}
    />
  );
}
