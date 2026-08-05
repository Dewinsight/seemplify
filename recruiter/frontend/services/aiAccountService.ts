import { apiRequest } from './apiConfig';

export type AiAccountStatus = 'disconnected' | 'pending' | 'connected' | 'error';

export interface AiRuntimeAccount {
  status: AiAccountStatus;
  connectedEmail: string | null;
  planType: string | null;
  connectedAt: string | null;
  lastVerifiedAt: string | null;
  dataSharingAcknowledgedAt: string | null;
  /** True only when the account is connected *and* consent is current. */
  routable: boolean;
  lastError: string | null;
}

export interface AiDeviceLogin {
  connected: boolean;
  loginId?: string;
  verificationUrl?: string;
  userCode?: string;
}

export interface AiAccountModel {
  id: string;
  displayName: string;
  isDefault?: boolean;
  defaultReasoningEffort?: string;
}

async function readJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiRequest(path, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.msg || body.message || 'The ChatGPT connection request failed');
    (error as any).code = body.code;
    throw error;
  }
  return body as T;
}

export interface AiRuntimePolicy {
  localEnabled: boolean;
  chatgptEnabled: boolean;
  defaultRuntime: 'local' | 'chatgpt';
}

/**
 * Ported from Experience Management's requiresChatGptSetup: connecting is only
 * *required* when ChatGPT is the effective runtime and this account cannot use
 * it yet. When the local runtime is available the connection stays optional.
 */
export function requiresChatGptSetup(
  account: AiRuntimeAccount | null | undefined,
  policy: AiRuntimePolicy | null | undefined
) {
  if (!account || !policy) return false;
  if (!policy.chatgptEnabled || policy.defaultRuntime !== 'chatgpt') return false;
  if (policy.localEnabled) return false;
  return !account.routable;
}

export const aiAccountService = {
  read: () => readJson<{ account: AiRuntimeAccount; runtimePolicy?: AiRuntimePolicy }>('/api/ai-account'),

  startLogin: () => readJson<{ login: AiDeviceLogin; account: AiRuntimeAccount }>(
    '/api/ai-account/login', { method: 'POST' }
  ),

  cancelLogin: () => readJson<{ account: AiRuntimeAccount }>(
    '/api/ai-account/login/cancel', { method: 'POST' }
  ),

  setConsent: (acknowledged: boolean) => readJson<{ account: AiRuntimeAccount }>(
    '/api/ai-account/consent',
    { method: 'POST', body: JSON.stringify({ acknowledged }) }
  ),

  listModels: () => readJson<{ models: AiAccountModel[] }>('/api/ai-account/models'),

  disconnect: () => readJson<{ account: AiRuntimeAccount }>('/api/ai-account', { method: 'DELETE' })
};
