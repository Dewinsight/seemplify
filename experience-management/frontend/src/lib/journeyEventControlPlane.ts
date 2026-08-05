import { api, json } from '@/lib/api';

export const JOURNEY_EVENT_CONTROL_PLANE_BASE = '/api/journey-event-control-plane' as const;

export type JourneyEventEnvironment = 'development' | 'staging' | 'production';
export type JourneyEventValidationMode = 'observe' | 'warn' | 'enforce';
export type JourneyEventSourceStatus = 'active' | 'paused' | 'revoked';
export type JourneyEventCredentialKind = 'public_write' | 'server_secret';
export type JourneyEventCredentialStatus = 'active' | 'overlap' | 'revoked';
export type JourneyEventSchemaState = 'draft' | 'published' | 'deprecated' | 'retired';
export type JourneyEventPropertyType = 'string' | 'number' | 'boolean' | 'object' | 'array';
export type JourneyEventDataClass = 'operational' | 'personal' | 'sensitive' | 'prohibited_content';

export interface JourneyEventSource {
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
}

export interface JourneyEventCredential {
  id: string;
  sourceId: string;
  kind: JourneyEventCredentialKind;
  displayPrefix: string;
  status: JourneyEventCredentialStatus;
  scope: 'events:write';
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  rotatedFromId: string | null;
}

export interface JourneyIssuedCredential {
  secret: string;
  credential: JourneyEventCredential;
}

export interface JourneyEventPropertyDefinition {
  name: string;
  type: JourneyEventPropertyType;
  required: boolean;
  dataClass: JourneyEventDataClass;
  description: string;
  maximumLength?: number | null;
  maximumItems?: number | null;
  enumValues?: Array<string | number | boolean>;
}

export interface JourneyControlPlaneIssue {
  severity: 'error' | 'warning';
  code: string;
  path: string;
  message: string;
}

export interface JourneyEventSchemaVersion {
  id: string;
  schemaId: string;
  sourceId: string;
  spaceId: string;
  version: string;
  state: JourneyEventSchemaState;
  properties: JourneyEventPropertyDefinition[];
  compatibility: { compatible: boolean | null; issues: JourneyControlPlaneIssue[] };
  contentSha256: string;
  createdAt: string;
  publishedAt: string | null;
  deprecatedAt: string | null;
  createdByUserId: string | null;
  publishedByUserId: string | null;
  deprecatedByUserId: string | null;
}

export interface JourneyEventSchema {
  id: string;
  sourceId: string;
  spaceId: string;
  eventName: string;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  versions: JourneyEventSchemaVersion[];
}

export interface JourneyControlPlaneAuditEvent {
  id: string;
  spaceId: string;
  sourceId: string | null;
  actorUserId: string | null;
  action: string;
  targetType: 'source' | 'credential' | 'schema' | 'schema_version' | string;
  targetKind: 'source' | 'credential' | 'schema' | 'schema_version';
  targetId: string;
  actor: { id: string; name: string } | null;
  summary: string;
  detail: Record<string, unknown>;
  beforeFingerprint: string | null;
  afterFingerprint: string | null;
  createdAt: string;
}

export interface JourneyDebugEventIssue {
  code: string;
  path: string;
}

export type JourneyDebugEventOutcome = 'accepted' | 'quarantined' | 'duplicate' | 'content_conflict' |
  'rejected' | 'rate_limited' | 'over_quota' | 'consent_denied';
export type JourneyDebugProcessingState = 'pending' | 'leased' | 'retry_wait' | 'dead_lettered' | 'completed' | null;

/**
 * Deliberately limited to receipt and routing metadata. Keep identity,
 * properties, context, consent, payloads, and hashes out of this contract so
 * they cannot accidentally reach the debugger UI.
 */
export interface JourneyDebugEvent {
  receiptId: string;
  receivedAt: string;
  eventId: string | null;
  outcome: JourneyDebugEventOutcome;
  call: string | null;
  eventName: string | null;
  version: number | null;
  schemaVersionId: string | null;
  code: string | null;
  requestId: string | null;
  batchId: string | null;
  payloadBytes: number | null;
  sdkName: string | null;
  sdkVersion: string | null;
  issues: JourneyDebugEventIssue[];
  processingState: JourneyDebugProcessingState;
}

export interface JourneyMonthlyTrackedEventUsage {
  quota: 'monthlyTrackedEvents';
  kind: 'metered';
  periodStart: string;
  periodEnd: string;
  resetAt: string;
  used: number;
  limit: number;
  remaining: number;
  percentUsed: number;
  projectedPeriodEnd: number;
  warningLevel: 'normal' | 'approaching' | 'warning' | 'exhausted';
}

