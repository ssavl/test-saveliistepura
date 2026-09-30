// Local "intended" summary and before/after analytics delta comparison.
import type { AnalyticsResponse, GroupMetrics, StepMetrics } from '@funnel/shared';
import { NO_CAMPAIGN, type SessionOutcome } from './simulate';

interface Counts {
  started: number;
  resultViewed: number;
  ctaClicked: number;
}
const zero = (): Counts => ({ started: 0, resultViewed: 0, ctaClicked: 0 });

export interface Expected {
  total: Counts;
  byVariant: Map<string, Counts>;
  byCampaign: Map<string, Counts>;
  steps: Map<string, { viewed: number; completed: number; backClicks: number }>;
  other: Map<string, { sessions: number; events: number }>;
}

export function expectedFrom(outcomes: SessionOutcome[]): Expected {
  const exp: Expected = { total: zero(), byVariant: new Map(), byCampaign: new Map(), steps: new Map(), other: new Map() };
  for (const o of outcomes) {
    if (!o.created) continue;
    for (const c of [exp.total, get(exp.byVariant, o.variant!, zero), get(exp.byCampaign, o.utmCampaign, zero)]) {
      c.started++;
      if (o.reachedResult) c.resultViewed++;
      if (o.ctaClicked) c.ctaClicked++;
    }
    const blank = () => ({ viewed: 0, completed: 0, backClicks: 0 });
    for (const s of o.viewed) get(exp.steps, s, blank).viewed++;
    for (const s of o.completed) get(exp.steps, s, blank).completed++;
    for (const s of o.backOn) get(exp.steps, s, blank).backClicks++;
    for (const [name, n] of o.otherEvents) {
      const e = get(exp.other, name, () => ({ sessions: 0, events: 0 }));
      e.sessions++;
      e.events += n;
    }
  }
  return exp;
}

function get<K, V>(m: Map<K, V>, k: K, init: () => V): V {
  let v = m.get(k);
  if (v === undefined) m.set(k, (v = init()));
  return v;
}

const sum = (outcomes: SessionOutcome[], f: (o: SessionOutcome) => number) => outcomes.reduce((s, o) => s + f(o), 0);
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : '—');

export function table(rows: (string | number)[][], header?: string[]): string {
  const all = header ? [header, ...rows] : rows;
  const widths = all[0].map((_, i) => Math.max(...all.map((r) => String(r[i]).length)));
  const fmt = (r: (string | number)[]) =>
    r.map((c, i) => (typeof c === 'number' ? String(c).padStart(widths[i]) : String(c).padEnd(widths[i]))).join('  ');
  const lines = all.map(fmt);
  if (header) lines.splice(1, 0, widths.map((w) => '-'.repeat(w)).join('  '));
  return lines.map((l) => '  ' + l.trimEnd()).join('\n');
}

