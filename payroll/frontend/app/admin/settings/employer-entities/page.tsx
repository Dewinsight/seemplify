'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, Building2, CheckCircle2, Loader2, Pencil, Plus, RotateCcw, Save, Trash2, X } from 'lucide-react';

import { useUserContext } from '@/lib/hooks';
import { PAYROLL_BANK_JURISDICTIONS } from '@/lib/payrollBankJurisdictions.mjs';
import { listTaxJurisdictions, TaxJurisdictionSummary } from '@/lib/payrollTax';
import {
  createPayrollEmployerEntity,
  listPayrollEmployerEntities,
  listTaxAdapterCandidates,
  PayrollEmployerEntity,
  PayrollEmployerEntityPayload,
  PayrollTaxRegistration,
  TaxAdapterCandidate,
  updatePayrollEmployerEntity,
} from '@/lib/payrollEmployerEntities';

type EmployerForm = {
  code: string;
  legalName: string;
  employerType: 'company' | 'subsidiary' | 'registered_branch' | 'employer_of_record';
  countryCode: string;
  jurisdictionCode: string;
  defaultCurrency: string;
  status: 'draft' | 'active' | 'inactive';
  taxJurisdictionConfigId: string;
  taxJurisdictionVersionId: string;
  taxAdapterCandidateId: string;
  authorityCode: string;
  registrationType: string;
  registrationReference: string;
  evidenceReference: string;
  effectiveFrom: string;
  registrationStatus: 'unverified' | 'reviewed' | 'revoked';
  existingRegistrations: PayrollTaxRegistration[];
};

const supportedCountries = PAYROLL_BANK_JURISDICTIONS.filter((country: any) => country.code !== 'OTHER');

function defaultForm(
  countryCode = 'NG',
  organizationName = '',
  candidates: TaxAdapterCandidate[] = [],
  jurisdictions: TaxJurisdictionSummary[] = []
): EmployerForm {
  const country = supportedCountries.find((entry: any) => entry.code === countryCode) || supportedCountries[0];
  const candidate = candidates.find((entry) => entry.countryCode === country.code && entry.currency === country.currency);
  const jurisdiction = jurisdictions.find((entry) => (
    entry.countryCode === country.code
    && entry.publishedVersion?.calculationCurrency === country.currency
  ));
  const isPayrollReady = jurisdiction?.publishedVersion?.calculationStatus === 'runnable';

  return {
    code: `${country.code}-DEFAULT`,
    legalName: organizationName,
    employerType: 'company',
    countryCode: country.code,
    jurisdictionCode: candidate?.jurisdictionCode || country.code,
    defaultCurrency: country.currency,
    status: isPayrollReady ? 'active' : 'draft',
    taxJurisdictionConfigId: jurisdiction?._id || '',
    taxJurisdictionVersionId: jurisdiction?.publishedVersion?._id || '',
    taxAdapterCandidateId: candidate?.id || '',
    authorityCode: '',
    registrationType: 'Employer payroll tax registration',
    registrationReference: '',
    evidenceReference: '',
    effectiveFrom: `${new Date().getFullYear()}-01-01`,
    registrationStatus: 'unverified',
    existingRegistrations: [],
  };
}

function formFromEntity(entity: PayrollEmployerEntity): EmployerForm {
  const registration = entity.taxRegistrations?.[0];
  return {
    code: entity.code,
    legalName: entity.legalName,
    employerType: entity.employerType,
    countryCode: entity.countryCode,
    jurisdictionCode: entity.jurisdictionCode,
    defaultCurrency: entity.defaultCurrency,
    status: entity.status,
    taxJurisdictionConfigId: entity.taxJurisdictionConfigId || '',
    taxJurisdictionVersionId: entity.taxJurisdictionVersionId || '',
    taxAdapterCandidateId: entity.taxAdapterCandidateId || '',
    authorityCode: registration?.authorityCode || '',
    registrationType: registration?.registrationType || 'Employer payroll tax registration',
    registrationReference: registration?.registrationReference || '',
    evidenceReference: registration?.evidenceReference || '',
    effectiveFrom: registration?.effectiveFrom ? new Date(registration.effectiveFrom).toISOString().slice(0, 10) : `${new Date().getFullYear()}-01-01`,
    registrationStatus: registration?.status || 'unverified',
    existingRegistrations: (entity.taxRegistrations || []).map((item) => ({ ...item })),
  };
}

