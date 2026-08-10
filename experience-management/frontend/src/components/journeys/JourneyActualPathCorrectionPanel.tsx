import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { listJourneyActualPathCorrections, requestJourneyActualPathCorrection,
  type JourneyActualPathCorrectionRun } from '@/lib/journeyActualPathCorrections';

const date = (value: string) => new Date(value).toLocaleString();
const state = (value: string) => value.replaceAll('_', ' ').replace(/^./u, (letter) => letter.toUpperCase());

export function JourneyActualPathCorrectionPanel({ journeyDefinitionId, journeyMapVersionId, windowStart, windowEnd,
  canManage }: { journeyDefinitionId: string; journeyMapVersionId: string; windowStart: string; windowEnd: string;
  canManage: boolean }) {
  const [runs, setRuns] = useState<JourneyActualPathCorrectionRun[]>([]); const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true); const [submitting, setSubmitting] = useState(false); const [error, setError] = useState('');
  const load = useCallback(async () => { setLoading(true); setError('');
    try { setRuns(await listJourneyActualPathCorrections(journeyDefinitionId)); }
    catch (value) { setError(value instanceof Error ? value.message : 'Correction history is unavailable.'); }
    finally { setLoading(false); }
  }, [journeyDefinitionId]);
  useEffect(() => { void load(); }, [load]);
  async function submit(event: FormEvent) { event.preventDefault(); if (!canManage || reason.trim().length < 8) return;
    setSubmitting(true); setError(''); try {
      const result = await requestJourneyActualPathCorrection({ journeyDefinitionId, journeyMapVersionId,
        requestReason: reason.trim(), windowStart, windowEnd });
      setRuns((current) => [result.run, ...current.filter((run) => run.id !== result.run.id)].slice(0, 20)); setReason('');
    } catch (value) { setError(value instanceof Error ? value.message : 'The correction could not be requested.'); }
    finally { setSubmitting(false); }
  }
  return <section className="border" aria-labelledby="actual-path-correction-heading" data-testid="actual-path-corrections">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
      <div><h3 id="actual-path-correction-heading" className="text-sm font-semibold">Stage correction history</h3>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Reprocesses retained events against the exact published journey version. Requests are durable and only one can run for this journey at a time.</p></div>
      <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
        {loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />} Refresh
      </Button>
    </div>
    {error && <p role="alert" className="border-b px-4 py-3 text-sm text-destructive">{error}</p>}
    {canManage ? <form className="grid gap-3 border-b p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" onSubmit={submit}>
      <div><Label htmlFor="actual-path-correction-reason">Reason for correction</Label>
        <Textarea id="actual-path-correction-reason" value={reason} minLength={8} maxLength={500} required
          onChange={(event) => setReason(event.target.value)}
          placeholder="Describe the reviewed data or rule correction." /></div>
      <Button type="submit" disabled={submitting || reason.trim().length < 8}>
        {submitting && <LoaderCircle className="animate-spin" />} Request correction
      </Button>
    </form> : <p className="border-b px-4 py-3 text-sm text-muted-foreground">You can inspect correction status and history. Editing permission is required to request one.</p>}
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <caption className="sr-only">Durable stage correction runs for this journey</caption>
        <thead><tr className="border-b text-left text-xs text-muted-foreground"><th scope="col" className="px-4 py-2">Requested</th>
          <th scope="col" className="px-4 py-2">State</th><th scope="col" className="px-4 py-2">Progress</th>
          <th scope="col" className="px-4 py-2">Changed stages</th><th scope="col" className="px-4 py-2">Version</th></tr></thead>
        <tbody>{runs.map((run) => <tr key={run.id} className="border-b last:border-0"><th scope="row" className="px-4 py-3 text-left font-medium">{date(run.createdAt)}</th>
          <td className="px-4 py-3">{state(run.state)}{run.errorCode ? ` · ${run.errorCode}` : ''}</td>
          <td className="px-4 py-3 tabular-nums">{run.progress?.processedCount ?? 0} processed · {run.attemptCount}/{run.maxAttempts} attempts</td>
          <td className="px-4 py-3 tabular-nums">{run.progress?.changedCurrentStageCount ?? 0}</td>
          <td className="px-4 py-3 font-mono text-xs">{run.journeyMapVersionId}</td></tr>)}
          {!runs.length && !loading && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No correction runs have been requested for this journey.</td></tr>}</tbody>
      </table>
    </div>
  </section>;
}
