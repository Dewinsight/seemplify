import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, KeyRound, Loader2, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Link, useParams } from '@/lib/router';
import { platformAdminApi, platformAdminErrorMessage, platformAdminJson } from '@/lib/platformAdminApi';
import type { PlatformAdminMe, PlatformUserDetail } from './types';
import { AdminEmptyRow, AdminError, AdminLoading, AdminPageHeader, AdminStatus, formatAdminDate } from './shared';

const platformRoleOptions = ['support', 'billing_approver', 'analyst', 'superadmin'] as const;

export function PlatformAdminUserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<PlatformUserDetail | null>(null);
  const [admin, setAdmin] = useState<PlatformAdminMe | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [working, setWorking] = useState('');
  const [status, setStatus] = useState('active');
  const [reason, setReason] = useState('');
  const [platformRole, setPlatformRole] = useState<(typeof platformRoleOptions)[number]>('support');
  const [roleReason, setRoleReason] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setRefreshing(true);
    try {
      const [next, me] = await Promise.all([
        platformAdminApi<PlatformUserDetail>(`/api/platform-admin/users/${encodeURIComponent(id)}`),
        platformAdminApi<PlatformAdminMe>('/api/platform-admin/me')
      ]);
      setDetail(next);
      setAdmin(me);
      setStatus(next.user.accountStatus);
      setError('');
    } catch (cause) {
      setError(platformAdminErrorMessage(cause, 'Could not load this user.'));
    } finally {
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function changeStatus() {
    if (!id || reason.trim().length < 5) return;
    if (!window.confirm(`Change this account to ${status}? Existing sessions may stop working.`)) return;
    setWorking('status');
    try {
      await platformAdminApi(`/api/platform-admin/users/${encodeURIComponent(id)}/status`, platformAdminJson('PATCH', { status, reason: reason.trim() }));
      toast.success('Account status updated.');
      setReason('');
      await load();
    } catch (cause) {
      toast.error(platformAdminErrorMessage(cause, 'Could not update the account.'));
    } finally {
      setWorking('');
    }
  }

  async function revokeSessions() {
    if (!id || reason.trim().length < 5) return;
    if (!window.confirm('Revoke every active session for this user?')) return;
    setWorking('sessions');
    try {
      await platformAdminApi(`/api/platform-admin/users/${encodeURIComponent(id)}/revoke-sessions`, platformAdminJson('POST', { reason: reason.trim() }));
      toast.success('Active sessions revoked.');
      setReason('');
    } catch (cause) {
      toast.error(platformAdminErrorMessage(cause, 'Could not revoke sessions.'));
    } finally {
      setWorking('');
    }
  }

  async function grantPlatformRole() {
    if (!id || roleReason.trim().length < 5) return;
    if (!window.confirm(`Grant the ${platformRole.replaceAll('_', ' ')} platform role to this user?`)) return;
    setWorking('role-grant');
    try {
      await platformAdminApi(`/api/platform-admin/users/${encodeURIComponent(id)}/platform-roles`, platformAdminJson('POST', {
        role: platformRole,
        reason: roleReason.trim()
      }));
      toast.success('Platform role granted.');
      setRoleReason('');
      await load();
    } catch (cause) {
      toast.error(platformAdminErrorMessage(cause, 'Could not grant the platform role.'));
    } finally {
      setWorking('');
    }
  }

  async function revokePlatformRole(assignment: PlatformUserDetail['roleAssignments'][number]) {
    if (!id || roleReason.trim().length < 5) return;
    if (!window.confirm(`Revoke the ${assignment.role.replaceAll('_', ' ')} platform role from this user?`)) return;
    setWorking(`role-revoke:${assignment.id}`);
    try {
      await platformAdminApi(`/api/platform-admin/users/${encodeURIComponent(id)}/platform-roles/${encodeURIComponent(assignment.id)}`, platformAdminJson('DELETE', {
        reason: roleReason.trim()
      }));
      toast.success('Platform role revoked.');
      setRoleReason('');
      await load();
    } catch (cause) {
      toast.error(platformAdminErrorMessage(cause, 'Could not revoke the platform role.'));
    } finally {
      setWorking('');
    }
  }

  const user = detail?.user;
  const isConfiguredRoot = Boolean(user?.rootPlatformAdmin || ((admin?.isRoot ?? admin?.root) && admin?.user.id === user?.id));
  const activeRoles = new Set(detail?.roleAssignments.filter((assignment) => assignment.active).map((assignment) => assignment.role) || []);
  return <div className="space-y-6">
    <Button asChild variant="ghost" size="sm" className="-ml-3"><Link to="/admin/users"><ArrowLeft />All users</Link></Button>
    <AdminPageHeader title={user?.name || 'User detail'} description={user?.email || 'Account, memberships, roles, and access controls.'} actions={<Button variant="outline" size="sm" disabled={refreshing} onClick={() => void load()}><RefreshCw className={refreshing ? 'animate-spin' : ''} />Refresh</Button>} />
    {error && <AdminError message={error} onRetry={() => void load()} />}
    {!detail ? !error && <AdminLoading label="Loading user..." /> : user && <>
      <section className="rounded-lg border bg-card" aria-labelledby="account-heading"><div className="border-b px-5 py-4"><h2 id="account-heading" className="section-title">Account</h2></div><dl className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">{[
        ['Status', <AdminStatus value={user.accountStatus} />],
        ['Email verified', user.emailVerified ? 'Yes' : 'No'],
        ['Onboarding', user.onboardingCompleted ? 'Complete' : 'Not complete'],
        ['Spaces', user.spaceCount],
        ['Platform roles', isConfiguredRoot ? 'Superadmin (configured root)' : user.platformRoles.length ? user.platformRoles.join(', ') : 'None'],
        ['Last login', formatAdminDate(user.lastLoginAt)],
        ['Created', formatAdminDate(user.createdAt)],
        ['Updated', formatAdminDate(user.updatedAt)]
      ].map(([label, value]) => <div className="bg-card p-4" key={String(label)}><dt className="text-xs font-medium text-muted-foreground">{label}</dt><dd className="mt-1.5 text-sm">{value}</dd></div>)}</dl></section>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="overflow-hidden rounded-lg border bg-card" aria-labelledby="user-spaces-heading"><div className="border-b px-5 py-4"><h2 id="user-spaces-heading" className="section-title">Space memberships</h2></div><div className="overflow-x-auto"><table className="data-table"><thead><tr><th>Space</th><th>Status</th><th>Role</th><th>Joined</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{detail.memberships.length ? detail.memberships.map((membership) => <tr key={membership.space.id}><td><div className="font-medium">{membership.space.name}</div><div className="mt-0.5 text-xs text-muted-foreground">{membership.space.slug}</div></td><td><AdminStatus value={membership.space.status} /></td><td className="capitalize">{membership.role}</td><td>{formatAdminDate(membership.joinedAt, true)}</td><td className="text-right"><Button asChild variant="outline" size="sm"><Link to={`/admin/spaces/${membership.space.id}`}>Open</Link></Button></td></tr>) : <AdminEmptyRow columns={5}>This user does not belong to a space.</AdminEmptyRow>}</tbody></table></div></section>

        <div className="space-y-6">
          {admin?.capabilities.manageAccounts && <section className="rounded-lg border bg-card" aria-labelledby="user-access-heading"><div className="border-b px-5 py-4"><h2 id="user-access-heading" className="section-title">Access controls</h2><p className="mt-1 text-xs text-muted-foreground">Every change is recorded in the audit log.</p></div><div className="space-y-4 p-5"><div><label className="field-label" htmlFor="admin-user-new-status">Account status</label><select id="admin-user-new-status" value={status} onChange={(event) => setStatus(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="active">Active</option><option value="suspended">Suspended</option><option value="disabled">Disabled</option></select></div><div><label className="field-label" htmlFor="admin-user-reason">Required reason</label><Input id="admin-user-reason" value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} placeholder="At least 5 characters" /></div><div className="flex flex-wrap gap-2"><Button size="sm" disabled={working !== '' || reason.trim().length < 5 || status === user.accountStatus} onClick={() => void changeStatus()}>{working === 'status' ? <Loader2 className="animate-spin" /> : <Save />}Apply status</Button><Button size="sm" variant="outline" disabled={working !== '' || reason.trim().length < 5} onClick={() => void revokeSessions()}>{working === 'sessions' ? <Loader2 className="animate-spin" /> : <KeyRound />}Revoke sessions</Button></div></div></section>}

          <section className="rounded-lg border bg-card" aria-labelledby="platform-role-heading"><div className="border-b px-5 py-4"><h2 id="platform-role-heading" className="section-title">Platform roles</h2><p className="mt-1 text-xs text-muted-foreground">Roles control which platform-wide records and actions this user can access.</p></div>{admin?.capabilities.manageRoles && <div className="space-y-3 border-b p-5"><div><label className="field-label" htmlFor="admin-platform-role">Role to grant</label><select id="admin-platform-role" value={platformRole} onChange={(event) => setPlatformRole(event.target.value as (typeof platformRoleOptions)[number])} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">{platformRoleOptions.map((role) => <option key={role} value={role}>{role.replaceAll('_', ' ')}</option>)}</select></div><div><label className="field-label" htmlFor="admin-platform-role-reason">Required reason for role changes</label><Input id="admin-platform-role-reason" value={roleReason} maxLength={1000} onChange={(event) => setRoleReason(event.target.value)} placeholder="At least 5 characters" /></div><Button type="button" size="sm" disabled={working !== '' || roleReason.trim().length < 5 || activeRoles.has(platformRole)} onClick={() => void grantPlatformRole()}>{working === 'role-grant' ? <Loader2 className="animate-spin" /> : <Plus />}Grant role</Button></div>}{detail.roleAssignments.length ? <div className="divide-y">{detail.roleAssignments.map((assignment) => <div className="px-5 py-3" key={assignment.id}><div className="flex items-center justify-between gap-3"><span className="text-sm font-medium capitalize">{assignment.role.replaceAll('_', ' ')}</span><div className="flex items-center gap-2"><AdminStatus value={assignment.active ? 'active' : 'revoked'} />{admin?.capabilities.manageRoles && assignment.active && <Button type="button" variant="ghost" size="sm" aria-label={`Revoke ${assignment.role.replaceAll('_', ' ')} role`} disabled={working !== '' || roleReason.trim().length < 5} onClick={() => void revokePlatformRole(assignment)}>{working === `role-revoke:${assignment.id}` ? <Loader2 className="animate-spin" /> : <Trash2 />}Revoke</Button>}</div></div><div className="mt-1 text-xs text-muted-foreground">Granted {formatAdminDate(assignment.grantedAt)}{assignment.revokedAt ? ` · revoked ${formatAdminDate(assignment.revokedAt)}` : ''}</div>{assignment.reason && <p className="mt-2 text-xs leading-5 text-muted-foreground">{assignment.reason}</p>}</div>)}</div> : <p className="p-5 text-sm text-muted-foreground">No platform role assignments.</p>}</section>
        </div>
      </div>
    </>}
  </div>;
}
