import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';
import { usePlatformAdminAccess } from '@/components/platform-admin/PlatformAdminShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Link } from '@/lib/router';
import { normalizePlatformAdminPage, platformAdminApi, platformAdminErrorMessage, platformAdminJson, platformAdminQuery, type PlatformAdminPage } from '@/lib/platformAdminApi';
import { platformAdminHasPermission, type PlatformAdminRole, type PlatformUserSummary } from './types';
import { AdminEmptyRow, AdminError, AdminLoading, AdminPageHeader, AdminStatus, formatAdminDate, Pagination } from './shared';

const pageSize = 25;

export function PlatformAdminUsersPage() {
  const access = usePlatformAdminAccess();
  const canCreate = platformAdminHasPermission(access, 'users.create');
  const canReadRoles = platformAdminHasPermission(access, 'roles.read');
  const canManageRoles = platformAdminHasPermission(access, 'roles.manage');
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<PlatformAdminPage<PlatformUserSummary> | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [roles, setRoles] = useState<PlatformAdminRole[]>([]);
  const [invite, setInvite] = useState({ email: '', name: '', spaceName: '', roleId: '' });
  const [inviting, setInviting] = useState(false);
  const [invitation, setInvitation] = useState<{ requestId: string; expiresAt: string; delivery: { state: 'sent' | 'failed' }; requiresPasswordSetup: boolean } | null>(null);

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
  useEffect(() => {
    if (!canReadRoles && !canManageRoles) return;
    void platformAdminApi<{ roles: PlatformAdminRole[] }>('/api/platform-admin/rbac/roles')
      .then((value) => setRoles(value.roles))
      .catch(() => setRoles([]));
  }, [canManageRoles, canReadRoles]);

  function search(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setAppliedQuery(query.trim());
  }

  async function createUser(event: FormEvent) {
    event.preventDefault();
    if (!canCreate || inviting || !invite.email.trim() || !invite.name.trim()) return;
    setInviting(true);
    try {
      const value = await platformAdminApi<{ invitation: { requestId: string; expiresAt: string; delivery: { state: 'sent' | 'failed' }; requiresPasswordSetup: boolean } }>('/api/platform-admin/users', platformAdminJson('POST', {
        email: invite.email.trim(),
        name: invite.name.trim(),
        ...(invite.spaceName.trim() ? { spaceName: invite.spaceName.trim() } : {}),
        ...(invite.roleId ? { roleId: invite.roleId } : {})
      }));
      setInvitation(value.invitation);
      setInvite({ email: '', name: '', spaceName: '', roleId: '' });
      toast.success(value.invitation.delivery.state === 'sent' ? 'User invited.' : 'User created, but invitation delivery failed.');
      await load();
    } catch (cause) {
      toast.error(platformAdminErrorMessage(cause, 'Could not create the user.'));
    } finally {
      setInviting(false);
    }
  }

  return <div className="space-y-6">
    <AdminPageHeader title="Users" description="Account access, verification, memberships, and administrator roles." actions={<Button size="sm" variant="outline" disabled={refreshing} onClick={() => void load()}><RefreshCw className={refreshing ? 'animate-spin' : ''} />Refresh</Button>} />
    {canCreate && <details className="rounded-lg border bg-card" data-testid="admin-create-user"><summary className="cursor-pointer px-5 py-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">Create and invite user</summary><form onSubmit={createUser} className="space-y-4 border-t p-5"><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><div><label className="field-label" htmlFor="admin-invite-name">Full name</label><Input id="admin-invite-name" value={invite.name} onChange={(event) => setInvite((current) => ({ ...current, name: event.target.value }))} maxLength={120} required /></div><div><label className="field-label" htmlFor="admin-invite-email">Email</label><Input id="admin-invite-email" type="email" value={invite.email} onChange={(event) => setInvite((current) => ({ ...current, email: event.target.value }))} maxLength={320} required /></div><div><label className="field-label" htmlFor="admin-invite-space">Initial space name <span className="font-normal text-muted-foreground">(optional)</span></label><Input id="admin-invite-space" value={invite.spaceName} onChange={(event) => setInvite((current) => ({ ...current, spaceName: event.target.value }))} maxLength={120} placeholder="Customer operations" /></div>{canManageRoles && <div><label className="field-label" htmlFor="admin-invite-role">Administrator role <span className="font-normal text-muted-foreground">(optional)</span></label><select id="admin-invite-role" value={invite.roleId} onChange={(event) => setInvite((current) => ({ ...current, roleId: event.target.value }))} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">No administrator role</option>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></div>}</div><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><p className="max-w-2xl text-xs leading-5 text-muted-foreground">The user receives a time-limited password setup invitation and a default space. An administrator role is granted only when selected above.</p><Button type="submit" size="sm" disabled={inviting || !invite.name.trim() || !invite.email.trim()}>{inviting ? <Loader2 className="animate-spin" /> : <Plus />}Create user</Button></div>{invitation && <div className={`border p-3 text-xs ${invitation.delivery.state === 'sent' ? 'border-emerald-500/35 text-emerald-800' : 'border-amber-500/35 text-amber-900'}`} role="status" data-testid="admin-user-invitation-result"><p className="font-medium">{invitation.delivery.state === 'sent' ? 'Invitation sent' : 'Account created; invitation delivery failed'}</p><p className="mt-1">Request {invitation.requestId} / expires {formatAdminDate(invitation.expiresAt)}</p></div>}</form></details>}
    <form onSubmit={search} className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-end">
      <div className="min-w-0 flex-1"><label htmlFor="admin-user-search" className="field-label">Search users</label><Input id="admin-user-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or email" /></div>
      <div className="sm:w-44"><label htmlFor="admin-user-status" className="field-label">Account status</label><select id="admin-user-status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:border-ring focus:ring-1 focus:ring-ring"><option value="all">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="disabled">Disabled</option></select></div>
      <Button type="submit"><Search />Search</Button>
    </form>
    {error && <AdminError message={error} onRetry={() => void load()} />}
    {!result ? !error && <AdminLoading label="Loading users..." /> : <div className="overflow-hidden rounded-lg border bg-card"><div className="overflow-x-auto"><table className="data-table"><thead><tr><th>User</th><th>Status</th><th>Verified</th><th>Onboarding</th><th>Spaces</th><th>Admin roles</th><th>Last login</th><th>Created</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{result.items.length ? result.items.map((user) => <tr key={user.id}><td><div className="font-medium">{user.name}</div><div className="mt-0.5 text-xs text-muted-foreground">{user.email}</div></td><td><AdminStatus value={user.accountStatus} /></td><td>{user.emailVerified ? 'Yes' : 'No'}</td><td>{user.onboardingCompleted ? 'Complete' : 'Not complete'}</td><td className="tabular-nums">{user.spaceCount}</td><td>{user.adminRoles?.length ? user.adminRoles.join(', ') : 'None'}</td><td>{formatAdminDate(user.lastLoginAt)}</td><td>{formatAdminDate(user.createdAt, true)}</td><td className="text-right"><Button asChild variant="outline" size="sm"><Link to={`/admin/users/${user.id}`}>Open</Link></Button></td></tr>) : <AdminEmptyRow columns={9}>No users match these filters.</AdminEmptyRow>}</tbody></table></div><Pagination {...result} onPage={setPage} /></div>}
  </div>;
}
