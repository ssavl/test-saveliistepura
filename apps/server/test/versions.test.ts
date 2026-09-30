import { describe, expect, it } from 'vitest';
import { setup, v1WithTitle } from './helpers';

describe('publish & rollback', () => {
  it('publishes a new version without redeploy and rolls back to the previous one', async () => {
    const { api } = setup();
    const pub = await api('POST', '/api/admin/funnels/bible-plan/versions', { config: v1WithTitle('v2'), note: 'n' });
    expect(pub.status).toBe(200);
    expect(pub.body.version).toBe(2);
    expect((await api('GET', '/api/admin/funnels/bible-plan')).body.activeVersion).toBe(2);

    const rb = await api('POST', '/api/admin/funnels/bible-plan/rollback', {});
    expect(rb.body.activeVersion).toBe(1);
    expect(rb.body.log[0]).toMatchObject({ action: 'rollback', fromVersion: 2, toVersion: 1 });
    // Versions are never deleted: v2 can be re-activated.
    expect(rb.body.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    const again = await api('POST', '/api/admin/funnels/bible-plan/rollback', { toVersion: 2 });
    expect(again.body.activeVersion).toBe(2);
  });

  it('rejects invalid configs and keeps the active version', async () => {
    const { api } = setup();
    const broken = v1WithTitle('x');
    broken.steps[0].next = [{ to: 'nowhere' }];
    const res = await api('POST', '/api/admin/funnels/bible-plan/versions', { config: broken });
    expect(res.status).toBe(400);
    expect(res.body.issues.length).toBeGreaterThan(0);
    expect((await api('GET', '/api/admin/funnels/bible-plan')).body.activeVersion).toBe(1);
  });

  it('refuses to roll back past the first version', async () => {
    const { api } = setup();
    expect((await api('POST', '/api/admin/funnels/bible-plan/rollback', {})).status).toBe(409);
  });
});

describe('version pinning', () => {
  it('keeps old sessions on their version; new sessions get the active one', async () => {
    const { api, start } = setup();
    const old = await start();
    expect(old.session.version).toBe(1);

    await api('POST', '/api/admin/funnels/bible-plan/versions', { config: v1WithTitle('NEW') });
    const resumed = await start({ sessionId: old.session.id });
    expect(resumed.resumed).toBe(true);
    expect(resumed.session.version).toBe(1);
    expect(resumed.config.steps.find((s) => s.id === 'result')!.title).toBe('Ваш план готов');
    expect((await api('GET', `/api/sessions/${old.session.id}`)).body.session.version).toBe(1);

    const fresh = await start();
    expect(fresh.session.version).toBe(2);
    expect(fresh.config.steps.find((s) => s.id === 'result')!.title).toBe('NEW');

    // After rollback, v2 sessions still continue on v2, new ones start on v1.
    await api('POST', '/api/admin/funnels/bible-plan/rollback', {});
    expect((await start({ sessionId: fresh.session.id })).session.version).toBe(2);
    expect((await start()).session.version).toBe(1);
  });

  it('old sessions can keep saving state after a new version is published', async () => {
    const { api, start } = setup();
    const s = await start();
    await api('POST', '/api/admin/funnels/bible-plan/versions', { config: v1WithTitle('NEW') });
    const put = await api('PUT', `/api/sessions/${s.session.id}/state`, {
      state: { answers: { goal: 'whole' }, history: ['welcome', 'goal', 'experience'] },
      rev: 0,
    });
    expect(put.body).toEqual({ rev: 1 });
    const stale = await api('PUT', `/api/sessions/${s.session.id}/state`, {
      state: { answers: {}, history: ['welcome'] },
      rev: 0,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.session.rev).toBe(1);
  });
});
