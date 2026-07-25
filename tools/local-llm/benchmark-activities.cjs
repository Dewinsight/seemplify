const fs = require('node:fs');
const path = require('node:path');
const { controlFetch } = require('./control-auth.cjs');
const { analyzeWithEngine } = require('./engine-adapters.cjs');
const {
  recordActivityApproval,
  recordApproval
} = require('./approval-store.cjs');
const {
  approvedConcurrency,
  selectHeadroomConcurrency
} = require('./benchmark-approval.cjs');
const {
  ACTIVITY_DEFINITIONS
} = require('../../recruiter/backend/config/aiRuntimeCatalog');
const fixtures = require('../../recruiter/backend/tests/fixtures/aiRuntimeGoldenFixtures');
const {
  evaluateOutput
} = require('../../recruiter/backend/services/aiRuntime/evaluationHarness');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const runtimeDir = path.join(repositoryRoot, '.local-runtime', 'llm');
const gatewayUrl = process.env.LOCAL_LLM_GATEWAY_URL || 'http://127.0.0.1:11435';
const reportFile = path.join(runtimeDir, 'activity-concurrency-benchmark.json');
const lockFile = path.join(runtimeDir, 'activity-concurrency-benchmark.lock');
const defaultActivities = [
  'candidate.cv_parse',
  'ai_interview.cv_parse',
  'interview.questions',
  'ai_interview.question_generation'
];

function option(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.find((argument) => argument.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function integerOption(name, fallback, minimum, maximum) {
  const value = Number(option(name, fallback));
  if (!Number.isInteger(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, value));
}

function numericOption(name, fallback, minimum, maximum) {
  const value = Number(option(name, fallback));
  if (!Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, value));
}

const model = String(option('model', 'gpt-5.6-terra')).trim();
const levels = [...new Set(String(option('levels', '1,2,4,8,16,32,64,128'))
  .split(',')
  .map(Number)
  .filter((value) => Number.isInteger(value) && value >= 1 && value <= 128))]
  .sort((left, right) => left - right);
const requestedActivities = process.argv.includes('--all')
  ? Object.keys(ACTIVITY_DEFINITIONS)
  : String(option('activities', defaultActivities.join(',')))
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
const sustainedRounds = integerOption('sustained-rounds', 3, 1, 20);
const minimumSustainedRequests = integerOption('minimum-sustained-requests', 12, 4, 512);
const maxP95LatencyMs = integerOption('max-p95-ms', 180_000, 5_000, 600_000);
const requestTimeoutMs = integerOption('request-timeout-ms', 300_000, 10_000, 900_000);
const interLevelDelayMs = integerOption('inter-level-delay-ms', 2_000, 0, 60_000);
const minimumDiscoveryQualityPassRate = numericOption('minimum-quality-pass-rate', 0.95, 0, 1);
const minimumSustainedQualityPassRate = numericOption('minimum-sustained-quality-pass-rate', 0.98, 0, 1);

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write([
    'Usage: node tools/local-llm/benchmark-activities.cjs [options]',
    '',
    '  --activities=candidate.cv_parse,interview.questions',
    '  --all                              Test every catalog activity',
    '  --model=gpt-5.6-terra',
    '  --levels=1,2,4,8,16,32,64,128',
    '  --sustained-rounds=3',
    '  --minimum-sustained-requests=12',
    '  --max-p95-ms=180000',
    '  --request-timeout-ms=300000',
    '  --inter-level-delay-ms=2000',
    '',
    'The harness disables public ingress, tests the engine directly, checkpoints',
    'a PII-free report, and restores the original gateway state in a finally block.'
  ].join('\n') + '\n');
  process.exit(0);
}

function sleep(milliseconds) {
  if (!milliseconds) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
}

function classifyError(error) {
  const text = `${error?.code || ''} ${error?.status || ''} ${error?.message || ''}`;
  return {
    code: String(error?.code || 'BENCHMARK_REQUEST_FAILED').slice(0, 100),
    timeout: /abort|timeout|timed.?out/i.test(text),
    rateLimited: /429|rate.?limit|too many requests/i.test(text),
    outOfMemory: /out.?of.?memory|\boom\b|cuda.+memory/i.test(text)
  };
}

