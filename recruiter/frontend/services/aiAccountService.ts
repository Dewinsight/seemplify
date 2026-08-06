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
  /** Recruiter AI runs only on connected ChatGPT accounts; there is no
   * managed runtime to fall back to for this user's work. */
  chatgptRequired?: boolean;
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
  return chatGptSetupState(account, policy) === 'required';
}

/**
 * How the connection gate should confront this user, mirroring Experience
 * Management's ChatGptConnectionGate:
 * - 'required': ChatGPT is the runtime and local is off — the gate blocks
 *   until the account is connected and consented.
 * - 'choice': ChatGPT is the workspace default but local can still serve —
 *   the gate asks the user to pick, once per session.
 * - null: nothing to gate on.
 */
export function chatGptSetupState(
  account: AiRuntimeAccount | null | undefined,
  policy: AiRuntimePolicy | null | undefined
): 'required' | 'choice' | null {
  if (!account || !policy) return null;
  if (!policy.chatgptEnabled || policy.defaultRuntime !== 'chatgpt') return null;
  if (account.routable) return null;
  // The local runtime being on does not help this user when their own AI work
  // is ChatGPT-only — only an unrequired policy leaves them a real choice.
  if (policy.chatgptRequired) return 'required';
  return policy.localEnabled ? 'choice' : 'required';
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
