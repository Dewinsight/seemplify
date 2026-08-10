import crypto from 'node:crypto';
import { db } from './database.js';
import {
  JourneyHierarchyError,
  journeyHierarchyBreadcrumbTrails,
  journeyHierarchyLimits,
  rollUpJourneyHierarchyHealth,
  traverseJourneyHierarchy,
  validateJourneyHierarchy,
  type JourneyHierarchyHealthObservation,
  type JourneyHierarchyHealthPolicy,
  type JourneyHierarchyHealthResult,
  type JourneyHierarchyLink,
  type JourneyHierarchyLinkType,
  type JourneyHierarchyLifecycle,
  type JourneyHierarchyNode,
  type JourneyHierarchyReviewState,
  type JourneyHierarchyVariantDimension
} from './journeyHierarchy.js';
import { assertJourneyCapability, recordJourneyGovernedActivity } from './journeyCollaboration.js';
import { formulaSafeCsvCell } from './journeyMapExports.js';
import { assertSubscriptionFeature, assertSubscriptionQuota } from './subscriptionEntitlements.js';

export class JourneyHierarchyRepositoryError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = 'JOURNEY_HIERARCHY_INVALID',
    public details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'JourneyHierarchyRepositoryError';
  }
}

export type JourneyHierarchyLinkRecord = JourneyHierarchyLink & {
  fromVersionId: string | null;
  toVersionId: string | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type JourneyTaxonomyTerm = {
  id: string;
  kind: 'product' | 'geography' | 'channel' | 'segment' | 'tag' | 'business_unit';
  name: string;
  parentTermId: string | null;
  lifecycle: 'active' | 'retired';
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type JourneyHierarchySettings = {
  /** Backward-compatible alias used by the initial hierarchy list contract. */
  enabled: boolean;
  hierarchyEnabled: boolean;
  blueprintsEnabled: boolean;
  maximumDepth: number;
  maximumLinks: number;
  revision: number;
  updatedAt: string | null;
};

type JourneyHierarchyHealthPolicyRecord = JourneyHierarchyHealthPolicy & {
  id: string;
  name: string;
  lifecycle: 'draft' | 'active' | 'retired';
  revision: number;
  configurationSha256: string;
  createdAt: string;
  updatedAt: string;
};

function ensureSqliteSchema() {
  if (db.provider !== 'sqlite') return;
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS journey_hierarchy_definitions_tenant_identity
      ON journey_definitions(id,space_id);
    CREATE UNIQUE INDEX IF NOT EXISTS journey_hierarchy_versions_tenant_identity
      ON journey_map_versions(id,definition_id,space_id);
    CREATE TABLE IF NOT EXISTS journey_hierarchy_settings (
      space_id TEXT PRIMARY KEY REFERENCES spaces(id) ON DELETE CASCADE,
      hierarchy_enabled INTEGER NOT NULL DEFAULT 1 CHECK(hierarchy_enabled IN (0,1)),
      blueprints_enabled INTEGER NOT NULL DEFAULT 1 CHECK(blueprints_enabled IN (0,1)),
      maximum_depth INTEGER NOT NULL DEFAULT 12 CHECK(maximum_depth BETWEEN 1 AND 32),
      maximum_links INTEGER NOT NULL DEFAULT 2000 CHECK(maximum_links BETWEEN 1 AND 100000),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
      updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS journey_taxonomy_terms (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('product','geography','channel','segment','tag','business_unit')),
      name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
      normalized_name TEXT NOT NULL CHECK(length(normalized_name) BETWEEN 1 AND 160),
      parent_term_id TEXT, lifecycle TEXT NOT NULL DEFAULT 'active' CHECK(lifecycle IN ('active','retired')),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(id,space_id), UNIQUE(space_id,kind,normalized_name),
      FOREIGN KEY(parent_term_id,space_id) REFERENCES journey_taxonomy_terms(id,space_id) ON DELETE NO ACTION,
      CHECK(parent_term_id IS NULL OR parent_term_id<>id)
    );
    CREATE INDEX IF NOT EXISTS journey_taxonomy_terms_children
      ON journey_taxonomy_terms(space_id,parent_term_id,lifecycle,id);
    CREATE TABLE IF NOT EXISTS journey_definition_taxonomy (
      space_id TEXT NOT NULL, definition_id TEXT NOT NULL, term_id TEXT NOT NULL,
      assigned_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(space_id,definition_id,term_id),
      FOREIGN KEY(definition_id,space_id) REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(term_id,space_id) REFERENCES journey_taxonomy_terms(id,space_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS journey_definition_taxonomy_reverse
      ON journey_definition_taxonomy(space_id,term_id,definition_id);
    CREATE TABLE IF NOT EXISTS journey_hierarchy_links (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      link_type TEXT NOT NULL CHECK(link_type IN ('parent_child','stage_subjourney','variant','handoff','related')),
      from_definition_id TEXT NOT NULL, to_definition_id TEXT NOT NULL,
      from_version_id TEXT, to_version_id TEXT, from_stage_key TEXT, to_stage_key TEXT,
      variant_dimension TEXT, variant_value_id TEXT, handoff_owner_user_id TEXT REFERENCES users(id) ON DELETE NO ACTION,
      handoff_owner_team_id TEXT, review_state TEXT NOT NULL DEFAULT 'draft',
      reviewed_by_user_id TEXT REFERENCES users(id) ON DELETE NO ACTION, reviewed_at TEXT,
      lifecycle TEXT NOT NULL DEFAULT 'active' CHECK(lifecycle IN ('active','retired')),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(id,space_id), CHECK(from_definition_id<>to_definition_id),
      FOREIGN KEY(from_definition_id,space_id) REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(to_definition_id,space_id) REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(from_version_id,from_definition_id,space_id)
        REFERENCES journey_map_versions(id,definition_id,space_id) ON DELETE NO ACTION,
      FOREIGN KEY(to_version_id,to_definition_id,space_id)
        REFERENCES journey_map_versions(id,definition_id,space_id) ON DELETE NO ACTION
    );
    CREATE UNIQUE INDEX IF NOT EXISTS journey_hierarchy_links_logical_once
      ON journey_hierarchy_links(space_id,link_type,from_definition_id,to_definition_id,
        COALESCE(from_stage_key,''),COALESCE(to_stage_key,''),COALESCE(variant_dimension,''),COALESCE(variant_value_id,''));
    CREATE INDEX IF NOT EXISTS journey_hierarchy_links_from
      ON journey_hierarchy_links(space_id,from_definition_id,lifecycle,link_type,to_definition_id);
    CREATE INDEX IF NOT EXISTS journey_hierarchy_links_to
      ON journey_hierarchy_links(space_id,to_definition_id,lifecycle,link_type,from_definition_id);
    CREATE TABLE IF NOT EXISTS journey_hierarchy_health_policies (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
      lifecycle TEXT NOT NULL CHECK(lifecycle IN ('draft','active','retired')),
      configuration_json TEXT NOT NULL CHECK(json_valid(configuration_json)),
      configuration_sha256 TEXT NOT NULL CHECK(length(configuration_sha256)=64),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(id,space_id)
    );
    CREATE TABLE IF NOT EXISTS journey_hierarchy_health_snapshots (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      definition_id TEXT NOT NULL, policy_id TEXT NOT NULL, policy_version TEXT NOT NULL,
      policy_revision INTEGER NOT NULL CHECK(policy_revision>0),
      policy_configuration_sha256 TEXT NOT NULL CHECK(length(policy_configuration_sha256)=64),
      definition_revision INTEGER NOT NULL CHECK(definition_revision>0),
      score REAL CHECK(score IS NULL OR score BETWEEN 0 AND 100),
      status TEXT NOT NULL CHECK(status IN ('healthy','watch','at_risk','unknown')),
      explanation TEXT NOT NULL, components_json TEXT NOT NULL CHECK(json_valid(components_json)),
      child_lineage_json TEXT NOT NULL CHECK(json_valid(child_lineage_json)), calculated_at TEXT NOT NULL,
      UNIQUE(id,space_id),
      CHECK((status='unknown' AND score IS NULL) OR (status<>'unknown' AND score IS NOT NULL)),
      FOREIGN KEY(definition_id,space_id) REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(policy_id,space_id) REFERENCES journey_hierarchy_health_policies(id,space_id) ON DELETE NO ACTION
    );
    CREATE INDEX IF NOT EXISTS journey_hierarchy_health_history
      ON journey_hierarchy_health_snapshots(space_id,definition_id,calculated_at DESC,id);
  `);
}

ensureSqliteSchema();

function membershipRole(spaceId: string, userId: string) {
  const row = db.prepare('SELECT role FROM space_memberships WHERE space_id=? AND user_id=?').get(spaceId, userId) as
    { role?: string } | undefined;
  if (!row || !['owner', 'admin', 'member'].includes(String(row.role))) {
    throw new JourneyHierarchyRepositoryError('Space membership is required.', 403, 'JOURNEY_HIERARCHY_FORBIDDEN');
  }
  return row.role as 'owner' | 'admin' | 'member';
}

function assertRead(spaceId: string, userId: string) {
  assertSubscriptionFeature(spaceId, 'journeyHierarchy');
  return membershipRole(spaceId, userId);
}

function assertManage(spaceId: string, userId: string) {
  const role = assertRead(spaceId, userId);
  if (role === 'member') throw new JourneyHierarchyRepositoryError(
    'Only space owners and administrators can manage journey hierarchy.', 403, 'JOURNEY_HIERARCHY_MANAGE_REQUIRED');
  return role;
}

function mapDomainError(error: unknown): never {
  if (!(error instanceof JourneyHierarchyError)) throw error;
  const status = error.code.endsWith('NOT_FOUND') ? 404 : error.code.includes('CYCLE') || error.code.includes('DEPTH') ? 409 : 422;
  throw new JourneyHierarchyRepositoryError(error.message, status, error.code, error.details);
}

function rowToLink(row: any): JourneyHierarchyLinkRecord {
  return {
    id: String(row.id), spaceId: String(row.space_id), type: row.link_type,
    fromDefinitionId: String(row.from_definition_id), toDefinitionId: String(row.to_definition_id),
    fromVersionId: row.from_version_id || null, toVersionId: row.to_version_id || null,
    fromStageKey: row.from_stage_key || null, toStageKey: row.to_stage_key || null,
    variantDimension: row.variant_dimension || null, variantValueId: row.variant_value_id || null,
    handoffOwnerUserId: row.handoff_owner_user_id || null, handoffOwnerTeamId: row.handoff_owner_team_id || null,
    reviewState: row.review_state, reviewedByUserId: row.reviewed_by_user_id || null,
    reviewedAt: row.reviewed_at || null, lifecycle: row.lifecycle,
    revision: Number(row.revision), createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  };
}

function hierarchyNodes(spaceId: string): JourneyHierarchyNode[] {
  const rows = db.prepare(`SELECT id,space_id,name,owner_user_id,current_version_id
    FROM journey_definitions WHERE space_id=? ORDER BY name,id`).all(spaceId) as any[];
  const stageRows = db.prepare(`SELECT definition.id definition_id,stage.stage_key
    FROM journey_definitions definition JOIN journey_map_stages stage ON stage.version_id=definition.current_version_id
    WHERE definition.space_id=? ORDER BY definition.id,stage.ordinal,stage.stage_key`).all(spaceId) as any[];
  const taxonomyRows = db.prepare(`SELECT definition_id,term_id FROM journey_definition_taxonomy
    WHERE space_id=? ORDER BY definition_id,term_id`).all(spaceId) as any[];
  const stages = new Map<string, string[]>();
  const terms = new Map<string, string[]>();
  for (const row of stageRows) (stages.get(String(row.definition_id)) || (stages.set(String(row.definition_id), []), stages.get(String(row.definition_id))!))
    .push(String(row.stage_key));
  for (const row of taxonomyRows) (terms.get(String(row.definition_id)) || (terms.set(String(row.definition_id), []), terms.get(String(row.definition_id))!))
    .push(String(row.term_id));
  return rows.map((row) => ({
    definitionId: String(row.id), spaceId: String(row.space_id), name: String(row.name),
    ownerUserId: row.owner_user_id || null, stageKeys: stages.get(String(row.id)) || [],
    taxonomyTermIds: terms.get(String(row.id)) || []
  }));
}

function hierarchySettings(spaceId: string): JourneyHierarchySettings {
  const row = db.prepare('SELECT * FROM journey_hierarchy_settings WHERE space_id=?').get(spaceId) as any;
  return {
    enabled: row ? Boolean(row.hierarchy_enabled) : true,
    hierarchyEnabled: row ? Boolean(row.hierarchy_enabled) : true,
    blueprintsEnabled: row ? Boolean(row.blueprints_enabled) : true,
    maximumDepth: row ? Number(row.maximum_depth) : journeyHierarchyLimits.depth,
    maximumLinks: row ? Number(row.maximum_links) : journeyHierarchyLimits.links,
    revision: row ? Number(row.revision) : 0,
    updatedAt: row ? String(row.updated_at) : null
  };
}

function assertHierarchyEnabled(spaceId: string) {
  if (!hierarchySettings(spaceId).hierarchyEnabled) throw new JourneyHierarchyRepositoryError(
    'Journey hierarchy is disabled for this space.', 409, 'JOURNEY_HIERARCHY_DISABLED');
}

function databaseBoolean(value: boolean) {
  return db.provider === 'sqlite' ? Number(value) : value;
}

export function getJourneyHierarchySettings(input: { spaceId: string; actorUserId: string }) {
  assertRead(input.spaceId, input.actorUserId);
  return hierarchySettings(input.spaceId);
}

export function updateJourneyHierarchySettings(input: {
  spaceId: string; actorUserId: string; expectedRevision: number;
  hierarchyEnabled?: boolean; blueprintsEnabled?: boolean; maximumDepth?: number; maximumLinks?: number;
}) {
  assertManage(input.spaceId, input.actorUserId);
  if (input.blueprintsEnabled !== undefined) assertSubscriptionFeature(input.spaceId, 'journeyBlueprints');
  const current = hierarchySettings(input.spaceId);
  if (current.revision !== input.expectedRevision) throw new JourneyHierarchyRepositoryError(
    'The hierarchy settings changed before this update.', 409, 'JOURNEY_HIERARCHY_SETTINGS_REVISION_CONFLICT',
    { expectedRevision: input.expectedRevision, actualRevision: current.revision });
  const next = {
    hierarchyEnabled: input.hierarchyEnabled ?? current.hierarchyEnabled,
    blueprintsEnabled: input.blueprintsEnabled ?? current.blueprintsEnabled,
    maximumDepth: input.maximumDepth ?? current.maximumDepth,
    maximumLinks: input.maximumLinks ?? current.maximumLinks
  };
  const activeLinks = (db.prepare("SELECT COUNT(*) count FROM journey_hierarchy_links WHERE space_id=? AND lifecycle='active'")
    .get(input.spaceId) as any).count as number;
  if (next.maximumLinks < Number(activeLinks)) throw new JourneyHierarchyRepositoryError(
    'The maximum link setting cannot be lower than the current active link count.', 409,
    'JOURNEY_HIERARCHY_SETTINGS_LIMIT_CONFLICT', { activeLinks: Number(activeLinks), maximumLinks: next.maximumLinks });
  try {
    validateJourneyHierarchy(hierarchyNodes(input.spaceId),
      (db.prepare("SELECT * FROM journey_hierarchy_links WHERE space_id=? AND lifecycle='active'").all(input.spaceId) as any[])
        .map(rowToLink), { nodes: journeyHierarchyLimits.nodes, links: next.maximumLinks, depth: next.maximumDepth });
  } catch (error) { mapDomainError(error); }
  const at = new Date().toISOString();
  if (current.revision === 0) {
    const inserted = db.prepare(`INSERT INTO journey_hierarchy_settings
      (space_id,hierarchy_enabled,blueprints_enabled,maximum_depth,maximum_links,revision,updated_by_user_id,created_at,updated_at)
      VALUES (?,?,?,?,?,1,?,?,?) ON CONFLICT(space_id) DO NOTHING`).run(input.spaceId,
        databaseBoolean(next.hierarchyEnabled), databaseBoolean(next.blueprintsEnabled), next.maximumDepth, next.maximumLinks,
        input.actorUserId, at, at);
    if (!inserted.changes) throw new JourneyHierarchyRepositoryError('The hierarchy settings changed before this update.',
      409, 'JOURNEY_HIERARCHY_SETTINGS_REVISION_CONFLICT', { expectedRevision: 0 });
  } else {
    const updated = db.prepare(`UPDATE journey_hierarchy_settings SET hierarchy_enabled=?,blueprints_enabled=?,maximum_depth=?,
      maximum_links=?,revision=revision+1,updated_by_user_id=?,updated_at=? WHERE space_id=? AND revision=?`).run(
        databaseBoolean(next.hierarchyEnabled), databaseBoolean(next.blueprintsEnabled), next.maximumDepth, next.maximumLinks,
        input.actorUserId, at,
        input.spaceId, input.expectedRevision);
    if (!updated.changes) throw new JourneyHierarchyRepositoryError('The hierarchy settings changed before this update.',
      409, 'JOURNEY_HIERARCHY_SETTINGS_REVISION_CONFLICT', { expectedRevision: input.expectedRevision });
  }
  return hierarchySettings(input.spaceId);
}

export function listJourneyHierarchy(input: { spaceId: string; actorUserId: string; includeRetired?: boolean }) {
  assertRead(input.spaceId, input.actorUserId);
  const nodes = hierarchyNodes(input.spaceId);
  const records = db.prepare(`SELECT * FROM journey_hierarchy_links WHERE space_id=?
    ${input.includeRetired ? '' : "AND lifecycle='active'"} ORDER BY created_at,id`).all(input.spaceId) as any[];
  const links = records.map(rowToLink);
  const activeLinks = links.filter((link) => link.lifecycle !== 'retired');
  const settings = hierarchySettings(input.spaceId);
  let validation;
  try {
    validation = validateJourneyHierarchy(nodes, activeLinks, {
      nodes: journeyHierarchyLimits.nodes, links: settings.maximumLinks, depth: settings.maximumDepth
    });
  } catch (error) { mapDomainError(error); }
  return { nodes, links, validation, settings };
}

export function createJourneyHierarchyLink(input: {
  spaceId: string; actorUserId: string; type: JourneyHierarchyLinkType;
  fromDefinitionId: string; toDefinitionId: string; fromVersionId?: string | null; toVersionId?: string | null;
  fromStageKey?: string | null; toStageKey?: string | null;
  variantDimension?: JourneyHierarchyVariantDimension | null; variantValueId?: string | null;
  handoffOwnerUserId?: string | null; handoffOwnerTeamId?: string | null;
}) {
  assertManage(input.spaceId, input.actorUserId);
  const settings = hierarchySettings(input.spaceId);
  if (!settings.hierarchyEnabled) throw new JourneyHierarchyRepositoryError(
    'Journey hierarchy is disabled for this space.', 409, 'JOURNEY_HIERARCHY_DISABLED');
  return db.transaction(() => {
  if (db.provider === 'postgres') db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?,0))')
    .get(`journey-hierarchy-quota:${input.spaceId}`);
  // Retired links remain durable and restorable, so retained records occupy the
  // allowance and cannot be accumulated outside admission controls.
  const current = Number((db.prepare(`SELECT COUNT(*) count FROM journey_hierarchy_links
    WHERE space_id=?`).get(input.spaceId) as any).count);
  assertSubscriptionQuota(input.spaceId, 'journeyHierarchyLinks', current, 1);
  const now = new Date().toISOString();
  const candidate: JourneyHierarchyLinkRecord = {
    id: crypto.randomUUID(), spaceId: input.spaceId, type: input.type,
    fromDefinitionId: input.fromDefinitionId, toDefinitionId: input.toDefinitionId,
    fromVersionId: input.fromVersionId || null, toVersionId: input.toVersionId || null,
    fromStageKey: input.fromStageKey || null, toStageKey: input.toStageKey || null,
    variantDimension: input.variantDimension || null, variantValueId: input.variantValueId || null,
    handoffOwnerUserId: input.handoffOwnerUserId || null, handoffOwnerTeamId: input.handoffOwnerTeamId || null,
    reviewState: 'draft', reviewedByUserId: null, reviewedAt: null, lifecycle: 'active', revision: 1,
    createdAt: now, updatedAt: now
  };
  const nodes = hierarchyNodes(input.spaceId);
  const existing = (db.prepare(`SELECT * FROM journey_hierarchy_links WHERE space_id=? AND lifecycle='active'
    ORDER BY created_at,id`).all(input.spaceId) as any[]).map(rowToLink);
  try {
    validateJourneyHierarchy(nodes, [...existing, candidate], {
      nodes: journeyHierarchyLimits.nodes, links: settings.maximumLinks, depth: settings.maximumDepth
    });
  } catch (error) { mapDomainError(error); }
  try {
    db.prepare(`INSERT INTO journey_hierarchy_links
      (id,space_id,link_type,from_definition_id,to_definition_id,from_version_id,to_version_id,from_stage_key,to_stage_key,
       variant_dimension,variant_value_id,handoff_owner_user_id,handoff_owner_team_id,review_state,reviewed_by_user_id,
       reviewed_at,lifecycle,revision,created_by_user_id,updated_by_user_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',NULL,NULL,'active',1,?,?,?,?)`).run(
        candidate.id, input.spaceId, input.type, input.fromDefinitionId, input.toDefinitionId,
        candidate.fromVersionId, candidate.toVersionId, candidate.fromStageKey, candidate.toStageKey,
        candidate.variantDimension, candidate.variantValueId, candidate.handoffOwnerUserId, candidate.handoffOwnerTeamId,
        input.actorUserId, input.actorUserId, now, now);
  } catch (error) {
    throw new JourneyHierarchyRepositoryError('That hierarchy relationship already exists or references unavailable data.',
      409, 'JOURNEY_HIERARCHY_LINK_CONFLICT', { cause: error instanceof Error ? error.message : String(error) });
  }
  return rowToLink(db.prepare('SELECT * FROM journey_hierarchy_links WHERE id=? AND space_id=?')
    .get(candidate.id, input.spaceId));
  })();
}

export function updateJourneyHierarchyLink(input: {
  spaceId: string; actorUserId: string; linkId: string; expectedRevision: number;
  reviewState?: JourneyHierarchyReviewState; lifecycle?: JourneyHierarchyLifecycle;
}) {
  assertManage(input.spaceId, input.actorUserId);
  assertHierarchyEnabled(input.spaceId);
  const currentRow = db.prepare('SELECT * FROM journey_hierarchy_links WHERE id=? AND space_id=?')
    .get(input.linkId, input.spaceId) as any;
  if (!currentRow) throw new JourneyHierarchyRepositoryError('Journey hierarchy link not found.', 404, 'JOURNEY_HIERARCHY_LINK_NOT_FOUND');
  if (Number(currentRow.revision) !== input.expectedRevision) throw new JourneyHierarchyRepositoryError(
    'The hierarchy link changed before this update.', 409, 'JOURNEY_HIERARCHY_REVISION_CONFLICT',
    { expectedRevision: input.expectedRevision, actualRevision: Number(currentRow.revision) });
  const nextLifecycle = input.lifecycle || currentRow.lifecycle;
  if (currentRow.lifecycle === 'retired' && nextLifecycle === 'active') {
    const nodes = hierarchyNodes(input.spaceId);
    const active = (db.prepare(`SELECT * FROM journey_hierarchy_links WHERE space_id=? AND lifecycle='active' AND id<>?
      ORDER BY created_at,id`).all(input.spaceId, input.linkId) as any[]).map(rowToLink);
    const settings = hierarchySettings(input.spaceId);
    try { validateJourneyHierarchy(nodes, [...active, { ...rowToLink(currentRow), lifecycle: 'active' }], {
      nodes: journeyHierarchyLimits.nodes, links: settings.maximumLinks, depth: settings.maximumDepth
    }); } catch (error) { mapDomainError(error); }
  }
  const nextReview = input.reviewState || currentRow.review_state;
  const reviewedAt = nextReview === 'draft' ? null : new Date().toISOString();
  const reviewedBy = nextReview === 'draft' ? null : input.actorUserId;
  const updatedAt = new Date().toISOString();
  const result = db.prepare(`UPDATE journey_hierarchy_links SET review_state=?,reviewed_by_user_id=?,reviewed_at=?,
    lifecycle=?,revision=revision+1,updated_by_user_id=?,updated_at=? WHERE id=? AND space_id=? AND revision=?`)
    .run(nextReview, reviewedBy, reviewedAt, nextLifecycle, input.actorUserId, updatedAt,
      input.linkId, input.spaceId, input.expectedRevision);
  if (!result.changes) throw new JourneyHierarchyRepositoryError(
    'The hierarchy link changed before this update.', 409, 'JOURNEY_HIERARCHY_REVISION_CONFLICT');
  return rowToLink(db.prepare('SELECT * FROM journey_hierarchy_links WHERE id=? AND space_id=?').get(input.linkId, input.spaceId));
}

export function traversePersistedJourneyHierarchy(input: {
  spaceId: string; actorUserId: string; startDefinitionId: string;
  direction: 'upstream' | 'downstream' | 'both'; maximumDefinitions?: number;
}) {
  const hierarchy = listJourneyHierarchy({ spaceId: input.spaceId, actorUserId: input.actorUserId });
  try {
    return traverseJourneyHierarchy({
      nodes: hierarchy.nodes, links: hierarchy.links, startDefinitionId: input.startDefinitionId,
      direction: input.direction, permittedDefinitionIds: new Set(hierarchy.nodes.map((node) => node.definitionId)),
      maximumNodes: input.maximumDefinitions
    });
  } catch (error) { mapDomainError(error); }
}

export function persistedJourneyHierarchyBreadcrumbs(input: {
  spaceId: string; actorUserId: string; targetDefinitionId: string; maximumTrails?: number;
}) {
  const hierarchy = listJourneyHierarchy({ spaceId: input.spaceId, actorUserId: input.actorUserId });
  try {
    return journeyHierarchyBreadcrumbTrails({
      nodes: hierarchy.nodes, links: hierarchy.links, targetDefinitionId: input.targetDefinitionId,
      permittedDefinitionIds: new Set(hierarchy.nodes.map((node) => node.definitionId)), maximumPaths: input.maximumTrails
    });
  } catch (error) { mapDomainError(error); }
}

function rowToTaxonomy(row: any): JourneyTaxonomyTerm {
  return { id: String(row.id), kind: row.kind, name: String(row.name), parentTermId: row.parent_term_id || null,
    lifecycle: row.lifecycle, revision: Number(row.revision), createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

export function listJourneyTaxonomyTerms(input: { spaceId: string; actorUserId: string; includeRetired?: boolean }) {
  assertRead(input.spaceId, input.actorUserId);
  return (db.prepare(`SELECT * FROM journey_taxonomy_terms WHERE space_id=? ${input.includeRetired ? '' : "AND lifecycle='active'"}
    ORDER BY kind,normalized_name,id`).all(input.spaceId) as any[]).map(rowToTaxonomy);
}

export function createJourneyTaxonomyTerm(input: {
  spaceId: string; actorUserId: string; kind: JourneyTaxonomyTerm['kind']; name: string; parentTermId?: string | null;
}) {
  assertManage(input.spaceId, input.actorUserId);
  assertHierarchyEnabled(input.spaceId);
  const name = input.name.trim();
  if (!name || name.length > 160) throw new JourneyHierarchyRepositoryError(
    'A taxonomy name between 1 and 160 characters is required.', 400, 'JOURNEY_TAXONOMY_NAME_INVALID');
  if (input.parentTermId) {
    const parent = db.prepare(`SELECT * FROM journey_taxonomy_terms WHERE id=? AND space_id=? AND kind=? AND lifecycle='active'`)
      .get(input.parentTermId, input.spaceId, input.kind);
    if (!parent) throw new JourneyHierarchyRepositoryError(
      'The taxonomy parent must be an active same-kind term in this space.', 422, 'JOURNEY_TAXONOMY_PARENT_INVALID');
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    db.prepare(`INSERT INTO journey_taxonomy_terms
      (id,space_id,kind,name,normalized_name,parent_term_id,lifecycle,revision,created_by_user_id,updated_by_user_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'active',1,?,?,?,?)`).run(id, input.spaceId, input.kind, name, name.toLocaleLowerCase('en-US'),
        input.parentTermId || null, input.actorUserId, input.actorUserId, now, now);
  } catch {
    throw new JourneyHierarchyRepositoryError('A taxonomy term with that name already exists for this kind.',
      409, 'JOURNEY_TAXONOMY_CONFLICT');
  }
  return rowToTaxonomy(db.prepare('SELECT * FROM journey_taxonomy_terms WHERE id=? AND space_id=?').get(id, input.spaceId));
}

export function updateJourneyTaxonomyTerm(input: {
  spaceId: string; actorUserId: string; termId: string; expectedRevision: number;
  name?: string; parentTermId?: string | null; lifecycle?: JourneyTaxonomyTerm['lifecycle'];
}) {
  assertManage(input.spaceId, input.actorUserId);
  assertHierarchyEnabled(input.spaceId);
  const currentRow = db.prepare('SELECT * FROM journey_taxonomy_terms WHERE id=? AND space_id=?')
    .get(input.termId, input.spaceId) as any;
  if (!currentRow) throw new JourneyHierarchyRepositoryError('Journey taxonomy term not found.', 404,
    'JOURNEY_TAXONOMY_TERM_NOT_FOUND');
  const current = rowToTaxonomy(currentRow);
  if (current.revision !== input.expectedRevision) throw new JourneyHierarchyRepositoryError(
    'The taxonomy term changed before this update.', 409, 'JOURNEY_TAXONOMY_REVISION_CONFLICT',
    { expectedRevision: input.expectedRevision, actualRevision: current.revision });
  const name = input.name === undefined ? current.name : input.name.trim();
  if (!name || name.length > 160) throw new JourneyHierarchyRepositoryError(
    'A taxonomy name between 1 and 160 characters is required.', 400, 'JOURNEY_TAXONOMY_NAME_INVALID');
  const parentTermId = input.parentTermId === undefined ? current.parentTermId : input.parentTermId;
  const lifecycle = input.lifecycle ?? current.lifecycle;
  if (parentTermId === current.id) throw new JourneyHierarchyRepositoryError(
    'A taxonomy term cannot be its own parent.', 422, 'JOURNEY_TAXONOMY_PARENT_INVALID');
  if (parentTermId) {
    const parent = db.prepare(`SELECT id,parent_term_id FROM journey_taxonomy_terms
      WHERE id=? AND space_id=? AND kind=? AND lifecycle='active'`).get(parentTermId, input.spaceId, current.kind) as any;
    if (!parent) throw new JourneyHierarchyRepositoryError(
      'The taxonomy parent must be an active same-kind term in this space.', 422, 'JOURNEY_TAXONOMY_PARENT_INVALID');
    const seen = new Set<string>([current.id]);
    let cursor: any = parent;
    while (cursor) {
      const id = String(cursor.id);
      if (seen.has(id)) throw new JourneyHierarchyRepositoryError(
        'The taxonomy parent would create a cycle.', 409, 'JOURNEY_TAXONOMY_PARENT_CYCLE');
      seen.add(id);
      cursor = cursor.parent_term_id ? db.prepare('SELECT id,parent_term_id FROM journey_taxonomy_terms WHERE id=? AND space_id=?')
        .get(cursor.parent_term_id, input.spaceId) : null;
    }
  }
  if (current.lifecycle === 'active' && lifecycle === 'retired') {
    const child = db.prepare("SELECT id FROM journey_taxonomy_terms WHERE space_id=? AND parent_term_id=? AND lifecycle='active' LIMIT 1")
      .get(input.spaceId, current.id) as any;
    if (child) throw new JourneyHierarchyRepositoryError('Retire active child terms before retiring their taxonomy parent.',
      409, 'JOURNEY_TAXONOMY_ACTIVE_CHILDREN', { childTermId: String(child.id) });
    const assignment = db.prepare('SELECT definition_id FROM journey_definition_taxonomy WHERE space_id=? AND term_id=? LIMIT 1')
      .get(input.spaceId, current.id) as any;
    if (assignment) throw new JourneyHierarchyRepositoryError('Remove journey assignments before retiring this taxonomy term.',
      409, 'JOURNEY_TAXONOMY_ASSIGNED', { definitionId: String(assignment.definition_id) });
  }
  const at = new Date().toISOString();
  try {
    const changed = db.prepare(`UPDATE journey_taxonomy_terms SET name=?,normalized_name=?,parent_term_id=?,lifecycle=?,
      revision=revision+1,updated_by_user_id=?,updated_at=? WHERE id=? AND space_id=? AND revision=?`).run(
        name, name.toLocaleLowerCase('en-US'), parentTermId, lifecycle, input.actorUserId, at,
        input.termId, input.spaceId, input.expectedRevision);
    if (!changed.changes) throw new JourneyHierarchyRepositoryError('The taxonomy term changed before this update.',
      409, 'JOURNEY_TAXONOMY_REVISION_CONFLICT', { expectedRevision: input.expectedRevision });
  } catch (error) {
    if (error instanceof JourneyHierarchyRepositoryError) throw error;
    throw new JourneyHierarchyRepositoryError('A taxonomy term with that name already exists for this kind.',
      409, 'JOURNEY_TAXONOMY_CONFLICT');
  }
  return rowToTaxonomy(db.prepare('SELECT * FROM journey_taxonomy_terms WHERE id=? AND space_id=?')
    .get(input.termId, input.spaceId));
}

export function assignJourneyTaxonomyTerm(input: {
  spaceId: string; actorUserId: string; definitionId: string; termId: string;
}) {
  assertManage(input.spaceId, input.actorUserId);
  assertHierarchyEnabled(input.spaceId);
  const definition = db.prepare('SELECT 1 FROM journey_definitions WHERE id=? AND space_id=?').get(input.definitionId, input.spaceId);
  const term = db.prepare(`SELECT 1 FROM journey_taxonomy_terms WHERE id=? AND space_id=? AND lifecycle='active'`)
    .get(input.termId, input.spaceId);
  if (!definition || !term) throw new JourneyHierarchyRepositoryError(
    'The journey and active taxonomy term must both exist in this space.', 404, 'JOURNEY_TAXONOMY_TARGET_NOT_FOUND');
  db.prepare(`INSERT OR IGNORE INTO journey_definition_taxonomy
    (space_id,definition_id,term_id,assigned_by_user_id,created_at) VALUES (?,?,?,?,?)`)
    .run(input.spaceId, input.definitionId, input.termId, input.actorUserId, new Date().toISOString());
  return { assigned: true, definitionId: input.definitionId, termId: input.termId };
}

export function unassignJourneyTaxonomyTerm(input: {
  spaceId: string; actorUserId: string; definitionId: string; termId: string;
}) {
  assertManage(input.spaceId, input.actorUserId);
  assertHierarchyEnabled(input.spaceId);
  const result = db.prepare('DELETE FROM journey_definition_taxonomy WHERE space_id=? AND definition_id=? AND term_id=?')
    .run(input.spaceId, input.definitionId, input.termId);
  return { removed: result.changes > 0, definitionId: input.definitionId, termId: input.termId };
}

function stableHealthConfiguration(policy: JourneyHierarchyHealthPolicy) {
  return JSON.stringify({ version: policy.version, ownWeight: policy.ownWeight, missingChild: policy.missingChild,
    healthyAt: policy.healthyAt, watchAt: policy.watchAt });
}

function healthPolicyFromRow(row: any): JourneyHierarchyHealthPolicyRecord {
  let configuration: JourneyHierarchyHealthPolicy;
  try { configuration = JSON.parse(String(row.configuration_json)); } catch {
    throw new JourneyHierarchyRepositoryError('The hierarchy health policy configuration is unreadable.', 409,
      'JOURNEY_HIERARCHY_HEALTH_POLICY_INVALID');
  }
  return {
    id: String(row.id), name: String(row.name), lifecycle: row.lifecycle, ...configuration,
    revision: Number(row.revision), configurationSha256: String(row.configuration_sha256),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  };
}

export function listJourneyHierarchyHealthPolicies(input: {
  spaceId: string; actorUserId: string; includeRetired?: boolean;
}) {
  assertRead(input.spaceId, input.actorUserId);
  return (db.prepare(`SELECT * FROM journey_hierarchy_health_policies WHERE space_id=?
    ${input.includeRetired ? '' : "AND lifecycle<>'retired'"} ORDER BY name,id`).all(input.spaceId) as any[])
    .map(healthPolicyFromRow);
}

export function createJourneyHierarchyHealthPolicy(input: {
  spaceId: string; actorUserId: string; id?: string; name: string;
  lifecycle?: 'draft' | 'active'; policy: JourneyHierarchyHealthPolicy;
}) {
  assertManage(input.spaceId, input.actorUserId);
  assertHierarchyEnabled(input.spaceId);
  // The domain validator is the canonical validation for policy thresholds and weights.
  try { rollUpJourneyHierarchyHealth([], [], [], input.policy); } catch (error) { mapDomainError(error); }
  const id = input.id || crypto.randomUUID();
  const name = input.name.trim();
  if (!name || name.length > 160) throw new JourneyHierarchyRepositoryError(
    'A hierarchy health policy name between 1 and 160 characters is required.', 400,
    'JOURNEY_HIERARCHY_HEALTH_POLICY_NAME_INVALID');
  const serialized = stableHealthConfiguration(input.policy);
  const checksum = crypto.createHash('sha256').update(serialized).digest('hex');
  const at = new Date().toISOString();
  try {
    db.prepare(`INSERT INTO journey_hierarchy_health_policies
      (id,space_id,name,lifecycle,configuration_json,configuration_sha256,revision,created_by_user_id,updated_by_user_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,1,?,?,?,?)`).run(id, input.spaceId, name, input.lifecycle || 'active', serialized, checksum,
        input.actorUserId, input.actorUserId, at, at);
  } catch {
    throw new JourneyHierarchyRepositoryError('A hierarchy health policy with that identifier already exists.', 409,
      'JOURNEY_HIERARCHY_HEALTH_POLICY_CONFLICT');
  }
  return healthPolicyFromRow(db.prepare('SELECT * FROM journey_hierarchy_health_policies WHERE id=? AND space_id=?')
    .get(id, input.spaceId));
}

export function updateJourneyHierarchyHealthPolicy(input: {
  spaceId: string; actorUserId: string; policyId: string; expectedRevision: number;
  name?: string; lifecycle?: 'draft' | 'active' | 'retired'; policy?: JourneyHierarchyHealthPolicy;
}) {
  assertManage(input.spaceId, input.actorUserId);
  assertHierarchyEnabled(input.spaceId);
  const row = db.prepare('SELECT * FROM journey_hierarchy_health_policies WHERE id=? AND space_id=?')
    .get(input.policyId, input.spaceId) as any;
  if (!row) throw new JourneyHierarchyRepositoryError('Hierarchy health policy not found.', 404,
    'JOURNEY_HIERARCHY_HEALTH_POLICY_NOT_FOUND');
  const current = healthPolicyFromRow(row);
  if (current.revision !== input.expectedRevision) throw new JourneyHierarchyRepositoryError(
    'The hierarchy health policy changed before this update.', 409,
    'JOURNEY_HIERARCHY_HEALTH_POLICY_REVISION_CONFLICT',
    { expectedRevision: input.expectedRevision, actualRevision: current.revision });
  const policy = input.policy || current;
  try { rollUpJourneyHierarchyHealth([], [], [], policy); } catch (error) { mapDomainError(error); }
  const name = input.name === undefined ? current.name : input.name.trim();
  if (!name || name.length > 160) throw new JourneyHierarchyRepositoryError(
    'A hierarchy health policy name between 1 and 160 characters is required.', 400,
    'JOURNEY_HIERARCHY_HEALTH_POLICY_NAME_INVALID');
  const serialized = stableHealthConfiguration(policy);
  const checksum = crypto.createHash('sha256').update(serialized).digest('hex');
  const at = new Date().toISOString();
  const changed = db.prepare(`UPDATE journey_hierarchy_health_policies SET name=?,lifecycle=?,configuration_json=?,
    configuration_sha256=?,revision=revision+1,updated_by_user_id=?,updated_at=? WHERE id=? AND space_id=? AND revision=?`)
    .run(name, input.lifecycle || current.lifecycle, serialized, checksum, input.actorUserId, at,
      input.policyId, input.spaceId, input.expectedRevision);
  if (!changed.changes) throw new JourneyHierarchyRepositoryError(
    'The hierarchy health policy changed before this update.', 409,
    'JOURNEY_HIERARCHY_HEALTH_POLICY_REVISION_CONFLICT', { expectedRevision: input.expectedRevision });
  return healthPolicyFromRow(db.prepare('SELECT * FROM journey_hierarchy_health_policies WHERE id=? AND space_id=?')
    .get(input.policyId, input.spaceId));
}

function parseJson<T>(value: unknown, fallback: T): T {
  try { return JSON.parse(String(value)) as T; } catch { return fallback; }
}

function healthSnapshotFromRow(row: any) {
  const components = parseJson<any[]>(row.components_json, []);
  const policyComponent = components.find((component) => component?.kind === 'policy');
  const rules = policyComponent?.configuration || null;
  return {
    id: String(row.id), definitionId: String(row.definition_id), definitionRevision: Number(row.definition_revision),
    score: row.score === null || row.score === undefined ? null : Number(row.score), status: row.status,
    explanation: String(row.explanation), components, children: components.filter((entry) => entry?.kind === 'child'),
    own: components.find((entry) => entry?.kind === 'own') || null,
    childLineage: parseJson<string[]>(row.child_lineage_json, []),
    policy: { id: String(row.policy_id), version: String(row.policy_version), revision: Number(row.policy_revision),
      configurationSha256: String(row.policy_configuration_sha256), rules }, calculatedAt: String(row.calculated_at)
  };
}

function componentsForHealth(result: JourneyHierarchyHealthResult, policy: JourneyHierarchyHealthPolicy) {
  return [
    { kind: 'policy', configuration: { version: policy.version, ownWeight: policy.ownWeight,
      missingChild: policy.missingChild, healthyAt: policy.healthyAt, watchAt: policy.watchAt } },
    ...(result.own ? [{ kind: 'own', ...result.own }] : []),
    ...result.children.map((child) => ({ kind: 'child', ...child }))
  ];
}

export function calculateJourneyHierarchyHealthSnapshots(input: {
  spaceId: string; actorUserId: string; policyId: string; observations: JourneyHierarchyHealthObservation[];
  definitionId?: string;
}) {
  assertManage(input.spaceId, input.actorUserId);
  assertHierarchyEnabled(input.spaceId);
  const policyRow = db.prepare(`SELECT * FROM journey_hierarchy_health_policies
    WHERE id=? AND space_id=? AND lifecycle='active'`).get(input.policyId, input.spaceId) as any;
  if (!policyRow) throw new JourneyHierarchyRepositoryError('Active hierarchy health policy not found.', 404,
    'JOURNEY_HIERARCHY_HEALTH_POLICY_NOT_FOUND');
  const policy = healthPolicyFromRow(policyRow);
  const serialized = stableHealthConfiguration(policy);
  const checksum = crypto.createHash('sha256').update(serialized).digest('hex');
  if (checksum !== policy.configurationSha256) throw new JourneyHierarchyRepositoryError(
    'The hierarchy health policy failed its integrity check.', 409, 'JOURNEY_HIERARCHY_HEALTH_POLICY_INTEGRITY_FAILED');
  const nodes = hierarchyNodes(input.spaceId);
  const definitions = new Map((db.prepare('SELECT id,revision FROM journey_definitions WHERE space_id=?')
    .all(input.spaceId) as any[]).map((row) => [String(row.id), Number(row.revision)]));
  if (input.definitionId && !definitions.has(input.definitionId)) throw new JourneyHierarchyRepositoryError(
    'Journey definition not found.', 404, 'JOURNEY_HIERARCHY_NODE_NOT_FOUND');
  const settings = hierarchySettings(input.spaceId);
  const links = (db.prepare("SELECT * FROM journey_hierarchy_links WHERE space_id=? AND lifecycle='active' ORDER BY created_at,id")
    .all(input.spaceId) as any[]).map(rowToLink);
  let results: JourneyHierarchyHealthResult[];
  try {
    results = rollUpJourneyHierarchyHealth(nodes, links, input.observations, policy, {
      nodes: journeyHierarchyLimits.nodes, links: settings.maximumLinks, depth: settings.maximumDepth
    });
  } catch (error) { mapDomainError(error); }
  if (input.definitionId) results = results.filter((result) => result.definitionId === input.definitionId);
  const calculatedAt = new Date().toISOString();
  const ids = db.transaction(() => results.map((result) => {
    const id = crypto.randomUUID();
    const components = componentsForHealth(result, policy);
    db.prepare(`INSERT INTO journey_hierarchy_health_snapshots
      (id,space_id,definition_id,policy_id,policy_version,policy_revision,policy_configuration_sha256,
       definition_revision,score,status,explanation,components_json,child_lineage_json,calculated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, input.spaceId, result.definitionId, policy.id, policy.version,
        policy.revision, policy.configurationSha256, definitions.get(result.definitionId), result.score, result.status,
        result.explanation, JSON.stringify(components), JSON.stringify(result.lineage), calculatedAt);
    return id;
  }))();
  return ids.map((id) => healthSnapshotFromRow(db.prepare(
    'SELECT * FROM journey_hierarchy_health_snapshots WHERE id=? AND space_id=?').get(id, input.spaceId)));
}

export function listJourneyHierarchyHealthSnapshots(input: {
  spaceId: string; actorUserId: string; definitionId?: string; limit?: number;
}) {
  assertRead(input.spaceId, input.actorUserId);
  if (input.definitionId && !db.prepare('SELECT 1 FROM journey_definitions WHERE id=? AND space_id=?')
    .get(input.definitionId, input.spaceId)) throw new JourneyHierarchyRepositoryError(
      'Journey definition not found.', 404, 'JOURNEY_HIERARCHY_NODE_NOT_FOUND');
  return (db.prepare(`SELECT * FROM journey_hierarchy_health_snapshots WHERE space_id=?
    ${input.definitionId ? 'AND definition_id=?' : ''} ORDER BY calculated_at DESC,id LIMIT ?`)
    .all(...(input.definitionId ? [input.spaceId, input.definitionId, input.limit || 50] : [input.spaceId, input.limit || 50])) as any[])
    .map(healthSnapshotFromRow);
}

export function getJourneyHierarchyHealthSnapshot(input: {
  spaceId: string; actorUserId: string; snapshotId: string;
}) {
  assertRead(input.spaceId, input.actorUserId);
  const row = db.prepare('SELECT * FROM journey_hierarchy_health_snapshots WHERE id=? AND space_id=?')
    .get(input.snapshotId, input.spaceId) as any;
  if (!row) throw new JourneyHierarchyRepositoryError('Hierarchy health snapshot not found.', 404,
    'JOURNEY_HIERARCHY_HEALTH_SNAPSHOT_NOT_FOUND');
  return healthSnapshotFromRow(row);
}

export type JourneyHierarchyExportFormat = 'json' | 'csv';

function hierarchyCsvRow(values: unknown[]) {
  return values.map(formulaSafeCsvCell).join(',');
}

/** Exports the complete permitted hierarchy projection with exact links,
 * validation limits, taxonomy assignments, health-policy versions and bounded
 * health history. It never exports inaccessible or cross-space nodes because
 * every source read is request-space scoped. */
export function exportJourneyHierarchy(input: {
  spaceId: string; actorUserId: string; format: JourneyHierarchyExportFormat; requestId?: string | null;
}) {
  assertSubscriptionFeature(input.spaceId, 'journeyExports');
  assertJourneyCapability(input.spaceId, input.actorUserId, 'journeys.export');
  const hierarchy = listJourneyHierarchy({ spaceId: input.spaceId, actorUserId: input.actorUserId, includeRetired: true });
  const taxonomy = listJourneyTaxonomyTerms({ spaceId: input.spaceId, actorUserId: input.actorUserId, includeRetired: true });
  const healthPolicies = listJourneyHierarchyHealthPolicies({
    spaceId: input.spaceId, actorUserId: input.actorUserId, includeRetired: true
  });
  const healthSnapshots = listJourneyHierarchyHealthSnapshots({
    spaceId: input.spaceId, actorUserId: input.actorUserId, limit: 1_000
  });
  const content = { hierarchy, taxonomy, healthPolicies, healthSnapshots };
  const contentSha256 = crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex');
  const generatedAt = new Date().toISOString();
  let bytes: Buffer;
  let mimeType: string;
  if (input.format === 'json') {
    bytes = Buffer.from(`${JSON.stringify({ schemaVersion: 'journey-hierarchy-export/v1', generatedAt,
      contentSha256, ...content }, null, 2)}\n`, 'utf8');
    mimeType = 'application/json; charset=utf-8';
  } else {
    const columns = ['record_type', 'definition_id', 'record_id', 'type', 'name_or_label', 'from_definition_id',
      'to_definition_id', 'from_version_id', 'to_version_id', 'from_stage_key', 'to_stage_key',
      'variant_dimension', 'variant_value_id', 'handoff_owner_user_id', 'handoff_owner_team_id', 'review_state',
      'lifecycle', 'revision', 'taxonomy_term_ids', 'stage_keys', 'health_score', 'health_status',
      'policy_version', 'calculated_at', 'content_sha256'];
    const rows: unknown[][] = [];
    for (const node of hierarchy.nodes) rows.push(['node', node.definitionId, node.definitionId, 'journey', node.name || '',
      '', '', '', '', '', '', '', '', '', '', '', 'active', '', (node.taxonomyTermIds || []).join('|'),
      (node.stageKeys || []).join('|'), '', '', '', '', contentSha256]);
    for (const link of hierarchy.links) rows.push(['link', '', link.id, link.type, '', link.fromDefinitionId,
      link.toDefinitionId, link.fromVersionId || '', link.toVersionId || '', link.fromStageKey || '',
      link.toStageKey || '', link.variantDimension || '', link.variantValueId || '', link.handoffOwnerUserId || '',
      link.handoffOwnerTeamId || '', link.reviewState, link.lifecycle, link.revision, '', '', '', '', '', '', contentSha256]);
    for (const term of taxonomy) rows.push(['taxonomy', '', term.id, term.kind, term.name, '', '', '', '', '', '', '',
      '', '', '', '', term.lifecycle, term.revision, term.parentTermId || '', '', '', '', '', '', contentSha256]);
    for (const policy of healthPolicies) rows.push(['health_policy', '', policy.id, 'health_policy', policy.name, '', '',
      '', '', '', '', '', '', '', '', '', policy.lifecycle, policy.revision, '', '', '', '', policy.version, '', contentSha256]);
    for (const snapshot of healthSnapshots) rows.push(['health_snapshot', snapshot.definitionId, snapshot.id,
      'health_snapshot', snapshot.explanation, '', '', '', '', '', '', '', '', '', '', '', '',
      snapshot.definitionRevision, '', '', snapshot.score ?? '', snapshot.status, snapshot.policy.version,
      snapshot.calculatedAt, contentSha256]);
    bytes = Buffer.from(`${hierarchyCsvRow(columns)}\r\n${rows.map(hierarchyCsvRow).join('\r\n')}\r\n`, 'utf8');
    mimeType = 'text/csv; charset=utf-8';
  }
  recordJourneyGovernedActivity({
    spaceId: input.spaceId, actorUserId: input.actorUserId, action: 'hierarchy.export',
    targetType: 'journey_hierarchy', targetId: input.spaceId, requestId: input.requestId,
    detail: { formatCode: input.format, contentSha256, byteCount: bytes.byteLength,
      nodeCount: hierarchy.nodes.length, linkCount: hierarchy.links.length, taxonomyCount: taxonomy.length,
      healthSnapshotCount: healthSnapshots.length }
  });
  return { bytes, mimeType, contentSha256, filename: `journey-hierarchy.${input.format}` };
}
