// Funnel analytics. Every metric counts DISTINCT sessions, so duplicates, repeated views and back-navigation
// never inflate numbers; ordering uses the client `seq`, never arrival order.
import {
  type AnalyticsResponse,
  applyVariant,
  CORE_EVENTS,
  NO_CAMPAIGN,
  type GroupMetrics,
  type StepMetrics,
  type Variant,
} from '@funnel/shared';
import type { Db } from './db';
import { getVersionConfig } from './versions';

export interface AnalyticsFilters {
  version?: number;
  variant?: Variant;
  utm_campaign?: string; // '(none)' selects sessions without a campaign
}

// Evidence that a session saw / finished a step, independent of which events got lost or reordered.
const SEEN = `name IN ('step_viewed','answer_submitted','step_completed','result_viewed','cta_clicked')`;
const DONE = `name IN ('step_completed','cta_clicked')`;
const REACHED_RESULT = `name IN ('result_viewed','cta_clicked')`;

export function computeAnalytics(db: Db, slug: string, filters: AnalyticsFilters = {}): AnalyticsResponse {
  const where = ['slug = ?'];
  const params: (string | number)[] = [slug];
  if (filters.version !== undefined) {
    where.push('funnel_version = ?');
    params.push(filters.version);
  }
  if (filters.variant) {
    where.push('variant = ?');
    params.push(filters.variant);
  }
  if (filters.utm_campaign === NO_CAMPAIGN) where.push('utm_campaign IS NULL');
  else if (filters.utm_campaign) {
    where.push('utm_campaign = ?');
    params.push(filters.utm_campaign);
  }
  const ev = `ev AS (SELECT * FROM events WHERE ${where.join(' AND ')})`;
  const all = <T>(sql: string) => db.prepare(`WITH ${ev} ${sql}`).all(...params) as T[];

  const group = (keyExpr: string) =>
    all<{ key: string | number | null; started: number; result: number; cta: number }>(
      `SELECT ${keyExpr} AS key,
              COUNT(DISTINCT session_id) AS started,
              COUNT(DISTINCT CASE WHEN ${REACHED_RESULT} THEN session_id END) AS result,
              COUNT(DISTINCT CASE WHEN name = 'cta_clicked' THEN session_id END) AS cta
       FROM ev GROUP BY 1 ORDER BY 1`,
    ).map((r) => groupMetrics(r.key === null ? NO_CAMPAIGN : String(r.key), r.started, r.result, r.cta));

  const [totalsRow] = group("'all'");
  const totals = totalsRow ?? groupMetrics('all', 0, 0, 0);

  const stepRows = all<{ step_id: string; viewed: number; completed: number; back: number }>(
    `SELECT step_id,
            COUNT(DISTINCT CASE WHEN ${SEEN} THEN session_id END) AS viewed,
            COUNT(DISTINCT CASE WHEN ${DONE} THEN session_id END) AS completed,
            COUNT(DISTINCT CASE WHEN name = 'back_clicked' THEN session_id END) AS back
     FROM ev WHERE step_id IS NOT NULL GROUP BY step_id`,
  );
  // Drop-off step = the last step seen (highest client seq) by sessions that never reached the result.
  const dropRows = all<{ step_id: string | null; n: number }>(
    `, last AS (
        SELECT session_id, step_id,
               ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY seq DESC, client_ts DESC) AS rn
        FROM ev WHERE ${SEEN} AND step_id IS NOT NULL
      ),
      sess AS (SELECT DISTINCT session_id FROM ev),
      reached AS (SELECT DISTINCT session_id FROM ev WHERE ${REACHED_RESULT})
     SELECT l.step_id, COUNT(*) AS n
     FROM sess s LEFT JOIN last l ON l.session_id = s.session_id AND l.rn = 1
     WHERE s.session_id NOT IN (SELECT session_id FROM reached)
     GROUP BY l.step_id`,
  );
  const dropped = new Map(dropRows.map((r) => [r.step_id, r.n]));

  const versionsInScope =
    filters.version !== undefined
      ? [filters.version]
      : all<{ v: number }>('SELECT DISTINCT funnel_version AS v FROM ev ORDER BY v DESC').map((r) => r.v);
  const { order, types } = stepOrder(db, slug, versionsInScope, filters.variant);
  const byStep = new Map(stepRows.map((r) => [r.step_id, r]));
  for (const r of stepRows) if (!order.includes(r.step_id)) order.push(r.step_id);

  const steps: StepMetrics[] = order.map((stepId) => {
    const r = byStep.get(stepId) ?? { viewed: 0, completed: 0, back: 0 };
    return {
      stepId,
      type: types.get(stepId) ?? null,
      viewed: r.viewed,
      completed: r.completed,
      conversion: ratio(r.completed, r.viewed),
      reach: ratio(r.viewed, totals.started),
      dropped: dropped.get(stepId) ?? 0,
      backClicks: r.back,
    };
  });

  const byVariant = group('variant');
  const a = byVariant.find((g) => g.key === 'A');
  const b = byVariant.find((g) => g.key === 'B');

  const otherEvents = all<{ name: string; sessions: number; events: number }>(
    `SELECT name, COUNT(DISTINCT session_id) AS sessions, COUNT(*) AS events FROM ev
     WHERE name NOT IN (${CORE_EVENTS.map((n) => `'${n}'`).join(',')}) GROUP BY name ORDER BY name`,
  );
  const counts = all<{ raw: number; sessions: number }>(
    'SELECT COUNT(*) AS raw, COUNT(DISTINCT session_id) AS sessions FROM ev',
  )[0];

  return {
    slug,
    filters,
    totals: { ...totals, droppedBeforeFirstStep: dropped.get(null) ?? 0 },
    steps,
    byVariant,
    abTest: abTest(a, b),
    byVersion: group('funnel_version'),
    byCampaign: group('utm_campaign'),
    otherEvents,
    campaigns: (
      db
        .prepare('SELECT DISTINCT COALESCE(utm_campaign, ?) AS c FROM events WHERE slug = ? ORDER BY 1')
        .all(NO_CAMPAIGN, slug) as { c: string }[]
    ).map((r) => r.c),
    versions: (
      db.prepare('SELECT version FROM funnel_versions WHERE slug = ? ORDER BY version').all(slug) as {
        version: number;
      }[]
    ).map((r) => r.version),
    eventCounts: counts,
  };
}

