import crypto from 'node:crypto';
import { config } from './config.js';
import { db } from './database.js';
import type { CodexAccountStatus, CodexModel } from './codexAppServer.js';

const serviceId = 'experience-management';
const internalPath = '/api/internal/ai/v1';

type GatewayIdentity = {
  sub: string;
  email: string;
  displayName: string;
  organizationId?: string;
  organizationName?: string;
};

function decodeIdpSubject(passwordHash: unknown) {
  const marker = 'oidc$';
  const value = String(passwordHash || '');
  if (!value.startsWith(marker)) return null;
  try {
    const subject = Buffer.from(value.slice(marker.length), 'base64url').toString('utf8').trim();
    return subject || null;
  } catch { return null; }
}

function decodeIdpOrganizationId(slug: unknown) {
  const value = String(slug || '');
  if (!value.startsWith('idp-')) return null;
  try {
    const organizationId = Buffer.from(value.slice(4), 'base64url').toString('utf8').trim();
    return organizationId || null;
  } catch { return null; }
}

function identityForUser(userId: string): GatewayIdentity {
  const user = db.prepare('SELECT id,email,name,password_hash,active_space_id FROM users WHERE id=?').get(userId) as {
    email?: string; name?: string; password_hash?: string; active_space_id?: string | null;
  } | undefined;
  const sub = decodeIdpSubject(user?.password_hash);
  if (!user || !sub) throw new Error('Sign in with Seemplify Identity before using the shared ChatGPT gateway.');
  const space = user.active_space_id
    ? db.prepare('SELECT id,name,slug FROM spaces WHERE id=?').get(user.active_space_id) as {
      id: string; name: string; slug: string;
    } | undefined
    : undefined;
  const organizationId = decodeIdpOrganizationId(space?.slug);
  return {
    sub,
    email: String(user.email || '').trim().toLowerCase(),
    displayName: String(user.name || '').trim(),
    ...(organizationId ? { organizationId } : {}),
    ...(space?.name ? { organizationName: String(space.name) } : {})
  };
}

function signedHeaders(pathname: string, body: string) {
  if (config.sharedAiSecret.length < 32) throw new Error('The Experience shared AI gateway secret is not configured.');
  const timestamp = String(Date.now());
  const nonce = crypto.randomBytes(24).toString('base64url');
  const canonical = `${timestamp}\n${nonce}\n${serviceId}\nPOST\n${pathname}\n${body}`;
  return {
    'content-type': 'application/json',
    'x-seemplify-service': serviceId,
    'x-seemplify-signature-version': '2',
    'x-seemplify-timestamp': timestamp,
    'x-seemplify-nonce': nonce,
    'x-seemplify-signature': crypto.createHmac('sha256', config.sharedAiSecret).update(canonical).digest('hex')
  };
}

function accountStatus(value: any): CodexAccountStatus {
  const account = value?.account || value || {};
  return {
    connected: account.status === 'connected',
    email: typeof account.connectedEmail === 'string' ? account.connectedEmail : null,
    planType: typeof account.planType === 'string' ? account.planType : null,
    authMode: account.status === 'connected' ? 'chatgpt' : null,
    pendingLogin: account.status === 'pending',
    loginError: account.lastError || null
  };
}

export class SharedAiGatewayClient {
  constructor(readonly userId: string) {}

  private async request(operation: string, payload: Record<string, unknown> = {}, timeoutMs = 30_000) {
    const pathname = `${internalPath}/${operation.replace(/^\/+/, '')}`;
    const body = JSON.stringify({ ...payload, identity: identityForUser(this.userId) });
    const response = await fetch(`${config.sharedAiBaseUrl}${pathname}`, {
      method: 'POST', headers: signedHeaders(pathname, body), body,
      signal: AbortSignal.timeout(Math.max(1_000, timeoutMs))
    });
    const result = await response.json().catch(() => ({})) as Record<string, any>;
    if (!response.ok) {
      const error = new Error(String(result.message || result.error || 'The shared ChatGPT gateway request failed.')) as Error & {
        code?: string; statusCode?: number; retryable?: boolean;
      };
      error.code = String(result.code || 'SHARED_AI_REQUEST_FAILED');
      error.statusCode = response.status;
      error.retryable = result.retryable === true;
      throw error;
    }
    return result;
  }

  async accountStatus() { return accountStatus(await this.request('account/status')); }

  async startDeviceLogin() {
    const result = await this.request('account/login/start');
    if (result.account?.status === 'connected') return { connected: true as const };
    const login = result.login || {};
    if (!login.loginId || !login.verificationUrl || !login.userCode) {
      throw new Error('The shared ChatGPT gateway did not return a valid device sign-in request.');
    }
    return {
      connected: false as const,
      loginId: String(login.loginId),
      verificationUrl: String(login.verificationUrl),
      userCode: String(login.userCode)
    };
  }

  async cancelDeviceLogin() {
    const result = await this.request('account/login/cancel');
    return { cancelled: result.cancelled !== false };
  }

  async logout() { await this.request('account/disconnect'); }

  async setConsent(acknowledged: boolean) {
    await this.request('account/consent', { acknowledged: acknowledged === true });
  }

  async models(): Promise<CodexModel[]> {
    const result = await this.request('account/models');
    return Array.isArray(result.models) ? result.models : [];
  }

  async complete(input: {
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
    jsonSchema?: Record<string, unknown>;
    model: string;
    reasoningEffort: string;
    action?: string;
    requestId?: string;
    timeoutMs: number;
  }) {
    const activity = `experience.${String(input.action || 'general').replace(/^experience\./, '')}`;
    const result = await this.request('complete', {
      activity,
      messages: input.messages,
      jsonSchema: input.jsonSchema,
      codexModel: input.model,
      reasoningEffort: input.reasoningEffort,
      promptVersion: 'experience-v1',
      context: { requestId: input.requestId, sourceApp: serviceId }
    }, input.timeoutMs);
    return {
      data: result.data,
      content: String(result.content || ''),
      runtime: {
        provider: 'seemplify-shared-chatgpt',
        providerLabel: 'Shared ChatGPT / Codex gateway',
        engine: 'seemplify-ai-gateway',
        model: result.model || input.model,
        reasoningEffort: result.reasoningEffort || input.reasoningEffort,
        action: input.action || null,
        requestId: result.requestId || input.requestId || null,
        planType: result.planType || null
      }
    };
  }
}

const sharedClients = new Map<string, SharedAiGatewayClient>();

export function sharedAiGatewayClientForUser(userId: string) {
  let client = sharedClients.get(userId);
  if (!client) { client = new SharedAiGatewayClient(userId); sharedClients.set(userId, client); }
  return client;
}
