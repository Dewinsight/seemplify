import crypto from 'node:crypto';
import { db } from './database.js';
import {
  JOURNEY_SERVICE_BLUEPRINT_VERSION,
  JourneyServiceBlueprintError,
  analyseServiceBlueprint,
  compareServiceBlueprints,
  type JourneyBlueprintElement,
  type JourneyBlueprintPortfolioLink,
  type JourneyBlueprintRelationship,
  type JourneyBlueprintResource,
  type JourneyBlueprintReviewState,
  type JourneyBlueprintStage,
  type JourneyBlueprintState,
  type JourneyServiceBlueprint
} from './journeyServiceBlueprint.js';
import { assertJourneyCapability, JourneyCollaborationError, recordJourneyGovernedActivity } from './journeyCollaboration.js';
import { formulaSafeCsvCell } from './journeyMapExports.js';
import { assertSubscriptionFeature, assertSubscriptionQuota } from './subscriptionEntitlements.js';

export class JourneyServiceBlueprintRepositoryError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = 'JOURNEY_BLUEPRINT_INVALID',
    public details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'JourneyServiceBlueprintRepositoryError';
  }
}

export type JourneyBlueprintRecord = {
  id: string; spaceId: string; journeyDefinitionId: string; name: string;
  lifecycle: 'draft' | 'in_review' | 'approved' | 'retired'; ownerUserId: string | null;
  ownerTeamId: string | null; currentVersionId: string | null; revision: number;
  createdAt: string; updatedAt: string;
};

export type JourneyBlueprintResourceRecord = JourneyBlueprintResource & {
  name: string; description: string; lifecycle: 'active' | 'retired'; ownerUserId: string | null;
  revision: number; createdAt: string; updatedAt: string;
};

export type JourneyBlueprintGapRecord = {
  id: string; blueprintVersionId: string; gapType: string; targetElementId: string | null;
  targetRelationshipId: string | null; severity: 'info' | 'warning' | 'critical';
  state: 'open' | 'accepted' | 'resolved' | 'dismissed'; reasonCode: string;
  detail: Record<string, unknown>; reviewerUserId: string | null; reviewedAt: string | null; createdAt: string;
};

