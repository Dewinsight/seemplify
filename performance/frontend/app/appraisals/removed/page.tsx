'use client';
import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { Alert, Box, Button, CircularProgress, Paper, Stack, TextField, Typography } from '@mui/material';
import { ArrowBack } from '@mui/icons-material';
import api from '@/lib/api';
import AppraisalActions from '@/components/appraisals/AppraisalActions';
type Removed = { _id: string; employee?: { name?: string }; manager?: { name?: string }; reviewName?: string; createdAt?: string; status: string; removedAt: string; removedBy?: { name?: string } };
export default function RemovedAppraisals() {
  const { data = [], error, isLoading, mutate } = useSWR<Removed[]>('/appraisals/lifecycle/removed', async url => (await api.get(url)).data.data);
  const [search, setSearch] = useState('');
  const filtered = data.filter(item => `${item.employee?.name} ${item.manager?.name}`.toLowerCase().includes(search.toLowerCase().trim()));
  return <Box sx={{ maxWidth: 1000, mx: 'auto' }}>
    <Button component={Link} href="/appraisals" startIcon={<ArrowBack />} sx={{ mb: 2 }}>Back to appraisals</Button>
    <Typography variant="h4" component="h1" fontWeight={700}>Removed appraisals</Typography>
    <Typography color="text.secondary" sx={{ mt: 1, mb: 3 }}>Restore a review to History. Cancelled reviews stay closed, and calls and reminders do not restart.</Typography>
    {isLoading ? <CircularProgress aria-label="Loading removed appraisals" /> : error ? <Alert severity="error" action={<Button onClick={() => mutate()}>Retry</Button>}>{(error as { response?: { status: number } }).response?.status === 403 ? 'You do not have permission to manage removed appraisals.' : 'Removed appraisals could not be loaded.'}</Alert> : <Stack spacing={2}>
      <TextField size="small" label="Search by employee or reviewer" value={search} onChange={event => setSearch(event.target.value)} />
      {!filtered.length && <Alert severity="info">{search ? 'No removed appraisals match your search.' : 'No removed appraisals. Reviews you remove will appear here.'}</Alert>}
      {filtered.map(item => <Paper key={item._id} variant="outlined" sx={{ p: 2.5 }}><Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={2}><Box>
        <Typography component="h2" variant="h6">{item.employee?.name || 'Employee appraisal'}</Typography>
        <Typography sx={{ mt: .5 }}>{item.reviewName || 'Performance appraisal'}</Typography>
        <Typography variant="body2" color="text.secondary">Reviewer: {item.manager?.name || 'Not recorded'} · {item.status.replaceAll('_', ' ')}</Typography>
        {item.createdAt && <Typography variant="body2" color="text.secondary">Created {new Date(item.createdAt).toLocaleString()}</Typography>}
        <Typography variant="body2" sx={{ mt: 1 }}>Removed {new Date(item.removedAt).toLocaleString()}{item.removedBy?.name ? ` by ${item.removedBy.name}` : ''}</Typography>
      </Box><AppraisalActions appraisalId={item._id} employeeName={item.employee?.name} restoreOnly onUpdated={() => { void mutate(); }} /></Stack></Paper>)}
    </Stack>}
  </Box>;
}
