import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, Inbox, Loader2, Plus, RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';
import { api, json } from '@/lib/api';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { Link } from '@/lib/router';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type {
  RecoveryTicket, RecoveryTicketDetail, RecoveryTicketPriority, RecoveryTicketStatus, ResponseRecord, Survey
} from '@/types';

const statusLabel: Record<RecoveryTicketStatus, string> = { open: 'Open', in_progress: 'In progress', closed: 'Closed' };
const priorityLabel: Record<RecoveryTicketPriority, string> = { normal: 'Normal', high: 'High', urgent: 'Urgent' };

function formatDate(value: string | null | undefined) {
  if (!value) return 'Not recorded';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function answerText(value: unknown): string {
  if (value == null || value === '') return 'No answer';
  if (Array.isArray(value)) return value.map(answerText).join(', ');
  if (typeof value === 'object') return Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item != null && item !== '').map(([key, item]) => `${key}: ${answerText(item)}`).join('\n');
  return String(value);
}

function eventDescription(event: RecoveryTicketDetail['events'][number]) {
  if (event.eventType === 'created') return 'Created the recovery case';
  if (event.eventType === 'closed') return 'Closed the recovery case';
  if (event.eventType === 'reopened') return 'Reopened the recovery case';
  const changes = event.detail?.changes as Record<string, { from?: string; to?: string }> | undefined;
  if (!changes) return event.eventType.replaceAll('_', ' ');
  const labels: Record<string, string> = { title: 'title', priority: 'priority', status: 'status', owner: 'owner', notes: 'notes' };
  return `Updated ${Object.keys(changes).map((field) => labels[field] || field).join(', ')}`;
}

type NewCase = { surveyId: string; responseId: string; title: string; priority: RecoveryTicketPriority; owner: string; notes: string };
type TicketDraft = { title: string; status: RecoveryTicketStatus; priority: RecoveryTicketPriority; owner: string; notes: string };
const emptyCase: NewCase = { surveyId: '', responseId: '', title: '', priority: 'normal', owner: '', notes: '' };

