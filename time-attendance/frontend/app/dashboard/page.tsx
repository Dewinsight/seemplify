'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, ArrowRight, Calendar, CheckCircle2, Clock, LayoutGrid, Users } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { getIdpUrl } from '@/lib/env';
import { approvalsApi, attendanceApi, exceptionsApi } from '@/lib/api';
import ClockWidget from '@/components/ClockWidget';

export default function Dashboard() {
    const { user, isAuthenticated, isLoading: authLoading, workspaceMode, canAccessManagement } = useAuth();
    const router = useRouter();
    const [dashboardData, setDashboardData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [managementData, setManagementData] = useState<{ approvals: any[]; corrections: any[]; team: any }>({ approvals: [], corrections: [], team: null });

    const fetchDashboardData = useCallback(async () => {
        try {
            setDashboardData(await attendanceApi.getDashboard());
            if (workspaceMode === 'management' && canAccessManagement) {
                const [approvals, corrections, team] = await Promise.all([
                    approvalsApi.getPending().catch(() => []),
                    exceptionsApi.list({ status: 'correction_requested' }).then(data => data.exceptions || []).catch(() => []),
                    attendanceApi.getTeamStatus().catch(() => null),
                ]);
                setManagementData({ approvals, corrections, team });
            }
        } catch (error) {
            console.error('Failed to fetch dashboard data:', error);
        } finally {
            setLoading(false);
        }
    }, [workspaceMode, canAccessManagement]);

    useEffect(() => {
        if (!authLoading) {
            if (!isAuthenticated) router.push('/login');
            else fetchDashboardData();
        }
    }, [isAuthenticated, authLoading, router, fetchDashboardData]);

    if (authLoading || loading) {
        return (
            <div className="flex min-h-[60vh] items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--suite-line)] border-t-[var(--suite-accent)]" />
            </div>
        );
    }

    const firstName = user?.name?.split(' ')[0] || 'there';
    const organization = user?.currentOrganization?.name || 'your organization';
    const totalHours = Number(dashboardData?.week?.totalHours || 0);
    const progress = Math.min(100, Math.round((totalHours / 40) * 100));
    const clockedIn = Boolean(dashboardData?.clock?.isClockedIn);
    const onLeave = Boolean(dashboardData?.leave);
    const currentStatusLabel = onLeave && !clockedIn ? 'On leave' : clockedIn ? 'Clocked in' : 'Not clocked in';
    const formatLeaveDate = (value?: string) => {
        if (!value) return '';
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    };

    if (workspaceMode === 'management' && canAccessManagement) {
        const teamMembers = managementData.team?.members || managementData.team?.team || [];
        const workingNow = teamMembers.filter((member: any) => member.status === 'working' || member.isClockedIn).length;
        return <div className="space-y-6">
            <header className="flex flex-col gap-4 border-b border-[var(--suite-line)] pb-5 sm:flex-row sm:items-end sm:justify-between">
                <div><h1 className="text-2xl font-semibold text-[var(--suite-ink)]">Management dashboard</h1><p className="mt-1 text-sm text-[var(--suite-muted)]">Review attendance work that requires a manager, HR Manager or Attendance Admin decision.</p></div>
                <p className="text-sm font-medium text-[var(--suite-muted)]">{user?.currentOrganization?.name}</p>
            </header>
            <section aria-labelledby="management-queue-heading" className="overflow-hidden rounded-lg border border-[var(--suite-line-strong)] bg-[var(--suite-surface)]">
                <div className="border-b border-[var(--suite-line-strong)] px-5 py-4"><h2 id="management-queue-heading" className="font-semibold text-[var(--suite-ink)]">Work requiring attention</h2><p className="mt-1 text-sm text-[var(--suite-muted)]">Correction decisions are separate from final timesheet approval.</p></div>
                <div className="divide-y divide-[var(--suite-line)]">
                    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 text-[var(--suite-muted)]" /><div><p className="font-medium text-[var(--suite-ink)]">Timesheet approvals</p><p className="mt-0.5 text-sm text-[var(--suite-muted)]">{managementData.approvals.length} submitted {managementData.approvals.length === 1 ? 'timesheet' : 'timesheets'} waiting.</p></div></div><Link href="/approvals" className="suite-button-secondary">Open approvals <ArrowRight className="h-4 w-4" /></Link></div>
                    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-3"><AlertCircle className="mt-0.5 h-5 w-5 text-amber-600 dark:text-amber-300" /><div><p className="font-medium text-[var(--suite-ink)]">Correction requests</p><p className="mt-0.5 text-sm text-[var(--suite-muted)]">{managementData.corrections.length} proposed time {managementData.corrections.length === 1 ? 'correction needs' : 'corrections need'} a decision.</p></div></div><Link href="/exceptions" className="suite-button-secondary">Open correction queue <ArrowRight className="h-4 w-4" /></Link></div>
                    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-3"><Users className="mt-0.5 h-5 w-5 text-[var(--suite-muted)]" /><div><p className="font-medium text-[var(--suite-ink)]">Team attendance</p><p className="mt-0.5 text-sm text-[var(--suite-muted)]">{workingNow} of {teamMembers.length} visible team members currently working.</p></div></div><Link href="/team" className="suite-button-secondary">View team <ArrowRight className="h-4 w-4" /></Link></div>
                </div>
            </section>
            <section aria-labelledby="correction-process-heading" className="rounded-lg border border-[var(--suite-line)] bg-[var(--suite-surface)] p-5"><h2 id="correction-process-heading" className="font-semibold text-[var(--suite-ink)]">Correction process</h2><ol className="mt-4 grid gap-3 text-sm text-[var(--suite-muted)] md:grid-cols-3"><li><span className="font-semibold text-[var(--suite-ink)]">1. Employee proposes times</span><p className="mt-1 leading-6">The date, clock-in, clock-out, optional break and explanation are recorded.</p></li><li><span className="font-semibold text-[var(--suite-ink)]">2. Reviewer decides</span><p className="mt-1 leading-6">The assigned approver, line manager, HR Manager or Attendance Admin approves or rejects it.</p></li><li><span className="font-semibold text-[var(--suite-ink)]">3. Approved times are applied</span><p className="mt-1 leading-6">Old punches remain auditable and the timesheet is recalculated before final approval.</p></li></ol></section>
        </div>;
    }

    return (
        <div className="suite-dashboard">
            <header className="suite-dashboard-header">
                <div>
                    <p className="suite-kicker">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
                    <h1 className="suite-dashboard-title">
                        Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, {firstName}.
                    </h1>
                    <p className="suite-dashboard-copy">
                        Clock time, review today&apos;s activity, and keep the current week accurate for {organization}.
                    </p>
                </div>
                <div className="suite-context">
                    <div className="suite-context-row">
                        <div className="flex min-w-0 items-center gap-3">
                            <div className="suite-context-mark"><Clock className="h-5 w-5" /></div>
                            <div className="min-w-0">
                                <p className="suite-label">Current status</p>
                                <p className="truncate text-base font-semibold">{currentStatusLabel}</p>
                            </div>
                        </div>
                        <a href={getIdpUrl()} className="suite-button-secondary">
                            <LayoutGrid className="h-4 w-4" /> App Hub
                        </a>
                    </div>
                    <div className="mt-4 flex items-center justify-between border-t pt-3 text-sm" style={{ borderColor: 'var(--suite-line)', color: 'var(--suite-muted)' }}>
                        <span>{organization}</span>
                        <span>Week {dashboardData?.currentTimesheet?.weekNumber || 1}</span>
                    </div>
                </div>
            </header>

            {dashboardData?.pendingApprovals > 0 && (
                <div className="suite-notice mt-6">
                    <div className="flex items-start gap-3">
                        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" style={{ color: 'var(--suite-warning)' }} />
                        <div>
                            <p className="text-sm font-semibold">Timesheets need your review</p>
                            <p className="mt-0.5 text-sm" style={{ color: 'var(--suite-muted)' }}>
                                {dashboardData.pendingApprovals} pending {dashboardData.pendingApprovals === 1 ? 'submission is' : 'submissions are'} waiting.
                            </p>
                        </div>
                    </div>
                    <Link href="/approvals" className="suite-button">Review approvals <ArrowRight className="h-4 w-4" /></Link>
                </div>
            )}

            {onLeave && (
                <div className="suite-notice mt-6">
                    <div className="flex items-start gap-3">
                        <Calendar className="mt-0.5 h-5 w-5 shrink-0" style={{ color: 'var(--suite-accent)' }} />
                        <div>
                            <p className="text-sm font-semibold">
                                {clockedIn ? 'Attendance recorded during approved leave' : 'You are on approved leave today'}
                            </p>
                            <p className="mt-0.5 text-sm" style={{ color: 'var(--suite-muted)' }}>
                                {dashboardData.leave.typeName || 'Approved leave'} from {formatLeaveDate(dashboardData.leave.startAt)} to {formatLeaveDate(dashboardData.leave.endAt)}.
                                {clockedIn
                                    ? ' The overlap will remain visible for review.'
                                    : ' You will not be marked absent. Clock in only if you are working today.'}
                            </p>
                        </div>
                    </div>
                </div>
            )}

            <section className="suite-section">
                <div className="suite-section-heading">
                    <div>
                        <h2 className="suite-section-title">Today</h2>
                        <p className="suite-section-copy">Your live clock and the work recorded so far.</p>
                    </div>
                </div>
                <div className="grid gap-5 lg:grid-cols-[minmax(340px,.82fr)_minmax(0,1.18fr)]">
                    <ClockWidget
                        initialStatus={{
                            isClockedIn: dashboardData?.clock?.isClockedIn,
                            isOnBreak: dashboardData?.clock?.isOnBreak,
                            lastEntry: { timestamp: dashboardData?.clock?.clockInTime },
                            timeWorked: dashboardData?.today?.timeWorked,
                        }}
                        onStatusChange={fetchDashboardData}
                    />

                    <div className="space-y-5">
                        <div className="suite-metrics">
                            <div className="suite-metric">
                                <p className="suite-label">Weekly hours</p>
                                <p className="suite-metric-value">{totalHours}h</p>
                                <p className="mt-1 text-xs" style={{ color: 'var(--suite-positive)' }}>40h target</p>
                            </div>
                            <div className="suite-metric">
                                <p className="suite-label">Days worked</p>
                                <p className="suite-metric-value">{dashboardData?.week?.daysWorked || 0}</p>
                                <p className="mt-1 text-xs" style={{ color: 'var(--suite-muted)' }}>of 5 days</p>
                            </div>
                            <div className="suite-metric">
                                <p className="suite-label">Daily average</p>
                                <p className="suite-metric-value">{dashboardData?.week?.averageHoursPerDay || 0}h</p>
                                <p className="mt-1 text-xs" style={{ color: 'var(--suite-muted)' }}>8h target</p>
                            </div>
                            <div className="suite-metric">
                                <p className="suite-label">Break time</p>
                                <p className="suite-metric-value">{dashboardData?.today?.breakMinutes || 0}m</p>
                                <p className="mt-1 text-xs" style={{ color: 'var(--suite-muted)' }}>today</p>
                            </div>
                        </div>

                        <div className="suite-panel p-5 sm:p-6">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <Calendar className="h-4 w-4" style={{ color: 'var(--suite-accent)' }} />
                                        <h3 className="suite-card-title">Current timesheet</h3>
                                    </div>
                                    <p className="mt-1 text-sm" style={{ color: 'var(--suite-muted)' }}>
                                        Week {dashboardData?.currentTimesheet?.weekNumber || '--'}, {new Date().getFullYear()}
                                    </p>
                                </div>
                                <Link href="/timesheets/current" className="suite-button-secondary">View details <ArrowRight className="h-4 w-4" /></Link>
                            </div>
                            <div className="mt-8">
                                <div className="mb-2 flex justify-between text-sm" style={{ color: 'var(--suite-muted)' }}>
                                    <span>{totalHours} of 40 hours</span><span>{progress}%</span>
                                </div>
                                <div className="suite-progress"><span style={{ width: `${progress}%` }} /></div>
                            </div>
                        </div>

                        <div className="suite-panel">
                            <div className="suite-list-row">
                                <div>
                                    <p className="text-sm font-semibold">Work recorded today</p>
                                    <p className="mt-1 text-xs" style={{ color: 'var(--suite-muted)' }}>Net duration excluding breaks</p>
                                </div>
                                <p className="font-mono text-lg font-semibold">{dashboardData?.today?.formatted || '00:00'}</p>
                            </div>
                            <div className="suite-list-row">
                                <div>
                                    <p className="text-sm font-semibold">Clock state</p>
                                    <p className="mt-1 text-xs" style={{ color: 'var(--suite-muted)' }}>Synced across the App Hub and attendance</p>
                                </div>
                                <span className="suite-status">{onLeave && !clockedIn ? 'On leave' : clockedIn ? 'Working' : 'Off clock'}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
}
