import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { usePlatformAdminAccess } from '@/components/platform-admin/PlatformAdminShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { platformAdminApi, platformAdminErrorMessage, platformAdminJson } from '@/lib/platformAdminApi';
import {
  platformAdminHasPermission, type PlatformAdminRole, type PlatformPermissionDefinition,
  type PlatformPermissionId, type PlatformRbacCatalog
} from './types';
import { AdminError, AdminLoading, AdminPageHeader, formatAdminDate } from './shared';

function permissionGroup(permission: PlatformPermissionId) {
  return permission.split('.')[0].replace('_', ' ');
}

function PermissionChecklist({ permissions, selected, disabled, prefix, onChange }: {
  permissions: PlatformPermissionDefinition[];
  selected: PlatformPermissionId[];
  disabled: boolean;
  prefix: string;
  onChange: (next: PlatformPermissionId[]) => void;
}) {
  const selectedSet = new Set(selected);
  const groups = Object.entries(permissions.reduce<Record<string, PlatformPermissionDefinition[]>>((result, permission) => {
    const group = permissionGroup(permission.id);
    result[group] = [...(result[group] || []), permission];
    return result;
  }, {}));
  return <div className="space-y-4">
    {groups.map(([group, definitions]) => <fieldset key={group} className="border p-4"><legend className="px-1 text-xs font-semibold capitalize">{group}</legend><div className="grid gap-3 sm:grid-cols-2">{definitions.map((permission) => {
      const id = `${prefix}-${permission.id.replace(/[._]/g, '-')}`;
      return <label key={permission.id} htmlFor={id} className="flex items-start gap-3 text-sm"><input id={id} type="checkbox" className="mt-1 h-4 w-4 accent-foreground" checked={selectedSet.has(permission.id)} disabled={disabled} onChange={(event) => onChange(event.target.checked ? [...selected, permission.id] : selected.filter((item) => item !== permission.id))} /><span><span className="font-medium">{permission.label}</span><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{permission.description}</span></span></label>;
    })}</div></fieldset>)}
  </div>;
}

