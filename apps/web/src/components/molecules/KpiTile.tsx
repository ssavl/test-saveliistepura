import { StyleSheet } from 'react-native';

import { AppText, Card } from '@/components/atoms';

export interface KpiTileProps {
  title: string;
  value: string;
  sub?: string;
  highlighted?: boolean;
}

export function KpiTile({ title, value, sub, highlighted }: KpiTileProps) {
  return (
    <Card tone={highlighted ? 'accent' : undefined} style={s.tile}>
      <AppText variant="label">{title}</AppText>
      <AppText variant="metric">{value}</AppText>
      {sub ? <AppText variant="caption">{sub}</AppText> : null}
    </Card>
  );
}

const s = StyleSheet.create({
  tile: { flexGrow: 1, flexBasis: 200, gap: 4 },
});
