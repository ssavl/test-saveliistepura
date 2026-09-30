// Funnel config schema: the frontend renders screens only from this JSON.
import { z } from 'zod';

export const VariantSchema = z.enum(['A', 'B']);
export type Variant = z.infer<typeof VariantSchema>;

export const EventNameRe = /^[a-z][a-z0-9_]{2,47}$/;

// Condition over previous answers. All present operators must hold.
// Missing answer => condition is false (so unanswered branches fall to the default transition).
export const ConditionSchema = z.object({
  stepId: z.string(),
  in: z.array(z.string()).optional(), // single: value in list; multi: any selected value in list
  gte: z.number().optional(),
  lt: z.number().optional(),
});
export type Condition = z.infer<typeof ConditionSchema>;

// Transitions are evaluated in order; the first matching one wins. A transition without `when` is the default.
export const TransitionSchema = z.object({ when: ConditionSchema.optional(), to: z.string() });
export type Transition = z.infer<typeof TransitionSchema>;

export const OptionSchema = z.object({ value: z.string(), label: z.string() });

// Extra button that emits a config-defined event (new events ship without a frontend deploy).
export const SecondaryActionSchema = z.object({
  label: z.string(),
  event: z.string().regex(EventNameRe),
  text: z.string().optional(), // revealed after click
});

const base = {
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  title: z.string(),
  subtitle: z.string().optional(),
  next: z.array(TransitionSchema).default([]),
};

export const StepSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('single'), options: z.array(OptionSchema).min(2) }),
  z.object({
    ...base,
    type: z.literal('multi'),
    options: z.array(OptionSchema).min(2),
    minSelected: z.number().int().min(1).default(1),
    maxSelected: z.number().int().min(1).optional(),
  }),
  z.object({
    ...base,
    type: z.literal('number'),
    min: z.number(),
    max: z.number(),
    unit: z.string().optional(),
    placeholder: z.string().optional(),
    // Bucket edges for analytics: the raw number never leaves the session state.
    buckets: z.array(z.number()).default([]),
  }),
  z.object({
    ...base,
    type: z.literal('info'),
    body: z.string().optional(),
    cta: z.string().default('Продолжить'),
    secondaryAction: SecondaryActionSchema.optional(),
  }),
  z.object({
    ...base,
    type: z.literal('result'),
    body: z.string().optional(), // supports {{value:stepId}} and {{label:stepId}}
    bullets: z.array(z.string()).default([]),
    cta: z.object({ label: z.string(), url: z.string() }),
    secondaryAction: SecondaryActionSchema.optional(),
  }),
]);
export type Step = z.infer<typeof StepSchema>;
export type StepType = Step['type'];

// Variant override: shallow per-step field patches (texts, options, `next` for reordering, result content),
// a different start step, and steps removed for this variant.
export const VariantOverrideSchema = z.object({
  start: z.string().optional(),
  steps: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  removeSteps: z.array(z.string()).default([]),
});

export const FunnelConfigSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string(),
  start: z.string(),
  steps: z.array(StepSchema).min(6),
  experiment: z.object({
    key: z.string(),
    hypothesis: z.string().optional(),
    primaryMetric: z.string().optional(),
    splitB: z.number().min(0).max(1).default(0.5),
  }),
  variants: z
    .object({ A: VariantOverrideSchema.optional(), B: VariantOverrideSchema.optional() })
    .default({}),
});
export type FunnelConfig = z.infer<typeof FunnelConfigSchema>;
export type FunnelConfigInput = z.input<typeof FunnelConfigSchema>;

// Answer values as stored in session state.
export type AnswerValue = string | string[] | number | null;
export type Answers = Record<string, AnswerValue>;

export interface SessionState {
  answers: Answers;
  history: string[]; // visited step stack; last = current step
}
