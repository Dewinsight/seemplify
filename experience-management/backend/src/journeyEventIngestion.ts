import crypto from 'node:crypto';
import {
  validateEventEnvelope,
  type EventIngestResult,
  type JourneyEventEnvelope,
  type ProtocolValidationIssue
} from '@seemplify/journey-event-protocol';
import {
  validateJourneyEventProperties,
  type JourneyControlPlaneIssue,
  type JourneyEventCredentialKind,
  type JourneyEventSchemaVersion,
  type JourneyEventSourcePolicy
} from './journeyEventControlPlane.js';

export const JOURNEY_EVENT_INGESTION_VERSION = 'journey-event-ingestion/v1' as const;
export const journeyEventClockLimits = Object.freeze({
  publicPastMs: 7 * 24 * 60 * 60_000,
  serverPastMs: 365 * 24 * 60 * 60_000,
  futureMs: 10 * 60_000
});

export type JourneyIngestPrincipal = {
  credentialId: string;
  sourceId: string;
  spaceId: string;
  environment: JourneyEventSourcePolicy['environment'];
  kind: JourneyEventCredentialKind;
  scope: 'events:write';
};

export type JourneyIngestRequestBinding = {
  origin: string | null;
  bundleId: string | null;
};

export type JourneyIngestIssue = {
  code: string;
  path: string;
  message: string;
};

export type JourneyPreparedEvent = {
  envelope: JourneyEventEnvelope;
  canonicalJson: string;
  contentSha256: string;
  payloadBytes: number;
  schemaVersionId: string | null;
  outcome: 'accepted' | 'quarantined';
  issues: JourneyIngestIssue[];
  receivedAt: string;
};

export type JourneyPrepareResult =
  | { ok: true; value: JourneyPreparedEvent }
  | { ok: false; status: number; issue: JourneyIngestIssue; eventId: string | null };

const prohibitedKey = /(?:^|_)(?:authorization|cookie|password|passcode|secret|token|access_token|refresh_token|api_key|private_key|credit_card|card_number|cvv|cvc|prompt|body|content|document|transcript|email_body|survey_response|raw_payload)(?:_|$)/iu;
const obviousEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
}

function sha256(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function journeyEventPayloadFingerprint(value: unknown) {
  const canonicalJson = stableJson(value);
  return { canonicalJson, contentSha256: sha256(canonicalJson), payloadBytes: Buffer.byteLength(canonicalJson, 'utf8') };
}

function issue(code: string, path: string, message: string): JourneyIngestIssue {
  return { code, path, message };
}

function firstProtocolIssue(issues: ProtocolValidationIssue[]) {
  const current = issues[0] || { path: '$', code: 'INVALID', message: 'The event is invalid.' };
  return issue(`PROTOCOL_${current.code}`, current.path, current.message);
}

function firstSchemaIssue(issues: JourneyControlPlaneIssue[]) {
  const current = issues.find((entry) => entry.severity === 'error') || issues[0];
  return current
    ? issue(current.code, current.path.startsWith('$') ? current.path : `$.${current.path}`, current.message)
    : issue('EVENT_SCHEMA_INVALID', '$.properties', 'The event does not match its published schema.');
}

function scanProhibited(value: unknown, path = '$'): JourneyIngestIssue | null {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = scanProhibited(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))) {
    const childPath = `${path}.${key}`;
    const normalizedKey = key.replace(/([a-z0-9])([A-Z])/gu, '$1_$2').replace(/[^A-Za-z0-9]+/gu, '_').toLowerCase();
    if (prohibitedKey.test(normalizedKey)) {
      return issue('EVENT_PRIVACY_FIELD_PROHIBITED', childPath, 'Content, credential, and payment fields are prohibited in journey events.');
    }
    const nested = scanProhibited(child, childPath);
    if (nested) return nested;
  }
  return null;
}

function scanUndeclaredIdentifiers(envelope: JourneyEventEnvelope, schema: JourneyEventSchemaVersion | null) {
  for (const key of ['anonymousId', 'userId', 'accountId', 'sessionId'] as const) {
    const value = envelope[key];
    if (typeof value === 'string' && obviousEmail.test(value)) {
      return issue('EVENT_PRIVACY_IDENTIFIER_PROHIBITED', `$.${key}`, 'Raw email addresses are not permitted as default journey identifiers.');
    }
  }
  if (!envelope.properties) return null;
  const classification = new Map((schema?.properties || []).map((property) => [property.name, property.dataClass]));
  for (const [key, value] of Object.entries(envelope.properties)) {
    if (typeof value === 'string' && obviousEmail.test(value)
      && classification.get(key) !== 'personal') {
      return issue('EVENT_PRIVACY_CLASSIFICATION_REQUIRED', `$.properties.${key}`, 'An email-like value requires an explicit personal or sensitive tracking-plan classification.');
    }
  }
  return null;
}

