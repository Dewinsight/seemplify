'use client';

import { useEffect, useState } from 'react';
import { attendanceApi } from '@/lib/api';
import { formatDuration } from '@/lib/utils';
import {
    Users,
    Clock,
    MapPin,
    MoreHorizontal,
    AlertCircle,
    Search
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, parseISO } from 'date-fns';

export default function TeamPage() {
    const [teamData, setTeamData] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchTeamStatus();
    }, []);

    const fetchTeamStatus = async () => {
        try {
            setLoading(true);
            const response = await attendanceApi.getTeamStatus();
            setTeamData(response);
        } catch (error) {
            console.error('Failed to fetch team status', error);
        } finally {
            setLoading(false);
        }
    };

    const getStatusColor = (status: any) => {
        if (status?.isOnBreak) return 'bg-amber-500';
        if (status?.isClockedIn) return 'bg-emerald-500';
        return 'bg-zinc-600';
    };

    const getStatusText = (status: any) => {
        if (status?.isOnBreak) return 'On Break';
        if (status?.isClockedIn) return 'Working';
        return 'Offline';
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-white">Team Overview</h1>
                    <p className="text-zinc-400">Monitor real-time status and attendance of your team</p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="bg-zinc-800/50 px-3 py-1.5 rounded-lg flex items-center gap-2 text-sm text-zinc-400">
                        <div className="w-2 h-2 rounded-full bg-emerald-500" />
                        <span>{teamData.filter((m: any) => m.currentStatus?.isClockedIn && !m.currentStatus?.isOnBreak).length} Online</span>
                    </div>
                </div>
            </div>

            {/* Search/Filter - Visual only */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                <input
                    type="text"
                    placeholder="Search team members..."
                    className="w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-teal-500/50"
                />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {loading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="h-32 bg-zinc-900/30 rounded-xl animate-pulse" />
                    ))
                ) : teamData.length === 0 ? (
                    <div className="col-span-full p-12 text-center text-zinc-500 bg-zinc-900/30 rounded-xl border border-dashed border-zinc-800">
                        No team members found assigned to you.
                    </div>
                ) : (
                    teamData.map((member: any) => (
                        <div key={member.user.id} className="bg-zinc-900/50 border border-white/5 rounded-xl p-5 hover:bg-zinc-800/50 transition-colors group">
                            <div className="flex items-start justify-between mb-4">
                                <div className="flex items-center gap-3">
                                    <div className="relative">
                                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-zinc-700 to-zinc-800 flex items-center justify-center text-lg font-bold text-white border border-white/10">
                                            {member.user.name.charAt(0)}
                                        </div>
                                        <div className={cn(
                                            "absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-zinc-900",
                                            getStatusColor(member.currentStatus)
                                        )} />
                                    </div>
                                    <div>
                                        <div className="font-medium text-white">{member.user.name}</div>
                                        <div className="text-xs text-zinc-500">{member.user.email}</div>
                                    </div>
                                </div>

                                <button className="p-1 rounded-lg hover:bg-zinc-700 text-zinc-500 hover:text-white transition-colors">
                                    <MoreHorizontal className="h-4 w-4" />
                                </button>
                            </div>

                            <div className="space-y-3">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-zinc-500">Status</span>
                                    <span className={cn(
                                        "px-2 py-0.5 rounded-full text-xs font-medium",
                                        member.currentStatus?.isClockedIn ? "bg-emerald-500/10 text-emerald-400" : "bg-zinc-800 text-zinc-400"
                                    )}>
                                        {getStatusText(member.currentStatus)}
                                    </span>
                                </div>

                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-zinc-500">Clock In</span>
                                    <span className="text-white font-mono">
                                        {member.currentStatus?.clockInTime ? format(parseISO(member.currentStatus.clockInTime), 'HH:mm') : '--:--'}
                                    </span>
                                </div>

                                <div className="pt-3 border-t border-zinc-800 mt-3 flex items-center justify-between">
                                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                                        <Clock className="h-3 w-3" />
                                        Today: {formatDuration((member.todayStats?.minutesWorked || 0))}
                                    </div>
                                    {member.currentStatus?.location && (
                                        <div className="flex items-center gap-1 text-xs text-zinc-500" title="Last known location">
                                            <MapPin className="h-3 w-3" />
                                            <span>GPS</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
