'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAppraisal } from '@/lib/hooks';
import api from '@/lib/api';
import {
  Box,
  Typography,
  Button,
  Alert,
  CircularProgress,
  Fade,
  Paper,
  Chip,
  Card,
  CardContent,
  Grid,
  TextField,
  Rating,
  Snackbar
} from '@mui/material';
import { ArrowBack, AutoAwesome, EditNote, Save, Send } from '@mui/icons-material';
import { alpha, useTheme } from '@mui/material/styles';
import ConversationalAssessment from './conversational/ConversationalAssessment';
import ChatGptConversationGate from './conversational/ChatGptConversationGate';
import CustomAssessmentSections, { type CustomAssessmentSectionsHandle } from '@/components/appraisals/CustomAssessmentSections';

type ManualSelfAssessmentForm = {
  overallSummary: {
    achievements: string;
    challenges: string;
    learnings: string;
    improvements: string;
    goals: string;
  };
  overallSelfRating: number | null;
  competencyRatings: Array<{
    competencyId: string;
    competencyName: string;
    selfRating: number;
    selfComments: string;
  }>;
  okrAssessment: Array<{
    okrId: string;
    okrTitle: string;
    completionPercentage: number | null;
    selfComments: string;
  }>;
};

const EMPTY_SUMMARY: ManualSelfAssessmentForm['overallSummary'] = {
  achievements: '',
  challenges: '',
  learnings: '',
  improvements: '',
  goals: ''
};

function buildManualForm(appraisal: any): ManualSelfAssessmentForm {
  const selfAssessment = appraisal?.selfAssessment || {};
  const summary = { ...EMPTY_SUMMARY, ...(selfAssessment?.overallSummary || {}) };

  const existingCompetencies = Array.isArray(selfAssessment?.competencyRatings)
    ? selfAssessment.competencyRatings
    : [];
  const cycleCompetencies = Array.isArray(appraisal?.cycleId?.competencies)
    ? appraisal.cycleId.competencies
    : [];

  const competencyRatings = cycleCompetencies.length > 0
    ? cycleCompetencies.map((competency: any) => {
      const existing = existingCompetencies.find((item: any) => item.competencyId === competency.id);
      return {
        competencyId: competency.id,
        competencyName: competency.name,
        selfRating: existing?.selfRating || 3,
        selfComments: existing?.selfComments || ''
      };
    })
    : existingCompetencies.map((item: any) => ({
      competencyId: item.competencyId || '',
      competencyName: item.competencyName || 'Competency',
      selfRating: item.selfRating || 3,
      selfComments: item.selfComments || ''
    }));

  const okrAssessment = Array.isArray(selfAssessment?.okrAssessment)
    ? selfAssessment.okrAssessment.map((item: any) => ({
      okrId: item.okrId || '',
      okrTitle: item.okrTitle || 'OKR',
      completionPercentage: typeof item.completionPercentage === 'number' ? item.completionPercentage : null,
      selfComments: item.selfComments || ''
    }))
    : [];

  return {
    overallSummary: summary,
    overallSelfRating: typeof selfAssessment?.overallSelfRating === 'number' ? selfAssessment.overallSelfRating : null,
    competencyRatings,
    okrAssessment
  };
}

