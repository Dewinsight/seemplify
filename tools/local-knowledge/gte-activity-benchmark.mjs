import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { CONFIG } = require('./config.cjs');
const {
  createGteEmbeddingClient,
  percentile,
  validateEmbeddingVectors,
  vectorNorm,
} = require('./gte-embedding-client.cjs');

const QUERY_CONCURRENCY_LEVELS = Object.freeze([1, 2, 4, 8]);
const INGESTION_COHORTS = Object.freeze([
  Object.freeze({ name: 'live-index-small', priority: 'live-index', batchSize: 8, concurrency: 2 }),
  Object.freeze({ name: 'live-index-medium', priority: 'live-index', batchSize: 16, concurrency: 2 }),
  Object.freeze({ name: 'backfill-full', priority: 'backfill', batchSize: 32, concurrency: 1 }),
]);
const GATES = Object.freeze({
  maximumConcurrency: 8,
  maximumFailureRate: 0.01,
  maximumEndToEndP95Ms: 500,
  maximumEndToEndP99Ms: 1_000,
  maximumEventLoopP99Ms: 100,
  maximumRssGrowthBytes: 512 * 1024 * 1024,
});

function cliInteger(name, fallback, { minimum, maximum }) {
  const prefix = `--${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  if (!argument) return fallback;
  const value = Number(argument.slice(prefix.length));
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`--${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function latencySummary(values) {
  const finite = values.filter(Number.isFinite);
  return {
    samples: finite.length,
    p50: round(percentile(finite, 0.50)),
    p95: round(percentile(finite, 0.95)),
    p99: round(percentile(finite, 0.99)),
    maximum: finite.length ? round(Math.max(...finite)) : null,
  };
}

function eventLoopSummary(histogram) {
  const milliseconds = (nanoseconds) => {
    const value = Number(nanoseconds);
    return Number.isFinite(value) && value < Number.MAX_SAFE_INTEGER ? round(value / 1e6) : null;
  };
  return {
    minimumMs: milliseconds(histogram.min),
    meanMs: milliseconds(histogram.mean),
    p50Ms: milliseconds(histogram.percentile(50)),
    p95Ms: milliseconds(histogram.percentile(95)),
    p99Ms: milliseconds(histogram.percentile(99)),
    maximumMs: milliseconds(histogram.max),
  };
}

function cpuSummary(startUsage, elapsedMs) {
  const usage = process.cpuUsage(startUsage);
  const totalMicroseconds = usage.user + usage.system;
  return {
    userMs: round(usage.user / 1_000),
    systemMs: round(usage.system / 1_000),
    totalMs: round(totalMicroseconds / 1_000),
    percentOfOneLogicalCore: elapsedMs > 0 ? round((totalMicroseconds / (elapsedMs * 1_000)) * 100) : null,
  };
}

function currentRssBytes() {
  return process.memoryUsage().rss;
}

function createRssSampler(intervalMs = 10) {
  const startedBytes = currentRssBytes();
  let peakBytes = startedBytes;
  const sample = () => { peakBytes = Math.max(peakBytes, currentRssBytes()); };
  const timer = setInterval(sample, intervalMs);
  return {
    sample,
    stop() {
      clearInterval(timer);
      sample();
      const endedBytes = currentRssBytes();
      return {
        startedBytes,
        endedBytes,
        deltaBytes: endedBytes - startedBytes,
        peakBytes,
        peakDeltaBytes: peakBytes - startedBytes,
      };
    },
  };
}

function queryFixture(index) {
  const regions = ['Lagos', 'Abuja', 'Kano', 'Port Harcourt'];
  const topics = ['service recovery', 'survey completion', 'customer trust', 'support response'];
  return `Find the evidence about ${topics[index % topics.length]} for cohort record ${String(index).padStart(3, '0')} in ${regions[index % regions.length]}.`;
}

function ingestionFixture(requestIndex, textIndex, batchSize) {
  const section = String((requestIndex * batchSize) + textIndex).padStart(4, '0');
  return `Section ${section}. Verified experience research records customer feedback, operational evidence, service outcomes, and recommended follow-up actions. This deterministic paragraph represents a normalized document chunk for indexing performance measurement.`;
}

async function boundedMap(count, concurrency, operation) {
  let cursor = 0;
  async function lane() {
    while (cursor < count) {
      const index = cursor;
      cursor += 1;
      await operation(index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(count, concurrency) }, () => lane()));
}

function failureSummary(failures, total) {
  const byCode = {};
  for (const code of failures) byCode[code] = (byCode[code] || 0) + 1;
  return {
    count: failures.length,
    rate: total ? round(failures.length / total, 6) : null,
    byCode,
  };
}

function verificationSummary(state) {
  return {
    expectedDimension: 768,
    vectorsChecked: state.vectorsChecked,
    invalidVectors: state.invalidVectors,
    minimumNorm: state.norms.length ? round(Math.min(...state.norms), 6) : null,
    maximumNorm: state.norms.length ? round(Math.max(...state.norms), 6) : null,
    dimensionsValid: state.invalidVectors === 0 && state.vectorsChecked > 0,
    normalized: state.invalidVectors === 0 && state.norms.every((value) => Math.abs(value - 1) <= 0.02),
  };
}

async function runCohort(client, {
  name,
  activity,
  priority,
  requestCount,
  concurrency,
  textsPerRequest,
  textFactory,
  postLoadRssBytes,
}) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > GATES.maximumConcurrency) {
    throw new Error(`Benchmark concurrency must be between 1 and ${GATES.maximumConcurrency}.`);
  }
  const endToEndMs = [];
  const queueMs = [];
  const inferenceMs = [];
  const failures = [];
  const verification = { vectorsChecked: 0, invalidVectors: 0, norms: [] };
  const rss = createRssSampler();
  const eventLoop = monitorEventLoopDelay({ resolution: 10 });
  eventLoop.enable();
  await new Promise((resolve) => setImmediate(resolve));
  const cpuStarted = process.cpuUsage();
  const cohortStarted = performance.now();

  await boundedMap(requestCount, concurrency, async (requestIndex) => {
    const texts = Array.from({ length: textsPerRequest }, (_value, textIndex) => textFactory(requestIndex, textIndex));
    const requestStarted = performance.now();
    try {
      const result = await client.embed(texts, {
        priority,
        requestId: `gte-benchmark-${activity}-${name}-${requestIndex}`,
      });
      endToEndMs.push(performance.now() - requestStarted);
      queueMs.push(Number(result.metrics?.queueWaitMs));
      inferenceMs.push(Number(result.metrics?.inferenceMs));
      try {
        validateEmbeddingVectors(result.vectors, { expectedCount: texts.length, dimension: 768, normalized: true });
        verification.vectorsChecked += result.vectors.length;
        for (const vector of result.vectors) verification.norms.push(vectorNorm(vector));
      } catch (error) {
        verification.invalidVectors += Math.max(1, result.vectors?.length || texts.length);
        failures.push(error.code || 'INVALID_EMBEDDING_RESPONSE');
      }
    } catch (error) {
      endToEndMs.push(performance.now() - requestStarted);
      failures.push(String(error?.code || 'GTE_BENCHMARK_REQUEST_FAILED').slice(0, 100));
    } finally {
      rss.sample();
    }
  });

  const elapsedMs = performance.now() - cohortStarted;
  eventLoop.disable();
  const memory = rss.stop();
  const runtimeStatus = client.status();
  const failure = failureSummary(failures, requestCount);
  const validation = verificationSummary(verification);
  const report = {
    name,
    activity,
    priority,
    concurrency,
    requestCount,
    textsPerRequest,
    totalTexts: requestCount * textsPerRequest,
    elapsedMs: round(elapsedMs),
    throughput: {
      requestsPerSecond: round(requestCount / (elapsedMs / 1_000)),
      textsPerSecond: round((requestCount * textsPerRequest) / (elapsedMs / 1_000)),
    },
    latency: {
      endToEndMs: latencySummary(endToEndMs),
      queueMs: latencySummary(queueMs),
      inferenceMs: latencySummary(inferenceMs),
    },
    failures: failure,
    verification: validation,
    resources: {
      rss: {
        ...memory,
        endedDeltaFromPostLoadBytes: memory.endedBytes - postLoadRssBytes,
        peakDeltaFromPostLoadBytes: memory.peakBytes - postLoadRssBytes,
      },
      processCpu: cpuSummary(cpuStarted, elapsedMs),
      eventLoopDelay: eventLoopSummary(eventLoop),
    },
    queueDrained: runtimeStatus.queue.waiting === 0
      && runtimeStatus.concurrency.activeLogicalRequests === 0,
  };
  const gateReasons = [];
  if (failure.rate == null || failure.rate > GATES.maximumFailureRate) gateReasons.push('FAILURE_RATE');
  if (report.latency.endToEndMs.p95 == null
      || report.latency.endToEndMs.p95 > GATES.maximumEndToEndP95Ms) gateReasons.push('P95_LATENCY');
  if (report.latency.endToEndMs.p99 == null
      || report.latency.endToEndMs.p99 > GATES.maximumEndToEndP99Ms) gateReasons.push('P99_LATENCY');
  if (report.resources.eventLoopDelay.p99Ms == null
      || report.resources.eventLoopDelay.p99Ms > GATES.maximumEventLoopP99Ms) gateReasons.push('EVENT_LOOP_DELAY');
  if (report.resources.rss.endedDeltaFromPostLoadBytes > GATES.maximumRssGrowthBytes) gateReasons.push('RSS_GROWTH');
  if (!report.queueDrained) gateReasons.push('QUEUE_NOT_DRAINED');
  if (!validation.dimensionsValid || !validation.normalized) gateReasons.push('VECTOR_VALIDATION');
  report.gate = { passed: gateReasons.length === 0, reasons: gateReasons };
  return report;
}

