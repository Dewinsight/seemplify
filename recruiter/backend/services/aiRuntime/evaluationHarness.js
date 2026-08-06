const { validateJsonSchema } = require('./jsonSchemaValidator');
const { assessQuestionSet } = require('../interviewQuestionQualityService');
const {
  assessAcknowledgement,
  assessClarification,
  assessIntroduction
} = require('../aiInterviewerResponseQuality');

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

function normalizedText(value) {
  return typeof value === 'string' ? value.trim() : JSON.stringify(value || '');
}

function normalizedSearchText(value) {
  return normalizedText(value).toLowerCase().replace(/[^a-z0-9%+.#]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function includesText(value, expected) {
  return normalizedSearchText(value).includes(normalizedSearchText(expected));
}

function pushMissingKeywords(failures, value, keywords = [], label = 'Response') {
  for (const keyword of keywords) {
    const alternatives = Array.isArray(keyword) ? keyword : [keyword];
    if (!alternatives.some((alternative) => includesText(value, alternative))) {
      failures.push(`${label} is not grounded in supplied ${alternatives[0]} evidence.`);
    }
  }
}

function findUnsupportedEvidenceClaims(value) {
  const text = String(value || '');
  const failures = [];
  if (/\b(?:according to|survey|study|report|research|data (?:show|shows|suggest)|companies (?:using|that|maintaining)|organizations (?:with|that)|firms (?:using|that))\b/i.test(text)) {
    failures.push('Response presents external evidence that was not supplied in the benchmark prompt.');
  }
  if (/\([^)]*(?:19|20)\d{2}[^)]*\)/i.test(text)) {
    failures.push('Response includes an unsupported dated citation or attribution.');
  }
  if (/\b(?:cut|cuts|reduce(?:d|s)?|lower(?:ed|s)?|improve(?:d|s)?|faster|shave(?:d|s)?|trim(?:med|s)?)\b[^.!?\n]{0,80}\b\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?\s*(?:%|days?|weeks?)(?![a-z0-9_])/i.test(text)) {
    failures.push('Response invents a precise outcome that was not supplied in the benchmark prompt.');
  }
  return failures;
}

