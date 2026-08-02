'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUserContext } from '@/lib/hooks';
import api from '@/lib/api';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography
} from '@mui/material';
import { ArrowBack, Assessment, Business, Flag, Groups, TrackChanges } from '@mui/icons-material';

type DepartmentEmployee = {
  userId: string;
  name: string;
  email: string;
  jobTitle?: string;
  department?: string;
  teamName?: string;
  isManager?: boolean;
};

type DepartmentOkr = {
  _id: string;
  ownerId?: string;
  title?: string;
  status?: string;
  progress?: number;
};

type DepartmentAppraisal = {
  _id: string;
  status?: string;
  cycleId?: string | { _id?: string; name?: string };
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

const COMPLETED_APPRAISAL_STATUSES = new Set(['completed', 'employee_acknowledged']);

function normalizeDepartment(value?: string) {
  const normalized = (value || '').trim();
  return normalized || 'Unassigned';
}

function formatLabel(value: string) {
  return (value || 'unknown')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export default function DepartmentDetailsPage() {
  const router = useRouter();
  const params = useParams();
  const { isHRAdmin, isLoading: userLoading } = useUserContext();

  const [employees, setEmployees] = useState<DepartmentEmployee[]>([]);
  const [okrs, setOkrs] = useState<DepartmentOkr[]>([]);
  const [appraisals, setAppraisals] = useState<DepartmentAppraisal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const departmentParamRaw = Array.isArray(params.department) ? params.department[0] : params.department;
  const departmentName = useMemo(() => {
    if (!departmentParamRaw || typeof departmentParamRaw !== 'string') return 'Unassigned';
    return decodeURIComponent(departmentParamRaw);
  }, [departmentParamRaw]);

  useEffect(() => {
    if (!isHRAdmin) return;

    let isMounted = true;
    const loadDetails = async () => {
      setLoading(true);
      setError('');
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
      } catch (err: unknown) {
        if (!isMounted) return;
        const axiosError = err as { response?: { data?: { error?: string } } };
        setError(axiosError.response?.data?.error || 'Failed to load department details');
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadDetails();
    return () => { isMounted = false; };
  }, [isHRAdmin]);

  const filteredEmployees = useMemo(() => (
    employees.filter((employee) => normalizeDepartment(employee.department || employee.teamName) === departmentName)
  ), [employees, departmentName]);

  const ownerIds = useMemo(() => new Set(filteredEmployees.map((employee) => employee.userId).filter(Boolean)), [filteredEmployees]);

  const filteredOkrs = useMemo(() => (
    okrs.filter((okr) => ownerIds.has(okr.ownerId || ''))
  ), [okrs, ownerIds]);

  const filteredAppraisals = useMemo(() => (
    appraisals.filter((appraisal) => (
      normalizeDepartment(appraisal.employee?.department || appraisal.employee?.teamName) === departmentName
    ))
  ), [appraisals, departmentName]);

  const statusBreakdown = useMemo(() => {
    const statusMap = new Map<string, number>();
    filteredAppraisals.forEach((appraisal) => {
      const status = appraisal.status || 'unknown';
      statusMap.set(status, (statusMap.get(status) || 0) + 1);
    });
    return Array.from(statusMap.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);
  }, [filteredAppraisals]);

  const lineManagers = useMemo(() => {
    const managers = filteredEmployees.filter((employee) => employee.isManager);
    return managers;
  }, [filteredEmployees]);

  const managerNames = useMemo(() => {
    const names = new Set<string>();
    filteredAppraisals.forEach((appraisal) => {
      if (appraisal.manager?.name) names.add(appraisal.manager.name);
    });
    return Array.from(names).sort();
  }, [filteredAppraisals]);

  const completedAppraisals = filteredAppraisals.reduce((sum, appraisal) => (
    COMPLETED_APPRAISAL_STATUSES.has(appraisal.status || '') ? sum + 1 : sum
  ), 0);
  const completionRate = filteredAppraisals.length > 0
    ? Math.round((completedAppraisals / filteredAppraisals.length) * 100)
    : 0;
  const activeOkrs = filteredOkrs.filter((okr) => okr.status === 'active').length;

  if (userLoading || loading) {
    return (
      <Box sx={{ minHeight: '50vh', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!isHRAdmin) {
    return (
      <Alert severity="error">
        Access denied. Only HR Administrators can access department drill-down pages.
      </Alert>
    );
  }

  if (error) {
    return (
      <Alert severity="error">
        {error}
      </Alert>
    );
  }

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} spacing={1.5} sx={{ mb: 3 }}>
        <Box>
          <Button startIcon={<ArrowBack />} onClick={() => router.push('/admin')} sx={{ mb: 1 }}>
            Back To Admin Panel
          </Button>
          <Typography variant="h4" fontWeight={800}>
            {departmentName}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Department drill-down with employee, OKR, and appraisal workflow details.
          </Typography>
        </Box>
        <Chip icon={<Business />} label="Department Detail" color="primary" variant="outlined" />
      </Stack>

      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                <Typography variant="overline" color="text.secondary">Members</Typography>
                <Groups fontSize="small" color="primary" />
              </Stack>
              <Typography variant="h4" fontWeight={800}>{filteredEmployees.length}</Typography>
              <Typography variant="body2" color="text.secondary">Line managers: {lineManagers.length}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                <Typography variant="overline" color="text.secondary">OKRs</Typography>
                <TrackChanges fontSize="small" color="success" />
              </Stack>
              <Typography variant="h4" fontWeight={800}>{filteredOkrs.length}</Typography>
              <Typography variant="body2" color="text.secondary">Active: {activeOkrs}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                <Typography variant="overline" color="text.secondary">Appraisals</Typography>
                <Assessment fontSize="small" color="warning" />
              </Stack>
              <Typography variant="h4" fontWeight={800}>{filteredAppraisals.length}</Typography>
              <Typography variant="body2" color="text.secondary">Completed: {completedAppraisals}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                <Typography variant="overline" color="text.secondary">Completion</Typography>
                <Flag fontSize="small" color={completionRate >= 70 ? 'success' : completionRate >= 40 ? 'warning' : 'disabled'} />
              </Stack>
              <Typography variant="h4" fontWeight={800}>{completionRate}%</Typography>
              <Typography variant="body2" color="text.secondary">Workflow completion rate</Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, lg: 6 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" fontWeight={700} gutterBottom>
                Team Members
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                Managers observed in appraisal assignments: {managerNames.join(', ') || '-'}
              </Typography>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Name</TableCell>
                      <TableCell>Email</TableCell>
                      <TableCell>Job Title</TableCell>
                      <TableCell align="right">Role</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredEmployees.slice(0, 120).map((employee) => (
                      <TableRow key={employee.userId || employee.email} hover>
                        <TableCell>
                          <Typography variant="body2" fontWeight={600}>{employee.name || 'Unknown'}</Typography>
                        </TableCell>
                        <TableCell>{employee.email || '-'}</TableCell>
                        <TableCell>{employee.jobTitle || '-'}</TableCell>
                        <TableCell align="right">
                          <Chip size="small" label={employee.isManager ? 'Manager' : 'Member'} color={employee.isManager ? 'info' : 'default'} />
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredEmployees.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4}>
                          <Typography variant="body2" color="text.secondary">
                            No employees found in this department.
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

        <Grid size={{ xs: 12, lg: 6 }}>
          <Card sx={{ mb: 2.5 }}>
            <CardContent>
              <Typography variant="h6" fontWeight={700} gutterBottom>
                Appraisal Stage Breakdown
              </Typography>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Status</TableCell>
                      <TableCell align="right">Count</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {statusBreakdown.map((item) => (
                      <TableRow key={item.status}>
                        <TableCell>{formatLabel(item.status)}</TableCell>
                        <TableCell align="right">{item.count}</TableCell>
                      </TableRow>
                    ))}
                    {statusBreakdown.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={2}>
                          <Typography variant="body2" color="text.secondary">
                            No appraisal status data available.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Typography variant="h6" fontWeight={700} gutterBottom>
                Department OKRs
              </Typography>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Title</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell align="right">Progress</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredOkrs.slice(0, 80).map((okr) => (
                      <TableRow key={okr._id}>
                        <TableCell>
                          <Typography variant="body2" fontWeight={600}>
                            {okr.title || 'Untitled OKR'}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip size="small" label={formatLabel(okr.status || 'unknown')} />
                        </TableCell>
                        <TableCell align="right">
                          {typeof okr.progress === 'number' ? `${Math.round(okr.progress)}%` : '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredOkrs.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={3}>
                          <Typography variant="body2" color="text.secondary">
                            No OKRs mapped to this department.
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
      </Grid>

      <Divider sx={{ my: 2.5 }} />

      <Card>
        <CardContent>
          <Typography variant="h6" fontWeight={700} gutterBottom>
            Appraisal Records
          </Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Employee</TableCell>
                  <TableCell>Manager</TableCell>
                  <TableCell>Cycle</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Open</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredAppraisals.slice(0, 150).map((appraisal) => {
                  const cycleName = typeof appraisal.cycleId === 'string'
                    ? appraisal.cycleId
                    : (appraisal.cycleId?.name || appraisal.cycleId?._id || '-');
                  return (
                    <TableRow
                      key={appraisal._id}
                      hover
                      onClick={() => router.push(`/appraisals/${appraisal._id}`)}
                      sx={{ cursor: 'pointer' }}
                    >
                      <TableCell>
                        <Typography variant="body2" fontWeight={600}>{appraisal.employee?.name || 'Unknown'}</Typography>
                        <Typography variant="caption" color="text.secondary">{appraisal.employee?.email || '-'}</Typography>
                      </TableCell>
                      <TableCell>{appraisal.manager?.name || '-'}</TableCell>
                      <TableCell>{cycleName}</TableCell>
                      <TableCell>
                        <Chip size="small" label={formatLabel(appraisal.status || 'unknown')} />
                      </TableCell>
                      <TableCell align="right">
                        <Button size="small" variant="text" onClick={(event) => {
                          event.stopPropagation();
                          router.push(`/appraisals/${appraisal._id}`);
                        }}>
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filteredAppraisals.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Typography variant="body2" color="text.secondary">
                        No appraisal records found for this department.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>
    </Box>
  );
}
