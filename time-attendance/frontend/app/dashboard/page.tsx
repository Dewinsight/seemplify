'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { attendanceApi, clockApi } from '@/lib/api';
import ClockWidget from '@/components/ClockWidget';
import Link from 'next/link';
import {
    ArrowRight,
    Calendar,
    Clock,
    AlertCircle,
    CheckCircle2,
    MoreHorizontal
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

export default function Dashboard() {
    const { user, isAuthenticated, isLoading: authLoading } = useAuth();
    const router = useRouter();
    const [dashboardData, setDashboardData] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    const fetchDashboardData = async () => {
        try {
            const data = await attendanceApi.getDashboard();
            setDashboardData(data);
        } catch (error) {
            console.error('Failed to fetch dashboard data:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!authLoading) {
            if (!isAuthenticated) {
                router.push('/login');
            } else {
                fetchDashboardData();
            }
        }
    }, [isAuthenticated, authLoading, router]);

    if (authLoading || loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-teal-500"></div>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Welcome Section */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-white via-zinc-200 to-zinc-400 bg-clip-text text-transparent">
                        Good {new Date().getHours() < 12 ? 'Morning' : new Date().getHours() < 18 ? 'Afternoon' : 'Evening'}, {user?.name?.split(' ')[0]} 👋
                    </h1>
                    <p className="text-zinc-400 mt-1">
                        Track your attendance for <span className="text-teal-400 font-medium">{user?.currentOrganization?.name}</span>
                    </p>
                </div>

                <a
                    href={getIdpUrl()}
                    className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm font-medium text-zinc-300 transition-colors flex items-center gap-2 border border-zinc-700"
                >
                    <div className="w-2 h-2 rounded-full bg-teal-500" />
                    App Hub
                </a>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Left Column - Clock Widget & Quick Stats */}
                <div className="lg:col-span-1 space-y-6">
                    <ClockWidget
                        initialStatus={{
                            isClockedIn: dashboardData?.clock?.isClockedIn,
                            isOnBreak: dashboardData?.clock?.isOnBreak,
                            lastEntry: { timestamp: dashboardData?.clock?.clockInTime },
                            timeWorked: dashboardData?.today?.timeWorked,
                        }}
                        onStatusChange={fetchDashboardData}
                    />

                    {/* Today's Summary Card */}
                    <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-6">
                        <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-4">Today's Activity</h3>
                        <div className="space-y-4">
                            <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-900 border border-zinc-800">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 rounded-lg bg-teal-500/10 text-teal-400">
                                        <Clock className="h-4 w-4" />
                                    </div>
                                    <div>
                                        <div className="text-sm font-medium text-white">Work Hours</div>
                                        <div className="text-xs text-zinc-500">Net duration</div>
                                    </div>
                                </div>
                                <div className="text-lg font-bold text-white font-mono">
                                    {dashboardData?.today?.formatted || '00:00'}
                                </div>
                            </div>

                            <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-900 border border-zinc-800">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
                                        <Clock className="h-4 w-4" />
                                    </div>
                                    <div>
                                        <div className="text-sm font-medium text-white">Break Time</div>
                                        <div className="text-xs text-zinc-500">Total breaks</div>
                                    </div>
                                </div>
                                <div className="text-lg font-bold text-white font-mono">
                                    {dashboardData?.today?.breakMinutes}m
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Column - Weekly Overview & Timesheets */}
                <div className="lg:col-span-2 space-y-6">

                    {/* Weekly Stats Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        <div className="bg-zinc-900/50 border border-white/5 p-4 rounded-xl">
                            <div className="text-xs text-zinc-500 mb-1">Weekly Hours</div>
                            <div className="text-2xl font-bold text-white">{dashboardData?.week?.totalHours || 0}</div>
                            <div className="text-xs text-teal-400 mt-1">On track</div>
                        </div>
                        <div className="bg-zinc-900/50 border border-white/5 p-4 rounded-xl">
                            <div className="text-xs text-zinc-500 mb-1">Days Worked</div>
                            <div className="text-2xl font-bold text-white">{dashboardData?.week?.daysWorked || 0}</div>
                            <div className="text-xs text-zinc-500 mt-1">Target: 5</div>
                        </div>
                        <div className="bg-zinc-900/50 border border-white/5 p-4 rounded-xl">
                            <div className="text-xs text-zinc-500 mb-1">Avg. Daily</div>
                            <div className="text-2xl font-bold text-white">{dashboardData?.week?.averageHoursPerDay || 0}h</div>
                            <div className="text-xs text-zinc-500 mt-1">Goal: 8h</div>
                        </div>
                        <div className="bg-zinc-900/50 border border-white/5 p-4 rounded-xl cursor-pointer hover:bg-zinc-800/50 transition-colors group">
                            <div className="text-xs text-zinc-500 mb-1">Current Status</div>
                            <div className="text-lg font-bold text-teal-400 flex items-center gap-2">
                                Active
                                <ArrowRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                            <div className="text-xs text-zinc-500 mt-1">Week {dashboardData?.currentTimesheet?.weekNumber || 1}</div>
                        </div>
                    </div>

                    {/* Current Timesheet Status */}
                    <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-6 relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-6 opacity-10">
                            <Calendar className="h-32 w-32 -mr-8 -mt-8" />
                        </div>

                        <div className="flex justify-between items-center mb-6 relative">
                            <div>
                                <h3 className="text-lg font-semibold text-white">Current Timesheet</h3>
                                <p className="text-sm text-zinc-400">Week {dashboardData?.currentTimesheet?.weekNumber || '--'}, 2026</p>
                            </div>
                            <Link
                                href="/timesheets/current"
                                className="px-4 py-2 bg-white text-zinc-950 rounded-lg text-sm font-semibold hover:bg-zinc-200 transition-colors shadow-lg shadow-white/5"
                            >
                                View Details
                            </Link>
                        </div>

                        <div className="relative">
                            <div className="flex items-center justify-between text-sm text-zinc-400 mb-2">
                                <span>Progress</span>
                                <span>{Math.min(100, Math.round(((dashboardData?.week?.totalHours || 0) / 40) * 100))}%</span>
                            </div>
                            <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-teal-500 to-cyan-400 rounded-full transition-all duration-1000 ease-out"
                                    style={{ width: `${Math.min(100, ((dashboardData?.week?.totalHours || 0) / 40) * 100)}%` }}
                                />
                            </div>
                            <div className="mt-2 text-xs text-zinc-500 flex justify-between">
                                <span>0h</span>
                                <span>Target: 40h</span>
                            </div>
                        </div>
                    </div>

                    {/* Pending Approvals (Manager Only) */}
                    {dashboardData?.pendingApprovals > 0 && (
                        <div className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 border border-amber-500/20 rounded-2xl p-6">
                            <div className="flex items-center gap-4">
                                <div className="p-3 rounded-xl bg-amber-500/20 text-amber-400">
                                    <AlertCircle className="h-6 w-6" />
                                </div>
                                <div className="flex-1">
                                    <h3 className="text-lg font-semibold text-white">Pending Approvals</h3>
                                    <p className="text-sm text-zinc-400">
                                        You have <span className="text-amber-400 font-bold">{dashboardData.pendingApprovals}</span> timesheets waiting for your approval.
                                    </p>
                                </div>
                                <Link
                                    href="/approvals"
                                    className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-zinc-950 font-semibold rounded-lg text-sm transition-colors shadow-lg shadow-amber-500/20"
                                >
                                    Review
                                </Link>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
