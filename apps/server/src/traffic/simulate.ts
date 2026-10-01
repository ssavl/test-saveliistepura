// Simulates one funnel session against the real HTTP API, like a (slightly misbehaving) web client would.
import { randomUUID } from 'node:crypto';
import {
  type AnswerValue,
  answerKey,
  answerKind,
  applyVariant,
  type Condition,
  firstStep,
  type FunnelConfig,
  FunnelConfigSchema,
  type FunnelEventInput,
  type IngestResult,
  isInputStep,
  NO_CAMPAIGN,
  nextStep,
  type ResolvedFunnel,
  resolveResult,
  type ResultResponse,
  type SessionResponse,
  type SessionState,
  type Step,
  stepPosition,
  validateAnswer,
  type Variant,
  visibleSteps,
} from '@funnel/shared';
import { type Api, describe } from './http';
import { deriveSeed, mulberry32, type Rng } from './rng';

export interface Campaign {
  key: string; // display key; sessions are grouped server-side by utm_campaign
  weight: number;
  utm: (rng: Rng) => Record<string, string>;
}

export { NO_CAMPAIGN };

export const CAMPAIGNS: Campaign[] = [
  {
    key: 'linkedin_q4',
    weight: 32,
    utm: (r) => ({
      utm_source: 'linkedin',
      utm_medium: 'cpc',
      utm_campaign: 'linkedin_q4',
      utm_content: r.pick(['carousel_meetings', 'video_hybrid', 'single_image']),
    }),
  },
  {
    key: 'hr_newsletter',
    weight: 24,
    utm: () => ({ utm_source: 'newsletter', utm_medium: 'email', utm_campaign: 'hr_newsletter' }),
  },
  {
    key: 'ops_podcast',
    weight: 14,
    utm: (r) => ({
      utm_source: 'podcast',
      utm_medium: 'sponsorship',
      utm_campaign: 'ops_podcast',
      utm_term: r.pick(['remote work', 'meeting load']),
    }),
  },
  // Organic traffic has no campaign: organic search and plain direct visits.
  { key: 'google/organic', weight: 18, utm: () => ({ utm_source: 'google', utm_medium: 'organic' }) },
  { key: 'direct', weight: 12, utm: () => ({}) },
];

type DropKey = 'info' | 'single-select' | 'multi-select' | 'number';

export interface SimOptions {
  slug: string;
  seed: number;
  now: number;
  days: number;
  overrideRate: number;
  ctaProb: Record<Variant, number>;
  /** Abandon probability after viewing a step, by step type; `start` overrides for the first step. */
  dropProb: Record<DropKey, number> & { start: number; beforeFirstView: number };
  backProb: number;
  backFromResultProb: number;
  maxBacks: number;
  /** After a back click, probability that a re-visited step gets a fresh (possibly different) answer. */
  reanswerProb: number;
  dirty: {
    dupInBatch: number; // per batch: one event duplicated inside the same batch
    shuffleBatch: number; // per batch: events shuffled inside the batch
    invalidInBatch: number; // per batch: an invalid event mixed in
    outOfOrder: number; // per session: a later batch sent before an earlier one
    resendBatch: number; // per session: one batch re-sent (retry after timeout)
  };
}

export interface SessionOutcome {
  index: number;
  campaign: string;
  utmCampaign: string; // NO_CAMPAIGN when absent
  override?: Variant;
  created: boolean;
  sessionId?: string;
  variant?: Variant;
  version?: number;
  reachedResult: boolean;
  ctaClicked: boolean;
  resultsSeen: Set<string>; // result ids of result_viewed events (several if the user went back and changed answers)
  ctaResult?: string; // result id the CTA was clicked on
  lastViewed?: string; // last step_viewed step id (by seq)
  viewed: Set<string>;
  completed: Set<string>;
  backOn: Set<string>;
  otherEvents: Map<string, number>; // non-core event name -> count
  skippedEvents: Map<string, number>; // events not allowed by the pinned config (never sent)
  answersByStep: Map<string, AnswerValue>; // final effective answers (for the summary)
  uniqueEvents: number;
  validSends: number; // every valid event transmission, incl. duplicates and resends
  inBatchDuplicates: number;
  batches: number;
  shuffledBatches: number;
  outOfOrderBatches: number;
  resentBatches: number;
  invalidSends: number;
  invalidKinds: Map<string, number>;
  backClicks: number;
  reanswered: number; // re-answers after back that changed the value
  branchChanges: number; // re-answers that changed the set of visible steps (e.g. hybrid → remote hides office_days)
  stateWrites: number;
  stateConflicts: number;
  httpRetries: number;
  resultChecks: number;
  ingest: { accepted: number; duplicates: number; rejected: number };
  rejectedReasons: string[];
  errors: string[];
}

