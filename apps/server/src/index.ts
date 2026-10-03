import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app';
import { openDb } from './db';
import { getActiveVersion, publishVersion } from './versions';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PORT = Number(process.env.PORT ?? 3000);
const DB_PATH = process.env.DB_PATH ?? resolve(root, 'apps/server/data/funnel.sqlite');
const CONFIGS_DIR = process.env.CONFIGS_DIR ?? resolve(root, 'configs');
const SEED_CONFIG = process.env.SEED_CONFIG ?? resolve(CONFIGS_DIR, 'funnel-v1.json');

mkdirSync(dirname(DB_PATH), { recursive: true });
const db = openDb(DB_PATH);

const seed = JSON.parse(readFileSync(SEED_CONFIG, 'utf8'));
if (getActiveVersion(db, seed.funnelId) === null) {
  const { version } = publishVersion(db, seed.funnelId, seed, 'seed');
  console.log(`Seeded ${seed.funnelId} v${version}`);
}

const WEB_DIR = process.env.WEB_DIR ?? resolve(root, 'apps/web/dist');
const webBuilt = existsSync(resolve(WEB_DIR, 'index.html'));

const app = buildApp({
  db,
  configsDir: CONFIGS_DIR,
  webDir: WEB_DIR,
  adminToken: process.env.ADMIN_TOKEN || undefined,
  logger: process.env.LOG === '1',
});

function printBanner() {
  const base = `http://localhost:${PORT}`;
  const trafficArgs = PORT === 3000 ? '' : ` -- --base-url ${base}`;
  const lines = [
    '',
    'Funnel Runtime is running',
    `  Funnel      ${base}/`,
    `  Admin       ${base}/admin`,
    `  Dashboard   ${base}/dashboard`,
    `  API health  ${base}/api/health`,
    `  Database    ${DB_PATH}`,
    '',
    `Fill the dashboard with demo traffic (in another terminal):  npm run traffic${trafficArgs}`,
    webBuilt ? '' : '\nWeb client is not built, only the API is served. Run "npm run build" and restart.\n',
  ];
  console.log(lines.join('\n'));
}

app
  .listen({ port: PORT, host: '0.0.0.0' })
  .then(printBanner)
  .catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'EADDRINUSE') {
      console.error(
        `\nPort ${PORT} is already in use. Start on another port:\n` +
          `  macOS / Linux:        PORT=3100 npm start\n` +
          `  Windows (PowerShell): $env:PORT=3100; npm start\n`,
      );
    } else {
      console.error(e);
    }
    process.exit(1);
  });