function ensureSqliteSchema() {
  if (db.provider !== 'sqlite') return;
  db.exec(`
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
    CREATE UNIQUE INDEX IF NOT EXISTS journey_blueprint_definitions_tenant_identity
      ON journey_definitions(id,space_id);
    CREATE UNIQUE INDEX IF NOT EXISTS journey_blueprint_map_versions_tenant_identity
      ON journey_map_versions(id,definition_id,space_id);
    CREATE TABLE IF NOT EXISTS journey_blueprint_resources (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('team','actor','system','vendor','policy','control')),
      name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', owner_user_id TEXT REFERENCES users(id),
      lifecycle TEXT NOT NULL DEFAULT 'active' CHECK(lifecycle IN ('active','retired')),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), created_by_user_id TEXT REFERENCES users(id),
      updated_by_user_id TEXT REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(id,space_id)
    );
    CREATE INDEX IF NOT EXISTS journey_blueprint_resources_query
      ON journey_blueprint_resources(space_id,kind,lifecycle,name,id);
    CREATE TABLE IF NOT EXISTS journey_blueprints (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      journey_definition_id TEXT NOT NULL, name TEXT NOT NULL,
      lifecycle TEXT NOT NULL DEFAULT 'draft' CHECK(lifecycle IN ('draft','in_review','approved','retired')),
      owner_user_id TEXT REFERENCES users(id), owner_team_id TEXT, current_version_id TEXT,
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), created_by_user_id TEXT REFERENCES users(id),
      updated_by_user_id TEXT REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(id,space_id), UNIQUE(id,space_id,journey_definition_id),
      FOREIGN KEY(journey_definition_id,space_id) REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS journey_blueprints_definition
      ON journey_blueprints(space_id,journey_definition_id,lifecycle,updated_at,id);
    CREATE TABLE IF NOT EXISTS journey_blueprint_versions (
      id TEXT PRIMARY KEY, blueprint_id TEXT NOT NULL, space_id TEXT NOT NULL, journey_definition_id TEXT NOT NULL,
      journey_version_id TEXT NOT NULL, version_number INTEGER NOT NULL CHECK(version_number>0),
      blueprint_state TEXT NOT NULL CHECK(blueprint_state IN ('current','future')),
      review_state TEXT NOT NULL CHECK(review_state IN ('draft','in_review','approved','changes_requested')),
      schema_version TEXT NOT NULL, change_reason TEXT, actor_user_id TEXT REFERENCES users(id), created_at TEXT NOT NULL,
      approved_by_user_id TEXT REFERENCES users(id), approved_at TEXT,
      UNIQUE(id,space_id), UNIQUE(id,blueprint_id,space_id), UNIQUE(id,space_id,journey_definition_id),
      UNIQUE(blueprint_id,space_id,version_number),
      FOREIGN KEY(blueprint_id,space_id,journey_definition_id)
        REFERENCES journey_blueprints(id,space_id,journey_definition_id) ON DELETE CASCADE,
      FOREIGN KEY(journey_version_id,journey_definition_id,space_id)
        REFERENCES journey_map_versions(id,definition_id,space_id) ON DELETE NO ACTION
    );
    CREATE INDEX IF NOT EXISTS journey_blueprint_versions_history
      ON journey_blueprint_versions(space_id,blueprint_id,version_number,id);
    CREATE TABLE IF NOT EXISTS journey_blueprint_stages (
      version_id TEXT NOT NULL, space_id TEXT NOT NULL, stage_key TEXT NOT NULL, name TEXT NOT NULL,
      ordinal INTEGER NOT NULL CHECK(ordinal>=0), PRIMARY KEY(version_id,stage_key), UNIQUE(version_id,ordinal),
      FOREIGN KEY(version_id,space_id) REFERENCES journey_blueprint_versions(id,space_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS journey_blueprint_elements (
      id TEXT NOT NULL, version_id TEXT NOT NULL, space_id TEXT NOT NULL, stage_key TEXT NOT NULL,
      lane TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      owner_team_resource_id TEXT, actor_resource_id TEXT, system_resource_id TEXT, vendor_resource_id TEXT,
      control_resource_id TEXT, sla_minutes REAL, unit_cost REAL, risk_probability REAL, risk_impact REAL,
      ordinal INTEGER NOT NULL CHECK(ordinal>=0), evidence_refs_json TEXT NOT NULL DEFAULT '[]',
      metric_refs_json TEXT NOT NULL DEFAULT '[]', PRIMARY KEY(version_id,id), UNIQUE(id,version_id,space_id),
      UNIQUE(version_id,stage_key,lane,ordinal),
      FOREIGN KEY(version_id,stage_key) REFERENCES journey_blueprint_stages(version_id,stage_key) ON DELETE CASCADE,
      FOREIGN KEY(version_id,space_id) REFERENCES journey_blueprint_versions(id,space_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS journey_blueprint_relationships (
      id TEXT NOT NULL, version_id TEXT NOT NULL, space_id TEXT NOT NULL, kind TEXT NOT NULL,
      from_element_id TEXT NOT NULL, to_element_id TEXT NOT NULL, label TEXT NOT NULL DEFAULT '',
      PRIMARY KEY(version_id,id), UNIQUE(id,version_id,space_id),
      UNIQUE(version_id,kind,from_element_id,to_element_id), CHECK(from_element_id<>to_element_id),
      FOREIGN KEY(from_element_id,version_id,space_id)
        REFERENCES journey_blueprint_elements(id,version_id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(to_element_id,version_id,space_id)
        REFERENCES journey_blueprint_elements(id,version_id,space_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS journey_blueprint_portfolio_links (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      blueprint_version_id TEXT NOT NULL, element_id TEXT NOT NULL, portfolio_item_id TEXT NOT NULL,
      portfolio_item_revision INTEGER NOT NULL CHECK(portfolio_item_revision>0), relationship TEXT NOT NULL,
      created_by_user_id TEXT REFERENCES users(id), created_at TEXT NOT NULL, UNIQUE(id,space_id),
      UNIQUE(space_id,blueprint_version_id,element_id,portfolio_item_id,portfolio_item_revision,relationship),
      FOREIGN KEY(element_id,blueprint_version_id,space_id)
        REFERENCES journey_blueprint_elements(id,version_id,space_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS journey_blueprint_gap_assessments (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      blueprint_version_id TEXT NOT NULL, gap_type TEXT NOT NULL, target_element_id TEXT,
      target_relationship_id TEXT, severity TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'open',
      reason_code TEXT NOT NULL, detail_json TEXT NOT NULL, reviewer_user_id TEXT REFERENCES users(id),
      reviewed_at TEXT, created_at TEXT NOT NULL, UNIQUE(id,space_id),
      FOREIGN KEY(blueprint_version_id,space_id) REFERENCES journey_blueprint_versions(id,space_id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS journey_blueprint_gap_assessments_open_once
      ON journey_blueprint_gap_assessments(blueprint_version_id,gap_type,
        COALESCE(target_element_id,''),COALESCE(target_relationship_id,'')) WHERE state='open';
    CREATE TABLE IF NOT EXISTS journey_blueprint_comparisons (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      journey_definition_id TEXT NOT NULL, from_version_id TEXT NOT NULL, to_version_id TEXT NOT NULL,
      result_json TEXT NOT NULL, result_sha256 TEXT NOT NULL, actor_user_id TEXT REFERENCES users(id),
      created_at TEXT NOT NULL, UNIQUE(id,space_id),
      UNIQUE(space_id,from_version_id,to_version_id,result_sha256)
    );
  `);
}

ensureSqliteSchema();

function membershipRole(spaceId: string, userId: string) {
  const row = db.prepare('SELECT role FROM space_memberships WHERE space_id=? AND user_id=?').get(spaceId, userId) as
    { role?: string } | undefined;
  if (!row || !['owner', 'admin', 'member'].includes(String(row.role))) throw new JourneyServiceBlueprintRepositoryError(
    'Space membership is required.', 403, 'JOURNEY_BLUEPRINT_FORBIDDEN');
  return row.role as 'owner' | 'admin' | 'member';
}

function assertRead(spaceId: string, userId: string) {
  assertSubscriptionFeature(spaceId, 'journeyBlueprints');
  const role = membershipRole(spaceId, userId);
  assertJourneyCapability(spaceId, userId, 'journeys.read');
  return role;
}

function assertManage(spaceId: string, userId: string) {
  assertRead(spaceId, userId);
  try { assertJourneyCapability(spaceId, userId, 'journeys.edit'); } catch (error) {
    if (!(error instanceof JourneyCollaborationError)) throw error;
    throw new JourneyServiceBlueprintRepositoryError(
      'Your Journey role does not allow blueprint management.', 403, 'JOURNEY_BLUEPRINT_MANAGE_REQUIRED');
  }
}

function assertExport(spaceId: string, userId: string, journeyDefinitionId: string) {
  assertRead(spaceId, userId);
  assertSubscriptionFeature(spaceId, 'journeyExports');
  assertJourneyCapability(spaceId, userId, 'journeys.export', { journeyDefinitionId });
}

function assertBlueprintsEnabled(spaceId: string) {
  const row = db.prepare('SELECT blueprints_enabled FROM journey_hierarchy_settings WHERE space_id=?')
    .get(spaceId) as { blueprints_enabled?: unknown } | undefined;
  if (row && !Boolean(row.blueprints_enabled)) throw new JourneyServiceBlueprintRepositoryError(
    'Service blueprints are disabled for this space.', 409, 'JOURNEY_BLUEPRINTS_DISABLED');
}

