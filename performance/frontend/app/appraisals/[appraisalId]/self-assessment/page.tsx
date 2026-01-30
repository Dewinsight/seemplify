'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAppraisal, useUserContext } from '@/lib/hooks';
import api from '@/lib/api';
import {
  Box, Typography, Card, CardContent, Grid, Button, TextField, Chip, Alert,
  Paper, Stepper, Step, StepLabel, StepContent, Rating, LinearProgress,
  Dialog, DialogTitle, DialogContent, DialogActions, CircularProgress,
  Accordion, AccordionSummary, AccordionDetails, Divider, Tooltip, IconButton,
  Snackbar, Slider, FormControl, FormLabel, RadioGroup, FormControlLabel, Radio,
  ToggleButton, ToggleButtonGroup, Fade
} from '@mui/material';
import {
  Save, Send, ArrowBack, ArrowForward, Psychology, Lightbulb, Star,
  ExpandMore, CheckCircle, Edit, Refresh, AutoAwesome, TipsAndUpdates,
  EmojiObjects, Assignment, Flag, TrendingUp, Chat, ListAlt
} from '@mui/icons-material';
import ConversationalAssessment from './conversational/ConversationalAssessment';

interface Competency {
  competencyId: string;
  competencyName: string;
  selfRating: number;
  selfComments: string;
}

interface OkrAssessment {
  okrId: string;
  okrTitle: string;
  targetValue: number;
  achievedValue: number;
  completionPercentage: number;
  selfComments: string;
}

interface SelfAssessmentData {
  overallSummary: {
    achievements: string;
    challenges: string;
    learnings: string;
    improvements: string;
    goals: string;
  };
  competencyRatings: Competency[];
  okrAssessment: OkrAssessment[];
  overallSelfRating: number;
}

const ratingLabels: Record<number, string> = {
  1: 'Needs Improvement',
  2: 'Partially Meets',
  3: 'Meets Expectations',
  4: 'Exceeds Expectations',
  5: 'Outstanding'
};

