import assert from 'node:assert/strict';
import test from 'node:test';
import type { JourneyEventEnvelope } from '@seemplify/journey-event-protocol';
import type { JourneyEventSchemaVersion, JourneyEventSourcePolicy } from '../src/journeyEventControlPlane.js';
import {
  authoriseJourneyIngestBinding,
  journeyEventEnvelopeFingerprint,
  prepareJourneyEvent,
  type JourneyIngestPrincipal
} from '../src/journeyEventIngestion.js';

const at = '2026-08-04T12:00:00.000Z';
const source: JourneyEventSourcePolicy = {
  sourceId: 'source-a',
  spaceId: 'space-a',
  environment: 'production',
  status: 'active',
  validationMode: 'enforce',
  allowedOrigins: ['https://app.example.test'],
  allowedBundleIds: ['com.example.mobile'],
  eventsPerMinute: 1_000,
  bytesPerMinute: 1_000_000
};
const publicPrincipal: JourneyIngestPrincipal = {
  credentialId: 'key-public', sourceId: source.sourceId, spaceId: source.spaceId,
  environment: source.environment, kind: 'public_write', scope: 'events:write'
};
const serverPrincipal: JourneyIngestPrincipal = { ...publicPrincipal, credentialId: 'key-server', kind: 'server_secret' };
const schema: JourneyEventSchemaVersion = {
  schemaId: 'schema-a', eventName: 'workspace_created', version: '1.0', state: 'published',
  properties: [
    { name: 'plan_id', type: 'string', required: true, dataClass: 'operational', description: 'Current plan.' },
    { name: 'contact_email', type: 'string', required: false, dataClass: 'personal', description: 'Approved contact.' }
  ]
};

function envelope(overrides: Record<string, unknown> = {}) {
  return JSON.parse(JSON.stringify({
    protocolVersion: '1.0',
    eventId: '018f4d85-4f31-7a1d-9f11-4d4ac3f10f48',
    call: 'track',
    event: 'workspace_created',
    eventVersion: 1,
    occurredAt: at,
    anonymousId: 'anon-1',
    properties: { plan_id: 'team' },
    context: { library: { name: '@seemplify/journey-browser-sdk', version: '0.1.0' } },
    consent: { analytics: 'granted', source: 'cmp', updatedAt: at },
    ...overrides
  })) as JourneyEventEnvelope;
}

function prepare(overrides: {
  value?: unknown;
  principal?: JourneyIngestPrincipal;
  policy?: JourneyEventSourcePolicy;
  published?: { id: string; schema: JourneyEventSchemaVersion } | null;
} = {}) {
  return prepareJourneyEvent({
    envelope: overrides.value || envelope(),
    principal: overrides.principal || publicPrincipal,
    source: overrides.policy || source,
    schema: overrides.published === undefined ? { id: 'version-a', schema } : overrides.published,
    receivedAt: at
  });
}

test('public client binding is exact and fails closed while server credentials bypass client binding', () => {
  assert.equal(authoriseJourneyIngestBinding({
    principal: publicPrincipal, source, binding: { origin: 'https://app.example.test', bundleId: null }
  }), null);
  assert.equal(authoriseJourneyIngestBinding({
    principal: publicPrincipal, source, binding: { origin: null, bundleId: 'com.example.mobile' }
  }), null);
  assert.equal(authoriseJourneyIngestBinding({
    principal: publicPrincipal, source, binding: { origin: 'https://evil.example.test', bundleId: null }
  })?.code, 'EVENT_CLIENT_BINDING_FORBIDDEN');
  assert.equal(authoriseJourneyIngestBinding({
    principal: publicPrincipal, source: { ...source, allowedOrigins: [], allowedBundleIds: [] },
    binding: { origin: null, bundleId: null }
  })?.code, 'EVENT_CLIENT_BINDING_REQUIRED');
  assert.equal(authoriseJourneyIngestBinding({
    principal: serverPrincipal, source: { ...source, allowedOrigins: [], allowedBundleIds: [] },
    binding: { origin: null, bundleId: null }
  }), null);
});

test('content fingerprint is stable by key order and changes for unknown property content', () => {
  const first = journeyEventEnvelopeFingerprint(envelope({ properties: { plan_id: 'team', unknown: 'a' } }));
  const reordered = journeyEventEnvelopeFingerprint(envelope({ properties: { unknown: 'a', plan_id: 'team' } }));
  const changed = journeyEventEnvelopeFingerprint(envelope({ properties: { unknown: 'b', plan_id: 'team' } }));
  assert.equal(first.contentSha256, reordered.contentSha256);
  assert.notEqual(first.contentSha256, changed.contentSha256);
});

