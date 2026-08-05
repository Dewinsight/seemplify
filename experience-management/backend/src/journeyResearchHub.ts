import crypto from 'node:crypto';
import { db } from './database.js';
import { isDatabaseConstraintError } from './databaseAdapter.js';
import type { EvidenceSourceType } from './journeyDomain.js';
import {
  journeyEvidenceReadState, journeyEvidenceSnapshotFingerprint, journeyEvidenceSnapshotFromSource,
  type JourneyEvidenceSnapshot
} from './journeyEvidenceLifecycle.js';
import {
  discoverableJourneyEvidenceSourceTypes, journeyEvidenceSourceAdapters,
  resolveJourneyEvidenceLifecycle, resolveJourneyEvidenceSource, searchJourneyEvidenceSources,
  type DiscoverableJourneyEvidenceSourceType, type JourneyEvidenceSourceView
} from './journeyEvidenceSources.js';
import { createKnowledgeMarkdownDocument, getKnowledgeBase } from './knowledgeRepository.js';
import { publishEvent } from './events.js';
import { assertSubscriptionFeature } from './subscriptionEntitlements.js';

export type JourneyResearchTargetType = 'definition' | 'stage' | 'card' | 'persona';
export type JourneyResearchNotificationKind =
  | 'source_changed' | 'source_inaccessible' | 'source_recovered' | 'source_stale' | 'refresh_failed';

export class JourneyResearchError extends Error {
  constructor(message: string, public status = 400, public code = 'JOURNEY_RESEARCH_INVALID') {
    super(message);
    this.name = 'JourneyResearchError';
  }
}

type SourceRow = {
  id: string; space_id: string; source_type: EvidenceSourceType; source_ref: string; adapter: string;
  owner_user_id: string | null; state: 'active' | 'inaccessible' | 'deleted'; revision: number | string;
  last_resolved_at: unknown; last_error_code: string | null; idempotency_key: string | null;
  intent_sha256: string; created_at: unknown; updated_at: unknown;
};

type SnapshotRow = {
  id: string; source_id: string; space_id: string; version_number: number | string; fingerprint: string;
  access_state: 'available' | 'inaccessible' | 'deleted'; source_label: string; excerpt: string;
  population: string; sample_size: number | string | null; collected_at: unknown; window_start: unknown;
  window_end: unknown; source_updated_at: unknown; metadata_json: unknown; created_by_user_id: string | null;
  created_at: unknown; retention_expires_at: unknown;
};

type LinkRow = {
  id: string; space_id: string; source_id: string; snapshot_id: string; target_type: JourneyResearchTargetType;
  target_id: string; state: 'active' | 'invalidated'; revision: number | string; idempotency_key: string | null;
  intent_sha256: string; created_by_user_id: string | null; created_at: unknown; updated_at: unknown;
};

type AssessmentRow = {
  id: string; link_id: string; space_id: string; revision: number | string;
  relationship: 'supports' | 'contradicts' | 'neutral';
  classification: 'hypothesis' | 'anecdotal' | 'supported' | 'strongly_supported' | 'contradicted' | 'stale' | 'invalidated';
  confidence: number | string; freshness_days: number | string | null; reason_summary: string; reason_sha256: string;
  reviewer_user_id: string | null; method: 'human_review' | 'imported_review'; created_at: unknown;
};

type GapRow = {
  id: string; space_id: string; target_type: JourneyResearchTargetType; target_id: string; title: string;
  description: string; priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'planned' | 'in_progress' | 'resolved' | 'dismissed'; owner_user_id: string | null;
  resolution_link_id: string | null; revision: number | string; idempotency_key: string | null;
  intent_sha256: string; due_at: unknown; created_by_user_id: string | null; created_at: unknown; updated_at: unknown;
};

type MonitorRow = {
  id: string; space_id: string; source_id: string; owner_user_id: string;
  state: 'active' | 'paused'; interval_seconds: number | string; next_run_at: unknown; last_run_at: unknown;
  revision: number | string; idempotency_key: string | null; intent_sha256: string;
  created_at: unknown; updated_at: unknown;
};

type RefreshRunRow = {
  id: string; space_id: string; source_id: string; monitor_id: string | null; requested_by_user_id: string | null;
  trigger_kind: 'manual' | 'scheduled'; state: 'queued' | 'leased' | 'retry_wait' | 'completed' | 'failed';
  revision: number | string; available_at: unknown; lease_owner: string | null; lease_token: string | null;
  lease_generation: number | string; lease_expires_at: unknown; attempt_count: number | string;
  max_attempts: number | string; before_snapshot_id: string | null; after_snapshot_id: string | null;
  changed_fields_json: unknown; error_code: string | null; idempotency_key: string; intent_sha256: string;
  created_at: unknown; updated_at: unknown; completed_at: unknown;
};

const secretOrPiiKey = /(?:token|secret|password|credential|authorization|cookie|email|phone|address|recipient|transcript|body|content|raw)/iu;
const secretOrPiiText = /(?:bearer\s+[a-z0-9._~-]+|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret|[\w.+-]+@[\w.-]+\.[a-z]{2,})/iu;
const quantitativeSources = new Set<EvidenceSourceType>(['survey_analysis', 'social_intelligence', 'event_aggregate']);

function iso(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  return Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : null;
}

function nowIso() { return new Date().toISOString(); }

function parseJson<T>(value: unknown, fallback: T): T {
  if (value && typeof value === 'object') return value as T;
  try { return value ? JSON.parse(String(value)) as T : fallback; }
  catch { return fallback; }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value as Record<string, unknown>)
    .sort().map((key) => [key, stableValue((value as Record<string, unknown>)[key])]));
  return value;
}

function sha(value: unknown) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function boundedText(value: unknown, maximum: number) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, maximum);
}

function sanitisedMetadata(value: Record<string, unknown>) {
  const output: Record<string, string | number | boolean | null> = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 30)) {
    const key = boundedText(rawKey, 80);
    if (!key || secretOrPiiKey.test(key)) continue;
    if (rawValue === null || typeof rawValue === 'boolean') output[key] = rawValue;
    else if (typeof rawValue === 'number' && Number.isFinite(rawValue)) output[key] = rawValue;
    else if (typeof rawValue === 'string' && !secretOrPiiText.test(rawValue)) output[key] = boundedText(rawValue, 300);
  }
  return output;
}

function assertResearch(spaceId: string) { assertSubscriptionFeature(spaceId, 'journeyEvidence'); }

function adapterName(sourceType: EvidenceSourceType) {
  return journeyEvidenceSourceAdapters.has(sourceType) ? `${sourceType}/v1` : 'unavailable/v1';
}

function sourceSummary(row: SourceRow) {
  return {
    id: row.id, sourceType: row.source_type, state: row.state, revision: Number(row.revision),
    ownerUserId: row.owner_user_id, lastResolvedAt: iso(row.last_resolved_at), errorCode: row.last_error_code,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at)
  };
}

function snapshotValue(row: SnapshotRow) {
  return {
    id: row.id, sourceId: row.source_id, version: Number(row.version_number), fingerprint: row.fingerprint,
    accessState: row.access_state, sourceLabel: row.source_label, excerpt: row.excerpt, population: row.population,
    sampleSize: row.sample_size === null ? null : Number(row.sample_size), collectedAt: iso(row.collected_at),
    windowStart: iso(row.window_start), windowEnd: iso(row.window_end), sourceUpdatedAt: iso(row.source_updated_at),
    metadata: sanitisedMetadata(parseJson<Record<string, unknown>>(row.metadata_json, {})),
    createdByUserId: row.created_by_user_id, createdAt: iso(row.created_at), retentionExpiresAt: iso(row.retention_expires_at)
  };
}

function snapshotForLifecycle(row: SnapshotRow): JourneyEvidenceSnapshot {
  return {
    sourceType: '', sourceRef: '', sourceLabel: row.source_label, excerpt: row.excerpt, population: row.population,
    sampleSize: row.sample_size === null ? null : Number(row.sample_size), collectedAt: iso(row.collected_at),
    windowStart: iso(row.window_start), windowEnd: iso(row.window_end), sourceUpdatedAt: iso(row.source_updated_at)
  };
}

function latestSnapshot(spaceId: string, sourceId: string) {
  return db.prepare(`SELECT * FROM journey_research_snapshots
    WHERE source_id=? AND space_id=? ORDER BY version_number DESC,id DESC LIMIT 1`).get(sourceId, spaceId) as SnapshotRow | undefined;
}

function getSourceRow(spaceId: string, sourceId: string) {
  const row = db.prepare('SELECT * FROM journey_research_sources WHERE id=? AND space_id=?')
    .get(sourceId, spaceId) as SourceRow | undefined;
  if (!row) throw new JourneyResearchError('Research source not found.', 404, 'JOURNEY_RESEARCH_SOURCE_NOT_FOUND');
  return row;
}

function exactSource(spaceId: string, userId: string, row: SourceRow) {
  // This call is deliberately made even when an immutable snapshot exists.
  // A deleted, private, cross-space or feature-disabled source must fail closed.
  return resolveJourneyEvidenceSource({ spaceId, userId, sourceType: row.source_type, sourceRef: row.source_ref });
}

