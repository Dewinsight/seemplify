'use strict';

const crypto = require('node:crypto');
const AIRuntimeSettings = require('../../models/AIRuntimeSettings');
const {
  ACTIVITY_DEFINITIONS,
  CHATGPT_MODEL,
  CHATGPT_PROVIDER,
  LOCAL_MODEL,
  LOCAL_PROVIDER,
  createDefaultRuntimeSettings,
  isCandidateInterviewActivity,
  normalizeRuntimePolicy
} = require('../../config/aiRuntimeCatalog');
const { getAIRequestContext } = require('./requestContext');
const { normalizeUsage, sanitizeMessage } = require('./usageService');
const { validateJsonSchema } = require('./jsonSchemaValidator');

const SETTINGS_CACHE_MS = 15_000;
const LOCAL_LLM_SERVICE_ID = 'recruiter';
const LOCAL_LLM_SERVICE_KEY_CONTEXT = 'seemplify-local-llm-service-v2';
// This service belongs to the registered Recruiter product. Worker, admin and
// interview labels remain useful as requestSource diagnostics, but platform
// metering and authorization must always use the product identity.
const PLATFORM_SOURCE_APP = 'recruiter';
const METERING_SOURCE_APPS = new Set([
  'recruiter', 'performance-management', 'identity-provider',
  'leave-management', 'payroll', 'time-attendance'
]);

function meteringSourceApp(value) {
  const candidate = String(value || PLATFORM_SOURCE_APP).trim().toLowerCase();
  return METERING_SOURCE_APPS.has(candidate) ? candidate : PLATFORM_SOURCE_APP;
}

function meteringDimension(value, maximum = 160) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maximum) || undefined;
}
const STRUCTURED_ACTIVITIES = new Set([
  'candidate.cv_parse', 'candidate.insights', 'job.description', 'job.requirements', 'job.normalize',
  'matching.analysis', 'assistant.tool_selection', 'assistant.memory', 'assistant.job_extract',
  'interview.questions', 'interview.bias', 'interview.analysis', 'interview.summary',
  'interview.team_feedback', 'ai_interview.question_generation', 'ai_interview.cv_parse', 'ai_interview.scoring',
  'performance.self_assessment.report', 'performance.self_assessment.coach',
  'performance.document.analysis', 'performance.manager_review.assist', 'performance.review.bias',
  'performance.development_plan.suggest', 'performance.okr.generate', 'performance.feedback.analyze',
  'performance.team.insights', 'performance.meeting.analysis', 'performance.calibration.insights'
]);

class AIRuntimeError extends Error {
  constructor(message, { code = 'AI_RUNTIME_ERROR', statusCode = 503, retryable = false, details } = {}) {
    super(message);
    this.name = 'AIRuntimeError';
    this.code = code;
    this.statusCode = statusCode;
    this.status = statusCode;
    this.retryable = retryable;
    this.details = details;
  }
}

function signGatewayRequest(secret, body, {
  method = 'POST', path: requestPath, now = Date.now(), serviceId
} = {}) {
  const timestamp = String(now);
  const nonce = crypto.randomBytes(24).toString('base64url');
  const canonical = serviceId
    ? `${timestamp}\n${nonce}\n${serviceId}\n${method.toUpperCase()}\n${requestPath}\n${body}`
    : `${timestamp}\n${nonce}\n${method.toUpperCase()}\n${requestPath}\n${body}`;
  const signature = crypto.createHmac('sha256', String(secret || ''))
    .update(canonical)
    .digest('base64url');
  return { timestamp, nonce, signature, ...(serviceId ? { serviceId, signatureVersion: '2' } : {}) };
}

function deriveLocalServiceSecret(masterSecret, serviceId = LOCAL_LLM_SERVICE_ID) {
  return crypto.createHmac('sha256', String(masterSecret || '').trim())
    .update(`${LOCAL_LLM_SERVICE_KEY_CONTEXT}:${serviceId}`)
    .digest('base64url');
}

function stableHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function completionInputFingerprint(input = {}, route = {}) {
  // Hash only deterministic inference inputs. Timeouts, request IDs and other
  // transport metadata are deliberately excluded. The digest distinguishes
  // two logical prompts in one request/activity while an exact retry keeps the
  // same receipt and gateway execution ID. No prompt text is persisted.
  return stableHash(canonicalJson({
    messages: input.messages || [],
    tools: input.tools || null,
    toolChoice: input.toolChoice ?? input.tool_choice ?? null,
    jsonSchema: input.jsonSchema || input.response_format?.json_schema?.schema || null,
    schemaName: input.schemaName || input.response_format?.json_schema?.name || null,
    temperature: input.temperature ?? null,
    topP: input.topP ?? input.top_p ?? null,
    frequencyPenalty: input.frequencyPenalty ?? input.frequency_penalty ?? null,
    presencePenalty: input.presencePenalty ?? input.presence_penalty ?? null,
    maxTokens: input.maxTokens ?? input.max_tokens ?? input.max_completion_tokens ?? null,
    promptVersion: input.promptVersion || null,
    schemaStrict: input.schemaStrict === true,
    model: route.codexModel || route.model || null,
    reasoningEffort: route.reasoningEffort || null
  }));
}

function withUsageExecutionContext(context = {}, { input = {}, route = {} } = {}) {
  const baseIdentity = context.usageExecutionId || [
    context.requestId || crypto.randomUUID(), context.sourceApp || 'recruiter',
    context.actorId || '', context.jobId || '', context.candidateId || '',
    context.interviewId || context.interviewSessionId || ''
  ].join(':');
  const identity = [
    baseIdentity,
    // Explicit operation keys remain the strongest caller-provided logical
    // boundary. The input fingerprint protects legacy multi-stage flows that
    // reuse request/activity/provider without supplying one.
    context.operationKey || '',
    context.structuredCompletionOrdinal || 1,
    completionInputFingerprint(input, route)
  ].join(':');
  return { ...context, usageExecutionId: stableHash(identity) };
}

function deriveRuntimeUsageEventId({ context = {}, route = {} } = {}) {
  return `usage_${stableHash(`${context.usageExecutionId}:${route.activity}:${route.provider}`).slice(0, 48)}`;
}

function deriveGatewayExecutionId(eventId, provider) {
  const prefix = provider === CHATGPT_PROVIDER ? 'chatgptexec' : 'localexec';
  return `${prefix}_${stableHash(eventId).slice(0, 48)}`;
}

function requiredCapabilitiesForActivity(activity) {
  return STRUCTURED_ACTIVITIES.has(activity) ? ['text', 'json_schema'] : ['text'];
}

function activeAbortReason(signal, error) {
  if (!signal?.aborted && error?.name !== 'AbortError') return null;
  return new AIRuntimeError('The AI request was cancelled', {
    code: 'AI_REQUEST_CANCELLED', statusCode: 499, retryable: false
  });
}

function combinedSignal(timeoutMs, external) {
  const timeout = AbortSignal.timeout(Math.max(1_000, Number(timeoutMs || 240_000)));
  return external ? AbortSignal.any([timeout, external]) : timeout;
}

