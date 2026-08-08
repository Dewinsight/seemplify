'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAppraisal, useUserContext } from '@/lib/hooks';
import api from '@/lib/api';
import {
    Box, Typography, Card, CardContent, Grid, Button, TextField,
    Alert, Paper, CircularProgress, Chip, Divider, Snackbar
} from '@mui/material';
import {
    ArrowBack, Save, CheckCircle, Event, LocationOn, Link as LinkIcon,
    Person, Mic
} from '@mui/icons-material';

export default function DiscussionPage() {
    const params = useParams();
    const router = useRouter();
    const appraisalId = params.appraisalId as string;
    const { user, isManager } = useUserContext();
    const { appraisal, isLoading, mutate } = useAppraisal(appraisalId);

    const [saving, setSaving] = useState(false);
    const [notes, setNotes] = useState({
        agreedStrengths: '',
        agreedImprovements: '',
        developmentPlan: '',
        careerAspirations: '',
        supportNeeded: '',
        nextSteps: ''
    });
    const [meetingDetails, setMeetingDetails] = useState({
        scheduledDate: '',
        location: '',
        meetingLink: ''
    });
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' });

    useEffect(() => {
        if (appraisal?.discussion) {
            const d = appraisal.discussion;
            setNotes({
                agreedStrengths: d.notes?.agreedStrengths?.join('\n') || '',
                agreedImprovements: d.notes?.agreedImprovements?.join('\n') || '',
                developmentPlan: d.notes?.developmentPlan || '',
                careerAspirations: d.notes?.careerAspirations || '',
                supportNeeded: d.notes?.supportNeeded || '',
                nextSteps: d.notes?.nextSteps || ''
            });
            setMeetingDetails({
                scheduledDate: d.scheduledDate ? new Date(d.scheduledDate).toISOString().slice(0, 16) : '',
                location: d.location || '',
                meetingLink: d.meetingLink || ''
            });
        }
    }, [appraisal]);

    const handleAcknowledge = async () => {
        setSaving(true);
        try {
            await api.post(`/appraisals/${appraisalId}/acknowledge`);
            mutate();
            setSnackbar({ open: true, message: 'Discussion acknowledged!', severity: 'success' });
            setTimeout(() => router.push(`/appraisals/${appraisalId}`), 1500);
        } catch (error) {
            setSnackbar({ open: true, message: 'Failed to acknowledge', severity: 'error' });
        } finally {
            setSaving(false);
        }
    };

    const handleSave = async (markCompleted = false) => {
        setSaving(true);
        try {
            const payload = {
                notes: {
                    ...notes,
                    agreedStrengths: notes.agreedStrengths.split('\n').filter(s => s.trim()),
                    agreedImprovements: notes.agreedImprovements.split('\n').filter(s => s.trim())
                },
                ...meetingDetails,
                markCompleted
            };

            await api.put(`/appraisals/${appraisalId}/discussion`, payload);
            mutate();
            setSnackbar({
                open: true,
                message: markCompleted ? 'Discussion marked as completed!' : 'Saved successfully',
                severity: 'success'
            });
            if (markCompleted) {
                setTimeout(() => router.push(`/appraisals/${appraisalId}`), 1500);
            }
        } catch (error) {
            console.error('Save error:', error);
            setSnackbar({ open: true, message: 'Failed to save', severity: 'error' });
        } finally {
            setSaving(false);
        }
    };

    if (isLoading) return <CircularProgress />;
    if (!appraisal) return <Alert severity="error">Appraisal not found</Alert>;

    const readOnly = appraisal.status === 'completed' || appraisal.status === 'employee_acknowledged';

    return (
        <Box>
            {/* Header */}
            <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box>
                    <Button startIcon={<ArrowBack />} onClick={() => router.push(`/appraisals/${appraisalId}`)} sx={{ mb: 1 }}>
                        Back to Appraisal
                    </Button>
                    <Typography variant="h4" fontWeight={700}>Performance Discussion</Typography>
                    <Typography variant="body1" color="text.secondary">
                        {appraisal.employee.name} • {appraisal.cycleId?.name}
                    </Typography>
                </Box>
                {!readOnly && isManager && (
                    <Box sx={{ display: 'flex', gap: 2 }}>
                        <Button
                            variant="outlined"
                            startIcon={saving ? <CircularProgress size={16} /> : <Save />}
                            onClick={() => handleSave(false)}
                            disabled={saving}
                        >
                            Save Draft
                        </Button>
                        <Button
                            variant="contained"
                            color="success"
                            startIcon={<CheckCircle />}
                            onClick={() => handleSave(true)}
                            disabled={saving}
                        >
                            Complete Discussion
                        </Button>
                    </Box>
                )}
                {!isManager && ['discussion_completed', 'completed'].includes(appraisal.status) && !appraisal.discussion?.employeeAcknowledged && (
                    <Button
                        variant="contained"
                        color="success"
                        startIcon={saving ? <CircularProgress size={16} /> : <CheckCircle />}
                        onClick={handleAcknowledge}
                        disabled={saving}
                    >
                        Acknowledge Final Outcome
                    </Button>
                )}
            </Box>

            {/* Meeting Logistics */}
            <Paper sx={{ p: 3, mb: 3 }}>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 2 }}>
                    <Event color="primary" />
                    <Typography variant="h6">Meeting Details</Typography>
                </Box>
                <Grid container spacing={3}>
                    <Grid size={{ xs: 12, md: 4 }}>
                        <TextField
                            fullWidth
                            type="datetime-local"
                            label="Scheduled Date/Time"
                            InputLabelProps={{ shrink: true }}
                            value={meetingDetails.scheduledDate}
                            onChange={(e) => setMeetingDetails(prev => ({ ...prev, scheduledDate: e.target.value }))}
                            disabled={readOnly || !isManager}
                        />
                    </Grid>
                    <Grid size={{ xs: 12, md: 4 }}>
                        <TextField
                            fullWidth
                            label="Location"
                            placeholder="e.g. Conference Room A or Zoom"
                            value={meetingDetails.location}
                            onChange={(e) => setMeetingDetails(prev => ({ ...prev, location: e.target.value }))}
                            disabled={readOnly || !isManager}
                            InputProps={{ startAdornment: <LocationOn color="action" sx={{ mr: 1 }} /> }}
                        />
                    </Grid>
                    <Grid size={{ xs: 12, md: 4 }}>
                        <TextField
                            fullWidth
                            label="Meeting Link"
                            placeholder="https://zoom.us/..."
                            value={meetingDetails.meetingLink}
                            onChange={(e) => setMeetingDetails(prev => ({ ...prev, meetingLink: e.target.value }))}
                            disabled={readOnly || !isManager}
                            InputProps={{ startAdornment: <LinkIcon color="action" sx={{ mr: 1 }} /> }}
                        />
                    </Grid>
                </Grid>
            </Paper>

            {/* Discussion Notes */}
            <Card variant="outlined">
                <CardContent>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 3 }}>
                        <Mic color="primary" />
                        <Typography variant="h6">Discussion Notes & Outcomes</Typography>
                    </Box>

                    <Alert severity="info" sx={{ mb: 3 }}>
                        These notes summarize the agreement between Employee and Manager. Both parties will acknowledge these notes.
                    </Alert>

                    <Grid container spacing={3}>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <TextField
                                fullWidth
                                multiline
                                rows={4}
                                label="Agreed Strengths"
                                value={notes.agreedStrengths}
                                onChange={(e) => setNotes(prev => ({ ...prev, agreedStrengths: e.target.value }))}
                                disabled={readOnly || !isManager}
                                placeholder="List the key strengths agreed upon..."
                            />
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <TextField
                                fullWidth
                                multiline
                                rows={4}
                                label="Agreed Improvements"
                                value={notes.agreedImprovements}
                                onChange={(e) => setNotes(prev => ({ ...prev, agreedImprovements: e.target.value }))}
                                disabled={readOnly || !isManager}
                                placeholder="List the areas for improvement..."
                            />
                        </Grid>
                        <Grid size={{ xs: 12 }}>
                            <TextField
                                fullWidth
                                multiline
                                rows={3}
                                label="Development Plan for Next Period"
                                value={notes.developmentPlan}
                                onChange={(e) => setNotes(prev => ({ ...prev, developmentPlan: e.target.value }))}
                                disabled={readOnly || !isManager}
                                helperText="Provide detailed actions for development."
                            />
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <TextField
                                fullWidth
                                multiline
                                rows={3}
                                label="Career Aspirations Discussion"
                                value={notes.careerAspirations}
                                onChange={(e) => setNotes(prev => ({ ...prev, careerAspirations: e.target.value }))}
                                disabled={readOnly || !isManager}
                            />
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <TextField
                                fullWidth
                                multiline
                                rows={3}
                                label="Support Needed from Manager"
                                value={notes.supportNeeded}
                                onChange={(e) => setNotes(prev => ({ ...prev, supportNeeded: e.target.value }))}
                                disabled={readOnly || !isManager}
                            />
                        </Grid>
                    </Grid>
                </CardContent>
            </Card>

            <Snackbar
                open={snackbar.open}
                autoHideDuration={4000}
                onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
                message={snackbar.message}
            />
        </Box>
    );
}