export interface JourneyIngestionUsage {
  monthlyTrackedEvents: JourneyMonthlyTrackedEventUsage;
}

export interface JourneyEventDeadLetter {
  id: string;
  failedAt: string;
  eventId: string;
  eventName: string | null;
  processor: string;
  state: 'pending' | 'replay_scheduled' | 'resolved' | 'terminal';
  failure: { code: string; message: string };
  attempts: number;
  replayEligible: boolean;
  replayIneligibleReason: string | null;
}

export interface JourneyEventSourceInput {
  name: string;
  environment: JourneyEventEnvironment;
  validationMode: JourneyEventValidationMode;
  allowedOrigins: string[];
  allowedBundleIds: string[];
  eventsPerMinute: number;
  bytesPerMinute: number;
}

export interface JourneyEventSchemaInput {
  eventName: string;
  version: string;
  properties: JourneyEventPropertyDefinition[];
}

/**
 * Frontend/backend envelope contract for the customer control-plane routes.
 * List reads return named arrays, detail reads return the named resource, and
 * secret-bearing writes return a top-level one-time `secret` beside the safe
 * credential record. Secrets are never included in a later GET response.
 * Audit rows include a server-produced safe summary; the UI never renders the
 * raw `detail` map or credential material.
 */
export const journeyEventControlPlaneContract = {
  sources: {
    list: 'GET /sources -> { sources, quota: { used, limit, remaining } }',
    create: 'POST /sources -> { source }',
    read: 'GET /sources/:sourceId -> { source }',
    update: 'PATCH /sources/:sourceId -> { source }'
  },
  credentials: {
    list: 'GET /sources/:sourceId/credentials -> { credentials }',
    create: 'POST /sources/:sourceId/credentials -> { secret?, credential, replayed }',
    rotate: 'POST /credentials/:credentialId/rotate -> { secret?, credential, replayed }',
    revoke: 'POST /credentials/:credentialId/revoke -> { credential }'
  },
  schemas: {
    list: 'GET /sources/:sourceId/schemas -> { schemas[] including versions }',
    create: 'POST /sources/:sourceId/schemas -> { schema, replayed }',
    read: 'GET /schemas/:schemaId -> { schema }',
    createVersion: 'POST /schemas/:schemaId/versions -> { version, replayed }',
    publish: 'POST /schema-versions/:versionId/publish -> { version, replayed }',
    deprecate: 'POST /schema-versions/:versionId/deprecate -> { version, replayed }'
  },
  audit: 'GET /sources/:sourceId/audit?cursor=<opaque>&limit=<n> -> { events, nextCursor }',
  ingestionOperations: {
    debugger: 'GET /sources/:sourceId/debug-events?cursor=<opaque>&limit=<n>&outcome=<filter> -> { events, nextCursor }',
    deadLetters: 'GET /sources/:sourceId/dead-letters?cursor=<opaque>&limit=<n>&state=<filter> -> { deadLetters, nextCursor }',
    replay: 'POST /dead-letters/:deadLetterId/replay { confirmation: true } -> { deadLetter, replayed }',
    usage: 'GET /sources/:sourceId/ingestion-usage -> { monthlyTrackedEvents: { used, limit, remaining, warning? } }'
  }
} as const;

function resource(path: string) {
  return `${JOURNEY_EVENT_CONTROL_PLANE_BASE}${path}`;
}

function idempotencyKey(operation: string) {
  const entropy = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `journey-${operation}-${entropy}`.slice(0, 96);
}

function post<T>(path: string, operation: string, body: unknown = {}) {
  const options = json('POST', body);
  options.headers = { 'Idempotency-Key': idempotencyKey(operation) };
  return api<T>(resource(path), options);
}

export async function listJourneyEventSources() {
  return api<{ sources: JourneyEventSource[]; quota: { used: number; limit: number; remaining: number } }>(resource('/sources'));
}

export async function createJourneyEventSource(input: JourneyEventSourceInput) {
  return post<{ source: JourneyEventSource }>('/sources', 'source-create', input);
}

export async function readJourneyEventSource(sourceId: string) {
  return api<{ source: JourneyEventSource }>(resource(`/sources/${encodeURIComponent(sourceId)}`));
}

export async function updateJourneyEventSource(sourceId: string, expectedRevision: number, input: Partial<JourneyEventSourceInput> & { status?: JourneyEventSourceStatus }) {
  return api<{ source: JourneyEventSource }>(
    resource(`/sources/${encodeURIComponent(sourceId)}`),
    json('PATCH', { expectedRevision, ...input })
  );
}

export async function listJourneyEventCredentials(sourceId: string) {
  return api<{ credentials: JourneyEventCredential[] }>(resource(`/sources/${encodeURIComponent(sourceId)}/credentials`));
}

