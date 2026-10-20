'use client';
import { useState } from 'react';
import { Alert, Button, Stack, TextField } from '@mui/material';
import { ContentCopyOutlined, MailOutline } from '@mui/icons-material';
import api from '@/lib/api';

export default function MeetingActions({ base, link, canRemind }: { base: string; link?: string; canRemind: boolean }) {
  const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [copyFailed, setCopyFailed] = useState(false);
  const [busy, setBusy] = useState(false); const [queuedUntil, setQueuedUntil] = useState(0);
  async function copy() {
    setMessage(''); setError('');
    try { await navigator.clipboard.writeText(link!); setCopyFailed(false); setMessage('Meeting link copied.'); }
    catch { setCopyFailed(true); setError('Your browser blocked clipboard access. Select and copy the link below.'); }
  }
  async function remind() {
    setBusy(true); setError(''); setMessage('');
    try { const response = await api.post(`${base}/reminder`); setMessage(response.data.data.message); setQueuedUntil((Math.floor(Date.now() / 300000) + 1) * 300000); }
    catch (failure) { setError((failure as { response?: { data?: { error?: string } } }).response?.data?.error || 'The reminder could not be queued. Please retry.'); }
    finally { setBusy(false); }
  }
  return <Stack gap={1}>
    <Stack direction="row" gap={1} flexWrap="wrap" sx={{ '& .MuiButton-root': { minHeight: 44 } }}>
      {link && <Button startIcon={<ContentCopyOutlined />} onClick={() => void copy()}>Copy meeting link</Button>}
      {canRemind && <Button startIcon={<MailOutline />} disabled={busy || queuedUntil > Date.now()} onClick={() => void remind()}>{busy ? 'Queuing reminder…' : queuedUntil > Date.now() ? 'Reminder queued' : 'Send reminder email'}</Button>}
    </Stack>
    {message && <Alert severity="success" role="status">{message}</Alert>}
    {error && <Alert severity="warning">{error}</Alert>}
    {copyFailed && link && <TextField label="Meeting link" value={link} slotProps={{ input: { readOnly: true } }} onFocus={event => event.target.select()} />}
  </Stack>;
}
