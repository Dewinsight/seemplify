const AIAuditEvent = require('../models/AIAuditEvent');
const AIProviderCredential = require('../models/AIProviderCredential');
const AIQuotaSnapshot = require('../models/AIQuotaSnapshot');
const AIRuntimeSettings = require('../models/AIRuntimeSettings');
const AIUsageDailyRollup = require('../models/AIUsageDailyRollup');
const AIUsageEvent = require('../models/AIUsageEvent');
const {
  ACTIVITY_DEFINITIONS,
  GROQ_120B,
  GROQ_20B,
  createDefaultRuntimeSettings
} = require('../config/aiRuntimeCatalog');
const aiRuntimeService = require('./aiRuntime/aiRuntimeService');
const { encryptSecret, fingerprintSecret, maskSecret } = require('./aiRuntime/secretCrypto');

function serializeCredential(credential) {
  const raw = typeof credential?.toObject === 'function' ? credential.toObject() : credential;
  if (!raw) return null;
  delete raw.encryptedSecret;
  return { ...raw, maskedKey: raw.lastFour ? `****${raw.lastFour}` : 'Not stored' };
}

function auditContext(req) {
  return {
    actorAdmin: req.admin?._id,
    actorEmail: req.admin?.email,
    ipAddress: req.ip,
    userAgent: req.get?.('user-agent')
  };
}

async function writeAudit(req, event) {
  return AIAuditEvent.create({ category: 'configuration', status: 'success', ...auditContext(req), ...event });
}

async function getRuntimeSettings() {
  const settings = await aiRuntimeService.getSettings({ force: true });
  return {
    ...settings,
    activityDefinitions: Object.entries(ACTIVITY_DEFINITIONS).map(([activity, definition]) => ({ activity, ...definition }))
  };
}

async function listCredentials() {
  const credentials = await AIProviderCredential.find({ status: { $ne: 'revoked' } }).sort({ priority: 1, createdAt: 1 }).lean();
  return credentials.map(serializeCredential);
}

function validateApiKey(apiKey) {
  const value = String(apiKey || '').trim();
  if (!value) throw new TypeError('Groq API key is required');
  if (!value.startsWith('gsk_') || value.length < 20) throw new TypeError('Groq API key format is invalid');
  return value;
}

async function createCredential(input, req) {
  const apiKey = validateApiKey(input.apiKey);
  const label = String(input.label || '').trim();
  if (!label || label.length > 100) throw new TypeError('Credential label is required and must be 100 characters or fewer');
  const priority = Number(input.priority ?? 100);
  if (!Number.isInteger(priority) || priority < 1 || priority > 10000) {
    throw new TypeError('Credential priority must be an integer from 1 to 10000');
  }
  const settings = await aiRuntimeService.getSettings({ force: true });
  const quotaGroup = String(input.quotaGroup || 'groq-primary').trim();
  if (!settings.quotaGroups.some((group) => group.id === quotaGroup && group.enabled !== false)) {
    throw new TypeError('Select a configured Groq quota group');
  }
  const fingerprint = fingerprintSecret(apiKey);
  const duplicate = await AIProviderCredential.findOne({ fingerprint });
  if (duplicate) throw new TypeError('This Groq API key is already stored');

  const credential = await AIProviderCredential.create({
    provider: 'groq',
    label,
    encryptedSecret: encryptSecret(apiKey),
    fingerprint,
    lastFour: apiKey.slice(-4),
    quotaGroup,
    projectLabel: String(input.projectLabel || '').trim(),
    priority,
    enabled: true,
    status: 'unknown',
    createdBy: req.admin?._id,
    updatedBy: req.admin?._id
  });

  let health;
  try {
    const models = [];
    for (const model of [GROQ_20B, GROQ_120B]) {
      models.push(await aiRuntimeService.testCredential(credential._id, model));
    }
    const sync = await aiRuntimeService.syncModels(credential._id);
    const required = sync.models.filter((model) => [GROQ_20B, GROQ_120B].includes(model.id));
    if (required.length !== 2 || required.some((model) => model.available !== true)) {
      throw new Error('The Groq project does not expose both required GPT-OSS models');
    }
    health = { success: true, models: models.map((item) => item.model) };
  } catch (error) {
    await AIProviderCredential.deleteOne({ _id: credential._id });
    await writeAudit(req, {
      category: 'credential', action: 'credential_create_failed', status: 'failed',
      targetType: 'AIProviderCredential', targetId: String(credential._id), quotaGroup,
      message: `Groq credential verification failed: ${String(error.code || 'provider_error')}`,
      metadata: { fingerprint }
    });
    throw new TypeError(`Credential verification failed: ${error.message}`);
  }

  await writeAudit(req, {
    category: 'credential',
    action: 'credential_created',
    targetType: 'AIProviderCredential',
    targetId: String(credential._id),
    quotaGroup: credential.quotaGroup,
    message: `Created Groq credential ${credential.label}`,
    metadata: { fingerprint: credential.fingerprint, verifiedModels: health.models }
  });

  const refreshed = await AIProviderCredential.findById(credential._id).lean();
  return { credential: serializeCredential(refreshed), health };
}

