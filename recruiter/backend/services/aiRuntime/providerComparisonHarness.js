const { evaluateOutput, percentile } = require('./evaluationHarness');
const { calculateEstimatedCost, normalizeUsage, sanitizeMessage } = require('./usageService');

const DEFAULT_COMPARISON_THRESHOLDS = Object.freeze({
  minimumSuccessRatePercent: 95,
  minimumAverageQuality: 8,
  maximumQualityDropFromBaseline: 2,
  maximumP95LatencyMs: 120_000,
  maximumChatP95LatencyMs: 5_000,
  maximumLatencyCoefficientOfVariation: 1,
  maximumP95ToP50Ratio: 3
});
const DEFAULT_LOCKED_LOCAL_ACTIVITIES = Object.freeze([
  'candidate.cv_parse',
  'ai_interview.cv_parse'
]);

function round(value, digits = 2) {
  const multiplier = 10 ** digits;
  return Math.round((Number(value) || 0) * multiplier) / multiplier;
}

function isGroundingFailure(message) {
  return /not grounded|missing supplied|supplied .* evidence|invent|unsupported/i.test(String(message || ''));
}

function isHallucinationFailure(message) {
  return /invent|unsupported|forbidden|protected-characteristic/i.test(String(message || ''));
}

function normalizeBenchmarkUsage(usage = {}) {
  const normalized = normalizeUsage(usage);
  return {
    ...normalized,
    outputTokensPerSecond: 0
  };
}

function evaluateBenchmarkResponse({
  fixture,
  provider,
  model,
  run,
  response,
  latencyMs,
  pricing,
  pricingKnown = true,
  quota
}) {
  const evaluation = evaluateOutput(fixture, response);
  const usage = normalizeBenchmarkUsage(response?.usage || {});
  usage.outputTokensPerSecond = latencyMs > 0
    ? round(usage.outputTokens / (latencyMs / 1000), 3)
    : 0;
  const groundingFailures = evaluation.qualityFailures.filter(isGroundingFailure);
  const hallucinationFailures = [
    ...evaluation.policyFailures,
    ...evaluation.qualityFailures.filter(isHallucinationFailure)
  ];
  const unmetered = usage.totalTokens <= 0;

  return {
    fixture: fixture.id,
    activity: fixture.activity,
    provider,
    model,
    run,
    success: true,
    schemaValid: evaluation.validation.valid,
    schemaErrors: evaluation.validation.errors,
    schemaRepairAttempted: Boolean(response?.schemaRepairAttempted),
    qualityScore: round(evaluation.qualityScore, 3),
    groundingPass: groundingFailures.length === 0,
    groundingFailures: [...new Set(groundingFailures)],
    hallucinationPass: hallucinationFailures.length === 0,
    hallucinationFailures: [...new Set(hallucinationFailures)],
    policyFailures: evaluation.policyFailures,
    qualityFailures: evaluation.qualityFailures,
    baselineQualityScore: Number(fixture.azureBaselineScore || 0),
    latencyMs: Math.max(0, Number(latencyMs) || 0),
    usage,
    meteringStatus: unmetered ? 'unmetered' : 'recorded',
    unmetered,
    quota: quota || null,
    pricingStatus: pricingKnown ? 'estimated' : 'unpriced',
    estimatedCostUsd: pricingKnown ? calculateEstimatedCost(usage, pricing) : null
  };
}

function benchmarkErrorResult({ fixture, provider, model, run, latencyMs, error, pricing, pricingKnown = true }) {
  const usage = normalizeBenchmarkUsage(error?.usage || {});
  return {
    fixture: fixture.id,
    activity: fixture.activity,
    provider,
    model,
    run,
    success: false,
    schemaValid: false,
    schemaErrors: [],
    schemaRepairAttempted: Boolean(error?.schemaRepairAttempted),
    qualityScore: 0,
    groundingPass: false,
    groundingFailures: [],
    hallucinationPass: true,
    hallucinationFailures: [],
    policyFailures: [],
    qualityFailures: [],
    baselineQualityScore: Number(fixture.azureBaselineScore || 0),
    latencyMs: Math.max(0, Number(latencyMs) || 0),
    usage,
    meteringStatus: usage.totalTokens > 0 ? 'recorded' : 'unavailable',
    unmetered: false,
    quota: error?.quota || null,
    pricingStatus: pricingKnown ? 'estimated' : 'unpriced',
    estimatedCostUsd: pricingKnown ? calculateEstimatedCost(usage, pricing) : null,
    providerAttempts: Math.max(1, Number(error?.providerAttempts || error?.providerCalls || 1)),
    error: {
      code: String(error?.code || 'BENCHMARK_PROVIDER_ERROR').slice(0, 100),
      message: sanitizeMessage(error?.message),
      status: Number(error?.status || error?.statusCode || 0) || null,
      retryable: Boolean(error?.retryable)
    }
  };
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length : 0;
}

