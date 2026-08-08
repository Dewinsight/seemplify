'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, ArrowRight, Calendar, Clock, LayoutGrid } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { getIdpUrl } from '@/lib/env';
import { attendanceApi } from '@/lib/api';
import ClockWidget from '@/components/ClockWidget';

export default function Dashboard() {
    const { user, isAuthenticated, isLoading: authLoading } = useAuth();
    const router = useRouter();
    const [dashboardData, setDashboardData] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    const fetchDashboardData = async () => {
        try {
            setDashboardData(await attendanceApi.getDashboard());
        } catch (error) {
            console.error('Failed to fetch dashboard data:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!authLoading) {
            if (!isAuthenticated) router.push('/login');
            else fetchDashboardData();
        }
    }, [isAuthenticated, authLoading, router]);

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

    return (
        <div className="suite-dashboard">
            <header className="suite-dashboard-header">
                <div>
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
                                <p className="truncate text-base font-semibold">{clockedIn ? 'Clocked in' : 'Not clocked in'}</p>
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
                                <span className="suite-status">{clockedIn ? 'Working' : 'Off clock'}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
}
