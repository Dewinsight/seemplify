'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import api, { handleAuthCallback, isAuthenticated } from '@/lib/api';
import Link from 'next/link';
import {
    Search,
    Users,
    Briefcase,
    DollarSign,
    ChevronRight,
    ArrowLeft,
    Loader2,
    UserPlus,
    AlertCircle,
    CheckCircle2,
    FolderOpen,
    X
} from 'lucide-react';

type IdpTeam = {
    id: string;
    name: string;
    description?: string;
    department?: { id?: string; name?: string } | null;
    memberCount?: number;
};

type IdpMember = {
    id: string;
    sub?: string;
    email?: string;
    name?: string;
    employeeId?: string;
    designation?: string;
    departmentId?: string;
    departmentName?: string;
    role?: string;
    teamId?: string;
    teamName?: string;
    team?: { id?: string; name?: string };
    teams?: Array<{ id?: string; name?: string; role?: string }>;
    teamIds?: string[];
    teamNames?: string[];
    onboardingStatus?: string;
    onboardingStatusSource?: string;
    onboardingLatestAssignmentId?: string | null;
};

type EmployeeRow = {
    userId: string;
    member?: IdpMember;
    profile?: any;
};

function getIdpBaseUrl(): string {
    return (process.env.NEXT_PUBLIC_IDP_URL || 'http://localhost:4000').replace(/\/$/, '');
}

function buildIdpWorkspaceUrl(organizationId: string, path: 'members' | 'onboarding'): string {
    const baseUrl = getIdpBaseUrl();
    if (!organizationId) return baseUrl;
    return `${baseUrl}/organizations/${organizationId}/${path}`;
}

function resolveTeamName(row: EmployeeRow): string {
    const profileTeam = String(row.profile?.employeeInfo?.teamName || '').trim();
    if (profileTeam && profileTeam.toLowerCase() !== 'unassigned') return profileTeam;

    const member = row.member;
    const directTeamName = String(member?.teamName || member?.team?.name || '').trim();
    if (directTeamName && directTeamName.toLowerCase() !== 'unassigned') return directTeamName;

    if (Array.isArray(member?.teamNames)) {
        const firstNamedTeam = member.teamNames.find((name) => String(name || '').trim());
        if (firstNamedTeam) return String(firstNamedTeam).trim();
    }

    if (Array.isArray(member?.teams)) {
        const firstNamedTeam = member.teams.find((team) => String(team?.name || '').trim());
        if (firstNamedTeam?.name) return String(firstNamedTeam.name).trim();
    }

    return 'Unassigned';
}

function resolveDepartmentName(row: EmployeeRow): string {
    const profileDepartment = String(row.profile?.employeeInfo?.department || '').trim();
    if (profileDepartment && profileDepartment.toLowerCase() !== 'unassigned') return profileDepartment;

    const memberDepartment = String(row.member?.departmentName || '').trim();
    if (memberDepartment) return memberDepartment;

    return 'Unassigned';
}

function resolveOnboardingStatus(row: EmployeeRow): string {
    const memberStatus = String(row.member?.onboardingStatus || '').trim().toLowerCase();
    if (memberStatus) return memberStatus;
    return row.profile ? 'completed' : 'not_started';
}

function formatOnboardingStatus(status: string): string {
    return String(status || 'not_started')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (value) => value.toUpperCase());
}

function isOnboardingComplete(row: EmployeeRow): boolean {
    return resolveOnboardingStatus(row) === 'completed';
}

function getEmployeeName(row: EmployeeRow): string {
    return row.profile?.employeeInfo?.name || row.member?.name || 'Unknown';
}

function getEmployeeEmail(row: EmployeeRow): string {
    return row.profile?.employeeInfo?.email || row.member?.email || '';
}

function resolveEmployeeId(row: EmployeeRow): string {
    return String(row.profile?.employeeInfo?.employeeId || row.member?.employeeId || '').trim();
}

