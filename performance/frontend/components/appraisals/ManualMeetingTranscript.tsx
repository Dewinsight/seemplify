'use client';
import { useState } from 'react';
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import api from '@/lib/api';

export default function ManualMeetingTranscript({ base, onSaved }: { base: string; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setBusy(true); setError('');
    try { await api.post(`${base}/transcript`, { content }); setContent(''); setOpen(false); await onSaved(); }
    catch (failure) { setError((failure as { response?: { data?: { error?: string } } }).response?.data?.error || 'The transcript could not be saved. Your text is kept here; please retry.'); }
    finally { setBusy(false); }
  };
  return <Box>
    {!open ? <Button variant="outlined" onClick={() => setOpen(true)}>Add transcript manually</Button> : <Stack spacing={1.5}>
      <Typography component="h3" fontWeight={600}>Add a meeting transcript</Typography>
      <Typography variant="body2" color="text.secondary">Paste the transcript or import a text file when the recorded transcript is unavailable. It will be labelled as manually added and included in the final AI report. Adding text does not create a recording.</Typography>
      {error && <Alert severity="error">{error}</Alert>}
      <Button component="label" variant="outlined" disabled={busy} sx={{ alignSelf: 'flex-start' }}>Import transcript file
        <input hidden type="file" accept=".txt,.vtt,.srt,text/plain,text/vtt" aria-label="Transcript file" onChange={async event => {
          const file = event.target.files?.[0]; event.target.value = '';
          if (!file) return;
          if (file.size > 500000 || !/\.(txt|vtt|srt)$/i.test(file.name)) { setError('Choose a .txt, .vtt or .srt file smaller than 500 KB.'); return; }
          try { const text = await file.text(); if (text.length > 120000) { setError('The transcript must contain at most 120,000 characters.'); return; } setContent(text); setError(''); }
          catch { setError('This text file could not be read. Paste the transcript below instead.'); }
        }} />
      </Button>
      <TextField fullWidth multiline minRows={7} label="Meeting transcript" value={content} disabled={busy} onChange={event => setContent(event.target.value)} slotProps={{ htmlInput: { maxLength: 120000 } }} helperText={`${content.length.toLocaleString()} / 120,000 characters. Include speaker names where known.`} />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}><Button variant="contained" disabled={busy || !content.trim()} onClick={() => void save()}>{busy ? 'Saving transcript…' : 'Save transcript'}</Button><Button disabled={busy} onClick={() => setOpen(false)}>Close editor</Button></Stack>
    </Stack>}
  </Box>;
}
