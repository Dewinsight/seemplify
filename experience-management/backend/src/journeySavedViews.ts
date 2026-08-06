import crypto from 'node:crypto';
import { z } from 'zod';
import { db } from './database.js';
import {
  isJourneyLaneKey, journeyCardKinds, journeyEvidenceStates, type JourneyEvidenceState
} from './journeyDomain.js';
import {
  getEvidenceLinkSource, getJourneyMap, JourneyMapError, type JourneyMapReadModel
} from './journeyMaps.js';
import {
  journeyMetricPrivacyDecision, type JourneyMetricPrivacyReason
} from './journeyMetricPrivacy.js';
import { assertJourneyDefinitionReadAllowed } from './journeyRollout.js';
import {
  assertSubscriptionFeature, assertSubscriptionQuota, effectiveSubscriptionForSpace, SubscriptionEntitlementError
} from './subscriptionEntitlements.js';

export const JOURNEY_SAVED_VIEW_SCHEMA_VERSION = 1 as const;
export const journeySavedViewLimits = Object.freeze({
  nameCharacters: 160,
  referencesPerKind: 50,
  configurationBytes: 32_768,
  presentationTitleCharacters: 200,
  retentionDays: { minimum: 1, maximum: 3_650 }
});

export type JourneySavedViewVisibility = 'private' | 'space';
export type JourneySavedViewBindingPolicy = 'exact' | 'follows_current';

export type JourneySavedViewFilters = {
  personaIds: string[];
  segmentIds: string[];
  cohortIds: string[];
  channelIds: string[];
  evidenceLinkIds: string[];
  evidenceStates: JourneyEvidenceState[];
  cardKinds: string[];
  laneKeys: string[];
  timeWindow: { from: string; to: string; timezone: string } | null;
};

export type JourneySavedViewPresentation = {
  density: 'comfortable' | 'compact';
  showEvidenceLegend: boolean;
  showResearchGaps: boolean;
  showEmptyLanes: boolean;
  title: string;
};

export type JourneySavedViewConfiguration = {
  schemaVersion: typeof JOURNEY_SAVED_VIEW_SCHEMA_VERSION;
  binding: { policy: JourneySavedViewBindingPolicy; versionId: string | null };
  filters: JourneySavedViewFilters;
  comparisonTarget: { definitionId: string; versionId: string } | null;
  presentation: JourneySavedViewPresentation;
};

export type JourneySavedView = {
  id: string;
  definitionId: string;
  name: string;
  visibility: JourneySavedViewVisibility;
  ownerUserId: string;
  revision: number;
  schemaVersion: number;
  checksum: string;
  state: 'active' | 'deleted';
  config: JourneySavedViewConfiguration;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  retentionExpiresAt: string | null;
};

export type JourneySavedViewUnavailable = Omit<JourneySavedView, 'config' | 'checksum'> & {
  config: null;
  checksum: null;
  availability: 'unavailable';
};

export type JourneySavedViewResolved = {
  view: JourneySavedView;
  map: JourneyMapReadModel;
  comparisonMap: JourneyMapReadModel | null;
  analytics: JourneySavedViewAnalyticsContext;
};

export type JourneySavedViewAnalyticsContext = {
  applied: {
    segmentIds: string[];
    cohortIds: string[];
    timeWindow: JourneySavedViewFilters['timeWindow'];
  };
  segments: Array<{ id: string; name: string; revision: number }>;
  observations: Array<{
    id: string; metricDefinitionId: string; metricName: string; segmentId: string | null;
    revision: number; status: string; value: number | null; unit: string;
    sampleSize: number | null; period: { from: string; to: string; timezone: string };
    freshnessStatus: string; minimumSampleWarning: boolean;
    privacy: {
      suppressed: boolean; reasonCode: JourneyMetricPrivacyReason | null;
      minimumSampleSize: number; privacyVersion: number;
    };
  }>;
  truncated: boolean;
};

export class JourneySavedViewError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = 'JOURNEY_SAVED_VIEW_INVALID',
    public details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'JourneySavedViewError';
  }
}

const boundedId = z.string().trim().min(1).max(128);
const orderedIds = z.array(boundedId).max(journeySavedViewLimits.referencesPerKind)
  .superRefine((items, context) => {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      if (seen.has(item)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate filter identity.', path: [index] });
      seen.add(item);
    });
  });
const timezone = z.string().trim().min(1).max(80).refine((value) => {
  try { new Intl.DateTimeFormat('en-GB', { timeZone: value }).format(); return true; }
  catch { return false; }
}, 'Invalid IANA timezone.');
const timeWindowSchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  timezone
}).strict().refine((window) => Date.parse(window.from) < Date.parse(window.to), {
  message: 'The time window end must be after its start.', path: ['to']
});
const filtersSchema = z.object({
  personaIds: orderedIds.default([]),
  segmentIds: orderedIds.default([]),
  cohortIds: orderedIds.default([]),
  channelIds: orderedIds.default([]),
  evidenceLinkIds: orderedIds.default([]),
  evidenceStates: z.array(z.enum(journeyEvidenceStates)).max(journeyEvidenceStates.length).default([])
    .superRefine((items, context) => {
      const seen = new Set<string>();
      items.forEach((item, index) => {
        if (seen.has(item)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate evidence state.', path: [index] });
        seen.add(item);
      });
    }),
  cardKinds: z.array(z.enum(journeyCardKinds)).max(journeyCardKinds.length).default([])
    .superRefine((items, context) => {
      const seen = new Set<string>();
      items.forEach((item, index) => {
        if (seen.has(item)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate card kind.', path: [index] });
        seen.add(item);
      });
    }),
  laneKeys: z.array(z.string().min(1).max(63).refine(isJourneyLaneKey, 'Invalid lane key.'))
    .max(24).default([]).superRefine((items, context) => {
      const seen = new Set<string>();
      items.forEach((item, index) => {
        if (seen.has(item)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate lane key.', path: [index] });
        seen.add(item);
      });
    }),
  timeWindow: timeWindowSchema.nullable().default(null)
}).strict();
const presentationSchema = z.object({
  density: z.enum(['comfortable', 'compact']).default('comfortable'),
  showEvidenceLegend: z.boolean().default(true),
  showResearchGaps: z.boolean().default(true),
  showEmptyLanes: z.boolean().default(true),
  title: z.string().trim().max(journeySavedViewLimits.presentationTitleCharacters).default('')
}).strict();
export const journeySavedViewConfigurationSchema = z.object({
  schemaVersion: z.literal(JOURNEY_SAVED_VIEW_SCHEMA_VERSION),
  binding: z.object({
    policy: z.enum(['exact', 'follows_current']),
    versionId: boundedId.nullable()
  }).strict().superRefine((binding, context) => {
    if (binding.policy === 'exact' && !binding.versionId) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'An exact view requires a version.', path: ['versionId'] });
    }
    if (binding.policy === 'follows_current' && binding.versionId) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'A follows-current view cannot pin a version.', path: ['versionId'] });
    }
  }),
  filters: filtersSchema.default({
    personaIds: [], segmentIds: [], cohortIds: [], channelIds: [], evidenceLinkIds: [],
    evidenceStates: [], cardKinds: [], laneKeys: [], timeWindow: null
  }),
  comparisonTarget: z.object({ definitionId: boundedId, versionId: boundedId }).strict().nullable().default(null),
  presentation: presentationSchema.default({
    density: 'comfortable', showEvidenceLegend: true, showResearchGaps: true, showEmptyLanes: true, title: ''
  })
}).strict();

function nowIso() { return new Date().toISOString(); }
function sha256(value: string) { return crypto.createHash('sha256').update(value).digest('hex'); }
function canonicalConfig(input: unknown) {
  const config = journeySavedViewConfigurationSchema.parse(input);
  const serialized = JSON.stringify(config);
  if (Buffer.byteLength(serialized, 'utf8') > journeySavedViewLimits.configurationBytes) {
    throw new JourneySavedViewError('The saved-view configuration is too large.', 413, 'JOURNEY_SAVED_VIEW_TOO_LARGE');
  }
  return { config, serialized, checksum: sha256(serialized) };
}
function safeJson<T>(value: unknown, fallback: T): T {
  try { return JSON.parse(String(value)) as T; } catch { return fallback; }
}
function tableExists(name: string) {
  try { db.prepare(`SELECT 1 FROM ${name} LIMIT 1`).get(); return true; } catch { return false; }
}

/** PostgreSQL is migrated offline. SQLite creates the exact development/test
 * parity schema when this module is imported by the journey router. */