function gatewayConfiguration(provider) {
  const local = provider === LOCAL_PROVIDER;
  const baseUrl = String(local
    ? process.env.LOCAL_LLM_BASE_URL || ''
    : process.env.CHATGPT_GATEWAY_BASE_URL || '').replace(/\/+$/, '');
  const localServiceSecret = String(process.env.LOCAL_LLM_SERVICE_SECRET || '').trim();
  const localMasterSecret = String(process.env.LOCAL_LLM_SHARED_SECRET || '').trim();
  const secret = local
    ? (localServiceSecret || (localMasterSecret
      ? deriveLocalServiceSecret(localMasterSecret)
      : ''))
    : String(process.env.CHATGPT_GATEWAY_SHARED_SECRET || '').trim();
  if (!baseUrl || !secret) {
    throw new AIRuntimeError(`${local ? 'Local inference' : 'The ChatGPT gateway'} is not configured`, {
      code: local ? 'AI_LOCAL_NOT_CONFIGURED' : 'CHATGPT_GATEWAY_NOT_CONFIGURED', statusCode: 503, retryable: true
    });
  }
  return {
    baseUrl,
    secret,
    ...(local ? { serviceId: LOCAL_LLM_SERVICE_ID, signatureVersion: '2' } : {})
  };
}

class AIRuntimeService {
  constructor({
    fetchImpl = global.fetch,
    settingsModel = AIRuntimeSettings,
    resolveSubject,
    resolveInterviewSubject,
    resolveRuntimePreference,
    resolveUserRoute
  } = {}) {
    this.fetch = fetchImpl;
    this.Settings = settingsModel;
    this.resolveSubject = resolveSubject || ((actorId) => require('./codexAccountService').resolveRoutableSubject(actorId));
    this.resolveInterviewSubject = resolveInterviewSubject || ((sessionId) => (
      require('./interviewCodexAccountService').resolveRoutableSubject(sessionId)
    ));
    this.resolveRuntimePreference = resolveRuntimePreference || (async (actorId) => {
      if (!actorId) return 'default';
      const Account = require('../../models/AIUserRuntimeAccount');
      if (!Account.db.base.isValidObjectId(actorId)) return 'default';
      const account = await Account.findOne({ user: actorId }).lean();
      return account?.runtimePreference || 'default';
    });
    this.resolveUserRoute = resolveUserRoute || (async (actorId, activity, adminRoute) => {
      if (!actorId || isCandidateInterviewActivity(activity)) return adminRoute;
      const Account = require('../../models/AIUserRuntimeAccount');
      if (!Account.db.base.isValidObjectId(actorId)) return adminRoute;
      const account = await Account.findOne({ user: actorId }).lean();
      if (!account) return adminRoute;
      const resolved = require('./userAISettingsService')
        .resolveActivityPreference(activity, adminRoute, account).effective;
      return { ...adminRoute, ...resolved };
    });
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
    let stored = await this.Settings.findOne({ key: 'global' }).lean();
    if (!stored) {
      stored = await this.Settings.findOneAndUpdate(
        { key: 'global' }, { $setOnInsert: defaults }, { upsert: true, new: true }
      ).lean();
    }
    // One-time rollout migration. Existing ChatGPT-only documents predate the
    // selectable runtime policy and must receive the requested Local+ChatGPT
    // default once; later administrator choices are left untouched.
    if (Number(stored.runtimePolicyVersion || 0) < 1) {
      await this.Settings.updateOne(
        { key: 'global', $or: [
          { runtimePolicyVersion: { $exists: false } },
          { runtimePolicyVersion: { $lt: 1 } }
        ] },
        { $set: {
          runtimePolicy: defaults.runtimePolicy,
          runtimePolicyVersion: 1
        }, $inc: { version: 1 } }
      );
      stored = {
        ...stored,
        runtimePolicy: defaults.runtimePolicy,
        runtimePolicyVersion: 1,
        version: Number(stored.version || 0) + 1
      };
    }
    const priorRoutes = new Map((stored.routes || []).map((route) => [route.activity, route]));
    const settings = {
      ...defaults,
      ...stored,
      models: defaults.models,
      routes: defaults.routes.map((route) => {
        const prior = priorRoutes.get(route.activity) || {};
        return {
          ...route,
          enabled: prior.enabled !== false,
          codexModel: String(prior.codexModel || route.codexModel),
          reasoningEffort: String(prior.reasoningEffort || route.reasoningEffort)
        };
      }),
      quotaGroups: [],
      runtimePolicy: normalizeRuntimePolicy(stored.runtimePolicy),
      version: Math.max(2, Number(stored.version || 0))
    };
    this.settingsCache = settings;
    this.settingsCacheExpiresAt = Date.now() + SETTINGS_CACHE_MS;
    return settings;
  }

