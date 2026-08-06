import crypto from 'node:crypto';
import { db, getJourney } from './database.js';
import {
  computeEvidenceState, computeJourneyMode, convertLegacyJourney, defaultLaneForCardKind,
  deterministicJourneyId, evidenceAssessments, evidenceSourceTypes, journeyCardId, journeyCardKinds,
  isCustomJourneyLane, isCustomJourneyLaneKey, isJourneyLaneKey, journeyCustomLaneKey, journeyExperienceTypes,
  journeyLaneId, journeyMapLimits, journeyMapTypes,
  JOURNEY_MAP_SCHEMA_VERSION, journeyStageId, journeyStageKey, journeyVersionId, lanesForMapType,
  moveOrdinal, personaLifecycleStates, researchGaps, validateJourneyStructure,
  type EvidenceAssessment, type EvidenceLinkFacts, type EvidenceSourceType, type EvidenceStateResult,
  type JourneyCardKind, type JourneyEvidenceState, type JourneyExperienceType, type JourneyLaneKey, type JourneyLaneType,
  type JourneyMapType, type JourneyMode, type PersonaLifecycleState, type ResearchGap
} from './journeyDomain.js';
import {
  JourneyEvidenceSourceError, resolveJourneyEvidenceLifecycle, resolveJourneyEvidenceSource, type JourneyEvidenceSourceView
} from './journeyEvidenceSources.js';
import {
  JourneyEvidenceLifecycleError, journeyEvidenceReadState, journeyEvidenceSnapshotFingerprint, refreshJourneyEvidenceSnapshot,
  type JourneyEvidenceSnapshot, type JourneyEvidenceSnapshotField
} from './journeyEvidenceLifecycle.js';
import {
  assertSubscriptionFeature, assertSubscriptionQuota, effectiveSubscriptionForSpace
} from './subscriptionEntitlements.js';
import {
  assertPersonaCanBeLinked, assertPersonaDeletionAllowed, assertPersonaLinkedToJourney,
  createInitialPersonaVersion, createPersonaWorkingVersion, ensurePersonaVersionSeed, personaRowsForJourneyVersion,
  pinJourneyPersonaVersions
} from './journeyPersonaVersions.js';
import { cloneJourneyRichCardsForPublishedDraft } from './journeyRichCards.js';
import type { Journey, JourneyVersion } from './types.js';

export class JourneyMapError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = 'JOURNEY_MAP_INVALID',
    public details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'JourneyMapError';
  }
}

const cardKindSet = new Set<string>(journeyCardKinds);
const mapTypeSet = new Set<string>(journeyMapTypes);
const experienceTypeSet = new Set<string>(journeyExperienceTypes);
const assessmentSet = new Set<string>(evidenceAssessments);
const sourceTypeSet = new Set<string>(evidenceSourceTypes);
const lifecycleSet = new Set<string>(personaLifecycleStates);

const parseJson = <T>(value: unknown, fallback: T): T => {
  try { return value ? JSON.parse(String(value)) as T : fallback; }
  catch { return fallback; }
};

function nowIso() { return new Date().toISOString(); }

function text(value: unknown, max: number) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, max);
}

function body(value: unknown, max: number) {
  return String(value ?? '').replace(/\r\n?/gu, '\n').trim().slice(0, max);
}

function stringList(value: unknown, max = 40) {
  if (!Array.isArray(value)) return [] as string[];
  const seen = new Set<string>();
  for (const entry of value) {
    const item = text(entry, journeyMapLimits.titleChars);
    if (item) seen.add(item);
    if (seen.size >= max) break;
  }
  return [...seen];
}

export type JourneyPersona = {
  id: string;
  name: string;
  summary: string;
  lifecycleState: PersonaLifecycleState;
  ownerUserId: string | null;
  source: 'workspace' | 'legacy_audience_draft' | 'ai_draft';
  attributes: Record<string, string>;
  goals: string[];
  behaviours: string[];
  needs: string[];
  barriers: string[];
  reviewAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  /** Populated on list reads so the library can show reuse without a second call. */
  linkedJourneyCount?: number;
  evidenceState?: JourneyEvidenceState;
  /** Durable persona version resolved for this read. Published map versions
   * expose a pinned snapshot; working maps resolve the current revision. */
  personaVersionId?: string | null;
  personaVersionNumber?: number | null;
  reviewState?: 'draft' | 'in_review' | 'changes_requested' | 'approved';
  versionPinned?: boolean;
};

export type JourneyEvidenceLink = {
  id: string;
  targetType: 'card' | 'stage' | 'persona' | 'definition';
  targetId: string;
  sourceType: EvidenceSourceType;
  sourceRef: string;
  sourceLabel: string;
  excerpt: string;
  assessment: EvidenceAssessment;
  confidence: number;
  population: string;
  sampleSize: number | null;
  collectedAt: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  freshnessDays: number | null;
  sourceUpdatedAt: string | null;
  lastValidatedAt: string | null;
  invalidatedAt: string | null;
  invalidatedReason: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  sourceAccess: 'available' | 'inaccessible';
  refreshStatus: 'current' | 'changed' | 'unavailable';
  changedFields: JourneyEvidenceSnapshotField[];
  snapshotFingerprint: string;
};

export type JourneyEvidenceAuditEvent = {
  id: string;
  evidenceLinkId: string;
  actorUserId: string | null;
  action: 'refreshed';
  changedFields: JourneyEvidenceSnapshotField[];
  beforeFingerprint: string;
  afterFingerprint: string;
  createdAt: string;
};

export type JourneyMapCard = {
  id: string;
  stageKey: string;
  laneType: JourneyLaneKey;
  kind: JourneyCardKind;
  title: string;
  content: string;
  ordinal: number;
  personaId: string | null;
  status: 'draft' | 'active' | 'retired';
  origin: 'legacy_import' | 'workspace' | 'ai_suggestion' | 'template';
  evidence: EvidenceStateResult;
  evidenceLinkCount: number;
  createdAt: string;
  updatedAt: string;
};

export type JourneyMapStage = {
  id: string; stageKey: string; name: string; goal: string; description: string; ordinal: number;
};

export type JourneyMapLane = {
  id: string; laneType: JourneyLaneKey; title: string; description: string; ordinal: number; visible: boolean;
};

export type JourneyDefinitionSummary = {
  id: string;
  spaceId: string;
  legacyJourneyId: string | null;
  name: string;
  purpose: string;
  experienceType: JourneyExperienceType;
  mapType: JourneyMapType;
  mode: JourneyMode;
  status: 'draft' | 'published' | 'archived';
  ownerUserId: string | null;
  currentVersionId: string | null;
  publishedVersionId: string | null;
  reviewCadenceDays: number;
  revision: number;
  stageCount: number;
  cardCount: number;
  evidenceLinkCount: number;
  personaCount: number;
  createdAt: string;
  updatedAt: string;
};

export type JourneyMapVersionSummary = {
  id: string;
  versionNumber: number;
  schemaVersion: number;
  state: 'draft' | 'published' | 'superseded';
  authorUserId: string | null;
  sourceJobId: string | null;
  publishedAt: string | null;
  createdAt: string;
};

export type JourneyMapReadModel = {
  definition: JourneyDefinitionSummary;
  version: JourneyMapVersionSummary & {
    mapType: JourneyMapType;
    mode: JourneyMode;
    experienceType: JourneyExperienceType;
    objective: string;
    industry: string;
    summary: string;
    legacyAudience: string;
    provenance: Record<string, unknown>;
  };
  stages: JourneyMapStage[];
  lanes: JourneyMapLane[];
  cards: JourneyMapCard[];
  personas: JourneyPersona[];
  versions: JourneyMapVersionSummary[];
  researchGaps: ResearchGap[];
  evidenceSummary: Record<JourneyEvidenceState, number>;
};

/** A bounded authoritative response for high-density editor moves. Legacy
 * callers still receive the complete read model; clients must opt in to this
 * shape and reconcile only the exact cells returned by the server. */
export type JourneyCardMoveAffectedCellsResponse = {
  responseMode: 'affected_cells';
  definitionId: string;
  versionId: string;
  cardId: string;
  revision: number;
  updatedAt: string;
  cardsPerCellLimit: number;
  affectedCells: Array<{
    stageKey: string;
    laneType: JourneyLaneKey;
    cards: JourneyMapCard[];
  }>;
};

const rowPersona = (row: any): JourneyPersona => ({
  id: row.id,
  name: row.name,
  summary: row.summary,
  lifecycleState: row.lifecycle_state,
  ownerUserId: row.owner_user_id || null,
  source: row.source,
  attributes: parseJson(row.attributes_json, {} as Record<string, string>),
  goals: parseJson(row.goals_json, [] as string[]),
  behaviours: parseJson(row.behaviours_json, [] as string[]),
  needs: parseJson(row.needs_json, [] as string[]),
  barriers: parseJson(row.barriers_json, [] as string[]),
  reviewAt: row.review_at || null,
  revision: Number(row.revision),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  ...(row.linked_journey_count === undefined ? {} : { linkedJourneyCount: Number(row.linked_journey_count) }),
  ...(row.persona_version_id === undefined ? {} : { personaVersionId: row.persona_version_id || null }),
  ...(row.persona_version_number === undefined
    ? {} : { personaVersionNumber: row.persona_version_number === null ? null : Number(row.persona_version_number) }),
  ...(row.persona_review_state === undefined ? {} : { reviewState: row.persona_review_state }),
  ...(row.persona_version_pinned === undefined ? {} : { versionPinned: Number(row.persona_version_pinned) === 1 })
});

const rowEvidenceLink = (row: any): JourneyEvidenceLink => {
  const link: JourneyEvidenceLink = {
  id: row.id,
  targetType: row.target_type,
  targetId: row.target_id,
  sourceType: row.source_type,
  sourceRef: row.source_ref,
  sourceLabel: row.source_label,
  excerpt: row.excerpt,
  assessment: row.assessment,
  confidence: Number(row.confidence),
  population: row.population,
  sampleSize: row.sample_size === null || row.sample_size === undefined ? null : Number(row.sample_size),
  collectedAt: row.collected_at || null,
  windowStart: row.window_start || null,
  windowEnd: row.window_end || null,
  freshnessDays: row.freshness_days === null || row.freshness_days === undefined ? null : Number(row.freshness_days),
  sourceUpdatedAt: row.source_updated_at || null,
  lastValidatedAt: row.last_validated_at || row.created_at || null,
  invalidatedAt: row.invalidated_at || null,
  invalidatedReason: row.invalidated_reason || null,
  createdBy: row.created_by || null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  sourceAccess: 'available',
  refreshStatus: 'current',
  changedFields: [],
    snapshotFingerprint: ''
  };
  link.snapshotFingerprint = journeyEvidenceSnapshotFingerprint(evidenceSnapshot(link));
  return link;
};

function evidenceSnapshot(link: JourneyEvidenceLink): JourneyEvidenceSnapshot {
  return {
    sourceType: link.sourceType,
    sourceRef: link.sourceRef,
    sourceLabel: link.sourceLabel,
    excerpt: link.excerpt,
    population: link.population,
    sampleSize: link.sampleSize,
    collectedAt: link.collectedAt,
    windowStart: link.windowStart,
    windowEnd: link.windowEnd,
    sourceUpdatedAt: link.sourceUpdatedAt
  };
}

function evidenceLinkForViewer(spaceId: string, userId: string, link: JourneyEvidenceLink): JourneyEvidenceLink {
  const state = journeyEvidenceReadState(evidenceSnapshot(link), resolveJourneyEvidenceLifecycle({
    spaceId, userId, sourceType: link.sourceType, sourceRef: link.sourceRef
  }));
  return {
    ...link,
    sourceRef: state.viewerSnapshot.sourceRef,
    sourceLabel: state.viewerSnapshot.sourceLabel,
    excerpt: state.viewerSnapshot.excerpt,
    population: state.viewerSnapshot.population,
    sampleSize: state.viewerSnapshot.sampleSize,
    collectedAt: state.viewerSnapshot.collectedAt,
    windowStart: state.viewerSnapshot.windowStart,
    windowEnd: state.viewerSnapshot.windowEnd,
    sourceUpdatedAt: state.viewerSnapshot.sourceUpdatedAt,
    sourceAccess: state.access,
    refreshStatus: state.refreshStatus,
    changedFields: state.changedFields,
    snapshotFingerprint: state.snapshotFingerprint
  };
}

function evidenceFacts(link: JourneyEvidenceLink): EvidenceLinkFacts {
  return {
    sourceType: link.sourceType,
    assessment: link.assessment,
    collectedAt: link.collectedAt,
    sampleSize: link.sampleSize,
    freshnessDays: link.freshnessDays,
    invalidated: Boolean(link.invalidatedAt),
    inaccessible: link.sourceAccess === 'inaccessible'
  };
}

function definitionCounts(spaceId: string, definitionId: string, versionId: string | null, viewerUserId?: string) {
  const stageCount = versionId ? Number((db.prepare('SELECT COUNT(*) count FROM journey_map_stages WHERE version_id=? AND space_id=?')
    .get(versionId, spaceId) as any)?.count || 0) : 0;
  const cardCount = versionId ? Number((db.prepare('SELECT COUNT(*) count FROM journey_map_cards WHERE version_id=? AND space_id=?')
    .get(versionId, spaceId) as any)?.count || 0) : 0;
  // Definition and linked-persona evidence belongs to the map independently of
  // a structural version. Stage/card evidence is version-pinned and must be
  // counted only for the version being read; otherwise a historical published
  // map would silently report the current draft's evidence state.
  let sharedEvidenceLinkCount = Number((db.prepare(`SELECT COUNT(*) count
    FROM journey_evidence_links link
    WHERE link.space_id=? AND link.invalidated_at IS NULL AND (
      (link.target_type='definition' AND link.target_id=?)
      OR (link.target_type='persona' AND EXISTS (
        SELECT 1 FROM journey_definition_personas persona_link
        WHERE persona_link.definition_id=? AND persona_link.persona_id=link.target_id
          AND persona_link.space_id=link.space_id
      ))
    )`).get(spaceId, definitionId, definitionId) as any)?.count || 0);
  let versionEvidenceLinkCount = versionId ? Number((db.prepare(`SELECT COUNT(*) count
    FROM journey_evidence_links link
    WHERE link.space_id=? AND link.invalidated_at IS NULL AND (
      (link.target_type='stage' AND EXISTS (
        SELECT 1 FROM journey_map_stages stage
        WHERE stage.id=link.target_id AND stage.space_id=link.space_id AND stage.version_id=?
      ))
      OR (link.target_type='card' AND EXISTS (
        SELECT 1 FROM journey_map_cards card
        WHERE card.id=link.target_id AND card.space_id=link.space_id AND card.version_id=?
      ))
    )`).get(spaceId, versionId, versionId) as any)?.count || 0) : 0;
  if (viewerUserId) {
    const sharedRows = db.prepare(`SELECT link.* FROM journey_evidence_links link
      WHERE link.space_id=? AND link.invalidated_at IS NULL AND (
        (link.target_type='definition' AND link.target_id=?)
        OR (link.target_type='persona' AND EXISTS (
          SELECT 1 FROM journey_definition_personas persona_link
          WHERE persona_link.definition_id=? AND persona_link.persona_id=link.target_id
            AND persona_link.space_id=link.space_id
        ))
      )`).all(spaceId, definitionId, definitionId) as any[];
    sharedEvidenceLinkCount = sharedRows.map(rowEvidenceLink)
      .filter((link) => evidenceLinkForViewer(spaceId, viewerUserId, link).sourceAccess === 'available').length;
    const versionRows = versionId ? db.prepare(`SELECT link.* FROM journey_evidence_links link
      WHERE link.space_id=? AND link.invalidated_at IS NULL AND (
        (link.target_type='stage' AND EXISTS (
          SELECT 1 FROM journey_map_stages stage
          WHERE stage.id=link.target_id AND stage.space_id=link.space_id AND stage.version_id=?
        ))
        OR (link.target_type='card' AND EXISTS (
          SELECT 1 FROM journey_map_cards card
          WHERE card.id=link.target_id AND card.space_id=link.space_id AND card.version_id=?
        ))
      )`).all(spaceId, versionId, versionId) as any[] : [];
    versionEvidenceLinkCount = versionRows.map(rowEvidenceLink)
      .filter((link) => evidenceLinkForViewer(spaceId, viewerUserId, link).sourceAccess === 'available').length;
  }
  const evidenceLinkCount = sharedEvidenceLinkCount + versionEvidenceLinkCount;
  const personaCount = Number((db.prepare('SELECT COUNT(*) count FROM journey_definition_personas WHERE definition_id=? AND space_id=?')
    .get(definitionId, spaceId) as any)?.count || 0);
  return { stageCount, cardCount, evidenceLinkCount, personaCount };
}

