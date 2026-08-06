import crypto from 'node:crypto';
import { db } from './database.js';
import { isDatabaseConstraintError } from './databaseAdapter.js';
import {
  compareJourneyEventSchemas,
  issueJourneyEventCredential,
  JourneyEventControlPlaneError,
  revokeJourneyEventCredential,
  rotateJourneyEventCredential,
  validateJourneyEventSchema,
  validateJourneyEventSourcePolicy,
  verifyJourneyEventCredential,
  type JourneyControlPlaneIssue,
  type JourneyEventCredentialKind,
  type JourneyEventCredentialRecord,
  type JourneyEventEnvironment,
  type JourneyEventPropertyDefinition,
  type JourneyEventSchemaVersion,
  type JourneyEventSourcePolicy,
  type JourneyEventSourceStatus,
  type JourneyEventValidationMode,
  type JourneySchemaCompatibilityResult
} from './journeyEventControlPlane.js';
import {
  assertSubscriptionFeature,
  assertSubscriptionQuota,
  effectiveSubscriptionForSpace,
  type SubscriptionQuota
} from './subscriptionEntitlements.js';

export class JourneyEventControlRepositoryError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code = 'JOURNEY_EVENT_CONTROL_ERROR',
    public readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'JourneyEventControlRepositoryError';
  }
}

