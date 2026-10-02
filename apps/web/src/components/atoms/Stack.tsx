import { type StyleProp, View, type ViewProps, type ViewStyle } from 'react-native';

import { space } from '@/theme';

export interface StackProps extends ViewProps {
  direction?: 'row' | 'column';
  gap?: keyof typeof space | number;
  wrap?: boolean;
  align?: ViewStyle['alignItems'];
  justify?: ViewStyle['justifyContent'];
  flex?: number;
  style?: StyleProp<ViewStyle>;
}

export function Stack({ direction = 'column', gap = 'md', wrap, align, justify, flex, style, ...rest }: StackProps) {
  return (
    <View
      style={[
        {
          flexDirection: direction,
          gap: typeof gap === 'number' ? gap : space[gap],
          flexWrap: wrap ? 'wrap' : 'nowrap',
          alignItems: align ?? (direction === 'row' ? 'center' : undefined),
          justifyContent: justify,
          flex,
        },
        style,
      ]}
      {...rest}
    />
  );
}
