const crypto = require('crypto');
const AIProviderCredential = require('../../models/AIProviderCredential');
const AIQuotaSnapshot = require('../../models/AIQuotaSnapshot');
const AIRuntimeSettings = require('../../models/AIRuntimeSettings');
const {
  ACTIVITY_DEFINITIONS,
  GROQ_120B,
  GROQ_BASE_URL,
  createDefaultRuntimeSettings
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
const STRUCTURED_ACTIVITIES = new Set([
  'candidate.cv_parse',
  'job.description',
  'job.requirements',
  'job.normalize',
  'matching.analysis',
  'matching.report',
  'assistant.tool_selection',
  'assistant.job_extract',
  'analytics.candidates',
  'analytics.jobs',
  'analytics.hiring',
  'interview.questions',
  'interview.bias',
  'interview.analysis',
  'interview.summary',
  'interview.team_feedback',
  'ai_interview.question_generation',
  'ai_interview.cv_parse',
  'ai_interview.scoring'
]);

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
  return {
    code,
    message: sanitizeMessage(body.message || `${provider === 'groq' ? 'Groq' : 'Azure'} request failed with status ${status}`),
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

class AIRuntimeService {
  constructor({
    fetchImpl = global.fetch,
    credentialModel = AIProviderCredential,
    quotaModel = AIQuotaSnapshot,
    settingsModel = AIRuntimeSettings,
    azureRollbackAdapter
  } = {}) {
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
    settings = {
      ...defaults,
      ...settings,
      models: Array.isArray(settings?.models) && settings.models.length ? settings.models : defaults.models,
      routes: Array.isArray(settings?.routes) && settings.routes.length ? settings.routes : defaults.routes,
      quotaGroups: Array.isArray(settings?.quotaGroups) && settings.quotaGroups.length ? settings.quotaGroups : defaults.quotaGroups,
      alerts: { ...defaults.alerts, ...(settings?.alerts || {}) },
      rollout: { ...defaults.rollout, ...(settings?.rollout || {}) }
    };
    this.settingsCache = settings;
    this.settingsCacheExpiresAt = Date.now() + SETTINGS_CACHE_MS;
    return settings;
  }

  resolveRoute(activity, settings) {
    if (!ACTIVITY_DEFINITIONS[activity]) {
      throw new AIRuntimeError(`Unknown AI activity ${activity}`, { code: 'AI_ACTIVITY_UNKNOWN', statusCode: 400 });
    }
    const normalized = activity;
    const route = settings.routes.find((item) => item.activity === normalized);
    if (!route) {
      throw new AIRuntimeError(`No route is configured for ${normalized}`, { code: 'AI_ROUTE_NOT_CONFIGURED', statusCode: 503 });
    }
    if (!route?.enabled || !settings.providerEnabled) {
      throw new AIRuntimeError(`AI activity ${normalized} is disabled`, { code: 'AI_ACTIVITY_DISABLED', statusCode: 503 });
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
    if (shouldUseGroq(context, settings.rollout)) return route;
    return {
      ...route,
      provider: 'azure',
      model: 'azure-text-baseline',
      modelConfig: {
        id: 'azure-text-baseline',
        provider: 'azure',
        label: 'Azure text rollback baseline',
        pricing: {}
      }
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
    payload.reasoning_format = 'hidden';
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

  async providerRequest({ credential, payload, timeoutMs = 90_000 }) {
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
        signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined
      });
    } catch (error) {
      throw new AIRuntimeError('Groq could not be reached', {
        code: 'AI_PROVIDER_NETWORK_ERROR',
        statusCode: 503,
        retryable: true,
        details: sanitizeMessage(error.message)
      });
    }
    return response;
  }

  async parseErrorResponse(response, provider = 'groq') {
    let payload = null;
    const text = await response.text();
    try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
    const details = errorDetails(payload, response.status, provider);
    const rateLimit = parseRateLimitHeaders(response.headers);
    return new AIRuntimeError(details.message, {
      code: details.code,
      statusCode: response.status >= 500 || response.status === 429 || response.status === 498 ? 503 : response.status,
      providerStatus: response.status,
      retryable: response.status === 401 || response.status === 403 || response.status === 429 || response.status === 498 || response.status >= 500 || details.blockedAccess,
      details: { blockedAccess: details.blockedAccess, payloadType: payload?.error?.type, rateLimit }
    });
  }

  async recordResult({ requestId, context, route, credential, status, response, payload, data, error, attempts, attemptErrors, startedAt }) {
    const rateLimit = parseRateLimitHeaders(response?.headers);
    const usage = normalizeUsage(data?.usage || {});
    const event = {
      requestId,
      providerRequestId: rateLimit.providerRequestId || data?.id,
      sourceApp: context.sourceApp || 'recruiter',
      activity: route.activity,
      provider: route.provider,
      model: data?.model || route.model,
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
      failovers: Math.max(0, attempts - 1),
      attemptErrors: (attemptErrors || []).slice(0, MAX_PROVIDER_ATTEMPTS).map((item) => ({
        ...item,
        message: sanitizeMessage(item.message)
      })),
      latencyMs: Date.now() - startedAt,
      promptBytes: Buffer.byteLength(JSON.stringify(payload?.messages || [])),
      responseBytes: Buffer.byteLength(JSON.stringify(data || {})),
      usage,
      estimatedCostUsd: calculateEstimatedCost(usage, route.modelConfig?.pricing),
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
      response = await this.azureRollback.request({ payload, timeoutMs: options.timeoutMs });
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

  async complete(activity, input = {}, options = {}) {
    const settings = await this.getSettings();
    const configuredRoute = this.resolveRoute(activity, settings);
    const context = getAIRequestContext({ ...(input.context || {}), ...(options.context || {}), promptVersion: input.promptVersion });
    const requestId = context.requestId || crypto.randomUUID();
    const route = this.resolveExecutionRoute(configuredRoute, settings, { ...context, requestId });
    if (route.provider === 'azure') {
      return this.completeAzureBaseline({ route, input, options, context, requestId });
    }
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
        response = await this.providerRequest({ credential, payload, timeoutMs: options.timeoutMs });
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
          usage: normalizeUsage(data?.usage || {}),
          raw: data
        };
      } catch (error) {
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

  async chatCompletion(messages, options = {}) {
    return this.complete(options.activity || 'recruiter.general', { ...options, messages });
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
    const structuredRequestId = getAIRequestContext(input.context).requestId || crypto.randomUUID();
    let messages = baseMessages;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await this.complete(activity, {
        ...input,
        context: { ...(input.context || {}), requestId: structuredRequestId },
        messages,
        response_format: {
          type: 'json_schema',
          json_schema: { name: schemaName, strict: input.schemaStrict !== false, schema }
        }
      }, options);
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
      });
      return new Response(clientStream, { status: response.status, headers: response.headers });
    } catch (error) {
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
    const context = getAIRequestContext({
      ...(input.context || {}),
      ...(options.context || {}),
      promptVersion: input.promptVersion
    });
    const requestId = context.requestId || crypto.randomUUID();
    const route = this.resolveExecutionRoute(configuredRoute, settings, { ...context, requestId });
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
        const response = await this.providerRequest({ credential, payload, timeoutMs: options.timeoutMs });
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
        });
        return new Response(clientStream, { status: response.status, headers: response.headers });
      } catch (error) {
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
    const models = settings.models.map((model) => ({ ...model, available: availableIds.has(model.id), lastSyncedAt: new Date() }));
    await this.Settings.updateOne({ key: 'global' }, { $set: { models }, $inc: { version: 1 } });
    this.invalidateSettingsCache();
    return { models, availableCount: availableIds.size };
  }
}

const aiRuntimeService = new AIRuntimeService();

module.exports = aiRuntimeService;
module.exports.AIRuntimeError = AIRuntimeError;
module.exports.AIRuntimeService = AIRuntimeService;
module.exports.deterministicBucket = deterministicBucket;
module.exports.quotaSnapshotIsAvailable = quotaSnapshotIsAvailable;
module.exports.rateLimitCooldownUntil = rateLimitCooldownUntil;
module.exports.requiredCapabilitiesForActivity = requiredCapabilitiesForActivity;
module.exports.shouldUseGroq = shouldUseGroq;
module.exports.stripReasoning = stripReasoning;
