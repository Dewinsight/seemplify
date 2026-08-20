const { normalizeDesign } = require('./appraisalCycleDesignService');

const CORE_SECTION_TYPES = new Set(['goals', 'competencies']);

function toPlainObject(value) {
  if (!value) return {};
  return typeof value.toObject === 'function' ? value.toObject() : { ...value };
}

function responseKey(sectionId, questionId) {
  return `${String(sectionId || '')}:${String(questionId || '')}`;
}

function isBlankNumericValue(value) {
  return value === null
    || value === undefined
    || (typeof value === 'string' && value.trim() === '');
}

function getConfiguredDesign(appraisal) {
  const frozen = appraisal?.cycleConfigurationSnapshot?.workflowDefinition;
  if (frozen) return normalizeDesign(frozen);

  // Legacy appraisals created before configuration snapshots may fall back to
  // the populated cycle. A live cycle must never replace an existing snapshot.
  const legacyCycleDesign = appraisal?.cycleId?.workflowDefinition;
  return legacyCycleDesign ? normalizeDesign(legacyCycleDesign) : null;
}

function getCustomQuestionMap(appraisal, respondentRole, options = {}) {
  const { includeCoreSections = false } = options;
  const design = getConfiguredDesign(appraisal);
  const sections = (design?.sections || []).filter((section) => (
    (includeCoreSections || !CORE_SECTION_TYPES.has(section.type))
    && (section.respondent === respondentRole || section.respondent === 'both')
  ));
  const questionMap = new Map();
  for (const section of sections) {
    for (const question of section.questions || []) {
      questionMap.set(responseKey(section.id, question.id), { section, question });
    }
  }
  return { design, sections, questionMap };
}

function getConversationQuestionQueue(appraisal, respondentRole = 'employee') {
  const { questionMap } = getCustomQuestionMap(appraisal, respondentRole);
  return Array.from(questionMap.values()).map(({ section, question }) => ({
    key: responseKey(section.id, question.id),
    sectionId: section.id,
    sectionTitle: section.title,
    sectionDescription: section.description || '',
    sectionType: section.type,
    evidenceRequired: Boolean(section.evidenceRequired),
    questionId: question.id,
    prompt: question.prompt,
    helpText: question.helpText || '',
    responseType: question.responseType,
    // A question is submission-required only when both its containing section
    // and its own definition are required.
    required: section.required !== false && question.required !== false,
    options: Array.isArray(question.options) ? [...question.options] : [],
    ratingMin: Number(question.ratingMin ?? 1),
    ratingMax: Number(question.ratingMax ?? 5)
  }));
}

function validateCycleResponseValue(value, question) {
  switch (question.responseType) {
    case 'rating': {
      if (isBlankNumericValue(value)) return { valid: false, error: `Choose a rating from ${question.ratingMin ?? 1} to ${question.ratingMax ?? 5}` };
      const numeric = typeof value === 'number' ? value : Number(value);
      const min = Number(question.ratingMin ?? 1);
      const max = Number(question.ratingMax ?? 5);
      if (!Number.isFinite(numeric) || numeric < min || numeric > max) {
        return { valid: false, error: `Choose a rating from ${min} to ${max}` };
      }
      return { valid: true, value: numeric, score: numeric };
    }
    case 'number': {
      if (isBlankNumericValue(value)) return { valid: false, error: 'Enter a valid number' };
      const numeric = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(numeric)) return { valid: false, error: 'Enter a valid number' };
      return { valid: true, value: numeric, score: numeric };
    }
    case 'boolean': {
      if (value === true || value === false) return { valid: true, value };
      if (value === 'true' || value === 'false') return { valid: true, value: value === 'true' };
      return { valid: false, error: 'Choose yes or no' };
    }
    case 'single_select': {
      const selected = String(value ?? '');
      if (!question.options.includes(selected)) return { valid: false, error: 'Choose one of the available options' };
      return { valid: true, value: selected };
    }
    case 'multi_select': {
      if (!Array.isArray(value) || value.length === 0) {
        return { valid: false, error: 'Choose at least one available option or skip this optional question' };
      }
      const selected = [...new Set(value.map(String))];
      if (selected.some((item) => !question.options.includes(item))) {
        return { valid: false, error: 'Choose only from the available options' };
      }
      return { valid: true, value: selected.slice(0, question.options.length) };
    }
    case 'short_text': {
      if (typeof value !== 'string') return { valid: false, error: 'Enter a text response or skip this optional question' };
      const text = String(value ?? '').trim().slice(0, 500);
      if (!text) return { valid: false, error: 'Enter a response or skip this optional question' };
      return { valid: true, value: text };
    }
    default: {
      if (typeof value !== 'string') return { valid: false, error: 'Enter a text response or skip this optional question' };
      const text = String(value ?? '').trim().slice(0, 10000);
      if (!text) return { valid: false, error: 'Enter a response or skip this optional question' };
      return { valid: true, value: text };
    }
  }
}

function hasCustomResponseValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'boolean' || typeof value === 'number') return true;
  return String(value || '').trim().length > 0;
}

