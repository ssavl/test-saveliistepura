import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { AppText } from '@/components/atoms';
import { BrandLogo } from '@/components/molecules';
import { FunnelAside } from '@/components/organisms';
import { colors } from '@/theme';

export interface FunnelTemplateProps {
  title: string;
  complete: boolean;
  children: ReactNode;
}

const WIDE_WIDTH = 960;

export function FunnelTemplate({ title, complete, children }: FunnelTemplateProps) {
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_WIDTH;
  return (
    <ScrollView
      nativeID="funnel-page"
      style={s.page}
      contentContainerStyle={[s.content, !wide && s.contentCompact]}
      keyboardShouldPersistTaps="handled">
      <View style={s.container}>
        <View style={s.nav}>
          <BrandLogo />
          {width >= 600 ? <AppText variant="label">A little clarity goes a long way</AppText> : null}
        </View>
        <View style={[s.layout, !wide && s.layoutCompact]}>
          {wide ? <FunnelAside title={title} /> : null}
          <View style={[s.panel, !wide && s.panelCompact]}>{children}</View>
        </View>
        <View style={s.footer}>
          <AppText variant="caption">Made for the way you work.</AppText>
          <AppText variant="caption">{complete ? 'Your next chapter starts here' : 'One step at a time'}</AppText>
        </View>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1, padding: 40, alignItems: 'center' },
  contentCompact: { padding: 16 },
  container: { width: '100%', maxWidth: 1160, flexGrow: 1 },
  nav: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 32,
  },
  layout: { flexDirection: 'row', gap: 24, flexGrow: 1, alignItems: 'stretch' },
  layoutCompact: { flexDirection: 'column', alignItems: 'center' },
  panel: {
    flex: 1.15,
    backgroundColor: colors.card,
    borderRadius: 28,
    padding: 40,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 24,
  },
  panelCompact: { padding: 20, borderRadius: 24, flex: 1, width: '100%', maxWidth: 640 },
  footer: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', paddingVertical: 24 },
});
