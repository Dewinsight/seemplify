'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAppraisal, useUserContext } from '@/lib/hooks';
import api from '@/lib/api';
import {
  Box,
  Typography,
  Button,
  Paper,
  Alert,
  CircularProgress,
  Chip,
  Rating,
  TextField,
  Divider,
  Card,
  CardContent
} from '@mui/material';
import { ArrowBack, CheckCircle, SmartToy, Person, Star } from '@mui/icons-material';

export default function FinalReviewPage() {
    const params = useParams();
    const router = useRouter();
    const appraisalId = params.appraisalId as string;

    const { appraisal, isLoading, mutate } = useAppraisal(appraisalId);
    const { user, isManager, isHRAdmin } = useUserContext();

    const [aiLoading, setAiLoading] = useState(false);
    const [aiSuggestion, setAiSuggestion] = useState<any>(null);

    const [finalRating, setFinalRating] = useState<number>(3);
    const [finalRatingTouched, setFinalRatingTouched] = useState(false);
    const [justification, setJustification] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const isAssignedManager = useMemo(() => {
        if (!appraisal || !user) return false;
        return appraisal.manager?.userId === user?.id || appraisal.manager?.email === user?.email;
    }, [appraisal, user]);
    const hasManagerAccess = isAssignedManager || (!!isManager && !isHRAdmin);

    const selfRating = appraisal?.selfAssessment?.overallSelfRating;
    const managerRating = appraisal?.managerReview?.overallManagerRating;

    const fetchAiSuggestion = async () => {
        setAiLoading(true);
        try {
            const res = await api.post(`/appraisals/${appraisalId}/ai-rating-suggestion`);
            const suggestion = res.data?.data?.aiSuggestion || res.data?.aiSuggestion;
            setAiSuggestion(suggestion || null);
        } catch (e) {
            console.error('Failed to fetch AI suggestion', e);
        } finally {
            setAiLoading(false);
        }
    };

    // Initialize default rating once data is available
    useEffect(() => {
        if (!appraisal) return;
        if (finalRatingTouched) return;
        const suggested = aiSuggestion?.suggestedRating || managerRating || 3;
        setFinalRating(suggested);
    }, [appraisal, aiSuggestion, managerRating, finalRatingTouched]);

    // If there's a notable mismatch, auto-fetch AI arbitration.
    useEffect(() => {
        if (!appraisal) return;
        if (aiSuggestion) return;
        const hasDispute = !!appraisal.flags?.hasDispute;
        const hasGap = !!(selfRating && managerRating && Math.abs(selfRating - managerRating) >= 2);
        if ((hasDispute || hasGap) && !aiLoading) {
            fetchAiSuggestion();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [appraisal, aiSuggestion, selfRating, managerRating]);

    return (
        <Box>
            <Button startIcon={<ArrowBack />} onClick={() => router.push(`/appraisals/${appraisalId}`)} sx={{ mb: 2 }}>
                Back to Appraisal
            </Button>

            <Paper sx={{ p: 4 }}>
                <Typography variant="h5" fontWeight={700} gutterBottom>
                    Final Review
                </Typography>

                {isLoading && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                        <CircularProgress />
                    </Box>
                )}

                {!isLoading && !appraisal && (
                    <Alert severity="error">Appraisal not found</Alert>
                )}

                {!isLoading && appraisal && !(hasManagerAccess || isHRAdmin) && (
                    <Alert severity="error">Only an authorized appraiser can access final review.</Alert>
                )}

                {!isLoading && appraisal && (hasManagerAccess || isHRAdmin) && (
                    <>
                        {appraisal.status !== 'final_review_pending' && (
                            <Alert severity="warning" sx={{ mb: 3 }}>
                                This appraisal is not marked as Final Review Pending (current status: {appraisal.status}).
                            </Alert>
                        )}

                        <Alert severity="info" sx={{ mb: 3 }}>
                            Use this step to finalize the overall rating. AI can recommend a rating, but the final decision is yours.
                        </Alert>

                        <Card sx={{ mb: 3, bgcolor: 'action.hover' }}>
                            <CardContent>
                                <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                                    Rating Inputs
                                </Typography>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
                                    {selfRating ? (
                                        <Chip icon={<Person />} label={`Self: ${selfRating}/5`} />
                                    ) : (
                                        <Chip icon={<Person />} label="Self: N/A" variant="outlined" />
                                    )}
                                    {managerRating ? (
                                        <Chip icon={<Star />} label={`Manager: ${managerRating}/5`} />
                                    ) : (
                                        <Chip icon={<Star />} label="Manager: N/A" variant="outlined" />
                                    )}
                                    {selfRating && managerRating && Math.abs(selfRating - managerRating) >= 2 && (
                                        <Chip color="warning" label={`Gap: ${managerRating - selfRating > 0 ? '+' : ''}${managerRating - selfRating}`} />
                                    )}
                                </Box>
                            </CardContent>
                        </Card>

                        <Card sx={{ mb: 3, border: 1, borderColor: 'divider' }}>
                            <CardContent>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <SmartToy color="secondary" />
                                        <Typography variant="subtitle1" fontWeight={700}>
                                            AI Recommendation
                                        </Typography>
                                    </Box>
                                    {!aiSuggestion && (
                                        <Button
                                            size="small"
                                            variant="outlined"
                                            startIcon={aiLoading ? <CircularProgress size={16} /> : <SmartToy />}
                                            onClick={fetchAiSuggestion}
                                            disabled={aiLoading}
                                        >
                                            Get AI Suggestion
                                        </Button>
                                    )}
                                </Box>

                                {aiSuggestion ? (
                                    <Box>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
                                            <Rating value={aiSuggestion.suggestedRating} readOnly size="large" />
                                            <Chip label={`${aiSuggestion.suggestedRating}/5`} color="secondary" />
                                        </Box>
                                        <Typography variant="body2" color="text.secondary">
                                            {aiSuggestion.ratingJustification}
                                        </Typography>
                                    </Box>
                                ) : (
                                    <Typography variant="body2" color="text.secondary">
                                        AI suggestion is optional. You can finalize without it.
                                    </Typography>
                                )}
                            </CardContent>
                        </Card>

                        <Divider sx={{ my: 3 }} />

                        <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                            Final Rating Decision
                        </Typography>

                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                            <Rating
                                value={finalRating}
                                onChange={(_, v) => {
                                    setFinalRatingTouched(true);
                                    setFinalRating(v || 3);
                                }}
                                size="large"
                            />
                            <Chip label={`${finalRating}/5`} color={finalRating >= 4 ? 'success' : finalRating >= 3 ? 'info' : 'warning'} />
                            {aiSuggestion?.suggestedRating && finalRating !== aiSuggestion.suggestedRating && (
                                <Chip color="warning" label="Override AI" />
                            )}
                        </Box>

                        <TextField
                            fullWidth
                            multiline
                            minRows={3}
                            label="Justification (required if overriding AI suggestion)"
                            value={justification}
                            onChange={(e) => setJustification(e.target.value)}
                            sx={{ mb: 3 }}
                        />

                        <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
                            <Button
                                variant="contained"
                                color="success"
                                startIcon={submitting ? <CircularProgress size={18} color="inherit" /> : <CheckCircle />}
                                disabled={submitting || (aiSuggestion?.suggestedRating && finalRating !== aiSuggestion.suggestedRating && !justification.trim())}
                                onClick={async () => {
                                    setSubmitting(true);
                                    try {
                                        await api.post(`/appraisals/${appraisalId}/finalize`, {
                                            finalRating,
                                            justification: justification.trim() || undefined
                                        });
                                        mutate();
                                        router.push(`/appraisals/${appraisalId}`);
                                    } catch (e: any) {
                                        console.error('Finalize failed', e);
                                        alert(e.response?.data?.error || 'Failed to finalize appraisal');
                                    } finally {
                                        setSubmitting(false);
                                    }
                                }}
                            >
                                Complete Appraisal
                            </Button>
                        </Box>
                    </>
                )}
            </Paper>
        </Box>
    );
}
