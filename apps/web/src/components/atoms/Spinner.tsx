import { ActivityIndicator } from 'react-native';

import { colors } from '@/theme';

export interface SpinnerProps {
  size?: 'small' | 'large';
  color?: string;
}

export function Spinner({ size = 'small', color = colors.accent }: SpinnerProps) {
  return <ActivityIndicator size={size} color={color} />;
}