async function createQuotaGroup(input, req) {
  const label = String(input.label || '').trim();
  if (!label) throw new TypeError('Quota group label is required');
  if (input.independentQuotaConfirmed !== true) {
    throw new TypeError('Confirm that this group has an independent authorized Groq quota scope');
  }
  const id = String(input.id || label).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '');
  if (!id) throw new TypeError('Quota group identifier is invalid');
  const settings = await aiRuntimeService.getSettings({ force: true });
  if (settings.quotaGroups.some((group) => group.id === id)) throw new TypeError('Quota group already exists');
  const quotaGroups = [...settings.quotaGroups, {
    id,
    label,
    enabled: true,
    independentQuotaConfirmed: true,
    confirmedAt: new Date(),
    confirmedBy: req.admin?._id
  }];
  await AIRuntimeSettings.updateOne({ key: 'global' }, {
    $set: { quotaGroups, updatedBy: req.admin?._id }, $inc: { version: 1 }
  }, { upsert: true });
  aiRuntimeService.invalidateSettingsCache();
  await writeAudit(req, {
    action: 'quota_group_created', targetType: 'AIQuotaGroup', targetId: id, quotaGroup: id,
    message: `Created independent Groq quota group ${label}`
  });
  return getRuntimeSettings();
}

async function rotateCredential(id, input, req) {
  const existing = await AIProviderCredential.findById(id);
  if (!existing || existing.status === 'revoked') throw new TypeError('Credential not found');
  const apiKey = validateApiKey(input.apiKey);
  const fingerprint = fingerprintSecret(apiKey);
  const duplicate = await AIProviderCredential.findOne({ fingerprint, _id: { $ne: existing._id } });
  if (duplicate) throw new TypeError('This Groq API key is already stored');

  const previous = {
    encryptedSecret: (await AIProviderCredential.findById(id).select('+encryptedSecret')).encryptedSecret,
    fingerprint: existing.fingerprint,
    lastFour: existing.lastFour,
    enabled: existing.enabled,
    status: existing.status,
    blockedModels: existing.blockedModels || [],
    cooldownUntil: existing.cooldownUntil || null,
    consecutiveFailures: Number(existing.consecutiveFailures || 0),
    lastError: existing.lastError || null,
    lastSuccessAt: existing.lastSuccessAt || null,
    lastCheckedAt: existing.lastCheckedAt || null
  };
  existing.encryptedSecret = encryptSecret(apiKey);
  existing.fingerprint = fingerprint;
  existing.lastFour = apiKey.slice(-4);
  existing.enabled = true;
  existing.status = 'unknown';
  existing.updatedBy = req.admin?._id;
  await existing.save();

  try {
    const checks = [];
    for (const model of [GROQ_20B, GROQ_120B]) {
      checks.push(await aiRuntimeService.testCredential(existing._id, model));
    }
    const sync = await aiRuntimeService.syncModels(existing._id);
    const required = sync.models.filter((model) => [GROQ_20B, GROQ_120B].includes(model.id));
    if (required.length !== 2 || required.some((model) => model.available !== true)) {
      throw new Error('The Groq project does not expose both required GPT-OSS models');
    }
    const health = { success: true, models: checks.map((item) => item.model) };
    await writeAudit(req, {
      category: 'credential', action: 'credential_rotated', targetType: 'AIProviderCredential',
      targetId: String(existing._id), quotaGroup: existing.quotaGroup,
      message: `Rotated Groq credential ${existing.label}`, metadata: { fingerprint }
    });
    return { credential: serializeCredential(await AIProviderCredential.findById(id).lean()), health };
  } catch (error) {
    await AIProviderCredential.updateOne({ _id: id }, { $set: previous });
    try {
      await writeAudit(req, {
        category: 'credential', action: 'credential_rotation_failed', status: 'failed',
        targetType: 'AIProviderCredential', targetId: String(existing._id), quotaGroup: existing.quotaGroup,
        message: `Replacement key verification failed for ${existing.label}`,
        metadata: { fingerprint, errorCode: String(error.code || 'provider_error') }
      });
    } catch (auditError) {
      console.error('Failed to audit Groq credential rotation failure', auditError);
    }
    throw new TypeError(`Replacement key failed verification: ${error.message}`);
  }
}

