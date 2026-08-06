import assert from 'node:assert/strict';
import test from 'node:test';
import { parseJourneyPublicWriteKey } from '../../packages/journey-event-protocol/src/index.js';
import {
  compareJourneyEventSchemas,
  issueJourneyEventCredential,
  JourneyEventControlPlaneError,
  revokeJourneyEventCredential,
  rotateJourneyEventCredential,
  validateJourneyEventProperties,
  validateJourneyEventSchema,
  validateJourneyEventSourcePolicy,
  verifyJourneyEventCredential,
  type JourneyEventSchemaVersion,
  type JourneyEventSourcePolicy
} from '../src/journeyEventControlPlane.js';

const source: JourneyEventSourcePolicy = {
  sourceId: 'source-browser',
  spaceId: 'space-a',
  environment: 'production',
  status: 'active',
  validationMode: 'enforce',
  allowedOrigins: ['https://app.example.com'],
  allowedBundleIds: [],
  eventsPerMinute: 10_000,
  bytesPerMinute: 10_000_000
};

const entropy = (keyId: string) => ({
  keyId,
  secretPart: `${keyId}-`.padEnd(43, 's'),
  salt: `${keyId}-`.padEnd(24, 'x')
});

function schema(overrides: Partial<JourneyEventSchemaVersion> = {}): JourneyEventSchemaVersion {
  return {
    schemaId: 'schema-survey-published',
    eventName: 'survey_published',
    version: '1.0',
    state: 'published',
    properties: [
      { name: 'survey_id', type: 'string', required: true, dataClass: 'operational', description: 'Stable survey identifier.', maximumLength: 128 },
      { name: 'question_count', type: 'number', required: false, dataClass: 'operational', description: 'Number of published questions.' },
      { name: 'channel', type: 'string', required: false, dataClass: 'operational', description: 'Publication channel.', enumValues: ['web', 'email'] },
      { name: 'actor_user_id', type: 'string', required: false, dataClass: 'personal', description: 'Authenticated actor identifier.', maximumLength: 128 }
    ],
    ...overrides
  };
}

test('source policy accepts exact HTTPS and loopback origins and rejects unsafe or duplicate configuration', () => {
  assert.deepEqual(validateJourneyEventSourcePolicy({
    ...source,
    allowedOrigins: ['https://app.example.com', 'http://localhost:5173'],
    allowedBundleIds: ['com.seemplify.mobile']
  }).allowedOrigins, ['http://localhost:5173', 'https://app.example.com']);
  assert.throws(() => validateJourneyEventSourcePolicy({ ...source, allowedOrigins: ['http://app.example.com'] }),
    (error) => error instanceof JourneyEventControlPlaneError && error.code === 'JOURNEY_EVENT_SOURCE_ORIGIN_INVALID');
  assert.throws(() => validateJourneyEventSourcePolicy({ ...source, allowedOrigins: ['https://app.example.com', 'https://app.example.com'] }),
    (error) => error instanceof JourneyEventControlPlaneError && error.code === 'JOURNEY_EVENT_SOURCE_ORIGIN_DUPLICATE');
  assert.throws(() => validateJourneyEventSourcePolicy({ ...source, eventsPerMinute: 0 }),
    (error) => error instanceof JourneyEventControlPlaneError && error.code === 'JOURNEY_EVENT_SOURCE_LIMIT_INVALID');
  assert.throws(() => issueJourneyEventCredential({
    source: { ...source, status: 'revoked' }, kind: 'public_write', now: '2026-08-04T10:00:00.000Z', entropy: entropy('inactive')
  }), (error) => error instanceof JourneyEventControlPlaneError && error.code === 'JOURNEY_EVENT_SOURCE_INACTIVE');
});

test('issued credentials are one-time plaintext with write-only scope and stored scrypt verification material', () => {
  const issued = issueJourneyEventCredential({
    source,
    kind: 'public_write',
    now: '2026-08-04T10:00:00.000Z',
    entropy: entropy('key-public')
  });
  assert.match(issued.secret, /^jpk_live\.key-public\./u);
  assert.deepEqual(parseJourneyPublicWriteKey(issued.secret), {
    kind: 'public_write', environment: 'production', keyId: 'key-public'
  });
  assert.equal(issued.record.displayPrefix, 'jpk_live.key-public');
  assert.equal(issued.record.scope, 'events:write');
  assert.equal(issued.record.algorithm, 'scrypt-v1');
  assert.ok(!JSON.stringify(issued.record).includes(issued.secret));
  assert.ok(!JSON.stringify(issued.record).includes(entropy('key-public').secretPart));
  assert.equal(verifyJourneyEventCredential({
    record: issued.record, candidate: issued.secret, now: '2026-08-04T10:01:00.000Z', source
  }), true);
  assert.equal(verifyJourneyEventCredential({
    record: issued.record, candidate: `${issued.secret}x`, now: '2026-08-04T10:01:00.000Z', source
  }), false);
  assert.equal(verifyJourneyEventCredential({
    record: issued.record, candidate: issued.secret, now: '2026-08-04T10:01:00.000Z', source: { ...source, status: 'paused' }
  }), false);
});

