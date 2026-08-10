import crypto from 'node:crypto';
import fs from 'node:fs';
import { config } from './config.js';
import { db as defaultDb } from './database.js';
import type { DatabaseRuntime } from './databaseAdapter.js';
import { authoriseJourneyNativeMetricSource } from './journeyNativeMetricAdapters.js';
import { parseJourneyNativeMetricSource } from './journeyNativeMetricSources.js';
import type { JourneyStagePurpose } from './journeyStageIntelligence.js';

const projectionVersion = 'ticket-stage-feed/v1';
const maximumMappingsPerSpace = 1_000;
const maximumPrivacyBatch = 500;
const purposes = ['service_improvement', 'analytics', 'research'] as const;
type Purpose = typeof purposes[number];
type IdentityKind = 'anonymous_id' | 'authenticated_user_id' | 'external_user_id';

export class JourneyOperationalStageFeedError extends Error {
  constructor(message: string, public status = 400, public code = 'JOURNEY_OPERATIONAL_FEED_INVALID') {
    super(message); this.name = 'JourneyOperationalStageFeedError';
  }
}

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
function parse<T>(value: unknown, fallback: T): T {
  if (value && typeof value === 'object') return value as T;
  try { return typeof value === 'string' ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}
function iso(value: Date | string = new Date()) {
  const parsed = new Date(value); if (!Number.isFinite(parsed.getTime())) fail('Timestamp is invalid.'); return parsed.toISOString();
}
function fail(message: string, status = 400, code = 'JOURNEY_OPERATIONAL_FEED_INVALID'): never {
  throw new JourneyOperationalStageFeedError(message, status, code);
}
function token(value: unknown, label: string, maximum = 200) {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > maximum) fail(`${label} is invalid.`);
  return value;
}
function tableAvailable(runtime: DatabaseRuntime, name: string) {
  if (runtime.provider === 'sqlite') return Boolean(runtime.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name=?").get(name));
  return Boolean((runtime.prepare('SELECT to_regclass(?) present').get(name) as { present?: string } | undefined)?.present);
}

function ensureSqliteSchema(runtime: DatabaseRuntime) {
  if (runtime.provider !== 'sqlite') return;
  runtime.exec(`
    CREATE TABLE IF NOT EXISTS journey_operational_stage_mappings(id TEXT PRIMARY KEY,space_id TEXT NOT NULL,source_kind TEXT NOT NULL,
      state TEXT NOT NULL,metric_definition_id TEXT NOT NULL,revision INTEGER NOT NULL,current_version_id TEXT,idempotency_key_hmac TEXT NOT NULL,
      intent_sha256 TEXT NOT NULL,created_by_user_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      UNIQUE(space_id,idempotency_key_hmac),UNIQUE(space_id,source_kind,metric_definition_id));
    CREATE TABLE IF NOT EXISTS journey_operational_stage_mapping_versions(id TEXT PRIMARY KEY,mapping_id TEXT NOT NULL,space_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,journey_definition_id TEXT NOT NULL,stage_id TEXT NOT NULL,metric_definition_id TEXT NOT NULL,
      metric_definition_version_id TEXT NOT NULL,metric_definition_version_sha256 TEXT NOT NULL,source_survey_hmacs_json TEXT NOT NULL,
      event_map_json TEXT NOT NULL,identity_identifier_kind TEXT,identity_identifier_namespace TEXT,allowed_purposes_json TEXT NOT NULL,
      retention_days INTEGER NOT NULL,projection_version TEXT NOT NULL,content_sha256 TEXT NOT NULL,created_by_user_id TEXT,created_at TEXT NOT NULL,
      UNIQUE(mapping_id,version_number));
    CREATE TABLE IF NOT EXISTS journey_operational_stage_source_revisions(id TEXT PRIMARY KEY,space_id TEXT NOT NULL,mapping_id TEXT NOT NULL,
      mapping_version_id TEXT NOT NULL,governance_receipt_id TEXT NOT NULL,external_record_hmac TEXT NOT NULL,ticket_id_hmac TEXT NOT NULL,
      response_id_hmac TEXT NOT NULL,profile_id TEXT,revision INTEGER NOT NULL,operation TEXT NOT NULL,supersedes_revision_id TEXT,
      projection_json TEXT NOT NULL,projection_sha256 TEXT NOT NULL,retention_expires_at TEXT NOT NULL,created_at TEXT NOT NULL,
      UNIQUE(space_id,mapping_id,external_record_hmac,revision));
    CREATE TABLE IF NOT EXISTS journey_operational_stage_outbox(id TEXT PRIMARY KEY,space_id TEXT NOT NULL,mapping_id TEXT NOT NULL,
      source_revision_id TEXT NOT NULL UNIQUE,state TEXT NOT NULL,available_at TEXT NOT NULL,lease_owner TEXT,lease_token TEXT,
      lease_generation INTEGER NOT NULL DEFAULT 0,lease_expires_at TEXT,attempt_count INTEGER NOT NULL DEFAULT 0,last_error_code TEXT,
      terminal_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS journey_operational_stage_outbox_claim ON journey_operational_stage_outbox(state,available_at,lease_expires_at,created_at,id);
    CREATE TABLE IF NOT EXISTS journey_operational_stage_outbox_attempts(id TEXT PRIMARY KEY,outbox_id TEXT NOT NULL,space_id TEXT NOT NULL,
      lease_generation INTEGER NOT NULL,attempt_number INTEGER NOT NULL,outcome TEXT NOT NULL,error_code TEXT,detail_sha256 TEXT NOT NULL,
      created_at TEXT NOT NULL,UNIQUE(outbox_id,lease_generation));
    CREATE TABLE IF NOT EXISTS journey_operational_stage_checkpoints(mapping_id TEXT NOT NULL,space_id TEXT NOT NULL,last_external_record_hmac TEXT,
      completed_revision_count INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL,PRIMARY KEY(mapping_id,space_id));
    CREATE TABLE IF NOT EXISTS journey_operational_stage_tombstones(id TEXT PRIMARY KEY,space_id TEXT NOT NULL,mapping_id TEXT NOT NULL,
      external_record_hmac TEXT NOT NULL,deletion_revision INTEGER NOT NULL,reason_code TEXT NOT NULL,created_at TEXT NOT NULL,
      UNIQUE(space_id,mapping_id,external_record_hmac));
    CREATE TABLE IF NOT EXISTS journey_operational_timeline_revisions(id TEXT PRIMARY KEY,space_id TEXT NOT NULL,source_revision_id TEXT NOT NULL UNIQUE,
      profile_id TEXT NOT NULL,canonical_profile_id TEXT NOT NULL,external_record_hmac TEXT NOT NULL,revision INTEGER NOT NULL,operation TEXT NOT NULL,
      supersedes_timeline_revision_id TEXT,event_kind TEXT NOT NULL,occurred_at TEXT NOT NULL,purposes_json TEXT NOT NULL,
      retention_expires_at TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(space_id,profile_id,external_record_hmac,revision));
    CREATE INDEX IF NOT EXISTS journey_operational_timeline_profile ON journey_operational_timeline_revisions(space_id,profile_id,occurred_at DESC,id);
    CREATE TABLE IF NOT EXISTS journey_operational_stage_feed_audit(id TEXT PRIMARY KEY,space_id TEXT NOT NULL,actor_user_id TEXT,action TEXT NOT NULL,
      target_sha256 TEXT NOT NULL,detail_json TEXT NOT NULL,detail_sha256 TEXT NOT NULL,created_at TEXT NOT NULL);
  `);
}

function audit(runtime: DatabaseRuntime, input: { spaceId: string; actorUserId?: string | null; action: string; target: string;
  detail?: Record<string, unknown>; at: string }) {
  const detail = input.detail || {};
  runtime.prepare(`INSERT INTO journey_operational_stage_feed_audit
    (id,space_id,actor_user_id,action,target_sha256,detail_json,detail_sha256,created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(crypto.randomUUID(), input.spaceId, input.actorUserId || null, input.action, sha(input.target), stable(detail), sha(detail), input.at);
}

function eventMap(configuration: Record<string, unknown>) {
  const kind = String(configuration.kind || '');
  if (kind === 'ticket_rate') return { created: String(configuration.ticketEventType || '') };
  if (kind === 'repeat_contact_rate') {
    const event = String(configuration.contactEventType || ''); return { created: event, reopened: event };
  }
  if (kind === 'recovery_rate') return {
    created: String(configuration.eligibleEventType || ''), closed: String(configuration.successEventType || '')
  };
  fail('Only authoritative service-recovery operational measures can be mapped.', 409,
    'JOURNEY_OPERATIONAL_FEED_MEASURE_UNSUPPORTED');
}

function canonicalProfile(runtime: DatabaseRuntime, spaceId: string, profileId: string) {
  let current = profileId; const seen = new Set<string>();
  while (!seen.has(current)) {
    seen.add(current);
    const row = runtime.prepare(`SELECT canonical_target_profile_id FROM journey_identity_merges
      WHERE space_id=? AND source_profile_id=? AND active=TRUE ORDER BY merged_at DESC LIMIT 1`).get(spaceId, current) as any;
    if (!row?.canonical_target_profile_id) return current;
    current = String(row.canonical_target_profile_id);
  }
  fail('Identity merge chain is cyclic.', 409, 'JOURNEY_OPERATIONAL_FEED_IDENTITY_INVALID');
}

export class JourneyOperationalStageFeedRepository {
  constructor(private readonly runtime: DatabaseRuntime = defaultDb) { ensureSqliteSchema(runtime); }

  available() { return tableAvailable(this.runtime, 'journey_operational_stage_mappings'); }

  assertSocialUnsupported() {
    fail('Social stage feeds require an immutable classifier version plus consent, purpose and retention provenance. Current social_mentions records do not provide them.',
      409, 'JOURNEY_OPERATIONAL_FEED_SOCIAL_UNGOVERNED');
  }

  createTicketMapping(input: { spaceId: string; metricDefinitionId: string; actorUserId: string;
    allowedPurposes: JourneyStagePurpose[]; retentionDays: number; idempotencyKey: string;
    identity?: { kind: IdentityKind; namespace: string } | null; now?: Date | string }) {
    if (!this.available()) fail('Runtime 52 is not active.', 503, 'JOURNEY_OPERATIONAL_FEED_RUNTIME_UNAVAILABLE');
    const idempotency = hmac(token(input.idempotencyKey, 'idempotency key'));
    const allowed = [...new Set(input.allowedPurposes)].sort() as Purpose[];
    if (!allowed.length || allowed.some((entry) => !purposes.includes(entry)) || !Number.isSafeInteger(input.retentionDays)
      || input.retentionDays < 1 || input.retentionDays > 3650) fail('Mapping governance is invalid.');
    if (input.identity && !['anonymous_id', 'authenticated_user_id', 'external_user_id'].includes(input.identity.kind)) {
      fail('Identity identifier kind is invalid.');
    }
    const identity = input.identity ? {
      kind: input.identity.kind,
      namespace: token(input.identity.namespace, 'identity namespace', 160)
    } : null;
    const row = this.runtime.prepare(`SELECT definition.*,version.id version_id,version.version_number,version.content_sha256,
      version.configuration_json FROM journey_metric_definitions definition
      JOIN journey_metric_definition_versions version ON version.id=definition.current_version_id
        AND version.definition_id=definition.id AND version.space_id=definition.space_id
      WHERE definition.id=? AND definition.space_id=? AND definition.state='active' AND definition.target_type='stage'
        AND version.source_kind='operational_import' AND version.calculator_kind='operational'`)
      .get(input.metricDefinitionId, input.spaceId) as any;
    if (!row?.stage_id) fail('An active stage-targeted operational measure is required.', 409,
      'JOURNEY_OPERATIONAL_FEED_MEASURE_INVALID');
    const configuration = parse<Record<string, unknown>>(row.configuration_json, {});
    const native = parseJourneyNativeMetricSource(configuration.nativeSource);
    if (!native || native.adapter !== 'service_recovery_tickets') {
      if (native?.adapter === 'social_mentions') this.assertSocialUnsupported();
      fail('The metric must use the authoritative service-recovery source.', 409,
        'JOURNEY_OPERATIONAL_FEED_SOURCE_UNSUPPORTED');
    }
    if (native.stageAssociation?.stageId !== row.stage_id) fail('The metric does not have an exact governed stage association.', 409,
      'JOURNEY_OPERATIONAL_FEED_STAGE_UNGOVERNED');
    authoriseJourneyNativeMetricSource({ spaceId: input.spaceId, journeyDefinitionId: row.journey_definition_id, source: native });
    const surveyHashes = native.sourceIds.map(hmac).sort();
    for (const surveyId of native.sourceIds) {
      const governed = this.runtime.prepare(`SELECT 1 ok FROM surveys survey
        JOIN journey_stage_survey_policies policy ON policy.space_id=survey.space_id AND policy.survey_id_hmac=? AND policy.state='active'
        JOIN journey_stage_source_mapping_versions survey_mapping ON survey_mapping.survey_id_hmac=?
        JOIN journey_stage_source_mappings source_mapping ON source_mapping.id=survey_mapping.mapping_id
          AND source_mapping.space_id=survey_mapping.space_id AND source_mapping.state='active'
        WHERE survey.id=? AND survey.space_id=? LIMIT 1`).get(hmac(surveyId), hmac(surveyId), surveyId, input.spaceId);
      if (!governed) fail('Every ticket survey requires an active Runtime43 governance policy and mapping.', 409,
        'JOURNEY_OPERATIONAL_FEED_SURVEY_UNGOVERNED');
    }
    const events = eventMap(configuration);
    if (Object.values(events).some((entry) => !entry || entry.length > 128)) fail('The metric event vocabulary is invalid.', 409,
      'JOURNEY_OPERATIONAL_FEED_EVENT_MAP_INVALID');
    const content = { journeyDefinitionId: row.journey_definition_id, stageId: row.stage_id,
      metricDefinitionId: row.id, metricDefinitionVersionId: row.version_id,
      metricDefinitionVersionSha256: row.content_sha256, sourceSurveyHmacs: surveyHashes, eventMap: events,
      identity, allowedPurposes: allowed, retentionDays: input.retentionDays, projectionVersion };
    const intent = sha(content); const at = iso(input.now);
    return this.runtime.transaction(() => {
      const replay = this.runtime.prepare(`SELECT mapping.id,version.id version_id,version.version_number,mapping.intent_sha256
        FROM journey_operational_stage_mappings mapping JOIN journey_operational_stage_mapping_versions version
          ON version.id=mapping.current_version_id WHERE mapping.space_id=? AND mapping.idempotency_key_hmac=?`)
        .get(input.spaceId, idempotency) as any;
      if (replay) {
        if (replay.intent_sha256 !== intent) fail('Idempotency key intent changed.', 409,
          'JOURNEY_OPERATIONAL_FEED_IDEMPOTENCY_CONFLICT');
        return { id: replay.id, versionId: replay.version_id, versionNumber: Number(replay.version_number), replayed: true };
      }
      const mappingCount = Number((this.runtime.prepare(`SELECT COUNT(*) count FROM journey_operational_stage_mappings
        WHERE space_id=?`).get(input.spaceId) as any)?.count || 0);
      if (mappingCount >= maximumMappingsPerSpace) fail('Operational mapping quota reached.', 409,
        'JOURNEY_OPERATIONAL_FEED_MAPPING_QUOTA_REACHED');
      const id = crypto.randomUUID(); const versionId = crypto.randomUUID();
      this.runtime.prepare(`INSERT INTO journey_operational_stage_mappings
        (id,space_id,source_kind,state,metric_definition_id,revision,current_version_id,idempotency_key_hmac,intent_sha256,
         created_by_user_id,created_at,updated_at) VALUES (?,?,'service_recovery_ticket','active',?,1,?,?,?,?,?,?)`)
        .run(id, input.spaceId, row.id, versionId, idempotency, intent, input.actorUserId, at, at);
      this.runtime.prepare(`INSERT INTO journey_operational_stage_mapping_versions
        (id,mapping_id,space_id,version_number,journey_definition_id,stage_id,metric_definition_id,metric_definition_version_id,
         metric_definition_version_sha256,source_survey_hmacs_json,event_map_json,identity_identifier_kind,
         identity_identifier_namespace,allowed_purposes_json,retention_days,projection_version,content_sha256,created_by_user_id,created_at)
         VALUES (?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(versionId, id, input.spaceId, row.journey_definition_id,
          row.stage_id, row.id, row.version_id, row.content_sha256, JSON.stringify(surveyHashes), stable(events), identity?.kind || null,
          identity?.namespace || null, JSON.stringify(allowed), input.retentionDays, projectionVersion, sha(content), input.actorUserId, at);
      audit(this.runtime, { spaceId: input.spaceId, actorUserId: input.actorUserId, action: 'mapping.created', target: id,
        detail: { metricDefinitionSha256: sha(row.id), sourceCount: surveyHashes.length, projectionVersion,
          identityBridgeConfigured: Boolean(identity) }, at });
      return { id, versionId, versionNumber: 1, replayed: false };
    })();
  }

  listTicketMappings(spaceId: string) {
    if (!this.available()) return [];
    return (this.runtime.prepare(`SELECT mapping.id,mapping.metric_definition_id,mapping.state,mapping.revision,
      version.id version_id,version.version_number,version.journey_definition_id,version.stage_id,
      version.metric_definition_version_id,version.metric_definition_version_sha256,version.identity_identifier_kind,
      version.identity_identifier_namespace,version.allowed_purposes_json,version.retention_days,version.projection_version,
      version.content_sha256,version.created_at FROM journey_operational_stage_mappings mapping
      JOIN journey_operational_stage_mapping_versions version ON version.id=mapping.current_version_id
        AND version.mapping_id=mapping.id AND version.space_id=mapping.space_id
      WHERE mapping.space_id=? ORDER BY mapping.state,mapping.updated_at DESC,mapping.id`).all(spaceId) as any[]).map((row) => ({
        id: row.id, metricDefinitionId: row.metric_definition_id, state: row.state, revision: Number(row.revision),
        version: { id: row.version_id, versionNumber: Number(row.version_number), journeyDefinitionId: row.journey_definition_id,
          stageId: row.stage_id, metricDefinitionVersionId: row.metric_definition_version_id,
          metricDefinitionVersionSha256: row.metric_definition_version_sha256,
          identity: row.identity_identifier_kind ? { kind: row.identity_identifier_kind,
            namespace: row.identity_identifier_namespace } : null,
          allowedPurposes: parse<string[]>(row.allowed_purposes_json, []), retentionDays: Number(row.retention_days),
          projectionVersion: row.projection_version, contentSha256: row.content_sha256, createdAt: iso(row.created_at) } }));
  }

  retireTicketMapping(input: { spaceId: string; mappingId: string; actorUserId: string; expectedRevision: number;
    now?: Date | string }) {
    if (!this.available()) fail('Runtime 52 is not active.', 503, 'JOURNEY_OPERATIONAL_FEED_RUNTIME_UNAVAILABLE');
    const at = iso(input.now); return this.runtime.transaction(() => {
      const row = this.runtime.prepare(`SELECT id,state,revision FROM journey_operational_stage_mappings
        WHERE id=? AND space_id=?`).get(input.mappingId, input.spaceId) as any;
      if (!row) fail('Operational feed mapping not found.', 404, 'JOURNEY_OPERATIONAL_FEED_MAPPING_NOT_FOUND');
      if (row.state === 'retired') return { mappingId: row.id, state: 'retired' as const, revision: Number(row.revision), replayed: true };
      if (Number(row.revision) !== input.expectedRevision) fail('Operational feed mapping changed.', 409,
        'JOURNEY_OPERATIONAL_FEED_MAPPING_CONFLICT');
      const changed = this.runtime.prepare(`UPDATE journey_operational_stage_mappings SET state='retired',revision=revision+1,
        updated_at=? WHERE id=? AND space_id=? AND state='active' AND revision=?`).run(at,input.mappingId,input.spaceId,
          input.expectedRevision).changes;
      if (!changed) fail('Operational feed mapping changed.', 409, 'JOURNEY_OPERATIONAL_FEED_MAPPING_CONFLICT');
      audit(this.runtime, { spaceId: input.spaceId, actorUserId: input.actorUserId, action: 'mapping.retired',
        target: input.mappingId, detail: { revision: input.expectedRevision + 1 }, at });
      return { mappingId: input.mappingId, state: 'retired' as const, revision: input.expectedRevision + 1, replayed: false };
    })();
  }

  captureTicketEvent(ticketEventId: string, now: Date | string = new Date()) {
    if (!this.available()) return { captured: 0, excluded: 'runtime_unavailable' as const };
    const at = iso(now);
    const source = this.runtime.prepare(`SELECT event.id,event.event_type,event.created_at,ticket.id ticket_id,ticket.response_id,
      survey.id survey_id,survey.space_id,response.respondent_token,collector.type collector_type
      FROM ticket_events event JOIN tickets ticket ON ticket.id=event.ticket_id
      JOIN surveys survey ON survey.id=ticket.survey_id
      LEFT JOIN responses response ON response.id=ticket.response_id AND response.survey_id=ticket.survey_id
      LEFT JOIN collectors collector ON collector.id=response.collector_id AND collector.survey_id=response.survey_id
      WHERE event.id=?`).get(ticketEventId) as any;
    if (!source?.response_id || !source.respondent_token) return { captured: 0, excluded: 'ticket_without_governed_response' as const };
    const responseHash = hmac(source.response_id);
    const receipt = this.runtime.prepare(`SELECT receipt.* FROM journey_stage_survey_governance_receipts receipt
      JOIN journey_stage_survey_policy_versions policy_version ON policy_version.id=receipt.policy_version_id
        AND policy_version.space_id=receipt.space_id
      WHERE receipt.space_id=? AND receipt.response_id_hmac=?
      ORDER BY policy_version.version_number DESC,receipt.created_at DESC,receipt.id DESC LIMIT 1`)
      .get(source.space_id, responseHash) as any;
    if (!receipt || receipt.consent_state !== 'granted' || Date.parse(receipt.retention_expires_at) <= Date.parse(at)) {
      return { captured: 0, excluded: 'governance_receipt_missing' as const };
    }
    const receiptPurposes = parse<Purpose[]>(receipt.purposes_json, []);
    const mappings = this.runtime.prepare(`SELECT version.* FROM journey_operational_stage_mappings mapping
      JOIN journey_operational_stage_mapping_versions version ON version.id=mapping.current_version_id
      WHERE mapping.space_id=? AND mapping.state='active' ORDER BY mapping.id LIMIT ?`)
      .all(source.space_id, maximumMappingsPerSpace + 1) as any[];
    if (mappings.length > maximumMappingsPerSpace) fail('Operational mapping scope is too large to project safely.', 409,
      'JOURNEY_OPERATIONAL_FEED_MAPPING_SCOPE_TOO_LARGE');
    let captured = 0;
    for (const mapping of mappings) {
      if (!parse<string[]>(mapping.source_survey_hmacs_json, []).includes(hmac(String(source.survey_id)))) continue;
      const mappedEvent = parse<Record<string, string>>(mapping.event_map_json, {})[source.event_type];
      if (!mappedEvent) continue;
      const stageLink = this.runtime.prepare(`SELECT 1 ok FROM journey_research_links link
        JOIN journey_research_sources research ON research.id=link.source_id AND research.space_id=link.space_id
        WHERE link.space_id=? AND link.state='active' AND link.target_type='stage' AND link.target_id=?
          AND research.state='active' AND research.source_type='ticket'
          AND research.source_ref=('recovery-ticket:' || ?) LIMIT 1`)
        .get(source.space_id, mapping.stage_id, source.ticket_id);
      if (!stageLink) continue;
      const effectivePurposes = receiptPurposes.filter((entry) => parse<Purpose[]>(mapping.allowed_purposes_json, []).includes(entry));
      if (!effectivePurposes.length) continue;
      let profileId: string | null = null;
      if (mapping.identity_identifier_kind && mapping.identity_identifier_namespace) {
        const binding = this.runtime.prepare(`SELECT binding.profile_id FROM journey_identity_bindings binding
          JOIN journey_identity_profiles profile ON profile.id=binding.profile_id AND profile.space_id=binding.space_id
          WHERE binding.space_id=? AND binding.identifier_kind=? AND binding.identifier_namespace=?
            AND binding.identifier_value=? AND profile.status='active' LIMIT 1`).get(source.space_id,
              mapping.identity_identifier_kind, mapping.identity_identifier_namespace, source.respondent_token) as any;
        if (binding?.profile_id) {
          const suppressed = this.runtime.prepare(`SELECT 1 ok FROM journey_profile_privacy_states WHERE space_id=? AND profile_id=?
            AND state IN ('denied','suppressed') LIMIT 1`).get(source.space_id, binding.profile_id);
          if (!suppressed) profileId = String(binding.profile_id);
        }
      }
      const expiry = new Date(Math.min(Date.parse(receipt.retention_expires_at),
        Date.parse(iso(source.created_at)) + Number(mapping.retention_days) * 86_400_000)).toISOString();
      if (Date.parse(expiry) <= Date.parse(at)) continue;
      const external = hmac(`ticket-event:${source.id}`); const ticketHash = hmac(`ticket:${source.ticket_id}`);
      const projection = { subjectIdHmac: receipt.subject_id_hmac, journeyDefinitionId: mapping.journey_definition_id,
        stageId: mapping.stage_id, metricDefinitionId: mapping.metric_definition_id,
        metricDefinitionVersionId: mapping.metric_definition_version_id,
        metricDefinitionVersionSha256: mapping.metric_definition_version_sha256, metricUnit: 'count', value: 1,
        dimensions: source.collector_type ? { channel: [String(source.collector_type).slice(0, 80)] } : {},
        sentiment: null, emotions: [], occurredAt: iso(source.created_at), consentState: 'granted',
        purposes: effectivePurposes, retentionExpiresAt: expiry, sourceVersion: String(mapping.version_number),
        schemaVersion: sha({ source: 'ticket_events', eventType: source.event_type }), projectionVersion,
        metricEventType: mappedEvent };
      const projectionHash = sha(projection);
      this.runtime.transaction(() => {
        const prior = this.runtime.prepare(`SELECT * FROM journey_operational_stage_source_revisions
          WHERE space_id=? AND mapping_id=? AND external_record_hmac=? ORDER BY revision DESC,id LIMIT 1`)
          .get(source.space_id, mapping.mapping_id, external) as any;
        if (prior?.projection_sha256 === projectionHash && prior.operation === 'upsert') return;
        const revision = Number(prior?.revision || 0) + 1; const revisionId = crypto.randomUUID();
        this.runtime.prepare(`INSERT INTO journey_operational_stage_source_revisions
          (id,space_id,mapping_id,mapping_version_id,governance_receipt_id,external_record_hmac,ticket_id_hmac,response_id_hmac,
           profile_id,revision,operation,supersedes_revision_id,projection_json,projection_sha256,retention_expires_at,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,'upsert',?,?,?,?,?)`).run(revisionId, source.space_id, mapping.mapping_id, mapping.id,
            receipt.id, external, ticketHash, responseHash, profileId, revision, prior?.id || null, stable(projection), projectionHash, expiry, at);
        this.runtime.prepare(`INSERT INTO journey_operational_stage_outbox
          (id,space_id,mapping_id,source_revision_id,state,available_at,lease_owner,lease_token,lease_generation,lease_expires_at,
           attempt_count,last_error_code,terminal_at,created_at,updated_at)
           VALUES (?,?,?,?,'pending',?,NULL,NULL,0,NULL,0,NULL,NULL,?,?)`)
          .run(crypto.randomUUID(), source.space_id, mapping.mapping_id, revisionId, at, at, at);
        audit(this.runtime, { spaceId: source.space_id, action: 'revision.recorded', target: revisionId,
          detail: { revision, operation: 'upsert', identityBridge: Boolean(profileId), eventTypeSha256: sha(mappedEvent) }, at });
        captured += 1;
      })();
    }
    return { captured, excluded: null };
  }

  tombstoneTicketEvent(input: { spaceId: string; ticketEventId: string;
    reason: 'source_deleted' | 'consent_withdrawn' | 'privacy_erasure'; now?: Date | string }) {
    if (!this.available()) return { enqueued: 0 };
    const at = iso(input.now); const external = hmac(`ticket-event:${token(input.ticketEventId, 'ticket event id', 128)}`);
    const rows = this.runtime.prepare(`SELECT revision.* FROM journey_operational_stage_source_revisions revision
      WHERE revision.space_id=? AND revision.external_record_hmac=? AND revision.operation='upsert'
        AND revision.retention_expires_at>?
        AND NOT EXISTS (SELECT 1 FROM journey_operational_stage_source_revisions newer
          WHERE newer.space_id=revision.space_id AND newer.mapping_id=revision.mapping_id
            AND newer.external_record_hmac=revision.external_record_hmac AND newer.revision>revision.revision)
      ORDER BY revision.mapping_id`).all(input.spaceId, external, at) as any[];
    return this.runtime.transaction(() => {
      for (const prior of rows) this.insertTombstoneRevision(prior, input.reason, at);
      return { enqueued: rows.length };
    })();
  }

  tombstoneGovernedSubject(input: { spaceId: string; subjectIdHmac: string;
    reason: 'consent_withdrawn' | 'privacy_erasure'; now?: Date | string }) {
    if (!this.available()) return { enqueued: 0 };
    if (!/^[a-f0-9]{64}$/u.test(input.subjectIdHmac)) fail('Subject reference is invalid.');
    const at = iso(input.now);
    const rows = this.runtime.prepare(`SELECT revision.* FROM journey_operational_stage_source_revisions revision
      JOIN journey_stage_survey_governance_receipts receipt ON receipt.id=revision.governance_receipt_id
      WHERE revision.space_id=? AND receipt.subject_id_hmac=? AND revision.operation='upsert'
        AND revision.retention_expires_at>?
        AND NOT EXISTS (SELECT 1 FROM journey_operational_stage_source_revisions newer
          WHERE newer.space_id=revision.space_id AND newer.mapping_id=revision.mapping_id
            AND newer.external_record_hmac=revision.external_record_hmac AND newer.revision>revision.revision)
      ORDER BY revision.mapping_id,revision.external_record_hmac LIMIT ?`)
      .all(input.spaceId, input.subjectIdHmac, at, maximumPrivacyBatch + 1) as any[];
    return this.runtime.transaction(() => {
      for (const prior of rows.slice(0, maximumPrivacyBatch)) this.insertTombstoneRevision(prior, input.reason, at);
      return { enqueued: Math.min(rows.length, maximumPrivacyBatch), hasMore: rows.length > maximumPrivacyBatch };
    })();
  }

  tombstoneResponse(input: { spaceId: string; responseId: string; now?: Date | string }) {
    if (!this.available()) return { enqueued: 0 };
    const responseHash = hmac(token(input.responseId, 'response id', 128)); const at = iso(input.now);
    const rows = this.runtime.prepare(`SELECT revision.* FROM journey_operational_stage_source_revisions revision
      WHERE revision.space_id=? AND revision.response_id_hmac=? AND revision.operation='upsert'
        AND revision.retention_expires_at>?
        AND NOT EXISTS (SELECT 1 FROM journey_operational_stage_source_revisions newer
          WHERE newer.space_id=revision.space_id AND newer.mapping_id=revision.mapping_id
            AND newer.external_record_hmac=revision.external_record_hmac AND newer.revision>revision.revision)
      ORDER BY revision.mapping_id,revision.external_record_hmac LIMIT ?`)
      .all(input.spaceId, responseHash, at, maximumPrivacyBatch + 1) as any[];
    return this.runtime.transaction(() => {
      for (const prior of rows.slice(0, maximumPrivacyBatch)) this.insertTombstoneRevision(prior, 'consent_withdrawn', at);
      return { enqueued: Math.min(rows.length, maximumPrivacyBatch), hasMore: rows.length > maximumPrivacyBatch };
    })();
  }

  tombstoneRespondentToken(input: { spaceId: string; respondentToken: string; now?: Date | string }) {
    return this.tombstoneGovernedSubject({ spaceId: input.spaceId,
      subjectIdHmac: hmac(token(input.respondentToken, 'respondent token', 200)),
      reason: 'consent_withdrawn', now: input.now });
  }

  tombstoneSurvey(input: { spaceId: string; surveyId: string; now?: Date | string }) {
    if (!this.available()) return { enqueued: 0 };
    const surveyHash = hmac(token(input.surveyId, 'survey id', 128)); const at = iso(input.now);
    const mappings = (this.runtime.prepare(`SELECT version.mapping_id,version.source_survey_hmacs_json
      FROM journey_operational_stage_mappings mapping JOIN journey_operational_stage_mapping_versions version
        ON version.id=mapping.current_version_id WHERE mapping.space_id=? ORDER BY mapping.id LIMIT ?`)
      .all(input.spaceId, maximumMappingsPerSpace + 1) as any[]);
    if (mappings.length > maximumMappingsPerSpace) fail('Operational mapping scope is too large to delete safely.', 409,
      'JOURNEY_OPERATIONAL_FEED_MAPPING_SCOPE_TOO_LARGE');
    const mappingIds = mappings
      .filter((row) => parse<string[]>(row.source_survey_hmacs_json, []).includes(surveyHash))
      .map((row) => String(row.mapping_id));
    if (!mappingIds.length) return { enqueued: 0, hasMore: false };
    const placeholders = mappingIds.map(() => '?').join(',');
    const rows = this.runtime.prepare(`SELECT revision.* FROM journey_operational_stage_source_revisions revision
      WHERE revision.space_id=? AND revision.mapping_id IN (${placeholders}) AND revision.operation='upsert'
        AND revision.retention_expires_at>?
        AND NOT EXISTS (SELECT 1 FROM journey_operational_stage_source_revisions newer
          WHERE newer.space_id=revision.space_id AND newer.mapping_id=revision.mapping_id
            AND newer.external_record_hmac=revision.external_record_hmac AND newer.revision>revision.revision)
      ORDER BY revision.mapping_id,revision.external_record_hmac LIMIT ?`)
      .all(input.spaceId, ...mappingIds, at, maximumPrivacyBatch + 1) as any[];
    return this.runtime.transaction(() => {
      for (const prior of rows.slice(0, maximumPrivacyBatch)) this.insertTombstoneRevision(prior, 'source_deleted', at);
      return { enqueued: Math.min(rows.length, maximumPrivacyBatch), hasMore: rows.length > maximumPrivacyBatch };
    })();
  }

  private insertTombstoneRevision(prior: any, reason: string, at: string) {
    const revision = Number(prior.revision) + 1; const id = crypto.randomUUID();
    this.runtime.prepare(`INSERT INTO journey_operational_stage_source_revisions
      (id,space_id,mapping_id,mapping_version_id,governance_receipt_id,external_record_hmac,ticket_id_hmac,response_id_hmac,
       profile_id,revision,operation,supersedes_revision_id,projection_json,projection_sha256,retention_expires_at,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,'delete',?,?,?,?,?)`).run(id, prior.space_id, prior.mapping_id, prior.mapping_version_id,
        prior.governance_receipt_id, prior.external_record_hmac, prior.ticket_id_hmac, prior.response_id_hmac, prior.profile_id,
        revision, prior.id, prior.projection_json, prior.projection_sha256, prior.retention_expires_at, at);
    this.runtime.prepare(`INSERT INTO journey_operational_stage_outbox
      (id,space_id,mapping_id,source_revision_id,state,available_at,lease_owner,lease_token,lease_generation,lease_expires_at,
       attempt_count,last_error_code,terminal_at,created_at,updated_at)
       VALUES (?,?,?,?,'pending',?,NULL,NULL,0,NULL,0,NULL,NULL,?,?)`)
      .run(crypto.randomUUID(), prior.space_id, prior.mapping_id, id, at, at, at);
    this.runtime.prepare(`INSERT INTO journey_operational_stage_tombstones
      (id,space_id,mapping_id,external_record_hmac,deletion_revision,reason_code,created_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(space_id,mapping_id,external_record_hmac) DO NOTHING`).run(crypto.randomUUID(), prior.space_id,
        prior.mapping_id, prior.external_record_hmac, revision, reason, at);
    audit(this.runtime, { spaceId: prior.space_id, action: 'revision.recorded', target: id,
      detail: { revision, operation: 'delete', reasonCode: reason }, at });
  }

  claim(input: { owner: string; now?: Date | string; leaseMs?: number; spaceIds?: readonly string[] }) {
    if (!this.available()) return null;
    const owner = token(input.owner, 'lease owner', 128); const at = iso(input.now);
    const leaseMs = Math.max(5_000, Math.min(300_000, input.leaseMs || 30_000));
    const spaceIds = [...new Set((input.spaceIds || []).map((spaceId) => token(spaceId, 'space id', 128)))];
    if (spaceIds.length > 100) fail('Operational feed worker scope is too large.', 400,
      'JOURNEY_OPERATIONAL_FEED_SCOPE_INVALID');
    const scopeSql = spaceIds.length ? ` AND space_id IN (${spaceIds.map(() => '?').join(',')})` : '';
    return this.runtime.transaction(() => {
      const expired = this.runtime.prepare(`SELECT id,space_id,lease_generation,attempt_count FROM journey_operational_stage_outbox
        WHERE state='leased' AND lease_expires_at<=?${scopeSql} ORDER BY lease_expires_at,id LIMIT 100`)
        .all(at, ...spaceIds) as any[];
      for (const row of expired) {
        const terminal = Number(row.attempt_count) >= 8;
        const changed = this.runtime.prepare(`UPDATE journey_operational_stage_outbox SET state=?,available_at=?,lease_owner=NULL,
          lease_token=NULL,lease_expires_at=NULL,last_error_code='JOURNEY_OPERATIONAL_FEED_LEASE_EXPIRED',terminal_at=?,updated_at=?
          WHERE id=? AND state='leased' AND lease_generation=?`).run(terminal ? 'dead_letter' : 'retry_wait', at,
            terminal ? at : null, at, row.id, row.lease_generation).changes;
        if (changed) this.runtime.prepare(`INSERT INTO journey_operational_stage_outbox_attempts
          (id,outbox_id,space_id,lease_generation,attempt_number,outcome,error_code,detail_sha256,created_at)
          VALUES (?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), row.id, row.space_id, row.lease_generation,
            row.attempt_count, terminal ? 'dead_letter' : 'lease_expired', 'JOURNEY_OPERATIONAL_FEED_LEASE_EXPIRED',
            sha({ terminal }), at);
      }
      const lock = this.runtime.provider === 'postgres' ? ' FOR UPDATE SKIP LOCKED' : '';
      const row = this.runtime.prepare(`SELECT * FROM journey_operational_stage_outbox WHERE state IN ('pending','retry_wait')
        AND available_at<=?${scopeSql} ORDER BY available_at,created_at,id LIMIT 1${lock}`).get(at, ...spaceIds) as any;
      if (!row) return null;
      const leaseToken = crypto.randomBytes(24).toString('hex'); const generation = Number(row.lease_generation) + 1;
      const expires = new Date(Date.parse(at) + leaseMs).toISOString();
      const changed = this.runtime.prepare(`UPDATE journey_operational_stage_outbox SET state='leased',lease_owner=?,lease_token=?,
        lease_generation=?,lease_expires_at=?,attempt_count=attempt_count+1,updated_at=? WHERE id=? AND state IN ('pending','retry_wait')`)
        .run(owner, leaseToken, generation, expires, at, row.id).changes;
      return changed ? { ...row, state: 'leased', lease_owner: owner, lease_token: leaseToken,
        lease_generation: generation, lease_expires_at: expires, attempt_count: Number(row.attempt_count) + 1 } : null;
    })();
  }

  complete(claim: any, now: Date | string = new Date()) {
    const at = iso(now);
    return this.runtime.transaction(() => {
      const current = this.runtime.prepare(`SELECT outbox.id outbox_id,outbox.attempt_count outbox_attempt_count,
        outbox.lease_generation outbox_lease_generation,revision.* FROM journey_operational_stage_outbox outbox
        JOIN journey_operational_stage_source_revisions revision ON revision.id=outbox.source_revision_id
        WHERE outbox.id=? AND outbox.state='leased' AND outbox.lease_owner=? AND outbox.lease_token=?
          AND outbox.lease_generation=?`).get(claim.id, claim.lease_owner, claim.lease_token, claim.lease_generation) as any;
      if (!current) fail('Operational feed lease was lost.', 409, 'JOURNEY_OPERATIONAL_FEED_LEASE_LOST');
      const projection = parse<Record<string, any>>(current.projection_json, {});
      if (sha(projection) !== current.projection_sha256 || projection.projectionVersion !== projectionVersion) {
        fail('Stored operational projection is invalid.', 409, 'JOURNEY_OPERATIONAL_FEED_PROJECTION_INVALID');
      }
      const mappingActive = this.runtime.prepare(`SELECT 1 ok FROM journey_operational_stage_mappings
        WHERE id=? AND space_id=? AND state='active'`).get(current.mapping_id, current.space_id);
      const receipt = this.runtime.prepare(`SELECT receipt.consent_state,receipt.purposes_json,receipt.retention_expires_at
        FROM journey_stage_survey_governance_receipts receipt
        JOIN journey_stage_survey_policy_versions policy_version ON policy_version.id=receipt.policy_version_id
          AND policy_version.space_id=receipt.space_id
        WHERE receipt.response_id_hmac=? AND receipt.space_id=?
        ORDER BY policy_version.version_number DESC,receipt.created_at DESC,receipt.id DESC LIMIT 1`)
        .get(current.response_id_hmac, current.space_id) as any;
      const receiptPurposes = parse<string[]>(receipt?.purposes_json, []);
      const authorised = current.operation === 'delete'
        ? Date.parse(String(current.retention_expires_at)) > Date.parse(at)
        : Boolean(mappingActive && receipt?.consent_state === 'granted'
          && Date.parse(String(receipt.retention_expires_at)) > Date.parse(at)
          && Date.parse(String(current.retention_expires_at)) > Date.parse(at)
          && Array.isArray(projection.purposes) && projection.purposes.length > 0
          && projection.purposes.every((purpose: unknown) => typeof purpose === 'string' && receiptPurposes.includes(purpose)));
      const sourceId = hmac(current.mapping_id);
      const priorFact = this.runtime.prepare(`SELECT * FROM journey_stage_intelligence_facts WHERE space_id=? AND metric_definition_id=?
        AND source_id_hmac=? AND external_record_hmac=? ORDER BY revision DESC,id LIMIT 1`)
        .get(current.space_id, projection.metricDefinitionId, sourceId, current.external_record_hmac) as any;
      if (authorised && (!priorFact || Number(priorFact.revision) < Number(current.revision))) {
        if (Number(current.revision) !== Number(priorFact?.revision || 0) + 1) fail('Operational fact revision is not consecutive.', 409,
          'JOURNEY_OPERATIONAL_FEED_REVISION_CONFLICT');
        const factId = crypto.randomUUID();
        this.runtime.prepare(`INSERT INTO journey_stage_intelligence_facts
          (id,space_id,journey_definition_id,source_type,source_id_hmac,external_record_hmac,source_version,schema_version,
           projection_version,revision,operation,supersedes_fact_id,subject_id_hmac,stage_id,metric_definition_id,
           metric_definition_version_id,metric_definition_version_sha256,metric_unit,value,dimensions_json,sentiment,emotions_json,
           occurred_at,consent_state,purposes_json,retention_expires_at,idempotency_key_hmac,intent_sha256,created_at)
           VALUES (?,?,?,'service_recovery_ticket',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(factId,
            current.space_id, projection.journeyDefinitionId, sourceId, current.external_record_hmac, projection.sourceVersion,
            projection.schemaVersion, projection.projectionVersion, current.revision, current.operation, priorFact?.id || null,
            projection.subjectIdHmac, projection.stageId, projection.metricDefinitionId, projection.metricDefinitionVersionId,
            projection.metricDefinitionVersionSha256, projection.metricUnit, current.operation === 'delete' ? null : projection.value,
            JSON.stringify(projection.dimensions || {}), null, '[]', projection.occurredAt, projection.consentState,
            JSON.stringify(projection.purposes), projection.retentionExpiresAt, hmac(current.id),
            sha({ outboxId: claim.id, projectionSha256: current.projection_sha256 }), at);
        const detail = { revision: Number(current.revision), operation: current.operation,
          metricDefinitionSha256: sha(projection.metricDefinitionId), sourceType: 'service_recovery_ticket' };
        this.runtime.prepare(`INSERT INTO journey_stage_intelligence_audit
          (id,space_id,actor_user_id,action,target_type,target_sha256,detail_json,detail_sha256,created_at)
          VALUES (?,?,NULL,?,'fact',?,?,?,?)`).run(crypto.randomUUID(), current.space_id,
            current.operation === 'delete' ? 'fact.deleted' : 'fact.accepted', sha(factId), stable(detail), sha(detail), at);
      }
      const profileSuppressed = current.profile_id ? this.runtime.prepare(`SELECT 1 ok FROM journey_profile_privacy_states
        WHERE space_id=? AND profile_id=? AND state IN ('denied','suppressed') LIMIT 1`)
        .get(current.space_id, current.profile_id) : null;
      if (authorised && current.profile_id && !profileSuppressed) this.insertTimeline(current, projection, at);
      const changed = this.runtime.prepare(`UPDATE journey_operational_stage_outbox SET state='completed',lease_owner=NULL,lease_token=NULL,
        lease_expires_at=NULL,terminal_at=?,updated_at=? WHERE id=? AND state='leased' AND lease_token=? AND lease_generation=?`)
        .run(at, at, claim.id, claim.lease_token, claim.lease_generation).changes;
      if (!changed) fail('Operational feed lease was lost.', 409, 'JOURNEY_OPERATIONAL_FEED_LEASE_LOST');
      this.runtime.prepare(`INSERT INTO journey_operational_stage_outbox_attempts
        (id,outbox_id,space_id,lease_generation,attempt_number,outcome,error_code,detail_sha256,created_at)
        VALUES (?,?,?,?,?,'succeeded',NULL,?,?)`).run(crypto.randomUUID(), claim.id, current.space_id,
          current.outbox_lease_generation, current.outbox_attempt_count, sha({ operation: current.operation }), at);
      this.runtime.prepare(`INSERT INTO journey_operational_stage_checkpoints
        (mapping_id,space_id,last_external_record_hmac,completed_revision_count,updated_at) VALUES (?,?,?,?,?)
        ON CONFLICT(mapping_id,space_id) DO UPDATE SET last_external_record_hmac=excluded.last_external_record_hmac,
          completed_revision_count=journey_operational_stage_checkpoints.completed_revision_count+1,updated_at=excluded.updated_at`)
        .run(current.mapping_id, current.space_id, current.external_record_hmac, 1, at);
      audit(this.runtime, { spaceId: current.space_id, action: 'outbox.completed', target: claim.id,
        detail: { operation: current.operation, authorised, identityBridge: Boolean(authorised && current.profile_id && !profileSuppressed) }, at });
      return true;
    })();
  }

  private insertTimeline(current: any, projection: Record<string, any>, at: string) {
    const prior = this.runtime.prepare(`SELECT * FROM journey_operational_timeline_revisions WHERE space_id=? AND profile_id=?
      AND external_record_hmac=? ORDER BY revision DESC,id LIMIT 1`).get(current.space_id, current.profile_id,
        current.external_record_hmac) as any;
    if (prior && Number(prior.revision) >= Number(current.revision)) return;
    const eventKind = projection.metricEventType === 'ticket.recovered' ? 'service_recovery_closed'
      : projection.metricEventType === 'ticket.contact' ? 'service_recovery_contact' : 'service_recovery_opened';
    this.runtime.prepare(`INSERT INTO journey_operational_timeline_revisions
      (id,space_id,source_revision_id,profile_id,canonical_profile_id,external_record_hmac,revision,operation,
       supersedes_timeline_revision_id,event_kind,occurred_at,purposes_json,retention_expires_at,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), current.space_id, current.id, current.profile_id,
        canonicalProfile(this.runtime, current.space_id, current.profile_id), current.external_record_hmac, current.revision, current.operation,
        prior?.id || null, eventKind, projection.occurredAt, JSON.stringify(projection.purposes), projection.retentionExpiresAt, at);
  }

  fail(claim: any, errorCode: string, now: Date | string = new Date()) {
    const at = iso(now); const code = token(errorCode, 'error code', 100);
    return this.runtime.transaction(() => {
      const row = this.runtime.prepare(`SELECT * FROM journey_operational_stage_outbox WHERE id=? AND state='leased'
        AND lease_owner=? AND lease_token=? AND lease_generation=?`).get(claim.id, claim.lease_owner,
          claim.lease_token, claim.lease_generation) as any;
      if (!row) return false;
      const terminal = Number(row.attempt_count) >= 8;
      const available = new Date(Date.parse(at) + Math.min(3_600_000, 15_000 * (2 ** Math.max(0, Number(row.attempt_count) - 1)))).toISOString();
      this.runtime.prepare(`UPDATE journey_operational_stage_outbox SET state=?,available_at=?,lease_owner=NULL,lease_token=NULL,
        lease_expires_at=NULL,last_error_code=?,terminal_at=?,updated_at=? WHERE id=? AND lease_token=? AND lease_generation=?`)
        .run(terminal ? 'dead_letter' : 'retry_wait', available, code, terminal ? at : null, at, row.id,
          row.lease_token, row.lease_generation);
      this.runtime.prepare(`INSERT INTO journey_operational_stage_outbox_attempts
        (id,outbox_id,space_id,lease_generation,attempt_number,outcome,error_code,detail_sha256,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), row.id, row.space_id, row.lease_generation,
          row.attempt_count, terminal ? 'dead_letter' : 'retry_wait', code, sha({ code, terminal }), at);
      audit(this.runtime, { spaceId: row.space_id, action: 'outbox.failed', target: row.id, detail: { errorCode: code, terminal }, at });
      return true;
    })();
  }

  purgeExpired(input: { spaceId: string; now?: Date | string; limit?: number }) {
    if (!this.available()) return { purgedCount: 0, hasMore: false };
    const at = iso(input.now); const limit = Math.max(1, Math.min(500, input.limit || 100));
    return this.runtime.transaction(() => {
      if (this.runtime.provider === 'postgres') this.runtime.prepare(
        `SELECT set_config('seemplify.operational_feed_retention_purge','on',true)`).get();
      const rows = this.runtime.prepare(`SELECT mapping_id,external_record_hmac
        FROM journey_operational_stage_source_revisions WHERE space_id=?
        GROUP BY mapping_id,external_record_hmac HAVING MAX(retention_expires_at)<=?
        ORDER BY MIN(retention_expires_at),mapping_id,external_record_hmac LIMIT ?`)
        .all(input.spaceId, at, limit) as Array<{ mapping_id: string; external_record_hmac: string }>;
      if (!rows.length) return { purgedCount: 0, hasMore: false };
      for (const row of rows) {
        const chain = this.runtime.prepare(`SELECT id FROM journey_operational_stage_source_revisions
          WHERE space_id=? AND mapping_id=? AND external_record_hmac=? ORDER BY revision DESC`)
          .all(input.spaceId, row.mapping_id, row.external_record_hmac) as Array<{ id: string }>;
        const ids = chain.map((entry) => entry.id); const placeholders = ids.map(() => '?').join(',');
        this.runtime.prepare(`DELETE FROM journey_operational_timeline_revisions WHERE source_revision_id IN (${placeholders})`).run(...ids);
        this.runtime.prepare(`DELETE FROM journey_operational_stage_tombstones WHERE space_id=? AND mapping_id=? AND external_record_hmac=?`)
          .run(input.spaceId, row.mapping_id, row.external_record_hmac);
        this.runtime.prepare(`DELETE FROM journey_operational_stage_outbox_attempts WHERE outbox_id IN (
          SELECT id FROM journey_operational_stage_outbox WHERE source_revision_id IN (${placeholders}))`).run(...ids);
        this.runtime.prepare(`DELETE FROM journey_operational_stage_outbox WHERE source_revision_id IN (${placeholders})`).run(...ids);
        this.runtime.prepare(`DELETE FROM journey_operational_stage_source_revisions WHERE id IN (${placeholders})`).run(...ids);
      }
      audit(this.runtime, { spaceId: input.spaceId, action: 'retention.purged', target: input.spaceId,
        detail: { purgedCount: rows.length }, at });
      const more = this.runtime.prepare(`SELECT 1 ok FROM journey_operational_stage_source_revisions WHERE space_id=?
        GROUP BY mapping_id,external_record_hmac HAVING MAX(retention_expires_at)<=? LIMIT 1`).get(input.spaceId, at);
      return { purgedCount: rows.length, hasMore: Boolean(more) };
    })();
  }

  listProfileTimeline(spaceId: string, profileId: string) {
    if (!this.available()) return [];
    return (this.runtime.prepare(`SELECT current.* FROM journey_operational_timeline_revisions current
      WHERE current.space_id=? AND current.profile_id=? AND current.operation='upsert' AND current.retention_expires_at>?
        AND NOT EXISTS (SELECT 1 FROM journey_operational_timeline_revisions newer WHERE newer.space_id=current.space_id
          AND newer.profile_id=current.profile_id AND newer.external_record_hmac=current.external_record_hmac
          AND newer.revision>current.revision)
      ORDER BY current.occurred_at DESC,current.id`).all(spaceId, profileId, new Date().toISOString()) as any[]).map((row) => ({
        id: `operational:${row.id}`, profileId: row.profile_id, canonicalProfileId: row.canonical_profile_id,
        eventKind: row.event_kind, occurredAt: row.occurred_at,
        title: row.event_kind === 'service_recovery_closed' ? 'Service recovery completed'
          : row.event_kind === 'service_recovery_contact' ? 'Service recovery contact recorded' : 'Service recovery opened',
        summary: row.event_kind === 'service_recovery_closed' ? 'A governed service-recovery case was closed.'
          : row.event_kind === 'service_recovery_contact' ? 'A governed service-recovery contact occurred.'
            : 'A governed service-recovery case was opened.',
        sourceType: 'service_recovery_ticket', sourceId: row.external_record_hmac,
        detail: { governance: 'runtime52', sentiment: null, emotions: [] }, createdAt: row.created_at
      }));
  }
}

export const journeyOperationalStageFeedRepository = new JourneyOperationalStageFeedRepository();
