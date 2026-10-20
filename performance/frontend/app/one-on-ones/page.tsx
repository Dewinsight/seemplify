'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import CalendarAccount from '@/components/appraisals/CalendarAccount';
import OneOnOneSchedule from '@/components/OneOnOneSchedule';
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
  const [historyPage, setHistoryPage] = useState(0);
  const { meetings: upcomingMeetings, isLoading: upcomingLoading, isError: upcomingError, mutate: mutateUpcoming } = useOneOnOnes({ upcoming: true });
  const { meetings: pastMeetings, hasMore: moreHistory, isLoading: pastLoading, isError: pastError, mutate: mutatePast } = useOneOnOnes({ upcoming: false, page: historyPage });

  const [calendarOpen, setCalendarOpen] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedMeeting, setSelectedMeeting] = useState<any>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [agendaTopic, setAgendaTopic] = useState('');
  const [withUserId, setWithUserId] = useState('');
  const [search, setSearch] = useState('');
  const [initialEmployeeId, setInitialEmployeeId] = useState('');

  const currentUserIds = useMemo(() => new Set([
    user?.id, user?._id, user?.userId, user?.idpSub, user?.sub,
  ].filter(Boolean).map(String)), [user]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const employeeId = params.get('employeeId');
    if (params.get('tab') === 'history') setTabValue(1);
    setWithUserId(params.get('with') || '');
    if (employeeId) {
      setInitialEmployeeId(employeeId);
    }
    if (employeeId || params.get('compose') === 'true') {
      setDialogOpen(true);
    }
  }, []);

  const upcomingRows = useMemo(() => withUserId
    ? (upcomingMeetings || []).filter((meeting: any) => [meeting.employeeId, meeting.managerId].map(String).includes(withUserId))
    : (upcomingMeetings || []), [upcomingMeetings, withUserId]);
  const pastRows = useMemo(() => withUserId
    ? (pastMeetings || []).filter((meeting: any) => [meeting.employeeId, meeting.managerId].map(String).includes(withUserId))
    : (pastMeetings || []), [pastMeetings, withUserId]);

  const matches = (meeting: any) => [meeting.title, meeting.employeeInfo?.name, meeting.managerInfo?.name].some(value => String(value || '').toLowerCase().includes(search.toLowerCase().trim()));
  const upcomingDisplay = upcomingRows.filter(matches);
  const pastDisplay = pastRows.filter(matches);

  if (userLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="50vh">
        <CircularProgress />
      </Box>
    );
  }

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

      {isManager && <Box sx={{ mb: 3 }}><Button color="inherit" variant="outlined" sx={{ minHeight: 44 }} aria-expanded={calendarOpen} onClick={() => setCalendarOpen(value => !value)}>{calendarOpen ? 'Hide calendar account' : 'Manage my calendar account'}</Button>{calendarOpen && <Box sx={{ mt: 2 }}><CalendarAccount connectionPath="/one-on-ones/call-connection" /></Box>}</Box>}
      {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}

      <Tabs value={tabValue} onChange={(_, v) => { setTabValue(v); const url = new URL(window.location.href); if (v === 1) url.searchParams.set("tab", "history"); else url.searchParams.delete("tab"); window.history.replaceState(null, "", url.pathname + url.search); }} sx={{ mb: 3 }}>
        <Tab label={`Upcoming (${upcomingDisplay.length})`} />
        <Tab label={`Past calls & history (${pastDisplay.length})`} />
      </Tabs>

      {(upcomingError || pastError) && <Alert severity="error" action={<Button onClick={() => { void mutateUpcoming(); void mutatePast(); }}>Retry</Button>} sx={{ mb: 2 }}>Meetings could not be loaded. Please retry.</Alert>}
      <TextField fullWidth size="small" label="Search displayed meetings by person or title" value={search} onChange={event => setSearch(event.target.value)} sx={{ mb: 3 }} />
      {(upcomingLoading || pastLoading) && <LinearProgress aria-label="Loading meetings" sx={{ mb: 2 }} />}
      {tabValue === 1 && <Stack direction="row" gap={1} alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}><Typography variant="body2" color="text.secondary">Newest first · Page {historyPage + 1}</Typography><Stack direction="row" gap={1}><Button disabled={historyPage === 0 || pastLoading} onClick={() => { setSearch(''); setHistoryPage(value => value - 1); }}>Previous</Button><Button disabled={!moreHistory || pastLoading} onClick={() => { setSearch(''); setHistoryPage(value => value + 1); }}>Older meetings</Button></Stack></Stack>}
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
                            label={meeting.call?.integration?.calendarState === 'needs_attention' ? 'Invitation needs attention' : meeting.status}
                            color={meeting.call?.integration?.calendarState === 'needs_attention' ? 'warning' : getStatusColor(meeting.status) as any}
                          />
                        </Box>
                      </Box>
                    </Box>

                    <Box display="flex" alignItems="center" gap={1} mb={1}>
                      <Event fontSize="small" color="action" />
                      <Typography variant="body2">
                        {new Date(meeting.scheduledDate).toLocaleDateString(undefined, {
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
                      {meeting.call || meeting.location?.includes('Virtual') ?
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

                    <Box display="flex" gap={1} mt={2} flexWrap="wrap">
                      {meeting.call && <Button component={Link} href={meeting.appraisalId ? `/appraisals/${meeting.appraisalId}` : `/one-on-ones/${meeting._id}`} variant="contained" size="small">Open call & notes</Button>}
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => setSelectedMeeting(meeting)}
                      >
                        {meeting.call ? 'Agenda & actions' : 'View Details'}
                      </Button>
                      {isManager && !meeting.call && meeting.status === 'scheduled' && (
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
              <Alert severity="info">No past calls match this view. Recordings, transcripts and meeting notes will appear here after your calls.</Alert>
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
                        {new Date(meeting.scheduledDate).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
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
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{meeting.title}</Typography>
                    {meeting.call && <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mt: 1 }}><Chip size="small" variant="outlined" label={meeting.call.mode === 'in_app' ? 'In-app call' : 'Calendar meeting'} />{meeting.call.integration?.recordingAvailable || meeting.call.integration?.recordingUrl ? <Chip size="small" label="Recording available" color="success" /> : meeting.call.integration?.recordingRequested && <Chip size="small" label={`Recording: ${meeting.call.integration?.recordingState || 'pending'}`} />}</Stack>}
                    <Button component={Link} href={meeting.appraisalId ? `/appraisals/${meeting.appraisalId}` : `/one-on-ones/${meeting._id}`} variant="outlined" size="small" sx={{ mt: 2 }}>View call, transcript & notes</Button>
                  </CardContent>
                </Card>
              </Grid>
            ))
          )}
        </Grid>
      )}

      <OneOnOneSchedule open={dialogOpen} onClose={() => setDialogOpen(false)} initialEmployeeId={initialEmployeeId} people={(directReports || []).filter((person: any) => !currentUserIds.has(String(person.userId || person.id || person._id)))} onCreated={() => { void mutateUpcoming(); void mutatePast(); setNotice('1:1 call scheduled.'); }} />

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
                      {typeof selectedMeeting.employeeMood.score === 'number' && Number.isFinite(selectedMeeting.employeeMood.score) ? <Chip
                        label={`${selectedMeeting.employeeMood.score}/5`}
                        color={selectedMeeting.employeeMood.score >= 4 ? 'success' : selectedMeeting.employeeMood.score >= 3 ? 'warning' : 'error'}
                      /> : <Typography variant="body2" color="text.secondary">Not shared yet</Typography>}
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
              {selectedMeeting.call && <Button component={Link} href={selectedMeeting.appraisalId ? `/appraisals/${selectedMeeting.appraisalId}` : `/one-on-ones/${selectedMeeting._id}`} variant="contained">Open call & notes</Button>}
              {isManager && !selectedMeeting.call && selectedMeeting.status === 'scheduled' && (
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






