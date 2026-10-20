'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, FormControl, InputLabel, MenuItem, Paper, Select, Stack, TextField, Typography
} from '@mui/material';
import { Add, AutoAwesome, Check, History, Send } from '@mui/icons-material';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useDirectReports, useUserContext } from '@/lib/hooks';
import { usePerformanceWorkspace } from '@/context/PerformanceWorkspaceContext';

type PlanState = 'draft' | 'hr_review' | 'changes_requested' | 'employee_review' | 'active' | 'review_due' | 'completed' | 'extended' | 'escalated' | 'cancelled';

interface SupportPlan {
  _id: string;
  planType: 'informal_support' | 'formal_improvement';
  state: PlanState;
  title: string;
  summary: string;
  employee: { userId: string; name?: string; email?: string };
  manager: { userId: string; name?: string; email?: string };
  objectives: Array<{ _id?: string; title: string; measure: string; target: string; dueDate: string; status: string; progress?: number }>;
  supportCommitments: Array<{ description: string; ownerType: string; status: string }>;
  milestones: Array<{ _id: string; title: string; dueDate: string; status: string; employeeUpdate?: string; managerResponse?: string }>;
  checkIns: Array<{ _id: string; authorId: string; authorRole: string; progress?: number; update: string; createdAt: string }>;
  employeeResponse?: { acknowledgement?: string; comment?: string; respondedAt?: string };
  hrReview?: { decision?: string; comment?: string; decidedAt?: string };
  outcome?: { decision?: string; reason?: string; decidedAt?: string; nextReviewDate?: string };
  updatedAt: string;
}

interface DraftForm {
  employeeId: string;
  planType: 'informal_support' | 'formal_improvement';
  title: string;
  summary: string;
  concern: string;
  expectedStandard: string;
  objectiveTitle: string;
  measure: string;
  target: string;
  dueDate: string;
  supportCommitment: string;
}

interface AiDraft {
  title: string;
  summary: string;
  objectives: Array<{ title: string; measure: string; target: string }>;
  supportCommitments: string[];
}

type PlanAmendment = Pick<SupportPlan, 'title' | 'summary' | 'objectives' | 'supportCommitments'>;

const initialForm: DraftForm = {
  employeeId: '', planType: 'informal_support', title: '', summary: '', concern: '', expectedStandard: '',
  objectiveTitle: '', measure: '', target: '', dueDate: '', supportCommitment: ''
};

const stateLabel: Record<PlanState, string> = {
  draft: 'Draft', hr_review: 'HR review', changes_requested: 'Changes requested', employee_review: 'Employee review',
  active: 'Active', review_due: 'Review due', completed: 'Completed', extended: 'Extended', escalated: 'Escalated', cancelled: 'Cancelled'
};

function dataOf<T>(response: { data?: unknown }): T {
  const payload = response.data as { data?: T } | T;
  return ((payload as { data?: T })?.data ?? payload) as T;
}

function errorText(error: unknown, fallback: string) {
  const candidate = error as { response?: { data?: { error?: string } }; message?: string };
  return candidate.response?.data?.error || candidate.message || fallback;
}

function dateText(value?: string) {
  if (!value) return 'Not set';
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
}

