// Local "intended" summary and before/after analytics delta comparison.
import type { AnalyticsResponse, GroupMetrics, StepMetrics } from '@funnel/shared';
import type { SessionOutcome } from './simulate';

interface Counts {
  started: number;
  resultViewed: number;
  ctaClicked: number;
}
const zero = (): Counts => ({ started: 0, resultViewed: 0, ctaClicked: 0 });

export interface StepCounts {
  viewed: number;
  completed: number;
  backClicks: number;
  dropped: number;
}
const blankStep = (): StepCounts => ({ viewed: 0, completed: 0, backClicks: 0, dropped: 0 });

export interface Expected {
  total: Counts;
  droppedBeforeFirstStep: number;
  byVariant: Map<string, Counts>;
  byCampaign: Map<string, Counts>;
  byVersion: Map<string, Counts>;
  byResult: Map<string, Counts>; // started = sessions that saw this result
  steps: Map<string, StepCounts>;
  other: Map<string, { sessions: number; events: number }>;
}

export function expectedFrom(outcomes: SessionOutcome[]): Expected {
  const exp: Expected = {
    total: zero(),
    droppedBeforeFirstStep: 0,
    byVariant: new Map(),
    byCampaign: new Map(),
    byVersion: new Map(),
    byResult: new Map(),
    steps: new Map(),
    other: new Map(),
  };
  for (const o of outcomes) {
    if (!o.created) continue;
    const groups = [exp.total, get(exp.byVariant, o.variant!, zero), get(exp.byCampaign, o.utmCampaign, zero), get(exp.byVersion, String(o.version), zero)];
    for (const c of groups) {
      c.started++;
      if (o.reachedResult) c.resultViewed++;
      if (o.ctaClicked) c.ctaClicked++;
    }
    for (const r of o.resultsSeen) {
      const c = get(exp.byResult, r, zero);
      c.started++;
      c.resultViewed++;
      if (o.ctaResult === r) c.ctaClicked++;
    }
    for (const s of o.viewed) get(exp.steps, s, blankStep).viewed++;
    for (const s of o.completed) get(exp.steps, s, blankStep).completed++;
    for (const s of o.backOn) get(exp.steps, s, blankStep).backClicks++;
    if (!o.lastViewed) exp.droppedBeforeFirstStep++;
    else if (!o.reachedResult) get(exp.steps, o.lastViewed, blankStep).dropped++;
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


const groupRows = (m: Map<string, Counts>, sort: (a: [string, Counts], b: [string, Counts]) => number) =>
  [...m.entries()].sort(sort).map(([k, c]) => [
    k, c.started, c.resultViewed, c.ctaClicked, pct(c.resultViewed, c.started), pct(c.ctaClicked, c.resultViewed), pct(c.ctaClicked, c.started),
  ]);
const GROUP_HEADER = ['started', 'result', 'cta', 'result/start', 'cta/result', 'cta/start'];
const byKey = (a: [string, Counts], b: [string, Counts]) => a[0].localeCompare(b[0]);
const byStarted = (a: [string, Counts], b: [string, Counts]) => b[1].started - a[1].started || byKey(a, b);

export function printLocalSummary(outcomes: SessionOutcome[], exp: Expected) {
  const created = outcomes.filter((o) => o.created);
  console.log(`\n== Generator summary (intended, unique sessions) ==`);
  console.log(`Sessions: ${created.length}/${outcomes.length} created` +
    `, variantOverride used: ${sum(created, (o) => (o.override ? 1 : 0))}` +
    `, versions: ${[...new Set(created.map((o) => o.version))].join(', ')}`);

  console.log('\nBy variant:');
  console.log(table(groupRows(exp.byVariant, byKey), ['variant', ...GROUP_HEADER]));
  console.log('\nBy version:');
  console.log(table(groupRows(exp.byVersion, byKey), ['version', ...GROUP_HEADER]));
  console.log('\nBy result (started = sessions that saw the result):');
  console.log(table(groupRows(exp.byResult, byStarted).map((r) => [r[0], r[1], r[3], r[5]]), ['result', 'sessions', 'cta', 'cta/result']));

  console.log('\nBy campaign (utm_campaign):');
  const byCampaignLabel = new Map<string, Set<string>>();
  for (const o of created) get(byCampaignLabel, o.utmCampaign, () => new Set()).add(o.campaign);
  console.log(table(
    [...exp.byCampaign.entries()].sort(byStarted).map(([k, c]) => [
      k, [...(byCampaignLabel.get(k) ?? [])].join(' + '), c.started, c.resultViewed, c.ctaClicked,
    ]),
    ['campaign', 'traffic', 'started', 'result', 'cta'],
  ));

  console.log('\nSteps (unique sessions):');
  console.log(table(
    [...exp.steps.entries()].sort((a, b) => b[1].viewed - a[1].viewed).map(([k, s]) => [k, s.viewed, s.completed, s.backClicks, s.dropped]),
    ['step', 'viewed', 'completed', 'back', 'dropped'],
  ));
  console.log(`  dropped before the first step: ${exp.droppedBeforeFirstStep}`);

  // Branch coverage over final (effective) answers of sessions that reached the result.
  const finished = created.filter((o) => o.reachedResult);
  const count = (f: (o: SessionOutcome) => boolean) => finished.filter(f).length;
  const ans = (o: SessionOutcome, k: string) => o.answersByStep.get(k);
  const modes = ['remote', 'hybrid', 'office'].map((m) => `${m} ${count((o) => ans(o, 'work_mode') === m)}`).join(', ');
  const meetingAsked = count((o) => ans(o, 'meeting_hours') !== undefined);
  const prioritiesAsked = count((o) => Array.isArray(ans(o, 'priorities')));
  console.log('\nBranch coverage (sessions that reached a result, final answers):');
  console.log(table([
    ['work_mode', modes],
    ['office_days asked (hybrid/office)', count((o) => ans(o, 'office_days') !== undefined)],
    ['meeting_hours asked / >= 15', `${meetingAsked} / ${count((o) => Number(ans(o, 'meeting_hours')) >= 15)}`],
    ['priorities incl. compliance', `${count((o) => (ans(o, 'priorities') as string[] | undefined)?.includes('compliance') ?? false)} of ${prioritiesAsked}`],
    ['security_constraints asked / strict|regulated', `${count((o) => ans(o, 'security_constraints') !== undefined)} / ${count((o) => ['strict', 'regulated'].includes(String(ans(o, 'security_constraints'))))}`],
    ['re-answers after back (changed value)', sum(created, (o) => o.reanswered)],
    ['  of which changed the branch (visible steps)', sum(created, (o) => o.branchChanges)],
    ['sessions that saw 2+ results (back from result)', created.filter((o) => o.resultsSeen.size > 1).length],
  ].map(([k, v]) => [k, String(v)])));

  const unique = sum(created, (o) => o.uniqueEvents);
  const validSends = sum(created, (o) => o.validSends);
  const invalid = sum(created, (o) => o.invalidSends);
  const kinds = new Map<string, number>();
  for (const o of created) for (const [k, n] of o.invalidKinds) kinds.set(k, (kinds.get(k) ?? 0) + n);
  const skipped = new Map<string, number>();
  for (const o of created) for (const [k, n] of o.skippedEvents) skipped.set(k, (skipped.get(k) ?? 0) + n);
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
    ['invalid events sent', `${invalid}${kinds.size ? `  (${[...kinds].sort().map(([k, n]) => `${k} ${n}`).join(', ')})` : ''}`],
    ['events not sent (not allowed by pinned version)', skipped.size ? [...skipped].map(([k, n]) => `${k} ${n}`).join(', ') : 0],
    ['back clicks', sum(created, (o) => o.backClicks)],
    ['GET result calls', sum(created, (o) => o.resultChecks)],
    ['state PUTs / 409 conflicts', `${sum(created, (o) => o.stateWrites)} / ${sum(created, (o) => o.stateConflicts)}`],
    ['HTTP retries (5xx/network)', sum(outcomes, (o) => o.httpRetries)],
  ].map(([k, v]) => [k, String(v)])));

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

