'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  AI_ACTIVITIES,
  ACTIVITY_CATALOG,
  performancePreferences
} = require('../config/aiActivityCatalog');

const backend = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(backend, relative), 'utf8');
const occurrences = (source, expression) => [...source.matchAll(expression)].length;

test('every appraisal and performance service completion has an explicit stable activity', () => {
  const appraisal = read('services/appraisalAIService.js');
  assert.equal(
    occurrences(appraisal, /chat\.completions\.create\s*\(/g),
    occurrences(appraisal, /activity:\s*AI_ACTIVITIES\.[A-Z_]+/g),
    'Every appraisal completion must carry an explicit activity'
  );

  const performance = read('services/aiPerformanceService.js');
  assert.equal(
    occurrences(performance, /getChatCompletions\s*\(/g),
    occurrences(performance, /activity:\s*AI_ACTIVITIES\.[A-Z_]+/g),
    'Every Performance AI service completion must carry an explicit activity'
  );

  assert.match(read('services/azureOpenAIService.js'), /openAICompatibleClient\(AI_ACTIVITIES\.MEETING_ANALYSIS\)/);
  assert.match(read('routes/calibration.js'), /activity:\s*AI_ACTIVITIES\.CALIBRATION_INSIGHTS/);
  assert.match(read('routes/developmentPlans.js'), /activity:\s*AI_ACTIVITIES\.DEVELOPMENT_PLAN_SUGGEST/);
  assert.match(read('routes/supportPlans.js'), /activity:\s*AI_ACTIVITIES\.SUPPORT_PLAN_DRAFT/);
  assert.match(read('routes/talent.js'), /activity:\s*AI_ACTIVITIES\.TALENT_EVIDENCE_BRIEF/);
});

test('the Performance activity catalogue is stable, unique, and matches the shared action namespace', () => {
  const ids = ACTIVITY_CATALOG.map((item) => item.id);
  assert.equal(ids.length, 16);
  assert.equal(new Set(ids).size, ids.length);
  ids.forEach((id) => assert.match(id, /^performance\.[a-z0-9_.]+$/));
  assert.equal(AI_ACTIVITIES.GENERAL, 'performance.general');
});

test('shared account default precedence is preserved while Recruiter action rows stay out of Performance', () => {
  const scoped = performancePreferences({
    defaults: {
      override: { codexModel: 'gpt-5.6-terra', reasoningEffort: 'high' },
      effective: { codexModel: 'gpt-5.6-terra', reasoningEffort: 'high' },
      provenance: { codexModel: 'account_default', reasoningEffort: 'account_default' }
    },
    activities: [
      {
        activity: 'recruiter.general', app: 'recruiter',
        effective: { codexModel: 'gpt-5.6-terra', reasoningEffort: 'high' }
      },
      {
        activity: AI_ACTIVITIES.SELF_ASSESSMENT_CHAT, app: 'performance',
        effective: { codexModel: 'gpt-5.6-terra', reasoningEffort: 'high' },
        provenance: { codexModel: 'account_default', reasoningEffort: 'account_default' }
      }
    ]
  });

  assert.equal(scoped.defaults.effective.codexModel, 'gpt-5.6-terra');
  assert.equal(scoped.defaults.provenance.codexModel, 'account_default');
  assert.deepEqual(scoped.activities.map((activity) => activity.activity), [AI_ACTIVITIES.SELF_ASSESSMENT_CHAT]);
  assert.equal(scoped.activities[0].effective.reasoningEffort, 'high');
});

test('Performance resolves a connected ChatGPT subject per authenticated request, never from a static shared subject', () => {
  const files = [
    'services/aiGatewayService.js', 'services/appraisalAIService.js',
    'services/aiPerformanceService.js', 'routes/appraisals.js'
  ];
  const source = files.map(read).join('\n');
  assert.doesNotMatch(source, /PERFORMANCE_CHATGPT_SUBJECT_ID/);
  assert.match(source, /resolveRoutableSubject\(context\.actorId\)/);
  assert.match(source, /codexSubjectId:\s*subjectId/);
  assert.match(source, /codexSourceApp:\s*['"]performance-management['"]/);
  assert.doesNotMatch(source, /['"]performance\.(?:appraisal|meeting|okr)['"]/);
});

test('OKR generation never reuses process-global responses across organizations', async () => {
  const aiService = require('../services/azureOpenAIService');
  const AIPerformanceService = require('../services/aiPerformanceService');
  const original = aiService.getChatCompletions;
  const prompts = [];
  aiService.getChatCompletions = async (messages) => {
    prompts.push(messages.at(-1).content);
    return { choices: [{ message: { content: '{"okrs":[]}' } }] };
  };
  try {
    await AIPerformanceService.generateOKRs('Engineer', 'Ship safely', 'Organization Alpha growth');
    await AIPerformanceService.generateOKRs('Engineer', 'Ship safely', 'Organization Beta retention');
  } finally {
    aiService.getChatCompletions = original;
  }
  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /Organization Alpha growth/);
  assert.match(prompts[1], /Organization Beta retention/);
});

test('connected self-assessment conversations cannot persist deterministic fallback messages as AI output', () => {
  const routes = read('routes/appraisals.js');
  assert.ok(occurrences(routes, /requireChatGpt:\s*true/g) >= 4);
  assert.doesNotMatch(routes, /guided-fallback/);
  assert.match(routes, /fallback:\s*false/);
  assert.match(routes, /aiAvailable:\s*true/);
  assert.match(read('models/Appraisal.js'), /fallback:\s*\{ type: Boolean, default: false \}/);
});

test('appraisal and meeting workflows never disguise account-policy failures as heuristic success', async () => {
  const aiGatewayService = require('../services/aiGatewayService');
  const { PerformanceAIRuntimeError } = require('../services/aiGatewayService');
  const appraisalAIService = require('../services/appraisalAIService');
  const meetingAnalysisService = require('../services/meetingAnalysisService');
  const accountError = new PerformanceAIRuntimeError(
    'Review Performance Management AI consent.',
    'CHATGPT_CONSENT_REQUIRED',
    409
  );

  const originalClient = appraisalAIService.client;
  const originalInitialized = appraisalAIService.initialized;
  const originalCompletion = aiGatewayService.getChatCompletions;
  appraisalAIService.client = {
    chat: { completions: { create: async () => { throw accountError; } } }
  };
  appraisalAIService.initialized = true;
  aiGatewayService.getChatCompletions = async () => { throw accountError; };

  try {
    await assert.rejects(
      appraisalAIService.generateSelfAssessmentSuggestion('achievements', '', '', {}),
      (error) => error === accountError
    );
    await assert.rejects(
      meetingAnalysisService.analyzeTranscript('Manager: How is the project going?', {}),
      (error) => error === accountError
    );
  } finally {
    appraisalAIService.client = originalClient;
    appraisalAIService.initialized = originalInitialized;
    aiGatewayService.getChatCompletions = originalCompletion;
  }
});

test('malformed bias and rating responses are inconclusive errors, never false AI success', async () => {
  const appraisalAIService = require('../services/appraisalAIService');
  const originalClient = appraisalAIService.client;
  const originalInitialized = appraisalAIService.initialized;
  appraisalAIService.client = {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: '{"message":"missing required outcome"}' } }],
          usage: { total_tokens: 3 }
        })
      }
    }
  };
  appraisalAIService.initialized = true;

  const appraisal = {
    employee: { name: 'Example Person' },
    selfAssessment: {},
    cycleId: {}
  };

  try {
    await assert.rejects(
      appraisalAIService.checkForBias({ overallManagerRating: 3 }, {}),
      (error) => error?.code === 'AI_RESPONSE_INVALID' && error?.statusCode === 502
    );
    await assert.rejects(
      appraisalAIService.generateAISuggestedRating(appraisal, []),
      (error) => error?.code === 'AI_RESPONSE_INVALID' && error?.statusCode === 502
    );
  } finally {
    appraisalAIService.client = originalClient;
    appraisalAIService.initialized = originalInitialized;
  }
});