function fixturesByActivity(activities) {
  const grouped = new Map();
  for (const activity of activities) {
    if (!ACTIVITY_DEFINITIONS[activity]) throw new Error(`Unknown AI activity: ${activity}`);
    const matches = fixtures.filter((fixture) => fixture.activity === activity);
    if (!matches.length) throw new Error(`No golden fixture is available for ${activity}`);
    grouped.set(activity, matches);
  }
  return grouped;
}

function engineState() {
  return {
    selectedEngine: 'codex',
    engines: {
      codex: { model }
    }
  };
}

function requestForFixture(fixture) {
  const definition = ACTIVITY_DEFINITIONS[fixture.activity] || {};
  return {
    activity: fixture.activity,
    messages: fixture.messages,
    ...(fixture.schema ? {
      jsonSchema: fixture.schema,
      schemaName: `benchmark_${fixture.id}`.replace(/[^a-z0-9_-]/gi, '_').slice(0, 64),
      schemaStrict: !['candidate.cv_parse', 'ai_interview.cv_parse'].includes(fixture.activity)
    } : {}),
    temperature: 0,
    reasoningEffort: definition.reasoningEffort || 'medium',
    maxTokens: fixture.responseMode === 'text' ? 1_200 : 8_000,
    timeoutMs: requestTimeoutMs
  };
}

async function runRequest(fixture) {
  const startedAt = Date.now();
  try {
    const response = await analyzeWithEngine(requestForFixture(fixture), engineState());
    const evaluation = evaluateOutput(fixture, response);
    const minimumQualityScore = Math.max(7, Number(fixture.azureBaselineScore || 9) - 2);
    const qualityOk = evaluation.validation.valid
      && evaluation.policyFailures.length === 0
      && evaluation.qualityScore >= minimumQualityScore;
    return {
      transportOk: true,
      qualityOk,
      latencyMs: Date.now() - startedAt,
      schemaValid: evaluation.validation.valid,
      qualityScore: Number(evaluation.qualityScore.toFixed(2)),
      policyFailures: evaluation.policyFailures.length,
      semanticFailures: evaluation.qualityFailures.length,
      validationErrors: evaluation.validation.errors.slice(0, 5),
      qualityFailureMessages: evaluation.qualityFailures.slice(0, 5),
      policyFailureMessages: evaluation.policyFailures.slice(0, 5),
      usageReported: response.usageReported === true,
      totalTokens: Number(response.usage?.total_tokens || 0),
      timeout: false,
      rateLimited: false,
      outOfMemory: false
    };
  } catch (error) {
    return {
      transportOk: false,
      qualityOk: false,
      latencyMs: Date.now() - startedAt,
      schemaValid: false,
      qualityScore: 0,
      policyFailures: 0,
      semanticFailures: 0,
      validationErrors: [],
      qualityFailureMessages: [],
      policyFailureMessages: [],
      usageReported: false,
      totalTokens: 0,
      ...classifyError(error)
    };
  }
}