function writeAudit(input: {
  spaceId: string; actorUserId?: string | null; action: string; targetType: string; targetId: string;
  detail?: Record<string, string | number | boolean | null | string[]>;
}) {
  const detail = Object.fromEntries(Object.entries(input.detail || {}).filter(([key, value]) =>
    !secretOrPiiKey.test(key) && !secretOrPiiText.test(String(value ?? ''))));
  db.prepare(`INSERT INTO journey_research_audit_events
    (id,space_id,actor_user_id,action,target_type,target_id,detail_json,created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(crypto.randomUUID(), input.spaceId, input.actorUserId || null, input.action,
      boundedText(input.targetType, 80), input.targetId, JSON.stringify(detail), nowIso());
}

function createSnapshot(input: {
  source: SourceRow; view: JourneyEvidenceSourceView; actorUserId: string | null; retentionDays?: number;
}) {
  const lifecycle = journeyEvidenceSnapshotFromSource({
    sourceType: input.view.sourceType, sourceRef: input.view.sourceRef, label: input.view.label,
    excerpt: input.view.excerpt, population: input.view.population, sampleSize: input.view.sampleSize,
    collectedAt: input.view.collectedAt, windowStart: input.view.windowStart, windowEnd: input.view.windowEnd,
    updatedAt: input.view.updatedAt
  });
  const fingerprint = journeyEvidenceSnapshotFingerprint(lifecycle);
  const existing = db.prepare(`SELECT * FROM journey_research_snapshots
    WHERE source_id=? AND fingerprint=?`).get(input.source.id, fingerprint) as SnapshotRow | undefined;
  if (existing) return { row: existing, created: false };
  const previous = latestSnapshot(input.source.space_id, input.source.id);
  const now = nowIso();
  const retentionDays = Math.max(1, Math.min(3650, Math.trunc(input.retentionDays || 365)));
  const expires = new Date(Date.parse(now) + retentionDays * 86_400_000).toISOString();
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO journey_research_snapshots
    (id,source_id,space_id,version_number,fingerprint,access_state,source_label,excerpt,population,sample_size,
      collected_at,window_start,window_end,source_updated_at,metadata_json,created_by_user_id,created_at,retention_expires_at)
    VALUES (?,?,?,?,?,'available',?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, input.source.id, input.source.space_id, Number(previous?.version_number || 0) + 1, fingerprint,
      lifecycle.sourceLabel, lifecycle.excerpt, lifecycle.population, lifecycle.sampleSize, lifecycle.collectedAt,
      lifecycle.windowStart, lifecycle.windowEnd, lifecycle.sourceUpdatedAt,
      JSON.stringify(sanitisedMetadata(input.view.metadata)), input.actorUserId, now, expires);
  const row = db.prepare('SELECT * FROM journey_research_snapshots WHERE id=? AND space_id=?')
    .get(id, input.source.space_id) as SnapshotRow;
  writeAudit({ spaceId: input.source.space_id, actorUserId: input.actorUserId, action: 'snapshot.created',
    targetType: 'research_snapshot', targetId: id, detail: { sourceId: input.source.id, version: Number(row.version_number) } });
  return { row, created: true };
}

export function catalogueJourneyResearchSource(input: {
  spaceId: string; userId: string; sourceType: EvidenceSourceType; sourceRef: string;
  idempotencyKey?: string | null; retentionDays?: number;
}) {
  assertResearch(input.spaceId);
  const key = input.idempotencyKey ? boundedText(input.idempotencyKey, 200) : null;
  if (input.idempotencyKey && !key) throw new JourneyResearchError(
    'An idempotency key cannot be empty.', 400, 'JOURNEY_RESEARCH_IDEMPOTENCY_KEY_INVALID');
  const adapter = journeyEvidenceSourceAdapters.get(input.sourceType);
  let requestedId = boundedText(input.sourceRef, 400);
  if (adapter) for (const prefix of adapter.prefixes) {
    if (requestedId.startsWith(prefix)) { requestedId = requestedId.slice(prefix.length); break; }
  }
  const requestedRef = adapter ? `${adapter.canonicalPrefix}${requestedId}` : requestedId;
  const requestedIntent = sha({ sourceType: input.sourceType, sourceRef: requestedRef });
  // Detect key/intent conflicts before resolving the newly requested source.
  // Otherwise a nonexistent conflicting reference would incorrectly mask a
  // durable idempotency conflict as a 404.
  if (key) {
    const replay = db.prepare('SELECT * FROM journey_research_sources WHERE space_id=? AND idempotency_key=?')
      .get(input.spaceId, key) as SourceRow | undefined;
    if (replay && replay.intent_sha256 !== requestedIntent) throw new JourneyResearchError(
      'This idempotency key was already used for another source.', 409, 'JOURNEY_RESEARCH_IDEMPOTENCY_CONFLICT');
    if (replay) {
      exactSource(input.spaceId, input.userId, replay);
      const snapshot = latestSnapshot(input.spaceId, replay.id);
      return { source: sourceSummary(replay), snapshot: snapshot ? snapshotValue(snapshot) : null,
        created: false, replayed: true };
    }
  }
  const view = resolveJourneyEvidenceSource(input);
  const intent = sha({ sourceType: view.sourceType, sourceRef: view.sourceRef });

  return db.transaction(() => {
    if (key) {
      const replay = db.prepare('SELECT * FROM journey_research_sources WHERE space_id=? AND idempotency_key=?')
        .get(input.spaceId, key) as SourceRow | undefined;
      if (replay && replay.intent_sha256 !== intent) throw new JourneyResearchError(
        'This idempotency key was already used for another source.', 409, 'JOURNEY_RESEARCH_IDEMPOTENCY_CONFLICT');
      if (replay) {
        exactSource(input.spaceId, input.userId, replay);
        const snapshot = latestSnapshot(input.spaceId, replay.id);
        return { source: sourceSummary(replay), snapshot: snapshot ? snapshotValue(snapshot) : null,
          created: false, replayed: true };
      }
    }
    let source = db.prepare(`SELECT * FROM journey_research_sources
      WHERE space_id=? AND source_type=? AND source_ref=?`).get(input.spaceId, view.sourceType, view.sourceRef) as SourceRow | undefined;
    let created = false;
    if (!source) {
      const now = nowIso(); const id = crypto.randomUUID();
      db.prepare(`INSERT INTO journey_research_sources
        (id,space_id,source_type,source_ref,adapter,owner_user_id,state,revision,last_resolved_at,last_error_code,
          idempotency_key,intent_sha256,created_at,updated_at)
        VALUES (?,?,?,?,?,?,'active',1,?,NULL,?,?,?,?)`)
        .run(id, input.spaceId, view.sourceType, view.sourceRef, adapterName(view.sourceType), input.userId,
          now, key, intent, now, now);
      source = db.prepare('SELECT * FROM journey_research_sources WHERE id=? AND space_id=?')
        .get(id, input.spaceId) as SourceRow;
      created = true;
      writeAudit({ spaceId: input.spaceId, actorUserId: input.userId, action: 'source.catalogued',
        targetType: 'research_source', targetId: id, detail: { sourceType: view.sourceType } });
    } else {
      db.prepare(`UPDATE journey_research_sources SET state='active',last_resolved_at=?,last_error_code=NULL,
        revision=revision+1,updated_at=? WHERE id=? AND space_id=?`)
        .run(nowIso(), nowIso(), source.id, input.spaceId);
      source = getSourceRow(input.spaceId, source.id);
    }
    const snapshot = createSnapshot({ source, view, actorUserId: input.userId, retentionDays: input.retentionDays });
    return { source: sourceSummary(source), snapshot: snapshotValue(snapshot.row), created, replayed: false };
  })();
}

type CatalogueCursor = { v: 1; typeIndex: number; offset: number };
function encodeCursor(value: CatalogueCursor) { return Buffer.from(JSON.stringify(value)).toString('base64url'); }
function decodeCursor(cursor?: string | null): CatalogueCursor {
  if (!cursor) return { v: 1, typeIndex: 0, offset: 0 };
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as CatalogueCursor;
    if (value.v !== 1 || !Number.isInteger(value.typeIndex) || !Number.isInteger(value.offset)
        || value.typeIndex < 0 || value.typeIndex > discoverableJourneyEvidenceSourceTypes.length || value.offset < 0) throw new Error();
    return value;
  } catch { throw new JourneyResearchError('Invalid catalogue cursor.', 400, 'JOURNEY_RESEARCH_CURSOR_INVALID'); }
}

function genericSourceLabel(sourceType: EvidenceSourceType) {
  return ({
    knowledge_document: 'Knowledge document', survey_response: 'Survey response', survey_analysis: 'Survey analysis',
    social_mention: 'Social mention', social_intelligence: 'Social intelligence report', ticket: 'Service recovery ticket',
    assistant_artifact: 'Assistant work product', agreement: 'Signed agreement', interview: 'Interview',
    observation: 'Observation', event_aggregate: 'Journey event aggregate'
  } satisfies Record<EvidenceSourceType, string>)[sourceType];
}

export function listJourneyResearchCatalogue(input: {
  spaceId: string; userId: string; query?: string; limit?: number; cursor?: string | null;
}) {
  assertResearch(input.spaceId);
  const limit = Math.max(1, Math.min(50, Math.trunc(input.limit || 25)));
  const cursor = decodeCursor(input.cursor);
  const items: Array<Record<string, unknown>> = [];
  let typeIndex = cursor.typeIndex;
  let offset = cursor.offset;
  let nextCursor: string | null = null;
  while (typeIndex < discoverableJourneyEvidenceSourceTypes.length && items.length < limit) {
    const sourceType = discoverableJourneyEvidenceSourceTypes[typeIndex] as DiscoverableJourneyEvidenceSourceType;
    const take = limit - items.length;
    let sources: JourneyEvidenceSourceView[] = [];
    try {
      sources = searchJourneyEvidenceSources({ spaceId: input.spaceId, userId: input.userId, sourceType,
        query: input.query, limit: Math.min(100, take + 1), offset });
    } catch (error) {
      // A disabled underlying source feature removes that source family from
      // this viewer's catalogue; it must not make other families unavailable.
      if (Number((error as { status?: number })?.status) !== 403) throw error;
    }
    const selected = sources.slice(0, take);
    for (const source of selected) {
      const oldLinks = Number((db.prepare(`SELECT COUNT(*) count FROM journey_evidence_links
        WHERE space_id=? AND source_type=? AND source_ref=?`).get(input.spaceId, source.sourceType, source.sourceRef) as any)?.count || 0);
      const catalogued = db.prepare(`SELECT id,state,revision FROM journey_research_sources
        WHERE space_id=? AND source_type=? AND source_ref=?`).get(input.spaceId, source.sourceType, source.sourceRef) as any;
      items.push({
        sourceType: source.sourceType, sourceRef: source.sourceRef, sourceId: source.sourceId,
        label: genericSourceLabel(source.sourceType), state: source.state, sampleSize: source.sampleSize,
        collectedAt: iso(source.collectedAt), updatedAt: iso(source.updatedAt), existingEvidenceLinkCount: oldLinks,
        researchSourceId: catalogued?.id || null, researchSourceState: catalogued?.state || null,
        researchSourceRevision: catalogued ? Number(catalogued.revision) : null
      });
    }
    if (sources.length > take) {
      nextCursor = encodeCursor({ v: 1, typeIndex, offset: offset + take });
      break;
    }
    typeIndex += 1; offset = 0;
    if (typeIndex < discoverableJourneyEvidenceSourceTypes.length) nextCursor = encodeCursor({ v: 1, typeIndex, offset: 0 });
  }
  if (typeIndex >= discoverableJourneyEvidenceSourceTypes.length) nextCursor = null;
  return { items, nextCursor };
}

export function getJourneyResearchSource(input: { spaceId: string; userId: string; sourceId: string }) {
  assertResearch(input.spaceId);
  const row = getSourceRow(input.spaceId, input.sourceId);
  const current = exactSource(input.spaceId, input.userId, row);
  const snapshot = latestSnapshot(input.spaceId, row.id);
  return { source: sourceSummary(row), current, latestSnapshot: snapshot ? snapshotValue(snapshot) : null };
}

export function getJourneyResearchSnapshot(input: { spaceId: string; userId: string; snapshotId: string }) {
  assertResearch(input.spaceId);
  const row = db.prepare(`SELECT snapshot.*,source.source_type,source.source_ref,source.state source_state
    FROM journey_research_snapshots snapshot JOIN journey_research_sources source
      ON source.id=snapshot.source_id AND source.space_id=snapshot.space_id
    WHERE snapshot.id=? AND snapshot.space_id=?`).get(input.snapshotId, input.spaceId) as (SnapshotRow & SourceRow) | undefined;
  if (!row || (iso(row.retention_expires_at) && Date.parse(iso(row.retention_expires_at)!) <= Date.now())) {
    throw new JourneyResearchError('Research snapshot not found.', 404, 'JOURNEY_RESEARCH_SNAPSHOT_NOT_FOUND');
  }
  exactSource(input.spaceId, input.userId, row);
  return snapshotValue(row);
}

export function assertJourneyResearchTarget(input: {
  spaceId: string; targetType: JourneyResearchTargetType; targetId: string; requireEditable?: boolean;
}) {
  const { spaceId, targetType, targetId } = input;
  if (targetType === 'definition') {
    const row = db.prepare('SELECT id FROM journey_definitions WHERE id=? AND space_id=?').get(targetId, spaceId);
    if (!row) throw new JourneyResearchError('Research target not found.', 404, 'JOURNEY_RESEARCH_TARGET_NOT_FOUND');
    return { state: 'shared' as const };
  }
  if (targetType === 'persona') {
    const row = db.prepare('SELECT id FROM journey_personas WHERE id=? AND space_id=?').get(targetId, spaceId);
    if (!row) throw new JourneyResearchError('Research target not found.', 404, 'JOURNEY_RESEARCH_TARGET_NOT_FOUND');
    return { state: 'shared' as const };
  }
  const table = targetType === 'stage' ? 'journey_map_stages' : 'journey_map_cards';
  const row = db.prepare(`SELECT version.state FROM ${table} target
    JOIN journey_map_versions version ON version.id=target.version_id AND version.space_id=target.space_id
    WHERE target.id=? AND target.space_id=?`).get(targetId, spaceId) as { state: 'draft' | 'published' | 'superseded' } | undefined;
  if (!row) throw new JourneyResearchError('Research target not found.', 404, 'JOURNEY_RESEARCH_TARGET_NOT_FOUND');
  if (input.requireEditable && row.state !== 'draft') throw new JourneyResearchError(
    'Published and superseded journey targets are immutable. Use the current draft.', 409,
    'JOURNEY_RESEARCH_TARGET_IMMUTABLE');
  return row;
}

function linkSummary(row: LinkRow, assessment?: AssessmentRow | null, snapshot?: SnapshotRow | null) {
  const baseDate = iso(snapshot?.source_updated_at) || iso(snapshot?.collected_at) || iso(snapshot?.created_at);
  const freshness = assessment?.freshness_days === null || assessment?.freshness_days === undefined
    ? null : Number(assessment.freshness_days);
  return {
    id: row.id, sourceId: row.source_id, snapshotId: row.snapshot_id, targetType: row.target_type,
    targetId: row.target_id, state: row.state, revision: Number(row.revision),
    relationship: assessment?.relationship || null, classification: assessment?.classification || null,
    confidence: assessment ? Number(assessment.confidence) : null, freshnessDays: freshness,
    isContradictory: assessment?.relationship === 'contradicts' || assessment?.classification === 'contradicted',
    isStale: Boolean(baseDate && freshness && Date.now() > Date.parse(baseDate) + freshness * 86_400_000),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at)
  };
}

function getLinkRow(spaceId: string, linkId: string) {
  const row = db.prepare('SELECT * FROM journey_research_links WHERE id=? AND space_id=?').get(linkId, spaceId) as LinkRow | undefined;
  if (!row) throw new JourneyResearchError('Research link not found.', 404, 'JOURNEY_RESEARCH_LINK_NOT_FOUND');
  return row;
}

function latestAssessment(spaceId: string, linkId: string) {
  return db.prepare(`SELECT * FROM journey_research_assessments WHERE link_id=? AND space_id=?
    ORDER BY revision DESC,id DESC LIMIT 1`).get(linkId, spaceId) as AssessmentRow | undefined;
}

export function createJourneyResearchLink(input: {
  spaceId: string; userId: string; sourceId: string; targetType: JourneyResearchTargetType; targetId: string;
  idempotencyKey?: string | null;
}) {
  assertResearch(input.spaceId);
  assertJourneyResearchTarget({ ...input, requireEditable: true });
  const source = getSourceRow(input.spaceId, input.sourceId);
  exactSource(input.spaceId, input.userId, source);
  const snapshot = latestSnapshot(input.spaceId, source.id);
  if (!snapshot) throw new JourneyResearchError('Catalogue this source before linking it.', 409, 'JOURNEY_RESEARCH_SNAPSHOT_REQUIRED');
  const key = input.idempotencyKey ? boundedText(input.idempotencyKey, 200) : null;
  const intent = sha({ sourceId: source.id, snapshotId: snapshot.id, targetType: input.targetType, targetId: input.targetId });
  return db.transaction(() => {
    if (key) {
      const replay = db.prepare('SELECT * FROM journey_research_links WHERE space_id=? AND idempotency_key=?')
        .get(input.spaceId, key) as LinkRow | undefined;
      if (replay && replay.intent_sha256 !== intent) throw new JourneyResearchError(
        'This idempotency key was already used for another link.', 409, 'JOURNEY_RESEARCH_IDEMPOTENCY_CONFLICT');
      if (replay) return { link: linkSummary(replay, latestAssessment(input.spaceId, replay.id), snapshot), replayed: true };
    }
    const active = db.prepare(`SELECT * FROM journey_research_links
      WHERE space_id=? AND target_type=? AND target_id=? AND source_id=? AND state='active'`)
      .get(input.spaceId, input.targetType, input.targetId, source.id) as LinkRow | undefined;
    if (active) return { link: linkSummary(active, latestAssessment(input.spaceId, active.id), snapshot), replayed: true };
    const now = nowIso(); const id = crypto.randomUUID();
    db.prepare(`INSERT INTO journey_research_links
      (id,space_id,source_id,snapshot_id,target_type,target_id,state,revision,idempotency_key,intent_sha256,
        created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,'active',1,?,?,?,?,?)`)
      .run(id, input.spaceId, source.id, snapshot.id, input.targetType, input.targetId, key, intent, input.userId, now, now);
    const row = getLinkRow(input.spaceId, id);
    writeAudit({ spaceId: input.spaceId, actorUserId: input.userId, action: 'link.created',
      targetType: 'research_link', targetId: id, detail: { targetType: input.targetType, sourceId: source.id } });
    return { link: linkSummary(row, null, snapshot), replayed: false };
  })();
}

export function listJourneyResearchLinks(input: {
  spaceId: string; userId: string; targetType?: JourneyResearchTargetType; targetId?: string; limit?: number; offset?: number;
}) {
  assertResearch(input.spaceId);
  if (input.targetType && input.targetId) assertJourneyResearchTarget({
    spaceId: input.spaceId, targetType: input.targetType, targetId: input.targetId
  });
  const limit = Math.max(1, Math.min(100, Math.trunc(input.limit || 50)));
  const offset = Math.max(0, Math.min(1_000_000, Math.trunc(input.offset || 0)));
  const where = input.targetType && input.targetId ? ' AND link.target_type=? AND link.target_id=?' : '';
  const parameters = input.targetType && input.targetId
    ? [input.spaceId, input.targetType, input.targetId, limit, offset] : [input.spaceId, limit, offset];
  const rows = db.prepare(`SELECT link.* FROM journey_research_links link
    WHERE link.space_id=?${where} ORDER BY link.updated_at DESC,link.id DESC LIMIT ? OFFSET ?`).all(...parameters) as LinkRow[];
  return rows.map((row) => {
    const source = getSourceRow(input.spaceId, row.source_id);
    const lifecycle = resolveJourneyEvidenceLifecycle({
      spaceId: input.spaceId, userId: input.userId, sourceType: source.source_type, sourceRef: source.source_ref
    });
    if (lifecycle.kind === 'inaccessible') return {
      id: row.id, sourceId: row.source_id, snapshotId: null, targetType: row.target_type, targetId: row.target_id,
      state: row.state, revision: Number(row.revision), access: 'inaccessible' as const,
      relationship: null, classification: null, confidence: null, freshnessDays: null,
      isContradictory: null, isStale: null, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at)
    };
    return { ...linkSummary(row, latestAssessment(input.spaceId, row.id), latestSnapshot(input.spaceId, row.source_id)),
      access: 'available' as const };
  });
}

export function getJourneyResearchLink(input: { spaceId: string; userId: string; linkId: string }) {
  assertResearch(input.spaceId);
  const link = getLinkRow(input.spaceId, input.linkId);
  assertJourneyResearchTarget({ spaceId: input.spaceId, targetType: link.target_type, targetId: link.target_id });
  const source = getSourceRow(input.spaceId, link.source_id);
  const current = exactSource(input.spaceId, input.userId, source);
  const snapshot = db.prepare('SELECT * FROM journey_research_snapshots WHERE id=? AND source_id=? AND space_id=?')
    .get(link.snapshot_id, source.id, input.spaceId) as SnapshotRow | undefined;
  if (!snapshot || (iso(snapshot.retention_expires_at) && Date.parse(iso(snapshot.retention_expires_at)!) <= Date.now())) {
    throw new JourneyResearchError('The pinned research snapshot has expired.', 410, 'JOURNEY_RESEARCH_SNAPSHOT_EXPIRED');
  }
  const assessment = latestAssessment(input.spaceId, link.id);
  return {
    link: linkSummary(link, assessment, snapshot), source: sourceSummary(source), current,
    snapshot: snapshotValue(snapshot), assessment: assessment ? {
      id: assessment.id, revision: Number(assessment.revision), relationship: assessment.relationship,
      classification: assessment.classification, confidence: Number(assessment.confidence),
      freshnessDays: assessment.freshness_days === null ? null : Number(assessment.freshness_days),
      reason: assessment.reason_summary, method: assessment.method, reviewerUserId: assessment.reviewer_user_id,
      createdAt: iso(assessment.created_at)
    } : null
  };
}

export function applyLatestJourneyResearchSnapshot(input: {
  spaceId: string; userId: string; linkId: string; expectedRevision: number;
}) {
  assertResearch(input.spaceId);
  const link = getLinkRow(input.spaceId, input.linkId);
  assertJourneyResearchTarget({ spaceId: input.spaceId, targetType: link.target_type, targetId: link.target_id, requireEditable: true });
  const source = getSourceRow(input.spaceId, link.source_id);
  exactSource(input.spaceId, input.userId, source);
  const snapshot = latestSnapshot(input.spaceId, source.id);
  if (!snapshot) throw new JourneyResearchError('Research snapshot not found.', 404, 'JOURNEY_RESEARCH_SNAPSHOT_NOT_FOUND');
  if (Number(link.revision) !== input.expectedRevision) throw new JourneyResearchError(
    'The research link changed before this snapshot was applied.', 409, 'JOURNEY_RESEARCH_REVISION_CONFLICT');
  if (snapshot.id === link.snapshot_id) return linkSummary(link, latestAssessment(input.spaceId, link.id), snapshot);
  const changed = db.prepare(`UPDATE journey_research_links SET snapshot_id=?,revision=revision+1,updated_at=?
    WHERE id=? AND space_id=? AND revision=?`).run(snapshot.id, nowIso(), link.id, input.spaceId, input.expectedRevision).changes;
  if (!changed) throw new JourneyResearchError('The research link changed before this snapshot was applied.', 409,
    'JOURNEY_RESEARCH_REVISION_CONFLICT');
  const updated = getLinkRow(input.spaceId, link.id);
  writeAudit({ spaceId: input.spaceId, actorUserId: input.userId, action: 'link.snapshot_applied',
    targetType: 'research_link', targetId: link.id, detail: { snapshotId: snapshot.id, revision: Number(updated.revision) } });
  return linkSummary(updated, latestAssessment(input.spaceId, link.id), snapshot);
}

export function createJourneyResearchAssessment(input: {
  spaceId: string; userId: string; linkId: string; expectedRevision: number;
  relationship: 'supports' | 'contradicts' | 'neutral';
  classification: AssessmentRow['classification']; confidence: number; freshnessDays?: number | null;
  reason?: string; method?: 'human_review' | 'imported_review';
}) {
  assertResearch(input.spaceId);
  const reason = boundedText(input.reason, 4096);
  if (reason && secretOrPiiText.test(reason)) throw new JourneyResearchError(
    'Assessment notes cannot contain credentials or direct personal identifiers.', 400,
    'JOURNEY_RESEARCH_ASSESSMENT_CONTENT_FORBIDDEN');
  if (['contradicted', 'stale', 'invalidated', 'strongly_supported'].includes(input.classification) && !reason) {
    throw new JourneyResearchError('This classification requires a reviewer rationale.', 400,
      'JOURNEY_RESEARCH_ASSESSMENT_REASON_REQUIRED');
  }
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) throw new JourneyResearchError(
    'Assessment confidence must be between zero and one.', 400, 'JOURNEY_RESEARCH_CONFIDENCE_INVALID');
  const link = getLinkRow(input.spaceId, input.linkId);
  assertJourneyResearchTarget({ spaceId: input.spaceId, targetType: link.target_type, targetId: link.target_id, requireEditable: true });
  if (Number(link.revision) !== input.expectedRevision) throw new JourneyResearchError(
    'The research link changed before this assessment was saved.', 409, 'JOURNEY_RESEARCH_REVISION_CONFLICT');
  const source = getSourceRow(input.spaceId, link.source_id);
  exactSource(input.spaceId, input.userId, source);
  if (input.classification === 'strongly_supported') {
    const linked = db.prepare(`SELECT DISTINCT source.source_type FROM journey_research_links target_link
      JOIN journey_research_sources source ON source.id=target_link.source_id AND source.space_id=target_link.space_id
      WHERE target_link.space_id=? AND target_link.target_type=? AND target_link.target_id=? AND target_link.state='active'`)
      .all(input.spaceId, link.target_type, link.target_id) as Array<{ source_type: EvidenceSourceType }>;
    const hasQuantitative = linked.some((row) => quantitativeSources.has(row.source_type));
    const hasQualitative = linked.some((row) => !quantitativeSources.has(row.source_type));
    if (linked.length < 2 || !hasQuantitative || !hasQualitative) throw new JourneyResearchError(
      'Strong support requires at least one quantitative and one qualitative source.', 409,
      'JOURNEY_RESEARCH_TRIANGULATION_REQUIRED');
  }
  return db.transaction(() => {
    const revision = Number((db.prepare(`SELECT COALESCE(MAX(revision),0) revision FROM journey_research_assessments
      WHERE link_id=? AND space_id=?`).get(link.id, input.spaceId) as any)?.revision || 0) + 1;
    const id = crypto.randomUUID(); const now = nowIso();
    db.prepare(`INSERT INTO journey_research_assessments
      (id,link_id,space_id,revision,relationship,classification,confidence,freshness_days,reason_summary,reason_sha256,
        reviewer_user_id,method,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, link.id, input.spaceId, revision, input.relationship, input.classification, input.confidence,
        input.freshnessDays ?? null, reason, sha(reason), input.userId, input.method || 'human_review', now);
    const changed = db.prepare(`UPDATE journey_research_links SET revision=revision+1,updated_at=?
      WHERE id=? AND space_id=? AND revision=?`).run(now, link.id, input.spaceId, input.expectedRevision).changes;
    if (!changed) throw new JourneyResearchError('The research link changed before this assessment was saved.', 409,
      'JOURNEY_RESEARCH_REVISION_CONFLICT');
    writeAudit({ spaceId: input.spaceId, actorUserId: input.userId, action: 'assessment.created',
      targetType: 'research_link', targetId: link.id,
      detail: { relationship: input.relationship, classification: input.classification, revision } });
    return getJourneyResearchLink({ spaceId: input.spaceId, userId: input.userId, linkId: link.id });
  })();
}

