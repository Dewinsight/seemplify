const crypto = require('crypto');
const AIProviderCredential = require('../../models/AIProviderCredential');
const AIQuotaSnapshot = require('../../models/AIQuotaSnapshot');
const AIRuntimeSettings = require('../../models/AIRuntimeSettings');
const {
  ACTIVITY_DEFINITIONS,
  GROQ_120B,
  GROQ_BASE_URL,
  createDefaultRuntimeSettings,
  failoverPolicyForRoute,
  isGatewayProvider,
  isManagedLocalProvider,
  isUserOwnedProvider,
  localProviderLabel,
  normalizeRuntimePolicy
} = require('../../config/aiRuntimeCatalog');
const { decryptSecret } = require('./secretCrypto');
const { getAIRequestContext } = require('./requestContext');
const {
  calculateEstimatedCost,
  normalizeUsage,
  parseRateLimitHeaders,
  recordUsage,
  sanitizeMessage
} = require('./usageService');
const { alertCredentialFailure, alertCredentialRecovery, evaluateUsageAlerts } = require('./alertService');
const { validateJsonSchema } = require('./jsonSchemaValidator');
const { AzureTextRollbackAdapter } = require('./azureTextRollbackAdapter');

const SETTINGS_CACHE_MS = 15_000;
const MAX_PROVIDER_ATTEMPTS = 2;
const LOCAL_FAILOVER_ERROR_CODES = new Set([
  'AI_LOCAL_NOT_CONFIGURED',
  'AI_LOCAL_UNAVAILABLE',
  'RATE_LIMITED',
  'LOCAL_LLM_DISABLED',
  'LOCAL_LLM_PAUSED',
  'LOCAL_ENGINE_REQUIRED',
  'REQUIRED_RUNTIME_UNAVAILABLE',
  'GATEWAY_QUEUE_FULL',
  'LOCAL_LLM_UNAVAILABLE',
  'LOCAL_LLM_SCHEMA_INVALID',
  'CODEX_EXEC_FAILED',
  'CODEX_EXEC_TIMEOUT',
  'CODEX_NOT_INSTALLED',
  'CODEX_TURN_FAILED'
]);
const STRUCTURED_ACTIVITIES = new Set([
  'candidate.cv_parse',
  'candidate.insights',
  'job.description',
  'job.requirements',
  'job.normalize',
  'matching.analysis',
  'assistant.tool_selection',
  'assistant.memory',
  'assistant.job_extract',
  'interview.questions',
  'interview.bias',
  'interview.analysis',
  'interview.summary',
  'interview.team_feedback',
  'ai_interview.question_generation',
  'ai_interview.cv_parse',
  'ai_interview.scoring'
]);

function combinedRequestSignal(timeoutMs, externalSignal) {
  const timeoutSignal = typeof globalThis.AbortSignal?.timeout === 'function'
    ? globalThis.AbortSignal.timeout(timeoutMs)
    : undefined;
  if (!externalSignal) return timeoutSignal;
  if (!timeoutSignal) return externalSignal;
  if (typeof globalThis.AbortSignal?.any === 'function') {
    return globalThis.AbortSignal.any([externalSignal, timeoutSignal]);
  }
  const controller = new AbortController();
  const abort = (signal) => {
    if (!controller.signal.aborted) controller.abort(signal.reason);
  };
  if (externalSignal.aborted) abort(externalSignal);
  else externalSignal.addEventListener('abort', () => abort(externalSignal), { once: true });
  if (timeoutSignal.aborted) abort(timeoutSignal);
  else timeoutSignal.addEventListener('abort', () => abort(timeoutSignal), { once: true });
  return controller.signal;
}

function activeAbortReason(signal, fallback) {
  if (!signal?.aborted) return null;
  return signal.reason instanceof Error ? signal.reason : fallback;
}

function deriveRuntimeUsageEventId({ context = {}, route = {} } = {}) {
  const executionId = String(context.usageExecutionId || crypto.randomUUID());
  const completionOrdinal = Math.max(
    1,
    Number(context.structuredCompletionOrdinal || context.usageCompletionOrdinal || 1) || 1
  );
  const identity = [
    context.sourceApp || 'recruiter',
    route.activity,
    executionId,
    completionOrdinal
  ].map((value) => String(value || '')).join('\u001f');
  return `usage_${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 48)}`;
}

function deriveProviderOutcomeUsageEventId({ context = {}, route = {} } = {}) {
  const identity = [
    deriveRuntimeUsageEventId({ context, route }),
    route.provider,
    route.model,
    route.failoverFrom
  ].map((value) => String(value || '')).join('\u001f');
  return `usage_${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 48)}`;
}

function deriveGatewayExecutionId(eventId) {
  const normalized = String(eventId || '').trim();
  if (!/^usage_[a-f0-9]{48}$/.test(normalized)) {
    throw new TypeError('A valid usage event ID is required for local metering');
  }
  return `localexec_${crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 48)}`;
}

function withUsageExecutionContext(context = {}) {
  return {
    ...context,
    // Request IDs are already stable across transport retries. Reuse one when
    // the caller has not supplied a more specific logical execution identity
    // so a local gateway retry replays its durable receipt instead of running
    // (and metering) the same inference again.
    usageExecutionId: context.usageExecutionId || context.requestId || crypto.randomUUID(),
    structuredCompletionOrdinal: Math.max(
      1,
      Number(context.structuredCompletionOrdinal || context.usageCompletionOrdinal || 1) || 1
    )
  };
}

function isUsagePersistenceFailure(error) {
  return error?.code === 'AI_USAGE_PERSISTENCE_FAILED'
    || error?.code === 'AI_USAGE_IDENTITY_CONFLICT';
}

function requiredCapabilitiesForActivity(activity) {
  const capabilities = ['text', 'reasoning'];
  if (STRUCTURED_ACTIVITIES.has(activity)) capabilities.push('json_schema');
  if (activity === 'assistant.tool_selection') capabilities.push('tools');
  if (activity === 'assistant.chat' || activity.startsWith('ai_interview.chat.')) capabilities.push('streaming');
  return capabilities;
}

class AIRuntimeError extends Error {
  constructor(message, { code = 'AI_RUNTIME_ERROR', statusCode = 503, providerStatus, retryable = false, details } = {}) {
    super(message);
    this.name = 'AIRuntimeError';
    this.code = code;
    this.statusCode = statusCode;
    this.providerStatus = providerStatus;
    this.retryable = retryable;
    this.details = details;
  }
}

function objectIdString(value) {
  return value == null ? '' : String(value._id || value.id || value);
}

function deterministicBucket(context = {}, salt = 'groq-gpt-oss-v1') {
  const identity = context.organizationId || context.actorId || context.candidateId || context.requestId || 'system';
  const digest = crypto.createHash('sha256').update(`${salt}:${objectIdString(identity)}`).digest();
  return digest.readUInt32BE(0) % 100;
}

function shouldUseGroq(context, rollout = {}) {
  const percent = Math.max(0, Math.min(100, Number(rollout.groqPercent ?? 100)));
  if (percent >= 100 || rollout.azureBaselineEnabled !== true) return true;
  return deterministicBucket(context, rollout.samplingSalt) < percent;
}

function sameUtcWindow(value, now, unit) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const dayMatches = date.getUTCFullYear() === now.getUTCFullYear()
    && date.getUTCMonth() === now.getUTCMonth()
    && date.getUTCDate() === now.getUTCDate();
  if (unit === 'day') return dayMatches;
  return dayMatches && date.getUTCHours() === now.getUTCHours() && date.getUTCMinutes() === now.getUTCMinutes();
}

function quotaSnapshotIsAvailable(snapshot, documentedLimits = {}, now = new Date()) {
  if (!snapshot) return true;
  if (snapshot.blockedUntil && new Date(snapshot.blockedUntil) > now) return false;
  if (Number(snapshot.requestRemainingDaily) <= 0 && snapshot.requestRemainingDaily != null
    && (!snapshot.requestResetAt || new Date(snapshot.requestResetAt) > now)) return false;
  if (Number(snapshot.tokenRemainingMinute) <= 0 && snapshot.tokenRemainingMinute != null
    && (!snapshot.tokenResetAt || new Date(snapshot.tokenResetAt) > now)) return false;

  const limits = {
    rpd: Number(snapshot.requestLimitDaily || documentedLimits.rpd || 0),
    tpm: Number(snapshot.tokenLimitMinute || documentedLimits.tpm || 0),
    rpm: Number(documentedLimits.rpm || 0),
    tpd: Number(documentedLimits.tpd || 0)
  };
  if (sameUtcWindow(snapshot.localDay, now, 'day')) {
    if (limits.rpd > 0 && Number(snapshot.localRequestsToday || 0) >= limits.rpd) return false;
    if (limits.tpd > 0 && Number(snapshot.localTokensToday || 0) >= limits.tpd) return false;
  }
  if (sameUtcWindow(snapshot.localMinute, now, 'minute')) {
    if (limits.rpm > 0 && Number(snapshot.localRequestsMinute || 0) >= limits.rpm) return false;
    if (limits.tpm > 0 && Number(snapshot.localTokensMinute || 0) >= limits.tpm) return false;
  }
  return true;
}

