'use client';

import { useMemo, useRef, useState } from 'react';
import { useSWRConfig } from 'swr';
import { Alert, Autocomplete, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography } from '@mui/material';
import api from '@/lib/api';
import { useDirectReports, useUserContext, useUserSearch } from '@/lib/hooks';
import type { FeedbackRequestStatus } from './FeedbackRequestProgress';

interface Person { id: string; name: string; email?: string }
interface RequestPayload { subjectId: string; reviewerIds: string[]; dueDate: string; questions: string[]; contextType: string; contextLabel: string; visibility: string; anonymity: string }
function person(value: Record<string, unknown>): Person | null {
  const id = value.id || value.userId || value._id || value.idpSub;
  return id ? { id: String(id), name: String(value.name || value.displayName || value.email || 'Employee'), email: value.email ? String(value.email) : undefined } : null;
}
const label = (value: Person) => `${value.name}${value.email ? ` · ${value.email}` : ''}`;
const key = (value: FeedbackRequestStatus) => value.cohortId || value._id || '';
function dataOf(response: { data: { data?: unknown } }): FeedbackRequestStatus[] {
  if (!Array.isArray(response.data?.data)) throw new Error('Could not verify existing requests');
  return response.data.data;
}

export default function RequestFeedbackDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { user } = useUserContext();
  const { directReports, isError: rosterError } = useDirectReports();
  const { mutate } = useSWRConfig();
  const self = useMemo(() => person(user || {}), [user]);
  const [subject, setSubject] = useState<Person | null>(self);
  const [subjectQuery, setSubjectQuery] = useState(self ? label(self) : '');
  const [reviewers, setReviewers] = useState<Person[]>([]);
  const [query, setQuery] = useState('');
  const searchQuery = query.trim();
  const { users, isLoading: searching, isError: searchError } = useUserSearch(searchQuery);
  const [searchRetrying, setSearchRetrying] = useState(false);
  const [context, setContext] = useState('360');
  const [contextLabel, setContextLabel] = useState('');
  const [anonymity, setAnonymity] = useState('named');
  const [visibility, setVisibility] = useState('private');
  const [dueDate, setDueDate] = useState('');
  const [questions, setQuestions] = useState('What contribution helped most, and what would improve future delivery?');
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const baseline = useRef<Set<string>>(new Set());
  const sentPayload = useRef<RequestPayload | null>(null);
  const operationKey = useRef<string | null>(null);
  const subjects = useMemo(() => [...new Map([self, ...(directReports || []).map((entry: Record<string, unknown>) => person(entry))]
    .filter((entry): entry is Person => Boolean(entry)).map(entry => [entry.id, entry])).values()], [directReports, self]);
  const options = useMemo<Person[]>(() => searchQuery.length < 2 ? [] : [...new Map<string, Person>((users || []).map((entry: Record<string, unknown>) => person(entry))
    .filter((entry: Person | null): entry is Person => Boolean(entry) && entry!.id !== subject?.id).map((entry: Person) => [entry.id, entry] as const)).values()], [searchQuery, users, subject]);
  const payload = (): RequestPayload => ({ subjectId: subject?.id || '', reviewerIds: [...new Set(reviewers.filter(value => value.id !== subject?.id).map(value => value.id))],
    dueDate: new Date(dueDate).toISOString(), questions: questions.split('\n').map(value => value.trim()).filter(Boolean),
    contextType: context, contextLabel: contextLabel.trim(), visibility, anonymity });
  const validate = () => {
    if (!subject) return 'Choose the person this feedback is about.';
    if (reviewers.length < (anonymity === 'anonymous' ? 5 : 1)) return anonymity === 'anonymous' ? 'Choose at least five distinct reviewers for anonymous 360 feedback.' : 'Choose at least one reviewer.';
    if (!dueDate || !Number.isFinite(Date.parse(dueDate)) || Date.parse(dueDate) <= Date.now()) return 'Choose a future due date.';
    if (!questions.trim()) return 'Add at least one feedback question.';
    const rows = questions.split('\n').map(value => value.trim()).filter(Boolean);
    if (rows.length > 20 || rows.some(value => value.length > 500)) return 'Use up to 20 questions, with no more than 500 characters per question.';
    return '';
  };
  const checkStatus = async () => {
    const sent = sentPayload.current;
    if (!sent) return false;
    try {
      const entries = dataOf(await api.get('/feedback/requests', { params: { view: 'requested' } }));
      const matches = entries.filter(entry => !baseline.current.has(key(entry)) && entry.subjectId === sent.subjectId && entry.contextType === sent.contextType
        && (entry.contextLabel || '') === sent.contextLabel && entry.anonymity === sent.anonymity && entry.visibility === sent.visibility
        && entry.dueDate && new Date(entry.dueDate).toISOString() === sent.dueDate && JSON.stringify(entry.questions || []) === JSON.stringify(sent.questions));
      const cohortMatch = matches.length === 1 && Boolean(matches[0].kind) && matches[0].reviewerCount === sent.reviewerIds.length;
      const namedIds = matches.filter(entry => !entry.kind).map(entry => entry.reviewerId).filter(Boolean);
      const namedMatch = namedIds.length === sent.reviewerIds.length && sent.reviewerIds.every(id => namedIds.includes(id));
      // A matching list entry is informative, never proof that this operation
      // completed. Only a successful replay with the same key confirms it.
      setUncertain(true);
      setError(cohortMatch || namedMatch
        ? 'A matching request is visible. Retry request to confirm this operation safely.'
        : 'The request is not yet confirmed. Your draft is preserved. Retry request uses the same key and will not create another invitation batch.');
    } catch { setUncertain(true); setError('The request status could not be confirmed. Retry request safely uses the same request key.'); }
    return false;
  };
  const send = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      // Capture a baseline before creating anything, so a lost POST response can
      // be reconciled without blindly sending duplicate invitations.
      if (!uncertain) {
        const existing = dataOf(await api.get('/feedback/requests', { params: { view: 'requested' } }));
        baseline.current = new Set(existing.map(key));
      }
      if (!sentPayload.current || !operationKey.current) throw new Error('Review the request before sending');
      try { await api.post('/feedback/requests', sentPayload.current, { headers: { 'Idempotency-Key': operationKey.current } }); onCreated(); }
      catch (requestError) {
        const response = (requestError as { response?: { status: number; data?: { error?: string; code?: string } } }).response;
        if (!response || response.status >= 500) { setUncertain(true); await checkStatus(); }
        else if (uncertain || ['REQUEST_RECOVERY_REQUIRED', 'REQUEST_KEY_CONFLICT'].includes(response.data?.code || '')) {
          setUncertain(true); setError(response.data?.error || 'Keep this request open while its existing invitations are checked.');
        }
        else { setUncertain(false); setError(response.data?.error || 'Could not send this feedback request.'); }
      }
    } catch { setError('Could not check existing requests. Retry to send your preserved draft.'); }
    finally { pending.current = false; setBusy(false); }
  };
  return <Dialog open onClose={() => { if (!busy) onClose(); }} fullWidth maxWidth="sm">
    <DialogTitle>{reviewing ? 'Review feedback request' : 'Request feedback'}</DialogTitle>
    <DialogContent dividers><Stack spacing={2}>
      {error && <Alert severity="error">{error}</Alert>}
      {reviewing ? <>
        <Typography>Feedback about {subject && label(subject)}</Typography>
        <Typography fontWeight={600}>Reviewers ({reviewers.length})</Typography>
        <Stack component="ul" sx={{ pl: 2.5 }}>{reviewers.map(value => <Typography component="li" key={value.id} sx={{ overflowWrap: 'anywhere' }}>{label(value)}</Typography>)}</Stack>
        <Typography>{anonymity} · {context} · {visibility} · Due {dueDate}</Typography>
        {contextLabel && <Typography>{contextLabel}</Typography>}
        <Typography sx={{ whiteSpace: 'pre-wrap' }}>{questions}</Typography>
        {anonymity === 'anonymous' && <Alert severity="info">Individual reviewer progress is hidden. Anonymous responses are available only after at least five responses, within the selected audience.</Alert>}
      </> : <>
        {rosterError && <Alert severity="warning" action={<Button onClick={() => void mutate('/user/my-team-members').catch(() => undefined)}>Retry people</Button>}>Could not load staff in your scope. You can still request feedback for yourself.</Alert>}
        <Autocomplete options={subjects} value={subject} inputValue={subjectQuery} getOptionLabel={label} isOptionEqualToValue={(a, b) => a.id === b.id}
          onInputChange={(_, value, reason) => { if (reason === 'input' || reason === 'clear') { setSubjectQuery(value); setSubject(null); } }}
          onChange={(_, value) => { setSubject(value); setSubjectQuery(value ? label(value) : ''); setReviewers(current => current.filter(entry => entry.id !== value?.id)); }}
          renderInput={params => <TextField {...params} label="Feedback about" required helperText="Choose yourself or staff in your authorized scope." />} />
        {searchError && <Alert severity="error" action={<Button disabled={searchRetrying} onClick={async () => { setSearchRetrying(true); try { await mutate(`/user/search?q=${encodeURIComponent(searchQuery)}`); } catch { setError('Reviewer search is still unavailable. Please retry.'); } finally { setSearchRetrying(false); } }}>Retry search</Button>}>Could not search reviewers. Your selections are preserved.</Alert>}
        <Autocomplete multiple filterSelectedOptions options={options} value={reviewers} inputValue={query} getOptionLabel={label}
          isOptionEqualToValue={(a, b) => a.id === b.id} filterOptions={values => values} loading={searching || searchRetrying}
          onInputChange={(_, value, reason) => { if (reason === 'input' || reason === 'clear') setQuery(value); }}
          onChange={(_, values) => { setReviewers([...new Map(values.filter(value => value.id !== subject?.id).map(value => [value.id, value])).values()]); setQuery(''); }}
          noOptionsText={searchQuery.length < 2 ? 'Type at least two characters to search' : searchError ? 'Search unavailable. Retry above.' : 'No eligible colleagues found'}
          renderInput={params => <TextField {...params} label="Reviewers" required helperText="Select each exact colleague. The person being reviewed is excluded." />} />
        <TextField select label="Feedback context" value={context} onChange={event => { setContext(event.target.value); if (event.target.value !== '360' && anonymity === 'anonymous') setAnonymity('named'); }}>
          {['general', 'goal', 'project', 'peer', 'upward', '360'].map(value => <MenuItem key={value} value={value}>{value === '360' ? '360 feedback' : value}</MenuItem>)}
        </TextField>
        <TextField label="Request label" value={contextLabel} onChange={event => setContextLabel(event.target.value)} inputProps={{ maxLength: 300 }} />
        <TextField select label="Reviewer identity" value={anonymity} onChange={event => setAnonymity(event.target.value)}>
          <MenuItem value="named">Named</MenuItem><MenuItem value="confidential">Confidential</MenuItem><MenuItem value="anonymous" disabled={context !== '360'}>Anonymous · 360 only, at least five reviewers</MenuItem>
        </TextField>
        <TextField select label="Response audience" value={visibility} onChange={event => setVisibility(event.target.value)}
          helperText="Existing feedback permissions control access. Requesting feedback does not grant access to private responses.">
          <MenuItem value="private">Private feedback</MenuItem><MenuItem value="manager-only">Employee and permitted managers</MenuItem><MenuItem value="public">Shared with permitted managers</MenuItem>
        </TextField>
        <TextField type="date" label="Due date" value={dueDate} onChange={event => setDueDate(event.target.value)} InputLabelProps={{ shrink: true }} required />
        <TextField label="Questions (one per line)" multiline minRows={3} value={questions} onChange={event => setQuestions(event.target.value)} required />
      </>}
    </Stack></DialogContent>
    <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
      <Button disabled={busy} onClick={onClose}>Cancel</Button>
      {reviewing && !uncertain && <Button disabled={busy} onClick={() => { setReviewing(false); setError(''); sentPayload.current = null; operationKey.current = null; }}>Edit request</Button>}
      <Button variant="contained" disabled={busy} onClick={() => {
        if (reviewing) void send();
        else { const validation = validate(); setError(validation); if (!validation) { sentPayload.current = payload(); operationKey.current = crypto.randomUUID(); setReviewing(true); } }
      }}>{busy ? 'Working…' : !reviewing ? 'Review request' : uncertain ? 'Retry request' : 'Send request'}</Button>
    </DialogActions>
  </Dialog>;
}
