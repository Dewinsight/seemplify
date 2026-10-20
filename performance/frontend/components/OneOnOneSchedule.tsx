'use client';
import CalendarConnectButton from './appraisals/CalendarConnectButton';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormControlLabel, FormLabel, MenuItem, Radio, RadioGroup, Stack, TextField, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import Link from 'next/link';
import api from '@/lib/api';

type Person = { userId?: string; id?: string; _id?: string; name?: string; email?: string };
type Connection = { connected: boolean; email?: string; connectUrl?: string };
const localTime = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
export default function OneOnOneSchedule({ open, onClose, people, initialEmployeeId, onCreated, returnTo }: { open: boolean; onClose: () => void; people: Person[]; initialEmployeeId?: string; onCreated: () => void; returnTo?: string }) {
  const router = useRouter();
  const assessmentReturn = /^\/competency\/assessments\/[a-f\d]{24}$/i.test(returnTo || '') ? returnTo : undefined;
  const [employeeId, setEmployeeId] = useState(''); const [mode, setMode] = useState('in_app');
  const [start, setStart] = useState(''); const [duration, setDuration] = useState(30); const [requestId, setRequestId] = useState('');
  const [meetingType, setMeetingType] = useState('weekly');
  const [record, setRecord] = useState(true); const [notice, setNotice] = useState(false);
  const [linkMode, setLinkMode] = useState('new'); const [meetingLink, setMeetingLink] = useState('');
  const [connection, setConnection] = useState<Connection | null>(null); const [checking, setChecking] = useState(false); const [connectionError, setConnectionError] = useState(false);
  const [error, setError] = useState(''); const [pendingId, setPendingId] = useState(''); const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setEmployeeId(initialEmployeeId || ''); setMode('in_app'); setStart(localTime(new Date(Date.now() + 5 * 60000))); setDuration(30); setRequestId(crypto.randomUUID()); setRecord(true); setNotice(false); setError(''); setPendingId(''); setConnection(null); setConnectionError(false); setMeetingLink(''); setLinkMode('new'); } }, [open, initialEmployeeId]);
  const checkConnection = async () => {
    setChecking(true); setConnectionError(false); setConnection(null);
    try { setConnection((await api.get('/one-on-ones/call-connection')).data.data); }
    catch { setConnectionError(true); }
    finally { setChecking(false); }
  };
  const tooLong = mode === 'in_app' && record && duration > 30;
  return <Dialog open={open} onClose={() => { if (!saving) onClose(); }} maxWidth="sm" fullWidth>
    <Box component="form" aria-label="Schedule a 1:1 call" sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, maxHeight: 'calc(100dvh - 64px)' }} onSubmit={async event => {
      event.preventDefault(); setError('');
      if (!start || new Date(start).getTime() <= Date.now()) { setError('Choose a future start time.'); return; }
      setSaving(true);
      try {
        const result = await api.post('/one-on-ones', { employeeId, mode, meetingType, scheduledDate: new Date(start).toISOString(), duration, requestId, record, recordingNoticeAccepted: notice, meetingLink: mode === 'calendar' && linkMode === 'existing' ? meetingLink : undefined });
        onCreated(); onClose(); router.push(`/one-on-ones/${result.data.data._id}${assessmentReturn ? `?returnTo=${encodeURIComponent(assessmentReturn)}` : ''}`);
      } catch (failure) {
        const data = (failure as { response?: { data?: { error?: string; data?: { meetingId?: string } } } }).response?.data;
        setError(data?.error || 'The call could not be scheduled. Please retry.'); setPendingId(data?.data?.meetingId || '');
      } finally { setSaving(false); }
    }}>
      <DialogTitle>Schedule 1:1</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
        {error && <Alert severity="error">{error}{pendingId && <Button component={Link} href={`/one-on-ones/${pendingId}`} onClick={onClose}>Open saved meeting to retry</Button>}</Alert>}
        <TextField required select label="Team member" value={employeeId} onChange={event => setEmployeeId(event.target.value)} disabled={saving || Boolean(pendingId)}>{people.map(person => { const id = person.userId || person.id || person._id; return <MenuItem key={id} value={id}>{person.name || person.email}</MenuItem>; })}</TextField>
        {!people.length && <Alert severity="info">There are no other people available in the teams you manage. Check team membership in Seemplify Identity.</Alert>}
        <FormControl><FormLabel id="one-on-one-mode">Where will you meet?</FormLabel><RadioGroup aria-labelledby="one-on-one-mode" value={mode} onChange={event => { setMode(event.target.value); setNotice(false); if (event.target.value === 'calendar') void checkConnection(); }} sx={{ mt: 1, gap: 1, flexDirection: { xs: 'column', sm: 'row' } }}>
          {[{ id: 'in_app', name: 'In-app call', help: 'Meet here. No calendar connection needed.' }, { id: 'calendar', name: 'Calendar meeting', help: 'Send an invitation with a Meet, Teams or Zoom link.' }].map(option => <FormControlLabel key={option.id} disabled={saving || Boolean(pendingId)} value={option.id} control={<Radio />} sx={{ m: 0, p: 1.25, flex: 1, alignItems: 'flex-start', border: 1, borderRadius: 2, borderColor: mode === option.id ? 'primary.main' : 'divider', bgcolor: theme => mode === option.id ? alpha(theme.palette.primary.main, .04) : 'transparent' }} label={<Box><Typography fontWeight={600}>{option.name}</Typography><Typography variant="body2" color="text.secondary">{option.help}</Typography></Box>} />)}
        </RadioGroup></FormControl>
        {mode === 'calendar' && <Box role="status" aria-live="polite">{checking ? <Typography>Checking your calendar connection…</Typography> : connectionError ? <Alert severity="warning" action={<Button onClick={checkConnection}>Retry</Button>}>We could not check your calendar. Retry or choose an in-app call.</Alert> : connection && <Alert severity={connection.connected ? 'info' : 'warning'}>{connection.connected ? `Invitation will be sent from: ${connection.email}` : 'Connect your calendar, then return here and check again.'}{!connection.connected && <Stack direction="row" gap={1} flexWrap="wrap"><CalendarConnectButton connectionPath="/one-on-ones/call-connection" /><Button onClick={checkConnection}>Check again</Button></Stack>}</Alert>}</Box>}
        {mode === 'in_app' && <Alert severity="info">Both participants join from the meeting details. Recorded in-app calls support up to 30 minutes.</Alert>}
        <TextField required type="datetime-local" label="Call starts (your local time)" value={start} disabled={saving || Boolean(pendingId)} onChange={event => setStart(event.target.value)} helperText={`Time zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`} slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: localTime(new Date()) } }} />
        <TextField select label="Duration (minutes)" value={duration} disabled={saving || Boolean(pendingId)} onChange={event => setDuration(Number(event.target.value))}>{[15, 30, 45, 60].map(value => <MenuItem key={value} value={value}>{value} minutes</MenuItem>)}</TextField>
        <TextField select label="Meeting type" value={meetingType} disabled={saving || Boolean(pendingId)} onChange={event => setMeetingType(event.target.value)} helperText="This labels the check-in. Each scheduled call has its own invitation.">{[{ value: 'weekly', label: 'Weekly' }, { value: 'biweekly', label: 'Biweekly' }, { value: 'monthly', label: 'Monthly' }, { value: 'adhoc', label: 'Ad hoc' }].map(option => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}</TextField>
        {mode === 'calendar' && <><TextField select label="Meeting link" value={linkMode} disabled={saving || Boolean(pendingId)} onChange={event => setLinkMode(event.target.value)}><MenuItem value="new">Create with my calendar provider</MenuItem><MenuItem value="existing">Use an existing Meet, Teams or Zoom link</MenuItem></TextField>{linkMode === 'existing' && <TextField required type="url" label="Existing meeting link" value={meetingLink} disabled={saving || Boolean(pendingId)} onChange={event => setMeetingLink(event.target.value)} />}</>}
        <FormControlLabel control={<Checkbox checked={record} disabled={saving || Boolean(pendingId)} onChange={(_, value) => { setRecord(value); setNotice(false); }} />} label="Record and transcribe this call" />
        {tooLong && <Alert severity="warning">Choose 30 minutes or less for an in-app recording, or turn recording off.</Alert>}
        {record && mode === 'calendar' && <Alert severity="info">The invitation is created first. Both participants must separately agree in the meeting details before the recording notetaker is scheduled.</Alert>}
        {record && <><FormControlLabel control={<Checkbox required checked={notice} disabled={saving || Boolean(pendingId)} onChange={(_, value) => setNotice(value)} />} label={mode === 'in_app' ? 'I will ask both participants to agree before recording starts.' : 'I will tell the other participant to review recording permissions in the meeting details before the call.'} /><Typography variant="body2" color="text.secondary">Recordings, transcripts and notes stay with this meeting in Past calls & history. AI notes use your own connected ChatGPT account.</Typography></>}
      </Stack></DialogContent>
      <DialogActions sx={{ p: 2, flexWrap: 'wrap', gap: 1 }}><Button onClick={onClose} disabled={saving}>{pendingId ? 'Close' : 'Cancel'}</Button><Button type="submit" variant="contained" disabled={saving || !employeeId || tooLong || Boolean(pendingId) || (record && !notice) || (mode === 'calendar' && (checking || !connection?.connected))}>{saving ? 'Scheduling…' : mode === 'in_app' ? 'Schedule in-app call' : 'Create calendar invitation'}</Button></DialogActions>
    </Box>
  </Dialog>;
}