/** Display order: union of BFS orders of the configs in scope, newest version first. */
function stepOrder(db: Db, slug: string, versions: number[], variant?: Variant) {
  const order: string[] = [];
  const types = new Map<string, string>();
  for (const version of versions) {
    const config = getVersionConfig(db, slug, version);
    if (!config) continue;
    for (const v of variant ? [variant] : (['A', 'B'] as const)) {
      const funnel = applyVariant(config, v);
      let prev: string | null = null;
      for (const id of funnel.order) {
        types.set(id, funnel.steps[id].type);
        if (!order.includes(id)) {
          // Insert right after the predecessor from this path so branches sit next to their parent.
          const at = prev === null ? order.length : order.indexOf(prev) + 1;
          order.splice(at, 0, id);
        }
        prev = id;
      }
    }
  }
  // Result steps always go last.
  order.sort((x, y) => Number(types.get(x) === 'result') - Number(types.get(y) === 'result'));
  return { order, types };
}

function ratio(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

export function wilson(successes: number, n: number, z = 1.96): [number, number] | null {
  if (n === 0) return null;
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

function groupMetrics(key: string, started: number, result: number, cta: number): GroupMetrics {
  return {
    key,
    started,
    resultViewed: result,
    ctaClicked: cta,
    resultRate: ratio(result, started),
    ctr: ratio(cta, result),
    ctaConversion: ratio(cta, started),
    ctaConversionCi: wilson(cta, started),
  };
}

/** Two-proportion z-test on the primary metric (cta / started), B vs A. */
function abTest(a?: GroupMetrics, b?: GroupMetrics): AnalyticsResponse['abTest'] {
  if (!a || !b || !a.started || !b.started) return { pValue: null, liftAbs: null, liftRel: null };
  const pa = a.ctaClicked / a.started;
  const pb = b.ctaClicked / b.started;
  const pool = (a.ctaClicked + b.ctaClicked) / (a.started + b.started);
  const se = Math.sqrt(pool * (1 - pool) * (1 / a.started + 1 / b.started));
  const pValue = se > 0 ? 2 * (1 - normalCdf(Math.abs(pb - pa) / se)) : null;
  return { pValue, liftAbs: pb - pa, liftRel: pa > 0 ? (pb - pa) / pa : null };
}

function normalCdf(x: number): number {
  // Abramowitz–Stegun 7.1.26 approximation of erf.
  const t = 1 / (1 + 0.3275911 * (x / Math.SQRT2));
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-(x * x) / 2);
  return 0.5 * (1 + erf);
}
