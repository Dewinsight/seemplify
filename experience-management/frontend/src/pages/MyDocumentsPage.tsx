import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3, Download, FileCheck2, Loader2, LogOut, TriangleAlert } from 'lucide-react';
import { ExperienceBrand } from '@/components/brand/ExperienceBrand';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { Link } from '@/lib/router';
import { cn } from '@/lib/utils';
import type { AuthSession, RecipientDocument, RecipientDocumentActivity, RecipientDocumentActivityEvent, RecipientDocumentLibrary } from '@/types';

type DocumentFilter = 'all' | RecipientDocument['accessState'];

function formatDate(value: string | null) {
  if (!value) return 'Not yet';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
    : 'Not yet';
}

function roleLabel(role: RecipientDocument['recipient']['role']) {
  return ({ signer: 'Signer', approver: 'Approver', cc: 'Copy recipient', viewer: 'Viewer' } as const)[role];
}

function readableRecipientStatus(status: RecipientDocument['recipient']['status']) {
  return status.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statePresentation(state: RecipientDocument['accessState']) {
  if (state === 'ready') return { label: 'Completed', detail: 'Files ready', icon: CheckCircle2, className: 'text-emerald-700' };
  if (state === 'finalization_failed') return { label: 'Needs attention', detail: 'The sender has been notified', icon: TriangleAlert, className: 'text-amber-700' };
  return { label: 'Waiting for others', detail: 'Your part is complete', icon: Clock3, className: 'text-blue-700' };
}

function activityLabel(event: RecipientDocumentActivityEvent) {
  const fieldType = typeof event.detail.fieldType === 'string' ? event.detail.fieldType.replaceAll('_', ' ') : '';
  return ({
    'recipient.link_opened': 'Signing link opened',
    'recipient.authenticated': 'Recipient identity verified',
    'recipient.access_code_failed': 'Access-code check failed',
    'recipient.consented': 'Electronic-signing consent recorded',
    'recipient.signature_saved': 'Signature saved for reuse',
    'recipient.signature_replaced': 'Saved signature changed',
    'recipient.signature_deleted': 'Saved signature removed',
    'field.updated': fieldType ? `${fieldType} field updated` : 'Document field updated',
    'recipient.completed': 'Signing completed',
    'recipient.document_downloaded': 'Completed file downloaded',
    'email.invitation_sent': 'Signing invitation sent',
    'email.reminder_sent': 'Signing reminder sent',
    'email.completed_sent': 'Completion email sent'
  } as Record<string, string>)[event.eventType] || event.eventType.replaceAll('.', ' · ').replaceAll('_', ' ');
}

function DocumentActivity({ document, presentation }: { document: RecipientDocument; presentation: ReturnType<typeof statePresentation> }) {
  const [activity, setActivity] = useState<RecipientDocumentActivityEvent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    if (activity || loading) return;
    try {
      setLoading(true); setError('');
      const result = await api<RecipientDocumentActivity>(document.activityUrl || `/api/recipient-documents/envelopes/${document.id}/activity`);
      setActivity(result.activity);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Activity could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  return <details className="mt-5 border-t pt-3" onToggle={(event) => { if (event.currentTarget.open) void load(); }}>
    <summary className="cursor-pointer text-xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Activity and document status</summary>
    <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
      <div><dt className="text-muted-foreground">Sent</dt><dd className="mt-1 font-medium">{formatDate(document.sentAt)}</dd></div>
      <div><dt className="text-muted-foreground">Your action</dt><dd className="mt-1 font-medium">{readableRecipientStatus(document.recipient.status)} · {formatDate(document.signedAt)}</dd></div>
      <div><dt className="text-muted-foreground">Envelope state</dt><dd className="mt-1 font-medium">{presentation.label} · {presentation.detail}</dd></div>
      <div><dt className="text-muted-foreground">Last updated</dt><dd className="mt-1 font-medium">{formatDate(document.updatedAt)}</dd></div>
    </dl>
    <div className="mt-4 border-t pt-3">
      {loading ? <div className="flex items-center text-xs text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading signing activity…</div>
        : error ? <p className="text-xs text-destructive" role="alert">{error}</p>
          : activity?.length ? <ol className="divide-y border">{activity.map((event) => <li className="flex items-start justify-between gap-4 px-3 py-2.5" key={event.id}><span className="text-xs font-medium capitalize">{activityLabel(event)}</span><time className="shrink-0 text-[11px] text-muted-foreground" dateTime={event.createdAt}>{formatDate(event.createdAt)}</time></li>)}</ol>
            : activity ? <p className="text-xs text-muted-foreground">No recipient activity has been recorded for this document.</p> : null}
    </div>
  </details>;
}

export function MyDocumentsPage() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [library, setLibrary] = useState<RecipientDocumentLibrary | null>(null);
  const [filter, setFilter] = useState<DocumentFilter>('all');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const nextSession = await api<AuthSession>('/api/auth/session');
        if (!nextSession.authenticated || !nextSession.user) {
          window.location.replace('/login?returnTo=%2Fmy-documents'); return;
        }
        if (!nextSession.emailVerified) {
          window.location.replace(`/verify-email?email=${encodeURIComponent(nextSession.user.email)}&returnTo=%2Fmy-documents`); return;
        }
        const nextLibrary = await api<RecipientDocumentLibrary>('/api/recipient-documents');
        if (cancelled) return;
        setSession(nextSession); setLibrary(nextLibrary);
        try { window.sessionStorage.removeItem('experience:pending-auth-return'); } catch { /* Storage may be unavailable. */ }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'My documents could not be loaded.');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const visibleDocuments = useMemo(() => {
    const documents = library?.documents || [];
    return filter === 'all' ? documents : documents.filter((document) => document.accessState === filter);
  }, [filter, library]);

  async function signOut() {
    try { await api('/api/auth/logout', { method: 'POST' }); }
    finally { window.location.assign('/login?returnTo=%2Fmy-documents'); }
  }

  const filters: Array<{ key: DocumentFilter; label: string; count: number }> = [
    { key: 'all', label: 'All', count: library?.summary.total || 0 },
    { key: 'ready', label: 'Completed', count: library?.summary.ready || 0 },
    { key: 'waiting_for_others', label: 'Waiting', count: library?.summary.waitingForOthers || 0 }
  ];

  return <div className="min-h-screen bg-background">
    <header className="border-b bg-card"><div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
      <ExperienceBrand to="/my-documents" />
      <div className="flex items-center gap-2">
        {session && <Button variant="ghost" size="sm" asChild><Link to={session.onboardingRequired ? '/onboarding' : '/'}>{session.onboardingRequired ? 'Set up workspace' : 'Open workspace'}</Link></Button>}
        <Button variant="outline" size="sm" onClick={() => void signOut()}><LogOut />Sign out</Button>
      </div>
    </div></header>
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-col justify-between gap-4 border-b pb-6 sm:flex-row sm:items-end">
        <div><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground"><FileCheck2 className="h-4 w-4" />Recipient portal</div><h1 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">My documents</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Completed agreements sent to <span className="font-medium text-foreground">{session?.user?.email || 'your verified email'}</span> stay available here, independently of any workspace.</p></div>
        {library && <div className="text-sm text-muted-foreground"><span className="font-semibold text-foreground">{library.summary.ready}</span> completed</div>}
      </div>

      {error ? <div className="mt-6 border border-destructive/35 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">{error}</div>
        : !library ? <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /><span className="ml-2 text-sm text-muted-foreground">Loading signed documents…</span></div>
          : <>
            <div className="mt-6 flex flex-wrap gap-1 border-b" role="tablist" aria-label="Document status">
              {filters.map((item) => <button key={item.key} type="button" role="tab" aria-selected={filter === item.key} onClick={() => setFilter(item.key)} className={cn('relative px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground', filter === item.key && 'text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-primary')}>
                {item.label} <span className="ml-1 text-xs tabular-nums text-muted-foreground">{item.count}</span>
              </button>)}
            </div>

            {visibleDocuments.length === 0 ? <div className="mt-8 border border-dashed px-6 py-14 text-center"><FileCheck2 className="mx-auto h-6 w-6 text-muted-foreground" /><h2 className="mt-4 text-sm font-semibold">{library.documents.length ? 'No documents in this view' : 'No signed documents yet'}</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{library.documents.length ? 'Choose another status to see your agreements.' : 'When you complete an agreement sent to this verified email, it will appear here automatically.'}</p></div>
              : <div className="divide-y border-x border-b" data-testid="recipient-document-list">
                {visibleDocuments.map((document) => {
                  const presentation = statePresentation(document.accessState); const StateIcon = presentation.icon;
                  return <article className="bg-card px-4 py-5 sm:px-5" key={document.id} data-testid="recipient-document-row">
                    <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0"><div className={cn('flex items-center gap-1.5 text-xs font-semibold', presentation.className)}><StateIcon className="h-3.5 w-3.5" />{presentation.label}<span className="font-normal text-muted-foreground">· {presentation.detail}</span></div><h2 className="mt-2 truncate text-base font-semibold" title={document.title}>{document.title}</h2><p className="mt-1 text-sm text-muted-foreground">From {document.sender.name} · {document.sender.spaceName}</p><dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:flex sm:flex-wrap sm:gap-x-8"><div><dt className="text-muted-foreground">Your role</dt><dd className="mt-0.5 font-medium text-foreground">{roleLabel(document.recipient.role)}</dd></div><div><dt className="text-muted-foreground">You signed</dt><dd className="mt-0.5 font-medium text-foreground">{formatDate(document.signedAt)}</dd></div>{document.completedAt && <div><dt className="text-muted-foreground">Completed</dt><dd className="mt-0.5 font-medium text-foreground">{formatDate(document.completedAt)}</dd></div>}</dl></div>
                      <div className="flex min-w-0 flex-col gap-2 lg:w-64 lg:items-stretch">{document.artifacts.length ? document.artifacts.map((artifact) => <Button key={artifact.id} variant="outline" size="sm" className="min-w-0 justify-start" asChild><a href={artifact.contentUrl}><Download className="shrink-0" /><span className="truncate">{artifact.kind === 'completion_certificate' ? 'Completion certificate' : 'Completed document'}</span></a></Button>) : <p className="text-xs leading-5 text-muted-foreground">Final files will appear when every required signer has finished.</p>}</div>
                    </div>
                    <DocumentActivity document={document} presentation={presentation} />
                  </article>;
                })}
              </div>}
          </>}
      <footer className="mt-8 border-t pt-5 text-xs leading-5 text-muted-foreground">Only agreements addressed to your verified email are shown. Signing activity remains governed by the original envelope and its audit certificate.</footer>
    </main>
  </div>;
}