async function runLevel({ name, workloadFixtures, concurrency, rounds, phase }) {
  const requests = concurrency * rounds;
  const startedAt = Date.now();
  let cursor = 0;
  const results = [];
  for (let round = 0; round < rounds; round += 1) {
    const batch = Array.from({ length: concurrency }, () => {
      const fixture = workloadFixtures[cursor % workloadFixtures.length];
      cursor += 1;
      return runRequest(fixture);
    });
    results.push(...await Promise.all(batch));
  }
  const elapsedMs = Date.now() - startedAt;
  const transported = results.filter((result) => result.transportOk);
  const qualityPassed = results.filter((result) => result.transportOk && result.qualityOk);
  const latencies = transported.map((result) => result.latencyMs);
  const transportSuccessRate = requests ? transported.length / requests : 0;
  const qualityPassRate = transported.length ? qualityPassed.length / transported.length : 0;
  const run = {
    name,
    phase,
    concurrency,
    rounds,
    requests,
    transportSuccessful: transported.length,
    qualitySuccessful: qualityPassed.length,
    transportSuccessRate,
    qualityPassRate,
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    throughputPerMinute: elapsedMs
      ? Number((qualityPassed.length / (elapsedMs / 60_000)).toFixed(2))
      : 0,
    elapsedMs,
    timeouts: results.filter((result) => result.timeout).length,
    rateLimited: results.filter((result) => result.rateLimited).length,
    outOfMemory: results.filter((result) => result.outOfMemory).length,
    schemaInvalid: results.filter((result) => result.transportOk && !result.schemaValid).length,
    malformedOrLowQuality: results.filter((result) => result.transportOk && !result.qualityOk).length,
    usageUnreported: results.filter((result) => result.transportOk && !result.usageReported).length,
    totalTokens: results.reduce((sum, result) => sum + result.totalTokens, 0),
    errorCodes: [...new Set(results.map((result) => result.code).filter(Boolean))],
    qualityDiagnostics: {
      validationErrors: [...new Set(results.flatMap((result) => result.validationErrors || []))].slice(0, 10),
      qualityFailures: [...new Set(results.flatMap((result) => result.qualityFailureMessages || []))].slice(0, 10),
      policyFailures: [...new Set(results.flatMap((result) => result.policyFailureMessages || []))].slice(0, 10),
      minimumScore: transported.length
        ? Math.min(...transported.map((result) => result.qualityScore))
        : 0
    }
  };
  run.stable = run.transportSuccessRate === 1
    && run.timeouts === 0
    && run.rateLimited === 0
    && run.outOfMemory === 0;
  run.acceptable = run.stable
    && run.qualityPassRate >= (phase === 'sustained'
      ? minimumSustainedQualityPassRate
      : minimumDiscoveryQualityPassRate)
    && run.p95LatencyMs !== null
    && run.p95LatencyMs <= maxP95LatencyMs;
  return run;
}

