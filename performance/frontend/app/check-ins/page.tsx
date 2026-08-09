'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grid,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { Add, Check, Refresh, Send } from '@mui/icons-material';
import api from '@/lib/api';
import { useDirectReports, useUserContext } from '@/lib/hooks';

type Cadence = 'weekly' | 'fortnightly' | 'ad_hoc';
type CadenceFilter = 'all' | Cadence;

interface PersonOption {
  id: string;
  name: string;
}

interface CheckIn {
  _id: string;
  employeeId: string;
  cadence: Cadence;
  periodStart: string;
  periodEnd: string;
  wins?: string[];
  priorities?: string[];
  blockers?: string[];
  supportNeeded?: string[];
  pulse?: number;
  visibility?: 'employee_manager' | 'employee_only';
  status: 'draft' | 'submitted';
  submittedAt?: string;
  nextDueAt?: string;
  managerResponse?: { text?: string; respondedAt?: string };
}

interface CheckInForm {
  cadence: Cadence;
  periodStart: string;
  periodEnd: string;
  wins: string;
  priorities: string;
  blockers: string;
  supportNeeded: string;
  pulse: number;
  visibility: 'employee_manager' | 'employee_only';
}

function dateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function defaultDates(cadence: Cadence = 'weekly') {
  const start = new Date();
  if (cadence !== 'ad_hoc') {
    const weekday = start.getDay();
    start.setDate(start.getDate() - (weekday === 0 ? 6 : weekday - 1));
  }
  const end = new Date(start);
  end.setDate(end.getDate() + (cadence === 'fortnightly' ? 13 : cadence === 'weekly' ? 6 : 0));
  return { periodStart: dateInput(start), periodEnd: dateInput(end) };
}

function emptyForm(cadence: Cadence = 'weekly'): CheckInForm {
  return {
    cadence,
    ...defaultDates(cadence),
    wins: '',
    priorities: '',
    blockers: '',
    supportNeeded: '',
    pulse: 3,
    visibility: 'employee_manager',
  };
}

