const crypto = require('crypto');

const SECTION_TYPES = new Set([
  'goals',
  'competencies',
  'achievements',
  'learning',
  'development',
  'custom'
]);
const RESPONDENTS = new Set(['employee', 'manager', 'both']);
const RESPONSE_TYPES = new Set([
  'short_text',
  'long_text',
  'rating',
  'number',
  'boolean',
  'single_select',
  'multi_select'
]);

function stableId(prefix, value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 42);
  return `${prefix}_${normalized || crypto.randomUUID().slice(0, 8)}`;
}

function question(id, prompt, responseType = 'long_text', extra = {}) {
  return {
    id,
    prompt,
    responseType,
    required: true,
    helpText: '',
    options: [],
    ratingMin: 1,
    ratingMax: 5,
    ...extra
  };
}

const BUILT_IN_TEMPLATES = Object.freeze([
  {
    id: 'balanced_performance',
    name: 'Balanced performance review',
    description: 'A complete review of outcomes, behaviours, learning, and next-step development.',
    category: 'annual',
    system: true,
    design: {
      version: 1,
      scoring: { goalsWeight: 40, competenciesWeight: 60 },
      stages: {
        goalSetting: { enabled: true },
        selfAssessment: { enabled: true },
        managerReview: { enabled: true },
        discussion: { enabled: true },
        calibration: { enabled: false },
        finalReview: { enabled: true },
        acknowledgement: { enabled: true }
      },
      sections: [
        {
          id: 'goals', title: 'Goals and outcomes', description: 'Review approved goal evidence for the period.',
          type: 'goals', respondent: 'both', required: true, scored: true, weight: 40, evidenceRequired: false,
          questions: []
        },
        {
          id: 'competencies', title: 'Competencies', description: 'Assess the behaviours and capabilities expected in the role.',
          type: 'competencies', respondent: 'both', required: true, scored: true, weight: 60, evidenceRequired: false,
          questions: []
        },
        {
          id: 'achievements', title: 'Achievements and challenges', description: 'Capture impact, obstacles, and lessons from the period.',
          type: 'achievements', respondent: 'employee', required: true, scored: false, weight: 0, evidenceRequired: false,
          questions: [
            question('achievement_impact', 'What outcomes are you most proud of, and what changed because of your work?'),
            question('challenge_response', 'What was your most important challenge, and how did you respond?')
          ]
        },
        {
          id: 'learning', title: 'Learning and application', description: 'Reflect on learning from training, projects, mentoring, or day-to-day work. No LMS connection is required.',
          type: 'learning', respondent: 'employee', required: true, scored: false, weight: 0, evidenceRequired: false,
          questions: [
            question('learning_gained', 'What did you learn during this review period?'),
            question('learning_applied', 'How have you applied that learning in your work?'),
            question('learning_evidence', 'What evidence or example demonstrates the difference it made?', 'long_text', { required: false })
          ]
        },
        {
          id: 'development', title: 'Development and next priorities', description: 'Agree the employee’s next development focus and support needed.',
          type: 'development', respondent: 'both', required: true, scored: false, weight: 0, evidenceRequired: false,
          questions: [
            question('development_priority', 'What capability or experience should be developed next?'),
            question('support_needed', 'What support, opportunity, or resource would help?', 'long_text', { required: false })
          ]
        }
      ]
    }
  },
  {
    id: 'quarterly_checkpoint',
    name: 'Quarterly checkpoint',
    description: 'A lighter review focused on goals, current delivery, learning, and near-term priorities.',
    category: 'quarterly',
    system: true,
    design: {
      version: 1,
      scoring: { goalsWeight: 70, competenciesWeight: 30 },
      stages: {
        goalSetting: { enabled: true }, selfAssessment: { enabled: true }, managerReview: { enabled: true },
        discussion: { enabled: true }, calibration: { enabled: false }, finalReview: { enabled: true }, acknowledgement: { enabled: true }
      },
      sections: [
        { id: 'goals', title: 'Quarter goals', description: 'Review approved goal evidence.', type: 'goals', respondent: 'both', required: true, scored: true, weight: 70, evidenceRequired: false, questions: [] },
        { id: 'competencies', title: 'Ways of working', description: 'Rate the most relevant role behaviours.', type: 'competencies', respondent: 'both', required: true, scored: true, weight: 30, evidenceRequired: false, questions: [] },
        { id: 'quarter_reflection', title: 'Quarter reflection', description: 'Keep the checkpoint focused and practical.', type: 'achievements', respondent: 'employee', required: true, scored: false, weight: 0, evidenceRequired: false, questions: [
          question('quarter_win', 'What was your most important outcome this quarter?'),
          question('quarter_blocker', 'What slowed progress, and what help is needed?', 'long_text', { required: false }),
          question('quarter_learning', 'What did you learn and apply this quarter?')
        ] }
      ]
    }
  },
  {
    id: 'probation_review',
    name: 'Probation review',
    description: 'Role expectations, early contribution, learning, support, and readiness.',
    category: 'probation',
    system: true,
    design: {
      version: 1,
      scoring: { goalsWeight: 30, competenciesWeight: 70 },
      stages: {
        goalSetting: { enabled: true }, selfAssessment: { enabled: true }, managerReview: { enabled: true },
        discussion: { enabled: true }, calibration: { enabled: false }, finalReview: { enabled: true }, acknowledgement: { enabled: true }
      },
      sections: [
        { id: 'goals', title: 'Role outcomes', description: 'Review agreed probation goals.', type: 'goals', respondent: 'both', required: true, scored: true, weight: 30, evidenceRequired: false, questions: [] },
        { id: 'competencies', title: 'Role behaviours', description: 'Assess expected behaviours and capability.', type: 'competencies', respondent: 'both', required: true, scored: true, weight: 70, evidenceRequired: false, questions: [] },
        { id: 'probation_learning', title: 'Learning and readiness', description: 'Capture onboarding learning and how it is being applied.', type: 'learning', respondent: 'both', required: true, scored: false, weight: 0, evidenceRequired: false, questions: [
          question('role_learning', 'What have you learned about the role, customers, or organization?'),
          question('role_application', 'Where have you applied that learning successfully?'),
          question('readiness_support', 'What support is still needed to perform the role confidently?', 'long_text', { required: false })
        ] }
      ]
    }
  }
]);

