// Pure funnel engine shared by client, server and the traffic generator.
import {
  type AnswerValue,
  type Answers,
  type Condition,
  type FunnelConfig,
  FunnelConfigSchema,
  type Step,
  StepSchema,
  type Variant,
} from './config';

export interface ResolvedFunnel {
  slug: string;
  title: string;
  variant: Variant;
  start: string;
  steps: Record<string, Step>;
  order: string[]; // BFS order from start, used for stable display
}

/** Applies a variant override: patches step fields, removes steps (rewiring transitions), changes start. */
export function applyVariant(config: FunnelConfig, variant: Variant): ResolvedFunnel {
  const override = config.variants[variant];
  const steps: Record<string, Step> = {};
  for (const step of config.steps) {
    const patch = override?.steps[step.id];
    steps[step.id] = patch ? StepSchema.parse({ ...step, ...patch, id: step.id, type: step.type }) : step;
  }

  const removed = new Set(override?.removeSteps ?? []);
  // A transition into a removed step is redirected to that step's default successor (transitively).
  const redirect = (to: string, seen = new Set<string>()): string => {
    if (!removed.has(to) || seen.has(to)) return to;
    seen.add(to);
    const def = steps[to]?.next.find((t) => !t.when);
    if (!def) throw new Error(`Removed step "${to}" has no default transition to rewire`);
    return redirect(def.to, seen);
  };
  const start = redirect(override?.start ?? config.start);
  const rewired: Record<string, Step> = {};
  for (const [id, s] of Object.entries(steps)) {
    if (removed.has(id)) continue;
    rewired[id] = s.next.some((t) => removed.has(t.to))
      ? { ...s, next: s.next.map((t) => ({ ...t, to: redirect(t.to) })) }
      : s;
  }

  return { slug: config.slug, title: config.title, variant, start, steps: rewired, order: bfsOrder(rewired, start) };
}

function bfsOrder(steps: Record<string, Step>, start: string): string[] {
  const order: string[] = [];
  const queue = [start];
  const seen = new Set(queue);
  while (queue.length) {
    const id = queue.shift()!;
    if (!steps[id]) continue;
    order.push(id);
    for (const t of steps[id].next) {
      if (!seen.has(t.to)) {
        seen.add(t.to);
        queue.push(t.to);
      }
    }
  }
  return order;
}

export function evalCondition(cond: Condition, answers: Answers): boolean {
  const v = answers[cond.stepId];
  if (v === undefined || v === null) return false;
  if (cond.in) {
    const values = Array.isArray(v) ? v : [String(v)];
    if (!values.some((x) => cond.in!.includes(x))) return false;
  }
  if (cond.gte !== undefined && !(typeof v === 'number' && v >= cond.gte)) return false;
  if (cond.lt !== undefined && !(typeof v === 'number' && v < cond.lt)) return false;
  return true;
}

/** Next step id after `stepId` given answers, or null for terminal (result) steps. */
export function nextStep(funnel: ResolvedFunnel, stepId: string, answers: Answers): string | null {
  const step = funnel.steps[stepId];
  if (!step) return null;
  const t = step.next.find((tr) => !tr.when || evalCondition(tr.when, answers));
  return t ? t.to : null;
}

/**
 * Path the user will walk given current answers. Unanswered conditions fall to defaults,
 * so progress only counts steps actually reachable for this user.
 */
export function predictPath(funnel: ResolvedFunnel, answers: Answers, from = funnel.start): string[] {
  const path: string[] = [];
  const seen = new Set<string>();
  let cur: string | null = from;
  while (cur && funnel.steps[cur] && !seen.has(cur)) {
    seen.add(cur);
    path.push(cur);
    cur = nextStep(funnel, cur, answers);
  }
  return path;
}

/** Progress for the current step: position within [visited history + predicted remainder]. */
export function progress(funnel: ResolvedFunnel, answers: Answers, history: string[]) {
  const current = history[history.length - 1] ?? funnel.start;
  const remainder = predictPath(funnel, answers, current).slice(1);
  const total = history.length + remainder.length;
  return { index: history.length, total, ratio: total ? history.length / total : 0 };
}

export type ValidationResult = { ok: true } | { ok: false; error: string };

export function validateAnswer(step: Step, value: AnswerValue | undefined): ValidationResult {
  switch (step.type) {
    case 'info':
    case 'result':
      return { ok: true };
    case 'single':
      return typeof value === 'string' && step.options.some((o) => o.value === value)
        ? { ok: true }
        : { ok: false, error: 'Выберите один вариант' };
    case 'multi': {
      if (!Array.isArray(value)) return { ok: false, error: 'Выберите варианты' };
      if (new Set(value).size !== value.length) return { ok: false, error: 'Повторяющиеся значения' };
      if (!value.every((v) => step.options.some((o) => o.value === v)))
        return { ok: false, error: 'Неизвестный вариант' };
      if (value.length < step.minSelected)
        return { ok: false, error: `Выберите минимум ${step.minSelected}` };
      if (step.maxSelected && value.length > step.maxSelected)
        return { ok: false, error: `Можно выбрать не больше ${step.maxSelected}` };
      return { ok: true };
    }
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false, error: 'Введите число' };
      if (value < step.min || value > step.max)
        return { ok: false, error: `Введите число от ${step.min} до ${step.max}` };
      return { ok: true };
  }
}

