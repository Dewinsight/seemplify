'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUserContext, useAppraisalCycles, useDirectReports } from '@/lib/hooks';
import api from '@/lib/api';
import {
  Box, Typography, Card, CardContent, Grid, Button, TextField, Chip, Alert,
  Paper, Stepper, Step, StepLabel, LinearProgress, Tab, Tabs, Badge,
  Dialog, DialogTitle, DialogContent, DialogActions, CircularProgress,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Checkbox, FormControlLabel, IconButton, Tooltip, Divider, Select,
  MenuItem, FormControl, InputLabel, Slider, Switch, Snackbar,
  alpha, useTheme
} from '@mui/material';
import { gradients } from '../../theme';
import {
  Add, PlayArrow, Pause, CheckCircle, Settings, People, Assessment,
  Schedule, Edit, Delete, Visibility, Rocket, ArrowForward, Warning,
  TrendingUp, Groups, Star
} from '@mui/icons-material';

interface AppraisalCycle {
  _id: string;
  name: string;
  description?: string;
  cycleType: 'annual' | 'semi-annual' | 'quarterly' | 'probation' | 'project' | 'adhoc';
  periodStart: string;
  periodEnd: string;
  currentPhase: string;
  status: 'draft' | 'active' | 'completed' | 'cancelled';
  phases: Record<string, { startDate?: string; endDate?: string; isActive: boolean }>;
  competencies: Array<{ id: string; name: string; description?: string; weight: number; category: string }>;
  okrWeight: number;
  settings: {
    allowSelfRating: boolean;
    requireDocumentUpload: boolean;
    requireOkrAlignment: boolean;
    enablePeerFeedback: boolean;
    enable360Feedback: boolean;
    enableAiAssist: boolean;
    enableChat: boolean;
    requireSignOff: boolean;
  };
  stats?: {
    totalEmployees: number;
    completedAppraisals: number;
    pendingSelfAssessment: number;
    pendingManagerReview: number;
  };
}

interface Employee {
  userId: string;
  name: string;
  email: string;
  jobTitle?: string;
  department?: string;
  teamId?: string;
  teamName?: string;
  teamRole?: string;
  isManager?: boolean;
  managerId?: string;
  managerName?: string;
  managerEmail?: string;
}

interface ManagerGroup {
  managerId: string;
  managerName: string;
  managerEmail?: string;
  directReports: Array<{
    userId: string;
    name: string;
    email: string;
    jobTitle?: string;
    teamName?: string;
  }>;
}

const cycleTypeLabels: Record<string, string> = {
  'annual': 'Annual Review',
  'semi-annual': 'Semi-Annual Review',
  'quarterly': 'Quarterly Review',
  'probation': 'Probation Review',
  'project': 'Project-Based Review',
  'adhoc': 'Ad-Hoc Review'
};

const phaseLabels: Record<string, string> = {
  'draft': 'Draft',
  'goalSetting': 'Goal Setting',
  'selfAssessment': 'Self-Assessment',
  'managerReview': 'Manager Review',
  'calibration': 'Calibration',
  'finalReview': 'Final Review',
  'completed': 'Completed'
};

