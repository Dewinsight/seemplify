import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  JOURNEY_EVENT_PROTOCOL_VERSION,
  type BatchIngestResult,
  type JourneyEventBatch,
  type JourneyEventEnvelope
} from '@seemplify/journey-event-protocol';
import { createMockIngestServer } from '@seemplify/journey-event-protocol/mock';
import {
  createJourneyRequestContextMiddleware,
  createNodeJourneySdk,
  createVerifiedJourneyIdentity,
  type NodeFetch,
  type NodeFetchInit,
  type NodeJourneyRuntime,
  type NodeResponseLike
} from '../src/index.js';

const baseTime = Date.parse('2026-08-04T12:00:00.000Z');

function serverSecret(environment: 'dev' | 'stg' | 'live' = 'dev') {
  return `jsk_${environment}.test_key_01.${'s'.repeat(43)}`;
}

function eventId(sequence: number) {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

function uuidSequence(start = 900) {
  let sequence = start;
  return () => eventId(sequence++);
}

function response(status: number, body: unknown, headers: Record<string, string> = {}): NodeResponseLike {
  const normalised = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => normalised.get(name.toLowerCase()) ?? null },
    json: async () => body
  };
}

function parseBatch(init: NodeFetchInit) {
  return JSON.parse(init.body) as JourneyEventBatch;
}

function batchResult(batch: JourneyEventBatch, statuses?: Array<'accepted' | 'duplicate' | 'rejected'>): BatchIngestResult {
  return {
    protocolVersion: JOURNEY_EVENT_PROTOCOL_VERSION,
    batchId: batch.batchId,
    results: batch.events.map((event, index) => {
      const status = statuses?.[index] ?? 'accepted';
      return {
        eventId: event.eventId,
        index,
        status,
        duplicate: status === 'duplicate',
        retryable: false,
        receivedAt: '2026-08-04T12:00:01.000Z',
        ...(status === 'rejected' ? { code: 'TEST_REJECTED' } : {})
      };
    })
  };
}

function inertTimers() {
  return {
    setTimeout: (_callback: () => void, _delayMs: number) => Object.freeze({}),
    clearTimeout: (_handle: unknown) => undefined
  };
}

function runtime(fetch: NodeFetch, overrides: Partial<NodeJourneyRuntime> = {}): NodeJourneyRuntime {
  return {
    fetch,
    now: () => baseTime,
    random: () => 0.5,
    randomUuid: uuidSequence(),
    ...inertTimers(),
    ...overrides
  };
}

test('accepts only environment-matched server secrets and safe endpoints', async () => {
  let calls = 0;
  const diagnostics: string[] = [];
  const fetch: NodeFetch = async (_url, init) => {
    calls += 1;
    const batch = parseBatch(init);
    return response(202, batchResult(batch));
  };
  const publicKey = createNodeJourneySdk({
    serverSecret: 'sp_test_public_key',
    endpoint: 'https://ingest.example.test',
    runtime: runtime(fetch),
    callbacks: { onDiagnostic: (value) => diagnostics.push(value.code) }
  });
  assert.equal(publicKey.enabled, false);
  assert.equal((await publicKey.track('ignored_event', {}, { userId: 'user_1' })).status, 'disabled');

  const mismatch = createNodeJourneySdk({
    serverSecret: serverSecret('live'),
    endpoint: 'https://ingest.example.test',
    environment: 'staging',
    runtime: runtime(fetch),
    callbacks: { onDiagnostic: (value) => diagnostics.push(value.code) }
  });
  assert.equal(mismatch.enabled, false);

  const insecure = createNodeJourneySdk({
    serverSecret: serverSecret(),
    endpoint: 'http://ingest.example.test',
    runtime: runtime(fetch),
    callbacks: { onDiagnostic: (value) => diagnostics.push(value.code) }
  });
  assert.equal(insecure.enabled, false);

  const valid = createNodeJourneySdk({
    serverSecret: serverSecret('stg'),
    endpoint: 'https://ingest.example.test',
    environment: 'staging',
    runtime: runtime(fetch)
  });
  assert.equal(valid.enabled, true);
  assert.equal(calls, 0);
  assert.equal(diagnostics.includes('SERVER_SECRET_INVALID'), true);
  assert.equal(diagnostics.includes('CREDENTIAL_ENVIRONMENT_MISMATCH'), true);
  assert.equal(diagnostics.includes('ENDPOINT_INVALID'), true);
});

