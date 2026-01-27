'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { attendanceApi, timesheetApi } from '@/lib/api';
import { formatDuration } from '@/lib/utils';
import { StatusBadge } from '@/components/StatusBadge';
import {
    ArrowLeft,
    Calendar,
    Clock,
    User,
    Mail,
    Building2,
    BarChart3,
    AlertCircle,
    ChevronRight,
    FileText
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export default function MemberDetailPage() {
    const params = useParams();
    const router = useRouter();
    const userId = params.userId as string;

    const [memberData, setMemberData] = useState<any>(null);
    const [summary, setSummary] = useState<any>(null);
    const [timesheets, setTimesheets] = useState<any[]>([]);
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

            // Fetch last 30 days summary for this user
            const summaryPromise = attendanceApi.getSummary({
                userId,
                period: 'month'
            });

            // Fetch timesheets for this user
            const timesheetsPromise = timesheetApi.list({
                userId,
                limit: 10
            });

            // We also need basic user info. 
            // Since we don't have a specific "get user profile" API for managers, 
            // we can reuse the team status list to find this user's details if we are a manager.
            // OR we can assume the summary endpoint or a new endpoint provides it.
            // For now, let's try to get it from the team list first as a fallback?
            // Actually, let's fetch team status for ALL teams to find this user
            const teamStatusPromise = attendanceApi.getTeamStatus();

            const [summaryRes, timesheetsRes, teamStatusRes] = await Promise.all([
                summaryPromise,
                timesheetsPromise,
                teamStatusPromise
            ]);

            setSummary(summaryRes);
            setTimesheets(timesheetsRes.timesheets || timesheetsRes);

            // Find user in team status
            // Note: teamStatus returns an array of members
            const foundMember = (teamStatusRes.team || teamStatusRes).find((m: any) => m.userId === userId || m.user?.id === userId);

            if (foundMember) {
                setMemberData(foundMember);
            } else {
                // Fallback if not currently clocked in or visible in simple team list?
                // The team list usually shows all assigned members even if offline, so this should work 
                // as long as the manager manages them.
                // Construct basic info if possible or show error
                setMemberData({
                    userName: 'Team Member',
                    userId: userId,
                    status: 'unknown'
                });
            }

        } catch (err: any) {
            console.error('Failed to fetch member details', err);
            setError(err.response?.data?.error || 'Failed to load member details');
        } finally {
            setLoading(false);
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'working': return 'bg-emerald-500 text-emerald-500';
            case 'on_break': return 'bg-amber-500 text-amber-500';
            case 'clocked_out': return 'bg-zinc-500 text-zinc-500';
            default: return 'bg-zinc-500 text-zinc-500';
        }
    };

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
            {/* Header */}
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
                                "absolute bottom-0 right-0 w-6 h-6 rounded-full border-4 border-zinc-900",
                                memberData?.status === 'working' ? 'bg-emerald-500' :
                                    memberData?.status === 'on_break' ? 'bg-amber-500' : 'bg-zinc-600'
                            )} />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold text-white mb-2">{memberData?.userName}</h1>
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
                                <div className={cn(
                                    "px-2.5 py-0.5 rounded-full text-xs font-medium uppercase tracking-wider",
                                    memberData?.status === 'working' ? "bg-emerald-500/10 text-emerald-400" :
                                        memberData?.status === 'on_break' ? "bg-amber-500/10 text-amber-500" :
                                            "bg-zinc-800 text-zinc-400"
                                )}>
                                    {memberData?.status === 'working' ? 'Online' :
                                        memberData?.status === 'on_break' ? 'On Break' : 'Offline'}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex gap-3">
                        {memberData?.status === 'working' && memberData?.lastActivity && (
                            <div className="text-right">
                                <div className="text-xs text-zinc-500 uppercase tracking-widest mb-1">Clocked In At</div>
                                <div className="text-2xl font-mono text-white">
                                    {format(parseISO(memberData.lastActivity), 'HH:mm')}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Stats Overview (Last 30 Days) */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-5">
                    <div className="flex items-center gap-2 text-zinc-500 mb-2">
                        <Clock className="h-4 w-4" />
                        <span className="text-xs font-medium uppercase tracking-wider">Total Hours</span>
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

            {/* Recent Timesheets */}
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
                                                    {format(parseISO(ts.startDate), 'MMM d')} - {format(parseISO(ts.endDate), 'MMM d, yyyy')}
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
