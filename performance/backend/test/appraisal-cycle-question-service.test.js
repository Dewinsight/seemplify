const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getConversationQuestionQueue,
  validateCycleResponseValue,
  upsertCustomResponse,
  getCycleQuestionState,
  persistCycleQuestionProgress
} = require('../services/appraisalCustomResponseService');
const appraisalAIService = require('../services/appraisalAIService');

function design(prompt = 'Frozen employee question') {
  return {
    version: 1,
    scoring: { goalsWeight: 40, competenciesWeight: 60 },
    stages: {},
    sections: [
      { id: 'goals', title: 'Goals', type: 'goals', respondent: 'both', required: true, questions: [{ id: 'ignored_goal', prompt: 'Core goal question', responseType: 'long_text' }] },
      { id: 'employee', title: 'Employee section', description: 'Frozen description', type: 'custom', respondent: 'employee', required: true, evidenceRequired: true, questions: [
        { id: 'reflection', prompt, responseType: 'long_text', required: true },
        { id: 'rating', prompt: 'Rate the outcome', responseType: 'rating', required: true, ratingMin: 1, ratingMax: 5 },
        { id: 'optional', prompt: 'Optional context', responseType: 'short_text', required: false }
      ] },
      { id: 'manager', title: 'Manager section', type: 'custom', respondent: 'manager', required: true, questions: [{ id: 'manager_only', prompt: 'Manager only', responseType: 'long_text' }] }
    ]
  };
}

test('conversation queue uses the frozen non-core employee questionnaire and exposes typed metadata', () => {
  const appraisal = {
    cycleConfigurationSnapshot: { workflowDefinition: design() },
    cycleId: { workflowDefinition: design('Changed live-cycle question') }
  };
  const queue = getConversationQuestionQueue(appraisal);
  assert.deepEqual(queue.map((item) => item.questionId), ['reflection', 'rating', 'optional']);
  assert.equal(queue[0].prompt, 'Frozen employee question');
  assert.equal(queue[0].sectionDescription, 'Frozen description');
  assert.equal(queue[0].evidenceRequired, true);
  assert.equal(queue[1].responseType, 'rating');
  assert.equal(queue[2].required, false);
});

test('legacy appraisal may use a live cycle design only when no frozen design exists', () => {
  const queue = getConversationQuestionQueue({ cycleId: { workflowDefinition: design('Legacy live question') } });
  assert.equal(queue[0].prompt, 'Legacy live question');
});

test('typed cycle answers reject blank numerics, invalid booleans, and unknown choices', () => {
  assert.equal(validateCycleResponseValue('', { responseType: 'number' }).valid, false);
  assert.equal(validateCycleResponseValue('   ', { responseType: 'number' }).valid, false);
  assert.equal(validateCycleResponseValue(null, { responseType: 'rating', ratingMin: 1, ratingMax: 5 }).valid, false);
  assert.equal(validateCycleResponseValue({}, { responseType: 'long_text' }).valid, false);
  assert.equal(validateCycleResponseValue('maybe', { responseType: 'boolean' }).valid, false);
  assert.deepEqual(validateCycleResponseValue(false, { responseType: 'boolean' }), { valid: true, value: false });
  assert.equal(validateCycleResponseValue(['A', 'X'], { responseType: 'multi_select', options: ['A', 'B'] }).valid, false);
  assert.deepEqual(validateCycleResponseValue(['A', 'B'], { responseType: 'multi_select', options: ['A', 'B'] }).value, ['A', 'B']);
});

test('canonical upsert deduplicates retries and progress resumes from answers plus optional skips', () => {
  const appraisal = {
    cycleConfigurationSnapshot: { workflowDefinition: design() },
    customResponses: [],
    conversationAssessment: { cycleQuestionProgress: { skippedKeys: [] } }
  };
  const queue = getConversationQuestionQueue(appraisal);
  upsertCustomResponse(appraisal, queue[0], { respondentId: 'employee-1', value: 'Initial answer' });
  upsertCustomResponse(appraisal, queue[0], { respondentId: 'employee-1', value: 'Updated answer' });
  assert.equal(appraisal.customResponses.length, 1);
  assert.equal(appraisal.customResponses[0].value, 'Updated answer');

  let state = getCycleQuestionState(appraisal);
  assert.equal(state.activeQuestion.questionId, 'rating');
  upsertCustomResponse(appraisal, queue[1], { respondentId: 'employee-1', value: 4, score: 4 });
  appraisal.conversationAssessment.cycleQuestionProgress.skippedKeys = [queue[2].key];
  state = getCycleQuestionState(appraisal);
  persistCycleQuestionProgress(appraisal, state, { now: new Date('2026-08-18T12:00:00Z') });
  assert.equal(state.progress.completed, true);
  assert.equal(state.progress.answered, 2);
  assert.equal(state.progress.skipped, 1);
  assert.equal(appraisal.conversationAssessment.cycleQuestionProgress.currentIndex, 3);
});

test('configured answers ground the fallback report and an optional-only skipped queue bypasses legacy evidence gates', async () => {
  const originalInitialize = appraisalAIService.initialize;
  const originalClient = appraisalAIService.client;
  appraisalAIService.initialize = async () => undefined;
  appraisalAIService.client = null;
  try {
    const answeredDesign = design('What outcome did your work create?');
    answeredDesign.sections[1].type = 'achievements';
    const answered = {
      cycleConfigurationSnapshot: { workflowDefinition: answeredDesign },
      customResponses: [{
        sectionId: 'employee', questionId: 'reflection', respondentRole: 'employee',
        respondentId: 'employee-1', value: 'I reduced customer wait time by 35%.'
      }],
      conversationAssessment: { extractedData: { achievements: [], challenges: [], skills: [], goals: [] } },
      chatThread: []
    };
    const groundedReport = await appraisalAIService.generateSelfAssessmentReport(answered, []);
    assert.match(groundedReport.overallSummary.achievements, /reduced customer wait time by 35%/i);
    assert.equal(groundedReport.cycleQuestionResponses.length, 1);
    assert.deepEqual(groundedReport.cycleQuestionResponses[0], {
      sectionId: 'employee',
      sectionTitle: 'Employee section',
      questionId: 'reflection',
      prompt: 'What outcome did your work create?',
      responseType: 'long_text',
      value: 'I reduced customer wait time by 35%.'
    });

    const optionalDesign = design();
    optionalDesign.sections[1].required = false;
    optionalDesign.sections[1].questions = [{
      id: 'optional_only', prompt: 'Anything else?', responseType: 'long_text', required: false
    }];
    const optionalOnly = {
      cycleConfigurationSnapshot: { workflowDefinition: optionalDesign },
      customResponses: [],
      conversationAssessment: {
        cycleQuestionProgress: { skippedKeys: ['employee:optional_only'] },
        extractedData: { achievements: [], challenges: [], skills: [], goals: [] }
      },
      chatThread: []
    };
    const optionalReport = await appraisalAIService.generateSelfAssessmentReport(optionalOnly, []);
    assert.equal(optionalReport.missingInfo, undefined);
    assert.deepEqual(optionalReport.cycleQuestionResponses, []);
  } finally {
    appraisalAIService.initialize = originalInitialize;
    appraisalAIService.client = originalClient;
  }
});
