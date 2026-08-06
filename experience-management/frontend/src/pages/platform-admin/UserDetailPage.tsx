import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, KeyRound, Loader2, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Link, useParams } from '@/lib/router';
import { platformAdminApi, platformAdminErrorMessage, platformAdminJson } from '@/lib/platformAdminApi';
import {
  platformAdminHasPermission, type PlatformAdminMe, type PlatformAdminRole,
  type PlatformAdminRoleAssignment, type PlatformUserDetail
} from './types';
import { AdminEmptyRow, AdminError, AdminLoading, AdminPageHeader, AdminStatus, formatAdminDate } from './shared';

export function PlatformAdminUserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<PlatformUserDetail | null>(null);
  const [admin, setAdmin] = useState<PlatformAdminMe | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [working, setWorking] = useState('');
  const [status, setStatus] = useState('active');
  const [reason, setReason] = useState('');
  const [roles, setRoles] = useState<PlatformAdminRole[]>([]);
  const [adminRoleAssignments, setAdminRoleAssignments] = useState<PlatformAdminRoleAssignment[]>([]);
  const [roleId, setRoleId] = useState('');
  const [roleReason, setRoleReason] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setRefreshing(true);
    try {
      const [next, me] = await Promise.all([
        platformAdminApi<PlatformUserDetail>(`/api/platform-admin/users/${encodeURIComponent(id)}`),
        platformAdminApi<PlatformAdminMe>('/api/platform-admin/me')
      ]);
      if (platformAdminHasPermission(me, 'roles.read')) {
        const [catalog, assignments] = await Promise.all([
          platformAdminApi<{ roles: PlatformAdminRole[] }>('/api/platform-admin/rbac/roles'),
          platformAdminApi<{ userId: string; assignments: PlatformAdminRoleAssignment[] }>(`/api/platform-admin/users/${encodeURIComponent(id)}/admin-roles`)
        ]);
        setRoles(catalog.roles);
        setAdminRoleAssignments(assignments.assignments);
        setRoleId((current) => catalog.roles.some((role) => role.id === current) ? current : (catalog.roles[0]?.id || ''));
      } else {
        setRoles([]);
        setAdminRoleAssignments([]);
      }
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

  async function grantAdminRole() {
    if (!id || roleReason.trim().length < 5) return;
    const role = roles.find((item) => item.id === roleId);
    if (!role || !window.confirm(`Assign the ${role.name} administrator role to this user?`)) return;
    setWorking('role-grant');
    try {
      await platformAdminApi(`/api/platform-admin/users/${encodeURIComponent(id)}/admin-roles`, platformAdminJson('POST', {
        roleId,
        reason: roleReason.trim()
      }));
      toast.success('Administrator role assigned.');
      setRoleReason('');
      await load();
    } catch (cause) {
      toast.error(platformAdminErrorMessage(cause, 'Could not assign the administrator role.'));
    } finally {
      setWorking('');
    }
  }

  async function revokeAdminRole(assignment: PlatformAdminRoleAssignment) {
    if (!id || roleReason.trim().length < 5) return;
    if (!window.confirm(`Revoke the ${assignment.roleName} administrator role from this user?`)) return;
    setWorking(`role-revoke:${assignment.id}`);
    try {
      await platformAdminApi(`/api/platform-admin/users/${encodeURIComponent(id)}/admin-roles/${encodeURIComponent(assignment.id)}`, platformAdminJson('DELETE', {
        reason: roleReason.trim()
      }));
      toast.success('Administrator role revoked.');
      setRoleReason('');
      await load();
    } catch (cause) {
      toast.error(platformAdminErrorMessage(cause, 'Could not revoke the administrator role.'));
    } finally {
      setWorking('');
    }
  }

  const user = detail?.user;
  const canReadRoles = platformAdminHasPermission(admin, 'roles.read');
  const canManageRoles = platformAdminHasPermission(admin, 'roles.manage');
  const activeRoles = new Set(adminRoleAssignments.filter((assignment) => assignment.active).map((assignment) => assignment.roleId));
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
        ['Administrator roles', user.adminRoles?.length ? user.adminRoles.join(', ') : 'None'],
        ['Last login', formatAdminDate(user.lastLoginAt)],
        ['Created', formatAdminDate(user.createdAt)],
        ['Updated', formatAdminDate(user.updatedAt)]
      ].map(([label, value]) => <div className="bg-card p-4" key={String(label)}><dt className="text-xs font-medium text-muted-foreground">{label}</dt><dd className="mt-1.5 text-sm">{value}</dd></div>)}</dl></section>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="overflow-hidden rounded-lg border bg-card" aria-labelledby="user-spaces-heading"><div className="border-b px-5 py-4"><h2 id="user-spaces-heading" className="section-title">Space memberships</h2></div><div className="overflow-x-auto"><table className="data-table"><thead><tr><th>Space</th><th>Status</th><th>Role</th><th>Joined</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{detail.memberships.length ? detail.memberships.map((membership) => <tr key={membership.space.id}><td><div className="font-medium">{membership.space.name}</div><div className="mt-0.5 text-xs text-muted-foreground">{membership.space.slug}</div></td><td><AdminStatus value={membership.space.status} /></td><td className="capitalize">{membership.role}</td><td>{formatAdminDate(membership.joinedAt, true)}</td><td className="text-right"><Button asChild variant="outline" size="sm"><Link to={`/admin/spaces/${membership.space.id}`}>Open</Link></Button></td></tr>) : <AdminEmptyRow columns={5}>This user does not belong to a space.</AdminEmptyRow>}</tbody></table></div></section>

        <div className="space-y-6">
          {platformAdminHasPermission(admin, 'users.manage') && <section className="rounded-lg border bg-card" aria-labelledby="user-access-heading"><div className="border-b px-5 py-4"><h2 id="user-access-heading" className="section-title">Access controls</h2><p className="mt-1 text-xs text-muted-foreground">Every change is recorded in the audit log.</p></div><div className="space-y-4 p-5"><div><label className="field-label" htmlFor="admin-user-new-status">Account status</label><select id="admin-user-new-status" value={status} onChange={(event) => setStatus(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="active">Active</option><option value="suspended">Suspended</option><option value="disabled">Disabled</option></select></div><div><label className="field-label" htmlFor="admin-user-reason">Required reason</label><Input id="admin-user-reason" value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} placeholder="At least 5 characters" /></div><div className="flex flex-wrap gap-2"><Button size="sm" disabled={working !== '' || reason.trim().length < 5 || status === user.accountStatus} onClick={() => void changeStatus()}>{working === 'status' ? <Loader2 className="animate-spin" /> : <Save />}Apply status</Button><Button size="sm" variant="outline" disabled={working !== '' || reason.trim().length < 5} onClick={() => void revokeSessions()}>{working === 'sessions' ? <Loader2 className="animate-spin" /> : <KeyRound />}Revoke sessions</Button></div></div></section>}

          {canReadRoles && <section className="rounded-lg border bg-card" aria-labelledby="admin-role-heading" data-testid="admin-user-role-assignments"><div className="border-b px-5 py-4"><h2 id="admin-role-heading" className="section-title">Administrator roles</h2><p className="mt-1 text-xs text-muted-foreground">Control-plane roles are separate from this user&apos;s workspace memberships.</p></div>{canManageRoles && <div className="space-y-3 border-b p-5"><div><label className="field-label" htmlFor="admin-user-role">Role to assign</label><select id="admin-user-role" value={roleId} onChange={(event) => setRoleId(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></div><div><label className="field-label" htmlFor="admin-user-role-reason">Required reason for role changes</label><Input id="admin-user-role-reason" value={roleReason} maxLength={1000} onChange={(event) => setRoleReason(event.target.value)} placeholder="At least 5 characters" /></div><Button type="button" size="sm" disabled={working !== '' || !roleId || roleReason.trim().length < 5 || activeRoles.has(roleId)} onClick={() => void grantAdminRole()}>{working === 'role-grant' ? <Loader2 className="animate-spin" /> : <Plus />}Assign role</Button></div>}{adminRoleAssignments.length ? <div className="divide-y">{adminRoleAssignments.map((assignment) => <div className="px-5 py-3" key={assignment.id}><div className="flex items-center justify-between gap-3"><span className="text-sm font-medium">{assignment.roleName}</span><div className="flex items-center gap-2"><AdminStatus value={assignment.active ? 'active' : 'revoked'} />{canManageRoles && assignment.active && <Button type="button" variant="ghost" size="sm" aria-label={`Revoke ${assignment.roleName} role`} disabled={working !== '' || roleReason.trim().length < 5} onClick={() => void revokeAdminRole(assignment)}>{working === `role-revoke:${assignment.id}` ? <Loader2 className="animate-spin" /> : <Trash2 />}Revoke</Button>}</div></div><div className="mt-1 text-xs text-muted-foreground">Assigned {formatAdminDate(assignment.assignedAt)}{assignment.revokedAt ? ` / revoked ${formatAdminDate(assignment.revokedAt)}` : ''}</div>{assignment.reason && <p className="mt-2 text-xs leading-5 text-muted-foreground">Assigned because: {assignment.reason}</p>}{assignment.revocationReason && <p className="mt-1 text-xs leading-5 text-muted-foreground">Revoked because: {assignment.revocationReason}</p>}</div>)}</div> : <p className="p-5 text-sm text-muted-foreground">No administrator role assignments.</p>}</section>}
        </div>
      </div>
    </>}
  </div>;
}
