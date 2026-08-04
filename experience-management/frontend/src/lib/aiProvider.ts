export type AiRuntimeChoice = 'chatgpt' | 'local' | null;

export type CodexModel = {
  id: string;
  displayName: string;
  isDefault: boolean;
  defaultReasoningEffort?: string;
  supportedReasoningEfforts?: { reasoningEffort: string; description?: string }[];
};

export type CodexAction = {
  id: string;
  group: string;
  label: string;
  description: string;
  defaultReasoningEffort: string;
};

export type CodexActionOverride = {
  model: string | null;
  reasoningEffort: string | null;
  reasoningEffortAuto?: true;
};

export type ResolvedCodexSetting = {
  value: string | null;
  source: 'user_action' | 'user_default' | 'admin_action' | 'admin_default' | 'action_default' | 'connected_model_default' | 'model_default' | null;
  inherited: boolean;
};

export type AiProviderState = {
  preference: {
    provider: 'terra' | 'codex';
    /**
     * Absent on responses created before the ChatGPT-first setup flow. The
     * guard deliberately fails open for those legacy response fixtures.
     */
    runtimeChoice?: AiRuntimeChoice;
    codexModel: string | null;
    codexReasoningEffort: string | null;
    codexActionOverrides: Record<string, CodexActionOverride>;
    codexDataSharingAcknowledgedAt: string | null;
    updatedAt: string | null;
  };
  codex: {
    available: boolean;
    account: {
      connected: boolean;
      email: string | null;
      planType: string | null;
      authMode?: string | null;
      pendingLogin: boolean;
      loginError: string | null;
    };
    models: CodexModel[];
    actions: CodexAction[];
    adminDefaults?: {
      codexModel: string | null;
      codexReasoningEffort: string | null;
      codexActionOverrides: Record<string, CodexActionOverride>;
      updatedAt: string | null;
    };
    effectiveConfiguration?: {
      default: { model: ResolvedCodexSetting; reasoningEffort: ResolvedCodexSetting };
      actions: Record<string, { model: ResolvedCodexSetting; reasoningEffort: ResolvedCodexSetting }>;
    };
    selectedModel: string | null;
    error: string | null;
  };
};

export type DeviceLogin = {
  connected: false;
  loginId: string;
  verificationUrl: string;
  userCode: string;
};

export const AI_PROVIDER_CHANGED_EVENT = 'seemplify-experience:ai-provider-changed';

export function notifyAiProviderChanged(state?: AiProviderState) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<AiProviderState | undefined>(AI_PROVIDER_CHANGED_EVENT, { detail: state }));
}

export function requiresChatGptSetup(state: AiProviderState | null | undefined) {
  if (!state || !Object.prototype.hasOwnProperty.call(state.preference, 'runtimeChoice')) return false;
  if (state.preference.runtimeChoice !== null && state.preference.runtimeChoice !== 'chatgpt') return false;

  const selectedModel = String(state.codex.selectedModel || '').trim();
  const selectedModelAvailable = Boolean(selectedModel
    && state.codex.models.some((model) => model.id === selectedModel));
  return !(state.codex.account.connected
    && Boolean(state.preference.codexDataSharingAcknowledgedAt)
    && selectedModelAvailable);
}