function standardDeviation(values) {
  if (!values.length) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (Number(value || 0) - mean) ** 2)));
}

function summarizeResults(results = []) {
  const successful = results.filter((result) => result.success);
  const latency = successful.map((result) => result.latencyMs);
  const activityNames = [...new Set(results.map((result) => result.activity))];
  const byActivity = Object.fromEntries(activityNames.map((activity) => {
    const activityResults = results.filter((result) => result.activity === activity);
    return [activity, summarizeResultsFlat(activityResults)];
  }));
  return {
    ...summarizeResultsFlat(results),
    byActivity
  };
}

function summarizeResultsFlat(results = []) {
  const successful = results.filter((result) => result.success);
  const latency = successful.map((result) => result.latencyMs);
  const total = results.length;
  const latencyAverage = average(latency);
  const latencyP50 = percentile(latency, 50);
  const latencyP95 = percentile(latency, 95);
  const latencyDeviation = standardDeviation(latency);
  const baselineScores = successful
    .map((result) => Number(result.baselineQualityScore || 0))
    .filter((value) => value > 0);
  const averageQuality = average(successful.map((result) => result.qualityScore));
  const averageBaselineQuality = average(baselineScores);
  return {
    runs: total,
    successes: successful.length,
    errors: total - successful.length,
    successRatePercent: round(total ? successful.length / total * 100 : 0),
    schemaValidityPercent: round(successful.length
      ? successful.filter((result) => result.schemaValid).length / successful.length * 100
      : 0),
    groundingPassPercent: round(successful.length
      ? successful.filter((result) => result.groundingPass).length / successful.length * 100
      : 0),
    hallucinationFailures: successful.reduce(
      (sum, result) => sum + result.hallucinationFailures.length,
      0
    ),
    unmeteredSuccesses: successful.filter((result) => result.unmetered || result.meteringStatus === 'unmetered').length,
    meteredSuccesses: successful.filter((result) => !(result.unmetered || result.meteringStatus === 'unmetered')).length,
    distinctFixtures: new Set(results.map((result) => result.fixture)).size,
    averageQuality: round(averageQuality, 3),
    averageBaselineQuality: round(averageBaselineQuality, 3),
    qualityDeltaFromBaseline: round(averageQuality - averageBaselineQuality, 3),
    latencyMs: {
      average: round(latencyAverage),
      p50: latencyP50,
      p95: latencyP95,
      standardDeviation: round(latencyDeviation),
      coefficientOfVariation: round(latencyAverage > 0 ? latencyDeviation / latencyAverage : 0, 3),
      p95ToP50Ratio: round(latencyP50 > 0 ? latencyP95 / latencyP50 : 0, 3)
    },
    tokens: {
      input: results.reduce((sum, result) => sum + result.usage.inputTokens, 0),
      cachedInput: results.reduce((sum, result) => sum + result.usage.cachedInputTokens, 0),
      output: results.reduce((sum, result) => sum + result.usage.outputTokens, 0),
      reasoning: results.reduce((sum, result) => sum + result.usage.reasoningTokens, 0),
      total: results.reduce((sum, result) => sum + result.usage.totalTokens, 0),
      averageOutputPerSecond: round(average(
        successful.map((result) => result.usage.outputTokensPerSecond)
      ), 3)
    },
    unpricedResults: results.filter((result) => result.pricingStatus === 'unpriced').length,
    estimatedCostUsd: round(results.reduce(
      (sum, result) => sum + Number(result.estimatedCostUsd || 0),
      0
    ), 8)
  };
}

