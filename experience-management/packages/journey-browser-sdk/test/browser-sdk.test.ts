import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { test } from 'node:test';
import {
  JOURNEY_EVENT_PROTOCOL_VERSION,
  validateEventEnvelope,
  type BatchIngestResult,
  type JourneyEventBatch
} from '@seemplify/journey-event-protocol';
import {
  createMockIngestServer,
  MOCK_INGEST_DEFAULT_WRITE_KEY
} from '@seemplify/journey-event-protocol/mock';
import {
  createBrowserJourneySdk,
  createLocalStorageQueueStorage,
  type BrowserFetch,
  type BrowserFetchInit,
  type BrowserResponseLike,
  type EventTargetLike,
  type JourneyQueueStorage,
  type StorageLike
} from '../src/index.js';

const granted = {
  analytics: 'granted' as const,
  source: 'test_cmp',
  updatedAt: '2026-08-04T12:00:00.000Z'
};
const PUBLIC_WRITE_KEY = 'jpk_dev.browser_key_01.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const LIVE_PUBLIC_WRITE_KEY = 'jpk_live.browser_key_02.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function eventId(sequence: number) {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

function seededRandom(seed = 1) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1_664_525 + 1_013_904_223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

class MemoryStorage implements JourneyQueueStorage, StorageLike {
  readonly values = new Map<string, string>();
  reads = 0;
  writes = 0;
  removals = 0;

  getItem(key: string) {
    this.reads += 1;
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.writes += 1;
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.removals += 1;
    this.values.delete(key);
  }
}

class EventBus implements EventTargetLike {
  private readonly listeners = new Map<string, Set<() => void>>();

  addEventListener(type: string, listener: () => void) {
    const entries = this.listeners.get(type) ?? new Set<() => void>();
    entries.add(listener);
    this.listeners.set(type, entries);
  }

  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

function response(status: number, body: unknown, headers: Record<string, string> = {}): BrowserResponseLike {
  const normalised = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => normalised.get(name.toLowerCase()) ?? null },
    json: async () => body
  };
}

function parseBatch(init: BrowserFetchInit) {
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
    setTimeout: (_callback: () => void, _delay: number) => Object.freeze({}),
    clearTimeout: (_handle: unknown) => undefined
  };
}

function baseRuntime(fetch: BrowserFetch, now: () => number = () => Date.parse('2026-08-04T12:00:00.000Z')) {
  return {
    fetch,
    now,
    random: seededRandom(),
    byteLength: (value: string) => new TextEncoder().encode(value).byteLength,
    ...inertTimers()
  };
}

async function eventually(assertion: () => void) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try { assertion(); return; } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw lastError;
}

test('emits all browser calls with supplied stable IDs, generated IDs, batching, and recursive redaction', async () => {
  const requests: Array<{ url: string; init: BrowserFetchInit }> = [];
  const fetch: BrowserFetch = async (url, init) => {
    requests.push({ url, init });
    const batch = parseBatch(init);
    return response(202, batchResult(batch));
  };
  const client = createBrowserJourneySdk({
    writeKey: PUBLIC_WRITE_KEY,
    endpoint: 'https://ingest.example.test',
    consent: granted,
    runtime: baseRuntime(fetch)
  });
  await client.ready;

  assert.equal((await client.track('workspace_created', {
    safe: true,
    password: 'must-not-leave',
    nested: { access_token: 'must-not-leave', kept: 'yes' }
  }, { eventId: eventId(1) })).eventId, eventId(1));
  assert.equal((await client.identify('customer_123', { role: 'owner' }, { eventId: eventId(2) })).status, 'queued');
  assert.equal((await client.alias('customer_123', 'anon_previous', { eventId: eventId(3) })).status, 'queued');
  assert.equal((await client.group('company_456', { plan: 'test' }, { eventId: eventId(4) })).status, 'queued');
  assert.equal((await client.page('home', { source: 'navigation' }, { eventId: eventId(5) })).status, 'queued');
  const generated = await client.screen('settings', undefined);
  assert.match(generated.eventId ?? '', /^[0-9a-f-]{36}$/);

  const flushed = await client.flush();
  assert.equal(flushed.accepted, 6);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, 'https://ingest.example.test/v1/batch');
  assert.equal(requests[0]?.init.credentials, 'omit');
  assert.equal(requests[0]?.init.cache, 'no-store');
  const sent = parseBatch(requests[0]!.init);
  assert.deepEqual(sent.events.map((event) => event.call), ['track', 'identify', 'alias', 'group', 'page', 'screen']);
  assert.equal(sent.events[0]?.eventId, eventId(1));
  assert.deepEqual(sent.events[0]?.properties, { safe: true, nested: { kept: 'yes' } });
  assert.equal(sent.events.every((event) => event.context?.library?.name === '@seemplify/journey-browser-sdk'), true);
  await client.destroy();
});

