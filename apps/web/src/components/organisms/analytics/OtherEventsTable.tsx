import type { AnalyticsResponse } from '@funnel/shared';

import { SectionCard } from '@/components/molecules';
import { DataTable, type DataTableColumn } from '@/components/organisms/DataTable';
import { pct } from '@/lib/format';

type EventRow = AnalyticsResponse['otherEvents'][number];

export interface OtherEventsTableProps {
  rows: EventRow[];
  started: number;
}

export function OtherEventsTable({ rows, started }: OtherEventsTableProps) {
  const columns: DataTableColumn<EventRow>[] = [
    { title: 'Событие', width: 220, align: 'left', render: (e) => e.name },
    { title: 'Сессии', width: 90, render: (e) => e.sessions },
    { title: 'События', width: 90, render: (e) => e.events },
    { title: '% от старта', width: 100, render: (e) => pct(started ? e.sessions / started : null) },
  ];
  return (
    <SectionCard title="Другие события">
      <DataTable columns={columns} rows={rows} rowKey={(e) => e.name} empty="Событий из конфига пока нет" />
    </SectionCard>
  );
}
