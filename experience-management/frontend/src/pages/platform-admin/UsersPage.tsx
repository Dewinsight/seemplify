import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Link } from '@/lib/router';
import { normalizePlatformAdminPage, platformAdminApi, platformAdminErrorMessage, platformAdminQuery, type PlatformAdminPage } from '@/lib/platformAdminApi';
import type { PlatformUserSummary } from './types';
import { AdminEmptyRow, AdminError, AdminLoading, AdminPageHeader, AdminStatus, formatAdminDate, Pagination } from './shared';

const pageSize = 25;

export function PlatformAdminUsersPage() {
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<PlatformAdminPage<PlatformUserSummary> | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const value = await platformAdminApi<unknown>(platformAdminQuery('/api/platform-admin/users', {
        search: appliedQuery,
        status,
        offset: (page - 1) * pageSize,
        limit: pageSize
      }));
      setResult(normalizePlatformAdminPage<PlatformUserSummary>(value, page, pageSize));
      setError('');
    } catch (reason) {
      setError(platformAdminErrorMessage(reason, 'Could not load platform users.'));
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
    <AdminPageHeader title="Users" description="Account access, verification, memberships, and platform roles." actions={<Button size="sm" variant="outline" disabled={refreshing} onClick={() => void load()}><RefreshCw className={refreshing ? 'animate-spin' : ''} />Refresh</Button>} />
    <form onSubmit={search} className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-end">
      <div className="min-w-0 flex-1"><label htmlFor="admin-user-search" className="field-label">Search users</label><Input id="admin-user-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or email" /></div>
      <div className="sm:w-44"><label htmlFor="admin-user-status" className="field-label">Account status</label><select id="admin-user-status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:border-ring focus:ring-1 focus:ring-ring"><option value="all">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="disabled">Disabled</option></select></div>
      <Button type="submit"><Search />Search</Button>
    </form>
    {error && <AdminError message={error} onRetry={() => void load()} />}
    {!result ? !error && <AdminLoading label="Loading users..." /> : <div className="overflow-hidden rounded-lg border bg-card"><div className="overflow-x-auto"><table className="data-table"><thead><tr><th>User</th><th>Status</th><th>Verified</th><th>Onboarding</th><th>Spaces</th><th>Platform roles</th><th>Last login</th><th>Created</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{result.items.length ? result.items.map((user) => <tr key={user.id}><td><div className="font-medium">{user.name}</div><div className="mt-0.5 text-xs text-muted-foreground">{user.email}</div></td><td><AdminStatus value={user.accountStatus} /></td><td>{user.emailVerified ? 'Yes' : 'No'}</td><td>{user.onboardingCompleted ? 'Complete' : 'Not complete'}</td><td className="tabular-nums">{user.spaceCount}</td><td>{user.platformRoles.length ? user.platformRoles.join(', ') : 'None'}</td><td>{formatAdminDate(user.lastLoginAt)}</td><td>{formatAdminDate(user.createdAt, true)}</td><td className="text-right"><Button asChild variant="outline" size="sm"><Link to={`/admin/users/${user.id}`}>Open</Link></Button></td></tr>) : <AdminEmptyRow columns={9}>No users match these filters.</AdminEmptyRow>}</tbody></table></div><Pagination {...result} onPage={setPage} /></div>}
  </div>;
}
