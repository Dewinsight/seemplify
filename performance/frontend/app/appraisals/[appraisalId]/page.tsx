'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAppraisal, useUserContext } from '@/lib/hooks';
import {
  Box, Typography, Card, CardContent, Grid, Button, Chip, Alert,
  Paper, Stepper, Step, StepLabel, Rating, LinearProgress,
  Accordion, AccordionSummary, AccordionDetails, Divider, Avatar,
  CircularProgress, Tabs, Tab, List, ListItem, ListItemText, ListItemAvatar
} from '@mui/material';
import {
  ArrowBack, Edit, PlayArrow, CheckCircle, Schedule, Person,
  ExpandMore, Star, Assignment, TrendingUp, Chat, Description,
  Psychology, Flag, Warning, Groups
} from '@mui/icons-material';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div hidden={value !== index} {...other}>
      {value === index && <Box sx={{ py: 3 }}>{children}</Box>}
    </div>
  );
}

const statusConfig: Record<string, { label: string; color: 'default' | 'info' | 'warning' | 'success' | 'error'; icon: React.ReactNode }> = {
  'not_started': { label: 'Not Started', color: 'default', icon: <Schedule /> },
  'goal_setting': { label: 'Goal Setting', color: 'info', icon: <Edit /> },
  'self_assessment_pending': { label: 'Self-Assessment Pending', color: 'warning', icon: <Assignment /> },
  'self_assessment_in_progress': { label: 'Self-Assessment In Progress', color: 'info', icon: <Edit /> },
  'self_assessment_submitted': { label: 'Self-Assessment Submitted', color: 'success', icon: <CheckCircle /> },
  'manager_review_pending': { label: 'Manager Review Pending', color: 'warning', icon: <Person /> },
  'manager_review_in_progress': { label: 'Manager Review In Progress', color: 'info', icon: <Edit /> },
  'manager_review_submitted': { label: 'Manager Review Submitted', color: 'success', icon: <CheckCircle /> },
  'discussion_scheduled': { label: 'Discussion Scheduled', color: 'info', icon: <Chat /> },
  'discussion_completed': { label: 'Discussion Completed', color: 'success', icon: <CheckCircle /> },
  'calibration_pending': { label: 'Calibration Pending', color: 'warning', icon: <TrendingUp /> },
  'completed': { label: 'Completed', color: 'success', icon: <CheckCircle /> },
};

const ratingLabels: Record<number, string> = {
  1: 'Needs Improvement',
  2: 'Partially Meets',
  3: 'Meets Expectations',
  4: 'Exceeds Expectations',
  5: 'Outstanding'
};

const workflowSteps = [
  { key: 'goalSetting', label: 'Goal Setting' },
  { key: 'selfAssessment', label: 'Self-Assessment' },
  { key: 'managerReview', label: 'Manager Review' },
  { key: 'discussion', label: 'Discussion' },
  { key: 'calibration', label: 'Calibration' },
  { key: 'finalReview', label: 'Final Review' },
];

