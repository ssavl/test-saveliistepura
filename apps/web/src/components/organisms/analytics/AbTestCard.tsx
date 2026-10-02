import type { AnalyticsResponse } from '@funnel/shared';

import { AppText } from '@/components/atoms';
import { SectionCard } from '@/components/molecules';
import { DataTable } from '@/components/organisms/DataTable';
import { pp, pValue, signedPct } from '@/lib/format';

import { byKey, groupColumns } from './columns';

export interface AbTestCardProps {
  rows: AnalyticsResponse['byVariant'];
  test: AnalyticsResponse['abTest'];
}

const ALPHA = 0.05;

export function AbTestCard({ rows, test }: AbTestCardProps) {
  const verdict = test.pValue == null ? '' : test.pValue < ALPHA ? ` — значимо (α = ${ALPHA})` : ' — не значимо';
  return (
    <SectionCard title="A/B">
      <DataTable columns={groupColumns('Вариант')} rows={rows} rowKey={byKey} />
      <AppText>
        Лифт B − A: {pp(test.liftAbs)} ({signedPct(test.liftRel)}), p-value: {pValue(test.pValue)}
        {verdict}
      </AppText>
    </SectionCard>
  );
}
