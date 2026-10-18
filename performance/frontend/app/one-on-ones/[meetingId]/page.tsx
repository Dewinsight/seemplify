'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import useSWR, { mutate as refreshResource } from 'swr';
import { Alert, Box, Button, Chip, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import { ArrowBack } from '@mui/icons-material';
import { useUserContext } from '@/lib/hooks';
import api from '@/lib/api';
import AppraisalMeetings from '@/components/appraisals/AppraisalMeetings';
import { useState } from 'react';

export default function OneOnOneDetails() {
  const { meetingId } = useParams<{ meetingId: string }>();
  const { user, isHRAdmin } = useUserContext();
  const { data: meeting, error, isLoading, mutate } = useSWR(`/one-on-ones/${meetingId}`, async url => (await api.get(url)).data.data);
  const [actionError, setActionError] = useState(''); const [busy, setBusy] = useState(false);
  if (isLoading) return <CircularProgress aria-label="Loading meeting" />;
  if (error || !meeting) return <Stack spacing={2}><Button component={Link} href="/one-on-ones" startIcon={<ArrowBack />}>Back to 1:1 meetings</Button><Alert severity="error" action={<Button onClick={() => mutate()}>Retry</Button>}>This meeting could not be loaded. It may no longer be available to your account.</Alert></Stack>;
  const ownIds = [user?.id, user?.sub, user?.idpSub].filter(Boolean).map(String);
  const organizer = ownIds.includes(String(meeting.managerId));
  const participant = organizer || ownIds.includes(String(meeting.employeeId));
  const canManage = organizer || isHRAdmin;
  const closed = ['completed', 'cancelled', 'no_show'].includes(meeting.status);
  const back = closed || new Date(meeting.scheduledDate).getTime() < Date.now() ? '/one-on-ones?tab=history' : '/one-on-ones';
  return <Box sx={{ maxWidth: 1040, mx: 'auto' }}>
    <Button component={Link} href={back} startIcon={<ArrowBack />} sx={{ mb: 2 }}>Back to 1:1 meetings</Button>
    <Stack spacing={1} sx={{ mb: 3 }}>
      <Typography variant="h4" component="h1" fontWeight={700}>{meeting.title || '1:1 meeting'}</Typography>
      <Typography color="text.secondary">{meeting.managerInfo?.name || 'Organizer'} and {meeting.employeeInfo?.name || 'Participant'}</Typography>
      <Typography color="text.secondary">{new Date(meeting.scheduledDate).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })} · {meeting.duration} minutes</Typography>
      <Chip variant="outlined" label={meeting.call?.integration?.calendarState === 'needs_attention' ? 'Invitation needs attention' : String(meeting.status).replaceAll('_', ' ')} sx={{ alignSelf: 'flex-start' }} />
    </Stack>
    {actionError && <Alert severity="error" sx={{ mb: 2 }}>{actionError}</Alert>}
    {meeting.appraisalId ? <Alert severity="info" action={<Button component={Link} href={`/appraisals/${meeting.appraisalId}`}>Open appraisal</Button>}>This call belongs to an appraisal. Open it there to join or review its recording and notes.</Alert>
      : meeting.call ? <AppraisalMeetings oneOnOneId={meetingId} steps={[]} canManage={canManage} canJoin={participant} participantName={organizer ? meeting.employeeInfo?.name : meeting.managerInfo?.name} ownName={user?.name} onUpdated={() => { void mutate(); }} />
      : <Paper variant="outlined" sx={{ p: 2.5 }}><Stack spacing={2}>
        <Alert severity="info">This is an older meeting record. New meetings can use an in-app call or your connected calendar.</Alert>
        {meeting.nylas?.conferenceUrl?.startsWith('https://') && <Button component="a" href={meeting.nylas.conferenceUrl} target="_blank" rel="noopener noreferrer">Open meeting link</Button>}
        <Typography component="h2" variant="h6">Meeting notes</Typography><Typography sx={{ whiteSpace: 'pre-wrap' }}>{meeting.sharedNotes || 'No agreed notes were recorded.'}</Typography>
        {meeting.transcript?.content && <><Typography component="h2" variant="h6">Transcript</Typography><Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{meeting.transcript.content}</Typography></>}
      </Stack></Paper>}
    {meeting.agendaItems?.length > 0 && <Paper variant="outlined" sx={{ p: 2.5, mt: 2 }}><Typography component="h2" variant="h6">Agenda</Typography>{meeting.agendaItems.map((item: { _id: string; topic: string }) => <Typography key={item._id} sx={{ mt: 1 }}>{item.topic}</Typography>)}</Paper>}
    {meeting.actionItems?.length > 0 && <Paper variant="outlined" sx={{ p: 2.5, mt: 2 }}><Typography component="h2" variant="h6">Agreed actions</Typography>{meeting.actionItems.map((item: { _id: string; description: string; assignedToName?: string; status: string }) => <Box key={item._id} sx={{ mt: 1.5 }}><Typography>{item.description}</Typography><Typography variant="body2" color="text.secondary">{item.assignedToName || 'Unassigned'} · {item.status.replaceAll('_', ' ')}</Typography></Box>)}</Paper>}
    {canManage && !closed && !meeting.appraisalId && <Button color="error" disabled={busy} sx={{ mt: 2 }} onClick={async () => {
      if (!window.confirm('Cancel this meeting and its calendar invitation? Saved recordings and notes will remain available.')) return;
      setBusy(true); setActionError('');
      try { await api.delete(`/one-on-ones/${meetingId}`); await Promise.all([mutate(), refreshResource(`/one-on-ones/${meetingId}/call`)]); }
      catch (failure) { setActionError((failure as { response?: { data?: { error?: string } } }).response?.data?.error || 'Cancellation could not be confirmed. Please retry.'); }
      finally { setBusy(false); }
    }}>Cancel meeting</Button>}
  </Box>;
}
