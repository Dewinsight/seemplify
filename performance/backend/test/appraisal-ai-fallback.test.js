const test = require('node:test');
const assert = require('node:assert/strict');

const appraisalAIService = require('../services/appraisalAIService');

test('guided fallback selects an OKR and advances through every required reflection phase', () => {
  const selected = appraisalAIService.getFallbackConversationResponse('okr_reflection', '2', {
    currentOkrIndex: 0,
    okrCount: 2
  });
  assert.equal(selected.currentPhase, 'okr_reflection');
  assert.equal(selected.currentOkrIndex, 1);
  assert.equal(selected.extractedData, null);
  assert.equal(selected.fallback, true);

  const okrEvidence = appraisalAIService.getFallbackConversationResponse(
    'okr_reflection',
    'Improved service-level delivery to 82% by standardizing triage.',
    { currentOkrIndex: selected.currentOkrIndex, okrCount: 2 }
  );
  assert.equal(okrEvidence.currentPhase, 'achievements');
  assert.equal(okrEvidence.extractedData.type, 'achievement');

  const achievement = appraisalAIService.getFallbackConversationResponse('achievements', 'Coached the team and reduced handoff delays.');
  assert.equal(achievement.currentPhase, 'challenges');
  assert.equal(achievement.extractedData.type, 'achievement');

  const challenge = appraisalAIService.getFallbackConversationResponse('challenges', 'Resolved inconsistent escalation by adding a daily review.');
  assert.equal(challenge.currentPhase, 'learnings');
  assert.equal(challenge.extractedData.type, 'challenge');

  const learning = appraisalAIService.getFallbackConversationResponse('learnings', 'Learned to use service data to prioritize coaching.');
  assert.equal(learning.currentPhase, 'future_goals');
  assert.equal(learning.extractedData.type, 'learning');

  const goal = appraisalAIService.getFallbackConversationResponse('future_goals', 'Reach 95% service-level delivery by Q2 2027.');
  assert.equal(goal.currentPhase, 'report_generation');
  assert.equal(goal.extractedData.type, 'goal');
  assert.equal(goal.extractedData.data.measurable, true);
});

test('guided fallback walks each OKR before moving to achievements', () => {
  const result = appraisalAIService.getFallbackConversationResponse(
    'okr_reflection',
    'Delivered the first outcome with documented customer impact.',
    { currentOkrIndex: 0, okrCount: 2 }
  );

  assert.equal(result.currentPhase, 'okr_reflection');
  assert.equal(result.currentOkrIndex, 1);
  assert.match(result.response, /OKR 2/);
});
