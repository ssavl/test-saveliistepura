import { describe, expect, it } from 'vitest';
import { loadConfig, makeEvent, setup } from './helpers';

describe('event ingestion', () => {
  it('dedupes by event_id within a batch, across batches and on retries', async () => {
    const { api, db, start } = setup();
    const s = await start();
    const e1 = makeEvent(s, 'step_viewed', 'intro', 1);
    const e2 = makeEvent(s, 'step_completed', 'intro', 2);
    const first = await api('POST', '/api/events', { events: [e1, e2, e1] });
    expect(first.body.accepted).toEqual([e1.event_id, e2.event_id]);
    expect(first.body.duplicates).toEqual([e1.event_id]);

    const retry = await api('POST', '/api/events', { events: [e1, e2] });
    expect(retry.body.accepted).toEqual([]);
    expect(retry.body.duplicates).toHaveLength(2);
    const n = db
      .prepare("SELECT COUNT(*) AS n FROM events WHERE session_id = ? AND name != 'session_started'")
      .get(s.session.id);
    expect(n).toEqual({ n: 2 });
  });

  it('rejects bad events without dropping the rest of the batch', async () => {
    const { api, start } = setup();
    const s = await start();
    const good = makeEvent(s, 'step_viewed', 'intro', 1);
    const res = await api('POST', '/api/events', {
      events: [
        { foo: 'bar' },
        makeEvent(s, 'step_viewed', null, 2),
        makeEvent(s, 'session_started', null, 3),
        { ...makeEvent(s, 'step_viewed', 'intro', 4), session_id: '11111111-1111-4111-8111-111111111111' },
        makeEvent(s, 'step_viewed', 'meeting_hours', 5),
        makeEvent(s, 'recommendation_expanded', 'result', 6),
        good,
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.accepted).toEqual([good.event_id]);
    expect(res.body.rejected.map((r: { index: number }) => r.index)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('takes funnel facts from the session and keeps only allowed properties', async () => {
    const { api, db, start } = setup();
    const s = await start({ utm: { utm_campaign: 'c1', utm_source: 'tg' } });
    const e = makeEvent(s, 'answer_submitted', 'team_size', 1, {
      funnel_version: 99,
      experiment_id: 'forged',
      variant: s.session.variant === 'A' ? 'B' : 'A',
      utm_campaign: 'forged',
      properties: { answer_kind: 'number', value: 17, raw: 'text' },
    });
    await api('POST', '/api/events', { events: [e] });
    const row = db.prepare('SELECT * FROM events WHERE event_id = ?').get(e.event_id) as Record<string, unknown>;
    expect(row).toMatchObject({
      funnel_version: 1,
      experiment_id: 'question-order-and-result-framing-v1',
      variant: s.session.variant,
      utm_campaign: 'c1',
      utm_source: 'tg',
    });
    expect(JSON.parse(row.props_json as string)).toEqual({ answer_kind: 'number' });
  });

  it('accepts events added in a newer version for sessions on that version', async () => {
    const { api, start, publish } = setup();
    await publish(loadConfig(3));
    const s = await start();
    const res = await api('POST', '/api/events', {
      events: [makeEvent(s, 'recommendation_expanded', 'result', 1, { properties: { result_id: 'x', source: 'cta' } })],
    });
    expect(res.body.accepted).toHaveLength(1);
  });

  it('limits batch size', async () => {
    const { api } = setup();
    expect((await api('POST', '/api/events', { events: new Array(501).fill({}) })).status).toBe(413);
    expect((await api('POST', '/api/events', { events: 'nope' })).status).toBe(400);
  });
});