test('reuses the shared protocol conformance shape', async () => {
  const fixture = JSON.parse(await readFile(new URL('../../journey-event-protocol/fixtures/v1/valid/track.json', import.meta.url), 'utf8'));
  const requests: JourneyEventBatch[] = [];
  const client = createBrowserJourneySdk({
    writeKey: PUBLIC_WRITE_KEY, endpoint: 'https://fixture.example.test', consent: granted,
    runtime: baseRuntime(async (_url, init) => {
      const batch = parseBatch(init); requests.push(batch);
      return response(202, batchResult(batch));
    })
  });
  await client.track(fixture.event, fixture.properties, {
    eventId: fixture.eventId,
    occurredAt: fixture.occurredAt,
    anonymousId: fixture.anonymousId,
    userId: fixture.userId,
    accountId: fixture.accountId,
    sessionId: fixture.sessionId
  });
  await client.flush();
  const generated = requests[0]?.events[0];
  assert.equal(validateEventEnvelope(generated).ok, true);
  assert.equal(generated?.event, fixture.event);
  assert.equal(generated?.protocolVersion, fixture.protocolVersion);
  await client.destroy();
});

test('interoperates with the shared non-durable mock and its duplicate receipt contract', async () => {
  const mock = createMockIngestServer();
  const endpoint = await mock.listen();
  try {
    const browserFetch: BrowserFetch = (url, init) => globalThis.fetch(url, init as RequestInit) as Promise<Response>;
    const client = createBrowserJourneySdk({
      writeKey: MOCK_INGEST_DEFAULT_WRITE_KEY,
      endpoint,
      consent: granted,
      runtime: baseRuntime(browserFetch)
    });
    await client.track('mock_contract', {}, { eventId: eventId(9) });
    assert.equal((await client.flush()).accepted, 1);
    await client.track('mock_contract', {}, { eventId: eventId(9) });
    assert.equal((await client.flush()).accepted, 1, 'duplicate receipts are terminal success');
    assert.deepEqual(mock.snapshot(), { acceptedEventIds: [eventId(9)], requestCount: 2 });
    await client.destroy();
  } finally {
    await mock.close();
  }
});

test('drops by default before analytics consent without persistence or transport', async () => {
  let calls = 0;
  const storage = new MemoryStorage();
  const client = createBrowserJourneySdk({
    writeKey: PUBLIC_WRITE_KEY, endpoint: 'https://consent.example.test', storage,
    runtime: baseRuntime(async () => { calls += 1; return response(500, {}); })
  });
  const result = await client.track('not_permitted', { private: 'fact' }, { eventId: eventId(10) });
  assert.deepEqual(result, { status: 'dropped', code: 'ANALYTICS_CONSENT_NOT_GRANTED', eventId: eventId(10) });
  assert.equal(client.status().queued, 0);
  assert.equal(storage.values.size, 0);
  assert.equal((await client.flush()).status, 'empty');
  assert.equal(calls, 0);
  await client.destroy();
});

test('creation remains non-blocking while asynchronous persistence hydrates', async () => {
  let resolveRead: ((value: string | null) => void) | undefined;
  const storage: JourneyQueueStorage = {
    getItem: () => new Promise<string | null>((resolve) => { resolveRead = resolve; }),
    setItem: () => undefined,
    removeItem: () => undefined
  };
  const client = createBrowserJourneySdk({
    writeKey: PUBLIC_WRITE_KEY, endpoint: 'https://async.example.test', consent: granted, storage,
    runtime: baseRuntime(async (_url, init) => response(202, batchResult(parseBatch(init))))
  });
  assert.equal(client.enabled, true);
  assert.equal(client.status().queued, 0);
  resolveRead?.(null);
  await client.ready;
  await client.destroy();
});

