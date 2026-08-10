import api from './api';

export type AIRuntimePreference = 'default' | 'local' | 'chatgpt';
export type AIReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';

export interface AIUsageWindow {
  usedPercent: number | null;
  windowMinutes: number | null;
  resetsAt: string | null;
}

export interface AIAccount {
  status: 'disconnected' | 'pending' | 'connected' | 'error';
  connectedEmail: string | null;
  planType: string | null;
  connectedAt: string | null;
  lastVerifiedAt: string | null;
  dataSharingAcknowledgedAt: string | null;
  routable: boolean;
  rateLimits: { primary?: AIUsageWindow | null; secondary?: AIUsageWindow | null; capturedAt?: string | null } | null;
  usageLimit: { message: string; at: string } | null;
  usage?: { source: string; available: boolean; observedAt: string | null; rateLimits: unknown; usageLimit: unknown } | null;
  lastError: string | null;
  runtimePreference?: AIRuntimePreference;
}

export interface AIRuntimePolicy {
  localEnabled: boolean;
  chatgptEnabled: boolean;
  chatgptRequired?: boolean;
  defaultRuntime: 'local' | 'chatgpt';
}

export interface AIModel {
  id: string;
  displayName: string;
  isDefault?: boolean;
  defaultReasoningEffort?: AIReasoningEffort | null;
  supportedReasoningEfforts?: Array<AIReasoningEffort | { reasoningEffort: AIReasoningEffort }>;
}

export interface AIActivitySetting { codexModel: string | null; reasoningEffort: AIReasoningEffort | null }
export interface AIActivityOverride { codexModel: string | null; reasoningEffort: AIReasoningEffort | null }
export interface AIFieldProvenance { codexModel: string; reasoningEffort: string }

export interface AIAccountDefaultPreference {
  override: AIActivityOverride;
  effective: AIActivitySetting;
  provenance: AIFieldProvenance;
}

export interface AIActivityPreference {
  activity: string;
  app?: 'recruiter' | 'performance';
  label: string;
  group: string;
  enabled: boolean;
  adminDefault: AIActivitySetting;
  accountDefault?: AIActivityOverride;
  override: AIActivityOverride;
  effective: AIActivitySetting;
  provenance: AIFieldProvenance;
}

export interface AIPreferences {
  defaults: AIAccountDefaultPreference;
  activities: AIActivityPreference[];
  models: AIModel[];
}

export interface AIAccountState {
  account: AIAccount;
  runtimePolicy: AIRuntimePolicy;
  runtimePreference: AIRuntimePreference;
  preferences?: AIPreferences;
}

export interface AIDeviceLogin {
  connected: boolean;
  loginId?: string;
  verificationUrl?: string;
  userCode?: string;
}

function messageFrom(error: unknown, fallback: string) {
  const value = error as {
    message?: string;
    response?: {
      data?: { message?: string; code?: string; retryAfterSeconds?: number | string };
      headers?: Record<string, string | number | undefined>;
    };
  };
  const wrapped = new Error(value?.response?.data?.message || value?.message || fallback) as Error & {
    code?: string; retryAfterSeconds?: number;
  };
  wrapped.code = value?.response?.data?.code;
  wrapped.retryAfterSeconds = Number(value?.response?.data?.retryAfterSeconds)
    || Number(value?.response?.headers?.['retry-after']) || 0;
  return wrapped;
}

export function aiErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function request<T>(operation: () => Promise<{ data: T }>, fallback: string): Promise<T> {
  try { return (await operation()).data; }
  catch (error) { throw messageFrom(error, fallback); }
}

export const aiAccount = {
  read: () => request<AIAccountState>(() => api.get('/ai-account'), 'Your AI account could not be checked.'),
  startLogin: () => request<{ login: AIDeviceLogin; account: AIAccount }>(() => api.post('/ai-account/login'), 'ChatGPT sign-in could not be started.'),
  cancelLogin: () => request<{ account: AIAccount }>(() => api.post('/ai-account/login/cancel'), 'The pending sign-in could not be cancelled.'),
  resetLogin: () => request<{ account: AIAccount }>(() => api.post('/ai-account/login/reset'), 'ChatGPT sign-in could not be reset.'),
  consent: (acknowledged: boolean) => request<{ account: AIAccount }>(() => api.post('/ai-account/consent', { acknowledged }), 'Your consent choice could not be saved.'),
  disconnect: () => request<{ account: AIAccount }>(() => api.delete('/ai-account'), 'ChatGPT could not be disconnected.'),
  preferences: () => request<AIPreferences>(() => api.get('/ai-account/preferences'), 'AI model settings could not be loaded.'),
  savePreference: (scope: 'default' | 'activity', activity: string | null, override: AIActivityOverride) =>
    request<AIPreferences>(() => api.put('/ai-account/preferences', { scope, ...(activity ? { activity } : {}), ...override }), 'The AI model setting could not be saved.'),
  deletePreference: (scope: 'default' | 'activity', activity: string | null = null) =>
    request<AIPreferences>(() => api.delete('/ai-account/preferences', { data: { scope, ...(activity ? { activity } : {}) } }), 'The AI model setting could not be reset.'),
  runtime: async () => {
    const result = await request<{ policy: AIRuntimePolicy; runtimePreference: AIRuntimePreference }>(() => api.get('/ai-runtime'), 'The AI runtime could not be checked.');
    return { runtimePolicy: result.policy, runtimePreference: result.runtimePreference };
  },
  setRuntime: (runtimePreference: AIRuntimePreference) =>
    request<{ policy: AIRuntimePolicy; runtimePreference: AIRuntimePreference }>(() => api.put('/ai-runtime/preference', { runtimePreference }), 'Your AI runtime could not be changed.')
      .then((result) => ({ runtimePolicy: result.policy, runtimePreference: result.runtimePreference }))
};

export function effectiveRuntime(state: AIAccountState | null | undefined) {
  if (!state) return null;
  return state.runtimePreference === 'default' ? state.runtimePolicy.defaultRuntime : state.runtimePreference;
}

export function supportedEfforts(model?: AIModel | null): AIReasoningEffort[] {
  const allowed = new Set<AIReasoningEffort>(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
  const advertised = (model?.supportedReasoningEfforts || [])
    .map((value) => typeof value === 'string' ? value : value?.reasoningEffort)
    .filter((value): value is AIReasoningEffort => allowed.has(value as AIReasoningEffort));
  // An older gateway may not advertise capability metadata. In that case the
  // backend's complete supported set remains available; the live catalogue is
  // used to narrow the choices only when it actually reports a restriction.
  return advertised.length ? [...new Set(advertised)] : [...allowed];
}
