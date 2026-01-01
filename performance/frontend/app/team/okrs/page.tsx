'use client';

export const dynamic = 'force-dynamic';

import { useDirectReports, useDirectReportsOkrs, useUserContext } from '@/lib/hooks';
import {
  Box, Typography, Card, CardContent, LinearProgress, Alert,
  Avatar, Chip, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, IconButton, Tooltip, Grid, Skeleton
} from '@mui/material';
import { Visibility, TrendingUp, TrendingDown, Flag, Warning } from '@mui/icons-material';
import Link from 'next/link';

export default function TeamOKRsPage() {
  const { isManager, role } = useUserContext();
  const { managedTeams, directReports, totalDirectReports, isLoading: reportsLoading } = useDirectReports();
  const { okrsByUser, isLoading: okrsLoading } = useDirectReportsOkrs();

  const isLoading = reportsLoading || okrsLoading;

  if (isLoading) {
    return (
      <Box>
        <Skeleton variant="text" width={200} height={40} />
        <Skeleton variant="text" width={300} height={24} sx={{ mb: 3 }} />
        <Grid container spacing={3} sx={{ mb: 4 }}>
          {[1, 2, 3, 4].map(i => (
            <Grid key={i} size={{ xs: 12, sm: 6, md: 3 }}>
              <Skeleton variant="rectangular" height={120} sx={{ borderRadius: 2 }} />
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
          Team OKRs
        </Typography>
        <Alert severity="info" sx={{ mt: 2 }}>
          This page is for team managers to view their team's OKRs. 
          You don't have any direct reports assigned to you.
        </Alert>
      </Box>
    );
  }

  // Calculate team statistics from real data
  const allOkrs = Object.values(okrsByUser).flat() as any[];
  const totalOkrs = allOkrs.length;
  const avgProgress = totalOkrs > 0 
    ? Math.round(allOkrs.reduce((sum, okr) => sum + (okr.progress || 0), 0) / totalOkrs)
    : 0;
  const onTrack = allOkrs.filter(okr => (okr.progress || 0) >= 70).length;
  const atRisk = allOkrs.filter(okr => (okr.progress || 0) >= 40 && (okr.progress || 0) < 70).length;
  const behind = allOkrs.filter(okr => (okr.progress || 0) < 40).length;

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" fontWeight={700} gutterBottom>
          Team OKRs
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Monitor your direct reports' objectives and key results progress
        </Typography>
      </Box>

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
              <Typography variant="caption" color="text.secondary">
                {totalOkrs} total OKRs
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card sx={{ bgcolor: avgProgress >= 60 ? 'success.light' : avgProgress >= 40 ? 'warning.light' : 'error.light' }}>
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Avg. Progress
              </Typography>
              <Typography variant="h3" fontWeight={700} color={avgProgress >= 60 ? 'success.dark' : avgProgress >= 40 ? 'warning.dark' : 'error.dark'}>
                {avgProgress}%
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card>
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                On Track
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <TrendingUp color="success" />
                <Typography variant="h3" fontWeight={700} color="success.main">
                  {onTrack}
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card>
            <CardContent>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                Needs Attention
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Warning color="warning" />
                <Typography variant="h3" fontWeight={700} color="warning.main">
                  {atRisk + behind}
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Managed Teams */}
      {managedTeams.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Managing {managedTeams.length} team{managedTeams.length > 1 ? 's' : ''}:
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {managedTeams.map((team) => (
              <Chip
                key={team.id}
                label={`${team.name} (${team.directReportCount} members)`}
                color="primary"
                variant="outlined"
              />
            ))}
          </Box>
        </Box>
      )}

      {/* Team Members OKR Table */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Direct Reports OKR Status
          </Typography>
          
          {directReports.length === 0 ? (
            <Alert severity="info">
              No direct reports found. Team members will appear here once they are assigned to your team in the Identity Provider.
            </Alert>
          ) : (
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Team Member</TableCell>
                    <TableCell>Role</TableCell>
                    <TableCell align="center">OKRs</TableCell>
                    <TableCell align="center">Avg Progress</TableCell>
                    <TableCell align="center">Status</TableCell>
                    <TableCell align="center">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {directReports.map((member: any) => {
                    const memberOkrs = okrsByUser[member.id] || [];
                    const memberProgress = memberOkrs.length > 0
                      ? Math.round(memberOkrs.reduce((sum: number, okr: any) => sum + (okr.progress || 0), 0) / memberOkrs.length)
                      : 0;
                    const status = memberProgress >= 70 ? 'On Track' : memberProgress >= 40 ? 'At Risk' : 'Behind';
                    const statusColor = memberProgress >= 70 ? 'success' : memberProgress >= 40 ? 'warning' : 'error';
                    
                    return (
                      <TableRow key={member.id}>
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                            <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main' }}>
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
                          <Chip 
                            label={memberOkrs.length} 
                            size="small" 
                            color={memberOkrs.length > 0 ? 'primary' : 'default'}
                          />
                        </TableCell>
                        <TableCell align="center" sx={{ minWidth: 150 }}>
                          {memberOkrs.length > 0 ? (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <LinearProgress
                                variant="determinate"
                                value={memberProgress}
                                sx={{ flex: 1, height: 8, borderRadius: 4 }}
                                color={statusColor as any}
                              />
                              <Typography variant="caption" fontWeight={600}>
                                {memberProgress}%
                              </Typography>
                            </Box>
                          ) : (
                            <Typography variant="caption" color="text.secondary">
                              No OKRs
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell align="center">
                          {memberOkrs.length > 0 ? (
                            <Chip
                              label={status}
                              size="small"
                              color={statusColor as any}
                              variant="outlined"
                            />
                          ) : (
                            <Chip label="No Data" size="small" variant="outlined" />
                          )}
                        </TableCell>
                        <TableCell align="center">
                          <Tooltip title="View Details">
                            <IconButton 
                              size="small" 
                              component={Link} 
                              href={`/team/okrs/${member.id}`}
                              disabled={memberOkrs.length === 0}
                            >
                              <Visibility fontSize="small" />
                            </IconButton>
                          </Tooltip>
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
    </Box>
  );
}






