const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  createGteEmbeddingClient,
  embeddingMetricsSnapshot,
  percentile,
} = require('./gte-embedding-client.cjs');

function normalizedVector(text) {
  const vector = Array(768).fill(0);
  const index = [...String(text)].reduce((sum, value) => sum + value.codePointAt(0), 0) % vector.length;
  vector[index] = 1;
  return vector;
}

class FakeEmbeddingWorker extends EventEmitter {
  constructor(controller = {}) {
    super();
    this.controller = controller;
    this.terminated = false;
  }

  postMessage(message) {
    this.controller.messages ||= [];
    this.controller.messages.push(message);
    if (message.type === 'initialize') {
      setTimeout(() => {
        if (this.terminated) return;
        if (this.controller.failInitialize) {
          this.emit('message', { type: 'worker-error', requestId: message.requestId,
            error: { code: 'GTE_INIT_FAILED', message: 'synthetic init failure', fatal: true, retryable: true } });
        } else {
          this.emit('message', { type: 'ready', requestId: message.requestId, loadMs: 17 });
        }
      }, this.controller.initializeDelayMs || 0);
      return;
    }
    if (message.type === 'embed') {
      this.controller.batches ||= [];
      this.controller.batches.push([...message.texts]);
      setTimeout(() => {
        if (this.terminated) return;
        if (this.controller.failEmbeds > 0) {
          this.controller.failEmbeds -= 1;
          this.emit('message', { type: 'worker-error', requestId: message.requestId,
            error: { code: 'GTE_INFERENCE_FAILED', message: 'synthetic inference failure', fatal: false, retryable: true } });
        } else {
          this.emit('message', { type: 'embedding-result', requestId: message.requestId,
            vectors: message.texts.map(normalizedVector), inferenceMs: this.controller.inferenceMs || 9 });
        }
      }, this.controller.embedDelayMs || 0);
      return;
    }
    if (message.type === 'shutdown') {
      setImmediate(() => this.emit('message', { type: 'shutdown-complete', requestId: message.requestId }));
    }
  }

  terminate() {
    this.terminated = true;
    return Promise.resolve(0);
  }
}

function fakeClient(controller = {}, options = {}) {
  return createGteEmbeddingClient({
    cacheDir: 'D:\\SeemplifyKnowledge\\models\\transformers-test',
    workerFactory: () => new FakeEmbeddingWorker(controller),
    microBatchDelayMs: 2,
    requestTimeoutMs: 1_000,
    workerResponseTimeoutMs: 1_000,
    startupTimeoutMs: 1_000,
    shutdownTimeoutMs: 1_000,
    restartDelayMs: 10,
    circuitCooldownMs: 1_000,
    ...options,
  });
}

test('client rejects traffic until one pinned q8 worker is ready', async () => {
  const controller = {};
  const client = fakeClient(controller);
  await assert.rejects(client.embed(['before start'], { priority: 'query', requestId: 'before' }),
    (error) => error.code === 'GTE_NOT_READY');
  const started = await client.start();
  assert.equal(started.ready, true);
  assert.deepEqual({ dtype: started.profile.dtype, dimension: started.profile.dimension,
    pooling: started.profile.pooling, normalize: started.profile.normalize },
  { dtype: 'q8', dimension: 768, pooling: 'cls', normalize: true });
  assert.equal(controller.messages.filter((message) => message.type === 'initialize').length, 1);
  const output = await client.embed(['alpha', 'beta'], { priority: 'query', requestId: 'ready-request' });
  assert.equal(output.vectors.length, 2);
  assert.equal(output.vectors[0].length, 768);
  assert.equal(output.metrics.priority, 'query');
  const closed = await client.close();
  assert.equal(closed.drained, true);
  assert.equal(closed.status.state, 'stopped');
});

test('single worker micro-batches in query, live-index, shadow, backfill priority order', async () => {
  const controller = {};
  const client = fakeClient(controller, { microBatchDelayMs: 20, maxLogicalConcurrency: 8, maxBatchTexts: 32 });
  await client.start();
  const backfill = client.embed(['backfill'], { priority: 'backfill', requestId: 'backfill' });
  const live = client.embed(['live'], { priority: 'live-index', requestId: 'live' });
  const shadow = client.embed(['shadow'], { priority: 'shadow', requestId: 'shadow' });
  const query = client.embed(['query'], { priority: 'query', requestId: 'query' });
  await Promise.all([backfill, live, shadow, query]);
  assert.deepEqual(controller.batches, [['query', 'live', 'shadow', 'backfill']]);
  const snapshot = client.status();
  assert.equal(snapshot.metrics.completed, 4);
  assert.equal(snapshot.metrics.batches, 1);
  assert.equal(snapshot.metrics.queueWaitMs.samples, 4);
  assert.equal(snapshot.concurrency.configured, 8);
  await client.close();
});