function rowDefinition(row: any, versionId: string | null = row.current_version_id || null, viewerUserId?: string): JourneyDefinitionSummary {
  const counts = definitionCounts(row.space_id, row.id, versionId, viewerUserId);
  return {
    id: row.id,
    spaceId: row.space_id,
    legacyJourneyId: row.legacy_journey_id || null,
    name: row.name,
    purpose: row.purpose,
    experienceType: row.experience_type,
    mapType: row.map_type,
    // Mode is derived, never stored authoritatively: a map is only
    // evidence-backed while usable links actually exist.
    mode: computeJourneyMode({ evidenceLinkCount: counts.evidenceLinkCount }),
    status: row.status,
    ownerUserId: row.owner_user_id || null,
    currentVersionId: row.current_version_id || null,
    publishedVersionId: row.published_version_id || null,
    reviewCadenceDays: Number(row.review_cadence_days),
    revision: Number(row.revision),
    ...counts,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const rowVersionSummary = (row: any): JourneyMapVersionSummary => ({
  id: row.id,
  versionNumber: Number(row.version_number),
  schemaVersion: Number(row.schema_version),
  state: row.state,
  authorUserId: row.author_user_id || null,
  sourceJobId: row.source_job_id || null,
  publishedAt: row.published_at || null,
  createdAt: row.created_at
});

export function listJourneyDefinitions(spaceId: string, viewerUserId?: string): JourneyDefinitionSummary[] {
  return (db.prepare('SELECT * FROM journey_definitions WHERE space_id=? ORDER BY updated_at DESC,id')
    .all(spaceId) as any[]).map((row) => rowDefinition(row, row.current_version_id || null, viewerUserId));
}

export function getJourneyDefinition(spaceId: string, definitionId: string): JourneyDefinitionSummary | null {
  const row = db.prepare('SELECT * FROM journey_definitions WHERE id=? AND space_id=?').get(definitionId, spaceId) as any;
  return row ? rowDefinition(row) : null;
}

function requireDefinition(spaceId: string, definitionId: string) {
  const definition = getJourneyDefinition(spaceId, definitionId);
  if (!definition) throw new JourneyMapError('Journey map not found.', 404, 'JOURNEY_MAP_NOT_FOUND');
  return definition;
}

function requireEditableVersion(spaceId: string, definitionId: string) {
  const definition = requireDefinition(spaceId, definitionId);
  if (!definition.currentVersionId) {
    throw new JourneyMapError('This journey map has no working version.', 409, 'JOURNEY_MAP_VERSION_MISSING');
  }
  const row = db.prepare('SELECT * FROM journey_map_versions WHERE id=? AND space_id=?')
    .get(definition.currentVersionId, spaceId) as any;
  if (!row) throw new JourneyMapError('This journey map has no working version.', 409, 'JOURNEY_MAP_VERSION_MISSING');
  if (row.state === 'published') {
    // Published versions are immutable. Editing forks a new draft so pinned
    // evidence and shared links keep resolving to what was reviewed.
    throw new JourneyMapError('Published versions are immutable. Create a draft before editing.', 409, 'JOURNEY_MAP_VERSION_PUBLISHED');
  }
  return { definition, version: row };
}

/** Compact editor writes do not need definition counts, personas, research
 * gaps, or the complete card collection. Resolve only the version identity and
 * preserve the same not-found/immutable semantics as the full read path. */
function requireEditableVersionIdentity(spaceId: string, definitionId: string) {
  const definition = db.prepare('SELECT id,current_version_id FROM journey_definitions WHERE id=? AND space_id=?')
    .get(definitionId, spaceId) as { id: string; current_version_id: string | null } | undefined;
  if (!definition) throw new JourneyMapError('Journey map not found.', 404, 'JOURNEY_MAP_NOT_FOUND');
  if (!definition.current_version_id) {
    throw new JourneyMapError('This journey map has no working version.', 409, 'JOURNEY_MAP_VERSION_MISSING');
  }
  const version = db.prepare('SELECT * FROM journey_map_versions WHERE id=? AND space_id=?')
    .get(definition.current_version_id, spaceId) as any;
  if (!version) throw new JourneyMapError('This journey map has no working version.', 409, 'JOURNEY_MAP_VERSION_MISSING');
  if (version.state === 'published') {
    throw new JourneyMapError('Published versions are immutable. Create a draft before editing.', 409,
      'JOURNEY_MAP_VERSION_PUBLISHED');
  }
  return { version };
}

/** Optimistic concurrency guard. Every structural write consumes one revision so
 * a stale editor cannot silently overwrite another author's change. */
function bumpDefinition(spaceId: string, definitionId: string, expectedRevision: number) {
  const changed = db.prepare('UPDATE journey_definitions SET revision=revision+1,updated_at=? WHERE id=? AND space_id=? AND revision=?')
    .run(nowIso(), definitionId, spaceId, expectedRevision).changes;
  if (changed !== 1) {
    throw new JourneyMapError(
      'This journey map changed since it was opened. Refresh it before saving.',
      409, 'JOURNEY_MAP_REVISION_CONFLICT', { expectedRevision }
    );
  }
}

function evidenceStatesForVersion(spaceId: string, versionId: string, viewerUserId?: string) {
  const rows = db.prepare(`SELECT link.* FROM journey_evidence_links link
    JOIN journey_map_cards card ON card.id=link.target_id AND card.space_id=link.space_id
    WHERE link.space_id=? AND link.target_type='card' AND card.version_id=?`).all(spaceId, versionId) as any[];
  const byCard = new Map<string, JourneyEvidenceLink[]>();
  for (const row of rows) {
    const stored = rowEvidenceLink(row);
    const link = viewerUserId ? evidenceLinkForViewer(spaceId, viewerUserId, stored) : stored;
    const list = byCard.get(link.targetId) || [];
    list.push(link);
    byCard.set(link.targetId, list);
  }
  return byCard;
}

function evidenceStatesForCardIds(spaceId: string, cardIds: readonly string[], viewerUserId?: string) {
  if (!cardIds.length) return new Map<string, JourneyEvidenceLink[]>();
  const placeholders = cardIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM journey_evidence_links
    WHERE space_id=? AND target_type='card' AND target_id IN (${placeholders})`)
    .all(spaceId, ...cardIds) as any[];
  const byCard = new Map<string, JourneyEvidenceLink[]>();
  for (const row of rows) {
    const stored = rowEvidenceLink(row);
    const link = viewerUserId ? evidenceLinkForViewer(spaceId, viewerUserId, stored) : stored;
    const links = byCard.get(link.targetId) || [];
    links.push(link);
    byCard.set(link.targetId, links);
  }
  return byCard;
}

function journeyCardFromRow(
  row: any,
  linksByCard: ReadonlyMap<string, JourneyEvidenceLink[]>,
  personasEnabled: boolean
): JourneyMapCard {
  const links = linksByCard.get(row.id) || [];
  return {
    id: row.id, stageKey: row.stage_key, laneType: row.lane_type, kind: row.kind, title: row.title,
    content: row.content, ordinal: Number(row.ordinal),
    personaId: personasEnabled ? (row.persona_id || null) : null,
    status: row.status, origin: row.origin,
    evidence: computeEvidenceState(links.map(evidenceFacts)),
    evidenceLinkCount: links.filter((link) => !link.invalidatedAt).length,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

export function getJourneyMap(spaceId: string, definitionId: string, versionId?: string, viewerUserId?: string): JourneyMapReadModel | null {
  const definitionRow = db.prepare('SELECT * FROM journey_definitions WHERE id=? AND space_id=?').get(definitionId, spaceId) as any;
  if (!definitionRow) return null;
  const versions = (db.prepare('SELECT * FROM journey_map_versions WHERE definition_id=? AND space_id=? ORDER BY version_number DESC')
    .all(definitionId, spaceId) as any[]);
  const selected = versionId
    ? versions.find((row) => row.id === versionId)
    : versions.find((row) => row.id === definitionRow.current_version_id) || versions[0];
  if (!selected) return null;
  const definition = rowDefinition(definitionRow, selected.id, viewerUserId);
  const stages = (db.prepare('SELECT * FROM journey_map_stages WHERE version_id=? AND space_id=? ORDER BY ordinal,id')
    .all(selected.id, spaceId) as any[]).map((row): JourneyMapStage => ({
      id: row.id, stageKey: row.stage_key, name: row.name, goal: row.goal, description: row.description, ordinal: Number(row.ordinal)
    }));
  const lanes = (db.prepare('SELECT * FROM journey_map_lanes WHERE version_id=? AND space_id=? ORDER BY ordinal,id')
    .all(selected.id, spaceId) as any[]).map((row): JourneyMapLane => ({
      id: row.id, laneType: row.lane_type, title: row.title, description: row.description,
      ordinal: Number(row.ordinal), visible: Number(row.visible) === 1
    }));
  const features = effectiveSubscriptionForSpace(spaceId).plan.features;
  const linksByCard = features.journeyEvidence
    ? evidenceStatesForVersion(spaceId, selected.id, viewerUserId)
    : new Map<string, JourneyEvidenceLink[]>();
  const cards = (db.prepare('SELECT * FROM journey_map_cards WHERE version_id=? AND space_id=? ORDER BY stage_key,lane_type,ordinal,id')
    .all(selected.id, spaceId) as any[]).map((row): JourneyMapCard => (
    journeyCardFromRow(row, linksByCard, features.journeyPersonas)
  ));
  const personas = features.journeyPersonas
    ? personaRowsForJourneyVersion(spaceId, definitionId, selected.id).map(rowPersona)
    : [];
  const evidenceStateByCardId = new Map(cards.map((card) => [card.id, card.evidence]));
  const evidenceSummary = cards.reduce((totals, card) => {
    totals[card.evidence.state] = (totals[card.evidence.state] || 0) + 1;
    return totals;
  }, {} as Record<JourneyEvidenceState, number>);
  const hiddenEvidenceSummary: Record<JourneyEvidenceState, number> = {
    hypothesis: 0, anecdotal: 0, supported: 0, strongly_supported: 0,
    contradicted: 0, stale: 0, invalidated: 0
  };
  return {
    definition,
    version: {
      ...rowVersionSummary(selected),
      mapType: selected.map_type,
      mode: definition.mode,
      experienceType: selected.experience_type,
      objective: selected.objective,
      industry: selected.industry,
      summary: selected.summary,
      legacyAudience: selected.legacy_audience,
      provenance: parseJson(selected.provenance_json, {} as Record<string, unknown>)
    },
    stages,
    lanes,
    cards,
    personas,
    versions: versions.map(rowVersionSummary),
    researchGaps: features.journeyEvidence ? researchGaps({ stages, cards, evidenceStateByCardId }) : [],
    evidenceSummary: features.journeyEvidence ? evidenceSummary : hiddenEvidenceSummary
  };
}

function insertLanes(versionId: string, spaceId: string, mapType: JourneyMapType) {
  const insert = db.prepare(`INSERT INTO journey_map_lanes (id,version_id,space_id,lane_type,title,description,ordinal,visible)
    VALUES (?,?,?,?,?,?,?,1)`);
  for (const lane of lanesForMapType(mapType)) {
    insert.run(journeyLaneId(versionId, lane.laneType, lane.ordinal), versionId, spaceId, lane.laneType, lane.title, lane.description, lane.ordinal);
  }
}

export type CreateJourneyMapInput = {
  name: string;
  purpose?: string;
  experienceType?: JourneyExperienceType;
  mapType?: JourneyMapType;
  objective?: string;
  industry?: string;
  summary?: string;
  stageNames?: string[];
};

export function createJourneyMap(spaceId: string, userId: string | null, input: CreateJourneyMapInput): JourneyDefinitionSummary {
  assertSubscriptionFeature(spaceId, 'journeyDesign');
  const name = text(input.name, journeyMapLimits.titleChars);
  if (!name) throw new JourneyMapError('A journey map requires a name.', 400, 'JOURNEY_MAP_NAME_REQUIRED');
  const mapType = mapTypeSet.has(String(input.mapType)) ? input.mapType as JourneyMapType : 'current_state';
  const experienceType = experienceTypeSet.has(String(input.experienceType)) ? input.experienceType as JourneyExperienceType : 'customer';
  const stageNames = stringList(input.stageNames, journeyMapLimits.stages);
  // Converted legacy maps are grandfathered: only maps authored after the
  // entitlement release consume the plan allowance.
  assertSubscriptionQuota(spaceId, 'journeyMaps', Number((db.prepare(
    'SELECT COUNT(*) count FROM journey_definitions WHERE space_id=? AND legacy_journey_id IS NULL'
  ).get(spaceId) as any)?.count || 0));
  const now = nowIso();
  const definitionId = crypto.randomUUID();
  const versionId = journeyVersionId(definitionId, 1);
  return db.transaction(() => {
    db.prepare(`INSERT INTO journey_definitions
      (id,space_id,legacy_journey_id,name,purpose,experience_type,map_type,mode,status,owner_user_id,
        current_version_id,published_version_id,review_cadence_days,revision,created_at,updated_at)
      VALUES (?,?,NULL,?,?,?,?,'designed','draft',?,?,NULL,0,1,?,?)`)
      .run(definitionId, spaceId, name, body(input.purpose, journeyMapLimits.contentChars), experienceType, mapType,
        userId, versionId, now, now);
    db.prepare(`INSERT INTO journey_map_versions
      (id,definition_id,space_id,version_number,schema_version,state,map_type,mode,experience_type,objective,industry,
        summary,legacy_audience,provenance_json,source_job_id,author_user_id,published_at,created_at)
      VALUES (?,?,?,1,?, 'draft',?,'designed',?,?,?,?,'',?,NULL,?,NULL,?)`)
      .run(versionId, definitionId, spaceId, JOURNEY_MAP_SCHEMA_VERSION, mapType, experienceType,
        body(input.objective, journeyMapLimits.contentChars), text(input.industry, journeyMapLimits.titleChars),
        body(input.summary, journeyMapLimits.contentChars),
        JSON.stringify({ origin: 'workspace', evidenceBasis: 'workspace_authored', evidenceLevel: 'hypothesis' }),
        userId, now);
    insertLanes(versionId, spaceId, mapType);
    const insertStage = db.prepare(`INSERT INTO journey_map_stages (id,version_id,space_id,stage_key,name,goal,description,ordinal)
      VALUES (?,?,?,?,?,'','',?)`);
    for (const [index, stageName] of stageNames.entries()) {
      const stageKey = journeyStageKey(index, stageName);
      insertStage.run(journeyStageId(versionId, stageKey), versionId, spaceId, stageKey, stageName, index);
    }
    return getJourneyDefinition(spaceId, definitionId)!;
  })();
}

type PublishedTemplateLane = {
  laneType: JourneyLaneKey;
  title: string;
  description: string;
  ordinal: number;
  blueprintOnly?: boolean;
};

type PublishedTemplateCard = {
  laneType: JourneyLaneKey;
  kind: JourneyCardKind;
  title: string;
  content?: string;
};

type PublishedTemplateStage = {
  key: string;
  name: string;
  goal: string;
  cards: PublishedTemplateCard[];
};

/** Copy an exact published template version into a new independent map. The
 * source is resolved again inside the write transaction, not trusted from the
 * route, and the instantiation row makes the source version durable. */
export function createJourneyMapFromTemplate(
  spaceId: string,
  userId: string | null,
  templateVersionId: string,
  nameOverride?: string
) {
  assertSubscriptionFeature(spaceId, 'journeyDesign');
  assertSubscriptionFeature(spaceId, 'journeyTemplates');
  assertSubscriptionQuota(spaceId, 'journeyMaps', Number((db.prepare(
    'SELECT COUNT(*) count FROM journey_definitions WHERE space_id=? AND legacy_journey_id IS NULL'
  ).get(spaceId) as any)?.count || 0));
  const source = db.prepare(`SELECT version.*,template.template_key,template.status template_status,
      template.published_version_id
    FROM journey_template_versions version JOIN journey_templates template ON template.id=version.template_id
    WHERE version.id=? AND version.state='published' AND template.status='active'
      AND template.published_version_id=version.id
      AND (version.scope='system' OR (version.scope='space' AND version.space_id=?))`)
    .get(templateVersionId, spaceId) as any;
  if (!source) {
    throw new JourneyMapError('A published journey template version is required.', 409, 'JOURNEY_TEMPLATE_VERSION_NOT_PUBLISHED');
  }
  const lanes = parseJson(source.lanes_json, [] as PublishedTemplateLane[]);
  const stages = parseJson(source.stages_json, [] as PublishedTemplateStage[]);
  if (!Array.isArray(lanes) || !Array.isArray(stages) || !lanes.length || !stages.length) {
    throw new JourneyMapError('The published journey template is structurally invalid.', 409, 'JOURNEY_TEMPLATE_INVALID');
  }
  if (lanes.length > journeyMapLimits.lanes || stages.length > journeyMapLimits.stages
    || lanes.some((lane) => !isJourneyLaneKey(lane.laneType) || !Number.isInteger(lane.ordinal))) {
    throw new JourneyMapError('The published journey template exceeds map limits.', 409, 'JOURNEY_TEMPLATE_INVALID');
  }
  const effectiveLanes = source.map_type === 'service_blueprint'
    ? lanes
    : lanes.filter((lane) => !lane.blueprintOnly);
  if (!effectiveLanes.length) {
    throw new JourneyMapError('The published journey template has no lanes available for this map type.', 409,
      'JOURNEY_TEMPLATE_INVALID');
  }
  const effectiveLaneTypes = new Set(effectiveLanes.map((lane) => lane.laneType));
  const name = text(nameOverride || source.name, journeyMapLimits.titleChars);
  if (!name) throw new JourneyMapError('A journey map requires a name.', 400, 'JOURNEY_MAP_NAME_REQUIRED');
  const now = nowIso();
  const definitionId = crypto.randomUUID();
  const versionId = journeyVersionId(definitionId, 1);
  return db.transaction(() => {
    // Recheck state under the transaction so a concurrent retirement cannot
    // race a map into existence from an unavailable version.
    const stillPublished = db.prepare(`SELECT 1 FROM journey_template_versions version
      JOIN journey_templates template ON template.id=version.template_id
      WHERE version.id=? AND version.state='published' AND template.status='active'
        AND template.published_version_id=version.id
        AND (version.scope='system' OR (version.scope='space' AND version.space_id=?))`)
      .get(templateVersionId, spaceId);
    if (!stillPublished) {
      throw new JourneyMapError('The journey template was retired before the map could be created.', 409,
        'JOURNEY_TEMPLATE_VERSION_NOT_PUBLISHED');
    }
    db.prepare(`INSERT INTO journey_definitions
      (id,space_id,legacy_journey_id,name,purpose,experience_type,map_type,mode,status,owner_user_id,
        current_version_id,published_version_id,review_cadence_days,revision,created_at,updated_at)
      VALUES (?,?,NULL,?,?,?,?,'designed','draft',?,?,NULL,0,1,?,?)`)
      .run(definitionId, spaceId, name, body(source.description, journeyMapLimits.contentChars),
        source.experience_type, source.map_type, userId, versionId, now, now);
    db.prepare(`INSERT INTO journey_map_versions
      (id,definition_id,space_id,version_number,schema_version,state,map_type,mode,experience_type,objective,industry,
        summary,legacy_audience,provenance_json,source_job_id,author_user_id,published_at,created_at)
      VALUES (?,?,?,1,?,'draft',?,'designed',?,?,?,?,'',?,NULL,?,NULL,?)`)
      .run(versionId, definitionId, spaceId, JOURNEY_MAP_SCHEMA_VERSION, source.map_type, source.experience_type,
        body(source.description, journeyMapLimits.contentChars), text(source.industry, journeyMapLimits.titleChars),
        body(source.description, journeyMapLimits.contentChars), JSON.stringify({
          origin: 'template', templateId: source.template_id, templateVersionId, templateVersionNumber: Number(source.version_number),
          evidenceBasis: 'template_hypothesis', evidenceLevel: 'hypothesis'
        }), userId, now);
    const insertLane = db.prepare(`INSERT INTO journey_map_lanes
      (id,version_id,space_id,lane_type,title,description,ordinal,visible) VALUES (?,?,?,?,?,?,?,1)`);
    for (const [index, lane] of effectiveLanes.entries()) {
      const ordinal = Number.isInteger(lane.ordinal) ? lane.ordinal : index;
      insertLane.run(journeyLaneId(versionId, lane.laneType, ordinal), versionId, spaceId, lane.laneType,
        text(lane.title, journeyMapLimits.titleChars), body(lane.description, journeyMapLimits.contentChars), ordinal);
    }
    const insertStage = db.prepare(`INSERT INTO journey_map_stages
      (id,version_id,space_id,stage_key,name,goal,description,ordinal) VALUES (?,?,?,?,?,?,?,?)`);
    const insertCard = db.prepare(`INSERT INTO journey_map_cards
      (id,version_id,space_id,stage_key,lane_type,kind,title,content,ordinal,persona_id,status,origin,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,NULL,?,'template',?,?)`);
    let totalCards = 0;
    for (const [stageOrdinal, stage] of stages.entries()) {
      const stageKey = text(stage.key, 80);
      if (!stageKey || !Array.isArray(stage.cards)) {
        throw new JourneyMapError('The published journey template has an invalid stage.', 409, 'JOURNEY_TEMPLATE_INVALID');
      }
      insertStage.run(journeyStageId(versionId, stageKey), versionId, spaceId, stageKey,
        text(stage.name, journeyMapLimits.titleChars), text(stage.goal, journeyMapLimits.titleChars), '', stageOrdinal);
      const cellOrdinals = new Map<string, number>();
      for (const card of stage.cards) {
        if (!isJourneyLaneKey(card.laneType) || !journeyCardKinds.includes(card.kind)
          || (isCustomJourneyLane(card.laneType) && card.kind !== 'note')) {
          throw new JourneyMapError('The published journey template has an invalid card.', 409, 'JOURNEY_TEMPLATE_INVALID');
        }
        if (!effectiveLaneTypes.has(card.laneType)) continue;
        totalCards += 1;
        if (totalCards > journeyMapLimits.cards) {
          throw new JourneyMapError('The published journey template has too many cards.', 409, 'JOURNEY_TEMPLATE_INVALID');
        }
        const ordinal = cellOrdinals.get(card.laneType) || 0;
        if (ordinal >= journeyMapLimits.cardsPerCell) {
          throw new JourneyMapError('The published journey template has too many cards in one cell.', 409, 'JOURNEY_TEMPLATE_INVALID');
        }
        cellOrdinals.set(card.laneType, ordinal + 1);
        insertCard.run(journeyCardId(versionId, stageKey, card.laneType, ordinal), versionId, spaceId, stageKey,
          card.laneType, card.kind, text(card.title, journeyMapLimits.titleChars),
          body(card.content, journeyMapLimits.contentChars), ordinal,
          card.kind === 'proposed_measure' ? 'draft' : 'active', now, now);
      }
    }
    db.prepare(`INSERT INTO journey_template_instantiations
      (definition_id,version_id,template_version_id,space_id,created_by_user_id,created_at) VALUES (?,?,?,?,?,?)`)
      .run(definitionId, versionId, templateVersionId, spaceId, userId, now);
    db.prepare(`INSERT INTO journey_template_audit_events
      (id,template_id,template_version_id,space_id,actor_user_id,action,reason,before_json,after_json,created_at)
      VALUES (?,?,?,?,?,'map_created','','{}',?,?)`)
      .run(crypto.randomUUID(), source.template_id, templateVersionId, spaceId, userId,
        JSON.stringify({ definitionId, versionId }), now);
    return { definition: getJourneyDefinition(spaceId, definitionId)!, templateVersionId, versionId };
  })();
}

type LegacyProjectionSnapshot = {
  journey: Journey;
  legacyVersion: JourneyVersion | null;
  versionNumber: number;
};

type LegacySnapshotMetadata = {
  journeyId: string;
  legacyVersionId: string | null;
  reason: JourneyVersion['reason'] | null;
  actor: JourneyVersion['actor'] | null;
  sourceJobId: string | null;
  snapshotUpdatedAt: string;
  legacyVersionCreatedAt: string | null;
  name: string;
  createdAt: string;
  updatedAt: string;
  current: boolean;
};

function assertLegacySourceRowSafe(journey: Journey, spaceId: string) {
  const row = db.prepare('SELECT stages_json,provenance_json FROM journeys WHERE id=? AND space_id=?')
    .get(journey.id, spaceId) as { stages_json: string; provenance_json: string } | undefined;
  if (!row) throw new JourneyMapError('Legacy journey not found.', 404, 'JOURNEY_LEGACY_SOURCE_MISSING');
  try {
    const stages = JSON.parse(String(row.stages_json));
    const provenance = JSON.parse(String(row.provenance_json));
    if (!Array.isArray(stages) || !provenance || typeof provenance !== 'object' || Array.isArray(provenance)) {
      throw new Error('invalid legacy source shape');
    }
  } catch {
    throw new JourneyMapError('The legacy journey source cannot be projected safely.', 409, 'JOURNEY_LEGACY_SOURCE_INVALID');
  }
}

function strictLegacySnapshot(row: any): JourneyVersion {
  let snapshot: Journey;
  try { snapshot = JSON.parse(String(row.snapshot_json)) as Journey; }
  catch { throw new JourneyMapError('A legacy journey snapshot is not valid JSON.', 409, 'JOURNEY_LEGACY_SNAPSHOT_INVALID'); }
  if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.stages)
    || !snapshot.provenance || typeof snapshot.provenance !== 'object' || Array.isArray(snapshot.provenance)
    || String(snapshot.id || '') !== String(row.journey_id)) {
    throw new JourneyMapError('A legacy journey snapshot cannot be projected safely.', 409, 'JOURNEY_LEGACY_SNAPSHOT_INVALID');
  }
  return {
    id: String(row.id), journeyId: String(row.journey_id), reason: row.reason, actor: row.actor,
    sourceJobId: row.source_job_id || null, snapshot,
    snapshotUpdatedAt: String(row.snapshot_updated_at), createdAt: String(row.created_at)
  };
}

/** Oldest-first ordering is the migration contract. `id` is the final tie
 * breaker so a retry cannot renumber versions because a database chose a
 * different physical row order. */
function legacyProjectionSnapshots(journey: Journey): LegacyProjectionSnapshot[] {
  const history = (db.prepare(`SELECT * FROM journey_versions WHERE journey_id=?
    ORDER BY snapshot_updated_at ASC,created_at ASC,id ASC`).all(journey.id) as any[]).map(strictLegacySnapshot);
  return [
    ...history.map((legacyVersion, index) => ({
      journey: legacyVersion.snapshot, legacyVersion, versionNumber: index + 1
    })),
    { journey, legacyVersion: null, versionNumber: history.length + 1 }
  ];
}

function legacySnapshotProvenance(snapshot: LegacyProjectionSnapshot) {
  const legacySnapshot: LegacySnapshotMetadata = {
    journeyId: snapshot.journey.id,
    legacyVersionId: snapshot.legacyVersion?.id || null,
    reason: snapshot.legacyVersion?.reason || null,
    actor: snapshot.legacyVersion?.actor || null,
    sourceJobId: snapshot.legacyVersion?.sourceJobId || null,
    snapshotUpdatedAt: snapshot.legacyVersion?.snapshotUpdatedAt || snapshot.journey.updatedAt,
    legacyVersionCreatedAt: snapshot.legacyVersion?.createdAt || null,
    name: snapshot.journey.name,
    createdAt: snapshot.journey.createdAt,
    updatedAt: snapshot.journey.updatedAt,
    current: snapshot.legacyVersion === null
  };
  return {
    ...snapshot.journey.provenance,
    convertedFrom: 'journey_v1',
    schemaVersion: JOURNEY_MAP_SCHEMA_VERSION,
    legacyProvenance: snapshot.journey.provenance,
    legacySnapshot
  };
}

function insertLegacyProjectionVersion(
  definitionId: string,
  spaceId: string,
  snapshot: LegacyProjectionSnapshot,
  state: 'draft' | 'superseded'
) {
  const draft = convertLegacyJourney(snapshot.journey, snapshot.versionNumber);
  const createdAt = snapshot.legacyVersion?.createdAt || snapshot.journey.updatedAt;
  db.prepare(`INSERT INTO journey_map_versions
    (id,definition_id,space_id,version_number,schema_version,state,map_type,mode,experience_type,objective,industry,
      summary,legacy_audience,provenance_json,source_job_id,author_user_id,published_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?)`)
    .run(draft.versionId, definitionId, spaceId, draft.versionNumber, draft.schemaVersion, state, draft.mapType,
      'designed', draft.experienceType, draft.objective, draft.industry, draft.summary, draft.legacyAudience,
      JSON.stringify(legacySnapshotProvenance(snapshot)), snapshot.legacyVersion?.sourceJobId || null, createdAt);
  const insertStage = db.prepare(`INSERT INTO journey_map_stages (id,version_id,space_id,stage_key,name,goal,description,ordinal)
    VALUES (?,?,?,?,?,?,?,?)`);
  for (const stage of draft.stages) {
    insertStage.run(stage.id, draft.versionId, spaceId, stage.stageKey, stage.name, stage.goal, stage.description, stage.ordinal);
  }
  const insertLane = db.prepare(`INSERT INTO journey_map_lanes (id,version_id,space_id,lane_type,title,description,ordinal,visible)
    VALUES (?,?,?,?,?,?,?,1)`);
  for (const lane of draft.lanes) {
    insertLane.run(lane.id, draft.versionId, spaceId, lane.laneType, lane.title, lane.description, lane.ordinal);
  }
  const insertCard = db.prepare(`INSERT INTO journey_map_cards
    (id,version_id,space_id,stage_key,lane_type,kind,title,content,ordinal,persona_id,status,origin,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,NULL,?,?,?,?)`);
  for (const card of draft.cards) {
    insertCard.run(card.id, draft.versionId, spaceId, card.stageKey, card.laneType, card.kind, card.title,
      card.content, card.ordinal, card.status, card.origin, snapshot.journey.createdAt, snapshot.journey.updatedAt);
  }
  return draft;
}

/** Deterministic, idempotent conversion of one legacy journey, including every
 * retained historical snapshot and its AI-job lineage. Existing projections
 * are deliberately not rewritten: until P1-03 dual-write/shadow-read exists,
 * reconciliation must expose drift rather than overwrite user-authored V2 data. */
export function ensureJourneyMapForLegacyJourney(journey: Journey, spaceId: string): { definitionId: string; created: boolean } {
  assertLegacySourceRowSafe(journey, spaceId);
  const existing = db.prepare('SELECT id FROM journey_definitions WHERE legacy_journey_id=? AND space_id=?')
    .get(journey.id, spaceId) as { id: string } | undefined;
  if (existing) return { definitionId: existing.id, created: false };
  const snapshots = legacyProjectionSnapshots(journey);
  // Convert every snapshot before opening the write transaction. An unsafe
  // historical row therefore leaves no partial definition behind.
  const drafts = snapshots.map((snapshot) => convertLegacyJourney(snapshot.journey, snapshot.versionNumber));
  const currentDraft = drafts.at(-1)!;
  const definitionId = deterministicJourneyId('definition', journey.id);
  return db.transaction(() => {
    db.prepare(`INSERT INTO journey_definitions
      (id,space_id,legacy_journey_id,name,purpose,experience_type,map_type,mode,status,owner_user_id,
        current_version_id,published_version_id,review_cadence_days,revision,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,'designed','draft',NULL,?,NULL,0,1,?,?)`)
      .run(definitionId, spaceId, journey.id, currentDraft.name || 'Untitled journey', currentDraft.objective,
        currentDraft.experienceType, currentDraft.mapType, currentDraft.versionId, journey.createdAt, journey.updatedAt);
    for (const [index, snapshot] of snapshots.entries()) {
      insertLegacyProjectionVersion(definitionId, spaceId, snapshot, index === snapshots.length - 1 ? 'draft' : 'superseded');
    }
    return { definitionId, created: true };
  })();
}

/** Re-materialise an existing legacy-backed definition from the authoritative
 * retained V1 source and history. This primitive is intentionally projection-
 * only: callers must first prove that the projection has no V2-only evidence,
 * persona, or connected-data relationships. It is used by P1-03 dual-write
 * transactions after the source mutation has succeeded, so every generated
 * version corresponds to a real retained legacy snapshot. */
export function refreshJourneyMapForLegacyJourney(
  journey: Journey,
  spaceId: string,
  options: { bumpRevision: boolean }
) {
  assertLegacySourceRowSafe(journey, spaceId);
  const definition = db.prepare(`SELECT id,revision FROM journey_definitions
    WHERE legacy_journey_id=? AND space_id=?`).get(journey.id, spaceId) as { id: string; revision: number } | undefined;
  if (!definition) return ensureJourneyMapForLegacyJourney(journey, spaceId);
  const snapshots = legacyProjectionSnapshots(journey);
  // Validate every source snapshot and all size/shape limits before touching
  // the existing projection. Any conversion failure leaves it byte-for-byte.
  const drafts = snapshots.map((snapshot) => convertLegacyJourney(snapshot.journey, snapshot.versionNumber));
  const currentDraft = drafts.at(-1)!;
  return db.transaction(() => {
    db.prepare('DELETE FROM journey_map_versions WHERE definition_id=? AND space_id=?')
      .run(definition.id, spaceId);
    for (const [index, snapshot] of snapshots.entries()) {
      insertLegacyProjectionVersion(definition.id, spaceId, snapshot,
        index === snapshots.length - 1 ? 'draft' : 'superseded');
    }
    const revisionSql = options.bumpRevision ? 'revision=revision+1,' : '';
    const changed = db.prepare(`UPDATE journey_definitions SET name=?,purpose=?,experience_type=?,map_type=?,mode='designed',
        status='draft',current_version_id=?,published_version_id=NULL,${revisionSql}updated_at=?
      WHERE id=? AND space_id=? AND revision=?`).run(
      currentDraft.name || 'Untitled journey', currentDraft.objective, currentDraft.experienceType,
      currentDraft.mapType, currentDraft.versionId, journey.updatedAt, definition.id, spaceId, definition.revision
    ).changes;
    if (changed !== 1) {
      throw new JourneyMapError('The journey map changed during compatibility projection refresh.', 409,
        'JOURNEY_MAP_REVISION_CONFLICT');
    }
    return { definitionId: definition.id, created: false };
  })();
}

/** The converted map is a rebuildable projection of one legacy journey, so it is
 * discarded explicitly by the caller that deletes the source rather than through
 * a foreign key. The legacy table gains no new referential dependency during the
 * compatibility window, which keeps the pre-tenancy upgrade path intact. */
export function assertLegacyJourneyMapDeletionAllowed(spaceId: string, journeyId: string) {
  const definition = db.prepare('SELECT id FROM journey_definitions WHERE legacy_journey_id=? AND space_id=?')
    .get(journeyId, spaceId) as { id: string } | undefined;
  const suggestionAuditAvailable = db.provider === 'postgres' || Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='journey_ai_suggestion_runs'"
  ).get());
  if (definition && suggestionAuditAvailable && db.prepare(
    'SELECT id FROM journey_ai_suggestion_runs WHERE definition_id=? AND space_id=? LIMIT 1'
  ).get(definition.id, spaceId)) {
    throw new JourneyMapError(
      'This journey has a retained AI suggestion audit. Use the governed privacy purge process before deletion.',
      409,
      'JOURNEY_AI_AUDIT_RETENTION'
    );
  }
}

export function discardJourneyMapForLegacyJourney(spaceId: string, journeyId: string) {
  assertLegacyJourneyMapDeletionAllowed(spaceId, journeyId);
  return db.prepare('DELETE FROM journey_definitions WHERE legacy_journey_id=? AND space_id=?')
    .run(journeyId, spaceId).changes;
}

export type JourneyBackfillReport = {
  reportSchema: 'seemplify.journey-map.legacy-backfill/v1';
  startedAt: string;
  completedAt: string;
  durationMs: number;
  limit: number;
  cursor: string | null;
  nextCursor: string | null;
  completed: boolean;
  spacesProcessed: number;
  journeysExamined: number;
  mapsCreated: number;
  alreadyPresent: number;
  sourceChecksum: string;
  projectionChecksum: string;
  items: Array<{
    spaceId: string;
    journeyId: string;
    definitionId: string | null;
    outcome: 'created' | 'already_present' | 'failed';
    sourceChecksum: string;
    projectionChecksum: string | null;
    matched: boolean;
  }>;
  perSpace: Array<{
    spaceId: string;
    journeysExamined: number;
    mapsCreated: number;
    alreadyPresent: number;
    failures: number;
    sourceChecksum: string;
    projectionChecksum: string;
  }>;
  failures: Array<{
    spaceId: string;
    journeyId: string;
    error: string;
    code: string;
    retryCursor: string | null;
  }>;
  nextPhaseBlocker: { id: 'P1-15'; reason: 'phase_1_release_gates_not_complete' };
};

type JourneyBackfillCursor = { version: 1; spaceId: string; journeyId: string };

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stableValue(item)]));
}

function stableChecksum(value: unknown) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

export function journeyLegacyChecksum(journey: Journey) { return stableChecksum(journey); }

function encodeBackfillCursor(spaceId: string, journeyId: string) {
  return Buffer.from(JSON.stringify({ version: 1, spaceId, journeyId } satisfies JourneyBackfillCursor)).toString('base64url');
}

function decodeBackfillCursor(value: string | undefined): JourneyBackfillCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as JourneyBackfillCursor;
    if (parsed.version !== 1 || !parsed.spaceId || !parsed.journeyId) throw new Error('invalid cursor');
    return parsed;
  } catch {
    throw new JourneyMapError('Invalid journey backfill cursor.', 400, 'JOURNEY_BACKFILL_CURSOR_INVALID');
  }
}

/** Deterministically bounded and resumable by `(space_id,journey_id)`. Failed
 * rows advance the main cursor so later spaces still run, while each failure
 * carries the cursor immediately before it for a targeted retry after repair. */
export function backfillJourneyMaps(options: { spaceIds?: string[]; limit?: number; cursor?: string } = {}): JourneyBackfillReport {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const requestedSpaces = [...new Set((options.spaceIds || []).map(String).filter(Boolean))].sort();
  const limit = Math.max(1, Math.min(500, Math.floor(Number(options.limit ?? 100)) || 100));
  const cursor = decodeBackfillCursor(options.cursor);
  const where: string[] = [];
  const parameters: unknown[] = [];
  if (requestedSpaces.length) {
    where.push(`space_id IN (${requestedSpaces.map(() => '?').join(',')})`);
    parameters.push(...requestedSpaces);
  }
  if (cursor) {
    where.push('(space_id>? OR (space_id=? AND id>?))');
    parameters.push(cursor.spaceId, cursor.spaceId, cursor.journeyId);
  }
  const selected = db.prepare(`SELECT id,space_id FROM journeys${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
    ORDER BY space_id ASC,id ASC LIMIT ?`).all(...parameters, limit + 1) as Array<{ id: string; space_id: string }>;
  const hasMore = selected.length > limit;
  const rows = selected.slice(0, limit);
  const failures: JourneyBackfillReport['failures'] = [];
  const items: JourneyBackfillReport['items'] = [];
  let previousCursor = options.cursor || null;
  let mapsCreated = 0;
  let alreadyPresent = 0;
  for (const row of rows) {
    const journey = getJourney(row.id, row.space_id);
    if (!journey) continue;
    const sourceChecksum = journeyLegacyChecksum(journey);
    let createdDefinitionId: string | null = null;
    try {
      const result = ensureJourneyMapForLegacyJourney(journey, row.space_id);
      if (result.created) createdDefinitionId = result.definitionId;
      const reconciliation = reconcileJourneyMap(row.space_id, journey.id);
      if (!reconciliation.matched) {
        throw new JourneyMapError('The derived journey map does not reconcile with its legacy source.', 409,
          'JOURNEY_BACKFILL_RECONCILIATION_FAILED', { differences: reconciliation.differences });
      }
      if (result.created && (!reconciliation.noFabricatedEvidence || !reconciliation.noFabricatedPersonas
        || !reconciliation.noFabricatedConnectedData)) {
        throw new JourneyMapError('The derived journey map introduced unsupported migration data.', 409,
          'JOURNEY_BACKFILL_FABRICATED_DATA');
      }
      if (result.created) mapsCreated += 1; else alreadyPresent += 1;
      items.push({
        spaceId: row.space_id, journeyId: journey.id, definitionId: result.definitionId,
        outcome: result.created ? 'created' : 'already_present', sourceChecksum,
        projectionChecksum: reconciliation.projectionChecksum, matched: true
      });
    } catch (error) {
      // A newly inserted projection is disposable until reconciliation passes.
      // Existing maps are never deleted by a failed audit.
      if (createdDefinitionId) discardJourneyMapForLegacyJourney(row.space_id, journey.id);
      const candidate = error as { code?: unknown; message?: unknown };
      const message = String(candidate?.message || error || 'Journey backfill failed.').replace(/\s+/gu, ' ').slice(0, 500);
      failures.push({
        spaceId: row.space_id, journeyId: journey.id, error: message,
        code: String(candidate?.code || 'JOURNEY_BACKFILL_FAILED').slice(0, 100), retryCursor: previousCursor
      });
      items.push({
        spaceId: row.space_id, journeyId: journey.id, definitionId: null, outcome: 'failed',
        sourceChecksum, projectionChecksum: null, matched: false
      });
    }
    previousCursor = encodeBackfillCursor(row.space_id, row.id);
  }
  const spaces = [...new Set(items.map((item) => item.spaceId))];
  const perSpace = spaces.map((spaceId) => {
    const scoped = items.filter((item) => item.spaceId === spaceId);
    return {
      spaceId,
      journeysExamined: scoped.length,
      mapsCreated: scoped.filter((item) => item.outcome === 'created').length,
      alreadyPresent: scoped.filter((item) => item.outcome === 'already_present').length,
      failures: scoped.filter((item) => item.outcome === 'failed').length,
      sourceChecksum: stableChecksum(scoped.map((item) => [item.journeyId, item.sourceChecksum])),
      projectionChecksum: stableChecksum(scoped.map((item) => [item.journeyId, item.projectionChecksum]))
    };
  });
  const completedAt = new Date().toISOString();
  return {
    reportSchema: 'seemplify.journey-map.legacy-backfill/v1',
    startedAt, completedAt, durationMs: Math.max(0, Date.parse(completedAt) - started), limit,
    cursor: options.cursor || null,
    nextCursor: hasMore && rows.length ? encodeBackfillCursor(rows.at(-1)!.space_id, rows.at(-1)!.id) : null,
    completed: !hasMore,
    spacesProcessed: spaces.length,
    journeysExamined: items.length,
    mapsCreated,
    alreadyPresent,
    sourceChecksum: stableChecksum(items.map((item) => [item.spaceId, item.journeyId, item.sourceChecksum])),
    projectionChecksum: stableChecksum(items.map((item) => [item.spaceId, item.journeyId, item.projectionChecksum])),
    items,
    perSpace,
    failures,
    nextPhaseBlocker: { id: 'P1-15', reason: 'phase_1_release_gates_not_complete' }
  };
}

/** Read compatibility adapter: renders a Map 2.0 version back into the legacy
 * `Journey` shape. Used by reconciliation and by any client still on v1 during
 * the agreed compatibility window. */
export function legacyJourneyFromMap(map: JourneyMapReadModel): Omit<Journey, 'provenance'> & { provenance: Record<string, unknown> } {
  const cardsByCell = new Map<string, string[]>();
  for (const card of map.cards) {
    const cell = `${card.stageKey}|${card.laneType}`;
    const list = cardsByCell.get(cell) || [];
    list.push(card.content || card.title);
    cardsByCell.set(cell, list);
  }
  const cell = (stageKey: string, laneType: JourneyLaneType) => cardsByCell.get(`${stageKey}|${laneType}`) || [];
  const snapshot = map.version.provenance.legacySnapshot && typeof map.version.provenance.legacySnapshot === 'object'
    ? map.version.provenance.legacySnapshot as Partial<LegacySnapshotMetadata>
    : null;
  const legacyProvenance = map.version.provenance.legacyProvenance
    && typeof map.version.provenance.legacyProvenance === 'object'
    ? map.version.provenance.legacyProvenance as Record<string, unknown>
    : Object.fromEntries(Object.entries(map.version.provenance)
      .filter(([key]) => !['convertedFrom', 'schemaVersion', 'legacySnapshot'].includes(key)));
  return {
    id: map.definition.legacyJourneyId || map.definition.id,
    name: String(snapshot?.name ?? map.definition.name),
    audience: map.version.legacyAudience,
    objective: map.version.objective,
    industry: map.version.industry,
    summary: map.version.summary,
    stages: map.stages.map((stage) => ({
      name: stage.name,
      goal: stage.goal,
      touchpoints: cell(stage.stageKey, 'touchpoints'),
      customerActions: cell(stage.stageKey, 'customer_actions'),
      emotions: cell(stage.stageKey, 'emotions'),
      painPoints: cell(stage.stageKey, 'pain_points'),
      metrics: cell(stage.stageKey, 'metrics'),
      opportunities: cell(stage.stageKey, 'opportunities'),
      recommendedActions: cell(stage.stageKey, 'initiatives')
    })),
    provenance: legacyProvenance,
    createdAt: String(snapshot?.createdAt ?? map.definition.createdAt),
    updatedAt: String(snapshot?.updatedAt ?? map.definition.updatedAt)
  };
}

export type JourneyReconciliation = {
  journeyId: string;
  definitionId: string | null;
  matched: boolean;
  differences: string[];
  sourceChecksum: string;
  projectionChecksum: string | null;
  sourceVersionCount: number;
  projectionVersionCount: number;
  noFabricatedEvidence: boolean;
  noFabricatedPersonas: boolean;
  noFabricatedConnectedData: boolean;
};

/** Field-level comparison between a legacy journey and its converted map. The
 * migration is only allowed to proceed while this reports no differences. */
export function reconcileJourneyMap(spaceId: string, journeyId: string): JourneyReconciliation {
  const journey = getJourney(journeyId, spaceId);
  const empty = {
    sourceChecksum: journey ? journeyLegacyChecksum(journey) : stableChecksum(null), projectionChecksum: null,
    sourceVersionCount: 0, projectionVersionCount: 0,
    noFabricatedEvidence: false, noFabricatedPersonas: false, noFabricatedConnectedData: false
  };
  if (!journey) return { journeyId, definitionId: null, matched: false, differences: ['legacy_journey_missing'], ...empty };
  const row = db.prepare('SELECT id FROM journey_definitions WHERE legacy_journey_id=? AND space_id=?')
    .get(journeyId, spaceId) as { id: string } | undefined;
  if (!row) return { journeyId, definitionId: null, matched: false, differences: ['journey_map_missing'], ...empty };
  const map = getJourneyMap(spaceId, row.id);
  if (!map) return { journeyId, definitionId: row.id, matched: false, differences: ['journey_map_version_missing'], ...empty };
  const snapshots = legacyProjectionSnapshots(journey);
  const differences: string[] = [];
  const compare = (field: string, left: unknown, right: unknown) => {
    if (JSON.stringify(stableValue(left)) !== JSON.stringify(stableValue(right))) differences.push(field);
  };
  compare('definition_name', map.definition.name, journey.name);
  compare('definition_created_at', map.definition.createdAt, journey.createdAt);
  compare('definition_updated_at', map.definition.updatedAt, journey.updatedAt);
  compare('definition_owner', map.definition.ownerUserId, null);
  compare('version_count', map.versions.length, snapshots.length);
  const renderedVersions: Journey[] = [];
  for (const snapshot of snapshots) {
    const expectedDraft = convertLegacyJourney(snapshot.journey, snapshot.versionNumber);
    const projected = getJourneyMap(spaceId, row.id, expectedDraft.versionId);
    if (!projected) {
      differences.push(`version_missing:${snapshot.versionNumber}`);
      continue;
    }
    const rendered = legacyJourneyFromMap(projected) as unknown as Journey;
    renderedVersions.push(rendered);
    compare(`version:${snapshot.versionNumber}:legacy_read`, rendered, snapshot.journey);
    compare(`version:${snapshot.versionNumber}:id`, projected.version.id, expectedDraft.versionId);
    compare(`version:${snapshot.versionNumber}:state`, projected.version.state,
      snapshot.legacyVersion ? 'superseded' : 'draft');
    compare(`version:${snapshot.versionNumber}:source_job_id`, projected.version.sourceJobId,
      snapshot.legacyVersion?.sourceJobId || null);
    compare(`version:${snapshot.versionNumber}:created_at`, projected.version.createdAt,
      snapshot.legacyVersion?.createdAt || snapshot.journey.updatedAt);
    const metadata = projected.version.provenance.legacySnapshot as Partial<LegacySnapshotMetadata> | undefined;
    compare(`version:${snapshot.versionNumber}:legacy_version_id`, metadata?.legacyVersionId ?? null,
      snapshot.legacyVersion?.id || null);
    compare(`version:${snapshot.versionNumber}:legacy_reason`, metadata?.reason ?? null,
      snapshot.legacyVersion?.reason || null);
    compare(`version:${snapshot.versionNumber}:legacy_actor`, metadata?.actor ?? null,
      snapshot.legacyVersion?.actor || null);
    compare(`version:${snapshot.versionNumber}:snapshot_updated_at`, metadata?.snapshotUpdatedAt,
      snapshot.legacyVersion?.snapshotUpdatedAt || snapshot.journey.updatedAt);
    compare(`version:${snapshot.versionNumber}:legacy_version_created_at`, metadata?.legacyVersionCreatedAt ?? null,
      snapshot.legacyVersion?.createdAt || null);
    compare(`version:${snapshot.versionNumber}:source_provenance`, projected.version.provenance.legacyProvenance,
      snapshot.journey.provenance);
    compare(`version:${snapshot.versionNumber}:stage_ids`, projected.stages.map((stage) => stage.id),
      expectedDraft.stages.map((stage) => stage.id));
    compare(`version:${snapshot.versionNumber}:lane_ids`, projected.lanes.map((lane) => lane.id),
      expectedDraft.lanes.map((lane) => lane.id));
    compare(`version:${snapshot.versionNumber}:card_ids`, projected.cards.map((card) => card.id).sort(),
      expectedDraft.cards.map((card) => card.id).sort());
  }
  const versionIds = map.versions.map((version) => version.id);
  const placeholders = versionIds.map(() => '?').join(',');
  const evidenceCount = versionIds.length ? Number((db.prepare(`SELECT COUNT(*) count FROM journey_evidence_links
    WHERE space_id=? AND (target_id=? OR target_id IN (SELECT id FROM journey_map_stages WHERE version_id IN (${placeholders}))
      OR target_id IN (SELECT id FROM journey_map_cards WHERE version_id IN (${placeholders})))`)
    .get(spaceId, row.id, ...versionIds, ...versionIds) as any)?.count || 0) : 0;
  const personaCount = Number((db.prepare('SELECT COUNT(*) count FROM journey_definition_personas WHERE definition_id=? AND space_id=?')
    .get(row.id, spaceId) as any)?.count || 0);
  const connectedRows = Number((db.prepare(`SELECT COUNT(*) count FROM journey_map_versions
    WHERE definition_id=? AND space_id=? AND mode='connected'`).get(row.id, spaceId) as any)?.count || 0);
  const noFabricatedEvidence = evidenceCount === 0;
  const noFabricatedPersonas = personaCount === 0;
  const noFabricatedConnectedData = connectedRows === 0;
  // These are reported independently from source/projection equivalence. A
  // fresh backfill must keep all three true, but an operator may legitimately
  // attach evidence or personas after conversion without corrupting the legacy
  // compatibility read.
  return {
    journeyId,
    definitionId: row.id,
    matched: differences.length === 0,
    differences,
    sourceChecksum: stableChecksum(snapshots.map((snapshot) => snapshot.journey)),
    projectionChecksum: stableChecksum(renderedVersions),
    sourceVersionCount: snapshots.length,
    projectionVersionCount: map.versions.length,
    noFabricatedEvidence,
    noFabricatedPersonas,
    noFabricatedConnectedData
  };
}

function structuralGuard(spaceId: string, versionId: string) {
  const stages = (db.prepare('SELECT stage_key,name,ordinal FROM journey_map_stages WHERE version_id=? AND space_id=?')
    .all(versionId, spaceId) as Array<{ stage_key: string; name: string; ordinal: number }>)
    .map((row) => ({ stageKey: row.stage_key, name: row.name, ordinal: Number(row.ordinal) }));
  const lanes = (db.prepare('SELECT lane_type,ordinal FROM journey_map_lanes WHERE version_id=? AND space_id=?')
    .all(versionId, spaceId) as Array<{ lane_type: string; ordinal: number }>)
    .map((row) => ({ laneType: row.lane_type, ordinal: Number(row.ordinal) }));
  const cards = (db.prepare('SELECT stage_key,lane_type,title,content FROM journey_map_cards WHERE version_id=? AND space_id=?')
    .all(versionId, spaceId) as Array<{ stage_key: string; lane_type: string; title: string; content: string }>)
    .map((row) => ({ stageKey: row.stage_key, laneType: row.lane_type, title: row.title, content: row.content }));
  const issues = validateJourneyStructure({ stages, lanes, cards });
  if (issues.length) {
    throw new JourneyMapError(issues[0].message, 422, issues[0].code, { issues });
  }
}

export type StageWriteInput = { name: string; goal?: string; description?: string };

export function addJourneyStage(
  spaceId: string, definitionId: string, expectedRevision: number, input: StageWriteInput, viewerUserId?: string
) {
  const { version } = requireEditableVersion(spaceId, definitionId);
  const name = text(input.name, journeyMapLimits.titleChars);
  if (!name) throw new JourneyMapError('A stage requires a name.', 400, 'JOURNEY_STAGE_NAME_REQUIRED');
  return db.transaction(() => {
    bumpDefinition(spaceId, definitionId, expectedRevision);
    const existing = db.prepare('SELECT stage_key FROM journey_map_stages WHERE version_id=? AND space_id=? ORDER BY ordinal,id')
      .all(version.id, spaceId) as Array<{ stage_key: string }>;
    if (existing.length >= journeyMapLimits.stages) {
      throw new JourneyMapError(`A journey map supports at most ${journeyMapLimits.stages} stages.`, 422, 'JOURNEY_STAGE_LIMIT');
    }
    const ordinal = existing.length;
    let stageKey = journeyStageKey(ordinal, name);
    const taken = new Set(existing.map((row) => row.stage_key));
    // Keys stay stable once assigned, so a rename collision only needs a
    // deterministic suffix rather than a rewrite of the whole version.
    for (let suffix = 2; taken.has(stageKey); suffix += 1) stageKey = `${journeyStageKey(ordinal, name)}-${suffix}`;
    db.prepare('INSERT INTO journey_map_stages (id,version_id,space_id,stage_key,name,goal,description,ordinal) VALUES (?,?,?,?,?,?,?,?)')
      .run(journeyStageId(version.id, stageKey), version.id, spaceId, stageKey, name,
        text(input.goal, journeyMapLimits.titleChars), body(input.description, journeyMapLimits.contentChars), ordinal);
    structuralGuard(spaceId, version.id);
    return getJourneyMap(spaceId, definitionId, undefined, viewerUserId)!;
  })();
}

export function updateJourneyStage(
  spaceId: string, definitionId: string, expectedRevision: number, stageKey: string, input: Partial<StageWriteInput>,
  viewerUserId?: string
) {
  const { version } = requireEditableVersion(spaceId, definitionId);
  return db.transaction(() => {
    bumpDefinition(spaceId, definitionId, expectedRevision);
    const current = db.prepare('SELECT * FROM journey_map_stages WHERE version_id=? AND space_id=? AND stage_key=?')
      .get(version.id, spaceId, stageKey) as any;
    if (!current) throw new JourneyMapError('Stage not found.', 404, 'JOURNEY_STAGE_NOT_FOUND');
    const name = input.name === undefined ? current.name : text(input.name, journeyMapLimits.titleChars);
    if (!name) throw new JourneyMapError('A stage requires a name.', 400, 'JOURNEY_STAGE_NAME_REQUIRED');
    db.prepare('UPDATE journey_map_stages SET name=?,goal=?,description=? WHERE id=? AND space_id=?')
      .run(name,
        input.goal === undefined ? current.goal : text(input.goal, journeyMapLimits.titleChars),
        input.description === undefined ? current.description : body(input.description, journeyMapLimits.contentChars),
        current.id, spaceId);
    // The stage-goal lane is the editable card representation of the same
    // value. Keep the denormalised cell in lockstep so legacy compatibility
    // reads and Map 2.0 edits cannot silently disagree.
    if (input.goal !== undefined) {
      const goal = text(input.goal, journeyMapLimits.titleChars);
      const existingGoals = db.prepare(`SELECT id FROM journey_map_cards
        WHERE version_id=? AND space_id=? AND stage_key=? AND lane_type='stage_goal'
        ORDER BY ordinal,id`).all(version.id, spaceId, stageKey) as Array<{ id: string }>;
      if (!goal) {
        db.prepare(`DELETE FROM journey_map_cards
          WHERE version_id=? AND space_id=? AND stage_key=? AND lane_type='stage_goal'`)
          .run(version.id, spaceId, stageKey);
      } else if (existingGoals.length) {
        db.prepare(`UPDATE journey_map_cards SET kind='goal',title=?,content='',ordinal=0,persona_id=NULL,
            status='active',updated_at=? WHERE id=? AND space_id=?`)
          .run(goal, nowIso(), existingGoals[0].id, spaceId);
        for (const duplicate of existingGoals.slice(1)) {
          db.prepare('DELETE FROM journey_map_cards WHERE id=? AND space_id=?').run(duplicate.id, spaceId);
        }
      } else {
        const now = nowIso();
        db.prepare(`INSERT INTO journey_map_cards
          (id,version_id,space_id,stage_key,lane_type,kind,title,content,ordinal,persona_id,status,origin,created_at,updated_at)
          VALUES (?,?,?,?,?,'goal',?,'',0,NULL,'active','workspace',?,?)`)
          .run(journeyCardId(version.id, stageKey, 'stage_goal', 0), version.id, spaceId, stageKey,
            'stage_goal', goal, now, now);
      }
    }
    structuralGuard(spaceId, version.id);
    return getJourneyMap(spaceId, definitionId, undefined, viewerUserId)!;
  })();
}

export function deleteJourneyStage(
  spaceId: string, definitionId: string, expectedRevision: number, stageKey: string, viewerUserId?: string
) {
  const { version } = requireEditableVersion(spaceId, definitionId);
  return db.transaction(() => {
    bumpDefinition(spaceId, definitionId, expectedRevision);
    const removed = db.prepare('DELETE FROM journey_map_stages WHERE version_id=? AND space_id=? AND stage_key=?')
      .run(version.id, spaceId, stageKey).changes;
    if (!removed) throw new JourneyMapError('Stage not found.', 404, 'JOURNEY_STAGE_NOT_FOUND');
    // Cards live in a cell addressed by stage key, so removing the stage must
    // remove them explicitly; there is no row-level foreign key to cascade.
    db.prepare('DELETE FROM journey_map_cards WHERE version_id=? AND space_id=? AND stage_key=?')
      .run(version.id, spaceId, stageKey);
    const remaining = db.prepare('SELECT id FROM journey_map_stages WHERE version_id=? AND space_id=? ORDER BY ordinal,id')
      .all(version.id, spaceId) as Array<{ id: string }>;
    const setOrdinal = db.prepare('UPDATE journey_map_stages SET ordinal=? WHERE id=? AND space_id=?');
    for (const [index, row] of remaining.entries()) setOrdinal.run(index, row.id, spaceId);
    return getJourneyMap(spaceId, definitionId, undefined, viewerUserId)!;
  })();
}

export function moveJourneyStage(
  spaceId: string, definitionId: string, expectedRevision: number, stageKey: string, toOrdinal: number, viewerUserId?: string
) {
  const { version } = requireEditableVersion(spaceId, definitionId);
  return db.transaction(() => {
    bumpDefinition(spaceId, definitionId, expectedRevision);
    const rows = db.prepare('SELECT id,stage_key FROM journey_map_stages WHERE version_id=? AND space_id=? ORDER BY ordinal,id')
      .all(version.id, spaceId) as Array<{ id: string; stage_key: string }>;
    const from = rows.findIndex((row) => row.stage_key === stageKey);
    if (from < 0) throw new JourneyMapError('Stage not found.', 404, 'JOURNEY_STAGE_NOT_FOUND');
    const reordered = moveOrdinal(rows, from, toOrdinal);
    const setOrdinal = db.prepare('UPDATE journey_map_stages SET ordinal=? WHERE id=? AND space_id=?');
    for (const [index, row] of reordered.entries()) setOrdinal.run(index, row.id, spaceId);
    return getJourneyMap(spaceId, definitionId, undefined, viewerUserId)!;
  })();
}

export type JourneyLaneWriteInput = {
  laneKey?: string;
  title: string;
  description?: string;
};

function allocateCustomLaneKey(versionId: string, spaceId: string, requestedKey: string | undefined, title: string) {
  if (requestedKey !== undefined) {
    if (!isCustomJourneyLaneKey(requestedKey)) {
      throw new JourneyMapError(
        'Custom lane keys must start with custom_ and contain only lowercase letters, numbers, underscores, or hyphens.',
        400, 'JOURNEY_LANE_KEY_INVALID'
      );
    }
    const exists = db.prepare('SELECT 1 FROM journey_map_lanes WHERE version_id=? AND space_id=? AND lane_type=?')
      .get(versionId, spaceId, requestedKey);
    if (exists) throw new JourneyMapError('That custom lane key is already in use.', 409, 'JOURNEY_LANE_KEY_TAKEN');
    return requestedKey;
  }
  const base = journeyCustomLaneKey(title);
  const exists = (candidate: string) => Boolean(db.prepare(
    'SELECT 1 FROM journey_map_lanes WHERE version_id=? AND space_id=? AND lane_type=?'
  ).get(versionId, spaceId, candidate));
  if (!exists(base)) return base;
  for (let suffix = 2; suffix <= journeyMapLimits.lanes + 1; suffix += 1) {
    const tail = `_${suffix}`;
    const stem = base.slice(0, 63 - tail.length).replace(/[_-]+$/gu, '');
    const candidate = `${stem}${tail}`;
    if (!exists(candidate)) return candidate;
  }
  throw new JourneyMapError('A stable key could not be allocated for this lane.', 409, 'JOURNEY_LANE_KEY_TAKEN');
}

export function addJourneyLane(
  spaceId: string, definitionId: string, expectedRevision: number, input: JourneyLaneWriteInput,
  viewerUserId?: string
) {
  assertSubscriptionFeature(spaceId, 'journeyDesign');
  const { version } = requireEditableVersion(spaceId, definitionId);
  const laneTitle = text(input.title, journeyMapLimits.titleChars);
  if (!laneTitle) throw new JourneyMapError('A lane requires a title.', 400, 'JOURNEY_LANE_TITLE_REQUIRED');
  return db.transaction(() => {
    bumpDefinition(spaceId, definitionId, expectedRevision);
    const lanes = db.prepare('SELECT id,lane_type FROM journey_map_lanes WHERE version_id=? AND space_id=? ORDER BY ordinal,id')
      .all(version.id, spaceId) as Array<{ id: string; lane_type: string }>;
    if (lanes.length >= journeyMapLimits.lanes) {
      throw new JourneyMapError(`A journey map supports at most ${journeyMapLimits.lanes} lanes.`, 422, 'JOURNEY_LANE_LIMIT');
    }
    const laneKey = allocateCustomLaneKey(version.id, spaceId, input.laneKey, laneTitle);
    const ordinal = lanes.length;
    db.prepare(`INSERT INTO journey_map_lanes
      (id,version_id,space_id,lane_type,title,description,ordinal,visible) VALUES (?,?,?,?,?,?,?,1)`)
      .run(journeyLaneId(version.id, laneKey, ordinal), version.id, spaceId, laneKey, laneTitle,
        body(input.description, journeyMapLimits.contentChars), ordinal);
    structuralGuard(spaceId, version.id);
    return getJourneyMap(spaceId, definitionId, undefined, viewerUserId)!;
  })();
}

export function updateJourneyLane(
  spaceId: string, definitionId: string, expectedRevision: number, laneKey: string,
  input: { title?: string; description?: string }, viewerUserId?: string
) {
  assertSubscriptionFeature(spaceId, 'journeyDesign');
  if (!isJourneyLaneKey(laneKey)) throw new JourneyMapError('Unknown lane key.', 400, 'JOURNEY_LANE_KEY_INVALID');
  if (input.title === undefined && input.description === undefined) {
    throw new JourneyMapError('A lane update requires a title or description.', 400, 'JOURNEY_LANE_UPDATE_EMPTY');
  }
  const { version } = requireEditableVersion(spaceId, definitionId);
  return db.transaction(() => {
    bumpDefinition(spaceId, definitionId, expectedRevision);
    const current = db.prepare('SELECT * FROM journey_map_lanes WHERE version_id=? AND space_id=? AND lane_type=?')
      .get(version.id, spaceId, laneKey) as any;
    if (!current) throw new JourneyMapError('Lane not found.', 404, 'JOURNEY_LANE_NOT_FOUND');
    const laneTitle = input.title === undefined ? current.title : text(input.title, journeyMapLimits.titleChars);
    if (!laneTitle) throw new JourneyMapError('A lane requires a title.', 400, 'JOURNEY_LANE_TITLE_REQUIRED');
    db.prepare('UPDATE journey_map_lanes SET title=?,description=? WHERE id=? AND version_id=? AND space_id=?')
      .run(laneTitle,
        input.description === undefined ? current.description : body(input.description, journeyMapLimits.contentChars),
        current.id, version.id, spaceId);
    structuralGuard(spaceId, version.id);
    return getJourneyMap(spaceId, definitionId, undefined, viewerUserId)!;
  })();
}

export function setJourneyLaneVisibility(
  spaceId: string, definitionId: string, expectedRevision: number, laneKey: string, visible: boolean,
  viewerUserId?: string
) {
  assertSubscriptionFeature(spaceId, 'journeyDesign');
  if (!isJourneyLaneKey(laneKey)) throw new JourneyMapError('Unknown lane key.', 400, 'JOURNEY_LANE_KEY_INVALID');
  const { version } = requireEditableVersion(spaceId, definitionId);
  return db.transaction(() => {
    bumpDefinition(spaceId, definitionId, expectedRevision);
    const changed = db.prepare(`UPDATE journey_map_lanes SET visible=?
      WHERE version_id=? AND space_id=? AND lane_type=?`)
      .run(visible ? 1 : 0, version.id, spaceId, laneKey).changes;
    if (!changed) throw new JourneyMapError('Lane not found.', 404, 'JOURNEY_LANE_NOT_FOUND');
    return getJourneyMap(spaceId, definitionId, undefined, viewerUserId)!;
  })();
}

export function moveJourneyLane(
  spaceId: string, definitionId: string, expectedRevision: number, laneKey: string, toOrdinal: number,
  viewerUserId?: string
) {
  assertSubscriptionFeature(spaceId, 'journeyDesign');
  if (!isJourneyLaneKey(laneKey)) throw new JourneyMapError('Unknown lane key.', 400, 'JOURNEY_LANE_KEY_INVALID');
  const { version } = requireEditableVersion(spaceId, definitionId);
  return db.transaction(() => {
    bumpDefinition(spaceId, definitionId, expectedRevision);
    const rows = db.prepare('SELECT id,lane_type FROM journey_map_lanes WHERE version_id=? AND space_id=? ORDER BY ordinal,id')
      .all(version.id, spaceId) as Array<{ id: string; lane_type: string }>;
    const from = rows.findIndex((row) => row.lane_type === laneKey);
    if (from < 0) throw new JourneyMapError('Lane not found.', 404, 'JOURNEY_LANE_NOT_FOUND');
    const reordered = moveOrdinal(rows, from, toOrdinal);
    const setOrdinal = db.prepare('UPDATE journey_map_lanes SET ordinal=? WHERE id=? AND version_id=? AND space_id=?');
    for (const [index, row] of reordered.entries()) setOrdinal.run(index, row.id, version.id, spaceId);
    structuralGuard(spaceId, version.id);
    return getJourneyMap(spaceId, definitionId, undefined, viewerUserId)!;
  })();
}

/** Deletion intentionally fails closed. A future explicit migration endpoint
 * can move or remove cards, but this primitive will never discard them as an
 * incidental consequence of deleting a lane. */
export function deleteJourneyLane(
  spaceId: string, definitionId: string, expectedRevision: number, laneKey: string, viewerUserId?: string
) {
  assertSubscriptionFeature(spaceId, 'journeyDesign');
  if (!isJourneyLaneKey(laneKey)) throw new JourneyMapError('Unknown lane key.', 400, 'JOURNEY_LANE_KEY_INVALID');
  if (!isCustomJourneyLaneKey(laneKey)) {
    throw new JourneyMapError('Built-in lanes can be hidden but not deleted.', 422, 'JOURNEY_LANE_BUILT_IN');
  }
  const { version } = requireEditableVersion(spaceId, definitionId);
  return db.transaction(() => {
    bumpDefinition(spaceId, definitionId, expectedRevision);
    const lane = db.prepare('SELECT id FROM journey_map_lanes WHERE version_id=? AND space_id=? AND lane_type=?')
      .get(version.id, spaceId, laneKey) as { id: string } | undefined;
    if (!lane) throw new JourneyMapError('Lane not found.', 404, 'JOURNEY_LANE_NOT_FOUND');
    const cardCount = Number((db.prepare(`SELECT COUNT(*) count FROM journey_map_cards
      WHERE version_id=? AND space_id=? AND lane_type=?`).get(version.id, spaceId, laneKey) as any)?.count || 0);
    if (cardCount > 0) {
      throw new JourneyMapError(
        'Remove or move every card before deleting this lane.', 409, 'JOURNEY_LANE_NOT_EMPTY', { cardCount }
      );
    }
    db.prepare('DELETE FROM journey_map_lanes WHERE id=? AND version_id=? AND space_id=?')
      .run(lane.id, version.id, spaceId);
    const remaining = db.prepare('SELECT id FROM journey_map_lanes WHERE version_id=? AND space_id=? ORDER BY ordinal,id')
      .all(version.id, spaceId) as Array<{ id: string }>;
    const setOrdinal = db.prepare('UPDATE journey_map_lanes SET ordinal=? WHERE id=? AND version_id=? AND space_id=?');
    for (const [index, row] of remaining.entries()) setOrdinal.run(index, row.id, version.id, spaceId);
    structuralGuard(spaceId, version.id);
    return getJourneyMap(spaceId, definitionId, undefined, viewerUserId)!;
  })();
}

export type CardWriteInput = {
  stageKey: string;
  laneType?: JourneyLaneKey;
  kind: JourneyCardKind;
  title: string;
  content?: string;
  personaId?: string | null;
  status?: 'draft' | 'active' | 'retired';
};

export function addJourneyCard(
  spaceId: string, definitionId: string, expectedRevision: number, input: CardWriteInput, viewerUserId?: string
) {
  if (input.personaId) assertSubscriptionFeature(spaceId, 'journeyPersonas');
  const { version } = requireEditableVersion(spaceId, definitionId);
  if (!cardKindSet.has(String(input.kind))) throw new JourneyMapError('Unknown card kind.', 400, 'JOURNEY_CARD_KIND_UNKNOWN');
  if (input.laneType !== undefined && !isJourneyLaneKey(input.laneType)) {
    throw new JourneyMapError('Unknown lane key.', 400, 'JOURNEY_LANE_KEY_INVALID');
  }
  const laneType = input.laneType || defaultLaneForCardKind(input.kind);
  if (!laneType) {
    throw new JourneyMapError('Note cards require an explicit custom lane.', 422, 'JOURNEY_CARD_LANE_REQUIRED');
  }
  if (isCustomJourneyLane(laneType) && input.kind !== 'note') {
    throw new JourneyMapError('Custom lanes accept note cards only.', 422, 'JOURNEY_CUSTOM_LANE_KIND');
  }
  const title = text(input.title, journeyMapLimits.titleChars);
  if (!title) throw new JourneyMapError('A card requires a title.', 400, 'JOURNEY_CARD_TITLE_REQUIRED');
  const now = nowIso();
  return db.transaction(() => {
    bumpDefinition(spaceId, definitionId, expectedRevision);
    const stage = db.prepare('SELECT stage_key FROM journey_map_stages WHERE version_id=? AND space_id=? AND stage_key=?')
      .get(version.id, spaceId, input.stageKey) as any;
    if (!stage) throw new JourneyMapError('Stage not found.', 404, 'JOURNEY_STAGE_NOT_FOUND');
    const lane = db.prepare('SELECT lane_type FROM journey_map_lanes WHERE version_id=? AND space_id=? AND lane_type=?')
      .get(version.id, spaceId, laneType) as any;
    if (!lane) throw new JourneyMapError('This map does not include that lane.', 422, 'JOURNEY_CARD_LANE_UNKNOWN');
    if (input.personaId) {
      assertPersonaLinkedToJourney(spaceId, definitionId, input.personaId);
    }
    const ordinal = Number((db.prepare(`SELECT COUNT(*) count FROM journey_map_cards
      WHERE version_id=? AND space_id=? AND stage_key=? AND lane_type=?`)
      .get(version.id, spaceId, input.stageKey, laneType) as any)?.count || 0);
    const id = journeyCardId(version.id, input.stageKey, laneType, ordinal);
    // Deterministic card IDs collide when a cell is emptied and refilled, so
    // fall back to a random identifier rather than overwriting history.
    const existing = db.prepare('SELECT id FROM journey_map_cards WHERE id=?').get(id);
    db.prepare(`INSERT INTO journey_map_cards
      (id,version_id,space_id,stage_key,lane_type,kind,title,content,ordinal,persona_id,status,origin,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?, 'workspace',?,?)`)
      .run(existing ? crypto.randomUUID() : id, version.id, spaceId, input.stageKey, laneType, input.kind, title,
        body(input.content, journeyMapLimits.contentChars), ordinal, input.personaId || null,
        input.status || 'active', now, now);
    structuralGuard(spaceId, version.id);
    return getJourneyMap(spaceId, definitionId, undefined, viewerUserId)!;
  })();
}

export function updateJourneyCard(
  spaceId: string, definitionId: string, expectedRevision: number, cardId: string,
  input: Partial<Omit<CardWriteInput, 'stageKey'>>, viewerUserId?: string
) {
  if (input.personaId !== undefined) assertSubscriptionFeature(spaceId, 'journeyPersonas');
  const { version } = requireEditableVersion(spaceId, definitionId);
  return db.transaction(() => {
    bumpDefinition(spaceId, definitionId, expectedRevision);
    const current = db.prepare('SELECT * FROM journey_map_cards WHERE id=? AND version_id=? AND space_id=?')
      .get(cardId, version.id, spaceId) as any;
    if (!current) throw new JourneyMapError('Card not found.', 404, 'JOURNEY_CARD_NOT_FOUND');
    if (input.kind !== undefined && !cardKindSet.has(String(input.kind))) {
      throw new JourneyMapError('Unknown card kind.', 400, 'JOURNEY_CARD_KIND_UNKNOWN');
    }
    const nextKind = input.kind === undefined ? current.kind : input.kind;
    if (isCustomJourneyLane(current.lane_type) && nextKind !== 'note') {
      throw new JourneyMapError('Custom lanes accept note cards only.', 422, 'JOURNEY_CUSTOM_LANE_KIND');
    }
    if (input.personaId) {
      assertPersonaLinkedToJourney(spaceId, definitionId, input.personaId);
    }
    const title = input.title === undefined ? current.title : text(input.title, journeyMapLimits.titleChars);
    if (!title) throw new JourneyMapError('A card requires a title.', 400, 'JOURNEY_CARD_TITLE_REQUIRED');
    db.prepare('UPDATE journey_map_cards SET kind=?,title=?,content=?,persona_id=?,status=?,updated_at=? WHERE id=? AND space_id=?')
      .run(nextKind, title,
        input.content === undefined ? current.content : body(input.content, journeyMapLimits.contentChars),
        input.personaId === undefined ? current.persona_id : (input.personaId || null),
        input.status === undefined ? current.status : input.status,
        nowIso(), cardId, spaceId);
    structuralGuard(spaceId, version.id);
    return getJourneyMap(spaceId, definitionId, undefined, viewerUserId)!;
  })();
}

export type BulkCardPatchInput = {
  cardIds: string[];
  patch: {
    status?: 'draft' | 'active' | 'retired';
    personaId?: string | null;
    stageKey?: string;
    laneType?: JourneyLaneKey;
  };
};

/** Apply one uniform edit to a bounded card selection as a single optimistic
 * transaction. Either every selected card and every affected cell is valid or
 * the definition revision and all cards remain unchanged. This is the server
 * primitive used by multi-select editing; clients must not emulate atomicity
 * with a sequence of single-card requests. */
export function bulkPatchJourneyCards(
  spaceId: string,
  definitionId: string,
  expectedRevision: number,
  input: BulkCardPatchInput,
  viewerUserId?: string
) {
  const cardIds = input.cardIds.map(String);
  if (!cardIds.length || cardIds.length > journeyMapLimits.cards) {
    throw new JourneyMapError(
      `Select between 1 and ${journeyMapLimits.cards} cards.`,
      400,
      'JOURNEY_CARD_BULK_SELECTION_INVALID'
    );
  }
  if (new Set(cardIds).size !== cardIds.length) {
    throw new JourneyMapError('A bulk selection cannot contain the same card twice.', 400, 'JOURNEY_CARD_BULK_DUPLICATE');
  }
  const hasPatch = input.patch.status !== undefined
    || input.patch.personaId !== undefined
    || input.patch.stageKey !== undefined
    || input.patch.laneType !== undefined;
  if (!hasPatch) throw new JourneyMapError('A bulk card edit requires at least one change.', 400, 'JOURNEY_CARD_BULK_EMPTY');
  if (input.patch.personaId !== undefined) assertSubscriptionFeature(spaceId, 'journeyPersonas');
  if (input.patch.laneType !== undefined && !isJourneyLaneKey(input.patch.laneType)) {
    throw new JourneyMapError('Unknown lane key.', 400, 'JOURNEY_LANE_KEY_INVALID');
  }

  const { version } = requireEditableVersion(spaceId, definitionId);
  return db.transaction(() => {
    bumpDefinition(spaceId, definitionId, expectedRevision);
    const readCard = db.prepare('SELECT * FROM journey_map_cards WHERE id=? AND version_id=? AND space_id=?');
    const cards = cardIds.map((cardId) => {
      const card = readCard.get(cardId, version.id, spaceId) as any;
      if (!card) throw new JourneyMapError('Card not found.', 404, 'JOURNEY_CARD_NOT_FOUND', { cardId });
      return card;
    });

    if (input.patch.stageKey !== undefined) {
      const stage = db.prepare('SELECT stage_key FROM journey_map_stages WHERE version_id=? AND space_id=? AND stage_key=?')
        .get(version.id, spaceId, input.patch.stageKey);
      if (!stage) throw new JourneyMapError('Stage not found.', 404, 'JOURNEY_STAGE_NOT_FOUND');
    }
    if (input.patch.laneType !== undefined) {
      const lane = db.prepare('SELECT lane_type FROM journey_map_lanes WHERE version_id=? AND space_id=? AND lane_type=?')
        .get(version.id, spaceId, input.patch.laneType);
      if (!lane) throw new JourneyMapError('This map does not include that lane.', 422, 'JOURNEY_CARD_LANE_UNKNOWN');
    }
    if (input.patch.personaId) {
      assertPersonaLinkedToJourney(spaceId, definitionId, input.patch.personaId);
    }

    // Validate every destination before the first card mutation. The outer
    // transaction would roll back on error, but this also keeps the write path
    // straightforward to inspect and audit.
    for (const card of cards) {
      const laneType = input.patch.laneType ?? String(card.lane_type);
      if (isCustomJourneyLane(laneType) && card.kind !== 'note') {
        throw new JourneyMapError('Only note cards can move into a custom lane.', 422, 'JOURNEY_CUSTOM_LANE_KIND', {
          cardId: card.id
        });
      }
    }

    const affectedCells = new Set<string>();
    let movedOrdinal = journeyMapLimits.cards;
    const update = db.prepare(`UPDATE journey_map_cards
      SET stage_key=?,lane_type=?,ordinal=?,persona_id=?,status=?,updated_at=?
      WHERE id=? AND version_id=? AND space_id=?`);
    for (const card of cards) {
      const stageKey = input.patch.stageKey ?? String(card.stage_key);
      const laneType = input.patch.laneType ?? String(card.lane_type);
      const cellChanged = stageKey !== card.stage_key || laneType !== card.lane_type;
      affectedCells.add(`${card.stage_key}|${card.lane_type}`);
      affectedCells.add(`${stageKey}|${laneType}`);
      update.run(
        stageKey,
        laneType,
        cellChanged ? movedOrdinal++ : card.ordinal,
        input.patch.personaId === undefined ? card.persona_id : (input.patch.personaId || null),
        input.patch.status === undefined ? card.status : input.patch.status,
        nowIso(),
        card.id,
        version.id,
        spaceId
      );
    }
    for (const cell of affectedCells) {
      const separator = cell.indexOf('|');
      reindexCell(spaceId, version.id, cell.slice(0, separator), cell.slice(separator + 1));
    }
    structuralGuard(spaceId, version.id);
    return getJourneyMap(spaceId, definitionId, undefined, viewerUserId)!;
  })();
}

export function deleteJourneyCard(
  spaceId: string, definitionId: string, expectedRevision: number, cardId: string, viewerUserId?: string
) {
  const { version } = requireEditableVersion(spaceId, definitionId);
  return db.transaction(() => {
    bumpDefinition(spaceId, definitionId, expectedRevision);
    const current = db.prepare('SELECT stage_key,lane_type FROM journey_map_cards WHERE id=? AND version_id=? AND space_id=?')
      .get(cardId, version.id, spaceId) as any;
    if (!current) throw new JourneyMapError('Card not found.', 404, 'JOURNEY_CARD_NOT_FOUND');
    db.prepare('DELETE FROM journey_map_cards WHERE id=? AND space_id=?').run(cardId, spaceId);
    db.prepare('DELETE FROM journey_evidence_links WHERE space_id=? AND target_type=? AND target_id=?')
      .run(spaceId, 'card', cardId);
    reindexCell(spaceId, version.id, current.stage_key, current.lane_type);
    return getJourneyMap(spaceId, definitionId, undefined, viewerUserId)!;
  })();
}

function reindexCell(spaceId: string, versionId: string, stageKey: string, laneType: string) {
  const rows = db.prepare(`SELECT id FROM journey_map_cards
    WHERE version_id=? AND space_id=? AND stage_key=? AND lane_type=? ORDER BY ordinal,id`)
    .all(versionId, spaceId, stageKey, laneType) as Array<{ id: string }>;
  const setOrdinal = db.prepare('UPDATE journey_map_cards SET ordinal=? WHERE id=? AND space_id=?');
  for (const [index, row] of rows.entries()) setOrdinal.run(index, row.id, spaceId);
}

function assertMovedCellsWithinLimit(
  spaceId: string,
  versionId: string,
  cells: ReadonlyArray<{ stageKey: string; laneType: string }>
) {
  const unique = new Set<string>();
  for (const cell of cells) {
    const key = `${cell.stageKey}|${cell.laneType}`;
    if (unique.has(key)) continue;
    unique.add(key);
    const count = Number((db.prepare(`SELECT COUNT(*) count FROM journey_map_cards
      WHERE version_id=? AND space_id=? AND stage_key=? AND lane_type=?`)
      .get(versionId, spaceId, cell.stageKey, cell.laneType) as { count?: number } | undefined)?.count || 0);
    if (count > journeyMapLimits.cardsPerCell) {
      throw new JourneyMapError(
        `A single stage and lane cell supports at most ${journeyMapLimits.cardsPerCell} cards.`,
        422, 'JOURNEY_CELL_CARD_LIMIT', cell
      );
    }
  }
}

/** One primitive backs drag-and-drop and the keyboard move controls so both
 * paths produce identical results. Accessibility is not a separate code path. */
function moveJourneyCardInternal(spaceId: string, definitionId: string, expectedRevision: number, cardId: string, target: {
  stageKey?: string; laneType?: JourneyLaneKey; ordinal?: number;
}, viewerUserId: string | undefined, responseMode: 'full' | 'affected_cells'):
JourneyMapReadModel | JourneyCardMoveAffectedCellsResponse {
  if (target.laneType !== undefined && !isJourneyLaneKey(target.laneType)) {
    throw new JourneyMapError('Unknown lane key.', 400, 'JOURNEY_LANE_KEY_INVALID');
  }
  const { version } = responseMode === 'affected_cells'
    ? requireEditableVersionIdentity(spaceId, definitionId)
    : requireEditableVersion(spaceId, definitionId);
  return db.transaction(() => {
    bumpDefinition(spaceId, definitionId, expectedRevision);
    const current = db.prepare('SELECT * FROM journey_map_cards WHERE id=? AND version_id=? AND space_id=?')
      .get(cardId, version.id, spaceId) as any;
    if (!current) throw new JourneyMapError('Card not found.', 404, 'JOURNEY_CARD_NOT_FOUND');
    const stageKey = target.stageKey || current.stage_key;
    const laneType = target.laneType || current.lane_type;
    const stage = db.prepare('SELECT stage_key FROM journey_map_stages WHERE version_id=? AND space_id=? AND stage_key=?')
      .get(version.id, spaceId, stageKey);
    if (!stage) throw new JourneyMapError('Stage not found.', 404, 'JOURNEY_STAGE_NOT_FOUND');
    const lane = db.prepare('SELECT lane_type FROM journey_map_lanes WHERE version_id=? AND space_id=? AND lane_type=?')
      .get(version.id, spaceId, laneType);
    if (!lane) throw new JourneyMapError('This map does not include that lane.', 422, 'JOURNEY_CARD_LANE_UNKNOWN');
    if (isCustomJourneyLane(laneType) && current.kind !== 'note') {
      throw new JourneyMapError('Only note cards can move into a custom lane.', 422, 'JOURNEY_CUSTOM_LANE_KIND');
    }
    db.prepare('UPDATE journey_map_cards SET stage_key=?,lane_type=?,ordinal=?,updated_at=? WHERE id=? AND space_id=?')
      .run(stageKey, laneType, Number.MAX_SAFE_INTEGER, nowIso(), cardId, spaceId);
    if (stageKey !== current.stage_key || laneType !== current.lane_type) {
      reindexCell(spaceId, version.id, current.stage_key, current.lane_type);
    }
    const rows = db.prepare(`SELECT id FROM journey_map_cards
      WHERE version_id=? AND space_id=? AND stage_key=? AND lane_type=? ORDER BY ordinal,id`)
      .all(version.id, spaceId, stageKey, laneType) as Array<{ id: string }>;
    const from = rows.findIndex((row) => row.id === cardId);
    const reordered = moveOrdinal(rows, from, target.ordinal === undefined ? from : target.ordinal);
    const setOrdinal = db.prepare('UPDATE journey_map_cards SET ordinal=? WHERE id=? AND space_id=?');
    for (const [index, row] of reordered.entries()) setOrdinal.run(index, row.id, spaceId);
    assertMovedCellsWithinLimit(spaceId, version.id, [
      { stageKey: String(current.stage_key), laneType: String(current.lane_type) },
      { stageKey, laneType }
    ]);
    if (responseMode === 'full') return getJourneyMap(spaceId, definitionId, undefined, viewerUserId)!;
    const cells = new Map<string, { stageKey: string; laneType: JourneyLaneKey }>();
    const rememberCell = (cellStageKey: string, cellLaneType: JourneyLaneKey) => {
      cells.set(`${cellStageKey}|${cellLaneType}`, { stageKey: cellStageKey, laneType: cellLaneType });
    };
    rememberCell(String(current.stage_key), current.lane_type as JourneyLaneKey);
    rememberCell(stageKey, laneType);
    const cellList = [...cells.values()];
    const predicates = cellList.map(() => '(stage_key=? AND lane_type=?)').join(' OR ');
    const parameters = cellList.flatMap((cell) => [cell.stageKey, cell.laneType]);
    const compactRows = db.prepare(`SELECT * FROM journey_map_cards
      WHERE version_id=? AND space_id=? AND (${predicates}) ORDER BY stage_key,lane_type,ordinal,id`)
      .all(version.id, spaceId, ...parameters) as any[];
    if (compactRows.length > journeyMapLimits.cardsPerCell * cellList.length) {
      throw new JourneyMapError('The moved cells exceed the configured card limit.', 500,
        'JOURNEY_CARD_CELL_LIMIT_INVARIANT');
    }
    const features = effectiveSubscriptionForSpace(spaceId).plan.features;
    const linksByCard = features.journeyEvidence
      ? evidenceStatesForCardIds(spaceId, compactRows.map((row) => String(row.id)), viewerUserId)
      : new Map<string, JourneyEvidenceLink[]>();
    const affectedCells = cellList.map((cell) => {
      const cards = compactRows
        .filter((row) => row.stage_key === cell.stageKey && row.lane_type === cell.laneType)
        .map((row) => journeyCardFromRow(row, linksByCard, features.journeyPersonas));
      if (cards.length > journeyMapLimits.cardsPerCell) {
        throw new JourneyMapError('The moved cell exceeds the configured card limit.', 500, 'JOURNEY_CARD_CELL_LIMIT_INVARIANT');
      }
      return { ...cell, cards };
    });
    const definition = db.prepare('SELECT revision,updated_at,current_version_id FROM journey_definitions WHERE id=? AND space_id=?')
      .get(definitionId, spaceId) as { revision: number; updated_at: string; current_version_id: string } | undefined;
    if (!definition || definition.current_version_id !== version.id) {
      throw new JourneyMapError('The moved map version could not be confirmed.', 409, 'JOURNEY_MAP_VERSION_MISSING');
    }
    return {
      responseMode: 'affected_cells' as const,
      definitionId,
      versionId: version.id,
      cardId,
      revision: Number(definition.revision),
      updatedAt: definition.updated_at,
      cardsPerCellLimit: journeyMapLimits.cardsPerCell,
      affectedCells
    };
  })();
}

/** Default move contract retained for existing clients. */
export function moveJourneyCard(spaceId: string, definitionId: string, expectedRevision: number, cardId: string, target: {
  stageKey?: string; laneType?: JourneyLaneKey; ordinal?: number;
}, viewerUserId?: string): JourneyMapReadModel {
  const result = moveJourneyCardInternal(spaceId, definitionId, expectedRevision, cardId, target, viewerUserId, 'full');
  if ('responseMode' in result) throw new Error('Unexpected compact journey-card move response.');
  return result;
}

export function moveJourneyCardAffectedCells(
  spaceId: string,
  definitionId: string,
  expectedRevision: number,
  cardId: string,
  target: { stageKey?: string; laneType?: JourneyLaneKey; ordinal?: number },
  viewerUserId?: string
): JourneyCardMoveAffectedCellsResponse {
  const result = moveJourneyCardInternal(
    spaceId, definitionId, expectedRevision, cardId, target, viewerUserId, 'affected_cells'
  );
  if (!('responseMode' in result)) throw new Error('Unexpected full journey-card move response.');
  return result;
}

/** Carry a version-pinned evidence relationship into the draft opened by a
 * publish. The source row remains attached to the now-immutable published
 * target; the deterministic copy keeps the new draft evidence-complete without
 * moving or deleting the reviewed relationship. Invalidated links are copied as
 * invalidated so the new draft retains the complete evidence audit trail. */
function copyVersionedEvidenceLinks(
  spaceId: string,
  targetType: 'stage' | 'card',
  sourceTargetId: string,
  nextTargetId: string
) {
  const rows = db.prepare(`SELECT * FROM journey_evidence_links
    WHERE space_id=? AND target_type=? AND target_id=? ORDER BY created_at,id`)
    .all(spaceId, targetType, sourceTargetId) as any[];
  if (!rows.length) return;
  const insert = db.prepare(`INSERT INTO journey_evidence_links
    (id,space_id,target_type,target_id,source_type,source_ref,source_label,excerpt,assessment,confidence,population,
      sample_size,collected_at,window_start,window_end,freshness_days,source_updated_at,last_validated_at,
      invalidated_at,invalidated_reason,created_by,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(space_id,target_type,target_id,source_type,source_ref) DO NOTHING`);
  for (const row of rows) {
    insert.run(
      deterministicJourneyId('evidence-link-copy', row.id, nextTargetId), spaceId, targetType, nextTargetId,
      row.source_type, row.source_ref, row.source_label, row.excerpt, row.assessment, row.confidence, row.population,
      row.sample_size, row.collected_at, row.window_start, row.window_end, row.freshness_days,
      row.source_updated_at, row.last_validated_at, row.invalidated_at, row.invalidated_reason,
      row.created_by, row.created_at, row.updated_at
    );
  }
}

export function publishJourneyMap(spaceId: string, definitionId: string, expectedRevision: number, userId: string | null) {
  const { definition, version } = requireEditableVersion(spaceId, definitionId);
  return db.transaction(() => {
    bumpDefinition(spaceId, definitionId, expectedRevision);
    const now = nowIso();
    // Persona content is reusable in working maps, but a publication must
    // freeze the exact persona revisions reviewers saw. Later library edits
    // therefore update drafts without rewriting historical publications.
    pinJourneyPersonaVersions(spaceId, definitionId, version.id);
    db.prepare("UPDATE journey_map_versions SET state='published',published_at=? WHERE id=? AND space_id=?")
      .run(now, version.id, spaceId);
    db.prepare("UPDATE journey_map_versions SET state='superseded' WHERE definition_id=? AND space_id=? AND id<>? AND state='published'")
      .run(definitionId, spaceId, version.id);
    // Publication immediately opens the next draft so the workspace is never
    // left in a read-only state after a release.
    const nextNumber = Number((db.prepare('SELECT MAX(version_number) top FROM journey_map_versions WHERE definition_id=? AND space_id=?')
      .get(definitionId, spaceId) as any)?.top || version.version_number) + 1;
    const nextId = journeyVersionId(definitionId, nextNumber);
    db.prepare(`INSERT INTO journey_map_versions
      (id,definition_id,space_id,version_number,schema_version,state,map_type,mode,experience_type,objective,industry,
        summary,legacy_audience,provenance_json,source_job_id,author_user_id,published_at,created_at)
      SELECT ?,definition_id,space_id,?,schema_version,'draft',map_type,mode,experience_type,objective,industry,
        summary,legacy_audience,provenance_json,NULL,?,NULL,?
      FROM journey_map_versions WHERE id=? AND space_id=?`)
      .run(nextId, nextNumber, userId, now, version.id, spaceId);
    // Copy structure with deterministic identifiers derived from the new
    // version so a repeated publish can never fork two different drafts.
    const insertStage = db.prepare(`INSERT INTO journey_map_stages (id,version_id,space_id,stage_key,name,goal,description,ordinal)
      VALUES (?,?,?,?,?,?,?,?)`);
    for (const stage of db.prepare('SELECT * FROM journey_map_stages WHERE version_id=? AND space_id=? ORDER BY ordinal,id')
      .all(version.id, spaceId) as any[]) {
      const nextStageId = journeyStageId(nextId, stage.stage_key);
      insertStage.run(nextStageId, nextId, spaceId, stage.stage_key, stage.name,
        stage.goal, stage.description, stage.ordinal);
      copyVersionedEvidenceLinks(spaceId, 'stage', stage.id, nextStageId);
    }
    const insertLane = db.prepare(`INSERT INTO journey_map_lanes (id,version_id,space_id,lane_type,title,description,ordinal,visible)
      VALUES (?,?,?,?,?,?,?,?)`);
    for (const lane of db.prepare('SELECT * FROM journey_map_lanes WHERE version_id=? AND space_id=? ORDER BY ordinal,id')
      .all(version.id, spaceId) as any[]) {
      insertLane.run(journeyLaneId(nextId, lane.lane_type, Number(lane.ordinal)), nextId, spaceId, lane.lane_type,
        lane.title, lane.description, lane.ordinal, lane.visible);
    }
    const insertCard = db.prepare(`INSERT INTO journey_map_cards
      (id,version_id,space_id,stage_key,lane_type,kind,title,content,ordinal,persona_id,status,origin,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const publishedToDraftCardIds = new Map<string, string>();
    for (const card of db.prepare('SELECT * FROM journey_map_cards WHERE version_id=? AND space_id=? ORDER BY stage_key,lane_type,ordinal,id')
      .all(version.id, spaceId) as any[]) {
      const nextCardId = journeyCardId(nextId, card.stage_key, card.lane_type, Number(card.ordinal));
      insertCard.run(nextCardId, nextId, spaceId,
        card.stage_key, card.lane_type, card.kind, card.title, card.content, card.ordinal, card.persona_id,
        card.status, card.origin, card.created_at, now);
      publishedToDraftCardIds.set(card.id, nextCardId);
      copyVersionedEvidenceLinks(spaceId, 'card', card.id, nextCardId);
    }
    cloneJourneyRichCardsForPublishedDraft({
      spaceId,
      sourceVersionId: version.id,
      nextVersionId: nextId,
      cardIds: publishedToDraftCardIds,
      actorUserId: userId
    });
    db.prepare("UPDATE journey_definitions SET status='published',published_version_id=?,current_version_id=?,updated_at=? WHERE id=? AND space_id=?")
      .run(version.id, nextId, now, definitionId, spaceId);
    return { definitionId: definition.id, publishedVersionId: version.id, draftVersionId: nextId };
  })();
}

export function deleteJourneyMap(spaceId: string, definitionId: string, expectedRevision: number) {
  const definition = requireDefinition(spaceId, definitionId);
  if (definition.revision !== expectedRevision) {
    throw new JourneyMapError('This journey map changed since it was opened. Refresh it before deleting.', 409, 'JOURNEY_MAP_REVISION_CONFLICT');
  }
  const suggestionAuditAvailable = db.provider === 'postgres' || Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='journey_ai_suggestion_runs'"
  ).get());
  const retainedSuggestion = suggestionAuditAvailable
    ? db.prepare('SELECT id FROM journey_ai_suggestion_runs WHERE definition_id=? AND space_id=? LIMIT 1')
      .get(definitionId, spaceId)
    : null;
  if (retainedSuggestion) {
    throw new JourneyMapError(
      'This journey has a retained AI suggestion audit. Archive it or use the governed privacy purge process before deletion.',
      409,
      'JOURNEY_AI_AUDIT_RETENTION'
    );
  }
  db.prepare('DELETE FROM journey_definitions WHERE id=? AND space_id=? AND revision=?').run(definitionId, spaceId, expectedRevision);
}

export type PersonaWriteInput = {
  name: string;
  summary?: string;
  lifecycleState?: PersonaLifecycleState;
  attributes?: Record<string, unknown>;
  goals?: unknown;
  behaviours?: unknown;
  needs?: unknown;
  barriers?: unknown;
  reviewAt?: string | null;
};

function personaAttributes(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>)
    .slice(0, journeyMapLimits.personaAttributes)
    .map(([key, item]) => [text(key, 80), text(item, journeyMapLimits.titleChars)] as const)
    .filter(([key, item]) => key && item);
  return Object.fromEntries(entries);
}

