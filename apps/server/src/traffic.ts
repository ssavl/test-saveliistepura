// Synthetic traffic generator: drives sessions through the REAL HTTP API (see packages/shared/src/api.ts).
// Usage: npm run traffic -- [--sessions 160] [--base-url http://localhost:3000] [--seed 42] ...
import type { AnalyticsResponse } from '@funnel/shared';
import { Api, describe, NetworkError } from './traffic/http';
import { compareAnalytics, expectedFrom, printLocalSummary } from './traffic/report';
import { FatalError, type SessionOutcome, type SimOptions, simulateSession } from './traffic/simulate';

const HELP = `Funnel Runtime — synthetic traffic generator

Drives N sessions through the real HTTP API (POST /api/sessions, PUT /api/sessions/:id/state,
POST /api/events): UTM campaigns, A/B (server-assigned + ~10% variantOverride), branching answers,
drop-offs, back clicks, and dirty delivery (duplicate event_ids, re-sent batches, out-of-order and
shuffled batches, invalid events). Prints the intended numbers and compares them with the change in
GET /api/analytics (fetched before and after the run, so an existing DB is fine).

Usage: npm run traffic -- [options]

Options:
  --sessions N        number of sessions (default 160)
  --base-url URL      server URL (default $BASE_URL or http://localhost:3000)
  --slug SLUG         funnel slug (default bible-plan)
  --seed N            RNG seed for reproducible behaviour (default: random, printed)
  --concurrency N     parallel sessions (default 8)
  --days N            spread client_ts over the last N days (default 7)
  --cta-a P           CTA click probability on the result screen, variant A (default 0.45)
  --cta-b P           CTA click probability on the result screen, variant B (default 0.6)
  --override-rate P   share of sessions that pass variantOverride (default 0.1)
  --clean             disable dirty data (duplicates, resends, reordering, invalid events)
  --no-verify         skip the analytics comparison
  -h, --help          show this help

Exit code: 0 on success; 1 if the server is unreachable, requests failed or numbers mismatched.
Determinism: with the same --seed everything the generator decides (campaigns, overrides, answers,
drop-offs, backs, dirty data, timestamps relative to now) is identical. The A/B split of sessions
without an override is assigned by the server from the random session id, so per-variant numbers
can differ between runs.`;

interface Args {
  sessions: number;
  baseUrl: string;
  slug: string;
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
    slug: 'bible-plan',
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
    // Plausible abandonment: some bounce on the welcome screen, most friction on the number input.
    dropProb: { beforeFirstView: 0.02, start: 0.1, single: 0.05, multi: 0.08, number: 0.14, info: 0.03 },
    backProb: 0.07,
    backFromResultProb: 0.05,
    maxBacks: 2,
    secondaryActionProb: 0.3,
    dirty: args.clean
      ? { dupInBatch: 0, shuffleBatch: 0, invalidInBatch: 0, outOfOrder: 0, resendBatch: 0 }
      : { dupInBatch: 0.07, shuffleBatch: 0.1, invalidInBatch: 0.05, outOfOrder: 0.12, resendBatch: 0.08 },
  };

  console.log(`Traffic → ${args.baseUrl}  slug=${args.slug}  sessions=${args.sessions}  seed=${args.seed}` +
    `  concurrency=${args.concurrency}  cta A/B=${args.ctaA}/${args.ctaB}${args.clean ? '  (clean)' : ''}`);

  // Reachability: any HTTP answer counts; a network error is fatal.
  try {
    const health = await api.get('/api/health');
    if (!health.ok) console.warn(`warning: /api/health → ${describe(health)}`);
  } catch (e) {
    console.error(`error: server unreachable at ${args.baseUrl} (${(e as Error).message})`);
    process.exit(1);
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
