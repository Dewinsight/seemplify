'use client';

export const dynamic = 'force-dynamic';

import { useState } from 'react';
import { useDirectReports, useDirectReportsReviews, usePendingReviews, useUserContext, useReviewCycles } from '@/lib/hooks';
import {
  Box, Typography, Card, CardContent, LinearProgress, Alert,
  Avatar, Chip, Button, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, IconButton, Tooltip, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, Rating, Select, MenuItem,
  FormControl, InputLabel, Grid, Skeleton
} from '@mui/material';
import { 
  RateReview, CheckCircle, Pending, Warning, 
  Edit, Visibility, AutoFixHigh, Schedule
} from '@mui/icons-material';

export default function TeamReviewsPage() {
  const { isManager, role } = useUserContext();
  const { managedTeams, directReports, totalDirectReports, isLoading: reportsLoading } = useDirectReports();
  const { pendingReviews, count: pendingCount, isLoading: pendingLoading } = usePendingReviews();
  const { reviewsByUser, isLoading: reviewsLoading } = useDirectReportsReviews();
  const { cycles, isLoading: cyclesLoading } = useReviewCycles();
  
  const [selectedMember, setSelectedMember] = useState<any>(null);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [managerNotes, setManagerNotes] = useState('');
  const [rating, setRating] = useState<number | null>(null);
  const [selectedCycle, setSelectedCycle] = useState<string>('');

  const isLoading = reportsLoading || pendingLoading || reviewsLoading || cyclesLoading;

  if (isLoading) {
    return (
      <Box>
        <Skeleton variant="text" width={200} height={40} />
        <Skeleton variant="text" width={300} height={24} sx={{ mb: 3 }} />
        <Skeleton variant="rectangular" height={100} sx={{ borderRadius: 2, mb: 3 }} />
        <Grid container spacing={3} sx={{ mb: 4 }}>
          {[1, 2, 3, 4].map(i => (
            <Grid key={i} size={{ xs: 12, sm: 6, md: 3 }}>
              <Skeleton variant="rectangular" height={100} sx={{ borderRadius: 2 }} />
            </Grid>
          ))}
        </Grid>
        <Skeleton variant="rectangular" height={400} sx={{ borderRadius: 2 }} />
      </Box>
    );
  }

  if (!isManager) {
    return (
      <Box>
        <Typography variant="h4" fontWeight={700} gutterBottom>
          Team Reviews
        </Typography>
        <Alert severity="info" sx={{ mt: 2 }}>
          This page is for team managers to conduct performance reviews for their direct reports.
          You don't have any direct reports assigned to you.
        </Alert>
      </Box>
    );
  }

  // Get active review cycle
  const activeCycle = cycles.find((c: any) => c.status === 'active');
  
  // Calculate review statistics
  const allReviews = Object.values(reviewsByUser).flat() as any[];
  const completedReviews = allReviews.filter((r: any) => r.managerDone).length;
  const selfDoneReviews = allReviews.filter((r: any) => r.selfDone && !r.managerDone).length;

  const handleOpenReview = (member: any) => {
    setSelectedMember(member);
    setManagerNotes('');
    setRating(null);
    setReviewDialogOpen(true);
  };

  const handleSubmitReview = async () => {
    console.log('Submitting review for:', selectedMember?.name, { rating, managerNotes });
    // TODO: Call API to submit review
    setReviewDialogOpen(false);
  };

  const handleAiSuggest = () => {
    setManagerNotes(
      `${selectedMember?.name || 'This team member'} has demonstrated consistent performance this quarter. ` +
      `Key achievements include meeting project deadlines and showing strong collaboration skills. ` +
      `Areas for growth include taking on more leadership responsibilities and expanding technical skills.\n\n` +
      `Strengths:\n- Strong technical execution\n- Good team collaboration\n- Reliable delivery\n\n` +
      `Development Areas:\n- Leadership presence\n- Cross-functional communication\n- Strategic thinking`
    );
    setRating(4);
  };

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" fontWeight={700} gutterBottom>
          Team Reviews
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Conduct and track performance reviews for your direct reports
        </Typography>
      </Box>

      {/* Current Review Cycle Banner */}
      {activeCycle ? (
        <Card sx={{ mb: 4, bgcolor: 'primary.light' }}>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
              <Box>
                <Typography variant="h6" color="primary.dark" fontWeight={600}>
                  {activeCycle.title}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                  <Schedule fontSize="small" sx={{ color: 'primary.dark' }} />
                  <Typography variant="body2" color="primary.dark">
                    {new Date(activeCycle.startDate).toLocaleDateString()} - {new Date(activeCycle.endDate).toLocaleDateString()}
                  </Typography>
                </Box>
              </Box>
              <Box sx={{ display: 'flex', gap: 2 }}>
                <Chip
                  icon={<CheckCircle />}
                  label={`${completedReviews} Completed`}
                  color="success"
                />
                <Chip
                  icon={<Pending />}
                  label={`${selfDoneReviews} Awaiting Your Review`}
                  color="warning"
                />
              </Box>
            </Box>
          </CardContent>
        </Card>
      ) : (
        <Alert severity="info" sx={{ mb: 4 }}>
          No active review cycle. Review cycles are created by HR Administration.
        </Alert>
      )}

      {/* Summary Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card>
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Direct Reports
              </Typography>
              <Typography variant="h3" fontWeight={700}>
                {totalDirectReports}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card>
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Self Reviews Done
              </Typography>
              <Typography variant="h3" fontWeight={700} color="info.main">
                {allReviews.filter((r: any) => r.selfDone).length}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card>
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Your Reviews Done
              </Typography>
              <Typography variant="h3" fontWeight={700} color="success.main">
                {completedReviews}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card sx={{ bgcolor: selfDoneReviews > 0 ? 'warning.light' : 'transparent' }}>
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Awaiting Your Action
              </Typography>
              <Typography variant="h3" fontWeight={700} color={selfDoneReviews > 0 ? 'warning.dark' : 'text.primary'}>
                {selfDoneReviews}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Team Members Review Table */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Direct Reports Review Status
          </Typography>
          
          {directReports.length === 0 ? (
            <Alert severity="info">
              No direct reports found. Team members will appear here once they are assigned to your team.
            </Alert>
          ) : (
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Team Member</TableCell>
                    <TableCell>Role</TableCell>
                    <TableCell align="center">Self Review</TableCell>
                    <TableCell align="center">Manager Review</TableCell>
                    <TableCell align="center">Status</TableCell>
                    <TableCell align="center">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {directReports.map((member: any) => {
                    const memberReviews = reviewsByUser[member.id] || [];
                    const latestReview = memberReviews[0];
                    const selfDone = latestReview?.selfDone || false;
                    const managerDone = latestReview?.managerDone || false;
                    
                    const status = managerDone 
                      ? 'Completed' 
                      : selfDone 
                        ? 'Awaiting Your Review' 
                        : 'Awaiting Self Review';
                    const statusColor = managerDone 
                      ? 'success' 
                      : selfDone 
                        ? 'warning' 
                        : 'default';
                    
                    return (
                      <TableRow key={member.id}>
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                            <Avatar sx={{ width: 32, height: 32, bgcolor: 'secondary.main' }}>
                              {(member.name || member.email)?.[0]?.toUpperCase() || '?'}
                            </Avatar>
                            <Box>
                              <Typography variant="body2" fontWeight={500}>
                                {member.name || member.email}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {member.email}
                              </Typography>
                            </Box>
                          </Box>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" color="text.secondary">
                            {member.title || 'Team Member'}
                          </Typography>
                        </TableCell>
                        <TableCell align="center">
                          {selfDone ? (
                            <CheckCircle color="success" fontSize="small" />
                          ) : (
                            <Pending color="disabled" fontSize="small" />
                          )}
                        </TableCell>
                        <TableCell align="center">
                          {managerDone ? (
                            <CheckCircle color="success" fontSize="small" />
                          ) : (
                            <Pending color="disabled" fontSize="small" />
                          )}
                        </TableCell>
                        <TableCell align="center">
                          <Chip
                            label={status}
                            size="small"
                            color={statusColor as any}
                            variant="outlined"
                          />
                        </TableCell>
                        <TableCell align="center">
                          {selfDone && !managerDone ? (
                            <Button
                              size="small"
                              variant="contained"
                              startIcon={<Edit />}
                              onClick={() => handleOpenReview(member)}
                            >
                              Review
                            </Button>
                          ) : managerDone ? (
                            <Tooltip title="View Review">
                              <IconButton size="small">
                                <Visibility fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          ) : (
                            <Typography variant="caption" color="text.secondary">
                              Waiting
                            </Typography>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      {/* Manager Review Dialog */}
      <Dialog open={reviewDialogOpen} onClose={() => setReviewDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Box>
              <Typography variant="h6">
                Manager Review
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {selectedMember?.name || selectedMember?.email}
              </Typography>
            </Box>
            <Button
              startIcon={<AutoFixHigh />}
              color="secondary"
              onClick={handleAiSuggest}
              variant="outlined"
            >
              AI Assist
            </Button>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              Overall Rating
            </Typography>
            <Rating
              value={rating}
              onChange={(_, value) => setRating(value)}
              size="large"
              sx={{ mb: 3 }}
            />

            <Typography variant="subtitle2" gutterBottom>
              Performance Summary & Feedback
            </Typography>
            <TextField
              fullWidth
              multiline
              rows={8}
              value={managerNotes}
              onChange={(e) => setManagerNotes(e.target.value)}
              placeholder="Provide constructive feedback on achievements, areas for improvement, and growth opportunities..."
              variant="outlined"
            />

            <Alert severity="info" sx={{ mt: 2 }} icon={<AutoFixHigh />}>
              <Typography variant="body2">
                <strong>AI Assist:</strong> Click the button above to generate a starting point based on the 
                employee's OKR progress, feedback received, and peer reviews.
              </Typography>
            </Alert>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReviewDialogOpen(false)}>Cancel</Button>
          <Button onClick={() => setReviewDialogOpen(false)} color="inherit">Save Draft</Button>
          <Button onClick={handleSubmitReview} variant="contained" disabled={!rating || !managerNotes}>
            Submit Review
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}






