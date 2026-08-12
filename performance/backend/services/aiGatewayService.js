'use strict';

const crypto = require('node:crypto');

const LOCAL = 'local';
const CHATGPT = 'chatgpt';

class PerformanceAIRuntimeError extends Error {
  constructor(message, code, statusCode = 503, details = {}) {
    super(message);
    this.name = 'PerformanceAIRuntimeError';
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = details.retryable === true;
    this.retryAfterSeconds = Number.isFinite(Number(details.retryAfterSeconds))
      ? Number(details.retryAfterSeconds) : undefined;
    this.cause = details.cause;
  }
}

function isPerformanceAIRuntimeError(error) {
  return error instanceof PerformanceAIRuntimeError
    || (error?.name === 'PerformanceAIRuntimeError' && typeof error?.code === 'string');
}

function sendPerformanceAIError(res, error, fallbackMessage = 'The AI request could not be completed.') {
  const runtimeError = isPerformanceAIRuntimeError(error);
  const body = {
    success: false,
    error: runtimeError ? error.message : fallbackMessage,
    code: runtimeError ? error.code : 'AI_REQUEST_FAILED'
  };
  if (runtimeError && error.retryable === true) body.retryable = true;
  if (runtimeError && error.retryAfterSeconds !== undefined) {
    body.retryAfterSeconds = error.retryAfterSeconds;
  }
  return res.status(runtimeError ? Number(error.statusCode) || 503 : 500).json(body);
}

function enabled(name, fallback) {
  const value = process.env[name];
  return value == null ? fallback : !['false', '0', 'off', 'no'].includes(String(value).toLowerCase());
}

function environmentPolicy() {
  const localEnabled = enabled('PERFORMANCE_AI_LOCAL_ENABLED', true);
  const chatgptEnabled = enabled('PERFORMANCE_AI_CHATGPT_ENABLED', true);
  const requested = process.env.PERFORMANCE_AI_DEFAULT_RUNTIME === CHATGPT ? CHATGPT : LOCAL;
  const defaultRuntime = requested === LOCAL && !localEnabled && chatgptEnabled ? CHATGPT
    : requested === CHATGPT && !chatgptEnabled && localEnabled ? LOCAL : requested;
  return { localEnabled, chatgptEnabled, defaultRuntime };
}

let policyCache = null;
let policyCacheUntil = 0;

async function runtimePolicy({ force = false } = {}) {
  if (!force && policyCache && policyCacheUntil > Date.now()) return policyCache;
  const fallback = environmentPolicy();
  try {
    const Settings = require('../models/AIRuntimeSettings');
    const saved = Settings.db.readyState === 1
      ? await Settings.findOne({ key: 'global' }).lean()
      : null;
    policyCache = saved ? {
      localEnabled: saved.localEnabled !== false,
      chatgptEnabled: saved.chatgptEnabled === true,
      defaultRuntime: saved.defaultRuntime === CHATGPT ? CHATGPT : LOCAL
    } : fallback;
  } catch {
    policyCache = fallback;
  }
  if (policyCache.defaultRuntime === LOCAL && !policyCache.localEnabled && policyCache.chatgptEnabled) policyCache.defaultRuntime = CHATGPT;
  if (policyCache.defaultRuntime === CHATGPT && !policyCache.chatgptEnabled && policyCache.localEnabled) policyCache.defaultRuntime = LOCAL;
  policyCacheUntil = Date.now() + 15000;
  return policyCache;
}

async function selectRuntime(preference = 'default') {
  const policy = await runtimePolicy();
  if (policy.localEnabled && !policy.chatgptEnabled) return LOCAL;
  if (policy.chatgptEnabled && !policy.localEnabled) return CHATGPT;
  if (!policy.localEnabled && !policy.chatgptEnabled) {
    throw new PerformanceAIRuntimeError('Performance Management AI is disabled.', 'AI_RUNTIME_DISABLED');
  }
  return [LOCAL, CHATGPT].includes(preference) ? preference : policy.defaultRuntime;
}

function gatewayConfiguration(runtime) {
  if (runtime !== LOCAL) {
    throw new PerformanceAIRuntimeError(
      'Connected ChatGPT must use the central Seemplify account service.',
      'SHARED_AI_ROUTE_REQUIRED'
    );
  }
  const baseUrl = String(process.env.LOCAL_LLM_BASE_URL || '').replace(/\/+$/, '');
  const secret = String(process.env.LOCAL_LLM_SHARED_SECRET || '').trim();
  if (!baseUrl || !secret) {
    throw new PerformanceAIRuntimeError(
      'Local inference is not configured for Performance Management.',
      'AI_LOCAL_NOT_CONFIGURED'
    );
  }
  return { baseUrl, secret };
}

function sign(secret, body, requestPath) {
  const timestamp = String(Date.now());
  const nonce = crypto.randomBytes(24).toString('base64url');
  const signature = crypto.createHmac('sha256', secret)
    .update(`${timestamp}\n${nonce}\nPOST\n${requestPath}\n${body}`)
    .digest('base64url');
  return { timestamp, nonce, signature };
}