test('manager review assistance exposes the canonical card contract and rejects malformed AI output', async () => {
  const appraisalAIService = require('../services/appraisalAIService');
  const originalClient = appraisalAIService.client;
  const originalInitialized = appraisalAIService.initialized;
  let content = JSON.stringify({
    suggestedRating: 4,
    ratingJustification: 'Delivery and collaboration were consistently strong.',
    draftSummary: 'A strong review period with measurable outcomes.',
    strengthsToHighlight: ['Delivery'],
    constructiveFeedback: ['Delegate earlier']
  });
  appraisalAIService.client = {
    chat: {
      completions: {
        create: async () => ({ choices: [{ message: { content } }] })
      }
    }
  };
  appraisalAIService.initialized = true;

  try {
    const result = await appraisalAIService.assistManagerReview({}, '', []);
    assert.equal(result.success, true);
    assert.equal(result.suggestedRating, 4);
    assert.equal(result.overallSuggestion, 'A strong review period with measurable outcomes.');

    content = JSON.stringify({ suggestions: ['Generic fallback must not be presented as AI output.'] });
    await assert.rejects(
      appraisalAIService.assistManagerReview({}, '', []),
      (error) => error?.code === 'AI_RESPONSE_INVALID' && error?.statusCode === 502
    );
  } finally {
    appraisalAIService.client = originalClient;
    appraisalAIService.initialized = originalInitialized;
  }
});

