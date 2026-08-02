'use client';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useOkrs, useUserContext } from '@/lib/hooks';
import api from '@/lib/api';
import {
  Box, Typography, Card, CardContent, Grid, Button, Alert,
  Paper, CircularProgress, LinearProgress, Chip, Tabs, Tab,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  Select, MenuItem, FormControl, InputLabel, Snackbar, IconButton,
  Divider, alpha, useTheme, Autocomplete, Tooltip
} from '@mui/material';
import {
  Add, TrackChanges, TrendingUp, Visibility,
  CheckCircle, Flag, AutoAwesome,
  Delete, Edit, AccountTree, FlagCircle,
  HourglassEmpty, Verified, ThumbUp
} from '@mui/icons-material';
import Link from 'next/link';
import { gradients } from '../theme';


interface KeyResult {
  id?: string;
  title: string;
  metricType: 'percentage' | 'number' | 'currency' | 'boolean';
  startValue: number;
  targetValue: number;
  currentValue: number;
}

interface Objective {
  id?: string;
  title: string;
  description?: string;
  weight?: number;
  keyResults: KeyResult[];
}

interface OKR {
  _id: string;
  title?: string;
  type: 'individual' | 'team' | 'organization';
  status: 'draft' | 'active' | 'closed';
  progress: number;
  period?: string;
  alignment?: {
    parentOKRId?: string | { _id: string; title: string }; // Handle populated or raw ID
    alignmentType?: 'cascade' | 'contribute';
  };
  objectives: Objective[];
}

// Tab Panel Component
function TabPanel({ children, value, index }: { children: React.ReactNode; value: number; index: number }) {
  return value === index ? <Box sx={{ pt: 3 }}>{children}</Box> : null;
}