function lines(value: string) {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function formatDate(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function cadenceLabel(cadence: Cadence) {
  if (cadence === 'ad_hoc') return 'Ad hoc';
  return cadence === 'fortnightly' ? 'Fortnightly' : 'Weekly';
}

function CheckInsContent() {
  const searchParams = useSearchParams();
  const linkedCheckInId = searchParams.get('id') || '';
  const { user, isManager, isLoading: contextLoading } = useUserContext();
  const { directReports, isLoading: reportsLoading } = useDirectReports();
  const currentUserId = String(user?.id || user?.sub || '');
  const people = useMemo<PersonOption[]>(() => {
    const byId = new Map<string, PersonOption>();
    if (currentUserId) byId.set(currentUserId, { id: currentUserId, name: user?.name || 'My check-ins' });
    if (isManager) {
      (directReports || []).forEach((report: any) => {
        const id = String(report.userId || report.id || report._id || '');
        if (id) byId.set(id, { id, name: report.name || report.email || 'Team member' });
      });
    }
    return [...byId.values()];
  }, [currentUserId, directReports, isManager, user?.name]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const employeeId = people.some((person) => person.id === selectedEmployeeId)
    ? selectedEmployeeId
    : people.find((person) => person.id === currentUserId)?.id || people[0]?.id || '';
  const isOwnView = Boolean(employeeId && employeeId === currentUserId);
  const [items, setItems] = useState<CheckIn[]>([]);
  const [filter, setFilter] = useState<CadenceFilter>('all');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<CheckInForm>(emptyForm());
  const [responseItem, setResponseItem] = useState<CheckIn | null>(null);
  const [managerResponse, setManagerResponse] = useState('');
  const resolvedDeepLink = useRef('');

  const fetchForEmployee = useCallback(async (personId: string) => {
    if (!personId) return [];
    const response = await api.get('/check-ins', { params: { employeeId: personId } });
    const data = response.data?.data || response.data || [];
    return Array.isArray(data) ? data as CheckIn[] : [];
  }, []);

  const load = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true);
    setError('');
    try {
      setItems(await fetchForEmployee(employeeId));
    } catch (requestError: any) {
      setItems([]);
      setError(requestError?.response?.data?.error || 'Could not load check-ins.');
    } finally {
      setLoading(false);
    }
  }, [employeeId, fetchForEmployee]);

  useEffect(() => {
    if (contextLoading || reportsLoading || !people.length) return;
    if (linkedCheckInId && resolvedDeepLink.current !== linkedCheckInId) {
      resolvedDeepLink.current = linkedCheckInId;
      const findLinkedItem = async () => {
        setLoading(true);
        setError('');
        try {
          const results = await Promise.all(people.map(async (person) => ({ person, items: await fetchForEmployee(person.id) })));
          const match = results.find((result) => result.items.some((item) => item._id === linkedCheckInId));
          if (match) {
            setSelectedEmployeeId(match.person.id);
            setItems(match.items);
            window.setTimeout(() => document.getElementById(`check-in-${linkedCheckInId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
          } else {
            setError('This check-in is unavailable or you do not have access to it.');
          }
        } catch (requestError: any) {
          setError(requestError?.response?.data?.error || 'Could not open this check-in.');
        } finally {
          setLoading(false);
        }
      };
      void findLinkedItem();
      return;
    }
    void load();
  }, [contextLoading, fetchForEmployee, linkedCheckInId, load, people, reportsLoading]);

  const filteredItems = filter === 'all' ? items : items.filter((item) => item.cadence === filter);

  const changeCadence = (cadence: Cadence) => {
    setForm((current) => ({ ...current, cadence, ...defaultDates(cadence) }));
  };

  const createCheckIn = async (submit: boolean) => {
    const updates = [...lines(form.wins), ...lines(form.priorities), ...lines(form.blockers), ...lines(form.supportNeeded)];
    if (submit && !updates.length) {
      setError('Add at least one update before submitting.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await api.post('/check-ins', {
        employeeId: currentUserId,
        cadence: form.cadence,
        periodStart: form.periodStart,
        periodEnd: form.periodEnd,
        wins: lines(form.wins),
        priorities: lines(form.priorities),
        blockers: lines(form.blockers),
        supportNeeded: lines(form.supportNeeded),
        pulse: form.pulse,
        visibility: form.visibility,
      });
      const created = response.data?.data || response.data;
      if (submit) await api.post(`/check-ins/${created._id}/submit`);
      setCreateOpen(false);
      setForm(emptyForm());
      await load();
      setNotice(submit ? 'Check-in submitted.' : 'Check-in saved as a draft.');
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || 'Could not save this check-in.');
    } finally {
      setSaving(false);
    }
  };

  const submitDraft = async (item: CheckIn) => {
    setSaving(true);
    setError('');
    try {
      await api.post(`/check-ins/${item._id}/submit`);
      await load();
      setNotice('Check-in submitted.');
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || 'Could not submit this check-in.');
    } finally {
      setSaving(false);
    }
  };

  const sendManagerResponse = async () => {
    if (!responseItem || !managerResponse.trim()) return;
    setSaving(true);
    setError('');
    try {
      await api.patch(`/check-ins/${responseItem._id}`, { managerResponse: managerResponse.trim() });
      setResponseItem(null);
      setManagerResponse('');
      await load();
      setNotice('Manager response sent.');
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || 'Could not send this response.');
    } finally {
      setSaving(false);
    }
  };

  if (contextLoading || reportsLoading) {
    return <Stack alignItems="center" sx={{ py: 10 }}><CircularProgress /></Stack>;
  }

  return (
    <Box sx={{ maxWidth: 1120, mx: 'auto' }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={2} sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h4" component="h1" fontWeight={700}>Performance check-ins</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            Capture wins, next priorities, blockers, and the support needed between formal reviews.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ alignSelf: { sm: 'flex-start' } }}>
          <Button variant="outlined" startIcon={<Refresh />} onClick={() => void load()} disabled={loading || !employeeId}>Refresh</Button>
          {isOwnView && <Button variant="contained" startIcon={<Add />} onClick={() => { setForm(emptyForm()); setCreateOpen(true); }}>New check-in</Button>}
        </Stack>
      </Stack>

      {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}

      {isManager && people.length > 1 && (
        <FormControl size="small" sx={{ minWidth: 260, mb: 2 }}>
          <InputLabel>Employee</InputLabel>
          <Select value={employeeId} label="Employee" onChange={(event) => { resolvedDeepLink.current = linkedCheckInId; setSelectedEmployeeId(event.target.value); }}>
            {people.map((person) => <MenuItem key={person.id} value={person.id}>{person.id === currentUserId ? 'My check-ins' : person.name}</MenuItem>)}
          </Select>
        </FormControl>
      )}

      <Paper variant="outlined" sx={{ mb: 2 }}>
        <Tabs value={filter} onChange={(_, value) => setFilter(value)} variant="scrollable" scrollButtons="auto">
          <Tab value="all" label={`All (${items.length})`} />
          <Tab value="weekly" label="Weekly" />
          <Tab value="fortnightly" label="Fortnightly" />
          <Tab value="ad_hoc" label="Ad hoc" />
        </Tabs>
      </Paper>

      {loading ? (
        <LinearProgress />
      ) : filteredItems.length === 0 ? (
        <Paper variant="outlined" sx={{ px: 3, py: 7, textAlign: 'center' }}>
          <Typography fontWeight={700}>No {filter === 'all' ? '' : `${cadenceLabel(filter)} `}check-ins yet</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75, mb: isOwnView ? 2 : 0 }}>
            {isOwnView ? 'Create a short update to keep priorities and support needs visible.' : 'This employee has not shared a check-in in this view.'}
          </Typography>
          {isOwnView && <Button variant="outlined" startIcon={<Add />} onClick={() => setCreateOpen(true)}>Create check-in</Button>}
        </Paper>
      ) : (
        <Stack spacing={2}>
          {filteredItems.map((item) => (
            <Card
              key={item._id}
              id={`check-in-${item._id}`}
              variant="outlined"
              sx={{ borderColor: linkedCheckInId === item._id ? 'primary.main' : 'divider', borderWidth: linkedCheckInId === item._id ? 2 : 1 }}
            >
              <CardContent>
                <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={2}>
                  <Box>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Typography fontWeight={700}>{cadenceLabel(item.cadence)} check-in</Typography>
                      <Chip size="small" label={item.status} color={item.status === 'submitted' ? 'success' : 'default'} variant="outlined" />
                      {item.pulse && <Chip size="small" label={`Pulse ${item.pulse}/5`} variant="outlined" />}
                    </Stack>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      {formatDate(item.periodStart)} – {formatDate(item.periodEnd)}
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
                    {isOwnView && item.status === 'draft' && (
                      <Button variant="contained" size="small" startIcon={<Send />} onClick={() => void submitDraft(item)} disabled={saving}>Submit</Button>
                    )}
                    {!isOwnView && item.status === 'submitted' && !item.managerResponse?.text && (
                      <Button size="small" variant="outlined" onClick={() => setResponseItem(item)}>Respond</Button>
                    )}
                  </Stack>
                </Stack>

                <Grid container spacing={2} sx={{ mt: 1 }}>
                  {[
                    { label: 'Wins', values: item.wins },
                    { label: 'Next priorities', values: item.priorities },
                    { label: 'Blockers', values: item.blockers },
                    { label: 'Support needed', values: item.supportNeeded },
                  ].filter((section) => section.values?.length).map((section) => (
                    <Grid key={section.label} size={{ xs: 12, md: 6 }}>
                      <Typography variant="subtitle2">{section.label}</Typography>
                      <Box component="ul" sx={{ mt: 0.5, mb: 0, pl: 2.5 }}>
                        {section.values?.map((value) => <Typography key={value} component="li" variant="body2">{value}</Typography>)}
                      </Box>
                    </Grid>
                  ))}
                </Grid>

                {item.managerResponse?.text && (
                  <Alert severity="info" icon={<Check />} sx={{ mt: 2 }}>
                    <Typography variant="subtitle2">Manager response</Typography>
                    <Typography variant="body2">{item.managerResponse.text}</Typography>
                  </Alert>
                )}
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      <Dialog open={createOpen} onClose={() => !saving && setCreateOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>New performance check-in</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            {error && <Alert severity="error">{error}</Alert>}
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 4 }}>
                <FormControl fullWidth>
                  <InputLabel>Cadence</InputLabel>
                  <Select value={form.cadence} label="Cadence" onChange={(event) => changeCadence(event.target.value as Cadence)}>
                    <MenuItem value="weekly">Weekly</MenuItem>
                    <MenuItem value="fortnightly">Fortnightly</MenuItem>
                    <MenuItem value="ad_hoc">Ad hoc</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 6, sm: 4 }}>
                <TextField fullWidth type="date" label="Period start" value={form.periodStart} onChange={(event) => setForm({ ...form, periodStart: event.target.value })} InputLabelProps={{ shrink: true }} />
              </Grid>
              <Grid size={{ xs: 6, sm: 4 }}>
                <TextField fullWidth type="date" label="Period end" value={form.periodEnd} onChange={(event) => setForm({ ...form, periodEnd: event.target.value })} InputLabelProps={{ shrink: true }} />
              </Grid>
            </Grid>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, md: 6 }}><TextField fullWidth multiline minRows={3} label="Wins" helperText="One item per line" value={form.wins} onChange={(event) => setForm({ ...form, wins: event.target.value })} /></Grid>
              <Grid size={{ xs: 12, md: 6 }}><TextField fullWidth multiline minRows={3} label="Next priorities" helperText="One item per line" value={form.priorities} onChange={(event) => setForm({ ...form, priorities: event.target.value })} /></Grid>
              <Grid size={{ xs: 12, md: 6 }}><TextField fullWidth multiline minRows={3} label="Blockers" helperText="One item per line" value={form.blockers} onChange={(event) => setForm({ ...form, blockers: event.target.value })} /></Grid>
              <Grid size={{ xs: 12, md: 6 }}><TextField fullWidth multiline minRows={3} label="Support needed" helperText="One item per line" value={form.supportNeeded} onChange={(event) => setForm({ ...form, supportNeeded: event.target.value })} /></Grid>
            </Grid>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <FormControl fullWidth>
                  <InputLabel>Pulse</InputLabel>
                  <Select value={form.pulse} label="Pulse" onChange={(event) => setForm({ ...form, pulse: Number(event.target.value) })}>
                    <MenuItem value={1}>1 – Struggling</MenuItem>
                    <MenuItem value={2}>2 – Below normal</MenuItem>
                    <MenuItem value={3}>3 – Steady</MenuItem>
                    <MenuItem value={4}>4 – Good</MenuItem>
                    <MenuItem value={5}>5 – Great</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <FormControl fullWidth>
                  <InputLabel>Visibility</InputLabel>
                  <Select value={form.visibility} label="Visibility" onChange={(event) => setForm({ ...form, visibility: event.target.value as CheckInForm['visibility'] })}>
                    <MenuItem value="employee_manager">Me and my manager</MenuItem>
                    <MenuItem value="employee_only">Only me</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            </Grid>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)} disabled={saving}>Cancel</Button>
          <Button onClick={() => void createCheckIn(false)} disabled={saving}>Save draft</Button>
          <Button variant="contained" onClick={() => void createCheckIn(true)} disabled={saving}>Save and submit</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(responseItem)} onClose={() => !saving && setResponseItem(null)} fullWidth maxWidth="sm">
        <DialogTitle>Respond to check-in</DialogTitle>
        <DialogContent dividers>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <TextField fullWidth multiline minRows={4} label="Manager response" value={managerResponse} onChange={(event) => setManagerResponse(event.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResponseItem(null)} disabled={saving}>Cancel</Button>
          <Button variant="contained" onClick={() => void sendManagerResponse()} disabled={saving || !managerResponse.trim()}>Send response</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={Boolean(notice)} autoHideDuration={4000} onClose={() => setNotice('')} message={notice} />
    </Box>
  );
}

export default function CheckInsPage() {
  return (
    <Suspense fallback={<Stack alignItems="center" sx={{ py: 10 }}><CircularProgress /></Stack>}>
      <CheckInsContent />
    </Suspense>
  );
}