export function listJourneyPersonas(spaceId: string, viewerUserId?: string): JourneyPersona[] {
  return (db.prepare(`SELECT persona.*,
      (SELECT COUNT(*) FROM journey_definition_personas link WHERE link.persona_id=persona.id) linked_journey_count
    FROM journey_personas persona WHERE persona.space_id=? ORDER BY persona.name`)
    .all(spaceId) as any[]).map((row) => {
      const persona = rowPersona(row);
      const links = (db.prepare("SELECT * FROM journey_evidence_links WHERE space_id=? AND target_type='persona' AND target_id=?")
        .all(spaceId, persona.id) as any[]).map(rowEvidenceLink)
        .map((link) => viewerUserId ? evidenceLinkForViewer(spaceId, viewerUserId, link) : link);
      return { ...persona, evidenceState: computeEvidenceState(links.map(evidenceFacts)).state };
    });
}

export function getJourneyPersona(spaceId: string, personaId: string): JourneyPersona | null {
  const row = db.prepare('SELECT * FROM journey_personas WHERE id=? AND space_id=?').get(personaId, spaceId) as any;
  return row ? rowPersona(row) : null;
}

export function createJourneyPersona(
  spaceId: string, userId: string | null, input: PersonaWriteInput,
  source: JourneyPersona['source'] = 'workspace'
): JourneyPersona {
  assertSubscriptionFeature(spaceId, 'journeyPersonas');
  const name = text(input.name, journeyMapLimits.titleChars);
  if (!name) throw new JourneyMapError('A persona requires a name.', 400, 'JOURNEY_PERSONA_NAME_REQUIRED');
  if (db.prepare('SELECT id FROM journey_personas WHERE space_id=? AND name=?').get(spaceId, name)) {
    throw new JourneyMapError('A persona with this name already exists.', 409, 'JOURNEY_PERSONA_NAME_TAKEN');
  }
  assertSubscriptionQuota(spaceId, 'journeyPersonas', Number((db.prepare(
    'SELECT COUNT(*) count FROM journey_personas WHERE space_id=?'
  ).get(spaceId) as any)?.count || 0));
  const now = nowIso();
  const id = crypto.randomUUID();
  const personaVersionId = crypto.randomUUID();
  return db.transaction(() => {
    db.prepare(`INSERT INTO journey_personas
      (id,space_id,name,summary,lifecycle_state,owner_user_id,source,attributes_json,goals_json,behaviours_json,
        needs_json,barriers_json,review_at,revision,created_at,updated_at,current_version_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`)
      .run(id, spaceId, name, body(input.summary, journeyMapLimits.contentChars),
        lifecycleSet.has(String(input.lifecycleState)) ? input.lifecycleState : 'draft', userId, source,
        JSON.stringify(personaAttributes(input.attributes)), JSON.stringify(stringList(input.goals)),
        JSON.stringify(stringList(input.behaviours)), JSON.stringify(stringList(input.needs)),
        JSON.stringify(stringList(input.barriers)), input.reviewAt || null, now, now, personaVersionId);
    createInitialPersonaVersion(spaceId, id, personaVersionId, userId);
    return getJourneyPersona(spaceId, id)!;
  })();
}

