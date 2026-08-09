'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUserContext } from '@/lib/hooks';
import api from '@/lib/api';
import {
  Box, Typography, Card, CardContent, Grid, Button, Chip, Alert,
  Paper, Tabs, Tab, Avatar, LinearProgress, CircularProgress,
  List, ListItem, ListItemText, ListItemIcon, Divider, Rating
} from '@mui/material';
import {
  Timeline, TimelineItem, TimelineSeparator, TimelineConnector,
  TimelineContent, TimelineDot, TimelineOppositeContent
} from '@mui/lab';
import {
  Person, Assessment, Feedback as FeedbackIcon, EventNote, Star,
  TrendingUp, TrendingDown, ArrowBack, Schedule, CheckCircle,
  Assignment, Chat, VideoCall, Description, WorkHistory, School,
  EmojiEvents, Flag, Psychology, Groups
} from '@mui/icons-material';

interface TeamMemberProfile {
  userId: string;
  name: string;
  email: string;
  title?: string;
  department?: string;
  avatar?: string;
  startDate?: string;
  location?: string;
}

interface PerformanceData {
  currentAppraisal?: any;
  historicalRatings: Array<{ period: string; rating: number; label: string }>;
  okrs: Array<{ title: string; progress: number; status: string }>;
  feedbackReceived: Array<{ from: string; date: string; type: string; summary: string }>;
  oneOnOnes: Array<{ date: string; status: string; summary?: string; aiScore?: number }>;
  developmentPlan?: any;
  achievements: Array<{ title: string; date: string; type: string }>;
}

