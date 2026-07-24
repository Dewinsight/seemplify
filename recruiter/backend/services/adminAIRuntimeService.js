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
const { CV_EXTRACTION_SCHEMA } = require('./aiModelService');
const aiRuntimeService = require('./aiRuntime/aiRuntimeService');
const { encryptSecret, fingerprintSecret, maskSecret } = require('./aiRuntime/secretCrypto');
const {
  assertSafeMetadata,
  redactGroqApiKeys,
  sanitizeQuotaGroup,
  validateQuotaGroupInput
} = require('./aiRuntime/quotaGroupValidation');

let liveOperationsCache = { expiresAt: 0, value: null, promise: null };

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

async function sanitizeStoredQuotaGroups(settings) {
  const storedGroups = settings.quotaGroups || [];
  const quotaGroups = storedGroups.map(sanitizeQuotaGroup);
  const migrations = storedGroups.flatMap((group, index) => {
    const sanitized = quotaGroups[index];
    return group.id !== sanitized?.id ? [{ from: group.id, to: sanitized.id }] : [];
  });
  const changed = storedGroups.some((group, index) => (
    group.id !== quotaGroups[index]?.id || group.label !== quotaGroups[index]?.label
  ));
  if (!changed) return quotaGroups;

  for (const migration of migrations) {
    await AIProviderCredential.updateMany({ quotaGroup: migration.from }, { $set: { quotaGroup: migration.to } });
    await AIUsageEvent.updateMany({ quotaGroup: migration.from }, { $set: { quotaGroup: migration.to } });
    await AIUsageDailyRollup.updateMany({ quotaGroup: migration.from }, { $set: { quotaGroup: migration.to } });
    await AIAuditEvent.updateMany({ quotaGroup: migration.from }, { $set: { quotaGroup: migration.to } });
    await AIQuotaSnapshot.deleteMany({ quotaGroup: migration.from });
  }
  await AIRuntimeSettings.updateOne({ key: 'global' }, {
    $set: { quotaGroups },
    $inc: { version: 1 }
  });
  const affectedAudits = await AIAuditEvent.find({ message: /gsk_/i });
  await Promise.all(affectedAudits.map(async (event) => {
    event.message = redactGroqApiKeys(event.message);
    event.metadata = redactGroqApiKeys(event.metadata);
    event.markModified('metadata');
    await event.save();
  }));
  aiRuntimeService.invalidateSettingsCache();
  return quotaGroups;
}

function assessRouting(settings) {
  const routes = Array.isArray(settings?.routes) ? settings.routes : [];
  const models = Array.isArray(settings?.models) ? settings.models : [];
  const issues = [];
  const duplicateActivities = routes
    .map((route) => route.activity)
    .filter((activity, index, all) => all.indexOf(activity) !== index);
  for (const activity of Object.keys(ACTIVITY_DEFINITIONS)) {
    const route = routes.find((item) => item.activity === activity);
    if (!route) {
      issues.push({ activity, code: 'missing_route', message: 'No route is configured.' });
      continue;
    }
    const definition = ACTIVITY_DEFINITIONS[activity];
    if (definition.lockedProvider && route.provider !== definition.provider) {
      issues.push({ activity, code: 'invalid_provider', message: `Configured provider must be ${definition.provider}.` });
    }
    const model = models.find((item) => item.id === route.model && item.provider === route.provider && item.enabled !== false);
    if (!model) {
      issues.push({ activity, code: 'missing_model', message: `Model ${route.model || 'unknown'} is not enabled.` });
      continue;
    }
    if (model.available === false) issues.push({ activity, code: 'model_unavailable', message: `Model ${model.id} is unavailable for this credential project.` });
    const missing = aiRuntimeService.requiredCapabilitiesForActivity(activity)
      .filter((capability) => !model.capabilities?.includes(capability));
    if (missing.length) issues.push({ activity, code: 'capability_mismatch', message: `Missing ${missing.join(', ')}.` });
  }
  for (const activity of new Set(duplicateActivities)) {
    issues.push({ activity, code: 'duplicate_route', message: 'More than one route is configured.' });
  }
  for (const route of routes.filter((item) => !ACTIVITY_DEFINITIONS[item.activity])) {
    issues.push({ activity: route.activity, code: 'unknown_route', message: 'Route does not map to a known activity.' });
  }
  return {
    valid: issues.length === 0,
    configured: routes.filter((route) => ACTIVITY_DEFINITIONS[route.activity]).length,
    expected: Object.keys(ACTIVITY_DEFINITIONS).length,
    enabled: routes.filter((route) => route.enabled !== false && ACTIVITY_DEFINITIONS[route.activity]).length,
    issues
  };
}

