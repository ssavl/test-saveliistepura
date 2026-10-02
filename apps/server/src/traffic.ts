import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AnalyticsResponse, ConfigIssue, FunnelAdminDto } from '@funnel/shared';
import { Api, describe, NetworkError } from './traffic/http';
import { compareAnalytics, expectedFrom, printLocalSummary } from './traffic/report';
import { FatalError, type SessionOutcome, type SimOptions, simulateSession } from './traffic/simulate';

const HELP = `Funnel Runtime — synthetic traffic generator

Drives N sessions through the real HTTP API (POST /api/sessions, PUT /api/sessions/:id/state,
GET /api/sessions/:id/result, POST /api/events) using the shared engine on the session's pinned
config: UTM campaigns, A/B (server-assigned + ~10% variantOverride), answers that hit every branch and
result (work_mode remote/hybrid/office, meeting_hours >= 15, compliance follow-up), drop-offs, back
clicks with re-answers, and dirty delivery (duplicate event_ids, re-sent batches, out-of-order and
shuffled batches, invalid events). Only events/properties allowed by the pinned version are sent.
Prints the intended numbers and compares them with the change in GET /api/analytics (fetched before
and after the run, so an existing DB is fine).

Usage: npm run traffic -- [options]

Options:
  --sessions N        number of sessions (default 160)
  --base-url URL      server URL (default $BASE_URL or http://localhost:3000)
  --slug SLUG         funnel slug (default workstyle-planner)
  --publish FILE      before generating, publish this config (e.g. configs/funnel-v2.json) via
                      POST /api/admin/funnels/:slug/versions; if it is already published (409) and not
                      active, activate it via POST /api/admin/funnels/:slug/rollback {toVersion}
  --admin-token TOK   x-admin-token for admin calls (default $ADMIN_TOKEN)
  --seed N            RNG seed for reproducible behaviour (default: random, printed)
  --concurrency N     parallel sessions (default 8)
  --days N            spread client_timestamp over the last N days (default 7)
  --cta-a P           CTA click probability on the result screen, variant A (default 0.45)
  --cta-b P           CTA click probability on the result screen, variant B (default 0.6)
  --override-rate P   share of sessions that pass variantOverride (default 0.1)
  --clean             disable dirty data (duplicates, resends, reordering, invalid events)
  --no-verify         skip the analytics comparison
  -h, --help          show this help

Examples (simulate v1, then v2, then v3 on one server):
  npm run traffic -- --seed 1
  npm run traffic -- --seed 2 --publish configs/funnel-v2.json
  npm run traffic -- --seed 3 --publish configs/funnel-v3.json

Exit code: 0 on success; 1 if the server is unreachable, publishing failed, requests failed, a server
result differed from the local engine, or numbers mismatched; 2 on bad arguments.
Determinism: with the same --seed everything the generator decides (campaigns, overrides, answers,
drop-offs, backs, dirty data, timestamps relative to now) is identical. The A/B split of sessions
without an override is assigned by the server, so per-variant numbers can differ between runs.`;

interface Args {
  sessions: number;
  baseUrl: string;
  slug: string;
  publish?: string;
  adminToken?: string;
  seed: number;
  concurrency: number;
  days: number;
  ctaA: number;
  ctaB: number;
  overrideRate: number;
  clean: boolean;
  verify: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    sessions: 160,
    baseUrl: process.env.BASE_URL ?? 'http://localhost:3000',
    slug: 'workstyle-planner',
    adminToken: process.env.ADMIN_TOKEN || undefined,
    seed: Math.floor(Math.random() * 2 ** 31),
    concurrency: 8,
    days: 7,
    ctaA: 0.45,
    ctaB: 0.6,
    overrideRate: 0.1,
    clean: false,
    verify: true,
  };
  const fail = (msg: string): never => {
    console.error(`error: ${msg}\n\nRun with --help for usage.`);
    process.exit(2);
  };
  for (let i = 0; i < argv.length; i++) {
    let flag = argv[i];
    let value: string | undefined;
    const eq = flag.indexOf('=');
    if (flag.startsWith('--') && eq > 0) {
      value = flag.slice(eq + 1);
      flag = flag.slice(0, eq);
    }
    const val = () => value ?? argv[++i] ?? fail(`${flag} needs a value`);
    const num = (min: number, max: number, int = false) => {
      const n = Number(val());
      if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n)))
        fail(`${flag} must be ${int ? 'an integer' : 'a number'} in [${min}, ${max}]`);
      return n;
    };
    switch (flag) {
      case '-h':
      case '--help':
        console.log(HELP);
        process.exit(0);
      case '--sessions': a.sessions = num(1, 100_000, true); break;
      case '--base-url': a.baseUrl = val(); break;
      case '--slug': a.slug = val(); break;
      case '--publish': a.publish = val(); break;
      case '--admin-token': a.adminToken = val(); break;
      case '--seed': a.seed = num(0, 2 ** 32 - 1, true); break;
      case '--concurrency': a.concurrency = num(1, 64, true); break;
      case '--days': a.days = num(0.01, 365); break;
      case '--cta-a': a.ctaA = num(0, 1); break;
      case '--cta-b': a.ctaB = num(0, 1); break;
      case '--override-rate': a.overrideRate = num(0, 1); break;
      case '--clean': a.clean = true; break;
      case '--no-verify': a.verify = false; break;
      default: fail(`unknown option ${flag}`);
    }
  }
  return a;
}