export function updateJourneyPersona(
  spaceId: string, personaId: string, expectedRevision: number, input: Partial<PersonaWriteInput>,
  actorUserId: string | null = null
): JourneyPersona {
  assertSubscriptionFeature(spaceId, 'journeyPersonas');
  const current = getJourneyPersona(spaceId, personaId);
  if (!current) throw new JourneyMapError('Persona not found.', 404, 'JOURNEY_PERSONA_NOT_FOUND');
  const name = input.name === undefined ? current.name : text(input.name, journeyMapLimits.titleChars);
  if (!name) throw new JourneyMapError('A persona requires a name.', 400, 'JOURNEY_PERSONA_NAME_REQUIRED');
  if (name !== current.name && db.prepare('SELECT id FROM journey_personas WHERE space_id=? AND name=?').get(spaceId, name)) {
    throw new JourneyMapError('A persona with this name already exists.', 409, 'JOURNEY_PERSONA_NAME_TAKEN');
  }
  createPersonaWorkingVersion({
    spaceId,
    personaId,
    expectedRevision,
    actorUserId,
    snapshot: {
      name,
      summary: input.summary === undefined ? current.summary : body(input.summary, journeyMapLimits.contentChars),
      lifecycleState: input.lifecycleState !== undefined && lifecycleSet.has(String(input.lifecycleState))
        ? input.lifecycleState : current.lifecycleState,
      ownerUserId: current.ownerUserId,
      source: current.source,
      attributes: input.attributes === undefined ? current.attributes : personaAttributes(input.attributes),
      goals: input.goals === undefined ? current.goals : stringList(input.goals),
      behaviours: input.behaviours === undefined ? current.behaviours : stringList(input.behaviours),
      needs: input.needs === undefined ? current.needs : stringList(input.needs),
      barriers: input.barriers === undefined ? current.barriers : stringList(input.barriers),
      reviewAt: input.reviewAt === undefined ? current.reviewAt : (input.reviewAt || null)
    }
  });
  return getJourneyPersona(spaceId, personaId)!;
}