test('emits canonical track, identify, alias, and group calls with stable IDs and recursive redaction', async () => {
  const requests: Array<{ url: string; init: NodeFetchInit }> = [];
  const outcomes: unknown[] = [];
  const fetch: NodeFetch = async (url, init) => {
    requests.push({ url, init });
    const batch = parseBatch(init);
    return response(202, batchResult(batch));
  };
  const secret = serverSecret();
  const client = createNodeJourneySdk({
    serverSecret: secret,
    endpoint: 'https://ingest.example.test/root/',
    runtime: runtime(fetch, { randomUuid: uuidSequence(100) }),
    callbacks: { onOutcome: (value) => outcomes.push(value) }
  });

  assert.equal((await client.track('workspace_created', {
    safe: true,
    password: 'must-not-leave',
    nested: { access_token: 'must-not-leave', kept: 'yes' }
  }, { userId: 'user_1', eventId: eventId(1) })).status, 'queued');
  assert.equal((await client.identify('user_1', { role: 'owner' }, { eventId: eventId(2) })).status, 'queued');
  assert.equal((await client.alias('user_1', 'anon_1', { eventId: eventId(3) })).status, 'queued');
  assert.equal((await client.group('space_1', { plan: 'pro' }, { userId: 'user_1', eventId: eventId(4) })).status, 'queued');
  assert.equal((await client.track('generated_id', {}, { userId: 'user_1' })).eventId, eventId(100));
  assert.equal((await client.track('workspace_created', {}, {
    userId: 'user_1', eventId: eventId(1)
  })).code, 'EVENT_ID_CONFLICT');
  assert.equal((await client.track('subject_missing')).status, 'invalid');

  const flushed = await client.flush();
  assert.deepEqual(flushed, { status: 'sent', accepted: 5, dropped: 0, retained: 0 });
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, 'https://ingest.example.test/root/v1/batch');
  assert.equal(requests[0]?.init.headers.authorization, `Bearer ${secret}`);
  const sent = parseBatch(requests[0]!.init);
  assert.deepEqual(sent.events.map((event) => event.call), ['track', 'identify', 'alias', 'group', 'track']);
  assert.deepEqual(sent.events[0]?.properties, { safe: true, nested: { kept: 'yes' } });
  assert.equal(sent.events.every((event) => event.context?.device?.type === 'server'), true);
  assert.equal(sent.events.every((event) => event.context?.library?.name === '@seemplify/journey-node'), true);
  assert.equal(JSON.stringify(outcomes).includes(secret), false);
});

test('emits canonical page, screen, consent, and server metric calls', async () => {
  const requests: JourneyEventBatch[] = [];
  const fetch: NodeFetch = async (_url, init) => {
    const batch = parseBatch(init);
    requests.push(batch);
    return response(202, batchResult(batch));
  };
  const client = createNodeJourneySdk({
    serverSecret: serverSecret(),
    endpoint: 'https://ingest.example.test',
    runtime: runtime(fetch)
  });

  assert.equal((await client.page('Onboarding', {
    route: '/start', password: 'must-not-leave'
  }, {
    userId: 'user_1',
    eventId: eventId(5),
    context: {
      page: {
        url: 'https://viewer:secret@example.test/start?campaign=welcome&token=private#section',
        referrer: 'javascript:private'
      }
    }
  })).status, 'queued');
  assert.equal((await client.screen('Workspace setup', {
    platform: 'web'
  }, { userId: 'user_1', eventId: eventId(6) })).status, 'queued');
  assert.equal((await client.consent({
    analytics: 'granted',
    personalisation: 'denied',
    source: 'account_privacy_settings'
  }, { userId: 'user_1', eventId: eventId(7) })).status, 'queued');
  assert.equal((await client.metric('workspace_activation_seconds', {
    name: 'time_to_activation',
    value: 183.5,
    unit: 'seconds',
    dimensions: { plan: 'team', api_key: 'must-not-leave' }
  }, { userId: 'user_1', eventId: eventId(8) })).status, 'queued');
  assert.equal((await client.consent({ source: 'missing_purpose' }, {
    userId: 'user_1', eventId: eventId(9)
  })).status, 'invalid');

  assert.deepEqual(await client.flush(), { status: 'sent', accepted: 4, dropped: 0, retained: 0 });
  const sent = requests[0]!.events;
  assert.deepEqual(sent.map((entry) => entry.call), ['page', 'screen', 'consent', 'metric']);
  assert.deepEqual(sent[0]?.properties, { name: 'Onboarding', route: '/start' });
  assert.deepEqual(sent[0]?.context?.page, { url: 'https://example.test/start' });
  assert.deepEqual(sent[1]?.properties, { name: 'Workspace setup', platform: 'web' });
  assert.deepEqual(sent[2]?.consent, {
    analytics: 'granted', personalisation: 'denied', source: 'account_privacy_settings',
    updatedAt: '2026-08-04T12:00:00.000Z'
  });
  assert.deepEqual(sent[3]?.metric, {
    name: 'time_to_activation', value: 183.5, unit: 'seconds', dimensions: { plan: 'team' }
  });
});