function parseJson<T>(value: unknown, fallback: T): T {
  try { return JSON.parse(String(value)) as T; } catch { return fallback; }
}

function mapBlueprint(row: any): JourneyBlueprintRecord {
  return {
    id: String(row.id), spaceId: String(row.space_id), journeyDefinitionId: String(row.journey_definition_id),
    name: String(row.name), lifecycle: row.lifecycle, ownerUserId: row.owner_user_id || null,
    ownerTeamId: row.owner_team_id || null, currentVersionId: row.current_version_id || null,
    revision: Number(row.revision), createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  };
}

function mapResource(row: any): JourneyBlueprintResourceRecord {
  return {
    id: String(row.id), spaceId: String(row.space_id), kind: row.kind, name: String(row.name),
    description: String(row.description || ''), lifecycle: row.lifecycle, ownerUserId: row.owner_user_id || null,
    revision: Number(row.revision), createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  };
}

function mapGap(row: any): JourneyBlueprintGapRecord {
  return {
    id: String(row.id), blueprintVersionId: String(row.blueprint_version_id), gapType: String(row.gap_type),
    targetElementId: row.target_element_id || null, targetRelationshipId: row.target_relationship_id || null,
    severity: row.severity, state: row.state, reasonCode: String(row.reason_code),
    detail: parseJson(row.detail_json, {}), reviewerUserId: row.reviewer_user_id || null,
    reviewedAt: row.reviewed_at || null, createdAt: String(row.created_at)
  };
}

function domainFailure(error: unknown): never {
  if (!(error instanceof JourneyServiceBlueprintError)) throw error;
  const conflict = error.code.includes('COMPARISON');
  throw new JourneyServiceBlueprintRepositoryError(error.message, conflict ? 409 : 422, error.code, error.details);
}

export function listJourneyServiceBlueprints(input: {
  spaceId: string; actorUserId: string; includeRetired?: boolean; journeyDefinitionId?: string;
}) {
  assertRead(input.spaceId, input.actorUserId);
  const parameters: unknown[] = [input.spaceId];
  let where = 'space_id=?';
  if (!input.includeRetired) where += " AND lifecycle<>'retired'";
  if (input.journeyDefinitionId) { where += ' AND journey_definition_id=?'; parameters.push(input.journeyDefinitionId); }
  return (db.prepare(`SELECT * FROM journey_blueprints WHERE ${where} ORDER BY updated_at DESC,id`)
    .all(...parameters) as any[]).map(mapBlueprint);
}

export function createJourneyServiceBlueprint(input: {
  spaceId: string; actorUserId: string; journeyDefinitionId: string; name: string;
  ownerUserId?: string | null; ownerTeamId?: string | null;
}) {
  assertManage(input.spaceId, input.actorUserId);
  const definition = db.prepare('SELECT 1 FROM journey_definitions WHERE id=? AND space_id=?')
    .get(input.journeyDefinitionId, input.spaceId);
  if (!definition) throw new JourneyServiceBlueprintRepositoryError(
    'Journey definition not found.', 404, 'JOURNEY_BLUEPRINT_JOURNEY_NOT_FOUND');
  const name = input.name.trim();
  if (!name || name.length > 200) throw new JourneyServiceBlueprintRepositoryError(
    'A blueprint name between 1 and 200 characters is required.', 400, 'JOURNEY_BLUEPRINT_NAME_INVALID');
  return db.transaction(() => {
  if (db.provider === 'postgres') db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?,0))')
    .get(`journey-blueprint-quota:${input.spaceId}`);
  const current = Number((db.prepare(`SELECT COUNT(*) count FROM journey_blueprints
    WHERE space_id=?`).get(input.spaceId) as any).count);
  assertSubscriptionQuota(input.spaceId, 'journeyBlueprints', current, 1);
  const id = crypto.randomUUID(); const now = new Date().toISOString();
  db.prepare(`INSERT INTO journey_blueprints
    (id,space_id,journey_definition_id,name,lifecycle,owner_user_id,owner_team_id,current_version_id,revision,
     created_by_user_id,updated_by_user_id,created_at,updated_at)
    VALUES (?,?,?,?,'draft',?,?,NULL,1,?,?,?,?)`).run(
    id, input.spaceId, input.journeyDefinitionId, name, input.ownerUserId || null, input.ownerTeamId || null,
    input.actorUserId, input.actorUserId, now, now);
  return mapBlueprint(db.prepare('SELECT * FROM journey_blueprints WHERE id=? AND space_id=?').get(id, input.spaceId));
  })();
}

export function updateJourneyServiceBlueprint(input: {
  spaceId: string; actorUserId: string; blueprintId: string; expectedRevision: number;
  name?: string; lifecycle?: JourneyBlueprintRecord['lifecycle']; ownerUserId?: string | null; ownerTeamId?: string | null;
}) {
  assertManage(input.spaceId, input.actorUserId);
  const row = db.prepare('SELECT * FROM journey_blueprints WHERE id=? AND space_id=?')
    .get(input.blueprintId, input.spaceId) as any;
  if (!row) throw new JourneyServiceBlueprintRepositoryError('Service blueprint not found.', 404, 'JOURNEY_BLUEPRINT_NOT_FOUND');
  if (Number(row.revision) !== input.expectedRevision) throw new JourneyServiceBlueprintRepositoryError(
    'The service blueprint changed before this update.', 409, 'JOURNEY_BLUEPRINT_REVISION_CONFLICT',
    { expectedRevision: input.expectedRevision, actualRevision: Number(row.revision) });
  const name = input.name === undefined ? String(row.name) : input.name.trim();
  if (!name || name.length > 200) throw new JourneyServiceBlueprintRepositoryError(
    'A blueprint name between 1 and 200 characters is required.', 400, 'JOURNEY_BLUEPRINT_NAME_INVALID');
  const result = db.prepare(`UPDATE journey_blueprints SET name=?,lifecycle=?,owner_user_id=?,owner_team_id=?,
    revision=revision+1,updated_by_user_id=?,updated_at=? WHERE id=? AND space_id=? AND revision=?`).run(
    name, input.lifecycle ?? row.lifecycle,
    input.ownerUserId === undefined ? row.owner_user_id : input.ownerUserId,
    input.ownerTeamId === undefined ? row.owner_team_id : input.ownerTeamId,
    input.actorUserId, new Date().toISOString(), input.blueprintId, input.spaceId, input.expectedRevision);
  if (!result.changes) throw new JourneyServiceBlueprintRepositoryError(
    'The service blueprint changed before this update.', 409, 'JOURNEY_BLUEPRINT_REVISION_CONFLICT');
  return mapBlueprint(db.prepare('SELECT * FROM journey_blueprints WHERE id=? AND space_id=?')
    .get(input.blueprintId, input.spaceId));
}