export default function EmployerEntitiesPage() {
  const { organization } = useUserContext();
  const [entities, setEntities] = useState<PayrollEmployerEntity[]>([]);
  const [candidates, setCandidates] = useState<TaxAdapterCandidate[]>([]);
  const [jurisdictions, setJurisdictions] = useState<TaxJurisdictionSummary[]>([]);
  const [form, setForm] = useState<EmployerForm>(() => defaultForm());
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activatingId, setActivatingId] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
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
      if (entityRows.length === 0) {
        setForm(defaultForm('NG', organization?.name || '', candidateRows, jurisdictionRows));
        setShowForm(true);
      }
    } catch (loadError: any) {
      setError(loadError?.response?.data?.error || loadError?.message || 'Failed to load legal employers.');
    } finally {
      setLoading(false);
    }
  }, [organization?.name]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!organization?.name) return;
    setForm((current) => current.legalName ? current : { ...current, legalName: organization.name });
  }, [organization?.name]);

  const selectedCandidate = useMemo(
    () => candidates.find((candidate) => candidate.id === form.taxAdapterCandidateId),
    [candidates, form.taxAdapterCandidateId]
  );
  const selectedJurisdiction = useMemo(
    () => jurisdictions.find((jurisdiction) => jurisdiction._id === form.taxJurisdictionConfigId),
    [form.taxJurisdictionConfigId, jurisdictions]
  );

  const selectCountry = (countryCode: string) => {
    const next = defaultForm(countryCode, form.legalName || organization?.name || '', candidates, jurisdictions);
    const preserveRegistration = countryCode === form.countryCode;
    setForm({
      ...next,
      status: editingId ? form.status : next.status,
      employerType: form.employerType,
      authorityCode: preserveRegistration ? form.authorityCode : '',
      registrationType: preserveRegistration ? form.registrationType : next.registrationType,
      registrationReference: preserveRegistration ? form.registrationReference : '',
      evidenceReference: preserveRegistration ? form.evidenceReference : '',
      effectiveFrom: preserveRegistration ? form.effectiveFrom : next.effectiveFrom,
      registrationStatus: preserveRegistration ? form.registrationStatus : 'unverified',
      existingRegistrations: preserveRegistration ? form.existingRegistrations : [],
    });
  };

  const openNewForm = () => {
    setEditingId('');
    setForm(defaultForm('NG', organization?.name || '', candidates, jurisdictions));
    setError('');
    setShowForm(true);
  };

  const openEditForm = (entity: PayrollEmployerEntity) => {
    setEditingId(entity._id);
    setForm(formFromEntity(entity));
    setError('');
    setShowForm(true);
  };

  const closeForm = () => {
    setEditingId('');
    setShowForm(false);
    setError('');
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const registrationValues = [form.authorityCode, form.registrationReference, form.evidenceReference];
    const hasAnyRegistration = registrationValues.some((value) => value.trim());
    const hasCompleteRegistration = registrationValues.every((value) => value.trim());
    if (hasAnyRegistration && !hasCompleteRegistration) {
      setError('Complete the tax authority, registration reference, and evidence reference together, or leave all three blank for now.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const originalRegistration = form.existingRegistrations[0];
      const registrationChanged = !!originalRegistration && (
        originalRegistration.authorityCode !== form.authorityCode
        || originalRegistration.registrationType !== form.registrationType
        || originalRegistration.registrationReference !== form.registrationReference
        || originalRegistration.evidenceReference !== form.evidenceReference
        || new Date(originalRegistration.effectiveFrom).toISOString().slice(0, 10) !== form.effectiveFrom
      );
      const payload: PayrollEmployerEntityPayload = {
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
        taxRegistrations: hasCompleteRegistration ? [{
          ...originalRegistration,
          authorityCode: form.authorityCode,
          registrationType: form.registrationType,
          registrationReference: form.registrationReference,
          evidenceReference: form.evidenceReference,
          effectiveFrom: form.effectiveFrom,
          status: registrationChanged ? 'unverified' : form.registrationStatus,
        }, ...form.existingRegistrations.slice(1)] : form.existingRegistrations,
      };
      if (editingId) await updatePayrollEmployerEntity(editingId, payload);
      else await createPayrollEmployerEntity(payload);
      closeForm();
      await load();
    } catch (saveError: any) {
      setError(saveError?.response?.data?.error || saveError?.message || 'Failed to save legal employer.');
    } finally {
      setSaving(false);
    }
  };

  const setEntityStatus = async (entity: PayrollEmployerEntity, status: 'active' | 'inactive') => {
    if (status === 'inactive' && !window.confirm(`Remove ${entity.legalName} from active payroll setup? Historical payroll records will be preserved.`)) return;
    setActivatingId(entity._id);
    setError('');
    try {
      await updatePayrollEmployerEntity(entity._id, { status });
      await load();
    } catch (statusError: any) {
      setError(statusError?.response?.data?.error || statusError?.message || 'Failed to update this employer.');
    } finally {
      setActivatingId('');
    }
  };

  const enablePreview = async (entity: PayrollEmployerEntity) => {
    setActivatingId(entity._id);
    setError('');
    try {
      await updatePayrollEmployerEntity(entity._id, { status: 'active' });
      await load();
    } catch (activateError: any) {
      setError(activateError?.response?.data?.error || activateError?.message || 'Failed to enable this employer.');
    } finally {
      setActivatingId('');
    }
  };

  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-8 text-zinc-200">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Link href="/dashboard" className="mb-2 inline-flex min-h-11 items-center gap-2 text-sm text-zinc-400 hover:text-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400">
              <ArrowLeft className="h-4 w-4" /> Dashboard
            </Link>
            <h1 className="text-2xl font-semibold text-zinc-100">Employer setup</h1>
            <p className="mt-1 max-w-3xl text-sm text-zinc-400">
              Every released platform jurisdiction is provisioned automatically. Currency, tax pack, and calculation bindings remain editable per legal employer.
            </p>
          </div>
          {!showForm ? (
            <button type="button" onClick={openNewForm} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 text-sm font-medium text-zinc-950 hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300">
              <Plus className="h-4 w-4" /> Add employer
            </button>
          ) : null}
        </div>

        {error ? <div role="alert" className="mb-5 border border-red-500/40 bg-red-950/30 p-4 text-sm text-red-200">{error}</div> : null}

        {showForm ? (
          <form onSubmit={save} className="mb-6 border border-zinc-800 bg-zinc-900 p-5">
            <div className="flex flex-col gap-2 border-b border-zinc-800 pb-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-zinc-100">{editingId ? 'Edit employer' : 'Employer details'}</h2>
                <p className="mt-1 text-sm text-zinc-500">{editingId ? 'Update the legal identity, registration evidence, or payroll tax binding.' : form.status === 'active' ? 'This released tax pack is activated immediately; add the real registration evidence when it is available.' : 'Unreleased jurisdictions remain drafts until their statutory pack is certified.'}</p>
              </div>
              <button type="button" onClick={closeForm} aria-label="Close employer form" className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-zinc-700 text-zinc-400 hover:text-zinc-100"><X className="h-4 w-4" /></button>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="text-sm text-zinc-300">
                Payroll country
                <select value={form.countryCode} onChange={(event) => selectCountry(event.target.value)} className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5">
                  {supportedCountries.map((country: any) => <option key={country.code} value={country.code}>{country.label}</option>)}
                </select>
                <span className="mt-1 block text-xs text-zinc-500">This controls employee currency, tax rules, statutory defaults, and bank fields.</span>
              </label>
              <label className="text-sm text-zinc-300">
                Registered legal name
                <input required value={form.legalName} onChange={(event) => setForm({ ...form, legalName: event.target.value })} placeholder="Name on the company registration" className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5" />
              </label>
              <label className="text-sm text-zinc-300">
                Employer type
                <select value={form.employerType} onChange={(event) => setForm({ ...form, employerType: event.target.value as EmployerForm['employerType'] })} className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5">
                  <option value="company">Company</option><option value="subsidiary">Subsidiary</option><option value="registered_branch">Registered branch</option><option value="employer_of_record">Employer of record</option>
                </select>
              </label>
              <label className="text-sm text-zinc-300">
                Internal reference
                <input required value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5" />
              </label>
            </div>

            <div className="mt-5 border border-zinc-700 bg-zinc-950/50 p-4">
              <h3 className="text-sm font-medium text-zinc-200">Automatic payroll defaults</h3>
              <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div><dt className="text-xs text-zinc-500">Currency</dt><dd className="mt-0.5 font-medium">{form.defaultCurrency}</dd></div>
                <div><dt className="text-xs text-zinc-500">Jurisdiction</dt><dd className="mt-0.5 font-medium">{form.jurisdictionCode}</dd></div>
                <div><dt className="text-xs text-zinc-500">Tax pack</dt><dd className="mt-0.5 font-medium">{selectedJurisdiction?.displayName || 'Not available yet'}</dd></div>
                <div><dt className="text-xs text-zinc-500">Calculation adapter</dt><dd className="mt-0.5 font-medium">{selectedCandidate?.displayName || 'Not available yet'}</dd></div>
              </dl>
            </div>

            <fieldset className="mt-5">
              <legend className="text-sm font-medium text-zinc-200">Tax registration</legend>
              <p className="mt-1 text-xs text-zinc-500">These values come from official employer documents, so payroll will never invent them.</p>
              <div className="mt-3 grid gap-4 md:grid-cols-3">
                <label className="text-sm text-zinc-300">Tax authority<input value={form.authorityCode} onChange={(event) => setForm({ ...form, authorityCode: event.target.value })} placeholder="For example, LIRS or HMRC" className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5" /></label>
                <label className="text-sm text-zinc-300">Registration reference<input value={form.registrationReference} onChange={(event) => setForm({ ...form, registrationReference: event.target.value })} placeholder="Reference on the registration" className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5" /></label>
                <label className="text-sm text-zinc-300">Evidence reference<input value={form.evidenceReference} onChange={(event) => setForm({ ...form, evidenceReference: event.target.value })} placeholder="Document or secure file reference" className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5" /></label>
              </div>
            </fieldset>

            <div className="mt-5 flex justify-end gap-3">
              {entities.length ? <button type="button" onClick={closeForm} className="min-h-11 rounded-lg border border-zinc-700 px-4 text-sm">Cancel</button> : null}
              <button disabled={saving} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-amber-500 px-4 text-sm font-medium text-zinc-950 disabled:opacity-60">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {editingId ? 'Save changes' : 'Save employer setup'}
              </button>
            </div>
          </form>
        ) : null}

        {loading ? <div className="flex min-h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-amber-400" /></div> : (
          <div className="overflow-x-auto border border-zinc-800">
            <table className="w-full min-w-[780px] text-left text-sm">
              <thead className="bg-zinc-900 text-zinc-400"><tr><th className="px-4 py-3 font-medium">Legal employer</th><th className="px-4 py-3 font-medium">Jurisdiction</th><th className="px-4 py-3 font-medium">Automatic tax setup</th><th className="px-4 py-3 font-medium">Readiness</th><th className="px-4 py-3 font-medium">Action</th></tr></thead>
              <tbody className="divide-y divide-zinc-800">
                {entities.length === 0 ? <tr><td colSpan={5} className="px-4 py-10 text-center text-zinc-500">Save the employer setup above to begin.</td></tr> : null}
                {entities.map((entity) => <tr key={entity._id} className="bg-zinc-950"><td className="px-4 py-4"><div className="flex items-start gap-3"><Building2 className="mt-0.5 h-5 w-5 text-zinc-500" /><div><p className="font-medium text-zinc-100">{entity.legalName}</p><p className="mt-1 text-xs text-zinc-500">{entity.code} - {entity.employerType.replace(/_/g, ' ')}</p></div></div></td><td className="px-4 py-4"><p>{entity.jurisdictionCode}</p><p className="mt-1 text-xs text-zinc-500">{entity.defaultCurrency}</p></td><td className="px-4 py-4"><p>{entity.payrollReadiness.taxPack?.label || 'No published pack yet'}</p><p className="mt-1 text-xs text-zinc-500">{entity.taxAdapterCandidateId || (entity.payrollReadiness.payrollRunnable ? 'Built into released tax pack' : 'No tested adapter yet')}</p></td><td className="px-4 py-4"><div className="flex items-center gap-2">{entity.payrollReadiness.payrollRunnable ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <AlertTriangle className="h-4 w-4 text-amber-400" />}<span className="font-medium capitalize">{entity.payrollReadiness.mode.replace(/_/g, ' ')}</span></div>{entity.payrollReadiness.blockingIssues.length ? <ul className="mt-2 max-w-lg space-y-1 text-xs text-zinc-500">{entity.payrollReadiness.blockingIssues.map((issue) => <li key={issue}>- {issue}</li>)}</ul> : null}</td><td className="px-4 py-4"><div className="flex flex-wrap gap-2"><button type="button" onClick={() => openEditForm(entity)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-zinc-700 px-3 text-xs font-medium text-zinc-200 hover:border-zinc-500"><Pencil className="h-3.5 w-3.5" />Edit</button>{entity.status === 'inactive' ? <button type="button" disabled={activatingId === entity._id} onClick={() => void setEntityStatus(entity, 'active')} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-emerald-500/40 px-3 text-xs font-medium text-emerald-300"><RotateCcw className="h-3.5 w-3.5" />Restore</button> : <button type="button" disabled={activatingId === entity._id} onClick={() => void setEntityStatus(entity, 'inactive')} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-red-500/30 px-3 text-xs font-medium text-red-300"><Trash2 className="h-3.5 w-3.5" />Remove</button>}{entity.status === 'draft' && entity.payrollReadiness.taxPack ? <button type="button" disabled={activatingId === entity._id} onClick={() => void enablePreview(entity)} className="min-h-9 rounded-lg border border-amber-500/40 px-3 text-xs font-medium text-amber-300 hover:bg-amber-500/10 disabled:opacity-60">{activatingId === entity._id ? 'Enabling...' : 'Enable preview'}</button> : null}</div></td></tr>)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
