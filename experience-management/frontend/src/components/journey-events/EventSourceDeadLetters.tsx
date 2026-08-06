import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog, controlSelectClass, formatControlPlaneDate, SectionFrame } from '@/components/journey-events/shared';
import {
  listJourneyEventDeadLetters,
  replayJourneyEventDeadLetter,
  type JourneyEventDeadLetter,
  type JourneyEventSource
} from '@/lib/journeyEventControlPlane';

const stateOptions = [
  { value: '', label: 'All states' },
  { value: 'pending', label: 'Pending' },
  { value: 'replay_scheduled', label: 'Replay scheduled' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'terminal', label: 'Terminal' }
] as const;

function bounded(value: string | null | undefined, maximum = 120) {
  const text = String(value || '').trim();
  if (!text) return '—';
  return text.length > maximum ? `${text.slice(0, maximum)}…` : text;
}

function attemptsFor(letter: JourneyEventDeadLetter) {
  return Number.isFinite(letter.attempts) && letter.attempts >= 0 ? letter.attempts : 0;
}

function replayEligibility(letter: JourneyEventDeadLetter) {
  return letter.replayEligible;
}

function stateVariant(state: string) {
  if (state === 'resolved') return 'success' as const;
  if (state === 'terminal') return 'destructive' as const;
  if (state === 'pending' || state === 'replay_scheduled') return 'warning' as const;
  return 'outline' as const;
}

function FailureSummary({ letter }: { letter: JourneyEventDeadLetter }) {
  const code = letter.failure.code;
  const message = letter.failure.message;
  return <div className="max-w-lg space-y-1 text-xs"><p className="font-medium"><code>{bounded(code, 64)}</code></p>{message && <p className="leading-5 text-muted-foreground">{bounded(message, 240)}</p>}</div>;
}

