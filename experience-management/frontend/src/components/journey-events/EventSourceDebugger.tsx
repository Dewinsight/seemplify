import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { controlSelectClass, formatControlPlaneDate, SectionFrame } from '@/components/journey-events/shared';
import {
  listJourneyDebugEvents,
  type JourneyDebugEvent,
  type JourneyDebugEventIssue,
  type JourneyEventSource
} from '@/lib/journeyEventControlPlane';

const outcomeOptions = [
  { value: '', label: 'All outcomes' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'quarantined', label: 'Quarantined' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'content_conflict', label: 'Content conflict' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'rate_limited', label: 'Rate limited' },
  { value: 'over_quota', label: 'Over quota' },
  { value: 'consent_denied', label: 'Consent denied' }
] as const;

function statusVariant(outcome: string) {
  if (outcome === 'accepted') return 'success' as const;
  if (outcome === 'rejected') return 'destructive' as const;
  if (outcome === 'quarantined') return 'warning' as const;
  return 'outline' as const;
}

function bounded(value: unknown, maximum = 120) {
  const text = String(value || '').trim();
  if (!text) return '—';
  return text.length > maximum ? `${text.slice(0, maximum)}…` : text;
}

function formatBytes(value: number | null | undefined) {
  if (!Number.isFinite(value) || Number(value) < 0) return '—';
  const bytes = Number(value);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function issueSummary(issues: JourneyDebugEventIssue[] | undefined) {
  const safe = Array.isArray(issues) ? issues.slice(0, 5) : [];
  if (safe.length === 0) return null;
  return <ul className="mt-1 space-y-1" aria-label="Bounded validation issues">
    {safe.map((issue, index) => <li key={`${issue.code}-${issue.path || index}`} className="break-words text-[11px] text-muted-foreground">
      <code>{bounded(issue.code, 64)}</code>{issue.path ? <> at <code>{bounded(issue.path, 96)}</code></> : null}
    </li>)}
    {(issues?.length || 0) > safe.length && <li className="text-[11px] text-muted-foreground">+{(issues?.length || 0) - safe.length} more bounded issues</li>}
  </ul>;
}

function RoutingMetadata({ event }: { event: JourneyDebugEvent }) {
  return <div className="space-y-1 text-xs">
    <p><span className="text-muted-foreground">Call</span> {bounded(event.call, 40)} · <span className="text-muted-foreground">Bytes</span> {formatBytes(event.payloadBytes)}</p>
    <p><span className="text-muted-foreground">Schema</span> {bounded(event.schemaVersionId, 72)}</p>
    <p><span className="text-muted-foreground">Request</span> {bounded(event.requestId, 72)}{event.batchId ? <> · <span className="text-muted-foreground">Batch</span> {bounded(event.batchId, 72)}</> : null}</p>
    {(event.sdkName || event.sdkVersion) && <p><span className="text-muted-foreground">SDK</span> {bounded(event.sdkName, 40)} {bounded(event.sdkVersion, 32)}</p>}
    {event.code && <p><span className="text-muted-foreground">Code</span> <code>{bounded(event.code, 64)}</code></p>}
    {issueSummary(event.issues)}
  </div>;
}

export function EventSourceDebugger({ source }: { source: JourneyEventSource }) {
  const [events, setEvents] = useState<JourneyDebugEvent[]>([]);
  const [outcome, setOutcome] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [pollMs, setPollMs] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [copiedReceipt, setCopiedReceipt] = useState('');
  const requestSequence = useRef(0);

  const load = useCallback(async (cursor = '', append = false, quiet = false) => {
    const sequence = ++requestSequence.current;
    try {
      if (!quiet) append ? setLoadingMore(true) : setLoading(true);
      setError('');
      const result = await listJourneyDebugEvents(source.id, { cursor, outcome, limit: 50 });
      if (sequence !== requestSequence.current) return;
      setEvents((current) => append ? [...current, ...result.events] : result.events);
      setNextCursor(result.nextCursor);
    } catch (reason) {
      if (sequence === requestSequence.current) setError(reason instanceof Error ? reason.message : 'Recent receipts could not be loaded.');
    } finally {
      if (sequence === requestSequence.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [outcome, source.id]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!pollMs) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load('', false, true);
    }, pollMs);
    return () => window.clearInterval(timer);
  }, [load, pollMs]);

  async function copyReceipt(receiptId: string) {
    try {
      await navigator.clipboard.writeText(receiptId);
      setCopiedReceipt(receiptId);
      toast.success('Receipt ID copied.');
      window.setTimeout(() => setCopiedReceipt((current) => current === receiptId ? '' : current), 2_000);
    } catch {
      toast.error('The receipt ID could not be copied.');
    }
  }

  return <SectionFrame
    title="Event debugger"
    description={`Recent ingestion receipts for ${source.name}. The selected source is the source filter; use outcome to narrow this bounded view.`}
    action={<Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => void load()}><RefreshCw className={loading ? 'animate-spin' : ''} />Refresh</Button>}
  >
    <div className="border-b bg-slate-50 px-4 py-3 sm:px-5">
      <div className="flex items-start gap-2 text-xs leading-5 text-slate-700"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" /><p><strong>Privacy-safe metadata only.</strong> Event payloads, identity data, context, consent, hashes, and property names or values are never returned to this view.</p></div>
    </div>
    <div className="grid gap-3 border-b px-4 py-3 sm:grid-cols-2 sm:px-5 lg:max-w-2xl">
      <label className="space-y-1 text-xs font-medium">Outcome
        <select className={controlSelectClass} value={outcome} onChange={(event) => setOutcome(event.target.value)}>{outcomeOptions.map((option) => <option key={option.value || 'all'} value={option.value}>{option.label}</option>)}</select>
      </label>
      <label className="space-y-1 text-xs font-medium">Auto-refresh
        <select className={controlSelectClass} value={pollMs} onChange={(event) => setPollMs(Number(event.target.value))}>
          <option value={0}>Off</option><option value={15_000}>Every 15 seconds</option><option value={30_000}>Every 30 seconds</option>
        </select>
      </label>
    </div>
    {error && <div className="border-b bg-red-50 px-4 py-3 text-sm text-destructive" role="alert">{error}</div>}
    {loading ? <div className="flex items-center gap-2 px-5 py-8 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" />Loading redacted receipts…</div>
      : events.length === 0 ? <p className="px-5 py-8 text-sm text-muted-foreground">No receipts match this source and outcome.</p>
        : <>
          <div className="hidden overflow-x-auto md:block">
            <table className="data-table min-w-[980px]">
              <caption className="sr-only">Privacy-safe ingestion receipts for {source.name}</caption>
              <thead><tr><th scope="col">Received</th><th scope="col">Event</th><th scope="col">Outcome</th><th scope="col">Routing metadata</th><th scope="col">Processing</th><th scope="col">Receipt</th></tr></thead>
              <tbody>{events.map((event) => <tr key={event.receiptId}>
                <td className="whitespace-nowrap text-xs text-muted-foreground">{formatControlPlaneDate(event.receivedAt)}</td>
                <td><p className="font-medium">{bounded(event.eventName, 80)}</p><p className="mt-1 text-xs text-muted-foreground">v{bounded(event.version, 32)} · ID {bounded(event.eventId, 72)}</p></td>
                <td><Badge variant={statusVariant(event.outcome)}>{bounded(event.outcome, 32)}</Badge></td>
                <td className="max-w-md"><RoutingMetadata event={event} /></td>
                <td className="text-xs capitalize">{bounded(event.processingState, 40).replaceAll('_', ' ')}</td>
                <td><Button type="button" size="sm" variant="ghost" aria-label={`Copy receipt ${event.receiptId}`} onClick={() => void copyReceipt(event.receiptId)}>{copiedReceipt === event.receiptId ? <Check /> : <Copy />}{copiedReceipt === event.receiptId ? 'Copied' : bounded(event.receiptId, 32)}</Button></td>
              </tr>)}</tbody>
            </table>
          </div>
          <ol className="divide-y md:hidden" aria-label={`Privacy-safe ingestion receipts for ${source.name}`}>{events.map((event) => <li key={event.receiptId} className="space-y-3 px-4 py-4">
            <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium">{bounded(event.eventName, 80)}</p><p className="mt-1 text-xs text-muted-foreground">v{bounded(event.version, 32)} · {formatControlPlaneDate(event.receivedAt)}</p></div><Badge variant={statusVariant(event.outcome)}>{bounded(event.outcome, 32)}</Badge></div>
            <RoutingMetadata event={event} />
            <div className="flex items-center justify-between gap-3"><p className="text-xs capitalize text-muted-foreground">Processing: {bounded(event.processingState, 40).replaceAll('_', ' ')}</p><Button type="button" size="sm" variant="outline" aria-label={`Copy receipt ${event.receiptId}`} onClick={() => void copyReceipt(event.receiptId)}>{copiedReceipt === event.receiptId ? <Check /> : <Copy />}{copiedReceipt === event.receiptId ? 'Copied' : 'Receipt ID'}</Button></div>
          </li>)}</ol>
        </>}
    {nextCursor && <div className="flex justify-center border-t px-4 py-3"><Button type="button" size="sm" variant="outline" disabled={loadingMore} onClick={() => void load(nextCursor, true)}>{loadingMore ? 'Loading…' : 'Load older receipts'}</Button></div>}
  </SectionFrame>;
}
