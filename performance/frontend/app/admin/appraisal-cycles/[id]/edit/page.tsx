'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useUserContext, useDirectReports } from '@/lib/hooks';
import api from '@/lib/api';
import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    Checkbox,
    Chip,
    CircularProgress,
    Divider,
    FormControl,
    FormControlLabel,
    Grid,
    InputAdornment,
    InputLabel,
    MenuItem,
    Select,
    Slider,
    Step,
    StepLabel,
    Stepper,
    Stack,
    Switch,
    Tab,
    Tabs,
    TextField,
    Typography
} from '@mui/material';
import {
    ArrowBack,
    CheckCircle,
    Groups,
    RocketLaunch,
    Save,
    Search,
    WarningAmber
} from '@mui/icons-material';

interface AssignableEmployee {
    userId: string;
    name: string;
    email: string;
    department?: string;
    departmentId?: string;
    departmentName?: string;
    jobTitle?: string;
    teamId?: string;
    teamIds?: string[];
    teamName?: string;
    teamRole?: string;
    managerId?: string;
    managerName?: string;
    managerEmail?: string;
    isManager?: boolean;
    isSelf?: boolean;
    isSelectableForAppraisal?: boolean;
    selectionBlockedReason?: string | null;
}

interface ManagedTeamOption {
    id?: string;
    _id?: string;
    teamId?: string;
    name?: string;
    teamName?: string;
}

const cycleTypeLabels: Record<string, string> = {
    annual: 'Annual Review',
    'semi-annual': 'Semi-Annual Review',
    quarterly: 'Quarterly Review',
    probation: 'Probation Review',
    project: 'Project-Based Review',
    adhoc: 'Ad-Hoc Review'
};

const phaseLabels: Record<string, string> = {
    selfAssessment: 'Self-Assessment',
    managerReview: 'Manager Review',
    calibration: 'Calibration',
    finalReview: 'Final Review'
};

function createDefaultFormData() {
    const currentYear = new Date().getUTCFullYear();

    return {
        name: '',
        description: '',
        cycleType: 'annual',
        periodStart: `${currentYear}-01-01`,
        periodEnd: `${currentYear}-12-31`,
        okrWeight: 40,
        scope: {
            type: 'organization',
            targetIds: [] as string[]
        },
        phases: {
            selfAssessment: { startDate: '', endDate: '' },
            managerReview: { startDate: '', endDate: '' },
            calibration: { startDate: '', endDate: '' },
            finalReview: { startDate: '', endDate: '' }
        },
        settings: {
            allowSelfRating: true,
            requireDocumentUpload: false,
            requireOkrAlignment: true,
            enablePeerFeedback: true,
            enable360Feedback: false,
            enableAiAssist: true,
            enableChat: true,
            requireSignOff: true
        }
    };
}

function formatDateForInput(dateString: string) {
    if (!dateString) return '';
    return new Date(dateString).toISOString().split('T')[0];
}

function normalizeManagedTeamId(team: ManagedTeamOption) {
    return team?.teamId || team?.id || team?._id || '';
}

function normalizeManagedTeamName(team: ManagedTeamOption) {
    return team?.teamName || team?.name || 'Unnamed Team';
}

function buildScopeFromEmployees(isHRAdmin: boolean, employees: AssignableEmployee[]) {
    const targetIds = Array.from(
        new Set(
            employees.flatMap((employee) => {
                const teamIds = Array.isArray(employee.teamIds) ? employee.teamIds : [];
                return [...teamIds, employee.teamId].filter(Boolean).map((value) => String(value));
            })
        )
    );

    if (isHRAdmin) {
        if (targetIds.length === 1) {
            return { type: 'team', targetIds };
        }

        return { type: 'organization', targetIds: [] as string[] };
    }

    return { type: 'team', targetIds };
}

function matchesEmployeeSearch(employee: AssignableEmployee, query: string) {
    if (!query) return true;
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return true;

    return [
        employee.name,
        employee.email,
        employee.teamName,
        employee.department,
        employee.departmentName,
        employee.jobTitle,
        employee.managerName,
        employee.managerEmail
    ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery));
}

