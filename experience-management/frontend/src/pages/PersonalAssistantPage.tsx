import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpenCheck, CheckSquare, ChevronRight, CircleAlert, Copy, FilePenLine, Inbox, Loader2,
  MailCheck, MessageSquareText, RefreshCw, Save, ShieldCheck, Square
} from 'lucide-react';
import { toast } from 'sonner';
import { api, json } from '@/lib/api';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type {
  AssistantConnection, AssistantOverview, AssistantRun, AssistantThread, IntelligenceSource
} from '@/types';

type WorkspaceTab = 'mailbox' | 'knowledge' | 'history';

function formatDateTime(value?: string | null) {
  if (!value) return 'Not yet';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function runTitle(run: AssistantRun) {
  if (run.kind === 'assistant.email_summary' || run.kind === 'email_summary') return 'Email summary';
  if (run.kind === 'assistant.email_draft' || run.kind === 'email_draft') return 'Email draft';
  return 'Knowledge answer';
}

function participantLabel(participant: AssistantThread['participants'][number]) {
  return typeof participant === 'string' ? participant : participant.name || participant.email;
}

function RunBadge({ run }: { run: AssistantRun }) {
  const waiting = run.stage?.startsWith('waiting_for_');
  const variant = run.state === 'completed' ? 'success' : run.state === 'failed' ? 'destructive' : waiting ? 'warning' : 'secondary';
  const label = waiting ? run.stage.replaceAll('_', ' ') : run.state === 'processing' ? `${run.progress}%` : run.state;
  return <Badge variant={variant}>{label}</Badge>;
}

function ConnectionMark({ connection }: { connection: AssistantConnection }) {
  return <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md border bg-background text-xs font-semibold">
    {connection.provider === 'microsoft' ? 'M' : 'G'}
  </div>;
}

function ResultList({ title, values }: { title: string; values?: unknown[] }) {
  if (!values?.length) return null;
  return <section>
    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
    <ul className="mt-2 space-y-2 text-sm leading-6">
      {values.map((value, index) => <li className="flex gap-2" key={index}><span aria-hidden="true">•</span><span>{typeof value === 'string' ? value : JSON.stringify(value)}</span></li>)}
    </ul>
  </section>;
}

function RuntimeFootnote({ run }: { run: AssistantRun }) {
  if (!run.runtime) return null;
  const usage = run.runtime.usage || {};
  const tokens = usage.totalTokens ?? usage.total_tokens;
  return <div className="border-t pt-3 text-xs text-muted-foreground">
    Runtime: {run.runtime.providerLabel || run.runtime.provider || run.runtime.model || 'Terra'}
    {tokens ? ` · ${tokens} tokens` : ''}{run.runtime.latencyMs ? ` · ${run.runtime.latencyMs} ms` : ''}
  </div>;
}

export function PersonalAssistantPage() {
  const [tab, setTab] = useState<WorkspaceTab>('mailbox');
  const [overview, setOverview] = useState<AssistantOverview | null>(null);
  const [runs, setRuns] = useState<AssistantRun[]>([]);
  const [sources, setSources] = useState<IntelligenceSource[]>([]);
  const [connectionId, setConnectionId] = useState('');
  const [threads, setThreads] = useState<AssistantThread[]>([]);
  const [threadsConnectionId, setThreadsConnectionId] = useState('');
  const [threadId, setThreadId] = useState('');
  const [selectedRunId, setSelectedRunId] = useState('');
  const [instructions, setInstructions] = useState('Draft a concise, professional response. Do not make commitments that are not in the thread.');
  const [tone, setTone] = useState('professional');
  const [question, setQuestion] = useState('What are the most important customer experience risks, and which saved evidence supports them?');
  const [sourceRefs, setSourceRefs] = useState<string[]>([]);
  const [draftSubject, setDraftSubject] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [draftRevision, setDraftRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [threadError, setThreadError] = useState('');
  const [oauthNotice, setOauthNotice] = useState<{ tone: 'success' | 'warning' | 'error'; text: string } | null>(null);
  const activeConnection = useRef('');
  const connectedConnectionIds = useRef(new Set<string>());
  const threadRequest = useRef(0);
  const runRequest = useRef({ fingerprint: '', key: '' });

  const loadWorkspace = useCallback(async (quiet = false) => {
    const [overviewResult, runResult, sourceResult] = await Promise.allSettled([
      api<AssistantOverview>('/api/assistant/overview'),
      api<AssistantRun[]>('/api/assistant/runs?limit=100'),
      api<IntelligenceSource[]>('/api/intelligence/sources')
    ]);
    if (overviewResult.status === 'fulfilled') {
      const connected = overviewResult.value.connections.filter((item) => item.status === 'connected');
      connectedConnectionIds.current = new Set(connected.map((item) => item.id));
      const current = activeConnection.current;
      const next = connected.some((item) => item.id === current) ? current : connected[0]?.id || '';
      if (next !== current) {
        activeConnection.current = next;
        threadRequest.current += 1;
        setThreads([]);
        setThreadId('');
        setThreadsConnectionId('');
        setThreadError('');
      }
      setOverview(overviewResult.value);
      setConnectionId(next);
    }
    if (runResult.status === 'fulfilled') {
      setRuns(runResult.value);
      setSelectedRunId((current) => current && runResult.value.some((run) => run.id === current)
        ? current : runResult.value[0]?.id || '');
    }
    if (sourceResult.status === 'fulfilled') setSources(sourceResult.value);
    const failures = [overviewResult, runResult, sourceResult].filter((result) => result.status === 'rejected') as PromiseRejectedResult[];
    setError(failures.map((failure) => failure.reason instanceof Error ? failure.reason.message : 'Assistant data could not load.').join(' '));
    if (!quiet) setLoading(false);
  }, []);

  const loadThreads = useCallback(async (reset = true) => {
    const requestedConnection = connectionId;
    const requestId = ++threadRequest.current;
    if (reset) {
      setThreads([]);
      setThreadId('');
      setThreadsConnectionId('');
    }
    setThreadError('');
    if (!requestedConnection || !connectedConnectionIds.current.has(requestedConnection)) return;
    try {
      const result = await api<AssistantThread[]>(`/api/assistant/threads?connectionId=${encodeURIComponent(requestedConnection)}&limit=40`);
      if (requestId !== threadRequest.current || activeConnection.current !== requestedConnection) return;
      setThreads(result);
      setThreadsConnectionId(requestedConnection);
      setThreadId((current) => current && result.some((thread) => thread.id === current) ? current : result[0]?.id || '');
    } catch (reason) {
      if (requestId !== threadRequest.current || activeConnection.current !== requestedConnection) return;
      setThreadError(reason instanceof Error ? reason.message : 'Mailbox threads could not load.');
    }
  }, [connectionId]);

  useEffect(() => { void loadWorkspace(); }, [loadWorkspace]);
  useEffect(() => { void loadThreads(); }, [loadThreads]);
  useEffect(() => {
    const url = new URL(window.location.href);
    const status = url.searchParams.get('nylas');
    if (!status) return;
    const notice = status === 'connected'
      ? { tone: 'success' as const, text: 'Mailbox connected successfully.' }
      : status === 'cancelled'
        ? { tone: 'warning' as const, text: 'Mailbox connection was cancelled. No access was added.' }
        : { tone: 'error' as const, text: 'Mailbox connection failed. Review the Nylas setup and try again.' };
    setOauthNotice(notice);
    if (status === 'connected') toast.success(notice.text);
    else if (status === 'cancelled') toast.warning(notice.text);
    else toast.error(notice.text);
    url.searchParams.delete('nylas');
    url.searchParams.delete('code');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);
  useLiveRefresh(useCallback(() => { void loadWorkspace(true); void loadThreads(false); }, [loadWorkspace, loadThreads]));
  const hasActiveRun = runs.some((run) => run.state === 'queued' || run.state === 'processing');
  useEffect(() => {
    if (!hasActiveRun) return;
    const timer = window.setInterval(() => void loadWorkspace(true), 1500);
    return () => window.clearInterval(timer);
  }, [hasActiveRun, loadWorkspace]);

  const selectedThread = threadsConnectionId === connectionId
    && overview?.connections.some((connection) => connection.id === connectionId && connection.status === 'connected')
    ? threads.find((thread) => thread.id === threadId) || null : null;
  const selectedRun = runs.find((run) => run.id === selectedRunId) || null;
  const draftDirty = Boolean(selectedRun?.draft && (
    draftSubject !== (selectedRun.draft.subject || '') || draftBody !== (selectedRun.draft.body || '')
  ));
  useUnsavedChanges(draftDirty);
  useEffect(() => {
    if (!selectedRun?.draft) return;
    setDraftSubject(selectedRun.draft.subject || '');
    setDraftBody(selectedRun.draft.body || '');
    setDraftRevision(selectedRun.draft.revision || 0);
  }, [selectedRun?.id, selectedRun?.draft?.revision]);

  const groupedSources = useMemo(() => ({
    survey: sources.filter((source) => source.type === 'survey'),
    social: sources.filter((source) => source.type === 'social')
  }), [sources]);

  async function connect(provider: 'google' | 'microsoft') {
    setWorking(`connect:${provider}`);
    try {
      const result = await api<{ authorizeUrl: string }>('/api/assistant/nylas/connect', json('POST', { provider }));
      window.location.assign(result.authorizeUrl);
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Mailbox connection could not start.'); }
    finally { setWorking(''); }
  }

  async function disconnect(connection: AssistantConnection) {
    if (!window.confirm(`Disconnect ${connection.email}? Saved assistant history will remain available.`)) return;
    setWorking(`disconnect:${connection.id}`);
    try {
      await api(`/api/assistant/nylas/connections/${connection.id}`, { method: 'DELETE' });
      connectedConnectionIds.current.delete(connection.id);
      if (activeConnection.current === connection.id) {
        activeConnection.current = '';
        threadRequest.current += 1;
        setConnectionId('');
        setThreads([]);
        setThreadId('');
        setThreadsConnectionId('');
        setThreadError('');
      }
      await loadWorkspace(true); toast.success('Mailbox disconnected.');
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Mailbox could not be disconnected.'); }
    finally { setWorking(''); }
  }

  async function startRun(kind: 'email-summary' | 'email-draft' | 'knowledge-answer') {
    const emailRun = kind !== 'knowledge-answer';
    const activeMailbox = overview?.connections.find((connection) => connection.id === connectionId && connection.status === 'connected');
    if (emailRun && (!activeMailbox || !selectedThread)) return toast.error('Select a connected mailbox thread first.');
    if (!emailRun && (!question.trim() || sourceRefs.length < 1)) return toast.error('Ask a question and select at least one saved source.');
    if (draftDirty && !window.confirm('Discard the unsaved changes to this assistant draft?')) return;
    setWorking(kind);
    try {
      const body = kind === 'email-summary' ? { connectionId, threadId: selectedThread?.id }
        : kind === 'email-draft' ? { connectionId, threadId: selectedThread?.id, instructions, tone }
          : { question, sourceRefs };
      const fingerprint = JSON.stringify({ kind, body });
      if (runRequest.current.fingerprint !== fingerprint) runRequest.current = { fingerprint, key: crypto.randomUUID() };
      const result = await api<{ run?: AssistantRun; jobId: string }>(`/api/assistant/runs/${kind}`, {
        ...json('POST', body), headers: { 'idempotency-key': runRequest.current.key }
      });
      runRequest.current = { fingerprint: '', key: '' };
      if (result.run) setSelectedRunId(result.run.id);
      await loadWorkspace(true);
      setTab(kind === 'knowledge-answer' ? 'knowledge' : 'mailbox');
      toast.success('Assistant work queued. It is safe to leave this page.');
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Assistant work could not be queued.'); }
    finally { setWorking(''); }
  }

  async function saveDraft() {
    if (!selectedRun?.draft) return;
    setWorking('save-draft');
    try {
      const result = await api<AssistantRun>(`/api/assistant/runs/${selectedRun.id}/draft`, json('PATCH', {
        subject: draftSubject, body: draftBody, revision: draftRevision
      }));
      if (result.draft) setDraftRevision(result.draft.revision);
      await loadWorkspace(true); toast.success('Draft saved. Nothing was sent.');
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Draft could not be saved.'); }
    finally { setWorking(''); }
  }

  function toggleSource(ref: string) {
    setSourceRefs((current) => current.includes(ref) ? current.filter((item) => item !== ref) : current.length < 12 ? [...current, ref] : current);
  }

  function selectConnection(id: string) {
    if (!connectedConnectionIds.current.has(id)) return;
    activeConnection.current = id;
    threadRequest.current += 1;
    setThreads([]);
    setThreadId('');
    setThreadsConnectionId('');
    setThreadError('');
    setConnectionId(id);
  }

  function selectRun(id: string) {
    if (id === selectedRunId) return;
    if (draftDirty && !window.confirm('Discard the unsaved changes to this assistant draft?')) return;
    setSelectedRunId(id);
  }

  if (loading) return <div className="grid min-h-[55vh] place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  const runtimeReady = overview?.terra?.ready === true;
  const workerBusy = (overview?.worker?.active || 0) + (overview?.worker?.queued || 0);
  const connectedCount = overview?.connections.filter((connection) => connection.status === 'connected').length || 0;

  return <div className="space-y-5">
    <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
      <div><h1 className="text-2xl font-semibold tracking-tight">Personal assistant</h1><p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">Summarise mailbox threads, prepare editable replies, and ask grounded questions across saved Experience intelligence. Every action stays advisory until a person reviews it.</p></div>
      <Button size="sm" variant="outline" onClick={() => { void loadWorkspace(); void loadThreads(); }}><RefreshCw />Refresh</Button>
    </header>

    {error && <div className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="status">{error}</div>}
    {threadError && <div className="flex items-center justify-between gap-3 border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="status"><span>{threadError}</span><Button size="sm" variant="outline" onClick={() => void loadThreads()}>Retry mailbox</Button></div>}
    {oauthNotice && <div className={cn('border px-4 py-3 text-sm', oauthNotice.tone === 'success' ? 'border-emerald-300 bg-emerald-50 text-emerald-950' : oauthNotice.tone === 'warning' ? 'border-amber-300 bg-amber-50 text-amber-950' : 'border-destructive/40 bg-destructive/5 text-destructive')} role="status">{oauthNotice.text}</div>}
    <div className="grid overflow-hidden rounded-lg border bg-card sm:grid-cols-2 lg:grid-cols-4">
      <StatusCell label="Nylas" value={overview?.configured ? `${connectedCount} connected` : 'Setup required'} ready={Boolean(overview?.configured)} />
      <StatusCell label="Terra" value={runtimeReady ? (overview?.terra?.providerLabel || overview?.terra?.model || 'Ready') : 'Unavailable'} ready={runtimeReady} />
      <StatusCell label="Assistant queue" value={workerBusy ? `${workerBusy} active or waiting` : 'Idle'} ready={overview?.worker?.running !== false} />
      <StatusCell label="Control mode" value="Human review required" ready />
    </div>

    {!overview?.configured && <div className="flex gap-3 border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-950"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /><div><div className="font-semibold">Nylas application setup is required</div><p className="mt-1 leading-6">{overview?.configurationError || 'Mailbox connectivity is not configured.'} Mailbox connect and thread actions stay disabled; saved Experience intelligence remains available.</p>{overview?.callbackUrl && <p className="mt-2 font-mono text-xs">Callback: {overview.callbackUrl}</p>}</div></div>}

    <Tabs value={tab} onValueChange={(value) => setTab(value as WorkspaceTab)}>
      <TabsList aria-label="Assistant workspace">
        <TabsTrigger value="mailbox">Mailbox</TabsTrigger>
        <TabsTrigger value="knowledge">Workspace knowledge</TabsTrigger>
        <TabsTrigger value="history">History <span className="ml-1 text-xs text-muted-foreground">{runs.length}</span></TabsTrigger>
      </TabsList>

      <TabsContent value="mailbox">
        <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <MailboxConnections overview={overview} selected={connectionId} setSelected={selectConnection} working={working} connect={connect} disconnect={disconnect} />
            <Card><CardHeader className="border-b"><CardTitle>Recent threads</CardTitle><CardDescription>Only the selected thread is captured in a durable assistant job.</CardDescription></CardHeader><CardContent className="p-0">
              {!connectionId ? <EmptyLine icon={Inbox} text="Connect or select a mailbox." /> : threads.length ? <div className="divide-y">{threads.map((thread) => <button
                key={thread.id} data-testid={`assistant-thread-${thread.id}`} aria-pressed={thread.id === threadId}
                onClick={() => setThreadId(thread.id)}
                className={cn('w-full border-l-2 border-transparent px-4 py-3 text-left transition-colors hover:bg-muted/30', thread.id === threadId && 'border-l-primary bg-muted/50')}
              ><span className="flex items-center justify-between gap-3"><span className="truncate text-sm font-medium">{thread.subject || '(No subject)'}</span><span className="shrink-0 text-[11px] text-muted-foreground">{thread.messageCount}</span></span><span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">{thread.snippet || 'No preview available.'}</span><span className="mt-1 block text-[11px] text-muted-foreground">{formatDateTime(thread.lastMessageAt)}</span></button>)}</div> : <EmptyLine icon={Inbox} text="No recent threads were returned." />}
            </CardContent></Card>
          </aside>

          <div className="min-w-0 space-y-4">
            <Card><CardHeader className="border-b"><div className="flex items-start justify-between gap-4"><div><CardTitle>{selectedThread?.subject || 'Select a mailbox thread'}</CardTitle><CardDescription className="mt-1">{selectedThread ? `${selectedThread.messageCount} messages · ${selectedThread.participants.map(participantLabel).join(', ')}` : 'Choose a thread to create a bounded, immutable job snapshot.'}</CardDescription></div>{selectedThread && <Badge variant="outline">Read only</Badge>}</div></CardHeader>
              <CardContent className="space-y-5 pt-5">
                {selectedThread && <p className="border-l-2 pl-4 text-sm leading-6 text-muted-foreground">{selectedThread.snippet}</p>}
                <div className="grid gap-3 md:grid-cols-2">
                  <button disabled={!selectedThread || working !== ''} onClick={() => void startRun('email-summary')} className="group border bg-background p-4 text-left transition-colors hover:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-50"><MessageSquareText className="h-4 w-4 text-primary" /><div className="mt-3 text-sm font-semibold">Summarise thread</div><p className="mt-1 text-xs leading-5 text-muted-foreground">Extract asks, dates, commitments, risks, and limitations.</p><span className="mt-3 flex items-center text-xs font-medium">Queue summary <ChevronRight className="ml-1 h-3.5 w-3.5" /></span></button>
                  <button disabled={!selectedThread || working !== ''} onClick={() => void startRun('email-draft')} className="group border bg-background p-4 text-left transition-colors hover:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-50"><FilePenLine className="h-4 w-4 text-primary" /><div className="mt-3 text-sm font-semibold">Prepare reply draft</div><p className="mt-1 text-xs leading-5 text-muted-foreground">Generate editable copy without sending or changing the mailbox.</p><span className="mt-3 flex items-center text-xs font-medium">Queue draft <ChevronRight className="ml-1 h-3.5 w-3.5" /></span></button>
                </div>
                <div className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)]"><div><Label htmlFor="assistant-tone">Draft tone</Label><select id="assistant-tone" className="mt-2 h-10 w-full rounded-md border-input bg-background px-3 text-sm" value={tone} onChange={(event) => setTone(event.target.value)}><option value="professional">Professional</option><option value="concise">Concise</option><option value="warm">Warm</option><option value="empathetic">Empathetic</option></select></div><div><Label htmlFor="assistant-instructions">Draft instructions</Label><Input id="assistant-instructions" className="mt-2" value={instructions} maxLength={1000} onChange={(event) => setInstructions(event.target.value)} /></div></div>
              </CardContent>
            </Card>
            {selectedRun && !['assistant.knowledge_answer', 'knowledge_answer'].includes(selectedRun.kind) && <RunDetail run={selectedRun} draftSubject={draftSubject} draftBody={draftBody} setDraftSubject={setDraftSubject} setDraftBody={setDraftBody} saveDraft={saveDraft} saving={working === 'save-draft'} />}
          </div>
        </div>
      </TabsContent>

      <TabsContent value="knowledge">
        <div className="grid gap-5 xl:grid-cols-[390px_minmax(0,1fr)]">
          <Card><CardHeader className="border-b"><CardTitle>Ground the question</CardTitle><CardDescription>Select 1–12 saved survey or social intelligence reports. The selected evidence is snapshotted before queueing.</CardDescription></CardHeader><CardContent className="space-y-4 pt-5"><div><Label htmlFor="assistant-question">Question</Label><Textarea id="assistant-question" className="mt-2 min-h-28" value={question} maxLength={1500} onChange={(event) => setQuestion(event.target.value)} /></div><div className="max-h-[430px] overflow-y-auto border"><SourceGroup title="Survey intelligence" sources={groupedSources.survey} selected={sourceRefs} toggle={toggleSource} /><SourceGroup title="Social intelligence" sources={groupedSources.social} selected={sourceRefs} toggle={toggleSource} /></div><div className="flex items-center justify-between gap-3"><span className="text-xs text-muted-foreground">{sourceRefs.length} selected</span><Button disabled={working !== '' || !question.trim() || sourceRefs.length < 1} onClick={() => void startRun('knowledge-answer')}>{working === 'knowledge-answer' ? <Loader2 className="animate-spin" /> : <BookOpenCheck />}Ask from evidence</Button></div></CardContent></Card>
          <div>{selectedRun && ['assistant.knowledge_answer', 'knowledge_answer'].includes(selectedRun.kind) ? <RunDetail run={selectedRun} draftSubject="" draftBody="" setDraftSubject={() => undefined} setDraftBody={() => undefined} saveDraft={() => undefined} saving={false} /> : <Card><CardContent className="py-20 text-center"><BookOpenCheck className="mx-auto h-6 w-6 text-muted-foreground" /><div className="mt-3 text-sm font-medium">No knowledge answer selected</div><p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">The assistant answers only from the saved sources you select and displays its evidence references.</p></CardContent></Card>}</div>
        </div>
      </TabsContent>

      <TabsContent value="history">
        <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
          <Card><CardHeader className="border-b"><CardTitle>Assistant history</CardTitle><CardDescription>Private to your account within the active space.</CardDescription></CardHeader><CardContent className="p-0">{runs.length ? <div className="divide-y">{runs.map((run) => <button key={run.id} aria-pressed={run.id === selectedRunId} onClick={() => selectRun(run.id)} className={cn('w-full border-l-2 border-transparent px-4 py-3 text-left hover:bg-muted/30', run.id === selectedRunId && 'border-l-primary bg-muted/50')}><span className="flex items-center justify-between gap-3"><span className="text-sm font-medium">{runTitle(run)}</span><RunBadge run={run} /></span><span className="mt-1 block truncate text-xs text-muted-foreground">{run.subjectRef ? `Mailbox thread ${run.subjectRef}` : run.sourceRefs?.length ? `${run.sourceRefs.length} saved evidence source${run.sourceRefs.length === 1 ? '' : 's'}` : 'Saved assistant request'}</span><span className="mt-1 block text-[11px] text-muted-foreground">{formatDateTime(run.createdAt)}</span></button>)}</div> : <EmptyLine icon={MailCheck} text="No assistant work has been queued." />}</CardContent></Card>
          <div>{selectedRun ? <RunDetail run={selectedRun} draftSubject={draftSubject} draftBody={draftBody} setDraftSubject={setDraftSubject} setDraftBody={setDraftBody} saveDraft={saveDraft} saving={working === 'save-draft'} /> : <Card><CardContent className="py-20 text-center text-sm text-muted-foreground">Select a run to inspect its evidence, output, and runtime record.</CardContent></Card>}</div>
        </div>
      </TabsContent>
    </Tabs>
  </div>;
}

function StatusCell({ label, value, ready }: { label: string; value: string; ready: boolean }) {
  return <div className="border-b border-r p-4"><div className="text-xs font-medium text-muted-foreground">{label}</div><div className="mt-2 flex items-center gap-2 text-sm font-semibold"><span className={cn('h-2 w-2 rounded-full', ready ? 'bg-emerald-500' : 'bg-amber-500')} />{value}</div></div>;
}

function MailboxConnections({ overview, selected, setSelected, working, connect, disconnect }: {
  overview: AssistantOverview | null; selected: string; setSelected: (id: string) => void; working: string;
  connect: (provider: 'google' | 'microsoft') => Promise<void>; disconnect: (connection: AssistantConnection) => Promise<void>;
}) {
  return <Card><CardHeader className="border-b"><CardTitle>Mailbox connections</CardTitle><CardDescription>Each person connects their own account. Provider tokens are never shown here.</CardDescription></CardHeader><CardContent className="space-y-4 pt-5">
    {overview?.connections.length ? <div className="space-y-2">{overview.connections.map((connection) => {
      const active = connection.status === 'connected';
      return <div className={cn('border p-3', active && selected === connection.id && 'border-foreground bg-muted/40')} key={connection.id}><button className="flex w-full items-center gap-3 text-left disabled:cursor-not-allowed disabled:opacity-60" disabled={!active} aria-pressed={active && selected === connection.id} onClick={() => setSelected(connection.id)}><ConnectionMark connection={connection} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{connection.displayName || connection.email}</span><span className="block truncate text-xs text-muted-foreground">{connection.email}</span></span><Badge variant={active ? 'success' : 'warning'}>{connection.status}</Badge></button>{active ? <button className="mt-2 text-xs text-muted-foreground hover:text-destructive hover:underline" disabled={working === `disconnect:${connection.id}`} onClick={() => void disconnect(connection)}>Disconnect</button> : <p className="mt-2 text-xs text-muted-foreground">This connection is inactive. Connect the mailbox again to read threads.</p>}</div>;
    })}</div> : <p className="text-sm leading-6 text-muted-foreground">No mailbox is connected to your account in this space.</p>}
    <div className="grid grid-cols-2 gap-2"><Button variant="outline" disabled={!overview?.configured || working !== ''} onClick={() => void connect('google')}>Connect Google</Button><Button variant="outline" disabled={!overview?.configured || working !== ''} onClick={() => void connect('microsoft')}>Connect Microsoft</Button></div>
  </CardContent></Card>;
}

function SourceGroup({ title, sources, selected, toggle }: { title: string; sources: IntelligenceSource[]; selected: string[]; toggle: (ref: string) => void }) {
  return <section className="border-b last:border-b-0"><div className="border-b bg-muted/30 px-3 py-2 text-xs font-semibold">{title}<span className="float-right text-muted-foreground">{sources.length}</span></div>{sources.length ? <div className="divide-y">{sources.map((source) => { const active = selected.includes(source.ref); return <button key={source.ref} aria-pressed={active} onClick={() => toggle(source.ref)} className={cn('flex w-full gap-3 px-3 py-3 text-left hover:bg-muted/30', active && 'bg-muted/50')}><span className="mt-0.5 text-muted-foreground">{active ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}</span><span className="min-w-0"><span className="block text-sm font-medium">{source.title}</span><span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">{source.preview}</span></span></button>; })}</div> : <p className="px-3 py-5 text-xs text-muted-foreground">No saved reports yet.</p>}</section>;
}

function EmptyLine({ icon: Icon, text }: { icon: typeof Inbox; text: string }) {
  return <div className="px-4 py-10 text-center text-sm text-muted-foreground"><Icon className="mx-auto mb-3 h-5 w-5" />{text}</div>;
}

function RunDetail({ run, draftSubject, draftBody, setDraftSubject, setDraftBody, saveDraft, saving }: {
  run: AssistantRun; draftSubject: string; draftBody: string; setDraftSubject: (value: string) => void; setDraftBody: (value: string) => void;
  saveDraft: () => void; saving: boolean;
}) {
  const output = run.output || {};
  const summary = output.summary;
  return <Card data-testid="assistant-run-detail"><CardHeader className="border-b"><div className="flex items-start justify-between gap-3"><div><CardTitle>{runTitle(run)}</CardTitle><CardDescription className="mt-1">Queued {formatDateTime(run.createdAt)} · Advisory output</CardDescription></div><RunBadge run={run} /></div></CardHeader><CardContent className="space-y-5 pt-5">
    {(run.state === 'queued' || run.state === 'processing') && <div className="flex items-center gap-3 border px-4 py-5 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{run.stage?.startsWith('waiting_for_') ? run.stage.replaceAll('_', ' ') : 'Terra is processing this durable request.'}<span className="ml-auto text-xs">{run.progress}%</span></div>}
    {run.error && <div className="border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">{run.error}</div>}
    {['assistant.email_draft', 'email_draft'].includes(run.kind) && run.draft ? <div className="space-y-4"><div className="flex gap-3 border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /><div><div className="font-semibold">Draft only — nothing has been sent</div><p className="mt-1 text-xs leading-5">Review and edit this copy, then use your normal approved mail process when you are ready.</p></div></div><div><Label htmlFor={`draft-subject-${run.id}`}>Subject</Label><Input id={`draft-subject-${run.id}`} className="mt-2" value={draftSubject} maxLength={500} onChange={(event) => setDraftSubject(event.target.value)} /></div><div><Label htmlFor={`draft-body-${run.id}`}>Editable draft</Label><Textarea id={`draft-body-${run.id}`} className="mt-2 min-h-56" value={draftBody} maxLength={12_000} onChange={(event) => setDraftBody(event.target.value)} /></div><div className="flex items-center justify-between gap-3"><span className="text-xs text-muted-foreground">Revision {run.draft.revision} · Original generation is retained for audit.</span><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => { void navigator.clipboard.writeText(`${draftSubject}\n\n${draftBody}`); toast.success('Draft copied.'); }}><Copy />Copy</Button><Button size="sm" disabled={saving || !draftSubject.trim() || !draftBody.trim()} onClick={saveDraft}>{saving ? <Loader2 className="animate-spin" /> : <Save />}Save draft</Button></div></div></div> : <>
      {summary && <section><h3 className="text-sm font-semibold">{['assistant.knowledge_answer', 'knowledge_answer'].includes(run.kind) ? 'Answer' : 'Summary'}</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{summary}</p></section>}
      {['assistant.knowledge_answer', 'knowledge_answer'].includes(run.kind) && output.answer && !summary && <section><h3 className="text-sm font-semibold">Answer</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{output.answer}</p></section>}
      <ResultList title="Key points" values={output.keyPoints} /><ResultList title="Action items" values={output.actionItems} /><ResultList title="Open questions" values={output.openQuestions} />
      {Boolean(output.citations?.length) && <section><h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Evidence</h4><div className="mt-2 divide-y border">{output.citations?.map((citation, index) => <blockquote className="p-4 text-sm leading-6" key={`${citation.sourceRef}-${index}`}><div className="font-medium">{citation.sourceRef}</div><p className="mt-1 text-muted-foreground">“{citation.excerpt}”</p></blockquote>)}</div></section>}
      <ResultList title="Limitations" values={output.limitations || output.caveats} />
    </>}
    <RuntimeFootnote run={run} />
  </CardContent></Card>;
}
