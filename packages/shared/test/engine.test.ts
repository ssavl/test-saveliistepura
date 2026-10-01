import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyVariant,
  firstStep,
  FunnelConfigSchema,
  nextStep,
  progress,
  resolveResult,
  stepPosition,
  validateAnswer,
  validateConfig,
  visibleSteps,
  walk,
} from '../src';

const load = (v: number) =>
  JSON.parse(readFileSync(new URL(`../../../configs/funnel-v${v}.json`, import.meta.url), 'utf8'));
const [raw1, raw2, raw3] = [load(1), load(2), load(3)];
const v1 = FunnelConfigSchema.parse(raw1);
const v3 = FunnelConfigSchema.parse(raw3);

describe('provided configs', () => {
  it.each([1, 2, 3])('v%i validates without errors', (v) => {
    const { issues } = validateConfig(load(v));
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
  });
});

describe('sequence and branching', () => {
  const A = applyVariant(v1, 'A');
  const B = applyVariant(v1, 'B');

  it('variant B has its own order and text overrides', () => {
    expect(B.sequence.slice(0, 3)).toEqual(['intro', 'work_mode', 'timezone_span']);
    expect(B.steps.intro.content.title).toBe('How should your team really work?');
    expect(B.steps.intro.content.eyebrow).toBe('2-minute team check');
    expect(A.steps.intro.content.title).toBe('Build a work model your team can actually follow');
  });

  it('office_days is visible only for hybrid/office', () => {
    expect(visibleSteps(A, { work_mode: 'remote' })).not.toContain('office_days');
    expect(visibleSteps(A, { work_mode: 'hybrid' })).toContain('office_days');
    expect(visibleSteps(A, {})).not.toContain('office_days');
  });

  it('nextStep skips hidden steps', () => {
    expect(nextStep(A, 'timezone_span', { work_mode: 'remote' })).toBe('async_maturity');
    expect(nextStep(A, 'timezone_span', { work_mode: 'office' })).toBe('office_days');
    expect(nextStep(A, 'result', {})).toBeNull();
    expect(firstStep(A)).toBe('intro');
  });

  it('drops answers of steps that became hidden', () => {
    const { effective } = walk(A, { work_mode: 'remote', office_days: 3 });
    expect(effective).not.toHaveProperty('office_days');
  });

  it('v3: compliance follow-up appears only when compliance is selected; B drops tool_count', () => {
    const A3 = applyVariant(v3, 'A');
    const B3 = applyVariant(v3, 'B');
    expect(visibleSteps(A3, { priorities: ['speed'] })).not.toContain('security_constraints');
    expect(visibleSteps(A3, { priorities: ['speed', 'compliance'] })).toContain('security_constraints');
    expect(B3.sequence).not.toContain('tool_count');
    expect(A3.sequence).toContain('tool_count');
  });
});

describe('progress', () => {
  const A = applyVariant(v1, 'A');
  it('counts visible interactive steps only', () => {
    // remote: team_size, work_mode, priorities, timezone_span, async_maturity, tool_count
    expect(progress(A, { work_mode: 'remote' }, 'intro')).toMatchObject({ index: 0, total: 6, ratio: 0 });
    expect(progress(A, { work_mode: 'remote' }, 'priorities')).toMatchObject({ index: 3, total: 6 });
    expect(progress(A, { work_mode: 'hybrid' }, 'priorities')).toMatchObject({ index: 3, total: 7 });
    expect(progress(A, { work_mode: 'hybrid' }, 'result')).toMatchObject({ ratio: 1 });
  });
  it('step position covers all visible steps', () => {
    expect(stepPosition(A, 'result', { work_mode: 'remote' })).toEqual({ index: 8, count: 8 });
  });
});

describe('validation messages come from the config', () => {
  const A = applyVariant(v1, 'A');
  it('number', () => {
    expect(validateAnswer(A.steps.team_size, undefined)).toEqual({ ok: false, error: 'Enter the team size.' });
    expect(validateAnswer(A.steps.team_size, 0)).toEqual({ ok: false, error: 'The team must have at least one person.' });
    expect(validateAnswer(A.steps.team_size, 201)).toEqual({ ok: false, error: 'For this demo, enter a value up to 200.' });
    expect(validateAnswer(A.steps.team_size, 2.5).ok).toBe(false);
    expect(validateAnswer(A.steps.team_size, 12).ok).toBe(true);
  });
  it('multi-select', () => {
    expect(validateAnswer(A.steps.priorities, [])).toEqual({ ok: false, error: 'Choose at least one priority.' });
    expect(validateAnswer(A.steps.priorities, ['speed', 'focus', 'culture', 'cost'])).toEqual({
      ok: false,
      error: 'Choose no more than three priorities.',
    });
    expect(validateAnswer(A.steps.priorities, ['speed', 'nope']).ok).toBe(false);
    expect(validateAnswer(A.steps.priorities, ['speed', 'focus']).ok).toBe(true);
  });
  it('single-select', () => {
    expect(validateAnswer(A.steps.work_mode, undefined)).toEqual({ ok: false, error: "Select the team's main work mode." });
    expect(validateAnswer(A.steps.work_mode, 'hybrid').ok).toBe(true);
  });
});

describe('result rules', () => {
  const A = applyVariant(v1, 'A');
  const B = applyVariant(v1, 'B');
  it('first matching rule wins, any/all supported', () => {
    expect(resolveResult(A, { work_mode: 'remote', timezone_span: 'global' }).id).toBe('async_native');
    expect(resolveResult(A, { work_mode: 'hybrid', async_maturity: 'high' }).id).toBe('async_native');
    expect(resolveResult(A, { work_mode: 'hybrid', async_maturity: 'low' }).id).toBe('hybrid_structured');
    expect(resolveResult(A, { work_mode: 'office' }).id).toBe('office_core');
    expect(resolveResult(A, { work_mode: 'remote', timezone_span: 'same' }).id).toBe('balanced');
  });
  it('variant B overrides result framing', () => {
    expect(resolveResult(B, { work_mode: 'office' }).title).toBe('Your office model can be more intentional');
    expect(resolveResult(B, { work_mode: 'office' }).summary).toBe(resolveResult(A, { work_mode: 'office' }).summary);
  });
  it('v3 compliance and v2 meeting-heavy results', () => {
    const A3 = applyVariant(v3, 'A');
    expect(resolveResult(A3, { priorities: ['compliance'], security_constraints: 'strict' }).id).toBe('regulated_scale');
    // security_constraints is ignored when its step is hidden (compliance deselected).
    expect(resolveResult(A3, { priorities: ['speed'], security_constraints: 'strict', meeting_hours: 20 }).id).toBe('meeting_heavy');
    const A2 = applyVariant(FunnelConfigSchema.parse(raw2), 'A');
    expect(resolveResult(A2, { meeting_hours: 15, work_mode: 'office' }).id).toBe('meeting_heavy');
  });
});

describe('config validation', () => {
  it('rejects broken configs', () => {
    const bad = structuredClone(raw1);
    bad.experiment.variants.A.stepSequence.push('nope');
    expect(validateConfig(bad).issues.some((i) => i.level === 'error')).toBe(true);
    const order = structuredClone(raw1);
    // office_days depends on work_mode, which would come later.
    order.experiment.variants.A.stepSequence = ['intro', 'office_days', 'work_mode', 'result'];
    expect(validateConfig(order).issues.some((i) => i.message.includes('not asked earlier'))).toBe(true);
    const res = structuredClone(raw1);
    res.defaultResultId = 'missing';
    expect(validateConfig(res).issues.some((i) => i.level === 'error')).toBe(true);
  });
});