export function deleteJourneyPersona(spaceId: string, personaId: string, expectedRevision: number) {
  assertSubscriptionFeature(spaceId, 'journeyPersonas');
  const current = getJourneyPersona(spaceId, personaId);
  if (!current) throw new JourneyMapError('Persona not found.', 404, 'JOURNEY_PERSONA_NOT_FOUND');
  if (current.revision !== expectedRevision) throw new JourneyMapError(
    'This persona changed since it was opened. Refresh it before deleting.', 409, 'JOURNEY_PERSONA_REVISION_CONFLICT');
  assertPersonaDeletionAllowed(spaceId, personaId);
}

/** The legacy `audience` string is a free-text hypothesis. Converting it creates
 * an explicitly draft persona rather than implying validated research. */
export function personaDraftFromLegacyAudience(spaceId: string, userId: string | null, definitionId: string): JourneyPersona {
  const definition = requireDefinition(spaceId, definitionId);
  const version = db.prepare('SELECT legacy_audience FROM journey_map_versions WHERE id=? AND space_id=?')
    .get(definition.currentVersionId, spaceId) as { legacy_audience?: string } | undefined;
  const audience = text(version?.legacy_audience, journeyMapLimits.titleChars);
  if (!audience) throw new JourneyMapError('This journey map has no legacy audience to convert.', 422, 'JOURNEY_LEGACY_AUDIENCE_MISSING');
  const existing = db.prepare('SELECT * FROM journey_personas WHERE space_id=? AND name=?').get(spaceId, audience) as any;
  const persona = existing ? rowPersona(existing) : createJourneyPersona(spaceId, userId, {
    name: audience,
    summary: 'Drafted from a legacy journey audience. Attach evidence before treating it as researched.',
    lifecycleState: 'draft'
  }, 'legacy_audience_draft');
  linkPersonaToJourney(spaceId, definitionId, persona.id);
  return persona;
}

