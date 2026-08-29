'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import api from '@/lib/api';

type Policy = { _id: string; name: string; isDefault: boolean; active: boolean; requireSeparationOfDuties: boolean; levels: Array<{ name: string; roles: string[]; minimumApprovals: number }> };
type Contact = { _id: string; name: string; email: string; active: boolean };
type Employer = { _id: string; legalName: string; jurisdictionCode: string };
type ManualOvertimePolicy = { approvalRequired: boolean; requireSeparationOfDuties: boolean; defaultOvertimeMultiplier: number; allowMultiplierOverride: boolean; requireEvidenceReference: boolean; preventTimesheetOverlap: boolean; maximumHoursPerRequest: number; approverRoles: Array<'hr_admin' | 'line_manager'> };

export default function PayrollWorkflowSettingsPage() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [employers, setEmployers] = useState<Employer[]>([]);
  const [contact, setContact] = useState({ name: '', email: '', employerEntityId: '' });
  const [policyName, setPolicyName] = useState('');
  const [approvalRequired, setApprovalRequired] = useState(true);
  const [separationOfDuties, setSeparationOfDuties] = useState(true);
  const [approvalLevels, setApprovalLevels] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const [manualOvertimePolicy, setManualOvertimePolicy] = useState<ManualOvertimePolicy | null>(null);

  const load = useCallback(async () => {
    try {
      const [policyResponse, contactResponse, employerResponse, manualOvertimeResponse] = await Promise.all([api.get('/payroll/approval-policies'), api.get('/payroll/accounting-contacts'), api.get('/payroll/employer-entities'), api.get('/compensation/policy')]);
      setPolicies(policyResponse.data || []); setContacts(contactResponse.data || []); setEmployers(employerResponse.data?.entities || []); setManualOvertimePolicy(manualOvertimeResponse.data); setError('');
    } catch (requestError: any) { setError(requestError?.response?.data?.error || 'Unable to load workflow settings.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const addContact = async (event: FormEvent) => {
    event.preventDefault(); setSaving('contact');
    try { await api.post('/payroll/accounting-contacts', { ...contact, employerEntityId: contact.employerEntityId || null }); setContact({ name: '', email: '', employerEntityId: '' }); await load(); }
    catch (requestError: any) { setError(requestError?.response?.data?.error || 'Contact could not be saved.'); }
    finally { setSaving(''); }
  };
  const addPolicy = async (event: FormEvent) => {
    event.preventDefault(); setSaving('policy');
    try {
      await api.post('/payroll/approval-policies', { name: policyName, isDefault: policies.length === 0, approvalRequired, requireSeparationOfDuties: separationOfDuties, automaticRelease: true, deliverAccountingOnRelease: true, levels: Array.from({ length: approvalLevels }, (_, index) => ({ name: `Payroll approval ${index + 1}`, roles: ['owner', 'admin', 'hr_manager'], minimumApprovals: 1 })) });
      setPolicyName(''); await load();
    } catch (requestError: any) { setError(requestError?.response?.data?.error || 'Policy could not be saved.'); }
    finally { setSaving(''); }
  };
  const deactivate = async (kind: 'approval-policies' | 'accounting-contacts', id: string) => {
    setSaving(id);
    try { await api.delete(`/payroll/${kind}/${id}`); await load(); }
    catch (requestError: any) { setError(requestError?.response?.data?.error || 'Item could not be removed.'); }
    finally { setSaving(''); }
  };
  const updatePolicy = async (id: string, value: Partial<Policy>) => {
    setSaving(id);
    try { await api.put(`/payroll/approval-policies/${id}`, value); await load(); }
    catch (requestError: any) { setError(requestError?.response?.data?.error || 'Policy could not be updated.'); }
    finally { setSaving(''); }
  };
  const testContact = async (id: string) => {
    setSaving(id);
    try { await api.post(`/payroll/accounting-contacts/${id}/test`); }
    catch (requestError: any) { setError(requestError?.response?.data?.error || 'Test notification failed.'); }
    finally { setSaving(''); }
  };
  const saveManualOvertimePolicy = async () => {
    if (!manualOvertimePolicy) return;
    setSaving('manual-overtime');
    try { await api.put('/compensation/policy', manualOvertimePolicy); await load(); }
    catch (requestError: any) { setError(requestError?.response?.data?.error || 'Manual overtime policy could not be saved.'); }
    finally { setSaving(''); }
  };

  if (loading) return <main className="min-h-screen bg-zinc-950 grid place-items-center"><Loader2 className="h-7 w-7 animate-spin text-amber-400" /></main>;
  return <main className="min-h-screen bg-zinc-950 px-6 py-8 text-zinc-200"><div className="mx-auto max-w-4xl">
    <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-zinc-400"><ArrowLeft className="h-4 w-4" /> Dashboard</Link><h1 className="mt-3 text-2xl font-semibold">Payroll workflow</h1><p className="mt-1 text-sm text-zinc-500">Configure approval controls and recipients for released accounting files.</p>
    {error && <div role="alert" className="mt-5 border border-red-500/30 bg-red-950/20 px-4 py-3 text-sm text-red-200">{error}</div>}
    <section className="mt-6 border border-zinc-800 bg-zinc-900/50"><div className="border-b border-zinc-800 px-5 py-4"><h2 className="font-medium">Approval policies</h2><p className="mt-1 text-sm text-zinc-500">Organization owners and administrators can always submit and fully approve. Separation of duties applies to other configured approvers.</p></div><div className="divide-y divide-zinc-800">{policies.map(policy => <div key={policy._id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"><div><p className="text-sm text-zinc-200">{policy.name}{policy.isDefault ? ' · Default' : ''}</p><p className="text-xs text-zinc-500">{policy.levels.length} level{policy.levels.length === 1 ? '' : 's'} · non-admin separation of duties {policy.requireSeparationOfDuties ? 'on' : 'off'}</p></div><div className="flex gap-3">{!policy.isDefault && <button onClick={() => updatePolicy(policy._id, { isDefault: true })} disabled={!!saving} className="text-xs text-zinc-300">Make default</button>}<button onClick={() => updatePolicy(policy._id, { requireSeparationOfDuties: !policy.requireSeparationOfDuties })} disabled={!!saving} className="text-xs text-zinc-300">Toggle non-admin self-approval</button>{!policy.isDefault && policy.active && <button onClick={() => deactivate('approval-policies', policy._id)} disabled={!!saving} className="text-xs text-red-300">Remove</button>}</div></div>)}</div><form onSubmit={addPolicy} className="grid gap-3 border-t border-zinc-800 p-5 sm:grid-cols-2"><input required placeholder="Policy name" value={policyName} onChange={event => setPolicyName(event.target.value)} className="min-h-11 border border-zinc-700 bg-zinc-950 px-3 text-sm" /><label className="text-xs text-zinc-500">Approval levels<select value={approvalLevels} onChange={event => setApprovalLevels(Number(event.target.value))} className="mt-1 min-h-10 w-full border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-200"><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label><label className="flex items-center gap-2 text-sm text-zinc-300"><input type="checkbox" checked={approvalRequired} onChange={event => setApprovalRequired(event.target.checked)} /> Require approval</label><label className="flex items-center gap-2 text-sm text-zinc-300"><input type="checkbox" checked={separationOfDuties} onChange={event => setSeparationOfDuties(event.target.checked)} /> Block non-admin submitter self-approval</label><button disabled={!!saving} className="min-h-11 bg-amber-500 px-4 text-sm font-semibold text-zinc-950 sm:col-span-2">Add policy</button></form></section>
    {manualOvertimePolicy && <section className="mt-5 border border-zinc-800 bg-zinc-900/50"><div className="border-b border-zinc-800 px-5 py-4"><h2 className="font-medium">Manual overtime</h2><p className="mt-1 text-sm text-zinc-500">These seeded tenant defaults govern off-system hours before they can enter a payroll run.</p></div><div className="grid gap-4 p-5 sm:grid-cols-2">
      <label className="flex items-start gap-2 text-sm text-zinc-300"><input type="checkbox" checked={manualOvertimePolicy.approvalRequired} onChange={event => setManualOvertimePolicy({ ...manualOvertimePolicy, approvalRequired: event.target.checked })} /><span>Require approval<span className="block text-xs text-zinc-500">When off, valid requests enter payroll as approved.</span></span></label>
      <label className="flex items-start gap-2 text-sm text-zinc-300"><input type="checkbox" checked={manualOvertimePolicy.requireSeparationOfDuties} onChange={event => setManualOvertimePolicy({ ...manualOvertimePolicy, requireSeparationOfDuties: event.target.checked })} /><span>Block submitter self-approval<span className="block text-xs text-zinc-500">Keeps an independent reviewer in the approval path.</span></span></label>
      <label className="flex items-start gap-2 text-sm text-zinc-300"><input type="checkbox" checked={manualOvertimePolicy.preventTimesheetOverlap} onChange={event => setManualOvertimePolicy({ ...manualOvertimePolicy, preventTimesheetOverlap: event.target.checked })} /><span>Prevent timesheet overlap<span className="block text-xs text-zinc-500">Stops manual and transferred overtime paying the same period twice.</span></span></label>
      <label className="flex items-start gap-2 text-sm text-zinc-300"><input type="checkbox" checked={manualOvertimePolicy.requireEvidenceReference} onChange={event => setManualOvertimePolicy({ ...manualOvertimePolicy, requireEvidenceReference: event.target.checked })} /><span>Require supporting reference<span className="block text-xs text-zinc-500">Calendar, CRM, ticket, or document reference.</span></span></label>
      <label className="text-xs text-zinc-500">Default multiplier<input type="number" min="1" max="3" step="0.25" value={manualOvertimePolicy.defaultOvertimeMultiplier} onChange={event => setManualOvertimePolicy({ ...manualOvertimePolicy, defaultOvertimeMultiplier: Number(event.target.value) })} className="mt-1 min-h-10 w-full border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-200" /></label>
      <label className="text-xs text-zinc-500">Maximum hours per request<input type="number" min="0.25" max="24" step="0.25" value={manualOvertimePolicy.maximumHoursPerRequest} onChange={event => setManualOvertimePolicy({ ...manualOvertimePolicy, maximumHoursPerRequest: Number(event.target.value) })} className="mt-1 min-h-10 w-full border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-200" /></label>
      <label className="text-xs text-zinc-500 sm:col-span-2">Who can approve<select value={manualOvertimePolicy.approverRoles.includes('line_manager') ? manualOvertimePolicy.approverRoles.includes('hr_admin') ? 'both' : 'line_manager' : 'hr_admin'} onChange={event => setManualOvertimePolicy({ ...manualOvertimePolicy, approverRoles: event.target.value === 'both' ? ['line_manager', 'hr_admin'] : [event.target.value as 'hr_admin' | 'line_manager'] })} className="mt-1 min-h-10 w-full border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-200"><option value="hr_admin">HR administrators</option><option value="line_manager">The employee’s line manager</option><option value="both">Line managers and HR administrators</option></select><span className="mt-1 block">Line managers only see and decide requests for their direct reports.</span></label>
      <label className="flex items-center gap-2 text-sm text-zinc-300 sm:col-span-2"><input type="checkbox" checked={manualOvertimePolicy.allowMultiplierOverride} onChange={event => setManualOvertimePolicy({ ...manualOvertimePolicy, allowMultiplierOverride: event.target.checked })} />Allow requesters to choose a multiplier</label>
      <button type="button" onClick={saveManualOvertimePolicy} disabled={!!saving} className="min-h-11 bg-amber-500 px-4 text-sm font-semibold text-zinc-950 sm:col-span-2">{saving === 'manual-overtime' ? 'Saving…' : 'Save manual overtime policy'}</button>
    </div></section>}
    <section className="mt-5 border border-zinc-800 bg-zinc-900/50"><div className="border-b border-zinc-800 px-5 py-4"><h2 className="font-medium">Accounting contacts</h2><p className="mt-1 text-sm text-zinc-500">Active contacts receive private, expiring download links after payroll release.</p></div><div className="divide-y divide-zinc-800">{contacts.map(item => <div key={item._id} className="flex items-center justify-between gap-4 px-5 py-3"><div><p className="text-sm text-zinc-200">{item.name}</p><p className="text-xs text-zinc-500">{item.email}</p></div>{item.active && <div className="flex gap-3"><button onClick={() => testContact(item._id)} disabled={!!saving} className="text-xs text-zinc-300">Test notification</button><button onClick={() => deactivate('accounting-contacts', item._id)} disabled={!!saving} className="text-xs text-red-300">Remove</button></div>}</div>)}{!contacts.length && <p className="px-5 py-5 text-sm text-zinc-500">No accounting contacts configured.</p>}</div><form onSubmit={addContact} className="grid gap-3 border-t border-zinc-800 p-5 sm:grid-cols-2"><input required placeholder="Contact name" value={contact.name} onChange={event => setContact(value => ({ ...value, name: event.target.value }))} className="min-h-11 border border-zinc-700 bg-zinc-950 px-3 text-sm" /><input required type="email" placeholder="accounting@example.com" value={contact.email} onChange={event => setContact(value => ({ ...value, email: event.target.value }))} className="min-h-11 border border-zinc-700 bg-zinc-950 px-3 text-sm" /><select aria-label="Accounting contact legal employer" value={contact.employerEntityId} onChange={event => setContact(value => ({ ...value, employerEntityId: event.target.value }))} className="min-h-11 border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-200"><option value="">All legal employers</option>{employers.map(employer => <option key={employer._id} value={employer._id}>{employer.legalName} · {employer.jurisdictionCode}</option>)}</select><button disabled={!!saving} className="min-h-11 bg-amber-500 px-4 text-sm font-semibold text-zinc-950">Add contact</button></form></section>
  </div></main>;
}
