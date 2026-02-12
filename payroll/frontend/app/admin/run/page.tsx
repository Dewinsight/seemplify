'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import api, { authApi, handleAuthCallback, isAuthenticated } from '@/lib/api';
import { ArrowLeft, Calendar, CheckCircle, Loader2, Settings2 } from 'lucide-react';

const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

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
    processUnpaidLeave: true,
    calculateTax: true,
    prorate: true,
  });

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
      } catch (e) {
        router.push('/login');
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  const runLabel = `${monthNames[month - 1]} ${year}`;

  const handleRun = async () => {
    setError(null);
    if (!confirm(`Calculate payroll for ${runLabel}?\n\nThis will generate draft payslips for review and approval.`)) {
      return;
    }

    setProcessing(true);
    try {
      const res = await api.post('/payroll/runs', {
        month,
        year,
        paymentDate,
        settings,
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
            <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
              Run Payroll
            </h1>
            <p className="text-zinc-500 mt-1">Calculate payroll and generate draft payslips for HR review</p>
          </div>
        </div>

        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/20 text-red-200 rounded-xl p-4">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6">
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
          </div>

          <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-6">
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
                { key: 'processUnpaidLeave', label: 'Apply unpaid leave deductions' },
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

        <div className="mt-6 flex items-center justify-end">
          <button
            onClick={handleRun}
            disabled={processing}
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