export function linkPersonaToJourney(spaceId: string, definitionId: string, personaId: string) {
  assertSubscriptionFeature(spaceId, 'journeyPersonas');
  assertPersonaCanBeLinked(spaceId, definitionId, personaId);
  const ordinal = Number((db.prepare('SELECT COUNT(*) count FROM journey_definition_personas WHERE definition_id=? AND space_id=?')
    .get(definitionId, spaceId) as any)?.count || 0);
  db.prepare(`INSERT INTO journey_definition_personas (definition_id,persona_id,space_id,ordinal,created_at)
    VALUES (?,?,?,?,?) ON CONFLICT(definition_id,persona_id) DO NOTHING`)
    .run(definitionId, personaId, spaceId, ordinal, nowIso());
}

export function unlinkPersonaFromJourney(spaceId: string, definitionId: string, personaId: string) {
  assertSubscriptionFeature(spaceId, 'journeyPersonas');
  const current = db.prepare(`SELECT definition.current_version_id FROM journey_definitions definition
    WHERE definition.id=? AND definition.space_id=?`).get(definitionId, spaceId) as { current_version_id?: string } | undefined;
  if (!current) throw new JourneyMapError('Journey map not found.', 404, 'JOURNEY_MAP_NOT_FOUND');
  const assignedCardCount = current.current_version_id ? Number((db.prepare(`SELECT COUNT(*) count
    FROM journey_map_cards WHERE version_id=? AND space_id=? AND persona_id=?`)
    .get(current.current_version_id, spaceId, personaId) as any)?.count || 0) : 0;
  if (assignedCardCount > 0) {
    throw new JourneyMapError(
      'Move or retire every persona-specific card before unlinking this persona.', 409,
      'JOURNEY_PERSONA_IN_USE', { assignedCardCount }
    );
  }
  const removed = db.prepare('DELETE FROM journey_definition_personas WHERE definition_id=? AND persona_id=? AND space_id=?')
    .run(definitionId, personaId, spaceId).changes;
  if (!removed) throw new JourneyMapError('This persona is not linked to that journey map.', 404, 'JOURNEY_PERSONA_LINK_NOT_FOUND');
}