test('public events require purpose-specific granted consent while consent updates and trusted server events remain possible', () => {
  const missing = prepare({ value: envelope({ consent: undefined }) });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.issue.code, 'EVENT_CONSENT_REQUIRED');
  const denied = prepare({ value: envelope({ consent: { analytics: 'denied', source: 'cmp', updatedAt: at } }) });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.issue.code, 'EVENT_CONSENT_DENIED');
  assert.equal(prepare({ principal: serverPrincipal, value: envelope({ consent: undefined }) }).ok, true);
  const consent = envelope({
    call: 'consent', event: undefined, eventVersion: undefined, properties: undefined,
    consent: { analytics: 'denied', source: 'cmp', updatedAt: at }
  });
  assert.equal(prepare({ value: consent, published: null }).ok, true);
  const identify = envelope({
    call: 'identify', event: undefined, eventVersion: undefined, properties: undefined,
    userId: 'customer-1', consent: { personalisation: 'unknown', source: 'cmp', updatedAt: at }
  });
  const identityResult = prepare({ value: identify, published: null });
  assert.equal(identityResult.ok, false);
  if (!identityResult.ok) assert.equal(identityResult.issue.code, 'EVENT_CONSENT_REQUIRED');
});

test('privacy policy blocks custom traits/context, normalized prohibited keys, and unclassified identifiers', () => {
  const traits = prepare({ value: envelope({ traits: { department: 'finance' } }) });
  assert.equal(traits.ok, false);
  if (!traits.ok) assert.equal(traits.issue.code, 'EVENT_TRAITS_POLICY_REQUIRED');
  const context = prepare({ value: envelope({ context: { customCampaign: 'summer' } }) });
  assert.equal(context.ok, false);
  if (!context.ok) assert.equal(context.issue.code, 'EVENT_CONTEXT_FIELD_UNCLASSIFIED');
  for (const key of ['accessToken', 'credit-card', 'email body']) {
    const result = prepare({
      value: envelope({ properties: { plan_id: 'team', [key]: 'forbidden' } }),
      policy: { ...source, validationMode: 'observe' }
    });
    assert.equal(result.ok, false, key);
    if (!result.ok) assert.equal(result.issue.code, 'EVENT_PRIVACY_FIELD_PROHIBITED', key);
  }
  const unplannedEmail = prepare({
    value: envelope({ event: 'unplanned_event', properties: { visitor: 'person@example.test' } }),
    policy: { ...source, validationMode: 'observe' }, published: null
  });
  assert.equal(unplannedEmail.ok, false);
  if (!unplannedEmail.ok) assert.equal(unplannedEmail.issue.code, 'EVENT_PRIVACY_CLASSIFICATION_REQUIRED');
  assert.equal(prepare({ value: envelope({ properties: { plan_id: 'team', contact_email: 'person@example.test' } }) }).ok, true);
});

test('sensitive schemas and public operational metrics fail closed', () => {
  const sensitive: JourneyEventSchemaVersion = {
    ...schema,
    properties: [...schema.properties, {
      name: 'health_status', type: 'string', required: false, dataClass: 'sensitive', description: 'Not yet approved.'
    }]
  };
  const sensitiveResult = prepare({ published: { id: 'sensitive-version', schema: sensitive } });
  assert.equal(sensitiveResult.ok, false);
  if (!sensitiveResult.ok) assert.equal(sensitiveResult.issue.code, 'EVENT_SENSITIVE_POLICY_REQUIRED');
  const metric = envelope({
    call: 'metric', metric: { name: 'resolution_seconds', value: 45 },
    properties: { plan_id: 'team' }
  });
  const metricResult = prepare({ value: metric });
  assert.equal(metricResult.ok, false);
  if (!metricResult.ok) assert.equal(metricResult.issue.code, 'EVENT_CALL_REQUIRES_SERVER_SECRET');
});

test('tracking-plan modes enforce, quarantine, or observe exact missing schemas', () => {
  const unplanned = envelope({ event: 'unplanned_event', properties: { safe_value: 'value' } });
  const enforced = prepare({ value: unplanned, published: null });
  assert.equal(enforced.ok, false);
  if (!enforced.ok) assert.equal(enforced.issue.code, 'EVENT_SCHEMA_NOT_PUBLISHED');
  const warned = prepare({ value: unplanned, published: null, policy: { ...source, validationMode: 'warn' } });
  assert.equal(warned.ok, true);
  if (warned.ok) assert.equal(warned.value.outcome, 'quarantined');
  const observed = prepare({ value: unplanned, published: null, policy: { ...source, validationMode: 'observe' } });
  assert.equal(observed.ok, true);
  if (observed.ok) {
    assert.equal(observed.value.outcome, 'accepted');
    assert.equal(observed.value.issues[0]?.code, 'EVENT_SCHEMA_NOT_PUBLISHED');
  }
});

test('clock skew is bounded and server historical import is wider than public delivery', () => {
  const future = prepare({ value: envelope({ occurredAt: '2026-08-04T12:10:00.001Z' }) });
  assert.equal(future.ok, false);
  if (!future.ok) assert.equal(future.issue.code, 'EVENT_TIME_OUT_OF_RANGE');
  const historical = envelope({ occurredAt: '2026-07-01T12:00:00.000Z' });
  assert.equal(prepare({ value: historical }).ok, false);
  assert.equal(prepare({ value: historical, principal: serverPrincipal }).ok, true);
});