export type JourneyEventSource = {
  id: string;
  spaceId: string;
  name: string;
  environment: JourneyEventEnvironment;
  status: JourneyEventSourceStatus;
  validationMode: JourneyEventValidationMode;
  allowedOrigins: string[];
  allowedBundleIds: string[];
  eventsPerMinute: number;
  bytesPerMinute: number;
  credentialCount: number;
  activeSchemaCount: number;
  revision: number;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type JourneyEventCredential = {
  id: string;
  sourceId: string;
  environment: JourneyEventEnvironment;
  kind: JourneyEventCredentialKind;
  scope: 'events:write';
  displayPrefix: string;
  status: 'active' | 'overlap' | 'revoked';
  rotatedFromId: string | null;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
};

export type JourneyEventSchemaDefinition = {
  id: string;
  sourceId: string;
  spaceId: string;
  eventName: string;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type JourneyEventSchemaVersionRecord = {
  id: string;
  schemaId: string;
  sourceId: string;
  spaceId: string;
  version: string;
  state: JourneyEventSchemaVersion['state'];
  properties: JourneyEventPropertyDefinition[];
  compatibility: JourneySchemaCompatibilityResult | { compatible: null; issues: JourneyControlPlaneIssue[] };
  contentSha256: string;
  createdByUserId: string | null;
  publishedByUserId: string | null;
  deprecatedByUserId: string | null;
  createdAt: string;
  publishedAt: string | null;
  deprecatedAt: string | null;
};

export type JourneyEventControlAuditEvent = {
  id: string;
  spaceId: string;
  sourceId: string | null;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetKind: 'source' | 'credential' | 'schema' | 'schema_version';
  targetId: string;
  actor: { id: string; name: string } | null;
  summary: string;
  detail: Record<string, unknown>;
  beforeFingerprint: string | null;
  afterFingerprint: string | null;
  createdAt: string;
};

type SourceRow = {
  id: string; space_id: string; name: string; environment: JourneyEventEnvironment;
  status: JourneyEventSourceStatus; validation_mode: JourneyEventValidationMode;
  allowed_origins_json: string; allowed_bundle_ids_json: string;
  events_per_minute: number | string; bytes_per_minute: number | string;
  revision: number | string; created_by_user_id: string | null; created_at: string; updated_at: string;
  idempotency_key?: string | null; intent_hash?: string | null;
};

type CredentialRow = {
  id: string; source_id: string; space_id: string; environment: JourneyEventEnvironment;
  kind: JourneyEventCredentialKind; scope: 'events:write'; display_prefix: string;
  algorithm: 'scrypt-v1'; salt: string; digest: string; status: 'active' | 'overlap' | 'revoked';
  rotated_from_id: string | null; created_at: string; expires_at: string | null; revoked_at: string | null;
  idempotency_key?: string | null; intent_hash?: string | null;
};

type SchemaRow = {
  id: string; source_id: string; space_id: string; event_name: string;
  created_by_user_id: string | null; created_at: string; updated_at: string;
  idempotency_key?: string | null; intent_hash?: string | null;
};

type SchemaVersionRow = {
  id: string; schema_id: string; source_id: string; space_id: string; version: string;
  version_major: number | string; version_minor: number | string; state: JourneyEventSchemaVersion['state'];
  properties_json: string; compatibility_json: string; content_sha256: string;
  created_by_user_id: string | null; published_by_user_id: string | null; deprecated_by_user_id: string | null;
  created_at: string; published_at: string | null; deprecated_at: string | null;
  idempotency_key?: string | null; intent_hash?: string | null;
};

function parseJson<T>(value: unknown, fallback: T): T {
  try { return JSON.parse(String(value || '')) as T; }
  catch { return fallback; }
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(',')}}`;
}

function sha256(value: unknown) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : stableJson(value)).digest('hex');
}

function nowIso(value?: Date | string) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value || Date.now());
  if (!Number.isFinite(date.getTime())) {
    throw new JourneyEventControlRepositoryError('A valid control-plane timestamp is required.', 400, 'JOURNEY_EVENT_TIME_INVALID');
  }
  return date.toISOString();
}

export function validateJourneyControlIdempotencyKey(value: unknown) {
  const key = String(value ?? '');
  if (!key || key.length > 200 || key.trim() !== key || /[^\x20-\x7e]/u.test(key)) {
    throw new JourneyEventControlRepositoryError(
      'Idempotency-Key must contain between 1 and 200 printable ASCII characters.',
      400,
      'JOURNEY_EVENT_IDEMPOTENCY_KEY_INVALID'
    );
  }
  return key;
}

function sourceFromRow(row: SourceRow): JourneyEventSource {
  const credentialCount = Number((db.prepare('SELECT COUNT(*) count FROM journey_event_credentials WHERE space_id=? AND source_id=?')
    .get(row.space_id, row.id) as { count: number | string }).count);
  const activeSchemaCount = Number((db.prepare(`SELECT COUNT(*) count FROM journey_event_schemas schema
    WHERE schema.space_id=? AND schema.source_id=? AND EXISTS (
      SELECT 1 FROM journey_event_schema_versions version
      WHERE version.space_id=schema.space_id AND version.schema_id=schema.id AND version.state='published'
    )`).get(row.space_id, row.id) as { count: number | string }).count);
  return {
    id: row.id,
    spaceId: row.space_id,
    name: row.name,
    environment: row.environment,
    status: row.status,
    validationMode: row.validation_mode,
    allowedOrigins: parseJson<string[]>(row.allowed_origins_json, []),
    allowedBundleIds: parseJson<string[]>(row.allowed_bundle_ids_json, []),
    eventsPerMinute: Number(row.events_per_minute),
    bytesPerMinute: Number(row.bytes_per_minute),
    credentialCount,
    activeSchemaCount,
    revision: Number(row.revision),
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function sourcePolicy(source: JourneyEventSource): JourneyEventSourcePolicy {
  return {
    sourceId: source.id,
    spaceId: source.spaceId,
    environment: source.environment,
    status: source.status,
    validationMode: source.validationMode,
    allowedOrigins: source.allowedOrigins,
    allowedBundleIds: source.allowedBundleIds,
    eventsPerMinute: source.eventsPerMinute,
    bytesPerMinute: source.bytesPerMinute
  };
}

function credentialRecordFromRow(row: CredentialRow): JourneyEventCredentialRecord {
  return {
    id: row.id,
    sourceId: row.source_id,
    spaceId: row.space_id,
    environment: row.environment,
    kind: row.kind,
    scope: row.scope,
    displayPrefix: row.display_prefix,
    algorithm: row.algorithm,
    salt: row.salt,
    digest: row.digest,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at
  };
}

function credentialFromRow(row: CredentialRow): JourneyEventCredential {
  return {
    id: row.id,
    sourceId: row.source_id,
    environment: row.environment,
    kind: row.kind,
    scope: row.scope,
    displayPrefix: row.display_prefix,
    status: row.status,
    rotatedFromId: row.rotated_from_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at
  };
}

function schemaFromRow(row: SchemaRow): JourneyEventSchemaDefinition {
  return {
    id: row.id,
    sourceId: row.source_id,
    spaceId: row.space_id,
    eventName: row.event_name,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function schemaVersionFromRow(row: SchemaVersionRow): JourneyEventSchemaVersionRecord {
  return {
    id: row.id,
    schemaId: row.schema_id,
    sourceId: row.source_id,
    spaceId: row.space_id,
    version: row.version,
    state: row.state,
    properties: parseJson<JourneyEventPropertyDefinition[]>(row.properties_json, []),
    compatibility: parseJson(row.compatibility_json, { compatible: null, issues: [] }),
    contentSha256: row.content_sha256,
    createdByUserId: row.created_by_user_id,
    publishedByUserId: row.published_by_user_id,
    deprecatedByUserId: row.deprecated_by_user_id,
    createdAt: row.created_at,
    publishedAt: row.published_at,
    deprecatedAt: row.deprecated_at
  };
}

function sourceSelect() {
  return `SELECT id,space_id,name,environment,status,validation_mode,allowed_origins_json,allowed_bundle_ids_json,
    events_per_minute,bytes_per_minute,revision,created_by_user_id,created_at,updated_at,idempotency_key,intent_hash
    FROM journey_event_sources`;
}

function credentialSelect() {
  return `SELECT id,source_id,space_id,environment,kind,scope,display_prefix,algorithm,salt,digest,status,
    rotated_from_id,created_at,expires_at,revoked_at,idempotency_key,intent_hash FROM journey_event_credentials`;
}

function schemaSelect() {
  return `SELECT id,source_id,space_id,event_name,created_by_user_id,created_at,updated_at,idempotency_key,intent_hash
    FROM journey_event_schemas`;
}

function versionSelect() {
  return `SELECT id,schema_id,source_id,space_id,version,version_major,version_minor,state,properties_json,
    compatibility_json,content_sha256,created_by_user_id,published_by_user_id,deprecated_by_user_id,
    created_at,published_at,deprecated_at,idempotency_key,intent_hash FROM journey_event_schema_versions`;
}

function requireSource(spaceId: string, sourceId: string) {
  const row = db.prepare(`${sourceSelect()} WHERE id=? AND space_id=?`).get(sourceId, spaceId) as SourceRow | undefined;
  if (!row) {
    throw new JourneyEventControlRepositoryError('Event source not found.', 404, 'JOURNEY_EVENT_SOURCE_NOT_FOUND');
  }
  return sourceFromRow(row);
}

function requireCredential(spaceId: string, credentialId: string) {
  const row = db.prepare(`${credentialSelect()} WHERE id=? AND space_id=?`).get(credentialId, spaceId) as CredentialRow | undefined;
  if (!row) {
    throw new JourneyEventControlRepositoryError('Event credential not found.', 404, 'JOURNEY_EVENT_CREDENTIAL_NOT_FOUND');
  }
  return row;
}

function requireSchema(spaceId: string, schemaId: string) {
  const row = db.prepare(`${schemaSelect()} WHERE id=? AND space_id=?`).get(schemaId, spaceId) as SchemaRow | undefined;
  if (!row) {
    throw new JourneyEventControlRepositoryError('Event schema not found.', 404, 'JOURNEY_EVENT_SCHEMA_NOT_FOUND');
  }
  return row;
}

function requireVersion(spaceId: string, versionId: string) {
  const row = db.prepare(`${versionSelect()} WHERE id=? AND space_id=?`).get(versionId, spaceId) as SchemaVersionRow | undefined;
  if (!row) {
    throw new JourneyEventControlRepositoryError('Event schema version not found.', 404, 'JOURNEY_EVENT_SCHEMA_VERSION_NOT_FOUND');
  }
  return row;
}

function lockSpace(spaceId: string) {
  const row = db.provider === 'postgres'
    ? db.prepare('SELECT id FROM spaces WHERE id=? FOR UPDATE').get(spaceId)
    : (() => {
      const selected = db.prepare('SELECT id FROM spaces WHERE id=?').get(spaceId);
      if (selected) db.prepare('UPDATE spaces SET updated_at=updated_at WHERE id=?').run(spaceId);
      return selected;
    })();
  if (!row) throw new JourneyEventControlRepositoryError('Space not found.', 404, 'SPACE_NOT_FOUND');
}

function assertConnectedFeature(spaceId: string) {
  return assertSubscriptionFeature(spaceId, 'journeyConnected');
}

function assertResourceQuota(spaceId: string, quota: SubscriptionQuota, table: string, predicate = '') {
  const suffix = predicate ? ` AND ${predicate}` : '';
  const row = db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE space_id=?${suffix}`).get(spaceId) as { count: number | string };
  return assertSubscriptionQuota(spaceId, quota, Number(row.count), 1);
}

