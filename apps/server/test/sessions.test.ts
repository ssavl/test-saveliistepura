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

  it('is deterministic per session id and roughly balanced', () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const cfg = { experiment: { key: 'k', splitB: 0.5 } } as never;
    const b = ids.filter((id) => assignVariant(id, cfg) === 'B').length;
    expect(b / ids.length).toBeGreaterThan(0.45);
    expect(b / ids.length).toBeLessThan(0.55);
    expect(ids.map((id) => assignVariant(id, cfg))).toEqual(ids.map((id) => assignVariant(id, cfg)));
    expect(hashUnit('x')).toBe(hashUnit('x'));
  });

  it('honours the query override, and a conflicting override starts a new session', async () => {
    const { start } = setup();
    const b = await start({ variantOverride: 'B' });
    expect(b.session.variant).toBe('B');
    expect((await start({ sessionId: b.session.id, variantOverride: 'B' })).session.id).toBe(b.session.id);
    const a = await start({ sessionId: b.session.id, variantOverride: 'A' });
    expect(a.session.id).not.toBe(b.session.id);
    expect(a.session.variant).toBe('A');
  });

  it('records session_started once, server-side', async () => {
    const { db, start } = setup();
    const s = await start({ utm: { utm_campaign: 'lent' } });
    await start({ sessionId: s.session.id });
    const rows = db.prepare("SELECT * FROM events WHERE session_id = ? AND name = 'session_started'").all(s.session.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ utm_campaign: 'lent', funnel_version: 1, seq: 0 });
  });

  it('rejects state with steps from another version', async () => {
    const { api, start } = setup();
    const s = await start();
    const res = await api('PUT', `/api/sessions/${s.session.id}/state`, {
      state: { answers: {}, history: ['welcome', 'not_a_step'] },
      rev: 0,
    });
    expect(res.status).toBe(400);
    expect(v1.slug).toBe('bible-plan');
  });
});
