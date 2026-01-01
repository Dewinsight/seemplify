'use client';

import { useState } from 'react';
import { useDevelopmentPlans, useUserContext, useDirectReports } from '@/lib/hooks';
import api from '@/lib/api';
import {
  Typography, Box, CircularProgress, Button, Card, CardContent, Chip,
  Grid, Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  LinearProgress, Alert, Tabs, Tab, List, ListItem, ListItemText,
  ListItemIcon, Accordion, AccordionSummary, AccordionDetails, Avatar
} from '@mui/material';
import {
  Add, TrendingUp, School, EmojiEvents, ExpandMore, CheckCircle,
  RadioButtonUnchecked, Star, Work, MenuBook, Person
} from '@mui/icons-material';
import { useSession } from 'next-auth/react';

export default function DevelopmentPlansPage() {
  const { data: session, status } = useSession();
  const { isManager, user, isLoading: userLoading } = useUserContext();
  const { directReports } = useDirectReports();
  const { plans, isLoading, mutate } = useDevelopmentPlans();
  
  const [tabValue, setTabValue] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<any>(null);
  const [newPlan, setNewPlan] = useState({
    userId: '',
    title: '',
    description: '',
    startDate: '',
    targetDate: '',
  });

  if (status === 'loading' || userLoading || isLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="50vh">
        <CircularProgress />
      </Box>
    );
  }

  const myPlans = plans?.filter((p: any) => p.userId === user?.id) || [];
  const teamPlans = plans?.filter((p: any) => p.userId !== user?.id) || [];

  const handleCreatePlan = async () => {
    try {
      await api.post('/development-plans', newPlan);
      setDialogOpen(false);
      setNewPlan({ userId: '', title: '', description: '', startDate: '', targetDate: '' });
      mutate();
    } catch (error) {
      console.error('Error creating plan:', error);
    }
  };

  const handleActivatePlan = async (planId: string) => {
    try {
      await api.post(`/development-plans/${planId}/activate`, {});
      mutate();
    } catch (error) {
      console.error('Error activating plan:', error);
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
    switch (level) {
      case 'expert': return '⭐⭐⭐⭐';
      case 'advanced': return '⭐⭐⭐';
      case 'intermediate': return '⭐⭐';
      default: return '⭐';
    }
  };

  const PlanCard = ({ plan }: { plan: any }) => (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="start" mb={2}>
          <Box>
            <Typography variant="h6" fontWeight="bold">{plan.title}</Typography>
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
            >
              Activate
            </Button>
          )}
        </Box>
      </CardContent>
    </Card>
  );

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4" fontWeight="bold">
          Development Plans
        </Typography>
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
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button 
            onClick={handleCreatePlan} 
            variant="contained"
            disabled={!newPlan.userId || !newPlan.title || !newPlan.startDate || !newPlan.targetDate}
          >
            Create
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
                        <ListItem key={idx}>
                          <ListItemIcon>
                            {activity.status === 'completed' ? 
                              <CheckCircle color="success" /> : 
                              <RadioButtonUnchecked color="action" />
                            }
                          </ListItemIcon>
                          <ListItemText 
                            primary={activity.title}
                            secondary={`${activity.type} • Due: ${activity.dueDate ? new Date(activity.dueDate).toLocaleDateString() : 'No date'}`}
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
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setSelectedPlan(null)}>Close</Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
}






