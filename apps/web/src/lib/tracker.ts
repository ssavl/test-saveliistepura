// Client event tracker: persistent queue, batched flush, beacon on page hide.
import type { FunnelEventInput, IngestResult, SessionDto } from '@funnel/shared';
import { Platform } from 'react-native';

import { api, API_URL } from './api';
import { storage } from './storage';

const QUEUE_KEY = 'funnel:queue';
const seqKey = (sessionId: string) => `funnel:seq:${sessionId}`;
const FLUSH_INTERVAL_MS = 2000;
const FLUSH_THRESHOLD = 10;
const BATCH_SIZE = 100;
const MAX_QUEUE = 2000;

type TrackedEvent = FunnelEventInput & { event_id: string };

let session: Pick<SessionDto, 'id' | 'version' | 'variant' | 'utm'> | null = null;
let inFlight: Promise<void> | null = null;
let started = false;

export function uuid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const readQueue = () => storage.getJSON<TrackedEvent[]>(QUEUE_KEY, []);
const writeQueue = (q: TrackedEvent[]) => storage.setJSON(QUEUE_KEY, q.slice(-MAX_QUEUE));

function nextSeq(sessionId: string): number {
  const cur = Number(storage.get(seqKey(sessionId)) ?? '0');
  const next = (Number.isFinite(cur) ? cur : 0) + 1;
  storage.set(seqKey(sessionId), String(next));
  return next;
}

export function setTrackerSession(s: Pick<SessionDto, 'id' | 'version' | 'variant' | 'utm'> | null) {
  session = s;
  startTracker();
}

export function track(name: string, stepId: string | null, props: Record<string, unknown> = {}) {
  if (!session) return;
  const event: TrackedEvent = {
    event_id: uuid(),
    session_id: session.id,
    name,
    client_ts: Date.now(),
    seq: nextSeq(session.id),
    funnel_version: session.version,
    variant: session.variant,
    step_id: stepId,
    utm: session.utm,
    props,
  };
  const q = readQueue();
  q.push(event);
  writeQueue(q);
  if (q.length >= FLUSH_THRESHOLD) void flushNow();
}

/** Sends queued events (one flush at a time); resolves when the queue is drained or a request fails. */
export function flushNow(): Promise<void> {
  if (inFlight) return inFlight.then(() => (readQueue().length ? flushNow() : undefined));
  // `.finally` runs asynchronously, so inFlight is cleared only after it has been assigned.
  inFlight = drain().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function drain(): Promise<void> {
  for (;;) {
    const batch = readQueue().slice(0, BATCH_SIZE);
    if (!batch.length) return;
    let done: Set<string>;
    try {
      const res = await api<IngestResult>('/api/events', { body: { events: batch }, timeoutMs: 8000 });
      done = new Set([...(res.accepted ?? []), ...(res.duplicates ?? [])]);
      for (const r of res.rejected ?? []) {
        const id = r.event_id ?? batch[r.index]?.event_id;
        if (id) done.add(id);
        console.warn('[tracker] event rejected', id, r.reason);
      }
    } catch (e) {
      const status = (e as { status?: number }).status ?? 0;
      // Malformed batch as a whole: drop it rather than retry forever. Network / 5xx / 429: keep.
      if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
        done = new Set(batch.map((ev) => ev.event_id));
      } else {
        return;
      }
    }
    if (!done.size) return;
    writeQueue(readQueue().filter((ev) => !done.has(ev.event_id)));
  }
}

// Best effort on page hide. Events stay queued: if the beacon got through, the next flush is deduped server-side.
function beacon() {
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return;
  const batch = readQueue().slice(0, BATCH_SIZE);
  if (!batch.length) return;
  try {
    const blob = new Blob([JSON.stringify({ events: batch })], { type: 'application/json' });
    navigator.sendBeacon(`${API_URL}/api/events`, blob);
  } catch {}
}

function startTracker() {
  if (started) return;
  started = true;
  setInterval(() => void flushNow(), FLUSH_INTERVAL_MS);
  if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof document !== 'undefined') {
    window.addEventListener('pagehide', beacon);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') beacon();
    });
  }
}
