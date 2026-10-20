'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useUserContext, useMyAppraisals, useTeamAppraisals, useAppraisalCycles, useOrganizationAppraisals } from '@/lib/hooks';
import { usePerformanceWorkspace } from '@/context/PerformanceWorkspaceContext';
import api from '@/lib/api';
import useSWR from 'swr';
import AppraisalHistory from '@/components/appraisals/AppraisalHistory';
import AppraisalMetadata from '@/components/appraisals/AppraisalMetadata';
import { AppraisalResultItem, isFinishedAppraisal, isAppraisalStepComplete, newestAppraisalsFirst, appraisalCreatedAt, resultCycleName } from '@/lib/appraisal-results';
import {
  Box, Typography, Card, CardContent, Grid, Button, Chip, Alert,
  LinearProgress, Paper, List, ListItem, ListItemText,
  ListItemAvatar, Avatar, ListItemSecondaryAction, IconButton,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  Stepper, Step, StepLabel, StepContent, Divider, CircularProgress,
  Tooltip, Badge, Select, MenuItem, FormControl, InputLabel, Tabs, Tab,
  alpha, useTheme, useMediaQuery
} from '@mui/material';
import {
  Assignment, Person, CheckCircle, Schedule, PlayArrow, Edit,
  Visibility, Chat, Star, Warning, ArrowForward, Add, Refresh,
  Psychology, AssessmentOutlined, Groups, TrendingUp, Rocket, NotificationsActive
} from '@mui/icons-material';
import { gradients } from '../theme';

interface Appraisal extends AppraisalResultItem {
  _id: string;
  cycleId: any;
  employee: { userId: string; name: string; email: string; jobTitle?: string; department?: string };
  manager: { userId: string; name: string; email: string };
  status: string;
  selfAssessment?: { submittedAt?: string; overallSelfRating?: number };
  managerReview?: { submittedAt?: string; overallManagerRating?: number };
  finalRating?: { overall?: number; ratingLabel?: string };
  deadlines?: { selfAssessmentDue?: string; managerReviewDue?: string };
  notifications?: Array<{
    type?: string;
    message?: string;
    sentAt?: string;
    readAt?: string;
  }>;
}

interface ManagerNotification {
  appraisalId: string;
  cycleName?: string;
  appraisalStatus?: string;
  employee?: {
    userId?: string;
    name?: string;
    email?: string;
  };
  type?: string;
  message?: string;
  sentAt?: string;
  readAt?: string;
}

interface AppraisalCycle {
  _id: string;
  name: string;
  description?: string;
  cycleType: string;
  periodStart: string;
  periodEnd: string;
  currentPhase: string;
  status: string;
  phases: Record<string, { startDate?: string; endDate?: string; isActive: boolean }>;
}

const statusConfig: Record<string, { label: string; color: 'default' | 'info' | 'warning' | 'success' | 'error'; icon: React.ReactNode; gradient?: string }> = {
  'not_started': { label: 'Not Started', color: 'default', icon: <Schedule /> },
  'goal_setting': { label: 'Goal Setting', color: 'info', icon: <Edit /> },
  'goal_approval_pending': { label: 'Goal Approval Pending', color: 'warning', icon: <Schedule /> },

  'self_assessment_pending': { label: 'Self-Assessment Pending', color: 'warning', icon: <Assignment />, gradient: 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)' },
  'self_assessment_in_progress': { label: 'Self-Assessment In Progress', color: 'info', icon: <Edit /> },
  'self_assessment_submitted': { label: 'Self-Assessment Submitted', color: 'success', icon: <CheckCircle />, gradient: 'linear-gradient(135deg, #10b981 0%, #34d399 100%)' },
  'manager_review_pending': { label: 'Manager Review Pending', color: 'warning', icon: <Person />, gradient: 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)' },
  'manager_review_in_progress': { label: 'Manager Review In Progress', color: 'info', icon: <Edit /> },
  'manager_review_submitted': { label: 'Manager Review Submitted', color: 'success', icon: <CheckCircle />, gradient: 'linear-gradient(135deg, #10b981 0%, #34d399 100%)' },
  'meeting_pending': { label: 'One-on-one call', color: 'info', icon: <Groups /> },
  'discussion_scheduled': { label: 'Discussion Scheduled', color: 'info', icon: <Chat /> },
  'discussion_completed': { label: 'Discussion Completed', color: 'success', icon: <CheckCircle /> },
  'calibration_pending': { label: 'Calibration Pending', color: 'warning', icon: <Groups /> },
  'calibration_in_progress': { label: 'Calibration In Progress', color: 'info', icon: <TrendingUp /> },
  'calibration_completed': { label: 'Calibration Completed', color: 'success', icon: <CheckCircle /> },
  'final_review_pending': { label: 'Final Review Pending', color: 'warning', icon: <AssessmentOutlined /> },
  'employee_acknowledged': { label: 'Employee Acknowledged', color: 'success', icon: <CheckCircle /> },
  'completed': { label: 'Completed', color: 'success', icon: <CheckCircle />, gradient: 'linear-gradient(135deg, #10b981 0%, #34d399 100%)' },
  'cancelled': { label: 'Cancelled', color: 'error', icon: <Warning /> },
};

