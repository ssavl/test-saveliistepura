import type { AnalyticsResponse, FunnelEventInput, SessionResponse } from '@funnel/shared';
import { describe, expect, it } from 'vitest';
import { makeEvent, setup } from './helpers';

type Step = [name: string, stepId: string | null];
const flow = (s: SessionResponse, steps: Step[]) => steps.map(([name, id], i) => makeEvent(s, name, id, i + 1));
const pass = (id: string): Step[] => [['step_viewed', id], ['step_completed', id]];

async function scenario() {
  const ctx = setup();
  const { api, start } = ctx;
  const s1 = await start({ variantOverride: 'A', utm: { utm_campaign: 'c1' } });
  const s2 = await start({ variantOverride: 'A', utm: { utm_campaign: 'c1' } });
  const s3 = await start({ variantOverride: 'B', utm: { utm_campaign: 'c2' } });
  const s4 = await start({ variantOverride: 'B' });
  const s5 = await start({ variantOverride: 'B', utm: { utm_campaign: 'c2' } });

  // S1: full path with a back-click and repeated views of goal/experience, reaches result, clicks CTA.
  const e1 = flow(s1, [
    ...pass('welcome'), ...pass('goal'), ['step_viewed', 'experience'], ['back_clicked', 'experience'],
    ['step_viewed', 'goal'], ['step_completed', 'goal'], ...pass('experience'), ...pass('topics'),
    ...pass('minutes'), ...pass('reminder'), ['step_viewed', 'result'], ['result_viewed', 'result'],
    ['cta_clicked', 'result'],
  ]);
  // S2: drops at goal. S3: variant B order, reaches result, no CTA. S4: no client events at all.
  const e2 = flow(s2, [...pass('welcome'), ['step_viewed', 'goal']]);
  const e3 = flow(s3, [
    ...pass('welcome'), ...pass('goal'), ...pass('minutes'), ...pass('experience'), ...pass('topics'),
    ...pass('reminder'), ['step_viewed', 'result'], ['result_viewed', 'result'],
  ]);
  // S5: drops at minutes; its events arrive out of order.
  const e5 = flow(s5, [...pass('welcome'), ...pass('goal'), ['step_viewed', 'minutes']]);

  const shuffled = (xs: FunnelEventInput[]) => [...xs].reverse();
  await api('POST', '/api/events', { events: shuffled(e1) });
  await api('POST', '/api/events', { events: [...e1.slice(0, 5), ...e2, e2[0]] }); // duplicates
  await api('POST', '/api/events', { events: e3 });
  await api('POST', '/api/events', { events: e3 }); // retried batch
  await api('POST', '/api/events', { events: [e5[4]] }); // latest event first
  await api('POST', '/api/events', { events: shuffled(e5.slice(0, 4)) });
  return ctx;
}

const get = async (api: ReturnType<typeof setup>['api'], qs = '') =>
  (await api<AnalyticsResponse>('GET', `/api/analytics?slug=bible-plan${qs}`)).body;
const step = (r: AnalyticsResponse, id: string) => r.steps.find((s) => s.stepId === id)!;

describe('analytics', () => {
  it('counts unique sessions regardless of duplicates, repeats and ordering', async () => {
    const { api } = await scenario();
    const r = await get(api);
    expect(r.totals).toMatchObject({ started: 5, resultViewed: 2, ctaClicked: 1, droppedBeforeFirstStep: 1 });
    expect(r.totals.ctr).toBe(0.5);
    expect(r.totals.ctaConversion).toBe(0.2);

    expect(step(r, 'welcome')).toMatchObject({ viewed: 4, completed: 4, dropped: 0 });
    expect(step(r, 'goal')).toMatchObject({ viewed: 4, completed: 3, dropped: 1, conversion: 0.75, reach: 0.8 });
    expect(step(r, 'experience')).toMatchObject({ viewed: 2, completed: 2, backClicks: 1, dropped: 0 });
    expect(step(r, 'minutes')).toMatchObject({ viewed: 3, completed: 2, dropped: 1 });
    expect(step(r, 'result')).toMatchObject({ viewed: 2, completed: 1, type: 'result' });

    // Every started session is either at the result or dropped exactly once.
    const dropped = r.steps.reduce((acc, s) => acc + s.dropped, 0) + r.totals.droppedBeforeFirstStep;
    expect(dropped + r.totals.resultViewed).toBe(r.totals.started);
    // Result step is ordered last; branch steps are included.
    expect(r.steps.at(-1)!.stepId).toBe('result');
    expect(r.steps.map((s) => s.stepId)).toContain('newcomer_tip');
  });

  it('compares variants, versions and campaigns', async () => {
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
    expect(r.campaigns).toEqual(['(none)', 'c1', 'c2']);
  });

  it('filters by utm_campaign, variant and version', async () => {
    const { api } = await scenario();
    expect((await get(api, '&utm_campaign=c2')).totals).toMatchObject({ started: 2, resultViewed: 1 });
    expect((await get(api, '&utm_campaign=(none)')).totals.started).toBe(1);
    expect((await get(api, '&variant=A')).totals).toMatchObject({ started: 2, ctaClicked: 1 });
    expect((await get(api, '&version=2')).totals.started).toBe(0);
  });

  it('keeps analytics per version across publish and rollback', async () => {
    const { api, start } = await scenario();
    const v2 = structuredClone((await api('GET', '/api/admin/funnels/bible-plan/versions/1')).body.config);
    await api('POST', '/api/admin/funnels/bible-plan/versions', { config: v2 });
    const s = await start();
    await api('POST', '/api/events', { events: flow(s, [['step_viewed', 'welcome']]) });
    await api('POST', '/api/admin/funnels/bible-plan/rollback', {});
    const r = await get(api);
    expect(r.byVersion.map((g) => [g.key, g.started])).toEqual([
      ['1', 5],
      ['2', 1],
    ]);
    expect((await get(api, '&version=1')).totals.started).toBe(5);
  });
});
