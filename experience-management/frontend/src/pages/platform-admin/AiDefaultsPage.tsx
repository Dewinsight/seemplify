import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, RotateCcw, Save } from 'lucide-react';
import { toast } from 'sonner';
import { usePlatformAdminAccess } from '@/components/platform-admin/PlatformAdminShell';
import { Button } from '@/components/ui/button';
import { Link } from '@/lib/router';
import { platformAdminApi, platformAdminErrorMessage, platformAdminJson } from '@/lib/platformAdminApi';
import {
  platformAdminHasPermission, type PlatformAiDefaults, type PlatformAiDefaultsState,
  type PlatformCodexActionOverride, type PlatformCodexModel
} from './types';
import { AdminError, AdminLoading, AdminPageHeader, formatAdminDate } from './shared';

const selectClassName = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60';

function effortLabel(value: string) {
  const labels: Record<string, string> = { none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max', ultra: 'Ultra' };
  return labels[value] || value.replace(/[_-]+/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function modelEfforts(model: PlatformCodexModel | undefined) {
  return [...new Set([
    ...(model?.supportedReasoningEfforts || []).map((effort) => effort.reasoningEffort),
    ...(model?.defaultReasoningEffort ? [model.defaultReasoningEffort] : [])
  ].filter(Boolean))];
}

function sameDefaults(left: PlatformAiDefaults, right: PlatformAiDefaults) {
  return left.codexModel === right.codexModel
    && left.codexReasoningEffort === right.codexReasoningEffort
    && JSON.stringify(left.codexActionOverrides) === JSON.stringify(right.codexActionOverrides)
    && JSON.stringify(left.runtimePolicy) === JSON.stringify(right.runtimePolicy);
}

function sameCodexDefaults(left: PlatformAiDefaults, right: PlatformAiDefaults) {
  return left.codexModel === right.codexModel
    && left.codexReasoningEffort === right.codexReasoningEffort
    && JSON.stringify(left.codexActionOverrides) === JSON.stringify(right.codexActionOverrides);
}

export function PlatformAdminAiDefaultsPage() {
  const access = usePlatformAdminAccess();
  const canManage = platformAdminHasPermission(access, 'ai_defaults.manage');
  const [state, setState] = useState<PlatformAiDefaultsState | null>(null);
  const [draft, setDraft] = useState<PlatformAiDefaults | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [working, setWorking] = useState('');

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await platformAdminApi<PlatformAiDefaultsState>('/api/platform-admin/ai-defaults');
      setState(next);
      setDraft(next.defaults);
      setError('');
    } catch (cause) {
      setError(platformAdminErrorMessage(cause, 'Could not load platform AI defaults.'));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const connectedDefaultModel = useMemo(() => state?.codex.models.find((model) => model.isDefault) || state?.codex.models[0], [state]);
  const defaultModel = state?.codex.models.find((model) => model.id === draft?.codexModel) || connectedDefaultModel;
  const defaultEfforts = modelEfforts(defaultModel);
  const defaultModelUnavailable = Boolean(draft?.codexModel && !state?.codex.models.some((model) => model.id === draft.codexModel));
  const defaultEffortUnavailable = Boolean(draft?.codexReasoningEffort && !defaultEfforts.includes(draft.codexReasoningEffort));
  const staleActionCount = state?.codex.actions.filter((action) => {
    const override = draft?.codexActionOverrides[action.id];
    if (!override) return false;
    const model = override.model ? state.codex.models.find((item) => item.id === override.model) : defaultModel;
    const efforts = modelEfforts(model);
    return Boolean((override.model && !model)
      || (override.reasoningEffort && !override.reasoningEffortAuto && !efforts.includes(override.reasoningEffort)));
  }).length || 0;
  const hasExplicitDefaults = Boolean(draft && (draft.codexModel || draft.codexReasoningEffort || Object.values(draft.codexActionOverrides).some((override) => (
    override.model || (override.reasoningEffort && !override.reasoningEffortAuto)
  )) || !draft.runtimePolicy.chatgptEnabled));
  const changed = Boolean(state && draft && !sameDefaults(state.defaults, draft));
  const codexChanged = Boolean(state && draft && !sameCodexDefaults(state.defaults, draft));
  const codexControlsDisabled = !canManage || !state?.codex.account.connected || !state.codex.models.length
    || !draft?.runtimePolicy.chatgptEnabled || Boolean(working);
  const saveDisabled = !canManage || !changed || Boolean(working)
    || Boolean(codexChanged && (!state?.codex.account.connected || !state.codex.models.length));

  function changeDefaultModel(modelId: string) {
    if (!state || !draft) return;
    const model = state.codex.models.find((item) => item.id === modelId) || connectedDefaultModel;
    const supported = modelEfforts(model);
    const effort = draft.codexReasoningEffort && supported.includes(draft.codexReasoningEffort)
      ? draft.codexReasoningEffort
      : null;
    setDraft({ ...draft, codexModel: modelId || null, codexReasoningEffort: effort });
  }

  function changeAction(actionId: string, patch: Partial<PlatformCodexActionOverride>) {
    if (!draft) return;
    const current = draft.codexActionOverrides[actionId] || { model: null, reasoningEffort: null };
    const next = { ...current, ...patch };
    const overrides = { ...draft.codexActionOverrides };
    if (!next.model && !next.reasoningEffort) delete overrides[actionId];
    else overrides[actionId] = next;
    setDraft({ ...draft, codexActionOverrides: overrides });
  }

  async function save() {
    if (!draft || saveDisabled) return;
    setWorking('save');
    try {
      const codex = state?.codex.account.connected ? {
        codexModel: draft.codexModel,
        codexReasoningEffort: draft.codexReasoningEffort,
        codexActionOverrides: draft.codexActionOverrides
      } : {};
      const next = await platformAdminApi<PlatformAiDefaultsState>('/api/platform-admin/ai-defaults', platformAdminJson('PUT', {
        ...codex, runtimePolicy: draft.runtimePolicy
      }));
      setState(next); setDraft(next.defaults);
      toast.success('Platform Codex defaults saved.');
    } catch (cause) {
      toast.error(platformAdminErrorMessage(cause, 'Could not save platform AI defaults.'));
    } finally {
      setWorking('');
    }
  }

  async function reset() {
    if (!canManage || working || !window.confirm('Reset the platform runtime policy and every Codex default?')) return;
    setWorking('reset');
    try {
      const value = await platformAdminApi<{ defaults: PlatformAiDefaults }>('/api/platform-admin/ai-defaults', { method: 'DELETE' });
      setState((current) => current ? { ...current, defaults: value.defaults } : current);
      setDraft(value.defaults);
      toast.success('Platform AI defaults reset.');
    } catch (cause) {
      toast.error(platformAdminErrorMessage(cause, 'Could not clear platform AI defaults.'));
    } finally {
      setWorking('');
    }
  }

  return <div className="space-y-6" data-testid="platform-admin-ai-defaults">
    <AdminPageHeader title="AI defaults" description="Platform-level ChatGPT / Codex model and effort defaults inherited by spaces without their own choices." actions={<Button size="sm" variant="outline" disabled={refreshing} onClick={() => void load()}><RefreshCw className={refreshing ? 'animate-spin' : ''} />Refresh</Button>} />
    {error && <AdminError message={error} onRetry={() => void load()} />}
    {!state || !draft ? !error && <AdminLoading label="Loading platform AI defaults..." /> : <>
      {!state.codex.account.connected && <div className="flex flex-col justify-between gap-3 border border-amber-500/35 bg-card p-4 text-sm sm:flex-row sm:items-center" role="status"><div><p className="font-medium text-amber-900">Connect ChatGPT before changing platform defaults</p><p className="mt-1 text-xs leading-5 text-muted-foreground">The available model and effort catalog comes from the administrator&apos;s connected ChatGPT account.</p></div><Button asChild size="sm" variant="outline"><Link to="/settings/space">Open AI runtime settings</Link></Button></div>}
      {state.codex.error && <AdminError message={`Codex catalog unavailable: ${state.codex.error}`} onRetry={() => void load()} />}
      <section className="rounded-lg border bg-card" aria-labelledby="platform-runtime-policy-heading"><div className="flex flex-col justify-between gap-3 border-b px-5 py-4 sm:flex-row sm:items-start"><div><h2 id="platform-runtime-policy-heading" className="section-title">Connected ChatGPT availability</h2><p className="mt-1 text-xs text-muted-foreground">{draft.updatedAt ? `Last changed ${formatAdminDate(draft.updatedAt)}` : 'ChatGPT is the platform AI runtime.'}</p></div>{canManage && <div className="flex gap-2"><Button size="sm" variant="outline" disabled={Boolean(working) || !hasExplicitDefaults} onClick={() => void reset()}>{working === 'reset' ? <Loader2 className="animate-spin" /> : <RotateCcw />}Reset</Button><Button size="sm" disabled={saveDisabled} onClick={() => void save()}>{working === 'save' ? <Loader2 className="animate-spin" /> : <Save />}Save policy</Button></div>}</div><div className="p-5"><label className="flex items-start gap-3 border p-4 text-sm"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-foreground" checked={draft.runtimePolicy.chatgptEnabled} disabled={!canManage || Boolean(working)} onChange={(event) => setDraft({ ...draft, runtimePolicy: { chatgptEnabled: event.target.checked, defaultRuntime: 'chatgpt' } })} /><span><span className="font-medium">ChatGPT / Codex</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">The only supported generative-AI runtime. Disabling it pauses all new AI actions.</span></span></label></div>{!draft.runtimePolicy.chatgptEnabled && <p className="border-t border-amber-500/35 bg-amber-50/40 px-5 py-3 text-xs leading-5 text-amber-900" role="alert">Connected ChatGPT is off. New AI actions are blocked until an administrator enables it.</p>}</section>
      <section className="rounded-lg border bg-card" aria-labelledby="platform-ai-default-heading"><div className="border-b px-5 py-4"><h2 id="platform-ai-default-heading" className="section-title">Codex defaults</h2><p className="mt-1 text-xs text-muted-foreground">Model and effort settings apply only when ChatGPT / Codex is enabled.</p></div>{(defaultModelUnavailable || defaultEffortUnavailable || staleActionCount > 0) && <p className="border-b border-amber-500/35 bg-amber-50/40 px-5 py-3 text-xs leading-5 text-amber-900" role="status">{defaultModelUnavailable || defaultEffortUnavailable ? 'A saved platform model or effort is no longer available to this ChatGPT account. ' : ''}{staleActionCount > 0 ? `${staleActionCount} action setting${staleActionCount === 1 ? '' : 's'} also need review. ` : ''}Choose available replacements below or reset the platform defaults.</p>}<div className="grid gap-4 p-5 sm:grid-cols-2"><div><label className="field-label" htmlFor="platform-codex-model">Default Codex model</label><select id="platform-codex-model" value={draft.codexModel || ''} disabled={codexControlsDisabled} onChange={(event) => changeDefaultModel(event.target.value)} className={selectClassName}><option value="">Connected account default{connectedDefaultModel ? ` (${connectedDefaultModel.displayName})` : ''}</option>{defaultModelUnavailable && <option value={draft.codexModel!}>{draft.codexModel} (unavailable)</option>}{state.codex.models.map((model) => <option value={model.id} key={model.id}>{model.displayName}{model.isDefault ? ' (account default)' : ''}</option>)}</select></div><div><label className="field-label" htmlFor="platform-codex-effort">Default reasoning effort</label><select id="platform-codex-effort" value={draft.codexReasoningEffort || ''} disabled={codexControlsDisabled} onChange={(event) => setDraft({ ...draft, codexReasoningEffort: event.target.value || null })} className={selectClassName}><option value="">Use each action&apos;s default</option>{defaultEffortUnavailable && <option value={draft.codexReasoningEffort!}>{effortLabel(draft.codexReasoningEffort!)} (unavailable)</option>}{defaultEfforts.map((effort) => <option value={effort} key={effort}>{effortLabel(effort)}{effort === defaultModel?.defaultReasoningEffort ? ' (model default)' : ''}</option>)}</select></div></div></section>
      <section className="overflow-hidden rounded-lg border bg-card" aria-labelledby="platform-action-default-heading"><div className="border-b px-5 py-4"><h2 id="platform-action-default-heading" className="section-title">Per-action defaults</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Action overrides are inherited only when a user has not selected their own action model or effort.</p></div><div className="hidden grid-cols-[minmax(220px,1.2fr)_minmax(170px,1fr)_minmax(170px,1fr)] gap-4 border-b bg-muted/20 px-5 py-2 text-xs font-medium text-muted-foreground xl:grid"><div>Action</div><div>Model</div><div>Reasoning effort</div></div>{state.codex.actions.map((action, index) => {
        const override = draft.codexActionOverrides[action.id];
        const savedActionModel = state.codex.models.find((model) => model.id === override?.model);
        const actionModelUnavailable = Boolean(override?.model && !savedActionModel);
        const actionModel = savedActionModel || defaultModel;
        const efforts = modelEfforts(actionModel);
        const inheritedEffort = draft.codexReasoningEffort || action.defaultReasoningEffort;
        const inheritedAvailable = efforts.includes(inheritedEffort);
        const automaticEffort = override?.reasoningEffortAuto && override.reasoningEffort && efforts.includes(override.reasoningEffort)
          ? override.reasoningEffort
          : (actionModel?.defaultReasoningEffort && efforts.includes(actionModel.defaultReasoningEffort) ? actionModel.defaultReasoningEffort : efforts[0]);
        const explicitEffortUnavailable = Boolean(override?.reasoningEffort && !override.reasoningEffortAuto && !efforts.includes(override.reasoningEffort));
        const startsGroup = index === 0 || state.codex.actions[index - 1]?.group !== action.group;
        const controlId = action.id.replaceAll('.', '-');
        return <Fragment key={action.id}>{startsGroup && <div className="border-b bg-muted/10 px-5 py-2 text-xs font-medium text-muted-foreground">{action.group}</div>}<div className="grid gap-3 border-b px-5 py-4 last:border-b-0 xl:grid-cols-[minmax(220px,1.2fr)_minmax(170px,1fr)_minmax(170px,1fr)] xl:items-center xl:gap-4" data-testid={`platform-ai-action-${controlId}`}><div><p className="text-sm font-medium">{action.label}</p><p className="mt-0.5 text-xs leading-5 text-muted-foreground">{action.description}</p></div><div><label className="field-label xl:sr-only" htmlFor={`platform-action-model-${controlId}`}>Model for {action.label}</label><select id={`platform-action-model-${controlId}`} value={override?.model || ''} disabled={codexControlsDisabled} onChange={(event) => changeAction(action.id, { model: event.target.value || null, reasoningEffort: null })} className={selectClassName}><option value="">Use platform default ({defaultModel?.displayName || 'account default'})</option>{actionModelUnavailable && <option value={override!.model!}>{override!.model} (unavailable)</option>}{state.codex.models.map((model) => <option value={model.id} key={model.id}>{model.displayName}</option>)}</select></div><div><label className="field-label xl:sr-only" htmlFor={`platform-action-effort-${controlId}`}>Effort for {action.label}</label><select id={`platform-action-effort-${controlId}`} value={override?.reasoningEffortAuto ? '' : (override?.reasoningEffort || '')} disabled={codexControlsDisabled} onChange={(event) => changeAction(action.id, { reasoningEffort: event.target.value || null, reasoningEffortAuto: undefined })} className={selectClassName}><option value="">Use inherited default ({effortLabel(inheritedEffort)}{inheritedAvailable ? '' : ` unavailable; uses ${automaticEffort ? effortLabel(automaticEffort) : 'model default'}`})</option>{explicitEffortUnavailable && <option value={override!.reasoningEffort!}>{effortLabel(override!.reasoningEffort!)} (unavailable)</option>}{efforts.map((effort) => <option value={effort} key={effort}>{effortLabel(effort)}{effort === actionModel?.defaultReasoningEffort ? ' (model default)' : ''}</option>)}</select></div></div></Fragment>;
      })}</section>
    </>}
  </div>;
}
