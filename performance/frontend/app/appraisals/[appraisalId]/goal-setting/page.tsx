'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAppraisal, useUserContext } from '@/lib/hooks';
import api from '@/lib/api';
import {
    Box, Typography, Card, CardContent, Grid, Button, Alert,
    Paper, CircularProgress, LinearProgress, Chip,
    Dialog, DialogTitle, DialogContent, DialogActions, TextField,
    Select, MenuItem, FormControl, InputLabel, Snackbar
} from '@mui/material';
import {
    ArrowBack, Save, Send, Add, Target, TrendingUp,
    CheckCircle, Flag, CalendarToday
} from '@mui/icons-material';

interface OKR {
    _id: string;
    title: string;
    type: 'individual' | 'team' | 'organization';
    status: 'draft' | 'active' | 'completed' | 'cancelled';
    progress: number;
    objectives: Array<{
        id: string;
        title: string;
        keyResults: Array<{
            id: string;
            title: string;
            target: number;
            current: number;
            unit: string;
        }>
    }>
}

export default function GoalSettingPage() {
    const params = useParams();
    const router = useRouter();
    const appraisalId = params.appraisalId as string;
    const { user } = useUserContext();
    const { appraisal, isLoading: appraisalLoading, mutate } = useAppraisal(appraisalId);

    const [okrs, setOkrs] = useState<OKR[]>([]);
    const [loadingOkrs, setLoadingOkrs] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' });

    // New OKR Form
    const [newOkr, setNewOkr] = useState({
        title: '',
        type: 'individual',
        description: ''
    });

    useEffect(() => {
        if (user) {
            fetchOkrs();
        }
    }, [user]);

    const fetchOkrs = async () => {
        try {
            // Fetch OKRs for the current user
            // In a real implementation, we should filter by the cycle's period
            const response = await api.get('/okrs/my-okrs');
            // Assuming api returns { data: [...] } or just array
            const data = response.data?.data || response.data || [];
            setOkrs(data);
        } catch (error) {
            console.error('Failed to fetch OKRs', error);
        } finally {
            setLoadingOkrs(false);
        }
    };

    const handleCreateOkr = async () => {
        try {
            await api.post('/okrs', {
                ...newOkr,
                owner: user?.id,
                period: appraisal?.cycleId?.name || 'Current Period',
                startDate: new Date(),
                endDate: new Date(new Date().setMonth(new Date().getMonth() + 3)), // Default 3 months
                objectives: [] // Start empty
            });
            setCreateDialogOpen(false);
            fetchOkrs();
            setSnackbar({ open: true, message: 'Goal created successfully', severity: 'success' });
        } catch (error) {
            // Ideally specific error handling
            console.error(error);
            setSnackbar({ open: true, message: 'Failed to create goal', severity: 'error' });
        }
    };

    const handleSubmitGoals = async () => {
        setSubmitting(true);
        try {
            await api.post(`/appraisals/${appraisalId}/submit-goals`);
            mutate();
            setSnackbar({ open: true, message: 'Goals submitted successfully!', severity: 'success' });
            setTimeout(() => router.push(`/appraisals/${appraisalId}`), 1500);
        } catch (error) {
            console.error('Submit error:', error);
            setSnackbar({ open: true, message: 'Failed to submit goals', severity: 'error' });
        } finally {
            setSubmitting(false);
        }
    };

    if (appraisalLoading || loadingOkrs) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
                <CircularProgress />
            </Box>
        );
    }

    if (!appraisal) {
        return <Alert severity="error">Appraisal not found</Alert>;
    }

    const cycle = appraisal.cycleId;

    return (
        <Box>
            {/* Header */}
            <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box>
                    <Button
                        startIcon={<ArrowBack />}
                        onClick={() => router.push(`/appraisals/${appraisalId}`)}
                        sx={{ mb: 1 }}
                    >
                        Back to Appraisal
                    </Button>
                    <Typography variant="h4" fontWeight={700}>
                        Goal Setting
                    </Typography>
                    <Typography variant="body1" color="text.secondary">
                        {cycle?.name || 'Performance Cycle'} • Define your objectives for this period
                    </Typography>
                </Box>
                <Button
                    variant="contained"
                    startIcon={<Add />}
                    onClick={() => setCreateDialogOpen(true)}
                >
                    Add New Goal
                </Button>
            </Box>

            {/* Context / Instructions */}
            <Alert severity="info" sx={{ mb: 4 }} icon={<Flag />}>
                <Typography variant="subtitle2" fontWeight={600}>
                    Set Your Goals
                </Typography>
                <Typography variant="body2">
                    Please define your goals (OKRs) for this cycle. These goals will account for
                    <strong> {cycle?.okrWeight || 0}% </strong> of your final performance rating.
                    Ensure they are aligned with your department objectives.
                </Typography>
            </Alert>

            {/* OKR List */}
            <Typography variant="h6" fontWeight={600} gutterBottom>
                Your Active Goals
            </Typography>

            {okrs.length === 0 ? (
                <Paper sx={{ p: 4, textAlign: 'center', bgcolor: 'grey.50', mb: 4 }}>
                    <Target sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
                    <Typography variant="h6" color="text.secondary">No Goals Set Yet</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                        Start by adding your first objective for this period.
                    </Typography>
                    <Button variant="outlined" startIcon={<Add />} onClick={() => setCreateDialogOpen(true)}>
                        Create Goal
                    </Button>
                </Paper>
            ) : (
                <Grid container spacing={3} sx={{ mb: 4 }}>
                    {okrs.map((okr) => (
                        <Grid item xs={12} key={okr._id}>
                            <Card variant="outlined">
                                <CardContent>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                        <Box>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                                                <Chip
                                                    label={okr.type.toUpperCase()}
                                                    size="small"
                                                    color={okr.type === 'individual' ? 'primary' : 'secondary'}
                                                    sx={{ fontSize: '0.7rem' }}
                                                />
                                                <Typography variant="h6">{okr.title}</Typography>
                                            </Box>
                                            {okr.objectives?.length > 0 && (
                                                <Typography variant="body2" color="text.secondary">
                                                    {okr.objectives.length} Key Results
                                                </Typography>
                                            )}
                                        </Box>
                                        <Button size="small" variant="outlined" onClick={() => router.push(`/okrs/${okr._id}`)}>
                                            Edit
                                        </Button>
                                    </Box>
                                </CardContent>
                            </Card>
                        </Grid>
                    ))}
                </Grid>
            )}

            {/* Submission Footer */}
            <Paper sx={{ p: 3, bgcolor: 'primary.lighter', borderTop: 1, borderColor: 'primary.main' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Box>
                        <Typography variant="subtitle1" fontWeight={600}>Ready to Proceed?</Typography>
                        <Typography variant="body2" color="text.secondary">
                            Once you have defined all your goals, click Submit to move to the next phase.
                        </Typography>
                    </Box>
                    <Button
                        variant="contained"
                        color="success"
                        size="large"
                        startIcon={submitting ? <CircularProgress size={20} color="inherit" /> : <CheckCircle />}
                        disabled={submitting || okrs.length === 0}
                        onClick={handleSubmitGoals}
                    >
                        Submit Goals
                    </Button>
                </Box>
            </Paper>

            {/* Create Dialog */}
            <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Create New Goal</DialogTitle>
                <DialogContent>
                    <Box sx={{ mt: 1 }}>
                        <TextField
                            fullWidth
                            label="Goal Title"
                            value={newOkr.title}
                            onChange={(e) => setNewOkr(prev => ({ ...prev, title: e.target.value }))}
                            placeholder="e.g. Improve System Performance"
                            sx={{ mb: 2 }}
                        />
                        <FormControl fullWidth sx={{ mb: 2 }}>
                            <InputLabel>Type</InputLabel>
                            <Select
                                value={newOkr.type}
                                label="Type"
                                onChange={(e) => setNewOkr(prev => ({ ...prev, type: e.target.value as any }))}
                            >
                                <MenuItem value="individual">Individual</MenuItem>
                                <MenuItem value="team">Team</MenuItem>
                            </Select>
                        </FormControl>
                        <TextField
                            fullWidth
                            multiline
                            rows={3}
                            label="Description"
                            value={newOkr.description}
                            onChange={(e) => setNewOkr(prev => ({ ...prev, description: e.target.value }))}
                        />
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
                    <Button variant="contained" onClick={handleCreateOkr} disabled={!newOkr.title}>Create</Button>
                </DialogActions>
            </Dialog>

            <Snackbar
                open={snackbar.open}
                autoHideDuration={4000}
                onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
                message={snackbar.message}
            />
        </Box>
    );
}
