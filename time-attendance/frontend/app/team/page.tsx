'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { attendanceApi } from '@/lib/api';
import { formatDuration, cn } from '@/lib/utils';
import {
    Users,
    Search,
    ChevronDown,
    Building2,
    MapPin,
    Clock3,
    ArrowRight,
    AlertCircle,
    BellRing,
    RefreshCw,
    Download,
} from 'lucide-react';
import { format } from 'date-fns';

type TeamMember = {
    userId: string;
    userName: string;
    userEmail?: string | null;
    teamName?: string | null;
    status: 'working' | 'on_break' | 'clocked_out' | 'not_clocked_in';
    clockInAt?: string | null;
    clockOutAt?: string | null;
    clockInLocation?: any;
    clockOutLocation?: any;
    workedMinutesToday?: number;
    lastActivity?: string | null;
    lastActivityType?: string | null;
};

type TeamSummary = {
    total: number;
    working: number;
    onBreak: number;
    clockedOut: number;
    notClockedIn?: number;
};

type TeamStatusFilter = 'all' | TeamMember['status'];

const EMPTY_SUMMARY: TeamSummary = {
    total: 0,
    working: 0,
    onBreak: 0,
    clockedOut: 0,
    notClockedIn: 0,
};

export default function TeamPage() {
    const { user } = useAuth();
    const router = useRouter();

    const [teamData, setTeamData] = useState<TeamMember[]>([]);
    const [summary, setSummary] = useState<TeamSummary>(EMPTY_SUMMARY);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState<TeamStatusFilter>('all');
    const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
    const [reminderSendingFor, setReminderSendingFor] = useState<string | null>(null);
    const [exporting, setExporting] = useState(false);
    const [actionFeedback, setActionFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const [selectedTeamId, setSelectedTeamId] = useState<string>('');
    const [isTeamMenuOpen, setIsTeamMenuOpen] = useState(false);

    const managedTeams = (user?.teams || []).filter((t: any) =>
        t.organizationId === user?.currentOrganization?.id &&
        ['line_manager', 'team_lead'].includes(t.role)
    );

    useEffect(() => {
        fetchTeamStatus();
    }, [selectedTeamId]);

    useEffect(() => {
        if (!actionFeedback) return;
        const timeout = setTimeout(() => setActionFeedback(null), 5000);
        return () => clearTimeout(timeout);
    }, [actionFeedback]);

    const fetchTeamStatus = async () => {
        try {
            setLoading(true);
            const response = await attendanceApi.getTeamStatus(selectedTeamId || undefined);
            setTeamData(response.team || []);
            setSummary(response.summary || EMPTY_SUMMARY);
            setLastUpdatedAt(new Date());
        } catch (error) {
            console.error('Failed to fetch team status', error);
            setTeamData([]);
            setSummary(EMPTY_SUMMARY);
        } finally {
            setLoading(false);
        }
    };

    const filteredTeamData = useMemo(() => {
        const q = searchTerm.trim().toLowerCase();
        const statusScoped = statusFilter === 'all'
            ? teamData
            : teamData.filter(member => member.status === statusFilter);
        if (!q) return statusScoped;

        return statusScoped.filter((member) => {
            return [
                member.userName,
                member.userEmail,
                member.teamName,
                member.status,
            ]
                .filter(Boolean)
                .some((value) => String(value).toLowerCase().includes(q));
        });
    }, [teamData, searchTerm, statusFilter]);

    const getSelectedTeamName = () => {
        if (!selectedTeamId) return 'All Managed Teams';
        const team = managedTeams.find((t: any) => t.id === selectedTeamId);
        return team ? team.name : 'Selected Team';
    };

    const formatTime = (value?: string | null, withDate = false) => {
        if (!value) return '--';

        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return '--';

        return format(parsed, withDate ? 'MMM d, h:mm a' : 'h:mm a');
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

    const canSendClockOutReminder = (member: TeamMember) => {
        const hasActiveStatus = member.status === 'working' || member.status === 'on_break';
        return hasActiveStatus && Boolean(member.userEmail);
    };

    const sendClockOutReminder = async (member: TeamMember) => {
        if (!canSendClockOutReminder(member)) {
            setActionFeedback({
                type: 'error',
                text: 'Reminder can only be sent to a currently active member with an email address.',
            });
            return;
        }

        try {
            setReminderSendingFor(member.userId);
            const response = await attendanceApi.sendClockOutReminder(member.userId);
            setActionFeedback({
                type: 'success',
                text: response?.message || `Reminder sent to ${member.userName}.`,
            });
        } catch (error: any) {
            setActionFeedback({
                type: 'error',
                text: error?.response?.data?.error || 'Failed to send clock-out reminder.',
            });
        } finally {
            setReminderSendingFor(null);
        }
    };

    const exportTeamAttendanceExcel = async () => {
        try {
            setExporting(true);
            const { blob, filename } = await attendanceApi.exportTeamExcel({
                teamId: selectedTeamId || undefined,
                status: statusFilter,
                q: searchTerm.trim() || undefined,
            });

            const fileUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = fileUrl;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(fileUrl);
        } catch (error: any) {
            setActionFeedback({
                type: 'error',
                text: error?.response?.data?.error || 'Failed to export team attendance.',
            });
        } finally {
            setExporting(false);
        }
    };

    const getStatusStyles = (status: TeamMember['status']) => {
        switch (status) {
            case 'working':
                return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
            case 'on_break':
                return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
            case 'clocked_out':
                return 'bg-zinc-700/30 text-zinc-300 border-zinc-600';
            case 'not_clocked_in':
            default:
                return 'bg-zinc-800/40 text-zinc-400 border-zinc-700';
        }
    };

    const getStatusLabel = (status: TeamMember['status']) => {
        switch (status) {
            case 'working':
                return 'Working';
            case 'on_break':
                return 'On Break';
            case 'clocked_out':
                return 'Clocked Out';
            case 'not_clocked_in':
            default:
                return 'Not Clocked In';
        }
    };

    const hasManagerAccess = managedTeams.length > 0 || ['owner', 'admin', 'hr_manager'].includes(user?.currentOrganization?.role || '');
    const notClockedInCount = summary.notClockedIn || 0;
    const clockedOutOnlyCount = Math.max(0, summary.clockedOut - notClockedInCount);

    if (!hasManagerAccess) {
        return (
            <div className="p-8 bg-zinc-900/40 border border-zinc-800 rounded-xl text-zinc-400">
                <h1 className="text-xl font-semibold text-white mb-2">Team Attendance</h1>
                <p>You need line manager, team lead, or admin access to view team attendance.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-500" onClick={() => setIsTeamMenuOpen(false)}>
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-white">Team Attendance</h1>
                    <p className="text-zinc-400">Line manager view of clock-in, clock-out, location, and current status.</p>
                    {lastUpdatedAt && (
                        <p className="text-xs text-zinc-500 mt-1">Last updated: {format(lastUpdatedAt, 'MMM d, h:mm:ss a')}</p>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    {managedTeams.length > 0 && (
                        <div className="relative">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setIsTeamMenuOpen((prev) => !prev);
                                }}
                                className="flex items-center gap-2 px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm font-medium text-white hover:bg-zinc-800 transition-colors"
                            >
                                <Building2 className="h-4 w-4 text-zinc-400" />
                                <span>{getSelectedTeamName()}</span>
                                <ChevronDown className={cn('h-4 w-4 text-zinc-500 transition-transform', isTeamMenuOpen && 'rotate-180')} />
                            </button>

                            {isTeamMenuOpen && (
                                <div className="absolute right-0 top-full mt-2 w-60 bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl py-1 z-50">
                                    <button
                                        onClick={() => setSelectedTeamId('')}
                                        className={cn(
                                            'w-full text-left px-4 py-2 text-sm hover:bg-zinc-800 transition-colors',
                                            !selectedTeamId ? 'text-teal-400 font-medium' : 'text-zinc-400'
                                        )}
                                    >
                                        All Managed Teams
                                    </button>
                                    {managedTeams.map((team: any) => (
                                        <button
                                            key={team.id}
                                            onClick={() => setSelectedTeamId(team.id)}
                                            className={cn(
                                                'w-full text-left px-4 py-2 text-sm hover:bg-zinc-800 transition-colors',
                                                selectedTeamId === team.id ? 'text-teal-400 font-medium' : 'text-zinc-400'
                                            )}
                                        >
                                            {team.name}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            fetchTeamStatus();
                        }}
                        disabled={loading}
                        className="inline-flex items-center gap-2 px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-300 hover:text-white hover:border-zinc-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
                        Refresh
                    </button>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            exportTeamAttendanceExcel();
                        }}
                        disabled={loading || exporting}
                        className="inline-flex items-center gap-2 px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-300 hover:text-white hover:border-zinc-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                        title="Export current team table to Excel"
                    >
                        <Download className="h-3.5 w-3.5" />
                        {exporting ? 'Exporting...' : 'Export Excel'}
                    </button>
                    <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-300">
                        <span className="text-zinc-500">Total:</span> {summary.total}
                    </div>
                    <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2 text-xs text-emerald-300">
                        <span className="text-emerald-500/80">Working:</span> {summary.working}
                    </div>
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 text-xs text-amber-300">
                        <span className="text-amber-500/80">Break:</span> {summary.onBreak}
                    </div>
                    <div className="bg-zinc-800/70 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-300">
                        <span className="text-zinc-500">Clocked Out:</span> {clockedOutOnlyCount}
                    </div>
                </div>
            </div>

            <div className="flex flex-col xl:flex-row xl:items-center gap-3">
                <div className="relative max-w-xl w-full">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                    <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Search by name, email, team, or status"
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-teal-500/50"
                    />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {[
                        { key: 'all', label: 'All', count: summary.total },
                        { key: 'working', label: 'Working', count: summary.working },
                        { key: 'on_break', label: 'On Break', count: summary.onBreak },
                        { key: 'clocked_out', label: 'Clocked Out', count: clockedOutOnlyCount },
                        { key: 'not_clocked_in', label: 'Not Clocked In', count: notClockedInCount },
                    ].map((filterItem) => {
                        const isActive = statusFilter === filterItem.key;
                        return (
                            <button
                                key={filterItem.key}
                                type="button"
                                onClick={() => setStatusFilter(filterItem.key as TeamStatusFilter)}
                                className={cn(
                                    'px-3 py-1.5 rounded-lg border text-xs transition-colors',
                                    isActive
                                        ? 'bg-teal-500/15 border-teal-500/30 text-teal-300'
                                        : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
                                )}
                            >
                                {filterItem.label}: {filterItem.count}
                            </button>
                        );
                    })}
                </div>
            </div>

            {actionFeedback && (
                <div
                    className={cn(
                        'px-3 py-2 rounded-lg border text-sm',
                        actionFeedback.type === 'success'
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                            : 'bg-rose-500/10 border-rose-500/30 text-rose-200'
                    )}
                >
                    {actionFeedback.text}
                </div>
            )}

            <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl overflow-hidden shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[1320px]">
                        <thead className="bg-zinc-900/95 border-b border-zinc-800 sticky top-0 z-10">
                            <tr className="text-left text-xs uppercase tracking-wider text-zinc-500">
                                <th className="px-4 py-3 font-medium">Member</th>
                                <th className="px-4 py-3 font-medium">Team</th>
                                <th className="px-4 py-3 font-medium">Status</th>
                                <th className="px-4 py-3 font-medium">Clock In</th>
                                <th className="px-4 py-3 font-medium">Clock Out</th>
                                <th className="px-4 py-3 font-medium">Clock-In Location</th>
                                <th className="px-4 py-3 font-medium">Clock-Out Location</th>
                                <th className="px-4 py-3 font-medium">Worked Today</th>
                                <th className="px-4 py-3 font-medium">Last Activity</th>
                                <th className="px-4 py-3 font-medium text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800/60">
                            {loading && Array.from({ length: 5 }).map((_, idx) => (
                                <tr key={idx} className="animate-pulse">
                                    <td className="px-4 py-4"><div className="h-4 w-40 bg-zinc-800 rounded" /></td>
                                    <td className="px-4 py-4"><div className="h-4 w-24 bg-zinc-800 rounded" /></td>
                                    <td className="px-4 py-4"><div className="h-4 w-20 bg-zinc-800 rounded" /></td>
                                    <td className="px-4 py-4"><div className="h-4 w-20 bg-zinc-800 rounded" /></td>
                                    <td className="px-4 py-4"><div className="h-4 w-20 bg-zinc-800 rounded" /></td>
                                    <td className="px-4 py-4"><div className="h-4 w-44 bg-zinc-800 rounded" /></td>
                                    <td className="px-4 py-4"><div className="h-4 w-44 bg-zinc-800 rounded" /></td>
                                    <td className="px-4 py-4"><div className="h-4 w-24 bg-zinc-800 rounded" /></td>
                                    <td className="px-4 py-4"><div className="h-4 w-32 bg-zinc-800 rounded" /></td>
                                    <td className="px-4 py-4"><div className="h-8 w-20 bg-zinc-800 rounded" /></td>
                                </tr>
                            ))}

                            {!loading && filteredTeamData.length === 0 && (
                                <tr>
                                    <td colSpan={10} className="px-4 py-12 text-center">
                                        <Users className="h-10 w-10 text-zinc-700 mx-auto mb-3" />
                                        <p className="text-zinc-400 font-medium">No team members found</p>
                                        <p className="text-zinc-500 text-sm mt-1">
                                            {searchTerm || statusFilter !== 'all'
                                                ? 'Try a different search or status filter.'
                                                : 'No managed team members are available in this view.'}
                                        </p>
                                    </td>
                                </tr>
                            )}

                            {!loading && filteredTeamData.map((member) => (
                                <tr
                                    key={member.userId}
                                    className={cn(
                                        'transition-colors cursor-pointer',
                                        member.status === 'working' && 'bg-emerald-500/[0.03] hover:bg-emerald-500/[0.08]',
                                        member.status === 'on_break' && 'bg-amber-500/[0.03] hover:bg-amber-500/[0.08]',
                                        member.status !== 'working' && member.status !== 'on_break' && 'hover:bg-zinc-800/30'
                                    )}
                                    onClick={() => router.push(`/team/${member.userId}`)}
                                >
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-3">
                                            <div className="h-8 w-8 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs font-semibold flex items-center justify-center">
                                                {(member.userName || member.userEmail || member.userId).slice(0, 2).toUpperCase()}
                                            </div>
                                            <div>
                                                <div className="font-medium text-white">{member.userName}</div>
                                                <div className="text-xs text-zinc-500">{member.userEmail || member.userId}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-sm text-zinc-300">{member.teamName || '--'}</td>
                                    <td className="px-4 py-3">
                                        <span className={cn('px-2.5 py-1 rounded-full text-xs font-medium border', getStatusStyles(member.status))}>
                                            {getStatusLabel(member.status)}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-sm text-zinc-200 font-mono">{formatTime(member.clockInAt)}</td>
                                    <td className="px-4 py-3 text-sm text-zinc-200 font-mono">{formatTime(member.clockOutAt)}</td>
                                    <td className="px-4 py-3 text-sm text-zinc-300 max-w-[220px]">
                                        <div className="flex items-start gap-1.5">
                                            <MapPin className="h-3.5 w-3.5 text-zinc-500 mt-0.5 shrink-0" />
                                            <span className="truncate" title={formatLocation(member.clockInLocation)}>
                                                {formatLocation(member.clockInLocation)}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-sm text-zinc-300 max-w-[220px]">
                                        <div className="flex items-start gap-1.5">
                                            <MapPin className="h-3.5 w-3.5 text-zinc-500 mt-0.5 shrink-0" />
                                            <span className="truncate" title={formatLocation(member.clockOutLocation)}>
                                                {formatLocation(member.clockOutLocation)}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-sm text-zinc-200">
                                        {formatDuration(member.workedMinutesToday || 0)}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-zinc-300">
                                        <div className="flex items-center gap-1.5">
                                            <Clock3 className="h-3.5 w-3.5 text-zinc-500" />
                                            <span>{formatTime(member.lastActivity, true)}</span>
                                        </div>
                                        {member.lastActivityType && (
                                            <div className="mt-1 text-[11px] uppercase tracking-wide text-zinc-500">
                                                {member.lastActivityType.replace('_', ' ')}
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center justify-end gap-2">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    sendClockOutReminder(member);
                                                }}
                                                disabled={!canSendClockOutReminder(member) || reminderSendingFor === member.userId}
                                                className={cn(
                                                    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                                                    canSendClockOutReminder(member)
                                                        ? 'border-amber-500/30 text-amber-300 hover:bg-amber-500/10 hover:border-amber-500/50'
                                                        : 'border-zinc-700 text-zinc-500'
                                                )}
                                                title={
                                                    canSendClockOutReminder(member)
                                                        ? 'Send clock-out reminder'
                                                        : 'Available only for active sessions'
                                                }
                                            >
                                                <BellRing className="h-3.5 w-3.5" />
                                                {reminderSendingFor === member.userId ? 'Sending...' : 'Remind'}
                                            </button>

                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    router.push(`/team/${member.userId}`);
                                                }}
                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700 text-xs text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors"
                                            >
                                                View
                                                <ArrowRight className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="text-xs text-zinc-500 flex items-center gap-2">
                <AlertCircle className="h-3.5 w-3.5" />
                Use "Remind" to email active team members and prompt them to clock out.
            </div>
        </div>
    );
}
