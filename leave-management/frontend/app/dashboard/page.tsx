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
      <div className="space-y-7">
        {/* Welcome header */}
        <div className="border-b border-border pb-6">
          <div>
            <div className="flex justify-between items-start flex-wrap gap-4">
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-purple-600 dark:text-purple-400">Leave overview</div>
                <h1 className="text-3xl font-semibold tracking-tight text-foreground">
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
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-purple-500/40"
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
        <div className="grid grid-cols-2 gap-4 md:grid-cols-[1.15fr_0.9fr_1fr_0.95fr]">
          <Link
            href="/leave-requests/new"
            className="group flex flex-col items-center rounded-xl border border-border bg-card p-6 transition-colors hover:border-indigo-500/50"
          >
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-lg border border-indigo-500/25 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
              <FileText className="h-6 w-6" />
            </div>
            <span className="relative text-sm font-semibold text-foreground dark:text-zinc-100">Request Leave</span>
          </Link>

          <Link
            href="/leave-requests"
            className="group flex flex-col items-center rounded-xl border border-border bg-card p-6 transition-colors hover:border-purple-500/50"
          >
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-lg border border-purple-500/25 bg-purple-500/10 text-purple-600 dark:text-purple-300">
              <TrendingUp className="h-6 w-6" />
            </div>
            <span className="relative text-sm font-semibold text-foreground dark:text-zinc-100">My Requests</span>
          </Link>

          <Link
            href="/approvals"
            className="group flex flex-col items-center rounded-xl border border-border bg-card p-6 transition-colors hover:border-emerald-500/50"
          >
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-lg border border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
              <CheckSquare className="h-6 w-6" />
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
            className="group flex flex-col items-center rounded-xl border border-border bg-card p-6 transition-colors hover:border-pink-500/50"
          >
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-lg border border-pink-500/25 bg-pink-500/10 text-pink-600 dark:text-pink-300">
              <Calendar className="h-6 w-6" />
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
