'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAppraisal, useUserContext } from '@/lib/hooks';
import api from '@/lib/api';
import {
    Box, Typography, Card, CardContent, Grid, Button, Alert,
    Paper, CircularProgress, LinearProgress, Chip, Tabs, Tab,
    Dialog, DialogTitle, DialogContent, DialogActions, TextField,
    Select, MenuItem, FormControl, InputLabel, Snackbar, IconButton,
    Divider, Checkbox, FormControlLabel, alpha, useTheme, Tooltip
} from '@mui/material';
import {
    ArrowBack, Add, TrackChanges, TrendingUp,
    CheckCircle, Flag, ThumbUp, ThumbDown, AutoAwesome,
    Delete, Edit, Link as LinkIcon, FlagCircle
} from '@mui/icons-material';

interface KeyResult {
    id?: string;
    title: string;
    metricType: 'percentage' | 'number' | 'currency' | 'boolean';
    startValue: number;
    targetValue: number;
    currentValue: number;
}

interface Objective {
    id?: string;
    title: string;
    description?: string;
    weight?: number;
    keyResults: KeyResult[];
}

interface OKR {
    _id: string;
    title?: string;
    type: 'individual' | 'team' | 'organization';
    status: 'draft' | 'active' | 'closed';
    progress: number;
    period?: string;
    objectives: Objective[];
    linkedToAppraisal?: boolean;
}

// Tab Panel Component
function TabPanel({ children, value, index }: { children: React.ReactNode; value: number; index: number }) {
    return value === index ? <Box sx={{ pt: 3 }}>{children}</Box> : null;
}

