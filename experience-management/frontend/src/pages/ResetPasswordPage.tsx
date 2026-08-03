import { type FormEvent, useLayoutEffect, useMemo, useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { Link } from '@/lib/router';
import { api, json, storeActiveSpaceId } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import type { AuthSession } from '@/types';

export function ResetPasswordPage() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const isAccountClaim = params.get('claim') === '1';
  const token = params.get('token') || (isAccountClaim ? (() => {
    try { return window.sessionStorage.getItem('experience:password-setup-token') || ''; }
    catch { return ''; }
  })() : '');
  const pendingInviteToken = (() => { try { return window.sessionStorage.getItem('experience:pending-invite-token') || ''; } catch { return ''; } })();
  const pendingReturn = (() => { try { return window.sessionStorage.getItem('experience:pending-auth-return') || ''; } catch { return ''; } })();
  useLayoutEffect(() => {
    if (!params.has('token')) return;
    window.history.replaceState(window.history.state, '', `/reset-password${isAccountClaim ? '?claim=1' : ''}`);
  }, [isAccountClaim, params]);
  const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(''); const [working, setWorking] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    if (password !== confirm) return setError('Passwords do not match.');
    try {
      setWorking(true);
      const session = await api<AuthSession & { returnTo?: '/my-documents' | null }>('/api/auth/reset-password', json('POST', { token, password }));
      storeActiveSpaceId(session.activeSpace?.id || null, false);
      try { window.sessionStorage.removeItem('experience:password-setup-token'); } catch { /* Storage may be unavailable. */ }
      window.location.replace(pendingInviteToken
        ? `/join/${encodeURIComponent(pendingInviteToken)}`
        : session.returnTo === '/my-documents' || pendingReturn === '/my-documents' ? '/my-documents' : session.onboardingRequired ? '/onboarding' : '/');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not reset password'); }
    finally { setWorking(false); }
  }
  return <AuthLayout image="research"><div>
    <div className="flex h-10 w-10 items-center justify-center border bg-card text-primary"><KeyRound className="h-5 w-5" /></div>
    <h1 className="mt-5 text-2xl font-semibold tracking-[-0.03em]">{isAccountClaim ? 'Secure your account' : 'Choose a new password'}</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">{isAccountClaim ? 'Your email is confirmed. Choose a private password to finish securing this account.' : 'Your reset link is one-time use. Setting a new password signs out your older sessions.'}</p>
    {token ? <form className="mt-7 space-y-5" onSubmit={submit}><div><Label className="field-label" htmlFor="password">New password</Label><PasswordInput id="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={12} autoFocus /><p className="mt-1 text-xs text-muted-foreground">12+ characters with uppercase, lowercase, and a number.</p></div><div><Label className="field-label" htmlFor="confirm-password">Confirm password</Label><PasswordInput id="confirm-password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required minLength={12} /></div>{error && <div className="border border-destructive/35 bg-destructive/5 px-3 py-2.5 text-sm text-destructive" role="alert">{error}</div>}<Button className="h-10 w-full" disabled={working}>{working ? <Loader2 className="animate-spin" /> : <KeyRound />}{working ? 'Saving password' : 'Save new password'}</Button></form> : <div className="mt-7 border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-950" role="alert">This reset link is missing its security token. Request a new link.</div>}
    <div className="mt-6 border-t pt-5 text-center text-sm text-muted-foreground"><Link className="font-medium text-foreground underline-offset-4 hover:underline" to={isAccountClaim ? '/login' : '/forgot-password'}>{isAccountClaim ? 'Return to sign in' : 'Request another reset link'}</Link></div>
  </div></AuthLayout>;
}
