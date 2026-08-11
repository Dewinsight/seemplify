'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '@/lib/api';
import { useUserContext } from '@/lib/hooks';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography
} from '@mui/material';
import { Add, AutoAwesome, Refresh } from '@mui/icons-material';

type Employee = { userId: string; name: string; email?: string; jobTitle?: string; department?: string; teamId?: string; teamName?: string };
type EvidenceSnapshot = { finalRating: number; ratingLabel?: string; goalAchievement?: number; competencyScore?: number; finalizedAt: string };
type AiBrief = { _id: string; status: 'suggested' | 'accepted' | 'rejected'; output: { summary?: string; evidenceHighlights?: string[]; evidenceGaps?: string[]; discussionQuestions?: string[] } };
type TalentEntry = { _id: string; employee: Employee; managerId?: string; evidenceSnapshot: EvidenceSnapshot; performanceBand: 'developing' | 'effective' | 'strong'; potential: 'not_assessed' | 'limited' | 'moderate' | 'high'; readiness: 'not_assessed' | 'ready_now' | 'ready_1_2_years' | 'ready_3_plus_years'; nextRole?: string; criticalRole?: boolean; rationale?: string; strengths?: string[]; developmentPriorities?: string[]; decisionState: string; aiBriefs?: AiBrief[] };
type TalentReview = { _id: string; name: string; description?: string; state: 'draft' | 'open' | 'calibration' | 'closed' | 'cancelled'; sourceCycle: { name: string; periodStart?: string; periodEnd?: string }; entries: TalentEntry[]; updatedAt: string };
type AppraisalCycle = { _id: string; name: string; periodStart?: string; periodEnd?: string; status?: string };
type SuccessionCandidate = { _id: string; employee: Employee; readiness: string; rationale: string; state: string };
type SuccessionPlan = { _id: string; role: { title: string; departmentName?: string; teamName?: string; criticality: string }; state: string; reviewDate?: string; candidates: SuccessionCandidate[] };
type Signal = { type: string; severity: 'medium' | 'high'; employee: Employee; appraisalId: string; status: string; reasons: string[]; definition: string };

const POTENTIAL = [
  { value: 'limited', label: 'Focused / current scope' },
  { value: 'moderate', label: 'Broader scope with development' },
  { value: 'high', label: 'Demonstrated capacity for broader scope' }
];
const READINESS = [
  { value: 'ready_now', label: 'Ready now' },
  { value: 'ready_1_2_years', label: 'Ready in 1–2 years' },
  { value: 'ready_3_plus_years', label: 'Ready in 3+ years' }
];
const PERFORMANCE_LABELS = { developing: 'Developing', effective: 'Effective', strong: 'Strong' };
const POTENTIAL_LABELS = { limited: 'Focused', moderate: 'Moderate', high: 'High' };

function responseData<T>(response: { data?: unknown }, fallback: T): T {
  const body = response.data as { data?: T } | T | undefined;
  if (body && typeof body === 'object' && 'data' in body) return (body as { data?: T }).data ?? fallback;
  return (body as T) ?? fallback;
}

function errorMessage(error: unknown, fallback: string) {
  const candidate = error as { response?: { data?: { error?: string } }; message?: string };
  return candidate.response?.data?.error || candidate.message || fallback;
}

function splitList(value: string) {
  return value.split(/\n|,/).map((item) => item.trim()).filter(Boolean);
}

