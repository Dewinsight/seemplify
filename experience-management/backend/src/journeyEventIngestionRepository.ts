import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  validateEventEnvelope,
  type EventIngestResult,
  type JourneyEventEnvelope
} from '@seemplify/journey-event-protocol';
import { config } from './config.js';
import { db } from './database.js';
import {
  type JourneyEventPropertyDefinition,
  type JourneyEventSchemaVersion,
  type JourneyEventSourcePolicy
} from './journeyEventControlPlane.js';
import {
  verifyStoredJourneyEventCredential
} from './journeyEventControlPlaneRepository.js';
import {
  authoriseJourneyIngestBinding,
  eventResult,
  journeyEventEnvelopeFingerprint,
  journeyEventPayloadFingerprint,
  prepareJourneyEvent,
  type JourneyIngestPrincipal,
  type JourneyIngestRequestBinding
} from './journeyEventIngestion.js';
import {
  assertSubscriptionFeature,
  consumeSubscriptionUsage,
  effectiveSubscriptionForSpace,
  meteredUsageSnapshot,
  SubscriptionEntitlementError
} from './subscriptionEntitlements.js';
import { journeyEventReplayEligibilityValue } from './journeyEventDatabaseValues.js';

export const journeyEventDataTables = Object.freeze({
  deduplication: 'journey_event_deduplication',
  rawEvents: 'journey_raw_events',
  ingestReceipts: 'journey_event_ingest_receipts',
  rejections: 'journey_event_rejections',
  rateBuckets: 'journey_event_rate_buckets',
  processingInbox: 'journey_event_processing_inbox',
  processingReceipts: 'journey_event_processing_receipts',
  deadLetters: 'journey_event_dead_letters',
  dataAudit: 'journey_event_data_audit'
});

export class JourneyEventIngestionError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly retryable = false,
    public readonly eventId: string | null = null,
    public readonly fieldPath: string | null = null,
    public readonly corsOriginAuthorized = false
  ) {
    super(message);
    this.name = 'JourneyEventIngestionError';
  }
}

export type JourneyEventIngestOutcome = {
  httpStatus: number;
  result: EventIngestResult;
  requestId: string;
  replayed: boolean;
};

type SourceRow = {
  id: string;
  space_id: string;
  environment: JourneyEventSourcePolicy['environment'];
  status: JourneyEventSourcePolicy['status'];
  validation_mode: JourneyEventSourcePolicy['validationMode'];
  allowed_origins_json: string;
  allowed_bundle_ids_json: string;
  events_per_minute: number | string;
  bytes_per_minute: number | string;
};

type DedupeRow = {
  envelope_sha256: string;
  raw_event_id: string;
  raw_received_at: string | null;
  ingest_receipt_id: string;
  first_outcome: EventIngestResult['status'];
  first_http_status: number | string;
  first_result_code: string | null;
  first_result_json: string;
};

const sourceSelect = `SELECT id,space_id,environment,status,validation_mode,allowed_origins_json,
  allowed_bundle_ids_json,events_per_minute,bytes_per_minute FROM journey_event_sources`;
const identifierFields = ['anonymousId', 'userId', 'accountId', 'sessionId'] as const;
let identityKeyCache: { path: string; modifiedMs: number; size: number; value: Buffer } | null = null;

function parseJson<T>(value: unknown, fallback: T): T {
  try { return JSON.parse(String(value || '')) as T; }
  catch { return fallback; }
}

function nowIso(value?: Date | string) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value || Date.now());
  if (!Number.isFinite(date.getTime())) {
    throw new JourneyEventIngestionError('The ingestion timestamp is invalid.', 400, 'EVENT_TIME_INVALID');
  }
  return date.toISOString();
}

function plusDays(at: string, days: number) {
  return new Date(Date.parse(at) + Math.max(1, Math.min(3_650, days)) * 24 * 60 * 60_000).toISOString();
}

function sourcePolicy(row: SourceRow): JourneyEventSourcePolicy {
  return {
    sourceId: row.id,
    spaceId: row.space_id,
    environment: row.environment,
    status: row.status,
    validationMode: row.validation_mode,
    allowedOrigins: parseJson<string[]>(row.allowed_origins_json, []),
    allowedBundleIds: parseJson<string[]>(row.allowed_bundle_ids_json, []),
    eventsPerMinute: Number(row.events_per_minute),
    bytesPerMinute: Number(row.bytes_per_minute)
  };
}

function lockSource(spaceId: string, sourceId: string) {
  const suffix = db.provider === 'postgres' ? ' FOR UPDATE' : '';
  const row = db.prepare(`${sourceSelect} WHERE id=? AND space_id=?${suffix}`).get(sourceId, spaceId) as SourceRow | undefined;
  if (!row) throw new JourneyEventIngestionError('The event credential is invalid.', 401, 'EVENT_CREDENTIAL_INVALID');
  if (db.provider === 'sqlite') db.prepare('UPDATE journey_event_sources SET updated_at=updated_at WHERE id=? AND space_id=?').run(sourceId, spaceId);
  return row;
}

function requireIdentityHashKey() {
  try {
    const stat = fs.statSync(config.journeyIdentityHashKeyFile);
    if (identityKeyCache && identityKeyCache.path === config.journeyIdentityHashKeyFile
      && identityKeyCache.modifiedMs === stat.mtimeMs && identityKeyCache.size === stat.size) {
      return identityKeyCache.value;
    }
    const value = fs.readFileSync(config.journeyIdentityHashKeyFile);
    if (value.length < 32) throw new Error('too short');
    identityKeyCache = { path: config.journeyIdentityHashKeyFile, modifiedMs: stat.mtimeMs, size: stat.size, value };
    return value;
  } catch {
    throw new JourneyEventIngestionError(
      'Journey identity hashing is not configured.', 503, 'EVENT_IDENTITY_HASH_UNAVAILABLE', true
    );
  }
}