  resolveRoute(activity, settings, selectedRuntime, { bypassRuntimePolicy = false } = {}) {
    const definition = ACTIVITY_DEFINITIONS[activity];
    if (!definition) throw new AIRuntimeError(`Unknown AI activity ${activity}`, { code: 'AI_ACTIVITY_UNKNOWN', statusCode: 400 });
    const route = settings.routes.find((item) => item.activity === activity);
    if (!route || route.enabled === false || (!bypassRuntimePolicy && settings.providerEnabled === false)) {
      throw new AIRuntimeError(`AI activity ${activity} is disabled`, { code: 'AI_ACTIVITY_DISABLED', statusCode: 503 });
    }
    const policy = normalizeRuntimePolicy(settings.runtimePolicy);
    if (!bypassRuntimePolicy && !policy.localEnabled && !policy.chatgptEnabled) {
      throw new AIRuntimeError('AI is disabled by a platform administrator', {
        code: 'AI_RUNTIME_DISABLED', statusCode: 503
      });
    }
    // A trusted cross-product call owns its runtime policy. Recruiter's admin
    // local/ChatGPT switch must not silently disable Performance after
    // Performance explicitly selected the shared ChatGPT service.
    const runtime = bypassRuntimePolicy ? 'chatgpt' : (selectedRuntime || policy.defaultRuntime);
    const local = runtime === 'local';
    if (!bypassRuntimePolicy && local && !policy.localEnabled) throw new AIRuntimeError('Local inference is disabled', { code: 'AI_RUNTIME_LOCAL_DISABLED', statusCode: 503 });
    if (!bypassRuntimePolicy && !local && !policy.chatgptEnabled) throw new AIRuntimeError('ChatGPT is disabled', { code: 'AI_RUNTIME_CHATGPT_DISABLED', statusCode: 503 });
    return {
      ...route,
      activity,
      provider: local ? LOCAL_PROVIDER : CHATGPT_PROVIDER,
      model: local ? LOCAL_MODEL : CHATGPT_MODEL,
      modelConfig: settings.models.find((item) => item.provider === (local ? LOCAL_PROVIDER : CHATGPT_PROVIDER)),
      failoverPolicy: local ? 'local_required' : 'chatgpt_required'
    };
  }

  async selectRuntime(settings, context = {}) {
    const policy = normalizeRuntimePolicy(settings.runtimePolicy);
    if (policy.localEnabled && !policy.chatgptEnabled) return 'local';
    if (policy.chatgptEnabled && !policy.localEnabled) return 'chatgpt';
    if (!policy.localEnabled && !policy.chatgptEnabled) return policy.defaultRuntime;
    const preference = await this.resolveRuntimePreference(String(context.runtimeActorId || context.actorId || '').trim());
    return ['local', 'chatgpt'].includes(preference) ? preference : policy.defaultRuntime;
  }

  async attachChatGptSubject(route, context, { consentApp = 'recruiter' } = {}) {
    const interviewSessionId = String(context.interviewSessionId || '').trim();
    const runtimeActorId = String(context.runtimeActorId || context.actorId || '').trim();
    const subject = isCandidateInterviewActivity(route.activity)
      ? (interviewSessionId ? await this.resolveInterviewSubject(interviewSessionId) : null)
      : await this.resolveSubject(runtimeActorId, {
        consentApp,
        organizationId: context.localOrganizationId || context.organizationId,
        explainUnavailable: true
      });
    if (!subject) {
      throw new AIRuntimeError(
        isCandidateInterviewActivity(route.activity)
          ? 'Connect ChatGPT before starting this AI interview.'
          : 'Connect ChatGPT to use Seemplify AI features.',
        {
          code: isCandidateInterviewActivity(route.activity)
            ? 'CHATGPT_CANDIDATE_ACCOUNT_REQUIRED' : 'AI_RUNTIME_ACCOUNT_REQUIRED',
          statusCode: 409,
          retryable: false
        }
      );
    }
    return { ...route, chatgptSubjectId: subject.subjectId, runtimeOwner: 'user' };
  }

