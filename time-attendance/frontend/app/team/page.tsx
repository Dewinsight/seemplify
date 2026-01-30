'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { attendanceApi } from '@/lib/api';
import { formatDuration } from '@/lib/utils';
import {
    Users,
    Clock,
    MapPin,
    MoreHorizontal,
    AlertCircle,
    Search,
    ChevronDown,
    Building2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, parseISO } from 'date-fns';

export default function TeamPage() {
    const { user } = useAuth();
    const router = useRouter();
    const [teamData, setTeamData] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedTeamId, setSelectedTeamId] = useState<string>('');
    const [isTeamMenuOpen, setIsTeamMenuOpen] = useState(false);

    // Filter teams where user is a manager or team lead
    const managedTeams = user?.teams?.filter((t: any) =>
        ['line_manager', 'team_lead'].includes(t.role)
    ) || [];

    useEffect(() => {
        fetchTeamStatus();
    }, [selectedTeamId]);

    const fetchTeamStatus = async () => {
        try {
            setLoading(true);
            const response = await attendanceApi.getTeamStatus(selectedTeamId);
            setTeamData(response.team || []); // Handle response structure { team: [], summary: {} }
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

    const getSelectedTeamName = () => {
        if (!selectedTeamId) return 'All Teams';
        const team = managedTeams.find((t: any) => t.id === selectedTeamId);
        return team ? team.name : 'All Teams';
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500" onClick={() => setIsTeamMenuOpen(false)}>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-white">Team Overview</h1>
                    <p className="text-zinc-400">Monitor real-time status and attendance of your team</p>
                </div>

                <div className="flex items-center gap-3">
                    {/* Team Switcher */}
                    {managedTeams.length > 0 && (
                        <div className="relative">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setIsTeamMenuOpen(!isTeamMenuOpen);
                                }}
                                className="flex items-center gap-2 px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm font-medium text-white hover:bg-zinc-800 transition-colors"
                            >
                                <Building2 className="h-4 w-4 text-zinc-400" />
                                <span>{getSelectedTeamName()}</span>
                                <ChevronDown className={cn("h-4 w-4 text-zinc-500 transition-transform", isTeamMenuOpen && "rotate-180")} />
                            </button>

                            {isTeamMenuOpen && (
                                <div className="absolute right-0 top-full mt-2 w-56 bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl py-1 z-50">
                                    <button
                                        onClick={() => setSelectedTeamId('')}
                                        className={cn(
                                            "w-full text-left px-4 py-2 text-sm hover:bg-zinc-800 transition-colors",
                                            !selectedTeamId ? "text-teal-400 font-medium" : "text-zinc-400"
                                        )}
                                    >
                                        All Teams
                                    </button>
                                    {managedTeams.map((team: any) => (
                                        <button
                                            key={team.id}
                                            onClick={() => setSelectedTeamId(team.id)}
                                            className={cn(
                                                "w-full text-left px-4 py-2 text-sm hover:bg-zinc-800 transition-colors",
                                                selectedTeamId === team.id ? "text-teal-400 font-medium" : "text-zinc-400"
                                            )}
                                        >
                                            {team.name}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    <div className="bg-zinc-800/50 px-3 py-2 rounded-lg flex items-center gap-2 text-sm text-zinc-400 border border-white/5">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span>{teamData.filter((m: any) => m.status === 'working').length} Online</span>
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
                        <div key={i} className="h-40 bg-zinc-900/30 rounded-xl animate-pulse border border-white/5" />
                    ))
                ) : teamData.length === 0 ? (
                    <div className="col-span-full p-12 text-center text-zinc-500 bg-zinc-900/30 rounded-xl border border-dashed border-zinc-800">
                        <Users className="h-12 w-12 mx-auto mb-4 text-zinc-700" />
                        <h3 className="text-lg font-medium text-zinc-400">No team members found</h3>
                        <p className="max-w-sm mx-auto mt-2">
                            {selectedTeamId
                                ? "No active members found in this team."
                                : "No team members assigned to you."}
                        </p>
                    </div>
                ) : (
                    teamData.map((member: any) => (
                        <div
                            key={member.userId}
                            onClick={() => router.push(`/team/${member.userId}`)}
                            className="bg-zinc-900/50 border border-white/5 rounded-xl p-5 hover:bg-zinc-800/50 transition-colors group relative overflow-hidden cursor-pointer"
                        >
                            <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button className="p-1 rounded-lg hover:bg-zinc-700 text-zinc-500 hover:text-white transition-colors">
                                    <MoreHorizontal className="h-4 w-4" />
                                </button>
                            </div>

                            <div className="flex items-start gap-4 mb-4">
                                <div className="relative shrink-0">
                                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-zinc-700 to-zinc-800 flex items-center justify-center text-lg font-bold text-white border border-white/10 shadow-lg">
                                        {(member.userName || 'U').charAt(0)}
                                    </div>
                                    <div className={cn(
                                        "absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-zinc-900 ring-1 ring-black/50",
                                        member.status === 'on_break' ? 'bg-amber-500' :
                                            member.status === 'working' ? 'bg-emerald-500' : 'bg-zinc-600'
                                    )} title={getStatusText({ isClockedIn: member.status === 'working', isOnBreak: member.status === 'on_break' })} />
                                </div>
                                <div>
                                    <div className="font-medium text-white truncate pr-6">{member.userName}</div>
                                    <div className="text-xs text-zinc-500 truncate">{member.userEmail}</div>
                                    {member.teamName && (
                                        <div className="text-[10px] text-teal-500/70 uppercase tracking-wider mt-1 font-medium bg-teal-500/10 px-1.5 py-0.5 rounded w-fit">
                                            {member.teamName}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="space-y-3 pt-3 border-t border-white/5">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-zinc-500">Current Status</span>
                                    <span className={cn(
                                        "px-2.5 py-0.5 rounded-full text-xs font-medium border",
                                        member.status === 'working' ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                                            member.status === 'on_break' ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                                                "bg-zinc-800 text-zinc-400 border-zinc-700"
                                    )}>
                                        {member.status === 'working' ? 'Working' :
                                            member.status === 'on_break' ? 'On Break' : 'Checked Out'}
                                    </span>
                                </div>

                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-zinc-500">Last Activity</span>
                                    <span className="text-zinc-300 font-mono text-xs">
                                        {member.lastActivity ? format(parseISO(member.lastActivity), 'h:mm a') : '--:--'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
