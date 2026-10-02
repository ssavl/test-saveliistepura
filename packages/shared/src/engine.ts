import {
  type AnswerValue,
  type Answers,
  type Condition,
  type FunnelConfig,
  FunnelConfigSchema,
  type InputStep,
  type LeafCondition,
  type Result,
  ResultSchema,
  type Step,
  StepSchema,
  type Variant,
} from './config';

export interface ResolvedFunnel {
  funnelId: string;
  version: number;
  experimentId: string;
  variant: Variant;
  locale: string;
  sequence: string[];
  steps: Record<string, Step>;
  results: Record<string, Result>;
  resultRules: FunnelConfig['resultRules'];
  defaultResultId: string;
  progressExclude: string[];
  events: Record<string, string[]>;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isObj(base) || !isObj(patch)) return (patch === undefined ? base : patch) as T;
  const out: Obj = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = deepMerge(out[k], v);
  return out as T;
}

export function applyVariant(config: FunnelConfig, variant: Variant): ResolvedFunnel {
  const def = config.experiment.variants[variant];
  const steps: Record<string, Step> = {};
  for (const id of def.stepSequence) {
    const base = config.steps[id];
    if (!base) continue;
    const patch = def.stepOverrides[id];
    steps[id] = patch ? StepSchema.parse(deepMerge(base, { ...patch, id, type: base.type })) : base;
  }
  const results: Record<string, Result> = {};
  for (const [id, r] of Object.entries(config.results)) {
    const patch = def.resultOverrides[id];
    results[id] = patch ? ResultSchema.parse(deepMerge(r, { ...patch, id })) : r;
  }
  return {
    funnelId: config.funnelId,
    version: config.version,
    experimentId: config.experiment.id,
    variant,
    locale: config.locale,
    sequence: def.stepSequence.filter((id) => steps[id]),
    steps,
    results,
    resultRules: config.resultRules,
    defaultResultId: config.defaultResultId,
    progressExclude: config.progress.excludeTypes,
    events: Object.fromEntries(config.events.allowed.map((e) => [e.name, e.properties])),
  };
}

export const isInputStep = (step: Step): step is InputStep => 'input' in step;
export const answerKey = (step: Step): string | null => (isInputStep(step) ? step.input.name : null);

const isMissing = (v: AnswerValue | undefined): v is null | undefined =>
  v === undefined || v === null || (Array.isArray(v) && v.length === 0);

function evalLeaf(c: LeafCondition, answers: Answers): boolean {
  const a = answers[c.answer];
  if (c.operator === 'exists') return (c.value === false) === isMissing(a);
  if (isMissing(a)) return false;
  const list = Array.isArray(c.value) ? (c.value as unknown[]) : [c.value];
  const values: unknown[] = Array.isArray(a) ? a : [a];
  switch (c.operator) {
    case 'eq':
      return !Array.isArray(a) && a === c.value;
    case 'neq':
      return !Array.isArray(a) && a !== c.value;
    case 'in':
      return values.some((v) => list.includes(v));
    case 'nin':
      return !values.some((v) => list.includes(v));
    case 'contains':
      return list.some((v) => values.includes(v));
    case 'gt':
      return typeof a === 'number' && a > Number(c.value);
    case 'gte':
      return typeof a === 'number' && a >= Number(c.value);
    case 'lt':
      return typeof a === 'number' && a < Number(c.value);
    case 'lte':
      return typeof a === 'number' && a <= Number(c.value);
  }
}

export function evalCondition(cond: Condition, answers: Answers): boolean {
  if ('all' in cond) return cond.all.every((c) => evalCondition(c, answers));
  if ('any' in cond) return cond.any.some((c) => evalCondition(c, answers));
  if ('not' in cond) return !evalCondition(cond.not, answers);
  return evalLeaf(cond, answers);
}

export function walk(funnel: ResolvedFunnel, answers: Answers): { visible: string[]; effective: Answers } {
  const effective: Answers = {};
  const visible: string[] = [];
  for (const id of funnel.sequence) {
    const step = funnel.steps[id];
    if (step.visibleWhen && !evalCondition(step.visibleWhen, effective)) continue;
    visible.push(id);
    const key = answerKey(step);
    if (key && answers[key] !== undefined) effective[key] = answers[key];
  }
  return { visible, effective };
}

