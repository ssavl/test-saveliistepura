import type { GroupMetrics } from '@funnel/shared';

import { SectionCard } from '@/components/molecules';
import { DataTable } from '@/components/organisms/DataTable';

import { byKey, resultColumns } from './columns';

export interface ResultsTableProps {
  rows: GroupMetrics[];
}

export function ResultsTable({ rows }: ResultsTableProps) {
  return (
    <SectionCard title="Результаты">
      <DataTable columns={resultColumns} rows={rows} rowKey={byKey} />
    </SectionCard>
  );
}