export type EvidenceLinkInput = {
  targetType: JourneyEvidenceLink['targetType'];
  targetId: string;
  sourceType: EvidenceSourceType;
  sourceRef: string;
  sourceLabel?: string;
  excerpt?: string;
  assessment?: EvidenceAssessment;
  confidence?: number;
  population?: string;
  sampleSize?: number | null;
  collectedAt?: string | null;
  windowStart?: string | null;
  windowEnd?: string | null;
  freshnessDays?: number | null;
};

function authoritativeEvidenceSource(spaceId: string, userId: string | null, input: {
  sourceType: EvidenceSourceType; sourceRef: string;
}): JourneyEvidenceSourceView {
  if (!userId) throw new JourneyMapError('Authentication required.', 401, 'AUTHENTICATION_REQUIRED');
  try {
    return resolveJourneyEvidenceSource({ spaceId, userId, sourceType: input.sourceType, sourceRef: input.sourceRef });
  } catch (error) {
    if (error instanceof JourneyEvidenceSourceError) {
      throw new JourneyMapError(error.message, error.status, error.code, error.details);
    }
    throw error;
  }
}

function assertEvidenceTarget(spaceId: string, targetType: string, targetId: string) {
  const table = targetType === 'card' ? 'journey_map_cards'
    : targetType === 'stage' ? 'journey_map_stages'
    : targetType === 'persona' ? 'journey_personas'
    : targetType === 'definition' ? 'journey_definitions' : null;
  if (!table) throw new JourneyMapError('Unknown evidence target.', 400, 'JOURNEY_EVIDENCE_TARGET_UNKNOWN');
  const row = db.prepare(`SELECT id FROM ${table} WHERE id=? AND space_id=?`).get(targetId, spaceId);
  if (!row) throw new JourneyMapError('Evidence target not found.', 404, 'JOURNEY_EVIDENCE_TARGET_NOT_FOUND');
}

