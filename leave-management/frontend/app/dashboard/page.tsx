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
  const [errorCode, setErrorCode] = useState<string | null>(null);

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
        setErrorCode(err.response?.data?.code || null);
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
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500"></div>
        </div>
      </Layout>
    );
  }

  if (error) {
    const isOrgError = errorCode === 'ORG_REQUIRED' || errorCode === 'NO_ORGANIZATIONS';
    return (
      <Layout>
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg">
          <p>{error}</p>
          {isOrgError && (
            <a
              href={process.env.NEXT_PUBLIC_IDP_URL || 'http://localhost:4000'}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-purple-500/20 transition-all hover:shadow-purple-500/30 hover:scale-105"
            >
              <LayoutGrid className="h-4 w-4" />
              Go to App Hub
            </a>
          )}
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-8">
        {/* Welcome header */}
        <div className="relative">
          <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/20 via-purple-500/20 to-pink-500/20 rounded-2xl blur-3xl"></div>
          <div className="relative bg-card dark:bg-zinc-900/80 backdrop-blur-xl rounded-2xl border border-border dark:border-zinc-700/50 p-8 shadow-2xl shadow-purple-500/10">
            <div className="flex justify-between items-start flex-wrap gap-4">
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-foreground via-foreground/80 to-muted-foreground dark:from-white dark:via-zinc-100 dark:to-zinc-200 bg-clip-text text-transparent">
                  Welcome back, {user?.name?.split(' ')[0] || 'User'} 👋
                </h1>
                <p className="text-muted-foreground mt-2">
                  Here's an overview of your leave balance and recent activity.
                </p>
              </div>
              <a
                href={process.env.NEXT_PUBLIC_IDP_URL || 'http://localhost:4000'}
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-purple-500/20 transition-all hover:shadow-purple-500/30 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
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
            className="group flex flex-col items-center p-6 bg-card dark:bg-zinc-900/90 rounded-xl shadow-lg border border-border dark:border-zinc-700/50 hover:border-indigo-500/50 hover:shadow-indigo-500/10 hover:scale-105 transition-all duration-200 relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/0 to-purple-500/0 group-hover:from-indigo-500/10 group-hover:to-purple-500/10 transition-all"></div>
            <div className="relative h-14 w-14 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center mb-3 shadow-lg shadow-indigo-500/20 group-hover:scale-110 transition-transform">
              <FileText className="h-7 w-7 text-white" />
            </div>
            <span className="relative text-sm font-semibold text-foreground dark:text-zinc-100">Request Leave</span>
          </Link>

          <Link
            href="/leave-requests"
            className="group flex flex-col items-center p-6 bg-card dark:bg-zinc-900/90 rounded-xl shadow-lg border border-border dark:border-zinc-700/50 hover:border-purple-500/50 hover:shadow-purple-500/10 hover:scale-105 transition-all duration-200 relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-purple-500/0 to-pink-500/0 group-hover:from-purple-500/10 group-hover:to-pink-500/10 transition-all"></div>
            <div className="relative h-14 w-14 rounded-xl bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center mb-3 shadow-lg shadow-purple-500/20 group-hover:scale-110 transition-transform">
              <TrendingUp className="h-7 w-7 text-white" />
            </div>
            <span className="relative text-sm font-semibold text-foreground dark:text-zinc-100">My Requests</span>
          </Link>

          <Link
            href="/approvals"
            className="group flex flex-col items-center p-6 bg-card dark:bg-zinc-900/90 rounded-xl shadow-lg border border-border dark:border-zinc-700/50 hover:border-green-500/50 hover:shadow-green-500/10 hover:scale-105 transition-all duration-200 relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-green-500/0 to-emerald-500/0 group-hover:from-green-500/10 group-hover:to-emerald-500/10 transition-all"></div>
            <div className="relative h-14 w-14 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center mb-3 shadow-lg shadow-green-500/20 group-hover:scale-110 transition-transform">
              <CheckSquare className="h-7 w-7 text-white" />
            </div>
            <span className="relative text-sm font-semibold text-foreground dark:text-zinc-100">Approvals</span>
            {pendingApprovals.length > 0 && (
              <span className="relative text-xs font-medium text-green-400 mt-1 bg-green-500/20 px-2 py-0.5 rounded-full border border-green-500/30">
                {pendingApprovals.length} pending
              </span>
            )}
          </Link>

          <Link
            href="/calendar"
            className="group flex flex-col items-center p-6 bg-card dark:bg-zinc-900/90 rounded-xl shadow-lg border border-border dark:border-zinc-700/50 hover:border-pink-500/50 hover:shadow-pink-500/10 hover:scale-105 transition-all duration-200 relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-pink-500/0 to-purple-500/0 group-hover:from-pink-500/10 group-hover:to-purple-500/10 transition-all"></div>
            <div className="relative h-14 w-14 rounded-xl bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center mb-3 shadow-lg shadow-pink-500/20 group-hover:scale-110 transition-transform">
              <Calendar className="h-7 w-7 text-white" />
            </div>
            <span className="relative text-sm font-semibold text-foreground dark:text-zinc-100">Calendar</span>
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Leave balance */}
          {balance && <LeaveBalanceCard balance={balance} />}

          {/* Recent requests */}
          <div className="bg-card dark:bg-zinc-900/90 rounded-xl shadow-sm border border-border dark:border-zinc-700/50 p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-foreground dark:text-gray-100">Recent Requests</h3>
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
          <div className="bg-card dark:bg-zinc-900/90 rounded-xl shadow-lg border border-border dark:border-zinc-700/50 p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-foreground dark:text-zinc-100">Pending Approvals</h3>
              <Link
                href="/approvals"
                className="text-sm text-green-400 hover:text-green-300 transition-colors"
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
