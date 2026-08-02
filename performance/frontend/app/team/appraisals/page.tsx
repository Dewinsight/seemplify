'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTeamAppraisals, useAppraisalCycles, useUserContext } from '@/lib/hooks';
import {
  Box, Typography, Button, Card, CardContent, Chip, Avatar,
  Stepper, Step, StepLabel, LinearProgress, Grid, Alert,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, TextField, InputAdornment, MenuItem, Select, FormControl,
  InputLabel, Badge, Tooltip
} from '@mui/material';
import {
  PlayArrow, Visibility, Search, FilterList, Person,
  Description, Chat as ChatIcon, Warning, CheckCircle
} from '@mui/icons-material';

// Status chip colors
const statusColors: Record<string, 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'> = {
  not_started: 'default',
  goal_setting: 'info',
  goal_approval_pending: 'warning',
  self_assessment_pending: 'warning',
  self_assessment_in_progress: 'info',
  self_assessment_submitted: 'info', // legacy
  manager_review_pending: 'warning',
  manager_review_in_progress: 'info',
  final_review_pending: 'warning',
  completed: 'success',
  employee_acknowledged: 'success',
  cancelled: 'error',
};

// Workflow steps
const workflowSteps = [
  'Self Assessment',
  'Manager Review',
  'Final Review',
  'Completed'
];

function getActiveStep(status: string): number {
  if (status === 'completed' || status === 'employee_acknowledged') return 4;
  if (status === 'final_review_pending') return 2;
  if (status === 'self_assessment_submitted' || status.startsWith('manager_review')) return 1;
  if (status.startsWith('self_assessment')) return 0;
  return 0;
}

