'use client';
import { useState } from 'react';
import useSWR from 'swr';
import { Alert, Box, Button, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Stack, Typography } from '@mui/material';
import api from '@/lib/api';
import CalendarConnectButton from './CalendarConnectButton';

type Connection = { connected: boolean; email: string | null; provider?: string | null; disconnectPending?: boolean };
export default function CalendarAccount({ base, connectionPath, readOnly = false }: { base?: string; connectionPath?: string; readOnly?: boolean }) {
  const path = connectionPath || `${base}/connection`;
  const { data, error, isLoading, mutate } = useSWR<Connection>(path, async key => (await api.get(key)).data.data, { revalidateOnFocus: true, dedupingInterval: 30000 });
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const disconnect = async () => {
    setBusy(true); setFailure('');
    try {
      const response = await api.post(`${path}/disconnect`);
      if (!response.data.data.disconnected) throw new Error('Your connection changed. Check the account and retry.');
      setConfirm(false);
    } catch (reason) {
      setFailure((reason as { response?: { data?: { error?: string } }; message?: string }).response?.data?.error || (reason as Error).message || 'Calendar disconnect failed. Retry.');
    } finally { await mutate(); setBusy(false); }
  };
  return <Box sx={{ mb: 2 }}>
    <Typography component="h3" variant="subtitle2" mb={1}>Your Nylas calendar account</Typography>
    {isLoading ? <Typography variant="body2" role="status">Checking your connected email…</Typography> : error ? <Alert severity="warning" action={<Button onClick={() => void mutate()}>Retry</Button>}>Your calendar account could not be checked.</Alert> : data && <Stack gap={1}>
      <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{data.connected ? `${data.email} · ${data.provider === 'google' ? 'Google Calendar' : data.provider === 'microsoft' ? 'Microsoft Calendar' : data.provider || 'Calendar'}` : data.disconnectPending ? 'Calendar disconnect is pending. Retry to revoke access in Nylas.' : 'No verified calendar connected to your account.'}</Typography>
      <Typography variant="body2" color="text.secondary">This is your personal calendar connection, shared with Recruiter. Connect a new email to change the account used for future invitations. Existing invitations stay on their original calendar. Disconnecting can interrupt calendar sync. Manage a running notetaker separately in its call controls.</Typography>
      {!readOnly && <Stack direction="row" flexWrap="wrap" gap={1} sx={{ '& .MuiButton-root': { minHeight: 44 } }}>
        <CalendarConnectButton connectionPath={path} connected={data.connected} disabled={busy || data.disconnectPending} />
        {(data.connected || data.disconnectPending) && <Button color="inherit" variant="outlined" disabled={busy} onClick={() => { setFailure(''); setConfirm(true); }}>{data.disconnectPending ? 'Retry calendar disconnect' : 'Disconnect calendar'}</Button>}
        <Button color="inherit" onClick={() => void mutate()}>Check connection again</Button>
      </Stack>}
    </Stack>}
    <Dialog open={confirm} onClose={() => { if (!busy) setConfirm(false); }} aria-labelledby="disconnect-calendar-title">
      <DialogTitle id="disconnect-calendar-title">Disconnect your calendar?</DialogTitle>
      <DialogContent><DialogContentText>Revoke Seemplify’s Nylas access to {data?.email || 'your connected calendar'}. This also disconnects this account in Recruiter. Existing invitations remain on the original calendar, but Seemplify may no longer update them. This does not stop an already running notetaker.</DialogContentText>{failure && <Alert severity="error" sx={{ mt: 2 }}>{failure}</Alert>}</DialogContent>
      <DialogActions><Button color="inherit" disabled={busy} onClick={() => setConfirm(false)}>Keep connected</Button><Button variant="contained" color="error" disabled={busy} onClick={() => void disconnect()}>{busy ? 'Disconnecting…' : 'Disconnect my calendar'}</Button></DialogActions>
    </Dialog>
  </Box>;
}
