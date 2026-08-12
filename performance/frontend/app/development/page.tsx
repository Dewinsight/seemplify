'use client';

import { useEffect, useState } from 'react';
import { useDevelopmentPlans, useUserContext, useDirectReports, useLearningRecords, useTeamLearningRecords } from '@/lib/hooks';
import api from '@/lib/api';
import {
  Typography, Box, CircularProgress, Button, Card, CardContent, Chip,
  Grid, Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  LinearProgress, Alert, Tabs, Tab, List, ListItem, ListItemText,
  ListItemIcon, Accordion, AccordionSummary, AccordionDetails, Avatar,
  Snackbar, Stack, FormControl, InputLabel, Select, MenuItem, Divider, Paper
} from '@mui/material';
import {
  Add, TrendingUp, School, EmojiEvents, ExpandMore, CheckCircle,
  RadioButtonUnchecked, Star, MenuBook, Person
} from '@mui/icons-material';

export default function DevelopmentPlansPage() {
  const { isManager, user, isLoading: userLoading } = useUserContext();
  const { directReports } = useDirectReports();
  const { plans, isLoading, isError, mutate } = useDevelopmentPlans();
  const [learningEmployeeId, setLearningEmployeeId] = useState('');
  const {
    records: learningRecords,
    summary: learningSummary,
    learningUrl,
    isLoading: learningLoading,
    isError: learningError,
  } = useLearningRecords(learningEmployeeId || undefined);
  const { learners: teamLearners } = useTeamLearningRecords(isManager);
  
  const [tabValue, setTabValue] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<any>(null);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [checkInPlan, setCheckInPlan] = useState<any>(null);
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [linkingRecord, setLinkingRecord] = useState<{ _id: string; courseTitle: string } | null>(null);
  const [linkPlanId, setLinkPlanId] = useState('');
  const [checkIn, setCheckIn] = useState({ notes: '', progressUpdate: 0, blockers: '' });
  const [newPlan, setNewPlan] = useState({
    userId: '',
    title: '',
    description: '',
    startDate: '',
    targetDate: '',
    careerGoal: '',
    skillName: '',
    learningActivity: '',
  });

  useEffect(() => {
    const planId = new URLSearchParams(window.location.search).get('plan') || '';
    setSelectedPlanId(planId);
    if (!planId) return;
    const plan = (plans || []).find((item: any) => item._id === planId);
    if (plan) {
      setSelectedPlan(plan);
      window.setTimeout(() => document.getElementById(`development-${planId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
    }
  }, [plans]);

  if (userLoading || isLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="50vh">
        <CircularProgress />
      </Box>
    );
  }

  const currentUserIds = new Set([user?.id, user?._id, user?.userId, user?.idpSub, user?.sub].filter(Boolean).map(String));
  const myPlans = plans?.filter((p: any) => currentUserIds.has(String(p.userId))) || [];
  const teamPlans = plans?.filter((p: any) => !currentUserIds.has(String(p.userId))) || [];
  const reportNames = new Map<string, string>((directReports || []).map((report: any) => [
    String(report.id || report._id || report.userId),
    report.name || report.email || 'Team member',
  ]));
  const selectedLearner = teamLearners.find((learner: { employeeId: string }) => learner.employeeId === learningEmployeeId);
  const selectedLearnerIds = new Set((selectedLearner?.identifiers || [learningEmployeeId]).map(String));
  const learningPlans = learningEmployeeId
    ? plans?.filter((plan) => selectedLearnerIds.has(String(plan.userId))) || []
    : myPlans;

  const handleCreatePlan = async () => {
    setSaving(true);
    setError('');
    try {
      await api.post('/development-plans', {
        userId: newPlan.userId,
        title: newPlan.title.trim(),
        description: newPlan.description.trim(),
        startDate: newPlan.startDate,
        targetDate: newPlan.targetDate,
        careerGoals: newPlan.careerGoal.trim() ? [{ title: newPlan.careerGoal.trim(), progress: 0 }] : [],
        skillDevelopment: newPlan.skillName.trim() ? [{ skillName: newPlan.skillName.trim(), currentLevel: 'beginner', targetLevel: 'intermediate', category: 'soft_skills', progress: 0 }] : [],
        learningActivities: newPlan.learningActivity.trim() ? [{ title: newPlan.learningActivity.trim(), type: 'other', status: 'not_started', dueDate: newPlan.targetDate }] : [],
      });
      setDialogOpen(false);
      setNewPlan({ userId: '', title: '', description: '', startDate: '', targetDate: '', careerGoal: '', skillName: '', learningActivity: '' });
      await mutate();
      setNotice('Development plan created.');
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || 'Could not create this plan.');
    } finally {
      setSaving(false);
    }
  };

  const handleActivatePlan = async (planId: string) => {
    setSaving(true);
    setError('');
    try {
      await api.post(`/development-plans/${planId}/activate`, {});
      await mutate();
      setNotice('Development plan activated.');
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || 'Could not activate this plan.');
    } finally {
      setSaving(false);
    }
  };

  const addCheckIn = async () => {
    if (!checkInPlan || !checkIn.notes.trim()) return;
    setSaving(true);
    setError('');
    try {
      const response = await api.post(`/development-plans/${checkInPlan._id}/check-in`, {
        notes: checkIn.notes.trim(),
        progressUpdate: checkIn.progressUpdate,
        blockers: checkIn.blockers.trim(),
      });
      const updatedPlan = response.data?.data || response.data;
      setCheckInPlan(updatedPlan);
      if (selectedPlan?._id === updatedPlan?._id) setSelectedPlan(updatedPlan);
      setCheckIn({ notes: '', progressUpdate: 0, blockers: '' });
      setCheckInOpen(false);
      setCheckInPlan(null);
      await mutate();
      setNotice('Progress check-in recorded.');
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || 'Could not record this check-in.');
    } finally {
      setSaving(false);
    }
  };

  const completeActivity = async (activityIndex: number) => {
    if (!selectedPlan) return;
    setSaving(true);
    setError('');
    try {
      const response = await api.put(`/development-plans/${selectedPlan._id}/activities/${activityIndex}`, { status: 'completed' });
      setSelectedPlan(response.data?.data || response.data);
      await mutate();
      setNotice('Activity marked complete.');
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || 'Could not update this activity.');
    } finally {
      setSaving(false);
    }
  };

  const linkCourseToPlan = async () => {
    if (!linkingRecord || !linkPlanId) return;
    setSaving(true);
    setError('');
    try {
      const response = await api.post(`/learning/records/${linkingRecord._id}/link-plan`, { planId: linkPlanId });
      const updatedPlan = response.data?.data || response.data;
      if (selectedPlan?._id === updatedPlan?._id) setSelectedPlan(updatedPlan);
      setLinkingRecord(null);
      setLinkPlanId('');
      await mutate();
      setNotice(response.data?.alreadyLinked
        ? 'This course is already in the development plan.'
        : 'Course added to the development plan. Its progress will stay synchronized.');
    } catch (requestError) {
      const responseError = requestError as { response?: { data?: { error?: string } } };
      setError(responseError.response?.data?.error || 'Could not add this course to the development plan.');
    } finally {
      setSaving(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'success';
      case 'completed': return 'primary';
      case 'draft': return 'warning';
      case 'on_hold': return 'default';
      default: return 'default';
    }
  };

  const getLevelIcon = (level: string) => {
    return level ? level.replace('_', ' ') : 'beginner';
  };

  const PlanCard = ({ plan }: { plan: any }) => (
    <Card
      id={`development-${plan._id}`}
      variant="outlined"
      sx={{ height: '100%', borderColor: selectedPlanId === plan._id ? 'primary.main' : 'divider', borderWidth: selectedPlanId === plan._id ? 2 : 1 }}
    >
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="start" mb={2}>
          <Box>
            <Typography variant="h6" fontWeight="bold">{plan.title}</Typography>
            {!currentUserIds.has(String(plan.userId)) && (
              <Typography variant="body2" color="text.secondary">{reportNames.get(String(plan.userId)) || 'Team member'}</Typography>
            )}
            <Chip 
              size="small" 
              label={plan.status}
              color={getStatusColor(plan.status) as any}
              sx={{ mt: 0.5 }}
            />
          </Box>
          <Avatar sx={{ bgcolor: 'secondary.main' }}>
            <TrendingUp />
          </Avatar>
        </Box>

        <Box mb={2}>
          <Box display="flex" justifyContent="space-between" mb={0.5}>
            <Typography variant="body2" color="text.secondary">Overall Progress</Typography>
            <Typography variant="body2" fontWeight="bold">{plan.overallProgress || 0}%</Typography>
          </Box>
          <LinearProgress 
            variant="determinate" 
            value={plan.overallProgress || 0}
            sx={{ height: 8, borderRadius: 1 }}
          />
        </Box>

        <Box display="flex" gap={2} mb={2}>
          <Box textAlign="center">
            <Typography variant="h5" fontWeight="bold" color="primary.main">
              {plan.careerGoals?.length || 0}
            </Typography>
            <Typography variant="caption" color="text.secondary">Goals</Typography>
          </Box>
          <Box textAlign="center">
            <Typography variant="h5" fontWeight="bold" color="secondary.main">
              {plan.skillDevelopment?.length || 0}
            </Typography>
            <Typography variant="caption" color="text.secondary">Skills</Typography>
          </Box>
          <Box textAlign="center">
            <Typography variant="h5" fontWeight="bold" color="success.main">
              {plan.learningActivities?.filter((a: any) => a.status === 'completed').length || 0}
            </Typography>
            <Typography variant="caption" color="text.secondary">Completed</Typography>
          </Box>
        </Box>

        <Typography variant="caption" color="text.secondary">
          Target: {new Date(plan.targetDate).toLocaleDateString()}
        </Typography>

        <Box display="flex" gap={1} mt={2}>
          <Button 
            size="small" 
            variant="outlined"
            onClick={() => setSelectedPlan(plan)}
          >
            View Details
          </Button>
          {isManager && plan.status === 'draft' && (
            <Button
              size="small"
              variant="contained"
              color="success"
              onClick={() => handleActivatePlan(plan._id)}
              disabled={saving}
            >
              Activate
            </Button>
          )}
          {plan.status === 'active' && (
            <Button
              size="small"
              onClick={() => { setCheckInPlan(plan); setCheckInOpen(true); }}
            >
              Check in
            </Button>
          )}
        </Box>
      </CardContent>
    </Card>
  );

  return (
    <Box sx={{ maxWidth: 1120, mx: 'auto' }}>
      <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={3} gap={2} flexWrap="wrap">
        <Box>
          <Typography variant="h4" component="h1" fontWeight={700}>Development plans</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            Turn career goals into skills, practical activities, and regular progress conversations.
          </Typography>
        </Box>
        {isManager && (
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={() => setDialogOpen(true)}
          >
            Create Plan
          </Button>
        )}
      </Box>

      {(isError || error) && (
        <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>
          {error || 'Development plans could not be loaded. Try refreshing the page.'}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ mb: 3, borderRadius: 1, overflow: 'hidden' }}>
        <Box sx={{ px: 2.5, py: 2, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
          <Box>
            <Typography variant="h6" fontWeight={650}>
              {selectedLearner ? `${selectedLearner.name}'s Learning record` : 'Seemplify Learning record'}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              {selectedLearner
                ? 'Review assigned training and connect relevant courses to this employee’s development plan.'
                : 'Courses completed with your Seemplify account are recorded here and can support a development plan.'}
            </Typography>
            <Stack direction="row" spacing={2.5} sx={{ mt: 1.25, flexWrap: 'wrap', rowGap: 0.5 }}>
              <Typography variant="body2"><strong>{learningSummary.inProgress}</strong> in progress</Typography>
              <Typography variant="body2"><strong>{learningSummary.completed}</strong> completed</Typography>
              {learningSummary.overdue > 0 && (
                <Typography variant="body2" color="warning.main"><strong>{learningSummary.overdue}</strong> overdue</Typography>
              )}
            </Stack>
          </Box>
          <Stack direction="row" spacing={1} alignItems="center">
            {isManager && teamLearners.length > 0 && (
              <FormControl size="small" sx={{ minWidth: 210 }}>
                <InputLabel id="learning-person-label">Learning record</InputLabel>
                <Select
                  labelId="learning-person-label"
                  label="Learning record"
                  value={learningEmployeeId}
                  onChange={(event) => setLearningEmployeeId(String(event.target.value))}
                >
                  <MenuItem value="">My learning</MenuItem>
                  {teamLearners.map((learner: { employeeId: string; name: string }) => (
                    <MenuItem key={learner.employeeId} value={learner.employeeId}>{learner.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
            <Button href={learningUrl} target="_blank" rel="noopener noreferrer" variant="outlined" startIcon={<School />}>
              Open Learning
            </Button>
          </Stack>
        </Box>
        <Divider />
        {learningLoading && <LinearProgress />}
        {learningError ? (
          <Alert severity="warning" sx={{ borderRadius: 0 }}>
            Your Learning record is temporarily unavailable. Your development plans are unaffected.
          </Alert>
        ) : learningRecords.length === 0 && !learningLoading ? (
          <Box sx={{ px: 2.5, py: 2 }}>
            <Typography variant="body2" color="text.secondary">
              No synchronized courses yet. Open Learning with your Seemplify account to connect future activity.
            </Typography>
          </Box>
        ) : (
          <List disablePadding>
            {learningRecords.slice(0, 8).map((record, index: number) => (
              <ListItem
                key={record._id}
                divider={index < Math.min(learningRecords.length, 8) - 1}
                sx={{ px: 2.5, py: 1.5, alignItems: 'flex-start', gap: 2 }}
                secondaryAction={learningPlans.length > 0 ? (
                  <Button
                    size="small"
                    onClick={() => {
                      setLinkingRecord(record);
                      setLinkPlanId(learningPlans[0]?._id || '');
                    }}
                  >
                    Add to plan
                  </Button>
                ) : undefined}
              >
                <ListItemText
                  sx={{ pr: learningPlans.length > 0 ? 14 : 0 }}
                  primary={record.courseTitle}
                  secondary={
                    <Box component="span" sx={{ display: 'block', mt: 0.5 }}>
                      <Typography component="span" variant="caption" color="text.secondary">
                        {record.status === 'completed' ? 'Completed' : record.status === 'in_progress' ? 'In progress' : 'Assigned'}
                        {' · '}{record.progressPercent || 0}%
                        {record.completedAt ? ` · ${new Date(record.completedAt).toLocaleDateString()}` : ''}
                      </Typography>
                      <LinearProgress variant="determinate" value={record.progressPercent || 0} sx={{ mt: 0.75, maxWidth: 360, height: 5, borderRadius: 0.5 }} />
                    </Box>
                  }
                />
              </ListItem>
            ))}
          </List>
        )}
      </Paper>

      <Tabs value={tabValue} onChange={(_, v) => setTabValue(v)} sx={{ mb: 3 }}>
        <Tab label={`My Plans (${myPlans.length})`} />
        {isManager && <Tab label={`Team Plans (${teamPlans.length})`} />}
      </Tabs>

      {tabValue === 0 && (
        <Grid container spacing={3}>
          {myPlans.length === 0 ? (
            <Grid size={12}>
              <Alert severity="info">
                You don't have any development plans yet. Ask your manager to create one for you!
              </Alert>
            </Grid>
          ) : (
            myPlans.map((plan: any) => (
              <Grid size={{ xs: 12, md: 6, lg: 4 }} key={plan._id}>
                <PlanCard plan={plan} />
              </Grid>
            ))
          )}
        </Grid>
      )}

      {tabValue === 1 && isManager && (
        <Grid container spacing={3}>
          {teamPlans.length === 0 ? (
            <Grid size={12}>
              <Alert severity="info">
                No team development plans yet. Create one for your direct reports!
              </Alert>
            </Grid>
          ) : (
            teamPlans.map((plan: any) => (
              <Grid size={{ xs: 12, md: 6, lg: 4 }} key={plan._id}>
                <PlanCard plan={plan} />
              </Grid>
            ))
          )}
        </Grid>
      )}

      {/* Create Plan Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create Development Plan</DialogTitle>
        <DialogContent>
          <Box display="flex" flexDirection="column" gap={2} mt={1}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              select
              label="Team Member"
              value={newPlan.userId}
              onChange={(e) => setNewPlan({ ...newPlan, userId: e.target.value })}
              fullWidth
              SelectProps={{ native: true }}
            >
              <option value="">Select team member</option>
              {directReports?.map((dr: any) => (
                <option key={dr.id || dr._id} value={dr.id || dr._id}>
                  {dr.name || dr.email}
                </option>
              ))}
            </TextField>
            <TextField
              label="Plan Title"
              value={newPlan.title}
              onChange={(e) => setNewPlan({ ...newPlan, title: e.target.value })}
              fullWidth
              placeholder="e.g., Senior Engineer Growth Plan"
            />
            <TextField
              label="Description"
              value={newPlan.description}
              onChange={(e) => setNewPlan({ ...newPlan, description: e.target.value })}
              fullWidth
              multiline
              rows={2}
            />
            <TextField
              label="First career goal"
              value={newPlan.careerGoal}
              onChange={(e) => setNewPlan({ ...newPlan, careerGoal: e.target.value })}
              fullWidth
              placeholder="For example, move into a senior role"
            />
            <TextField
              label="First skill to develop"
              value={newPlan.skillName}
              onChange={(e) => setNewPlan({ ...newPlan, skillName: e.target.value })}
              fullWidth
              placeholder="For example, stakeholder communication"
            />
            <TextField
              label="First development activity"
              value={newPlan.learningActivity}
              onChange={(e) => setNewPlan({ ...newPlan, learningActivity: e.target.value })}
              fullWidth
              placeholder="For example, lead the next planning session"
            />
            <TextField
              type="date"
              label="Start Date"
              value={newPlan.startDate}
              onChange={(e) => setNewPlan({ ...newPlan, startDate: e.target.value })}
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              type="date"
              label="Target Date"
              value={newPlan.targetDate}
              onChange={(e) => setNewPlan({ ...newPlan, targetDate: e.target.value })}
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
          <Button 
            onClick={handleCreatePlan} 
            variant="contained"
            disabled={saving || !newPlan.userId || !newPlan.title || !newPlan.startDate || !newPlan.targetDate}
          >
            {saving ? 'Creating…' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Plan Details Dialog */}
      <Dialog 
        open={!!selectedPlan} 
        onClose={() => setSelectedPlan(null)} 
        maxWidth="md" 
        fullWidth
      >
        {selectedPlan && (
          <>
            <DialogTitle>
              <Box display="flex" justifyContent="space-between" alignItems="center">
                <Typography variant="h6">{selectedPlan.title}</Typography>
                <Chip 
                  label={selectedPlan.status}
                  color={getStatusColor(selectedPlan.status) as any}
                />
              </Box>
            </DialogTitle>
            <DialogContent>
              <Box mb={3}>
                <Box display="flex" justifyContent="space-between" mb={1}>
                  <Typography variant="body2" color="text.secondary">Overall Progress</Typography>
                  <Typography variant="body2" fontWeight="bold">{selectedPlan.overallProgress || 0}%</Typography>
                </Box>
                <LinearProgress 
                  variant="determinate" 
                  value={selectedPlan.overallProgress || 0}
                  sx={{ height: 10, borderRadius: 1 }}
                />
              </Box>

              {/* Career Goals */}
              {selectedPlan.careerGoals?.length > 0 && (
                <Accordion defaultExpanded>
                  <AccordionSummary expandIcon={<ExpandMore />}>
                    <Box display="flex" alignItems="center" gap={1}>
                      <EmojiEvents color="primary" />
                      <Typography fontWeight="bold">Career Goals ({selectedPlan.careerGoals.length})</Typography>
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails>
                    <List dense>
                      {selectedPlan.careerGoals.map((goal: any, idx: number) => (
                        <ListItem key={idx}>
                          <ListItemIcon>
                            <Star color="primary" />
                          </ListItemIcon>
                          <ListItemText 
                            primary={goal.title}
                            secondary={
                              <Box>
                                <Typography variant="caption">
                                  Target: {goal.targetRole || goal.timeframe}
                                </Typography>
                                <LinearProgress 
                                  variant="determinate" 
                                  value={goal.progress || 0}
                                  sx={{ mt: 0.5 }}
                                />
                              </Box>
                            }
                          />
                        </ListItem>
                      ))}
                    </List>
                  </AccordionDetails>
                </Accordion>
              )}

              {/* Skills */}
              {selectedPlan.skillDevelopment?.length > 0 && (
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMore />}>
                    <Box display="flex" alignItems="center" gap={1}>
                      <School color="secondary" />
                      <Typography fontWeight="bold">Skills ({selectedPlan.skillDevelopment.length})</Typography>
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails>
                    <List dense>
                      {selectedPlan.skillDevelopment.map((skill: any, idx: number) => (
                        <ListItem key={idx}>
                          <ListItemText 
                            primary={
                              <Box display="flex" justifyContent="space-between">
                                <Typography>{skill.skillName}</Typography>
                                <Chip size="small" label={skill.category} />
                              </Box>
                            }
                            secondary={
                              <Box>
                                <Typography variant="caption">
                                  {getLevelIcon(skill.currentLevel)} → {getLevelIcon(skill.targetLevel)}
                                </Typography>
                                <LinearProgress 
                                  variant="determinate" 
                                  value={skill.progress || 0}
                                  sx={{ mt: 0.5 }}
                                />
                              </Box>
                            }
                          />
                        </ListItem>
                      ))}
                    </List>
                  </AccordionDetails>
                </Accordion>
              )}

              {/* Learning Activities */}
              {selectedPlan.learningActivities?.length > 0 && (
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMore />}>
                    <Box display="flex" alignItems="center" gap={1}>
                      <MenuBook color="success" />
                      <Typography fontWeight="bold">
                        Learning Activities ({selectedPlan.learningActivities.filter((a: any) => a.status === 'completed').length}/{selectedPlan.learningActivities.length})
                      </Typography>
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails>
                    <List dense>
                      {selectedPlan.learningActivities.map((activity: any, idx: number) => (
                        <ListItem
                          key={idx}
                          secondaryAction={activity.status !== 'completed' && activity.source !== 'seemplify_learning' ? (
                            <Button size="small" onClick={() => void completeActivity(idx)} disabled={saving}>Mark complete</Button>
                          ) : undefined}
                        >
                          <ListItemIcon>
                            {activity.status === 'completed' ? 
                              <CheckCircle color="success" /> : 
                              <RadioButtonUnchecked color="action" />
                            }
                          </ListItemIcon>
                          <ListItemText
                            primary={activity.title}
                            secondary={activity.source === 'seemplify_learning'
                              ? `Synced from Seemplify Learning · ${activity.progressPercent || 0}% complete`
                              : `${activity.type} · Due: ${activity.dueDate ? new Date(activity.dueDate).toLocaleDateString() : 'No date'}`}
                          />
                        </ListItem>
                      ))}
                    </List>
                  </AccordionDetails>
                </Accordion>
              )}

              {/* Mentoring */}
              {selectedPlan.mentoring?.hasMentor && (
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMore />}>
                    <Box display="flex" alignItems="center" gap={1}>
                      <Person color="info" />
                      <Typography fontWeight="bold">Mentoring</Typography>
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Box>
                      <Typography variant="subtitle2">Mentor: {selectedPlan.mentoring.mentorName}</Typography>
                      <Typography variant="body2" color="text.secondary">{selectedPlan.mentoring.mentorRole}</Typography>
                      <Typography variant="body2" sx={{ mt: 1 }}>
                        Focus: {selectedPlan.mentoring.focusAreas?.join(', ')}
                      </Typography>
                      <Typography variant="caption">
                        Meetings: {selectedPlan.mentoring.meetingFrequency}
                      </Typography>
                    </Box>
                  </AccordionDetails>
                </Accordion>
              )}

              {selectedPlan.checkIns?.length > 0 && (
                <Box sx={{ mt: 3 }}>
                  <Divider sx={{ mb: 2 }} />
                  <Typography variant="h6" gutterBottom>Progress check-ins</Typography>
                  <Stack spacing={1.5}>
                    {selectedPlan.checkIns.slice().reverse().map((entry: any, index: number) => (
                      <Paper key={entry._id || index} variant="outlined" sx={{ p: 1.5 }}>
                        <Stack direction="row" justifyContent="space-between" spacing={1}>
                          <Typography variant="body2" fontWeight={600}>{entry.addedBy === 'manager' ? 'Manager update' : 'Employee update'}</Typography>
                          <Typography variant="caption" color="text.secondary">{entry.date ? new Date(entry.date).toLocaleDateString() : ''}</Typography>
                        </Stack>
                        <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap' }}>{entry.notes}</Typography>
                        {entry.blockers && <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 0.75 }}>Blocker: {entry.blockers}</Typography>}
                      </Paper>
                    ))}
                  </Stack>
                </Box>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setSelectedPlan(null)}>Close</Button>
              {selectedPlan.status === 'active' && (
                <Button variant="contained" onClick={() => { setCheckInPlan(selectedPlan); setCheckInOpen(true); }}>
                  Add check-in
                </Button>
              )}
            </DialogActions>
          </>
        )}
      </Dialog>

      <Dialog
        open={Boolean(linkingRecord)}
        onClose={() => { if (!saving) { setLinkingRecord(null); setLinkPlanId(''); } }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Add course to a development plan</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {linkingRecord?.courseTitle} will stay synchronized as the learner makes progress in Seemplify Learning.
          </Typography>
          <FormControl fullWidth>
            <InputLabel id="learning-plan-label">Development plan</InputLabel>
            <Select
              labelId="learning-plan-label"
              label="Development plan"
              value={linkPlanId}
              onChange={(event) => setLinkPlanId(String(event.target.value))}
            >
              {learningPlans.map((plan) => (
                <MenuItem key={plan._id} value={plan._id}>{plan.title}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setLinkingRecord(null); setLinkPlanId(''); }} disabled={saving}>Cancel</Button>
          <Button variant="contained" onClick={() => void linkCourseToPlan()} disabled={saving || !linkPlanId}>
            {saving ? 'Adding…' : 'Add to plan'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={checkInOpen}
        onClose={() => { if (!saving) { setCheckInOpen(false); setCheckInPlan(null); } }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Progress check-in</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Progress update"
              value={checkIn.notes}
              onChange={(event) => setCheckIn({ ...checkIn, notes: event.target.value })}
              multiline
              minRows={4}
              required
              placeholder="What moved forward since the last check-in?"
            />
            <TextField
              type="number"
              label="Progress percentage (optional)"
              value={checkIn.progressUpdate}
              onChange={(event) => setCheckIn({ ...checkIn, progressUpdate: Math.max(0, Math.min(100, Number(event.target.value))) })}
              inputProps={{ min: 0, max: 100 }}
            />
            <TextField
              label="Blockers or support needed (optional)"
              value={checkIn.blockers}
              onChange={(event) => setCheckIn({ ...checkIn, blockers: event.target.value })}
              multiline
              minRows={2}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setCheckInOpen(false); setCheckInPlan(null); }} disabled={saving}>Cancel</Button>
          <Button variant="contained" onClick={() => void addCheckIn()} disabled={saving || !checkIn.notes.trim()}>
            {saving ? 'Saving…' : 'Save check-in'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={Boolean(notice)} autoHideDuration={4000} onClose={() => setNotice('')} message={notice} />
    </Box>
  );
}