async function getRuntimeSettings() {
  const settings = await aiRuntimeService.getSettings({ force: true });
  const quotaGroups = await sanitizeStoredQuotaGroups(settings);
  return {
    ...settings,
    quotaGroups,
    routingHealth: assessRouting({ ...settings, quotaGroups }),
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
  const projectLabel = String(input.projectLabel || '').trim();
  assertSafeMetadata(label, 'label', 'the credential label');
  assertSafeMetadata(projectLabel, 'projectLabel', 'the project label');
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
    projectLabel,
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
  const settings = await aiRuntimeService.getSettings({ force: true });
  const existingGroups = settings.quotaGroups || [];
  const { id, label } = validateQuotaGroupInput(input, existingGroups);
  const quotaGroups = [...existingGroups, {
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

function runtimeTestValidationError(message, code) {
  const error = new TypeError(message);
  error.code = code;
  error.field = 'activity';
  error.statusCode = 400;
  return error;
}

async function runRuntimeTest(activityInput, req) {
  const activity = String(activityInput || '').trim();
  const settings = await aiRuntimeService.getSettings({ force: true });
  const route = (settings.routes || []).find((item) => item.activity === activity);
  if (!ACTIVITY_DEFINITIONS[activity] || !route) {
    throw runtimeTestValidationError('Select a configured AI activity', 'AI_RUNTIME_TEST_ACTIVITY_INVALID');
  }
  if (route.enabled === false) {
    throw runtimeTestValidationError('The selected AI activity is disabled', 'AI_RUNTIME_TEST_ACTIVITY_DISABLED');
  }

  const startedAt = Date.now();
  try {
    const completionInput = {
      messages: [
        {
          role: 'system',
          content: 'This is a synthetic AI runtime health check. Use no external data, personal data, tools, or hidden reasoning. Follow the requested output exactly.'
        },
        { role: 'user', content: `Confirm that the ${activity} route can execute a safe synthetic request.` }
      ],
      temperature: 0,
      max_tokens: 512,
      promptVersion: 'admin-runtime-test-v2',
      context: {
        sourceApp: 'admin-runtime-test',
        actorId: req.admin?._id,
        actorName: req.admin?.name,
        actorEmail: req.admin?.email
      }
    };
    const requiresStructuredOutput = aiRuntimeService.requiredCapabilitiesForActivity(activity).includes('json_schema');
    const isCvExtraction = ['candidate.cv_parse', 'ai_interview.cv_parse'].includes(activity);
    const structuredTestInput = isCvExtraction
      ? {
          ...completionInput,
          messages: [
            completionInput.messages[0],
            {
              role: 'user',
              content: 'Extract only this synthetic CV: Test Candidate, test.candidate@example.invalid, platform engineer with Node.js experience. Use empty values for facts not present.'
            }
          ],
          jsonSchema: CV_EXTRACTION_SCHEMA,
          schemaName: 'admin_runtime_test_cv',
          schemaStrict: false
        }
      : {
          ...completionInput,
          messages: [
            completionInput.messages[0],
            { role: 'user', content: `${completionInput.messages[1].content}\nReturn passed=true, activity="${activity}", and a brief message.` }
          ],
          jsonSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['passed', 'activity', 'message'],
            properties: {
              passed: { type: 'boolean' },
              activity: { type: 'string' },
              message: { type: 'string' }
            }
          },
          schemaName: 'admin_runtime_test',
          schemaStrict: true
        };
    const result = requiresStructuredOutput
      ? await aiRuntimeService.structuredComplete(activity, structuredTestInput, { timeoutMs: 30_000 })
      : await aiRuntimeService.complete(activity, completionInput, { timeoutMs: 30_000 });
    const usageEvent = await AIUsageEvent.findOne({ requestId: result.requestId })
      .select('provider model reasoningEffort routeVersion quotaGroup latencyMs attempts failovers failoverFrom failoverReason inputTokens cachedInputTokens outputTokens reasoningTokens totalTokens estimatedCostUsd')
      .sort({ createdAt: -1 })
      .lean();

    await writeAudit(req, {
      category: 'health',
      action: 'runtime_test_succeeded',
      targetType: 'AIRuntimeRoute',
      targetId: activity,
      model: usageEvent?.model || result.model,
      quotaGroup: usageEvent?.quotaGroup,
      message: `AI runtime test succeeded for ${activity}`,
      metadata: {
        requestId: result.requestId,
        provider: usageEvent?.provider || route.provider,
        latencyMs: usageEvent?.latencyMs ?? (Date.now() - startedAt),
        totalTokens: usageEvent?.totalTokens ?? result.usage?.totalTokens ?? 0
      }
    });

    return {
      success: true,
      activity,
      activityLabel: ACTIVITY_DEFINITIONS[activity].label,
      configuredRoute: {
        provider: route.provider,
        model: route.model,
        reasoningEffort: route.reasoningEffort,
        routeVersion: route.routeVersion
      },
      execution: {
        requestId: result.requestId,
        provider: usageEvent?.provider || route.provider,
        model: usageEvent?.model || result.model,
        reasoningEffort: usageEvent?.reasoningEffort || route.reasoningEffort,
        response: String(result.content || JSON.stringify(result.data || '')).slice(0, 1000),
        structuredOutput: requiresStructuredOutput,
        finishReason: result.finishReason,
        latencyMs: usageEvent?.latencyMs ?? (Date.now() - startedAt),
        attempts: usageEvent?.attempts ?? 1,
        failovers: usageEvent?.failovers ?? 0,
        failoverFrom: usageEvent?.failoverFrom || null,
        failoverReason: usageEvent?.failoverReason || null,
        quotaGroup: usageEvent?.quotaGroup || '',
        usage: {
          inputTokens: usageEvent?.inputTokens ?? result.usage?.inputTokens ?? 0,
          cachedInputTokens: usageEvent?.cachedInputTokens ?? result.usage?.cachedInputTokens ?? 0,
          outputTokens: usageEvent?.outputTokens ?? result.usage?.outputTokens ?? 0,
          reasoningTokens: usageEvent?.reasoningTokens ?? result.usage?.reasoningTokens ?? 0,
          totalTokens: usageEvent?.totalTokens ?? result.usage?.totalTokens ?? 0,
          estimatedCostUsd: usageEvent?.estimatedCostUsd ?? 0
        }
      }
    };
  } catch (error) {
    await writeAudit(req, {
      category: 'health',
      action: 'runtime_test_failed',
      status: 'failed',
      targetType: 'AIRuntimeRoute',
      targetId: activity,
      model: route.model,
      message: `AI runtime test failed for ${activity}`,
      metadata: {
        errorCode: error.code || 'AI_RUNTIME_TEST_FAILED',
        latencyMs: Date.now() - startedAt
      }
    }).catch(() => {});
    throw error;
  }
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
  const definition = ACTIVITY_DEFINITIONS[activity];
  if (definition.lockedProvider && model.provider !== definition.provider) {
    throw new TypeError(`${activity} is locked to ${definition.provider}`);
  }
  if (model.provider === 'groq' && model.available !== true) throw new TypeError('Sync Groq models and verify access before assigning this model');
  const missingCapabilities = aiRuntimeService.requiredCapabilitiesForActivity(activity)
    .filter((capability) => !model.capabilities?.includes(capability));
  if (missingCapabilities.length) {
    throw new TypeError(`Selected model cannot run this activity; missing ${missingCapabilities.join(', ')}`);
  }
  const effort = String(input.reasoningEffort || 'medium');
  if (!['low', 'medium', 'high'].includes(effort)) throw new TypeError('Reasoning effort must be low, medium, or high');
  const routes = settings.routes.map((route) => route.activity === activity ? {
    ...route,
    provider: model.provider,
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

function regexEscape(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function notFound(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

function liveSummary(row = {}) {
  const calls = Number(row.calls || 0);
  const failures = Number(row.failures || 0);
  return {
    calls,
    successes: Number(row.successes || 0),
    failures,
    successRate: calls ? Number((((calls - failures) / calls) * 100).toFixed(1)) : 0,
    tokens: Number(row.tokens || 0),
    estimatedCostUsd: Number(Number(row.cost || 0).toFixed(6)),
    averageLatencyMs: Math.round(Number(row.averageLatencyMs || 0)),
    maxLatencyMs: Number(row.maxLatencyMs || 0),
    failovers: Number(row.failovers || 0)
  };
}

function usageBreakdownGroup(id, extra = {}) {
  return {
    _id: id,
    ...extra,
    calls: { $sum: '$calls' },
    successes: { $sum: '$successes' },
    failures: { $sum: '$failures' },
    inputTokens: { $sum: '$inputTokens' },
    cachedInputTokens: { $sum: '$cachedInputTokens' },
    outputTokens: { $sum: '$outputTokens' },
    reasoningTokens: { $sum: '$reasoningTokens' },
    totalTokens: { $sum: '$totalTokens' },
    estimatedCostUsd: { $sum: '$estimatedCostUsd' },
    latencyTotalMs: { $sum: '$latencyTotalMs' }
  };
}

function usageBreakdown(row = {}) {
  const calls = Number(row.calls || 0);
  const successes = Number(row.successes || 0);
  const totalTokens = Number(row.totalTokens || 0);
  return {
    _id: row._id,
    ...(row.name !== undefined ? { name: row.name } : {}),
    calls,
    successes,
    failures: Number(row.failures || 0),
    successRate: calls ? Number(((successes / calls) * 100).toFixed(1)) : 0,
    inputTokens: Number(row.inputTokens || 0),
    cachedInputTokens: Number(row.cachedInputTokens || 0),
    outputTokens: Number(row.outputTokens || 0),
    reasoningTokens: Number(row.reasoningTokens || 0),
    totalTokens,
    tokens: totalTokens,
    estimatedCostUsd: Number(Number(row.estimatedCostUsd || 0).toFixed(8)),
    cost: Number(Number(row.estimatedCostUsd || 0).toFixed(8)),
    averageLatencyMs: calls ? Math.round(Number(row.latencyTotalMs || 0) / calls) : 0
  };
}

function logicalRequestStages(match) {
  return [
    { $match: match },
    { $sort: { createdAt: 1, _id: 1 } },
    { $group: {
      _id: { $ifNull: ['$requestId', { $toString: '$_id' }] },
      activity: { $last: '$activity' },
      createdAt: { $max: '$createdAt' },
      statuses: { $addToSet: '$status' },
      tokens: { $sum: '$totalTokens' },
      cost: { $sum: '$estimatedCostUsd' },
      latencyMs: { $sum: '$latencyMs' },
      maxLatencyMs: { $max: '$latencyMs' },
      failovers: { $max: '$failovers' }
    } },
    { $project: {
      activity: 1,
      createdAt: 1,
      tokens: 1,
      cost: 1,
      latencyMs: 1,
      maxLatencyMs: 1,
      failovers: 1,
      status: { $cond: [{ $in: ['success', '$statuses'] }, 'success', 'failed'] }
    } }
  ];
}

const logicalGroupedMetrics = {
  calls: { $sum: 1 },
  successes: { $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] } },
  failures: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
  tokens: { $sum: '$tokens' },
  cost: { $sum: '$cost' },
  averageLatencyMs: { $avg: '$latencyMs' },
  maxLatencyMs: { $max: '$maxLatencyMs' },
  failovers: { $sum: '$failovers' }
};

async function queryLiveOperations() {
  const sampledAt = new Date();
  const oneHourAgo = new Date(sampledAt.getTime() - 60 * 60_000);
  const fiveMinutesAgo = new Date(sampledAt.getTime() - 5 * 60_000);
  const groupedMetrics = {
    calls: { $sum: 1 },
    successes: { $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] } },
    failures: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
    tokens: { $sum: '$totalTokens' },
    cost: { $sum: '$estimatedCostUsd' },
    averageLatencyMs: { $avg: '$latencyMs' },
    maxLatencyMs: { $max: '$latencyMs' },
    failovers: { $sum: '$failovers' }
  };
  const [facets, logicalFacets, recent] = await Promise.all([
    AIUsageEvent.aggregate([
      { $match: { createdAt: { $gte: oneHourAgo } } },
      { $facet: {
        hour: [{ $group: { _id: null, ...groupedMetrics } }],
        fiveMinutes: [
          { $match: { createdAt: { $gte: fiveMinutesAgo } } },
          { $group: { _id: null, ...groupedMetrics } }
        ],
        providers: [
          { $group: { _id: '$provider', ...groupedMetrics, lastRequestAt: { $max: '$createdAt' } } },
          { $sort: { calls: -1 } }
        ],
        activities: [
          { $group: { _id: '$activity', ...groupedMetrics, lastRequestAt: { $max: '$createdAt' } } },
          { $sort: { calls: -1 } },
          { $limit: 12 }
        ],
        timeline: [
          { $group: {
            _id: { $dateToString: { date: '$createdAt', format: '%Y-%m-%dT%H:%M:00Z', timezone: 'UTC' } },
            calls: { $sum: 1 },
            failures: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } }
          } },
          { $sort: { _id: 1 } }
        ]
      } }
    ]),
    AIUsageEvent.aggregate([
      ...logicalRequestStages({ createdAt: { $gte: oneHourAgo } }),
      { $facet: {
        hour: [{ $group: { _id: null, ...logicalGroupedMetrics } }],
        fiveMinutes: [
          { $match: { createdAt: { $gte: fiveMinutesAgo } } },
          { $group: { _id: null, ...logicalGroupedMetrics } }
        ],
        activities: [
          { $group: { _id: '$activity', ...logicalGroupedMetrics, lastRequestAt: { $max: '$createdAt' } } },
          { $sort: { calls: -1 } },
          { $limit: 12 }
        ],
        timeline: [
          { $group: {
            _id: { $dateToString: { date: '$createdAt', format: '%Y-%m-%dT%H:%M:00Z', timezone: 'UTC' } },
            calls: { $sum: 1 },
            failures: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } }
          } },
          { $sort: { _id: 1 } }
        ]
      } }
    ]),
    AIUsageEvent.find({ createdAt: { $gte: oneHourAgo } })
      .select('requestId sourceApp activity provider model status organizationId organizationName actorId actorName actorEmail latencyMs totalTokens estimatedCostUsd failovers failoverFrom failoverReason errorCode createdAt')
      .sort({ createdAt: -1 })
      .limit(12)
      .lean()
  ]);
  const data = facets[0] || {};
  const logical = logicalFacets[0] || {};
  return {
    sampledAt: sampledAt.toISOString(),
    windowMinutes: 60,
    totals: {
      fiveMinutes: {
        ...liveSummary(logical.fiveMinutes?.[0]),
        attemptCalls: Number(data.fiveMinutes?.[0]?.calls || 0)
      },
      hour: {
        ...liveSummary(logical.hour?.[0]),
        attemptCalls: Number(data.hour?.[0]?.calls || 0)
      }
    },
    providers: (data.providers || []).map((row) => ({ id: row._id || 'unknown', ...liveSummary(row), lastRequestAt: row.lastRequestAt })),
    activities: (logical.activities || []).map((row) => ({ id: row._id || 'unknown', ...liveSummary(row), lastRequestAt: row.lastRequestAt })),
    timeline: (logical.timeline || []).map((row) => ({ minute: row._id, calls: Number(row.calls || 0), failures: Number(row.failures || 0) })),
    recent
  };
}

