'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useUserContext } from '@/lib/hooks';
import api from '@/lib/api';
import {
    Box, Typography, Card, CardContent, Grid, Button, Chip,
    LinearProgress, Divider, CircularProgress, Alert
} from '@mui/material';
import {
    ArrowBack, Edit,
    CheckCircle
} from '@mui/icons-material';

interface AppraisalCycle {
    _id: string;
    name: string;
    description?: string;
    cycleType: 'annual' | 'semi-annual' | 'quarterly' | 'probation' | 'project' | 'adhoc';
    periodStart: string;
    periodEnd: string;
    currentPhase: string;
    status: 'draft' | 'active' | 'completed' | 'cancelled';
    phases: Record<string, { startDate?: string; endDate?: string; isActive: boolean }>;
    okrWeight: number;
    settings: {
        allowSelfRating: boolean;
        requireDocumentUpload: boolean;
        requireOkrAlignment: boolean;
        enablePeerFeedback: boolean;
        enable360Feedback: boolean;
        enableAiAssist: boolean;
        enableChat: boolean;
        requireSignOff: boolean;
    };
    stats?: {
        totalEmployees: number;
        completedAppraisals: number;
        pendingSelfAssessment: number;
        pendingManagerReview: number;
        pendingCalibration?: number;
        pendingFinalReview?: number;
        selfAssessmentSubmitted?: number;
        managerReviewSubmitted?: number;
        finalized?: number;
        overdueAppraisals?: number;
        averageRating?: number | null;
    };
}

const cycleTypeLabels: Record<string, string> = {
    'annual': 'Annual Review',
    'semi-annual': 'Semi-Annual Review',
    'quarterly': 'Quarterly Review',
    'probation': 'Probation Review',
    'project': 'Project-Based Review',
    'adhoc': 'Ad-Hoc Review'
};

const phaseLabels: Record<string, string> = {
    'draft': 'Draft',
    'goalSetting': 'Goal Setting',
    'selfAssessment': 'Self-Assessment',
    'managerReview': 'Manager Review',
    'calibration': 'Calibration',
    'finalReview': 'Final Review',
    'completed': 'Completed'
};

