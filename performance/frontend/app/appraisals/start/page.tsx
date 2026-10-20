'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Alert, Box, Button, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControlLabel, MenuItem, Paper, Stack, Step, StepLabel, Stepper, TextField, Typography } from '@mui/material';
import { useAppraisalCycles, useUserContext } from '@/lib/hooks';
import api from '@/lib/api';
import { CycleTemplateSummary } from '@/components/appraisals/CycleDesignBuilder';
import AppraisalFlowEditor, { AppraisalFlow, defaultFlow, flowError } from '@/components/appraisals/AppraisalFlowEditor';
import { shortDate, AppraisalResultItem, resultCycleName } from '@/lib/appraisal-results';
import AppraisalMetadata from '@/components/appraisals/AppraisalMetadata';
import CompetencyRoleSelection from '@/components/competency/setup/CompetencyRoleSelection';
import { useCompetencyBootstrap } from '@/components/competency/CompetencyPage';
import { competencyRequest, competencyError, newIdempotencyKey } from '@/lib/competency-api';
import { oneOffAppraisalPolicy } from '@/lib/one-off-appraisal-policy';
import GoalWorkspace from '@/components/goals/GoalWorkspace';
import { useAuth } from '@/context/AuthContext';

interface Reviewer { userId: string; name: string; email: string; role: string }
interface Person { userId: string; name: string; email: string; managerName?: string; teamName?: string; teamId?: string; teamIds?: string[]; reviewerOptions?: Reviewer[]; isSelectableForAppraisal?: boolean; selectionBlockedReason?: string }
interface Cycle { workflowDefinition?: { stages?: Record<string, { enabled?: boolean }> }; _id: string; name: string; status: string; periodStart: string; periodEnd: string; responseDeadlines?: { selfAssessmentDue?: string; managerReviewDue?: string }; phases?: { selfAssessment?: { endDate?: string }; managerReview?: { endDate?: string } } }
type StartedReview = AppraisalResultItem;
interface Receipt { launched: number; replayed?: number; errors: number; appraisals?: StartedReview[]; existingAppraisals?: StartedReview[]; errorDetails?: Array<{ userId?: string; error?: string }> }
interface GoalReadiness { ready: boolean; participants: Array<{ userId: string; name: string; ready: boolean; goals: Array<{ id: string; title: string }> }> }
const dateIn = (days: number) => { const date = new Date(); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
const calendarDate = (value: string) => new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const dayAfter = (value: string) => { const date = new Date(value); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10); };
type DateField = 'periodStart' | 'periodEnd' | 'selfDue' | 'managerDue';
const apiError = (error: unknown) => competencyError(error).message;

