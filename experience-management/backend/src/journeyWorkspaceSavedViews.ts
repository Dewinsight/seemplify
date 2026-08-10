import crypto from 'node:crypto';
import { db } from './database.js';
import { assertJourneyCapability } from './journeyCollaboration.js';
import { assertSubscriptionFeature } from './subscriptionEntitlements.js';

export type JourneyWorkspaceViewSurface = 'hierarchy' | 'service_blueprint';
export type JourneyWorkspaceViewAudience = 'internal' | 'executive' | 'research' | 'delivery' | 'external';

export type JourneyHierarchyViewConfiguration = {
  version: 1;
  includeRetired: boolean;
  rootDefinitionId: string | null;
  direction: 'upstream' | 'downstream' | 'both';
  taxonomyKinds: Array<'product' | 'geography' | 'channel' | 'segment' | 'tag' | 'business_unit'>;
  reviewStates: Array<'draft' | 'in_review' | 'approved' | 'changes_requested'>;
  lifecycles: Array<'active' | 'retired'>;
};

export type JourneyBlueprintViewConfiguration = {
  version: 1;
  blueprintId: string | null;
  versionMode: 'current' | 'future' | 'comparison';
  selectedSection: 'design' | 'analysis' | 'history' | 'measurements';
  lifecycles: Array<'draft' | 'in_review' | 'approved' | 'retired'>;
};

export type JourneyWorkspaceViewConfiguration = JourneyHierarchyViewConfiguration | JourneyBlueprintViewConfiguration;

export class JourneyWorkspaceSavedViewError extends Error {
  constructor(message: string, public status = 400, public code = 'JOURNEY_WORKSPACE_VIEW_INVALID') {
    super(message);
    this.name = 'JourneyWorkspaceSavedViewError';
  }
}

