import { StyleSheet, View } from 'react-native';

import { AppText, Button, Spinner } from '@/components/atoms';
import { colors } from '@/theme';

export interface StatusViewProps {
  kind: 'loading' | 'error';
  title?: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  fullScreen?: boolean;
}

export function StatusView({ kind, title, message, actionLabel, onAction, fullScreen }: StatusViewProps) {
  return (
    <View style={[s.center, fullScreen ? s.screen : s.inline]}>
      {kind === 'loading' ? <Spinner size="large" /> : null}
      {title ? (
        <AppText variant="h2" align="center">
          {title}
        </AppText>
      ) : null}
      {message ? (
        <AppText variant="muted" align="center">
          {message}
        </AppText>
      ) : null}
      {actionLabel && onAction ? <Button title={actionLabel} onPress={onAction} style={s.action} /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', gap: 14 },
  screen: { flex: 1, padding: 24, backgroundColor: colors.bg },
  inline: { paddingVertical: 48 },
  action: { alignSelf: 'stretch' },
});
