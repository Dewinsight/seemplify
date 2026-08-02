'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAppraisal, useUserContext } from '@/lib/hooks';
import api from '@/lib/api';
import {
  Box, Typography, Card, CardContent, Grid, Button, TextField, Chip, Alert,
  Paper, Stepper, Step, StepLabel, Rating, LinearProgress,
  Dialog, DialogTitle, DialogContent, DialogActions, CircularProgress,
  Accordion, AccordionSummary, AccordionDetails, Divider, Tooltip,
  Snackbar, Slider, Select, MenuItem, FormControl, InputLabel, Avatar, Badge
} from '@mui/material';
import {
  Save, Send, ArrowBack, ArrowForward, Psychology, Lightbulb, Star,
  ExpandMore, CheckCircle, Warning, AutoAwesome, Compare, Person,
  TrendingUp, TrendingDown, Balance, EmojiObjects, Flag, Visibility, Comment,
  PieChart, Calculate, SmartToy
} from '@mui/icons-material';

interface ManagerReviewData {
  overallSummary: {
    achievements: string;
    strengths: string;
    improvements: string;
    recommendations: string;
    promotionReadiness: 'not_ready' | 'developing' | 'ready' | 'overdue';
  };
  competencyRatings: Array<{
    competencyId: string;
    competencyName: string;
    managerRating: number;
    managerComments: string;
    selfRating?: number;
    gapFromSelf?: number;
  }>;
  okrAssessment: Array<{
    okrId: string;
    okrTitle: string;
    managerVerifiedCompletion: number;
    managerComments: string;
    qualityRating: number;
    employeeCompletion?: number;
  }>;
  overallManagerRating: number;
}

interface ScoringData {
  okrScore: number;
  competencyScore: number;
  compositeScore: number;
  breakdown: {
    okrWeight: number;
    competencyWeight: number;
    okrContribution: number;
    competencyContribution: number;
  };
  ratingLabel: string;
}

interface AISuggestion {
  suggestedRating: number;
  ratingJustification: string;
  keyStrengths?: string[];
  developmentAreas?: string[];
  calibrationNotes?: string;
  ratingGaps?: {
    selfVsObjective?: string;
    concerns?: string[];
  };
}

const ratingLabels: Record<number, string> = {
  1: 'Needs Improvement',
  2: 'Partially Meets',
  3: 'Meets Expectations',
  4: 'Exceeds Expectations',
  5: 'Outstanding'
};

const promotionReadinessLabels: Record<string, { label: string; color: 'error' | 'warning' | 'success' | 'info' }> = {
  'not_ready': { label: 'Not Ready', color: 'error' },
  'developing': { label: 'Developing', color: 'warning' },
  'ready': { label: 'Ready for Promotion', color: 'success' },
  'overdue': { label: 'Overdue for Promotion', color: 'info' }
};

function getApiErrorMessage(error: any, fallback: string) {
  return error?.response?.data?.error || fallback;
}