export default function SelfAssessmentPage() {
  const params = useParams();
  const router = useRouter();
  const appraisalId = params.appraisalId as string;
  const { user } = useUserContext();

  const { appraisal, isLoading, mutate } = useAppraisal(appraisalId);

  // Mode state: 'conversation' or 'form'
  const [mode, setMode] = useState<'conversation' | 'form'>('conversation');
  const [activeStep, setActiveStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<Record<string, string>>({});
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' });

  // Initialize mode from appraisal state if available
  useEffect(() => {
    if (appraisal?.conversationAssessment?.mode) {
      setMode(appraisal.conversationAssessment.mode === 'form' ? 'form' : 'conversation');
    }
  }, [appraisal]);

  // Form data
  const [formData, setFormData] = useState<SelfAssessmentData>({
    overallSummary: {
      achievements: '',
      challenges: '',
      learnings: '',
      improvements: '',
      goals: ''
    },
    competencyRatings: [],
    okrAssessment: [],
    overallSelfRating: 3
  });

  // Initialize form data from appraisal
  useEffect(() => {
    if (appraisal) {
      const existing = appraisal.selfAssessment || {};
      const cycle = appraisal.cycleId;

      // Initialize competencies from cycle
      const competencies = cycle?.competencies?.map((c: any) => ({
        competencyId: c.id,
        competencyName: c.name,
        selfRating: existing.competencyRatings?.find((r: any) => r.competencyId === c.id)?.selfRating || 3,
        selfComments: existing.competencyRatings?.find((r: any) => r.competencyId === c.id)?.selfComments || ''
      })) || [];

      setFormData({
        overallSummary: existing.overallSummary || {
          achievements: '',
          challenges: '',
          learnings: '',
          improvements: '',
          goals: ''
        },
        competencyRatings: competencies,
        okrAssessment: existing.okrAssessment || [],
        overallSelfRating: existing.overallSelfRating || 3
      });
    }
  }, [appraisal]);

  const handleSave = async (showNotification = true) => {
    setSaving(true);
    try {
      await api.post(`/appraisals/${appraisalId}/self-assessment`, {
        selfAssessment: formData,
        submit: false
      });
      mutate();
      if (showNotification) {
        setSnackbar({ open: true, message: 'Progress saved successfully!', severity: 'success' });
      }
    } catch (error) {
      console.error('Save error:', error);
      setSnackbar({ open: true, message: 'Failed to save progress', severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await api.post(`/appraisals/${appraisalId}/self-assessment`, {
        selfAssessment: formData,
        submit: true
      });
      mutate();
      setSnackbar({ open: true, message: 'Self-assessment submitted successfully!', severity: 'success' });
      setTimeout(() => router.push(`/appraisals/${appraisalId}`), 1500);
    } catch (error) {
      console.error('Submit error:', error);
      setSnackbar({ open: true, message: 'Failed to submit self-assessment', severity: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const getAISuggestion = async (field: string, context: string) => {
    setAiLoading(true);
    try {
      const response = await api.post('/appraisals/ai-suggest', {
        field,
        context,
        existingContent: formData.overallSummary[field as keyof typeof formData.overallSummary] || '',
        employeeName: user?.name
      });
      setAiSuggestions(prev => ({ ...prev, [field]: response.data.suggestion }));
    } catch (error) {
      console.error('AI suggestion error:', error);
      setSnackbar({ open: true, message: 'Could not get AI suggestions', severity: 'error' });
    } finally {
      setAiLoading(false);
    }
  };

  const applySuggestion = (field: string) => {
    const suggestion = aiSuggestions[field];
    if (suggestion) {
      setFormData(prev => ({
        ...prev,
        overallSummary: {
          ...prev.overallSummary,
          [field]: prev.overallSummary[field as keyof typeof prev.overallSummary]
            ? `${prev.overallSummary[field as keyof typeof prev.overallSummary]}\n\n${suggestion}`
            : suggestion
        }
      }));
      setAiSuggestions(prev => {
        const updated = { ...prev };
        delete updated[field];
        return updated;
      });
    }
  };

  const updateSummaryField = (field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      overallSummary: { ...prev.overallSummary, [field]: value }
    }));
  };

  const updateCompetencyRating = (competencyId: string, field: 'selfRating' | 'selfComments', value: any) => {
    setFormData(prev => ({
      ...prev,
      competencyRatings: prev.competencyRatings.map(c =>
        c.competencyId === competencyId ? { ...c, [field]: value } : c
      )
    }));
  };

  const steps = [
    { label: 'Key Achievements', icon: <Flag /> },
    { label: 'Competency Ratings', icon: <Star /> },
    { label: 'OKR Assessment', icon: <TrendingUp /> },
    { label: 'Review & Submit', icon: <CheckCircle /> }
  ];

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

  // Check if already submitted
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

  const renderAchievementsStep = () => (
    <Box>
      <Typography variant="h6" fontWeight={600} gutterBottom>
        Reflect on Your Performance
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Take time to thoughtfully describe your achievements, challenges, and growth areas. Our AI can help you articulate your accomplishments effectively.
      </Typography>

      {/* Achievements */}
      <Card sx={{ mb: 3, p: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="subtitle1" fontWeight={600}>
            <Flag sx={{ mr: 1, verticalAlign: 'middle', color: 'success.main' }} />
            Key Achievements
          </Typography>
          <Button
            size="small"
            startIcon={aiLoading ? <CircularProgress size={16} /> : <AutoAwesome />}
            onClick={() => getAISuggestion('achievements', 'Help me describe my key achievements this period')}
            disabled={aiLoading}
          >
            Get AI Suggestions
          </Button>
        </Box>
        <TextField
          fullWidth
          multiline
          rows={4}
          placeholder="Describe your key accomplishments and successes during this review period. What goals did you achieve? What impact did you make?"
          value={formData.overallSummary.achievements}
          onChange={(e) => updateSummaryField('achievements', e.target.value)}
        />
        {aiSuggestions.achievements && (
          <Paper sx={{ p: 2, mt: 2, bgcolor: 'primary.lighter', border: 1, borderColor: 'primary.main' }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
              <Lightbulb color="primary" />
              <Box sx={{ flex: 1 }}>
                <Typography variant="caption" color="primary.main" fontWeight={600}>AI Suggestion</Typography>
                <Typography variant="body2">{aiSuggestions.achievements}</Typography>
                <Button size="small" onClick={() => applySuggestion('achievements')} sx={{ mt: 1 }}>
                  Apply Suggestion
                </Button>
              </Box>
            </Box>
          </Paper>
        )}
      </Card>

      {/* Challenges */}
      <Card sx={{ mb: 3, p: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="subtitle1" fontWeight={600}>
            <Assignment sx={{ mr: 1, verticalAlign: 'middle', color: 'warning.main' }} />
            Challenges Faced
          </Typography>
          <Button
            size="small"
            startIcon={<AutoAwesome />}
            onClick={() => getAISuggestion('challenges', 'Help me describe challenges I faced professionally')}
            disabled={aiLoading}
          >
            Get AI Suggestions
          </Button>
        </Box>
        <TextField
          fullWidth
          multiline
          rows={4}
          placeholder="What challenges or obstacles did you encounter? How did you handle them?"
          value={formData.overallSummary.challenges}
          onChange={(e) => updateSummaryField('challenges', e.target.value)}
        />
        {aiSuggestions.challenges && (
          <Paper sx={{ p: 2, mt: 2, bgcolor: 'primary.lighter', border: 1, borderColor: 'primary.main' }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
              <Lightbulb color="primary" />
              <Box sx={{ flex: 1 }}>
                <Typography variant="caption" color="primary.main" fontWeight={600}>AI Suggestion</Typography>
                <Typography variant="body2">{aiSuggestions.challenges}</Typography>
                <Button size="small" onClick={() => applySuggestion('challenges')} sx={{ mt: 1 }}>
                  Apply Suggestion
                </Button>
              </Box>
            </Box>
          </Paper>
        )}
      </Card>

      {/* Learnings */}
      <Card sx={{ mb: 3, p: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="subtitle1" fontWeight={600}>
            <EmojiObjects sx={{ mr: 1, verticalAlign: 'middle', color: 'info.main' }} />
            Key Learnings
          </Typography>
          <Button
            size="small"
            startIcon={<AutoAwesome />}
            onClick={() => getAISuggestion('learnings', 'Help me describe what I learned professionally')}
            disabled={aiLoading}
          >
            Get AI Suggestions
          </Button>
        </Box>
        <TextField
          fullWidth
          multiline
          rows={3}
          placeholder="What new skills, knowledge, or insights did you gain?"
          value={formData.overallSummary.learnings}
          onChange={(e) => updateSummaryField('learnings', e.target.value)}
        />
      </Card>

      {/* Areas for Improvement */}
      <Card sx={{ mb: 3, p: 2 }}>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
          <TrendingUp sx={{ mr: 1, verticalAlign: 'middle', color: 'secondary.main' }} />
          Areas for Improvement
        </Typography>
        <TextField
          fullWidth
          multiline
          rows={3}
          placeholder="What areas would you like to improve? Be honest and specific."
          value={formData.overallSummary.improvements}
          onChange={(e) => updateSummaryField('improvements', e.target.value)}
        />
      </Card>

      {/* Future Goals */}
      <Card sx={{ p: 2 }}>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
          <Flag sx={{ mr: 1, verticalAlign: 'middle', color: 'primary.main' }} />
          Goals for Next Period
        </Typography>
        <TextField
          fullWidth
          multiline
          rows={3}
          placeholder="What are your professional goals for the upcoming period?"
          value={formData.overallSummary.goals}
          onChange={(e) => updateSummaryField('goals', e.target.value)}
        />
      </Card>
    </Box>
  );

  const renderCompetenciesStep = () => (
    <Box>
      <Typography variant="h6" fontWeight={600} gutterBottom>
        Rate Your Competencies
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Honestly assess yourself on each competency. Your self-ratings will be compared with your manager's assessment.
      </Typography>

      {formData.competencyRatings.map((competency) => (
        <Accordion key={competency.competencyId} defaultExpanded sx={{ mb: 2 }}>
          <AccordionSummary expandIcon={<ExpandMore />}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
              <Typography fontWeight={600}>{competency.competencyName}</Typography>
              <Rating
                value={competency.selfRating}
                onChange={(_, value) => updateCompetencyRating(competency.competencyId, 'selfRating', value || 3)}
                onClick={(e) => e.stopPropagation()}
              />
              <Chip
                size="small"
                label={ratingLabels[competency.selfRating]}
                color={competency.selfRating >= 4 ? 'success' : competency.selfRating >= 3 ? 'info' : 'warning'}
              />
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <TextField
              fullWidth
              multiline
              rows={2}
              label="Evidence & Comments"
              placeholder="Provide specific examples that demonstrate this competency..."
              value={competency.selfComments}
              onChange={(e) => updateCompetencyRating(competency.competencyId, 'selfComments', e.target.value)}
            />
          </AccordionDetails>
        </Accordion>
      ))}

      {formData.competencyRatings.length === 0 && (
        <Alert severity="info">
          No competencies defined for this cycle. Contact HR if this seems incorrect.
        </Alert>
      )}
    </Box>
  );

  const renderOkrStep = () => (
    <Box>
      <Typography variant="h6" fontWeight={600} gutterBottom>
        OKR Self-Assessment
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Review your OKRs and assess your achievement level for each.
      </Typography>

      {formData.okrAssessment.length > 0 ? (
        formData.okrAssessment.map((okr, index) => (
          <Card key={okr.okrId} sx={{ mb: 2, p: 2 }}>
            <Typography variant="subtitle1" fontWeight={600}>{okr.okrTitle}</Typography>
            <Box sx={{ mt: 2 }}>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Completion: {okr.completionPercentage}%
              </Typography>
              <LinearProgress
                variant="determinate"
                value={okr.completionPercentage}
                color={okr.completionPercentage >= 70 ? 'success' : okr.completionPercentage >= 40 ? 'warning' : 'error'}
                sx={{ height: 8, borderRadius: 4, mb: 2 }}
              />
              <Slider
                value={okr.completionPercentage}
                onChange={(_, value) => {
                  setFormData(prev => ({
                    ...prev,
                    okrAssessment: prev.okrAssessment.map((o, i) =>
                      i === index ? { ...o, completionPercentage: value as number } : o
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
              <TextField
                fullWidth
                multiline
                rows={2}
                label="Self Comments"
                placeholder="Describe your progress and any blockers..."
                value={okr.selfComments}
                onChange={(e) => {
                  setFormData(prev => ({
                    ...prev,
                    okrAssessment: prev.okrAssessment.map((o, i) =>
                      i === index ? { ...o, selfComments: e.target.value } : o
                    )
                  }));
                }}
                sx={{ mt: 2 }}
              />
            </Box>
          </Card>
        ))
      ) : (
        <Alert severity="info">
          No OKRs found for this period. If you have set OKRs, they will appear here automatically.
        </Alert>
      )}
    </Box>
  );

  const renderReviewStep = () => (
    <Box>
      <Typography variant="h6" fontWeight={600} gutterBottom>
        Review & Submit
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Review your self-assessment before submitting. Once submitted, you won't be able to make changes.
      </Typography>

      {/* Overall Self Rating */}
      <Card sx={{ mb: 3, p: 3 }}>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
          Overall Self-Rating
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <Rating
            value={formData.overallSelfRating}
            onChange={(_, value) => setFormData(prev => ({ ...prev, overallSelfRating: value || 3 }))}
            size="large"
          />
          <Chip
            label={ratingLabels[formData.overallSelfRating]}
            color={formData.overallSelfRating >= 4 ? 'success' : formData.overallSelfRating >= 3 ? 'info' : 'warning'}
          />
        </Box>
      </Card>

      {/* Summary Review */}
      <Accordion defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMore />}>
          <Typography fontWeight={600}>Summary Review</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography variant="caption" color="text.secondary">Achievements</Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                {formData.overallSummary.achievements || 'Not provided'}
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography variant="caption" color="text.secondary">Challenges</Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                {formData.overallSummary.challenges || 'Not provided'}
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography variant="caption" color="text.secondary">Learnings</Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                {formData.overallSummary.learnings || 'Not provided'}
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography variant="caption" color="text.secondary">Goals</Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                {formData.overallSummary.goals || 'Not provided'}
              </Typography>
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      {/* Competency Summary */}
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMore />}>
          <Typography fontWeight={600}>Competency Ratings</Typography>
        </AccordionSummary>
        <AccordionDetails>
          {formData.competencyRatings.map(c => (
            <Box key={c.competencyId} sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="body2">{c.competencyName}</Typography>
              <Rating value={c.selfRating} readOnly size="small" />
            </Box>
          ))}
        </AccordionDetails>
      </Accordion>

      {/* AI Insights Preview */}
      {appraisal.selfAssessment?.aiInsights && (
        <Paper sx={{ p: 2, mt: 3, bgcolor: 'primary.lighter', border: 1, borderColor: 'primary.main' }}>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 2 }}>
            <Psychology color="primary" />
            <Typography variant="subtitle1" fontWeight={600} color="primary.main">
              AI Analysis Preview
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary">
            After submission, our AI will analyze your self-assessment and provide insights to your manager.
          </Typography>
        </Paper>
      )}

      {/* Submit Confirmation */}
      <Alert severity="warning" sx={{ mt: 3 }}>
        <Typography variant="subtitle2" fontWeight={600}>Ready to Submit?</Typography>
        <Typography variant="body2">
          Once submitted, you cannot make changes. Your manager will be notified to begin their review.
        </Typography>
      </Alert>
    </Box>
  );

  const handleModeChange = (_: any, newMode: 'conversation' | 'form' | null) => {
    if (newMode) {
      setMode(newMode);
    }
  };

  const handleConversationComplete = () => {
    mutate();
    router.push(`/appraisals/${appraisalId}`);
  };

  return (
    <Box>
      {/* Header */}
      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Button
            startIcon={<ArrowBack />}
            onClick={() => router.push('/appraisals')}
            sx={{ mb: 1 }}
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

        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          {/* Mode Toggle */}
          <ToggleButtonGroup
            value={mode}
            exclusive
            onChange={handleModeChange}
            size="small"
          >
            <ToggleButton value="conversation">
              <Tooltip title="AI Conversation Mode">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Chat fontSize="small" />
                  <Typography variant="caption">Chat</Typography>
                </Box>
              </Tooltip>
            </ToggleButton>
            <ToggleButton value="form">
              <Tooltip title="Traditional Form Mode">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <ListAlt fontSize="small" />
                  <Typography variant="caption">Form</Typography>
                </Box>
              </Tooltip>
            </ToggleButton>
          </ToggleButtonGroup>

          {mode === 'form' && (
            <Button
              variant="outlined"
              startIcon={saving ? <CircularProgress size={16} /> : <Save />}
              onClick={() => handleSave()}
              disabled={saving}
            >
              Save Progress
            </Button>
          )}
        </Box>
      </Box>

      {/* Deadline Warning */}
      {appraisal.deadlines?.selfAssessmentDue && (
        <Alert
          severity={new Date(appraisal.deadlines.selfAssessmentDue) < new Date() ? 'error' : 'info'}
          sx={{ mb: 3 }}
        >
          Due: {new Date(appraisal.deadlines.selfAssessmentDue).toLocaleDateString()}
          {new Date(appraisal.deadlines.selfAssessmentDue) < new Date() && ' (OVERDUE)'}
        </Alert>
      )}

      {/* Mode-specific content */}
      {mode === 'conversation' ? (
        <Fade in>
          <Box>
            <ConversationalAssessment
              appraisalId={appraisalId}
              onComplete={handleConversationComplete}
            />
          </Box>
        </Fade>
      ) : (
        <Fade in>
          <Box>
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
                    bgcolor: index <= activeStep ? 'primary.main' : 'grey.300',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: index <= activeStep ? 'white' : 'grey.600'
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
        {activeStep === 0 && renderAchievementsStep()}
        {activeStep === 1 && renderCompetenciesStep()}
        {activeStep === 2 && renderOkrStep()}
        {activeStep === 3 && renderReviewStep()}
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
            onClick={() => {
              handleSave(false);
              setActiveStep(prev => prev + 1);
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
            Submit Self-Assessment
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
        </Fade>
      )}
    </Box>
  );
}
