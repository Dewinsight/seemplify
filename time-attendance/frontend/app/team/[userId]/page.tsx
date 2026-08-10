'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { attendanceApi, timesheetApi } from '@/lib/api';
import { StatusBadge } from '@/components/StatusBadge';
import {
    ArrowLeft,
    Calendar,
    Clock,
    Mail,
    Building2,
    BarChart3,
    AlertCircle,
    ChevronRight,
    FileText,
    MapPin,
    Activity,
} from 'lucide-react';
import { format } from 'date-fns';
import Link from 'next/link';
import { cn, formatDuration } from '@/lib/utils';

type TeamMemberDetail = {
    userId: string;
    userName: string;
    userEmail?: string | null;
    teamName?: string | null;
    status: 'working' | 'on_break' | 'on_leave' | 'clocked_out' | 'not_clocked_in';
    leave?: { startAt: string; endAt: string; allDay: boolean } | null;
    leaveConflict?: boolean;
    clockInAt?: string | null;
    clockOutAt?: string | null;
    clockInLocation?: any;
    clockOutLocation?: any;
    workedMinutesToday?: number;
    lastActivity?: string | null;
    lastActivityType?: string | null;
};

export default function MemberDetailPage() {
    const params = useParams();
    const router = useRouter();
    const userId = params.userId as string;

    const [memberData, setMemberData] = useState<TeamMemberDetail | null>(null);
    const [summary, setSummary] = useState<any>(null);
    const [timesheets, setTimesheets] = useState<any[]>([]);
    const [todayEntries, setTodayEntries] = useState<any[]>([]);
    const [recentEntries, setRecentEntries] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (userId) {
            fetchMemberDetails();
        }
    }, [userId]);

    const fetchMemberDetails = async () => {
        try {
            setLoading(true);
            setError(null);

            const [detailRes, summaryRes, timesheetsRes] = await Promise.all([
                attendanceApi.getTeamMemberDetail(userId),
                attendanceApi.getSummary({ userId, period: 'month' }),
                timesheetApi.list({ userId, limit: 10 }),
            ]);

            setMemberData(detailRes.member || null);
            setTodayEntries(detailRes.todayEntries || []);
            setRecentEntries(detailRes.recentEntries || []);
            setSummary(summaryRes || null);
            setTimesheets(timesheetsRes.timesheets || timesheetsRes || []);
        } catch (err: any) {
            console.error('Failed to fetch member details', err);
            setError(err.response?.data?.error || 'Failed to load member details');
        } finally {
            setLoading(false);
        }
    };

    const formatDateTime = (value?: string | null) => {
        if (!value) return '--';
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return '--';
        return format(parsed, 'MMM d, yyyy h:mm a');
    };

    const formatDateOnly = (value?: string | null) => {
        if (!value) return '--';
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return '--';
        return format(parsed, 'MMM d, yyyy');
    };

    const formatLocation = (location: any) => {
        if (!location) return '--';
        return (
            location.address ||
            location.displayName ||
            [location.area, location.city, location.state].filter(Boolean).join(', ') ||
            '--'
        );
    };

    const statusBadgeClass = useMemo(() => {
        switch (memberData?.status) {
            case 'working':
                return 'bg-emerald-500/10 text-emerald-400';
            case 'on_break':
                return 'bg-amber-500/10 text-amber-400';
            case 'on_leave':
                return 'bg-teal-500/10 text-teal-300';
            case 'clocked_out':
                return 'bg-zinc-700/30 text-zinc-300';
            default:
                return 'bg-zinc-800 text-zinc-400';
        }
    }, [memberData?.status]);

    const statusText = useMemo(() => {
        switch (memberData?.status) {
            case 'working':
                return 'Working';
            case 'on_break':
                return 'On Break';
            case 'on_leave':
                return 'On Leave';
            case 'clocked_out':
                return 'Clocked Out';
            default:
                return 'Not Clocked In';
        }
    }, [memberData?.status]);

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="animate-spin h-8 w-8 border-2 border-teal-500 rounded-full border-t-transparent"></div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] text-zinc-400">
                <div className="p-4 rounded-full bg-red-500/10 mb-4">
                    <AlertCircle className="h-8 w-8 text-red-500" />
                </div>
                <h2 className="text-xl font-semibold text-white mb-2">Access Denied or Not Found</h2>
                <p className="mb-6">{error}</p>
                <div className="flex gap-4">
                    <button
                        onClick={() => router.back()}
                        className="px-4 py-2 bg-zinc-800 rounded-lg hover:bg-zinc-700 transition-colors"
                    >
                        Go Back
                    </button>
                    <Link href="/team" className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-500 transition-colors">
                        Back to Team
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <div>
                <button
                    onClick={() => router.back()}
                    className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors mb-4 group"
                >
                    <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
                    Back to Team
                </button>

                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-zinc-900/50 border border-white/5 rounded-2xl p-8">
                    <div className="flex items-start gap-6">
                        <div className="relative">
                            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-3xl font-bold text-white shadow-xl shadow-indigo-500/20">
                                {(memberData?.userName || 'U').charAt(0)}
                            </div>
                            <div className={cn(
                                'absolute bottom-0 right-0 w-6 h-6 rounded-full border-4 border-zinc-900',
                                memberData?.status === 'working' ? 'bg-emerald-500' :
                                    memberData?.status === 'on_break' ? 'bg-amber-500' :
                                        memberData?.status === 'on_leave' ? 'bg-teal-500' : 'bg-zinc-600'
                            )} />
                        </div>

                        <div>
                            <h1 className="text-3xl font-bold text-white mb-2">{memberData?.userName || 'Team Member'}</h1>
                            <div className="flex flex-wrap items-center gap-4 text-sm text-zinc-400">
                                {memberData?.userEmail && (
                                    <div className="flex items-center gap-1.5">
                                        <Mail className="h-4 w-4 text-zinc-500" />
                                        <span>{memberData.userEmail}</span>
                                    </div>
                                )}
                                {memberData?.teamName && (
                                    <div className="flex items-center gap-1.5">
                                        <Building2 className="h-4 w-4 text-zinc-500" />
                                        <span>{memberData.teamName}</span>
                                    </div>
                                )}
                                <div className={cn('px-2.5 py-0.5 rounded-full text-xs font-medium uppercase tracking-wider', statusBadgeClass)}>
                                    {statusText}
                                </div>
                            </div>
                            {memberData?.leave && (
                                <p className="mt-3 flex items-center gap-2 text-sm text-teal-300">
                                    <Calendar className="h-4 w-4" />
                                    Approved leave from {formatDateOnly(memberData.leave.startAt)} to {formatDateOnly(memberData.leave.endAt)}
                                </p>
                            )}
                            {memberData?.leaveConflict && (
                                <p className="mt-2 text-sm text-amber-300">Attendance has been recorded during approved leave and needs review.</p>
                            )}
                        </div>
                    </div>

                    <div className="text-right">
                        <div className="text-xs text-zinc-500 uppercase tracking-widest mb-1">Worked Today</div>
                        <div className="text-2xl font-mono text-white">
                            {formatDuration(memberData?.workedMinutesToday || 0)}
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-5">
                    <div className="flex items-center gap-2 text-zinc-500 mb-2">
                        <Clock className="h-4 w-4" />
                        <span className="text-xs font-medium uppercase tracking-wider">Total Hours (30d)</span>
                    </div>
                    <div className="text-2xl font-bold text-white">
                        {summary?.summary?.totalHours || 0}
                        <span className="text-sm font-normal text-zinc-500 ml-1">hrs</span>
                    </div>
                </div>

                <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-5">
                    <div className="flex items-center gap-2 text-zinc-500 mb-2">
                        <Calendar className="h-4 w-4" />
                        <span className="text-xs font-medium uppercase tracking-wider">Days Worked</span>
                    </div>
                    <div className="text-2xl font-bold text-white">
                        {summary?.summary?.daysWorked || 0}
                        <span className="text-sm font-normal text-zinc-500 ml-1">days</span>
                    </div>
                </div>

                <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-5">
                    <div className="flex items-center gap-2 text-teal-400/80 mb-2">
                        <Calendar className="h-4 w-4" />
                        <span className="text-xs font-medium uppercase tracking-wider">Leave Days</span>
                    </div>
                    <div className="text-2xl font-bold text-white">
                        {summary?.summary?.daysOnLeave || 0}
                        <span className="text-sm font-normal text-zinc-500 ml-1">days</span>
                    </div>
                </div>

                <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-5">
                    <div className="flex items-center gap-2 text-amber-500/70 mb-2">
                        <BarChart3 className="h-4 w-4" />
                        <span className="text-xs font-medium uppercase tracking-wider">Overtime</span>
                    </div>
                    <div className="text-2xl font-bold text-white">
                        {summary?.summary?.overtimeHours || 0}
                        <span className="text-sm font-normal text-zinc-500 ml-1">hrs</span>
                    </div>
                </div>

                <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-5">
                    <div className="flex items-center gap-2 text-red-400/70 mb-2">
                        <AlertCircle className="h-4 w-4" />
                        <span className="text-xs font-medium uppercase tracking-wider">Late Arrivals</span>
                    </div>
                    <div className="text-2xl font-bold text-white">
                        {summary?.summary?.lateDays || 0}
                        <span className="text-sm font-normal text-zinc-500 ml-1">days</span>
                    </div>
                </div>
            </div>

            <div className="bg-zinc-900/50 border border-white/5 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-zinc-800/60 flex items-center gap-2">
                    <Activity className="h-5 w-5 text-teal-500" />
                    <h2 className="text-lg font-semibold text-white">Today Activity Timeline</h2>
                </div>

                {todayEntries.length === 0 ? (
                    <div className="p-8 text-center text-zinc-500">
                        {memberData?.status === 'on_leave' ? 'Approved leave - no clock activity is required today.' : 'No activity recorded today.'}
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[900px]">
                            <thead className="bg-zinc-900/80 border-b border-zinc-800/60">
                                <tr className="text-left text-xs uppercase tracking-wider text-zinc-500">
                                    <th className="px-4 py-3">Time</th>
                                    <th className="px-4 py-3">Entry Type</th>
                                    <th className="px-4 py-3">Location</th>
                                    <th className="px-4 py-3">Source</th>
                                    <th className="px-4 py-3">Note</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-800/60">
                                {todayEntries.map((entry: any) => (
                                    <tr key={entry._id}>
                                        <td className="px-4 py-3 text-sm text-zinc-200 font-mono">{formatDateTime(entry.timestamp)}</td>
                                        <td className="px-4 py-3 text-sm text-zinc-300 uppercase">{String(entry.entryType || '').replace('_', ' ')}</td>
                                        <td className="px-4 py-3 text-sm text-zinc-300 max-w-[320px]">
                                            <div className="flex items-start gap-1.5">
                                                <MapPin className="h-3.5 w-3.5 text-zinc-500 mt-0.5 shrink-0" />
                                                <span className="truncate">{formatLocation(entry.location)}</span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-sm text-zinc-400">{entry.source || '--'}</td>
                                        <td className="px-4 py-3 text-sm text-zinc-400">{entry.note || '--'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <div className="bg-zinc-900/50 border border-white/5 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-zinc-800/60">
                    <h2 className="text-lg font-semibold text-white">Recent Activity (Last 50 Entries)</h2>
                </div>

                {recentEntries.length === 0 ? (
                    <div className="p-8 text-center text-zinc-500">No recent activity found.</div>
                ) : (
                    <div className="divide-y divide-zinc-800/60">
                        {recentEntries.map((entry: any) => (
                            <div key={entry._id} className="px-5 py-3 flex flex-col md:flex-row md:items-center justify-between gap-2">
                                <div className="flex items-center gap-3">
                                    <div className="text-xs uppercase tracking-wider px-2 py-1 rounded border border-zinc-700 text-zinc-400">
                                        {String(entry.entryType || '').replace('_', ' ')}
                                    </div>
                                    <div className="text-sm text-zinc-300">{formatDateTime(entry.timestamp)}</div>
                                </div>
                                <div className="text-sm text-zinc-500 truncate max-w-[520px]">{formatLocation(entry.location)}</div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div>
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                        <FileText className="h-5 w-5 text-teal-500" />
                        Recent Timesheets
                    </h2>
                </div>

                <div className="bg-zinc-900/50 border border-white/5 rounded-xl overflow-hidden">
                    {timesheets.length === 0 ? (
                        <div className="p-8 text-center text-zinc-500">
                            No timesheets found for this user.
                        </div>
                    ) : (
                        <div className="divide-y divide-zinc-800/50">
                            {timesheets.map((ts) => (
                                <Link
                                    key={ts._id || ts.id}
                                    href={`/timesheets/${ts._id || ts.id}`}
                                    className="block p-4 hover:bg-zinc-800/30 transition-colors group"
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-400 group-hover:text-white transition-colors">
                                                <Calendar className="h-5 w-5" />
                                            </div>
                                            <div>
                                                <div className="font-medium text-white group-hover:text-teal-400 transition-colors">
                                                    Week {ts.weekNumber}, {ts.year}
                                                </div>
                                                <div className="text-sm text-zinc-500">
                                                    {formatDateOnly(ts.startDate)} - {formatDateOnly(ts.endDate)}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-6">
                                            <div className="text-right hidden sm:block">
                                                <div className="text-sm font-medium text-white">{ts.summary?.totalHours || 0} hrs</div>
                                                <div className="text-xs text-zinc-500">Total</div>
                                            </div>

                                            <StatusBadge status={ts.status} />

                                            <ChevronRight className="h-5 w-5 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
                                        </div>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
