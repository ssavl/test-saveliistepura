import type { Href } from 'expo-router';
import { useState } from 'react';

import { AppText } from '@/components/atoms';
import { Notice } from '@/components/molecules';
import {
  AbTestCard,
  AnalyticsFilters,
  GroupMetricsTable,
  KpiGrid,
  OtherEventsTable,
  ResultsTable,
  StepsTable,
} from '@/components/organisms';
import { PageTemplate } from '@/components/templates';
import { ALL, type AnalyticsFilters as Filters, useAnalytics } from '@/hooks/useAnalytics';
import { storage } from '@/lib/storage';

const SLUG_KEY = 'funnel:dashboard:slug';
const DEFAULT_SLUG = 'workstyle-planner';

export default function DashboardScreen() {
  const [filters, setFilters] = useState<Filters>(() => ({
    slug: storage.get(SLUG_KEY) ?? DEFAULT_SLUG,
    version: ALL,
    variant: ALL,
    campaign: ALL,
  }));
  const [slugDraft, setSlugDraft] = useState(filters.slug);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const { data, error, loading, updatedAt, reload } = useAnalytics(filters, autoRefresh);

  const patch = (next: Partial<Filters>) => setFilters((cur) => ({ ...cur, ...next }));
  const applySlug = () => {
    const slug = slugDraft.trim();
    if (!slug) return;
    storage.set(SLUG_KEY, slug);
    patch({ slug, version: ALL, campaign: ALL });
  };

  const links = [
    { href: '/admin' as Href, label: 'Версии →' },
    { href: `/f/${filters.slug}?reset=1` as Href, label: 'Открыть воронку →' },
  ];

  return (
    <PageTemplate title="Аналитика воронки" links={links} loading={loading} maxWidth={1100}>
      <AnalyticsFilters
        filters={filters}
        onChange={patch}
        slugDraft={slugDraft}
        onSlugDraftChange={setSlugDraft}
        onApplySlug={applySlug}
        data={data}
        loading={loading}
        onReload={() => void reload()}
        autoRefresh={autoRefresh}
        onAutoRefreshChange={setAutoRefresh}
        updatedAt={updatedAt}
      />
      {error ? <Notice tone="danger" message={error} /> : null}
      {data ? (
        <>
          <KpiGrid totals={data.totals} />
          <StepsTable rows={data.steps} />
          <AbTestCard rows={data.byVariant} test={data.abTest} />
          <ResultsTable rows={data.byResult} />
          <GroupMetricsTable title="Версии" keyTitle="Версия" rows={data.byVersion} formatKey={(k) => `v${k}`} />
          <GroupMetricsTable title="Кампании (utm_campaign)" keyTitle="Кампания" rows={data.byCampaign} />
          <OtherEventsTable rows={data.otherEvents} started={data.totals.started} />
          <AppText variant="caption">
            Все показатели — по уникальным сессиям; raw events: {data.eventCounts.raw} (сессий с событиями:{' '}
            {data.eventCounts.sessions}).
          </AppText>
        </>
      ) : null}
    </PageTemplate>
  );
}
