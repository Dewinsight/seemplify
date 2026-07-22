const { validateJsonSchema } = require('./jsonSchemaValidator');
const { assessQuestionSet } = require('../interviewQuestionQualityService');

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

function findEmptyRequiredContent(value, path = '$') {
  if (typeof value === 'string') return value.trim() ? [] : [`${path} is empty`];
  if (Array.isArray(value)) return value.flatMap((item, index) => findEmptyRequiredContent(item, `${path}[${index}]`));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, item]) => findEmptyRequiredContent(item, `${path}.${key}`));
}

function evaluateDomainQuality(fixture, data) {
  const failures = findEmptyRequiredContent(data);
  let score = failures.length ? Math.max(0, 1 - failures.length * 0.15) : 1;
  if (fixture.qualityEvaluator === 'interview_questions') {
    const assessment = assessQuestionSet(data?.questions, fixture.qualityContext || {});
    score = assessment.score;
    failures.push(...assessment.issues);
  }
  if (fixture.qualityEvaluator === 'matching') {
    if (!Array.isArray(data?.evidence) || !data.evidence.length) failures.push('Matching result has no grounded evidence.');
    if (!Number.isFinite(data?.score)) failures.push('Matching result has no numeric score.');
  }
  if (fixture.qualityEvaluator === 'scoring') {
    if (!Array.isArray(data?.evidence) || !data.evidence.length) failures.push('Scoring result has no supporting evidence.');
    if (String(data?.summary || '').length < 20) failures.push('Scoring summary is too shallow.');
  }
  if (fixture.qualityEvaluator === 'bias') {
    if (!Number.isFinite(data?.overallBiasScore)) failures.push('Bias score is missing.');
    if (String(data?.recommendation || '').length < 15) failures.push('Bias recommendation is not actionable.');
  }
  if (failures.length && fixture.qualityEvaluator !== 'interview_questions') score = Math.max(0, 1 - failures.length * 0.2);
  return { score: Math.max(0, Math.min(1, score)), failures: [...new Set(failures)] };
}

function evaluateOutput(fixture, result) {
  const data = parseResultData(result);
  const validation = data === null
    ? { valid: false, errors: ['$: response is not valid JSON'] }
    : validateJsonSchema(data, fixture.schema);
  const searchable = JSON.stringify(data || '').toLowerCase();
  const expected = fixture.expectedKeywords || [];
  const grounded = expected.filter((keyword) => searchable.includes(String(keyword).toLowerCase())).length;
  const keywordScore = expected.length ? grounded / expected.length : 1;
  const domainQuality = evaluateDomainQuality(fixture, data);
  const qualityScore = ((keywordScore * 0.45) + (domainQuality.score * 0.55)) * 10;
  const policyFailures = (fixture.forbiddenPhrases || []).filter((phrase) => searchable.includes(String(phrase).toLowerCase()));
  return { data, validation, qualityScore, policyFailures, qualityFailures: domainQuality.failures };
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
            qualityFailures: evaluated.qualityFailures,
            latencyMs: Number(response.latencyMs ?? Date.now() - startedAt),
            totalTokens: Number(response.usage?.totalTokens ?? response.usage?.total_tokens ?? 0),
            estimatedCostUsd: Number(response.estimatedCostUsd || 0)
          });
        } catch (error) {
          results.push({ fixture: fixture.id, activity: fixture.activity, model, run, success: false, schemaValid: false, policyFailures: [], qualityFailures: [], latencyMs: Date.now() - startedAt, errorCode: error.code || 'EVALUATION_ERROR' });
        }
      }
    }
  }

  const successes = results.filter((item) => item.success);
  const schemaValid = successes.filter((item) => item.schemaValid);
  const criticalFailures = results.flatMap((item) => item.policyFailures || []);
  const semanticFailures = results.flatMap((item) => item.qualityFailures || []);
  const averageQuality = successes.length ? successes.reduce((sum, item) => sum + item.qualityScore, 0) / successes.length : 0;
  const baseline = fixtures.length ? fixtures.reduce((sum, item) => sum + Number(item.azureBaselineScore || 0), 0) / fixtures.length : 0;
  const chatLatencies = successes.filter((item) => item.activity.startsWith('ai_interview.chat.')).map((item) => item.latencyMs);
  const errorRate = results.length ? ((results.length - successes.length) / results.length) * 100 : 100;
  const summary = {
    runs: results.length,
    schemaValidityPercent: successes.length ? (schemaValid.length / successes.length) * 100 : 0,
    criticalPolicyFailures: criticalFailures.length,
    semanticQualityFailures: semanticFailures.length,
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
      semanticQuality: summary.semanticQualityFailures === 0,
      qualityWithinTwoPoints: summary.averageQuality >= summary.azureBaselineAverage - 2,
      liveChatLatency: !chatLatencies.length || summary.liveChatP95Ms < 3000,
      errorRate: summary.errorRatePercent < 1
    }
  };
}

module.exports = { evaluateDomainQuality, evaluateOutput, findEmptyRequiredContent, parseResultData, percentile, runGoldenEvaluations };
