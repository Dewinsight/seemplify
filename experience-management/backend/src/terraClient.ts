import crypto from 'node:crypto';
import fs from 'node:fs';
import { config } from './config.js';

const RUNTIME_PROFILE = 'experience-management';

export class TerraError extends Error {
  code: string;
  status: number;
  retryable: boolean;

  constructor(message: string, code = 'TERRA_ERROR', status = 500, retryable = false) {
    super(message);
    this.name = 'TerraError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function readSecret() {
  try {
    const value = fs.readFileSync(config.terraGatewaySecretFile, 'utf8').trim();
    if (!value) throw new Error('empty');
    return value;
  } catch {
    throw new TerraError('The shared Terra service secret is not configured.', 'TERRA_NOT_CONFIGURED', 503, true);
  }
}

function usageIdentity(requestId: string, executionRevision = 0) {
  const revision = Number.isSafeInteger(executionRevision) && executionRevision > 0 ? executionRevision : 0;
  const executionKey = revision ? `${requestId}:execution:${revision}` : requestId;
  const eventId = `usage_${crypto.createHash('sha256').update(`experience:${executionKey}`).digest('hex').slice(0, 48)}`;
  const gatewayExecutionId = `localexec_${crypto.createHash('sha256').update(eventId).digest('hex').slice(0, 48)}`;
  return { eventId, gatewayExecutionId };
}

function signedHeaders(secret: string, body: string, requestPath: string) {
  const timestamp = String(Date.now());
  const nonce = crypto.randomBytes(24).toString('base64url');
  const signature = crypto.createHmac('sha256', secret)
    .update(`${timestamp}\n${nonce}\nPOST\n${requestPath}\n${body}`)
    .digest('base64url');
  return {
    'content-type': 'application/json',
    'x-seemplify-timestamp': timestamp,
    'x-seemplify-nonce': nonce,
    'x-seemplify-signature': signature
  };
}

export interface TerraCompletionInput {
  activity: string;
  requestId: string;
  executionRevision?: number;
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  jsonSchema?: Record<string, unknown>;
  schemaName?: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export async function completeWithTerra(input: TerraCompletionInput) {
  const secret = readSecret();
  const requestPath = '/v1/complete';
  const identity = usageIdentity(input.requestId, input.executionRevision);
  const body = JSON.stringify({
    activity: input.activity,
    executionMode: 'local-only',
    runtimeProfile: RUNTIME_PROFILE,
    messages: input.messages,
    jsonSchema: input.jsonSchema,
    schemaName: input.schemaName,
    reasoningEffort: input.reasoningEffort || 'medium',
    maxTokens: input.maxTokens || 5000,
    temperature: input.temperature ?? 0.15,
    timeoutMs: input.timeoutMs || 240_000,
    requestSource: 'experience-management',
    metering: {
      record: true,
      ...identity,
      requestId: input.requestId,
      sourceApp: 'experience-management'
    }
  });
  let response: globalThis.Response;
  try {
    response = await fetch(`${config.terraGatewayBaseUrl}${requestPath}`, {
      method: 'POST',
      headers: signedHeaders(secret, body, requestPath),
      body,
      signal: AbortSignal.timeout(input.timeoutMs || 250_000)
    });
  } catch (error) {
    throw new TerraError(`Terra is unreachable: ${error instanceof Error ? error.message : String(error)}`, 'TERRA_UNAVAILABLE', 503, true);
  }
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok) {
    const gatewayCode = typeof payload.code === 'string' && payload.code.trim()
      ? payload.code.trim()
      : 'TERRA_REQUEST_FAILED';
    const gatewayMessage = typeof payload.message === 'string' && payload.message.trim()
      ? payload.message.trim()
      : typeof payload.error === 'string' && payload.error.trim()
        ? payload.error.trim()
        : `${gatewayCode} (HTTP ${response.status})`;
    throw new TerraError(
      `Terra rejected ${input.activity}: ${gatewayMessage}`,
      gatewayCode,
      response.status,
      payload.retryable !== false && response.status >= 429
    );
  }
  if (String(payload.runtimeProfile || '').trim().toLowerCase() !== RUNTIME_PROFILE) {
    throw new TerraError(
      'The shared AI gateway did not honor the Experience Management runtime profile.',
      'EXPERIENCE_PROFILE_MISMATCH',
      503,
      true
    );
  }
  return {
    data: payload.data,
    content: String(payload.content || ''),
    runtime: {
      id: payload.id, provider: payload.provider, providerLabel: payload.providerLabel,
      engine: payload.engine, model: payload.model, usage: payload.usage,
      latencyMs: payload.metrics?.latencyMs, queueWaitMs: payload.metrics?.queueWaitMs
    }
  };
}

export async function getTerraStatus() {
  try {
    const secret = readSecret();
    const requestPath = '/v1/status';
    const body = JSON.stringify({ operation: 'status', source: RUNTIME_PROFILE, runtimeProfile: RUNTIME_PROFILE });
    const response = await fetch(`${config.terraGatewayBaseUrl}${requestPath}`, {
      method: 'POST', headers: signedHeaders(secret, body, requestPath), body, signal: AbortSignal.timeout(8000)
    });
    const payload = await response.json().catch(() => ({})) as any;
    const ready = response.ok
      && String(payload.runtimeProfile || '').trim().toLowerCase() === RUNTIME_PROFILE
      && payload.health?.ok === true;
    return {
      ...payload,
      reachable: response.ok,
      ready,
      runtimeProfile: RUNTIME_PROFILE
    };
  } catch (error) {
    return {
      reachable: false,
      ready: false,
      runtimeProfile: RUNTIME_PROFILE,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