function completionResponse(payload, runtime) {
  return {
    id: payload.id || `perf_${crypto.randomUUID()}`,
    model: payload.model || (runtime === LOCAL ? 'control-center-selected-model' : 'chatgpt-connected-account'),
    provider: runtime,
    choices: [{
      message: { content: String(payload.content || ''), ...(payload.toolCalls?.length ? { tool_calls: payload.toolCalls } : {}) },
      finish_reason: payload.finishReason || (payload.toolCalls?.length ? 'tool_calls' : 'stop')
    }],
    usage: payload.usage || {}
  };
}

class AIGatewayService {
  constructor({ fetchImpl = global.fetch } = {}) {
    this.fetch = fetchImpl;
  }

  async getChatCompletions(messages, options = {}) {
    const context = require('./aiRequestContext').getAIRequestContext();
    const runtime = await selectRuntime(options.runtimePreference || context.runtimePreference || process.env.PERFORMANCE_AI_RUNTIME_PREFERENCE || 'default');
    const requestPath = '/v1/complete';
    const requestId = String(options.requestId || context.requestId || crypto.randomUUID());
    const activity = String(options.activity || 'performance.general');
    const local = runtime === LOCAL;
    if (!local) {
      const identity = options.identity || context.identity;
      if (!identity?.sub || !identity?.email) {
        throw new PerformanceAIRuntimeError(
          'A signed-in Seemplify identity is required for connected ChatGPT.',
          'SHARED_AI_IDENTITY_REQUIRED', 401
        );
      }
      try {
        const payload = await require('./sharedAIAccountService').complete(identity, {
          activity,
          messages: Array.isArray(messages) ? messages.map(({ role, content }) => ({ role, content })) : [],
          promptVersion: String(options.promptVersion || '1'),
          maxTokens: options.maxTokens || options.max_tokens,
          jsonSchema: options.jsonSchema || options.response_format?.json_schema?.schema,
          codexModel: options.codexModel || process.env.PERFORMANCE_CHATGPT_MODEL || 'gpt-5.6-sol',
          reasoningEffort: options.reasoningEffort || 'medium',
          context: { requestId, sourceApp: 'performance-management' }
        }, { timeoutMs: options.timeoutMs || 240_000 });
        return completionResponse(payload, runtime);
      } catch (error) {
        throw new PerformanceAIRuntimeError(
          error.message || 'The shared ChatGPT request failed.',
          error.code || 'SHARED_AI_REQUEST_FAILED',
          error.statusCode || 503,
          { retryable: error.retryable, retryAfterSeconds: error.retryAfterSeconds, cause: error }
        );
      }
    }
    const { baseUrl, secret } = gatewayConfiguration(runtime);
    const eventId = `usage_${crypto.createHash('sha256').update(`${requestId}:${activity}:${runtime}`).digest('hex').slice(0, 48)}`;
    const gatewayExecutionPrefix = 'localexec';
    const body = JSON.stringify({
      activity,
      executionMode: 'local-only',
      messages: Array.isArray(messages) ? messages.map(({ role, content }) => ({ role, content })) : [],
      temperature: options.temperature,
      maxTokens: options.maxTokens || options.max_tokens,
      jsonSchema: options.jsonSchema || options.response_format?.json_schema?.schema,
      requestSource: 'performance-management',
      timeoutMs: Number(options.timeoutMs || 240000),
      metering: {
        record: true,
        eventId,
        gatewayExecutionId: `${gatewayExecutionPrefix}_${crypto.createHash('sha256').update(eventId).digest('hex').slice(0, 48)}`,
        requestId,
        sourceApp: 'performance-management'
      }
    });
    const signed = sign(secret, body, requestPath);
    let response;
    try {
      response = await this.fetch(`${baseUrl}${requestPath}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-seemplify-timestamp': signed.timestamp,
          'x-seemplify-nonce': signed.nonce,
          'x-seemplify-signature': signed.signature
        },
        body,
        signal: AbortSignal.timeout(Math.max(1000, Number(options.timeoutMs || 240000)))
      });
    } catch (error) {
      throw new PerformanceAIRuntimeError(`The ${local ? 'local' : 'ChatGPT'} AI gateway could not be reached: ${error.message}`, 'AI_GATEWAY_UNAVAILABLE');
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new PerformanceAIRuntimeError(payload.message || 'The AI request failed.', payload.code || 'AI_REQUEST_FAILED', response.status);
    }
    return completionResponse(payload, runtime);
  }

  openAICompatibleClient(defaultActivity = 'performance.general') {
    return {
      chat: {
        completions: {
          create: (input = {}) => this.getChatCompletions(input.messages, {
            ...input,
            activity: input.activity || defaultActivity,
            maxTokens: input.max_tokens
          })
        }
      }
    };
  }

  policy(options) { return runtimePolicy(options); }
  invalidatePolicyCache() { policyCache = null; policyCacheUntil = 0; }
  sendPerformanceAIError(res, error, fallbackMessage) {
    return sendPerformanceAIError(res, error, fallbackMessage);
  }
}

const aiGatewayService = new AIGatewayService();

module.exports = aiGatewayService;
module.exports.AIGatewayService = AIGatewayService;
module.exports.PerformanceAIRuntimeError = PerformanceAIRuntimeError;
module.exports.isPerformanceAIRuntimeError = isPerformanceAIRuntimeError;
module.exports.sendPerformanceAIError = sendPerformanceAIError;
module.exports.runtimePolicy = runtimePolicy;
module.exports.selectRuntime = selectRuntime;