type WireEvent = Record<string, unknown>;

export class FatalError extends Error {}

const CORE = new Set(['session_started', 'step_viewed', 'answer_submitted', 'step_completed', 'back_clicked', 'result_viewed', 'cta_clicked']);
const INVALID_KINDS = [
  'bad_event_id',
  'no_session_id',
  'no_name',
  'zero_client_timestamp',
  'bad_variant',
  'string_seq',
  'name_not_allowed',
] as const;

export async function simulateSession(api: Api, opts: SimOptions, index: number): Promise<SessionOutcome> {
  const rng = mulberry32(deriveSeed(opts.seed, index));
  const campaign = rng.weighted(CAMPAIGNS.map((c) => ({ weight: c.weight, value: c })));
  const utm = campaign.utm(rng);
  const override: Variant | undefined = rng.chance(opts.overrideRate) ? rng.pick(['A', 'B'] as const) : undefined;
  // Session start spread over the last `days` days, leaving room for the session itself.
  let ts = opts.now - 30 * 60_000 - Math.floor(rng.next() * opts.days * 86_400_000);

  const out: SessionOutcome = {
    index,
    campaign: campaign.key,
    utmCampaign: utm.utm_campaign ?? NO_CAMPAIGN,
    override,
    created: false,
    reachedResult: false,
    ctaClicked: false,
    resultsSeen: new Set(),
    viewed: new Set(),
    completed: new Set(),
    backOn: new Set(),
    otherEvents: new Map(),
    skippedEvents: new Map(),
    answersByStep: new Map(),
    uniqueEvents: 0,
    validSends: 0,
    inBatchDuplicates: 0,
    batches: 0,
    shuffledBatches: 0,
    outOfOrderBatches: 0,
    resentBatches: 0,
    invalidSends: 0,
    invalidKinds: new Map(),
    backClicks: 0,
    reanswered: 0,
    branchChanges: 0,
    stateWrites: 0,
    stateConflicts: 0,
    httpRetries: 0,
    resultChecks: 0,
    ingest: { accepted: 0, duplicates: 0, rejected: 0 },
    rejectedReasons: [],
    errors: [],
  };

  // --- create session -------------------------------------------------------------------------
  const created = await api.post<SessionResponse>('/api/sessions', {
    slug: opts.slug,
    utm,
    ...(override ? { variantOverride: override } : {}),
  });
  if (created.status === 404 && index === 0) throw new FatalError(`POST /api/sessions: ${describe(created)}`);
  if (!created.ok) {
    out.errors.push(`create session: ${describe(created)}`);
    return out;
  }
  const { session } = created.body;
  out.created = true;
  out.sessionId = session.id;
  out.variant = session.variant;
  out.version = session.version;
  if (override && session.variant !== override)
    out.errors.push(`variantOverride=${override} ignored: server assigned ${session.variant}`);

  const parsed = FunnelConfigSchema.safeParse(created.body.config);
  if (!parsed.success) {
    out.errors.push(`pinned config v${session.version} does not parse: ${parsed.error.issues[0]?.message}`);
    return out;
  }
  const config = parsed.data;
  if (config.version !== session.version)
    out.errors.push(`session.version=${session.version} but pinned config.version=${config.version}`);
  const funnel = applyVariant(config, session.variant);
  const numberCuts = collectNumberCuts(config);
  const start = firstStep(funnel);
  const state: SessionState = { answers: {}, history: [start] };
  let rev = session.rev;

  // --- walk the funnel, collecting events -------------------------------------------------------
  const events: FunnelEventInput[] = [];
  let seq = 0; // session_started is seq 0 on the server; client events start at 1
  const emit = (name: string, stepId: string | null, props: Record<string, unknown> = {}) => {
    const allowedProps = funnel.events[name];
    if (!allowedProps) {
      // The pinned version does not define this event: a real client would not send it either.
      out.skippedEvents.set(name, (out.skippedEvents.get(name) ?? 0) + 1);
      return;
    }
    ts += rng.int(1_500, 20_000);
    events.push({
      event_id: randomUUID(),
      session_id: session.id,
      name,
      client_timestamp: ts,
      seq: ++seq,
      funnel_id: session.slug,
      funnel_version: session.version,
      experiment_id: session.experimentId,
      variant: session.variant,
      step_id: stepId,
      utm_source: session.utm.utm_source ?? null,
      utm_medium: session.utm.utm_medium ?? null,
      utm_campaign: session.utm.utm_campaign ?? null,
      properties: Object.fromEntries(Object.entries(props).filter(([k]) => allowedProps.includes(k))),
    });
    if (!CORE.has(name)) out.otherEvents.set(name, (out.otherEvents.get(name) ?? 0) + 1);
  };

  const putState = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await api.put<{ rev: number } | SessionResponse>(`/api/sessions/${session.id}/state`, { state, rev });
      out.stateWrites++;
      if (res.ok) {
        rev = (res.body as { rev: number }).rev;
        return true;
      }
      if (res.status === 409) {
        // Stale rev: last writer wins — adopt the server rev and write our state again.
        out.stateConflicts++;
        rev = (res.body as SessionResponse).session.rev;
        continue;
      }
      out.errors.push(`PUT state: ${describe(res)}`);
      return false;
    }
    out.errors.push('PUT state: gave up after repeated 409');
    return false;
  };

  const answeredOnce = new Set<string>(); // steps answered at least once
  let afterBack = false; // the current step was reached by a back click

  if (!rng.chance(opts.dropProb.beforeFirstView)) {
    let backs = 0;
    for (let guard = 0; guard < 200; guard++) {
      const cur = state.history[state.history.length - 1];
      const step = funnel.steps[cur];
      if (!step) {
        out.errors.push(`step "${cur}" missing from resolved funnel`);
        break;
      }
      const pos = stepPosition(funnel, cur, state.answers);
      if (pos.index === 0) out.errors.push(`step "${cur}" is not visible for the current answers`);
      emit('step_viewed', cur, { step_type: step.type, visible_step_index: pos.index, visible_step_count: pos.count });
      out.viewed.add(cur);
      out.lastViewed = cur;
      const canBack = state.history.length > 1 && backs < opts.maxBacks;

      if (step.type === 'result') {
        // Like the web client: the result comes from the server, computed from the saved answers.
        const res = await api.get<ResultResponse>(`/api/sessions/${session.id}/result`);
        out.resultChecks++;
        if (!res.ok || !res.body?.result?.id) {
          out.errors.push(`GET result: ${describe(res)}`);
          break;
        }
        const result = res.body.result;
        const local = resolveResult(funnel, state.answers);
        if (local.id !== result.id) out.errors.push(`result mismatch: server "${result.id}", local resolveResult "${local.id}"`);
        emit('result_viewed', cur, { result_id: result.id });
        out.reachedResult = true;
        out.resultsSeen.add(result.id);
        if (canBack && rng.chance(opts.backFromResultProb)) {
          backs++;
          if (!(await goBack(cur))) break;
          continue;
        }
        if (rng.chance(opts.ctaProb[session.variant])) {
          const action = result.cta?.action ?? null;
          emit('cta_clicked', cur, { result_id: result.id, action });
          out.ctaClicked = true;
          out.ctaResult = result.id;
          out.completed.add(cur); // analytics counts the CTA click as completing the result step
          emit('recommendation_expanded', cur, { result_id: result.id, action, source: 'cta' });
        }
        break;
      }

      if (canBack && !afterBack && rng.chance(opts.backProb)) {
        backs++;
        if (!(await goBack(cur))) break;
        continue;
      }
      const drop = cur === start ? opts.dropProb.start : opts.dropProb[step.type];
      if (rng.chance(drop)) break;

      if (isInputStep(step)) {
        const key = answerKey(step)!;
        const prev = state.answers[key];
        // Re-visits keep the prefilled answer unless the user decides to change it.
        const fresh = !answeredOnce.has(cur) || (afterBack && rng.chance(opts.reanswerProb));
        const value = fresh ? genAnswer(rng, step, numberCuts.get(key) ?? []) : (prev ?? genAnswer(rng, step, []));
        const v = validateAnswer(step, value);
        if (!v.ok) throw new Error(`generator produced invalid answer for ${cur}: ${v.error}`);
        const visibleBefore = visibleSteps(funnel, state.answers).join();
        if (answeredOnce.has(cur) && JSON.stringify(prev) !== JSON.stringify(value)) out.reanswered++;
        state.answers[key] = value;
        if (answeredOnce.has(cur) && visibleSteps(funnel, state.answers).join() !== visibleBefore) out.branchChanges++;
        answeredOnce.add(cur);
        emit('answer_submitted', cur, { answer_kind: answerKind(step) });
      }
      afterBack = false;
      const nxt = nextStep(funnel, cur, state.answers);
      if (!nxt) {
        out.errors.push(`no next step after "${cur}"`);
        break;
      }
      emit('step_completed', cur, { next_step_id: nxt });
      out.completed.add(cur);
      state.history.push(nxt);
      if (!(await putState())) break;
    }
  }

  /** Back = previous visible step for the current answers (normally the previous history entry). */
  async function goBack(cur: string): Promise<boolean> {
    const visible = visibleSteps(funnel, state.answers);
    const i = visible.indexOf(cur);
    const dest = i > 0 ? visible[i - 1] : null;
    if (!dest) {
      out.errors.push(`back from "${cur}": no previous visible step`);
      return false;
    }
    emit('back_clicked', cur, { destination_step_id: dest });
    out.backOn.add(cur);
    out.backClicks++;
    const h = state.history.lastIndexOf(dest);
    if (h < 0) out.errors.push(`back destination "${dest}" not in history`);
    state.history = h >= 0 ? state.history.slice(0, h + 1) : [...state.history.slice(0, -1), dest];
    afterBack = true; // answers are kept (prefilled); the user may re-answer differently
    return putState();
  }

  const effective = resolveFinalAnswers(funnel, state.answers);
  for (const [k, v] of Object.entries(effective)) out.answersByStep.set(k, v);
  out.uniqueEvents = events.length;
  await shipEvents(api, opts, rng, events, out);
  return out;
}