export function EventSourceDeadLetters({ source, canManage }: { source: JourneyEventSource; canManage: boolean }) {
  const [deadLetters, setDeadLetters] = useState<JourneyEventDeadLetter[]>([]);
  const [state, setState] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState<JourneyEventDeadLetter | null>(null);
  const [replaying, setReplaying] = useState(false);

  const load = useCallback(async (cursor = '', append = false) => {
    try {
      append ? setLoadingMore(true) : setLoading(true);
      setError('');
      const result = await listJourneyEventDeadLetters(source.id, { cursor, state, limit: 50 });
      setDeadLetters((current) => append ? [...current, ...result.deadLetters] : result.deadLetters);
      setNextCursor(result.nextCursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Dead letters could not be loaded.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [source.id, state]);

  useEffect(() => { void load(); }, [load]);

  async function replay() {
    if (!confirming || !canManage || !replayEligibility(confirming)) return;
    try {
      setReplaying(true);
      setError('');
      const result = await replayJourneyEventDeadLetter(confirming.id);
      setConfirming(null);
      toast.success(result.replayed ? 'Replay was already requested safely.' : 'Replay requested.');
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The dead letter could not be replayed.');
    } finally {
      setReplaying(false);
    }
  }

  return <>
    <SectionFrame
      title="Dead letters"
      description="Processing failures retained for diagnosis. Replaying creates a governed processing attempt; it does not resubmit or expose the original event body."
      action={<Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => void load()}><RefreshCw className={loading ? 'animate-spin' : ''} />Refresh</Button>}
    >
      <div className="border-b bg-slate-50 px-4 py-3 sm:px-5"><div className="flex items-start gap-2 text-xs leading-5 text-slate-700"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" /><p>Failure metadata is redacted. No event body, identity data, credential material, context, or property values are returned to this workspace.</p></div></div>
      <div className="max-w-sm border-b px-4 py-3 sm:px-5"><label className="space-y-1 text-xs font-medium">State
        <select className={controlSelectClass} value={state} onChange={(event) => setState(event.target.value)}>{stateOptions.map((option) => <option key={option.value || 'all'} value={option.value}>{option.label}</option>)}</select>
      </label></div>
      {error && <div className="border-b bg-red-50 px-4 py-3 text-sm text-destructive" role="alert">{error}</div>}
      {loading ? <div className="flex items-center gap-2 px-5 py-8 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" />Loading dead letters…</div>
        : deadLetters.length === 0 ? <p className="px-5 py-8 text-sm text-muted-foreground">No dead letters match this source and state.</p>
          : <>
            <div className="hidden overflow-x-auto md:block">
              <table className="data-table min-w-[900px]">
                <caption className="sr-only">Redacted dead letters for {source.name}</caption>
                <thead><tr><th scope="col">Failure time</th><th scope="col">Event</th><th scope="col">Processor</th><th scope="col">State</th><th scope="col">Failure</th><th scope="col">Attempts</th><th scope="col">Replay</th></tr></thead>
                <tbody>{deadLetters.map((letter) => {
                  const eligible = replayEligibility(letter);
                  return <tr key={letter.id}>
                    <td className="whitespace-nowrap text-xs text-muted-foreground">{formatControlPlaneDate(letter.failedAt)}</td>
                    <td><p className="font-medium">{bounded(letter.eventName, 80)}</p><p className="mt-1 text-xs text-muted-foreground">{bounded(letter.eventId, 72)}</p></td>
                    <td className="text-xs">{bounded(letter.processor, 64)}</td>
                    <td><Badge variant={stateVariant(letter.state)}>{bounded(letter.state, 32)}</Badge></td>
                    <td><FailureSummary letter={letter} /></td>
                    <td className="text-center tabular-nums">{attemptsFor(letter)}</td>
                    <td>{canManage && eligible ? <Button type="button" size="sm" variant="outline" onClick={() => setConfirming(letter)}><RotateCcw />Replay</Button> : <span className="text-xs text-muted-foreground">{!canManage ? 'Owner or admin required' : bounded(letter.replayIneligibleReason || 'Not eligible', 100)}</span>}</td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
            <ol className="divide-y md:hidden" aria-label={`Redacted dead letters for ${source.name}`}>{deadLetters.map((letter) => {
              const eligible = replayEligibility(letter);
              return <li key={letter.id} className="space-y-3 px-4 py-4">
                <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium">{bounded(letter.eventName, 80)}</p><p className="mt-1 text-xs text-muted-foreground">{formatControlPlaneDate(letter.failedAt)}</p></div><Badge variant={stateVariant(letter.state)}>{bounded(letter.state, 32)}</Badge></div>
                <p className="text-xs"><span className="text-muted-foreground">Processor</span> {bounded(letter.processor, 64)} · <span className="text-muted-foreground">Attempts</span> {attemptsFor(letter)}</p>
                <FailureSummary letter={letter} />
                {canManage && eligible ? <Button type="button" size="sm" variant="outline" onClick={() => setConfirming(letter)}><RotateCcw />Replay</Button> : <p className="text-xs text-muted-foreground">{!canManage ? 'Owner or admin required to replay.' : bounded(letter.replayIneligibleReason || 'This failure is not eligible for replay.', 120)}</p>}
              </li>;
            })}</ol>
          </>}
      {nextCursor && <div className="flex justify-center border-t px-4 py-3"><Button type="button" size="sm" variant="outline" disabled={loadingMore} onClick={() => void load(nextCursor, true)}>{loadingMore ? 'Loading…' : 'Load older failures'}</Button></div>}
    </SectionFrame>
    <ConfirmationDialog
      open={Boolean(confirming)}
      title="Replay this dead letter?"
      description="This creates one governed processing attempt using the retained event. It will not expose or resubmit the event through the public ingestion endpoint."
      confirmLabel="Replay dead letter"
      busy={replaying}
      onConfirm={() => void replay()}
      onCancel={() => setConfirming(null)}
    />
  </>;
}
