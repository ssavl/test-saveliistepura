import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/atoms';
import { colors } from '@/theme';

export function BrandLogo() {
  return (
    <View style={s.brand}>
      <View style={s.logo}>
        <AppText style={s.logoText}>↗</AppText>
      </View>
      <AppText style={s.name}>
        Workstyle<AppText style={s.dot}>.</AppText>
      </AppText>
    </View>
  );
}

const s = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { width: 34, height: 34, borderRadius: 11, backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center' },
  logoText: { color: '#EFF4C5', fontSize: 26, lineHeight: 30 },
  name: { fontSize: 23, fontWeight: '700', letterSpacing: -1, color: colors.text },
  dot: { color: '#B45133', fontSize: 23, fontWeight: '700' },
});
