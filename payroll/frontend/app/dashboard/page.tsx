'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import api, { handleAuthCallback, isAuthenticated, authApi } from '@/lib/api';
import Link from 'next/link';
import { usePayrollViewMode } from '@/context/PayrollViewModeContext';
import {
  FileText,
  Users,
  Calculator,
  LayoutGrid,
  TrendingUp,
  Calendar,
  CheckCircle,
  Clock,
  AlertCircle,
  History,
  ClipboardCheck,
  ArrowRight,
} from 'lucide-react';

export default function Dashboard() {
  const router = useRouter();
  const { viewMode, isHRAdmin: contextHRAdmin } = usePayrollViewMode();

  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [currentOrg, setCurrentOrg] = useState<any>(null);
  const [dashboardStats, setDashboardStats] = useState<any>(null);
  const [adminOverview, setAdminOverview] = useState<any>(null);

  useEffect(() => {
    handleAuthCallback();

    if (!isAuthenticated()) {
      router.push('/login');
      return;
    }

    const fetchUser = async () => {
      try {
        const response = await authApi.getMe();
        setUser(response.user);

        let org: any = null;
        if (Array.isArray(response.user?.organizations) && response.user.organizations.length > 0) {
          org = response.currentOrganizationId
            ? response.user.organizations.find((o: any) => o.id === response.currentOrganizationId) || response.user.organizations[0]
            : response.user.organizations[0];
          setCurrentOrg(org);
        }

        try {
          const statsRes = await api.get('/payroll/dashboard-stats');
          setDashboardStats(statsRes.data);
        } catch (statsErr) {
          console.log('Could not fetch dashboard stats:', statsErr);
        }

        const isHr = org && ['owner', 'admin', 'hr_manager'].includes(org.role);
        if (isHr) {
          try {
            const overviewRes = await api.get('/payroll/admin/overview');
            setAdminOverview(overviewRes.data);
          } catch (overviewErr) {
            console.log('Could not fetch admin overview:', overviewErr);
          }
        }

        setLoading(false);
      } catch (error: any) {
        console.error('Failed to fetch user:', error);
        if (error.response?.status === 401) {
          router.push('/login');
        }
      }
    };

    fetchUser();
  }, [router]);

  const isHRAdmin = currentOrg && ['owner', 'admin', 'hr_manager'].includes(currentOrg.role);
  const hasAdminMode = !!isHRAdmin && !!contextHRAdmin;
  const isAdminWorkspace = hasAdminMode && viewMode === 'admin';

  const currency = dashboardStats?.currency || 'USD';
  const profileOk = !!dashboardStats?.hasProfile;
  const profileStatus = dashboardStats?.profileStatus || 'pending_setup';
  const latestRun = adminOverview?.latestRun;
  const latestRunStatus = String(latestRun?.status || '');

  const greetingName = useMemo(() => {
    const first = user?.name?.split(' ')?.[0];
    return first || 'User';
  }, [user]);

  const formatMoney = (amount: any) =>
    Number(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 flex items-center justify-center pt-16">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-amber-500 mx-auto mb-4"></div>
          <p className="text-zinc-400 font-medium">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-r from-amber-500/20 via-orange-500/20 to-yellow-500/20 rounded-2xl blur-3xl"></div>
        <div className="relative bg-gradient-to-br from-zinc-900/80 to-zinc-800/80 backdrop-blur-xl rounded-2xl border border-zinc-700/50 p-8 shadow-2xl shadow-amber-500/10">
          <div className="flex justify-between items-start flex-wrap gap-4">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-white via-zinc-100 to-zinc-200 bg-clip-text text-transparent">
                Welcome back, {greetingName}
              </h1>
              <p className="text-zinc-400 mt-2">
                {isAdminWorkspace ? 'Admin workspace for' : 'Payroll dashboard for'}{' '}
                <span className="text-zinc-300 font-medium">{currentOrg?.name || 'your organization'}</span>
              </p>
              {hasAdminMode && (
                <div className="mt-3 inline-flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900/70 px-2.5 py-1 text-xs text-zinc-300">
                  <LayoutGrid className="w-3.5 h-3.5" />
                  Viewing: {isAdminWorkspace ? 'Admin View' : 'Personal View'}
                </div>
              )}
            </div>
            <a
              href={process.env.NEXT_PUBLIC_IDP_URL || 'http://localhost:4000'}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-amber-500 via-orange-500 to-yellow-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-amber-500/20 transition-all hover:shadow-amber-500/30 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
            >
              <LayoutGrid className="h-4 w-4" />
              App Hub
            </a>
          </div>
        </div>
      </div>

      {isAdminWorkspace ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <Link href="/admin/employees" className="group">
              <div className="relative overflow-hidden bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 rounded-xl shadow-lg border border-amber-500/20 p-6 transition-all duration-300 hover:scale-105 hover:shadow-amber-500/10">
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/20 mb-4">
                  <Users className="h-6 w-6 text-white" />
                </div>
                <h3 className="font-semibold text-zinc-100 text-lg mb-2">Employee Management</h3>
                <p className="text-zinc-400 text-sm mb-4 leading-relaxed">Configure salaries, tax, allowances, deductions, and bank details for all staff.</p>
                <div className="text-amber-400 text-sm font-medium inline-flex items-center gap-1.5">
                  Open Employees
                  <ArrowRight className="w-4 h-4" />
                </div>
              </div>
            </Link>

            <Link href="/admin/approvals" className="group">
              <div className="relative overflow-hidden bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 rounded-xl shadow-lg border border-purple-500/20 p-6 transition-all duration-300 hover:scale-105 hover:shadow-purple-500/10">
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-purple-500 to-violet-500 flex items-center justify-center shadow-lg shadow-purple-500/20 mb-4">
                  <ClipboardCheck className="h-6 w-6 text-white" />
                </div>
                <h3 className="font-semibold text-zinc-100 text-lg mb-2">Approvals</h3>
                <p className="text-zinc-400 text-sm mb-4 leading-relaxed">Review overtime, bonus, reimbursement, and compensation changes before payroll.</p>
                <div className="text-purple-400 text-sm font-medium inline-flex items-center gap-1.5">
                  Review Queue
                  <ArrowRight className="w-4 h-4" />
                </div>
              </div>
            </Link>

            <Link href="/admin/run" className="group">
              <div className="relative overflow-hidden bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 rounded-xl shadow-lg border border-red-500/20 p-6 transition-all duration-300 hover:scale-105 hover:shadow-red-500/10">
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-red-500 to-rose-500 flex items-center justify-center shadow-lg shadow-red-500/20 mb-4">
                  <Calculator className="h-6 w-6 text-white" />
                </div>
                <h3 className="font-semibold text-zinc-100 text-lg mb-2">Run Payroll</h3>
                <p className="text-zinc-400 text-sm mb-4 leading-relaxed">Calculate payroll for the period and generate draft payslips for review.</p>
                <div className="text-red-400 text-sm font-medium inline-flex items-center gap-1.5">
                  Start Run
                  <ArrowRight className="w-4 h-4" />
                </div>
              </div>
            </Link>

            <Link href="/admin/runs" className="group">
              <div className="relative overflow-hidden bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 rounded-xl shadow-lg border border-cyan-500/20 p-6 transition-all duration-300 hover:scale-105 hover:shadow-cyan-500/10">
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-cyan-500 to-teal-500 flex items-center justify-center shadow-lg shadow-cyan-500/20 mb-4">
                  <History className="h-6 w-6 text-white" />
                </div>
                <h3 className="font-semibold text-zinc-100 text-lg mb-2">Run History</h3>
                <p className="text-zinc-400 text-sm mb-4 leading-relaxed">Track run status, inspect generated payslips, and export accountant-ready files.</p>
                <div className="text-cyan-400 text-sm font-medium inline-flex items-center gap-1.5">
                  Open History
                  <ArrowRight className="w-4 h-4" />
                </div>
              </div>
            </Link>
          </div>

          {adminOverview && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 rounded-xl shadow-lg border border-zinc-700/50 p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                    <Users className="h-5 w-5 text-blue-400" />
                  </div>
                  <span className="text-sm font-medium text-zinc-300">Employees (IDP)</span>
                </div>
                <p className="text-2xl font-bold text-blue-300">{adminOverview.activeEmployees || 0}</p>
              </div>

              <Link href="/admin/employees?setup=pending" className="bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 rounded-xl shadow-lg border border-orange-500/20 p-5 hover:border-orange-400/40 transition-colors">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center">
                    <AlertCircle className="h-5 w-5 text-orange-400" />
                  </div>
                  <span className="text-sm font-medium text-zinc-300">Profiles Needing Setup</span>
                </div>
                <p className="text-2xl font-bold text-orange-300">{adminOverview.profilesNeedingSetup || 0}</p>
              </Link>

              <Link href="/admin/approvals" className="bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 rounded-xl shadow-lg border border-purple-500/20 p-5 hover:border-purple-400/40 transition-colors">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                    <Clock className="h-5 w-5 text-purple-400" />
                  </div>
                  <span className="text-sm font-medium text-zinc-300">Pending Requests</span>
                </div>
                <p className="text-2xl font-bold text-purple-300">{adminOverview.pendingCompensationRequests || 0}</p>
              </Link>

              <Link href={latestRun?._id ? `/admin/runs/${latestRun._id}` : '/admin/runs'} className="bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 rounded-xl shadow-lg border border-amber-500/20 p-5 hover:border-amber-400/40 transition-colors">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                    <Calculator className="h-5 w-5 text-amber-400" />
                  </div>
                  <span className="text-sm font-medium text-zinc-300">Runs Pending Action</span>
                </div>
                <p className="text-2xl font-bold text-amber-300">{adminOverview.pendingRuns || 0}</p>
              </Link>
            </div>
          )}

          {isHRAdmin && (
            <div className="bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 rounded-xl shadow-lg border border-zinc-700/50 p-6">
              <div className="flex items-center justify-between gap-3 mb-5">
                <h2 className="text-lg font-semibold text-zinc-100">Payroll Workflow</h2>
                <span className="text-xs text-zinc-500">Prepare payroll for accountant export</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Link href="/admin/employees?setup=pending" className="group">
                  <div className="h-full rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 hover:border-amber-500/30 transition-colors">
                    <div className="text-xs text-zinc-500 mb-2">Step 1</div>
                    <div className="text-sm font-semibold text-zinc-200 mb-2">Configure Employees</div>
                    <div className="text-xs text-zinc-400">
                      {Number(adminOverview?.profilesNeedingSetup || 0) > 0
                        ? `${adminOverview.profilesNeedingSetup} profile(s) need setup`
                        : 'All employee payroll profiles are configured'}
                    </div>
                    {Number(adminOverview?.idpSync?.missingProfiles || 0) > 0 && (
                      <div className="text-xs text-orange-300 mt-2">
                        {adminOverview.idpSync.missingProfiles} member(s) not onboarded yet
                      </div>
                    )}
                  </div>
                </Link>

                <Link href="/admin/approvals" className="group">
                  <div className="h-full rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 hover:border-purple-500/30 transition-colors">
                    <div className="text-xs text-zinc-500 mb-2">Step 2</div>
                    <div className="text-sm font-semibold text-zinc-200 mb-2">Approve Requests</div>
                    <div className="text-xs text-zinc-400">
                      {Number(adminOverview?.pendingCompensationRequests || 0) > 0
                        ? `${adminOverview.pendingCompensationRequests} request(s) pending`
                        : 'No pending compensation approvals'}
                    </div>
                  </div>
                </Link>

                <Link href={latestRun?._id ? `/admin/runs/${latestRun._id}` : '/admin/run'} className="group">
                  <div className="h-full rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 hover:border-red-500/30 transition-colors">
                    <div className="text-xs text-zinc-500 mb-2">Step 3</div>
                    <div className="text-sm font-semibold text-zinc-200 mb-2">Run Payroll</div>
                    <div className="text-xs text-zinc-400">
                      {latestRun?._id
                        ? `Latest ${latestRun.runNumber || 'run'} is ${latestRunStatus.replace(/_/g, ' ') || 'unknown'}`
                        : 'No payroll run yet for the current cycle'}
                    </div>
                  </div>
                </Link>

                <Link href={latestRun?._id ? `/admin/runs/${latestRun._id}` : '/admin/runs'} className="group">
                  <div className="h-full rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 hover:border-emerald-500/30 transition-colors">
                    <div className="text-xs text-zinc-500 mb-2">Step 4</div>
                    <div className="text-sm font-semibold text-zinc-200 mb-2">Finalize and Export</div>
                    <div className="text-xs text-zinc-400">
                      {latestRunStatus === 'exported'
                        ? 'Latest run already exported to accounting'
                        : latestRunStatus === 'approved'
                          ? 'Latest run approved and ready to finalize'
                          : 'Finalize after approval to produce accountant export'}
                    </div>
                  </div>
                </Link>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <Link href="/payslips" className="group">
              <div className="relative overflow-hidden bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 rounded-xl shadow-lg border border-zinc-700/50 hover:border-amber-500/30 p-6 transition-all duration-300 hover:scale-105 hover:shadow-amber-500/10">
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/20 mb-4">
                  <FileText className="h-6 w-6 text-white" />
                </div>
                <h3 className="font-semibold text-zinc-100 text-lg mb-2">My Payslips</h3>
                <p className="text-zinc-400 text-sm mb-4 leading-relaxed">Access your payslips and download payroll statements.</p>
                <div className="text-amber-400 text-sm font-medium inline-flex items-center gap-1.5">
                  View Payslips
                  <ArrowRight className="w-4 h-4" />
                </div>
              </div>
            </Link>

            <Link href="/requests" className="group">
              <div className="relative overflow-hidden bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 rounded-xl shadow-lg border border-zinc-700/50 hover:border-purple-500/30 p-6 transition-all duration-300 hover:scale-105 hover:shadow-purple-500/10">
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-purple-500 to-violet-500 flex items-center justify-center shadow-lg shadow-purple-500/20 mb-4">
                  <Clock className="h-6 w-6 text-white" />
                </div>
                <h3 className="font-semibold text-zinc-100 text-lg mb-2">My Requests</h3>
                <p className="text-zinc-400 text-sm mb-4 leading-relaxed">Submit and track overtime or reimbursement requests.</p>
                <div className="text-purple-400 text-sm font-medium inline-flex items-center gap-1.5">
                  View Requests
                  <ArrowRight className="w-4 h-4" />
                </div>
              </div>
            </Link>

            {hasAdminMode && (
              <div className="relative overflow-hidden bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 rounded-xl shadow-lg border border-cyan-500/20 p-6">
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-cyan-500 to-teal-500 flex items-center justify-center shadow-lg shadow-cyan-500/20 mb-4">
                  <Users className="h-6 w-6 text-white" />
                </div>
                <h3 className="font-semibold text-zinc-100 text-lg mb-2">Admin Workspace</h3>
                <p className="text-zinc-400 text-sm mb-2 leading-relaxed">
                  Switch to Admin View from the top navigation to manage employees and run payroll.
                </p>
                <p className="text-xs text-zinc-500">Only HR/Admin roles can access admin workspace.</p>
              </div>
            )}

            <div className="relative overflow-hidden bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 rounded-xl shadow-lg border border-zinc-700/50 p-6">
              <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-emerald-500 to-green-500 flex items-center justify-center shadow-lg shadow-emerald-500/20 mb-5">
                <TrendingUp className="h-6 w-6 text-white" />
              </div>
              <h3 className="font-semibold text-zinc-100 text-lg mb-4">Year to Date</h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center py-2 border-b border-zinc-800/50">
                  <span className="text-zinc-400 text-sm">Gross Earnings</span>
                  <span className="font-semibold text-zinc-200">{currency} {formatMoney(dashboardStats?.ytd?.grossEarnings)}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-zinc-800/50">
                  <span className="text-zinc-400 text-sm">Total Tax</span>
                  <span className="font-semibold text-zinc-200">{currency} {formatMoney(dashboardStats?.ytd?.totalTax)}</span>
                </div>
                <div className="flex justify-between items-center py-2 bg-emerald-500/10 -mx-2 px-2 rounded-lg border border-emerald-500/20">
                  <span className="text-emerald-400 font-medium text-sm">Net Pay</span>
                  <span className="font-bold text-lg text-emerald-300">{currency} {formatMoney(dashboardStats?.ytd?.netPay)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 rounded-xl shadow-lg border border-amber-500/20 p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/20">
                  <Calendar className="h-5 w-5 text-white" />
                </div>
                <span className="text-sm font-medium text-zinc-300">Next Payday</span>
              </div>
              <p className="text-2xl font-bold text-amber-300">
                {dashboardStats?.nextPayday
                  ? new Date(dashboardStats.nextPayday).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                  : '--'}
              </p>
              <p className="text-xs text-zinc-500 mt-1">{dashboardStats?.nextPayday ? 'Scheduled' : 'No scheduled payroll'}</p>
            </div>

            <div className="bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 rounded-xl shadow-lg border border-blue-500/20 p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
                  <FileText className="h-5 w-5 text-white" />
                </div>
                <span className="text-sm font-medium text-zinc-300">Total Payslips</span>
              </div>
              <p className="text-2xl font-bold text-blue-300">{dashboardStats?.totalPayslips || 0}</p>
              <p className="text-xs text-zinc-500 mt-1">This year</p>
            </div>

            <div className="bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 rounded-xl shadow-lg border border-emerald-500/20 p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-green-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                  <CheckCircle className="h-5 w-5 text-white" />
                </div>
                <span className="text-sm font-medium text-zinc-300">Payroll Profile</span>
              </div>
              <p className={`text-2xl font-bold ${profileOk ? 'text-emerald-300' : 'text-orange-300'}`}>
                {profileOk ? 'Configured' : 'Needs Setup'}
              </p>
              <p className="text-xs text-zinc-500 mt-1 capitalize">{String(profileStatus).replace(/_/g, ' ')}</p>
              {!profileOk && isHRAdmin && (
                <Link href="/admin/employees?setup=pending" className="mt-3 inline-flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300">
                  Set up payroll profile
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              )}
            </div>
          </div>

          <div className="bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 rounded-xl shadow-lg border border-zinc-700/50 p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-zinc-800/60 flex items-center justify-center">
                <Clock className="w-5 h-5 text-zinc-400" />
              </div>
              <h2 className="text-lg font-semibold text-zinc-100">Recent Activity</h2>
            </div>

            <div className="rounded-xl border border-zinc-800/50 bg-zinc-900/40 overflow-hidden">
              <div className="p-12 text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-zinc-800/60 flex items-center justify-center">
                  <Clock className="w-8 h-8 text-zinc-600" />
                </div>
                <h3 className="text-zinc-400 font-medium mb-1">No recent activity</h3>
                <p className="text-zinc-500 text-sm max-w-sm mx-auto">
                  Your payslips and compensation updates will appear here once they are processed.
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
