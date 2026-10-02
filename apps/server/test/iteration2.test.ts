import type { AnalyticsResponse } from '@funnel/shared';
import { describe, expect, it } from 'vitest';
import { loadConfig, makeEvent, setup } from './helpers';

describe('iteration 2: v1 -> v2 -> v3, verify, roll back', () => {
  it('old sessions keep working, new ones get v3, rollback keeps analytics', async () => {
    const { api, start, publish, rollback } = setup();
    expect((await publish(loadConfig(2))).body.version).toBe(2);

    const old = await start({ variantOverride: 'B' });
    expect(old.session.version).toBe(2);
    await api('PUT', `/api/sessions/${old.session.id}/state`, {
      state: { answers: { work_mode: 'remote' }, history: ['intro', 'work_mode', 'tool_count'] },
      rev: 0,
    });

    expect((await publish(loadConfig(3))).body.version).toBe(3);

    const resumed = await start({ sessionId: old.session.id, variantOverride: 'B' });
    expect(resumed.session.version).toBe(2);
    expect(resumed.config.experiment.variants.B.stepSequence).toContain('tool_count');
    const put = await api('PUT', `/api/sessions/${old.session.id}/state`, {
      state: { answers: { work_mode: 'remote', tool_count: 9 }, history: ['intro', 'work_mode', 'tool_count', 'result'] },
      rev: 1,
    });
    expect(put.status).toBe(200);
    const late = await api('POST', '/api/events', {
      events: [
        makeEvent(old, 'step_completed', 'tool_count', 1, { properties: { next_step_id: 'result' } }),
        makeEvent(old, 'recommendation_expanded', 'result', 2),
      ],
    });
    expect(late.body.accepted).toHaveLength(1);
    expect(late.body.rejected).toHaveLength(1);
    expect((await api('GET', `/api/sessions/${old.session.id}/result`)).status).toBe(200);

    const fresh = await start({ variantOverride: 'B' });
    expect(fresh.session.version).toBe(3);
    const bad = await api('PUT', `/api/sessions/${fresh.session.id}/state`, {
      state: { answers: {}, history: ['intro', 'tool_count'] },
      rev: 0,
    });
    expect(bad.status).toBe(400);
    await api('PUT', `/api/sessions/${fresh.session.id}/state`, {
      state: {
        answers: { work_mode: 'office', priorities: ['compliance'], security_constraints: 'regulated' },
        history: ['intro', 'work_mode', 'priorities', 'security_constraints', 'result'],
      },
      rev: 0,
    });
    const result = (await api('GET', `/api/sessions/${fresh.session.id}/result`)).body.result;
    expect(result).toMatchObject({ id: 'regulated_scale', title: 'Your team needs a compliance-aware operating model' });
    const ev = await api('POST', '/api/events', {
      events: [
        makeEvent(fresh, 'step_viewed', 'security_constraints', 1),
        makeEvent(fresh, 'result_viewed', 'result', 2, { properties: { result_id: 'regulated_scale' } }),
        makeEvent(fresh, 'recommendation_expanded', 'result', 3, {
          properties: { result_id: 'regulated_scale', action: 'expand_recommendation', source: 'cta' },
        }),
      ],
    });
    expect(ev.body.accepted).toHaveLength(3);

    await rollback();
    expect((await start()).session.version).toBe(2);
    expect((await start({ sessionId: fresh.session.id, variantOverride: 'B' })).session.version).toBe(3);

    const r = (await api<AnalyticsResponse>('GET', '/api/analytics?slug=workstyle-planner')).body;
    expect(r.byVersion.map((g) => [g.key, g.started])).toEqual([
      ['2', 2],
      ['3', 1],
    ]);
    expect(r.steps.map((s) => s.stepId)).toContain('security_constraints');
    expect(r.otherEvents).toEqual([{ name: 'recommendation_expanded', sessions: 1, events: 1 }]);
    expect(r.byResult.map((g) => g.key)).toContain('regulated_scale');
  });
});
