'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api, { handleAuthCallback, isAuthenticated, authApi } from '@/lib/api';
import Link from 'next/link';

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [currentOrg, setCurrentOrg] = useState<any>(null);

  useEffect(() => {
    // Handle SSO callback if access token is in URL hash
    handleAuthCallback();

    // Check if authenticated
    if (!isAuthenticated()) {
      console.log('🔒 Not authenticated, redirecting to login');
      router.push('/login');
      return;
    }

    // Fetch current user info
    const fetchUser = async () => {
      try {
        const response = await authApi.getMe();
        setUser(response.user);

        // Find current organization
        if (response.currentOrganizationId && response.user?.organizations) {
          const org = response.user.organizations.find(
            (o: any) => o.id === response.currentOrganizationId
          );
          setCurrentOrg(org);
        } else if (response.user?.organizations?.length > 0) {
          setCurrentOrg(response.user.organizations[0]);
        }

        setLoading(false);
      } catch (error: any) {
        console.error('Failed to fetch user:', error);
        // If 401, redirect to login
        if (error.response?.status === 401) {
          router.push('/login');
        }
      }
    };

    fetchUser();
  }, [router]);

  // Determine user role
  const isHRAdmin = currentOrg && ['owner', 'admin', 'hr_manager'].includes(currentOrg.role);
  const isManager = user?.teams?.some((t: any) =>
    t.organizationId === currentOrg?.id && ['line_manager', 'team_lead'].includes(t.role)
  );

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
          <p className="text-slate-400 font-medium">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Header Section */}
      <div className="border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-6 lg:px-8 py-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/25">
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                  </svg>
                </div>
                <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
              </div>
              <p className="text-slate-500">
                Welcome back, <span className="font-medium text-slate-700">{user?.name}</span>
              </p>
            </div>

            <div className="flex items-center gap-4">
              <div className="hidden sm:flex items-center gap-3 px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-100">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center">
                  <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                </div>
                <div>
                  <p className="text-xs text-slate-400 font-medium">Organization</p>
                  <p className="text-sm font-semibold text-slate-700">{currentOrg?.name || 'N/A'}</p>
                </div>
              </div>

              <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-100">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-white font-semibold text-sm shadow-sm">
                  {user?.name?.charAt(0) || 'U'}
                </div>
                <div>
                  <p className="text-xs text-amber-600/70 font-medium">Role</p>
                  <p className="text-sm font-semibold text-amber-700 capitalize">{currentOrg?.role?.replace(/_/g, ' ') || 'Employee'}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 lg:px-8 py-8">
        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-10">
          {/* My Payslips Card */}
          <Link href="/payslips" className="group">
            <div className="relative overflow-hidden rounded-2xl border border-slate-100 bg-white p-6 transition-all duration-300 hover:shadow-xl hover:shadow-slate-200/50 hover:-translate-y-1 hover:border-amber-200">
              <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-amber-500/5 to-orange-500/5 rounded-full -translate-y-1/2 translate-x-1/2 group-hover:scale-150 transition-transform duration-500" />

              <div className="relative">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/25 group-hover:scale-110 transition-transform duration-300">
                    <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900 text-lg">My Payslips</h3>
                    <p className="text-slate-400 text-sm">View compensation details</p>
                  </div>
                </div>

                <p className="text-slate-500 text-sm mb-5 leading-relaxed">
                  Access your monthly payslips, year-to-date earnings, and detailed tax documents.
                </p>

                <div className="flex items-center text-amber-600 font-medium text-sm group-hover:text-amber-700">
                  <span>View Payslips</span>
                  <svg className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </div>
          </Link>

          {/* Manager Card */}
          {isManager && (
            <Link href="/team" className="group">
              <div className="relative overflow-hidden rounded-2xl border border-slate-100 bg-white p-6 transition-all duration-300 hover:shadow-xl hover:shadow-slate-200/50 hover:-translate-y-1 hover:border-blue-200">
                <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-blue-500/5 to-indigo-500/5 rounded-full -translate-y-1/2 translate-x-1/2 group-hover:scale-150 transition-transform duration-500" />

                <div className="relative">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/25 group-hover:scale-110 transition-transform duration-300">
                      <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-900 text-lg">Team Compensation</h3>
                      <p className="text-slate-400 text-sm">Manage direct reports</p>
                    </div>
                  </div>

                  <p className="text-slate-500 text-sm mb-5 leading-relaxed">
                    Request bonuses, view team salaries, and submit compensation requests for your team.
                  </p>

                  <div className="flex items-center text-blue-600 font-medium text-sm group-hover:text-blue-700">
                    <span>Manage Team</span>
                    <svg className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </div>
            </Link>
          )}

          {/* HR Admin Card */}
          {isHRAdmin && (
            <Link href="/admin/run" className="group">
              <div className="relative overflow-hidden rounded-2xl border border-slate-100 bg-gradient-to-br from-white to-red-50/30 p-6 transition-all duration-300 hover:shadow-xl hover:shadow-red-100/50 hover:-translate-y-1 hover:border-red-200">
                <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-red-500/5 to-rose-500/5 rounded-full -translate-y-1/2 translate-x-1/2 group-hover:scale-150 transition-transform duration-500" />

                <div className="relative">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-red-500 to-rose-500 flex items-center justify-center shadow-lg shadow-red-500/25 group-hover:scale-110 transition-transform duration-300">
                      <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-900 text-lg">Payroll Admin</h3>
                      <p className="text-slate-400 text-sm">HR & Finance Controls</p>
                    </div>
                  </div>

                  <p className="text-slate-500 text-sm mb-5 leading-relaxed">
                    Run monthly payroll, approve requests, and manage employee compensation profiles.
                  </p>

                  <div className="flex items-center text-red-600 font-medium text-sm group-hover:text-red-700">
                    <span>Run Payroll</span>
                    <svg className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </div>
            </Link>
          )}

          {/* Year to Date Stats Card */}
          <div className="relative overflow-hidden rounded-2xl border border-slate-100 bg-white p-6">
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-emerald-500/5 to-green-500/5 rounded-full -translate-y-1/2 translate-x-1/2" />

            <div className="relative">
              <div className="flex items-center gap-4 mb-5">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-green-500 flex items-center justify-center shadow-lg shadow-emerald-500/25">
                  <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900 text-lg">Year to Date</h3>
                  <p className="text-slate-400 text-sm">Earnings summary</p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between items-center py-2 border-b border-slate-50">
                  <span className="text-slate-500 text-sm">Gross Earnings</span>
                  <span className="font-semibold text-slate-700">$0.00</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-50">
                  <span className="text-slate-500 text-sm">Total Tax</span>
                  <span className="font-semibold text-slate-700">$0.00</span>
                </div>
                <div className="flex justify-between items-center py-2 bg-gradient-to-r from-emerald-50 to-green-50 -mx-2 px-2 rounded-lg">
                  <span className="text-emerald-700 font-medium text-sm">Net Pay</span>
                  <span className="font-bold text-lg text-emerald-600">$0.00</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Recent Activity Section */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
              <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-slate-900">Recent Activity</h2>
          </div>

          <div className="rounded-2xl border border-slate-100 bg-white overflow-hidden">
            <div className="p-12 text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-slate-50 flex items-center justify-center">
                <svg className="w-8 h-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-slate-600 font-medium mb-1">No recent activity</h3>
              <p className="text-slate-400 text-sm max-w-sm mx-auto">
                Your payslips and compensation updates will appear here once they're processed.
              </p>
            </div>
          </div>
        </div>

        {/* Quick Info Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-xl border border-slate-100 bg-gradient-to-br from-slate-50 to-white p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
                <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <span className="text-sm font-medium text-slate-700">Next Payday</span>
            </div>
            <p className="text-2xl font-bold text-slate-900">--</p>
            <p className="text-xs text-slate-400 mt-1">No scheduled payroll</p>
          </div>

          <div className="rounded-xl border border-slate-100 bg-gradient-to-br from-slate-50 to-white p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <span className="text-sm font-medium text-slate-700">Total Payslips</span>
            </div>
            <p className="text-2xl font-bold text-slate-900">0</p>
            <p className="text-xs text-slate-400 mt-1">This year</p>
          </div>

          <div className="rounded-xl border border-slate-100 bg-gradient-to-br from-slate-50 to-white p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <span className="text-sm font-medium text-slate-700">Profile Status</span>
            </div>
            <p className="text-2xl font-bold text-emerald-600">Active</p>
            <p className="text-xs text-slate-400 mt-1">All systems operational</p>
          </div>
        </div>
      </div>
    </div>
  );
}
