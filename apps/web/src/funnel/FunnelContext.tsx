// Funnel session owner: creates/resumes the server session, keeps answers + history, persists state.
import {
  type AnswerValue,
  type Answers,
  answerKey,
  answerKind,
  applyVariant,
  firstStep,
  type FunnelConfig,
  FunnelConfigSchema,
  isInputStep,
  nextStep,
  pickUtm,
  type ResolvedFunnel,
  type SessionDto,
  type SessionResponse,
  stepPosition,
  validateAnswer,
  type Variant,
} from '@funnel/shared';
import { type Href, router, useGlobalSearchParams } from 'expo-router';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { api, ApiError } from '@/lib/api';
import { storage } from '@/lib/storage';
import { setTrackerSession, track } from '@/lib/tracker';

export interface FunnelData {
  session: SessionDto;
  config: FunnelConfig;
  funnel: ResolvedFunnel;
  answers: Answers;
  history: string[];
  rev: number;
}

type Status = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready' };

interface FunnelActions {
  retry(): void;
  getData(): FunnelData | null;
  /** Makes sure history is non-empty; returns the current step id. */
  ensureStarted(): string;
  /** Browser back / popped screen: truncate history to `stepId`. */
  browserBack(stepId: string): void;
  /** In-app back button. Returns the step to show, or null. */
  backFrom(stepId: string): string | null;
  /** Emits step_viewed for the current step. */
  markViewed(stepId: string): void;
  /** Validates, records the answer, advances history. Returns next step id, or null if not applicable. */
  submit(stepId: string, value: AnswerValue | undefined): { next: string | null; error?: string };
  /** Resolves when the state writer is idle: true if the latest state reached the server. */
  awaitPersist(): Promise<boolean>;
}

interface FunnelContextValue extends FunnelActions {
  slug: string;
  status: Status;
  data: FunnelData | null;
}

const Ctx = createContext<FunnelContextValue | null>(null);

export const stepHref = (slug: string, step: string) => `/f/${slug}/${step}` as Href;
const sidKey = (slug: string) => `funnel:${slug}:sid`;

function readLandingParams(global: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(global)) out[k] = Array.isArray(v) ? v[0] : v;
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    new URLSearchParams(window.location.search).forEach((v, k) => {
      if (out[k] === undefined) out[k] = v;
    });
  }
  return out;
}

function loadErrorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.status === 0 ? 'Could not reach the server. Check your connection.' : e.message;
  return e instanceof Error ? e.message : String(e);
}