export default function TeamAppraisalsPage() {
  const router = useRouter();
  const { isManager } = useUserContext();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [cycleFilter, setCycleFilter] = useState('');

  // Fetch data
  const { appraisals, isLoading, isError } = useTeamAppraisals({
    status: statusFilter !== 'all' ? statusFilter : undefined,
    cycleId: cycleFilter || undefined
  });
  const { cycles } = useAppraisalCycles({ status: 'active' });

  // Filter appraisals by search query
  const filteredAppraisals = appraisals.filter((appraisal: any) => {
    if (!searchQuery) return true;
    const employeeName = appraisal.employee?.name?.toLowerCase() || '';
    const employeeEmail = appraisal.employee?.email?.toLowerCase() || '';
    return employeeName.includes(searchQuery.toLowerCase()) ||
           employeeEmail.includes(searchQuery.toLowerCase());
  });

  // Count appraisals requiring action
  const pendingCount = appraisals.filter((a: any) =>
    ['self_assessment_submitted', 'manager_review_pending', 'manager_review_in_progress', 'final_review_pending'].includes(a.status)
  ).length;

  if (!isManager) {
    return (
      <Box>
        <Alert severity="warning">
          You don't have permission to view team appraisals. This page is for managers only.
        </Alert>
      </Box>
    );
  }

  const handleViewAppraisal = (id: string) => {
    router.push(`/appraisals/${id}`);
  };

  const handleStartManagerReview = (id: string) => {
    router.push(`/appraisals/${id}/manager-review`);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" gutterBottom>Team Appraisals</Typography>
          <Typography variant="body2" color="text.secondary">
            Review and manage performance appraisals for your direct reports
          </Typography>
        </Box>
        {pendingCount > 0 && (
          <Chip
            label={`${pendingCount} Requiring Action`}
            color="warning"
            icon={<Warning />}
          />
        )}
      </Box>

      {/* Filters */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Grid container spacing={2} alignItems="center">
            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                fullWidth
                size="small"
                placeholder="Search by employee name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <Search />
                    </InputAdornment>
                  ),
                }}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Status</InputLabel>
                <Select
                  value={statusFilter}
                  label="Status"
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <MenuItem value="all">All Statuses</MenuItem>
                  <MenuItem value="self_assessment_pending">Self Assessment Pending</MenuItem>
                  <MenuItem value="self_assessment_in_progress">Self Assessment In Progress</MenuItem>
                  <MenuItem value="self_assessment_submitted">Self Assessment Submitted (Legacy)</MenuItem>
                  <MenuItem value="manager_review_pending">Manager Review Pending</MenuItem>
                  <MenuItem value="manager_review_in_progress">Manager Review In Progress</MenuItem>
                  <MenuItem value="final_review_pending">Final Review Pending</MenuItem>
                  <MenuItem value="completed">Completed</MenuItem>
                  <MenuItem value="cancelled">Cancelled</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, md: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Review Cycle</InputLabel>
                <Select
                  value={cycleFilter}
                  label="Review Cycle"
                  onChange={(e) => setCycleFilter(e.target.value)}
                >
                  <MenuItem value="">All Cycles</MenuItem>
                  {cycles.map((cycle: any) => (
                    <MenuItem key={cycle._id} value={cycle._id}>
                      {cycle.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {isLoading ? (
        <LinearProgress />
      ) : isError ? (
        <Alert severity="error">Failed to load team appraisals</Alert>
      ) : filteredAppraisals.length === 0 ? (
        <Alert severity="info">
          No team appraisals found. Appraisals will appear here when a review cycle is started for your team members.
        </Alert>
      ) : (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Employee</TableCell>
                <TableCell>Review Cycle</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Progress</TableCell>
                <TableCell align="center">Documents</TableCell>
                <TableCell align="center">Messages</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredAppraisals.map((appraisal: any) => {
                const needsReview = ['self_assessment_submitted', 'manager_review_pending', 'manager_review_in_progress'].includes(appraisal.status);
                const needsFinalReview = appraisal.status === 'final_review_pending';
                const needsAction = needsReview || needsFinalReview;

                return (
                  <TableRow
                    key={appraisal._id}
                    sx={{
                      bgcolor: needsAction ? 'warning.lighter' : 'inherit',
                      '&:hover': { bgcolor: 'action.hover' }
                    }}
                  >
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <Avatar sx={{ bgcolor: needsAction ? 'warning.main' : 'primary.main' }}>
                          {appraisal.employee?.name?.[0] || 'E'}
                        </Avatar>
                        <Box>
                          <Typography variant="body2" fontWeight={600}>
                            {appraisal.employee?.name || 'Team Member'}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {appraisal.employee?.email || ''}
                          </Typography>
                        </Box>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {appraisal.cycleId?.name || 'Review Cycle'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {appraisal.cycleId?.periodStart
                          ? `${new Date(appraisal.cycleId.periodStart).toLocaleDateString()} - ${new Date(appraisal.cycleId.periodEnd).toLocaleDateString()}`
                          : 'N/A'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={appraisal.status?.replace(/_/g, ' ')}
                        color={statusColors[appraisal.status] || 'default'}
                        size="small"
                        icon={needsAction ? <Warning /> : appraisal.status === 'completed' ? <CheckCircle /> : undefined}
                      />
                    </TableCell>
                    <TableCell sx={{ minWidth: 200 }}>
                      <Box>
                        <Stepper activeStep={getActiveStep(appraisal.status)} alternativeLabel>
                          {workflowSteps.map((label, index) => (
                            <Step key={label} completed={getActiveStep(appraisal.status) > index}>
                              <StepLabel sx={{ '& .MuiStepLabel-label': { fontSize: 10 } }}>
                                {label.split(' ')[0]}
                              </StepLabel>
                            </Step>
                          ))}
                        </Stepper>
                      </Box>
                    </TableCell>
                    <TableCell align="center">
                      {appraisal.documents?.length > 0 ? (
                        <Tooltip title={`${appraisal.documents.length} documents attached`}>
                          <Badge badgeContent={appraisal.documents.length} color="secondary">
                            <Description />
                          </Badge>
                        </Tooltip>
                      ) : (
                        <Typography variant="caption" color="text.secondary">-</Typography>
                      )}
                    </TableCell>
                    <TableCell align="center">
                      {appraisal.chatThread?.length > 0 ? (
                        <Tooltip title={`${appraisal.chatThread.length} messages`}>
                          <Badge badgeContent={appraisal.chatThread.length} color="info">
                            <ChatIcon />
                          </Badge>
                        </Tooltip>
                      ) : (
                        <Typography variant="caption" color="text.secondary">-</Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        variant={needsAction ? 'contained' : 'outlined'}
                        color={needsFinalReview ? 'success' : needsReview ? 'warning' : 'primary'}
                        size="small"
                        startIcon={needsFinalReview ? <CheckCircle /> : needsReview ? <PlayArrow /> : <Visibility />}
                        onClick={() => {
                          if (needsFinalReview) return router.push(`/appraisals/${appraisal._id}/final-review`);
                          if (needsReview) return handleStartManagerReview(appraisal._id);
                          return handleViewAppraisal(appraisal._id);
                        }}
                      >
                        {needsFinalReview ? 'Finalize' : needsReview ? 'Review' : 'View'}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Summary Cards */}
      {!isLoading && filteredAppraisals.length > 0 && (
        <Grid container spacing={2} sx={{ mt: 3 }}>
          <Grid size={{ xs: 12, md: 3 }}>
            <Card>
              <CardContent sx={{ textAlign: 'center' }}>
                <Typography variant="h3" color="text.secondary">
                  {filteredAppraisals.length}
                </Typography>
                <Typography variant="body2">Total Appraisals</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <Card>
              <CardContent sx={{ textAlign: 'center' }}>
                <Typography variant="h3" color="warning.main">
                  {pendingCount}
                </Typography>
                <Typography variant="body2">Requiring Action</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <Card>
              <CardContent sx={{ textAlign: 'center' }}>
                <Typography variant="h3" color="warning.main">
                  {filteredAppraisals.filter((a: any) => a.status === 'final_review_pending').length}
                </Typography>
                <Typography variant="body2">Final Review Pending</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <Card>
              <CardContent sx={{ textAlign: 'center' }}>
                <Typography variant="h3" color="success.main">
                  {filteredAppraisals.filter((a: any) => ['completed', 'employee_acknowledged'].includes(a.status)).length}
                </Typography>
                <Typography variant="body2">Completed</Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}
    </Box>
  );
}