export default function SupportPlansPage() {
  const { workspace } = usePerformanceWorkspace();
  const { user, isManager, isHRAdmin } = useUserContext();
  const { user: authUser, currentOrganization } = useAuth();
  const { directReports } = useDirectReports();
  const actorId = String(user?.id || user?.sub || '');
  const defaultView = workspace === 'admin' && isHRAdmin ? 'hr_review' : workspace === 'manager' && isManager ? 'team' : 'mine';
  const [chosenView, setChosenView] = useState('');
  const view = chosenView || defaultView;
  const [plans, setPlans] = useState<SupportPlan[]>([]);
  const [selected, setSelected] = useState<SupportPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<DraftForm>(initialForm);
  const [aiSuggestion, setAiSuggestion] = useState<{ suggestionId: string; draft: AiDraft } | null>(null);
  const [comment, setComment] = useState('');
  const [progress, setProgress] = useState(50);
  const [amendment, setAmendment] = useState<PlanAmendment | null>(null);
  const [milestoneEdit, setMilestoneEdit] = useState<{ id: string; title: string; status: string; comment: string } | null>(null);
  const [outcomeOpen, setOutcomeOpen] = useState(false);
  const [outcomeForm, setOutcomeForm] = useState({ decision: 'completed', reason: '', nextReviewDate: '' });
  const [actionError, setActionError] = useState('');
  const claimedOrganization = [...(authUser?.organizations || []), ...(authUser?.idpOrganizations || [])].find(org => String(org.id || org._id) === String(currentOrganization?.id)) || currentOrganization;
  const grants = claimedOrganization?.authorization?.permissionsByApp?.['performance-management'] ?? claimedOrganization?.appPermissions?.['performance-management'];
  const canManageGrant = Array.isArray(grants) ? grants.includes('support_plan:manage:direct_reports') : isManager || isHRAdmin;

  const people = useMemo(() => (directReports || []).map((person: Record<string, unknown>) => ({
    id: String(person.userId || person.id || person._id || ''),
    name: String(person.name || person.email || 'Team member'),
    email: String(person.email || '')
  })).filter(person => person.id), [directReports]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const items = dataOf<SupportPlan[]>(await api.get('/support-plans', { params: { view } }));
      setPlans(Array.isArray(items) ? items : []);
      if (selected) setSelected((Array.isArray(items) ? items : []).find(item => item._id === selected._id) || null);
    } catch (requestError) { setError(errorText(requestError, 'Could not load support plans.')); }
    finally { setLoading(false); }
  }, [selected, view]);

  useEffect(() => { void load(); }, [view]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setChosenView(''); }, [workspace, currentOrganization?.id]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('plan');
    if (!id || !actorId) return;
    let active = true;
    void api.get(`/support-plans/${encodeURIComponent(id)}`).then(response => { if (active) setSelected(dataOf<SupportPlan>(response)); }).catch(requestError => { if (active) setError(errorText(requestError, 'This support plan is unavailable.')); });
    return () => { active = false; };
  }, [actorId, currentOrganization?.id]);

  const runAction = async (name: string, endpoint: string, body: Record<string, unknown>, message: string) => {
    setWorking(name); setError(''); setNotice('');
    try {
      const item = dataOf<SupportPlan>(await api.post(endpoint, body));
      setSelected(item); setComment(''); setNotice(message); await load();
    } catch (requestError) { setError(errorText(requestError, 'The action could not be completed.')); }
    finally { setWorking(''); }
  };

  const openPlan = (plan: SupportPlan) => {
    setSelected(plan); setComment(''); setAmendment(null); setError('');
  };

  const editPlan = () => {
    if (!selected) return;
    setError('');
    setAmendment({ title: selected.title, summary: selected.summary,
      objectives: selected.objectives.map(objective => ({ ...objective })),
      supportCommitments: selected.supportCommitments.map(commitment => ({ ...commitment })) });
  };

  const saveAmendment = async () => {
    if (!selected || !amendment) return;
    if (!amendment.title.trim() || !amendment.summary.trim() || amendment.objectives.some(objective => !objective.title.trim() || !objective.measure.trim() || !objective.target.trim() || !objective.dueDate)
      || amendment.supportCommitments.some(commitment => !commitment.description.trim())) {
      setError('Complete the title, summary, every measurable objective and support commitment.'); return;
    }
    setWorking('amend'); setError('');
    try {
      const item = dataOf<SupportPlan>(await api.patch(`/support-plans/${selected._id}`, amendment));
      setSelected(item); setAmendment(null); setNotice('Support plan changes saved. Send the plan to HR when it is ready.'); await load();
    } catch (requestError) { setError(errorText(requestError, 'Could not save the support plan changes.')); }
    finally { setWorking(''); }
  };

  const createPlan = async () => {
    const person = people.find(item => item.id === form.employeeId);
    if (!person || !form.title || !form.summary || !form.objectiveTitle || !form.measure || !form.target || !form.dueDate || !form.supportCommitment) {
      setError('Complete the employee, plan summary, measurable objective, due date, and support commitment.'); return;
    }
    setWorking('create'); setError('');
    try {
      const item = dataOf<SupportPlan>(await api.post('/support-plans', {
        employee: { userId: person.id, name: person.name, email: person.email },
        manager: { name: user?.name, email: user?.email },
        planType: form.planType, title: form.title, summary: form.summary,
        concerns: form.concern ? [{ description: form.concern, expectedStandard: form.expectedStandard }] : [],
        objectives: [{ title: form.objectiveTitle, measure: form.measure, target: form.target, dueDate: form.dueDate }],
        supportCommitments: [{ description: form.supportCommitment, ownerType: 'manager', dueDate: form.dueDate }],
        milestones: [{ title: 'Formal progress review', dueDate: form.dueDate }], reviewDates: [form.dueDate],
        ...(aiSuggestion ? { aiAssistance: aiSuggestion } : {})
      }));
      setCreateOpen(false); setForm(initialForm); setAiSuggestion(null); setSelected(item); setNotice('Support plan saved as a draft.'); await load();
    } catch (requestError) { setError(errorText(requestError, 'Could not create the support plan.')); }
    finally { setWorking(''); }
  };

  const generateDraft = async () => {
    if (!form.concern || !form.expectedStandard) { setError('Describe the concern and expected standard before using AI drafting.'); return; }
    setWorking('ai'); setError('');
    try {
      const result = dataOf<{ suggestionId: string; draft: AiDraft }>(await api.post('/support-plans/ai-draft', {
        planType: form.planType, concern: form.concern, expectedStandard: form.expectedStandard, timeframeDays: 30
      }));
      const draft = result.draft;
      setAiSuggestion({ suggestionId: result.suggestionId, draft });
      setForm(current => ({ ...current, title: draft.title || current.title, summary: draft.summary || current.summary,
        objectiveTitle: draft.objectives?.[0]?.title || current.objectiveTitle, measure: draft.objectives?.[0]?.measure || current.measure,
        target: draft.objectives?.[0]?.target || current.target, supportCommitment: draft.supportCommitments?.[0] || current.supportCommitment }));
      setNotice('AI draft added. Review every field before saving; no employment decision was made.');
    } catch (requestError) { setError(errorText(requestError, 'AI drafting is unavailable. Continue manually or review your AI settings.')); }
    finally { setWorking(''); }
  };

  const canCreate = workspace !== 'personal' && (isManager || isHRAdmin);
  const ownSelected = selected?.employee.userId === actorId;
  const managesSelected = Boolean(selected && (isHRAdmin || selected.manager.userId === actorId || people.some(person => person.id === selected.employee.userId)));
  const activeSelected = Boolean(selected && ['active', 'review_due', 'extended'].includes(selected.state));
  const canUpdateMilestones = activeSelected && (ownSelected || (managesSelected && canManageGrant));
  const canRecordOutcome = activeSelected && managesSelected && canManageGrant;
  const canAmendSelected = Boolean(selected && !ownSelected && (isManager || isHRAdmin) && ['draft', 'changes_requested'].includes(selected.state));

  const saveMilestone = async () => {
    if (!selected || !milestoneEdit || !canUpdateMilestones || !milestoneEdit.comment.trim()) return;
    setWorking('milestone'); setActionError('');
    try {
      const item = dataOf<SupportPlan>(await api.patch(`/support-plans/${selected._id}/milestones/${milestoneEdit.id}`, {
        status: milestoneEdit.status, [ownSelected ? 'employeeUpdate' : 'managerResponse']: milestoneEdit.comment.trim()
      }));
      await load(); setSelected(item); setMilestoneEdit(null); setNotice('Milestone updated.');
    } catch (requestError) { setActionError(errorText(requestError, 'Could not update the milestone. Your changes are retained.')); }
    finally { setWorking(''); }
  };

  const saveOutcome = async () => {
    if (!selected || !canRecordOutcome || !outcomeForm.reason.trim()) return;
    setWorking('outcome'); setActionError('');
    try {
      const item = dataOf<SupportPlan>(await api.post(`/support-plans/${selected._id}/outcome`, {
        decision: outcomeForm.decision, reason: outcomeForm.reason.trim(), nextReviewDate: outcomeForm.nextReviewDate || undefined
      }));
      await load(); setSelected(item); setOutcomeOpen(false); setNotice('Support plan outcome recorded.');
    } catch (requestError) { setActionError(errorText(requestError, 'Could not record the outcome. Your decision is retained for retry.')); }
    finally { setWorking(''); }
  };

  return (
    <Box sx={{ maxWidth: 1120, mx: 'auto', px: { xs: 2, md: 3 }, py: 3 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={2} mb={3}>
        <Box><Typography variant="h4" component="h1" fontWeight={700}>Support plans</Typography><Typography color="text.secondary" mt={0.5}>Clear expectations, documented support, regular reviews, and a complete decision history.</Typography></Box>
        {canCreate && <Button variant="contained" startIcon={<Add />} onClick={() => setCreateOpen(true)}>New support plan</Button>}
      </Stack>
      <Alert severity="info" sx={{ mb: 2 }}>Support plans organize fair coaching and improvement work. They never calculate appraisal ratings or automatic employment outcomes.</Alert>
      {error && !selected && !createOpen && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}{/AI_|ChatGPT|inference/i.test(error) && <> <Link href="/settings/ai">Review AI settings</Link>.</>}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice('')}>{notice}</Alert>}

      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} gap={2} justifyContent="space-between" sx={{ px: 2.5, py: 1.5, borderBottom: 1, borderColor: 'divider' }}><Typography fontWeight={650}>{view === 'hr_review' ? 'HR review queue' : view === 'team' ? isHRAdmin ? 'All support plans' : 'Team support plans' : 'My support plans'}</Typography>
          {workspace === 'admin' && isHRAdmin && <TextField select size="small" label="Plan view" value={view} sx={{ minWidth: 200 }} onChange={event => setChosenView(event.target.value)}><MenuItem value="hr_review">Awaiting HR review</MenuItem><MenuItem value="team">All support plans</MenuItem><MenuItem value="mine">My support plans</MenuItem></TextField>}
        </Stack>
        {loading ? <Box sx={{ py: 8, textAlign: 'center' }}><CircularProgress size={28} /></Box> : plans.length === 0 ? <Box sx={{ p: 4 }}><Typography fontWeight={600}>No support plans in this view</Typography><Typography color="text.secondary" mt={0.5}>{view === 'mine' ? 'Any plan shared with you will appear here with its next action.' : 'There is no review work waiting right now.'}</Typography></Box> : plans.map((plan, index) => (
          <Box component="article" aria-label={plan.title} key={plan._id} sx={{ p: 2.5, borderTop: index ? 1 : 0, borderColor: 'divider' }}>
            <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2}>
              <Box><Stack direction="row" spacing={1} flexWrap="wrap"><Chip size="small" label={stateLabel[plan.state]} color={['hr_review', 'review_due', 'changes_requested'].includes(plan.state) ? 'warning' : plan.state === 'active' ? 'success' : 'default'} /><Chip size="small" variant="outlined" label={plan.planType === 'formal_improvement' ? 'Formal improvement' : 'Informal support'} /></Stack><Typography variant="h6" mt={1}>{plan.title}</Typography><Typography color="text.secondary" variant="body2">{view === 'mine' ? `Manager: ${plan.manager.name || plan.manager.email || 'Assigned manager'}` : `Employee: ${plan.employee.name || plan.employee.email || plan.employee.userId}`}</Typography></Box>
              <Stack alignItems={{ md: 'flex-end' }} justifyContent="space-between"><Typography variant="caption" color="text.secondary">Updated {dateText(plan.updatedAt)}</Typography><Button size="small" onClick={() => openPlan(plan)}>Open plan</Button></Stack>
            </Stack>
          </Box>
        ))}
      </Paper>

      <Dialog open={createOpen} onClose={() => !working && setCreateOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>Create a support plan</DialogTitle>
        <DialogContent dividers><Stack spacing={2.2} pt={0.5}>
          {error && <Alert severity="error">{error}{/AI_|ChatGPT|inference/i.test(error) && <> <Link href="/settings/ai">Review AI settings</Link>.</>}</Alert>}
          <Alert severity="info">Write observable expectations and the support the organization will provide. HR reviews the plan before the employee sees it.</Alert>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <FormControl fullWidth><InputLabel id="support-plan-employee-label">Employee</InputLabel><Select labelId="support-plan-employee-label" label="Employee" value={form.employeeId} onChange={event => setForm(current => ({ ...current, employeeId: String(event.target.value) }))}>{people.map(person => <MenuItem key={person.id} value={person.id}>{person.name}</MenuItem>)}</Select></FormControl>
            <FormControl fullWidth><InputLabel id="support-plan-type-label">Plan type</InputLabel><Select labelId="support-plan-type-label" label="Plan type" value={form.planType} onChange={event => setForm(current => ({ ...current, planType: event.target.value as DraftForm['planType'] }))}><MenuItem value="informal_support">Informal support</MenuItem><MenuItem value="formal_improvement">Formal improvement</MenuItem></Select></FormControl>
          </Stack>
          <TextField label="Observed concern" multiline minRows={2} value={form.concern} onChange={event => setForm(current => ({ ...current, concern: event.target.value }))} helperText="Use specific work evidence. Do not add medical or other protected personal information." />
          <TextField label="Expected standard" multiline minRows={2} value={form.expectedStandard} onChange={event => setForm(current => ({ ...current, expectedStandard: event.target.value }))} />
          <Box><Button variant="outlined" startIcon={<AutoAwesome />} disabled={working === 'ai'} onClick={() => void generateDraft()}>{working === 'ai' ? 'Drafting…' : 'Draft measurable wording with AI'}</Button><Typography display="block" variant="caption" color="text.secondary" mt={0.75}>Advisory only. Your concern summary is sent without employee identity, ratings, feedback, or pulse data.</Typography></Box>
          <Divider />
          <TextField label="Plan title" required value={form.title} onChange={event => setForm(current => ({ ...current, title: event.target.value }))} />
          <TextField label="Plan summary" required multiline minRows={3} value={form.summary} onChange={event => setForm(current => ({ ...current, summary: event.target.value }))} />
          <Typography fontWeight={650}>First measurable objective</Typography>
          <TextField label="Objective" required value={form.objectiveTitle} onChange={event => setForm(current => ({ ...current, objectiveTitle: event.target.value }))} />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}><TextField fullWidth label="How it will be measured" required value={form.measure} onChange={event => setForm(current => ({ ...current, measure: event.target.value }))} /><TextField fullWidth label="Target" required value={form.target} onChange={event => setForm(current => ({ ...current, target: event.target.value }))} /></Stack>
          <TextField type="date" label="Review date" required InputLabelProps={{ shrink: true }} value={form.dueDate} onChange={event => setForm(current => ({ ...current, dueDate: event.target.value }))} />
          <TextField label="Manager or organization support commitment" required multiline minRows={2} value={form.supportCommitment} onChange={event => setForm(current => ({ ...current, supportCommitment: event.target.value }))} />
        </Stack></DialogContent>
        <DialogActions><Button onClick={() => { setCreateOpen(false); setAiSuggestion(null); }}>Cancel</Button><Button variant="contained" disabled={Boolean(working)} onClick={() => void createPlan()}>{working === 'create' ? 'Saving…' : 'Save draft'}</Button></DialogActions>
      </Dialog>

      <Dialog open={Boolean(selected)} onClose={() => { if (!working) { setSelected(null); setAmendment(null); } }} fullWidth maxWidth="md">
        {selected && <><DialogTitle><Stack direction="row" justifyContent="space-between" alignItems="center" gap={2}><span>{selected.title}</span><Chip size="small" label={stateLabel[selected.state]} /></Stack></DialogTitle><DialogContent dividers>
          <Stack spacing={2.5}>
            {error && <Alert severity="error">{error}</Alert>}
            {amendment ? <Stack spacing={2}>
              <Alert severity="info">Update this existing plan, then send it to HR for review. The employee and plan type stay the same.</Alert>
              <TextField label="Plan title" required disabled={Boolean(working)} value={amendment.title} onChange={event => setAmendment(current => current && ({ ...current, title: event.target.value }))} />
              <TextField label="Plan summary" required disabled={Boolean(working)} multiline minRows={3} value={amendment.summary} onChange={event => setAmendment(current => current && ({ ...current, summary: event.target.value }))} />
              {amendment.objectives.map((objective, index) => <Stack spacing={1.5} key={objective._id || index}>
                <Typography fontWeight={650}>Objective {index + 1}</Typography>
                {(['title', 'measure', 'target', 'dueDate'] as const).map(field => <TextField key={field} required disabled={Boolean(working)} type={field === 'dueDate' ? 'date' : 'text'} label={`${field === 'title' ? 'Objective' : field === 'measure' ? 'Measure' : field === 'target' ? 'Target' : 'Objective due date'} ${index + 1}`} value={field === 'dueDate' ? objective.dueDate.slice(0, 10) : objective[field]} helperText={field === 'dueDate' ? 'Objective deadline only; plan review and milestone dates stay the same.' : undefined} slotProps={field === 'dueDate' ? { inputLabel: { shrink: true } } : undefined} onChange={event => setAmendment(current => current && ({ ...current, objectives: current.objectives.map((item, position) => position === index ? { ...item, [field]: event.target.value } : item) }))} />)}
              </Stack>)}
              {amendment.supportCommitments.map((commitment, index) => <TextField key={index} label={`Support commitment ${index + 1}`} required disabled={Boolean(working)} multiline minRows={2} value={commitment.description} onChange={event => setAmendment(current => current && ({ ...current, supportCommitments: current.supportCommitments.map((item, position) => position === index ? { ...item, description: event.target.value } : item) }))} />)}
            </Stack> : <>
            <Box><Typography variant="overline" color="text.secondary">Plan summary</Typography><Typography sx={{ whiteSpace: 'pre-wrap' }}>{selected.summary}</Typography></Box>
            <Divider /><Box><Typography fontWeight={650} mb={1}>Measurable objectives</Typography>{selected.objectives.map((objective, index) => <Paper variant="outlined" sx={{ p: 2, mb: 1 }} key={objective._id || index}><Typography fontWeight={600}>{objective.title}</Typography><Typography variant="body2" color="text.secondary" mt={0.5}>{objective.measure} · Target: {objective.target}</Typography><Typography variant="caption">Review by {dateText(objective.dueDate)}</Typography></Paper>)}</Box>
            <Box><Typography fontWeight={650} mb={1}>Support commitments</Typography>{selected.supportCommitments.map((item, index) => <Box key={index} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}><Typography variant="body2">• {item.description}</Typography><Chip size="small" variant="outlined" label={item.status} /></Box>)}</Box>
            </>}
            {selected.hrReview?.comment && <Alert severity={selected.hrReview.decision === 'approved' ? 'success' : 'warning'}><strong>HR review:</strong> {selected.hrReview.comment}</Alert>}
            {selected.employeeResponse?.respondedAt && <Alert severity="info"><strong>Employee response:</strong> {selected.employeeResponse.acknowledgement?.replaceAll('_', ' ')}{selected.employeeResponse.comment ? ` — ${selected.employeeResponse.comment}` : ''}</Alert>}
            {selected.state === 'hr_review' && isHRAdmin && <TextField fullWidth multiline minRows={3} label="HR review comments" disabled={Boolean(working)} value={comment} onChange={event => setComment(event.target.value)} helperText="Explain the changes needed before requesting changes. Comments are optional when approving." slotProps={{ htmlInput: { maxLength: 4000 } }} />}
            {selected.state === 'employee_review' && ownSelected && <TextField fullWidth multiline minRows={3} label="Your comments" disabled={Boolean(working)} value={comment} onChange={event => setComment(event.target.value)} helperText="Add comments to acknowledge with comments, or acknowledge without comments below." slotProps={{ htmlInput: { maxLength: 4000 } }} />}
            {activeSelected && <Box><Typography fontWeight={650} mb={1}>Add progress check-in</Typography><TextField fullWidth multiline minRows={2} label="Progress update" value={comment} onChange={event => setComment(event.target.value)} /><TextField sx={{ mt: 1.5, width: 180 }} type="number" label="Progress %" value={progress} inputProps={{ min: 0, max: 100 }} onChange={event => setProgress(Number(event.target.value))} /><Button sx={{ mt: 1.5, ml: 1.5 }} variant="outlined" disabled={!comment || Boolean(working)} onClick={() => void runAction('checkin', `/support-plans/${selected._id}/check-ins`, { update: comment, progress }, 'Progress check-in added.')}>Add check-in</Button></Box>}
            {selected.milestones.length > 0 && <Box><Typography fontWeight={650} mb={1}>Milestones</Typography>{selected.milestones.map(milestone => <Paper key={milestone._id} variant="outlined" sx={{ p: 2, mb: 1 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} justifyContent="space-between"><Box><Typography fontWeight={600}>{milestone.title}</Typography><Typography variant="caption">{dateText(milestone.dueDate)} · {milestone.status}</Typography></Box>{canUpdateMilestones && <Button size="small" disabled={Boolean(working)} onClick={() => { setActionError(''); setMilestoneEdit({ id: milestone._id, title: milestone.title, status: milestone.status, comment: (ownSelected ? milestone.employeeUpdate : milestone.managerResponse) || '' }); }}>Update milestone</Button>}</Stack>
              {milestone.employeeUpdate && <Typography variant="body2" mt={1}><strong>Employee update:</strong> {milestone.employeeUpdate}</Typography>}
              {milestone.managerResponse && <Typography variant="body2" mt={1}><strong>Manager response:</strong> {milestone.managerResponse}</Typography>}
            </Paper>)}</Box>}
            {selected.checkIns.length > 0 && <Box><Typography fontWeight={650} mb={1}>Check-in history</Typography>{selected.checkIns.slice().reverse().map(item => <Box key={item._id} sx={{ borderLeft: 2, borderColor: 'divider', pl: 2, py: 0.5, mb: 1 }}><Typography variant="body2">{item.update}</Typography><Typography variant="caption" color="text.secondary">{item.authorRole} · {dateText(item.createdAt)}{item.progress !== undefined ? ` · ${item.progress}%` : ''}</Typography></Box>)}</Box>}
            {selected.outcome?.decision && <Alert severity="success"><strong>Outcome:</strong> {selected.outcome.decision} — {selected.outcome.reason}</Alert>}
            <Stack direction="row" spacing={1} alignItems="center"><History fontSize="small" /><Typography variant="caption" color="text.secondary">Every edit, decision, response, and outcome remains in the audit history.</Typography></Stack>
          </Stack>
        </DialogContent><DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button disabled={Boolean(working)} onClick={() => { setSelected(null); setAmendment(null); }}>Close</Button>
          {amendment ? <><Button disabled={Boolean(working)} onClick={() => { setAmendment(null); setError(''); }}>Cancel editing</Button><Button variant="contained" disabled={Boolean(working)} onClick={() => void saveAmendment()}>{working === 'amend' ? 'Saving…' : 'Save changes'}</Button></> : canAmendSelected && <><Button disabled={Boolean(working)} onClick={editPlan}>Edit plan</Button><Button variant="contained" startIcon={<Send />} disabled={Boolean(working)} onClick={() => void runAction('submit', `/support-plans/${selected._id}/submit-for-hr-review`, {}, 'Plan sent to HR for review.')}>{selected.state === 'changes_requested' ? 'Resubmit to HR' : 'Send to HR'}</Button></>}
          {selected.state === 'hr_review' && isHRAdmin && <><Button color="warning" disabled={!comment.trim() || Boolean(working)} onClick={() => void runAction('changes', `/support-plans/${selected._id}/hr-decision`, { decision: 'request_changes', comment }, 'Changes sent to the manager.')}>Request changes</Button><Button variant="contained" startIcon={<Check />} disabled={Boolean(working)} onClick={() => void runAction('approve', `/support-plans/${selected._id}/hr-decision`, { decision: 'approve', comment }, 'Plan approved and sent to the employee.')}>Approve for employee review</Button></>}
          {selected.state === 'employee_review' && ownSelected && <><Button variant="outlined" disabled={!comment.trim() || Boolean(working)} onClick={() => void runAction('respond', `/support-plans/${selected._id}/employee-response`, { acknowledgement: 'acknowledged_with_comments', comment }, 'Your response was recorded and the plan is active.')}>Acknowledge with comments</Button><Button variant="contained" disabled={Boolean(working)} onClick={() => void runAction('respond', `/support-plans/${selected._id}/employee-response`, { acknowledgement: 'acknowledged' }, 'Your acknowledgement was recorded and the plan is active.')}>Acknowledge</Button></>}
          {canRecordOutcome && <Button variant="outlined" disabled={Boolean(working)} onClick={() => { setActionError(''); setOutcomeForm({ decision: 'completed', reason: '', nextReviewDate: '' }); setOutcomeOpen(true); }}>Record outcome</Button>}
        </DialogActions></>}
      </Dialog>
      <Dialog open={Boolean(milestoneEdit)} onClose={() => !working && setMilestoneEdit(null)} fullWidth maxWidth="sm" aria-labelledby="support-milestone-title">
        <DialogTitle id="support-milestone-title">Update milestone</DialogTitle>
        <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
          {actionError && <Alert severity="error">{actionError}</Alert>}
          <Typography>{milestoneEdit?.title}</Typography>
          <TextField select label="Milestone status" disabled={Boolean(working)} value={milestoneEdit?.status || 'upcoming'} onChange={event => setMilestoneEdit(current => current && ({ ...current, status: event.target.value }))}>{['upcoming', 'due', 'completed', 'missed'].map(status => <MenuItem key={status} value={status}>{status[0].toUpperCase() + status.slice(1)}</MenuItem>)}</TextField>
          <TextField label={ownSelected ? 'Employee update' : 'Manager response'} required multiline minRows={3} disabled={Boolean(working)} value={milestoneEdit?.comment || ''} onChange={event => setMilestoneEdit(current => current && ({ ...current, comment: event.target.value }))} />
        </Stack></DialogContent>
        <DialogActions><Button disabled={Boolean(working)} onClick={() => setMilestoneEdit(null)}>Cancel</Button><Button variant="contained" disabled={Boolean(working) || !milestoneEdit?.comment.trim()} onClick={() => void saveMilestone()}>{working === 'milestone' ? 'Saving…' : 'Save milestone'}</Button></DialogActions>
      </Dialog>
      <Dialog open={outcomeOpen} onClose={() => !working && setOutcomeOpen(false)} fullWidth maxWidth="sm" aria-labelledby="support-outcome-title">
        <DialogTitle id="support-outcome-title">Record support plan outcome</DialogTitle>
        <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
          {actionError && <Alert severity="error">{actionError}</Alert>}
          <Typography>{selected?.title}</Typography><Typography variant="body2" color="text.secondary">Record your decision and reason in the plan history. Appraisal ratings stay unchanged.</Typography>
          <TextField select label="Outcome" disabled={Boolean(working)} value={outcomeForm.decision} onChange={event => setOutcomeForm(current => ({ ...current, decision: event.target.value }))}>{['completed', 'extended', ...(selected?.planType !== 'formal_improvement' || isHRAdmin ? ['escalated', 'cancelled'] : [])].map(decision => <MenuItem key={decision} value={decision}>{stateLabel[decision as PlanState]}</MenuItem>)}</TextField>
          {selected?.planType === 'formal_improvement' && !isHRAdmin && <Typography variant="caption">HR records escalation or cancellation for a formal plan.</Typography>}
          <TextField label="Outcome reason" required multiline minRows={3} disabled={Boolean(working)} value={outcomeForm.reason} onChange={event => setOutcomeForm(current => ({ ...current, reason: event.target.value }))} />
          {outcomeForm.decision === 'extended' && <TextField type="date" label="Next review date (optional)" InputLabelProps={{ shrink: true }} disabled={Boolean(working)} value={outcomeForm.nextReviewDate} onChange={event => setOutcomeForm(current => ({ ...current, nextReviewDate: event.target.value }))} />}
        </Stack></DialogContent>
        <DialogActions><Button disabled={Boolean(working)} onClick={() => setOutcomeOpen(false)}>Keep current state</Button><Button variant="contained" disabled={Boolean(working) || !outcomeForm.reason.trim()} onClick={() => void saveOutcome()}>{working === 'outcome' ? 'Saving…' : 'Record outcome'}</Button></DialogActions>
      </Dialog>
    </Box>
  );
}
