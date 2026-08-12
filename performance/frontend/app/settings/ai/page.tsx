'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, Bot, Check, Copy, ExternalLink, Loader2, RefreshCw, RotateCcw, Save, Unplug
} from 'lucide-react';
import {
  aiAccount, aiErrorMessage, supportedEfforts, type AIAccountState,
  type AIActivityPreference, type AIDeviceLogin, type AIPreferences, type AIReasoningEffort
} from '@/lib/aiAccount';

const INHERIT = '__inherit__';
const POLL_MS = 2000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;
const EFFORT_LABEL: Record<AIReasoningEffort, string> = {
  none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High',
  xhigh: 'Extra high', max: 'Maximum', ultra: 'Ultra'
};

type Draft = { codexModel: string; reasoningEffort: string };

function sourceLabel(source?: string) {
  return ({
    activity_override: 'Your action override',
    account_default: 'Your account default',
    admin_default: 'Workspace default',
    app_default: 'Performance default'
  } as Record<string, string>)[String(source || '')] || 'Inherited';
}

function usageWindowLabel(minutes: number | null) {
  if (!minutes) return 'Usage window';
  if (minutes < 60) return `${minutes} minute window`;
  if (minutes === 60) return 'Hourly window';
  if (minutes % 1440 === 0) return `${minutes / 1440} day window`;
  return `${Math.round(minutes / 60)} hour window`;
}

function effortLabel(effort: AIReasoningEffort | null | undefined) {
  return effort ? EFFORT_LABEL[effort] : 'Use workspace default';
}

function modelLabel(model: string | null | undefined) {
  return model || "Use each action's workspace default";
}

function retryAfterSeconds(reason: unknown) {
  return Math.max(0, Number((reason as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds) || 0);
}

function timestampLabel(value: string | null | undefined, empty: string) {
  if (!value) return empty;
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return 'Timestamp unavailable';
  return timestamp.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });
}

function inheritedSetting(preference: AIActivityPreference) {
  return {
    codexModel: preference.accountDefault?.codexModel || preference.adminDefault.codexModel,
    reasoningEffort: preference.accountDefault?.reasoningEffort || preference.adminDefault.reasoningEffort
  };
}

function modelDraft(
  draft: Draft,
  nextModel: string,
  models: AIPreferences['models'],
  inheritedModel: string | null
) {
  const selected = models.find((model) => model.id === (nextModel === INHERIT ? inheritedModel : nextModel));
  const validEfforts = supportedEfforts(selected);
  const reasoningEffort = draft.reasoningEffort === INHERIT
    || validEfforts.includes(draft.reasoningEffort as AIReasoningEffort)
    ? draft.reasoningEffort
    : INHERIT;
  return { codexModel: nextModel, reasoningEffort };
}

