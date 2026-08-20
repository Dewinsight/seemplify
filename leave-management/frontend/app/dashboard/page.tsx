'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Calendar, CheckSquare, FileText, LayoutGrid, TrendingUp } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import Layout from '@/components/Layout';
import LeaveBalanceCard, { BalanceSummary } from '@/components/LeaveBalanceCard';
import LeaveRequestCard from '@/components/LeaveRequestCard';
import { leaveBalancesApi, leaveRequestsApi } from '@/lib/api';
import { LeaveBalance, LeaveEntitlementAdjustment, LeaveRequest } from '@/types';
import { formatDate, getEntitlementAdjustmentLabel } from '@/lib/utils';
import { exitLeaveToHub } from '@/lib/productExit';

export default function DashboardPage() {
  const router = useRouter();
  const { user, currentOrganization, isAuthenticated, isLoading: authLoading } = useAuth();
  const [balance, setBalance] = useState<LeaveBalance | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const [recentRequests, setRecentRequests] = useState<LeaveRequest[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<LeaveRequest[]>([]);
  const [entitlementHistory, setEntitlementHistory] = useState<LeaveEntitlementAdjustment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/login');
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const fetchData = async () => {
      try {
        setLoading(true);
        const [balanceRes, summaryRes, requestsRes, historyRes] = await Promise.all([
          leaveBalancesApi.getMyBalance(),
          leaveBalancesApi.getSummary(),
          leaveRequestsApi.getAll({ limit: 5 }),
          leaveBalancesApi.getMyHistory(),
        ]);
        setBalance(balanceRes.balance);
        setSummary(summaryRes.summary);
        setRecentRequests(requestsRes.requests);
        setEntitlementHistory((historyRes.adjustments || []).slice(0, 5));
        try {
          const approvalsRes = await leaveRequestsApi.getApprovals({ limit: 5 });
          setPendingApprovals(approvalsRes.requests);
        } catch {
          setPendingApprovals([]);
        }
      } catch (requestError: any) {
        setError(requestError.response?.data?.error || 'Failed to load dashboard data');
        setErrorCode(requestError.response?.data?.code || null);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [isAuthenticated]);

  if (authLoading || loading) {
    return <Layout><div className="flex h-64 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--suite-line)] border-t-[var(--suite-accent)]" /></div></Layout>;
  }

  if (error) {
    const isOrgError = errorCode === 'ORG_REQUIRED' || errorCode === 'NO_ORGANIZATIONS';
    return (
      <Layout>
        <div className="suite-notice">
          <p className="text-sm" style={{ color: 'var(--suite-danger)' }}>{error}</p>
          {isOrgError && <a href={process.env.NEXT_PUBLIC_IDP_URL || 'http://localhost:4000'} onClick={(event) => { event.preventDefault(); void exitLeaveToHub(process.env.NEXT_PUBLIC_IDP_URL || 'http://localhost:4000'); }} className="suite-button"><LayoutGrid className="h-4 w-4" /> Go to App Hub</a>}
        </div>
      </Layout>
    );
  }

  const firstName = user?.name?.split(' ')[0] || 'there';
  const organizationName = currentOrganization?.name || user?.currentOrganization?.name || 'your organization';
  const actions = [
    { title: 'Request leave', copy: 'Submit time away with dates, reason, and the right approval route.', href: '/leave-requests/new', icon: FileText, meta: 'New request' },
    { title: 'My requests', copy: 'Review submitted leave, approval progress, and previous decisions.', href: '/leave-requests', icon: TrendingUp, meta: `${recentRequests.length} recent` },
    { title: 'Approvals', copy: 'Review requests assigned through your team or management role.', href: '/approvals', icon: CheckSquare, meta: `${pendingApprovals.length} pending` },
    { title: 'My calendar', copy: 'See your approved and pending leave requests by date.', href: '/calendar', icon: Calendar, meta: 'Open calendar' },
  ];

  return (
    <Layout>
      <div className="suite-dashboard">
        <header className="suite-dashboard-header">
          <div>
            <p className="suite-kicker">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
            <h1 className="suite-dashboard-title">Time off, without the uncertainty.</h1>
            <p className="suite-dashboard-copy">
              Welcome back, {firstName}. Check your balance, request leave, and follow every approval for {organizationName}.
            </p>
          </div>
          <div className="suite-context">
            <div className="suite-context-row">
              <div className="flex min-w-0 items-center gap-3">
                <div className="suite-context-mark">{organizationName.slice(0, 2).toUpperCase()}</div>
                <div className="min-w-0"><p className="suite-label">Working in</p><p className="truncate text-base font-semibold">{organizationName}</p></div>
              </div>
              <a href={process.env.NEXT_PUBLIC_IDP_URL || 'http://localhost:4000'} onClick={(event) => { event.preventDefault(); void exitLeaveToHub(process.env.NEXT_PUBLIC_IDP_URL || 'http://localhost:4000'); }} className="suite-button-secondary"><LayoutGrid className="h-4 w-4" /> App Hub</a>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4 border-t pt-3" style={{ borderColor: 'var(--suite-line)' }}>
              <div><p className="suite-label">Available</p><p className="text-sm font-semibold">{summary?.totalAvailable || 0} days</p></div>
              <div><p className="suite-label">Awaiting review</p><p className="text-sm font-semibold">{pendingApprovals.length}</p></div>
            </div>
          </div>
        </header>

        {summary && <section className="suite-section"><BalanceSummary summary={summary} /></section>}

        <section className="suite-section">
          <div className="suite-section-heading">
            <div><h2 className="suite-section-title">Leave workspace</h2><p className="suite-section-copy">The tasks you use most, with the current state visible before you open them.</p></div>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {actions.map(({ title, copy, href, icon: Icon, meta }) => (
              <Link key={title} href={href} className="suite-card">
                <div className="suite-card-top"><div className="suite-icon"><Icon className="h-5 w-5" /></div><ArrowRight className="h-4 w-4" style={{ color: 'var(--suite-subtle)' }} /></div>
                <h3 className="suite-card-title mt-4">{title}</h3><p className="suite-card-copy">{copy}</p>
                <div className="suite-card-footer"><div><p className="suite-label">Status</p><p className="mt-1 text-sm font-semibold">{meta}</p></div><span className="suite-button">Open <ArrowRight className="h-4 w-4" /></span></div>
              </Link>
            ))}
          </div>
        </section>

        {entitlementHistory.length > 0 && (
          <section className="suite-section">
            <div className="suite-section-heading"><div><h2 className="suite-section-title">Your entitlement changes</h2><p className="suite-section-copy">Every administrator adjustment is shown here with its reason.</p></div></div>
            <div className="suite-panel divide-y" style={{ borderColor: 'var(--suite-line)' }}>
              {entitlementHistory.map((entry) => (
                <div key={entry._id || `${entry.leaveTypeKey}-${entry.createdAt}`} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                  <div><p className="text-sm font-semibold">{entry.leaveTypeName}: {getEntitlementAdjustmentLabel(entry)} · {entry.previousTotal} → {entry.newTotal} days</p><p className="mt-1 text-sm" style={{ color: 'var(--suite-muted)' }}>{entry.reason}</p><p className="mt-1 text-xs" style={{ color: 'var(--suite-subtle)' }}>Changed by {entry.actorName || entry.actorEmail || 'Administrator'}</p></div>
                  <time className="text-xs" style={{ color: 'var(--suite-muted)' }}>{formatDate(entry.createdAt, 'MMM d, yyyy')}</time>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="suite-section suite-split">
          <div>
            <div className="suite-section-heading">
              <div><h2 className="suite-section-title">Recent requests</h2><p className="suite-section-copy">Your latest submissions and their approval state.</p></div>
              <Link href="/leave-requests" className="suite-button-secondary">View all <ArrowRight className="h-4 w-4" /></Link>
            </div>
            <div className="suite-panel overflow-hidden">
              {recentRequests.length === 0 ? <p className="px-5 py-12 text-center text-sm" style={{ color: 'var(--suite-muted)' }}>No leave requests yet.</p> : recentRequests.map((request) => <LeaveRequestCard key={request._id} request={request} compact />)}
            </div>
          </div>
          <div>
            <div className="suite-section-heading"><div><h2 className="suite-section-title">Balance by type</h2><p className="suite-section-copy">Available days after pending requests.</p></div></div>
            {balance && <LeaveBalanceCard balance={balance} />}
          </div>
        </section>

        {pendingApprovals.length > 0 && (
          <section className="suite-section">
            <div className="suite-section-heading"><div><h2 className="suite-section-title">Waiting for your decision</h2><p className="suite-section-copy">Requests routed to you as a manager or approver.</p></div><Link href="/approvals" className="suite-button-secondary">Open approvals <ArrowRight className="h-4 w-4" /></Link></div>
            <div className="suite-panel overflow-hidden">{pendingApprovals.map((request) => <LeaveRequestCard key={request._id} request={request} showUser compact />)}</div>
          </section>
        )}
      </div>
    </Layout>
  );
}