function gapSummary(row: GapRow) {
  return {
    id: row.id, label: 'Research gap', targetType: row.target_type, targetId: row.target_id,
    priority: row.priority, status: row.status, ownerUserId: row.owner_user_id,
    resolutionLinkId: row.resolution_link_id, revision: Number(row.revision), dueAt: iso(row.due_at),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at)
  };
}

function getGapRow(spaceId: string, gapId: string) {
  const row = db.prepare('SELECT * FROM journey_research_gaps WHERE id=? AND space_id=?').get(gapId, spaceId) as GapRow | undefined;
  if (!row) throw new JourneyResearchError('Research gap not found.', 404, 'JOURNEY_RESEARCH_GAP_NOT_FOUND');
  return row;
}

function assertSpaceMember(spaceId: string, userId: string | null) {
  if (!userId) return;
  if (!db.prepare('SELECT 1 FROM space_memberships WHERE space_id=? AND user_id=?').get(spaceId, userId)) {
    throw new JourneyResearchError('The selected owner is not a member of this space.', 400,
      'JOURNEY_RESEARCH_OWNER_NOT_MEMBER');
  }
}

export function createJourneyResearchGap(input: {
  spaceId: string; userId: string; targetType: JourneyResearchTargetType; targetId: string;
  title: string; description?: string; priority?: GapRow['priority']; ownerUserId?: string | null;
  dueAt?: string | null; idempotencyKey?: string | null;
}) {
  assertResearch(input.spaceId);
  assertJourneyResearchTarget(input);
  assertSpaceMember(input.spaceId, input.ownerUserId || null);
  const title = boundedText(input.title, 800);
  const description = boundedText(input.description, 8192);
  if (!title) throw new JourneyResearchError('A research gap needs a title.', 400, 'JOURNEY_RESEARCH_GAP_TITLE_REQUIRED');
  const key = input.idempotencyKey ? boundedText(input.idempotencyKey, 200) : null;
  const intent = sha({ targetType: input.targetType, targetId: input.targetId, title, description,
    priority: input.priority || 'medium', ownerUserId: input.ownerUserId || null, dueAt: input.dueAt || null });
  if (key) {
    const replay = db.prepare('SELECT * FROM journey_research_gaps WHERE space_id=? AND idempotency_key=?')
      .get(input.spaceId, key) as GapRow | undefined;
    if (replay && replay.intent_sha256 !== intent) throw new JourneyResearchError(
      'This idempotency key was already used for another research gap.', 409, 'JOURNEY_RESEARCH_IDEMPOTENCY_CONFLICT');
    if (replay) return { gap: gapSummary(replay), replayed: true };
  }
  const id = crypto.randomUUID(); const now = nowIso();
  db.prepare(`INSERT INTO journey_research_gaps
    (id,space_id,target_type,target_id,title,description,priority,status,owner_user_id,resolution_link_id,
      revision,idempotency_key,intent_sha256,due_at,created_by_user_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,'open',?,NULL,1,?,?,?,?,?,?)`)
    .run(id, input.spaceId, input.targetType, input.targetId, title, description, input.priority || 'medium',
      input.ownerUserId || null, key, intent, input.dueAt || null, input.userId, now, now);
  const row = getGapRow(input.spaceId, id);
  writeAudit({ spaceId: input.spaceId, actorUserId: input.userId, action: 'gap.created',
    targetType: 'research_gap', targetId: id,
    detail: { targetType: input.targetType, priority: row.priority, hasDescription: Boolean(description) } });
  return { gap: gapSummary(row), replayed: false };
}

