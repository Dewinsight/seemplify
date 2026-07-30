import { FormEvent, useEffect, useState } from 'react';
import { Loader2, LockKeyhole } from 'lucide-react';
import { Link } from '@/lib/router';
import { api, json, storeActiveSpaceId } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { AuthSession, SpaceInvitationPreview, SpaceSession } from '@/types';

export function LoginPage() {
  const inviteToken = new URLSearchParams(window.location.search).get('invite') || '';
  const inviteQuery = inviteToken ? `?invite=${encodeURIComponent(inviteToken)}` : '';
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [working, setWorking] = useState(false);
  const [invitation, setInvitation] = useState<SpaceInvitationPreview | null>(null);
  useEffect(() => {
    if (!inviteToken) return;
    void api<SpaceInvitationPreview>(`/api/public/spaces/invitations/${encodeURIComponent(inviteToken)}`).then((preview) => {
      setInvitation(preview); setEmail((current) => current || preview.email);
    }).catch(() => null);
  }, [inviteToken]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    let signedIn: AuthSession;
    try {
      setWorking(true); setError('');
      signedIn = await api<AuthSession>('/api/auth/login', json('POST', { email, password }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not sign in'); setWorking(false); return;
    }

    storeActiveSpaceId(signedIn.activeSpace?.id || null, false);
    if (!inviteToken) {
      window.location.replace('/');
      return;
    }

    try {
      const joined = await api<SpaceSession>(`/api/spaces/invitations/${encodeURIComponent(inviteToken)}/accept`, json('POST', {}));
      storeActiveSpaceId(joined.activeSpace.id, false);
      window.location.replace('/');
    } catch {
      window.location.replace(`/join/${encodeURIComponent(inviteToken)}?signedIn=1&accept=failed`);
    }
  }
  return <main className="grid min-h-screen place-items-center bg-background p-5"><div className="w-full max-w-sm"><div className="mb-8 flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground">S</div><div><div className="text-sm font-semibold">Seemplify</div><div className="text-xs text-muted-foreground">Experience management</div></div></div><div className="border bg-card p-6 shadow-panel"><div className="flex items-center gap-2"><LockKeyhole className="h-4 w-4 text-primary" /><h1 className="text-lg font-semibold">Sign in</h1></div><p className="mt-2 text-sm leading-6 text-muted-foreground">{invitation ? `Sign in as ${invitation.email} to join ${invitation.space.name}.` : 'Open your Experience spaces and research intelligence.'}</p><form className="mt-6 space-y-4" onSubmit={submit}><div><Label className="field-label" htmlFor="email">Email</Label><Input id="email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></div><div><div className="flex items-center justify-between"><Label className="field-label" htmlFor="password">Password</Label><Link className="text-xs font-medium text-foreground underline-offset-4 hover:underline" to="/forgot-password">Forgot password?</Link></div><Input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></div>{error && <p className="text-sm text-destructive" role="alert">{error}</p>}<Button className="w-full" disabled={working}>{working ? <Loader2 className="animate-spin" /> : <LockKeyhole />}{working ? 'Signing in' : 'Sign in'}</Button></form></div><p className="mt-4 text-center text-xs text-muted-foreground">New to Experience? <Link className="font-medium text-foreground underline-offset-4 hover:underline" to={`/signup${inviteQuery}`}>Create an account</Link></p><p className="mt-2 text-center text-xs text-muted-foreground">Published survey links do not require sign-in.</p><p className="mt-4 flex justify-center gap-4 text-center text-xs text-muted-foreground"><Link className="hover:text-foreground hover:underline" to="/legal/terms">Terms</Link><Link className="hover:text-foreground hover:underline" to="/legal/privacy">Privacy</Link></p></div></main>;
}
