'use client';

import { useEffect, useState } from 'react';
import { Archive, Pencil, Plus, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { leaveTypesApi } from '@/lib/api';
import { LeaveTypeDefinition } from '@/types';

type FormState = {
  name: string;
  description: string;
  defaultDays: string;
  paid: boolean;
  approval: 'inherit' | 'required' | 'automatic';
};

const emptyForm: FormState = {
  name: '', description: '', defaultDays: '0', paid: true, approval: 'inherit',
};

export default function LeaveTypesPanel() {
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeDefinition[]>([]);
  const [editing, setEditing] = useState<LeaveTypeDefinition | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function loadLeaveTypes() {
    setLoading(true);
    try {
      const response = await leaveTypesApi.getAll(true);
      setLeaveTypes(response.leaveTypes || []);
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || 'Unable to load leave types.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadLeaveTypes(); }, []);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setError('');
    setShowForm(true);
  }

  function openEdit(definition: LeaveTypeDefinition) {
    setEditing(definition);
    setForm({
      name: definition.name,
      description: definition.description || '',
      defaultDays: String(definition.defaultDays),
      paid: definition.paid,
      approval: definition.requiresApproval === null
        ? 'inherit'
        : definition.requiresApproval ? 'required' : 'automatic',
    });
    setError('');
    setShowForm(true);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    const requiresApproval = form.approval === 'inherit' ? null : form.approval === 'required';
    try {
      const payload = {
        name: form.name,
        description: form.description,
        defaultDays: Number(form.defaultDays),
        paid: form.paid,
        requiresApproval,
      };
      if (editing) await leaveTypesApi.update(editing.key, payload);
      else await leaveTypesApi.create(payload);
      setShowForm(false);
      await loadLeaveTypes();
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || 'Unable to save this leave type.');
    } finally {
      setSaving(false);
    }
  }

  async function setActive(definition: LeaveTypeDefinition, active: boolean) {
    const confirmed = active || window.confirm(`Archive ${definition.name}? It will no longer be available for new requests.`);
    if (!confirmed) return;
    setError('');
    try {
      if (active) await leaveTypesApi.update(definition.key, { active: true });
      else await leaveTypesApi.archive(definition.key);
      await loadLeaveTypes();
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || 'Unable to update this leave type.');
    }
  }

  return (
    <section aria-labelledby="leave-types-title" className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="leave-types-title" className="text-lg font-semibold">Leave types</h2>
          <p className="mt-1 text-sm text-muted-foreground">These defaults are given to organization members automatically. Individual overrides stay unchanged.</p>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4" /> Add leave type</Button>
      </div>

      {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr><th className="px-4 py-3">Leave type</th><th className="px-4 py-3">Default</th><th className="px-4 py-3">Pay</th><th className="px-4 py-3">Approval</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Actions</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {leaveTypes.map((definition) => (
              <tr key={definition.key} className={!definition.active ? 'text-muted-foreground' : ''}>
                <td className="px-4 py-4"><div className="font-medium text-foreground">{definition.name}</div><div className="mt-1 max-w-md text-xs text-muted-foreground">{definition.description || definition.key}</div></td>
                <td className="px-4 py-4 font-medium">{definition.defaultDays} days</td>
                <td className="px-4 py-4">{definition.paid ? 'Paid' : 'Unpaid'}</td>
                <td className="px-4 py-4">{definition.requiresApproval === null ? 'Organization default' : definition.requiresApproval ? 'Required' : 'Automatic'}</td>
                <td className="px-4 py-4">{definition.active ? 'Active' : 'Archived'}</td>
                <td className="px-4 py-4"><div className="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => openEdit(definition)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>{definition.active ? <Button size="sm" variant="ghost" onClick={() => setActive(definition, false)}><Archive className="h-3.5 w-3.5" /> Archive</Button> : <Button size="sm" variant="ghost" onClick={() => setActive(definition, true)}><RotateCcw className="h-3.5 w-3.5" /> Restore</Button>}</div></td>
              </tr>
            ))}
            {!loading && leaveTypes.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">No leave types configured.</td></tr>}
            {loading && <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">Loading leave types…</td></tr>}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="leave-type-form-title">
          <form onSubmit={save} className="w-full max-w-lg rounded-lg border border-border bg-background p-6 shadow-xl">
            <h3 id="leave-type-form-title" className="text-lg font-semibold">{editing ? 'Edit leave type' : 'Add leave type'}</h3>
            <div className="mt-5 space-y-4">
              <label className="block"><span className="text-sm font-medium">Name</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" placeholder="Study leave" /></label>
              <label className="block"><span className="text-sm font-medium">Description</span><textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={3} maxLength={500} className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></label>
              <label className="block"><span className="text-sm font-medium">Default days per year</span><input required type="number" min="0" max="365" step="0.5" value={form.defaultDays} onChange={(event) => setForm({ ...form, defaultDays: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" /></label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block"><span className="text-sm font-medium">Pay treatment</span><select value={form.paid ? 'paid' : 'unpaid'} onChange={(event) => setForm({ ...form, paid: event.target.value === 'paid' })} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="paid">Paid</option><option value="unpaid">Unpaid</option></select></label>
                <label className="block"><span className="text-sm font-medium">Approval</span><select value={form.approval} onChange={(event) => setForm({ ...form, approval: event.target.value as FormState['approval'] })} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="inherit">Organization default</option><option value="required">Always required</option><option value="automatic">Automatic</option></select></label>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3"><Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save leave type'}</Button></div>
          </form>
        </div>
      )}
    </section>
  );
}
