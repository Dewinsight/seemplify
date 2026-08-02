const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const fixtures = require('../tests/fixtures/aiRuntimeGoldenFixtures');
const { GROQ_120B, GROQ_20B } = require('../config/aiRuntimeCatalog');
const { calculateEstimatedCost, normalizeUsage } = require('../services/aiRuntime/usageService');
const { runGoldenEvaluations } = require('../services/aiRuntime/evaluationHarness');

async function createLiveCompletion() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required for live evaluations');
  if (!process.env.AI_EVAL_CREDENTIAL_ID) throw new Error('AI_EVAL_CREDENTIAL_ID is required for live evaluations');
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  const runtime = require('../services/aiRuntime/aiRuntimeService');
  const credential = await runtime.getCredential(process.env.AI_EVAL_CREDENTIAL_ID);
  const settings = await runtime.getSettings({ force: true });

  return async ({ fixture, model }) => {
    const modelConfig = settings.models.find((item) => item.id === model);
    if (!modelConfig) throw new Error(`Model ${model} is not configured`);
    const route = { activity: fixture.activity, provider: 'groq', model, reasoningEffort: 'medium', routeVersion: 1, modelConfig };
    const request = {
      messages: fixture.messages,
      temperature: 0.2,
      max_tokens: 2500
    };
    if (fixture.schema) {
      request.response_format = {
        type: 'json_schema',
        json_schema: { name: fixture.id.replace(/-/g, '_'), strict: true, schema: fixture.schema }
      };
    }
    const payload = runtime.normalizePayload(request, route);
    const startedAt = Date.now();
    const response = await runtime.providerRequest({ credential, payload, timeoutMs: 90000 });
    if (!response.ok) throw await runtime.parseErrorResponse(response);
    const data = await response.json();
    const usage = normalizeUsage(data.usage || {});
    return {
      content: data.choices?.[0]?.message?.content,
      usage,
      latencyMs: Date.now() - startedAt,
      estimatedCostUsd: calculateEstimatedCost(usage, modelConfig.pricing)
    };
  };
}

async function main() {
  const live = process.env.RUN_LIVE_GROQ_EVAL === '1';
  const complete = live
    ? await createLiveCompletion()
    : async ({ fixture }) => ({
      ...(fixture.responseMode === 'text' ? { content: fixture.expectedOutput } : { data: fixture.expectedOutput }),
      usage: { totalTokens: 20 },
      latencyMs: 250,
      estimatedCostUsd: 0
    });
  const evaluation = await runGoldenEvaluations({ fixtures, models: [GROQ_20B, GROQ_120B], runs: 3, complete });
  console.log(JSON.stringify({ mode: live ? 'live' : 'synthetic-dry-run', summary: evaluation.summary, gates: evaluation.gates }, null, 2));
  if (!Object.values(evaluation.gates).every(Boolean)) process.exitCode = 1;
}

main()
  .catch((error) => { console.error(`AI runtime evaluation failed: ${error.message}`); process.exitCode = 1; })
  .finally(async () => { if (mongoose.connection.readyState) await mongoose.disconnect(); });