async function getLiveOperations() {
  const now = Date.now();
  if (liveOperationsCache.value && liveOperationsCache.expiresAt > now) return liveOperationsCache.value;
  if (liveOperationsCache.promise) return liveOperationsCache.promise;
  liveOperationsCache.promise = queryLiveOperations()
    .then((value) => {
      liveOperationsCache = { value, expiresAt: Date.now() + 2_000, promise: null };
      return value;
    })
    .catch((error) => {
      liveOperationsCache.promise = null;
      throw error;
    });
  return liveOperationsCache.promise;
}

async function getOverview({ range = '30d' } = {}) {
  const start = rangeStart(range);
  const detailStart = start || rangeStart('90d');
  const match = start ? { day: { $gte: start } } : {};
  const [totalsRows, byActivity, byModel, byProvider, bySource, organizations, actors, trend, quotas, latencies, logicalRows] = await Promise.all([
    AIUsageDailyRollup.aggregate([{ $match: match }, { $group: {
      _id: null, calls: { $sum: '$calls' }, successes: { $sum: '$successes' }, failures: { $sum: '$failures' },
      inputTokens: { $sum: '$inputTokens' }, cachedInputTokens: { $sum: '$cachedInputTokens' },
      outputTokens: { $sum: '$outputTokens' }, reasoningTokens: { $sum: '$reasoningTokens' }, totalTokens: { $sum: '$totalTokens' },
      estimatedCostUsd: { $sum: '$estimatedCostUsd' }, latencyTotalMs: { $sum: '$latencyTotalMs' }
    } }]),
    AIUsageDailyRollup.aggregate([{ $match: match }, { $group: usageBreakdownGroup('$activity') }, { $sort: { calls: -1 } }]),
    AIUsageDailyRollup.aggregate([{ $match: match }, { $group: usageBreakdownGroup('$model') }, { $sort: { calls: -1 } }]),
    AIUsageDailyRollup.aggregate([{ $match: match }, { $group: usageBreakdownGroup('$provider') }, { $sort: { calls: -1 } }]),
    AIUsageDailyRollup.aggregate([{ $match: match }, { $group: usageBreakdownGroup('$sourceApp') }, { $sort: { calls: -1 } }]),
    AIUsageDailyRollup.aggregate([{ $match: { ...match, organizationId: { $ne: '' } } }, { $group: usageBreakdownGroup('$organizationId', { name: { $last: '$organizationName' } }) }, { $sort: { calls: -1 } }, { $limit: 20 }]),
    AIUsageDailyRollup.aggregate([{ $match: { ...match, actorId: { $ne: '' } } }, { $group: usageBreakdownGroup('$actorId', { name: { $last: '$actorName' } }) }, { $sort: { calls: -1 } }, { $limit: 20 }]),
    AIUsageDailyRollup.aggregate([{ $match: match }, { $group: { _id: '$day', calls: { $sum: '$calls' }, failures: { $sum: '$failures' }, tokens: { $sum: '$totalTokens' }, cost: { $sum: '$estimatedCostUsd' } } }, { $sort: { _id: 1 } }]),
    AIQuotaSnapshot.find({}).sort({ quotaGroup: 1, model: 1 }).lean(),
    AIUsageEvent.find({ createdAt: { $gte: detailStart }, latencyMs: { $ne: null } }).select('latencyMs').sort({ createdAt: -1 }).limit(50000).lean(),
    start
      ? AIUsageEvent.aggregate([
          ...logicalRequestStages({ createdAt: { $gte: start } }),
          { $group: { _id: null, ...logicalGroupedMetrics } }
        ])
      : Promise.resolve([])
  ]);
  const totals = totalsRows[0] || {};
  const logicalTotals = logicalRows[0] || null;
  const logicalCalls = logicalTotals ? Number(logicalTotals.calls || 0) : Number(totals.calls || 0);
  const logicalSuccesses = logicalTotals ? Number(logicalTotals.successes || 0) : Number(totals.successes || 0);
  const logicalFailures = logicalTotals ? Number(logicalTotals.failures || 0) : Number(totals.failures || 0);
  const sortedLatencies = latencies.map((item) => Number(item.latencyMs || 0)).sort((a, b) => a - b);
  return {
    range,
    totals: {
      calls: logicalCalls,
      successes: logicalSuccesses,
      failures: logicalFailures,
      attemptCalls: Number(totals.calls || 0),
      successRate: logicalCalls ? Number(((logicalSuccesses / logicalCalls) * 100).toFixed(1)) : 0,
      inputTokens: Number(totals.inputTokens || 0), cachedInputTokens: Number(totals.cachedInputTokens || 0),
      outputTokens: Number(totals.outputTokens || 0), reasoningTokens: Number(totals.reasoningTokens || 0), totalTokens: Number(totals.totalTokens || 0),
      estimatedCostUsd: Number(Number(totals.estimatedCostUsd || 0).toFixed(4)),
      averageLatencyMs: logicalTotals
        ? Math.round(Number(logicalTotals.averageLatencyMs || 0))
        : totals.calls ? Math.round(Number(totals.latencyTotalMs || 0) / totals.calls) : 0,
      p50LatencyMs: percentile(sortedLatencies, 50), p95LatencyMs: percentile(sortedLatencies, 95),
      latencyWindow: range === 'all' ? 'retained-detail-window' : range
    },
    byActivity: byActivity.map(usageBreakdown),
    byModel: byModel.map(usageBreakdown),
    byProvider: byProvider.map(usageBreakdown),
    bySource: bySource.map(usageBreakdown),
    organizations: organizations.map(usageBreakdown),
    actors: actors.map(usageBreakdown),
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
  if (query.provider) filter.provider = query.provider;
  if (query.search) {
    const search = new RegExp(regexEscape(query.search).slice(0, 200), 'i');
    filter.$or = [
      { requestId: search },
      { activity: search },
      { model: search },
      { organizationName: search },
      { actorName: search },
      { actorEmail: search },
      { errorCode: search }
    ];
  }
  const requestedRange = query.range || '30d';
  const start = rangeStart(requestedRange === 'all' ? '90d' : requestedRange);
  if (start) filter.createdAt = { $gte: start };
  const [items, total, summaryRows, latencyRows] = await Promise.all([
    AIUsageEvent.find(filter).select('-rateLimit.providerPayload').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    AIUsageEvent.countDocuments(filter),
    AIUsageEvent.aggregate([{ $match: filter }, { $group: {
      _id: null,
      calls: { $sum: 1 },
      successes: { $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] } },
      failures: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
      inputTokens: { $sum: '$inputTokens' }, cachedInputTokens: { $sum: '$cachedInputTokens' },
      outputTokens: { $sum: '$outputTokens' }, reasoningTokens: { $sum: '$reasoningTokens' },
      totalTokens: { $sum: '$totalTokens' }, estimatedCostUsd: { $sum: '$estimatedCostUsd' },
      averageLatencyMs: { $avg: '$latencyMs' }, failovers: { $sum: '$failovers' }
    } }]),
    AIUsageEvent.find({ ...filter, latencyMs: { $ne: null } }).select('latencyMs').sort({ createdAt: -1 }).limit(50000).lean()
  ]);
  const summary = summaryRows[0] || {};
  const latencies = latencyRows.map((item) => Number(item.latencyMs || 0)).sort((a, b) => a - b);
  return {
    items,
    summary: {
      calls: Number(summary.calls || 0),
      successes: Number(summary.successes || 0),
      failures: Number(summary.failures || 0),
      successRate: summary.calls ? Number(((summary.successes / summary.calls) * 100).toFixed(1)) : 0,
      inputTokens: Number(summary.inputTokens || 0),
      cachedInputTokens: Number(summary.cachedInputTokens || 0),
      outputTokens: Number(summary.outputTokens || 0),
      reasoningTokens: Number(summary.reasoningTokens || 0),
      totalTokens: Number(summary.totalTokens || 0),
      estimatedCostUsd: Number(Number(summary.estimatedCostUsd || 0).toFixed(6)),
      averageLatencyMs: Math.round(Number(summary.averageLatencyMs || 0)),
      p50LatencyMs: percentile(latencies, 50),
      p95LatencyMs: percentile(latencies, 95),
      failovers: Number(summary.failovers || 0),
      detailWindow: requestedRange === 'all' ? 'retained-90d' : requestedRange
    },
    pagination: { page, limit, total, pages: Math.ceil(total / limit) }
  };
}

