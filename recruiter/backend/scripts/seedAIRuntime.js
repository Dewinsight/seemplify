const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const AIProviderCredential = require('../models/AIProviderCredential');
const AIRuntimeSettings = require('../models/AIRuntimeSettings');
const { ACTIVITY_DEFINITIONS, createDefaultRuntimeSettings, GROQ_120B, GROQ_20B } = require('../config/aiRuntimeCatalog');
const { encryptSecret, fingerprintSecret, maskSecret, resolveKeyRing } = require('../services/aiRuntime/secretCrypto');
const { AzureTextRollbackAdapter } = require('../services/aiRuntime/azureTextRollbackAdapter');

function hasFlag(name) {
  return process.argv.includes(name);
}

function createBootstrapSettings(env = process.env) {
  const settings = createDefaultRuntimeSettings();
  const groqPercent = Number(env.GROQ_BOOTSTRAP_ROLLOUT_PERCENT || 10);
  if (![10, 50, 100].includes(groqPercent)) {
    throw new Error('GROQ_BOOTSTRAP_ROLLOUT_PERCENT must be 10, 50, or 100');
  }
  settings.rollout = {
    ...settings.rollout,
    groqPercent,
    azureBaselineEnabled: groqPercent < 100
  };
  return settings;
}

function mergeCatalogSettings(current, defaults) {
  const existingModels = new Map((current.models || []).map((model) => [model.id, model]));
  const defaultModelIds = new Set(defaults.models.map((model) => model.id));
  const models = defaults.models.map((catalogModel) => {
    const existing = existingModels.get(catalogModel.id) || {};
    return {
      ...catalogModel,
      ...existing,
      id: catalogModel.id,
      provider: catalogModel.provider,
      capabilities: catalogModel.capabilities,
      pricing: catalogModel.pricing,
      documentedLimits: catalogModel.documentedLimits,
      contextWindow: catalogModel.contextWindow,
      maxOutputTokens: catalogModel.maxOutputTokens
    };
  });
  models.push(...(current.models || []).filter((model) => !defaultModelIds.has(model.id)));

  const existingRoutes = new Map((current.routes || []).map((route) => [route.activity, route]));
  const defaultActivities = new Set(defaults.routes.map((route) => route.activity));
  const routes = defaults.routes.map((route) => {
    const existing = existingRoutes.get(route.activity);
    const definition = ACTIVITY_DEFINITIONS[route.activity];
    const shouldApplyNewLocalDefault = definition?.defaultLocal
      && existing?.provider === 'groq'
      && Number(existing?.routeVersion || 1) === 1;
    return definition?.lockedProvider || shouldApplyNewLocalDefault
      ? { ...(existing || {}), ...route }
      : { ...route, ...(existing || {}) };
  });
  routes.push(...(current.routes || []).filter((route) => !defaultActivities.has(route.activity)));

  const currentRollout = current.rollout || {};
  const unmanagedGroqOnlyDefault = Number(currentRollout.groqPercent) === 100
    && currentRollout.azureBaselineEnabled === false
    && !currentRollout.updatedAt
    && !currentRollout.updatedBy
    && !current.updatedBy;

  return {
    providerEnabled: current.providerEnabled ?? defaults.providerEnabled,
    models,
    routes,
    quotaGroups: current.quotaGroups?.length ? current.quotaGroups : defaults.quotaGroups,
    alerts: { ...defaults.alerts, ...(current.alerts || {}) },
    localFailover: { ...defaults.localFailover, ...(current.localFailover || {}) },
    rollout: unmanagedGroqOnlyDefault
      ? { ...defaults.rollout }
      : { ...defaults.rollout, ...currentRollout }
  };
}

