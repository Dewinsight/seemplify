'use client';
import { useState } from 'react';
import useSWR from 'swr';
import { Alert, Box, Button, Checkbox, FormControlLabel, Stack, Typography } from '@mui/material';
import api from '@/lib/api';
import { Section, controls, muted } from './assessment/ui';
type Consent = { required: boolean; noticeVersion: string; ownRole: 'manager' | 'employee' | null; manager: { acceptedAt?: string; revokedAt?: string }; employee: { acceptedAt?: string; revokedAt?: string }; state: string; canAcknowledge: boolean; canStart: boolean; canAddNow?: boolean; windowClosed?: boolean; canWithdraw: boolean; cancellationPending?: boolean };
const problem = (error: unknown) => { const value = error as { response?: { data?: { error?: string } } }; return typeof value.response?.data?.error === 'string' ? value.response.data.error : 'Recording permissions could not be updated. Please retry.'; };
export default function CalendarRecordingConsent({ callBase, title, onUpdated }: { callBase: string; title?: string; onUpdated?: () => void }) {
  const { data, error, mutate, isLoading } = useSWR<Consent>(`${callBase}/recording-consent`, async path => (await api.get(path)).data.data, { refreshInterval: 15000 });
  const [recording, setRecording] = useState(false); const [transcription, setTranscription] = useState(false); const [busy, setBusy] = useState(false); const [failure, setFailure] = useState('');
  async function act(kind: 'agree' | 'withdraw' | 'start') {
    if (!data) return; setBusy(true); setFailure('');
    try { await api.post(`${callBase}/recording-consent${kind === 'start' ? '/start' : ''}`, kind === 'start' ? (data.canAddNow ? { joinNow: true } : {}) : { noticeVersion: data.noticeVersion, acknowledged: kind === 'agree', ...(kind === 'agree' ? { recording, transcription } : {}) }); await mutate(); onUpdated?.(); setRecording(false); setTranscription(false); }
    catch (error) { setFailure(problem(error)); } finally { setBusy(false); }
  }
  if (isLoading || (!error && !data?.required)) return null;
  if (error) return <Alert severity="warning" sx={{ mb: 3 }} action={<Button color="inherit" onClick={() => void mutate()}>Retry</Button>}>Recording permissions are unavailable. The meeting invitation is separate from recording permission.</Alert>;
  if (!data) return null;
  return <Box sx={{ ...controls, my: 3 }}><Section title={title ? `Recording permissions: ${title}` : 'Calendar recording permissions'}><Stack gap={2}>
    <Typography sx={muted}>The Nylas meeting notetaker records and transcribes the call for your Seemplify meeting record. Both participants must agree from their own login before recording begins. Permission given during a call covers only the remaining discussion. Admit the visible notetaker when it joins. Using the transcript in an assessment requires an additional assessment permission.</Typography>
    <Stack direction={{ xs: 'column', sm: 'row' }} gap={3}><Typography>Reviewer: {data.manager.acceptedAt && !data.manager.revokedAt ? 'Agreed' : 'Waiting for agreement'}</Typography><Typography>Employee: {data.employee.acceptedAt && !data.employee.revokedAt ? 'Agreed' : 'Waiting for agreement'}</Typography></Stack>
    <Typography role="status">{({ awaiting_consent: 'Waiting for both participants. Recording has not been scheduled.', scheduled: 'Both participants agreed. The notetaker is scheduled.', joining: 'The notetaker has been asked to join. Admit it from your meeting lobby.', attending: 'The notetaker is attending the call.', in_progress: 'The notetaker is recording the call.', starting: 'Scheduling the notetaker. Please wait before retrying.', scheduling: 'Scheduling the notetaker. Please wait before retrying.', uncertain: 'The provider response is being reconciled. Do not create another notetaker.', revoked: 'Recording permission was withdrawn.', not_requested: 'No recording was requested.', legacy_unverified: 'This earlier call has no verified participant recording permission.' } as Record<string,string>)[data.state] || 'Checking recording status.'}</Typography>
    {data.state === 'legacy_unverified' && <Alert severity="info">Earlier recordings cannot be authorised retroactively. Use manual assessment notes or schedule a new call.</Alert>}
    {data.cancellationPending && <Alert severity="warning">Your permission is withdrawn. Provider cancellation is still pending; do not admit the notetaker. Retry cancellation below.</Alert>}
    {data.windowClosed && <Alert severity="info">The scheduled recording window has ended. Earlier audio cannot be recovered. Schedule a new call to record another discussion.</Alert>}
    {data.ownRole && data.state === 'awaiting_consent' && !data.canStart && !data.windowClosed && <Button variant="outlined" disabled>Add notetaker to call — waiting for both permissions</Button>}
    {data.canAcknowledge && <><Typography fontWeight={650}>Your permission as the {data.ownRole === 'manager' ? 'reviewer' : 'employee'}</Typography><FormControlLabel control={<Checkbox checked={recording} disabled={busy} onChange={(_, value) => setRecording(value)} />} label="I agree to this call being recorded" /><FormControlLabel control={<Checkbox checked={transcription} disabled={busy} onChange={(_, value) => setTranscription(value)} />} label="I agree to transcription of this call" /><Button variant="contained" disabled={busy || !recording || !transcription} onClick={() => void act('agree')}>Save my recording permission</Button></>}
    <Stack direction="row" gap={1} flexWrap="wrap" sx={{ '& .MuiButton-root': { minHeight: 44 } }}>{(data.canStart || data.canAddNow) && <Button variant="outlined" disabled={busy} onClick={() => void act('start')}>{data.canAddNow ? 'Add notetaker to call' : 'Retry notetaker scheduling'}</Button>}{(data.canWithdraw || (data.cancellationPending && data.ownRole)) && <Button variant="outlined" disabled={busy} onClick={() => void act('withdraw')}>{data.cancellationPending ? 'Retry notetaker cancellation' : 'Withdraw my recording permission'}</Button>}<Button disabled={busy} onClick={() => void mutate()}>Refresh permissions</Button></Stack>
    {failure && <Alert severity="error">{failure}</Alert>}
  </Stack></Section></Box>;
}
