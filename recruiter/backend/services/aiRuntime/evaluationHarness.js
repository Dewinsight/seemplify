const { validateJsonSchema } = require('./jsonSchemaValidator');

function percentile(values, target) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil((target / 100) * sorted.length) - 1));
  return sorted[index];
}

function parseResultData(result) {
  if (result?.data && typeof result.data === 'object') return result.data;
  try { return JSON.parse(String(result?.content || '')); } catch { return null; }
}

function evaluateOutput(fixture, result) {
  const data = parseResultData(result);
  const validation = data === null
    ? { valid: false, errors: ['$: response is not valid JSON'] }
    : validateJsonSchema(data, fixture.schema);
  const searchable = JSON.stringify(data || '').toLowerCase();
  const expected = fixture.expectedKeywords || [];
  const grounded = expected.filter((keyword) => searchable.includes(String(keyword).toLowerCase())).length;
  const qualityScore = expected.length ? (grounded / expected.length) * 10 : 10;
  const policyFailures = (fixture.forbiddenPhrases || []).filter((phrase) => searchable.includes(String(phrase).toLowerCase()));
  return { data, validation, qualityScore, policyFailures };
}

async function runGoldenEvaluations({ fixtures, complete, models, runs = 3 }) {
  const results = [];
  for (const fixture of fixtures) {
    for (const model of models) {
      for (let run = 1; run <= runs; run += 1) {
        const startedAt = Date.now();
        try {
          const response = await complete({ fixture, model, run });
          const evaluated = evaluateOutput(fixture, response);
          results.push({
            fixture: fixture.id,
            activity: fixture.activity,
            model,
            run,
            success: true,
            schemaValid: evaluated.validation.valid,
            schemaRepairAttempted: Boolean(response.schemaRepairAttempted),
            qualityScore: evaluated.qualityScore,
            policyFailures: evaluated.policyFailures,
            latencyMs: Number(response.latencyMs ?? Date.now() - startedAt),
            totalTokens: Number(response.usage?.totalTokens ?? response.usage?.total_tokens ?? 0),
            estimatedCostUsd: Number(response.estimatedCostUsd || 0)
          });
        } catch (error) {
          results.push({ fixture: fixture.id, activity: fixture.activity, model, run, success: false, schemaValid: false, policyFailures: [], latencyMs: Date.now() - startedAt, errorCode: error.code || 'EVALUATION_ERROR' });
        }
      }
    }
  }

  const successes = results.filter((item) => item.success);
  const schemaValid = successes.filter((item) => item.schemaValid);
  const criticalFailures = results.flatMap((item) => item.policyFailures || []);
  const averageQuality = successes.length ? successes.reduce((sum, item) => sum + item.qualityScore, 0) / successes.length : 0;
  const baseline = fixtures.length ? fixtures.reduce((sum, item) => sum + Number(item.azureBaselineScore || 0), 0) / fixtures.length : 0;
  const chatLatencies = successes.filter((item) => item.activity.startsWith('ai_interview.chat.')).map((item) => item.latencyMs);
  const errorRate = results.length ? ((results.length - successes.length) / results.length) * 100 : 100;
  const summary = {
    runs: results.length,
    schemaValidityPercent: successes.length ? (schemaValid.length / successes.length) * 100 : 0,
    criticalPolicyFailures: criticalFailures.length,
    averageQuality: Number(averageQuality.toFixed(2)),
    azureBaselineAverage: Number(baseline.toFixed(2)),
    liveChatP95Ms: percentile(chatLatencies, 95),
    errorRatePercent: Number(errorRate.toFixed(2)),
    totalTokens: successes.reduce((sum, item) => sum + Number(item.totalTokens || 0), 0),
    estimatedCostUsd: Number(successes.reduce((sum, item) => sum + Number(item.estimatedCostUsd || 0), 0).toFixed(6))
  };
  return {
    results,
    summary,
    gates: {
      schemaValidity: summary.schemaValidityPercent === 100,
      criticalPolicySafety: summary.criticalPolicyFailures === 0,
      qualityWithinTwoPoints: summary.averageQuality >= summary.azureBaselineAverage - 2,
      liveChatLatency: !chatLatencies.length || summary.liveChatP95Ms < 3000,
      errorRate: summary.errorRatePercent < 1
    }
  };
}

module.exports = { evaluateOutput, parseResultData, percentile, runGoldenEvaluations };
