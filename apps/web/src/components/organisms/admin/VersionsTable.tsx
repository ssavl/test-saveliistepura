import type { VersionDto } from '@funnel/shared';

import { Badge, Button, Stack } from '@/components/atoms';
import { DataTable, type DataTableColumn } from '@/components/organisms/DataTable';
import type { FunnelAdmin } from '@/hooks/useFunnelAdmin';
import { dateTime, orDash } from '@/lib/format';

export interface VersionsTableProps extends Pick<FunnelAdmin, 'busy' | 'rollback' | 'toggleJson' | 'shown'> {
  versions: VersionDto[];
}

export function VersionsTable({ versions, busy, rollback, toggleJson, shown }: VersionsTableProps) {
  const columns: DataTableColumn<VersionDto>[] = [
    { title: 'Версия', width: 70, align: 'left', render: (v) => `v${v.version}` },
    { title: 'Создана', width: 170, align: 'left', render: (v) => dateTime(v.createdAt) },
    { title: 'Статус', width: 90, align: 'left', render: (v) => orDash(v.status) },
    { title: 'Release note', width: 260, align: 'left', render: (v) => orDash(v.releaseNote) },
    { title: 'Заметка', width: 180, align: 'left', render: (v) => orDash(v.note) },
    { title: 'Сессии', width: 80, render: (v) => v.sessions },
    {
      title: 'Действия',
      width: 330,
      align: 'left',
      render: (v) => (
        <Stack direction="row" wrap>
          {v.active ? (
            <Badge tone="success" label="активна" />
          ) : (
            <Button size="sm" variant="secondary" title="Сделать активной" disabled={busy} onPress={() => rollback(v.version)} />
          )}
          <Button
            size="sm"
            variant="ghost"
            title={shown?.version === v.version ? 'Скрыть JSON' : 'Показать JSON'}
            onPress={() => toggleJson(v.version)}
          />
        </Stack>
      ),
    },
  ];
  return <DataTable columns={columns} rows={versions} rowKey={(v) => String(v.version)} />;
}