export default function EditAppraisalCyclePage() {
    const router = useRouter();
    const params = useParams();
    const { isHRAdmin } = useUserContext();
    const { managedTeams } = useDirectReports();
    const cycleId = (params.id as string) || 'new';
    const isNewCycle = cycleId === 'new';

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [saveError, setSaveError] = useState('');
    const [formData, setFormData] = useState(createDefaultFormData);

    const [assignableEmployees, setAssignableEmployees] = useState<AssignableEmployee[]>([]);
    const [loadingEmployees, setLoadingEmployees] = useState(false);
    const [employeeSearch, setEmployeeSearch] = useState('');
    const [participantView, setParticipantView] = useState<'byManager' | 'list'>('byManager');
    const [selectedParticipantIds, setSelectedParticipantIds] = useState<string[]>([]);
    const [setupStep, setSetupStep] = useState(0);

    useEffect(() => {
        const fetchCycle = async () => {
            if (isNewCycle) {
                setLoading(false);
                return;
            }

            try {
                const response = await api.get(`/appraisals/cycles/${cycleId}`);
                const cycle = response.data.data;

                setFormData({
                    name: cycle.name,
                    description: cycle.description || '',
                    cycleType: cycle.cycleType,
                    periodStart: formatDateForInput(cycle.periodStart),
                    periodEnd: formatDateForInput(cycle.periodEnd),
                    okrWeight: cycle.okrWeight,
                    scope: cycle.scope || { type: 'organization', targetIds: [] },
                    phases: {
                        selfAssessment: {
                            startDate: formatDateForInput(cycle.phases?.selfAssessment?.startDate),
                            endDate: formatDateForInput(cycle.phases?.selfAssessment?.endDate)
                        },
                        managerReview: {
                            startDate: formatDateForInput(cycle.phases?.managerReview?.startDate),
                            endDate: formatDateForInput(cycle.phases?.managerReview?.endDate)
                        },
                        calibration: {
                            startDate: formatDateForInput(cycle.phases?.calibration?.startDate),
                            endDate: formatDateForInput(cycle.phases?.calibration?.endDate)
                        },
                        finalReview: {
                            startDate: formatDateForInput(cycle.phases?.finalReview?.startDate),
                            endDate: formatDateForInput(cycle.phases?.finalReview?.endDate)
                        }
                    },
                    settings: cycle.settings
                });
            } catch (err: any) {
                console.error('Fetch cycle error:', err);
                setError(err.response?.data?.error || 'Failed to fetch appraisal cycle');
            } finally {
                setLoading(false);
            }
        };

        fetchCycle();
    }, [cycleId, isNewCycle]);

    useEffect(() => {
        if (!isNewCycle) return;

        let isMounted = true;

        const fetchAssignableEmployees = async () => {
            setLoadingEmployees(true);
            try {
                const response = await api.get('/user/employees-for-appraisal');
                const employeeList = response.data?.data?.employees || [];
                if (!isMounted) return;
                setAssignableEmployees(Array.isArray(employeeList) ? employeeList : []);
            } catch (primaryError) {
                console.error('Failed to fetch assignable users', primaryError);
                try {
                    const fallbackResponse = await api.get('/user/all-employees');
                    const fallbackEmployees = fallbackResponse.data?.data || [];
                    if (!isMounted) return;
                    setAssignableEmployees(Array.isArray(fallbackEmployees) ? fallbackEmployees : []);
                } catch (fallbackError: any) {
                    if (!isMounted) return;
                    console.error('Failed to fetch fallback assignable users', fallbackError);
                    setSaveError(fallbackError.response?.data?.error || 'Failed to load employees for this cycle.');
                }
            } finally {
                if (isMounted) {
                    setLoadingEmployees(false);
                }
            }
        };

        fetchAssignableEmployees();

        return () => {
            isMounted = false;
        };
    }, [isNewCycle]);

    const eligibleEmployees = useMemo(
        () => assignableEmployees.filter((employee) => employee.isSelectableForAppraisal !== false),
        [assignableEmployees]
    );

    const ineligibleEmployees = useMemo(
        () => assignableEmployees.filter((employee) => employee.isSelectableForAppraisal === false),
        [assignableEmployees]
    );

    const filteredEligibleEmployees = useMemo(
        () => eligibleEmployees.filter((employee) => matchesEmployeeSearch(employee, employeeSearch)),
        [eligibleEmployees, employeeSearch]
    );

    const filteredIneligibleEmployees = useMemo(
        () => ineligibleEmployees.filter((employee) => matchesEmployeeSearch(employee, employeeSearch)),
        [ineligibleEmployees, employeeSearch]
    );

    const selectedParticipants = useMemo(
        () => eligibleEmployees.filter((employee) => selectedParticipantIds.includes(employee.userId)),
        [eligibleEmployees, selectedParticipantIds]
    );

    const groupedEligibleEmployees = useMemo(() => {
        const groups = new Map<string, { key: string; managerName: string; managerEmail?: string; directReports: AssignableEmployee[] }>();

        filteredEligibleEmployees.forEach((employee) => {
            const managerKey = employee.managerId || employee.managerEmail || 'unassigned';
            if (!groups.has(managerKey)) {
                groups.set(managerKey, {
                    key: managerKey,
                    managerName: employee.managerName || 'Assigned Manager',
                    managerEmail: employee.managerEmail,
                    directReports: []
                });
            }
            groups.get(managerKey)?.directReports.push(employee);
        });

        return Array.from(groups.values()).sort((left, right) => left.managerName.localeCompare(right.managerName));
    }, [filteredEligibleEmployees]);

    const selectionSummary = useMemo(() => ({
        eligible: eligibleEmployees.length,
        ineligible: ineligibleEmployees.length,
        selected: selectedParticipants.length
    }), [eligibleEmployees.length, ineligibleEmployees.length, selectedParticipants.length]);

    const toggleParticipant = (userId: string) => {
        setSelectedParticipantIds((previous) => (
            previous.includes(userId)
                ? previous.filter((id) => id !== userId)
                : [...previous, userId]
        ));
    };

    const selectAllEligible = () => {
        setSelectedParticipantIds(eligibleEmployees.map((employee) => employee.userId));
    };

    const clearSelectedParticipants = () => {
        setSelectedParticipantIds([]);
    };

    const handleSave = async () => {
        setSaveError('');

        if (!formData.name.trim()) {
            setSaveError('Cycle name is required.');
            return;
        }

        if (!formData.periodStart || !formData.periodEnd) {
            setSaveError('Set the cycle period start and end dates.');
            return;
        }

        if (new Date(formData.periodStart) > new Date(formData.periodEnd)) {
            setSaveError('Cycle period end date must be after the start date.');
            return;
        }

        if (isNewCycle && selectedParticipants.length === 0) {
            setSaveError('Select at least one eligible employee before creating the cycle.');
            return;
        }

        setSaving(true);
        try {
            if (isNewCycle) {
                const scope = buildScopeFromEmployees(isHRAdmin, selectedParticipants);
                await api.post('/appraisals/cycles', {
                    ...formData,
                    scope,
                    launchNow: true,
                    employees: selectedParticipants.map((employee) => ({
                        userId: employee.userId,
                        name: employee.name,
                        email: employee.email,
                        department: employee.department,
                        departmentId: employee.departmentId,
                        departmentName: employee.departmentName,
                        jobTitle: employee.jobTitle,
                        teamId: employee.teamId,
                        teamIds: employee.teamIds,
                        teamName: employee.teamName,
                        teamRole: employee.teamRole,
                        managerId: employee.managerId,
                        managerName: employee.managerName,
                        managerEmail: employee.managerEmail,
                        isSelf: employee.isSelf
                    }))
                });
            } else {
                await api.put(`/appraisals/cycles/${cycleId}`, formData);
            }

            router.push('/admin/appraisal-cycles');
        } catch (err: any) {
            console.error('Save cycle error:', err);
            setSaveError(err.response?.data?.error || err.message || 'Failed to save cycle');
        } finally {
            setSaving(false);
        }
    };

    const handlePrimaryAction = () => {
        setSaveError('');

        if (!isNewCycle) {
            handleSave();
            return;
        }

        if (setupStep === 0) {
            if (!formData.name.trim()) {
                setSaveError('Give this review cycle a clear name, such as “2026 Mid-Year Review”.');
                return;
            }
            if (!formData.periodStart || !formData.periodEnd) {
                setSaveError('Choose the performance period this review covers.');
                return;
            }
            if (new Date(formData.periodStart) > new Date(formData.periodEnd)) {
                setSaveError('The performance period must end after it starts.');
                return;
            }
            setSetupStep(1);
            return;
        }

        if (setupStep === 1) {
            if (selectedParticipants.length === 0) {
                setSaveError('Choose at least one employee with an assigned line manager.');
                return;
            }
            setSetupStep(2);
            return;
        }

        handleSave();
    };

    if (loading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                <CircularProgress />
            </Box>
        );
    }

    if (error) {
        return (
            <Alert severity="error">
                {error}
                <Button onClick={() => router.push('/admin/appraisal-cycles')} sx={{ ml: 2 }}>
                    Back to list
                </Button>
            </Alert>
        );
    }

    return (
        <Box>
            <Box sx={{ mb: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Button
                        startIcon={<ArrowBack />}
                        onClick={() => router.push(isNewCycle ? '/admin/appraisal-cycles' : `/admin/appraisal-cycles/${cycleId}`)}
                    >
                        Back
                    </Button>
                    <Box>
                        <Typography variant="h4" fontWeight={700}>
                            {isNewCycle ? 'Create Appraisal Cycle' : 'Edit Cycle'}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            {isNewCycle
                                ? 'Set the cycle up once, choose who participates, and launch it immediately.'
                                : 'Update the cycle settings and timeline.'}
                        </Typography>
                    </Box>
                </Box>
                <Stack direction="row" spacing={1}>
                    {isNewCycle && setupStep > 0 && (
                        <Button variant="outlined" onClick={() => setSetupStep((current) => current - 1)} disabled={saving}>
                            Previous
                        </Button>
                    )}
                    <Button
                        variant="contained"
                        startIcon={saving ? <CircularProgress size={18} color="inherit" /> : (isNewCycle && setupStep === 2 ? <RocketLaunch /> : (!isNewCycle ? <Save /> : undefined))}
                        onClick={handlePrimaryAction}
                        disabled={saving || (isNewCycle && loadingEmployees)}
                    >
                        {!isNewCycle ? 'Save Changes' : setupStep === 2 ? 'Launch Review Cycle' : 'Continue'}
                    </Button>
                </Stack>
            </Box>

            {isNewCycle && (
                <Box sx={{ mb: 3, px: { xs: 0, md: 1 } }}>
                    <Stepper activeStep={setupStep}>
                        <Step><StepLabel>Review period</StepLabel></Step>
                        <Step><StepLabel>People</StepLabel></Step>
                        <Step><StepLabel>Confirm</StepLabel></Step>
                    </Stepper>
                </Box>
            )}

            {saveError && (
                <Alert severity="error" sx={{ mb: 3 }}>
                    {saveError}
                </Alert>
            )}

            <Grid container spacing={3}>
                <Grid size={{ xs: 12, lg: isNewCycle ? 12 : 8 }} sx={{ display: isNewCycle && setupStep === 2 ? 'none' : 'block' }}>
                    {(!isNewCycle || setupStep === 0) && <Card sx={{ mb: 3 }}>
                        <CardContent>
                            <Typography variant="h6" gutterBottom>Cycle Details</Typography>
                            <Grid container spacing={2}>
                                <Grid size={{ xs: 12, md: 6 }}>
                                    <TextField
                                        fullWidth
                                        label="Cycle Name"
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    />
                                </Grid>
                                <Grid size={{ xs: 12, md: 6 }}>
                                    <FormControl fullWidth>
                                        <InputLabel>Cycle Type</InputLabel>
                                        <Select
                                            value={formData.cycleType}
                                            label="Cycle Type"
                                            onChange={(e) => setFormData({ ...formData, cycleType: e.target.value as any })}
                                        >
                                            {Object.entries(cycleTypeLabels).map(([value, label]) => (
                                                <MenuItem key={value} value={value}>{label}</MenuItem>
                                            ))}
                                        </Select>
                                    </FormControl>
                                </Grid>
                                <Grid size={{ xs: 12 }}>
                                    <TextField
                                        fullWidth
                                        multiline
                                        rows={3}
                                        label="Description"
                                        value={formData.description}
                                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                    />
                                </Grid>
                                <Grid size={{ xs: 12, md: 6 }}>
                                    <TextField
                                        fullWidth
                                        type="date"
                                        label="Period Start"
                                        value={formData.periodStart}
                                        onChange={(e) => setFormData({ ...formData, periodStart: e.target.value })}
                                        InputLabelProps={{ shrink: true }}
                                    />
                                </Grid>
                                <Grid size={{ xs: 12, md: 6 }}>
                                    <TextField
                                        fullWidth
                                        type="date"
                                        label="Period End"
                                        value={formData.periodEnd}
                                        onChange={(e) => setFormData({ ...formData, periodEnd: e.target.value })}
                                        InputLabelProps={{ shrink: true }}
                                    />
                                </Grid>
                            </Grid>
                        </CardContent>
                    </Card>}

                    {!isNewCycle && <Card sx={{ mb: 3 }}>
                        <CardContent>
                            <Typography variant="h6" gutterBottom>Phase Timeline</Typography>
                            <Typography variant="body2" color="text.secondary" paragraph>
                                Define when each phase should run. The workflow advances automatically as people submit their work.
                            </Typography>
                            <Grid container spacing={2}>
                                {Object.entries(phaseLabels).map(([phaseKey, label]) => (
                                    <Grid size={{ xs: 12 }} key={phaseKey}>
                                        <Typography variant="subtitle2" gutterBottom>{label}</Typography>
                                        <Grid container spacing={2}>
                                            <Grid size={{ xs: 12, sm: 6 }}>
                                                <TextField
                                                    fullWidth
                                                    size="small"
                                                    type="date"
                                                    label="Start Date"
                                                    value={formData.phases[phaseKey as keyof typeof formData.phases]?.startDate || ''}
                                                    onChange={(e) => setFormData({
                                                        ...formData,
                                                        phases: {
                                                            ...formData.phases,
                                                            [phaseKey]: {
                                                                ...formData.phases[phaseKey as keyof typeof formData.phases],
                                                                startDate: e.target.value
                                                            }
                                                        }
                                                    })}
                                                    InputLabelProps={{ shrink: true }}
                                                />
                                            </Grid>
                                            <Grid size={{ xs: 12, sm: 6 }}>
                                                <TextField
                                                    fullWidth
                                                    size="small"
                                                    type="date"
                                                    label="End Date"
                                                    value={formData.phases[phaseKey as keyof typeof formData.phases]?.endDate || ''}
                                                    onChange={(e) => setFormData({
                                                        ...formData,
                                                        phases: {
                                                            ...formData.phases,
                                                            [phaseKey]: {
                                                                ...formData.phases[phaseKey as keyof typeof formData.phases],
                                                                endDate: e.target.value
                                                            }
                                                        }
                                                    })}
                                                    InputLabelProps={{ shrink: true }}
                                                />
                                            </Grid>
                                        </Grid>
                                        {phaseKey !== 'finalReview' && <Divider sx={{ my: 2 }} />}
                                    </Grid>
                                ))}
                            </Grid>
                        </CardContent>
                    </Card>}

                    {isNewCycle && setupStep === 0 && (
                        <Card variant="outlined">
                            <CardContent>
                                <Typography variant="h6" gutterBottom>How the review will run</Typography>
                                <Stack divider={<Divider flexItem />}>
                                    {[
                                        ['1', 'Targets and expectations', 'Employees and managers maintain measurable OKRs before the review. This cycle assesses progress and evidence from that performance period.'],
                                        ['2', 'AI-guided employee reflection', 'The AI coach asks about target outcomes, evidence, achievements, challenges, and development goals, then drafts a self-assessment for the employee to approve.'],
                                        ['3', 'Line-manager review', 'The manager sees the employee reflection, target evidence, and AI-generated prompts before giving an independent rating and written review.'],
                                        ['4', 'Performance discussion', 'Employee and manager meet, record agreed strengths, improvements, support, and next steps.'],
                                        ['5', 'Calibration and final outcome', 'Calibration is completed when enabled, then the final rating and development actions are confirmed.']
                                    ].map(([number, title, copy]) => (
                                        <Box key={number} sx={{ display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr)', gap: 1.5, py: 1.5 }}>
                                            <Typography color="text.secondary" fontWeight={700}>{number}</Typography>
                                            <Box>
                                                <Typography variant="body2" fontWeight={700}>{title}</Typography>
                                                <Typography variant="body2" color="text.secondary">{copy}</Typography>
                                            </Box>
                                        </Box>
                                    ))}
                                </Stack>
                            </CardContent>
                        </Card>
                    )}

                    {isNewCycle && setupStep === 1 && (
                        <Card>
                            <CardContent>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap', mb: 2 }}>
                                    <Box>
                                        <Typography variant="h6" gutterBottom>Choose Participants</Typography>
                                        <Typography variant="body2" color="text.secondary">
                                            Eligible employees have a real manager in the hierarchy. Top-level users without a manager stay visible here, but they cannot be selected.
                                        </Typography>
                                    </Box>
                                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                                        <Chip color="primary" label={`${selectionSummary.selected} selected`} />
                                        <Chip color="success" variant="outlined" label={`${selectionSummary.eligible} eligible`} />
                                        <Chip color="warning" variant="outlined" label={`${selectionSummary.ineligible} unavailable`} />
                                    </Stack>
                                </Box>

                                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2 }}>
                                    <TextField
                                        fullWidth
                                        placeholder="Search by name, team, department, or manager"
                                        value={employeeSearch}
                                        onChange={(e) => setEmployeeSearch(e.target.value)}
                                        InputProps={{
                                            startAdornment: (
                                                <InputAdornment position="start">
                                                    <Search fontSize="small" />
                                                </InputAdornment>
                                            )
                                        }}
                                    />
                                    <Stack direction="row" spacing={1}>
                                        <Button variant="outlined" onClick={selectAllEligible} disabled={eligibleEmployees.length === 0}>
                                            Select All Eligible
                                        </Button>
                                        <Button variant="text" onClick={clearSelectedParticipants} disabled={selectedParticipantIds.length === 0}>
                                            Clear
                                        </Button>
                                    </Stack>
                                </Stack>

                                <Tabs value={participantView} onChange={(_, value) => setParticipantView(value)} sx={{ mb: 2 }}>
                                    <Tab value="byManager" label="By Manager" />
                                    <Tab value="list" label="List View" />
                                </Tabs>

                                {loadingEmployees ? (
                                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                                        <CircularProgress />
                                    </Box>
                                ) : (
                                    <>
                                        {participantView === 'byManager' ? (
                                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                                {groupedEligibleEmployees.map((group) => {
                                                    const allSelected = group.directReports.every((employee) => selectedParticipantIds.includes(employee.userId));
                                                    return (
                                                        <Card key={group.key} variant="outlined">
                                                            <CardContent>
                                                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, flexWrap: 'wrap', mb: 1.5 }}>
                                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                                        <Groups color="primary" fontSize="small" />
                                                                        <Box>
                                                                            <Typography variant="subtitle2" fontWeight={700}>{group.managerName}</Typography>
                                                                            <Typography variant="caption" color="text.secondary">{group.managerEmail || 'Assigned manager'}</Typography>
                                                                        </Box>
                                                                    </Box>
                                                                    <Button
                                                                        size="small"
                                                                        onClick={() => {
                                                                            const ids = group.directReports.map((employee) => employee.userId);
                                                                            setSelectedParticipantIds((previous) => {
                                                                                if (allSelected) {
                                                                                    return previous.filter((id) => !ids.includes(id));
                                                                                }
                                                                                return Array.from(new Set([...previous, ...ids]));
                                                                            });
                                                                        }}
                                                                    >
                                                                        {allSelected ? 'Deselect Team' : 'Select Team'}
                                                                    </Button>
                                                                </Box>
                                                                <Stack spacing={1}>
                                                                    {group.directReports.map((employee) => (
                                                                        <Box
                                                                            key={employee.userId}
                                                                            onClick={() => toggleParticipant(employee.userId)}
                                                                            sx={{
                                                                                display: 'flex',
                                                                                alignItems: 'center',
                                                                                gap: 1.5,
                                                                                px: 1,
                                                                                py: 1,
                                                                                borderRadius: 1,
                                                                                cursor: 'pointer',
                                                                                '&:hover': { bgcolor: 'action.hover' }
                                                                            }}
                                                                        >
                                                                            <Checkbox checked={selectedParticipantIds.includes(employee.userId)} />
                                                                            <Box sx={{ flex: 1 }}>
                                                                                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
                                                                                    <Typography variant="body2" fontWeight={600}>{employee.name}</Typography>
                                                                                    {employee.isSelf && <Chip size="small" label="You" color="info" />}
                                                                                    {employee.isManager && <Chip size="small" label="Manager" variant="outlined" />}
                                                                                </Stack>
                                                                                <Typography variant="caption" color="text.secondary">
                                                                                    {[employee.jobTitle, employee.teamName || employee.departmentName || employee.department, employee.email]
                                                                                        .filter(Boolean)
                                                                                        .join(' | ')}
                                                                                </Typography>
                                                                            </Box>
                                                                        </Box>
                                                                    ))}
                                                                </Stack>
                                                            </CardContent>
                                                        </Card>
                                                    );
                                                })}

                                                {groupedEligibleEmployees.length === 0 && (
                                                    <Alert severity="info">No eligible employees match the current search.</Alert>
                                                )}
                                            </Box>
                                        ) : (
                                            <Stack spacing={1}>
                                                {filteredEligibleEmployees.map((employee) => (
                                                    <Box
                                                        key={employee.userId}
                                                        onClick={() => toggleParticipant(employee.userId)}
                                                        sx={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: 1.5,
                                                            px: 1,
                                                            py: 1,
                                                            borderRadius: 1,
                                                            border: '1px solid',
                                                            borderColor: 'divider',
                                                            cursor: 'pointer',
                                                            '&:hover': { bgcolor: 'action.hover' }
                                                        }}
                                                    >
                                                        <Checkbox checked={selectedParticipantIds.includes(employee.userId)} />
                                                        <Box sx={{ flex: 1 }}>
                                                            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
                                                                <Typography variant="body2" fontWeight={600}>{employee.name}</Typography>
                                                                {employee.isSelf && <Chip size="small" label="You" color="info" />}
                                                                {employee.isManager && <Chip size="small" label="Manager" variant="outlined" />}
                                                            </Stack>
                                                            <Typography variant="caption" color="text.secondary">
                                                                {[employee.teamName || employee.departmentName || employee.department, employee.jobTitle, employee.managerName || employee.managerEmail, employee.email]
                                                                    .filter(Boolean)
                                                                    .join(' | ')}
                                                            </Typography>
                                                        </Box>
                                                    </Box>
                                                ))}

                                                {filteredEligibleEmployees.length === 0 && (
                                                    <Alert severity="info">No eligible employees match the current search.</Alert>
                                                )}
                                            </Stack>
                                        )}

                                        {filteredIneligibleEmployees.length > 0 && (
                                            <Card variant="outlined" sx={{ mt: 3, borderColor: 'warning.main' }}>
                                                <CardContent>
                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                                                        <WarningAmber color="warning" fontSize="small" />
                                                        <Typography variant="subtitle2" fontWeight={700} color="warning.main">
                                                            Not eligible for this cycle
                                                        </Typography>
                                                    </Box>
                                                    <Stack spacing={1}>
                                                        {filteredIneligibleEmployees.map((employee) => (
                                                            <Box key={employee.userId} sx={{ px: 1, py: 1, borderRadius: 1, bgcolor: 'warning.50' }}>
                                                                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
                                                                    <Typography variant="body2" fontWeight={600}>{employee.name}</Typography>
                                                                    {employee.isSelf && <Chip size="small" label="You" color="info" />}
                                                                </Stack>
                                                                <Typography variant="caption" color="text.secondary">
                                                                    {[employee.teamName || employee.departmentName || employee.department, employee.jobTitle, employee.email]
                                                                        .filter(Boolean)
                                                                        .join(' | ')}
                                                                </Typography>
                                                                <Typography variant="caption" color="warning.main" display="block" sx={{ mt: 0.5 }}>
                                                                    {employee.selectionBlockedReason || 'No manager is assigned for this employee.'}
                                                                </Typography>
                                                            </Box>
                                                        ))}
                                                    </Stack>
                                                </CardContent>
                                            </Card>
                                        )}
                                    </>
                                )}
                            </CardContent>
                        </Card>
                    )}
                </Grid>

                {(!isNewCycle || setupStep === 2) && <Grid size={{ xs: 12, lg: isNewCycle ? 12 : 4 }}>
                    {isNewCycle ? (
                        <Card sx={{ mb: 3 }}>
                            <CardContent>
                                <Typography variant="h6" gutterBottom>Confirm and launch</Typography>
                                <Stack spacing={2}>
                                    <Grid container spacing={2}>
                                        <Grid size={{ xs: 12, md: 4 }}>
                                            <Typography variant="body2" color="text.secondary">Cycle</Typography>
                                            <Typography fontWeight={700}>{formData.name}</Typography>
                                            <Typography variant="body2" color="text.secondary">{cycleTypeLabels[formData.cycleType]}</Typography>
                                        </Grid>
                                        <Grid size={{ xs: 12, md: 4 }}>
                                            <Typography variant="body2" color="text.secondary">Performance period</Typography>
                                            <Typography fontWeight={700}>{formData.periodStart} to {formData.periodEnd}</Typography>
                                        </Grid>
                                        <Grid size={{ xs: 12, md: 4 }}>
                                            <Typography variant="body2" color="text.secondary">Participants</Typography>
                                            <Typography fontWeight={700}>{selectionSummary.selected} employee{selectionSummary.selected === 1 ? '' : 's'}</Typography>
                                        </Grid>
                                    </Grid>
                                    <Divider />
                                    <Box>
                                        <Typography variant="body2" fontWeight={700} gutterBottom>Selected employees</Typography>
                                        <Typography variant="body2" color="text.secondary">
                                            {selectedParticipants.map((employee) => employee.name).join(', ')}
                                        </Typography>
                                    </Box>
                                    <Divider />
                                    <Stack spacing={1}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <CheckCircle color="success" fontSize="small" />
                                            <Typography variant="body2">The cycle becomes active as soon as you create it.</Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <CheckCircle color="success" fontSize="small" />
                                            <Typography variant="body2">Employees start with self-assessment.</Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <CheckCircle color="success" fontSize="small" />
                                            <Typography variant="body2">Managers only join when their team member submits.</Typography>
                                        </Box>
                                    </Stack>
                                </Stack>
                            </CardContent>
                        </Card>
                    ) : (
                        <Card sx={{ mb: 3 }}>
                            <CardContent>
                                <Typography variant="h6" gutterBottom>Scope Configuration</Typography>
                                <Box sx={{ mt: 2 }}>
                                    {isHRAdmin && (
                                        <FormControl fullWidth sx={{ mb: 2 }}>
                                            <InputLabel>Appraisal Scope</InputLabel>
                                            <Select
                                                value={formData.scope?.type || 'organization'}
                                                label="Appraisal Scope"
                                                onChange={(e) => setFormData({
                                                    ...formData,
                                                    scope: {
                                                        ...formData.scope,
                                                        type: e.target.value as any,
                                                        targetIds: []
                                                    }
                                                })}
                                            >
                                                <MenuItem value="organization">Entire Organization</MenuItem>
                                                <MenuItem value="team">Specific Teams</MenuItem>
                                            </Select>
                                        </FormControl>
                                    )}

                                    {!isHRAdmin && (
                                        <Alert severity="info" sx={{ mb: 2 }}>
                                            This cycle is limited to your managed teams.
                                        </Alert>
                                    )}

                                    {(formData.scope?.type === 'team' || !isHRAdmin) && (
                                        <FormControl fullWidth>
                                            <InputLabel>Select Teams</InputLabel>
                                            <Select
                                                multiple
                                                value={formData.scope?.targetIds || []}
                                                label="Select Teams"
                                                onChange={(e) => {
                                                    const value = e.target.value;
                                                    setFormData({
                                                        ...formData,
                                                        scope: {
                                                            ...formData.scope,
                                                            type: 'team',
                                                            targetIds: typeof value === 'string' ? value.split(',') : value as string[]
                                                        }
                                                    });
                                                }}
                                                renderValue={(selected) => {
                                                    if (selected.length === 0) return <em>Select teams...</em>;
                                                    return (managedTeams as ManagedTeamOption[])
                                                        .filter((team) => selected.includes(normalizeManagedTeamId(team)))
                                                        .map((team) => normalizeManagedTeamName(team))
                                                        .join(', ');
                                                }}
                                            >
                                                {(managedTeams as ManagedTeamOption[]).length > 0 ? (
                                                    (managedTeams as ManagedTeamOption[]).map((team) => (
                                                        <MenuItem key={normalizeManagedTeamId(team)} value={normalizeManagedTeamId(team)}>
                                                            {normalizeManagedTeamName(team)}
                                                        </MenuItem>
                                                    ))
                                                ) : (
                                                    <MenuItem disabled>No managed teams found</MenuItem>
                                                )}
                                            </Select>
                                        </FormControl>
                                    )}
                                </Box>
                            </CardContent>
                        </Card>
                    )}

                    <Card sx={{ mb: 3 }}>
                        <CardContent>
                            <Typography variant="h6" gutterBottom>Rating Configuration</Typography>
                            <Box sx={{ mt: 2 }}>
                                <Typography variant="subtitle2" gutterBottom>OKR Weight: {formData.okrWeight}%</Typography>
                                <Slider
                                    value={formData.okrWeight}
                                    onChange={(_, value) => setFormData({ ...formData, okrWeight: value as number })}
                                    min={0}
                                    max={100}
                                    valueLabelDisplay="auto"
                                />
                                <Typography variant="caption" color="text.secondary">
                                    Competency Weight: {100 - formData.okrWeight}%
                                </Typography>
                            </Box>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardContent>
                            <Typography variant="h6" gutterBottom>Settings</Typography>
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                <FormControlLabel
                                    control={<Switch checked={formData.settings.allowSelfRating} onChange={(e) => setFormData({ ...formData, settings: { ...formData.settings, allowSelfRating: e.target.checked } })} />}
                                    label="Allow Self Rating"
                                />
                                <FormControlLabel
                                    control={<Switch checked={formData.settings.enableAiAssist} onChange={(e) => setFormData({ ...formData, settings: { ...formData.settings, enableAiAssist: e.target.checked } })} />}
                                    label="Enable AI Assistance"
                                />
                                <FormControlLabel
                                    control={<Switch checked={formData.settings.enablePeerFeedback} onChange={(e) => setFormData({ ...formData, settings: { ...formData.settings, enablePeerFeedback: e.target.checked } })} />}
                                    label="Enable Peer Feedback"
                                />
                                <FormControlLabel
                                    control={<Switch checked={formData.settings.requireSignOff} onChange={(e) => setFormData({ ...formData, settings: { ...formData.settings, requireSignOff: e.target.checked } })} />}
                                    label="Require Employee Sign-off"
                                />
                            </Box>
                        </CardContent>
                    </Card>
                </Grid>}
            </Grid>
        </Box>
    );
}
