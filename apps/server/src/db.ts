import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

const MIGRATIONS: string[] = [
  `
  CREATE TABLE funnel_versions (
    slug        TEXT    NOT NULL,
    version     INTEGER NOT NULL,
    config_json TEXT    NOT NULL,
    note        TEXT,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (slug, version)
  );
  CREATE TABLE funnel_active (
    slug       TEXT PRIMARY KEY,
    version    INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE version_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    slug         TEXT    NOT NULL,
    action       TEXT    NOT NULL,
    from_version INTEGER,
    to_version   INTEGER NOT NULL,
    at           INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    id         TEXT PRIMARY KEY,
    slug       TEXT    NOT NULL,
    version    INTEGER NOT NULL,
    variant    TEXT    NOT NULL,
    utm_json   TEXT    NOT NULL,
    state_json TEXT    NOT NULL,
    rev        INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (slug, version) REFERENCES funnel_versions (slug, version)
  );
  CREATE TABLE events (
    event_id       TEXT PRIMARY KEY,
    session_id     TEXT    NOT NULL,
    slug           TEXT    NOT NULL,
    name           TEXT    NOT NULL,
    step_id        TEXT,
    funnel_version INTEGER NOT NULL,
    variant        TEXT    NOT NULL,
    utm_campaign   TEXT,
    utm_json       TEXT    NOT NULL,
    props_json     TEXT    NOT NULL,
    client_ts      INTEGER NOT NULL,
    seq            INTEGER NOT NULL,
    server_ts      INTEGER NOT NULL
  );
  CREATE INDEX events_session ON events (session_id, seq);
  CREATE INDEX events_slug_name ON events (slug, name, step_id);
  `,
  `
  ALTER TABLE sessions ADD COLUMN experiment_id TEXT NOT NULL DEFAULT '';
  ALTER TABLE sessions ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE events ADD COLUMN experiment_id TEXT NOT NULL DEFAULT '';
  ALTER TABLE events ADD COLUMN utm_source TEXT;
  ALTER TABLE events ADD COLUMN utm_medium TEXT;
  CREATE INDEX events_slug_version ON events (slug, funnel_version, variant);
  `,
];

export function openDb(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db: Db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null };
  for (let v = (row.v ?? 0) + 1; v <= MIGRATIONS.length; v++) {
    tx(db, () => {
      db.exec(MIGRATIONS[v - 1]);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(v, Date.now());
    });
  }
}

export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
