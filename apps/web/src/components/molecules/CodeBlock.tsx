import { ScrollView, StyleSheet } from 'react-native';

import { AppText } from '@/components/atoms';
import { colors, radius } from '@/theme';

export interface CodeBlockProps {
  code: string;
}

export function CodeBlock({ code }: CodeBlockProps) {
  return (
    <ScrollView style={s.box} nestedScrollEnabled>
      <AppText variant="code" selectable>
        {code}
      </AppText>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  box: { maxHeight: 420, backgroundColor: colors.bg, borderRadius: radius.md, padding: 12 },
});
