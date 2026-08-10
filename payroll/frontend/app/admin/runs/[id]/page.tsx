'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import api, { authApi, handleAuthCallback, isAuthenticated } from '@/lib/api';
import { formatPayrollMoney } from '@/lib/payrollMoney';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle,
  Download,
  FileText,
  Loader2,
  RefreshCw,
  Trash2,
} from 'lucide-react';

type Money = number;

type PayrollRun = {
  _id: string;
  runNumber: string;
  status: string;
  payPeriod: {
    month: number;
    year: number;
    startDate?: string;
    endDate?: string;
    paymentDate?: string;
  };
  employerEntitySnapshot?: {
    legalName?: string;
    jurisdictionCode?: string;
    currency?: string;
    payrollRunnableAtCreation?: boolean;
  };
  summary?: {
    totalEmployees?: number;
    processedCount?: number;
    skippedCount?: number;
    errorCount?: number;
    totalGrossPayroll?: Money;
    totalDeductions?: Money;
    totalNetPayroll?: Money;
    totalTaxWithheld?: Money;
    currency?: string;
    hasAggregateTotals?: boolean;
    isMultiCurrency?: boolean;
    currencyBreakdown?: Array<{
      currency: string;
      employeeCount: number;
      totalGrossPayroll: Money;
      totalDeductions: Money;
      totalNetPayroll: Money;
      totalTaxWithheld: Money;
    }>;
    conversionWarnings?: string[];
  };
  employees?: Array<{
    userId: string;
    employeeName?: string;
    currency?: string;
    grossPay?: Money;
    deductions?: Money;
    netPay?: Money;
    status?: string;
    payslipId?: string;
    errorMessage?: string;
  }>;
  workInputs?: Array<{
    userId: string;
    employeeName?: string;
    regularHours?: number;
    daysWorked?: number;
    notes?: string;
  }>;
  errors?: Array<{
    userId?: string;
    employeeName?: string;
    errorType?: string;
    errorMessage?: string;
  }>;
  calculatedAt?: string;
  approvedAt?: string;
  exportedAt?: string;
  retractedAt?: string;
  retractedByName?: string;
  retractionReason?: string;
};

type Payslip = {
  _id: string;
  payslipNumber: string;
  status: string;
  userId: string;
  currency: string;
  employeeSnapshot?: { name?: string; department?: string; designation?: string };
  calculationBasis?: { payBasis?: string; rate?: number; units?: number; unitLabel?: string };
  earningsSummary?: { grossPay?: Money };
  deductionsSummary?: { totalDeductions?: Money };
  taxBreakdown?: { taxAmount?: Money };
  netPay: Money;
};

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatMoney(currency: string, value: any) {
  return formatPayrollMoney(value || 0, currency);
}

function formatRunSummaryValue(
  summary: PayrollRun['summary'],
  key: 'totalGrossPayroll' | 'totalDeductions' | 'totalNetPayroll' | 'totalTaxWithheld'
) {
  if (summary?.hasAggregateTotals !== false) {
    return formatMoney(summary?.currency || 'USD', summary?.[key]);
  }

  if (summary?.currencyBreakdown?.length) {
    return 'Mixed';
  }

  return formatMoney(summary?.currency || 'USD', summary?.[key]);
}

