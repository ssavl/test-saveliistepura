import type { AnalyticsResponse, Variant } from '@funnel/shared';
import { useCallback, useEffect, useState } from 'react';

import { api, errorMessage } from '@/lib/api';

export const ALL = 'all';

export interface AnalyticsFilters {
  slug: string;
  version: string;
  variant: typeof ALL | Variant;
  campaign: string;
}

const AUTO_REFRESH_MS = 10_000;

function toQuery({ slug, version, variant, campaign }: AnalyticsFilters) {
  const q = new URLSearchParams({ slug });
  if (version !== ALL) q.set('version', version);
  if (variant !== ALL) q.set('variant', variant);
  if (campaign !== ALL) q.set('utm_campaign', campaign);
  return q.toString();
}

export function useAnalytics(filters: AnalyticsFilters, autoRefresh: boolean) {
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [error, setError] = useState<string>();
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const query = toQuery(filters);
  const requestKey = `${query}#${tick}`;

  useEffect(() => {
    let cancelled = false;
    api<AnalyticsResponse>(`/api/analytics?${query}`, { admin: true })
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setError(undefined);
        setUpdatedAt(Date.now());
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setSettledKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [query, requestKey]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(reload, AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [autoRefresh, reload]);

  return { data, error, loading: settledKey !== requestKey, updatedAt, reload };
}
