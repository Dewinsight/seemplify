import { useEffect, useState } from 'react';
import { FileCheck2, Loader2, LogOut } from 'lucide-react';
import { ExperienceBrand } from '@/components/brand/ExperienceBrand';
import { RecipientDocumentLibrary } from '@/components/esign/RecipientDocumentLibrary';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { Link } from '@/lib/router';
import type { AuthSession } from '@/types';

export function MyDocumentsPage() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const nextSession = await api<AuthSession>('/api/auth/session');
        if (!nextSession.authenticated || !nextSession.user) {
          window.location.replace('/login?returnTo=%2Fmy-documents');
          return;
        }
        if (!nextSession.emailVerified) {
          window.location.replace(`/verify-email?email=${encodeURIComponent(nextSession.user.email)}&returnTo=%2Fmy-documents`);
          return;
        }
        if (cancelled) return;
        setSession(nextSession);
        try { window.sessionStorage.removeItem('experience:pending-auth-return'); } catch { /* Storage may be unavailable. */ }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'My documents could not be loaded.');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function signOut() {
    try { await api('/api/auth/logout', { method: 'POST' }); }
    finally { window.location.assign('/login?returnTo=%2Fmy-documents'); }
  }

  return <div className="min-h-screen bg-background">
    <header className="border-b bg-card"><div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
      <ExperienceBrand to="/my-documents" />
      <div className="flex items-center gap-2">
        {session && <Button variant="ghost" size="sm" asChild><Link to={session.onboardingRequired ? '/onboarding' : '/'}>{session.onboardingRequired ? 'Set up workspace' : 'Open workspace'}</Link></Button>}
        <Button variant="outline" size="sm" onClick={() => void signOut()}><LogOut />Sign out</Button>
      </div>
    </div></header>
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="border-b pb-6">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground"><FileCheck2 className="h-4 w-4" />Recipient portal</div>
        <h1 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">My documents</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Completed agreements sent to <span className="font-medium text-foreground">{session?.user?.email || 'your verified email'}</span> stay available here, independently of any workspace.</p>
      </div>

      <div className="mt-6">
        {error ? <div className="border border-destructive/35 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">{error}</div>
          : !session ? <div className="flex min-h-64 items-center justify-center" role="status"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /><span className="ml-2 text-sm text-muted-foreground">Loading your account…</span></div>
            : <RecipientDocumentLibrary accountEmail={session.user?.email} />}
      </div>
    </main>
  </div>;
}
