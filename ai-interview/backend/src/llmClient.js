const crypto = require('crypto');

const COMPLETE_PATH = '/api/internal/ai/v1/complete';
const DEFAULT_GATEWAY_TIMEOUT_MS = 30_000;

function extractJsonObject(content) {
  const text = String(content || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        return null;
      }
    }
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last > first) {
      try {
        return JSON.parse(text.slice(first, last + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function resolveGatewayUrl(env) {
  const configured = String(
    env.SEEMPLIFY_AI_GATEWAY_URL
      || env.SEEMPLIFY_PLATFORM_API_URL
      || 'https://api.seemplifyai.com'
  ).trim().replace(/\/$/, '');
  if (configured.endsWith(COMPLETE_PATH)) return configured;
  return `${configured}${COMPLETE_PATH}`;
}

function buildSignature({ timestamp, serviceId, path, body, secret }) {
  const canonical = [timestamp, serviceId, 'POST', path, body].join('\n');
  return crypto.createHmac('sha256', secret).update(canonical).digest('hex');
}

function createAIPlatformClient({ env = process.env, fetchImpl = global.fetch, now = () => Date.now() } = {}) {
  return {
    async chatCompletion(messages, options = {}) {
      const secret = String(env.AI_GATEWAY_HMAC_SECRET || '');
      if (!secret) {
        const error = new Error('AI_GATEWAY_HMAC_SECRET is required for AI Interview model calls.');
        error.code = 'LLM_NOT_CONFIGURED';
        error.statusCode = 503;
        throw error;
      }
      if (typeof fetchImpl !== 'function') {
        const error = new Error('No fetch implementation is available for the Seemplify AI gateway.');
        error.code = 'LLM_NOT_CONFIGURED';
        error.statusCode = 503;
        throw error;
      }

      const url = resolveGatewayUrl(env);
      const path = new URL(url).pathname;
      const serviceId = String(env.AI_GATEWAY_SERVICE_ID || 'ai-interview');
      const timestamp = String(now());
      const requestBody = {
        activity: options.activity || 'ai_interview.chat.clarification',
        promptVersion: options.promptVersion || '1',
        messages,
        temperature: options.temperature ?? 0.35,
        topP: options.topP ?? 1,
        maxTokens: options.maxTokens ?? 500,
        context: options.context || {}
      };
      if (options.response_format) requestBody.responseFormat = options.response_format;
      if (options.jsonSchema) requestBody.jsonSchema = options.jsonSchema;
      if (options.schemaName) requestBody.schemaName = options.schemaName;

      const body = JSON.stringify(requestBody);
      const signature = buildSignature({ timestamp, serviceId, path, body, secret });
      const requestedTimeout = Number(options.timeoutMs || env.AI_GATEWAY_TIMEOUT_MS || DEFAULT_GATEWAY_TIMEOUT_MS);
      const timeoutMs = Math.min(120_000, Math.max(1_000, Number.isFinite(requestedTimeout)
        ? requestedTimeout
        : DEFAULT_GATEWAY_TIMEOUT_MS));
      let response;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-seemplify-service': serviceId,
            'x-seemplify-timestamp': timestamp,
            'x-seemplify-signature': signature,
            ...(options.context?.requestId ? { 'x-request-id': String(options.context.requestId) } : {})
          },
          body,
          signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined
        });
      } catch (cause) {
        const error = new Error('Seemplify AI gateway could not be reached before the request deadline.');
        error.code = 'LLM_REQUEST_FAILED';
        error.statusCode = 503;
        error.cause = cause;
        throw error;
      }

      const text = await response.text();
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = null;
      }

      if (!response.ok) {
        const error = new Error(payload?.message || text || `Seemplify AI gateway request failed with ${response.status}`);
        error.code = payload?.code || 'LLM_REQUEST_FAILED';
        error.statusCode = response.status;
        throw error;
      }

      const content = String(payload?.content || '').trim();
      if (!content) {
        const error = new Error('Seemplify AI gateway returned an empty completion.');
        error.code = 'LLM_EMPTY_RESPONSE';
        error.statusCode = 503;
        throw error;
      }

      return {
        content,
        model: payload.model,
        requestId: payload.requestId,
        usage: payload.usage || {},
        raw: payload
      };
    }
  };
}

const defaultClient = createAIPlatformClient();

module.exports = {
  buildSignature,
  chatCompletion: (...args) => defaultClient.chatCompletion(...args),
  createAIPlatformClient,
  extractJsonObject,
  resolveGatewayUrl
};
