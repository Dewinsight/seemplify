import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Cpu, ExternalLink, Loader2, LogOut, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, json } from '@/lib/api';

type CodexModel = {
  id: string;
  displayName: string;
  isDefault: boolean;
  defaultReasoningEffort?: string;
};

type AiProviderState = {
  preference: {
    provider: 'terra' | 'codex';
    codexModel: string | null;
    codexDataSharingAcknowledgedAt: string | null;
    updatedAt: string | null;
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

function accountLabel(state: AiProviderState) {
  const identity = state.codex.account.email || 'ChatGPT account';
  const plan = state.codex.account.planType;
  return plan ? `${identity} · ${plan}` : identity;
}

export function AiProviderSettings() {
  const [state, setState] = useState<AiProviderState | null>(null);
  const [deviceLogin, setDeviceLogin] = useState<DeviceLogin | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const connectedRef = useRef(false);
  const mutationInFlight = useRef(false);

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

  useEffect(() => {
    let cancelled = false;
    void api<AiProviderState>('/api/ai-provider').then((next) => {
      if (cancelled) return;
      connectedRef.current = next.codex.account.connected;
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

  async function chooseProvider(provider: 'terra' | 'codex') {
    if (provider === state?.preference.provider) return;
    if (!beginMutation(`provider:${provider}`)) return;
    try {
      const next = await api<AiProviderState>('/api/ai-provider', json('PATCH', {
        provider,
        ...(provider === 'codex' ? {
          codexModel: state?.codex.selectedModel,
          codexDataSharingAcknowledged: acknowledged
        } : {})
      }));
      setState(next);
      toast.success(provider === 'codex' ? 'ChatGPT / Codex selected for this space' : 'Local AI runtime selected');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not change the AI runtime.'); }
    finally { finishMutation(); }
  }

  async function startLogin() {
    if (!beginMutation('login')) return;
    try {
      const result = await api<DeviceLogin | { connected: true }>('/api/ai-provider/codex/device-login', json('POST', {}));
      if (result.connected) {
        connectedRef.current = true;
        await refresh();
        toast.success('ChatGPT is already connected');
      } else {
        setDeviceLogin(result);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not start ChatGPT sign-in.'); }
    finally { finishMutation(); }
  }

  async function cancelLogin() {
    if (!beginMutation('cancel-login')) return;
    try {
      await api('/api/ai-provider/codex/device-login/cancel', json('POST', {}));
      setDeviceLogin(null);
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not cancel ChatGPT sign-in.'); }
    finally { finishMutation(); }
  }

  async function selectModel(model: string) {
    if (!beginMutation('model')) return;
    try {
      const next = await api<AiProviderState>('/api/ai-provider', json('PATCH', {
        provider: state?.preference.provider || 'terra',
        codexModel: model,
        ...(state?.preference.provider === 'codex' ? { codexDataSharingAcknowledged: acknowledged } : {})
      }));
      setState(next);
      toast.success('Codex model updated');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not select that Codex model.'); }
    finally { finishMutation(); }
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
        provider: 'terra', codexDataSharingAcknowledged: false
      }));
      setState(next); setAcknowledged(false);
      toast.success('OpenAI processing disabled for this space');
    } catch (reason) {
      setAcknowledged(true);
      setError(reason instanceof Error ? reason.message : 'Could not update OpenAI processing consent.');
    }
    finally { finishMutation(); }
  }

  async function disconnect() {
    if (mutationInFlight.current) return;
    if (!window.confirm('Disconnect ChatGPT for your account? Every space you use will return to the local AI runtime.')) return;
    if (!beginMutation('disconnect')) return;
    try {
      const next = await api<AiProviderState>('/api/ai-provider/codex/disconnect', json('POST', {}));
      connectedRef.current = false;
      setDeviceLogin(null); setState(next);
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
  const codexSelected = state?.preference.provider === 'codex';
  const selectedModel = state?.preference.codexModel || state?.codex.selectedModel || '';

  return <section className="border bg-card" aria-labelledby="ai-runtime-heading" data-testid="ai-provider-settings">
    <div className="flex items-start gap-3 border-b px-5 py-4">
      <Cpu className="mt-0.5 h-4 w-4 text-muted-foreground" />
      <div><h2 id="ai-runtime-heading" className="text-sm font-semibold">AI runtime</h2><p className="mt-1 text-xs text-muted-foreground">Choose how AI tasks run in this space. This does not change how you sign in to Experience Management.</p></div>
    </div>
    {!state && !error ? <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Checking available runtimes…</div> : <div className="space-y-5 p-5">
      <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label="AI runtime">
        <button type="button" aria-pressed={state?.preference.provider === 'terra'} onClick={() => void chooseProvider('terra')} disabled={Boolean(working)} className={`min-h-24 border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${state?.preference.provider === 'terra' ? 'border-foreground/40 bg-muted/35' : 'hover:border-foreground/25 hover:bg-muted/20'}`}>
          <span className="flex items-center justify-between gap-3"><span className="text-sm font-semibold">Local AI runtime</span>{state?.preference.provider === 'terra' && <Check className="h-4 w-4" />}</span>
          <span className="mt-2 block text-xs leading-5 text-muted-foreground">Uses the existing managed Terra runtime and keeps the current behaviour.</span>
        </button>
        <button type="button" aria-pressed={codexSelected} onClick={() => void chooseProvider('codex')} disabled={!codexConnected || !acknowledged || Boolean(working)} className={`min-h-24 border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 ${codexSelected ? 'border-foreground/40 bg-muted/35' : 'hover:border-foreground/25 hover:bg-muted/20'}`}>
          <span className="flex items-center justify-between gap-3"><span className="text-sm font-semibold">ChatGPT / Codex</span>{codexSelected && <Check className="h-4 w-4" />}</span>
          <span className="mt-2 block text-xs leading-5 text-muted-foreground">Runs new AI tasks with a Codex model available to your connected ChatGPT account.</span>
        </button>
      </div>

      {error && <div className="border border-destructive/35 bg-background p-3 text-sm text-destructive" role="alert">{error}</div>}
      {state?.codex.error && <div className="border border-amber-500/35 bg-background p-3 text-sm text-amber-800" role="status">Codex is unavailable locally: {state.codex.error}</div>}

      {!codexConnected && !loginPending && <div className="flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-sm font-medium">Connect your ChatGPT account</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Experience Management receives only the connection status and runs Codex through its backend.</p></div>
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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium">Connected as {accountLabel(state!)}</p><p className="mt-1 text-xs text-muted-foreground">The connection belongs to your user account and is available in your spaces.</p></div><Button type="button" size="sm" variant="outline" disabled={Boolean(working)} onClick={() => void disconnect()}>{working === 'disconnect' ? <Loader2 className="animate-spin" /> : <LogOut />}Disconnect</Button></div>
        <div className="max-w-md"><Label className="field-label" htmlFor="codex-model">Codex model for this space</Label><select id="codex-model" value={selectedModel} disabled={!acknowledged || Boolean(working)} onChange={(event) => void selectModel(event.target.value)} className="h-9 w-full rounded-md border-input bg-background px-3 text-sm focus:border-ring focus:ring-1 focus:ring-ring">{state!.codex.models.map((model) => <option key={model.id} value={model.id}>{model.displayName}{model.isDefault ? ' (default)' : ''}</option>)}</select></div>
        <label className="flex cursor-pointer items-start gap-3 border bg-muted/15 p-3 text-sm leading-5"><input type="checkbox" className="mt-1 h-4 w-4 accent-foreground" checked={acknowledged} disabled={Boolean(working)} onChange={(event) => void changeAcknowledgement(event.target.checked)} /><span><span className="font-medium">Allow OpenAI processing for this space</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">When ChatGPT / Codex is selected, task prompts and authorised knowledge excerpts may be sent to OpenAI using your connected account. Turning this off immediately returns the space to the local runtime, including queued work that has not yet started.</span></span></label>
        {!codexSelected && <p className="text-xs text-muted-foreground">Check the acknowledgement, then choose ChatGPT / Codex above to enable it for this space.</p>}
      </div>}
    </div>}
  </section>;
}
