import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app';
import { openDb } from './db';
import { getActiveVersion, publishVersion } from './versions';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PORT = Number(process.env.PORT ?? 3000);
const DB_PATH = process.env.DB_PATH ?? resolve(root, 'apps/server/data/funnel.sqlite');
const CONFIGS_DIR = process.env.CONFIGS_DIR ?? resolve(root, 'configs');
const SEED_CONFIG = process.env.SEED_CONFIG ?? resolve(CONFIGS_DIR, 'v1.json');

mkdirSync(dirname(DB_PATH), { recursive: true });
const db = openDb(DB_PATH);

// First boot: publish the seed config so the funnel works out of the box.
const seed = JSON.parse(readFileSync(SEED_CONFIG, 'utf8'));
if (getActiveVersion(db, seed.slug) === null) {
  const { version } = publishVersion(db, seed.slug, seed, 'seed');
  console.log(`Seeded ${seed.slug} v${version}`);
}

const app = buildApp({
  db,
  configsDir: CONFIGS_DIR,
  webDir: process.env.WEB_DIR ?? resolve(root, 'apps/web/dist'),
  adminToken: process.env.ADMIN_TOKEN || undefined,
  logger: process.env.LOG !== '0',
});

app.listen({ port: PORT, host: '0.0.0.0' }).catch((e) => {
  console.error(e);
  process.exit(1);
});
