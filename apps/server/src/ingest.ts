// Batch event ingestion: idempotent by event_id, per-item validation, one transaction per batch.
import { EventSchema, type IngestResult, MAX_BATCH, STEP_EVENTS } from '@funnel/shared';
import { type Db, tx } from './db';
import { loadSession } from './sessions';
import { HttpError } from './versions';

// Props kept for answer_submitted: option ids and number buckets only, never raw input.
const ANSWER_PROPS = new Set(['option', 'options', 'bucket']);
const MAX_PROPS_JSON = 2000;

export function ingestEvents(db: Db, events: unknown): IngestResult {
  if (!Array.isArray(events)) throw new HttpError(400, '`events` must be an array');
  if (events.length > MAX_BATCH) throw new HttpError(413, `Batch too large (max ${MAX_BATCH})`);

  const result: IngestResult = { accepted: [], duplicates: [], rejected: [] };
  const insert = db.prepare(
    `INSERT OR IGNORE INTO events (event_id, session_id, slug, name, step_id, funnel_version, variant, utm_campaign,
                                   utm_json, props_json, client_ts, seq, server_ts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const sessions = new Map<string, ReturnType<typeof loadSession>>();
  const now = Date.now();

  tx(db, () => {
    events.forEach((raw, index) => {
      const eventId = (raw as { event_id?: unknown })?.event_id;
      const reject = (reason: string) =>
        result.rejected.push({ index, event_id: typeof eventId === 'string' ? eventId : undefined, reason });

      const parsed = EventSchema.safeParse(raw);
      if (!parsed.success) {
        return reject(parsed.error.issues.map((i) => `${i.path.join('.') || 'event'}: ${i.message}`).join('; '));
      }
      const e = parsed.data;
      if (e.name === 'session_started') return reject('session_started is recorded by the server');
      if (STEP_EVENTS.has(e.name) && !e.step_id) return reject(`${e.name} requires step_id`);

      if (!sessions.has(e.session_id)) sessions.set(e.session_id, loadSession(db, e.session_id));
      const session = sessions.get(e.session_id);
      if (!session) return reject('unknown session');

      let props = e.props;
      if (e.name === 'answer_submitted') {
        props = Object.fromEntries(Object.entries(props).filter(([k]) => ANSWER_PROPS.has(k)));
      }
      const propsJson = JSON.stringify(props);
      if (propsJson.length > MAX_PROPS_JSON) return reject('props too large');

      // Version, variant and UTM are session facts: the stored session is the source of truth.
      const { changes } = insert.run(
        e.event_id,
        e.session_id,
        session.slug,
        e.name,
        e.step_id,
        session.version,
        session.variant,
        session.utm.utm_campaign ?? null,
        JSON.stringify(session.utm),
        propsJson,
        e.client_ts,
        e.seq,
        now,
      );
      (changes ? result.accepted : result.duplicates).push(e.event_id);
    });
  });
  return result;
}
