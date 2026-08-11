'use client';

export const dynamic = 'force-dynamic';

import { useMemo, useState } from 'react';
import { usePerformanceAnalytics, useUserContext } from '@/lib/hooks';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Typography
} from '@mui/material';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Refresh, TrendingUp } from '@mui/icons-material';

type AnalyticsFilters = { cycleId: string; teamId: string; department: string };
type IdName = { id: string; name: string };
type RatingDistribution = { rating: number; count: number };
type CycleTrend = { cycleName: string; averageRating: number | null; completionRate: number };
type Performer = { rank: number; appraisalId: string; employeeName: string; jobTitle?: string; department?: string; teamId?: string; teamName: string; cycleName: string; goalAchievement: number | null; finalRating: number; ratingLabel?: string };
type GroupInsight = { id: string; name: string; participants: number; completionRate: number; averageRating: number | null; averageGoalAchievement?: number | null };
type SectionInsight = { sectionId: string; title: string; type: string; responseRate: number; averageManagerScore: number | null };

function metricValue(value: number | null | undefined, suffix = '') {
  return value === null || value === undefined ? 'Not available' : `${value}${suffix}`;
}

export default function AnalyticsPage() {
  const { isManager, isHRAdmin, isLoading: contextLoading } = useUserContext();
  const [filters, setFilters] = useState<AnalyticsFilters>({ cycleId: '', teamId: '', department: '' });
  const [tab, setTab] = useState(0);
  const { analytics, isLoading, isError, mutate } = usePerformanceAnalytics(filters);

  const distribution = useMemo(() => (analytics?.distribution || []).map((item: RatingDistribution) => ({
    rating: `${item.rating}/5`, employees: item.count
  })), [analytics?.distribution]);
  const trend = useMemo(() => (analytics?.trends || []).map((item: CycleTrend) => ({
    name: item.cycleName,
    rating: item.averageRating,
    completion: item.completionRate
  })), [analytics?.trends]);

  if (contextLoading || isLoading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}><CircularProgress /></Box>;
  }
  if (!isManager && !isHRAdmin) {
    return <Alert severity="info">Analytics are available in Manager or Admin workspace.</Alert>;
  }
  if (isError || !analytics) {
    return <Alert severity="error" action={<Button onClick={() => mutate()}>Retry</Button>}>Performance analytics could not be loaded.</Alert>;
  }

  const summary = analytics.summary || {};
  const filterOptions = analytics.filters || { cycles: [], teams: [], departments: [] };
  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  const clearFilters = () => setFilters({ cycleId: '', teamId: '', department: '' });

  return (
    <Box>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'flex-start' }} gap={2} mb={3}>
        <Box>
          <Typography variant="h4" fontWeight={700}>Performance analytics</Typography>
          <Typography variant="body1" color="text.secondary">
            Final ratings, completion, goal achievement, configured section coverage, and performer drilldowns from the canonical appraisal record.
          </Typography>
        </Box>
        <Button variant="outlined" startIcon={<Refresh />} onClick={() => mutate()}>Refresh</Button>
      </Stack>

      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 230 }}>
            <InputLabel id="analytics-cycle-label">Cycle</InputLabel>
            <Select labelId="analytics-cycle-label" id="analytics-cycle" value={filters.cycleId} label="Cycle" onChange={(event) => setFilters((current) => ({ ...current, cycleId: event.target.value }))}>
              <MenuItem value="">All cycles</MenuItem>
              {(filterOptions.cycles || []).map((cycle: IdName) => <MenuItem key={cycle.id} value={cycle.id}>{cycle.name}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel id="analytics-team-label">Team</InputLabel>
            <Select labelId="analytics-team-label" id="analytics-team" value={filters.teamId} label="Team" onChange={(event) => setFilters((current) => ({ ...current, teamId: event.target.value }))}>
              <MenuItem value="">All accessible teams</MenuItem>
              {(filterOptions.teams || []).map((team: IdName) => <MenuItem key={team.id} value={team.id}>{team.name}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel id="analytics-department-label">Department</InputLabel>
            <Select labelId="analytics-department-label" id="analytics-department" value={filters.department} label="Department" onChange={(event) => setFilters((current) => ({ ...current, department: event.target.value }))}>
              <MenuItem value="">All departments</MenuItem>
              {(filterOptions.departments || []).map((department: string) => <MenuItem key={department} value={department}>{department}</MenuItem>)}
            </Select>
          </FormControl>
          {activeFilterCount > 0 && <Button onClick={clearFilters}>Clear filters ({activeFilterCount})</Button>}
        </Stack>
      </Paper>

      <Grid container spacing={1.5} mb={3}>
        {[
          ['Participants', summary.participants ?? 0, 'Appraisals in this scope'],
          ['Completion', metricValue(summary.completionRate, '%'), `${summary.completed || 0} completed`],
          ['Average final rating', metricValue(summary.averageRating, '/5'), `${summary.rated || 0} finalized ratings`],
          ['Manager review', metricValue(summary.managerReviewRate, '%'), `${summary.highRatingGaps || 0} rating gaps need attention`]
        ].map(([label, value, detail]) => (
          <Grid key={String(label)} size={{ xs: 12, sm: 6, lg: 3 }}>
            <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
              <Typography variant="body2" color="text.secondary">{label}</Typography>
              <Typography variant="h5" fontWeight={700} sx={{ my: 0.5 }}>{value}</Typography>
              <Typography variant="caption" color="text.secondary">{detail}</Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>

      <Tabs
        value={tab}
        onChange={(_, value) => setTab(value)}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        aria-label="Analytics views"
        sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}
      >
        <Tab label="Overview" />
        <Tab label={`Top performers (${analytics.topPerformers?.length || 0})`} />
        <Tab label="Teams and departments" />
        <Tab label="Configured sections" />
      </Tabs>

      {tab === 0 && (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, lg: 6 }}>
            <Card variant="outlined" sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="h6">Final rating distribution</Typography>
                <Typography variant="body2" color="text.secondary" mb={2}>Only finalized ratings are counted.</Typography>
                {summary.rated > 0 ? (
                  <Box sx={{ height: 300, minWidth: 0 }}>
                    <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={1} initialDimension={{ width: 600, height: 300 }}>
                      <BarChart data={distribution}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="rating" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="employees" fill="#0f766e" /></BarChart>
                    </ResponsiveContainer>
                  </Box>
                ) : <Alert severity="info">No finalized ratings exist in this scope yet.</Alert>}
              </CardContent>
            </Card>
          </Grid>
          <Grid size={{ xs: 12, lg: 6 }}>
            <Card variant="outlined" sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="h6">Cycle trend</Typography>
                <Typography variant="body2" color="text.secondary" mb={2}>Average final rating and completion by cycle.</Typography>
                {trend.length > 0 ? (
                  <Box sx={{ height: 300, minWidth: 0 }}>
                    <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={1} initialDimension={{ width: 600, height: 300 }}>
                      <LineChart data={trend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" hide={trend.length > 6} /><YAxis yAxisId="rating" domain={[1, 5]} /><YAxis yAxisId="completion" orientation="right" domain={[0, 100]} /><Tooltip /><Line yAxisId="rating" type="monotone" dataKey="rating" stroke="#0f766e" strokeWidth={2} /><Line yAxisId="completion" type="monotone" dataKey="completion" stroke="#64748b" strokeWidth={2} /></LineChart>
                    </ResponsiveContainer>
                  </Box>
                ) : <Alert severity="info">Cycle trends will appear after reviews are launched.</Alert>}
              </CardContent>
            </Card>
          </Grid>
          <Grid size={12}>
            <Alert severity="info">
              <strong>Metric rules:</strong> {analytics.definitions?.averageRating} {analytics.definitions?.completionRate}
            </Alert>
          </Grid>
        </Grid>
      )}

      {tab === 1 && (
        <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
          <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
            <Stack direction="row" spacing={1} alignItems="center"><TrendingUp color="primary" /><Typography variant="h6">Top performers</Typography></Stack>
            <Typography variant="body2" color="text.secondary">{analytics.definitions?.topPerformers}</Typography>
          </Box>
          {(analytics.topPerformers || []).length === 0 ? <Alert severity="info" sx={{ m: 2 }}>No completed, finalized appraisals match these filters.</Alert> : (
            <TableContainer data-testid="top-performers-table" sx={{ overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 760 }}>
              <TableHead><TableRow><TableCell>Rank</TableCell><TableCell>Employee</TableCell><TableCell>Team</TableCell><TableCell>Cycle</TableCell><TableCell align="right">Goal achievement</TableCell><TableCell align="right">Final rating</TableCell></TableRow></TableHead>
              <TableBody>
                {analytics.topPerformers.map((person: Performer) => (
                  <TableRow key={person.appraisalId} hover>
                    <TableCell>{person.rank}</TableCell>
                    <TableCell><Typography variant="body2" fontWeight={600}>{person.employeeName}</Typography><Typography variant="caption" color="text.secondary">{person.jobTitle || person.department}</Typography></TableCell>
                    <TableCell><Button size="small" disabled={!person.teamId} onClick={() => { setFilters((current) => ({ ...current, teamId: person.teamId })); setTab(0); }}>{person.teamName}</Button></TableCell>
                    <TableCell>{person.cycleName}</TableCell>
                    <TableCell align="right">{metricValue(person.goalAchievement, '%')}</TableCell>
                    <TableCell align="right"><Chip size="small" color="success" variant="outlined" label={`${person.finalRating}/5${person.ratingLabel ? ` · ${person.ratingLabel}` : ''}`} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </TableContainer>
          )}
        </Paper>
      )}

      {tab === 2 && (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, lg: 7 }}>
            <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
              <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}><Typography variant="h6">Team comparison</Typography></Box>
              <TableContainer data-testid="team-comparison-table" sx={{ overflowX: 'auto' }}>
              <Table size="small" sx={{ minWidth: 680 }}>
                <TableHead><TableRow><TableCell>Team</TableCell><TableCell align="right">Participants</TableCell><TableCell align="right">Completion</TableCell><TableCell align="right">Avg rating</TableCell><TableCell align="right">Goals</TableCell><TableCell /></TableRow></TableHead>
                <TableBody>{(analytics.teams || []).map((team: GroupInsight) => (
                  <TableRow key={team.id} hover><TableCell>{team.name}</TableCell><TableCell align="right">{team.participants}</TableCell><TableCell align="right">{team.completionRate}%</TableCell><TableCell align="right">{metricValue(team.averageRating, '/5')}</TableCell><TableCell align="right">{metricValue(team.averageGoalAchievement, '%')}</TableCell><TableCell align="right"><Button size="small" disabled={team.id === 'unassigned'} onClick={() => { setFilters((current) => ({ ...current, teamId: team.id })); setTab(0); }}>Drill down</Button></TableCell></TableRow>
                ))}</TableBody>
              </Table>
              </TableContainer>
            </Paper>
          </Grid>
          <Grid size={{ xs: 12, lg: 5 }}>
            <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
              <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}><Typography variant="h6">Department comparison</Typography></Box>
              <TableContainer data-testid="department-comparison-table" sx={{ overflowX: 'auto' }}>
              <Table size="small" sx={{ minWidth: 440 }}><TableHead><TableRow><TableCell>Department</TableCell><TableCell align="right">Completion</TableCell><TableCell align="right">Avg rating</TableCell></TableRow></TableHead><TableBody>
                {(analytics.departments || []).map((department: GroupInsight) => <TableRow key={department.id} hover><TableCell><Button size="small" disabled={department.name === 'Unassigned'} onClick={() => setFilters((current) => ({ ...current, department: department.name }))}>{department.name}</Button></TableCell><TableCell align="right">{department.completionRate}%</TableCell><TableCell align="right">{metricValue(department.averageRating, '/5')}</TableCell></TableRow>)}
              </TableBody></Table>
              </TableContainer>
            </Paper>
          </Grid>
        </Grid>
      )}

      {tab === 3 && (
        <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
          <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
            <Typography variant="h6">Configured section coverage</Typography>
            <Typography variant="body2" color="text.secondary">Shows whether the custom cycle content—such as learning reflection—was actually completed.</Typography>
          </Box>
          {(analytics.sectionInsights || []).length === 0 ? <Alert severity="info" sx={{ m: 2 }}>No configurable section data is available for this scope.</Alert> : (
            <TableContainer data-testid="section-coverage-table" sx={{ overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 560 }}><TableHead><TableRow><TableCell>Section</TableCell><TableCell>Type</TableCell><TableCell align="right">Response rate</TableCell><TableCell align="right">Manager score</TableCell></TableRow></TableHead><TableBody>
              {analytics.sectionInsights.map((section: SectionInsight) => <TableRow key={section.sectionId}><TableCell>{section.title}</TableCell><TableCell><Chip size="small" label={section.type} variant="outlined" /></TableCell><TableCell align="right">{section.responseRate}%</TableCell><TableCell align="right">{metricValue(section.averageManagerScore, '/5')}</TableCell></TableRow>)}
            </TableBody></Table>
            </TableContainer>
          )}
        </Paper>
      )}

      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2 }}>
        Refreshed {new Date(analytics.refreshedAt).toLocaleString()}. Draft ratings and AI suggestions are excluded from top-performer ranking.
      </Typography>
    </Box>
  );
}