function idempotencyConflict() {
  throw new JourneyEventControlRepositoryError(
    'This idempotency key was already used for a different control-plane intent.',
    409,
    'JOURNEY_EVENT_IDEMPOTENCY_CONFLICT'
  );
}

function verifyReplay(row: { intent_hash?: string | null }, expectedHash: string) {
  if (!row.intent_hash || row.intent_hash !== expectedHash) idempotencyConflict();
}

function publicFingerprint(value: unknown) {
  return sha256(value);
}

function appendAudit(input: {
  spaceId: string;
  sourceId: string | null;
  actorUserId: string | null;
  action: string;
  targetType: 'source' | 'credential' | 'schema' | 'schema_version';
  targetId: string;
  detail?: Record<string, unknown>;
  before?: unknown;
  after?: unknown;
  at: string;
}) {
  const detail = input.detail || {};
  const detailJson = stableJson(detail);
  if (Buffer.byteLength(detailJson, 'utf8') > 16_384) {
    throw new JourneyEventControlRepositoryError('Audit detail exceeds the control-plane limit.', 400, 'JOURNEY_EVENT_AUDIT_DETAIL_TOO_LARGE');
  }
  db.prepare(`INSERT INTO journey_event_control_audit_events
    (id,space_id,source_id,actor_user_id,action,target_type,target_id,detail_json,before_fingerprint,after_fingerprint,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      crypto.randomUUID(), input.spaceId, input.sourceId, input.actorUserId, input.action, input.targetType,
      input.targetId, detailJson, input.before === undefined ? null : publicFingerprint(input.before),
      input.after === undefined ? null : publicFingerprint(input.after), input.at
    );
}

function translateConstraint(error: unknown, message: string, code: string): never {
  if (isDatabaseConstraintError(error)) {
    throw new JourneyEventControlRepositoryError(message, 409, code);
  }
  throw error;
}

function cleanSourceName(value: string) {
  const name = String(value || '').trim().replace(/\s+/gu, ' ');
  if (!name || name.length > 160) {
    throw new JourneyEventControlRepositoryError('Source name must contain between 1 and 160 characters.', 400, 'JOURNEY_EVENT_SOURCE_NAME_INVALID');
  }
  return name;
}

function ensureMutableSource(source: JourneyEventSource) {
  if (source.status === 'revoked') {
    throw new JourneyEventControlRepositoryError(
      'A revoked event source is terminal and cannot be changed.', 409, 'JOURNEY_EVENT_SOURCE_REVOKED'
    );
  }
}

export function listJourneyEventSources(spaceId: string, environment?: JourneyEventEnvironment) {
  assertConnectedFeature(spaceId);
  const rows = environment
    ? db.prepare(`${sourceSelect()} WHERE space_id=? AND environment=? ORDER BY updated_at DESC,id`).all(spaceId, environment)
    : db.prepare(`${sourceSelect()} WHERE space_id=? ORDER BY updated_at DESC,id`).all(spaceId);
  return (rows as SourceRow[]).map(sourceFromRow);
}

export function journeyEventSourceQuota(spaceId: string) {
  assertConnectedFeature(spaceId);
  const used = Number((db.prepare("SELECT COUNT(*) count FROM journey_event_sources WHERE space_id=? AND status!='revoked'")
    .get(spaceId) as { count: number | string }).count);
  const limit = Number(effectiveSubscriptionForSpace(spaceId).plan.limits.eventSources);
  return { used, limit, remaining: Math.max(0, limit - used) };
}

export function getJourneyEventSource(spaceId: string, sourceId: string) {
  assertConnectedFeature(spaceId);
  return requireSource(spaceId, sourceId);
}

export function createJourneyEventSource(input: {
  spaceId: string;
  actorUserId: string;
  idempotencyKey: string;
  name: string;
  environment: JourneyEventEnvironment;
  validationMode?: JourneyEventValidationMode;
  allowedOrigins?: string[];
  allowedBundleIds?: string[];
  eventsPerMinute?: number;
  bytesPerMinute?: number;
  now?: Date | string;
}) {
  const idempotencyKey = validateJourneyControlIdempotencyKey(input.idempotencyKey);
  const at = nowIso(input.now);
  const id = crypto.randomUUID();
  const normalized = validateJourneyEventSourcePolicy({
    sourceId: id,
    spaceId: input.spaceId,
    environment: input.environment,
    status: 'active',
    validationMode: input.validationMode || 'warn',
    allowedOrigins: input.allowedOrigins || [],
    allowedBundleIds: input.allowedBundleIds || [],
    eventsPerMinute: input.eventsPerMinute ?? 10_000,
    bytesPerMinute: input.bytesPerMinute ?? 10_000_000
  });
  const name = cleanSourceName(input.name);
  const intentHash = sha256({
    operation: 'source.create', name, environment: normalized.environment,
    validationMode: normalized.validationMode, allowedOrigins: normalized.allowedOrigins,
    allowedBundleIds: normalized.allowedBundleIds, eventsPerMinute: normalized.eventsPerMinute,
    bytesPerMinute: normalized.bytesPerMinute
  });

  try {
    return db.transaction(() => {
      lockSpace(input.spaceId);
      assertConnectedFeature(input.spaceId);
      const replay = db.prepare(`${sourceSelect()} WHERE space_id=? AND idempotency_key=?`)
        .get(input.spaceId, idempotencyKey) as SourceRow | undefined;
      if (replay) {
        verifyReplay(replay, intentHash);
        return { source: sourceFromRow(replay), replayed: true };
      }
      assertResourceQuota(input.spaceId, 'eventSources', 'journey_event_sources', "status!='revoked'");
      db.prepare(`INSERT INTO journey_event_sources
        (id,space_id,name,environment,status,validation_mode,allowed_origins_json,allowed_bundle_ids_json,
          events_per_minute,bytes_per_minute,idempotency_key,intent_hash,created_by_user_id,revision,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`).run(
          id, input.spaceId, name, normalized.environment, 'active', normalized.validationMode,
          JSON.stringify(normalized.allowedOrigins), JSON.stringify(normalized.allowedBundleIds),
          normalized.eventsPerMinute, normalized.bytesPerMinute, idempotencyKey, intentHash, input.actorUserId, at, at
        );
      const source = requireSource(input.spaceId, id);
      appendAudit({
        spaceId: input.spaceId, sourceId: id, actorUserId: input.actorUserId, action: 'source.created',
        targetType: 'source', targetId: id, detail: { environment: source.environment }, after: source, at
      });
      return { source, replayed: false };
    })();
  } catch (error) {
    return translateConstraint(error, 'A source with this name already exists in that environment.', 'JOURNEY_EVENT_SOURCE_CONFLICT');
  }
}

export function updateJourneyEventSource(input: {
  spaceId: string;
  actorUserId: string;
  sourceId: string;
  expectedRevision: number;
  name?: string;
  status?: JourneyEventSourceStatus;
  validationMode?: JourneyEventValidationMode;
  allowedOrigins?: string[];
  allowedBundleIds?: string[];
  eventsPerMinute?: number;
  bytesPerMinute?: number;
  now?: Date | string;
}) {
  const at = nowIso(input.now);
  try {
    return db.transaction(() => {
      lockSpace(input.spaceId);
      assertConnectedFeature(input.spaceId);
      const current = requireSource(input.spaceId, input.sourceId);
      ensureMutableSource(current);
      if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) {
        throw new JourneyEventControlRepositoryError('A valid expected revision is required.', 400, 'JOURNEY_EVENT_REVISION_INVALID');
      }
      if (current.revision !== input.expectedRevision) {
        throw new JourneyEventControlRepositoryError(
          'The event source changed before this update.', 409, 'JOURNEY_EVENT_SOURCE_REVISION_CONFLICT',
          { expectedRevision: input.expectedRevision, actualRevision: current.revision }
        );
      }
      const nextPolicy = validateJourneyEventSourcePolicy({
        ...sourcePolicy(current),
        status: input.status ?? current.status,
        validationMode: input.validationMode ?? current.validationMode,
        allowedOrigins: input.allowedOrigins ?? current.allowedOrigins,
        allowedBundleIds: input.allowedBundleIds ?? current.allowedBundleIds,
        eventsPerMinute: input.eventsPerMinute ?? current.eventsPerMinute,
        bytesPerMinute: input.bytesPerMinute ?? current.bytesPerMinute
      });
      const name = input.name === undefined ? current.name : cleanSourceName(input.name);
      const result = db.prepare(`UPDATE journey_event_sources SET
        name=?,status=?,validation_mode=?,allowed_origins_json=?,allowed_bundle_ids_json=?,events_per_minute=?,
        bytes_per_minute=?,revision=revision+1,updated_at=? WHERE id=? AND space_id=? AND revision=?`).run(
          name, nextPolicy.status, nextPolicy.validationMode, JSON.stringify(nextPolicy.allowedOrigins),
          JSON.stringify(nextPolicy.allowedBundleIds), nextPolicy.eventsPerMinute, nextPolicy.bytesPerMinute, at,
          input.sourceId, input.spaceId, input.expectedRevision
        );
      if (result.changes !== 1) {
        throw new JourneyEventControlRepositoryError('The event source changed before this update.', 409, 'JOURNEY_EVENT_SOURCE_REVISION_CONFLICT');
      }
      const source = requireSource(input.spaceId, input.sourceId);
      appendAudit({
        spaceId: input.spaceId, sourceId: input.sourceId, actorUserId: input.actorUserId,
        action: 'source.updated', targetType: 'source', targetId: input.sourceId,
        detail: { revision: source.revision }, before: current, after: source, at
      });
      return source;
    })();
  } catch (error) {
    return translateConstraint(error, 'A source with this name already exists in that environment.', 'JOURNEY_EVENT_SOURCE_CONFLICT');
  }
}

export function listJourneyEventCredentials(spaceId: string, sourceId: string) {
  assertConnectedFeature(spaceId);
  requireSource(spaceId, sourceId);
  return (db.prepare(`${credentialSelect()} WHERE space_id=? AND source_id=? ORDER BY created_at DESC,id`)
    .all(spaceId, sourceId) as CredentialRow[]).map(credentialFromRow);
}

function insertCredential(row: JourneyEventCredentialRecord, input: {
  rotatedFromId?: string | null;
  idempotencyKey: string;
  intentHash: string;
  actorUserId: string;
}) {
  db.prepare(`INSERT INTO journey_event_credentials
    (id,source_id,space_id,environment,kind,scope,display_prefix,algorithm,salt,digest,status,rotated_from_id,
      idempotency_key,intent_hash,created_by_user_id,created_at,expires_at,revoked_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      row.id, row.sourceId, row.spaceId, row.environment, row.kind, row.scope, row.displayPrefix, row.algorithm,
      row.salt, row.digest, row.status, input.rotatedFromId || null, input.idempotencyKey, input.intentHash,
      input.actorUserId, row.createdAt, row.expiresAt, row.revokedAt
    );
}

export function issueStoredJourneyEventCredential(input: {
  spaceId: string;
  actorUserId: string;
  sourceId: string;
  kind: JourneyEventCredentialKind;
  idempotencyKey: string;
  now?: Date | string;
}) {
  const idempotencyKey = validateJourneyControlIdempotencyKey(input.idempotencyKey);
  const at = nowIso(input.now);
  const intentHash = sha256({ operation: 'credential.issue', sourceId: input.sourceId, kind: input.kind });
  try {
    return db.transaction(() => {
      lockSpace(input.spaceId);
      assertConnectedFeature(input.spaceId);
      const replay = db.prepare(`${credentialSelect()} WHERE space_id=? AND idempotency_key=?`)
        .get(input.spaceId, idempotencyKey) as CredentialRow | undefined;
      if (replay) {
        verifyReplay(replay, intentHash);
        return { credential: credentialFromRow(replay), replayed: true };
      }
      const source = requireSource(input.spaceId, input.sourceId);
      ensureMutableSource(source);
      if (source.status !== 'active') {
        throw new JourneyEventControlRepositoryError(
          'Credentials can only be issued while the source is active.', 409, 'JOURNEY_EVENT_SOURCE_INACTIVE'
        );
      }
      const active = db.prepare(`${credentialSelect()} WHERE space_id=? AND source_id=? AND kind=? AND status='active'`)
        .get(input.spaceId, input.sourceId, input.kind) as CredentialRow | undefined;
      if (active) {
        throw new JourneyEventControlRepositoryError(
          'This source already has an active credential of that kind. Rotate it instead.',
          409,
          'JOURNEY_EVENT_CREDENTIAL_ACTIVE'
        );
      }
      const issued = issueJourneyEventCredential({ source: sourcePolicy(source), kind: input.kind, now: at });
      insertCredential(issued.record, { idempotencyKey, intentHash, actorUserId: input.actorUserId });
      const stored = requireCredential(input.spaceId, issued.record.id);
      const credential = credentialFromRow(stored);
      appendAudit({
        spaceId: input.spaceId, sourceId: source.id, actorUserId: input.actorUserId,
        action: 'credential.issued', targetType: 'credential', targetId: credential.id,
        detail: { kind: credential.kind, displayPrefix: credential.displayPrefix }, after: credential, at
      });
      return { credential, secret: issued.secret, replayed: false };
    })();
  } catch (error) {
    return translateConstraint(error, 'The credential conflicts with current source state.', 'JOURNEY_EVENT_CREDENTIAL_CONFLICT');
  }
}

export function rotateStoredJourneyEventCredential(input: {
  spaceId: string;
  actorUserId: string;
  credentialId: string;
  overlapSeconds: number;
  idempotencyKey: string;
  now?: Date | string;
}) {
  const idempotencyKey = validateJourneyControlIdempotencyKey(input.idempotencyKey);
  const at = nowIso(input.now);
  const intentHash = sha256({
    operation: 'credential.rotate', credentialId: input.credentialId, overlapSeconds: input.overlapSeconds
  });
  try {
    return db.transaction(() => {
      lockSpace(input.spaceId);
      assertConnectedFeature(input.spaceId);
      const replay = db.prepare(`${credentialSelect()} WHERE space_id=? AND idempotency_key=?`)
        .get(input.spaceId, idempotencyKey) as CredentialRow | undefined;
      if (replay) {
        verifyReplay(replay, intentHash);
        return { credential: credentialFromRow(replay), replayed: true };
      }
      const currentRow = requireCredential(input.spaceId, input.credentialId);
      const source = requireSource(input.spaceId, currentRow.source_id);
      ensureMutableSource(source);
      if (source.status !== 'active') {
        throw new JourneyEventControlRepositoryError(
          'Credentials can only be rotated while the source is active.', 409, 'JOURNEY_EVENT_SOURCE_INACTIVE'
        );
      }
      const rotated = rotateJourneyEventCredential({
        current: credentialRecordFromRow(currentRow), source: sourcePolicy(source), now: at,
        overlapSeconds: input.overlapSeconds
      });
      db.prepare(`UPDATE journey_event_credentials SET status=?,expires_at=?,revoked_at=?
        WHERE id=? AND space_id=? AND status='active'`).run(
          rotated.previous.status, rotated.previous.expiresAt, rotated.previous.revokedAt,
          currentRow.id, input.spaceId
        );
      insertCredential(rotated.issued.record, {
        rotatedFromId: currentRow.id, idempotencyKey, intentHash, actorUserId: input.actorUserId
      });
      const stored = requireCredential(input.spaceId, rotated.issued.record.id);
      const credential = credentialFromRow(stored);
      appendAudit({
        spaceId: input.spaceId, sourceId: source.id, actorUserId: input.actorUserId,
        action: 'credential.rotated', targetType: 'credential', targetId: credential.id,
        detail: {
          kind: credential.kind, rotatedFromId: currentRow.id, overlapSeconds: input.overlapSeconds,
          displayPrefix: credential.displayPrefix
        }, before: credentialFromRow(currentRow), after: credential, at
      });
      return { credential, secret: rotated.issued.secret, replayed: false };
    })();
  } catch (error) {
    return translateConstraint(error, 'The credential rotation conflicts with current source state.', 'JOURNEY_EVENT_CREDENTIAL_CONFLICT');
  }
}

export function revokeStoredJourneyEventCredential(input: {
  spaceId: string;
  actorUserId: string;
  credentialId: string;
  now?: Date | string;
}) {
  const at = nowIso(input.now);
  return db.transaction(() => {
    lockSpace(input.spaceId);
    assertConnectedFeature(input.spaceId);
    const row = requireCredential(input.spaceId, input.credentialId);
    if (row.status === 'revoked') return { credential: credentialFromRow(row), replayed: true };
    const revoked = revokeJourneyEventCredential(credentialRecordFromRow(row), at);
    db.prepare(`UPDATE journey_event_credentials SET status='revoked',expires_at=?,revoked_at=?
      WHERE id=? AND space_id=? AND status!='revoked'`).run(at, at, row.id, input.spaceId);
    const stored = requireCredential(input.spaceId, row.id);
    const credential = credentialFromRow(stored);
    appendAudit({
      spaceId: input.spaceId, sourceId: row.source_id, actorUserId: input.actorUserId,
      action: 'credential.revoked', targetType: 'credential', targetId: credential.id,
      detail: { kind: credential.kind, displayPrefix: credential.displayPrefix },
      before: credentialFromRow(row), after: { ...credential, status: revoked.status }, at
    });
    return { credential, replayed: false };
  })();
}

/** Internal data-plane boundary. It returns an ingest principal, never the
 * persisted digest/salt record, so callers cannot turn verification access
 * into credential recovery or control-plane authentication. */
export function verifyStoredJourneyEventCredential(candidate: string, now?: Date | string) {
  const at = nowIso(now);
  if (typeof candidate !== 'string' || candidate.length > 512) return null;
  const segments = candidate.split('.');
  if (segments.length !== 3) return null;
  const displayPrefix = `${segments[0]}.${segments[1]}`;
  const row = db.prepare(`${credentialSelect()} WHERE display_prefix=?`).get(displayPrefix) as CredentialRow | undefined;
  if (!row) return null;
  const sourceRow = db.prepare(`${sourceSelect()} WHERE id=? AND space_id=?`).get(row.source_id, row.space_id) as SourceRow | undefined;
  if (!sourceRow) return null;
  const source = sourceFromRow(sourceRow);
  if (!verifyJourneyEventCredential({
    record: credentialRecordFromRow(row), candidate, now: at, source: sourcePolicy(source)
  })) return null;
  return {
    credentialId: row.id,
    sourceId: source.id,
    spaceId: source.spaceId,
    environment: source.environment,
    kind: row.kind,
    scope: row.scope
  };
}

function validateEventName(schemaId: string, eventName: string) {
  const issues = validateJourneyEventSchema({
    schemaId, eventName, version: '0.0', state: 'draft', properties: []
  });
  const errors = issues.filter((issue) => issue.severity === 'error');
  if (errors.length) {
    throw new JourneyEventControlRepositoryError(
      'The tracking-plan event name is invalid.', 400, 'JOURNEY_EVENT_SCHEMA_INVALID', { issues }
    );
  }
}

export function listJourneyEventSchemas(spaceId: string, sourceId: string) {
  assertConnectedFeature(spaceId);
  requireSource(spaceId, sourceId);
  const schemas = (db.prepare(`${schemaSelect()} WHERE space_id=? AND source_id=? ORDER BY event_name,id`)
    .all(spaceId, sourceId) as SchemaRow[]).map(schemaFromRow);
  return schemas.map((schema) => {
    const versions = (db.prepare(`${versionSelect()} WHERE space_id=? AND schema_id=?
      ORDER BY version_major DESC,version_minor DESC,id`).all(spaceId, schema.id) as SchemaVersionRow[])
      .map(schemaVersionFromRow);
    return { ...schema, versions };
  });
}

export function getJourneyEventSchema(spaceId: string, schemaId: string) {
  assertConnectedFeature(spaceId);
  const schema = schemaFromRow(requireSchema(spaceId, schemaId));
  const versions = (db.prepare(`${versionSelect()} WHERE space_id=? AND schema_id=?
    ORDER BY version_major DESC,version_minor DESC,id`).all(spaceId, schemaId) as SchemaVersionRow[])
    .map(schemaVersionFromRow);
  return { ...schema, versions };
}

export function createJourneyEventSchema(input: {
  spaceId: string;
  actorUserId: string;
  sourceId: string;
  eventName: string;
  idempotencyKey: string;
  now?: Date | string;
}) {
  const idempotencyKey = validateJourneyControlIdempotencyKey(input.idempotencyKey);
  const at = nowIso(input.now);
  const id = crypto.randomUUID();
  validateEventName(id, input.eventName);
  const intentHash = sha256({ operation: 'schema.create', sourceId: input.sourceId, eventName: input.eventName });
  try {
    return db.transaction(() => {
      lockSpace(input.spaceId);
      assertConnectedFeature(input.spaceId);
      const replay = db.prepare(`${schemaSelect()} WHERE space_id=? AND idempotency_key=?`)
        .get(input.spaceId, idempotencyKey) as SchemaRow | undefined;
      if (replay) {
        verifyReplay(replay, intentHash);
        return { schema: schemaFromRow(replay), replayed: true };
      }
      const source = requireSource(input.spaceId, input.sourceId);
      ensureMutableSource(source);
      assertResourceQuota(input.spaceId, 'schemaDefinitions', 'journey_event_schemas');
      db.prepare(`INSERT INTO journey_event_schemas
        (id,source_id,space_id,event_name,idempotency_key,intent_hash,created_by_user_id,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(
          id, input.sourceId, input.spaceId, input.eventName, idempotencyKey, intentHash, input.actorUserId, at, at
        );
      const schema = schemaFromRow(requireSchema(input.spaceId, id));
      appendAudit({
        spaceId: input.spaceId, sourceId: input.sourceId, actorUserId: input.actorUserId,
        action: 'schema.created', targetType: 'schema', targetId: id,
        detail: { eventName: input.eventName }, after: schema, at
      });
      return { schema, replayed: false };
    })();
  } catch (error) {
    return translateConstraint(error, 'That event name already exists for this source.', 'JOURNEY_EVENT_SCHEMA_CONFLICT');
  }
}

function numericVersion(value: string) {
  const match = /^(\d+)\.(\d+)$/u.exec(value);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return Number.isSafeInteger(major) && Number.isSafeInteger(minor) ? { major, minor } : null;
}

function schemaForComparison(definition: JourneyEventSchemaDefinition, version: JourneyEventSchemaVersionRecord): JourneyEventSchemaVersion {
  return {
    schemaId: definition.id,
    eventName: definition.eventName,
    version: version.version,
    state: version.state,
    properties: version.properties
  };
}

export function createJourneyEventSchemaVersion(input: {
  spaceId: string;
  actorUserId: string;
  schemaId: string;
  version: string;
  properties: JourneyEventPropertyDefinition[];
  idempotencyKey: string;
  now?: Date | string;
}) {
  const idempotencyKey = validateJourneyControlIdempotencyKey(input.idempotencyKey);
  const at = nowIso(input.now);
  const parsedVersion = numericVersion(input.version);
  if (!parsedVersion) {
    throw new JourneyEventControlRepositoryError('Schema version must use major.minor format.', 400, 'JOURNEY_EVENT_SCHEMA_VERSION_INVALID');
  }
  const intentHash = sha256({
    operation: 'schema.version_create', schemaId: input.schemaId, version: input.version, properties: input.properties
  });
  try {
    return db.transaction(() => {
      lockSpace(input.spaceId);
      assertConnectedFeature(input.spaceId);
      const replay = db.prepare(`${versionSelect()} WHERE space_id=? AND idempotency_key=?`)
        .get(input.spaceId, idempotencyKey) as SchemaVersionRow | undefined;
      if (replay) {
        verifyReplay(replay, intentHash);
        return { version: schemaVersionFromRow(replay), replayed: true };
      }
      const definitionRow = requireSchema(input.spaceId, input.schemaId);
      const definition = schemaFromRow(definitionRow);
      const source = requireSource(input.spaceId, definition.sourceId);
      ensureMutableSource(source);
      const candidate: JourneyEventSchemaVersion = {
        schemaId: definition.id,
        eventName: definition.eventName,
        version: input.version,
        state: 'draft',
        properties: input.properties
      };
      const issues = validateJourneyEventSchema(candidate);
      if (issues.some((issue) => issue.severity === 'error')) {
        throw new JourneyEventControlRepositoryError(
          'The tracking-plan version is invalid.', 400, 'JOURNEY_EVENT_SCHEMA_INVALID', { issues }
        );
      }
      const latest = db.prepare(`${versionSelect()} WHERE space_id=? AND schema_id=?
        ORDER BY version_major DESC,version_minor DESC,id DESC LIMIT 1`).get(input.spaceId, input.schemaId) as SchemaVersionRow | undefined;
      if (latest && (parsedVersion.major < Number(latest.version_major)
        || (parsedVersion.major === Number(latest.version_major) && parsedVersion.minor <= Number(latest.version_minor)))) {
        throw new JourneyEventControlRepositoryError(
          'A new schema version must be greater than every existing version.',
          409,
          'JOURNEY_EVENT_SCHEMA_VERSION_NOT_INCREMENTED',
          { latestVersion: latest.version }
        );
      }
      const id = crypto.randomUUID();
      const propertiesJson = stableJson(input.properties);
      const contentSha256 = sha256({
        schemaId: definition.id, eventName: definition.eventName, version: input.version, properties: input.properties
      });
      db.prepare(`INSERT INTO journey_event_schema_versions
        (id,schema_id,source_id,space_id,version,version_major,version_minor,state,properties_json,compatibility_json,
          content_sha256,idempotency_key,intent_hash,created_by_user_id,created_at)
        VALUES (?,?,?,?,?,?,?,'draft',?,?,?,?,?,?,?)`).run(
          id, input.schemaId, definition.sourceId, input.spaceId, input.version, parsedVersion.major, parsedVersion.minor,
          propertiesJson, stableJson({ compatible: null, issues: [] }), contentSha256,
          idempotencyKey, intentHash, input.actorUserId, at
        );
      db.prepare('UPDATE journey_event_schemas SET updated_at=? WHERE id=? AND space_id=?').run(at, input.schemaId, input.spaceId);
      const version = schemaVersionFromRow(requireVersion(input.spaceId, id));
      appendAudit({
        spaceId: input.spaceId, sourceId: definition.sourceId, actorUserId: input.actorUserId,
        action: 'schema.version_created', targetType: 'schema_version', targetId: id,
        detail: { schemaId: definition.id, eventName: definition.eventName, version: input.version },
        after: version, at
      });
      return { version, replayed: false };
    })();
  } catch (error) {
    return translateConstraint(error, 'That schema version already exists.', 'JOURNEY_EVENT_SCHEMA_VERSION_CONFLICT');
  }
}

export function publishJourneyEventSchemaVersion(input: {
  spaceId: string;
  actorUserId: string;
  versionId: string;
  now?: Date | string;
}) {
  const at = nowIso(input.now);
  return db.transaction(() => {
    lockSpace(input.spaceId);
    assertConnectedFeature(input.spaceId);
    const targetRow = requireVersion(input.spaceId, input.versionId);
    const target = schemaVersionFromRow(targetRow);
    if (target.state === 'published') return { version: target, replayed: true };
    if (target.state !== 'draft') {
      throw new JourneyEventControlRepositoryError(
        'Only a draft tracking-plan version can be published.', 409, 'JOURNEY_EVENT_SCHEMA_STATE_CONFLICT'
      );
    }
    const definition = schemaFromRow(requireSchema(input.spaceId, target.schemaId));
    const source = requireSource(input.spaceId, definition.sourceId);
    ensureMutableSource(source);
    const previousRow = db.prepare(`${versionSelect()} WHERE space_id=? AND schema_id=? AND state='published' AND id!=?`)
      .get(input.spaceId, target.schemaId, target.id) as SchemaVersionRow | undefined;
    const historicalRow = previousRow || db.prepare(`${versionSelect()} WHERE space_id=? AND schema_id=?
      AND state IN ('published','deprecated') AND id!=?
      ORDER BY version_major DESC,version_minor DESC,id DESC LIMIT 1`)
      .get(input.spaceId, target.schemaId, target.id) as SchemaVersionRow | undefined;
    const targetSchema = schemaForComparison(definition, target);
    const compatibility: JourneySchemaCompatibilityResult = historicalRow
      ? compareJourneyEventSchemas(
        schemaForComparison(definition, schemaVersionFromRow(historicalRow)), targetSchema
      )
      : { compatible: !validateJourneyEventSchema(targetSchema).some((issue) => issue.severity === 'error'), issues: validateJourneyEventSchema(targetSchema) };
    if (!compatibility.compatible) {
      throw new JourneyEventControlRepositoryError(
        'The draft is not compatible with the current published tracking plan.',
        409,
        'JOURNEY_EVENT_SCHEMA_INCOMPATIBLE',
        { issues: compatibility.issues, previousVersion: historicalRow?.version || null }
      );
    }
    if (previousRow) {
      const previous = schemaVersionFromRow(previousRow);
      db.prepare(`UPDATE journey_event_schema_versions SET state='deprecated',deprecated_by_user_id=?,deprecated_at=?
        WHERE id=? AND space_id=? AND state='published'`).run(input.actorUserId, at, previous.id, input.spaceId);
      appendAudit({
        spaceId: input.spaceId, sourceId: definition.sourceId, actorUserId: input.actorUserId,
        action: 'schema.deprecated', targetType: 'schema_version', targetId: previous.id,
        detail: { schemaId: definition.id, version: previous.version, replacedByVersionId: target.id },
        before: previous, after: { ...previous, state: 'deprecated', deprecatedAt: at }, at
      });
    }
    db.prepare(`UPDATE journey_event_schema_versions SET state='published',compatibility_json=?,published_by_user_id=?,published_at=?
      WHERE id=? AND space_id=? AND state='draft'`).run(
        stableJson(compatibility), input.actorUserId, at, target.id, input.spaceId
      );
    db.prepare('UPDATE journey_event_schemas SET updated_at=? WHERE id=? AND space_id=?').run(at, definition.id, input.spaceId);
    const published = schemaVersionFromRow(requireVersion(input.spaceId, target.id));
    appendAudit({
      spaceId: input.spaceId, sourceId: definition.sourceId, actorUserId: input.actorUserId,
      action: 'schema.published', targetType: 'schema_version', targetId: target.id,
      detail: {
        schemaId: definition.id, eventName: definition.eventName, version: target.version,
        previousVersionId: previousRow?.id || null
      }, before: target, after: published, at
    });
    return { version: published, replayed: false };
  })();
}

export function deprecateJourneyEventSchemaVersion(input: {
  spaceId: string;
  actorUserId: string;
  versionId: string;
  now?: Date | string;
}) {
  const at = nowIso(input.now);
  return db.transaction(() => {
    lockSpace(input.spaceId);
    assertConnectedFeature(input.spaceId);
    const row = requireVersion(input.spaceId, input.versionId);
    const current = schemaVersionFromRow(row);
    if (current.state === 'deprecated') return { version: current, replayed: true };
    if (current.state !== 'published') {
      throw new JourneyEventControlRepositoryError(
        'Only the published tracking-plan version can be deprecated.', 409, 'JOURNEY_EVENT_SCHEMA_STATE_CONFLICT'
      );
    }
    const definition = schemaFromRow(requireSchema(input.spaceId, current.schemaId));
    db.prepare(`UPDATE journey_event_schema_versions SET state='deprecated',deprecated_by_user_id=?,deprecated_at=?
      WHERE id=? AND space_id=? AND state='published'`).run(input.actorUserId, at, current.id, input.spaceId);
    db.prepare('UPDATE journey_event_schemas SET updated_at=? WHERE id=? AND space_id=?').run(at, definition.id, input.spaceId);
    const deprecated = schemaVersionFromRow(requireVersion(input.spaceId, current.id));
    appendAudit({
      spaceId: input.spaceId, sourceId: definition.sourceId, actorUserId: input.actorUserId,
      action: 'schema.deprecated', targetType: 'schema_version', targetId: current.id,
      detail: { schemaId: definition.id, eventName: definition.eventName, version: current.version },
      before: current, after: deprecated, at
    });
    return { version: deprecated, replayed: false };
  })();
}

function auditSummary(action: string, detail: Record<string, unknown>) {
  const eventName = String(detail.eventName || '').slice(0, 128);
  const version = String(detail.version || '').slice(0, 41);
  const prefix = String(detail.displayPrefix || '').slice(0, 160);
  const kind = detail.kind === 'server_secret' ? 'Server credential' : 'Public write credential';
  switch (action) {
    case 'source.created': return `Created the ${String(detail.environment || 'configured')} event source.`;
    case 'source.updated': return `Updated source policy revision ${Number(detail.revision || 0)}.`;
    case 'credential.issued': return `${kind} ${prefix} was issued.`;
    case 'credential.rotated': return `${kind} ${prefix} was rotated with a bounded overlap.`;
    case 'credential.revoked': return `${kind} ${prefix} was revoked.`;
    case 'schema.created': return `Created tracking-plan event ${eventName}.`;
    case 'schema.version_created': return `Created draft ${eventName} version ${version}.`;
    case 'schema.published': return `Published ${eventName} version ${version}.`;
    case 'schema.deprecated': return `Deprecated ${eventName ? `${eventName} ` : ''}version ${version}.`;
    default: return 'Recorded a connected-journey configuration change.';
  }
}

export function listJourneyEventControlAudit(input: {
  spaceId: string;
  sourceId: string;
  limit?: number;
  before?: string;
  cursor?: string;
}) {
  assertConnectedFeature(input.spaceId);
  requireSource(input.spaceId, input.sourceId);
  const limit = input.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new JourneyEventControlRepositoryError('Audit limit must be between 1 and 100.', 400, 'JOURNEY_EVENT_AUDIT_LIMIT_INVALID');
  }
  let boundary: { createdAt: string; id: string } | null = null;
  if (input.cursor) {
    try {
      const parsed = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')) as { createdAt?: unknown; id?: unknown };
      const createdAt = nowIso(String(parsed.createdAt || ''));
      const id = String(parsed.id || '');
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(id)) throw new Error('invalid cursor id');
      boundary = { createdAt, id };
    } catch {
      throw new JourneyEventControlRepositoryError('Audit cursor is invalid.', 400, 'JOURNEY_EVENT_AUDIT_CURSOR_INVALID');
    }
  } else if (input.before) {
    boundary = { createdAt: nowIso(input.before), id: '\uffff' };
  }
  let rows: Array<Record<string, unknown>>;
  if (boundary) {
    rows = db.prepare(`SELECT id,space_id,source_id,actor_user_id,action,target_type,target_id,detail_json,
      before_fingerprint,after_fingerprint,created_at FROM journey_event_control_audit_events
      WHERE space_id=? AND source_id=? AND (created_at<? OR (created_at=? AND id<?))
      ORDER BY created_at DESC,id DESC LIMIT ?`)
      .all(input.spaceId, input.sourceId, boundary.createdAt, boundary.createdAt, boundary.id, limit + 1) as Array<Record<string, unknown>>;
  } else {
    rows = db.prepare(`SELECT id,space_id,source_id,actor_user_id,action,target_type,target_id,detail_json,
      before_fingerprint,after_fingerprint,created_at FROM journey_event_control_audit_events
      WHERE space_id=? AND source_id=? ORDER BY created_at DESC,id DESC LIMIT ?`)
      .all(input.spaceId, input.sourceId, limit + 1) as Array<Record<string, unknown>>;
  }
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const events = page.map((row): JourneyEventControlAuditEvent => {
    const detail = parseJson<Record<string, unknown>>(row.detail_json, {});
    const actorId = row.actor_user_id ? String(row.actor_user_id) : null;
    const actorRow = actorId
      ? db.prepare('SELECT name FROM users WHERE id=?').get(actorId) as { name?: string } | undefined
      : undefined;
    const action = String(row.action);
    const kind = String(row.target_type) as JourneyEventControlAuditEvent['targetKind'];
    const summary = auditSummary(action, detail);
    return {
    id: String(row.id),
    spaceId: String(row.space_id),
    sourceId: row.source_id ? String(row.source_id) : null,
    actorUserId: row.actor_user_id ? String(row.actor_user_id) : null,
    action,
    targetType: kind,
    targetKind: kind,
    targetId: String(row.target_id),
    actor: actorId && actorRow?.name ? { id: actorId, name: String(actorRow.name) } : null,
    summary,
    detail,
    beforeFingerprint: row.before_fingerprint ? String(row.before_fingerprint) : null,
    afterFingerprint: row.after_fingerprint ? String(row.after_fingerprint) : null,
    createdAt: String(row.created_at)
    };
  });
  const last = hasMore ? events.at(-1) : null;
  const nextCursor = last
    ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: last.id }), 'utf8').toString('base64url')
    : null;
  return { events, nextCursor };
}

export function isJourneyEventControlError(error: unknown): error is JourneyEventControlRepositoryError | JourneyEventControlPlaneError {
  return error instanceof JourneyEventControlRepositoryError || error instanceof JourneyEventControlPlaneError;
}
