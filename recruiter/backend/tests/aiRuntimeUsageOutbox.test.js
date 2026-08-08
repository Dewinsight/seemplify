const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  DEAD_LETTER_HEALTH_JOB_ID,
  DEAD_LETTER_JOB_NAME,
  QUEUE_NAME,
  UsageMeteringOutbox,
  assertUsageMeteringOutboxReady,
  resolveRedisConfig,
  usageMeteringOutboxReady
} = require('../services/aiRuntime/usageMeteringOutbox');
const { buildUsageEnvelope } = require('../services/aiRuntime/usageService');

class FakeQueue {
  constructor(name, options) {
    this.name = name;
    this.options = options;
    this.jobs = new Map();
  }

  async getJob(id) {
    return this.jobs.get(id) || null;
  }

  async add(name, data, options) {
    const existing = this.jobs.get(options.jobId);
    if (existing) return existing;
    const job = { id: options.jobId, name, data, options };
    this.jobs.set(options.jobId, job);
    return job;
  }

  async close() {}
}

class FakeWorker {
  constructor(name, processor, options) {
    this.name = name;
    this.processor = processor;
    this.options = options;
    this.listeners = {};
  }

  on(event, listener) {
    this.listeners[event] = listener;
  }

  async close() {}
}

test('health endpoint is registered before the catch-all 404 handler', () => {
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const healthRoute = serverSource.indexOf("app.get('/api/health'");
  const notFoundHandler = serverSource.indexOf('app.use(notFoundHandler)');

  assert.notEqual(healthRoute, -1);
  assert.notEqual(notFoundHandler, -1);
  assert.ok(healthRoute < notFoundHandler);
});

function envelope(fingerprint = 'fingerprint-1') {
  return {
    event: {
      eventId: 'execution-1',
      requestId: 'logical-request',
      provider: 'chatgpt-connect',
      model: 'gpt-5.6-terra',
      status: 'success'
    },
    fingerprint
  };
}

test('Redis URL/auth/TLS/database settings resolve without opening a connection', () => {
  const config = resolveRedisConfig({
    REDIS_URL: 'redis://metering.internal:6380',
    REDIS_USERNAME: 'meter',
    REDIS_PASSWORD: 'secret',
    REDIS_DB: '4',
    REDIS_TLS: 'true',
    REDIS_TLS_REJECT_UNAUTHORIZED: 'false'
  });

  assert.equal(config.enabled, true);
  assert.equal(config.url, 'redis://metering.internal:6380');
  assert.equal(config.username, 'meter');
  assert.equal(config.password, 'secret');
  assert.equal(config.database, 4);
  assert.equal(config.tls, true);
  assert.equal(config.tlsRejectUnauthorized, false);
});

test('production defaults to the shared Dokploy Redis and rejects malformed overrides', () => {
  const config = resolveRedisConfig({ NODE_ENV: 'production' });
  assert.equal(config.enabled, true);
  assert.equal(config.url, 'redis://dokploy-redis:6379/0');
  assert.equal(config.database, 0);

  assert.throws(
    () => resolveRedisConfig({
      NODE_ENV: 'production',
      AI_USAGE_REDIS_PORT: 'not-a-port'
    }),
    (error) => error.code === 'AI_USAGE_REDIS_CONFIG_INVALID'
  );
  assert.throws(
    () => resolveRedisConfig({
      NODE_ENV: 'production',
      AI_USAGE_REDIS_URL: 'http://not-redis.example'
    }),
    (error) => error.code === 'AI_USAGE_REDIS_CONFIG_INVALID'
  );
});

test('production readiness requires the outbox to be configured, started, and healthy', () => {
  const production = { NODE_ENV: 'production' };
  assert.equal(usageMeteringOutboxReady({
    configured: true,
    started: true,
    healthy: true
  }, production), true);
  for (const status of [
    { configured: false, started: false, healthy: true },
    { configured: true, started: false, healthy: true },
    { configured: true, started: true, healthy: false }
  ]) {
    assert.equal(usageMeteringOutboxReady(status, production), false);
    assert.throws(
      () => assertUsageMeteringOutboxReady(status, production),
      (error) => error.code === 'AI_USAGE_OUTBOX_NOT_READY'
    );
  }
});

test('worker startup waits for Redis readiness and exposes startup failures as unhealthy', async () => {
  class UnreadyQueue extends FakeQueue {
    async waitUntilReady() {
      throw new Error('synthetic Redis readiness failure');
    }
  }
  const outbox = new UsageMeteringOutbox({
    env: {
      NODE_ENV: 'production',
      AI_USAGE_OUTBOX_ENABLED: 'true'
    },
    QueueClass: UnreadyQueue,
    WorkerClass: FakeWorker,
    connectionFactory: () => ({ quit: async () => {} })
  });

  await assert.rejects(
    () => outbox.start(async () => ({ persisted: true })),
    /synthetic Redis readiness failure/
  );
  assert.deepEqual(outbox.status(), {
    configured: true,
    started: false,
    healthy: false,
    lastError: {
      message: 'synthetic Redis readiness failure',
      at: outbox.status().lastError.at
    },
    lastTerminalFailure: null,
    deadLetterCount: 0
  });
  await outbox.close();
});