function identityHash(key: Buffer, value: unknown) {
  return typeof value === 'string' && value
    ? crypto.createHmac('sha256', key).update(value, 'utf8').digest('hex')
    : null;
}

function schemaForEnvelope(spaceId: string, sourceId: string, envelope: JourneyEventEnvelope) {
  if (!envelope.event || !envelope.eventVersion) return null;
  const row = db.prepare(`SELECT version.id,version.schema_id,definition.event_name,version.version,version.properties_json
    FROM journey_event_schemas definition JOIN journey_event_schema_versions version
      ON version.schema_id=definition.id AND version.space_id=definition.space_id AND version.source_id=definition.source_id
    WHERE definition.space_id=? AND definition.source_id=? AND definition.event_name=?
      AND version.version_major=? AND version.state='published' LIMIT 1`)
    .get(spaceId, sourceId, envelope.event, envelope.eventVersion) as {
      id: string; schema_id: string; event_name: string; version: string; properties_json: string;
    } | undefined;
  if (!row) return null;
  const schema: JourneyEventSchemaVersion = {
    schemaId: row.schema_id,
    eventName: row.event_name,
    version: row.version,
    state: 'published',
    properties: parseJson<JourneyEventPropertyDefinition[]>(row.properties_json, [])
  };
  return { id: row.id, schema };
}

function channelFor(envelope: JourneyEventEnvelope, principal: JourneyIngestPrincipal) {
  const name = String(envelope.context?.library?.name || '').toLowerCase();
  if (name.includes('react-native')) return 'react_native';
  if (name.includes('swift') || name.includes('ios')) return 'ios';
  if (name.includes('kotlin') || name.includes('android')) return 'android';
  if (name.includes('browser') || name.includes('react')) return 'web';
  return principal.kind === 'server_secret' ? 'server' : 'unknown';
}

function consentState(envelope: JourneyEventEnvelope) {
  if (['identify', 'alias', 'group'].includes(envelope.call)) return envelope.consent?.personalisation || 'unknown';
  return envelope.consent?.analytics || 'unknown';
}

function minuteWindow(at: string) {
  const date = new Date(at);
  date.setUTCSeconds(0, 0);
  return date.toISOString();
}

function consumeRate(source: JourneyEventSourcePolicy, at: string, bytes: number) {
  const window = minuteWindow(at);
  db.prepare(`INSERT INTO ${journeyEventDataTables.rateBuckets}
    (space_id,source_id,environment,window_started_at,event_count,byte_count,updated_at)
    VALUES (?,?,?,?,1,?,?) ON CONFLICT(space_id,source_id,environment,window_started_at) DO UPDATE SET
      event_count=${journeyEventDataTables.rateBuckets}.event_count+1,
      byte_count=${journeyEventDataTables.rateBuckets}.byte_count+excluded.byte_count,
      updated_at=excluded.updated_at`).run(source.spaceId, source.sourceId, source.environment, window, bytes, at);
  const current = db.prepare(`SELECT event_count,byte_count FROM ${journeyEventDataTables.rateBuckets}
    WHERE space_id=? AND source_id=? AND environment=? AND window_started_at=?`)
    .get(source.spaceId, source.sourceId, source.environment, window) as { event_count: number | string; byte_count: number | string };
  return Number(current.event_count) <= source.eventsPerMinute && Number(current.byte_count) <= source.bytesPerMinute;
}

function priorEvent(spaceId: string, sourceId: string, eventId: string) {
  return db.prepare(`SELECT envelope_sha256,raw_event_id,raw_received_at,ingest_receipt_id,first_outcome,first_http_status,
    first_result_code,first_result_json
    FROM ${journeyEventDataTables.deduplication} WHERE space_id=? AND source_id=? AND event_id=?`)
    .get(spaceId, sourceId, eventId) as DedupeRow | undefined;
}

function nextAttemptOrdinal(spaceId: string, sourceId: string, eventId: string) {
  const row = db.prepare(`SELECT COUNT(*) count FROM ${journeyEventDataTables.ingestReceipts}
    WHERE space_id=? AND source_id=? AND event_id=?`).get(spaceId, sourceId, eventId) as { count: number | string };
  return Math.min(10_000, Number(row.count) + 1);
}

function replayPrior(row: DedupeRow, requestId: string): JourneyEventIngestOutcome {
  const original = parseJson<EventIngestResult>(row.first_result_json, {
    eventId: '00000000-0000-4000-8000-000000000000', status: row.first_outcome,
    duplicate: false, retryable: false, receivedAt: row.raw_received_at || new Date(0).toISOString()
  });
  if (row.first_outcome === 'accepted' || row.first_outcome === 'quarantined') {
    return {
      httpStatus: 200,
      result: eventResult({
        eventId: original.eventId,
        status: 'duplicate',
        receivedAt: original.receivedAt,
        code: 'EVENT_DUPLICATE',
        message: 'This event was already durably recorded.'
      }),
      requestId,
      replayed: true
    };
  }
  return { httpStatus: Number(row.first_http_status), result: original, requestId, replayed: true };
}

