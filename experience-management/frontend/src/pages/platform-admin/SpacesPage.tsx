import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Link } from '@/lib/router';
import { normalizePlatformAdminPage, platformAdminApi, platformAdminErrorMessage, platformAdminQuery, type PlatformAdminPage } from '@/lib/platformAdminApi';
import type { PlatformSpaceSummary } from './types';
import { AdminEmptyRow, AdminError, AdminLoading, AdminPageHeader, AdminStatus, formatAdminDate, Pagination } from './shared';

const pageSize = 25;

export function PlatformAdminSpacesPage() {
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<PlatformAdminPage<PlatformSpaceSummary> | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const value = await platformAdminApi<unknown>(platformAdminQuery('/api/platform-admin/spaces', {
        search: appliedQuery,
        status,
        offset: (page - 1) * pageSize,
        limit: pageSize
      }));
      setResult(normalizePlatformAdminPage<PlatformSpaceSummary>(value, page, pageSize));
      setError('');
    } catch (cause) {
      setError(platformAdminErrorMessage(cause, 'Could not load platform spaces.'));
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
    <AdminPageHeader title="Spaces" description="Workspace ownership, member volume, access state, and subscriptions." actions={<Button size="sm" variant="outline" disabled={refreshing} onClick={() => void load()}><RefreshCw className={refreshing ? 'animate-spin' : ''} />Refresh</Button>} />
    <form onSubmit={search} className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-end">
      <div className="min-w-0 flex-1"><label htmlFor="admin-space-search" className="field-label">Search spaces</label><Input id="admin-space-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or slug" /></div>
      <div className="sm:w-44"><label htmlFor="admin-space-status" className="field-label">Space status</label><select id="admin-space-status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="all">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="archived">Archived</option></select></div>
      <Button type="submit"><Search />Search</Button>
    </form>
    {error && <AdminError message={error} onRetry={() => void load()} />}
    {!result ? !error && <AdminLoading label="Loading spaces..." /> : <div className="overflow-hidden rounded-lg border bg-card"><div className="overflow-x-auto"><table className="data-table"><thead><tr><th>Space</th><th>Status</th><th>Owner</th><th>Members</th><th>Type</th><th>Subscription</th><th>Updated</th><th>Created</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{result.items.length ? result.items.map((space) => <tr key={space.id}><td><div className="font-medium">{space.name}</div><div className="mt-0.5 text-xs text-muted-foreground">{space.slug}</div></td><td><AdminStatus value={space.status} /></td><td>{space.owner?.name || 'No owner'}</td><td className="tabular-nums">{space.memberCount}</td><td>{space.personal ? 'Personal' : 'Shared'}</td><td>{space.subscription ? <div><div className="font-medium capitalize">{space.subscription.planCode}</div><div className="mt-0.5"><AdminStatus value={space.subscription.status} /></div></div> : 'Starter default'}</td><td>{formatAdminDate(space.updatedAt)}</td><td>{formatAdminDate(space.createdAt, true)}</td><td className="text-right"><Button asChild variant="outline" size="sm"><Link to={`/admin/spaces/${space.id}`}>Open</Link></Button></td></tr>) : <AdminEmptyRow columns={9}>No spaces match these filters.</AdminEmptyRow>}</tbody></table></div><Pagination {...result} onPage={setPage} /></div>}
  </div>;
}