export default function PayrollRunDetailsPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const runId = params.id;

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<PayrollRun | null>(null);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [currentOrgRole, setCurrentOrgRole] = useState('');
  const [workInputDrafts, setWorkInputDrafts] = useState<PayrollRun['workInputs']>([]);

  const refresh = async () => {
    setError(null);
    try {
      const res = await api.get(`/payroll/runs/${runId}/payslips`);
      setRun(res.data?.run);
      setPayslips(Array.isArray(res.data?.payslips) ? res.data.payslips : []);
      setWorkInputDrafts(Array.isArray(res.data?.run?.workInputs) ? res.data.run.workInputs : []);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load payroll run');
    }
  };

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
          router.push('/dashboard');
          return;
        }
        setCurrentOrgRole(currentOrg?.role || '');

        await refresh();
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, router]);

  const exceptionEmployees = useMemo(() => {
    const list = Array.isArray(run?.employees) ? run!.employees : [];
    return list.filter(e => e?.status === 'error' || e?.status === 'skipped');
  }, [run]);

  const canRecalculate = run?.status === 'calculated' || run?.status === 'pending_review';
  const canSubmitForApproval = run?.status === 'calculated' || run?.status === 'pending_review';
  const canApprove = run?.status === 'pending_approval';
  const canFinalize = run?.status === 'approved' || run?.status === 'paid' || run?.status === 'exported';
  const canRetract = !!run
    && ['owner', 'admin'].includes(currentOrgRole)
    && run?.status !== 'cancelled'
    && run?.status !== 'calculating'
    && run?.status !== 'processing_payment';
  const canExport = !!run && run.status !== 'cancelled';

  const downloadRunExport = async () => {
    setBusy('export');
    try {
      const res = await api.get(`/payroll/runs/${runId}/export`, { responseType: 'blob' });
      const blob = res.data as Blob;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = run?.runNumber ? `payroll-register-${run.runNumber}.csv` : `payroll-register-${runId}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message || 'Failed to export accounting CSV');
    } finally {
      setBusy(null);
    }
  };

  const downloadPayslipPdf = async (payslipId: string, payslipNumber?: string) => {
    setBusy(`pdf:${payslipId}`);
    try {
      const res = await api.get(`/payroll/payslips/${payslipId}/pdf`, { responseType: 'blob' });
      const blob = res.data as Blob;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = payslipNumber ? `${payslipNumber}.pdf` : `payslip-${payslipId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message || 'Failed to download PDF');
    } finally {
      setBusy(null);
    }
  };

  const recalculate = async () => {
    if (!confirm('Recalculate this run? This will regenerate payslips using current profiles/approved requests.')) return;
    setBusy('recalculate');
    try {
      const comments = prompt('Comments (optional):') || '';
      await api.post(`/payroll/runs/${runId}/recalculate`, { comments });
      await refresh();
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message || 'Failed to recalculate run');
    } finally {
      setBusy(null);
    }
  };
  const saveWorkInputs = async () => {
    setBusy('work-inputs');
    try {
      await api.put(`/payroll/runs/${runId}/work-inputs`, {
        workInputs: workInputDrafts,
        comments: 'Period work records updated during payroll review',
      });
      await refresh();
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message || 'Failed to update period work records');
    } finally {
      setBusy(null);
    }
  };

  const submitForApproval = async () => {
    if (!confirm('Submit this run for approval? Employees will not see payslips until the run is approved/exported.')) return;
    setBusy('submit');
    try {
      const comments = prompt('Comments (optional):') || '';
      await api.post(`/payroll/runs/${runId}/submit-for-approval`, { comments });
      await refresh();
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message || 'Failed to submit for approval');
    } finally {
      setBusy(null);
    }
  };

  const approve = async () => {
    if (!confirm('Approve this run? This will mark payslips as approved (visible to employees).')) return;
    setBusy('approve');
    try {
      const comments = prompt('Comments (optional):') || '';
      await api.post(`/payroll/runs/${runId}/approve`, { comments });
      await refresh();
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message || 'Failed to approve run');
    } finally {
      setBusy(null);
    }
  };

  const finalize = async () => {
    if (!confirm('Finalize/export this run? This marks payslips as exported for accounting (no payout is executed).')) return;
    setBusy('finalize');
    try {
      const comments = prompt('Comments (optional):') || '';
      await api.post(`/payroll/runs/${runId}/finalize`, { comments });
      await refresh();
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message || 'Failed to finalize run');
    } finally {
      setBusy(null);
    }
  };

  const retractRun = async () => {
    const warningMessage = [
      `Retract ${periodLabel} payroll?`,
      '',
      'This will:',
      '- remove all payslips generated by this run',
      '- reopen compensation requests that were processed by this run',
      '- allow payroll to be re-run for this month',
      '',
      'Use this only when you need to undo the month.'
    ].join('\n');

    if (!confirm(warningMessage)) return;

    const comments = prompt('Retraction reason (required for audit):')?.trim();
    if (!comments) {
      alert('Retraction reason is required.');
      return;
    }

    setBusy('retract');
    try {
      await api.post(`/payroll/runs/${runId}/retract`, { comments });
      await refresh();
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message || 'Failed to retract payroll run');
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
      </div>
    );
  }

  if (!run) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-200 p-8 pb-20">
        <div className="max-w-5xl mx-auto">
          <Link href="/admin/runs" className="inline-flex items-center text-sm text-zinc-400 hover:text-amber-400 mb-2 transition-colors">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to Runs
          </Link>
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-orange-400" />
              <div className="text-zinc-300">{error || 'Run not found.'}</div>
            </div>
            <button
              onClick={refresh}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
            >
              <RefreshCw className="w-4 h-4" />
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const periodLabel = `${monthNames[(run.payPeriod?.month || 1) - 1]} ${run.payPeriod?.year || ''}`;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 p-8 pb-20">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <Link
              href="/admin/runs"
              className="inline-flex items-center text-sm text-zinc-400 hover:text-amber-400 mb-2 transition-colors"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to Runs
            </Link>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
              {periodLabel}
            </h1>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <span className="text-xs font-mono text-zinc-500">{run.runNumber}</span>
              <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700/50 capitalize">
                {run.status?.replace(/_/g, ' ') || 'unknown'}
              </span>
              {run.calculatedAt && (
                <span className="text-xs text-zinc-500">
                  Calculated {new Date(run.calculatedAt).toLocaleString()}
                </span>
              )}
              {run.exportedAt && (
                <span className="text-xs text-zinc-500">
                  Exported {new Date(run.exportedAt).toLocaleString()}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={refresh}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-medium disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${busy === 'refresh' ? 'animate-spin' : ''}`} />
              Refresh
            </button>

            {canExport && (
              <button
                onClick={downloadRunExport}
                disabled={busy !== null}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                Accounting CSV
              </button>
            )}

            {canRecalculate && (
              <button
                onClick={recalculate}
                disabled={busy !== null}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-medium disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${busy === 'recalculate' ? 'animate-spin' : ''}`} />
                Recalculate
              </button>
            )}

            {canSubmitForApproval && (
              <button
                onClick={submitForApproval}
                disabled={busy !== null}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium disabled:opacity-50"
              >
                <FileText className="w-4 h-4" />
                Submit
              </button>
            )}

            {canApprove && (
              <button
                onClick={approve}
                disabled={busy !== null}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium disabled:opacity-50"
              >
                <CheckCircle className="w-4 h-4" />
                Approve
              </button>
            )}

            {canFinalize && (
              <button
                onClick={finalize}
                disabled={busy !== null || run.status === 'exported'}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-medium disabled:opacity-50"
              >
                <CheckCircle className="w-4 h-4" />
                {run.status === 'exported' ? 'Finalized' : 'Finalize'}
              </button>
            )}

            {canRetract && (
              <button
                onClick={retractRun}
                disabled={busy !== null}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium disabled:opacity-50"
              >
                {busy === 'retract' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Retract Run
              </button>
            )}
          </div>
        </div>

        {run.status === 'cancelled' && (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-5 text-red-100">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 text-red-300" />
              <div>
                <div className="font-semibold">This payroll run has been retracted.</div>
                <div className="mt-1 text-sm text-red-100/90">
                  {run.retractedAt
                    ? `Retracted ${new Date(run.retractedAt).toLocaleString()}`
                    : 'Retracted after creation.'}
                  {run.retractedByName ? ` by ${run.retractedByName}.` : ''}
                </div>
                <div className="mt-2 text-sm text-red-100/90">
                  Generated payslips were removed and processed compensation requests were reopened for rerun.
                </div>
                {run.retractionReason && (
                  <div className="mt-2 text-sm text-red-100/90">
                    Reason: {run.retractionReason}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Summary */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5">
            <div className="text-xs text-zinc-500 mb-1">Employees</div>
            <div className="text-2xl font-bold text-zinc-100">{run.summary?.totalEmployees || 0}</div>
          </div>
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5">
            <div className="text-xs text-zinc-500 mb-1">Gross</div>
            <div className="text-xl font-bold text-zinc-100 font-mono">{formatRunSummaryValue(run.summary, 'totalGrossPayroll')}</div>
          </div>
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5">
            <div className="text-xs text-zinc-500 mb-1">Tax Withheld</div>
            <div className="text-xl font-bold text-blue-300 font-mono">{formatRunSummaryValue(run.summary, 'totalTaxWithheld')}</div>
          </div>
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5">
            <div className="text-xs text-zinc-500 mb-1">Deductions</div>
            <div className="text-xl font-bold text-red-400 font-mono">{formatRunSummaryValue(run.summary, 'totalDeductions')}</div>
          </div>
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5">
            <div className="text-xs text-zinc-500 mb-1">Net</div>
            <div className="text-xl font-bold text-emerald-400 font-mono">{formatRunSummaryValue(run.summary, 'totalNetPayroll')}</div>
          </div>
        </div>

        {run.summary?.currencyBreakdown && run.summary.currencyBreakdown.length > 1 && (
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6">
            <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
              <div>
                <h2 className="text-lg font-semibold text-zinc-100">Currency Breakdown</h2>
                <p className="text-sm text-zinc-500">Each employee is calculated in their configured payroll currency.</p>
              </div>
              <div className="text-sm text-zinc-400">
                {run.summary?.hasAggregateTotals === false
                  ? 'Aggregate totals are hidden until a reporting currency is available.'
                  : `Reporting currency: ${run.summary?.currency}`}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              {run.summary.currencyBreakdown.map((entry) => (
                <div key={entry.currency} className="bg-zinc-950/40 border border-zinc-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-lg font-semibold text-zinc-100">{entry.currency}</div>
                    <div className="text-xs text-zinc-500">
                      {entry.employeeCount} employee{entry.employeeCount === 1 ? '' : 's'}
                    </div>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between gap-3">
                      <span className="text-zinc-500">Gross</span>
                      <span className="font-mono text-zinc-200">{formatMoney(entry.currency, entry.totalGrossPayroll)}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-zinc-500">Deductions</span>
                      <span className="font-mono text-red-400">{formatMoney(entry.currency, entry.totalDeductions)}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-zinc-500">Net</span>
                      <span className="font-mono text-emerald-400">{formatMoney(entry.currency, entry.totalNetPayroll)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {run.summary?.conversionWarnings && run.summary.conversionWarnings.length > 0 && (
              <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                {run.summary.conversionWarnings.join(' ')}
              </div>
            )}
          </div>
        )}

        <section aria-label="Legal employer for this run" className="border border-zinc-800 bg-zinc-900/60 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Legal employer</h2>
          <p className="mt-2 text-sm text-zinc-300">
            {run.employerEntitySnapshot?.legalName || 'Legacy run — legal employer not recorded'}
            {run.employerEntitySnapshot?.jurisdictionCode ? ` · ${run.employerEntitySnapshot.jurisdictionCode}` : ''}
            {run.employerEntitySnapshot?.currency ? ` · ${run.employerEntitySnapshot.currency}` : ''}
          </p>
          {run.employerEntitySnapshot?.payrollRunnableAtCreation === false ? (
            <div className="mt-3 border border-amber-500/30 bg-amber-950/20 p-3 text-sm text-amber-100">
              This run was created against a preview-only tax pack and cannot be finalized.
            </div>
          ) : null}
        </section>

        {/* Exceptions */}
        {(workInputDrafts?.length || 0) > 0 && (
          <section className="border border-zinc-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between gap-4">
              <div><h2 className="font-semibold text-zinc-100">Period work records</h2><p className="text-sm text-zinc-500 mt-0.5">Hours and days used to calculate variable-paid workers.</p></div>
              {canRecalculate && <button onClick={saveWorkInputs} disabled={busy === 'work-inputs'} className="px-3 py-2 rounded-md bg-zinc-100 text-zinc-950 text-sm font-medium disabled:opacity-50">{busy === 'work-inputs' ? 'Recalculating…' : 'Save & recalculate'}</button>}
            </div>
            <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-zinc-500"><tr><th className="px-5 py-3 font-medium">Worker</th><th className="px-4 py-3 font-medium">Pay basis</th><th className="px-4 py-3 font-medium">Period units</th><th className="px-5 py-3 font-medium">Review note</th></tr></thead>
              <tbody className="divide-y divide-zinc-800">{workInputDrafts?.map((input, index) => {
                const slip = payslips.find(item => item.userId === input.userId);
                const basis = slip?.calculationBasis?.payBasis || (input.regularHours ? 'hourly' : input.daysWorked ? 'daily' : 'fixed_contract');
                return <tr key={input.userId}><td className="px-5 py-3 text-zinc-200">{input.employeeName || slip?.employeeSnapshot?.name || 'Worker'}</td><td className="px-4 py-3 text-zinc-400 capitalize">{basis.replace('_', ' ')}</td><td className="px-4 py-3">{basis === 'fixed_contract' ? <span className="text-zinc-500">From contract terms</span> : <input type="number" min="0" step={basis === 'hourly' ? '0.25' : '0.5'} disabled={!canRecalculate} value={basis === 'hourly' ? input.regularHours || '' : input.daysWorked || ''} onChange={(e) => setWorkInputDrafts(current => (current || []).map((item, itemIndex) => itemIndex === index ? { ...item, [basis === 'hourly' ? 'regularHours' : 'daysWorked']: Number(e.target.value) } : item))} className="w-28 bg-zinc-950 border border-zinc-700 rounded-md px-2.5 py-2 text-zinc-200 disabled:opacity-60" />}</td><td className="px-5 py-3"><input type="text" disabled={!canRecalculate} value={input.notes || ''} onChange={(e) => setWorkInputDrafts(current => (current || []).map((item, itemIndex) => itemIndex === index ? { ...item, notes: e.target.value } : item))} className="w-full min-w-52 bg-zinc-950 border border-zinc-700 rounded-md px-2.5 py-2 text-zinc-200 disabled:opacity-60" /></td></tr>;
              })}</tbody></table></div>
          </section>
        )}

        {exceptionEmployees.length > 0 && (
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-zinc-100 mb-4">Exceptions</h2>
            <div className="space-y-2">
              {exceptionEmployees.map((e) => (
                <div key={e.userId} className="flex items-center justify-between gap-4 bg-zinc-950/40 border border-zinc-800 rounded-xl p-4">
                  <div>
                    <div className="text-sm font-medium text-zinc-200">{e.employeeName || e.userId}</div>
                    <div className="text-xs text-zinc-500 capitalize">{String(e.status || 'unknown').replace(/_/g, ' ')}</div>
                    {e.errorMessage && <div className="text-xs text-orange-300 mt-1">{e.errorMessage}</div>}
                  </div>
                  <div className="text-right text-xs text-zinc-500 font-mono">
                    {formatMoney(e.currency || run.summary?.currency || 'USD', e.netPay)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Payslips */}
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl overflow-hidden">
          <div className="p-6 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-lg font-semibold text-zinc-100">Payslips</h2>
              <p className="text-sm text-zinc-500">Generated payslips for this run (draft until approved/exported)</p>
            </div>
            <div className="text-sm text-zinc-400">
              {payslips.length} payslips
            </div>
          </div>

          <div className="border-t border-zinc-800 overflow-x-auto">
            <table className="min-w-[900px] w-full text-sm">
              <thead className="bg-zinc-950/30 text-zinc-400">
                <tr>
                  <th className="text-left font-medium px-6 py-3">Employee</th>
                  <th className="text-left font-medium px-6 py-3">Status</th>
                  <th className="text-right font-medium px-6 py-3">Gross</th>
                  <th className="text-right font-medium px-6 py-3">Deductions</th>
                  <th className="text-right font-medium px-6 py-3">Net</th>
                  <th className="text-right font-medium px-6 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {payslips.map((p) => {
                  const gross = Number(p.earningsSummary?.grossPay) || 0;
                  const deductions = Number(p.deductionsSummary?.totalDeductions) || 0;
                  const net = Number(p.netPay) || 0;
                  return (
                    <tr key={p._id} className="border-t border-zinc-800 hover:bg-zinc-950/20">
                      <td className="px-6 py-4">
                        <div className="font-medium text-zinc-200">{p.employeeSnapshot?.name || p.userId}</div>
                        <div className="text-xs text-zinc-500">
                          {p.employeeSnapshot?.department || '--'}{p.employeeSnapshot?.designation ? ` · ${p.employeeSnapshot.designation}` : ''}
                        </div>
                        <div className="text-xs font-mono text-zinc-600 mt-1">{p.payslipNumber}</div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700/50 capitalize">
                          {String(p.status || 'unknown').replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right font-mono text-zinc-200">{formatMoney(p.currency || 'USD', gross)}</td>
                      <td className="px-6 py-4 text-right font-mono text-red-400">{formatMoney(p.currency || 'USD', deductions)}</td>
                      <td className="px-6 py-4 text-right font-mono text-emerald-400">{formatMoney(p.currency || 'USD', net)}</td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => downloadPayslipPdf(p._id, p.payslipNumber)}
                          disabled={busy !== null}
                          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs disabled:opacity-50"
                        >
                          <Download className="w-3.5 h-3.5" />
                          PDF
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {payslips.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-10 text-center text-zinc-500">
                      No payslips generated yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