function cleanText(value, maxLength = 5000) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeQuestion(raw = {}, index = 0) {
  const prompt = cleanText(raw.prompt, 500);
  const responseType = RESPONSE_TYPES.has(raw.responseType) ? raw.responseType : 'long_text';
  const options = Array.isArray(raw.options)
    ? raw.options.map((option) => cleanText(option, 120)).filter(Boolean).slice(0, 20)
    : [];
  return {
    id: cleanText(raw.id, 64) || stableId('question', `${prompt}_${index}`),
    prompt,
    helpText: cleanText(raw.helpText, 500),
    responseType,
    required: raw.required !== false,
    options,
    ratingMin: Math.max(0, Math.min(10, Number(raw.ratingMin ?? 1))),
    ratingMax: Math.max(1, Math.min(10, Number(raw.ratingMax ?? 5)))
  };
}

function normalizeSection(raw = {}, index = 0) {
  const title = cleanText(raw.title, 160);
  const type = SECTION_TYPES.has(raw.type) ? raw.type : 'custom';
  const respondent = RESPONDENTS.has(raw.respondent) ? raw.respondent : 'employee';
  return {
    id: cleanText(raw.id, 64) || stableId('section', `${title}_${index}`),
    title,
    description: cleanText(raw.description, 1000),
    type,
    respondent,
    required: raw.required !== false,
    scored: Boolean(raw.scored),
    weight: Boolean(raw.scored) ? Math.max(0, Math.min(100, Number(raw.weight ?? 0))) : 0,
    evidenceRequired: Boolean(raw.evidenceRequired),
    questions: Array.isArray(raw.questions)
      ? raw.questions.slice(0, 20).map(normalizeQuestion)
      : []
  };
}