async function main() {
  const apply = hasFlag('--apply');
  const apiKey = String(process.env.GROQ_BOOTSTRAP_API_KEY || '').trim();
  if (!apiKey) throw new Error('GROQ_BOOTSTRAP_API_KEY is required. Use a newly rotated key, never a key pasted into chat.');
  if (!apiKey.startsWith('gsk_')) throw new Error('GROQ_BOOTSTRAP_API_KEY does not look like a Groq API key.');
  resolveKeyRing();

  const defaults = createBootstrapSettings();
  const fingerprint = fingerprintSecret(apiKey);
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Credential: ${maskSecret(apiKey)} (${fingerprint.slice(0, 12)}...)`);
  console.log(`Models: ${GROQ_120B}, ${GROQ_20B}`);
  console.log(`Activity routes: ${defaults.routes.length}`);
  console.log(`Bootstrap rollout default: ${defaults.rollout.groqPercent}% Groq`);

  if (!apply) {
    if (defaults.rollout.azureBaselineEnabled) new AzureTextRollbackAdapter().assertConfigured();
    console.log('No database changes made. Re-run with --apply after reviewing this output.');
    return;
  }
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required when applying the AI runtime seed.');

  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  const quotaGroup = process.env.GROQ_BOOTSTRAP_QUOTA_GROUP || 'groq-primary';
  let seededSettings = await AIRuntimeSettings.findOne({ key: 'global' });
  if (!seededSettings) {
    if (defaults.rollout.azureBaselineEnabled) new AzureTextRollbackAdapter().assertConfigured();
    seededSettings = await AIRuntimeSettings.create(defaults);
  } else {
    const merged = mergeCatalogSettings(seededSettings.toObject(), defaults);
    if (merged.rollout.azureBaselineEnabled) new AzureTextRollbackAdapter().assertConfigured();
    Object.assign(seededSettings, merged);
    seededSettings.version = Number(seededSettings.version || 0) + 1;
    await seededSettings.save();
  }
  console.log(`Effective rollout: ${seededSettings.rollout.groqPercent}% Groq`);
  if (!seededSettings.quotaGroups.some((group) => group.id === quotaGroup)) {
    seededSettings.quotaGroups.push({
      id: quotaGroup,
      label: process.env.GROQ_BOOTSTRAP_QUOTA_GROUP_LABEL || quotaGroup,
      enabled: true,
      independentQuotaConfirmed: quotaGroup === 'groq-primary'
    });
    await seededSettings.save();
  }

  let credential = await AIProviderCredential.findOne({ fingerprint }).select('+encryptedSecret');
  if (credential?.status === 'revoked' || !credential?.encryptedSecret) {
    throw new Error('This key fingerprint belongs to a revoked credential. Bootstrap with a newly rotated key.');
  }
  if (!credential) {
    credential = await AIProviderCredential.create({
      provider: 'groq',
      label: process.env.GROQ_BOOTSTRAP_LABEL || 'Groq primary',
      encryptedSecret: encryptSecret(apiKey),
      fingerprint,
      lastFour: apiKey.slice(-4),
      quotaGroup,
      projectLabel: process.env.GROQ_BOOTSTRAP_PROJECT_LABEL || '',
      priority: Number(process.env.GROQ_BOOTSTRAP_PRIORITY || 100),
      enabled: true,
      status: 'unknown'
    });
    console.log(`Created credential ${credential.id}.`);
  } else {
    if (!credential.enabled || credential.status === 'disabled') {
      throw new Error('The existing bootstrap credential is disabled. Enable or rotate it through the admin before seeding again.');
    }
    console.log(`Credential ${credential.id} already exists; no duplicate was created.`);
  }

  const aiRuntimeService = require('../services/aiRuntime/aiRuntimeService');
  aiRuntimeService.invalidateSettingsCache();
  try {
    for (const model of [GROQ_20B, GROQ_120B]) {
      const result = await aiRuntimeService.testCredential(credential._id, model);
      console.log(`Verified ${result.model}: ${result.response.slice(0, 20)}`);
    }
    const sync = await aiRuntimeService.syncModels(credential._id);
    const requiredModels = sync.models.filter((model) => [GROQ_20B, GROQ_120B].includes(model.id));
    if (requiredModels.some((model) => model.available !== true)) {
      throw new Error('One or more required GPT-OSS models are unavailable to this Groq project');
    }
  } catch (error) {
    await AIProviderCredential.updateOne({ _id: credential._id }, {
      $set: { enabled: false, status: 'disabled', lastError: { code: error.code || 'BOOTSTRAP_VERIFICATION_FAILED', message: error.message, at: new Date() } }
    });
    throw error;
  }

  console.log('AI runtime seed complete. Remove GROQ_BOOTSTRAP_API_KEY from the environment now.');
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(`AI runtime seed failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      if (mongoose.connection.readyState) await mongoose.disconnect();
    });
}

module.exports = { createBootstrapSettings, mergeCatalogSettings };
