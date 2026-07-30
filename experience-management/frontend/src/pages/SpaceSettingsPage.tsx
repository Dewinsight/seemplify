import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Copy, Loader2, Plus, Settings2, Trash2, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { activeSpaceId, api, json, storeActiveSpaceId } from '@/lib/api';
import { allowConfirmedSpaceSwitchUnload, confirmDiscardForSpaceSwitch } from '@/lib/unsavedChanges';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { AuthSession, SpaceInvitation, SpaceMember, SpaceRole, SpaceSummary } from '@/types';

function invitationState(invitation: SpaceInvitation) {
  if (invitation.acceptedAt) return 'Accepted';
  if (invitation.revokedAt) return 'Revoked';
  if (Date.parse(invitation.expiresAt) <= Date.now()) return 'Expired';
  return 'Pending';
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

export function SpaceSettingsPage() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [active, setActive] = useState<SpaceSummary | null>(null);
  const [members, setMembers] = useState<SpaceMember[]>([]);
  const [invitations, setInvitations] = useState<SpaceInvitation[]>([]);
  const [name, setName] = useState('');
  const [newSpaceName, setNewSpaceName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');
  const [inviteUrl, setInviteUrl] = useState('');
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const nextSession = await api<AuthSession>('/api/auth/session');
    if (!nextSession.authenticated || !nextSession.user || !nextSession.activeSpace) return;
    const stored = activeSpaceId();
    const selected = nextSession.spaces.find((space) => space.id === stored) || nextSession.activeSpace;
    const [nextMembers, nextInvitations] = await Promise.all([
      api<SpaceMember[]>(`/api/spaces/${selected.id}/members`),
      selected.role === 'owner' || selected.role === 'admin'
        ? api<SpaceInvitation[]>(`/api/spaces/${selected.id}/invitations`)
        : Promise.resolve([])
    ]);
    setSession(nextSession);
    setActive(selected);
    setName(selected.name);
    setMembers(nextMembers);
    setInvitations(nextInvitations);
  }, []);

  useEffect(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load space settings.')); }, [load]);

  const canManage = active?.role === 'owner' || active?.role === 'admin';
  const currentUserId = session?.user?.id;
  const pendingInvitations = useMemo(() => invitations.filter((item) => invitationState(item) === 'Pending'), [invitations]);

  async function switchSpace(space: SpaceSummary) {
    if (space.id === active?.id) return;
    if (!confirmDiscardForSpaceSwitch()) return;
    try {
      setWorking(`switch:${space.id}`);
      await api(`/api/spaces/${space.id}/select`, json('POST', {}));
      allowConfirmedSpaceSwitchUnload();
      storeActiveSpaceId(space.id, false);
      window.location.replace('/settings/space');
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Could not switch space.'); setWorking(''); }
  }

  async function createNewSpace(event: FormEvent) {
    event.preventDefault();
    try {
      setWorking('create');
      const result = await api<{ space: SpaceSummary }>('/api/spaces', json('POST', { name: newSpaceName }));
      storeActiveSpaceId(result.space.id, false);
      toast.success('Space created');
      window.location.replace('/settings/space');
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Could not create the space.'); setWorking(''); }
  }

  async function rename(event: FormEvent) {
    event.preventDefault();
    if (!active || name.trim() === active.name) return;
    try {
      setWorking('rename');
      const updated = await api<SpaceSummary>(`/api/spaces/${active.id}`, json('PATCH', { name }));
      setActive(updated); setName(updated.name);
      setSession((current) => current ? { ...current, activeSpace: updated, spaces: current.spaces.map((space) => space.id === updated.id ? updated : space) } : current);
      toast.success('Space name updated');
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Could not rename the space.'); }
    finally { setWorking(''); }
  }

  async function invite(event: FormEvent) {
    event.preventDefault(); if (!active) return;
    try {
      setWorking('invite'); setInviteUrl('');
      const result = await api<{ invitation: { email: string; role: 'admin' | 'member'; expiresAt: string }; inviteUrl: string }>(`/api/spaces/${active.id}/invitations`, json('POST', { email: inviteEmail, role: inviteRole }));
      setInviteEmail(''); setInviteUrl(result.inviteUrl);
      toast.success(`Invitation created for ${result.invitation.email}`);
      await load();
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Could not create the invitation.'); }
    finally { setWorking(''); }
  }

  async function copyInvite() {
    try { await navigator.clipboard.writeText(inviteUrl); toast.success('Invitation link copied'); }
    catch { toast.error('Clipboard access is unavailable.'); }
  }

  async function updateMember(member: SpaceMember, role: SpaceRole) {
    if (!active || role === 'owner') return;
    try {
      setWorking(`member:${member.id}`);
      const updated = await api<SpaceMember[]>(`/api/spaces/${active.id}/members/${member.id}`, json('PATCH', { role }));
      setMembers(updated); toast.success(`${member.name}'s role updated`);
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Could not update the member.'); }
    finally { setWorking(''); }
  }

  async function removeMember(member: SpaceMember) {
    if (!active || !window.confirm(`Remove ${member.name} from ${active.name}?`)) return;
    try {
      setWorking(`member:${member.id}`);
      await api(`/api/spaces/${active.id}/members/${member.id}`, { method: 'DELETE' });
      setMembers((current) => current.filter((item) => item.id !== member.id));
      toast.success('Member removed');
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Could not remove the member.'); }
    finally { setWorking(''); }
  }

  async function revokeInvitation(invitation: SpaceInvitation) {
    if (!active) return;
    try {
      setWorking(`invite:${invitation.id}`);
      await api(`/api/spaces/${active.id}/invitations/${invitation.id}`, { method: 'DELETE' });
      await load(); toast.success('Invitation revoked');
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Could not revoke the invitation.'); }
    finally { setWorking(''); }
  }

  if (error) return <div className="border border-destructive/40 bg-card p-5 text-sm text-destructive" role="alert">{error}</div>;
  if (!session || !active) return <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading space settings…</div>;

  return <div className="mx-auto max-w-6xl">
    <div className="mb-6"><h1 className="page-title">Space settings</h1><p className="page-description">Manage who can access this space and keep each team’s research separate.</p></div>
    <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="self-start border bg-card" aria-label="Your spaces">
        <div className="border-b px-4 py-3"><h2 className="text-sm font-semibold">Your spaces</h2></div>
        <div className="p-2">
          {session.spaces.map((space) => <button key={space.id} type="button" onClick={() => void switchSpace(space)} disabled={working === `switch:${space.id}`} className={`w-full rounded-md px-3 py-2.5 text-left transition-colors ${space.id === active.id ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
            <span className="block truncate text-sm font-medium">{space.name}</span>
            <span className="mt-0.5 block text-[11px] capitalize">{space.role}{space.isPersonal ? ' · personal' : ''}</span>
          </button>)}
        </div>
        <form className="border-t p-4" onSubmit={createNewSpace}>
          <Label className="field-label" htmlFor="new-space-name">New space</Label>
          <Input id="new-space-name" value={newSpaceName} onChange={(event) => setNewSpaceName(event.target.value)} placeholder="Research team" minLength={2} maxLength={100} required />
          <Button className="mt-2 w-full" size="sm" variant="outline" disabled={working === 'create'}>{working === 'create' ? <Loader2 className="animate-spin" /> : <Plus />}Create space</Button>
        </form>
      </aside>

      <div className="min-w-0 space-y-6">
        <section className="border bg-card" aria-labelledby="space-general-heading">
          <div className="flex items-start gap-3 border-b px-5 py-4"><Settings2 className="mt-0.5 h-4 w-4 text-muted-foreground" /><div><h2 id="space-general-heading" className="text-sm font-semibold">General</h2><p className="mt-1 text-xs text-muted-foreground">Space ID: {active.id}</p></div></div>
          <form className="flex flex-col gap-3 p-5 sm:flex-row sm:items-end" onSubmit={rename}>
            <div className="max-w-md flex-1"><Label className="field-label" htmlFor="space-name">Space name</Label><Input id="space-name" value={name} onChange={(event) => setName(event.target.value)} disabled={!canManage} minLength={2} maxLength={100} required /></div>
            {canManage && <Button variant="outline" disabled={working === 'rename' || name.trim() === active.name}>{working === 'rename' ? <Loader2 className="animate-spin" /> : <Check />}Save name</Button>}
          </form>
        </section>

        <section className="border bg-card" aria-labelledby="members-heading">
          <div className="flex items-start gap-3 border-b px-5 py-4"><Users className="mt-0.5 h-4 w-4 text-muted-foreground" /><div><h2 id="members-heading" className="text-sm font-semibold">Members</h2><p className="mt-1 text-xs text-muted-foreground">Only people listed here can see this space’s surveys, queues, and intelligence.</p></div></div>
          <div className="overflow-x-auto"><table className="data-table"><thead><tr><th>Person</th><th>Role</th><th>Joined</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
            {members.map((member) => <tr key={member.id}><td><div className="font-medium">{member.name}{member.id === currentUserId ? ' (you)' : ''}</div><div className="mt-0.5 text-xs text-muted-foreground">{member.email}</div></td><td>{active.role === 'owner' && member.role !== 'owner' && member.id !== currentUserId ? <select aria-label={`Role for ${member.name}`} value={member.role} disabled={working === `member:${member.id}`} onChange={(event) => void updateMember(member, event.target.value as SpaceRole)} className="h-8 rounded-md border-input bg-background py-1 pl-2 pr-7 text-xs focus:border-ring focus:ring-1 focus:ring-ring"><option value="member">Member</option><option value="admin">Admin</option></select> : <span className="text-sm capitalize">{member.role}</span>}</td><td className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(member.joinedAt)}</td><td className="text-right">{canManage && member.role !== 'owner' && member.id !== currentUserId && !(active.role === 'admin' && member.role === 'admin') && <Button size="icon" variant="ghost" aria-label={`Remove ${member.name}`} disabled={working === `member:${member.id}`} onClick={() => void removeMember(member)}><Trash2 /></Button>}</td></tr>)}
          </tbody></table></div>
        </section>

        {canManage && <section className="border bg-card" aria-labelledby="invitations-heading">
          <div className="flex items-start gap-3 border-b px-5 py-4"><UserPlus className="mt-0.5 h-4 w-4 text-muted-foreground" /><div><h2 id="invitations-heading" className="text-sm font-semibold">Invitations</h2><p className="mt-1 text-xs text-muted-foreground">Links expire after seven days and only work for the invited email address.</p></div></div>
          <form className="grid gap-3 border-b p-5 sm:grid-cols-[minmax(0,1fr)_150px_auto] sm:items-end" onSubmit={invite}>
            <div><Label className="field-label" htmlFor="invite-email">Email address</Label><Input id="invite-email" type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="colleague@example.com" required /></div>
            <div><Label className="field-label" htmlFor="invite-role">Role</Label><select id="invite-role" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as 'admin' | 'member')} className="h-9 w-full rounded-md border-input bg-background py-1 pl-3 pr-8 text-sm focus:border-ring focus:ring-1 focus:ring-ring"><option value="member">Member</option><option value="admin">Admin</option></select></div>
            <Button disabled={working === 'invite'}>{working === 'invite' ? <Loader2 className="animate-spin" /> : <UserPlus />}Invite</Button>
          </form>
          {inviteUrl && <div className="border-b bg-muted/25 p-5"><Label className="field-label" htmlFor="invite-link">Share this invitation link</Label><div className="flex gap-2"><Input id="invite-link" readOnly value={inviteUrl} onFocus={(event) => event.currentTarget.select()} /><Button type="button" variant="outline" onClick={() => void copyInvite()}><Copy />Copy</Button></div></div>}
          {invitations.length > 0 ? <div className="overflow-x-auto"><table className="data-table"><thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Expires</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{invitations.map((invitation) => { const state = invitationState(invitation); return <tr key={invitation.id}><td className="font-medium">{invitation.email}</td><td className="capitalize">{invitation.role}</td><td className={state === 'Pending' ? 'text-amber-700' : 'text-muted-foreground'}>{state}</td><td className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(invitation.expiresAt)}</td><td className="text-right">{state === 'Pending' && <Button size="sm" variant="ghost" disabled={working === `invite:${invitation.id}`} onClick={() => void revokeInvitation(invitation)}>Revoke</Button>}</td></tr>; })}</tbody></table></div> : <p className="p-5 text-sm text-muted-foreground">No invitations have been created for this space.</p>}
          {pendingInvitations.length > 0 && <p className="border-t px-5 py-3 text-xs text-muted-foreground">{pendingInvitations.length} pending invitation{pendingInvitations.length === 1 ? '' : 's'}.</p>}
        </section>}
      </div>
    </div>
  </div>;
}