async function setCredentialEnabled(id, enabled, req) {
  const credential = await AIProviderCredential.findOneAndUpdate({ _id: id, status: { $ne: 'revoked' } }, {
    $set: {
      enabled: Boolean(enabled),
      status: enabled ? 'unknown' : 'disabled',
      updatedBy: req.admin?._id,
      cooldownUntil: null
    }
  }, { new: true });
  if (!credential) throw new TypeError('Credential not found');
  await writeAudit(req, {
    category: 'credential', action: enabled ? 'credential_enabled' : 'credential_disabled',
    targetType: 'AIProviderCredential', targetId: String(id), quotaGroup: credential.quotaGroup,
    message: `${enabled ? 'Enabled' : 'Disabled'} Groq credential ${credential.label}`
  });
  return serializeCredential(credential);
}

async function revokeCredential(id, req) {
  const credential = await AIProviderCredential.findById(id).select('+encryptedSecret');
  if (!credential) throw new TypeError('Credential not found');
  credential.enabled = false;
  credential.status = 'revoked';
  credential.revokedAt = new Date();
  credential.updatedBy = req.admin?._id;
  credential.encryptedSecret = undefined;
  await AIProviderCredential.updateOne({ _id: id }, {
    $set: { enabled: false, status: 'revoked', revokedAt: new Date(), updatedBy: req.admin?._id },
    $unset: { encryptedSecret: 1 }
  });
  await writeAudit(req, {
    category: 'credential', action: 'credential_revoked', targetType: 'AIProviderCredential',
    targetId: String(id), quotaGroup: credential.quotaGroup, message: `Revoked Groq credential ${credential.label}`
  });
  return { success: true };
}

async function updateRoute(activity, input, req) {
  if (!ACTIVITY_DEFINITIONS[activity]) throw new TypeError('Unknown AI activity');
  const settings = await aiRuntimeService.getSettings({ force: true });
  const model = settings.models.find((item) => item.id === input.model && item.enabled !== false);
  if (!model) throw new TypeError('Selected model is not enabled');
  if (model.available !== true) throw new TypeError('Sync Groq models and verify access before assigning this model');
  if (!Array.isArray(model.capabilities) || !model.capabilities.includes('text') || !model.capabilities.includes('reasoning')) {
    throw new TypeError('Selected model does not support this activity');
  }
  const effort = String(input.reasoningEffort || 'medium');
  if (!['low', 'medium', 'high'].includes(effort)) throw new TypeError('Reasoning effort must be low, medium, or high');
  const routes = settings.routes.map((route) => route.activity === activity ? {
    ...route,
    provider: 'groq',
    model: model.id,
    reasoningEffort: effort,
    enabled: input.enabled !== false,
    routeVersion: Number(route.routeVersion || 1) + 1
  } : route);
  await AIRuntimeSettings.updateOne({ key: 'global' }, {
    $set: { routes, updatedBy: req.admin?._id },
    $inc: { version: 1 }
  }, { upsert: true });
  aiRuntimeService.invalidateSettingsCache();
  await writeAudit(req, {
    action: 'route_updated', targetType: 'AIActivityRoute', targetId: activity, model: model.id,
    message: `Updated ${activity} to ${model.id}`, metadata: { reasoningEffort: effort, enabled: input.enabled !== false }
  });
  return getRuntimeSettings();
}