function eligibilityFailures(summary, thresholds = {}) {
  const effective = { ...DEFAULT_COMPARISON_THRESHOLDS, ...thresholds };
  const failures = [];
  if (!summary || summary.runs <= 0) failures.push('no benchmark samples');
  if (Number(summary?.successRatePercent || 0) < effective.minimumSuccessRatePercent) failures.push('success rate below threshold');
  if (Number(summary?.schemaValidityPercent || 0) !== 100) failures.push('schema validity below 100%');
  if (Number(summary?.groundingPassPercent || 0) !== 100) failures.push('grounding below 100%');
  if (Number(summary?.hallucinationFailures || 0) !== 0) failures.push('hallucination or policy failures');
  if (Number(summary?.unmeteredSuccesses || 0) !== 0) failures.push('successful requests have no token metering');
  if (Number(summary?.averageQuality || 0) < effective.minimumAverageQuality) failures.push('average quality below threshold');
  if (
    Number(summary?.averageBaselineQuality || 0) > 0
    && Number(summary?.qualityDeltaFromBaseline || 0) < -effective.maximumQualityDropFromBaseline
  ) failures.push('quality is too far below the fixture baseline');
  if (Number(summary?.latencyMs?.p95 || 0) > effective.maximumP95LatencyMs) failures.push('p95 latency above threshold');
  if (
    Number(summary?.latencyMs?.coefficientOfVariation || 0)
    > effective.maximumLatencyCoefficientOfVariation
  ) failures.push('latency variance above threshold');
  if (Number(summary?.latencyMs?.p95ToP50Ratio || 0) > effective.maximumP95ToP50Ratio) failures.push('p95/p50 latency ratio above threshold');
  return failures;
}

function providerIsEligible(summary, thresholds) {
  return eligibilityFailures(summary, thresholds).length === 0;
}

function activityThresholds(activity, thresholds = {}) {
  const effective = { ...DEFAULT_COMPARISON_THRESHOLDS, ...thresholds };
  return {
    ...effective,
    maximumP95LatencyMs: String(activity).startsWith('ai_interview.chat.')
      ? effective.maximumChatP95LatencyMs
      : effective.maximumP95LatencyMs
  };
}

function compareActivity(activity, providerReports, options = {}) {
  const thresholds = activityThresholds(activity, options.thresholds);
  const candidates = providerReports.map((report) => ({
    provider: report.provider,
    model: report.activityModels?.[activity] || report.model,
    summary: report.summary.byActivity[activity],
    eligibilityFailures: eligibilityFailures(report.summary.byActivity[activity], thresholds)
  })).filter((candidate) => candidate.summary?.runs);
  const lockedActivities = new Set(options.lockedActivities || DEFAULT_LOCKED_LOCAL_ACTIVITIES);
  if (lockedActivities.has(activity)) {
    return {
      activity,
      recommendation: 'local_only_policy_lock',
      confidence: 'policy-enforced',
      reason: 'This activity is locked to managed local inference; benchmark evidence cannot recommend Groq.',
      evidence: candidates
    };
  }
  const eligible = candidates.filter((candidate) => candidate.eligibilityFailures.length === 0);
  if (!eligible.length) {
    return {
      activity,
      recommendation: 'no_provider_passed_quality_gates',
      evidence: candidates
    };
  }
  eligible.sort((left, right) => {
    const qualityDifference = right.summary.averageQuality - left.summary.averageQuality;
    if (Math.abs(qualityDifference) >= 0.25) return qualityDifference;
    const p95Difference = left.summary.latencyMs.p95 - right.summary.latencyMs.p95;
    if (Math.abs(p95Difference) >= 250) return p95Difference;
    return left.summary.latencyMs.p50 - right.summary.latencyMs.p50;
  });
  const winner = eligible[0];
  const runCount = Math.min(...eligible.map((candidate) => candidate.summary.runs));
  const distinctFixtureCount = Math.min(...eligible.map((candidate) => candidate.summary.distinctFixtures));
  return {
    activity,
    recommendation: `${winner.provider}:${winner.model}`,
    reason: eligible.length === 1
      ? 'Only this provider passed the reliability, schema, grounding, and hallucination gates.'
      : Math.abs(eligible[0].summary.averageQuality - eligible[1].summary.averageQuality) >= 0.25
        ? 'Higher grounded quality after both providers passed safety gates.'
        : 'Comparable grounded quality with lower tail latency.',
    confidence: runCount >= 3 && distinctFixtureCount >= 3 ? 'benchmark-supported' : 'directional-only',
    evidence: candidates
  };
}

