import type { AnalyticsResponse, FunnelEventInput, SessionResponse } from '@funnel/shared';
import { describe, expect, it } from 'vitest';
import { loadConfig, makeEvent, setup } from './helpers';

type Step = [name: string, stepId: string | null, props?: Record<string, unknown>];
const flow = (s: SessionResponse, steps: Step[]) =>
  steps.map(([name, id, properties = {}], i) => makeEvent(s, name, id, i + 1, { properties }));
const pass = (id: string): Step[] => [['step_viewed', id], ['step_completed', id]];

async function scenario() {
  const ctx = setup();
  const { api, start } = ctx;
  const s1 = await start({ variantOverride: 'A', utm: { utm_campaign: 'c1' } });
  const s2 = await start({ variantOverride: 'A', utm: { utm_campaign: 'c1' } });
  const s3 = await start({ variantOverride: 'B', utm: { utm_campaign: 'c2' } });
  const s4 = await start({ variantOverride: 'B' });
  const s5 = await start({ variantOverride: 'B', utm: { utm_campaign: 'c2' } });

  const e1 = flow(s1, [
    ...pass('intro'), ...pass('team_size'), ...pass('work_mode'), ['step_viewed', 'priorities'],
    ['back_clicked', 'priorities'], ['step_viewed', 'work_mode'], ['step_completed', 'work_mode'],
    ...pass('priorities'), ...pass('timezone_span'), ...pass('async_maturity'), ...pass('tool_count'),
    ['step_viewed', 'result'], ['result_viewed', 'result', { result_id: 'async_native' }],
    ['cta_clicked', 'result', { result_id: 'async_native', action: 'expand_recommendation' }],
  ]);
  const e2 = flow(s2, [...pass('intro'), ['step_viewed', 'team_size']]);
  const e3 = flow(s3, [
    ...pass('intro'), ...pass('work_mode'), ...pass('timezone_span'), ...pass('team_size'),
    ...pass('async_maturity'), ...pass('priorities'), ...pass('tool_count'), ['step_viewed', 'result'],
    ['result_viewed', 'result', { result_id: 'balanced' }],
  ]);
  const e5 = flow(s5, [...pass('intro'), ...pass('work_mode'), ['step_viewed', 'timezone_span']]);

  const reversed = (xs: FunnelEventInput[]) => [...xs].reverse();
  await api('POST', '/api/events', { events: reversed(e1) });
  await api('POST', '/api/events', { events: [...e1.slice(0, 5), ...e2, e2[0]] });
  await api('POST', '/api/events', { events: e3 });
  await api('POST', '/api/events', { events: e3 });
  await api('POST', '/api/events', { events: [e5[4]] });
  await api('POST', '/api/events', { events: reversed(e5.slice(0, 4)) });
  return ctx;
}

const get = async (api: ReturnType<typeof setup>['api'], qs = '') =>
  (await api<AnalyticsResponse>('GET', `/api/analytics?slug=workstyle-planner${qs}`)).body;
const step = (r: AnalyticsResponse, id: string) => r.steps.find((s) => s.stepId === id)!;

describe('analytics', () => {
  it('counts unique sessions regardless of duplicates, repeats and ordering', async () => {
    const { api } = await scenario();
    const r = await get(api);
    expect(r.totals).toMatchObject({ started: 5, resultViewed: 2, ctaClicked: 1, droppedBeforeFirstStep: 1 });
    expect(r.totals.ctr).toBe(0.5);
    expect(r.totals.ctaConversion).toBe(0.2);

    expect(step(r, 'intro')).toMatchObject({ viewed: 4, completed: 4, dropped: 0 });
    expect(step(r, 'team_size')).toMatchObject({ viewed: 3, completed: 2, dropped: 1, reach: 0.6 });
    expect(step(r, 'work_mode')).toMatchObject({ viewed: 3, completed: 3, dropped: 0 });
    expect(step(r, 'priorities')).toMatchObject({ viewed: 2, completed: 2, backClicks: 1 });
    expect(step(r, 'timezone_span')).toMatchObject({ viewed: 3, completed: 2, dropped: 1 });
    expect(step(r, 'result')).toMatchObject({ viewed: 2, completed: 1, type: 'result' });

    const dropped = r.steps.reduce((acc, s) => acc + s.dropped, 0) + r.totals.droppedBeforeFirstStep;
    expect(dropped + r.totals.resultViewed).toBe(r.totals.started);
    expect(r.steps.at(-1)!.stepId).toBe('result');
    expect(r.steps.map((s) => s.stepId)).toContain('office_days');
  });

  it('compares variants, versions, campaigns and results', async () => {
    const { api } = await scenario();
    const r = await get(api);
    expect(r.byVariant.map((g) => [g.key, g.started, g.resultViewed, g.ctaClicked])).toEqual([
      ['A', 2, 1, 1],
      ['B', 3, 1, 0],
    ]);
    expect(r.abTest.liftAbs).toBeCloseTo(-0.5);
    expect(r.byVersion).toHaveLength(1);
    expect(r.byCampaign.map((g) => [g.key, g.started])).toEqual([
      ['(none)', 1],
      ['c1', 2],
      ['c2', 2],
    ]);
    expect(r.byResult.map((g) => [g.key, g.resultViewed, g.ctaClicked])).toEqual([
      ['async_native', 1, 1],
      ['balanced', 1, 0],
    ]);
  });

  it('filters by utm_campaign, variant and version', async () => {
    const { api } = await scenario();
    expect((await get(api, '&utm_campaign=c2')).totals).toMatchObject({ started: 2, resultViewed: 1 });
    expect((await get(api, '&utm_campaign=(none)')).totals.started).toBe(1);
    expect((await get(api, '&variant=A')).totals).toMatchObject({ started: 2, ctaClicked: 1 });
    expect((await get(api, '&version=2')).totals.started).toBe(0);
  });

  it('keeps analytics per version across publish and rollback', async () => {
    const { api, start, publish, rollback } = await scenario();
    await publish(loadConfig(2));
    const s = await start();
    await api('POST', '/api/events', { events: flow(s, [['step_viewed', 'intro']]) });
    await rollback();
    const r = await get(api);
    expect(r.byVersion.map((g) => [g.key, g.started])).toEqual([
      ['1', 5],
      ['2', 1],
    ]);
    expect((await get(api, '&version=1')).totals.started).toBe(5);
    expect(r.steps.map((s) => s.stepId)).toContain('meeting_hours');
  });
});