test('imports only a bounded canonical batch with per-event validation and idempotency', async () => {
  const requests: JourneyEventBatch[] = [];
  const fetch: NodeFetch = async (_url, init) => {
    const batch = parseBatch(init);
    requests.push(batch);
    return response(202, batchResult(batch));
  };
  const client = createNodeJourneySdk({
    serverSecret: serverSecret(),
    endpoint: 'https://ingest.example.test',
    runtime: runtime(fetch)
  });
  const imported: JourneyEventEnvelope = {
    protocolVersion: JOURNEY_EVENT_PROTOCOL_VERSION,
    eventId: eventId(10),
    call: 'track',
    event: 'historical_workspace_created',
    eventVersion: 1,
    occurredAt: '2026-07-01T09:00:00.000Z',
    userId: 'user_1',
    sentAt: '2026-07-01T09:00:01.000Z',
    properties: { source: 'legacy', refresh_token: 'must-not-leave' },
    context: { library: { name: 'legacy-client', version: '0.0.1' } }
  };
  const duplicate = {
    context: structuredClone(imported.context),
    properties: { refresh_token: 'must-not-leave', source: 'legacy' },
    sentAt: imported.sentAt,
    userId: imported.userId,
    occurredAt: imported.occurredAt,
    eventVersion: imported.eventVersion,
    event: imported.event,
    call: imported.call,
    eventId: imported.eventId,
    protocolVersion: imported.protocolVersion
  } as JourneyEventEnvelope;
  const conflict = { ...structuredClone(imported), event: 'different_fact' } as JourneyEventEnvelope;
  const invalid = {
    ...structuredClone(imported),
    eventId: eventId(11),
    userId: undefined
  } as unknown as JourneyEventEnvelope;

  const result = await client.importBatch([imported, duplicate, conflict, invalid]);
  assert.equal(result.status, 'partial');
  assert.equal(result.code, 'IMPORT_BATCH_PARTIAL');
  assert.deepEqual(
    { enqueued: result.enqueued, duplicate: result.duplicate, rejected: result.rejected },
    { enqueued: 1, duplicate: 1, rejected: 2 }
  );
  assert.deepEqual(result.results.map((entry) => entry.code), [
    'QUEUED', 'ALREADY_QUEUED', 'EVENT_ID_CONFLICT', 'PROTOCOL_VALIDATION_FAILED'
  ]);
  assert.equal(client.status().queued, 1);

  const overLimit = Array.from({ length: 101 }, () => imported);
  assert.deepEqual(await client.importBatch(overLimit), {
    status: 'invalid', code: 'IMPORT_BATCH_LIMIT_EXCEEDED', enqueued: 0,
    duplicate: 0, rejected: 101, results: []
  });
  assert.equal(client.status().queued, 1);

  await client.flush();
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.events.length, 1);
  assert.equal(requests[0]?.events[0]?.eventId, eventId(10));
  assert.equal(requests[0]?.events[0]?.occurredAt, '2026-07-01T09:00:00.000Z');
  assert.deepEqual(requests[0]?.events[0]?.properties, { source: 'legacy' });
  assert.equal(requests[0]?.events[0]?.context?.library?.name, '@seemplify/journey-node');
});

