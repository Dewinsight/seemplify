'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useUserContext } from '@/lib/hooks';
import api from '@/lib/api';
import {
    Box, Typography, Card, CardContent, Grid, Button, TextField,
    FormControl, InputLabel, Select, MenuItem, Slider, Divider,
    FormControlLabel, Switch, CircularProgress, Alert
} from '@mui/material';
import { Save, ArrowBack } from '@mui/icons-material';

const cycleTypeLabels: Record<string, string> = {
    'annual': 'Annual Review',
    'semi-annual': 'Semi-Annual Review',
    'quarterly': 'Quarterly Review',
    'probation': 'Probation Review',
    'project': 'Project-Based Review',
    'adhoc': 'Ad-Hoc Review'
};

const phaseLabels: Record<string, string> = {
    'goalSetting': 'Goal Setting',
    'selfAssessment': 'Self-Assessment',
    'managerReview': 'Manager Review',
    'calibration': 'Calibration',
    'finalReview': 'Final Review'
};

export default function EditAppraisalCyclePage() {
    const router = useRouter();
    const params = useParams();
    const { isHRAdmin } = useUserContext();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    // Helper to format date for input
    const formatDateForInput = (dateString: string) => {
        if (!dateString) return '';
        return new Date(dateString).toISOString().split('T')[0];
    };

    const [formData, setFormData] = useState({
        name: '',
        description: '',
        cycleType: 'annual',
        periodStart: '',
        periodEnd: '',
        okrWeight: 40,
        phases: {
            goalSetting: { startDate: '', endDate: '' },
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
    });

    useEffect(() => {
        const fetchCycle = async () => {
            try {
                const response = await api.get(`/appraisals/cycles/${params.id}`);
                const cycle = response.data.data;

                setFormData({
                    name: cycle.name,
                    description: cycle.description || '',
                    cycleType: cycle.cycleType,
                    periodStart: formatDateForInput(cycle.periodStart),
                    periodEnd: formatDateForInput(cycle.periodEnd),
                    okrWeight: cycle.okrWeight,
                    phases: {
                        goalSetting: {
                            startDate: formatDateForInput(cycle.phases?.goalSetting?.startDate),
                            endDate: formatDateForInput(cycle.phases?.goalSetting?.endDate)
                        },
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

        if (params.id) {
            fetchCycle();
        }
    }, [params.id]);

    const handleSave = async () => {
        setSaving(true);
        try {
            await api.put(`/appraisals/cycles/${params.id}`, formData);
            router.push(`/admin/appraisal-cycles/${params.id}`);
        } catch (err: any) {
            console.error('Update cycle error:', err);
            setError(err.response?.data?.error || 'Failed to update cycle');
        } finally {
            setSaving(false);
        }
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
                    Back to List
                </Button>
            </Alert>
        );
    }

    return (
        <Box>
            <Box sx={{ mb: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Button
                        startIcon={<ArrowBack />}
                        onClick={() => router.push(`/admin/appraisal-cycles/${params.id}`)}
                    >
                        Back
                    </Button>
                    <Typography variant="h4" fontWeight={700}>
                        Edit Cycle
                    </Typography>
                </Box>
                <Button
                    variant="contained"
                    startIcon={saving ? <CircularProgress size={20} color="inherit" /> : <Save />}
                    onClick={handleSave}
                    disabled={saving}
                >
                    Save Changes
                </Button>
            </Box>

            <Grid container spacing={3}>
                <Grid size={{ xs: 12, md: 8 }}>
                    <Card sx={{ mb: 3 }}>
                        <CardContent>
                            <Typography variant="h6" gutterBottom>Basic Information</Typography>
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
                    </Card>

                    <Card>
                        <CardContent>
                            <Typography variant="h6" gutterBottom>Phase Timeline</Typography>
                            <Typography variant="body2" color="text.secondary" paragraph>
                                Define the start and end dates for each phase of the appraisal cycle.
                            </Typography>

                            <Grid container spacing={2}>
                                {Object.entries(phaseLabels).map(([phaseKey, label]) => (
                                    <Grid size={{ xs: 12 }} key={phaseKey}>
                                        <Typography variant="subtitle2" gutterBottom>{label}</Typography>
                                        <Grid container spacing={2}>
                                            <Grid size={{ xs: 6 }}>
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
                                                            [phaseKey]: { ...formData.phases[phaseKey as keyof typeof formData.phases], startDate: e.target.value }
                                                        }
                                                    })}
                                                    InputLabelProps={{ shrink: true }}
                                                />
                                            </Grid>
                                            <Grid size={{ xs: 6 }}>
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
                                                            [phaseKey]: { ...formData.phases[phaseKey as keyof typeof formData.phases], endDate: e.target.value }
                                                        }
                                                    })}
                                                    InputLabelProps={{ shrink: true }}
                                                />
                                            </Grid>
                                        </Grid>
                                        <Divider sx={{ my: 2 }} />
                                    </Grid>
                                ))}
                            </Grid>
                        </CardContent>
                    </Card>
                </Grid>

                <Grid size={{ xs: 12, md: 4 }}>
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
                </Grid>
            </Grid>
        </Box>
    );
}