async function updateAlerts(input, req) {
  const settings = await aiRuntimeService.getSettings({ force: true });
  const recipients = Array.isArray(input.recipients)
    ? Array.from(new Set(input.recipients.map((email) => String(email).trim().toLowerCase()).filter(Boolean)))
    : settings.alerts.recipients;
  if (recipients.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new TypeError('Every alert recipient must be a valid email address');
  }
  const requestedBudget = input.monthlyBudgetUsd === '' || input.monthlyBudgetUsd == null
    ? null
    : Number(input.monthlyBudgetUsd);
  if (requestedBudget !== null && (!Number.isFinite(requestedBudget) || requestedBudget < 0)) {
    throw new TypeError('Monthly budget must be a non-negative number or blank');
  }
  const alerts = {
    ...settings.alerts,
    enabled: input.enabled !== false,
    recipients,
    monthlyBudgetUsd: requestedBudget
  };
  await AIRuntimeSettings.updateOne({ key: 'global' }, {
    $set: { alerts, updatedBy: req.admin?._id }, $inc: { version: 1 }
  }, { upsert: true });
  aiRuntimeService.invalidateSettingsCache();
  await writeAudit(req, {
    action: 'alerts_updated', targetType: 'AIRuntimeSettings', targetId: 'global',
    message: 'Updated AI runtime alert settings', metadata: { enabled: alerts.enabled, recipientCount: alerts.recipients.length, monthlyBudgetUsd: alerts.monthlyBudgetUsd }
  });
  return getRuntimeSettings();
}

async function updateRollout(input, req) {
  const groqPercent = Number(input.groqPercent);
  if (![10, 50, 100].includes(groqPercent)) {
    throw new TypeError('Groq rollout must be 10%, 50%, or 100%');
  }
  const settings = await aiRuntimeService.getSettings({ force: true });
  if (groqPercent < 100) aiRuntimeService.azureRollback.assertConfigured();
  const rollout = {
    ...settings.rollout,
    groqPercent,
    azureBaselineEnabled: groqPercent < 100,
    samplingSalt: settings.rollout?.samplingSalt || 'groq-gpt-oss-v1',
    updatedAt: new Date(),
    updatedBy: req.admin?._id
  };
  await AIRuntimeSettings.updateOne({ key: 'global' }, {
    $set: { rollout, updatedBy: req.admin?._id }, $inc: { version: 1 }
  }, { upsert: true });
  aiRuntimeService.invalidateSettingsCache();
  await writeAudit(req, {
    action: 'rollout_updated', targetType: 'AIRuntimeSettings', targetId: 'global',
    message: groqPercent === 100
      ? 'Completed Groq rollout; Azure text baseline is disabled'
      : `Set deterministic Groq canary to ${groqPercent}%`,
    metadata: { groqPercent, azureBaselineEnabled: rollout.azureBaselineEnabled }
  });
  return getRuntimeSettings();
}

function rangeStart(range) {
  if (range === 'all') return null;
  const days = { '7d': 7, '30d': 30, '90d': 90 }[range] || 30;
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start;
}

