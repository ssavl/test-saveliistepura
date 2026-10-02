import type { GroupMetrics } from '@funnel/shared';

import type { DataTableColumn } from '@/components/organisms/DataTable';
import { interval, pct } from '@/lib/format';

export const groupColumns = (keyTitle: string, formatKey: (key: string) => string = (k) => k): DataTableColumn<GroupMetrics>[] => [
  { title: keyTitle, width: 120, align: 'left', render: (g) => formatKey(g.key) },
  { title: 'Начали', width: 80, render: (g) => g.started },
  { title: 'Результат', width: 90, render: (g) => g.resultViewed },
  { title: 'CTA', width: 70, render: (g) => g.ctaClicked },
  { title: 'До результата', width: 110, render: (g) => pct(g.resultRate) },
  { title: 'CTR CTA', width: 90, render: (g) => pct(g.ctr) },
  { title: 'CTA от старта', width: 110, render: (g) => pct(g.ctaConversion) },
  { title: '95% CI', width: 150, render: (g) => interval(g.ctaConversionCi) },
];

export const resultColumns: DataTableColumn<GroupMetrics>[] = [
  { title: 'Результат', width: 180, align: 'left', render: (g) => g.key },
  { title: 'Увидели (сессии)', width: 130, render: (g) => g.started },
  { title: 'Клики CTA', width: 100, render: (g) => g.ctaClicked },
  { title: 'CTR', width: 90, render: (g) => pct(g.ctr) },
];

export const byKey = (g: GroupMetrics) => g.key;