async function getRequestDetail(id) {
  if (!/^[a-f\d]{24}$/i.test(String(id || ''))) throw notFound('AI request was not found');
  const item = await AIUsageEvent.findById(id).select('-rateLimit.providerPayload').lean();
  if (!item) throw notFound('AI request was not found');
  return redactGroqApiKeys(item);
}

async function listAuditEvents(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(10, Number.parseInt(query.limit, 10) || 50));
  const filter = {};
  if (query.category) filter.category = query.category;
  if (query.status) filter.status = query.status;
  if (query.action) filter.action = query.action;
  if (query.search) {
    const search = new RegExp(regexEscape(query.search).slice(0, 200), 'i');
    filter.$or = [{ action: search }, { message: search }, { actorEmail: search }, { targetId: search }];
  }
  const [items, total] = await Promise.all([
    AIAuditEvent.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    AIAuditEvent.countDocuments(filter)
  ]);
  return {
    items: items.map((item) => redactGroqApiKeys(item)),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) }
  };
}

async function getAuditDetail(id) {
  if (!/^[a-f\d]{24}$/i.test(String(id || ''))) throw notFound('AI audit event was not found');
  const item = await AIAuditEvent.findById(id).lean();
  if (!item) throw notFound('AI audit event was not found');
  return redactGroqApiKeys(item);
}

module.exports = {
  assessRouting,
  createCredential,
  createQuotaGroup,
  getAuditDetail,
  getLiveOperations,
  getOverview,
  getRequestDetail,
  getRuntimeSettings,
  listAuditEvents,
  listCredentials,
  listRequests,
  revokeCredential,
  rotateCredential,
  runRuntimeTest,
  serializeCredential,
  setCredentialEnabled,
  updateAlerts,
  updateRollout,
  updateRoute,
  writeAudit
};