function resultKey(result) {
  return `${result.fixture}:${result.run}`;
}

function compareKeySets(left, right) {
  return left.size === right.size && [...left].every((key) => right.has(key));
}

function validatePairedCoverage(providerReports = [], expectedResults = []) {
  if (providerReports.length !== 2) {
    return { complete: false, reason: 'Exactly two live provider reports are required.' };
  }
  const configHashes = providerReports
    .map((report) => report.benchmarkConfigSha256)
    .filter(Boolean);
  if (configHashes.length && (
    configHashes.length !== providerReports.length
    || new Set(configHashes).size !== 1
  )) {
    return { complete: false, reason: 'Provider reports do not share one benchmarkConfigSha256.' };
  }
  const providerSets = [];
  const activityMaps = [];
  for (const report of providerReports) {
    const keys = new Set();
    const activities = new Map();
    for (const result of report.results || []) {
      const key = resultKey(result);
      if (keys.has(key)) {
        return { complete: false, reason: `${report.provider} contains duplicate result ${key}.` };
      }
      if (result.provider && result.provider !== report.provider) {
        return { complete: false, reason: `${report.provider} contains a result attributed to ${result.provider}.` };
      }
      keys.add(key);
      activities.set(key, result.activity);
    }
    providerSets.push(keys);
    activityMaps.push(activities);
  }
  if (!compareKeySets(providerSets[0], providerSets[1])) {
    return { complete: false, reason: 'Providers do not have exact paired fixture/run coverage.' };
  }
  if ([...providerSets[0]].some((key) => activityMaps[0].get(key) !== activityMaps[1].get(key))) {
    return { complete: false, reason: 'Paired fixture/run results disagree on activity.' };
  }
  if (expectedResults.length) {
    const expected = new Set(expectedResults.map((result) => typeof result === 'string' ? result : resultKey(result)));
    if (!compareKeySets(providerSets[0], expected)) {
      return { complete: false, reason: 'Provider coverage does not match the requested fixture/run matrix.' };
    }
  }
  return { complete: true, count: providerSets[0].size };
}

function compareProviderReports(providerReports = [], options = {}) {
  const pairedCoverage = validatePairedCoverage(providerReports, options.expectedResults);
  if (!pairedCoverage.complete) {
    return {
      activities: [],
      pairedCoverage,
      advisoryOnly: true,
      caveat: pairedCoverage.reason
    };
  }
  const activities = [...new Set(providerReports.flatMap(
    (report) => Object.keys(report.summary?.byActivity || {})
  ))];
  const recommendations = activities.map((activity) => compareActivity(activity, providerReports, options));
  return {
    activities: recommendations,
    pairedCoverage,
    advisoryOnly: true,
    caveat: recommendations.some((item) => item.confidence === 'directional-only')
      ? 'Repeated runs of one prompt are directional. At least three distinct paired fixtures per activity are required for benchmark-supported recommendations.'
      : null
  };
}

async function runProvidersSequentially({ providers, runProvider, onProviderComplete }) {
  const reports = [];
  let activeProviders = 0;
  for (const provider of providers) {
    activeProviders += 1;
    if (activeProviders !== 1) throw new Error('Provider benchmark overlap detected');
    try {
      const report = await runProvider(provider);
      reports.push(report);
      if (onProviderComplete) await onProviderComplete(report);
    } finally {
      activeProviders -= 1;
    }
  }
  return reports;
}

module.exports = {
  DEFAULT_COMPARISON_THRESHOLDS,
  DEFAULT_LOCKED_LOCAL_ACTIVITIES,
  benchmarkErrorResult,
  compareProviderReports,
  eligibilityFailures,
  evaluateBenchmarkResponse,
  normalizeBenchmarkUsage,
  providerIsEligible,
  runProvidersSequentially,
  summarizeResults,
  validatePairedCoverage
};
