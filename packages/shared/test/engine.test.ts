import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  answerProps,
  applyVariant,
  bucketNumber,
  FunnelConfigSchema,
  predictPath,
  progress,
  renderTemplate,
  validateAnswer,
  validateConfig,
} from '../src';

const raw = JSON.parse(readFileSync(new URL('../../../configs/v1.json', import.meta.url), 'utf8'));
const config = FunnelConfigSchema.parse(raw);

describe('config v1', () => {
  it('is valid with no errors for both variants', () => {
    const { issues } = validateConfig(raw);
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
  });
});

describe('branching', () => {
  const A = applyVariant(config, 'A');
  const B = applyVariant(config, 'B');

  it('newcomer branch in A', () => {
    expect(predictPath(A, { goal: 'whole', experience: 'new', minutes: 15, reminder: 'day' })).toEqual([
      'welcome', 'goal', 'experience', 'newcomer_tip', 'minutes', 'reminder', 'result',
    ]);
  });

  it('experienced + short time branch in A', () => {
    expect(predictPath(A, { experience: 'full', topics: ['gospel'], minutes: 5 })).toEqual([
      'welcome', 'goal', 'experience', 'topics', 'minutes', 'short_plan_tip', 'reminder', 'result',
    ]);
  });

  it('variant B reorders steps', () => {
    expect(predictPath(B, { experience: 'new', minutes: 30 })).toEqual([
      'welcome', 'goal', 'minutes', 'experience', 'newcomer_tip', 'reminder', 'result',
    ]);
  });

  it('variant B overrides texts and result', () => {
    expect(B.steps.result.title).not.toBe(A.steps.result.title);
    expect(A.steps.result.title).toBe('Ваш план готов');
  });

  it('unanswered conditions fall to the default path', () => {
    expect(predictPath(A, {})).toEqual(['welcome', 'goal', 'experience', 'topics', 'minutes', 'reminder', 'result']);
  });
});

describe('progress', () => {
  const A = applyVariant(config, 'A');
  it('counts only steps reachable for the user', () => {
    const history = ['welcome', 'goal', 'experience', 'newcomer_tip'];
    const p = progress(A, { experience: 'new' }, history);
    // newcomer_tip(4) + minutes, reminder, result
    expect(p).toMatchObject({ index: 4, total: 7 });
  });
  it('grows when an answer opens an extra step', () => {
    const history = ['welcome', 'goal', 'experience', 'topics', 'minutes'];
    expect(progress(A, { minutes: 30 }, history).total).toBe(7);
    expect(progress(A, { minutes: 5 }, history).total).toBe(8);
  });
});

describe('removeSteps', () => {
  it('rewires transitions through removed steps', () => {
    const cfg = FunnelConfigSchema.parse({
      ...raw,
      variants: { B: { removeSteps: ['welcome', 'newcomer_tip'] } },
    });
    const B = applyVariant(cfg, 'B');
    expect(B.start).toBe('goal');
    expect(B.steps.welcome).toBeUndefined();
    expect(B.steps.experience.next[0].to).toBe('minutes');
    expect(validateConfig({ ...raw, variants: { B: { removeSteps: ['welcome'] } } }).issues
      .filter((i) => i.level === 'error')).toEqual([]);
  });
});

describe('validation', () => {
  const A = applyVariant(config, 'A');
  it('single', () => {
    expect(validateAnswer(A.steps.goal, 'whole').ok).toBe(true);
    expect(validateAnswer(A.steps.goal, 'nope').ok).toBe(false);
    expect(validateAnswer(A.steps.goal, undefined).ok).toBe(false);
  });
  it('multi respects min/max', () => {
    expect(validateAnswer(A.steps.topics, []).ok).toBe(false);
    expect(validateAnswer(A.steps.topics, ['gospel', 'ot']).ok).toBe(true);
    expect(validateAnswer(A.steps.topics, ['gospel', 'ot', 'psalter', 'apostle']).ok).toBe(false);
    expect(validateAnswer(A.steps.topics, ['gospel', 'gospel']).ok).toBe(false);
  });
  it('number respects range', () => {
    expect(validateAnswer(A.steps.minutes, 4).ok).toBe(false);
    expect(validateAnswer(A.steps.minutes, 15).ok).toBe(true);
    expect(validateAnswer(A.steps.minutes, Number.NaN).ok).toBe(false);
  });
  it('rejects broken graphs', () => {
    const broken = structuredClone(raw);
    broken.steps[1].next = [{ to: 'missing' }];
    expect(validateConfig(broken).issues.some((i) => i.level === 'error')).toBe(true);
    const cyclic = structuredClone(raw);
    cyclic.steps.find((s: { id: string }) => s.id === 'reminder').next = [{ to: 'goal' }];
    expect(validateConfig(cyclic).issues.some((i) => i.message.includes('cycle'))).toBe(true);
  });
});

describe('privacy + templates', () => {
  const A = applyVariant(config, 'A');
  it('number answers are bucketed', () => {
    expect(bucketNumber([10, 20, 30], 5)).toBe('<10');
    expect(bucketNumber([10, 20, 30], 15)).toBe('10-20');
    expect(bucketNumber([10, 20, 30], 30)).toBe('>=30');
    expect(answerProps(A.steps.minutes, 17)).toEqual({ bucket: '10-20' });
  });
  it('renders labels and values', () => {
    const text = renderTemplate('{{label:goal}} / {{value:minutes}}', A, { goal: 'gospel', minutes: 15 });
    expect(text).toBe('лучше понять евангелие / 15');
  });
});
