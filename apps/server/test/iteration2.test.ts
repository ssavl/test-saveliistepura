import { readFileSync } from 'node:fs';
import type { AnalyticsResponse } from '@funnel/shared';
import { describe, expect, it } from 'vitest';
import { makeEvent, setup } from './helpers';

const v2 = JSON.parse(readFileSync(new URL('../../../configs/v2.json', import.meta.url), 'utf8'));

describe('iteration 2: publish v2, verify, roll back', () => {
  it('old sessions keep working, new ones get v2, rollback keeps analytics', async () => {
    const { api, start } = setup();
    // An in-flight v1/B session sitting on "welcome" — a step that v2 removes for B.
    const old = await start({ variantOverride: 'B' });
    await api('PUT', `/api/sessions/${old.session.id}/state`, { state: { answers: {}, history: ['welcome'] }, rev: 0 });
    await api('POST', '/api/events', { events: [makeEvent(old, 'step_viewed', 'welcome', 1)] });

    expect((await api('POST', '/api/admin/funnels/bible-plan/versions', { config: v2 })).body.version).toBe(2);

    // Old session: still v1, still has "welcome", can continue saving state and sending events.
    const resumed = await start({ sessionId: old.session.id, variantOverride: 'B' });
    expect(resumed.session.version).toBe(1);
    expect(resumed.config.steps.some((s) => s.id === 'welcome')).toBe(true);
    const put = await api('PUT', `/api/sessions/${old.session.id}/state`, {
      state: { answers: {}, history: ['welcome', 'goal'] },
      rev: 1,
    });
    expect(put.status).toBe(200);
    const late = await api('POST', '/api/events', { events: [makeEvent(old, 'step_completed', 'welcome', 2)] });
    expect(late.body.accepted).toHaveLength(1);

    // New B session on v2 must not be allowed onto the removed step.
    const fresh = await start({ variantOverride: 'B' });
    expect(fresh.session.version).toBe(2);
    const bad = await api('PUT', `/api/sessions/${fresh.session.id}/state`, {
      state: { answers: {}, history: ['welcome'] },
      rev: 0,
    });
    expect(bad.status).toBe(400);
    // New config-defined event is accepted and reported.
    await api('POST', '/api/events', {
      events: [
        makeEvent(fresh, 'step_viewed', 'goal', 1),
        makeEvent(fresh, 'step_viewed', 'fast_choice', 2),
        makeEvent(fresh, 'plan_preview_opened', 'result', 3),
      ],
    });

    await api('POST', '/api/admin/funnels/bible-plan/rollback', {});
    expect((await start()).session.version).toBe(1);
    // v2 session still resumes on v2 after the rollback.
    expect((await start({ sessionId: fresh.session.id, variantOverride: 'B' })).session.version).toBe(2);

    const r = (await api<AnalyticsResponse>('GET', '/api/analytics?slug=bible-plan')).body;
    expect(r.byVersion.map((g) => [g.key, g.started])).toEqual([
      ['1', 2],
      ['2', 1],
    ]);
    expect(r.steps.map((s) => s.stepId)).toContain('fast_choice');
    expect(r.otherEvents).toEqual([{ name: 'plan_preview_opened', sessions: 1, events: 1 }]);
  });
});
