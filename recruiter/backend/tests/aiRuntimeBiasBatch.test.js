const assert = require('node:assert/strict');
const test = require('node:test');

const AIModelService = require('../services/aiModelService');
const InterviewService = require('../services/interviewService');

function neutralAnalysis(questionIndex) {
  return {
    questionIndex,
    overallBiasScore: 0.04,
    isBiased: false,
    detectedBiasFactors: [],
    neutralityConfidence: 0.96,
    recommendation: 'The question is job relevant and neutrally worded.'
  };
}

test('bias analysis batches questions, preserves indexes, and allocates a reasoning-safe token budget', async () => {
  const service = new AIModelService();
  const calls = [];
  service.structuredCompletion = async (messages, options) => {
    const input = JSON.parse(messages.at(-1).content);
    calls.push({ input, options });
    return { data: { analyses: input.questions.map(({ questionIndex }) => neutralAnalysis(questionIndex)) } };
  };

  const result = await service.analyzeQuestionsForBias([
    'How would you prioritize a roadmap under conflicting customer deadlines?',
    'Tell me about a Kubernetes incident you diagnosed using production telemetry?',
    'How would you validate a PostgreSQL migration rollback plan?',
    'Describe a past stakeholder disagreement and the evidence you used to resolve it?',
    'If a release doubled latency, how would you decide whether to roll it back?',
    'How would you measure the success of an onboarding workflow redesign?'
  ], 'Product and platform engineering context');

  assert.equal(result.success, true);
  assert.equal(result.analyses.length, 6);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.input.questions.length), [5, 1]);
  assert.ok(calls[0].options.maxTokens > 3000);
  assert.equal(calls[0].options.promptVersion, 'interview-bias-v3');
  assert.equal(calls[0].options.schemaName, 'interview_bias_batch');
});

test('bias analysis fails closed when indexes are missing instead of manufacturing a neutral result', async () => {
  const service = new AIModelService();
  service.structuredCompletion = async () => ({ data: { analyses: [neutralAnalysis(0), neutralAnalysis(0)] } });

  const result = await service.analyzeQuestionsForBias(['Question one?', 'Question two?'], 'Job context');
  assert.equal(result.success, false);
  assert.deepEqual(result.analyses, [null, null]);
  assert.match(result.error, /missing or duplicate question indexes/i);
});

test('bias analysis keeps original question positions when malformed blanks are skipped', async () => {
  const service = new AIModelService();
  service.structuredCompletion = async (messages) => {
    const input = JSON.parse(messages.at(-1).content);
    return { data: { analyses: input.questions.map(({ questionIndex }) => neutralAnalysis(questionIndex)) } };
  };

  const result = await service.analyzeQuestionsForBias([
    'How would you measure a platform reliability improvement?',
    '   ',
    'How would you prioritize two conflicting launch risks?'
  ], 'Platform engineering');

  assert.equal(result.success, false);
  assert.equal(result.partial, true);
  assert.equal(result.analyses.length, 3);
  assert.equal(result.analyses[0].recommendation.includes('neutrally'), true);
  assert.equal(result.analyses[1], null);
  assert.equal(result.analyses[2].recommendation.includes('neutrally'), true);
});

test('bias analysis rejects internally inconsistent decisions', async () => {
  const service = new AIModelService();
  service.structuredCompletion = async () => ({
    data: {
      analyses: [{
        ...neutralAnalysis(0),
        overallBiasScore: 0.8,
        isBiased: false
      }]
    }
  });

  const result = await service.analyzeTextForBias('How would you handle a production incident?', 'Engineering');
  assert.equal(result.success, false);
  assert.equal(result.analysis, null);
  assert.match(result.error, /conflicts with its bias decision/i);
});

test('interview validation maps partial bias batches to explicit manual review', async () => {
  const service = new InterviewService();
  service.aiModelService = {
    analyzeQuestionsForBias: async () => ({
      success: false,
      partial: true,
      analyses: [neutralAnalysis(0), null],
      error: 'Second batch failed'
    })
  };

  const mapped = await service._analyzeBiasBatch(['First question?', 'Second question?'], 'Job context');
  assert.equal(mapped[0].analysisStatus, 'complete');
  assert.equal(mapped[1].analysisStatus, 'manual_review');
  assert.equal(mapped[1].biasScore, null);
  assert.match(mapped[1].recommendation, /manual review/i);
});
