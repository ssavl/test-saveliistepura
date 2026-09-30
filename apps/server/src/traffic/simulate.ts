// Simulates one funnel session against the real HTTP API, like a (slightly misbehaving) client would.
import { randomUUID } from 'node:crypto';
import {
  type AnswerValue,
  answerProps,
  applyVariant,
  FunnelConfigSchema,
  type FunnelEventInput,
  type IngestResult,
  NO_CAMPAIGN,
  nextStep,
  progress,
  type SessionResponse,
  type SessionState,
  type Step,
  type StepType,
  validateAnswer,
  type Variant,
} from '@funnel/shared';
import { type Api, describe } from './http';
import { deriveSeed, mulberry32, type Rng } from './rng';

export interface Campaign {
  key: string; // display key; sessions are grouped server-side by utm.utm_campaign
  weight: number;
  utm: (rng: Rng) => Record<string, string>;
}

export { NO_CAMPAIGN };

export const CAMPAIGNS: Campaign[] = [
  {
    key: 'easter_tg',
    weight: 34,
    utm: (r) => ({
      utm_source: 'telegram',
      utm_medium: 'cpc',
      utm_campaign: 'easter_tg',
      utm_content: r.pick(['post_verse', 'post_plan', 'story']),
    }),
  },
  {
    key: 'lent_vk',
    weight: 24,
    utm: () => ({ utm_source: 'vk', utm_medium: 'cpc', utm_campaign: 'lent_vk' }),
  },
  {
    key: 'bloggers_yt',
    weight: 14,
    utm: (r) => ({
      utm_source: 'youtube',
      utm_medium: 'influencer',
      utm_campaign: 'bloggers_yt',
      utm_content: r.pick(['priest_vlog', 'family_channel']),
    }),
  },
  // Organic traffic has no campaign: google organic search and plain direct visits.
  { key: 'google/organic', weight: 16, utm: () => ({ utm_source: 'google', utm_medium: 'organic' }) },
  { key: 'direct', weight: 12, utm: () => ({}) },
];

export interface SimOptions {
  slug: string;
  seed: number;
  now: number;
  days: number;
  overrideRate: number;
  ctaProb: Record<Variant, number>;
  /** Abandon probability after viewing a step, by step type; `start` overrides for the first step. */
  dropProb: Record<Exclude<StepType, 'result'>, number> & { start: number; beforeFirstView: number };
  backProb: number;
  backFromResultProb: number;
  maxBacks: number;
  secondaryActionProb: number;
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
  viewed: Set<string>;
  completed: Set<string>;
  backOn: Set<string>;
  otherEvents: Map<string, number>;
  uniqueEvents: number;
  validSends: number; // every valid event transmission, incl. duplicates and resends
  inBatchDuplicates: number;
  batches: number;
  shuffledBatches: number;
  outOfOrderBatches: number;
  resentBatches: number;
  invalidSends: number;
  backClicks: number;
  stateWrites: number;
  stateConflicts: number;
  httpRetries: number;
  ingest: { accepted: number; duplicates: number; rejected: number };
  rejectedReasons: string[];
  errors: string[];
}

type WireEvent = Record<string, unknown>;

export class FatalError extends Error {}

