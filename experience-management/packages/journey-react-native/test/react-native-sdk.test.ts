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
  createReactNativeJourneySdk,
  type MobileAppState,
  type MobileFetch,
  type MobileFetchInit,
  type MobileLifecycleAdapter,
  type MobileNetworkAdapter,
  type MobileResponseLike,
  type ReactNativeJourneyRuntime,
  type SecureJourneyStorage
} from '../src/index.js';

const baseTime = Date.parse('2026-08-04T12:00:00.000Z');
const PUBLIC_WRITE_KEY = 'jpk_dev.mobile_key_01.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function eventId(sequence: number) {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

function response(status: number, body: unknown, headers: Record<string, string> = {}): MobileResponseLike {
  const normalised = new Map(Object.entries(headers).map(([key, value]) => [key.toLocaleLowerCase('en-US'), value]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => normalised.get(name.toLocaleLowerCase('en-US')) ?? null },
    json: async () => body
  };
}

function parseBatch(init: MobileFetchInit) {
  return JSON.parse(init.body) as JourneyEventBatch;
}

function batchResult(
  batch: JourneyEventBatch,
  statuses?: Array<'accepted' | 'duplicate' | 'rejected'>
): BatchIngestResult {
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

class SecureStorageDouble implements SecureJourneyStorage {
  readonly security = Object.freeze({ encryptedAtRest: true as const, atomicCommit: true as const });
  value: string | null = null;
  reads = 0;
  commits = 0;
  removes = 0;
  failRead = false;
  failCommit = false;
  failRemove = false;

  async read() {
    this.reads += 1;
    if (this.failRead) throw new Error('encrypted store read failed');
    return this.value;
  }

  async commit(_key: string, value: string) {
    this.commits += 1;
    if (this.failCommit) throw new Error('encrypted atomic commit failed');
    this.value = value;
  }

  async remove() {
    this.removes += 1;
    if (this.failRemove) throw new Error('encrypted store remove failed');
    this.value = null;
  }
}

class LifecycleDouble implements MobileLifecycleAdapter {
  state: MobileAppState = 'active';
  listeners = new Set<(state: MobileAppState) => void>();
  currentState() { return this.state; }
  subscribe(listener: (state: MobileAppState) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  emit(state: MobileAppState) {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}

class NetworkDouble implements MobileNetworkAdapter {
  online = true;
  listeners = new Set<(online: boolean) => void>();
  isOnline() { return this.online; }
  subscribe(listener: (online: boolean) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  emit(online: boolean) {
    this.online = online;
    for (const listener of this.listeners) listener(online);
  }
}

function inertTimers() {
  return {
    setTimeout: (_callback: () => void, _delayMs: number) => Object.freeze({}),
    clearTimeout: (_handle: unknown) => undefined
  };
}

function runtime(fetch: MobileFetch, overrides: Partial<ReactNativeJourneyRuntime> = {}): ReactNativeJourneyRuntime {
  return {
    fetch,
    now: () => baseTime,
    random: () => 0.5,
    ...inertTimers(),
    ...overrides
  };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test('accepts public write keys only and fails closed for an unverified storage contract', async () => {
  const fetch: MobileFetch = async (_url, init) => response(202, batchResult(parseBatch(init)));
  const diagnostics: string[] = [];
  const serverSecret = createReactNativeJourneySdk({
    writeKey: `jsk_live.test.${'s'.repeat(43)}`,
    endpoint: 'https://ingest.example.test',
    runtime: runtime(fetch),
    debug: true,
    callbacks: { onDiagnostic: (entry) => diagnostics.push(JSON.stringify(entry)) }
  });
  await serverSecret.ready;
  assert.equal(serverSecret.enabled, false);

  const legacy = createReactNativeJourneySdk({
    writeKey: 'sp_test_legacy', endpoint: 'https://ingest.example.test', runtime: runtime(fetch)
  });
  const mismatched = createReactNativeJourneySdk({
    writeKey: PUBLIC_WRITE_KEY, endpoint: 'https://ingest.example.test', environment: 'production', runtime: runtime(fetch)
  });
  await Promise.all([legacy.ready, mismatched.ready]);
  assert.equal(legacy.enabled, false);
  assert.equal(mismatched.enabled, false);

  const invalidStorage = createReactNativeJourneySdk({
    writeKey: PUBLIC_WRITE_KEY,
    endpoint: 'https://ingest.example.test',
    storage: {
      security: { encryptedAtRest: true, atomicCommit: false }
    } as unknown as SecureJourneyStorage,
    runtime: runtime(fetch),
    debug: true,
    callbacks: { onDiagnostic: (entry) => diagnostics.push(JSON.stringify(entry)) }
  });
  await invalidStorage.ready;
  assert.equal(invalidStorage.enabled, false);
  assert.equal(invalidStorage.status().persistence, 'unavailable');
  assert.equal((await invalidStorage.track('must_not_buffer', {}, { userId: 'user_1' })).status, 'disabled');
  assert.equal(diagnostics.some((entry) => entry.includes('SECURE_STORAGE_CONTRACT_INVALID')), true);
  assert.equal(diagnostics.some((entry) => entry.includes('mobile_public')), false);

  const hostileStorage = {} as SecureJourneyStorage;
  Object.defineProperty(hostileStorage, 'security', {
    get() { throw new Error('native adapter getter failed'); }
  });
  const hostile = createReactNativeJourneySdk({
    writeKey: PUBLIC_WRITE_KEY,
    endpoint: 'https://ingest.example.test',
    storage: hostileStorage,
    runtime: runtime(fetch)
  });
  await hostile.ready;
  assert.equal(hostile.enabled, false);
  await Promise.all([serverSecret.destroy(), legacy.destroy(), mismatched.destroy(), invalidStorage.destroy(), hostile.destroy()]);
});

test('emits every canonical mobile call with stable IDs, secure persistence, and minimised context', async () => {
  const storage = new SecureStorageDouble();
  const requests: JourneyEventBatch[] = [];
  const fetch: MobileFetch = async (_url, init) => {
    const batch = parseBatch(init);
    requests.push(batch);
    return response(202, batchResult(batch));
  };
  const client = createReactNativeJourneySdk({
    writeKey: PUBLIC_WRITE_KEY,
    endpoint: 'https://ingest.example.test/root/',
    consent: { analytics: 'granted', source: 'cmp', updatedAt: '2026-08-04T12:00:00.000Z' },
    storage,
    automaticContext: { app: true, device: true, locale: true, timezone: true },
    privacy: { allowUrlQueryParameters: ['campaign'] },
    runtime: runtime(fetch, {
      context: {
        app: { name: 'Seemplify', version: '2.1.0', build: '42' },
        device: {
          type: 'mobile', operatingSystem: 'Android', operatingSystemVersion: '16', model: 'Test Phone'
        },
        locale: 'en-GB',
        timezone: 'Europe/London'
      }
    })
  });
  await client.ready;
  assert.equal(client.status().persistence, 'secure');

  await client.track('mobile_started', {
    safe: true, password: 'remove', nested: { device_id: 'remove', kept: 'yes' }
  }, { eventId: eventId(1) });
  await client.identify('user_1', { role: 'owner' }, { eventId: eventId(2) });
  await client.alias('user_1', 'anon_original', { eventId: eventId(3) });
  await client.group('account_1', { plan: 'team' }, { userId: 'user_1', eventId: eventId(4) });
  await client.screen('Workspace setup', { step: 2 }, {
    userId: 'user_1', eventId: eventId(5),
    context: { page: { url: 'https://u:p@example.test/mobile?campaign=welcome&token=remove#private' } }
  });
  await client.consent({ marketing: 'denied', source: 'settings' }, {
    userId: 'user_1', eventId: eventId(6)
  });

  assert.equal(storage.commits >= 6, true);
  assert.deepEqual(await client.flush(), { status: 'sent', accepted: 6, dropped: 0, retained: 0 });
  assert.equal(requests[0]?.events.length, 6);
  assert.deepEqual(requests[0]?.events.map((entry) => entry.call), [
    'track', 'identify', 'alias', 'group', 'screen', 'consent'
  ]);
  assert.deepEqual(requests[0]?.events[0]?.properties, { safe: true, nested: { kept: 'yes' } });
  assert.deepEqual(requests[0]?.events[4]?.context?.page, {
    url: 'https://example.test/mobile?campaign=welcome'
  });
  assert.deepEqual(requests[0]?.events[0]?.context?.app, {
    name: 'Seemplify', version: '2.1.0', build: '42'
  });
  assert.equal(requests[0]?.events[0]?.context?.device?.operatingSystem, 'Android');
  assert.equal(requests[0]?.events.every((entry) =>
    entry.context?.library?.name === '@seemplify/journey-react-native'), true);
  assert.equal(requests[0]?.events[5]?.consent?.analytics, 'granted');
  assert.equal(requests[0]?.events[5]?.consent?.marketing, 'denied');
});

test('interoperates with canonical mock ingestion and duplicate receipts', async () => {
  const key = PUBLIC_WRITE_KEY;
  const mock = createMockIngestServer({ writeKey: key });
  const endpoint = await mock.listen();
  try {
    const client = createReactNativeJourneySdk({
      writeKey: key,
      endpoint,
      consent: { analytics: 'granted', source: 'test', updatedAt: '2026-08-04T12:00:00.000Z' }
    });
    await client.track('mock_mobile', {}, { userId: 'user_1', eventId: eventId(10) });
    assert.equal((await client.flush()).accepted, 1);
    await client.track('mock_mobile', {}, { userId: 'user_1', eventId: eventId(10) });
    assert.equal((await client.flush()).accepted, 1);
    assert.deepEqual(mock.snapshot(), { acceptedEventIds: [eventId(10)], requestCount: 2 });
    await client.destroy();
  } finally {
    await mock.close();
  }
});

test('buffers before consent in memory only and atomically persists after grant', async () => {
  const storage = new SecureStorageDouble();
  const fetch: MobileFetch = async (_url, init) => response(202, batchResult(parseBatch(init)));
  const client = createReactNativeJourneySdk({
    writeKey: PUBLIC_WRITE_KEY,
    endpoint: 'https://ingest.example.test',
    beforeConsent: 'buffer-memory',
    storage,
    runtime: runtime(fetch)
  });
  await client.ready;
  assert.equal((await client.track('before_consent', {}, {
    anonymousId: 'anon_1', eventId: eventId(20)
  })).status, 'buffered');
  assert.equal(storage.commits, 0);
  assert.equal(storage.value, null);
  assert.deepEqual(client.status(), {
    enabled: true, queued: 0, buffered: 1, online: true, appState: 'active', persistence: 'secure'
  });

  assert.equal((await client.consent({ analytics: 'granted', source: 'cmp' }, {
    anonymousId: 'anon_1', eventId: eventId(21)
  })).status, 'queued');
  assert.equal(client.status().queued, 2);
  assert.equal(client.status().buffered, 0);
  assert.ok(storage.value);
  const stored = JSON.parse(storage.value) as { version: number; protocolVersion: string; entries: unknown[] };
  assert.equal(stored.version, 1);
  assert.equal(stored.protocolVersion, JOURNEY_EVENT_PROTOCOL_VERSION);
  assert.equal(stored.entries.length, 2);
  assert.equal(JSON.stringify(stored).includes('before_consent'), true);
});

test('consent denial purges secure analytics state before any future collection', async () => {
  const storage = new SecureStorageDouble();
  const batches: JourneyEventBatch[] = [];
  const fetch: MobileFetch = async (_url, init) => {
    const batch = parseBatch(init);
    batches.push(batch);
    return response(202, batchResult(batch));
  };
  const client = createReactNativeJourneySdk({
    writeKey: PUBLIC_WRITE_KEY,
    endpoint: 'https://ingest.example.test',
    consent: { analytics: 'granted', source: 'cmp', updatedAt: '2026-08-04T12:00:00.000Z' },
    storage,
    runtime: runtime(fetch)
  });
  await client.track('queued_private_fact', {}, { userId: 'user_1', eventId: eventId(30) });
  assert.ok(storage.value);
  assert.equal((await client.consent({ analytics: 'denied', source: 'cmp' }, {
    userId: 'user_1', eventId: eventId(31)
  })).status, 'queued');
  assert.equal(storage.value, null);
  assert.equal((await client.track('after_denial', {}, {
    userId: 'user_1', eventId: eventId(32)
  })).code, 'ANALYTICS_CONSENT_NOT_GRANTED');
  assert.equal(client.status().queued, 1);
  await client.flush();
  assert.deepEqual(batches.flatMap((batch) => batch.events.map((event) => event.call)), ['consent']);
});

test('secure storage failures disable collection without a plaintext or memory fallback', async () => {
  const storage = new SecureStorageDouble();
  storage.failCommit = true;
  const diagnostics: string[] = [];
  const fetch: MobileFetch = async (_url, init) => response(202, batchResult(parseBatch(init)));
  const client = createReactNativeJourneySdk({
    writeKey: PUBLIC_WRITE_KEY,
    endpoint: 'https://ingest.example.test',
    consent: { analytics: 'granted', source: 'cmp', updatedAt: '2026-08-04T12:00:00.000Z' },
    storage,
    runtime: runtime(fetch),
    debug: true,
    callbacks: { onDiagnostic: (entry) => diagnostics.push(JSON.stringify(entry)) }
  });
  const result = await client.track('cannot_commit', {}, { userId: 'user_1', eventId: eventId(40) });
  assert.deepEqual(result, { status: 'dropped', code: 'SECURE_STORAGE_COMMIT_FAILED', eventId: eventId(40) });
  assert.deepEqual(client.status(), {
    enabled: false, queued: 0, buffered: 0, online: true, appState: 'active', persistence: 'unavailable'
  });
  assert.equal(diagnostics.some((entry) => entry.includes('SECURE_STORAGE_COMMIT_FAILED')), true);
  assert.equal(diagnostics.some((entry) => entry.includes('cannot_commit')), false);
});

test('hydrates the current state across restart and fails safely at corrupt or unsupported upgrade boundaries', async () => {
  const fetch: MobileFetch = async (_url, init) => response(202, batchResult(parseBatch(init)));
  const event: JourneyEventEnvelope = {
    protocolVersion: JOURNEY_EVENT_PROTOCOL_VERSION,
    eventId: eventId(50),
    call: 'track',
    event: 'stored_mobile_event',
    eventVersion: 1,
    occurredAt: '2026-08-04T11:59:59.000Z',
    anonymousId: 'anon_stored',
    properties: { safe: true }
  };
  const valid = new SecureStorageDouble();
  valid.value = JSON.stringify({
    version: 1,
    protocolVersion: JOURNEY_EVENT_PROTOCOL_VERSION,
    anonymousId: 'anon_stored',
    entries: [{ event, enqueuedAt: baseTime, attempts: 0, nextAttemptAt: 0, purpose: 'analytics' }]
  });
  const hydrated = createReactNativeJourneySdk({
    writeKey: PUBLIC_WRITE_KEY, endpoint: 'https://ingest.example.test',
    consent: { analytics: 'granted', source: 'cmp', updatedAt: '2026-08-04T12:00:00.000Z' },
    storage: valid, runtime: runtime(fetch)
  });
  await hydrated.ready;
  assert.equal(hydrated.status().queued, 1);
  assert.equal((await hydrated.flush()).accepted, 1);

  const expired = new SecureStorageDouble();
  expired.value = JSON.stringify({
    version: 1,
    protocolVersion: JOURNEY_EVENT_PROTOCOL_VERSION,
    anonymousId: 'anon_stored',
    entries: [{ event, enqueuedAt: baseTime - 2_000, attempts: 0, nextAttemptAt: 0, purpose: 'analytics' }]
  });
  const expiryClient = createReactNativeJourneySdk({
    writeKey: PUBLIC_WRITE_KEY, endpoint: 'https://ingest.example.test',
    consent: { analytics: 'granted', source: 'cmp', updatedAt: '2026-08-04T12:00:00.000Z' },
    queue: { maxAgeMs: 1_000 }, storage: expired, runtime: runtime(fetch)
  });
  await expiryClient.ready;
  assert.equal(expiryClient.status().queued, 0);
  assert.equal((JSON.parse(expired.value!) as { entries: unknown[] }).entries.length, 0);

  for (const [value, expectedCode] of [
    ['not-json', 'SECURE_STORAGE_CORRUPT'],
    [JSON.stringify({ version: 99, protocolVersion: JOURNEY_EVENT_PROTOCOL_VERSION, entries: [] }),
      'SECURE_STORAGE_VERSION_UNSUPPORTED']
  ] as const) {
    const storage = new SecureStorageDouble();
    storage.value = value;
    const diagnostics: string[] = [];
    const client = createReactNativeJourneySdk({
      writeKey: PUBLIC_WRITE_KEY, endpoint: 'https://ingest.example.test', storage,
      runtime: runtime(fetch), debug: true,
      callbacks: { onDiagnostic: (entry) => diagnostics.push(entry.code) }
    });
    await client.ready;
    assert.equal(client.enabled, true);
    assert.equal(storage.value, null);
    assert.equal(diagnostics.includes(expectedCode), true);
  }
});

test('handles offline, network, foreground, background, and battery-conscious automatic flush', async () => {
  const lifecycle = new LifecycleDouble();
  const network = new NetworkDouble();
  network.online = false;
  let batteryLevel = 0.1;
  let requests = 0;
  const fetch: MobileFetch = async (_url, init) => {
    requests += 1;
    return response(202, batchResult(parseBatch(init)));
  };
  const client = createReactNativeJourneySdk({
    writeKey: PUBLIC_WRITE_KEY, endpoint: 'https://ingest.example.test',
    consent: { analytics: 'granted', source: 'cmp', updatedAt: '2026-08-04T12:00:00.000Z' },
    runtime: runtime(fetch, {
      lifecycle,
      network,
      battery: { level: () => batteryLevel, lowPowerMode: () => false }
    })
  });
  await client.ready;
  await client.track('lifecycle_mobile', {}, { userId: 'user_1', eventId: eventId(60) });
  assert.equal((await client.flush()).status, 'offline');
  network.emit(true);
  await settle();
  assert.equal(requests, 0);
  assert.equal(client.status().queued, 1);

  batteryLevel = 0.9;
  lifecycle.emit('background');
  await settle();
  assert.equal(requests, 1);
  assert.equal(client.status().queued, 0);

  await client.track('foreground_mobile', {}, { userId: 'user_1', eventId: eventId(61) });
  lifecycle.emit('active');
  await settle();
  assert.equal(requests, 2);
  await client.destroy();
  assert.equal(lifecycle.listeners.size, 0);
  assert.equal(network.listeners.size, 0);
});

test('bounds queue count and age with explicit outcomes', async () => {
  let now = baseTime;
  const dropped: string[] = [];
  let requests = 0;
  const fetch: MobileFetch = async (_url, init) => {
    requests += 1;
    return response(202, batchResult(parseBatch(init)));
  };
  const client = createReactNativeJourneySdk({
    writeKey: PUBLIC_WRITE_KEY, endpoint: 'https://ingest.example.test',
    consent: { analytics: 'granted', source: 'cmp', updatedAt: '2026-08-04T12:00:00.000Z' },
    queue: { maxEvents: 2, maxAgeMs: 1_000, overflow: 'drop-oldest' },
    batch: { maxEvents: 100 },
    runtime: runtime(fetch, { now: () => now }),
    callbacks: { onOutcome: (entry) => {
      if (entry.kind === 'dropped' && entry.eventId) dropped.push(entry.eventId);
    } }
  });
  await client.track('one', {}, { userId: 'user_1', eventId: eventId(70) });
  await client.track('two', {}, { userId: 'user_1', eventId: eventId(71) });
  await client.track('three', {}, { userId: 'user_1', eventId: eventId(72) });
  assert.equal(client.status().queued, 2);
  assert.deepEqual(dropped, [eventId(70)]);
  now += 1_000;
  assert.deepEqual(await client.flush(), { status: 'empty', accepted: 0, dropped: 2, retained: 0 });
  assert.equal(requests, 0);

  const byteBounded = createReactNativeJourneySdk({
    writeKey: PUBLIC_WRITE_KEY, endpoint: 'https://ingest.example.test',
    consent: { analytics: 'granted', source: 'cmp', updatedAt: '2026-08-04T12:00:00.000Z' },
    queue: { maxEvents: 10, maxBytes: 1_024, overflow: 'drop-newest' },
    runtime: runtime(fetch)
  });
  const oversized = await byteBounded.track('oversized_mobile', {
    content: 'x'.repeat(2_000)
  }, { userId: 'user_1', eventId: eventId(73) });
  assert.deepEqual(oversized, {
    status: 'dropped', code: 'EVENT_EXCEEDS_QUEUE_BYTES', eventId: eventId(73)
  });
  assert.equal(byteBounded.status().queued, 0);
});

test('handles partial results and retries only missing events with stable IDs', async () => {
  let now = baseTime;
  let attempt = 0;
  const sent: string[][] = [];
  const fetch: MobileFetch = async (_url, init) => {
    attempt += 1;
    const batch = parseBatch(init);
    sent.push(batch.events.map((event) => event.eventId));
    if (attempt > 1) return response(202, batchResult(batch, ['duplicate']));
    return response(207, {
      protocolVersion: JOURNEY_EVENT_PROTOCOL_VERSION,
      batchId: batch.batchId,
      results: [
        {
          eventId: batch.events[0]!.eventId, index: 0, status: 'accepted', duplicate: false,
          retryable: false, receivedAt: '2026-08-04T12:00:01.000Z'
        },
        {
          eventId: batch.events[1]!.eventId, index: 1, status: 'rejected', duplicate: false,
          retryable: false, receivedAt: '2026-08-04T12:00:01.000Z', code: 'SCHEMA_REJECTED'
        }
      ]
    });
  };
  const client = createReactNativeJourneySdk({
    writeKey: PUBLIC_WRITE_KEY, endpoint: 'https://ingest.example.test',
    consent: { analytics: 'granted', source: 'cmp', updatedAt: '2026-08-04T12:00:00.000Z' },
    retry: { baseDelayMs: 100, jitterRatio: 0 },
    runtime: runtime(fetch, { now: () => now })
  });
  for (let index = 0; index < 3; index += 1) {
    await client.track(`partial_${index}`, {}, { userId: 'user_1', eventId: eventId(80 + index) });
  }
  assert.deepEqual(await client.flush(), { status: 'retry_scheduled', accepted: 1, dropped: 1, retained: 1 });
  now += 100;
  assert.deepEqual(await client.flush(), { status: 'sent', accepted: 1, dropped: 0, retained: 0 });
  assert.deepEqual(sent, [[eventId(80), eventId(81), eventId(82)], [eventId(82)]]);
});

test('contains timeout, transport, timer, and callback failures inside the SDK', async () => {
  let aborted = false;
  const fetch: MobileFetch = async (_url, init) => new Promise<MobileResponseLike>(() => {
    init.signal?.addEventListener?.('abort', () => { aborted = true; });
  });
  const diagnostics: string[] = [];
  const client = createReactNativeJourneySdk({
    writeKey: PUBLIC_WRITE_KEY, endpoint: 'https://ingest.example.test',
    consent: { analytics: 'granted', source: 'cmp', updatedAt: '2026-08-04T12:00:00.000Z' },
    requestTimeoutMs: 100,
    retry: { maxAttempts: 1 },
    runtime: runtime(fetch, {
      setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
      clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
      createAbortController: () => {
        const listeners = new Set<() => void>();
        return {
          signal: { addEventListener: (_type, listener) => { listeners.add(listener); } },
          abort: () => { for (const listener of listeners) listener(); }
        };
      }
    }),
    debug: true,
    callbacks: {
      onOutcome: () => { throw new Error('host callback failed'); },
      onDiagnostic: (entry) => { diagnostics.push(JSON.stringify(entry)); throw new Error('host callback failed'); }
    }
  });
  await client.track('timeout_mobile', {}, { userId: 'user_1', eventId: eventId(90) });
  assert.deepEqual(await client.flush(), { status: 'sent', accepted: 0, dropped: 1, retained: 0 });
  assert.equal(aborted, true);
  assert.equal(diagnostics.some((entry) => entry.includes('timeout_mobile')), false);
  await client.destroy();
});

test('runtime source has no DOM, Node built-ins, plaintext fallback, console, or dynamic code', async () => {
  const sourceFiles = ['client.ts', 'id.ts', 'index.ts', 'privacy.ts', 'types.ts'];
  const source = (await Promise.all(sourceFiles.map((file) =>
    readFile(new URL(`../src/${file}`, import.meta.url), 'utf8')))).join('\n');
  assert.doesNotMatch(source, /node:|\bwindow\b|\bdocument\b|\bnavigator\b|localStorage|AsyncStorage|indexedDB/u);
  assert.doesNotMatch(source, /\bconsole\s*\.|\beval\s*\(|\bnew\s+Function\b/u);
  assert.match(source, /encryptedAtRest/u);
  assert.match(source, /atomicCommit/u);
});