export function listJourneyResearchGaps(input: {
  spaceId: string; status?: GapRow['status']; limit?: number; offset?: number;
}) {
  assertResearch(input.spaceId);
  const limit = Math.max(1, Math.min(100, Math.trunc(input.limit || 50)));
  const offset = Math.max(0, Math.min(1_000_000, Math.trunc(input.offset || 0)));
  const rows = input.status
    ? db.prepare(`SELECT * FROM journey_research_gaps WHERE space_id=? AND status=?
        ORDER BY updated_at DESC,id DESC LIMIT ? OFFSET ?`).all(input.spaceId, input.status, limit, offset) as GapRow[]
    : db.prepare(`SELECT * FROM journey_research_gaps WHERE space_id=?
        ORDER BY updated_at DESC,id DESC LIMIT ? OFFSET ?`).all(input.spaceId, limit, offset) as GapRow[];
  return rows.map(gapSummary);
}

export function getJourneyResearchGap(input: { spaceId: string; gapId: string }) {
  assertResearch(input.spaceId);
  const row = getGapRow(input.spaceId, input.gapId);
  assertJourneyResearchTarget({ spaceId: input.spaceId, targetType: row.target_type, targetId: row.target_id });
  return { ...gapSummary(row), title: row.title, description: row.description };
}

export function updateJourneyResearchGap(input: {
  spaceId: string; userId: string; gapId: string; expectedRevision: number;
  status?: GapRow['status']; priority?: GapRow['priority']; ownerUserId?: string | null;
  resolutionLinkId?: string | null; dueAt?: string | null;
}) {
  assertResearch(input.spaceId);
  const row = getGapRow(input.spaceId, input.gapId);
  assertJourneyResearchTarget({ spaceId: input.spaceId, targetType: row.target_type, targetId: row.target_id });
  if (Number(row.revision) !== input.expectedRevision) throw new JourneyResearchError(
    'The research gap changed before this update.', 409, 'JOURNEY_RESEARCH_REVISION_CONFLICT');
  if (input.ownerUserId !== undefined) assertSpaceMember(input.spaceId, input.ownerUserId);
  if (input.resolutionLinkId) {
    const link = getLinkRow(input.spaceId, input.resolutionLinkId);
    if (link.target_type !== row.target_type || link.target_id !== row.target_id) throw new JourneyResearchError(
      'A resolution link must belong to the same research target.', 400, 'JOURNEY_RESEARCH_GAP_LINK_MISMATCH');
  }
  const nextStatus = input.status || row.status;
  const nextResolution = input.resolutionLinkId === undefined ? row.resolution_link_id : input.resolutionLinkId;
  if (nextStatus === 'resolved' && !nextResolution) throw new JourneyResearchError(
    'A resolved research gap needs a supporting link.', 400, 'JOURNEY_RESEARCH_GAP_RESOLUTION_REQUIRED');
  const changed = db.prepare(`UPDATE journey_research_gaps SET status=?,priority=?,owner_user_id=?,resolution_link_id=?,
    due_at=?,revision=revision+1,updated_at=? WHERE id=? AND space_id=? AND revision=?`)
    .run(nextStatus, input.priority || row.priority,
      input.ownerUserId === undefined ? row.owner_user_id : input.ownerUserId,
      nextResolution, input.dueAt === undefined ? iso(row.due_at) : input.dueAt,
      nowIso(), row.id, input.spaceId, input.expectedRevision).changes;
  if (!changed) throw new JourneyResearchError('The research gap changed before this update.', 409,
    'JOURNEY_RESEARCH_REVISION_CONFLICT');
  const updated = getGapRow(input.spaceId, row.id);
  writeAudit({ spaceId: input.spaceId, actorUserId: input.userId, action: 'gap.updated',
    targetType: 'research_gap', targetId: row.id,
    detail: { status: updated.status, priority: updated.priority, revision: Number(updated.revision) } });
  return gapSummary(updated);
}

