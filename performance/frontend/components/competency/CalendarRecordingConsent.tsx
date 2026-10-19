'use client';
import { useState } from 'react';
import useSWR from 'swr';
import { Alert, Box, Button, Checkbox, FormControlLabel, Stack, Typography } from '@mui/material';
import api from '@/lib/api';
import { Section, controls, muted } from './assessment/ui';
type Consent = { required: boolean; noticeVersion: string; ownRole: 'manager' | 'employee' | null; manager: { acceptedAt?: string; revokedAt?: string }; employee: { acceptedAt?: string; revokedAt?: string }; state: string; canAcknowledge: boolean; canStart: boolean; canWithdraw: boolean; cancellationPending?: boolean };
const problem = (error: unknown) => { const value = error as { response?: { data?: { error?: string } } }; return typeof value.response?.data?.error === 'string' ? value.response.data.error : 'Recording permissions could not be updated. Please retry.'; };
export default function CalendarRecordingConsent({ callBase, title }: { callBase: string; title?: string }) {
  const { data, error, mutate, isLoading } = useSWR<Consent>(`${callBase}/recording-consent`, async path => (await api.get(path)).data.data, { refreshInterval: 15000 });
  const [recording, setRecording] = useState(false); const [transcription, setTranscription] = useState(false); const [busy, setBusy] = useState(false); const [failure, setFailure] = useState('');
  async function act(kind: 'agree' | 'withdraw' | 'start') {
    if (!data) return; setBusy(true); setFailure('');
    try { await api.post(`${callBase}/recording-consent${kind === 'start' ? '/start' : ''}`, kind === 'start' ? {} : { noticeVersion: data.noticeVersion, acknowledged: kind === 'agree', ...(kind === 'agree' ? { recording, transcription } : {}) }); await mutate(); setRecording(false); setTranscription(false); }
    catch (error) { setFailure(problem(error)); } finally { setBusy(false); }
  }
  if (isLoading || (!error && !data?.required)) return null;
  if (error) return <Alert severity="warning" sx={{ mb: 3 }} action={<Button color="inherit" onClick={() => void mutate()}>Retry</Button>}>Recording permissions are unavailable. The meeting invitation is separate from recording permission.</Alert>;
  if (!data) return null;
  return <Box sx={{ ...controls, my: 3 }}><Section title={title ? `Recording permissions: ${title}` : 'Calendar recording permissions'}><Stack gap={2}>
    <Typography sx={muted}>The Nylas meeting notetaker records and transcribes the call for your Seemplify meeting record. Each participant must agree before it is scheduled. The calendar invitation remains separate. Using the transcript in an assessment requires an additional assessment permission.</Typography>
    <Stack direction={{ xs: 'column', sm: 'row' }} gap={3}><Typography>Reviewer: {data.manager.acceptedAt && !data.manager.revokedAt ? 'Agreed' : 'Waiting for agreement'}</Typography><Typography>Employee: {data.employee.acceptedAt && !data.employee.revokedAt ? 'Agreed' : 'Waiting for agreement'}</Typography></Stack>
    <Typography role="status">{({ awaiting_consent: 'Waiting for both participants. Recording has not been scheduled.', scheduled: 'Both participants agreed. The notetaker is scheduled.', starting: 'Scheduling the notetaker. Please wait before retrying.', scheduling: 'Scheduling the notetaker. Please wait before retrying.', uncertain: 'The provider response is being reconciled. Do not create another notetaker.', revoked: 'Recording permission was withdrawn.', not_requested: 'No recording was requested.', legacy_unverified: 'This earlier call has no verified participant recording permission.' } as Record<string,string>)[data.state] || 'Checking recording status.'}</Typography>
    {data.state === 'legacy_unverified' && <Alert severity="info">Earlier recordings cannot be authorised retroactively. Use manual assessment notes or schedule a new call.</Alert>}
    {data.cancellationPending && <Alert severity="warning">Your permission is withdrawn. Provider cancellation is still pending; do not admit the notetaker. Retry cancellation below.</Alert>}
    {data.canAcknowledge && <><Typography fontWeight={650}>Your permission as the {data.ownRole === 'manager' ? 'reviewer' : 'employee'}</Typography><FormControlLabel control={<Checkbox checked={recording} disabled={busy} onChange={(_, value) => setRecording(value)} />} label="I agree to this call being recorded" /><FormControlLabel control={<Checkbox checked={transcription} disabled={busy} onChange={(_, value) => setTranscription(value)} />} label="I agree to transcription of this call" /><Button variant="contained" disabled={busy || !recording || !transcription} onClick={() => void act('agree')}>Save my recording permission</Button></>}
    <Stack direction="row" gap={1} flexWrap="wrap">{data.canStart && <Button variant="outlined" disabled={busy} onClick={() => void act('start')}>Retry notetaker scheduling</Button>}{(data.canWithdraw || (data.cancellationPending && data.ownRole)) && <Button variant="outlined" disabled={busy} onClick={() => void act('withdraw')}>{data.cancellationPending ? 'Retry notetaker cancellation' : 'Withdraw my recording permission'}</Button>}<Button disabled={busy} onClick={() => void mutate()}>Refresh permissions</Button></Stack>
    {failure && <Alert severity="error">{failure}</Alert>}
  </Stack></Section></Box>;
}
