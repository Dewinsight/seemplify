'use client';
import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Checkbox, CircularProgress, FormControlLabel, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import { ExpandMore, VideocamOutlined } from '@mui/icons-material';
import api from '@/lib/api';
import { FlowStep } from './AppraisalFlowEditor';
import AppraisalNativeCall from './AppraisalNativeCall';

interface Meeting { _id: string; stepId: string; title: string; mode?: string; scheduledDate: string; duration: number; status: string; conferenceUrl?: string; transcript?: string; notes?: string; summary?: string; integration?: { recordingRequested?: boolean; recordingState?: string; recordingUrl?: string; recordingAvailable?: boolean; transcriptionState?: string; summaryState?: string; summaryModel?: string } }
const getData = async (url: string) => (await api.get(url)).data.data;
const problem = (error: unknown) => (error as { response?: { data?: { error?: string } } })?.response?.data?.error || 'This request could not be completed. Please retry.';

export default function AppraisalMeetings({ appraisalId, steps, canManage, canJoin = true, onUpdated, currentStepId }: { appraisalId: string; steps: FlowStep[]; canManage: boolean; canJoin?: boolean; onUpdated: () => void; currentStepId?: string }) {
  const base = `/appraisals/${appraisalId}/meetings`;
  const { data: meetings = [], error: loadError, isLoading, mutate } = useSWR<Meeting[]>(base, getData, { refreshInterval: 30000 });
  const [error, setError] = useState(''); const [busy, setBusy] = useState(''); const [showForm, setShowForm] = useState(false);
  const [stepId, setStepId] = useState(''); const [scheduledDate, setScheduledDate] = useState(''); const [duration, setDuration] = useState(30);
  const [linkMode, setLinkMode] = useState('new'); const [meetingLink, setMeetingLink] = useState('');
  const [mode, setMode] = useState('calendar'); const [playback, setPlayback] = useState<Record<string, string>>({});
  useEffect(() => () => { Object.values(playback).forEach(url => URL.revokeObjectURL(url)); }, [playback]);
  const [record, setRecord] = useState(true); const [notice, setNotice] = useState(false); const [notes, setNotes] = useState<Record<string, string>>({});
  const [connection, setConnection] = useState<{ connected: boolean; email: string; connectUrl: string } | null>(null);
  const available = steps.filter(step => !meetings.some(meeting => meeting.stepId === step.id && (meeting.conferenceUrl || meeting.mode === 'in_app')));
  const run = async (key: string, action: () => Promise<unknown>) => { setBusy(key); setError(''); try { await action(); await mutate(); onUpdated(); } catch (error) { setError(problem(error)); } finally { setBusy(''); } };
  const openForm = () => run('connection', async () => { setStepId(available[0]?.id || ''); setShowForm(true); const result = await getData(`${base}/connection`); setConnection(result); });
  if (!steps.length) return null;
  return <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, mb: 3 }}>
    <Stack direction="row" gap={1} alignItems="center" mb={1}><VideocamOutlined color="action" /><Typography component="h2" variant="h6">Appraisal calls and notes</Typography></Stack>
    <Typography variant="body2" color="text.secondary" mb={2}>Choose a calendar meeting with a visible Nylas notetaker, or a private in-app call. Transcripts and meeting notes stay with this appraisal and are visible to people who can access it.</Typography>
    {isLoading && <CircularProgress size={24} aria-label="Loading appraisal meetings" />}
    {loadError && <Alert severity="error" action={<Button onClick={() => mutate()}>Retry</Button>}>Calls could not be loaded.</Alert>}
    {error && <Alert severity="error" sx={{ mb: 2 }} role="alert">{error}</Alert>}
    {!isLoading && !loadError && !meetings.length && <Typography color="text.secondary" mb={2}>No calls scheduled yet. The reviewer can schedule each call before its step opens.</Typography>}
    {meetings.map(meeting => <Accordion key={meeting._id} defaultExpanded={meeting.stepId === currentStepId} disableGutters variant="outlined" sx={{ mb: 1 }}>
      <AccordionSummary expandIcon={<ExpandMore />}><Box><Typography fontWeight={600}>{meeting.title}</Typography><Typography variant="body2" color="text.secondary">{new Date(meeting.scheduledDate).toLocaleString()} · {meeting.duration} min · {meeting.status.replaceAll('_', ' ')}</Typography></Box></AccordionSummary>
      <AccordionDetails><Stack spacing={2}>
        {!meeting.conferenceUrl && meeting.mode !== 'in_app' && <Alert severity="warning">The calendar has not confirmed a meeting link. Use Schedule a call to retry the connection; an uncertain provider result must be checked before creating another invitation.</Alert>}
        {meeting.mode === 'in_app' && canJoin && !['completed', 'cancelled'].includes(meeting.status) && <AppraisalNativeCall base={`${base}/${meeting._id}/native`} record={Boolean(meeting.integration?.recordingRequested)} recorded={meeting.integration?.recordingAvailable} onSaved={() => { void mutate(); }} />}
        <Typography variant="body2">Recording: {(meeting.integration?.recordingState || (meeting.integration?.recordingRequested ? 'not scheduled' : 'off')).replaceAll('_', ' ')}</Typography>
        <Stack direction="row" flexWrap="wrap" gap={1}>
          {meeting.conferenceUrl && <Button component="a" href={meeting.conferenceUrl} target="_blank" rel="noopener noreferrer" variant="outlined">Join call</Button>}
          {meeting.integration?.recordingRequested && <Button disabled={!!busy} onClick={() => run(meeting._id, () => api.post(`${base}/${meeting._id}/sync`))}>Refresh recording and transcript</Button>}
          {meeting.integration?.recordingUrl && <Button component="a" href={meeting.integration.recordingUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">View recording</Button>}
          {meeting.integration?.recordingAvailable && <Button disabled={!!busy} onClick={() => run(`play-${meeting._id}`, async () => { const result = await api.get(`${base}/${meeting._id}/native/recording`, { responseType: 'blob' }); setPlayback({ [meeting._id]: URL.createObjectURL(result.data) }); })}>Play saved recording</Button>}
        </Stack>
        {playback[meeting._id] && <Box component="video" controls src={playback[meeting._id]} sx={{ width: '100%', maxHeight: 400 }} aria-label="Saved appraisal call recording" />}
        {meeting.mode === 'in_app' && meeting.integration?.recordingAvailable && !meeting.transcript && <Alert severity={meeting.integration.transcriptionState === 'failed' ? 'warning' : 'info'}>Transcript: {(meeting.integration.transcriptionState || 'pending').replaceAll('_', ' ')}. Use Refresh recording and transcript to retry. No speech detected means no transcript or AI notes can be generated.</Alert>}
        {meeting.mode !== 'in_app' && meeting.integration?.recordingRequested && !meeting.transcript && <Typography variant="body2" color="text.secondary">Admit the notetaker when it joins. Media appears after the call ends and Nylas finishes processing. Calendar creation alone does not produce a transcript.</Typography>}
        {meeting.transcript && <Accordion variant="outlined"><AccordionSummary expandIcon={<ExpandMore />}>Transcript</AccordionSummary><AccordionDetails><Box component="pre" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', font: 'inherit', maxHeight: 360, overflowY: 'auto' }}>{meeting.transcript}</Box></AccordionDetails></Accordion>}
        {meeting.summary && <Box><Typography component="h3" fontWeight={600}>AI meeting notes</Typography><Typography variant="caption" color="text.secondary">Drafted with ChatGPT · {meeting.integration?.summaryModel || 'model not reported'}. Check names, decisions and action items before relying on these notes.</Typography><Typography sx={{ whiteSpace: 'pre-wrap', mt: 1 }}>{meeting.summary}</Typography></Box>}
        {meeting.transcript && <Button sx={{ alignSelf: 'flex-start' }} disabled={!!busy} onClick={() => run(meeting._id, () => api.post(`${base}/${meeting._id}/summary`))}>{meeting.summary ? 'Regenerate AI notes with my ChatGPT account' : 'Create meeting notes with my ChatGPT account'}</Button>}
        {meeting.notes && <Box><Typography fontWeight={600}>Agreed meeting notes</Typography><Typography sx={{ whiteSpace: 'pre-wrap' }}>{meeting.notes}</Typography></Box>}
        {canManage && meeting.status !== 'completed' && <><TextField multiline minRows={3} label="Agreed meeting notes" helperText="Record the discussion and agreed actions. You can complete the step with these notes even if recording was off or processing failed." value={notes[meeting._id] || ''} onChange={event => setNotes({ ...notes, [meeting._id]: event.target.value })} slotProps={{ htmlInput: { maxLength: 10000 } }} /><Button variant="contained" sx={{ alignSelf: 'flex-start' }} disabled={!!busy || meeting.stepId !== currentStepId || new Date(meeting.scheduledDate).getTime() > Date.now()} onClick={() => run(meeting._id, () => api.post(`${base}/${meeting._id}/complete`, { notes: notes[meeting._id] }))}>Complete call step</Button>{meeting.stepId !== currentStepId && <Typography variant="caption" color="text.secondary">Complete the preceding appraisal steps before finishing this call step.</Typography>}</>}
      </Stack></AccordionDetails>
    </Accordion>)}
    {canManage && available.length > 0 && !showForm && <Button variant="outlined" disabled={!!busy} onClick={openForm}>Schedule a call</Button>}
    {showForm && <Box component="form" mt={2} onSubmit={event => { event.preventDefault(); void run('schedule', async () => { await api.post(base, { mode, stepId, scheduledDate: new Date(scheduledDate).toISOString(), duration, meetingLink: linkMode === 'existing' ? meetingLink : undefined, record, recordingNoticeAccepted: notice }); setShowForm(false); }); }}>
      <Stack spacing={2}>
        <TextField select label="Call type" value={mode} onChange={event => setMode(event.target.value)}><MenuItem value="calendar">Nylas calendar meeting</MenuItem><MenuItem value="in_app">In-app call</MenuItem></TextField>
        {mode === 'calendar' && connection && <Alert severity={connection.connected ? 'info' : 'warning'}>{connection.connected ? `Calendar organizer: ${connection.email}` : 'Connect your own calendar in Recruiter, then return and retry. Application credentials are shared; personal calendar access is not.'}{!connection.connected && <Button component="a" href={connection.connectUrl} target="_blank" rel="noopener noreferrer">Open calendar connections</Button>}</Alert>}
        {mode === 'in_app' && <Alert severity="info">Both participants open this appraisal and join here. No calendar connection is needed. Recorded segments support up to 30 minutes; schedule another call step for longer discussions.</Alert>}
        <TextField select required label="Appraisal call step" value={stepId} onChange={event => setStepId(event.target.value)}>{available.map(step => <MenuItem key={step.id} value={step.id}>Call {steps.indexOf(step) + 1}: {step.label}</MenuItem>)}</TextField>
        <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}><TextField required fullWidth type="datetime-local" label="Call starts (your local time)" value={scheduledDate} onChange={event => setScheduledDate(event.target.value)} slotProps={{ inputLabel: { shrink: true } }} /><TextField required type="number" label="Duration (minutes)" value={duration} onChange={event => setDuration(Number(event.target.value))} slotProps={{ htmlInput: { min: 15, max: 480 } }} /></Stack>
        {mode === 'calendar' && <TextField select label="Meeting link" value={linkMode} onChange={event => setLinkMode(event.target.value)}><MenuItem value="new">Create with my calendar provider</MenuItem><MenuItem value="existing">Use an existing Google Meet, Teams or Zoom link</MenuItem></TextField>}
        {mode === 'calendar' && linkMode === 'existing' && <TextField required type="url" label="Existing meeting link" value={meetingLink} onChange={event => setMeetingLink(event.target.value)} />}
        <FormControlLabel control={<Checkbox checked={record} onChange={(_, checked) => setRecord(checked)} />} label="Record and transcribe this call" />
        {record && <FormControlLabel control={<Checkbox required checked={notice} onChange={(_, checked) => setNotice(checked)} />} label={mode === 'in_app' ? 'I will obtain both participants’ agreement before recording. Deepgram transcribes the audio; my personal ChatGPT connection creates meeting notes.' : 'I will inform participants and obtain their consent before admitting the recording notetaker.'} />}
        <Stack direction="row" gap={1}><Button type="submit" variant="contained" disabled={!!busy || (mode === 'calendar' && !connection?.connected)}>{busy === 'schedule' ? 'Scheduling…' : mode === 'in_app' ? 'Schedule in-app call' : 'Create calendar invitation'}</Button><Button disabled={!!busy} onClick={() => setShowForm(false)}>Cancel</Button></Stack>
      </Stack>
    </Box>}
  </Paper>;
}
