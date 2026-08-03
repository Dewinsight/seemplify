import { FormEvent, useEffect, useState } from 'react';
import { Loader2, LockKeyhole } from 'lucide-react';
import { Link } from '@/lib/router';
import { ApiError, api, json, storeActiveSpaceId } from '@/lib/api';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import type { AuthSession, ESignAccountInvitation, SpaceInvitationPreview } from '@/types';

export function LoginPage() {
  const params = new URLSearchParams(window.location.search);
  const inviteToken = params.get('invite') || '';
  const esignAccountToken = params.get('esign') || '';
  const returnTo = esignAccountToken || params.get('returnTo') === '/my-documents' ? '/my-documents' : '';
  const inviteQuery = esignAccountToken ? `?esign=${encodeURIComponent(esignAccountToken)}` : inviteToken ? `?invite=${encodeURIComponent(inviteToken)}` : returnTo ? '?returnTo=%2Fmy-documents' : '';
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [working, setWorking] = useState(false);
  const [invitation, setInvitation] = useState<SpaceInvitationPreview | null>(null);
  const [inviteLoading, setInviteLoading] = useState(Boolean(inviteToken));
  const [inviteError, setInviteError] = useState('');
  const [accountInvitation, setAccountInvitation] = useState<ESignAccountInvitation | null>(null);
  const [accountLoading, setAccountLoading] = useState(Boolean(esignAccountToken));
  const [accountError, setAccountError] = useState('');
  useEffect(() => {
    if (!inviteToken) return;
    void api<SpaceInvitationPreview>(`/api/public/spaces/invitations/${encodeURIComponent(inviteToken)}`).then((preview) => {
      setInvitation(preview); setEmail((current) => current || preview.email);
    }).catch((reason) => setInviteError(reason instanceof Error ? reason.message : 'This invitation is unavailable.'))
      .finally(() => setInviteLoading(false));
  }, [inviteToken]);
  useEffect(() => {
    if (!esignAccountToken) return;
    void api<ESignAccountInvitation>(`/api/public/esign/account-invitations/${encodeURIComponent(esignAccountToken)}`).then((preview) => {
      setAccountInvitation(preview); setEmail(preview.recipient.email);
    }).catch((reason) => setAccountError(reason instanceof Error ? reason.message : 'This document invitation is unavailable.'))
      .finally(() => setAccountLoading(false));
  }, [esignAccountToken]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if ((inviteToken && !invitation) || (esignAccountToken && !accountInvitation)) {
      setError(inviteError || accountError || 'Wait while we check this invitation.');
      return;
    }
    let signedIn: AuthSession;
    try {
      setWorking(true); setError('');
      signedIn = await api<AuthSession>('/api/auth/login', json('POST', { email, password }));
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === 'EMAIL_VERIFICATION_REQUIRED') {
        const next = returnTo ? '&returnTo=%2Fmy-documents' : '';
        window.location.assign(`/verify-email?email=${encodeURIComponent(email)}${next}`);
        return;
      }
      setError(reason instanceof Error ? reason.message : 'Could not sign in'); setWorking(false); return;
    }

    storeActiveSpaceId(signedIn.activeSpace?.id || null, false);
    const destination = inviteToken
      ? `/join/${encodeURIComponent(inviteToken)}`
      : returnTo || (signedIn.onboardingRequired ? '/onboarding' : '/');
    window.location.replace(destination);
  }
  return <AuthLayout image="research"><div>
    <div className="flex h-9 w-9 items-center justify-center border bg-card text-primary"><LockKeyhole className="h-4 w-4" /></div>
    <h1 className="mt-5 text-2xl font-semibold tracking-[-0.03em]">Welcome back</h1>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">{accountLoading ? 'Checking this completed agreement before you sign in…' : accountInvitation ? `Sign in as ${accountInvitation.recipient.email} to open My documents and view “${accountInvitation.envelope.title}”.` : inviteLoading ? 'Checking this workspace invitation before you sign in...' : invitation ? `Sign in as ${invitation.email}. You will review the invitation to ${invitation.space.name} before joining.` : returnTo ? 'Sign in to view the completed agreements addressed to your verified email.' : 'Sign in to continue to your research, listening, and experience intelligence.'}</p>
    {inviteError && <div className="mt-5 border border-destructive/35 bg-destructive/5 px-3 py-2.5 text-sm leading-6 text-destructive" role="alert">{inviteError} <Link className="font-medium underline" to="/login">Sign in without this invitation.</Link></div>}
    {accountError && <div className="mt-5 border border-destructive/35 bg-destructive/5 px-3 py-2.5 text-sm leading-6 text-destructive" role="alert">{accountError} <Link className="font-medium underline" to="/login?returnTo=%2Fmy-documents">Sign in to My documents instead.</Link></div>}
    <form className="mt-7 space-y-5" onSubmit={submit}>
      <div><Label className="field-label" htmlFor="email">Email</Label><Input id="email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} readOnly={Boolean(invitation || accountInvitation)} required autoFocus /></div>
      <div><div className="flex items-center justify-between"><Label className="field-label" htmlFor="password">Password</Label><Link className="mb-1.5 text-xs font-medium text-foreground underline-offset-4 hover:underline" to="/forgot-password">Forgot password?</Link></div><PasswordInput id="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></div>
      {error && <div className="border border-destructive/35 bg-destructive/5 px-3 py-2.5 text-sm text-destructive" role="alert">{error}</div>}
      <Button className="h-10 w-full" disabled={working || inviteLoading || accountLoading || Boolean(inviteError || accountError)}>{working ? <Loader2 className="animate-spin" /> : <LockKeyhole />}{working ? 'Signing in' : 'Sign in'}</Button>
    </form>
    <div className="mt-6 border-t pt-5 text-center text-sm text-muted-foreground">New to Experience Management? <Link className="font-medium text-foreground underline-offset-4 hover:underline" to={`/signup${inviteQuery}`}>Create an account</Link></div>
    <p className="mt-3 text-center text-xs text-muted-foreground">{returnTo ? 'Signing and downloading from the original completion page never requires an account.' : 'Published survey links never require sign-in.'}</p>
  </div></AuthLayout>;
}