const INVALID_KINDS = ['bad_event_id', 'no_session_id', 'no_name', 'zero_client_ts', 'bad_variant', 'string_seq'] as const;

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
    viewed: new Set(),
    completed: new Set(),
    backOn: new Set(),
    otherEvents: new Map(),
    uniqueEvents: 0,
    validSends: 0,
    inBatchDuplicates: 0,
    batches: 0,
    shuffledBatches: 0,
    outOfOrderBatches: 0,
    resentBatches: 0,
    invalidSends: 0,
    backClicks: 0,
    stateWrites: 0,
    stateConflicts: 0,
    httpRetries: 0,
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

  const config = FunnelConfigSchema.parse(created.body.config);
  const funnel = applyVariant(config, session.variant);
  const state: SessionState = { answers: {}, history: [funnel.start] };
  let rev = session.rev;

  // --- walk the funnel, collecting events -------------------------------------------------------
  const events: FunnelEventInput[] = [];
  let seq = 0; // session_started is seq 0 on the server; client events start at 1
  const emit = (name: string, stepId: string | null, props: Record<string, unknown> = {}) => {
    ts += rng.int(1_500, 20_000);
    events.push({
      event_id: randomUUID(),
      session_id: session.id,
      name,
      client_ts: ts,
      seq: ++seq,
      funnel_version: session.version,
      variant: session.variant,
      step_id: stepId,
      utm: session.utm,
      props,
    });
    if (!['step_viewed', 'answer_submitted', 'step_completed', 'back_clicked', 'result_viewed', 'cta_clicked'].includes(name))
      out.otherEvents.set(name, (out.otherEvents.get(name) ?? 0) + 1);
  };

  const putState = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await api.put<{ rev: number } | SessionResponse>(`/api/sessions/${session.id}/state`, { state, rev });
      out.stateWrites++;
      if (res.ok) {
        rev = (res.body as { rev: number }).rev;
        return;
      }
      if (res.status === 409) {
        // Stale rev: last writer wins — adopt the server rev and write our state again.
        out.stateConflicts++;
        rev = (res.body as SessionResponse).session.rev;
        continue;
      }
      out.errors.push(`PUT state: ${describe(res)}`);
      return;
    }
    out.errors.push('PUT state: gave up after repeated 409');
  };

  if (!rng.chance(opts.dropProb.beforeFirstView)) {
    let backs = 0;
    for (let guard = 0; guard < 200; guard++) {
      const cur = state.history[state.history.length - 1];
      const step = funnel.steps[cur];
      if (!step) {
        out.errors.push(`step "${cur}" missing from resolved funnel`);
        break;
      }
      const p = progress(funnel, state.answers, state.history);
      emit('step_viewed', cur, { index: p.index, total: p.total });
      out.viewed.add(cur);
      const canBack = state.history.length > 1 && backs < opts.maxBacks;

      if (step.type === 'result') {
        emit('result_viewed', cur);
        out.reachedResult = true;
        if (step.secondaryAction && rng.chance(opts.secondaryActionProb)) emit(step.secondaryAction.event, cur);
        if (canBack && rng.chance(opts.backFromResultProb)) {
          backs++;
          await goBack(cur);
          continue;
        }
        if (rng.chance(opts.ctaProb[session.variant])) {
          emit('cta_clicked', cur, { url: step.cta.url });
          out.ctaClicked = true;
          out.completed.add(cur); // analytics counts the CTA click as completing the result step
        }
        break;
      }

      if (canBack && rng.chance(opts.backProb)) {
        backs++;
        await goBack(cur);
        continue;
      }
      const drop = cur === funnel.start ? opts.dropProb.start : opts.dropProb[step.type];
      if (rng.chance(drop)) break;

      if (step.type === 'info' && step.secondaryAction && rng.chance(opts.secondaryActionProb))
        emit(step.secondaryAction.event, cur);
      if (step.type !== 'info') {
        const value = genAnswer(rng, step);
        const v = validateAnswer(step, value);
        if (!v.ok) throw new Error(`generator produced invalid answer for ${cur}: ${v.error}`);
        state.answers[cur] = value;
        emit('answer_submitted', cur, answerProps(step, value));
      }
      emit('step_completed', cur);
      out.completed.add(cur);
      const nxt = nextStep(funnel, cur, state.answers);
      if (!nxt) {
        out.errors.push(`no transition from "${cur}"`);
        break;
      }
      state.history.push(nxt);
      await putState();
    }
  }

  async function goBack(cur: string) {
    emit('back_clicked', cur);
    out.backOn.add(cur);
    out.backClicks++;
    state.history.pop(); // answers are kept (prefilled), the user may re-answer differently
    await putState();
  }

  out.uniqueEvents = events.length;
  await shipEvents(api, opts, rng, events, out);
  return out;
}

function genAnswer(rng: Rng, step: Step): AnswerValue {
  switch (step.type) {
    case 'single':
      return rng.pick(step.options).value;
    case 'multi': {
      const max = Math.min(step.maxSelected ?? step.options.length, step.options.length);
      const k = rng.int(step.minSelected, Math.max(step.minSelected, max));
      return rng.sample(step.options, k).map((o) => o.value);
    }
    case 'number': {
      // Pick a bucket range uniformly, then a value inside it, so every bucket/branch shows up.
      const edges = [step.min, ...step.buckets.filter((b) => b > step.min && b < step.max), step.max + 1];
      const i = rng.int(0, edges.length - 2);
      return rng.int(Math.ceil(edges[i]), Math.max(Math.ceil(edges[i]), Math.ceil(edges[i + 1]) - 1));
    }
    default:
      return null;
  }
}

function makeInvalid(rng: Rng, base: FunnelEventInput): WireEvent {
  const e: WireEvent = { ...base, event_id: randomUUID() };
  switch (rng.pick(INVALID_KINDS)) {
    case 'bad_event_id':
      e.event_id = `not-a-uuid-${rng.int(1, 1e6)}`;
      break;
    case 'no_session_id':
      delete e.session_id;
      break;
    case 'no_name':
      delete e.name;
      break;
    case 'zero_client_ts':
      e.client_ts = 0;
      break;
    case 'bad_variant':
      e.variant = 'C';
      break;
    case 'string_seq':
      e.seq = String(e.seq);
      break;
  }
  return e;
}

/** Splits events into client-like batches and sends them with duplicates, retries, reordering and junk. */
async function shipEvents(api: Api, opts: SimOptions, rng: Rng, events: FunnelEventInput[], out: SessionOutcome) {
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
    if (rng.chance(d.invalidInBatch)) payload.splice(rng.int(0, payload.length), 0, makeInvalid(rng, rng.pick(b) as FunnelEventInput));
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
    await sendBatch(api, payloads[i], out);
    if (i === resend) {
      await sendBatch(api, payloads[i], out); // client timed out and retried the same batch
      out.resentBatches++;
    }
  }
}

async function sendBatch(api: Api, payload: WireEvent[], out: SessionOutcome) {
  out.batches++;
  const invalid = payload.filter((e) => !isOwnValid(e)).length;
  out.invalidSends += invalid;
  out.validSends += payload.length - invalid;
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

// Invalid events are built by makeInvalid(); everything else we send is a well-formed event.
function isOwnValid(e: WireEvent): boolean {
  return (
    typeof e.event_id === 'string' &&
    !e.event_id.startsWith('not-a-uuid') &&
    typeof e.session_id === 'string' &&
    typeof e.name === 'string' &&
    typeof e.client_ts === 'number' &&
    e.client_ts > 0 &&
    (e.variant === 'A' || e.variant === 'B') &&
    typeof e.seq === 'number'
  );
}
