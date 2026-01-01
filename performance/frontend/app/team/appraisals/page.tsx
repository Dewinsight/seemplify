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
  draft: 'default',
  self_assessment_pending: 'warning',
  self_assessment_submitted: 'info',
  manager_review_pending: 'warning',
  manager_review_submitted: 'info',
  discussion_pending: 'warning',
  discussion_completed: 'info',
  calibration_pending: 'warning',
  final_review: 'primary',
  completed: 'success',
  acknowledged: 'success',
};

// Workflow steps
const workflowSteps = [
  'Self Assessment',
  'Manager Review',
  'Discussion',
  'Calibration',
  'Final Review'
];

function getActiveStep(status: string): number {
  const stepMap: Record<string, number> = {
    draft: 0,
    self_assessment_pending: 0,
    self_assessment_submitted: 1,
    manager_review_pending: 1,
    manager_review_submitted: 2,
    discussion_pending: 2,
    discussion_completed: 3,
    calibration_pending: 3,
    final_review: 4,
    completed: 5,
    acknowledged: 5,
  };
  return stepMap[status] || 0;
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
    ['self_assessment_submitted', 'manager_review_pending'].includes(a.status)
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
                  <MenuItem value="self_assessment_submitted">Self Assessment Submitted</MenuItem>
                  <MenuItem value="manager_review_pending">Manager Review Pending</MenuItem>
                  <MenuItem value="manager_review_submitted">Manager Review Submitted</MenuItem>
                  <MenuItem value="discussion_pending">Discussion Pending</MenuItem>
                  <MenuItem value="completed">Completed</MenuItem>
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
                const needsAction = ['self_assessment_submitted', 'manager_review_pending'].includes(appraisal.status);

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
                        {appraisal.cycleId?.reviewPeriod?.startDate
                          ? `${new Date(appraisal.cycleId.reviewPeriod.startDate).toLocaleDateString()} - ${new Date(appraisal.cycleId.reviewPeriod.endDate).toLocaleDateString()}`
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
                        color={needsAction ? 'warning' : 'primary'}
                        size="small"
                        startIcon={needsAction ? <PlayArrow /> : <Visibility />}
                        onClick={() => needsAction ? handleStartManagerReview(appraisal._id) : handleViewAppraisal(appraisal._id)}
                      >
                        {needsAction ? 'Review' : 'View'}
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
                <Typography variant="body2">Pending Review</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <Card>
              <CardContent sx={{ textAlign: 'center' }}>
                <Typography variant="h3" color="info.main">
                  {filteredAppraisals.filter((a: any) => a.status?.includes('discussion')).length}
                </Typography>
                <Typography variant="body2">In Discussion</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <Card>
              <CardContent sx={{ textAlign: 'center' }}>
                <Typography variant="h3" color="success.main">
                  {filteredAppraisals.filter((a: any) => ['completed', 'acknowledged'].includes(a.status)).length}
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
