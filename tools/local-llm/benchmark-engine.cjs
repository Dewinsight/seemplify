const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const {
  approvalFor,
  assertConcurrencyApproved,
  recordApproval
} = require('./approval-store.cjs');
const { cvSchema, cvText, pageCount, scoreCvOutput } = require('./three-page-cv-fixture.cjs');
const { controlFetch } = require('./control-auth.cjs');

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(__dirname, '..', '..');
const runtimeDir = path.join(repositoryRoot, '.local-runtime', 'llm');
const manageScript = path.join(__dirname, 'manage.ps1');
const gatewayUrl = 'http://127.0.0.1:11435';
const secret = fs.readFileSync(path.join(runtimeDir, 'service-secret'), 'utf8').trim();
const levels = String(process.argv.find((value) => value.startsWith('--levels='))?.split('=')[1] || '1,2,4,8,16,32')
  .split(',').map(Number).filter((value) => Number.isInteger(value) && value >= 1 && value <= 128);
const maxP95LatencyMs = Math.max(30_000, Number(
  process.argv.find((value) => value.startsWith('--max-p95-ms='))?.split('=')[1] || 300_000
));
const skipRuntimeConfig = process.argv.includes('--skip-runtime-config');
const appendReport = process.argv.includes('--append');
const vllmNativeConcurrency = Math.max(1, Number(process.env.SEEMPLIFY_VLLM_MAX_NUM_SEQS || 16));

function sign(body) {
  const timestamp = String(Date.now());
  const nonce = crypto.randomBytes(24).toString('base64url');
  const signature = crypto.createHmac('sha256', secret)
    .update(`${timestamp}\n${nonce}\nPOST\n/v1/cv/analyze\n${body}`)
    .digest('base64url');
  return { timestamp, nonce, signature };
}

async function status() {
  return (await (await controlFetch(`${gatewayUrl}/control/status`)).json());
}

async function manage(action, options = {}) {
  const args = [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', manageScript,
    '-Action', action, '-Json'
  ];
  if (options.engine) args.push('-Engine', options.engine);
  if (options.model) args.push('-Model', options.model);
  if (options.concurrency) args.push('-Concurrency', String(options.concurrency));
  return execFileAsync('powershell.exe', args, {
    cwd: repositoryRoot,
    timeout: 20 * 60_000,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024
  });
}

async function setConcurrency(engine, model, concurrency) {
  assertConcurrencyApproved({ engine, model, requested: concurrency });
  if (engine === 'ollama' && !skipRuntimeConfig) {
    await manage('set-concurrency', { concurrency });
    return;
  }
  const response = await controlFetch(`${gatewayUrl}/control/state`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ concurrency, enabled: true, paused: false })
  });
  if (!response.ok) throw new Error(`Could not set gateway concurrency ${concurrency}`);
}

async function gpuSample() {
  try {
    const result = await execFileAsync('nvidia-smi.exe', [
      '--query-gpu=memory.total,memory.used,utilization.gpu',
      '--format=csv,noheader,nounits'
    ], { timeout: 5_000, windowsHide: true });
    const [totalMiB, usedMiB, utilizationPercent] = result.stdout.trim().split(',').map((value) => Number(value.trim()));
    return { at: new Date().toISOString(), totalMiB, usedMiB, utilizationPercent };
  } catch {
    return null;
  }
}