export function PlatformAdminRolesPage() {
  const access = usePlatformAdminAccess();
  const canManage = platformAdminHasPermission(access, 'roles.manage');
  const [catalog, setCatalog] = useState<PlatformRbacCatalog | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [permissionDraft, setPermissionDraft] = useState<PlatformPermissionId[]>([]);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newPermissions, setNewPermissions] = useState<PlatformPermissionId[]>([]);
  const [deleteReason, setDeleteReason] = useState('');
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [working, setWorking] = useState('');

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await platformAdminApi<PlatformRbacCatalog>('/api/platform-admin/rbac');
      setCatalog(next);
      setSelectedId((current) => next.roles.some((role) => role.id === current) ? current : (next.roles[0]?.id || ''));
      setError('');
    } catch (cause) {
      setError(platformAdminErrorMessage(cause, 'Could not load roles and permissions.'));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const selectedRole = useMemo(() => catalog?.roles.find((role) => role.id === selectedId) || null, [catalog, selectedId]);
  useEffect(() => {
    if (!selectedRole) return;
    setName(selectedRole.name);
    setDescription(selectedRole.description);
    setPermissionDraft(selectedRole.permissions);
    setDeleteReason('');
  }, [selectedRole?.id, selectedRole?.version]);

  async function createRole(event: FormEvent) {
    event.preventDefault();
    if (!canManage || newName.trim().length < 2 || working) return;
    setWorking('create');
    try {
      const value = await platformAdminApi<{ role: PlatformAdminRole }>('/api/platform-admin/rbac/roles', platformAdminJson('POST', {
        name: newName.trim(), description: newDescription.trim(), permissions: newPermissions
      }));
      toast.success('Administrator role created.');
      setNewName(''); setNewDescription(''); setNewPermissions([]);
      await load();
      setSelectedId(value.role.id);
    } catch (cause) {
      toast.error(platformAdminErrorMessage(cause, 'Could not create the role.'));
    } finally {
      setWorking('');
    }
  }

  async function saveRole() {
    if (!selectedRole || !canManage || name.trim().length < 2 || working) return;
    setWorking('save');
    try {
      let version = selectedRole.version;
      if (name.trim() !== selectedRole.name || description.trim() !== selectedRole.description) {
        const value = await platformAdminApi<{ role: PlatformAdminRole }>(`/api/platform-admin/rbac/roles/${encodeURIComponent(selectedRole.id)}`, platformAdminJson('PATCH', {
          name: name.trim(), description: description.trim(), expectedVersion: version
        }));
        version = value.role.version;
      }
      const permissionsChanged = [...permissionDraft].sort().join('|') !== [...selectedRole.permissions].sort().join('|');
      if (permissionsChanged) {
        await platformAdminApi<{ role: PlatformAdminRole }>(`/api/platform-admin/rbac/roles/${encodeURIComponent(selectedRole.id)}/permissions`, platformAdminJson('PUT', {
          permissions: permissionDraft, expectedVersion: version
        }));
      }
      toast.success('Role saved.');
      await load();
    } catch (cause) {
      toast.error(platformAdminErrorMessage(cause, 'Could not save the role. Reload and review concurrent changes.'));
    } finally {
      setWorking('');
    }
  }

  async function deleteRole() {
    if (!selectedRole || selectedRole.builtIn || !canManage || deleteReason.trim().length < 5 || working) return;
    if (!window.confirm(`Delete the ${selectedRole.name} administrator role? This cannot be undone.`)) return;
    setWorking('delete');
    try {
      await platformAdminApi(`/api/platform-admin/rbac/roles/${encodeURIComponent(selectedRole.id)}`, platformAdminJson('DELETE', { reason: deleteReason.trim() }));
      toast.success('Administrator role deleted.');
      setSelectedId('');
      await load();
    } catch (cause) {
      toast.error(platformAdminErrorMessage(cause, 'Could not delete the role.'));
    } finally {
      setWorking('');
    }
  }

  const changed = Boolean(selectedRole && (
    name.trim() !== selectedRole.name
    || description.trim() !== selectedRole.description
    || [...permissionDraft].sort().join('|') !== [...selectedRole.permissions].sort().join('|')
  ));

  return <div className="space-y-6" data-testid="platform-admin-roles">
    <AdminPageHeader title="Roles & permissions" description="Control-plane access for platform operations. Workspace roles remain separate." actions={<Button size="sm" variant="outline" disabled={refreshing} onClick={() => void load()}><RefreshCw className={refreshing ? 'animate-spin' : ''} />Refresh</Button>} />
    {error && <AdminError message={error} onRetry={() => void load()} />}
    {!catalog ? !error && <AdminLoading label="Loading administrator roles..." /> : <>
      {canManage && <details className="rounded-lg border bg-card" data-testid="admin-create-role"><summary className="cursor-pointer px-5 py-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">Create administrator role</summary><form onSubmit={createRole} className="space-y-4 border-t p-5"><div className="grid gap-4 sm:grid-cols-2"><div><label className="field-label" htmlFor="admin-new-role-name">Role name</label><Input id="admin-new-role-name" value={newName} onChange={(event) => setNewName(event.target.value)} maxLength={80} placeholder="Operations lead" /></div><div><label className="field-label" htmlFor="admin-new-role-description">Description</label><Input id="admin-new-role-description" value={newDescription} onChange={(event) => setNewDescription(event.target.value)} maxLength={500} placeholder="What this role is responsible for" /></div></div><PermissionChecklist permissions={catalog.permissions} selected={newPermissions} disabled={working !== ''} prefix="new-role" onChange={setNewPermissions} /><Button type="submit" size="sm" disabled={working !== '' || newName.trim().length < 2}>{working === 'create' ? <Loader2 className="animate-spin" /> : <Plus />}Create role</Button></form></details>}
      <div className="grid items-start gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <section className="overflow-hidden rounded-lg border bg-card" aria-labelledby="admin-role-list-heading"><div className="border-b px-4 py-3"><h2 id="admin-role-list-heading" className="section-title">Administrator roles</h2><p className="mt-1 text-xs text-muted-foreground">{catalog.roles.length} role{catalog.roles.length === 1 ? '' : 's'}</p></div><div className="divide-y">{catalog.roles.map((role) => <button type="button" key={role.id} aria-pressed={role.id === selectedId} onClick={() => setSelectedId(role.id)} className={`w-full px-4 py-3 text-left hover:bg-muted/50 ${role.id === selectedId ? 'bg-muted' : ''}`}><span className="flex items-center justify-between gap-3"><span className="text-sm font-medium">{role.name}</span>{role.builtIn && <span className="text-[11px] text-muted-foreground">Built in</span>}</span><span className="mt-1 block text-xs text-muted-foreground">{role.permissions.length} permission{role.permissions.length === 1 ? '' : 's'}</span></button>)}</div></section>
        {selectedRole && <section className="rounded-lg border bg-card" aria-labelledby="admin-role-editor-heading" data-testid={`admin-role-${selectedRole.id}`}><div className="flex flex-col justify-between gap-3 border-b px-5 py-4 sm:flex-row sm:items-start"><div><h2 id="admin-role-editor-heading" className="section-title">{selectedRole.name}</h2><p className="mt-1 text-xs text-muted-foreground">Version {selectedRole.version} / updated {formatAdminDate(selectedRole.updatedAt)}</p></div>{canManage && <Button size="sm" disabled={working !== '' || !changed || name.trim().length < 2} onClick={() => void saveRole()}>{working === 'save' ? <Loader2 className="animate-spin" /> : <Save />}Save changes</Button>}</div><div className="space-y-5 p-5"><div className="grid gap-4 sm:grid-cols-2"><div><label className="field-label" htmlFor="admin-role-name">Role name</label><Input id="admin-role-name" value={name} onChange={(event) => setName(event.target.value)} disabled={!canManage || working !== ''} maxLength={80} /></div><div><label className="field-label" htmlFor="admin-role-description">Description</label><Textarea id="admin-role-description" value={description} onChange={(event) => setDescription(event.target.value)} disabled={!canManage || working !== ''} maxLength={500} className="min-h-20" /></div></div><PermissionChecklist permissions={catalog.permissions} selected={permissionDraft} disabled={!canManage || working !== ''} prefix={`role-${selectedRole.id}`} onChange={setPermissionDraft} />{canManage && !selectedRole.builtIn && <div className="border-t pt-5"><h3 className="text-sm font-medium">Delete custom role</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">Roles with current or historical user assignments cannot be deleted.</p><div className="mt-3 flex flex-col gap-2 sm:flex-row"><Input aria-label="Reason for deleting role" value={deleteReason} onChange={(event) => setDeleteReason(event.target.value)} maxLength={1000} placeholder="Required reason, at least 5 characters" /><Button type="button" variant="destructive" disabled={working !== '' || deleteReason.trim().length < 5} onClick={() => void deleteRole()}>{working === 'delete' ? <Loader2 className="animate-spin" /> : <Trash2 />}Delete role</Button></div></div>}</div></section>}
      </div>
    </>}
  </div>;
}
