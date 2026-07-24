const test = require('node:test');
const assert = require('node:assert/strict');
const {
  benchmarkErrorResult,
  compareProviderReports,
  evaluateBenchmarkResponse,
  runProvidersSequentially,
  summarizeResults
} = require('../services/aiRuntime/providerComparisonHarness');

const fixture = {
  id: 'salary',
  activity: 'job.normalize',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['min', 'max', 'currency', 'period'],
    properties: {
      min: { type: 'integer' },
      max: { type: 'integer' },
      currency: { type: 'string' },
      period: { type: 'string' }
    }
  },
  expectedKeywords: ['75000', '90000', 'GBP', 'annually'],
  qualityEvaluator: 'salary_normalization'
};

test('provider benchmark records quality, schema, token speed, and cost without raw secrets', () => {
  const result = evaluateBenchmarkResponse({
    fixture,
    provider: 'groq',
    model: 'openai/gpt-oss-20b',
    run: 1,
    response: {
      data: { min: 75000, max: 90000, currency: 'GBP', period: 'annually' },
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        prompt_tokens_details: { cached_tokens: 20 }
      }
    },
    latencyMs: 2000,
    pricing: {
      inputPerMillionUsd: 1,
      cachedInputPerMillionUsd: 0.5,
      outputPerMillionUsd: 2
    }
  });

  assert.equal(result.schemaValid, true);
  assert.equal(result.groundingPass, true);
  assert.equal(result.hallucinationPass, true);
  assert.equal(result.qualityScore, 10);
  assert.equal(result.usage.outputTokensPerSecond, 25);
  assert.equal(result.estimatedCostUsd, 0.00019);
});

test('provider errors redact Groq credentials', () => {
  const result = benchmarkErrorResult({
    fixture,
    provider: 'groq',
    model: 'openai/gpt-oss-20b',
    run: 1,
    latencyMs: 10,
    error: new Error('Bearer gsk_super_secret_key must not be shown')
  });
  assert.doesNotMatch(result.error.message, /gsk_/);
  assert.match(result.error.message, /REDACTED/);
});

test('provider execution is strictly sequential', async () => {
  let active = 0;
  let maximumActive = 0;
  const order = [];
  const reports = await runProvidersSequentially({
    providers: ['terra', 'groq'],
    runProvider: async (provider) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      order.push(`start:${provider}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(`end:${provider}`);
      active -= 1;
      return { provider };
    }
  });
  assert.equal(maximumActive, 1);
  assert.deepEqual(order, ['start:terra', 'end:terra', 'start:groq', 'end:groq']);
  assert.deepEqual(reports.map((report) => report.provider), ['terra', 'groq']);
});

test('comparison applies quality gates before latency', () => {
  const valid = evaluateBenchmarkResponse({
    fixture,
    provider: 'local-codex',
    model: 'gpt-5.6-terra',
    run: 1,
    response: {
      data: { min: 75000, max: 90000, currency: 'GBP', period: 'annually' },
      usage: { total_tokens: 100 }
    },
    latencyMs: 5000,
    pricing: {}
  });
  const invalid = benchmarkErrorResult({
    fixture,
    provider: 'groq',
    model: 'openai/gpt-oss-20b',
    run: 1,
    latencyMs: 100,
    error: new Error('quota')
  });
  const localReport = {
    provider: 'local-codex',
    model: 'gpt-5.6-terra',
    summary: summarizeResults([valid])
  };
  const groqReport = {
    provider: 'groq',
    model: 'openai/gpt-oss-20b',
    summary: summarizeResults([invalid])
  };

  const comparison = compareProviderReports([localReport, groqReport]);
  assert.equal(comparison.activities[0].recommendation, 'local-codex:gpt-5.6-terra');
  assert.equal(comparison.activities[0].confidence, 'directional-only');
});
