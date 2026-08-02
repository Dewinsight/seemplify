const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { controlFetch } = require('./control-auth.cjs');
const {
  approvalFor,
  assertConcurrencyApproved,
  concurrencyDecision,
  recordApproval
} = require('./approval-store.cjs');
const {
  approvedConcurrency: decideApprovedConcurrency,
  selectHeadroomConcurrency
} = require('./benchmark-approval.cjs');
const { cvText: threePageCvText, pageCount, scoreCvOutput } = require('./three-page-cv-fixture.cjs');

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write([
    'Usage: node tools/local-llm/benchmark-codex.cjs [options]',
    '',
    '  --models=gpt-5.6-terra       Comma-separated Codex models',
    '  --levels=1,2,4               Discovery concurrency levels',
    '  --rounds=2                    Discovery rounds per level (0 = automatic)',
    '  --sustained-rounds=3          Minimum sustained rounds',
    '  --minimum-sustained-requests=12',
    '  --max-p95-ms=180000',
    '',
    'The harness restores the original runtime selection and control state.'
  ].join('\n') + '\n');
  process.exit(0);
}

const { CV_EXTRACTION_SCHEMA } = require('../../recruiter/backend/services/aiModelService');

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(__dirname, '..', '..');
const runtimeDir = path.join(repositoryRoot, '.local-runtime', 'llm');
const manageScript = path.join(__dirname, 'manage.ps1');
const gatewayUrl = 'http://127.0.0.1:11435';
const secret = fs.readFileSync(path.join(runtimeDir, 'service-secret'), 'utf8').trim();
const catalog = JSON.parse(fs.readFileSync(path.join(runtimeDir, 'codex-models.json'), 'utf8').replace(/^\uFEFF/, ''));
const levels = String(process.argv.find((value) => value.startsWith('--levels='))?.split('=')[1] || '1,2,4,8,16,32,64,128')
  .split(',').map(Number).filter((value) => Number.isInteger(value) && value >= 1 && value <= 128);
const requestedModels = String(process.argv.find((value) => value.startsWith('--models='))?.split('=')[1] || '')
  .split(',').map((value) => value.trim()).filter(Boolean);
const requestedRounds = Math.max(0, Math.min(5, Number(
  process.argv.find((value) => value.startsWith('--rounds='))?.split('=')[1] || 0
)));
const sustainedRounds = Math.max(3, Math.min(20, Number(
  process.argv.find((value) => value.startsWith('--sustained-rounds='))?.split('=')[1] || 3
)));
const minimumSustainedRequests = Math.max(12, Math.min(256, Number(
  process.argv.find((value) => value.startsWith('--minimum-sustained-requests='))?.split('=')[1] || 12
)));
const minimumSustainedQualityPassRate = 0.98;
const maxP95LatencyMs = Math.max(30_000, Number(
  process.argv.find((value) => value.startsWith('--max-p95-ms='))?.split('=')[1] || 180_000
));

const schema = CV_EXTRACTION_SCHEMA;

function sign(body) {
  const timestamp = String(Date.now());
  const nonce = crypto.randomBytes(24).toString('base64url');
  const signature = crypto.createHmac('sha256', secret)
    .update(`${timestamp}\n${nonce}\nPOST\n/v1/cv/analyze\n${body}`)
    .digest('base64url');
  return { timestamp, nonce, signature };
}

async function manage(action, engine, model) {
  const args = [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', manageScript,
    '-Action', action, '-Json'
  ];
  if (engine) args.push('-Engine', engine);
  if (model) args.push('-Model', model);
  await execFileAsync('powershell.exe', args, {
    cwd: repositoryRoot,
    timeout: 15 * 60_000,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024
  });
}

async function setConcurrency(model, concurrency) {
  assertConcurrencyApproved({ engine: 'codex', model, requested: concurrency });
  const response = await controlFetch(`${gatewayUrl}/control/state`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ concurrency, enabled: true, paused: false })
  });
  if (!response.ok) throw new Error(`Could not set concurrency ${concurrency}`);
}