function formatState(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function readinessLabel(value: string) {
  return READINESS.find((option) => option.value === value)?.label || formatState(value);
}

export default function TalentPage() {
  const { isManager, isHRAdmin, features, isLoading: contextLoading } = useUserContext();
  const [tab, setTab] = useState(0);
  const [reviews, setReviews] = useState<TalentReview[]>([]);
  const [selectedReviewId, setSelectedReviewId] = useState('');
  const [succession, setSuccession] = useState<SuccessionPlan[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [methodology, setMethodology] = useState('');
  const [cycles, setCycles] = useState<AppraisalCycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [createReviewOpen, setCreateReviewOpen] = useState(false);
  const [reviewForm, setReviewForm] = useState({ name: '', description: '', sourceAppraisalCycleId: '' });
  const [editingEntry, setEditingEntry] = useState<TalentEntry | null>(null);
  const [entryForm, setEntryForm] = useState({ potential: 'moderate', readiness: 'ready_1_2_years', nextRole: '', criticalRole: false, rationale: '', strengths: '', developmentPriorities: '' });
  const [createRoleOpen, setCreateRoleOpen] = useState(false);
  const [roleForm, setRoleForm] = useState({ title: '', departmentName: '', criticality: 'standard', reviewDate: '' });
  const [candidatePlan, setCandidatePlan] = useState<SuccessionPlan | null>(null);
  const [employeeOptions, setEmployeeOptions] = useState<Employee[]>([]);
  const [candidateForm, setCandidateForm] = useState<{ employee: Employee | null; readiness: string; rationale: string; strengths: string; developmentGaps: string }>({ employee: null, readiness: 'ready_1_2_years', rationale: '', strengths: '', developmentGaps: '' });
  const [saving, setSaving] = useState(false);

  const selectedReview = reviews.find((review) => review._id === selectedReviewId) || reviews[0] || null;

  const load = useCallback(async () => {
    if (!isManager && !isHRAdmin) return;
    setLoading(true);
    setError('');
    try {
      const requests: Promise<unknown>[] = [api.get('/talent/reviews'), api.get('/talent/signals')];
      if (isHRAdmin) requests.push(api.get('/talent/succession-plans'), api.get('/appraisals/cycles'));
      const responses = await Promise.all(requests) as Array<{ data?: unknown }>;
      const reviewData = responseData<TalentReview[]>(responses[0], []);
      const signalData = responseData<{ signals?: Signal[]; methodology?: string }>(responses[1], {});
      setReviews(reviewData);
      setSelectedReviewId((current) => current && reviewData.some((item) => item._id === current) ? current : reviewData[0]?._id || '');
      setSignals(signalData.signals || []);
      setMethodology(signalData.methodology || '');
      if (isHRAdmin) {
        setSuccession(responseData<SuccessionPlan[]>(responses[2], []));
        const cyclePayload = responseData<AppraisalCycle[] | { cycles?: AppraisalCycle[] }>(responses[3], []);
        setCycles(Array.isArray(cyclePayload) ? cyclePayload : cyclePayload.cycles || []);
      }
    } catch (loadError) {
      setError(errorMessage(loadError, 'Talent planning could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [isHRAdmin, isManager]);

  useEffect(() => { void load(); }, [load]);

  const matrix = useMemo(() => {
    const cells = new Map<string, TalentEntry[]>();
    for (const potential of ['high', 'moderate', 'limited']) {
      for (const performance of ['developing', 'effective', 'strong']) cells.set(`${potential}:${performance}`, []);
    }
    for (const entry of selectedReview?.entries || []) {
      if (entry.potential !== 'not_assessed') cells.get(`${entry.potential}:${entry.performanceBand}`)?.push(entry);
    }
    return cells;
  }, [selectedReview]);

  const unassessed = (selectedReview?.entries || []).filter((entry) => entry.potential === 'not_assessed');

  const createReview = async () => {
    setSaving(true); setError('');
    try {
      const response = await api.post('/talent/reviews', reviewForm);
      const created = responseData<TalentReview>(response, {} as TalentReview);
      setCreateReviewOpen(false);
      setReviewForm({ name: '', description: '', sourceAppraisalCycleId: '' });
      setNotice(`Talent review created with ${created.entries?.length || 0} finalized appraisal snapshots.`);
      await load();
      setSelectedReviewId(created._id);
    } catch (saveError) { setError(errorMessage(saveError, 'Talent review could not be created.')); }
    finally { setSaving(false); }
  };

  const transition = async (state: string) => {
    if (!selectedReview) return;
    setSaving(true); setError('');
    try {
      await api.post(`/talent/reviews/${selectedReview._id}/transition`, { state });
      setNotice(`Talent review moved to ${formatState(state)}.`);
      await load();
    } catch (saveError) { setError(errorMessage(saveError, 'Review state could not be updated.')); }
    finally { setSaving(false); }
  };

  const openAssessment = (entry: TalentEntry) => {
    setEditingEntry(entry);
    setEntryForm({
      potential: entry.potential === 'not_assessed' ? 'moderate' : entry.potential,
      readiness: entry.readiness === 'not_assessed' ? 'ready_1_2_years' : entry.readiness,
      nextRole: entry.nextRole || '', criticalRole: Boolean(entry.criticalRole), rationale: entry.rationale || '',
      strengths: (entry.strengths || []).join('\n'), developmentPriorities: (entry.developmentPriorities || []).join('\n')
    });
  };

  const saveAssessment = async () => {
    if (!selectedReview || !editingEntry) return;
    setSaving(true); setError('');
    try {
      await api.patch(`/talent/reviews/${selectedReview._id}/entries/${editingEntry.employee.userId}`, {
        ...entryForm, strengths: splitList(entryForm.strengths), developmentPriorities: splitList(entryForm.developmentPriorities)
      });
      setEditingEntry(null);
      setNotice(isHRAdmin && selectedReview.state === 'calibration' ? 'HR calibration decision saved.' : 'Manager proposal saved for HR calibration.');
      await load();
    } catch (saveError) { setError(errorMessage(saveError, 'Talent assessment could not be saved.')); }
    finally { setSaving(false); }
  };

  const requestAiBrief = async () => {
    if (!selectedReview || !editingEntry) return;
    setSaving(true); setError('');
    try {
      const response = await api.post(`/talent/reviews/${selectedReview._id}/entries/${editingEntry.employee.userId}/ai-brief`);
      const created = responseData<AiBrief>(response, {} as AiBrief);
      setEditingEntry((current) => current ? { ...current, aiBriefs: [...(current.aiBriefs || []), created] } : current);
      setNotice('AI evidence brief created for human review. It did not assign potential or readiness.');
      await load();
    } catch (saveError) { setError(errorMessage(saveError, 'AI evidence brief is unavailable; continue with the source evidence.')); }
    finally { setSaving(false); }
  };

  const reviewAiBrief = async (briefId: string, decision: 'accepted' | 'rejected') => {
    if (!selectedReview || !editingEntry) return;
    setSaving(true);
    try {
      await api.post(`/talent/reviews/${selectedReview._id}/entries/${editingEntry.employee.userId}/ai-briefs/${briefId}/review`, { decision });
      setNotice(`AI evidence brief ${decision}.`);
      await load();
      setEditingEntry(null);
    } catch (saveError) { setError(errorMessage(saveError, 'AI brief decision could not be saved.')); }
    finally { setSaving(false); }
  };

  const createRole = async () => {
    setSaving(true); setError('');
    try {
      await api.post('/talent/succession-plans', { role: { title: roleForm.title, departmentName: roleForm.departmentName, criticality: roleForm.criticality }, reviewDate: roleForm.reviewDate || undefined, state: 'active' });
      setCreateRoleOpen(false); setRoleForm({ title: '', departmentName: '', criticality: 'standard', reviewDate: '' });
      setNotice('Succession role coverage created.'); await load();
    } catch (saveError) { setError(errorMessage(saveError, 'Succession role could not be created.')); }
    finally { setSaving(false); }
  };

  const searchEmployees = async (query: string) => {
    if (query.trim().length < 2) return setEmployeeOptions([]);
    try { const response = await api.get(`/user/search?q=${encodeURIComponent(query)}`); setEmployeeOptions(responseData<Employee[]>(response, [])); }
    catch { setEmployeeOptions([]); }
  };

  const addCandidate = async () => {
    if (!candidatePlan || !candidateForm.employee) return;
    setSaving(true); setError('');
    try {
      await api.post(`/talent/succession-plans/${candidatePlan._id}/candidates`, {
        employeeId: candidateForm.employee.userId, readiness: candidateForm.readiness, rationale: candidateForm.rationale,
        strengths: splitList(candidateForm.strengths), developmentGaps: splitList(candidateForm.developmentGaps)
      });
      setCandidatePlan(null); setCandidateForm({ employee: null, readiness: 'ready_1_2_years', rationale: '', strengths: '', developmentGaps: '' });
      setNotice('Succession candidate proposed with an auditable rationale.'); await load();
    } catch (saveError) { setError(errorMessage(saveError, 'Candidate could not be added.')); }
    finally { setSaving(false); }
  };

  if (contextLoading || loading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}><CircularProgress /></Box>;
  if (features.talentPlanning === false) return <Alert severity="info">Talent planning is not enabled for this organization.</Alert>;
  if (!isManager && !isHRAdmin) return <Alert severity="info">Talent planning is available in Manager or Admin workspace.</Alert>;

  return (
    <Box>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'flex-start' }} gap={2} mb={2.5}>
        <Box><Typography component="h1" variant="h4" fontWeight={700}>Talent planning</Typography><Typography color="text.secondary">Calibrate potential and readiness from finalized evidence, then maintain succession coverage without automated people decisions.</Typography></Box>
        <Stack direction="row" gap={1}><Button variant="outlined" startIcon={<Refresh />} onClick={() => void load()}>Refresh</Button>{isHRAdmin && tab === 0 && <Button variant="contained" startIcon={<Add />} onClick={() => setCreateReviewOpen(true)}>New talent review</Button>}{isHRAdmin && tab === 1 && <Button variant="contained" startIcon={<Add />} onClick={() => setCreateRoleOpen(true)}>Add critical role</Button>}</Stack>
      </Stack>
      {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}
      {notice && <Alert severity="success" onClose={() => setNotice('')} sx={{ mb: 2 }}>{notice}</Alert>}
      <Alert severity="info" sx={{ mb: 2 }}>Final appraisal ratings are copied as read-only evidence. Potential, readiness, and succession decisions always require an identified manager or HR reviewer.</Alert>
      <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile aria-label="Talent planning views" sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tab label="Talent reviews" />{isHRAdmin && <Tab label="Succession coverage" />}<Tab label={`Explainable signals (${signals.length})`} />
      </Tabs>

      {tab === 0 && (
        <Stack gap={2}>
          {reviews.length === 0 ? <Alert severity="info">No talent review exists yet. HR can create one from a completed appraisal cycle.</Alert> : <>
            <Paper variant="outlined" sx={{ p: 2 }}><Stack direction={{ xs: 'column', md: 'row' }} gap={1.5} alignItems={{ md: 'center' }} justifyContent="space-between"><FormControl size="small" sx={{ minWidth: 300 }}><InputLabel id="talent-review-label">Talent review</InputLabel><Select labelId="talent-review-label" label="Talent review" value={selectedReview?._id || ''} onChange={(event) => setSelectedReviewId(event.target.value)}>{reviews.map((review) => <MenuItem key={review._id} value={review._id}>{review.name}</MenuItem>)}</Select></FormControl>{selectedReview && <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center"><Chip label={formatState(selectedReview.state)} color={selectedReview.state === 'closed' ? 'success' : 'default'} />{isHRAdmin && selectedReview.state === 'draft' && <Button size="small" variant="contained" disabled={saving} onClick={() => void transition('open')}>Open for managers</Button>}{isHRAdmin && selectedReview.state === 'open' && <Button size="small" variant="contained" disabled={saving} onClick={() => void transition('calibration')}>Start HR calibration</Button>}{isHRAdmin && selectedReview.state === 'calibration' && <Button size="small" variant="contained" disabled={saving} onClick={() => void transition('closed')}>Close review</Button>}</Stack>}</Stack>{selectedReview && <Typography variant="body2" color="text.secondary" mt={1.5}>{selectedReview.sourceCycle.name} · {selectedReview.entries.length} people in your visible scope</Typography>}</Paper>
            {selectedReview && <>
              {unassessed.length > 0 && <Paper variant="outlined" sx={{ overflow: 'hidden' }}><Box sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider' }}><Typography fontWeight={650}>Needs assessment ({unassessed.length})</Typography><Typography variant="body2" color="text.secondary">Performance is fixed from the appraisal; potential and readiness require a proposal.</Typography></Box><TableContainer><Table size="small" sx={{ minWidth: 650 }}><TableHead><TableRow><TableCell>Employee</TableCell><TableCell>Performance evidence</TableCell><TableCell>Decision</TableCell><TableCell align="right">Action</TableCell></TableRow></TableHead><TableBody>{unassessed.map((entry) => <TableRow key={entry.employee.userId}><TableCell><Typography variant="body2" fontWeight={600}>{entry.employee.name}</Typography><Typography variant="caption" color="text.secondary">{entry.employee.jobTitle || entry.employee.teamName || 'Role not recorded'}</Typography></TableCell><TableCell>{entry.evidenceSnapshot.finalRating}/5 · {PERFORMANCE_LABELS[entry.performanceBand]}{entry.evidenceSnapshot.goalAchievement !== undefined ? ` · ${entry.evidenceSnapshot.goalAchievement}% goals` : ''}</TableCell><TableCell><Chip size="small" label="Not assessed" /></TableCell><TableCell align="right"><Button size="small" disabled={!['open', 'calibration'].includes(selectedReview.state)} onClick={() => openAssessment(entry)}>Assess</Button></TableCell></TableRow>)}</TableBody></Table></TableContainer></Paper>}
              <Box><Typography variant="h6" mb={1}>Nine-box discussion view</Typography><Typography variant="body2" color="text.secondary" mb={1.5}>Rows are human-assessed potential; columns use the frozen final appraisal rating. Empty cells remain empty rather than being inferred.</Typography><Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' }, gap: 1 }}>{['high', 'moderate', 'limited'].flatMap((potential) => ['developing', 'effective', 'strong'].map((performance) => { const entries = matrix.get(`${potential}:${performance}`) || []; return <Paper key={`${potential}:${performance}`} variant="outlined" sx={{ minHeight: 130, p: 1.5 }}><Stack direction="row" justifyContent="space-between" gap={1} mb={1}><Typography variant="caption" fontWeight={700}>{POTENTIAL_LABELS[potential as keyof typeof POTENTIAL_LABELS]} potential</Typography><Typography variant="caption" color="text.secondary">{PERFORMANCE_LABELS[performance as keyof typeof PERFORMANCE_LABELS]}</Typography></Stack>{entries.length === 0 ? <Typography variant="body2" color="text.secondary">No people</Typography> : <Stack gap={0.75}>{entries.map((entry) => <Button key={entry.employee.userId} variant="text" size="small" sx={{ justifyContent: 'flex-start', textTransform: 'none' }} onClick={() => openAssessment(entry)}>{entry.employee.name} · {readinessLabel(entry.readiness)}</Button>)}</Stack>}</Paper>; }))}</Box></Box>
            </>}
          </>}
        </Stack>
      )}

      {isHRAdmin && tab === 1 && <Paper variant="outlined" sx={{ overflow: 'hidden' }}>{succession.length === 0 ? <Alert severity="info" sx={{ m: 2 }}>No critical-role succession coverage has been recorded.</Alert> : <TableContainer><Table size="small" sx={{ minWidth: 760 }}><TableHead><TableRow><TableCell>Role</TableCell><TableCell>Criticality</TableCell><TableCell>Candidates</TableCell><TableCell>Coverage</TableCell><TableCell>Review date</TableCell><TableCell align="right">Action</TableCell></TableRow></TableHead><TableBody>{succession.map((plan) => { const active = plan.candidates.filter((candidate) => candidate.state !== 'removed'); const ready = active.filter((candidate) => candidate.readiness === 'ready_now').length; return <TableRow key={plan._id}><TableCell><Typography variant="body2" fontWeight={600}>{plan.role.title}</Typography><Typography variant="caption" color="text.secondary">{plan.role.departmentName || plan.role.teamName || 'Organization-wide'}</Typography></TableCell><TableCell><Chip size="small" label={formatState(plan.role.criticality)} color={plan.role.criticality === 'critical' ? 'warning' : 'default'} /></TableCell><TableCell>{active.length}</TableCell><TableCell>{ready > 0 ? `${ready} ready now` : active.length > 0 ? 'Pipeline only' : 'No coverage'}</TableCell><TableCell>{plan.reviewDate ? new Date(plan.reviewDate).toLocaleDateString() : 'Not set'}</TableCell><TableCell align="right"><Button size="small" onClick={() => setCandidatePlan(plan)}>Add candidate</Button></TableCell></TableRow>; })}</TableBody></Table></TableContainer>}</Paper>}

      {tab === (isHRAdmin ? 2 : 1) && <Stack gap={2}><Alert severity="info">{methodology || 'Signals use explainable workflow rules only.'}</Alert>{signals.length === 0 ? <Alert severity="success">No stalled appraisal workflow signals are currently visible in this scope.</Alert> : <Paper variant="outlined" sx={{ overflow: 'hidden' }}><TableContainer><Table size="small" sx={{ minWidth: 700 }}><TableHead><TableRow><TableCell>Employee</TableCell><TableCell>Stage</TableCell><TableCell>Why it is flagged</TableCell><TableCell>Severity</TableCell></TableRow></TableHead><TableBody>{signals.map((signal) => <TableRow key={signal.appraisalId}><TableCell>{signal.employee.name}</TableCell><TableCell>{formatState(signal.status)}</TableCell><TableCell>{signal.reasons.join(' · ')}</TableCell><TableCell><Chip size="small" color={signal.severity === 'high' ? 'error' : 'warning'} label={formatState(signal.severity)} /></TableCell></TableRow>)}</TableBody></Table></TableContainer></Paper>}<Typography variant="caption" color="text.secondary">No predictive model is enabled. Production ML remains gated on validation, drift monitoring, privacy review, and an organization-approved rollback plan.</Typography></Stack>}

      <Dialog open={createReviewOpen} onClose={() => setCreateReviewOpen(false)} fullWidth maxWidth="sm" aria-labelledby="create-talent-review-title"><DialogTitle id="create-talent-review-title">Create talent review</DialogTitle><DialogContent><Stack gap={2} mt={1}><FormControl fullWidth><InputLabel id="source-cycle-label">Completed appraisal cycle</InputLabel><Select labelId="source-cycle-label" label="Completed appraisal cycle" value={reviewForm.sourceAppraisalCycleId} onChange={(event) => { const source = cycles.find((cycle) => cycle._id === event.target.value); setReviewForm((current) => ({ ...current, sourceAppraisalCycleId: event.target.value, name: current.name || (source ? `${source.name} talent review` : '') })); }}>{cycles.map((cycle) => <MenuItem key={cycle._id} value={cycle._id}>{cycle.name}</MenuItem>)}</Select></FormControl><TextField label="Review name" value={reviewForm.name} onChange={(event) => setReviewForm((current) => ({ ...current, name: event.target.value }))} required /><TextField label="Purpose (optional)" multiline minRows={3} value={reviewForm.description} onChange={(event) => setReviewForm((current) => ({ ...current, description: event.target.value }))} /><Alert severity="info">Only finalized appraisal records are copied. The source rating and goal evidence cannot be edited here.</Alert></Stack></DialogContent><DialogActions><Button onClick={() => setCreateReviewOpen(false)}>Cancel</Button><Button variant="contained" disabled={saving || !reviewForm.sourceAppraisalCycleId || !reviewForm.name.trim()} onClick={() => void createReview()}>Create review</Button></DialogActions></Dialog>

      <Dialog open={Boolean(editingEntry)} onClose={() => setEditingEntry(null)} fullWidth maxWidth="md" aria-labelledby="talent-assessment-title"><DialogTitle id="talent-assessment-title">Assess {editingEntry?.employee.name}</DialogTitle><DialogContent><Stack gap={2} mt={1}>{editingEntry && <Paper variant="outlined" sx={{ p: 1.5 }}><Stack direction={{ xs: 'column', sm: 'row' }} gap={2} justifyContent="space-between"><Box><Typography variant="body2" color="text.secondary">Frozen performance evidence</Typography><Typography fontWeight={650}>{editingEntry.evidenceSnapshot.finalRating}/5 · {PERFORMANCE_LABELS[editingEntry.performanceBand]}</Typography></Box><Box><Typography variant="body2" color="text.secondary">Goal achievement</Typography><Typography fontWeight={650}>{editingEntry.evidenceSnapshot.goalAchievement === undefined ? 'Not rated' : `${editingEntry.evidenceSnapshot.goalAchievement}%`}</Typography></Box><Box><Typography variant="body2" color="text.secondary">Finalized</Typography><Typography fontWeight={650}>{new Date(editingEntry.evidenceSnapshot.finalizedAt).toLocaleDateString()}</Typography></Box></Stack></Paper>}<Stack direction={{ xs: 'column', sm: 'row' }} gap={2}><FormControl fullWidth><InputLabel id="potential-label">Potential</InputLabel><Select labelId="potential-label" label="Potential" value={entryForm.potential} onChange={(event) => setEntryForm((current) => ({ ...current, potential: event.target.value }))}>{POTENTIAL.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}</Select></FormControl><FormControl fullWidth><InputLabel id="readiness-label">Readiness</InputLabel><Select labelId="readiness-label" label="Readiness" value={entryForm.readiness} onChange={(event) => setEntryForm((current) => ({ ...current, readiness: event.target.value }))}>{READINESS.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}</Select></FormControl></Stack><TextField label="Possible next role (optional)" value={entryForm.nextRole} onChange={(event) => setEntryForm((current) => ({ ...current, nextRole: event.target.value }))} /><TextField label="Evidence-based rationale" required multiline minRows={3} helperText="Use observed capability and agreed evidence. Do not include protected characteristics or unsupported assumptions." value={entryForm.rationale} onChange={(event) => setEntryForm((current) => ({ ...current, rationale: event.target.value }))} /><Stack direction={{ xs: 'column', sm: 'row' }} gap={2}><TextField fullWidth label="Strengths (one per line)" multiline minRows={3} value={entryForm.strengths} onChange={(event) => setEntryForm((current) => ({ ...current, strengths: event.target.value }))} /><TextField fullWidth label="Development priorities (one per line)" multiline minRows={3} value={entryForm.developmentPriorities} onChange={(event) => setEntryForm((current) => ({ ...current, developmentPriorities: event.target.value }))} /></Stack><FormControlLabel control={<Switch checked={entryForm.criticalRole} onChange={(event) => setEntryForm((current) => ({ ...current, criticalRole: event.target.checked }))} />} label="Employee currently holds a critical role" /><Divider /><Stack direction={{ xs: 'column', sm: 'row' }} gap={1} alignItems={{ sm: 'center' }}><Button startIcon={<AutoAwesome />} variant="outlined" disabled={saving} onClick={() => void requestAiBrief()}>Create evidence brief with AI</Button><Typography variant="caption" color="text.secondary">Summarizes source evidence only; it cannot select potential or readiness.</Typography></Stack>{editingEntry?.aiBriefs?.map((brief) => <Paper key={brief._id} variant="outlined" sx={{ p: 1.5 }}><Stack direction="row" justifyContent="space-between"><Typography fontWeight={650}>AI evidence brief</Typography><Chip size="small" label={formatState(brief.status)} /></Stack><Typography variant="body2" mt={1}>{brief.output.summary}</Typography>{brief.status === 'suggested' && <Stack direction="row" gap={1} mt={1}><Button size="small" onClick={() => void reviewAiBrief(brief._id, 'accepted')}>Accept as discussion aid</Button><Button size="small" color="inherit" onClick={() => void reviewAiBrief(brief._id, 'rejected')}>Reject</Button></Stack>}</Paper>)}</Stack></DialogContent><DialogActions><Button onClick={() => setEditingEntry(null)}>Cancel</Button><Button variant="contained" disabled={saving || entryForm.rationale.trim().length < 20} onClick={() => void saveAssessment()}>{isHRAdmin && selectedReview?.state === 'calibration' ? 'Save calibrated decision' : 'Save proposal'}</Button></DialogActions></Dialog>

      <Dialog open={createRoleOpen} onClose={() => setCreateRoleOpen(false)} fullWidth maxWidth="sm" aria-labelledby="create-role-title"><DialogTitle id="create-role-title">Add critical role coverage</DialogTitle><DialogContent><Stack gap={2} mt={1}><TextField label="Role title" required value={roleForm.title} onChange={(event) => setRoleForm((current) => ({ ...current, title: event.target.value }))} /><TextField label="Department (optional)" value={roleForm.departmentName} onChange={(event) => setRoleForm((current) => ({ ...current, departmentName: event.target.value }))} /><FormControl><InputLabel id="criticality-label">Criticality</InputLabel><Select labelId="criticality-label" label="Criticality" value={roleForm.criticality} onChange={(event) => setRoleForm((current) => ({ ...current, criticality: event.target.value }))}><MenuItem value="standard">Standard</MenuItem><MenuItem value="important">Important</MenuItem><MenuItem value="critical">Critical</MenuItem></Select></FormControl><TextField label="Review date" type="date" slotProps={{ inputLabel: { shrink: true } }} value={roleForm.reviewDate} onChange={(event) => setRoleForm((current) => ({ ...current, reviewDate: event.target.value }))} /></Stack></DialogContent><DialogActions><Button onClick={() => setCreateRoleOpen(false)}>Cancel</Button><Button variant="contained" disabled={saving || !roleForm.title.trim()} onClick={() => void createRole()}>Create coverage</Button></DialogActions></Dialog>

      <Dialog open={Boolean(candidatePlan)} onClose={() => setCandidatePlan(null)} fullWidth maxWidth="sm" aria-labelledby="add-candidate-title"><DialogTitle id="add-candidate-title">Add candidate for {candidatePlan?.role.title}</DialogTitle><DialogContent><Stack gap={2} mt={1}><Autocomplete options={employeeOptions} getOptionLabel={(option) => option.name} value={candidateForm.employee} onInputChange={(_, value) => void searchEmployees(value)} onChange={(_, value) => setCandidateForm((current) => ({ ...current, employee: value }))} renderInput={(params) => <TextField {...params} label="Search active employee" required />} /><FormControl><InputLabel id="candidate-readiness-label">Readiness</InputLabel><Select labelId="candidate-readiness-label" label="Readiness" value={candidateForm.readiness} onChange={(event) => setCandidateForm((current) => ({ ...current, readiness: event.target.value }))}>{READINESS.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}</Select></FormControl><TextField label="Evidence-based rationale" required multiline minRows={3} value={candidateForm.rationale} onChange={(event) => setCandidateForm((current) => ({ ...current, rationale: event.target.value }))} /><TextField label="Strengths (one per line)" multiline minRows={2} value={candidateForm.strengths} onChange={(event) => setCandidateForm((current) => ({ ...current, strengths: event.target.value }))} /><TextField label="Development gaps (one per line)" multiline minRows={2} value={candidateForm.developmentGaps} onChange={(event) => setCandidateForm((current) => ({ ...current, developmentGaps: event.target.value }))} /></Stack></DialogContent><DialogActions><Button onClick={() => setCandidatePlan(null)}>Cancel</Button><Button variant="contained" disabled={saving || !candidateForm.employee || candidateForm.rationale.trim().length < 20} onClick={() => void addCandidate()}>Add candidate</Button></DialogActions></Dialog>
    </Box>
  );
}
