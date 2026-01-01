'use client';

import { useState } from 'react';
import { useCalibrationSessions, useReviewCycles, useUserContext } from '@/lib/hooks';
import api from '@/lib/api';
import {
  Typography, Box, CircularProgress, Button, Card, CardContent, Chip,
  Grid, Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  Table, TableHead, TableRow, TableCell, TableBody, Alert, Tabs, Tab,
  LinearProgress, Slider, IconButton, Tooltip
} from '@mui/material';
import {
  Add, PlayArrow, CheckCircle, Edit, Insights, Assessment,
  Balance, TrendingUp, TrendingDown
} from '@mui/icons-material';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

export default function CalibrationPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const { isHRAdmin, isLoading: userLoading } = useUserContext();
  const { cycles } = useReviewCycles();
  const { sessions, isLoading, mutate } = useCalibrationSessions();
  
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState<any>(null);
  const [newSession, setNewSession] = useState({
    reviewCycleId: '',
    title: '',
    scheduledDate: ''
  });

  if (status === 'loading' || userLoading || isLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="50vh">
        <CircularProgress />
      </Box>
    );
  }

  if (!isHRAdmin) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="50vh">
        <Alert severity="error">
          Access denied. Only HR Administrators can access calibration.
        </Alert>
      </Box>
    );
  }

  const handleCreateSession = async () => {
    try {
      const cycle = cycles?.find((c: any) => c._id === newSession.reviewCycleId);
      await api.post('/calibration', {
        ...newSession,
        title: newSession.title || `Calibration - ${cycle?.title || 'Review Cycle'}`
      });
      setDialogOpen(false);
      setNewSession({ reviewCycleId: '', title: '', scheduledDate: '' });
      mutate();
    } catch (error) {
      console.error('Error creating session:', error);
    }
  };

  const handleStartSession = async (sessionId: string) => {
    try {
      await api.post(`/calibration/${sessionId}/start`, {});
      mutate();
    } catch (error) {
      console.error('Error starting session:', error);
    }
  };

  const handleCompleteSession = async (sessionId: string) => {
    try {
      await api.post(`/calibration/${sessionId}/complete`, {});
      mutate();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Error completing session');
    }
  };

  const handleGenerateInsights = async (sessionId: string) => {
    try {
      await api.post(`/calibration/${sessionId}/ai-insights`, {});
      mutate();
    } catch (error) {
      console.error('Error generating insights:', error);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'success';
      case 'in_progress': return 'warning';
      case 'scheduled': return 'info';
      case 'cancelled': return 'error';
      default: return 'default';
    }
  };

  const activeSessions = sessions?.filter((s: any) => s.status !== 'completed') || [];
  const completedSessions = sessions?.filter((s: any) => s.status === 'completed') || [];

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4" fontWeight="bold">
          Rating Calibration
        </Typography>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => setDialogOpen(true)}
        >
          New Session
        </Button>
      </Box>

      {/* Summary Cards */}
      <Grid container spacing={3} mb={4}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" gap={2}>
                <Balance color="primary" sx={{ fontSize: 40 }} />
                <Box>
                  <Typography variant="h4" fontWeight="bold">{sessions?.length || 0}</Typography>
                  <Typography variant="body2" color="text.secondary">Total Sessions</Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" gap={2}>
                <PlayArrow color="warning" sx={{ fontSize: 40 }} />
                <Box>
                  <Typography variant="h4" fontWeight="bold">
                    {sessions?.filter((s: any) => s.status === 'in_progress').length || 0}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">In Progress</Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" gap={2}>
                <CheckCircle color="success" sx={{ fontSize: 40 }} />
                <Box>
                  <Typography variant="h4" fontWeight="bold">
                    {completedSessions.length}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">Completed</Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" gap={2}>
                <Assessment color="info" sx={{ fontSize: 40 }} />
                <Box>
                  <Typography variant="h4" fontWeight="bold">
                    {sessions?.reduce((sum: number, s: any) => sum + (s.reviewsUnderCalibration?.length || 0), 0) || 0}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">Reviews Calibrated</Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Active Sessions */}
      {activeSessions.length > 0 && (
        <>
          <Typography variant="h6" fontWeight="bold" mb={2}>Active Sessions</Typography>
          <Grid container spacing={3} mb={4}>
            {activeSessions.map((session: any) => (
              <Grid size={{ xs: 12, md: 6 }} key={session._id}>
                <Card>
                  <CardContent>
                    <Box display="flex" justifyContent="space-between" alignItems="start" mb={2}>
                      <Box>
                        <Typography variant="h6">{session.title}</Typography>
                        <Chip 
                          size="small" 
                          label={session.status}
                          color={getStatusColor(session.status) as any}
                          sx={{ mt: 0.5 }}
                        />
                      </Box>
                      <Typography variant="caption" color="text.secondary">
                        {session.reviewsUnderCalibration?.length || 0} reviews
                      </Typography>
                    </Box>

                    {session.status === 'in_progress' && (
                      <Box mb={2}>
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                          Progress
                        </Typography>
                        <LinearProgress 
                          variant="determinate" 
                          value={
                            session.reviewsUnderCalibration?.length > 0 
                              ? (session.reviewsUnderCalibration.filter((r: any) => r.decision !== 'pending_review').length / session.reviewsUnderCalibration.length) * 100
                              : 0
                          }
                          sx={{ height: 8, borderRadius: 1 }}
                        />
                        <Typography variant="caption">
                          {session.reviewsUnderCalibration?.filter((r: any) => r.decision !== 'pending_review').length || 0} of {session.reviewsUnderCalibration?.length || 0} reviewed
                        </Typography>
                      </Box>
                    )}

                    {/* Distribution Preview */}
                    {session.actualDistribution && (
                      <Box mb={2}>
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                          Rating Distribution
                        </Typography>
                        <Box display="flex" gap={1}>
                          <Tooltip title={`Exceeds: ${session.actualDistribution.exceeds}%`}>
                            <Box sx={{ width: `${session.actualDistribution.exceeds}%`, minWidth: 20, height: 20, bgcolor: 'success.main', borderRadius: 1 }} />
                          </Tooltip>
                          <Tooltip title={`Meets+: ${session.actualDistribution.meets_plus}%`}>
                            <Box sx={{ width: `${session.actualDistribution.meets_plus}%`, minWidth: 20, height: 20, bgcolor: 'info.main', borderRadius: 1 }} />
                          </Tooltip>
                          <Tooltip title={`Meets: ${session.actualDistribution.meets}%`}>
                            <Box sx={{ width: `${session.actualDistribution.meets}%`, minWidth: 20, height: 20, bgcolor: 'primary.main', borderRadius: 1 }} />
                          </Tooltip>
                          <Tooltip title={`Developing: ${session.actualDistribution.developing}%`}>
                            <Box sx={{ width: `${session.actualDistribution.developing}%`, minWidth: 20, height: 20, bgcolor: 'warning.main', borderRadius: 1 }} />
                          </Tooltip>
                          <Tooltip title={`Needs Improvement: ${session.actualDistribution.needs_improvement}%`}>
                            <Box sx={{ width: `${session.actualDistribution.needs_improvement}%`, minWidth: 20, height: 20, bgcolor: 'error.main', borderRadius: 1 }} />
                          </Tooltip>
                        </Box>
                      </Box>
                    )}

                    <Box display="flex" gap={1} flexWrap="wrap">
                      {session.status === 'scheduled' && (
                        <Button
                          size="small"
                          variant="contained"
                          startIcon={<PlayArrow />}
                          onClick={() => handleStartSession(session._id)}
                        >
                          Start
                        </Button>
                      )}
                      {session.status === 'in_progress' && (
                        <>
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => setSelectedSession(session)}
                          >
                            Continue
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<Insights />}
                            onClick={() => handleGenerateInsights(session._id)}
                          >
                            AI Insights
                          </Button>
                          <Button
                            size="small"
                            variant="contained"
                            color="success"
                            startIcon={<CheckCircle />}
                            onClick={() => handleCompleteSession(session._id)}
                          >
                            Complete
                          </Button>
                        </>
                      )}
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </>
      )}

      {/* Completed Sessions */}
      {completedSessions.length > 0 && (
        <>
          <Typography variant="h6" fontWeight="bold" mb={2}>Completed Sessions</Typography>
          <Card>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Session</TableCell>
                  <TableCell align="center">Reviews</TableCell>
                  <TableCell align="center">Adjusted</TableCell>
                  <TableCell align="center">Avg Original</TableCell>
                  <TableCell align="center">Avg Calibrated</TableCell>
                  <TableCell align="center">Completed</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {completedSessions.map((session: any) => (
                  <TableRow key={session._id}>
                    <TableCell>
                      <Typography variant="subtitle2">{session.title}</Typography>
                    </TableCell>
                    <TableCell align="center">{session.summary?.totalReviews || 0}</TableCell>
                    <TableCell align="center">
                      <Chip 
                        size="small" 
                        label={session.summary?.reviewsAdjusted || 0}
                        color={session.summary?.reviewsAdjusted > 0 ? 'warning' : 'default'}
                      />
                    </TableCell>
                    <TableCell align="center">
                      {session.summary?.averageOriginalRating?.toFixed(1) || '-'}
                    </TableCell>
                    <TableCell align="center">
                      <Box display="flex" alignItems="center" justifyContent="center" gap={0.5}>
                        {session.summary?.averageCalibratedRating?.toFixed(1) || '-'}
                        {session.summary?.averageCalibratedRating > session.summary?.averageOriginalRating ? (
                          <TrendingUp fontSize="small" color="success" />
                        ) : session.summary?.averageCalibratedRating < session.summary?.averageOriginalRating ? (
                          <TrendingDown fontSize="small" color="error" />
                        ) : null}
                      </Box>
                    </TableCell>
                    <TableCell align="center">
                      {session.completedAt ? new Date(session.completedAt).toLocaleDateString() : '-'}
                    </TableCell>
                    <TableCell>
                      <Button size="small" onClick={() => setSelectedSession(session)}>
                        View Report
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}

      {sessions?.length === 0 && (
        <Alert severity="info">
          No calibration sessions yet. Create one from an active review cycle to start calibrating ratings.
        </Alert>
      )}

      {/* Create Session Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create Calibration Session</DialogTitle>
        <DialogContent>
          <Box display="flex" flexDirection="column" gap={2} mt={1}>
            <TextField
              select
              label="Review Cycle"
              value={newSession.reviewCycleId}
              onChange={(e) => setNewSession({ ...newSession, reviewCycleId: e.target.value })}
              fullWidth
              SelectProps={{ native: true }}
            >
              <option value="">Select review cycle</option>
              {cycles?.filter((c: any) => c.status !== 'closed').map((cycle: any) => (
                <option key={cycle._id} value={cycle._id}>
                  {cycle.title} ({cycle.status})
                </option>
              ))}
            </TextField>
            <TextField
              label="Session Title (optional)"
              value={newSession.title}
              onChange={(e) => setNewSession({ ...newSession, title: e.target.value })}
              fullWidth
              placeholder="Leave blank to auto-generate"
            />
            <TextField
              type="datetime-local"
              label="Scheduled Date"
              value={newSession.scheduledDate}
              onChange={(e) => setNewSession({ ...newSession, scheduledDate: e.target.value })}
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button 
            onClick={handleCreateSession} 
            variant="contained"
            disabled={!newSession.reviewCycleId}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* Session Details Dialog */}
      <Dialog 
        open={!!selectedSession} 
        onClose={() => setSelectedSession(null)} 
        maxWidth="lg" 
        fullWidth
      >
        {selectedSession && (
          <>
            <DialogTitle>
              <Box display="flex" justifyContent="space-between" alignItems="center">
                <Typography variant="h6">{selectedSession.title}</Typography>
                <Chip 
                  label={selectedSession.status}
                  color={getStatusColor(selectedSession.status) as any}
                />
              </Box>
            </DialogTitle>
            <DialogContent>
              {/* Summary */}
              {selectedSession.summary && (
                <Box mb={3}>
                  <Typography variant="subtitle2" gutterBottom>Summary</Typography>
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 6, md: 3 }}>
                      <Card variant="outlined">
                        <CardContent sx={{ textAlign: 'center', py: 1 }}>
                          <Typography variant="h5">{selectedSession.summary.totalReviews}</Typography>
                          <Typography variant="caption">Total Reviews</Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                    <Grid size={{ xs: 6, md: 3 }}>
                      <Card variant="outlined">
                        <CardContent sx={{ textAlign: 'center', py: 1 }}>
                          <Typography variant="h5">{selectedSession.summary.reviewsAdjusted}</Typography>
                          <Typography variant="caption">Adjusted</Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                    <Grid size={{ xs: 6, md: 3 }}>
                      <Card variant="outlined">
                        <CardContent sx={{ textAlign: 'center', py: 1 }}>
                          <Typography variant="h5">{selectedSession.summary.averageOriginalRating?.toFixed(1) || '-'}</Typography>
                          <Typography variant="caption">Avg Original</Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                    <Grid size={{ xs: 6, md: 3 }}>
                      <Card variant="outlined">
                        <CardContent sx={{ textAlign: 'center', py: 1 }}>
                          <Typography variant="h5">{selectedSession.summary.averageCalibratedRating?.toFixed(1) || '-'}</Typography>
                          <Typography variant="caption">Avg Calibrated</Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                  </Grid>
                </Box>
              )}

              {/* AI Insights */}
              {selectedSession.aiInsights && (
                <Box mb={3}>
                  <Typography variant="subtitle2" gutterBottom>AI Insights</Typography>
                  <Alert severity="info" sx={{ mb: 2 }}>
                    {selectedSession.aiInsights.ratingDistributionAnalysis}
                  </Alert>
                  {selectedSession.aiInsights.potentialBiasFlags?.length > 0 && (
                    <Alert severity="warning">
                      <Typography variant="subtitle2">Potential Bias Detected:</Typography>
                      {selectedSession.aiInsights.potentialBiasFlags.map((flag: any, idx: number) => (
                        <Typography key={idx} variant="body2">• {flag.type}: {flag.description}</Typography>
                      ))}
                    </Alert>
                  )}
                </Box>
              )}

              {/* Reviews Table */}
              <Typography variant="subtitle2" gutterBottom>Reviews Under Calibration</Typography>
              <Box sx={{ maxHeight: 400, overflow: 'auto' }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Employee</TableCell>
                      <TableCell align="center">Self Rating</TableCell>
                      <TableCell align="center">Manager Rating</TableCell>
                      <TableCell align="center">Calibrated</TableCell>
                      <TableCell>Bucket</TableCell>
                      <TableCell>Decision</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {selectedSession.reviewsUnderCalibration?.map((review: any, idx: number) => (
                      <TableRow key={idx}>
                        <TableCell>{review.employeeName || review.employeeId}</TableCell>
                        <TableCell align="center">{review.originalSelfRating || '-'}</TableCell>
                        <TableCell align="center">{review.originalManagerRating || '-'}</TableCell>
                        <TableCell align="center">
                          <Typography fontWeight={review.calibratedRating !== review.originalManagerRating ? 'bold' : 'normal'}>
                            {review.calibratedRating || '-'}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          {review.performanceBucket && (
                            <Chip 
                              size="small" 
                              label={review.performanceBucket.replace('_', ' ')}
                              color={
                                review.performanceBucket === 'exceeds' ? 'success' :
                                review.performanceBucket === 'needs_improvement' ? 'error' :
                                'default'
                              }
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          <Chip 
                            size="small" 
                            label={review.decision}
                            color={
                              review.decision === 'approved' ? 'success' :
                              review.decision === 'adjusted' ? 'warning' :
                              'default'
                            }
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setSelectedSession(null)}>Close</Button>
              {selectedSession.status === 'completed' && (
                <Button 
                  variant="outlined"
                  onClick={async () => {
                    const res = await api.get(`/calibration/${selectedSession._id}/export`);
                    console.log('Export data:', res.data);
                    // Could trigger download here
                  }}
                >
                  Export Report
                </Button>
              )}
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
}






