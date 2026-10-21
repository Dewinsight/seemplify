'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ai = require('../services/appraisalAIService');

test('rating advice receives frozen role expectations and configured employee/reviewer evidence without changing human ratings', async () => {
  const prior = { client: ai.client, initialized: ai.initialized };
  let prompt;
  ai.initialized = true;
  ai.client = { chat: { completions: { create: async request => {
    prompt = request.messages[1].content;
    return { choices: [{ message: { content: JSON.stringify({ suggestedRating: 4, ratingJustification: 'A fictional advisory result, separate from native framework levels.' }) } }] };
  } } } };
  const appraisal = { employee: { name: 'Synthetic participant' }, selfAssessment: {},
    managerReview: { overallManagerRating: 3, overallSummary: { achievements: 'QA reviewer verified rollback rehearsal.' } },
    cycleConfigurationSnapshot: { roleDefinition: { role: { name: 'Pinned Solution Architect' }, criteria: [{ name: 'Architecture', code: 'ARCH', sourceName: 'Synthetic framework', expectedLevel: 'Native level 5' }] },
      workflowDefinition: { sections: ['employee', 'manager'].map(respondent => ({ id: respondent, title: `${respondent} evidence`, type: 'custom', respondent, questions: [{ id: 'evidence', prompt: `Frozen ${respondent} question`, responseType: 'long_text' }] })) } },
    cycleId: { workflowDefinition: { sections: [] } },
    customResponses: [{ sectionId: 'employee', questionId: 'evidence', respondentRole: 'employee', value: 'QA employee explained the trade-off.' },
      { sectionId: 'manager', questionId: 'evidence', respondentRole: 'manager', value: 'QA reviewer verified the decision record.' },
      { sectionId: 'unknown', questionId: 'unknown', respondentRole: 'manager', value: 'UNCONFIGURED SENTINEL' }] };
  const before = JSON.stringify(appraisal);
  try {
    const result = await ai.generateAISuggestedRating(appraisal, []);
    assert.equal(result.suggestedRating, 4);
    for (const text of ['Pinned Solution Architect', 'Native level 5', 'Frozen employee question', 'Frozen manager question', 'QA employee explained the trade-off.', 'QA reviewer verified the decision record.', 'QA reviewer verified rollback rehearsal.', 'Reviewer findings (draft', 'never convert them into a 1-5 rating']) assert.ok(prompt.includes(text), text);
    assert.ok(!prompt.includes('UNCONFIGURED SENTINEL'));
    assert.equal(JSON.stringify(appraisal), before);
  } finally { Object.assign(ai, prior); }
});
