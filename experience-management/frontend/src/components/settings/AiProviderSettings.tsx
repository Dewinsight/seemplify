import { Fragment, useEffect, useRef, useState } from 'react';
import { Check, Copy, Cpu, ExternalLink, Loader2, LogOut, RotateCcw, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, json } from '@/lib/api';
import { notifyAiProviderChanged } from '@/lib/aiProvider';
import { OpenAiAttribution } from '@/components/brand/OpenAiAttribution';

type CodexModel = {
  id: string;
  displayName: string;
  isDefault: boolean;
  defaultReasoningEffort?: string;
  supportedReasoningEfforts?: { reasoningEffort: string; description?: string }[];
};

type CodexAction = {
  id: string;
  group: string;
  label: string;
  description: string;
  defaultReasoningEffort: string;
};

type CodexActionOverride = {
  model: string | null;
  reasoningEffort: string | null;
  reasoningEffortAuto?: true;
};

type ResolvedCodexSetting = {
  value: string | null;
  source: 'user_action' | 'user_default' | 'admin_action' | 'admin_default' | 'action_default' | 'connected_model_default' | 'model_default' | null;
  inherited: boolean;
};

type AiProviderState = {
  preference: {
    provider: 'codex';
    effectiveProvider?: 'codex' | null;
    runtimeChoice: 'chatgpt';
    codexModel: string | null;
    codexReasoningEffort: string | null;
    codexActionOverrides: Record<string, CodexActionOverride>;
    codexDataSharingAcknowledgedAt: string | null;
    updatedAt: string | null;
  };
  runtimePolicy?: {
    chatgptEnabled: boolean;
    defaultRuntime: 'chatgpt';
    effectiveProvider: 'codex' | null;
  };
  codex: {
    available: boolean;
    account: {
      connected: boolean;
      email: string | null;
      planType: string | null;
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

type DeviceLogin = {
  connected: false;
  loginId: string;
  verificationUrl: string;
  userCode: string;
};

type CodexConfigurationPatch = Partial<Pick<
  AiProviderState['preference'],
  'codexModel' | 'codexReasoningEffort' | 'codexActionOverrides'
>>;

function accountLabel(state: AiProviderState) {
  const identity = state.codex.account.email || 'ChatGPT account';
  const plan = state.codex.account.planType;
  return plan ? `${identity} · ${plan}` : identity;
}

function effortLabel(effort: string) {
  const known: Record<string, string> = {
    none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High',
    xhigh: 'Extra high', max: 'Max', ultra: 'Ultra'
  };
  return known[effort] || effort.replace(/[_-]+/g, ' ').replace(/^./, (value) => value.toUpperCase());
}

function sourceLabel(source: ResolvedCodexSetting['source']) {
  const labels: Record<Exclude<ResolvedCodexSetting['source'], null>, string> = {
    user_action: 'Your action override', user_default: 'Your space default',
    admin_action: 'Platform action default', admin_default: 'Platform default',
    action_default: 'Action default', connected_model_default: 'Connected account default',
    model_default: 'Model default'
  };
  return source ? labels[source] : 'No available default';
}

function effortValues(model: CodexModel | undefined) {
  const advertised = (model?.supportedReasoningEfforts || []).map((item) => item.reasoningEffort).filter(Boolean);
  return [...new Set([...advertised, ...(model?.defaultReasoningEffort ? [model.defaultReasoningEffort] : [])])];
}

function supportsEffort(model: CodexModel | undefined, effort: string | null | undefined) {
  return Boolean(effort && effortValues(model).includes(effort));
}

function compatibleModelDefault(model: CodexModel | undefined) {
  const efforts = effortValues(model);
  if (model?.defaultReasoningEffort && efforts.includes(model.defaultReasoningEffort)) {
    return model.defaultReasoningEffort;
  }
  return efforts[0] || null;
}

function normaliseDefaultEffort(models: CodexModel[], modelId: string, effort: string | null) {
  if (!effort) return null;
  const model = models.find((item) => item.id === modelId);
  return supportsEffort(model, effort) ? effort : compatibleModelDefault(model);
}

function normaliseOverridesForCatalog(input: {
  actions: CodexAction[];
  models: CodexModel[];
  defaultModelId: string;
  defaultReasoningEffort: string | null;
  overrides: Record<string, CodexActionOverride>;
}) {
  const modelById = new Map(input.models.map((model) => [model.id, model]));
  const defaultModel = modelById.get(input.defaultModelId);
  const next: Record<string, CodexActionOverride> = {};
  for (const action of input.actions) {
    const current = input.overrides[action.id];
    const explicitModel = current?.model && modelById.has(current.model) ? current.model : null;
    const model = explicitModel ? modelById.get(explicitModel) : defaultModel;
    const inheritedEffort = input.defaultReasoningEffort || action.defaultReasoningEffort;
    const explicitEffort = !current?.reasoningEffortAuto && supportsEffort(model, current?.reasoningEffort)
      ? current!.reasoningEffort
      : null;
    const inheritedEffortAvailable = supportsEffort(model, inheritedEffort);
    const reasoningEffort = explicitEffort
      || (inheritedEffortAvailable ? null : compatibleModelDefault(model));
    const reasoningEffortAuto = !explicitEffort && !inheritedEffortAvailable && Boolean(reasoningEffort);
    if (explicitModel || reasoningEffort) {
      next[action.id] = {
        model: explicitModel,
        reasoningEffort,
        ...(reasoningEffortAuto ? { reasoningEffortAuto: true as const } : {})
      };
    }
  }
  return next;
}

const selectClassName = 'h-9 w-full rounded-md border-input bg-background px-3 text-sm focus:border-ring focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60';

export function AiProviderSettings() {
  const [state, setState] = useState<AiProviderState | null>(null);
  const [deviceLogin, setDeviceLogin] = useState<DeviceLogin | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const connectedRef = useRef(false);
  const activateAfterLoginRef = useRef(false);
  const activationInFlight = useRef(false);
  const mutationInFlight = useRef(false);

  useEffect(() => {
    if (window.location.hash !== '#ai-runtime') return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById('ai-runtime')?.scrollIntoView({ block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  function beginMutation(label: string) {
    if (mutationInFlight.current) return false;
    mutationInFlight.current = true;
    setWorking(label);
    setError('');
    return true;
  }

  function finishMutation() {
    mutationInFlight.current = false;
    setWorking('');
  }

  async function refresh() {
    const next = await api<AiProviderState>('/api/ai-provider');
    setState(next);
    setAcknowledged(Boolean(next.preference.codexDataSharingAcknowledgedAt));
    if (next.codex.account.connected) setDeviceLogin(null);
    return next;
  }

  async function activateChatGptAfterLogin() {
    if (activationInFlight.current) return;
    activationInFlight.current = true;
    try {
      const next = await api<AiProviderState>('/api/ai-provider', json('PATCH', {
        provider: 'codex',
        codexDataSharingAcknowledged: true
      }));
      activateAfterLoginRef.current = false;
      connectedRef.current = true;
      setDeviceLogin(null);
      setState(next);
      setAcknowledged(true);
      notifyAiProviderChanged();
      toast.success('ChatGPT connected and selected for this space');
    } catch (reason) {
      activateAfterLoginRef.current = false;
      setError(reason instanceof Error ? reason.message : 'ChatGPT connected, but could not be selected for this space.');
      await refresh().catch(() => undefined);
    } finally {
      activationInFlight.current = false;
    }
  }

  useEffect(() => {
    let cancelled = false;
    void api<AiProviderState>('/api/ai-provider').then((next) => {
      if (cancelled) return;
      connectedRef.current = next.codex.account.connected;
      activateAfterLoginRef.current = next.codex.account.pendingLogin;
      setState(next);
      setAcknowledged(Boolean(next.preference.codexDataSharingAcknowledgedAt));
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load AI runtime settings.');
    });
    return () => { cancelled = true; };
  }, []);

  const loginPending = Boolean(deviceLogin || state?.codex.account.pendingLogin);
  useEffect(() => {
    if (!loginPending) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await api<AiProviderState>('/api/ai-provider');
        if (cancelled) return;
        if (next.codex.account.connected && activateAfterLoginRef.current) {
          connectedRef.current = true;
          setState(next);
          setAcknowledged(Boolean(next.preference.codexDataSharingAcknowledgedAt));
          setDeviceLogin(null);
          await activateChatGptAfterLogin();
          return;
        }
        if (next.codex.account.connected && !connectedRef.current) toast.success('ChatGPT connected');
        connectedRef.current = next.codex.account.connected;
        setState(next);
        setAcknowledged(Boolean(next.preference.codexDataSharingAcknowledgedAt));
        if (next.codex.account.connected || next.codex.account.loginError) setDeviceLogin(null);
      } catch { /* Keep the current sign-in instructions visible and retry. */ }
    };
    const timer = window.setInterval(() => void poll(), 2_000);
    void poll();
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [loginPending]);

  async function chooseProvider(provider: 'codex') {
    if (provider === state?.preference.provider
      && state.preference.runtimeChoice === 'chatgpt'
      && Boolean(state.preference.codexDataSharingAcknowledgedAt)) return;
    if (!beginMutation(`provider:${provider}`)) return;
    try {
      const inheritedPlatformModel = Boolean(state?.codex.adminDefaults?.codexModel && !state.preference.codexModel);
      const preferenceModel = state && provider === 'codex'
        ? (state.preference.codexModel || (inheritedPlatformModel ? null : selectedModel))
        : null;
      const codexDefaultEffort = state && provider === 'codex'
        ? normaliseDefaultEffort(state.codex.models, selectedModel, state.preference.codexReasoningEffort)
        : null;
      const normalisedOverrides = state && provider === 'codex' ? normaliseOverridesForCatalog({
        actions: state.codex.actions,
        models: state.codex.models,
        defaultModelId: selectedModel,
        defaultReasoningEffort: codexDefaultEffort,
        overrides: state.preference.codexActionOverrides || {}
      }) : undefined;
      const next = await api<AiProviderState>('/api/ai-provider', json('PATCH', {
        provider,
        ...(provider === 'codex' ? {
          codexModel: preferenceModel,
          codexReasoningEffort: codexDefaultEffort,
          codexActionOverrides: normalisedOverrides || {},
          codexDataSharingAcknowledged: acknowledged
        } : {})
      }));
      setState(next);
      setAcknowledged(Boolean(next.preference.codexDataSharingAcknowledgedAt));
      notifyAiProviderChanged();
      toast.success('ChatGPT / Codex selected for this space');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not change the AI runtime.'); }
    finally { finishMutation(); }
  }

  async function startLogin() {
    if (!beginMutation('login')) return;
    try {
      activateAfterLoginRef.current = true;
      const result = await api<DeviceLogin | { connected: true }>('/api/ai-provider/codex/device-login', json('POST', {}));
      if (result.connected) {
        connectedRef.current = true;
        await activateChatGptAfterLogin();
      } else {
        setDeviceLogin(result);
      }
    } catch (reason) {
      activateAfterLoginRef.current = false;
      setError(reason instanceof Error ? reason.message : 'Could not start ChatGPT sign-in.');
    }
    finally { finishMutation(); }
  }

  async function cancelLogin() {
    if (!beginMutation('cancel-login')) return;
    try {
      await api('/api/ai-provider/codex/device-login/cancel', json('POST', {}));
      activateAfterLoginRef.current = false;
      setDeviceLogin(null);
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not cancel ChatGPT sign-in.'); }
    finally { finishMutation(); }
  }

  async function saveCodexConfiguration(patch: CodexConfigurationPatch, mutation: string, message: string) {
    if (!state || !beginMutation(mutation)) return;
    try {
      const requestedPreferenceModel = patch.codexModel === undefined
        ? state.preference.codexModel
        : patch.codexModel;
      const nextPreferenceModel = requestedPreferenceModel
        && !state.codex.models.some((model) => model.id === requestedPreferenceModel)
        ? selectedModel
        : requestedPreferenceModel;
      const nextModel = nextPreferenceModel || state.codex.adminDefaults?.codexModel || selectedModel;
      const requestedEffort = patch.codexReasoningEffort === undefined
        ? state.preference.codexReasoningEffort
        : patch.codexReasoningEffort;
      const nextEffort = normaliseDefaultEffort(state.codex.models, nextModel, requestedEffort);
      const nextOverrides = normaliseOverridesForCatalog({
        actions: state.codex.actions,
        models: state.codex.models,
        defaultModelId: nextModel,
        defaultReasoningEffort: nextEffort,
        overrides: patch.codexActionOverrides === undefined
          ? (state.preference.codexActionOverrides || {})
          : patch.codexActionOverrides
      });
      const next = await api<AiProviderState>('/api/ai-provider', json('PATCH', {
        provider: state.preference.provider,
        codexModel: nextPreferenceModel,
        codexReasoningEffort: nextEffort,
        codexActionOverrides: nextOverrides,
        ...(state.preference.provider === 'codex' ? { codexDataSharingAcknowledged: acknowledged } : {})
      }));
      setState(next);
      notifyAiProviderChanged();
      toast.success(message);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update Codex task settings.'); }
    finally { finishMutation(); }
  }

  async function selectDefaultModel(modelId: string) {
    if (!state) return;
    const model = state.codex.models.find((item) => item.id === modelId);
    if (!model) return;
    const supported = effortValues(model);
    const currentEffort = state.preference.codexReasoningEffort;
    const nextEffort = currentEffort && supported.length && !supported.includes(currentEffort)
      ? (model.defaultReasoningEffort || supported[0] || null)
      : currentEffort;
    await saveCodexConfiguration({
      codexModel: modelId,
      codexReasoningEffort: nextEffort
    }, 'default-model', 'Default Codex model updated');
  }

  async function selectDefaultEffort(reasoningEffort: string) {
    await saveCodexConfiguration(
      { codexReasoningEffort: reasoningEffort || null },
      'default-effort',
      'Default reasoning effort updated'
    );
  }

  async function selectActionModel(action: CodexAction, modelId: string) {
    if (!state) return;
    const currentOverrides = state.preference.codexActionOverrides || {};
    const current = currentOverrides[action.id] || { model: null, reasoningEffort: null };
    const nextModel = modelId || null;
    const nextOverrides = { ...currentOverrides };
    if (!nextModel && !current.reasoningEffort) delete nextOverrides[action.id];
    else nextOverrides[action.id] = { ...current, model: nextModel };
    await saveCodexConfiguration(
      { codexActionOverrides: nextOverrides },
      `action-model:${action.id}`,
      `${action.label} model updated`
    );
  }

  async function selectActionEffort(action: CodexAction, reasoningEffort: string) {
    if (!state) return;
    const currentOverrides = state.preference.codexActionOverrides || {};
    const current = currentOverrides[action.id] || { model: null, reasoningEffort: null };
    const nextOverrides = { ...currentOverrides };
    if (!current.model && !reasoningEffort) delete nextOverrides[action.id];
    else nextOverrides[action.id] = {
      model: current.model,
      reasoningEffort: reasoningEffort || null
    };
    await saveCodexConfiguration(
      { codexActionOverrides: nextOverrides },
      `action-effort:${action.id}`,
      `${action.label} effort updated`
    );
  }

  async function resetActionOverrides() {
    if (!window.confirm('Reset every per-action Codex model and effort override?')) return;
    await saveCodexConfiguration({ codexActionOverrides: {} }, 'reset-actions', 'Per-action overrides reset');
  }

  async function resetCodexDefaults() {
    if (!state || !window.confirm('Use the platform Codex defaults for this space? Your model, effort, and per-action choices will be cleared.')) return;
    if (!beginMutation('reset-defaults')) return;
    try {
      const next = await api<AiProviderState>('/api/ai-provider/reset-codex-defaults', json('POST', {}));
      setState(next);
      notifyAiProviderChanged();
      toast.success('This space now inherits the platform Codex defaults');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not reset Codex defaults.');
    } finally {
      finishMutation();
    }
  }

  async function changeAcknowledgement(nextAcknowledged: boolean) {
    if (mutationInFlight.current) return;
    if (nextAcknowledged || !state?.preference.codexDataSharingAcknowledgedAt) {
      setAcknowledged(nextAcknowledged);
      return;
    }
    if (!beginMutation('consent')) return;
    setAcknowledged(false);
    try {
      const next = await api<AiProviderState>('/api/ai-provider', json('PATCH', {
        provider: 'codex', codexDataSharingAcknowledged: false
      }));
      setState(next); setAcknowledged(false);
      notifyAiProviderChanged();
      toast.success('OpenAI processing disabled for this space');
    } catch (reason) {
      setAcknowledged(true);
      setError(reason instanceof Error ? reason.message : 'Could not update OpenAI processing consent.');
    }
    finally { finishMutation(); }
  }

  async function disconnect() {
    if (mutationInFlight.current) return;
    if (!window.confirm('Disconnect ChatGPT for your account? AI features will require you to reconnect.')) return;
    if (!beginMutation('disconnect')) return;
    try {
      const next = await api<AiProviderState>('/api/ai-provider/codex/disconnect', json('POST', {}));
      connectedRef.current = false;
      setDeviceLogin(null); setState(next);
      setAcknowledged(Boolean(next.preference.codexDataSharingAcknowledgedAt));
      notifyAiProviderChanged();
      toast.success('ChatGPT disconnected');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not disconnect ChatGPT.'); }
    finally { finishMutation(); }
  }

  async function copyCode() {
    if (!deviceLogin) return;
    try { await navigator.clipboard.writeText(deviceLogin.userCode); toast.success('Sign-in code copied'); }
    catch { toast.error('Clipboard access is unavailable.'); }
  }

  const codexConnected = state?.codex.account.connected === true;
  const effectiveProvider = state?.preference.effectiveProvider || state?.preference.provider;
  const codexSelected = effectiveProvider === 'codex';
  const chatgptEnabled = state?.runtimePolicy?.chatgptEnabled !== false;
  const preferredModel = state?.preference.codexModel || '';
  const selectedModel = state?.codex.models.some((model) => model.id === preferredModel)
    ? preferredModel : (state?.codex.selectedModel || '');
  const defaultModel = state?.codex.models.find((model) => model.id === selectedModel);
  const defaultEfforts = effortValues(defaultModel);
  const actionOverrides = state?.preference.codexActionOverrides || {};
  const actionOverrideCount = Object.values(actionOverrides).filter((override) => Boolean(
    override.model || (override.reasoningEffort && !override.reasoningEffortAuto)
  )).length;
  const defaultModelUnavailable = Boolean(preferredModel && preferredModel !== selectedModel);
  const savedDefaultEffort = state?.preference.codexReasoningEffort || '';
  const defaultEffortUnavailable = Boolean(savedDefaultEffort
    && !supportsEffort(defaultModel, savedDefaultEffort));
  const staleActionOverrideCount = state?.codex.actions.filter((action) => {
    const override = actionOverrides[action.id];
    if (!override) return false;
    const overrideModel = override.model
      ? state.codex.models.find((model) => model.id === override.model)
      : defaultModel;
    const inheritedEffort = state.preference.codexReasoningEffort || action.defaultReasoningEffort;
    const inheritedEffortAvailable = supportsEffort(overrideModel, inheritedEffort);
    return Boolean((override.model && !overrideModel)
      || (override.reasoningEffort && !supportsEffort(overrideModel, override.reasoningEffort))
      || (override.reasoningEffortAuto && inheritedEffortAvailable)
      || (!override.reasoningEffort && !inheritedEffortAvailable));
  }).length || 0;
  const hasUserCodexDefaults = Boolean(state && (
    state.preference.codexModel
    || state.preference.codexReasoningEffort
    || Object.values(state.preference.codexActionOverrides || {}).some((override) => (
      override.model || (override.reasoningEffort && !override.reasoningEffortAuto)
    ))
  ));
  const resolvedDefaultModel = state?.codex.effectiveConfiguration?.default.model;
  const resolvedDefaultEffort = state?.codex.effectiveConfiguration?.default.reasoningEffort;
  const effectiveModelName = state?.codex.models.find((model) => model.id === resolvedDefaultModel?.value)?.displayName
    || defaultModel?.displayName
    || resolvedDefaultModel?.value
    || 'No available model';
  const effectiveEffortName = resolvedDefaultEffort?.value ? effortLabel(resolvedDefaultEffort.value) : 'Action default';
  const defaultModelSource = resolvedDefaultModel?.source
    || (state?.preference.codexModel ? 'user_default' : state?.codex.adminDefaults?.codexModel ? 'admin_default' : 'connected_model_default');
  const defaultEffortSource = resolvedDefaultEffort?.source
    || (state?.preference.codexReasoningEffort ? 'user_default' : state?.codex.adminDefaults?.codexReasoningEffort ? 'admin_default' : 'action_default');
  const codexConfigurationDisabled = !acknowledged || !selectedModel || Boolean(working);

  return <section id="ai-runtime" className="scroll-mt-20 border bg-card" aria-labelledby="ai-runtime-heading" data-testid="ai-provider-settings">
    <div className="flex items-start gap-3 border-b px-5 py-4">
      <Cpu className="mt-0.5 h-4 w-4 text-muted-foreground" />
      <div><h2 id="ai-runtime-heading" className="text-sm font-semibold">Connected ChatGPT</h2><p className="mt-1 text-xs text-muted-foreground">Manage the ChatGPT account and Codex model used by AI tasks in this space.</p></div>
    </div>
    {!state && !error ? <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Checking available runtimes…</div> : <div className="space-y-5 p-5">
      <div role="group" aria-label="AI runtime">
        <button type="button" aria-pressed={codexSelected} onClick={() => void chooseProvider('codex')} disabled={!chatgptEnabled || !codexConnected || !acknowledged || !selectedModel || Boolean(working)} className={`min-h-24 border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 ${codexSelected ? 'border-foreground/40 bg-muted/35' : 'hover:border-foreground/25 hover:bg-muted/20'}`}>
          <span className="flex items-center justify-between gap-3"><span className="text-sm font-semibold">ChatGPT / Codex</span>{codexSelected && <Check className="h-4 w-4" />}</span>
          <span className="mt-2 block text-xs leading-5 text-muted-foreground">Runs new AI tasks with a Codex model available to your connected ChatGPT account.</span>
          <OpenAiAttribution compact className="mt-3" />
          {!chatgptEnabled && <span className="mt-2 block text-xs font-medium">Disabled by platform administrator</span>}
        </button>
      </div>

      {state?.runtimePolicy && !state.runtimePolicy.chatgptEnabled && <div className="border border-amber-500/35 bg-background p-3 text-sm text-amber-900" role="alert">Connected ChatGPT is currently disabled by a platform administrator.</div>}

      {error && <div className="border border-destructive/35 bg-background p-3 text-sm text-destructive" role="alert">{error}</div>}
      {state?.codex.error && <div className="border border-amber-500/35 bg-background p-3 text-sm text-amber-800" role="status">Connected ChatGPT is unavailable: {state.codex.error}</div>}
      {codexConnected && state?.codex.models.length === 0 && <div className="border border-amber-500/35 bg-background p-3 text-sm text-amber-800" role="status">No Codex models are available to this ChatGPT account right now.</div>}

      {chatgptEnabled && !codexConnected && !loginPending && <div className="flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-sm font-medium">Connect your ChatGPT account</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Experience Management receives the connection status and runs Codex through its backend. By continuing, prompts and authorised knowledge excerpts for this space may be sent to OpenAI using your connected account. A successful sign-in selects ChatGPT for this space.</p></div>
        <Button type="button" variant="outline" disabled={!state?.codex.available || Boolean(working)} onClick={() => void startLogin()}>{working === 'login' ? <Loader2 className="animate-spin" /> : null}Connect ChatGPT</Button>
      </div>}

      {loginPending && <div className="space-y-4 border bg-muted/20 p-4" aria-live="polite" data-testid="codex-device-login">
        {deviceLogin ? <>
          <div><p className="text-sm font-medium">Finish signing in with OpenAI</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Open the secure page, enter this one-time code, then return here. Connection status updates automatically.</p></div>
          <div><Label className="field-label" htmlFor="codex-device-code">ChatGPT sign-in code</Label><div className="flex flex-col gap-2 sm:flex-row"><Input id="codex-device-code" readOnly value={deviceLogin.userCode} onFocus={(event) => event.currentTarget.select()} className="font-mono tracking-wider" /><Button type="button" variant="outline" onClick={() => void copyCode()}><Copy />Copy</Button><Button asChild><a href={deviceLogin.verificationUrl} target="_blank" rel="noreferrer noopener">Open OpenAI<ExternalLink /></a></Button></div></div>
        </> : <div><p className="text-sm font-medium">ChatGPT sign-in is pending</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Cancel and restart the sign-in if you no longer have the one-time code.</p></div>}
        <div className="flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground"><Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" />Waiting for OpenAI…</p><Button type="button" size="sm" variant="ghost" disabled={Boolean(working)} onClick={() => void cancelLogin()}>{working === 'cancel-login' ? <Loader2 className="animate-spin" /> : <X />}Cancel</Button></div>
      </div>}

      {codexConnected && <div className="space-y-4 border-t pt-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium">Connected as {accountLabel(state!)}</p><p className="mt-1 text-xs text-muted-foreground">The connection belongs to your user account and is available in your spaces.</p><OpenAiAttribution compact showModel model={state?.codex.selectedModel || undefined} className="mt-2" /></div><Button type="button" size="sm" variant="outline" disabled={Boolean(working)} onClick={() => void disconnect()}>{working === 'disconnect' ? <Loader2 className="animate-spin" /> : <LogOut />}Disconnect</Button></div>
        <label className="flex cursor-pointer items-start gap-3 border bg-muted/15 p-3 text-sm leading-5"><input type="checkbox" className="mt-1 h-4 w-4 accent-foreground" checked={acknowledged} disabled={Boolean(working)} onChange={(event) => void changeAcknowledgement(event.target.checked)} /><span><span className="font-medium">Allow OpenAI processing for this space</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">Task prompts and authorised knowledge excerpts may be sent to OpenAI using your connected account. Turning this off pauses AI work until consent is restored.</span></span></label>
        {!codexSelected && <p className="text-xs text-muted-foreground">Check the acknowledgement, then choose ChatGPT / Codex above to enable it for this space.</p>}
        <div className="space-y-4 border-t pt-4" aria-labelledby="codex-task-settings-heading">
          <div>
            <h3 id="codex-task-settings-heading" className="text-sm font-medium">Codex task settings</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Choose the default connected model and effort, then override individual actions when needed.</p>
          </div>
          <div className="flex flex-col justify-between gap-3 border bg-muted/15 p-4 sm:flex-row sm:items-center" data-testid="codex-default-provenance">
            <div><p className="text-sm font-medium">Effective default: {effectiveModelName} / {effectiveEffortName}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Model: {sourceLabel(defaultModelSource)}. Effort: {sourceLabel(defaultEffortSource)}.{state?.codex.adminDefaults?.updatedAt ? ` Platform defaults were updated ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(state.codex.adminDefaults.updatedAt))}.` : ''}</p></div>
            <Button type="button" size="sm" variant="outline" disabled={Boolean(working) || !hasUserCodexDefaults} onClick={() => void resetCodexDefaults()}>{working === 'reset-defaults' ? <Loader2 className="animate-spin" /> : <RotateCcw />}{hasUserCodexDefaults ? 'Use platform defaults' : 'Using platform defaults'}</Button>
          </div>
          {defaultModelUnavailable && <p className="border border-amber-500/35 bg-amber-50/40 p-3 text-xs leading-5 text-amber-900" role="status">The saved default model is no longer available to this account. The current ChatGPT default is shown; saving any Codex setting will repair the saved selection.</p>}
          {defaultEffortUnavailable && <p className="border border-amber-500/35 bg-amber-50/40 p-3 text-xs leading-5 text-amber-900" role="status">The saved default effort is no longer available for this model. Saving any Codex setting will replace it with the model default.</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="min-w-0">
              <Label className="field-label" htmlFor="codex-default-model">Default Codex model</Label>
              <select id="codex-default-model" value={selectedModel} disabled={codexConfigurationDisabled} onChange={(event) => void selectDefaultModel(event.target.value)} className={selectClassName}>
                {state!.codex.models.map((model) => <option key={model.id} value={model.id}>{model.displayName}{model.isDefault ? ' (ChatGPT default)' : ''}</option>)}
              </select>
            </div>
            <div className="min-w-0">
              <Label className="field-label" htmlFor="codex-default-effort">Default reasoning effort</Label>
              <select id="codex-default-effort" value={savedDefaultEffort} disabled={codexConfigurationDisabled} onChange={(event) => void selectDefaultEffort(event.target.value)} className={selectClassName}>
                <option value="">Use inherited default ({effectiveEffortName})</option>
                {defaultEffortUnavailable && <option value={savedDefaultEffort}>{effortLabel(savedDefaultEffort)} (unavailable)</option>}
                {defaultEfforts.map((effort) => <option key={effort} value={effort}>{effortLabel(effort)}{effort === defaultModel?.defaultReasoningEffort ? ' (model default)' : ''}</option>)}
              </select>
              <p className="mt-1.5 text-xs text-muted-foreground">Effort options come from the selected model. Max and Ultra appear only when supported.</p>
            </div>
          </div>

          <details className="border" data-testid="codex-action-settings">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
              Per-action model and effort <span className="ml-2 text-xs font-normal text-muted-foreground">{actionOverrideCount ? `${actionOverrideCount} override${actionOverrideCount === 1 ? '' : 's'}` : 'Using defaults'}{staleActionOverrideCount ? ` · ${staleActionOverrideCount} need${staleActionOverrideCount === 1 ? 's' : ''} review` : ''}</span>
            </summary>
            <div className="border-t">
              {staleActionOverrideCount > 0 && <p className="border-b border-amber-500/35 bg-amber-50/40 px-4 py-3 text-xs leading-5 text-amber-900" role="status">Some saved model or effort choices are no longer in this account&apos;s catalog. Choose replacements below, or save another Codex setting to repair them with compatible defaults.</p>}
              {actionOverrideCount > 0 && <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                <p className="text-xs text-muted-foreground">Only changed actions are stored as overrides.</p>
                <Button type="button" size="sm" variant="outline" disabled={Boolean(working)} onClick={() => void resetActionOverrides()}>{working === 'reset-actions' ? <Loader2 className="animate-spin" /> : null}Reset overrides</Button>
              </div>}
              <div className="hidden grid-cols-[minmax(190px,1.2fr)_minmax(150px,1fr)_minmax(150px,1fr)] gap-4 border-b bg-muted/20 px-4 py-2 text-xs font-medium text-muted-foreground xl:grid">
                <div>Action</div><div>Model</div><div>Reasoning effort</div>
              </div>
              {state!.codex.actions.map((action, index) => {
                const override = actionOverrides[action.id];
                const actionModelId = override?.model || selectedModel;
                const savedActionModel = state!.codex.models.find((model) => model.id === actionModelId);
                const actionModelUnavailable = Boolean(override?.model && !savedActionModel);
                const actionModel = savedActionModel || defaultModel;
                const actionEfforts = effortValues(actionModel);
                const effectiveAction = state!.codex.effectiveConfiguration?.actions[action.id];
                const inheritedEffort = effectiveAction?.reasoningEffort.value
                  || state!.preference.codexReasoningEffort
                  || state!.codex.adminDefaults?.codexActionOverrides[action.id]?.reasoningEffort
                  || state!.codex.adminDefaults?.codexReasoningEffort
                  || action.defaultReasoningEffort;
                const inheritedEffortAvailable = supportsEffort(actionModel, inheritedEffort);
                const actionEffortUnavailable = Boolean(override?.reasoningEffort
                  && !override.reasoningEffortAuto
                  && !actionEfforts.includes(override.reasoningEffort));
                const automaticEffort = override?.reasoningEffortAuto
                  ? override.reasoningEffort
                  : null;
                const compatibleAutomaticEffort = supportsEffort(actionModel, automaticEffort)
                  ? automaticEffort
                  : compatibleModelDefault(actionModel);
                const controlId = action.id.replaceAll('.', '-');
                const startsGroup = index === 0 || state!.codex.actions[index - 1]?.group !== action.group;
                return <Fragment key={action.id}>
                  {startsGroup && <div className="border-b bg-muted/10 px-4 py-2 text-xs font-medium text-muted-foreground">{action.group}</div>}
                  <div className="grid gap-3 border-b px-4 py-3 last:border-b-0 xl:grid-cols-[minmax(190px,1.2fr)_minmax(150px,1fr)_minmax(150px,1fr)] xl:items-center xl:gap-4" data-testid={`codex-action-${controlId}`}>
                    <div className="min-w-0"><p className="text-sm font-medium">{action.label}</p><p className="mt-0.5 text-xs leading-5 text-muted-foreground">{action.description}</p>{effectiveAction && <p className="mt-1 text-[11px] leading-4 text-muted-foreground">Effective model: {sourceLabel(effectiveAction.model.source)} / effort: {sourceLabel(effectiveAction.reasoningEffort.source)}</p>}</div>
                    <div className="min-w-0">
                      <Label className="field-label xl:sr-only" htmlFor={`codex-action-model-${controlId}`}>Codex model for {action.label}</Label>
                      <select id={`codex-action-model-${controlId}`} value={override?.model || ''} disabled={codexConfigurationDisabled} onChange={(event) => void selectActionModel(action, event.target.value)} className={selectClassName}>
                        <option value="">Use default ({defaultModel?.displayName || 'available model'})</option>
                        {actionModelUnavailable && <option value={override!.model!}>{override!.model} (unavailable)</option>}
                        {state!.codex.models.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}
                      </select>
                    </div>
                    <div className="min-w-0">
                      <Label className="field-label xl:sr-only" htmlFor={`codex-action-effort-${controlId}`}>Reasoning effort for {action.label}</Label>
                      <select id={`codex-action-effort-${controlId}`} value={override?.reasoningEffortAuto ? '' : (override?.reasoningEffort || '')} disabled={codexConfigurationDisabled} onChange={(event) => void selectActionEffort(action, event.target.value)} className={selectClassName}>
                        <option value="">Use default ({effortLabel(inheritedEffort)}{inheritedEffortAvailable ? '' : ` unavailable; uses ${compatibleAutomaticEffort ? effortLabel(compatibleAutomaticEffort) : 'model default'}`})</option>
                        {actionEffortUnavailable && <option value={override!.reasoningEffort!}>{effortLabel(override!.reasoningEffort!)} (unavailable)</option>}
                        {actionEfforts.map((effort) => <option key={effort} value={effort}>{effortLabel(effort)}{effort === actionModel?.defaultReasoningEffort ? ' (model default)' : ''}</option>)}
                      </select>
                    </div>
                  </div>
                </Fragment>;
              })}
            </div>
          </details>
        </div>
      </div>}
    </div>}
  </section>;
}