export function listJourneyBlueprintResources(input: { spaceId: string; actorUserId: string; includeRetired?: boolean }) {
  assertRead(input.spaceId, input.actorUserId);
  return (db.prepare(`SELECT * FROM journey_blueprint_resources WHERE space_id=?
    ${input.includeRetired ? '' : "AND lifecycle='active'"} ORDER BY kind,name,id`).all(input.spaceId) as any[]).map(mapResource);
}

export function createJourneyBlueprintResource(input: {
  spaceId: string; actorUserId: string; kind: JourneyBlueprintResourceRecord['kind']; name: string;
  description?: string; ownerUserId?: string | null;
}) {
  assertManage(input.spaceId, input.actorUserId);
  const name = input.name.trim(); const description = (input.description || '').trim();
  if (!name || name.length > 200 || description.length > 5000) throw new JourneyServiceBlueprintRepositoryError(
    'Resource name or description is invalid.', 400, 'JOURNEY_BLUEPRINT_RESOURCE_INVALID');
  return db.transaction(() => {
  if (db.provider === 'postgres') db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?,0))')
    .get(`journey-blueprint-resource-quota:${input.spaceId}`);
  const current = Number((db.prepare(`SELECT COUNT(*) count FROM journey_blueprint_resources
    WHERE space_id=?`).get(input.spaceId) as any).count);
  assertSubscriptionQuota(input.spaceId, 'journeyBlueprintResources', current, 1);
  const id = crypto.randomUUID(); const now = new Date().toISOString();
  db.prepare(`INSERT INTO journey_blueprint_resources
    (id,space_id,kind,name,description,owner_user_id,lifecycle,revision,created_by_user_id,updated_by_user_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,'active',1,?,?,?,?)`).run(
    id, input.spaceId, input.kind, name, description, input.ownerUserId || null,
    input.actorUserId, input.actorUserId, now, now);
  return mapResource(db.prepare('SELECT * FROM journey_blueprint_resources WHERE id=? AND space_id=?').get(id, input.spaceId));
  })();
}

export function updateJourneyBlueprintResource(input: {
  spaceId: string; actorUserId: string; resourceId: string; expectedRevision: number;
  name?: string; description?: string; lifecycle?: 'active' | 'retired'; ownerUserId?: string | null;
}) {
  assertManage(input.spaceId, input.actorUserId);
  const row = db.prepare('SELECT * FROM journey_blueprint_resources WHERE id=? AND space_id=?')
    .get(input.resourceId, input.spaceId) as any;
  if (!row) throw new JourneyServiceBlueprintRepositoryError('Blueprint resource not found.', 404, 'JOURNEY_BLUEPRINT_RESOURCE_NOT_FOUND');
  if (Number(row.revision) !== input.expectedRevision) throw new JourneyServiceBlueprintRepositoryError(
    'The resource changed before this update.', 409, 'JOURNEY_BLUEPRINT_RESOURCE_REVISION_CONFLICT');
  const name = input.name === undefined ? String(row.name) : input.name.trim();
  const description = input.description === undefined ? String(row.description || '') : input.description.trim();
  const result = db.prepare(`UPDATE journey_blueprint_resources SET name=?,description=?,lifecycle=?,owner_user_id=?,
    revision=revision+1,updated_by_user_id=?,updated_at=? WHERE id=? AND space_id=? AND revision=?`).run(
    name, description, input.lifecycle ?? row.lifecycle,
    input.ownerUserId === undefined ? row.owner_user_id : input.ownerUserId,
    input.actorUserId, new Date().toISOString(), input.resourceId, input.spaceId, input.expectedRevision);
  if (!result.changes) throw new JourneyServiceBlueprintRepositoryError(
    'The resource changed before this update.', 409, 'JOURNEY_BLUEPRINT_RESOURCE_REVISION_CONFLICT');
  return mapResource(db.prepare('SELECT * FROM journey_blueprint_resources WHERE id=? AND space_id=?')
    .get(input.resourceId, input.spaceId));
}