async function analyze(requestId) {
  const body = JSON.stringify({
    activity: 'candidate.cv_parse',
    requestSource: 'local-engine-benchmark',
    metering: { record: false, exclusion: 'harness' },
    model: 'selected-runtime-model',
    messages: [
      {
        role: 'system',
        content: `Extract every explicit CV fact into the supplied schema. Never invent information. Internal request id: ${requestId}.`
      },
      { role: 'user', content: `CV text:\n\n${cvText}` }
    ],
    jsonSchema: cvSchema,
    temperature: 0,
    timeoutMs: 300_000
  });
  const signed = sign(body);
  const startedAt = Date.now();
  try {
    const response = await fetch(`${gatewayUrl}/v1/cv/analyze`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-seemplify-timestamp': signed.timestamp,
        'x-seemplify-nonce': signed.nonce,
        'x-seemplify-signature': signed.signature
      },
      body,
      signal: AbortSignal.timeout(330_000)
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(`${payload.code || response.status}: ${payload.message || 'request failed'}`);
    const quality = scoreCvOutput(payload.data);
    return {
      transportOk: true,
      qualityOk: quality.passed,
      latencyMs: Date.now() - startedAt,
      engine: payload.engine,
      model: payload.model,
      quality
    };
  } catch (error) {
    return {
      transportOk: false,
      qualityOk: false,
      latencyMs: Date.now() - startedAt,
      timeout: /abort|timeout/i.test(error.message),
      outOfMemory: /out of memory|cuda.*memory|resource exhausted/i.test(error.message),
      error: error.message
    };
  }
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

async function benchmarkLevel(engine, model, concurrency) {
  try {
    await setConcurrency(engine, model, concurrency);
  } catch (error) {
    return {
      concurrency,
      acceptable: false,
      configurationError: error.message,
      requests: 0,
      transportSuccessful: 0,
      qualitySuccessful: 0
    };
  }
  const samples = [];
  const sampler = setInterval(() => void gpuSample().then((sample) => sample && samples.push(sample)), 500);
  const startedAt = Date.now();
  let results;
  try {
    results = await Promise.all(
      Array.from({ length: concurrency }, (_, index) => analyze(`${engine}-${concurrency}-${index}`))
    );
  } finally {
    clearInterval(sampler);
    const finalSample = await gpuSample();
    if (finalSample) samples.push(finalSample);
  }
  const elapsedMs = Date.now() - startedAt;
  const transportResults = results.filter((result) => result.transportOk);
  const qualityResults = results.filter((result) => result.qualityOk);
  const latencies = transportResults.map((result) => result.latencyMs);
  const detailRecalls = transportResults.map((result) => Number(result.quality?.detailRecall || 0));
  const maxVramUsedMiB = Math.max(0, ...samples.map((sample) => sample.usedMiB));
  const totalVramMiB = Math.max(0, ...samples.map((sample) => sample.totalMiB));
  const qualityPassRate = results.length ? qualityResults.length / results.length : 0;
  const run = {
    concurrency,
    requests: results.length,
    transportSuccessful: transportResults.length,
    qualitySuccessful: qualityResults.length,
    qualityPassRate,
    averageDetailRecall: detailRecalls.length
      ? detailRecalls.reduce((total, value) => total + value, 0) / detailRecalls.length
      : 0,
    elapsedMs,
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    throughputPerMinute: Number((qualityResults.length / (elapsedMs / 60_000)).toFixed(2)),
    maxVramUsedMiB,
    totalVramMiB,
    vramPercent: totalVramMiB ? Number((maxVramUsedMiB / totalVramMiB * 100).toFixed(1)) : null,
    maxGpuUtilizationPercent: Math.max(0, ...samples.map((sample) => sample.utilizationPercent)),
    timeouts: results.filter((result) => result.timeout).length,
    outOfMemory: results.filter((result) => result.outOfMemory).length,
    errors: results.filter((result) => !result.transportOk).map((result) => result.error),
    results
  };
  run.acceptable = run.transportSuccessful === run.requests
    && run.qualityPassRate >= 0.95
    && run.p95LatencyMs != null
    && run.p95LatencyMs <= maxP95LatencyMs
    && run.outOfMemory === 0
    && (!run.vramPercent || run.vramPercent <= 96);
  if (engine === 'vllm' && concurrency > vllmNativeConcurrency) {
    run.acceptable = false;
    run.saturated = true;
    run.saturationReason = `Concurrency ${concurrency} exceeds vLLM's native --max-num-seqs=${vllmNativeConcurrency}; overflow waited inside vLLM instead of increasing throughput`;
  }
  return run;
}

async function main() {
  const runtime = await status();
  if (!['ollama', 'vllm'].includes(runtime.engine)) {
    throw new Error('Select Ollama or vLLM before running the local GPU benchmark.');
  }
  const health = await fetch(`${gatewayUrl}/health`);
  if (!health.ok) throw new Error(`${runtime.engine} is not healthy.`);
  const activationCap = approvalFor(runtime.engine, runtime.model).concurrency;
  const safeLevels = levels.filter((level) => level <= activationCap);
  if (!safeLevels.length) {
    throw new Error(
      `None of the requested benchmark levels are within the sustained approval cap ${activationCap} `
      + `for ${runtime.engine}/${runtime.model}`
    );
  }
  const report = {
    generatedAt: new Date().toISOString(),
    engine: runtime.engine,
    model: runtime.model,
    fixture: 'three-page A4 synthetic Ada Okafor CV using the Seemplify CV contract',
    fixturePages: pageCount,
    fixtureCharacters: cvText.length,
    requestedLevels: levels,
    levels: safeLevels,
    activationCap,
    skippedUnapprovedLevels: levels.filter((level) => level > activationCap),
    acceptance: {
      transportSuccessRate: 1,
      qualityPassRate: 0.95,
      maxP95LatencyMs,
      maxVramPercent: 96
    },
    runs: []
  };
  for (const level of safeLevels) {
    process.stdout.write(`Testing ${report.engine}/${report.model} at concurrency ${level}...\n`);
    const run = await benchmarkLevel(report.engine, report.model, level);
    report.runs.push(run);
    process.stdout.write(`${JSON.stringify({
      concurrency: level,
      acceptable: run.acceptable,
      qualityPassRate: run.qualityPassRate,
      p95LatencyMs: run.p95LatencyMs,
      throughputPerMinute: run.throughputPerMinute,
      vramPercent: run.vramPercent,
      error: run.configurationError
    })}\n`);
    if (!run.acceptable) break;
  }
  let approvedConcurrency = 0;
  for (const run of report.runs) {
    if (!run.acceptable) break;
    approvedConcurrency = run.concurrency;
  }
  report.approvedConcurrency = approvedConcurrency || 1;
  report.firstUnacceptableConcurrency = report.runs.find((run) => !run.acceptable)?.concurrency || null;
  const reportSlug = `${report.engine}-${report.model}`.replace(/[^a-z0-9_-]+/gi, '-');
  const reportFile = path.join(runtimeDir, `benchmark-${reportSlug}.json`);
  if (appendReport && fs.existsSync(reportFile)) {
    try {
      const previous = JSON.parse(fs.readFileSync(reportFile, 'utf8').replace(/^\uFEFF/, ''));
      const byConcurrency = new Map((previous.runs || []).map((run) => [run.concurrency, run]));
      for (const run of report.runs) byConcurrency.set(run.concurrency, run);
      report.runs = [...byConcurrency.values()].sort((left, right) => left.concurrency - right.concurrency);
      report.generatedAt = new Date().toISOString();
      report.levels = report.runs.map((run) => run.concurrency);
      let mergedApproved = 0;
      for (const run of report.runs) {
        if (!run.acceptable) break;
        mergedApproved = run.concurrency;
      }
      report.approvedConcurrency = mergedApproved || 1;
      report.firstUnacceptableConcurrency = report.runs.find((run) => !run.acceptable)?.concurrency || null;
    } catch {}
  }
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), { encoding: 'utf8', mode: 0o600 });
  recordApproval({
    engine: report.engine,
    model: report.model,
    concurrency: report.approvedConcurrency,
    measuredAt: report.generatedAt,
    reportFile
  });
  await setConcurrency(report.engine, report.model, report.approvedConcurrency);
  process.stdout.write(`${JSON.stringify({
    engine: report.engine,
    model: report.model,
    approvedConcurrency: report.approvedConcurrency,
    firstUnacceptableConcurrency: report.firstUnacceptableConcurrency,
    reportFile
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
