import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import {
  validateBatchResult, validateEventResult, validateProtocolError
} from '../src/index.js';
import {
  createMockIngestServer, MOCK_INGEST_DEFAULT_WRITE_KEY, MOCK_INGEST_HEADER
} from '../src/mockIngestServer.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = path.join(packageRoot, 'fixtures', 'v1');
const mock = createMockIngestServer({ receivedAt: '2026-08-04T13:00:00.000Z' });
let baseUrl = '';

function fixture(folder: 'valid' | 'invalid', name: string) {
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, folder, name), 'utf8')) as any;
}

async function post(pathname: string, value: unknown, options: { key?: string; raw?: boolean; contentType?: string } = {}) {
  const body = options.raw ? String(value) : JSON.stringify(value);
  return fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${options.key ?? MOCK_INGEST_DEFAULT_WRITE_KEY}`,
      'content-type': options.contentType ?? 'application/json'
    },
    body
  });
}

before(async () => { baseUrl = await mock.listen(); });
after(async () => { await mock.close(); });

test('mock is loopback-only and explicitly non-durable/non-production', () => {
  assert.equal(new URL(baseUrl).hostname, '127.0.0.1');
  assert.equal(mock.isDurable, false);
  assert.equal(mock.productionSafe, false);
});

test('mock requires its test-only write key and labels every response', async () => {
  mock.reset();
  const response = await post('/v1/events', fixture('valid', 'track.json'), { key: 'not-the-test-key' });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get(MOCK_INGEST_HEADER), 'non-durable-test-helper');
  const body = await response.json();
  assert.equal(validateProtocolError(body).ok, true);
  assert.equal((body as any).error.code, 'INVALID_TEST_WRITE_KEY');
  assert.deepEqual(mock.snapshot().acceptedEventIds, []);
});

test('single-event responses are deterministic and idempotent in memory', async () => {
  mock.reset();
  const event = fixture('valid', 'track.json');
  const accepted = await post('/v1/events', event);
  assert.equal(accepted.status, 202);
  assert.equal(accepted.headers.get(MOCK_INGEST_HEADER), 'non-durable-test-helper');
  const acceptedBody = await accepted.json();
  assert.equal(validateEventResult(acceptedBody).ok, true);
  assert.deepEqual(acceptedBody, {
    eventId: event.eventId,
    status: 'accepted',
    duplicate: false,
    retryable: false,
    receivedAt: '2026-08-04T13:00:00.000Z'
  });
  const duplicate = await post('/v1/events', event);
  assert.equal(duplicate.status, 200);
  assert.deepEqual(await duplicate.json(), { ...acceptedBody as object, status: 'duplicate', duplicate: true });
  assert.deepEqual(mock.snapshot().acceptedEventIds, [event.eventId]);
});

test('batch preserves indexes and returns 207 for accepted/duplicate mixture', async () => {
  mock.reset();
  const batch = fixture('valid', 'batch.json');
  await post('/v1/events', batch.events[0]);
  const response = await post('/v1/batch', batch);
  assert.equal(response.status, 207);
  const body = await response.json() as any;
  assert.equal(validateBatchResult(body).ok, true);
  assert.deepEqual(body.results.map((result: any) => ({ index: result.index, status: result.status })), [
    { index: 0, status: 'duplicate' },
    { index: 1, status: 'accepted' }
  ]);
  assert.deepEqual(mock.snapshot().acceptedEventIds, batch.events.map((event: any) => event.eventId).sort());
});

test('invalid payload failures are stable and never enter the in-memory ID set', async () => {
  mock.reset();
  const invalid = fixture('invalid', 'bad-event-name.json');
  const first = await post('/v1/events', invalid);
  const firstBody = await first.json();
  const second = await post('/v1/events', invalid);
  const secondBody = await second.json();
  assert.equal(first.status, 422);
  assert.equal(second.status, 422);
  assert.deepEqual(firstBody, secondBody);
  assert.equal(validateProtocolError(firstBody).ok, true);
  assert.equal((firstBody as any).error.code, 'PROTOCOL_VALIDATION_FAILED');
  assert.deepEqual(mock.snapshot().acceptedEventIds, []);
});

test('malformed JSON and unsupported media types return protocol errors', async () => {
  const malformed = await post('/v1/events', '{not-json', { raw: true });
  assert.equal(malformed.status, 400);
  const malformedBody = await malformed.json();
  assert.equal(validateProtocolError(malformedBody).ok, true);
  assert.equal((malformedBody as any).error.code, 'MALFORMED_JSON');
  const media = await post('/v1/events', '{}', { raw: true, contentType: 'text/plain' });
  assert.equal(media.status, 415);
  assert.equal((await media.json() as any).error.code, 'CONTENT_TYPE_REQUIRED');
});