function readVersionUnchecked(spaceId: string, versionId: string): JourneyServiceBlueprint & {
  changeReason: string | null; createdAt: string; gaps: JourneyBlueprintGapRecord[];
} {
  const version = db.prepare('SELECT * FROM journey_blueprint_versions WHERE id=? AND space_id=?')
    .get(versionId, spaceId) as any;
  if (!version) throw new JourneyServiceBlueprintRepositoryError('Blueprint version not found.', 404, 'JOURNEY_BLUEPRINT_VERSION_NOT_FOUND');
  const stages = (db.prepare('SELECT * FROM journey_blueprint_stages WHERE version_id=? AND space_id=? ORDER BY ordinal,stage_key')
    .all(versionId, spaceId) as any[]).map((row) => ({ stageKey: String(row.stage_key), name: String(row.name), ordinal: Number(row.ordinal) }));
  const elements = (db.prepare('SELECT * FROM journey_blueprint_elements WHERE version_id=? AND space_id=? ORDER BY stage_key,lane,ordinal,id')
    .all(versionId, spaceId) as any[]).map((row) => ({
      id: String(row.id), stageKey: String(row.stage_key), lane: row.lane, kind: row.kind, title: String(row.title),
      description: String(row.description || ''), ownerTeamId: row.owner_team_resource_id || null,
      actorId: row.actor_resource_id || null, systemId: row.system_resource_id || null,
      vendorId: row.vendor_resource_id || null, controlId: row.control_resource_id || null,
      slaMinutes: row.sla_minutes === null ? null : Number(row.sla_minutes),
      unitCost: row.unit_cost === null ? null : Number(row.unit_cost),
      riskProbability: row.risk_probability === null ? null : Number(row.risk_probability),
      riskImpact: row.risk_impact === null ? null : Number(row.risk_impact), ordinal: Number(row.ordinal),
      evidenceRefs: parseJson<string[]>(row.evidence_refs_json, []), metricRefs: parseJson<string[]>(row.metric_refs_json, [])
    })) as JourneyBlueprintElement[];
  const relationships = (db.prepare(`SELECT * FROM journey_blueprint_relationships WHERE version_id=? AND space_id=?
    ORDER BY kind,from_element_id,to_element_id,id`).all(versionId, spaceId) as any[]).map((row) => ({
      id: String(row.id), kind: row.kind, fromElementId: String(row.from_element_id),
      toElementId: String(row.to_element_id), label: String(row.label || '')
    })) as JourneyBlueprintRelationship[];
  const resourceIds = new Set(elements.flatMap((element) => [element.ownerTeamId, element.actorId, element.systemId,
    element.vendorId, element.controlId]).filter((value): value is string => Boolean(value)));
  const resources = (db.prepare('SELECT * FROM journey_blueprint_resources WHERE space_id=? ORDER BY kind,name,id')
    .all(spaceId) as any[]).map(mapResource).filter((resource) => resourceIds.has(resource.id));
  const portfolioLinks = (db.prepare(`SELECT link.*,item.kind portfolio_item_kind FROM journey_blueprint_portfolio_links link
    JOIN journey_portfolio_items item ON item.id=link.portfolio_item_id AND item.space_id=link.space_id
    WHERE link.blueprint_version_id=? AND link.space_id=? ORDER BY link.id`).all(versionId, spaceId) as any[]).map((row) => ({
      id: String(row.id), elementId: String(row.element_id), portfolioItemId: String(row.portfolio_item_id),
      portfolioItemKind: row.portfolio_item_kind, portfolioItemRevision: Number(row.portfolio_item_revision),
      relationship: row.relationship, spaceId
    })) as JourneyBlueprintPortfolioLink[];
  const gaps = (db.prepare(`SELECT * FROM journey_blueprint_gap_assessments WHERE blueprint_version_id=? AND space_id=?
    ORDER BY state,severity,gap_type,id`).all(versionId, spaceId) as any[]).map(mapGap);
  return {
    schemaVersion: JOURNEY_SERVICE_BLUEPRINT_VERSION, blueprintId: String(version.blueprint_id), spaceId,
    journeyDefinitionId: String(version.journey_definition_id), journeyVersionId: String(version.journey_version_id),
    state: version.blueprint_state, versionId: String(version.id), versionNumber: Number(version.version_number),
    reviewState: version.review_state, stages, elements, relationships, resources, portfolioLinks,
    changeReason: version.change_reason || null, createdAt: String(version.created_at), gaps
  };
}

export function readJourneyServiceBlueprintVersion(input: { spaceId: string; actorUserId: string; versionId: string }) {
  assertRead(input.spaceId, input.actorUserId);
  return readVersionUnchecked(input.spaceId, input.versionId);
}

export function listJourneyServiceBlueprintVersions(input: { spaceId: string; actorUserId: string; blueprintId: string }) {
  assertRead(input.spaceId, input.actorUserId);
  const blueprint = db.prepare('SELECT 1 FROM journey_blueprints WHERE id=? AND space_id=?').get(input.blueprintId, input.spaceId);
  if (!blueprint) throw new JourneyServiceBlueprintRepositoryError('Service blueprint not found.', 404, 'JOURNEY_BLUEPRINT_NOT_FOUND');
  return db.prepare(`SELECT id,blueprint_id,journey_definition_id,journey_version_id,version_number,blueprint_state,
    review_state,schema_version,change_reason,created_at,approved_by_user_id,approved_at
    FROM journey_blueprint_versions WHERE blueprint_id=? AND space_id=? ORDER BY version_number DESC,id`)
    .all(input.blueprintId, input.spaceId);
}

