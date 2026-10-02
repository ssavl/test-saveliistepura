import type { AnalyticsResponse, Variant } from '@funnel/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

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
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const requestId = useRef(0);
  const query = toQuery(filters);

  const reload = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const res = await api<AnalyticsResponse>(`/api/analytics?${query}`, { admin: true });
      if (id !== requestId.current) return;
      setData(res);
      setError(undefined);
      setUpdatedAt(Date.now());
    } catch (e) {
      if (id === requestId.current) setError(errorMessage(e));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => void reload(), AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [autoRefresh, reload]);

  return { data, error, loading, updatedAt, reload };
}