export function printLocalSummary(outcomes: SessionOutcome[], exp: Expected) {
  const created = outcomes.filter((o) => o.created);
  console.log(`\n== Generator summary (intended, unique sessions) ==`);
  console.log(`Sessions: ${created.length}/${outcomes.length} created` +
    `, variantOverride used: ${sum(created, (o) => (o.override ? 1 : 0))}` +
    `, versions: ${[...new Set(created.map((o) => o.version))].join(', ')}`);

  console.log('\nBy variant:');
  console.log(table(
    [...exp.byVariant.entries()].sort().map(([k, c]) => [
      k, c.started, c.resultViewed, c.ctaClicked, pct(c.resultViewed, c.started), pct(c.ctaClicked, c.resultViewed), pct(c.ctaClicked, c.started),
    ]),
    ['variant', 'started', 'result', 'cta', 'result/start', 'cta/result', 'cta/start'],
  ));

  console.log('\nBy campaign (utm_campaign):');
  const byCampaignLabel = new Map<string, Set<string>>();
  for (const o of created) get(byCampaignLabel, o.utmCampaign, () => new Set()).add(o.campaign);
  console.log(table(
    [...exp.byCampaign.entries()].sort((a, b) => b[1].started - a[1].started).map(([k, c]) => [
      k, [...(byCampaignLabel.get(k) ?? [])].join(' + '), c.started, c.resultViewed, c.ctaClicked,
    ]),
    ['campaign', 'traffic', 'started', 'result', 'cta'],
  ));

  console.log('\nSteps (unique sessions):');
  console.log(table(
    [...exp.steps.entries()].sort((a, b) => b[1].viewed - a[1].viewed).map(([k, s]) => [k, s.viewed, s.completed, s.backClicks]),
    ['step', 'viewed', 'completed', 'back'],
  ));

  const unique = sum(created, (o) => o.uniqueEvents);
  const validSends = sum(created, (o) => o.validSends);
  const invalid = sum(created, (o) => o.invalidSends);
  console.log('\nEvents & dirty data:');
  console.log(table([
    ['unique events (client-generated, seq>=1)', unique],
    ['valid event sends (incl. duplicates/resends)', validSends],
    ['  duplicate sends total', validSends - unique],
    ['  same event twice inside one batch', sum(created, (o) => o.inBatchDuplicates)],
    ['  resent whole batches', sum(created, (o) => o.resentBatches)],
    ['batches sent (incl. resends)', sum(created, (o) => o.batches)],
    ['out-of-order batches (later sent first)', sum(created, (o) => o.outOfOrderBatches)],
    ['batches with shuffled events', sum(created, (o) => o.shuffledBatches)],
    ['invalid events sent', invalid],
    ['back clicks', sum(created, (o) => o.backClicks)],
    ['state PUTs / 409 conflicts', `${sum(created, (o) => o.stateWrites)} / ${sum(created, (o) => o.stateConflicts)}`],
    ['HTTP retries (5xx/network)', sum(outcomes, (o) => o.httpRetries)],
  ]));

  const ing = {
    accepted: sum(outcomes, (o) => o.ingest.accepted),
    duplicates: sum(outcomes, (o) => o.ingest.duplicates),
    rejected: sum(outcomes, (o) => o.ingest.rejected),
  };
  console.log('\nIngest responses (server says / expected):');
  const ingestRows: [string, number, number][] = [
    ['accepted', ing.accepted, unique],
    ['duplicates', ing.duplicates, validSends - unique],
    ['rejected', ing.rejected, invalid],
  ];
  console.log(table(ingestRows.map(([k, a, e]) => [k, a, e, a === e ? 'ok' : 'MISMATCH']), ['', 'server', 'expected', '']));
  const reasons = new Map<string, number>();
  for (const o of outcomes) for (const r of o.rejectedReasons) reasons.set(r, (reasons.get(r) ?? 0) + 1);
  if (reasons.size) {
    console.log('  rejection reasons:');
    for (const [r, n] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`    ${n}× ${r.slice(0, 120)}`);
  }
  return ingestRows.filter(([, a, e]) => a !== e).map(([k, a, e]) => `ingest ${k}: server ${a}, expected ${e}`);
}

// --- analytics delta ---------------------------------------------------------------------------

type Delta = Map<string, Counts>;

function groupDelta(before: GroupMetrics[] | undefined, after: GroupMetrics[]): Delta {
  const b = new Map((before ?? []).map((g) => [g.key, g]));
  const d: Delta = new Map();
  for (const g of after) {
    const p = b.get(g.key);
    d.set(g.key, {
      started: g.started - (p?.started ?? 0),
      resultViewed: g.resultViewed - (p?.resultViewed ?? 0),
      ctaClicked: g.ctaClicked - (p?.ctaClicked ?? 0),
    });
  }
  return d;
}

