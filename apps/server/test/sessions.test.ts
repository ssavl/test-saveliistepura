import { describe, expect, it } from 'vitest';
import { assignVariant, hashUnit } from '../src/sessions';
import { setup, v1 } from './helpers';

describe('A/B assignment', () => {
  it('is stable for a session across resumes (refresh)', async () => {
    const { start } = setup();
    const s = await start();
    for (let i = 0; i < 5; i++) {
      const again = await start({ sessionId: s.session.id });
      expect(again.session.id).toBe(s.session.id);
      expect(again.session.variant).toBe(s.session.variant);
    }
  });

  it('is deterministic per session id and follows the weights', () => {
    const ids = Array.from({ length: 4000 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const share = (cfg: unknown) => ids.filter((id) => assignVariant(id, cfg as never) === 'B').length / ids.length;
    const w = (a: number, b: number) => ({ experiment: { id: 'x', variants: { A: { weight: a }, B: { weight: b } } } });
    expect(share(w(50, 50))).toBeGreaterThan(0.46);
    expect(share(w(50, 50))).toBeLessThan(0.54);
    expect(share(w(90, 10))).toBeLessThan(0.13);
    expect(share(w(100, 0))).toBe(0);
    expect(ids.map((id) => assignVariant(id, v1))).toEqual(ids.map((id) => assignVariant(id, v1)));
    expect(hashUnit('x')).toBe(hashUnit('x'));
  });

  it('honours the query override; a conflicting override starts a new session', async () => {
    const { start } = setup();
    const b = await start({ variantOverride: 'B' });
    expect(b.session.variant).toBe('B');
    expect((await start({ sessionId: b.session.id, variantOverride: 'B' })).session.id).toBe(b.session.id);
    const a = await start({ sessionId: b.session.id, variantOverride: 'A' });
    expect(a.session.id).not.toBe(b.session.id);
    expect(a.session.variant).toBe('A');
  });

  it('records session_started once, server-side, with experiment and UTM', async () => {
    const { db, start } = setup();
    const s = await start({ utm: { utm_campaign: 'spring', utm_source: 'linkedin' } });
    await start({ sessionId: s.session.id });
    const rows = db.prepare("SELECT * FROM events WHERE session_id = ? AND name = 'session_started'").all(s.session.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      utm_campaign: 'spring',
      utm_source: 'linkedin',
      funnel_version: 1,
      experiment_id: 'question-order-and-result-framing-v1',
      seq: 0,
    });
  });

  it('expires after session.ttlHours of inactivity', async () => {
    const { db, start } = setup();
    const s = await start();
    db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(Date.now() - 1, s.session.id);
    const again = await start({ sessionId: s.session.id });
    expect(again.session.id).not.toBe(s.session.id);
    expect(again.session.expiresAt - again.session.createdAt).toBe(72 * 3_600_000);
  });

  it('rejects state with steps outside the pinned version/variant', async () => {
    const { api, start } = setup();
    const s = await start();
    const res = await api('PUT', `/api/sessions/${s.session.id}/state`, {
      state: { answers: {}, history: ['intro', 'meeting_hours'] },
      rev: 0,
    });
    expect(res.status).toBe(400);
  });

  it('computes the result server-side from stored answers', async () => {
    const { api, start } = setup();
    const s = await start({ variantOverride: 'B' });
    await api('PUT', `/api/sessions/${s.session.id}/state`, {
      state: { answers: { work_mode: 'hybrid', async_maturity: 'low', office_days: 2 }, history: ['intro'] },
      rev: 0,
    });
    const r = await api('GET', `/api/sessions/${s.session.id}/result`);
    expect(r.body.result).toMatchObject({ id: 'hybrid_structured', title: 'Your hybrid model needs clearer rules' });
    expect(r.body.result.recommendations).toHaveLength(3);
  });
});
