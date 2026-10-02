import type { AnalyticsResponse } from '@funnel/shared';

import { Stack } from '@/components/atoms';
import { KpiTile } from '@/components/molecules';
import { interval, pct } from '@/lib/format';

export interface KpiGridProps {
  totals: AnalyticsResponse['totals'];
}

export function KpiGrid({ totals: t }: KpiGridProps) {
  return (
    <Stack direction="row" wrap gap={12} align="stretch">
      <KpiTile title="Начали" value={String(t.started)} sub={`не дошли до 1-го шага: ${t.droppedBeforeFirstStep}`} />
      <KpiTile title="Дошли до результата" value={pct(t.resultRate)} sub={`${t.resultViewed} сессий`} />
      <KpiTile title="CTR CTA" value={pct(t.ctr)} sub={`${t.ctaClicked} кликов / ${t.resultViewed}`} />
      <KpiTile
        highlighted
        title="CTA-конверсия от старта"
        value={pct(t.ctaConversion)}
        sub={`95% CI ${interval(t.ctaConversionCi)}`}
      />
    </Stack>
  );
}