type IntakeRow = {
  id: string; space_id: string; source_id: string; knowledge_base_id: string; knowledge_document_id: string;
  intake_kind: 'interview' | 'observation' | 'research_note'; method: string; conducted_at: unknown;
  population: string; tags_json: unknown; consent_basis: 'documented' | 'not_required';
  researcher_user_id: string | null; retention_expires_at: unknown; idempotency_key: string;
  intent_sha256: string; created_at: unknown;
};

function intakeSummary(row: IntakeRow) {
  return {
    id: row.id, sourceId: row.source_id, knowledgeBaseId: row.knowledge_base_id,
    knowledgeDocumentId: row.knowledge_document_id, kind: row.intake_kind, method: row.method,
    conductedAt: iso(row.conducted_at), population: row.population,
    tags: parseJson<string[]>(row.tags_json, []).map((tag) => boundedText(tag, 80)).slice(0, 20),
    consentBasis: row.consent_basis, researcherUserId: row.researcher_user_id,
    retentionExpiresAt: iso(row.retention_expires_at), createdAt: iso(row.created_at)
  };
}

export function createJourneyResearchIntake(input: {
  spaceId: string; userId: string; knowledgeBaseId: string;
  kind: IntakeRow['intake_kind']; method: string; markdown: string; conductedAt?: string | null;
  population?: string; tags?: string[]; consentBasis: IntakeRow['consent_basis'];
  retentionExpiresAt: string; idempotencyKey: string;
  /** Synchronous recovery hooks used by crash-boundary probes. */
  afterKnowledgeDocumentCreated?: () => void;
  beforeIntakeCommit?: () => void;
}) {
  assertResearch(input.spaceId);
  assertSubscriptionFeature(input.spaceId, 'knowledgeBases');
  const knowledgeBase = getKnowledgeBase(input.knowledgeBaseId, input.spaceId, false, input.userId);
  if (!knowledgeBase) throw new JourneyResearchError('Knowledge base not found or not available.', 404,
    'JOURNEY_RESEARCH_KNOWLEDGE_BASE_NOT_FOUND');
  const method = boundedText(input.method, 120);
  const markdown = String(input.markdown || '').trim();
  const key = boundedText(input.idempotencyKey, 200);
  const tags = [...new Set((input.tags || []).map((tag) => boundedText(tag, 80)).filter(Boolean))].slice(0, 20);
  const population = boundedText(input.population, 800);
  if (!method || !markdown || !key) throw new JourneyResearchError(
    'Method, notes and an idempotency key are required.', 400, 'JOURNEY_RESEARCH_INTAKE_INPUT_REQUIRED');
  if (Buffer.byteLength(markdown, 'utf8') > 1_000_000) throw new JourneyResearchError(
    'Research notes exceed the one MiB intake limit.', 413, 'JOURNEY_RESEARCH_INTAKE_TOO_LARGE');
  const retention = iso(input.retentionExpiresAt);
  if (!retention || Date.parse(retention) <= Date.now() || Date.parse(retention) > Date.now() + 10 * 366 * 86_400_000) {
    throw new JourneyResearchError('Retention must be a future date no more than ten years away.', 400,
      'JOURNEY_RESEARCH_RETENTION_INVALID');
  }
  const intent = sha({ knowledgeBaseId: knowledgeBase.id, kind: input.kind, method, markdownSha256: sha(markdown),
    conductedAt: input.conductedAt || null, population, tags, consentBasis: input.consentBasis, retention });
  const replay = db.prepare('SELECT * FROM journey_research_intakes WHERE space_id=? AND idempotency_key=?')
    .get(input.spaceId, key) as IntakeRow | undefined;
  if (replay && replay.intent_sha256 !== intent) throw new JourneyResearchError(
    'This idempotency key was already used for another research intake.', 409, 'JOURNEY_RESEARCH_IDEMPOTENCY_CONFLICT');
  if (replay) return { intake: intakeSummary(replay), replayed: true };

  // Research Hub stores only the resulting references and structured intake
  // metadata. The actual notes enter the existing governed knowledge pipeline.
  const created = createKnowledgeMarkdownDocument({
    spaceId: input.spaceId, knowledgeBaseId: knowledgeBase.id, userId: input.userId,
    originalName: `${input.kind.replace('_', '-')}-${new Date().toISOString().slice(0, 10)}.md`, markdown,
    metadata: { source: 'journey_research_hub', intakeKind: input.kind, method, conductedAt: input.conductedAt || null,
      population, tags, consentBasis: input.consentBasis, retentionExpiresAt: retention },
    idempotencyKey: `journey-research:${sha({ spaceId: input.spaceId, knowledgeBaseId: knowledgeBase.id, key }).slice(0, 48)}`
  });
  input.afterKnowledgeDocumentCreated?.();
  const catalogued = catalogueJourneyResearchSource({
    spaceId: input.spaceId, userId: input.userId, sourceType: 'knowledge_document',
    sourceRef: `knowledge-document:${created.document.id}`, idempotencyKey: `intake-source:${key}`,
    retentionDays: Math.max(1, Math.ceil((Date.parse(retention) - Date.now()) / 86_400_000))
  });
  input.beforeIntakeCommit?.();
  try {
    const id = crypto.randomUUID(); const now = nowIso();
    db.prepare(`INSERT INTO journey_research_intakes
      (id,space_id,source_id,knowledge_base_id,knowledge_document_id,intake_kind,method,conducted_at,population,
        tags_json,consent_basis,researcher_user_id,retention_expires_at,idempotency_key,intent_sha256,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, input.spaceId, catalogued.source.id, knowledgeBase.id, created.document.id, input.kind, method,
        input.conductedAt || null, population, JSON.stringify(tags), input.consentBasis, input.userId,
        retention, key, intent, now);
    const row = db.prepare('SELECT * FROM journey_research_intakes WHERE id=? AND space_id=?')
      .get(id, input.spaceId) as IntakeRow;
    writeAudit({ spaceId: input.spaceId, actorUserId: input.userId, action: 'intake.created',
      targetType: 'research_intake', targetId: id,
      detail: { kind: input.kind, sourceId: catalogued.source.id, knowledgeBaseId: knowledgeBase.id } });
    return { intake: intakeSummary(row), replayed: false };
  } catch (error) {
    if (!isDatabaseConstraintError(error)) throw error;
    const concurrent = db.prepare('SELECT * FROM journey_research_intakes WHERE space_id=? AND idempotency_key=?')
      .get(input.spaceId, key) as IntakeRow | undefined;
    if (concurrent?.intent_sha256 === intent) return { intake: intakeSummary(concurrent), replayed: true };
    throw error;
  }
}

export function listJourneyResearchIntakes(input: { spaceId: string; limit?: number; offset?: number }) {
  assertResearch(input.spaceId);
  const limit = Math.max(1, Math.min(100, Math.trunc(input.limit || 50)));
  const offset = Math.max(0, Math.min(1_000_000, Math.trunc(input.offset || 0)));
  return (db.prepare(`SELECT * FROM journey_research_intakes WHERE space_id=?
    ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).all(input.spaceId, limit, offset) as IntakeRow[]).map(intakeSummary);
}

function monitorSummary(row: MonitorRow) {
  return {
    id: row.id, sourceId: row.source_id, ownerUserId: row.owner_user_id, state: row.state,
    intervalSeconds: Number(row.interval_seconds), nextRunAt: iso(row.next_run_at), lastRunAt: iso(row.last_run_at),
    revision: Number(row.revision), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at)
  };
}

function getMonitorRow(spaceId: string, monitorId: string) {
  const row = db.prepare('SELECT * FROM journey_research_monitors WHERE id=? AND space_id=?')
    .get(monitorId, spaceId) as MonitorRow | undefined;
  if (!row) throw new JourneyResearchError('Research monitor not found.', 404, 'JOURNEY_RESEARCH_MONITOR_NOT_FOUND');
  return row;
}

export function createJourneyResearchMonitor(input: {
  spaceId: string; userId: string; sourceId: string; intervalSeconds: number; idempotencyKey?: string | null;
}) {
  assertResearch(input.spaceId);
  const source = getSourceRow(input.spaceId, input.sourceId);
  exactSource(input.spaceId, input.userId, source);
  const interval = Math.max(300, Math.min(2_592_000, Math.trunc(input.intervalSeconds)));
  const key = input.idempotencyKey ? boundedText(input.idempotencyKey, 200) : null;
  const intent = sha({ sourceId: source.id, ownerUserId: input.userId, interval });
  if (key) {
    const replay = db.prepare('SELECT * FROM journey_research_monitors WHERE space_id=? AND idempotency_key=?')
      .get(input.spaceId, key) as MonitorRow | undefined;
    if (replay && replay.intent_sha256 !== intent) throw new JourneyResearchError(
      'This idempotency key was already used for another monitor.', 409, 'JOURNEY_RESEARCH_IDEMPOTENCY_CONFLICT');
    if (replay) return { monitor: monitorSummary(replay), replayed: true };
  }
  const existing = db.prepare(`SELECT * FROM journey_research_monitors
    WHERE space_id=? AND source_id=? AND owner_user_id=?`).get(input.spaceId, source.id, input.userId) as MonitorRow | undefined;
  if (existing) return { monitor: monitorSummary(existing), replayed: true };
  const id = crypto.randomUUID(); const now = nowIso();
  db.prepare(`INSERT INTO journey_research_monitors
    (id,space_id,source_id,owner_user_id,state,interval_seconds,next_run_at,last_run_at,revision,idempotency_key,
      intent_sha256,created_at,updated_at) VALUES (?,?,?,?,'active',?,?,NULL,1,?,?,?,?)`)
    .run(id, input.spaceId, source.id, input.userId, interval,
      new Date(Date.parse(now) + interval * 1000).toISOString(), key, intent, now, now);
  const row = getMonitorRow(input.spaceId, id);
  writeAudit({ spaceId: input.spaceId, actorUserId: input.userId, action: 'monitor.created',
    targetType: 'research_monitor', targetId: id, detail: { sourceId: source.id, intervalSeconds: interval } });
  return { monitor: monitorSummary(row), replayed: false };
}

