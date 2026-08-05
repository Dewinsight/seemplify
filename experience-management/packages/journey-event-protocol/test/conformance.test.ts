import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  JOURNEY_EVENT_PROTOCOL_VERSION, journeyEventCalls, journeyEventLimits, journeyEventSchemaFiles,
  validateBatchResult, validateEventBatch, validateEventEnvelope, validateEventResult,
  validateProtocolError, validationFingerprint, type ProtocolValidationResult
} from '../src/index.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaRoot = path.join(packageRoot, 'schemas', 'v1');
const fixtureRoot = path.join(packageRoot, 'fixtures', 'v1');

function readJson(file: string) {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
}

function fixture(folder: 'valid' | 'invalid', name: string) {
  return readJson(path.join(fixtureRoot, folder, name));
}

function assertValid(result: ProtocolValidationResult<unknown>, name: string) {
  assert.equal(result.ok, true, `${name}: ${validationFingerprint(result)}`);
}

function assertIssue(result: ProtocolValidationResult<unknown>, pathValue: string, code: string, name: string) {
  assert.equal(result.ok, false, `${name} unexpectedly passed`);
  if (result.ok) return;
  assert.ok(result.errors.some((entry) => entry.path === pathValue && entry.code === code),
    `${name} did not produce ${pathValue}|${code}:\n${validationFingerprint(result)}`);
}

function collectRefs(value: unknown, refs: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const entry of value) collectRefs(entry, refs);
  } else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (key === '$ref' && typeof entry === 'string') refs.push(entry);
      else collectRefs(entry, refs);
    }
  }
  return refs;
}

test('publishes a complete, internally resolvable JSON Schema v1 bundle', () => {
  const ids = new Set<string>();
  for (const name of journeyEventSchemaFiles) {
    const file = path.join(schemaRoot, name);
    assert.equal(fs.existsSync(file), true, `${name} is missing`);
    const schema = readJson(file) as Record<string, unknown>;
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(typeof schema.$id, 'string');
    assert.equal(ids.has(String(schema.$id)), false, `duplicate schema ID ${String(schema.$id)}`);
    ids.add(String(schema.$id));
    for (const reference of collectRefs(schema)) {
      if (reference.startsWith('#') || reference.startsWith('https://')) continue;
      const referencedFile = reference.split('#')[0];
      assert.ok(referencedFile);
      assert.equal(fs.existsSync(path.join(schemaRoot, referencedFile)), true,
        `${name} references missing ${referencedFile}`);
    }
  }
  const envelope = readJson(path.join(schemaRoot, 'event-envelope.schema.json')) as any;
  assert.equal(envelope.properties.protocolVersion.const, JOURNEY_EVENT_PROTOCOL_VERSION);
  assert.deepEqual(envelope.properties.call.enum, [...journeyEventCalls]);
  const batch = readJson(path.join(schemaRoot, 'event-batch.schema.json')) as any;
  assert.equal(batch.properties.events.maxItems, journeyEventLimits.batchEvents);
});

function schemaValidators() {
  // `required` appears in conditional/anyOf branches while the corresponding
  // property catalogue lives on the parent schema. That is valid 2020-12, so
  // keep every other strict check while disabling Ajv's local-only warning.
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  addFormats(ajv);
  for (const name of journeyEventSchemaFiles) ajv.addSchema(readJson(path.join(schemaRoot, name)) as object);
  return {
    envelope: ajv.getSchema('https://schemas.seemplify.com/journey-events/v1/event-envelope.schema.json'),
    batch: ajv.getSchema('https://schemas.seemplify.com/journey-events/v1/event-batch.schema.json'),
    eventResult: ajv.getSchema('https://schemas.seemplify.com/journey-events/v1/event-result.schema.json'),
    batchResult: ajv.getSchema('https://schemas.seemplify.com/journey-events/v1/batch-result.schema.json'),
    protocolError: ajv.getSchema('https://schemas.seemplify.com/journey-events/v1/protocol-error.schema.json')
  };
}

test('golden fixtures conform to the published JSON Schemas, not only the reference validator', () => {
  const validators = schemaValidators();
  assert.ok(validators.envelope && validators.batch && validators.eventResult && validators.batchResult && validators.protocolError);
  for (const name of ['track.json', 'identify.json', 'alias.json', 'group.json', 'page.json', 'screen.json', 'consent.json', 'metric.json']) {
    assert.equal(validators.envelope(fixture('valid', name)), true, `${name}: ${JSON.stringify(validators.envelope.errors)}`);
  }
  assert.equal(validators.batch(fixture('valid', 'batch.json')), true, JSON.stringify(validators.batch.errors));
  assert.equal(validators.eventResult(fixture('valid', 'event-result.json')), true, JSON.stringify(validators.eventResult.errors));
  assert.equal(validators.batchResult(fixture('valid', 'batch-result.json')), true, JSON.stringify(validators.batchResult.errors));
  assert.equal(validators.protocolError(fixture('valid', 'protocol-error.json')), true, JSON.stringify(validators.protocolError.errors));

  const envelopeInvalid = [
    'unsupported-version.json', 'missing-subject.json', 'bad-event-name.json', 'identify-without-user.json',
    'alias-without-anonymous.json', 'consent-without-purpose.json', 'metric-without-value.json', 'unsafe-property.json'
  ];
  for (const name of envelopeInvalid) assert.equal(validators.envelope(fixture('invalid', name)), false, `${name} passed its JSON Schema`);
  assert.equal(validators.eventResult(fixture('invalid', 'invalid-result-status.json')), false);
  assert.equal(validators.protocolError(fixture('invalid', 'invalid-error-code.json')), false);
  // Cross-item eventId uniqueness is intentionally a deterministic conformance
  // rule because JSON Schema cannot express uniqueness by one object field.
  assert.equal(validators.batch(fixture('invalid', 'duplicate-batch-event-id.json')), true);
});