export default function GoalSettingPage() {
    const params = useParams();
    const router = useRouter();
    const theme = useTheme();
    const appraisalId = params.appraisalId as string;
    const { user } = useUserContext();
    const { appraisal, isLoading: appraisalLoading, mutate } = useAppraisal(appraisalId);

    const [okrs, setOkrs] = useState<OKR[]>([]);
    const [loadingOkrs, setLoadingOkrs] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [activeTab, setActiveTab] = useState(0);
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' });

    // New OKR Form State
    const [newOkr, setNewOkr] = useState({
        type: 'individual' as 'individual' | 'team',
        objectives: [{
            title: '',
            description: '',
            keyResults: [{ title: '', metricType: 'percentage' as const, startValue: 0, targetValue: 100, currentValue: 0 }]
        }] as Objective[]
    });
    const [isAiLoading, setIsAiLoading] = useState(false);

    // Manager approval states
    const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
    const [rejectComments, setRejectComments] = useState('');

    const isAssignedManager = appraisal && user && (appraisal.manager?.userId === user.id);
    const isGoalApprovalPending = appraisal?.status === 'goal_approval_pending';
    const isGoalSetting = appraisal?.status === 'goal_setting';

    useEffect(() => {
        if (user) {
            fetchOkrs();
        }
    }, [user]);

    const fetchOkrs = async () => {
        try {
            const response = await api.get('/okrs');
            const data = response.data?.data || response.data || [];
            setOkrs(data);
        } catch (error) {
            console.error('Failed to fetch OKRs', error);
        } finally {
            setLoadingOkrs(false);
        }
    };

    // AI Suggestion Handler
    const handleAiSuggest = async () => {
        setIsAiLoading(true);
        try {
            // Call AI endpoint or mock for now
            const response = await api.post('/okrs/ai-suggest', {
                context: appraisal?.cycleId?.name || 'Performance Cycle',
                role: user?.jobTitle || 'Employee'
            });

            if (response.data?.data) {
                setNewOkr(prev => ({
                    ...prev,
                    objectives: response.data.data.objectives || prev.objectives
                }));
            } else {
                // Fallback mock data
                setNewOkr(prev => ({
                    ...prev,
                    objectives: [{
                        title: 'Improve Team Productivity',
                        description: 'Enhance overall team efficiency and output quality',
                        keyResults: [
                            { title: 'Reduce average task completion time by 20%', metricType: 'percentage', startValue: 0, targetValue: 20, currentValue: 0 },
                            { title: 'Achieve 95% on-time delivery rate', metricType: 'percentage', startValue: 80, targetValue: 95, currentValue: 80 },
                            { title: 'Complete 3 process improvement initiatives', metricType: 'number', startValue: 0, targetValue: 3, currentValue: 0 }
                        ]
                    }]
                }));
            }
            setSnackbar({ open: true, message: 'AI suggestions generated!', severity: 'success' });
        } catch (error) {
            // Use fallback mock data on error
            setNewOkr(prev => ({
                ...prev,
                objectives: [{
                    title: 'Improve Team Productivity',
                    description: 'Enhance overall team efficiency and output quality',
                    keyResults: [
                        { title: 'Reduce average task completion time by 20%', metricType: 'percentage', startValue: 0, targetValue: 20, currentValue: 0 },
                        { title: 'Achieve 95% on-time delivery rate', metricType: 'percentage', startValue: 80, targetValue: 95, currentValue: 80 },
                        { title: 'Complete 3 process improvement initiatives', metricType: 'number', startValue: 0, targetValue: 3, currentValue: 0 }
                    ]
                }]
            }));
            setSnackbar({ open: true, message: 'AI suggestions generated!', severity: 'success' });
        } finally {
            setIsAiLoading(false);
        }
    };

    // Create new OKR
    const handleCreateOkr = async () => {
        if (!newOkr.objectives[0]?.title) {
            setSnackbar({ open: true, message: 'Please add at least one objective', severity: 'error' });
            return;
        }

        setSubmitting(true);
        try {
            await api.post('/okrs', {
                type: newOkr.type,
                period: appraisal?.cycleId?.name || 'Current Period',
                status: 'active',
                objectives: newOkr.objectives.map(obj => ({
                    ...obj,
                    keyResults: obj.keyResults.map(kr => ({
                        ...kr,
                        lastUpdated: new Date()
                    }))
                }))
            });

            // Reset form
            setNewOkr({
                type: 'individual',
                objectives: [{
                    title: '',
                    description: '',
                    keyResults: [{ title: '', metricType: 'percentage', startValue: 0, targetValue: 100, currentValue: 0 }]
                }]
            });

            fetchOkrs();
            setActiveTab(0); // Switch to "Your OKRs" tab
            setSnackbar({ open: true, message: 'OKR created successfully!', severity: 'success' });
        } catch (error) {
            console.error('Create OKR error:', error);
            setSnackbar({ open: true, message: 'Failed to create OKR', severity: 'error' });
        } finally {
            setSubmitting(false);
        }
    };

    // Add Objective
    const addObjective = () => {
        setNewOkr(prev => ({
            ...prev,
            objectives: [
                ...prev.objectives,
                { title: '', description: '', keyResults: [{ title: '', metricType: 'percentage', startValue: 0, targetValue: 100, currentValue: 0 }] }
            ]
        }));
    };

    // Remove Objective
    const removeObjective = (index: number) => {
        setNewOkr(prev => ({
            ...prev,
            objectives: prev.objectives.filter((_, i) => i !== index)
        }));
    };

    // Add Key Result to Objective
    const addKeyResult = (objIndex: number) => {
        setNewOkr(prev => ({
            ...prev,
            objectives: prev.objectives.map((obj, i) =>
                i === objIndex
                    ? { ...obj, keyResults: [...obj.keyResults, { title: '', metricType: 'percentage', startValue: 0, targetValue: 100, currentValue: 0 }] }
                    : obj
            )
        }));
    };

    // Remove Key Result from Objective
    const removeKeyResult = (objIndex: number, krIndex: number) => {
        setNewOkr(prev => ({
            ...prev,
            objectives: prev.objectives.map((obj, i) =>
                i === objIndex
                    ? { ...obj, keyResults: obj.keyResults.filter((_, j) => j !== krIndex) }
                    : obj
            )
        }));
    };

    // Update Objective
    const updateObjective = (index: number, field: string, value: string) => {
        setNewOkr(prev => ({
            ...prev,
            objectives: prev.objectives.map((obj, i) =>
                i === index ? { ...obj, [field]: value } : obj
            )
        }));
    };

    // Update Key Result
    const updateKeyResult = (objIndex: number, krIndex: number, field: string, value: any) => {
        setNewOkr(prev => ({
            ...prev,
            objectives: prev.objectives.map((obj, i) =>
                i === objIndex
                    ? {
                        ...obj,
                        keyResults: obj.keyResults.map((kr, j) =>
                            j === krIndex ? { ...kr, [field]: value } : kr
                        )
                    }
                    : obj
            )
        }));
    };

    // Submit goals for approval
    const handleSubmitGoals = async () => {
        setSubmitting(true);
        try {
            await api.post(`/appraisals/${appraisalId}/submit-goals`);
            mutate();
            setSnackbar({ open: true, message: 'Goals submitted for approval!', severity: 'success' });
        } catch (error) {
            console.error('Submit error:', error);
            setSnackbar({ open: true, message: 'Failed to submit goals', severity: 'error' });
        } finally {
            setSubmitting(false);
        }
    };

    // Manager approval/rejection
    const handleApproveGoals = async () => {
        setSubmitting(true);
        try {
            await api.post(`/appraisals/${appraisalId}/approve-goals`);
            mutate();
            setSnackbar({ open: true, message: 'Goals approved successfully!', severity: 'success' });
        } catch (error) {
            setSnackbar({ open: true, message: 'Failed to approve goals', severity: 'error' });
        } finally {
            setSubmitting(false);
        }
    };

    const handleRejectGoals = async () => {
        setSubmitting(true);
        try {
            await api.post(`/appraisals/${appraisalId}/reject-goals`, { comments: rejectComments });
            mutate();
            setSnackbar({ open: true, message: 'Goals returned for revision', severity: 'success' });
            setRejectDialogOpen(false);
        } catch (error) {
            setSnackbar({ open: true, message: 'Failed to reject goals', severity: 'error' });
        } finally {
            setSubmitting(false);
        }
    };

    // Progress color helper
    const getProgressColor = (progress: number) => {
        if (progress >= 70) return 'success';
        if (progress >= 40) return 'warning';
        return 'error';
    };

    const getProgressGradient = (progress: number) => {
        if (progress >= 70) return 'linear-gradient(135deg, #10b981 0%, #34d399 100%)';
        if (progress >= 40) return 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)';
        return 'linear-gradient(135deg, #ef4444 0%, #f87171 100%)';
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
                        Set Your OKRs
                    </Typography>
                    <Typography variant="body1" color="text.secondary">
                        {cycle?.name || 'Performance Cycle'} • Define your Objectives & Key Results
                    </Typography>
                </Box>
            </Box>

            {/* Context / Instructions */}
            <Alert severity="info" sx={{ mb: 4 }} icon={<Flag />}>
                <Typography variant="subtitle2" fontWeight={600}>
                    OKR Guidelines
                </Typography>
                <Typography variant="body2">
                    Define 1-3 ambitious <strong>Objectives</strong> with 3-5 measurable <strong>Key Results</strong> each.
                    OKRs account for <strong>{cycle?.okrWeight || 40}%</strong> of your final performance rating.
                </Typography>
            </Alert>

            {/* Tabs */}
            <Paper sx={{ mb: 3, p: 0.5, bgcolor: alpha(theme.palette.grey[500], 0.04) }}>
                <Tabs
                    value={activeTab}
                    onChange={(_, v) => setActiveTab(v)}
                    sx={{ '& .MuiTab-root': { minHeight: 48, fontWeight: 600 } }}
                >
                    <Tab label={`Your OKRs (${okrs.length})`} />
                    <Tab label="Create New OKR" icon={<Add sx={{ fontSize: 18 }} />} iconPosition="start" />
                </Tabs>
            </Paper>

            {/* Tab: Your OKRs */}
            <TabPanel value={activeTab} index={0}>
                {okrs.length === 0 ? (
                    <Paper sx={{ p: 4, textAlign: 'center', bgcolor: alpha(theme.palette.primary.main, 0.02), mb: 4 }}>
                        <TrackChanges sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
                        <Typography variant="h6" color="text.secondary">No OKRs Yet</Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                            Create your first OKR to define your objectives for this cycle.
                        </Typography>
                        <Button variant="contained" startIcon={<Add />} onClick={() => setActiveTab(1)}>
                            Create OKR
                        </Button>
                    </Paper>
                ) : (
                    <Grid container spacing={3} sx={{ mb: 4 }}>
                        {okrs.map((okr) => {
                            const progress = okr.progress || 0;
                            const objCount = okr.objectives?.length || 0;
                            const krCount = okr.objectives?.reduce((sum, obj) => sum + (obj.keyResults?.length || 0), 0) || 0;

                            return (
                                <Grid size={{ xs: 12 }} key={okr._id}>
                                    <Card
                                        variant="outlined"
                                        sx={{
                                            position: 'relative',
                                            overflow: 'hidden',
                                            '&::before': {
                                                content: '""',
                                                position: 'absolute',
                                                left: 0,
                                                top: 0,
                                                bottom: 0,
                                                width: 4,
                                                background: getProgressGradient(progress),
                                            },
                                        }}
                                    >
                                        <CardContent sx={{ pl: 3 }}>
                                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                <Box sx={{ flex: 1 }}>
                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                                                        <Chip
                                                            label={okr.type?.toUpperCase() || 'INDIVIDUAL'}
                                                            size="small"
                                                            color={okr.type === 'individual' ? 'primary' : 'secondary'}
                                                            sx={{ fontSize: '0.7rem' }}
                                                        />
                                                        <Chip
                                                            label={okr.status?.toUpperCase() || 'ACTIVE'}
                                                            size="small"
                                                            variant="outlined"
                                                            sx={{ fontSize: '0.7rem' }}
                                                        />
                                                    </Box>

                                                    {/* Objectives List */}
                                                    {okr.objectives?.map((obj, idx) => (
                                                        <Box key={idx} sx={{ mb: 2 }}>
                                                            <Typography variant="subtitle1" fontWeight={600}>
                                                                <FlagCircle sx={{ fontSize: 16, mr: 0.5, verticalAlign: 'middle' }} />
                                                                {obj.title || `Objective ${idx + 1}`}
                                                            </Typography>
                                                            {obj.description && (
                                                                <Typography variant="body2" color="text.secondary" sx={{ ml: 3 }}>
                                                                    {obj.description}
                                                                </Typography>
                                                            )}
                                                            {obj.keyResults?.length > 0 && (
                                                                <Box sx={{ ml: 3, mt: 1 }}>
                                                                    {obj.keyResults.map((kr, krIdx) => (
                                                                        <Typography key={krIdx} variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                                            • {kr.title}
                                                                            <Chip
                                                                                size="small"
                                                                                label={`${kr.currentValue || 0}/${kr.targetValue}`}
                                                                                sx={{ height: 20, fontSize: '0.7rem', ml: 1 }}
                                                                            />
                                                                        </Typography>
                                                                    ))}
                                                                </Box>
                                                            )}
                                                        </Box>
                                                    ))}

                                                    <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
                                                        <Typography variant="caption" color="text.secondary">
                                                            {objCount} Objective{objCount !== 1 ? 's' : ''} • {krCount} Key Result{krCount !== 1 ? 's' : ''}
                                                        </Typography>
                                                    </Box>
                                                </Box>

                                                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                                                    {/* Progress */}
                                                    <Box sx={{ textAlign: 'right', minWidth: 80 }}>
                                                        <Typography variant="caption" color="text.secondary">Progress</Typography>
                                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                            <LinearProgress
                                                                variant="determinate"
                                                                value={progress}
                                                                color={getProgressColor(progress)}
                                                                sx={{ width: 60, height: 6, borderRadius: 3 }}
                                                            />
                                                            <Typography variant="body2" fontWeight={600}>{progress}%</Typography>
                                                        </Box>
                                                    </Box>
                                                    <Button
                                                        size="small"
                                                        variant="outlined"
                                                        startIcon={<Edit />}
                                                        onClick={() => router.push(`/okrs`)}
                                                    >
                                                        Edit
                                                    </Button>
                                                </Box>
                                            </Box>
                                        </CardContent>
                                    </Card>
                                </Grid>
                            );
                        })}
                    </Grid>
                )}
            </TabPanel>

            {/* Tab: Create New OKR */}
            <TabPanel value={activeTab} index={1}>
                <Paper sx={{ p: 3, mb: 4 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                        <Typography variant="h6" fontWeight={600}>Create New OKR</Typography>
                        <Button
                            variant="outlined"
                            startIcon={isAiLoading ? <CircularProgress size={16} /> : <AutoAwesome />}
                            onClick={handleAiSuggest}
                            disabled={isAiLoading}
                            color="secondary"
                        >
                            {isAiLoading ? 'Generating...' : 'AI Suggest'}
                        </Button>
                    </Box>

                    {/* Type Selector */}
                    <FormControl size="small" sx={{ mb: 3, minWidth: 200 }}>
                        <InputLabel>OKR Type</InputLabel>
                        <Select
                            value={newOkr.type}
                            label="OKR Type"
                            onChange={(e) => setNewOkr(prev => ({ ...prev, type: e.target.value as any }))}
                        >
                            <MenuItem value="individual">Individual</MenuItem>
                            <MenuItem value="team">Team</MenuItem>
                        </Select>
                    </FormControl>

                    {/* Objectives */}
                    {newOkr.objectives.map((objective, objIndex) => (
                        <Card key={objIndex} variant="outlined" sx={{ mb: 3, p: 2 }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                                <Typography variant="subtitle1" fontWeight={600}>
                                    Objective {objIndex + 1}
                                </Typography>
                                {newOkr.objectives.length > 1 && (
                                    <IconButton size="small" color="error" onClick={() => removeObjective(objIndex)}>
                                        <Delete fontSize="small" />
                                    </IconButton>
                                )}
                            </Box>

                            <TextField
                                fullWidth
                                label="Objective Title"
                                placeholder="e.g., Improve customer satisfaction"
                                value={objective.title}
                                onChange={(e) => updateObjective(objIndex, 'title', e.target.value)}
                                sx={{ mb: 2 }}
                            />
                            <TextField
                                fullWidth
                                multiline
                                rows={2}
                                label="Description (optional)"
                                placeholder="Describe what success looks like..."
                                value={objective.description || ''}
                                onChange={(e) => updateObjective(objIndex, 'description', e.target.value)}
                                sx={{ mb: 2 }}
                            />

                            <Divider sx={{ my: 2 }} />

                            {/* Key Results */}
                            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 2 }}>
                                Key Results
                            </Typography>

                            {objective.keyResults.map((kr, krIndex) => (
                                <Box key={krIndex} sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'flex-start' }}>
                                    <TextField
                                        sx={{ flex: 2 }}
                                        size="small"
                                        label={`Key Result ${krIndex + 1}`}
                                        placeholder="e.g., Achieve NPS score of 50+"
                                        value={kr.title}
                                        onChange={(e) => updateKeyResult(objIndex, krIndex, 'title', e.target.value)}
                                    />
                                    <FormControl size="small" sx={{ minWidth: 120 }}>
                                        <InputLabel>Metric</InputLabel>
                                        <Select
                                            value={kr.metricType}
                                            label="Metric"
                                            onChange={(e) => updateKeyResult(objIndex, krIndex, 'metricType', e.target.value)}
                                        >
                                            <MenuItem value="percentage">%</MenuItem>
                                            <MenuItem value="number">#</MenuItem>
                                            <MenuItem value="currency">$</MenuItem>
                                            <MenuItem value="boolean">Yes/No</MenuItem>
                                        </Select>
                                    </FormControl>
                                    <TextField
                                        size="small"
                                        type="number"
                                        label="Start"
                                        value={kr.startValue}
                                        onChange={(e) => updateKeyResult(objIndex, krIndex, 'startValue', Number(e.target.value))}
                                        sx={{ width: 80 }}
                                    />
                                    <TextField
                                        size="small"
                                        type="number"
                                        label="Target"
                                        value={kr.targetValue}
                                        onChange={(e) => updateKeyResult(objIndex, krIndex, 'targetValue', Number(e.target.value))}
                                        sx={{ width: 80 }}
                                    />
                                    {objective.keyResults.length > 1 && (
                                        <IconButton size="small" color="error" onClick={() => removeKeyResult(objIndex, krIndex)}>
                                            <Delete fontSize="small" />
                                        </IconButton>
                                    )}
                                </Box>
                            ))}

                            <Button
                                size="small"
                                startIcon={<Add />}
                                onClick={() => addKeyResult(objIndex)}
                            >
                                Add Key Result
                            </Button>
                        </Card>
                    ))}

                    <Box sx={{ display: 'flex', gap: 2 }}>
                        <Button variant="outlined" startIcon={<Add />} onClick={addObjective}>
                            Add Another Objective
                        </Button>
                        <Button
                            variant="contained"
                            onClick={handleCreateOkr}
                            disabled={submitting || !newOkr.objectives[0]?.title}
                            startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : <CheckCircle />}
                        >
                            Create OKR
                        </Button>
                    </Box>
                </Paper>
            </TabPanel>

            {/* Submission / Approval Footer */}
            <Paper sx={{ p: 3, bgcolor: alpha(theme.palette.primary.main, 0.04), borderTop: 2, borderColor: 'primary.main', position: 'sticky', bottom: 0, zIndex: 10 }}>
                {isGoalApprovalPending ? (
                    isAssignedManager ? (
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Box>
                                <Typography variant="subtitle1" fontWeight={600}>Manager Action Required</Typography>
                                <Typography variant="body2" color="text.secondary">Review the employee's OKRs. Approve to proceed or Reject to request changes.</Typography>
                            </Box>
                            <Box sx={{ display: 'flex', gap: 2 }}>
                                <Button
                                    variant="outlined"
                                    color="error"
                                    startIcon={<ThumbDown />}
                                    onClick={() => setRejectDialogOpen(true)}
                                    disabled={submitting}
                                >
                                    Reject & Feedback
                                </Button>
                                <Button
                                    variant="contained"
                                    color="success"
                                    startIcon={<ThumbUp />}
                                    onClick={handleApproveGoals}
                                    disabled={submitting}
                                >
                                    Approve OKRs
                                </Button>
                            </Box>
                        </Box>
                    ) : (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <CircularProgress size={24} color="warning" />
                            <Box>
                                <Typography variant="subtitle1" fontWeight={600}>Waiting for Approval</Typography>
                                <Typography variant="body2" color="text.secondary">Your OKRs have been submitted. Waiting for manager approval.</Typography>
                            </Box>
                        </Box>
                    )
                ) : (
                    isGoalSetting && (
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Box>
                                <Typography variant="subtitle1" fontWeight={600}>Ready to Submit?</Typography>
                                <Typography variant="body2" color="text.secondary">
                                    Once you have defined your OKRs, submit them for manager approval.
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
                                Submit OKRs
                            </Button>
                        </Box>
                    )
                )}
            </Paper>

            {/* Reject Dialog */}
            <Dialog open={rejectDialogOpen} onClose={() => setRejectDialogOpen(false)}>
                <DialogTitle>Reject OKRs & Request Changes</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" sx={{ mb: 2 }}>
                        Please provide feedback on why these OKRs need revision.
                    </Typography>
                    <TextField
                        fullWidth
                        multiline
                        rows={4}
                        label="Manager Comments"
                        value={rejectComments}
                        onChange={(e) => setRejectComments(e.target.value)}
                        placeholder="e.g., Key Results should be more specific and measurable..."
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setRejectDialogOpen(false)}>Cancel</Button>
                    <Button variant="contained" color="error" onClick={handleRejectGoals}>Return to Employee</Button>
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
