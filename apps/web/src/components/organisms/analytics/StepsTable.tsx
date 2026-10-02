import type { StepMetrics } from '@funnel/shared';
import { StyleSheet } from 'react-native';

import { AppText, ProgressBar, Stack } from '@/components/atoms';
import { SectionCard } from '@/components/molecules';
import { DataTable, type DataTableColumn } from '@/components/organisms/DataTable';
import { pct } from '@/lib/format';

export interface StepsTableProps {
  rows: StepMetrics[];
}

const columns: DataTableColumn<StepMetrics>[] = [
  {
    title: 'Шаг',
    width: 170,
    align: 'left',
    render: (st) => (
      <AppText variant="cell">
        {st.stepId} <AppText variant="caption">{st.type ?? '?'}</AppText>
      </AppText>
    ),
  },
  { title: 'Увидели', width: 80, render: (st) => st.viewed },
  { title: 'Завершили', width: 90, render: (st) => st.completed },
  { title: 'Конв. шага', width: 90, render: (st) => pct(st.conversion) },
  {
    title: 'Охват от старта',
    width: 200,
    align: 'left',
    render: (st) => (
      <Stack direction="row" gap={8}>
        <ProgressBar ratio={st.reach ?? 0} height={8} label={`Охват ${st.stepId}`} style={s.bar} />
        <AppText variant="cell" align="right" style={s.value}>
          {pct(st.reach)}
        </AppText>
      </Stack>
    ),
  },
  { title: 'Отвал', width: 70, render: (st) => st.dropped },
  { title: 'Назад', width: 70, render: (st) => st.backClicks },
];

export function StepsTable({ rows }: StepsTableProps) {
  return (
    <SectionCard title="Шаги">
      <DataTable columns={columns} rows={rows} rowKey={(st) => st.stepId} />
    </SectionCard>
  );
}

const s = StyleSheet.create({
  bar: { flex: 1 },
  value: { width: 56 },
});
