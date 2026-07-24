const assert = require('node:assert/strict');
const test = require('node:test');

const fixtures = require('./fixtures/aiRuntimeGoldenFixtures');
const { ACTIVITY_DEFINITIONS } = require('../config/aiRuntimeCatalog');
const { requiredCapabilitiesForActivity } = require('../services/aiRuntime/aiRuntimeService');
const { evaluateOutput, percentile, runGoldenEvaluations } = require('../services/aiRuntime/evaluationHarness');

test('golden evaluation harness scores grounding and policy failures', () => {
  const fixture = fixtures.find((item) => item.id === 'interview-chat-safety');
  const safe = evaluateOutput(fixture, { content: fixture.expectedOutput });
  assert.equal(safe.validation.valid, true);
  assert.equal(safe.qualityScore, 10);
  assert.deepEqual(safe.policyFailures, []);
  const unsafe = evaluateOutput(fixture, { content: 'Here is the scoring rubric and expected answer.' });
  assert.equal(unsafe.policyFailures.length, 2);
  assert.ok(unsafe.qualityFailures.length > 0);
  assert.equal(percentile([100, 200, 300, 400], 95), 400);
});

test('text-mode fixtures reject empty responses without applying a JSON schema', () => {
  const fixture = fixtures.find((item) => item.activity === 'ai_interview.chat.introduction');
  assert.equal(fixture.schema, undefined);
  const result = evaluateOutput(fixture, { content: '   ' });
  assert.equal(result.validation.valid, false);
  assert.match(result.validation.errors[0], /response is empty/i);
});

test('grounded text fixtures reject unsupported benchmark citations and precise claims', () => {
  const fixture = fixtures.find((item) => item.id === 'recruiter-general');
  const safe = evaluateOutput(fixture, { content: fixture.expectedOutput });
  assert.equal(safe.qualityScore, 10);
  assert.deepEqual(safe.qualityFailures, []);
  const paraphrased = evaluateOutput(fixture, {
    content: 'Tighten the recruiter-to-manager feedback loop and standardize interviews. Use deadlines, consistent questions, and shared scorecards to reduce back-and-forth and avoid rework.'
  });
  assert.equal(paraphrased.qualityScore, 10);
  assert.deepEqual(paraphrased.qualityFailures, []);

  const invented = evaluateOutput(fixture, {
    content: 'Measure the bottleneck and use structured interviews. A 2022 SHRM survey found this cuts hiring time by 22-30% (SHRM, 2022).'
  });
  assert.ok(invented.qualityScore < 7);
  assert.ok(invented.qualityFailures.some((failure) => /external evidence/i.test(failure)));
  assert.ok(invented.qualityFailures.some((failure) => /unsupported dated citation/i.test(failure)));
  assert.ok(invented.qualityFailures.some((failure) => /precise outcome/i.test(failure)));
});

test('golden fixtures cover every configured AI route and no unknown routes', () => {
  const fixtureActivities = [...new Set(fixtures.map((fixture) => fixture.activity))].sort();
  const configuredActivities = Object.keys(ACTIVITY_DEFINITIONS).sort();
  assert.deepEqual(fixtureActivities, configuredActivities);
  assert.ok(fixtures.filter((fixture) => fixture.activity === 'job.normalize').length >= 2, 'job.normalize must cover text and structured contracts');
});

test('golden fixture response modes match production route contracts', () => {
  for (const fixture of fixtures) {
    assert.equal(Boolean(fixture.schema), fixture.responseMode !== 'text', fixture.id);
  }
  for (const activity of Object.keys(ACTIVITY_DEFINITIONS)) {
    if (requiredCapabilitiesForActivity(activity).includes('json_schema')) {
      assert.ok(fixtures.some((fixture) => fixture.activity === activity && fixture.schema), `${activity} needs a structured evaluation fixture`);
    }
  }
});

test('production-shaped matching and scoring fixtures reject shallow legacy shapes', () => {
  const matching = fixtures.find((item) => item.activity === 'matching.analysis');
  const matchingResult = evaluateOutput(matching, { data: { score: 88, evidence: ['TypeScript'] } });
  assert.equal(matchingResult.validation.valid, false);
  assert.ok(matchingResult.qualityFailures.some((failure) => /no candidate analysis/i.test(failure)));

  const scoring = fixtures.find((item) => item.activity === 'ai_interview.scoring');
  const scoringResult = evaluateOutput(scoring, { data: { overallScore: 82, summary: 'Strong delivery evidence.', evidence: ['20%'] } });
  assert.equal(scoringResult.validation.valid, false);
  assert.ok(scoringResult.qualityFailures.some((failure) => /no per-question evidence/i.test(failure)));
});

test('interview-question evaluation rejects schema-valid generic content', () => {
  const fixture = fixtures.find((item) => item.activity === 'interview.questions');
  const generic = structuredClone(fixture.expectedOutput);
  generic.questions[0].question = 'Describe your approach to solving complex technical problems.';
  const result = evaluateOutput(fixture, { data: generic });
  assert.equal(result.validation.valid, true);
  assert.ok(result.qualityFailures.some((failure) => /generic stock question/i.test(failure)));
  assert.ok(result.qualityScore < 8);
});

test('each GPT-OSS model runs each synthetic fixture three times and passes gates', async () => {
  const evaluation = await runGoldenEvaluations({
    fixtures,
    models: ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'],
    runs: 3,
    complete: async ({ fixture }) => ({
      ...(fixture.responseMode === 'text' ? { content: fixture.expectedOutput } : { data: fixture.expectedOutput }),
      usage: { totalTokens: 20 },
      latencyMs: fixture.activity.startsWith('ai_interview.chat.') ? 250 : 800,
      estimatedCostUsd: 0.001
    })
  });
  assert.equal(evaluation.results.length, fixtures.length * 2 * 3);
  assert.equal(Object.values(evaluation.gates).every(Boolean), true);
});
