import type { AnalyticsResponse } from '@funnel/shared';
import { Switch } from 'react-native';

import { AppText, Button, Card, Stack, TextField } from '@/components/atoms';
import { LabeledField, type SegmentOption, SegmentedControl } from '@/components/molecules';
import { ALL, type AnalyticsFilters as Filters } from '@/hooks/useAnalytics';
import { time } from '@/lib/format';

export interface AnalyticsFiltersProps {
  filters: Filters;
  onChange: (patch: Partial<Filters>) => void;
  slugDraft: string;
  onSlugDraftChange: (value: string) => void;
  onApplySlug: () => void;
  data: AnalyticsResponse | null;
  loading: boolean;
  onReload: () => void;
  autoRefresh: boolean;
  onAutoRefreshChange: (value: boolean) => void;
  updatedAt: number | null;
}

const ALL_OPTION = { value: ALL, label: 'Все' } as const;
const VARIANT_OPTIONS: readonly SegmentOption<Filters['variant']>[] = [
  ALL_OPTION,
  { value: 'A', label: 'A' },
  { value: 'B', label: 'B' },
];

export function AnalyticsFilters(props: AnalyticsFiltersProps) {
  const { filters, onChange, data } = props;
  const versionOptions = [ALL_OPTION, ...(data?.versions ?? []).map((v) => ({ value: String(v), label: `v${v}` }))];
  const campaignOptions = [ALL_OPTION, ...(data?.campaigns ?? []).map((c) => ({ value: c, label: c }))];

  return (
    <Card>
      <LabeledField label="Воронка (slug)">
        <Stack direction="row" wrap>
          <TextField value={props.slugDraft} onChangeText={props.onSlugDraftChange} onSubmitEditing={props.onApplySlug} />
          <Button size="sm" variant="secondary" title="Применить" onPress={props.onApplySlug} />
        </Stack>
      </LabeledField>
      <SegmentedControl label="Версия" value={filters.version} options={versionOptions} onChange={(version) => onChange({ version })} />
      <SegmentedControl label="Вариант" value={filters.variant} options={VARIANT_OPTIONS} onChange={(variant) => onChange({ variant })} />
      <SegmentedControl
        label="utm_campaign"
        value={filters.campaign}
        options={campaignOptions}
        onChange={(campaign) => onChange({ campaign })}
      />
      <Stack direction="row" wrap>
        <Button size="sm" title="Обновить" onPress={props.onReload} disabled={props.loading} />
        <Switch value={props.autoRefresh} onValueChange={props.onAutoRefreshChange} />
        <AppText variant="muted">Автообновление каждые 10 с</AppText>
        {props.updatedAt ? <AppText variant="caption">обновлено {time(props.updatedAt)}</AppText> : null}
      </Stack>
    </Card>
  );
}
