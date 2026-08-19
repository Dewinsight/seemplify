'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import api, { authApi, handleAuthCallback } from '@/lib/api';
import { formatPayrollMoney } from '@/lib/payrollMoney';
import { resolveIdpUrl } from '@/lib/runtimeConfig';
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
    peopleTransition?: {
        subjectId: string;
        status: string;
        processType?: string | null;
        transitionId?: string | null;
        activeTransitionCount?: number;
        pendingTaskCount?: number;
        dueAt?: string | null;
        deepLink?: string;
    } | null;
};

type EmployeeRow = {
    userId: string;
    member?: IdpMember;
    profile?: any;
};

type EmployeeIssue = 'onboarding' | 'profile' | 'setup' | null;
const AUTO_EXCLUSION_REASONS = [
    'Automatically excluded from payroll until onboarding is completed.',
    'Automatically excluded from payroll until a payroll profile is created.',
    'Automatically excluded from payroll until payroll configuration is prepared.',
    'Automatically excluded from payroll until payroll setup is completed.',
];
const AUTOMATIC_PAYROLL_SETUP_PREFIX = 'Automatic payroll setup:';
const MANUAL_PAYROLL_EXCLUSION_REASON = 'Excluded from payroll run by payroll admin.';

function getIdpBaseUrl(): string {
    return resolveIdpUrl();
}

function buildIdpWorkspaceUrl(organizationId: string, path: 'members'): string {
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
    const transition = row.member?.peopleTransition;
    if (transition?.processType === 'onboarding' && transition.status) {
        return String(transition.status).trim().toLowerCase();
    }
    return row.profile ? 'completed' : 'not_started';
}

function formatOnboardingStatus(status: string): string {
    return String(status || 'not_started')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (value) => value.toUpperCase());
}

function isOnboardingComplete(row: EmployeeRow): boolean {
    return ['completed', 'provisioned'].includes(resolveOnboardingStatus(row));
}

function hasActiveOnboardingTransition(row: EmployeeRow): boolean {
    const transition = row.member?.peopleTransition;
    return transition?.processType === 'onboarding'
        && !['completed', 'cancelled', 'provisioned', 'not_started'].includes(String(transition.status || '').toLowerCase());
}

function getPeopleTransitionUrl(row: EmployeeRow): string {
    return String(row.member?.peopleTransition?.deepLink || '').trim();
}