test('buffers pre-consent events in memory only and promotes them after a grant', async () => {
  const storage = new MemoryStorage();
  const sent: JourneyEventBatch[] = [];
  const client = createBrowserJourneySdk({
    writeKey: PUBLIC_WRITE_KEY, endpoint: 'https://consent.example.test', storage,
    beforeConsent: 'buffer-memory', runtime: baseRuntime(async (_url, init) => {
      const batch = parseBatch(init); sent.push(batch);
      return response(202, batchResult(batch));
    })
  });
  const buffered = await client.track('buffered_fact', { value: 1 }, { eventId: eventId(11) });
  assert.equal(buffered.status, 'buffered');
  assert.equal(client.status().buffered, 1);
  assert.equal(storage.values.size, 0);

  const consentResult = await client.consent({ analytics: 'granted', source: 'test_cmp' }, { eventId: eventId(12) });
  assert.equal(consentResult.status, 'queued');
  assert.equal(client.status().buffered, 0);
  assert.equal(client.status().queued, 2);
  const persisted = [...storage.values.values()].join('');
  assert.match(persisted, new RegExp(eventId(11)));
  await client.flush();
  assert.deepEqual(sent[0]?.events.map((event) => event.call), ['consent', 'track']);
  assert.equal(sent[0]?.events[1]?.consent?.analytics, 'granted');
  await client.destroy();
});

test('bounds the memory-only pre-consent buffer by encoded bytes', async () => {
  const outcomes: string[] = [];
  const client = createBrowserJourneySdk({
    writeKey: PUBLIC_WRITE_KEY, endpoint: 'https://consent.example.test', beforeConsent: 'buffer-memory',
    queue: { maxBytes: 2_000, maxEvents: 10, overflow: 'drop-oldest' },
    callbacks: { onOutcome: (entry) => outcomes.push(`${entry.code}:${entry.eventId ?? ''}`) },
    runtime: baseRuntime(async (_url, init) => response(202, batchResult(parseBatch(init))))
  });
  await client.track('buffer_one', { value: 'x'.repeat(900) }, { eventId: eventId(16) });
  await client.track('buffer_two', { value: 'y'.repeat(900) }, { eventId: eventId(17) });
  assert.equal(client.status().buffered, 1);
  assert.equal(outcomes.includes(`CONSENT_BUFFER_OVERFLOW:${eventId(16)}`), true);
  await client.destroy();
});

test('consent withdrawal purges queued behavioural facts and never persists or transmits denied facts', async () => {
  const storage = new MemoryStorage();
  const sent: JourneyEventBatch[] = [];
  const client = createBrowserJourneySdk({
    writeKey: PUBLIC_WRITE_KEY, endpoint: 'https://consent.example.test', storage, consent: granted,
    runtime: baseRuntime(async (_url, init) => {
      const batch = parseBatch(init); sent.push(batch);
      return response(202, batchResult(batch));
    })
  });
  await client.track('queued_before_withdrawal', { customer_note: 'prohibited-after-withdrawal' }, { eventId: eventId(13) });
  assert.match([...storage.values.values()].join(''), /queued_before_withdrawal/);
  const withdrawal = await client.consent({ analytics: 'denied', source: 'test_cmp' }, { eventId: eventId(14) });
  assert.equal(withdrawal.status, 'queued');
  assert.doesNotMatch([...storage.values.values()].join(''), /queued_before_withdrawal/);
  const deniedFact = await client.track('fact_while_denied', { secret: 'never' }, { eventId: eventId(15) });
  assert.equal(deniedFact.status, 'dropped');
  await client.flush();
  assert.deepEqual(sent.flatMap((batch) => batch.events.map((event) => event.call)), ['consent']);
  assert.equal(sent.some((batch) => batch.events.some((event) => event.eventId === eventId(13) || event.eventId === eventId(15))), false);
  assert.equal(storage.values.size, 0);
  await client.destroy();
});