export function createJourneyServiceBlueprintVersion(input: {
  spaceId: string; actorUserId: string; blueprintId: string; journeyVersionId: string;
  state: JourneyBlueprintState; changeReason?: string | null; stages: JourneyBlueprintStage[];
  elements: JourneyBlueprintElement[]; relationships: JourneyBlueprintRelationship[];
  portfolioLinks?: JourneyBlueprintPortfolioLink[];
}) {
  assertManage(input.spaceId, input.actorUserId);
  assertBlueprintsEnabled(input.spaceId);
  const blueprint = db.prepare('SELECT * FROM journey_blueprints WHERE id=? AND space_id=?')
    .get(input.blueprintId, input.spaceId) as any;
  if (!blueprint) throw new JourneyServiceBlueprintRepositoryError('Service blueprint not found.', 404, 'JOURNEY_BLUEPRINT_NOT_FOUND');
  if (blueprint.lifecycle === 'retired') throw new JourneyServiceBlueprintRepositoryError(
    'A retired blueprint cannot receive a new version.', 409, 'JOURNEY_BLUEPRINT_RETIRED');
  const mapVersion = db.prepare('SELECT 1 FROM journey_map_versions WHERE id=? AND definition_id=? AND space_id=?')
    .get(input.journeyVersionId, blueprint.journey_definition_id, input.spaceId);
  if (!mapVersion) throw new JourneyServiceBlueprintRepositoryError(
    'The journey map version is unavailable for this blueprint.', 404, 'JOURNEY_BLUEPRINT_MAP_VERSION_NOT_FOUND');
  const versionId = crypto.randomUUID();
  const versionNumber = Number((db.prepare(`SELECT COALESCE(MAX(version_number),0)+1 next_version
    FROM journey_blueprint_versions WHERE blueprint_id=? AND space_id=?`).get(input.blueprintId, input.spaceId) as any).next_version);
  const resources = listJourneyBlueprintResources({ spaceId: input.spaceId, actorUserId: input.actorUserId, includeRetired: true });
  const candidate: JourneyServiceBlueprint = {
    schemaVersion: JOURNEY_SERVICE_BLUEPRINT_VERSION, blueprintId: input.blueprintId, spaceId: input.spaceId,
    journeyDefinitionId: String(blueprint.journey_definition_id), journeyVersionId: input.journeyVersionId,
    state: input.state, versionId, versionNumber, reviewState: 'draft', stages: input.stages,
    elements: input.elements, relationships: input.relationships, resources, portfolioLinks: input.portfolioLinks || []
  };
  let analysis;
  try { analysis = analyseServiceBlueprint(candidate); } catch (error) { domainFailure(error); }
  if (!analysis.valid) throw new JourneyServiceBlueprintRepositoryError(
    'The blueprint contains invalid stages, elements, resources, or relationships.', 422,
    'JOURNEY_BLUEPRINT_ANALYSIS_INVALID', { issues: analysis.issues });
  for (const link of candidate.portfolioLinks || []) {
    const item = db.prepare(`SELECT kind,revision FROM journey_portfolio_items WHERE id=? AND space_id=?`)
      .get(link.portfolioItemId, input.spaceId) as any;
    if (!item || item.kind !== link.portfolioItemKind || Number(item.revision) !== link.portfolioItemRevision) {
      throw new JourneyServiceBlueprintRepositoryError('A portfolio link does not match an exact item revision in this space.',
        422, 'JOURNEY_BLUEPRINT_PORTFOLIO_LINK_INVALID', { linkId: link.id });
    }
  }
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`INSERT INTO journey_blueprint_versions
      (id,blueprint_id,space_id,journey_definition_id,journey_version_id,version_number,blueprint_state,review_state,
       schema_version,change_reason,actor_user_id,created_at,approved_by_user_id,approved_at)
      VALUES (?,?,?,?,?,?,?,'draft',?,?,?,?,NULL,NULL)`).run(
      versionId, input.blueprintId, input.spaceId, blueprint.journey_definition_id, input.journeyVersionId,
      versionNumber, input.state, JOURNEY_SERVICE_BLUEPRINT_VERSION, input.changeReason || null, input.actorUserId, now);
    const stageInsert = db.prepare(`INSERT INTO journey_blueprint_stages
      (version_id,space_id,stage_key,name,ordinal) VALUES (?,?,?,?,?)`);
    input.stages.forEach((stage) => stageInsert.run(versionId, input.spaceId, stage.stageKey, stage.name, stage.ordinal));
    const elementInsert = db.prepare(`INSERT INTO journey_blueprint_elements
      (id,version_id,space_id,stage_key,lane,kind,title,description,owner_team_resource_id,actor_resource_id,
       system_resource_id,vendor_resource_id,control_resource_id,sla_minutes,unit_cost,risk_probability,risk_impact,
       ordinal,evidence_refs_json,metric_refs_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    input.elements.forEach((element, index) => elementInsert.run(
      element.id, versionId, input.spaceId, element.stageKey, element.lane, element.kind, element.title,
      element.description || '', element.ownerTeamId || null, element.actorId || null, element.systemId || null,
      element.vendorId || null, element.controlId || null, element.slaMinutes ?? null, element.unitCost ?? null,
      element.riskProbability ?? null, element.riskImpact ?? null, element.ordinal ?? index,
      JSON.stringify(element.evidenceRefs || []), JSON.stringify(element.metricRefs || [])));
    const relationshipInsert = db.prepare(`INSERT INTO journey_blueprint_relationships
      (id,version_id,space_id,kind,from_element_id,to_element_id,label) VALUES (?,?,?,?,?,?,?)`);
    input.relationships.forEach((relationship) => relationshipInsert.run(
      relationship.id, versionId, input.spaceId, relationship.kind, relationship.fromElementId,
      relationship.toElementId, relationship.label || ''));
    const linkInsert = db.prepare(`INSERT INTO journey_blueprint_portfolio_links
      (id,space_id,blueprint_version_id,element_id,portfolio_item_id,portfolio_item_revision,relationship,
       created_by_user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)`);
    (candidate.portfolioLinks || []).forEach((link) => linkInsert.run(
      link.id, input.spaceId, versionId, link.elementId, link.portfolioItemId, link.portfolioItemRevision,
      link.relationship, input.actorUserId, now));
    const gapInsert = db.prepare(`INSERT INTO journey_blueprint_gap_assessments
      (id,space_id,blueprint_version_id,gap_type,target_element_id,target_relationship_id,severity,state,reason_code,
       detail_json,reviewer_user_id,reviewed_at,created_at) VALUES (?,?,?,?,?,?,?,'open',?,?,NULL,NULL,?)`);
    analysis.issues.filter((issue) => issue.gapType && issue.gapSeverity).forEach((issue) => gapInsert.run(
      crypto.randomUUID(), input.spaceId, versionId, issue.gapType, issue.elementId || null,
      issue.relationshipId || null, issue.gapSeverity, issue.code,
      JSON.stringify({ message: issue.message, stageKey: issue.stageKey || null, field: issue.field || null }), now));
    db.prepare(`UPDATE journey_blueprints SET current_version_id=?,revision=revision+1,updated_by_user_id=?,updated_at=?
      WHERE id=? AND space_id=?`).run(versionId, input.actorUserId, now, input.blueprintId, input.spaceId);
  })();
  return { version: readVersionUnchecked(input.spaceId, versionId), analysis };
}

export function reviewJourneyServiceBlueprintVersion(input: {
  spaceId: string; actorUserId: string; versionId: string; expectedReviewState: JourneyBlueprintReviewState;
  reviewState: JourneyBlueprintReviewState;
}) {
  assertManage(input.spaceId, input.actorUserId);
  const approved = input.reviewState === 'approved'; const now = new Date().toISOString();
  const result = db.prepare(`UPDATE journey_blueprint_versions SET review_state=?,approved_by_user_id=?,approved_at=?
    WHERE id=? AND space_id=? AND review_state=?`).run(
    input.reviewState, approved ? input.actorUserId : null, approved ? now : null,
    input.versionId, input.spaceId, input.expectedReviewState);
  if (!result.changes) {
    const exists = db.prepare('SELECT review_state FROM journey_blueprint_versions WHERE id=? AND space_id=?')
      .get(input.versionId, input.spaceId) as any;
    if (!exists) throw new JourneyServiceBlueprintRepositoryError('Blueprint version not found.', 404, 'JOURNEY_BLUEPRINT_VERSION_NOT_FOUND');
    throw new JourneyServiceBlueprintRepositoryError('The blueprint review state changed before this update.',
      409, 'JOURNEY_BLUEPRINT_REVIEW_CONFLICT', { expectedReviewState: input.expectedReviewState, actualReviewState: exists.review_state });
  }
  return readVersionUnchecked(input.spaceId, input.versionId);
}

export function analysePersistedJourneyServiceBlueprint(input: {
  spaceId: string; actorUserId: string; versionId: string;
}) {
  const version = readJourneyServiceBlueprintVersion(input);
  try { return analyseServiceBlueprint(version); } catch (error) { domainFailure(error); }
}

export type JourneyServiceBlueprintExportFormat = 'json' | 'csv';

function exportCsvRow(values: unknown[]) {
  return values.map(formulaSafeCsvCell).join(',');
}

/** Produces a bounded, version-pinned export. The JSON and CSV projections both
 * retain the exact journey/map/blueprint version, lane/stage context, governed
 * resource links, portfolio links, gap review state, and calculated analysis.
 * CSV cells are formula-safe even when user-authored labels begin with a
 * spreadsheet operator. */
export function exportJourneyServiceBlueprintVersion(input: {
  spaceId: string; actorUserId: string; versionId: string; format: JourneyServiceBlueprintExportFormat;
  requestId?: string | null;
}) {
  const version = readVersionUnchecked(input.spaceId, input.versionId);
  assertExport(input.spaceId, input.actorUserId, version.journeyDefinitionId);
  const blueprintRow = db.prepare('SELECT * FROM journey_blueprints WHERE id=? AND space_id=?')
    .get(version.blueprintId, input.spaceId) as any;
  if (!blueprintRow) throw new JourneyServiceBlueprintRepositoryError(
    'Service blueprint not found.', 404, 'JOURNEY_BLUEPRINT_NOT_FOUND');
  let analysis;
  try { analysis = analyseServiceBlueprint(version); } catch (error) { domainFailure(error); }
  const blueprint = mapBlueprint(blueprintRow);
  const content = {
    blueprint, version, analysis
  };
  const canonicalContent = JSON.stringify(content);
  const contentSha256 = crypto.createHash('sha256').update(canonicalContent).digest('hex');
  const generatedAt = new Date().toISOString();
  let bytes: Buffer;
  let mimeType: string;
  if (input.format === 'json') {
    bytes = Buffer.from(`${JSON.stringify({
      schemaVersion: 'journey-service-blueprint-export/v1', generatedAt, contentSha256, ...content
    }, null, 2)}\n`, 'utf8');
    mimeType = 'application/json; charset=utf-8';
  } else {
    const columns = [
      'record_type', 'blueprint_id', 'blueprint_version_id', 'journey_definition_id', 'journey_version_id',
      'version_number', 'blueprint_state', 'review_state', 'stage_key', 'stage_name', 'lane', 'record_id',
      'kind', 'title_or_label', 'description', 'from_element_id', 'to_element_id', 'owner_team_id',
      'actor_id', 'system_id', 'vendor_id', 'control_id', 'sla_minutes', 'unit_cost', 'risk_probability',
      'risk_impact', 'evidence_refs', 'metric_refs', 'portfolio_item_id', 'portfolio_item_kind',
      'portfolio_item_revision', 'relationship', 'gap_state', 'severity', 'reason_code', 'content_sha256'
    ];
    const shared = [version.blueprintId, version.versionId, version.journeyDefinitionId, version.journeyVersionId,
      version.versionNumber, version.state, version.reviewState];
    const rows: unknown[][] = [];
    rows.push(['blueprint', ...shared, '', '', '', blueprint.id, 'blueprint', blueprint.name, '', '', '',
      blueprint.ownerTeamId, '', '', '', '', '', '', '', '', '', '', '', '', '', '', blueprint.lifecycle, '', '', contentSha256]);
    for (const stage of version.stages) rows.push(['stage', ...shared, stage.stageKey, stage.name, '', stage.stageKey,
      'stage', stage.name, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', contentSha256]);
    for (const element of version.elements) rows.push(['element', ...shared, element.stageKey,
      version.stages.find((stage) => stage.stageKey === element.stageKey)?.name || element.stageKey,
      element.lane, element.id, element.kind, element.title, element.description || '', '', '', element.ownerTeamId || '',
      element.actorId || '', element.systemId || '', element.vendorId || '', element.controlId || '',
      element.slaMinutes ?? '', element.unitCost ?? '', element.riskProbability ?? '', element.riskImpact ?? '',
      (element.evidenceRefs || []).join('|'), (element.metricRefs || []).join('|'), '', '', '', '', '', '', '', contentSha256]);
    for (const relationship of version.relationships) rows.push(['relationship', ...shared, '', '', '', relationship.id,
      relationship.kind, relationship.label || '', '', relationship.fromElementId, relationship.toElementId,
      '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', relationship.kind, '', '', '', contentSha256]);
    for (const link of version.portfolioLinks || []) rows.push(['portfolio_link', ...shared, '', '', '', link.id,
      'portfolio_link', '', '', link.elementId, '', '', '', '', '', '', '', '', '', '', '', '', '',
      link.portfolioItemId, link.portfolioItemKind, link.portfolioItemRevision, link.relationship, '', '', '', contentSha256]);
    for (const gap of version.gaps) rows.push(['gap', ...shared, '', '', '', gap.id, gap.gapType, '', '',
      gap.targetElementId || '', gap.targetRelationshipId || '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
      '', gap.state, gap.severity, gap.reasonCode, contentSha256]);
    for (const resource of version.resources || []) rows.push(['resource', ...shared, '', '', '', resource.id,
      resource.kind, resource.name, resource.description, '', '', '', resource.kind === 'actor' ? resource.id : '',
      resource.kind === 'system' ? resource.id : '', resource.kind === 'vendor' ? resource.id : '',
      resource.kind === 'control' ? resource.id : '', '', '', '', '', '', '', '', '', '', '', '', resource.lifecycle,
      '', '', contentSha256]);
    bytes = Buffer.from(`${exportCsvRow(columns)}\r\n${rows.map(exportCsvRow).join('\r\n')}\r\n`, 'utf8');
    mimeType = 'text/csv; charset=utf-8';
  }
  recordJourneyGovernedActivity({
    spaceId: input.spaceId, actorUserId: input.actorUserId, action: 'blueprint.export',
    targetType: 'journey_blueprint_version', targetId: input.versionId,
    journeyDefinitionId: version.journeyDefinitionId, requestId: input.requestId,
    detail: { formatCode: input.format, contentSha256, byteCount: bytes.byteLength,
      stageCount: version.stages.length, elementCount: version.elements.length,
      relationshipCount: version.relationships.length, gapCount: version.gaps.length }
  });
  return {
    bytes, mimeType, contentSha256,
    filename: `journey-service-blueprint-${version.blueprintId}-v${version.versionNumber}.${input.format}`
  };
}

export function comparePersistedJourneyServiceBlueprints(input: {
  spaceId: string; actorUserId: string; fromVersionId: string; toVersionId: string;
}) {
  assertRead(input.spaceId, input.actorUserId);
  const from = readVersionUnchecked(input.spaceId, input.fromVersionId);
  const to = readVersionUnchecked(input.spaceId, input.toVersionId);
  let comparison;
  try { comparison = compareServiceBlueprints(from, to); } catch (error) { domainFailure(error); }
  const resultJson = JSON.stringify(comparison);
  const resultSha256 = crypto.createHash('sha256').update(resultJson).digest('hex');
  const now = new Date().toISOString(); const id = crypto.randomUUID();
  try {
    db.prepare(`INSERT INTO journey_blueprint_comparisons
      (id,space_id,journey_definition_id,from_version_id,to_version_id,result_json,result_sha256,actor_user_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(id, input.spaceId, comparison.journeyDefinitionId,
      input.fromVersionId, input.toVersionId, resultJson, resultSha256, input.actorUserId, now);
  } catch {
    const existing = db.prepare(`SELECT id,created_at FROM journey_blueprint_comparisons
      WHERE space_id=? AND from_version_id=? AND to_version_id=? AND result_sha256=?`)
      .get(input.spaceId, input.fromVersionId, input.toVersionId, resultSha256) as any;
    if (existing) return { id: String(existing.id), createdAt: String(existing.created_at), comparison };
    throw new JourneyServiceBlueprintRepositoryError('The blueprint comparison could not be persisted.',
      409, 'JOURNEY_BLUEPRINT_COMPARISON_CONFLICT');
  }
  return { id, createdAt: now, comparison };
}

