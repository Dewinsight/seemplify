const crypto = require('node:crypto');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const {
  EMBEDDING_PROFILES,
  embeddingConfigurationFromEnv,
  validateEmbeddingProfile,
  validateEmbeddingVectors,
  vectorNorm,
} = require('./embedding-profiles.cjs');

const PRIORITIES = Object.freeze({ query: 0, 'live-index': 1, shadow: 2, backfill: 3 });
const PRIORITY_NAMES = Object.freeze(Object.fromEntries(Object.entries(PRIORITIES).map(([name, value]) => [value, name])));

function clientError(message, { code = 'GTE_EMBEDDING_ERROR', retryable = false, fatal = false } = {}) {
  return Object.assign(new Error(message), { code, retryable, fatal });
}

function percentile(values, fraction) {
  if (!Array.isArray(values) || !values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

function createEmbeddingMetrics({ sampleLimit = 2048, now = Date.now } = {}) {
  return {
    sampleLimit,
    now,
    startedAt: now(),
    submitted: 0,
    completed: 0,
    failed: 0,
    timedOut: 0,
    rejected: 0,
    batches: 0,
    texts: 0,
    workerFailures: 0,
    workerRestarts: 0,
    circuitOpens: 0,
    modelLoads: 0,
    lastModelLoadMs: null,
    queueWaitMs: [],
    inferenceMs: [],
    endToEndMs: [],
    completionTimes: [],
  };
}

function recordMetricSample(metrics, name, value) {
  if (!Number.isFinite(Number(value))) return;
  const samples = metrics[name];
  if (!Array.isArray(samples)) throw new Error(`Unknown embedding metric '${name}'.`);
  samples.push(Number(value));
  if (samples.length > metrics.sampleLimit) samples.splice(0, samples.length - metrics.sampleLimit);
}

function histogramSnapshot(values) {
  return {
    samples: values.length,
    p50: percentile(values, 0.50),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
    max: values.length ? Math.max(...values) : null,
  };
}

function embeddingMetricsSnapshot(metrics, currentTime = metrics.now()) {
  const fiveMinutesAgo = currentTime - (5 * 60_000);
  const oneMinuteAgo = currentTime - 60_000;
  metrics.completionTimes = metrics.completionTimes.filter((value) => value >= fiveMinutesAgo);
  return {
    since: new Date(metrics.startedAt).toISOString(),
    submitted: metrics.submitted,
    completed: metrics.completed,
    failed: metrics.failed,
    timedOut: metrics.timedOut,
    rejected: metrics.rejected,
    batches: metrics.batches,
    texts: metrics.texts,
    workerFailures: metrics.workerFailures,
    workerRestarts: metrics.workerRestarts,
    circuitOpens: metrics.circuitOpens,
    modelLoads: metrics.modelLoads,
    lastModelLoadMs: metrics.lastModelLoadMs,
    throughput: {
      requests1m: metrics.completionTimes.filter((value) => value >= oneMinuteAgo).length,
      requests5m: metrics.completionTimes.length,
    },
    queueWaitMs: histogramSnapshot(metrics.queueWaitMs),
    inferenceMs: histogramSnapshot(metrics.inferenceMs),
    endToEndMs: histogramSnapshot(metrics.endToEndMs),
  };
}

function integerOption(value, fallback, name, minimum, maximum) {
  const candidate = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(candidate) || candidate < minimum || candidate > maximum) {
    throw clientError(`${name} must be an integer between ${minimum} and ${maximum}.`, {
      code: 'GTE_CONFIGURATION_INVALID',
    });
  }
  return candidate;
}

function normalizePriority(value = 'live-index') {
  const normalized = String(value || 'live-index').trim().toLowerCase().replaceAll('_', '-');
  const aliases = { interactive: 'query', index: 'live-index', ingestion: 'live-index', migration: 'backfill' };
  const name = aliases[normalized] || normalized;
  if (!Object.hasOwn(PRIORITIES, name)) {
    throw clientError(`Unsupported embedding priority '${normalized}'.`, { code: 'GTE_PRIORITY_INVALID' });
  }
  return { name, rank: PRIORITIES[name] };
}

function errorFromWorker(payload = {}) {
  return clientError(String(payload.message || 'The GTE worker failed.'), {
    code: String(payload.code || 'GTE_WORKER_ERROR'),
    retryable: payload.retryable === true,
    fatal: payload.fatal === true,
  });
}

function createGteEmbeddingClient(options = {}) {
  const profile = validateEmbeddingProfile(options.profile || EMBEDDING_PROFILES['gte-node']);
  if (profile.id !== 'gte-node') {
    throw clientError('createGteEmbeddingClient only accepts the pinned gte-node profile.', {
      code: 'GTE_CONFIGURATION_INVALID',
    });
  }
  const environment = options.environment || process.env;
  const environmentConfig = embeddingConfigurationFromEnv({
    ...environment,
    EXPERIENCE_EMBEDDING_PROVIDER: 'gte-node',
    EXPERIENCE_EMBEDDING_MODEL: profile.modelId,
    EXPERIENCE_EMBEDDING_MODEL_REVISION: profile.revision,
    EXPERIENCE_EMBEDDING_DTYPE: profile.dtype,
    EXPERIENCE_EMBEDDING_DIMENSIONS: String(profile.dimension),
    EXPERIENCE_VECTOR_INDEX_VERSION: profile.vectorIndexVersion,
  });
  const cacheDir = path.resolve(options.cacheDir || environmentConfig.cacheDir);
  const maxLogicalConcurrency = integerOption(options.maxLogicalConcurrency, environmentConfig.concurrency,
    'maxLogicalConcurrency', 1, 8);
  const maxQueueDepth = integerOption(options.maxQueueDepth, environmentConfig.queueDepth,
    'maxQueueDepth', 1, 4096);
  const maxBatchTexts = integerOption(options.maxBatchTexts, environmentConfig.maxBatchTexts,
    'maxBatchTexts', 1, 128);
  const maxTextsPerRequest = integerOption(options.maxTextsPerRequest, Math.min(32, maxBatchTexts),
    'maxTextsPerRequest', 1, maxBatchTexts);
  const maxTextCharacters = integerOption(options.maxTextCharacters, 40_000,
    'maxTextCharacters', 1, 200_000);
  const requestTimeoutMs = integerOption(options.requestTimeoutMs, environmentConfig.requestTimeoutMs,
    'requestTimeoutMs', 10, 30 * 60_000);
  const workerResponseTimeoutMs = integerOption(options.workerResponseTimeoutMs, Math.max(requestTimeoutMs, 180_000),
    'workerResponseTimeoutMs', 10, 30 * 60_000);
  const startupTimeoutMs = integerOption(options.startupTimeoutMs, 20 * 60_000,
    'startupTimeoutMs', 10, 30 * 60_000);
  const shutdownTimeoutMs = integerOption(options.shutdownTimeoutMs, 10_000,
    'shutdownTimeoutMs', 10, 60_000);
  const microBatchDelayMs = integerOption(options.microBatchDelayMs, 3,
    'microBatchDelayMs', 0, 1_000);
  const circuitFailureThreshold = integerOption(options.circuitFailureThreshold, 3,
    'circuitFailureThreshold', 1, 100);
  const circuitCooldownMs = integerOption(options.circuitCooldownMs, 30_000,
    'circuitCooldownMs', 10, 30 * 60_000);
  const restartDelayMs = integerOption(options.restartDelayMs, 250,
    'restartDelayMs', 0, 60_000);
  const now = options.now || Date.now;
  const workerFactory = options.workerFactory || (() => new Worker(path.join(__dirname, 'gte-embedding-worker.mjs'), {
    type: 'module',
  }));
  const metrics = options.metrics || createEmbeddingMetrics({ sampleLimit: options.metricSampleLimit || 2048, now });

  let state = 'stopped';
  let accepting = false;
  let worker = null;
  let workerReady = false;
  let workerGeneration = 0;
  let startPromise = null;
  let closePromise = null;
  let dispatchTimer = null;
  let restartTimer = null;
  let activeBatch = null;
  let sequence = 0;
  let pending = [];
  let permanentlyClosed = false;
  let draining = false;
  const requests = new Map();
  const inFlightMessages = new Map();
  const drainWaiters = new Set();
  const intentionallyStoppedWorkers = new WeakSet();
  const failedGenerations = new Set();
  const circuit = {
    state: 'closed',
    consecutiveFailures: 0,
    openedAt: null,
    retryAt: null,
    lastError: null,
  };

  function safeTerminate(target = worker) {
    if (!target) return Promise.resolve();
    intentionallyStoppedWorkers.add(target);
    if (target === worker) {
      worker = null;
      workerReady = false;
    }
    try { return Promise.resolve(target.terminate()).catch(() => undefined); } catch { return Promise.resolve(); }
  }

  function rejectMessageRequests(error) {
    for (const entry of inFlightMessages.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    inFlightMessages.clear();
  }

  function sendWorkerMessage(message, timeoutMs) {
    const target = worker;
    if (!target) return Promise.reject(clientError('The GTE worker is unavailable.', {
      code: 'GTE_WORKER_UNAVAILABLE', retryable: true, fatal: true,
    }));
    const requestId = message.requestId || crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        inFlightMessages.delete(requestId);
        reject(clientError(`The GTE worker did not answer within ${timeoutMs} ms.`, {
          code: 'GTE_WORKER_TIMEOUT', retryable: true, fatal: true,
        }));
      }, timeoutMs);
      inFlightMessages.set(requestId, { resolve, reject, timer });
      try { target.postMessage({ ...message, requestId }); } catch (error) {
        clearTimeout(timer);
        inFlightMessages.delete(requestId);
        reject(clientError(`Could not contact the GTE worker: ${error.message}`, {
          code: 'GTE_WORKER_UNAVAILABLE', retryable: true, fatal: true,
        }));
      }
    });
  }

  function onWorkerMessage(message) {
    const entry = inFlightMessages.get(String(message?.requestId || ''));
    if (!entry) return;
    clearTimeout(entry.timer);
    inFlightMessages.delete(String(message.requestId));
    if (message.type === 'worker-error') entry.reject(errorFromWorker(message.error));
    else entry.resolve(message);
  }

  function notifyDrain() {
    if (pending.length || activeBatch) return;
    for (const resolve of drainWaiters) resolve(true);
    drainWaiters.clear();
  }

  function settleFailure(job, error, { timedOut = false, rejected = false } = {}) {
    if (job.settled) return;
    job.settled = true;
    clearTimeout(job.timeoutTimer);
    requests.delete(job.requestId);
    pending = pending.filter((candidate) => candidate !== job);
    if (timedOut) metrics.timedOut += 1;
    else if (rejected) metrics.rejected += 1;
    else metrics.failed += 1;
    job.reject(error);
    notifyDrain();
  }

  function settleSuccess(job, value) {
    if (job.settled) return;
    job.settled = true;
    clearTimeout(job.timeoutTimer);
    requests.delete(job.requestId);
    metrics.completed += 1;
    metrics.completionTimes.push(now());
    recordMetricSample(metrics, 'endToEndMs', now() - job.submittedAt);
    job.resolve(value);
    notifyDrain();
  }

  function rejectPending(error) {
    const queued = [...pending];
    pending = [];
    for (const job of queued) settleFailure(job, error);
  }

  function scheduleRestart(delayMs) {
    if (permanentlyClosed || restartTimer) return;
    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (permanentlyClosed) return;
      if (circuit.state === 'open') circuit.state = 'half-open';
      metrics.workerRestarts += 1;
      void start({ automatic: true }).catch(() => undefined);
    }, delayMs);
    restartTimer.unref?.();
  }

  function recordWorkerFailure(error, { fatal = false, generation = workerGeneration } = {}) {
    if (failedGenerations.has(generation) && fatal) return;
    if (fatal) failedGenerations.add(generation);
    metrics.workerFailures += 1;
    circuit.consecutiveFailures += 1;
    circuit.lastError = { code: error.code || 'GTE_WORKER_ERROR', message: String(error.message || error).slice(0, 500), at: new Date(now()).toISOString() };
    if (circuit.consecutiveFailures >= circuitFailureThreshold) {
      workerReady = false;
      accepting = false;
      circuit.state = 'open';
      circuit.openedAt = now();
      circuit.retryAt = now() + circuitCooldownMs;
      state = 'circuit-open';
      metrics.circuitOpens += 1;
      rejectPending(clientError('The GTE embedding circuit is open while the model recovers.', {
        code: 'GTE_CIRCUIT_OPEN', retryable: true,
      }));
      void safeTerminate();
      scheduleRestart(circuitCooldownMs);
      return;
    }
    if (!fatal && workerReady) {
      circuit.state = 'half-open';
      state = draining ? 'draining' : 'half-open';
      accepting = !permanentlyClosed && !draining;
      return;
    }
    workerReady = false;
    accepting = false;
    state = draining ? 'draining' : 'restarting';
    if (fatal) void safeTerminate();
    scheduleRestart(restartDelayMs);
  }

  function onUnexpectedWorkerFailure(target, generation, cause) {
    if (target !== worker || intentionallyStoppedWorkers.has(target) || permanentlyClosed) return;
    const error = clientError(`The GTE worker stopped unexpectedly: ${cause?.message || cause || 'unknown failure'}`, {
      code: 'GTE_WORKER_EXITED', retryable: true, fatal: true,
    });
    error.workerFailureRecorded = true;
    rejectMessageRequests(error);
    recordWorkerFailure(error, { fatal: true, generation });
  }

  async function spawnAndInitialize() {
    workerGeneration += 1;
    const generation = workerGeneration;
    const target = workerFactory({ profile, cacheDir });
    if (!target || typeof target.postMessage !== 'function' || typeof target.on !== 'function') {
      throw clientError('workerFactory did not return a Worker-compatible object.', { code: 'GTE_WORKER_FACTORY_INVALID' });
    }
    worker = target;
    target.on('message', onWorkerMessage);
    target.on('error', (error) => onUnexpectedWorkerFailure(target, generation, error));
    target.on('exit', (code) => {
      if (code !== 0 || !intentionallyStoppedWorkers.has(target)) {
        onUnexpectedWorkerFailure(target, generation, `exit code ${code}`);
      }
    });
    const result = await sendWorkerMessage({ type: 'initialize', profile, cacheDir }, startupTimeoutMs);
    if (target !== worker) throw clientError('The initialized GTE worker was replaced.', {
      code: 'GTE_WORKER_REPLACED', retryable: true, fatal: true,
    });
    workerReady = true;
    state = draining ? 'draining' : circuit.consecutiveFailures ? 'half-open' : 'ready';
    circuit.state = circuit.consecutiveFailures ? 'half-open' : 'closed';
    accepting = !permanentlyClosed && !draining;
    metrics.modelLoads += 1;
    metrics.lastModelLoadMs = Number(result.loadMs) || 0;
    scheduleDispatch();
    return status();
  }

  async function start({ automatic = false } = {}) {
    if (permanentlyClosed) throw clientError('The GTE embedding client is closed.', { code: 'GTE_CLIENT_CLOSED' });
    if (draining && !automatic) throw clientError('The GTE embedding client is draining.', {
      code: 'GTE_DRAINING', retryable: true,
    });
    if (workerReady) return status();
    if (startPromise) return startPromise;
    if (!automatic && circuit.state === 'open' && Number(circuit.retryAt || 0) > now()) {
      throw clientError('The GTE embedding circuit is open.', { code: 'GTE_CIRCUIT_OPEN', retryable: true });
    }
    state = automatic ? 'restarting' : 'starting';
    accepting = false;
    startPromise = spawnAndInitialize().catch((error) => {
      if (!error.workerFailureRecorded) recordWorkerFailure(error, { fatal: true });
      throw error;
    }).finally(() => { startPromise = null; });
    return startPromise;
  }

  function scheduleDispatch() {
    if (dispatchTimer || activeBatch || !workerReady || permanentlyClosed || !pending.length) return;
    dispatchTimer = setTimeout(() => {
      dispatchTimer = null;
      void dispatch();
    }, microBatchDelayMs);
  }

  function chooseBatch() {
    const candidates = pending.filter((job) => !job.settled)
      .sort((left, right) => left.priorityRank - right.priorityRank || left.sequence - right.sequence);
    const selected = [];
    let textCount = 0;
    for (const job of candidates) {
      if (selected.length >= maxLogicalConcurrency) break;
      if (textCount + job.texts.length > maxBatchTexts) continue;
      selected.push(job);
      textCount += job.texts.length;
    }
    if (!selected.length && candidates.length) selected.push(candidates[0]);
    const selectedSet = new Set(selected);
    pending = pending.filter((job) => !selectedSet.has(job));
    return selected;
  }

  async function dispatch() {
    if (activeBatch || !workerReady || permanentlyClosed) return;
    const jobs = chooseBatch();
    if (!jobs.length) { notifyDrain(); return; }
    const startedAt = now();
    const texts = jobs.flatMap((job) => job.texts);
    for (const job of jobs) {
      job.queueWaitMs = Math.max(0, startedAt - job.submittedAt);
      recordMetricSample(metrics, 'queueWaitMs', job.queueWaitMs);
    }
    const batch = { id: crypto.randomUUID(), jobs, texts, startedAt, generation: workerGeneration };
    activeBatch = batch;
    metrics.batches += 1;
    metrics.texts += texts.length;
    try {
      const result = await sendWorkerMessage({ type: 'embed', texts }, workerResponseTimeoutMs);
      const vectors = validateEmbeddingVectors(result.vectors, {
        expectedCount: texts.length,
        dimension: profile.dimension,
        normalized: true,
      });
      const inferenceMs = Number(result.inferenceMs);
      recordMetricSample(metrics, 'inferenceMs', Number.isFinite(inferenceMs) ? inferenceMs : now() - startedAt);
      let offset = 0;
      for (const job of jobs) {
        const jobVectors = vectors.slice(offset, offset + job.texts.length);
        offset += job.texts.length;
        settleSuccess(job, {
          vectors: jobVectors,
          profile,
          metrics: {
            requestId: job.requestId,
            priority: job.priority,
            queueWaitMs: job.queueWaitMs,
            inferenceMs: Number.isFinite(inferenceMs) ? inferenceMs : now() - startedAt,
            batchLogicalRequests: jobs.length,
            batchTexts: texts.length,
          },
        });
      }
      circuit.consecutiveFailures = 0;
      circuit.state = 'closed';
      circuit.openedAt = null;
      circuit.retryAt = null;
      if (!permanentlyClosed && !draining) {
        state = 'ready';
        accepting = true;
      }
    } catch (error) {
      for (const job of jobs) settleFailure(job, error);
      if (!error.workerFailureRecorded) recordWorkerFailure(error, { fatal: error.fatal === true, generation: batch.generation });
    } finally {
      if (activeBatch === batch) activeBatch = null;
      notifyDrain();
      scheduleDispatch();
    }
  }

  function embed(texts, { priority = 'live-index', requestId = crypto.randomUUID(), timeoutMs = requestTimeoutMs } = {}) {
    if (!workerReady || !accepting) {
      metrics.rejected += 1;
      const code = permanentlyClosed ? 'GTE_CLIENT_CLOSED'
        : state === 'circuit-open' ? 'GTE_CIRCUIT_OPEN'
          : draining ? 'GTE_DRAINING' : 'GTE_NOT_READY';
      return Promise.reject(clientError('The GTE embedding worker is not ready to accept traffic.', {
        code, retryable: !permanentlyClosed,
      }));
    }
    if (!Array.isArray(texts) || !texts.length || texts.length > maxTextsPerRequest) {
      metrics.rejected += 1;
      return Promise.reject(clientError(`Embedding requests must contain 1 to ${maxTextsPerRequest} texts.`, {
        code: 'GTE_INPUT_INVALID',
      }));
    }
    const normalizedTexts = texts.map((text) => String(text ?? '').trim());
    if (normalizedTexts.some((text) => !text || text.length > maxTextCharacters)) {
      metrics.rejected += 1;
      return Promise.reject(clientError(`Each embedding text must contain 1 to ${maxTextCharacters} characters.`, {
        code: 'GTE_INPUT_INVALID',
      }));
    }
    const normalizedRequestId = String(requestId || '').trim();
    if (!normalizedRequestId || normalizedRequestId.length > 200 || requests.has(normalizedRequestId)) {
      metrics.rejected += 1;
      return Promise.reject(clientError('Embedding requestId is missing, too long, or already active.', {
        code: 'GTE_REQUEST_ID_INVALID',
      }));
    }
    if (pending.length >= maxQueueDepth) {
      metrics.rejected += 1;
      return Promise.reject(clientError('The bounded GTE embedding queue is full.', {
        code: 'GTE_QUEUE_FULL', retryable: true,
      }));
    }
    const requestTimeout = integerOption(timeoutMs, requestTimeoutMs, 'timeoutMs', 10, 30 * 60_000);
    let priorityValue;
    try { priorityValue = normalizePriority(priority); } catch (error) {
      metrics.rejected += 1;
      return Promise.reject(error);
    }
    metrics.submitted += 1;
    return new Promise((resolve, reject) => {
      const job = {
        requestId: normalizedRequestId,
        texts: normalizedTexts,
        priority: priorityValue.name,
        priorityRank: priorityValue.rank,
        sequence: sequence += 1,
        submittedAt: now(),
        settled: false,
        resolve,
        reject,
        timeoutTimer: null,
      };
      job.timeoutTimer = setTimeout(() => settleFailure(job, clientError(
        `Embedding request '${job.requestId}' timed out after ${requestTimeout} ms.`, {
          code: 'GTE_REQUEST_TIMEOUT', retryable: true,
        }), { timedOut: true }), requestTimeout);
      requests.set(job.requestId, job);
      pending.push(job);
      scheduleDispatch();
    });
  }

  function status() {
    const activeJobs = activeBatch?.jobs.filter((job) => !job.settled) || [];
    return {
      state,
      ready: workerReady && circuit.state !== 'open',
      accepting,
      profile,
      cacheDir,
      worker: {
        generation: workerGeneration,
        loaded: workerReady,
        modelLoads: metrics.modelLoads,
        lastModelLoadMs: metrics.lastModelLoadMs,
      },
      concurrency: {
        configured: maxLogicalConcurrency,
        activeLogicalRequests: activeJobs.length,
        activeTexts: activeBatch?.texts.length || 0,
        maxBatchTexts,
      },
      queue: {
        waiting: pending.filter((job) => !job.settled).length,
        capacity: maxQueueDepth,
        oldestWaitMs: pending.length ? Math.max(...pending.filter((job) => !job.settled).map((job) => now() - job.submittedAt), 0) : 0,
        byPriority: Object.fromEntries(Object.keys(PRIORITIES).map((name) => [name,
          pending.filter((job) => !job.settled && job.priority === name).length])),
      },
      circuit: { ...circuit },
      metrics: embeddingMetricsSnapshot(metrics, now()),
    };
  }

  function waitForDrain(timeoutMs) {
    if (!pending.length && !activeBatch) return Promise.resolve(true);
    return new Promise((resolve) => {
      const finish = (value) => {
        clearTimeout(timer);
        drainWaiters.delete(onDrained);
        resolve(value);
      };
      const onDrained = () => finish(true);
      const timer = setTimeout(() => finish(false), timeoutMs);
      drainWaiters.add(onDrained);
    });
  }

  async function close({ drainTimeoutMs = 30_000 } = {}) {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      accepting = false;
      draining = true;
      state = 'draining';
      if (dispatchTimer) { clearTimeout(dispatchTimer); dispatchTimer = null; }
      if (pending.length && workerReady && !activeBatch) void dispatch();
      const drained = await waitForDrain(integerOption(drainTimeoutMs, 30_000, 'drainTimeoutMs', 0, 30 * 60_000));
      permanentlyClosed = true;
      if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
      if (!drained) {
        const error = clientError('The GTE embedding client did not drain before shutdown.', {
          code: 'GTE_DRAIN_TIMEOUT', retryable: true,
        });
        rejectPending(error);
        for (const job of activeBatch?.jobs || []) settleFailure(job, error);
      }
      const target = worker;
      if (target && workerReady && drained) {
        intentionallyStoppedWorkers.add(target);
        try { await sendWorkerMessage({ type: 'shutdown' }, shutdownTimeoutMs); } catch { /* termination below is authoritative */ }
      }
      rejectMessageRequests(clientError('The GTE embedding client is closed.', { code: 'GTE_CLIENT_CLOSED' }));
      await safeTerminate(target);
      workerReady = false;
      accepting = false;
      draining = false;
      state = 'stopped';
      notifyDrain();
      return { drained, status: status() };
    })();
    return closePromise;
  }

  return Object.freeze({ start, embed, status, close });
}

module.exports = {
  PRIORITIES,
  PRIORITY_NAMES,
  createEmbeddingMetrics,
  createGteEmbeddingClient,
  embeddingMetricsSnapshot,
  histogramSnapshot,
  normalizePriority,
  percentile,
  recordMetricSample,
  validateEmbeddingVectors,
  vectorNorm,
};
