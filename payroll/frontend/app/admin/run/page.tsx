'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api, { handleAuthCallback, isAuthenticated, authApi } from '@/lib/api';
import Link from 'next/link';

export default function AdminPayrollRun() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [isHRAdmin, setIsHRAdmin] = useState(false);

  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [paymentDate, setPaymentDate] = useState(
    new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().split('T')[0]
  );

  useEffect(() => {
    // Handle SSO callback
    handleAuthCallback();

    // Check auth
    if (!isAuthenticated()) {
      router.push('/login');
      return;
    }

    // Check if user is HR admin
    const checkAccess = async () => {
      try {
        const response = await authApi.getMe();
        const user = response.user;
        const currentOrgId = response.currentOrganizationId;

        // Check if user has HR admin role in current org
        const currentOrg = user.organizations?.find((o: any) => o.id === currentOrgId);
        const hasAccess = currentOrg && ['owner', 'admin', 'hr_manager'].includes(currentOrg.role);

        if (!hasAccess) {
          alert('Access denied. Only HR administrators can run payroll.');
          router.push('/dashboard');
          return;
        }

        setIsHRAdmin(true);
        setLoading(false);
      } catch (error) {
        console.error('Failed to check access:', error);
        router.push('/login');
      }
    };

    checkAccess();
  }, [router]);

  const handleRun = async () => {
    if (!confirm(`Are you sure you want to run payroll for ${month}/${year}?\n\nThis will:\n- Calculate salaries for all active employees\n- Generate payslips\n- Process approved bonuses and deductions`)) {
      return;
    }

    setProcessing(true);
    setResult(null);

    try {
      const res = await api.post('/payroll/runs', {
        month,
        year,
        paymentDate,
        settings: {
          includeAllowances: true,
          includeBonuses: true,
          includeCommissions: true,
          includeOvertime: true,
          includeReimbursements: true,
          includeLoans: true,
          includeUnpaidLeave: true,
          generatePayslips: true
        }
      });

      setResult(res.data);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to run payroll');
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="relative w-16 h-16 mx-auto mb-6">
            <div className="absolute inset-0 bg-gradient-to-tr from-red-500 to-rose-400 rounded-2xl opacity-20 blur-xl animate-pulse" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-12 h-12 rounded-full border-[3px] border-red-100 border-t-red-500 animate-spin" />
            </div>
          </div>
          <p className="text-slate-400 font-medium">Checking access...</p>
        </div>
      </div>
    );
  }

  if (!isHRAdmin) {
    return null;
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Header Section */}
      <div className="border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-6 lg:px-8 py-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-red-500 to-rose-500 flex items-center justify-center shadow-lg shadow-red-500/25">
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Execute Payroll Run</h1>
                <p className="text-slate-500 text-sm">Process monthly salaries and generate payslips</p>
              </div>
            </div>

            <Link
              href="/"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 font-medium text-sm hover:bg-slate-50 hover:border-slate-300 transition-all"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Dashboard
            </Link>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Configuration Card */}
          <div className="rounded-2xl border border-slate-100 bg-white overflow-hidden shadow-sm">
            <div className="bg-gradient-to-r from-red-500 to-rose-500 px-6 py-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-white text-lg">Run Configuration</h3>
                  <p className="text-red-100 text-sm">Set payroll parameters</p>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Month</label>
                  <select
                    value={month}
                    onChange={e => setMonth(parseInt(e.target.value))}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all"
                  >
                    {[...Array(12)].map((_, i) => (
                      <option key={i + 1} value={i + 1}>
                        {new Date(0, i).toLocaleString('default', { month: 'long' })}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Year</label>
                  <input
                    type="number"
                    min="2020"
                    max="2030"
                    value={year}
                    onChange={e => setYear(parseInt(e.target.value))}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Payment Date</label>
                <input
                  type="date"
                  value={paymentDate}
                  onChange={e => setPaymentDate(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all"
                />
                <p className="text-xs text-slate-400 mt-2">Date when salaries will be disbursed</p>
              </div>

              <div className="rounded-xl bg-slate-50 border border-slate-100 p-5">
                <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                  <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Processing Options
                </h4>
                <div className="space-y-2">
                  {[
                    'Include all allowances (HRA, Transport, etc.)',
                    'Process approved bonuses & commissions',
                    'Calculate overtime payments',
                    'Apply loan deductions',
                    'Process unpaid leave deductions',
                    'Generate individual payslips'
                  ].map((option, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-slate-600">
                      <svg className="w-4 h-4 text-emerald-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      <span>{option}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100">
                <button
                  onClick={handleRun}
                  disabled={processing}
                  className="w-full py-4 rounded-xl bg-gradient-to-r from-red-500 to-rose-500 text-white font-semibold text-lg shadow-lg shadow-red-500/25 hover:shadow-xl hover:shadow-red-500/30 hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                >
                  {processing ? (
                    <span className="flex items-center justify-center gap-3">
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Processing Payroll...
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Execute Payroll Run
                    </span>
                  )}
                </button>
                <p className="text-xs text-slate-400 text-center mt-3">
                  This action will process payroll for all active employees
                </p>
              </div>
            </div>
          </div>

          {/* Result Card */}
          {result ? (
            <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-white to-emerald-50/50 overflow-hidden shadow-sm">
              <div className="bg-gradient-to-r from-emerald-500 to-green-500 px-6 py-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                    <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-white text-lg">Payroll Run Successful</h3>
                    <p className="text-emerald-100 text-sm">All employees processed</p>
                  </div>
                </div>
              </div>

              <div className="p-6 space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-xl bg-white border border-slate-100 p-4 shadow-sm">
                    <p className="text-xs text-slate-500 font-medium mb-1">Run Number</p>
                    <p className="font-bold text-lg text-slate-900">{result.run?.runNumber || result.runId}</p>
                  </div>
                  <div className="rounded-xl bg-white border border-emerald-100 p-4 shadow-sm">
                    <p className="text-xs text-emerald-600 font-medium mb-1">Status</p>
                    <p className="font-bold text-lg text-emerald-600 capitalize">{result.run?.status || 'Completed'}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 p-5">
                    <div className="flex items-center gap-2 mb-2">
                      <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                      <span className="text-sm text-blue-600 font-medium">Employees</span>
                    </div>
                    <p className="font-bold text-3xl text-blue-700">{result.run?.totalEmployees || 0}</p>
                  </div>
                  <div className="rounded-xl bg-gradient-to-br from-emerald-50 to-green-50 border border-emerald-100 p-5">
                    <div className="flex items-center gap-2 mb-2">
                      <svg className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="text-sm text-emerald-600 font-medium">Total Cost</span>
                    </div>
                    <p className="font-bold text-2xl text-emerald-700">
                      ${(result.run?.totalGrossPayroll || result.run?.totalPayrollCost || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>

                {result.run?.totalNetPayroll && (
                  <div className="rounded-xl bg-white border border-slate-100 p-5 shadow-sm">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-600 font-medium">Net Payroll (After Deductions)</span>
                      <span className="font-bold text-xl text-slate-900">
                        ${result.run.totalNetPayroll.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                )}

                <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-5">
                  <div className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                      <p className="font-medium text-emerald-800">Payslips Generated</p>
                      <p className="text-sm text-emerald-600 mt-1">
                        Employees can now view their payslips in the employee portal.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 flex flex-col items-center justify-center p-12 text-center">
              <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-white border border-slate-100 flex items-center justify-center shadow-sm">
                <svg className="w-10 h-10 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-slate-700 mb-2">Ready to Run</h3>
              <p className="text-slate-500 max-w-sm leading-relaxed">
                Configure the payroll run parameters on the left and click "Execute Payroll Run" to process salaries.
              </p>
            </div>
          )}
        </div>

        {/* Warning Section */}
        <div className="mt-8 rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50/50 p-6">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <h4 className="font-semibold text-amber-800 mb-2">Important Notes</h4>
              <ul className="space-y-1.5 text-sm text-amber-700">
                <li className="flex items-start gap-2">
                  <span className="text-amber-500 mt-1">•</span>
                  Ensure all employee profiles are up to date before running payroll
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-amber-500 mt-1">•</span>
                  Verify approved bonus and compensation requests are finalized
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-amber-500 mt-1">•</span>
                  Review leave records for accurate unpaid leave deductions
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-amber-500 mt-1">•</span>
                  Payroll runs generate payslips in "draft" status for review
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
