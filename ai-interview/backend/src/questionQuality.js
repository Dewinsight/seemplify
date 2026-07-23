const GENERIC_PATTERNS = [
  /describe your approach to solving complex technical problems/i,
  /how do you stay current with new technolog(?:y|ies)/i,
  /tell me about a time when you had to work with a difficult team member/i,
  /describe a situation where you had to adapt to significant changes/i,
  /what type of work environment do you thrive in/i,
  /describe your experience with the key skills required for this role/i,
  /walk me through your career progression and key achievements/i
];

const GENERIC_EXPECTED_ANSWER_PATTERNS = [
  /look for (?:a )?systematic problem-solving methodology/i,
  /look for technical depth/i,
  /strong communication\.?(?:\s|$)/i,
  /candidate should demonstrate relevant experience/i,
  /assess (?:their|the candidate'?s) overall fit/i
];

const PROTECTED_TRAIT_PATTERNS = [
  /\b(?:how old|your age|date of birth|year (?:did you )?graduate)\b/i,
  /\b(?:married|marital status|children|pregnan|family plans?)\b/i,
  /\b(?:religion|religious|church|mosque|faith)\b/i,
  /\b(?:disabilit|medical condition|health condition)\b/i,
  /\b(?:nationality|country (?:were you )?born|native language|accent)\b/i,
  /\b(?:sexual orientation|gender identity|race(?!\s+conditions?\b)|ethnic(?:ity)?)\b/i
];

const STOP_WORDS = new Set([
  'about', 'after', 'also', 'and', 'are', 'been', 'being', 'can', 'could', 'for',
  'from', 'have', 'into', 'its', 'job', 'more', 'not', 'our', 'role', 'that', 'the',
  'their', 'then', 'this', 'through', 'using', 'what', 'when', 'where', 'which',
  'with', 'would', 'your', 'you', 'analyst', 'coordinator', 'developer', 'engineer',
  'lead', 'manager', 'senior', 'specialist'
]);

function cleanText(value) {
  if (Array.isArray(value)) return value.map(cleanText).join(' ');
  if (value && typeof value === 'object') return Object.values(value).map(cleanText).join(' ');
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function words(value) {
  return new Set((cleanText(value).toLowerCase().match(/[a-z0-9+#.-]{3,}/g) || [])
    .filter((word) => !STOP_WORDS.has(word)));
}

function intersection(left, right) {
  return [...left].filter((word) => right.has(word));
}

function similarity(left, right) {
  const a = words(left);
  const b = words(right);
  if (!a.size || !b.size) return 0;
  return intersection(a, b).length / new Set([...a, ...b]).size;
}

function splitSkills(value) {
  if (Array.isArray(value)) return value.flatMap(splitSkills);
  return String(value || '').split(/[,;|\n]/).map((item) => item.trim()).filter(Boolean);
}

function buildJobSignals(job = {}) {
  const strongSource = splitSkills(job.skills).filter(Boolean);
  const contextSource = [
    ...strongSource,
    job.level,
    job.description,
    job.requirements,
    job.responsibilities
  ].filter(Boolean);
  return { strong: words(strongSource), context: words(contextSource) };
}

function criteriaAreActionable(criteria) {
  return criteria.every((item) => {
    const weight = Number(item?.weight);
    return cleanText(item?.criterion).length >= 4
      && cleanText(item?.description).length >= 20
      && Number.isFinite(weight)
      && weight > 0;
  });
}

function criteriaAreDistinct(criteria) {
  for (let left = 0; left < criteria.length; left += 1) {
    for (let right = left + 1; right < criteria.length; right += 1) {
      if (similarity(criteria[left]?.criterion, criteria[right]?.criterion) >= 0.8) return false;
    }
  }
  return true;
}

function tagsAreGrounded(tags, questionText, jobSignals) {
  const jobTokens = new Set([...jobSignals.strong, ...jobSignals.context]);
  const allowed = jobTokens.size ? jobTokens : words(questionText);
  return tags.some((tag) => intersection(words(tag), allowed).length > 0);
}

function assessQuestion(question, { jobSignals, expectedType, difficulty }) {
  const questionText = cleanText(question?.question);
  const expectedAnswer = cleanText(question?.expectedAnswer);
  const criteria = Array.isArray(question?.scoringCriteria) ? question.scoringCriteria : [];
  const followUps = Array.isArray(question?.followUpQuestions) ? question.followUpQuestions : [];
  const tags = Array.isArray(question?.tags) ? question.tags.filter(Boolean) : [];
  const overlap = intersection(words(questionText), jobSignals.context);
  const strongOverlap = intersection(words(questionText), jobSignals.strong);
  const failures = [];

  if (GENERIC_PATTERNS.some((pattern) => pattern.test(questionText))) failures.push('uses a stock generic question');
  if (PROTECTED_TRAIT_PATTERNS.some((pattern) => pattern.test(questionText))) failures.push('mentions a protected characteristic or personal status');
  if (questionText.length < 35) failures.push('question is too short or underspecified');
  if (!/\?\s*$/.test(questionText)) failures.push('candidate-facing wording must end in a question mark');
  if (jobSignals.context.size && !strongOverlap.length && overlap.length < 2) failures.push('does not reference a concrete job skill or responsibility');
  if (expectedAnswer.length < 80) failures.push('expected answer lacks detailed scoring guidance');
  if (GENERIC_EXPECTED_ANSWER_PATTERNS.some((pattern) => pattern.test(expectedAnswer))) failures.push('expected answer is stock guidance');
  if (intersection(words(expectedAnswer), new Set([...words(questionText), ...jobSignals.context])).length < 2) failures.push('expected answer is not grounded in the question and job evidence');
  if (criteria.length < 3) failures.push('needs at least three scoring criteria');
  const totalWeight = criteria.reduce((sum, criterion) => sum + (Number(criterion?.weight) || 0), 0);
  if (criteria.length && Math.abs(totalWeight - 100) > 1) failures.push('scoring weights must total 100');
  if (criteria.length && !criteriaAreActionable(criteria)) failures.push('criteria need positive weights and concrete descriptions');
  if (criteria.length && !criteriaAreDistinct(criteria)) failures.push('criteria must be materially distinct');
  if (!followUps.length) failures.push('needs a useful follow-up');
  if (followUps.some((followUp) => cleanText(followUp?.question).length < 20 || cleanText(followUp?.condition).length < 10)) failures.push('follow-ups need specific wording and useful conditions');
  if (followUps.some((followUp) => similarity(questionText, followUp?.question) >= 0.8)) failures.push('follow-ups must probe new evidence');
  if (tags.length < 2) failures.push('needs two role-relevant tags');
  if (tags.length && !tagsAreGrounded(tags, questionText, jobSignals)) failures.push('tags are not grounded in the job or question');
  if (expectedType && question?.type !== expectedType) failures.push(`must use ${expectedType} type`);
  if (question?.difficulty !== difficulty) failures.push(`must use ${difficulty} difficulty`);
  if (difficulty === 'hard' && !/(ambigu|constraint|failure|incident|risk|scale|trade-?off|uncertain|competing)/i.test(questionText)) {
    failures.push('hard question needs ambiguity, risk, scale, failure, or trade-offs');
  }
  if (question?.type === 'behavioral' && !/(tell|describe|give|share).{0,40}(example|experience|time|situation)|\btime when\b/i.test(questionText)) {
    failures.push('behavioral question must request a concrete past example');
  }
  if (question?.type === 'situational' && !/(how would|what would|imagine|suppose|scenario|\bif\b)/i.test(questionText)) {
    failures.push('situational question must present a hypothetical scenario');
  }

  const score = Math.max(0, Math.min(1, 1 - (failures.length * 0.1)));
  return { passed: failures.length === 0 && score >= 0.78, score, issues: failures, matchedJobSignals: [...new Set([...strongOverlap, ...overlap])].slice(0, 8) };
}

function assessGeneratedQuestions(questions, { job = {}, expectedCount, typePlan = [], difficulty = 'medium' } = {}) {
  const items = Array.isArray(questions) ? questions : [];
  const jobSignals = buildJobSignals(job);
  const issues = [];
  const duplicateIndexes = new Set();
  const results = items.map((question, index) => {
    const result = assessQuestion(question, { jobSignals, expectedType: typePlan[index], difficulty });
    if (!result.passed) issues.push(`Question ${index + 1}: ${result.issues.join('; ')}.`);
    return result;
  });

  if (items.length !== expectedCount) issues.push(`Return exactly ${expectedCount} questions; received ${items.length}.`);
  for (let left = 0; left < items.length; left += 1) {
    for (let right = left + 1; right < items.length; right += 1) {
      const questionSimilarity = similarity(items[left]?.question, items[right]?.question);
      const guidanceSimilarity = similarity(items[left]?.expectedAnswer, items[right]?.expectedAnswer);
      if (questionSimilarity >= 0.72) {
        duplicateIndexes.add(left);
        duplicateIndexes.add(right);
        issues.push(`Questions ${left + 1} and ${right + 1} are too similar.`);
      }
      if (guidanceSimilarity >= 0.78) {
        duplicateIndexes.add(left);
        duplicateIndexes.add(right);
        issues.push(`Questions ${left + 1} and ${right + 1} reuse the same expected-answer guidance.`);
      }
    }
  }

  const score = results.length ? results.reduce((sum, result) => sum + result.score, 0) / results.length : 0;
  return {
    passed: items.length === expectedCount && !duplicateIndexes.size && results.every((result) => result.passed),
    score: Math.round(score * 100) / 100,
    issues: [...new Set(issues)],
    duplicateIndexes: [...duplicateIndexes],
    questions: results
  };
}

function repairInstructions(assessment) {
  const issues = assessment?.issues?.length ? assessment.issues : ['The prior output did not pass semantic validation.'];
  return `\n\nThe previous output failed the semantic quality gate. Discard it and create a new set that fixes every issue:\n${issues.slice(0, 16).map((issue, index) => `${index + 1}. ${issue}`).join('\n')}\nReturn only the required JSON object.`;
}

module.exports = { assessGeneratedQuestions, repairInstructions, similarity };