export const visibleSteps = (funnel: ResolvedFunnel, answers: Answers) => walk(funnel, answers).visible;

export function firstStep(funnel: ResolvedFunnel, answers: Answers = {}): string {
  return visibleSteps(funnel, answers)[0];
}

export function nextStep(funnel: ResolvedFunnel, stepId: string, answers: Answers): string | null {
  const visible = visibleSteps(funnel, answers);
  const pos = funnel.sequence.indexOf(stepId);
  return visible.find((id) => funnel.sequence.indexOf(id) > pos) ?? null;
}

export function stepPosition(funnel: ResolvedFunnel, stepId: string, answers: Answers) {
  const visible = visibleSteps(funnel, answers);
  return { index: visible.indexOf(stepId) + 1, count: visible.length };
}

export function progress(funnel: ResolvedFunnel, answers: Answers, stepId: string) {
  const visible = visibleSteps(funnel, answers);
  const counted = visible.filter((id) => !funnel.progressExclude.includes(funnel.steps[id].type));
  const pos = funnel.sequence.indexOf(stepId);
  const before = counted.filter((id) => funnel.sequence.indexOf(id) < pos).length;
  const isCounted = counted.includes(stepId);
  const total = counted.length;
  const done = funnel.steps[stepId]?.type === 'result' ? total : before;
  return { index: isCounted ? before + 1 : before, total, ratio: total ? done / total : 0, counted: isCounted };
}

export type ValidationResult = { ok: true } | { ok: false; error: string };

export function validateAnswer(step: Step, value: AnswerValue | undefined): ValidationResult {
  if (!isInputStep(step)) return { ok: true };
  const { messages, required } = step.validation;
  const fail = (key: string, fallback: string): ValidationResult => ({ ok: false, error: messages[key] ?? fallback });
  if (isMissing(value)) {
    if (!required) return { ok: true };
    if (step.type === 'multi-select') return fail('minSelections', messages.required ?? 'Choose at least one option.');
    return fail('required', 'This field is required.');
  }
  switch (step.type) {
    case 'single-select':
      return typeof value === 'string' && step.input.options.some((o) => o.value === value)
        ? { ok: true }
        : fail('required', 'Choose one option.');
    case 'multi-select': {
      if (!Array.isArray(value) || new Set(value).size !== value.length) return fail('invalid', 'Invalid selection.');
      if (!value.every((v) => step.input.options.some((o) => o.value === v))) return fail('invalid', 'Invalid selection.');
      const { minSelections = required ? 1 : 0, maxSelections } = step.validation;
      if (value.length < minSelections) return fail('minSelections', `Choose at least ${minSelections}.`);
      if (maxSelections !== undefined && value.length > maxSelections)
        return fail('maxSelections', `Choose no more than ${maxSelections}.`);
      return { ok: true };
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return fail('required', 'Enter a number.');
      const { min, max, step: inc } = step.input;
      if (min !== undefined && value < min) return fail('min', `Enter a value of at least ${min}.`);
      if (max !== undefined && value > max) return fail('max', `Enter a value up to ${max}.`);
      if (inc !== undefined && Math.abs((value - (min ?? 0)) / inc - Math.round((value - (min ?? 0)) / inc)) > 1e-9)
        return fail('step', inc === 1 ? 'Enter a whole number.' : `Use steps of ${inc}.`);
      return { ok: true };
    }
  }
}

export const answerKind = (step: Step): string => step.type;

export function resolveResult(funnel: ResolvedFunnel, answers: Answers): Result {
  const { effective } = walk(funnel, answers);
  const rule = funnel.resultRules.find((r) => evalCondition(r.when, effective));
  return funnel.results[rule?.resultId ?? funnel.defaultResultId];
}

export interface ConfigIssue {
  level: 'error' | 'warning';
  variant?: Variant;
  message: string;
}