function respondentResponses(appraisal, respondentRole, validKeys = null) {
  const seen = new Set();
  return [...(appraisal.customResponses || [])]
    .reverse()
    .filter((item) => {
      const plain = toPlainObject(item);
      if (plain.respondentRole !== respondentRole) return false;
      const key = responseKey(plain.sectionId, plain.questionId);
      if (validKeys && !validKeys.has(key)) return false;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .reverse()
    .map(toPlainObject);
}

function upsertCustomResponse(appraisal, definition, options = {}) {
  const {
    respondentRole = 'employee',
    respondentId = '',
    value,
    evidence,
    score,
    submittedAt,
    now = new Date()
  } = options;
  const key = responseKey(definition.sectionId, definition.questionId);
  const all = (appraisal.customResponses || []).map(toPlainObject);
  const prior = [...all].reverse().find((item) => (
    item.respondentRole === respondentRole
    && responseKey(item.sectionId, item.questionId) === key
  )) || {};
  const next = {
    ...prior,
    sectionId: definition.sectionId,
    questionId: definition.questionId,
    respondentRole,
    respondentId: String(respondentId || ''),
    value,
    evidence: Array.isArray(evidence) ? evidence.slice(0, 20) : (prior.evidence || []),
    score: Number.isFinite(Number(score)) ? Number(score) : undefined,
    lastSavedAt: now,
    submittedAt: submittedAt || prior.submittedAt
  };
  appraisal.customResponses = [
    ...all.filter((item) => !(
      item.respondentRole === respondentRole
      && responseKey(item.sectionId, item.questionId) === key
    )),
    next
  ];
  return next;
}

function missingRequiredCustomResponses(appraisal, respondentRole) {
  const { sections, questionMap } = getCustomQuestionMap(appraisal, respondentRole);
  const validKeys = new Set(questionMap.keys());
  const responses = new Map(
    respondentResponses(appraisal, respondentRole, validKeys)
      .map((item) => [responseKey(item.sectionId, item.questionId), item.value])
  );
  const missing = [];
  for (const [key, definition] of questionMap.entries()) {
    if (definition.section.required && definition.question.required && !hasCustomResponseValue(responses.get(key))) {
      missing.push(definition.question.prompt);
    }
  }
  for (const section of sections) {
    if (section.required && section.evidenceRequired && (!appraisal.documents || appraisal.documents.length === 0)) {
      missing.push(`${section.title}: attach supporting evidence`);
    }
  }
  return missing;
}

function getCycleQuestionState(appraisal) {
  const questions = getConversationQuestionQueue(appraisal, 'employee');
  const validKeys = new Set(questions.map((item) => item.key));
  const responses = respondentResponses(appraisal, 'employee', validKeys);
  const answeredKeys = new Set(
    responses
      .filter((item) => hasCustomResponseValue(item.value))
      .map((item) => responseKey(item.sectionId, item.questionId))
  );
  const persisted = appraisal?.conversationAssessment?.cycleQuestionProgress || {};
  const skippedKeys = [...new Set(Array.isArray(persisted.skippedKeys) ? persisted.skippedKeys.map(String) : [])]
    .filter((key) => validKeys.has(key) && !answeredKeys.has(key));
  const completedKeys = [...new Set([...answeredKeys, ...skippedKeys])];
  const currentIndex = questions.findIndex((item) => !completedKeys.includes(item.key));
  const completed = questions.length === 0 || currentIndex === -1;
  return {
    questions,
    responses,
    activeQuestion: completed ? null : questions[currentIndex],
    progress: {
      currentIndex: completed ? questions.length : currentIndex,
      total: questions.length,
      answered: answeredKeys.size,
      skipped: skippedKeys.length,
      completed,
      completedKeys,
      skippedKeys,
      startedAt: persisted.startedAt || null,
      completedAt: completed ? (persisted.completedAt || null) : null
    }
  };
}

function persistCycleQuestionProgress(appraisal, state, options = {}) {
  if (!appraisal.conversationAssessment) appraisal.conversationAssessment = {};
  const now = options.now || new Date();
  const prior = appraisal.conversationAssessment.cycleQuestionProgress || {};
  appraisal.conversationAssessment.cycleQuestionProgress = {
    currentIndex: state.progress.currentIndex,
    completedKeys: state.progress.completedKeys,
    skippedKeys: state.progress.skippedKeys,
    startedAt: prior.startedAt || (state.questions.length > 0 ? now : undefined),
    completedAt: state.progress.completed ? (prior.completedAt || now) : undefined
  };
  return appraisal.conversationAssessment.cycleQuestionProgress;
}

function getCycleQuestionEvidence(appraisal, respondentRole = 'employee') {
  const state = getCycleQuestionState(appraisal);
  const responseMap = new Map(
    respondentResponses(appraisal, respondentRole)
      .map((item) => [responseKey(item.sectionId, item.questionId), item])
  );
  return state.questions
    .map((question) => {
      const response = responseMap.get(question.key);
      if (!response || !hasCustomResponseValue(response.value)) return null;
      return { ...question, value: response.value };
    })
    .filter(Boolean);
}

module.exports = {
  getConfiguredDesign,
  getCustomQuestionMap,
  getConversationQuestionQueue,
  validateCycleResponseValue,
  hasCustomResponseValue,
  upsertCustomResponse,
  respondentResponses,
  missingRequiredCustomResponses,
  getCycleQuestionState,
  persistCycleQuestionProgress,
  getCycleQuestionEvidence,
  responseKey
};
