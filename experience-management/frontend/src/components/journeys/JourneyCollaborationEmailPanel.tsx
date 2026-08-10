import { useCallback, useEffect, useState } from 'react';
import { Loader2, Mail, MailX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import {
  getCollaborationEmailPreference, getCollaborationEmailStatus, setCollaborationEmailPreference,
  type CollaborationEmailPreference, type CollaborationEmailStatus
} from '@/lib/journeyCollaborationEmail';

/**
 * Compact per-member email opt-in for the collaboration inbox.
 *
 * It states the two things a member needs in order to decide: that the mail
 * carries no discussion content, and that the in-app inbox is unaffected either
 * way. The delivery counters are workspace-wide totals with no per-recipient or
 * per-message detail, so the panel cannot become a side channel for who was
 * written to about what.
 */
export function JourneyCollaborationEmailPanel({ panelClass }: { panelClass: string }) {
  const [preference, setPreference] = useState<CollaborationEmailPreference | null>(null);
  const [status, setStatus] = useState<CollaborationEmailStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [next, counts] = await Promise.all([
        getCollaborationEmailPreference(),
        getCollaborationEmailStatus().catch(() => null)
      ]);
      setPreference(next); setStatus(counts);
    } catch (reason) {
      setError(reason instanceof Error && reason.message ? reason.message
        : 'Email notification settings could not be loaded.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function toggle() {
    if (!preference) return;
    setBusy(true); setError('');
    try {
      setPreference(await setCollaborationEmailPreference(!preference.emailEnabled, preference.revision));
      setStatus(await getCollaborationEmailStatus().catch(() => null));
    } catch (reason) {
      setError(reason instanceof ApiError && reason.status === 409
        ? `${reason.message} Reloaded the current setting; try again.`
        : reason instanceof Error && reason.message ? reason.message : 'The change could not be saved.');
      await load();
    } finally { setBusy(false); }
  }

  if (loading) return <section className={panelClass} aria-label="Email notifications">
    <Loader2 className="animate-spin" aria-hidden /><span className="sr-only">Loading email notification settings</span>
  </section>;
  if (!preference) return null;

  return <section className={panelClass} aria-label="Email notifications">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="max-w-2xl">
        <h2 className="font-medium">Email notifications</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Off by default. When on, you get a short notice with no discussion content and a link to sign in
          and open this inbox. Your in-app inbox above is unchanged either way, and only you can change this.
        </p>
      </div>
      <Button variant="outline" disabled={busy || !preference.available} onClick={() => void toggle()}
        data-testid="journey-collaboration-email-toggle">
        {busy ? <Loader2 className="animate-spin" /> : preference.emailEnabled ? <MailX /> : <Mail />}
        {preference.emailEnabled ? 'Turn off email' : 'Turn on email'}
      </Button>
    </div>
    <p className="mt-3 text-sm" data-testid="journey-collaboration-email-state">
      Status: <span className="font-medium">{preference.emailEnabled ? 'On for you' : 'Off for you'}</span>
      {preference.decidedAt && preference.emailEnabled
        && <span className="text-muted-foreground"> · opted in {new Date(preference.decidedAt).toLocaleDateString()}</span>}
    </p>
    {preference.emailEnabled && !preference.deliveryEnabled && <p className="mt-2 text-sm text-amber-800">
      Delivery is switched off for this deployment, so nothing is being sent yet. Your choice is saved.
    </p>}
    {!preference.available && <p className="mt-2 text-sm text-muted-foreground">
      Email delivery is not available on this runtime yet.
    </p>}
    {status && <p className="mt-2 text-xs text-muted-foreground">
      Workspace delivery: {status.counts.pending} queued · {status.counts.sent} sent
      · {status.counts.cancelled} cancelled · {status.counts.dead_letter} failed
    </p>}
    {error && <p role="alert" className="mt-3 border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">{error}</p>}
  </section>;
}
