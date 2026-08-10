'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Bot, Loader2, RefreshCw } from 'lucide-react';
import { aiAccount, aiErrorMessage, type AIAccountState } from '@/lib/aiAccount';
import { normalizedEffectiveRuntime } from '@/lib/aiRuntimePolicy';

export default function AIAccountGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AIAccountState | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [localRuntime, setLocalRuntime] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const runtime = await aiAccount.runtime();
      const selectedRuntime = normalizedEffectiveRuntime(runtime.runtimePolicy, runtime.runtimePreference);
      if (selectedRuntime === 'local') {
        setLocalRuntime(true);
        setState(null);
        return;
      }
      setLocalRuntime(false);
      const next = await aiAccount.read();
      setState({
        ...next,
        runtimePolicy: runtime.runtimePolicy,
        runtimePreference: runtime.runtimePreference
      });
    }
    catch (reason: unknown) { setError(aiErrorMessage(reason, 'Your AI account could not be checked.')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  if (loading) {
    return <div className="suite-panel flex min-h-48 items-center justify-center border"><Loader2 className="h-5 w-5 animate-spin text-[var(--suite-muted)]" aria-label="Checking AI account" /></div>;
  }

  if (localRuntime) return <>{children}</>;
  const chatgptAvailable = state?.runtimePolicy.chatgptEnabled !== false;
  if (state?.account?.routable && chatgptAvailable) return <>{children}</>;

  const connected = state?.account?.status === 'connected';

  return (
    <section className="suite-panel border p-6" aria-labelledby="ai-account-required-title">
      <div className="flex max-w-2xl items-start gap-4">
        <div className="suite-icon flex shrink-0 items-center justify-center border"><Bot className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <h2 id="ai-account-required-title" className="suite-card-title">
            {!chatgptAvailable ? 'ChatGPT is unavailable for this workspace' : connected ? 'Review your AI settings to continue' : 'Connect ChatGPT to start the guided assessment'}
          </h2>
          <p className="suite-card-copy mt-2">
            {!chatgptAvailable
              ? 'A workspace administrator needs to enable the shared ChatGPT runtime, or you can choose local inference when it is available.'
              : 'Performance Management uses the same ChatGPT connection as Recruiter. Connect once, then your self-assessment and other AI tools use that account and its limits.'}
          </p>
          {error || state?.account?.lastError ? (
            <p className="mt-3 flex items-start gap-2 text-sm text-red-600 dark:text-red-300" role="alert">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error || state?.account?.lastError}
            </p>
          ) : null}
          <div className="mt-5 flex flex-wrap gap-2">
            <Link className="suite-button inline-flex items-center px-4" href={connected || !chatgptAvailable ? '/settings/ai' : '/settings/ai?connect=1'}>
              {connected || !chatgptAvailable ? 'Review AI settings' : 'Connect ChatGPT'}
            </Link>
            <button className="suite-button-secondary inline-flex items-center gap-2 border px-4" onClick={() => void refresh()} type="button">
              <RefreshCw className="h-4 w-4" />Check again
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