export default function AppraisalCycleDetailsPage() {
    const router = useRouter();
    const params = useParams();
    const { isHRAdmin } = useUserContext();
    const [cycle, setCycle] = useState<AppraisalCycle | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        const fetchCycle = async () => {
            try {
                const response = await api.get(`/appraisals/cycles/${params.id}`);
                setCycle(response.data.data);
            } catch (err: any) {
                console.error('Fetch cycle error:', err);
                setError(err.response?.data?.error || 'Failed to fetch appraisal cycle');
            } finally {
                setLoading(false);
            }
        };

        if (params.id && params.id !== 'new') {
            fetchCycle();
        } else if (params.id === 'new') {
            router.replace('/admin/appraisal-cycles/new/edit');
        }
    }, [params.id, router]);

    if (loading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                <CircularProgress />
            </Box>
        );
    }

    if (error || !cycle) {
        return (
            <Alert severity="error">
                {error || 'Cycle not found'}
                <Button onClick={() => router.push('/admin/appraisal-cycles')} sx={{ ml: 2 }}>
                    Back to List
                </Button>
            </Alert>
        );
    }

    const progress = cycle.stats
        ? (cycle.stats.completedAppraisals / (cycle.stats.totalEmployees || 1)) * 100
        : 0;

    return (
        <Box>
            {/* Header */}
            <Box sx={{ mb: 4 }}>
                <Button
                    startIcon={<ArrowBack />}
                    onClick={() => router.push('/admin/appraisal-cycles')}
                    sx={{ mb: 2 }}
                >
                    Back to Cycles
                </Button>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <Box>
                        <Typography variant="h4" fontWeight={700} gutterBottom>
                            {cycle.name}
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                            <Chip
                                label={cycleTypeLabels[cycle.cycleType]}
                                size="small"
                                variant="outlined"
                            />
                            <Chip
                                label={cycle.status.toUpperCase()}
                                color={cycle.status === 'active' ? 'success' : cycle.status === 'completed' ? 'info' : 'default'}
                                size="small"
                            />
                        </Box>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        <Button
                            variant="outlined"
                            startIcon={<Edit />}
                            onClick={() => router.push(`/admin/appraisal-cycles/${cycle._id}/edit`)}
                        >
                            Edit Cycle
                        </Button>
                    </Box>
                </Box>
            </Box>

            <Grid container spacing={3}>
                {/* Main Info */}
                <Grid size={{ xs: 12, md: 8 }}>
                    <Card sx={{ mb: 3 }}>
                        <CardContent>
                            <Typography variant="h6" gutterBottom>Overview</Typography>
                            <Typography variant="body1" paragraph>
                                {cycle.description || 'No description provided.'}
                            </Typography>

                            <Divider sx={{ my: 2 }} />

                            <Grid container spacing={2}>
                                <Grid size={{ xs: 6 }}>
                                    <Typography variant="subtitle2" color="text.secondary">Period</Typography>
                                    <Typography variant="body1">
                                        {new Date(cycle.periodStart).toLocaleDateString()} - {new Date(cycle.periodEnd).toLocaleDateString()}
                                    </Typography>
                                </Grid>
                                <Grid size={{ xs: 6 }}>
                                    <Typography variant="subtitle2" color="text.secondary">Current Phase</Typography>
                                    <Chip
                                        label={phaseLabels[cycle.currentPhase] || cycle.currentPhase}
                                        color="primary"
                                        variant="outlined"
                                        size="small"
                                    />
                                </Grid>
                            </Grid>
                        </CardContent>
                    </Card>

                    {/* Phases Timeline */}
                    <Card sx={{ mb: 3 }}>
                        <CardContent>
                            <Typography variant="h6" gutterBottom>Phases & Timeline</Typography>
                            <Box sx={{ mt: 2 }}>
                                {Object.entries(cycle.phases).map(([key, phase]) => {
                                    if (!phase) return null;
                                    return (
                                        <Box key={key} sx={{ display: 'flex', alignItems: 'center', mb: 2, opacity: phase.isActive ? 1 : 0.7 }}>
                                            <Box sx={{ mr: 2, minWidth: 150 }}>
                                                <Typography variant="subtitle2" fontWeight={phase.isActive ? 700 : 400}>
                                                    {phaseLabels[key]}
                                                </Typography>
                                            </Box>
                                            <Box sx={{ flex: 1 }}>
                                                <Typography variant="body2" color="text.secondary">
                                                    {phase.startDate ? new Date(phase.startDate).toLocaleDateString() : 'Not set'} - {phase.endDate ? new Date(phase.endDate).toLocaleDateString() : 'Not set'}
                                                </Typography>
                                            </Box>
                                            {phase.isActive && <Chip label="Active" color="success" size="small" />}
                                        </Box>
                                    );
                                })}
                            </Box>
                        </CardContent>
                    </Card>
                </Grid>

                {/* Sidebar */}
                <Grid size={{ xs: 12, md: 4 }}>
                    <Card sx={{ mb: 3 }}>
                        <CardContent>
                            <Typography variant="h6" gutterBottom>Statistics</Typography>
                            <Box sx={{ mb: 2 }}>
                                <Typography variant="body2" color="text.secondary" gutterBottom>Completion Progress</Typography>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <LinearProgress variant="determinate" value={progress} sx={{ flex: 1, height: 8, borderRadius: 4 }} />
                                    <Typography variant="body2" fontWeight={600}>{Math.round(progress)}%</Typography>
                                </Box>
                            </Box>

                            <Grid container spacing={2}>
                                <Grid size={{ xs: 6 }}>
                                    <Box sx={{ textAlign: 'center', p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
                                        <Typography variant="h4" fontWeight={700}>{cycle.stats?.totalEmployees || 0}</Typography>
                                        <Typography variant="caption" color="text.secondary">Total Employees</Typography>
                                    </Box>
                                </Grid>
                                <Grid size={{ xs: 6 }}>
                                    <Box sx={{ textAlign: 'center', p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
                                        <Typography variant="h4" fontWeight={700} color="success.main">
                                            {cycle.stats?.completedAppraisals || 0}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">Completed</Typography>
                                    </Box>
                                </Grid>
                                <Grid size={{ xs: 6 }}>
                                    <Box sx={{ textAlign: 'center', p: 1, bgcolor: 'warning.lighter', borderRadius: 1 }}>
                                        <Typography variant="h6" fontWeight={700} color="warning.main">
                                            {cycle.stats?.pendingSelfAssessment || 0}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">Pending Self</Typography>
                                    </Box>
                                </Grid>
                                <Grid size={{ xs: 6 }}>
                                    <Box sx={{ textAlign: 'center', p: 1, bgcolor: 'info.lighter', borderRadius: 1 }}>
                                        <Typography variant="h6" fontWeight={700} color="info.main">
                                            {cycle.stats?.pendingManagerReview || 0}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">Pending Manager</Typography>
                                    </Box>
                                </Grid>
                                <Grid size={{ xs: 6 }}>
                                    <Box sx={{ textAlign: 'center', p: 1, bgcolor: 'secondary.lighter', borderRadius: 1 }}>
                                        <Typography variant="h6" fontWeight={700} color="secondary.main">
                                            {cycle.stats?.pendingCalibration || 0}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">Pending Calibration</Typography>
                                    </Box>
                                </Grid>
                                <Grid size={{ xs: 6 }}>
                                    <Box sx={{ textAlign: 'center', p: 1, bgcolor: 'error.lighter', borderRadius: 1 }}>
                                        <Typography variant="h6" fontWeight={700} color="error.main">
                                            {cycle.stats?.overdueAppraisals || 0}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">Overdue</Typography>
                                    </Box>
                                </Grid>
                            </Grid>
                            {cycle.stats?.averageRating != null && (
                                <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: 'block' }}>
                                    Average final rating: {cycle.stats.averageRating}
                                </Typography>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardContent>
                            <Typography variant="h6" gutterBottom>Settings</Typography>
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <Typography variant="body2">Self Rating</Typography>
                                    {cycle.settings.allowSelfRating ? <CheckCircle color="success" fontSize="small" /> : <Typography variant="caption">Disabled</Typography>}
                                </Box>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <Typography variant="body2">AI Assistance</Typography>
                                    {cycle.settings.enableAiAssist ? <CheckCircle color="success" fontSize="small" /> : <Typography variant="caption">Disabled</Typography>}
                                </Box>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <Typography variant="body2">Peer Feedback</Typography>
                                    {cycle.settings.enablePeerFeedback ? <CheckCircle color="success" fontSize="small" /> : <Typography variant="caption">Disabled</Typography>}
                                </Box>
                                <Divider sx={{ my: 1 }} />
                                <Typography variant="subtitle2">Rating Weight</Typography>
                                <Typography variant="body2">OKRs: {cycle.okrWeight}% | Competencies: {100 - cycle.okrWeight}%</Typography>
                            </Box>
                        </CardContent>
                    </Card>
                </Grid>
            </Grid>
        </Box>
    );
}
