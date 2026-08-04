import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { OpenAiAttribution } from '@/components/brand/OpenAiAttribution';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, json } from '@/lib/api';
import {
  notifyAiProviderChanged, requiresChatGptSetup, type AiProviderState, type DeviceLogin
} from '@/lib/aiProvider';
import { Link } from '@/lib/router';

export type ChatGptConnectionGateProps = {
  state: AiProviderState | null;
  loading: boolean;
  error: string | null;
  exempt: boolean;
  onStateChange: (state: AiProviderState) => void;
  onRetry: () => void | Promise<void>;
};

type LoginResult = DeviceLogin | { connected: true };

export function ChatGptConnectionGate({
  state, loading, error, exempt, onStateChange, onRetry
}: ChatGptConnectionGateProps) {
  const [deviceLogin, setDeviceLogin] = useState<DeviceLogin | null>(null);
  const [working, setWorking] = useState('');
  const [localError, setLocalError] = useState('');
  const [copied, setCopied] = useState(false);
  const pollInFlight = useRef(false);
  const activationInFlight = useRef(false);
  const open = !exempt && !loading && (Boolean(error) || requiresChatGptSetup(state));
  const connected = state?.codex.account.connected === true;
  const loginPending = Boolean(deviceLogin || state?.codex.account.pendingLogin);
  const displayedError = localError || error || state?.codex.account.loginError || state?.codex.error || '';

  const publishState = useCallback((next: AiProviderState, notify = false) => {
    onStateChange(next);
    if (notify) notifyAiProviderChanged(next);
  }, [onStateChange]);

  const enableChatGpt = useCallback(async (candidate: AiProviderState) => {
    if (!candidate.codex.account.connected || activationInFlight.current) return;
    if (!candidate.codex.models.length) {
      setLocalError('This ChatGPT account does not currently provide a Codex model. Retry, or choose the local AI runtime in Space settings.');
      return;
    }
    activationInFlight.current = true;
    setWorking('enable');
    setLocalError('');
    try {
      const next = await api<AiProviderState>('/api/ai-provider', json('PATCH', {
        provider: 'codex',
        codexDataSharingAcknowledged: true
      }));
      publishState(next, true);
      setDeviceLogin(null);
      if (requiresChatGptSetup(next)) {
        setLocalError('ChatGPT connected, but Experience Management could not select a usable Codex model. Retry or choose the local AI runtime.');
      }
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : 'ChatGPT connected, but it could not be enabled for this space.');
    } finally {
      activationInFlight.current = false;
      setWorking('');
    }
  }, [publishState]);

  const refreshConnection = useCallback(async (activateWhenConnected = true) => {
    if (pollInFlight.current) return;
    pollInFlight.current = true;
    try {
      const next = await api<AiProviderState>('/api/ai-provider');
      publishState(next);
      if (next.codex.account.connected) {
        setDeviceLogin(null);
        if (activateWhenConnected) await enableChatGpt(next);
      } else if (next.codex.account.loginError) {
        setDeviceLogin(null);
        setLocalError(next.codex.account.loginError);
      }
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : 'Could not check the ChatGPT connection.');
    } finally {
      pollInFlight.current = false;
    }
  }, [enableChatGpt, publishState]);

  const startLogin = useCallback(async (restart = false) => {
    if (working) return;
    setWorking(restart ? 'restart' : 'login');
    setLocalError('');
    setCopied(false);
    try {
      if (restart) {
        await api('/api/ai-provider/codex/device-login/cancel', json('POST', {})).catch(() => undefined);
      }
      const result = await api<LoginResult>('/api/ai-provider/codex/device-login', json('POST', {}));
      if (result.connected) {
        await refreshConnection(true);
      } else {
        setDeviceLogin(result);
      }
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : 'Could not start ChatGPT sign-in.');
    } finally {
      setWorking('');
    }
  }, [refreshConnection, working]);

  useEffect(() => {
    if (!open || !loginPending) return;
    const poll = () => { void refreshConnection(true); };
    const onVisibilityChange = () => { if (document.visibilityState === 'visible') poll(); };
    const timer = window.setInterval(poll, 2_000);
    window.addEventListener('focus', poll);
    document.addEventListener('visibilitychange', onVisibilityChange);
    poll();
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', poll);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [loginPending, open, refreshConnection]);

  useEffect(() => {
    if (!open) {
      setDeviceLogin(null);
      setLocalError('');
      setCopied(false);
    }
  }, [open]);

  async function copyCode() {
    if (!deviceLogin) return;
    try {
      await navigator.clipboard.writeText(deviceLogin.userCode);
      setCopied(true);
    } catch {
      setLocalError('Clipboard access is unavailable. Select and copy the code manually.');
    }
  }

  async function retry() {
    if (loginPending) {
      await startLogin(true);
      return;
    }
    if (connected && state) {
      await enableChatGpt(state);
      return;
    }
    if (state?.codex.available === false || error) {
      await onRetry();
      return;
    }
    await startLogin();
  }

  if (!open) return null;

  const accountName = state?.codex.account.email || 'your ChatGPT account';
  const accountPlan = state?.codex.account.planType;
  const busy = Boolean(working);

  return <Dialog open onOpenChange={() => undefined}>
    <DialogContent
      data-testid="chatgpt-connection-gate"
      showCloseButton={false}
      className="sm:max-w-md"
      onEscapeKeyDown={(event) => event.preventDefault()}
      onPointerDownOutside={(event) => event.preventDefault()}
      onInteractOutside={(event) => event.preventDefault()}
    >
      <DialogHeader>
        <OpenAiAttribution showModel={connected} model={state?.codex.selectedModel} />
        <DialogTitle>{connected ? 'Use ChatGPT for this space' : 'Connect ChatGPT to continue'}</DialogTitle>
        <DialogDescription>
          {connected
            ? `${accountName}${accountPlan ? ` (${accountPlan})` : ''} is connected. Enable it to make ChatGPT / Codex the AI runtime for this space.`
            : 'Connect your ChatGPT account to use Codex models for Experience Management AI tasks.'}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <p className="border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground" data-testid="chatgpt-gate-disclosure">
          Continuing allows AI task prompts and authorised knowledge excerpts from this space to be processed by OpenAI using your connected account. You can choose the local AI runtime in Space settings instead.
        </p>

        {loading && <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" />Checking your ChatGPT connection…
        </div>}

        {deviceLogin && <div className="space-y-3 border p-4" data-testid="chatgpt-gate-device-login">
          <div>
            <p className="text-sm font-medium">Finish signing in with OpenAI</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Open the secure page, enter the one-time code, then return here. This window will update automatically.</p>
          </div>
          <div>
            <Label className="field-label" htmlFor="chatgpt-gate-device-code">One-time code</Label>
            <div className="flex gap-2">
              <Input
                id="chatgpt-gate-device-code"
                data-testid="chatgpt-gate-device-code"
                readOnly
                value={deviceLogin.userCode}
                className="font-mono tracking-wider"
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button type="button" variant="outline" aria-label="Copy ChatGPT sign-in code" onClick={() => void copyCode()}>
                <Copy />{copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="flex items-center gap-2 text-xs text-muted-foreground" role="status"><Loader2 className="h-3.5 w-3.5 animate-spin" />Waiting for OpenAI…</span>
            <Button asChild size="sm"><a href={deviceLogin.verificationUrl} target="_blank" rel="noreferrer noopener">Open OpenAI<ExternalLink /></a></Button>
          </div>
        </div>}

        {!deviceLogin && loginPending && !connected && <div className="border p-4" data-testid="chatgpt-gate-pending-login">
          <p className="text-sm font-medium">A ChatGPT sign-in is already pending</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Restart the sign-in to receive a new one-time code.</p>
        </div>}

        {connected && <div className="border p-4 text-sm" data-testid="chatgpt-gate-connected-account">
          <p className="font-medium">Connected as {accountName}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {state?.codex.selectedModel
              ? `Experience Management will use ${state.codex.selectedModel} unless you choose another model in settings.`
              : 'Experience Management will select an available Codex model when you continue.'}
          </p>
        </div>}

        {displayedError && <div className="border border-destructive/35 bg-destructive/5 p-3 text-sm text-destructive" role="alert" data-testid="chatgpt-gate-error">{displayedError}</div>}
      </div>

      <DialogFooter className="sm:items-center sm:justify-between">
        <Button asChild variant="outline" data-testid="chatgpt-gate-settings">
          <Link to="/settings/space#ai-runtime">Use local AI in settings</Link>
        </Button>
        {deviceLogin
          ? <Button type="button" variant="ghost" disabled={busy} data-testid="chatgpt-gate-retry" onClick={() => void startLogin(true)}>{working === 'restart' ? <Loader2 className="animate-spin" /> : <RefreshCw />}Restart sign-in</Button>
          : connected && displayedError
            ? <Button type="button" disabled={busy || loading} data-testid="chatgpt-gate-retry" onClick={() => void refreshConnection(true)}>{busy || loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}Retry</Button>
            : connected
            ? <Button type="button" disabled={busy || loading} data-testid="chatgpt-gate-enable" onClick={() => state && void enableChatGpt(state)}>{working === 'enable' ? <Loader2 className="animate-spin" /> : null}Use ChatGPT</Button>
            : loginPending
              ? <Button type="button" disabled={busy} data-testid="chatgpt-gate-retry" onClick={() => void startLogin(true)}>{working === 'restart' ? <Loader2 className="animate-spin" /> : <RefreshCw />}Restart sign-in</Button>
              : displayedError
                ? <Button type="button" disabled={busy || loading} data-testid="chatgpt-gate-retry" onClick={() => void retry()}>{busy || loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}Retry</Button>
                : <Button type="button" disabled={busy || loading || state?.codex.available === false} data-testid="chatgpt-gate-connect" onClick={() => void startLogin()}>{working === 'login' ? <Loader2 className="animate-spin" /> : null}Connect ChatGPT</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
