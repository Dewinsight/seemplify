import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, AtSign, BarChart3, Check, CheckSquare, Clipboard, Copy, ExternalLink, FileText, Loader2,
  MessageSquareReply, MessageSquareText, Plus, Radar, RefreshCw, Search, Settings2, Square, Trash2, Users
} from 'lucide-react';
import { toast } from 'sonner';
import { api, json } from '@/lib/api';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type {
  SocialIntelligenceReport, SocialMention, SocialReplyDraft, XConnection, XIntegrationStatus, XListeningQuery, XSyncJob
} from '@/types';

type View = 'listening' | 'queries' | 'intelligence' | 'replies' | 'history' | 'connection';
type Stream = 'all' | 'account_post' | 'mention' | 'search';
type RefreshReason = 'initial' | 'manual' | 'live';
const syncIntervals = [[15, 'Every 15 minutes'], [30, 'Every 30 minutes'], [60, 'Every hour'], [180, 'Every 3 hours'], [360, 'Every 6 hours'], [720, 'Every 12 hours'], [1440, 'Every day']] as const;
const emptyCredentials = { clientId: '', clientSecret: '', bearerToken: '', consumerKey: '', consumerSecret: '' };

function formatDate(value?: string | null) {
  if (!value) return 'Not yet';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
function streamLabel(stream?: string | null) {
  return stream === 'account_post' ? 'Account post' : stream === 'mention' ? 'Mention' : stream === 'search' ? 'Search result' : 'X post';
}
function jobBadge(job?: XSyncJob) {
  if (!job) return <Badge variant="secondary">No sync yet</Badge>;
  if (job.state === 'completed') return <Badge variant="success">Completed</Badge>;
  if (job.state === 'failed') return <Badge variant="destructive">Failed</Badge>;
  if (job.state === 'cancelled') return <Badge variant="secondary">Cancelled</Badge>;
  if (job.state === 'waiting_billing') return <Badge variant="warning">Credits required</Badge>;
  if (job.state === 'waiting_rate_limit') return <Badge variant="warning">Rate-limit wait</Badge>;
  return <Badge variant="warning">{job.state === 'processing' ? 'Syncing' : 'Queued'}</Badge>;
}
function connectionLabel(connection: XConnection) {
  return connection.account?.username ? `@${connection.account.username}` : connection.account?.name || 'Pending account';
}

export function SocialListeningPage() {
  const [status, setStatus] = useState<XIntegrationStatus | null>(null);
  const [mentions, setMentions] = useState<SocialMention[]>([]);
  const [reports, setReports] = useState<SocialIntelligenceReport[]>([]);
  const [replyDrafts, setReplyDrafts] = useState<SocialReplyDraft[]>([]);
  const [loading, setLoading] = useState(true); const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(''); const refreshSequence = useRef(0);
  const selectedConnectionRef = useRef<string | null>(null); const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [view, setView] = useState<View>('listening'); const [stream, setStream] = useState<Stream>('all');
  const [selectedMentions, setSelectedMentions] = useState<string[]>([]);
  const [credentialDialog, setCredentialDialog] = useState(false); const [queryDialog, setQueryDialog] = useState(false);
  const [replyMention, setReplyMention] = useState<SocialMention | null>(null);
  const [editingQuery, setEditingQuery] = useState<XListeningQuery | null>(null); const [working, setWorking] = useState('');
  const [credentials, setCredentials] = useState(emptyCredentials);
  const [queryDraft, setQueryDraft] = useState({ label: '', query: '', enabled: true });
  const [replyForm, setReplyForm] = useState({ tone: 'helpful', instructions: '' });
  const [reportTitle, setReportTitle] = useState('X listening intelligence');
  const [draftEdits, setDraftEdits] = useState<Record<string, string>>({});
  const replyRequest = useRef({ fingerprint: '', key: '' }); const reportRequest = useRef({ fingerprint: '', key: '' });

  const load = useCallback(async (reason: RefreshReason = 'live', requestedConnectionId?: string | null) => {
    const sequence = ++refreshSequence.current; if (reason === 'manual') setRefreshing(true);
    const connectionId = requestedConnectionId === undefined ? selectedConnectionRef.current : requestedConnectionId;
    const connectionQuery = connectionId ? `?connectionId=${encodeURIComponent(connectionId)}` : '';
    const mentionQuery = connectionId ? `?limit=1000&connectionId=${encodeURIComponent(connectionId)}` : '?limit=1000';
    const reportQuery = connectionId ? `?connectionId=${encodeURIComponent(connectionId)}` : '';
    const results = await Promise.allSettled([
      api<XIntegrationStatus>(`/api/integrations/x${connectionQuery}`),
      api<SocialMention[]>(`/api/integrations/x/mentions${mentionQuery}`),
      api<SocialIntelligenceReport[]>(`/api/social/reports${reportQuery}`),
      api<SocialReplyDraft[]>('/api/social/reply-drafts')
    ]);
    if (sequence !== refreshSequence.current) return;
    const [nextStatus, nextMentions, nextReports, nextDrafts] = results;
    if (nextStatus.status === 'fulfilled') {
      setStatus(nextStatus.value);
      selectedConnectionRef.current = nextStatus.value.selectedConnectionId;
      setSelectedConnectionId(nextStatus.value.selectedConnectionId);
    }
    if (nextMentions.status === 'fulfilled') setMentions(nextMentions.value.filter((mention) => mention.source === 'x'));
    if (nextReports.status === 'fulfilled') setReports(nextReports.value);
    if (nextDrafts.status === 'fulfilled') {
      setReplyDrafts(nextDrafts.value);
      setDraftEdits((current) => Object.fromEntries(nextDrafts.value.map((draft) => [draft.id, current[draft.id] ?? draft.content])));
    }
    const failures = results.filter((result) => result.status === 'rejected') as PromiseRejectedResult[];
    setLoadError(failures.map((failure) => failure.reason instanceof Error ? failure.reason.message : 'A live data source could not refresh.').join(' '));
    setLoading(false); setRefreshing(false);
  }, []);

  useEffect(() => { void load('initial'); }, [load]);
  useLiveRefresh(useCallback(() => { void load('live'); }, [load]));
  useEffect(() => {
    const outcome = new URLSearchParams(window.location.search).get('x'); if (!outcome) return;
    if (outcome === 'connected') toast.success('X account connected. It is now available in the account switcher.');
    else if (outcome === 'denied') toast.error('X connection was cancelled.');
    else toast.error('X could not complete the connection. Confirm the exact callback URL and OAuth 2 credentials.');
    window.history.replaceState({}, '', '/social-listening');
  }, []);

  const connection = status?.connection || null;
  const latestSync = status?.syncJobs[0];
  const dispatchingSync = status?.syncJobs.find((job) => ['queued', 'processing', 'waiting_rate_limit'].includes(job.state));
  const visibleReplyDrafts = replyDrafts.filter((draft) => draft.connectionId === selectedConnectionId);
  const visibleMentions = mentions.filter((mention) => stream === 'all' || mention.ingestionKind === stream || mention.metadata?.x?.streams?.includes(stream));
  const selected = new Set(selectedMentions);
  const checkingCredits = status?.app.billing.status === 'checking_credits';
  const billingBlocked = ['credits_depleted', 'checking_credits'].includes(status?.app.billing.status || '') || latestSync?.state === 'waiting_billing';
  const canSync = connection && ['connected', 'pending_verification', 'action_required'].includes(connection.status);
  const activeReports = reports.filter((report) => report.state === 'queued').length;
  const activeDrafts = visibleReplyDrafts.filter((draft) => draft.state === 'queued').length;
  const credentialsChanged = Object.values(credentials).some((value) => value.trim());
  const clientPair = Boolean(credentials.clientId.trim()) === Boolean(credentials.clientSecret.trim());
  const consumerPair = Boolean(credentials.consumerKey.trim()) === Boolean(credentials.consumerSecret.trim());
  const credentialsReady = credentialsChanged && clientPair && consumerPair
    && (Boolean(status?.app.configured) || Boolean(credentials.clientId.trim()) || Boolean(credentials.consumerKey.trim()));

  async function switchConnection(id: string) {
    selectedConnectionRef.current = id; setSelectedConnectionId(id); setSelectedMentions([]); await load('manual', id);
  }
  async function connect() {
    setWorking('connect');
    try { const result = await api<{ authorizeUrl: string }>('/api/integrations/x/connect', { method: 'POST' }); window.location.assign(result.authorizeUrl); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not start X sign-in.'); setWorking(''); }
  }
  async function syncNow() {
    if (!connection) return;
    setWorking('sync');
    try {
      const result = await api<{ created: boolean; resumed?: boolean }>(`/api/integrations/x/connections/${connection.id}/sync`, { method: 'POST' });
      toast.success(result.resumed ? 'Checking X credits and resuming the saved sync.' : result.created ? 'X sync queued.' : 'This account already has a sync waiting or running.');
      await load('manual');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not queue the X sync.'); }
    finally { setWorking(''); }
  }
  async function saveCredentials() {
    if (!clientPair) return toast.error('Enter the OAuth 2 client ID and client secret together.');
    if (!consumerPair) return toast.error('Enter the legacy consumer key and secret together.');
    const body = Object.fromEntries(Object.entries(credentials).filter(([, value]) => value.trim()));
    setWorking('credentials');
    try {
      await api('/api/integrations/x/app', json('PUT', body)); setCredentials(emptyCredentials); setCredentialDialog(false);
      toast.success('X developer credentials encrypted and saved.'); await load('manual');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save X credentials.'); }
    finally { setWorking(''); }
  }
  async function updateConnection(input: { autoSync?: boolean; syncIntervalMinutes?: number }) {
    if (!connection) return; setWorking('settings');
    try { await api(`/api/integrations/x/connections/${connection.id}`, json('PATCH', input)); await load('manual'); toast.success('Sync settings updated.'); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not update X settings.'); }
    finally { setWorking(''); }
  }
  async function disconnect() {
    if (!connection || !window.confirm(`Disconnect ${connectionLabel(connection)}? Its retained posts and reports remain available until you delete history.`)) return;
    setWorking('disconnect');
    try { await api(`/api/integrations/x/connections/${connection.id}`, { method: 'DELETE' }); await load('manual'); toast.success('X account disconnected.'); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not disconnect the X account.'); }
    finally { setWorking(''); }
  }
  async function deleteHistory() {
    if (!connection || !window.confirm(`Permanently delete the retained X posts, reply drafts, social reports, sync audit, and derived combined reports for ${connectionLabel(connection)}?`)) return;
    setWorking('delete-history');
    try { await api(`/api/integrations/x/connections/${connection.id}/history`, { method: 'DELETE' }); await load('manual'); toast.success('Retained X history and derived intelligence deleted.'); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not delete X history.'); }
    finally { setWorking(''); }
  }
  async function removeApp() {
    if (!window.confirm('Remove the shared X developer app and disconnect all authorized accounts?')) return;
    setWorking('remove-app');
    try { await api('/api/integrations/x/app', { method: 'DELETE' }); setCredentialDialog(false); await load('manual', null); toast.success('X developer app removed.'); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not remove the X developer app.'); }
    finally { setWorking(''); }
  }
  function openQuery(query?: XListeningQuery) {
    setEditingQuery(query || null); setQueryDraft(query ? { label: query.label, query: query.query, enabled: query.enabled } : { label: '', query: '', enabled: true }); setQueryDialog(true);
  }
  async function saveQuery() {
    if (!connection) return; setWorking('query');
    try {
      if (editingQuery) await api(`/api/integrations/x/queries/${editingQuery.id}`, json('PATCH', queryDraft));
      else await api(`/api/integrations/x/connections/${connection.id}/queries`, json('POST', queryDraft));
      setQueryDialog(false); await load('manual'); toast.success(editingQuery ? 'Listening query updated.' : 'Listening query added.');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save the listening query.'); }
    finally { setWorking(''); }
  }
  async function deleteQuery(query: XListeningQuery) {
    if (!window.confirm(`Delete “${query.label}”?`)) return;
    try { await api(`/api/integrations/x/queries/${query.id}`, { method: 'DELETE' }); await load('manual'); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not delete the query.'); }
  }
  async function createReplyDraft() {
    if (!replyMention) return; setWorking('reply');
    try {
      const fingerprint = JSON.stringify({ mentionId: replyMention.id, ...replyForm });
      if (replyRequest.current.fingerprint !== fingerprint) replyRequest.current = { fingerprint, key: crypto.randomUUID() };
      await api(`/api/social/mentions/${replyMention.id}/reply-drafts`, { ...json('POST', replyForm), headers: { 'idempotency-key': replyRequest.current.key } });
      replyRequest.current = { fingerprint: '', key: '' };
      setReplyMention(null); setReplyForm({ tone: 'helpful', instructions: '' }); setView('replies'); await load('manual');
      toast.success('Reply draft queued. Terra will never post it automatically.');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not queue the reply draft.'); }
    finally { setWorking(''); }
  }
  async function saveReplyDraft(draft: SocialReplyDraft) {
    const content = draftEdits[draft.id]?.trim(); if (!content) return;
    setWorking(`draft:${draft.id}`);
    try { await api(`/api/social/reply-drafts/${draft.id}`, json('PATCH', { content })); await load('manual'); toast.success('Reply draft saved.'); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save the reply draft.'); }
    finally { setWorking(''); }
  }
  async function createReport() {
    if (!connection) return; setWorking('report');
    try {
      const body = { connectionId: connection.id, title: reportTitle, mentionIds: selectedMentions.length ? selectedMentions : undefined };
      const fingerprint = JSON.stringify(body);
      if (reportRequest.current.fingerprint !== fingerprint) reportRequest.current = { fingerprint, key: crypto.randomUUID() };
      await api('/api/social/reports', { ...json('POST', body), headers: { 'idempotency-key': reportRequest.current.key } });
      reportRequest.current = { fingerprint: '', key: '' };
      setSelectedMentions([]); setView('intelligence'); await load('manual'); toast.success('Historical social-intelligence report queued.');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not queue social intelligence.'); }
    finally { setWorking(''); }
  }
  async function copyText(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); toast.success(`${label} copied.`); }
    catch { toast.error('Clipboard access was unavailable.'); }
  }

  if (!status && loading) return <div className="grid min-h-[55vh] place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (!status) return <Card className="mx-auto mt-12 max-w-xl" role="alert"><CardHeader><CardTitle>X listening could not load</CardTitle><CardDescription>{loadError || 'The connector is unavailable.'}</CardDescription></CardHeader><CardContent><Button variant="outline" onClick={() => void load('manual')}>Try again</Button></CardContent></Card>;

  const tabs: Array<[View, string]> = [
    ['listening', `Listening (${mentions.length})`], ['queries', `Queries (${status.queries.length})`], ['intelligence', `Intelligence (${reports.length})`],
    ['replies', `Reply drafts (${visibleReplyDrafts.length})`], ['history', 'Sync history'], ['connection', 'Connection']
  ];

  return <div className="space-y-5">
    <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
      <div><h1 className="text-2xl font-semibold tracking-tight">Social listening</h1><p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">Connect multiple X accounts, collect posts and mentions, preserve intelligence history, and draft human-reviewed replies.</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={refreshing} onClick={() => void load('manual')}>{refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}Refresh</Button>{canSync && <Button size="sm" disabled={Boolean(dispatchingSync) || working === 'sync'} onClick={() => void syncNow()}>{working === 'sync' || dispatchingSync?.state === 'processing' ? <Loader2 className="animate-spin" /> : <Radar />}{billingBlocked ? 'Check credits and retry' : 'Sync now'}</Button>}<Button size="sm" variant="outline" disabled={!status.app.configured || working === 'connect'} onClick={() => void connect()}>{working === 'connect' ? <Loader2 className="animate-spin" /> : <Plus />}Add X account</Button></div>
    </header>

    {loadError && <div className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="status">Some live data could not refresh. {loadError}</div>}
    {billingBlocked && <div className="flex flex-col justify-between gap-3 border border-amber-300 bg-amber-50 px-4 py-4 text-amber-950 sm:flex-row sm:items-center" role="alert"><div className="flex gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><div><div className="text-sm font-semibold">{checkingCredits ? 'Checking X API credits' : 'X API credits are depleted'}</div><p className="mt-1 text-sm leading-6">{checkingCredits ? 'One saved sync is probing X now. Every other account remains safely queued until the check succeeds.' : 'The account login is valid, but X returns HTTP 402 for posts, mentions, and search. The saved sync will wait here without losing its cursor.'}</p>{latestSync?.error && <p className="mt-1 text-xs">{latestSync.error}</p>}</div></div><a className="text-sm font-semibold underline underline-offset-4" href="https://console.x.com" target="_blank" rel="noreferrer">Open X Developer Console</a></div>}

    <Card>
      <CardHeader className="border-b"><div className="flex flex-col justify-between gap-3 md:flex-row md:items-center"><div><CardTitle>X accounts</CardTitle><CardDescription className="mt-1">Each account authorizes independently through X. Tokens and refresh tokens remain encrypted.</CardDescription></div>{status.canManageAppCredentials && <Button size="sm" variant="outline" onClick={() => setCredentialDialog(true)}><Settings2 />API settings</Button>}</div></CardHeader>
      <CardContent className="p-0">{status.connections.length ? <div className="divide-y">{status.connections.map((item) => <button key={item.id} onClick={() => void switchConnection(item.id)} aria-pressed={selectedConnectionId === item.id} className={`flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors ${selectedConnectionId === item.id ? 'bg-muted/70' : 'hover:bg-muted/30'}`}><span className="flex min-w-0 items-center gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border bg-background text-sm font-semibold">{item.account?.name?.slice(0, 1).toUpperCase() || 'X'}</span><span className="min-w-0"><span className="block truncate text-sm font-semibold">{item.account?.name || 'X account'}</span><span className="block truncate text-xs text-muted-foreground">{connectionLabel(item)} · {item.authType === 'oauth2' ? 'OAuth 2' : 'Legacy OAuth 1'} · {item.counts?.collected || 0} posts</span></span></span><span className="flex items-center gap-3"><Badge variant={item.status === 'connected' ? 'success' : item.status === 'disconnected' ? 'secondary' : 'warning'}>{item.status.replaceAll('_', ' ')}</Badge>{selectedConnectionId === item.id && <Check className="h-4 w-4" />}</span></button>)}</div> : <div className="px-5 py-10"><div className="text-sm font-medium">No X account connected</div><p className="mt-1 text-sm text-muted-foreground">Configure the developer app, then use Add X account to authorize any X identity.</p></div>}</CardContent>
    </Card>

    {connection && <div className="grid grid-cols-2 border sm:grid-cols-3 lg:grid-cols-6">{[
      ['Collected', status.counts.collected], ['Account posts', status.counts.accountPosts], ['Mentions', status.counts.mentions],
      ['Search results', status.counts.searchResults], ['Terra analyzed', status.counts.analyzed], ['Saved reports', reports.length]
    ].map(([label, value]) => <div className="border-b border-r px-4 py-3 last:border-r-0 sm:border-b-0" key={String(label)}><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 text-xl font-semibold tabular-nums">{value}</div></div>)}</div>}

    <nav className="flex overflow-x-auto border-b" aria-label="Social listening sections">{tabs.map(([key, label]) => <button key={key} onClick={() => setView(key)} aria-current={view === key ? 'page' : undefined} className={`shrink-0 border-b-2 px-4 py-3 text-sm font-medium ${view === key ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>{label}</button>)}</nav>

    {!connection && <Card><CardContent className="py-14 text-center"><Users className="mx-auto h-6 w-6 text-muted-foreground" /><div className="mt-3 text-sm font-medium">Connect an account to begin</div><p className="mt-1 text-sm text-muted-foreground">The same X developer app can authorize multiple X identities.</p></CardContent></Card>}

    {connection && view === 'listening' && <Card><CardHeader className="border-b"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><CardTitle>Collected X posts</CardTitle><CardDescription className="mt-1">Select posts for a saved intelligence report, or ask Terra to draft a reply.</CardDescription></div><div className="flex flex-wrap gap-1">{(['all', 'account_post', 'mention', 'search'] as Stream[]).map((key) => <Button key={key} size="sm" variant={stream === key ? 'secondary' : 'ghost'} onClick={() => setStream(key)}>{key === 'all' ? 'All' : streamLabel(key)}</Button>)}</div></div></CardHeader>
      <CardContent className="p-0">{visibleMentions.length ? <div className="divide-y">{visibleMentions.map((mention) => <article className="flex gap-3 p-5" key={mention.id}><button className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground" aria-label={`${selected.has(mention.id) ? 'Deselect' : 'Select'} post by ${mention.author}`} onClick={() => setSelectedMentions((current) => current.includes(mention.id) ? current.filter((id) => id !== mention.id) : [...current, mention.id])}>{selected.has(mention.id) ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}</button><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2 text-xs"><span className="font-semibold text-foreground">{mention.author || 'X user'}</span><Badge variant="outline">{streamLabel(mention.ingestionKind)}</Badge><span className="text-muted-foreground">{formatDate(mention.publishedAt)}</span></div><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{mention.content}</p><div className="mt-3 flex flex-wrap items-center gap-2">{mention.analysis ? <><Badge variant="secondary" className="capitalize">{mention.analysis.sentiment}</Badge>{mention.analysis.themes?.slice(0, 3).map((theme: string) => <Badge variant="outline" key={theme}>{theme}</Badge>)}</> : <Badge variant="warning">Terra analysis queued</Badge>}<Button size="sm" variant="outline" onClick={() => setReplyMention(mention)}><MessageSquareReply />Draft reply</Button><a className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:underline" href={mention.url} target="_blank" rel="noreferrer">Open on X <ExternalLink className="h-3 w-3" /></a></div></div></article>)}</div> : <div className="px-5 py-14 text-center"><MessageSquareText className="mx-auto h-6 w-6 text-muted-foreground" /><div className="mt-3 text-sm font-medium">No X posts collected yet</div><p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{billingBlocked ? 'Add X API credits, then use Check credits and retry.' : 'Run the first sync to collect account posts and mentions.'}</p></div>}</CardContent>
      {mentions.length > 0 && <div className="flex flex-col justify-between gap-3 border-t bg-muted/20 px-5 py-3 sm:flex-row sm:items-center"><span className="text-sm">{selectedMentions.length ? `${selectedMentions.length} selected` : 'No selection uses the latest 200 posts'}</span><div className="flex gap-2"><Input aria-label="Social report title" className="w-64" value={reportTitle} onChange={(event) => setReportTitle(event.target.value)} /><Button size="sm" disabled={working === 'report' || reportTitle.trim().length < 2} onClick={() => void createReport()}>{working === 'report' ? <Loader2 className="animate-spin" /> : <BarChart3 />}Generate report</Button></div></div>}
    </Card>}

    {connection && view === 'queries' && <Card><CardHeader className="border-b"><div className="flex items-start justify-between gap-4"><div><CardTitle>Listening queries</CardTitle><CardDescription className="mt-1">Recent-search queries run for {connectionLabel(connection)} and consume X API credits.</CardDescription></div><Button size="sm" onClick={() => openQuery()}><Plus />Add query</Button></div></CardHeader><CardContent className="p-0">{status.queries.length ? <div className="divide-y">{status.queries.map((query) => <div className="flex flex-col justify-between gap-3 p-5 md:flex-row md:items-center" key={query.id}><div><div className="flex items-center gap-2"><span className="text-sm font-semibold">{query.label}</span><Badge variant={query.enabled ? 'success' : 'secondary'}>{query.enabled ? 'Enabled' : 'Paused'}</Badge></div><code className="mt-1 block break-all text-xs text-muted-foreground">{query.query}</code><div className="mt-2 text-xs text-muted-foreground">Last success: {formatDate(query.lastSuccessAt)}{query.lastError ? ` · ${query.lastError}` : ''}</div></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => openQuery(query)}>Edit</Button><Button size="icon" variant="ghost" aria-label={`Delete ${query.label}`} onClick={() => void deleteQuery(query)}><Trash2 /></Button></div></div>)}</div> : <div className="px-5 py-14 text-center"><Search className="mx-auto h-6 w-6 text-muted-foreground" /><div className="mt-3 text-sm font-medium">No listening queries</div><p className="mt-1 text-sm text-muted-foreground">Account posts and mentions still sync without a public search query.</p></div>}</CardContent></Card>}

    {connection && view === 'intelligence' && <div className="space-y-4"><div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold">Social intelligence history</h2><p className="mt-1 text-sm text-muted-foreground">Each report keeps its exact selected-post snapshot and Terra runtime metadata.</p></div>{activeReports > 0 && <Badge variant="warning">{activeReports} processing</Badge>}</div>{reports.length ? reports.map((report) => <Card key={report.id}><CardHeader className="border-b"><div className="flex items-start justify-between gap-3"><div><CardTitle>{report.title}</CardTitle><CardDescription className="mt-1">{report.mentionIds.length} posts · {formatDate(report.createdAt)}</CardDescription></div><Badge variant={report.state === 'completed' ? 'success' : report.state === 'failed' ? 'destructive' : 'warning'}>{report.state}</Badge></div></CardHeader><CardContent className="space-y-5 pt-5">{report.error && <p className="text-sm text-destructive">{report.error}</p>}{report.result ? <><section><h3 className="text-sm font-semibold">Executive summary</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{report.result.executiveSummary}</p></section>{report.result.themes?.length > 0 && <section><h3 className="text-sm font-semibold">Themes</h3><div className="mt-2 divide-y border">{report.result.themes.map((theme: any) => <div className="p-3" key={theme.name}><div className="text-sm font-medium">{theme.name}</div><p className="mt-1 text-xs leading-5 text-muted-foreground">{theme.sentiment} · {theme.mentions} mentions</p></div>)}</div></section>}{report.result.risks?.length > 0 && <section><h3 className="text-sm font-semibold">Risks</h3><ul className="mt-2 space-y-2 text-sm text-muted-foreground">{report.result.risks.map((risk: any, index: number) => <li className="border-l-2 border-amber-400 pl-3" key={index}>{risk.issue} — {risk.action}</li>)}</ul></section>}</> : <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Waiting for Terra. This report is durable.</div>}</CardContent></Card>) : <Card><CardContent className="py-14 text-center"><FileText className="mx-auto h-6 w-6 text-muted-foreground" /><div className="mt-3 text-sm font-medium">No saved social reports</div><p className="mt-1 text-sm text-muted-foreground">Select collected posts in Listening and generate the first report.</p></CardContent></Card>}</div>}

    {connection && view === 'replies' && <div className="space-y-4"><div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold">Reply assistant</h2><p className="mt-1 text-sm text-muted-foreground">Drafts require human review. Seemplify does not post, like, follow, or message on X.</p></div>{activeDrafts > 0 && <Badge variant="warning">{activeDrafts} generating</Badge>}</div>{visibleReplyDrafts.length ? visibleReplyDrafts.map((draft) => { const mention = mentions.find((item) => item.id === draft.mentionId); return <Card key={draft.id}><CardHeader className="border-b"><div className="flex items-start justify-between"><div><CardTitle>{mention?.author || 'X reply draft'}</CardTitle><CardDescription className="mt-1">{draft.tone} · {formatDate(draft.createdAt)}</CardDescription></div><Badge variant={draft.state === 'failed' ? 'destructive' : draft.state === 'queued' ? 'warning' : 'success'}>{draft.state}</Badge></div></CardHeader><CardContent className="pt-5">{draft.state === 'queued' ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Terra is generating a draft.</div> : draft.state === 'failed' ? <p className="text-sm text-destructive">{draft.error}</p> : <div className="space-y-3"><Label htmlFor={`reply-${draft.id}`}>Editable draft</Label><Textarea id={`reply-${draft.id}`} maxLength={280} value={draftEdits[draft.id] ?? draft.content} onChange={(event) => setDraftEdits((current) => ({ ...current, [draft.id]: event.target.value }))} /><div className="flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-muted-foreground">{(draftEdits[draft.id] ?? draft.content).length}/280 · Draft only — never posted automatically</span><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => void copyText(draftEdits[draft.id] ?? draft.content, 'Reply draft')}><Copy />Copy</Button>{mention?.url && <Button size="sm" variant="outline" asChild><a href={mention.url} target="_blank" rel="noreferrer"><ExternalLink />Open on X</a></Button>}<Button size="sm" disabled={working === `draft:${draft.id}`} onClick={() => void saveReplyDraft(draft)}>{working === `draft:${draft.id}` ? <Loader2 className="animate-spin" /> : <Check />}Save draft</Button></div></div>{draft.rationale && <p className="border-t pt-3 text-xs leading-5 text-muted-foreground">Why Terra suggested this: {draft.rationale}</p>}</div>}</CardContent></Card>; }) : <Card><CardContent className="py-14 text-center"><MessageSquareReply className="mx-auto h-6 w-6 text-muted-foreground" /><div className="mt-3 text-sm font-medium">No reply drafts</div><p className="mt-1 text-sm text-muted-foreground">Choose Draft reply beside a collected X post.</p></CardContent></Card>}</div>}

    {connection && view === 'history' && <Card><CardHeader><CardTitle>Sync history</CardTitle><CardDescription>Durable collection runs, including credit and rate-limit waits.</CardDescription></CardHeader><CardContent className="px-0 pb-0"><div className="overflow-x-auto"><table className="data-table min-w-[900px]"><thead><tr><th>Started</th><th>Account</th><th>Trigger</th><th>Status</th><th>Posts</th><th>Mentions</th><th>Search</th><th>New</th><th>Detail</th></tr></thead><tbody>{status.syncJobs.length ? status.syncJobs.map((job) => <tr key={job.id}><td className="whitespace-nowrap text-xs">{formatDate(job.startedAt || job.createdAt)}</td><td>{connectionLabel(connection)}</td><td className="capitalize">{job.trigger}</td><td>{jobBadge(job)}</td><td>{job.postsFetched}</td><td>{job.mentionsFetched}</td><td>{job.searchFetched}</td><td>{job.importedCount}</td><td className="max-w-sm text-xs text-muted-foreground">{job.error || job.stage.replaceAll('_', ' ')}{job.runAfter ? ` · resumes ${formatDate(job.runAfter)}` : ''}</td></tr>) : <tr><td colSpan={9} className="py-14 text-center text-sm text-muted-foreground">No sync history for this account.</td></tr>}</tbody></table></div></CardContent></Card>}

    {connection && view === 'connection' && <Card><CardHeader className="border-b"><CardTitle>Connection settings</CardTitle><CardDescription>{connectionLabel(connection)} has independent scheduling, cursors, history, and OAuth access.</CardDescription></CardHeader><CardContent className="space-y-6 pt-5"><div className="grid max-w-2xl gap-4 sm:grid-cols-2"><div><Label htmlFor="sync-frequency">Sync frequency</Label><select id="sync-frequency" value={connection.syncIntervalMinutes} onChange={(event) => void updateConnection({ syncIntervalMinutes: Number(event.target.value) })} disabled={working === 'settings'} className="mt-2 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">{syncIntervals.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div><label className="flex items-center justify-between gap-4 border px-4 py-3"><span><span className="block text-sm font-medium">Automatic sync</span><span className="mt-0.5 block text-xs text-muted-foreground">Next: {connection.autoSync ? formatDate(connection.nextSyncAt) : 'Disabled'}</span></span><input type="checkbox" className="h-4 w-4" disabled={working === 'settings' || connection.status !== 'connected'} checked={connection.autoSync} onChange={(event) => void updateConnection({ autoSync: event.target.checked })} /></label></div><div className="border-t pt-5"><div className="text-sm font-semibold">Authorization</div><p className="mt-1 text-sm text-muted-foreground">{connection.authType === 'oauth2' ? `OAuth 2 PKCE · scopes: ${connection.scopes.join(', ') || 'read access'} · token refreshes securely` : 'Legacy OAuth 1 connection. Reconnect after OAuth 2 configuration to receive scoped refreshable access.'}</p>{connection.status === 'disconnected' ? <Button className="mt-4" onClick={() => void connect()}><AtSign />Reconnect through X</Button> : <Button className="mt-4" variant="outline" disabled={working === 'disconnect'} onClick={() => void disconnect()}>{working === 'disconnect' ? <Loader2 className="animate-spin" /> : <Trash2 />}Disconnect account</Button>}</div><div className="border-t pt-5"><div className="text-sm font-semibold">Retained history</div><p className="mt-1 text-sm text-muted-foreground">Deleting removes collected posts unique to this account, reply drafts, social reports, dependent combined reports, and sync audit records.</p><Button className="mt-4" variant="destructive" disabled={working === 'delete-history'} onClick={() => void deleteHistory()}>{working === 'delete-history' ? <Loader2 className="animate-spin" /> : <Trash2 />}Delete X history</Button></div></CardContent></Card>}

    <Dialog open={credentialDialog} onOpenChange={(open) => { if (!working) setCredentialDialog(open); }}><DialogContent className="max-h-[88vh] overflow-y-auto"><DialogHeader><DialogTitle>X developer app</DialogTitle><DialogDescription>OAuth 2 lets any user authorize multiple accounts. Secrets are encrypted before storage and are never returned.</DialogDescription></DialogHeader><div className="space-y-4"><div className="border bg-muted/20 p-3"><div className="text-xs font-semibold">Callback URL</div><div className="mt-2 flex items-center gap-2"><code className="min-w-0 flex-1 select-all break-all text-xs">{status.callbackUrl}</code><Button variant="outline" size="icon" onClick={() => void copyText(status.callbackUrl, 'Callback URL')} aria-label="Copy callback URL"><Clipboard /></Button></div></div><div><Label htmlFor="x-client-id">OAuth 2 client ID</Label><Input id="x-client-id" type="password" autoComplete="off" value={credentials.clientId} onChange={(event) => setCredentials((current) => ({ ...current, clientId: event.target.value }))} placeholder={status.app.oauth2Configured ? 'Configured — leave blank to keep' : 'Required for Connect with X'} /></div><div><Label htmlFor="x-client-secret">OAuth 2 client secret</Label><Input id="x-client-secret" type="password" autoComplete="off" value={credentials.clientSecret} onChange={(event) => setCredentials((current) => ({ ...current, clientSecret: event.target.value }))} placeholder={status.app.oauth2Configured ? 'Configured — leave blank to keep' : 'Required for Connect with X'} /></div><div><Label htmlFor="x-bearer">Bearer token</Label><Input id="x-bearer" type="password" autoComplete="off" value={credentials.bearerToken} onChange={(event) => setCredentials((current) => ({ ...current, bearerToken: event.target.value }))} placeholder={status.app.bearerTokenConfigured ? 'Configured — leave blank to keep' : 'Optional app-only search token'} /></div><details className="border p-3"><summary className="cursor-pointer text-sm font-medium">Legacy OAuth 1 credentials</summary><div className="mt-4 space-y-4"><div><Label htmlFor="x-consumer-key">Consumer key</Label><Input id="x-consumer-key" type="password" value={credentials.consumerKey} onChange={(event) => setCredentials((current) => ({ ...current, consumerKey: event.target.value }))} placeholder={status.app.consumerCredentialsConfigured ? 'Configured — leave blank to keep' : 'Optional legacy support'} /></div><div><Label htmlFor="x-consumer-secret">Consumer key secret</Label><Input id="x-consumer-secret" type="password" value={credentials.consumerSecret} onChange={(event) => setCredentials((current) => ({ ...current, consumerSecret: event.target.value }))} placeholder={status.app.consumerCredentialsConfigured ? 'Configured — leave blank to keep' : 'Optional legacy support'} /></div></div></details>{status.app.configured && <div className="border-t pt-4"><div className="text-sm font-semibold">Remove integration</div><p className="mt-1 text-xs text-muted-foreground">Disconnects every X account and removes the shared developer credentials.</p><Button className="mt-3" variant="destructive" size="sm" disabled={Boolean(working)} onClick={() => void removeApp()}><Trash2 />Remove X developer app</Button></div>}</div><DialogFooter><Button variant="outline" onClick={() => setCredentialDialog(false)} disabled={Boolean(working)}>Cancel</Button><Button onClick={() => void saveCredentials()} disabled={Boolean(working) || !credentialsReady}>{working === 'credentials' ? <Loader2 className="animate-spin" /> : <Check />}Save securely</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={queryDialog} onOpenChange={setQueryDialog}><DialogContent><DialogHeader><DialogTitle>{editingQuery ? 'Edit listening query' : 'Add listening query'}</DialogTitle><DialogDescription>Recent-search syntax for {connection ? connectionLabel(connection) : 'the selected account'}.</DialogDescription></DialogHeader><div className="space-y-4"><div><Label htmlFor="query-label">Name</Label><Input id="query-label" value={queryDraft.label} onChange={(event) => setQueryDraft((current) => ({ ...current, label: event.target.value }))} placeholder="Brand mentions" /></div><div><Label htmlFor="query-value">X query</Label><Input id="query-value" value={queryDraft.query} onChange={(event) => setQueryDraft((current) => ({ ...current, query: event.target.value }))} placeholder={'"Seemplify" -is:retweet'} /><p className="mt-1 text-xs text-muted-foreground">Up to 512 characters. Recent search currently covers seven days.</p></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={queryDraft.enabled} onChange={(event) => setQueryDraft((current) => ({ ...current, enabled: event.target.checked }))} />Run during sync</label></div><DialogFooter><Button variant="outline" onClick={() => setQueryDialog(false)}>Cancel</Button><Button onClick={() => void saveQuery()} disabled={working === 'query' || queryDraft.label.trim().length < 2 || queryDraft.query.trim().length < 2}>{working === 'query' ? <Loader2 className="animate-spin" /> : <Check />}{editingQuery ? 'Save changes' : 'Add query'}</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={Boolean(replyMention)} onOpenChange={(open) => { if (!open && working !== 'reply') setReplyMention(null); }}><DialogContent><DialogHeader><DialogTitle>Draft a reply with Terra</DialogTitle><DialogDescription>Creates an editable suggestion only. Nothing is posted to X.</DialogDescription></DialogHeader>{replyMention && <div className="space-y-4"><div className="border bg-muted/20 p-3"><div className="text-xs font-semibold">{replyMention.author}</div><p className="mt-1 line-clamp-5 text-sm leading-6">{replyMention.content}</p></div><div><Label htmlFor="reply-tone">Tone</Label><select id="reply-tone" className="mt-2 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={replyForm.tone} onChange={(event) => setReplyForm((current) => ({ ...current, tone: event.target.value }))}><option value="helpful">Helpful</option><option value="empathetic">Empathetic</option><option value="concise">Concise</option><option value="professional">Professional</option><option value="warm">Warm</option></select></div><div><Label htmlFor="reply-guidance">Optional guidance</Label><Textarea id="reply-guidance" value={replyForm.instructions} onChange={(event) => setReplyForm((current) => ({ ...current, instructions: event.target.value }))} maxLength={1000} placeholder="What should the reply acknowledge or avoid?" /></div><div className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-950">Draft only — no posting permission is requested and no automatic response is sent.</div></div>}<DialogFooter><Button variant="outline" onClick={() => setReplyMention(null)} disabled={working === 'reply'}>Cancel</Button><Button onClick={() => void createReplyDraft()} disabled={working === 'reply'}>{working === 'reply' ? <Loader2 className="animate-spin" /> : <MessageSquareReply />}Generate draft</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