function resolveFinalAnswers(funnel: ResolvedFunnel, answers: SessionState['answers']) {
  const out: SessionState['answers'] = {};
  for (const id of visibleSteps(funnel, answers)) {
    const key = answerKey(funnel.steps[id]);
    if (key && answers[key] !== undefined) out[key] = answers[key];
  }
  return out;
}

// --- answer generation -------------------------------------------------------------------------

/**
 * Numeric thresholds used by visibleWhen / resultRules, per answer name. Each cut c means "values >= c
 * behave differently", so number answers are drawn bucket by bucket and every numeric branch shows up
 * (e.g. meeting_hours >= 15 → meeting_heavy).
 */
function collectNumberCuts(config: FunnelConfig): Map<string, number[]> {
  const cuts = new Map<string, number[]>();
  const visit = (c: Condition) => {
    if ('all' in c) return c.all.forEach(visit);
    if ('any' in c) return c.any.forEach(visit);
    if ('not' in c) return visit(c.not);
    if (!['gt', 'gte', 'lt', 'lte'].includes(c.operator) || typeof c.value !== 'number') return;
    // gte/lt split at the value itself; gt/lte split just above it.
    const cut = c.operator === 'gte' || c.operator === 'lt' ? c.value : c.value + 1e-9;
    cuts.set(c.answer, [...(cuts.get(c.answer) ?? []), cut]);
  };
  for (const r of config.resultRules) visit(r.when);
  for (const s of Object.values(config.steps)) if (s.visibleWhen) visit(s.visibleWhen);
  return cuts;
}