test('keeps authenticated request identity and privacy-safe context outside request objects', async () => {
  const identity = createVerifiedJourneyIdentity('user_123', 'application_session');
  assert.ok(identity);
  assert.equal(createVerifiedJourneyIdentity('', 'application_session'), undefined);
  const diagnostics: string[] = [];
  const request = { headers: { authorization: 'Bearer must-not-leave' } };
  const middleware = createJourneyRequestContextMiddleware<typeof request>({
    resolve: async () => ({
      identity,
      accountId: 'account_456',
      sessionId: 'session_789',
      context: {
        locale: 'en-GB',
        authorization: 'must-not-leave',
        page: {
          url: 'https://example.test/settings?campaign=welcome&token=must-not-leave#private'
        },
        nested: { password: 'must-not-leave', safe: true }
      }
    }),
    privacy: { allowUrlQueryParameters: ['campaign'] },
    onDiagnostic: (entry) => diagnostics.push(JSON.stringify(entry))
  });
  await new Promise<void>((resolve) => { middleware(request, {}, () => resolve()); });
  assert.deepEqual(JSON.parse(JSON.stringify(middleware.eventOptions(request))), {
    userId: 'user_123',
    accountId: 'account_456',
    sessionId: 'session_789',
    context: {
      locale: 'en-GB',
      page: { url: 'https://example.test/settings?campaign=welcome' },
      nested: { safe: true }
    }
  });
  assert.deepEqual(Object.keys(request), ['headers']);
  assert.equal(JSON.stringify(request).includes('user_123'), false);
  assert.equal(diagnostics.some((entry) => entry.includes('must-not-leave')), false);
  middleware.clear(request);
  assert.equal(middleware.eventOptions(request), undefined);

  const rejectedRequest = {};
  const rejected = createJourneyRequestContextMiddleware<typeof rejectedRequest>({
    resolve: () => ({ identity: { userId: 'forged', verificationMethod: 'none' } as typeof identity }),
    onDiagnostic: (entry) => diagnostics.push(entry.code)
  });
  await new Promise<void>((resolve) => { rejected(rejectedRequest, {}, () => resolve()); });
  assert.equal(rejected.eventOptions(rejectedRequest), undefined);
  assert.equal(diagnostics.includes('REQUEST_IDENTITY_REJECTED'), true);

  const failedRequest = {};
  const failed = createJourneyRequestContextMiddleware<typeof failedRequest>({
    resolve: () => { throw new Error('credential-shaped exception must remain private'); },
    onDiagnostic: (entry) => diagnostics.push(JSON.stringify(entry))
  });
  await new Promise<void>((resolve) => { failed(failedRequest, {}, () => resolve()); });
  assert.equal(failed.eventOptions(failedRequest), undefined);
  assert.equal(diagnostics.some((entry) => entry.includes('credential-shaped')), false);
  assert.equal(diagnostics.some((entry) => entry.includes('REQUEST_CONTEXT_RESOLUTION_FAILED')), true);
});

test('passes the canonical mock contract while preserving duplicate event IDs', async () => {
  const secret = serverSecret();
  const mock = createMockIngestServer({ writeKey: secret });
  const endpoint = await mock.listen();
  try {
    const client = createNodeJourneySdk({ serverSecret: secret, endpoint });
    await client.track('mock_contract', {}, { userId: 'user_1', eventId: eventId(10) });
    assert.equal((await client.flush()).accepted, 1);
    await client.track('mock_contract', {}, { userId: 'user_1', eventId: eventId(10) });
    assert.equal((await client.flush()).accepted, 1);
    assert.deepEqual(mock.snapshot(), { acceptedEventIds: [eventId(10)], requestCount: 2 });
    await client.close();
  } finally {
    await mock.close();
  }
});

