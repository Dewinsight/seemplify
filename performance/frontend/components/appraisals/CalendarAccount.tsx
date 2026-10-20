'use client';
import useSWR from 'swr';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import api from '@/lib/api';

type Connection = { connected: boolean; email: string | null; provider?: string | null; connectUrl: string };
export default function CalendarAccount({ base }: { base: string }) {
  const { data, error, isLoading, mutate } = useSWR<Connection>(`${base}/connection`, async path => (await api.get(path)).data.data, { revalidateOnFocus: true, dedupingInterval: 30000 });
  return <Box sx={{ mb: 2 }}>
    <Typography component="h3" variant="subtitle2" mb={1}>Your calendar account</Typography>
    {isLoading ? <Typography variant="body2" role="status">Checking your connected email…</Typography> : error ? <Alert severity="warning" action={<Button onClick={() => void mutate()}>Retry</Button>}>Your calendar account could not be checked.</Alert> : data && <Stack gap={1}>
      <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{data.connected ? `${data.email} · ${data.provider === 'google' ? 'Google Calendar' : data.provider || 'Calendar'}` : 'No verified calendar connected to your account.'}</Typography>
      <Typography variant="body2" color="text.secondary">This is your personal calendar connection, shared with Recruiter. Changing it affects future invitations and may interrupt syncing or recording for existing meetings. Existing invitations stay on their original calendar. Reminder emails use Seemplify’s notification service.</Typography>
      <Stack direction="row" flexWrap="wrap" gap={1} sx={{ '& .MuiButton-root': { minHeight: 44 } }}>
        <Button component="a" href={data.connectUrl} target="_blank" rel="noopener noreferrer">{data.connected ? 'Change or disconnect email' : 'Connect an email account'} (opens new tab)</Button>
        <Button onClick={() => void mutate()}>Check connection again</Button>
      </Stack>
    </Stack>}
  </Box>;
}
