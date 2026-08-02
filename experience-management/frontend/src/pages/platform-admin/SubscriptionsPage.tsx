import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { usePlatformAdminAccess } from '@/components/platform-admin/PlatformAdminShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Link } from '@/lib/router';
import {
  normalizePlatformAdminPage,
  platformAdminApi,
  platformAdminErrorMessage,
  platformAdminQuery,
  type PlatformAdminPage
} from '@/lib/platformAdminApi';
import type { PlatformSubscription } from './types';
import { AdminEmptyRow, AdminError, AdminLoading, AdminPageHeader, AdminStatus, formatAdminDate, Pagination } from './shared';

const pageSize = 25;

export function PlatformAdminSubscriptionsPage() {
  const access = usePlatformAdminAccess();
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<PlatformAdminPage<PlatformSubscription> | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const value = await platformAdminApi<unknown>(platformAdminQuery('/api/platform-admin/subscriptions', {
        search: appliedQuery,
        status,
        offset: (page - 1) * pageSize,
        limit: pageSize
      }));
      setResult(normalizePlatformAdminPage<PlatformSubscription>(value, page, pageSize));
      setError('');
    } catch (cause) {
      setError(platformAdminErrorMessage(cause, 'Could not load managed subscriptions.'));
    } finally {
      setRefreshing(false);
    }
  }, [appliedQuery, page, status]);

  useEffect(() => { void load(); }, [load]);

  function search(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setAppliedQuery(query.trim());
  }

  return <div className="space-y-6">
    <AdminPageHeader
      title="Subscriptions"
      description="Managed plans, effective dates, and account state across customer spaces."
      actions={<div className="flex gap-2"><Button asChild size="sm" variant="outline"><Link to="/admin/subscription-requests">Review requests</Link></Button><Button size="sm" variant="outline" disabled={refreshing} onClick={() => void load()}><RefreshCw className={refreshing ? 'animate-spin' : ''} />Refresh</Button></div>}
    />
    <form onSubmit={search} className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-end">
      <div className="min-w-0 flex-1"><label htmlFor="admin-subscription-search" className="field-label">Search subscriptions</label><Input id="admin-subscription-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Space or plan" /></div>
      <div className="sm:w-44"><label htmlFor="admin-subscription-status" className="field-label">Subscription status</label><select id="admin-subscription-status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="all">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="cancelled">Cancelled</option></select></div>
      <Button type="submit"><Search />Search</Button>
    </form>
    {error && <AdminError message={error} onRetry={() => void load()} />}
    {!result ? !error && <AdminLoading label="Loading subscriptions..." /> : <div className="overflow-hidden rounded-lg border bg-card"><div className="overflow-x-auto"><table className="data-table"><thead><tr><th>Space</th><th>Plan</th><th>Status</th><th>Effective</th><th>Expires</th><th>Version</th><th>Updated</th>{access.capabilities.readSpaces && <th><span className="sr-only">Action</span></th>}</tr></thead><tbody>{result.items.length ? result.items.map((subscription) => <tr key={subscription.id}><td className="font-medium">{subscription.space?.name || subscription.spaceId}</td><td>{subscription.plan?.name || subscription.planCode}</td><td><AdminStatus value={subscription.status} /></td><td>{formatAdminDate(subscription.effectiveAt, true)}</td><td>{subscription.expiresAt ? formatAdminDate(subscription.expiresAt, true) : 'No expiry'}</td><td className="tabular-nums">{subscription.version}</td><td>{formatAdminDate(subscription.updatedAt)}</td>{access.capabilities.readSpaces && <td className="text-right"><Button asChild variant="outline" size="sm"><Link to={`/admin/spaces/${subscription.spaceId}`}>Open space</Link></Button></td>}</tr>) : <AdminEmptyRow columns={access.capabilities.readSpaces ? 8 : 7}>No managed subscriptions match these filters.</AdminEmptyRow>}</tbody></table></div><Pagination {...result} onPage={setPage} /></div>}
  </div>;
}
