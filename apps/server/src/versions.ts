// Funnel versions are immutable rows; publish/rollback only move the `funnel_active` pointer.
import { type ConfigIssue, type FunnelAdminDto, type FunnelConfig, validateConfig } from '@funnel/shared';
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

// Parsed configs are immutable per (slug, version), so caching is safe.
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
  // Stored configs were validated on publish; re-parse applies schema defaults.
  const { config } = validateConfig(JSON.parse(row.config_json));
  if (!config) return null;
  cache.set(key, config);
  return config;
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
  if (config.slug !== slug) {
    throw new HttpError(400, 'Slug mismatch', {
      issues: [{ level: 'error', message: `config.slug "${config.slug}" != "${slug}"` }],
    });
  }
  return tx(db, () => {
    const now = Date.now();
    const { v } = db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM funnel_versions WHERE slug = ?').get(slug) as {
      v: number;
    };
    const version = v + 1;
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

/** Activates `toVersion` or, by default, the closest version below the active one. */
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
  const versions = db
    .prepare(
      `SELECT v.version, v.created_at AS createdAt, v.note,
              (SELECT COUNT(*) FROM sessions s WHERE s.slug = v.slug AND s.version = v.version) AS sessions
       FROM funnel_versions v WHERE v.slug = ? ORDER BY v.version DESC`,
    )
    .all(slug) as { version: number; createdAt: number; note: string | null; sessions: number }[];
  const log = db
    .prepare(
      `SELECT action, from_version AS fromVersion, to_version AS toVersion, at
       FROM version_log WHERE slug = ? ORDER BY id DESC LIMIT 50`,
    )
    .all(slug) as unknown as FunnelAdminDto['log'];
  return {
    slug,
    activeVersion: active,
    versions: versions.map((v) => ({ ...v, active: v.version === active })),
    log,
  };
}
