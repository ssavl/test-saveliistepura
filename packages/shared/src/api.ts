// HTTP contract between web client, traffic generator and server.
//
// Funnel runtime
//   POST /api/sessions                  CreateSessionRequest -> SessionResponse
//        Resumes `sessionId` if it exists for this slug, is within session.ttlHours (and its variant equals variantOverride, if given);
//        otherwise creates a session pinned to the ACTIVE version. The server records `session_started`
//        itself (seq 0) — clients never send it. Client event seq starts at 1.
//   GET  /api/sessions/:id              -> SessionResponse | 404
//   GET  /api/sessions/:id/result       -> ResultResponse (computed from stored answers) | 404
//   PUT  /api/sessions/:id/state        UpdateStateRequest -> { rev } | 409 SessionResponse (stale rev) | 400
//   POST /api/events                    { events: unknown[] } (<= MAX_BATCH) -> IngestResult (always 200 per-item)
//        Envelope must be schema-valid; funnel_id/version/experiment_id/variant/utm_* are then overwritten from the stored session; the event name and
//        properties are filtered by the pinned version's `events.allowed`.
//
// Admin (header `x-admin-token` required when the server has ADMIN_TOKEN set)
//   GET  /api/admin/funnels                                -> { slug, activeVersion }[]
//   GET  /api/admin/funnels/:slug                          -> FunnelAdminDto
//   GET  /api/admin/funnels/:slug/versions/:version        -> { version, config }
//   POST /api/admin/validate                 { config }    -> { issues: ConfigIssue[] }
//   POST /api/admin/funnels/:slug/versions   { config, note? } -> { version, issues } | 400 { issues }
//        version = config.version (must be new) -> 409 { error } if already published
//   POST /api/admin/funnels/:slug/rollback   { toVersion? }    -> FunnelAdminDto (default: previous version)
//   GET  /api/admin/config-files                           -> { files: string[] }   (JSON files in /configs)
//   GET  /api/admin/config-files/:name                     -> raw JSON of that file
//
// Analytics
//   GET  /api/analytics?slug=&version=&variant=&utm_campaign=  -> AnalyticsResponse
import type { FunnelConfig, Result, SessionState, Variant } from './config';

export interface CreateSessionRequest {
  slug: string; // funnelId
  sessionId?: string; // resume if it exists, is not expired, matches slug (and variantOverride, if given)
  utm?: Record<string, string>;
  variantOverride?: Variant;
}

export interface SessionDto {
  id: string;
  slug: string;
  version: number;
  experimentId: string;
  variant: Variant;
  utm: Record<string, string>;
  state: SessionState;
  rev: number;
  createdAt: number;
  expiresAt: number;
}

export interface SessionResponse {
  session: SessionDto;
  config: FunnelConfig; // the version pinned to this session, not necessarily the active one
  resumed: boolean;
}

export interface UpdateStateRequest {
  state: SessionState;
  rev: number; // optimistic concurrency: must equal the stored rev
}

/** Result computed server-side from the stored answers (resultRules over effective answers). */
export interface ResultResponse {
  result: Result; // variant resultOverrides applied
}

export interface VersionDto {
  version: number;
  createdAt: number;
  note: string | null;
  releaseNote: string | null;
  status: string | null; // `status` field of the published file (informational)
  active: boolean;
  sessions: number;
}

export interface VersionLogDto {
  action: 'publish' | 'rollback' | 'activate';
  fromVersion: number | null;
  toVersion: number;
  at: number;
}

export interface FunnelAdminDto {
  slug: string;
  title: string;
  activeVersion: number | null;
  versions: VersionDto[];
  log: VersionLogDto[];
}

export interface StepMetrics {
  stepId: string;
  type: string | null; // null if the step is absent from the selected configs
  viewed: number; // unique sessions
  completed: number;
  conversion: number | null; // completed / viewed
  reach: number | null; // viewed / started
  dropped: number; // sessions whose last seen step (by client seq) is this one and never reached a result
  backClicks: number; // unique sessions that clicked back on this step
}

export interface GroupMetrics {
  key: string; // variant / version / campaign / result id
  started: number;
  resultViewed: number;
  ctaClicked: number;
  resultRate: number | null; // result / started
  ctr: number | null; // cta / result
  ctaConversion: number | null; // cta / started (primary metric)
  ctaConversionCi: [number, number] | null; // Wilson 95%
}

export interface AnalyticsResponse {
  slug: string;
  filters: { version?: number; variant?: Variant; utm_campaign?: string };
  totals: GroupMetrics & { droppedBeforeFirstStep: number };
  steps: StepMetrics[];
  byVariant: GroupMetrics[];
  abTest: { pValue: number | null; liftAbs: number | null; liftRel: number | null };
  byVersion: GroupMetrics[];
  byCampaign: GroupMetrics[];
  byResult: GroupMetrics[]; // started = sessions that saw this result
  otherEvents: { name: string; sessions: number; events: number }[];
  campaigns: string[];
  versions: number[];
  eventCounts: { raw: number; sessions: number };
}

/** utm_campaign filter/group key for sessions without a campaign. */
export const NO_CAMPAIGN = '(none)';