test('retries at least once with the same event ID and accepts a duplicate response safely', async () => {
  let now = Date.parse('2026-08-04T12:00:00.000Z');
  const attempts: JourneyEventBatch[] = [];
  const fetch: BrowserFetch = async (_url, init) => {
    const batch = parseBatch(init); attempts.push(batch);
    if (attempts.length === 1) throw new TypeError('simulated lost response');
    return response(200, batchResult(batch, ['duplicate']));
  };
  const client = createBrowserJourneySdk({
    writeKey: PUBLIC_WRITE_KEY, endpoint: 'https://retry.example.test', consent: granted,
    retry: { baseDelayMs: 100, maxDelayMs: 1_000, jitterRatio: 0, maxAttempts: 3 },
    runtime: baseRuntime(fetch, () => now)
  });
  await client.track('retry_safe', {}, { eventId: eventId(20) });
  assert.equal((await client.flush()).status, 'retry_scheduled');
  assert.equal(client.status().queued, 1);
  now += 100;
  const second = await client.flush();
  assert.equal(second.accepted, 1);
  assert.equal(client.status().queued, 0);
  assert.deepEqual(attempts.map((batch) => batch.events[0]?.eventId), [eventId(20), eventId(20)]);
  await client.destroy();
});

test('honours a bounded Retry-After before retrying', async () => {
  let now = Date.parse('2026-08-04T12:00:00.000Z');
  let calls = 0;
  const client = createBrowserJourneySdk({
    writeKey: PUBLIC_WRITE_KEY, endpoint: 'https://retry.example.test', consent: granted,
    retry: { baseDelayMs: 100, maxDelayMs: 5_000, jitterRatio: 0, maxAttempts: 3 },
    runtime: baseRuntime(async (_url, init) => {
      calls += 1;
      const batch = parseBatch(init);
      return calls === 1
        ? response(429, {}, { 'retry-after': '2' })
        : response(202, batchResult(batch));
    }, () => now)
  });
  await client.track('retry_after', {}, { eventId: eventId(23) });
  assert.equal((await client.flush()).status, 'retry_scheduled');
  now += 1_999;
  assert.equal((await client.flush()).status, 'retry_scheduled');
  assert.equal(calls, 1);
  now += 1;
  assert.equal((await client.flush()).accepted, 1);
  assert.equal(calls, 2);
  await client.destroy();
});

test('retains missing and retryable partial results but drops explicit non-retryable rejections', async () => {
  let now = Date.parse('2026-08-04T12:00:00.000Z');
  let call = 0;
  const client = createBrowserJourneySdk({
    writeKey: PUBLIC_WRITE_KEY, endpoint: 'https://partial.example.test', consent: granted,
    retry: { baseDelayMs: 100, jitterRatio: 0, maxAttempts: 3 },
    runtime: baseRuntime(async (_url, init) => {
      call += 1;
      const batch = parseBatch(init);
      if (call === 1) {
        const full = batchResult(batch);
        full.results = full.results.slice(0, 1);
        return response(207, full);
      }
      return response(207, batchResult(batch, ['rejected']));
    }, () => now)
  });
  await client.track('partial_one', {}, { eventId: eventId(21) });
  await client.track('partial_two', {}, { eventId: eventId(22) });
  const first = await client.flush();
  assert.equal(first.accepted, 1);
  assert.equal(first.retained, 1);
  now += 100;
  const second = await client.flush();
  assert.equal(second.dropped, 1);
  assert.equal(second.retained, 0);
  await client.destroy();
});

test('isolates corrupt persistence and supports the localStorage adapter', async () => {
  const underlying = new MemoryStorage();
  underlying.values.set('custom-key', '{not-json');
  const diagnostics: string[] = [];
  const client = createBrowserJourneySdk({
    writeKey: PUBLIC_WRITE_KEY, endpoint: 'https://storage.example.test', consent: granted,
    storage: createLocalStorageQueueStorage(underlying), storageKey: 'custom-key', environment: 'development', debug: true,
    callbacks: { onDiagnostic: (entry) => diagnostics.push(entry.code) },
    runtime: baseRuntime(async (_url, init) => response(202, batchResult(parseBatch(init))))
  });
  await client.ready;
  assert.equal(client.status().queued, 0);
  assert.equal(underlying.removals, 1);
  assert.deepEqual(diagnostics, ['STORAGE_CORRUPT']);
  assert.equal((await client.track('after_corruption', {}, { eventId: eventId(30) })).status, 'queued');
  await client.destroy();
});