test('bounds the in-memory queue and work performed by each flush', async () => {
  const sentIds: string[] = [];
  const droppedIds: string[] = [];
  const fetch: NodeFetch = async (_url, init) => {
    const batch = parseBatch(init);
    sentIds.push(...batch.events.map((event) => event.eventId));
    return response(202, batchResult(batch));
  };
  const client = createNodeJourneySdk({
    serverSecret: serverSecret(),
    endpoint: 'https://ingest.example.test',
    queue: { maxEvents: 2, overflow: 'drop-oldest' },
    batch: { maxEvents: 1, maxBatchesPerFlush: 1 },
    runtime: runtime(fetch),
    callbacks: {
      onOutcome: (value) => { if (value.code === 'QUEUE_OVERFLOW_OLDEST' && value.eventId) droppedIds.push(value.eventId); }
    }
  });
  await client.track('first_event', {}, { userId: 'user_1', eventId: eventId(20) });
  await client.track('second_event', {}, { userId: 'user_1', eventId: eventId(21) });
  await client.track('third_event', {}, { userId: 'user_1', eventId: eventId(22) });
  assert.deepEqual(droppedIds, [eventId(20)]);
  assert.equal(client.status().queued, 2);
  assert.deepEqual(await client.flush(), { status: 'sent', accepted: 1, dropped: 0, retained: 1 });
  assert.deepEqual(await client.flush(), { status: 'sent', accepted: 1, dropped: 0, retained: 0 });
  assert.deepEqual(sentIds, [eventId(21), eventId(22)]);
});

test('drop-newest overflow leaves the existing bounded queue intact', async () => {
  const fetch: NodeFetch = async (_url, init) => response(202, batchResult(parseBatch(init)));
  const client = createNodeJourneySdk({
    serverSecret: serverSecret(),
    endpoint: 'https://ingest.example.test',
    queue: { maxEvents: 1, overflow: 'drop-newest' },
    runtime: runtime(fetch)
  });
  assert.equal((await client.track('first_event', {}, { userId: 'user_1', eventId: eventId(30) })).status, 'queued');
  assert.deepEqual(await client.track('second_event', {}, { userId: 'user_1', eventId: eventId(31) }), {
    status: 'dropped', code: 'QUEUE_OVERFLOW_NEWEST', eventId: eventId(31)
  });
  assert.equal(client.status().queued, 1);
});

test('expires old in-memory entries before transport', async () => {
  let now = baseTime;
  let requests = 0;
  const fetch: NodeFetch = async (_url, init) => {
    requests += 1;
    return response(202, batchResult(parseBatch(init)));
  };
  const client = createNodeJourneySdk({
    serverSecret: serverSecret(),
    endpoint: 'https://ingest.example.test',
    queue: { maxAgeMs: 1_000 },
    runtime: runtime(fetch, { now: () => now })
  });
  await client.track('expiring_event', {}, { userId: 'user_1', eventId: eventId(35) });
  now += 1_000;
  assert.deepEqual(await client.flush(), { status: 'sent', accepted: 0, dropped: 1, retained: 0 });
  assert.equal(requests, 0);
});

test('honours bounded Retry-After and retries the same event ID', async () => {
  let now = baseTime;
  let attempt = 0;
  const sentIds: string[] = [];
  const diagnostics: Array<{ code: string; delayMs?: number }> = [];
  const fetch: NodeFetch = async (_url, init) => {
    attempt += 1;
    const batch = parseBatch(init);
    sentIds.push(batch.events[0]!.eventId);
    if (attempt === 1) return response(429, {}, { 'Retry-After': '2' });
    return response(202, batchResult(batch));
  };
  const client = createNodeJourneySdk({
    serverSecret: serverSecret(),
    endpoint: 'https://ingest.example.test',
    retry: { baseDelayMs: 100, maxDelayMs: 5_000, jitterRatio: 0 },
    runtime: runtime(fetch, { now: () => now }),
    callbacks: { onDiagnostic: (value) => diagnostics.push(value) }
  });
  await client.track('retry_safe', {}, { userId: 'user_1', eventId: eventId(40) });
  assert.deepEqual(await client.flush(), { status: 'retry_scheduled', accepted: 0, dropped: 0, retained: 1 });
  assert.equal(diagnostics.some((value) => value.code === 'RETRY_SCHEDULED' && value.delayMs === 2_000), true);
  now += 1_999;
  assert.deepEqual(await client.flush(), { status: 'empty', accepted: 0, dropped: 0, retained: 1 });
  now += 1;
  assert.deepEqual(await client.flush(), { status: 'sent', accepted: 1, dropped: 0, retained: 0 });
  assert.deepEqual(sentIds, [eventId(40), eventId(40)]);
});

