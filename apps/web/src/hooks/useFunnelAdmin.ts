import type { ConfigIssue, FunnelAdminDto } from '@funnel/shared';
import { useCallback, useEffect, useState } from 'react';

import { ADMIN_TOKEN_KEY, api, ApiError, errorMessage } from '@/lib/api';
import { storage } from '@/lib/storage';

export interface FunnelSummary {
  slug: string;
  activeVersion: number | null;
}

export interface ShownVersion {
  version: number;
  json: string;
}

const DEFAULT_SLUG = 'workstyle-planner';
const enc = encodeURIComponent;

const hasIssues = (body: unknown): body is { issues: ConfigIssue[] } =>
  !!body && typeof body === 'object' && 'issues' in body;

async function fetchFunnels() {
  const list = await api<FunnelSummary[]>('/api/admin/funnels', { admin: true });
  const { files } = await api<{ files: string[] }>('/api/admin/config-files', { admin: true }).catch(() => ({
    files: [] as string[],
  }));
  return { list, files };
}

export function useFunnelAdmin() {
  const [token, setToken] = useState(() => storage.get(ADMIN_TOKEN_KEY) ?? '');
  const [funnels, setFunnels] = useState<FunnelSummary[]>([]);
  const [slug, setSlug] = useState(DEFAULT_SLUG);
  const [info, setInfo] = useState<FunnelAdminDto | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [shown, setShown] = useState<ShownVersion | null>(null);
  const [json, setJsonState] = useState('');
  const [note, setNote] = useState('');
  const [issues, setIssues] = useState<ConfigIssue[] | null>(null);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  const loadFunnels = useCallback(
    () =>
      fetchFunnels()
        .then(({ list, files: names }) => {
          setFunnels(list);
          setSlug((cur) => cur || list[0]?.slug || '');
          setFiles(names);
        })
        .catch((e) => setError(errorMessage(e))),
    [],
  );

  const loadFunnel = useCallback((target: string) => {
    if (!target) return Promise.resolve();
    return api<FunnelAdminDto>(`/api/admin/funnels/${enc(target)}`, { admin: true })
      .then(setInfo)
      .catch((e) => {
        setInfo(null);
        setError(errorMessage(e));
      });
  }, []);

  useEffect(() => {
    void loadFunnels();
  }, [loadFunnels]);

  useEffect(() => {
    void loadFunnel(slug);
  }, [slug, loadFunnel]);

  const selectSlug = (next: string) => {
    setShown(null);
    setSlug(next);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const saveToken = () => {
    storage.set(ADMIN_TOKEN_KEY, token.trim());
    setError(undefined);
    void loadFunnels();
  };

  const setJson = (value: string) => {
    setJsonState(value);
    setIssues(null);
  };

  const rollback = (toVersion?: number) =>
    run(async () => {
      const res = await api<FunnelAdminDto>(`/api/admin/funnels/${enc(slug)}/rollback`, {
        admin: true,
        body: toVersion === undefined ? {} : { toVersion },
      });
      setInfo(res);
      setMessage(`Активная версия: v${res.activeVersion}`);
      void loadFunnels();
    });

  const toggleJson = (version: number) =>
    run(async () => {
      if (shown?.version === version) return setShown(null);
      const res = await api<{ config: unknown }>(`/api/admin/funnels/${enc(slug)}/versions/${version}`, {
        admin: true,
      });
      setShown({ version, json: JSON.stringify(res.config, null, 2) });
    });

  const loadFile = (name: string) =>
    run(async () => {
      const raw = await api<unknown>(`/api/admin/config-files/${enc(name)}`, { admin: true });
      setJson(JSON.stringify(raw, null, 2));
      setMessage(`Загружен ${name}`);
    });

  const parseDraft = (): { config: unknown; slug: string } | null => {
    try {
      const config = JSON.parse(json) as { funnelId?: unknown };
      return { config, slug: typeof config?.funnelId === 'string' ? config.funnelId : slug };
    } catch (e) {
      setIssues([{ level: 'error', message: `Невалидный JSON: ${(e as Error).message}` }]);
      return null;
    }
  };

  const validate = () =>
    run(async () => {
      const draft = parseDraft();
      if (!draft) return;
      const res = await api<{ issues: ConfigIssue[] }>('/api/admin/validate', {
        admin: true,
        body: { config: draft.config },
      });
      setIssues(res.issues);
    });

  const publish = () =>
    run(async () => {
      const draft = parseDraft();
      if (!draft) return;
      try {
        const res = await api<{ version: number; issues: ConfigIssue[] }>(`/api/admin/funnels/${enc(draft.slug)}/versions`, {
          admin: true,
          body: { config: draft.config, note: note.trim() || undefined },
        });
        setIssues(res.issues ?? []);
        setMessage(`Опубликована версия v${res.version} (${draft.slug})`);
        setNote('');
        if (draft.slug !== slug) selectSlug(draft.slug);
        else void loadFunnel(draft.slug);
        void loadFunnels();
      } catch (e) {
        if (e instanceof ApiError && e.status === 400 && hasIssues(e.body)) {
          setIssues(e.body.issues);
          throw new Error('Публикация отклонена: исправьте ошибки');
        }
        if (e instanceof ApiError && e.status === 409) throw new Error(`Публикация отклонена: ${e.message}`);
        throw e;
      }
    });

  return {
    token,
    setToken,
    saveToken,
    funnels,
    slug,
    setSlug: selectSlug,
    info,
    files,
    shown,
    json,
    setJson,
    note,
    setNote,
    issues,
    error,
    message,
    busy,
    refresh: () => loadFunnel(slug),
    rollback,
    toggleJson,
    loadFile,
    validate,
    publish,
  };
}

export type FunnelAdmin = ReturnType<typeof useFunnelAdmin>;
