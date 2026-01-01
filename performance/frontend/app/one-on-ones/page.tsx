'use client';

import { useState } from 'react';
import { useOneOnOnes, useUserContext, useDirectReports } from '@/lib/hooks';
import api from '@/lib/api';
import {
  Typography, Box, CircularProgress, Button, Card, CardContent, Chip,
  Grid, Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  List, ListItem, ListItemText, ListItemIcon, IconButton, Tabs, Tab,
  Alert, Divider, LinearProgress, Avatar
} from '@mui/material';
import {
  Add, Event, CheckCircle, Schedule, Person, Notes, PlayArrow, Done,
  AccessTime, VideoCall, LocationOn
} from '@mui/icons-material';
import { useSession } from 'next-auth/react';

export default function OneOnOnesPage() {
  const { data: session, status } = useSession();
  const { isManager, isLoading: userLoading } = useUserContext();
  const { directReports } = useDirectReports();
  const [tabValue, setTabValue] = useState(0);
  const { meetings: upcomingMeetings, isLoading: upcomingLoading, mutate: mutateUpcoming } = useOneOnOnes({ upcoming: true });
  const { meetings: pastMeetings, isLoading: pastLoading, mutate: mutatePast } = useOneOnOnes({ upcoming: false });
  
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedMeeting, setSelectedMeeting] = useState<any>(null);
  const [newMeeting, setNewMeeting] = useState({
    employeeId: '',
    scheduledDate: '',
    duration: 30,
    location: 'Virtual',
    meetingType: 'weekly'
  });

  if (status === 'loading' || userLoading || upcomingLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="50vh">
        <CircularProgress />
      </Box>
    );
  }

  const handleCreateMeeting = async () => {
    try {
      await api.post('/one-on-ones', newMeeting);
      setDialogOpen(false);
      setNewMeeting({ employeeId: '', scheduledDate: '', duration: 30, location: 'Virtual', meetingType: 'weekly' });
      mutateUpcoming();
    } catch (error) {
      console.error('Error creating meeting:', error);
    }
  };

  const handleCompleteMeeting = async (meetingId: string) => {
    try {
      await api.post(`/one-on-ones/${meetingId}/complete`, {});
      mutateUpcoming();
      mutatePast();
    } catch (error) {
      console.error('Error completing meeting:', error);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'success';
      case 'scheduled': return 'primary';
      case 'cancelled': return 'error';
      default: return 'default';
    }
  };

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4" fontWeight="bold">
          1:1 Meetings
        </Typography>
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

      <Tabs value={tabValue} onChange={(_, v) => setTabValue(v)} sx={{ mb: 3 }}>
        <Tab label={`Upcoming (${upcomingMeetings?.length || 0})`} />
        <Tab label={`Past (${pastMeetings?.length || 0})`} />
      </Tabs>

      {tabValue === 0 && (
        <Grid container spacing={3}>
          {upcomingMeetings?.length === 0 ? (
            <Grid size={12}>
              <Alert severity="info">No upcoming 1:1 meetings scheduled.</Alert>
            </Grid>
          ) : (
            upcomingMeetings?.map((meeting: any) => (
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
                            {meeting.meetingType} 1:1
                          </Typography>
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
          {pastMeetings?.length === 0 ? (
            <Grid size={12}>
              <Alert severity="info">No past meetings to show.</Alert>
            </Grid>
          ) : (
            pastMeetings?.map((meeting: any) => (
              <Grid size={{ xs: 12, md: 6, lg: 4 }} key={meeting._id}>
                <Card sx={{ height: '100%', opacity: meeting.status === 'cancelled' ? 0.6 : 1 }}>
                  <CardContent>
                    <Box display="flex" justifyContent="space-between" alignItems="start" mb={2}>
                      <Typography variant="subtitle1" fontWeight="medium">
                        {meeting.meetingType} 1:1
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
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button 
            onClick={handleCreateMeeting} 
            variant="contained"
            disabled={!newMeeting.employeeId || !newMeeting.scheduledDate}
          >
            Schedule
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
              {selectedMeeting.meetingType} 1:1 Meeting
            </DialogTitle>
            <DialogContent>
              <Grid container spacing={2}>
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

                {selectedMeeting.agendaItems?.length > 0 && (
                  <Grid size={12}>
                    <Typography variant="h6" gutterBottom>Agenda</Typography>
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
                  </Grid>
                )}

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
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
}






