'use client';
import { useState } from 'react';
import { Alert, Box, Button } from '@mui/material';
import api from '@/lib/api';

export default function CalendarConnectButton({ connectionPath, connected = false }: { connectionPath: string; connected?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [opened, setOpened] = useState(false);
  const connect = async () => {
    setError(''); setOpened(false);
    // Open during the click gesture; fetching the URL first would trigger popup blockers.
    const popup = window.open('about:blank', '_blank');
    if (!popup) { setError('Allow pop-ups for Performance, then try connecting again.'); return; }
    popup.opener = null;
    setBusy(true);
    try {
      const { data } = await api.post(`${connectionPath}/connect`, { provider: 'google', returnPath: window.location.pathname });
      const url = new URL(data.data.authUrl);
      if (url.protocol !== 'https:' || !/^api\.(us|eu|au)\.nylas\.com$/.test(url.hostname) || url.pathname !== '/v3/connect/auth' || url.username || url.password) throw new Error('Calendar authorization returned an invalid address.');
      if (popup.closed) throw new Error('The calendar tab was closed. Please try again.');
      popup.location.href = url.href;
      setOpened(true);
    } catch (reason) {
      popup.close();
      setError((reason as { response?: { data?: { error?: string } }; message?: string }).response?.data?.error || (reason as Error).message || 'Calendar connection could not be started. Please retry.');
    } finally { setBusy(false); }
  };
  return <Box>
    <Button color="inherit" variant="outlined" sx={{ minHeight: 44 }} disabled={busy} onClick={() => void connect()}>{busy ? 'Opening Nylas…' : connected ? 'Change connected email (opens Nylas)' : 'Connect my calendar (opens Nylas)'}</Button>
    {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
    {opened && <Alert severity="info" sx={{ mt: 1 }}>Choose your calendar account and approve access in Nylas. Then return here and check the connection again.</Alert>}
  </Box>;
}
