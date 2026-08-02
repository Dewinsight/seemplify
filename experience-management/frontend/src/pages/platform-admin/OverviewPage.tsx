import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePlatformAdminAccess } from '@/components/platform-admin/PlatformAdminShell';
import { Link } from '@/lib/router';
import { platformAdminApi, platformAdminErrorMessage } from '@/lib/platformAdminApi';
import type { PlatformOverview } from './types';
import { AdminError, AdminLoading, AdminPageHeader, AdminStatus, formatAdminDate, SummaryStrip } from './shared';

export function PlatformAdminOverviewPage() {
  const access = usePlatformAdminAccess();
  const [data, setData] = useState<PlatformOverview | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    try {
      setData(await platformAdminApi<PlatformOverview>('/api/platform-admin/overview'));
      setError('');
    } catch (reason) {
      setError(platformAdminErrorMessage(reason, 'Could not load the platform overview.'));
    } finally {
      if (!quiet) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const productRows = data ? [
    ['Surveys', data.product.surveys],
    ['Responses', data.product.responses],
    ['Campaigns', data.product.campaigns],
    ['Agreements', data.product.agreements],
    ['Knowledge bases', data.product.knowledgeBases],
    ['Open recovery tickets', data.product.openTickets]
  ] : [];

  return <div className="space-y-6">
    <AdminPageHeader
      title="Platform overview"
      description="A privacy-safe operating view of accounts, spaces, subscriptions, and product volume."
      actions={<Button variant="outline" size="sm" disabled={refreshing} onClick={() => void load()}><RefreshCw className={refreshing ? 'animate-spin' : ''} />Refresh</Button>}
    />
    {error && <AdminError message={error} onRetry={() => void load()} />}
    {!data ? !error && <AdminLoading /> : data && <>
      <SummaryStrip items={[
        { label: 'Accounts', value: data.accounts.total, note: `${data.accounts.new30d} joined in 30 days` },
        { label: 'Active spaces', value: data.spaces.active, note: `${data.spaces.total} total` },
        { label: 'Pending requests', value: data.subscriptions.pendingRequests, note: 'Awaiting a decision' },
        { label: 'Active subscriptions', value: data.subscriptions.active, note: `${data.subscriptions.suspended} suspended` }
      ]} />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="overflow-hidden rounded-lg border bg-card" aria-labelledby="platform-volume-heading">
          <div className="flex items-center justify-between gap-4 border-b px-5 py-4"><div><h2 id="platform-volume-heading" className="section-title">Product volume</h2><p className="mt-1 text-xs text-muted-foreground">Counts only; customer content is never shown here.</p></div>{access.capabilities.readAnalytics && <Button asChild variant="ghost" size="sm"><Link to="/admin/analytics">Analytics<ArrowRight /></Link></Button>}</div>
          <table className="data-table"><thead><tr><th>Area</th><th className="text-right">Records</th></tr></thead><tbody>{productRows.map(([label, value]) => <tr key={String(label)}><td className="font-medium">{label}</td><td className="text-right tabular-nums">{value}</td></tr>)}</tbody></table>
        </section>

        <div className="space-y-6">
          <section className="rounded-lg border bg-card" aria-labelledby="account-health-heading">
            <div className="border-b px-5 py-4"><h2 id="account-health-heading" className="section-title">Account health</h2></div>
            <dl className="divide-y text-sm">{[
              ['Active', data.accounts.active], ['Restricted', data.accounts.restricted], ['Unverified email', data.accounts.unverified]
            ].map(([label, value]) => <div className="flex items-center justify-between gap-4 px-5 py-3" key={String(label)}><dt className="text-muted-foreground">{label}</dt><dd className="font-semibold tabular-nums">{value}</dd></div>)}</dl>
          </section>

          <section className="rounded-lg border bg-card" aria-labelledby="ai-queue-heading">
            <div className="border-b px-5 py-4"><h2 id="ai-queue-heading" className="section-title">AI job states</h2></div>
            {Object.keys(data.aiQueue).length ? <div className="divide-y">{Object.entries(data.aiQueue).map(([state, count]) => <div className="flex items-center justify-between gap-4 px-5 py-3" key={state}><AdminStatus value={state} /><span className="text-sm font-semibold tabular-nums">{count}</span></div>)}</div> : <p className="px-5 py-8 text-center text-sm text-muted-foreground">No AI jobs have been recorded.</p>}
          </section>
        </div>
      </div>
      <p className="text-right text-xs text-muted-foreground">Snapshot generated {formatAdminDate(data.generatedAt)} · refreshes every 30 seconds</p>
    </>}
  </div>;
}
