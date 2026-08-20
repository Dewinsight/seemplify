'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle, Loader2, Pencil, Trash2, Users } from 'lucide-react';
import api, { handleAuthCallback, isAuthenticated } from '@/lib/api';

type Dependent = {
  _id: string; name: string; relationship: string; dateOfBirth: string;
  taxDependent: boolean; benefitEligible: boolean; isBeneficiary: boolean; beneficiaryPercentage: number;
};
type FormState = Omit<Dependent, '_id'>;
const emptyForm: FormState = { name: '', relationship: '', dateOfBirth: '', taxDependent: true, benefitEligible: true, isBeneficiary: false, beneficiaryPercentage: 0 };
const relationships = [
  ['spouse', 'Spouse'], ['domestic_partner', 'Domestic partner'], ['child', 'Child'],
  ['parent', 'Parent'], ['sibling', 'Sibling'], ['other', 'Other'],
];

export default function DependentsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dependents, setDependents] = useState<Dependent[]>([]);
  const [declaration, setDeclaration] = useState('pending');
  const [taxDependentCount, setTaxDependentCount] = useState(0);
  const [legacyDeclaredCount, setLegacyDeclaredCount] = useState(0);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const applyResponse = (data: any) => {
    setDependents(data.dependents || []);
    setDeclaration(data.declaration?.status || 'pending');
    setTaxDependentCount(Number(data.taxDependentCount || 0));
    setLegacyDeclaredCount(Number(data.legacyDeclaredCount || 0));
  };
  const load = useCallback(async () => applyResponse((await api.get('/payroll/dependents/me')).data), []);
  useEffect(() => {
    handleAuthCallback();
    if (!isAuthenticated()) { router.push('/login'); return; }
    load().catch((requestError) => setError(requestError?.response?.data?.error || 'Unable to load dependents.')).finally(() => setLoading(false));
  }, [load, router]);

  const resetForm = () => { setForm(emptyForm); setEditingId(null); setShowForm(false); setFieldErrors({}); };
  const edit = (dependent: Dependent) => {
    setForm({ ...emptyForm, ...dependent, dateOfBirth: String(dependent.dateOfBirth).slice(0, 10) });
    setEditingId(dependent._id); setShowForm(true); setMessage(''); setError(''); setFieldErrors({});
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setMessage(''); setError(''); setFieldErrors({});
    try {
      const response = editingId ? await api.put(`/payroll/dependents/${editingId}`, form) : await api.post('/payroll/dependents', form);
      applyResponse(response.data); setMessage(response.data.message || 'Dependent saved.'); resetForm();
    } catch (requestError: any) {
      setFieldErrors(requestError?.response?.data?.fieldErrors || {});
      setError(requestError?.response?.data?.error || 'Unable to save dependent.');
    } finally { setSaving(false); }
  };
  const remove = async (dependent: Dependent) => {
    if (!window.confirm(`Remove ${dependent.name} from Payroll?`)) return;
    setSaving(true); setError(''); setMessage('');
    try { const response = await api.delete(`/payroll/dependents/${dependent._id}`); applyResponse(response.data); setMessage(response.data.message); }
    catch (requestError: any) { setError(requestError?.response?.data?.error || 'Unable to remove dependent.'); }
    finally { setSaving(false); }
  };
  const declareNone = async () => {
    setSaving(true); setError(''); setMessage('');
    try { const response = await api.post('/payroll/dependents/declare-none'); applyResponse(response.data); setMessage(response.data.message); }
    catch (requestError: any) { setError(requestError?.response?.data?.error || 'Unable to save your declaration.'); }
    finally { setSaving(false); }
  };
  const field = (key: string) => fieldErrors[key] ? <span className="mt-1 block text-xs text-red-300">{fieldErrors[key]}</span> : null;

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-amber-400" /></div>;
  return <div className="mx-auto max-w-4xl space-y-6">
    <header>
      <p className="text-xs font-medium uppercase tracking-wider text-amber-400">Employee setup · Step 2 of 3</p>
      <h1 className="mt-2 text-2xl font-semibold text-white">Dependents</h1>
      <p className="mt-1 text-sm text-zinc-400">These records drive Payroll tax calculations and benefits eligibility.</p>
    </header>
    {message && <div role="status" className="border border-emerald-700 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-300">{message}</div>}
    {error && <div role="alert" className="border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</div>}

    <section className="rounded-lg border border-zinc-800 bg-zinc-900/50">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-5 py-4">
        <div><h2 className="font-medium text-white">Saved dependents</h2><p className="mt-1 text-xs text-zinc-500">{taxDependentCount} included in the current tax-dependent count</p></div>
        <button onClick={() => { resetForm(); setShowForm(true); }} className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400">Add dependent</button>
      </div>
      {dependents.length ? <div className="divide-y divide-zinc-800">
        {dependents.map((dependent) => <article key={dependent._id} className="flex items-start justify-between gap-4 px-5 py-4">
          <div><h3 className="font-medium text-zinc-100">{dependent.name}</h3><p className="mt-1 text-sm capitalize text-zinc-400">{dependent.relationship.replace('_', ' ')} · Born {new Date(dependent.dateOfBirth).toLocaleDateString()}</p><div className="mt-2 flex flex-wrap gap-2">{dependent.taxDependent && <span className="border border-sky-800 px-2 py-0.5 text-xs text-sky-300">Tax dependent</span>}{dependent.benefitEligible && <span className="border border-emerald-800 px-2 py-0.5 text-xs text-emerald-300">Benefits eligible</span>}</div></div>
          <div className="flex gap-2"><button onClick={() => edit(dependent)} aria-label={`Edit ${dependent.name}`} className="rounded-md border border-zinc-700 p-2 text-zinc-300 hover:border-zinc-500"><Pencil className="h-4 w-4" /></button><button disabled={saving} onClick={() => remove(dependent)} aria-label={`Remove ${dependent.name}`} className="rounded-md border border-zinc-700 p-2 text-zinc-300 hover:border-red-700 hover:text-red-300"><Trash2 className="h-4 w-4" /></button></div>
        </article>)}
      </div> : <div className="px-5 py-10 text-center"><Users className="mx-auto h-7 w-7 text-zinc-600" /><p className="mt-3 text-sm text-zinc-400">No dependents recorded.</p>{legacyDeclaredCount > 0 && <p className="mx-auto mt-2 max-w-lg text-xs text-amber-300">A legacy declaration of {legacyDeclaredCount} dependent(s) was found. Add or refresh the detailed records before relying on them for Payroll.</p>}{declaration === 'none' && <p className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-400"><CheckCircle className="h-3.5 w-3.5" /> No-dependents declaration saved</p>}</div>}
    </section>

    {!dependents.length && declaration !== 'none' && <section className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-5"><div><h2 className="font-medium text-white">No dependents?</h2><p className="mt-1 text-sm text-zinc-500">Confirm this so Payroll records the decision and uses a count of zero.</p></div><button disabled={saving} onClick={declareNone} className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:border-zinc-500">I have no dependents</button></section>}

    {showForm && <form onSubmit={submit} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
      <h2 className="font-medium text-white">{editingId ? 'Edit dependent' : 'Add dependent'}</h2><p className="mt-1 text-sm text-zinc-500">Required fields are validated before anything reaches Payroll.</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm text-zinc-300">Full name<input aria-invalid={Boolean(fieldErrors.name)} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="mt-1.5 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-white aria-[invalid=true]:border-red-600" />{field('name')}</label>
        <label className="text-sm text-zinc-300">Relationship<select aria-invalid={Boolean(fieldErrors.relationship)} value={form.relationship} onChange={(event) => setForm({ ...form, relationship: event.target.value })} className="mt-1.5 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-white aria-[invalid=true]:border-red-600"><option value="">Select relationship</option>{relationships.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select>{field('relationship')}</label>
        <label className="text-sm text-zinc-300">Date of birth<input type="date" aria-invalid={Boolean(fieldErrors.dateOfBirth)} value={form.dateOfBirth} onChange={(event) => setForm({ ...form, dateOfBirth: event.target.value })} className="mt-1.5 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-white aria-[invalid=true]:border-red-600" />{field('dateOfBirth')}</label>
        <label className="flex items-start gap-3 border border-zinc-800 p-3 text-sm text-zinc-300"><input type="checkbox" checked={form.taxDependent} onChange={(event) => setForm({ ...form, taxDependent: event.target.checked })} className="mt-0.5" /><span>Include in tax-dependent calculations</span></label>
        <label className="flex items-start gap-3 border border-zinc-800 p-3 text-sm text-zinc-300"><input type="checkbox" checked={form.benefitEligible} onChange={(event) => setForm({ ...form, benefitEligible: event.target.checked })} className="mt-0.5" /><span>Eligible for employee benefits</span></label>
      </div>
      <div className="mt-5 flex gap-3"><button disabled={saving} type="submit" className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50">{saving ? 'Saving…' : editingId ? 'Save changes' : 'Save dependent'}</button><button type="button" onClick={resetForm} className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:border-zinc-500">Cancel</button></div>
    </form>}

    <div className="flex justify-end"><button onClick={() => router.push('/banking')} className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:border-amber-600">Continue to banking</button></div>
  </div>;
}