function getMemberAccountId(row: EmployeeRow): string {
    return String(row.member?.id || row.member?.sub || row.userId || '').trim();
}

export default function EmployeesPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [loading, setLoading] = useState(true);
    const [employees, setEmployees] = useState<EmployeeRow[]>([]);
    const [idpOrganizationId, setIdpOrganizationId] = useState('');
    const [idpTeams, setIdpTeams] = useState<IdpTeam[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [teamFilter, setTeamFilter] = useState<string>('all');
    const [departmentFilter, setDepartmentFilter] = useState<string>('all');
    const [statusFilter, setStatusFilter] = useState<'all' | 'needs_setup' | 'configured'>(
        searchParams.get('setup') === 'pending' ? 'needs_setup' : 'all'
    );
    const [dismissedOnboardingUsers, setDismissedOnboardingUsers] = useState<string[]>([]);
    const [dismissedTeamUsers, setDismissedTeamUsers] = useState<string[]>([]);
    const [selectedTeamId, setSelectedTeamId] = useState('');
    const [teamAssignmentBusy, setTeamAssignmentBusy] = useState(false);
    const [onboardingActionBusy, setOnboardingActionBusy] = useState(false);

    useEffect(() => {
        if (searchParams.get('setup') === 'pending') {
            setStatusFilter('needs_setup');
        }
    }, [searchParams]);

    useEffect(() => {
        handleAuthCallback();

        if (!isAuthenticated()) {
            router.push('/login');
            return;
        }

        const fetchEmployees = async () => {
            try {
                const [idpResult, profilesResult, teamsResult] = await Promise.allSettled([
                    api.get('/payroll/idp/members'),
                    api.get('/payroll/profiles', { params: { limit: 1000 } }),
                    api.get('/payroll/idp/teams'),
                ]);

                if (idpResult.status !== 'fulfilled') {
                    throw idpResult.reason;
                }

                if (profilesResult.status !== 'fulfilled') {
                    throw profilesResult.reason;
                }

                const members: IdpMember[] = Array.isArray(idpResult.value.data?.members) ? idpResult.value.data.members : [];
                const profiles: any[] = Array.isArray(profilesResult.value.data?.profiles) ? profilesResult.value.data.profiles : [];

                const teamsPayload = teamsResult.status === 'fulfilled' ? teamsResult.value.data : null;
                const teams: IdpTeam[] = Array.isArray(teamsPayload?.teams) ? teamsPayload.teams : [];

                const profileByUserId = new Map<string, any>();
                profiles.forEach((profile) => {
                    if (profile?.userId) profileByUserId.set(String(profile.userId), profile);
                });

                const rows: EmployeeRow[] = members
                    .map((member) => {
                        const userId = String(member?.sub || member?.id || '').trim();
                        return {
                            userId,
                            member,
                            profile: userId ? profileByUserId.get(userId) : undefined,
                        };
                    })
                    .filter((row) => !!row.userId);

                const seen = new Set(rows.map((row) => row.userId));
                profiles.forEach((profile) => {
                    const userId = String(profile?.userId || '').trim();
                    if (userId && !seen.has(userId)) {
                        rows.push({ userId, profile });
                        seen.add(userId);
                    }
                });

                setEmployees(rows);
                setIdpOrganizationId(String(idpResult.value.data?.organizationId || teamsPayload?.organizationId || '').trim());
                setIdpTeams(
                    teams
                        .map((team) => ({
                            ...team,
                            id: String(team.id || '').trim(),
                            name: String(team.name || '').trim(),
                            department: team.department ? {
                                id: String(team.department.id || '').trim(),
                                name: String(team.department.name || '').trim(),
                            } : null,
                        }))
                        .filter((team) => !!team.id && !!team.name)
                );
            } catch (error) {
                console.error('Failed to fetch employees:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchEmployees();
    }, [router]);

    const onboardingWorkspaceUrl = useMemo(
        () => buildIdpWorkspaceUrl(idpOrganizationId, 'onboarding'),
        [idpOrganizationId]
    );

    const peopleStructureUrl = useMemo(
        () => buildIdpWorkspaceUrl(idpOrganizationId, 'members'),
        [idpOrganizationId]
    );

    const availableTeams = useMemo(() => {
        const values = new Set<string>();
        employees.forEach((row) => values.add(resolveTeamName(row)));
        return Array.from(values).sort((left, right) => left.localeCompare(right));
    }, [employees]);

    const availableDepartments = useMemo(() => {
        const values = new Set<string>();
        employees.forEach((row) => values.add(resolveDepartmentName(row)));
        return Array.from(values).sort((left, right) => left.localeCompare(right));
    }, [employees]);

    const filteredEmployees = useMemo(() => {
        return employees.filter((row) => {
            const profile = row.profile;
            const member = row.member;
            const teamName = resolveTeamName(row);
            const departmentName = resolveDepartmentName(row);
            const onboardingComplete = isOnboardingComplete(row);

            const needsPayrollProfile = !profile;
            const needsSetup = !needsPayrollProfile && (!profile?.basicSalary || Number(profile.basicSalary) === 0);

            const name = String(profile?.employeeInfo?.name || member?.name || '').toLowerCase();
            const email = String(profile?.employeeInfo?.email || member?.email || '').toLowerCase();
            const employeeId = resolveEmployeeId(row).toLowerCase();
            const department = String(departmentName || '').toLowerCase();
            const designation = String(profile?.employeeInfo?.designation || member?.designation || '').toLowerCase();
            const team = String(teamName || '').toLowerCase();

            const query = searchQuery.toLowerCase().trim();
            const searchMatch = !query ||
                name.includes(query) ||
                email.includes(query) ||
                employeeId.includes(query) ||
                department.includes(query) ||
                designation.includes(query) ||
                team.includes(query);

            const teamMatch = teamFilter === 'all' || teamName === teamFilter;
            const departmentMatch = departmentFilter === 'all' || departmentName === departmentFilter;

            let statusMatch = true;
            if (statusFilter === 'needs_setup') {
                statusMatch = !onboardingComplete || needsPayrollProfile || needsSetup;
            } else if (statusFilter === 'configured') {
                statusMatch = onboardingComplete && !needsPayrollProfile && !needsSetup;
            }

            return searchMatch && teamMatch && departmentMatch && statusMatch;
        });
    }, [departmentFilter, employees, searchQuery, statusFilter, teamFilter]);

    const onboardingQueue = useMemo(() => {
        return employees.filter((row) => {
            if (!row.member) return false;
            if (dismissedOnboardingUsers.includes(row.userId)) return false;
            return !isOnboardingComplete(row);
        });
    }, [dismissedOnboardingUsers, employees]);

    const teamAssignmentQueue = useMemo(() => {
        return employees.filter((row) => {
            if (!row.member) return false;
            if (dismissedTeamUsers.includes(row.userId)) return false;
            return isOnboardingComplete(row) && resolveTeamName(row) === 'Unassigned';
        });
    }, [dismissedTeamUsers, employees]);

    const activeOnboardingRow = onboardingQueue[0] || null;
    const activeTeamAssignmentRow = activeOnboardingRow ? null : (teamAssignmentQueue[0] || null);

    useEffect(() => {
        if (!activeTeamAssignmentRow) {
            setSelectedTeamId('');
            return;
        }

        if (!selectedTeamId || !idpTeams.some((team) => team.id === selectedTeamId)) {
            setSelectedTeamId(idpTeams[0]?.id || '');
        }
    }, [activeTeamAssignmentRow, idpTeams, selectedTeamId]);

    const updateEmployeeRow = (userId: string, updater: (row: EmployeeRow) => EmployeeRow) => {
        setEmployees((current) => current.map((row) => (
            row.userId === userId ? updater(row) : row
        )));
    };

    const dismissActiveOnboarding = () => {
        if (!activeOnboardingRow) return;
        setDismissedOnboardingUsers((current) => Array.from(new Set([...current, activeOnboardingRow.userId])));
    };

    const dismissActiveTeamAssignment = () => {
        if (!activeTeamAssignmentRow) return;
        setDismissedTeamUsers((current) => Array.from(new Set([...current, activeTeamAssignmentRow.userId])));
    };

    const handleAssignTeam = async () => {
        if (!activeTeamAssignmentRow || !selectedTeamId) return;

        const memberId = getMemberAccountId(activeTeamAssignmentRow);
        const selectedTeam = idpTeams.find((team) => team.id === selectedTeamId) || null;
        if (!memberId || !selectedTeam) return;

        setTeamAssignmentBusy(true);
        try {
            await api.post(`/payroll/idp/teams/${selectedTeamId}/members`, {
                accountId: memberId,
                role: 'member',
            });

            updateEmployeeRow(activeTeamAssignmentRow.userId, (row) => ({
                ...row,
                member: row.member ? {
                    ...row.member,
                    teamId: selectedTeam.id,
                    teamName: selectedTeam.name,
                    team: { id: selectedTeam.id, name: selectedTeam.name },
                    teamIds: [selectedTeam.id],
                    teamNames: [selectedTeam.name],
                    departmentId: selectedTeam.department?.id || row.member.departmentId,
                    departmentName: selectedTeam.department?.name || row.member.departmentName,
                } : row.member,
                profile: row.profile ? {
                    ...row.profile,
                    employeeInfo: {
                        ...(row.profile.employeeInfo || {}),
                        teamId: selectedTeam.id,
                        teamName: selectedTeam.name,
                        department: selectedTeam.department?.name || row.profile.employeeInfo?.department || row.member?.departmentName || '',
                    }
                } : row.profile
            }));
        } catch (error: any) {
            alert(error?.response?.data?.error || error?.message || 'Failed to assign member to team');
        } finally {
            setTeamAssignmentBusy(false);
        }
    };

    const handleSendOnboarding = async () => {
        if (!activeOnboardingRow || !activeOnboardingRow.member) return;

        const memberId = getMemberAccountId(activeOnboardingRow);
        if (!memberId) return;

        setOnboardingActionBusy(true);
        try {
            await api.post('/payroll/idp/onboarding/assign', { memberId });

            updateEmployeeRow(activeOnboardingRow.userId, (row) => ({
                ...row,
                member: row.member ? {
                    ...row.member,
                    onboardingStatus: 'pending',
                    onboardingStatusSource: 'assignment',
                } : row.member
            }));
        } catch (error: any) {
            alert(error?.response?.data?.error || error?.message || 'Failed to assign onboarding');
        } finally {
            setOnboardingActionBusy(false);
        }
    };

    const handleMarkOnboarded = async () => {
        if (!activeOnboardingRow || !activeOnboardingRow.member) return;

        const memberId = getMemberAccountId(activeOnboardingRow);
        if (!memberId) return;

        setOnboardingActionBusy(true);
        try {
            await api.patch(`/payroll/idp/onboarding/members/${memberId}/status`, {
                status: 'completed'
            });

            updateEmployeeRow(activeOnboardingRow.userId, (row) => ({
                ...row,
                member: row.member ? {
                    ...row.member,
                    onboardingStatus: 'completed',
                    onboardingStatusSource: 'manual',
                } : row.member
            }));
        } catch (error: any) {
            alert(error?.response?.data?.error || error?.message || 'Failed to mark employee as onboarded');
        } finally {
            setOnboardingActionBusy(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-zinc-950 text-zinc-200 p-8 pb-20">
            {activeOnboardingRow && (
                <div className="fixed inset-0 z-50 bg-zinc-950/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="w-full max-w-2xl rounded-3xl border border-amber-500/20 bg-zinc-900/95 shadow-2xl shadow-black/40">
                        <div className="flex items-start justify-between gap-4 border-b border-zinc-800/80 px-6 py-5">
                            <div>
                                <div className="flex flex-wrap items-center gap-2 mb-2">
                                    <span className="inline-flex items-center rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300">
                                        Member 1 of {onboardingQueue.length}
                                    </span>
                                    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${
                                        isOnboardingComplete(activeOnboardingRow)
                                            ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                                            : 'border-orange-500/20 bg-orange-500/10 text-orange-300'
                                    }`}>
                                        {formatOnboardingStatus(resolveOnboardingStatus(activeOnboardingRow))}
                                    </span>
                                </div>
                                <h2 className="text-xl font-semibold text-white">Resolve onboarding before payroll setup</h2>
                                <p className="mt-1 text-sm text-zinc-400">
                                    {getEmployeeName(activeOnboardingRow)} {getEmployeeEmail(activeOnboardingRow) ? `(${getEmployeeEmail(activeOnboardingRow)})` : ''}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={dismissActiveOnboarding}
                                className="rounded-full border border-zinc-700 p-2 text-zinc-400 transition hover:border-zinc-500 hover:text-white"
                                aria-label="Close onboarding prompt"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="px-6 py-5">
                            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
                                <p className="mb-2 text-sm font-medium text-zinc-200">
                                    {getEmployeeName(activeOnboardingRow)}{resolveEmployeeId(activeOnboardingRow) ? ` • ${resolveEmployeeId(activeOnboardingRow)}` : ''}{getEmployeeEmail(activeOnboardingRow) ? ` • ${getEmployeeEmail(activeOnboardingRow)}` : ''}
                                </p>
                                <p className="text-sm text-zinc-300">
                                    This employee is available in payroll but is not fully onboarded yet. Send them into the document workspace onboarding flow, or mark them as onboarded if HR already completed that process manually.
                                </p>
                            </div>
                            <div className="mt-5 grid gap-3 sm:grid-cols-2">
                                <button
                                    type="button"
                                    onClick={handleSendOnboarding}
                                    disabled={onboardingActionBusy}
                                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/15 px-4 py-3 text-sm font-medium text-amber-300 transition hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {onboardingActionBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
                                    Send Onboarding
                                </button>
                                <button
                                    type="button"
                                    onClick={handleMarkOnboarded}
                                    disabled={onboardingActionBusy}
                                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/15 px-4 py-3 text-sm font-medium text-emerald-300 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {onboardingActionBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                                    Mark As Onboarded
                                </button>
                                <a
                                    href={`${onboardingWorkspaceUrl}?workflow=onboarding`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm font-medium text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-900"
                                >
                                    <FolderOpen className="h-4 w-4" />
                                    Open Document Workspace
                                </a>
                                <button
                                    type="button"
                                    onClick={dismissActiveOnboarding}
                                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm font-medium text-zinc-300 transition hover:border-zinc-500 hover:text-white"
                                >
                                    Skip For Now
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {!activeOnboardingRow && activeTeamAssignmentRow && (
                <div className="fixed inset-0 z-50 bg-zinc-950/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="w-full max-w-2xl rounded-3xl border border-emerald-500/20 bg-zinc-900/95 shadow-2xl shadow-black/40">
                        <div className="flex items-start justify-between gap-4 border-b border-zinc-800/80 px-6 py-5">
                            <div>
                                <div className="flex flex-wrap items-center gap-2 mb-2">
                                    <span className="inline-flex items-center rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300">
                                        Member 1 of {teamAssignmentQueue.length}
                                    </span>
                                    <span className="inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
                                        Onboarding completed
                                    </span>
                                </div>
                                <h2 className="text-xl font-semibold text-white">Assign employee to a team</h2>
                                <p className="mt-1 text-sm text-zinc-400">
                                    {getEmployeeName(activeTeamAssignmentRow)}
                                    {resolveEmployeeId(activeTeamAssignmentRow) ? ` • ${resolveEmployeeId(activeTeamAssignmentRow)}` : ''}
                                    {getEmployeeEmail(activeTeamAssignmentRow) ? ` • ${getEmployeeEmail(activeTeamAssignmentRow)}` : ''}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={dismissActiveTeamAssignment}
                                className="rounded-full border border-zinc-700 p-2 text-zinc-400 transition hover:border-zinc-500 hover:text-white"
                                aria-label="Close team assignment prompt"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="px-6 py-5">
                            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4">
                                <p className="text-sm text-zinc-300">
                                    This employee has finished onboarding but is still unassigned in payroll. Pick their team so payroll inherits the correct team and department structure from IDP.
                                </p>
                            </div>
                            <div className="mt-5">
                                <label htmlFor="team-assignment-select" className="mb-2 block text-sm font-medium text-zinc-300">
                                    Team
                                </label>
                                <select
                                    id="team-assignment-select"
                                    value={selectedTeamId}
                                    onChange={(event) => setSelectedTeamId(event.target.value)}
                                    className="w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-zinc-200 outline-none transition focus:border-amber-500/50"
                                >
                                    {!idpTeams.length && <option value="">No teams available</option>}
                                    {idpTeams.map((team) => (
                                        <option key={team.id} value={team.id}>
                                            {team.name}{team.department?.name ? ` - ${team.department.name}` : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="mt-5 grid gap-3 sm:grid-cols-3">
                                <button
                                    type="button"
                                    onClick={handleAssignTeam}
                                    disabled={teamAssignmentBusy || !selectedTeamId}
                                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/15 px-4 py-3 text-sm font-medium text-emerald-300 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {teamAssignmentBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
                                    Assign To Team
                                </button>
                                <a
                                    href={peopleStructureUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm font-medium text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-900"
                                >
                                    <FolderOpen className="h-4 w-4" />
                                    Open People & Structure
                                </a>
                                <button
                                    type="button"
                                    onClick={dismissActiveTeamAssignment}
                                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm font-medium text-zinc-300 transition hover:border-zinc-500 hover:text-white"
                                >
                                    Skip For Now
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className="max-w-6xl mx-auto mb-8">
                <Link
                    href="/dashboard"
                    className="inline-flex items-center text-sm text-zinc-400 hover:text-amber-400 mb-2 transition-colors"
                >
                    <ArrowLeft className="w-4 h-4 mr-1" />
                    Back to Dashboard
                </Link>
                <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                    <div>
                        <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
                            Employee Management
                        </h1>
                        <p className="text-zinc-500 mt-1">
                            Manage payroll profiles, team readiness, and onboarding blockers
                        </p>
                    </div>
                    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-1.5 flex items-center gap-2">
                        <div className="px-3 py-1.5 bg-zinc-800 rounded text-xs font-medium text-zinc-300">
                            Total: {employees.length}
                        </div>
                        <div className="px-3 py-1.5 rounded text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20">
                            Active: {employees.filter((employee) => employee.profile?.isActive !== false).length}
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-6xl mx-auto mb-6 flex flex-col gap-4 md:flex-row">
                <div className="flex-1 relative">
                    <Search className="absolute left-3 top-2.5 w-5 h-5 text-zinc-500" />
                    <input
                        type="text"
                        placeholder="Search by name, email, employee ID, department, designation, or team..."
                        className="w-full bg-zinc-900 border border-zinc-700/50 rounded-xl pl-10 pr-4 py-2.5 text-zinc-200 focus:outline-none focus:border-amber-500/50 transition-all placeholder:text-zinc-600"
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                    />
                </div>
                <select
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value as 'all' | 'needs_setup' | 'configured')}
                    className="px-3 py-2.5 bg-zinc-900 border border-zinc-700/50 rounded-xl text-zinc-300 focus:outline-none focus:border-amber-500/50"
                >
                    <option value="all">All Statuses</option>
                    <option value="needs_setup">Needs Setup</option>
                    <option value="configured">Configured</option>
                </select>
                <select
                    value={departmentFilter}
                    onChange={(event) => setDepartmentFilter(event.target.value)}
                    className="px-3 py-2.5 bg-zinc-900 border border-zinc-700/50 rounded-xl text-zinc-300 focus:outline-none focus:border-amber-500/50"
                >
                    <option value="all">All Departments</option>
                    {availableDepartments.map((department) => (
                        <option key={department} value={department}>
                            {department}
                        </option>
                    ))}
                </select>
                <select
                    value={teamFilter}
                    onChange={(event) => setTeamFilter(event.target.value)}
                    className="px-3 py-2.5 bg-zinc-900 border border-zinc-700/50 rounded-xl text-zinc-300 focus:outline-none focus:border-amber-500/50"
                >
                    <option value="all">All Teams</option>
                    {availableTeams.map((team) => (
                        <option key={team} value={team}>
                            {team}
                        </option>
                    ))}
                </select>
            </div>

            <div className="max-w-6xl mx-auto grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {filteredEmployees.map((row) => {
                    const employee = row.profile;
                    const member = row.member;
                    const hasProfile = !!employee;
                    const onboardingStatus = resolveOnboardingStatus(row);
                    const onboardingComplete = onboardingStatus === 'completed';
                    const needsPayrollProfile = !hasProfile;
                    const needsSetup = hasProfile && (!employee?.basicSalary || Number(employee.basicSalary) === 0);
                    const teamName = resolveTeamName(row);
                    const departmentName = resolveDepartmentName(row);
                    const employeeId = resolveEmployeeId(row);
                    const currency = employee?.currency || 'USD';
                    const totalAllowances = Number(employee?.totalAllowances || 0);
                    const grossMonthlySalary = Number(employee?.grossMonthlySalary || (Number(employee?.basicSalary || 0) + totalAllowances));
                    const holdPayment = !!employee?.payrollFlags?.holdPayment;

                    return (
                        <div
                            key={row.userId}
                            className="group bg-zinc-900/50 border border-zinc-800/50 rounded-xl p-5 hover:bg-zinc-900 hover:border-amber-500/30 transition-all"
                        >
                            <div className="flex items-start justify-between gap-4 mb-4">
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="w-10 h-10 shrink-0 rounded-full bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center border border-amber-500/20 group-hover:border-amber-500/40">
                                        <span className="font-semibold text-amber-500">
                                            {String(getEmployeeName(row)).charAt(0) || 'U'}
                                        </span>
                                    </div>
                                    <div className="min-w-0">
                                        <h3 className="font-semibold text-zinc-200 truncate group-hover:text-amber-400 transition-colors">
                                            {getEmployeeName(row)}
                                        </h3>
                                        <p className="text-xs text-zinc-500 truncate">
                                            {employee?.employeeInfo?.designation || member?.designation || 'No Designation'}
                                            {employeeId ? ` • ${employeeId}` : ''}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex flex-col items-end gap-2">
                                    {!onboardingComplete && (
                                        <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/20">
                                            <AlertCircle className="w-3 h-3" />
                                            {formatOnboardingStatus(onboardingStatus)}
                                        </span>
                                    )}
                                    {onboardingComplete && needsPayrollProfile && (
                                        <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20">
                                            <UserPlus className="w-3 h-3" />
                                            Payroll Profile Needed
                                        </span>
                                    )}
                                    {onboardingComplete && !needsPayrollProfile && needsSetup && (
                                        <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/20">
                                            <AlertCircle className="w-3 h-3" />
                                            Needs Setup
                                        </span>
                                    )}
                                    {holdPayment && (
                                        <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
                                            Hold Payment
                                        </span>
                                    )}
                                </div>
                            </div>

                            <div className="space-y-2.5">
                                <div className="flex items-center justify-between gap-3 text-sm">
                                    <span className="text-zinc-500">Employee ID</span>
                                    <span className="text-zinc-300 text-right">{employeeId || '--'}</span>
                                </div>

                                <div className="flex items-center justify-between gap-3 text-sm">
                                    <span className="text-zinc-500 flex items-center gap-1.5">
                                        <Briefcase className="w-3.5 h-3.5" /> Department
                                    </span>
                                    <span className="text-zinc-300 text-right">{departmentName}</span>
                                </div>

                                <div className="flex items-center justify-between gap-3 text-sm">
                                    <span className="text-zinc-500 flex items-center gap-1.5">
                                        <Users className="w-3.5 h-3.5" /> Team
                                    </span>
                                    <span className="text-zinc-300 text-right">{teamName}</span>
                                </div>

                                <div className="flex items-center justify-between gap-3 text-sm">
                                    <span className="text-zinc-500 flex items-center gap-1.5">
                                        <AlertCircle className="w-3.5 h-3.5" /> Onboarding
                                    </span>
                                    <span className={`text-right ${onboardingComplete ? 'text-emerald-400' : 'text-orange-400'}`}>
                                        {formatOnboardingStatus(onboardingStatus)}
                                    </span>
                                </div>

                                <div className="flex items-center justify-between gap-3 text-sm">
                                    <span className="text-zinc-500 flex items-center gap-1.5">
                                        <DollarSign className="w-3.5 h-3.5" /> Basic Salary
                                    </span>
                                    <span className={`font-mono font-medium text-right ${needsPayrollProfile || needsSetup ? 'text-zinc-500' : 'text-emerald-400'}`}>
                                        {needsPayrollProfile || needsSetup
                                            ? 'Not Set'
                                            : `${currency} ${Number(employee?.basicSalary || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                                    </span>
                                </div>

                                {hasProfile && !needsSetup && (
                                    <div className="flex items-center justify-between gap-3 text-sm">
                                        <span className="text-zinc-500 flex items-center gap-1.5">
                                            <DollarSign className="w-3.5 h-3.5" /> Gross Monthly
                                        </span>
                                        <span className="font-mono font-medium text-zinc-200 text-right">
                                            {currency} {grossMonthlySalary.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </span>
                                    </div>
                                )}

                                <div className="pt-3 mt-3 border-t border-zinc-800/50 flex items-center justify-between gap-3">
                                    <span className={`text-xs px-2 py-0.5 rounded-full border ${
                                        employee?.isActive !== false
                                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                            : 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
                                    }`}>
                                        {employee?.isActive !== false ? 'Active' : 'Inactive'}
                                    </span>
                                    {!onboardingComplete ? (
                                        <a
                                            href={`${onboardingWorkspaceUrl}?workflow=onboarding`}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 transition-colors"
                                        >
                                            Resolve
                                            <ChevronRight className="w-3.5 h-3.5" />
                                        </a>
                                    ) : needsPayrollProfile ? (
                                        <Link
                                            href={`/admin/employees/onboard/${row.userId}`}
                                            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 transition-colors"
                                        >
                                            <UserPlus className="w-3.5 h-3.5" />
                                            Setup Payroll
                                        </Link>
                                    ) : (
                                        <Link
                                            href={`/admin/employees/${row.userId}`}
                                            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
                                        >
                                            {needsSetup ? 'Setup' : 'View'}
                                            <ChevronRight className="w-3.5 h-3.5" />
                                        </Link>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}

                {filteredEmployees.length === 0 && (
                    <div className="col-span-full text-center py-12 text-zinc-500 bg-zinc-900/40 border border-zinc-800 rounded-xl">
                        No employees match your current filters.
                    </div>
                )}
            </div>
        </div>
    );
}
