import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/atoms';
import { colors, radius } from '@/theme';

export interface RecommendationItemProps {
  index: number;
  text: string;
}

export function RecommendationItem({ index, text }: RecommendationItemProps) {
  return (
    <View style={s.item}>
      <AppText style={s.mark}>{index}.</AppText>
      <AppText style={s.text}>{text}</AppText>
    </View>
  );
}

const s = StyleSheet.create({
  item: {
    flexDirection: 'row',
    gap: 14,
    alignItems: 'flex-start',
    backgroundColor: colors.bg,
    padding: 18,
    borderRadius: radius.lg,
  },
  mark: { color: colors.accent, fontSize: 16, fontWeight: '700', lineHeight: 24, minWidth: 20 },
  text: { flex: 1 },
});