/** Stage and card evidence is part of a version's reviewed content. Once the
 * version is published, attach/assess/detach operations must target the draft
 * copy created at publish time instead of rewriting history. Definition and
 * persona evidence is deliberately reusable and therefore not version-pinned. */
function assertVersionedEvidenceTargetEditable(spaceId: string, targetType: string, targetId: string) {
  if (targetType !== 'stage' && targetType !== 'card') return;
  const table = targetType === 'stage' ? 'journey_map_stages' : 'journey_map_cards';
  const row = db.prepare(`SELECT version.state FROM ${table} target
    JOIN journey_map_versions version ON version.id=target.version_id AND version.space_id=target.space_id
    WHERE target.id=? AND target.space_id=?`).get(targetId, spaceId) as { state?: string } | undefined;
  if (!row) throw new JourneyMapError('Evidence target not found.', 404, 'JOURNEY_EVIDENCE_TARGET_NOT_FOUND');
  if (row.state !== 'draft') {
    throw new JourneyMapError(
      'Evidence on a published journey version is immutable. Change the current draft instead.',
      409, 'JOURNEY_EVIDENCE_TARGET_IMMUTABLE', { targetType, targetId, versionState: row.state }
    );
  }
}

export function attachEvidenceLink(spaceId: string, userId: string | null, input: EvidenceLinkInput): JourneyEvidenceLink {
  assertSubscriptionFeature(spaceId, 'journeyEvidence');
  if (!sourceTypeSet.has(String(input.sourceType))) {
    throw new JourneyMapError('Unknown evidence source type.', 400, 'JOURNEY_EVIDENCE_SOURCE_UNKNOWN');
  }
  const assessment = assessmentSet.has(String(input.assessment)) ? input.assessment as EvidenceAssessment : 'supports';
  const requestedSourceRef = text(input.sourceRef, 400);
  if (!requestedSourceRef) throw new JourneyMapError('An evidence link requires a source reference.', 400, 'JOURNEY_EVIDENCE_SOURCE_REF_REQUIRED');
  assertEvidenceTarget(spaceId, input.targetType, input.targetId);
  assertVersionedEvidenceTargetEditable(spaceId, input.targetType, input.targetId);
  const source = authoritativeEvidenceSource(spaceId, userId, { sourceType: input.sourceType, sourceRef: requestedSourceRef });
  const sourceRef = source.sourceRef;
  const now = nowIso();
  const id = crypto.randomUUID();
  const inserted = db.prepare(`INSERT INTO journey_evidence_links
    (id,space_id,target_type,target_id,source_type,source_ref,source_label,excerpt,assessment,confidence,population,
      sample_size,collected_at,window_start,window_end,freshness_days,source_updated_at,last_validated_at,
      invalidated_at,invalidated_reason,created_by,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,?,?)
    ON CONFLICT(space_id,target_type,target_id,source_type,source_ref) DO NOTHING`)
    .run(id, spaceId, input.targetType, input.targetId, input.sourceType, sourceRef,
      text(source.label, journeyMapLimits.titleChars), body(source.excerpt, journeyMapLimits.contentChars),
      assessment, Math.max(0, Math.min(1, Number(input.confidence) || 0)),
      text(source.population, journeyMapLimits.titleChars), source.sampleSize,
      source.collectedAt, source.windowStart, source.windowEnd,
      input.freshnessDays === null || input.freshnessDays === undefined ? null : Math.max(1, Math.trunc(Number(input.freshnessDays) || 0)),
      source.updatedAt, now, userId, now, now).changes;
  const row = db.prepare(`SELECT * FROM journey_evidence_links
    WHERE space_id=? AND target_type=? AND target_id=? AND source_type=? AND source_ref=?`)
    .get(spaceId, input.targetType, input.targetId, input.sourceType, sourceRef) as any;
  if (!row) throw new JourneyMapError('The evidence link could not be stored.', 500, 'JOURNEY_EVIDENCE_LINK_FAILED');
  if (!inserted) {
    throw new JourneyMapError('This source is already linked to that item.', 409, 'JOURNEY_EVIDENCE_LINK_EXISTS', { linkId: row.id });
  }
  return rowEvidenceLink(row);
}

export function listEvidenceLinks(spaceId: string, userId: string, targetType: string, targetId: string): JourneyEvidenceLink[] {
  assertSubscriptionFeature(spaceId, 'journeyEvidence');
  const links = (db.prepare(`SELECT * FROM journey_evidence_links
    WHERE space_id=? AND target_type=? AND target_id=? ORDER BY created_at,id`)
    .all(spaceId, targetType, targetId) as any[]).map(rowEvidenceLink);
  // Keep the relationship visible for review, but redact the historical
  // snapshot whenever the current viewer cannot resolve its source of record.
  // This makes access loss explicit without turning the journey into a bypass
  // for deleted, private, cross-space, owner-only, or plan-disabled content.
  return links.map((link) => evidenceLinkForViewer(spaceId, userId, link));
}

export function getEvidenceLinkSource(spaceId: string, userId: string, linkId: string): JourneyEvidenceSourceView {
  assertSubscriptionFeature(spaceId, 'journeyEvidence');
  const row = db.prepare('SELECT * FROM journey_evidence_links WHERE id=? AND space_id=?').get(linkId, spaceId) as any;
  if (!row) throw new JourneyMapError('Evidence link not found.', 404, 'JOURNEY_EVIDENCE_LINK_NOT_FOUND');
  const link = rowEvidenceLink(row);
  return authoritativeEvidenceSource(spaceId, userId, { sourceType: link.sourceType, sourceRef: link.sourceRef });
}

function evidenceTargetVersionState(spaceId: string, targetType: string, targetId: string) {
  if (targetType !== 'stage' && targetType !== 'card') return 'shared' as const;
  const table = targetType === 'stage' ? 'journey_map_stages' : 'journey_map_cards';
  const row = db.prepare(`SELECT version.state FROM ${table} target
    JOIN journey_map_versions version ON version.id=target.version_id AND version.space_id=target.space_id
    WHERE target.id=? AND target.space_id=?`).get(targetId, spaceId) as { state?: 'draft' | 'published' | 'superseded' } | undefined;
  if (!row?.state) throw new JourneyMapError('Evidence target not found.', 404, 'JOURNEY_EVIDENCE_TARGET_NOT_FOUND');
  return row.state;
}

export function refreshEvidenceLink(
  spaceId: string,
  userId: string,
  linkId: string,
  expectedFingerprint: string
): JourneyEvidenceLink {
  assertSubscriptionFeature(spaceId, 'journeyEvidence');
  const currentRow = db.prepare('SELECT * FROM journey_evidence_links WHERE id=? AND space_id=?').get(linkId, spaceId) as any;
  if (!currentRow) throw new JourneyMapError('Evidence link not found.', 404, 'JOURNEY_EVIDENCE_LINK_NOT_FOUND');
  assertVersionedEvidenceTargetEditable(spaceId, currentRow.target_type, currentRow.target_id);
  const current = rowEvidenceLink(currentRow);
  const source = authoritativeEvidenceSource(spaceId, userId, { sourceType: current.sourceType, sourceRef: current.sourceRef });
  const refreshedAt = nowIso();
  let result: ReturnType<typeof refreshJourneyEvidenceSnapshot>;
  try {
    result = refreshJourneyEvidenceSnapshot({
      stored: evidenceSnapshot(current),
      source: {
        sourceType: source.sourceType,
        sourceRef: source.sourceRef,
        label: source.label,
        excerpt: source.excerpt,
        population: source.population,
        sampleSize: source.sampleSize,
        collectedAt: source.collectedAt,
        windowStart: source.windowStart,
        windowEnd: source.windowEnd,
        updatedAt: source.updatedAt
      },
      expectedFingerprint,
      actorUserId: userId,
      refreshedAt,
      targetVersionState: evidenceTargetVersionState(spaceId, current.targetType, current.targetId)
    });
  } catch (error) {
    if (error instanceof JourneyEvidenceLifecycleError) {
      const status = error.code === 'EVIDENCE_REFRESH_CONFLICT' ? 409
        : error.code === 'EVIDENCE_REFRESH_TARGET_IMMUTABLE' ? 409 : 422;
      throw new JourneyMapError(error.message, status, error.code);
    }
    throw error;
  }
  return db.transaction(() => {
    const changed = db.prepare(`UPDATE journey_evidence_links SET
      source_label=?,excerpt=?,population=?,sample_size=?,collected_at=?,window_start=?,window_end=?,
      source_updated_at=?,last_validated_at=?,updated_at=?
      WHERE id=? AND space_id=? AND source_ref=? AND source_type=? AND updated_at=?`)
      .run(
        result.snapshot.sourceLabel, result.snapshot.excerpt, result.snapshot.population, result.snapshot.sampleSize,
        result.snapshot.collectedAt, result.snapshot.windowStart, result.snapshot.windowEnd,
        result.snapshot.sourceUpdatedAt, refreshedAt, refreshedAt,
        linkId, spaceId, current.sourceRef, current.sourceType, current.updatedAt
      ).changes;
    if (changed !== 1) {
      throw new JourneyMapError('The evidence link changed before refresh could be saved.', 409, 'JOURNEY_EVIDENCE_REFRESH_CONFLICT');
    }
    db.prepare(`INSERT INTO journey_evidence_audit_events
      (id,space_id,evidence_link_id,actor_user_id,action,changed_fields_json,before_fingerprint,after_fingerprint,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(
        crypto.randomUUID(), spaceId, linkId, userId, 'refreshed',
        JSON.stringify(result.audit.changedFields), result.audit.beforeFingerprint, result.audit.afterFingerprint, refreshedAt
      );
    const row = rowEvidenceLink(db.prepare('SELECT * FROM journey_evidence_links WHERE id=? AND space_id=?').get(linkId, spaceId) as any);
    return evidenceLinkForViewer(spaceId, userId, row);
  })();
}

export function listEvidenceAuditEvents(spaceId: string, linkId: string, limit = 50): JourneyEvidenceAuditEvent[] {
  assertSubscriptionFeature(spaceId, 'journeyEvidence');
  const exists = db.prepare('SELECT 1 FROM journey_evidence_links WHERE id=? AND space_id=?').get(linkId, spaceId);
  if (!exists) throw new JourneyMapError('Evidence link not found.', 404, 'JOURNEY_EVIDENCE_LINK_NOT_FOUND');
  const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  return (db.prepare(`SELECT * FROM journey_evidence_audit_events
    WHERE evidence_link_id=? AND space_id=? ORDER BY created_at DESC,id DESC LIMIT ?`)
    .all(linkId, spaceId, boundedLimit) as any[]).map((row) => ({
      id: row.id,
      evidenceLinkId: row.evidence_link_id,
      actorUserId: row.actor_user_id || null,
      action: row.action,
      changedFields: parseJson<JourneyEvidenceSnapshotField[]>(row.changed_fields_json, []),
      beforeFingerprint: row.before_fingerprint,
      afterFingerprint: row.after_fingerprint,
      createdAt: row.created_at
    }));
}

export function assessEvidenceLink(spaceId: string, linkId: string, input: {
  assessment?: EvidenceAssessment; confidence?: number; invalidated?: boolean; reason?: string;
}, viewerUserId?: string): JourneyEvidenceLink {
  assertSubscriptionFeature(spaceId, 'journeyEvidence');
  const current = db.prepare('SELECT * FROM journey_evidence_links WHERE id=? AND space_id=?').get(linkId, spaceId) as any;
  if (!current) throw new JourneyMapError('Evidence link not found.', 404, 'JOURNEY_EVIDENCE_LINK_NOT_FOUND');
  assertVersionedEvidenceTargetEditable(spaceId, current.target_type, current.target_id);
  if (input.assessment !== undefined && !assessmentSet.has(String(input.assessment))) {
    throw new JourneyMapError('Unknown evidence assessment.', 400, 'JOURNEY_EVIDENCE_ASSESSMENT_UNKNOWN');
  }
  // Invalidation needs a recorded reason: a reviewer overriding computed
  // evidence state must leave an auditable justification behind.
  const reason = body(input.reason, journeyMapLimits.contentChars);
  if (input.invalidated === true && !reason) {
    throw new JourneyMapError('Invalidating evidence requires a reason.', 400, 'JOURNEY_EVIDENCE_REASON_REQUIRED');
  }
  db.prepare('UPDATE journey_evidence_links SET assessment=?,confidence=?,invalidated_at=?,invalidated_reason=?,updated_at=? WHERE id=? AND space_id=?')
    .run(input.assessment === undefined ? current.assessment : input.assessment,
      input.confidence === undefined ? Number(current.confidence) : Math.max(0, Math.min(1, Number(input.confidence) || 0)),
      input.invalidated === undefined ? current.invalidated_at : (input.invalidated ? nowIso() : null),
      input.invalidated === undefined ? current.invalidated_reason : (input.invalidated ? reason : null),
      nowIso(), linkId, spaceId);
  const updated = rowEvidenceLink(
    db.prepare('SELECT * FROM journey_evidence_links WHERE id=? AND space_id=?').get(linkId, spaceId) as any
  );
  return viewerUserId ? evidenceLinkForViewer(spaceId, viewerUserId, updated) : updated;
}

export function detachEvidenceLink(spaceId: string, linkId: string) {
  assertSubscriptionFeature(spaceId, 'journeyEvidence');
  const current = db.prepare('SELECT * FROM journey_evidence_links WHERE id=? AND space_id=?').get(linkId, spaceId) as any;
  if (!current) throw new JourneyMapError('Evidence link not found.', 404, 'JOURNEY_EVIDENCE_LINK_NOT_FOUND');
  assertVersionedEvidenceTargetEditable(spaceId, current.target_type, current.target_id);
  const removed = db.prepare('DELETE FROM journey_evidence_links WHERE id=? AND space_id=?').run(linkId, spaceId).changes;
  if (!removed) throw new JourneyMapError('Evidence link not found.', 404, 'JOURNEY_EVIDENCE_LINK_NOT_FOUND');
}