function checkpoint(report) {
  fs.mkdirSync(runtimeDir, { recursive: true });
  const temporary = `${reportFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(report, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, reportFile);
}

async function benchmarkWorkload(name, workloadFixtures, report) {
  const runs = [];
  report.inProgress = { name, phase: 'discovery', runs };
  checkpoint(report);
  for (const concurrency of levels) {
    process.stdout.write(`[${name}] discovery concurrency ${concurrency}\n`);
    const run = await runLevel({
      name,
      workloadFixtures,
      concurrency,
      rounds: 1,
      phase: 'discovery'
    });
    runs.push(run);
    report.inProgress = { name, phase: 'discovery', runs };
    checkpoint(report);
    process.stdout.write(`${JSON.stringify({
      name,
      concurrency,
      acceptable: run.acceptable,
      transportSuccessRate: run.transportSuccessRate,
      qualityPassRate: run.qualityPassRate,
      p95LatencyMs: run.p95LatencyMs,
      rateLimited: run.rateLimited
    })}\n`);
    if (!run.acceptable) break;
    await sleep(interLevelDelayMs);
  }
  const candidateConcurrency = selectHeadroomConcurrency(runs);
  const requiredRounds = candidateConcurrency
    ? Math.max(sustainedRounds, Math.ceil(minimumSustainedRequests / candidateConcurrency))
    : 0;
  const sustainedRun = candidateConcurrency
    ? await runLevel({
        name,
        workloadFixtures,
        concurrency: candidateConcurrency,
        rounds: requiredRounds,
        phase: 'sustained'
      })
    : null;
  report.inProgress = { name, phase: 'sustained', runs, sustainedRun };
  checkpoint(report);
  const approval = approvedConcurrency({
    discoveryRuns: runs,
    sustainedRun,
    acceptance: {
      minimumRequests: minimumSustainedRequests,
      minimumQualityPassRate: minimumSustainedQualityPassRate,
      maxP95LatencyMs
    }
  });
  const result = {
    name,
    passed: approval.sustainedValidated,
    approvedConcurrency: approval.concurrency,
    candidateConcurrency: approval.candidateConcurrency,
    maxTestedStableConcurrency: runs.filter((run) => run.acceptable).at(-1)?.concurrency || 0,
    firstUnacceptableConcurrency: runs.find((run) => !run.acceptable)?.concurrency || null,
    sustainedValidated: approval.sustainedValidated,
    sustainedRun,
    runs
  };
  delete report.inProgress;
  return result;
}

async function setBenchmarkIsolation(original) {
  const response = await controlFetch(`${gatewayUrl}/control/state`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ingressEnabled: false,
      paused: true
    })
  });
  if (!response.ok) throw new Error(`Could not isolate the gateway for benchmarking (${response.status})`);
  return original;
}

async function restoreGateway(original) {
  const response = await controlFetch(`${gatewayUrl}/control/state`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      enabled: original.state?.enabled !== false,
      ingressEnabled: original.state?.ingressEnabled !== false,
      paused: original.state?.paused === true,
      autoStart: original.state?.autoStart !== false
    })
  });
  if (!response.ok) throw new Error(`Could not restore the gateway state (${response.status})`);
}

async function main() {
  if (!levels.length) throw new Error('At least one concurrency level is required');
  const grouped = fixturesByActivity(requestedActivities);
  fs.mkdirSync(runtimeDir, { recursive: true });
  let lockHandle;
  try {
    lockHandle = fs.openSync(lockFile, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Another activity benchmark is already running');
    throw error;
  }
  let original;
  const report = {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    completedAt: null,
    engine: 'codex',
    model,
    activities: requestedActivities,
    levels,
    acceptance: {
      discoveryTransportSuccessRate: 1,
      discoveryQualityPassRate: minimumDiscoveryQualityPassRate,
      sustainedTransportSuccessRate: 1,
      sustainedQualityPassRate: minimumSustainedQualityPassRate,
      minimumSustainedRequests,
      maxP95LatencyMs,
      headroom: 'one tested level below the highest acceptable discovery level'
    },
    mixed: null,
    byActivity: {},
    passed: false
  };
  checkpoint(report);
  let primaryError;
  try {
    const statusResponse = await controlFetch(`${gatewayUrl}/control/status`);
    if (!statusResponse.ok) throw new Error(`Gateway status returned ${statusResponse.status}`);
    original = await statusResponse.json();
    await setBenchmarkIsolation(original);
    for (const activity of requestedActivities) {
      report.byActivity[activity] = await benchmarkWorkload(activity, grouped.get(activity), report);
      checkpoint(report);
    }
    const mixedFixtures = requestedActivities.flatMap((activity) => grouped.get(activity));
    report.mixed = await benchmarkWorkload('mixed', mixedFixtures, report);
    checkpoint(report);
    recordApproval({
      engine: 'codex',
      model,
      concurrency: report.mixed.approvedConcurrency,
      candidateConcurrency: report.mixed.candidateConcurrency,
      sustainedValidated: report.mixed.sustainedValidated,
      measuredAt: new Date().toISOString(),
      reportFile
    });
    for (const activity of requestedActivities) {
      const result = report.byActivity[activity];
      recordActivityApproval({
        engine: 'codex',
        model,
        activity,
        concurrency: result.approvedConcurrency,
        candidateConcurrency: result.candidateConcurrency,
        sustainedValidated: result.sustainedValidated && report.mixed.sustainedValidated,
        measuredAt: new Date().toISOString(),
        reportFile
      });
    }
    checkpoint(report);
    report.passed = requestedActivities.every((activity) => (
      report.byActivity[activity]?.sustainedValidated === true
    )) && report.mixed.sustainedValidated === true;
  } catch (error) {
    primaryError = error;
    report.error = {
      code: error.code || 'ACTIVITY_BENCHMARK_FAILED',
      message: error.message
    };
  } finally {
    report.completedAt = new Date().toISOString();
    checkpoint(report);
    if (original) {
      try {
        await restoreGateway(original);
      } catch (restoreError) {
        report.restoreError = restoreError.message;
        checkpoint(report);
        if (!primaryError) primaryError = restoreError;
      }
    }
    try { fs.closeSync(lockHandle); } catch {}
    try { fs.rmSync(lockFile, { force: true }); } catch {}
  }
  process.stdout.write(`${JSON.stringify({
    passed: report.passed,
    reportFile,
    globalConcurrency: report.mixed?.approvedConcurrency || 1,
    activityConcurrency: Object.fromEntries(
      Object.entries(report.byActivity).map(([activity, result]) => [
        activity,
        result.approvedConcurrency
      ])
    )
  })}\n`);
  if (primaryError) throw primaryError;
  if (!report.passed) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  classifyError,
  fixturesByActivity,
  percentile,
  requestForFixture
};
