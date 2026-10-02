import type { Href } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AppText, Spinner, Stack, TextLink } from '@/components/atoms';
import { colors } from '@/theme';

export interface PageLink {
  href: Href;
  label: string;
}

export interface PageTemplateProps {
  title: string;
  links?: PageLink[];
  loading?: boolean;
  maxWidth?: number;
  children: ReactNode;
}

export function PageTemplate({ title, links = [], loading, maxWidth = 960, children }: PageTemplateProps) {
  return (
    <ScrollView style={s.page} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <View style={[s.column, { maxWidth }]}>
        <Stack direction="row">
          <AppText variant="h1" style={s.title}>
            {title}
          </AppText>
          {loading ? <Spinner /> : null}
        </Stack>
        {links.length ? (
          <Stack direction="row" wrap>
            {links.map((l) => (
              <TextLink key={l.label} href={l.href} label={l.label} />
            ))}
          </Stack>
        ) : null}
        {children}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1, alignItems: 'center', paddingHorizontal: 16, paddingVertical: 20 },
  column: { width: '100%', flexGrow: 1, gap: 16 },
  title: { flex: 1 },
});
