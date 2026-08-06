const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  benchmarkErrorResult,
  compareProviderReports,
  eligibilityFailures,
  evaluateBenchmarkResponse,
  providerIsEligible,
  runProvidersSequentially,
  summarizeResults,
  validatePairedCoverage
} = require('../services/aiRuntime/providerComparisonHarness');
const {
  DailyQuotaWaitError,
  GroqQuotaGovernor,
  atomicJson,
  executeWithRetry,
  loadResumeResults,
  providerReport,
  structuredCompletion
} = require('../../../tools/local-llm/compare-runtime-providers.cjs');

const fixture = {
  id: 'salary',
  activity: 'job.normalize',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['min', 'max', 'currency', 'period'],
    properties: {
      min: { type: 'integer' },
      max: { type: 'integer' },
      currency: { type: 'string' },
      period: { type: 'string' }
    }
  },
  expectedKeywords: ['75000', '90000', 'GBP', 'annually'],
  qualityEvaluator: 'salary_normalization'
};

test('provider benchmark records quality, schema, token speed, and cost without raw secrets', () => {
  const result = evaluateBenchmarkResponse({
    fixture,
    provider: 'groq',
    model: 'openai/gpt-oss-20b',
    run: 1,
    response: {
      data: { min: 75000, max: 90000, currency: 'GBP', period: 'annually' },
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        prompt_tokens_details: { cached_tokens: 20 }
      }
    },
    latencyMs: 2000,
    pricing: {
      inputPerMillionUsd: 1,
      cachedInputPerMillionUsd: 0.5,
      outputPerMillionUsd: 2
    }
  });

  assert.equal(result.schemaValid, true);
  assert.equal(result.groundingPass, true);
  assert.equal(result.hallucinationPass, true);
  assert.equal(result.qualityScore, 10);
  assert.equal(result.usage.outputTokensPerSecond, 25);
  assert.equal(result.estimatedCostUsd, 0.00019);
});

test('provider errors redact Groq credentials', () => {
  const result = benchmarkErrorResult({
    fixture,
    provider: 'groq',
    model: 'openai/gpt-oss-20b',
    run: 1,
    latencyMs: 10,
    error: new Error('Bearer gsk_super_secret_key must not be shown')
  });
  assert.doesNotMatch(result.error.message, /gsk_/);
  assert.match(result.error.message, /REDACTED/);
});