function groupDelta(before: GroupMetrics[] | undefined, after: GroupMetrics[] | undefined): Delta {
  const b = new Map((before ?? []).map((g) => [String(g.key), g]));
  const d: Delta = new Map();
  for (const g of after ?? []) {
    const p = b.get(String(g.key));
    d.set(String(g.key), {
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
  const check = (section: string, key: string, metric: string, e: number, s: number) => {
    const ok = s === e;
    rows.push([section, key, metric, e, s, ok ? 'ok' : 'MISMATCH']);
    if (!ok) mismatches.push(`${section} ${key} ${metric}: expected +${e}, server +${s}`);
  };
  const cmp = (section: string, key: string, e: Counts, s: Counts | undefined) => {
    for (const m of ['started', 'resultViewed', 'ctaClicked'] as const) check(section, key, m, e[m], s?.[m] ?? 0);
  };
  /** Compares every expected key, plus any server key that changed although nothing was expected. */
  const cmpGroups = (section: string, e: Map<string, Counts>, d: Delta) => {
    for (const [k, c] of [...e.entries()].sort(byKey)) cmp(section, k, c, d.get(k));
    for (const [k, c] of d) if (!e.has(k) && (c.started || c.resultViewed || c.ctaClicked)) cmp(section, k, zero(), c);
  };

  cmp('total', 'all', exp.total, {
    started: after.totals.started - (before?.totals.started ?? 0),
    resultViewed: after.totals.resultViewed - (before?.totals.resultViewed ?? 0),
    ctaClicked: after.totals.ctaClicked - (before?.totals.ctaClicked ?? 0),
  });
  check('total', 'all', 'droppedBeforeFirstStep', exp.droppedBeforeFirstStep,
    (after.totals.droppedBeforeFirstStep ?? 0) - (before?.totals.droppedBeforeFirstStep ?? 0));
  cmpGroups('variant', exp.byVariant, groupDelta(before?.byVariant, after.byVariant));
  if (!after.byVersion) mismatches.push('analytics response has no byVersion');
  cmpGroups('version', exp.byVersion, groupDelta(before?.byVersion, after.byVersion));
  if (!after.byResult) mismatches.push('analytics response has no byResult');
  cmpGroups('result', exp.byResult, groupDelta(before?.byResult, after.byResult));

  // Campaigns: sessions without utm_campaign are grouped under NO_CAMPAIGN (api.ts).
  cmpGroups('campaign', exp.byCampaign, groupDelta(before?.byCampaign, after.byCampaign));

  console.log('\n== Analytics check: generator expectation vs server (delta before→after) ==');
  console.log(table(rows, ['group', 'key', 'metric', 'expected', 'server', '']));

  // Steps: viewed/completed/back/dropped per step id (unique sessions).
  const bSteps = new Map<string, StepMetrics>((before?.steps ?? []).map((s) => [s.stepId, s]));
  const stepRows: (string | number)[][] = [];
  const stepIds = new Set([...exp.steps.keys(), ...after.steps.map((s) => s.stepId)]);
  for (const id of stepIds) {
    const a = after.steps.find((s) => s.stepId === id);
    const p = bSteps.get(id);
    const e = exp.steps.get(id) ?? blankStep();
    const sv: StepCounts = {
      viewed: (a?.viewed ?? 0) - (p?.viewed ?? 0),
      completed: (a?.completed ?? 0) - (p?.completed ?? 0),
      backClicks: (a?.backClicks ?? 0) - (p?.backClicks ?? 0),
      dropped: (a?.dropped ?? 0) - (p?.dropped ?? 0),
    };
    if (!a && (e.viewed || e.completed)) mismatches.push(`step ${id}: missing from server analytics`);
    const ok = sv.viewed === e.viewed && sv.completed === e.completed && sv.backClicks === e.backClicks && sv.dropped === e.dropped;
    if (!ok) mismatches.push(`step ${id}: expected ${fmtStep(e)}; server ${fmtStep(sv)}`);
    stepRows.push([id, `${e.viewed}/${sv.viewed}`, `${e.completed}/${sv.completed}`, `${e.backClicks}/${sv.backClicks}`, `${e.dropped}/${sv.dropped}`, ok ? 'ok' : 'MISMATCH']);
  }
  console.log('\nSteps (expected/server delta):');
  console.log(table(stepRows, ['step', 'viewed', 'completed', 'back', 'dropped', '']));

  // Config-defined (non-core) events, e.g. recommendation_expanded on v3.
  const bOther = new Map((before?.otherEvents ?? []).map((o) => [o.name, o]));
  const names = new Set([...exp.other.keys(), ...(after.otherEvents ?? []).map((o) => o.name)]);
  const otherRows: (string | number)[][] = [];
  for (const name of names) {
    const e = exp.other.get(name) ?? { sessions: 0, events: 0 };
    const a = after.otherEvents?.find((o) => o.name === name);
    const s = { sessions: (a?.sessions ?? 0) - (bOther.get(name)?.sessions ?? 0), events: (a?.events ?? 0) - (bOther.get(name)?.events ?? 0) };
    const ok = s.sessions === e.sessions && s.events === e.events;
    if (!ok) mismatches.push(`event ${name}: expected +${e.sessions} sessions/+${e.events} events, server +${s.sessions}/+${s.events}`);
    otherRows.push([name, `${e.sessions}/${s.sessions}`, `${e.events}/${s.events}`, ok ? 'ok' : 'MISMATCH']);
  }
  if (otherRows.length) {
    console.log('\nOther events (expected/server delta):');
    console.log(table(otherRows, ['event', 'sessions', 'events', '']));
  }
  return mismatches;
}

const fmtStep = (s: StepCounts) => `viewed ${s.viewed}, completed ${s.completed}, back ${s.backClicks}, dropped ${s.dropped}`;
