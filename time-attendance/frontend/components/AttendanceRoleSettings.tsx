'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, ShieldCheck, UserCog } from 'lucide-react';
import { attendanceAccessApi } from '@/lib/api';

type Role = {
    key: string;
    name: string;
    description?: string;
    scope: 'self' | 'reports' | 'organization';
    permissions: string[];
    locked?: boolean;
};

type Person = { userId: string; name?: string; email?: string; role?: string; roleKeys: string[] };

const PERMISSION_LABELS: Record<string, string> = {
    'management.view': 'Management workspace',
    'team.view': 'Team attendance',
    'timesheets.approve': 'Approve timesheets',
    'corrections.review': 'Approve corrections',
    'reports.view': 'Reports',
    'policy.view': 'View policy settings',
    'policy.manage': 'Change policy settings',
};

export default function AttendanceRoleSettings() {
    const [roles, setRoles] = useState<Role[]>([]);
    const [editablePermissions, setEditablePermissions] = useState<string[]>([]);
    const [people, setPeople] = useState<Person[]>([]);
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');
    const assignableRoles = useMemo(() => roles.filter(role => !role.locked), [roles]);

    useEffect(() => {
        void attendanceAccessApi.getPolicy().then(data => {
            setRoles(data.policy?.roles || []);
            setEditablePermissions(data.editablePermissions || []);
        }).finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        const timeout = window.setTimeout(() => {
            void attendanceAccessApi.searchPeople(query).then(data => setPeople(data.people || [])).catch(() => setPeople([]));
        }, 250);
        return () => window.clearTimeout(timeout);
    }, [query]);

    const togglePermission = (roleKey: string, permission: string) => {
        setRoles(current => current.map(role => role.key !== roleKey ? role : {
            ...role,
            permissions: role.permissions.includes(permission)
                ? role.permissions.filter(value => value !== permission)
                : [...role.permissions, permission],
        }));
    };

    const saveRoles = async () => {
        setSaving(true);
        setMessage('');
        try {
            const data = await attendanceAccessApi.updatePolicy(roles.map(role => ({ key: role.key, permissions: role.permissions })));
            setRoles(data.policy?.roles || roles);
            setMessage('Attendance role permissions saved. The change is in the audit log.');
        } finally {
            setSaving(false);
        }
    };

    const togglePersonRole = async (person: Person, roleKey: string) => {
        const roleKeys = person.roleKeys.includes(roleKey)
            ? person.roleKeys.filter(value => value !== roleKey)
            : [...person.roleKeys, roleKey];
        setPeople(current => current.map(item => item.userId === person.userId ? { ...item, roleKeys } : item));
        setMessage('');
        try {
            await attendanceAccessApi.assignPerson(person.userId, roleKeys);
            setMessage(`${person.name || person.email || 'Employee'} access updated and audited.`);
        } catch (error) {
            setPeople(current => current.map(item => item.userId === person.userId ? person : item));
            setMessage(error instanceof Error ? error.message : 'The role assignment could not be saved.');
        }
    };

    if (loading) return <section className="rounded-lg border border-[var(--suite-line)] bg-[var(--suite-surface)] p-5"><p className="text-sm text-[var(--suite-muted)]">Loading attendance roles…</p></section>;

    return <section aria-labelledby="attendance-role-heading" className="rounded-lg border border-[var(--suite-line-strong)] bg-[var(--suite-surface)] p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 text-teal-600 dark:text-teal-400" />
                <div><h2 id="attendance-role-heading" className="text-lg font-semibold text-[var(--suite-ink)]">Attendance roles and permissions</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--suite-muted)]">Seeded roles map Identity Provider administrators, HR managers and line managers into Time &amp; Attendance. Only Attendance Admins can change this matrix or grant an additional attendance role.</p></div>
            </div>
            <button type="button" onClick={saveRoles} disabled={saving} className="shrink-0 rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50 dark:bg-teal-600">{saving ? 'Saving…' : 'Save role rules'}</button>
        </div>
        {message && <p role="status" className="mt-4 rounded-md border border-emerald-600/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">{message}</p>}

        <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                <thead><tr className="border-b border-[var(--suite-line-strong)]"><th className="px-3 py-2 font-semibold text-[var(--suite-ink)]">Permission</th>{roles.map(role => <th key={role.key} className="px-3 py-2 font-semibold text-[var(--suite-ink)]"><span className="block">{role.name}</span><span className="mt-0.5 block text-xs font-normal capitalize text-[var(--suite-muted)]">{role.scope} scope{role.locked ? ' · fixed' : ''}</span></th>)}</tr></thead>
                <tbody>{editablePermissions.map(permission => <tr key={permission} className="border-b border-[var(--suite-line)] last:border-0"><th className="px-3 py-3 font-medium text-[var(--suite-ink)]">{PERMISSION_LABELS[permission] || permission}</th>{roles.map(role => <td key={role.key} className="px-3 py-3"><input type="checkbox" aria-label={`${role.name}: ${PERMISSION_LABELS[permission] || permission}`} checked={role.permissions.includes(permission)} disabled={role.locked} onChange={() => togglePermission(role.key, permission)} className="h-4 w-4 accent-teal-600 disabled:opacity-50" /></td>)}</tr>)}</tbody>
            </table>
        </div>

        <div className="mt-7 border-t border-[var(--suite-line)] pt-6">
            <div className="flex gap-3"><UserCog className="mt-0.5 h-5 w-5 text-[var(--suite-muted)]" /><div><h3 className="font-semibold text-[var(--suite-ink)]">Additional role assignments</h3><p className="mt-1 text-sm text-[var(--suite-muted)]">Use this only when someone needs attendance responsibility beyond their Identity Provider role.</p></div></div>
            <label className="relative mt-4 block max-w-md"><span className="sr-only">Search organization employees</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--suite-subtle)]" /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search organization employees" className="h-10 w-full rounded-md border border-[var(--suite-line-strong)] bg-[var(--suite-canvas)] pl-9 pr-3 text-sm text-[var(--suite-ink)]" /></label>
            <div className="mt-3 divide-y divide-[var(--suite-line)] rounded-md border border-[var(--suite-line)]">{people.length ? people.slice(0, 12).map(person => <div key={person.userId} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="truncate text-sm font-medium text-[var(--suite-ink)]">{person.name || 'Unnamed employee'}</p><p className="truncate text-xs text-[var(--suite-muted)]">{person.email || person.userId}</p></div><div className="flex flex-wrap gap-4">{assignableRoles.map(role => <label key={role.key} className="flex items-center gap-2 text-xs text-[var(--suite-ink)]"><input type="checkbox" checked={person.roleKeys.includes(role.key)} onChange={() => void togglePersonRole(person, role.key)} className="h-4 w-4 accent-teal-600" />{role.name}</label>)}</div></div>) : <p className="px-4 py-5 text-sm text-[var(--suite-muted)]">No active employees match this search.</p>}</div>
        </div>
    </section>;
}