function rateLimitCooldownUntil(error, now = Date.now()) {
  const rateLimit = error?.details?.rateLimit || {};
  if (Number(rateLimit.retryAfterMs) > 0) return new Date(now + Number(rateLimit.retryAfterMs));
  if (Number(rateLimit.requestRemainingDaily) <= 0 && rateLimit.requestRemainingDaily != null && rateLimit.requestResetAt) {
    return new Date(rateLimit.requestResetAt);
  }
  if (Number(rateLimit.tokenRemainingMinute) <= 0 && rateLimit.tokenRemainingMinute != null && rateLimit.tokenResetAt) {
    return new Date(rateLimit.tokenResetAt);
  }
  if (error?.details?.blockedAccess) return new Date(now + 60 * 60 * 1000);
  return rateLimit.tokenResetAt || rateLimit.requestResetAt || new Date(now + 60_000);
}

function responseJson(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

function errorDetails(payload, status, provider = 'groq') {
  const body = payload?.error || payload || {};
  const code = String(body.code || body.type || (status === 429 ? 'rate_limit_exceeded' : `${provider}_http_${status}`));
  const providerLabel = provider === 'groq'
    ? 'Groq'
    : provider === 'local-codex'
      ? 'Terra'
      : provider === 'local-claude'
        ? 'Claude Sonnet'
      : isManagedLocalProvider(provider) ? 'Managed AI runtime' : 'Azure';
  return {
    code,
    message: sanitizeMessage(body.message || `${providerLabel} request failed with status ${status}`),
    blockedAccess: provider === 'groq'
      && (code === 'blocked_api_access' || /spend|billing|blocked api access/i.test(String(body.message || '')))
  };
}

function stripReasoning(data) {
  if (!data || typeof data !== 'object') return data;
  const sanitized = { ...data };
  delete sanitized.reasoning;
  delete sanitized.reasoning_content;
  if (Array.isArray(data.choices)) {
    sanitized.choices = data.choices.map((choice) => {
      const cleanChoice = { ...choice };
      delete cleanChoice.reasoning;
      const message = choice?.message ? { ...choice.message } : choice?.message;
      if (message) {
        delete message.reasoning;
        delete message.reasoning_content;
        cleanChoice.message = message;
      }
      return cleanChoice;
    });
  }
  return sanitized;
}

function signLocalRequest(secret, body, options = {}) {
  const normalized = options && typeof options === 'object'
    ? options
    : { now: options, nonce: arguments[3] };
  const timestamp = String(normalized.now ?? Date.now());
  const nonce = normalized.nonce || crypto.randomBytes(24).toString('base64url');
  const method = String(normalized.method || 'POST').toUpperCase();
  const requestPath = String(normalized.path || '/v1/cv/analyze');
  const signature = crypto.createHmac('sha256', secret)
    .update(`${timestamp}\n${nonce}\n${method}\n${requestPath}\n${body}`)
    .digest('base64url');
  return { timestamp, nonce, signature };
}

/**
 * Ordered candidates for a user-owned route, mirroring Experience Management's
 * precedence. Recruiter configures models per activity at the platform tier
 * only, so the chain is `admin_action` then the activity's catalogue default;
 * the connected account supplies the remaining fallbacks.
 */
function orderedCandidates(entries) {
  const result = [];
  const seen = new Set();
  for (const [value, source] of entries) {
    const candidate = String(value || '').trim();
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    result.push({ value: candidate, source });
  }
  return result;
}

function codexModelCandidates(route) {
  return orderedCandidates([[route.codexModel, 'admin_action']]);
}

function codexEffortCandidates(route) {
  const definition = ACTIVITY_DEFINITIONS[route.activity] || {};
  return orderedCandidates([
    [route.reasoningEffort, 'admin_action'],
    [definition.reasoningEffort, 'action_default']
  ]);
}

function buildAttemptError({ attempt, credential, error, startedAt }) {
  return {
    attempt,
    credentialId: objectIdString(credential?._id),
    credentialLabel: credential?.label,
    quotaGroup: credential?.quotaGroup,
    code: String(error?.code || 'AI_RUNTIME_ERROR').slice(0, 100),
    message: sanitizeMessage(error?.message),
    httpStatus: Number(error?.providerStatus || error?.statusCode || 0) || undefined,
    providerRequestId: error?.details?.rateLimit?.providerRequestId || undefined,
    latencyMs: Math.max(0, Date.now() - startedAt)
  };
}

function calculateFailovers(route = {}, attempts = 1) {
  return (route.failoverFrom ? 1 : 0) + Math.max(0, Number(attempts || 1) - 1);
}

function isLocalRuntimeUnavailable(error) {
  return Boolean(
    error?.retryable
    && LOCAL_FAILOVER_ERROR_CODES.has(String(error.code || ''))
  );
}

class AIRuntimeService {
  constructor({
    fetchImpl = global.fetch,
    credentialModel = AIProviderCredential,
    quotaModel = AIQuotaSnapshot,
    settingsModel = AIRuntimeSettings,
    azureRollbackAdapter,
    // Required lazily by default: codexAccountService depends on this module
    // for request signing, so importing it at load time would be circular.
    resolveSubject = (actorId) => require('./codexAccountService').resolveRoutableSubject(actorId)
  } = {}) {
    this.resolveSubject = resolveSubject;
    this.fetch = fetchImpl;
    this.Credential = credentialModel;
    this.Quota = quotaModel;
    this.Settings = settingsModel;
    this.azureRollback = azureRollbackAdapter || new AzureTextRollbackAdapter({ fetchImpl });
    this.settingsCache = null;
    this.settingsCacheExpiresAt = 0;
  }

  invalidateSettingsCache() {
    this.settingsCache = null;
    this.settingsCacheExpiresAt = 0;
  }

  async getSettings({ force = false } = {}) {
    if (!force && this.settingsCache && this.settingsCacheExpiresAt > Date.now()) return this.settingsCache;
    const defaults = createDefaultRuntimeSettings();
    let settings = await this.Settings.findOne({ key: 'global' }).lean();
    if (!settings) {
      settings = await this.Settings.findOneAndUpdate(
        { key: 'global' },
        { $setOnInsert: defaults },
        { upsert: true, new: true }
      ).lean();
    }
    const storedModels = Array.isArray(settings?.models) ? settings.models : [];
    const storedRoutes = Array.isArray(settings?.routes) ? settings.routes : [];
    const modelsByKey = new Map(storedModels.map((model) => [`${model.provider}:${model.id}`, model]));
    for (const model of defaults.models) {
      const key = `${model.provider}:${model.id}`;
      modelsByKey.set(key, { ...model, ...(modelsByKey.get(key) || {}) });
    }
    const routesByActivity = new Map(storedRoutes.map((route) => [route.activity, route]));
    for (const route of defaults.routes) {
      const definition = ACTIVITY_DEFINITIONS[route.activity];
      const existing = routesByActivity.get(route.activity);
      const shouldApplyNewLocalDefault = definition?.defaultLocal
        && existing?.provider === 'groq'
        && Number(existing?.routeVersion || 1) === 1;
      if (definition?.lockedProvider) {
        // The lock stops drift onto another shared provider. An administrator
        // explicitly routing the activity to a connected ChatGPT account is
        // not drift, so it survives the pin — mirroring resolveRoute.
        const storedUserOwned = existing && isUserOwnedProvider(existing.provider);
        routesByActivity.set(route.activity, storedUserOwned
          ? { ...route, ...existing, lockedProvider: true }
          : {
              ...route,
              ...(existing || {}),
              provider: route.provider,
              model: route.model,
              lockedProvider: true,
              failoverPolicy: route.failoverPolicy
            });
      } else {
        routesByActivity.set(route.activity, shouldApplyNewLocalDefault
          ? { ...(existing || {}), ...route }
          : { ...route, ...(existing || {}) });
      }
    }
    settings = {
      ...defaults,
      ...settings,
      models: [...modelsByKey.values()],
      routes: [...routesByActivity.values()].map((route) => ({
        ...route,
        failoverPolicy: failoverPolicyForRoute(route.activity, route.provider)
      })),
      quotaGroups: Array.isArray(settings?.quotaGroups) && settings.quotaGroups.length ? settings.quotaGroups : defaults.quotaGroups,
      alerts: { ...defaults.alerts, ...(settings?.alerts || {}) },
      localFailover: { ...defaults.localFailover, ...(settings?.localFailover || {}) },
      rollout: { ...defaults.rollout, ...(settings?.rollout || {}) },
      // Normalised on read, so a stored policy whose default points at a
      // disabled runtime is corrected rather than enforced.
      runtimePolicy: normalizeRuntimePolicy(settings?.runtimePolicy)
    };
    this.settingsCache = settings;
    this.settingsCacheExpiresAt = Date.now() + SETTINGS_CACHE_MS;
    return settings;
  }

  resolveRoute(activity, settings) {
    const definition = ACTIVITY_DEFINITIONS[activity];
    if (!definition) {
      throw new AIRuntimeError(`Unknown AI activity ${activity}`, { code: 'AI_ACTIVITY_UNKNOWN', statusCode: 400 });
    }
    const normalized = activity;
    const storedRoute = settings.routes.find((item) => item.activity === normalized);
    if (!storedRoute) {
      throw new AIRuntimeError(`No route is configured for ${normalized}`, { code: 'AI_ROUTE_NOT_CONFIGURED', statusCode: 503 });
    }
    // A locked activity is pinned to its managed runtime so it cannot drift onto
    // another shared provider. Routing it to a user's own ChatGPT account is an
    // explicit administrator decision, not drift, so it survives the pin.
    const route = definition.lockedProvider && !isUserOwnedProvider(storedRoute.provider)
      ? {
          ...storedRoute,
          provider: definition.provider,
          model: definition.model,
          lockedProvider: true,
          failoverPolicy: failoverPolicyForRoute(normalized, definition.provider)
        }
      : {
          ...storedRoute,
          failoverPolicy: failoverPolicyForRoute(normalized, storedRoute.provider)
        };
    if (!route?.enabled || !settings.providerEnabled) {
      throw new AIRuntimeError(`AI activity ${normalized} is disabled`, { code: 'AI_ACTIVITY_DISABLED', statusCode: 503 });
    }
    const runtimePolicy = normalizeRuntimePolicy(settings.runtimePolicy);
    if (!runtimePolicy.localEnabled && !runtimePolicy.chatgptEnabled) {
      throw new AIRuntimeError('AI runtimes are currently disabled by a platform administrator', {
        code: 'AI_RUNTIMES_DISABLED', statusCode: 503
      });
    }
    if (isUserOwnedProvider(route.provider) && !runtimePolicy.chatgptEnabled) {
      throw new AIRuntimeError('The ChatGPT runtime is disabled by a platform administrator', {
        code: 'AI_RUNTIME_CHATGPT_DISABLED', statusCode: 503
      });
    }
    if (isManagedLocalProvider(route.provider) && !runtimePolicy.localEnabled) {
      throw new AIRuntimeError('The local AI runtime is disabled by a platform administrator', {
        code: 'AI_RUNTIME_LOCAL_DISABLED', statusCode: 503
      });
    }
    const model = settings.models.find((item) => item.id === route.model && item.provider === route.provider && item.enabled !== false);
    if (!model) {
      throw new AIRuntimeError(`No enabled model is configured for ${normalized}`, { code: 'AI_MODEL_NOT_CONFIGURED', statusCode: 503 });
    }
    if (model.available === false) {
      throw new AIRuntimeError(`Configured model ${model.id} is unavailable for ${normalized}`, { code: 'AI_MODEL_UNAVAILABLE', statusCode: 503 });
    }
    const missingCapabilities = requiredCapabilitiesForActivity(normalized)
      .filter((capability) => !model.capabilities?.includes(capability));
    if (missingCapabilities.length) {
      throw new AIRuntimeError(`Model ${model.id} cannot run ${normalized}; missing ${missingCapabilities.join(', ')}`, {
        code: 'AI_MODEL_CAPABILITY_MISMATCH',
        statusCode: 503,
        details: { missingCapabilities }
      });
    }
    return { ...route, activity: normalized, modelConfig: model };
  }

  resolveExecutionRoute(route, settings, context) {
    const canonicalRoute = {
      ...route,
      failoverPolicy: failoverPolicyForRoute(route.activity, route.provider)
    };
    if (isManagedLocalProvider(canonicalRoute.provider)) {
      if (!settings.localFailover?.enabled || !settings.localFailover?.active) return canonicalRoute;
      if (canonicalRoute.failoverPolicy !== 'groq_immediate') return canonicalRoute;
      return this.createGroqFailoverRoute(
        canonicalRoute,
        settings,
        settings.localFailover.reason || 'local_runtime_unhealthy'
      );
    }
    if (shouldUseGroq(context, settings.rollout)) return canonicalRoute;
    return {
      ...canonicalRoute,
      provider: 'azure',
      model: 'azure-text-baseline',
      failoverPolicy: 'none',
      modelConfig: {
        id: 'azure-text-baseline',
        provider: 'azure',
        label: 'Azure text rollback baseline',
        pricing: {}
      }
    };
  }

  createGroqFailoverRoute(route, settings, reason = 'local_runtime_unhealthy') {
    const failoverPolicy = failoverPolicyForRoute(route.activity, route.provider);
    if (
      !isManagedLocalProvider(route.provider)
      || failoverPolicy !== 'groq_immediate'
      || settings.localFailover?.enabled !== true
    ) return null;
    const fallbackModel = route.activity.startsWith('ai_interview.chat.') ? 'openai/gpt-oss-20b' : GROQ_120B;
    const modelConfig = settings.models.find((item) => (
      item.provider === 'groq'
      && item.id === fallbackModel
      && item.enabled !== false
    ));
    if (!modelConfig || modelConfig.available === false) {
      throw new AIRuntimeError(`Local AI is unavailable and Groq fallback ${fallbackModel} is not available`, {
        code: 'AI_FAILOVER_MODEL_UNAVAILABLE',
        statusCode: 503,
        retryable: true,
        details: { failoverFrom: route.provider, failoverReason: sanitizeMessage(reason) }
      });
    }
    return {
      ...route,
      provider: 'groq',
      model: fallbackModel,
      modelConfig,
      failoverPolicy: 'none',
      failoverFrom: route.provider,
      failoverReason: sanitizeMessage(reason || 'local_runtime_unhealthy')
    };
  }

  async listEligibleCredentials({ model, modelConfig, excludeIds = [], excludeQuotaGroups = [] } = {}) {
    const now = new Date();
    const query = {
      provider: 'groq',
      enabled: true,
      status: { $in: ['unknown', 'healthy', 'degraded'] },
      $or: [{ cooldownUntil: null }, { cooldownUntil: { $exists: false } }, { cooldownUntil: { $lte: now } }]
    };
    if (model) query.blockedModels = { $ne: model };
    if (excludeIds.length) query._id = { $nin: excludeIds };
    if (excludeQuotaGroups.length) query.quotaGroup = { $nin: excludeQuotaGroups };
    const credentials = await this.Credential.find(query)
      .select('+encryptedSecret')
      .sort({ priority: 1, lastUsedAt: 1, createdAt: 1 });
    if (!credentials.length || !model || !modelConfig || !this.Quota?.find) return credentials;

    const quotaGroups = Array.from(new Set(credentials.map((credential) => credential.quotaGroup).filter(Boolean)));
    const snapshots = await this.Quota.find({ provider: 'groq', model, quotaGroup: { $in: quotaGroups } }).lean();
    const byGroup = new Map(snapshots.map((snapshot) => [snapshot.quotaGroup, snapshot]));
    const nowForQuota = new Date();
    return credentials.filter((credential) => quotaSnapshotIsAvailable(
      byGroup.get(credential.quotaGroup),
      modelConfig.documentedLimits,
      nowForQuota
    ));
  }

  async getCredential(id) {
    const credential = await this.Credential.findById(id).select('+encryptedSecret');
    if (!credential || !credential.enabled || credential.status === 'revoked') {
      throw new AIRuntimeError('Groq credential is not available', { code: 'AI_CREDENTIAL_NOT_FOUND', statusCode: 404 });
    }
    return credential;
  }

  normalizePayload(input, route, { stream = false } = {}) {
    const payload = { ...(input || {}) };
    delete payload.activity;
    delete payload.context;
    delete payload.metadata;
    delete payload.promptVersion;
    // These fields configure local validation only. Groq rejects them as
    // unknown top-level request parameters when they leak into the payload.
    delete payload.jsonSchema;
    delete payload.schemaName;
    delete payload.schemaStrict;
    if (payload.maxTokens !== undefined && payload.max_tokens === undefined) payload.max_tokens = payload.maxTokens;
    if (payload.topP !== undefined && payload.top_p === undefined) payload.top_p = payload.topP;
    delete payload.maxTokens;
    delete payload.topP;
    // GPT-OSS on Groq does not support OpenAI's frequency/presence penalties.
    delete payload.frequency_penalty;
    delete payload.presence_penalty;
    const tokenCeiling = route.activity.startsWith('ai_interview.chat.') ? 600
      : route.activity === 'candidate.cv_parse' || route.activity === 'ai_interview.cv_parse' ? 6000
        : route.activity === 'ai_interview.scoring' || route.activity === 'ai_interview.question_generation' ? 3500
          : route.activity.includes('tool_selection') ? 2000
            : 4000;
    const requestedTokens = Number(payload.max_tokens ?? payload.max_completion_tokens ?? tokenCeiling);
    payload.max_tokens = Math.max(1, Math.min(tokenCeiling, Number.isFinite(requestedTokens) ? requestedTokens : tokenCeiling));
    delete payload.max_completion_tokens;
    if (payload.temperature !== undefined) payload.temperature = Math.max(0, Math.min(2, Number(payload.temperature) || 0));
    if (payload.top_p !== undefined) payload.top_p = Math.max(0, Math.min(1, Number(payload.top_p) || 0));
    payload.model = route.model;
    payload.reasoning_effort = route.reasoningEffort || 'medium';
    // GPT-OSS exposes reasoning through include_reasoning; reasoning_format is
    // unsupported for these models and causes Groq to reject the request.
    delete payload.reasoning_format;
    payload.include_reasoning = false;
    payload.stream = Boolean(stream || payload.stream);
    if (payload.stream) payload.stream_options = { ...(payload.stream_options || {}), include_usage: true };
    return payload;
  }

  async markCredentialSuccess(credential, settings) {
    const now = new Date();
    await this.Credential.updateOne({ _id: credential._id }, {
      $set: {
        status: 'healthy',
        lastUsedAt: now,
        lastSuccessAt: now,
        lastCheckedAt: now,
        consecutiveFailures: 0,
        cooldownUntil: null,
        lastError: null
      }
    });
    if (credential.status === 'degraded' || credential.lastError) {
      void alertCredentialRecovery({ credential, settings })
        .catch((error) => console.error('AI credential recovery alert failed:', sanitizeMessage(error.message)));
    }
  }

  async markCredentialFailure(credential, error, model, settings) {
    const status = Number(error.providerStatus || error.statusCode || 0);
    const update = {
      $set: {
        lastCheckedAt: new Date(),
        lastError: { code: error.code, message: sanitizeMessage(error.message), at: new Date() }
      },
      $inc: { consecutiveFailures: 1 }
    };
    if (status === 401) {
      update.$set.enabled = false;
      update.$set.status = 'disabled';
    } else if (status === 403) {
      update.$set.status = 'degraded';
      update.$addToSet = { blockedModels: model };
    } else if (status === 429 || error.details?.blockedAccess) {
      update.$set.status = 'degraded';
      update.$set.cooldownUntil = rateLimitCooldownUntil(error);
    } else if (status === 498 || status >= 500 || error.code === 'AI_PROVIDER_NETWORK_ERROR') {
      update.$set.status = 'degraded';
      update.$set.cooldownUntil = new Date(Date.now() + 60_000);
    }
    await this.Credential.updateOne({ _id: credential._id }, update);
    if ((status === 429 || error.details?.blockedAccess) && credential.quotaGroup && this.Credential.updateMany) {
      await this.Credential.updateMany({
        provider: 'groq',
        quotaGroup: credential.quotaGroup,
        enabled: true,
        status: { $ne: 'revoked' }
      }, {
        $set: {
          status: 'degraded',
          cooldownUntil: update.$set.cooldownUntil,
          lastCheckedAt: new Date(),
          lastError: { code: error.code, message: sanitizeMessage(error.message), at: new Date() }
        }
      });
      if (this.Quota?.updateOne) {
        const rateLimit = error.details?.rateLimit || {};
        await this.Quota.updateOne({ provider: 'groq', quotaGroup: credential.quotaGroup, model }, {
          $set: {
            observedAt: new Date(),
            blockedUntil: update.$set.cooldownUntil,
            blockedReason: error.details?.blockedAccess ? 'blocked_api_access' : 'rate_limit',
            ...(rateLimit.requestLimitDaily != null ? { requestLimitDaily: rateLimit.requestLimitDaily } : {}),
            ...(rateLimit.requestRemainingDaily != null ? { requestRemainingDaily: rateLimit.requestRemainingDaily } : {}),
            ...(rateLimit.requestResetAt ? { requestResetAt: rateLimit.requestResetAt } : {}),
            ...(rateLimit.tokenLimitMinute != null ? { tokenLimitMinute: rateLimit.tokenLimitMinute } : {}),
            ...(rateLimit.tokenRemainingMinute != null ? { tokenRemainingMinute: rateLimit.tokenRemainingMinute } : {}),
            ...(rateLimit.tokenResetAt ? { tokenResetAt: rateLimit.tokenResetAt } : {})
          }
        }, { upsert: true });
      }
    }
    if (status === 401 || status === 403 || error.details?.blockedAccess || (status >= 500 && Number(credential.consecutiveFailures || 0) >= 2)) {
      void alertCredentialFailure({ credential, code: error.code, message: error.message, settings })
        .catch((alertError) => console.error('AI credential failure alert failed:', sanitizeMessage(alertError.message)));
    }
  }

  async providerRequest({ credential, payload, timeoutMs = 90_000, signal }) {
    if (typeof this.fetch !== 'function') {
      throw new AIRuntimeError('No fetch implementation is available', { code: 'AI_PROVIDER_NETWORK_ERROR', retryable: true });
    }
    const apiKey = decryptSecret(credential.encryptedSecret);
    let response;
    try {
      response = await this.fetch(`${GROQ_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: combinedRequestSignal(timeoutMs, signal)
      });
    } catch (error) {
      const abortError = activeAbortReason(signal, error);
      if (abortError) throw abortError;
      throw new AIRuntimeError('Groq could not be reached', {
        code: 'AI_PROVIDER_NETWORK_ERROR',
        statusCode: 503,
        retryable: true,
        details: sanitizeMessage(error.message)
      });
    }
    return response;
  }

  async localProviderRequest({ route, input, context, requestId, timeoutMs = 240_000, signal }) {
    const baseUrl = String(process.env.LOCAL_LLM_BASE_URL || 'http://127.0.0.1:11435').replace(/\/+$/, '');
    const secret = String(process.env.LOCAL_LLM_SHARED_SECRET || '').trim();
    if (!secret) {
      throw new AIRuntimeError('Local CV runtime is not configured', {
        code: 'AI_LOCAL_NOT_CONFIGURED', statusCode: 503, retryable: true
      });
    }
    if (!String(requestId || '').trim() || !String(context?.usageExecutionId || '').trim()) {
      throw new AIRuntimeError('Local inference requires a durable usage execution context', {
        code: 'AI_USAGE_CONTEXT_REQUIRED',
        statusCode: 500,
        retryable: false
      });
    }
    const usageEventId = deriveRuntimeUsageEventId({ context, route });
    const sourceApp = String(context.sourceApp || input.context?.sourceApp || 'recruiter').slice(0, 64);
    const experienceProfile = String(route.activity || '').startsWith('experience.');
    const userOwned = isUserOwnedProvider(route.provider);
    const requiredEngine = userOwned || route.provider === 'local-codex'
      ? 'codex'
      : route.provider === 'local-claude'
        ? 'claude'
        : undefined;
    // The gateway derives the subject key itself; sending the raw user id keeps
    // the namespace under the gateway's control rather than this caller's.
    const codexSubjectId = userOwned ? String(route.codexSubjectId || '') : '';
    if (userOwned && !codexSubjectId) {
      throw new AIRuntimeError('This activity requires a connected ChatGPT account', {
        code: 'CHATGPT_SUBJECT_UNRESOLVED', statusCode: 409, retryable: false
      });
    }
    const body = JSON.stringify({
      activity: route.activity,
      model: userOwned ? undefined : route.model,
      executionMode: 'local-only',
      runtimeProfile: experienceProfile ? 'experience-management' : undefined,
      requiredEngine: !experienceProfile ? requiredEngine : undefined,
      requiredModel: requiredEngine && !experienceProfile && !userOwned ? route.model : undefined,
      codexSourceApp: userOwned ? 'recruiter' : undefined,
      codexSubjectId: userOwned ? codexSubjectId : undefined,
      // Ordered preferences with their source, not one value: plans differ, so
      // the connected account resolves these and degrades rather than failing.
      codexModelCandidates: userOwned ? codexModelCandidates(route) : undefined,
      codexEffortCandidates: userOwned ? codexEffortCandidates(route) : undefined,
      messages: input.messages,
      jsonSchema: input.jsonSchema || input.response_format?.json_schema?.schema,
      schemaName: input.schemaName,
      requestSource: sourceApp,
      temperature: input.temperature,
      topP: input.topP ?? input.top_p,
      maxTokens: input.maxTokens ?? input.max_tokens ?? input.max_completion_tokens,
      reasoningEffort: route.reasoningEffort || 'medium',
      tools: input.tools,
      toolChoice: input.toolChoice ?? input.tool_choice,
      timeoutMs,
      metering: {
        record: true,
        eventId: usageEventId,
        requestId: String(requestId).slice(0, 200),
        gatewayExecutionId: deriveGatewayExecutionId(usageEventId),
        sourceApp
      }
    });
    const endpoint = ['candidate.cv_parse', 'ai_interview.cv_parse'].includes(route.activity)
      ? '/v1/cv/analyze'
      : '/v1/complete';
    const signed = signLocalRequest(secret, body, { method: 'POST', path: endpoint });
    try {
      return await this.fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-seemplify-timestamp': signed.timestamp,
          'x-seemplify-nonce': signed.nonce,
          'x-seemplify-signature': signed.signature
        },
        body,
        signal: combinedRequestSignal(timeoutMs, signal)
      });
    } catch (error) {
      const abortError = activeAbortReason(signal, error);
      if (abortError) throw abortError;
      throw new AIRuntimeError('Local CV runtime could not be reached', {
        code: 'AI_LOCAL_UNAVAILABLE', statusCode: 503, retryable: true, details: sanitizeMessage(error.message)
      });
    }
  }

  async getLocalRuntimeStatus() {
    const baseUrl = String(process.env.LOCAL_LLM_BASE_URL || 'http://127.0.0.1:11435').replace(/\/+$/, '');
    const secret = String(process.env.LOCAL_LLM_SHARED_SECRET || '').trim();
    if (!secret) return { configured: false, reachable: false, error: 'Local CV runtime secret is not configured' };
    const body = JSON.stringify({ operation: 'status' });
    const signed = signLocalRequest(secret, body, { method: 'POST', path: '/v1/status' });
    try {
      const response = await this.fetch(`${baseUrl}/v1/status`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-seemplify-timestamp': signed.timestamp,
          'x-seemplify-nonce': signed.nonce,
          'x-seemplify-signature': signed.signature
        },
        body,
        signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(8_000) : undefined
      });
      const data = await response.json();
      return { configured: true, reachable: response.ok, ...data };
    } catch (error) {
      return { configured: true, reachable: false, error: sanitizeMessage(error.message) };
    }
  }

  async parseErrorResponse(response, provider = 'groq') {
    let payload = null;
    const text = await response.text();
    try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
    const details = errorDetails(payload, response.status, provider);
    const rateLimit = parseRateLimitHeaders(response.headers);
    const hasGatewayIdentity = /^localexec_[a-f0-9]{48}$/.test(String(payload?.gatewayExecutionId || ''));
    const usageEnvelope = (payload?.usage && typeof payload.usage === 'object') || hasGatewayIdentity
      ? {
          id: payload.id,
          provider: payload.engine ? `local-${payload.engine}` : undefined,
          model: payload.model,
          gatewayExecutionId: payload.gatewayExecutionId,
          usage: payload.usage && typeof payload.usage === 'object' ? payload.usage : {},
          usageReported: payload.usageReported === true,
          usageSource: payload.usageSource
        }
      : null;
    const defaultRetryable = response.status === 401
      || response.status === 403
      || response.status === 429
      || response.status === 498
      || response.status >= 500
      || details.blockedAccess;
    return new AIRuntimeError(details.message, {
      code: details.code,
      statusCode: response.status >= 500 || response.status === 429 || response.status === 498 ? 503 : response.status,
      providerStatus: response.status,
      retryable: typeof payload?.retryable === 'boolean' ? payload.retryable : defaultRetryable,
      details: {
        blockedAccess: details.blockedAccess,
        payloadType: payload?.error?.type,
        rateLimit,
        usageEnvelope
      }
    });
  }

  async recordResult({ requestId, context, route, credential, status, response, payload, data, error, attempts, attemptErrors, startedAt }) {
    const rateLimit = parseRateLimitHeaders(response?.headers);
    const rawUsage = data?.usage;
    const usageReported = typeof data?.usageReported === 'boolean'
      ? data.usageReported
      : Boolean(rawUsage && typeof rawUsage === 'object' && [
        'prompt_tokens',
        'input_tokens',
        'inputTokens',
        'completion_tokens',
        'output_tokens',
        'outputTokens',
        'total_tokens',
        'totalTokens'
      ].some((field) => Object.hasOwn(rawUsage, field)));
    const usage = normalizeUsage(rawUsage || {});
    const gatewayMetered = Boolean(data?.gatewayExecutionId) || isGatewayProvider(route.provider);
    const event = {
      eventId: gatewayMetered
        ? deriveRuntimeUsageEventId({ context, route })
        : deriveProviderOutcomeUsageEventId({ context, route }),
      requestId,
      providerRequestId: rateLimit.providerRequestId || data?.id,
      gatewayExecutionId: data?.gatewayExecutionId,
      meteringOrigin: data?.gatewayExecutionId ? 'backend-response' : undefined,
      atSourceOnly: false,
      sourceApp: context.sourceApp || 'recruiter',
      activity: route.activity,
      provider: data?.provider || route.provider,
      model: data?.model || route.model,
      // Personal-plan work must stay separable from billable platform usage in
      // every rollup, so the owner is stamped on the durable event itself.
      runtimeOwner: route.runtimeOwner === 'user' || data?.runtimeOwner === 'user' ? 'user' : 'platform',
      reasoningEffort: route.reasoningEffort,
      routeVersion: route.routeVersion || 1,
      promptVersion: context.promptVersion || '1',
      credential: credential?._id,
      credentialLabel: credential?.label,
      quotaGroup: credential?.quotaGroup,
      organizationId: context.organizationId,
      organizationName: context.organizationName,
      actorId: context.actorId,
      actorName: context.actorName,
      actorEmail: context.actorEmail,
      interviewId: context.interviewId,
      sessionId: context.sessionId,
      jobId: context.jobId,
      candidateId: context.candidateId,
      status,
      httpStatus: response?.status || error?.providerStatus || error?.statusCode,
      errorCode: error?.code,
      errorMessage: error?.message,
      attempts,
      failovers: calculateFailovers(route, attempts),
      failoverFrom: route.failoverFrom,
      failoverReason: route.failoverReason,
      attemptErrors: (attemptErrors || []).slice(0, MAX_PROVIDER_ATTEMPTS).map((item) => ({
        ...item,
        message: sanitizeMessage(item.message)
      })),
      latencyMs: Date.now() - startedAt,
      promptBytes: Buffer.byteLength(JSON.stringify(payload?.messages || [])),
      responseBytes: Buffer.byteLength(JSON.stringify(data || {})),
      usageReported,
      usageSource: usageReported
        ? String(data?.usageSource || (
          String(data?.provider || route.provider).startsWith('local-') ? 'local-gateway' : 'provider-response'
        )).slice(0, 100)
        : 'unreported',
      usage,
      estimatedCostUsd: Number.isFinite(Number(data?.estimatedCostUsd))
        ? Math.max(0, Number(data.estimatedCostUsd))
        : calculateEstimatedCost(usage, route.modelConfig?.pricing),
      rateLimit
    };
    const result = await recordUsage(event);
    if (result.quota) {
      void this.getSettings()
        .then((settings) => evaluateUsageAlerts({ event: result.event || event, quota: result.quota, settings }))
        .catch((alertError) => console.error('AI usage alert scheduling failed:', sanitizeMessage(alertError.message)));
    }
    return result;
  }

  async completeAzureBaseline({ route, input, options, context, requestId }) {
    const payload = this.normalizePayload(input, route, { stream: false });
    const startedAt = Date.now();
    let response;
    try {
      response = await this.azureRollback.request({
        payload,
        timeoutMs: options.timeoutMs,
        signal: options.signal
      });
      if (!response.ok) throw await this.parseErrorResponse(response, 'azure');
      const data = stripReasoning(await response.json());
      const content = data?.choices?.[0]?.message?.content;
      const toolCalls = data?.choices?.[0]?.message?.tool_calls;
      if (!String(content || '').trim() && !Array.isArray(toolCalls)) {
        throw new AIRuntimeError('Azure text baseline returned an empty completion', {
          code: 'AI_EMPTY_RESPONSE', statusCode: 503
        });
      }
      await this.recordResult({
        requestId, context, route, status: 'success', response, payload, data, attempts: 1, startedAt
      });
      return {
        requestId,
        content: String(content || '').trim(),
        toolCalls: toolCalls || [],
        finishReason: data?.choices?.[0]?.finish_reason,
        model: data?.model || route.model,
        usage: normalizeUsage(data?.usage || {}),
        raw: data
      };
    } catch (error) {
      const abortError = activeAbortReason(options.signal, error);
      if (abortError) throw abortError;
      if (isUsagePersistenceFailure(error)) throw error;
      const runtimeError = error instanceof AIRuntimeError ? error : new AIRuntimeError(
        sanitizeMessage(error.message),
        {
          code: error.code || 'AI_AZURE_BASELINE_ERROR',
          statusCode: error.statusCode || 503,
          retryable: false
        }
      );
      await this.recordResult({
        requestId, context, route, status: 'failed', response, payload,
        error: runtimeError, attempts: 1, startedAt
      });
      throw runtimeError;
    }
  }

  async completeGroq({ route, input, options, context, requestId, settings }) {
    const payload = this.normalizePayload(input, route, { stream: false });
    const startedAt = Date.now();
    const excludeIds = [];
    const excludeQuotaGroups = [];
    let lastError;
    let lastCredential;
    let lastResponse;
    const attemptErrors = [];

    for (let attempt = 1; attempt <= MAX_PROVIDER_ATTEMPTS; attempt += 1) {
      const credentials = await this.listEligibleCredentials({
        model: route.model,
        modelConfig: route.modelConfig,
        excludeIds,
        excludeQuotaGroups
      });
      const credential = credentials[0];
      if (!credential) {
        lastError = lastError || new AIRuntimeError('No healthy Groq credential is available', {
          code: 'AI_CREDENTIALS_EXHAUSTED', statusCode: 503
        });
        break;
      }
      lastCredential = credential;
      const attemptStartedAt = Date.now();
      let response;
      try {
        response = await this.providerRequest({
          credential,
          payload,
          timeoutMs: options.timeoutMs,
          signal: options.signal
        });
        lastResponse = response;
        if (!response.ok) throw await this.parseErrorResponse(response);
        const data = stripReasoning(await response.json());
        const content = data?.choices?.[0]?.message?.content;
        const toolCalls = data?.choices?.[0]?.message?.tool_calls;
        if (!String(content || '').trim() && !Array.isArray(toolCalls)) {
          throw new AIRuntimeError('Groq returned an empty completion', { code: 'AI_EMPTY_RESPONSE', statusCode: 503 });
        }
        await this.markCredentialSuccess(credential, settings);
        await this.recordResult({
          requestId, context, route, credential, status: 'success', response, payload, data,
          attempts: attempt, attemptErrors, startedAt
        });
        return {
          requestId,
          content: String(content || '').trim(),
          toolCalls: toolCalls || [],
          finishReason: data?.choices?.[0]?.finish_reason,
          model: data?.model || route.model,
          provider: 'groq',
          failover: route.failoverFrom
            ? { from: route.failoverFrom, reason: route.failoverReason }
            : null,
          usage: normalizeUsage(data?.usage || {}),
          raw: data
        };
      } catch (error) {
        const abortError = activeAbortReason(options.signal, error);
        if (abortError) throw abortError;
        if (isUsagePersistenceFailure(error)) throw error;
        lastError = error instanceof AIRuntimeError ? error : new AIRuntimeError(sanitizeMessage(error.message));
        attemptErrors.push(buildAttemptError({ attempt, credential, error: lastError, startedAt: attemptStartedAt }));
        await this.markCredentialFailure(credential, lastError, route.model, settings);
        excludeIds.push(credential._id);
        const providerStatus = Number(lastError.providerStatus || 0);
        if (providerStatus === 429 || lastError.details?.blockedAccess) excludeQuotaGroups.push(credential.quotaGroup);
        if (!lastError.retryable) break;
      }
    }

    await this.recordResult({
      requestId,
      context,
      route,
      credential: lastCredential,
      status: 'failed',
      response: lastResponse,
      payload,
      error: lastError,
      attempts: Math.max(1, excludeIds.length),
      attemptErrors,
      startedAt
    });
    throw lastError || new AIRuntimeError('Groq request failed');
  }

  /**
   * Returns a user-owned route to the activity's managed runtime, recording why.
   *
   * Ported from Experience Management's effectiveAiProviderSnapshot: when the
   * ChatGPT runtime cannot be used, work continues on the managed runtime if a
   * platform administrator has left it enabled, and only fails when they have
   * not. Degrading keeps queued and retried work moving; failing is reserved
   * for the case where there is genuinely nowhere else to run.
   */
  managedRuntimeRoute(route, settings, reason, policy) {
    if (!policy.localEnabled) {
      throw new AIRuntimeError(
        reason === 'chatgpt_consent_absent'
          ? 'ChatGPT data sharing is no longer acknowledged and the local AI runtime is disabled.'
          : 'This AI action has no connected ChatGPT account and the local runtime is disabled.',
        {
          code: reason === 'chatgpt_consent_absent'
            ? 'CODEX_DATA_SHARING_ACKNOWLEDGEMENT_REQUIRED'
            : 'AI_RUNTIME_ACCOUNT_REQUIRED',
          statusCode: 409,
          retryable: false
        }
      );
    }
    const definition = ACTIVITY_DEFINITIONS[route.activity] || {};
    const provider = definition.provider || 'groq';
    const model = definition.model || GROQ_120B;
    const modelConfig = settings?.models?.find((item) => (
      item.id === model && item.provider === provider && item.enabled !== false
    ));
    if (!modelConfig || modelConfig.available === false) {
      throw new AIRuntimeError(
        `${route.activity} cannot use ChatGPT for this request and no managed runtime is available`,
        { code: 'AI_FAILOVER_MODEL_UNAVAILABLE', statusCode: 503, retryable: true }
      );
    }
    return {
      ...route,
      provider,
      model,
      modelConfig,
      failoverPolicy: failoverPolicyForRoute(route.activity, provider),
      failoverFrom: route.provider,
      failoverReason: reason
    };
  }

  /**
   * Binds a user-owned route to the person whose ChatGPT plan will pay for it,
   * or returns it to the managed runtime.
   *
   * Consent is deliberately re-read here rather than trusted from the route:
   * provider and model are durable job inputs, but a privacy revocation is an
   * immediate override, so queued and retried work stops using ChatGPT as soon
   * as consent is withdrawn.
   */
  async attachCodexSubject(route, context, settings) {
    if (!isUserOwnedProvider(route.provider)) return route;
    const policy = normalizeRuntimePolicy(settings?.runtimePolicy);
    const activity = String(route.activity || '');
    // Cross-product work arrives through /api/internal/ai carrying another
    // product's user. It has no Recruiter account to bill, so it runs where it
    // ran before ChatGPT existed.
    if (activity.startsWith('experience.') || activity.startsWith('knowledge.')) {
      return this.managedRuntimeRoute(route, settings, 'chatgpt_cross_product_request', policy);
    }
    // Unattributed work — a public applicant's CV has no account that could
    // ever be connected.
    const actorId = String(context?.actorId || '').trim();
    if (!actorId) {
      return this.managedRuntimeRoute(route, settings, 'chatgpt_unattributed_request', policy);
    }
    const subject = await this.resolveSubject(actorId);
    if (!subject) {
      return this.managedRuntimeRoute(route, settings, 'chatgpt_consent_absent', policy);
    }
    return { ...route, codexSubjectId: subject.subjectId, runtimeOwner: 'user' };
  }

  async complete(activity, input = {}, options = {}) {
    const abortedBeforeStart = activeAbortReason(options.signal);
    if (abortedBeforeStart) throw abortedBeforeStart;
    const settings = await this.getSettings();
    const configuredRoute = this.resolveRoute(activity, settings);
    const context = withUsageExecutionContext(getAIRequestContext({
      ...(input.context || {}),
      ...(options.context || {}),
      promptVersion: input.promptVersion
    }));
    const requestId = context.requestId || crypto.randomUUID();
    const route = await this.attachCodexSubject(
      this.resolveExecutionRoute(configuredRoute, settings, { ...context, requestId }),
      context,
      settings
    );
    if (isGatewayProvider(route.provider)) {
      const startedAt = Date.now();
      const payload = this.normalizePayload(input, route, { stream: false });
      let response;
      try {
        response = await this.localProviderRequest({
          route,
          input,
          context,
          requestId,
          timeoutMs: options.timeoutMs || 240_000,
          signal: options.signal
        });
        if (!response.ok) throw await this.parseErrorResponse(response, route.provider);
        const localData = await response.json();
        const localProvider = localData.provider
          || (localData.engine ? `local-${localData.engine}` : route.provider);
        const data = {
          id: localData.id,
          provider: localProvider,
          providerLabel: localData.providerLabel
            || localProviderLabel(localProvider, localData.model || route.model),
          model: localData.model || route.model,
          choices: [{
            message: {
              content: localData.content,
              ...(localData.toolCalls?.length ? { tool_calls: localData.toolCalls } : {})
            },
            finish_reason: localData.finishReason || (localData.toolCalls?.length ? 'tool_calls' : 'stop')
          }],
          usage: localData.usage || {},
          usageReported: localData.usageReported,
          usageSource: localData.usageSource,
          gatewayExecutionId: localData.gatewayExecutionId
        };
        await this.recordResult({
          requestId, context, route, status: 'success', response, payload, data, attempts: 1, startedAt
        });
        return {
          requestId,
          content: String(localData.content || '').trim(),
          toolCalls: localData.toolCalls || [],
          finishReason: data.choices[0].finish_reason,
          model: data.model,
          provider: data.provider,
          providerLabel: data.providerLabel,
          engine: localData.engine,
          usage: normalizeUsage(data.usage),
          raw: {
            ...data,
            localEngine: localData.engine,
            localProviderLabel: data.providerLabel,
            localMetrics: localData.metrics
          }
        };
      } catch (error) {
        const abortError = activeAbortReason(options.signal, error);
        if (abortError) throw abortError;
        if (isUsagePersistenceFailure(error)) throw error;
        const runtimeError = error instanceof AIRuntimeError ? error : new AIRuntimeError(
          sanitizeMessage(error.message),
          { code: error.code || 'AI_LOCAL_UNAVAILABLE', statusCode: 503, retryable: true }
        );
        await this.recordResult({
          requestId, context, route, status: 'failed', response, payload,
          data: runtimeError.details?.usageEnvelope || undefined,
          error: runtimeError, attempts: 1, startedAt
        });
        const fallbackRoute = isLocalRuntimeUnavailable(runtimeError)
          ? this.createGroqFailoverRoute(
              route,
              settings,
              runtimeError.code || 'local_request_failed'
            )
          : null;
        if (fallbackRoute) {
          return this.completeGroq({
            route: fallbackRoute,
            input,
            options,
            context,
            requestId,
            settings
          });
        }
        throw runtimeError;
      }
    }
    if (route.provider === 'azure') {
      return this.completeAzureBaseline({ route, input, options, context, requestId });
    }
    return this.completeGroq({ route, input, options, context, requestId, settings });
  }

  async chatCompletion(messages, options = {}) {
    return this.complete(options.activity || 'recruiter.general', { ...options, messages });
  }

  async getExecutionRoute(activity, context = {}) {
    const settings = await this.getSettings();
    const configured = this.resolveRoute(activity, settings);
    return this.resolveExecutionRoute(configured, settings, context);
  }

  async structuredComplete(activity, input = {}, options = {}) {
    const schema = input.jsonSchema;
    if (!schema || typeof schema !== 'object' || schema.type !== 'object') {
      throw new AIRuntimeError('A root object JSON Schema is required', {
        code: 'AI_SCHEMA_INVALID', statusCode: 400
      });
    }
    const schemaName = String(input.schemaName || activity.replace(/[^a-z0-9_-]/gi, '_')).slice(0, 64);
    const baseMessages = Array.isArray(input.messages) ? input.messages : [];
    const structuredContext = withUsageExecutionContext(getAIRequestContext({
      ...(input.context || {}),
      ...(options.context || {})
    }));
    const structuredRequestId = structuredContext.requestId || crypto.randomUUID();
    let messages = baseMessages;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const abortedBeforeAttempt = activeAbortReason(options.signal);
      if (abortedBeforeAttempt) throw abortedBeforeAttempt;
      if (typeof options.beforeAttempt === 'function') {
        await options.beforeAttempt({ attempt: attempt + 1, activity });
      }
      const result = await this.complete(activity, {
        ...input,
        context: {
          ...(input.context || {}),
          ...structuredContext,
          requestId: structuredRequestId,
          structuredCompletionOrdinal: attempt + 1
        },
        messages,
        response_format: {
          type: 'json_schema',
          json_schema: { name: schemaName, strict: input.schemaStrict !== false, schema }
        }
      }, {
        ...options,
        context: {
          ...(options.context || {}),
          ...structuredContext,
          requestId: structuredRequestId,
          structuredCompletionOrdinal: attempt + 1
        }
      });
      let parsed;
      try {
        parsed = JSON.parse(result.content);
      } catch {
        parsed = null;
      }
      const validation = parsed === null
        ? { valid: false, errors: ['$: response is not valid JSON'] }
        : validateJsonSchema(parsed, schema);
      if (validation.valid) return { ...result, data: parsed, schemaRepairAttempted: attempt > 0 };
      if (attempt === 0) {
        messages = [
          ...baseMessages,
          { role: 'assistant', content: result.content },
          {
            role: 'user',
            content: `Return a corrected JSON object that matches the supplied schema. Validation issues: ${validation.errors.slice(0, 12).join('; ')}`
          }
        ];
      }
    }

    throw new AIRuntimeError('The model response did not satisfy the required schema after one repair attempt', {
      code: 'AI_SCHEMA_VALIDATION_FAILED', statusCode: 503
    });
  }

  async monitorStream({ stream, requestId, context, route, credential, response, payload, attempt, attemptErrors, startedAt }) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let dataForUsage = { model: route.model, usage: {}, choices: [] };
    let responseBytes = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        responseBytes += value.byteLength;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const raw = trimmed.slice(5).trim();
          if (!raw || raw === '[DONE]') continue;
          try {
            const chunk = JSON.parse(raw);
            if (chunk.model) dataForUsage.model = chunk.model;
            if (chunk.usage) dataForUsage.usage = chunk.usage;
            if (chunk.id) dataForUsage.id = chunk.id;
          } catch {
            // Ignore incomplete provider chunks; the client receives the original stream.
          }
        }
      }
      dataForUsage.responseBytes = responseBytes;
      await this.recordResult({
        requestId, context, route, credential, status: 'success', response, payload,
        data: dataForUsage, attempts: attempt, attemptErrors, startedAt
      });
    } catch (error) {
      if (isUsagePersistenceFailure(error)) throw error;
      await this.recordResult({
        requestId, context, route, credential, status: 'failed', response, payload,
        error: new AIRuntimeError('Groq stream ended unexpectedly', { code: 'AI_STREAM_INTERRUPTED' }),
        attempts: attempt, attemptErrors, startedAt
      });
    }
  }

  async streamAzureBaseline({ route, input, options, context, requestId }) {
    const payload = this.normalizePayload(input, route, { stream: true });
    const startedAt = Date.now();
    let response;
    try {
      response = await this.azureRollback.request({ payload, timeoutMs: options.timeoutMs });
      if (!response.ok) throw await this.parseErrorResponse(response, 'azure');
      if (!response.body || typeof response.body.tee !== 'function') return response;
      const [clientStream, telemetryStream] = response.body.tee();
      void this.monitorStream({
        stream: telemetryStream, requestId, context, route, response, payload, attempt: 1, startedAt
      }).catch((error) => {
        console.error('AI stream usage persistence failed:', sanitizeMessage(error.message));
      });
      return new Response(clientStream, { status: response.status, headers: response.headers });
    } catch (error) {
      if (isUsagePersistenceFailure(error)) throw error;
      const runtimeError = error instanceof AIRuntimeError ? error : new AIRuntimeError(
        sanitizeMessage(error.message),
        { code: error.code || 'AI_AZURE_BASELINE_ERROR', statusCode: error.statusCode || 503 }
      );
      await this.recordResult({
        requestId, context, route, status: 'failed', response, payload,
        error: runtimeError, attempts: 1, startedAt
      });
      throw runtimeError;
    }
  }

  async streamResponse(activity, input = {}, options = {}) {
    const settings = await this.getSettings();
    const configuredRoute = this.resolveRoute(activity, settings);
    const context = withUsageExecutionContext(getAIRequestContext({
      ...(input.context || {}),
      ...(options.context || {}),
      promptVersion: input.promptVersion
    }));
    const requestId = context.requestId || crypto.randomUUID();
    const route = this.resolveExecutionRoute(configuredRoute, settings, { ...context, requestId });
    if (isGatewayProvider(route.provider)) {
      const result = await this.complete(activity, {
        ...input,
        stream: false,
        context: { ...(input.context || {}), ...context, requestId }
      }, options);
      const chunks = [];
      const base = {
        id: result.requestId,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: result.model
      };
      chunks.push({
        ...base,
        choices: [{
          index: 0,
          delta: {
            role: 'assistant',
            ...(result.content ? { content: result.content } : {}),
            ...(result.toolCalls.length ? { tool_calls: result.toolCalls } : {})
          },
          finish_reason: null
        }]
      });
      chunks.push({
        ...base,
        choices: [{ index: 0, delta: {}, finish_reason: result.finishReason || 'stop' }],
        usage: {
          prompt_tokens: result.usage.inputTokens,
          completion_tokens: result.usage.outputTokens,
          total_tokens: result.usage.totalTokens
        }
      });
      const encoded = new TextEncoder().encode(`${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`);
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoded);
          controller.close();
        }
      }), {
        status: 200,
        headers: {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
          'x-request-id': result.requestId
        }
      });
    }
    if (route.provider === 'azure') {
      return this.streamAzureBaseline({ route, input, options, context, requestId });
    }
    const payload = this.normalizePayload(input, route, { stream: true });
    const startedAt = Date.now();
    const excludeIds = [];
    const excludeQuotaGroups = [];
    let lastError;
    let lastCredential;
    let lastResponse;
    const attemptErrors = [];

    for (let attempt = 1; attempt <= MAX_PROVIDER_ATTEMPTS; attempt += 1) {
      const credentials = await this.listEligibleCredentials({
        model: route.model,
        modelConfig: route.modelConfig,
        excludeIds,
        excludeQuotaGroups
      });
      const credential = credentials[0];
      if (!credential) break;
      lastCredential = credential;
      const attemptStartedAt = Date.now();
      try {
        const response = await this.providerRequest({
          credential,
          payload,
          timeoutMs: options.timeoutMs,
          signal: options.signal
        });
        lastResponse = response;
        if (!response.ok) throw await this.parseErrorResponse(response);
        await this.markCredentialSuccess(credential, settings);
        if (!response.body || typeof response.body.tee !== 'function') {
          await this.recordResult({
            requestId, context, route, credential, status: 'success', response, payload,
            data: {}, attempts: attempt, attemptErrors, startedAt
          });
          return response;
        }
        const [clientStream, telemetryStream] = response.body.tee();
        void this.monitorStream({
          stream: telemetryStream, requestId, context, route, credential, response, payload,
          attempt, attemptErrors, startedAt
        }).catch((error) => {
          console.error('AI stream usage persistence failed:', sanitizeMessage(error.message));
        });
        return new Response(clientStream, { status: response.status, headers: response.headers });
      } catch (error) {
        if (isUsagePersistenceFailure(error)) throw error;
        lastError = error instanceof AIRuntimeError ? error : new AIRuntimeError(sanitizeMessage(error.message));
        attemptErrors.push(buildAttemptError({ attempt, credential, error: lastError, startedAt: attemptStartedAt }));
        await this.markCredentialFailure(credential, lastError, route.model, settings);
        excludeIds.push(credential._id);
        if (lastError.providerStatus === 429 || lastError.details?.blockedAccess) excludeQuotaGroups.push(credential.quotaGroup);
        if (!lastError.retryable) break;
      }
    }
    await this.recordResult({
      requestId, context, route, credential: lastCredential, status: 'failed', response: lastResponse,
      payload, error: lastError, attempts: Math.max(1, excludeIds.length), attemptErrors, startedAt
    });
    throw lastError || new AIRuntimeError('No healthy Groq credential is available', { code: 'AI_CREDENTIALS_EXHAUSTED' });
  }

  createLangChainFetch(defaultActivity = 'assistant.chat') {
    return async (_url, init = {}) => {
      let body = {};
      try { body = JSON.parse(String(init.body || '{}')); } catch {
        return responseJson({ error: { code: 'invalid_request', message: 'Invalid AI runtime request JSON' } }, 400);
      }
      try {
        if (body.stream) return await this.streamResponse(defaultActivity, body);
        const result = await this.complete(defaultActivity, body);
        return responseJson(result.raw, 200, { 'x-request-id': result.requestId });
      } catch (error) {
        return responseJson({ error: { code: error.code || 'AI_RUNTIME_ERROR', message: sanitizeMessage(error.message) } }, error.statusCode || 503);
      }
    };
  }

  async testCredential(credentialId, model = GROQ_120B) {
    const settings = await this.getSettings();
    const route = {
      activity: 'recruiter.general', provider: 'groq', model, reasoningEffort: 'low', routeVersion: 1,
      modelConfig: settings.models.find((item) => item.id === model)
    };
    if (!route.modelConfig) throw new AIRuntimeError('Unknown Groq model', { code: 'AI_MODEL_NOT_CONFIGURED', statusCode: 400 });
    const credential = await this.getCredential(credentialId);
    const payload = this.normalizePayload({
      messages: [{ role: 'user', content: 'Reply with OK.' }],
      temperature: 0,
      max_tokens: 8
    }, route);
    const startedAt = Date.now();
    try {
      const response = await this.providerRequest({ credential, payload, timeoutMs: 30_000 });
      if (!response.ok) throw await this.parseErrorResponse(response);
      const data = await response.json();
      await this.markCredentialSuccess(credential, settings);
      await this.recordResult({
        requestId: crypto.randomUUID(), context: { sourceApp: 'admin-health-check' }, route, credential,
        status: 'success', response, payload, data, attempts: 1, startedAt
      });
      return { success: true, model: data.model || model, response: String(data?.choices?.[0]?.message?.content || '').trim() };
    } catch (error) {
      await this.markCredentialFailure(credential, error, model, settings);
      throw error;
    }
  }

  async syncModels(credentialId) {
    const credential = credentialId ? await this.getCredential(credentialId) : (await this.listEligibleCredentials())[0];
    if (!credential) throw new AIRuntimeError('No Groq credential is available', { code: 'AI_CREDENTIALS_EXHAUSTED' });
    const apiKey = decryptSecret(credential.encryptedSecret);
    const response = await this.fetch(`${GROQ_BASE_URL}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!response.ok) throw await this.parseErrorResponse(response);
    const payload = await response.json();
    const availableIds = new Set((payload.data || []).map((item) => item.id).filter(Boolean));
    const settings = await this.getSettings({ force: true });
    const syncedAt = new Date();
    const models = settings.models.map((model) => model.provider === 'groq'
      ? { ...model, available: availableIds.has(model.id), lastSyncedAt: syncedAt }
      : model);
    await this.Settings.updateOne({ key: 'global' }, { $set: { models }, $inc: { version: 1 } });
    this.invalidateSettingsCache();
    return { models, availableCount: availableIds.size };
  }
}

const aiRuntimeService = new AIRuntimeService();

module.exports = aiRuntimeService;
module.exports.AIRuntimeError = AIRuntimeError;
module.exports.AIRuntimeService = AIRuntimeService;
module.exports.calculateFailovers = calculateFailovers;
module.exports.deriveGatewayExecutionId = deriveGatewayExecutionId;
module.exports.deriveRuntimeUsageEventId = deriveRuntimeUsageEventId;
module.exports.deterministicBucket = deterministicBucket;
module.exports.isLocalRuntimeUnavailable = isLocalRuntimeUnavailable;
module.exports.quotaSnapshotIsAvailable = quotaSnapshotIsAvailable;
module.exports.rateLimitCooldownUntil = rateLimitCooldownUntil;
module.exports.requiredCapabilitiesForActivity = requiredCapabilitiesForActivity;
module.exports.shouldUseGroq = shouldUseGroq;
module.exports.stripReasoning = stripReasoning;
module.exports.signLocalRequest = signLocalRequest;