test('all supported calls have a valid golden envelope', () => {
  const files = ['track.json', 'identify.json', 'alias.json', 'group.json', 'page.json', 'screen.json', 'consent.json', 'metric.json'];
  const observedCalls = new Set<string>();
  for (const name of files) {
    const value = fixture('valid', name) as Record<string, unknown>;
    observedCalls.add(String(value.call));
    assertValid(validateEventEnvelope(value), name);
  }
  assert.deepEqual([...observedCalls].sort(), [...journeyEventCalls].sort());
});

test('batch and response golden fixtures conform', () => {
  assertValid(validateEventBatch(fixture('valid', 'batch.json')), 'batch.json');
  assertValid(validateEventResult(fixture('valid', 'event-result.json')), 'event-result.json');
  assertValid(validateBatchResult(fixture('valid', 'batch-result.json')), 'batch-result.json');
  assertValid(validateProtocolError(fixture('valid', 'protocol-error.json')), 'protocol-error.json');
});

test('invalid golden fixtures fail with stable paths and machine codes', () => {
  const cases: Array<[string, (value: unknown) => ProtocolValidationResult<unknown>, string, string]> = [
    ['unsupported-version.json', validateEventEnvelope, '$.protocolVersion', 'UNSUPPORTED_VERSION'],
    ['missing-subject.json', validateEventEnvelope, '$', 'SUBJECT_REQUIRED'],
    ['bad-event-name.json', validateEventEnvelope, '$.event', 'EVENT_NAME'],
    ['identify-without-user.json', validateEventEnvelope, '$.userId', 'REQUIRED'],
    ['alias-without-anonymous.json', validateEventEnvelope, '$.anonymousId', 'REQUIRED'],
    ['consent-without-purpose.json', validateEventEnvelope, '$.consent', 'PURPOSE_REQUIRED'],
    ['metric-without-value.json', validateEventEnvelope, '$.metric.value', 'NUMBER'],
    ['unsafe-property.json', validateEventEnvelope, '$.properties.__proto__', 'UNSAFE_KEY'],
    ['duplicate-batch-event-id.json', validateEventBatch, '$.events[1].eventId', 'DUPLICATE_EVENT_ID'],
    ['invalid-result-status.json', validateEventResult, '$.status', 'ENUM'],
    ['invalid-error-code.json', validateProtocolError, '$.error.code', 'ERROR_CODE']
  ];
  for (const [name, validator, pathValue, code] of cases) {
    const value = fixture('invalid', name);
    const first = validator(value);
    const second = validator(JSON.parse(JSON.stringify(value)));
    assert.equal(validationFingerprint(first), validationFingerprint(second), `${name} is not deterministic`);
    assertIssue(first, pathValue, code, name);
  }
});

test('limits reject oversized envelopes and batches before any future ingest work', () => {
  const event = fixture('valid', 'track.json') as any;
  event.properties.large = 'x'.repeat(journeyEventLimits.envelopeBytes);
  assertIssue(validateEventEnvelope(event), '$', 'MAX_BYTES', 'oversized envelope');

  const batch = fixture('valid', 'batch.json') as any;
  const source = batch.events[0];
  batch.events = Array.from({ length: journeyEventLimits.batchEvents + 1 }, (_, index) => ({
    ...source,
    eventId: `018f4d85-4f31-7a1d-8f11-${String(index).padStart(12, '0')}`
  }));
  assertIssue(validateEventBatch(batch), '$.events', 'MAX_ITEMS', 'oversized batch');
});

test('result semantics cannot disguise duplicates or rejected events', () => {
  const accepted = fixture('valid', 'event-result.json') as any;
  accepted.duplicate = true;
  assertIssue(validateEventResult(accepted), '$.duplicate', 'STATUS_MISMATCH', 'accepted duplicate mismatch');

  const rejected = { ...accepted, status: 'rejected', duplicate: false };
  delete rejected.code;
  assertIssue(validateEventResult(rejected), '$.code', 'REQUIRED', 'rejected result without code');
});