export function FunnelProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const globalParams = useGlobalSearchParams();
  // Landing query (utm_*, variant, reset) is captured once: step URLs don't carry it.
  const [landing] = useState(() => readLandingParams(globalParams));
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [data, setData] = useState<FunnelData | null>(null);
  const dataRef = useRef<FunnelData | null>(null);
  const resetDone = useRef(false);
  const writer = useRef({
    writing: false,
    dirty: false,
    retry: null as ReturnType<typeof setTimeout> | null,
    waiters: [] as ((ok: boolean) => void)[],
  });
  const lastView = useRef({ key: '', at: 0 });

  const commit = useCallback((patch: Partial<FunnelData>) => {
    if (!dataRef.current) return;
    dataRef.current = { ...dataRef.current, ...patch };
    setData(dataRef.current);
  }, []);

  const adopt = useCallback(
    (res: SessionResponse) => {
      const d = dataRef.current;
      if (!d || res.session.id !== d.session.id) return;
      const history = sanitizeHistory(res.session.state.history, d.funnel);
      commit({ answers: res.session.state.answers ?? {}, history, rev: res.session.rev });
      router.replace(stepHref(slug, history[history.length - 1]));
    },
    [commit, slug],
  );

  // Serialized state writer: at most one PUT in flight, always sends the latest state.
  const persist = useCallback(async () => {
    const w = writer.current;
    w.dirty = true;
    if (w.writing) return;
    w.writing = true;
    if (w.retry) clearTimeout(w.retry);
    w.retry = null;
    let ok = true;
    try {
      while (w.dirty) {
        w.dirty = false;
        const d = dataRef.current;
        if (!d) return;
        try {
          const res = await api<{ rev: number }>(`/api/sessions/${d.session.id}/state`, {
            method: 'PUT',
            body: { state: { answers: d.answers, history: d.history }, rev: d.rev },
          });
          commit({ rev: res.rev });
        } catch (e) {
          if (e instanceof ApiError && e.status === 409 && e.body && typeof e.body === 'object' && 'session' in e.body) {
            // Another tab won: the server state is now the source of truth.
            adopt(e.body as SessionResponse);
            w.dirty = false;
          } else if (!(e instanceof ApiError) || e.status === 0 || e.status >= 500) {
            ok = false;
            w.retry = setTimeout(() => void persist(), 3000);
          } else {
            ok = false;
            console.warn('[funnel] state not saved', e);
          }
          return;
        }
      }
    } finally {
      w.writing = false;
      if (!w.dirty || !ok) {
        const waiters = w.waiters;
        w.waiters = [];
        waiters.forEach((resolve) => resolve(ok));
      }
    }
  }, [adopt, commit]);

  const load = useCallback(async () => {
    setStatus({ kind: 'loading' });
    try {
      if (landing.reset === '1' && !resetDone.current) {
        resetDone.current = true;
        storage.remove(sidKey(slug));
      }
      // The override param name is config.experiment.overrideQueryParam, but the config is only known after
      // this request, so the landing URL's `variant` (the default name, used by all provided configs) is read.
      const variantOverride: Variant | undefined =
        landing.variant === 'A' || landing.variant === 'B' ? landing.variant : undefined;
      const res = await api<SessionResponse>('/api/sessions', {
        body: { slug, sessionId: storage.get(sidKey(slug)) ?? undefined, utm: pickUtm(landing), variantOverride },
      });
      storage.set(sidKey(slug), res.session.id);
      // Parse to apply schema defaults in case the server returns the config as authored.
      const config = FunnelConfigSchema.parse(res.config);
      const funnel = applyVariant(config, res.session.variant);
      const history = sanitizeHistory(res.session.state?.history ?? [], funnel, true);
      dataRef.current = {
        session: res.session,
        config,
        funnel,
        answers: res.session.state?.answers ?? {},
        history,
        rev: res.session.rev,
      };
      setData(dataRef.current);
      setTrackerSession(res.session, funnel.events);
      setStatus({ kind: 'ready' });
    } catch (e) {
      setStatus({ kind: 'error', message: loadErrorMessage(e) });
    }
  }, [landing, slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const actions = useMemo<FunnelActions>(
    () => ({
      retry: () => void load(),
      getData: () => dataRef.current,
      ensureStarted() {
        const d = dataRef.current!;
        if (d.history.length) return d.history[d.history.length - 1];
        const start = firstStep(d.funnel, {});
        commit({ history: [start] });
        void persist();
        return start;
      },
      browserBack(stepId) {
        const d = dataRef.current!;
        const idx = d.history.indexOf(stepId);
        if (idx < 0 || idx === d.history.length - 1) return;
        const left = d.history[d.history.length - 1];
        track('back_clicked', left, { destination_step_id: stepId });
        commit({ history: d.history.slice(0, idx + 1) });
        void persist();
      },
      backFrom(stepId) {
        const d = dataRef.current!;
        const idx = d.history.indexOf(stepId);
        if (idx < 1) return null;
        const to = d.history[idx - 1];
        track('back_clicked', stepId, { destination_step_id: to });
        commit({ history: d.history.slice(0, idx) });
        void persist();
        return to;
      },
      markViewed(stepId) {
        const d = dataRef.current!;
        // Guards against a double focus callback for the same view.
        const key = `${d.session.id}|${d.history.length}|${stepId}`;
        const now = Date.now();
        if (lastView.current.key === key && now - lastView.current.at < 500) return;
        lastView.current = { key, at: now };
        const pos = stepPosition(d.funnel, stepId, d.answers);
        track('step_viewed', stepId, {
          step_type: d.funnel.steps[stepId]?.type,
          visible_step_index: pos.index,
          visible_step_count: pos.count,
        });
      },
      submit(stepId, value) {
        const d = dataRef.current!;
        const step = d.funnel.steps[stepId];
        // Ignore stale submits (double tap, screen no longer current).
        if (!step || d.history[d.history.length - 1] !== stepId) return { next: null };
        const v = validateAnswer(step, value);
        if (!v.ok) return { next: null, error: v.error };
        let answers = d.answers;
        const key = answerKey(step);
        if (key && isInputStep(step)) {
          answers = { ...answers, [key]: value as AnswerValue };
          track('answer_submitted', stepId, { answer_kind: answerKind(step) });
        }
        const next = nextStep(d.funnel, stepId, answers);
        track('step_completed', stepId, { next_step_id: next });
        const history = next ? [...d.history, next] : d.history;
        commit({ answers, history });
        void persist();
        return { next };
      },
      awaitPersist() {
        return new Promise<boolean>((resolve) => {
          const w = writer.current;
          if (!w.writing && !w.dirty && !w.retry) return resolve(true);
          w.waiters.push(resolve);
          // A failed write waiting for its retry timer is retried right away.
          if (!w.writing) void persist();
        });
      },
    }),
    [commit, load, persist],
  );

  const value = useMemo<FunnelContextValue>(
    () => ({ slug, status, data, ...actions }),
    [slug, status, data, actions],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Drops steps unknown to this funnel version; a fresh session starts empty (index route pushes the first step). */
function sanitizeHistory(history: string[], funnel: ResolvedFunnel, allowEmpty = false): string[] {
  const clean = (history ?? []).filter((id) => funnel.steps[id]);
  if (!clean.length && !allowEmpty) return [firstStep(funnel, {})];
  return clean;
}

export function useFunnel(): FunnelContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useFunnel must be used inside FunnelProvider');
  return v;
}