test('hydrates a valid bounded persisted queue without changing event identity', async () => {
  const storage = new MemoryStorage();
  const observed: JourneyEventBatch[] = [];
  const fetch: BrowserFetch = async (_url, init) => {
    const batch = parseBatch(init); observed.push(batch);
    return response(202, batchResult(batch));
  };
  const first = createBrowserJourneySdk({
    writeKey: PUBLIC_WRITE_KEY, endpoint: 'https://storage.example.test', consent: granted, storage,
    runtime: baseRuntime(fetch)
  });
  await first.track('persist_me', {}, { eventId: eventId(31) });
  assert.match([...storage.values.values()].join(''), new RegExp(eventId(31)));

  const second = createBrowserJourneySdk({
    writeKey: PUBLIC_WRITE_KEY, endpoint: 'https://storage.example.test', consent: granted, storage,
    runtime: baseRuntime(fetch)
  });
  await second.ready;
  assert.equal(second.status().queued, 1);
  await second.flush();
  assert.equal(observed.at(-1)?.events[0]?.eventId, eventId(31));
  await first.reset();
  await first.destroy();
  await second.destroy();
});

test('handles offline, online, pagehide, and hidden-document lifecycle without host errors', async () => {
  const lifecycle = new EventBus();
  const document = new EventBus() as EventBus & { visibilityState: string };
  document.visibilityState = 'visible';
  const navigator = { onLine: false };
  const requests: BrowserFetchInit[] = [];
  const client = createBrowserJourneySdk({
    writeKey: PUBLIC_WRITE_KEY, endpoint: 'https://lifecycle.example.test', consent: granted,
    runtime: {
      ...baseRuntime(async (_url, init) => {
        requests.push(init);
        return response(202, batchResult(parseBatch(init)));
      }),
      lifecycleTarget: lifecycle,
      document,
      navigator
    }
  });
  await client.track('offline_event', {}, { eventId: eventId(40) });
  assert.equal((await client.flush()).status, 'offline');
  assert.equal(requests.length, 0);
  navigator.onLine = true;
  lifecycle.dispatch('online');
  await eventually(() => assert.equal(requests.length, 1));

  await client.track('pagehide_event', {}, { eventId: eventId(41) });
  lifecycle.dispatch('pagehide');
  await eventually(() => assert.equal(requests.length, 2));
  assert.equal(requests[1]?.keepalive, true);

  await client.track('visibility_event', {}, { eventId: eventId(42) });
  document.visibilityState = 'hidden';
  document.dispatch('visibilitychange');
  await eventually(() => assert.equal(requests.length, 3));
  assert.equal(requests[2]?.keepalive, true);
  await client.destroy();
});

test('enforces count and age bounds with explicit oldest overflow', async () => {
  let now = Date.parse('2026-08-04T12:00:00.000Z');
  const storage = new MemoryStorage();
  const outcomes: string[] = [];
  const client = createBrowserJourneySdk({
    writeKey: PUBLIC_WRITE_KEY, endpoint: 'https://bounds.example.test', consent: granted, storage,
    queue: { maxEvents: 2, maxAgeMs: 1_000, overflow: 'drop-oldest' },
    callbacks: { onOutcome: (entry) => outcomes.push(`${entry.code}:${entry.eventId ?? ''}`) },
    runtime: baseRuntime(async (_url, init) => response(202, batchResult(parseBatch(init))), () => now)
  });
  await client.track('first', {}, { eventId: eventId(50) });
  await client.track('second', {}, { eventId: eventId(51) });
  await client.track('third', {}, { eventId: eventId(52) });
  assert.equal(client.status().queued, 2);
  assert.equal(outcomes.includes(`QUEUE_OVERFLOW_OLDEST:${eventId(50)}`), true);
  const stored = [...storage.values.values()].join('');
  assert.doesNotMatch(stored, new RegExp(eventId(50)));
  now += 1_001;
  const flushed = await client.flush();
  assert.equal(flushed.dropped, 2);
  assert.equal(client.status().queued, 0);
  await client.destroy();
});

