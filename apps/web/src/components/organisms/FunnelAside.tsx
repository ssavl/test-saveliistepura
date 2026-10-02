import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/atoms';
import { colors } from '@/theme';

export interface FunnelAsideProps {
  title: string;
}

const art = {
  sage: '#E8ECDD',
  moss: '#53694C',
  olive: '#526745',
  ring: '#CAD3BA',
  peach: '#EFBDA5',
  clay: '#A97B66',
  bark: '#634636',
  forest: '#2D5B47',
  mint: '#92B4A0',
  lime: '#F3F5C4',
};

export function FunnelAside({ title }: FunnelAsideProps) {
  return (
    <View style={s.aside}>
      <AppText style={s.kicker}>A FRESH PERSPECTIVE ON WORK</AppText>
      <AppText style={s.title}>{title}</AppText>
      <View style={s.art} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={s.orbit} />
        <View style={[s.tile, s.tilePeach]}>
          <AppText style={s.tileIcon}>✳</AppText>
          <View style={s.line} />
          <View style={[s.line, s.lineShort]} />
        </View>
        <View style={[s.tile, s.tileGreen]}>
          <AppText style={[s.tileIcon, { color: art.lime }]}>↗</AppText>
          <View style={[s.line, { backgroundColor: art.mint }]} />
          <View style={[s.line, s.lineShort, { backgroundColor: art.mint }]} />
        </View>
        <View style={s.spark}>
          <AppText style={s.sparkText}>✦</AppText>
        </View>
      </View>
      <View style={s.footer}>
        <AppText style={s.dot}>●</AppText>
        <AppText style={s.caption}>Your team. Your rhythm.</AppText>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  aside: { flex: 0.85, backgroundColor: art.sage, borderRadius: 28, padding: 36, overflow: 'hidden', minHeight: 600 },
  kicker: { color: art.moss, fontSize: 11, fontWeight: '700', letterSpacing: 1.8 },
  title: { color: colors.text, fontSize: 40, lineHeight: 46, fontWeight: '600', letterSpacing: -1.7, marginTop: 24 },
  art: { height: 270, marginTop: 24, justifyContent: 'center', alignItems: 'center' },
  orbit: { position: 'absolute', width: 240, height: 240, borderRadius: 120, borderWidth: 1, borderColor: art.ring },
  tile: { position: 'absolute', width: 140, height: 166, borderRadius: 22, padding: 22, gap: 12 },
  tilePeach: { backgroundColor: art.peach, transform: [{ rotate: '-14deg' }], left: 12, top: 30 },
  tileGreen: { backgroundColor: art.forest, transform: [{ rotate: '12deg' }], right: 8, top: 78 },
  tileIcon: { fontSize: 60, lineHeight: 65, color: art.bark },
  line: { height: 5, width: 70, borderRadius: 3, backgroundColor: art.clay },
  lineShort: { width: 45 },
  spark: { position: 'absolute', right: 4, top: 12 },
  sparkText: { fontSize: 46, lineHeight: 52, color: art.olive },
  footer: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 'auto', paddingTop: 24 },
  dot: { color: art.olive, fontSize: 10 },
  caption: { color: art.olive, fontSize: 14 },
});