/** Analytics-safe label for a number answer, e.g. "10-20". */
export function bucketNumber(edges: number[], value: number): string {
  const sorted = [...edges].sort((a, b) => a - b);
  if (!sorted.length) return 'any';
  if (value < sorted[0]) return `<${sorted[0]}`;
  for (let i = 1; i < sorted.length; i++) if (value < sorted[i]) return `${sorted[i - 1]}-${sorted[i]}`;
  return `>=${sorted[sorted.length - 1]}`;
}

/** Props for answer_submitted: option ids and buckets only, never raw free input. */
export function answerProps(step: Step, value: AnswerValue): Record<string, unknown> {
  if (step.type === 'number' && typeof value === 'number') return { bucket: bucketNumber(step.buckets, value) };
  if (step.type === 'single') return { option: value };
  if (step.type === 'multi') return { options: value };
  return {};
}

/** Substitutes {{value:stepId}} and {{label:stepId}} in result texts. */
export function renderTemplate(text: string, funnel: ResolvedFunnel, answers: Answers): string {
  return text.replace(/\{\{(value|label):([a-z0-9_]+)\}\}/g, (_, kind: string, stepId: string) => {
    const v = answers[stepId];
    if (v === undefined || v === null) return '';
    const step = funnel.steps[stepId];
    if (kind === 'label' && step && (step.type === 'single' || step.type === 'multi')) {
      const labels = (Array.isArray(v) ? v : [String(v)]).map(
        (x) => step.options.find((o) => o.value === x)?.label ?? x,
      );
      return labels.join(', ').toLowerCase();
    }
    return Array.isArray(v) ? v.join(', ') : String(v);
  });
}

export interface ConfigIssue {
  level: 'error' | 'warning';
  variant?: Variant;
  message: string;
}

/** Parses and checks the step graph for both variants. Publishing is blocked on errors. */
export function validateConfig(raw: unknown): { config?: FunnelConfig; issues: ConfigIssue[] } {
  const parsed = FunnelConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.map((i) => ({ level: 'error', message: `${i.path.join('.')}: ${i.message}` })),
    };
  }
  const config = parsed.data;
  const issues: ConfigIssue[] = [];
  const ids = new Set<string>();
  for (const s of config.steps) {
    if (ids.has(s.id)) issues.push({ level: 'error', message: `Duplicate step id "${s.id}"` });
    ids.add(s.id);
  }
  let branching = false;

  for (const variant of ['A', 'B'] as const) {
    const ov = config.variants[variant];
    for (const id of [...Object.keys(ov?.steps ?? {}), ...(ov?.removeSteps ?? [])]) {
      if (!ids.has(id)) issues.push({ level: 'error', variant, message: `Override for unknown step "${id}"` });
    }
    let funnel: ResolvedFunnel;
    try {
      funnel = applyVariant(config, variant);
    } catch (e) {
      issues.push({ level: 'error', variant, message: (e as Error).message });
      continue;
    }
    if (!funnel.steps[funnel.start]) {
      issues.push({ level: 'error', variant, message: `Start step "${funnel.start}" not found` });
      continue;
    }
    for (const step of Object.values(funnel.steps)) {
      for (const t of step.next) {
        if (!funnel.steps[t.to])
          issues.push({ level: 'error', variant, message: `${step.id} -> unknown step "${t.to}"` });
        if (t.when && !ids.has(t.when.stepId))
          issues.push({ level: 'error', variant, message: `${step.id}: condition on unknown step` });
      }
      if (step.type === 'result') {
        if (step.next.length) issues.push({ level: 'error', variant, message: `Result "${step.id}" has transitions` });
      } else if (!step.next.some((t) => !t.when)) {
        issues.push({ level: 'error', variant, message: `Step "${step.id}" has no default transition` });
      }
      if (step.next.some((t) => t.when)) branching = true;
    }
    if (hasCycle(funnel)) issues.push({ level: 'error', variant, message: 'Step graph has a cycle' });
    const reachable = new Set(funnel.order);
    if (!funnel.order.some((id) => funnel.steps[id].type === 'result'))
      issues.push({ level: 'error', variant, message: 'No reachable result step' });
    for (const id of Object.keys(funnel.steps)) {
      if (!reachable.has(id)) issues.push({ level: 'warning', variant, message: `Step "${id}" is unreachable` });
    }
  }
  if (!branching) issues.push({ level: 'error', message: 'Config must contain at least one conditional branch' });
  return { config, issues };
}

function hasCycle(funnel: ResolvedFunnel): boolean {
  const state = new Map<string, 1 | 2>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2 || !funnel.steps[id]) return false;
    state.set(id, 1);
    for (const t of funnel.steps[id].next) if (visit(t.to)) return true;
    state.set(id, 2);
    return false;
  };
  return visit(funnel.start);
}