export default function SelfAssessmentPage() {
  const theme = useTheme();
  const params = useParams();
  const router = useRouter();
  const appraisalId = params.appraisalId as string;

  const { appraisal, isLoading, mutate } = useAppraisal(appraisalId);
  const [manualForm, setManualForm] = useState<ManualSelfAssessmentForm>({
    overallSummary: EMPTY_SUMMARY,
    overallSelfRating: null,
    competencyRatings: [],
    okrAssessment: []
  });
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const customSectionsRef = useRef<CustomAssessmentSectionsHandle>(null);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success'
  });

  useEffect(() => {
    if (!appraisal) return;
    setManualForm(buildManualForm(appraisal));
  }, [appraisal]);

  const handleConversationComplete = () => {
    mutate();
    router.push(`/appraisals?submitted=self&appraisalId=${encodeURIComponent(appraisalId)}`);
  };

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!appraisal) {
    return (
      <Alert severity="error">Appraisal not found</Alert>
    );
  }

  const editableStatuses = ['self_assessment_pending', 'self_assessment_in_progress'];
  const isEditable = editableStatuses.includes(appraisal.status);
  const aiAssistEnabled = appraisal?.cycleId?.settings?.enableAiAssist !== false;
  const requireSelfRating = appraisal?.cycleId?.settings?.allowSelfRating !== false;

  if (appraisal.selfAssessment?.submittedAt) {
    return (
      <Box>
        <Alert severity="success" sx={{ mb: 3 }}>
          <Typography variant="subtitle1" fontWeight={600}>Self-Assessment Already Submitted</Typography>
          <Typography variant="body2">
            You submitted your self-assessment on {new Date(appraisal.selfAssessment.submittedAt).toLocaleDateString()}.
            Your manager will now review it.
          </Typography>
        </Alert>
        <Button variant="outlined" startIcon={<ArrowBack />} onClick={() => router.push('/appraisals')}>
          Back to Appraisals
        </Button>
      </Box>
    );
  }

  if (!isEditable) {
    return (
      <Box>
        <Alert severity="warning" sx={{ mb: 3 }}>
          <Typography variant="subtitle1" fontWeight={600}>Self-Assessment Unavailable</Typography>
          <Typography variant="body2">
            This appraisal is currently in <strong>{appraisal.status.replace(/_/g, ' ')}</strong> status,
            so self-assessment editing is closed.
          </Typography>
        </Alert>
        <Button variant="outlined" startIcon={<ArrowBack />} onClick={() => router.push(`/appraisals/${appraisalId}`)}>
          Back to Appraisal
        </Button>
      </Box>
    );
  }

  const persistManualAssessment = async (submit: boolean) => {
    if (submit && requireSelfRating && !manualForm.overallSelfRating) {
      setSnackbar({ open: true, message: 'Please choose your overall self-rating before submitting.', severity: 'error' });
      return;
    }

    if (submit) {
      setSubmitting(true);
    } else {
      setSaving(true);
    }

    try {
      const customResponsesSaved = await customSectionsRef.current?.save(submit);
      if (customResponsesSaved === false) return;
      const payload: any = {
        overallSummary: {
          achievements: manualForm.overallSummary.achievements.trim(),
          challenges: manualForm.overallSummary.challenges.trim(),
          learnings: manualForm.overallSummary.learnings.trim(),
          improvements: manualForm.overallSummary.improvements.trim(),
          goals: manualForm.overallSummary.goals.trim()
        },
        competencyRatings: manualForm.competencyRatings.map((item) => ({
          competencyId: item.competencyId,
          competencyName: item.competencyName,
          selfRating: item.selfRating,
          selfComments: item.selfComments
        })),
        okrAssessment: manualForm.okrAssessment.map((item) => ({
          okrId: item.okrId,
          okrTitle: item.okrTitle,
          completionPercentage: item.completionPercentage,
          selfComments: item.selfComments
        }))
      };

      if (requireSelfRating) {
        payload.overallSelfRating = manualForm.overallSelfRating;
      }

      await api.post(`/appraisals/${appraisalId}/self-assessment`, {
        selfAssessment: payload,
        submit
      });

      await mutate();
      setSnackbar({
        open: true,
        message: submit ? 'Self-assessment submitted successfully.' : 'Progress saved.',
        severity: 'success'
      });

      if (submit) {
        setTimeout(() => router.push(`/appraisals?submitted=self&appraisalId=${encodeURIComponent(appraisalId)}`), 700);
      }
    } catch (error: unknown) {
      const axiosError = error as { response?: { data?: { error?: string } } };
      setSnackbar({
        open: true,
        message: axiosError.response?.data?.error || 'Failed to save self-assessment',
        severity: 'error'
      });
    } finally {
      setSaving(false);
      setSubmitting(false);
    }
  };

  return (
    <Box>
      <Paper
        variant="outlined"
        sx={{
          p: { xs: 1.5, sm: 2.5 },
          mb: 3,
          borderRadius: 2.5,
          borderColor: alpha(theme.palette.primary.main, 0.25),
          backgroundImage: `linear-gradient(145deg, ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.16 : 0.08)} 0%, ${alpha(theme.palette.background.paper, 0.86)} 100%)`
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          <Box>
            <Button
              startIcon={<ArrowBack />}
              onClick={() => router.push('/appraisals')}
              sx={{ mb: 1, borderRadius: 999 }}
              variant="outlined"
              size="small"
            >
              Back to Appraisals
            </Button>
            <Typography variant="h4" fontWeight={700}>
              Self-Assessment
            </Typography>
            <Typography variant="body1" color="text.secondary">
              {appraisal.cycleId?.name || 'Performance Review'}
            </Typography>
          </Box>
          <Chip
            icon={aiAssistEnabled ? <AutoAwesome /> : <EditNote />}
            color={aiAssistEnabled ? 'primary' : 'default'}
            variant="outlined"
            label={aiAssistEnabled ? 'Conversational Mode' : 'Manual Mode'}
            sx={{ fontWeight: 600 }}
          />
        </Box>
      </Paper>

      {appraisal.deadlines?.selfAssessmentDue && (
        <Alert
          severity={new Date(appraisal.deadlines.selfAssessmentDue) < new Date() ? 'error' : 'info'}
          sx={{ mb: 3 }}
        >
          Due: {new Date(appraisal.deadlines.selfAssessmentDue).toLocaleDateString()}
          {new Date(appraisal.deadlines.selfAssessmentDue) < new Date() && ' (OVERDUE)'}
        </Alert>
      )}

      {aiAssistEnabled ? (
        <Fade in>
          <Box>
            <ChatGptConversationGate appraisalId={appraisalId}>
              {({ requireChatGptConnection }) => (
                <ConversationalAssessment
                  appraisalId={appraisalId}
                  onComplete={handleConversationComplete}
                  onChatGptUnavailable={requireChatGptConnection}
                />
              )}
            </ChatGptConversationGate>
          </Box>
        </Fade>
      ) : (
        <Fade in>
          <Box>
            <CustomAssessmentSections
              ref={customSectionsRef}
              appraisal={appraisal}
              respondentRole="employee"
              onSaveError={(message) => setSnackbar({ open: true, message, severity: 'error' })}
            />

            <Alert severity="info" sx={{ mb: 3 }}>
              AI assistance is disabled for this appraisal cycle. Use this manual form to complete and submit your self-assessment.
            </Alert>

            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="h6" fontWeight={700} gutterBottom>
                  Overall Reflection
                </Typography>
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, md: 6 }}>
                    <TextField
                      fullWidth
                      multiline
                      minRows={4}
                      label="Key Achievements"
                      value={manualForm.overallSummary.achievements}
                      onChange={(e) => setManualForm((prev) => ({
                        ...prev,
                        overallSummary: { ...prev.overallSummary, achievements: e.target.value }
                      }))}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, md: 6 }}>
                    <TextField
                      fullWidth
                      multiline
                      minRows={4}
                      label="Challenges Faced"
                      value={manualForm.overallSummary.challenges}
                      onChange={(e) => setManualForm((prev) => ({
                        ...prev,
                        overallSummary: { ...prev.overallSummary, challenges: e.target.value }
                      }))}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, md: 6 }}>
                    <TextField
                      fullWidth
                      multiline
                      minRows={4}
                      label="Key Learnings"
                      value={manualForm.overallSummary.learnings}
                      onChange={(e) => setManualForm((prev) => ({
                        ...prev,
                        overallSummary: { ...prev.overallSummary, learnings: e.target.value }
                      }))}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, md: 6 }}>
                    <TextField
                      fullWidth
                      multiline
                      minRows={4}
                      label="Goals for Next Period"
                      value={manualForm.overallSummary.goals}
                      onChange={(e) => setManualForm((prev) => ({
                        ...prev,
                        overallSummary: { ...prev.overallSummary, goals: e.target.value }
                      }))}
                    />
                  </Grid>
                  <Grid size={{ xs: 12 }}>
                    <TextField
                      fullWidth
                      multiline
                      minRows={3}
                      label="Areas for Improvement"
                      value={manualForm.overallSummary.improvements}
                      onChange={(e) => setManualForm((prev) => ({
                        ...prev,
                        overallSummary: { ...prev.overallSummary, improvements: e.target.value }
                      }))}
                    />
                  </Grid>
                </Grid>
              </CardContent>
            </Card>

            <Card sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="h6" fontWeight={700} gutterBottom>
                  Overall Self-Rating
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                  <Rating
                    value={manualForm.overallSelfRating}
                    onChange={(_, value) => setManualForm((prev) => ({ ...prev, overallSelfRating: value }))}
                  />
                  <Chip
                    size="small"
                    color={requireSelfRating ? 'warning' : 'default'}
                    label={requireSelfRating ? 'Required to submit' : 'Optional'}
                  />
                </Box>
              </CardContent>
            </Card>

            {manualForm.competencyRatings.length > 0 && (
              <Card sx={{ mb: 3 }}>
                <CardContent>
                  <Typography variant="h6" fontWeight={700} gutterBottom>
                    Competency Self-Ratings
                  </Typography>
                  <Grid container spacing={2}>
                    {manualForm.competencyRatings.map((competency, index) => (
                      <Grid key={competency.competencyId || index} size={{ xs: 12, md: 6 }}>
                        <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
                          <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                            {competency.competencyName}
                          </Typography>
                          <Rating
                            value={competency.selfRating}
                            onChange={(_, value) => {
                              const nextValue = value || 3;
                              setManualForm((prev) => ({
                                ...prev,
                                competencyRatings: prev.competencyRatings.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, selfRating: nextValue } : item
                                )
                              }));
                            }}
                            sx={{ mb: 1.5 }}
                          />
                          <TextField
                            fullWidth
                            multiline
                            minRows={2}
                            label="Comments"
                            value={competency.selfComments}
                            onChange={(e) => {
                              const nextValue = e.target.value;
                              setManualForm((prev) => ({
                                ...prev,
                                competencyRatings: prev.competencyRatings.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, selfComments: nextValue } : item
                                )
                              }));
                            }}
                          />
                        </Paper>
                      </Grid>
                    ))}
                  </Grid>
                </CardContent>
              </Card>
            )}

            {manualForm.okrAssessment.length > 0 && (
              <Card sx={{ mb: 3 }}>
                <CardContent>
                  <Typography variant="h6" fontWeight={700} gutterBottom>
                    OKR Reflection
                  </Typography>
                  <Grid container spacing={2}>
                    {manualForm.okrAssessment.map((okr, index) => (
                      <Grid key={okr.okrId || index} size={{ xs: 12 }}>
                        <Paper variant="outlined" sx={{ p: 2 }}>
                          <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                            {okr.okrTitle}
                          </Typography>
                          <TextField
                            fullWidth
                            type="number"
                            label="Completion (%)"
                            value={okr.completionPercentage ?? ''}
                            onChange={(e) => {
                              if (e.target.value === '') {
                                setManualForm((prev) => ({
                                  ...prev,
                                  okrAssessment: prev.okrAssessment.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, completionPercentage: null } : item
                                  )
                                }));
                                return;
                              }
                              const nextValue = Number(e.target.value);
                              const clamped = Number.isNaN(nextValue) ? null : Math.max(0, Math.min(100, nextValue));
                              setManualForm((prev) => ({
                                ...prev,
                                okrAssessment: prev.okrAssessment.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, completionPercentage: clamped } : item
                                )
                              }));
                            }}
                            helperText={okr.completionPercentage === null ? 'Not rated at the appraisal cutoff' : undefined}
                            sx={{ mb: 1.5 }}
                          />
                          <TextField
                            fullWidth
                            multiline
                            minRows={2}
                            label="Comments"
                            value={okr.selfComments}
                            onChange={(e) => {
                              const nextValue = e.target.value;
                              setManualForm((prev) => ({
                                ...prev,
                                okrAssessment: prev.okrAssessment.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, selfComments: nextValue } : item
                                )
                              }));
                            }}
                          />
                        </Paper>
                      </Grid>
                    ))}
                  </Grid>
                </CardContent>
              </Card>
            )}

            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5, flexWrap: 'wrap' }}>
              <Button
                variant="outlined"
                startIcon={saving ? <CircularProgress size={16} /> : <Save />}
                onClick={() => persistManualAssessment(false)}
                disabled={saving || submitting}
              >
                Save Draft
              </Button>
              <Button
                variant="contained"
                color="success"
                startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : <Send />}
                onClick={() => persistManualAssessment(true)}
                disabled={saving || submitting}
              >
                Submit Self-Assessment
              </Button>
            </Box>
          </Box>
        </Fade>
      )}

      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
        message={snackbar.message}
      />
    </Box>
  );
}