function evaluateDomainQuality(fixture, data) {
  const failures = fixture.qualityEvaluator ? [] : findEmptyRequiredContent(data);
  let score = failures.length ? Math.max(0, 1 - failures.length * 0.15) : 1;
  if (fixture.qualityEvaluator === 'grounded_text') {
    pushMissingKeywords(failures, data, fixture.qualityContext?.requiredFacts, 'Response');
    const wordCount = String(data || '').trim().split(/\s+/).filter(Boolean).length;
    if (fixture.qualityContext?.maxWords && wordCount > fixture.qualityContext.maxWords) {
      failures.push(`Response exceeds the ${fixture.qualityContext.maxWords}-word limit.`);
    }
    if (fixture.qualityContext?.rejectUnsupportedEvidence) {
      failures.push(...findUnsupportedEvidenceClaims(data));
    }
  }
  if (fixture.qualityEvaluator === 'cv_extraction') {
    pushMissingKeywords(failures, data, fixture.qualityContext?.requiredFacts, 'CV extraction');
    for (const missingFact of fixture.qualityContext?.knownMissingFacts || []) {
      const value = data?.[missingFact];
      if (value && !['n/a', 'unknown', 'not provided'].includes(String(value).trim().toLowerCase())) {
        failures.push(`CV extraction appears to invent the missing ${missingFact} field.`);
      }
    }
    if (!Array.isArray(data?.skills) || !data.skills.length) failures.push('CV extraction has no grounded skills.');
    if (!String(data?.summary || '').trim()) failures.push('CV extraction has no usable summary.');
  }
  if (fixture.qualityEvaluator === 'job_description') {
    const expectedCounts = fixture.qualityContext?.expectedCounts || {};
    for (const [field, count] of Object.entries(expectedCounts)) {
      if (!Array.isArray(data?.[field]) || data[field].length !== count) {
        failures.push(`Job description must contain exactly ${count} ${field}.`);
      }
    }
    pushMissingKeywords(failures, data, fixture.qualityContext?.requiredFacts, 'Job description');
  }
  if (fixture.qualityEvaluator === 'job_requirements') {
    if (!Array.isArray(data?.requiredQualifications) || data.requiredQualifications.length < 2) failures.push('Required qualifications are incomplete.');
    if (!Array.isArray(data?.preferredQualifications) || !data.preferredQualifications.length) failures.push('Preferred qualifications are incomplete.');
    pushMissingKeywords(failures, data, fixture.qualityContext?.requiredFacts, 'Job requirements');
  }
  if (fixture.qualityEvaluator === 'salary_normalization') {
    if (!Number.isInteger(data?.min) || !Number.isInteger(data?.max) || data.min > data.max) failures.push('Salary bounds are invalid.');
    if (!/^[A-Z]{3}$/.test(String(data?.currency || ''))) failures.push('Salary currency is not a three-letter code.');
    if (!String(data?.period || '').trim()) failures.push('Salary period is missing.');
  }
  if (fixture.qualityEvaluator === 'interview_questions') {
    const assessment = assessQuestionSet(data?.questions, fixture.qualityContext || {});
    score = assessment.score;
    failures.push(...assessment.issues);
  }
  if (fixture.qualityEvaluator === 'matching') {
    const analyses = Array.isArray(data?.analysis) ? data.analysis : [];
    if (!analyses.length) failures.push('Matching result has no candidate analysis.');
    analyses.forEach((analysis, index) => {
      if (!String(analysis?.candidate_id || '').trim()) failures.push(`Matching candidate ${index + 1} has no stable identifier.`);
      if (!Number.isFinite(analysis?.skill_match_percentage)) failures.push(`Matching candidate ${index + 1} has no numeric skill score.`);
      if (!Array.isArray(analysis?.technical_strengths) || !analysis.technical_strengths.length) failures.push(`Matching candidate ${index + 1} has no grounded technical strengths.`);
      if (!Array.isArray(analysis?.interview_focus) || !analysis.interview_focus.length) failures.push(`Matching candidate ${index + 1} has no actionable interview focus.`);
      if (String(analysis?.contextual_explanation || '').length < 35) failures.push(`Matching candidate ${index + 1} has a shallow explanation.`);
      pushMissingKeywords(failures, analysis, fixture.qualityContext?.requiredFacts, `Matching candidate ${index + 1}`);
    });
  }
  if (fixture.qualityEvaluator === 'tool_selection') {
    const calls = Array.isArray(data?.toolCalls) ? data.toolCalls : [];
    const expectedTool = fixture.qualityContext?.expectedTool;
    if (!calls.length) failures.push('Tool selection returned no tool call.');
    if (expectedTool && !calls.some((call) => call?.name === expectedTool)) failures.push(`Tool selection did not choose ${expectedTool}.`);
    if (calls.some((call) => !call?.parameters || typeof call.parameters !== 'object')) failures.push('Tool selection returned invalid parameters.');
    if (!String(data?.message || '').trim()) failures.push('Tool selection returned no user-facing message.');
  }
  if (fixture.qualityEvaluator === 'memory_classification') {
    if (!['mixed', 'personality', 'chat'].includes(data?.type)) failures.push('Memory classification type is invalid.');
    const insights = [...(data?.personalityInsights || []), ...(data?.chatInsights || [])];
    if (!insights.length) failures.push('Memory classification returned no durable or chat insight.');
    pushMissingKeywords(failures, insights, fixture.qualityContext?.requiredFacts, 'Memory classification');
  }
  if (fixture.qualityEvaluator === 'job_extraction') {
    pushMissingKeywords(failures, data, fixture.qualityContext?.requiredFacts, 'Job extraction');
    if (!String(data?.title || '').trim()) failures.push('Job extraction has no title.');
  }
  if (fixture.qualityEvaluator === 'evidence_analysis') {
    pushMissingKeywords(failures, data, fixture.qualityContext?.requiredFacts, 'Analysis');
    if (normalizedText(data).length < Number(fixture.qualityContext?.minimumLength || 80)) failures.push('Analysis is too shallow.');
  }
  if (fixture.qualityEvaluator === 'scoring') {
    if (!Array.isArray(data?.questionScores) || !data.questionScores.length) failures.push('Scoring result has no per-question evidence.');
    if (data?.questionScores?.some((item) => !String(item?.rationale || '').trim())) failures.push('Scoring result has a question without rationale.');
    if (!Array.isArray(data?.strengths) || !data.strengths.length) failures.push('Scoring result has no grounded strengths.');
    if (String(data?.summary || '').length < 20) failures.push('Scoring summary is too shallow.');
    pushMissingKeywords(failures, data, fixture.qualityContext?.requiredFacts, 'Scoring result');
  }
  if (fixture.qualityEvaluator === 'bias') {
    const analyses = Array.isArray(data?.analyses) ? data.analyses : [data];
    if (!analyses.length) failures.push('Bias analyses are missing.');
    analyses.forEach((analysis, index) => {
      if (!Number.isFinite(analysis?.overallBiasScore)) failures.push(`Bias score ${index + 1} is missing.`);
      if (String(analysis?.recommendation || '').length < 15) failures.push(`Bias recommendation ${index + 1} is not actionable.`);
      if (analysis?.isBiased && !analysis?.detectedBiasFactors?.length) failures.push(`Bias analysis ${index + 1} identifies no factor.`);
      if (!analysis?.isBiased && Number(analysis?.overallBiasScore) >= 0.5) failures.push(`Bias analysis ${index + 1} has an inconsistent decision.`);
    });
  }
  if (fixture.qualityEvaluator === 'chat_introduction') {
    failures.push(...assessIntroduction(data, fixture.qualityContext?.question).issues);
  }
  if (fixture.qualityEvaluator === 'chat_clarification') {
    failures.push(...assessClarification(data, fixture.qualityContext || {}).issues);
  }
  if (fixture.qualityEvaluator === 'chat_acknowledgement') {
    failures.push(...assessAcknowledgement(data).issues);
  }
  if (failures.length && fixture.qualityEvaluator !== 'interview_questions') score = Math.max(0, 1 - failures.length * 0.2);
  return { score: Math.max(0, Math.min(1, score)), failures: [...new Set(failures)] };
}

function evaluateOutput(fixture, result) {
  const textMode = fixture.responseMode === 'text';
  const data = textMode
    ? String(result?.content ?? result?.data ?? '').trim()
    : parseResultData(result);
  const validation = textMode
    ? { valid: Boolean(data), errors: data ? [] : ['$: response is empty'] }
    : data === null
      ? { valid: false, errors: ['$: response is not valid JSON'] }
      : validateJsonSchema(data, fixture.schema);
  const searchable = (textMode ? String(data) : JSON.stringify(data || '')).toLowerCase();
  const expected = fixture.expectedKeywords || [];
  const grounded = expected.filter((keyword) => {
    const alternatives = Array.isArray(keyword) ? keyword : [keyword];
    return alternatives.some((alternative) => searchable.includes(String(alternative).toLowerCase()));
  }).length;
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
