const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const {
  approvalFor,
  assertConcurrencyApproved,
  recordApproval
} = require('./approval-store.cjs');
const { controlFetch } = require('./control-auth.cjs');

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(__dirname, '..', '..');
const runtimeDir = path.join(repositoryRoot, '.local-runtime', 'llm');
const manageScript = path.join(__dirname, 'manage.ps1');
const secret = fs.readFileSync(path.join(runtimeDir, 'service-secret'), 'utf8').trim();
const gatewayUrl = String(process.env.LOCAL_LLM_BASE_URL || 'http://127.0.0.1:11435').replace(/\/+$/, '');
const levels = String(process.argv.find((value) => value.startsWith('--levels='))?.split('=')[1] || '1,2')
  .split(',').map(Number).filter((value) => Number.isInteger(value) && value >= 1 && value <= 128);
const requestsPerLevel = Math.max(2, Number(process.argv.find((value) => value.startsWith('--requests='))?.split('=')[1] || 3));
let activeEngine = '';
let activeModel = '';

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['firstName', 'lastName', 'email', 'phone', 'location', 'position', 'experience', 'education', 'skills', 'summary'],
  properties: {
    firstName: { type: 'string' },
    lastName: { type: 'string' },
    email: { type: 'string' },
    phone: { type: 'string' },
    location: { type: 'string' },
    position: { type: 'string' },
    experience: { type: 'string' },
    education: { type: 'string' },
    skills: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' }
  }
};

const cvText = `ADA OKAFOR
Senior Software Engineer
London | ada.okafor@example.test | +44 7700 900123
Eight years of experience with TypeScript, Node.js, PostgreSQL, Redis, React and AWS.
Senior Software Engineer, Northstar Systems, January 2021 to Present.
Software Engineer, Harbor Labs, June 2017 to December 2020.
BSc Computer Science, University of Bristol, 2017.`;

function sign(body) {
  const timestamp = String(Date.now());
  const nonce = crypto.randomBytes(24).toString('base64url');
  const signature = crypto.createHmac('sha256', secret)
    .update(`${timestamp}\n${nonce}\nPOST\n/v1/cv/analyze\n${body}`)
    .digest('base64url');
  return { timestamp, nonce, signature };
}

async function setConcurrency(concurrency) {
  assertConcurrencyApproved({
    engine: activeEngine,
    model: activeModel,
    requested: concurrency
  });
  if (activeEngine === 'ollama') {
    await execFileAsync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', manageScript,
      '-Action', 'set-concurrency', '-Concurrency', String(concurrency), '-Json'
    ], { cwd: repositoryRoot, timeout: 15 * 60_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    return;
  }
  const response = await controlFetch(`${gatewayUrl}/control/state`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ concurrency, enabled: true, paused: false })
  });
  if (!response.ok) throw new Error(`Could not set concurrency ${concurrency}`);
}

async function gpuSample() {
  try {
    const result = await execFileAsync('nvidia-smi.exe', [
      '--query-gpu=memory.total,memory.used,utilization.gpu',
      '--format=csv,noheader,nounits'
    ], { timeout: 5_000, windowsHide: true });
    const [totalMiB, usedMiB, utilizationPercent] = result.stdout.trim().split(',').map((value) => Number(value.trim()));
    return { totalMiB, usedMiB, utilizationPercent };
  } catch {
    return null;
  }
}

