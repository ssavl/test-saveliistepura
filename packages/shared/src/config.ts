import { z } from 'zod';

export const VariantSchema = z.enum(['A', 'B']);
export type Variant = z.infer<typeof VariantSchema>;

export const EventNameRe = /^[a-z][a-z0-9_]{2,47}$/;

export const OPERATORS = ['eq', 'neq', 'in', 'nin', 'contains', 'gt', 'gte', 'lt', 'lte', 'exists'] as const;

export const LeafConditionSchema = z.object({
  answer: z.string(),
  operator: z.enum(OPERATORS),
  value: z.unknown().optional(),
});
export type LeafCondition = z.infer<typeof LeafConditionSchema>;

export type Condition = LeafCondition | { all: Condition[] } | { any: Condition[] } | { not: Condition };

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    LeafConditionSchema,
    z.object({ all: z.array(ConditionSchema).min(1) }),
    z.object({ any: z.array(ConditionSchema).min(1) }),
    z.object({ not: ConditionSchema }),
  ]),
);

const ContentSchema = z.looseObject({
  eyebrow: z.string().optional(),
  title: z.string().optional(),
  body: z.string().optional(),
  helperText: z.string().optional(),
  primaryActionLabel: z.string().optional(),
  loadingTitle: z.string().optional(),
  errorTitle: z.string().optional(),
  retryLabel: z.string().optional(),
});

const OptionSchema = z.object({ value: z.string(), label: z.string() });

const ValidationSchema = z.looseObject({
  required: z.boolean().default(true),
  minSelections: z.number().int().min(0).optional(),
  maxSelections: z.number().int().min(1).optional(),
  messages: z.record(z.string(), z.string()).default({}),
});

const stepBase = {
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  content: ContentSchema.default({}),
  visibleWhen: ConditionSchema.optional(),
};

export const StepSchema = z.discriminatedUnion('type', [
  z.looseObject({ ...stepBase, type: z.literal('info') }),
  z.looseObject({
    ...stepBase,
    type: z.literal('single-select'),
    input: z.looseObject({ name: z.string(), options: z.array(OptionSchema).min(2) }),
    validation: ValidationSchema.default({ required: true, messages: {} }),
  }),
  z.looseObject({
    ...stepBase,
    type: z.literal('multi-select'),
    input: z.looseObject({ name: z.string(), options: z.array(OptionSchema).min(2) }),
    validation: ValidationSchema.default({ required: true, messages: {} }),
  }),
  z.looseObject({
    ...stepBase,
    type: z.literal('number'),
    input: z.looseObject({
      name: z.string(),
      min: z.number().optional(),
      max: z.number().optional(),
      step: z.number().positive().optional(),
      unit: z.string().optional(),
    }),
    validation: ValidationSchema.default({ required: true, messages: {} }),
  }),
  z.looseObject({ ...stepBase, type: z.literal('result'), resultSource: z.string().default('resultRules') }),
]);
export type Step = z.infer<typeof StepSchema>;
export type StepType = Step['type'];
export type InputStep = Extract<Step, { input: unknown }>;

export const CtaSchema = z.looseObject({ label: z.string(), action: z.string() });

export const ResultSchema = z.looseObject({
  id: z.string(),
  title: z.string(),
  summary: z.string().optional(),
  recommendations: z.array(z.string()).default([]),
  cta: CtaSchema,
});
export type Result = z.infer<typeof ResultSchema>;

export const VariantDefSchema = z.looseObject({
  weight: z.number().min(0),
  stepSequence: z.array(z.string()).min(1),
  stepOverrides: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  resultOverrides: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
});

export const FunnelConfigSchema = z.looseObject({
  schemaVersion: z.string(),
  funnelId: z.string().regex(/^[a-z0-9-]+$/),
  version: z.number().int().positive(),
  status: z.string().optional(),
  locale: z.string().default('en'),
  title: z.string(),
  description: z.string().optional(),
  releaseNote: z.string().optional(),
  session: z
    .looseObject({
      ttlHours: z.number().positive().default(72),
      persistAnswers: z.boolean().default(true),
      pinVersion: z.boolean().default(true),
      pinExperimentVariant: z.boolean().default(true),
    })
    .default({ ttlHours: 72, persistAnswers: true, pinVersion: true, pinExperimentVariant: true }),
  progress: z
    .looseObject({
      countVisibleOnly: z.boolean().default(true),
      excludeTypes: z.array(z.string()).default(['info', 'result']),
    })
    .default({ countVisibleOnly: true, excludeTypes: ['info', 'result'] }),
  experiment: z.looseObject({
    id: z.string(),
    assignment: z.string().default('server'),
    sticky: z.boolean().default(true),
    overrideQueryParam: z.string().default('variant'),
    variants: z.object({ A: VariantDefSchema, B: VariantDefSchema }),
  }),
  steps: z.record(z.string(), StepSchema),
  resultRules: z.array(z.object({ resultId: z.string(), when: ConditionSchema })).default([]),
  defaultResultId: z.string(),
  results: z.record(z.string(), ResultSchema),
  events: z.looseObject({
    baseProperties: z.array(z.string()).default([]),
    allowed: z
      .array(
        z.looseObject({
          name: z.string().regex(EventNameRe),
          trigger: z.string().optional(),
          properties: z.array(z.string()).default([]),
        }),
      )
      .min(1),
    privacy: z
      .looseObject({ storeRawAnswers: z.boolean().default(false), allowAnswerKinds: z.boolean().default(true) })
      .default({ storeRawAnswers: false, allowAnswerKinds: true }),
  }),
});
export type FunnelConfig = z.infer<typeof FunnelConfigSchema>;
export type FunnelConfigInput = z.input<typeof FunnelConfigSchema>;

export type AnswerValue = string | string[] | number | null;
export type Answers = Record<string, AnswerValue>;

export interface SessionState {
  answers: Answers;
  history: string[];
}