test('bounded queue rejects excess work without exceeding configured logical batch concurrency', async () => {
  const controller = { embedDelayMs: 20 };
  const client = fakeClient(controller, { microBatchDelayMs: 40, maxQueueDepth: 2, maxLogicalConcurrency: 2 });
  await client.start();
  const first = client.embed(['one'], { requestId: 'one' });
  const second = client.embed(['two'], { requestId: 'two' });
  await assert.rejects(client.embed(['three'], { requestId: 'three' }), (error) => error.code === 'GTE_QUEUE_FULL');
  await Promise.all([first, second]);
  assert.equal(controller.batches[0].length, 2);
  assert.equal(client.status().metrics.rejected >= 1, true);
  await client.close();
});

test('request deadlines include queue and inference wait', async () => {
  const controller = { embedDelayMs: 60 };
  const client = fakeClient(controller, { requestTimeoutMs: 20, workerResponseTimeoutMs: 500 });
  await client.start();
  await assert.rejects(client.embed(['slow'], { requestId: 'slow', timeoutMs: 20 }),
    (error) => error.code === 'GTE_REQUEST_TIMEOUT');
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.equal(client.status().metrics.timedOut, 1);
  await client.close();
});

test('repeated inference failures open the circuit and reject new traffic', async () => {
  const controller = { failEmbeds: 2 };
  const client = fakeClient(controller, { circuitFailureThreshold: 2, circuitCooldownMs: 1_000 });
  await client.start();
  await assert.rejects(client.embed(['failure one'], { requestId: 'failure-one' }),
    (error) => error.code === 'GTE_INFERENCE_FAILED');
  assert.equal(client.status().state, 'half-open');
  await assert.rejects(client.embed(['failure two'], { requestId: 'failure-two' }),
    (error) => error.code === 'GTE_INFERENCE_FAILED');
  assert.equal(client.status().circuit.state, 'open');
  await assert.rejects(client.embed(['blocked'], { requestId: 'blocked' }),
    (error) => error.code === 'GTE_CIRCUIT_OPEN');
  await client.close();
});

test('fatal startup failure automatically restarts with a fresh worker', async () => {
  const controllers = [{ failInitialize: true }, {}];
  let created = 0;
  const client = createGteEmbeddingClient({
    cacheDir: 'D:\\SeemplifyKnowledge\\models\\transformers-test',
    workerFactory: () => new FakeEmbeddingWorker(controllers[created++]),
    startupTimeoutMs: 500,
    workerResponseTimeoutMs: 500,
    requestTimeoutMs: 500,
    restartDelayMs: 10,
    circuitCooldownMs: 1_000,
  });
  await assert.rejects(client.start(), (error) => error.code === 'GTE_INIT_FAILED');
  const deadline = Date.now() + 500;
  while (!client.status().ready && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(client.status().ready, true);
  assert.equal(created, 2);
  assert.equal(client.status().metrics.workerRestarts, 1);
  await client.close();
});

test('close stops admission, drains queued inference, and shuts the worker down', async () => {
  const controller = { embedDelayMs: 30 };
  const client = fakeClient(controller, { microBatchDelayMs: 20 });
  await client.start();
  const request = client.embed(['drain me'], { requestId: 'drain' });
  const closing = client.close({ drainTimeoutMs: 500 });
  await assert.rejects(client.embed(['late arrival'], { requestId: 'late' }),
    (error) => error.code === 'GTE_DRAINING');
  const [result, closed] = await Promise.all([request, closing]);
  assert.equal(result.vectors.length, 1);
  assert.equal(closed.drained, true);
  assert.equal(client.status().state, 'stopped');
  assert.equal(controller.messages.some((message) => message.type === 'shutdown'), true);
});

test('metrics helpers calculate stable nearest-rank percentiles and throughput snapshots', () => {
  assert.equal(percentile([40, 10, 30, 20], 0.50), 20);
  assert.equal(percentile([40, 10, 30, 20], 0.95), 40);
  const now = Date.now();
  const metrics = {
    sampleLimit: 10, now: () => now, startedAt: now - 1000, submitted: 2, completed: 2, failed: 0,
    timedOut: 0, rejected: 0, batches: 1, texts: 2, workerFailures: 0, workerRestarts: 0,
    circuitOpens: 0, modelLoads: 1, lastModelLoadMs: 10,
    queueWaitMs: [2, 8], inferenceMs: [12], endToEndMs: [20, 30], completionTimes: [now - 500, now - 70_000],
  };
  const snapshot = embeddingMetricsSnapshot(metrics, now);
  assert.equal(snapshot.queueWaitMs.p95, 8);
  assert.equal(snapshot.throughput.requests1m, 1);
  assert.equal(snapshot.throughput.requests5m, 2);
});
