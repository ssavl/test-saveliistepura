import { randomUUID } from 'node:crypto';
import {
  type FunnelConfig,
  type ResultResponse,
  resolveResult,
  type SessionDto,
  type SessionResponse,
  type SessionState,
  type Variant,
} from '@funnel/shared';
import { z } from 'zod';
import { type Db, tx } from './db';
import { getActiveVersion, getFunnel, getVersionConfig, HttpError } from './versions';

export function hashUnit(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 2 ** 32;
}

export function assignVariant(sessionId: string, config: FunnelConfig): Variant {
  const { A, B } = config.experiment.variants;
  return hashUnit(`${sessionId}:${config.experiment.id}`) < B.weight / (A.weight + B.weight) ? 'B' : 'A';
}

const ttlMs = (config: FunnelConfig) => config.session.ttlHours * 3_600_000;

interface SessionRow {
  id: string;
  slug: string;
  version: number;
  experiment_id: string;
  variant: Variant;
  utm_json: string;
  state_json: string;
  rev: number;
  created_at: number;
  expires_at: number;
}

const toDto = (r: SessionRow): SessionDto => ({
  id: r.id,
  slug: r.slug,
  version: r.version,
  experimentId: r.experiment_id,
  variant: r.variant,
  utm: JSON.parse(r.utm_json),
  state: JSON.parse(r.state_json),
  rev: r.rev,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
});

export function loadSession(db: Db, id: string): SessionDto | null {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
  return row ? toDto(row) : null;
}

function withConfig(db: Db, session: SessionDto, resumed: boolean): SessionResponse {
  const config = getVersionConfig(db, session.slug, session.version);
  if (!config) throw new HttpError(500, `Pinned version ${session.version} is missing`);
  return { session, config, resumed };
}

export const CreateSessionBody = z.object({
  slug: z.string().min(1),
  sessionId: z.string().optional(),
  utm: z.record(z.string(), z.string().max(200)).optional(),
  variantOverride: z.enum(['A', 'B']).optional(),
});

export function createOrResumeSession(db: Db, body: z.infer<typeof CreateSessionBody>): SessionResponse {
  if (body.sessionId) {
    const existing = loadSession(db, body.sessionId);
    if (
      existing &&
      existing.slug === body.slug &&
      existing.expiresAt > Date.now() &&
      (!body.variantOverride || body.variantOverride === existing.variant)
    ) {
      return withConfig(db, existing, true);
    }
  }
  return tx(db, () => {
    const version = getActiveVersion(db, body.slug);
    if (version === null) throw new HttpError(404, `Funnel "${body.slug}" not found`);
    const config = getVersionConfig(db, body.slug, version)!;
    const id = randomUUID();
    const variant = body.variantOverride ?? assignVariant(id, config);
    const utm = body.utm ?? {};
    const now = Date.now();
    const state: SessionState = { answers: {}, history: [] };
    db.prepare(
      `INSERT INTO sessions (id, slug, version, experiment_id, variant, utm_json, state_json, rev,
                             created_at, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    ).run(
      id,
      body.slug,
      version,
      config.experiment.id,
      variant,
      JSON.stringify(utm),
      JSON.stringify(state),
      now,
      now,
      now + ttlMs(config),
    );
    db.prepare(
      `INSERT INTO events (event_id, session_id, slug, name, step_id, funnel_version, experiment_id, variant,
                           utm_source, utm_medium, utm_campaign, utm_json, props_json, client_ts, seq, server_ts)
       VALUES (?, ?, ?, 'session_started', NULL, ?, ?, ?, ?, ?, ?, ?, '{}', ?, 0, ?)`,
    ).run(
      randomUUID(),
      id,
      body.slug,
      version,
      config.experiment.id,
      variant,
      utm.utm_source ?? null,
      utm.utm_medium ?? null,
      utm.utm_campaign ?? null,
      JSON.stringify(utm),
      now,
      now,
    );
    return withConfig(db, loadSession(db, id)!, false);
  });
}

export function getSession(db: Db, id: string): SessionResponse {
  const s = loadSession(db, id);
  if (!s) throw new HttpError(404, 'Session not found');
  return withConfig(db, s, true);
}

const AnswerValue = z.union([z.string().max(200), z.array(z.string().max(200)).max(50), z.number(), z.null()]);
export const UpdateStateBody = z.object({
  state: z.object({
    answers: z.record(z.string(), AnswerValue),
    history: z.array(z.string()).max(200),
  }),
  rev: z.number().int().min(0),
});

export function updateState(db: Db, id: string, body: z.infer<typeof UpdateStateBody>): { rev: number } {
  return tx(db, () => {
    const s = loadSession(db, id);
    if (!s) throw new HttpError(404, 'Session not found');
    if (s.rev !== body.rev) throw new HttpError(409, 'Stale state revision', withConfig(db, s, true));
    const config = getVersionConfig(db, s.slug, s.version)!;
    const funnel = getFunnel(db, s.slug, s.version, s.variant)!;
    const unknown = body.state.history.find((stepId) => !funnel.steps[stepId]);
    if (unknown) throw new HttpError(400, `Step "${unknown}" is not part of version ${s.version}/${s.variant}`);
    const rev = s.rev + 1;
    const now = Date.now();
    const state = config.session.persistAnswers ? body.state : { ...body.state, answers: {} };
    db.prepare('UPDATE sessions SET state_json = ?, rev = ?, updated_at = ?, expires_at = ? WHERE id = ?').run(
      JSON.stringify(state),
      rev,
      now,
      now + ttlMs(config),
      id,
    );
    return { rev };
  });
}

export function getResult(db: Db, id: string): ResultResponse {
  const s = loadSession(db, id);
  if (!s) throw new HttpError(404, 'Session not found');
  const funnel = getFunnel(db, s.slug, s.version, s.variant);
  if (!funnel) throw new HttpError(500, `Pinned version ${s.version} is missing`);
  return { result: resolveResult(funnel, s.state.answers) };
}