function insertReceipt(input: {
  id: string;
  receivedAt: string;
  principal: JourneyIngestPrincipal;
  eventId: string | null;
  sha256: string | null;
  rawEventId: string | null;
  rawReceivedAt?: string | null;
  outcome: EventIngestResult['status'] | 'content_conflict' | 'rate_limited' | 'over_quota' | 'consent_denied';
  httpStatus: number;
  errorCode: string | null;
  requestId: string;
  batchId: string | null;
  attemptOrdinal?: number;
  retentionExpiresAt: string;
}) {
  db.prepare(`INSERT INTO ${journeyEventDataTables.ingestReceipts}
    (received_at,id,space_id,source_id,environment,event_id,envelope_sha256,raw_event_id,raw_received_at,
      outcome,http_status,error_code,request_id,batch_id,attempt_ordinal,retention_expires_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      input.receivedAt, input.id, input.principal.spaceId, input.principal.sourceId, input.principal.environment,
      input.eventId, input.sha256, input.rawEventId, input.rawReceivedAt === undefined
        ? (input.rawEventId ? input.receivedAt : null) : input.rawReceivedAt,
      input.outcome, input.httpStatus, input.errorCode, input.requestId, input.batchId, input.attemptOrdinal || 1,
      input.retentionExpiresAt
    );
}

function insertDedupe(input: {
  principal: JourneyIngestPrincipal;
  eventId: string;
  sha256: string;
  rawEventId: string;
  receivedAt: string;
  receiptId: string;
  result: EventIngestResult;
  httpStatus: number;
  retentionExpiresAt: string;
}) {
  const resultJson = JSON.stringify(input.result);
  db.prepare(`INSERT INTO ${journeyEventDataTables.deduplication}
    (space_id,source_id,environment,event_id,envelope_sha256,raw_event_id,raw_received_at,ingest_receipt_id,
      first_outcome,first_http_status,first_result_code,first_result_json,created_at,retention_expires_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      input.principal.spaceId, input.principal.sourceId, input.principal.environment, input.eventId, input.sha256,
      input.rawEventId, input.receivedAt, input.receiptId, input.result.status,
      input.httpStatus, input.result.code || null, resultJson, input.receivedAt, input.retentionExpiresAt
    );
}

function persistRejection(input: {
  principal: JourneyIngestPrincipal;
  eventId: string;
  sha256: string;
  payloadBytes: number;
  receivedAt: string;
  requestId: string;
  batchId: string | null;
  code: string;
  message: string;
  fieldPath: string;
  status: number;
  receiptOutcome?: 'rejected' | 'rate_limited' | 'over_quota' | 'consent_denied';
  retentionExpiresAt: string;
}) {
  const receiptId = crypto.randomUUID();
  const result = eventResult({
    eventId: input.eventId, status: 'rejected', receivedAt: input.receivedAt,
    code: input.code, message: input.message, retryable: input.status === 429 || input.status >= 500
  });
  insertReceipt({
    id: receiptId, receivedAt: input.receivedAt, principal: input.principal, eventId: input.eventId,
    sha256: input.sha256, rawEventId: null, outcome: input.receiptOutcome || 'rejected', httpStatus: input.status,
    errorCode: input.code, requestId: input.requestId, batchId: input.batchId,
    retentionExpiresAt: input.retentionExpiresAt
  });
  db.prepare(`INSERT INTO ${journeyEventDataTables.rejections}
    (id,space_id,source_id,environment,event_id,ingest_receipt_id,ingest_received_at,code,field_path,
      redacted_detail_json,payload_sha256,payload_bytes,replay_eligible,created_at,retention_expires_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      crypto.randomUUID(), input.principal.spaceId, input.principal.sourceId, input.principal.environment,
      input.eventId, receiptId, input.receivedAt, input.code, input.fieldPath,
      JSON.stringify({ message: input.message.slice(0, 500) }), input.sha256, input.payloadBytes,
      journeyEventReplayEligibilityValue(db.provider, false), input.receivedAt, input.retentionExpiresAt
    );
  return result;
}

function persistProtocolRejection(input: {
  principal: JourneyIngestPrincipal;
  eventId: string | null;
  sha256: string;
  payloadBytes: number;
  receivedAt: string;
  requestId: string;
  batchId: string | null;
  code: string;
  message: string;
  fieldPath: string;
  status: 413 | 422;
  retentionExpiresAt: string;
}) {
  const receiptId = crypto.randomUUID();
  insertReceipt({
    id: receiptId, receivedAt: input.receivedAt, principal: input.principal, eventId: input.eventId,
    sha256: input.sha256, rawEventId: null, rawReceivedAt: null, outcome: 'rejected', httpStatus: input.status,
    errorCode: input.code, requestId: input.requestId, batchId: input.batchId, retentionExpiresAt: input.retentionExpiresAt
  });
  db.prepare(`INSERT INTO ${journeyEventDataTables.rejections}
    (id,space_id,source_id,environment,event_id,ingest_receipt_id,ingest_received_at,code,field_path,
      redacted_detail_json,payload_sha256,payload_bytes,replay_eligible,created_at,retention_expires_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      crypto.randomUUID(), input.principal.spaceId, input.principal.sourceId, input.principal.environment,
      input.eventId, receiptId, input.receivedAt, input.code, input.fieldPath,
      JSON.stringify({ message: input.message.slice(0, 500) }), input.sha256, input.payloadBytes,
      journeyEventReplayEligibilityValue(db.provider, false), input.receivedAt, input.retentionExpiresAt
    );
}

function persistedPayload(envelope: JourneyEventEnvelope) {
  return JSON.stringify({
    ...(envelope.properties ? { properties: envelope.properties } : {}),
    ...(envelope.traits ? { traits: envelope.traits } : {}),
    ...(envelope.metric ? { metric: envelope.metric } : {})
  });
}

function persistAccepted(input: {
  principal: JourneyIngestPrincipal;
  envelope: JourneyEventEnvelope;
  canonicalJson: string;
  sha256: string;
  payloadBytes: number;
  schemaVersionId: string | null;
  outcome: 'accepted' | 'quarantined';
  issues: Array<{ code: string; path: string; message: string }>;
  receivedAt: string;
  requestId: string;
  batchId: string | null;
  retentionExpiresAt: string;
  identityKey: Buffer;
}) {
  const rawEventId = crypto.randomUUID();
  const receiptId = crypto.randomUUID();
  const result = eventResult({
    eventId: input.envelope.eventId, status: input.outcome, receivedAt: input.receivedAt,
    ...(input.outcome === 'quarantined'
      ? { code: 'EVENT_SCHEMA_QUARANTINED', message: 'The event is durable but excluded from processing until its tracking-plan issue is resolved.' }
      : {})
  });
  const sdkName = String(input.envelope.context?.library?.name || '').slice(0, 80) || null;
  const sdkVersion = String(input.envelope.context?.library?.version || '').slice(0, 80) || null;
  db.prepare(`INSERT INTO ${journeyEventDataTables.rawEvents}
    (received_at,id,space_id,source_id,environment,credential_id,event_id,protocol_version,event_call,event_name,event_version,
      occurred_at,sent_at,schema_version_id,anonymous_id_hash,user_id_hash,account_id_hash,session_id_hash,channel,
      consent_state,payload_json,context_json,consent_json,validation_issues_json,envelope_sha256,payload_bytes,
      sdk_name,sdk_version,ingest_state,retention_expires_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      input.receivedAt, rawEventId, input.principal.spaceId, input.principal.sourceId, input.principal.environment,
      input.principal.credentialId, input.envelope.eventId, input.envelope.protocolVersion, input.envelope.call,
      input.envelope.event || null, input.envelope.eventVersion || null, input.envelope.occurredAt,
      input.envelope.sentAt || null, input.schemaVersionId,
      ...identifierFields.map((field) => identityHash(input.identityKey, input.envelope[field])),
      channelFor(input.envelope, input.principal), consentState(input.envelope), persistedPayload(input.envelope),
      JSON.stringify(input.envelope.context || {}), JSON.stringify(input.envelope.consent || {}),
      JSON.stringify(input.outcome === 'quarantined' ? input.issues : []),
      input.sha256, input.payloadBytes, sdkName, sdkVersion, input.outcome, input.retentionExpiresAt
    );
  insertReceipt({
    id: receiptId, receivedAt: input.receivedAt, principal: input.principal, eventId: input.envelope.eventId,
    sha256: input.sha256, rawEventId, outcome: input.outcome, httpStatus: 202, errorCode: null,
    requestId: input.requestId, batchId: input.batchId, retentionExpiresAt: input.retentionExpiresAt
  });
  insertDedupe({
    principal: input.principal, eventId: input.envelope.eventId, sha256: input.sha256, rawEventId,
    receivedAt: input.receivedAt, receiptId, result, httpStatus: 202, retentionExpiresAt: input.retentionExpiresAt
  });
  // Warn-mode quarantine is durable evidence, not executable work. It must be
  // promoted by a future explicit, audited tracking-plan resolution flow; a
  // worker must never silently evaluate it merely because ingestion succeeded.
  if (input.outcome === 'accepted') {
    db.prepare(`INSERT INTO ${journeyEventDataTables.processingInbox}
      (raw_received_at,raw_event_id,processor,space_id,source_id,environment,event_id,state,available_at,
        lease_owner,lease_token,lease_generation,lease_expires_at,attempt_count,last_error_code,updated_at)
      VALUES (?,?, 'connected_journey_v1',?,?,?,?, 'pending',?,NULL,NULL,0,NULL,0,NULL,?)`).run(
        input.receivedAt, rawEventId, input.principal.spaceId, input.principal.sourceId, input.principal.environment,
        input.envelope.eventId, input.receivedAt, input.receivedAt
      );
  }
  return result;
}

function credential(candidate: string, at: string) {
  const principal = verifyStoredJourneyEventCredential(candidate, at);
  if (!principal) throw new JourneyEventIngestionError('The event credential is invalid.', 401, 'EVENT_CREDENTIAL_INVALID');
  return principal as JourneyIngestPrincipal;
}

export function authenticateJourneyEventCredential(candidate: string, now?: Date | string) {
  return credential(candidate, nowIso(now));
}

function revalidatePrincipal(principal: JourneyIngestPrincipal, at: string) {
  const row = db.prepare(`SELECT credential.id FROM journey_event_credentials credential
    JOIN journey_event_sources source ON source.id=credential.source_id AND source.space_id=credential.space_id
    WHERE credential.id=? AND credential.space_id=? AND credential.source_id=? AND credential.environment=?
      AND credential.kind=? AND credential.scope='events:write' AND credential.status IN ('active','overlap')
      AND source.status='active' AND source.environment=credential.environment
      AND (credential.expires_at IS NULL OR credential.expires_at>?) LIMIT 1`).get(
        principal.credentialId, principal.spaceId, principal.sourceId, principal.environment, principal.kind, at
      ) as { id?: string } | undefined;
  if (!row?.id) throw new JourneyEventIngestionError('The event credential is invalid.', 401, 'EVENT_CREDENTIAL_INVALID');
}

export function syntacticallySafeJourneyEventCorsOrigin(origin: string | null) {
  if (!origin || origin.length > 2_048) return null;
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || !['http:', 'https:'].includes(parsed.protocol)) return null;
    if (parsed.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) return null;
    return origin;
  } catch { return null; }
}

export function recordJourneyEventProtocolRejection(input: {
  principal: JourneyIngestPrincipal;
  payload: unknown;
  binding: JourneyIngestRequestBinding;
  eventId?: string | null;
  batchId?: string | null;
  code: string;
  message: string;
  fieldPath: string;
  status: 413 | 422;
  requestId: string;
  now?: Date | string;
  beforeCommit?: () => void;
}) {
  const receivedAt = nowIso(input.now);
  const payload = journeyEventPayloadFingerprint(input.payload);
  try {
    return db.transaction(() => {
      const source = sourcePolicy(lockSource(input.principal.spaceId, input.principal.sourceId));
      revalidatePrincipal(input.principal, receivedAt);
      assertSubscriptionFeature(input.principal.spaceId, 'journeyConnected');
      const bindingIssue = authoriseJourneyIngestBinding({ principal: input.principal, source, binding: input.binding });
      if (bindingIssue) throw new JourneyEventIngestionError(
        bindingIssue.message, 403, bindingIssue.code, false, input.eventId || null, bindingIssue.path
      );
      const retentionDays = Number(effectiveSubscriptionForSpace(input.principal.spaceId).plan.limits.eventRetentionDays || 30);
      persistProtocolRejection({
        principal: input.principal, eventId: input.eventId || null, sha256: payload.contentSha256,
        payloadBytes: Math.min(2_097_152, payload.payloadBytes), receivedAt, requestId: input.requestId,
        batchId: input.batchId || null, code: input.code, message: input.message, fieldPath: input.fieldPath,
        status: input.status, retentionExpiresAt: plusDays(receivedAt, retentionDays)
      });
      input.beforeCommit?.();
    })();
  } catch (error) {
    if (error instanceof JourneyEventIngestionError || error instanceof SubscriptionEntitlementError) throw error;
    throw new JourneyEventIngestionError('Durable rejection recording is temporarily unavailable.', 503,
      'EVENT_DURABLE_STORAGE_UNAVAILABLE', true, input.eventId || null);
  }
}

export function ingestJourneyEvent(input: {
  credential?: string;
  principal?: JourneyIngestPrincipal;
  envelope: unknown;
  binding: JourneyIngestRequestBinding;
  batchId?: string | null;
  now?: Date | string;
  requestId?: string;
  beforeCommit?: () => void;
}): JourneyEventIngestOutcome {
  const receivedAt = nowIso(input.now);
  const requestId = input.requestId || crypto.randomUUID();
  const principal = input.principal || credential(String(input.credential || ''), receivedAt);
  const checked = validateEventEnvelope(input.envelope);
  if (!checked.ok) {
    const first = checked.errors[0];
    const status = (checked.errors.some((entry) => entry.code === 'MAX_BYTES') ? 413 : 422) as 413 | 422;
    const code = `PROTOCOL_${first?.code || 'INVALID'}`;
    const message = first?.message || 'The event envelope is invalid.';
    const fieldPath = first?.path || '$';
    const candidateId = input.envelope && typeof input.envelope === 'object'
      && typeof (input.envelope as any).eventId === 'string' ? String((input.envelope as any).eventId) : '';
    const eventId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(candidateId)
      ? candidateId : null;
    recordJourneyEventProtocolRejection({
      principal, payload: input.envelope, binding: input.binding, eventId, batchId: input.batchId || null,
      code, message, fieldPath, status, requestId, now: receivedAt, beforeCommit: input.beforeCommit
    });
    throw new JourneyEventIngestionError(message, status, code, false, eventId, fieldPath,
      principal.kind === 'public_write' && Boolean(input.binding.origin));
  }
  const envelope = checked.value;
  const fingerprint = journeyEventEnvelopeFingerprint(envelope);
  // Accepted facts need the dedicated identity key, while an immutable
  // dedupe row can be replayed without it. The unlocked observation is only an
  // I/O optimisation; the authoritative dedupe decision is repeated under the
  // source lock below.
  const observedPrior = priorEvent(principal.spaceId, principal.sourceId, envelope.eventId);
  const identityKey = observedPrior ? null : requireIdentityHashKey();
  try {
    return db.transaction(() => {
      const sourceRow = lockSource(principal.spaceId, principal.sourceId);
      revalidatePrincipal(principal, receivedAt);
      const source = sourcePolicy(sourceRow);
      assertSubscriptionFeature(principal.spaceId, 'journeyConnected');
      const bindingIssue = authoriseJourneyIngestBinding({ principal, source, binding: input.binding });
      if (bindingIssue) throw new JourneyEventIngestionError(bindingIssue.message, 403, bindingIssue.code, false, envelope.eventId, bindingIssue.path);

      const retentionDays = Number(effectiveSubscriptionForSpace(principal.spaceId).plan.limits.eventRetentionDays || 30);
      const retentionExpiresAt = plusDays(receivedAt, retentionDays);

      const prior = priorEvent(principal.spaceId, principal.sourceId, envelope.eventId);
      if (prior) {
        if (prior.envelope_sha256 !== fingerprint.contentSha256) {
          const result = eventResult({
            eventId: envelope.eventId, status: 'rejected', receivedAt, code: 'EVENT_ID_CONFLICT',
            message: 'This eventId was already used with different content.'
          });
          insertReceipt({
            id: crypto.randomUUID(), receivedAt, principal, eventId: envelope.eventId,
            sha256: fingerprint.contentSha256, rawEventId: null, rawReceivedAt: null,
            outcome: 'content_conflict', httpStatus: 409, errorCode: 'EVENT_ID_CONFLICT', requestId,
            batchId: input.batchId || null,
            attemptOrdinal: nextAttemptOrdinal(principal.spaceId, principal.sourceId, envelope.eventId),
            retentionExpiresAt
          });
          input.beforeCommit?.();
          return { httpStatus: 409, result, requestId, replayed: false };
        }
        const replay = replayPrior(prior, requestId);
        insertReceipt({
          id: crypto.randomUUID(), receivedAt, principal, eventId: envelope.eventId,
          sha256: fingerprint.contentSha256, rawEventId: prior.raw_event_id,
          rawReceivedAt: prior.raw_received_at, outcome: 'duplicate', httpStatus: 200,
          errorCode: null, requestId, batchId: input.batchId || null,
          attemptOrdinal: nextAttemptOrdinal(principal.spaceId, principal.sourceId, envelope.eventId),
          retentionExpiresAt
        });
        input.beforeCommit?.();
        return replay;
      }
      if (!consumeRate(source, receivedAt, fingerprint.payloadBytes)) {
        const result = persistRejection({
          principal, eventId: envelope.eventId, sha256: fingerprint.contentSha256,
          payloadBytes: fingerprint.payloadBytes, receivedAt, requestId, batchId: input.batchId || null,
          code: 'EVENT_SOURCE_RATE_LIMITED', message: 'The source minute event or byte limit was exceeded.',
          fieldPath: '$', status: 429, receiptOutcome: 'rate_limited', retentionExpiresAt
        });
        input.beforeCommit?.();
        return { httpStatus: 429, result, requestId, replayed: false };
      }

      const schema = schemaForEnvelope(principal.spaceId, principal.sourceId, envelope);
      const prepared = prepareJourneyEvent({ envelope, principal, source, schema, receivedAt });
      if (!prepared.ok) {
        const result = persistRejection({
          principal, eventId: envelope.eventId, sha256: fingerprint.contentSha256,
          payloadBytes: fingerprint.payloadBytes, receivedAt, requestId, batchId: input.batchId || null,
          code: prepared.issue.code, message: prepared.issue.message, fieldPath: prepared.issue.path,
          status: prepared.status,
          receiptOutcome: prepared.issue.code === 'EVENT_CONSENT_DENIED' ? 'consent_denied' : 'rejected',
          retentionExpiresAt
        });
        input.beforeCommit?.();
        return { httpStatus: prepared.status, result, requestId, replayed: false };
      }

      try {
        consumeSubscriptionUsage({
          spaceId: principal.spaceId,
          quota: 'monthlyTrackedEvents',
          idempotencyKey: `journey-event:${principal.sourceId}:${envelope.eventId}`,
          intent: { sourceId: principal.sourceId, eventId: envelope.eventId, sha256: fingerprint.contentSha256 },
          sourceType: 'journey_event', sourceId: envelope.eventId, actorUserId: null, now: receivedAt
        });
      } catch (error) {
        if (!(error instanceof SubscriptionEntitlementError) || error.code !== 'SUBSCRIPTION_QUOTA_EXCEEDED') throw error;
        const result = persistRejection({
          principal, eventId: envelope.eventId, sha256: fingerprint.contentSha256,
          payloadBytes: fingerprint.payloadBytes, receivedAt, requestId, batchId: input.batchId || null,
          code: 'EVENT_MONTHLY_QUOTA_EXCEEDED', message: 'The space monthly tracked-event allowance is exhausted.',
          fieldPath: '$', status: 429, receiptOutcome: 'over_quota', retentionExpiresAt
        });
        input.beforeCommit?.();
        return { httpStatus: 429, result, requestId, replayed: false };
      }

      const result = persistAccepted({
        principal, envelope: prepared.value.envelope, canonicalJson: prepared.value.canonicalJson,
        sha256: fingerprint.contentSha256, payloadBytes: fingerprint.payloadBytes,
        schemaVersionId: prepared.value.schemaVersionId, outcome: prepared.value.outcome,
        issues: prepared.value.issues, receivedAt, requestId, batchId: input.batchId || null,
        retentionExpiresAt, identityKey: identityKey || (() => {
          throw new JourneyEventIngestionError('Journey identity hashing is not configured.', 503,
            'EVENT_IDENTITY_HASH_UNAVAILABLE', true, envelope.eventId);
        })()
      });
      input.beforeCommit?.();
      return { httpStatus: 202, result, requestId, replayed: false };
    })();
  } catch (error) {
    if (error instanceof JourneyEventIngestionError || error instanceof SubscriptionEntitlementError) throw error;
    throw new JourneyEventIngestionError('Durable event acceptance is temporarily unavailable.', 503,
      'EVENT_DURABLE_STORAGE_UNAVAILABLE', true, envelope.eventId);
  }
}

type DataCursor = { at: string; id: string };

function encodeDataCursor(value: DataCursor) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeDataCursor(value: string | undefined) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { at?: unknown; id?: unknown };
    const at = nowIso(String(parsed.at || ''));
    const id = String(parsed.id || '');
    if (!id || id.length > 128 || /[^A-Za-z0-9._:-]/u.test(id)) throw new Error('bad id');
    return { at, id };
  } catch {
    throw new JourneyEventIngestionError('The data cursor is invalid.', 400, 'EVENT_DATA_CURSOR_INVALID');
  }
}

function boundedListLimit(value: number | undefined) {
  const limit = value ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new JourneyEventIngestionError('List limit must be between 1 and 100.', 400, 'EVENT_DATA_LIMIT_INVALID');
  }
  return limit;
}

function requireSourceForData(spaceId: string, sourceId: string) {
  assertSubscriptionFeature(spaceId, 'journeyConnected');
  const row = db.prepare(`${sourceSelect} WHERE id=? AND space_id=?`).get(sourceId, spaceId) as SourceRow | undefined;
  if (!row) throw new JourneyEventIngestionError('Event source not found.', 404, 'JOURNEY_EVENT_SOURCE_NOT_FOUND');
  return sourcePolicy(row);
}

function appendDataAudit(input: {
  spaceId: string;
  source: JourneyEventSourcePolicy;
  actorUserId: string;
  action: 'debug.viewed' | 'rejection.viewed' | 'dead_letter.viewed' | 'dead_letter.replay_requested' | 'dead_letter.resolved' | 'event.redacted';
  targetType: 'raw_event' | 'ingest_receipt' | 'rejection' | 'dead_letter' | 'processing_receipt';
  targetId: string;
  detail?: Record<string, unknown>;
  at: string;
}) {
  db.prepare(`INSERT INTO ${journeyEventDataTables.dataAudit}
    (id,space_id,source_id,environment,action,target_type,target_id,actor_user_id,detail_json,created_at,retention_expires_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      crypto.randomUUID(), input.spaceId, input.source.sourceId, input.source.environment, input.action,
      input.targetType, input.targetId, input.actorUserId, JSON.stringify(input.detail || {}), input.at, plusDays(input.at, 365)
    );
}

function redactedIssues(raw: unknown, rejectionCode: unknown, rejectionPath: unknown) {
  const entries = parseJson<Array<{ code?: unknown; path?: unknown }>>(raw, []);
  const output = entries.slice(0, 50).map((entry) => ({
    code: String(entry.code || '').slice(0, 100),
    path: String(entry.path || '$').slice(0, 240)
  })).filter((entry) => entry.code);
  if (!output.length && rejectionCode) output.push({
    code: String(rejectionCode).slice(0, 100), path: String(rejectionPath || '$').slice(0, 240)
  });
  return output;
}

export function listJourneyEventDebugEvents(input: {
  spaceId: string;
  sourceId: string;
  actorUserId: string;
  limit?: number;
  cursor?: string;
  outcome?: 'accepted' | 'quarantined' | 'duplicate' | 'content_conflict' | 'rejected' | 'rate_limited' | 'over_quota' | 'consent_denied';
}) {
  const source = requireSourceForData(input.spaceId, input.sourceId);
  const limit = boundedListLimit(input.limit);
  const cursor = decodeDataCursor(input.cursor);
  const conditions = ['receipt.space_id=?', 'receipt.source_id=?'];
  const parameters: unknown[] = [input.spaceId, input.sourceId];
  if (input.outcome) { conditions.push('receipt.outcome=?'); parameters.push(input.outcome); }
  if (cursor) {
    conditions.push('(receipt.received_at<? OR (receipt.received_at=? AND receipt.id<?))');
    parameters.push(cursor.at, cursor.at, cursor.id);
  }
  parameters.push(limit + 1);
  const rows = db.prepare(`SELECT receipt.id receipt_id,receipt.received_at,receipt.event_id,receipt.outcome,
      receipt.error_code,receipt.request_id,receipt.batch_id,raw.event_call,raw.event_name,raw.event_version,
      raw.schema_version_id,raw.payload_bytes,raw.sdk_name,raw.sdk_version,raw.validation_issues_json,
      rejection.code rejection_code,rejection.field_path rejection_path,rejection.payload_bytes rejection_payload_bytes,
      inbox.state processing_state
    FROM ${journeyEventDataTables.ingestReceipts} receipt
    LEFT JOIN ${journeyEventDataTables.rawEvents} raw
      ON raw.received_at=receipt.raw_received_at AND raw.id=receipt.raw_event_id
    LEFT JOIN ${journeyEventDataTables.rejections} rejection
      ON rejection.ingest_received_at=receipt.received_at AND rejection.ingest_receipt_id=receipt.id
    LEFT JOIN ${journeyEventDataTables.processingInbox} inbox
      ON inbox.raw_received_at=raw.received_at AND inbox.raw_event_id=raw.id AND inbox.processor='connected_journey_v1'
    WHERE ${conditions.join(' AND ')} ORDER BY receipt.received_at DESC,receipt.id DESC LIMIT ?`)
    .all(...parameters) as Array<Record<string, unknown>>;
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const events = page.map((row) => ({
    receiptId: String(row.receipt_id),
    receivedAt: String(row.received_at),
    eventId: row.event_id ? String(row.event_id) : null,
    outcome: String(row.outcome),
    call: row.event_call ? String(row.event_call) : null,
    eventName: row.event_name ? String(row.event_name) : null,
    version: row.event_version === null || row.event_version === undefined ? null : Number(row.event_version),
    schemaVersionId: row.schema_version_id ? String(row.schema_version_id) : null,
    code: row.error_code ? String(row.error_code) : null,
    requestId: String(row.request_id),
    batchId: row.batch_id ? String(row.batch_id) : null,
    payloadBytes: Number(row.payload_bytes ?? row.rejection_payload_bytes ?? 0),
    sdkName: row.sdk_name ? String(row.sdk_name) : null,
    sdkVersion: row.sdk_version ? String(row.sdk_version) : null,
    issues: redactedIssues(row.validation_issues_json, row.rejection_code, row.rejection_path),
    processingState: row.processing_state ? String(row.processing_state) : null
  }));
  if (events.length) appendDataAudit({
    spaceId: input.spaceId, source, actorUserId: input.actorUserId, action: 'debug.viewed',
    targetType: 'ingest_receipt', targetId: events[0]!.receiptId,
    detail: { count: events.length, outcome: input.outcome || null }, at: new Date().toISOString()
  });
  const last = page[page.length - 1];
  return {
    events,
    nextCursor: hasMore && last ? encodeDataCursor({ at: String(last.received_at), id: String(last.receipt_id) }) : null
  };
}

const deadLetterMessages: Record<string, string> = {
  EVENT_SCHEMA_PROCESSING_FAILED: 'The event could not be processed against its published tracking plan.',
  EVENT_IDENTITY_PROCESSING_FAILED: 'The event could not be applied to the connected customer identity.',
  EVENT_STAGE_PROCESSING_FAILED: 'The event could not be evaluated against published journey stage rules.',
  EVENT_PROCESSING_ATTEMPTS_EXHAUSTED: 'Processing failed after the permitted attempts.'
};

type DeadLetterRow = {
  id: string; raw_received_at: string; raw_event_id: string; space_id: string; source_id: string;
  environment: JourneyEventSourcePolicy['environment']; event_id: string; processor: string;
  state: 'pending' | 'replay_scheduled' | 'resolved' | 'terminal'; failure_code: string;
  attempt_count: number | string; replay_eligible: number | boolean; replay_after: string | null;
  updated_at: string; event_name?: string | null;
};

function replayIneligibleReason(row: DeadLetterRow, source: JourneyEventSourcePolicy, at: string) {
  if (source.status !== 'active') return 'source_inactive';
  if (row.state !== 'pending') return row.state === 'replay_scheduled' ? 'already_scheduled' : 'terminal_state';
  if (!Boolean(row.replay_eligible)) return 'not_eligible';
  if (row.replay_after && Date.parse(row.replay_after) > Date.parse(at)) return 'retry_window_not_reached';
  return null;
}

function publicDeadLetter(row: DeadLetterRow, source: JourneyEventSourcePolicy, at: string) {
  const reason = replayIneligibleReason(row, source, at);
  return {
    id: row.id,
    failedAt: row.updated_at,
    eventId: row.event_id,
    eventName: row.event_name || null,
    processor: row.processor,
    state: row.state,
    failure: {
      code: row.failure_code,
      message: deadLetterMessages[row.failure_code] || 'Processing failed after the permitted attempts.'
    },
    attempts: Number(row.attempt_count),
    replayEligible: reason === null,
    replayIneligibleReason: reason
  };
}

function deadLetterSelect() {
  return `SELECT dead.id,dead.raw_received_at,dead.raw_event_id,dead.space_id,dead.source_id,dead.environment,
    dead.event_id,dead.processor,dead.state,dead.failure_code,dead.attempt_count,dead.replay_eligible,
    dead.replay_after,dead.updated_at,raw.event_name FROM ${journeyEventDataTables.deadLetters} dead
    JOIN ${journeyEventDataTables.rawEvents} raw ON raw.received_at=dead.raw_received_at AND raw.id=dead.raw_event_id`;
}

export function listJourneyEventDeadLetters(input: {
  spaceId: string;
  sourceId: string;
  actorUserId: string;
  limit?: number;
  cursor?: string;
  state?: DeadLetterRow['state'];
}) {
  const source = requireSourceForData(input.spaceId, input.sourceId);
  const limit = boundedListLimit(input.limit);
  const cursor = decodeDataCursor(input.cursor);
  const conditions = ['dead.space_id=?', 'dead.source_id=?'];
  const parameters: unknown[] = [input.spaceId, input.sourceId];
  if (input.state) { conditions.push('dead.state=?'); parameters.push(input.state); }
  if (cursor) {
    conditions.push('(dead.updated_at<? OR (dead.updated_at=? AND dead.id<?))');
    parameters.push(cursor.at, cursor.at, cursor.id);
  }
  parameters.push(limit + 1);
  const rows = db.prepare(`${deadLetterSelect()} WHERE ${conditions.join(' AND ')}
    ORDER BY dead.updated_at DESC,dead.id DESC LIMIT ?`).all(...parameters) as DeadLetterRow[];
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const at = new Date().toISOString();
  const last = page[page.length - 1];
  if (page.length) appendDataAudit({
    spaceId: input.spaceId, source, actorUserId: input.actorUserId, action: 'dead_letter.viewed',
    targetType: 'dead_letter', targetId: page[0]!.id,
    detail: { count: page.length, state: input.state || null }, at
  });
  return {
    deadLetters: page.map((row) => publicDeadLetter(row, source, at)),
    nextCursor: hasMore && last ? encodeDataCursor({ at: last.updated_at, id: last.id }) : null
  };
}

export function replayJourneyEventDeadLetter(input: {
  spaceId: string;
  deadLetterId: string;
  actorUserId: string;
  now?: Date | string;
}) {
  const at = nowIso(input.now);
  return db.transaction(() => {
    if (db.provider === 'postgres') db.prepare('SELECT id FROM spaces WHERE id=? FOR UPDATE').get(input.spaceId);
    assertSubscriptionFeature(input.spaceId, 'journeyConnected');
    const suffix = db.provider === 'postgres' ? ' FOR UPDATE OF dead' : '';
    const row = db.prepare(`${deadLetterSelect()} WHERE dead.space_id=? AND dead.id=?${suffix}`)
      .get(input.spaceId, input.deadLetterId) as DeadLetterRow | undefined;
    if (!row) throw new JourneyEventIngestionError('Dead letter not found.', 404, 'EVENT_DEAD_LETTER_NOT_FOUND');
    const source = requireSourceForData(input.spaceId, row.source_id);
    if (row.state === 'replay_scheduled') return { deadLetter: publicDeadLetter(row, source, at), replayed: true };
    const reason = replayIneligibleReason(row, source, at);
    if (reason) throw new JourneyEventIngestionError(
      'This dead letter is not eligible for replay.', 409, 'EVENT_DEAD_LETTER_REPLAY_INELIGIBLE', false, row.event_id
    );
    const inbox = db.prepare(`UPDATE ${journeyEventDataTables.processingInbox} SET
      state='pending',available_at=?,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,last_error_code=NULL,updated_at=?
      WHERE raw_received_at=? AND raw_event_id=? AND processor=? AND space_id=? AND source_id=? AND state='dead_lettered'`)
      .run(at, at, row.raw_received_at, row.raw_event_id, row.processor, input.spaceId, row.source_id);
    if (inbox.changes !== 1) throw new JourneyEventIngestionError(
      'The processing lease changed before replay could be scheduled.', 409, 'EVENT_DEAD_LETTER_REPLAY_FENCED', true, row.event_id
    );
    db.prepare(`UPDATE ${journeyEventDataTables.deadLetters} SET state='replay_scheduled',replay_after=?,updated_at=?
      WHERE id=? AND space_id=? AND state='pending' AND replay_eligible=TRUE`).run(at, at, row.id, input.spaceId);
    appendDataAudit({
      spaceId: input.spaceId, source, actorUserId: input.actorUserId, action: 'dead_letter.replay_requested',
      targetType: 'dead_letter', targetId: row.id,
      detail: { processor: row.processor, attemptCount: Number(row.attempt_count) }, at
    });
    const updated = db.prepare(`${deadLetterSelect()} WHERE dead.space_id=? AND dead.id=?`)
      .get(input.spaceId, row.id) as DeadLetterRow;
    return { deadLetter: publicDeadLetter(updated, source, at), replayed: false };
  })();
}

export function journeyEventIngestionUsage(spaceId: string, now?: Date | string) {
  assertSubscriptionFeature(spaceId, 'journeyConnected');
  return { monthlyTrackedEvents: meteredUsageSnapshot(spaceId, 'monthlyTrackedEvents', now || new Date()) };
}