function ensureSqliteSchema() {
  if (db.provider !== 'sqlite') return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS journey_workspace_view_definitions (
      id TEXT PRIMARY KEY,space_id TEXT NOT NULL,owner_user_id TEXT NOT NULL,
      surface TEXT NOT NULL CHECK(surface IN ('hierarchy','service_blueprint')),
      audience TEXT NOT NULL CHECK(audience IN ('internal','executive','research','delivery','external')),
      name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
      state TEXT NOT NULL CHECK(state IN ('active','retired')),current_version_id TEXT,
      revision INTEGER NOT NULL CHECK(revision>0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,retired_at TEXT,
      UNIQUE(id,space_id),FOREIGN KEY(space_id,owner_user_id) REFERENCES space_memberships(space_id,user_id) ON DELETE CASCADE,
      CHECK((state='active' AND retired_at IS NULL) OR (state='retired' AND retired_at IS NOT NULL))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS journey_workspace_view_active_name
      ON journey_workspace_view_definitions(space_id,owner_user_id,surface,LOWER(name)) WHERE state='active';
    CREATE INDEX IF NOT EXISTS journey_workspace_view_owner
      ON journey_workspace_view_definitions(space_id,owner_user_id,surface,state,updated_at DESC,id);
    CREATE TABLE IF NOT EXISTS journey_workspace_view_versions (
      id TEXT PRIMARY KEY,view_id TEXT NOT NULL,space_id TEXT NOT NULL,version_number INTEGER NOT NULL CHECK(version_number>0),
      configuration_json TEXT NOT NULL CHECK(json_valid(configuration_json)),configuration_sha256 TEXT NOT NULL CHECK(length(configuration_sha256)=64),
      created_by_user_id TEXT,created_at TEXT NOT NULL,UNIQUE(id,space_id),UNIQUE(id,view_id,space_id),
      UNIQUE(view_id,space_id,version_number),FOREIGN KEY(view_id,space_id) REFERENCES journey_workspace_view_definitions(id,space_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS journey_workspace_view_preferences (
      space_id TEXT NOT NULL,user_id TEXT NOT NULL,surface TEXT NOT NULL CHECK(surface IN ('hierarchy','service_blueprint')),
      default_view_id TEXT,revision INTEGER NOT NULL CHECK(revision>0),updated_at TEXT NOT NULL,
      PRIMARY KEY(space_id,user_id,surface),FOREIGN KEY(space_id,user_id) REFERENCES space_memberships(space_id,user_id) ON DELETE CASCADE,
      FOREIGN KEY(default_view_id,space_id) REFERENCES journey_workspace_view_definitions(id,space_id)
    );
    CREATE TABLE IF NOT EXISTS journey_workspace_view_operations (
      id TEXT PRIMARY KEY,space_id TEXT NOT NULL,actor_user_id TEXT NOT NULL,idempotency_key_sha256 TEXT NOT NULL,
      operation TEXT NOT NULL CHECK(operation IN ('create','revise','retire','set_default')),intent_sha256 TEXT NOT NULL,
      result_json TEXT NOT NULL CHECK(json_valid(result_json)),result_sha256 TEXT NOT NULL,created_at TEXT NOT NULL,
      UNIQUE(space_id,actor_user_id,idempotency_key_sha256)
    );
    CREATE TABLE IF NOT EXISTS journey_workspace_view_audit_events (
      id TEXT PRIMARY KEY,space_id TEXT NOT NULL,view_id TEXT,actor_user_id TEXT,
      event TEXT NOT NULL CHECK(event IN ('created','revised','retired','default_changed')),
      detail_json TEXT NOT NULL CHECK(json_valid(detail_json)),detail_sha256 TEXT NOT NULL,created_at TEXT NOT NULL,
      UNIQUE(id,space_id),FOREIGN KEY(view_id,space_id) REFERENCES journey_workspace_view_definitions(id,space_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS journey_workspace_view_audit_history
      ON journey_workspace_view_audit_events(space_id,created_at DESC,id);
    CREATE TRIGGER IF NOT EXISTS journey_workspace_view_versions_update_guard BEFORE UPDATE ON journey_workspace_view_versions
      BEGIN SELECT RAISE(ABORT,'workspace view history is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_workspace_view_versions_delete_guard BEFORE DELETE ON journey_workspace_view_versions
      BEGIN SELECT RAISE(ABORT,'workspace view history is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_workspace_view_operations_update_guard BEFORE UPDATE ON journey_workspace_view_operations
      BEGIN SELECT RAISE(ABORT,'workspace view operations are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_workspace_view_operations_delete_guard BEFORE DELETE ON journey_workspace_view_operations
      BEGIN SELECT RAISE(ABORT,'workspace view operations are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_workspace_view_audit_update_guard BEFORE UPDATE ON journey_workspace_view_audit_events
      BEGIN SELECT RAISE(ABORT,'workspace view audit is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_workspace_view_audit_delete_guard BEFORE DELETE ON journey_workspace_view_audit_events
      BEGIN SELECT RAISE(ABORT,'workspace view audit is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_workspace_view_preference_insert_guard BEFORE INSERT ON journey_workspace_view_preferences
      WHEN NEW.default_view_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM journey_workspace_view_definitions view
        WHERE view.id=NEW.default_view_id AND view.space_id=NEW.space_id AND view.owner_user_id=NEW.user_id
          AND view.surface=NEW.surface AND view.state='active')
      BEGIN SELECT RAISE(ABORT,'default workspace view must be active, owned and surface-matched'); END;
    CREATE TRIGGER IF NOT EXISTS journey_workspace_view_preference_update_guard BEFORE UPDATE ON journey_workspace_view_preferences
      WHEN NEW.default_view_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM journey_workspace_view_definitions view
        WHERE view.id=NEW.default_view_id AND view.space_id=NEW.space_id AND view.owner_user_id=NEW.user_id
          AND view.surface=NEW.surface AND view.state='active')
      BEGIN SELECT RAISE(ABORT,'default workspace view must be active, owned and surface-matched'); END;
  `);
}

ensureSqliteSchema();

function sha(value: string) { return crypto.createHash('sha256').update(value).digest('hex'); }
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stable(item)]));
  return value;
}
function canonical(value: unknown) { return JSON.stringify(stable(value)); }
function token(value: unknown, label: string, maximum = 160) {
  const result = String(value ?? '').trim();
  if (!result || result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) throw new JourneyWorkspaceSavedViewError(
    `${label} must contain 1 to ${maximum} safe characters.`, 400, 'JOURNEY_WORKSPACE_VIEW_INPUT_INVALID');
  return result;
}
function iso(value: unknown = new Date().toISOString()) {
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new JourneyWorkspaceSavedViewError(
    'Timestamp is invalid.', 400, 'JOURNEY_WORKSPACE_VIEW_INPUT_INVALID');
  return date.toISOString();
}
function stringArray<T extends string>(value: unknown, allowed: readonly T[], label: string, maximum = 16): T[] {
  if (!Array.isArray(value) || value.length > maximum) throw new JourneyWorkspaceSavedViewError(
    `${label} must be a bounded array.`, 400, 'JOURNEY_WORKSPACE_VIEW_CONFIGURATION_INVALID');
  const result = [...new Set(value.map((item) => token(item, label, 80) as T))].sort();
  if (result.some((item) => !allowed.includes(item))) throw new JourneyWorkspaceSavedViewError(
    `${label} contains an unsupported value.`, 400, 'JOURNEY_WORKSPACE_VIEW_CONFIGURATION_INVALID');
  return result;
}
function exactObject(value: unknown, keys: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new JourneyWorkspaceSavedViewError(
    'Saved-view configuration must be an object.', 400, 'JOURNEY_WORKSPACE_VIEW_CONFIGURATION_INVALID');
  const actual = Object.keys(value as Record<string, unknown>).sort();
  if (actual.join('|') !== [...keys].sort().join('|')) throw new JourneyWorkspaceSavedViewError(
    'Saved-view configuration contains missing or unsupported fields.', 400, 'JOURNEY_WORKSPACE_VIEW_CONFIGURATION_INVALID');
  return value as Record<string, unknown>;
}

function configuration(surface: JourneyWorkspaceViewSurface, value: unknown): JourneyWorkspaceViewConfiguration {
  if (surface === 'hierarchy') {
    const row = exactObject(value, ['version','includeRetired','rootDefinitionId','direction','taxonomyKinds','reviewStates','lifecycles']);
    if (row.version !== 1 || typeof row.includeRetired !== 'boolean'
      || !['upstream','downstream','both'].includes(String(row.direction))) throw new JourneyWorkspaceSavedViewError(
      'Hierarchy saved-view configuration is invalid.', 400, 'JOURNEY_WORKSPACE_VIEW_CONFIGURATION_INVALID');
    return {
      version: 1, includeRetired: row.includeRetired, rootDefinitionId: row.rootDefinitionId === null ? null : token(row.rootDefinitionId, 'rootDefinitionId', 128),
      direction: row.direction as JourneyHierarchyViewConfiguration['direction'],
      taxonomyKinds: stringArray(row.taxonomyKinds, ['product','geography','channel','segment','tag','business_unit'] as const, 'taxonomyKinds'),
      reviewStates: stringArray(row.reviewStates, ['draft','in_review','approved','changes_requested'] as const, 'reviewStates'),
      lifecycles: stringArray(row.lifecycles, ['active','retired'] as const, 'lifecycles')
    };
  }
  const row = exactObject(value, ['version','blueprintId','versionMode','selectedSection','lifecycles']);
  if (row.version !== 1 || !['current','future','comparison'].includes(String(row.versionMode))
    || !['design','analysis','history','measurements'].includes(String(row.selectedSection))) throw new JourneyWorkspaceSavedViewError(
    'Blueprint saved-view configuration is invalid.', 400, 'JOURNEY_WORKSPACE_VIEW_CONFIGURATION_INVALID');
  return {
    version: 1, blueprintId: row.blueprintId === null ? null : token(row.blueprintId, 'blueprintId', 128),
    versionMode: row.versionMode as JourneyBlueprintViewConfiguration['versionMode'],
    selectedSection: row.selectedSection as JourneyBlueprintViewConfiguration['selectedSection'],
    lifecycles: stringArray(row.lifecycles, ['draft','in_review','approved','retired'] as const, 'lifecycles')
  };
}

function access(spaceId: string, userId: string, surface: JourneyWorkspaceViewSurface) {
  assertSubscriptionFeature(spaceId, surface === 'hierarchy' ? 'journeyHierarchy' : 'journeyBlueprints');
  assertJourneyCapability(spaceId, userId, 'journeys.read');
}
function verifyReferences(spaceId: string, surface: JourneyWorkspaceViewSurface, config: JourneyWorkspaceViewConfiguration) {
  if (surface === 'hierarchy' && (config as JourneyHierarchyViewConfiguration).rootDefinitionId) {
    const id = (config as JourneyHierarchyViewConfiguration).rootDefinitionId;
    const found = db.prepare('SELECT 1 found FROM journey_definitions WHERE id=? AND space_id=?').get(id, spaceId) as any;
    if (!found) throw new JourneyWorkspaceSavedViewError('Hierarchy root not found.', 404, 'JOURNEY_WORKSPACE_VIEW_REFERENCE_NOT_FOUND');
  }
  if (surface === 'service_blueprint' && (config as JourneyBlueprintViewConfiguration).blueprintId) {
    const id = (config as JourneyBlueprintViewConfiguration).blueprintId;
    const found = db.prepare('SELECT 1 found FROM journey_service_blueprints WHERE id=? AND space_id=?').get(id, spaceId) as any;
    if (!found) throw new JourneyWorkspaceSavedViewError('Blueprint not found.', 404, 'JOURNEY_WORKSPACE_VIEW_REFERENCE_NOT_FOUND');
  }
}
function rowView(row: any) {
  return {
    id: String(row.id), surface: row.surface as JourneyWorkspaceViewSurface,
    audience: row.audience as JourneyWorkspaceViewAudience, name: String(row.name), state: row.state as 'active' | 'retired',
    revision: Number(row.revision), versionId: String(row.current_version_id), versionNumber: Number(row.version_number),
    configuration: JSON.parse(String(row.configuration_json)) as JourneyWorkspaceViewConfiguration,
    configurationSha256: String(row.configuration_sha256), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at)
  };
}
function replay(spaceId: string, actorUserId: string, idempotencyKey: string, operation: string, intent: unknown) {
  const keyHash = sha(token(idempotencyKey, 'Idempotency-Key', 200));
  const row = db.prepare(`SELECT operation,intent_sha256,result_json FROM journey_workspace_view_operations
    WHERE space_id=? AND actor_user_id=? AND idempotency_key_sha256=?`).get(spaceId, actorUserId, keyHash) as any;
  if (!row) return { keyHash, result: null as any };
  if (row.operation !== operation || row.intent_sha256 !== sha(canonical(intent))) throw new JourneyWorkspaceSavedViewError(
    'Idempotency key was already used for another intent.', 409, 'JOURNEY_WORKSPACE_VIEW_IDEMPOTENCY_CONFLICT');
  return { keyHash, result: JSON.parse(String(row.result_json)) };
}
function recordOperation(spaceId: string, actorUserId: string, keyHash: string, operation: string, intent: unknown,
  result: unknown, at: string) {
  const resultJson = canonical(result);
  db.prepare(`INSERT INTO journey_workspace_view_operations
    (id,space_id,actor_user_id,idempotency_key_sha256,operation,intent_sha256,result_json,result_sha256,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), spaceId, actorUserId, keyHash, operation,
      sha(canonical(intent)), resultJson, sha(resultJson), at);
}
function audit(spaceId: string, actorUserId: string, viewId: string | null, event: string, detail: unknown, at: string) {
  const body = canonical(detail);
  db.prepare(`INSERT INTO journey_workspace_view_audit_events
    (id,space_id,view_id,actor_user_id,event,detail_json,detail_sha256,created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(crypto.randomUUID(), spaceId, viewId, actorUserId, event, body, sha(body), at);
}

export function listJourneyWorkspaceSavedViews(input: { spaceId: string; actorUserId: string;
  surface: JourneyWorkspaceViewSurface; includeRetired?: boolean }) {
  access(input.spaceId, input.actorUserId, input.surface);
  const rows = db.prepare(`SELECT view.*,version.version_number,version.configuration_json,version.configuration_sha256
    FROM journey_workspace_view_definitions view JOIN journey_workspace_view_versions version
      ON version.id=view.current_version_id AND version.space_id=view.space_id
    WHERE view.space_id=? AND view.owner_user_id=? AND view.surface=? ${input.includeRetired ? '' : "AND view.state='active'"}
    ORDER BY LOWER(view.name),view.id`).all(input.spaceId, input.actorUserId, input.surface) as any[];
  const preference = db.prepare(`SELECT default_view_id,revision FROM journey_workspace_view_preferences
    WHERE space_id=? AND user_id=? AND surface=?`).get(input.spaceId, input.actorUserId, input.surface) as any;
  return { views: rows.map(rowView), defaultViewId: preference?.default_view_id || null,
    preferenceRevision: Number(preference?.revision || 0) };
}

export function createJourneyWorkspaceSavedView(input: { spaceId: string; actorUserId: string;
  surface: JourneyWorkspaceViewSurface; audience: JourneyWorkspaceViewAudience; name: string;
  configuration: unknown; makeDefault?: boolean; expectedPreferenceRevision?: number;
  idempotencyKey: string; at?: string }) {
  access(input.spaceId, input.actorUserId, input.surface);
  const config = configuration(input.surface, input.configuration); verifyReferences(input.spaceId, input.surface, config);
  const name = token(input.name, 'name'), at = iso(input.at), intent = { surface: input.surface,
    audience: input.audience, name, configuration: config, makeDefault: Boolean(input.makeDefault),
    expectedPreferenceRevision: input.makeDefault ? input.expectedPreferenceRevision ?? 0 : null };
  return db.transaction(() => {
    const previous = replay(input.spaceId, input.actorUserId, input.idempotencyKey, 'create', intent);
    if (previous.result) return { ...previous.result, replayed: true };
    const viewId = crypto.randomUUID(), versionId = crypto.randomUUID(), body = canonical(config);
    db.prepare(`INSERT INTO journey_workspace_view_definitions
      (id,space_id,owner_user_id,surface,audience,name,state,current_version_id,revision,created_at,updated_at,retired_at)
      VALUES (?,?,?,?,?,?,'active',NULL,1,?,?,NULL)`).run(viewId, input.spaceId, input.actorUserId,
        input.surface, input.audience, name, at, at);
    db.prepare(`INSERT INTO journey_workspace_view_versions
      (id,view_id,space_id,version_number,configuration_json,configuration_sha256,created_by_user_id,created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(versionId, viewId, input.spaceId, 1, body, sha(body), input.actorUserId, at);
    db.prepare(`UPDATE journey_workspace_view_definitions SET current_version_id=? WHERE id=? AND space_id=?`)
      .run(versionId, viewId, input.spaceId);
    const preferenceRevision = input.makeDefault
      ? setDefaultInside(input.spaceId, input.actorUserId, input.surface, viewId,
        input.expectedPreferenceRevision ?? 0, at)
      : null;
    const result = { viewId, preferenceRevision };
    audit(input.spaceId, input.actorUserId, viewId, 'created', { surface: input.surface, audience: input.audience,
      revision: 1, configurationSha256: sha(body) }, at);
    recordOperation(input.spaceId, input.actorUserId, previous.keyHash, 'create', intent, result, at);
    return { ...result, replayed: false };
  })();
}

export function reviseJourneyWorkspaceSavedView(input: { spaceId: string; actorUserId: string; viewId: string;
  expectedRevision: number; audience: JourneyWorkspaceViewAudience; name: string; configuration: unknown;
  idempotencyKey: string; at?: string }) {
  const name = token(input.name, 'name'), at = iso(input.at), intent = { viewId: input.viewId,
    expectedRevision: input.expectedRevision, audience: input.audience, name, configuration: input.configuration };
  return db.transaction(() => {
    const row = db.prepare(`SELECT * FROM journey_workspace_view_definitions
      WHERE id=? AND space_id=? AND owner_user_id=? AND state='active'`).get(input.viewId, input.spaceId, input.actorUserId) as any;
    if (!row) throw new JourneyWorkspaceSavedViewError('Saved view not found.', 404, 'JOURNEY_WORKSPACE_VIEW_NOT_FOUND');
    access(input.spaceId, input.actorUserId, row.surface);
    const config = configuration(row.surface, input.configuration); verifyReferences(input.spaceId, row.surface, config);
    intent.configuration = config;
    const previous = replay(input.spaceId, input.actorUserId, input.idempotencyKey, 'revise', intent);
    if (previous.result) return { ...previous.result, replayed: true };
    if (Number(row.revision) !== input.expectedRevision) throw new JourneyWorkspaceSavedViewError(
      'Saved view revision conflict.', 409, 'JOURNEY_WORKSPACE_VIEW_REVISION_CONFLICT');
    const next = input.expectedRevision + 1, versionId = crypto.randomUUID(), body = canonical(config);
    db.prepare(`INSERT INTO journey_workspace_view_versions
      (id,view_id,space_id,version_number,configuration_json,configuration_sha256,created_by_user_id,created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(versionId, row.id, input.spaceId, next, body, sha(body), input.actorUserId, at);
    const changed = db.prepare(`UPDATE journey_workspace_view_definitions SET audience=?,name=?,current_version_id=?,revision=?,updated_at=?
      WHERE id=? AND space_id=? AND owner_user_id=? AND revision=? AND state='active'`).run(input.audience, name,
        versionId, next, at, row.id, input.spaceId, input.actorUserId, input.expectedRevision).changes;
    if (changed !== 1) throw new JourneyWorkspaceSavedViewError('Saved view revision conflict.', 409,
      'JOURNEY_WORKSPACE_VIEW_REVISION_CONFLICT');
    const result = { viewId: row.id };
    audit(input.spaceId, input.actorUserId, row.id, 'revised', { surface: row.surface, audience: input.audience,
      revision: next, configurationSha256: sha(body) }, at);
    recordOperation(input.spaceId, input.actorUserId, previous.keyHash, 'revise', intent, result, at);
    return { ...result, replayed: false };
  })();
}

export function retireJourneyWorkspaceSavedView(input: { spaceId: string; actorUserId: string; viewId: string;
  expectedRevision: number; idempotencyKey: string; at?: string }) {
  const at = iso(input.at), intent = { viewId: input.viewId, expectedRevision: input.expectedRevision };
  return db.transaction(() => {
    const row = db.prepare(`SELECT * FROM journey_workspace_view_definitions
      WHERE id=? AND space_id=? AND owner_user_id=? AND state='active'`).get(input.viewId, input.spaceId, input.actorUserId) as any;
    if (!row) throw new JourneyWorkspaceSavedViewError('Saved view not found.', 404, 'JOURNEY_WORKSPACE_VIEW_NOT_FOUND');
    access(input.spaceId, input.actorUserId, row.surface);
    const previous = replay(input.spaceId, input.actorUserId, input.idempotencyKey, 'retire', intent);
    if (previous.result) return { ...previous.result, replayed: true };
    if (Number(row.revision) !== input.expectedRevision) throw new JourneyWorkspaceSavedViewError(
      'Saved view revision conflict.', 409, 'JOURNEY_WORKSPACE_VIEW_REVISION_CONFLICT');
    const next = input.expectedRevision + 1;
    const changed = db.prepare(`UPDATE journey_workspace_view_definitions SET state='retired',revision=?,updated_at=?,retired_at=?
      WHERE id=? AND space_id=? AND owner_user_id=? AND revision=? AND state='active'`).run(next, at, at,
        row.id, input.spaceId, input.actorUserId, input.expectedRevision).changes;
    if (changed !== 1) throw new JourneyWorkspaceSavedViewError('Saved view revision conflict.', 409,
      'JOURNEY_WORKSPACE_VIEW_REVISION_CONFLICT');
    db.prepare(`UPDATE journey_workspace_view_preferences SET default_view_id=NULL,revision=revision+1,updated_at=?
      WHERE space_id=? AND user_id=? AND surface=? AND default_view_id=?`).run(at, input.spaceId, input.actorUserId,
        row.surface, row.id);
    const result = { viewId: row.id };
    audit(input.spaceId, input.actorUserId, row.id, 'retired', { surface: row.surface, revision: next }, at);
    recordOperation(input.spaceId, input.actorUserId, previous.keyHash, 'retire', intent, result, at);
    return { ...result, replayed: false };
  })();
}

function setDefaultInside(spaceId: string, actorUserId: string, surface: JourneyWorkspaceViewSurface,
  viewId: string | null, expectedRevision: number, at: string) {
  if (viewId) {
    const row = db.prepare(`SELECT 1 found FROM journey_workspace_view_definitions
      WHERE id=? AND space_id=? AND owner_user_id=? AND surface=? AND state='active'`).get(viewId, spaceId, actorUserId, surface) as any;
    if (!row) throw new JourneyWorkspaceSavedViewError('Saved view not found.', 404, 'JOURNEY_WORKSPACE_VIEW_NOT_FOUND');
  }
  const preference = db.prepare(`SELECT revision FROM journey_workspace_view_preferences
    WHERE space_id=? AND user_id=? AND surface=?`).get(spaceId, actorUserId, surface) as any;
  const current = Number(preference?.revision || 0);
  if (current !== expectedRevision) throw new JourneyWorkspaceSavedViewError(
    'Saved-view preference revision conflict.', 409, 'JOURNEY_WORKSPACE_VIEW_PREFERENCE_CONFLICT');
  if (!preference) db.prepare(`INSERT INTO journey_workspace_view_preferences
    (space_id,user_id,surface,default_view_id,revision,updated_at) VALUES (?,?,?,?,1,?)`)
    .run(spaceId, actorUserId, surface, viewId, at);
  else db.prepare(`UPDATE journey_workspace_view_preferences SET default_view_id=?,revision=revision+1,updated_at=?
    WHERE space_id=? AND user_id=? AND surface=? AND revision=?`).run(viewId, at, spaceId, actorUserId, surface, current);
  return current + 1;
}

export function setJourneyWorkspaceDefaultView(input: { spaceId: string; actorUserId: string;
  surface: JourneyWorkspaceViewSurface; viewId: string | null; expectedRevision: number;
  idempotencyKey: string; at?: string }) {
  access(input.spaceId, input.actorUserId, input.surface);
  const at = iso(input.at), intent = { surface: input.surface, viewId: input.viewId, expectedRevision: input.expectedRevision };
  return db.transaction(() => {
    const previous = replay(input.spaceId, input.actorUserId, input.idempotencyKey, 'set_default', intent);
    if (previous.result) return { ...previous.result, replayed: true };
    const preferenceRevision = setDefaultInside(input.spaceId, input.actorUserId, input.surface, input.viewId,
      input.expectedRevision, at);
    const result = { defaultViewId: input.viewId, preferenceRevision };
    audit(input.spaceId, input.actorUserId, input.viewId, 'default_changed', { surface: input.surface,
      preferenceRevision, hasDefault: input.viewId !== null }, at);
    recordOperation(input.spaceId, input.actorUserId, previous.keyHash, 'set_default', intent, result, at);
    return { ...result, replayed: false };
  })();
}