test('applies bounded exponential backoff with jitter and a finite attempt limit', async () => {
  let now = baseTime;
  const delays: number[] = [];
  const sentIds: string[] = [];
  const fetch: NodeFetch = async (_url, init) => {
    sentIds.push(parseBatch(init).events[0]!.eventId);
    return response(503, {});
  };
  const client = createNodeJourneySdk({
    serverSecret: serverSecret(),
    endpoint: 'https://ingest.example.test',
    retry: { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1_000, jitterRatio: 0.5 },
    runtime: runtime(fetch, { now: () => now, random: () => 0 }),
    callbacks: {
      onDiagnostic: (value) => { if (value.code === 'RETRY_SCHEDULED' && value.delayMs) delays.push(value.delayMs); }
    }
  });
  await client.track('bounded_backoff', {}, { userId: 'user_1', eventId: eventId(45) });
  assert.equal((await client.flush()).status, 'retry_scheduled');
  now += 50;
  assert.equal((await client.flush()).status, 'retry_scheduled');
  now += 100;
  assert.deepEqual(await client.flush(), { status: 'sent', accepted: 0, dropped: 1, retained: 0 });
  assert.deepEqual(delays, [50, 100]);
  assert.deepEqual(sentIds, [eventId(45), eventId(45), eventId(45)]);
});

test('handles mixed and missing per-event results without replaying accepted events', async () => {
  let now = baseTime;
  let attempt = 0;
  const batches: string[][] = [];
  const fetch: NodeFetch = async (_url, init) => {
    attempt += 1;
    const batch = parseBatch(init);
    batches.push(batch.events.map((event) => event.eventId));
    if (attempt > 1) return response(202, batchResult(batch));
    return response(207, {
      protocolVersion: JOURNEY_EVENT_PROTOCOL_VERSION,
      batchId: batch.batchId,
      results: [
        {
          eventId: batch.events[0]!.eventId,
          index: 0,
          status: 'accepted',
          duplicate: false,
          retryable: false,
          receivedAt: '2026-08-04T12:00:01.000Z'
        },
        {
          eventId: batch.events[1]!.eventId,
          index: 1,
          status: 'rejected',
          duplicate: false,
          retryable: false,
          receivedAt: '2026-08-04T12:00:01.000Z',
          code: 'SCHEMA_REJECTED'
        }
      ]
    });
  };
  const client = createNodeJourneySdk({
    serverSecret: serverSecret(),
    endpoint: 'https://ingest.example.test',
    retry: { baseDelayMs: 100, jitterRatio: 0 },
    runtime: runtime(fetch, { now: () => now })
  });
  for (let index = 0; index < 3; index += 1) {
    await client.track(`mixed_${index}`, {}, { userId: 'user_1', eventId: eventId(50 + index) });
  }
  assert.deepEqual(await client.flush(), { status: 'retry_scheduled', accepted: 1, dropped: 1, retained: 1 });
  now += 100;
  assert.deepEqual(await client.flush(), { status: 'sent', accepted: 1, dropped: 0, retained: 0 });
  assert.deepEqual(batches, [[eventId(50), eventId(51), eventId(52)], [eventId(52)]]);
});

test('aborts timed-out requests and contains the failure', async () => {
  let aborted = false;
  const fetch: NodeFetch = async (_url, init) => new Promise<NodeResponseLike>(() => {
    init.signal?.addEventListener('abort', () => { aborted = true; });
  });
  const client = createNodeJourneySdk({
    serverSecret: serverSecret(),
    endpoint: 'https://ingest.example.test',
    requestTimeoutMs: 10,
    retry: { maxAttempts: 1 },
    batch: { flushIntervalMs: 60_000 },
    runtime: { fetch, randomUuid: uuidSequence(), now: () => baseTime }
  });
  await client.track('timeout_event', {}, { userId: 'user_1', eventId: eventId(60) });
  const flushed = client.flush();
  await assert.doesNotReject(flushed);
  assert.deepEqual(await flushed, { status: 'sent', accepted: 0, dropped: 1, retained: 0 });
  assert.equal(aborted, true);
});

