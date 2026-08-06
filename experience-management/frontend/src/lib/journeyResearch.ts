import { api, json } from '@/lib/api';
import type { DiscoverableEvidenceSourceType } from '@/lib/journeyMaps';

export const JOURNEY_RESEARCH_BASE = '/api/journey-research' as const;

export type JourneyResearchTargetType = 'definition' | 'stage' | 'card' | 'persona';
export type JourneyResearchSourceType = DiscoverableEvidenceSourceType | 'interview' | 'observation' | 'event_aggregate';
export type JourneyResearchRelationship = 'supports' | 'contradicts' | 'neutral';
export type JourneyResearchClassification =
  | 'hypothesis' | 'anecdotal' | 'supported' | 'strongly_supported'
  | 'contradicted' | 'stale' | 'invalidated';
export type JourneyResearchGapStatus = 'open' | 'planned' | 'in_progress' | 'resolved' | 'dismissed';
export type JourneyResearchPriority = 'low' | 'medium' | 'high' | 'critical';

export interface JourneyResearchSourceSummary {
  id: string;
  sourceType: JourneyResearchSourceType;
  state: 'active' | 'inaccessible' | 'deleted';
  revision: number;
  ownerUserId: string | null;
  lastResolvedAt: string | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JourneyResearchSnapshot {
  id: string;
  sourceId: string;
  version: number;
  fingerprint: string;
  accessState: 'available' | 'inaccessible' | 'deleted';
  sourceLabel: string;
  excerpt: string;
  population: string;
  sampleSize: number | null;
  collectedAt: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  sourceUpdatedAt: string | null;
  metadata: Record<string, unknown>;
  createdByUserId: string | null;
  createdAt: string;
  retentionExpiresAt: string;
}

export interface JourneyResearchCatalogueItem {
  sourceType: JourneyResearchSourceType;
  sourceRef: string;
  sourceId: string;
  label: string;
  state: string;
  sampleSize: number | null;
  collectedAt: string | null;
  updatedAt: string | null;
  existingEvidenceLinkCount: number;
  researchSourceId: string | null;
  researchSourceState: JourneyResearchSourceSummary['state'] | null;
  researchSourceRevision: number | null;
}

export interface JourneyResearchLinkSummary {
  id: string;
  sourceId: string;
  snapshotId: string | null;
  targetType: JourneyResearchTargetType;
  targetId: string;
  state: 'active' | 'invalidated';
  revision: number;
  access: 'available' | 'inaccessible';
  relationship: JourneyResearchRelationship | null;
  classification: JourneyResearchClassification | null;
  confidence: number | null;
  freshnessDays: number | null;
  isContradictory: boolean | null;
  isStale: boolean | null;
  createdAt: string;
  updatedAt: string;
}

export interface JourneyResearchAssessment {
  id: string;
  revision: number;
  relationship: JourneyResearchRelationship;
  classification: JourneyResearchClassification;
  confidence: number;
  freshnessDays: number | null;
  reason: string;
  method: 'human_review' | 'imported_review';
  reviewerUserId: string | null;
  createdAt: string;
}

export interface JourneyResearchLinkDetail {
  link: Omit<JourneyResearchLinkSummary, 'access'>;
  source: JourneyResearchSourceSummary;
  current: Record<string, unknown>;
  snapshot: JourneyResearchSnapshot;
  assessment: JourneyResearchAssessment | null;
}

export interface JourneyResearchGap {
  id: string;
  label: 'Research gap';
  targetType: JourneyResearchTargetType;
  targetId: string;
  priority: JourneyResearchPriority;
  status: JourneyResearchGapStatus;
  ownerUserId: string | null;
  resolutionLinkId: string | null;
  revision: number;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
  title?: string;
  description?: string;
}

export interface JourneyResearchIntake {
  id: string;
  sourceId: string;
  knowledgeBaseId: string;
  knowledgeDocumentId: string;
  kind: 'interview' | 'observation' | 'research_note';
  method: string;
  conductedAt: string | null;
  population: string;
  tags: string[];
  consentBasis: 'documented' | 'not_required';
  researcherUserId: string | null;
  retentionExpiresAt: string;
  createdAt: string;
}

export interface JourneyResearchMonitor {
  id: string;
  sourceId: string;
  ownerUserId: string;
  state: 'active' | 'paused';
  intervalSeconds: number;
  nextRunAt: string;
  lastRunAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface JourneyResearchRefreshRun {
  id: string;
  sourceId: string;
  monitorId: string | null;
  trigger: 'manual' | 'scheduled';
  state: 'queued' | 'leased' | 'completed' | 'retry_wait' | 'failed';
  revision: number;
  availableAt: string;
  attemptCount: number;
  maxAttempts: number;
  beforeSnapshotId: string | null;
  afterSnapshotId: string | null;
  changedFields: string[];
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface JourneyResearchNotification {
  id: string;
  sourceId: string;
  refreshRunId: string | null;
  kind: 'source_changed' | 'source_inaccessible' | 'source_recovered' | 'source_stale' | 'refresh_failed';
  state: 'unread' | 'read' | 'dismissed';
  detail: { changedFields?: string[]; outcome?: string; errorCode?: string };
  revision: number;
  createdAt: string;
  readAt: string | null;
}

export interface JourneyResearchAuditEvent {
  id: string;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export type JourneyResearchInboxItem =
  | ({ itemKind: 'notification' } & JourneyResearchNotification)
  | ({ itemKind: 'gap' } & JourneyResearchGap)
  | { itemKind: 'source_state'; sourceId: string; state: string; updatedAt: string }
  | {
      itemKind: 'existing_evidence_link'; linkId: string; targetType: string; targetId: string;
      access: string; refreshStatus: string; changedFields: string[]; unavailableReason: string | null;
      updatedAt: string;
    };

function queryString(values: Record<string, string | number | null | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== null && value !== '') {
    query.set(key, String(value));
  }
  const encoded = query.toString();
  return encoded ? `?${encoded}` : '';
}

function idempotentJson(method: string, body: Record<string, unknown>) {
  return {
    ...json(method, body),
    headers: { 'Idempotency-Key': crypto.randomUUID() }
  } satisfies RequestInit;
}

export function listJourneyResearchCatalogue(input: { query?: string; limit?: number; cursor?: string } = {}) {
  return api<{ items: JourneyResearchCatalogueItem[]; nextCursor: string | null }>(
    `${JOURNEY_RESEARCH_BASE}/catalogue${queryString(input)}`
  );
}

export function listJourneyResearchInbox(limit = 50, offset = 0) {
  return api<{ items: JourneyResearchInboxItem[]; nextOffset: number | null }>(
    `${JOURNEY_RESEARCH_BASE}/inbox${queryString({ limit, offset })}`
  );
}

export function catalogueJourneyResearchSource(input: {
  sourceType: JourneyResearchSourceType; sourceRef: string; retentionDays?: number;
}) {
  return api<{ source: JourneyResearchSourceSummary; snapshot: JourneyResearchSnapshot | null; created: boolean; replayed: boolean }>(
    `${JOURNEY_RESEARCH_BASE}/sources`, idempotentJson('POST', input)
  );
}

export function getJourneyResearchSource(sourceId: string) {
  return api<{ source: JourneyResearchSourceSummary; current: Record<string, unknown>; latestSnapshot: JourneyResearchSnapshot | null }>(
    `${JOURNEY_RESEARCH_BASE}/sources/${encodeURIComponent(sourceId)}`
  );
}

export function getJourneyResearchSnapshot(snapshotId: string) {
  return api<{ snapshot: JourneyResearchSnapshot }>(
    `${JOURNEY_RESEARCH_BASE}/snapshots/${encodeURIComponent(snapshotId)}`
  );
}

export function listJourneyResearchLinks(input: {
  targetType?: JourneyResearchTargetType; targetId?: string; limit?: number; offset?: number;
} = {}) {
  return api<{ links: JourneyResearchLinkSummary[] }>(
    `${JOURNEY_RESEARCH_BASE}/links${queryString(input)}`
  );
}

export function createJourneyResearchLink(input: {
  sourceId: string; targetType: JourneyResearchTargetType; targetId: string;
}) {
  return api<{ link: JourneyResearchLinkSummary; replayed: boolean }>(
    `${JOURNEY_RESEARCH_BASE}/links`, idempotentJson('POST', input)
  );
}

export function getJourneyResearchLink(linkId: string) {
  return api<JourneyResearchLinkDetail>(`${JOURNEY_RESEARCH_BASE}/links/${encodeURIComponent(linkId)}`);
}

export function applyLatestJourneyResearchSnapshot(linkId: string, expectedRevision: number) {
  return api<{ link: JourneyResearchLinkSummary }>(
    `${JOURNEY_RESEARCH_BASE}/links/${encodeURIComponent(linkId)}/apply-latest-snapshot`,
    json('POST', { expectedRevision })
  );
}

export function assessJourneyResearchLink(linkId: string, input: {
  expectedRevision: number; relationship: JourneyResearchRelationship;
  classification: JourneyResearchClassification; confidence: number;
  freshnessDays?: number | null; reason?: string; method?: 'human_review' | 'imported_review';
}) {
  return api<JourneyResearchLinkDetail>(
    `${JOURNEY_RESEARCH_BASE}/links/${encodeURIComponent(linkId)}/assessments`, json('POST', input)
  );
}

export function listJourneyResearchGaps(input: { status?: JourneyResearchGapStatus; limit?: number; offset?: number } = {}) {
  return api<{ gaps: JourneyResearchGap[] }>(`${JOURNEY_RESEARCH_BASE}/gaps${queryString(input)}`);
}

export function createJourneyResearchGap(input: {
  targetType: JourneyResearchTargetType; targetId: string; title: string; description?: string;
  priority?: JourneyResearchPriority; ownerUserId?: string | null; dueAt?: string | null;
}) {
  return api<{ gap: JourneyResearchGap; replayed: boolean }>(
    `${JOURNEY_RESEARCH_BASE}/gaps`, idempotentJson('POST', input)
  );
}

export function updateJourneyResearchGap(gapId: string, input: {
  expectedRevision: number; status?: JourneyResearchGapStatus; priority?: JourneyResearchPriority;
  ownerUserId?: string | null; resolutionLinkId?: string | null; dueAt?: string | null;
}) {
  return api<{ gap: JourneyResearchGap }>(
    `${JOURNEY_RESEARCH_BASE}/gaps/${encodeURIComponent(gapId)}`, json('PATCH', input)
  );
}

export function listJourneyResearchIntakes(limit = 50, offset = 0) {
  return api<{ intakes: JourneyResearchIntake[] }>(
    `${JOURNEY_RESEARCH_BASE}/intakes${queryString({ limit, offset })}`
  );
}

export function createJourneyResearchIntake(input: {
  knowledgeBaseId: string; kind: JourneyResearchIntake['kind']; method: string; markdown: string;
  conductedAt?: string | null; population?: string; tags?: string[];
  consentBasis: JourneyResearchIntake['consentBasis']; retentionExpiresAt: string;
}) {
  return api<{ intake: JourneyResearchIntake; replayed: boolean }>(
    `${JOURNEY_RESEARCH_BASE}/intakes`, idempotentJson('POST', input)
  );
}

export function listJourneyResearchMonitors(limit = 50, offset = 0) {
  return api<{ monitors: JourneyResearchMonitor[] }>(
    `${JOURNEY_RESEARCH_BASE}/monitors${queryString({ limit, offset })}`
  );
}

export function createJourneyResearchMonitor(sourceId: string, intervalSeconds: number) {
  return api<{ monitor: JourneyResearchMonitor; replayed: boolean }>(
    `${JOURNEY_RESEARCH_BASE}/monitors`, idempotentJson('POST', { sourceId, intervalSeconds })
  );
}

export function updateJourneyResearchMonitor(monitorId: string, input: {
  expectedRevision: number; state?: JourneyResearchMonitor['state']; intervalSeconds?: number;
}) {
  return api<{ monitor: JourneyResearchMonitor }>(
    `${JOURNEY_RESEARCH_BASE}/monitors/${encodeURIComponent(monitorId)}`, json('PATCH', input)
  );
}

export function listJourneyResearchRefreshRuns(limit = 50, offset = 0) {
  return api<{ runs: JourneyResearchRefreshRun[] }>(
    `${JOURNEY_RESEARCH_BASE}/refresh-runs${queryString({ limit, offset })}`
  );
}

export function queueJourneyResearchRefresh(sourceId: string) {
  return api<{ run: JourneyResearchRefreshRun; replayed: boolean }>(
    `${JOURNEY_RESEARCH_BASE}/refresh-runs`, idempotentJson('POST', { sourceId })
  );
}

export function listJourneyResearchNotifications(input: {
  state?: JourneyResearchNotification['state']; limit?: number; offset?: number;
} = {}) {
  return api<{ notifications: JourneyResearchNotification[] }>(
    `${JOURNEY_RESEARCH_BASE}/notifications${queryString(input)}`
  );
}

export function updateJourneyResearchNotification(notificationId: string, input: {
  expectedRevision: number; state: 'read' | 'dismissed';
}) {
  return api<{ notification: JourneyResearchNotification }>(
    `${JOURNEY_RESEARCH_BASE}/notifications/${encodeURIComponent(notificationId)}`, json('PATCH', input)
  );
}

export function listJourneyResearchAudit(limit = 50, offset = 0) {
  return api<{ events: JourneyResearchAuditEvent[] }>(
    `${JOURNEY_RESEARCH_BASE}/audit${queryString({ limit, offset })}`
  );
}
