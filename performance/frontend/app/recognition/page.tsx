'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Avatar, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, InputLabel, MenuItem, Paper, Select, Stack, Tab, Tabs, TextField, Typography
} from '@mui/material';
import { Add, Check, Search } from '@mui/icons-material';
import api from '@/lib/api';
import { useUserSearch } from '@/lib/hooks';

type RecognitionView = 'feed' | 'received' | 'sent';

interface Person { id: string; name: string; email?: string; title?: string; teamId?: string; teamName?: string }
interface Recognition {
  _id: string; message: string; companyValue?: string; visibility: 'public' | 'team' | 'private'; contextType: string; contextLabel?: string;
  sender: { userId: string; name?: string; email?: string }; recipient: { userId: string; name?: string; email?: string; teamName?: string };
  acknowledgedAt?: string; createdAt: string;
}

function dataOf<T>(response: { data?: unknown }): T {
  const payload = response.data as { data?: T } | T;
  return ((payload as { data?: T })?.data ?? payload) as T;
}

function errorText(error: unknown, fallback: string) {
  const candidate = error as { response?: { data?: { error?: string } }; message?: string };
  return candidate.response?.data?.error || candidate.message || fallback;
}

function initials(name?: string) {
  return String(name || '?').split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

export default function RecognitionPage() {
  const [view, setView] = useState<RecognitionView>('feed');
  const [items, setItems] = useState<Recognition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [query, setQuery] = useState('');
  const { users, isLoading: searching } = useUserSearch(query);
  const [recipient, setRecipient] = useState<Person | null>(null);
  const [message, setMessage] = useState('');
  const [companyValue, setCompanyValue] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'team' | 'private'>('team');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const data = dataOf<Recognition[]>(await api.get('/recognition', { params: { view } })); setItems(Array.isArray(data) ? data : []); }
    catch (requestError) { setError(errorText(requestError, 'Could not load recognition.')); }
    finally { setLoading(false); }
  }, [view]);

  useEffect(() => { void load(); }, [load]);

  const send = async () => {
    if (!recipient || !message.trim()) { setError('Choose a colleague and write a specific recognition message.'); return; }
    setWorking(true); setError('');
    try {
      await api.post('/recognition', { recipient, message, companyValue, visibility, contextType: 'general' });
      setOpen(false); setRecipient(null); setQuery(''); setMessage(''); setCompanyValue(''); setNotice('Recognition sent. It is visible according to the audience you selected.'); await load();
    } catch (requestError) { setError(errorText(requestError, 'Could not send recognition.')); }
    finally { setWorking(false); }
  };

  const acknowledge = async (item: Recognition) => {
    try { await api.post(`/recognition/${item._id}/acknowledge`); setNotice('Recognition acknowledged.'); await load(); }
    catch (requestError) { setError(errorText(requestError, 'Could not acknowledge recognition.')); }
  };

  return (
    <Box sx={{ maxWidth: 960, mx: 'auto', px: { xs: 2, md: 3 }, py: 3 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={2} mb={3}>
        <Box><Typography component="h1" variant="h4" fontWeight={700}>Recognition</Typography><Typography color="text.secondary" mt={0.5}>Thank colleagues for specific contributions and connect the message to company values.</Typography></Box>
        <Button variant="contained" startIcon={<Add />} onClick={() => setOpen(true)}>Recognize a colleague</Button>
      </Stack>
      <Alert severity="info" sx={{ mb: 2 }}>Recognition supports culture and coaching. It is never converted into an appraisal score or employee ranking.</Alert>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice('')}>{notice}</Alert>}
      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        <Tabs value={view} onChange={(_, value) => setView(value)} aria-label="Recognition views" sx={{ px: 1.5, borderBottom: 1, borderColor: 'divider' }}><Tab value="feed" label="Organization feed" /><Tab value="received" label="Received" /><Tab value="sent" label="Sent" /></Tabs>
        {loading ? <Box sx={{ py: 8, textAlign: 'center' }}><CircularProgress size={28} /></Box> : items.length === 0 ? <Box sx={{ p: 4 }}><Typography fontWeight={600}>No recognition here yet</Typography><Typography color="text.secondary" mt={0.5}>Specific, timely appreciation helps people understand which contributions matter.</Typography></Box> : items.map((item, index) => (
          <Box key={item._id} id={`recognition-${item._id}`} sx={{ p: 2.5, borderTop: index ? 1 : 0, borderColor: 'divider' }}>
            <Stack direction="row" spacing={2} alignItems="flex-start"><Avatar sx={{ width: 38, height: 38, bgcolor: 'primary.main', fontSize: 14 }}>{initials(item.recipient.name)}</Avatar><Box flex={1} minWidth={0}><Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={1}><Box><Typography fontWeight={650}>{item.sender.name || item.sender.email || 'A colleague'} recognized {item.recipient.name || item.recipient.email || 'a colleague'}</Typography><Typography variant="caption" color="text.secondary">{new Date(item.createdAt).toLocaleDateString()} · {item.visibility === 'public' ? 'Organization' : item.visibility === 'team' ? item.recipient.teamName || 'Team' : 'Private'}</Typography></Box><Stack direction="row" spacing={0.75}>{item.companyValue && <Chip size="small" label={item.companyValue} color="primary" variant="outlined" />}{item.acknowledgedAt && <Chip size="small" label="Acknowledged" icon={<Check />} />}</Stack></Stack><Typography mt={1.5} sx={{ whiteSpace: 'pre-wrap' }}>{item.message}</Typography>{view === 'received' && !item.acknowledgedAt && <Button size="small" sx={{ mt: 1 }} startIcon={<Check />} onClick={() => void acknowledge(item)}>Acknowledge</Button>}</Box></Stack>
          </Box>
        ))}
      </Paper>

      <Dialog open={open} onClose={() => !working && setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Recognize a colleague</DialogTitle><DialogContent dividers><Stack spacing={2}>
          {!recipient ? <><TextField autoFocus label="Search organization" value={query} onChange={event => setQuery(event.target.value)} InputProps={{ startAdornment: <Search fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} /> }} helperText="Search by name or email. Results are limited to your active organization." />{searching && <CircularProgress size={22} />}{query.length >= 2 && !searching && <Paper variant="outlined">{(users as Person[]).length ? (users as Person[]).map(person => <Button key={person.id} fullWidth sx={{ justifyContent: 'flex-start', px: 2, py: 1.25 }} onClick={() => setRecipient(person)}>{person.name}{person.title ? ` · ${person.title}` : ''}</Button>) : <Typography color="text.secondary" sx={{ p: 2 }}>No colleagues found.</Typography>}</Paper>}</> : <Paper variant="outlined" sx={{ p: 2 }}><Stack direction="row" justifyContent="space-between" alignItems="center"><Box><Typography fontWeight={650}>{recipient.name}</Typography><Typography variant="body2" color="text.secondary">{recipient.email}</Typography></Box><Button onClick={() => setRecipient(null)}>Change</Button></Stack></Paper>}
          <TextField label="Recognition message" required multiline minRows={4} value={message} onChange={event => setMessage(event.target.value)} helperText="Name the contribution and explain its impact." />
          <TextField label="Company value (optional)" value={companyValue} onChange={event => setCompanyValue(event.target.value)} />
          <FormControl><InputLabel id="recognition-audience-label">Audience</InputLabel><Select labelId="recognition-audience-label" label="Audience" value={visibility} onChange={event => setVisibility(event.target.value as typeof visibility)}><MenuItem value="public">Organization</MenuItem><MenuItem value="team">Recipient&apos;s team</MenuItem><MenuItem value="private">Recipient only</MenuItem></Select></FormControl>
        </Stack></DialogContent><DialogActions><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="contained" disabled={working || !recipient || !message.trim()} onClick={() => void send()}>{working ? 'Sending…' : 'Send recognition'}</Button></DialogActions>
      </Dialog>
    </Box>
  );
}
