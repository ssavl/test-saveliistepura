import type { FunnelConfig, Result, SessionState, Variant } from './config';

export interface CreateSessionRequest {
  slug: string;
  sessionId?: string;
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
  config: FunnelConfig;
  resumed: boolean;
}

export interface UpdateStateRequest {
  state: SessionState;
  rev: number;
}

export interface ResultResponse {
  result: Result;
}

export interface VersionDto {
  version: number;
  createdAt: number;
  note: string | null;
  releaseNote: string | null;
  status: string | null;
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
  type: string | null;
  viewed: number;
  completed: number;
  conversion: number | null;
  reach: number | null;
  dropped: number;
  backClicks: number;
}

export interface GroupMetrics {
  key: string;
  started: number;
  resultViewed: number;
  ctaClicked: number;
  resultRate: number | null;
  ctr: number | null;
  ctaConversion: number | null;
  ctaConversionCi: [number, number] | null;
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
  byResult: GroupMetrics[];
  otherEvents: { name: string; sessions: number; events: number }[];
  campaigns: string[];
  versions: number[];
  eventCounts: { raw: number; sessions: number };
}

export const NO_CAMPAIGN = '(none)';