function ensureSqliteSchema() {
  if (db.provider !== 'sqlite') return;
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS journey_saved_views_definition_tenant_identity
      ON journey_definitions(id,space_id);
    CREATE UNIQUE INDEX IF NOT EXISTS journey_saved_views_version_tenant_identity
      ON journey_map_versions(id,definition_id,space_id);
    CREATE TABLE IF NOT EXISTS journey_saved_view_settings (
      space_id TEXT PRIMARY KEY REFERENCES spaces(id) ON DELETE CASCADE,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
      retention_days INTEGER NOT NULL DEFAULT 30 CHECK(retention_days BETWEEN 1 AND 3650),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
      updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS journey_saved_views (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      definition_id TEXT NOT NULL, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
      visibility TEXT NOT NULL CHECK(visibility IN ('private','space')),
      owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      binding_policy TEXT NOT NULL CHECK(binding_policy IN ('exact','follows_current')),
      bound_version_id TEXT, comparison_definition_id TEXT, comparison_version_id TEXT,
      schema_version INTEGER NOT NULL CHECK(schema_version=1),
      config_json TEXT NOT NULL CHECK(length(CAST(config_json AS BLOB)) BETWEEN 2 AND 32768 AND json_valid(config_json)),
      config_sha256 TEXT NOT NULL CHECK(length(config_sha256)=64),
      state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','deleted')),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
      idempotency_key TEXT, intent_sha256 TEXT NOT NULL CHECK(length(intent_sha256)=64),
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, retention_expires_at TEXT,
      UNIQUE(id,space_id), UNIQUE(id,definition_id,space_id), UNIQUE(space_id,owner_user_id,idempotency_key),
      FOREIGN KEY(definition_id,space_id) REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(space_id,owner_user_id) REFERENCES space_memberships(space_id,user_id) ON DELETE RESTRICT,
      FOREIGN KEY(bound_version_id,definition_id,space_id)
        REFERENCES journey_map_versions(id,definition_id,space_id) ON DELETE RESTRICT,
      FOREIGN KEY(comparison_definition_id,space_id)
        REFERENCES journey_definitions(id,space_id) ON DELETE RESTRICT,
      FOREIGN KEY(comparison_version_id,comparison_definition_id,space_id)
        REFERENCES journey_map_versions(id,definition_id,space_id) ON DELETE RESTRICT,
      CHECK((binding_policy='exact' AND bound_version_id IS NOT NULL)
        OR (binding_policy='follows_current' AND bound_version_id IS NULL)),
      CHECK((comparison_definition_id IS NULL AND comparison_version_id IS NULL)
        OR (comparison_definition_id IS NOT NULL AND comparison_version_id IS NOT NULL)),
      CHECK((state='active' AND deleted_at IS NULL AND retention_expires_at IS NULL)
        OR (state='deleted' AND deleted_at IS NOT NULL AND retention_expires_at IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS journey_saved_views_definition
      ON journey_saved_views(space_id,definition_id,state,visibility,updated_at DESC,id);
    CREATE INDEX IF NOT EXISTS journey_saved_views_owner
      ON journey_saved_views(space_id,owner_user_id,state,updated_at DESC,id);
    CREATE INDEX IF NOT EXISTS journey_saved_views_retention
      ON journey_saved_views(retention_expires_at,id) WHERE state='deleted';
    CREATE TABLE IF NOT EXISTS journey_saved_view_references (
      view_id TEXT NOT NULL, space_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('persona','segment','cohort','channel','evidence_link','evidence_state','card_kind','lane')),
      reference_value TEXT NOT NULL CHECK(length(reference_value) BETWEEN 1 AND 256), ordinal INTEGER NOT NULL CHECK(ordinal>=0),
      PRIMARY KEY(view_id,kind,ordinal), UNIQUE(view_id,kind,reference_value),
      FOREIGN KEY(view_id,space_id) REFERENCES journey_saved_views(id,space_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS journey_saved_view_references_lookup
      ON journey_saved_view_references(space_id,kind,reference_value,view_id);
    CREATE TABLE IF NOT EXISTS journey_saved_view_selections (
      space_id TEXT NOT NULL, user_id TEXT NOT NULL, definition_id TEXT NOT NULL, view_id TEXT NOT NULL,
      view_revision INTEGER NOT NULL CHECK(view_revision>0), revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
      updated_at TEXT NOT NULL, PRIMARY KEY(space_id,user_id,definition_id),
      FOREIGN KEY(space_id,user_id) REFERENCES space_memberships(space_id,user_id) ON DELETE CASCADE,
      FOREIGN KEY(definition_id,space_id) REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(view_id,definition_id,space_id) REFERENCES journey_saved_views(id,definition_id,space_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS journey_saved_view_operations (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),
      action TEXT NOT NULL, intent_sha256 TEXT NOT NULL CHECK(length(intent_sha256)=64),
      response_json TEXT NOT NULL CHECK(length(CAST(response_json AS BLOB))<=32768 AND json_valid(response_json)),
      created_at TEXT NOT NULL, UNIQUE(space_id,actor_user_id,idempotency_key)
    );
    CREATE TABLE IF NOT EXISTS journey_saved_view_audit_events (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, action TEXT NOT NULL,
      view_id TEXT, definition_id TEXT, view_revision INTEGER, detail_json TEXT NOT NULL DEFAULT '{}'
        CHECK(length(CAST(detail_json AS BLOB))<=8192 AND json_valid(detail_json)), created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS journey_saved_view_audit_history
      ON journey_saved_view_audit_events(space_id,definition_id,created_at DESC,id);
    CREATE TRIGGER IF NOT EXISTS journey_saved_view_reference_persona_tenant
      BEFORE INSERT ON journey_saved_view_references WHEN NEW.kind='persona'
        AND NOT EXISTS (SELECT 1 FROM journey_personas WHERE id=NEW.reference_value AND space_id=NEW.space_id)
      BEGIN SELECT RAISE(ABORT,'Saved-view persona reference is outside the tenant'); END;
    CREATE TRIGGER IF NOT EXISTS journey_saved_view_reference_segment_tenant
      BEFORE INSERT ON journey_saved_view_references WHEN NEW.kind='segment'
        AND NOT EXISTS (SELECT 1 FROM journey_metric_segments WHERE id=NEW.reference_value AND space_id=NEW.space_id)
      BEGIN SELECT RAISE(ABORT,'Saved-view segment reference is outside the tenant'); END;
    CREATE TRIGGER IF NOT EXISTS journey_saved_view_reference_cohort_unsupported
      BEFORE INSERT ON journey_saved_view_references WHEN NEW.kind='cohort'
      BEGIN SELECT RAISE(ABORT,'Saved-view cohort references require the governed cohort catalogue'); END;
    CREATE TRIGGER IF NOT EXISTS journey_saved_view_reference_channel_tenant
      BEFORE INSERT ON journey_saved_view_references WHEN NEW.kind='channel'
        AND NOT EXISTS (SELECT 1 FROM journey_channels WHERE id=NEW.reference_value AND space_id=NEW.space_id)
      BEGIN SELECT RAISE(ABORT,'Saved-view channel reference is outside the tenant'); END;
    CREATE TRIGGER IF NOT EXISTS journey_saved_view_reference_evidence_tenant
      BEFORE INSERT ON journey_saved_view_references WHEN NEW.kind='evidence_link'
        AND NOT EXISTS (SELECT 1 FROM journey_evidence_links WHERE id=NEW.reference_value AND space_id=NEW.space_id)
      BEGIN SELECT RAISE(ABORT,'Saved-view evidence reference is outside the tenant'); END;
    CREATE TRIGGER IF NOT EXISTS journey_saved_view_operations_update_append_only
      BEFORE UPDATE ON journey_saved_view_operations BEGIN SELECT RAISE(ABORT,'Journey saved-view operations are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_saved_view_operations_delete_append_only
      BEFORE DELETE ON journey_saved_view_operations BEGIN SELECT RAISE(ABORT,'Journey saved-view operations are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_saved_view_audit_update_append_only
      BEFORE UPDATE ON journey_saved_view_audit_events BEGIN SELECT RAISE(ABORT,'Journey saved-view audit is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_saved_view_audit_delete_append_only
      BEFORE DELETE ON journey_saved_view_audit_events BEGIN SELECT RAISE(ABORT,'Journey saved-view audit is append-only'); END;
  `);
}
ensureSqliteSchema();

function settings(spaceId: string) {
  const row = db.prepare('SELECT * FROM journey_saved_view_settings WHERE space_id=?').get(spaceId) as any;
  return row ? {
    enabled: Boolean(Number(row.enabled)), retentionDays: Number(row.retention_days),
    revision: Number(row.revision), updatedAt: row.updated_at
  } : { enabled: true, retentionDays: 30, revision: 0, updatedAt: null as string | null };
}

function assertEnabled(spaceId: string) {
  assertSubscriptionFeature(spaceId, 'journeySavedViews');
  if (!settings(spaceId).enabled) {
    throw new JourneySavedViewError('Journey saved views are disabled for this space.', 403, 'JOURNEY_SAVED_VIEWS_DISABLED');
  }
}

function membershipRole(spaceId: string, userId: string) {
  const row = db.prepare('SELECT role FROM space_memberships WHERE space_id=? AND user_id=?')
    .get(spaceId, userId) as { role?: string } | undefined;
  if (!row || !['owner', 'admin', 'member'].includes(String(row.role))) {
    throw new JourneySavedViewError('Space membership is required.', 403, 'JOURNEY_SAVED_VIEW_FORBIDDEN');
  }
  return row.role as 'owner' | 'admin' | 'member';
}
function canEditShared(role: string) { return role === 'owner' || role === 'admin'; }
function canReadRow(row: any, userId: string) {
  return row.visibility === 'space' || row.owner_user_id === userId;
}
function assertCanManageRow(row: any, userId: string, role: string) {
  if (row.visibility === 'private' && row.owner_user_id !== userId) {
    throw new JourneySavedViewError('Private views can only be managed by their owner.', 403, 'JOURNEY_SAVED_VIEW_FORBIDDEN');
  }
  if (row.visibility === 'space' && !canEditShared(role)) {
    throw new JourneySavedViewError('Only space editors can manage shared views.', 403, 'JOURNEY_SAVED_VIEW_SHARED_FORBIDDEN');
  }
}

function rowView(row: any): JourneySavedView {
  const parsed = canonicalConfig(safeJson(row.config_json, null));
  if (parsed.serialized !== String(row.config_json) || parsed.checksum !== row.config_sha256
    || Number(row.schema_version) !== JOURNEY_SAVED_VIEW_SCHEMA_VERSION
    || parsed.config.binding.policy !== row.binding_policy
    || parsed.config.binding.versionId !== (row.bound_version_id || null)
    || parsed.config.comparisonTarget?.definitionId !== (row.comparison_definition_id || undefined)
    || parsed.config.comparisonTarget?.versionId !== (row.comparison_version_id || undefined)) {
    throw new JourneySavedViewError('The saved view failed its integrity check.', 409, 'JOURNEY_SAVED_VIEW_INTEGRITY_FAILED');
  }
  return {
    id: row.id, definitionId: row.definition_id, name: row.name, visibility: row.visibility,
    ownerUserId: row.owner_user_id, revision: Number(row.revision), schemaVersion: Number(row.schema_version),
    checksum: row.config_sha256, state: row.state, config: parsed.config,
    createdAt: row.created_at, updatedAt: row.updated_at,
    deletedAt: row.deleted_at || null, retentionExpiresAt: row.retention_expires_at || null
  };
}

/** Per-request memo of resolved maps. Listing a space's saved views otherwise
 * performs one complete map read (stages, lanes, cards, evidence, personas) per
 * view; at the plan quota that is hundreds of full reads for a single request.
 * A cache instance must never outlive the single (space, actor) call that
 * created it, because map reads are authorised per actor. */
type JourneyMapCache = Map<string, JourneyMapReadModel>;

function requireDefinitionMap(
  spaceId: string, userId: string, definitionId: string, versionId?: string, cache?: JourneyMapCache
) {
  const cacheKey = JSON.stringify([definitionId, versionId || null]);
  const memoized = cache?.get(cacheKey);
  if (memoized) return memoized;
  const map = getJourneyMap(spaceId, definitionId, versionId, userId);
  if (!map) throw new JourneySavedViewError('Journey map or version not found.', 404, 'JOURNEY_SAVED_VIEW_MAP_NOT_FOUND');
  assertJourneyDefinitionReadAllowed(spaceId, map);
  cache?.set(cacheKey, map);
  return map;
}

function referencedRows(spaceId: string, table: string, ids: readonly string[], extraSql = '', extra: unknown[] = []) {
  if (!ids.length) return new Set<string>();
  if (!tableExists(table)) return new Set<string>();
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT id FROM ${table} WHERE space_id=? AND id IN (${placeholders}) ${extraSql}`)
    .all(spaceId, ...ids, ...extra) as Array<{ id: string }>;
  return new Set(rows.map((row) => row.id));
}
function assertExactSet(kind: string, requested: readonly string[], found: ReadonlySet<string>) {
  if (requested.some((id) => !found.has(id))) {
    throw new JourneySavedViewError(`A selected ${kind} is unavailable.`, 403, 'JOURNEY_SAVED_VIEW_REFERENCE_UNAVAILABLE', { kind });
  }
}

function validateReferences(
  spaceId: string, userId: string, definitionId: string, config: JourneySavedViewConfiguration,
  cache?: JourneyMapCache
) {
  const versionId = config.binding.policy === 'exact' ? config.binding.versionId! : undefined;
  const map = requireDefinitionMap(spaceId, userId, definitionId, versionId, cache);
  if (config.filters.personaIds.length) {
    assertSubscriptionFeature(spaceId, 'journeyPersonas');
    assertExactSet('persona', config.filters.personaIds,
      referencedRows(spaceId, 'journey_personas', config.filters.personaIds));
    const boundPersonas = new Set(map.personas.map((persona) => persona.id));
    if (config.filters.personaIds.some((id) => !boundPersonas.has(id))) {
      throw new JourneySavedViewError('A selected persona is not pinned to the bound map version.', 422,
        'JOURNEY_SAVED_VIEW_PERSONA_SCOPE_INVALID');
    }
  }
  if (config.filters.cohortIds.length) {
    // The current governed metric store has explicit segment identities, but
    // no cohort catalogue or cohort-observation lineage. Treating a segment as
    // a cohort would falsely imply semantics the data does not carry.
    throw new JourneySavedViewError('Cohort filters require the governed cohort catalogue.', 422,
      'JOURNEY_SAVED_VIEW_COHORT_UNSUPPORTED');
  }
  if (config.filters.segmentIds.length || config.filters.timeWindow) {
    assertSubscriptionFeature(spaceId, 'journeyMetrics');
    // Admission must use the same predicate the analytics resolver uses
    // (state='active'). A looser predicate here made a view list as available
    // and then fail with 403 the moment it was resolved.
    assertExactSet('segment', config.filters.segmentIds,
      referencedRows(spaceId, 'journey_metric_segments', config.filters.segmentIds,
        'AND journey_definition_id=? AND state=?', [definitionId, 'active']));
  }
  if (config.filters.channelIds.length) {
    assertSubscriptionFeature(spaceId, 'journeyRichCards');
    assertExactSet('channel', config.filters.channelIds,
      referencedRows(spaceId, 'journey_channels', config.filters.channelIds, 'AND status=?', ['active']));
  }
  if (config.filters.evidenceLinkIds.length) {
    assertSubscriptionFeature(spaceId, 'journeyEvidence');
    const found = referencedRows(spaceId, 'journey_evidence_links', config.filters.evidenceLinkIds);
    assertExactSet('evidence link', config.filters.evidenceLinkIds, found);
    const validTargetIds = new Set<string>([
      definitionId, ...map.stages.map((item) => item.id), ...map.cards.map((item) => item.id),
      ...map.personas.map((item) => item.id)
    ]);
    for (const linkId of config.filters.evidenceLinkIds) {
      const row = db.prepare('SELECT target_id FROM journey_evidence_links WHERE id=? AND space_id=?')
        .get(linkId, spaceId) as { target_id?: string } | undefined;
      if (!row?.target_id || !validTargetIds.has(row.target_id)) {
        throw new JourneySavedViewError('Selected evidence does not belong to this exact map version.', 422,
          'JOURNEY_SAVED_VIEW_EVIDENCE_SCOPE_INVALID');
      }
      getEvidenceLinkSource(spaceId, userId, linkId);
    }
  }
  if (config.filters.laneKeys.some((key) => !map.lanes.some((lane) => lane.laneType === key))) {
    throw new JourneySavedViewError('A selected lane is unavailable in the bound map version.', 409,
      'JOURNEY_SAVED_VIEW_LANE_UNAVAILABLE');
  }
  let comparisonMap: JourneyMapReadModel | null = null;
  if (config.comparisonTarget) {
    comparisonMap = requireDefinitionMap(spaceId, userId, config.comparisonTarget.definitionId,
      config.comparisonTarget.versionId, cache);
  }
  return { map, comparisonMap };
}

type JourneyMetricPrivacyVersionRow = {
  minimum_sample_size?: number | string | null; population_json?: unknown; filters_json?: unknown;
};

/** Each observation is judged against its own immutable definition version, never
 * the definition's current one, so an edited threshold can neither retroactively
 * unsuppress history nor hide an already published measure. A version that does
 * not resolve inside this tenant is simply absent from the map, and an absent
 * version fails closed in `journeyMetricPrivacyDecision`. Resolving it with a
 * LEFT JOIN instead would hand the decision a truthy all-null row and silently
 * invert that guarantee. */
function observationPrivacyVersions(spaceId: string, rows: readonly any[]) {
  const versions = new Map<string, JourneyMetricPrivacyVersionRow>();
  const ids = [...new Set(rows.map((row) => String(row.definition_version_id)))].filter(Boolean);
  if (!ids.length) return versions;
  // The caller caps the page at 200 rows, so a single bound lookup stays well
  // inside the statement variable limit.
  const found = db.prepare(`SELECT id,minimum_sample_size,population_json,filters_json
    FROM journey_metric_definition_versions WHERE space_id=? AND id IN (${ids.map(() => '?').join(',')})`)
    .all(spaceId, ...ids) as any[];
  for (const version of found) versions.set(String(version.id), version);
  return versions;
}

function resolveAnalyticsContext(
  spaceId: string,
  definitionId: string,
  config: JourneySavedViewConfiguration
): JourneySavedViewAnalyticsContext {
  const applied = {
    segmentIds: [...config.filters.segmentIds], cohortIds: [] as string[],
    timeWindow: config.filters.timeWindow
  };
  if (!config.filters.segmentIds.length && !config.filters.timeWindow) {
    return { applied, segments: [], observations: [], truncated: false };
  }
  const segmentRows = config.filters.segmentIds.length
    ? db.prepare(`SELECT id,name,revision FROM journey_metric_segments WHERE space_id=? AND journey_definition_id=?
        AND state='active' AND id IN (${config.filters.segmentIds.map(() => '?').join(',')})`)
      .all(spaceId, definitionId, ...config.filters.segmentIds) as any[]
    : [];
  const segmentById = new Map(segmentRows.map((row) => [row.id, row]));
  const segments = config.filters.segmentIds.map((id) => {
    const row = segmentById.get(id);
    if (!row) throw new JourneySavedViewError('A selected segment is unavailable.', 403,
      'JOURNEY_SAVED_VIEW_REFERENCE_UNAVAILABLE', { kind: 'segment' });
    return { id, name: String(row.name), revision: Number(row.revision) };
  });
  const clauses = ["observation.space_id=?", "definition.journey_definition_id=?"];
  const values: unknown[] = [spaceId, definitionId];
  if (config.filters.segmentIds.length) {
    clauses.push(`definition.segment_id IN (${config.filters.segmentIds.map(() => '?').join(',')})`);
    values.push(...config.filters.segmentIds);
  }
  if (config.filters.timeWindow) {
    clauses.push('observation.period_end>?', 'observation.period_start<?');
    values.push(config.filters.timeWindow.from, config.filters.timeWindow.to);
  }
  const rows = db.prepare(`SELECT observation.id,observation.definition_id,observation.definition_version_id,
      observation.revision,observation.status,
      observation.value,observation.unit,observation.sample_size,observation.period_start,observation.period_end,
      observation.timezone,observation.freshness_status,observation.minimum_sample_warning,observation.result_json,
      definition.name metric_name,definition.segment_id
    FROM journey_metric_observations observation JOIN journey_metric_definitions definition
      ON definition.id=observation.definition_id AND definition.space_id=observation.space_id
    WHERE ${clauses.join(' AND ')} AND NOT EXISTS (
      SELECT 1 FROM journey_metric_observations newer WHERE newer.space_id=observation.space_id
        AND newer.definition_id=observation.definition_id
        AND newer.definition_version_id=observation.definition_version_id
        AND newer.period_start=observation.period_start AND newer.period_end=observation.period_end
        AND newer.revision>observation.revision)
    ORDER BY observation.period_end DESC,observation.definition_id,observation.id LIMIT 201`).all(...values) as any[];
  // A saved view is a second read path onto the same governed observations, so it
  // passes through the same fail-closed privacy boundary as
  // `/api/journey-metrics/observations`. Publishing a value or a sample here that
  // the canonical projection redacts would make the boundary a formality.
  const page = rows.slice(0, 200);
  const versions = observationPrivacyVersions(spaceId, page);
  return {
    applied,
    segments,
    observations: page.map((row) => {
      const decision = journeyMetricPrivacyDecision(row, versions.get(String(row.definition_version_id)));
      return {
        id: row.id, metricDefinitionId: row.definition_id, metricName: row.metric_name,
        segmentId: row.segment_id || null, revision: Number(row.revision), status: row.status,
        value: decision.suppressed || row.value === null ? null : Number(row.value), unit: row.unit,
        sampleSize: decision.suppressed ? null : Number(row.sample_size),
        period: { from: String(row.period_start), to: String(row.period_end), timezone: row.timezone },
        // The warning state carries no count, so it survives suppression intact.
        freshnessStatus: row.freshness_status, minimumSampleWarning: Boolean(Number(row.minimum_sample_warning)),
        privacy: { suppressed: decision.suppressed, reasonCode: decision.reasonCode,
          minimumSampleSize: decision.minimumSampleSize, privacyVersion: decision.privacyVersion }
      };
    }),
    truncated: rows.length > 200
  };
}

function evidenceTargetCards(spaceId: string, versionId: string, linkIds: readonly string[]) {
  if (!linkIds.length) return null;
  const placeholders = linkIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT link.target_type,link.target_id FROM journey_evidence_links link
    WHERE link.space_id=? AND link.id IN (${placeholders}) ORDER BY link.id`).all(spaceId, ...linkIds) as any[];
  const cards = db.prepare('SELECT id,stage_key,persona_id FROM journey_map_cards WHERE version_id=? AND space_id=?')
    .all(versionId, spaceId) as any[];
  const definitionSelected = rows.some((row) => row.target_type === 'definition');
  if (definitionSelected) return new Set(cards.map((card) => card.id));
  const cardIds = new Set(rows.filter((row) => row.target_type === 'card').map((row) => row.target_id));
  const stageIds = new Set(rows.filter((row) => row.target_type === 'stage').map((row) => row.target_id));
  const stageKeys = new Set((db.prepare(`SELECT stage_key FROM journey_map_stages WHERE version_id=? AND space_id=?
    AND id IN (${rows.filter((row) => row.target_type === 'stage').map(() => '?').join(',') || "''"})`)
    .all(versionId, spaceId, ...stageIds) as Array<{ stage_key: string }>).map((row) => row.stage_key));
  const personaIds = new Set(rows.filter((row) => row.target_type === 'persona').map((row) => row.target_id));
  for (const card of cards) {
    if (stageKeys.has(card.stage_key) || (card.persona_id && personaIds.has(card.persona_id))) cardIds.add(card.id);
  }
  return cardIds;
}

function channelCards(spaceId: string, versionId: string, channelIds: readonly string[]) {
  if (!channelIds.length) return null;
  if (!tableExists('journey_card_touchpoints')) return new Set<string>();
  const placeholders = channelIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT DISTINCT link.card_id FROM journey_card_touchpoints link
    JOIN journey_touchpoint_versions touchpoint ON touchpoint.id=link.touchpoint_version_id
      AND touchpoint.touchpoint_id=link.touchpoint_id AND touchpoint.space_id=link.space_id
    WHERE link.space_id=? AND link.version_id=? AND touchpoint.channel_id IN (${placeholders})
      AND link.removed_at IS NULL`).all(spaceId, versionId, ...channelIds) as Array<{ card_id: string }>;
  return new Set(rows.map((row) => row.card_id));
}

export function applyJourneySavedViewFilters(
  input: JourneyMapReadModel,
  config: JourneySavedViewConfiguration,
  spaceId: string
): JourneyMapReadModel {
  const personaIds = new Set(config.filters.personaIds);
  const evidenceStates = new Set(config.filters.evidenceStates);
  const cardKinds = new Set(config.filters.cardKinds);
  const laneKeys = new Set(config.filters.laneKeys);
  const evidenceCards = evidenceTargetCards(spaceId, input.version.id, config.filters.evidenceLinkIds);
  const selectedChannelCards = channelCards(spaceId, input.version.id, config.filters.channelIds);
  const cards = input.cards.filter((card) =>
    (!personaIds.size || Boolean(card.personaId && personaIds.has(card.personaId)))
    && (!evidenceStates.size || evidenceStates.has(card.evidence.state))
    && (!cardKinds.size || cardKinds.has(card.kind))
    && (!laneKeys.size || laneKeys.has(card.laneType))
    && (!evidenceCards || evidenceCards.has(card.id))
    && (!selectedChannelCards || selectedChannelCards.has(card.id)));
  const lanes = input.lanes.filter((lane) =>
    (!laneKeys.size || laneKeys.has(lane.laneType))
    && (config.presentation.showEmptyLanes || cards.some((card) => card.laneType === lane.laneType)));
  const personas = personaIds.size ? input.personas.filter((persona) => personaIds.has(persona.id)) : input.personas;
  const evidenceSummary = Object.fromEntries(journeyEvidenceStates.map((state) => [
    state, cards.filter((card) => card.evidence.state === state).length
  ])) as Record<JourneyEvidenceState, number>;
  // Research gaps are recomputed over the surviving cards. Emitting an empty
  // list whenever any filter matched reported "no open research gaps" as a
  // finding, when in fact the gaps were never evaluated for the filtered set.
  const survivingCardIds = new Set(cards.map((card) => card.id));
  return {
    ...input,
    definition: {
      ...input.definition, cardCount: cards.length, personaCount: personas.length,
      evidenceLinkCount: cards.reduce((total, card) => total + card.evidenceLinkCount, 0)
    },
    lanes, cards, personas, evidenceSummary,
    researchGaps: config.presentation.showResearchGaps
      ? input.researchGaps.filter((gap) => survivingCardIds.has(gap.cardId))
      : []
  };
}

function insertReferences(viewId: string, spaceId: string, config: JourneySavedViewConfiguration) {
  const insert = db.prepare(`INSERT INTO journey_saved_view_references
    (view_id,space_id,kind,reference_value,ordinal) VALUES (?,?,?,?,?)`);
  const groups: Array<[string, readonly string[]]> = [
    ['persona', config.filters.personaIds], ['segment', config.filters.segmentIds],
    ['cohort', config.filters.cohortIds], ['channel', config.filters.channelIds],
    ['evidence_link', config.filters.evidenceLinkIds], ['evidence_state', config.filters.evidenceStates],
    ['card_kind', config.filters.cardKinds], ['lane', config.filters.laneKeys]
  ];
  for (const [kind, values] of groups) values.forEach((value, ordinal) => insert.run(viewId, spaceId, kind, value, ordinal));
}

function audit(input: {
  spaceId: string; actorUserId: string | null; action: string; viewId?: string;
  definitionId?: string; viewRevision?: number; detail?: Record<string, unknown>;
}) {
  const detail = JSON.stringify(input.detail || {});
  if (Buffer.byteLength(detail, 'utf8') > 8_192) throw new JourneySavedViewError('Audit detail is too large.', 500);
  db.prepare(`INSERT INTO journey_saved_view_audit_events
    (id,space_id,actor_user_id,action,view_id,definition_id,view_revision,detail_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), input.spaceId, input.actorUserId, input.action,
      input.viewId || null, input.definitionId || null, input.viewRevision || null, detail, nowIso());
}

type MutationAction = 'view.create' | 'view.update' | 'view.duplicate' | 'view.delete' | 'view.restore'
  | 'default.select' | 'default.reset' | 'settings.update';
function checkedKey(key: string) {
  if (!key || key.length > 200 || key.trim() !== key || /[\x00-\x1f\x7f]/u.test(key)) {
    throw new JourneySavedViewError('A valid Idempotency-Key is required.', 400, 'JOURNEY_SAVED_VIEW_IDEMPOTENCY_INVALID');
  }
  return key;
}
function lockIdempotencyPrincipal(spaceId: string, actorUserId: string) {
  if (db.provider !== 'postgres') return;
  db.prepare('SELECT user_id FROM space_memberships WHERE space_id=? AND user_id=? FOR UPDATE')
    .get(spaceId, actorUserId);
}
function lockSpaceForQuota(spaceId: string) {
  if (db.provider !== 'postgres') return;
  const locked = db.prepare('SELECT id FROM spaces WHERE id=? FOR UPDATE').get(spaceId);
  if (!locked) throw new JourneySavedViewError('Space not found.', 404, 'JOURNEY_SAVED_VIEW_SPACE_NOT_FOUND');
}
function existingOperation<T extends Record<string, unknown>>(
  spaceId: string,
  actorUserId: string,
  key: string,
  action: MutationAction,
  intentSha256: string
): (T & { replayed: true }) | null {
  const existing = db.prepare(`SELECT action,intent_sha256,response_json FROM journey_saved_view_operations
    WHERE space_id=? AND actor_user_id=? AND idempotency_key=?`).get(spaceId, actorUserId, key) as any;
  if (!existing) return null;
  if (existing.action !== action || existing.intent_sha256 !== intentSha256) {
    throw new JourneySavedViewError('This idempotency key was already used for a different saved-view request.', 409,
      'JOURNEY_SAVED_VIEW_IDEMPOTENCY_CONFLICT');
  }
  return { ...safeJson(existing.response_json, {} as T), replayed: true };
}
function idempotentMutation<T extends Record<string, unknown>>(input: {
  spaceId: string; actorUserId: string; key: string; action: MutationAction; intent: unknown; run: () => T;
}): T & { replayed: boolean } {
  const key = checkedKey(input.key);
  const intentSha256 = sha256(JSON.stringify({ action: input.action, intent: input.intent }));
  const existing = existingOperation<T>(input.spaceId, input.actorUserId, key, input.action, intentSha256);
  if (existing) return existing;
  return db.transaction(() => {
    // Serialise one principal's idempotency namespace, then recheck. Concurrent
    // same-key requests return the stored receipt instead of leaking a unique
    // constraint failure; changed intent still fails deterministically.
    lockIdempotencyPrincipal(input.spaceId, input.actorUserId);
    const concurrent = existingOperation<T>(input.spaceId, input.actorUserId, key, input.action, intentSha256);
    if (concurrent) return concurrent;
    const response = input.run();
    db.prepare(`INSERT INTO journey_saved_view_operations
      (id,space_id,actor_user_id,idempotency_key,action,intent_sha256,response_json,created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), input.spaceId, input.actorUserId, key,
        input.action, intentSha256, JSON.stringify(response), nowIso());
    return { ...response, replayed: false as const };
  })();
}

function readActiveRow(spaceId: string, viewId: string) {
  const row = db.prepare("SELECT * FROM journey_saved_views WHERE id=? AND space_id=? AND state='active'")
    .get(viewId, spaceId) as any;
  if (!row) throw new JourneySavedViewError('Saved view not found.', 404, 'JOURNEY_SAVED_VIEW_NOT_FOUND');
  return row;
}

/** Read the row a mutation just reported. A replayed receipt proves the write
 * succeeded once, so a missing row means it was deleted afterwards; reporting
 * that as a plain 404 "not found" misrepresents a correct replay as a failure. */
function readMutatedRow(spaceId: string, viewId: string, replayed: boolean) {
  const row = db.prepare("SELECT * FROM journey_saved_views WHERE id=? AND space_id=? AND state='active'")
    .get(viewId, spaceId) as any;
  if (row) return row;
  if (replayed) {
    throw new JourneySavedViewError('This request was already applied and the saved view has since been deleted.',
      409, 'JOURNEY_SAVED_VIEW_REPLAY_UNAVAILABLE', { viewId });
  }
  throw new JourneySavedViewError('Saved view not found.', 404, 'JOURNEY_SAVED_VIEW_NOT_FOUND');
}

function readDeletedRow(spaceId: string, viewId: string) {
  const row = db.prepare("SELECT * FROM journey_saved_views WHERE id=? AND space_id=? AND state='deleted'")
    .get(viewId, spaceId) as any;
  if (!row) throw new JourneySavedViewError('Deleted saved view not found.', 404, 'JOURNEY_SAVED_VIEW_NOT_FOUND');
  return row;
}

export function createJourneySavedView(input: {
  spaceId: string; actorUserId: string; definitionId: string; name: string;
  visibility: JourneySavedViewVisibility; config: unknown; idempotencyKey: string;
}) {
  assertEnabled(input.spaceId);
  const role = membershipRole(input.spaceId, input.actorUserId);
  const name = String(input.name || '').trim();
  if (!name || name.length > journeySavedViewLimits.nameCharacters) {
    throw new JourneySavedViewError('A saved view requires a bounded name.', 400, 'JOURNEY_SAVED_VIEW_NAME_INVALID');
  }
  if (input.visibility === 'space' && !canEditShared(role)) {
    throw new JourneySavedViewError('Only space editors can create shared views.', 403, 'JOURNEY_SAVED_VIEW_SHARED_FORBIDDEN');
  }
  const normalized = canonicalConfig(input.config);
  validateReferences(input.spaceId, input.actorUserId, input.definitionId, normalized.config);
  const intent = { definitionId: input.definitionId, name, visibility: input.visibility, config: normalized.config };
  const result = idempotentMutation({
    spaceId: input.spaceId, actorUserId: input.actorUserId, key: input.idempotencyKey,
    action: 'view.create', intent, run: () => {
      lockSpaceForQuota(input.spaceId);
      const current = Number((db.prepare("SELECT COUNT(*) count FROM journey_saved_views WHERE space_id=? AND state='active'")
        .get(input.spaceId) as any)?.count || 0);
      assertSubscriptionQuota(input.spaceId, 'journeySavedViews', current, 1);
      const id = crypto.randomUUID(); const at = nowIso();
      db.prepare(`INSERT INTO journey_saved_views
        (id,space_id,definition_id,name,visibility,owner_user_id,binding_policy,bound_version_id,
          comparison_definition_id,comparison_version_id,schema_version,config_json,config_sha256,state,revision,
          idempotency_key,intent_sha256,created_by_user_id,updated_by_user_id,created_at,updated_at,deleted_at,retention_expires_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'active',1,?,?,?,?,?,?,NULL,NULL)`)
        .run(id, input.spaceId, input.definitionId, name, input.visibility, input.actorUserId,
          normalized.config.binding.policy, normalized.config.binding.versionId,
          normalized.config.comparisonTarget?.definitionId || null, normalized.config.comparisonTarget?.versionId || null,
          JOURNEY_SAVED_VIEW_SCHEMA_VERSION, normalized.serialized, normalized.checksum,
          input.idempotencyKey, sha256(JSON.stringify(intent)), input.actorUserId, input.actorUserId, at, at);
      insertReferences(id, input.spaceId, normalized.config);
      audit({ spaceId: input.spaceId, actorUserId: input.actorUserId, action: 'view.created', viewId: id,
        definitionId: input.definitionId, viewRevision: 1,
        detail: { visibility: input.visibility, checksum: normalized.checksum } });
      return { viewId: id, revision: 1 };
    }
  });
  const row = readMutatedRow(input.spaceId, String(result.viewId), result.replayed);
  return { view: rowView(row), replayed: result.replayed };
}

export function updateJourneySavedView(input: {
  spaceId: string; actorUserId: string; viewId: string; expectedRevision: number;
  name: string; visibility: JourneySavedViewVisibility; config: unknown; idempotencyKey: string;
}) {
  assertEnabled(input.spaceId);
  const role = membershipRole(input.spaceId, input.actorUserId);
  const row = readActiveRow(input.spaceId, input.viewId);
  assertCanManageRow(row, input.actorUserId, role);
  if (input.visibility === 'space' && !canEditShared(role)) {
    throw new JourneySavedViewError('Only space editors can share a view.', 403, 'JOURNEY_SAVED_VIEW_SHARED_FORBIDDEN');
  }
  const name = String(input.name || '').trim();
  if (!name || name.length > journeySavedViewLimits.nameCharacters) {
    throw new JourneySavedViewError('A saved view requires a bounded name.', 400, 'JOURNEY_SAVED_VIEW_NAME_INVALID');
  }
  const normalized = canonicalConfig(input.config);
  validateReferences(input.spaceId, input.actorUserId, row.definition_id, normalized.config);
  const intent = { viewId: input.viewId, expectedRevision: input.expectedRevision, name,
    visibility: input.visibility, config: normalized.config };
  const result = idempotentMutation({
    spaceId: input.spaceId, actorUserId: input.actorUserId, key: input.idempotencyKey,
    action: 'view.update', intent, run: () => {
      const at = nowIso();
      const changed = db.prepare(`UPDATE journey_saved_views SET name=?,visibility=?,binding_policy=?,bound_version_id=?,
        comparison_definition_id=?,comparison_version_id=?,config_json=?,config_sha256=?,revision=revision+1,
        updated_by_user_id=?,updated_at=? WHERE id=? AND space_id=? AND state='active' AND revision=?`)
        .run(name, input.visibility, normalized.config.binding.policy, normalized.config.binding.versionId,
          normalized.config.comparisonTarget?.definitionId || null, normalized.config.comparisonTarget?.versionId || null,
          normalized.serialized, normalized.checksum, input.actorUserId, at, input.viewId, input.spaceId,
          input.expectedRevision).changes;
      if (changed !== 1) throw new JourneySavedViewError('This saved view changed since it was opened.', 409,
        'JOURNEY_SAVED_VIEW_REVISION_CONFLICT');
      db.prepare('DELETE FROM journey_saved_view_references WHERE view_id=? AND space_id=?').run(input.viewId, input.spaceId);
      insertReferences(input.viewId, input.spaceId, normalized.config);
      const revision = input.expectedRevision + 1;
      // Defaults are exact view+revision selections. Never let an edit
      // silently retarget another user's default to content they did not
      // choose; stale selections are removed and can be explicitly reselected.
      db.prepare('DELETE FROM journey_saved_view_selections WHERE view_id=? AND space_id=?')
        .run(input.viewId, input.spaceId);
      audit({ spaceId: input.spaceId, actorUserId: input.actorUserId, action: 'view.updated', viewId: input.viewId,
        definitionId: row.definition_id, viewRevision: revision, detail: { visibility: input.visibility, checksum: normalized.checksum } });
      return { viewId: input.viewId, revision };
    }
  });
  return { view: rowView(readMutatedRow(input.spaceId, String(result.viewId), result.replayed)), replayed: result.replayed };
}

export function duplicateJourneySavedView(input: {
  spaceId: string; actorUserId: string; viewId: string; expectedRevision: number; name?: string;
  visibility?: JourneySavedViewVisibility; idempotencyKey: string;
}) {
  assertEnabled(input.spaceId);
  const role = membershipRole(input.spaceId, input.actorUserId);
  const sourceRow = readActiveRow(input.spaceId, input.viewId);
  if (!canReadRow(sourceRow, input.actorUserId)) throw new JourneySavedViewError('Saved view not found.', 404, 'JOURNEY_SAVED_VIEW_NOT_FOUND');
  if (Number(sourceRow.revision) !== input.expectedRevision) throw new JourneySavedViewError(
    'This saved view changed since it was opened.', 409, 'JOURNEY_SAVED_VIEW_REVISION_CONFLICT');
  const source = rowView(sourceRow);
  validateReferences(input.spaceId, input.actorUserId, source.definitionId, source.config);
  const visibility = input.visibility || 'private';
  if (visibility === 'space' && !canEditShared(role)) throw new JourneySavedViewError(
    'Only space editors can create shared views.', 403, 'JOURNEY_SAVED_VIEW_SHARED_FORBIDDEN');
  const name = String(input.name || `${source.name} copy`).trim().slice(0, journeySavedViewLimits.nameCharacters);
  if (!name) throw new JourneySavedViewError('A duplicate requires a name.', 400, 'JOURNEY_SAVED_VIEW_NAME_INVALID');
  const normalized = canonicalConfig(source.config);
  const result = idempotentMutation({
    spaceId: input.spaceId, actorUserId: input.actorUserId, key: input.idempotencyKey, action: 'view.duplicate',
    intent: { sourceViewId: source.id, sourceRevision: source.revision, name, visibility }, run: () => {
      lockSpaceForQuota(input.spaceId);
      const current = Number((db.prepare("SELECT COUNT(*) count FROM journey_saved_views WHERE space_id=? AND state='active'")
        .get(input.spaceId) as any)?.count || 0);
      assertSubscriptionQuota(input.spaceId, 'journeySavedViews', current, 1);
      const id = crypto.randomUUID(); const at = nowIso();
      const duplicateIntent = { sourceViewId: source.id, sourceRevision: source.revision, name, visibility };
      db.prepare(`INSERT INTO journey_saved_views
        (id,space_id,definition_id,name,visibility,owner_user_id,binding_policy,bound_version_id,
          comparison_definition_id,comparison_version_id,schema_version,config_json,config_sha256,state,revision,
          idempotency_key,intent_sha256,created_by_user_id,updated_by_user_id,created_at,updated_at,deleted_at,retention_expires_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'active',1,?,?,?,?,?,?,NULL,NULL)`)
        .run(id, input.spaceId, source.definitionId, name, visibility, input.actorUserId,
          source.config.binding.policy, source.config.binding.versionId,
          source.config.comparisonTarget?.definitionId || null, source.config.comparisonTarget?.versionId || null,
          JOURNEY_SAVED_VIEW_SCHEMA_VERSION, normalized.serialized, normalized.checksum,
          input.idempotencyKey, sha256(JSON.stringify(duplicateIntent)), input.actorUserId, input.actorUserId, at, at);
      insertReferences(id, input.spaceId, source.config);
      audit({ spaceId: input.spaceId, actorUserId: input.actorUserId, action: 'view.duplicated',
        viewId: id, definitionId: source.definitionId, viewRevision: 1,
        detail: { sourceViewId: source.id, sourceRevision: source.revision, checksum: normalized.checksum } });
      return { viewId: id, revision: 1 };
    }
  });
  return { view: rowView(readMutatedRow(input.spaceId, String(result.viewId), result.replayed)), replayed: result.replayed };
}

export function deleteJourneySavedView(input: {
  spaceId: string; actorUserId: string; viewId: string; expectedRevision: number; reason: string; idempotencyKey: string;
}) {
  assertEnabled(input.spaceId);
  const role = membershipRole(input.spaceId, input.actorUserId);
  const reason = String(input.reason || '').trim();
  if (reason.length < 3 || reason.length > 500) throw new JourneySavedViewError(
    'Deleting a saved view requires a short reason.', 400, 'JOURNEY_SAVED_VIEW_DELETE_REASON_REQUIRED');
  return idempotentMutation({
    spaceId: input.spaceId, actorUserId: input.actorUserId, key: input.idempotencyKey, action: 'view.delete',
    intent: { viewId: input.viewId, expectedRevision: input.expectedRevision, reason }, run: () => {
      const row = readActiveRow(input.spaceId, input.viewId);
      assertCanManageRow(row, input.actorUserId, role);
      const at = nowIso();
      const expiry = new Date(Date.parse(at) + settings(input.spaceId).retentionDays * 86_400_000).toISOString();
      const changed = db.prepare(`UPDATE journey_saved_views SET state='deleted',revision=revision+1,deleted_at=?,
        retention_expires_at=?,updated_by_user_id=?,updated_at=? WHERE id=? AND space_id=? AND state='active' AND revision=?`)
        .run(at, expiry, input.actorUserId, at, input.viewId, input.spaceId, input.expectedRevision).changes;
      if (changed !== 1) throw new JourneySavedViewError('This saved view changed since it was opened.', 409,
        'JOURNEY_SAVED_VIEW_REVISION_CONFLICT');
      db.prepare('DELETE FROM journey_saved_view_selections WHERE view_id=? AND space_id=?').run(input.viewId, input.spaceId);
      audit({ spaceId: input.spaceId, actorUserId: input.actorUserId, action: 'view.deleted', viewId: input.viewId,
        definitionId: row.definition_id, viewRevision: input.expectedRevision + 1,
        detail: { reasonCode: 'user_requested', reasonSha256: sha256(reason), retentionExpiresAt: expiry } });
      return { viewId: input.viewId, deleted: true, revision: input.expectedRevision + 1 };
    }
  });
}

export function restoreJourneySavedView(input: {
  spaceId: string; actorUserId: string; viewId: string; expectedRevision: number; idempotencyKey: string;
}) {
  assertEnabled(input.spaceId);
  const role = membershipRole(input.spaceId, input.actorUserId);
  return idempotentMutation({
    spaceId: input.spaceId, actorUserId: input.actorUserId, key: input.idempotencyKey, action: 'view.restore',
    intent: { viewId: input.viewId, expectedRevision: input.expectedRevision }, run: () => {
      const row = readDeletedRow(input.spaceId, input.viewId);
      assertCanManageRow(row, input.actorUserId, role);
      if (Date.parse(String(row.retention_expires_at || '')) <= Date.now()) {
        throw new JourneySavedViewError('This saved view has passed its retention window.', 410,
          'JOURNEY_SAVED_VIEW_RETENTION_EXPIRED');
      }
      const view = rowView(row);
      validateReferences(input.spaceId, input.actorUserId, row.definition_id, view.config);
      lockSpaceForQuota(input.spaceId);
      const current = Number((db.prepare("SELECT COUNT(*) count FROM journey_saved_views WHERE space_id=? AND state='active'")
        .get(input.spaceId) as any)?.count || 0);
      assertSubscriptionQuota(input.spaceId, 'journeySavedViews', current, 1);
      const at = nowIso();
      const changed = db.prepare(`UPDATE journey_saved_views SET state='active',revision=revision+1,deleted_at=NULL,
        retention_expires_at=NULL,updated_by_user_id=?,updated_at=?
        WHERE id=? AND space_id=? AND state='deleted' AND revision=? AND retention_expires_at>?`)
        .run(input.actorUserId, at, input.viewId, input.spaceId, input.expectedRevision, at).changes;
      if (changed !== 1) throw new JourneySavedViewError('This deleted view changed or expired before it could be restored.',
        409, 'JOURNEY_SAVED_VIEW_REVISION_CONFLICT');
      const revision = input.expectedRevision + 1;
      audit({ spaceId: input.spaceId, actorUserId: input.actorUserId, action: 'view.restored', viewId: input.viewId,
        definitionId: row.definition_id, viewRevision: revision, detail: { checksum: row.config_sha256 } });
      return { viewId: input.viewId, restored: true, revision };
    }
  });
}

export function resolveJourneySavedView(input: {
  spaceId: string; actorUserId: string; definitionId: string; viewId: string; expectedRevision: number;
}): JourneySavedViewResolved {
  assertEnabled(input.spaceId);
  membershipRole(input.spaceId, input.actorUserId);
  const row = readActiveRow(input.spaceId, input.viewId);
  if (row.definition_id !== input.definitionId || !canReadRow(row, input.actorUserId)) {
    throw new JourneySavedViewError('Saved view not found.', 404, 'JOURNEY_SAVED_VIEW_NOT_FOUND');
  }
  if (Number(row.revision) !== input.expectedRevision) throw new JourneySavedViewError(
    'The requested saved-view revision is no longer current.', 409, 'JOURNEY_SAVED_VIEW_REVISION_CONFLICT');
  const view = rowView(row);
  const resolved = validateReferences(input.spaceId, input.actorUserId, input.definitionId, view.config);
  return {
    view,
    map: applyJourneySavedViewFilters(resolved.map, view.config, input.spaceId),
    comparisonMap: resolved.comparisonMap
      ? applyJourneySavedViewFilters(resolved.comparisonMap, view.config, input.spaceId) : null,
    analytics: resolveAnalyticsContext(input.spaceId, input.definitionId, view.config)
  };
}

export function listJourneySavedViews(input: { spaceId: string; actorUserId: string; definitionId: string }) {
  assertEnabled(input.spaceId);
  membershipRole(input.spaceId, input.actorUserId);
  const mapCache: JourneyMapCache = new Map();
  requireDefinitionMap(input.spaceId, input.actorUserId, input.definitionId, undefined, mapCache);
  const rows = db.prepare(`SELECT * FROM journey_saved_views WHERE space_id=? AND definition_id=? AND state='active'
    AND (visibility='space' OR owner_user_id=?) ORDER BY lower(name),id`).all(input.spaceId, input.definitionId, input.actorUserId) as any[];
  const views: Array<JourneySavedView | JourneySavedViewUnavailable> = [];
  let unavailableCount = 0;
  for (const row of rows) {
    try {
      const view = rowView(row);
      validateReferences(input.spaceId, input.actorUserId, input.definitionId, view.config, mapCache);
      views.push(view);
    } catch (error) {
      const unavailable = (error instanceof JourneySavedViewError
        || error instanceof JourneyMapError || error instanceof SubscriptionEntitlementError)
        && error.status >= 400 && error.status < 500;
      if (!unavailable) throw error;
      unavailableCount += 1;
      views.push({
        id: row.id, definitionId: row.definition_id, name: row.name, visibility: row.visibility,
        ownerUserId: row.owner_user_id, revision: Number(row.revision), schemaVersion: Number(row.schema_version),
        state: row.state, config: null, checksum: null, availability: 'unavailable',
        createdAt: row.created_at, updatedAt: row.updated_at,
        deletedAt: row.deleted_at || null, retentionExpiresAt: row.retention_expires_at || null
      });
    }
  }
  const selection = db.prepare(`SELECT view_id,view_revision,revision,updated_at FROM journey_saved_view_selections
    WHERE space_id=? AND user_id=? AND definition_id=?`).get(input.spaceId, input.actorUserId, input.definitionId) as any;
  const selected = selection && views.some((view) => view.id === selection.view_id
    && view.revision === Number(selection.view_revision) && !('availability' in view))
    ? { viewId: selection.view_id, viewRevision: Number(selection.view_revision),
      revision: Number(selection.revision), updatedAt: selection.updated_at }
    : null;
  return { views, selected, unavailableCount, settings: settings(input.spaceId), limits: journeySavedViewLimits };
}

export function listDeletedJourneySavedViews(input: { spaceId: string; actorUserId: string; definitionId: string }) {
  assertEnabled(input.spaceId);
  const role = membershipRole(input.spaceId, input.actorUserId);
  requireDefinitionMap(input.spaceId, input.actorUserId, input.definitionId);
  const rows = db.prepare(`SELECT id,definition_id,name,visibility,owner_user_id,revision,state,created_at,updated_at,
      deleted_at,retention_expires_at FROM journey_saved_views
    WHERE space_id=? AND definition_id=? AND state='deleted'
      AND ((visibility='private' AND owner_user_id=?) OR (visibility='space' AND ?=1))
    ORDER BY deleted_at DESC,id LIMIT 100`).all(input.spaceId, input.definitionId, input.actorUserId,
      canEditShared(role) ? 1 : 0) as any[];
  return { views: rows.map((row) => ({
    id: row.id, definitionId: row.definition_id, name: row.name, visibility: row.visibility,
    ownerUserId: row.owner_user_id, revision: Number(row.revision), state: row.state,
    createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at,
    retentionExpiresAt: row.retention_expires_at
  })) };
}

export function listJourneySavedViewAudit(input: {
  spaceId: string; actorUserId: string; definitionId: string; limit?: number;
}) {
  assertEnabled(input.spaceId);
  const role = membershipRole(input.spaceId, input.actorUserId);
  if (!canEditShared(role)) throw new JourneySavedViewError('Only space editors can inspect saved-view audit history.',
    403, 'JOURNEY_SAVED_VIEW_AUDIT_FORBIDDEN');
  requireDefinitionMap(input.spaceId, input.actorUserId, input.definitionId);
  const limit = Math.max(1, Math.min(100, Math.trunc(Number(input.limit) || 50)));
  const rows = db.prepare(`SELECT id,actor_user_id,action,view_id,definition_id,view_revision,detail_json,created_at
    FROM journey_saved_view_audit_events WHERE space_id=? AND definition_id=?
    ORDER BY created_at DESC,id DESC LIMIT ?`).all(input.spaceId, input.definitionId, limit) as any[];
  return { events: rows.map((row) => ({
    id: row.id, actorUserId: row.actor_user_id || null, action: row.action, viewId: row.view_id || null,
    definitionId: row.definition_id || null, viewRevision: row.view_revision ? Number(row.view_revision) : null,
    detail: safeJson(row.detail_json, {}), createdAt: row.created_at
  })) };
}

export function listJourneySavedViewEvidenceOptions(input: {
  spaceId: string; actorUserId: string; definitionId: string; versionId: string; limit?: number;
}) {
  assertEnabled(input.spaceId);
  assertSubscriptionFeature(input.spaceId, 'journeyEvidence');
  membershipRole(input.spaceId, input.actorUserId);
  const map = requireDefinitionMap(input.spaceId, input.actorUserId, input.definitionId, input.versionId);
  const targets = new Map<string, { targetType: string; targetLabel: string }>([
    [input.definitionId, { targetType: 'definition', targetLabel: map.definition.name }],
    ...map.stages.map((stage) => [stage.id, { targetType: 'stage', targetLabel: stage.name }] as const),
    ...map.cards.map((card) => [card.id, { targetType: 'card', targetLabel: card.title }] as const),
    ...map.personas.map((persona) => [persona.id, { targetType: 'persona', targetLabel: persona.name }] as const)
  ]);
  const targetIds = [...targets.keys()];
  const limit = Math.max(1, Math.min(200, Math.trunc(Number(input.limit) || 200)));
  const rows = targetIds.length ? db.prepare(`SELECT id,target_type,target_id,assessment,source_type,source_ref
    FROM journey_evidence_links WHERE space_id=? AND target_id IN (${targetIds.map(() => '?').join(',')})
      AND invalidated_at IS NULL ORDER BY created_at,id LIMIT ?`).all(input.spaceId, ...targetIds, limit) as any[] : [];
  const options: Array<{
    id: string; targetType: string; targetId: string; targetLabel: string;
    sourceType: string; sourceLabel: string; assessment: string;
  }> = [];
  for (const row of rows) {
    const target = targets.get(row.target_id);
    if (!target || target.targetType !== row.target_type) continue;
    try {
      const source = getEvidenceLinkSource(input.spaceId, input.actorUserId, row.id);
      options.push({
        id: row.id, targetType: row.target_type, targetId: row.target_id,
        targetLabel: target.targetLabel, sourceType: row.source_type,
        sourceLabel: source.label, assessment: row.assessment
      });
    } catch (error) {
      if (error instanceof JourneyMapError && error.status >= 400 && error.status < 500) continue;
      throw error;
    }
  }
  return { evidence: options };
}

export function selectDefaultJourneySavedView(input: {
  spaceId: string; actorUserId: string; definitionId: string; viewId: string; expectedViewRevision: number;
  idempotencyKey: string;
}) {
  assertEnabled(input.spaceId);
  membershipRole(input.spaceId, input.actorUserId);
  return idempotentMutation({
    spaceId: input.spaceId, actorUserId: input.actorUserId, key: input.idempotencyKey, action: 'default.select',
    intent: { definitionId: input.definitionId, viewId: input.viewId, viewRevision: input.expectedViewRevision }, run: () => {
      const resolved = resolveJourneySavedView({ spaceId: input.spaceId, actorUserId: input.actorUserId,
        definitionId: input.definitionId, viewId: input.viewId, expectedRevision: input.expectedViewRevision });
      const at = nowIso();
      db.prepare(`INSERT INTO journey_saved_view_selections
        (space_id,user_id,definition_id,view_id,view_revision,revision,updated_at) VALUES (?,?,?,?,?,1,?)
        ON CONFLICT(space_id,user_id,definition_id) DO UPDATE SET view_id=excluded.view_id,
          view_revision=excluded.view_revision,revision=journey_saved_view_selections.revision+1,updated_at=excluded.updated_at`)
        .run(input.spaceId, input.actorUserId, input.definitionId, input.viewId, input.expectedViewRevision, at);
      audit({ spaceId: input.spaceId, actorUserId: input.actorUserId, action: 'default.selected', viewId: input.viewId,
        definitionId: input.definitionId, viewRevision: input.expectedViewRevision,
        detail: { checksum: resolved.view.checksum } });
      return { viewId: input.viewId, viewRevision: input.expectedViewRevision, selected: true };
    }
  });
}

export function resetDefaultJourneySavedView(input: {
  spaceId: string; actorUserId: string; definitionId: string; idempotencyKey: string;
}) {
  assertEnabled(input.spaceId);
  membershipRole(input.spaceId, input.actorUserId);
  requireDefinitionMap(input.spaceId, input.actorUserId, input.definitionId);
  return idempotentMutation({
    spaceId: input.spaceId, actorUserId: input.actorUserId, key: input.idempotencyKey, action: 'default.reset',
    intent: { definitionId: input.definitionId }, run: () => {
      const existing = db.prepare(`SELECT view_id,view_revision FROM journey_saved_view_selections
        WHERE space_id=? AND user_id=? AND definition_id=?`).get(input.spaceId, input.actorUserId, input.definitionId) as any;
      db.prepare('DELETE FROM journey_saved_view_selections WHERE space_id=? AND user_id=? AND definition_id=?')
        .run(input.spaceId, input.actorUserId, input.definitionId);
      audit({ spaceId: input.spaceId, actorUserId: input.actorUserId, action: 'default.reset',
        viewId: existing?.view_id, definitionId: input.definitionId, viewRevision: existing?.view_revision,
        detail: { resetTo: 'unfiltered_current' } });
      return { reset: true };
    }
  });
}

export function updateJourneySavedViewSettings(input: {
  spaceId: string; actorUserId: string; expectedRevision: number; enabled: boolean; retentionDays: number;
  idempotencyKey: string;
}) {
  assertSubscriptionFeature(input.spaceId, 'journeySavedViews');
  const role = membershipRole(input.spaceId, input.actorUserId);
  if (!canEditShared(role)) throw new JourneySavedViewError('Only space editors can manage saved-view settings.', 403,
    'JOURNEY_SAVED_VIEW_SETTINGS_FORBIDDEN');
  const retentionDays = Math.trunc(Number(input.retentionDays));
  if (retentionDays < journeySavedViewLimits.retentionDays.minimum
    || retentionDays > journeySavedViewLimits.retentionDays.maximum) throw new JourneySavedViewError(
      'Choose a valid saved-view retention period.', 400, 'JOURNEY_SAVED_VIEW_RETENTION_INVALID');
  return idempotentMutation({
    spaceId: input.spaceId, actorUserId: input.actorUserId, key: input.idempotencyKey, action: 'settings.update',
    intent: { expectedRevision: input.expectedRevision, enabled: input.enabled, retentionDays }, run: () => {
      const current = settings(input.spaceId); const at = nowIso();
      if (current.revision !== input.expectedRevision) throw new JourneySavedViewError(
        'Saved-view settings changed since they were opened.', 409, 'JOURNEY_SAVED_VIEW_SETTINGS_CONFLICT');
      if (current.revision === 0) {
        db.prepare(`INSERT INTO journey_saved_view_settings
          (space_id,enabled,retention_days,revision,updated_by_user_id,created_at,updated_at) VALUES (?,?,?,1,?,?,?)`)
          .run(input.spaceId, input.enabled ? 1 : 0, retentionDays, input.actorUserId, at, at);
      } else {
        const changed = db.prepare(`UPDATE journey_saved_view_settings SET enabled=?,retention_days=?,revision=revision+1,
          updated_by_user_id=?,updated_at=? WHERE space_id=? AND revision=?`).run(input.enabled ? 1 : 0,
          retentionDays, input.actorUserId, at, input.spaceId, input.expectedRevision).changes;
        if (changed !== 1) throw new JourneySavedViewError('Saved-view settings changed since they were opened.', 409,
          'JOURNEY_SAVED_VIEW_SETTINGS_CONFLICT');
      }
      const next = settings(input.spaceId);
      audit({ spaceId: input.spaceId, actorUserId: input.actorUserId, action: 'settings.updated',
        detail: { enabled: input.enabled, retentionDays, revision: next.revision } });
      return { settings: next };
    }
  });
}

export function recordJourneySavedViewExport(input: {
  spaceId: string; actorUserId: string; view: JourneySavedView; format: string;
}) {
  audit({ spaceId: input.spaceId, actorUserId: input.actorUserId, action: 'view.exported', viewId: input.view.id,
    definitionId: input.view.definitionId, viewRevision: input.view.revision,
    detail: { format: input.format, checksum: input.view.checksum } });
}

export function purgeExpiredJourneySavedViews(at = nowIso()) {
  const rows = db.prepare(`SELECT id,space_id,definition_id,revision FROM journey_saved_views
    WHERE state='deleted' AND retention_expires_at<=? ORDER BY retention_expires_at,id LIMIT 500`).all(at) as any[];
  let purged = 0;
  for (const row of rows) {
    const changed = db.transaction(() => {
      const removed = db.prepare('DELETE FROM journey_saved_views WHERE id=? AND space_id=? AND state=? AND retention_expires_at<=?')
        .run(row.id, row.space_id, 'deleted', at).changes;
      if (removed !== 1) return 0;
      audit({ spaceId: row.space_id, actorUserId: null, action: 'retention.purged', viewId: row.id,
        definitionId: row.definition_id, viewRevision: Number(row.revision), detail: { policy: 'retention_expired' } });
      return 1;
    })();
    purged += changed;
  }
  return { purged };
}

export function journeySavedViewPlanState(spaceId: string) {
  const effective = effectiveSubscriptionForSpace(spaceId);
  return {
    enabledByPlan: effective.plan.features.journeySavedViews,
    limit: effective.plan.limits.journeySavedViews,
    killSwitch: settings(spaceId)
  };
}
