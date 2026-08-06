import { type FormEvent, useLayoutEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, Loader2, MailCheck, RefreshCw } from 'lucide-react';
import { AuthLayout, AuthSteps } from '@/components/auth/AuthLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Link } from '@/lib/router';
import { api, json, storeActiveSpaceId } from '@/lib/api';
import type { AuthSession } from '@/types';

type VerificationState = 'waiting' | 'ready' | 'verifying' | 'verified' | 'error';
type PasswordSetupClaim = {
  authenticated: false;
  email: string;
  emailVerified: false;
  onboardingRequired: true;
  claimPasswordRequired: true;
  passwordSetupToken: string;
  passwordSetupExpiresAt: string;
  returnTo?: '/my-documents' | null;
};

export function EmailVerificationPage() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const token = params.get('token') || '';
  const storedEmail = (() => { try { return window.sessionStorage.getItem('experience:verification-email') || ''; } catch { return ''; } })();
  const storedRequestId = (() => { try { return window.sessionStorage.getItem('experience:verification-request') || ''; } catch { return ''; } })();
  const requestId = params.get('request') || storedRequestId;
  const pendingInviteToken = (() => { try { return window.sessionStorage.getItem('experience:pending-invite-token') || ''; } catch { return ''; } })();
  const storedReturn = (() => { try { return window.sessionStorage.getItem('experience:pending-auth-return') || ''; } catch { return ''; } })();
  const requestedReturn = params.get('returnTo') === '/my-documents' || storedReturn === '/my-documents' ? '/my-documents' : '';
  const [email, setEmail] = useState(params.get('email') || storedEmail);
  const [state, setState] = useState<VerificationState>(token ? 'ready' : 'waiting');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  const [destination, setDestination] = useState('/onboarding');
  const [deliveryFailed, setDeliveryFailed] = useState(!token && params.get('delivery') === 'failed');

  useLayoutEffect(() => {
    if (!params.has('token')) return;
    const clean = new URLSearchParams(params);
    clean.delete('token');
    const query = clean.toString();
    window.history.replaceState(window.history.state, '', `/verify-email${query ? `?${query}` : ''}`);
  }, [params]);

  async function verify() {
    if (!token || state === 'verifying') return;
    setState('verifying'); setError('');
    try {
      const session = await api<(AuthSession & { returnTo?: '/my-documents' | null }) | PasswordSetupClaim>('/api/auth/verify-email', json('POST', { token }));
      if ('passwordSetupToken' in session) {
        try {
          window.sessionStorage.setItem('experience:password-setup-token', session.passwordSetupToken);
          if (session.returnTo === '/my-documents' || requestedReturn) window.sessionStorage.setItem('experience:pending-auth-return', '/my-documents');
        }
        catch { setError('This browser could not securely continue account setup. Open the verification link again.'); setState('error'); return; }
        window.location.replace('/reset-password?claim=1');
        return;
      }
      storeActiveSpaceId(session.activeSpace?.id || null, false);
      const accountReturn = session.returnTo === '/my-documents' || requestedReturn ? '/my-documents' : '';
      setDestination(pendingInviteToken ? `/join/${encodeURIComponent(pendingInviteToken)}` : accountReturn || (session.onboardingRequired ? '/onboarding' : '/'));
      setState('verified');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'This verification link is invalid or expired.');
      setState('error');
    }
  }

  async function resend(event: FormEvent) {
    event.preventDefault();
    try {
      setWorking(true); setError(''); setMessage('');
      const result = await api<{ message: string }>('/api/auth/resend-verification', json('POST', {
        email,
        requestId: requestId || undefined
      }));
      setMessage(result.message);
      setDeliveryFailed(false);
      try { window.sessionStorage.setItem('experience:verification-email', email); } catch { /* Storage may be unavailable. */ }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not send another verification email.'); }
    finally { setWorking(false); }
  }

  return <AuthLayout image="listening"><div>
    <AuthSteps current={2} />
    {state === 'verifying' ? <div className="py-8 text-center" aria-live="polite"><Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" /><h1 className="mt-5 text-xl font-semibold">Verifying your email</h1><p className="mt-2 text-sm text-muted-foreground">This should only take a moment.</p></div>
      : state === 'ready' ? <div><div className="flex h-10 w-10 items-center justify-center border bg-card text-primary"><MailCheck className="h-5 w-5" /></div><h1 className="mt-5 text-2xl font-semibold tracking-[-0.03em]">Confirm your email</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Continue only if you requested this Experience Management account. This deliberate confirmation protects your address from automated link scanners.</p><Button className="mt-7 h-10 w-full" onClick={() => void verify()}><Check />Confirm email address</Button><div className="mt-6 border-t pt-5 text-center text-sm text-muted-foreground">Did not request this? <Link className="font-medium text-foreground hover:underline" to="/login">Return to sign in</Link></div></div>
      : state === 'verified' ? <div><div className="flex h-10 w-10 items-center justify-center border border-emerald-300 bg-emerald-50 text-emerald-800"><Check className="h-5 w-5" /></div><h1 className="mt-5 text-2xl font-semibold tracking-[-0.03em]">Email verified</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Your account is secure. {pendingInviteToken ? 'Review the workspace invitation before deciding whether to join.' : destination === '/my-documents' ? 'Your completed agreements are ready in My documents.' : 'Add a few details so Experience Management can set up your profile.'}</p><Button className="mt-7 h-10 w-full" asChild><Link to={destination}>{pendingInviteToken ? 'Review invitation' : destination === '/my-documents' ? 'Open My documents' : 'Continue to your profile'}<ArrowRight /></Link></Button></div>
      : <div>
        <div className="flex h-10 w-10 items-center justify-center border bg-card text-primary"><MailCheck className="h-5 w-5" /></div>
        <h1 className="mt-5 text-2xl font-semibold tracking-[-0.03em]">Check your email</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{state === 'error'
          ? 'That link could not be verified. Request a fresh one below.'
          : deliveryFailed
            ? 'Your account was created, but the first verification message could not be delivered. Check the address and request a fresh link below.'
            : <>We sent a secure, one-time verification link{email ? <> to <strong className="font-medium text-foreground">{email}</strong></> : ''}. Open it to confirm that this email belongs to you.</>}</p>
        {deliveryFailed && <div className="mt-5 border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm leading-6 text-amber-950" role="alert">No verification email was sent. Use the button below to try again.</div>}
        {message && <div className="mt-5 border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-sm leading-6 text-emerald-950" role="status">{message}</div>}
        {error && <div className="mt-5 border border-destructive/35 bg-destructive/5 px-3 py-2.5 text-sm text-destructive" role="alert">{error}</div>}
        <form className="mt-7 space-y-4" onSubmit={resend}>
          <div><Label className="field-label" htmlFor="verification-email">Email</Label><Input id="verification-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
          <Button className="h-10 w-full" variant="outline" disabled={working}>{working ? <Loader2 className="animate-spin" /> : <RefreshCw />}{working ? 'Sending' : 'Resend verification email'}</Button>
        </form>
        <div className="mt-6 border-t pt-5 text-center text-sm text-muted-foreground">Already verified? <Link className="font-medium text-foreground hover:underline" to="/login">Sign in</Link></div>
      </div>}
  </div></AuthLayout>;
}