function getManualPayrollSetupUrl(row: EmployeeRow): string {
    return row.profile
        ? `/admin/employees/${row.userId}`
        : `/admin/employees/configure/${row.userId}`;
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

function needsPayrollProfile(row: EmployeeRow): boolean {
    return !row.profile;
}

function needsPayrollSetup(row: EmployeeRow): boolean {
    return !needsPayrollProfile(row) && (!row.profile?.basicSalary || Number(row.profile.basicSalary) === 0);
}

function getPrimaryEmployeeIssue(row: EmployeeRow): EmployeeIssue {
    if (!isOnboardingComplete(row)) return 'onboarding';
    if (needsPayrollProfile(row)) return 'profile';
    if (needsPayrollSetup(row)) return 'setup';
    return null;
}

function shouldForceExcludeFromPayroll(row: EmployeeRow): boolean {
    return getPrimaryEmployeeIssue(row) !== null;
}

function getResolveIssueLabel(row: EmployeeRow): string {
    const issue = getPrimaryEmployeeIssue(row);
    if (issue === 'onboarding') return 'Resolve Onboarding';
    if (issue === 'profile') return 'Configure Payroll';
    if (issue === 'setup') return 'Resolve Setup';
    return 'View';
}

function getAutoExclusionReason(row: EmployeeRow): string {
    const issue = getPrimaryEmployeeIssue(row);
    if (issue === 'onboarding') {
        return 'Automatically excluded from payroll until onboarding is completed.';
    }
    if (issue === 'profile') {
        return 'Automatically excluded from payroll until payroll configuration is prepared.';
    }
    if (issue === 'setup') {
        return 'Automatically excluded from payroll until payroll setup is completed.';
    }
    return '';
}

function isAutoExclusionReason(reason: string): boolean {
    return AUTO_EXCLUSION_REASONS.includes(String(reason || '').trim());
}

function isManuallyExcludedFromPayroll(row: EmployeeRow): boolean {
    const flags = row.profile?.payrollFlags || {};
    if (flags.excludeFromNextRun === true) return true;
    return flags.excludeFromNextRun === undefined
        && flags.includeInNextRun === false
        && String(flags.reviewReason || '').trim() === MANUAL_PAYROLL_EXCLUSION_REASON;
}

function getAutomaticPayrollExclusionReason(row: EmployeeRow): string {
    const flags = row.profile?.payrollFlags || {};
    const reason = String(flags.reviewReason || '').trim();
    if (flags.includeInNextRun === false
        && !isManuallyExcludedFromPayroll(row)
        && (flags.requiresReview === true
            || isAutoExclusionReason(reason)
            || reason.startsWith(AUTOMATIC_PAYROLL_SETUP_PREFIX))) {
        return reason || 'Complete the required payroll setup before including this employee.';
    }
    return '';
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
    const [excludeBusyUserId, setExcludeBusyUserId] = useState('');
    const [autoExcludingUsers, setAutoExcludingUsers] = useState<string[]>([]);
    const [autoIncludingUsers, setAutoIncludingUsers] = useState<string[]>([]);
    const [resolutionUserId, setResolutionUserId] = useState('');
    const [syncNotice, setSyncNotice] = useState('');
    const [pageError, setPageError] = useState('');

    useEffect(() => {
        if (searchParams.get('setup') === 'pending') {
            setStatusFilter('needs_setup');
        }
    }, [searchParams]);

    useEffect(() => {
        handleAuthCallback();

        const fetchEmployees = async () => {
            try {
                const me = await authApi.getMe();
                const currentOrgId = me.currentOrganizationId;
                const currentOrg =
                    me.user?.organizations?.find((organization: any) => organization.id === currentOrgId)
                    || me.user?.organizations?.[0];

                if (!currentOrg || !['owner', 'admin', 'hr_manager'].includes(currentOrg.role)) {
                    router.push('/dashboard');
                    return;
                }

                const [idpResult, profilesResult, teamsResult] = await Promise.allSettled([
                    api.get('/payroll/idp/members'),
                    api.get('/payroll/profiles', { params: { limit: 1000 } }),
                    api.get('/payroll/idp/teams'),
                ]);
                const notices: string[] = [];

                if (idpResult.status !== 'fulfilled' && profilesResult.status !== 'fulfilled') {
                    throw idpResult.reason || profilesResult.reason;
                }

                const idpPayload = idpResult.status === 'fulfilled' ? idpResult.value.data : null;
                const members: IdpMember[] = Array.isArray(idpPayload?.members) ? idpPayload.members : [];
                const profiles: any[] = profilesResult.status === 'fulfilled' && Array.isArray(profilesResult.value.data?.profiles)
                    ? profilesResult.value.data.profiles
                    : [];

                if (idpResult.status !== 'fulfilled') {
                    notices.push('Identity Provider member sync is unavailable right now. Showing existing payroll profiles only.');
                } else if (idpPayload?.syncAvailable === false) {
                    notices.push(String(idpPayload?.syncError || 'Identity Provider member sync is unavailable right now.'));
                }
                if (idpPayload?.transitionSyncAvailable === false) {
                    notices.push(String(idpPayload?.transitionSyncError || 'Recruiter People Transitions sync is unavailable right now.'));
                }

                if (profilesResult.status !== 'fulfilled') {
                    notices.push('Payroll profile sync is unavailable right now. Employees without a loaded payroll profile will appear as needing setup.');
                }

                const teamsPayload = teamsResult.status === 'fulfilled' ? teamsResult.value.data : null;
                const teams: IdpTeam[] = Array.isArray(teamsPayload?.teams) ? teamsPayload.teams : [];
                if (teamsResult.status !== 'fulfilled') {
                    notices.push('Team sync is unavailable right now. Team assignment actions may be limited.');
                } else if (teamsPayload?.syncAvailable === false) {
                    notices.push(String(teamsPayload?.syncError || 'Team sync is unavailable right now.'));
                }

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
                // IDP is the employee directory. Only use profile-only rows as
                // a temporary read-only fallback when the IDP roster itself is
                // unavailable; never present a stale payroll overlay as a new
                // employee while the authoritative roster is healthy.
                if (idpResult.status !== 'fulfilled' || idpPayload?.syncAvailable === false) {
                    profiles.forEach((profile) => {
                        const userId = String(profile?.userId || '').trim();
                        if (userId && !seen.has(userId)) {
                            rows.push({ userId, profile });
                            seen.add(userId);
                        }
                    });
                }

                rows.sort((left, right) => getEmployeeName(left).localeCompare(getEmployeeName(right)));

                setEmployees(rows);
                setSyncNotice(Array.from(new Set(notices.filter(Boolean))).join(' '));
                setPageError('');
                setIdpOrganizationId(String(idpPayload?.organizationId || teamsPayload?.organizationId || '').trim());
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
            } catch (error: any) {
                console.error('Failed to fetch employees:', error);
                setPageError(error?.response?.data?.error || error?.message || 'Failed to load employees');
                if (error?.response?.status === 401) {
                    router.push('/login');
                    return;
                }
            } finally {
                setLoading(false);
            }
        };

        fetchEmployees();
    }, [router]);

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
    const resolutionRow = useMemo(
        () => employees.find((row) => row.userId === resolutionUserId) || null,
        [employees, resolutionUserId]
    );
    const resolutionIssue = resolutionRow ? getPrimaryEmployeeIssue(resolutionRow) : null;

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

    useEffect(() => {
        const candidates = employees.filter((row) => {
            if (!row.profile) return false;
            if (!shouldForceExcludeFromPayroll(row)) return false;
            if (row.profile?.payrollFlags?.includeInNextRun === false) return false;
            if (autoExcludingUsers.includes(row.userId)) return false;
            return true;
        });

        if (!candidates.length) {
            return;
        }

        const candidateIds = candidates.map((row) => row.userId);
        setAutoExcludingUsers((current) => Array.from(new Set([...current, ...candidateIds])));

        candidates.forEach((row) => {
            updateEmployeeRow(row.userId, (currentRow) => ({
                ...currentRow,
                profile: currentRow.profile ? {
                    ...currentRow.profile,
                    payrollFlags: {
                        ...(currentRow.profile.payrollFlags || {}),
                        includeInNextRun: false,
                        excludeFromNextRun: false,
                        requiresReview: true,
                        reviewReason: getAutoExclusionReason(currentRow),
                    }
                } : currentRow.profile
            }));
        });

        (async () => {
            await Promise.allSettled(candidates.map(async (row) => {
                try {
                    await api.put(`/payroll/profiles/${row.userId}`, {
                        payrollFlags: {
                            ...(row.profile?.payrollFlags || {}),
                            includeInNextRun: false,
                            excludeFromNextRun: false,
                            requiresReview: true,
                            reviewReason: getAutoExclusionReason(row),
                        }
                    });
                } catch (error) {
                    console.error(`Failed to auto-exclude ${row.userId} from payroll:`, error);
                } finally {
                    setAutoExcludingUsers((current) => current.filter((userId) => userId !== row.userId));
                }
            }));
        })();
    }, [autoExcludingUsers, employees]);

    useEffect(() => {
        const candidates = employees.filter((row) => {
            if (!row.profile) return false;
            if (shouldForceExcludeFromPayroll(row)) return false;
            if (row.profile?.payrollFlags?.includeInNextRun !== false) return false;
            if (row.profile?.payrollFlags?.requiresReview !== true) return false;
            if (!isAutoExclusionReason(row.profile?.payrollFlags?.reviewReason || '')) return false;
            if (autoIncludingUsers.includes(row.userId)) return false;
            return true;
        });

        if (!candidates.length) {
            return;
        }

        const candidateIds = candidates.map((row) => row.userId);
        setAutoIncludingUsers((current) => Array.from(new Set([...current, ...candidateIds])));

        candidates.forEach((row) => {
            updateEmployeeRow(row.userId, (currentRow) => ({
                ...currentRow,
                profile: currentRow.profile ? {
                    ...currentRow.profile,
                    payrollFlags: {
                        ...(currentRow.profile.payrollFlags || {}),
                        includeInNextRun: true,
                        excludeFromNextRun: false,
                        requiresReview: false,
                        reviewReason: '',
                    }
                } : currentRow.profile
            }));
        });

        (async () => {
            await Promise.allSettled(candidates.map(async (row) => {
                try {
                    await api.put(`/payroll/profiles/${row.userId}`, {
                        payrollFlags: {
                            ...(row.profile?.payrollFlags || {}),
                            includeInNextRun: true,
                            excludeFromNextRun: false,
                            requiresReview: false,
                            reviewReason: '',
                        }
                    });
                } catch (error) {
                    console.error(`Failed to re-include ${row.userId} in payroll:`, error);
                } finally {
                    setAutoIncludingUsers((current) => current.filter((userId) => userId !== row.userId));
                }
            }));
        })();
    }, [autoIncludingUsers, employees]);

    const handleExcludeForPayroll = async (row: EmployeeRow, excluded: boolean) => {
        if (!row.profile) return;

        const nextFlags = {
            ...(row.profile?.payrollFlags || {}),
            includeInNextRun: !excluded,
            excludeFromNextRun: excluded,
            requiresReview: false,
            reviewReason: excluded ? MANUAL_PAYROLL_EXCLUSION_REASON : '',
        };

        setExcludeBusyUserId(row.userId);
        updateEmployeeRow(row.userId, (currentRow) => ({
            ...currentRow,
            profile: currentRow.profile ? {
                ...currentRow.profile,
                payrollFlags: nextFlags,
            } : currentRow.profile
        }));

        try {
            const response = await api.put(`/payroll/profiles/${row.userId}`, {
                payrollFlags: nextFlags,
            });
            const savedProfile = response.data?.profile || response.data;
            if (savedProfile?.payrollFlags) {
                updateEmployeeRow(row.userId, (currentRow) => ({
                    ...currentRow,
                    profile: {
                        ...(currentRow.profile || {}),
                        ...savedProfile,
                    },
                }));
            }
        } catch (error: any) {
            updateEmployeeRow(row.userId, (currentRow) => ({
                ...currentRow,
                profile: currentRow.profile ? {
                    ...currentRow.profile,
                    payrollFlags: {
                        ...(row.profile?.payrollFlags || {})
                    },
                } : currentRow.profile
            }));
            alert(error?.response?.data?.error || error?.message || 'Failed to update payroll exclusion');
        } finally {
            setExcludeBusyUserId('');
        }
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

    const handleSendOnboarding = async (targetRow: EmployeeRow | null = null) => {
        const row = targetRow || resolutionRow || activeOnboardingRow;
        if (!row || !row.member) return;

        const memberId = getMemberAccountId(row);
        if (!memberId) return;
        const isReminder = hasActiveOnboardingTransition(row);

        setOnboardingActionBusy(true);
        try {
            let createdTransition: any = null;
            if (isReminder) {
                await api.post(`/payroll/idp/onboarding/members/${memberId}/reminder`);
            } else {
                const result = await api.post('/payroll/idp/onboarding/assign', {
                    memberId,
                    email: row.member.email,
                    name: row.member.name,
                    employeeId: row.member.employeeId,
                    designation: row.member.designation,
                    departmentId: row.member.departmentId,
                    departmentName: row.member.departmentName,
                    role: row.member.role,
                });
                createdTransition = result.data;
            }

            if (!isReminder) {
                updateEmployeeRow(row.userId, (currentRow) => ({
                    ...currentRow,
                    member: currentRow.member ? {
                        ...currentRow.member,
                        peopleTransition: {
                            subjectId: memberId,
                            status: String(createdTransition?.status || 'pending'),
                            processType: 'onboarding',
                            transitionId: createdTransition?.transitionId || null,
                            activeTransitionCount: 1,
                            pendingTaskCount: 1,
                            dueAt: null,
                            deepLink: createdTransition?.deepLink || '',
                        }
                    } : currentRow.member
                }));
            }
            if (resolutionUserId === row.userId) {
                setResolutionUserId('');
            }
        } catch (error: any) {
            alert(error?.response?.data?.error || error?.message || (isReminder ? 'Failed to send onboarding reminder' : 'Failed to assign onboarding'));
        } finally {
            setOnboardingActionBusy(false);
        }
    };

    const openResolutionModal = (row: EmployeeRow) => {
        setResolutionUserId(row.userId);
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
            {false && activeOnboardingRow && (
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
                                    This employee is available in Payroll but is not fully onboarded. Request the required details through Recruiter People Transitions, or enter the payroll details manually.
                                </p>
                            </div>
                            <div className="mt-5 grid gap-3 sm:grid-cols-2">
                                <button
                                    type="button"
                                    onClick={() => { void handleSendOnboarding(); }}
                                    disabled={onboardingActionBusy}
                                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/15 px-4 py-3 text-sm font-medium text-amber-300 transition hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {onboardingActionBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
                                    {hasActiveOnboardingTransition(activeOnboardingRow) ? 'Send Reminder' : 'Request Details'}
                                </button>
                                <Link
                                    href={getManualPayrollSetupUrl(activeOnboardingRow)}
                                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/15 px-4 py-3 text-sm font-medium text-emerald-300 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    <UserPlus className="h-4 w-4" />
                                    Enter Manually
                                </Link>
                                <a
                                    href={getPeopleTransitionUrl(activeOnboardingRow) || peopleStructureUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm font-medium text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-900"
                                >
                                    <FolderOpen className="h-4 w-4" />
                                    Open People Transition
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

            {false && !activeOnboardingRow && activeTeamAssignmentRow && (
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
                                    {getEmployeeName(activeTeamAssignmentRow!)}
                                    {resolveEmployeeId(activeTeamAssignmentRow!) ? ` • ${resolveEmployeeId(activeTeamAssignmentRow!)}` : ''}
                                    {getEmployeeEmail(activeTeamAssignmentRow!) ? ` • ${getEmployeeEmail(activeTeamAssignmentRow!)}` : ''}
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

            {syncNotice && !pageError && (
                <div className="max-w-6xl mx-auto mb-6 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                    {syncNotice}
                </div>
            )}

            {pageError && (
                <div className="max-w-6xl mx-auto mb-6 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                    {pageError}
                </div>
            )}

            {resolutionRow && resolutionIssue && (
                <div className="payroll-dialog-shell" role="presentation">
                    <div className="payroll-dialog max-w-2xl" role="dialog" aria-modal="true" aria-labelledby="employee-resolution-title">
                        <div className="payroll-dialog-header flex items-start justify-between gap-4 px-6 py-5">
                            <div>
                                <div className="flex flex-wrap items-center gap-2 mb-2">
                                    <span className="inline-flex items-center rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300">
                                        {getResolveIssueLabel(resolutionRow)}
                                    </span>
                                    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${
                                        isOnboardingComplete(resolutionRow)
                                            ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                                            : 'border-orange-500/20 bg-orange-500/10 text-orange-300'
                                    }`}>
                                        {formatOnboardingStatus(resolveOnboardingStatus(resolutionRow))}
                                    </span>
                                </div>
                                <h2 id="employee-resolution-title" className="payroll-dialog-title text-xl font-semibold">{getEmployeeName(resolutionRow)}</h2>
                                <p className="payroll-dialog-copy mt-1 text-sm">
                                    {resolveEmployeeId(resolutionRow) ? `${resolveEmployeeId(resolutionRow)} • ` : ''}
                                    {getEmployeeEmail(resolutionRow) || 'No email available'}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setResolutionUserId('')}
                                className="payroll-dialog-close"
                                aria-label="Close resolution prompt"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="px-6 py-5 space-y-4">
                            <div className="payroll-dialog-section p-4">
                                {resolutionIssue === 'onboarding' && (
                                    <>
                                        <p className="payroll-dialog-title mb-2 text-sm font-medium">This user is not fully onboarded.</p>
                                        <p className="payroll-dialog-copy text-sm">
                                            {hasActiveOnboardingTransition(resolutionRow)
                                                ? 'Their Recruiter People Transition is in progress. You can send a reminder, open the transition for HR review, or complete payroll setup manually.'
                                                : 'Request their required details through Recruiter People Transitions, or enter and verify the same information manually in Payroll.'}
                                        </p>
                                    </>
                                )}
                                {resolutionIssue === 'profile' && (
                                    <>
                                        <p className="payroll-dialog-title mb-2 text-sm font-medium">Payroll configuration is not set up yet.</p>
                                        <p className="payroll-dialog-copy text-sm">
                                            This employee already comes from the Identity Provider. Load their identity into Payroll, then configure salary, tax, banking and legal-employer details before including them in a run.
                                        </p>
                                    </>
                                )}
                                {resolutionIssue === 'setup' && (
                                    <>
                                        <p className="payroll-dialog-title mb-2 text-sm font-medium">Payroll setup is incomplete.</p>
                                        <p className="payroll-dialog-copy text-sm">
                                            This employee has a payroll profile, but the required setup is incomplete. Finish salary and payroll configuration before including them in payroll.
                                        </p>
                                    </>
                                )}
                            </div>

                            <div className="grid gap-3 sm:grid-cols-2">
                                {resolutionIssue === 'onboarding' && (
                                    <>
                                        <button
                                            type="button"
                                            onClick={() => handleSendOnboarding(resolutionRow)}
                                            disabled={onboardingActionBusy}
                                            className="payroll-button-primary"
                                        >
                                            {onboardingActionBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
                                            {hasActiveOnboardingTransition(resolutionRow) ? 'Send Reminder' : 'Request Details'}
                                        </button>
                                        <Link
                                            href={getManualPayrollSetupUrl(resolutionRow)}
                                            className="payroll-button-secondary"
                                        >
                                            <UserPlus className="h-4 w-4" />
                                            Enter Manually
                                        </Link>
                                    </>
                                )}

                                {resolutionIssue === 'profile' && (
                                    <Link
                                        href={`/admin/employees/configure/${resolutionRow.userId}`}
                                        className="payroll-button-primary"
                                    >
                                        <UserPlus className="h-4 w-4" />
                                        Configure Payroll
                                    </Link>
                                )}

                                {resolutionIssue === 'setup' && (
                                    <Link
                                        href={`/admin/employees/${resolutionRow.userId}`}
                                        className="payroll-button-primary"
                                    >
                                        <ChevronRight className="h-4 w-4" />
                                        Open Payroll Setup
                                    </Link>
                                )}

                                {getPeopleTransitionUrl(resolutionRow) && (
                                    <a
                                        href={getPeopleTransitionUrl(resolutionRow)}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="payroll-button-secondary"
                                    >
                                        <FolderOpen className="h-4 w-4" />
                                        Open People Transition
                                    </a>
                                )}

                                <button
                                    type="button"
                                    onClick={() => setResolutionUserId('')}
                                    className="payroll-button-secondary"
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

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
                    const onboardingComplete = isOnboardingComplete(row);
                    const transitionType = String(member?.peopleTransition?.processType || '').toLowerCase();
                    const hasActivePayrollCloseout = ['exit', 'retirement'].includes(transitionType)
                        && !['completed', 'cancelled'].includes(String(member?.peopleTransition?.status || '').toLowerCase());
                    const missingPayrollProfile = needsPayrollProfile(row);
                    const needsSetup = needsPayrollSetup(row);
                    const resolveIssueLabel = getResolveIssueLabel(row);
                    const teamName = resolveTeamName(row);
                    const departmentName = resolveDepartmentName(row);
                    const employeeId = resolveEmployeeId(row);
                    const currency = employee?.currency || 'USD';
                    const totalAllowances = Number(employee?.totalAllowances || 0);
                    const grossMonthlySalary = Number(employee?.grossMonthlySalary || (Number(employee?.basicSalary || 0) + totalAllowances));
                    const holdPayment = !!employee?.payrollFlags?.holdPayment;
                    const automaticExclusionReason = getAutomaticPayrollExclusionReason(row);
                    const forceExcluded = shouldForceExcludeFromPayroll(row) || !!automaticExclusionReason;
                    const manuallyExcluded = isManuallyExcludedFromPayroll(row);
                    const excludedForRun = forceExcluded || manuallyExcluded;
                    const excludeToggleDisabled = !hasProfile || forceExcluded || excludeBusyUserId === row.userId || autoExcludingUsers.includes(row.userId);

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
                                    {onboardingComplete && missingPayrollProfile && (
                                        <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20">
                                            <UserPlus className="w-3 h-3" />
                                            Payroll Setup Needed
                                        </span>
                                    )}
                                    {onboardingComplete && !missingPayrollProfile && needsSetup && (
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
                                    {hasActivePayrollCloseout && (
                                        <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-300 border border-red-500/20">
                                            <AlertCircle className="w-3 h-3" />
                                            {formatOnboardingStatus(transitionType)} Pending
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
                                        <span className={`font-mono font-medium text-right ${missingPayrollProfile || needsSetup ? 'text-zinc-500' : 'text-emerald-400'}`}>
                                            {missingPayrollProfile || needsSetup
                                                ? 'Not Set'
                                                : formatPayrollMoney(employee?.basicSalary || 0, currency)}
                                        </span>
                                    </div>

                                {hasProfile && !needsSetup && (
                                    <div className="flex items-center justify-between gap-3 text-sm">
                                        <span className="text-zinc-500 flex items-center gap-1.5">
                                            <DollarSign className="w-3.5 h-3.5" /> Gross Monthly
                                        </span>
                                        <span className="font-mono font-medium text-zinc-200 text-right">
                                            {formatPayrollMoney(grossMonthlySalary, currency)}
                                        </span>
                                    </div>
                                )}

                                <label className={`mt-1 flex items-start gap-3 rounded-lg border px-3 py-2 text-sm ${
                                    excludedForRun
                                        ? 'border-amber-500/20 bg-amber-500/10 text-amber-200'
                                        : 'border-zinc-800 bg-zinc-950/40 text-zinc-300'
                                }`}>
                                    <input
                                        type="checkbox"
                                        checked={excludedForRun}
                                        disabled={excludeToggleDisabled}
                                        onChange={(event) => handleExcludeForPayroll(row, event.target.checked)}
                                        className="mt-0.5 rounded bg-zinc-900 border-zinc-700"
                                    />
                                    <span className="flex-1">
                                        <span className="block font-medium">
                                            Exclude from payroll run
                                        </span>
                                        <span className={`block mt-0.5 text-xs ${
                                            excludedForRun ? 'text-amber-200/80' : 'text-zinc-500'
                                        }`}>
                                            {forceExcluded
                                                ? (automaticExclusionReason || getAutoExclusionReason(row))
                                                : (manuallyExcluded
                                                    ? 'This employee is manually excluded from the next payroll run.'
                                                    : 'This employee is included in the next payroll run.')}
                                        </span>
                                    </span>
                                </label>

                                <div className="pt-3 mt-3 border-t border-zinc-800/50 flex items-center justify-between gap-3">
                                    <span className={`text-xs px-2 py-0.5 rounded-full border ${
                                        employee?.isActive !== false
                                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                            : 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
                                    }`}>
                                        {employee?.isActive !== false ? 'Active' : 'Inactive'}
                                    </span>
                                    {!onboardingComplete ? (
                                        <button
                                            type="button"
                                            onClick={() => openResolutionModal(row)}
                                            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 transition-colors"
                                        >
                                            {resolveIssueLabel}
                                            <ChevronRight className="w-3.5 h-3.5" />
                                        </button>
                                    ) : missingPayrollProfile ? (
                                        <button
                                            type="button"
                                            onClick={() => openResolutionModal(row)}
                                            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 transition-colors"
                                        >
                                            <UserPlus className="w-3.5 h-3.5" />
                                            {resolveIssueLabel}
                                        </button>
                                    ) : needsSetup ? (
                                        <button
                                            type="button"
                                            onClick={() => openResolutionModal(row)}
                                            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 transition-colors"
                                        >
                                            {resolveIssueLabel}
                                            <ChevronRight className="w-3.5 h-3.5" />
                                        </button>
                                    ) : hasActivePayrollCloseout && getPeopleTransitionUrl(row) ? (
                                        <a
                                            href={getPeopleTransitionUrl(row)}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-red-500/10 text-red-300 border border-red-500/20 hover:bg-red-500/15 transition-colors"
                                        >
                                            Open {formatOnboardingStatus(transitionType)}
                                            <ChevronRight className="w-3.5 h-3.5" />
                                        </a>
                                    ) : (
                                        <Link
                                            href={`/admin/employees/${row.userId}`}
                                            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
                                        >
                                            View
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
