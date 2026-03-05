'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAppraisalAdminAnalytics, useUserContext } from '@/lib/hooks';
import api from '@/lib/api';
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
  Stack,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Divider
} from '@mui/material';
import {
  Settings,
  Assessment,
  TrendingUp,
  Warning,
  Flag,
  Insights,
  ArrowForward,
  Business,
  AccountTree
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

type AdminEmployee = {
  userId: string;
  name: string;
  email: string;
  jobTitle?: string;
  department?: string;
  teamName?: string;
  isManager?: boolean;
};

type AdminOkr = {
  _id: string;
  ownerId?: string;
  title?: string;
  type?: string;
  status?: string;
  progress?: number;
  period?: string;
};

type AdminAppraisal = {
  _id: string;
  status?: string;
  employee?: {
    userId?: string;
    name?: string;
    email?: string;
    teamName?: string;
    department?: string;
  };
  manager?: {
    userId?: string;
    name?: string;
  };
};

type DepartmentDrilldown = {
  department: string;
  members: number;
  managers: number;
  okrs: number;
  activeOkrs: number;
  appraisals: number;
  completed: number;
  stageCounts: Record<string, number>;
};

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

  const [employees, setEmployees] = useState<AdminEmployee[]>([]);
  const [okrs, setOkrs] = useState<AdminOkr[]>([]);
  const [appraisals, setAppraisals] = useState<AdminAppraisal[]>([]);
  const [drilldownLoading, setDrilldownLoading] = useState(false);
  const [drilldownError, setDrilldownError] = useState<string | null>(null);
  const [selectedDepartment, setSelectedDepartment] = useState<string>('all');
  const [selectedStage, setSelectedStage] = useState<string>('all');

  const overview = analytics?.overview || {};
  const workflow = analytics?.workflow || {};
  const ratings = analytics?.ratings || {};
  const cycleHealth = analytics?.cycleHealth || [];
  const teamInsights = analytics?.teamInsights || [];
  const monthlyTrend = analytics?.monthlyTrend || [];

  const completionFunnel = useMemo(() => [
    { stage: 'Self Submitted', value: workflow.selfCompletionRate || 0, color: 'success.main' },
    { stage: 'Manager Submitted', value: workflow.managerCompletionRate || 0, color: 'info.main' },
    { stage: 'Finalized', value: workflow.finalizationRate || 0, color: 'secondary.main' }
  ], [workflow.selfCompletionRate, workflow.managerCompletionRate, workflow.finalizationRate]);

  useEffect(() => {
    if (!isHRAdmin) return;

    let isMounted = true;
    const loadDrilldownData = async () => {
      setDrilldownLoading(true);
      setDrilldownError(null);
      try {
        const [employeesRes, okrsRes, appraisalsRes] = await Promise.all([
          api.get('/user/employees-for-appraisal'),
          api.get('/okrs'),
          api.get('/appraisals/team')
        ]);

        if (!isMounted) return;
        setEmployees(employeesRes.data?.data?.employees || []);
        setOkrs(okrsRes.data?.data || []);
        setAppraisals(appraisalsRes.data?.data || []);
      } catch (error: unknown) {
        if (!isMounted) return;
        const axiosError = error as { response?: { data?: { error?: string } } };
        setDrilldownError(axiosError.response?.data?.error || 'Failed to load organization drill-down data');
      } finally {
        if (isMounted) {
          setDrilldownLoading(false);
        }
      }
    };

    loadDrilldownData();
    return () => { isMounted = false; };
  }, [isHRAdmin]);

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

  const ratingChartData = (ratings.distribution || []).map((item: any) => ({
    rating: `${item.rating} stars`,
    count: item.count
  }));

  const trendChartData = monthlyTrend.map((point: any) => ({
    month: formatMonth(point.month),
    launched: point.launched || 0,
    selfSubmitted: point.selfSubmitted || 0,
    managerSubmitted: point.managerSubmitted || 0,
    completed: point.completed || 0
  }));

  const departmentMetrics = useMemo<DepartmentDrilldown[]>(() => {
    const deptMap = new Map<string, DepartmentDrilldown>();

    const getDepartment = (department?: string, teamName?: string) => {
      const raw = (department || teamName || 'Unassigned').trim();
      return raw || 'Unassigned';
    };

    employees.forEach((employee) => {
      const department = getDepartment(employee.department, employee.teamName);
      if (!deptMap.has(department)) {
        deptMap.set(department, {
          department,
          members: 0,
          managers: 0,
          okrs: 0,
          activeOkrs: 0,
          appraisals: 0,
          completed: 0,
          stageCounts: {}
        });
      }

      const dept = deptMap.get(department)!;
      dept.members += 1;
      if (employee.isManager) {
        dept.managers += 1;
      }
    });

    const ownerToDepartment = new Map<string, string>();
    employees.forEach((employee) => {
      if (!employee.userId) return;
      ownerToDepartment.set(employee.userId, getDepartment(employee.department, employee.teamName));
    });

    okrs.forEach((okr) => {
      const department = ownerToDepartment.get(okr.ownerId || '') || 'Unassigned';
      if (!deptMap.has(department)) {
        deptMap.set(department, {
          department,
          members: 0,
          managers: 0,
          okrs: 0,
          activeOkrs: 0,
          appraisals: 0,
          completed: 0,
          stageCounts: {}
        });
      }

      const dept = deptMap.get(department)!;
      dept.okrs += 1;
      if (okr.status === 'active') {
        dept.activeOkrs += 1;
      }
    });

    appraisals.forEach((appraisal) => {
      const department = getDepartment(appraisal.employee?.department, appraisal.employee?.teamName);
      if (!deptMap.has(department)) {
        deptMap.set(department, {
          department,
          members: 0,
          managers: 0,
          okrs: 0,
          activeOkrs: 0,
          appraisals: 0,
          completed: 0,
          stageCounts: {}
        });
      }

      const dept = deptMap.get(department)!;
      const stage = appraisal.status || 'unknown';
      dept.appraisals += 1;
      if (stage === 'completed' || stage === 'employee_acknowledged') {
        dept.completed += 1;
      }
      dept.stageCounts[stage] = (dept.stageCounts[stage] || 0) + 1;
    });

    return Array.from(deptMap.values()).sort((a, b) => b.appraisals - a.appraisals || b.members - a.members);
  }, [employees, okrs, appraisals]);

  const stageOptions = useMemo(() => {
    const stages = new Set<string>();
    appraisals.forEach((item) => {
      if (item.status) stages.add(item.status);
    });
    return Array.from(stages).sort();
  }, [appraisals]);

  const filteredAppraisals = useMemo(() => {
    return appraisals.filter((item) => {
      const department = item.employee?.department || item.employee?.teamName || 'Unassigned';
      if (selectedDepartment !== 'all' && department !== selectedDepartment) return false;
      if (selectedStage !== 'all' && (item.status || 'unknown') !== selectedStage) return false;
      return true;
    });
  }, [appraisals, selectedDepartment, selectedStage]);

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

      {drilldownError && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {drilldownError}
        </Alert>
      )}

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

      <Grid container spacing={2.5} sx={{ mt: 1 }}>
        <Grid size={{ xs: 12 }}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, flexWrap: 'wrap', gap: 1 }}>
                <Typography variant="h6" fontWeight={700}>
                  Department Drill-down
                </Typography>
                <Chip icon={<Business />} label={`${departmentMetrics.length} departments`} variant="outlined" />
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                View departments with member count, line-manager count, OKRs, appraisal volume, and completion rates.
              </Typography>

              {drilldownLoading ? (
                <Box sx={{ py: 2 }}>
                  <CircularProgress size={24} />
                </Box>
              ) : (
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Department</TableCell>
                        <TableCell align="right">Members</TableCell>
                        <TableCell align="right">Line Managers</TableCell>
                        <TableCell align="right">OKRs</TableCell>
                        <TableCell align="right">Appraisals</TableCell>
                        <TableCell align="right">Completed</TableCell>
                        <TableCell align="right">Completion Rate</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {departmentMetrics.map((dept) => {
                        const completionRate = dept.appraisals > 0 ? Math.round((dept.completed / dept.appraisals) * 100) : 0;
                        return (
                          <TableRow key={dept.department} hover>
                            <TableCell>
                              <Typography variant="body2" fontWeight={700}>{dept.department}</Typography>
                              <Typography variant="caption" color="text.secondary">Active OKRs: {dept.activeOkrs}</Typography>
                            </TableCell>
                            <TableCell align="right">{dept.members}</TableCell>
                            <TableCell align="right">{dept.managers}</TableCell>
                            <TableCell align="right">{dept.okrs}</TableCell>
                            <TableCell align="right">{dept.appraisals}</TableCell>
                            <TableCell align="right">{dept.completed}</TableCell>
                            <TableCell align="right">
                              <Chip size="small" label={`${completionRate}%`} color={completionRate >= 70 ? 'success' : completionRate >= 40 ? 'warning' : 'default'} />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {departmentMetrics.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={7}>
                            <Typography variant="body2" color="text.secondary">
                              No department drill-down data available.
                            </Typography>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Grid container spacing={2.5} sx={{ mt: 1 }}>
        <Grid size={{ xs: 12 }}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, flexWrap: 'wrap', gap: 1 }}>
                <Typography variant="h6" fontWeight={700}>
                  Pipeline And OKR Drill-down
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip icon={<AccountTree />} label={`${filteredAppraisals.length} appraisals`} size="small" />
                  <Chip label={`${okrs.length} OKRs`} size="small" variant="outlined" />
                </Stack>
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Filter appraisal stage by department and status, then review the corresponding employee records.
              </Typography>

              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
                <FormControl size="small" sx={{ minWidth: 240 }}>
                  <InputLabel>Department</InputLabel>
                  <Select
                    label="Department"
                    value={selectedDepartment}
                    onChange={(event) => setSelectedDepartment(event.target.value)}
                  >
                    <MenuItem value="all">All Departments</MenuItem>
                    {departmentMetrics.map((dept) => (
                      <MenuItem key={dept.department} value={dept.department}>{dept.department}</MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl size="small" sx={{ minWidth: 240 }}>
                  <InputLabel>Status</InputLabel>
                  <Select
                    label="Status"
                    value={selectedStage}
                    onChange={(event) => setSelectedStage(event.target.value)}
                  >
                    <MenuItem value="all">All Statuses</MenuItem>
                    {stageOptions.map((stage) => (
                      <MenuItem key={stage} value={stage}>{formatLabel(stage)}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Stack>

              <Divider sx={{ mb: 2 }} />

              <Grid container spacing={2}>
                <Grid size={{ xs: 12, lg: 7 }}>
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Employee</TableCell>
                          <TableCell>Department</TableCell>
                          <TableCell>Line Manager</TableCell>
                          <TableCell>Status</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {filteredAppraisals.slice(0, 120).map((item) => (
                          <TableRow key={item._id} hover>
                            <TableCell>
                              <Typography variant="body2" fontWeight={600}>{item.employee?.name || 'Unknown'}</Typography>
                              <Typography variant="caption" color="text.secondary">{item.employee?.email || '-'}</Typography>
                            </TableCell>
                            <TableCell>{item.employee?.department || item.employee?.teamName || 'Unassigned'}</TableCell>
                            <TableCell>{item.manager?.name || '-'}</TableCell>
                            <TableCell>
                              <Chip size="small" label={formatLabel(item.status || 'unknown')} />
                            </TableCell>
                          </TableRow>
                        ))}
                        {filteredAppraisals.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={4}>
                              <Typography variant="body2" color="text.secondary">
                                No appraisals match the selected filters.
                              </Typography>
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Grid>

                <Grid size={{ xs: 12, lg: 5 }}>
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>OKR</TableCell>
                          <TableCell>Owner ID</TableCell>
                          <TableCell align="right">Progress</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {okrs.slice(0, 40).map((okr) => (
                          <TableRow key={okr._id} hover>
                            <TableCell>
                              <Typography variant="body2" fontWeight={600}>{okr.title || 'Untitled OKR'}</Typography>
                              <Typography variant="caption" color="text.secondary">{formatLabel(okr.status || 'unknown')}</Typography>
                            </TableCell>
                            <TableCell>{okr.ownerId || '-'}</TableCell>
                            <TableCell align="right">{okr.progress ?? 0}%</TableCell>
                          </TableRow>
                        ))}
                        {okrs.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={3}>
                              <Typography variant="body2" color="text.secondary">
                                No OKRs found for this organization.
                              </Typography>
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}

