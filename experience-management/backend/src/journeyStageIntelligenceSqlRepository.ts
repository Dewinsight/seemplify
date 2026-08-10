import crypto from 'node:crypto';
import fs from 'node:fs';
import { config } from './config.js';
import { db } from './database.js';
import {
  JourneyStageIntelligenceError, journeyStageComparisonDimensions, journeyStageEmotions,
  journeyStagePurposes, journeyStageSentiments, type JourneyStageComparisonDimension,
  type JourneyStageEmotion, type JourneyStageIntelligenceFact, type JourneyStagePurpose,
  type JourneyStageSentiment, type JourneyStageSourceLineage
} from './journeyStageIntelligence.js';
import type {
  JourneyStageIntelligencePolicy, JourneyStageIntelligencePolicyUpdate, JourneyStageIntelligenceStorage
} from './journeyStageIntelligenceRepository.js';

const metricUnits = ['score', 'percent', 'count', 'seconds', 'minutes', 'hours', 'rate', 'index', 'currency', 'unknown'] as const;
type MetricUnit = typeof metricUnits[number];

function ensureSqliteSchema() {
  if (db.provider !== 'sqlite') return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS journey_stage_intelligence_policies (
      space_id TEXT PRIMARY KEY REFERENCES spaces(id) ON DELETE CASCADE, revision INTEGER NOT NULL,
      minimum_sample_size INTEGER NOT NULL, dimensions_json TEXT NOT NULL, maximum_rows INTEGER NOT NULL,
      updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS journey_stage_intelligence_policy_history (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE RESTRICT, revision INTEGER NOT NULL,
      minimum_sample_size INTEGER NOT NULL, dimensions_json TEXT NOT NULL, maximum_rows INTEGER NOT NULL,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL, UNIQUE(space_id,revision));
    CREATE TABLE IF NOT EXISTS journey_stage_intelligence_facts (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      journey_definition_id TEXT NOT NULL, source_type TEXT NOT NULL, source_id_hmac TEXT NOT NULL,
      external_record_hmac TEXT NOT NULL, source_version TEXT NOT NULL, schema_version TEXT NOT NULL,
      projection_version TEXT NOT NULL, revision INTEGER NOT NULL, operation TEXT NOT NULL,
      supersedes_fact_id TEXT, subject_id_hmac TEXT NOT NULL, stage_id TEXT NOT NULL,
      metric_definition_id TEXT NOT NULL, metric_definition_version_id TEXT NOT NULL,
      metric_definition_version_sha256 TEXT NOT NULL, metric_unit TEXT NOT NULL, value REAL,
      dimensions_json TEXT NOT NULL, sentiment TEXT, emotions_json TEXT NOT NULL, occurred_at TEXT NOT NULL,
      consent_state TEXT NOT NULL, purposes_json TEXT NOT NULL, retention_expires_at TEXT NOT NULL,
      idempotency_key_hmac TEXT NOT NULL, intent_sha256 TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(id,space_id), UNIQUE(id,space_id,metric_definition_id,source_id_hmac,external_record_hmac),
      UNIQUE(space_id,idempotency_key_hmac),
      UNIQUE(space_id,metric_definition_id,source_id_hmac,external_record_hmac,revision),
      FOREIGN KEY(journey_definition_id,space_id) REFERENCES journey_definitions(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(metric_definition_id,space_id) REFERENCES journey_metric_definitions(id,space_id) ON DELETE CASCADE,
      FOREIGN KEY(metric_definition_version_id,metric_definition_id,space_id)
        REFERENCES journey_metric_definition_versions(id,definition_id,space_id) ON DELETE RESTRICT,
      FOREIGN KEY(supersedes_fact_id,space_id,metric_definition_id,source_id_hmac,external_record_hmac)
        REFERENCES journey_stage_intelligence_facts(id,space_id,metric_definition_id,source_id_hmac,external_record_hmac)
        ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED);
    CREATE INDEX IF NOT EXISTS journey_stage_intelligence_facts_window ON journey_stage_intelligence_facts
      (space_id,journey_definition_id,occurred_at,metric_definition_version_id,id);
    CREATE INDEX IF NOT EXISTS journey_stage_intelligence_facts_latest ON journey_stage_intelligence_facts
      (space_id,metric_definition_id,source_id_hmac,external_record_hmac,revision DESC,id);
    CREATE INDEX IF NOT EXISTS journey_stage_intelligence_facts_retention ON journey_stage_intelligence_facts
      (retention_expires_at,space_id,id);
    CREATE TABLE IF NOT EXISTS journey_stage_intelligence_audit (
      id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE RESTRICT,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, action TEXT NOT NULL, target_type TEXT NOT NULL,
      target_sha256 TEXT NOT NULL, detail_json TEXT NOT NULL, detail_sha256 TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS journey_stage_intelligence_audit_list ON journey_stage_intelligence_audit(space_id,created_at DESC,id);
    CREATE TRIGGER IF NOT EXISTS journey_stage_intelligence_policy_history_append_only_update
      BEFORE UPDATE ON journey_stage_intelligence_policy_history BEGIN SELECT RAISE(ABORT,'journey stage intelligence history is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_stage_intelligence_policy_history_append_only_delete
      BEFORE DELETE ON journey_stage_intelligence_policy_history BEGIN SELECT RAISE(ABORT,'journey stage intelligence history is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_stage_intelligence_facts_append_only_update
      BEFORE UPDATE ON journey_stage_intelligence_facts BEGIN SELECT RAISE(ABORT,'journey stage intelligence facts are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_stage_intelligence_facts_retention_delete
      BEFORE DELETE ON journey_stage_intelligence_facts WHEN OLD.retention_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      BEGIN SELECT RAISE(ABORT,'journey stage intelligence facts require an expired-retention purge'); END;
    CREATE TRIGGER IF NOT EXISTS journey_stage_intelligence_audit_append_only_update
      BEFORE UPDATE ON journey_stage_intelligence_audit BEGIN SELECT RAISE(ABORT,'journey stage intelligence audit is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journey_stage_intelligence_audit_append_only_delete
      BEFORE DELETE ON journey_stage_intelligence_audit BEGIN SELECT RAISE(ABORT,'journey stage intelligence audit is append-only'); END;
  `);
}
ensureSqliteSchema();

let keyCache: Buffer | null = null;
function hashKey() { if (!keyCache) keyCache = fs.readFileSync(config.journeyIdentityHashKeyFile); return keyCache; }
function hmac(value: string) { return crypto.createHmac('sha256', hashKey()).update(value, 'utf8').digest('hex'); }
function sha(value: unknown) { return crypto.createHash('sha256').update(stable(value)).digest('hex'); }
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value as Record<string, unknown>).sort()
    .map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function parse<T>(value: unknown, fallback: T): T {
  if (value && typeof value === 'object') return value as T;
  try { return JSON.parse(String(value ?? '')) as T; } catch { return fallback; }
}
function token(value: unknown, label: string, maximum = 128) {
  if (typeof value !== 'string' || value.trim() !== value || !value || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new JourneyStageIntelligenceError(`${label} is invalid.`, 400, 'JOURNEY_STAGE_INTELLIGENCE_INPUT_INVALID');
  }
  return value;
}
function at(value: string, label: string) { const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new JourneyStageIntelligenceError(`${label} is invalid.`, 400,
    'JOURNEY_STAGE_INTELLIGENCE_INPUT_INVALID'); return new Date(time).toISOString(); }
function allow<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw new JourneyStageIntelligenceError(`${label} is invalid.`, 400,
    'JOURNEY_STAGE_INTELLIGENCE_INPUT_INVALID'); return value as T;
}
function audit(spaceId: string, actorUserId: string | null, action: string, targetType: string, target: string,
  detail: Record<string, unknown>, createdAt: string) {
  const safe = stable(detail); db.prepare(`INSERT INTO journey_stage_intelligence_audit
    (id,space_id,actor_user_id,action,target_type,target_sha256,detail_json,detail_sha256,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), spaceId, actorUserId, action, targetType, sha(target), safe, sha(detail), createdAt);
}

export type JourneyStageFactPrincipal = { kind: 'server_secret'; spaceId: string; sourceId: string };
type Common = { metricDefinitionId: string; externalRecordId: string; revision: number; idempotencyKey: string };
export type JourneyStageFactInput = Common & ({ operation: 'delete' } | {
  operation: 'upsert'; journeyDefinitionId: string; subjectId: string; stageId: string; metricDefinitionVersionId: string;
  metricDefinitionVersionSha256: string; metricUnit: MetricUnit; value: number | null;
  dimensions: Partial<Record<JourneyStageComparisonDimension, string[]>>;
  sentiment: JourneyStageSentiment | null; emotions: JourneyStageEmotion[]; occurredAt: string;
  consentState: JourneyStageIntelligenceFact['consentState']; purposes: JourneyStagePurpose[];
  retentionExpiresAt: string; lineage: Omit<JourneyStageSourceLineage, 'sourceId'>;
});

function dimensions(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new JourneyStageIntelligenceError(
    'dimensions must be an object.', 400, 'JOURNEY_STAGE_INTELLIGENCE_INPUT_INVALID');
  const row = value as Record<string, unknown>; const unexpected = Object.keys(row).find((key) =>
    !journeyStageComparisonDimensions.includes(key as JourneyStageComparisonDimension));
  if (unexpected) throw new JourneyStageIntelligenceError('A dimension is not allowlisted.', 400,
    'JOURNEY_STAGE_INTELLIGENCE_INPUT_INVALID');
  return Object.fromEntries(Object.entries(row).sort(([left], [right]) => left.localeCompare(right)).map(([key, raw]) => {
    if (!Array.isArray(raw) || raw.length > 8) throw new JourneyStageIntelligenceError('A dimension must contain at most 8 ids.', 400,
      'JOURNEY_STAGE_INTELLIGENCE_INPUT_INVALID');
    return [key, [...new Set(raw.map((item) => token(item, `${key} id`)))].sort()];
  })) as Partial<Record<JourneyStageComparisonDimension, string[]>>;
}

export class SqlJourneyStageIntelligenceStorage implements JourneyStageIntelligenceStorage {
  purgeExpiredFacts(input: { kind: 'retention_worker'; spaceId: string; now?: Date | string }) {
    if (input.kind !== 'retention_worker') throw new JourneyStageIntelligenceError('Retention authority is required.', 403,
      'JOURNEY_STAGE_INTELLIGENCE_RETENTION_AUTHORITY_REQUIRED');
    const cutoff = at(input.now instanceof Date ? input.now.toISOString() : input.now || new Date().toISOString(), 'now');
    return db.transaction(() => {
      if (db.provider === 'postgres') {
        // PostgresRuntime intentionally rejects every non-PRAGMA `exec` call.
        // A prepared, transaction-local setting keeps the purge on its normal
        // least-privilege DML path and is automatically cleared at commit.
        db.prepare("SELECT set_config('seemplify.retention_purge','on',true) configured").get();
      }
      const purged = db.prepare('DELETE FROM journey_stage_intelligence_facts WHERE space_id=? AND retention_expires_at<=?')
        .run(input.spaceId, cutoff).changes;
      audit(input.spaceId, null, 'retention.purged', 'retention', input.spaceId, { purgedCount: purged, cutoff }, cutoff);
      return { purgedCount: purged, cutoff };
    })();
  }

  /** Tenants holding at least one already-expired fact.
   *
   * The retention coordinator uses this instead of walking `spaces`, because
   * `purgeExpiredFacts` audits unconditionally: a per-minute no-op receipt for
   * every tenant would bury the real purge receipts the ledger exists to
   * preserve, and the append-only audit trigger makes them impossible to prune.
   * Reads the covering `..._facts_retention(retention_expires_at,space_id,id)`
   * index, so an idle pass touches no rows at all. */
  spacesWithExpiredFacts(now: Date | string = new Date(), limit = 100, afterSpaceId: string | null = null) {
    const cutoff = at(now instanceof Date ? now.toISOString() : now, 'now');
    const bounded = Math.max(1, Math.min(1_000, Math.trunc(limit) || 1));
    return (db.prepare(`SELECT DISTINCT space_id FROM journey_stage_intelligence_facts
      WHERE retention_expires_at<=? AND (? IS NULL OR space_id>?) ORDER BY space_id LIMIT ?`)
      .all(cutoff, afterSpaceId, afterSpaceId, bounded) as Array<{ space_id: string }>)
      .map((row) => String(row.space_id));
  }

  recordRead(input: { spaceId: string; actorUserId: string; action: 'comparison.read' | 'trend.read' | 'export.read';
    journeyDefinitionId: string; fingerprint: string; rowCount: number; suppressedRowCount: number }) {
    const createdAt = new Date().toISOString(); audit(input.spaceId, input.actorUserId, input.action,
      input.action === 'export.read' ? 'export' : input.action === 'trend.read' ? 'trend' : 'comparison', input.journeyDefinitionId,
      { fingerprint: input.fingerprint, rowCount: input.rowCount, suppressedRowCount: input.suppressedRowCount }, createdAt);
  }

  readPolicy(spaceId: string): JourneyStageIntelligencePolicy {
    let row = db.prepare('SELECT * FROM journey_stage_intelligence_policies WHERE space_id=?').get(spaceId) as any;
    if (!row) {
      const createdAt = new Date().toISOString();
      db.transaction(() => {
        db.prepare(`INSERT INTO journey_stage_intelligence_policies
          (space_id,revision,minimum_sample_size,dimensions_json,maximum_rows,updated_by_user_id,created_at,updated_at)
          VALUES (?,1,30,?,500,NULL,?,?) ON CONFLICT(space_id) DO NOTHING`)
          .run(spaceId, JSON.stringify(journeyStageComparisonDimensions), createdAt, createdAt);
        const exists = db.prepare('SELECT 1 ok FROM journey_stage_intelligence_policy_history WHERE space_id=? AND revision=1').get(spaceId);
        if (!exists) db.prepare(`INSERT INTO journey_stage_intelligence_policy_history
          (id,space_id,revision,minimum_sample_size,dimensions_json,maximum_rows,actor_user_id,created_at)
          VALUES (?,?,1,30,?,500,NULL,?)`).run(crypto.randomUUID(), spaceId, JSON.stringify(journeyStageComparisonDimensions), createdAt);
      })();
      row = db.prepare('SELECT * FROM journey_stage_intelligence_policies WHERE space_id=?').get(spaceId);
    }
    return { revision: Number(row.revision), minimumSampleSize: Number(row.minimum_sample_size),
      dimensions: parse<JourneyStageComparisonDimension[]>(row.dimensions_json, []), maximumRows: Number(row.maximum_rows) };
  }

  updatePolicy(input: JourneyStageIntelligencePolicyUpdate & { spaceId: string; actorUserId: string }) {
    const unique = [...new Set(input.dimensions)].sort(); const createdAt = new Date().toISOString();
    const result = db.transaction(() => {
      if (db.provider === 'postgres') db.prepare('SELECT id FROM spaces WHERE id=? FOR UPDATE').get(input.spaceId);
      const current = this.readPolicy(input.spaceId);
      if (current.revision !== input.expectedRevision) throw new JourneyStageIntelligenceError('Policy changed.', 409,
        'JOURNEY_STAGE_INTELLIGENCE_POLICY_CONFLICT');
      const next = current.revision + 1;
      const changed = db.prepare(`UPDATE journey_stage_intelligence_policies SET revision=?,minimum_sample_size=?,
        dimensions_json=?,maximum_rows=?,updated_by_user_id=?,updated_at=? WHERE space_id=? AND revision=?`)
        .run(next, input.minimumSampleSize, JSON.stringify(unique), input.maximumRows, input.actorUserId, createdAt,
          input.spaceId, current.revision).changes;
      if (changed !== 1) throw new JourneyStageIntelligenceError('Policy changed.', 409,
        'JOURNEY_STAGE_INTELLIGENCE_POLICY_CONFLICT');
      db.prepare(`INSERT INTO journey_stage_intelligence_policy_history
        (id,space_id,revision,minimum_sample_size,dimensions_json,maximum_rows,actor_user_id,created_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), input.spaceId, next, input.minimumSampleSize,
          JSON.stringify(unique), input.maximumRows, input.actorUserId, createdAt);
      audit(input.spaceId, input.actorUserId, 'policy.updated', 'policy', input.spaceId,
        { revision: next, minimumSampleSize: input.minimumSampleSize, dimensions: unique, maximumRows: input.maximumRows }, createdAt);
      return { revision: next, minimumSampleSize: input.minimumSampleSize, dimensions: unique, maximumRows: input.maximumRows };
    })();
    return result;
  }

  ingestFact(principal: JourneyStageFactPrincipal, payload: JourneyStageFactInput, now: Date | string = new Date()) {
    if (principal.kind !== 'server_secret') throw new JourneyStageIntelligenceError('Server authority is required.', 403,
      'JOURNEY_STAGE_INTELLIGENCE_SERVER_AUTHORITY_REQUIRED');
    const createdAt = at(now instanceof Date ? now.toISOString() : now, 'now'); const sourceId = token(principal.sourceId, 'sourceId', 200);
    const metricDefinitionId = token(payload.metricDefinitionId, 'metricDefinitionId');
    const externalRecordHmac = hmac(token(payload.externalRecordId, 'externalRecordId', 500));
    const sourceIdHmac = hmac(sourceId); const key = token(payload.idempotencyKey, 'idempotencyKey', 200);
    if (key.length < 8 || !Number.isSafeInteger(payload.revision) || payload.revision < 1) throw new JourneyStageIntelligenceError(
      'Revision or idempotency key is invalid.', 400, 'JOURNEY_STAGE_INTELLIGENCE_INPUT_INVALID');
    const intent = { ...payload, ...(payload.operation === 'upsert' ? { subjectId: hmac(payload.subjectId) } : {}),
      externalRecordId: externalRecordHmac, sourceId: sourceIdHmac };
    const intentSha = sha(intent); const idempotencyKeyHmac = hmac(key);
    const replay = db.prepare('SELECT id,intent_sha256,revision,operation FROM journey_stage_intelligence_facts WHERE space_id=? AND idempotency_key_hmac=?')
      .get(principal.spaceId, idempotencyKeyHmac) as any;
    if (replay) {
      if (replay.intent_sha256 !== intentSha) throw new JourneyStageIntelligenceError('Idempotency key intent changed.', 409,
        'JOURNEY_STAGE_INTELLIGENCE_IDEMPOTENCY_CONFLICT');
      return { factId: String(replay.id), revision: Number(replay.revision), operation: replay.operation, replayed: true };
    }
    return db.transaction(() => {
      if (db.provider === 'postgres') db.prepare('SELECT id FROM spaces WHERE id=? FOR UPDATE').get(principal.spaceId);
      const prior = db.prepare(`SELECT * FROM journey_stage_intelligence_facts WHERE space_id=? AND metric_definition_id=?
        AND source_id_hmac=? AND external_record_hmac=? ORDER BY revision DESC,id LIMIT 1`)
        .get(principal.spaceId, metricDefinitionId, sourceIdHmac, externalRecordHmac) as any;
      if ((!prior && payload.revision !== 1) || (prior && payload.revision !== Number(prior.revision) + 1)) {
        throw new JourneyStageIntelligenceError('Fact revisions must be consecutive.', 409,
          'JOURNEY_STAGE_INTELLIGENCE_REVISION_CONFLICT');
      }
      if (payload.operation === 'delete' && !prior) throw new JourneyStageIntelligenceError('Fact not found.', 404,
        'JOURNEY_STAGE_INTELLIGENCE_FACT_NOT_FOUND');
      const source = payload.operation === 'delete' ? prior : payload;
      if (payload.operation === 'upsert') {
        if (!/^[a-f0-9]{64}$/u.test(payload.metricDefinitionVersionSha256) || (payload.value !== null && !Number.isFinite(payload.value))) {
          throw new JourneyStageIntelligenceError('Metric value or version digest is invalid.', 400,
            'JOURNEY_STAGE_INTELLIGENCE_INPUT_INVALID');
        }
        const version = db.prepare(`SELECT version.id,version.content_sha256,definition.name,definition.journey_definition_id
          FROM journey_metric_definition_versions version JOIN journey_metric_definitions definition
            ON definition.id=version.definition_id AND definition.space_id=version.space_id
          WHERE version.id=? AND version.definition_id=? AND version.space_id=?`)
          .get(payload.metricDefinitionVersionId, metricDefinitionId, principal.spaceId) as any;
        if (!version || version.content_sha256 !== payload.metricDefinitionVersionSha256
            || version.journey_definition_id !== payload.journeyDefinitionId) throw new JourneyStageIntelligenceError(
          'Metric lineage is unavailable.', 409, 'JOURNEY_STAGE_INTELLIGENCE_LINEAGE_INVALID');
      }
      const ids = payload.operation === 'delete' ? parse(source.dimensions_json, {}) : dimensions(payload.dimensions);
      const purposes = payload.operation === 'delete' ? parse(source.purposes_json, [])
        : [...new Set(payload.purposes.map((item) => allow(item, journeyStagePurposes, 'purpose')))].sort();
      const emotions = payload.operation === 'delete' ? parse(source.emotions_json, [])
        : [...new Set(payload.emotions.map((item) => allow(item, journeyStageEmotions, 'emotion')))].sort();
      const lineage = payload.operation === 'delete' ? source : payload.lineage;
      const id = crypto.randomUUID();
      db.prepare(`INSERT INTO journey_stage_intelligence_facts
        (id,space_id,journey_definition_id,source_type,source_id_hmac,external_record_hmac,source_version,schema_version,
        projection_version,revision,operation,supersedes_fact_id,subject_id_hmac,stage_id,metric_definition_id,
        metric_definition_version_id,metric_definition_version_sha256,metric_unit,value,dimensions_json,sentiment,emotions_json,
        occurred_at,consent_state,purposes_json,retention_expires_at,idempotency_key_hmac,intent_sha256,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, principal.spaceId,
          payload.operation === 'delete' ? source.journey_definition_id : payload.journeyDefinitionId,
          payload.operation === 'delete' ? source.source_type : payload.lineage.sourceType, sourceIdHmac, externalRecordHmac,
          payload.operation === 'delete' ? source.source_version : token(payload.lineage.sourceVersion, 'sourceVersion'),
          payload.operation === 'delete' ? source.schema_version : token(payload.lineage.schemaVersion, 'schemaVersion'),
          payload.operation === 'delete' ? source.projection_version : token(payload.lineage.projectionVersion, 'projectionVersion'),
          payload.revision, payload.operation, prior?.id || null,
          payload.operation === 'delete' ? source.subject_id_hmac : hmac(token(payload.subjectId, 'subjectId', 500)),
          payload.operation === 'delete' ? source.stage_id : token(payload.stageId, 'stageId'), metricDefinitionId,
          payload.operation === 'delete' ? source.metric_definition_version_id : payload.metricDefinitionVersionId,
          payload.operation === 'delete' ? source.metric_definition_version_sha256 : payload.metricDefinitionVersionSha256,
          payload.operation === 'delete' ? source.metric_unit : allow(payload.metricUnit, metricUnits, 'metricUnit'),
          payload.operation === 'delete' ? null : payload.value, JSON.stringify(ids),
          payload.operation === 'delete' ? source.sentiment : payload.sentiment === null ? null : allow(payload.sentiment, journeyStageSentiments, 'sentiment'),
          JSON.stringify(emotions), payload.operation === 'delete' ? source.occurred_at : at(payload.occurredAt, 'occurredAt'),
          payload.operation === 'delete' ? source.consent_state : payload.consentState, JSON.stringify(purposes),
          payload.operation === 'delete' ? source.retention_expires_at : at(payload.retentionExpiresAt, 'retentionExpiresAt'),
          idempotencyKeyHmac, intentSha, createdAt);
      audit(principal.spaceId, null, payload.operation === 'delete' ? 'fact.deleted' : 'fact.accepted', 'fact', id,
        { revision: payload.revision, operation: payload.operation, metricDefinitionSha256: sha(metricDefinitionId),
          sourceType: payload.operation === 'delete' ? source.source_type : payload.lineage.sourceType }, createdAt);
      return { factId: id, revision: payload.revision, operation: payload.operation, replayed: false };
    })();
  }

  loadFacts(input: { spaceId: string; journeyDefinitionId: string; from: string; to: string; asOf: string }) {
    const rows = db.prepare(`SELECT fact.*,definition.name metric_name FROM journey_stage_intelligence_facts fact
      JOIN journey_metric_definitions definition ON definition.id=fact.metric_definition_id AND definition.space_id=fact.space_id
      WHERE fact.space_id=? AND fact.journey_definition_id=? AND fact.occurred_at>=? AND fact.occurred_at<?
        AND fact.created_at<=? AND NOT EXISTS (SELECT 1 FROM journey_stage_intelligence_facts newer
          WHERE newer.space_id=fact.space_id AND newer.metric_definition_id=fact.metric_definition_id
            AND newer.source_id_hmac=fact.source_id_hmac AND newer.external_record_hmac=fact.external_record_hmac
            AND newer.revision>fact.revision)
        AND fact.operation='upsert' ORDER BY fact.occurred_at,fact.id LIMIT 100001`)
      .all(input.spaceId, input.journeyDefinitionId, input.from, input.to, input.asOf) as any[];
    if (rows.length > 100_000) throw new JourneyStageIntelligenceError('The governed fact window exceeds 100000 rows.', 413,
      'JOURNEY_STAGE_INTELLIGENCE_FACT_WINDOW_TOO_LARGE');
    return rows.map<JourneyStageIntelligenceFact>((row) => ({ spaceId: row.space_id, subjectKey: row.subject_id_hmac,
      stageId: row.stage_id, metricDefinitionId: row.metric_definition_id,
      metricDefinitionVersionId: row.metric_definition_version_id,
      metricDefinitionVersionSha256: row.metric_definition_version_sha256, metricName: row.metric_name,
      metricUnit: row.metric_unit, value: row.value === null ? null : Number(row.value),
      dimensions: parse(row.dimensions_json, {}), sentiment: row.sentiment, emotions: parse(row.emotions_json, []),
      occurredAt: new Date(row.occurred_at).toISOString(), consentState: row.consent_state,
      allowedPurposes: parse(row.purposes_json, []), retentionExpiresAt: new Date(row.retention_expires_at).toISOString(),
      deletedAt: null, lineage: { sourceType: row.source_type, sourceId: row.source_id_hmac,
        sourceVersion: row.source_version, schemaVersion: row.schema_version, projectionVersion: row.projection_version } }));
  }
}

const retentionStorage = new SqlJourneyStageIntelligenceStorage();

export type JourneyStageIntelligenceRetentionOutcome = {
  spacesScanned: number; spacesPurged: number; purgedCount: number; failedSpaces: number; nextCursor: string | null;
};

/** Executes the declared runtime-41 retention policy across every tenant that
 * currently holds expired facts.
 *
 * Without a coordinator `retention_expires_at` only gates *reads*
 * (`buildJourneyStageComparisons` drops expired facts), so pseudonymous rows
 * would sit in the table for ever and the stated policy would never actually be
 * applied. Each tenant is purged in its own transaction through the internal
 * `retention_worker` authority — the only caller allowed past the delete guard —
 * so no caller-facing route can reach it.
 *
 * A tenant whose purge is refused is counted and skipped rather than aborting
 * the pass for everyone else. That is a real case, not defensive padding: a
 * correction or tombstone carries its own `retentionExpiresAt`, so a still-live
 * revision can reference an expired one through `supersedes_fact_id`, and the
 * deferred foreign key then refuses that tenant's delete. Retrying costs
 * nothing, and the next pass succeeds once the whole chain has expired. */
export function purgeExpiredJourneyStageIntelligenceFacts(asOf: Date | string = new Date(),
  limit = 100, afterSpaceId: string | null = null): JourneyStageIntelligenceRetentionOutcome {
  const bounded = Math.max(1, Math.min(1_000, Math.trunc(limit) || 1));
  const candidates = retentionStorage.spacesWithExpiredFacts(asOf, bounded + 1, afterSpaceId);
  const spaces = candidates.slice(0, bounded);
  let purgedCount = 0; let spacesPurged = 0; let failedSpaces = 0;
  for (const spaceId of spaces) {
    try {
      const result = retentionStorage.purgeExpiredFacts({ kind: 'retention_worker', spaceId, now: asOf });
      if (result.purgedCount) { purgedCount += result.purgedCount; spacesPurged += 1; }
    } catch { failedSpaces += 1; }
  }
  // Advance past the whole attempted page, including failed tenants. A failed
  // early tenant is retried when the bounded cycle wraps, but cannot starve a
  // later tenant forever.
  const nextCursor = candidates.length > bounded ? spaces.at(-1) || null : null;
  return { spacesScanned: spaces.length, spacesPurged, purgedCount, failedSpaces, nextCursor };
}
