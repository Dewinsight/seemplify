import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, BarChart3, LoaderCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatControlPlaneDate, SectionFrame } from '@/components/journey-events/shared';
import {
  readJourneyEventIngestionUsage,
  type JourneyEventSource,
  type JourneyIngestionUsage,
  type JourneyMonthlyTrackedEventUsage
} from '@/lib/journeyEventControlPlane';

function count(value: number | undefined) {
  return Number.isFinite(value) && Number(value) >= 0 ? new Intl.NumberFormat().format(Number(value)) : 'Unavailable';
}

function warningMessage(usage: JourneyMonthlyTrackedEventUsage) {
  if (usage.warningLevel === 'normal') return '';
  if (usage.warningLevel === 'exhausted') return 'The monthly tracked-event limit is exhausted.';
  if (usage.warningLevel === 'warning') return 'Monthly tracked-event usage is at the warning level.';
  return 'Monthly tracked-event usage is approaching the warning level.';
}

export function EventSourceUsage({ source }: { source: JourneyEventSource }) {
  const [usage, setUsage] = useState<JourneyIngestionUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      setUsage(await readJourneyEventIngestionUsage(source.id));
    } catch (reason) {
      setUsage(null);
      setError(reason instanceof Error ? reason.message : 'Ingestion usage could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [source.id]);

  useEffect(() => { void load(); }, [load]);

  const tracked = usage?.monthlyTrackedEvents;
  const percentage = tracked && Number.isFinite(tracked.percentUsed)
    ? Math.min(100, Math.max(0, tracked.percentUsed))
    : null;
  const warning = tracked ? warningMessage(tracked) : '';

  return <SectionFrame
    title="Ingestion usage"
    description={`Plan-enforced monthly tracked-event usage for the space containing ${source.name}. The service does not currently attribute this total to individual sources.`}
    action={<Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => void load()}><RefreshCw className={loading ? 'animate-spin' : ''} />Refresh</Button>}
  >
    {error && <div className="border-b bg-red-50 px-4 py-3 text-sm text-destructive" role="alert">{error}</div>}
    {loading ? <div className="flex items-center gap-2 px-5 py-8 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" />Loading ingestion usage…</div>
      : !tracked ? <div className="flex items-start gap-3 px-5 py-8 text-sm text-muted-foreground"><BarChart3 className="mt-0.5 h-5 w-5" /><p>Monthly tracked-event usage is not available for this space.</p></div>
        : <div className="space-y-5 px-4 py-5 sm:px-5">
          {warning && <div className="flex items-start gap-2 border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900" role="status"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><p>{warning}</p></div>}
          <div>
            <div className="flex items-end justify-between gap-4"><div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Monthly tracked events</p><p className="mt-1 text-2xl font-semibold tabular-nums">{count(tracked.used)}</p></div><p className="text-right text-xs text-muted-foreground">of {tracked.limit < 0 ? 'unlimited' : count(tracked.limit)}</p></div>
            {percentage !== null && <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Monthly tracked events used" aria-valuemin={0} aria-valuemax={tracked.limit} aria-valuenow={Math.max(0, tracked.used)}><div className="h-full bg-primary" style={{ width: `${percentage}%` }} /></div>}
          </div>
          <dl className="grid gap-px overflow-hidden border bg-border sm:grid-cols-3">
            <div className="bg-card px-4 py-4"><dt className="text-xs text-muted-foreground">Used</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{count(tracked.used)}</dd></div>
            <div className="bg-card px-4 py-4"><dt className="text-xs text-muted-foreground">Limit</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{tracked.limit < 0 ? 'Unlimited' : count(tracked.limit)}</dd></div>
            <div className="bg-card px-4 py-4"><dt className="text-xs text-muted-foreground">Remaining</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{tracked.limit < 0 ? 'Unlimited' : count(tracked.remaining)}</dd></div>
          </dl>
          <dl className="grid gap-x-8 gap-y-3 border-t pt-4 text-xs sm:grid-cols-2">
            <div><dt className="text-muted-foreground">Usage period</dt><dd className="mt-1">{formatControlPlaneDate(tracked.periodStart)} – {formatControlPlaneDate(tracked.periodEnd)}</dd></div>
            <div><dt className="text-muted-foreground">Resets</dt><dd className="mt-1">{formatControlPlaneDate(tracked.resetAt)}</dd></div>
            <div><dt className="text-muted-foreground">Percent used</dt><dd className="mt-1 tabular-nums">{tracked.percentUsed}%</dd></div>
            <div><dt className="text-muted-foreground">Projected period-end usage</dt><dd className="mt-1 tabular-nums">{count(tracked.projectedPeriodEnd)}</dd></div>
          </dl>
          <p className="text-xs leading-5 text-muted-foreground">This is the authoritative space-level entitlement counter. No per-source allocation or estimated breakdown is shown.</p>
        </div>}
  </SectionFrame>;
}