export default function AppraisalDetailPage() {
  const params = useParams();
  const router = useRouter();
  const appraisalId = params.appraisalId as string;
  const { user, isManager, isHRAdmin } = useUserContext();

  const { appraisal, isLoading, isError } = useAppraisal(appraisalId);
  const [tabValue, setTabValue] = useState(0);

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (isError || !appraisal) {
    return (
      <Box>
        <Button startIcon={<ArrowBack />} onClick={() => router.push('/appraisals')} sx={{ mb: 2 }}>
          Back to Appraisals
        </Button>
        <Alert severity="error">
          Failed to load appraisal. The appraisal may not exist or you may not have permission to view it.
        </Alert>
      </Box>
    );
  }

  const isEmployee = appraisal.employee?.userId === user?.id;
  const isAssignedManager = appraisal.manager?.userId === user?.id;
  const config = statusConfig[appraisal.status] || statusConfig['not_started'];

  // Determine active workflow step
  const getActiveStep = () => {
    const status = appraisal.status || '';
    if (status === 'not_started' || status.includes('goal_setting')) return 0;
    if (status.includes('self_assessment')) return 1;
    if (status.includes('manager_review')) return 2;
    if (status.includes('discussion')) return 3;
    if (status.includes('calibration')) return 4;
    if (status === 'completed' || status === 'employee_acknowledged') return 6;
    return 5;
  };
  const activeStep = getActiveStep();

  const selfAssessment = appraisal.selfAssessment;
  const managerReview = appraisal.managerReview;
  const cycle = appraisal.cycleId;

  return (
    <Box>
      {/* Header */}
      <Box sx={{ mb: 4 }}>
        <Button startIcon={<ArrowBack />} onClick={() => router.push('/appraisals')} sx={{ mb: 2 }}>
          Back to Appraisals
        </Button>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Avatar sx={{ width: 64, height: 64, bgcolor: 'primary.main', fontSize: 28 }}>
              {appraisal.employee?.name?.[0] || 'E'}
            </Avatar>
            <Box>
              <Typography variant="h4" fontWeight={700}>
                {isEmployee ? 'My Appraisal' : `${appraisal.employee?.name}'s Appraisal`}
              </Typography>
              <Typography variant="body1" color="text.secondary">
                {cycle?.name || 'Performance Appraisal'} • {appraisal.employee?.jobTitle || 'Team Member'}
              </Typography>
              <Chip
                size="small"
                icon={config.icon as any}
                label={config.label}
                color={config.color}
                sx={{ mt: 1 }}
              />
            </Box>
          </Box>

          {/* Action Buttons */}
          <Box sx={{ display: 'flex', gap: 2 }}>
            {isEmployee && (appraisal.status === 'goal_setting') && (
              <Button
                variant="contained"
                startIcon={<Flag />}
                onClick={() => router.push(`/appraisals/${appraisalId}/goal-setting`)}
              >
                Set Goals
              </Button>
            )}
            {isEmployee && (appraisal.status === 'self_assessment_pending' || appraisal.status === 'self_assessment_in_progress') && (
              <Button
                variant="contained"
                startIcon={<PlayArrow />}
                onClick={() => router.push(`/appraisals/${appraisalId}/self-assessment`)}
              >
                {appraisal.status === 'self_assessment_in_progress' ? 'Continue' : 'Start'} Self-Assessment
              </Button>
            )}

            {(activeStep === 3) && (
              <Button
                variant="contained"
                startIcon={<Groups />}
                onClick={() => router.push(`/appraisals/${appraisalId}/discussion`)}
              >
                {appraisal.status === 'discussion_completed' ? 'View Discussion' : 'Open Discussion'}
              </Button>
            )}
            {isAssignedManager && (appraisal.status === 'self_assessment_submitted' || appraisal.status === 'manager_review_pending' || appraisal.status === 'manager_review_in_progress') && (
              <Button
                variant="contained"
                startIcon={<PlayArrow />}
                onClick={() => router.push(`/appraisals/${appraisalId}/manager-review`)}
              >
                {appraisal.status === 'manager_review_in_progress' ? 'Continue' : 'Start'} Review
              </Button>
            )}
          </Box>
        </Box>
      </Box>

      {/* Workflow Progress */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
          Appraisal Progress
        </Typography>
        <Stepper activeStep={getActiveStep()} alternativeLabel>
          {workflowSteps.map((step, index) => (
            <Step key={step.key} completed={index < getActiveStep()}>
              <StepLabel>{step.label}</StepLabel>
            </Step>
          ))}
        </Stepper>
      </Paper>

      {/* Deadline Warnings */}
      {appraisal.deadlines && (
        <Box sx={{ mb: 3, display: 'flex', gap: 2 }}>
          {appraisal.deadlines.selfAssessmentDue && !selfAssessment?.submittedAt && (
            <Alert
              severity={new Date(appraisal.deadlines.selfAssessmentDue) < new Date() ? 'error' : 'info'}
              icon={<Schedule />}
              sx={{ flex: 1 }}
            >
              Self-Assessment Due: {new Date(appraisal.deadlines.selfAssessmentDue).toLocaleDateString()}
              {new Date(appraisal.deadlines.selfAssessmentDue) < new Date() && ' (OVERDUE)'}
            </Alert>
          )}
          {appraisal.deadlines.managerReviewDue && selfAssessment?.submittedAt && !managerReview?.submittedAt && (
            <Alert
              severity={new Date(appraisal.deadlines.managerReviewDue) < new Date() ? 'error' : 'info'}
              icon={<Schedule />}
              sx={{ flex: 1 }}
            >
              Manager Review Due: {new Date(appraisal.deadlines.managerReviewDue).toLocaleDateString()}
              {new Date(appraisal.deadlines.managerReviewDue) < new Date() && ' (OVERDUE)'}
            </Alert>
          )}
        </Box>
      )}

      {/* Tabs */}
      <Paper sx={{ mb: 3 }}>
        <Tabs value={tabValue} onChange={(_, v) => setTabValue(v)} sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tab label="Overview" />
          <Tab label="Self-Assessment" disabled={!selfAssessment?.submittedAt && !isEmployee} />
          <Tab label="Manager Review" disabled={!managerReview?.submittedAt && !isAssignedManager && !isHRAdmin} />
          {appraisal.finalRating?.overall && <Tab label="Final Rating" />}
        </Tabs>

        {/* Overview Tab */}
        <TabPanel value={tabValue} index={0}>
          <Box sx={{ px: 3 }}>
            <Grid container spacing={3}>
              {/* Employee Info */}
              <Grid size={{ xs: 12, md: 6 }}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                      <Person sx={{ mr: 1, verticalAlign: 'middle' }} />
                      Employee
                    </Typography>
                    <Typography variant="body1">{appraisal.employee?.name}</Typography>
                    <Typography variant="body2" color="text.secondary">{appraisal.employee?.email}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {appraisal.employee?.jobTitle} • {appraisal.employee?.department}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>

              {/* Manager Info */}
              <Grid size={{ xs: 12, md: 6 }}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                      <Person sx={{ mr: 1, verticalAlign: 'middle' }} />
                      Manager
                    </Typography>
                    <Typography variant="body1">{appraisal.manager?.name}</Typography>
                    <Typography variant="body2" color="text.secondary">{appraisal.manager?.email}</Typography>
                  </CardContent>
                </Card>
              </Grid>

              {/* Cycle Info */}
              <Grid size={{ xs: 12, md: 6 }}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                      <Flag sx={{ mr: 1, verticalAlign: 'middle' }} />
                      Review Cycle
                    </Typography>
                    <Typography variant="body1">{cycle?.name || 'N/A'}</Typography>
                    {cycle?.periodStart && (
                      <Typography variant="body2" color="text.secondary">
                        {new Date(cycle.periodStart).toLocaleDateString()} - {new Date(cycle.periodEnd).toLocaleDateString()}
                      </Typography>
                    )}
                  </CardContent>
                </Card>
              </Grid>

              {/* Ratings Summary */}
              <Grid size={{ xs: 12, md: 6 }}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                      <Star sx={{ mr: 1, verticalAlign: 'middle' }} />
                      Ratings
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                      {selfAssessment?.overallSelfRating && (
                        <Chip
                          label={`Self: ${selfAssessment.overallSelfRating}/5`}
                          variant="outlined"
                          size="small"
                        />
                      )}
                      {managerReview?.overallManagerRating && (
                        <Chip
                          label={`Manager: ${managerReview.overallManagerRating}/5`}
                          color="primary"
                          variant="outlined"
                          size="small"
                        />
                      )}
                      {appraisal.finalRating?.overall && (
                        <Chip
                          label={`Final: ${appraisal.finalRating.overall}/5`}
                          color="success"
                          size="small"
                        />
                      )}
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          </Box>
        </TabPanel>

        {/* Self-Assessment Tab */}
        <TabPanel value={tabValue} index={1}>
          <Box sx={{ px: 3 }}>
            {selfAssessment?.submittedAt ? (
              <>
                <Alert severity="success" sx={{ mb: 3 }}>
                  Submitted on {new Date(selfAssessment.submittedAt).toLocaleDateString()}
                </Alert>

                {/* Summary */}
                <Accordion defaultExpanded>
                  <AccordionSummary expandIcon={<ExpandMore />}>
                    <Typography fontWeight={600}>Overall Summary</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Grid container spacing={2}>
                      <Grid size={{ xs: 12, md: 6 }}>
                        <Typography variant="caption" color="text.secondary">Key Achievements</Typography>
                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                          {selfAssessment.overallSummary?.achievements || 'Not provided'}
                        </Typography>
                      </Grid>
                      <Grid size={{ xs: 12, md: 6 }}>
                        <Typography variant="caption" color="text.secondary">Challenges</Typography>
                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                          {selfAssessment.overallSummary?.challenges || 'Not provided'}
                        </Typography>
                      </Grid>
                      <Grid size={{ xs: 12, md: 6 }}>
                        <Typography variant="caption" color="text.secondary">Learnings</Typography>
                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                          {selfAssessment.overallSummary?.learnings || 'Not provided'}
                        </Typography>
                      </Grid>
                      <Grid size={{ xs: 12, md: 6 }}>
                        <Typography variant="caption" color="text.secondary">Goals</Typography>
                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                          {selfAssessment.overallSummary?.goals || 'Not provided'}
                        </Typography>
                      </Grid>
                    </Grid>
                  </AccordionDetails>
                </Accordion>

                {/* Competency Ratings */}
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
                    )) || <Typography color="text.secondary">No competency ratings</Typography>}
                  </AccordionDetails>
                </Accordion>

                {/* Overall Self Rating */}
                <Box sx={{ mt: 3, p: 2, bgcolor: 'grey.50', borderRadius: 2 }}>
                  <Typography variant="subtitle1" fontWeight={600}>Overall Self-Rating</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1 }}>
                    <Rating value={selfAssessment.overallSelfRating} readOnly size="large" />
                    <Chip label={ratingLabels[selfAssessment.overallSelfRating]} color="primary" />
                  </Box>
                </Box>

                {/* AI Insights */}
                {selfAssessment.aiInsights && (
                  <Paper sx={{ mt: 3, p: 2, bgcolor: 'info.lighter', border: 1, borderColor: 'info.main' }}>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 2 }}>
                      <Psychology color="info" />
                      <Typography variant="subtitle1" fontWeight={600} color="info.main">
                        AI Analysis
                      </Typography>
                    </Box>
                    <Grid container spacing={2}>
                      {selfAssessment.aiInsights.strengths?.length > 0 && (
                        <Grid size={{ xs: 12, md: 6 }}>
                          <Typography variant="caption" fontWeight={600}>Identified Strengths</Typography>
                          <Box component="ul" sx={{ m: 0, pl: 2 }}>
                            {selfAssessment.aiInsights.strengths.map((s: string, i: number) => (
                              <li key={i}><Typography variant="body2">{s}</Typography></li>
                            ))}
                          </Box>
                        </Grid>
                      )}
                      {selfAssessment.aiInsights.developmentAreas?.length > 0 && (
                        <Grid size={{ xs: 12, md: 6 }}>
                          <Typography variant="caption" fontWeight={600}>Development Areas</Typography>
                          <Box component="ul" sx={{ m: 0, pl: 2 }}>
                            {selfAssessment.aiInsights.developmentAreas.map((s: string, i: number) => (
                              <li key={i}><Typography variant="body2">{s}</Typography></li>
                            ))}
                          </Box>
                        </Grid>
                      )}
                    </Grid>
                  </Paper>
                )}
              </>
            ) : (
              <Alert severity="info">
                {isEmployee
                  ? 'You have not submitted your self-assessment yet.'
                  : 'The employee has not submitted their self-assessment yet.'}
              </Alert>
            )}
          </Box>
        </TabPanel>

        {/* Manager Review Tab */}
        <TabPanel value={tabValue} index={2}>
          <Box sx={{ px: 3 }}>
            {managerReview?.submittedAt ? (
              <>
                <Alert severity="success" sx={{ mb: 3 }}>
                  Submitted on {new Date(managerReview.submittedAt).toLocaleDateString()}
                </Alert>

                {/* Summary */}
                <Accordion defaultExpanded>
                  <AccordionSummary expandIcon={<ExpandMore />}>
                    <Typography fontWeight={600}>Manager Assessment</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Grid container spacing={2}>
                      <Grid size={{ xs: 12, md: 6 }}>
                        <Typography variant="caption" color="text.secondary">Achievements Observed</Typography>
                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                          {managerReview.overallSummary?.achievements || 'Not provided'}
                        </Typography>
                      </Grid>
                      <Grid size={{ xs: 12, md: 6 }}>
                        <Typography variant="caption" color="text.secondary">Key Strengths</Typography>
                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                          {managerReview.overallSummary?.strengths || 'Not provided'}
                        </Typography>
                      </Grid>
                      <Grid size={{ xs: 12, md: 6 }}>
                        <Typography variant="caption" color="text.secondary">Areas for Improvement</Typography>
                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                          {managerReview.overallSummary?.improvements || 'Not provided'}
                        </Typography>
                      </Grid>
                      <Grid size={{ xs: 12, md: 6 }}>
                        <Typography variant="caption" color="text.secondary">Recommendations</Typography>
                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                          {managerReview.overallSummary?.recommendations || 'Not provided'}
                        </Typography>
                      </Grid>
                    </Grid>
                  </AccordionDetails>
                </Accordion>

                {/* Competency Ratings with Comparison */}
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMore />}>
                    <Typography fontWeight={600}>Competency Ratings</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    {managerReview.competencyRatings?.map((c: any) => (
                      <Box key={c.competencyId} sx={{ mb: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                          <Typography variant="body2" fontWeight={600}>{c.competencyName}</Typography>
                          {c.gapFromSelf && Math.abs(c.gapFromSelf) >= 2 && (
                            <Chip size="small" icon={<Warning />} label={`Gap: ${c.gapFromSelf > 0 ? '+' : ''}${c.gapFromSelf}`} color="warning" />
                          )}
                        </Box>
                        <Box sx={{ display: 'flex', gap: 3 }}>
                          <Box>
                            <Typography variant="caption" color="text.secondary">Manager Rating</Typography>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Rating value={c.managerRating} readOnly size="small" />
                            </Box>
                          </Box>
                          {selfAssessment?.competencyRatings && (
                            <Box>
                              <Typography variant="caption" color="text.secondary">Self Rating</Typography>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Rating
                                  value={selfAssessment.competencyRatings.find((s: any) => s.competencyId === c.competencyId)?.selfRating || 0}
                                  readOnly
                                  size="small"
                                />
                              </Box>
                            </Box>
                          )}
                        </Box>
                        {c.managerComments && (
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                            {c.managerComments}
                          </Typography>
                        )}
                      </Box>
                    )) || <Typography color="text.secondary">No competency ratings</Typography>}
                  </AccordionDetails>
                </Accordion>

                {/* Overall Manager Rating */}
                <Box sx={{ mt: 3, p: 2, bgcolor: 'grey.50', borderRadius: 2 }}>
                  <Typography variant="subtitle1" fontWeight={600}>Overall Manager Rating</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1 }}>
                    <Rating value={managerReview.overallManagerRating} readOnly size="large" />
                    <Chip label={ratingLabels[managerReview.overallManagerRating]} color="primary" />
                  </Box>
                </Box>
              </>
            ) : (
              <Alert severity="info">
                {isAssignedManager
                  ? 'You have not submitted your review yet.'
                  : 'The manager has not submitted their review yet.'}
              </Alert>
            )}
          </Box>
        </TabPanel>

        {/* Final Rating Tab */}
        {appraisal.finalRating?.overall && (
          <TabPanel value={tabValue} index={3}>
            <Box sx={{ px: 3 }}>
              <Card sx={{ p: 3, textAlign: 'center', bgcolor: 'success.lighter' }}>
                <Typography variant="h6" gutterBottom>Final Performance Rating</Typography>
                <Typography variant="h2" fontWeight={700} color="success.main">
                  {appraisal.finalRating.overall}
                </Typography>
                <Chip
                  label={appraisal.finalRating.ratingLabel || ratingLabels[Math.round(appraisal.finalRating.overall)]}
                  color="success"
                  sx={{ mt: 1 }}
                />
                {appraisal.finalRating.finalizedAt && (
                  <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 2 }}>
                    Finalized on {new Date(appraisal.finalRating.finalizedAt).toLocaleDateString()}
                    {appraisal.finalRating.finalizedBy?.name && ` by ${appraisal.finalRating.finalizedBy.name}`}
                  </Typography>
                )}
              </Card>

              {appraisal.finalRating.breakdown && (
                <Grid container spacing={2} sx={{ mt: 2 }}>
                  <Grid size={{ xs: 12, md: 6 }}>
                    <Card variant="outlined">
                      <CardContent>
                        <Typography variant="caption" color="text.secondary">OKR Score</Typography>
                        <Typography variant="h5">{appraisal.finalRating.okrScore?.toFixed(1) || 'N/A'}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          Weight: {appraisal.finalRating.breakdown.okrWeight}%
                        </Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                  <Grid size={{ xs: 12, md: 6 }}>
                    <Card variant="outlined">
                      <CardContent>
                        <Typography variant="caption" color="text.secondary">Competency Score</Typography>
                        <Typography variant="h5">{appraisal.finalRating.competencyScore?.toFixed(1) || 'N/A'}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          Weight: {appraisal.finalRating.breakdown.competencyWeight}%
                        </Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                </Grid>
              )}

              {appraisal.calibration && (
                <Alert severity="info" sx={{ mt: 3 }}>
                  <Typography variant="subtitle2" fontWeight={600}>Calibration Applied</Typography>
                  <Typography variant="body2">
                    Original rating: {appraisal.calibration.originalRating} → Calibrated: {appraisal.calibration.calibratedRating}
                  </Typography>
                  {appraisal.calibration.justification && (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                      {appraisal.calibration.justification}
                    </Typography>
                  )}
                </Alert>
              )}
            </Box>
          </TabPanel>
        )}
      </Paper>
    </Box>
  );
}