function conditionAnswers(c: Condition, out: string[] = []): string[] {
  if ('all' in c) c.all.forEach((x) => conditionAnswers(x, out));
  else if ('any' in c) c.any.forEach((x) => conditionAnswers(x, out));
  else if ('not' in c) conditionAnswers(c.not, out);
  else out.push(c.answer);
  return out;
}

export const CORE_EVENT_NAMES = [
  'session_started',
  'step_viewed',
  'answer_submitted',
  'step_completed',
  'back_clicked',
  'result_viewed',
  'cta_clicked',
];

export function validateConfig(raw: unknown): { config?: FunnelConfig; issues: ConfigIssue[] } {
  const parsed = FunnelConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.map((i) => ({ level: 'error', message: `${i.path.join('.')}: ${i.message}` })),
    };
  }
  const config = parsed.data;
  const issues: ConfigIssue[] = [];
  const err = (message: string, variant?: Variant) => issues.push({ level: 'error', variant, message });
  const warn = (message: string, variant?: Variant) => issues.push({ level: 'warning', variant, message });

  for (const [key, step] of Object.entries(config.steps)) {
    if (step.id !== key) err(`steps.${key}.id is "${step.id}"`);
    if (step.type === 'multi-select') {
      const { minSelections = 0, maxSelections } = step.validation;
      if (maxSelections !== undefined && (maxSelections < minSelections || maxSelections > step.input.options.length))
        err(`${key}: invalid min/maxSelections`);
    }
    if (step.type === 'number' && step.input.min !== undefined && step.input.max !== undefined && step.input.min > step.input.max)
      err(`${key}: min > max`);
  }
  for (const [key, r] of Object.entries(config.results)) if (r.id !== key) err(`results.${key}.id is "${r.id}"`);
  for (const id of [...config.resultRules.map((r) => r.resultId), config.defaultResultId]) {
    if (!config.results[id]) err(`Unknown result "${id}"`);
  }
  const eventNames = config.events.allowed.map((e) => e.name);
  for (const name of CORE_EVENT_NAMES) if (!eventNames.includes(name)) warn(`Core event "${name}" is not allowed`);
  const weights = config.experiment.variants.A.weight + config.experiment.variants.B.weight;
  if (weights <= 0) err('Variant weights must sum to a positive number');
  let branching = false;

  for (const variant of ['A', 'B'] as const) {
    const def = config.experiment.variants[variant];
    const seen = new Set<string>();
    const names = new Map<string, number>();
    def.stepSequence.forEach((id, pos) => {
      const step = config.steps[id];
      if (!step) return err(`Unknown step "${id}" in stepSequence`, variant);
      if (seen.has(id)) err(`Step "${id}" appears twice`, variant);
      seen.add(id);
      if (step.visibleWhen) {
        branching = true;
        for (const a of conditionAnswers(step.visibleWhen)) {
          const at = names.get(a);
          if (at === undefined) err(`${id}.visibleWhen depends on "${a}", which is not asked earlier`, variant);
        }
      }
      const key = answerKey(step);
      if (key) {
        if (names.has(key)) err(`Duplicate answer name "${key}"`, variant);
        names.set(key, pos);
      }
    });
    const results = def.stepSequence.filter((id) => config.steps[id]?.type === 'result');
    if (results.length !== 1) err(`Sequence must contain exactly one result step (found ${results.length})`, variant);
    else if (def.stepSequence.at(-1) !== results[0]) err('Result step must be last', variant);
    for (const id of Object.keys(def.stepOverrides)) {
      if (!seen.has(id)) warn(`stepOverrides.${id} is not in this variant's sequence`, variant);
    }
    for (const id of Object.keys(def.resultOverrides)) if (!config.results[id]) err(`resultOverrides.${id}: unknown result`, variant);
    for (const rule of config.resultRules) {
      for (const a of conditionAnswers(rule.when)) {
        if (!names.has(a)) warn(`Result rule "${rule.resultId}" uses "${a}", which this variant never asks`, variant);
      }
    }
    try {
      applyVariant(config, variant);
    } catch (e) {
      err(`Overrides produce an invalid step/result: ${(e as Error).message}`, variant);
    }
  }
  if (!branching) warn('No conditional step (visibleWhen) — the funnel has no branching');
  return { config, issues };
}
