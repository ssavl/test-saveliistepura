import {
  applyVariant,
  type ConfigIssue,
  type FunnelAdminDto,
  type FunnelConfig,
  type ResolvedFunnel,
  type Variant,
  validateConfig,
} from '@funnel/shared';
import { type Db, tx } from './db';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
  }
}

export function getActiveVersion(db: Db, slug: string): number | null {
  const row = db.prepare('SELECT version FROM funnel_active WHERE slug = ?').get(slug) as { version: number } | undefined;
  return row?.version ?? null;
}

const configCache = new WeakMap<Db, Map<string, FunnelConfig>>();

export function getVersionConfig(db: Db, slug: string, version: number): FunnelConfig | null {
  let cache = configCache.get(db);
  if (!cache) configCache.set(db, (cache = new Map()));
  const key = `${slug}@${version}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const row = db.prepare('SELECT config_json FROM funnel_versions WHERE slug = ? AND version = ?').get(slug, version) as
    | { config_json: string }
    | undefined;
  if (!row) return null;
  const { config } = validateConfig(JSON.parse(row.config_json));
  if (!config) return null;
  cache.set(key, config);
  return config;
}

const funnelCache = new WeakMap<Db, Map<string, ResolvedFunnel>>();

export function getFunnel(db: Db, slug: string, version: number, variant: Variant): ResolvedFunnel | null {
  let cache = funnelCache.get(db);
  if (!cache) funnelCache.set(db, (cache = new Map()));
  const key = `${slug}@${version}/${variant}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const config = getVersionConfig(db, slug, version);
  if (!config) return null;
  const funnel = applyVariant(config, variant);
  cache.set(key, funnel);
  return funnel;
}

export function publishVersion(
  db: Db,
  slug: string,
  raw: unknown,
  note: string | null = null,
): { version: number; issues: ConfigIssue[] } {
  const { config, issues } = validateConfig(raw);
  if (!config || issues.some((i) => i.level === 'error')) {
    throw new HttpError(400, 'Invalid config', { issues });
  }
  if (config.funnelId !== slug) {
    throw new HttpError(400, 'Funnel id mismatch', {
      issues: [{ level: 'error', message: `config.funnelId "${config.funnelId}" != "${slug}"` }],
    });
  }
  const version = config.version;
  return tx(db, () => {
    const now = Date.now();
    if (db.prepare('SELECT 1 FROM funnel_versions WHERE slug = ? AND version = ?').get(slug, version)) {
      throw new HttpError(409, `Version ${version} is already published`, {
        error: `Version ${version} is already published; activate it with rollback instead`,
      });
    }
    const from = getActiveVersion(db, slug);
    db.prepare('INSERT INTO funnel_versions (slug, version, config_json, note, created_at) VALUES (?, ?, ?, ?, ?)').run(
      slug,
      version,
      JSON.stringify(raw),
      note,
      now,
    );
    setActive(db, slug, from, version, 'publish', now);
    return { version, issues };
  });
}

export function rollback(db: Db, slug: string, toVersion?: number): number {
  return tx(db, () => {
    const from = getActiveVersion(db, slug);
    if (from === null) throw new HttpError(404, `Funnel "${slug}" not found`);
    let target = toVersion;
    if (target === undefined) {
      const row = db
        .prepare('SELECT MAX(version) AS v FROM funnel_versions WHERE slug = ? AND version < ?')
        .get(slug, from) as { v: number | null };
      if (row.v === null) throw new HttpError(409, 'No previous version to roll back to');
      target = row.v;
    }
    if (!getVersionConfig(db, slug, target)) throw new HttpError(404, `Version ${target} not found`);
    if (target === from) return from;
    setActive(db, slug, from, target, target < from ? 'rollback' : 'activate', Date.now());
    return target;
  });
}

function setActive(db: Db, slug: string, from: number | null, to: number, action: string, now: number) {
  db.prepare(
    `INSERT INTO funnel_active (slug, version, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (slug) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at`,
  ).run(slug, to, now);
  db.prepare('INSERT INTO version_log (slug, action, from_version, to_version, at) VALUES (?, ?, ?, ?, ?)').run(
    slug,
    action,
    from,
    to,
    now,
  );
}

export function listFunnels(db: Db) {
  return db.prepare('SELECT slug, version AS activeVersion FROM funnel_active ORDER BY slug').all() as {
    slug: string;
    activeVersion: number;
  }[];
}

export function funnelAdmin(db: Db, slug: string): FunnelAdminDto {
  const active = getActiveVersion(db, slug);
  if (active === null) throw new HttpError(404, `Funnel "${slug}" not found`);
  const rows = db
    .prepare(
      `SELECT v.version, v.created_at AS createdAt, v.note, v.config_json,
              (SELECT COUNT(*) FROM sessions s WHERE s.slug = v.slug AND s.version = v.version) AS sessions
       FROM funnel_versions v WHERE v.slug = ? ORDER BY v.version DESC`,
    )
    .all(slug) as { version: number; createdAt: number; note: string | null; config_json: string; sessions: number }[];
  const versions = rows.map(({ config_json, ...v }) => {
    const raw = JSON.parse(config_json) as { status?: string; releaseNote?: string };
    return { ...v, status: raw.status ?? null, releaseNote: raw.releaseNote ?? null };
  });
  const log = db
    .prepare(
      `SELECT action, from_version AS fromVersion, to_version AS toVersion, at
       FROM version_log WHERE slug = ? ORDER BY id DESC LIMIT 50`,
    )
    .all(slug) as unknown as FunnelAdminDto['log'];
  return {
    slug,
    title: getVersionConfig(db, slug, active)?.title ?? slug,
    activeVersion: active,
    versions: versions.map((v) => ({ ...v, active: v.version === active })),
    log,
  };
}
