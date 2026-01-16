'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api, { handleAuthCallback, isAuthenticated, authApi } from '@/lib/api';
import Link from 'next/link';
import {
  FileText,
  Users,
  Calculator,
  LayoutGrid,
  DollarSign,
  TrendingUp,
  Calendar,
  CheckCircle,
  Clock,
  Building2
} from 'lucide-react';

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [currentOrg, setCurrentOrg] = useState<any>(null);
  const [dashboardStats, setDashboardStats] = useState<any>(null);

  useEffect(() => {
    handleAuthCallback();

    if (!isAuthenticated()) {
      console.log('🔒 Not authenticated, redirecting to login');
      router.push('/login');
      return;
    }

    const fetchUser = async () => {
      try {
        const response = await authApi.getMe();
        setUser(response.user);

        if (response.currentOrganizationId && response.user?.organizations) {
          const org = response.user.organizations.find(
            (o: any) => o.id === response.currentOrganizationId
          );
          setCurrentOrg(org);
        } else if (response.user?.organizations?.length > 0) {
          setCurrentOrg(response.user.organizations[0]);
        }

        setLoading(false);

        // Fetch dashboard stats
        try {
          const statsRes = await api.get('/payroll/dashboard-stats');
          setDashboardStats(statsRes.data);
        } catch (statsErr) {
          console.log('Could not fetch dashboard stats:', statsErr);
        }
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
  const isManager = user?.teams?.some((t: any) =>
    t.organizationId === currentOrg?.id && ['line_manager', 'team_lead'].includes(t.role)
  );

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
      {/* Welcome Header */}
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-r from-amber-500/20 via-orange-500/20 to-yellow-500/20 rounded-2xl blur-3xl"></div>
        <div className="relative bg-gradient-to-br from-zinc-900/80 to-zinc-800/80 backdrop-blur-xl rounded-2xl border border-zinc-700/50 p-8 shadow-2xl shadow-amber-500/10">
          <div className="flex justify-between items-start flex-wrap gap-4">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-white via-zinc-100 to-zinc-200 bg-clip-text text-transparent">
                Welcome back, {user?.name?.split(' ')[0] || 'User'} 👋
              </h1>
              <p className="text-zinc-400 mt-2">
                Payroll dashboard for{' '}
                <span className="text-zinc-300 font-medium">{currentOrg?.name || 'your organization'}</span>
              </p>
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

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* My Payslips Card */}
        <Link href="/payslips" className="group">
          <div className="relative overflow-hidden bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 rounded-xl shadow-lg border border-zinc-700/50 hover:border-amber-500/30 p-6 transition-all duration-300 hover:scale-105 hover:shadow-amber-500/10">
            <div className="absolute inset-0 bg-gradient-to-br from-amber-500/0 to-orange-500/0 group-hover:from-amber-500/5 group-hover:to-orange-500/5 transition-all" />
            <div className="relative">
              <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/20 group-hover:scale-110 transition-transform mb-4">
                <FileText className="h-6 w-6 text-white" />
              </div>
              <h3 className="font-semibold text-zinc-100 text-lg mb-2">My Payslips</h3>
              <p className="text-zinc-400 text-sm mb-4 leading-relaxed">
                Access your monthly payslips, year-to-date earnings, and tax documents.
              </p>
              <div className="flex items-center text-amber-400 font-medium text-sm group-hover:text-amber-300">
                <span>View Payslips</span>
                <svg className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </div>
        </Link>

        {/* My Requests Card - ESS Feature */}
        <Link href="/requests" className="group">
          <div className="relative overflow-hidden bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 rounded-xl shadow-lg border border-zinc-700/50 hover:border-purple-500/30 p-6 transition-all duration-300 hover:scale-105 hover:shadow-purple-500/10">
            <div className="absolute inset-0 bg-gradient-to-br from-purple-500/0 to-violet-500/0 group-hover:from-purple-500/5 group-hover:to-violet-500/5 transition-all" />
            <div className="relative">
              <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-purple-500 to-violet-500 flex items-center justify-center shadow-lg shadow-purple-500/20 group-hover:scale-110 transition-transform mb-4">
                <Clock className="h-6 w-6 text-white" />
              </div>
              <h3 className="font-semibold text-zinc-100 text-lg mb-2">My Requests</h3>
              <p className="text-zinc-400 text-sm mb-4 leading-relaxed">
                Submit overtime claims, view status of reimbursement requests, and more.
              </p>
              <div className="flex items-center text-purple-400 font-medium text-sm group-hover:text-purple-300">
                <span>View Requests</span>
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
            <div className="relative overflow-hidden bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 rounded-xl shadow-lg border border-zinc-700/50 hover:border-blue-500/30 p-6 transition-all duration-300 hover:scale-105 hover:shadow-blue-500/10">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/0 to-indigo-500/0 group-hover:from-blue-500/5 group-hover:to-indigo-500/5 transition-all" />
              <div className="relative">
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/20 group-hover:scale-110 transition-transform mb-4">
                  <Users className="h-6 w-6 text-white" />
                </div>
                <h3 className="font-semibold text-zinc-100 text-lg mb-2">Team Compensation</h3>
                <p className="text-zinc-400 text-sm mb-4 leading-relaxed">
                  Request bonuses, view team salaries, and submit compensation requests.
                </p>
                <div className="flex items-center text-blue-400 font-medium text-sm group-hover:text-blue-300">
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
            <div className="relative overflow-hidden bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 rounded-xl shadow-lg border border-red-500/20 p-6 transition-all duration-300 hover:scale-105 hover:shadow-red-500/10">
              <div className="absolute inset-0 bg-gradient-to-br from-red-500/0 to-rose-500/0 group-hover:from-red-500/5 group-hover:to-rose-500/5 transition-all" />
              <div className="relative">
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-red-500 to-rose-500 flex items-center justify-center shadow-lg shadow-red-500/20 group-hover:scale-110 transition-transform mb-4">
                  <Calculator className="h-6 w-6 text-white" />
                </div>
                <h3 className="font-semibold text-zinc-100 text-lg mb-2">Payroll Admin</h3>
                <p className="text-zinc-400 text-sm mb-4 leading-relaxed">
                  Run monthly payroll, approve requests, and manage employee compensation.
                </p>
                <div className="flex items-center text-red-400 font-medium text-sm group-hover:text-red-300">
                  <span>Run Payroll</span>
                  <svg className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </div>
          </Link>
        )}

        {/* Analytics Card - HR Admin Only */}
        {isHRAdmin && (
          <Link href="/admin/analytics" className="group">
            <div className="relative overflow-hidden bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 rounded-xl shadow-lg border border-cyan-500/20 p-6 transition-all duration-300 hover:scale-105 hover:shadow-cyan-500/10">
              <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/0 to-teal-500/0 group-hover:from-cyan-500/5 group-hover:to-teal-500/5 transition-all" />
              <div className="relative">
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-cyan-500 to-teal-500 flex items-center justify-center shadow-lg shadow-cyan-500/20 group-hover:scale-110 transition-transform mb-4">
                  <TrendingUp className="h-6 w-6 text-white" />
                </div>
                <h3 className="font-semibold text-zinc-100 text-lg mb-2">Analytics</h3>
                <p className="text-zinc-400 text-sm mb-4 leading-relaxed">
                  View comprehensive payroll insights, department breakdowns, and workforce analytics.
                </p>
                <div className="flex items-center text-cyan-400 font-medium text-sm group-hover:text-cyan-300">
                  <span>View Analytics</span>
                  <svg className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </div>
          </Link>
        )}

        {/* Year to Date Stats Card */}
        <div className="relative overflow-hidden bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 rounded-xl shadow-lg border border-zinc-700/50 p-6">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-green-500/5" />
          <div className="relative">
            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-emerald-500 to-green-500 flex items-center justify-center shadow-lg shadow-emerald-500/20 mb-5">
              <TrendingUp className="h-6 w-6 text-white" />
            </div>
            <h3 className="font-semibold text-zinc-100 text-lg mb-4">Year to Date</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center py-2 border-b border-zinc-800/50">
                <span className="text-zinc-400 text-sm">Gross Earnings</span>
                <span className="font-semibold text-zinc-200">
                  ${dashboardStats?.ytd?.grossEarnings?.toLocaleString() || '0.00'}
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-zinc-800/50">
                <span className="text-zinc-400 text-sm">Total Tax</span>
                <span className="font-semibold text-zinc-200">
                  ${dashboardStats?.ytd?.totalTax?.toLocaleString() || '0.00'}
                </span>
              </div>
              <div className="flex justify-between items-center py-2 bg-emerald-500/10 -mx-2 px-2 rounded-lg border border-emerald-500/20">
                <span className="text-emerald-400 font-medium text-sm">Net Pay</span>
                <span className="font-bold text-lg text-emerald-300">
                  ${dashboardStats?.ytd?.netPay?.toLocaleString() || '0.00'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Info Cards */}
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
          <p className="text-xs text-zinc-500 mt-1">
            {dashboardStats?.nextPayday ? 'Scheduled' : 'No scheduled payroll'}
          </p>
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
            <span className="text-sm font-medium text-zinc-300">Profile Status</span>
          </div>
          <p className="text-2xl font-bold text-emerald-300">Active</p>
          <p className="text-xs text-zinc-500 mt-1">All systems operational</p>
        </div>
      </div>

      {/* Recent Activity Section */}
      <div className="bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 rounded-xl shadow-lg border border-zinc-700/50 p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-zinc-800/60 flex items-center justify-center">
            <svg className="w-5 h-5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-zinc-100">Recent Activity</h2>
        </div>

        <div className="rounded-xl border border-zinc-800/50 bg-zinc-900/40 overflow-hidden">
          <div className="p-12 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-zinc-800/60 flex items-center justify-center">
              <svg className="w-8 h-8 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-zinc-400 font-medium mb-1">No recent activity</h3>
            <p className="text-zinc-500 text-sm max-w-sm mx-auto">
              Your payslips and compensation updates will appear here once they're processed.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
