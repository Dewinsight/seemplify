'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Alert, Box, Button, Checkbox, CircularProgress, Divider, FormControlLabel, MenuItem, Paper, Stack, Step, StepLabel, Stepper, TextField, Typography } from '@mui/material';
import { useAppraisalCycles, useUserContext } from '@/lib/hooks';
import api from '@/lib/api';
import { CycleTemplateSummary } from '@/components/appraisals/CycleDesignBuilder';
import { shortDate } from '@/lib/appraisal-results';

interface Person { userId: string; name: string; email: string; managerName?: string; teamName?: string; isSelectableForAppraisal?: boolean; selectionBlockedReason?: string }
interface Cycle { _id: string; name: string; status: string; periodStart: string; periodEnd: string; responseDeadlines?: { selfAssessmentDue?: string; managerReviewDue?: string }; phases?: { selfAssessment?: { endDate?: string }; managerReview?: { endDate?: string } } }
interface StartedReview { _id: string; employee?: { name?: string } }
interface Receipt { launched: number; replayed?: number; errors: number; appraisals?: StartedReview[]; existingAppraisals?: StartedReview[]; errorDetails?: Array<{ userId?: string; error?: string }> }
const dateIn = (days: number) => { const date = new Date(); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
const calendarDate = (value: string) => new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const dayAfter = (value: string) => { const date = new Date(value); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10); };
type DateField = 'periodStart' | 'periodEnd' | 'selfDue' | 'managerDue';
const apiError = (error: unknown) => (error as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Could not complete this request. Please try again.';

export default function StartAppraisalPage() {
  const router = useRouter();
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const dateInputs = useRef<Partial<Record<DateField, HTMLInputElement | null>>>({});
  const { isHRAdmin, isLoading: contextLoading } = useUserContext();
  const { cycles, isLoading: cyclesLoading, isError: cyclesError, mutate: refreshCycles } = useAppraisalCycles();
  const query = useSearchParams();
  const [people, setPeople] = useState<Person[]>([]);
  const [templates, setTemplates] = useState<CycleTemplateSummary[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
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
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const permitted = true;
  const openCycles = (cycles as Cycle[]).filter((cycle) => ['active', 'draft'].includes(cycle.status) && cycle.periodEnd.slice(0, 10) < dateIn(0));
  const existingCycle = openCycles.find((cycle) => cycle._id === cycleId);
  const template = templates.find((entry) => entry.id === templateId) || templates[0];
  const participants = people.filter((person) => selected.includes(person.userId) && person.isSelectableForAppraisal !== false);
  const unavailable = people.filter((person) => person.isSelectableForAppraisal === false);
  const shownPeople = useMemo(() => people.filter((person) => `${person.name} ${person.teamName || ''}`.toLowerCase().includes(search.toLowerCase())), [people, search]);
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

  const loadStaff = async () => {
    setLoading(true); setError('');
    try {
      const [staffResponse, templateResponse] = await Promise.all([api.get('/appraisals/colleague-roster'), api.get('/appraisals/cycle-templates')]);
      const staff: Person[] = staffResponse.data?.data?.employees || [];
      setPeople(staff); setTemplates(templateResponse.data?.data || []);
      setSelected((previous) => previous.filter((id) => staff.some((person) => person.userId === id && person.isSelectableForAppraisal !== false)));
      const requested = query.get('employeeId');
      if (requested && staff.some((person) => person.userId === requested && person.isSelectableForAppraisal !== false)) setSelected([requested]);
    } catch (failure) { setError(apiError(failure)); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (!contextLoading && permitted) void loadStaff(); }, [contextLoading, permitted]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!cyclesLoading && !cycleId) setCycleId(openCycles.find((cycle) => cycle._id === query.get('cycleId'))?._id || openCycles[0]?._id || 'new'); }, [cyclesLoading, cycles, cycleId]); // eslint-disable-line react-hooks/exhaustive-deps

  const validateDetails = () => {
    if (cycleId !== 'new' && !existingCycle) return 'Choose a completed quarterly cycle or a one-off review.';
    if (cycleId !== 'new') return dateErrors.selfDue || dateErrors.managerDue ? 'Check the response deadlines below. Employees respond before you complete your review.' : '';
    if (!title.trim() || !template) return 'Choose a review name and template.';
    if (Object.values(dateErrors).some(Boolean)) return 'Check the highlighted dates below. The work period comes before the review, and employee responses come before manager reviews.';
    return '';
  };
  const focusStep = () => window.requestAnimationFrame(() => { stepHeading.current?.focus({ preventScroll: true }); window.scrollTo({ top: 0 }); });
  const moveStep = (index: number) => { setStep(index); focusStep(); };
  const next = () => {
    if (step === 1) setDetailsAttempted(true);
    const issue = step === 0 ? (participants.length ? '' : 'Choose at least one eligible member of staff.') : validateDetails();
    setError(issue); if (!issue) moveStep(step + 1);
    else if (step === 1 && cycleId === 'new') {
      const field = (Object.keys(dateErrors) as DateField[]).find((key) => dateErrors[key]);
      if (field) dateInputs.current[field]?.focus();
    }
  };
  const start = async () => {
    const issue = validateDetails();
    if (issue || !participants.length) {
      setError(issue || 'Choose staff before starting.');
      if (issue) { setDetailsAttempted(true); moveStep(1); }
      else moveStep(0);
      return;
    }
    setSaving(true); setError('');
    try {
      const employees = participants.map((person) => ({ userId: person.userId }));
      const response = cycleId === 'new'
        ? await api.post('/appraisals/cycles', { name: title.trim(), cycleType: reviewType, periodStart, periodEnd, launchNow: true, reviewerMode: 'initiator', employees,
          workflowDefinition: template!.design, sourceTemplate: { id: template!.id, name: template!.name, version: template!.version || 1 },
          responseDeadlines: { selfAssessmentDue: `${selfDue}T23:59:59.000Z`, managerReviewDue: `${managerDue}T23:59:59.000Z` } })
        : await api.post(`/appraisals/cycles/${cycleId}/launch`, { employees, reviewerMode: 'initiator', responseDeadlines: { selfAssessmentDue: `${selfDue}T23:59:59.000Z`, managerReviewDue: `${managerDue}T23:59:59.000Z` } });
      setReceipt(response.data?.data?.launchSummary || response.data?.data);
      focusStep();
    } catch (failure) { setError(apiError(failure)); }
    finally { setSaving(false); }
  };

  if (contextLoading) return <CircularProgress aria-label="Loading appraisal access" />;
  if (!permitted) return <Alert severity="info">Your manager or HR starts staff appraisals. You can find your assigned reviews in <Link href="/appraisals">My Appraisals</Link>.</Alert>;
  if (receipt) return <Box sx={{ maxWidth: 900, mx: 'auto' }}>
    <Typography component="h1" variant="h4" ref={stepHeading} tabIndex={-1} fontWeight={700} mb={2}>Appraisal launch results</Typography>
    <Alert severity={receipt.errors ? 'warning' : 'success'}>{receipt.launched} started · {receipt.replayed || 0} already in progress · {receipt.errors} blocked</Alert>
    <Stack spacing={1.5} my={3}>{[...(receipt.appraisals || []), ...(receipt.existingAppraisals || [])].map((review) => <Paper variant="outlined" sx={{ p: 2 }} key={review._id}><Stack direction="row" justifyContent="space-between" alignItems="center" spacing={2}><Box><Typography fontWeight={600}>{review.employee?.name || 'Appraisal'}</Typography><Typography variant="body2" color="text.secondary">The employee completes their self-assessment next.</Typography></Box><Button component={Link} href={`/appraisals/${review._id}`}>Open appraisal</Button></Stack></Paper>)}
      {(receipt.errorDetails || []).map((failure, index) => <Alert key={index} severity="warning">{people.find((person) => person.userId === failure.userId)?.name || 'Staff member'}: {failure.error || 'Could not start this review.'}</Alert>)}
    </Stack><Stack direction="row" spacing={2}><Button variant="contained" onClick={() => { router.push('/appraisals?section=conducting'); }}>View appraisals</Button>{receipt.errors > 0 && <Button onClick={() => { setSelected((receipt.errorDetails || []).map((failure) => failure.userId || '')); setReceipt(null); setStep(0); }}>Review blocked staff</Button>}</Stack>
  </Box>;

  return <Box sx={{ maxWidth: 1000, mx: 'auto' }}>
    <Button component={Link} href="/appraisals" sx={{ mb: 1 }}>Back to appraisals</Button>
    <Typography variant="h4" fontWeight={700}>Start appraisal</Typography>
    <Typography color="text.secondary" mt={1} mb={3}>{isHRAdmin ? 'Review anyone in your organization, including its leaders.' : 'Review a colleague, peer or manager in your team hierarchy.'} You will be the reviewer. Choose work already completed, then agree response deadlines.</Typography>
    <Stepper activeStep={step} alternativeLabel sx={{ mb: 3 }}>{['People', 'Review details', 'Confirm and start'].map((label) => <Step key={label}><StepLabel>{label}</StepLabel></Step>)}</Stepper>
    {error && <Alert severity="error" sx={{ mb: 2 }} action={step === 0 ? <Button onClick={loadStaff}>Retry</Button> : undefined}>{error}</Alert>}
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      {step === 0 && <Stack spacing={2}>
        <Typography component="h2" variant="h6" ref={stepHeading} tabIndex={-1}>Choose staff</Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}><TextField label="Search staff" value={search} onChange={(event) => setSearch(event.target.value)} size="small" fullWidth /><Button onClick={loadStaff} disabled={loading}>Refresh staff</Button></Stack>
        <Typography variant="body2">{participants.length} selected · {people.length - unavailable.length} eligible</Typography>
        {loading ? <CircularProgress aria-label="Loading staff" /> : shownPeople.length ? shownPeople.map((person) => <Box key={person.userId} sx={{ borderBottom: '1px solid', borderColor: 'divider', pb: 1 }}><FormControlLabel sx={{ alignItems: 'flex-start' }} control={<Checkbox checked={selected.includes(person.userId)} disabled={person.isSelectableForAppraisal === false} onChange={(_, checked) => setSelected((previous) => checked ? [...previous, person.userId] : previous.filter((id) => id !== person.userId))} />} label={<Box><Typography>{person.name}</Typography><Typography variant="body2" color="text.secondary">{person.isSelectableForAppraisal === false ? person.selectionBlockedReason || 'A reporting manager must be assigned first.' : `Reviewer: you${person.teamName ? ` · ${person.teamName}` : ''}`}</Typography></Box>} /></Box>) : <Alert severity="info">{search ? 'No staff match your search.' : 'No colleagues are available in your team hierarchy. Ask HR to check your team membership in Seemplify Identity.'}</Alert>}
        {!!unavailable.length && <Alert severity="info">{unavailable.length} people need a reporting manager before their appraisal can start. {isHRAdmin ? 'Check the reporting relationship in Seemplify Identity, then refresh this list.' : 'Ask HR to check their reporting relationship in Seemplify Identity.'}{isHRAdmin && <Button component="a" href={process.env.NEXT_PUBLIC_IDP_URL || 'https://auth.seemplifyai.com'} target="_blank" rel="noopener noreferrer">Open Seemplify Identity</Button>}</Alert>}
      </Stack>}
      {step === 1 && <Stack spacing={2.5}>
        <Typography component="h2" variant="h6" ref={stepHeading} tabIndex={-1}>Review details</Typography>
        {cyclesError && <Alert severity="warning" action={<Button onClick={() => refreshCycles()}>Retry</Button>}>Existing cycles could not be loaded. Retry to choose an existing cycle, or use a new one-off review.</Alert>}
        <TextField select label="Review cycle" value={cycleId || 'new'} onChange={(event) => { setCycleId(event.target.value); setError(''); setDetailsAttempted(false); }} helperText="Choose a completed quarterly cycle, or start a one-off review. You set response deadlines next."><MenuItem value="new">New one-off review</MenuItem>{(cycles as Cycle[]).filter((cycle) => ['active', 'draft'].includes(cycle.status)).map((cycle) => <MenuItem key={cycle._id} value={cycle._id} disabled={cycle.periodEnd.slice(0, 10) >= today}>{cycle.name}{cycle.periodEnd.slice(0, 10) >= today ? ' · available after this quarter ends' : ''}</MenuItem>)}</TextField>
        {existingCycle ? <Box><Typography fontWeight={600}>{existingCycle.name}</Typography><Typography>Assessment period: {shortDate(existingCycle.periodStart)} – {shortDate(existingCycle.periodEnd)}</Typography><Typography>Employee deadline: {shortDate(selfDue)}</Typography><Typography>Reviewer deadline: {shortDate(managerDue)}</Typography><Alert severity="info" sx={{ mt: 2 }}>This uses the shared cycle’s questions. You are the reviewer; choose your response deadlines below.</Alert></Box> : <>
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
        <Alert severity="info">You are the reviewer. These deadlines apply to the reviews you start; The shared cycle dates stay the same. Future quarters become available after they finish.</Alert>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField label="Employee response due" type="date" value={selfDue} onChange={(event) => changeDate(setSelfDue, event.target.value)} slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: today } }} error={!!dateError('selfDue', selfDue)} helperText={dateError('selfDue', selfDue)} fullWidth />
          <TextField label="Reviewer response due" type="date" value={managerDue} onChange={(event) => changeDate(setManagerDue, event.target.value)} slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: dayAfter(selfDue || today) } }} error={!!dateError('managerDue', managerDue)} helperText={dateError('managerDue', managerDue)} fullWidth />
        </Stack>
      </Stack>}
      {step === 2 && <Stack spacing={2}>
        <Typography component="h2" variant="h6" ref={stepHeading} tabIndex={-1}>Confirm and start</Typography><Typography fontWeight={600}>{existingCycle?.name || title}</Typography><Typography>{participants.length} participant{participants.length === 1 ? '' : 's'} · {existingCycle ? 'Existing cycle' : template?.name}</Typography>
        <Typography>Assessment period: {shortDate(existingCycle?.periodStart || periodStart)} – {shortDate(existingCycle?.periodEnd || periodEnd)}</Typography>
        {!existingCycle && <Typography>Review starts: {calendarDate(today)} (today)</Typography>}
        <Typography>Employee deadline: {shortDate(selfDue)}</Typography><Typography>Reviewer deadline: {shortDate(managerDue)}</Typography>
        {participants.map((person) => <Typography key={person.userId}>{person.name} · Reviewer: you</Typography>)}
        <Alert severity="info">Starting creates the selected appraisals and notifies employees to complete their self-assessment. You review their submissions next. Repeating this launch reuses your existing reviews.</Alert>
      </Stack>}
    </Paper>
    <Stack direction="row" justifyContent="space-between" mt={3}><Button disabled={step === 0 || saving} onClick={() => { setError(''); moveStep(step - 1); }}>Previous</Button><Button variant="contained" disabled={loading || cyclesLoading || saving || (step === 0 && !participants.length)} onClick={step === 2 ? start : next}>{saving ? 'Starting…' : step === 2 ? 'Start appraisals' : 'Continue'}</Button></Stack>
  </Box>;
}
