'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  AlertCircle, ArrowRight, Calculator, Calendar, ClipboardCheck, FileText,
  History, LayoutGrid, TrendingUp, Users
} from 'lucide-react';
import api, { authApi, handleAuthCallback, isAuthenticated } from '@/lib/api';
import { formatPayrollMoney } from '@/lib/payrollMoney';
import { usePayrollViewMode } from '@/context/PayrollViewModeContext';

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
    if (!isAuthenticated()) { router.push('/login'); return; }
    const fetchUser = async () => {
      try {
        const response = await authApi.getMe();
        setUser(response.user);
        let org: any = null;
        if (Array.isArray(response.user?.organizations) && response.user.organizations.length > 0) {
          org = response.currentOrganizationId
            ? response.user.organizations.find((item: any) => item.id === response.currentOrganizationId) || response.user.organizations[0]
            : response.user.organizations[0];
          setCurrentOrg(org);
        }
        try { setDashboardStats((await api.get('/payroll/dashboard-stats')).data); } catch (error) { console.log('Could not fetch dashboard stats:', error); }
        if (org && ['owner', 'admin', 'hr_manager'].includes(org.role)) {
          try { setAdminOverview((await api.get('/payroll/admin/overview')).data); } catch (error) { console.log('Could not fetch admin overview:', error); }
        }
      } catch (error: any) {
        console.error('Failed to fetch user:', error);
        if (error.response?.status === 401) router.push('/login');
      } finally {
        setLoading(false);
      }
    };
    fetchUser();
  }, [router]);

  const isHRAdmin = currentOrg && ['owner', 'admin', 'hr_manager'].includes(currentOrg.role);
  const hasAdminMode = Boolean(isHRAdmin && contextHRAdmin);
  const isAdminWorkspace = hasAdminMode && viewMode === 'admin';
  const currency = dashboardStats?.currency || 'USD';
  const profileOk = Boolean(dashboardStats?.hasProfile);
  const profileStatus = dashboardStats?.profileStatus || 'pending_setup';
  const latestRun = adminOverview?.latestRun;
  const latestRunStatus = String(latestRun?.status || '');
  const firstName = useMemo(() => user?.name?.split(' ')?.[0] || 'there', [user]);
  const formatMoney = (amount: any) => formatPayrollMoney(amount || 0, currency);

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--suite-line)] border-t-[var(--suite-accent)]" /></div>;
  }

  const adminActions = [
    { title: 'Employees', copy: 'Configure salary, tax, allowances, deductions, contracts, and payment details.', href: '/admin/employees', icon: Users, meta: `${adminOverview?.activeEmployees || 0} active` },
    { title: 'Approvals', copy: 'Resolve overtime, bonus, reimbursement, and compensation changes before a run.', href: '/admin/approvals', icon: ClipboardCheck, meta: `${adminOverview?.pendingCompensationRequests || 0} pending` },
    { title: 'Run payroll', copy: 'Calculate the period, inspect exceptions, and prepare draft payslips for review.', href: '/admin/run', icon: Calculator, meta: latestRunStatus ? `Latest: ${latestRunStatus.replace(/_/g, ' ')}` : 'Ready to start' },
    { title: 'Run history', copy: 'Review prior runs, generated payslips, reports, and accountant-ready exports.', href: '/admin/runs', icon: History, meta: latestRun?.runNumber || 'No run yet' },
  ];

  const workflow = [
    { step: '01', title: 'Configure employees', detail: Number(adminOverview?.profilesNeedingSetup || 0) > 0 ? `${adminOverview.profilesNeedingSetup} profiles need setup` : 'Employee profiles are configured', href: '/admin/employees?setup=pending' },
    { step: '02', title: 'Approve changes', detail: Number(adminOverview?.pendingCompensationRequests || 0) > 0 ? `${adminOverview.pendingCompensationRequests} requests pending` : 'No compensation requests pending', href: '/admin/approvals' },
    { step: '03', title: 'Calculate payroll', detail: latestRun?._id ? `Latest run is ${latestRunStatus.replace(/_/g, ' ')}` : 'No run has been started', href: latestRun?._id ? `/admin/runs/${latestRun._id}` : '/admin/run' },
    { step: '04', title: 'Finalize and export', detail: latestRunStatus === 'exported' ? 'Latest run exported' : latestRunStatus === 'approved' ? 'Approved and ready to finalize' : 'Available after approval', href: latestRun?._id ? `/admin/runs/${latestRun._id}` : '/admin/runs' },
  ];

  return (
    <div className="suite-dashboard">
      <header className="suite-dashboard-header">
        <div>
          <p className="suite-kicker">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1 className="suite-dashboard-title">Payroll, ready before payday.</h1>
          <p className="suite-dashboard-copy">
            Welcome back, {firstName}. {isAdminWorkspace ? 'Prepare, review, and export payroll' : 'Review your pay and compensation'} for {currentOrg?.name || 'your organization'}.
          </p>
        </div>
        <div className="suite-context">
          <div className="suite-context-row">
            <div className="flex min-w-0 items-center gap-3">
              <div className="suite-context-mark">{String(currentOrg?.name || 'PY').slice(0, 2).toUpperCase()}</div>
              <div className="min-w-0"><p className="suite-label">Payroll workspace</p><p className="truncate text-base font-semibold">{currentOrg?.name || 'Your organization'}</p></div>
            </div>
            <a href={process.env.NEXT_PUBLIC_IDP_URL || 'http://localhost:4000'} className="suite-button-secondary"><LayoutGrid className="h-4 w-4" /> App Hub</a>
          </div>
          <div className="mt-4 flex items-center justify-between border-t pt-3" style={{ borderColor: 'var(--suite-line)' }}>
            <div><p className="suite-label">Viewing</p><p className="text-sm font-semibold">{isAdminWorkspace ? 'Admin payroll' : 'My payroll'}</p></div>
            <span className="suite-status">{currency}</span>
          </div>
        </div>
      </header>

      {isAdminWorkspace ? (
        <>
          <section className="suite-section">
            <div className="suite-metrics">
              <div className="suite-metric"><p className="suite-label">Active employees</p><p className="suite-metric-value">{adminOverview?.activeEmployees || 0}</p><p className="mt-1 text-xs" style={{ color: 'var(--suite-muted)' }}>Synced from IDP</p></div>
              <div className="suite-metric"><p className="suite-label">Profiles to configure</p><p className="suite-metric-value">{adminOverview?.profilesNeedingSetup || 0}</p><p className="mt-1 text-xs" style={{ color: Number(adminOverview?.profilesNeedingSetup || 0) ? 'var(--suite-warning)' : 'var(--suite-positive)' }}>Before the next run</p></div>
              <div className="suite-metric"><p className="suite-label">Pending requests</p><p className="suite-metric-value">{adminOverview?.pendingCompensationRequests || 0}</p><p className="mt-1 text-xs" style={{ color: 'var(--suite-muted)' }}>Require approval</p></div>
              <div className="suite-metric"><p className="suite-label">Runs needing action</p><p className="suite-metric-value">{adminOverview?.pendingRuns || 0}</p><p className="mt-1 text-xs" style={{ color: 'var(--suite-muted)' }}>Draft or in review</p></div>
            </div>
          </section>

          <section className="suite-section">
            <div className="suite-section-heading"><div><h2 className="suite-section-title">Payroll operations</h2><p className="suite-section-copy">Each area shows what needs attention before you open it.</p></div></div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {adminActions.map(({ title, copy, href, icon: Icon, meta }) => (
                <Link key={title} href={href} className="suite-card">
                  <div className="suite-card-top"><div className="suite-icon"><Icon className="h-5 w-5" /></div><ArrowRight className="h-4 w-4" style={{ color: 'var(--suite-subtle)' }} /></div>
                  <h3 className="suite-card-title mt-4">{title}</h3><p className="suite-card-copy">{copy}</p>
                  <div className="suite-card-footer"><div className="min-w-0"><p className="suite-label">Current state</p><p className="mt-1 truncate text-sm font-semibold">{meta}</p></div><span className="suite-button">Open <ArrowRight className="h-4 w-4" /></span></div>
                </Link>
              ))}
            </div>
          </section>

          <section className="suite-section suite-split">
            <div>
              <div className="suite-section-heading"><div><h2 className="suite-section-title">Run checklist</h2><p className="suite-section-copy">A single pass from employee setup to final export.</p></div></div>
              <div className="suite-panel overflow-hidden">
                {workflow.map((item) => (
                  <Link href={item.href} key={item.step} className="suite-list-row hover:bg-[var(--suite-surface-muted)]">
                    <div className="flex min-w-0 items-center gap-4"><span className="font-mono text-sm" style={{ color: 'var(--suite-accent)' }}>{item.step}</span><div className="min-w-0"><p className="text-sm font-semibold">{item.title}</p><p className="mt-1 truncate text-xs" style={{ color: 'var(--suite-muted)' }}>{item.detail}</p></div></div><ArrowRight className="h-4 w-4 shrink-0" style={{ color: 'var(--suite-subtle)' }} />
                  </Link>
                ))}
              </div>
            </div>
            <div>
              <div className="suite-section-heading"><div><h2 className="suite-section-title">Latest run</h2><p className="suite-section-copy">The most recent payroll state.</p></div></div>
              <div className="suite-panel p-5">
                <div className="flex items-start justify-between"><div className="suite-icon"><Calculator className="h-5 w-5" /></div><span className="suite-status">{latestRunStatus.replace(/_/g, ' ') || 'Not started'}</span></div>
                <p className="mt-6 text-xl font-semibold">{latestRun?.runNumber || 'No payroll run yet'}</p>
                <p className="mt-2 text-sm leading-6" style={{ color: 'var(--suite-muted)' }}>Open the run workspace to inspect calculation results, resolve exceptions, and export when approved.</p>
                <Link href={latestRun?._id ? `/admin/runs/${latestRun._id}` : '/admin/run'} className="suite-button mt-6 w-full">{latestRun?._id ? 'Review run' : 'Start payroll'} <ArrowRight className="h-4 w-4" /></Link>
              </div>
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="suite-section">
            <div className="suite-metrics">
              <div className="suite-metric"><p className="suite-label">Gross earnings</p><p className="suite-metric-value">{formatMoney(dashboardStats?.ytd?.grossEarnings)}</p><p className="mt-1 text-xs" style={{ color: 'var(--suite-muted)' }}>Year to date</p></div>
              <div className="suite-metric"><p className="suite-label">Tax</p><p className="suite-metric-value">{formatMoney(dashboardStats?.ytd?.totalTax)}</p><p className="mt-1 text-xs" style={{ color: 'var(--suite-muted)' }}>Year to date</p></div>
              <div className="suite-metric"><p className="suite-label">Net pay</p><p className="suite-metric-value">{formatMoney(dashboardStats?.ytd?.netPay)}</p><p className="mt-1 text-xs" style={{ color: 'var(--suite-positive)' }}>After deductions</p></div>
              <div className="suite-metric"><p className="suite-label">Next payday</p><p className="suite-metric-value">{dashboardStats?.nextPayday ? new Date(dashboardStats.nextPayday).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '--'}</p><p className="mt-1 text-xs" style={{ color: 'var(--suite-muted)' }}>{dashboardStats?.nextPayday ? 'Scheduled' : 'Not scheduled'}</p></div>
            </div>
          </section>

          <section className="suite-section">
            <div className="suite-section-heading"><div><h2 className="suite-section-title">Your payroll</h2><p className="suite-section-copy">Documents, requests, and profile status in one place.</p></div></div>
            <div className="grid gap-4 md:grid-cols-3">
              <Link href="/payslips" className="suite-card">
                <div className="suite-card-top"><div className="suite-icon"><FileText className="h-5 w-5" /></div><ArrowRight className="h-4 w-4" style={{ color: 'var(--suite-subtle)' }} /></div><h3 className="suite-card-title mt-4">Payslips</h3><p className="suite-card-copy">Review payroll statements and download documents from completed periods.</p><div className="suite-card-footer"><div><p className="suite-label">This year</p><p className="suite-value">{dashboardStats?.totalPayslips || 0}</p></div><span className="suite-button">View <ArrowRight className="h-4 w-4" /></span></div>
              </Link>
              <Link href="/requests" className="suite-card">
                <div className="suite-card-top"><div className="suite-icon"><TrendingUp className="h-5 w-5" /></div><ArrowRight className="h-4 w-4" style={{ color: 'var(--suite-subtle)' }} /></div><h3 className="suite-card-title mt-4">Compensation requests</h3><p className="suite-card-copy">Submit and track overtime, reimbursements, bonuses, or payroll corrections.</p><div className="suite-card-footer"><div><p className="suite-label">Access</p><p className="mt-1 text-sm font-semibold">Submit or review</p></div><span className="suite-button">Open <ArrowRight className="h-4 w-4" /></span></div>
              </Link>
              <div className="suite-card">
                <div className="suite-card-top"><div className="suite-icon"><Calendar className="h-5 w-5" /></div><span className="suite-status">{profileOk ? 'Ready' : 'Action needed'}</span></div><h3 className="suite-card-title mt-4">Payroll profile</h3><p className="suite-card-copy">Your tax, compensation, contract, and payment setup used in every run.</p><div className="suite-card-footer"><div><p className="suite-label">Status</p><p className="mt-1 text-sm font-semibold">{profileOk ? 'Configured' : String(profileStatus).replace(/_/g, ' ')}</p></div>{!profileOk && isHRAdmin && <Link href="/admin/employees?setup=pending" className="suite-button">Set up <ArrowRight className="h-4 w-4" /></Link>}</div>
              </div>
            </div>
          </section>

          {hasAdminMode && (
            <section className="suite-section"><div className="suite-notice"><div className="flex items-start gap-3"><AlertCircle className="mt-0.5 h-5 w-5" style={{ color: 'var(--suite-accent)' }} /><div><p className="text-sm font-semibold">Admin payroll is available</p><p className="mt-1 text-sm" style={{ color: 'var(--suite-muted)' }}>Use the view switcher in the navigation to manage employees and run payroll.</p></div></div><span className="suite-status">HR access</span></div></section>
          )}
        </>
      )}
    </div>
  );
}
