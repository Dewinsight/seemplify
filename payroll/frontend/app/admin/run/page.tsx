'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import api, { authApi, handleAuthCallback, isAuthenticated } from '@/lib/api';
import { listPayrollEmployerEntities, PayrollEmployerEntity } from '@/lib/payrollEmployerEntities';

const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
type PreflightEntity = { employerEntityId: string; legalName?: string; currency?: string; employeeCount?: number; ready: boolean; blockers: string[]; warnings: string[] };
type Preflight = { ready: boolean; entities: PreflightEntity[] };
type VariableProfile = { userId: string; employerEntityId?: string; employeeInfo?: { name?: string }; currency?: string; workTerms?: { payBasis?: 'hourly' | 'daily' | 'fixed_contract'; rate?: number; contractAmount?: number } };
type WorkInput = { regularHours: number; daysWorked: number; notes: string };

export default function AdminPayrollRunPage() {
  const router = useRouter();
  const today = useMemo(() => new Date(), []);
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear] = useState(today.getFullYear());
  const [paymentDate, setPaymentDate] = useState(new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10));
  const [entities, setEntities] = useState<PayrollEmployerEntity[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [reportingCurrency, setReportingCurrency] = useState('');
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [variableProfiles, setVariableProfiles] = useState<VariableProfile[]>([]);
  const [workInputs, setWorkInputs] = useState<Record<string, WorkInput>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'preflight' | 'create' | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    handleAuthCallback();
    if (!isAuthenticated()) { router.push('/login'); return; }
    (async () => {
      try {
        const me = await authApi.getMe();
        const current = me.user?.organizations?.find((org: any) => org.id === me.currentOrganizationId) || me.user?.organizations?.[0];
        if (!current || !['owner', 'admin', 'hr_manager'].includes(current.role)) throw new Error('HR administrator access is required.');
        const rows = await listPayrollEmployerEntities();
        setEntities(rows);
        const runnable = rows.filter(entity => entity.status === 'active' && entity.payrollReadiness.payrollRunnable);
        setSelected(runnable.map(entity => entity._id));
        setReportingCurrency(runnable[0]?.defaultCurrency || 'USD');
        const profileResponse = await api.get('/payroll/profiles', { params: { status: 'active', limit: 500 } });
        const profiles = Array.isArray(profileResponse.data?.profiles) ? profileResponse.data.profiles : [];
        setVariableProfiles(profiles.filter((profile: VariableProfile) => ['hourly', 'daily', 'fixed_contract'].includes(profile.workTerms?.payBasis || '')));
      } catch (requestError: any) { setError(requestError?.message || 'Unable to load payroll setup.'); }
      finally { setLoading(false); }
    })();
  }, [router]);

  useEffect(() => { setPreflight(null); }, [month, year, paymentDate, reportingCurrency, selected]);

  const requestPreflight = async () => {
    setBusy('preflight'); setError('');
    try {
      const workInputsByEmployer = variableProfiles.filter(profile => profile.employerEntityId && selected.includes(profile.employerEntityId)).reduce<Record<string, Array<{ userId: string; regularHours: number; daysWorked: number }>>>((result, profile) => {
        const employerId = profile.employerEntityId!;
        if (!result[employerId]) result[employerId] = [];
        result[employerId].push({ userId: profile.userId, regularHours: workInputs[profile.userId]?.regularHours || 0, daysWorked: workInputs[profile.userId]?.daysWorked || 0 });
        return result;
      }, {});
      const response = await api.post('/payroll/cycles/preflight', { employerEntityIds: selected, month, year, paymentDate, reportingCurrency, workInputsByEmployer });
      setPreflight(response.data);
    } catch (requestError: any) { setError(requestError?.response?.data?.error || 'Preflight failed.'); }
    finally { setBusy(null); }
  };

  const createCycle = async () => {
    if (!preflight?.ready) return;
    const selectedWorkers = variableProfiles.filter(profile => profile.employerEntityId && selected.includes(profile.employerEntityId));
    const missing = selectedWorkers.find(profile => {
      const input = workInputs[profile.userId];
      return (profile.workTerms?.payBasis === 'hourly' && !(input?.regularHours > 0)) || (profile.workTerms?.payBasis === 'daily' && !(input?.daysWorked > 0));
    });
    if (missing) { setError(`Enter ${missing.workTerms?.payBasis === 'hourly' ? 'regular hours' : 'days worked'} for ${missing.employeeInfo?.name || 'each variable-paid worker'}.`); return; }
    setBusy('create'); setError('');
    try {
      const idempotencyKey = `cycle:${year}:${month}:${paymentDate}:${[...selected].sort().join(',')}`;
      const response = await api.post('/payroll/cycles', {
        employerEntityIds: selected, month, year, paymentDate, reportingCurrency, idempotencyKey,
        settings: { includeAllowances: true, includeBonuses: true, includeCommissions: true, includeOvertime: true, processStatutoryDeductions: true, calculateTax: true, prorate: true },
        workInputsByEmployer: selectedWorkers.reduce<Record<string, Array<{ userId: string; employeeName?: string; regularHours: number; daysWorked: number; notes: string }>>>((result, profile) => {
          const employerId = profile.employerEntityId!;
          if (!result[employerId]) result[employerId] = [];
          result[employerId].push({ userId: profile.userId, employeeName: profile.employeeInfo?.name, regularHours: workInputs[profile.userId]?.regularHours || 0, daysWorked: workInputs[profile.userId]?.daysWorked || 0, notes: workInputs[profile.userId]?.notes || '' });
          return result;
        }, {}),
      }, { headers: { 'Idempotency-Key': idempotencyKey } });
      router.push(`/admin/cycles/${response.data.cycle._id}`);
    } catch (requestError: any) {
      const details = requestError?.response?.data?.details;
      setError(requestError?.response?.data?.error || 'Payroll cycle could not be created.');
      if (details?.entities) setPreflight(details);
    } finally { setBusy(null); }
  };

  const toggle = (id: string) => setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  const selectedWorkers = variableProfiles.filter(profile => profile.employerEntityId && selected.includes(profile.employerEntityId));
  if (loading) return <main className="min-h-screen bg-zinc-950 grid place-items-center"><Loader2 className="h-7 w-7 animate-spin text-amber-400" /></main>;

  return <main className="min-h-screen bg-zinc-950 px-6 py-8 text-zinc-200"><div className="mx-auto max-w-5xl">
    <Link href="/admin/cycles" className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-100"><ArrowLeft className="h-4 w-4" /> Payroll cycles</Link>
    <h1 className="mt-3 text-2xl font-semibold text-zinc-100">Create payroll cycle</h1>
    <p className="mt-1 text-sm text-zinc-500">Calculate one statutory run per selected legal employer, then review and release them together.</p><Link href="/admin/settings/payroll-workflow" className="mt-2 inline-block text-sm text-amber-400">Approval and accounting settings</Link>
    {error && <div role="alert" className="mt-6 border border-red-500/30 bg-red-950/20 px-4 py-3 text-sm text-red-200">{error}</div>}

    <section className="mt-6 border border-zinc-800 bg-zinc-900/50 p-5"><h2 className="font-medium text-zinc-100">Period</h2><div className="mt-4 grid gap-4 sm:grid-cols-4">
      <label className="text-sm text-zinc-400">Month<select aria-label="Month" value={month} onChange={event => setMonth(Number(event.target.value))} className="mt-1 w-full border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-zinc-100">{months.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}</select></label>
      <label className="text-sm text-zinc-400">Year<input aria-label="Year" type="number" value={year} min={2000} max={2200} onChange={event => setYear(Number(event.target.value))} className="mt-1 w-full border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-zinc-100" /></label>
      <label className="text-sm text-zinc-400">Payment date<input aria-label="Payment date" type="date" value={paymentDate} onChange={event => setPaymentDate(event.target.value)} className="mt-1 w-full border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-zinc-100" /></label>
      <label className="text-sm text-zinc-400">Reporting currency<input aria-label="Reporting currency" maxLength={3} value={reportingCurrency} onChange={event => setReportingCurrency(event.target.value.toUpperCase())} className="mt-1 w-full border border-zinc-700 bg-zinc-950 px-3 py-2.5 uppercase text-zinc-100" /></label>
    </div></section>

    <section className="mt-5 border border-zinc-800 bg-zinc-900/50"><div className="flex items-start justify-between gap-4 border-b border-zinc-800 px-5 py-4"><div><h2 className="font-medium text-zinc-100">Legal employers</h2><p className="mt-1 text-sm text-zinc-500">Each employer keeps its native currency and statutory tax pack.</p></div><Link href="/admin/settings/employer-entities" className="text-sm text-amber-400">Manage employers</Link></div>
      <div className="divide-y divide-zinc-800">{entities.map(entity => { const runnable = entity.status === 'active' && entity.payrollReadiness.payrollRunnable; return <label key={entity._id} className="flex min-h-16 items-center gap-4 px-5 py-3"><input type="checkbox" checked={selected.includes(entity._id)} disabled={!runnable} onChange={() => toggle(entity._id)} /><span className="min-w-0 flex-1"><span className="block font-medium text-zinc-200">{entity.legalName}</span><span className="block text-xs text-zinc-500">{entity.jurisdictionCode} · {entity.defaultCurrency}</span></span><span className={runnable ? 'text-xs text-emerald-400' : 'text-xs text-amber-400'}>{runnable ? 'Payroll ready' : entity.payrollReadiness.mode.replaceAll('_', ' ')}</span></label>; })}{!entities.length && <p className="px-5 py-8 text-sm text-zinc-500">No legal employers are configured.</p>}</div>
    </section>

    {selectedWorkers.length > 0 && <section className="mt-5 overflow-hidden border border-zinc-800 bg-zinc-900/50"><div className="border-b border-zinc-800 px-5 py-4"><h2 className="font-medium text-zinc-100">Period work inputs</h2><p className="mt-1 text-sm text-zinc-500">Enter approved hours or days for variable-paid workers before calculation.</p></div><div className="overflow-x-auto"><table className="min-w-[720px] w-full text-sm"><thead className="text-left text-zinc-500"><tr><th className="px-5 py-3 font-medium">Worker</th><th className="px-4 py-3 font-medium">Basis</th><th className="px-4 py-3 font-medium">Units</th><th className="px-5 py-3 font-medium">Review note</th></tr></thead><tbody className="divide-y divide-zinc-800">{selectedWorkers.map(profile => { const input = workInputs[profile.userId] || { regularHours: 0, daysWorked: 0, notes: '' }; const basis = profile.workTerms?.payBasis; return <tr key={profile.userId}><td className="px-5 py-3 text-zinc-200">{profile.employeeInfo?.name || profile.userId}</td><td className="px-4 py-3 capitalize text-zinc-400">{basis?.replace('_', ' ')}</td><td className="px-4 py-3">{basis === 'fixed_contract' ? <span className="text-zinc-500">Automatic</span> : <input aria-label={`${profile.employeeInfo?.name || profile.userId} ${basis === 'hourly' ? 'regular hours' : 'days worked'}`} type="number" min="0" step={basis === 'hourly' ? '0.25' : '0.5'} value={(basis === 'hourly' ? input.regularHours : input.daysWorked) || ''} onChange={event => setWorkInputs(current => ({ ...current, [profile.userId]: { ...input, [basis === 'hourly' ? 'regularHours' : 'daysWorked']: Number(event.target.value) } }))} className="w-28 border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100" />}</td><td className="px-5 py-3"><input aria-label={`${profile.employeeInfo?.name || profile.userId} review note`} value={input.notes} onChange={event => setWorkInputs(current => ({ ...current, [profile.userId]: { ...input, notes: event.target.value } }))} className="w-full border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100" /></td></tr>; })}</tbody></table></div></section>}

    {preflight && <section aria-label="Preflight results" className="mt-5 border border-zinc-800 bg-zinc-900/50"><div className="border-b border-zinc-800 px-5 py-4"><h2 className="font-medium text-zinc-100">Preflight</h2><p className={preflight.ready ? 'mt-1 text-sm text-emerald-400' : 'mt-1 text-sm text-red-300'}>{preflight.ready ? 'All selected employers are ready to calculate.' : 'Resolve the blockers below before creating this cycle.'}</p></div>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-zinc-500"><tr><th className="px-5 py-3 font-medium">Employer</th><th className="px-4 py-3 font-medium">Employees</th><th className="px-4 py-3 font-medium">Currency</th><th className="px-5 py-3 font-medium">Readiness</th></tr></thead><tbody className="divide-y divide-zinc-800">{preflight.entities.map(entity => <tr key={entity.employerEntityId}><td className="px-5 py-3 text-zinc-200">{entity.legalName || entity.employerEntityId}</td><td className="px-4 py-3 text-zinc-400">{entity.employeeCount ?? '—'}</td><td className="px-4 py-3 text-zinc-400">{entity.currency || '—'}</td><td className="px-5 py-3"><span className={entity.ready ? 'text-emerald-400' : 'text-red-300'}>{entity.ready ? 'Ready' : entity.blockers.join(' ')}</span>{entity.warnings.map(warning => <p key={warning} className="mt-1 text-xs text-amber-300">{warning}</p>)}</td></tr>)}</tbody></table></div>
    </section>}
    <div className="mt-6 flex justify-end gap-3"><button onClick={requestPreflight} disabled={busy !== null || selected.length === 0} className="min-h-11 border border-zinc-700 px-4 text-sm font-medium disabled:opacity-40">{busy === 'preflight' ? 'Checking…' : 'Run preflight'}</button><button onClick={createCycle} disabled={busy !== null || !preflight?.ready} className="min-h-11 bg-amber-500 px-4 text-sm font-semibold text-zinc-950 disabled:opacity-40">{busy === 'create' ? 'Calculating…' : `Create cycle (${selected.length})`}</button></div>
  </div></main>;
}