function genAnswer(rng: Rng, step: Step, cuts: number[]): AnswerValue {
  switch (step.type) {
    case 'single-select':
      return rng.pick(step.input.options).value;
    case 'multi-select': {
      const { required, minSelections, maxSelections } = step.validation;
      const n = step.input.options.length;
      const min = Math.min(n, Math.max(minSelections ?? (required ? 1 : 0), 0));
      const max = Math.max(min, Math.min(maxSelections ?? n, n));
      return rng.sample(step.input.options, rng.int(min, max)).map((o) => o.value);
    }
    case 'number': {
      const inc = step.input.step ?? 1;
      const min = step.input.min ?? 0;
      const max = step.input.max ?? min + 100 * inc;
      const count = Math.floor((max - min) / inc + 1e-9) + 1; // grid: min, min+inc, ... <= max
      const grid = (k: number) => Number((min + k * inc).toFixed(10));
      // Buckets of grid indices separated by the cuts; the lowest bucket is twice as likely
      // (most teams are below thresholds such as 15 meeting hours), the others still appear often.
      const bounds = [0];
      for (const c of [...new Set(cuts)].sort((a, b) => a - b)) {
        const k = Math.ceil((c - min) / inc - 1e-9);
        if (k > bounds[bounds.length - 1] && k < count) bounds.push(k);
      }
      bounds.push(count);
      const buckets = bounds.slice(0, -1).map((lo, i) => ({ weight: i === 0 ? 2 : 1, value: [lo, bounds[i + 1] - 1] as const }));
      const [lo, hi] = rng.weighted(buckets);
      return grid(rng.int(lo, hi));
    }
    default:
      return null;
  }
}