async function fetchAnalytics(api: Api, slug: string): Promise<AnalyticsResponse | null> {
  const res = await api.get<AnalyticsResponse>(`/api/analytics?slug=${encodeURIComponent(slug)}`);
  if (res.ok) return res.body;
  console.warn(`warning: GET /api/analytics unavailable (${describe(res)}) — skipping server comparison`);
  return null;
}

async function publish(api: Api, slug: string, file: string, headers?: Record<string, string>) {
  const candidates = [resolve(file), resolve(import.meta.dirname, '../../..', file)];
  const path = candidates.find((p) => {
    try {
      readFileSync(p);
      return true;
    } catch {
      return false;
    }
  });
  if (!path) {
    console.error(`error: --publish: cannot read ${file}`);
    process.exit(1);
  }
  let config: { version?: unknown; funnelId?: unknown };
  try {
    config = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.error(`error: --publish: ${file} is not valid JSON (${(e as Error).message})`);
    process.exit(1);
  }
  if (config.funnelId !== slug) console.warn(`warning: ${file} has funnelId "${String(config.funnelId)}", publishing to slug "${slug}"`);
  const version = Number(config.version);
  const base = `/api/admin/funnels/${encodeURIComponent(slug)}`;
  const res = await api.post<{ version: number; issues?: ConfigIssue[] }>(`${base}/versions`, { config, note: `traffic generator: ${file}` }, headers);
  const printIssues = (issues: ConfigIssue[] | undefined) => {
    for (const i of issues ?? []) console.log(`  ${i.level}${i.variant ? ` [${i.variant}]` : ''}: ${i.message}`);
  };
  if (res.ok) {
    console.log(`Published ${file} as v${res.body.version}.`);
    printIssues(res.body.issues);
    if (res.body.version !== version) console.warn(`warning: server published v${res.body.version}, config.version is ${version}`);
  } else if (res.status === 409) {
    console.log(`${file}: v${version} is already published.`);
  } else {
    console.error(`error: publishing ${file} failed: ${describe(res)}`);
    if (res.status === 400) printIssues((res.body as { issues?: ConfigIssue[] })?.issues);
    if (res.status === 401 || res.status === 403) console.error('hint: pass --admin-token or set ADMIN_TOKEN');
    process.exit(1);
  }
  const info = await api.get<FunnelAdminDto>(base, headers);
  if (!info.ok) {
    console.error(`error: GET ${base}: ${describe(info)}`);
    process.exit(1);
  }
  if (info.body.activeVersion !== version) {
    const rb = await api.post<FunnelAdminDto>(`${base}/rollback`, { toVersion: version }, headers);
    if (!rb.ok || rb.body.activeVersion !== version) {
      console.error(`error: activating v${version} failed: ${describe(rb)}`);
      process.exit(1);
    }
    console.log(`Activated v${version} (was v${info.body.activeVersion}).`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const api = new Api(args.baseUrl);
  const opts: SimOptions = {
    slug: args.slug,
    seed: args.seed,
    now: Date.now(),
    days: args.days,
    overrideRate: args.overrideRate,
    ctaProb: { A: args.ctaA, B: args.ctaB },
    dropProb: { beforeFirstView: 0.02, start: 0.1, 'single-select': 0.04, 'multi-select': 0.07, number: 0.1, info: 0.03 },
    backProb: 0.07,
    backFromResultProb: 0.06,
    maxBacks: 2,
    reanswerProb: 0.6,
    dirty: args.clean
      ? { dupInBatch: 0, shuffleBatch: 0, invalidInBatch: 0, outOfOrder: 0, resendBatch: 0 }
      : { dupInBatch: 0.07, shuffleBatch: 0.1, invalidInBatch: 0.05, outOfOrder: 0.12, resendBatch: 0.08 },
  };

  console.log(`Traffic → ${args.baseUrl}  slug=${args.slug}  sessions=${args.sessions}  seed=${args.seed}` +
    `  concurrency=${args.concurrency}  cta A/B=${args.ctaA}/${args.ctaB}${args.clean ? '  (clean)' : ''}`);

  try {
    const health = await api.get('/api/health');
    if (!health.ok) console.warn(`warning: /api/health → ${describe(health)}`);
  } catch (e) {
    console.error(`error: server unreachable at ${args.baseUrl} (${(e as Error).message})`);
    process.exit(1);
  }

  const admin = args.adminToken ? { 'x-admin-token': args.adminToken } : undefined;
  if (args.publish) await publish(api, args.slug, args.publish, admin);
  const active = await api.get<FunnelAdminDto>(`/api/admin/funnels/${encodeURIComponent(args.slug)}`, admin);
  if (active.ok) {
    const v = active.body.versions?.find((x) => x.active);
    console.log(`Active version of ${args.slug}: v${active.body.activeVersion}` +
      `${v ? ` (${v.sessions} sessions so far${v.status ? `, status ${v.status}` : ''})` : ''}` +
      `${active.body.versions?.length ? `; published: ${active.body.versions.map((x) => x.version).join(', ')}` : ''}`);
  } else if (args.publish) {
    console.error(`error: GET /api/admin/funnels/${args.slug}: ${describe(active)}`);
    process.exit(1);
  } else {
    console.warn(`warning: active version unknown (GET /api/admin/funnels/${args.slug}: ${describe(active)}); sessions report their pinned version`);
  }

  const before = args.verify ? await fetchAnalytics(api, args.slug) : null;

  const outcomes: SessionOutcome[] = new Array(args.sessions);
  let nextIndex = 0;
  let done = 0;
  let fatal: Error | null = null;
  const started = Date.now();
  const worker = async () => {
    while (!fatal && nextIndex < args.sessions) {
      const i = nextIndex++;
      try {
        outcomes[i] = await simulateSession(api, opts, i);
      } catch (e) {
        if (e instanceof FatalError || e instanceof NetworkError) fatal = e as Error;
        else throw e;
      }
      done++;
      if (process.stdout.isTTY) process.stdout.write(`\r  ${done}/${args.sessions} sessions`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(args.concurrency, args.sessions) }, worker));
  if (process.stdout.isTTY) process.stdout.write('\n');
  if (fatal) {
    console.error(`error: ${(fatal as Error).message}`);
    process.exit(1);
  }
  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s, ${api.requests} HTTP requests.`);

  const errors = outcomes.flatMap((o) => o.errors.map((e) => `session #${o.index}: ${e}`));
  const exp = expectedFrom(outcomes);
  const problems = printLocalSummary(outcomes, exp);
  problems.push(...errors);

  if (args.verify && before) {
    const after = await fetchAnalytics(api, args.slug);
    if (after) problems.push(...compareAnalytics(before, after, exp));
  }

  if (errors.length) {
    console.log(`\nRequest errors (${errors.length}):`);
    for (const e of errors.slice(0, 15)) console.log(`  ${e}`);
    if (errors.length > 15) console.log(`  … ${errors.length - 15} more`);
  }
  if (problems.length) {
    console.log(`\nFAILED: ${problems.length} problem(s).`);
    for (const p of problems.filter((p) => !errors.includes(p)).slice(0, 30)) console.log(`  - ${p}`);
    process.exit(1);
  }
  console.log('\nOK: server numbers match the generator.');
}

main().catch((e) => {
  console.error(e instanceof NetworkError ? `error: server unreachable (${e.message})` : e);
  process.exit(1);
});
