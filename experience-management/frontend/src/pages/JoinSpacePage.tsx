import { useEffect, useState } from 'react';
import { ArrowRight, Check, Loader2, LogOut, Users } from 'lucide-react';
import { api, json, storeActiveSpaceId } from '@/lib/api';
import { Link, useParams } from '@/lib/router';
import { Button } from '@/components/ui/button';
import type { AuthSession, SpaceInvitationPreview, SpaceSession } from '@/types';

export function JoinSpacePage() {
  const { token = '' } = useParams<{ token: string }>();
  const signedInAfterFailedAcceptance = new URLSearchParams(window.location.search).get('signedIn') === '1';
  const [preview, setPreview] = useState<SpaceInvitationPreview | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);

  useEffect(() => {
    Promise.all([
      api<SpaceInvitationPreview>(`/api/public/spaces/invitations/${encodeURIComponent(token)}`),
      api<AuthSession>('/api/auth/session')
    ]).then(([nextPreview, nextSession]) => { setPreview(nextPreview); setSession(nextSession); })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'This invitation is unavailable.'));
  }, [token]);

  async function accept() {
    try {
      setWorking(true); setError('');
      const result = await api<SpaceSession>(`/api/spaces/invitations/${encodeURIComponent(token)}/accept`, json('POST', {}));
      storeActiveSpaceId(result.activeSpace.id, false);
      window.location.replace('/');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not accept the invitation.'); setWorking(false); }
  }

  async function signOut() {
    try { await api('/api/auth/logout', { method: 'POST' }); }
    finally { storeActiveSpaceId(null); window.location.reload(); }
  }

  const invitationQuery = `?invite=${encodeURIComponent(token)}`;
  const emailMatches = Boolean(session?.user && preview && session.user.email.toLowerCase() === preview.email.toLowerCase());

  return <main className="grid min-h-screen place-items-center bg-background p-5"><div className="w-full max-w-md">
    <Link to="/" className="mb-8 flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground">S</div><div><div className="text-sm font-semibold">Seemplify</div><div className="text-xs text-muted-foreground">Experience management</div></div></Link>
    <div className="border bg-card p-6 shadow-panel">
      {signedInAfterFailedAcceptance && <div className="mb-5 border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950" role="status"><strong>Signed in successfully.</strong> We could not finish joining this space. Review the invitation and account details below, then try again.</div>}
      {error && !preview ? <><h1 className="text-lg font-semibold">Invitation unavailable</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">{error}</p><Button className="mt-6" asChild variant="outline"><Link to={signedInAfterFailedAcceptance ? '/' : '/login'}>{signedInAfterFailedAcceptance ? 'Open my spaces' : 'Go to sign in'}</Link></Button></> : !preview || !session ? <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Checking invitation…</div> : <>
        <div className="flex items-center gap-2"><Users className="h-4 w-4 text-primary" /><h1 className="text-lg font-semibold">Join {preview.space.name}</h1></div>
        <p className="mt-3 text-sm leading-6 text-muted-foreground"><strong className="font-medium text-foreground">{preview.invitedBy}</strong> invited <strong className="font-medium text-foreground">{preview.email}</strong> to join as {preview.role === 'admin' ? 'an admin' : 'a member'}.</p>
        <p className="mt-2 text-xs text-muted-foreground">This invitation expires {new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeStyle: 'short' }).format(new Date(preview.expiresAt))}.</p>
        {error && <p className="mt-4 text-sm text-destructive" role="alert">{error}</p>}
        {!session.authenticated ? <div className="mt-6 grid gap-2 sm:grid-cols-2"><Button asChild><Link to={`/signup${invitationQuery}`}><Check />Create account</Link></Button><Button asChild variant="outline"><Link to={`/login${invitationQuery}`}>Sign in<ArrowRight /></Link></Button></div> : emailMatches ? <div className="mt-6"><p className="mb-3 text-xs text-muted-foreground">Signed in as {session.user?.email}</p><Button className="w-full" disabled={working} onClick={() => void accept()}>{working ? <Loader2 className="animate-spin" /> : <Check />}{working ? 'Joining space' : 'Accept invitation'}</Button></div> : <div className="mt-6 border-t pt-5"><p className="text-sm leading-6">You are signed in as <strong>{session.user?.email}</strong>. Sign in with <strong>{preview.email}</strong> to accept this invitation.</p><Button className="mt-4" variant="outline" onClick={() => void signOut()}><LogOut />Sign out</Button></div>}
      </>}
    </div>
    <p className="mt-4 flex justify-center gap-4 text-xs text-muted-foreground"><Link className="hover:text-foreground hover:underline" to="/legal/terms">Terms</Link><Link className="hover:text-foreground hover:underline" to="/legal/privacy">Privacy</Link></p>
  </div></main>;
}
