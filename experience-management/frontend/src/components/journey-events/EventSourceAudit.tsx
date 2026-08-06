import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { listJourneyEventAudit, type JourneyControlPlaneAuditEvent, type JourneyEventSource } from '@/lib/journeyEventControlPlane';
import { formatControlPlaneDate, SectionFrame } from '@/components/journey-events/shared';

function actionLabel(action: string) {
  return action.replaceAll(/[._-]+/g, ' ').replace(/^./u, (value) => value.toUpperCase());
}

export function EventSourceAudit({ source }: { source: JourneyEventSource }) {
  const [events, setEvents] = useState<JourneyControlPlaneAuditEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (cursor = '', append = false) => {
    try {
      append ? setLoadingMore(true) : setLoading(true);
      setError('');
      const result = await listJourneyEventAudit(source.id, cursor);
      setEvents((current) => append ? [...current, ...result.events] : result.events);
      setNextCursor(result.nextCursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Audit history could not be loaded.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [source.id]);

  useEffect(() => { void load(); }, [load]);

  return <SectionFrame
    title="Audit history"
    description="Source, credential, and tracking-plan changes. Secret values, credential digests, request payloads, and event properties are redacted before this response is returned."
    action={<Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => void load()}><RefreshCw className={loading ? 'animate-spin' : ''} />Refresh</Button>}
  >
    {error && <div className="border-b bg-red-50 px-4 py-3 text-sm text-destructive" role="alert">{error}</div>}
    {loading ? <div className="flex items-center gap-2 px-5 py-8 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" />Loading audit history…</div>
      : events.length === 0 ? <p className="px-5 py-8 text-sm text-muted-foreground">No control-plane changes have been recorded for this source.</p>
        : <>
          <div className="hidden overflow-x-auto sm:block">
            <table className="data-table min-w-[760px]">
              <caption className="sr-only">Redacted audit history for {source.name}</caption>
              <thead><tr><th scope="col">Time</th><th scope="col">Action</th><th scope="col">Actor</th><th scope="col">Target</th><th scope="col">Summary</th></tr></thead>
              <tbody>{events.map((event) => <tr key={event.id}><td className="whitespace-nowrap text-xs text-muted-foreground">{formatControlPlaneDate(event.createdAt)}</td><td className="whitespace-nowrap font-medium">{actionLabel(event.action)}</td><td>{event.actor?.name || 'System'}</td><td className="text-xs text-muted-foreground">{event.targetKind.replaceAll('_', ' ')}</td><td className="max-w-xl text-xs leading-5 text-muted-foreground">{event.summary}</td></tr>)}</tbody>
            </table>
          </div>
          <ol className="divide-y sm:hidden" aria-label={`Redacted audit history for ${source.name}`}>{events.map((event) => <li key={event.id} className="space-y-2 px-4 py-4"><div className="flex items-start justify-between gap-3"><span className="text-sm font-medium">{actionLabel(event.action)}</span><time className="whitespace-nowrap text-xs text-muted-foreground">{formatControlPlaneDate(event.createdAt)}</time></div><p className="text-xs leading-5 text-muted-foreground">{event.summary}</p><p className="text-xs text-muted-foreground">{event.actor?.name || 'System'} · {event.targetKind.replaceAll('_', ' ')}</p></li>)}</ol>
        </>}
    {nextCursor && <div className="flex justify-center border-t px-4 py-3"><Button type="button" size="sm" variant="outline" disabled={loadingMore} onClick={() => void load(nextCursor, true)}>{loadingMore ? 'Loading…' : 'Load earlier changes'}</Button></div>}
  </SectionFrame>;
}