test('outbox is lazy, uses bounded completion retention, and replays idempotently', async () => {
  let connections = 0;
  const outbox = new UsageMeteringOutbox({
    env: {
      REDIS_URL: 'redis://metering.internal:6379/2',
      AI_USAGE_OUTBOX_RETRY_DELAY_MS: '250'
    },
    QueueClass: FakeQueue,
    WorkerClass: FakeWorker,
    connectionFactory: () => {
      connections += 1;
      return { quit: async () => {} };
    }
  });

  assert.equal(outbox.status().configured, true);
  assert.equal(connections, 0);

  const first = await outbox.enqueue(envelope());
  const duplicate = await outbox.enqueue(envelope());
  assert.equal(first.jobId, duplicate.jobId);
  assert.equal(duplicate.duplicate, true);
  assert.equal(connections, 1);
  assert.equal(outbox.queue.name, QUEUE_NAME);
  assert.equal(outbox.queue.options.defaultJobOptions.attempts, 2_147_483_647);
  assert.equal(outbox.queue.options.defaultJobOptions.backoff.type, 'fixed');
  assert.equal(outbox.queue.options.defaultJobOptions.backoff.delay, 250);
  assert.deepEqual(outbox.queue.options.defaultJobOptions.removeOnComplete, {
    age: 7 * 24 * 60 * 60,
    count: 100_000
  });

  const replayed = [];
  await outbox.start(async (data) => replayed.push(data));
  assert.equal(connections, 2);
  await outbox.worker.processor({ data: envelope() });
  assert.deepEqual(replayed, [envelope()]);
  await outbox.close();
});

test('queued reuse with changed payload is an identity conflict', async () => {
  const outbox = new UsageMeteringOutbox({
    env: { REDIS_HOST: 'metering.internal' },
    QueueClass: FakeQueue,
    WorkerClass: FakeWorker,
    connectionFactory: () => ({ quit: async () => {} })
  });
  await outbox.enqueue(envelope('first'));
  await assert.rejects(
    () => outbox.enqueue(envelope('changed')),
    (error) => error.code === 'AI_USAGE_IDENTITY_CONFLICT'
  );
  await outbox.close();
});

test('terminal poison messages become bounded non-PII dead letters and make health unhealthy', async () => {
  const poisoned = buildUsageEnvelope({
    eventId: 'execution-1',
    requestId: 'logical-request',
    sourceApp: 'recruiter',
    activity: 'candidate.cv_parse',
    provider: 'chatgpt-connect',
    model: 'gpt-5.6-terra',
    status: 'success',
    actorEmail: 'person@example.test',
    usage: {
      input_tokens: 8,
      input_tokens_details: { cached_tokens: 3 },
      output_tokens: 5,
      output_tokens_details: { reasoning_tokens: 2 },
      total_tokens: 13
    }
  });
  poisoned.fingerprint = 'fingerprint-1';
  poisoned.event.actorEmail = 'person@example.test';
  assert.equal(Object.hasOwn(poisoned.event, 'usage'), false);
  const outbox = new UsageMeteringOutbox({
    env: { REDIS_HOST: 'metering.internal' },
    QueueClass: FakeQueue,
    WorkerClass: FakeWorker,
    connectionFactory: () => ({ quit: async () => {} })
  });
  await outbox.start(async () => {
    const error = new Error('person@example.test conflicted with a stored event');
    error.code = 'AI_USAGE_IDENTITY_CONFLICT';
    throw error;
  });

  const result = await outbox.worker.processor({
    name: 'persist-usage',
    data: poisoned
  });
  assert.equal(result.deadLetter, true);
  const markerJob = [...outbox.queue.jobs.values()]
    .find((job) => job.name === DEAD_LETTER_JOB_NAME);
  assert.ok(markerJob);
  assert.equal(markerJob.options.attempts, 1);
  assert.deepEqual(markerJob.options.removeOnComplete, {
    age: 30 * 24 * 60 * 60,
    count: 25_000
  });
  assert.equal(markerJob.data.reasonCode, 'AI_USAGE_IDENTITY_CONFLICT');
  assert.deepEqual(markerJob.data.usage, {
    inputTokens: 8,
    cachedInputTokens: 3,
    outputTokens: 5,
    reasoningTokens: 2,
    totalTokens: 13
  });
  assert.equal(JSON.stringify(markerJob.data).includes('person@example.test'), false);
  assert.equal(outbox.status().healthy, false);
  assert.equal(outbox.status().deadLetterCount, 1);
  await outbox.close();
});

test('durable dead-letter health is rehydrated after a worker restart', async () => {
  const persistedJobs = new Map();
  class RestartQueue extends FakeQueue {
    constructor(name, options) {
      super(name, options);
      this.jobs = persistedJobs;
    }
  }
  const options = {
    env: { REDIS_HOST: 'metering.internal' },
    QueueClass: RestartQueue,
    WorkerClass: FakeWorker,
    connectionFactory: () => ({ quit: async () => {} })
  };
  const first = new UsageMeteringOutbox(options);
  await first.start(async () => {
    const error = new Error('terminal conflict');
    error.code = 'AI_USAGE_IDENTITY_CONFLICT';
    throw error;
  });
  await first.worker.processor({ name: 'persist-usage', data: envelope() });
  assert.ok(persistedJobs.has(DEAD_LETTER_HEALTH_JOB_ID));
  await first.close();

  const restarted = new UsageMeteringOutbox(options);
  await restarted.start(async () => ({ persisted: true }));
  assert.equal(restarted.status().healthy, false);
  assert.equal(restarted.status().deadLetterCount, 1);
  assert.equal(
    restarted.status().lastTerminalFailure.reasonCode,
    'AI_USAGE_IDENTITY_CONFLICT'
  );
  await restarted.close();
});
