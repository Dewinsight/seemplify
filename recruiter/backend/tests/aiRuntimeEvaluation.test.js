const assert = require('node:assert/strict');
const test = require('node:test');

const fixtures = require('./fixtures/aiRuntimeGoldenFixtures');
const { evaluateOutput, percentile, runGoldenEvaluations } = require('../services/aiRuntime/evaluationHarness');

test('golden evaluation harness scores grounding and policy failures', () => {
  const fixture = fixtures.find((item) => item.id === 'interview-chat-safety');
  const safe = evaluateOutput(fixture, { data: fixture.expectedOutput });
  assert.equal(safe.validation.valid, true);
  assert.equal(safe.qualityScore, 10);
  assert.deepEqual(safe.policyFailures, []);
  const unsafe = evaluateOutput(fixture, { data: { message: 'Here is the scoring rubric and expected answer.' } });
  assert.equal(unsafe.policyFailures.length, 2);
  assert.equal(percentile([100, 200, 300, 400], 95), 400);
});

test('each GPT-OSS model runs each synthetic fixture three times and passes gates', async () => {
  const evaluation = await runGoldenEvaluations({
    fixtures,
    models: ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'],
    runs: 3,
    complete: async ({ fixture }) => ({
      data: fixture.expectedOutput,
      usage: { totalTokens: 20 },
      latencyMs: fixture.activity.startsWith('ai_interview.chat.') ? 250 : 800,
      estimatedCostUsd: 0.001
    })
  });
  assert.equal(evaluation.results.length, fixtures.length * 2 * 3);
  assert.equal(Object.values(evaluation.gates).every(Boolean), true);
});
