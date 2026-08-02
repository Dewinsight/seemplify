function assessInterviewScore(value, questions = []) {
  const issues = [];
  if (!value || typeof value !== 'object') return { passed: false, issues: ['Scoring response is missing.'] };

  const overallScore = Number(value.overallScore);
  if (!Number.isFinite(overallScore) || overallScore < 0 || overallScore > 100) issues.push('Overall score must be between 0 and 100.');
  if (String(value.summary || '').trim().length < 40) issues.push('Scoring summary must explain the evidence in at least 40 characters.');
  if (!Array.isArray(value.strengths)) issues.push('Scoring strengths must be an array.');
  if (!Array.isArray(value.concerns)) issues.push('Scoring concerns must be an array.');

  const scores = Array.isArray(value.questionScores) ? value.questionScores : [];
  if (scores.length !== questions.length) issues.push('Scoring must return exactly one result per interview question.');
  const indexes = scores.map((item) => Number(item?.questionIndex));
  if (new Set(indexes).size !== indexes.length) issues.push('Scoring contains duplicate question indexes.');
  questions.forEach((question, index) => {
    const item = scores.find((score) => Number(score?.questionIndex) === index);
    if (!item) {
      issues.push(`Question ${index + 1} has no score.`);
      return;
    }
    const score = Number(item.score);
    if (!Number.isFinite(score) || score < 1 || score > 5) issues.push(`Question ${index + 1} score must be between 1 and 5.`);
    if (String(item.rationale || '').trim().length < 20) issues.push(`Question ${index + 1} rationale is too shallow.`);
    const unavailable = !String(question?.answer || '').trim() || ['skipped', 'timed_out', 'timeout'].includes(String(question?.status || '').toLowerCase());
    if (unavailable && score > 2) issues.push(`Question ${index + 1} gives an unsupported score to a missing answer.`);
  });

  if (scores.length && scores.every((item) => Number.isFinite(Number(item?.score)))) {
    const normalizedAverage = scores.reduce((sum, item) => sum + ((Number(item.score) - 1) / 4) * 100, 0) / scores.length;
    if (Number.isFinite(overallScore) && Math.abs(overallScore - normalizedAverage) > 25) {
      issues.push('Overall score is inconsistent with the per-question scores.');
    }
  }

  const noAnsweredQuestions = questions.length > 0 && questions.every((question) => !String(question?.answer || '').trim());
  if (noAnsweredQuestions && Number.isFinite(overallScore) && overallScore > 25) issues.push('An interview with no answers cannot receive a passing overall score.');
  if (noAnsweredQuestions && Array.isArray(value.strengths) && value.strengths.length) issues.push('An interview with no answers cannot contain evidence-based strengths.');

  const recommendation = String(value.recommendation || '');
  if (!['strong_yes', 'yes', 'maybe', 'no'].includes(recommendation)) issues.push('Scoring recommendation is invalid.');
  if (recommendation === 'strong_yes' && overallScore < 65) issues.push('Strong-yes recommendation conflicts with the overall score.');
  if (recommendation === 'no' && overallScore > 70) issues.push('No recommendation conflicts with the overall score.');

  return { passed: issues.length === 0, issues: [...new Set(issues)] };
}

function assertInterviewScoreQuality(value, questions) {
  const assessment = assessInterviewScore(value, questions);
  if (assessment.passed) return assessment;
  const error = new Error(`Interview scoring failed semantic quality checks: ${assessment.issues.join(' ')}`);
  error.code = 'AI_SCORE_QUALITY_FAILED';
  error.statusCode = 503;
  throw error;
}

module.exports = { assessInterviewScore, assertInterviewScoreQuality };
