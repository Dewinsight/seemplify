'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import Layout from '@/components/Layout';
import LeaveBalanceCard, { BalanceSummary } from '@/components/LeaveBalanceCard';
import LeaveRequestCard from '@/components/LeaveRequestCard';
import { leaveBalancesApi, leaveRequestsApi } from '@/lib/api';
import { LeaveRequest, LeaveBalance } from '@/types';
import { Calendar, FileText, CheckSquare, TrendingUp, LayoutGrid } from 'lucide-react';
import Link from 'next/link';

export default function DashboardPage() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [balance, setBalance] = useState<LeaveBalance | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const [recentRequests, setRecentRequests] = useState<LeaveRequest[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    const fetchData = async () => {
      if (!isAuthenticated) return;

      try {
        setLoading(true);
        const [balanceRes, summaryRes, requestsRes] = await Promise.all([
          leaveBalancesApi.getMyBalance(),
          leaveBalancesApi.getSummary(),
          leaveRequestsApi.getAll({ limit: 5 }),
        ]);

        setBalance(balanceRes.balance);
        setSummary(summaryRes.summary);
        setRecentRequests(requestsRes.requests);

        // Try to fetch pending approvals (may fail if user doesn't have permission)
        try {
          const approvalsRes = await leaveRequestsApi.getApprovals({ limit: 5 });
          setPendingApprovals(approvalsRes.requests);
        } catch {
          // User doesn't have approval permissions
          setPendingApprovals([]);
        }
      } catch (err: any) {
        setError(err.response?.data?.error || 'Failed to load dashboard data');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [isAuthenticated]);

  if (authLoading || loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-600"></div>
        </div>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout>
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-8">
        {/* Welcome header */}
        <div className="relative">
          <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-pink-500/10 rounded-2xl blur-3xl"></div>
          <div className="relative bg-white/80 backdrop-blur-sm rounded-2xl border border-slate-200/50 p-6 shadow-lg">
            <div className="flex justify-between items-start">
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-900 via-slate-800 to-slate-700 bg-clip-text text-transparent">
                  Welcome back, {user?.name?.split(' ')[0] || 'User'} 👋
                </h1>
                <p className="text-slate-600 mt-2">
                  Here's an overview of your leave balance and recent activity.
                </p>
              </div>
              <a
                href={process.env.NEXT_PUBLIC_IDP_URL || 'http://localhost:4000'}
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-slate-900 to-slate-700 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-slate-900/10 transition-all hover:from-slate-800 hover:to-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-400/40"
              >
                <LayoutGrid className="h-4 w-4" />
                App Hub
              </a>
            </div>
          </div>
        </div>

        {/* Balance summary */}
        {summary && <BalanceSummary summary={summary} />}

        {/* Quick actions */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Link
            href="/leave-requests/new"
            className="group flex flex-col items-center p-6 bg-white rounded-2xl shadow-md border border-slate-200/50 hover:shadow-xl hover:scale-105 transition-all duration-200 relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <div className="relative h-14 w-14 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center mb-3 shadow-lg group-hover:scale-110 transition-transform">
              <FileText className="h-7 w-7 text-white" />
            </div>
            <span className="relative text-sm font-semibold text-slate-900">Request Leave</span>
          </Link>

          <Link
            href="/leave-requests"
            className="group flex flex-col items-center p-6 bg-white rounded-2xl shadow-md border border-slate-200/50 hover:shadow-xl hover:scale-105 transition-all duration-200 relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-blue-500/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <div className="relative h-14 w-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center mb-3 shadow-lg group-hover:scale-110 transition-transform">
              <TrendingUp className="h-7 w-7 text-white" />
            </div>
            <span className="relative text-sm font-semibold text-slate-900">My Requests</span>
          </Link>

          <Link
            href="/approvals"
            className="group flex flex-col items-center p-6 bg-white rounded-2xl shadow-md border border-slate-200/50 hover:shadow-xl hover:scale-105 transition-all duration-200 relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-green-500/5 to-emerald-500/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <div className="relative h-14 w-14 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center mb-3 shadow-lg group-hover:scale-110 transition-transform">
              <CheckSquare className="h-7 w-7 text-white" />
            </div>
            <span className="relative text-sm font-semibold text-slate-900">Approvals</span>
            {pendingApprovals.length > 0 && (
              <span className="relative text-xs font-medium text-green-600 mt-1 bg-green-50 px-2 py-0.5 rounded-full">
                {pendingApprovals.length} pending
              </span>
            )}
          </Link>

          <Link
            href="/calendar"
            className="group flex flex-col items-center p-6 bg-white rounded-2xl shadow-md border border-slate-200/50 hover:shadow-xl hover:scale-105 transition-all duration-200 relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-pink-500/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <div className="relative h-14 w-14 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center mb-3 shadow-lg group-hover:scale-110 transition-transform">
              <Calendar className="h-7 w-7 text-white" />
            </div>
            <span className="relative text-sm font-semibold text-slate-900">Calendar</span>
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Leave balance */}
          {balance && <LeaveBalanceCard balance={balance} />}

          {/* Recent requests */}
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Recent Requests</h3>
              <Link
                href="/leave-requests"
                className="text-sm text-primary-600 hover:text-primary-700"
              >
                View All
              </Link>
            </div>
            {recentRequests.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No leave requests yet</p>
            ) : (
              <div className="space-y-3">
                {recentRequests.map((request) => (
                  <LeaveRequestCard key={request._id} request={request} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Pending approvals (if user is an approver) */}
        {pendingApprovals.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Pending Approvals</h3>
              <Link
                href="/approvals"
                className="text-sm text-primary-600 hover:text-primary-700"
              >
                View All
              </Link>
            </div>
            <div className="space-y-3">
              {pendingApprovals.map((request) => (
                <LeaveRequestCard
                  key={request._id}
                  request={request}
                  showUser
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