export function TicketsPage() {
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [tickets, setTickets] = useState<RecoveryTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | RecoveryTicketStatus>('all');
  const [priority, setPriority] = useState<'all' | RecoveryTicketPriority>('all');
  const [owner, setOwner] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [newCase, setNewCase] = useState<NewCase>(emptyCase);
  const [responses, setResponses] = useState<ResponseRecord[]>([]);
  const [responsesLoading, setResponsesLoading] = useState(false);
  const [responsesError, setResponsesError] = useState('');
  const [responsesReload, setResponsesReload] = useState(0);
  const [creating, setCreating] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selected, setSelected] = useState<RecoveryTicketDetail | null>(null);
  const [draft, setDraft] = useState<TicketDraft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [nextTickets, nextSurveys] = await Promise.all([
        api<RecoveryTicket[]>('/api/tickets'), api<Survey[]>('/api/surveys')
      ]);
      setTickets(nextTickets); setSurveys(nextSurveys); setError(''); setLoaded(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load recovery cases.');
    }
  }, []);
  useEffect(() => { void load().finally(() => setLoading(false)); }, [load]);
  useLiveRefresh(load);

  useEffect(() => {
    setResponses([]);
    setResponsesError('');
    if (!createOpen || !newCase.surveyId) return;
    let cancelled = false;
    setResponsesLoading(true);
    api<ResponseRecord[]>(`/api/surveys/${newCase.surveyId}/responses?limit=500`)
      .then((next) => { if (!cancelled) setResponses(next); })
      .catch((reason) => {
        if (cancelled) return;
        const message = reason instanceof Error ? reason.message : 'Could not load responses';
        setResponsesError(message);
        toast.error(message);
      })
      .finally(() => { if (!cancelled) setResponsesLoading(false); });
    return () => { cancelled = true; };
  }, [createOpen, newCase.surveyId, responsesReload]);

  async function retryLoad() {
    setLoading(true);
    await load();
    setLoading(false);
  }

  const owners = useMemo(() => Array.from(new Set(tickets.map((item) => item.owner).filter(Boolean))).sort(), [tickets]);
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return tickets.filter((item) => {
      if (status !== 'all' && item.status !== status) return false;
      if (priority !== 'all' && item.priority !== priority) return false;
      if (owner !== 'all' && item.owner !== owner) return false;
      return !query || [item.title, item.survey.title, item.owner, item.notes, item.respondent?.name, item.respondent?.email]
        .some((value) => String(value || '').toLowerCase().includes(query));
    });
  }, [owner, priority, search, status, tickets]);
  const counts = useMemo(() => ({
    open: tickets.filter((item) => item.status === 'open').length,
    inProgress: tickets.filter((item) => item.status === 'in_progress').length,
    urgent: tickets.filter((item) => item.priority === 'urgent' && item.status !== 'closed').length,
    closed: tickets.filter((item) => item.status === 'closed').length
  }), [tickets]);

  function beginCreate() {
    setNewCase({ ...emptyCase, surveyId: surveys[0]?.id || '' });
    setCreateOpen(true);
  }

  async function createCase(event: FormEvent) {
    event.preventDefault();
    if (!newCase.surveyId || !newCase.title.trim()) return;
    try {
      setCreating(true);
      const created = await api<RecoveryTicketDetail>('/api/tickets', json('POST', {
        ...newCase, title: newCase.title.trim(), responseId: newCase.responseId || null
      }));
      setCreateOpen(false); setNewCase(emptyCase);
      await load();
      toast.success('Recovery case opened');
      await openTicket(created.id);
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : 'Could not open recovery case');
    } finally { setCreating(false); }
  }

  async function openTicket(id: string) {
    setDetailOpen(true); setDetailLoading(true); setSelected(null); setDraft(null);
    try {
      const detail = await api<RecoveryTicketDetail>(`/api/tickets/${id}`);
      setSelected(detail);
      setDraft({ title: detail.title, status: detail.status, priority: detail.priority, owner: detail.owner, notes: detail.notes });
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : 'Could not open recovery case');
      setDetailOpen(false);
    } finally { setDetailLoading(false); }
  }

  async function saveTicket(event?: FormEvent) {
    event?.preventDefault();
    if (!selected || !draft || !draft.title.trim()) return;
    try {
      setSaving(true);
      const updated = await api<RecoveryTicketDetail>(`/api/tickets/${selected.id}`, json('PATCH', { ...draft, title: draft.title.trim() }));
      setSelected(updated);
      setDraft({ title: updated.title, status: updated.status, priority: updated.priority, owner: updated.owner, notes: updated.notes });
      await load();
      toast.success('Recovery case saved');
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : 'Could not save recovery case');
    } finally { setSaving(false); }
  }

  async function changeStatus(nextStatus: RecoveryTicketStatus) {
    if (!selected || !draft) return;
    try {
      setSaving(true);
      const updated = await api<RecoveryTicketDetail>(`/api/tickets/${selected.id}`, json('PATCH', { status: nextStatus }));
      setSelected(updated); setDraft({ ...draft, status: updated.status });
      await load();
      toast.success(nextStatus === 'closed' ? 'Recovery case closed' : nextStatus === 'open' ? 'Recovery case reopened' : 'Work started');
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : 'Could not update recovery case');
    } finally { setSaving(false); }
  }

  const hasFilters = Boolean(search || status !== 'all' || priority !== 'all' || owner !== 'all');
  return <div className="space-y-5">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div><h1 className="page-title">Service recovery</h1><p className="page-description">Open, assign, and resolve follow-up work without losing the original feedback.</p></div>
      <Button onClick={beginCreate}><Plus />New recovery case</Button>
    </div>

    <div className="flex flex-wrap gap-x-6 gap-y-2 border-y py-3 text-sm" aria-label="Recovery case summary">
      <span><strong>{counts.open}</strong> open</span><span><strong>{counts.inProgress}</strong> in progress</span>
      <span><strong>{counts.urgent}</strong> urgent</span><span><strong>{counts.closed}</strong> closed</span>
    </div>

    <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
      <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Search recovery cases" className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search case, survey, owner, or respondent" /></div>
      <select aria-label="Filter by status" className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">All statuses</option>{Object.entries(statusLabel).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
      <select aria-label="Filter by priority" className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={priority} onChange={(event) => setPriority(event.target.value as typeof priority)}><option value="all">All priorities</option>{Object.entries(priorityLabel).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
      <select aria-label="Filter by owner" className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={owner} onChange={(event) => setOwner(event.target.value)}><option value="all">All owners</option><option value="">Unassigned</option>{owners.map((name) => <option value={name} key={name}>{name}</option>)}</select>
      <Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw />Refresh</Button>
    </div>

    {error && <div className="flex flex-col items-start justify-between gap-3 border border-destructive/40 px-4 py-3 text-sm text-destructive sm:flex-row sm:items-center" role="alert"><span>{error}</span><Button type="button" variant="outline" size="sm" onClick={() => void retryLoad()}>Retry</Button></div>}
    {loading ? <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground" role="status"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading recovery cases</div>
      : !loaded ? null : visible.length ? <div className="overflow-hidden rounded-lg border bg-card"><div className="overflow-x-auto"><table className="data-table"><thead><tr><th>Case</th><th>Survey</th><th>Priority</th><th>Status</th><th>Owner</th><th>Updated</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{visible.map((item) => <tr key={item.id}>
        <td className="max-w-md"><div className="font-medium">{item.title}</div><div className="mt-1 font-mono text-[11px] text-muted-foreground">{item.responseId ? `Response ${item.responseId.slice(0, 8)}` : 'Manually opened'} · {item.eventCount} {item.eventCount === 1 ? 'event' : 'events'}</div></td>
        <td>{item.survey.title}</td><td>{priorityLabel[item.priority]}</td><td>{statusLabel[item.status]}</td><td>{item.owner || 'Unassigned'}</td><td className="whitespace-nowrap">{formatDate(item.updatedAt)}</td>
        <td className="text-right"><Button size="sm" variant="outline" onClick={() => void openTicket(item.id)}><Eye />Open</Button></td>
      </tr>)}</tbody></table></div></div>
        : <EmptyState icon={Inbox} title={hasFilters ? 'No matching recovery cases' : 'No recovery cases'} description={hasFilters ? 'Clear or change the filters to see other cases.' : 'Open a case manually, or let survey logic and Terra create one from urgent feedback.'} action={hasFilters ? <Button variant="outline" onClick={() => { setSearch(''); setStatus('all'); setPriority('all'); setOwner('all'); }}>Clear filters</Button> : <Button onClick={beginCreate}><Plus />New recovery case</Button>} />}

    <Dialog open={createOpen} onOpenChange={(open) => { if (!creating) setCreateOpen(open); }}><DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
      <form onSubmit={createCase} className="space-y-5"><DialogHeader><DialogTitle>New recovery case</DialogTitle><DialogDescription>Connect the case to a survey and, when available, the exact response that needs follow-up.</DialogDescription></DialogHeader>
        {!surveys.length && <div className="border px-4 py-3 text-sm"><p>A recovery case must be connected to a survey so its evidence stays in the correct space.</p><Button asChild className="mt-3" size="sm" variant="outline"><Link to="/surveys/new">Create a survey</Link></Button></div>}
        <div><Label htmlFor="recovery-survey">Survey</Label><select id="recovery-survey" required className="mt-2 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={newCase.surveyId} onChange={(event) => setNewCase((current) => ({ ...current, surveyId: event.target.value, responseId: '' }))}><option value="">Select a survey</option>{surveys.map((survey) => <option value={survey.id} key={survey.id}>{survey.title}</option>)}</select></div>
        <div><Label htmlFor="recovery-response">Source response (optional)</Label><select id="recovery-response" aria-describedby={responsesError ? 'recovery-response-error' : undefined} disabled={!newCase.surveyId || responsesLoading || Boolean(responsesError)} className="mt-2 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={newCase.responseId} onChange={(event) => setNewCase((current) => ({ ...current, responseId: event.target.value }))}><option value="">{responsesLoading ? 'Loading responses…' : responsesError ? 'Responses unavailable' : 'No linked response'}</option>{responses.map((item) => <option value={item.id} key={item.id}>{item.id.slice(0, 8)} · {formatDate(item.completedAt || item.startedAt)}</option>)}</select>{responsesError && <div id="recovery-response-error" className="mt-2 flex items-center justify-between gap-3 text-xs text-destructive" role="alert"><span>{responsesError}</span><Button type="button" size="sm" variant="outline" onClick={() => setResponsesReload((current) => current + 1)}>Retry</Button></div>}</div>
        <div><Label htmlFor="recovery-title">Case title</Label><Input id="recovery-title" className="mt-2" required minLength={2} maxLength={160} value={newCase.title} onChange={(event) => setNewCase((current) => ({ ...current, title: event.target.value }))} placeholder="Briefly describe what needs follow-up" /></div>
        <div className="grid gap-4 sm:grid-cols-2"><div><Label htmlFor="recovery-priority">Priority</Label><select id="recovery-priority" className="mt-2 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={newCase.priority} onChange={(event) => setNewCase((current) => ({ ...current, priority: event.target.value as RecoveryTicketPriority }))}>{Object.entries(priorityLabel).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div><div><Label htmlFor="recovery-owner">Owner (optional)</Label><Input id="recovery-owner" className="mt-2" maxLength={150} value={newCase.owner} onChange={(event) => setNewCase((current) => ({ ...current, owner: event.target.value }))} placeholder="Name or team" list="recovery-owners" /></div></div>
        <div><Label htmlFor="recovery-notes">Initial notes (optional)</Label><Textarea id="recovery-notes" className="mt-2" maxLength={5000} rows={5} value={newCase.notes} onChange={(event) => setNewCase((current) => ({ ...current, notes: event.target.value }))} placeholder="Record the issue, promised follow-up, or useful context." /></div>
        <DialogFooter><Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</Button><Button type="submit" disabled={creating || !newCase.surveyId || newCase.title.trim().length < 2}>{creating && <Loader2 className="animate-spin" />}Open recovery case</Button></DialogFooter>
      </form>
    </DialogContent></Dialog>

    <datalist id="recovery-owners">{owners.map((name) => <option value={name} key={name} />)}</datalist>

    <Dialog open={detailOpen} onOpenChange={(open) => { if (!saving) setDetailOpen(open); }}><DialogContent className="flex h-[calc(100dvh-1.5rem)] flex-col gap-0 overflow-hidden p-0 sm:h-[calc(100dvh-2rem)] sm:max-w-4xl">
      {detailLoading ? <div className="p-5 sm:p-6"><DialogHeader className="pr-10"><DialogTitle>Loading recovery case</DialogTitle><DialogDescription>Retrieving the case, response context, and activity history.</DialogDescription></DialogHeader><div className="flex min-h-56 items-center justify-center text-sm text-muted-foreground" role="status"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading recovery case</div></div> : selected && draft ? <form onSubmit={saveTicket} className="relative z-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <DialogHeader className="min-w-0 shrink-0 border-b px-5 py-5 pr-14 sm:px-6 sm:pr-16"><DialogTitle className="break-words">{selected.title}</DialogTitle><DialogDescription className="break-words">{selected.survey.title} · Opened {formatDate(selected.createdAt)} · Updated {formatDate(selected.updatedAt)}</DialogDescription></DialogHeader>

        <div className="relative z-0 min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
          <div className="grid gap-4 sm:grid-cols-2"><div className="sm:col-span-2"><Label htmlFor="ticket-title">Case title</Label><Input id="ticket-title" className="mt-2" required minLength={2} maxLength={160} value={draft.title} onChange={(event) => setDraft((current) => current && ({ ...current, title: event.target.value }))} /></div>
            <div><Label htmlFor="ticket-status">Status</Label><select id="ticket-status" className="mt-2 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={draft.status} onChange={(event) => setDraft((current) => current && ({ ...current, status: event.target.value as RecoveryTicketStatus }))}>{Object.entries(statusLabel).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
            <div><Label htmlFor="ticket-priority">Priority</Label><select id="ticket-priority" className="mt-2 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={draft.priority} onChange={(event) => setDraft((current) => current && ({ ...current, priority: event.target.value as RecoveryTicketPriority }))}>{Object.entries(priorityLabel).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
            <div className="sm:col-span-2"><Label htmlFor="ticket-owner">Owner</Label><Input id="ticket-owner" className="mt-2" maxLength={150} value={draft.owner} onChange={(event) => setDraft((current) => current && ({ ...current, owner: event.target.value }))} placeholder="Unassigned" list="recovery-owners" /></div>
            <div className="sm:col-span-2"><Label htmlFor="ticket-notes">Recovery notes</Label><Textarea id="ticket-notes" className="mt-2" rows={6} maxLength={5000} value={draft.notes} onChange={(event) => setDraft((current) => current && ({ ...current, notes: event.target.value }))} /></div>
          </div>

          <section className="border-t pt-5" aria-labelledby="recovery-context-heading"><h3 id="recovery-context-heading" className="text-sm font-semibold">Customer and response context</h3>
            {selected.respondent ? <div className="mt-3 grid gap-1 text-sm"><div><span className="text-muted-foreground">Name:</span> {selected.respondent.name || 'Not provided'}</div><div><span className="text-muted-foreground">Email:</span> {selected.respondent.email || 'Not provided'}</div></div> : <p className="mt-2 text-sm text-muted-foreground">No identifying respondent details were supplied.</p>}
            {selected.response ? <div className="mt-4 divide-y border">{Object.entries(selected.response.answers).map(([questionId, value]) => <div className="px-4 py-3" key={questionId}><div className="text-xs font-medium text-muted-foreground">{selected.survey.questions?.find((question) => question.id === questionId)?.title || questionId}</div><div className="mt-1 whitespace-pre-wrap text-sm">{answerText(value)}</div></div>)}</div> : <p className="mt-3 text-sm text-muted-foreground">This case was opened without a source response.</p>}
            {selected.response?.aiAnalysis && <div className="mt-4 border bg-muted/25 px-4 py-3"><div className="text-sm font-medium">Terra analysis</div><p className="mt-1 text-sm leading-6">{selected.response.aiAnalysis.summary || 'Analysis completed.'}</p></div>}
          </section>

          <section className="border-t pt-5" aria-labelledby="recovery-history-heading"><h3 id="recovery-history-heading" className="text-sm font-semibold">Activity</h3>
            {selected.events.length ? <ol className="mt-3 divide-y border">{[...selected.events].reverse().map((event) => <li className="px-4 py-3" key={event.id}><div className="text-sm">{eventDescription(event)}</div><div className="mt-1 text-xs text-muted-foreground">{event.actor?.name || event.actor?.email || 'Automated workflow'} · {formatDate(event.createdAt)}</div></li>)}</ol> : <p className="mt-2 text-sm text-muted-foreground">No activity has been recorded for this case yet.</p>}
          </section>
        </div>

        <DialogFooter className="relative z-10 shrink-0 border-t bg-background px-5 py-4 sm:items-center sm:justify-between sm:px-6"><div className="flex flex-wrap gap-2">{selected.status === 'open' && <Button type="button" variant="outline" disabled={saving} onClick={() => void changeStatus('in_progress')}>Start work</Button>}{selected.status === 'in_progress' && <Button type="button" variant="outline" disabled={saving} onClick={() => void changeStatus('closed')}>Close case</Button>}{selected.status === 'closed' && <Button type="button" variant="outline" disabled={saving} onClick={() => void changeStatus('open')}>Reopen case</Button>}</div><Button type="submit" disabled={saving || draft.title.trim().length < 2}>{saving && <Loader2 className="animate-spin" />}Save changes</Button></DialogFooter>
      </form> : null}
    </DialogContent></Dialog>
  </div>;
}