export function updateJourneyResearchMonitor(input: {
  spaceId: string; userId: string; monitorId: string; expectedRevision: number;
  state?: 'active' | 'paused'; intervalSeconds?: number;
}) {
  assertResearch(input.spaceId);
  const row = getMonitorRow(input.spaceId, input.monitorId);
  if (Number(row.revision) !== input.expectedRevision) throw new JourneyResearchError(
    'The research monitor changed before this update.', 409, 'JOURNEY_RESEARCH_REVISION_CONFLICT');
  const interval = input.intervalSeconds === undefined ? Number(row.interval_seconds)
    : Math.max(300, Math.min(2_592_000, Math.trunc(input.intervalSeconds)));
  const now = nowIso();
  const nextRun = input.state === 'paused' ? iso(row.next_run_at)
    : new Date(Date.parse(now) + interval * 1000).toISOString();
  const changed = db.prepare(`UPDATE journey_research_monitors SET state=?,interval_seconds=?,next_run_at=?,
    revision=revision+1,updated_at=? WHERE id=? AND space_id=? AND revision=?`)
    .run(input.state || row.state, interval, nextRun, now, row.id, input.spaceId, input.expectedRevision).changes;
  if (!changed) throw new JourneyResearchError('The research monitor changed before this update.', 409,
    'JOURNEY_RESEARCH_REVISION_CONFLICT');
  const updated = getMonitorRow(input.spaceId, row.id);
  writeAudit({ spaceId: input.spaceId, actorUserId: input.userId, action: 'monitor.updated',
    targetType: 'research_monitor', targetId: row.id,
    detail: { state: updated.state, intervalSeconds: Number(updated.interval_seconds), revision: Number(updated.revision) } });
  return monitorSummary(updated);
}

export function listJourneyResearchMonitors(input: { spaceId: string; limit?: number; offset?: number }) {
  assertResearch(input.spaceId);
  const limit = Math.max(1, Math.min(100, Math.trunc(input.limit || 50)));
  const offset = Math.max(0, Math.min(1_000_000, Math.trunc(input.offset || 0)));
  return (db.prepare(`SELECT * FROM journey_research_monitors WHERE space_id=?
    ORDER BY updated_at DESC,id DESC LIMIT ? OFFSET ?`).all(input.spaceId, limit, offset) as MonitorRow[]).map(monitorSummary);
}

function runSummary(row: RefreshRunRow) {
  return {
    id: row.id, sourceId: row.source_id, monitorId: row.monitor_id, trigger: row.trigger_kind, state: row.state,
    revision: Number(row.revision), availableAt: iso(row.available_at), attemptCount: Number(row.attempt_count),
    maxAttempts: Number(row.max_attempts), beforeSnapshotId: row.before_snapshot_id,
    afterSnapshotId: row.after_snapshot_id, changedFields: parseJson<string[]>(row.changed_fields_json, []).slice(0, 20),
    errorCode: row.error_code, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), completedAt: iso(row.completed_at)
  };
}

export function queueJourneyResearchRefresh(input: {
  spaceId: string; sourceId: string; requestedByUserId: string | null; trigger: 'manual' | 'scheduled';
  idempotencyKey: string; monitorId?: string | null; availableAt?: string;
}) {
  assertResearch(input.spaceId);
  const source = getSourceRow(input.spaceId, input.sourceId);
  if (input.requestedByUserId) exactSource(input.spaceId, input.requestedByUserId, source);
  if (input.monitorId) {
    const monitor = getMonitorRow(input.spaceId, input.monitorId);
    if (monitor.source_id !== source.id) throw new JourneyResearchError(
      'The monitor does not belong to this research source.', 400, 'JOURNEY_RESEARCH_MONITOR_SOURCE_MISMATCH');
  }
  const key = boundedText(input.idempotencyKey, 200);
  if (!key) throw new JourneyResearchError('A refresh idempotency key is required.', 400,
    'JOURNEY_RESEARCH_IDEMPOTENCY_KEY_INVALID');
  const intent = sha({ sourceId: source.id, monitorId: input.monitorId || null, trigger: input.trigger });
  const replay = db.prepare('SELECT * FROM journey_research_refresh_runs WHERE space_id=? AND idempotency_key=?')
    .get(input.spaceId, key) as RefreshRunRow | undefined;
  if (replay && replay.intent_sha256 !== intent) throw new JourneyResearchError(
    'This idempotency key was already used for another refresh.', 409, 'JOURNEY_RESEARCH_IDEMPOTENCY_CONFLICT');
  if (replay) return { run: runSummary(replay), replayed: true };
  const id = crypto.randomUUID(); const now = nowIso();
  db.prepare(`INSERT INTO journey_research_refresh_runs
    (id,space_id,source_id,monitor_id,requested_by_user_id,trigger_kind,state,revision,available_at,lease_owner,
      lease_token,lease_generation,lease_expires_at,attempt_count,max_attempts,before_snapshot_id,after_snapshot_id,
      changed_fields_json,error_code,idempotency_key,intent_sha256,created_at,updated_at,completed_at)
    VALUES (?,?,?,?,?,?,'queued',1,?,NULL,NULL,0,NULL,0,3,NULL,NULL,'[]',NULL,?,?,?,?,NULL)`)
    .run(id, input.spaceId, source.id, input.monitorId || null, input.requestedByUserId, input.trigger,
      input.availableAt || now, key, intent, now, now);
  const row = db.prepare('SELECT * FROM journey_research_refresh_runs WHERE id=? AND space_id=?')
    .get(id, input.spaceId) as RefreshRunRow;
  writeAudit({ spaceId: input.spaceId, actorUserId: input.requestedByUserId, action: 'refresh.queued',
    targetType: 'research_refresh', targetId: id, detail: { sourceId: source.id, trigger: input.trigger } });
  return { run: runSummary(row), replayed: false };
}

