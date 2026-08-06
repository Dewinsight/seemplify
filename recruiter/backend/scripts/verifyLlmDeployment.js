const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const AIProviderCredential = require('../models/AIProviderCredential');
const { GROQ_120B, GROQ_20B } = require('../config/aiRuntimeCatalog');

async function main() {
  if (process.env.RUN_LIVE_GROQ_CHECK !== '1') {
    console.log('Live Groq check skipped. Set RUN_LIVE_GROQ_CHECK=1 to run it outside normal CI.');
    return;
  }
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required for a live Groq check');
  if (!process.env.AI_PROVIDER_ENCRYPTION_KEY && !process.env.AI_PROVIDER_ENCRYPTION_KEYS) {
    throw new Error('The dedicated AI provider encryption key is required');
  }

  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  const credential = process.env.AI_LIVE_CHECK_CREDENTIAL_ID
    ? await AIProviderCredential.findById(process.env.AI_LIVE_CHECK_CREDENTIAL_ID)
    : await AIProviderCredential.findOne({ provider: 'groq', enabled: true, status: { $ne: 'revoked' } }).sort({ priority: 1 });
  if (!credential) throw new Error('No enabled Groq credential is available');

  const aiRuntimeService = require('../services/aiRuntime/aiRuntimeService');
  for (const model of [GROQ_20B, GROQ_120B]) {
    const result = await aiRuntimeService.testCredential(credential._id, model);
    console.log(`${model}: ${result.success ? 'healthy' : 'failed'}`);
  }
}

main()
  .catch((error) => {
    console.error(`Live Groq check failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState) await mongoose.disconnect();
  });
