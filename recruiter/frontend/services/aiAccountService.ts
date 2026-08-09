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
  rateLimits: AiPlanRateLimits | null;
  usageLimit: AiPlanUsageLimit | null;
  lastError: string | null;
  runtimePreference: 'default' | 'local' | 'chatgpt';
  usage?: {
    source: 'connected_chatgpt_runtime' | string;
    available: boolean;
    observedAt: string | null;
    rateLimits: AiPlanRateLimits | null;
    usageLimit: AiPlanUsageLimit | null;
  };
}

/** One of the plan's usage windows, as Codex last reported it. */
export interface AiPlanWindow {
  usedPercent: number | null;
  windowMinutes: number | null;
  resetsAt: string | null;
}

export interface AiPlanRateLimits {
  primary: AiPlanWindow | null;
  secondary: AiPlanWindow | null;
  capturedAt: string | null;
}

/** The last refusal for exceeding the plan, which names when it lifts. */
export interface AiPlanUsageLimit {
  message: string;
  at: string;
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
  defaultReasoningEffort?: AiReasoningEffort | null;
  supportedReasoningEfforts?: Array<AiReasoningEffort | { reasoningEffort: AiReasoningEffort }>;
}

export type AiReasoningEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'
  | 'ultra';

export interface AiActivitySetting {
  codexModel: string;
  reasoningEffort: AiReasoningEffort;
}

export interface AiActivityOverride {
  codexModel: string | null;
  reasoningEffort: AiReasoningEffort | null;
}

export type AiSettingProvenance =
  | 'activity_override'
  | 'account_default'
  | 'admin_default'
  | 'app_default'
  | string;

export interface AiFieldProvenance {
  codexModel: AiSettingProvenance;
  reasoningEffort: AiSettingProvenance;
}

export interface AiAccountDefaultPreference {
  override: AiActivityOverride;
  /** Null means the concrete value comes from each activity's admin default. */
  effective: AiActivityOverride | null;
  provenance: AiFieldProvenance;
}

export interface AiActivityPreference {
  activity: string;
  app: 'recruiter' | 'performance' | string;
  label: string;
  group: string;
  enabled: boolean;
  adminDefault: AiActivitySetting;
  accountDefault?: AiActivityOverride;
  override: AiActivityOverride;
  effective: AiActivitySetting;
  provenance: AiFieldProvenance;
}

export interface AiActivityPreferencesResponse {
  defaults: AiAccountDefaultPreference;
  activities: AiActivityPreference[];
  models: AiAccountModel[];
}

async function readJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiRequest(path, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.msg || body.message || 'The ChatGPT connection request failed');
    (error as any).code = body.code;
    // A throttled sign-in is only recoverable if the caller knows the wait, so
    // it survives the trip from the gateway to the button that has to be
    // disabled for that long.
    (error as any).retryAfterSeconds = Number(body.retryAfterSeconds)
      || Number(response.headers.get('retry-after')) || 0;
    throw error;
  }
  return body as T;
}

export interface AiRuntimePolicy {
  localEnabled: boolean;
  chatgptEnabled: boolean;
  defaultRuntime: 'local' | 'chatgpt';
  chatgptRequired: boolean;
}

/**
 * Ported from Experience Management's requiresChatGptSetup: connecting is only
 * required when ChatGPT is enabled and this account cannot use it yet.
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
): 'required' | null {
  if (!account || !policy) return null;
  if (!policy.chatgptEnabled || policy.defaultRuntime !== 'chatgpt') return null;
  if (account.routable) return null;
  if (policy.localEnabled && account.runtimePreference !== 'chatgpt') return null;
  // The ChatGPT gateway being on does not help this user when their own AI work
  // is ChatGPT-only — only an unrequired policy leaves them a real choice.
  return 'required';
}

export const aiAccountService = {
  read: () => readJson<{ account: AiRuntimeAccount; runtimePolicy?: AiRuntimePolicy }>('/api/ai-account'),

  startLogin: () => readJson<{ login: AiDeviceLogin; account: AiRuntimeAccount }>(
    '/api/ai-account/login', { method: 'POST' }
  ),

  cancelLogin: () => readJson<{ account: AiRuntimeAccount }>(
    '/api/ai-account/login/cancel', { method: 'POST' }
  ),

  resetLogin: () => readJson<{ reset: boolean; cancelled?: boolean; account: AiRuntimeAccount }>(
    '/api/ai-account/login/reset', { method: 'POST' }
  ),

  setConsent: (acknowledged: boolean) => readJson<{ account: AiRuntimeAccount }>(
    '/api/ai-account/consent',
    { method: 'POST', body: JSON.stringify({ acknowledged }) }
  ),

  setRuntimePreference: (runtimePreference: 'default' | 'local' | 'chatgpt') => readJson<{
    account: AiRuntimeAccount; runtimePolicy: AiRuntimePolicy
  }>('/api/ai-account/runtime-preference', {
    method: 'PUT', body: JSON.stringify({ runtimePreference })
  }),

  listModels: () => readJson<{ models: AiAccountModel[] }>('/api/ai-account/models'),

  readActivityOverrides: () => readJson<AiActivityPreferencesResponse>(
    '/api/ai-account/activity-overrides'
  ),

  saveActivityOverride: (
    scope: 'default' | 'activity',
    activity: string | null,
    override: AiActivityOverride
  ) => readJson<AiActivityPreferencesResponse>('/api/ai-account/activity-overrides', {
    method: 'PUT',
    body: JSON.stringify({ scope, ...(activity ? { activity } : {}), ...override })
  }),

  deleteActivityOverride: (scope: 'default' | 'activity', activity: string | null = null) => readJson<AiActivityPreferencesResponse>(
    '/api/ai-account/activity-overrides',
    { method: 'DELETE', body: JSON.stringify({ scope, ...(activity ? { activity } : {}) }) }
  ),

  disconnect: () => readJson<{ account: AiRuntimeAccount }>('/api/ai-account', { method: 'DELETE' })
};