function unexpectedContextField(envelope: JourneyEventEnvelope) {
  if (envelope.traits && Object.keys(envelope.traits).length > 0) {
    return issue('EVENT_TRAITS_POLICY_REQUIRED', '$.traits', 'Traits require a published privacy and classification policy.');
  }
  if (envelope.metric?.dimensions && Object.keys(envelope.metric.dimensions).length > 0) {
    return issue('EVENT_METRIC_DIMENSIONS_POLICY_REQUIRED', '$.metric.dimensions',
      'Metric dimensions require a published classification policy.');
  }
  const context = envelope.context;
  if (!context) return null;
  const allowed: Record<string, ReadonlySet<string> | null> = {
    locale: null,
    timezone: null,
    page: new Set(['url', 'referrer', 'title']),
    device: new Set(['type', 'operatingSystem']),
    library: new Set(['name', 'version'])
  };
  for (const [key, value] of Object.entries(context)) {
    if (!(key in allowed)) return issue('EVENT_CONTEXT_FIELD_UNCLASSIFIED', `$.context.${key}`, 'Custom context fields require a published classification policy.');
    const nested = allowed[key];
    if (nested && value && typeof value === 'object' && !Array.isArray(value)) {
      for (const child of Object.keys(value)) {
        if (!nested.has(child)) return issue('EVENT_CONTEXT_FIELD_UNCLASSIFIED', `$.context.${key}.${child}`,
          'Custom context fields require a published classification policy.');
      }
    }
  }
  return null;
}

function consentIssue(envelope: JourneyEventEnvelope, kind: JourneyEventCredentialKind) {
  if (envelope.call === 'consent') return null;
  const analyticsCall = ['track', 'page', 'screen', 'metric'].includes(envelope.call);
  const personalisationCall = ['identify', 'alias', 'group'].includes(envelope.call);
  if (analyticsCall && envelope.consent?.analytics === 'denied') {
    return issue('EVENT_CONSENT_DENIED', '$.consent.analytics', 'Analytics consent is denied for this event.');
  }
  if (personalisationCall && envelope.consent?.personalisation === 'denied') {
    return issue('EVENT_CONSENT_DENIED', '$.consent.personalisation', 'Personalisation consent is denied for this event.');
  }
  if (kind === 'public_write' && analyticsCall && envelope.consent?.analytics !== 'granted') {
    return issue('EVENT_CONSENT_REQUIRED', '$.consent.analytics', 'Public client events require granted analytics consent.');
  }
  if (kind === 'public_write' && personalisationCall && envelope.consent?.personalisation !== 'granted') {
    return issue('EVENT_CONSENT_REQUIRED', '$.consent.personalisation', 'Public identity events require granted personalisation consent.');
  }
  return null;
}

function sanitizeUrl(value: unknown) {
  if (typeof value !== 'string') return value;
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch { return value; }
}

export function canonicalJourneyEventEnvelope(envelope: JourneyEventEnvelope) {
  const canonical = JSON.parse(JSON.stringify(envelope)) as JourneyEventEnvelope;
  const page = canonical.context?.page;
  if (page) {
    if (page.url !== undefined) page.url = sanitizeUrl(page.url) as string;
    if (page.referrer !== undefined) page.referrer = sanitizeUrl(page.referrer) as string;
  }
  return canonical;
}

export function journeyEventEnvelopeFingerprint(envelope: JourneyEventEnvelope) {
  const canonical = canonicalJourneyEventEnvelope(envelope);
  const canonicalJson = stableJson(canonical);
  return { canonical, canonicalJson, contentSha256: sha256(canonicalJson), payloadBytes: Buffer.byteLength(canonicalJson, 'utf8') };
}

export function authoriseJourneyIngestBinding(input: {
  principal: JourneyIngestPrincipal;
  source: JourneyEventSourcePolicy;
  binding: JourneyIngestRequestBinding;
}): JourneyIngestIssue | null {
  if (input.principal.kind === 'server_secret') return null;
  const configured = input.source.allowedOrigins.length > 0 || input.source.allowedBundleIds.length > 0;
  if (!configured) {
    return issue('EVENT_CLIENT_BINDING_REQUIRED', '$', 'This public write key has no configured web origin or application bundle.');
  }
  if (input.binding.origin) {
    return input.source.allowedOrigins.includes(input.binding.origin) ? null
      : issue('EVENT_CLIENT_BINDING_FORBIDDEN', '$', 'The request origin is not allowed for this source.');
  }
  if (input.binding.bundleId && input.source.allowedBundleIds.includes(input.binding.bundleId)) return null;
  return issue('EVENT_CLIENT_BINDING_FORBIDDEN', '$', 'The request origin or application bundle is not allowed for this source.');
}

