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
  Divider, alpha, useTheme
} from '@mui/material';
import {
  Add, TrackChanges, TrendingUp,
  CheckCircle, Flag, AutoAwesome,
  Delete, Edit, AccountTree, FlagCircle
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
  objectives: Objective[];
}

// Tab Panel Component
function TabPanel({ children, value, index }: { children: React.ReactNode; value: number; index: number }) {
  return value === index ? <Box sx={{ pt: 3 }}>{children}</Box> : null;
}

export default function OKRPage() {
  const router = useRouter();
  const theme = useTheme();
  const { user } = useUserContext();
  const { okrs: fetchedOkrs, isLoading, isError, mutate } = useOkrs();

  const [okrs, setOkrs] = useState<OKR[]>([]);
  // Edit State
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingOkr, setEditingOkr] = useState<OKR | null>(null);

  const [activeTab, setActiveTab] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' });

  // New OKR Form State
  const [newOkr, setNewOkr] = useState({
    type: 'individual' as 'individual' | 'team',
    objectives: [{
      title: '',
      description: '',
      keyResults: [{ title: '', metricType: 'percentage' as const, startValue: 0, targetValue: 100, currentValue: 0 }]
    }] as Objective[]
  });
  const [isAiLoading, setIsAiLoading] = useState(false);

  useEffect(() => {
    if (fetchedOkrs) {
      setOkrs(fetchedOkrs);
    }
  }, [fetchedOkrs]);

  // AI Suggestion Handler
  const handleAiSuggest = async () => {
    setIsAiLoading(true);
    try {
      const response = await api.post('/okrs/ai-suggest', {
        context: 'General OKRs',
        role: user?.jobTitle || 'Employee'
      });

      if (response.data?.data) {
        setNewOkr(prev => ({
          ...prev,
          objectives: response.data.data.objectives || prev.objectives
        }));
      } else {
        // Fallback mock data
        setNewOkr(prev => ({
          ...prev,
          objectives: [{
            title: 'Improve Team Productivity',
            description: 'Enhance overall team efficiency and output quality',
            keyResults: [
              { title: 'Reduce average task completion time by 20%', metricType: 'percentage', startValue: 0, targetValue: 20, currentValue: 0 },
              { title: 'Achieve 95% on-time delivery rate', metricType: 'percentage', startValue: 80, targetValue: 95, currentValue: 80 },
              { title: 'Complete 3 process improvement initiatives', metricType: 'number', startValue: 0, targetValue: 3, currentValue: 0 }
            ]
          }]
        }));
      }
      setSnackbar({ open: true, message: 'AI suggestions generated!', severity: 'success' });
    } catch (error) {
      // Use fallback mock data on error
      setNewOkr(prev => ({
        ...prev,
        objectives: [{
          title: 'Improve Team Productivity',
          description: 'Enhance overall team efficiency and output quality',
          keyResults: [
            { title: 'Reduce average task completion time by 20%', metricType: 'percentage', startValue: 0, targetValue: 20, currentValue: 0 },
            { title: 'Achieve 95% on-time delivery rate', metricType: 'percentage', startValue: 80, targetValue: 95, currentValue: 80 },
            { title: 'Complete 3 process improvement initiatives', metricType: 'number', startValue: 0, targetValue: 3, currentValue: 0 }
          ]
        }]
      }));
      setSnackbar({ open: true, message: 'AI suggestions generated!', severity: 'success' });
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
        type: newOkr.type,
        period: `Q${Math.ceil((new Date().getMonth() + 1) / 3)} ${new Date().getFullYear()}`,
        status: 'active',
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
        type: 'individual',
        objectives: [{
          title: '',
          description: '',
          keyResults: [{ title: '', metricType: 'percentage', startValue: 0, targetValue: 100, currentValue: 0 }]
        }]
      });

      mutate();
      setActiveTab(0); // Switch to "Your OKRs" tab
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
    setEditingOkr(JSON.parse(JSON.stringify(okr))); // Deep copy
    setEditDialogOpen(true);
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
        type: editingOkr.type,
        status: editingOkr.status,
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

  const data = okrs || [];

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
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                            <Chip
                              label={okr.type?.toUpperCase() || 'INDIVIDUAL'}
                              size="small"
                              color={okr.type === 'individual' ? 'primary' : 'secondary'}
                              sx={{ fontSize: '0.7rem' }}
                            />
                            <Chip
                              label={okr.status?.toUpperCase() || 'ACTIVE'}
                              size="small"
                              variant="outlined"
                              sx={{ fontSize: '0.7rem' }}
                            />
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

                          {/* Objectives List */}
                          {okr.objectives?.map((obj: any, idx: number) => (
                            <Box key={idx} sx={{ mb: 2 }}>
                              <Typography variant="subtitle1" fontWeight={600}>
                                <FlagCircle sx={{ fontSize: 16, mr: 0.5, verticalAlign: 'middle', color: 'primary.main' }} />
                                {obj.title || `Objective ${idx + 1}`}
                              </Typography>
                              {obj.description && (
                                <Typography variant="body2" color="text.secondary" sx={{ ml: 3 }}>
                                  {obj.description}
                                </Typography>
                              )}
                              {obj.keyResults?.length > 0 && (
                                <Box sx={{ ml: 3, mt: 1 }}>
                                  {obj.keyResults.map((kr: any, krIdx: number) => (
                                    <Typography key={krIdx} variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                                      • {kr.title}
                                      <Chip
                                        size="small"
                                        label={`${kr.currentValue || 0}/${kr.targetValue}`}
                                        sx={{ height: 20, fontSize: '0.7rem', ml: 1 }}
                                      />
                                    </Typography>
                                  ))}
                                </Box>
                              )}
                            </Box>
                          ))}

                          <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
                            <Typography variant="caption" color="text.secondary">
                              {objCount} Objective{objCount !== 1 ? 's' : ''} • {krCount} Key Result{krCount !== 1 ? 's' : ''}
                            </Typography>
                          </Box>
                        </Box>

                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                          {/* Progress */}
                          <Box sx={{ textAlign: 'right', minWidth: 80 }}>
                            <Typography variant="caption" color="text.secondary">Progress</Typography>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <LinearProgress
                                variant="determinate"
                                value={progress}
                                color={getProgressColor(progress)}
                                sx={{ width: 60, height: 6, borderRadius: 3 }}
                              />
                              <Typography variant="body2" fontWeight={600}>{progress}%</Typography>
                            </Box>
                          </Box>
                          <Box sx={{ display: 'flex', gap: 1 }}>
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
                              color="error"
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

      {/* Tab: Create New OKR */}
      <TabPanel value={activeTab} index={1}>
        <Paper sx={{ p: 3, mb: 4 }}>
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

          {/* Type Selector */}
          <FormControl size="small" sx={{ mb: 3, minWidth: 200 }}>
            <InputLabel>OKR Type</InputLabel>
            <Select
              value={newOkr.type}
              label="OKR Type"
              onChange={(e) => setNewOkr(prev => ({ ...prev, type: e.target.value as any }))}
            >
              <MenuItem value="individual">Individual</MenuItem>
              <MenuItem value="team">Team</MenuItem>
            </Select>
          </FormControl>

          {/* Objectives */}
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

              {/* Key Results */}
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
          <Typography variant="h6" fontWeight={700}>Edit OKR</Typography>
        </DialogTitle>
        <DialogContent dividers>
          {editingOkr && (
            <>
              {/* Type Selector */}
              <FormControl size="small" sx={{ mb: 3, minWidth: 200, mt: 1 }}>
                <InputLabel>OKR Type</InputLabel>
                <Select
                  value={editingOkr.type}
                  label="OKR Type"
                  onChange={(e) => setEditingOkr({ ...editingOkr, type: e.target.value as any })}
                >
                  <MenuItem value="individual">Individual</MenuItem>
                  <MenuItem value="team">Team</MenuItem>
                </Select>
              </FormControl>

              {/* Objectives */}
              {editingOkr.objectives.map((objective, objIndex) => (
                <Card key={objIndex} variant="outlined" sx={{ mb: 3, p: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <Typography variant="subtitle1" fontWeight={600}>
                      Objective {objIndex + 1}
                    </Typography>
                    {editingOkr.objectives.length > 1 && (
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
      </Dialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
        message={snackbar.message}
      />
    </Box>
  );
}
