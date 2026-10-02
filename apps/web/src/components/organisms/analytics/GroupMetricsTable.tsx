import type { GroupMetrics } from '@funnel/shared';

import { SectionCard } from '@/components/molecules';
import { DataTable } from '@/components/organisms/DataTable';

import { byKey, groupColumns } from './columns';

export interface GroupMetricsTableProps {
  title: string;
  keyTitle: string;
  rows: GroupMetrics[];
  formatKey?: (key: string) => string;
}

export function GroupMetricsTable({ title, keyTitle, rows, formatKey }: GroupMetricsTableProps) {
  return (
    <SectionCard title={title}>
      <DataTable columns={groupColumns(keyTitle, formatKey)} rows={rows} rowKey={byKey} />
    </SectionCard>
  );
}
