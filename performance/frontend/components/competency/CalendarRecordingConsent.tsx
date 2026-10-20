'use client';
import { useState } from 'react';
import useSWR from 'swr';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import api from '@/lib/api';
import { Section, controls, muted } from './assessment/ui';

type Notetaker = { required: boolean; ownRole: 'manager' | 'employee' | null; state: string; canStart: boolean; canAddNow?: boolean; canStop?: boolean; windowClosed?: boolean; cancellationPending?: boolean };
const problem = (error: unknown) => { const value = error as { response?: { data?: { error?: string } } }; return value.response?.data?.error || 'The notetaker could not be updated. Please retry.'; };
export default function CalendarRecordingConsent({ callBase, title, onUpdated }: { callBase: string; title?: string; onUpdated?: () => void }) {
  const { data, error, mutate, isLoading } = useSWR<Notetaker>(`${callBase}/recording-consent`, async path => (await api.get(path)).data.data, { refreshInterval: 15000 });
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState('');
  async function act(kind: 'start' | 'stop') {
    setBusy(true); setFailure('');
    try { await api.post(`${callBase}/recording-consent/${kind}`, kind === 'start' && data?.canAddNow ? { joinNow: true } : {}); await mutate(); onUpdated?.(); }
    catch (error) { setFailure(problem(error)); } finally { setBusy(false); }
  }
  if (isLoading || (!error && !data?.required)) return null;
  if (error) return <Alert severity="warning" sx={{ mb: 3 }} action={<Button color="inherit" onClick={() => void mutate()}>Retry</Button>}>Notetaker status is unavailable. Please retry.</Alert>;
  if (!data) return null;
  return <Box sx={{ ...controls, my: 3 }}><Section title={title ? `Meeting notetaker: ${title}` : 'Meeting notetaker'}><Stack gap={2}>
    <Typography sx={muted}>The Nylas notetaker records and transcribes this call for its Seemplify meeting record. It is scheduled when recording is enabled. Admit the visible notetaker when it joins.</Typography>
    <Typography role="status">{({ awaiting_consent: 'The notetaker is ready to be scheduled.', awaiting_start: 'The notetaker is ready to be scheduled.', scheduled: 'The notetaker is scheduled.', joining: 'The notetaker has been asked to join. Admit it from your meeting lobby.', attending: 'The notetaker is attending the call.', in_progress: 'The notetaker is recording the call.', starting: 'Scheduling the notetaker. Please wait before retrying.', scheduling: 'Scheduling the notetaker. Please wait before retrying.', dispatching: 'The notetaker is joining. Please wait.', uncertain: 'The provider response is being reconciled. Refresh the status before retrying.', revoked: 'The notetaker was stopped.', not_requested: 'No recording was requested.', failed: 'The notetaker could not be scheduled. Refresh the status or contact support.' } as Record<string,string>)[data.state] || 'Checking notetaker status.'}</Typography>
    {data.cancellationPending && <Alert severity="warning">Notetaker cancellation is pending. Do not admit it; retry cancellation below.</Alert>}
    {data.windowClosed && <Alert severity="info">The scheduled recording window has ended. Unrecorded audio cannot be recovered. Schedule a new call to record another discussion.</Alert>}
    <Stack direction="row" gap={1} flexWrap="wrap" sx={{ '& .MuiButton-root': { minHeight: 44 } }}>
      {(data.canStart || data.canAddNow) && <Button variant="outlined" disabled={busy} onClick={() => void act('start')}>{data.canAddNow ? 'Add notetaker to call' : 'Schedule notetaker'}</Button>}
      {(data.canStop || (data.cancellationPending && data.ownRole)) && <Button variant="outlined" disabled={busy} onClick={() => void act('stop')}>{data.cancellationPending ? 'Retry notetaker cancellation' : 'Stop notetaker'}</Button>}
      <Button disabled={busy} onClick={() => void mutate()}>Refresh notetaker status</Button>
    </Stack>
    {failure && <Alert severity="error">{failure}</Alert>}
  </Stack></Section></Box>;
}