async function restoreControlState(original) {
  const restoredConcurrency = concurrencyDecision({
    engine: original.engine,
    model: original.model,
    requested: original.state?.requestedConcurrency ?? original.state?.concurrency
  }).effectiveConcurrency;
  const response = await controlFetch(`${gatewayUrl}/control/state`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      enabled: original.state?.enabled !== false,
      ingressEnabled: original.state?.ingressEnabled !== false,
      paused: original.state?.paused === true,
      concurrency: restoredConcurrency,
      selectionMode: original.state?.selectionMode === 'manual' ? 'manual' : 'automatic'
    })
  });
  if (!response.ok) throw new Error('Could not restore the original gateway control state');
}

async function analyze(requestId) {
  const body = JSON.stringify({
    activity: 'candidate.cv_parse',
    requestSource: 'local-codex-benchmark',
    metering: { record: false, exclusion: 'harness' },
    model: 'selected-runtime-model',
    messages: [
      {
        role: 'system',
        content: `Extract every explicit CV fact into the supplied schema. Do not infer or invent information. Internal request id: ${requestId}.`
      },
      { role: 'user', content: `CV text:\n\n${threePageCvText}` }
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
    const quality = scoreCvOutput(payload.data);
    return {
      ok: quality.passed,
      transportOk: true,
      qualityOk: quality.passed,
      quality,
      observed: {
        firstName: payload.data.firstName,
        lastName: payload.data.lastName,
        email: payload.data.email,
        skills: payload.data.skills
      },
      engine: payload.engine,
      model: payload.model,
      latencyMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      ok: false,
      transportOk: false,
      qualityOk: false,
      latencyMs: Date.now() - startedAt,
      timeout: /abort|timeout/i.test(error.message),
      rateLimited: /429|rate.?limit/i.test(error.message),
      error: error.message
    };
  }
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

async function benchmarkLevel(model, concurrency, rounds, phase) {
  await setConcurrency(model, concurrency);
  const startedAt = Date.now();
  const results = [];
  for (let round = 0; round < rounds; round += 1) {
    results.push(...await Promise.all(
      Array.from(
        { length: concurrency },
        (_, index) => analyze(`${model}-${phase}-${concurrency}-${round}-${index}`)
      )
    ));
  }
  const elapsedMs = Date.now() - startedAt;
  const latencies = results.filter((result) => result.transportOk).map((result) => result.latencyMs);
  const successful = results.filter((result) => result.ok).length;
  const run = {
    phase,
    concurrency,
    rounds,
    requests: results.length,
    successful,
    failed: results.length - successful,
    transportSuccessful: results.filter((result) => result.transportOk).length,
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    throughputPerMinute: Number((successful / (elapsedMs / 60_000)).toFixed(2)),
    elapsedMs,
    stable: results.every((result) => result.transportOk),
    qualityPassed: results.every((result) => result.qualityOk),
    timeouts: results.filter((result) => result.timeout).length,
    rateLimited: results.filter((result) => result.rateLimited).length,
    outOfMemory: results.filter((result) => /out.?of.?memory|oom/i.test(result.error || '')).length,
    results
  };
  run.qualityPassRate = run.requests ? run.successful / run.requests : 0;
  run.acceptable = run.stable
    && run.qualityPassRate >= 0.95
    && run.p95LatencyMs != null
    && run.p95LatencyMs <= maxP95LatencyMs;
  return run;
}

async function benchmarkModel(model) {
  await manage('select-engine', 'codex', model);
  const activationCap = approvalFor('codex', model).concurrency;
  const safeLevels = levels.filter((level) => level <= activationCap);
  if (!safeLevels.length) {
    throw new Error(
      `None of the requested benchmark levels are within the sustained approval cap ${activationCap} `
      + `for codex/${model}`
    );
  }
  const runs = [];
  for (const concurrency of safeLevels) {
    const rounds = requestedRounds || (concurrency <= 8 ? 2 : 1);
    const run = await benchmarkLevel(model, concurrency, rounds, 'discovery');
    runs.push(run);
    if (!run.acceptable) break;
  }
  let maxAcceptableConcurrency = 0;
  for (const run of runs) {
    if (!run.acceptable) break;
    maxAcceptableConcurrency = run.concurrency;
  }
  const candidateConcurrency = selectHeadroomConcurrency(runs);
  const requiredRounds = candidateConcurrency
    ? Math.max(sustainedRounds, Math.ceil(minimumSustainedRequests / candidateConcurrency))
    : 0;
  const sustainedRun = candidateConcurrency
    ? await benchmarkLevel(model, candidateConcurrency, requiredRounds, 'sustained')
    : null;
  const approval = decideApprovedConcurrency({
    discoveryRuns: runs,
    sustainedRun,
    acceptance: {
      minimumRequests: minimumSustainedRequests,
      minimumQualityPassRate: minimumSustainedQualityPassRate,
      maxP95LatencyMs
    }
  });
  return {
    model,
    activationCap,
    skippedUnapprovedLevels: levels.filter((level) => level > activationCap),
    supportedInApi: Boolean(catalog.models.find((item) => item.id === model)?.supportedInApi),
    passed: approval.sustainedValidated,
    sustainedValidated: approval.sustainedValidated,
    approvedConcurrency: approval.concurrency,
    candidateConcurrency: approval.candidateConcurrency,
    maxTestedStableConcurrency: maxAcceptableConcurrency,
    firstUnacceptableConcurrency: runs.find((run) => !run.acceptable)?.concurrency || null,
    sustainedRun,
    runs
  };
}

async function main() {
  const original = await (await controlFetch(`${gatewayUrl}/control/status`)).json();
  const catalogModels = catalog.models.map((model) => model.id);
  const models = requestedModels.length
    ? requestedModels.filter((model) => catalogModels.includes(model))
    : catalogModels;
  const report = {
    generatedAt: new Date().toISOString(),
    fixture: 'three-page A4 synthetic Ada Okafor CV using the Seemplify CV contract',
    fixturePages: pageCount,
    fixtureCharacters: threePageCvText.length,
    levels,
    rounds: requestedRounds || '2 through concurrency 8; 1 above 8',
    acceptance: {
      transportSuccessRate: 1,
      qualityPassRate: 0.95,
      sustainedQualityPassRate: minimumSustainedQualityPassRate,
      minimumSustainedRequests,
      headroom: 'one tested concurrency level below the highest acceptable discovery level',
      maxP95LatencyMs
    },
    models: []
  };
  let primaryError = null;
  try {
    for (const model of models) {
      process.stdout.write(`Testing ${model} at concurrency ${levels.join(', ')}...\n`);
      const result = await benchmarkModel(model);
      report.models.push(result);
      process.stdout.write(`${JSON.stringify({
        model,
        passed: result.passed,
        approvedConcurrency: result.approvedConcurrency,
        sustainedValidated: result.sustainedValidated,
        maxTestedStableConcurrency: result.maxTestedStableConcurrency,
        p95LatencyMs: result.sustainedRun?.p95LatencyMs
      })}\n`);
    }
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      await manage('select-engine', original.engine, original.model);
      await restoreControlState(original);
    } catch (restoreError) {
      if (!primaryError) throw restoreError;
      primaryError.restoreError = restoreError.message;
    }
  }
  if (primaryError) throw primaryError;
  report.passed = report.models.every((model) => model.passed);
  const reportFile = path.join(runtimeDir, 'codex-model-benchmark.json');
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  for (const model of report.models) {
    recordApproval({
      engine: 'codex',
      model: model.model,
      concurrency: model.approvedConcurrency,
      candidateConcurrency: model.candidateConcurrency,
      sustainedValidated: model.sustainedValidated,
      measuredAt: report.generatedAt,
      reportFile
    });
  }
  process.stdout.write(`${JSON.stringify({ passed: report.passed, reportFile })}\n`);
  if (!report.passed) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
