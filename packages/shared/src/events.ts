// Event schema shared by the client tracker, ingest endpoint and traffic generator.
import { z } from 'zod';
import { EventNameRe, VariantSchema } from './config';

export const CORE_EVENTS = [
  'session_started',
  'step_viewed',
  'answer_submitted',
  'step_completed',
  'back_clicked',
  'result_viewed',
  'cta_clicked',
] as const;
export type CoreEventName = (typeof CORE_EVENTS)[number];

// Events that must reference a step.
export const STEP_EVENTS: ReadonlySet<string> = new Set([
  'step_viewed',
  'answer_submitted',
  'step_completed',
  'back_clicked',
  'result_viewed',
]);

export const EventSchema = z.object({
  event_id: z.uuid(),
  session_id: z.uuid(),
  // Open set: config-defined events (e.g. added in a new version) are accepted without schema changes.
  name: z.string().regex(EventNameRe),
  client_ts: z.number().int().positive(),
  // Per-session monotonic counter from the client: orders events regardless of arrival order.
  seq: z.number().int().min(0),
  funnel_version: z.number().int().positive(),
  variant: VariantSchema,
  step_id: z.string().max(64).nullable(),
  utm: z.record(z.string(), z.string().max(200)).default({}),
  props: z.record(z.string(), z.unknown()).default({}),
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
  const utm: Record<string, string> = {};
  for (const k of UTM_KEYS) {
    const v = params[k];
    if (typeof v === 'string' && v) utm[k] = v.slice(0, 200);
  }
  return utm;
}
