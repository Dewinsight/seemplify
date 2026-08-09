'use client';

import { useEffect, useMemo, useState } from 'react';
import { useOneOnOnes, useUserContext, useDirectReports } from '@/lib/hooks';
import api from '@/lib/api';
import {
  Typography, Box, CircularProgress, Button, Card, CardContent, Chip,
  Grid, Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  List, ListItem, ListItemText, ListItemIcon, IconButton, Tabs, Tab,
  Alert, Divider, LinearProgress, Avatar, Snackbar, Stack
} from '@mui/material';
import {
  Add, Event, CheckCircle, Schedule, Person, Notes, PlayArrow, Done,
  AccessTime, VideoCall, LocationOn
} from '@mui/icons-material';

export default function OneOnOnesPage() {
  const { user, isManager, isLoading: userLoading } = useUserContext();
  const { directReports } = useDirectReports();
  const [tabValue, setTabValue] = useState(0);
  const { meetings: upcomingMeetings, isLoading: upcomingLoading, mutate: mutateUpcoming } = useOneOnOnes({ upcoming: true });
  const { meetings: pastMeetings, isLoading: pastLoading, mutate: mutatePast } = useOneOnOnes({ upcoming: false });
  
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedMeeting, setSelectedMeeting] = useState<any>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [agendaTopic, setAgendaTopic] = useState('');
  const [withUserId, setWithUserId] = useState('');
  const [newMeeting, setNewMeeting] = useState({
    employeeId: '',
    scheduledDate: '',
    duration: 30,
    location: 'Virtual',
    meetingType: 'weekly'
  });

  const currentUserIds = useMemo(() => new Set([
    user?.id, user?._id, user?.userId, user?.idpSub, user?.sub,
  ].filter(Boolean).map(String)), [user]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const employeeId = params.get('employeeId');
    setWithUserId(params.get('with') || '');
    if (employeeId) {
      setNewMeeting((current) => ({ ...current, employeeId }));
      setDialogOpen(true);
    }
  }, []);

  const upcomingDisplay = useMemo(() => withUserId
    ? (upcomingMeetings || []).filter((meeting: any) => [meeting.employeeId, meeting.managerId].map(String).includes(withUserId))
    : (upcomingMeetings || []), [upcomingMeetings, withUserId]);
  const pastDisplay = useMemo(() => withUserId
    ? (pastMeetings || []).filter((meeting: any) => [meeting.employeeId, meeting.managerId].map(String).includes(withUserId))
    : (pastMeetings || []), [pastMeetings, withUserId]);

  if (userLoading || upcomingLoading || pastLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="50vh">
        <CircularProgress />
      </Box>
    );
  }

  const handleCreateMeeting = async () => {
    const selectedEmployee = directReports?.find((report: any) => String(report.id || report._id || report.userId) === newMeeting.employeeId);
    setSaving(true);
    setError('');
    try {
      await api.post('/one-on-ones', {
        ...newMeeting,
        employeeInfo: selectedEmployee ? {
          name: selectedEmployee.name || selectedEmployee.email,
          email: selectedEmployee.email,
          title: selectedEmployee.title || selectedEmployee.jobTitle,
        } : { name: new URLSearchParams(window.location.search).get('name') || undefined },
        meetingFormat: newMeeting.location.toLowerCase().includes('virtual') ? 'video' : 'in_person',
      });
      setDialogOpen(false);
      setNewMeeting({ employeeId: '', scheduledDate: '', duration: 30, location: 'Virtual', meetingType: 'weekly' });
      await mutateUpcoming();
      setNotice('1:1 meeting scheduled.');
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || requestError?.response?.data?.message || 'Could not schedule this meeting.');
    } finally {
      setSaving(false);
    }
  };

  const handleCompleteMeeting = async (meetingId: string) => {
    setSaving(true);
    setError('');
    try {
      await api.post(`/one-on-ones/${meetingId}/complete`, {});
      await Promise.all([mutateUpcoming(), mutatePast()]);
      setSelectedMeeting(null);
      setNotice('Meeting marked complete.');
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || 'Could not complete this meeting.');
    } finally {
      setSaving(false);
    }
  };

  const addAgendaItem = async () => {
    if (!selectedMeeting || !agendaTopic.trim()) return;
    setSaving(true);
    setError('');
    try {
      await api.post(`/one-on-ones/${selectedMeeting._id}/agenda`, { topic: agendaTopic.trim(), priority: 'medium' });
      const response = await api.get(`/one-on-ones/${selectedMeeting._id}`);
      setSelectedMeeting(response.data?.data || response.data);
      setAgendaTopic('');
      await mutateUpcoming();
      setNotice('Agenda item added.');
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || 'Could not add the agenda item.');
    } finally {
      setSaving(false);
    }
  };

  const participantName = (meeting: any) => currentUserIds.has(String(meeting.managerId || ''))
    ? meeting.employeeInfo?.name || 'Team member'
    : meeting.managerInfo?.name || 'Manager';

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'success';
      case 'scheduled': return 'primary';
      case 'cancelled': return 'error';
      default: return 'default';
    }
  };

  return (
    <Box sx={{ maxWidth: 1120, mx: 'auto' }}>
      <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={3} gap={2} flexWrap="wrap">
        <Box>
          <Typography variant="h4" component="h1" fontWeight={700}>1:1 meetings</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            Prepare together, keep shared notes, and follow through on agreed actions.
          </Typography>
        </Box>
        {isManager && (
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={() => setDialogOpen(true)}
          >
            Schedule 1:1
          </Button>
        )}
      </Box>

      {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}

      <Tabs value={tabValue} onChange={(_, v) => setTabValue(v)} sx={{ mb: 3 }}>
        <Tab label={`Upcoming (${upcomingDisplay.length})`} />
        <Tab label={`Past (${pastDisplay.length})`} />
      </Tabs>

      {tabValue === 0 && (
        <Grid container spacing={3}>
          {upcomingDisplay.length === 0 ? (
            <Grid size={12}>
              <Alert severity="info">No upcoming 1:1 meetings scheduled.</Alert>
            </Grid>
          ) : (
            upcomingDisplay.map((meeting: any) => (
              <Grid size={{ xs: 12, md: 6, lg: 4 }} key={meeting._id}>
                <Card sx={{ height: '100%' }}>
                  <CardContent>
                    <Box display="flex" justifyContent="space-between" alignItems="start" mb={2}>
                      <Box display="flex" alignItems="center" gap={1}>
                        <Avatar sx={{ bgcolor: 'primary.main' }}>
                          <Person />
                        </Avatar>
                        <Box>
                          <Typography variant="subtitle1" fontWeight="medium">
                            {participantName(meeting)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">{String(meeting.meetingType || 'regular').replace('_', ' ')} 1:1</Typography>
                          <Chip 
                            size="small" 
                            label={meeting.status}
                            color={getStatusColor(meeting.status) as any}
                          />
                        </Box>
                      </Box>
                    </Box>

                    <Box display="flex" alignItems="center" gap={1} mb={1}>
                      <Event fontSize="small" color="action" />
                      <Typography variant="body2">
                        {new Date(meeting.scheduledDate).toLocaleDateString('en-US', {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </Typography>
                    </Box>

                    <Box display="flex" alignItems="center" gap={1} mb={1}>
                      <AccessTime fontSize="small" color="action" />
                      <Typography variant="body2">{meeting.duration} minutes</Typography>
                    </Box>

                    <Box display="flex" alignItems="center" gap={1} mb={2}>
                      {meeting.location?.includes('Virtual') ? 
                        <VideoCall fontSize="small" color="action" /> : 
                        <LocationOn fontSize="small" color="action" />
                      }
                      <Typography variant="body2">{meeting.location}</Typography>
                    </Box>

                    {meeting.agendaItems?.length > 0 && (
                      <>
                        <Divider sx={{ my: 1 }} />
                        <Typography variant="caption" color="text.secondary">
                          {meeting.agendaItems.length} agenda items
                        </Typography>
                      </>
                    )}

                    <Box display="flex" gap={1} mt={2}>
                      <Button 
                        size="small" 
                        variant="outlined"
                        onClick={() => setSelectedMeeting(meeting)}
                      >
                        View Details
                      </Button>
                      {isManager && meeting.status === 'scheduled' && (
                        <Button
                          size="small"
                          variant="contained"
                          color="success"
                          startIcon={<Done />}
                          onClick={() => handleCompleteMeeting(meeting._id)}
                        >
                          Complete
                        </Button>
                      )}
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            ))
          )}
        </Grid>
      )}

      {tabValue === 1 && (
        <Grid container spacing={3}>
          {pastDisplay.length === 0 ? (
            <Grid size={12}>
              <Alert severity="info">No past meetings to show.</Alert>
            </Grid>
          ) : (
            pastDisplay.map((meeting: any) => (
              <Grid size={{ xs: 12, md: 6, lg: 4 }} key={meeting._id}>
                <Card sx={{ height: '100%', opacity: meeting.status === 'cancelled' ? 0.6 : 1 }}>
                  <CardContent>
                    <Box display="flex" justifyContent="space-between" alignItems="start" mb={2}>
                      <Typography variant="subtitle1" fontWeight="medium">
                        {participantName(meeting)}
                      </Typography>
                      <Chip 
                        size="small" 
                        label={meeting.status}
                        color={getStatusColor(meeting.status) as any}
                      />
                    </Box>

                    <Box display="flex" alignItems="center" gap={1} mb={1}>
                      <Event fontSize="small" color="action" />
                      <Typography variant="body2">
                        {new Date(meeting.scheduledDate).toLocaleDateString()}
                      </Typography>
                    </Box>

                    {meeting.sharedNotes && (
                      <Box mt={2}>
                        <Typography variant="caption" color="text.secondary">Notes:</Typography>
                        <Typography variant="body2" sx={{ 
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical'
                        }}>
                          {meeting.sharedNotes}
                        </Typography>
                      </Box>
                    )}

                    {meeting.actionItems?.length > 0 && (
                      <Box mt={2}>
                        <Typography variant="caption" color="text.secondary">
                          Action items: {meeting.actionItems.filter((a: any) => a.status === 'completed').length}/{meeting.actionItems.length} done
                        </Typography>
                        <LinearProgress 
                          variant="determinate" 
                          value={(meeting.actionItems.filter((a: any) => a.status === 'completed').length / meeting.actionItems.length) * 100}
                          sx={{ mt: 0.5 }}
                        />
                      </Box>
                    )}
                  </CardContent>
                </Card>
              </Grid>
            ))
          )}
        </Grid>
      )}

      {/* Create Meeting Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Schedule 1:1 Meeting</DialogTitle>
        <DialogContent>
          <Box display="flex" flexDirection="column" gap={2} mt={1}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              select
              label="Team Member"
              value={newMeeting.employeeId}
              onChange={(e) => setNewMeeting({ ...newMeeting, employeeId: e.target.value })}
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
              type="datetime-local"
              label="Date & Time"
              value={newMeeting.scheduledDate}
              onChange={(e) => setNewMeeting({ ...newMeeting, scheduledDate: e.target.value })}
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              select
              label="Duration"
              value={newMeeting.duration}
              onChange={(e) => setNewMeeting({ ...newMeeting, duration: parseInt(e.target.value) })}
              fullWidth
              SelectProps={{ native: true }}
            >
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={45}>45 minutes</option>
              <option value={60}>60 minutes</option>
            </TextField>
            <TextField
              label="Location"
              value={newMeeting.location}
              onChange={(e) => setNewMeeting({ ...newMeeting, location: e.target.value })}
              fullWidth
              placeholder="Virtual - Zoom, Conference Room, etc."
            />
            <TextField
              select
              label="Meeting Type"
              value={newMeeting.meetingType}
              onChange={(e) => setNewMeeting({ ...newMeeting, meetingType: e.target.value })}
              fullWidth
              SelectProps={{ native: true }}
            >
              <option value="weekly">Weekly</option>
              <option value="biweekly">Bi-weekly</option>
              <option value="monthly">Monthly</option>
              <option value="adhoc">Ad-hoc</option>
            </TextField>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
          <Button 
            onClick={handleCreateMeeting} 
            variant="contained"
            disabled={saving || !newMeeting.employeeId || !newMeeting.scheduledDate}
          >
            {saving ? 'Scheduling…' : 'Schedule'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Meeting Details Dialog */}
      <Dialog 
        open={!!selectedMeeting} 
        onClose={() => setSelectedMeeting(null)} 
        maxWidth="md" 
        fullWidth
      >
        {selectedMeeting && (
          <>
            <DialogTitle>
              1:1 with {participantName(selectedMeeting)}
            </DialogTitle>
            <DialogContent>
              <Grid container spacing={2}>
                {error && <Grid size={12}><Alert severity="error">{error}</Alert></Grid>}
                <Grid size={12}>
                  <Box display="flex" gap={2} flexWrap="wrap">
                    <Chip 
                      icon={<Event />} 
                      label={new Date(selectedMeeting.scheduledDate).toLocaleString()} 
                    />
                    <Chip 
                      icon={<AccessTime />} 
                      label={`${selectedMeeting.duration} min`} 
                    />
                    <Chip 
                      icon={<LocationOn />} 
                      label={selectedMeeting.location} 
                    />
                    <Chip 
                      label={selectedMeeting.status}
                      color={getStatusColor(selectedMeeting.status) as any}
                    />
                  </Box>
                </Grid>

                <Grid size={12}>
                  <Typography variant="h6" gutterBottom>Agenda</Typography>
                  {selectedMeeting.agendaItems?.length > 0 ? (
                    <List dense>
                      {selectedMeeting.agendaItems.map((item: any, idx: number) => (
                        <ListItem key={idx}>
                          <ListItemIcon>
                            {item.discussed ? <CheckCircle color="success" /> : <Schedule />}
                          </ListItemIcon>
                          <ListItemText 
                            primary={item.topic}
                            secondary={item.addedBy === 'manager' ? 'Added by manager' : 'Added by employee'}
                          />
                        </ListItem>
                      ))}
                    </List>
                  ) : (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>No agenda items yet.</Typography>
                  )}
                  {selectedMeeting.status === 'scheduled' && (
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                      <TextField
                        size="small"
                        label="Add a discussion topic"
                        value={agendaTopic}
                        onChange={(event) => setAgendaTopic(event.target.value)}
                        fullWidth
                      />
                      <Button variant="outlined" onClick={() => void addAgendaItem()} disabled={saving || !agendaTopic.trim()}>
                        Add
                      </Button>
                    </Stack>
                  )}
                </Grid>

                {selectedMeeting.actionItems?.length > 0 && (
                  <Grid size={12}>
                    <Typography variant="h6" gutterBottom>Action Items</Typography>
                    <List dense>
                      {selectedMeeting.actionItems.map((item: any, idx: number) => (
                        <ListItem key={idx}>
                          <ListItemIcon>
                            {item.status === 'completed' ? 
                              <CheckCircle color="success" /> : 
                              <Schedule color="warning" />
                            }
                          </ListItemIcon>
                          <ListItemText 
                            primary={item.description}
                            secondary={`Assigned to ${item.assignedTo} • Due: ${item.dueDate ? new Date(item.dueDate).toLocaleDateString() : 'No date'}`}
                          />
                        </ListItem>
                      ))}
                    </List>
                  </Grid>
                )}

                {selectedMeeting.sharedNotes && (
                  <Grid size={12}>
                    <Typography variant="h6" gutterBottom>Meeting Notes</Typography>
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                      {selectedMeeting.sharedNotes}
                    </Typography>
                  </Grid>
                )}

                {selectedMeeting.employeeMood && (
                  <Grid size={12}>
                    <Typography variant="h6" gutterBottom>Employee Mood</Typography>
                    <Box display="flex" alignItems="center" gap={2}>
                      <Chip 
                        label={`${selectedMeeting.employeeMood.score}/5`} 
                        color={selectedMeeting.employeeMood.score >= 4 ? 'success' : selectedMeeting.employeeMood.score >= 3 ? 'warning' : 'error'}
                      />
                      {selectedMeeting.employeeMood.comment && (
                        <Typography variant="body2">{selectedMeeting.employeeMood.comment}</Typography>
                      )}
                    </Box>
                  </Grid>
                )}
              </Grid>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setSelectedMeeting(null)}>Close</Button>
              {isManager && selectedMeeting.status === 'scheduled' && (
                <Button variant="contained" startIcon={<Done />} onClick={() => void handleCompleteMeeting(selectedMeeting._id)} disabled={saving}>
                  Complete meeting
                </Button>
              )}
            </DialogActions>
          </>
        )}
      </Dialog>
      <Snackbar open={Boolean(notice)} autoHideDuration={4000} onClose={() => setNotice('')} message={notice} />
    </Box>
  );
}