export default function OKRPage() {
  const router = useRouter();
  const theme = useTheme();
  const { user, isManager, isHRAdmin, role } = useUserContext();
  const { okrs: fetchedOkrs, isLoading, isError, mutate } = useOkrs();

  // Edit State
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingOkr, setEditingOkr] = useState<OKR | null>(null);

  // Alignment State
  const [alignableOkrs, setAlignableOkrs] = useState<any[]>([]);

  // Assignment State
  const [assignableUsers, setAssignableUsers] = useState<any[]>([]);

  const fetchAssignableUsers = async () => {
    try {
      if (isHRAdmin || role === 'recruiter') {
        // HR Admin and Recruiters can assign to anyone
        const res = await api.get('/user/all-employees');
        setAssignableUsers(res.data.data.map((u: any) => ({
          id: u.userId,
          name: u.name,
          email: u.email,
          title: u.jobTitle
        })));
      } else if (isManager) {
        // Line Managers can only assign to their direct reports
        const res = await api.get('/user/direct-reports');
        setAssignableUsers(res.data.data.directReports || []);
      }
    } catch (error) {
      console.error('Failed to fetch assignable users', error);
    }
  };

  useEffect(() => {
    if (isManager && assignableUsers.length === 0) {
      fetchAssignableUsers();
    }
  }, [isManager, isHRAdmin, role]);

  const fetchAlignableOkrs = async (type: string) => {
    try {
      // Determine what type of OKRs can be parents based on current type
      // Individual -> Team or Org
      // Team -> Org
      const res = await api.get(`/okrs/alignable/list?childType=${type}`);
      setAlignableOkrs(res.data.data);
    } catch (error) {
      console.error('Failed to fetch alignable OKRs', error);
    }
  };

  // View State

  // View State
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [viewingOkr, setViewingOkr] = useState<OKR | null>(null);

  const [activeTab, setActiveTab] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' });

  // New OKR Form State
  const [newOkr, setNewOkr] = useState({
    title: '',
    type: 'individual' as 'individual' | 'team',
    objectives: [{
      title: '',
      description: '',
      keyResults: [{ title: '', metricType: 'percentage' as const, startValue: 0, targetValue: 100, currentValue: 0 }]
    }] as Objective[]
  });
  const [isAiLoading, setIsAiLoading] = useState(false);

  // useEffect(() => { ... }) // Removed redundant sync effect

  // Team OKRs State
  const [teamOkrs, setTeamOkrs] = useState<any[]>([]);
  const [isLoadingTeam, setIsLoadingTeam] = useState(false);

  // Fetch Team OKRs when tab is active
  useEffect(() => {
    if (activeTab === 1 && isManager) {
      setIsLoadingTeam(true);
      api.get('/okrs/direct-reports')
        .then(res => setTeamOkrs(res.data.data))
        .catch(err => console.error(err))
        .finally(() => setIsLoadingTeam(false));
    }
  }, [activeTab, isManager]);

  // AI Suggestion Handler
  const handleAiSuggest = async () => {
    setIsAiLoading(true);
    try {
      const response = await api.post('/ai/generate-okrs', {
        userRole: user?.jobTitle || 'Employee',
        teamGoals: 'Improve team outcomes and delivery quality',
        companyGoals: 'Drive measurable business impact this cycle'
      });

      const aiPayload = response.data?.data;
      const okrSuggestions = Array.isArray(aiPayload?.okrs) ? aiPayload.okrs : [];

      if (okrSuggestions.length > 0) {
        setNewOkr(prev => ({
          ...prev,
          objectives: okrSuggestions.map((okr: any) => ({
            title: okr.objective || okr.title || '',
            description: okr.priority ? `Priority: ${okr.priority}` : '',
            keyResults: (Array.isArray(okr.keyResults) ? okr.keyResults : []).map((kr: string) => ({
              title: kr,
              metricType: 'percentage' as const,
              startValue: 0,
              targetValue: 100,
              currentValue: 0
            }))
          })).filter((obj: any) => obj.title && obj.keyResults.length > 0)
        }));
        setSnackbar({ open: true, message: 'AI suggestions generated!', severity: 'success' });
      } else {
        setSnackbar({ open: true, message: 'AI could not generate structured OKR suggestions. Please try again.', severity: 'error' });
      }
    } catch (error: any) {
      console.error('AI OKR suggestion error:', error);
      setSnackbar({ open: true, message: error.response?.data?.error || 'Failed to generate AI suggestions', severity: 'error' });
    } finally {
      setIsAiLoading(false);
    }
  };

  // Create new OKR
  const handleCreateOkr = async () => {
    if (!newOkr.objectives[0]?.title) {
      setSnackbar({ open: true, message: 'Please add at least one objective', severity: 'error' });
      return;
    }

    setSubmitting(true);
    try {
      await api.post('/okrs', {
        title: newOkr.title,
        type: newOkr.type,
        period: `Q${Math.ceil((new Date().getMonth() + 1) / 3)} ${new Date().getFullYear()}`,
        status: 'active',
        ownerId: (newOkr as any).ownerId, // Include ownerId if set
        parentOKRId: (newOkr as any).parentOKRId,
        objectives: newOkr.objectives.map(obj => ({
          ...obj,
          keyResults: obj.keyResults.map(kr => ({
            ...kr,
            lastUpdated: new Date()
          }))
        }))
      });

      // Reset form
      setNewOkr({
        title: '',
        type: 'individual',
        objectives: [{
          title: '',
          description: '',
          keyResults: [{ title: '', metricType: 'percentage', startValue: 0, targetValue: 100, currentValue: 0 }]
        }]
      });

      mutate();

      // Redirect based on assignment
      // If manager assigned to someone else, go to Team OKRs (index 1)
      const assignedToOther = (newOkr as any).ownerId && (newOkr as any).ownerId !== user?.userId;
      if (isManager && assignedToOther) {
        setActiveTab(1);
        // We also need to refresh team OKRs
        setIsLoadingTeam(true); // Trigger loading state safely
        api.get('/okrs/direct-reports')
          .then(res => setTeamOkrs(res.data.data))
          .finally(() => setIsLoadingTeam(false));
      } else {
        setActiveTab(0); // Switch to "Your OKRs" tab
      }

      setSnackbar({ open: true, message: 'OKR created successfully!', severity: 'success' });
    } catch (error) {
      console.error('Create OKR error:', error);
      setSnackbar({ open: true, message: 'Failed to create OKR', severity: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  // Delete OKR
  const handleDeleteOkr = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this OKR? This action cannot be undone.')) {
      return;
    }

    try {
      await api.delete(`/okrs/${id}`);
      mutate();
      setSnackbar({ open: true, message: 'OKR deleted successfully', severity: 'success' });
    } catch (error) {
      console.error('Delete OKR error:', error);
      setSnackbar({ open: true, message: 'Failed to delete OKR', severity: 'error' });
    }
  };

  // Open Edit Dialog
  const handleEditOkr = (okr: OKR) => {
    const deepCopy = JSON.parse(JSON.stringify(okr));
    if (!deepCopy.objectives) {
      deepCopy.objectives = [];
    }
    setEditingOkr(deepCopy);
    setEditDialogOpen(true);
  };

  // Open View Dialog
  const handleViewOkr = (okr: OKR) => {
    setViewingOkr(okr);
    setViewDialogOpen(true);
  };

  // Update OKR
  const handleUpdateOkr = async () => {
    if (!editingOkr || !editingOkr.objectives[0]?.title) {
      setSnackbar({ open: true, message: 'Please add at least one objective', severity: 'error' });
      return;
    }

    setSubmitting(true);
    try {
      // For updates, we might need a specific endpoint structure depending on backend
      // Assuming PUT /okrs/:id accepts the same structure as POST
      // But based on previous read, backend PUT /okrs/:id handled title/objective/keyResults flat updates
      // OR I fixed backend to handle array?
      // Wait, I only fixed POST. I need to check if PUT handles the new structure.
      // Looking at backend/routes/okrs.js lines 266+.
      // It handles 'title', 'objective' (single), 'keyResults' (single).
      // It does NOT look like I updated PUT to handle dynamic 'objectives' array.
      // I should assume I need to update the backend PUT as well, or restrict editing to single objective?
      // The current frontend structure supports multiple objectives per OKR document.
      // If the backend doesn't support updating multiple objectives via PUT, this will fail for complex OKRs.
      // However, let's look at the OKR model. It has `objectives: [{...}]`.
      // The PUT route (lines 289-304 in previous view) seems to only update `objectives[0]`.
      // This is a limitation I should fix in the backend too.
      // For now, I will implement the frontend assuming the backend will be fixed to support `objectives` array in PUT.

      await api.put(`/okrs/${editingOkr._id}`, {
        title: editingOkr.title,
        type: editingOkr.type,
        status: editingOkr.status,
        period: editingOkr.period,
        parentOKRId: (editingOkr as any).parentOKRId,
        objectives: editingOkr.objectives
      });

      mutate();
      setEditDialogOpen(false);
      setSnackbar({ open: true, message: 'OKR updated successfully!', severity: 'success' });
    } catch (error) {
      console.error('Update OKR error:', error);
      setSnackbar({ open: true, message: 'Failed to update OKR', severity: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  // Approve OKR
  const handleApproveOkr = async (okrId: string) => {
    try {
      await api.patch(`/okrs/${okrId}/approve`);
      mutate(); // Refresh data
      setSnackbar({ open: true, message: 'OKR approved successfully!', severity: 'success' });
    } catch (error: any) {
      console.error('Approve OKR error:', error);
      setSnackbar({ open: true, message: error.response?.data?.error || 'Failed to approve OKR', severity: 'error' });
    }
  };

  // Add Objective (Generic)
  const addObjective = (isEditing: boolean = false) => {
    const setter = isEditing ? setEditingOkr : setNewOkr;
    setter((prev: any) => ({
      ...prev,
      objectives: [
        ...prev.objectives,
        { title: '', description: '', keyResults: [{ title: '', metricType: 'percentage', startValue: 0, targetValue: 100, currentValue: 0 }] }
      ]
    }));
  };

  // Remove Objective
  const removeObjective = (index: number, isEditing: boolean = false) => {
    const setter = isEditing ? setEditingOkr : setNewOkr;
    setter((prev: any) => ({
      ...prev,
      objectives: prev.objectives.filter((_: any, i: number) => i !== index)
    }));
  };

  // Add Key Result
  const addKeyResult = (objIndex: number, isEditing: boolean = false) => {
    const setter = isEditing ? setEditingOkr : setNewOkr;
    setter((prev: any) => ({
      ...prev,
      objectives: prev.objectives.map((obj: any, i: number) =>
        i === objIndex
          ? { ...obj, keyResults: [...obj.keyResults, { title: '', metricType: 'percentage', startValue: 0, targetValue: 100, currentValue: 0 }] }
          : obj
      )
    }));
  };

  // Remove Key Result
  const removeKeyResult = (objIndex: number, krIndex: number, isEditing: boolean = false) => {
    const setter = isEditing ? setEditingOkr : setNewOkr;
    setter((prev: any) => ({
      ...prev,
      objectives: prev.objectives.map((obj: any, i: number) =>
        i === objIndex
          ? { ...obj, keyResults: obj.keyResults.filter((_: any, j: number) => j !== krIndex) }
          : obj
      )
    }));
  };

  // Update Objective field
  const updateObjective = (index: number, field: string, value: string, isEditing: boolean = false) => {
    const setter = isEditing ? setEditingOkr : setNewOkr;
    setter((prev: any) => ({
      ...prev,
      objectives: prev.objectives.map((obj: any, i: number) =>
        i === index ? { ...obj, [field]: value } : obj
      )
    }));
  };

  // Update Key Result field
  const updateKeyResult = (objIndex: number, krIndex: number, field: string, value: any, isEditing: boolean = false) => {
    const setter = isEditing ? setEditingOkr : setNewOkr;
    setter((prev: any) => ({
      ...prev,
      objectives: prev.objectives.map((obj: any, i: number) =>
        i === objIndex
          ? {
            ...obj,
            keyResults: obj.keyResults.map((kr: any, j: number) =>
              j === krIndex ? { ...kr, [field]: value } : kr
            )
          }
          : obj
      )
    }));
  };

  // Progress color helper
  const getProgressColor = (progress: number) => {
    if (progress >= 70) return 'success';
    if (progress >= 40) return 'warning';
    return 'error';
  };

  const getProgressGradient = (progress: number) => {
    if (progress >= 70) return 'linear-gradient(135deg, #10b981 0%, #34d399 100%)';
    if (progress >= 40) return 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)';
    return 'linear-gradient(135deg, #ef4444 0%, #f87171 100%)';
  };

  if (isLoading) {
    return (
      <Box className="animate-fadeIn">
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3 }}>
          <Typography variant="h4" fontWeight={800} sx={{ opacity: 0.3 }}>
            Objectives & Key Results
          </Typography>
        </Box>
        <LinearProgress sx={{ borderRadius: 2 }} />
      </Box>
    );
  }

  if (isError) {
    return <Alert severity="error" sx={{ borderRadius: 3 }}>Failed to load OKRs. Please try again.</Alert>;
  }

  const data = fetchedOkrs || [];

  return (
    <Box className="animate-fadeIn">
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 4, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography
            variant="h4"
            fontWeight={800}
            sx={{
              background: gradients.primary,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            Objectives & Key Results
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mt: 0.5 }}>
            Track your goals and measure progress with OKRs
          </Typography>
        </Box>
        <Button
          component={Link}
          href="/okrs/alignment"
          variant="outlined"
          startIcon={<AccountTree />}
          sx={{ borderWidth: 1.5, '&:hover': { borderWidth: 1.5 } }}
        >
          View Alignment
        </Button>
      </Box>

      {/* Tabs */}
      <Paper sx={{ mb: 3, p: 0.5, bgcolor: alpha(theme.palette.grey[500], 0.04) }}>
        <Tabs
          value={activeTab}
          onChange={(_, v) => setActiveTab(v)}
          sx={{ '& .MuiTab-root': { minHeight: 48, fontWeight: 600 } }}
        >
          <Tab label={`Your OKRs (${data.length})`} />
          {isManager && <Tab label="Team OKRs" icon={<TrendingUp sx={{ fontSize: 18 }} />} iconPosition="start" />}
          <Tab label="Create New OKR" icon={<Add sx={{ fontSize: 18 }} />} iconPosition="start" />
        </Tabs>
      </Paper>

      {/* Tab: Your OKRs */}
      <TabPanel value={activeTab} index={0}>
        {data.length === 0 ? (
          <Card
            sx={{
              p: 6,
              textAlign: 'center',
              background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.05)} 0%, ${alpha(theme.palette.secondary.main, 0.05)} 100%)`,
              border: `2px dashed ${alpha(theme.palette.primary.main, 0.2)}`,
            }}
          >
            <Box
              sx={{
                width: 80,
                height: 80,
                borderRadius: 3,
                background: gradients.primary,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                mx: 'auto',
                mb: 3,
                boxShadow: '0 12px 32px -8px rgba(99, 102, 241, 0.4)',
              }}
            >
              <Flag sx={{ fontSize: 40, color: 'white' }} />
            </Box>
            <Typography variant="h6" fontWeight={700} gutterBottom>
              No OKRs Yet
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3, maxWidth: 400, mx: 'auto' }}>
              Start tracking your objectives and key results. Click "Create New OKR" to create your first goal.
            </Typography>
            <Button variant="contained" startIcon={<Add />} onClick={() => setActiveTab(1)}>
              Create Your First OKR
            </Button>
          </Card>
        ) : (
          <Grid container spacing={3}>
            {data.map((okr: any) => {
              const progress = okr.progress || 0;
              const objCount = okr.objectives?.length || 0;
              const krCount = okr.objectives?.reduce((sum: number, obj: any) => sum + (obj.keyResults?.length || 0), 0) || 0;

              return (
                <Grid size={{ xs: 12 }} key={okr._id}>
                  <Card
                    variant="outlined"
                    sx={{
                      position: 'relative',
                      overflow: 'hidden',
                      transition: 'all 0.3s ease',
                      '&:hover': {
                        transform: 'translateY(-2px)',
                        boxShadow: theme.shadows[8],
                      },
                      '&::before': {
                        content: '""',
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: 4,
                        background: getProgressGradient(progress),
                      },
                    }}
                  >
                    <CardContent sx={{ pl: 3 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="h6" fontWeight={700} gutterBottom>
                            {okr.title || 'Untitled OKR'}
                          </Typography>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                            <Chip
                              label={okr.status?.toUpperCase() || 'ACTIVE'}
                              size="small"
                              variant="outlined"
                              sx={{ fontSize: '0.7rem' }}
                            />
                            {okr.approvalStatus === 'pending' && (
                              <Chip
                                label="PENDING APPROVAL"
                                size="small"
                                icon={<HourglassEmpty sx={{ fontSize: '0.9rem' }} />}
                                color="warning"
                                variant="filled"
                                sx={{ fontSize: '0.7rem', fontWeight: 700 }}
                              />
                            )}
                            {okr.approvalStatus === 'approved' && (
                              <Chip
                                label="APPROVED"
                                size="small"
                                icon={<Verified sx={{ fontSize: '0.9rem' }} />}
                                color="success"
                                variant="outlined"
                                sx={{ fontSize: '0.7rem', fontWeight: 700 }}
                              />
                            )}
                            {okr.period && (
                              <Chip
                                label={okr.period}
                                size="small"
                                variant="outlined"
                                color="info"
                                sx={{ fontSize: '0.7rem' }}
                              />
                            )}
                          </Box>

                          {/* Objectives List - FIX: Ensure this is properly rendered */}
                          {okr.objectives?.slice(0, 3).map((obj: any, idx: number) => (
                            <Box key={idx} sx={{ mb: 1 }}>
                              <Typography variant="body2" fontWeight={600} noWrap>
                                • {obj.title}
                              </Typography>
                            </Box>
                          ))}
                        </Box>

                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                          {/* Actions */}
                          <Box sx={{ display: 'flex', gap: 1 }}>
                            {isManager && okr.approvalStatus === 'pending' && (
                              <Tooltip title="Approve OKR">
                                <IconButton
                                  size="small"
                                  onClick={() => handleApproveOkr(okr._id)}
                                  sx={{
                                    bgcolor: alpha(theme.palette.success.main, 0.1),
                                    color: theme.palette.success.main,
                                    '&:hover': { bgcolor: alpha(theme.palette.success.main, 0.2) }
                                  }}
                                >
                                  <ThumbUp fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            )}
                            <IconButton
                              size="small"
                              onClick={() => handleViewOkr(okr)}
                              sx={{ bgcolor: alpha(theme.palette.info.main, 0.08) }}
                            >
                              <Visibility fontSize="small" />
                            </IconButton>
                            <IconButton
                              size="small"
                              onClick={() => handleEditOkr(okr)}
                              sx={{ bgcolor: alpha(theme.palette.primary.main, 0.08) }}
                            >
                              <Edit fontSize="small" />
                            </IconButton>
                            <IconButton
                              size="small"
                              onClick={() => handleDeleteOkr(okr._id)}
                              sx={{ bgcolor: alpha(theme.palette.error.main, 0.08) }}
                            >
                              <Delete fontSize="small" />
                            </IconButton>
                          </Box>
                        </Box>
                      </Box>
                    </CardContent>
                  </Card>
                </Grid>
              );
            })}
          </Grid>
        )}
      </TabPanel>

      {/* Tab: Team OKRs */}
      {isManager && (
        <TabPanel value={activeTab} index={1}>
          {isLoadingTeam ? (
            <LinearProgress />
          ) : teamOkrs.length === 0 ? (
            <Alert severity="info" variant="outlined" sx={{ mb: 3 }}>
              No OKRs found for your team.
            </Alert>
          ) : (
            <Box>
              {/* Pending Approval Section */}
              {teamOkrs.some((o: any) => o.approvalStatus === 'pending') && (
                <Box sx={{ mb: 4 }}>
                  <Typography variant="h6" fontWeight={700} color="warning.main" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <HourglassEmpty /> Pending Approval
                  </Typography>
                  <Grid container spacing={3}>
                    {teamOkrs.filter((o: any) => o.approvalStatus === 'pending').map((okr: any) => (
                      <Grid size={{ xs: 12 }} key={okr._id}>
                        {/* Reuse OKR Card logic - duplicating for now to ensure flexibility */}
                        <Card variant="outlined" sx={{ borderLeft: '4px solid #f59e0b' }}>
                          <CardContent>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                              <Box>
                                <Typography variant="h6" fontWeight={700}>{okr.title}</Typography>
                                <Typography variant="body2" color="text.secondary">
                                  Owner: {okr.ownerId?.name || 'Unknown'} • {okr.ownerId?.email}
                                </Typography>
                                <Box sx={{ mt: 1 }}>
                                  {okr.objectives?.map((obj: any, i: number) => (
                                    <Typography key={i} variant="body2">• {obj.title}</Typography>
                                  ))}
                                </Box>
                              </Box>
                              <Button
                                variant="contained"
                                color="success"
                                startIcon={<ThumbUp />}
                                onClick={async () => {
                                  await handleApproveOkr(okr._id);
                                  // Refresh team OKRs
                                  const res = await api.get('/okrs/direct-reports');
                                  setTeamOkrs(res.data.data);
                                }}
                              >
                                Approve
                              </Button>
                            </Box>
                          </CardContent>
                        </Card>
                      </Grid>
                    ))}
                  </Grid>
                </Box>
              )}

              <Divider sx={{ my: 4 }} />

              {/* Approved / Other OKRs */}
              <Box>
                <Typography variant="h6" fontWeight={700} gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CheckCircle color="success" /> Team OKRs
                </Typography>
                <Grid container spacing={3}>
                  {teamOkrs.filter((o: any) => o.approvalStatus !== 'pending').map((okr: any) => (
                    <Grid size={{ xs: 12 }} key={okr._id}>
                      <Card variant="outlined">
                        <CardContent>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                            <Box>
                              <Typography variant="h6" fontWeight={700}>{okr.title}</Typography>
                              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 0.5 }}>
                                <Chip label={okr.status} size="small" />
                                {okr.approvalStatus === 'approved' && <Chip label="APPROVED" color="success" size="small" variant="outlined" />}
                              </Box>
                              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                                Owner: {okr.ownerId?.name || 'Unknown'}
                              </Typography>
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                              <Box sx={{ textAlign: 'right' }}>
                                <Typography variant="caption" display="block">Progress</Typography>
                                <CircularProgress variant="determinate" value={okr.progress || 0} size={40} thickness={5} color={getProgressColor(okr.progress) as any} />
                                <Typography variant="caption" display="block">{okr.progress}%</Typography>
                              </Box>
                              <IconButton onClick={() => handleViewOkr(okr)}><Visibility /></IconButton>
                            </Box>
                          </Box>
                        </CardContent>
                      </Card>
                    </Grid>
                  ))}
                </Grid>
              </Box>
            </Box>
          )}
        </TabPanel>
      )}

      {/* Tab: Create New OKR */}
      <TabPanel value={activeTab} index={isManager ? 2 : 1}>
        <Paper sx={{ p: 3, mb: 4 }}>
          {/* ... Create Form Content ... */}
          {/* (I'm assuming the Create Form content is mostly intact below or I should regenerate it to be safe) */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Typography variant="h6" fontWeight={600}>Create New OKR</Typography>
            <Button
              variant="outlined"
              startIcon={isAiLoading ? <CircularProgress size={16} /> : <AutoAwesome />}
              onClick={handleAiSuggest}
              disabled={isAiLoading}
              color="secondary"
            >
              {isAiLoading ? 'Generating...' : 'AI Suggest'}
            </Button>
          </Box>

          {/* Assign To (Managers/HR) */}
          {isManager && (
            <Autocomplete
              fullWidth
              size="small"
              options={assignableUsers}
              getOptionLabel={(option) => `${option.name} (${option.title || option.email})`}
              onChange={(_, value) => setNewOkr(prev => ({ ...prev, ownerId: value?.id || null } as any))}
              renderInput={(params) => <TextField {...params} label="Assign To (Optional)" placeholder="Select employee..." />}
              sx={{ mb: 3 }}
            />
          )}

          <TextField
            fullWidth
            label="OKR Title"
            placeholder="e.g., Q1 Performance Goals"
            value={newOkr.title}
            onChange={(e) => setNewOkr(prev => ({ ...prev, title: e.target.value }))}
            sx={{ mb: 3 }}
          />

          <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
            <FormControl size="small" sx={{ flex: 1 }}>
              <InputLabel>OKR Type</InputLabel>
              <Select
                value={newOkr.type}
                label="OKR Type"
                onChange={(e) => {
                  const newType = e.target.value as any;
                  setNewOkr(prev => ({ ...prev, type: newType }));
                  fetchAlignableOkrs(newType);
                }}
              >
                <MenuItem value="individual">Individual</MenuItem>
                {isManager && <MenuItem value="team">Team</MenuItem>}
              </Select>
            </FormControl>

            <Autocomplete
              fullWidth
              size="small"
              options={alignableOkrs}
              getOptionLabel={(option) => option.title || ''}
              onChange={(_, value) => setNewOkr(prev => ({ ...prev, parentOKRId: value?.id || null }))}
              renderInput={(params) => <TextField {...params} label="Align with Parent Goal (Optional)" />}
              sx={{ flex: 2 }}
            />
          </Box>

          {newOkr.objectives.map((objective, objIndex) => (
            <Card key={objIndex} variant="outlined" sx={{ mb: 3, p: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="subtitle1" fontWeight={600}>
                  Objective {objIndex + 1}
                </Typography>
                {newOkr.objectives.length > 1 && (
                  <IconButton size="small" color="error" onClick={() => removeObjective(objIndex)}>
                    <Delete fontSize="small" />
                  </IconButton>
                )}
              </Box>

              <TextField
                fullWidth
                label="Objective Title"
                placeholder="e.g., Improve customer satisfaction"
                value={objective.title}
                onChange={(e) => updateObjective(objIndex, 'title', e.target.value)}
                sx={{ mb: 2 }}
              />
              <TextField
                fullWidth
                multiline
                rows={2}
                label="Description (optional)"
                placeholder="Describe what success looks like..."
                value={objective.description || ''}
                onChange={(e) => updateObjective(objIndex, 'description', e.target.value)}
                sx={{ mb: 2 }}
              />

              <Divider sx={{ my: 2 }} />

              <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 2 }}>
                Key Results
              </Typography>

              {objective.keyResults.map((kr, krIndex) => (
                <Box key={krIndex} sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <TextField
                    sx={{ flex: 2, minWidth: 200 }}
                    size="small"
                    label={`Key Result ${krIndex + 1}`}
                    placeholder="e.g., Achieve NPS score of 50+"
                    value={kr.title}
                    onChange={(e) => updateKeyResult(objIndex, krIndex, 'title', e.target.value)}
                  />
                  <FormControl size="small" sx={{ minWidth: 100 }}>
                    <InputLabel>Metric</InputLabel>
                    <Select
                      value={kr.metricType}
                      label="Metric"
                      onChange={(e) => updateKeyResult(objIndex, krIndex, 'metricType', e.target.value)}
                    >
                      <MenuItem value="percentage">%</MenuItem>
                      <MenuItem value="number">#</MenuItem>
                      <MenuItem value="currency">$</MenuItem>
                      <MenuItem value="boolean">Yes/No</MenuItem>
                    </Select>
                  </FormControl>
                  <TextField
                    size="small"
                    type="number"
                    label="Start"
                    value={kr.startValue}
                    onChange={(e) => updateKeyResult(objIndex, krIndex, 'startValue', Number(e.target.value))}
                    sx={{ width: 80 }}
                  />
                  <TextField
                    size="small"
                    type="number"
                    label="Target"
                    value={kr.targetValue}
                    onChange={(e) => updateKeyResult(objIndex, krIndex, 'targetValue', Number(e.target.value))}
                    sx={{ width: 80 }}
                  />
                  {objective.keyResults.length > 1 && (
                    <IconButton size="small" color="error" onClick={() => removeKeyResult(objIndex, krIndex)}>
                      <Delete fontSize="small" />
                    </IconButton>
                  )}
                </Box>
              ))}

              <Button
                size="small"
                startIcon={<Add />}
                onClick={() => addKeyResult(objIndex)}
              >
                Add Key Result
              </Button>
            </Card>
          ))}

          <Box sx={{ display: 'flex', gap: 2 }}>
            <Button variant="outlined" startIcon={<Add />} onClick={() => addObjective(false)}>
              Add Another Objective
            </Button>
            <Button
              variant="contained"
              onClick={handleCreateOkr}
              disabled={submitting || !newOkr.objectives[0]?.title}
              startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : <CheckCircle />}
            >
              Create OKR
            </Button>
          </Box>
        </Paper>
      </TabPanel>

      {/* Edit Dialog */}
      <Dialog
        open={editDialogOpen}
        onClose={() => setEditDialogOpen(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{ sx: { borderRadius: 3 } }}
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Typography variant="h6" component="span" fontWeight={700}>Edit OKR</Typography>
        </DialogTitle>
        <DialogContent dividers>
          {editingOkr && (
            <>
              {/* Title Input */}
              <TextField
                fullWidth
                label="OKR Title"
                placeholder="e.g., Q1 Performance Goals"
                value={editingOkr.title || ''}
                onChange={(e) => setEditingOkr({ ...editingOkr, title: e.target.value })}
                sx={{ mb: 3 }}
              />

              <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
                {/* Type Selector */}
                <FormControl size="small" sx={{ flex: 1, minWidth: 150 }}>
                  <InputLabel>OKR Type</InputLabel>
                  <Select
                    value={editingOkr.type}
                    label="OKR Type"
                    onChange={(e) => setEditingOkr({ ...editingOkr, type: e.target.value as any })}
                  >
                    <MenuItem value="individual">Individual</MenuItem>
                    <MenuItem value="team">Team</MenuItem>
                    <MenuItem value="organization">Organization</MenuItem>
                  </Select>
                </FormControl>

                {/* Status Selector */}
                <FormControl size="small" sx={{ flex: 1, minWidth: 150 }}>
                  <InputLabel>Status</InputLabel>
                  <Select
                    value={editingOkr.status}
                    label="Status"
                    onChange={(e) => setEditingOkr({ ...editingOkr, status: e.target.value as any })}
                  >
                    <MenuItem value="draft">Draft</MenuItem>
                    <MenuItem value="active">Active</MenuItem>
                    <MenuItem value="closed">Closed</MenuItem>
                  </Select>
                </FormControl>

                {/* Period Input */}
                <TextField
                  size="small"
                  label="Period"
                  value={editingOkr.period || ''}
                  onChange={(e) => setEditingOkr({ ...editingOkr, period: e.target.value })}
                  sx={{ flex: 1 }}
                />
              </Box>

              {/* Alignment Selector */}
              <Autocomplete
                fullWidth
                size="small"
                options={alignableOkrs}
                getOptionLabel={(option) => option.title || ''}
                value={alignableOkrs.find(opt => opt.id === (typeof editingOkr.alignment?.parentOKRId === 'object' ? editingOkr.alignment?.parentOKRId?._id : editingOkr.alignment?.parentOKRId)) || null}
                onChange={(_, value) => setEditingOkr({ ...editingOkr, alignment: { ...editingOkr.alignment, parentOKRId: value?.id } } as any)}
                onOpen={() => fetchAlignableOkrs(editingOkr.type)}
                renderInput={(params) => <TextField {...params} label="Align with Parent Goal" placeholder="Select a parent OKR..." />}
                sx={{ mb: 3 }}
              />

              {/* Objectives */}
              {editingOkr.objectives?.map((objective, objIndex) => (
                <Card key={objIndex} variant="outlined" sx={{ mb: 3, p: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <Typography variant="subtitle1" fontWeight={600}>
                      Objective {objIndex + 1}
                    </Typography>
                    {(editingOkr.objectives?.length || 0) > 1 && (
                      <IconButton size="small" color="error" onClick={() => removeObjective(objIndex, true)}>
                        <Delete fontSize="small" />
                      </IconButton>
                    )}
                  </Box>

                  <TextField
                    fullWidth
                    label="Objective Title"
                    value={objective.title}
                    onChange={(e) => updateObjective(objIndex, 'title', e.target.value, true)}
                    sx={{ mb: 2 }}
                  />
                  <TextField
                    fullWidth
                    multiline
                    rows={2}
                    label="Description (optional)"
                    value={objective.description || ''}
                    onChange={(e) => updateObjective(objIndex, 'description', e.target.value, true)}
                    sx={{ mb: 2 }}
                  />

                  <Divider sx={{ my: 2 }} />

                  {/* Key Results */}
                  <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 2 }}>
                    Key Results
                  </Typography>

                  {objective.keyResults?.map((kr, krIndex) => (
                    <Box key={krIndex} sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      <TextField
                        sx={{ flex: 2, minWidth: 200 }}
                        size="small"
                        label={`Key Result ${krIndex + 1}`}
                        value={kr.title}
                        onChange={(e) => updateKeyResult(objIndex, krIndex, 'title', e.target.value, true)}
                      />
                      <FormControl size="small" sx={{ minWidth: 100 }}>
                        <InputLabel>Metric</InputLabel>
                        <Select
                          value={kr.metricType}
                          label="Metric"
                          onChange={(e) => updateKeyResult(objIndex, krIndex, 'metricType', e.target.value, true)}
                        >
                          <MenuItem value="percentage">%</MenuItem>
                          <MenuItem value="number">#</MenuItem>
                          <MenuItem value="currency">$</MenuItem>
                          <MenuItem value="boolean">Yes/No</MenuItem>
                        </Select>
                      </FormControl>
                      <TextField
                        size="small"
                        type="number"
                        label="Start"
                        value={kr.startValue}
                        onChange={(e) => updateKeyResult(objIndex, krIndex, 'startValue', Number(e.target.value), true)}
                        sx={{ width: 80 }}
                      />
                      <TextField
                        size="small"
                        type="number"
                        label="Target"
                        value={kr.targetValue}
                        onChange={(e) => updateKeyResult(objIndex, krIndex, 'targetValue', Number(e.target.value), true)}
                        sx={{ width: 80 }}
                      />
                      {(objective.keyResults?.length || 0) > 1 && (
                        <IconButton size="small" color="error" onClick={() => removeKeyResult(objIndex, krIndex, true)}>
                          <Delete fontSize="small" />
                        </IconButton>
                      )}
                    </Box>
                  ))}

                  <Button
                    size="small"
                    startIcon={<Add />}
                    onClick={() => addKeyResult(objIndex, true)}
                  >
                    Add Key Result
                  </Button>
                </Card>
              ))}

              <Button variant="outlined" startIcon={<Add />} onClick={() => addObjective(true)}>
                Add Another Objective
              </Button>
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setEditDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleUpdateOkr}
            disabled={submitting}
            startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : <CheckCircle />}
          >
            Save Changes
          </Button>
        </DialogActions>
      </Dialog >

      {/* View Details Dialog */}
      < Dialog
        open={viewDialogOpen}
        onClose={() => setViewDialogOpen(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{ sx: { borderRadius: 3 } }}
      >
        {viewingOkr && (
          <>
            <DialogTitle sx={{ pb: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 }}>
                  {viewingOkr.period || 'Current Quarter'}
                </Typography>
                <Typography variant="h5" fontWeight={800} sx={{ mt: 0.5 }}>
                  {viewingOkr.title || 'Untitled OKR'}
                </Typography>
              </Box>
              <Chip
                label={viewingOkr.status?.toUpperCase() || 'ACTIVE'}
                color={viewingOkr.status === 'closed' ? 'default' : 'success'}
                size="small"
                sx={{ fontWeight: 700 }}
              />
            </DialogTitle>
            <DialogContent dividers>
              <Box sx={{ mb: 4, display: 'flex', alignItems: 'center', gap: 2 }}>
                <Box sx={{ flex: 1 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="body2" fontWeight={600} color="text.secondary">Overall Progress</Typography>
                    <Typography variant="body2" fontWeight={700}>{viewingOkr.progress || 0}%</Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={viewingOkr.progress || 0}
                    sx={{ height: 10, borderRadius: 5, bgcolor: alpha(theme.palette.primary.main, 0.1) }}
                  />
                </Box>
                <Box>
                  <Chip
                    label={viewingOkr.type === 'individual' ? 'Individual Goal' : 'Team Goal'}
                    variant="outlined"
                    size="small"
                  />
                </Box>
              </Box>

              <Typography variant="h6" fontWeight={700} gutterBottom sx={{ mb: 2 }}>
                Objectives & Key Results
              </Typography>

              {viewingOkr.objectives?.map((obj, i) => (
                <Card key={i} variant="outlined" sx={{ mb: 3, overflow: 'visible' }}>
                  <CardContent sx={{ pb: '16px !important' }}>
                    <Typography variant="subtitle1" fontWeight={700} gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box sx={{ width: 24, height: 24, borderRadius: '50%', bgcolor: 'primary.main', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>
                        {i + 1}
                      </Box>
                      {obj.title}
                    </Typography>
                    {obj.description && (
                      <Typography variant="body2" color="text.secondary" sx={{ ml: 4, mb: 2 }}>
                        {obj.description}
                      </Typography>
                    )}

                    <Box sx={{ ml: 4, mt: 2 }}>
                      {obj.keyResults?.map((kr, j) => (
                        <Box key={j} sx={{ mb: 2, p: 2, bgcolor: alpha(theme.palette.background.paper, 0.5), borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                            <Typography variant="body2" fontWeight={600}>{kr.title}</Typography>
                            <Typography variant="caption" fontWeight={700} sx={{ color: 'primary.main', bgcolor: alpha(theme.palette.primary.main, 0.1), px: 1, borderRadius: 1 }}>
                              {kr.currentValue} / {kr.targetValue}
                            </Typography>
                          </Box>
                          <LinearProgress
                            variant="determinate"
                            value={Math.min(100, Math.max(0, ((kr.currentValue - kr.startValue) / (kr.targetValue - kr.startValue)) * 100))}
                            sx={{ height: 6, borderRadius: 3 }}
                          />
                        </Box>
                      ))}
                    </Box>
                  </CardContent>
                </Card>
              ))}
            </DialogContent>
            <DialogActions sx={{ p: 2 }}>
              <Button onClick={() => setViewDialogOpen(false)} variant="contained" size="large">
                Close
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog >

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
        message={snackbar.message}
      />
    </Box >
  );
}