  normalizePayload(input, route) {
    return {
      messages: Array.isArray(input.messages) ? input.messages.map(({ role, content }) => ({ role, content })) : [],
      temperature: input.temperature,
      topP: input.topP ?? input.top_p,
      maxTokens: input.maxTokens ?? input.max_tokens ?? input.max_completion_tokens,
      reasoningEffort: route.reasoningEffort,
      promptVersion: input.promptVersion,
      tools: input.tools,
      toolChoice: input.toolChoice ?? input.tool_choice,
      jsonSchema: input.jsonSchema || input.response_format?.json_schema?.schema,
      schemaName: input.schemaName,
      schemaStrict: input.schemaStrict === true,
      frequencyPenalty: input.frequencyPenalty ?? input.frequency_penalty,
      presencePenalty: input.presencePenalty ?? input.presence_penalty
    };
  }

  async gatewayRequest({ route, input, context, requestId, timeoutMs, signal }) {
    const local = route.provider === LOCAL_PROVIDER;
    const { baseUrl, secret, serviceId } = gatewayConfiguration(route.provider);
    const eventId = deriveRuntimeUsageEventId({ context, route });
    const body = JSON.stringify({
      activity: route.activity,
      executionMode: 'local-only',
      ...(!local ? {
        codexSourceApp: PLATFORM_SOURCE_APP,
        codexSubjectId: route.chatgptSubjectId,
        requiredEngine: 'codex',
        codexModelCandidates: [
          ...(route.codexModel ? [{ value: route.codexModel, source: 'activity' }] : []),
          { value: 'gpt-5.6-sol', source: 'application_default' }
        ],
        codexEffortCandidates: [{ value: route.reasoningEffort || 'medium', source: 'activity' }]
      } : {}),
      ...this.normalizePayload(input, route),
      requestSource: String(context.sourceApp || 'recruiter').slice(0, 64),
      timeoutMs,
      metering: {
        record: true,
        eventId,
        requestId,
        gatewayExecutionId: deriveGatewayExecutionId(eventId, route.provider),
        // Credential ownership stays Recruiter (`codexSourceApp` above), but
        // usage attribution follows the authenticated product and active org.
        sourceApp: meteringSourceApp(context.sourceApp),
        actorId: meteringDimension(context.actorId),
        organizationId: meteringDimension(context.organizationId, 120),
        organizationName: meteringDimension(context.organizationName, 200)
      }
    });
    const endpoint = ['candidate.cv_parse', 'ai_interview.cv_parse'].includes(route.activity)
      ? '/v1/cv/analyze' : '/v1/complete';
    const signed = signGatewayRequest(secret, body, { path: endpoint, serviceId });
    let response;
    try {
      response = await this.fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-seemplify-timestamp': signed.timestamp,
          'x-seemplify-nonce': signed.nonce,
          'x-seemplify-signature': signed.signature,
          ...(signed.serviceId ? {
            'x-seemplify-service': signed.serviceId,
            'x-seemplify-signature-version': signed.signatureVersion
          } : {})
        },
        body,
        signal: combinedSignal(timeoutMs, signal)
      });
    } catch (error) {
      const aborted = activeAbortReason(signal, error);
      if (aborted) throw aborted;
      throw new AIRuntimeError(`${local ? 'Local inference' : 'The ChatGPT gateway'} could not be reached: ${sanitizeMessage(error.message)}`, {
        code: local ? 'AI_LOCAL_UNAVAILABLE' : 'CHATGPT_GATEWAY_UNAVAILABLE', statusCode: 503, retryable: true
      });
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new AIRuntimeError(data.message || `${local ? 'Local inference' : 'ChatGPT'} could not complete the request`, {
        code: data.code || (local ? 'AI_LOCAL_REQUEST_FAILED' : 'CHATGPT_REQUEST_FAILED'),
        statusCode: response.status >= 500 ? 503 : response.status,
        retryable: data.retryable === true,
        details: data
      });
    }
    return data;
  }

  async complete(activity, input = {}, options = {}) {
    const aborted = activeAbortReason(options.signal);
    if (aborted) throw aborted;
    const settings = await this.getSettings();
    const baseContext = getAIRequestContext({ ...(input.context || {}), ...(options.context || {}) });
    const requestId = String(baseContext.requestId || crypto.randomUUID());
    const requiredRuntime = ['local', 'chatgpt'].includes(options.requiredRuntime)
      ? options.requiredRuntime : null;
    // Candidate interview screens explicitly require the candidate's own
    // connected ChatGPT account. Never let the workspace's Local default
    // silently process their answers after presenting that contract.
    const selectedRuntime = isCandidateInterviewActivity(activity)
      ? 'chatgpt'
      : (requiredRuntime || await this.selectRuntime(settings, baseContext));
    let route = this.resolveRoute(activity, settings, selectedRuntime, {
      bypassRuntimePolicy: options.sharedAccountRuntime === true
    });
    const runtimeActorId = String(baseContext.runtimeActorId || baseContext.actorId || '').trim();
    if (route.provider === CHATGPT_PROVIDER) {
      route = await this.resolveUserRoute(runtimeActorId, activity, route);
    }
    if (route.provider === CHATGPT_PROVIDER) {
      route = await this.attachChatGptSubject(route, baseContext, { consentApp: options.consentApp });
    }
    const context = withUsageExecutionContext(baseContext, { input, route });
    const data = await this.gatewayRequest({
      route, input, context, requestId,
      timeoutMs: Number(options.timeoutMs || input.timeoutMs || 240_000),
      signal: options.signal
    });
    const usage = normalizeUsage(data.usage || {});
    const raw = {
      id: data.id,
      provider: route.provider,
      model: data.model,
      choices: [{
        message: { content: data.content, ...(data.toolCalls?.length ? { tool_calls: data.toolCalls } : {}) },
        finish_reason: data.finishReason || (data.toolCalls?.length ? 'tool_calls' : 'stop')
      }],
      usage: data.usage || {},
      gatewayExecutionId: data.gatewayExecutionId,
      modelSource: data.modelSource,
      reasoningEffort: data.reasoningEffort,
      reasoningEffortSource: data.reasoningEffortSource,
      degraded: data.degraded,
      planType: data.planType
    };
    return {
      requestId,
      content: String(data.content || '').trim(),
      toolCalls: data.toolCalls || [],
      finishReason: raw.choices[0].finish_reason,
      model: data.model || CHATGPT_MODEL,
      modelSource: data.modelSource || null,
      reasoningEffort: data.reasoningEffort || route.reasoningEffort || null,
      reasoningEffortSource: data.reasoningEffortSource || null,
      degraded: data.degraded === true,
      planType: data.planType || null,
      provider: route.provider,
      providerLabel: data.providerLabel || (route.provider === LOCAL_PROVIDER ? 'Local inference' : 'ChatGPT Connect'),
      engine: data.engine || (route.provider === LOCAL_PROVIDER ? 'control-center-selected' : 'codex-app-server'),
      usage,
      raw
    };
  }

  async structuredComplete(activity, input = {}, options = {}) {
    const schema = input.jsonSchema;
    if (!schema || typeof schema !== 'object' || schema.type !== 'object') {
      throw new AIRuntimeError('A root object JSON Schema is required', { code: 'AI_SCHEMA_INVALID', statusCode: 400 });
    }
    const baseMessages = Array.isArray(input.messages) ? input.messages : [];
    const stableContext = withUsageExecutionContext(getAIRequestContext({ ...(input.context || {}), ...(options.context || {}) }));
    let messages = baseMessages;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await options.beforeAttempt?.({ attempt: attempt + 1, activity });
      const result = await this.complete(activity, {
        ...input,
        max_tokens: attempt > 0 && Number(input.retryMaxTokens) > 0
          ? Number(input.retryMaxTokens)
          : (input.maxTokens ?? input.max_tokens ?? input.max_completion_tokens),
        messages,
        context: { ...stableContext, structuredCompletionOrdinal: attempt + 1 },
        response_format: { type: 'json_schema', json_schema: { name: input.schemaName || 'response', strict: true, schema } }
      }, { ...options, context: { ...stableContext, structuredCompletionOrdinal: attempt + 1 } });
      let parsed;
      try { parsed = JSON.parse(result.content); } catch { parsed = null; }
      const validation = parsed === null
        ? { valid: false, errors: ['$: response is not valid JSON'] }
        : validateJsonSchema(parsed, schema);
      if (validation.valid) return { ...result, data: parsed, schemaRepairAttempted: attempt > 0 };
      const compactLimit = Math.max(500, Number(input.compactMaxChars || 12_000));
      const repairContent = String(result.content || '').slice(0, compactLimit);
      messages = [...baseMessages, { role: 'assistant', content: repairContent }, {
        role: 'user',
        content: `Correct the JSON to match the schema. Validation issues: ${validation.errors.slice(0, 12).join('; ')}`
      }];
    }
    throw new AIRuntimeError('The selected AI runtime did not satisfy the required schema after one repair attempt', {
      code: 'AI_SCHEMA_VALIDATION_FAILED', statusCode: 503, retryable: true
    });
  }

  async getExecutionRoute(activity) {
    return this.resolveRoute(activity, await this.getSettings());
  }

  async getGatewayStatus() {
    const check = async (provider) => {
      try {
        const { baseUrl } = gatewayConfiguration(provider);
        const response = await this.fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(8_000) });
        return { configured: true, reachable: response.ok, ...(await response.json().catch(() => ({}))) };
      } catch (error) {
        return { configured: false, reachable: false, error: sanitizeMessage(error.message) };
      }
    };
    const [local, chatgpt] = await Promise.all([check(LOCAL_PROVIDER), check(CHATGPT_PROVIDER)]);
    return { local, chatgpt };
  }

  requiredCapabilitiesForActivity(activity) { return requiredCapabilitiesForActivity(activity); }

  createLangChainFetch(defaultActivity = 'assistant.chat') {
    return async (_url, init = {}) => {
      try {
        const body = JSON.parse(String(init.body || '{}'));
        const result = body.response_format?.json_schema?.schema
          ? await this.structuredComplete(defaultActivity, { ...body, jsonSchema: body.response_format.json_schema.schema })
          : await this.complete(defaultActivity, body);
        return new Response(JSON.stringify(result.raw), {
          status: 200, headers: { 'content-type': 'application/json', 'x-request-id': result.requestId }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: { code: error.code, message: error.message } }), {
          status: error.statusCode || 503, headers: { 'content-type': 'application/json' }
        });
      }
    };
  }
}

const aiRuntimeService = new AIRuntimeService();

module.exports = aiRuntimeService;
module.exports.AIRuntimeError = AIRuntimeError;
module.exports.AIRuntimeService = AIRuntimeService;
module.exports.deriveGatewayExecutionId = deriveGatewayExecutionId;
module.exports.deriveRuntimeUsageEventId = deriveRuntimeUsageEventId;
module.exports.requiredCapabilitiesForActivity = requiredCapabilitiesForActivity;
module.exports.signGatewayRequest = signGatewayRequest;