test('self-assessment start, continuation, and report never advance malformed AI output as a fallback assistant', async () => {
  const appraisalAIService = require('../services/appraisalAIService');
  const originalClient = appraisalAIService.client;
  const originalInitialized = appraisalAIService.initialized;
  const originalAnalysis = appraisalAIService.analyzeSelfAssessment;
  const originalRating = appraisalAIService.generateAISuggestedRating;
  let content = '';
  appraisalAIService.client = {
    chat: {
      completions: {
        create: async () => ({ choices: [{ message: { content } }], usage: {} })
      }
    }
  };
  appraisalAIService.initialized = true;

  const appraisal = {
    employee: { name: 'Example Person' },
    cycleId: { name: 'Annual Review' },
    conversationAssessment: {
      currentPhase: 'achievements',
      currentOkrIndex: 0,
      extractedData: {
        achievements: [{ text: 'Delivered a measurable customer workflow improvement.' }],
        challenges: [{ text: 'Balanced two urgent launches and resolved delivery risks.' }],
        skills: [{ skill: 'Stakeholder communication' }],
        goals: [{ goal: 'Lead the next cross-functional launch with measurable adoption.' }]
      }
    },
    chatThread: [
      { sender: { role: 'employee' }, message: 'I delivered the onboarding workflow and improved completion by 20%.' },
      { sender: { role: 'employee' }, message: 'I resolved launch risks with product and support partners.' },
      { sender: { role: 'employee' }, message: 'I learned stronger stakeholder communication and planning.' },
      { sender: { role: 'employee' }, message: 'My next goal is to lead a cross-functional launch end to end.' }
    ]
  };

  try {
    await assert.rejects(
      appraisalAIService.startSelfAssessmentConversation(appraisal, [], appraisal.employee),
      (error) => error?.code === 'AI_RESPONSE_INVALID' && error?.statusCode === 502
    );

    content = '{}';
    await assert.rejects(
      appraisalAIService.continueConversation(appraisal, 'Here are more details.', []),
      (error) => error?.code === 'AI_RESPONSE_INVALID' && error?.statusCode === 502
    );

    appraisalAIService.analyzeSelfAssessment = async () => { throw new Error('malformed report analysis'); };
    appraisalAIService.generateAISuggestedRating = async () => ({ suggestedRating: 4 });
    await assert.rejects(
      appraisalAIService.generateSelfAssessmentReport(appraisal, []),
      (error) => ['AI_RESPONSE_INVALID', 'AI_INPUT_INSUFFICIENT'].includes(error?.code)
        && [422, 502].includes(error?.statusCode)
    );
  } finally {
    appraisalAIService.client = originalClient;
    appraisalAIService.initialized = originalInitialized;
    appraisalAIService.analyzeSelfAssessment = originalAnalysis;
    appraisalAIService.generateAISuggestedRating = originalRating;
  }
});
