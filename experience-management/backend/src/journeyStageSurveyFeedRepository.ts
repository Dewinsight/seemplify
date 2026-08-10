import crypto from 'node:crypto';
import fs from 'node:fs';
import { config } from './config.js';
import { db } from './database.js';
import type { Collector, ResponseRecord, Survey } from './types.js';
import { JourneyStageIntelligenceError, journeyStagePurposes, type JourneyStagePurpose } from './journeyStageIntelligence.js';

const projectionVersion = 'survey-stage-feed/v1';
let keyCache: Buffer | null = null;
function key() { if (!keyCache) keyCache = fs.readFileSync(config.journeyIdentityHashKeyFile); return keyCache; }
function hmac(value: string) { return crypto.createHmac('sha256', key()).update(value, 'utf8').digest('hex'); }
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value as Record<string, unknown>).sort()
    .map((name) => `${JSON.stringify(name)}:${stable((value as Record<string, unknown>)[name])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha(value: unknown) { return crypto.createHash('sha256').update(stable(value)).digest('hex'); }
function parse<T>(value: unknown, fallback: T): T { try { return typeof value === 'string' ? JSON.parse(value) as T : value as T; } catch { return fallback; } }
function iso(value: Date | string = new Date()) { const at = new Date(value); if (!Number.isFinite(at.getTime())) fail('Timestamp is invalid.'); return at.toISOString(); }
function fail(message: string, status = 400, code = 'JOURNEY_STAGE_SURVEY_FEED_INVALID'): never {
  throw new JourneyStageIntelligenceError(message, status, code);
}
function token(value: unknown, label: string, maximum = 200) {
  if (typeof value !== 'string' || value.trim() !== value || !value || value.length > maximum) fail(`${label} is invalid.`);
  return value;
}
function audit(input: { spaceId: string; actorUserId?: string | null; action: string; target: string;
  detail?: Record<string, unknown>; at: string }) {
  const detail = input.detail || {}; db.prepare(`INSERT INTO journey_stage_survey_feed_audit
    (id,space_id,actor_user_id,action,target_sha256,detail_json,detail_sha256,created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(crypto.randomUUID(), input.spaceId, input.actorUserId || null, input.action, sha(input.target), stable(detail), sha(detail), input.at);
}
function factAudit(spaceId: string, factId: string, operation: 'upsert' | 'delete', metricDefinitionId: string,
  revision: number, at: string) {
  const detail = { revision, operation, metricDefinitionSha256: sha(metricDefinitionId), sourceType: 'survey' };
  db.prepare(`INSERT INTO journey_stage_intelligence_audit
    (id,space_id,actor_user_id,action,target_type,target_sha256,detail_json,detail_sha256,created_at)
    VALUES (?,?,NULL,?,'fact',?,?,?,?)`).run(crypto.randomUUID(), spaceId,
      operation === 'delete' ? 'fact.deleted' : 'fact.accepted', sha(factId), stable(detail), sha(detail), at);
}

function ensureSqliteSchema() {
  if (db.provider !== 'sqlite') return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS journey_stage_source_mappings (
      id TEXT PRIMARY KEY,space_id TEXT NOT NULL,source_kind TEXT NOT NULL,state TEXT NOT NULL,metric_definition_id TEXT NOT NULL,revision INTEGER NOT NULL,
      current_version_id TEXT,idempotency_key_hmac TEXT NOT NULL,intent_sha256 TEXT NOT NULL,created_by_user_id TEXT,
      created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(id,space_id),UNIQUE(space_id,idempotency_key_hmac),
      UNIQUE(space_id,source_kind,metric_definition_id));
    CREATE TABLE IF NOT EXISTS journey_stage_source_mapping_versions (
      id TEXT PRIMARY KEY,mapping_id TEXT NOT NULL,space_id TEXT NOT NULL,version_number INTEGER NOT NULL,
      journey_definition_id TEXT NOT NULL,stage_id TEXT NOT NULL,metric_definition_id TEXT NOT NULL,
      metric_definition_version_id TEXT NOT NULL,metric_definition_version_sha256 TEXT NOT NULL,binding_id TEXT NOT NULL,
      question_id TEXT NOT NULL,question_schema_sha256 TEXT NOT NULL,calculator_kind TEXT NOT NULL,
      calculator_configuration_json TEXT NOT NULL,survey_id_hmac TEXT NOT NULL,collector_id_hmac TEXT NOT NULL,
      allowed_purposes_json TEXT NOT NULL,retention_days INTEGER NOT NULL,projection_version TEXT NOT NULL,
      content_sha256 TEXT NOT NULL,created_by_user_id TEXT,created_at TEXT NOT NULL,
      UNIQUE(id,mapping_id,space_id),UNIQUE(mapping_id,version_number));
    CREATE INDEX IF NOT EXISTS journey_stage_source_mapping_versions_survey
      ON journey_stage_source_mapping_versions(space_id,survey_id_hmac,collector_id_hmac,mapping_id,version_number DESC);
    CREATE TABLE IF NOT EXISTS journey_stage_survey_policies (
      id TEXT PRIMARY KEY,space_id TEXT NOT NULL,survey_id_hmac TEXT NOT NULL,collector_id_hmac TEXT NOT NULL,
      state TEXT NOT NULL,revision INTEGER NOT NULL,current_version_id TEXT,created_by_user_id TEXT,created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,UNIQUE(id,space_id),UNIQUE(space_id,survey_id_hmac,collector_id_hmac));
    CREATE TABLE IF NOT EXISTS journey_stage_survey_policy_versions (
      id TEXT PRIMARY KEY,policy_id TEXT NOT NULL,space_id TEXT NOT NULL,version_number INTEGER NOT NULL,
      notice_text TEXT NOT NULL,notice_sha256 TEXT NOT NULL,allowed_purposes_json TEXT NOT NULL,retention_days INTEGER NOT NULL,
      requires_explicit_consent INTEGER NOT NULL,content_sha256 TEXT NOT NULL,created_by_user_id TEXT,created_at TEXT NOT NULL,
      UNIQUE(id,policy_id,space_id),UNIQUE(policy_id,version_number));
    CREATE TABLE IF NOT EXISTS journey_stage_survey_governance_receipts (
      id TEXT PRIMARY KEY,space_id TEXT NOT NULL,policy_version_id TEXT NOT NULL,policy_id TEXT NOT NULL,
      response_id_hmac TEXT NOT NULL,subject_id_hmac TEXT NOT NULL,consent_state TEXT NOT NULL,purposes_json TEXT NOT NULL,
      notice_sha256 TEXT NOT NULL,source_snapshot_sha256 TEXT NOT NULL,retention_expires_at TEXT NOT NULL,created_at TEXT NOT NULL,
      UNIQUE(space_id,response_id_hmac,policy_version_id));
    CREATE TABLE IF NOT EXISTS journey_stage_survey_source_revisions (
      id TEXT PRIMARY KEY,space_id TEXT NOT NULL,mapping_id TEXT NOT NULL,mapping_version_id TEXT NOT NULL,
      governance_receipt_id TEXT,external_record_hmac TEXT NOT NULL,revision INTEGER NOT NULL,operation TEXT NOT NULL,
      supersedes_revision_id TEXT,projection_json TEXT NOT NULL,projection_sha256 TEXT NOT NULL,created_at TEXT NOT NULL,
      UNIQUE(id,space_id,mapping_id,external_record_hmac),UNIQUE(space_id,mapping_id,external_record_hmac,revision));
    CREATE TABLE IF NOT EXISTS journey_stage_survey_outbox (
      id TEXT PRIMARY KEY,space_id TEXT NOT NULL,mapping_id TEXT NOT NULL,source_revision_id TEXT,operation TEXT NOT NULL,
      state TEXT NOT NULL,available_at TEXT NOT NULL,lease_owner TEXT,lease_token TEXT,lease_generation INTEGER NOT NULL DEFAULT 0,
      lease_expires_at TEXT,attempt_count INTEGER NOT NULL DEFAULT 0,last_error_code TEXT,terminal_at TEXT,
      created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(source_revision_id));
    CREATE INDEX IF NOT EXISTS journey_stage_survey_outbox_claim ON journey_stage_survey_outbox(state,available_at,lease_expires_at,created_at,id);
    CREATE TABLE IF NOT EXISTS journey_stage_survey_outbox_attempts (
      id TEXT PRIMARY KEY,outbox_id TEXT NOT NULL,space_id TEXT NOT NULL,lease_generation INTEGER NOT NULL,
      attempt_number INTEGER NOT NULL,outcome TEXT NOT NULL,error_code TEXT,detail_sha256 TEXT NOT NULL,created_at TEXT NOT NULL,
      UNIQUE(outbox_id,lease_generation));
    CREATE TABLE IF NOT EXISTS journey_stage_survey_checkpoints (
      mapping_id TEXT NOT NULL,space_id TEXT NOT NULL,last_external_record_hmac TEXT,completed_revision_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,PRIMARY KEY(mapping_id,space_id));
    CREATE TABLE IF NOT EXISTS journey_stage_survey_feed_audit (
      id TEXT PRIMARY KEY,space_id TEXT NOT NULL,actor_user_id TEXT,action TEXT NOT NULL,target_sha256 TEXT NOT NULL,
      detail_json TEXT NOT NULL,detail_sha256 TEXT NOT NULL,created_at TEXT NOT NULL);
  `);
}
ensureSqliteSchema();

export type SurveyFeedGovernance = { policyVersionId: string; noticeAcknowledged: true;
  consentState: 'granted' | 'denied' | 'withdrawn'; purposes: JourneyStagePurpose[] };

type MappingRow = Record<string, any>;
function activeMappings(spaceId: string, surveyId: string, collectorId: string) {
  return db.prepare(`SELECT version.*,mapping.state FROM journey_stage_source_mappings mapping
    JOIN journey_stage_source_mapping_versions version ON version.id=mapping.current_version_id
      AND version.mapping_id=mapping.id AND version.space_id=mapping.space_id
    WHERE mapping.space_id=? AND mapping.state='active' AND version.survey_id_hmac=? AND version.collector_id_hmac=?
    ORDER BY mapping.id`).all(spaceId, hmac(surveyId), hmac(collectorId)) as MappingRow[];
}

export class JourneyStageSurveyFeedRepository {
  createPolicy(input: { spaceId: string; surveyId: string; collectorId: string; actorUserId: string;
    notice: string; allowedPurposes: JourneyStagePurpose[]; retentionDays: number;
    expectedRevision?: number; now?: Date | string }) {
    const survey = db.prepare(`SELECT survey.id FROM surveys survey JOIN collectors collector ON collector.survey_id=survey.id
      WHERE survey.id=? AND survey.space_id=? AND collector.id=?`).get(input.surveyId, input.spaceId, input.collectorId);
    if (!survey) fail('Survey collector not found.', 404, 'JOURNEY_STAGE_SURVEY_SOURCE_NOT_FOUND');
    const notice = token(input.notice, 'privacy notice', 4_000);
    if (notice.length < 20) fail('Privacy notice is too short.');
    const noticeSha256 = sha(notice);
    const purposes = [...new Set(input.allowedPurposes)].sort();
    if (!purposes.length || purposes.some((item) => !journeyStagePurposes.includes(item))
      || !Number.isSafeInteger(input.retentionDays) || input.retentionDays < 1 || input.retentionDays > 3650) fail('Policy is invalid.');
    const at = iso(input.now); const surveyHash = hmac(input.surveyId); const collectorHash = hmac(input.collectorId);
    return db.transaction(() => {
      const existing = db.prepare(`SELECT * FROM journey_stage_survey_policies
        WHERE space_id=? AND survey_id_hmac=? AND collector_id_hmac=?`).get(input.spaceId, surveyHash, collectorHash) as any;
      if (existing && input.expectedRevision !== Number(existing.revision)) fail('Survey feed policy changed; reload and retry.', 409,
        'JOURNEY_STAGE_SURVEY_POLICY_REVISION_CONFLICT');
      if (!existing && input.expectedRevision !== undefined && input.expectedRevision !== 0) fail(
        'Survey feed policy does not yet exist.', 409, 'JOURNEY_STAGE_SURVEY_POLICY_REVISION_CONFLICT');
      const id = existing?.id || crypto.randomUUID(); const versionNumber = Number(existing?.revision || 0) + 1;
      const versionId = crypto.randomUUID(); const content = { noticeSha256,
        allowedPurposes: purposes, retentionDays: input.retentionDays, requiresExplicitConsent: true };
      if (!existing) db.prepare(`INSERT INTO journey_stage_survey_policies
        (id,space_id,survey_id_hmac,collector_id_hmac,state,revision,current_version_id,created_by_user_id,created_at,updated_at)
        VALUES (?,?,?,?,'active',1,?,?,?,?)`).run(id, input.spaceId, surveyHash, collectorHash, versionId,
          input.actorUserId, at, at);
      else if (!db.prepare(`UPDATE journey_stage_survey_policies SET state='active',revision=?,current_version_id=?,
        created_by_user_id=?,updated_at=? WHERE id=? AND space_id=? AND revision=?`).run(versionNumber, versionId,
          input.actorUserId, at, id, input.spaceId, existing.revision).changes) fail(
        'Survey feed policy changed; reload and retry.', 409, 'JOURNEY_STAGE_SURVEY_POLICY_REVISION_CONFLICT');
      db.prepare(`INSERT INTO journey_stage_survey_policy_versions
        (id,policy_id,space_id,version_number,notice_text,notice_sha256,allowed_purposes_json,retention_days,
         requires_explicit_consent,content_sha256,created_by_user_id,created_at) VALUES (?,?,?,?,?,?,?,?,TRUE,?,?,?)`)
        .run(versionId, id, input.spaceId, versionNumber, notice, noticeSha256, JSON.stringify(purposes),
          input.retentionDays, sha(content), input.actorUserId, at);
      audit({ spaceId: input.spaceId, actorUserId: input.actorUserId, action: 'policy.created', target: id,
        detail: { versionNumber, retentionDays: input.retentionDays, allowedPurposes: purposes }, at });
      return { id, versionId, versionNumber, notice, noticeSha256, allowedPurposes: purposes,
        retentionDays: input.retentionDays, requiresExplicitConsent: true };
    })();
  }

  createMapping(input: { spaceId: string; metricDefinitionId: string; actorUserId: string;
    allowedPurposes: JourneyStagePurpose[]; retentionDays: number; idempotencyKey: string; now?: Date | string }) {
    const keyValue = token(input.idempotencyKey, 'idempotency key'); const keyHash = hmac(keyValue);
    const source = db.prepare(`SELECT definition.id metric_definition_id,definition.journey_definition_id,definition.stage_id,
      version.id metric_definition_version_id,version.content_sha256,version.calculator_kind,version.configuration_json,
      binding.id binding_id,binding.survey_id,binding.collector_id,binding.question_id,question.type question_type,
      question.options_json,question.settings_json
      FROM journey_metric_definitions definition JOIN journey_metric_definition_versions version
        ON version.id=definition.current_version_id AND version.definition_id=definition.id AND version.space_id=definition.space_id
      JOIN journey_metric_bindings binding ON binding.id=version.binding_id AND binding.space_id=version.space_id
      JOIN questions question ON question.id=binding.question_id AND question.survey_id=binding.survey_id
      WHERE definition.id=? AND definition.space_id=? AND definition.state='active' AND definition.target_type='stage'
        AND version.source_kind='survey' AND binding.state='active' AND binding.collector_id IS NOT NULL`)
      .get(input.metricDefinitionId, input.spaceId) as any;
    if (!source || source.question_type !== source.calculator_kind) fail('An active stage-targeted survey metric is required.', 409,
      'JOURNEY_STAGE_SURVEY_MAPPING_SOURCE_INVALID');
    const purposes = [...new Set(input.allowedPurposes)].sort();
    if (!purposes.length || purposes.some((item) => !journeyStagePurposes.includes(item))
      || !Number.isSafeInteger(input.retentionDays) || input.retentionDays < 1 || input.retentionDays > 3650) fail('Mapping policy is invalid.');
    const questionSnapshot = { id: source.question_id, type: source.question_type,
      options: parse(source.options_json, []), settings: parse(source.settings_json, {}) };
    const content = { journeyDefinitionId: source.journey_definition_id, stageId: source.stage_id,
      metricDefinitionId: source.metric_definition_id, metricDefinitionVersionId: source.metric_definition_version_id,
      metricDefinitionVersionSha256: source.content_sha256, bindingId: source.binding_id,
      questionId: source.question_id, questionSchemaSha256: sha(questionSnapshot), calculatorKind: source.calculator_kind,
      calculatorConfiguration: parse(source.configuration_json, {}), surveyIdHmac: hmac(source.survey_id),
      collectorIdHmac: hmac(source.collector_id), allowedPurposes: purposes, retentionDays: input.retentionDays,
      projectionVersion };
    const intent = sha(content); const at = iso(input.now);
    return db.transaction(() => {
      const replay = db.prepare(`SELECT mapping.*,version.id version_id,version.version_number FROM journey_stage_source_mappings mapping
        JOIN journey_stage_source_mapping_versions version ON version.id=mapping.current_version_id
        WHERE mapping.space_id=? AND mapping.idempotency_key_hmac=?`).get(input.spaceId, keyHash) as any;
      if (replay) { if (replay.intent_sha256 !== intent) fail('Idempotency key intent changed.', 409,
        'JOURNEY_STAGE_SURVEY_MAPPING_IDEMPOTENCY_CONFLICT'); return { id: replay.id, versionId: replay.version_id,
        versionNumber: Number(replay.version_number), replayed: true }; }
      if (db.prepare(`SELECT 1 ok FROM journey_stage_source_mappings WHERE space_id=? AND source_kind='survey'
        AND metric_definition_id=?`).get(input.spaceId, input.metricDefinitionId)) fail(
        'This metric already has a governed survey mapping.', 409, 'JOURNEY_STAGE_SURVEY_MAPPING_EXISTS');
      const id = crypto.randomUUID(); const versionId = crypto.randomUUID();
      db.prepare(`INSERT INTO journey_stage_source_mappings
        (id,space_id,source_kind,state,metric_definition_id,revision,current_version_id,idempotency_key_hmac,intent_sha256,
         created_by_user_id,created_at,updated_at)
        VALUES (?,?,'survey','active',?,1,?,?,?,?,?,?)`).run(id, input.spaceId, input.metricDefinitionId,
          versionId, keyHash, intent, input.actorUserId, at, at);
      db.prepare(`INSERT INTO journey_stage_source_mapping_versions
        (id,mapping_id,space_id,version_number,journey_definition_id,stage_id,metric_definition_id,
         metric_definition_version_id,metric_definition_version_sha256,binding_id,question_id,question_schema_sha256,
         calculator_kind,calculator_configuration_json,survey_id_hmac,collector_id_hmac,allowed_purposes_json,
         retention_days,projection_version,content_sha256,created_by_user_id,created_at)
        VALUES (?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(versionId, id, input.spaceId,
          content.journeyDefinitionId, content.stageId, content.metricDefinitionId, content.metricDefinitionVersionId,
          content.metricDefinitionVersionSha256, content.bindingId, content.questionId, content.questionSchemaSha256,
          content.calculatorKind, stable(content.calculatorConfiguration), content.surveyIdHmac, content.collectorIdHmac,
          JSON.stringify(purposes), input.retentionDays, projectionVersion, sha(content), input.actorUserId, at);
      audit({ spaceId: input.spaceId, actorUserId: input.actorUserId, action: 'mapping.created', target: id,
        detail: { metricDefinitionSha256: sha(input.metricDefinitionId), projectionVersion }, at });
      return { id, versionId, versionNumber: 1, replayed: false };
    })();
  }

  publicPolicy(spaceId: string, surveyId: string, collectorId: string) {
    if (!activeMappings(spaceId, surveyId, collectorId).length) return null;
    const row = db.prepare(`SELECT policy.id,version.* FROM journey_stage_survey_policies policy
      JOIN journey_stage_survey_policy_versions version ON version.id=policy.current_version_id
      WHERE policy.space_id=? AND policy.survey_id_hmac=? AND policy.collector_id_hmac=? AND policy.state='active'`)
      .get(spaceId, hmac(surveyId), hmac(collectorId)) as any;
    if (!row) return { configured: false as const };
    return { configured: true as const, policyVersionId: row.current_version_id || row.id,
      notice: row.notice_text, noticeSha256: row.notice_sha256, allowedPurposes: parse(row.allowed_purposes_json, []),
      retentionDays: Number(row.retention_days), requiresExplicitConsent: true };
  }

  recordResponse(input: { spaceId: string; survey: Survey; collector: Collector; response: ResponseRecord;
    governance?: SurveyFeedGovernance; now?: Date | string }) {
    const mappings = activeMappings(input.spaceId, input.survey.id, input.collector.id);
    if (!mappings.length || input.response.status !== 'completed') return { mapped: 0, skipped: true };
    const policy = db.prepare(`SELECT policy.id policy_id,version.* FROM journey_stage_survey_policies policy
      JOIN journey_stage_survey_policy_versions version ON version.id=policy.current_version_id
      WHERE policy.space_id=? AND policy.survey_id_hmac=? AND policy.collector_id_hmac=? AND policy.state='active'`)
      .get(input.spaceId, hmac(input.survey.id), hmac(input.collector.id)) as any;
    if (!policy) fail('This collector requires a configured stage-intelligence privacy notice.', 409,
      'JOURNEY_STAGE_SURVEY_POLICY_REQUIRED');
    const governance = input.governance;
    if (!governance || governance.policyVersionId !== policy.id || governance.noticeAcknowledged !== true) fail(
      'Explicit consent against the current stage-intelligence policy is required.', 409, 'JOURNEY_STAGE_SURVEY_CONSENT_REQUIRED');
    const purposes = [...new Set(governance.purposes)].sort(); const allowed = parse<string[]>(policy.allowed_purposes_json, []);
    if (!purposes.length || purposes.some((purpose) => !allowed.includes(purpose))) fail('Consent purposes exceed the current policy.', 400,
      'JOURNEY_STAGE_SURVEY_PURPOSE_INVALID');
    const at = iso(input.now); const responseHash = hmac(input.response.id); const subjectHash = hmac(input.response.respondentToken);
    const retentionExpiresAt = new Date(Date.parse(at) + Number(policy.retention_days) * 86_400_000).toISOString();
    const sourceSnapshot = sha({ responseId: responseHash, status: input.response.status, completedAt: input.response.completedAt,
      answerKeys: Object.keys(input.response.answers).sort(), collectorId: hmac(input.collector.id) });
    return db.transaction(() => {
      const receiptId = crypto.randomUUID();
      db.prepare(`INSERT INTO journey_stage_survey_governance_receipts
        (id,space_id,policy_version_id,policy_id,response_id_hmac,subject_id_hmac,consent_state,purposes_json,
         notice_sha256,source_snapshot_sha256,retention_expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(receiptId, input.spaceId, policy.id, policy.policy_id, responseHash, subjectHash, governance.consentState,
          JSON.stringify(purposes), policy.notice_sha256, sourceSnapshot, retentionExpiresAt, at);
      let mapped = 0;
      for (const mapping of mappings) {
        const mappingPurposes = parse<string[]>(mapping.allowed_purposes_json, []);
        const effectivePurposes = purposes.filter((purpose) => mappingPurposes.includes(purpose));
        if (governance.consentState !== 'granted' || !effectivePurposes.length) continue;
        const contribution = surveyContribution(mapping, input.response.answers[mapping.question_id]);
        if (!contribution) continue;
        const effectiveExpiry = new Date(Math.min(Date.parse(retentionExpiresAt),
          Date.parse(at) + Number(mapping.retention_days) * 86_400_000)).toISOString();
        const projection = { subjectIdHmac: subjectHash, journeyDefinitionId: mapping.journey_definition_id,
          stageId: mapping.stage_id, metricDefinitionId: mapping.metric_definition_id,
          metricDefinitionVersionId: mapping.metric_definition_version_id,
          metricDefinitionVersionSha256: mapping.metric_definition_version_sha256,
          metricUnit: contribution.unit, value: contribution.value, dimensions: { channel: [input.collector.type] },
          sentiment: null, emotions: [], occurredAt: input.response.completedAt || input.response.startedAt,
          consentState: governance.consentState, purposes: effectivePurposes, retentionExpiresAt: effectiveExpiry,
          sourceVersion: String(mapping.version_number), schemaVersion: mapping.question_schema_sha256,
          projectionVersion: mapping.projection_version };
        const revisionId = crypto.randomUUID();
        db.prepare(`INSERT INTO journey_stage_survey_source_revisions
          (id,space_id,mapping_id,mapping_version_id,governance_receipt_id,external_record_hmac,revision,operation,
           supersedes_revision_id,projection_json,projection_sha256,created_at) VALUES (?,?,?,?,?,?,1,'upsert',NULL,?,?,?)`)
          .run(revisionId, input.spaceId, mapping.mapping_id, mapping.id, receiptId, responseHash, stable(projection), sha(projection), at);
        db.prepare(`INSERT INTO journey_stage_survey_outbox
          (id,space_id,mapping_id,source_revision_id,operation,state,available_at,lease_owner,lease_token,lease_generation,
           lease_expires_at,attempt_count,last_error_code,terminal_at,created_at,updated_at)
           VALUES (?,?,?,?, 'upsert','pending',?,NULL,NULL,0,NULL,0,NULL,NULL,?,?)`)
          .run(crypto.randomUUID(), input.spaceId, mapping.mapping_id, revisionId, at, at, at);
        mapped += 1;
      }
      audit({ spaceId: input.spaceId, action: 'receipt.recorded', target: receiptId,
        detail: { mappedCount: mapped, consentState: governance.consentState, purposeCount: purposes.length }, at });
      return { mapped, skipped: false };
    })();
  }

  enqueueSurveyDeletion(input: { spaceId: string; surveyId: string; actorUserId: string; now?: Date | string }) {
    const at = iso(input.now); const mappings = db.prepare(`SELECT mapping.id FROM journey_stage_source_mappings mapping
      JOIN journey_stage_source_mapping_versions version ON version.id=mapping.current_version_id
      WHERE mapping.space_id=? AND mapping.state='active' AND version.survey_id_hmac=?`).all(input.spaceId, hmac(input.surveyId)) as any[];
    for (const mapping of mappings) db.prepare(`INSERT INTO journey_stage_survey_outbox
      (id,space_id,mapping_id,source_revision_id,operation,state,available_at,lease_owner,lease_token,lease_generation,
       lease_expires_at,attempt_count,last_error_code,terminal_at,created_at,updated_at)
       VALUES (?,?,?,NULL,'delete_scope','pending',?,NULL,NULL,0,NULL,0,NULL,NULL,?,?)`)
      .run(crypto.randomUUID(), input.spaceId, mapping.id, at, at, at);
    if (mappings.length) audit({ spaceId: input.spaceId, actorUserId: input.actorUserId, action: 'scope_delete.enqueued',
      target: input.surveyId, detail: { mappingCount: mappings.length }, at });
    return { enqueued: mappings.length };
  }

  claim(input: { owner: string; now?: Date | string; leaseMs?: number }) {
    const owner = token(input.owner, 'lease owner', 128); const at = iso(input.now);
    const leaseMs = Math.max(5_000, Math.min(300_000, input.leaseMs || 30_000));
    return db.transaction(() => {
      const expired = db.prepare(`SELECT id,space_id,lease_generation,attempt_count FROM journey_stage_survey_outbox
        WHERE state='leased' AND lease_expires_at<=? ORDER BY lease_expires_at,id LIMIT 100`).all(at) as any[];
      for (const row of expired) {
        const terminal = Number(row.attempt_count) >= 8;
        const changed = db.prepare(`UPDATE journey_stage_survey_outbox SET state=?,available_at=?,lease_owner=NULL,lease_token=NULL,
          lease_expires_at=NULL,last_error_code='JOURNEY_STAGE_SURVEY_LEASE_EXPIRED',terminal_at=?,updated_at=?
          WHERE id=? AND state='leased' AND lease_generation=?`).run(terminal ? 'dead_letter' : 'retry_wait', at,
            terminal ? at : null, at, row.id, row.lease_generation).changes;
        if (changed) db.prepare(`INSERT INTO journey_stage_survey_outbox_attempts
          (id,outbox_id,space_id,lease_generation,attempt_number,outcome,error_code,detail_sha256,created_at)
          VALUES (?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), row.id, row.space_id, row.lease_generation,
            row.attempt_count, terminal ? 'dead_letter' : 'lease_expired', 'JOURNEY_STAGE_SURVEY_LEASE_EXPIRED',
            sha({ terminal }), at);
      }
      const lock = db.provider === 'postgres' ? ' FOR UPDATE SKIP LOCKED' : '';
      const row = db.prepare(`SELECT * FROM journey_stage_survey_outbox WHERE state IN ('pending','retry_wait')
        AND available_at<=? ORDER BY available_at,created_at,id LIMIT 1${lock}`).get(at) as any;
      if (!row) return null;
      const leaseToken = crypto.randomBytes(24).toString('hex'); const generation = Number(row.lease_generation) + 1;
      const changed = db.prepare(`UPDATE journey_stage_survey_outbox SET state='leased',lease_owner=?,lease_token=?,
        lease_generation=?,lease_expires_at=?,attempt_count=attempt_count+1,last_error_code=NULL,updated_at=?
        WHERE id=? AND state IN ('pending','retry_wait') AND lease_generation=?`).run(owner, leaseToken, generation,
          new Date(Date.parse(at) + leaseMs).toISOString(), at, row.id, row.lease_generation).changes;
      return changed ? db.prepare('SELECT * FROM journey_stage_survey_outbox WHERE id=?').get(row.id) as any : null;
    })();
  }

  execute(claim: any, now: Date | string = new Date()) {
    const at = iso(now);
    return db.transaction(() => {
      const lock = db.provider === 'postgres' ? ' FOR UPDATE' : '';
      const current = db.prepare(`SELECT * FROM journey_stage_survey_outbox WHERE id=? AND space_id=?${lock}`)
        .get(claim.id, claim.space_id) as any;
      if (!current || current.state !== 'leased' || current.lease_owner !== claim.lease_owner
        || current.lease_token !== claim.lease_token || Number(current.lease_generation) !== Number(claim.lease_generation)) {
        fail('Survey feed lease was lost.', 409, 'JOURNEY_STAGE_SURVEY_LEASE_LOST');
      }
      let complete = true; let applied = 0;
      if (current.operation === 'upsert' || current.operation === 'delete') {
        const revision = db.prepare(`SELECT revision.id source_revision_id,revision.space_id,revision.mapping_id,
          revision.mapping_version_id,revision.external_record_hmac,revision.revision source_revision_number,
          revision.operation,revision.projection_json,revision.projection_sha256,
          mapping_version.version_number mapping_version_number,mapping_version.content_sha256 mapping_version_sha256
          FROM journey_stage_survey_source_revisions revision
          JOIN journey_stage_source_mapping_versions mapping_version ON mapping_version.id=revision.mapping_version_id
          WHERE revision.id=? AND revision.space_id=?`).get(current.source_revision_id, current.space_id) as any;
        if (!revision) fail('Survey feed revision is unavailable.', 409, 'JOURNEY_STAGE_SURVEY_REVISION_MISSING');
        applied = insertRuntimeFact({ outboxId: current.id, revision, at }) ? 1 : 0;
      } else {
        const result = tombstoneMappingFacts(current.space_id, current.mapping_id, current.id, at, 100);
        applied = result.applied; complete = result.complete;
      }
      if (complete) {
        const changed = db.prepare(`UPDATE journey_stage_survey_outbox SET state='completed',lease_owner=NULL,lease_token=NULL,
          lease_expires_at=NULL,terminal_at=?,updated_at=? WHERE id=? AND state='leased' AND lease_owner=? AND lease_token=?
          AND lease_generation=?`).run(at, at, current.id, current.lease_owner, current.lease_token, current.lease_generation).changes;
        if (!changed) fail('Survey feed lease was lost.', 409, 'JOURNEY_STAGE_SURVEY_LEASE_LOST');
      } else db.prepare(`UPDATE journey_stage_survey_outbox SET state='pending',available_at=?,lease_owner=NULL,lease_token=NULL,
        lease_expires_at=NULL,updated_at=? WHERE id=? AND state='leased' AND lease_token=? AND lease_generation=?`)
        .run(at, at, current.id, current.lease_token, current.lease_generation);
      db.prepare(`INSERT INTO journey_stage_survey_outbox_attempts
        (id,outbox_id,space_id,lease_generation,attempt_number,outcome,error_code,detail_sha256,created_at)
        VALUES (?,?,?,?,?,'succeeded',NULL,?,?)`).run(crypto.randomUUID(), current.id, current.space_id,
          current.lease_generation, current.attempt_count, sha({ applied, complete }), at);
      db.prepare(`INSERT INTO journey_stage_survey_checkpoints
        (mapping_id,space_id,last_external_record_hmac,completed_revision_count,updated_at) VALUES (?,?,NULL,?,?)
        ON CONFLICT(mapping_id,space_id) DO UPDATE SET completed_revision_count=journey_stage_survey_checkpoints.completed_revision_count+excluded.completed_revision_count,
          updated_at=excluded.updated_at`).run(current.mapping_id, current.space_id, applied, at);
      audit({ spaceId: current.space_id, action: 'outbox.completed', target: current.id,
        detail: { operation: current.operation, appliedCount: applied, complete }, at });
      return { complete, applied };
    })();
  }

  fail(claim: any, errorCode: string, now: Date | string = new Date()) {
    const at = iso(now); const code = token(errorCode, 'error code', 100);
    return db.transaction(() => {
      const row = db.prepare(`SELECT * FROM journey_stage_survey_outbox WHERE id=? AND space_id=? AND state='leased'
        AND lease_owner=? AND lease_token=? AND lease_generation=?`).get(claim.id, claim.space_id, claim.lease_owner,
          claim.lease_token, claim.lease_generation) as any;
      if (!row) return false; const terminal = Number(row.attempt_count) >= 8;
      const available = new Date(Date.parse(at) + Math.min(3_600_000, 15_000 * (2 ** Math.max(0, Number(row.attempt_count) - 1)))).toISOString();
      db.prepare(`UPDATE journey_stage_survey_outbox SET state=?,available_at=?,lease_owner=NULL,lease_token=NULL,
        lease_expires_at=NULL,last_error_code=?,terminal_at=?,updated_at=? WHERE id=? AND state='leased' AND lease_token=?
        AND lease_generation=?`).run(terminal ? 'dead_letter' : 'retry_wait', available, code, terminal ? at : null,
          at, row.id, row.lease_token, row.lease_generation);
      db.prepare(`INSERT INTO journey_stage_survey_outbox_attempts
        (id,outbox_id,space_id,lease_generation,attempt_number,outcome,error_code,detail_sha256,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), row.id, row.space_id, row.lease_generation,
          row.attempt_count, terminal ? 'dead_letter' : 'retry_wait', code, sha({ code, terminal }), at);
      audit({ spaceId: row.space_id, action: 'outbox.failed', target: row.id,
        detail: { errorCode: code, terminal }, at }); return true;
    })();
  }

  purgeExpired(input: { spaceId: string; now?: Date | string; limit?: number }) {
    const at = iso(input.now); const limit = Math.max(1, Math.min(500, input.limit || 100));
    return db.transaction(() => {
      if (db.provider === 'postgres') db.prepare(
        `SELECT set_config('seemplify.survey_feed_retention_purge','on',true)`).get();
      const receipts = db.prepare(`SELECT id FROM journey_stage_survey_governance_receipts
        WHERE space_id=? AND retention_expires_at<=? ORDER BY retention_expires_at,id LIMIT ?`)
        .all(input.spaceId, at, limit) as Array<{ id: string }>;
      if (!receipts.length) return { purgedCount: 0, hasMore: false };
      const placeholders = receipts.map(() => '?').join(','); const ids = receipts.map((row) => row.id);
      db.prepare(`DELETE FROM journey_stage_survey_outbox_attempts WHERE outbox_id IN (
        SELECT outbox.id FROM journey_stage_survey_outbox outbox JOIN journey_stage_survey_source_revisions revision
          ON revision.id=outbox.source_revision_id WHERE revision.governance_receipt_id IN (${placeholders}))`).run(...ids);
      db.prepare(`DELETE FROM journey_stage_survey_outbox WHERE source_revision_id IN (
        SELECT id FROM journey_stage_survey_source_revisions WHERE governance_receipt_id IN (${placeholders}))`).run(...ids);
      db.prepare(`DELETE FROM journey_stage_survey_source_revisions WHERE governance_receipt_id IN (${placeholders})`).run(...ids);
      db.prepare(`DELETE FROM journey_stage_survey_governance_receipts WHERE id IN (${placeholders})`).run(...ids);
      audit({ spaceId: input.spaceId, action: 'retention.purged', target: input.spaceId,
        detail: { purgedCount: receipts.length }, at });
      const more = db.prepare(`SELECT 1 ok FROM journey_stage_survey_governance_receipts
        WHERE space_id=? AND retention_expires_at<=? LIMIT 1`).get(input.spaceId, at);
      return { purgedCount: receipts.length, hasMore: Boolean(more) };
    })();
  }
}

function insertRuntimeFact(input: { outboxId: string; revision: any; at: string }) {
  const projection = parse<Record<string, any>>(input.revision.projection_json, {});
  const purposes = Array.isArray(projection.purposes) ? projection.purposes : [];
  if (!/^[a-f0-9]{64}$/u.test(projection.subjectIdHmac || '') || !purposes.length
    || purposes.some((purpose) => !journeyStagePurposes.includes(purpose))
    || projection.projectionVersion !== projectionVersion
    || projection.sourceVersion !== String(input.revision.mapping_version_number)
    || input.revision.mapping_version_sha256 === undefined
    || sha(projection) !== input.revision.projection_sha256) {
    fail('Stored survey projection is invalid.', 409, 'JOURNEY_STAGE_SURVEY_PROJECTION_INVALID');
  }
  if (Date.parse(projection.retentionExpiresAt) <= Date.parse(input.at)) return false;
  const sourceIdHmac = hmac(input.revision.mapping_id); const external = input.revision.external_record_hmac;
  const prior = db.prepare(`SELECT * FROM journey_stage_intelligence_facts WHERE space_id=? AND metric_definition_id=?
    AND source_id_hmac=? AND external_record_hmac=? ORDER BY revision DESC,id LIMIT 1`)
    .get(input.revision.space_id, projection.metricDefinitionId, sourceIdHmac, external) as any;
  if (prior && Number(prior.revision) >= Number(input.revision.source_revision_number)) return false;
  if (Number(input.revision.source_revision_number) !== Number(prior?.revision || 0) + 1) fail('Survey fact revision is not consecutive.', 409,
    'JOURNEY_STAGE_SURVEY_REVISION_CONFLICT');
  const factId = crypto.randomUUID(); const intent = sha({ outboxId: input.outboxId, projectionSha256: input.revision.projection_sha256 });
  db.prepare(`INSERT INTO journey_stage_intelligence_facts
    (id,space_id,journey_definition_id,source_type,source_id_hmac,external_record_hmac,source_version,schema_version,
     projection_version,revision,operation,supersedes_fact_id,subject_id_hmac,stage_id,metric_definition_id,
     metric_definition_version_id,metric_definition_version_sha256,metric_unit,value,dimensions_json,sentiment,emotions_json,
     occurred_at,consent_state,purposes_json,retention_expires_at,idempotency_key_hmac,intent_sha256,created_at)
     VALUES (?,?,?,'survey',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(factId, input.revision.space_id,
      projection.journeyDefinitionId, sourceIdHmac, external, projection.sourceVersion, projection.schemaVersion,
      projection.projectionVersion, input.revision.source_revision_number, input.revision.operation, prior?.id || null,
      projection.subjectIdHmac, projection.stageId, projection.metricDefinitionId, projection.metricDefinitionVersionId,
      projection.metricDefinitionVersionSha256, projection.metricUnit, input.revision.operation === 'delete' ? null : projection.value,
      JSON.stringify(projection.dimensions || {}), projection.sentiment, JSON.stringify(projection.emotions || []),
      projection.occurredAt, projection.consentState, JSON.stringify(projection.purposes), projection.retentionExpiresAt,
      hmac(input.outboxId), intent, input.at);
  factAudit(input.revision.space_id, factId, input.revision.operation, projection.metricDefinitionId,
    Number(input.revision.source_revision_number), input.at);
  return true;
}

function tombstoneMappingFacts(spaceId: string, mappingId: string, outboxId: string, at: string, limit: number) {
  const sourceIdHmac = hmac(mappingId);
  const rows = db.prepare(`SELECT fact.* FROM journey_stage_intelligence_facts fact
    WHERE fact.space_id=? AND fact.source_id_hmac=? AND fact.operation='upsert'
      AND fact.retention_expires_at>?
      AND NOT EXISTS (SELECT 1 FROM journey_stage_intelligence_facts newer WHERE newer.space_id=fact.space_id
        AND newer.metric_definition_id=fact.metric_definition_id AND newer.source_id_hmac=fact.source_id_hmac
        AND newer.external_record_hmac=fact.external_record_hmac AND newer.revision>fact.revision)
    ORDER BY fact.external_record_hmac LIMIT ?`).all(spaceId, sourceIdHmac, at, limit + 1) as any[];
  for (const row of rows.slice(0, limit)) {
    const id = crypto.randomUUID(); const revision = Number(row.revision) + 1;
    db.prepare(`INSERT INTO journey_stage_intelligence_facts
      (id,space_id,journey_definition_id,source_type,source_id_hmac,external_record_hmac,source_version,schema_version,
       projection_version,revision,operation,supersedes_fact_id,subject_id_hmac,stage_id,metric_definition_id,
       metric_definition_version_id,metric_definition_version_sha256,metric_unit,value,dimensions_json,sentiment,emotions_json,
       occurred_at,consent_state,purposes_json,retention_expires_at,idempotency_key_hmac,intent_sha256,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,'delete',?,?,?,?,?,?,?,NULL,?,?,?,?,?,?,?,?,?,?)`).run(id, row.space_id,
        row.journey_definition_id, row.source_type, row.source_id_hmac, row.external_record_hmac, row.source_version,
        row.schema_version, row.projection_version, revision, row.id, row.subject_id_hmac, row.stage_id,
        row.metric_definition_id, row.metric_definition_version_id, row.metric_definition_version_sha256, row.metric_unit,
        row.dimensions_json, row.sentiment, row.emotions_json, row.occurred_at, row.consent_state, row.purposes_json,
        row.retention_expires_at, hmac(`${outboxId}:${row.id}`), sha({ outboxId, priorFactId: row.id, revision }), at);
    factAudit(row.space_id, id, 'delete', row.metric_definition_id, revision, at);
  }
  return { applied: Math.min(rows.length, limit), complete: rows.length <= limit };
}

function surveyContribution(mapping: MappingRow, raw: unknown) {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  const configuration = parse<Record<string, any>>(mapping.calculator_configuration_json, {});
  const scale = configuration.scale;
  if (!scale || raw < Number(scale.minimum) || raw > Number(scale.maximum)) return null;
  if (mapping.calculator_kind === 'nps') {
    const formula = configuration.formula || {}; return { value: raw >= Number(formula.promoterMinimum) ? 100
      : raw <= Number(formula.detractorMaximum) ? -100 : 0, unit: 'score' };
  }
  if (configuration.formula?.kind === 'mean') return { value: raw, unit: 'score' };
  const favourable = configuration.favourable || {}; const yes = favourable.operator === 'gte'
    ? raw >= Number(favourable.threshold) : raw <= Number(favourable.threshold);
  return { value: yes ? 100 : 0, unit: 'percent' };
}

export const journeyStageSurveyFeedRepository = new JourneyStageSurveyFeedRepository();
