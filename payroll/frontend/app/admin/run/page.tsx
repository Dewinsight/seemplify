'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import api, { authApi, handleAuthCallback, isAuthenticated } from '@/lib/api';
import { ArrowLeft, Calendar, CheckCircle, ClipboardList, Loader2, Settings2 } from 'lucide-react';
import { listPayrollEmployerEntities, PayrollEmployerEntity } from '@/lib/payrollEmployerEntities';

const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

type VariablePayProfile = {
  userId: string;
  employeeInfo?: { name?: string; employmentType?: string };
  currency?: string;
  workTerms?: { payBasis?: 'hourly' | 'daily' | 'fixed_contract'; rate?: number; contractAmount?: number };
  employerEntityId?: string;
};

export default function AdminPayrollRunPage() {
  const router = useRouter();

  const today = useMemo(() => new Date(), []);
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear] = useState(today.getFullYear());
  const [paymentDate, setPaymentDate] = useState(
    new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0]
  );

  const [settings, setSettings] = useState({
    includeAllowances: true,
    includeBonuses: true,
    includeCommissions: true,
    includeOvertime: true,
    processStatutoryDeductions: true,
    calculateTax: true,
    prorate: true,
    reportingCurrency: '',
  });
  const [availableCurrencies, setAvailableCurrencies] = useState<Array<{ code: string; name: string }>>([]);
  const [employerEntities, setEmployerEntities] = useState<PayrollEmployerEntity[]>([]);
  const [employerEntityId, setEmployerEntityId] = useState('');
  const [allVariablePayProfiles, setAllVariablePayProfiles] = useState<VariablePayProfile[]>([]);
  const [variablePayProfiles, setVariablePayProfiles] = useState<VariablePayProfile[]>([]);
  const [workInputs, setWorkInputs] = useState<Record<string, { regularHours: number; daysWorked: number; notes: string }>>({});

  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isHRAdmin, setIsHRAdmin] = useState(false);

  useEffect(() => {
    handleAuthCallback();

    if (!isAuthenticated()) {
      router.push('/login');
      return;
    }

    (async () => {
      try {
        const me = await authApi.getMe();
        const currentOrgId = me.currentOrganizationId;
        const currentOrg = me.user?.organizations?.find((o: any) => o.id === currentOrgId) || me.user?.organizations?.[0];
        const hasAccess = currentOrg && ['owner', 'admin', 'hr_manager'].includes(currentOrg.role);
        if (!hasAccess) {
          alert('Access denied. Only HR administrators can run payroll.');
          router.push('/dashboard');
          return;
        }
        setIsHRAdmin(true);
        try {
          const entityRows = await listPayrollEmployerEntities();
          setEmployerEntities(entityRows);
          const firstEntity = entityRows.find((entity) => entity.status === 'active' && entity.payrollReadiness.payrollRunnable)
            || entityRows.find((entity) => entity.status === 'active');
          if (firstEntity) {
            setEmployerEntityId(firstEntity._id);
            setSettings((current) => ({ ...current, reportingCurrency: firstEntity.defaultCurrency }));
          }
        } catch (entityError) {
          console.error('Failed to load legal employers:', entityError);
        }
        try {
          const currenciesRes = await api.get('/currencies');
          setAvailableCurrencies(Array.isArray(currenciesRes.data?.currencies) ? currenciesRes.data.currencies : []);
        } catch (currencyError) {
          console.error('Failed to load payroll currencies:', currencyError);
        }
        try {
          const profilesRes = await api.get('/payroll/profiles', { params: { status: 'active', limit: 500 } });
          const profiles = Array.isArray(profilesRes.data?.profiles) ? profilesRes.data.profiles : [];
          setAllVariablePayProfiles(profiles.filter((profile: VariablePayProfile) => ['hourly', 'daily', 'fixed_contract'].includes(profile.workTerms?.payBasis || '')));
        } catch (profileError) {
          console.error('Failed to load contract work inputs:', profileError);
        }
      } catch (e) {
        router.push('/login');
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  useEffect(() => {
    setVariablePayProfiles(allVariablePayProfiles.filter((profile) => profile.employerEntityId === employerEntityId));
  }, [allVariablePayProfiles, employerEntityId]);

  const runLabel = `${monthNames[month - 1]} ${year}`;
  const selectedEmployer = useMemo(
    () => employerEntities.find((entity) => entity._id === employerEntityId),
    [employerEntities, employerEntityId]
  );

  const handleRun = async () => {
    setError(null);
    if (!employerEntityId) {
      setError('Create and select an active legal employer before calculating payroll.');
      return;
    }
    const missingInput = variablePayProfiles.find(profile => {
      const basis = profile.workTerms?.payBasis;
      const input = workInputs[profile.userId];
      return (basis === 'hourly' && !(input?.regularHours > 0)) || (basis === 'daily' && !(input?.daysWorked > 0));
    });
    if (missingInput) {
      setError(`Enter ${missingInput.workTerms?.payBasis === 'hourly' ? 'regular hours' : 'days worked'} for ${missingInput.employeeInfo?.name || 'each variable-paid worker'} before calculating payroll.`);
      return;
    }
    if (!confirm(`Calculate payroll for ${runLabel}?\n\nThis will generate draft payslips for review and approval.`)) {
      return;
    }

    setProcessing(true);
    try {
      const res = await api.post('/payroll/runs', {
        employerEntityId,
        month,
        year,
        paymentDate,
        settings: {
          ...settings,
          reportingCurrency: settings.reportingCurrency || undefined,
        },
        workInputs: variablePayProfiles.map(profile => ({
          userId: profile.userId,
          employeeName: profile.employeeInfo?.name,
          regularHours: workInputs[profile.userId]?.regularHours || 0,
          daysWorked: workInputs[profile.userId]?.daysWorked || 0,
          notes: workInputs[profile.userId]?.notes || '',
        })),
      });

      const runId = res.data?.run?._id;
      if (!runId) {
        throw new Error('Payroll run created but response did not include run id.');
      }

      router.push(`/admin/runs/${runId}`);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to create payroll run');
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
      </div>
    );
  }

  if (!isHRAdmin) return null;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 p-8 pb-20">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <Link
              href="/dashboard"
              className="inline-flex items-center text-sm text-zinc-400 hover:text-amber-400 mb-2 transition-colors"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to Dashboard
            </Link>
            <h1 className="text-3xl font-bold text-zinc-100">Run Payroll</h1>
            <p className="text-zinc-500 mt-1">Calculate payroll and generate draft payslips for HR review</p>
          </div>
        </div>

        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/20 text-red-200 rounded-xl p-4">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-400">
                <Calendar className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-zinc-100">Pay Period</h2>
                <p className="text-sm text-zinc-500">Select the month/year to calculate</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1.5">Month</label>
                <select
                  value={month}
                  onChange={(e) => setMonth(parseInt(e.target.value, 10))}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                >
                  {monthNames.map((m, i) => (
                    <option key={m} value={i + 1}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1.5">Year</label>
                <input
                  type="number"
                  min="2020"
                  max="2035"
                  value={year}
                  onChange={(e) => setYear(parseInt(e.target.value, 10))}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
                />
              </div>
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium text-zinc-400 mb-1.5">Payment Date</label>
              <input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
              />
              <p className="text-xs text-zinc-500 mt-2">Used for reporting and export; no payout is executed.</p>
            </div>

            <div className="mt-4">
              <label htmlFor="statutory-run-currency" className="block text-sm font-medium text-zinc-400 mb-1.5">Statutory run currency</label>
              <select
                id="statutory-run-currency"
                value={settings.reportingCurrency}
                onChange={(e) => setSettings(s => ({ ...s, reportingCurrency: e.target.value }))}
                disabled={!!employerEntityId}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-200 focus:border-amber-500 outline-none"
              >
                <option value="">Select a legal employer first</option>
                {availableCurrencies.map((currency) => (
                  <option key={currency.code} value={currency.code}>
                    {currency.code} - {currency.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-zinc-500 mt-2">
                This comes from the selected legal employer. Cross-currency consolidated reporting remains separate from statutory payroll.
              </p>
            </div>
          </div>

          <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400">
                <Settings2 className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-zinc-100">Options</h2>
                <p className="text-sm text-zinc-500">Control what to include in calculations</p>
              </div>
            </div>

            <div className="space-y-3">
              {[
                { key: 'includeAllowances', label: 'Include recurring allowances' },
                { key: 'includeBonuses', label: 'Include approved bonuses/incentives' },
                { key: 'includeCommissions', label: 'Include approved commissions' },
                { key: 'includeOvertime', label: 'Include approved overtime requests' },
                { key: 'processStatutoryDeductions', label: 'Apply statutory deductions (SS/pension)' },
                { key: 'calculateTax', label: 'Calculate income tax' },
                { key: 'prorate', label: 'Prorate for join/termination dates' },
              ].map((opt) => (
                <label
                  key={opt.key}
                  className="flex items-center justify-between bg-zinc-800/40 border border-zinc-700/50 rounded-lg px-3 py-2.5 cursor-pointer"
                >
                  <span className="text-sm text-zinc-300">{opt.label}</span>
                  <input
                    type="checkbox"
                    checked={(settings as any)[opt.key]}
                    onChange={(e) => setSettings(s => ({ ...s, [opt.key]: e.target.checked }))}
                    className="rounded bg-zinc-900 border-zinc-700"
                  />
                </label>
              ))}
            </div>
          </div>
        </div>

        {variablePayProfiles.length > 0 && (
          <section className="mt-6 border border-zinc-800 bg-zinc-900/60 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-800 flex items-start gap-3">
              <ClipboardList className="w-5 h-5 text-amber-400 mt-0.5" />
              <div>
                <h2 className="font-semibold text-zinc-100">Contract and variable-paid work</h2>
                <p className="text-sm text-zinc-500 mt-0.5">Record approved units for this period. Fixed contracts are calculated from their saved contract terms.</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-900 text-zinc-500 text-left">
                  <tr><th className="px-5 py-3 font-medium">Worker</th><th className="px-4 py-3 font-medium">Basis</th><th className="px-4 py-3 font-medium">Rate / amount</th><th className="px-4 py-3 font-medium">Period input</th><th className="px-4 py-3 font-medium">Note</th></tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {variablePayProfiles.map(profile => {
                    const basis = profile.workTerms?.payBasis;
                    const input = workInputs[profile.userId] || { regularHours: 0, daysWorked: 0, notes: '' };
                    return <tr key={profile.userId}>
                      <td className="px-5 py-3 text-zinc-200">{profile.employeeInfo?.name || 'Unnamed worker'}<div className="text-xs text-zinc-500">{profile.employeeInfo?.employmentType?.replace('_', ' ')}</div></td>
                      <td className="px-4 py-3 text-zinc-400 capitalize">{basis?.replace('_', ' ')}</td>
                      <td className="px-4 py-3 text-zinc-300">{profile.currency || 'USD'} {basis === 'fixed_contract' ? profile.workTerms?.contractAmount || 0 : profile.workTerms?.rate || 0}</td>
                      <td className="px-4 py-3">
                        {basis === 'fixed_contract' ? <span className="text-zinc-500">Automatic</span> : <input type="number" min="0" step={basis === 'hourly' ? '0.25' : '0.5'}
                          aria-label={basis === 'hourly' ? 'Regular hours' : 'Days worked'}
                          placeholder={basis === 'hourly' ? 'Hours' : 'Days'} value={basis === 'hourly' ? input.regularHours || '' : input.daysWorked || ''}
                          onChange={(e) => setWorkInputs(current => ({ ...current, [profile.userId]: { ...input, [basis === 'hourly' ? 'regularHours' : 'daysWorked']: Number(e.target.value) } }))}
                          className="w-28 bg-zinc-950 border border-zinc-700 rounded-md px-2.5 py-2 text-zinc-200 outline-none focus:border-amber-500" />}
                      </td>
                      <td className="px-4 py-3"><input type="text" placeholder="Optional approval note" value={input.notes}
                        onChange={(e) => setWorkInputs(current => ({ ...current, [profile.userId]: { ...input, notes: e.target.value } }))}
                        className="w-full min-w-48 bg-zinc-950 border border-zinc-700 rounded-md px-2.5 py-2 text-zinc-200 outline-none focus:border-amber-500" /></td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="mb-6 border border-zinc-800 bg-zinc-900 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-zinc-100">Legal employer</h2>
              <p className="mt-1 text-sm text-zinc-500">Each payroll run is limited to one registered employer, jurisdiction and currency.</p>
            </div>
            <Link href="/admin/settings/employer-entities" className="inline-flex min-h-11 items-center rounded-lg border border-zinc-700 px-3 text-sm text-zinc-200 hover:border-amber-500/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400">Manage legal employers</Link>
          </div>
          <label className="mt-4 block text-sm text-zinc-300">
            Employer for this run
            <select
              value={employerEntityId}
              onChange={(event) => {
                const nextId = event.target.value;
                const next = employerEntities.find((entity) => entity._id === nextId);
                setEmployerEntityId(nextId);
                if (next) setSettings((current) => ({ ...current, reportingCurrency: next.defaultCurrency }));
              }}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-zinc-200 focus:border-amber-500 focus:outline-none"
            >
              <option value="">{employerEntities.some((entity) => entity.status === 'active') ? 'Select a legal employer' : 'No active legal employer available'}</option>
              {employerEntities.map((entity) => (
                <option key={entity._id} value={entity._id} disabled={entity.status !== 'active'}>
                  {entity.legalName} — {entity.jurisdictionCode} / {entity.defaultCurrency} — {entity.payrollReadiness.mode.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>
          {!employerEntities.some((entity) => entity.status === 'active') ? (
            <div className="mt-3 border border-amber-500/30 bg-amber-950/20 p-3 text-sm text-amber-100">
              Payroll calculation is disabled until an employer setup has been legally verified and made active. Draft employers are shown above for context.
            </div>
          ) : null}
          {selectedEmployer && !selectedEmployer.payrollReadiness.payrollRunnable ? (
            <div className="mt-3 border border-amber-500/30 bg-amber-950/20 p-3 text-sm text-amber-100">
              <p className="font-medium">Preview-only calculation</p>
              <ul className="mt-2 space-y-1 text-xs text-amber-100/80">
                {selectedEmployer.payrollReadiness.blockingIssues.map((issue) => <li key={issue}>- {issue}</li>)}
              </ul>
            </div>
          ) : null}
        </section>

        <div className="mt-6 flex items-center justify-end">
          <button
            onClick={handleRun}
            disabled={processing || !employerEntityId}
            title={!employerEntityId ? 'Complete and activate an employer setup first' : undefined}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold disabled:opacity-50"
          >
            {processing ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
            {processing ? 'Calculating...' : `Calculate ${runLabel}`}
          </button>
        </div>
      </div>
    </div>
  );
}
