import { type FormEvent, useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Loader2, UserPlus } from 'lucide-react';
import { AuthLayout, AuthSteps } from '@/components/auth/AuthLayout';
import { Link } from '@/lib/router';
import { api, json } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ESignAccountInvitation, SpaceInvitationPreview } from '@/types';

interface SignupResult {
  authenticated: false;
  verificationRequired: true;
  code: 'EMAIL_VERIFICATION_REQUIRED';
  email: string;
  expiresAt: string;
  verificationRequestId: string;
  delivery: { state: 'sent' | 'failed' };
  returnTo?: '/my-documents' | null;
}

export function SignupPage() {
  const inviteToken = new URLSearchParams(window.location.search).get('invite') || '';
  const esignAccountToken = new URLSearchParams(window.location.search).get('esign') || '';
  const inviteQuery = esignAccountToken ? `?esign=${encodeURIComponent(esignAccountToken)}` : inviteToken ? `?invite=${encodeURIComponent(inviteToken)}` : '';
  const [formStep, setFormStep] = useState<1 | 2>(1);
  const [name, setName] = useState(''); const [email, setEmail] = useState('');
  const [spaceName, setSpaceName] = useState('');
  const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(''); const [working, setWorking] = useState(false);
  const [invitation, setInvitation] = useState<SpaceInvitationPreview | null>(null);
  const [inviteLoading, setInviteLoading] = useState(Boolean(inviteToken));
  const [inviteError, setInviteError] = useState('');
  const [accountInvitation, setAccountInvitation] = useState<ESignAccountInvitation | null>(null);
  const [accountLoading, setAccountLoading] = useState(Boolean(esignAccountToken));
  const [accountError, setAccountError] = useState('');

  useEffect(() => {
    if (!inviteToken) return;
    void api<SpaceInvitationPreview>(`/api/public/spaces/invitations/${encodeURIComponent(inviteToken)}`).then((preview) => {
      setInvitation(preview); setEmail(preview.email);
    }).catch((reason) => setInviteError(reason instanceof Error ? reason.message : 'This invitation is unavailable.')).finally(() => setInviteLoading(false));
  }, [inviteToken]);
  useEffect(() => {
    if (!esignAccountToken) return;
    void api<ESignAccountInvitation>(`/api/public/esign/account-invitations/${encodeURIComponent(esignAccountToken)}`).then((preview) => {
      setAccountInvitation(preview); setName((current) => current || preview.recipient.name); setEmail(preview.recipient.email);
    }).catch((reason) => setAccountError(reason instanceof Error ? reason.message : 'This document invitation is unavailable.')).finally(() => setAccountLoading(false));
  }, [esignAccountToken]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    if (formStep === 1) {
      if (name.trim().length < 2) return setError('Enter your full name.');
      if (!email.trim()) return setError('Enter your email address.');
      setFormStep(2); return;
    }
    if (password !== confirm) return setError('Passwords do not match.');
    try {
      setWorking(true);
      const result = await api<SignupResult>('/api/auth/signup', json('POST', {
        name, email, password,
        spaceName: accountInvitation ? undefined : spaceName.trim() || undefined,
        inviteToken: inviteToken || undefined,
        esignAccountToken: esignAccountToken || undefined
      }));
      try {
        window.sessionStorage.setItem('experience:verification-email', result.email);
        window.sessionStorage.setItem('experience:verification-request', result.verificationRequestId);
        if (inviteToken) window.sessionStorage.setItem('experience:pending-invite-token', inviteToken);
        else window.sessionStorage.removeItem('experience:pending-invite-token');
        if (result.returnTo === '/my-documents') window.sessionStorage.setItem('experience:pending-auth-return', '/my-documents');
        else window.sessionStorage.removeItem('experience:pending-auth-return');
      } catch { /* Storage may be unavailable. */ }
      const delivery = result.delivery.state === 'failed' ? '&delivery=failed' : '';
      const returnTo = result.returnTo === '/my-documents' ? '&returnTo=%2Fmy-documents' : '';
      window.location.assign(`/verify-email?email=${encodeURIComponent(result.email)}&request=${encodeURIComponent(result.verificationRequestId)}${delivery}${returnTo}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not create account'); }
    finally { setWorking(false); }
  }

  return <AuthLayout image="listening"><div>
    <AuthSteps current={1} />
    <div className="flex items-start justify-between gap-4">
      <div><h1 className="text-2xl font-semibold tracking-[-0.03em]">{accountInvitation ? 'Keep your signed documents' : 'Create your account'}</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">{accountInvitation ? `Create an optional account for ${accountInvitation.recipient.email}. “${accountInvitation.envelope.title}” and future completed agreements sent to this address will appear in My documents.` : invitation ? `Join ${invitation.space.name} and keep a private personal space of your own.` : 'Set up a private workspace now. You can invite a team when you are ready.'}</p></div>
      <span className="shrink-0 pt-1 text-xs font-medium text-muted-foreground">{formStep} of 2</span>
    </div>
    <div className="mt-5 h-1 overflow-hidden bg-secondary" aria-hidden="true"><div className="h-full bg-primary transition-[width] duration-150" style={{ width: formStep === 1 ? '50%' : '100%' }} /></div>
    {inviteLoading && <p className="mt-5 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Checking invitation…</p>}
    {accountLoading && <p className="mt-5 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Checking completed agreement…</p>}
    {inviteError && <div className="mt-5 border border-destructive/35 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{inviteError} <Link className="ml-1 font-medium underline" to="/signup">Create an account without this invitation.</Link></div>}
    {accountError && <div className="mt-5 border border-destructive/35 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{accountError} <Link className="ml-1 font-medium underline" to="/signup">Create a standard account instead.</Link></div>}
    <form className="mt-7 space-y-5" onSubmit={submit}>
      {formStep === 1 ? <>
        <div><Label className="field-label" htmlFor="name">Full name</Label><Input id="name" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required minLength={2} autoFocus /></div>
        <div><Label className="field-label" htmlFor="email">{accountInvitation ? 'Recipient email' : 'Work email'}</Label><Input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} readOnly={Boolean(invitation || accountInvitation)} required /></div>
      </> : <>
        {!accountInvitation && <div><Label className="field-label" htmlFor="space-name">Personal space name <span className="font-normal text-muted-foreground">(optional)</span></Label><Input id="space-name" value={spaceName} onChange={(event) => setSpaceName(event.target.value)} placeholder={name.trim() ? `${name.trim().split(/\s+/)[0]}'s space` : 'My space'} minLength={2} maxLength={100} autoFocus /><p className="mt-1 text-xs leading-5 text-muted-foreground">This is your private starting point. You can rename it or create team spaces later.</p></div>}
        <div><Label className="field-label" htmlFor="password">Password</Label><Input id="password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={12} /><p className="mt-1 text-xs text-muted-foreground">12+ characters with uppercase, lowercase, and a number.</p></div>
        <div><Label className="field-label" htmlFor="confirm-password">Confirm password</Label><Input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required minLength={12} /></div>
        <p className="text-xs leading-5 text-muted-foreground">By creating an account, you agree to the <Link className="text-foreground underline" to="/legal/terms">Terms</Link> and acknowledge the <Link className="text-foreground underline" to="/legal/privacy">Privacy Policy</Link>.</p>
      </>}
      {error && <div className="border border-destructive/35 bg-destructive/5 px-3 py-2.5 text-sm text-destructive" role="alert">{error}</div>}
      <div className="flex gap-2">
        {formStep === 2 && <Button type="button" variant="outline" onClick={() => { setError(''); setFormStep(1); }}><ArrowLeft />Back</Button>}
        <Button className="h-10 flex-1" disabled={working || inviteLoading || accountLoading || Boolean(inviteError || accountError)}>{working ? <Loader2 className="animate-spin" /> : formStep === 1 ? <ArrowRight /> : <UserPlus />}{working ? 'Creating account' : formStep === 1 ? 'Continue' : invitation ? 'Create account and verify' : accountInvitation ? 'Create account and verify email' : 'Create account'}</Button>
      </div>
    </form>
    <div className="mt-6 border-t pt-5 text-center text-sm text-muted-foreground">Already have an account? <Link className="font-medium text-foreground underline-offset-4 hover:underline" to={`/login${inviteQuery}`}>Sign in</Link></div>
    {accountInvitation && <p className="mt-3 text-center text-xs leading-5 text-muted-foreground">Account creation is optional. Your completed signature remains valid if you close this page.</p>}
  </div></AuthLayout>;
}
