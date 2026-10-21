'use client';

import AppraisalMeetings from '@/components/appraisals/AppraisalMeetings';
import AppraisalMetadata from '@/components/appraisals/AppraisalMetadata';
import AppraisalActions from '@/components/appraisals/AppraisalActions';
import CurrentAIAssessment from '@/components/appraisals/CurrentAIAssessment';
import CalendarAccountControl from '@/components/appraisals/CalendarAccountControl';
import { FlowStep } from '@/components/appraisals/AppraisalFlowEditor';
import { useEffect, useRef, useState } from 'react';
import ManagerReviewWorkspace from '@/components/appraisals/ManagerReviewWorkspace';
import AppraisalCompetencySlot from '@/components/competency/AppraisalCompetencySlot';
import { useParams, useRouter } from 'next/navigation';
import { useAppraisal, useUserContext } from '@/lib/hooks';
import {
  Box, Typography, Card, CardContent, Grid, Button, Chip, Alert,
  Paper, Stepper, Step, StepLabel, Rating,
  Accordion, AccordionSummary, AccordionDetails, Avatar,
  CircularProgress, Tabs, Tab, useTheme, useMediaQuery
} from '@mui/material';
import {
  ArrowBack, Edit, CheckCircle, Schedule, Person,
  ExpandMore, Assignment, TrendingUp, Chat,
  Psychology, Warning, Groups, ArrowForward, AssessmentOutlined
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

function normalizeIdentityEmail(value?: string | null) {
  if (!value || typeof value !== 'string') return null;
  return value.trim().toLowerCase();
}

const statusConfig: Record<string, { label: string; color: 'default' | 'info' | 'warning' | 'success' | 'error'; icon: React.ReactNode }> = {
  'meeting_pending': { label: 'One-on-one call', color: 'info', icon: <Groups /> },
  'not_started': { label: 'Not Started', color: 'default', icon: <Schedule /> },
  'goal_setting': { label: 'Goal Setting', color: 'info', icon: <Edit /> },
  'goal_approval_pending': { label: 'Goal Approval Pending', color: 'warning', icon: <Schedule /> },
  'self_assessment_pending': { label: 'Self-Assessment Pending', color: 'warning', icon: <Assignment /> },
  'self_assessment_in_progress': { label: 'Self-Assessment In Progress', color: 'info', icon: <Edit /> },
  'self_assessment_submitted': { label: 'Self-Assessment Submitted', color: 'success', icon: <CheckCircle /> },
  'manager_review_pending': { label: 'Manager Review Pending', color: 'warning', icon: <Person /> },
  'manager_review_in_progress': { label: 'Manager Review In Progress', color: 'info', icon: <Edit /> },
  'manager_review_submitted': { label: 'Review Submitted - Ready for Discussion', color: 'success', icon: <CheckCircle /> },
  'discussion_scheduled': { label: 'Discussion Scheduled', color: 'info', icon: <Chat /> },
  'discussion_completed': { label: 'Discussion Completed', color: 'success', icon: <CheckCircle /> },
  'calibration_pending': { label: 'Calibration Pending', color: 'warning', icon: <TrendingUp /> },
  'calibration_in_progress': { label: 'Calibration In Progress', color: 'info', icon: <TrendingUp /> },
  'calibration_completed': { label: 'Calibration Completed', color: 'success', icon: <CheckCircle /> },
  'final_review_pending': { label: 'Final Review Pending', color: 'warning', icon: <AssessmentOutlined /> },
  'employee_acknowledged': { label: 'Employee Acknowledged', color: 'success', icon: <CheckCircle /> },
  'completed': { label: 'Completed', color: 'success', icon: <CheckCircle /> },
  'cancelled': { label: 'Cancelled', color: 'error', icon: <Warning /> },
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
  const theme = useTheme();
  const compactProgress = useMediaQuery(theme.breakpoints.down('sm'));
  const params = useParams();
  const router = useRouter();
  const appraisalId = params.appraisalId as string;
  const { user, isManager, isHRAdmin } = useUserContext();

  const { appraisal, isLoading, isError, mutate } = useAppraisal(appraisalId);
  const [tabValue, setTabValue] = useState(0);
  const [view, setView] = useState<{ key: string | null; section: number }>({ key: null, section: 0 });
  const taskHeading = useRef<HTMLHeadingElement>(null);
  const previousStage = useRef<string | null>(null);
  const stageKey = appraisal ? `${appraisalId}:${String(appraisal.status).replace(/_(pending|in_progress)$/, '')}:${(appraisal.completedMeetingSteps || []).join(',')}` : null;
  const section = view.key === stageKey ? view.section : 0;
  const setSection = (section: number) => setView({ key: stageKey, section });
  useEffect(() => {
    if (!stageKey) return;
    if (previousStage.current && previousStage.current !== stageKey) {
      requestAnimationFrame(() => taskHeading.current?.focus());
    }
    previousStage.current = stageKey;
  }, [stageKey]);

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

  const identityUser = user as { id?: string; sub?: string; email?: string } | null;
  const requesterIds = Array.from(
    new Set(
      [identityUser?.id, identityUser?.sub]
        .filter(Boolean)
        .map((value) => String(value))
    )
  );
  const requesterEmail = normalizeIdentityEmail(identityUser?.email);
  const employeeUserId = appraisal.employee?.userId ? String(appraisal.employee.userId) : null;
  const employeeEmail = normalizeIdentityEmail(appraisal.employee?.email);
  const managerUserId = appraisal.manager?.userId ? String(appraisal.manager.userId) : null;
  const managerEmail = normalizeIdentityEmail(appraisal.manager?.email);

  const isEmployee = Boolean(
    (employeeUserId && requesterIds.includes(employeeUserId)) ||
    (employeeEmail && requesterEmail && employeeEmail === requesterEmail)
  );
  const isAssignedManager = Boolean(
    (managerUserId && requesterIds.includes(managerUserId)) ||
    (managerEmail && requesterEmail && managerEmail === requesterEmail)
  );
  const hasManagerAccess = typeof appraisal.viewerCapabilities?.canManage === 'boolean' ? appraisal.viewerCapabilities.canManage : isAssignedManager || (isManager && !isEmployee) || isHRAdmin;
  const cancelled = appraisal.status === 'cancelled';
  const config = statusConfig[appraisal.status] || statusConfig['not_started'];

  // Determine active workflow step
  const getActiveStep = () => {
    const status = appraisal.status || '';
    if (status === 'not_started' || status.includes('goal_setting') || status === 'goal_approval_pending') return 0;
    if (status === 'self_assessment_submitted') return 2;
    if (status === 'manager_review_submitted') return 3;
    if (status.includes('self_assessment')) return 1;
    if (status.includes('manager_review')) return 2;
    if (status.includes('discussion')) return 3;
    if (status.includes('calibration')) return 4;
    if (status === 'completed' || status === 'employee_acknowledged') return 6;
    return 5;
  };
  const customSteps: FlowStep[] | undefined = appraisal.cycleConfigurationSnapshot?.appraisalFlow?.steps;
  const stepIsComplete = (step: FlowStep) => ({
    selfAssessment: !!appraisal.selfAssessment?.submittedAt, managerReview: !!appraisal.managerReview?.submittedAt,
    discussion: !!appraisal.discussion?.completedDate, calibration: !!appraisal.calibration?.calibratedAt,
    finalReview: !!appraisal.finalRating?.finalizedAt, acknowledgement: !!appraisal.discussion?.employeeAcknowledgedAt,
    oneOnOne: (appraisal.completedMeetingSteps || []).includes(step.id)
  })[step.type];
  const customIndex = customSteps?.findIndex(step => !stepIsComplete(step)) ?? -1;
  const activeStep = customSteps ? (customIndex < 0 ? customSteps.length : customIndex) : getActiveStep();

  const selfAssessment = appraisal.selfAssessment;
  const managerReview = appraisal.managerReview;
  const cycle = appraisal.cycleId;
  const includesSelf = !customSteps || customSteps.some(step => step.type === 'selfAssessment');
  const includesReviewer = !customSteps || customSteps.some(step => step.type === 'managerReview');
  const visibleTabs = [...(includesSelf ? [0] : []), ...(includesReviewer ? [1] : []), ...(appraisal.finalRating?.overall ? [2] : [])];
  const selectedTab = visibleTabs.includes(tabValue) ? tabValue : visibleTabs[0] ?? -1;

  const progressSteps = customSteps || workflowSteps;
  const currentType = customSteps?.[activeStep]?.type || workflowSteps[activeStep]?.key;
  const acknowledgement = !cancelled && ((customSteps?.[activeStep]?.type === 'acknowledgement') || (!customSteps && appraisal.status === 'completed' && !appraisal.discussion?.employeeAcknowledged));
  const closed = cancelled || (!acknowledgement && ['completed', 'employee_acknowledged'].includes(appraisal.status)) || (!!customSteps && activeStep >= customSteps.length);
  const reviewerTask = !closed && currentType === 'managerReview';
  const callTask = !closed && currentType === 'oneOnOne';
  const employeeTask = ['selfAssessment', 'goalSetting', 'acknowledgement'].includes(currentType || '') || acknowledgement;
  const canWork = !closed && appraisal.status !== 'goal_approval_pending' && (employeeTask ? isEmployee : currentType === 'discussion' ? (isEmployee || hasManagerAccess) : hasManagerAccess && !isEmployee);
  const taskLabel = closed ? (cancelled ? 'Appraisal cancelled' : 'Appraisal completed') : acknowledgement ? 'Review and acknowledge the outcome' : progressSteps[activeStep]?.label || config.label;
  const taskRoute = acknowledgement ? 'discussion' : ({ selfAssessment: 'self-assessment', goalSetting: 'goal-setting', managerReview: 'manager-review', discussion: 'discussion', calibration: 'calibration', finalReview: 'final-review' } as Record<string, string>)[currentType || ''];
  const taskAction = acknowledgement ? 'Review and acknowledge outcome' : ({ selfAssessment: 'Open employee assessment', goalSetting: 'Set goals', discussion: 'Open Discussion', calibration: 'Open calibration', finalReview: 'Finalize appraisal' } as Record<string, string>)[currentType || ''] || 'Continue appraisal';
  const taskDescription = closed ? 'Your saved assessments, call notes and evidence remain available in the other views.' : ({
    selfAssessment: 'Reflect on the review period and submit your employee assessment.',
    managerReview: 'Record your ratings and feedback below. Open the employee submission and review context when you need supporting information.',
    oneOnOne: 'Join the scheduled call, save the agreed notes and complete this call step. The next task will appear here.',
    discussion: 'Review the feedback together and record the agreed discussion notes.',
    calibration: 'Check the proposed rating and record the calibration decision.',
    finalReview: 'Review the evidence and approve the final outcome.',
    acknowledgement: 'Read the published outcome and acknowledge it.',
    goalSetting: 'Set the goals for this appraisal period.'
  } as Record<string, string>)[acknowledgement ? 'acknowledgement' : currentType || ''] || 'Continue the current appraisal stage.';
  const waitingMessage = appraisal.status === 'goal_approval_pending' ? 'Waiting for the goals to be approved before the employee assessment begins.' : employeeTask ? 'Waiting for the employee to complete this step. You can view submitted work in Previous work & analytics.' : 'Your reviewer is completing this stage. Your submitted work remains available in Previous work & analytics.';
  const nextLabel = progressSteps[activeStep + 1]?.label;

  return (
    <Box>
      {/* Header */}
      <Box sx={{ mb: 4 }}>
        <Button startIcon={<ArrowBack />} onClick={() => router.push('/appraisals')} sx={{ mb: 2 }}>
          Back to Appraisals
        </Button>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0, maxWidth: '100%' }}>
            <Avatar sx={{ width: 64, height: 64, bgcolor: 'primary.main', fontSize: 28, color: 'primary.contrastText' }}>
              {appraisal.employee?.name?.[0] || 'E'}
            </Avatar>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h4" fontWeight={700} sx={{ fontSize: { xs: '1.65rem', sm: '2.125rem' }, overflowWrap: 'anywhere' }}>
                {isEmployee ? 'My Appraisal' : `${appraisal.employee?.name}'s Appraisal`}
              </Typography>
              <Typography variant="body1" color="text.secondary">
                {cycle?.name || 'Performance Appraisal'} • {appraisal.employee?.jobTitle || 'Team Member'}
              </Typography>
              <Chip
                size="small"
                icon={config.icon as any}
                label={appraisal.status === 'employee_acknowledged' && customSteps && !customSteps.some(step => step.type === 'acknowledgement') ? 'Completed' : config.label}
                color={config.color}
                sx={{ mt: 1 }}
              />
            </Box>
          </Box>

          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {hasManagerAccess && !isEmployee && <CalendarAccountControl connectionPath={`/appraisals/${appraisalId}/meetings/connection`} />}
            <Button variant="outlined" startIcon={<AssessmentOutlined />} onClick={() => setSection(3)}>Current AI assessment</Button>
            <AppraisalActions appraisalId={appraisalId} employeeName={appraisal.employee?.name} enabled={hasManagerAccess} onUpdated={() => { void mutate(); }} />
            {['completed', 'employee_acknowledged'].includes(appraisal.status) && <Button variant="outlined" onClick={() => router.push(`/appraisals/${appraisalId}/report`)}>View result report</Button>}
          </Box>
        </Box>
      </Box>

      {cancelled && <Alert severity="info" sx={{ mb: 3 }}>This appraisal was cancelled{appraisal.lifecycle?.cancelledAt ? ` on ${new Date(appraisal.lifecycle.cancelledAt).toLocaleString()}` : ''}. It is read-only. Its assessments, recordings and notes are retained.{appraisal.lifecycle?.reason && <Typography variant="body2" sx={{ mt: 1 }}>Reason: {appraisal.lifecycle.reason}</Typography>}</Alert>}
      <Tabs value={section} onChange={(_, value) => setSection(value)} aria-label="Appraisal workspace" variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tab id="appraisal-task-tab" aria-controls="appraisal-task-panel" label={closed ? 'Outcome' : 'Current task'} />
        <Tab id="appraisal-history-tab" aria-controls="appraisal-history-panel" label="Previous work & analytics" />
        <Tab id="appraisal-details-tab" aria-controls="appraisal-details-panel" label="Details & evidence" />
        <Tab id="appraisal-ai-tab" aria-controls="appraisal-ai-panel" label="Current AI assessment" />
      </Tabs>
      <Box id="appraisal-ai-panel" role="tabpanel" aria-labelledby="appraisal-ai-tab" hidden={section !== 3}>
        {section === 3 && <CurrentAIAssessment appraisalId={appraisalId} />}
      </Box>
      <Box id="appraisal-task-panel" role="tabpanel" aria-labelledby="appraisal-task-tab" hidden={section !== 0}>
        <Box sx={{ mb: 3 }}>
          <Typography variant="body2" color="text.secondary" mb={.5}>{closed ? 'Appraisal record' : `Step ${Math.min(activeStep + 1, progressSteps.length)} of ${progressSteps.length}`}</Typography>
          <Typography ref={taskHeading} tabIndex={-1} component="h2" variant="h5" fontWeight={600} sx={{ outline: 'none' }}>{taskLabel}</Typography>
          <Typography color="text.secondary" sx={{ mt: 1, maxWidth: '75ch' }}>{taskDescription}</Typography>
          {!closed && nextLabel && <Typography variant="body2" color="text.secondary" mt={1}>Next: {nextLabel}</Typography>}
        </Box>
        {reviewerTask && canWork && <ManagerReviewWorkspace key={appraisalId} embedded />}
        {callTask && customSteps && <AppraisalMeetings appraisalId={appraisalId} steps={customSteps.filter(step => step.type === 'oneOnOne')} focusCurrentStep readOnly={cancelled} canManage={hasManagerAccess && !isEmployee} canJoin={isEmployee || isAssignedManager} participantName={isEmployee ? appraisal.manager?.name : appraisal.employee?.name} ownName={isEmployee ? appraisal.employee?.name : appraisal.manager?.name} currentStepId={customSteps[activeStep]?.id} onUpdated={() => { void mutate(); }} />}
        {!reviewerTask && !callTask && canWork && taskRoute && <Button variant="contained" endIcon={<ArrowForward />} onClick={() => router.push(`/appraisals/${appraisalId}/${taskRoute}`)} sx={{ minHeight: 44, mb: 3 }}>{taskAction}</Button>}
        {!closed && !canWork && !callTask && <Alert severity="info" sx={{ mb: 3 }}>{waitingMessage}</Alert>}
        {closed && <Alert severity={cancelled ? 'info' : 'success'} sx={{ mb: 3 }}>{cancelled ? 'This appraisal is read-only. Its saved work is available in Previous work & analytics.' : 'The appraisal outcome is published. View the result report or open Previous work & analytics for the supporting work.'}</Alert>}
      </Box>
      <Box id="appraisal-details-panel" role="tabpanel" aria-labelledby="appraisal-details-tab" hidden={section !== 2}>
        <Paper variant="outlined" sx={{ p: 2.5, mb: 3 }}><Typography variant="h6" component="h2" fontWeight={600} sx={{ mb: 2 }}>Appraisal details & dates</Typography><AppraisalMetadata appraisal={appraisal} /></Paper>
        {reviewerTask && canWork && <Button variant="outlined" sx={{ minHeight: 44 }} onClick={() => { setSection(0); requestAnimationFrame(() => taskHeading.current?.focus()); }}>CV & supporting documents are in Current task</Button>}
        <AppraisalCompetencySlot appraisalId={appraisalId} includeCv={!reviewerTask || !canWork} />
      </Box>
      <Box id="appraisal-history-panel" role="tabpanel" aria-labelledby="appraisal-history-tab" hidden={section !== 1}>
      {customSteps && section === 1 && <AppraisalMeetings appraisalId={appraisalId} steps={customSteps.filter(step => step.type === 'oneOnOne')} readOnly={cancelled} canManage={!cancelled && hasManagerAccess && !isEmployee} canJoin={!cancelled && (isEmployee || isAssignedManager)} participantName={isEmployee ? appraisal.manager?.name : appraisal.employee?.name} ownName={isEmployee ? appraisal.employee?.name : appraisal.manager?.name} currentStepId={customSteps[activeStep]?.id} onUpdated={() => { void mutate(); }} />}
      {appraisal.discussion?.completedDate && <Button variant="outlined" sx={{ mb: 3, minHeight: 44 }} onClick={() => router.push(`/appraisals/${appraisalId}/discussion`)}>View Discussion</Button>}
      {/* Workflow Progress */}
      {!cancelled && <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
          Appraisal Progress
        </Typography>
        <Stepper activeStep={activeStep} orientation={customSteps || compactProgress ? 'vertical' : 'horizontal'} alternativeLabel={!customSteps && !compactProgress}
          role="group" aria-label="Appraisal progress">
          {(customSteps ? customSteps.map(step => ({ key: step.id, label: step.label })) : workflowSteps).map((step, index) => (
            <Step key={step.key} completed={index < activeStep} aria-current={index === activeStep ? 'step' : undefined} sx={{ minWidth: 0 }}>
              <StepLabel sx={{ '& .MuiStepLabel-label': { overflowWrap: 'anywhere' } }}>{step.label}</StepLabel>
            </Step>
          ))}
        </Stepper>
      </Paper>}

      {/* Deadline Warnings */}
      {!cancelled && appraisal.deadlines && (
        <Box sx={{ mb: 3, display: 'flex', gap: 2 }}>
          {includesSelf && appraisal.deadlines.selfAssessmentDue && !selfAssessment?.submittedAt && (
            <Alert
              severity={new Date(appraisal.deadlines.selfAssessmentDue) < new Date() ? 'error' : 'info'}
              icon={<Schedule />}
              sx={{ flex: 1 }}
            >
              Self-Assessment Due: {new Date(appraisal.deadlines.selfAssessmentDue).toLocaleDateString()}
              {new Date(appraisal.deadlines.selfAssessmentDue) < new Date() && ' (OVERDUE)'}
            </Alert>
          )}
          {includesReviewer && appraisal.deadlines.managerReviewDue && (selfAssessment?.submittedAt || !includesSelf || customSteps?.[activeStep]?.type === 'managerReview') && !managerReview?.submittedAt && (
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
      {visibleTabs.length > 0 && <Paper sx={{ mb: 3 }}>
        <Tabs value={selectedTab} onChange={(_, v) => setTabValue(v)} aria-label="Appraisal review sections"
          variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile sx={{ borderBottom: 1, borderColor: 'divider' }}>
          {/* <Tab label="Overview" /> REMOVED */}
          {includesSelf && <Tab value={0} label="Self-Assessment" disabled={!selfAssessment?.submittedAt && !isEmployee} />}
          {includesReviewer && <Tab value={1} label="Manager Review" disabled={!managerReview?.submittedAt && !hasManagerAccess} />}
          {appraisal.finalRating?.overall && <Tab value={2} label="Final Rating" />}
        </Tabs>

        {/* Overview Tab REMOVED */}

        {/* Self-Assessment Tab - Now Index 0 */}
        <TabPanel value={selectedTab} index={0}>
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
                <Box sx={{ mt: 3, p: 2, bgcolor: 'action.hover', borderRadius: 2 }}>
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

        {/* Manager Review Tab - Now Index 1 */}
        <TabPanel value={selectedTab} index={1}>
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
                <Box sx={{ mt: 3, p: 2, bgcolor: 'action.hover', borderRadius: 2 }}>
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

        {/* Final Rating Tab - Now Index 2 */}
        {appraisal.finalRating?.overall && (
          <TabPanel value={selectedTab} index={2}>
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
      </Paper>}
      {!closed && <Button variant="outlined" endIcon={<ArrowForward />} sx={{ minHeight: 44, mb: 3 }} onClick={() => { setSection(0); requestAnimationFrame(() => taskHeading.current?.focus()); }}>Return to current task</Button>}
      </Box>
    </Box>
  );
}
