import { describe, expect, it } from 'vitest';
import { loadConfig, setup, v1As } from './helpers';

describe('publish & rollback', () => {
  it('publishes a new version without redeploy and rolls back to the previous one', async () => {
    const { api, publish, rollback } = setup();
    const pub = await publish(loadConfig(2));
    expect(pub.status).toBe(200);
    expect(pub.body.version).toBe(2);
    expect((await api('GET', '/api/admin/funnels/workstyle-planner')).body.activeVersion).toBe(2);

    const rb = await rollback();
    expect(rb.body.activeVersion).toBe(1);
    expect(rb.body.log[0]).toMatchObject({ action: 'rollback', fromVersion: 2, toVersion: 1 });
    expect(rb.body.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(rb.body.versions[0]).toMatchObject({ status: 'draft', releaseNote: expect.stringContaining('meeting') });
    expect((await rollback(2)).body.activeVersion).toBe(2);
  });

  it('refuses to re-publish an existing version number', async () => {
    const { publish } = setup();
    const res = await publish(v1As(1));
    expect(res.status).toBe(409);
  });

  it('rejects invalid configs and keeps the active version', async () => {
    const { api, publish } = setup();
    const broken = v1As(2);
    broken.experiment.variants.A.stepSequence.push('ghost');
    const res = await publish(broken);
    expect(res.status).toBe(400);
    expect(res.body.issues.length).toBeGreaterThan(0);
    expect((await api('GET', '/api/admin/funnels/workstyle-planner')).body.activeVersion).toBe(1);
  });

  it('refuses to roll back past the first version', async () => {
    const { rollback } = setup();
    expect((await rollback()).status).toBe(409);
  });
});

describe('version pinning', () => {
  it('keeps old sessions on their version; new sessions get the active one', async () => {
    const { api, start, publish, rollback } = setup();
    const old = await start();
    expect(old.session.version).toBe(1);

    await publish(v1As(2, 'NEW'));
    const resumed = await start({ sessionId: old.session.id });
    expect(resumed.resumed).toBe(true);
    expect(resumed.session.version).toBe(1);
    expect(resumed.config.steps.intro.content.title).toBe('Build a work model your team can actually follow');
    expect((await api('GET', `/api/sessions/${old.session.id}`)).body.session.version).toBe(1);

    const fresh = await start();
    expect(fresh.session.version).toBe(2);
    expect(fresh.config.steps.intro.content.title).toBe('NEW');

    await rollback();
    expect((await start({ sessionId: fresh.session.id })).session.version).toBe(2);
    expect((await start()).session.version).toBe(1);
  });

  it('old sessions can keep saving state after a new version is published', async () => {
    const { api, start, publish } = setup();
    const s = await start();
    await publish(v1As(2));
    const put = await api('PUT', `/api/sessions/${s.session.id}/state`, {
      state: { answers: { team_size: 8 }, history: ['intro', 'team_size', 'work_mode'] },
      rev: 0,
    });
    expect(put.body).toEqual({ rev: 1 });
    const stale = await api('PUT', `/api/sessions/${s.session.id}/state`, {
      state: { answers: {}, history: ['intro'] },
      rev: 0,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.session.rev).toBe(1);
  });
});
