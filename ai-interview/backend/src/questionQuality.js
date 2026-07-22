const GENERIC_PATTERNS = [
  /describe your approach to solving complex technical problems/i,
  /how do you stay current with new technolog(?:y|ies)/i,
  /tell me about a time when you had to work with a difficult team member/i,
  /describe your experience with the key skills required for this role/i
];

const STOP_WORDS = new Set(['about', 'and', 'are', 'for', 'from', 'have', 'job', 'role', 'that', 'the', 'this', 'what', 'when', 'which', 'with', 'would', 'your']);

function words(value) {
  return new Set((String(value || '').toLowerCase().match(/[a-z0-9+#.-]{3,}/g) || []).filter((word) => !STOP_WORDS.has(word)));
}

function similarity(left, right) {
  const a = words(left);
  const b = words(right);
  if (!a.size || !b.size) return 0;
  const common = [...a].filter((word) => b.has(word)).length;
  return common / new Set([...a, ...b]).size;
}

function jobWords(job = {}) {
  const values = [job.title, job.department, job.level, job.skills, job.description, job.requirements, job.responsibilities];
  return words(values.flat(Infinity).filter(Boolean).join(' '));
}

function assessGeneratedQuestions(questions, { job = {}, expectedCount, typePlan = [], difficulty = 'medium' } = {}) {
  const items = Array.isArray(questions) ? questions : [];
  const context = jobWords(job);
  const issues = [];
  const results = items.map((question, index) => {
    const questionText = String(question?.question || '').trim();
    const answer = String(question?.expectedAnswer || '').trim();
    const overlap = [...words(questionText)].filter((word) => context.has(word));
    const criteria = Array.isArray(question?.scoringCriteria) ? question.scoringCriteria : [];
    const followUps = Array.isArray(question?.followUpQuestions) ? question.followUpQuestions : [];
    const tags = Array.isArray(question?.tags) ? question.tags.filter(Boolean) : [];
    const failures = [];
    if (GENERIC_PATTERNS.some((pattern) => pattern.test(questionText))) failures.push('uses a stock generic question');
    if (questionText.length < 35) failures.push('question is too short or underspecified');
    if (context.size && !overlap.length) failures.push('does not reference a job skill or responsibility');
    if (answer.length < 80) failures.push('expected answer lacks detailed scoring guidance');
    if (criteria.length < 3) failures.push('needs at least three scoring criteria');
    const totalWeight = criteria.reduce((sum, criterion) => sum + (Number(criterion?.weight) || 0), 0);
    if (criteria.length && Math.abs(totalWeight - 100) > 1) failures.push('scoring weights must total 100');
    if (!followUps.length) failures.push('needs a useful follow-up');
    if (tags.length < 2) failures.push('needs two role-relevant tags');
    if (typePlan[index] && question?.type !== typePlan[index]) failures.push(`must use ${typePlan[index]} type`);
    if (question?.difficulty !== difficulty) failures.push(`must use ${difficulty} difficulty`);
    if (difficulty === 'hard' && !/(ambigu|constraint|failure|incident|risk|scale|trade-?off|uncertain)/i.test(questionText)) {
      failures.push('hard question needs ambiguity, risk, scale, failure, or trade-offs');
    }
    const score = Math.max(0, Math.min(1, 1 - failures.length * 0.14));
    if (failures.length) issues.push(`Question ${index + 1}: ${failures.join('; ')}.`);
    return { passed: failures.length === 0, score, issues: failures, matchedJobSignals: overlap.slice(0, 8) };
  });

  if (items.length !== expectedCount) issues.push(`Return exactly ${expectedCount} questions; received ${items.length}.`);
  for (let left = 0; left < items.length; left += 1) {
    for (let right = left + 1; right < items.length; right += 1) {
      if (similarity(items[left]?.question, items[right]?.question) >= 0.72) {
        issues.push(`Questions ${left + 1} and ${right + 1} are too similar.`);
      }
    }
  }
  const score = results.length ? results.reduce((sum, result) => sum + result.score, 0) / results.length : 0;
  return {
    passed: items.length === expectedCount && !issues.length && results.every((result) => result.passed),
    score: Math.round(score * 100) / 100,
    issues: [...new Set(issues)],
    questions: results
  };
}

function repairInstructions(assessment) {
  return `\n\nThe previous output failed the semantic quality gate. Discard it and create a new set that fixes every issue:\n${assessment.issues.map((issue, index) => `${index + 1}. ${issue}`).join('\n')}\nReturn only the required JSON object.`;
}

module.exports = { assessGeneratedQuestions, repairInstructions, similarity };