export function reviewJourneyBlueprintGap(input: {
  spaceId: string; actorUserId: string; gapId: string;
  state: 'accepted' | 'resolved' | 'dismissed';
}) {
  assertManage(input.spaceId, input.actorUserId);
  const now = new Date().toISOString();
  const result = db.prepare(`UPDATE journey_blueprint_gap_assessments SET state=?,reviewer_user_id=?,reviewed_at=?
    WHERE id=? AND space_id=? AND state='open'`).run(input.state, input.actorUserId, now, input.gapId, input.spaceId);
  if (!result.changes) {
    const exists = db.prepare('SELECT 1 FROM journey_blueprint_gap_assessments WHERE id=? AND space_id=?')
      .get(input.gapId, input.spaceId);
    throw new JourneyServiceBlueprintRepositoryError(exists ? 'Only an open gap can be reviewed.' : 'Blueprint gap not found.',
      exists ? 409 : 404, exists ? 'JOURNEY_BLUEPRINT_GAP_STATE_CONFLICT' : 'JOURNEY_BLUEPRINT_GAP_NOT_FOUND');
  }
  return mapGap(db.prepare('SELECT * FROM journey_blueprint_gap_assessments WHERE id=? AND space_id=?')
    .get(input.gapId, input.spaceId));
}
