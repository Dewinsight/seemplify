'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Alert, Box, Button, Checkbox, CircularProgress, Divider, FormControlLabel, MenuItem, Stack, Step, StepLabel, Stepper, TextField, Typography } from '@mui/material';
import api from '@/lib/api';
import { competencyRequest, competencyError, newIdempotencyKey } from '@/lib/competency-api';
import { useCompetencyBootstrap, Surface } from '@/components/competency/CompetencyPage';
import AppraisalFlowEditor, { defaultFlow, flowError, type AppraisalFlow } from './AppraisalFlowEditor';

type Person = { userId: string; name: string; email: string; teamName?: string; isSelectableForAppraisal?: boolean; selectionBlockedReason?: string; reviewerOptions: Array<{ userId: string; name: string }> };
type Review = { _id: string; employee: { name: string }; manager: { name: string } };
type Receipt = { launched: number; replayed: number; appraisals: Review[]; existingAppraisals: Review[] };
const dateIn = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const labels = { regular: 'Regular appraisal', competency: 'Role competency', combined: 'Combined appraisal and competency' };
export default function UnifiedAppraisalStart() {
  const bootstrap = useCompetencyBootstrap();
  const query = useSearchParams();
  const [cycleId, setCycleId] = useState(query.get('assessmentCycleId') || '');
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>(query.get('employeeId') ? [query.get('employeeId')!] : []);
  const [reviewers, setReviewers] = useState<Record<string, string>>({});
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [cvRequested, setCvRequested] = useState(false);
  const [cvRequired, setCvRequired] = useState(false);
  const [search, setSearch] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [selfDue, setSelfDue] = useState(dateIn(7));
  const [managerDue, setManagerDue] = useState(dateIn(14));
  const [flow, setFlow] = useState<AppraisalFlow>(defaultFlow());
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const request = useRef({ body: '', key: '' });
  const heading = useRef<HTMLHeadingElement>(null);
  const cycle = bootstrap.data?.cycles?.find(row => row.id === cycleId);
  const mode = cycle?.reviewMode || 'competency';
  const needsRole = mode !== 'regular';
  const eligibleRoles = (bootstrap.data?.roles || []).filter(role => cycle?.roleVersionIds.includes(role.versionId));
  const participants = people.filter(person => selected.includes(person.userId) && person.isSelectableForAppraisal !== false);
  async function loadPeople() {
    setLoading(true); setError('');
    try {
      const response = await api.get('/appraisals/colleague-roster'); const roster: Person[] = response.data.data.employees || []; setPeople(roster);
      setSelected(previous => previous.filter(id => roster.some(person => person.userId === id && person.isSelectableForAppraisal !== false)));
      setReviewers(previous => ({ ...Object.fromEntries(roster.filter(person => person.reviewerOptions.length === 1).map(person => [person.userId, person.reviewerOptions[0].userId])), ...previous }));
    }
    catch (failure) { setError(competencyError(failure).message); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (bootstrap.data?.capabilities.assessmentLaunch) void loadPeople(); }, [bootstrap.data?.enabled, bootstrap.data?.capabilities.assessmentLaunch]);
  useEffect(() => { setStart(cycle?.period.start.slice(0, 10) || ''); setEnd(cycle?.period.end.slice(0, 10) || ''); setRoles({}); }, [cycleId, cycle?.period.start, cycle?.period.end]);
  const move = (next: number) => { setStep(next); setError(''); window.requestAnimationFrame(() => heading.current?.focus()); };
  function issue() {
    if (!cycle) return 'Choose a published appraisal cycle.';
    if (!participants.length) return 'Choose at least one participant.';
    if (participants.some(person => !person.reviewerOptions.some(reviewer => reviewer.userId === reviewers[person.userId]))) return 'Choose an eligible reviewer for every participant.';
    if (needsRole && participants.some(person => !eligibleRoles.some(role => role.versionId === roles[person.userId]))) return 'Choose a published role for every participant.';
    if (!start || !end || start > end || end >= dateIn(0)) return 'Choose a completed review period. The end date must be before today.';
    if (!selfDue || selfDue < dateIn(0) || !managerDue || managerDue <= selfDue) return 'Set the employee deadline first, then a later reviewer deadline.';
    return flowError(flow);
  }
  async function launch() {
    const problem = issue(); if (problem) { setError(problem); return; }
    const body = { cycleRevision: cycle!.revision, period: { start, end }, cvRequired, assignments: participants.map(person => ({ participantId: person.userId, reviewerId: reviewers[person.userId], ...(needsRole ? { roleVersionId: roles[person.userId], cvRequested: cvRequested || cvRequired } : {}) })), responseDeadlines: { selfAssessmentDue: `${selfDue}T23:59:59.000Z`, managerReviewDue: `${managerDue}T23:59:59.000Z` }, appraisalFlow: flow };
    const fingerprint = JSON.stringify({ cycleId, body });
    if (request.current.body !== fingerprint) request.current = { body: fingerprint, key: newIdempotencyKey() };
    setBusy(true); setError('');
    try { setReceipt(await competencyRequest<Receipt>('POST', `/cycles/${cycleId}/start-appraisals`, body, undefined, request.current.key)); }
    catch (failure) { setError(competencyError(failure).message); }
    finally { setBusy(false); }
  }
  if (bootstrap.isLoading) return <CircularProgress aria-label="Loading appraisal setup" />;
  if (bootstrap.error) return <Alert severity="error" action={<Button onClick={() => void bootstrap.mutate()}>Retry</Button>}>{competencyError(bootstrap.error).message}</Alert>;
  if (!bootstrap.data?.capabilities.assessmentLaunch) return <Alert severity="info">A manager or administrator starts appraisals. <Link href="/appraisals">View my appraisals</Link>.</Alert>;
  return <Box sx={{ maxWidth: 1000, mx: 'auto', minWidth: 0 }}>
    <Button component={Link} href="/appraisals" sx={{ mb: 2 }}>Back to appraisals</Button>
    <Typography component="h1" variant="h4" fontWeight={700} ref={heading} tabIndex={-1}>{receipt ? 'Appraisals started' : 'Start appraisals'}</Typography>
    {error && <Alert severity="error" sx={{ my: 2 }}>{error}</Alert>}
    {receipt ? <Stack gap={2} mt={3}>
      <Alert severity="success">{receipt.launched} started · {receipt.replayed} already existed. Role assessments and appraisal questions are ready together.</Alert>
      {[...receipt.appraisals, ...receipt.existingAppraisals].map(review => <Surface key={review._id}><Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={2}><Box><Typography fontWeight={650}>{review.employee.name}</Typography><Typography color="text.secondary">Reviewer: {review.manager.name}</Typography></Box><Button component={Link} href={`/appraisals/${review._id}`}>Open appraisal</Button></Stack></Surface>)}
      <Button component={Link} href={`/competency/cycles/${cycleId}`}>View cycle configuration</Button>
    </Stack> : <>
      <Typography color="text.secondary" mt={1} mb={3}>Choose one cycle, assign staff and reviewers, then start the review period.</Typography>
      <Stepper activeStep={step} sx={{ mb: 3 }}>{['Cycle and staff', 'Period and workflow', 'Confirm'].map(label => <Step key={label}><StepLabel>{label}</StepLabel></Step>)}</Stepper>
      <Surface>
        {step === 0 && <Stack gap={3}>
          <TextField select label="Appraisal cycle" value={cycleId} onChange={event => setCycleId(event.target.value)} helperText="The cycle defines the review type, schedule and role expectations.">
            {(bootstrap.data.cycles || []).map(row => <MenuItem key={row.id} value={row.id}>{row.name} — {labels[row.reviewMode || 'competency']}</MenuItem>)}
          </TextField>
          {!(bootstrap.data.cycles || []).length && <Alert severity="info">Publish a cycle before starting appraisals.</Alert>}
          <Button component={Link} href="/competency/cycles" sx={{ alignSelf: 'flex-start' }}>Manage appraisal cycles</Button>
          {cycle && <Typography>{labels[mode]} · {cycle.cadence?.type === 'periodic' ? `Repeats ${cycle.cadence.frequency?.replace('_', ' ')}` : 'One-time'}</Typography>}
          <Divider />
          <TextField select label="CV requirement" value={cvRequired ? 'required' : 'optional'} onChange={event => setCvRequired(event.target.value === 'required')}
            helperText={cvRequired ? 'Employees must upload a CV before submitting in either assessment mode. They can save drafts without one.' : 'Employees can upload a CV in either assessment mode and submit without one.'}>
            <MenuItem value="optional">Optional</MenuItem><MenuItem value="required">Required</MenuItem>
          </TextField>
          {needsRole && !cvRequired && <Box><FormControlLabel control={<Checkbox checked={cvRequested} onChange={event => setCvRequested(event.target.checked)} />} label="Request a CV for this appraisal" /><Typography variant="body2" color="text.secondary">A CV is optional evidence for the selected role. A missing CV does not block submission.</Typography></Box>}
          <TextField label="Find staff" value={search} onChange={event => setSearch(event.target.value)} />
          {loading ? <CircularProgress aria-label="Loading eligible staff" /> : !people.length ? <Alert severity="info" action={<Button onClick={() => void loadPeople()}>Refresh</Button>}>No staff are available in your current scope.</Alert> : <Stack divider={<Divider />}>
            {people.filter(person => `${person.name} ${person.teamName || ''}`.toLowerCase().includes(search.toLowerCase())).map(person => <Box key={person.userId} sx={{ py: 2 }}>
              <Stack direction="row" alignItems="center"><Checkbox checked={selected.includes(person.userId)} disabled={person.isSelectableForAppraisal === false || !cycle} inputProps={{ 'aria-label': `Select ${person.name}` }} onChange={event => { setSelected(previous => event.target.checked ? [...previous, person.userId] : previous.filter(id => id !== person.userId)); if (event.target.checked && person.reviewerOptions.length === 1) setReviewers(previous => ({ ...previous, [person.userId]: person.reviewerOptions[0].userId })); if (event.target.checked && eligibleRoles.length === 1) setRoles(previous => ({ ...previous, [person.userId]: eligibleRoles[0].versionId })); }} /><Box><Typography fontWeight={600}>{person.name}</Typography><Typography variant="body2" color="text.secondary">{person.selectionBlockedReason || person.teamName}</Typography></Box></Stack>
              {selected.includes(person.userId) && <Stack direction={{ xs: 'column', sm: 'row' }} gap={2} mt={2}>
                <TextField select fullWidth label={`Reviewer for ${person.name}`} value={reviewers[person.userId] || ''} onChange={event => setReviewers(previous => ({ ...previous, [person.userId]: event.target.value }))}>{person.reviewerOptions.map(reviewer => <MenuItem key={reviewer.userId} value={reviewer.userId}>{reviewer.name}</MenuItem>)}</TextField>
                {needsRole && <TextField select fullWidth label={`Role for ${person.name}`} value={roles[person.userId] || ''} onChange={event => setRoles(previous => ({ ...previous, [person.userId]: event.target.value }))}>{eligibleRoles.map(role => <MenuItem key={role.versionId} value={role.versionId}>{role.name} · v{role.version}</MenuItem>)}</TextField>}
              </Stack>}
            </Box>)}
          </Stack>}
        </Stack>}
        {step === 1 && <Stack gap={3}>
          <Typography variant="h6">Work being reviewed</Typography>
          {cycle?.cadence?.type === 'periodic' && <Typography color="text.secondary">Choose a scheduled period starting from {cycle.period.start.slice(0, 10)} to {cycle.period.end.slice(0, 10)}. Each period keeps its own results.</Typography>}
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}><TextField label="Period starts" type="date" fullWidth value={start} disabled={cycle?.cadence?.type !== 'periodic'} onChange={event => setStart(event.target.value)} InputLabelProps={{ shrink: true }} /><TextField label="Period ends" type="date" fullWidth value={end} disabled={cycle?.cadence?.type !== 'periodic'} onChange={event => setEnd(event.target.value)} InputLabelProps={{ shrink: true }} /></Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}><TextField label="Employee response deadline" type="date" fullWidth value={selfDue} onChange={event => setSelfDue(event.target.value)} InputLabelProps={{ shrink: true }} /><TextField label="Reviewer deadline" type="date" fullWidth value={managerDue} onChange={event => setManagerDue(event.target.value)} InputLabelProps={{ shrink: true }} /></Stack>
          <AppraisalFlowEditor value={flow} onChange={setFlow} onReset={() => setFlow(defaultFlow())} />
        </Stack>}
        {step === 2 && <Stack gap={2}>
          <Typography variant="h6">{cycle?.name}</Typography><Typography>{labels[mode]} · {start} to {end}</Typography>
          <Typography color="text.secondary">{needsRole ? 'AI questions will use each selected role’s published criteria and expected levels. The reviewer confirms the competency findings and final outcome.' : 'AI questions will use the cycle’s published appraisal questions.'}</Typography>
          <Divider />{participants.map(person => <Box key={person.userId}><Typography fontWeight={600}>{person.name}</Typography><Typography color="text.secondary">{needsRole ? `${eligibleRoles.find(role => role.versionId === roles[person.userId])?.name || 'Role needed'} · ` : ''}Reviewer: {person.reviewerOptions.find(reviewer => reviewer.userId === reviewers[person.userId])?.name || 'Reviewer needed'}</Typography></Box>)}
          <Typography variant="body2">Employee responses due {selfDue}. Reviewer responses due {managerDue}.</Typography>
          <Typography variant="body2">Workflow: {flow.steps.map(step => step.label).join(' → ')}. Employee assessment: {flow.assessmentMode === 'conversation' ? 'AI conversation or manual form' : 'Manual form'}.</Typography>
          <Typography variant="body2">CV: {cvRequired ? 'Required' : 'Optional'}</Typography>
          {needsRole && cvRequested && !cvRequired && <Typography variant="body2">Optional CV requested for the selected roles.</Typography>}
        </Stack>}
      </Surface>
      <Stack direction="row" justifyContent="space-between" mt={3} gap={2}><Button disabled={busy || step === 0} onClick={() => move(step - 1)}>Previous</Button>{step < 2 ? <Button variant="contained" disabled={loading || busy} onClick={() => { const problem = step === 0 ? (!cycle ? 'Choose a cycle.' : !participants.length ? 'Choose staff.' : participants.some(person => !reviewers[person.userId] || needsRole && !roles[person.userId]) ? 'Choose a reviewer and, where required, a role for each person.' : '') : issue(); if (problem) setError(problem); else move(step + 1); }}>Continue</Button> : <Button variant="contained" disabled={busy} onClick={() => void launch()}>{busy ? 'Starting…' : `Start ${participants.length} appraisal${participants.length === 1 ? '' : 's'}`}</Button>}</Stack>
    </>}
  </Box>;
}
