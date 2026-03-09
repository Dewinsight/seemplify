'use client';

export const dynamic = 'force-dynamic';

import { useDirectReports, useDirectReportsFeedback, useUserContext } from '@/lib/hooks';
import {
  Box, Typography, Card, CardContent, LinearProgress, Alert,
  Avatar, Chip, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Grid, Skeleton, Accordion,
  AccordionSummary, AccordionDetails
} from '@mui/material';
import { ExpandMore, SentimentSatisfied, SentimentDissatisfied, TrendingUp } from '@mui/icons-material';

export default function TeamFeedbackPage() {
  const { isManager } = useUserContext();
  const { directReports, totalDirectReports, isLoading: reportsLoading } = useDirectReports();
  const { feedbackByUser, isLoading: feedbackLoading } = useDirectReportsFeedback();

  const isLoading = reportsLoading || feedbackLoading;

  if (isLoading) {
    return (
      <Box>
        <Skeleton variant="text" width={200} height={40} />
        <Skeleton variant="text" width={300} height={24} sx={{ mb: 3 }} />
        <Grid container spacing={3} sx={{ mb: 4 }}>
          {[1, 2, 3].map(i => (
            <Grid key={i} size={{ xs: 12, sm: 4 }}>
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
          Team Feedback
        </Typography>
        <Alert severity="info" sx={{ mt: 2 }}>
          This page is for team managers to view feedback received by their direct reports.
        </Alert>
      </Box>
    );
  }

  // Calculate statistics
  const allFeedback = Object.values(feedbackByUser).flatMap((u: any) => u.feedback || []);
  const positiveFeedback = allFeedback.filter((f: any) => f.type === 'Positive').length;
  const constructiveFeedback = allFeedback.filter((f: any) => f.type === 'Constructive').length;
  const avgSentiment = allFeedback.length > 0
    ? Math.round(allFeedback.reduce((sum: number, f: any) => sum + (f.sentimentScore || 50), 0) / allFeedback.length)
    : 0;

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" fontWeight={700} gutterBottom>
          Team Feedback
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Monitor feedback received by your direct reports
        </Typography>
      </Box>

      {/* Summary Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <SentimentSatisfied color="success" sx={{ fontSize: 32 }} />
                <Box>
                  <Typography variant="h4" fontWeight={700} color="success.main">
                    {positiveFeedback}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Positive Feedback
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <TrendingUp color="warning" sx={{ fontSize: 32 }} />
                <Box>
                  <Typography variant="h4" fontWeight={700} color="warning.main">
                    {constructiveFeedback}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Constructive Feedback
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <Card>
            <CardContent>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Team Sentiment Score
              </Typography>
              <Typography variant="h4" fontWeight={700} color={avgSentiment >= 60 ? 'success.main' : avgSentiment >= 40 ? 'warning.main' : 'error.main'}>
                {avgSentiment}%
              </Typography>
              <LinearProgress 
                variant="determinate" 
                value={avgSentiment} 
                color={avgSentiment >= 60 ? 'success' : avgSentiment >= 40 ? 'warning' : 'error'}
                sx={{ mt: 1 }}
              />
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Feedback by Team Member */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Feedback by Team Member
          </Typography>
          
          {directReports.length === 0 ? (
            <Alert severity="info">
              No direct reports found.
            </Alert>
          ) : Object.keys(feedbackByUser).length === 0 ? (
            <Alert severity="info">
              No feedback data available for your team yet.
            </Alert>
          ) : (
            <Box>
              {directReports.map((member: any, index: number) => {
                const memberId = member.userId || member.id || member.email || `member-${index}`;
                const memberData = feedbackByUser[memberId];
                const memberFeedback = memberData?.feedback || [];
                
                return (
                  <Accordion key={memberId} sx={{ mb: 1 }}>
                    <AccordionSummary expandIcon={<ExpandMore />}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
                        <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main' }}>
                          {(member.name || member.email)?.[0]?.toUpperCase() || '?'}
                        </Avatar>
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="body1" fontWeight={500}>
                            {member.name || member.email}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {member.title || 'Team Member'}
                          </Typography>
                        </Box>
                        <Chip 
                          label={`${memberFeedback.length} feedback`} 
                          size="small" 
                          color={memberFeedback.length > 0 ? 'primary' : 'default'}
                        />
                      </Box>
                    </AccordionSummary>
                    <AccordionDetails>
                      {memberFeedback.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                          No feedback received yet.
                        </Typography>
                      ) : (
                        <TableContainer>
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell>From</TableCell>
                                <TableCell>Type</TableCell>
                                <TableCell>Message</TableCell>
                                <TableCell>Date</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {memberFeedback.slice(0, 5).map((fb: any, index: number) => (
                                <TableRow key={index}>
                                  <TableCell>{fb.sender || 'Anonymous'}</TableCell>
                                  <TableCell>
                                    <Chip 
                                      label={fb.type} 
                                      size="small" 
                                      color={fb.type === 'Positive' ? 'success' : 'warning'}
                                      variant="outlined"
                                    />
                                  </TableCell>
                                  <TableCell sx={{ maxWidth: 300 }}>
                                    <Typography variant="body2" noWrap>
                                      {fb.message}
                                    </Typography>
                                  </TableCell>
                                  <TableCell>
                                    {fb.date ? new Date(fb.date).toLocaleDateString() : '-'}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      )}
                    </AccordionDetails>
                  </Accordion>
                );
              })}
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}






