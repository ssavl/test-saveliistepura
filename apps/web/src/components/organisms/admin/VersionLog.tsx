import type { VersionLogDto } from '@funnel/shared';

import { AppText, Stack } from '@/components/atoms';
import { dateTime } from '@/lib/format';

export interface VersionLogProps {
  entries: VersionLogDto[];
}

export function VersionLog({ entries }: VersionLogProps) {
  return (
    <Stack gap="xs">
      <AppText variant="h3">Журнал</AppText>
      {entries.length ? (
        entries.map((l, i) => (
          <AppText key={i} variant="label">
            {dateTime(l.at)} · {l.action} · {l.fromVersion != null ? `v${l.fromVersion}` : '—'} → v{l.toVersion}
          </AppText>
        ))
      ) : (
        <AppText variant="muted">Пусто</AppText>
      )}
    </Stack>
  );
}