export default function ManagerReviewPage() {
  const params = useParams();
  const router = useRouter();
  const appraisalId = params.appraisalId as string;
  const { user, isManager } = useUserContext();

  const { appraisal, isLoading, mutate } = useAppraisal(appraisalId);
  const aiAssistEnabled = appraisal?.cycleId?.settings?.enableAiAssist !== false;

  const [activeStep, setActiveStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiAssist, setAiAssist] = useState<any>(null);
  const [biasCheck, setBiasCheck] = useState<any>(null);
  const [biasAcknowledged, setBiasAcknowledged] = useState(false);
  const [managerReviewStarted, setManagerReviewStarted] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' | 'warning' });

  // Form data
  const [formData, setFormData] = useState<ManagerReviewData>({
    overallSummary: {
      achievements: '',
      strengths: '',
      improvements: '',
      recommendations: '',
      promotionReadiness: 'developing'
    },
    competencyRatings: [],
    okrAssessment: [],
    overallManagerRating: 3
  });

  const [feedbackList, setFeedbackList] = useState<any[]>([]);
  const [scoringData, setScoringData] = useState<ScoringData | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<AISuggestion | null>(null);
  const [scoringLoading, setScoringLoading] = useState(false);

  // Initialize form data from appraisal
  useEffect(() => {
    if (appraisal) {
      const existing = appraisal.managerReview || {};
      const selfAssessment = appraisal.selfAssessment || {};
      const cycle = appraisal.cycleId;

      // Initialize competencies from cycle with self-ratings for comparison
      const competencies = cycle?.competencies?.map((c: any) => {
        const selfRating = selfAssessment.competencyRatings?.find((r: any) => r.competencyId === c.id);
        const managerRating = existing.competencyRatings?.find((r: any) => r.competencyId === c.id);
        return {
          competencyId: c.id,
          competencyName: c.name,
          managerRating: managerRating?.managerRating || 3,
          managerComments: managerRating?.managerComments || '',
          selfRating: selfRating?.selfRating || null,
          gapFromSelf: null
        };
      }) || [];

      // Initialize OKRs with employee's self-assessment
      const okrs = selfAssessment.okrAssessment?.map((okr: any) => {
        const managerOkr = existing.okrAssessment?.find((o: any) => o.okrId === okr.okrId);
        return {
          okrId: okr.okrId,
          okrTitle: okr.okrTitle,
          managerVerifiedCompletion: managerOkr?.managerVerifiedCompletion ?? okr.completionPercentage ?? 0,
          managerComments: managerOkr?.managerComments || '',
          qualityRating: managerOkr?.qualityRating || 3,
          employeeCompletion: okr.completionPercentage
        };
      }) || [];

      setFormData({
        overallSummary: existing.overallSummary || {
          achievements: '',
          strengths: '',
          improvements: '',
          recommendations: '',
          promotionReadiness: 'developing'
        },
        competencyRatings: competencies,
        okrAssessment: okrs,
        overallManagerRating: existing.overallManagerRating || 3
      });
    }
  }, [appraisal]);
  useEffect(() => {
    if (appraisal) {
      fetchFeedback();
      fetchScoringData();
    }
  }, [appraisal]);

  useEffect(() => {
    if (!appraisalId) {
      setManagerReviewStarted(false);
    }
  }, [appraisalId]);

  useEffect(() => {
    if (!appraisal || !isManager || managerReviewStarted) return;
    if (!appraisal.selfAssessment?.submittedAt || appraisal.managerReview?.submittedAt) return;

    const startableStatuses = ['self_assessment_submitted', 'manager_review_pending', 'manager_review_in_progress'];
    if (!startableStatuses.includes(appraisal.status)) return;

    const startManagerReview = async () => {
      try {
        await api.post(`/appraisals/${appraisalId}/manager-review/start`);
        setManagerReviewStarted(true);
        mutate();
      } catch (e) {
        console.error('Failed to mark manager review as started', e);
      }
    };

    startManagerReview();
  }, [appraisal, appraisalId, isManager, managerReviewStarted, mutate]);

  const fetchFeedback = async () => {
    try {
      const res = await api.get('/feedback/direct-reports');
      // Filter for this employee
      // The API returns object keyed by user ID
      const employeeId = appraisal.employee.userId;
      const userFeedbackData = res.data?.data?.[employeeId];
      if (userFeedbackData) {
        setFeedbackList(userFeedbackData.feedback || []);
      }
    } catch (e) {
      console.error('Failed to fetch feedback context', e);
    }
  };

  const fetchScoringData = async () => {
    setScoringLoading(true);
    try {
      const res = await api.get(`/appraisals/${appraisalId}/scoring`);
      if (res.data?.success && res.data?.data) {
        setScoringData(res.data.data);
      } else if (res.data && !res.data.success) {
        // Direct response without wrapper
        setScoringData(res.data);
      }
    } catch (e) {
      console.error('Failed to fetch scoring data', e);
    } finally {
      setScoringLoading(false);
    }
  };

  const fetchAISuggestion = async () => {
    if (!aiAssistEnabled) {
      setSnackbar({ open: true, message: 'AI assistance is disabled for this cycle.', severity: 'warning' });
      return;
    }
    setScoringLoading(true);
    try {
      const res = await api.post(`/appraisals/${appraisalId}/ai-rating-suggestion`);
      if (res.data?.success && res.data?.data?.aiSuggestion) {
        setAiSuggestion(res.data.data.aiSuggestion);
      } else if (res.data?.aiSuggestion) {
        setAiSuggestion(res.data.aiSuggestion);
      }
    } catch (e) {
      console.error('Failed to fetch AI suggestion', e);
    } finally {
      setScoringLoading(false);
    }
  };
  const handleSave = async (showNotification = true) => {
    setSaving(true);
    try {
      // Calculate gaps
      const competenciesWithGaps = formData.competencyRatings.map(c => ({
        ...c,
        gapFromSelf: c.selfRating ? c.managerRating - c.selfRating : null
      }));

      await api.post(`/appraisals/${appraisalId}/manager-review`, {
        managerReview: { ...formData, competencyRatings: competenciesWithGaps },
        submit: false
      });
      mutate();
      if (showNotification) {
        setSnackbar({ open: true, message: 'Progress saved successfully!', severity: 'success' });
      }
      return true;
    } catch (error) {
      console.error('Save error:', error);
      setSnackbar({
        open: true,
        message: getApiErrorMessage(error, 'Failed to save progress'),
        severity: 'error'
      });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    let hasPotentialBias = Boolean(biasCheck?.hasPotentialBias);

    // Check for bias first when AI assistance is enabled.
    if (aiAssistEnabled && !biasCheck) {
      hasPotentialBias = await checkForBias();
    }

    if (aiAssistEnabled && hasPotentialBias && !biasAcknowledged) {
      setSnackbar({
        open: true,
        message: 'Potential bias detected. Review it, then click submit again to confirm.',
        severity: 'warning'
      });
      setBiasAcknowledged(true);
      return;
    }

    setSubmitting(true);
    try {
      await api.post(`/appraisals/${appraisalId}/manager-review`, {
        managerReview: formData,
        submit: true
      });
      mutate();
      setSnackbar({ open: true, message: 'Manager review submitted successfully!', severity: 'success' });
      setTimeout(() => router.push(`/appraisals/${appraisalId}`), 1500);
    } catch (error) {
      console.error('Submit error:', error);
      setSnackbar({
        open: true,
        message: getApiErrorMessage(error, 'Failed to submit review'),
        severity: 'error'
      });
    } finally {
      setSubmitting(false);
    }
  };

  const getAIAssist = async () => {
    if (!aiAssistEnabled) {
      setSnackbar({ open: true, message: 'AI assistance is disabled for this cycle.', severity: 'warning' });
      return;
    }
    setAiLoading(true);
    try {
      const response = await api.post(`/appraisals/${appraisalId}/ai-assist`, {
        managerNotes: formData.overallSummary
      });
      setAiAssist(response.data);
    } catch (error) {
      console.error('AI assist error:', error);
      setSnackbar({ open: true, message: 'Could not get AI assistance', severity: 'error' });
    } finally {
      setAiLoading(false);
    }
  };

  const checkForBias = async (): Promise<boolean> => {
    if (!aiAssistEnabled) {
      setSnackbar({ open: true, message: 'AI assistance is disabled for this cycle.', severity: 'warning' });
      return false;
    }
    setAiLoading(true);
    try {
      const response = await api.post(`/appraisals/${appraisalId}/check-bias`, {
        managerReview: formData,
        selfAssessment: appraisal?.selfAssessment
      });
      setBiasCheck(response.data);
      const hasPotentialBias = Boolean(response.data?.hasPotentialBias);
      setBiasAcknowledged(false);
      if (hasPotentialBias) {
        setSnackbar({
          open: true,
          message: 'Potential bias detected - please review',
          severity: 'warning'
        });
      }
      return hasPotentialBias;
    } catch (error) {
      console.error('Bias check error:', error);
      return false;
    } finally {
      setAiLoading(false);
    }
  };

  const updateSummaryField = (field: string, value: string) => {
    setBiasAcknowledged(false);
    setFormData(prev => ({
      ...prev,
      overallSummary: { ...prev.overallSummary, [field]: value }
    }));
  };

  const updateCompetencyRating = (competencyId: string, field: string, value: any) => {
    setBiasAcknowledged(false);
    setFormData(prev => ({
      ...prev,
      competencyRatings: prev.competencyRatings.map(c =>
        c.competencyId === competencyId ? { ...c, [field]: value } : c
      )
    }));
  };

  const steps = [
    { label: 'Review Self-Assessment', icon: <Person /> },
    { label: 'Competency Ratings', icon: <Star /> },
    { label: 'OKR Verification', icon: <TrendingUp /> },
    { label: 'Overall Assessment', icon: <CheckCircle /> }
  ];

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!appraisal) {
    return <Alert severity="error">Appraisal not found</Alert>;
  }

  if (!isManager) {
    return <Alert severity="error">Only managers can access this page</Alert>;
  }

  // Check if self-assessment is submitted
  if (!appraisal.selfAssessment?.submittedAt) {
    return (
      <Box>
        <Alert severity="warning" sx={{ mb: 3 }}>
          <Typography variant="subtitle1" fontWeight={600}>Waiting for Self-Assessment</Typography>
          <Typography variant="body2">
            {appraisal.employee.name} has not yet submitted their self-assessment.
            You'll be able to start your review once they complete it.
          </Typography>
        </Alert>
        <Button variant="outlined" startIcon={<ArrowBack />} onClick={() => router.push('/appraisals')}>
          Back to Appraisals
        </Button>
      </Box>
    );
  }

  // Check if already submitted
  if (appraisal.managerReview?.submittedAt) {
    return (
      <Box>
        <Alert severity="success" sx={{ mb: 3 }}>
          <Typography variant="subtitle1" fontWeight={600}>Review Already Submitted</Typography>
          <Typography variant="body2">
            You submitted your review on {new Date(appraisal.managerReview.submittedAt).toLocaleDateString()}.
            The appraisal is now pending calibration or final review.
          </Typography>
        </Alert>
        <Button variant="outlined" startIcon={<ArrowBack />} onClick={() => router.push('/appraisals')}>
          Back to Appraisals
        </Button>
      </Box>
    );
  }

  const selfAssessment = appraisal.selfAssessment;

  const renderSelfAssessmentReview = () => (
    <Box>
      <Typography variant="h6" fontWeight={600} gutterBottom>
        Review {appraisal.employee.name}'s Self-Assessment
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Review the employee's self-assessment before providing your evaluation. Look for alignment and gaps between your observations.
      </Typography>

      {/* Employee Info Card */}
      <Card sx={{ mb: 3, p: 2, bgcolor: 'action.hover' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Avatar sx={{ width: 56, height: 56, bgcolor: 'primary.main' }}>
            {appraisal.employee.name[0]}
          </Avatar>
          <Box>
            <Typography variant="h6" fontWeight={600}>{appraisal.employee.name}</Typography>
            <Typography variant="body2" color="text.secondary">
              {appraisal.employee.jobTitle || 'Team Member'} - {appraisal.employee.department || 'Department'}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 0.5 }}>
              {selfAssessment.overallSelfRating && (
                <Chip
                  size="small"
                  label={`Self-Rating: ${selfAssessment.overallSelfRating}/5`}
                  icon={<Star />}
                  color="primary"
                  variant="outlined"
                />
              )}
              {selfAssessment.aiRatingSuggestion?.suggestedRating && (
                <Chip
                  size="small"
                  label={`AI: ${selfAssessment.aiRatingSuggestion.suggestedRating}/5`}
                  icon={<SmartToy />}
                  color="secondary"
                  variant="outlined"
                />
              )}
            </Box>
          </Box>
        </Box>
      </Card>

      {/* AI Insights from Self-Assessment */}
      {selfAssessment.aiInsights && (
        <Paper sx={{ p: 2, mb: 3, bgcolor: 'info.lighter', border: 1, borderColor: 'info.main' }}>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 2 }}>
            <Psychology color="info" />
            <Typography variant="subtitle1" fontWeight={600} color="info.main">
              AI Analysis of Self-Assessment
            </Typography>
          </Box>
          <Grid container spacing={2}>
            {selfAssessment.aiInsights.strengths?.length > 0 && (
              <Grid size={{ xs: 12, md: 6 }}>
                <Typography variant="caption" fontWeight={600}>Identified Strengths</Typography>
                <Box component="ul" sx={{ m: 0, pl: 2 }}>
                  {selfAssessment.aiInsights.strengths.slice(0, 3).map((s: string, i: number) => (
                    <li key={i}><Typography variant="body2">{s}</Typography></li>
                  ))}
                </Box>
              </Grid>
            )}
            {selfAssessment.aiInsights.developmentAreas?.length > 0 && (
              <Grid size={{ xs: 12, md: 6 }}>
                <Typography variant="caption" fontWeight={600}>Development Areas</Typography>
                <Box component="ul" sx={{ m: 0, pl: 2 }}>
                  {selfAssessment.aiInsights.developmentAreas.slice(0, 3).map((s: string, i: number) => (
                    <li key={i}><Typography variant="body2">{s}</Typography></li>
                  ))}
                </Box>
              </Grid>
            )}
          </Grid>
        </Paper>
      )}

      {/* Self-Assessment Summary */}
      <Accordion defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMore />}>
          <Typography fontWeight={600}>Employee's Self-Summary</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography variant="caption" color="text.secondary">Key Achievements</Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', bgcolor: 'action.hover', p: 1, borderRadius: 1 }}>
                {selfAssessment.overallSummary?.achievements || 'Not provided'}
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography variant="caption" color="text.secondary">Challenges Faced</Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', bgcolor: 'action.hover', p: 1, borderRadius: 1 }}>
                {selfAssessment.overallSummary?.challenges || 'Not provided'}
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography variant="caption" color="text.secondary">Key Learnings</Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', bgcolor: 'action.hover', p: 1, borderRadius: 1 }}>
                {selfAssessment.overallSummary?.learnings || 'Not provided'}
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography variant="caption" color="text.secondary">Goals for Next Period</Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', bgcolor: 'action.hover', p: 1, borderRadius: 1 }}>
                {selfAssessment.overallSummary?.goals || 'Not provided'}
              </Typography>
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      {/* Competency Self-Ratings */}
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMore />}>
          <Typography fontWeight={600}>Competency Self-Ratings</Typography>
        </AccordionSummary>
        <AccordionDetails>
          {selfAssessment.competencyRatings?.map((c: any) => (
            <Box key={c.competencyId} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, py: 1, borderBottom: 1, borderColor: 'divider' }}>
              <Typography variant="body2">{c.competencyName}</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Rating value={c.selfRating} readOnly size="small" />
                <Chip size="small" label={ratingLabels[c.selfRating]} />
              </Box>
            </Box>
          ))}
        </AccordionDetails>
      </Accordion>

      {/* Feedback History */}
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMore />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Comment color="action" />
            <Typography fontWeight={600}>Performance Feedback ({feedbackList.length})</Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          {feedbackList.length > 0 ? (
            feedbackList.map((f: any) => (
              <Box key={f._id} sx={{ mb: 2, p: 2, bgcolor: 'background.paper', borderRadius: 1, border: 1, borderColor: 'divider' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                  <Chip label={f.type} size="small" color={f.type === 'Positive' ? 'success' : 'default'} />
                  <Typography variant="caption" color="text.secondary">{new Date(f.date).toLocaleDateString()}</Typography>
                </Box>
                <Typography variant="body2" sx={{ mb: 1 }}>"{f.message}"</Typography>
                <Typography variant="caption" color="text.secondary">- From {f.sender}</Typography>
              </Box>
            ))
          ) : <Typography variant="body2" color="text.secondary">No feedback records found for this period.</Typography>}
        </AccordionDetails>
      </Accordion>

      {aiAssistEnabled ? (
        <>
          <Button
            variant="outlined"
            startIcon={aiLoading ? <CircularProgress size={16} /> : <AutoAwesome />}
            onClick={getAIAssist}
            disabled={aiLoading}
            sx={{ mt: 3 }}
          >
            Get AI-Powered Review Suggestions
          </Button>

          {aiAssist && (
            <Paper sx={{ p: 2, mt: 2, bgcolor: 'primary.lighter', border: 1, borderColor: 'primary.main' }}>
              <Typography variant="subtitle1" fontWeight={600} color="primary.main" gutterBottom>
                AI Review Assistance
              </Typography>
              <Typography variant="body2" sx={{ mb: 2 }}>{aiAssist.overallSuggestion}</Typography>
              {aiAssist.suggestedRating && (
                <Chip label={`Suggested Rating: ${aiAssist.suggestedRating}/5`} color="primary" />
              )}
            </Paper>
          )}
        </>
      ) : (
        <Alert severity="info" sx={{ mt: 3 }}>
          AI assistance is disabled for this cycle. Complete the review manually.
        </Alert>
      )}
    </Box>
  );

  const renderCompetenciesStep = () => (
    <Box>
      <Typography variant="h6" fontWeight={600} gutterBottom>
        Rate Competencies
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Rate each competency based on your observations. The employee's self-rating is shown for comparison.
      </Typography>

      {formData.competencyRatings.map((competency) => {
        const gap = competency.selfRating ? competency.managerRating - competency.selfRating : null;
        const hasSignificantGap = gap !== null && Math.abs(gap) >= 2;

        return (
          <Card key={competency.competencyId} sx={{ mb: 2, borderLeft: hasSignificantGap ? 4 : 0, borderColor: 'warning.main' }}>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                <Box>
                  <Typography variant="subtitle1" fontWeight={600}>{competency.competencyName}</Typography>
                  {competency.selfRating && (
                    <Chip
                      size="small"
                      icon={<Person />}
                      label={`Self: ${competency.selfRating}/5`}
                      variant="outlined"
                      sx={{ mt: 0.5 }}
                    />
                  )}
                </Box>
                {hasSignificantGap && (
                  <Tooltip title="Significant gap between self and manager rating">
                    <Chip
                      size="small"
                      icon={<Warning />}
                      label={`Gap: ${gap! > 0 ? '+' : ''}${gap}`}
                      color="warning"
                    />
                  </Tooltip>
                )}
              </Box>

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                <Typography variant="body2" color="text.secondary">Your Rating:</Typography>
                <Rating
                  value={competency.managerRating}
                  onChange={(_, value) => updateCompetencyRating(competency.competencyId, 'managerRating', value || 3)}
                  size="large"
                />
                <Chip
                  label={ratingLabels[competency.managerRating]}
                  color={competency.managerRating >= 4 ? 'success' : competency.managerRating >= 3 ? 'info' : 'warning'}
                />
              </Box>

              {/* Visual comparison */}
              {competency.selfRating && (
                <Box sx={{ mb: 2, p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
                  <Box sx={{ display: 'flex', gap: 4 }}>
                    <Box>
                      <Typography variant="caption">Self-Rating</Typography>
                      <LinearProgress
                        variant="determinate"
                        value={(competency.selfRating / 5) * 100}
                        sx={{ height: 8, borderRadius: 4, width: 100 }}
                      />
                    </Box>
                    <Box>
                      <Typography variant="caption">Your Rating</Typography>
                      <LinearProgress
                        variant="determinate"
                        value={(competency.managerRating / 5) * 100}
                        color="primary"
                        sx={{ height: 8, borderRadius: 4, width: 100 }}
                      />
                    </Box>
                  </Box>
                </Box>
              )}

              <TextField
                fullWidth
                multiline
                rows={2}
                label="Your Comments & Evidence"
                placeholder="Provide specific examples to justify your rating..."
                value={competency.managerComments}
                onChange={(e) => updateCompetencyRating(competency.competencyId, 'managerComments', e.target.value)}
              />
            </CardContent>
          </Card>
        );
      })}
    </Box>
  );

  const renderOkrStep = () => (
    <Box>
      <Typography variant="h6" fontWeight={600} gutterBottom>
        Verify OKR Achievement
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Review and verify the employee's OKR completion. You can adjust the completion percentage based on your assessment.
      </Typography>

      {formData.okrAssessment.length > 0 ? (
        formData.okrAssessment.map((okr, index) => (
          <Card key={okr.okrId} sx={{ mb: 2 }}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600}>{okr.okrTitle}</Typography>

              {/* Comparison */}
              <Box sx={{ mt: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                <Grid container spacing={2}>
                  <Grid size={{ xs: 6 }}>
                    <Typography variant="caption" color="text.secondary">Employee's Claim</Typography>
                    <Typography variant="h6" fontWeight={600}>{okr.employeeCompletion || 0}%</Typography>
                  </Grid>
                  <Grid size={{ xs: 6 }}>
                    <Typography variant="caption" color="text.secondary">Your Verification</Typography>
                    <Typography variant="h6" fontWeight={600} color="primary.main">{okr.managerVerifiedCompletion}%</Typography>
                  </Grid>
                </Grid>
              </Box>

              <Typography variant="body2" sx={{ mt: 2, mb: 1 }}>Verified Completion:</Typography>
              <Slider
                value={okr.managerVerifiedCompletion}
                onChange={(_, value) => {
                  setBiasAcknowledged(false);
                  setFormData(prev => ({
                    ...prev,
                    okrAssessment: prev.okrAssessment.map((o, i) =>
                      i === index ? { ...o, managerVerifiedCompletion: value as number } : o
                    )
                  }));
                }}
                min={0}
                max={100}
                valueLabelDisplay="auto"
                marks={[
                  { value: 0, label: '0%' },
                  { value: 50, label: '50%' },
                  { value: 100, label: '100%' }
                ]}
              />

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 2 }}>
                <Typography variant="body2">Quality Rating:</Typography>
                <Rating
                  value={okr.qualityRating}
                  onChange={(_, value) => {
                    setBiasAcknowledged(false);
                    setFormData(prev => ({
                      ...prev,
                      okrAssessment: prev.okrAssessment.map((o, i) =>
                        i === index ? { ...o, qualityRating: value || 3 } : o
                      )
                    }));
                  }}
                />
              </Box>

              <TextField
                fullWidth
                multiline
                rows={2}
                label="Your Comments"
                placeholder="Note any adjustments or observations..."
                value={okr.managerComments}
                onChange={(e) => {
                  setBiasAcknowledged(false);
                  setFormData(prev => ({
                    ...prev,
                    okrAssessment: prev.okrAssessment.map((o, i) =>
                      i === index ? { ...o, managerComments: e.target.value } : o
                    )
                  }));
                }}
                sx={{ mt: 2 }}
              />
            </CardContent>
          </Card>
        ))
      ) : (
        <Alert severity="info">No OKRs to verify for this appraisal.</Alert>
      )}
    </Box>
  );

  const renderOverallAssessment = () => (
    <Box>
      <Typography variant="h6" fontWeight={600} gutterBottom>
        Overall Assessment
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Provide your overall evaluation and recommendations for {appraisal.employee.name}.
      </Typography>

      {/* Score Breakdown Card */}
      {scoringData && (
        <Card sx={{ mb: 3, border: 2, borderColor: 'primary.main' }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <PieChart color="primary" />
              <Typography variant="h6" fontWeight={600}>
                Composite Score Breakdown
              </Typography>
            </Box>

            <Grid container spacing={3}>
              {/* Main Score */}
              <Grid size={{ xs: 12, md: 4 }}>
                <Paper sx={{ p: 3, textAlign: 'center', bgcolor: 'primary.lighter' }}>
                  <Typography variant="h2" fontWeight={700} color="primary.main">
                    {scoringData.compositeScore.toFixed(1)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Composite Score (out of 5)
                  </Typography>
                  <Chip
                    label={scoringData.ratingLabel}
                    color={scoringData.compositeScore >= 4 ? 'success' : scoringData.compositeScore >= 3 ? 'info' : 'warning'}
                    sx={{ mt: 1 }}
                  />
                </Paper>
              </Grid>

              {/* Score Components */}
              <Grid size={{ xs: 12, md: 8 }}>
                <Box sx={{ mb: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="body2" fontWeight={600}>
                      OKR Achievement ({scoringData.breakdown.okrWeight}% weight)
                    </Typography>
                    <Typography variant="body2" fontWeight={600} color="success.main">
                      {scoringData.okrScore.toFixed(1)}/5
                    </Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={(scoringData.okrScore / 5) * 100}
                    color="success"
                    sx={{ height: 10, borderRadius: 5, mb: 1 }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    Contributes {scoringData.breakdown.okrContribution.toFixed(2)} to composite score
                  </Typography>
                </Box>

                <Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="body2" fontWeight={600}>
                      Competency Ratings ({scoringData.breakdown.competencyWeight}% weight)
                    </Typography>
                    <Typography variant="body2" fontWeight={600} color="info.main">
                      {scoringData.competencyScore.toFixed(1)}/5
                    </Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={(scoringData.competencyScore / 5) * 100}
                    color="info"
                    sx={{ height: 10, borderRadius: 5, mb: 1 }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    Contributes {scoringData.breakdown.competencyContribution.toFixed(2)} to composite score
                  </Typography>
                </Box>
              </Grid>
            </Grid>

            <Divider sx={{ my: 2 }} />

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Calculate fontSize="small" color="action" />
              <Typography variant="caption" color="text.secondary">
                Formula: (OKR Score x {scoringData.breakdown.okrWeight}%) + (Competency Score x {scoringData.breakdown.competencyWeight}%) = {scoringData.compositeScore.toFixed(2)}
              </Typography>
            </Box>
          </CardContent>
        </Card>
      )}

      {aiAssistEnabled ? (
        <>
          {/* AI Suggested Rating Card */}
          <Card sx={{ mb: 3, bgcolor: 'secondary.lighter', border: 1, borderColor: 'secondary.main' }}>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <SmartToy color="secondary" />
                  <Typography variant="h6" fontWeight={600}>
                    AI Rating Suggestion
                  </Typography>
                </Box>
                {!aiSuggestion && (
                  <Button
                    variant="outlined"
                    color="secondary"
                    size="small"
                    startIcon={scoringLoading ? <CircularProgress size={16} /> : <AutoAwesome />}
                    onClick={fetchAISuggestion}
                    disabled={scoringLoading}
                  >
                    Get AI Suggestion
                  </Button>
                )}
              </Box>

              {aiSuggestion ? (
                <Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                    <Paper sx={{ p: 2, textAlign: 'center', bgcolor: 'background.paper' }}>
                      <Typography variant="h3" fontWeight={700} color="secondary.main">
                        {aiSuggestion.suggestedRating}
                      </Typography>
                      <Typography variant="caption">Suggested Rating</Typography>
                    </Paper>
                    <Box sx={{ flex: 1 }}>
                      <Chip
                        label={ratingLabels[aiSuggestion.suggestedRating] || 'N/A'}
                        color={aiSuggestion.suggestedRating >= 4 ? 'success' : aiSuggestion.suggestedRating >= 3 ? 'info' : 'warning'}
                        size="small"
                        sx={{ mb: 1 }}
                      />
                      <Typography variant="body2" color="text.secondary">
                        {aiSuggestion.ratingJustification}
                      </Typography>
                    </Box>
                  </Box>

                  {/* Key Strengths & Development Areas */}
                  <Grid container spacing={2} sx={{ mb: 2 }}>
                    {aiSuggestion.keyStrengths && aiSuggestion.keyStrengths.length > 0 && (
                      <Grid size={{ xs: 12, md: 6 }}>
                        <Typography variant="caption" fontWeight={600} color="success.main">
                          Key Strengths
                        </Typography>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                          {aiSuggestion.keyStrengths.map((strength, idx) => (
                            <Chip
                              key={idx}
                              label={strength}
                              size="small"
                              color="success"
                              variant="outlined"
                              icon={<TrendingUp fontSize="small" />}
                            />
                          ))}
                        </Box>
                      </Grid>
                    )}
                    {aiSuggestion.developmentAreas && aiSuggestion.developmentAreas.length > 0 && (
                      <Grid size={{ xs: 12, md: 6 }}>
                        <Typography variant="caption" fontWeight={600} color="warning.main">
                          Development Areas
                        </Typography>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                          {aiSuggestion.developmentAreas.map((area, idx) => (
                            <Chip
                              key={idx}
                              label={area}
                              size="small"
                              color="warning"
                              variant="outlined"
                              icon={<TrendingDown fontSize="small" />}
                            />
                          ))}
                        </Box>
                      </Grid>
                    )}
                  </Grid>

                  {/* Rating Gaps & Concerns */}
                  {aiSuggestion.ratingGaps && (
                    <Accordion>
                      <AccordionSummary expandIcon={<ExpandMore />}>
                        <Typography variant="body2" fontWeight={600}>Rating Analysis</Typography>
                      </AccordionSummary>
                      <AccordionDetails>
                        {aiSuggestion.ratingGaps.selfVsObjective && (
                          <Box sx={{ mb: 1 }}>
                            <Typography variant="caption" fontWeight={600}>Self vs Objective Performance</Typography>
                            <Typography variant="body2" color="text.secondary">
                              {aiSuggestion.ratingGaps.selfVsObjective}
                            </Typography>
                          </Box>
                        )}
                        {aiSuggestion.ratingGaps.concerns && aiSuggestion.ratingGaps.concerns.length > 0 && (
                          <Box>
                            <Typography variant="caption" fontWeight={600} color="warning.main">Concerns</Typography>
                            <ul style={{ margin: 0, paddingLeft: 16 }}>
                              {aiSuggestion.ratingGaps.concerns.map((concern, idx) => (
                                <li key={idx}>
                                  <Typography variant="body2">{concern}</Typography>
                                </li>
                              ))}
                            </ul>
                          </Box>
                        )}
                      </AccordionDetails>
                    </Accordion>
                  )}

                  {/* Calibration Notes */}
                  {aiSuggestion.calibrationNotes && (
                    <Alert severity="info" sx={{ mt: 2 }} icon={<EmojiObjects />}>
                      <Typography variant="caption" fontWeight={600}>Calibration Notes</Typography>
                      <Typography variant="body2">{aiSuggestion.calibrationNotes}</Typography>
                    </Alert>
                  )}

                  <Alert severity="warning" sx={{ mt: 2 }}>
                    <Typography variant="caption">
                      This is a recommendation only. Your final rating should be based on your direct observations and judgment.
                    </Typography>
                  </Alert>
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Click "Get AI Suggestion" to receive an AI-powered rating recommendation based on OKR achievement,
                  competency ratings, and conversation analysis.
                </Typography>
              )}
            </CardContent>
          </Card>

          {/* Bias Check Alert */}
          {biasCheck?.hasPotentialBias && (
            <Alert severity="warning" sx={{ mb: 3 }} icon={<Balance />}>
              <Typography variant="subtitle2" fontWeight={600}>Potential Bias Detected</Typography>
              <Typography variant="body2">{biasCheck.biasType}: {biasCheck.suggestion}</Typography>
            </Alert>
          )}
        </>
      ) : (
        <Alert severity="info" sx={{ mb: 3 }}>
          AI rating suggestion and bias checks are disabled for this cycle.
        </Alert>
      )}

      {/* Overall Rating */}
      <Card sx={{ mb: 3, p: 3 }}>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
          Overall Performance Rating
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <Rating
            value={formData.overallManagerRating}
            onChange={(_, value) => {
              setBiasAcknowledged(false);
              setFormData(prev => ({ ...prev, overallManagerRating: value || 3 }));
            }}
            size="large"
          />
          <Chip
            label={ratingLabels[formData.overallManagerRating]}
            color={formData.overallManagerRating >= 4 ? 'success' : formData.overallManagerRating >= 3 ? 'info' : 'warning'}
            size="medium"
          />
        </Box>

        {/* Compare with self-rating */}
        {selfAssessment.overallSelfRating && (
          <Box sx={{ mt: 2, display: 'flex', gap: 2, alignItems: 'center' }}>
            <Chip icon={<Person />} label={`Self: ${selfAssessment.overallSelfRating}/5`} variant="outlined" size="small" />
            {formData.overallManagerRating !== selfAssessment.overallSelfRating && (
              <Chip
                icon={formData.overallManagerRating > selfAssessment.overallSelfRating ? <TrendingUp /> : <TrendingDown />}
                label={`Gap: ${formData.overallManagerRating - selfAssessment.overallSelfRating > 0 ? '+' : ''}${formData.overallManagerRating - selfAssessment.overallSelfRating}`}
                color={Math.abs(formData.overallManagerRating - selfAssessment.overallSelfRating) >= 2 ? 'warning' : 'default'}
                size="small"
              />
            )}
          </Box>
        )}
      </Card>

      {/* Summary Fields */}
      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 6 }}>
          <TextField
            fullWidth
            multiline
            rows={4}
            label="Key Achievements Observed"
            placeholder="What were the employee's most notable achievements?"
            value={formData.overallSummary.achievements}
            onChange={(e) => updateSummaryField('achievements', e.target.value)}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <TextField
            fullWidth
            multiline
            rows={4}
            label="Key Strengths"
            placeholder="What are the employee's strongest qualities?"
            value={formData.overallSummary.strengths}
            onChange={(e) => updateSummaryField('strengths', e.target.value)}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <TextField
            fullWidth
            multiline
            rows={4}
            label="Areas for Improvement"
            placeholder="Where should the employee focus on improving?"
            value={formData.overallSummary.improvements}
            onChange={(e) => updateSummaryField('improvements', e.target.value)}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <TextField
            fullWidth
            multiline
            rows={4}
            label="Development Recommendations"
            placeholder="What training, projects, or experiences would benefit this employee?"
            value={formData.overallSummary.recommendations}
            onChange={(e) => updateSummaryField('recommendations', e.target.value)}
          />
        </Grid>
      </Grid>

      {/* Promotion Readiness */}
      <Card sx={{ mt: 3, p: 2 }}>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
          Promotion Readiness
        </Typography>
        <FormControl fullWidth>
          <Select
            value={formData.overallSummary.promotionReadiness}
            onChange={(e) => updateSummaryField('promotionReadiness', e.target.value)}
          >
            {Object.entries(promotionReadinessLabels).map(([value, { label, color }]) => (
              <MenuItem key={value} value={value}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Chip size="small" label={label} color={color} />
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Card>

      {/* Bias Check Button */}
      {aiAssistEnabled && (
        <Button
          variant="outlined"
          startIcon={aiLoading ? <CircularProgress size={16} /> : <Balance />}
          onClick={checkForBias}
          disabled={aiLoading}
          sx={{ mt: 3 }}
        >
          Run AI Bias Check
        </Button>
      )}

      {/* Submit Warning */}
      <Alert severity="info" sx={{ mt: 3 }}>
        <Typography variant="subtitle2" fontWeight={600}>Ready to Submit?</Typography>
        <Typography variant="body2">
          Once submitted, this review will move to the calibration phase (if enabled) or directly to the final review stage.
        </Typography>
      </Alert>
    </Box>
  );

  return (
    <Box>
      {/* Header */}
      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Button startIcon={<ArrowBack />} onClick={() => router.push('/appraisals')} sx={{ mb: 1 }}>
            Back to Appraisals
          </Button>
          <Typography variant="h4" fontWeight={700}>
            Manager Review: {appraisal.employee.name}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            {appraisal.cycleId?.name || 'Performance Review'}
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={saving ? <CircularProgress size={16} /> : <Save />}
          onClick={() => handleSave()}
          disabled={saving}
        >
          Save Progress
        </Button>
      </Box>

      {/* Deadline Warning */}
      {appraisal.deadlines?.managerReviewDue && (
        <Alert
          severity={new Date(appraisal.deadlines.managerReviewDue) < new Date() ? 'error' : 'info'}
          sx={{ mb: 3 }}
        >
          Due: {new Date(appraisal.deadlines.managerReviewDue).toLocaleDateString()}
          {new Date(appraisal.deadlines.managerReviewDue) < new Date() && ' (OVERDUE)'}
        </Alert>
      )}

      {/* Stepper */}
      <Stepper activeStep={activeStep} alternativeLabel sx={{ mb: 4 }}>
        {steps.map((step, index) => (
          <Step key={step.label} completed={index < activeStep}>
            <StepLabel
              StepIconComponent={() => (
                <Box
                  sx={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    bgcolor: index <= activeStep ? 'primary.main' : 'action.disabledBackground',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: index <= activeStep ? 'primary.contrastText' : 'text.secondary'
                  }}
                >
                  {index < activeStep ? <CheckCircle /> : step.icon}
                </Box>
              )}
            >
              {step.label}
            </StepLabel>
          </Step>
        ))}
      </Stepper>

      {/* Content */}
      <Paper sx={{ p: 4, mb: 3 }}>
        {activeStep === 0 && renderSelfAssessmentReview()}
        {activeStep === 1 && renderCompetenciesStep()}
        {activeStep === 2 && renderOkrStep()}
        {activeStep === 3 && renderOverallAssessment()}
      </Paper>

      {/* Navigation */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <Button
          variant="outlined"
          startIcon={<ArrowBack />}
          onClick={() => setActiveStep(prev => prev - 1)}
          disabled={activeStep === 0}
        >
          Previous
        </Button>

        {activeStep < steps.length - 1 ? (
          <Button
            variant="contained"
            endIcon={<ArrowForward />}
            onClick={async () => {
              const saved = await handleSave(false);
              if (saved) {
                setActiveStep(prev => prev + 1);
              }
            }}
          >
            Next
          </Button>
        ) : (
          <Button
            variant="contained"
            color="success"
            startIcon={submitting ? <CircularProgress size={16} /> : <Send />}
            onClick={handleSubmit}
            disabled={submitting}
          >
            Submit Review
          </Button>
        )}
      </Box>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
        message={snackbar.message}
      />
    </Box>
  );
}