test('reset purges queue, persisted identity, consent, and future tracking until consent returns', async () => {
  const storage = new MemoryStorage();
  const client = createBrowserJourneySdk({
    writeKey: PUBLIC_WRITE_KEY, endpoint: 'https://reset.example.test', consent: granted, storage,
    runtime: baseRuntime(async (_url, init) => response(202, batchResult(parseBatch(init))))
  });
  await client.identify('customer_to_forget', {}, { eventId: eventId(60) });
  assert.equal(client.status().queued, 1);
  await client.reset();
  assert.equal(client.status().queued, 0);
  assert.equal(storage.values.size, 0);
  assert.equal((await client.track('after_reset', {}, { eventId: eventId(61) })).status, 'dropped');
  await client.destroy();
});

test('unavailable endpoints and retry exhaustion never reject into the host application', async () => {
  let now = Date.parse('2026-08-04T12:00:00.000Z');
  const diagnostics: string[] = [];
  const client = createBrowserJourneySdk({
    writeKey: LIVE_PUBLIC_WRITE_KEY, endpoint: 'https://unavailable.example.test', consent: granted,
    environment: 'production', debug: true,
    retry: { baseDelayMs: 100, jitterRatio: 0, maxAttempts: 2 },
    callbacks: { onDiagnostic: (entry) => diagnostics.push(entry.code) },
    runtime: baseRuntime(async () => { throw new TypeError('offline'); }, () => now)
  });
  assert.doesNotReject(() => client.track('host_safe', {}, { eventId: eventId(70) }));
  assert.equal((await client.flush()).status, 'retry_scheduled');
  now += 100;
  const exhausted = await client.flush();
  assert.equal(exhausted.dropped, 1);
  assert.equal(client.status().queued, 0);
  assert.deepEqual(diagnostics, [], 'debug callbacks are disabled in production');
  await client.destroy();
});

test('automatic context is manual-only by default and opt-in URLs are minimised', async () => {
  const batches: JourneyEventBatch[] = [];
  const fetch: BrowserFetch = async (_url, init) => {
    const batch = parseBatch(init); batches.push(batch);
    return response(202, batchResult(batch));
  };
  const commonRuntime = {
    ...baseRuntime(fetch),
    location: { href: 'https://app.example.test/path?allowed=yes&token=secret#private' },
    document: Object.assign(new EventBus(), {
      visibilityState: 'visible',
      referrer: 'https://search.example.test/?q=sensitive#result',
      title: 'A sensitive customer title'
    }),
    navigator: { onLine: true, language: 'en-GB', userAgent: 'Example Desktop' }
  };
  const manual = createBrowserJourneySdk({
    writeKey: PUBLIC_WRITE_KEY, endpoint: 'https://context.example.test', consent: granted,
    runtime: commonRuntime
  });
  await manual.track('manual_context', {}, { eventId: eventId(80) });
  await manual.flush();
  assert.equal(batches[0]?.events[0]?.context?.page, undefined);

  const automatic = createBrowserJourneySdk({
    writeKey: PUBLIC_WRITE_KEY, endpoint: 'https://context.example.test', consent: granted,
    automaticContext: { page: true, locale: true, device: true },
    privacy: { allowUrlQueryParameters: ['allowed'] }, runtime: commonRuntime
  });
  await automatic.track('automatic_context', {}, { eventId: eventId(81) });
  await automatic.flush();
  const context = batches[1]?.events[0]?.context;
  assert.equal(context?.page?.url, 'https://app.example.test/path?allowed=yes');
  assert.equal(context?.page?.referrer, 'https://search.example.test/');
  assert.equal(context?.page?.title, undefined);
  assert.equal(context?.locale, 'en-GB');
  assert.equal(context?.device?.type, 'desktop');
  await manual.destroy();
  await automatic.destroy();
});

