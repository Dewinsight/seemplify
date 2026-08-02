import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { platformAdminApi, platformAdminErrorMessage, platformAdminQuery } from '@/lib/platformAdminApi';
import type { PlatformAnalyticsSeries, PlatformOverview } from './types';
import { AdminError, AdminLoading, AdminPageHeader, SummaryStrip } from './shared';

function isoDate(date: Date) { return date.toISOString().slice(0, 10); }

export function PlatformAdminAnalyticsPage() {
  const today = useMemo(() => isoDate(new Date()), []);
  const defaultFrom = useMemo(() => isoDate(new Date(Date.now() - 29 * 24 * 60 * 60_000)), []);
  const [fromInput, setFromInput] = useState(defaultFrom);
  const [toInput, setToInput] = useState(today);
  const [range, setRange] = useState({ from: defaultFrom, to: today });
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [trend, setTrend] = useState<PlatformAnalyticsSeries | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [nextOverview, nextTrend] = await Promise.all([
        platformAdminApi<PlatformOverview>('/api/platform-admin/analytics/overview'),
        platformAdminApi<PlatformAnalyticsSeries>(platformAdminQuery('/api/platform-admin/analytics/timeseries', range))
      ]);
      setOverview(nextOverview);
      setTrend(nextTrend);
      setError('');
    } catch (cause) {
      setError(platformAdminErrorMessage(cause, 'Could not load platform analytics.'));
    } finally {
      setRefreshing(false);
    }
  }, [range]);

  useEffect(() => { void load(); }, [load]);

  function applyRange(event: FormEvent) {
    event.preventDefault();
    if (!fromInput || !toInput || fromInput > toInput) {
      setError('Choose a valid date range with the start on or before the end.');
      return;
    }
    setRange({ from: fromInput, to: toInput });
  }

  const rangeTotals = useMemo(() => {
    const totals = { accounts: 0, spaces: 0, responses: 0, aiJobs: 0, agreements: 0, campaigns: 0 };
    for (const point of trend?.series || []) {
      totals.accounts += point.accounts;
      totals.spaces += point.spaces;
      totals.responses += point.responses;
      totals.aiJobs += point.aiJobs;
      totals.agreements += point.agreements;
      totals.campaigns += point.campaigns;
    }
    return totals;
  }, [trend]);

  const shortDate = (value: string) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(`${value}T00:00:00`));

  return <div className="space-y-6">
    <AdminPageHeader title="Analytics" description="Platform adoption and workload totals. Charts contain counts, never customer content." actions={<Button variant="outline" size="sm" disabled={refreshing} onClick={() => void load()}><RefreshCw className={refreshing ? 'animate-spin' : ''} />Refresh</Button>} />
    <form onSubmit={applyRange} className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-end">
      <div><label htmlFor="platform-analytics-from" className="field-label">From</label><Input id="platform-analytics-from" type="date" max={toInput || today} value={fromInput} onChange={(event) => setFromInput(event.target.value)} /></div>
      <div><label htmlFor="platform-analytics-to" className="field-label">To</label><Input id="platform-analytics-to" type="date" min={fromInput} max={today} value={toInput} onChange={(event) => setToInput(event.target.value)} /></div>
      <Button type="submit">Apply range</Button>
    </form>
    {error && <AdminError message={error} onRetry={() => void load()} />}
    {!overview || !trend ? !error && <AdminLoading label="Loading analytics..." /> : <>
      <SummaryStrip items={[
        { label: 'New accounts', value: rangeTotals.accounts, note: `${overview.accounts.total} all time` },
        { label: 'New spaces', value: rangeTotals.spaces, note: `${overview.spaces.active} active now` },
        { label: 'Responses', value: rangeTotals.responses, note: 'Completed in range' },
        { label: 'AI jobs', value: rangeTotals.aiJobs, note: `${overview.product.aiFailures} failures all time` }
      ]} />

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-lg border bg-card" aria-labelledby="adoption-chart-heading"><div className="border-b px-5 py-4"><h2 id="adoption-chart-heading" className="section-title">Adoption</h2><p className="mt-1 text-xs text-muted-foreground">New accounts and spaces per day.</p></div><div className="h-72 p-4" aria-hidden="true">{trend.series.length ? <ResponsiveContainer width="100%" height="100%"><LineChart data={trend.series} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="day" tickFormatter={shortDate} tickLine={false} axisLine={false} fontSize={11} minTickGap={28} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} /><Tooltip labelFormatter={(value) => shortDate(String(value))} /><Legend wrapperStyle={{ fontSize: 12 }} /><Line type="monotone" dataKey="accounts" name="Accounts" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="spaces" name="Spaces" stroke="hsl(var(--muted-foreground))" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer> : <div className="grid h-full place-items-center text-sm text-muted-foreground">No adoption events in this range.</div>}</div></section>

        <section className="rounded-lg border bg-card" aria-labelledby="activity-chart-heading"><div className="border-b px-5 py-4"><h2 id="activity-chart-heading" className="section-title">Product activity</h2><p className="mt-1 text-xs text-muted-foreground">Responses and AI jobs per day.</p></div><div className="h-72 p-4" aria-hidden="true">{trend.series.length ? <ResponsiveContainer width="100%" height="100%"><LineChart data={trend.series} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="day" tickFormatter={shortDate} tickLine={false} axisLine={false} fontSize={11} minTickGap={28} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} /><Tooltip labelFormatter={(value) => shortDate(String(value))} /><Legend wrapperStyle={{ fontSize: 12 }} /><Line type="monotone" dataKey="responses" name="Responses" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="aiJobs" name="AI jobs" stroke="hsl(var(--muted-foreground))" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer> : <div className="grid h-full place-items-center text-sm text-muted-foreground">No product activity in this range.</div>}</div></section>
      </div>

      <details className="overflow-hidden rounded-lg border bg-card">
        <summary className="cursor-pointer px-5 py-4 text-sm font-medium">View accessible daily data</summary>
        <div className="overflow-x-auto border-t"><table className="data-table"><caption className="sr-only">Daily platform adoption and product activity from {trend.from} through {trend.to}</caption><thead><tr><th>Date</th><th className="text-right">Accounts</th><th className="text-right">Spaces</th><th className="text-right">Responses</th><th className="text-right">AI jobs</th><th className="text-right">Campaigns</th><th className="text-right">Agreements</th></tr></thead><tbody>{trend.series.map((point) => <tr key={point.day}><td className="whitespace-nowrap">{shortDate(point.day)}</td><td className="text-right tabular-nums">{point.accounts}</td><td className="text-right tabular-nums">{point.spaces}</td><td className="text-right tabular-nums">{point.responses}</td><td className="text-right tabular-nums">{point.aiJobs}</td><td className="text-right tabular-nums">{point.campaigns}</td><td className="text-right tabular-nums">{point.agreements}</td></tr>)}</tbody></table></div>
      </details>

      <section className="overflow-hidden rounded-lg border bg-card" aria-labelledby="range-volume-heading"><div className="border-b px-5 py-4"><h2 id="range-volume-heading" className="section-title">Volume by module</h2><p className="mt-1 text-xs text-muted-foreground">{trend.from} through {trend.to}</p></div><table className="data-table"><thead><tr><th>Module</th><th className="text-right">Records in range</th><th>What is counted</th></tr></thead><tbody>{[
        ['Responses', rangeTotals.responses, 'Completed survey responses'],
        ['AI jobs', rangeTotals.aiJobs, 'Durable AI jobs created'],
        ['Campaigns', rangeTotals.campaigns, 'Campaigns created'],
        ['Agreements', rangeTotals.agreements, 'Signature envelopes created'],
        ['Accounts', rangeTotals.accounts, 'User accounts created'],
        ['Spaces', rangeTotals.spaces, 'Spaces created']
      ].map(([label, value, note]) => <tr key={String(label)}><td className="font-medium">{label}</td><td className="text-right tabular-nums">{value}</td><td className="text-muted-foreground">{note}</td></tr>)}</tbody></table></section>
    </>}
  </div>;
}
