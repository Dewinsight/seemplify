const { evaluateOutput, percentile } = require('./evaluationHarness');
const { calculateEstimatedCost, normalizeUsage, sanitizeMessage } = require('./usageService');

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
    latencyMs: Math.max(0, Number(latencyMs) || 0),
    usage,
    quota: quota || null,
    estimatedCostUsd: calculateEstimatedCost(usage, pricing)
  };
}

function benchmarkErrorResult({ fixture, provider, model, run, latencyMs, error }) {
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
    latencyMs: Math.max(0, Number(latencyMs) || 0),
    usage: normalizeBenchmarkUsage(),
    quota: error?.quota || null,
    estimatedCostUsd: 0,
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
    averageQuality: round(average(successful.map((result) => result.qualityScore)), 3),
    latencyMs: {
      average: round(average(latency)),
      p50: percentile(latency, 50),
      p95: percentile(latency, 95)
    },
    tokens: {
      input: successful.reduce((sum, result) => sum + result.usage.inputTokens, 0),
      cachedInput: successful.reduce((sum, result) => sum + result.usage.cachedInputTokens, 0),
      output: successful.reduce((sum, result) => sum + result.usage.outputTokens, 0),
      reasoning: successful.reduce((sum, result) => sum + result.usage.reasoningTokens, 0),
      total: successful.reduce((sum, result) => sum + result.usage.totalTokens, 0),
      averageOutputPerSecond: round(average(
        successful.map((result) => result.usage.outputTokensPerSecond)
      ), 3)
    },
    estimatedCostUsd: round(successful.reduce(
      (sum, result) => sum + result.estimatedCostUsd,
      0
    ), 8)
  };
}

function providerIsEligible(summary) {
  return summary.runs > 0
    && summary.successRatePercent >= 95
    && summary.schemaValidityPercent === 100
    && summary.groundingPassPercent === 100
    && summary.hallucinationFailures === 0;
}

function compareActivity(activity, providerReports) {
  const candidates = providerReports.map((report) => ({
    provider: report.provider,
    model: report.activityModels?.[activity] || report.model,
    summary: report.summary.byActivity[activity]
  })).filter((candidate) => candidate.summary?.runs);
  const eligible = candidates.filter((candidate) => providerIsEligible(candidate.summary));
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
    return left.summary.latencyMs.p50 - right.summary.latencyMs.p50;
  });
  const winner = eligible[0];
  const runCount = Math.min(...eligible.map((candidate) => candidate.summary.runs));
  return {
    activity,
    recommendation: `${winner.provider}:${winner.model}`,
    reason: eligible.length === 1
      ? 'Only this provider passed the reliability, schema, grounding, and hallucination gates.'
      : Math.abs(eligible[0].summary.averageQuality - eligible[1].summary.averageQuality) >= 0.25
        ? 'Higher grounded quality after both providers passed safety gates.'
        : 'Comparable grounded quality with lower median latency.',
    confidence: runCount >= 3 ? 'benchmark-supported' : 'directional-only',
    evidence: candidates
  };
}

function compareProviderReports(providerReports = []) {
  const activities = [...new Set(providerReports.flatMap(
    (report) => Object.keys(report.summary?.byActivity || {})
  ))];
  return {
    activities: activities.map((activity) => compareActivity(activity, providerReports)),
    caveat: providerReports.some((report) => report.summary.runs < 3)
      ? 'At least one provider has fewer than three samples; recommendations are directional.'
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
  benchmarkErrorResult,
  compareProviderReports,
  evaluateBenchmarkResponse,
  normalizeBenchmarkUsage,
  providerIsEligible,
  runProvidersSequentially,
  summarizeResults
};