// --- event delivery ----------------------------------------------------------------------------

function makeInvalid(rng: Rng, base: FunnelEventInput, out: SessionOutcome): WireEvent {
  const e: WireEvent = { ...base, event_id: randomUUID() };
  const kind = rng.pick(INVALID_KINDS);
  out.invalidKinds.set(kind, (out.invalidKinds.get(kind) ?? 0) + 1);
  switch (kind) {
    case 'bad_event_id':
      e.event_id = `not-a-uuid-${rng.int(1, 1e6)}`;
      break;
    case 'no_session_id':
      delete e.session_id;
      break;
    case 'no_name':
      delete e.name;
      break;
    case 'zero_client_timestamp':
      e.client_timestamp = 0;
      break;
    case 'bad_variant':
      e.variant = 'C';
      break;
    case 'string_seq':
      e.seq = String(e.seq);
      break;
    case 'name_not_allowed':
      // Well-formed, but not in the pinned version's events.allowed → must be rejected.
      e.name = 'debug_ping';
      break;
  }
  return e;
}

/** Splits events into client-like batches and sends them with duplicates, retries, reordering and junk. */
async function shipEvents(api: Api, opts: SimOptions, rng: Rng, events: FunnelEventInput[], out: SessionOutcome) {
  const invalid = new WeakSet<WireEvent>();
  const batches: WireEvent[][] = [];
  for (let i = 0; i < events.length; ) {
    const size = rng.int(2, 7);
    batches.push(events.slice(i, i + size) as WireEvent[]);
    i += size;
  }
  const d = opts.dirty;
  const payloads = batches.map((b) => {
    const payload = [...b];
    if (rng.chance(d.dupInBatch)) {
      payload.splice(rng.int(0, payload.length), 0, { ...rng.pick(b) });
      out.inBatchDuplicates++;
    }
    if (rng.chance(d.invalidInBatch)) {
      const bad = makeInvalid(rng, rng.pick(b) as FunnelEventInput, out);
      invalid.add(bad);
      payload.splice(rng.int(0, payload.length), 0, bad);
    }
    if (payload.length > 1 && rng.chance(d.shuffleBatch)) {
      rng.shuffle(payload);
      out.shuffledBatches++;
    }
    return payload;
  });

  const order = payloads.map((_, i) => i);
  if (order.length >= 2 && rng.chance(d.outOfOrder)) {
    const i = rng.int(0, order.length - 2);
    [order[i], order[i + 1]] = [order[i + 1], order[i]];
    out.outOfOrderBatches++;
  }
  const resend = order.length && rng.chance(d.resendBatch) ? rng.int(0, order.length - 1) : -1;

  for (const i of order) {
    await sendBatch(api, payloads[i], invalid, out);
    if (i === resend) {
      await sendBatch(api, payloads[i], invalid, out); // client timed out and retried the same batch
      out.resentBatches++;
    }
  }
}

async function sendBatch(api: Api, payload: WireEvent[], invalid: WeakSet<WireEvent>, out: SessionOutcome) {
  out.batches++;
  const bad = payload.filter((e) => invalid.has(e)).length;
  out.invalidSends += bad;
  out.validSends += payload.length - bad;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await api.post<IngestResult>('/api/events', { events: payload });
      if (res.status >= 500 && attempt < 2) {
        out.httpRetries++;
        continue;
      }
      if (!res.ok) {
        out.errors.push(`POST /api/events: ${describe(res)}`);
        return;
      }
      out.ingest.accepted += res.body.accepted?.length ?? 0;
      out.ingest.duplicates += res.body.duplicates?.length ?? 0;
      out.ingest.rejected += res.body.rejected?.length ?? 0;
      for (const r of res.body.rejected ?? []) out.rejectedReasons.push(r.reason);
      return;
    } catch (e) {
      if (attempt >= 2) throw e;
      out.httpRetries++;
    }
  }
}
