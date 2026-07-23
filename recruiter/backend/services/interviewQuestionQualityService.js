const GENERIC_QUESTION_PATTERNS = Object.freeze([
  /describe your approach to solving complex technical problems/i,
  /how do you stay current with new technolog(?:y|ies)/i,
  /tell me about a time when you had to work with a difficult team member/i,
  /describe a situation where you had to adapt to significant changes/i,
  /what type of work environment do you thrive in/i,
  /describe your experience with the key skills required for this role/i,
  /walk me through your career progression and key achievements/i
]);

const GENERIC_EXPECTED_ANSWER_PATTERNS = Object.freeze([
  /look for (?:a )?systematic problem-solving methodology/i,
  /look for technical depth/i,
  /strong communication\.?(?:\s|$)/i,
  /candidate should demonstrate relevant experience/i,
  /assess (?:their|the candidate'?s) overall fit/i
]);

const PROTECTED_TRAIT_PATTERNS = Object.freeze([
  /\b(?:how old|your age|date of birth|year (?:did you )?graduate)\b/i,
  /\b(?:married|marital status|children|pregnan|family plans?)\b/i,
  /\b(?:religion|religious|church|mosque|faith)\b/i,
  /\b(?:disabilit|medical condition|health condition)\b/i,
  /\b(?:nationality|country (?:were you )?born|native language|accent)\b/i,
  /\b(?:sexual orientation|gender identity|race(?!\s+conditions?\b)|ethnic(?:ity)?)\b/i
]);

const STOP_WORDS = new Set([
  'about', 'after', 'also', 'and', 'are', 'been', 'being', 'can', 'could', 'for', 'from',
  'have', 'into', 'its', 'job', 'more', 'not', 'our', 'role', 'that', 'the', 'their',
  'then', 'this', 'through', 'using', 'what', 'when', 'where', 'which', 'with', 'would',
  'your', 'you', 'analyst', 'coordinator', 'developer', 'engineer', 'lead', 'manager',
  'senior', 'specialist'
]);

const SPECIFICITY_TERMS = Object.freeze([
  'constraint', 'customer', 'deadline', 'failure', 'incident', 'metric', 'outcome',
  'production', 'scale', 'stakeholder', 'trade-off', 'tradeoff'
]);

const HARD_DIFFICULTY_TERMS = Object.freeze([
  'ambigu', 'constraint', 'failure', 'incident', 'multiple', 'prioriti', 'risk', 'scale',
  'trade-off', 'tradeoff', 'uncertain'
]);

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function round(value) {
  return Math.round(clamp(value) * 100) / 100;
}

function text(value) {
  if (Array.isArray(value)) return value.map(text).join(' ');
  if (value && typeof value === 'object') return Object.values(value).map(text).join(' ');
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value) {
  return text(value)
    .toLowerCase()
    .match(/[a-z0-9+#.-]{3,}/g)?.filter((token) => !STOP_WORDS.has(token)) || [];
}

function uniqueTokens(value) {
  return new Set(tokens(value));
}

function intersection(left, right) {
  return [...left].filter((item) => right.has(item));
}

function jaccardSimilarity(left, right) {
  const leftTokens = uniqueTokens(left);
  const rightTokens = uniqueTokens(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  const common = intersection(leftTokens, rightTokens).length;
  return common / new Set([...leftTokens, ...rightTokens]).size;
}

function splitSkills(value) {
  if (Array.isArray(value)) return value.flatMap(splitSkills);
  return String(value || '').split(/[,;|\n]/).map((item) => item.trim()).filter(Boolean);
}

function buildJobSignals(job = {}) {
  const strongSource = splitSkills(job.skills).filter(Boolean);
  const contextSource = [
    ...strongSource,
    job.description,
    job.requirements,
    job.responsibilities,
    job.level,
    job.experience
  ].filter(Boolean);
  return {
    strong: uniqueTokens(strongSource),
    context: uniqueTokens(contextSource)
  };
}

function criterionWeightTotal(criteria) {
  return (Array.isArray(criteria) ? criteria : [])
    .reduce((sum, item) => sum + (Number(item?.weight) || 0), 0);
}

function hasQuestionMark(value) {
  return /\?\s*$/.test(text(value));
}

function countOverlap(left, right) {
  return intersection(uniqueTokens(left), uniqueTokens(right)).length;
}

function criteriaAreActionable(criteria) {
  return criteria.every((item) => {
    const weight = Number(item?.weight);
    return text(item?.criterion).length >= 4
      && text(item?.description).length >= 20
      && Number.isFinite(weight)
      && weight > 0;
  });
}

function criteriaAreDistinct(criteria) {
  for (let left = 0; left < criteria.length; left += 1) {
    for (let right = left + 1; right < criteria.length; right += 1) {
      if (jaccardSimilarity(criteria[left]?.criterion, criteria[right]?.criterion) >= 0.8) return false;
    }
  }
  return true;
}

function tagsAreGrounded(tags, questionText, jobSignals) {
  const jobTokens = new Set([...jobSignals.strong, ...jobSignals.context]);
  const allowedSignals = jobTokens.size ? jobTokens : uniqueTokens(questionText);
  return tags.some((tag) => intersection(uniqueTokens(tag), allowedSignals).length > 0);
}

function assessInterviewQuestion(question = {}, options = {}) {
  const questionText = text(question.question);
  const answerText = text(question.expectedAnswer);
  const questionTokens = uniqueTokens(questionText);
  const jobSignals = options.jobSignals || buildJobSignals(options.job);
  const strongMatches = intersection(questionTokens, jobSignals.strong);
  const contextMatches = intersection(questionTokens, jobSignals.context);
  const criteria = Array.isArray(question.scoringCriteria) ? question.scoringCriteria : [];
  const followUps = Array.isArray(question.followUpQuestions) ? question.followUpQuestions : [];
  const tags = Array.isArray(question.tags) ? question.tags.filter(Boolean) : [];
  const issues = [];
  const blockers = [];

  const generic = GENERIC_QUESTION_PATTERNS.some((pattern) => pattern.test(questionText));
  if (generic) blockers.push('Replace the generic stock question with a scenario grounded in this job.');
  const protectedTraitRisk = PROTECTED_TRAIT_PATTERNS.some((pattern) => pattern.test(questionText));
  if (protectedTraitRisk) blockers.push('Remove protected-characteristic or personal-status content from the interview question.');
  if (questionText.length < 35) issues.push('Make the question more specific and complete.');
  if (!hasQuestionMark(questionText)) issues.push('Write the candidate-facing question as a complete question ending in a question mark.');

  let grounding = strongMatches.length ? 1 : contextMatches.length >= 2 ? 0.8 : contextMatches.length ? 0.45 : 0;
  if (!jobSignals.context.size) grounding = 0.6;
  if (grounding < 0.45) blockers.push('Reference a concrete skill, responsibility, outcome, or constraint from the job context.');

  const lowerQuestion = questionText.toLowerCase();
  const specificity = SPECIFICITY_TERMS.some((term) => lowerQuestion.includes(term)) || strongMatches.length >= 2
    ? 1
    : strongMatches.length || contextMatches.length >= 2 ? 0.7 : 0.3;
  if (specificity < 0.7) issues.push('Use a realistic scenario with a decision, constraint, or measurable outcome.');

  const answerDepth = answerText.length >= 120 ? 1 : answerText.length >= 80 ? 0.8 : answerText.length >= 50 ? 0.5 : 0.15;
  const genericExpectedAnswer = GENERIC_EXPECTED_ANSWER_PATTERNS.some((pattern) => pattern.test(answerText));
  const answerOverlap = countOverlap(answerText, `${questionText} ${[...jobSignals.context].join(' ')}`);
  if (answerDepth < 0.8) blockers.push('Expand the expected answer into evidence-based scoring guidance.');
  if (genericExpectedAnswer || answerOverlap < 2) blockers.push('Make the expected answer specific to this question and its job evidence.');

  const criteriaScore = criteria.length >= 3 ? 1 : criteria.length === 2 ? 0.75 : criteria.length === 1 ? 0.35 : 0;
  if (criteria.length < 3) blockers.push('Provide at least three distinct scoring criteria.');
  const weightTotal = criterionWeightTotal(criteria);
  if (criteria.length && Math.abs(weightTotal - 100) > 1) blockers.push('Make scoring-criteria weights total 100.');
  if (criteria.length && !criteriaAreActionable(criteria)) blockers.push('Give every scoring criterion a positive weight and a concrete description.');
  if (criteria.length && !criteriaAreDistinct(criteria)) blockers.push('Use materially distinct scoring criteria.');

  const followUpScore = followUps.length >= 2 ? 1 : followUps.length === 1 ? 0.75 : 0;
  if (!followUps.length) blockers.push('Add a probing follow-up question with a clear condition.');
  if (followUps.some((followUp) => text(followUp?.question).length < 20 || text(followUp?.condition).length < 10)) {
    blockers.push('Make each follow-up specific and state a useful condition for asking it.');
  }
  if (followUps.some((followUp) => jaccardSimilarity(questionText, followUp?.question) >= 0.8)) {
    blockers.push('Follow-up questions must probe new evidence instead of repeating the main question.');
  }
  const tagScore = tags.length >= 2 ? 1 : tags.length === 1 ? 0.5 : 0;
  if (tags.length < 2) blockers.push('Add at least two role-relevant skill tags.');
  if (tags.length && !tagsAreGrounded(tags, questionText, jobSignals)) blockers.push('Ground at least one tag in the question or supplied job context.');

  const expectedDifficulty = String(options.difficulty || question.difficulty || 'medium');
  let difficultyScore = String(question.difficulty || '') === expectedDifficulty ? 1 : 0.45;
  if (expectedDifficulty === 'hard' && !HARD_DIFFICULTY_TERMS.some((term) => lowerQuestion.includes(term))) {
    difficultyScore *= 0.55;
    issues.push('A hard question must include ambiguity, scale, trade-offs, risk, or competing constraints.');
  }

  if (options.expectedType && String(question.type) !== String(options.expectedType)) {
    difficultyScore *= 0.7;
    blockers.push(`Use the requested ${options.expectedType} question type.`);
  }
  if (String(question.type) === 'behavioral' && !/(tell|describe|give|share).{0,40}(example|experience|time|situation)|\btime when\b/i.test(questionText)) {
    blockers.push('Behavioral questions must ask for a concrete past example or experience.');
  }
  if (String(question.type) === 'situational' && !/(how would|what would|imagine|suppose|scenario|\bif\b)/i.test(questionText)) {
    blockers.push('Situational questions must present a clear hypothetical scenario or decision.');
  }

  const lengthScore = questionText.length >= 55 ? 1 : questionText.length >= 35 ? 0.65 : 0.2;
  const score = round(
    (grounding * 0.2)
    + (specificity * 0.14)
    + (answerDepth * 0.18)
    + (criteriaScore * 0.16)
    + (followUpScore * 0.08)
    + (tagScore * 0.07)
    + (lengthScore * 0.07)
    + (difficultyScore * 0.1)
  );

  if (score < 0.78) blockers.push(`Raise semantic quality to at least 78% (current score ${Math.round(score * 100)}%).`);
  return {
    score,
    passed: blockers.length === 0,
    issues: [...new Set([...blockers, ...issues])],
    blockers: [...new Set(blockers)],
    matchedJobSignals: [...new Set([...strongMatches, ...contextMatches])].slice(0, 8),
    generic,
    protectedTraitRisk,
    genericExpectedAnswer
  };
}

function assessQuestionSet(questions, options = {}) {
  const items = Array.isArray(questions) ? questions : [];
  const expectedCount = Number(options.expectedCount || items.length);
  const expectedTypes = Array.isArray(options.expectedTypes) ? options.expectedTypes : [];
  const jobSignals = buildJobSignals(options.job || {});
  const questionResults = items.map((question, index) => assessInterviewQuestion(question, {
    ...options,
    jobSignals,
    expectedType: expectedTypes[index] || options.expectedType
  }));
  const issues = [];
  const duplicateIndexes = new Set();

  if (items.length !== expectedCount) {
    issues.push(`Return exactly ${expectedCount} questions; received ${items.length}.`);
  }
  for (let left = 0; left < items.length; left += 1) {
    for (let right = left + 1; right < items.length; right += 1) {
      const questionSimilarity = jaccardSimilarity(items[left]?.question, items[right]?.question);
      const guidanceSimilarity = jaccardSimilarity(items[left]?.expectedAnswer, items[right]?.expectedAnswer);
      if (questionSimilarity >= 0.72) {
        duplicateIndexes.add(left);
        duplicateIndexes.add(right);
        issues.push(`Questions ${left + 1} and ${right + 1} are too similar (${Math.round(questionSimilarity * 100)}%).`);
      }
      if (guidanceSimilarity >= 0.78) {
        duplicateIndexes.add(left);
        duplicateIndexes.add(right);
        issues.push(`Questions ${left + 1} and ${right + 1} reuse the same expected-answer guidance (${Math.round(guidanceSimilarity * 100)}%).`);
      }
    }
  }
  questionResults.forEach((result, index) => {
    if (!result.passed) issues.push(`Question ${index + 1}: ${result.blockers.join(' ')}`);
  });
  const baseScore = questionResults.length
    ? questionResults.reduce((sum, result) => sum + result.score, 0) / questionResults.length
    : 0;
  const countPenalty = items.length === expectedCount ? 0 : 0.15;
  const duplicatePenalty = Math.min(0.25, duplicateIndexes.size * 0.05);
  const score = round(baseScore - countPenalty - duplicatePenalty);

  return {
    passed: items.length === expectedCount
      && !duplicateIndexes.size
      && questionResults.every((result) => result.passed),
    score,
    issues: [...new Set(issues)],
    duplicateIndexes: [...duplicateIndexes],
    questions: questionResults
  };
}

function buildQualityRepairInstructions(assessment) {
  const issues = assessment?.issues?.length
    ? assessment.issues.slice(0, 16).map((issue, index) => `${index + 1}. ${issue}`).join('\n')
    : '1. The prior output did not meet the semantic quality gate.';
  return `\n\nQUALITY REGENERATION REQUIRED:\nDiscard the previous questions and generate a completely new set. Fix every issue below:\n${issues}\nDo not mention this review. Return only the required JSON object.`;
}

module.exports = {
  GENERIC_QUESTION_PATTERNS,
  assessInterviewQuestion,
  assessQuestionSet,
  buildJobSignals,
  buildQualityRepairInstructions,
  jaccardSimilarity
};
