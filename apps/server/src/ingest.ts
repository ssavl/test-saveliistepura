import { EventSchema, type IngestResult, MAX_BATCH, STEP_EVENTS } from '@funnel/shared';
import { type Db, tx } from './db';
import { loadSession } from './sessions';
import { getFunnel, HttpError } from './versions';

const MAX_PROPS_JSON = 2000;

export function ingestEvents(db: Db, events: unknown): IngestResult {
  if (!Array.isArray(events)) throw new HttpError(400, '`events` must be an array');
  if (events.length > MAX_BATCH) throw new HttpError(413, `Batch too large (max ${MAX_BATCH})`);

  const result: IngestResult = { accepted: [], duplicates: [], rejected: [] };
  const insert = db.prepare(
    `INSERT OR IGNORE INTO events (event_id, session_id, slug, name, step_id, funnel_version, experiment_id, variant,
                                   utm_source, utm_medium, utm_campaign, utm_json, props_json, client_ts, seq, server_ts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

      if (!sessions.has(e.session_id)) sessions.set(e.session_id, loadSession(db, e.session_id));
      const session = sessions.get(e.session_id);
      if (!session) return reject('unknown session');
      const funnel = getFunnel(db, session.slug, session.version, session.variant);
      if (!funnel) return reject('pinned version missing');

      const allowedProps = funnel.events[e.name];
      if (!allowedProps) return reject(`event "${e.name}" is not allowed in version ${session.version}`);
      if (STEP_EVENTS.has(e.name)) {
        if (!e.step_id) return reject(`${e.name} requires step_id`);
        if (!funnel.steps[e.step_id]) return reject(`step "${e.step_id}" is not in version ${session.version}/${session.variant}`);
      }
      const props = Object.fromEntries(Object.entries(e.properties).filter(([k]) => allowedProps.includes(k)));
      const propsJson = JSON.stringify(props);
      if (propsJson.length > MAX_PROPS_JSON) return reject('properties too large');

      const { utm } = session;
      const { changes } = insert.run(
        e.event_id,
        e.session_id,
        session.slug,
        e.name,
        e.step_id,
        session.version,
        session.experimentId,
        session.variant,
        utm.utm_source ?? null,
        utm.utm_medium ?? null,
        utm.utm_campaign ?? null,
        JSON.stringify(utm),
        propsJson,
        e.client_timestamp,
        e.seq,
        now,
      );
      (changes ? result.accepted : result.duplicates).push(e.event_id);
    });
  });
  return result;
}