test('coalesces concurrent flush calls into one transport request', async () => {
  let resolveResponse: ((value: NodeResponseLike) => void) | undefined;
  let batch: JourneyEventBatch | undefined;
  let calls = 0;
  const fetch: NodeFetch = async (_url, init) => {
    calls += 1;
    batch = parseBatch(init);
    return new Promise<NodeResponseLike>((resolve) => { resolveResponse = resolve; });
  };
  const client = createNodeJourneySdk({
    serverSecret: serverSecret(),
    endpoint: 'https://ingest.example.test',
    runtime: runtime(fetch)
  });
  await client.track('concurrent_flush', {}, { userId: 'user_1', eventId: eventId(70) });
  const first = client.flush();
  const second = client.flush();
  assert.strictEqual(first, second);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  resolveResponse?.(response(202, batchResult(batch!)));
  assert.deepEqual(await first, { status: 'sent', accepted: 1, dropped: 0, retained: 0 });
  assert.deepEqual(await second, { status: 'sent', accepted: 1, dropped: 0, retained: 0 });
});

test('close performs a final flush, releases the client, and never owns process lifecycle', async () => {
  const fetch: NodeFetch = async (_url, init) => response(202, batchResult(parseBatch(init)));
  const client = createNodeJourneySdk({
    serverSecret: serverSecret(),
    endpoint: 'https://ingest.example.test',
    runtime: runtime(fetch)
  });
  await client.track('close_flush', {}, { userId: 'user_1', eventId: eventId(80) });
  assert.deepEqual(await client.close(), { status: 'sent', accepted: 1, dropped: 0, retained: 0 });
  assert.deepEqual(client.status(), { enabled: false, closed: true, queued: 0, inFlight: false });
  assert.deepEqual(await client.track('after_close', {}, { userId: 'user_1' }), {
    status: 'closed', code: 'SDK_CLOSED'
  });
});

test('isolates hostile callbacks, transport errors, and invalid responses from the host process', async () => {
  let calls = 0;
  const fetch: NodeFetch = async () => {
    calls += 1;
    if (calls === 1) throw new Error(`never expose ${serverSecret()}`);
    return response(202, {}, {});
  };
  const diagnostics: string[] = [];
  const client = createNodeJourneySdk({
    serverSecret: serverSecret(),
    endpoint: 'https://ingest.example.test',
    retry: { baseDelayMs: 10, maxAttempts: 3, jitterRatio: 0 },
    runtime: runtime(fetch, { now: () => baseTime }),
    callbacks: {
      onOutcome: () => { throw new Error('host callback failed'); },
      onDiagnostic: (value) => {
        diagnostics.push(JSON.stringify(value));
        if (value.code === 'RETRY_SCHEDULED') throw new Error('host callback failed');
      }
    }
  });
  assert.doesNotReject(() => client.track('host_safe', {}, { userId: 'user_1', eventId: eventId(90) }));
  assert.doesNotReject(() => client.flush());
  assert.equal(client.status().queued, 1);
  assert.equal(diagnostics.some((entry) => entry.includes(serverSecret())), false);
});

test('uses process-local memory only and imports no filesystem persistence in the runtime package', async () => {
  const fetch: NodeFetch = async (_url, init) => response(202, batchResult(parseBatch(init)));
  const config = {
    serverSecret: serverSecret(),
    endpoint: 'https://ingest.example.test',
    runtime: runtime(fetch)
  };
  const first = createNodeJourneySdk(config);
  await first.track('memory_only', {}, { userId: 'user_1', eventId: eventId(100) });
  const second = createNodeJourneySdk(config);
  assert.equal(first.status().queued, 1);
  assert.equal(second.status().queued, 0);

  const clientSource = await readFile(new URL('../src/client.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(clientSource, /node:fs|localStorage|indexedDB|JourneyQueueStorage/u);
  await first.close();
  await second.close();
});