export function listJourneyResearchRefreshRuns(input: { spaceId: string; limit?: number; offset?: number }) {
  assertResearch(input.spaceId);
  const limit = Math.max(1, Math.min(100, Math.trunc(input.limit || 50)));
  const offset = Math.max(0, Math.min(1_000_000, Math.trunc(input.offset || 0)));
  return (db.prepare(`SELECT * FROM journey_research_refresh_runs WHERE space_id=?
    ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).all(input.spaceId, limit, offset) as RefreshRunRow[]).map(runSummary);
}

type NotificationRow = {
  id: string; space_id: string; user_id: string; source_id: string; refresh_run_id: string | null;
  kind: JourneyResearchNotificationKind; dedupe_key: string; state: 'unread' | 'read' | 'dismissed';
  detail_json: unknown; revision: number | string; created_at: unknown; read_at: unknown;
};

function notificationSummary(row: NotificationRow) {
  const raw = parseJson<Record<string, unknown>>(row.detail_json, {});
  const detail: Record<string, unknown> = {};
  if (Array.isArray(raw.changedFields)) detail.changedFields = raw.changedFields.map((item) => boundedText(item, 80)).slice(0, 20);
  if (typeof raw.outcome === 'string') detail.outcome = boundedText(raw.outcome, 80);
  if (typeof raw.errorCode === 'string') detail.errorCode = boundedText(raw.errorCode, 100);
  return {
    id: row.id, sourceId: row.source_id, refreshRunId: row.refresh_run_id, kind: row.kind,
    state: row.state, detail, revision: Number(row.revision), createdAt: iso(row.created_at), readAt: iso(row.read_at)
  };
}

function researchSourceOwnerIds(spaceId: string, sourceId: string) {
  const users = new Set<string>();
  const source = getSourceRow(spaceId, sourceId);
  if (source.owner_user_id) users.add(source.owner_user_id);
  for (const row of db.prepare(`SELECT owner_user_id FROM journey_research_monitors
    WHERE space_id=? AND source_id=?`).all(spaceId, sourceId) as Array<{ owner_user_id: string }>) users.add(row.owner_user_id);
  for (const link of db.prepare(`SELECT target_type,target_id FROM journey_research_links
    WHERE space_id=? AND source_id=? AND state='active'`).all(spaceId, sourceId) as Array<{ target_type: JourneyResearchTargetType; target_id: string }>) {
    if (link.target_type === 'definition') {
      const owner = db.prepare('SELECT owner_user_id FROM journey_definitions WHERE id=? AND space_id=?')
        .get(link.target_id, spaceId) as { owner_user_id: string | null } | undefined;
      if (owner?.owner_user_id) users.add(owner.owner_user_id);
    } else if (link.target_type === 'persona') {
      const owner = db.prepare('SELECT owner_user_id FROM journey_personas WHERE id=? AND space_id=?')
        .get(link.target_id, spaceId) as { owner_user_id: string | null } | undefined;
      if (owner?.owner_user_id) users.add(owner.owner_user_id);
    } else {
      const table = link.target_type === 'stage' ? 'journey_map_stages' : 'journey_map_cards';
      const owner = db.prepare(`SELECT definition.owner_user_id FROM ${table} target
        JOIN journey_map_versions version ON version.id=target.version_id AND version.space_id=target.space_id
        JOIN journey_definitions definition ON definition.id=version.definition_id AND definition.space_id=version.space_id
        WHERE target.id=? AND target.space_id=?`).get(link.target_id, spaceId) as { owner_user_id: string | null } | undefined;
      if (owner?.owner_user_id) users.add(owner.owner_user_id);
    }
  }
  return [...users].filter((userId) => db.prepare(
    'SELECT 1 FROM space_memberships WHERE space_id=? AND user_id=?').get(spaceId, userId));
}

function notifyResearchSourceOwners(input: {
  spaceId: string; sourceId: string; refreshRunId?: string | null; kind: JourneyResearchNotificationKind;
  dedupeScope: string; detail?: { changedFields?: string[]; outcome?: string; errorCode?: string };
}) {
  const created: NotificationRow[] = [];
  for (const userId of researchSourceOwnerIds(input.spaceId, input.sourceId)) {
    const dedupeKey = boundedText(`${input.dedupeScope}:${input.kind}`, 200);
    const id = crypto.randomUUID();
    const inserted = db.prepare(`INSERT INTO journey_research_notifications
      (id,space_id,user_id,source_id,refresh_run_id,kind,dedupe_key,state,detail_json,revision,created_at,read_at)
      VALUES (?,?,?,?,?,?,?,'unread',?,1,?,NULL)
      ON CONFLICT(space_id,user_id,dedupe_key) DO NOTHING`)
      .run(id, input.spaceId, userId, input.sourceId, input.refreshRunId || null, input.kind, dedupeKey,
        JSON.stringify(input.detail || {}), nowIso()).changes;
    if (!inserted) continue;
    const row = db.prepare('SELECT * FROM journey_research_notifications WHERE id=? AND space_id=?')
      .get(id, input.spaceId) as NotificationRow;
    created.push(row);
    // The SSE payload is intentionally content-free and still user-scoped.
    publishEvent('journey-research-notification', {
      id: row.id, kind: row.kind, state: row.state, sourceId: row.source_id
    }, input.spaceId, userId);
  }
  return created;
}

/** Manual/no-run notifications deliberately use an explicit event key. This
 * proves idempotency without relying on SQL NULL uniqueness semantics. */
export function notifyJourneyResearchState(input: {
  spaceId: string; sourceId: string; kind: JourneyResearchNotificationKind; eventKey: string;
  detail?: { changedFields?: string[]; outcome?: string; errorCode?: string };
}) {
  assertResearch(input.spaceId);
  getSourceRow(input.spaceId, input.sourceId);
  const key = boundedText(input.eventKey, 120);
  if (!key) throw new JourneyResearchError('A notification event key is required.', 400,
    'JOURNEY_RESEARCH_NOTIFICATION_KEY_INVALID');
  return notifyResearchSourceOwners({ ...input, refreshRunId: null,
    dedupeScope: `manual:${input.sourceId}:${key}` }).map(notificationSummary);
}

export function listJourneyResearchNotifications(input: {
  spaceId: string; userId: string; state?: NotificationRow['state']; limit?: number; offset?: number;
}) {
  assertResearch(input.spaceId);
  const limit = Math.max(1, Math.min(100, Math.trunc(input.limit || 50)));
  const offset = Math.max(0, Math.min(1_000_000, Math.trunc(input.offset || 0)));
  const rows = input.state
    ? db.prepare(`SELECT * FROM journey_research_notifications WHERE space_id=? AND user_id=? AND state=?
        ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).all(input.spaceId, input.userId, input.state, limit, offset) as NotificationRow[]
    : db.prepare(`SELECT * FROM journey_research_notifications WHERE space_id=? AND user_id=?
        ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).all(input.spaceId, input.userId, limit, offset) as NotificationRow[];
  return rows.map(notificationSummary);
}

export function updateJourneyResearchNotification(input: {
  spaceId: string; userId: string; notificationId: string; expectedRevision: number; state: 'read' | 'dismissed';
}) {
  assertResearch(input.spaceId);
  const now = nowIso();
  const changed = db.prepare(`UPDATE journey_research_notifications SET state=?,read_at=?,revision=revision+1
    WHERE id=? AND space_id=? AND user_id=? AND revision=? AND state='unread'`)
    .run(input.state, now, input.notificationId, input.spaceId, input.userId, input.expectedRevision).changes;
  if (!changed) {
    const exists = db.prepare(`SELECT 1 FROM journey_research_notifications
      WHERE id=? AND space_id=? AND user_id=?`).get(input.notificationId, input.spaceId, input.userId);
    if (!exists) throw new JourneyResearchError('Research notification not found.', 404,
      'JOURNEY_RESEARCH_NOTIFICATION_NOT_FOUND');
    throw new JourneyResearchError('The notification changed before this update.', 409,
      'JOURNEY_RESEARCH_REVISION_CONFLICT');
  }
  const row = db.prepare('SELECT * FROM journey_research_notifications WHERE id=? AND space_id=?')
    .get(input.notificationId, input.spaceId) as NotificationRow;
  writeAudit({ spaceId: input.spaceId, actorUserId: input.userId, action: 'notification.updated',
    targetType: 'research_notification', targetId: row.id, detail: { state: row.state, revision: Number(row.revision) } });
  return notificationSummary(row);
}

export function listJourneyResearchAudit(input: { spaceId: string; limit?: number; offset?: number }) {
  assertResearch(input.spaceId);
  const limit = Math.max(1, Math.min(100, Math.trunc(input.limit || 50)));
  const offset = Math.max(0, Math.min(1_000_000, Math.trunc(input.offset || 0)));
  const rows = db.prepare(`SELECT id,actor_user_id,action,target_type,target_id,detail_json,created_at
    FROM journey_research_audit_events WHERE space_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`)
    .all(input.spaceId, limit, offset) as Array<any>;
  return rows.map((row) => ({
    id: row.id, actorUserId: row.actor_user_id, action: row.action, targetType: row.target_type,
    targetId: row.target_id, detail: parseJson<Record<string, unknown>>(row.detail_json, {}), createdAt: iso(row.created_at)
  }));
}

export type JourneyResearchInboxItem =
  | ({ itemKind: 'notification' } & ReturnType<typeof notificationSummary>)
  | ({ itemKind: 'gap' } & ReturnType<typeof gapSummary>)
  | { itemKind: 'source_state'; sourceId: string; state: SourceRow['state']; updatedAt: string | null }
  | {
    itemKind: 'existing_evidence_link'; linkId: string; targetType: string; targetId: string;
    access: string; refreshStatus: string; changedFields: string[]; unavailableReason: string | null;
    updatedAt: string | null;
  };

export function journeyResearchInbox(input: { spaceId: string; userId: string; limit?: number; offset?: number }) {
  assertResearch(input.spaceId);
  const all: JourneyResearchInboxItem[] = [];
  const notifications = listJourneyResearchNotifications({ ...input, state: 'unread', limit: 100, offset: 0 });
  all.push(...notifications.map((item) => ({ ...item, itemKind: 'notification' as const })));
  const gaps = listJourneyResearchGaps({ spaceId: input.spaceId, limit: 100, offset: 0 })
    .filter((gap) => gap.status !== 'resolved' && gap.status !== 'dismissed');
  all.push(...gaps.map((item) => ({ ...item, itemKind: 'gap' as const })));
  const inaccessible = db.prepare(`SELECT id,state,updated_at FROM journey_research_sources
    WHERE space_id=? AND state<>'active' ORDER BY updated_at DESC,id DESC LIMIT 100`).all(input.spaceId) as
      Array<Pick<SourceRow, 'id' | 'state' | 'updated_at'>>;
  all.push(...inaccessible.map((row) => ({
    itemKind: 'source_state' as const, sourceId: row.id, state: row.state, updatedAt: iso(row.updated_at)
  })));

  // Existing Journey Map evidence links remain the system of record for map
  // evidence. Project their lifecycle into the inbox without exposing saved
  // labels, excerpts or references when the source is no longer authorised.
  const legacy = db.prepare(`SELECT id,target_type,target_id,source_type,source_ref,source_label,excerpt,population,
    sample_size,collected_at,window_start,window_end,source_updated_at,created_at
    FROM journey_evidence_links WHERE space_id=? ORDER BY updated_at DESC,id DESC LIMIT 100`).all(input.spaceId) as Array<any>;
  for (const row of legacy) {
    const resolution = resolveJourneyEvidenceLifecycle({
      spaceId: input.spaceId, userId: input.userId, sourceType: row.source_type, sourceRef: row.source_ref
    });
    const state = journeyEvidenceReadState({
      sourceType: row.source_type, sourceRef: row.source_ref, sourceLabel: row.source_label, excerpt: row.excerpt,
      population: row.population, sampleSize: row.sample_size === null ? null : Number(row.sample_size),
      collectedAt: iso(row.collected_at), windowStart: iso(row.window_start), windowEnd: iso(row.window_end),
      sourceUpdatedAt: iso(row.source_updated_at)
    }, resolution);
    if (state.refreshStatus === 'current') continue;
    all.push({ itemKind: 'existing_evidence_link', linkId: row.id, targetType: row.target_type, targetId: row.target_id,
      access: state.access, refreshStatus: state.refreshStatus, changedFields: state.changedFields,
      unavailableReason: state.unavailableReason, updatedAt: iso(row.created_at) });
  }
  const timestamp = (item: JourneyResearchInboxItem) =>
    ('updatedAt' in item ? item.updatedAt : item.createdAt) || '';
  all.sort((left, right) => timestamp(right).localeCompare(timestamp(left)));
  const offset = Math.max(0, Math.min(1_000_000, Math.trunc(input.offset || 0)));
  const limit = Math.max(1, Math.min(100, Math.trunc(input.limit || 50)));
  return { items: all.slice(offset, offset + limit), nextOffset: offset + limit < all.length ? offset + limit : null };
}

function appendRefreshAttempt(input: {
  run: RefreshRunRow; status: 'succeeded' | 'retryable_failed' | 'terminal_failed' | 'lease_expired';
  errorCode?: string | null; startedAt: string; completedAt: string;
}) {
  db.prepare(`INSERT INTO journey_research_refresh_attempts
    (id,run_id,space_id,attempt_number,lease_generation,status,error_code,started_at,completed_at)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(crypto.randomUUID(), input.run.id, input.run.space_id, Number(input.run.attempt_count),
      Number(input.run.lease_generation), input.status, input.status === 'succeeded' ? null : input.errorCode || 'REFRESH_FAILED',
      input.startedAt, input.completedAt);
}

function refreshRunRow(spaceId: string, runId: string) {
  return db.prepare('SELECT * FROM journey_research_refresh_runs WHERE id=? AND space_id=?')
    .get(runId, spaceId) as RefreshRunRow | undefined;
}

function assertCurrentLease(run: RefreshRunRow) {
  const current = refreshRunRow(run.space_id, run.id);
  if (!current || current.state !== 'leased' || current.lease_token !== run.lease_token
      || Number(current.lease_generation) !== Number(run.lease_generation)
      || !iso(current.lease_expires_at) || Date.parse(iso(current.lease_expires_at)!) <= Date.now()) {
    throw new JourneyResearchError('The refresh lease is no longer current.', 409, 'JOURNEY_RESEARCH_LEASE_LOST');
  }
  return current;
}

export function scheduleDueJourneyResearchMonitors(at = nowIso(), limit = 100) {
  const rows = db.prepare(`SELECT * FROM journey_research_monitors
    WHERE state='active' AND next_run_at<=? ORDER BY next_run_at,id LIMIT ?`).all(at, Math.max(1, Math.min(500, limit))) as MonitorRow[];
  let queued = 0;
  for (const monitor of rows) {
    const scheduledAt = iso(monitor.next_run_at) || at;
    try {
      const result = queueJourneyResearchRefresh({
        spaceId: monitor.space_id, sourceId: monitor.source_id, requestedByUserId: monitor.owner_user_id,
        trigger: 'scheduled', monitorId: monitor.id, idempotencyKey: `schedule:${monitor.id}:${scheduledAt}`,
        availableAt: at
      });
      if (!result.replayed) queued += 1;
      const next = new Date(Math.max(Date.parse(at), Date.parse(scheduledAt)) + Number(monitor.interval_seconds) * 1000).toISOString();
      db.prepare(`UPDATE journey_research_monitors SET last_run_at=?,next_run_at=?,revision=revision+1,updated_at=?
        WHERE id=? AND space_id=? AND revision=?`).run(at, next, at, monitor.id, monitor.space_id, Number(monitor.revision));
    } catch (error) {
      // Disabled plans and access loss are fail-closed; leave the monitor due
      // so an administrator can repair it without silently dropping work.
      if (!(error instanceof JourneyResearchError) && Number((error as { status?: number })?.status) !== 403) throw error;
    }
  }
  return queued;
}

export function reclaimExpiredJourneyResearchLeases(at = nowIso()) {
  const rows = db.prepare(`SELECT * FROM journey_research_refresh_runs
    WHERE state='leased' AND lease_expires_at<=? ORDER BY lease_expires_at,id LIMIT 100`).all(at) as RefreshRunRow[];
  let reclaimed = 0;
  for (const stale of rows) db.transaction(() => {
    const row = refreshRunRow(stale.space_id, stale.id);
    if (!row || row.state !== 'leased' || row.lease_token !== stale.lease_token) return;
    const terminal = Number(row.attempt_count) >= Number(row.max_attempts);
    appendRefreshAttempt({ run: row, status: 'lease_expired', errorCode: 'REFRESH_LEASE_EXPIRED',
      startedAt: iso(row.updated_at) || at, completedAt: at });
    db.prepare(`UPDATE journey_research_refresh_runs SET state=?,revision=revision+1,available_at=?,lease_owner=NULL,
      lease_token=NULL,lease_expires_at=NULL,error_code=?,updated_at=?,completed_at=?
      WHERE id=? AND space_id=? AND state='leased' AND lease_token=? AND lease_generation=?`)
      .run(terminal ? 'failed' : 'retry_wait', at, 'REFRESH_LEASE_EXPIRED', at, terminal ? at : null,
        row.id, row.space_id, row.lease_token, Number(row.lease_generation));
    if (terminal) {
      notifyResearchSourceOwners({ spaceId: row.space_id, sourceId: row.source_id, refreshRunId: row.id,
        kind: 'refresh_failed', dedupeScope: `run:${row.id}`, detail: { errorCode: 'REFRESH_LEASE_EXPIRED' } });
      writeAudit({ spaceId: row.space_id, action: 'refresh.failed', targetType: 'research_refresh', targetId: row.id,
        detail: { errorCode: 'REFRESH_LEASE_EXPIRED' } });
    }
    reclaimed += 1;
  })();
  return reclaimed;
}

export function claimJourneyResearchRefreshRuns(input: {
  leaseOwner: string; leaseMs: number; limit: number; at?: string;
}) {
  const at = input.at || nowIso();
  const owner = boundedText(input.leaseOwner, 128);
  const leaseMs = Math.max(5_000, Math.min(600_000, Math.trunc(input.leaseMs)));
  const limit = Math.max(1, Math.min(100, Math.trunc(input.limit)));
  if (!owner) throw new JourneyResearchError('A refresh lease owner is required.', 500,
    'JOURNEY_RESEARCH_LEASE_OWNER_REQUIRED');
  return db.transaction(() => {
    const suffix = db.provider === 'postgres' ? ' FOR UPDATE SKIP LOCKED' : '';
    const candidates = db.prepare(`SELECT * FROM journey_research_refresh_runs
      WHERE state IN ('queued','retry_wait') AND available_at<=?
      ORDER BY available_at,created_at,id LIMIT ?${suffix}`).all(at, limit) as RefreshRunRow[];
    const claimed: RefreshRunRow[] = [];
    for (const candidate of candidates) {
      const token = crypto.randomBytes(24).toString('base64url');
      const expires = new Date(Date.parse(at) + leaseMs).toISOString();
      const changed = db.prepare(`UPDATE journey_research_refresh_runs SET state='leased',revision=revision+1,
        lease_owner=?,lease_token=?,lease_generation=lease_generation+1,lease_expires_at=?,attempt_count=attempt_count+1,
        error_code=NULL,updated_at=? WHERE id=? AND space_id=? AND state IN ('queued','retry_wait') AND revision=?`)
        .run(owner, token, expires, at, candidate.id, candidate.space_id, Number(candidate.revision)).changes;
      if (!changed) continue;
      const row = refreshRunRow(candidate.space_id, candidate.id);
      if (row) claimed.push(row);
    }
    return claimed;
  })();
}

function completeUnavailableRefresh(run: RefreshRunRow, source: SourceRow, startedAt: string, code: string) {
  const completedAt = nowIso();
  return db.transaction(() => {
    const current = assertCurrentLease(run);
    const before = latestSnapshot(run.space_id, source.id);
    db.prepare(`UPDATE journey_research_sources SET state='inaccessible',revision=revision+1,last_error_code=?,
      updated_at=? WHERE id=? AND space_id=?`).run(code, completedAt, source.id, run.space_id);
    const changed = db.prepare(`UPDATE journey_research_refresh_runs SET state='completed',revision=revision+1,
      before_snapshot_id=?,after_snapshot_id=NULL,changed_fields_json='[]',error_code=?,lease_owner=NULL,lease_token=NULL,
      lease_expires_at=NULL,updated_at=?,completed_at=? WHERE id=? AND space_id=? AND state='leased'
      AND lease_token=? AND lease_generation=?`)
      .run(before?.id || null, code, completedAt, completedAt, run.id, run.space_id,
        current.lease_token, Number(current.lease_generation)).changes;
    if (!changed) throw new JourneyResearchError('The refresh lease was lost.', 409, 'JOURNEY_RESEARCH_LEASE_LOST');
    appendRefreshAttempt({ run: current, status: 'succeeded', startedAt, completedAt });
    if (source.state === 'active') notifyResearchSourceOwners({
      spaceId: run.space_id, sourceId: source.id, refreshRunId: run.id, kind: 'source_inaccessible',
      dedupeScope: `run:${run.id}`, detail: { outcome: 'inaccessible', errorCode: code }
    });
    writeAudit({ spaceId: run.space_id, actorUserId: run.requested_by_user_id, action: 'refresh.completed',
      targetType: 'research_refresh', targetId: run.id, detail: { outcome: 'inaccessible', errorCode: code } });
    return runSummary(refreshRunRow(run.space_id, run.id)!);
  })();
}

function failRefresh(run: RefreshRunRow, startedAt: string, errorCode: string) {
  const completedAt = nowIso();
  return db.transaction(() => {
    const current = assertCurrentLease(run);
    const terminal = Number(current.attempt_count) >= Number(current.max_attempts);
    appendRefreshAttempt({ run: current, status: terminal ? 'terminal_failed' : 'retryable_failed',
      errorCode, startedAt, completedAt });
    const delaySeconds = Math.min(300, 5 * (2 ** Math.max(0, Number(current.attempt_count) - 1)));
    const available = new Date(Date.parse(completedAt) + delaySeconds * 1000).toISOString();
    const changed = db.prepare(`UPDATE journey_research_refresh_runs SET state=?,revision=revision+1,available_at=?,
      error_code=?,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=?,completed_at=?
      WHERE id=? AND space_id=? AND state='leased' AND lease_token=? AND lease_generation=?`)
      .run(terminal ? 'failed' : 'retry_wait', available, errorCode, completedAt, terminal ? completedAt : null,
        current.id, current.space_id, current.lease_token, Number(current.lease_generation)).changes;
    if (!changed) throw new JourneyResearchError('The refresh lease was lost.', 409, 'JOURNEY_RESEARCH_LEASE_LOST');
    if (terminal) {
      notifyResearchSourceOwners({ spaceId: current.space_id, sourceId: current.source_id, refreshRunId: current.id,
        kind: 'refresh_failed', dedupeScope: `run:${current.id}`, detail: { errorCode } });
      writeAudit({ spaceId: current.space_id, actorUserId: current.requested_by_user_id, action: 'refresh.failed',
        targetType: 'research_refresh', targetId: current.id, detail: { errorCode } });
    }
    return runSummary(refreshRunRow(current.space_id, current.id)!);
  })();
}

export function processJourneyResearchRefresh(run: RefreshRunRow) {
  const startedAt = nowIso();
  const source = getSourceRow(run.space_id, run.source_id);
  const monitor = run.monitor_id ? getMonitorRow(run.space_id, run.monitor_id) : null;
  const userId = run.requested_by_user_id || monitor?.owner_user_id || source.owner_user_id;
  if (!userId || !db.prepare('SELECT 1 FROM space_memberships WHERE space_id=? AND user_id=?').get(run.space_id, userId)) {
    return failRefresh(run, startedAt, 'AUTHORIZATION_CONTEXT_MISSING');
  }
  let view: JourneyEvidenceSourceView;
  try {
    view = exactSource(run.space_id, userId, source);
  } catch (error) {
    const status = Number((error as { status?: number })?.status || 0);
    if ([403, 404, 422].includes(status)) return completeUnavailableRefresh(run, source, startedAt,
      status === 403 ? 'SOURCE_FEATURE_DISABLED' : 'SOURCE_NOT_AVAILABLE');
    return failRefresh(run, startedAt, 'SOURCE_RESOLUTION_FAILED');
  }
  try {
    return db.transaction(() => {
      const current = assertCurrentLease(run);
      const before = latestSnapshot(run.space_id, source.id);
      const created = createSnapshot({ source, view, actorUserId: userId });
      const after = created.row;
      let changedFields: string[] = [];
      if (before) {
        const stored = snapshotForLifecycle(before);
        stored.sourceType = source.source_type;
        stored.sourceRef = source.source_ref;
        changedFields = journeyEvidenceReadState(stored, { kind: 'available', source: {
          sourceType: view.sourceType, sourceRef: view.sourceRef, label: view.label, excerpt: view.excerpt,
          population: view.population, sampleSize: view.sampleSize, collectedAt: view.collectedAt,
          windowStart: view.windowStart, windowEnd: view.windowEnd, updatedAt: view.updatedAt
        } }).changedFields;
      }
      const completedAt = nowIso();
      db.prepare(`UPDATE journey_research_sources SET state='active',revision=revision+1,last_resolved_at=?,
        last_error_code=NULL,updated_at=? WHERE id=? AND space_id=?`)
        .run(completedAt, completedAt, source.id, run.space_id);
      const updated = db.prepare(`UPDATE journey_research_refresh_runs SET state='completed',revision=revision+1,
        before_snapshot_id=?,after_snapshot_id=?,changed_fields_json=?,error_code=NULL,lease_owner=NULL,lease_token=NULL,
        lease_expires_at=NULL,updated_at=?,completed_at=? WHERE id=? AND space_id=? AND state='leased'
        AND lease_token=? AND lease_generation=?`)
        .run(before?.id || null, after.id, JSON.stringify(changedFields), completedAt, completedAt,
          current.id, current.space_id, current.lease_token, Number(current.lease_generation)).changes;
      if (!updated) throw new JourneyResearchError('The refresh lease was lost.', 409, 'JOURNEY_RESEARCH_LEASE_LOST');
      appendRefreshAttempt({ run: current, status: 'succeeded', startedAt, completedAt });
      if (source.state === 'inaccessible') notifyResearchSourceOwners({
        spaceId: run.space_id, sourceId: source.id, refreshRunId: run.id, kind: 'source_recovered',
        dedupeScope: `run:${run.id}`, detail: { outcome: 'recovered' }
      });
      if (changedFields.length) notifyResearchSourceOwners({
        spaceId: run.space_id, sourceId: source.id, refreshRunId: run.id, kind: 'source_changed',
        dedupeScope: `run:${run.id}`, detail: { changedFields }
      });
      writeAudit({ spaceId: run.space_id, actorUserId: userId, action: 'refresh.completed',
        targetType: 'research_refresh', targetId: run.id,
        detail: { outcome: changedFields.length ? 'changed' : 'unchanged', changedFields } });
      return runSummary(refreshRunRow(run.space_id, run.id)!);
    })();
  } catch (error) {
    if (error instanceof JourneyResearchError && error.code === 'JOURNEY_RESEARCH_LEASE_LOST') throw error;
    return failRefresh(run, startedAt, 'REFRESH_PERSISTENCE_FAILED');
  }
}

export function runJourneyResearchRefreshBatch(input: { leaseOwner: string; leaseMs: number; limit: number }) {
  reclaimExpiredJourneyResearchLeases();
  scheduleDueJourneyResearchMonitors(nowIso(), input.limit * 2);
  const runs = claimJourneyResearchRefreshRuns(input);
  const results: ReturnType<typeof runSummary>[] = [];
  for (const run of runs) {
    try { results.push(processJourneyResearchRefresh(run)); }
    catch (error) {
      if (!(error instanceof JourneyResearchError && error.code === 'JOURNEY_RESEARCH_LEASE_LOST')) {
        try { results.push(failRefresh(run, nowIso(), 'REFRESH_UNEXPECTED_FAILURE')); } catch { /* lease already recovered */ }
      }
    }
  }
  return results;
}