function recommendConcurrency(queryCohorts) {
  let suggested = null;
  const reasons = [];
  for (const cohort of queryCohorts) {
    if (!cohort.gate.passed) {
      reasons.push(`Concurrency ${cohort.concurrency} failed: ${cohort.gate.reasons.join(', ')}`);
      break;
    }
    suggested = cohort.concurrency;
  }
  if (suggested == null) reasons.unshift('Concurrency 1 did not satisfy every operating gate.');
  else reasons.unshift(`Concurrency ${suggested} is the highest sequentially stable tested level.`);
  return {
    suggestedMaxConcurrency: suggested,
    testedMaximum: GATES.maximumConcurrency,
    configurationChanged: false,
    reasons,
  };
}

function writeReport(report) {
  const directory = path.join(CONFIG.paths.runtime, 'benchmarks');
  fs.mkdirSync(directory, { recursive: true });
  const timestamp = report.generatedAt.replaceAll(':', '').replaceAll('.', '-');
  const filename = `gte-activity-${timestamp}-${report.runId}.json`;
  const destination = path.join(directory, filename);
  const temporary = `${destination}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  fs.renameSync(temporary, destination);
  return destination;
}

async function main() {
  if (!process.argv.includes('--live')) {
    throw new Error('The real GTE activity benchmark is opt-in. Pass --live to load the pinned model and run it.');
  }
  const requestsPerQueryCohort = cliInteger('query-requests', 32, { minimum: 32, maximum: 512 });
  const requestsPerIngestionCohort = cliInteger('ingestion-requests', 8, { minimum: 4, maximum: 128 });
  const runId = crypto.randomBytes(6).toString('hex');
  const beforeStartRssBytes = currentRssBytes();
  const processCpuStarted = process.cpuUsage();
  const benchmarkStarted = performance.now();
  const client = createGteEmbeddingClient({
    cacheDir: CONFIG.embeddingMigration.cacheDir,
    maxLogicalConcurrency: GATES.maximumConcurrency,
    maxBatchTexts: 32,
    maxTextsPerRequest: 32,
  });
  let startStatus;
  let postLoadRssBytes;
  const queryCohorts = [];
  const ingestionCohorts = [];
  let beforeCloseStatus;
  let beforeCloseRssBytes;
  let closeResult;
  try {
    startStatus = await client.start();
    postLoadRssBytes = currentRssBytes();
    for (const concurrency of QUERY_CONCURRENCY_LEVELS) {
      queryCohorts.push(await runCohort(client, {
        name: `query-c${concurrency}`,
        activity: 'query',
        priority: 'query',
        requestCount: requestsPerQueryCohort,
        concurrency,
        textsPerRequest: 1,
        textFactory: (requestIndex) => queryFixture(requestIndex),
        postLoadRssBytes,
      }));
    }
    for (const cohort of INGESTION_COHORTS) {
      ingestionCohorts.push(await runCohort(client, {
        ...cohort,
        activity: 'ingestion',
        requestCount: requestsPerIngestionCohort,
        textsPerRequest: cohort.batchSize,
        textFactory: (requestIndex, textIndex) => ingestionFixture(requestIndex, textIndex, cohort.batchSize),
        postLoadRssBytes,
      }));
    }
    beforeCloseStatus = client.status();
    beforeCloseRssBytes = currentRssBytes();
    if (beforeCloseStatus.worker.modelLoads !== 1 || beforeCloseStatus.worker.generation !== 1) {
      throw new Error('The benchmark did not retain exactly one loaded GTE worker/model generation.');
    }
    closeResult = await client.close({ drainTimeoutMs: 30_000 });
    const elapsedMs = performance.now() - benchmarkStarted;
    const report = {
      schemaVersion: 1,
      benchmark: 'gte-activity',
      workloadVersion: 'gte-activity-v1',
      generatedAt: new Date().toISOString(),
      runId,
      containsInputText: false,
      qwenInvocations: 0,
      execution: {
        sequentialCohorts: true,
        maximumConcurrency: GATES.maximumConcurrency,
        queryConcurrencyLevels: QUERY_CONCURRENCY_LEVELS,
        requestsPerQueryCohort,
        requestsPerIngestionCohort,
      },
      model: {
        ...startStatus.profile,
        loadCount: beforeCloseStatus.worker.modelLoads,
        loadMs: beforeCloseStatus.worker.lastModelLoadMs,
        cacheDir: startStatus.cacheDir,
      },
      gates: GATES,
      queryCohorts,
      ingestionCohorts,
      recommendation: recommendConcurrency(queryCohorts),
      overall: {
        elapsedMs: round(elapsedMs),
        failures: queryCohorts.concat(ingestionCohorts)
          .reduce((sum, cohort) => sum + cohort.failures.count, 0),
        vectorsChecked: queryCohorts.concat(ingestionCohorts)
          .reduce((sum, cohort) => sum + cohort.verification.vectorsChecked, 0),
        rss: {
          beforeModelLoadBytes: beforeStartRssBytes,
          afterModelLoadBytes: postLoadRssBytes,
          beforeCloseBytes: beforeCloseRssBytes,
          afterCloseBytes: currentRssBytes(),
          processMaxRssBytes: process.resourceUsage().maxRSS * 1024,
        },
        processCpu: cpuSummary(processCpuStarted, elapsedMs),
        modelLoadedOnce: beforeCloseStatus.worker.modelLoads === 1
          && beforeCloseStatus.worker.generation === 1,
        drained: closeResult.drained !== false,
      },
      environment: {
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
        logicalCpuCount: os.cpus().length,
        cpuModel: os.cpus()[0]?.model || null,
        totalMemoryBytes: os.totalmem(),
      },
    };
    const destination = writeReport(report);
    process.stdout.write(`${JSON.stringify({ ok: true, report: destination, recommendation: report.recommendation,
      overall: report.overall, queryCohorts: report.queryCohorts.map((cohort) => ({
        concurrency: cohort.concurrency,
        throughput: cohort.throughput,
        latency: cohort.latency,
        failures: cohort.failures,
        gate: cohort.gate,
      })) }, null, 2)}\n`);
  } finally {
    if (!closeResult) await client.close({ drainTimeoutMs: 30_000 }).catch(() => undefined);
  }
}

await main();
