import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { FunnelEventInput, SessionResponse } from '@funnel/shared';
import { buildApp } from '../src/app';
import { openDb } from '../src/db';
import { publishVersion } from '../src/versions';

export const SLUG = 'workstyle-planner';
export const loadConfig = (v: number) =>
  JSON.parse(readFileSync(new URL(`../../../configs/funnel-v${v}.json`, import.meta.url), 'utf8'));
export const v1 = loadConfig(1);

export function v1As(version: number, title = `Intro v${version}`) {
  const c = structuredClone(v1);
  c.version = version;
  c.steps.intro.content.title = title;
  return c;
}

export function setup() {
  const db = openDb(':memory:');
  publishVersion(db, SLUG, v1, 'seed');
  const app = buildApp({ db });
  const api = async <T = any>(method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) => {
    const res = await app.inject({ method, url, payload: payload as object });
    return { status: res.statusCode, body: res.json() as T };
  };
  const start = async (extra: Record<string, unknown> = {}) =>
    (await api<SessionResponse>('POST', '/api/sessions', { slug: SLUG, ...extra })).body;
  const publish = (config: unknown) => api('POST', `/api/admin/funnels/${SLUG}/versions`, { config });
  const rollback = (toVersion?: number) => api('POST', `/api/admin/funnels/${SLUG}/rollback`, { toVersion });
  return { db, app, api, start, publish, rollback };
}

export function makeEvent(
  s: SessionResponse,
  name: string,
  stepId: string | null,
  seq: number,
  extra: Partial<FunnelEventInput> = {},
): FunnelEventInput {
  return {
    event_id: randomUUID(),
    session_id: s.session.id,
    name,
    client_timestamp: 1_700_000_000_000 + seq * 1000,
    seq,
    funnel_id: s.session.slug,
    funnel_version: s.session.version,
    experiment_id: s.session.experimentId,
    variant: s.session.variant,
    step_id: stepId,
    utm_campaign: s.session.utm.utm_campaign ?? null,
    properties: {},
    ...extra,
  };
}