test('provider execution is strictly sequential', async () => {
  let active = 0;
  let maximumActive = 0;
  const order = [];
  const reports = await runProvidersSequentially({
    providers: ['terra', 'groq'],
    runProvider: async (provider) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      order.push(`start:${provider}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(`end:${provider}`);
      active -= 1;
      return { provider };
    }
  });
  assert.equal(maximumActive, 1);
  assert.deepEqual(order, ['start:terra', 'end:terra', 'start:groq', 'end:groq']);
  assert.deepEqual(reports.map((report) => report.provider), ['terra', 'groq']);
});

test('comparison applies quality gates before latency', () => {
  const valid = evaluateBenchmarkResponse({
    fixture,
    provider: 'local-codex',
    model: 'gpt-5.6-terra',
    run: 1,
    response: {
      data: { min: 75000, max: 90000, currency: 'GBP', period: 'annually' },
      usage: { total_tokens: 100 }
    },
    latencyMs: 5000,
    pricing: {}
  });
  const invalid = benchmarkErrorResult({
    fixture,
    provider: 'groq',
    model: 'openai/gpt-oss-20b',
    run: 1,
    latencyMs: 100,
    error: new Error('quota')
  });
  const localReport = {
    provider: 'local-codex',
    model: 'gpt-5.6-terra',
    results: [valid],
    summary: summarizeResults([valid])
  };
  const groqReport = {
    provider: 'groq',
    model: 'openai/gpt-oss-20b',
    results: [invalid],
    summary: summarizeResults([invalid])
  };

  const comparison = compareProviderReports([localReport, groqReport], {
    expectedResults: [{ fixture: fixture.id, run: 1 }]
  });
  assert.equal(comparison.activities[0].recommendation, 'local-codex:gpt-5.6-terra');
  assert.equal(comparison.activities[0].confidence, 'directional-only');
});

test('successful calls without token usage are flagged and cannot pass recommendation gates', () => {
  const unmetered = evaluateBenchmarkResponse({
    fixture,
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    run: 1,
    response: {
      data: { min: 75000, max: 90000, currency: 'GBP', period: 'annually' },
      usage: {}
    },
    latencyMs: 100,
    pricing: {}
  });
  const summary = summarizeResults([unmetered]);
  assert.equal(unmetered.meteringStatus, 'unmetered');
  assert.equal(summary.unmeteredSuccesses, 1);
  assert.equal(providerIsEligible(summary), false);
  assert.ok(eligibilityFailures(summary).some((failure) => /token metering/i.test(failure)));
});

test('unknown Terra local-cloud pricing is reported as unpriced instead of zero cost', () => {
  const result = evaluateBenchmarkResponse({
    fixture,
    provider: 'local-codex',
    model: 'gpt-5.6-terra',
    run: 1,
    response: {
      data: { min: 75000, max: 90000, currency: 'GBP', period: 'annually' },
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
    },
    latencyMs: 100,
    pricing: null,
    pricingKnown: false
  });
  assert.equal(result.pricingStatus, 'unpriced');
  assert.equal(result.estimatedCostUsd, null);
  assert.equal(summarizeResults([result]).unpricedResults, 1);
});

test('terminal schema failures retain usage and cost from every provider call', async () => {
  const structuredFixture = {
    ...fixture,
    messages: [{ role: 'user', content: 'Return an integer value.' }],
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['value'],
      properties: { value: { type: 'integer' } }
    },
    expectedKeywords: []
  };
  let calls = 0;
  let terminal;
  try {
    await structuredCompletion({
      fixture: structuredFixture,
      route: {},
      complete: async () => {
        calls += 1;
        return {
          content: '{"value":"invalid"}',
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          quota: { tokenRemainingMinute: 7000 }
        };
      }
    });
  } catch (error) {
    terminal = error;
  }
  assert.equal(calls, 2);
  assert.equal(terminal.code, 'AI_SCHEMA_VALIDATION_FAILED');
  assert.equal(terminal.usage.totalTokens, 30);
  assert.equal(terminal.providerCalls, 2);

  const result = benchmarkErrorResult({
    fixture: structuredFixture,
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    run: 1,
    latencyMs: 20,
    error: terminal,
    pricing: { inputPerMillionUsd: 1, outputPerMillionUsd: 2 }
  });
  const summary = summarizeResults([result]);
  assert.equal(result.usage.inputTokens, 20);
  assert.equal(result.usage.outputTokens, 10);
  assert.equal(result.estimatedCostUsd, 0.00004);
  assert.equal(summary.tokens.total, 30);
  assert.equal(summary.estimatedCostUsd, 0.00004);
});

test('paired coverage rejects missing and duplicate fixture/run evidence', () => {
  const result = { fixture: 'salary', activity: 'job.normalize', run: 1 };
  assert.equal(validatePairedCoverage([
    { provider: 'local-codex', results: [result] },
    { provider: 'groq', results: [] }
  ]).complete, false);
  assert.match(validatePairedCoverage([
    { provider: 'local-codex', results: [result, result] },
    { provider: 'groq', results: [result] }
  ]).reason, /duplicate/i);
  assert.equal(validatePairedCoverage([
    { provider: 'local-codex', results: [result] },
    { provider: 'groq', results: [result] }
  ], [{ fixture: 'salary', run: 1 }]).complete, true);
  assert.match(validatePairedCoverage([
    { provider: 'local-codex', benchmarkConfigSha256: 'config-a', results: [result] },
    { provider: 'groq', benchmarkConfigSha256: 'config-b', results: [result] }
  ]).reason, /benchmarkConfigSha256/);
});

test('locked CV activities can never produce a Groq route recommendation', () => {
  const cvFixture = { ...fixture, id: 'cv', activity: 'candidate.cv_parse' };
  const make = (provider, model, latencyMs) => evaluateBenchmarkResponse({
    fixture: cvFixture,
    provider,
    model,
    run: 1,
    response: {
      data: { min: 75000, max: 90000, currency: 'GBP', period: 'annually' },
      usage: { total_tokens: 100 }
    },
    latencyMs,
    pricing: {}
  });
  const local = make('local-codex', 'gpt-5.6-terra', 5000);
  const groq = make('groq', 'openai/gpt-oss-120b', 10);
  const comparison = compareProviderReports([
    {
      provider: 'local-codex',
      model: 'gpt-5.6-terra',
      results: [local],
      summary: summarizeResults([local])
    },
    {
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      results: [groq],
      summary: summarizeResults([groq])
    }
  ], {
    expectedResults: [{ fixture: 'cv', run: 1 }],
    lockedActivities: ['candidate.cv_parse']
  });
  assert.equal(comparison.activities[0].recommendation, 'local_only_policy_lock');
  assert.equal(comparison.activities[0].confidence, 'policy-enforced');
});

test('three repeated runs of one fixture remain directional evidence', () => {
  const makeResults = (provider, model, latencyMs) => [1, 2, 3].map((run) => evaluateBenchmarkResponse({
    fixture,
    provider,
    model,
    run,
    response: {
      data: { min: 75000, max: 90000, currency: 'GBP', period: 'annually' },
      usage: { total_tokens: 100 }
    },
    latencyMs,
    pricing: {}
  }));
  const local = makeResults('local-codex', 'gpt-5.6-terra', 500);
  const groq = makeResults('groq', 'openai/gpt-oss-120b', 250);
  const comparison = compareProviderReports([
    {
      provider: 'local-codex',
      model: 'gpt-5.6-terra',
      results: local,
      summary: summarizeResults(local)
    },
    {
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      results: groq,
      summary: summarizeResults(groq)
    }
  ], {
    expectedResults: [1, 2, 3].map((run) => ({ fixture: fixture.id, run }))
  });
  assert.equal(comparison.activities[0].confidence, 'directional-only');
  assert.match(comparison.caveat, /three distinct paired fixtures/i);
});

test('quality, p95 and latency variance are hard eligibility gates', () => {
  const summary = {
    runs: 3,
    successRatePercent: 100,
    schemaValidityPercent: 100,
    groundingPassPercent: 100,
    hallucinationFailures: 0,
    unmeteredSuccesses: 0,
    averageQuality: 7.9,
    averageBaselineQuality: 9,
    qualityDeltaFromBaseline: -1.1,
    latencyMs: { p95: 130000, coefficientOfVariation: 1.2, p95ToP50Ratio: 4 }
  };
  const failures = eligibilityFailures(summary);
  assert.ok(failures.some((failure) => /average quality/i.test(failure)));
  assert.ok(failures.some((failure) => /p95 latency/i.test(failure)));
  assert.ok(failures.some((failure) => /variance/i.test(failure)));
  assert.ok(failures.some((failure) => /p95\/p50/i.test(failure)));
});

test('quota governor persists reservations, reconciles actual usage, and waits for daily reset', async (context) => {
  const reportRoot = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    '.local-runtime',
    'llm',
    'reports',
    'provider-comparison'
  );
  fs.mkdirSync(reportRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(reportRoot, 'quota-test-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'ledger.json');
  let nowMs = Date.parse('2026-07-24T12:00:00.000Z');
  const governor = new GroqQuotaGovernor({
    file,
    limits: { tpm: 100, tpd: 150, rpm: 2, rpd: 2, inputHeadroomPercent: 0 },
    now: () => nowMs,
    sleep: async (milliseconds) => { nowMs += milliseconds; }
  });
  const first = await governor.reserve({ estimatedInputTokens: 10, maxOutputTokens: 50 });
  governor.reconcile(first, { totalTokens: 40, metered: true });
  const second = await governor.reserve({ estimatedInputTokens: 10, maxOutputTokens: 50 });
  governor.reconcile(second, { totalTokens: 30, metered: true });
  assert.equal(governor.snapshot().dayTokens, 70);
  assert.equal(governor.snapshot().dayRequests, 2);
  await assert.rejects(
    governor.reserve({ estimatedInputTokens: 1, maxOutputTokens: 1 }),
    (error) => error instanceof DailyQuotaWaitError && error.resumable === true
  );
  const restored = new GroqQuotaGovernor({
    file,
    limits: { tpm: 100, tpd: 150, rpm: 2, rpd: 2, inputHeadroomPercent: 0 },
    now: () => nowMs,
    sleep: async () => {}
  });
  assert.equal(restored.snapshot().dayTokens, 70);
  assert.equal(restored.snapshot().dayRequests, 2);
});

test('quota governor enforces one cross-process-style in-flight reservation', async (context) => {
  const reportRoot = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    '.local-runtime',
    'llm',
    'reports',
    'provider-comparison'
  );
  fs.mkdirSync(reportRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(reportRoot, 'quota-inflight-test-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let releaseWait;
  let waits = 0;
  const governor = new GroqQuotaGovernor({
    file: path.join(directory, 'ledger.json'),
    limits: { tpm: 100, tpd: 1000, rpm: 10, rpd: 10, inputHeadroomPercent: 0 },
    now: () => Date.parse('2026-07-24T12:00:00.000Z'),
    sleep: async () => {
      waits += 1;
      await new Promise((resolve) => { releaseWait = resolve; });
    }
  });
  const first = await governor.reserve({ estimatedInputTokens: 10, maxOutputTokens: 20 });
  const secondPromise = governor.reserve({ estimatedInputTokens: 10, maxOutputTokens: 20 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(waits, 1);
  governor.reconcile(first, { totalTokens: 15, metered: true });
  releaseWait();
  const second = await secondPromise;
  governor.reconcile(second, { totalTokens: 15, metered: true });
  assert.equal(governor.snapshot().dayRequests, 2);
});

test('daily quota waiting is a resumable outcome rather than a quality failure', () => {
  const report = providerReport({
    provider: 'groq',
    providerStartedAt: new Date().toISOString(),
    results: [],
    activityModels: {},
    benchmarkConfigSha256: 'config-a',
    outcome: {
      state: 'waiting_for_daily_quota',
      resumeAt: '2026-07-25T00:00:00.000Z'
    },
    governor: null
  });
  assert.equal(report.outcome.state, 'waiting_for_daily_quota');
  assert.equal(report.summary.runs, 0);
  assert.equal(report.summary.errors, 0);
  assert.equal(report.completedAt, null);
});

test('retry policy honors provider reset/retry-after and bounds retryable failures', async () => {
  let nowMs = Date.parse('2026-07-24T12:00:00.000Z');
  const sleeps = [];
  let attempts = 0;
  const completed = await executeWithRetry(async () => {
    attempts += 1;
    if (attempts === 1) {
      const error = new Error('rate limited');
      error.status = 429;
      error.retryable = true;
      error.quota = {
        retryAfterMs: 2000,
        tokenResetAt: new Date(nowMs + 3000)
      };
      throw error;
    }
    return 'ok';
  }, {
    maxAttempts: 3,
    baseDelayMs: 500,
    jitterMs: 0,
    now: () => nowMs,
    random: () => 0,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
      nowMs += milliseconds;
    }
  });
  assert.equal(completed.value, 'ok');
  assert.equal(completed.attempts, 2);
  assert.deepEqual(sleeps, [3000]);

  let failedAttempts = 0;
  await assert.rejects(executeWithRetry(async () => {
    failedAttempts += 1;
    const error = new Error('unavailable');
    error.status = 503;
    error.retryable = true;
    throw error;
  }, {
    maxAttempts: 3,
    baseDelayMs: 1,
    jitterMs: 0,
    sleep: async () => {}
  }), (error) => error.providerAttempts === 3);
  assert.equal(failedAttempts, 3);
});

test('quota governor honors provider token-reset headers before dispatch', async (context) => {
  const reportRoot = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    '.local-runtime',
    'llm',
    'reports',
    'provider-comparison'
  );
  fs.mkdirSync(reportRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(reportRoot, 'quota-reset-test-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let nowMs = Date.parse('2026-07-24T12:00:00.000Z');
  const sleeps = [];
  const governor = new GroqQuotaGovernor({
    file: path.join(directory, 'ledger.json'),
    limits: { tpm: 100, tpd: 1000, rpm: 10, rpd: 10, inputHeadroomPercent: 0 },
    now: () => nowMs,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
      nowMs += milliseconds;
    }
  });
  governor.observeQuota({
    requestLimitDaily: 1000,
    requestRemainingDaily: 100,
    tokenLimitMinute: 100,
    tokenRemainingMinute: 10,
    tokenResetAt: new Date(nowMs + 2000)
  });
  const reservation = await governor.reserve({ estimatedInputTokens: 10, maxOutputTokens: 20 });
  governor.reconcile(reservation, { totalTokens: 15, metered: true });
  assert.deepEqual(sleeps, [2025]);
  assert.equal(governor.snapshot().dayTokens, 15);
});

test('resume artifacts are config-bound and duplicate keys are rejected', (context) => {
  const root = path.resolve(__dirname, '..', '..', '..');
  const reportRoot = path.join(root, '.local-runtime', 'llm', 'reports', 'provider-comparison');
  fs.mkdirSync(reportRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(reportRoot, 'resume-test-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const result = {
    fixture: 'job-normalize-salary',
    activity: 'job.normalize',
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    run: 1,
    success: true
  };
  const first = path.join(directory, 'first.json');
  const second = path.join(directory, 'second.json');
  atomicJson(first, {
    runId: 'first',
    mode: 'live',
    provider: 'groq',
    benchmarkConfigSha256: 'config-a',
    results: [result]
  });
  atomicJson(second, {
    runId: 'second',
    mode: 'live',
    provider: 'groq',
    benchmarkConfigSha256: 'config-a',
    results: [result]
  });
  const relative = (file) => path.relative(root, file);
  assert.equal(loadResumeResults({
    inputs: [relative(first)],
    expectedConfigSha256: 'config-a',
    maximumRun: 1
  }).results.size, 1);
  assert.throws(() => loadResumeResults({
    inputs: [relative(first)],
    expectedConfigSha256: 'config-b',
    maximumRun: 1
  }), /benchmarkConfigSha256/);
  assert.throws(() => loadResumeResults({
    inputs: [relative(first), relative(second)],
    expectedConfigSha256: 'config-a',
    maximumRun: 1
  }), /duplicate resume result/i);
});

test('atomic checkpoint replacement leaves a complete latest result set', (context) => {
  const root = path.resolve(__dirname, '..', '..', '..');
  const reportRoot = path.join(root, '.local-runtime', 'llm', 'reports', 'provider-comparison');
  fs.mkdirSync(reportRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(reportRoot, 'atomic-checkpoint-test-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'groq.checkpoint.json');
  atomicJson(file, { results: [{ fixture: 'one', run: 1 }] });
  atomicJson(file, { results: [{ fixture: 'one', run: 1 }, { fixture: 'two', run: 1 }] });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).results.length, 2);
  assert.deepEqual(
    fs.readdirSync(directory).filter((name) => name.endsWith('.tmp')),
    []
  );
});
