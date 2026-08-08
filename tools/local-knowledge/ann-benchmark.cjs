const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { CONFIG } = require('./config.cjs');
const {
  BENCHMARK_CLEANUP_CONFIRMATION,
  chunkText,
  createKnowledgeRuntime,
} = require('./runtime.cjs');

const MINIMUM_CHUNKS = 120;
const CONCURRENCY_LEVELS = Object.freeze([1, 2, 4, 8]);
const EMPTY_GRAPH = Object.freeze({ entities: [], claims: [], relations: [], windows: 0 });

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
}

function sha256(filename) {
  return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

function serializeError(error) {
  return {
    name: error?.name || 'Error',
    code: error?.code || null,
    status: Number(error?.status) || null,
    retryable: error?.retryable === true,
    message: String(error?.message || error).slice(0, 1_000),
  };
}

function syntheticSection(index) {
  const padded = String(index).padStart(3, '0');
  const anchor = `ann-anchor-${padded}`;
  const product = ['atlas', 'beacon', 'cobalt', 'delta', 'ember', 'fjord', 'grove', 'harbor'][index % 8];
  const region = ['lagos', 'london', 'nairobi', 'toronto', 'berlin', 'accra', 'lisbon'][index % 7];
  const metric = 1_000 + (index * 37);
  const seed = `Record ${padded} contains ${anchor}. The ${product} programme in ${region} has a verified benchmark value of ${metric}.`;
  const vocabulary = [
    'capacity', 'workflow', 'evidence', 'customer', 'research', 'quality', 'delivery', 'planning',
    'operations', 'measurement', 'governance', 'retention', 'service', 'analysis', 'feedback', 'outcome',
  ];
  const words = [];
  while (words.join(' ').length < 2_900) {
    const position = words.length;
    words.push(`${vocabulary[(index * 11 + position * 7) % vocabulary.length]}${(index + position) % 97}`);
  }
  return `## Synthetic vector record ${padded}\n\n${seed} ${words.join(' ')}\n`;
}

function generateSyntheticCorpus({ sectionCount = 140, config = CONFIG } = {}) {
  const sections = Array.from({ length: sectionCount }, (_, index) => syntheticSection(index));
  const text = sections.join('\n');
  const chunks = chunkText(text, config);
  return { text, chunkCount: chunks.length, sectionCount };
}

function benchmarkQueries(sectionCount = 140) {
  const positions = [3, 17, 41, 63, 89, 111, 127, sectionCount - 1]
    .filter((value, index, values) => value >= 0 && value < sectionCount && values.indexOf(value) === index);
  return positions.map((index) => ({
    id: `query-${String(index).padStart(3, '0')}`,
    query: `What verified benchmark value is recorded for ann-anchor-${String(index).padStart(3, '0')}?`,
    expectedAnchor: `ann-anchor-${String(index).padStart(3, '0')}`,
  }));
}

function createAnnBenchmarkRuntime(options = {}) {
  return createKnowledgeRuntime({
    ...options,
    extractGraph: async () => EMPTY_GRAPH,
  });
}

function observeQueue(snapshot, observation) {
  observation.maxActive = Math.max(observation.maxActive, Number(snapshot.active?.retrieve || 0));
  observation.maxWaiting = Math.max(observation.maxWaiting, Number(snapshot.waiting || 0));
}

async function retrieveOnce(runtime, context, item, ordinal) {
  const started = performance.now();
  const output = await runtime.retrieve({
    requestId: `ann_retrieve_${context.runToken}_${ordinal}_${crypto.randomBytes(5).toString('hex')}`,
    spaceId: context.spaceId,
    knowledgeBases: [{ id: context.knowledgeBaseId, indexVersion: context.indexVersion }],
    query: item.query,
    topK: 8,
    graphDepth: 0,
  });
  const latencyMs = Math.round(performance.now() - started);
  const evidence = (output.citations || []).map((citation) => citation.excerpt || '').join('\n').toLowerCase();
  const vectorCitations = (output.citations || []).filter((citation) => (citation.channels || []).includes('vector'));
  return {
    id: item.id,
    latencyMs,
    citationCount: output.citations?.length || 0,
    expectedAnchorFound: evidence.includes(item.expectedAnchor),
    topDocument: output.citations?.[0]?.documentName || null,
    vectorIndex: output.metrics?.vectorIndex || null,
    channelCounts: output.metrics?.channels || null,
    vectorCitationCount: vectorCitations.length,
    serviceDurationMs: Number(output.metrics?.durationMs || 0),
  };
}

async function waitForAnnReady(runtime, context, query, {
  timeoutMs = Number(process.env.KNOWLEDGE_ANN_TRAINING_TIMEOUT_MS) || 15 * 60_000,
  pollMs = 2_000,
} = {}) {
  const started = Date.now();
  let attempts = 0;
  let last = null;
  while (Date.now() - started < timeoutMs) {
    attempts += 1;
    last = await retrieveOnce(runtime, context, query, `training_${attempts}`);
    const state = last.vectorIndex || {};
    if (state.error) throw new Error(`Arango vector index training failed: ${state.error}`);
    if (state.ready === true && state.trainingState === 'ready' && state.mode === 'ann') {
      return { attempts, waitMs: Date.now() - started, probe: last };
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  const state = last?.vectorIndex || null;
  throw new Error(`Arango vector index did not reach trainingState=ready with ANN retrieval within ${timeoutMs}ms. Last state: ${JSON.stringify(state)}`);
}

async function benchmarkConcurrency(runtime, context, queries, {
  levels = CONCURRENCY_LEVELS,
  requestsPerLevel = Number(process.env.KNOWLEDGE_ANN_REQUESTS_PER_LEVEL) || 32,
  shouldStop = () => false,
} = {}) {
  const results = [];
  for (const width of levels) {
    if (shouldStop()) throw Object.assign(new Error('ANN benchmark interrupted before the next concurrency cohort.'), { code: 'BENCHMARK_INTERRUPTED' });
    const workload = Array.from({ length: Math.max(width, requestsPerLevel) }, (_, index) => queries[index % queries.length]);
    const latencies = [];
    const serviceDurations = [];
    const requests = [];
    const observation = { maxActive: 0, maxWaiting: 0 };
    const started = performance.now();
    for (let offset = 0; offset < workload.length; offset += width) {
      const batch = workload.slice(offset, offset + width).map((item, index) => retrieveOnce(runtime, context, item, `${width}_${offset + index}`));
      observeQueue(runtime.queue.snapshot(), observation);
      const monitor = setInterval(() => observeQueue(runtime.queue.snapshot(), observation), 10);
      try {
        const completed = await Promise.all(batch);
        requests.push(...completed);
        latencies.push(...completed.map((item) => item.latencyMs));
        serviceDurations.push(...completed.map((item) => item.serviceDurationMs));
      } finally {
        clearInterval(monitor);
      }
    }
    const elapsedMs = Math.round(performance.now() - started);
    const configuredLimit = Number(runtime.queue.snapshot().limits.retrieve || 0);
    if (observation.maxActive > configuredLimit) throw new Error(`Observed retrieval concurrency ${observation.maxActive} exceeds configured limit ${configuredLimit}.`);
    if (width > configuredLimit && observation.maxWaiting < 1) throw new Error(`Width ${width} did not exercise the bounded retrieval queue.`);
    if (requests.some((item) => item.vectorIndex?.ready !== true || item.vectorIndex?.trainingState !== 'ready' || item.vectorIndex?.mode !== 'ann')) {
      throw new Error(`Width ${width} returned a non-ANN retrieval result.`);
    }
    if (requests.some((item) => Number(item.channelCounts?.vector || 0) < 1 || item.vectorCitationCount < 1)) {
      throw new Error(`Width ${width} returned a result without ANN vector candidates and vector-backed citations.`);
    }
    if (requests.some((item) => item.citationCount < 1)) throw new Error(`Width ${width} returned an empty retrieval result.`);
    results.push({
      width,
      requests: requests.length,
      successes: requests.length,
      elapsedMs,
      throughputPerMinute: Number((requests.length / Math.max(1, elapsedMs) * 60_000).toFixed(2)),
      p50LatencyMs: percentile(latencies, 0.5),
      p95LatencyMs: percentile(latencies, 0.95),
      p50ServiceDurationMs: percentile(serviceDurations, 0.5),
      p95ServiceDurationMs: percentile(serviceDurations, 0.95),
      minLatencyMs: Math.min(...latencies),
      maxLatencyMs: Math.max(...latencies),
      expectedAnchorHits: requests.filter((item) => item.expectedAnchorFound).length,
      maxActive: observation.maxActive,
      maxWaiting: observation.maxWaiting,
      configuredLimit,
      vectorModes: [...new Set(requests.map((item) => item.vectorIndex?.mode))],
    });
  }
  return results;
}

function writeReport(report) {
  const directory = path.join(CONFIG.paths.runtime, 'benchmarks');
  fs.mkdirSync(directory, { recursive: true });
  const filename = path.join(directory, `knowledge-ann-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  report.outputFile = filename;
  fs.writeFileSync(filename, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return filename;
}

async function withRetry(task, { attempts = 3, delayMs = 500 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { return await task(attempt); } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
  throw lastError;
}

async function cleanupReservedTenant(runtime, input) {
  const first = await withRetry(() => runtime.cleanupTestTenant(input));
  const verification = await withRetry(() => runtime.cleanupTestTenant(input));
  if (verification.dropped !== false) throw new Error('Synthetic benchmark tenant cleanup could not verify that the database is absent.');
  return { ...first, verifiedAbsent: true };
}

function processIsAlive(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) < 1) return false;
  try { process.kill(Number(pid), 0); return true; } catch (error) {
    if (error?.code === 'ESRCH') return false;
    return true;
  }
}

async function recoverStaleBenchmark(runtime, manifestFile) {
  if (!fs.existsSync(manifestFile)) return { recovered: false };
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (processIsAlive(manifest.pid)) throw Object.assign(new Error(`Another ANN benchmark is active with PID ${manifest.pid}.`), { code: 'BENCHMARK_ALREADY_RUNNING' });
  const expectedFile = path.join(CONFIG.paths.staging, `${manifest.spaceId}.md`);
  if (manifest.stagedFile !== expectedFile) throw new Error('Stale ANN benchmark manifest contains an unexpected staging path.');
  const cleanup = await cleanupReservedTenant(runtime, {
    source: 'knowledge-live-benchmark',
    spaceId: manifest.spaceId,
    confirmation: BENCHMARK_CLEANUP_CONFIRMATION,
  });
  fs.rmSync(expectedFile, { force: true });
  fs.rmSync(manifestFile, { force: true });
  return { recovered: true, previousStartedAt: manifest.startedAt || null, cleanup, stagedFileRemoved: !fs.existsSync(expectedFile) };
}

async function runLiveAnnBenchmark() {
  if (!process.argv.includes('--live')) throw new Error('Pass --live to run the reserved-tenant ANN benchmark against local services.');
  const runToken = crypto.randomBytes(16).toString('hex');
  const spaceId = `knowledge-live-benchmark-${runToken}`;
  const knowledgeBaseId = `ann_benchmark_${crypto.randomBytes(10).toString('hex')}`;
  const documentId = `ann_document_${crypto.randomBytes(10).toString('hex')}`;
  const stagedFile = path.join(CONFIG.paths.staging, `${spaceId}.md`);
  const manifestFile = path.join(CONFIG.paths.runtime, 'benchmarks', 'ann-inflight.json');
  const report = {
    schemaVersion: 1,
    benchmark: 'local-knowledge-ann',
    generatedAt: new Date().toISOString(),
    success: false,
    safety: { reservedSyntheticTenant: true, chatgptInvoked: false, publicRouteUsed: false },
    tenant: { spaceId, knowledgeBaseId, databaseName: null },
    models: CONFIG.models,
    services: null,
    corpus: null,
    indexing: null,
    annReadiness: null,
    concurrency: [],
    cleanup: null,
    recovery: null,
    error: null,
  };
  let runtime;
  let failure = null;
  let manifestOwned = false;
  let interruptedSignal = null;
  const onSigint = () => { interruptedSignal = 'SIGINT'; };
  const onSigterm = () => { interruptedSignal = 'SIGTERM'; };
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);
  try {
    fs.mkdirSync(CONFIG.paths.staging, { recursive: true });
    fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
    runtime = createAnnBenchmarkRuntime();
    report.recovery = await recoverStaleBenchmark(runtime, manifestFile);
    fs.writeFileSync(manifestFile, JSON.stringify({ schemaVersion: 1, pid: process.pid, startedAt: report.generatedAt, spaceId, stagedFile }), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    manifestOwned = true;
    const corpus = generateSyntheticCorpus();
    if (corpus.chunkCount < MINIMUM_CHUNKS) throw new Error(`Synthetic corpus produced ${corpus.chunkCount} chunks; at least ${MINIMUM_CHUNKS} are required.`);
    fs.writeFileSync(stagedFile, corpus.text, { encoding: 'utf8', mode: 0o600 });
    report.corpus = { sectionCount: corpus.sectionCount, expectedChunkCount: corpus.chunkCount, bytes: fs.statSync(stagedFile).size, minimumChunks: MINIMUM_CHUNKS };

    report.tenant.databaseName = runtime.tenantDatabaseName(spaceId);
    const status = await runtime.status();
    report.services = { checkedAt: status.checkedAt, required: Object.fromEntries(['arango', 'embedding', 'reranker'].map((name) => [name, status.services?.[name] || null])) };
    for (const name of ['arango', 'embedding', 'reranker']) {
      if (status.services?.[name]?.healthy !== true) throw new Error(`Required live service '${name}' is not healthy.`);
    }

    const indexingStarted = performance.now();
    const indexVersion = 1;
    const indexed = await runtime.index({
      jobId: `ann_index_${runToken}`,
      spaceId,
      knowledgeBase: {
        id: knowledgeBaseId,
        indexVersion,
        embeddingModel: CONFIG.models.embedding.id,
        embeddingDimension: CONFIG.models.embedding.dimension,
        chunkerVersion: 'ann-live-benchmark-v1',
      },
      document: {
        id: documentId,
        sourcePath: stagedFile,
        originalName: 'synthetic-ann-benchmark.md',
        mimeType: 'text/markdown',
        sizeBytes: fs.statSync(stagedFile).size,
        sha256: sha256(stagedFile),
        metadata: { source: 'synthetic-ann-live-benchmark', reservedTenant: true },
      },
    });
    const indexLatencyMs = Math.round(performance.now() - indexingStarted);
    if (Number(indexed.document?.chunkCount || 0) < 100) throw new Error(`Runtime indexed only ${indexed.document?.chunkCount || 0} chunks; ANN threshold was not reached.`);
    if (Number(indexed.document?.chunkCount || 0) !== corpus.chunkCount) throw new Error(`Chunk preflight/index mismatch: expected ${corpus.chunkCount}, indexed ${indexed.document?.chunkCount || 0}.`);
    report.indexing = { latencyMs: indexLatencyMs, document: indexed.document, metrics: indexed.metrics };
    if (interruptedSignal) throw Object.assign(new Error(`ANN benchmark interrupted by ${interruptedSignal} after indexing.`), { code: 'BENCHMARK_INTERRUPTED' });

    const context = { runToken, spaceId, knowledgeBaseId, indexVersion };
    const queries = benchmarkQueries(corpus.sectionCount);
    report.annReadiness = await waitForAnnReady(runtime, context, queries[0]);
    report.concurrency = await benchmarkConcurrency(runtime, context, queries, { shouldStop: () => Boolean(interruptedSignal) });
    report.success = true;
  } catch (error) {
    failure = error;
    report.error = serializeError(error);
  } finally {
    try {
      if (runtime) {
        report.cleanup = await cleanupReservedTenant(runtime, {
          source: 'knowledge-live-benchmark',
          spaceId,
          confirmation: BENCHMARK_CLEANUP_CONFIRMATION,
        });
      } else {
        report.cleanup = { cleaned: false, dropped: false, reason: 'runtime-not-created' };
      }
    } catch (cleanupError) {
      report.cleanup = { cleaned: false, dropped: false, error: serializeError(cleanupError) };
      if (!failure) failure = cleanupError;
      report.success = false;
    } finally {
      fs.rmSync(stagedFile, { force: true });
      report.cleanup = { ...report.cleanup, stagedFileRemoved: !fs.existsSync(stagedFile) };
      if (manifestOwned && report.cleanup?.verifiedAbsent === true && report.cleanup.stagedFileRemoved) fs.rmSync(manifestFile, { force: true });
      report.cleanup.manifestRemoved = !fs.existsSync(manifestFile);
      report.finishedAt = new Date().toISOString();
      writeReport(report);
      process.removeListener('SIGINT', onSigint);
      process.removeListener('SIGTERM', onSigterm);
    }
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (failure) throw failure;
  return report;
}

if (require.main === module) {
  runLiveAnnBenchmark().catch((error) => {
    process.stderr.write(`${error?.stack || error?.message || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  CONCURRENCY_LEVELS,
  EMPTY_GRAPH,
  MINIMUM_CHUNKS,
  benchmarkConcurrency,
  benchmarkQueries,
  cleanupReservedTenant,
  createAnnBenchmarkRuntime,
  generateSyntheticCorpus,
  observeQueue,
  percentile,
  processIsAlive,
  recoverStaleBenchmark,
  runLiveAnnBenchmark,
  serializeError,
  withRetry,
};