export async function createJourneyEventCredential(sourceId: string, kind: JourneyEventCredentialKind) {
  return post<{ secret?: string; credential: JourneyEventCredential; replayed: boolean }>(
    `/sources/${encodeURIComponent(sourceId)}/credentials`,
    'credential-create',
    { kind }
  );
}

export async function rotateJourneyEventCredential(credentialId: string, overlapSeconds: number) {
  return post<{ secret?: string; credential: JourneyEventCredential; replayed: boolean }>(
    `/credentials/${encodeURIComponent(credentialId)}/rotate`,
    'credential-rotate',
    { overlapSeconds }
  );
}

export async function revokeJourneyEventCredential(credentialId: string) {
  return post<{ credential: JourneyEventCredential }>(
    `/credentials/${encodeURIComponent(credentialId)}/revoke`,
    'credential-revoke'
  );
}

export async function listJourneyEventSchemas(sourceId: string) {
  return api<{ schemas: JourneyEventSchema[] }>(resource(`/sources/${encodeURIComponent(sourceId)}/schemas`));
}

export async function createJourneyEventSchema(sourceId: string, input: JourneyEventSchemaInput) {
  const created = await post<{ schema: JourneyEventSchema; replayed: boolean }>(
    `/sources/${encodeURIComponent(sourceId)}/schemas`,
    'schema-create',
    { eventName: input.eventName }
  );
  await post<{ version: JourneyEventSchemaVersion; replayed: boolean }>(
    `/schemas/${encodeURIComponent(created.schema.id)}/versions`,
    'schema-version-create',
    { version: input.version, properties: input.properties }
  );
  return readJourneyEventSchema(created.schema.id);
}

export async function readJourneyEventSchema(schemaId: string) {
  return api<{ schema: JourneyEventSchema }>(resource(`/schemas/${encodeURIComponent(schemaId)}`));
}

export async function createJourneyEventSchemaVersion(schemaId: string, input: Omit<JourneyEventSchemaInput, 'eventName'>) {
  await post<{ version: JourneyEventSchemaVersion; replayed: boolean }>(
    `/schemas/${encodeURIComponent(schemaId)}/versions`,
    'schema-version-create',
    input
  );
  return readJourneyEventSchema(schemaId);
}

export async function publishJourneyEventSchemaVersion(versionId: string) {
  return post<{ version: JourneyEventSchemaVersion; replayed: boolean }>(
    `/schema-versions/${encodeURIComponent(versionId)}/publish`,
    'schema-version-publish'
  );
}

export async function deprecateJourneyEventSchemaVersion(versionId: string) {
  return post<{ version: JourneyEventSchemaVersion; replayed: boolean }>(
    `/schema-versions/${encodeURIComponent(versionId)}/deprecate`,
    'schema-version-deprecate'
  );
}

export async function listJourneyEventAudit(sourceId: string, cursor = '', limit = 50) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  return api<{ events: JourneyControlPlaneAuditEvent[]; nextCursor: string | null }>(
    resource(`/sources/${encodeURIComponent(sourceId)}/audit?${params}`)
  );
}

export async function listJourneyDebugEvents(sourceId: string, options: { cursor?: string; limit?: number; outcome?: string } = {}) {
  const params = new URLSearchParams({ limit: String(options.limit ?? 50) });
  if (options.cursor) params.set('cursor', options.cursor);
  if (options.outcome) params.set('outcome', options.outcome);
  return api<{ events: JourneyDebugEvent[]; nextCursor: string | null }>(
    resource(`/sources/${encodeURIComponent(sourceId)}/debug-events?${params}`)
  );
}

export async function listJourneyEventDeadLetters(sourceId: string, options: { cursor?: string; limit?: number; state?: string } = {}) {
  const params = new URLSearchParams({ limit: String(options.limit ?? 50) });
  if (options.cursor) params.set('cursor', options.cursor);
  if (options.state) params.set('state', options.state);
  return api<{ deadLetters: JourneyEventDeadLetter[]; nextCursor: string | null }>(
    resource(`/sources/${encodeURIComponent(sourceId)}/dead-letters?${params}`)
  );
}

export async function replayJourneyEventDeadLetter(deadLetterId: string) {
  return post<{ deadLetter: JourneyEventDeadLetter; replayed: boolean }>(
    `/dead-letters/${encodeURIComponent(deadLetterId)}/replay`,
    'dead-letter-replay',
    { confirmation: true }
  );
}

export async function readJourneyEventIngestionUsage(sourceId: string) {
  return api<JourneyIngestionUsage>(resource(`/sources/${encodeURIComponent(sourceId)}/ingestion-usage`));
}