test('rotation has a bounded overlap and revocation takes effect without exposing either key', () => {
  const first = issueJourneyEventCredential({
    source, kind: 'server_secret', now: '2026-08-04T10:00:00.000Z', entropy: entropy('key-server-a')
  });
  const rotated = rotateJourneyEventCredential({
    current: first.record,
    source,
    now: '2026-08-04T11:00:00.000Z',
    overlapSeconds: 900,
    entropy: entropy('key-server-b')
  });
  assert.equal(rotated.previous.status, 'overlap');
  assert.equal(rotated.previous.expiresAt, '2026-08-04T11:15:00.000Z');
  assert.equal(verifyJourneyEventCredential({
    record: rotated.previous, candidate: first.secret, now: '2026-08-04T11:14:59.000Z', source
  }), true);
  assert.equal(verifyJourneyEventCredential({
    record: rotated.previous, candidate: first.secret, now: '2026-08-04T11:15:00.000Z', source
  }), false);
  assert.equal(verifyJourneyEventCredential({
    record: rotated.issued.record, candidate: rotated.issued.secret, now: '2026-08-04T11:15:00.000Z', source
  }), true);
  const revoked = revokeJourneyEventCredential(rotated.issued.record, '2026-08-04T12:00:00.000Z');
  assert.equal(verifyJourneyEventCredential({
    record: revoked, candidate: rotated.issued.secret, now: '2026-08-04T12:00:01.000Z', source
  }), false);
});

test('tracking plans reject content-bearing fields, malformed names, duplicate properties, and ambiguous bounds', () => {
  const invalid = schema({
    eventName: 'Survey Published',
    properties: [
      { name: 'email_body', type: 'string', required: false, dataClass: 'sensitive', description: 'Bad content field.' },
      { name: 'duplicate', type: 'array', required: false, dataClass: 'operational', description: '', maximumItems: 0 },
      { name: 'duplicate', type: 'string', required: false, dataClass: 'operational', description: 'Duplicate.' }
    ]
  });
  const codes = validateJourneyEventSchema(invalid).map((entry) => entry.code);
  assert.ok(codes.includes('EVENT_NAME_INVALID'));
  assert.ok(codes.includes('EVENT_PROPERTY_CONTENT_PROHIBITED'));
  assert.ok(codes.includes('EVENT_PROPERTY_DESCRIPTION_REQUIRED'));
  assert.ok(codes.includes('EVENT_PROPERTY_ITEMS_INVALID'));
  assert.ok(codes.includes('EVENT_PROPERTY_DUPLICATE'));
});

test('schema compatibility permits optional additions but rejects identity, type, removal, and requiredness breaks', () => {
  const previous = schema();
  const compatible = compareJourneyEventSchemas(previous, schema({
    version: '1.1',
    state: 'draft',
    properties: [...previous.properties, {
      name: 'plan_id', type: 'string', required: false, dataClass: 'operational', description: 'Plan active at publication.'
    }]
  }));
  assert.equal(compatible.compatible, true);
  assert.equal(compareJourneyEventSchemas(previous, schema({ version: '1.0', state: 'draft' })).issues
    .some((entry) => entry.code === 'EVENT_SCHEMA_VERSION_NOT_INCREMENTED'), true);
  const breaking = compareJourneyEventSchemas(previous, schema({
    version: '2.0',
    state: 'draft',
    properties: [
      { ...previous.properties[0], type: 'number' },
      { ...previous.properties[1], required: true }
    ]
  }));
  assert.equal(breaking.compatible, false);
  assert.ok(breaking.issues.some((entry) => entry.code === 'EVENT_PROPERTY_TYPE_CHANGED'));
  assert.ok(breaking.issues.some((entry) => entry.code === 'EVENT_PROPERTY_BECAME_REQUIRED'));
  assert.ok(breaking.issues.some((entry) => entry.code === 'EVENT_PROPERTY_REMOVED'));
});

test('validation modes distinguish observation from enforcement while unsafe objects always fail', () => {
  const published = schema();
  const properties = { survey_id: 'survey-a', question_count: 12, unknown_field: true };
  const observed = validateJourneyEventProperties({ schema: published, properties, mode: 'observe' });
  assert.equal(observed.accepted, true);
  assert.deepEqual(observed.acceptedPropertyNames, ['question_count', 'survey_id']);
  assert.deepEqual(observed.ignoredPropertyNames, ['unknown_field']);
  assert.equal(observed.issues.find((entry) => entry.code === 'EVENT_PROPERTY_UNKNOWN')?.severity, 'warning');
  const enforced = validateJourneyEventProperties({ schema: published, properties, mode: 'enforce' });
  assert.equal(enforced.accepted, false);
  assert.equal(enforced.issues.find((entry) => entry.code === 'EVENT_PROPERTY_UNKNOWN')?.severity, 'error');
  const wrong = validateJourneyEventProperties({
    schema: published,
    properties: { survey_id: 'x'.repeat(129), channel: 'sms' },
    mode: 'enforce'
  });
  assert.equal(wrong.accepted, false);
  assert.deepEqual(wrong.ignoredPropertyNames, ['channel', 'survey_id']);
  assert.ok(wrong.issues.some((entry) => entry.code === 'EVENT_PROPERTY_LENGTH_EXCEEDED'));
  assert.ok(wrong.issues.some((entry) => entry.code === 'EVENT_PROPERTY_ENUM_INVALID'));
  const unsafe = validateJourneyEventProperties({
    schema: published,
    properties: JSON.parse('{"__proto__":{"polluted":true},"survey_id":"survey-a"}') as unknown,
    mode: 'observe'
  });
  assert.equal(unsafe.accepted, false);
  assert.ok(unsafe.issues.some((entry) => entry.code === 'EVENT_PROPERTIES_UNSAFE'));
});
