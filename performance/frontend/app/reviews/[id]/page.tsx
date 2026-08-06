'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import api from '@/lib/api';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  LinearProgress,
  Rating,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
  useTheme,
  alpha,
} from '@mui/material';
import { ArrowBack, AutoFixHigh, CheckCircle, RateReview } from '@mui/icons-material';

type ReviewPermissions = {
  canEditSelf: boolean;
  canEditManager: boolean;
  canView: boolean;
};

export default function ReviewDetailPage() {
  const params = useParams();
  const router = useRouter();
  const theme = useTheme();

  const reviewId = params.id as string;

  const [review, setReview] = useState<any>(null);
  const [permissions, setPermissions] = useState<ReviewPermissions | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selfContent, setSelfContent] = useState('');
  const [selfRating, setSelfRating] = useState<number | null>(null);
  const [managerContent, setManagerContent] = useState('');
  const [managerRating, setManagerRating] = useState<number | null>(null);

  const [submittingSelf, setSubmittingSelf] = useState(false);
  const [submittingManager, setSubmittingManager] = useState(false);
  const [loadingSelfAi, setLoadingSelfAi] = useState(false);
  const [loadingManagerAi, setLoadingManagerAi] = useState(false);

  const ratingScale = useMemo(() => {
    const scale = review?.cycleId?.settings?.ratingScale;
    return typeof scale === 'number' && [3, 4, 5].includes(scale) ? scale : 5;
  }, [review]);

  const selfDone = !!review?.selfEvaluation?.submittedAt;
  const managerDone = !!review?.managerEvaluation?.submittedAt;
  const statusLabel = managerDone ? 'Completed' : selfDone ? 'Manager Review' : 'Self Review';

  const activeStep = managerDone ? 2 : selfDone ? 1 : 0;

  const fetchReview = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get(`/reviews/${reviewId}`);
      const data = res.data?.data;
      const perms = res.data?.permissions;
      setReview(data);
      setPermissions(perms || null);

      setSelfContent(data?.selfEvaluation?.content || '');
      setSelfRating(data?.selfEvaluation?.rating ?? null);
      setManagerContent(data?.managerEvaluation?.content || '');
      setManagerRating(data?.managerEvaluation?.rating ?? null);
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Failed to load review');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!reviewId) return;
    fetchReview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewId]);

  const handleSubmitSelf = async () => {
    if (!permissions?.canEditSelf) return;
    setSubmittingSelf(true);
    try {
      await api.post(`/reviews/${reviewId}/self-evaluation`, {
        content: selfContent,
        rating: selfRating,
      });
      await fetchReview();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Failed to submit self review');
    } finally {
      setSubmittingSelf(false);
    }
  };

  const handleSubmitManager = async () => {
    if (!permissions?.canEditManager) return;
    setSubmittingManager(true);
    try {
      await api.post(`/reviews/${reviewId}/manager-evaluation`, {
        content: managerContent,
        rating: managerRating,
      });
      await fetchReview();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Failed to submit manager review');
    } finally {
      setSubmittingManager(false);
    }
  };

  const handleSelfAiAssist = async () => {
    setLoadingSelfAi(true);
    try {
      const res = await api.post(`/reviews/${reviewId}/self-ai-suggest`, {
        field: 'achievements',
        existingContent: selfContent,
        context: review?.cycleId?.title || 'Performance Review'
      });
      const suggestion = res.data?.data?.suggestion || '';
      if (suggestion) {
        setSelfContent((prev) => (prev ? `${prev}\n\n${suggestion}` : suggestion));
      }
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Failed to get AI suggestion');
    } finally {
      setLoadingSelfAi(false);
    }
  };

  const handleManagerAiAssist = async () => {
    setLoadingManagerAi(true);
    try {
      const res = await api.post(`/reviews/${reviewId}/manager-ai-assist`, {
        managerNotes: managerContent
      });
      const data = res.data?.data || {};
      if (data?.draftSummary) {
        setManagerContent((prev) => (prev ? `${prev}\n\n${data.draftSummary}` : data.draftSummary));
      } else if (data?.ratingJustification) {
        setManagerContent((prev) => (prev ? `${prev}\n\n${data.ratingJustification}` : data.ratingJustification));
      }
      if (typeof data?.suggestedRating === 'number') {
        setManagerRating(data.suggestedRating);
      }
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Failed to get AI assistance');
    } finally {
      setLoadingManagerAi(false);
    }
  };

  return (
    <Box className="animate-fadeIn" maxWidth="lg" sx={{ mx: 'auto' }}>
      <Button startIcon={<ArrowBack />} onClick={() => router.push('/reviews')} sx={{ mb: 3 }}>
        Back to Reviews
      </Button>

      {isLoading && (
        <Box>
          <Typography variant="h4" fontWeight={800} sx={{ opacity: 0.3, mb: 3 }}>
            Performance Review
          </Typography>
          <LinearProgress sx={{ borderRadius: 2 }} />
        </Box>
      )}

      {!isLoading && error && <Alert severity="error">{error}</Alert>}

      {!isLoading && review && (
        <>
          <Typography
            variant="h4"
            fontWeight={800}
            gutterBottom
            sx={{
              background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a78bfa 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            {review.cycleId?.title || 'Performance Review'}
          </Typography>

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 3 }}>
            <Chip
              icon={<RateReview />}
              label={statusLabel}
              variant="outlined"
              color={managerDone ? 'success' : selfDone ? 'warning' : 'default'}
            />
            {selfDone && <Chip label="Self Submitted" color="success" size="small" variant="outlined" />}
            {!selfDone && <Chip label="Self Pending" color="warning" size="small" variant="outlined" />}
            {managerDone && <Chip label="Manager Submitted" color="success" size="small" variant="outlined" />}
            {!managerDone && selfDone && <Chip label="Manager Pending" color="warning" size="small" variant="outlined" />}
          </Box>

          <Stepper
            activeStep={activeStep}
            sx={{
              mb: 4,
              p: 3,
              bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.10 : 0.04),
              borderRadius: 3,
              border: 1,
              borderColor: 'divider',
            }}
          >
            {['Self Review', 'Manager Review', 'Completed'].map((label) => (
              <Step key={label}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>

          <Card
            sx={{
              position: 'relative',
              overflow: 'hidden',
              mb: 3,
              '&::before': {
                content: '""',
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: 4,
                background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a78bfa 100%)',
              },
            }}
          >
            <CardContent sx={{ pt: 4 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, mb: 1 }}>
                <Typography variant="h6" fontWeight={700}>
                  Self Evaluation
                </Typography>
                {permissions?.canEditSelf && (
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={loadingSelfAi ? <CircularProgress size={14} /> : <AutoFixHigh />}
                    onClick={handleSelfAiAssist}
                    disabled={loadingSelfAi}
                  >
                    AI Suggest
                  </Button>
                )}
              </Box>

              {permissions && !permissions.canEditSelf && !selfDone && (
                <Alert severity="info" sx={{ mb: 2 }}>
                  Self review is not editable right now.
                </Alert>
              )}

              <Typography variant="subtitle2" gutterBottom>
                Rating
              </Typography>
              <Rating
                value={selfRating}
                onChange={(_, v) => setSelfRating(v)}
                readOnly={!permissions?.canEditSelf}
                max={ratingScale}
                size="large"
                sx={{ mb: 2 }}
              />

              <TextField
                fullWidth
                multiline
                minRows={6}
                variant="outlined"
                label="Your reflection"
                placeholder="Summarize your achievements, challenges, and growth this period..."
                value={selfContent}
                onChange={(e) => setSelfContent(e.target.value)}
                InputProps={{ readOnly: !permissions?.canEditSelf }}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    bgcolor: alpha(theme.palette.grey[500], theme.palette.mode === 'dark' ? 0.06 : 0.02),
                  },
                }}
              />

              {review.selfEvaluation?.aiRefinement && (
                <Alert severity="info" sx={{ mt: 2 }}>
                  <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                    AI Refinement
                  </Typography>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                    {review.selfEvaluation.aiRefinement}
                  </Typography>
                </Alert>
              )}

              {permissions?.canEditSelf && (
                <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
                  <Button
                    variant="contained"
                    endIcon={submittingSelf ? <CircularProgress size={18} color="inherit" /> : <CheckCircle />}
                    disabled={submittingSelf || !selfRating || !selfContent.trim()}
                    onClick={handleSubmitSelf}
                  >
                    Submit Self Review
                  </Button>
                </Box>
              )}
            </CardContent>
          </Card>

          <Card
            sx={{
              position: 'relative',
              overflow: 'hidden',
              '&::before': {
                content: '""',
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: 4,
                background: 'linear-gradient(135deg, #ec4899 0%, #f472b6 100%)',
              },
            }}
          >
            <CardContent sx={{ pt: 4 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, mb: 1 }}>
                <Typography variant="h6" fontWeight={700}>
                  Manager Evaluation
                </Typography>
                {permissions?.canEditManager && (
                  <Button
                    size="small"
                    variant="outlined"
                    color="secondary"
                    startIcon={loadingManagerAi ? <CircularProgress size={14} /> : <AutoFixHigh />}
                    onClick={handleManagerAiAssist}
                    disabled={loadingManagerAi}
                  >
                    AI Assist
                  </Button>
                )}
              </Box>

              {!selfDone && (
                <Alert severity="info" sx={{ mb: 2 }}>
                  Manager review becomes available after the self review is submitted.
                </Alert>
              )}

              <Typography variant="subtitle2" gutterBottom>
                Rating
              </Typography>
              <Rating
                value={managerRating}
                onChange={(_, v) => setManagerRating(v)}
                readOnly={!permissions?.canEditManager}
                max={ratingScale}
                size="large"
                sx={{ mb: 2 }}
              />

              <TextField
                fullWidth
                multiline
                minRows={6}
                variant="outlined"
                label="Manager feedback"
                placeholder="Provide constructive feedback and development guidance..."
                value={managerContent}
                onChange={(e) => setManagerContent(e.target.value)}
                InputProps={{ readOnly: !permissions?.canEditManager }}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    bgcolor: alpha(theme.palette.grey[500], theme.palette.mode === 'dark' ? 0.06 : 0.02),
                  },
                }}
              />

              {review.managerEvaluation?.aiSummary && (
                <Alert severity="info" sx={{ mt: 2 }}>
                  <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                    AI Summary
                  </Typography>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                    {review.managerEvaluation.aiSummary}
                  </Typography>
                </Alert>
              )}

              {review.managerEvaluation?.biasDetection?.hasBias && (
                <Alert severity="warning" sx={{ mt: 2 }}>
                  <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                    Potential Bias Detected
                  </Typography>
                  {Array.isArray(review.managerEvaluation.biasDetection.flaggedAreas) &&
                    review.managerEvaluation.biasDetection.flaggedAreas.length > 0 && (
                      <Box component="ul" sx={{ m: 0, pl: 2 }}>
                        {review.managerEvaluation.biasDetection.flaggedAreas.map((a: string, idx: number) => (
                          <li key={idx}>
                            <Typography variant="body2">{a}</Typography>
                          </li>
                        ))}
                      </Box>
                    )}
                </Alert>
              )}

              {permissions?.canEditManager && (
                <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
                  <Button
                    variant="contained"
                    color="secondary"
                    endIcon={submittingManager ? <CircularProgress size={18} color="inherit" /> : <CheckCircle />}
                    disabled={submittingManager || !managerRating || !managerContent.trim()}
                    onClick={handleSubmitManager}
                  >
                    Submit Manager Review
                  </Button>
                </Box>
              )}
            </CardContent>
          </Card>

          <Divider sx={{ my: 4 }} />

          {managerDone && (
            <Alert severity="success">
              This performance review is complete.
            </Alert>
          )}
        </>
      )}
    </Box>
  );
}
