'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api, { handleAuthCallback, isAuthenticated } from '@/lib/api';
import Link from 'next/link';

export default function MyPayslips() {
  const router = useRouter();
  const [payslips, setPayslips] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Handle SSO callback
    handleAuthCallback();

    // Check auth
    if (!isAuthenticated()) {
      router.push('/login');
      return;
    }

    // Fetch payslips
    api.get('/payroll/my-payslips')
      .then(res => {
        setPayslips(res.data.payslips || res.data || []);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to fetch payslips:', err);
        setLoading(false);
      });
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="relative w-16 h-16 mx-auto mb-6">
            <div className="absolute inset-0 bg-gradient-to-tr from-amber-500 to-orange-400 rounded-2xl opacity-20 blur-xl animate-pulse" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-12 h-12 rounded-full border-[3px] border-amber-100 border-t-amber-500 animate-spin" />
            </div>
          </div>
          <p className="text-slate-400 font-medium">Loading payslips...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Header Section */}
      <div className="border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-6 lg:px-8 py-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/25">
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-900">My Payslips</h1>
                <p className="text-slate-500 text-sm">View and download your compensation statements</p>
              </div>
            </div>

            <Link
              href="/"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 font-medium text-sm hover:bg-slate-50 hover:border-slate-300 transition-all"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Back to Dashboard
            </Link>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-6 lg:px-8 py-8">
        {/* Stats Summary */}
        {payslips.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            <div className="rounded-xl border border-slate-100 bg-gradient-to-br from-slate-50 to-white p-5">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
                  <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <span className="text-sm font-medium text-slate-600">Total Payslips</span>
              </div>
              <p className="text-2xl font-bold text-slate-900">{payslips.length}</p>
            </div>

            <div className="rounded-xl border border-slate-100 bg-gradient-to-br from-slate-50 to-white p-5">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                  <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <span className="text-sm font-medium text-slate-600">Latest Net Pay</span>
              </div>
              <p className="text-2xl font-bold text-emerald-600">
                {payslips[0] ? new Intl.NumberFormat('en-US', { style: 'currency', currency: payslips[0].currency || 'USD' }).format(payslips[0].netPay || 0) : '$0.00'}
              </p>
            </div>

            <div className="rounded-xl border border-slate-100 bg-gradient-to-br from-slate-50 to-white p-5">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                  <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <span className="text-sm font-medium text-slate-600">Latest Period</span>
              </div>
              <p className="text-2xl font-bold text-slate-900">
                {payslips[0]?.period?.month && payslips[0]?.period?.year
                  ? `${new Date(0, payslips[0].period.month - 1).toLocaleString('default', { month: 'short' })} ${payslips[0].period.year}`
                  : '--'}
              </p>
            </div>
          </div>
        )}

        {/* Payslips List */}
        <div className="space-y-6">
          {payslips.map(slip => (
            <div
              key={slip._id}
              className="group rounded-2xl border border-slate-100 bg-white overflow-hidden hover:shadow-xl hover:shadow-slate-200/50 hover:border-slate-200 transition-all duration-300"
            >
              {/* Payslip Header */}
              <div className="bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50 px-6 py-5 border-b border-amber-100/50">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-md shadow-amber-500/20">
                      <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="font-bold text-lg text-slate-900">
                        {slip.period?.month && slip.period?.year
                          ? `${new Date(0, slip.period.month - 1).toLocaleString('default', { month: 'long' })} ${slip.period.year}`
                          : slip.payrollRunId?.month && slip.payrollRunId?.year
                          ? `${new Date(0, slip.payrollRunId.month - 1).toLocaleString('default', { month: 'long' })} ${slip.payrollRunId.year}`
                          : 'Payslip'}
                      </h3>
                      <p className="text-sm text-slate-500 flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        Processed: {new Date(slip.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                      </p>
                    </div>
                  </div>

                  <div className="text-right">
                    <p className="text-xs text-slate-500 uppercase tracking-wider font-medium mb-1">Net Pay</p>
                    <p className="font-bold text-2xl bg-gradient-to-r from-emerald-600 to-green-600 bg-clip-text text-transparent">
                      {new Intl.NumberFormat('en-US', { style: 'currency', currency: slip.currency || 'USD' }).format(slip.netPay || 0)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Payslip Body */}
              <div className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Earnings */}
                  <div>
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-6 h-6 rounded-md bg-emerald-100 flex items-center justify-center">
                        <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                        </svg>
                      </div>
                      <h4 className="font-semibold text-sm uppercase tracking-wider text-slate-500">Earnings</h4>
                    </div>

                    <div className="space-y-3">
                      <div className="flex justify-between items-center py-2 border-b border-slate-50">
                        <span className="text-slate-600 text-sm">Basic Salary</span>
                        <span className="font-medium text-slate-900">{(slip.earnings?.basic || 0).toFixed(2)}</span>
                      </div>
                      {slip.earnings?.hra > 0 && (
                        <div className="flex justify-between items-center py-2 border-b border-slate-50">
                          <span className="text-slate-600 text-sm">HRA</span>
                          <span className="font-medium text-slate-900">{slip.earnings.hra.toFixed(2)}</span>
                        </div>
                      )}
                      {slip.earnings?.transport > 0 && (
                        <div className="flex justify-between items-center py-2 border-b border-slate-50">
                          <span className="text-slate-600 text-sm">Transport</span>
                          <span className="font-medium text-slate-900">{slip.earnings.transport.toFixed(2)}</span>
                        </div>
                      )}
                      {slip.earnings?.bonus > 0 && (
                        <div className="flex justify-between items-center py-2 border-b border-slate-50">
                          <span className="text-emerald-600 text-sm font-medium">Bonus</span>
                          <span className="font-medium text-emerald-600">{slip.earnings.bonus.toFixed(2)}</span>
                        </div>
                      )}
                      {slip.earnings?.other?.map((item: any, i: number) => (
                        <div key={i} className="flex justify-between items-center py-2 border-b border-slate-50">
                          <span className="text-slate-600 text-sm">{item.name}</span>
                          <span className="font-medium text-slate-900">{item.amount.toFixed(2)}</span>
                        </div>
                      ))}
                      <div className="flex justify-between items-center py-3 bg-gradient-to-r from-emerald-50 to-green-50 -mx-2 px-3 rounded-lg">
                        <span className="font-semibold text-emerald-800 text-sm">Total Gross</span>
                        <span className="font-bold text-emerald-700">{(slip.earnings?.totalGross || 0).toFixed(2)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Deductions */}
                  <div>
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-6 h-6 rounded-md bg-red-100 flex items-center justify-center">
                        <svg className="w-3.5 h-3.5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
                        </svg>
                      </div>
                      <h4 className="font-semibold text-sm uppercase tracking-wider text-slate-500">Deductions</h4>
                    </div>

                    <div className="space-y-3">
                      {slip.deductions?.income_tax > 0 && (
                        <div className="flex justify-between items-center py-2 border-b border-slate-50">
                          <span className="text-slate-600 text-sm">Income Tax</span>
                          <span className="font-medium text-red-600">-{slip.deductions.income_tax.toFixed(2)}</span>
                        </div>
                      )}
                      {slip.deductions?.social_security > 0 && (
                        <div className="flex justify-between items-center py-2 border-b border-slate-50">
                          <span className="text-slate-600 text-sm">Social Security</span>
                          <span className="font-medium text-red-600">-{slip.deductions.social_security.toFixed(2)}</span>
                        </div>
                      )}
                      {slip.deductions?.pension > 0 && (
                        <div className="flex justify-between items-center py-2 border-b border-slate-50">
                          <span className="text-slate-600 text-sm">Pension</span>
                          <span className="font-medium text-red-600">-{slip.deductions.pension.toFixed(2)}</span>
                        </div>
                      )}
                      {slip.deductions?.health_insurance > 0 && (
                        <div className="flex justify-between items-center py-2 border-b border-slate-50">
                          <span className="text-slate-600 text-sm">Health Insurance</span>
                          <span className="font-medium text-red-600">-{slip.deductions.health_insurance.toFixed(2)}</span>
                        </div>
                      )}
                      {slip.deductions?.unpaid_leave > 0 && (
                        <div className="flex justify-between items-center py-2 border-b border-slate-50">
                          <span className="text-red-600 text-sm font-medium">Unpaid Leave</span>
                          <span className="font-medium text-red-600">-{slip.deductions.unpaid_leave.toFixed(2)}</span>
                        </div>
                      )}
                      {slip.deductions?.other?.map((item: any, i: number) => (
                        <div key={i} className="flex justify-between items-center py-2 border-b border-slate-50">
                          <span className="text-slate-600 text-sm">{item.name}</span>
                          <span className="font-medium text-red-600">-{item.amount.toFixed(2)}</span>
                        </div>
                      ))}
                      <div className="flex justify-between items-center py-3 bg-gradient-to-r from-red-50 to-rose-50 -mx-2 px-3 rounded-lg">
                        <span className="font-semibold text-red-800 text-sm">Total Deductions</span>
                        <span className="font-bold text-red-700">-{(slip.deductions?.totalDeductions || 0).toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* YTD Summary */}
                {slip.ytdSummary && (
                  <div className="mt-6 pt-6 border-t border-slate-100">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-6 h-6 rounded-md bg-blue-100 flex items-center justify-center">
                        <svg className="w-3.5 h-3.5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                        </svg>
                      </div>
                      <h4 className="font-semibold text-sm uppercase tracking-wider text-slate-500">Year-to-Date Summary</h4>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="rounded-xl bg-slate-50 p-4">
                        <p className="text-xs text-slate-500 font-medium mb-1">Gross Earnings</p>
                        <p className="font-bold text-slate-900">{(slip.ytdSummary.grossEarnings || 0).toFixed(2)}</p>
                      </div>
                      <div className="rounded-xl bg-red-50 p-4">
                        <p className="text-xs text-red-600 font-medium mb-1">Total Deductions</p>
                        <p className="font-bold text-red-700">{(slip.ytdSummary.totalDeductions || 0).toFixed(2)}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-4">
                        <p className="text-xs text-slate-500 font-medium mb-1">Total Tax</p>
                        <p className="font-bold text-slate-900">{(slip.ytdSummary.totalTax || 0).toFixed(2)}</p>
                      </div>
                      <div className="rounded-xl bg-emerald-50 p-4">
                        <p className="text-xs text-emerald-600 font-medium mb-1">Net Pay YTD</p>
                        <p className="font-bold text-emerald-700">{(slip.ytdSummary.netPay || 0).toFixed(2)}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Empty State */}
          {payslips.length === 0 && (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 p-12 text-center">
              <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-white border border-slate-100 flex items-center justify-center shadow-sm">
                <svg className="w-10 h-10 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-slate-700 mb-2">No Payslips Yet</h3>
              <p className="text-slate-500 max-w-md mx-auto leading-relaxed">
                Your payslips will appear here once payroll has been processed for your account.
                Check back after your first pay cycle.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