const workflowSteps = [
  { key: 'selfAssessment', label: 'Self-Assessment' },
  { key: 'managerReview', label: 'Manager Review' },
  { key: 'discussion', label: 'Discussion' },
  { key: 'calibration', label: 'Calibration' },
  { key: 'finalReview', label: 'Final Review' },
];

export default function AppraisalsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const theme = useTheme();
  const compactProgress = useMediaQuery(theme.breakpoints.down('sm'));
  const { workspace } = usePerformanceWorkspace();
  const { isManager, isHRAdmin, user, role, organization } = useUserContext();

  const conducting = searchParams.get('section') === 'conducting';
  const selectedTab = conducting ? 1 : workspace === 'admin' && isHRAdmin ? 2 : workspace === 'manager' && isManager ? 1 : 0;
  const historyMode = searchParams.get('section') === 'history';
  const changeSection = (section: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('section', section);
    window.history.pushState(null, '', `${url.pathname}${url.search}`);
  };
  const [selectedCycleId, setSelectedCycleId] = useState<string>('');
  const [managerNotifications, setManagerNotifications] = useState<ManagerNotification[]>([]);

  const { appraisals: allMyAppraisals, isLoading: myLoading, isError: myError, mutate: mutateMyAppraisals } = useMyAppraisals({ cycleId: selectedCycleId || undefined });
  const { appraisals: allTeamAppraisals, isLoading: directTeamLoading, isError: teamError, mutate: mutateTeamAppraisals } = useTeamAppraisals({
    cycleId: selectedCycleId || undefined,
    enabled: selectedTab === 1 && !conducting,
  });
  const { cycles, isLoading: cyclesLoading } = useAppraisalCycles();

  const { appraisals: organizationAppraisals, isLoading: organizationLoading, isError: organizationError, mutate: mutateOrganizationAppraisals } = useOrganizationAppraisals(selectedTab === 2);
  const { data: assignedReviews = [], error: assignedError, isLoading: assignedLoading, mutate: refreshAssigned } = useSWR<Appraisal[]>(
    conducting && organization?.id ? ['/appraisals/assigned-reviews', organization.id] : null,
    async ([url]: [string, string]) => (await api.get(url)).data?.data || []
  );
  const scopedTeamAppraisals = conducting ? assignedReviews.filter((item) => !selectedCycleId || item.cycleId?._id === selectedCycleId) : selectedTab === 2
    ? organizationAppraisals.filter((item: Appraisal) => !selectedCycleId || item.cycleId?._id === selectedCycleId)
    : allTeamAppraisals;
  const teamLoading = conducting ? assignedLoading : selectedTab === 2 ? organizationLoading : directTeamLoading;
  const loadError = conducting ? assignedError : selectedTab === 2 ? organizationError : selectedTab === 1 ? teamError : myError;
  const allVisibleAppraisals: Appraisal[] = selectedTab ? scopedTeamAppraisals : allMyAppraisals;
  const employeeIdFilter = searchParams.get('employeeId') || searchParams.get('employee');
  const employeeVisibleAppraisals = allVisibleAppraisals.filter((item) => !employeeIdFilter || item.employee.userId === employeeIdFilter);
  const currentAppraisals = newestAppraisalsFirst(employeeVisibleAppraisals.filter((item) => !isFinishedAppraisal(item.status)));
  const myAppraisals = selectedTab === 0 ? currentAppraisals : [];
  const teamAppraisals = selectedTab > 0 ? currentAppraisals : [];
  const historyAppraisals = employeeVisibleAppraisals.filter((item) => isFinishedAppraisal(item.status));

  // Handle employee filter from query params
  const submittedFlow = searchParams.get('submitted');
  const submittedAppraisalId = searchParams.get('appraisalId');

  const loadManagerNotifications = useCallback(async () => {
    if (!isManager) {
      setManagerNotifications([]);
      return;
    }

    try {
      const response = await api.get('/appraisals/notifications/manager', {
        params: { unreadOnly: true, limit: 20 }
      });
      const notifications = response.data?.data?.notifications || [];
      setManagerNotifications(notifications);
    } catch (error) {
      console.error('Failed to fetch manager notifications', error);
      setManagerNotifications([]);
    }
  }, [isManager]);

  useEffect(() => {
    loadManagerNotifications();
  }, [loadManagerNotifications]);



  const handleStartSelfAssessment = (appraisalId: string) => {
    router.push(`/appraisals/${appraisalId}/self-assessment`);
  };

  const handleStartManagerReview = (appraisalId: string) => {
    router.push(`/appraisals/${appraisalId}/manager-review`);
  };

  // NEW: Start appraisal from not_started status
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<string | null>(null);
  const [resetReason, setResetReason] = useState('');
  const [resetError, setResetError] = useState('');

  const handleStartAppraisal = async (appraisalId: string) => {
    setActionLoading(appraisalId);
    try {
      await api.post(`/appraisals/${appraisalId}/start`);
      // Refresh data
      router.push(`/appraisals/${appraisalId}/self-assessment`);
    } catch (error: any) {
      console.error('Failed to start appraisal:', error);
      alert(error.response?.data?.error || 'Failed to start appraisal');
      setActionLoading(null);
    }
  };

  // NEW: Reset appraisal (Manager/HR only)
  const openResetAppraisal = (appraisalId: string) => {
    setResetTarget(appraisalId);
    setResetReason('');
    setResetError('');
  };
  const handleResetAppraisal = async () => {
    if (!resetTarget || actionLoading === resetTarget || resetReason.trim().length < 10) return;
    setActionLoading(resetTarget);
    setResetError('');
    try {
      await api.post(`/appraisals/${resetTarget}/reset`, { resetLevel: 'full', reason: resetReason.trim() });
      setResetTarget(null);
      setResetReason('');
      await Promise.allSettled([mutateMyAppraisals(), mutateTeamAppraisals(), mutateOrganizationAppraisals(), refreshAssigned()]);
    } catch (error: unknown) {
      const failure = error as { response?: { data?: { error?: string } } };
      setResetError(failure.response?.data?.error || 'Could not reset this appraisal. Please try again.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleViewAppraisal = (appraisalId: string) => {
    router.push(`/appraisals/${appraisalId}`);
  };

  const getStepStatus = (status: string, stepKey: string): 'completed' | 'active' | 'pending' => {
    const stepOrder = ['selfAssessment', 'managerReview', 'discussion', 'calibration', 'finalReview'] as const;

    const activeStepIndex = (() => {
      if (!status) return -1;
      if (status === 'completed' || status === 'employee_acknowledged') return stepOrder.length;
      if (['not_started', 'goal_setting', 'goal_approval_pending'].includes(status)) return -1;

      if (status === 'self_assessment_submitted') return 1; // legacy data
      if (status.startsWith('self_assessment')) return 0;
      if (status.startsWith('manager_review')) return 1;

      if (status.startsWith('discussion') || status === 'manager_review_submitted') return 2;
      if (status.startsWith('calibration')) return 3;
      if (status === 'final_review_pending') return 4;

      return -1;
    })();

    const stepIndex = stepOrder.indexOf(stepKey as any);

    if (activeStepIndex === stepOrder.length) return 'completed';
    if (stepIndex === -1) return 'pending';
    if (activeStepIndex === -1) return 'pending';
    if (stepIndex < activeStepIndex) return 'completed';
    if (stepIndex === activeStepIndex) return 'active';
    return 'pending';
  };

  const isOverdue = (deadline: string | undefined, status: string, stage: 'self' | 'manager') => {
    if (!deadline) return false;
    const due = new Date(deadline);
    if (Number.isNaN(due.getTime())) return false;

    const now = new Date();

    if (stage === 'self') {
      return ['self_assessment_pending', 'self_assessment_in_progress'].includes(status) && due < now;
    }

    return ['manager_review_pending', 'manager_review_in_progress', 'self_assessment_submitted'].includes(status) && due < now;
  };

  const unreadManagerNotificationCount = managerNotifications.filter((notification) => !notification.readAt).length;
  const submittedAppraisal = submittedFlow === 'self'
    ? myAppraisals.find((item: Appraisal) => item._id === submittedAppraisalId)
    : null;

  const handleOpenReviewFromNotification = async (appraisalId: string) => {
    try {
      await api.post(`/appraisals/${appraisalId}/manager-review/start`);
    } catch (startError) {
      console.error('Failed to start manager review from notification', startError);
      try {
        await api.post(`/appraisals/${appraisalId}/notifications/read`, {
          types: ['self_assessment_submitted', 'manager_review_requested']
        });
      } catch (readError) {
        console.error('Failed to mark notification as read', readError);
      }
    } finally {
      await Promise.all([mutateTeamAppraisals(), loadManagerNotifications()]);
      router.push(`/appraisals/${appraisalId}/manager-review`);
    }
  };

  const renderAppraisalCard = (appraisal: Appraisal, isEmployee: boolean, newest = false) => {
    const config = statusConfig[appraisal.status] || statusConfig['not_started'];
    const customSteps = appraisal.cycleConfigurationSnapshot?.appraisalFlow?.steps;
    const currentCustomStep = customSteps?.findIndex(step => !isAppraisalStepComplete(appraisal, step)) ?? -1;
    const cardSteps = customSteps ? customSteps.map(step => ({ key: step.id, label: step.label })) : workflowSteps;
    const selfDue = appraisal.deadlines?.selfAssessmentDue;
    const managerDue = appraisal.deadlines?.managerReviewDue;
    const selfOverdue = isOverdue(selfDue, appraisal.status, 'self');
    const managerOverdue = isOverdue(managerDue, appraisal.status, 'manager');

    return (
      <Card
        key={appraisal._id}
        component="article"
        aria-label={`${resultCycleName(appraisal)} — ${appraisal.employee?.name || 'Employee not recorded'}`}
        sx={{
          mb: 2,
          position: 'relative',
          overflow: 'hidden',
          transition: 'all 0.3s ease',
          '&:hover': {
            borderColor: 'primary.main',
          },
          '&::before': {
            content: '""',
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 4,
            background: selfOverdue || managerOverdue
              ? 'linear-gradient(180deg, #ef4444 0%, #f87171 100%)'
              : config.gradient || `linear-gradient(180deg, ${theme.palette[config.color]?.main || theme.palette.grey[400]} 0%, ${theme.palette[config.color]?.light || theme.palette.grey[300]} 100%)`,
          },
        }}
      >
        <CardContent sx={{ pl: 3 }}>
          <Grid container spacing={2} alignItems="center">
            {/* Person Info */}
            <Grid size={{ xs: 12, md: 4 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Avatar
                  sx={{
                    background: gradients.primary,
                    width: 52,
                    height: 52,
                    boxShadow: '0 4px 14px -4px rgba(99, 102, 241, 0.4)',
                  }}
                >
                  {isEmployee ? (appraisal.manager?.name?.[0] || 'M') : (appraisal.employee?.name?.[0] || 'E')}
                </Avatar>
                <Box>
                  <Typography variant="subtitle1" fontWeight={600}>
                    {isEmployee ? resultCycleName(appraisal) : (appraisal.employee?.name || 'Unknown Employee')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Reviewer: {appraisal.manager?.name || 'Unassigned'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {isEmployee ? 'Your appraisal' : resultCycleName(appraisal)}
                  </Typography>
                </Box>
              </Box>
            </Grid>

            {/* Status & Progress */}
            <Grid size={{ xs: 12, md: 4 }}>
              <Box>
                <Box sx={{ display: 'flex', gap: 1, mb: 1, flexWrap: 'wrap' }}>
                  {newest && appraisalCreatedAt(appraisal) && <Chip size="small" label="Newest active appraisal" color="primary" variant="outlined" />}
                  <Chip
                    size="small"
                    icon={config.icon as any}
                    label={appraisal.status === 'employee_acknowledged' && customSteps && !customSteps.some(step => step.type === 'acknowledgement') ? 'Completed' : config.label}
                    sx={{
                      fontWeight: 600,
                      background: config.gradient || alpha(theme.palette[config.color]?.main || theme.palette.grey[500], 0.1),
                      color: config.gradient ? 'white' : theme.palette[config.color]?.dark || theme.palette.grey[700],
                      '& .MuiChip-icon': {
                        color: 'inherit',
                      },
                    }}
                  />
                  {(selfOverdue || managerOverdue) && (
                    <Chip
                      size="small"
                      icon={<Warning />}
                      label="Overdue"
                      sx={{
                        fontWeight: 600,
                        background: 'linear-gradient(135deg, #ef4444 0%, #f87171 100%)',
                        color: 'white',
                        '& .MuiChip-icon': { color: 'white' },
                      }}
                    />
                  )}
                </Box>
              </Box>
            </Grid>

            {/* Ratings & Actions */}
            <Grid size={{ xs: 12, md: 4 }}>
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                {appraisal.selfAssessment?.overallSelfRating && (
                  <Tooltip title="Self Rating">
                    <Chip
                      size="small"
                      icon={<Star />}
                      label={`Self: ${appraisal.selfAssessment.overallSelfRating}`}
                      variant="outlined"
                      sx={{ borderColor: alpha(theme.palette.primary.main, 0.3) }}
                    />
                  </Tooltip>
                )}
                {appraisal.managerReview?.overallManagerRating && (
                  <Tooltip title="Manager Rating">
                    <Chip
                      size="small"
                      icon={<Star />}
                      label={`Mgr: ${appraisal.managerReview.overallManagerRating}`}
                      sx={{
                        background: alpha(theme.palette.primary.main, 0.1),
                        color: theme.palette.primary.dark,
                        borderColor: 'transparent',
                      }}
                    />
                  </Tooltip>
                )}
                {appraisal.finalRating?.overall && (
                  <Tooltip title="Final Rating">
                    <Chip
                      size="small"
                      icon={<Star />}
                      label={`Final: ${appraisal.finalRating.overall}`}
                      sx={{
                        background: 'linear-gradient(135deg, #10b981 0%, #34d399 100%)',
                        color: 'white',
                        '& .MuiChip-icon': { color: 'white' },
                      }}
                    />
                  </Tooltip>
                )}

                {/* Action Buttons */}

                {/* NEW: Start Appraisal button for not_started or goal_setting status */}
                {(appraisal.status === 'not_started' || appraisal.status === 'goal_setting') && (
                  <Button
                    variant="contained"
                    size="small"
                    startIcon={<Rocket />}
                    onClick={() => handleStartAppraisal(appraisal._id)}
                    disabled={actionLoading === appraisal._id}
                    sx={{
                      ml: 1,
                      background: 'linear-gradient(135deg, #10b981 0%, #34d399 100%)',
                      '&:hover': { background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)' }
                    }}
                  >
                    {actionLoading === appraisal._id ? 'Starting...' : 'Start Appraisal'}
                  </Button>
                )}

                {isEmployee && (appraisal.status === 'self_assessment_pending' || appraisal.status === 'self_assessment_in_progress') && (
                  <Button
                    variant="contained"
                    size="small"
                    startIcon={<PlayArrow />}
                    onClick={() => handleStartSelfAssessment(appraisal._id)}
                    sx={{ ml: 1 }}
                  >
                    {appraisal.status === 'self_assessment_in_progress' ? 'Continue' : 'Start'} Self-Assessment
                  </Button>
                )}

                {!isEmployee && (appraisal.status === 'self_assessment_submitted' || appraisal.status === 'manager_review_pending' || appraisal.status === 'manager_review_in_progress') && (
                  <Button
                    variant="contained"
                    size="small"
                    startIcon={<PlayArrow />}
                    onClick={() => handleStartManagerReview(appraisal._id)}
                    sx={{ ml: 1 }}
                  >
                    {appraisal.status === 'manager_review_in_progress' ? 'Continue' : 'Start'} Review
                  </Button>
                )}

                {(appraisal.status === 'manager_review_submitted' || appraisal.status === 'discussion_scheduled' || appraisal.status === 'discussion_completed') && (
                  <Button
                    variant="contained"
                    size="small"
                    startIcon={<Chat />}
                    onClick={() => router.push(`/appraisals/${appraisal._id}/discussion`)}
                    sx={{ ml: 1 }}
                  >
                    {appraisal.status === 'discussion_completed' ? 'View Discussion' : 'Open Discussion'}
                  </Button>
                )}

                {!isEmployee && (appraisal.status === 'calibration_pending' || appraisal.status === 'calibration_in_progress') && (
                  <Button
                    variant="contained"
                    size="small"
                    color="secondary"
                    startIcon={<TrendingUp />}
                    onClick={() => router.push(`/appraisals/${appraisal._id}/calibration`)}
                    sx={{ ml: 1 }}
                  >
                    {appraisal.status === 'calibration_in_progress' ? 'Continue Calibration' : 'Start Calibration'}
                  </Button>
                )}

                {!isEmployee && appraisal.status === 'final_review_pending' && (
                  <Button
                    variant="contained"
                    size="small"
                    color="success"
                    startIcon={<CheckCircle />}
                    onClick={() => router.push(`/appraisals/${appraisal._id}/final-review`)}
                    sx={{ ml: 1 }}
                  >
                    Finalize
                  </Button>
                )}

                {/* NEW: Reset button for managers (not for employees viewing their own) */}
                  {!isEmployee && !isFinishedAppraisal(appraisal.status) && appraisal.status !== 'not_started' && (
                  <Tooltip title="Reset Appraisal">
                    <IconButton
                      size="small"
                        aria-label={`Reset appraisal for ${appraisal.employee?.name || 'this employee'}`}
                        onClick={() => openResetAppraisal(appraisal._id)}
                      disabled={actionLoading === appraisal._id}
                      sx={{
                        ml: 1,
                        bgcolor: alpha(theme.palette.error.main, 0.08),
                        '&:hover': { bgcolor: alpha(theme.palette.error.main, 0.15) },
                        color: theme.palette.error.main
                      }}
                    >
                      <Refresh fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}

                <IconButton
                  size="small"
                  aria-label={`View appraisal for ${appraisal.employee?.name || 'employee'}`}
                  onClick={() => handleViewAppraisal(appraisal._id)}
                  sx={{
                    bgcolor: alpha(theme.palette.primary.main, 0.08),
                    '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.12) },
                  }}
                >
                  <Visibility fontSize="small" />
                </IconButton>
              </Box>
            </Grid>
          </Grid>

          <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}><AppraisalMetadata appraisal={appraisal} /></Box>

          {/* Progress Steps */}
          <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {cardSteps.map((step, idx) => {
              const stepStatus = customSteps ? (currentCustomStep < 0 || idx < currentCustomStep ? 'completed' : idx === currentCustomStep ? 'active' : 'pending') : getStepStatus(appraisal.status, step.key);
              return (
                <Chip
                  key={step.key}
                  size="small"
                  label={step.label}
                  variant={stepStatus === 'active' ? 'filled' : 'outlined'}
                  icon={stepStatus === 'completed' ? <CheckCircle /> : undefined}
                  sx={{
                    fontWeight: stepStatus === 'active' ? 600 : 400,
                    opacity: stepStatus === 'pending' ? 0.5 : 1,
                    ...(stepStatus === 'completed' && {
                      borderColor: theme.palette.success.main,
                      color: theme.palette.success.main,
                      '& .MuiChip-icon': { color: theme.palette.success.main },
                    }),
                    ...(stepStatus === 'active' && {
                      background: gradients.primary,
                      color: 'white',
                    }),
                  }}
                />
              );
            })}
          </Box>
        </CardContent>
      </Card>
    );
  };

  const renderCycleSummary = () => {
    const activeCycle = cycles.find((c: AppraisalCycle) => c._id === selectedCycleId);
    if (!activeCycle) return null;

    const activeStepIndex = workflowSteps.findIndex(s => s.key === activeCycle.currentPhase);

    return (
      <Paper
        sx={{
          p: 3,
          mb: 3,
          background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.03) 0%, rgba(139, 92, 246, 0.03) 100%)',
          border: `1px solid ${alpha(theme.palette.primary.main, 0.1)}`,
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
          <Box>
            <Typography variant="h6" fontWeight={700}>
              {activeCycle.name}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {new Date(activeCycle.periodStart).toLocaleDateString(undefined, { timeZone: 'UTC' })} - {new Date(activeCycle.periodEnd).toLocaleDateString(undefined, { timeZone: 'UTC' })}
            </Typography>
          </Box>
          <Chip
            label={activeCycle.status.charAt(0).toUpperCase() + activeCycle.status.slice(1)}
            sx={{
              fontWeight: 600,
              background: activeCycle.status === 'active'
                ? 'linear-gradient(135deg, #10b981 0%, #34d399 100%)'
                : alpha(theme.palette.grey[500], 0.1),
              color: activeCycle.status === 'active' ? 'white' : 'text.secondary',
            }}
          />
        </Box>

        <Stepper activeStep={activeStepIndex} orientation={compactProgress ? 'vertical' : 'horizontal'} alternativeLabel={!compactProgress}
          role="group" aria-label="Cycle phases" sx={{ mt: 3 }}>
          {workflowSteps.map((step, index) => {
            const phase = activeCycle.phases?.[step.key];
            return (
              <Step key={step.key} completed={index < activeStepIndex} aria-current={index === activeStepIndex ? 'step' : undefined} sx={{ minWidth: 0 }}>
                <StepLabel
                  sx={{
                    '& .MuiStepLabel-label': { overflowWrap: 'anywhere' },
                    '& .MuiStepLabel-iconContainer': {
                      '& .MuiStepIcon-root.Mui-active': {
                        color: 'primary.main',
                        filter: 'drop-shadow(0 0 8px rgba(99, 102, 241, 0.4))',
                      },
                    },
                  }}
                >
                  <Typography variant="caption" fontWeight={index === activeStepIndex ? 600 : 400}>
                    {step.label}
                  </Typography>
                  {phase?.endDate && (
                    <Typography variant="caption" display="block" color="text.secondary">
                      Due: {new Date(phase.endDate).toLocaleDateString()}
                    </Typography>
                  )}
                </StepLabel>
              </Step>
            );
          })}
        </Stepper>
      </Paper>
    );
  };

  return (
    <Box className="animate-fadeIn">
      {/* Header */}
      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography
            variant="h4"
            fontWeight={800}
            gutterBottom
          >
            Performance Appraisals
          </Typography>
          <Typography variant="body1" color="text.secondary">
            {selectedTab === 2 ? 'Start staff reviews, track current work, and find results across your organization.' : selectedTab === 1
              ? 'Start staff reviews, continue current work, and find past results for your team.'
              : 'Continue your current appraisal or find past results and reports.'}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap', width: { xs: '100%', md: 'auto' } }}>
          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel id="appraisals-cycle-label" shrink>Cycle</InputLabel>
            <Select
              id="appraisals-cycle"
              labelId="appraisals-cycle-label"
              displayEmpty
              value={selectedCycleId}
              label="Cycle"
              onChange={(e) => setSelectedCycleId(e.target.value)}
            >
              <MenuItem value="">All cycles</MenuItem>
              {cycles.map((cycle: AppraisalCycle) => (
                <MenuItem key={cycle._id} value={cycle._id}>
                  {cycle.name} {cycle.status === 'active' && '(Active)'}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {(isManager || isHRAdmin) && <Button variant="contained" startIcon={<Add />} onClick={() => router.push('/appraisals/start')}>Start appraisal</Button>}{(isManager || isHRAdmin) && <Button onClick={() => router.push('/appraisals?section=conducting')}>Reviews I’m conducting</Button>}
          {(isManager || isHRAdmin) && <Button onClick={() => router.push('/appraisals/removed')}>Removed appraisals</Button>}
        </Box>
      </Box>

      {submittedFlow === 'self' && (
        <Alert
          severity="success"
          sx={{
            mb: 3,
            borderRadius: 3,
            border: `1px solid ${alpha(theme.palette.success.main, 0.35)}`
          }}
        >
          <Typography variant="subtitle2" fontWeight={700}>
            Self-assessment submitted successfully
          </Typography>
          <Typography variant="body2">
            {submittedAppraisal?.manager?.name
              ? `Your manager (${submittedAppraisal.manager.name}) has been notified to start review.`
              : 'Your manager has been notified to start review.'}
          </Typography>
        </Alert>
      )}

      {!historyMode && workspace === 'manager' && isManager && unreadManagerNotificationCount > 0 && (
        <Paper
          sx={{
            p: 2.5,
            mb: 3,
            borderRadius: 3,
            border: `1px solid ${alpha(theme.palette.warning.main, 0.35)}`,
            background: `linear-gradient(135deg, ${alpha(theme.palette.warning.main, 0.12)} 0%, ${alpha(theme.palette.background.paper, 0.94)} 100%)`
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5, gap: 1 }}>
            <Typography variant="subtitle1" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <NotificationsActive color="warning" fontSize="small" />
              Manager Notifications
            </Typography>
            <Chip
              size="small"
              color="warning"
              label={`${unreadManagerNotificationCount} new`}
              sx={{ fontWeight: 700 }}
            />
          </Box>

          <List sx={{ py: 0 }}>
            {managerNotifications.slice(0, 4).map((notification, index) => (
              <ListItem
                key={`${notification.appraisalId}-${notification.sentAt || index}`}
                sx={{
                  px: 1.5,
                  py: 1,
                  mb: index < Math.min(managerNotifications.length, 4) - 1 ? 0.5 : 0,
                  borderRadius: 2,
                  bgcolor: alpha(theme.palette.background.paper, 0.75),
                  border: `1px solid ${alpha(theme.palette.warning.main, 0.18)}`
                }}
              >
                <ListItemAvatar>
                  <Avatar sx={{ width: 34, height: 34, bgcolor: alpha(theme.palette.warning.main, 0.2), color: 'warning.dark' }}>
                    {notification.employee?.name?.[0] || 'E'}
                  </Avatar>
                </ListItemAvatar>
                <ListItemText
                  primary={notification.message || `Time to review ${notification.employee?.name || 'this employee'} appraisal.`}
                  secondary={notification.sentAt ? new Date(notification.sentAt).toLocaleString() : 'Just now'}
                  primaryTypographyProps={{ variant: 'body2', fontWeight: 600 }}
                  secondaryTypographyProps={{ variant: 'caption' }}
                />
                <Button
                  size="small"
                  variant="contained"
                  onClick={() => handleOpenReviewFromNotification(notification.appraisalId)}
                  sx={{ ml: 1 }}
                >
                  Review
                </Button>
              </ListItem>
            ))}
          </List>
        </Paper>
      )}

      <Paper variant="outlined" sx={{ mb: 3 }}><Tabs value={historyMode ? 'history' : 'current'} onChange={(_, value: string) => changeSection(value)} variant="fullWidth"><Tab value="current" label={`Current (${currentAppraisals.length})`} /><Tab value="history" label={`History & results (${historyAppraisals.length})`} /></Tabs></Paper>
      {loadError && <Alert severity="error" action={<Button onClick={() => { mutateMyAppraisals(); mutateTeamAppraisals(); mutateOrganizationAppraisals(); refreshAssigned(); }}>Retry</Button>}>Could not load your appraisals. Please try again.</Alert>}
      {historyMode && !loadError && ((selectedTab ? teamLoading : myLoading) ? <CircularProgress aria-label="Loading appraisal history" /> : <AppraisalHistory appraisals={historyAppraisals} showEmployee={selectedTab > 0} organizationName={organization?.name} />)}
      {!historyMode && !loadError && <>
      {/* Cycle Summary */}
      {selectedCycleId && renderCycleSummary()}

      <Paper sx={{ mb: 3, px: 2.25, py: 1.5, bgcolor: alpha(theme.palette.grey[500], 0.04), display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
        <Box>
          <Typography variant="subtitle2" fontWeight={700}>
            {selectedTab === 2 ? 'Organization appraisals' : selectedTab === 1 ? 'Reviews I’m conducting' : 'Personal appraisals'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {selectedTab === 2 ? 'Appraisals for your organization, across every cycle.' : selectedTab === 1
              ? 'Reviews you are assigned to conduct appear here.'
              : 'Only appraisals where you are the employee are shown in this workspace.'}
          </Typography>
        </Box>
        <Badge
          badgeContent={(selectedTab > 0 ? teamAppraisals : myAppraisals).filter((item: Appraisal) => item.status.includes('pending')).length}
          color="warning"
          sx={{ '& .MuiBadge-badge': { fontWeight: 600 } }}
        >
          <Chip size="small" label={selectedTab === 2 ? 'HR view' : selectedTab === 1 ? 'Manager view' : 'Personal view'} />
        </Badge>
      </Paper>

      {/* My Appraisals */}
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Newest first by creation date. Completed and cancelled reviews are in History.</Typography>
      {selectedTab === 0 && (
        <Box>
          {myLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
              <CircularProgress />
            </Box>
          ) : myAppraisals.length === 0 ? (
            <Alert
              severity="info"
              sx={{
                borderRadius: 3,
                border: `1px solid ${alpha(theme.palette.info.main, 0.3)}`,
              }}
            >
              <Typography variant="body1" fontWeight={600}>No appraisals found</Typography>
              <Typography variant="body2">
                {selectedCycleId
                  ? 'You have no appraisals in this cycle. Your manager or HR will initiate your appraisal when the cycle begins.'
                  : 'You have no current appraisals. Open History & results for previous reviews.'}
              </Typography>
            </Alert>
          ) : (
            myAppraisals.map((appraisal: Appraisal, index: number) => renderAppraisalCard(appraisal, true, index === 0))
          )}
        </Box>
      )}

      {/* Team Appraisals (Manager View) */}
      {selectedTab > 0 && (conducting || isManager || isHRAdmin) && (
        <Box>
          {teamLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
              <CircularProgress />
            </Box>
          ) : teamAppraisals.length === 0 ? (
            <Alert
              severity="info"
              sx={{
                borderRadius: 3,
                border: `1px solid ${alpha(theme.palette.info.main, 0.3)}`,
              }}
            >
              <Typography variant="body1" fontWeight={600}>No team appraisals found</Typography>
              <Typography variant="body2">
                Start an appraisal for your staff, or open History & results to find completed reviews.
              </Typography>
            </Alert>
          ) : (
            <>
              {/* Summary Stats */}
              <Grid container spacing={2} sx={{ mb: 3 }}>
                {[
                  { label: 'Total', value: teamAppraisals.length, color: 'primary' },
                  { label: 'Pending Action', value: teamAppraisals.filter((a: Appraisal) => a.status.includes('pending') || a.status.includes('in_progress')).length, color: 'warning' },
                  { label: 'Self-Assessment Done', value: teamAppraisals.filter((a: Appraisal) => a.selfAssessment?.submittedAt).length, color: 'info' },
                  { label: 'Awaiting Employee', value: teamAppraisals.filter((a: Appraisal) => ['self_assessment_pending', 'self_assessment_in_progress'].includes(a.status)).length, color: 'info' },
                ].map((stat, index) => (
                  <Grid key={index} size={{ xs: 6, md: 3 }}>
                    <Paper
                      sx={{
                        p: 2,
                        textAlign: 'center',
                        borderLeft: stat.value > 0 && stat.color !== 'primary' ? 4 : 0,
                        borderColor: stat.value > 0 ? `${stat.color}.main` : 'transparent',
                      }}
                    >
                      <Typography
                        variant="h4"
                        fontWeight={700}
                        color={stat.value > 0 ? `${stat.color}.main` : 'text.primary'}
                      >
                        {stat.value}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">{stat.label}</Typography>
                    </Paper>
                  </Grid>
                ))}
              </Grid>

              {teamAppraisals.map((appraisal: Appraisal, index: number) => renderAppraisalCard(appraisal, false, index === 0))}
            </>
          )}
        </Box>
      )}

      </>}

      <Dialog open={!!resetTarget} onClose={() => { if (actionLoading !== resetTarget) setResetTarget(null); }} aria-labelledby="reset-appraisal-title" maxWidth="sm" fullWidth>
        <DialogTitle id="reset-appraisal-title">Reset appraisal?</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>This clears the employee assessment and reviewer assessment so they can start again. Goals and audit history are retained. Completed appraisals cannot be reset.</Typography>
          {resetError && <Alert severity="error" sx={{ mb: 2 }}>{resetError}</Alert>}
          <TextField autoFocus fullWidth required multiline minRows={3} label="Reason for resetting" value={resetReason}
            disabled={!!resetTarget && actionLoading === resetTarget}
            onChange={event => { setResetReason(event.target.value); setResetError(''); }}
            helperText="Explain why this review needs to restart (at least 10 characters). This reason is saved in the audit history." />
        </DialogContent>
        <DialogActions>
          <Button disabled={!!resetTarget && actionLoading === resetTarget} onClick={() => setResetTarget(null)}>Cancel</Button>
          <Button variant="contained" color="error" disabled={resetReason.trim().length < 10 || (!!resetTarget && actionLoading === resetTarget)} onClick={() => void handleResetAppraisal()}>
            {!!resetTarget && actionLoading === resetTarget ? 'Resetting…' : 'Reset appraisal'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