export default function TeamMemberProfilePage() {
  const params = useParams();
  const router = useRouter();
  const userId = params.userId as string;
  const { isManager, isHRAdmin, user } = useUserContext();

  const [profile, setProfile] = useState<TeamMemberProfile | null>(null);
  const [performanceData, setPerformanceData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedTab, setSelectedTab] = useState(0);

  useEffect(() => {
    loadMemberData();
  }, [userId]);

  useEffect(() => {
    const requestedTab = new URLSearchParams(window.location.search).get('tab');
    const tabIndex = {
      performance: 0,
      okrs: 1,
      feedback: 2,
      'one-on-ones': 3,
      development: 4
    }[requestedTab || ''];
    if (typeof tabIndex === 'number') setSelectedTab(tabIndex);
  }, [userId]);

  const loadMemberData = async () => {
    try {
      setLoading(true);
      const [profileRes, performanceRes] = await Promise.all([
        api.get(`/user/${userId}/profile`),
        api.get(`/user/${userId}/performance-summary`)
      ]);
      const profilePayload = profileRes.data?.data ?? profileRes.data;
      const performancePayload = performanceRes.data?.data ?? performanceRes.data;
      setProfile(profilePayload || null);
      setPerformanceData({
        currentAppraisal: performancePayload?.currentAppraisal,
        historicalRatings: Array.isArray(performancePayload?.historicalRatings) ? performancePayload.historicalRatings : [],
        okrs: Array.isArray(performancePayload?.okrs) ? performancePayload.okrs : [],
        feedbackReceived: Array.isArray(performancePayload?.feedbackReceived) ? performancePayload.feedbackReceived : [],
        oneOnOnes: Array.isArray(performancePayload?.oneOnOnes) ? performancePayload.oneOnOnes : [],
        developmentPlan: performancePayload?.developmentPlan,
        achievements: Array.isArray(performancePayload?.achievements) ? performancePayload.achievements : []
      });
    } catch (error) {
      console.error('Load member data error:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!profile) {
    return (
      <Box>
        <Alert severity="error" sx={{ mb: 2 }}>Team member not found or you don't have access.</Alert>
        <Button startIcon={<ArrowBack />} onClick={() => router.push('/team')}>
          Back to Team
        </Button>
      </Box>
    );
  }

  const avgRating = performanceData?.historicalRatings.length
    ? performanceData.historicalRatings.reduce((a, b) => a + b.rating, 0) / performanceData.historicalRatings.length
    : null;

  const avgOkrProgress = performanceData?.okrs.length
    ? performanceData.okrs.reduce((a, b) => a + b.progress, 0) / performanceData.okrs.length
    : 0;

  return (
    <Box>
      {/* Back Button */}
      <Button startIcon={<ArrowBack />} onClick={() => router.push('/team')} sx={{ mb: 2 }}>
        Back to Team
      </Button>

      {/* Profile Header */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Grid container spacing={3} alignItems="center">
          <Grid size={{ xs: 12, md: 'auto' }}>
            <Avatar sx={{ width: 100, height: 100, bgcolor: 'primary.main', fontSize: 40 }}>
              {profile.name[0]}
            </Avatar>
          </Grid>
          <Grid size={{ xs: 12, md: 'grow' }}>
            <Typography variant="h4" fontWeight={700}>{profile.name}</Typography>
            <Typography variant="h6" color="text.secondary">{profile.title || 'Team Member'}</Typography>
            <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
              <Chip icon={<Groups />} label={profile.department || 'Department'} variant="outlined" size="small" />
              {profile.startDate && (
                <Chip icon={<WorkHistory />} label={`Since ${new Date(profile.startDate).toLocaleDateString()}`} variant="outlined" size="small" />
              )}
              <Chip label={profile.email} variant="outlined" size="small" />
            </Box>
          </Grid>
          <Grid size={{ xs: 12, md: 'auto' }}>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button variant="contained" startIcon={<VideoCall />} onClick={() => router.push(`/one-on-ones/new?employeeId=${userId}&name=${encodeURIComponent(profile.name)}`)}>
                Schedule 1:1
              </Button>
              <Button variant="outlined" startIcon={<FeedbackIcon />} onClick={() => router.push(`/feedback/new?recipientId=${userId}&name=${encodeURIComponent(profile.name)}`)}>
                Give Feedback
              </Button>
            </Box>
          </Grid>
        </Grid>
      </Paper>

      {/* Performance Summary Cards */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box>
                  <Typography variant="overline" color="text.secondary">Avg Rating</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="h4" fontWeight={700}>
                      {avgRating ? avgRating.toFixed(1) : 'N/A'}
                    </Typography>
                    {avgRating && <Rating value={avgRating} readOnly size="small" precision={0.1} />}
                  </Box>
                </Box>
                <Star sx={{ fontSize: 40, color: 'warning.main', opacity: 0.7 }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box>
                  <Typography variant="overline" color="text.secondary">OKR Progress</Typography>
                  <Typography variant="h4" fontWeight={700}>{Math.round(avgOkrProgress)}%</Typography>
                </Box>
                <Assessment sx={{ fontSize: 40, color: 'primary.main', opacity: 0.7 }} />
              </Box>
              <LinearProgress variant="determinate" value={avgOkrProgress} sx={{ mt: 1 }} />
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box>
                  <Typography variant="overline" color="text.secondary">Feedback Received</Typography>
                  <Typography variant="h4" fontWeight={700}>
                    {performanceData?.feedbackReceived?.length || 0}
                  </Typography>
                </Box>
                <FeedbackIcon sx={{ fontSize: 40, color: 'info.main', opacity: 0.7 }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box>
                  <Typography variant="overline" color="text.secondary">1:1 Meetings</Typography>
                  <Typography variant="h4" fontWeight={700}>
                    {performanceData?.oneOnOnes?.length || 0}
                  </Typography>
                </Box>
                <EventNote sx={{ fontSize: 40, color: 'success.main', opacity: 0.7 }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Tabs */}
      <Tabs value={selectedTab} onChange={(_, v) => setSelectedTab(v)} sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}>
        <Tab label="Performance History" />
        <Tab label="OKRs" />
        <Tab label="Feedback" />
        <Tab label="1:1 Meetings" />
        <Tab label="Development" />
      </Tabs>

      {/* Performance History Tab */}
      {selectedTab === 0 && (
        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Card>
              <CardContent>
                <Typography variant="h6" fontWeight={600} gutterBottom>
                  Rating Trend
                </Typography>
                {performanceData?.historicalRatings && performanceData.historicalRatings.length > 0 ? (
                  <List>
                    {performanceData.historicalRatings.map((rating, index) => (
                      <ListItem key={index}>
                        <ListItemIcon>
                          {index === 0 ? (
                            performanceData.historicalRatings.length > 1 && rating.rating > performanceData.historicalRatings[1].rating
                              ? <TrendingUp color="success" />
                              : performanceData.historicalRatings.length > 1 && rating.rating < performanceData.historicalRatings[1].rating
                                ? <TrendingDown color="error" />
                                : <Star color="warning" />
                          ) : (
                            <Star color="disabled" />
                          )}
                        </ListItemIcon>
                        <ListItemText
                          primary={rating.period}
                          slotProps={{ secondary: { component: 'div' } }}
                          secondary={
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Rating value={rating.rating} readOnly size="small" />
                              <Chip label={rating.label} size="small" />
                            </Box>
                          }
                        />
                      </ListItem>
                    ))}
                  </List>
                ) : (
                  <Alert severity="info">No historical ratings available yet.</Alert>
                )}
              </CardContent>
            </Card>
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <Card>
              <CardContent>
                <Typography variant="h6" fontWeight={600} gutterBottom>
                  Current Appraisal
                </Typography>
                {performanceData?.currentAppraisal ? (
                  <Box>
                    <Chip
                      label={performanceData.currentAppraisal.status}
                      color={performanceData.currentAppraisal.status === 'completed' ? 'success' : 'info'}
                      sx={{ mb: 2 }}
                    />
                    <Typography variant="body2" gutterBottom>
                      Cycle: {performanceData.currentAppraisal.cycleName}
                    </Typography>
                    {performanceData.currentAppraisal.selfAssessment?.submittedAt && (
                      <Typography variant="body2" color="text.secondary">
                        Self-Assessment: Submitted on {new Date(performanceData.currentAppraisal.selfAssessment.submittedAt).toLocaleDateString()}
                      </Typography>
                    )}
                    <Button
                      variant="outlined"
                      size="small"
                      sx={{ mt: 2 }}
                      onClick={() => router.push(`/appraisals/${performanceData.currentAppraisal._id}/manager-review`)}
                    >
                      View Appraisal
                    </Button>
                  </Box>
                ) : (
                  <Alert severity="info">No active appraisal for this employee.</Alert>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* OKRs Tab */}
      {selectedTab === 1 && (
        <Card>
          <CardContent>
            <Typography variant="h6" fontWeight={600} gutterBottom>
              Current OKRs
            </Typography>
            {performanceData?.okrs && performanceData.okrs.length > 0 ? (
              <List>
                {performanceData.okrs.map((okr, index) => (
                  <Box key={index}>
                    <ListItem>
                      <ListItemIcon>
                        <Flag color={okr.status === 'completed' ? 'success' : 'primary'} />
                      </ListItemIcon>
                      <ListItemText
                        primary={okr.title}
                        slotProps={{ secondary: { component: 'div' } }}
                        secondary={
                          <Box sx={{ mt: 1 }}>
                            <LinearProgress
                              variant="determinate"
                              value={okr.progress}
                              color={okr.progress >= 70 ? 'success' : okr.progress >= 40 ? 'warning' : 'error'}
                              sx={{ height: 8, borderRadius: 4 }}
                            />
                            <Typography variant="caption">{okr.progress}% complete</Typography>
                          </Box>
                        }
                      />
                      <Chip label={okr.status} size="small" color={okr.status === 'completed' ? 'success' : 'default'} />
                    </ListItem>
                    {index < performanceData.okrs.length - 1 && <Divider />}
                  </Box>
                ))}
              </List>
            ) : (
              <Alert severity="info">No OKRs found for this employee.</Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* Feedback Tab */}
      {selectedTab === 2 && (
        <Card>
          <CardContent>
            <Typography variant="h6" fontWeight={600} gutterBottom>
              Feedback Received
            </Typography>
            {performanceData?.feedbackReceived && performanceData.feedbackReceived.length > 0 ? (
              <List>
                {performanceData.feedbackReceived.map((feedback, index) => (
                  <Box key={index}>
                    <ListItem>
                      <ListItemIcon>
                        <FeedbackIcon color={feedback.type === 'praise' ? 'success' : feedback.type === 'constructive' ? 'warning' : 'info'} />
                      </ListItemIcon>
                      <ListItemText
                        slotProps={{ primary: { component: 'div' }, secondary: { component: 'div' } }}
                        primary={
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="subtitle2">{feedback.from}</Typography>
                            <Chip label={feedback.type} size="small" />
                          </Box>
                        }
                        secondary={
                          <>
                            <Typography variant="caption" color="text.secondary" display="block">
                              {new Date(feedback.date).toLocaleDateString()}
                            </Typography>
                            <Typography variant="body2">{feedback.summary}</Typography>
                          </>
                        }
                      />
                    </ListItem>
                    {index < performanceData.feedbackReceived.length - 1 && <Divider />}
                  </Box>
                ))}
              </List>
            ) : (
              <Alert severity="info">No feedback received yet.</Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* 1:1 Meetings Tab */}
      {selectedTab === 3 && (
        <Card>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6" fontWeight={600}>
                1:1 Meeting History
              </Typography>
              <Button
                variant="contained"
                startIcon={<VideoCall />}
                size="small"
                onClick={() => router.push(`/one-on-ones/new?employeeId=${userId}&name=${encodeURIComponent(profile.name)}`)}
              >
                Schedule New
              </Button>
            </Box>
            {performanceData?.oneOnOnes && performanceData.oneOnOnes.length > 0 ? (
              <List>
                {performanceData.oneOnOnes.map((meeting, index) => (
                  <Box key={index}>
                    <ListItem>
                      <ListItemIcon>
                        <EventNote color={meeting.status === 'completed' ? 'success' : 'info'} />
                      </ListItemIcon>
                      <ListItemText
                        primary={
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="subtitle2">
                              {new Date(meeting.date).toLocaleDateString()}
                            </Typography>
                            <Chip label={meeting.status} size="small" color={meeting.status === 'completed' ? 'success' : 'default'} />
                            {meeting.aiScore && (
                              <Chip
                                icon={<Psychology />}
                                label={`AI Score: ${meeting.aiScore}`}
                                size="small"
                                color="primary"
                                variant="outlined"
                              />
                            )}
                          </Box>
                        }
                        secondary={meeting.summary}
                      />
                    </ListItem>
                    {index < performanceData.oneOnOnes.length - 1 && <Divider />}
                  </Box>
                ))}
              </List>
            ) : (
              <Alert severity="info">No 1:1 meetings recorded yet.</Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* Development Tab */}
      {selectedTab === 4 && (
        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Card>
              <CardContent>
                <Typography variant="h6" fontWeight={600} gutterBottom>
                  Development Plan
                </Typography>
                {performanceData?.developmentPlan ? (
                  <Box>
                    <Typography variant="body2" gutterBottom>
                      {performanceData.developmentPlan.summary}
                    </Typography>
                    {performanceData.developmentPlan._id && (
                      <Button
                        variant="outlined"
                        size="small"
                        sx={{ mt: 2 }}
                        onClick={() => router.push(`/development?plan=${encodeURIComponent(performanceData.developmentPlan._id)}`)}
                      >
                        View Full Plan
                      </Button>
                    )}
                  </Box>
                ) : (
                  <Alert severity="info">No development plan created yet.</Alert>
                )}
              </CardContent>
            </Card>
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <Card>
              <CardContent>
                <Typography variant="h6" fontWeight={600} gutterBottom>
                  <EmojiEvents sx={{ mr: 1, verticalAlign: 'middle', color: 'warning.main' }} />
                  Achievements & Recognition
                </Typography>
                {performanceData?.achievements && performanceData.achievements.length > 0 ? (
                  <List>
                    {performanceData.achievements.map((achievement, index) => (
                      <ListItem key={index}>
                        <ListItemIcon>
                          <EmojiEvents color="warning" />
                        </ListItemIcon>
                        <ListItemText
                          primary={achievement.title}
                          secondary={`${achievement.type} • ${new Date(achievement.date).toLocaleDateString()}`}
                        />
                      </ListItem>
                    ))}
                  </List>
                ) : (
                  <Alert severity="info">No achievements recorded yet.</Alert>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}
    </Box>
  );
}
