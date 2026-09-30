import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { FunnelEventInput, SessionResponse } from '@funnel/shared';
import { buildApp } from '../src/app';
import { openDb } from '../src/db';
import { publishVersion } from '../src/versions';

export const v1 = JSON.parse(readFileSync(new URL('../../../configs/v1.json', import.meta.url), 'utf8'));

/** v1 with a changed result title — enough to tell versions apart. */
export function v1WithTitle(title: string) {
  const c = structuredClone(v1);
  c.steps.find((s: { id: string }) => s.id === 'result').title = title;
  return c;
}

export function setup() {
  const db = openDb(':memory:');
  publishVersion(db, 'bible-plan', v1, 'seed');
  const app = buildApp({ db });
  const api = async <T = any>(method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) => {
    const res = await app.inject({ method, url, payload: payload as object });
    return { status: res.statusCode, body: res.json() as T };
  };
  const start = async (extra: Record<string, unknown> = {}) =>
    (await api<SessionResponse>('POST', '/api/sessions', { slug: 'bible-plan', ...extra })).body;
  return { db, app, api, start };
}

export function makeEvent(s: SessionResponse, name: string, stepId: string | null, seq: number, extra: Partial<FunnelEventInput> = {}): FunnelEventInput {
  return {
    event_id: randomUUID(),
    session_id: s.session.id,
    name,
    client_ts: 1_700_000_000_000 + seq * 1000,
    seq,
    funnel_version: s.session.version,
    variant: s.session.variant,
    step_id: stepId,
    utm: s.session.utm,
    props: {},
    ...extra,
  };
}