test('invalid public configuration and invalid supplied event IDs fail closed without throwing', async () => {
  const invalidKey = createBrowserJourneySdk({
    writeKey: 'sk_server_secret', endpoint: 'https://safe.example.test', consent: granted,
    runtime: baseRuntime(async () => { throw new Error('must not run'); })
  });
  await invalidKey.ready;
  assert.equal(invalidKey.enabled, false);
  assert.equal((await invalidKey.track('ignored')).status, 'disabled');

  const legacyKey = createBrowserJourneySdk({
    writeKey: 'sp_test_legacy', endpoint: 'https://safe.example.test', consent: granted,
    runtime: baseRuntime(async () => { throw new Error('must not run'); })
  });
  await legacyKey.ready;
  assert.equal(legacyKey.enabled, false);

  const mismatchedEnvironment = createBrowserJourneySdk({
    writeKey: PUBLIC_WRITE_KEY, endpoint: 'https://safe.example.test', environment: 'production', consent: granted,
    runtime: baseRuntime(async () => { throw new Error('must not run'); })
  });
  await mismatchedEnvironment.ready;
  assert.equal(mismatchedEnvironment.enabled, false);

  const invalidEndpoint = createBrowserJourneySdk({
    writeKey: PUBLIC_WRITE_KEY, endpoint: 'javascript:alert(1)', consent: granted,
    runtime: baseRuntime(async () => { throw new Error('must not run'); })
  });
  assert.equal((await invalidEndpoint.track('ignored')).status, 'disabled');

  const valid = createBrowserJourneySdk({
    writeKey: PUBLIC_WRITE_KEY, endpoint: 'https://safe.example.test', consent: granted,
    runtime: baseRuntime(async (_url, init) => response(202, batchResult(parseBatch(init))))
  });
  const result = await valid.track('valid_name', {}, { eventId: 'not-a-uuid' });
  assert.deepEqual(result, { status: 'invalid', code: 'PROTOCOL_VALIDATION_FAILED', eventId: 'not-a-uuid' });
  assert.equal(valid.status().queued, 0);
  await invalidKey.destroy();
  await legacyKey.destroy();
  await mismatchedEnvironment.destroy();
  await invalidEndpoint.destroy();
  await valid.destroy();
});

test('request timeout aborts a hung fetch and schedules a bounded retry', async () => {
  let aborts = 0;
  const scheduled: Array<{ callback: () => void; delay: number }> = [];
  const fetch: BrowserFetch = async (_url, init) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => { aborts += 1; reject(new DOMException('aborted', 'AbortError')); });
  });
  const client = createBrowserJourneySdk({
    writeKey: PUBLIC_WRITE_KEY, endpoint: 'https://timeout.example.test', consent: granted,
    requestTimeoutMs: 100, retry: { baseDelayMs: 100, jitterRatio: 0 },
    runtime: {
      ...baseRuntime(fetch),
      createAbortController: () => new AbortController(),
      setTimeout: (callback, delay) => { scheduled.push({ callback, delay }); return scheduled.length; },
      clearTimeout: () => undefined
    }
  });
  await client.track('timeout_event', {}, { eventId: eventId(90) });
  const flushPromise = client.flush();
  await eventually(() => assert.equal(scheduled.some((entry) => entry.delay === 100), true));
  const timeout = scheduled.find((entry) => entry.delay === 100);
  timeout?.callback();
  assert.equal((await flushPromise).status, 'retry_scheduled');
  assert.equal(aborts, 1);
  await client.destroy();
});

test('browser runtime source stays free of Node built-ins, Buffer, console logging, and dynamic code generation', async () => {
  const directory = new URL('../src/', import.meta.url);
  const files = (await readdir(directory)).filter((name) => name.endsWith('.ts'));
  const source = (await Promise.all(files.map((name) => readFile(new URL(name, directory), 'utf8')))).join('\n');
  assert.doesNotMatch(source, /from\s+['"]node:/);
  assert.doesNotMatch(source, /\bBuffer\b/);
  assert.doesNotMatch(source, /\bconsole\s*\./);
  assert.doesNotMatch(source, /\beval\s*\(|new\s+Function\s*\(/);
});
