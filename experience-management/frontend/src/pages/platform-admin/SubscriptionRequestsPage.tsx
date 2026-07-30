import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Link } from '@/lib/router';
import { normalizePlatformAdminPage, platformAdminApi, platformAdminErrorMessage, platformAdminQuery, type PlatformAdminPage } from '@/lib/platformAdminApi';
import type { PlatformSubscriptionRequest } from './types';
import { AdminEmptyRow, AdminError, AdminLoading, AdminPageHeader, AdminStatus, formatAdminDate, Pagination } from './shared';

const pageSize = 25;

export function PlatformAdminSubscriptionRequestsPage() {
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<PlatformAdminPage<PlatformSubscriptionRequest> | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const value = await platformAdminApi<unknown>(platformAdminQuery('/api/platform-admin/subscription-requests', {
        search: appliedQuery,
        status,
        offset: (page - 1) * pageSize,
        limit: pageSize
      }));
      setResult(normalizePlatformAdminPage<PlatformSubscriptionRequest>(value, page, pageSize));
      setError('');
    } catch (cause) {
      setError(platformAdminErrorMessage(cause, 'Could not load subscription requests.'));
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
    <AdminPageHeader title="Subscription requests" description="Review plan changes and cancellations submitted by space owners." actions={<Button size="sm" variant="outline" disabled={refreshing} onClick={() => void load()}><RefreshCw className={refreshing ? 'animate-spin' : ''} />Refresh</Button>} />
    <form onSubmit={search} className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-end">
      <div className="min-w-0 flex-1"><label htmlFor="admin-request-search" className="field-label">Search requests</label><Input id="admin-request-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Space or requested plan" /></div>
      <div className="sm:w-44"><label htmlFor="admin-request-status" className="field-label">Decision status</label><select id="admin-request-status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="pending">Pending</option><option value="all">All statuses</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="cancelled">Cancelled</option></select></div>
      <Button type="submit"><Search />Search</Button>
    </form>
    {error && <AdminError message={error} onRetry={() => void load()} />}
    {!result ? !error && <AdminLoading label="Loading subscription requests..." /> : <div className="overflow-hidden rounded-lg border bg-card"><div className="overflow-x-auto"><table className="data-table"><thead><tr><th>Space</th><th>Request</th><th>Requested plan</th><th>Requester</th><th>Status</th><th>Submitted</th><th>Decision</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{result.items.length ? result.items.map((request) => <tr key={request.id}><td className="font-medium">{request.space?.name || request.spaceId}</td><td className="capitalize">{request.requestType.replaceAll('_', ' ')}</td><td>{request.requestedPlan?.name || request.requestedPlanCode || 'Not applicable'}</td><td>{request.requestedBy?.name || 'Unknown'}</td><td><AdminStatus value={request.status} /></td><td>{formatAdminDate(request.createdAt)}</td><td>{formatAdminDate(request.decisionAt)}</td><td className="text-right"><Button asChild variant="outline" size="sm"><Link to={`/admin/subscription-requests/${request.id}`}>{request.status === 'pending' ? 'Review' : 'Open'}</Link></Button></td></tr>) : <AdminEmptyRow columns={8}>No subscription requests match these filters.</AdminEmptyRow>}</tbody></table></div><Pagination {...result} onPage={setPage} /></div>}
  </div>;
}