export default function StartAppraisalPage() {
  const router = useRouter();
  const { currentOrganization } = useAuth();
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const dateInputs = useRef<Partial<Record<DateField, HTMLInputElement | null>>>({});
  const { isHRAdmin, isManager, isLoading: contextLoading } = useUserContext();
  const { cycles, isLoading: cyclesLoading, isError: cyclesError, mutate: refreshCycles } = useAppraisalCycles();
  const query = useSearchParams();
  const [people, setPeople] = useState<Person[]>([]);
  const [templates, setTemplates] = useState<CycleTemplateSummary[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [reviewers, setReviewers] = useState<Record<string, string>>({});
  const [peopleAttempted, setPeopleAttempted] = useState(false);
  const [teams, setTeams] = useState<Array<{ id: string; name: string }>>([]);
  const [teamFilter, setTeamFilter] = useState(query.get('teamId') || 'all');
  const [search, setSearch] = useState('');
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [cycleId, setCycleId] = useState('');
  const [templateId, setTemplateId] = useState('balanced_performance');
  const [title, setTitle] = useState('Performance review');
  const [reviewType, setReviewType] = useState('adhoc');
  const [periodStart, setPeriodStart] = useState(dateIn(-91));
  const [periodEnd, setPeriodEnd] = useState(dateIn(-1));
  const [selfDue, setSelfDue] = useState(dateIn(7));
  const [managerDue, setManagerDue] = useState(dateIn(14));
  const [detailsAttempted, setDetailsAttempted] = useState(false);
  const [appraisalFlow, setAppraisalFlow] = useState<AppraisalFlow>(defaultFlow());
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const competency = useCompetencyBootstrap();
  const [withRole, setWithRole] = useState(false);
  const [requireApprovedGoals, setRequireApprovedGoals] = useState(false);
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [goalCheckVersion, setGoalCheckVersion] = useState(0);
  const [goalReadiness, setGoalReadiness] = useState<{ key: string; data?: GoalReadiness; error?: string } | null>(null);
  const [competencyCycleId, setCompetencyCycleId] = useState('');
  const [competencyRevision, setCompetencyRevision] = useState(0);
  const [roleVersions, setRoleVersions] = useState<Record<string, string>>({});
  const [rolePending, setRolePending] = useState<Record<string, { payload: unknown; key: string; error: string }>>({});
  const [roleLinked, setRoleLinked] = useState<Record<string, boolean>>({});
  const roleEnabled = !!competency.data?.enabled && !!competency.data?.capabilities.assessmentLaunch;
  const withoutGoals = cycleId === 'new' && !requireApprovedGoals;
  const permitted = isHRAdmin || isManager;
  const openCycles = (cycles as Cycle[]).filter((cycle) => ['active', 'draft'].includes(cycle.status) && cycle.periodEnd.slice(0, 10) < dateIn(0));
  const existingCycle = openCycles.find((cycle) => cycle._id === cycleId);
  const template = templates.find((entry) => entry.id === templateId) || templates[0];
  useEffect(() => { setAppraisalFlow(defaultFlow(existingCycle?.workflowDefinition?.stages || template?.design?.stages)); }, [cycleId, templateId]);
  const participants = people.filter((person) => selected.includes(person.userId) && person.isSelectableForAppraisal !== false);
  const unavailable = people.filter((person) => person.isSelectableForAppraisal === false);
  const shownPeople = useMemo(() => people.filter((person) => (teamFilter === 'all' || (person.teamIds || [person.teamId]).includes(teamFilter)) && `${person.name} ${person.teamName || ''}`.toLowerCase().includes(search.toLowerCase())), [people, search, teamFilter]);
  const today = dateIn(0);
  const yesterday = dateIn(-1);
  const dateErrors: Record<DateField, string> = {
    periodStart: !periodStart ? 'Choose the first day of the work being reviewed.' : periodStart >= today ? `Choose ${calendarDate(yesterday)} or earlier. This review is for work already completed.` : '',
    periodEnd: !periodEnd ? 'Choose the last day of the work being reviewed.' : periodEnd >= today ? `Choose ${calendarDate(yesterday)} or earlier. The work period must finish before this review starts today.` : periodStart && periodEnd < periodStart ? 'Choose an end date on or after the assessment start date.' : '',
    selfDue: !selfDue ? 'Choose an employee response deadline.' : selfDue < today ? `Choose ${calendarDate(today)} or later so employees have time to respond.` : '',
    managerDue: !managerDue ? 'Choose a manager review deadline.' : managerDue <= (selfDue || today) ? `Choose a date after ${calendarDate(selfDue || today)}. Employees respond before you complete your review.` : '',
  };
  const dateError = (field: DateField, value: string) => (detailsAttempted || value) ? dateErrors[field] : '';
  const changeDate = (setter: (value: string) => void, value: string) => { setter(value); setError(''); };
  const goalRequest = JSON.stringify({ organizationId: currentOrganization?.id || currentOrganization?._id, periodStart, periodEnd, reviewerMode: 'selected', employees: participants.map(person => ({ userId: person.userId, reviewerId: reviewers[person.userId] })) });
  const checkedGoals = goalReadiness?.key === goalRequest ? goalReadiness : null;
  useEffect(() => {
    if (cycleId !== 'new' || !requireApprovedGoals || step === 0 || goalsOpen || !participants.length || dateErrors.periodStart || dateErrors.periodEnd) return;
    let current = true;
    setGoalReadiness(null);
    api.post('/appraisals/goal-readiness', JSON.parse(goalRequest))
      .then(response => {
        if (!current) return;
        setGoalReadiness({ key: goalRequest, data: response.data.data });
        if (response.data.data?.ready) setError(previous => /^(Set up approved goals|Checking goals)/.test(previous) ? '' : previous);
      })
      .catch(failure => { if (current) setGoalReadiness({ key: goalRequest, error: apiError(failure) }); });
    return () => { current = false; };
  }, [cycleId, requireApprovedGoals, step, goalsOpen, goalRequest, goalCheckVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadStaff = async () => {
    setLoading(true); setError('');
    try {
      const [staffResponse, templateResponse] = await Promise.all([api.get('/appraisals/colleague-roster'), api.get('/appraisals/cycle-templates')]);
      const staff: Person[] = staffResponse.data?.data?.employees || [];
      setPeople(staff); setTemplates(templateResponse.data?.data || []);
      setTeams(staffResponse.data?.data?.teams || []);
      setReviewers(previous => Object.fromEntries(Object.entries(previous).filter(([personId, reviewerId]) => staff.find(person => person.userId === personId)?.reviewerOptions?.some(reviewer => reviewer.userId === reviewerId))));
      setSelected((previous) => previous.filter((id) => staff.some((person) => person.userId === id && person.isSelectableForAppraisal !== false)));
      const requested = query.get('employeeId');
      if (requested && staff.some((person) => person.userId === requested && person.isSelectableForAppraisal !== false)) setSelected([requested]);
    } catch (failure) { setError(apiError(failure)); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (!contextLoading && permitted) void loadStaff(); }, [contextLoading, permitted]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!cyclesLoading && !cycleId) setCycleId(openCycles.find((cycle) => cycle._id === query.get('cycleId'))?._id || openCycles[0]?._id || 'new'); }, [cyclesLoading, cycles, cycleId]); // eslint-disable-line react-hooks/exhaustive-deps

  const roleIssue = () => !withRole ? '' : !roleEnabled ? 'Role assessments are unavailable. Refresh your permissions before starting.' : !competencyCycleId || !competencyRevision ? 'Choose a published competency assessment cycle.' : participants.some(person => !competency.data?.cycles?.find(cycle => cycle.id === competencyCycleId)?.roleVersionIds.includes(roleVersions[person.userId])) ? 'Choose an assessment role for each selected person.' : '';
  const rolePlan = () => ({ cycleId: competencyCycleId, cycleRevision: competencyRevision, assignments: participants.map(person => ({ participantId: person.userId, roleVersionId: roleVersions[person.userId], assessorIds: [reviewers[person.userId]] })) });
  const validateDetails = () => {
    if (roleIssue()) return roleIssue();
    if (cycleId !== 'new' && !existingCycle) return 'Choose a completed quarterly cycle or a one-off review.';
    if (cycleId !== 'new') return dateErrors.selfDue || dateErrors.managerDue ? 'Check the response deadlines below. Employees respond before you complete your review.' : '';
    if (!title.trim() || !template) return 'Choose a review name and template.';
    try { oneOffAppraisalPolicy(template.design, requireApprovedGoals); } catch (failure) { return (failure as Error).message; }
    if (Object.values(dateErrors).some(Boolean)) return 'Check the highlighted dates below. The work period comes before the review, and employee responses come before manager reviews.';
    if (requireApprovedGoals && !checkedGoals?.data?.ready) return checkedGoals?.error || (checkedGoals?.data ? 'Set up approved goals for each selected person below, or turn off Include approved goals.' : 'Checking goals for the selected staff. Please wait.');
    return '';
  };
  const focusStep = () => window.requestAnimationFrame(() => { stepHeading.current?.focus({ preventScroll: true }); window.scrollTo({ top: 0 }); });
  const moveStep = (index: number) => { setStep(index); focusStep(); };
  const peopleError = () => !participants.length ? 'Choose at least one eligible member of staff.' : participants.some(person => !person.reviewerOptions?.some(reviewer => reviewer.userId === reviewers[person.userId])) ? 'Choose a reviewer for every selected person.' : '';
  const next = () => {
    if (step === 0) setPeopleAttempted(true);
    if (step === 1) setDetailsAttempted(true);
    const issue = step === 0 ? peopleError() : (validateDetails() || flowError(appraisalFlow));
    setError(issue); if (!issue) moveStep(step + 1);
    else if (step === 1 && cycleId === 'new') {
      const field = (Object.keys(dateErrors) as DateField[]).find((key) => dateErrors[key]);
      if (field) dateInputs.current[field]?.focus();
    }
  };
  const start = async () => {
    if (peopleError()) { setPeopleAttempted(true); setError(peopleError()); moveStep(0); return; }
    const issue = validateDetails();
    if (issue || !participants.length) {
      setError(issue || 'Choose staff before starting.');
      if (issue) { setDetailsAttempted(true); moveStep(1); }
      else moveStep(0);
      return;
    }
    if (flowError(appraisalFlow)) { setError(flowError(appraisalFlow)); moveStep(1); return; }
    setSaving(true); setError('');
    try {
      if (withRole) await competencyRequest('POST', '/appraisal-links/validate', rolePlan());
      const employees = participants.map((person) => ({ userId: person.userId, reviewerId: reviewers[person.userId] }));
      const response = cycleId === 'new'
        ? await api.post('/appraisals/cycles', { name: title.trim(), cycleType: reviewType, periodStart, periodEnd, launchNow: true, reviewerMode: 'selected', employees, appraisalFlow,
          ...oneOffAppraisalPolicy(template!.design, requireApprovedGoals), sourceTemplate: { id: template!.id, name: template!.name, version: template!.version || 1 },
          responseDeadlines: { selfAssessmentDue: `${selfDue}T23:59:59.000Z`, managerReviewDue: `${managerDue}T23:59:59.000Z` } })
        : await api.post(`/appraisals/cycles/${cycleId}/launch`, { employees, reviewerMode: 'selected', appraisalFlow, responseDeadlines: { selfAssessmentDue: `${selfDue}T23:59:59.000Z`, managerReviewDue: `${managerDue}T23:59:59.000Z` } });
      const launch: Receipt = response.data?.data?.launchSummary || response.data?.data;
      setReceipt(launch);
      if (withRole) {
        const pending: typeof rolePending = {}; const linked: Record<string, boolean> = {};
        for (const review of [...(launch.appraisals || []), ...(launch.existingAppraisals || [])]) {
          const participantId = review.employee?.userId;
          if (!participantId || !roleVersions[participantId]) { pending[review._id] = { payload: null, key: '', error: 'The launch receipt did not identify this participant. Open the appraisal and ask HR to check the role link.' }; continue; }
          const payload = { appraisalId: review._id, cycleId: competencyCycleId, cycleRevision: competencyRevision, roleVersionId: roleVersions[participantId], assessorIds: [reviewers[participantId]] };
          const key = newIdempotencyKey();
          try { await competencyRequest('POST', '/appraisal-links', payload, undefined, key); linked[review._id] = true; }
          catch (failure) { pending[review._id] = { payload, key, error: competencyError(failure).message }; }
        }
        setRolePending(pending); setRoleLinked(linked);
      }
      focusStep();
    } catch (failure) { setError(apiError(failure)); }
    finally { setSaving(false); }
  };

  const retryRole = async (appraisalId: string) => {
    const pending = rolePending[appraisalId]; if (!pending?.payload) return;
    setSaving(true);
    try { await competencyRequest('POST', '/appraisal-links', pending.payload, undefined, pending.key); setRoleLinked(previous => ({ ...previous, [appraisalId]: true })); setRolePending(previous => { const next = { ...previous }; delete next[appraisalId]; return next; }); }
    catch (failure) { setRolePending(previous => ({ ...previous, [appraisalId]: { ...pending, error: competencyError(failure).message } })); }
    finally { setSaving(false); }
  };
  if (contextLoading) return <CircularProgress aria-label="Loading appraisal access" />;
  if (!permitted) return <Alert severity="info">Your manager or HR starts staff appraisals. You can find your assigned reviews in <Link href="/appraisals">My Appraisals</Link>.</Alert>;
  if (receipt) return <Box sx={{ maxWidth: 900, mx: 'auto' }}>
    <Typography component="h1" variant="h4" ref={stepHeading} tabIndex={-1} fontWeight={700} mb={2}>Appraisal launch results</Typography>
    <Alert severity={receipt.errors ? 'warning' : 'success'}>{receipt.launched} started · {receipt.replayed || 0} already in progress · {receipt.errors} blocked</Alert>
    <Stack spacing={1.5} my={3}>{[...(receipt.appraisals || []), ...(receipt.existingAppraisals || [])].map((review) => <Paper variant="outlined" sx={{ p: 2 }} key={review._id}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} spacing={2}>
        <Box><Typography fontWeight={600}>{review.employee?.name || 'Appraisal'} · {resultCycleName(review)}</Typography>
          <Typography variant="body2" color="text.secondary">{receipt.appraisals?.some(item => item._id === review._id) ? 'Created in this launch' : 'Already existed — no duplicate created'} · Reviewer: {review.manager?.name || 'Not recorded'}</Typography>
          <Typography variant="body2" color="text.secondary">{review.status === 'meeting_pending' ? 'The one-on-one call is the next step.' : 'Open the appraisal to see the next step.'}</Typography>
        </Box><Button component={Link} href={`/appraisals/${review._id}`}>Open appraisal</Button>
      </Stack>{roleLinked[review._id] && <Alert severity="success" sx={{ mt: 2 }}>Role assessment linked. Open this appraisal to review the frozen role expectations.</Alert>}{rolePending[review._id] && <Alert severity="warning" sx={{ mt: 2 }} action={rolePending[review._id].payload ? <Button disabled={saving} onClick={() => void retryRole(review._id)}>Retry role link</Button> : undefined}>Appraisal created; role assessment pending. {rolePending[review._id].error} Retrying links this existing appraisal.</Alert>}<Box sx={{ mt: 2 }}><AppraisalMetadata appraisal={review} /></Box>
    </Paper>)}
      {(receipt.errorDetails || []).map((failure, index) => <Alert key={index} severity="warning">{people.find((person) => person.userId === failure.userId)?.name || 'Staff member'}: {failure.error || 'Could not start this review.'}</Alert>)}
    </Stack><Stack direction="row" spacing={2}><Button variant="contained" onClick={() => { router.push('/appraisals?section=conducting'); }}>View appraisals</Button>{receipt.errors > 0 && <Button onClick={() => { setSelected((receipt.errorDetails || []).map((failure) => failure.userId || '')); setReceipt(null); setStep(0); }}>Review blocked staff</Button>}</Stack>
  </Box>;

  return <Box sx={{ maxWidth: 1000, mx: 'auto' }}>
    <Button component={Link} href="/appraisals" sx={{ mb: 1 }}>Back to appraisals</Button>
    <Typography variant="h4" fontWeight={700}>Start appraisal</Typography>
    <Typography color="text.secondary" mt={1} mb={3}>{isHRAdmin ? 'Set up reviews for anyone in your organization, including its leaders.' : 'Set up reviews for people in the teams you manage and their subteams.'} Choose a reviewer for each person, then agree the assessment period and response deadlines.</Typography>
    <Stepper activeStep={step} alternativeLabel sx={{ mb: 3 }}>{['People', 'Review details', 'Confirm and start'].map((label) => <Step key={label}><StepLabel>{label}</StepLabel></Step>)}</Stepper>
    {error && <Alert severity="error" sx={{ mb: 2 }} action={step === 0 ? <Button onClick={loadStaff}>Retry</Button> : undefined}>{error}</Alert>}
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      {step === 0 && <Stack spacing={2}>
        <Typography component="h2" variant="h6" ref={stepHeading} tabIndex={-1}>Choose staff</Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}><TextField label="Search staff" value={search} onChange={(event) => setSearch(event.target.value)} size="small" fullWidth /><Button onClick={loadStaff} disabled={loading}>Refresh staff</Button></Stack>
        <TextField select label="Filter by team" value={teamFilter} onChange={event => setTeamFilter(event.target.value)} size="small"><MenuItem value="all">All available teams</MenuItem>{teams.map(team => <MenuItem key={team.id} value={team.id}>{team.name}</MenuItem>)}</TextField>
        <Typography variant="body2">{participants.length} selected · {people.length - unavailable.length} eligible</Typography>
        {loading ? <CircularProgress aria-label="Loading staff" /> : shownPeople.length ? shownPeople.map((person) => <Box key={person.userId} sx={{ borderBottom: '1px solid', borderColor: 'divider', pb: 2 }}><FormControlLabel sx={{ alignItems: 'flex-start' }} control={<Checkbox checked={selected.includes(person.userId)} disabled={person.isSelectableForAppraisal === false} onChange={(_, checked) => setSelected((previous) => checked ? [...previous, person.userId] : previous.filter((id) => id !== person.userId))} />} label={<Box><Typography>{person.name}</Typography><Typography variant="body2" color="text.secondary">{person.isSelectableForAppraisal === false ? person.selectionBlockedReason : person.teamName || 'No team assigned'}</Typography></Box>} />{selected.includes(person.userId) && <TextField select required fullWidth label={`Reviewer for ${person.name}`} value={reviewers[person.userId] || ''} onChange={event => setReviewers(previous => ({ ...previous, [person.userId]: event.target.value }))} error={peopleAttempted && !reviewers[person.userId]} helperText="Choose an eligible team lead, line manager, HR manager, admin or owner. The reviewer cannot be the person being reviewed.">{(person.reviewerOptions || []).map(reviewer => <MenuItem key={reviewer.userId} value={reviewer.userId}>{reviewer.name} · {reviewer.role.replace(/_/g, ' ')}</MenuItem>)}</TextField>}</Box>) : <Alert severity="info">{search || teamFilter !== 'all' ? 'No staff match these filters.' : 'No people are available in the teams you manage. Ask HR to check the team assignments in Seemplify Identity.'}</Alert>}
        {!!unavailable.length && <Alert severity="info">{unavailable.length} people have no eligible reviewer. Check team leadership or organization roles in Seemplify Identity, then refresh this list.</Alert>}
      </Stack>}
      {step === 1 && <Stack spacing={2.5}>
        <Typography component="h2" variant="h6" ref={stepHeading} tabIndex={-1}>Review details</Typography>
        {cyclesError && <Alert severity="warning" action={<Button onClick={() => refreshCycles()}>Retry</Button>}>Existing cycles could not be loaded. Retry to choose an existing cycle, or use a new one-off review.</Alert>}
        <TextField select label="Review cycle" value={cycleId || 'new'} onChange={(event) => { setCycleId(event.target.value); setError(''); setDetailsAttempted(false); }} helperText="Choose a completed quarterly cycle, or start a one-off review. You set response deadlines next."><MenuItem value="new">New one-off review</MenuItem>{(cycles as Cycle[]).filter((cycle) => ['active', 'draft'].includes(cycle.status)).map((cycle) => <MenuItem key={cycle._id} value={cycle._id} disabled={cycle.periodEnd.slice(0, 10) >= today}>{cycle.name}{cycle.periodEnd.slice(0, 10) >= today ? ' · available after this quarter ends' : ''}</MenuItem>)}</TextField>
        {existingCycle ? <Box><Typography fontWeight={600}>{existingCycle.name}</Typography><Typography>Assessment period: {shortDate(existingCycle.periodStart)} – {shortDate(existingCycle.periodEnd)}</Typography><Typography>Employee deadline: {shortDate(selfDue)}</Typography><Typography>Reviewer deadline: {shortDate(managerDue)}</Typography><Alert severity="info" sx={{ mt: 2 }}>This uses the shared cycle’s questions. Choose response deadlines for the employees and their selected reviewers below.</Alert></Box> : <>
          <TextField label="Review name" value={title} onChange={(event) => setTitle(event.target.value)} />
          <TextField select label="Review type" value={reviewType} onChange={(event) => setReviewType(event.target.value)}><MenuItem value="adhoc">One-off review</MenuItem><MenuItem value="quarterly">Quarterly review</MenuItem><MenuItem value="probation">Probation review</MenuItem><MenuItem value="project">Project review</MenuItem><MenuItem value="annual">Annual review</MenuItem></TextField>
          <TextField select label="Review template" value={template?.id || ''} onChange={(event) => setTemplateId(event.target.value)}>{templates.map((entry) => <MenuItem key={entry.id} value={entry.id}>{entry.name}</MenuItem>)}</TextField>
          <Typography variant="body2" color="text.secondary">{template?.description || 'Uses the standard review questions and scoring.'}</Typography>
          <Alert severity="info"><Typography fontWeight={600}>This review starts today, {calendarDate(today)}.</Typography>First choose the work you are reviewing. Response deadlines are when people complete the review; they are not the end of the work period.</Alert>
          <Box component="section" aria-labelledby="assessment-period-heading">
            <Typography id="assessment-period-heading" component="h3" variant="subtitle1" fontWeight={600}>1. Work being reviewed</Typography>
            <Typography variant="body2" color="text.secondary" mb={2}>Choose a completed assessment period. Its last day must be {calendarDate(yesterday)} or earlier.</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField fullWidth required label="Assessment period starts" type="date" value={periodStart} inputRef={(input) => { dateInputs.current.periodStart = input; }} onChange={(event) => changeDate(setPeriodStart, event.target.value)} error={Boolean(dateError('periodStart', periodStart))} helperText={dateError('periodStart', periodStart) || 'First day of the work you want to review.'} slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: yesterday } }} />
              <TextField fullWidth required label="Assessment period ends" type="date" value={periodEnd} inputRef={(input) => { dateInputs.current.periodEnd = input; }} onChange={(event) => changeDate(setPeriodEnd, event.target.value)} error={Boolean(dateError('periodEnd', periodEnd))} helperText={dateError('periodEnd', periodEnd) || 'Last day of completed work, not the response deadline.'} slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: periodStart && periodStart <= yesterday ? periodStart : undefined, max: yesterday } }} />
            </Stack>
            {periodEnd >= today && periodStart && periodStart <= yesterday && <Button variant="outlined" size="small" sx={{ mt: 1.5 }} onClick={() => changeDate(setPeriodEnd, yesterday)}>Set assessment end to yesterday ({calendarDate(yesterday)})</Button>}
            <Typography variant="body2" color="text.secondary" mt={1.5}>Need to assess work that ends in the future? Start the review after that work period has ended.</Typography>
          </Box>
          <Divider />
          <Box component="section" aria-labelledby="response-deadlines-heading">
            <Typography id="response-deadlines-heading" component="h3" variant="subtitle1" fontWeight={600}>2. Time to complete the review</Typography>
            <Typography variant="body2" color="text.secondary" mb={2}>Employees respond first. Give yourself a later deadline to review their submissions.</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField fullWidth required label="Employee response due" type="date" value={selfDue} inputRef={(input) => { dateInputs.current.selfDue = input; }} onChange={(event) => changeDate(setSelfDue, event.target.value)} error={Boolean(dateError('selfDue', selfDue))} helperText={dateError('selfDue', selfDue) || `Choose ${calendarDate(today)} or later.`} slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: today } }} />
              <TextField fullWidth required label="Reviewer response due" type="date" value={managerDue} inputRef={(input) => { dateInputs.current.managerDue = input; }} onChange={(event) => changeDate(setManagerDue, event.target.value)} error={Boolean(dateError('managerDue', managerDue))} helperText={dateError('managerDue', managerDue) || 'After the employee response deadline.'} slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: selfDue && selfDue >= today ? dayAfter(selfDue) : dateIn(1) } }} />
            </Stack>
          </Box>
        </>}
      </Stack>}
      {step === 1 && cycleId !== 'new' && <Stack spacing={2} mt={3}>
        <Alert severity="info">These deadlines apply to the employees and selected reviewers. The shared cycle dates stay the same. Future quarters become available after they finish.</Alert>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField label="Employee response due" type="date" value={selfDue} onChange={(event) => changeDate(setSelfDue, event.target.value)} slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: today } }} error={!!dateError('selfDue', selfDue)} helperText={dateError('selfDue', selfDue)} fullWidth />
          <TextField label="Reviewer response due" type="date" value={managerDue} onChange={(event) => changeDate(setManagerDue, event.target.value)} slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: dayAfter(selfDue || today) } }} error={!!dateError('managerDue', managerDue)} helperText={dateError('managerDue', managerDue)} fullWidth />
        </Stack>
      </Stack>}
      {step === 1 && cycleId === 'new' && <Box component="section" aria-labelledby="review-goals-heading" mt={3}>
        <Divider sx={{ mb: 2 }} />
        <Typography id="review-goals-heading" component="h3" variant="subtitle1" fontWeight={600}>Goals for this review</Typography>
        <FormControlLabel control={<Checkbox checked={requireApprovedGoals} disabled={saving} onChange={(_, checked) => { setRequireApprovedGoals(checked); setError(''); }} />} label="Include approved goals" />
        {withoutGoals ? <Typography variant="body2" color="text.secondary">This one-off review can start without goals. It uses the remaining review questions and competency ratings, weighted to 100%.</Typography> : <Stack spacing={1.5}>
          <Typography variant="body2" color="text.secondary">Create staff goals here and align them to an existing team, department or organization goal. Your role determines which scopes you can create. Eligible approved staff goals for the assessment period are included automatically.</Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}><Button variant="outlined" disabled={saving} onClick={() => setGoalsOpen(true)}>Create or link goals</Button><Button disabled={saving || goalsOpen} onClick={() => setGoalCheckVersion(value => value + 1)}>Refresh goal readiness</Button></Stack>
          {!checkedGoals && <Typography role="status" variant="body2">Checking goals…</Typography>}
          {checkedGoals?.error && <Alert severity="error">{checkedGoals.error}</Alert>}
          {checkedGoals?.data?.participants.map(person => <Alert key={person.userId} severity={person.ready ? 'success' : 'warning'}>{person.name}: {person.ready ? `${person.goals.length} eligible approved goal${person.goals.length === 1 ? '' : 's'} — ${person.goals.map(goal => goal.title).join(', ')}` : 'No eligible approved goal for this period. Create or link a staff goal and complete its approval and acknowledgement, or continue without goals.'}</Alert>)}
          <Typography variant="body2" color="text.secondary">Organization and team goals provide alignment. Each participant needs an approved individual goal; pending acknowledgement and evidence-only goals are not eligible for scoring.</Typography>
        </Stack>}
      </Box>}
      {step === 1 && roleEnabled && <Box mt={3}><Divider sx={{ mb: 2 }} /><FormControlLabel control={<Checkbox checked={withRole} onChange={(_, checked) => { setWithRole(checked); setError(''); }} />} label="Assess against an occupational role" /><Typography variant="body2" color="text.secondary" mb={2}>Add a competency assessment using published role expectations. Optional evidence and AI drafts are configured separately; a human reviewer makes the final decision.</Typography>{withRole && <CompetencyRoleSelection cycleId={competencyCycleId} onCycleChange={id => { setCompetencyCycleId(id); setRoleVersions({}); }} onCycleRevisionChange={setCompetencyRevision} roleVersionByParticipant={roleVersions} onRoleChange={(id, version) => setRoleVersions(previous => ({ ...previous, [id]: version }))} participants={participants} disabled={saving} />}</Box>}
      {step === 1 && <Box mt={3}><Divider sx={{ mb: 3 }} /><AppraisalFlowEditor value={appraisalFlow} onChange={value => { setAppraisalFlow(value); setError(''); }} onReset={() => { setAppraisalFlow(defaultFlow(existingCycle?.workflowDefinition?.stages || template?.design?.stages)); setError(''); }} /></Box>}
      {step === 2 && <Stack spacing={2}>
        <Typography component="h2" variant="h6" ref={stepHeading} tabIndex={-1}>Confirm and start</Typography><Typography fontWeight={600}>{existingCycle?.name || title}</Typography><Typography>{participants.length} participant{participants.length === 1 ? '' : 's'} · {existingCycle ? 'Existing cycle' : template?.name}</Typography>
        <Typography>Assessment period: {shortDate(existingCycle?.periodStart || periodStart)} – {shortDate(existingCycle?.periodEnd || periodEnd)}</Typography>
        {!existingCycle && <Typography>Review starts: {calendarDate(today)} (today)</Typography>}
        {!existingCycle && <Typography fontWeight={600}>{withoutGoals ? 'Review without goals' : 'Approved goals included'}</Typography>}
        <Typography>Employee deadline: {shortDate(selfDue)}</Typography><Typography>Reviewer deadline: {shortDate(managerDue)}</Typography>
        {participants.map((person) => <Typography key={person.userId}>{person.name} · Reviewer: {person.reviewerOptions?.find(reviewer => reviewer.userId === reviewers[person.userId])?.name || 'Choose a reviewer'}</Typography>)}
        {withRole && <Box><Typography fontWeight={600}>Role competency assessment</Typography><Typography>{competency.data?.cycles?.find(cycle => cycle.id === competencyCycleId)?.name} · Configuration revision {competencyRevision}</Typography>{participants.map(person => { const role = competency.data?.roles.find(row => row.versionId === roleVersions[person.userId]); return <Typography key={person.userId}>{person.name}: {role?.name} · Role version {role?.version}</Typography>; })}<Typography variant="body2" color="text.secondary">The selected role and scoring configuration are preserved. Complete this role assessment before finalising the appraisal.</Typography></Box>}
        <Typography fontWeight={600}>Your review flow</Typography>
        <Box component="ol" sx={{ pl: 3 }}>{appraisalFlow.steps.map(step => <Typography component="li" key={step.id}>{step.label}</Typography>)}</Box>
        <Typography>Employee assessment: {appraisalFlow.assessmentMode === 'form' ? 'Manual form' : 'AI conversation or form'}</Typography>
        <Alert severity="info">Starting creates the selected appraisals and notifies the participants. Steps open in the order shown above. Repeating this launch reuses your existing reviews and their original settings.</Alert>
      </Stack>}
    </Paper>
    <Dialog open={goalsOpen} onClose={() => { setGoalsOpen(false); setGoalCheckVersion(value => value + 1); }} fullWidth maxWidth="lg" aria-labelledby="appraisal-goal-setup-title">
      <DialogTitle id="appraisal-goal-setup-title">Set up goals for this review</DialogTitle>
      <DialogContent dividers>
        <Typography mb={2}>Assessment period: {shortDate(periodStart)} – {shortDate(periodEnd)}. Your review details and selected staff are kept while you create, align or approve goals.</Typography>
        {goalsOpen && <GoalWorkspace embedded reviewPeriod={{ start: periodStart, end: periodEnd }} participantIds={selected} />}
      </DialogContent>
      <DialogActions><Button onClick={() => { setGoalsOpen(false); setGoalCheckVersion(value => value + 1); }}>Done — return to review</Button></DialogActions>
    </Dialog>
    <Stack direction="row" justifyContent="space-between" mt={3}><Button disabled={step === 0 || saving} onClick={() => { setError(''); moveStep(step - 1); }}>Previous</Button><Button variant="contained" disabled={loading || cyclesLoading || saving || (step === 0 && !participants.length)} onClick={step === 2 ? start : next}>{saving ? 'Starting…' : step === 2 ? 'Start appraisals' : 'Continue'}</Button></Stack>
  </Box>;
}
