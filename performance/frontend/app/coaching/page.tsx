'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Alert, Box, Button, Chip, CircularProgress, FormControl, InputLabel, MenuItem, Paper, Select, Stack, Typography } from '@mui/material';
import { ArrowForward, Refresh } from '@mui/icons-material';
import api from '@/lib/api';
import { useDirectReports, useUserContext } from '@/lib/hooks';

interface AttentionItem { type: string; priority: 'high' | 'medium' | 'low'; employeeId: string; employeeName: string; count?: number; message: string; href: string }
interface CoachingData {
  generatedAt?: string;
  scope: { employeeCount: number; organizationWide?: boolean };
  summary: { atRiskGoals?: number; checkInCoverage?: number; oneOnOneCoverage?: number; feedbackCoverage?: number; recognitionCoverage?: number; openAppraisals?: number; supportPlansDue?: number };
  attention: AttentionItem[];
  definitions: Array<{ key: string; label: string; definition: string }>;
  safeguards: string[];
}

function dataOf<T>(response: { data?: unknown }): T { const payload = response.data as { data?: T } | T; return ((payload as { data?: T })?.data ?? payload) as T; }
function errorText(error: unknown) { const candidate = error as { response?: { data?: { error?: string } }; message?: string }; return candidate.response?.data?.error || candidate.message || 'Could not load coaching priorities.'; }
const priorityColor = { high: 'error', medium: 'warning', low: 'default' } as const;

export default function CoachingPage() {
  const { isManager, isHRAdmin } = useUserContext();
  const { directReports } = useDirectReports();
  const [data, setData] = useState<CoachingData | null>(null);
  const [employeeId, setEmployeeId] = useState('');
  const [priority, setPriority] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const people = useMemo(() => (directReports || []).map((person: Record<string, unknown>) => ({ id: String(person.userId || person.id || person._id || ''), name: String(person.name || person.email || 'Team member') })).filter(person => person.id), [directReports]);
  const load = useCallback(async () => { setLoading(true); setError(''); try { setData(dataOf<CoachingData>(await api.get('/manager-insights/practices', { params: { ...(employeeId ? { employeeId } : {}), ...(isHRAdmin ? { scope: 'team' } : {}) } }))); } catch (requestError) { setError(errorText(requestError)); } finally { setLoading(false); } }, [employeeId, isHRAdmin]);
  useEffect(() => { if (isManager || isHRAdmin) void load(); else setLoading(false); }, [isHRAdmin, isManager, load]);
  const attention = (data?.attention || []).filter(item => priority === 'all' || item.priority === priority);

  if (!isManager && !isHRAdmin) return <Box sx={{ maxWidth: 880, mx: 'auto', p: 3 }}><Alert severity="info">The coaching workspace is available to line managers and HR administrators.</Alert></Box>;

  return <Box sx={{ maxWidth: 1120, mx: 'auto', px: { xs: 2, md: 3 }, py: 3 }}>
    <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'center' }} gap={2} mb={3}><Box><Typography component="h1" variant="h4" fontWeight={700}>Manager coaching</Typography><Typography color="text.secondary" mt={0.5}>A practical queue for follow-ups across goals, check-ins, 1:1s, feedback, recognition, and support plans.</Typography></Box><Button variant="outlined" startIcon={<Refresh />} onClick={() => void load()}>Refresh</Button></Stack>
    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
    <Alert severity="info" sx={{ mb: 2 }}>These signals help managers remember good practices. They do not score, rank, diagnose, or make decisions about employees.</Alert>
    <Paper variant="outlined" sx={{ p: 2.5, mb: 2 }}>
      {loading ? <Box sx={{ py: 3, textAlign: 'center' }}><CircularProgress size={28} /></Box> : <Stack spacing={2}>
        <Stack direction={{ xs: 'column', lg: 'row' }} justifyContent="space-between" gap={2} alignItems={{ lg: 'center' }}><Box><Typography fontWeight={650}>{data?.scope.employeeCount || 0} people in scope</Typography><Typography variant="body2" color="text.secondary">Updated {data?.generatedAt ? new Date(data.generatedAt).toLocaleString() : 'just now'}</Typography></Box><Stack direction="row" flexWrap="wrap" gap={1}><Chip label={`${data?.summary.checkInCoverage || 0}% check-in coverage`} /><Chip label={`${data?.summary.oneOnOneCoverage || 0}% 1:1 coverage`} /><Chip label={`${data?.summary.feedbackCoverage || 0}% feedback coverage`} /><Chip label={`${data?.summary.recognitionCoverage || 0}% recognition coverage`} /><Chip color={(data?.summary.atRiskGoals || 0) > 0 ? 'warning' : 'default'} label={`${data?.summary.atRiskGoals || 0} at-risk goals`} /></Stack></Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}><FormControl size="small" sx={{ minWidth: 230 }}><InputLabel id="coaching-employee-label">Employee</InputLabel><Select labelId="coaching-employee-label" label="Employee" value={employeeId} onChange={event => setEmployeeId(String(event.target.value))}><MenuItem value="">All direct reports</MenuItem>{people.map(person => <MenuItem key={person.id} value={person.id}>{person.name}</MenuItem>)}</Select></FormControl><FormControl size="small" sx={{ minWidth: 180 }}><InputLabel id="coaching-priority-label">Priority</InputLabel><Select labelId="coaching-priority-label" label="Priority" value={priority} onChange={event => setPriority(String(event.target.value))}><MenuItem value="all">All priorities</MenuItem><MenuItem value="high">High</MenuItem><MenuItem value="medium">Medium</MenuItem><MenuItem value="low">Low</MenuItem></Select></FormControl></Stack>
      </Stack>}
    </Paper>
    {!loading && <Paper variant="outlined" sx={{ overflow: 'hidden' }}><Box sx={{ px: 2.5, py: 1.5, borderBottom: 1, borderColor: 'divider' }}><Typography fontWeight={650}>Coaching attention</Typography></Box>{attention.length === 0 ? <Box sx={{ p: 4 }}><Typography fontWeight={600}>No follow-ups in this filter</Typography><Typography color="text.secondary" mt={0.5}>Coverage is current or no matching records are available.</Typography></Box> : attention.map((item, index) => <Box key={`${item.type}-${item.employeeId}`} sx={{ px: 2.5, py: 2, borderTop: index ? 1 : 0, borderColor: 'divider' }}><Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'center' }} gap={1.5}><Box><Stack direction="row" gap={1} alignItems="center"><Typography fontWeight={650}>{item.employeeName}</Typography><Chip size="small" color={priorityColor[item.priority]} label={item.priority} /></Stack><Typography color="text.secondary" variant="body2" mt={0.5}>{item.message}</Typography></Box><Button component={Link} href={item.href} endIcon={<ArrowForward />} sx={{ alignSelf: { xs: 'flex-start', md: 'center' } }}>Open</Button></Stack></Box>)}</Paper>}
    {data?.definitions?.length ? <Box mt={3}><Typography variant="subtitle2">How coverage is calculated</Typography><Stack mt={1} spacing={0.5}>{data.definitions.map(item => <Typography key={item.key} variant="caption" color="text.secondary"><strong>{item.label}:</strong> {item.definition}</Typography>)}</Stack></Box> : null}
  </Box>;
}
