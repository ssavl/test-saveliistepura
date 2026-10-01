// Event envelope: config `events.baseProperties` + `seq` (client ordering) + `properties`.
// Which event names and which properties are accepted is decided per pinned config version (events.allowed).
import { z } from 'zod';
import { EventNameRe, VariantSchema } from './config';
import { CORE_EVENT_NAMES } from './engine';

export const CORE_EVENTS = CORE_EVENT_NAMES;

// Events that must reference a step of the session's funnel.
export const STEP_EVENTS: ReadonlySet<string> = new Set([
  'step_viewed',
  'answer_submitted',
  'step_completed',
  'back_clicked',
  'result_viewed',
  'cta_clicked',
]);

const utm = z.string().max(200).nullable().optional();

export const EventSchema = z.object({
  event_id: z.uuid(),
  session_id: z.uuid(),
  name: z.string().regex(EventNameRe),
  client_timestamp: z.number().int().positive(),
  // Per-session monotonic counter from the client: orders events regardless of arrival order.
  seq: z.number().int().min(0),
  // The following are overwritten by the server from the stored session (the client is not trusted).
  funnel_id: z.string().max(64),
  funnel_version: z.number().int().positive(),
  experiment_id: z.string().max(128),
  variant: VariantSchema,
  step_id: z.string().max(64).nullable(),
  utm_source: utm,
  utm_medium: utm,
  utm_campaign: utm,
  properties: z.record(z.string(), z.unknown()).default({}),
});
export type FunnelEvent = z.infer<typeof EventSchema>;
export type FunnelEventInput = z.input<typeof EventSchema>;

export const MAX_BATCH = 500;

export interface IngestResult {
  accepted: string[];
  duplicates: string[];
  rejected: { index: number; event_id?: string; reason: string }[];
}

export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;

export function pickUtm(params: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of UTM_KEYS) {
    const v = params[k];
    if (typeof v === 'string' && v) out[k] = v.slice(0, 200);
  }
  return out;
}
