'use client';
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Chip, Stack, Typography } from '@mui/material';
import { ExpandMore } from '@mui/icons-material';
import api from '@/lib/api';

type Observation = { state: string; meetingState?: string | null; observedAt: string };
type Status = { state: string; meetingState?: string | null; checkedAt?: string | null; events: Observation[]; transcriptState?: string; realtimeTranscript: boolean; recordingAvailable?: boolean; calendarEmail?: string | null; calendarProvider?: string | null };
type Controls = { ownRole: string | null; state: string; canStart: boolean; canAddNow: boolean; canStop: boolean; windowClosed: boolean; cancellationPending: boolean };
const title = (data: Pick<Status, 'state' | 'meetingState'>) => data.meetingState === 'meeting_ended' ? 'Call ended' : data.state === 'attending' && data.meetingState === 'recording_active' ? 'Recording confirmed by Nylas' : data.meetingState === 'waiting_for_entry' ? 'Waiting in the meeting lobby' : ({ scheduled: 'Notetaker scheduled', pending: 'Notetaker scheduled', connecting: 'Notetaker connecting', joining: 'Notetaker joining', attending: 'Notetaker in the call', disconnected: 'Notetaker left the call', failed_entry: 'Notetaker could not join', revoked: 'Notetaker stopped', cancelled: 'Notetaker cancelled', ready: 'Transcript ready', processing: 'Processing call media', awaiting_start: 'Notetaker waiting to be scheduled', awaiting_consent: 'Notetaker waiting to be scheduled', not_requested: 'Recording off' } as Record<string, string>)[data.state] || 'Waiting for a confirmed notetaker status';
const reasons: Record<string, string> = { admission_timeout: 'The host did not admit the notetaker before its wait expired.', entry_denied: 'The host declined the notetaker.', sign_in_required: 'The meeting requires a signed-in participant. Check the meeting’s guest access settings.', bad_meeting_code: 'The meeting code was not accepted.', bad_meeting_link: 'The meeting link was not accepted.', meeting_capacity_reached: 'The meeting is full.', cannot_join: 'The provider could not join this meeting.', kicked: 'The notetaker was removed from the call.', network_error: 'The provider reported a network problem.', no_participants: 'The notetaker left because no participants remained.', no_activity: 'The notetaker left after detecting no activity.' };
export default function CalendarNotetakerMonitor({ base, meetingStatus, scheduledDate, duration, hasTranscript, canManage, onUpdated, readOnly = false }: { readOnly?: boolean; base: string; meetingStatus: string; scheduledDate: string; duration: number; hasTranscript: boolean; canManage: boolean; onUpdated: () => void }) {
  const { data, error, isLoading, mutate } = useSWR<Status>(`${base}/notetaker-status`, async path => (await api.get(path)).data.data, { refreshInterval: data => data?.state === 'revoked' || (hasTranscript && ['disconnected', 'completed', 'complete'].includes(data?.state || '')) ? 0 : 20000, revalidateOnFocus: true, dedupingInterval: 10000 });
  const { data: controls, mutate: refreshControls } = useSWR<Controls>(!readOnly && canManage ? `${base}/recording-consent` : null, async path => (await api.get(path)).data.data, { refreshInterval: 20000 });
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState('');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 20000); return () => window.clearInterval(timer); }, []);
  const syncAttempt = useRef('');
  const updated = useRef(onUpdated);
  useEffect(() => { updated.current = onUpdated; }, [onUpdated]);
  useEffect(() => {
    if (readOnly || !data || data.transcriptState !== 'available' || hasTranscript || data.state === 'revoked') return;
    const key = data.checkedAt || 'available';
    if (syncAttempt.current === key) return;
    syncAttempt.current = key;
    let active = true;
    void api.post(`${base}/sync`).then(() => { if (active) updated.current(); }).catch(() => { if (active) setFailure('The transcript is available in Nylas but could not be saved here. Use Refresh recording and transcript to retry.'); });
    return () => { active = false; };
  }, [base, data, hasTranscript, readOnly]);
  const act = async (kind: 'start' | 'retry' | 'stop') => {
    setBusy(true); setFailure('');
    try {
      await api.post(kind === 'retry' ? `${base}/notetaker-status/retry` : `${base}/recording-consent/${kind}`, kind === 'start' ? { joinNow: Boolean(controls?.canAddNow) } : {});
      await Promise.all([mutate(), refreshControls()]); onUpdated();
    }
    catch (reason) { setFailure((reason as { response?: { data?: { error?: string } } }).response?.data?.error || 'The notetaker could not be updated. Refresh its status.'); }
    finally { setBusy(false); }
  };
  if (isLoading) return <Typography role="status" variant="body2">Checking the live notetaker status…</Typography>;
  if (!data) return <Alert severity="warning" action={<Button color="inherit" onClick={() => void mutate()}>Check status again</Button>}>The provider status is unavailable. Recording has not been confirmed.</Alert>;
  const ended = data.events?.find(event => event.meetingState === 'meeting_ended');
  const joined = data.events?.find(event => ['connecting', 'joining', 'attending', 'in_progress'].includes(event.state));
  const recording = data.events?.find(event => event.meetingState === 'recording_active');
  const mediaPending = !hasTranscript && data.transcriptState === 'processing';
  const expectedAt = ended ? new Date(ended.observedAt).getTime() + 10 * 60000 : null;
  const delayed = mediaPending && expectedAt !== null && now >= expectedAt;
  const open = !['completed', 'cancelled', 'no_show', 'rescheduled'].includes(meetingStatus) && new Date(scheduledDate).getTime() <= now && new Date(scheduledDate).getTime() + duration * 60000 > now;
  const providerClosed = Boolean(ended) || ['disconnected', 'complete', 'completed', 'processing', 'revoked', 'cancelled'].includes(data.state);
  const canRetry = !providerClosed && data.state === 'failed_entry' && open && Boolean(controls?.ownRole) && !controls?.windowClosed;
  const canAsk = !providerClosed && Boolean(controls?.canAddNow || controls?.canStart || canRetry);
  const time = (value: string | number) => new Date(value).toLocaleTimeString();
  return <Box aria-label="Live calendar notetaker" sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 2 }}><Stack gap={1.5}>
    <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} justifyContent="space-between" alignItems={{ sm: 'center' }}><Typography component="h3" fontWeight={600}>Call recording status</Typography><Chip size="small" label={title(data)} color={data.state === 'failed_entry' ? 'warning' : data.meetingState === 'recording_active' ? 'success' : 'default'} sx={{ alignSelf: 'flex-start', height: 'auto', '& .MuiChip-label': { py: .5, whiteSpace: 'normal' } }} /></Stack>
    {error && <Alert severity="warning">Status refresh failed. The information below is from the last successful check.</Alert>}
    {data.calendarEmail && <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>Invitation created using: {data.calendarEmail}{data.calendarProvider ? ` · ${data.calendarProvider}` : ''}</Typography>}
    {data.meetingState && reasons[data.meetingState] && <Alert severity="warning">{reasons[data.meetingState]}</Alert>}
    {data.meetingState === 'waiting_for_entry' && <Alert severity="info">Admit the Seemplify notetaker from the meeting lobby. Requesting it to join cannot bypass the host’s admission controls.</Alert>}
    {controls?.cancellationPending && <Alert severity="warning">The stop request is still pending. Do not admit the bot; retry stopping it below.</Alert>}
    <Stack component="dl" gap={.75} sx={{ m: 0, '& dt': { color: 'text.secondary' }, '& dd': { m: 0 } }}>
      <Box><Typography component="dt" variant="body2">Bot joining</Typography><Typography component="dd" variant="body2">{joined ? `First observed at ${time(joined.observedAt)}` : providerClosed ? 'Join time was not observed' : 'Not confirmed yet'}</Typography></Box>
      <Box><Typography component="dt" variant="body2">Recording</Typography><Typography component="dd" variant="body2">{recording ? `Confirmed by Nylas at ${time(recording.observedAt)}` : data.recordingAvailable ? 'Recording media available' : 'Waiting for Nylas confirmation'}</Typography></Box>
      <Box><Typography component="dt" variant="body2">Call ended</Typography><Typography component="dd" variant="body2">{ended ? `Observed at ${time(ended.observedAt)}` : meetingStatus === 'completed' ? 'Marked complete in Seemplify; waiting for provider confirmation' : 'Not confirmed by Nylas'}</Typography></Box>
    </Stack>
    {data.state === 'disconnected' && data.meetingState !== 'meeting_ended' && <Typography variant="body2">The bot has left. Nylas has not confirmed that the call itself ended.</Typography>}
    {meetingStatus === 'completed' && data.meetingState !== 'meeting_ended' && <Typography variant="body2">This call step was marked complete in Seemplify. The provider’s recording status is shown above.</Typography>}
    {hasTranscript ? <Alert severity="success">Transcript saved. Open Transcript below to read it.</Alert> : data.state !== 'revoked' && <>
      <Typography variant="body2" color="text.secondary">Nylas provides this transcript after the call, rather than live captions. Allow around 10 minutes for processing after the call ends; this is an estimate, not a guaranteed delivery time.</Typography>
      {mediaPending && <Alert severity={delayed ? 'warning' : 'info'} role="status">{delayed ? 'Transcript delayed: more than 10 minutes have passed since the call was observed to end. Processing is still pending; this page will keep checking.' : `Transcript pending. ${expectedAt ? `Estimated availability around ${time(expectedAt)}. ` : ''}Nylas is processing the call media. This page will keep checking.`}</Alert>}
      {data.transcriptState === 'available' && <Typography variant="body2" role="status">The transcript is available in Nylas. {readOnly ? 'Open the saved transcript below if it has been synced.' : 'Saving it to this meeting…'}</Typography>}
    </>}
    {data.checkedAt && <Typography variant="caption" color="text.secondary">Last checked: {new Date(data.checkedAt).toLocaleTimeString()}</Typography>}
    <Stack direction="row" gap={1} flexWrap="wrap" sx={{ '& .MuiButton-root': { minHeight: 44 } }}>
      {!readOnly && canManage && <Button variant="outlined" color="inherit" disabled={busy || !canAsk} onClick={() => void act(canRetry ? 'retry' : 'start')}>{busy ? 'Updating notetaker…' : canRetry ? 'Retry bot join' : controls?.canStart && !controls.canAddNow ? 'Schedule notetaker' : 'Ask notetaker to join now'}</Button>}
      {!readOnly && ((controls?.canStop && !providerClosed) || (controls?.cancellationPending && controls.ownRole)) && <Button color="inherit" disabled={busy} onClick={() => void act('stop')}>{controls.cancellationPending ? 'Retry stopping notetaker' : 'Stop notetaker'}</Button>}
      <Button color="inherit" disabled={busy} onClick={() => void mutate()}>Check live status</Button>
    </Stack>
    {!readOnly && !canAsk && controls?.windowClosed && <Typography variant="body2" color="text.secondary">The scheduled recording window has ended. Schedule a follow-up call to record another discussion.</Typography>}
    {failure && <Alert severity="error">{failure}</Alert>}
    <Accordion disableGutters elevation={0} sx={{ '&:before': { display: 'none' }, bgcolor: 'transparent' }}><AccordionSummary expandIcon={<ExpandMore />}>Bot activity timeline ({data.events?.length || 0})</AccordionSummary><AccordionDetails>
      <Typography variant="caption" color="text.secondary">These are observed status changes, not exact provider event times. Status is checked every 20 seconds while this view is active.</Typography>
      {!data.events?.length ? <Typography variant="body2" mt={1}>No provider status changes have been observed yet.</Typography> : <Stack component="ol" gap={1} sx={{ pl: 2.5, mb: 0 }}>{data.events.map((event, index) => <Box component="li" key={`${event.observedAt}-${index}`}><Typography variant="body2">{title(event)}</Typography><Typography variant="caption" color="text.secondary">{new Date(event.observedAt).toLocaleString()}{event.meetingState && event.meetingState !== 'unknown' ? ` · ${event.meetingState.replaceAll('_', ' ')}` : ''}</Typography></Box>)}</Stack>}
    </AccordionDetails></Accordion>
  </Stack></Box>;
}