export default function AppraisalCyclesAdminPage() {
  const router = useRouter();
  const { isHRAdmin, user } = useUserContext();
  const { cycles, isLoading, mutate } = useAppraisalCycles();

  const [selectedTab, setSelectedTab] = useState(0);
  // const [createDialogOpen, setCreateDialogOpen] = useState(false); // Refactored to use /new page
  const [launchDialogOpen, setLaunchDialogOpen] = useState(false);
  const [selectedCycle, setSelectedCycle] = useState<AppraisalCycle | null>(null);
  const [loading, setLoading] = useState(false);

  // Helper to format date for input
  const formatDateForInput = (date: Date) => date.toISOString().split('T')[0];
  const today = new Date();
  const nextYear = new Date(today.setMonth(today.getMonth() + 12));

  // Create cycle form
  const [newCycle, setNewCycle] = useState({
    name: '',
    description: '',
    cycleType: 'annual' as const,
    periodStart: formatDateForInput(new Date()),
    periodEnd: formatDateForInput(new Date(new Date().setMonth(new Date().getMonth() + 12))),
    okrWeight: 40,
    phases: {
      goalSetting: { startDate: '', endDate: '' },
      selfAssessment: { startDate: '', endDate: '' },
      managerReview: { startDate: '', endDate: '' },
      calibration: { startDate: '', endDate: '' },
      finalReview: { startDate: '', endDate: '' }
    },
    settings: {
      allowSelfRating: true,
      requireDocumentUpload: false,
      requireOkrAlignment: true,
      enablePeerFeedback: true,
      enable360Feedback: false,
      enableAiAssist: true,
      enableChat: true,
      requireSignOff: true
    }
  });

  // Launch dialog state
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [managerGroups, setManagerGroups] = useState<ManagerGroup[]>([]);
  const [employeesWithoutManager, setEmployeesWithoutManager] = useState<Employee[]>([]);
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'byManager'>('byManager');

  // Snackbar state for messages
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' }>({
    open: false,
    message: '',
    severity: 'info'
  });

  // Access check removed to allow Managers
  // if (!isHRAdmin) ...

  const handleCreateCycle = async () => {
    setLoading(true);
    try {
      await api.post('/appraisals/cycles', newCycle);
      mutate();
      setCreateDialogOpen(false);
      setNewCycle({
        name: '',
        description: '',
        cycleType: 'annual',
        periodStart: formatDateForInput(new Date()),
        periodEnd: formatDateForInput(new Date(new Date().setMonth(new Date().getMonth() + 12))),
        okrWeight: 40,
        phases: {
          goalSetting: { startDate: '', endDate: '' },
          selfAssessment: { startDate: '', endDate: '' },
          managerReview: { startDate: '', endDate: '' },
          calibration: { startDate: '', endDate: '' },
          finalReview: { startDate: '', endDate: '' }
        },
        settings: {
          allowSelfRating: true,
          requireDocumentUpload: false,
          requireOkrAlignment: true,
          enablePeerFeedback: true,
          enable360Feedback: false,
          enableAiAssist: true,
          enableChat: true,
          requireSignOff: true
        }
      });
    } catch (error) {
      console.error('Create cycle error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenLaunchDialog = async (cycle: AppraisalCycle) => {
    setSelectedCycle(cycle);
    setLaunchDialogOpen(true);
    setLoadingEmployees(true);

    try {
      // Fetch employees with manager relationships for better grouping
      const response = await api.get('/user/employees-for-appraisal');
      // API returns { success: true, data: { employees, byManager, withoutManager, summary } }
      const data = response.data?.data || {};
      const employeeList = data.employees || [];
      const byManager = data.byManager || [];
      const withoutManager = data.withoutManager || [];

      setEmployees(employeeList);
      setManagerGroups(byManager);
      setEmployeesWithoutManager(withoutManager);

      if (employeeList.length === 0) {
        setSnackbar({ open: true, message: 'No employees found in the organization', severity: 'info' });
      } else {
        // Show summary
        const summary = data.summary || {};
        console.log(`Found ${summary.totalEmployees} employees, ${summary.totalManagers} managers, ${summary.withoutManager} without manager`);
      }
    } catch (error: any) {
      console.error('Fetch employees error:', error);
      // Fallback to old endpoint if new one fails
      try {
        const fallbackResponse = await api.get('/user/all-employees');
        const employeeList = fallbackResponse.data?.data || [];
        setEmployees(employeeList);
        setManagerGroups([]);
        setEmployeesWithoutManager([]);
      } catch (fallbackError) {
        setEmployees([]);
        setManagerGroups([]);
        setEmployeesWithoutManager([]);
        setSnackbar({
          open: true,
          message: error.response?.data?.error || 'Failed to fetch employees',
          severity: 'error'
        });
      }
    } finally {
      setLoadingEmployees(false);
    }
  };

  const handleLaunchCycle = async () => {
    if (!selectedCycle || selectedEmployees.length === 0) {
      setSnackbar({ open: true, message: 'Please select at least one employee', severity: 'error' });
      return;
    }

    setLoading(true);
    try {
      const employeeData = employees
        .filter(e => selectedEmployees.includes(e.userId))
        .map(e => ({
          userId: e.userId,
          name: e.name,
          email: e.email,
          department: e.department,
          jobTitle: e.jobTitle,
          managerId: e.managerId,
          managerName: e.managerName,
          managerEmail: e.managerEmail
        }));

      const response = await api.post(`/appraisals/cycles/${selectedCycle._id}/launch`, {
        employees: employeeData
      });

      const result = response.data?.data || response.data;
      setSnackbar({
        open: true,
        message: `Cycle launched successfully! ${result?.launched || employeeData.length} appraisals created.`,
        severity: 'success'
      });

      mutate();
      setLaunchDialogOpen(false);
      setSelectedEmployees([]);
    } catch (error: any) {
      console.error('Launch cycle error:', error);
      setSnackbar({
        open: true,
        message: error.response?.data?.error || 'Failed to launch cycle',
        severity: 'error'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePhase = async (cycleId: string, phase: string) => {
    try {
      await api.patch(`/appraisals/cycles/${cycleId}/phase`, { phase });
      mutate();
    } catch (error) {
      console.error('Update phase error:', error);
    }
  };

  const renderCycleCard = (cycle: AppraisalCycle) => {
    const progress = cycle.stats
      ? (cycle.stats.completedAppraisals / cycle.stats.totalEmployees) * 100
      : 0;

    return (
      <Card key={cycle._id} sx={{ mb: 2 }}>
        <CardContent>
          <Grid container spacing={2} alignItems="center">
            <Grid size={{ xs: 12, md: 4 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Assessment color="primary" sx={{ fontSize: 40 }} />
                <Box>
                  <Typography variant="h6" fontWeight={600}>{cycle.name}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {cycleTypeLabels[cycle.cycleType]}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {new Date(cycle.periodStart).toLocaleDateString()} - {new Date(cycle.periodEnd).toLocaleDateString()}
                  </Typography>
                </Box>
              </Box>
            </Grid>

            <Grid size={{ xs: 12, md: 3 }}>
              <Box>
                <Chip
                  label={cycle.status.charAt(0).toUpperCase() + cycle.status.slice(1)}
                  color={cycle.status === 'active' ? 'success' : cycle.status === 'completed' ? 'info' : 'default'}
                  size="small"
                  sx={{ mb: 1 }}
                />
                <Chip
                  label={phaseLabels[cycle.currentPhase] || cycle.currentPhase}
                  variant="outlined"
                  size="small"
                  sx={{ ml: 1, mb: 1 }}
                />
                {cycle.stats && (
                  <Box sx={{ mt: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      Progress: {cycle.stats.completedAppraisals}/{cycle.stats.totalEmployees}
                    </Typography>
                    <LinearProgress
                      variant="determinate"
                      value={progress}
                      sx={{ height: 6, borderRadius: 3 }}
                    />
                  </Box>
                )}
              </Box>
            </Grid>

            <Grid size={{ xs: 12, md: 2 }}>
              {cycle.stats && (
                <Box>
                  <Typography variant="caption" color="text.secondary">Pending</Typography>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Tooltip title="Pending Self-Assessment">
                      <Chip size="small" label={cycle.stats.pendingSelfAssessment} color="warning" />
                    </Tooltip>
                    <Tooltip title="Pending Manager Review">
                      <Chip size="small" label={cycle.stats.pendingManagerReview} color="info" />
                    </Tooltip>
                  </Box>
                </Box>
              )}
            </Grid>

            <Grid size={{ xs: 12, md: 3 }}>
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                {cycle.status === 'draft' && (
                  <Button
                    variant="contained"
                    startIcon={<Rocket />}
                    onClick={() => handleOpenLaunchDialog(cycle)}
                    size="small"
                  >
                    Launch
                  </Button>
                )}
                {cycle.status === 'active' && (
                  <>
                    <Button
                      variant="outlined"
                      startIcon={<ArrowForward />}
                      onClick={() => {
                        const phases = ['goalSetting', 'selfAssessment', 'managerReview', 'calibration', 'finalReview'];
                        const currentIndex = phases.indexOf(cycle.currentPhase);
                        if (currentIndex < phases.length - 1) {
                          handleUpdatePhase(cycle._id, phases[currentIndex + 1]);
                        }
                      }}
                      size="small"
                    >
                      Next Phase
                    </Button>
                    <Button
                      variant="outlined"
                      startIcon={<Visibility />}
                      onClick={() => router.push(`/admin/appraisal-cycles/${cycle._id}`)}
                      size="small"
                    >
                      View
                    </Button>
                  </>
                )}
                <IconButton size="small" onClick={() => router.push(`/admin/appraisal-cycles/${cycle._id}/edit`)}>
                  <Edit />
                </IconButton>
              </Box>
            </Grid>
          </Grid>
        </CardContent>
      </Card>
    );
  };

  const activeCycles = cycles.filter((c: AppraisalCycle) => c.status === 'active');
  const draftCycles = cycles.filter((c: AppraisalCycle) => c.status === 'draft');
  const completedCycles = cycles.filter((c: AppraisalCycle) => c.status === 'completed');

  return (
    <Box>
      {/* Header */}
      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Box>
          <Typography variant="h4" fontWeight={700} gutterBottom>
            Appraisal Cycle Management
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Create, launch, and manage performance appraisal cycles for your organization
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => router.push('/admin/appraisal-cycles/new')}
        >
          Create New Cycle
        </Button>
      </Box>

      {/* Summary Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box>
                  <Typography variant="overline" color="text.secondary">Active Cycles</Typography>
                  <Typography variant="h3" fontWeight={700} color="success.main">
                    {activeCycles.length}
                  </Typography>
                </Box>
                <PlayArrow sx={{ fontSize: 40, color: 'success.main', opacity: 0.7 }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box>
                  <Typography variant="overline" color="text.secondary">Draft Cycles</Typography>
                  <Typography variant="h3" fontWeight={700} color="warning.main">
                    {draftCycles.length}
                  </Typography>
                </Box>
                <Edit sx={{ fontSize: 40, color: 'warning.main', opacity: 0.7 }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box>
                  <Typography variant="overline" color="text.secondary">Completed</Typography>
                  <Typography variant="h3" fontWeight={700} color="info.main">
                    {completedCycles.length}
                  </Typography>
                </Box>
                <CheckCircle sx={{ fontSize: 40, color: 'info.main', opacity: 0.7 }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box>
                  <Typography variant="overline" color="text.secondary">Total Employees</Typography>
                  <Typography variant="h3" fontWeight={700}>
                    {activeCycles.reduce((sum: number, c: AppraisalCycle) => sum + (c.stats?.totalEmployees || 0), 0)}
                  </Typography>
                </Box>
                <People sx={{ fontSize: 40, color: 'primary.main', opacity: 0.7 }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Tabs */}
      <Tabs
        value={selectedTab}
        onChange={(_, v) => setSelectedTab(v)}
        sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab label={<Badge badgeContent={activeCycles.length} color="success">Active</Badge>} />
        <Tab label={<Badge badgeContent={draftCycles.length} color="warning">Drafts</Badge>} />
        <Tab label="Completed" />
      </Tabs>

      {/* Cycle Lists */}
      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          {selectedTab === 0 && (
            activeCycles.length > 0 ? (
              activeCycles.map((cycle: AppraisalCycle) => renderCycleCard(cycle))
            ) : (
              <Alert severity="info">No active cycles. Create and launch a cycle to get started.</Alert>
            )
          )}
          {selectedTab === 1 && (
            draftCycles.length > 0 ? (
              draftCycles.map((cycle: AppraisalCycle) => renderCycleCard(cycle))
            ) : (
              <Alert severity="info">No draft cycles.</Alert>
            )
          )}
          {selectedTab === 2 && (
            completedCycles.length > 0 ? (
              completedCycles.map((cycle: AppraisalCycle) => renderCycleCard(cycle))
            ) : (
              <Alert severity="info">No completed cycles.</Alert>
            )
          )}
        </>
      )}

      {/* Create Cycle Dialog */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Create New Appraisal Cycle</DialogTitle>
        <DialogContent>
          <Grid container spacing={3} sx={{ mt: 1 }}>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                label="Cycle Name"
                placeholder="e.g., Annual Review 2025"
                value={newCycle.name}
                onChange={(e) => setNewCycle(prev => ({ ...prev, name: e.target.value }))}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <FormControl fullWidth>
                <InputLabel>Cycle Type</InputLabel>
                <Select
                  value={newCycle.cycleType}
                  label="Cycle Type"
                  onChange={(e) => setNewCycle(prev => ({ ...prev, cycleType: e.target.value as any }))}
                >
                  {Object.entries(cycleTypeLabels).map(([value, label]) => (
                    <MenuItem key={value} value={value}>{label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={12}>
              <TextField
                fullWidth
                multiline
                rows={2}
                label="Description"
                value={newCycle.description}
                onChange={(e) => setNewCycle(prev => ({ ...prev, description: e.target.value }))}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                type="date"
                label="Period Start"
                value={newCycle.periodStart}
                onChange={(e) => setNewCycle(prev => ({ ...prev, periodStart: e.target.value }))}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                type="date"
                label="Period End"
                value={newCycle.periodEnd}
                onChange={(e) => setNewCycle(prev => ({ ...prev, periodEnd: e.target.value }))}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Grid>
            <Grid size={12}>
              <Typography variant="subtitle2" gutterBottom>OKR Weight in Final Rating: {newCycle.okrWeight}%</Typography>
              <Slider
                value={newCycle.okrWeight}
                onChange={(_, value) => setNewCycle(prev => ({ ...prev, okrWeight: value as number }))}
                min={0}
                max={100}
                valueLabelDisplay="auto"
                marks={[
                  { value: 0, label: '0% (Competency only)' },
                  { value: 50, label: '50/50' },
                  { value: 100, label: '100% (OKR only)' }
                ]}
              />
            </Grid>
            <Grid size={12}>
              <Divider sx={{ my: 2 }} />
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>Settings</Typography>
              <Grid container spacing={2}>
                <Grid size={{ xs: 6 }}>
                  <FormControlLabel
                    control={<Switch checked={newCycle.settings.enableAiAssist} onChange={(e) => setNewCycle(prev => ({ ...prev, settings: { ...prev.settings, enableAiAssist: e.target.checked } }))} />}
                    label="Enable AI Assistance"
                  />
                </Grid>
                <Grid size={{ xs: 6 }}>
                  <FormControlLabel
                    control={<Switch checked={newCycle.settings.enableChat} onChange={(e) => setNewCycle(prev => ({ ...prev, settings: { ...prev.settings, enableChat: e.target.checked } }))} />}
                    label="Enable Chat/Discussion"
                  />
                </Grid>
                <Grid size={{ xs: 6 }}>
                  <FormControlLabel
                    control={<Switch checked={newCycle.settings.enablePeerFeedback} onChange={(e) => setNewCycle(prev => ({ ...prev, settings: { ...prev.settings, enablePeerFeedback: e.target.checked } }))} />}
                    label="Enable Peer Feedback"
                  />
                </Grid>
                <Grid size={{ xs: 6 }}>
                  <FormControlLabel
                    control={<Switch checked={newCycle.settings.requireSignOff} onChange={(e) => setNewCycle(prev => ({ ...prev, settings: { ...prev.settings, requireSignOff: e.target.checked } }))} />}
                    label="Require Employee Sign-off"
                  />
                </Grid>
              </Grid>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreateCycle}
            disabled={loading || !newCycle.name}
            startIcon={loading ? <CircularProgress size={16} /> : <Add />}
          >
            Create Cycle
          </Button>
        </DialogActions>
      </Dialog>

      {/* Launch Cycle Dialog */}
      <Dialog open={launchDialogOpen} onClose={() => setLaunchDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          Launch Cycle: {selectedCycle?.name}
        </DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>
            Select the employees to include in this appraisal cycle. Managers will be auto-assigned from IdP reporting lines.
            {employeesWithoutManager.length > 0 && (
              <Typography variant="body2" sx={{ mt: 1 }}>
                <Warning fontSize="small" sx={{ verticalAlign: 'middle', mr: 0.5 }} />
                {employeesWithoutManager.length} employee(s) have no assigned manager - HR Admin will be assigned as fallback.
              </Typography>
            )}
          </Alert>

          {loadingEmployees ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
              <CircularProgress />
            </Box>
          ) : (
            <>
              <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    {selectedEmployees.length} of {employees.length} employees selected
                  </Typography>
                  <Tabs
                    value={viewMode}
                    onChange={(_, v) => setViewMode(v)}
                    sx={{ minHeight: 32 }}
                  >
                    <Tab value="byManager" label="By Manager" sx={{ minHeight: 32, py: 0 }} />
                    <Tab value="list" label="List View" sx={{ minHeight: 32, py: 0 }} />
                  </Tabs>
                </Box>
                <Button
                  size="small"
                  onClick={() => setSelectedEmployees(
                    selectedEmployees.length === employees.length
                      ? []
                      : employees.map(e => e.userId)
                  )}
                >
                  {selectedEmployees.length === employees.length ? 'Deselect All' : 'Select All'}
                </Button>
              </Box>

              {viewMode === 'byManager' && managerGroups.length > 0 ? (
                <Box sx={{ maxHeight: 400, overflow: 'auto' }}>
                  {managerGroups.map((group) => (
                    <Card key={group.managerId} sx={{ mb: 2 }} variant="outlined">
                      <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Groups color="primary" fontSize="small" />
                            <Typography variant="subtitle2" fontWeight={600}>
                              {group.managerName}
                            </Typography>
                            <Chip label={`${group.directReports.length} reports`} size="small" />
                          </Box>
                          <Button
                            size="small"
                            onClick={() => {
                              const reportIds = group.directReports.map(r => r.userId);
                              const allSelected = reportIds.every(id => selectedEmployees.includes(id));
                              if (allSelected) {
                                setSelectedEmployees(prev => prev.filter(id => !reportIds.includes(id)));
                              } else {
                                setSelectedEmployees(prev => [...new Set([...prev, ...reportIds])]);
                              }
                            }}
                          >
                            {group.directReports.every(r => selectedEmployees.includes(r.userId)) ? 'Deselect Team' : 'Select Team'}
                          </Button>
                        </Box>
                        <Divider sx={{ my: 1 }} />
                        {group.directReports.map((report) => (
                          <Box
                            key={report.userId}
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              py: 0.5,
                              px: 1,
                              borderRadius: 1,
                              cursor: 'pointer',
                              '&:hover': { bgcolor: 'action.hover' }
                            }}
                            onClick={() => {
                              setSelectedEmployees(prev =>
                                prev.includes(report.userId)
                                  ? prev.filter(id => id !== report.userId)
                                  : [...prev, report.userId]
                              );
                            }}
                          >
                            <Checkbox
                              checked={selectedEmployees.includes(report.userId)}
                              size="small"
                              sx={{ p: 0.5, mr: 1 }}
                            />
                            <Box sx={{ flex: 1 }}>
                              <Typography variant="body2">{report.name}</Typography>
                              <Typography variant="caption" color="text.secondary">
                                {report.jobTitle || report.teamName || report.email}
                              </Typography>
                            </Box>
                          </Box>
                        ))}
                      </CardContent>
                    </Card>
                  ))}

                  {/* Employees without manager */}
                  {employeesWithoutManager.length > 0 && (
                    <Card sx={{ mb: 2, borderColor: 'warning.main' }} variant="outlined">
                      <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                          <Warning color="warning" fontSize="small" />
                          <Typography variant="subtitle2" fontWeight={600} color="warning.main">
                            No Manager Assigned (HR Admin will review)
                          </Typography>
                          <Chip label={`${employeesWithoutManager.length} employees`} size="small" color="warning" />
                        </Box>
                        <Divider sx={{ my: 1 }} />
                        {employeesWithoutManager.map((emp) => (
                          <Box
                            key={emp.userId}
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              py: 0.5,
                              px: 1,
                              borderRadius: 1,
                              cursor: 'pointer',
                              '&:hover': { bgcolor: 'action.hover' }
                            }}
                            onClick={() => {
                              setSelectedEmployees(prev =>
                                prev.includes(emp.userId)
                                  ? prev.filter(id => id !== emp.userId)
                                  : [...prev, emp.userId]
                              );
                            }}
                          >
                            <Checkbox
                              checked={selectedEmployees.includes(emp.userId)}
                              size="small"
                              sx={{ p: 0.5, mr: 1 }}
                            />
                            <Box sx={{ flex: 1 }}>
                              <Typography variant="body2">{emp.name}</Typography>
                              <Typography variant="caption" color="text.secondary">
                                {emp.jobTitle || emp.teamName || emp.email}
                              </Typography>
                            </Box>
                          </Box>
                        ))}
                      </CardContent>
                    </Card>
                  )}
                </Box>
              ) : (
                <TableContainer sx={{ maxHeight: 400 }}>
                  <Table stickyHeader size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell padding="checkbox">
                          <Checkbox
                            checked={selectedEmployees.length === employees.length && employees.length > 0}
                            indeterminate={selectedEmployees.length > 0 && selectedEmployees.length < employees.length}
                            onChange={(e) => setSelectedEmployees(
                              e.target.checked ? employees.map(emp => emp.userId) : []
                            )}
                          />
                        </TableCell>
                        <TableCell>Employee</TableCell>
                        <TableCell>Team / Role</TableCell>
                        <TableCell>Manager</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {employees.map((employee) => (
                        <TableRow
                          key={employee.userId}
                          hover
                          onClick={() => {
                            setSelectedEmployees(prev =>
                              prev.includes(employee.userId)
                                ? prev.filter(id => id !== employee.userId)
                                : [...prev, employee.userId]
                            );
                          }}
                          sx={{ cursor: 'pointer' }}
                        >
                          <TableCell padding="checkbox">
                            <Checkbox checked={selectedEmployees.includes(employee.userId)} />
                          </TableCell>
                          <TableCell>
                            <Box>
                              <Typography variant="body2" fontWeight={600}>
                                {employee.name}
                                {employee.isManager && (
                                  <Chip label="Manager" size="small" color="primary" sx={{ ml: 1 }} />
                                )}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">{employee.email}</Typography>
                            </Box>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2">{employee.teamName || employee.department || '-'}</Typography>
                            <Typography variant="caption" color="text.secondary">{employee.teamRole || employee.jobTitle || ''}</Typography>
                          </TableCell>
                          <TableCell>
                            {employee.managerName || (
                              <Chip label="Auto-assign" size="small" variant="outlined" color="warning" />
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLaunchDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleLaunchCycle}
            disabled={loading || selectedEmployees.length === 0}
            startIcon={loading ? <CircularProgress size={16} /> : <Rocket />}
            color="success"
          >
            Launch Cycle ({selectedEmployees.length} employees)
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar for messages */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
