'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAppraisalAdminAnalytics, useUserContext } from '@/lib/hooks';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  Chip,
  Button,
  Alert,
  CircularProgress,
  LinearProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Stack
} from '@mui/material';
import {
  Settings,
  Assessment,
  Groups,
  TrendingUp,
  Warning,
  Flag,
  Insights,
  ArrowForward
} from '@mui/icons-material';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line
} from 'recharts';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316'];

function formatLabel(value: string) {
  return (value || 'unknown')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function formatMonth(monthKey: string) {
  if (!monthKey) return '-';
  const [year, month] = monthKey.split('-');
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
}

export default function AdminOverviewPage() {
  const router = useRouter();
  const { isHRAdmin, isLoading: userLoading } = useUserContext();
  const { analytics, isLoading, isError } = useAppraisalAdminAnalytics();

  if (userLoading || isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '55vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!isHRAdmin) {
    return (
      <Alert severity="error">
        Access denied. Only HR Administrators can access the Admin Panel.
      </Alert>
    );
  }

  if (isError || !analytics) {
    return (
      <Alert severity="error">
        Unable to load admin analytics. Please refresh and try again.
      </Alert>
    );
  }

  const overview = analytics.overview || {};
  const workflow = analytics.workflow || {};
  const ratings = analytics.ratings || {};
  const cycleHealth = analytics.cycleHealth || [];
  const teamInsights = analytics.teamInsights || [];
  const monthlyTrend = analytics.monthlyTrend || [];

  const summaryCards = [
    {
      title: 'Total Appraisals',
      value: overview.totalAppraisals || 0,
      subtitle: `${overview.uniqueEmployees || 0} unique employees`,
      color: 'primary.main',
      icon: <Assessment />
    },
    {
      title: 'Cycle Completion',
      value: `${overview.completionRate || 0}%`,
      subtitle: `${overview.completedAppraisals || 0} completed`,
      color: 'success.main',
      icon: <TrendingUp />
    },
    {
      title: 'Overdue Items',
      value: overview.overdueAppraisals || 0,
      subtitle: 'Needs immediate follow-up',
      color: 'warning.main',
      icon: <Warning />
    },
    {
      title: 'Active Cycles',
      value: overview.activeCycles || 0,
      subtitle: `${overview.totalCycles || 0} total cycles`,
      color: 'info.main',
      icon: <Flag />
    }
  ];

  const statusChartData = (workflow.statusBreakdown || []).map((item: any) => ({
    name: formatLabel(item.status),
    count: item.count
  }));

  const phaseChartData = (workflow.phaseBreakdown || []).map((item: any) => ({
    name: formatLabel(item.phase),
    count: item.count
  }));

  const ratingChartData = (ratings.distribution || []).map((item: any) => ({
    rating: `${item.rating}★`,
    count: item.count
  }));

  const trendChartData = monthlyTrend.map((point: any) => ({
    month: formatMonth(point.month),
    launched: point.launched || 0,
    selfSubmitted: point.selfSubmitted || 0,
    managerSubmitted: point.managerSubmitted || 0,
    completed: point.completed || 0
  }));

  const completionFunnel = useMemo(() => [
    { stage: 'Self Submitted', value: workflow.selfCompletionRate || 0, color: 'success.main' },
    { stage: 'Manager Submitted', value: workflow.managerCompletionRate || 0, color: 'info.main' },
    { stage: 'Finalized', value: workflow.finalizationRate || 0, color: 'secondary.main' }
  ], [workflow.selfCompletionRate, workflow.managerCompletionRate, workflow.finalizationRate]);

  return (
    <Box>
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="h4" fontWeight={800} gutterBottom>
            Admin Panel
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Organization-wide appraisal analytics, cycle health, and completion insights.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button variant="contained" startIcon={<Settings />} onClick={() => router.push('/admin/appraisal-cycles')}>
            Manage Cycles
          </Button>
          <Button variant="outlined" startIcon={<Insights />} onClick={() => router.push('/admin/reports')}>
            Reports
          </Button>
          <Button variant="outlined" onClick={() => router.push('/admin/calibration')}>
            Calibration
          </Button>
        </Stack>
      </Box>

      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        {summaryCards.map((card) => (
          <Grid key={card.title} size={{ xs: 12, sm: 6, lg: 3 }}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="overline" color="text.secondary">
                    {card.title}
                  </Typography>
                  <Box sx={{ color: card.color }}>{card.icon}</Box>
                </Box>
                <Typography variant="h4" fontWeight={800} color={card.color}>
                  {card.value}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {card.subtitle}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, lg: 5 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" fontWeight={700} gutterBottom>
                Workflow Funnel
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Shows how far appraisals are moving through the process.
              </Typography>
              <Stack spacing={2}>
                {completionFunnel.map((item) => (
                  <Box key={item.stage}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                      <Typography variant="body2">{item.stage}</Typography>
                      <Typography variant="body2" fontWeight={700}>{item.value}%</Typography>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={Math.max(0, Math.min(100, item.value))}
                      color={item.stage === 'Self Submitted' ? 'success' : item.stage === 'Manager Submitted' ? 'info' : 'secondary'}
                      sx={{ height: 8, borderRadius: 4 }}
                    />
                  </Box>
                ))}
              </Stack>
              <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Chip label={`Overdue: ${workflow.overdue || 0}`} color="warning" size="small" />
                <Chip label={`High Rating Disagreements: ${ratings.highDisagreements || 0}`} color="error" size="small" variant="outlined" />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, lg: 7 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" fontWeight={700} gutterBottom>
                Monthly Trend
              </Typography>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={trendChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="launched" stroke="#3b82f6" strokeWidth={2} />
                  <Line type="monotone" dataKey="selfSubmitted" stroke="#10b981" strokeWidth={2} />
                  <Line type="monotone" dataKey="managerSubmitted" stroke="#8b5cf6" strokeWidth={2} />
                  <Line type="monotone" dataKey="completed" stroke="#f59e0b" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" fontWeight={700} gutterBottom>
                Appraisal Status Breakdown
              </Typography>
              <ResponsiveContainer width="100%" height={270}>
                <PieChart>
                  <Pie data={statusChartData} dataKey="count" nameKey="name" outerRadius={95} label>
                    {statusChartData.map((entry: any, index: number) => (
                      <Cell key={`${entry.name}-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" fontWeight={700} gutterBottom>
                Rating Distribution
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Avg Self: {ratings.averageSelfRating ?? '-'} | Avg Manager: {ratings.averageManagerRating ?? '-'} | Avg Final: {ratings.averageFinalRating ?? '-'}
              </Typography>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={ratingChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="rating" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, lg: 7 }}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Typography variant="h6" fontWeight={700}>
                  Cycle Health
                </Typography>
                <Button size="small" endIcon={<ArrowForward />} onClick={() => router.push('/admin/appraisal-cycles')}>
                  View Cycles
                </Button>
              </Box>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Cycle</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell align="right">Employees</TableCell>
                      <TableCell align="right">Completion</TableCell>
                      <TableCell align="right">Overdue</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {cycleHealth.slice(0, 8).map((cycle: any) => (
                      <TableRow key={cycle.cycleId}>
                        <TableCell>
                          <Typography variant="body2" fontWeight={600}>{cycle.name}</Typography>
                          <Typography variant="caption" color="text.secondary">{formatLabel(cycle.currentPhase)}</Typography>
                        </TableCell>
                        <TableCell>
                          <Chip size="small" label={formatLabel(cycle.status)} />
                        </TableCell>
                        <TableCell align="right">{cycle.stats?.totalEmployees || 0}</TableCell>
                        <TableCell align="right">{cycle.completionRate || 0}%</TableCell>
                        <TableCell align="right">
                          <Chip
                            size="small"
                            label={cycle.stats?.overdueAppraisals || 0}
                            color={(cycle.stats?.overdueAppraisals || 0) > 0 ? 'warning' : 'default'}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                    {cycleHealth.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5}>
                          <Typography variant="body2" color="text.secondary">
                            No appraisal cycles found for this organization.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, lg: 5 }}>
          <Card>
            <CardContent>
              <Typography variant="h6" fontWeight={700} gutterBottom>
                Team Insights
              </Typography>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={teamInsights.slice(0, 8)} layout="vertical" margin={{ left: 18 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="teamName" width={90} />
                  <Tooltip />
                  <Bar dataKey="completionRate" fill="#10b981" />
                </BarChart>
              </ResponsiveContainer>
              <Typography variant="caption" color="text.secondary">
                Bars show completion rate (%) by team.
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}