function PreferenceRow({
  preference, models, draft, busy, onDraft, onSave, onReset
}: {
  preference: AIActivityPreference;
  models: AIPreferences['models'];
  draft: Draft;
  busy: boolean;
  onDraft: (draft: Draft) => void;
  onSave: () => void;
  onReset: () => void;
}) {
  const inherited = inheritedSetting(preference);
  const selectedModel = models.find((model) => model.id === (
    draft.codexModel === INHERIT ? inherited.codexModel : draft.codexModel
  ));
  const efforts = supportedEfforts(selectedModel);
  const unavailableSavedModel = draft.codexModel !== INHERIT
    && !models.some((model) => model.id === draft.codexModel);
  const unsupportedSavedEffort = draft.reasoningEffort !== INHERIT
    && !efforts.includes(draft.reasoningEffort as AIReasoningEffort);
  const disabled = busy || !preference.enabled || models.length === 0;
  return (
    <tr className="border-t border-[var(--suite-line)] align-top">
      <td className="px-4 py-4">
        <p className="text-sm font-semibold text-[var(--suite-ink)]">{preference.label}</p>
        <p className="mt-1 text-xs text-[var(--suite-muted)]">{preference.activity}</p>
        {!preference.enabled && <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300">Disabled by an administrator</p>}
      </td>
      <td className="px-4 py-4">
        <label className="sr-only" htmlFor={`${preference.activity}-model`}>Model for {preference.label}</label>
        <select
          id={`${preference.activity}-model`}
          className="h-10 w-full rounded-lg border border-[var(--suite-line-strong)] bg-[var(--suite-surface)] px-3 text-sm text-[var(--suite-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--suite-accent)]"
          value={draft.codexModel}
          disabled={disabled}
          onChange={(event) => onDraft(modelDraft(draft, event.target.value, models, inherited.codexModel))}
        >
          <option value={INHERIT}>Use inherited default ({modelLabel(inherited.codexModel)})</option>
          {unavailableSavedModel && <option value={draft.codexModel}>{draft.codexModel} (saved; unavailable)</option>}
          {models.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}
        </select>
        <p className="mt-1 text-xs text-[var(--suite-subtle)]">{sourceLabel(preference.provenance.codexModel)}</p>
      </td>
      <td className="px-4 py-4">
        <label className="sr-only" htmlFor={`${preference.activity}-effort`}>Reasoning for {preference.label}</label>
        <select
          id={`${preference.activity}-effort`}
          className="h-10 w-full rounded-lg border border-[var(--suite-line-strong)] bg-[var(--suite-surface)] px-3 text-sm text-[var(--suite-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--suite-accent)]"
          value={draft.reasoningEffort}
          disabled={disabled}
          onChange={(event) => onDraft({ ...draft, reasoningEffort: event.target.value })}
        >
          <option value={INHERIT}>Use inherited default ({effortLabel(inherited.reasoningEffort)})</option>
          {unsupportedSavedEffort && <option value={draft.reasoningEffort}>{effortLabel(draft.reasoningEffort as AIReasoningEffort)} (saved; unsupported by selected model)</option>}
          {efforts.map((effort) => <option key={effort} value={effort}>{effortLabel(effort)}</option>)}
        </select>
        <p className="mt-1 text-xs text-[var(--suite-subtle)]">{sourceLabel(preference.provenance.reasoningEffort)}</p>
      </td>
      <td className="px-4 py-4">
        <div className="flex gap-2">
          <button className="suite-button-secondary inline-flex h-10 items-center gap-2 border px-3" disabled={disabled} onClick={onSave} type="button">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save
          </button>
          {(preference.override.codexModel || preference.override.reasoningEffort) && (
            <button className="inline-flex h-10 items-center gap-2 rounded-lg px-2 text-sm text-[var(--suite-muted)] hover:text-[var(--suite-ink)]" disabled={disabled} onClick={onReset} type="button">
              <RotateCcw className="h-4 w-4" />Reset
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function AISettingsPage() {
  const [state, setState] = useState<AIAccountState | null>(null);
  const [preferences, setPreferences] = useState<AIPreferences | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [defaultDraft, setDefaultDraft] = useState<Draft>({ codexModel: INHERIT, reasoningEffort: INHERIT });
  const [deviceLogin, setDeviceLogin] = useState<AIDeviceLogin | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const pollRef = useRef<number | null>(null);
  const pollDeadlineRef = useRef(0);
  const autoConnectRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const codeInputRef = useRef<HTMLInputElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!cooldownUntil) return;
    const tick = () => {
      const left = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
      setCooldownLeft(left);
      if (left === 0) setCooldownUntil(0);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownUntil]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  const applyPreferences = useCallback((next: AIPreferences) => {
    setPreferences(next);
    setDefaultDraft({
      codexModel: next.defaults.override.codexModel || INHERIT,
      reasoningEffort: next.defaults.override.reasoningEffort || INHERIT
    });
    setDrafts(Object.fromEntries(next.activities.map((activity) => [activity.activity, {
      codexModel: activity.override.codexModel || INHERIT,
      reasoningEffort: activity.override.reasoningEffort || INHERIT
    }])));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await aiAccount.read();
      setState(next);
      setError(next.account.lastError || '');
      if (next.account.status === 'connected') {
        applyPreferences(next.preferences || await aiAccount.preferences());
      } else {
        setPreferences(null);
      }
      return next;
    } catch (reason: unknown) {
      setError(aiErrorMessage(reason, 'Your AI account could not be checked.'));
      return null;
    } finally { setLoading(false); }
  }, [applyPreferences]);

  useEffect(() => { void refresh(); return stopPolling; }, [refresh, stopPolling]);

  const beginPolling = useCallback(() => {
    stopPolling();
    pollRef.current = window.setInterval(async () => {
      if (Date.now() >= pollDeadlineRef.current) {
        stopPolling();
        setDeviceLogin(null);
        setError('OpenAI sign-in timed out. Your account was not changed; start again when you are ready.');
        return;
      }
      const next = await refresh();
      if (next?.account.status === 'error') {
        const failure = next.account.lastError || 'OpenAI sign-in failed. Start again to receive a new code.';
        stopPolling();
        setDeviceLogin(null);
        try {
          const reset = await aiAccount.resetLogin();
          setState((current) => current ? { ...current, account: reset.account } : current);
        } catch {
          // Preserve the original sign-in failure; the manual reset action
          // remains available if the cleanup request also fails.
        }
        setError(failure);
        return;
      }
      if (next?.account.status !== 'connected') return;
      stopPolling();
      setDeviceLogin(null);
    }, POLL_MS);
  }, [refresh, stopPolling]);

  const connect = useCallback(async () => {
    if (working || cooldownLeft > 0) return;
    setWorking('connect'); setError('');
    try {
      if (state?.account.status === 'pending' || state?.account.status === 'error') {
        const reset = await aiAccount.resetLogin();
        setState((current) => current ? { ...current, account: reset.account } : current);
        setDeviceLogin(null);
      }
      const result = await aiAccount.startLogin();
      setState((current) => current ? { ...current, account: result.account } : current);
      if (result.login.connected) { await refresh(); return; }
      restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      pollDeadlineRef.current = Date.now() + POLL_TIMEOUT_MS;
      setDeviceLogin(result.login); setCopied(false); setCopyError(''); beginPolling();
    } catch (reason: unknown) {
      const wait = retryAfterSeconds(reason);
      if (wait > 0) setCooldownUntil(Date.now() + wait * 1000);
      setDeviceLogin(null);
      try {
        const reset = await aiAccount.resetLogin();
        setState((current) => current ? { ...current, account: reset.account } : current);
      } catch {
        // Do not replace the useful gateway error with a cleanup failure.
      }
      setError(aiErrorMessage(reason, wait > 0
        ? 'Too many sign-in attempts. Wait before trying again.'
        : 'ChatGPT sign-in could not be started.'));
    }
    finally { setWorking(''); }
  }, [beginPolling, cooldownLeft, refresh, state?.account.status, working]);

  useEffect(() => {
    if (autoConnectRef.current || loading || !state) return;
    if (new URLSearchParams(window.location.search).get('connect') !== '1') return;
    autoConnectRef.current = true;
    if (state.account.status !== 'connected') void connect();
  }, [connect, loading, state]);

  const groups = useMemo(() => {
    const map = new Map<string, AIActivityPreference[]>();
    (preferences?.activities || []).forEach((activity) => map.set(activity.group || 'Performance', [...(map.get(activity.group || 'Performance') || []), activity]));
    return [...map.entries()];
  }, [preferences]);

  async function setRuntime(runtimePreference: 'default' | 'local' | 'chatgpt') {
    setWorking('runtime'); setError('');
    try {
      await aiAccount.setRuntime(runtimePreference);
      await refresh();
    } catch (reason: unknown) { setError(aiErrorMessage(reason, 'Your AI runtime could not be changed.')); }
    finally { setWorking(''); }
  }

  async function savePreference(scope: 'default' | 'activity', activity: string | null, draft: Draft) {
    const key = activity || 'default'; setWorking(`preference:${key}`); setError('');
    try {
      applyPreferences(await aiAccount.savePreference(scope, activity, {
        codexModel: draft.codexModel === INHERIT ? null : draft.codexModel,
        reasoningEffort: draft.reasoningEffort === INHERIT ? null : draft.reasoningEffort as AIReasoningEffort
      }));
    } catch (reason: unknown) { setError(aiErrorMessage(reason, 'The AI setting could not be saved.')); }
    finally { setWorking(''); }
  }

  async function resetPreference(scope: 'default' | 'activity', activity: string | null) {
    const key = activity || 'default'; setWorking(`preference:${key}`); setError('');
    try { applyPreferences(await aiAccount.deletePreference(scope, activity)); }
    catch (reason: unknown) { setError(aiErrorMessage(reason, 'The AI setting could not be reset.')); }
    finally { setWorking(''); }
  }

  async function setConsent(acknowledged: boolean) {
    setWorking('consent'); setError('');
    try {
      const result = await aiAccount.consent(acknowledged);
      setState((current) => current ? { ...current, account: result.account } : current);
    } catch (reason: unknown) { setError(aiErrorMessage(reason, 'Your consent choice could not be saved.')); }
    finally { setWorking(''); }
  }

  async function disconnect() {
    if (!window.confirm('Disconnect this ChatGPT account from every Seemplify app?')) return;
    setWorking('disconnect'); setError('');
    try {
      const result = await aiAccount.disconnect();
      setState((current) => current ? { ...current, account: result.account } : current);
      setPreferences(null);
    } catch (reason: unknown) { setError(aiErrorMessage(reason, 'ChatGPT could not be disconnected.')); }
    finally { setWorking(''); }
  }

  const cancelLogin = useCallback(async () => {
    stopPolling(); setWorking('cancel');
    try { await aiAccount.cancelLogin(); setDeviceLogin(null); await refresh(); }
    catch (reason: unknown) { setError(aiErrorMessage(reason, 'The sign-in could not be cancelled.')); }
    finally { setWorking(''); }
  }, [refresh, stopPolling]);

  async function resetLogin() {
    stopPolling(); setWorking('reset');
    try { await aiAccount.resetLogin(); setDeviceLogin(null); setError(''); await refresh(); }
    catch (reason: unknown) { setError(aiErrorMessage(reason, 'The sign-in could not be reset.')); }
    finally { setWorking(''); }
  }

  useEffect(() => {
    if (!deviceLogin) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => codeInputRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        void cancelLogin();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = originalOverflow;
      restoreFocusRef.current?.focus();
    };
  }, [cancelLogin, deviceLogin]);

  const account = state?.account;
  const connected = account?.status === 'connected';
  const consented = Boolean(account?.dataSharingAcknowledgedAt);
  const defaultModel = preferences?.models.find((model) => model.id === (defaultDraft.codexModel === INHERIT ? preferences.defaults.effective.codexModel : defaultDraft.codexModel));
  const cooling = cooldownLeft > 0;
  const countdown = `${Math.floor(cooldownLeft / 60)}:${String(cooldownLeft % 60).padStart(2, '0')}`;
  const usageWindows = [account?.rateLimits?.primary, account?.rateLimits?.secondary].filter(Boolean);
  const usageObservedAt = account?.usage?.observedAt || account?.rateLimits?.capturedAt || null;
  const defaultModelUnavailable = Boolean(defaultDraft.codexModel !== INHERIT
    && preferences
    && !preferences.models.some((model) => model.id === defaultDraft.codexModel));
  const defaultEfforts = supportedEfforts(defaultModel);
  const defaultEffortUnsupported = defaultDraft.reasoningEffort !== INHERIT
    && !defaultEfforts.includes(defaultDraft.reasoningEffort as AIReasoningEffort);
  const defaultControlsDisabled = working === 'preference:default' || !preferences?.models.length;

  return (
    <div className="space-y-8 pb-12">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--suite-ink)]">AI and ChatGPT</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--suite-muted)]">One ChatGPT connection is shared with Recruiter. Choose the runtime and override the model or reasoning effort for each Performance action.</p>
      </header>

      {error && <div className="suite-notice flex items-start gap-2 border p-4 text-sm text-red-600 dark:text-red-300" role="alert"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}

      <section className="suite-panel border p-5" aria-labelledby="connection-heading">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="suite-icon flex items-center justify-center border"><Bot className="h-5 w-5" /></div>
            <div>
              <h2 id="connection-heading" className="suite-card-title">ChatGPT connection</h2>
              <p className="mt-1 text-sm text-[var(--suite-muted)]">{connected ? `${account?.connectedEmail || 'Your account'}${account?.planType ? ` - ${account.planType}` : ''}` : 'Connect once for Seemplify Recruiter, Performance, and Workspace.'}</p>
            </div>
          </div>
          <span className="suite-status border px-2.5 py-1 text-xs font-medium">{loading ? 'Checking' : connected && !consented ? 'Review required' : connected ? 'Connected' : account?.status === 'pending' ? 'Waiting for sign-in' : 'Not connected'}</span>
        </div>
        <div className="mt-5 flex flex-wrap gap-2 border-t border-[var(--suite-line)] pt-5">
          {!connected && <button className="suite-button inline-flex items-center gap-2 px-4" disabled={Boolean(working) || cooling} onClick={() => void connect()} type="button">{working === 'connect' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}{cooling ? `Try again in ${countdown}` : 'Sign in with OpenAI'}</button>}
          <button className="suite-button-secondary inline-flex items-center gap-2 border px-4" disabled={Boolean(working)} onClick={() => void refresh()} type="button"><RefreshCw className="h-4 w-4" />Refresh</button>
          {!connected && (account?.status === 'pending' || account?.lastError || error) && <button className="suite-button-secondary inline-flex items-center gap-2 border px-4" disabled={Boolean(working)} onClick={() => void resetLogin()} type="button"><RotateCcw className="h-4 w-4" />Reset sign-in</button>}
          {connected && <button className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm text-red-600 hover:bg-red-500/5 dark:text-red-300" disabled={Boolean(working)} onClick={() => void disconnect()} type="button"><Unplug className="h-4 w-4" />Disconnect everywhere</button>}
        </div>
        {cooling && <p className="mt-3 text-sm font-medium tabular-nums text-amber-700 dark:text-amber-300" role="status">OpenAI sign-in can be tried again in {countdown}.</p>}
        {connected && (
          <label className="mt-5 flex max-w-3xl items-start gap-3 border-t border-[var(--suite-line)] pt-5 text-sm text-[var(--suite-ink)]">
            <input className="mt-1 h-4 w-4 accent-[var(--suite-accent)]" type="checkbox" checked={Boolean(account?.dataSharingAcknowledgedAt)} disabled={working === 'consent'} onChange={(event) => void setConsent(event.target.checked)} />
            <span>Allow Performance Management AI task content to be processed by OpenAI on my connected account.<span className="mt-1 block text-xs leading-5 text-[var(--suite-muted)]">This acknowledgement applies only to Performance Management. Recruiter and Workspace ask separately. Content is sent only when you run an AI action.</span></span>
          </label>
        )}
        {connected && !consented && (
          <p className="mt-4 flex items-start gap-2 border-t border-[var(--suite-line)] pt-4 text-sm text-amber-700 dark:text-amber-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />Review the acknowledgement above before running ChatGPT actions. It is never accepted automatically.
          </p>
        )}
      </section>

      {state && (state.runtimePolicy.localEnabled || state.runtimePolicy.chatgptEnabled) && (
        <section className="suite-panel border p-5" aria-labelledby="runtime-heading">
          <h2 id="runtime-heading" className="suite-card-title">AI runtime</h2>
          <p className="mt-1 text-sm text-[var(--suite-muted)]">Local inference follows Control Center. ChatGPT uses the account above.</p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap" role="group" aria-label="AI runtime preference">
            {(['default', 'local', 'chatgpt'] as const).map((runtime) => {
              const disabled = (runtime === 'local' && !state.runtimePolicy.localEnabled) || (runtime === 'chatgpt' && !state.runtimePolicy.chatgptEnabled);
              const selected = state.runtimePreference === runtime;
              return <button key={runtime} aria-pressed={selected} className={`${selected ? 'suite-button' : 'suite-button-secondary border'} w-full whitespace-normal px-4 text-left sm:w-auto sm:text-center`} disabled={disabled || working === 'runtime'} onClick={() => void setRuntime(runtime)} type="button">{runtime === 'default' ? `Workspace default (${state.runtimePolicy.defaultRuntime === 'local' ? 'Local' : 'ChatGPT'})` : runtime === 'local' ? 'Local inference' : 'ChatGPT'}</button>;
            })}
          </div>
        </section>
      )}

      {connected && (
        <section className="suite-panel border p-5" aria-labelledby="usage-heading">
          <h2 id="usage-heading" className="suite-card-title">ChatGPT plan limits</h2>
          <p className="mt-1 text-xs text-[var(--suite-subtle)]" data-testid="ai-usage-observed-at">
            {usageObservedAt
              ? `Last reported ${timestampLabel(usageObservedAt, 'No usage snapshot has been reported yet')}`
              : 'No usage snapshot has been reported yet'}
          </p>
          {usageWindows.length > 0 ? (
            <div className="mt-4 divide-y divide-[var(--suite-line)] border-y border-[var(--suite-line)]">
              {usageWindows.map((window, index) => (
                <div className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm" key={index}>
                  <span className="text-[var(--suite-muted)]">{usageWindowLabel(window!.windowMinutes)}</span>
                  <span className="font-semibold tabular-nums text-[var(--suite-ink)]">{window!.usedPercent == null ? 'Usage not reported' : `${Math.round(window!.usedPercent)}% used`}</span>
                  <span className="w-full text-xs text-[var(--suite-subtle)] sm:w-auto">{window!.resetsAt ? `Resets ${timestampLabel(window!.resetsAt, 'Reset time unavailable')}` : 'Reset time unavailable'}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm leading-6 text-[var(--suite-muted)]" data-testid="ai-usage-no-estimate">
              OpenAI has not reported a usage window for this connection. Performance Management does not estimate a quota.
            </p>
          )}
          {account?.usageLimit?.message && (
            <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">
              {account.usageLimit.message}
              <span className="mt-1 block text-xs opacity-80">Recorded {timestampLabel(account.usageLimit.at, 'time unavailable')}</span>
            </p>
          )}
        </section>
      )}

      {connected && preferences && (
        <section className="suite-panel overflow-hidden border" aria-labelledby="models-heading">
          <div className="p-5">
            <h2 id="models-heading" className="suite-card-title">Model settings</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--suite-muted)]">The account default below is shared across Recruiter and Performance Management. Action overrides in this table apply only to Performance Management. Reset any choice to inherit again.</p>
            <div className="mt-5 grid gap-4 border-t border-[var(--suite-line)] pt-5 md:grid-cols-[minmax(220px,1fr)_minmax(180px,.65fr)_auto] md:items-end">
              <label className="text-sm font-medium text-[var(--suite-ink)]">Shared account default model
                <select className="mt-2 h-10 w-full rounded-lg border border-[var(--suite-line-strong)] bg-[var(--suite-surface)] px-3 font-normal" value={defaultDraft.codexModel} disabled={defaultControlsDisabled} onChange={(event) => setDefaultDraft(modelDraft(defaultDraft, event.target.value, preferences.models, preferences.defaults.effective.codexModel))}>
                  <option value={INHERIT}>Use each action&apos;s workspace default</option>
                  {defaultModelUnavailable && <option value={defaultDraft.codexModel}>{defaultDraft.codexModel} (saved; unavailable)</option>}
                  {preferences.models.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium text-[var(--suite-ink)]">Shared account default reasoning
                <select className="mt-2 h-10 w-full rounded-lg border border-[var(--suite-line-strong)] bg-[var(--suite-surface)] px-3 font-normal" value={defaultDraft.reasoningEffort} disabled={defaultControlsDisabled} onChange={(event) => setDefaultDraft({ ...defaultDraft, reasoningEffort: event.target.value })}>
                  <option value={INHERIT}>Use each action&apos;s workspace default</option>
                  {defaultEffortUnsupported && <option value={defaultDraft.reasoningEffort}>{effortLabel(defaultDraft.reasoningEffort as AIReasoningEffort)} (saved; unsupported by selected model)</option>}
                  {defaultEfforts.map((effort) => <option key={effort} value={effort}>{effortLabel(effort)}</option>)}
                </select>
              </label>
              <div className="flex gap-2">
                <button className="suite-button-secondary inline-flex h-10 items-center gap-2 border px-3" disabled={defaultControlsDisabled} onClick={() => void savePreference('default', null, defaultDraft)} type="button"><Save className="h-4 w-4" />Save shared default</button>
                {(preferences.defaults.override.codexModel || preferences.defaults.override.reasoningEffort) && <button className="inline-flex h-10 items-center gap-2 rounded-lg px-2 text-sm text-[var(--suite-muted)]" disabled={defaultControlsDisabled} onClick={() => void resetPreference('default', null)} type="button"><RotateCcw className="h-4 w-4" />Reset</button>}
              </div>
            </div>
          </div>
          {groups.map(([group, activities]) => (
            <div className="border-t border-[var(--suite-line)]" key={group}>
              <h3 className="px-5 py-3 text-sm font-semibold text-[var(--suite-ink)]">{group}</h3>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] table-fixed text-left">
                  <thead className="bg-[var(--suite-surface-muted)] text-xs text-[var(--suite-muted)]"><tr><th className="w-[28%] px-4 py-3 font-medium">Action</th><th className="w-[28%] px-4 py-3 font-medium">Model</th><th className="w-[24%] px-4 py-3 font-medium">Reasoning</th><th className="w-[20%] px-4 py-3 font-medium"> </th></tr></thead>
                  <tbody>{activities.map((preference) => <PreferenceRow key={preference.activity} preference={preference} models={preferences.models} draft={drafts[preference.activity] || { codexModel: INHERIT, reasoningEffort: INHERIT }} busy={working === `preference:${preference.activity}`} onDraft={(draft) => setDrafts((current) => ({ ...current, [preference.activity]: draft }))} onSave={() => void savePreference('activity', preference.activity, drafts[preference.activity] || { codexModel: INHERIT, reasoningEffort: INHERIT })} onReset={() => void resetPreference('activity', preference.activity)} />)}</tbody>
                </table>
              </div>
            </div>
          ))}
        </section>
      )}

      {deviceLogin && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="device-login-title" aria-describedby="device-login-description">
          <div ref={dialogRef} className="w-full max-w-md rounded-xl border border-[var(--suite-line-strong)] bg-[var(--suite-surface)] p-6 shadow-lg">
            <h2 id="device-login-title" className="text-lg font-semibold text-[var(--suite-ink)]">Finish signing in with OpenAI</h2>
            <p id="device-login-description" className="mt-2 text-sm leading-6 text-[var(--suite-muted)]">Open the secure page, enter this one-time code, then return here. This window checks the connection automatically.</p>
            <div className="mt-5 border-y border-[var(--suite-line)] py-5">
              <p className="text-xs text-[var(--suite-muted)]">One-time code</p>
              <div className="mt-2 flex gap-2">
                <input ref={codeInputRef} className="h-12 min-w-0 flex-1 rounded-lg border border-[var(--suite-line-strong)] bg-[var(--suite-surface-muted)] px-3 text-center font-mono text-xl font-semibold tracking-[.25em] text-[var(--suite-ink)]" readOnly value={deviceLogin.userCode || ''} onFocus={(event) => event.currentTarget.select()} />
                <button className="suite-button-secondary inline-flex h-12 w-12 items-center justify-center border" aria-label="Copy one-time code" onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(deviceLogin.userCode || '');
                    setCopied(true); setCopyError('');
                  } catch {
                    setCopied(false); setCopyError('Copy failed. Select the code and copy it manually.');
                  }
                }} type="button">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</button>
              </div>
              {copyError && <p className="mt-2 text-xs text-red-600 dark:text-red-300" role="alert">{copyError}</p>}
              <p className="mt-3 flex items-center gap-2 text-xs text-[var(--suite-muted)]"><Loader2 className="h-4 w-4 animate-spin" />Waiting for OpenAI sign-in</p>
            </div>
            <div className="mt-5 flex flex-col gap-2">
              {deviceLogin.verificationUrl && <a className="suite-button inline-flex items-center justify-center gap-2 px-4" href={deviceLogin.verificationUrl} rel="noreferrer noopener" target="_blank"><Bot className="h-4 w-4" />Open OpenAI<ExternalLink className="h-4 w-4" /></a>}
              <button className="h-9 rounded-lg text-sm text-[var(--suite-muted)] hover:text-[var(--suite-ink)]" disabled={working === 'cancel'} onClick={() => void cancelLogin()} type="button">Cancel sign-in</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
