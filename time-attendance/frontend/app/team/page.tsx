'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { attendanceApi } from '@/lib/api';
import { formatDuration, cn } from '@/lib/utils';
import { getApiErrorMessage } from '@/lib/apiError';
import {
    Users,
    Search,
    ChevronDown,
    Building2,
    MapPin,
    Clock3,
    ArrowRight,
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

type TeamSummary = {
    total: number;
    working: number;
    onBreak: number;
    clockedOut: number;
    notClockedIn?: number;
    onLeave?: number;
    leaveConflicts?: number;
};

type TeamStatusFilter = 'all' | TeamMember['status'];

const EMPTY_SUMMARY: TeamSummary = {
    total: 0,
    working: 0,
    onBreak: 0,
    clockedOut: 0,
    notClockedIn: 0,
    onLeave: 0,
    leaveConflicts: 0,
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
                member.status === 'on_leave' ? 'on leave approved leave' : null,
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

    const formatLeaveRange = (leave?: TeamMember['leave']) => {
        if (!leave?.startAt || !leave?.endAt) return 'Approved leave';
        const start = new Date(leave.startAt);
        const end = new Date(leave.endAt);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 'Approved leave';
        if (format(start, 'yyyy-MM-dd') === format(end, 'yyyy-MM-dd')) return format(start, 'MMM d');
        return `${format(start, 'MMM d')}–${format(end, 'MMM d')}`;
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
                text: getApiErrorMessage(error, 'Failed to send clock-out reminder.'),
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
                text: getApiErrorMessage(error, 'Failed to export team attendance.'),
            });
        } finally {
            setExporting(false);
        }
    };

    const getStatusStyles = (status: TeamMember['status']) => {
        switch (status) {
            case 'working':
                return 'border-emerald-600/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
            case 'on_break':
                return 'border-amber-600/25 bg-amber-500/10 text-amber-700 dark:text-amber-300';
            case 'on_leave':
                return 'border-teal-600/25 bg-teal-500/10 text-teal-700 dark:text-teal-300';
            case 'clocked_out':
                return 'border-[var(--suite-line-strong)] bg-[var(--suite-surface-muted)] text-[var(--suite-muted)]';
            case 'not_clocked_in':
            default:
                return 'border-[var(--suite-line)] bg-transparent text-[var(--suite-subtle)]';
        }
    };

    const getStatusLabel = (status: TeamMember['status']) => {
        switch (status) {
            case 'working':
                return 'Working';
            case 'on_break':
                return 'On Break';
            case 'on_leave':
                return 'On Leave';
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
            <div className="rounded-xl border border-[var(--suite-line)] bg-[var(--suite-surface)] p-8 text-[var(--suite-muted)]">
                <h1 className="mb-2 text-xl font-semibold text-[var(--suite-ink)]">Team Attendance</h1>
                <p>You need line manager, team lead, or admin access to view team attendance.</p>
            </div>
        );
    }

    return (
        <div className="space-y-5 animate-in fade-in duration-300" onClick={() => setIsTeamMenuOpen(false)}>
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
                <div className="max-w-xl">
                    <h1 className="text-2xl font-semibold tracking-[-0.025em] text-[var(--suite-ink)]">Team Attendance</h1>
                    <p className="mt-1 text-sm text-[var(--suite-muted)]">See who is working, where they clocked in, and when they were last active.</p>
                    {lastUpdatedAt && (
                        <p className="mt-1.5 text-xs text-[var(--suite-subtle)]">Updated {format(lastUpdatedAt, 'MMM d, h:mm:ss a')}</p>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                    {managedTeams.length > 0 && (
                        <div className="relative">
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setIsTeamMenuOpen((prev) => !prev);
                                }}
                                aria-expanded={isTeamMenuOpen}
                                className="flex h-9 items-center gap-2 rounded-lg border border-[var(--suite-line-strong)] bg-[var(--suite-surface)] px-3 text-sm font-medium text-[var(--suite-ink)] transition-colors hover:bg-[var(--suite-surface-muted)]"
                            >
                                <Building2 className="h-4 w-4 text-[var(--suite-subtle)]" />
                                <span className="max-w-48 truncate">{getSelectedTeamName()}</span>
                                <ChevronDown className={cn('h-4 w-4 text-[var(--suite-subtle)] transition-transform', isTeamMenuOpen && 'rotate-180')} />
                            </button>

                            {isTeamMenuOpen && (
                                <div className="absolute right-0 top-full z-50 mt-2 w-60 rounded-lg border border-[var(--suite-line)] bg-[var(--suite-surface)] py-1 shadow-[var(--suite-shadow)]">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSelectedTeamId('');
                                            setIsTeamMenuOpen(false);
                                        }}
                                        className={cn(
                                            'w-full px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--suite-surface-muted)]',
                                            !selectedTeamId ? 'font-medium text-teal-700 dark:text-teal-300' : 'text-[var(--suite-muted)]'
                                        )}
                                    >
                                        All Managed Teams
                                    </button>
                                    {managedTeams.map((team: any) => (
                                        <button
                                            key={team.id}
                                            type="button"
                                            onClick={() => {
                                                setSelectedTeamId(team.id);
                                                setIsTeamMenuOpen(false);
                                            }}
                                            className={cn(
                                                'w-full px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--suite-surface-muted)]',
                                                selectedTeamId === team.id ? 'font-medium text-teal-700 dark:text-teal-300' : 'text-[var(--suite-muted)]'
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
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            fetchTeamStatus();
                        }}
                        disabled={loading}
                        className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--suite-line-strong)] px-3 text-sm text-[var(--suite-muted)] transition-colors hover:bg-[var(--suite-surface-muted)] hover:text-[var(--suite-ink)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                        Refresh
                    </button>
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            exportTeamAttendanceExcel();
                        }}
                        disabled={loading || exporting}
                        className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--suite-line-strong)] px-3 text-sm text-[var(--suite-muted)] transition-colors hover:bg-[var(--suite-surface-muted)] hover:text-[var(--suite-ink)] disabled:cursor-not-allowed disabled:opacity-60"
                        title="Export current team table to Excel"
                    >
                        <Download className="h-4 w-4" />
                        {exporting ? 'Exporting...' : 'Export Excel'}
                    </button>
                </div>
            </div>

            {actionFeedback && (
                <div
                    className={cn(
                        'rounded-lg border px-3 py-2 text-sm',
                        actionFeedback.type === 'success'
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
                            : 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200'
                    )}
                >
                    {actionFeedback.text}
                </div>
            )}

            <div className="overflow-hidden rounded-xl border border-[var(--suite-line)] bg-[var(--suite-surface)] shadow-[var(--suite-shadow)]">
                <div className="flex flex-col gap-3 border-b border-[var(--suite-line)] px-4 pt-3 lg:flex-row lg:items-end lg:justify-between">
                    <div className="relative w-full pb-3 lg:max-w-sm">
                        <Search className="absolute left-3 top-[18px] h-4 w-4 -translate-y-1/2 text-[var(--suite-subtle)]" />
                        <input
                            type="search"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="Search people or teams"
                            className="h-9 w-full rounded-lg border border-[var(--suite-line-strong)] bg-transparent pl-9 pr-3 text-sm text-[var(--suite-ink)] placeholder:text-[var(--suite-subtle)] focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-500/15"
                        />
                    </div>
                    <div className="flex min-w-0 overflow-x-auto" role="tablist" aria-label="Filter team attendance by status">
                        {[
                            { key: 'all', label: 'All', count: summary.total },
                            { key: 'working', label: 'Working', count: summary.working },
                            { key: 'on_break', label: 'On break', count: summary.onBreak },
                            { key: 'on_leave', label: 'On leave', count: summary.onLeave || 0 },
                            { key: 'clocked_out', label: 'Clocked out', count: clockedOutOnlyCount },
                            { key: 'not_clocked_in', label: 'Not clocked in', count: notClockedInCount },
                        ].map((filterItem) => {
                            const isActive = statusFilter === filterItem.key;
                            return (
                                <button
                                    key={filterItem.key}
                                    type="button"
                                    role="tab"
                                    aria-selected={isActive}
                                    onClick={() => setStatusFilter(filterItem.key as TeamStatusFilter)}
                                    className={cn(
                                        'flex h-11 shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm transition-colors',
                                        isActive
                                            ? 'border-teal-600 font-medium text-[var(--suite-ink)]'
                                            : 'border-transparent text-[var(--suite-muted)] hover:text-[var(--suite-ink)]'
                                    )}
                                >
                                    {filterItem.label}
                                    <span className="text-xs tabular-nums text-[var(--suite-subtle)]">{filterItem.count}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="overflow-x-auto" data-testid="team-table-scroll">
                    <table className="w-full min-w-[1275px] table-fixed">
                        <colgroup>
                            <col className="w-[230px]" />
                            <col className="w-[110px]" />
                            <col className="w-[125px]" />
                            <col className="w-[150px]" />
                            <col className="w-[275px]" />
                            <col className="w-[100px]" />
                            <col className="w-[145px]" />
                            <col className="w-[140px]" />
                        </colgroup>
                        <thead className="border-b border-[var(--suite-line)] bg-[var(--suite-surface-muted)]">
                            <tr className="text-left text-xs text-[var(--suite-muted)]">
                                <th className="px-4 py-3 font-medium">Member</th>
                                <th className="px-4 py-3 font-medium">Team</th>
                                <th className="px-4 py-3 font-medium">Status</th>
                                <th className="px-4 py-3 font-medium">Today</th>
                                <th className="px-4 py-3 font-medium">Locations</th>
                                <th className="px-4 py-3 font-medium">Worked</th>
                                <th className="px-4 py-3 font-medium">Last activity</th>
                                <th className="px-4 py-3 text-right font-medium">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--suite-line)]">
                            {loading && Array.from({ length: 5 }).map((_, idx) => (
                                <tr key={idx} className="animate-pulse">
                                    {Array.from({ length: 8 }).map((__, cellIndex) => (
                                        <td key={cellIndex} className="px-4 py-5">
                                            <div className="h-4 w-4/5 rounded bg-[var(--suite-surface-muted)]" />
                                        </td>
                                    ))}
                                </tr>
                            ))}

                            {!loading && filteredTeamData.length === 0 && (
                                <tr>
                                    <td colSpan={8} className="px-4 py-14 text-center">
                                        <Users className="mx-auto mb-3 h-9 w-9 text-[var(--suite-subtle)]" />
                                        <p className="font-medium text-[var(--suite-ink)]">No team members found</p>
                                        <p className="mt-1 text-sm text-[var(--suite-muted)]">
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
                                        'cursor-pointer transition-colors hover:bg-[var(--suite-surface-muted)]',
                                        member.status === 'working' && 'bg-emerald-500/[0.025]',
                                        member.status === 'on_break' && 'bg-amber-500/[0.025]',
                                        member.status === 'on_leave' && 'bg-teal-500/[0.025]'
                                    )}
                                    onClick={() => router.push(`/team/${member.userId}`)}
                                >
                                    <td className="px-4 py-4">
                                        <div className="flex min-w-0 items-center gap-3">
                                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--suite-line)] bg-[var(--suite-surface-muted)] text-xs font-semibold text-[var(--suite-muted)]">
                                                {(member.userName || member.userEmail || member.userId).slice(0, 2).toUpperCase()}
                                            </div>
                                            <div className="min-w-0">
                                                <div className="truncate text-sm font-medium text-[var(--suite-ink)]">{member.userName}</div>
                                                <div className="truncate text-xs text-[var(--suite-subtle)]" title={member.userEmail || member.userId}>{member.userEmail || member.userId}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-4 text-sm text-[var(--suite-muted)]">
                                        <span className="block truncate" title={member.teamName || undefined}>{member.teamName || '--'}</span>
                                    </td>
                                    <td className="px-4 py-4">
                                        <div className="space-y-1">
                                            <span className={cn('inline-flex whitespace-nowrap rounded-md border px-2 py-1 text-xs font-medium', getStatusStyles(member.status))}>
                                                {getStatusLabel(member.status)}
                                            </span>
                                            {member.leaveConflict && <p className="text-[11px] text-amber-700 dark:text-amber-300">Leave conflict</p>}
                                        </div>
                                    </td>
                                    <td className="px-4 py-4 text-xs tabular-nums text-[var(--suite-muted)]">
                                        {member.status === 'on_leave' ? (
                                            <div>
                                                <span className="font-medium text-[var(--suite-ink)]">Approved leave</span>
                                                <span className="mt-1 block text-[var(--suite-subtle)]">{formatLeaveRange(member.leave)}</span>
                                            </div>
                                        ) : (
                                            <div className="grid grid-cols-[24px_1fr] gap-x-2 gap-y-1">
                                                <span className="text-[var(--suite-subtle)]">In</span>
                                                <span className="whitespace-nowrap">{formatTime(member.clockInAt)}</span>
                                                <span className="text-[var(--suite-subtle)]">Out</span>
                                                <span className="whitespace-nowrap">{formatTime(member.clockOutAt)}</span>
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-4 py-4 text-xs text-[var(--suite-muted)]">
                                        <div className="space-y-1.5">
                                            <div className="flex min-w-0 items-center gap-2">
                                                <MapPin className="h-3.5 w-3.5 shrink-0 text-[var(--suite-subtle)]" />
                                                <span className="w-5 shrink-0 text-[var(--suite-subtle)]">In</span>
                                                <span className="truncate" title={formatLocation(member.clockInLocation)}>{formatLocation(member.clockInLocation)}</span>
                                            </div>
                                            <div className="flex min-w-0 items-center gap-2">
                                                <MapPin className="h-3.5 w-3.5 shrink-0 text-[var(--suite-subtle)]" />
                                                <span className="w-5 shrink-0 text-[var(--suite-subtle)]">Out</span>
                                                <span className="truncate" title={formatLocation(member.clockOutLocation)}>{formatLocation(member.clockOutLocation)}</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-4 text-sm font-medium tabular-nums text-[var(--suite-ink)]">
                                        {formatDuration(member.workedMinutesToday || 0)}
                                    </td>
                                    <td className="px-4 py-4 text-xs text-[var(--suite-muted)]">
                                        <div className="flex items-center gap-1.5 whitespace-nowrap">
                                            <Clock3 className="h-3.5 w-3.5 shrink-0 text-[var(--suite-subtle)]" />
                                            <span>{formatTime(member.lastActivity, true)}</span>
                                        </div>
                                        {member.lastActivityType && (
                                            <div className="mt-1 pl-5 text-[11px] text-[var(--suite-subtle)]">
                                                {member.lastActivityType.replace('_', ' ')}
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-4 py-4">
                                        <div className="flex items-center justify-end gap-1.5">
                                            {canSendClockOutReminder(member) && (
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        sendClockOutReminder(member);
                                                    }}
                                                    disabled={reminderSendingFor === member.userId}
                                                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-amber-600/30 px-2.5 text-xs text-amber-700 transition-colors hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-60 dark:text-amber-300"
                                                    title="Send clock-out reminder"
                                                >
                                                    <BellRing className="h-3.5 w-3.5" />
                                                    {reminderSendingFor === member.userId ? 'Sending' : 'Remind'}
                                                </button>
                                            )}

                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    router.push(`/team/${member.userId}`);
                                                }}
                                                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--suite-line-strong)] px-2.5 text-xs text-[var(--suite-muted)] transition-colors hover:bg-[var(--suite-surface-muted)] hover:text-[var(--suite-ink)]"
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
        </div>
    );
}