function percentile(sorted, value) {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((value / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

async function getOverview({ range = '30d' } = {}) {
  const start = rangeStart(range);
  const match = start ? { day: { $gte: start } } : {};
  const [totalsRows, byActivity, byModel, byProvider, bySource, organizations, actors, trend, quotas, latencies] = await Promise.all([
    AIUsageDailyRollup.aggregate([{ $match: match }, { $group: {
      _id: null, calls: { $sum: '$calls' }, successes: { $sum: '$successes' }, failures: { $sum: '$failures' },
      inputTokens: { $sum: '$inputTokens' }, cachedInputTokens: { $sum: '$cachedInputTokens' },
      outputTokens: { $sum: '$outputTokens' }, totalTokens: { $sum: '$totalTokens' },
      estimatedCostUsd: { $sum: '$estimatedCostUsd' }, latencyTotalMs: { $sum: '$latencyTotalMs' }
    } }]),
    AIUsageDailyRollup.aggregate([{ $match: match }, { $group: { _id: '$activity', calls: { $sum: '$calls' }, failures: { $sum: '$failures' }, tokens: { $sum: '$totalTokens' }, cost: { $sum: '$estimatedCostUsd' } } }, { $sort: { calls: -1 } }]),
    AIUsageDailyRollup.aggregate([{ $match: match }, { $group: { _id: '$model', calls: { $sum: '$calls' }, failures: { $sum: '$failures' }, tokens: { $sum: '$totalTokens' }, cost: { $sum: '$estimatedCostUsd' } } }, { $sort: { calls: -1 } }]),
    AIUsageDailyRollup.aggregate([{ $match: match }, { $group: { _id: '$provider', calls: { $sum: '$calls' }, failures: { $sum: '$failures' }, tokens: { $sum: '$totalTokens' }, cost: { $sum: '$estimatedCostUsd' } } }, { $sort: { calls: -1 } }]),
    AIUsageDailyRollup.aggregate([{ $match: match }, { $group: { _id: '$sourceApp', calls: { $sum: '$calls' }, failures: { $sum: '$failures' }, tokens: { $sum: '$totalTokens' }, cost: { $sum: '$estimatedCostUsd' } } }, { $sort: { calls: -1 } }]),
    AIUsageDailyRollup.aggregate([{ $match: { ...match, organizationId: { $ne: '' } } }, { $group: { _id: '$organizationId', name: { $last: '$organizationName' }, calls: { $sum: '$calls' }, failures: { $sum: '$failures' }, tokens: { $sum: '$totalTokens' }, cost: { $sum: '$estimatedCostUsd' } } }, { $sort: { calls: -1 } }, { $limit: 20 }]),
    AIUsageDailyRollup.aggregate([{ $match: { ...match, actorId: { $ne: '' } } }, { $group: { _id: '$actorId', name: { $last: '$actorName' }, calls: { $sum: '$calls' }, failures: { $sum: '$failures' }, tokens: { $sum: '$totalTokens' }, cost: { $sum: '$estimatedCostUsd' } } }, { $sort: { calls: -1 } }, { $limit: 20 }]),
    AIUsageDailyRollup.aggregate([{ $match: match }, { $group: { _id: '$day', calls: { $sum: '$calls' }, failures: { $sum: '$failures' }, tokens: { $sum: '$totalTokens' }, cost: { $sum: '$estimatedCostUsd' } } }, { $sort: { _id: 1 } }]),
    AIQuotaSnapshot.find({}).sort({ quotaGroup: 1, model: 1 }).lean(),
    AIUsageEvent.find({ ...(start ? { createdAt: { $gte: start } } : {}), latencyMs: { $ne: null } }).select('latencyMs').sort({ createdAt: -1 }).limit(50000).lean()
  ]);
  const totals = totalsRows[0] || {};
  const sortedLatencies = latencies.map((item) => Number(item.latencyMs || 0)).sort((a, b) => a - b);
  return {
    range,
    totals: {
      calls: Number(totals.calls || 0), successes: Number(totals.successes || 0), failures: Number(totals.failures || 0),
      successRate: totals.calls ? Number(((totals.successes / totals.calls) * 100).toFixed(1)) : 0,
      inputTokens: Number(totals.inputTokens || 0), cachedInputTokens: Number(totals.cachedInputTokens || 0),
      outputTokens: Number(totals.outputTokens || 0), totalTokens: Number(totals.totalTokens || 0),
      estimatedCostUsd: Number(Number(totals.estimatedCostUsd || 0).toFixed(4)),
      averageLatencyMs: totals.calls ? Math.round(Number(totals.latencyTotalMs || 0) / totals.calls) : 0,
      p50LatencyMs: percentile(sortedLatencies, 50), p95LatencyMs: percentile(sortedLatencies, 95),
      latencyWindow: range === 'all' ? 'retained-detail-window' : range
    },
    byActivity, byModel, byProvider, bySource, organizations, actors,
    trend: trend.map((item) => ({ date: item._id, calls: item.calls, failures: item.failures, tokens: item.tokens, cost: item.cost })),
    quotas
  };
}

async function listRequests(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(10, Number.parseInt(query.limit, 10) || 25));
  const filter = {};
  if (query.activity) filter.activity = query.activity;
  if (query.model) filter.model = query.model;
  if (query.status) filter.status = query.status;
  if (query.sourceApp) filter.sourceApp = query.sourceApp;
  if (query.organizationId) filter.organizationId = query.organizationId;
  if (query.actorId) filter.actorId = query.actorId;
  const start = rangeStart(query.range || '30d');
  if (start) filter.createdAt = { $gte: start };
  const [items, total] = await Promise.all([
    AIUsageEvent.find(filter).select('-rateLimit.providerPayload').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    AIUsageEvent.countDocuments(filter)
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

async function listAuditEvents(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(10, Number.parseInt(query.limit, 10) || 50));
  const filter = {};
  if (query.category) filter.category = query.category;
  const [items, total] = await Promise.all([
    AIAuditEvent.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    AIAuditEvent.countDocuments(filter)
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

module.exports = {
  createCredential,
  createQuotaGroup,
  getOverview,
  getRuntimeSettings,
  listAuditEvents,
  listCredentials,
  listRequests,
  revokeCredential,
  rotateCredential,
  serializeCredential,
  setCredentialEnabled,
  updateAlerts,
  updateRollout,
  updateRoute,
  writeAudit
};
