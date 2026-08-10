'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, Building2, CheckCircle2, Loader2, Plus, Save } from 'lucide-react';

import { listTaxJurisdictions, TaxJurisdictionSummary } from '@/lib/payrollTax';
import {
  createPayrollEmployerEntity,
  listPayrollEmployerEntities,
  listTaxAdapterCandidates,
  PayrollEmployerEntity,
  TaxAdapterCandidate,
} from '@/lib/payrollEmployerEntities';

const emptyForm = {
  code: '',
  legalName: '',
  employerType: 'company' as const,
  countryCode: 'NG',
  jurisdictionCode: 'NG-LA',
  defaultCurrency: 'NGN',
  status: 'draft' as const,
  taxJurisdictionConfigId: '',
  taxJurisdictionVersionId: '',
  taxAdapterCandidateId: 'NG_2026_WAVE_1',
  authorityCode: '',
  registrationType: 'PAYE employer registration',
  registrationReference: '',
  evidenceReference: '',
  effectiveFrom: '2026-01-01',
};

export default function EmployerEntitiesPage() {
  const [entities, setEntities] = useState<PayrollEmployerEntity[]>([]);
  const [candidates, setCandidates] = useState<TaxAdapterCandidate[]>([]);
  const [jurisdictions, setJurisdictions] = useState<TaxJurisdictionSummary[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [entityRows, candidateRows, jurisdictionRows] = await Promise.all([
        listPayrollEmployerEntities(),
        listTaxAdapterCandidates(),
        listTaxJurisdictions(),
      ]);
      setEntities(entityRows);
      setCandidates(candidateRows);
      setJurisdictions(jurisdictionRows);
    } catch (loadError: any) {
      setError(loadError?.response?.data?.error || loadError?.message || 'Failed to load legal employers.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const matchingCandidates = useMemo(() => candidates.filter((candidate) => (
    candidate.countryCode === form.countryCode
    && candidate.jurisdictionCode === form.jurisdictionCode
    && candidate.currency === form.defaultCurrency
  )), [candidates, form.countryCode, form.defaultCurrency, form.jurisdictionCode]);

  const matchingJurisdictions = useMemo(() => jurisdictions.filter((jurisdiction) => (
    jurisdiction.countryCode === form.countryCode
  )), [form.countryCode, jurisdictions]);

  const chooseJurisdiction = (id: string) => {
    const jurisdiction = jurisdictions.find((row) => row._id === id);
    const published = jurisdiction?.publishedVersion;
    setForm((current) => ({
      ...current,
      taxJurisdictionConfigId: id,
      taxJurisdictionVersionId: published?._id || '',
      defaultCurrency: published?.calculationCurrency || current.defaultCurrency,
    }));
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await createPayrollEmployerEntity({
        code: form.code,
        legalName: form.legalName,
        employerType: form.employerType,
        countryCode: form.countryCode,
        jurisdictionCode: form.jurisdictionCode,
        defaultCurrency: form.defaultCurrency,
        status: form.status,
        taxJurisdictionConfigId: form.taxJurisdictionConfigId || null,
        taxJurisdictionVersionId: form.taxJurisdictionVersionId || null,
        taxAdapterCandidateId: form.taxAdapterCandidateId,
        taxRegistrations: form.authorityCode ? [{
          authorityCode: form.authorityCode,
          registrationType: form.registrationType,
          registrationReference: form.registrationReference,
          evidenceReference: form.evidenceReference,
          effectiveFrom: form.effectiveFrom,
          status: 'unverified',
        }] : [],
      });
      setForm(emptyForm);
      setShowForm(false);
      await load();
    } catch (saveError: any) {
      setError(saveError?.response?.data?.error || saveError?.message || 'Failed to save legal employer.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-8 text-zinc-200">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <Link href="/dashboard" className="mb-2 inline-flex min-h-11 items-center gap-2 text-sm text-zinc-400 hover:text-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400">
              <ArrowLeft className="h-4 w-4" /> Dashboard
            </Link>
            <h1 className="text-2xl font-semibold text-zinc-100">Legal employers</h1>
            <p className="mt-1 max-w-3xl text-sm text-zinc-400">
              Keep Nigerian companies, UK subsidiaries and other registered employers in separate statutory payrolls. An entity does not become runnable until its published tax pack and registration gates pass.
            </p>
          </div>
          <button type="button" onClick={() => setShowForm((value) => !value)} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-amber-500 px-4 text-sm font-medium text-zinc-950 hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300">
            <Plus className="h-4 w-4" /> Add legal employer
          </button>
        </div>

        {error ? <div role="alert" className="mb-5 border border-red-500/40 bg-red-950/30 p-4 text-sm text-red-200">{error}</div> : null}

        {showForm ? (
          <form onSubmit={save} className="mb-6 border border-zinc-800 bg-zinc-900 p-5">
            <h2 className="text-base font-semibold text-zinc-100">New legal employer</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <label className="text-sm text-zinc-300">Code<input required value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5" /></label>
              <label className="text-sm text-zinc-300 md:col-span-2">Registered legal name<input required value={form.legalName} onChange={(event) => setForm({ ...form, legalName: event.target.value })} className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5" /></label>
              <label className="text-sm text-zinc-300">Employer type<select value={form.employerType} onChange={(event) => setForm({ ...form, employerType: event.target.value as typeof form.employerType })} className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5"><option value="company">Company</option><option value="subsidiary">Subsidiary</option><option value="registered_branch">Registered branch</option><option value="employer_of_record">Employer of record</option></select></label>
              <label className="text-sm text-zinc-300">Country<input required maxLength={2} value={form.countryCode} onChange={(event) => setForm({ ...form, countryCode: event.target.value.toUpperCase() })} className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5" /></label>
              <label className="text-sm text-zinc-300">Jurisdiction<input required value={form.jurisdictionCode} onChange={(event) => setForm({ ...form, jurisdictionCode: event.target.value.toUpperCase() })} className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5" /></label>
              <label className="text-sm text-zinc-300">Currency<input required maxLength={3} value={form.defaultCurrency} onChange={(event) => setForm({ ...form, defaultCurrency: event.target.value.toUpperCase() })} className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5" /></label>
              <label className="text-sm text-zinc-300 md:col-span-2">Published tax pack<select value={form.taxJurisdictionConfigId} onChange={(event) => chooseJurisdiction(event.target.value)} className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5"><option value="">No pack selected</option>{matchingJurisdictions.map((row) => <option key={row._id} value={row._id}>{row.displayName} — {row.publishedVersion?.calculationStatus || 'not published'}</option>)}</select></label>
              <label className="text-sm text-zinc-300">Tested adapter<select value={form.taxAdapterCandidateId} onChange={(event) => setForm({ ...form, taxAdapterCandidateId: event.target.value })} className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5"><option value="">No adapter selected</option>{matchingCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.displayName}</option>)}</select></label>
              <label className="text-sm text-zinc-300">Tax authority code<input value={form.authorityCode} onChange={(event) => setForm({ ...form, authorityCode: event.target.value })} placeholder="LIRS or HMRC" className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5" /></label>
              <label className="text-sm text-zinc-300">Registration reference<input value={form.registrationReference} onChange={(event) => setForm({ ...form, registrationReference: event.target.value })} className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5" /></label>
              <label className="text-sm text-zinc-300">Evidence reference<input value={form.evidenceReference} onChange={(event) => setForm({ ...form, evidenceReference: event.target.value })} className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5" /></label>
            </div>
            <div className="mt-5 flex justify-end gap-3"><button type="button" onClick={() => setShowForm(false)} className="min-h-11 rounded-lg border border-zinc-700 px-4 text-sm">Cancel</button><button disabled={saving} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-amber-500 px-4 text-sm font-medium text-zinc-950 disabled:opacity-60">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save draft</button></div>
          </form>
        ) : null}

        {loading ? <div className="flex min-h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-amber-400" /></div> : (
          <div className="overflow-x-auto border border-zinc-800">
            <table className="w-full min-w-[780px] text-left text-sm">
              <thead className="bg-zinc-900 text-zinc-400"><tr><th className="px-4 py-3 font-medium">Legal employer</th><th className="px-4 py-3 font-medium">Jurisdiction</th><th className="px-4 py-3 font-medium">Tax pack</th><th className="px-4 py-3 font-medium">Payroll state</th></tr></thead>
              <tbody className="divide-y divide-zinc-800">{entities.map((entity) => <tr key={entity._id} className="bg-zinc-950"><td className="px-4 py-4"><div className="flex items-start gap-3"><Building2 className="mt-0.5 h-5 w-5 text-zinc-500" /><div><p className="font-medium text-zinc-100">{entity.legalName}</p><p className="mt-1 text-xs text-zinc-500">{entity.code} · {entity.employerType.replace(/_/g, ' ')}</p></div></div></td><td className="px-4 py-4"><p>{entity.jurisdictionCode}</p><p className="mt-1 text-xs text-zinc-500">{entity.defaultCurrency}</p></td><td className="px-4 py-4"><p>{entity.payrollReadiness.taxPack?.label || 'Not bound'}</p><p className="mt-1 text-xs text-zinc-500">{entity.taxAdapterCandidateId || 'No tested adapter'}</p></td><td className="px-4 py-4"><div className="flex items-center gap-2">{entity.payrollReadiness.payrollRunnable ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <AlertTriangle className="h-4 w-4 text-amber-400" />}<span className="font-medium">{entity.payrollReadiness.mode.replace(/_/g, ' ')}</span></div>{entity.payrollReadiness.blockingIssues.length ? <ul className="mt-2 max-w-lg space-y-1 text-xs text-zinc-500">{entity.payrollReadiness.blockingIssues.map((issue) => <li key={issue}>• {issue}</li>)}</ul> : null}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