function normalizeDesign(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const sections = Array.isArray(source.sections)
    ? source.sections.slice(0, 20).map(normalizeSection)
    : [];
  const goalsSection = sections.find((section) => section.type === 'goals');
  const competenciesSection = sections.find((section) => section.type === 'competencies');
  const scoring = {
    goalsWeight: Math.max(0, Math.min(100, Number(source.scoring?.goalsWeight ?? goalsSection?.weight ?? 40))),
    competenciesWeight: Math.max(0, Math.min(100, Number(source.scoring?.competenciesWeight ?? competenciesSection?.weight ?? 60)))
  };
  if (goalsSection) goalsSection.weight = scoring.goalsWeight;
  if (competenciesSection) competenciesSection.weight = scoring.competenciesWeight;

  const defaultStages = BUILT_IN_TEMPLATES[0].design.stages;
  const stages = Object.fromEntries(Object.entries(defaultStages).map(([key, value]) => [key, {
    enabled: source.stages?.[key]?.enabled === undefined ? value.enabled : Boolean(source.stages[key].enabled)
  }]));
  stages.selfAssessment.enabled = true;
  stages.managerReview.enabled = true;
  stages.finalReview.enabled = true;

  return { version: 1, scoring, stages, sections };
}

function validateDesign(raw = {}) {
  const design = normalizeDesign(raw);
  const errors = [];
  if (design.sections.length === 0) errors.push('Add at least one assessment section');

  const sectionIds = new Set();
  for (const section of design.sections) {
    if (!section.title) errors.push('Every assessment section needs a title');
    if (!['goals', 'competencies'].includes(section.type) && section.questions.length === 0) {
      errors.push(`Section '${section.title || section.id}' needs at least one question`);
    }
    if (sectionIds.has(section.id)) errors.push(`Section ID '${section.id}' is duplicated`);
    sectionIds.add(section.id);
    const questionIds = new Set();
    for (const item of section.questions) {
      if (!item.prompt) errors.push(`Every question in '${section.title || section.id}' needs prompt text`);
      if (questionIds.has(item.id)) errors.push(`Question ID '${item.id}' is duplicated in '${section.title || section.id}'`);
      questionIds.add(item.id);
      if (['single_select', 'multi_select'].includes(item.responseType) && item.options.length < 2) {
        errors.push(`Choice question '${item.prompt || item.id}' needs at least two options`);
      }
      if (item.responseType === 'rating' && item.ratingMax <= item.ratingMin) {
        errors.push(`Rating question '${item.prompt || item.id}' needs a maximum above its minimum`);
      }
    }
    if (section.scored && !['goals', 'competencies'].includes(section.type)) {
      const hasManagerScore = ['manager', 'both'].includes(section.respondent) && section.questions.some((item) => item.responseType === 'rating');
      if (!hasManagerScore) errors.push(`Scored section '${section.title}' needs a manager rating question`);
    }
  }

  const scoredWeight = design.sections.filter((section) => section.scored).reduce((sum, section) => sum + Number(section.weight || 0), 0);
  if (Math.abs(scoredWeight - 100) > 0.01) {
    errors.push(`Scored section weights must total 100% (currently ${Math.round(scoredWeight * 100) / 100}%)`);
  }
  return { design, errors };
}

function templateSnapshot(template) {
  return {
    id: template.id || String(template._id),
    name: template.name,
    version: Number(template.version || 1)
  };
}

function cloneBuiltInTemplate(id = 'balanced_performance') {
  const template = BUILT_IN_TEMPLATES.find((item) => item.id === id) || BUILT_IN_TEMPLATES[0];
  return JSON.parse(JSON.stringify(template));
}

module.exports = {
  BUILT_IN_TEMPLATES,
  cloneBuiltInTemplate,
  normalizeDesign,
  validateDesign,
  templateSnapshot
};