export function compareAnalytics(before: AnalyticsResponse | null, after: AnalyticsResponse, exp: Expected): string[] {
  const mismatches: string[] = [];
  const rows: (string | number)[][] = [];
  const cmp = (section: string, key: string, e: Counts, s: Counts | undefined) => {
    for (const m of ['started', 'resultViewed', 'ctaClicked'] as const) {
      const sv = s?.[m] ?? 0;
      const ok = sv === e[m];
      rows.push([section, key, m, e[m], sv, ok ? 'ok' : 'MISMATCH']);
      if (!ok) mismatches.push(`${section} ${key} ${m}: expected +${e[m]}, server +${sv}`);
    }
  };

  cmp('total', 'all', exp.total, {
    started: after.totals.started - (before?.totals.started ?? 0),
    resultViewed: after.totals.resultViewed - (before?.totals.resultViewed ?? 0),
    ctaClicked: after.totals.ctaClicked - (before?.totals.ctaClicked ?? 0),
  });
  const vDelta = groupDelta(before?.byVariant, after.byVariant);
  for (const v of ['A', 'B']) cmp('variant', v, exp.byVariant.get(v) ?? zero(), vDelta.get(v));

  // Campaigns: the server's label for "no utm_campaign" is not part of the contract, so match it to
  // the single leftover server key whose numbers changed.
  const cDelta = groupDelta(before?.byCampaign, after.byCampaign);
  const leftovers = [...cDelta.entries()].filter(([k, c]) => !exp.byCampaign.has(k) && c.started !== 0);
  for (const [k, e] of [...exp.byCampaign.entries()].sort()) {
    if (k === NO_CAMPAIGN && !cDelta.has(k) && leftovers.length === 1) {
      cmp('campaign', `${k}→"${leftovers[0][0]}"`, e, leftovers[0][1]);
      leftovers.length = 0;
    } else cmp('campaign', k, e, cDelta.get(k));
  }
  for (const [k, c] of leftovers) {
    rows.push(['campaign', k, 'started', 0, c.started, 'MISMATCH']);
    mismatches.push(`campaign ${k}: unexpected +${c.started} started`);
  }

  console.log('\n== Analytics check: generator expectation vs server (delta before→after) ==');
  console.log(table(rows, ['group', 'key', 'metric', 'expected', 'server', '']));

  // Steps: viewed/completed/back per step id.
  const bSteps = new Map<string, StepMetrics>((before?.steps ?? []).map((s) => [s.stepId, s]));
  const stepRows: (string | number)[][] = [];
  const stepIds = new Set([...exp.steps.keys(), ...after.steps.map((s) => s.stepId)]);
  for (const id of stepIds) {
    const a = after.steps.find((s) => s.stepId === id);
    const p = bSteps.get(id);
    const e = exp.steps.get(id) ?? { viewed: 0, completed: 0, backClicks: 0 };
    const sv = {
      viewed: (a?.viewed ?? 0) - (p?.viewed ?? 0),
      completed: (a?.completed ?? 0) - (p?.completed ?? 0),
      backClicks: (a?.backClicks ?? 0) - (p?.backClicks ?? 0),
    };
    if (!a && (e.viewed || e.completed)) {
      mismatches.push(`step ${id}: missing from server analytics`);
    }
    const ok = sv.viewed === e.viewed && sv.completed === e.completed && sv.backClicks === e.backClicks;
    if (!ok) mismatches.push(`step ${id}: expected ${fmtStep(e)}, server ${fmtStep(sv)}`);
    stepRows.push([id, `${e.viewed}/${sv.viewed}`, `${e.completed}/${sv.completed}`, `${e.backClicks}/${sv.backClicks}`, ok ? 'ok' : 'MISMATCH']);
  }
  console.log('\nSteps (expected/server delta):');
  console.log(table(stepRows, ['step', 'viewed', 'completed', 'back', '']));

  // Config-defined (non-core) events, if any were emitted.
  if (exp.other.size) {
    const bOther = new Map((before?.otherEvents ?? []).map((o) => [o.name, o]));
    for (const [name, e] of exp.other) {
      const a = after.otherEvents.find((o) => o.name === name);
      const s = (a?.sessions ?? 0) - (bOther.get(name)?.sessions ?? 0);
      if (s !== e.sessions) mismatches.push(`event ${name}: expected +${e.sessions} sessions, server +${s}`);
      console.log(`  ${name}: sessions expected +${e.sessions}, server +${s}`);
    }
  }
  return mismatches;
}

const fmtStep = (s: { viewed: number; completed: number; backClicks: number }) =>
  `viewed ${s.viewed}, completed ${s.completed}, back ${s.backClicks}`;
