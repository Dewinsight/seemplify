/**
 * Verifies Azure chat deployment config and pings the model (same stack as production).
 * Usage: from recruiter/backend: npm run test:llm
 * Requires .env with LLAMA_* or azure_openai_* (see docs/llama-env-vars.txt).
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { resolveLlmRuntimeConfig, DEFAULT_DEPLOYMENT } = require('../config/llmRuntimeConfig');

async function main() {
  const cfg = resolveLlmRuntimeConfig();
  console.log('Resolved deployment name:', cfg.deployment);
  console.log('Default when env unset:', DEFAULT_DEPLOYMENT);
  console.log('API version:', cfg.apiVersion);
  console.log('Endpoint present:', !!cfg.endpoint);
  console.log('API key present:', !!cfg.apiKey);

  if (!cfg.endpoint || !cfg.apiKey) {
    console.error('\n❌ Missing endpoint or API key. Set LLAMA_AZURE_* or azure_openai_* in recruiter/backend/.env');
    process.exit(1);
  }

  const AzureOpenAIService = require('../services/azureOpenAIService');
  const gptAnalysisService = require('../services/gptAnalysisService');

  const svc = new AzureOpenAIService();
  console.log('\nChat service model:', svc.modelName);
  console.log('Matching analysis model:', gptAnalysisService.modelName);
  console.log('ENABLE_LLM_MATCHING:', gptAnalysisService.isEnabled);

  const result = await svc.testConnection();
  if (result.success) {
    console.log('\n✅ testConnection OK. Sample reply:', (result.response || '').slice(0, 200));
    process.exit(0);
  }
  console.error('\n❌ testConnection failed:', result.error);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