async function analyze(index) {
  const body = JSON.stringify({
    activity: 'candidate.cv_parse',
    requestSource: 'local-benchmark',
    metering: { record: false, exclusion: 'harness' },
    model: 'selected-runtime-model',
    messages: [
      { role: 'system', content: 'Extract only facts explicitly stated in the CV. Return the supplied JSON schema.' },
      { role: 'user', content: `${cvText}\nBenchmark request ${index}.` }
    ],
    jsonSchema: schema,
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
    const malformed = !payload.data || typeof payload.data !== 'object' || schema.required.some((key) => !(key in payload.data));
    return { ok: !malformed, malformed, latencyMs: Date.now() - startedAt, usage: payload.usage };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      timeout: /abort|timeout/i.test(error.message),
      outOfMemory: /out of memory|cuda.*memory/i.test(error.message),
      error: error.message
    };
  }
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

async function benchmarkLevel(concurrency) {
  await setConcurrency(concurrency);
  const samples = [];
  const timer = setInterval(() => void gpuSample().then((sample) => sample && samples.push(sample)), 500);
  const startedAt = Date.now();
  const results = [];
  try {
    for (let offset = 0; offset < requestsPerLevel; offset += concurrency) {
      results.push(...await Promise.all(
        Array.from({ length: Math.min(concurrency, requestsPerLevel - offset) }, (_, index) => analyze(offset + index))
      ));
    }
  } finally {
    clearInterval(timer);
    const finalSample = await gpuSample();
    if (finalSample) samples.push(finalSample);
  }
  const elapsedMs = Date.now() - startedAt;
  const successful = results.filter((result) => result.ok);
  const latencies = successful.map((result) => result.latencyMs);
  const maxVramUsedMiB = Math.max(0, ...samples.map((sample) => sample.usedMiB));
  const totalVramMiB = Math.max(0, ...samples.map((sample) => sample.totalMiB));
  const maxGpuUtilizationPercent = Math.max(0, ...samples.map((sample) => sample.utilizationPercent));
  return {
    concurrency,
    requests: results.length,
    successful: successful.length,
    failed: results.length - successful.length,
    malformedJson: results.filter((result) => result.malformed).length,
    timeouts: results.filter((result) => result.timeout).length,
    outOfMemory: results.filter((result) => result.outOfMemory).length,
    throughputPerMinute: Number((successful.length / (elapsedMs / 60_000)).toFixed(2)),
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    maxVramUsedMiB,
    totalVramMiB,
    vramPercent: totalVramMiB ? Number((maxVramUsedMiB / totalVramMiB * 100).toFixed(1)) : null,
    maxGpuUtilizationPercent,
    elapsedMs,
    results,
    stable: successful.length === results.length
      && results.every((result) => !result.malformed && !result.timeout && !result.outOfMemory)
      && (!totalVramMiB || maxVramUsedMiB / totalVramMiB <= 0.92)
  };
}

async function main() {
  fs.mkdirSync(runtimeDir, { recursive: true });
  const health = await fetch(`${gatewayUrl}/health`);
  if (!health.ok) throw new Error('The selected CV inference engine must be healthy before benchmarking.');
  const runtimeStatus = await (await controlFetch(`${gatewayUrl}/control/status`)).json();
  activeEngine = runtimeStatus.engine;
  activeModel = runtimeStatus.model;
  const activationCap = approvalFor(activeEngine, activeModel).concurrency;
  const safeLevels = levels.filter((level) => level <= activationCap);
  if (!safeLevels.length) {
    throw new Error(
      `None of the requested benchmark levels are within the sustained approval cap ${activationCap} `
      + `for ${activeEngine}/${activeModel}`
    );
  }
  const report = {
    generatedAt: new Date().toISOString(),
    engine: runtimeStatus.engine,
    model: runtimeStatus.model,
    requestsPerLevel,
    requestedLevels: levels,
    activationCap,
    skippedUnapprovedLevels: levels.filter((level) => level > activationCap),
    levels: []
  };
  for (const level of safeLevels) {
    process.stdout.write(`Benchmarking concurrency ${level}...\n`);
    const result = await benchmarkLevel(level);
    report.levels.push(result);
    process.stdout.write(`${JSON.stringify({ concurrency: level, stable: result.stable, throughputPerMinute: result.throughputPerMinute, p95LatencyMs: result.p95LatencyMs, vramPercent: result.vramPercent })}\n`);
    if (!result.stable) break;
  }
  let approved = report.levels.find((level) => level.stable) || report.levels[0];
  for (const result of report.levels.slice(1)) {
    const throughputGain = approved?.throughputPerMinute
      ? result.throughputPerMinute / approved.throughputPerMinute
      : 0;
    result.throughputGain = Number(throughputGain.toFixed(2));
    result.efficient = result.stable && throughputGain >= 1.1;
    if (result.efficient) approved = result;
  }
  report.approvedConcurrency = approved?.concurrency || 1;
  report.safetyRule = 'No failures, malformed JSON, timeout or OOM; peak VRAM at or below 92 percent; higher levels must improve throughput by at least 10 percent.';
  const reportSlug = `${report.engine}-${report.model}`.replace(/[^a-z0-9_-]+/gi, '-');
  const reportFile = path.join(runtimeDir, `benchmark-${reportSlug}.json`);
  const approvedFile = path.join(runtimeDir, 'approved-concurrency.json');
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  recordApproval({
    concurrency: report.approvedConcurrency,
    engine: report.engine,
    model: report.model,
    measuredAt: report.generatedAt,
    reportFile
  });
  await setConcurrency(report.approvedConcurrency);
  process.stdout.write(`${JSON.stringify({ approvedConcurrency: report.approvedConcurrency, reportFile, approvedFile })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
