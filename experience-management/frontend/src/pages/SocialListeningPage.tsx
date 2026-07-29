import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AtSign, Check, Clipboard, ExternalLink, Loader2, MessageSquareText, Plus, Radar, RefreshCw, Search, Settings2, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, json } from '@/lib/api';
import { Link } from '@/lib/router';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { AiJob, SocialMention, XIntegrationStatus, XListeningQuery, XSyncJob } from '@/types';

type View = 'listening' | 'queries' | 'history' | 'connection';
type Stream = 'all' | 'account_post' | 'mention' | 'search';
type RefreshReason = 'initial' | 'manual' | 'live';
type LoadErrors = Partial<Record<'status' | 'mentions' | 'jobs', string>>;
const syncIntervals = [[15, 'Every 15 minutes'], [30, 'Every 30 minutes'], [60, 'Every hour'], [180, 'Every 3 hours'], [360, 'Every 6 hours'], [720, 'Every 12 hours'], [1440, 'Every day']] as const;
const emptyCredentials = { consumerKey: '', consumerSecret: '', bearerToken: '', accessToken: '', accessTokenSecret: '' };

function errorMessage(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}

function formatDate(value?: string | null) {
  if (!value) return 'Not yet';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
function streamLabel(stream?: string | null) {
  return stream === 'account_post' ? 'Account post' : stream === 'mention' ? 'Mention' : stream === 'search' ? 'Search result' : 'X post';
}
function jobBadge(job?: XSyncJob) {
  if (!job) return <Badge variant="secondary">No sync yet</Badge>;
  if (job.state === 'completed') return <Badge variant="success">Last sync completed</Badge>;
  if (job.state === 'failed') return <Badge variant="destructive">Sync failed</Badge>;
  if (job.state === 'cancelled') return <Badge variant="secondary">Cancelled</Badge>;
  if (job.state === 'waiting_rate_limit') return <Badge variant="warning">Waiting for X rate limit</Badge>;
  return <Badge variant="warning">{job.state === 'processing' ? 'Syncing now' : 'Sync queued'}</Badge>;
}

export function SocialListeningPage() {
  const [status, setStatus] = useState<XIntegrationStatus | null>(null);
  const [mentions, setMentions] = useState<SocialMention[]>([]);
  const [jobs, setJobs] = useState<AiJob[]>([]);
  const [loading, setLoading] = useState(true); const [refreshing, setRefreshing] = useState(false);
  const [loadErrors, setLoadErrors] = useState<LoadErrors>({}); const refreshSequence = useRef(0);
  const [view, setView] = useState<View>('listening'); const [stream, setStream] = useState<Stream>('all');
  const [credentialDialog, setCredentialDialog] = useState(false); const [queryDialog, setQueryDialog] = useState(false);
  const [editingQuery, setEditingQuery] = useState<XListeningQuery | null>(null); const [working, setWorking] = useState('');
  const [credentials, setCredentials] = useState(emptyCredentials);
  const [queryDraft, setQueryDraft] = useState({ label: '', query: '', enabled: true });

  const load = useCallback(async (reason: RefreshReason = 'live') => {
    const sequence = ++refreshSequence.current;
    if (reason === 'manual') setRefreshing(true);
    const [nextStatus, nextMentions, nextJobs] = await Promise.allSettled([
      api<XIntegrationStatus>('/api/integrations/x'), api<SocialMention[]>('/api/integrations/x/mentions?limit=1000'), api<AiJob[]>('/api/ai/jobs?limit=500')
    ]);
    if (sequence !== refreshSequence.current) return;
    const errors: LoadErrors = {};
    if (nextStatus.status === 'fulfilled') setStatus(nextStatus.value);
    else errors.status = errorMessage(nextStatus.reason, 'Could not load the X connection.');
    if (nextMentions.status === 'fulfilled') setMentions(nextMentions.value.filter((mention) => mention.source === 'x'));
    else errors.mentions = errorMessage(nextMentions.reason, 'Could not refresh collected posts.');
    if (nextJobs.status === 'fulfilled') setJobs(nextJobs.value);
    else errors.jobs = errorMessage(nextJobs.reason, 'Could not refresh Terra analysis jobs.');
    setLoadErrors(errors); setLoading(false); setRefreshing(false);
  }, []);
  useEffect(() => { void load('initial'); }, [load]);
  const liveRefresh = useCallback(() => { void load('live'); }, [load]);
  useLiveRefresh(liveRefresh);
  useEffect(() => {
    const outcome = new URLSearchParams(window.location.search).get('x'); if (!outcome) return;
    if (outcome === 'connected') toast.success('X account connected. You can synchronise it now.');
    else if (outcome === 'denied') toast.error('X connection was cancelled.');
    else toast.error('X could not complete the connection. Check the app callback and credentials, then try again.');
    window.history.replaceState({}, '', '/social-listening');
  }, []);

  const latestSync = status?.syncJobs[0];
  const activeSync = status?.syncJobs.find((job) => ['queued', 'processing', 'waiting_rate_limit'].includes(job.state));
  const socialJobs = useMemo(() => { const syncIds = new Set(status?.syncJobs.map((job) => job.id) || []); return jobs.filter((job) => job.kind === 'social.analyze' && syncIds.has(String(job.input?.xSyncJobId || ''))); }, [jobs, status?.syncJobs]);
  const activeAiJobs = socialJobs.filter((job) => job.state === 'queued' || job.state === 'processing');
  const latestAnalysis = status?.counts.collected ? socialJobs.find((job) => job.state === 'completed')?.result?.output : undefined;
  const visibleMentions = mentions.filter((mention) => stream === 'all' || mention.ingestionKind === stream || mention.metadata?.x?.streams?.includes(stream));
  const hasConsumerKey = Boolean(credentials.consumerKey.trim()); const hasConsumerSecret = Boolean(credentials.consumerSecret.trim());
  const hasAccessToken = Boolean(credentials.accessToken.trim()); const hasAccessTokenSecret = Boolean(credentials.accessTokenSecret.trim());
  const credentialsChanged = Object.values(credentials).some((value) => Boolean(value.trim()));
  const credentialPairsValid = hasConsumerKey === hasConsumerSecret && hasAccessToken === hasAccessTokenSecret;
  const credentialsReadyToSave = credentialsChanged && credentialPairsValid && (Boolean(status?.app.configured) || hasConsumerKey);

  async function saveCredentials() {
    const body = Object.fromEntries(Object.entries(credentials).filter(([, value]) => value.trim()));
    if (!credentialsChanged) return toast.error('Enter at least one credential to update.');
    if (hasConsumerKey !== hasConsumerSecret) return toast.error('Enter the consumer key and consumer secret together.');
    if (hasAccessToken !== hasAccessTokenSecret) return toast.error('Enter the access token and access-token secret together.');
    if (!status?.app.configured && (!credentials.consumerKey.trim() || !credentials.consumerSecret.trim())) return toast.error('Enter the consumer key and consumer secret.');
    if (status?.app.configured && hasConsumerKey && !window.confirm('Changing the shared consumer key and secret requires every connected X account to reconnect. Continue?')) return;
    setWorking('credentials');
    try {
      await api('/api/integrations/x/app', json('PUT', body));
      setCredentials(emptyCredentials);
      setCredentialDialog(false); toast.success('X API credentials saved securely.'); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save X credentials.'); }
    finally { setWorking(''); }
  }
  function setCredentialDialogOpen(open: boolean) {
    if (!open && (working === 'credentials' || working === 'remove-app')) return;
    setCredentialDialog(open);
    if (!open) setCredentials(emptyCredentials);
  }
  async function removeXConfiguration() {
    if (!window.confirm('Remove the shared X developer app? This disconnects every X account and removes their listening queries, sync history, and account-to-post links. Collected post records remain subject to workspace retention.')) return;
    setWorking('remove-app');
    try {
      await api('/api/integrations/x/app', { method: 'DELETE' });
      setCredentials(emptyCredentials); setCredentialDialog(false); await load();
      toast.success('X developer app credentials removed.');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not remove the X developer app.'); }
    finally { setWorking(''); }
  }
  async function connect() {
    setWorking('connect');
    try { const result = await api<{ authorizeUrl: string }>('/api/integrations/x/connect', { method: 'POST' }); window.location.assign(result.authorizeUrl); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not start X sign-in.'); setWorking(''); }
  }
  async function syncNow() {
    setWorking('sync');
    try {
      const result = await api<{ created: boolean }>('/api/integrations/x/sync', { method: 'POST' });
      toast.success(result.created ? 'X sync queued.' : 'An X sync is already waiting or running.'); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not queue an X sync.'); }
    finally { setWorking(''); }
  }
  async function updateConnection(input: { autoSync?: boolean; syncIntervalMinutes?: number }) {
    setWorking('settings');
    try { await api('/api/integrations/x/connection', json('PATCH', input)); await load(); toast.success('X sync settings updated.'); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not update X settings.'); }
    finally { setWorking(''); }
  }
  async function disconnect() {
    if (!window.confirm('Disconnect this X account? OAuth access will be removed and automatic sync will stop. Collected posts, listening queries, and sync history stay available until you delete them.')) return;
    setWorking('disconnect');
    try { await api('/api/integrations/x/connection', { method: 'DELETE' }); await load(); toast.success('X account disconnected.'); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not disconnect X.'); }
    finally { setWorking(''); }
  }
  async function deleteHistory() {
    if (!window.confirm('Permanently delete this account’s X history? This removes its post links, unshared post records, sync audit history, and Terra analyses, and turns off automatic sync. A later manual sync can collect public posts again. This cannot be undone.')) return;
    setWorking('delete-history');
    try {
      const result = await api<{ unlinked: number; deleted: number; deletedAnalysisJobs: number }>('/api/integrations/x/history', { method: 'DELETE' });
      await load(); toast.success(`${result.deleted} post record${result.deleted === 1 ? '' : 's'} and ${result.deletedAnalysisJobs} Terra analysis job${result.deletedAnalysisJobs === 1 ? '' : 's'} deleted.`);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not delete collected X history.'); }
    finally { setWorking(''); }
  }
  function openQuery(query?: XListeningQuery) {
    setEditingQuery(query || null); setQueryDraft(query ? { label: query.label, query: query.query, enabled: query.enabled } : { label: '', query: '', enabled: true }); setQueryDialog(true);
  }
  async function saveQuery() {
    setWorking('query');
    try {
      if (editingQuery) await api(`/api/integrations/x/queries/${editingQuery.id}`, json('PATCH', queryDraft));
      else await api('/api/integrations/x/queries', json('POST', queryDraft));
      setQueryDialog(false); toast.success(editingQuery ? 'Listening query updated.' : 'Listening query added.'); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save the query.'); }
    finally { setWorking(''); }
  }
  async function removeQuery(query: XListeningQuery) {
    if (!window.confirm(`Delete “${query.label}”?`)) return;
    try { await api(`/api/integrations/x/queries/${query.id}`, { method: 'DELETE' }); await load(); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not delete the query.'); }
  }
  async function copyCallback() {
    if (!status) return;
    try { await navigator.clipboard.writeText(status.callbackUrl); toast.success('Callback URL copied.'); }
    catch { toast.error('Could not access the clipboard. Select and copy the callback URL manually.'); }
  }

  if (!status && loading) return <div className="grid min-h-[55vh] place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (!status) return <Card className="mx-auto mt-12 max-w-xl" role="alert"><CardHeader><CardTitle>X listening could not load</CardTitle><CardDescription>{loadErrors.status || 'The connection status is currently unavailable. Existing posts and jobs were left unchanged.'}</CardDescription></CardHeader><CardContent><Button variant="outline" disabled={refreshing} onClick={() => void load('manual')}>{refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}Try again</Button></CardContent></Card>;
  const connected = Boolean(status.connection);
  const disconnected = status.connection?.status === 'disconnected';
  const requiresReconnect = disconnected || status.connection?.status === 'reauthorization_required';
  const scheduleUnavailable = status.connection?.status !== 'connected';
  const partialLoadError = loadErrors.status || loadErrors.mentions || loadErrors.jobs;

  return <div className="space-y-6">
    <header className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
      <div><h1 className="page-title">Social listening</h1><p className="page-description">Connect X, collect account posts and mentions, monitor saved searches, and let Terra classify the resulting evidence.</p></div>
      <div className="flex flex-wrap items-center gap-2"><Button variant="outline" size="sm" disabled={refreshing} onClick={() => void load('manual')}>{refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}{refreshing ? 'Refreshing' : 'Refresh'}</Button>{connected && !requiresReconnect && <Button size="sm" disabled={Boolean(activeSync) || working === 'sync'} onClick={() => void syncNow()}>{working === 'sync' || activeSync?.state === 'processing' ? <Loader2 className="animate-spin" /> : <Radar />}Sync now</Button>}</div>
    </header>

    {partialLoadError && <div className="flex flex-col justify-between gap-2 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center" role="status"><span>Some live data could not refresh. The last successful posts and Terra status remain visible. {partialLoadError}</span><Button variant="outline" size="sm" disabled={refreshing} onClick={() => void load('manual')}>Retry</Button></div>}

    <Card>
      <CardHeader className="border-b"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><div className="flex items-center gap-2"><div className="grid h-8 w-8 place-items-center rounded-md bg-foreground text-sm font-bold text-background">X</div><CardTitle>X connection</CardTitle>{connected ? <Badge variant={status.connection?.status === 'connected' ? 'success' : 'warning'}>{status.connection?.status.replaceAll('_', ' ')}</Badge> : status.app.configured ? <Badge variant="warning">Account not connected</Badge> : <Badge variant="secondary">Setup required</Badge>}</div><CardDescription className="mt-2">Read-only access. Seemplify never posts, likes, follows, or sends messages on your behalf.</CardDescription></div><div className="flex flex-wrap gap-2">{status.canManageAppCredentials && <Button variant="outline" size="sm" onClick={() => setCredentialDialogOpen(true)}><Settings2 />{status.app.configured ? 'API settings' : 'Configure X API'}</Button>}{status.app.configured && (!connected || requiresReconnect) && <Button size="sm" onClick={() => void connect()} disabled={working === 'connect'}>{working === 'connect' ? <Loader2 className="animate-spin" /> : <AtSign />}{requiresReconnect ? 'Reconnect with X' : 'Connect with X'}</Button>}</div></div></CardHeader>
      <CardContent className="p-0">
        {connected ? <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-full border bg-muted text-sm font-semibold">{status.connection?.account?.name?.slice(0, 1).toUpperCase() || 'X'}</div><div><div className="text-sm font-semibold">{status.connection?.account?.name || (disconnected ? 'Disconnected X account' : 'Connected X account pending verification')}</div>{status.connection?.account?.username ? <a className="text-xs text-muted-foreground hover:text-foreground hover:underline" href={`https://x.com/${status.connection.account.username}`} target="_blank" rel="noreferrer">@{status.connection.account.username} <ExternalLink className="inline h-3 w-3" /></a> : <span className="text-xs text-muted-foreground">{requiresReconnect ? 'Reconnect this account before synchronising.' : 'Run a sync to verify the token owner.'}</span>}</div></div><div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground" aria-live="polite">{jobBadge(latestSync)}<span>Last success: <strong className="font-medium text-foreground">{formatDate(status.connection?.lastSuccessAt)}</strong></span>{activeSync && <span>{activeSync.stage.replaceAll('_', ' ')} · {activeSync.progress}%</span>}</div></div> : <div className="p-5"><div className="max-w-2xl text-sm font-medium">{status.app.configured ? 'The X developer app is ready.' : 'Add the X developer app credentials to begin.'}</div><p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{status.app.configured ? 'Connect an account through X’s authorization screen. Each workspace user authorizes their own account; access tokens stay encrypted on this machine.' : 'The workspace owner configures one read-only X app. Team members can then connect their own X accounts without seeing the app secrets.'}</p></div>}
        {status.connection?.lastError && <div className="border-t border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900" role="alert">{status.connection.lastError}</div>}
        {disconnected && <div className="flex flex-col justify-between gap-3 border-t bg-muted/30 px-5 py-4 sm:flex-row sm:items-center"><div><div className="text-sm font-semibold">OAuth access is off</div><p className="mt-1 text-xs leading-5 text-muted-foreground">{status.counts.collected} collected post{status.counts.collected === 1 ? '' : 's'} remain available for audit. Reconnect to resume collection, or permanently delete retained posts, sync audit records, and derived Terra analyses.</p></div><Button variant="outline" size="sm" disabled={(!status.counts.collected && !status.syncJobs.length) || working === 'delete-history'} onClick={() => void deleteHistory()}>{working === 'delete-history' ? <Loader2 className="animate-spin" /> : <Trash2 />}Delete history</Button></div>}
      </CardContent>
    </Card>

    {connected && <>
      <div className="grid overflow-hidden border bg-card sm:grid-cols-5">{[
        ['Collected', status.counts.collected], ['Account posts', status.counts.accountPosts], ['Mentions', status.counts.mentions], ['Search results', status.counts.searchResults], ['Terra analyzed', status.counts.analyzed]
      ].map(([label, value]) => <div className="border-b border-r px-4 py-3" key={label}><div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-1 text-xl font-semibold tabular-nums">{value}</div></div>)}</div>

      <nav className="flex gap-6 overflow-x-auto border-b" aria-label="Social listening views">{([
        ['listening', 'Listening'], ['queries', `Queries (${status.queries.length})`], ['history', 'Sync history'], ['connection', 'Connection']
      ] as const).map(([key, label]) => <button key={key} aria-pressed={view === key} onClick={() => setView(key)} className={`whitespace-nowrap border-b-2 px-1 pb-3 text-sm font-medium ${view === key ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>{label}</button>)}</nav>

      {view === 'listening' && <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card><CardHeader className="border-b"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><CardTitle>Collected X posts</CardTitle><CardDescription className="mt-1">The latest account posts, mentions, and matching search results.</CardDescription></div><div className="flex flex-wrap gap-1">{(['all', 'account_post', 'mention', 'search'] as Stream[]).map((key) => <Button key={key} size="sm" aria-pressed={stream === key} variant={stream === key ? 'secondary' : 'ghost'} onClick={() => setStream(key)}>{key === 'all' ? 'All' : streamLabel(key)}</Button>)}</div></div></CardHeader><CardContent className="p-0">{visibleMentions.length ? <div className="divide-y">{visibleMentions.map((mention) => <article className="p-5" key={mention.id}><div className="flex items-start justify-between gap-4"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2 text-xs"><span className="font-semibold text-foreground">{mention.author || 'X user'}</span><Badge variant="outline">{streamLabel(mention.ingestionKind)}</Badge><span className="text-muted-foreground">{formatDate(mention.publishedAt)}</span></div><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{mention.content}</p><div className="mt-3 flex flex-wrap items-center gap-2">{mention.analysis ? <><Badge variant="secondary" className="capitalize">{mention.analysis.sentiment}</Badge>{mention.analysis.risk && <Badge variant={['high', 'critical'].includes(mention.analysis.risk) ? 'destructive' : 'outline'}>{mention.analysis.risk} risk</Badge>}{mention.analysis.themes?.slice(0, 3).map((theme: string) => <Badge variant="outline" key={theme}>{theme}</Badge>)}</> : <Badge variant="warning">Terra queued</Badge>}</div></div><a href={mention.url} target="_blank" rel="noreferrer" aria-label="Open post on X" className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"><ExternalLink className="h-4 w-4" /></a></div></article>)}</div> : <div className="px-5 py-16 text-center"><MessageSquareText className="mx-auto h-6 w-6 text-muted-foreground" /><div className="mt-3 text-sm font-medium">{disconnected ? 'No retained X post history' : 'No X posts collected yet'}</div><p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{disconnected ? 'Reconnect this account to resume collecting posts and mentions.' : 'Run the first sync. Account posts and mentions are collected even without a search query.'}</p></div>}</CardContent></Card>
        <Card><CardHeader><CardTitle>Terra intelligence</CardTitle><CardDescription>{activeAiJobs.length ? `${activeAiJobs.length} analysis job${activeAiJobs.length === 1 ? '' : 's'} in the durable queue.` : 'Latest completed analysis of newly collected X evidence.'}</CardDescription></CardHeader><CardContent>{latestAnalysis ? <div className="space-y-5"><p className="text-sm leading-6">{latestAnalysis.executiveSummary}</p><div><div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Leading themes</div><div className="mt-2 space-y-2">{latestAnalysis.themes?.slice(0, 5).map((theme: any) => <div className="flex justify-between gap-3 border-b py-2 text-sm" key={theme.name}><span>{theme.name}</span><span className="text-xs text-muted-foreground">{theme.mentions}</span></div>)}</div></div></div> : <div className="py-8 text-center text-sm text-muted-foreground">Terra analysis will appear after the first sync.</div>}</CardContent></Card>
      </div>}

      {view === 'queries' && <Card><CardHeader className="border-b"><div className="flex items-start justify-between gap-4"><div><CardTitle>Listening queries</CardTitle><CardDescription className="mt-1">Monitor public posts matching X recent-search syntax. Queries use API credits and run with each sync.</CardDescription></div><Button size="sm" onClick={() => openQuery()}><Plus />Add query</Button></div></CardHeader><CardContent className="p-0">{status.queries.length ? <div className="divide-y">{status.queries.map((query) => <div className="flex flex-col gap-3 p-5 md:flex-row md:items-center md:justify-between" key={query.id}><div className="min-w-0"><div className="flex items-center gap-2"><span className="text-sm font-semibold">{query.label}</span><Badge variant={query.enabled ? 'success' : 'secondary'}>{query.enabled ? 'Enabled' : 'Paused'}</Badge></div><code className="mt-1 block break-all text-xs text-muted-foreground">{query.query}</code><div className="mt-2 text-xs text-muted-foreground">Last success: {formatDate(query.lastSuccessAt)}{query.lastError && <span className="ml-2 text-amber-700">{query.lastError}</span>}</div></div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => openQuery(query)}>Edit</Button><Button variant="ghost" size="icon" aria-label={`Delete ${query.label}`} onClick={() => void removeQuery(query)}><Trash2 /></Button></div></div>)}</div> : <div className="px-5 py-14 text-center"><Search className="mx-auto h-6 w-6 text-muted-foreground" /><div className="mt-3 text-sm font-medium">No search queries</div><p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">Account posts and mentions still sync. Add a query when you want to watch a brand, product, phrase, or public conversation.</p></div>}</CardContent></Card>}

      {view === 'history' && <Card><CardHeader><CardTitle>Sync history</CardTitle><CardDescription>Every manual and scheduled X collection run, including retries, rate-limit waits, counts, and Terra hand-off.</CardDescription></CardHeader><CardContent className="px-0 pb-0"><div className="overflow-x-auto"><table className="data-table min-w-[850px]"><thead><tr><th>Started</th><th>Trigger</th><th>Status</th><th>Posts</th><th>Mentions</th><th>Search</th><th>New</th><th>Detail</th></tr></thead><tbody>{status.syncJobs.length ? status.syncJobs.map((job) => <tr key={job.id}><td className="whitespace-nowrap text-xs">{formatDate(job.startedAt || job.createdAt)}</td><td className="capitalize">{job.trigger}</td><td>{jobBadge(job)}</td><td>{job.postsFetched}</td><td>{job.mentionsFetched}</td><td>{job.searchFetched}</td><td>{job.importedCount}</td><td className="max-w-sm text-xs text-muted-foreground">{job.error || job.stage.replaceAll('_', ' ')}{job.runAfter ? ` · resumes ${formatDate(job.runAfter)}` : ''}</td></tr>) : <tr><td colSpan={8} className="py-14 text-center text-sm text-muted-foreground">No synchronisation history yet.</td></tr>}</tbody></table></div></CardContent></Card>}

      {view === 'connection' && <Card><CardHeader><CardTitle>Connection and history</CardTitle><CardDescription>Control read-only collection, disconnect OAuth access, and manage retained X post history. Automatic sync is off by default because X API usage may be billed.</CardDescription></CardHeader><CardContent className="space-y-6">
        <div className="grid max-w-2xl gap-4 sm:grid-cols-2"><div><Label htmlFor="sync-frequency">Sync frequency</Label><select id="sync-frequency" value={status.connection?.syncIntervalMinutes} onChange={(event) => void updateConnection({ syncIntervalMinutes: Number(event.target.value) })} disabled={scheduleUnavailable || working === 'settings'} className="mt-2 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">{syncIntervals.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div><label className="flex items-center justify-between gap-4 border px-4 py-3"><span><span className="block text-sm font-medium">Automatic sync</span><span className="mt-0.5 block text-xs text-muted-foreground">Next run: {status.connection?.autoSync ? formatDate(status.connection.nextSyncAt) : 'Disabled'}</span></span><input type="checkbox" className="h-4 w-4" disabled={scheduleUnavailable || working === 'settings'} checked={Boolean(status.connection?.autoSync)} onChange={(event) => void updateConnection({ autoSync: event.target.checked })} /></label></div>
        {requiresReconnect && <p className="max-w-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">Reconnect this account before changing the collection schedule or starting another sync.</p>}
        {scheduleUnavailable && !requiresReconnect && <p className="max-w-2xl border bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground">Run a successful manual sync before enabling the automatic schedule.</p>}
        <div className="border-t pt-5"><div className="text-sm font-semibold">OAuth access</div><p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">The connection reads profile details, account posts, mentions, and configured public searches. Disconnecting removes usable OAuth access and stops automatic sync. Collected posts, listening queries, and sync history remain available so the evidence can still be audited.</p>{!disconnected && <Button className="mt-4" variant="outline" onClick={() => void disconnect()} disabled={working === 'disconnect'}>{working === 'disconnect' ? <Loader2 className="animate-spin" /> : <Trash2 />}Disconnect X account</Button>}</div>
        <div className="border-t pt-5"><div className="text-sm font-semibold">Retained X history</div><p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{status.counts.collected ? `${status.counts.collected} collected post${status.counts.collected === 1 ? '' : 's'} are linked to this account. Deleting history also removes this account’s sync audit records and derived Terra analyses, and turns off automatic sync. A later manual sync can recollect public posts.` : status.syncJobs.length ? 'No posts are retained, but sync audit records may still be deleted.' : 'No collected X history is retained for this account.'}</p><Button className="mt-4" variant="destructive" onClick={() => void deleteHistory()} disabled={(!status.counts.collected && !status.syncJobs.length) || working === 'delete-history'}>{working === 'delete-history' ? <Loader2 className="animate-spin" /> : <Trash2 />}Delete X history</Button></div>
      </CardContent></Card>}
    </>}

    <Dialog open={credentialDialog} onOpenChange={setCredentialDialogOpen}><DialogContent className="max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>Configure the X developer app</DialogTitle><DialogDescription>Secrets are encrypted at rest and never returned to the browser. Leave a field blank to keep its saved value.</DialogDescription></DialogHeader>
      <div className="space-y-4">
        <div className="border bg-muted/25 p-3"><div className="text-xs font-semibold">Callback URL</div><div className="mt-2 flex items-center gap-2"><code className="min-w-0 flex-1 select-all break-all text-xs">{status.callbackUrl}</code><Button variant="outline" size="icon" onClick={() => void copyCallback()} aria-label="Copy callback URL"><Clipboard /></Button></div></div>
        <div><Label htmlFor="x-consumer-key">API / Consumer key</Label><Input id="x-consumer-key" type="password" autoComplete="off" value={credentials.consumerKey} onChange={(event) => setCredentials((current) => ({ ...current, consumerKey: event.target.value }))} placeholder={status.app.consumerCredentialsConfigured ? 'Configured — leave blank to keep' : 'Required'} /></div>
        <div><Label htmlFor="x-consumer-secret">API / Consumer secret</Label><Input id="x-consumer-secret" type="password" autoComplete="off" value={credentials.consumerSecret} onChange={(event) => setCredentials((current) => ({ ...current, consumerSecret: event.target.value }))} placeholder={status.app.consumerCredentialsConfigured ? 'Configured — leave blank to keep' : 'Required'} /></div>
        {hasConsumerKey !== hasConsumerSecret && <p className="text-xs text-destructive" role="alert">Enter the consumer key and consumer secret together.</p>}
        {status.app.configured && hasConsumerKey && hasConsumerSecret && <p className="border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">Changing these shared credentials requires every connected X account to reconnect.</p>}
        <div><Label htmlFor="x-bearer">Bearer token</Label><Input id="x-bearer" type="password" autoComplete="off" value={credentials.bearerToken} onChange={(event) => setCredentials((current) => ({ ...current, bearerToken: event.target.value }))} placeholder={status.app.bearerTokenConfigured ? 'Configured — leave blank to keep' : 'Required for recent search'} /></div>
        <details className="border p-3"><summary className="cursor-pointer text-sm font-medium">Use existing owner account tokens</summary><p className="mt-2 text-xs leading-5 text-muted-foreground">Optional. Add both fields to connect the token owner without the X sign-in screen. Most users should use Connect with X.</p><div className="mt-3 space-y-3"><div><Label htmlFor="x-access-token">Access token</Label><Input id="x-access-token" type="password" autoComplete="off" value={credentials.accessToken} onChange={(event) => setCredentials((current) => ({ ...current, accessToken: event.target.value }))} placeholder="Leave blank to use Connect with X" /></div><div><Label htmlFor="x-access-secret">Access-token secret</Label><Input id="x-access-secret" type="password" autoComplete="off" value={credentials.accessTokenSecret} onChange={(event) => setCredentials((current) => ({ ...current, accessTokenSecret: event.target.value }))} placeholder="Enter together with the access token" /></div>{hasAccessToken !== hasAccessTokenSecret && <p className="text-xs text-destructive" role="alert">Enter the access token and access-token secret together.</p>}</div></details>
        <div className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /><span>Use read-only app permission and enable “Sign in with X.” By saving credentials you agree to the <Link className="underline" to="/legal/terms">Terms</Link> and acknowledge the <Link className="underline" to="/legal/privacy">Privacy Policy</Link>.</span></div>
        {status.app.configured && <div className="border-t pt-4"><div className="text-sm font-semibold">Remove integration</div><p className="mt-1 text-xs leading-5 text-muted-foreground">Removes the shared app credentials and disconnects every X account in this workspace.</p><Button className="mt-3" variant="destructive" size="sm" disabled={Boolean(working)} onClick={() => void removeXConfiguration()}>{working === 'remove-app' ? <Loader2 className="animate-spin" /> : <Trash2 />}Remove X developer app</Button></div>}
      </div>
      <DialogFooter><Button variant="outline" onClick={() => setCredentialDialogOpen(false)} disabled={Boolean(working)}>Cancel</Button><Button onClick={() => void saveCredentials()} disabled={Boolean(working) || !credentialsReadyToSave}>{working === 'credentials' ? <Loader2 className="animate-spin" /> : <Check />}Save securely</Button></DialogFooter>
    </DialogContent></Dialog>

    <Dialog open={queryDialog} onOpenChange={setQueryDialog}><DialogContent><DialogHeader><DialogTitle>{editingQuery ? 'Edit listening query' : 'Add listening query'}</DialogTitle><DialogDescription>Use X recent-search syntax. The query is executed with the workspace bearer token during each sync.</DialogDescription></DialogHeader><div className="space-y-4"><div><Label htmlFor="query-label">Name</Label><Input id="query-label" value={queryDraft.label} onChange={(event) => setQueryDraft((current) => ({ ...current, label: event.target.value }))} placeholder="Brand mentions" /></div><div><Label htmlFor="query-value">X query</Label><Input id="query-value" value={queryDraft.query} onChange={(event) => setQueryDraft((current) => ({ ...current, query: event.target.value }))} placeholder={'"Seemplify" -is:retweet'} /><p className="mt-1 text-xs leading-5 text-muted-foreground">Up to 512 characters. Use operators such as quotes, from:, to:, lang:, and -is:retweet.</p></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={queryDraft.enabled} onChange={(event) => setQueryDraft((current) => ({ ...current, enabled: event.target.checked }))} />Run this query during sync</label></div><DialogFooter><Button variant="outline" onClick={() => setQueryDialog(false)}>Cancel</Button><Button onClick={() => void saveQuery()} disabled={working === 'query' || queryDraft.label.trim().length < 2 || queryDraft.query.trim().length < 2}>{working === 'query' ? <Loader2 className="animate-spin" /> : <Check />}{editingQuery ? 'Save changes' : 'Add query'}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