export function prepareJourneyEvent(input: {
  envelope: unknown;
  principal: JourneyIngestPrincipal;
  source: JourneyEventSourcePolicy;
  schema: { id: string; schema: JourneyEventSchemaVersion } | null;
  receivedAt: string;
}): JourneyPrepareResult {
  const checked = validateEventEnvelope(input.envelope);
  const suppliedEventId = input.envelope && typeof input.envelope === 'object'
    && typeof (input.envelope as { eventId?: unknown }).eventId === 'string'
    ? String((input.envelope as { eventId: string }).eventId) : null;
  if (!checked.ok) {
    return { ok: false, status: checked.errors.some((entry) => entry.code === 'MAX_BYTES') ? 413 : 422,
      issue: firstProtocolIssue(checked.errors), eventId: suppliedEventId };
  }
  const envelope = checked.value;
  const receivedMs = Date.parse(input.receivedAt);
  const occurredMs = Date.parse(envelope.occurredAt);
  const allowedPast = input.principal.kind === 'server_secret'
    ? journeyEventClockLimits.serverPastMs : journeyEventClockLimits.publicPastMs;
  if (!Number.isFinite(receivedMs) || !Number.isFinite(occurredMs)
    || occurredMs > receivedMs + journeyEventClockLimits.futureMs || occurredMs < receivedMs - allowedPast) {
    return { ok: false, status: 422, issue: issue('EVENT_TIME_OUT_OF_RANGE', '$.occurredAt',
      'occurredAt is outside the permitted source clock window.'), eventId: envelope.eventId };
  }
  if (input.principal.kind === 'public_write' && envelope.call === 'metric') {
    return { ok: false, status: 403, issue: issue('EVENT_CALL_REQUIRES_SERVER_SECRET', '$.call',
      'Operational metric calls require a server secret.'), eventId: envelope.eventId };
  }
  const prohibited = scanProhibited(envelope);
  if (prohibited) return { ok: false, status: 422, issue: prohibited, eventId: envelope.eventId };
  const unclassified = unexpectedContextField(envelope);
  if (unclassified) return { ok: false, status: 422, issue: unclassified, eventId: envelope.eventId };
  const consent = consentIssue(envelope, input.principal.kind);
  if (consent) return { ok: false, status: consent.code === 'EVENT_CONSENT_DENIED' ? 403 : 422,
    issue: consent, eventId: envelope.eventId };

  const requiresSchema = envelope.call === 'track' || envelope.call === 'metric';
  const schemaMatches = Boolean(input.schema && envelope.event === input.schema.schema.eventName
    && envelope.eventVersion === Number(input.schema.schema.version.split('.')[0]));
  let schemaIssues: JourneyControlPlaneIssue[] = [];
  if (schemaMatches && input.schema?.schema.properties.some((property) => property.dataClass === 'sensitive')) {
    return { ok: false, status: 422, issue: issue('EVENT_SENSITIVE_POLICY_REQUIRED', '$.properties',
      'Sensitive tracking-plan fields require an explicit source privacy approval policy.'), eventId: envelope.eventId };
  }
  if (requiresSchema && schemaMatches && input.schema) {
    const properties = validateJourneyEventProperties({
      schema: input.schema.schema,
      properties: envelope.properties || {},
      mode: input.source.validationMode
    });
    schemaIssues = properties.issues;
  } else if (requiresSchema) {
    schemaIssues = [{ severity: 'error', code: input.schema ? 'EVENT_SCHEMA_VERSION_NOT_PUBLISHED' : 'EVENT_SCHEMA_NOT_PUBLISHED',
      path: 'eventVersion', message: 'No exact published tracking-plan version exists for this event.' }];
  }
  const schemaFailure = schemaIssues.some((entry) => entry.severity === 'error');
  if (schemaFailure && input.source.validationMode === 'enforce') {
    return { ok: false, status: 422, issue: firstSchemaIssue(schemaIssues), eventId: envelope.eventId };
  }
  const privacy = scanUndeclaredIdentifiers(envelope, schemaMatches && input.schema ? input.schema.schema : null);
  if (privacy) return { ok: false, status: 422, issue: privacy, eventId: envelope.eventId };

  const canonical = canonicalJourneyEventEnvelope(envelope);
  const canonicalJson = stableJson(canonical);
  const issues = schemaIssues.map((entry) => issue(entry.code,
    entry.path.startsWith('$') ? entry.path : `$.${entry.path}`, entry.message));
  return {
    ok: true,
    value: {
      envelope: canonical,
      canonicalJson,
      contentSha256: sha256(canonicalJson),
      payloadBytes: Buffer.byteLength(canonicalJson, 'utf8'),
      schemaVersionId: schemaMatches && input.schema ? input.schema.id : null,
      outcome: schemaFailure && input.source.validationMode === 'warn' ? 'quarantined' : 'accepted',
      issues,
      receivedAt: new Date(receivedMs).toISOString()
    }
  };
}

export function eventResult(input: {
  eventId: string;
  status: EventIngestResult['status'];
  receivedAt: string;
  index?: number;
  code?: string;
  message?: string;
  retryable?: boolean;
}): EventIngestResult {
  return {
    eventId: input.eventId,
    ...(input.index === undefined ? {} : { index: input.index }),
    status: input.status,
    duplicate: input.status === 'duplicate',
    retryable: input.retryable || false,
    receivedAt: input.receivedAt,
    ...(input.code ? { code: input.code } : {}),
    ...(input.message ? { message: input.message.slice(0, 500) } : {})
  };
}
