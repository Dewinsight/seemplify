'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import api from '@/lib/api';

type Policy = { _id: string; name: string; isDefault: boolean; active: boolean; requireSeparationOfDuties: boolean; levels: Array<{ name: string; roles: string[]; minimumApprovals: number }> };
type Contact = { _id: string; name: string; email: string; active: boolean };
type Employer = { _id: string; legalName: string; jurisdictionCode: string };

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

  const load = useCallback(async () => {
    try {
      const [policyResponse, contactResponse, employerResponse] = await Promise.all([api.get('/payroll/approval-policies'), api.get('/payroll/accounting-contacts'), api.get('/payroll/employer-entities')]);
      setPolicies(policyResponse.data || []); setContacts(contactResponse.data || []); setEmployers(employerResponse.data?.entities || []); setError('');
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

  if (loading) return <main className="min-h-screen bg-zinc-950 grid place-items-center"><Loader2 className="h-7 w-7 animate-spin text-amber-400" /></main>;
  return <main className="min-h-screen bg-zinc-950 px-6 py-8 text-zinc-200"><div className="mx-auto max-w-4xl">
    <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-zinc-400"><ArrowLeft className="h-4 w-4" /> Dashboard</Link><h1 className="mt-3 text-2xl font-semibold">Payroll workflow</h1><p className="mt-1 text-sm text-zinc-500">Configure approval controls and recipients for released accounting files.</p>
    {error && <div role="alert" className="mt-5 border border-red-500/30 bg-red-950/20 px-4 py-3 text-sm text-red-200">{error}</div>}
    <section className="mt-6 border border-zinc-800 bg-zinc-900/50"><div className="border-b border-zinc-800 px-5 py-4"><h2 className="font-medium">Approval policies</h2><p className="mt-1 text-sm text-zinc-500">Organization owners and administrators can always submit and fully approve. Separation of duties applies to other configured approvers.</p></div><div className="divide-y divide-zinc-800">{policies.map(policy => <div key={policy._id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"><div><p className="text-sm text-zinc-200">{policy.name}{policy.isDefault ? ' · Default' : ''}</p><p className="text-xs text-zinc-500">{policy.levels.length} level{policy.levels.length === 1 ? '' : 's'} · non-admin separation of duties {policy.requireSeparationOfDuties ? 'on' : 'off'}</p></div><div className="flex gap-3">{!policy.isDefault && <button onClick={() => updatePolicy(policy._id, { isDefault: true })} disabled={!!saving} className="text-xs text-zinc-300">Make default</button>}<button onClick={() => updatePolicy(policy._id, { requireSeparationOfDuties: !policy.requireSeparationOfDuties })} disabled={!!saving} className="text-xs text-zinc-300">Toggle non-admin self-approval</button>{!policy.isDefault && policy.active && <button onClick={() => deactivate('approval-policies', policy._id)} disabled={!!saving} className="text-xs text-red-300">Remove</button>}</div></div>)}</div><form onSubmit={addPolicy} className="grid gap-3 border-t border-zinc-800 p-5 sm:grid-cols-2"><input required placeholder="Policy name" value={policyName} onChange={event => setPolicyName(event.target.value)} className="min-h-11 border border-zinc-700 bg-zinc-950 px-3 text-sm" /><label className="text-xs text-zinc-500">Approval levels<select value={approvalLevels} onChange={event => setApprovalLevels(Number(event.target.value))} className="mt-1 min-h-10 w-full border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-200"><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label><label className="flex items-center gap-2 text-sm text-zinc-300"><input type="checkbox" checked={approvalRequired} onChange={event => setApprovalRequired(event.target.checked)} /> Require approval</label><label className="flex items-center gap-2 text-sm text-zinc-300"><input type="checkbox" checked={separationOfDuties} onChange={event => setSeparationOfDuties(event.target.checked)} /> Block non-admin submitter self-approval</label><button disabled={!!saving} className="min-h-11 bg-amber-500 px-4 text-sm font-semibold text-zinc-950 sm:col-span-2">Add policy</button></form></section>
    <section className="mt-5 border border-zinc-800 bg-zinc-900/50"><div className="border-b border-zinc-800 px-5 py-4"><h2 className="font-medium">Accounting contacts</h2><p className="mt-1 text-sm text-zinc-500">Active contacts receive private, expiring download links after payroll release.</p></div><div className="divide-y divide-zinc-800">{contacts.map(item => <div key={item._id} className="flex items-center justify-between gap-4 px-5 py-3"><div><p className="text-sm text-zinc-200">{item.name}</p><p className="text-xs text-zinc-500">{item.email}</p></div>{item.active && <div className="flex gap-3"><button onClick={() => testContact(item._id)} disabled={!!saving} className="text-xs text-zinc-300">Test notification</button><button onClick={() => deactivate('accounting-contacts', item._id)} disabled={!!saving} className="text-xs text-red-300">Remove</button></div>}</div>)}{!contacts.length && <p className="px-5 py-5 text-sm text-zinc-500">No accounting contacts configured.</p>}</div><form onSubmit={addContact} className="grid gap-3 border-t border-zinc-800 p-5 sm:grid-cols-2"><input required placeholder="Contact name" value={contact.name} onChange={event => setContact(value => ({ ...value, name: event.target.value }))} className="min-h-11 border border-zinc-700 bg-zinc-950 px-3 text-sm" /><input required type="email" placeholder="accounting@example.com" value={contact.email} onChange={event => setContact(value => ({ ...value, email: event.target.value }))} className="min-h-11 border border-zinc-700 bg-zinc-950 px-3 text-sm" /><select aria-label="Accounting contact legal employer" value={contact.employerEntityId} onChange={event => setContact(value => ({ ...value, employerEntityId: event.target.value }))} className="min-h-11 border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-200"><option value="">All legal employers</option>{employers.map(employer => <option key={employer._id} value={employer._id}>{employer.legalName} · {employer.jurisdictionCode}</option>)}</select><button disabled={!!saving} className="min-h-11 bg-amber-500 px-4 text-sm font-semibold text-zinc-950">Add contact</button></form></section>
  </div></main>;
}
