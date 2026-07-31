import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, BookOpenText, Check, Database, File, FileSearch, GitBranch, Loader2, LockKeyhole,
  Pencil, RefreshCw, RotateCcw, Search, Trash2, Upload, Users, X
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { api } from '@/lib/api';
import {
  deleteKnowledgeBase,
  deleteKnowledgeDocument,
  getKnowledgeBase,
  getKnowledgeDocuments,
  getKnowledgeGraph,
  getKnowledgeIndexingJobs,
  retryKnowledgeDocument,
  searchKnowledgeBase,
  updateKnowledgeBase,
  uploadKnowledgeDocuments
} from '@/lib/knowledgeBases';
import { Link, useNavigate, useParams } from '@/lib/router';
import type {
  KnowledgeBase,
  KnowledgeBaseDocument,
  KnowledgeBasePrivacy,
  KnowledgeCitation,
  KnowledgeGraph,
  KnowledgeGraphNode,
  KnowledgeIndexingJob,
  KnowledgeSearchResult
} from '@/types';

type WorkspaceTab = 'documents' | 'search' | 'graph' | 'history' | 'runtime';
type RuntimeService = { healthy?: boolean; ready?: boolean; required?: boolean; state?: string; statusCode?: number; latencyMs?: number };
type KnowledgeRuntime = {
  reachable?: boolean; ready?: boolean; healthy?: boolean; checkedAt?: string; uptimeSeconds?: number; tenantDatabases?: number;
  activeEmbeddingProvider?: string; services?: Record<string, RuntimeService>;
  gte?: { state?: string; ready?: boolean; accepting?: boolean; profile?: Record<string, unknown>; worker?: Record<string, unknown>; queue?: Record<string, unknown>; metrics?: Record<string, unknown> };
  migration?: Record<string, unknown>; providers?: Record<string, Record<string, unknown>>;
  queue?: { waiting?: number; accepting?: boolean; active?: Record<string, number>; completed?: number; failed?: number; oldestWaitMs?: number };
  search?: { lexical?: string; vector?: string; vectorIndexes?: Record<string, unknown> };
  resources?: { memory?: { rssBytes?: number; heapUsedBytes?: number }; cpuPercent?: number; eventLoop?: Record<string, number> };
};
type RuntimePayload = { knowledge?: { runtime?: KnowledgeRuntime; worker?: Record<string, unknown> } };
const acceptedExtensions = '.pdf,.docx,.pptx,.xlsx,.csv,.txt,.md,.html,.htm,.png,.jpg,.jpeg,.tif,.tiff';

function formatDate(value?: string | null) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Not yet';
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}

function stateVariant(state: string) {
  return ['ready', 'completed'].includes(state) ? 'success' as const
    : state === 'failed' ? 'destructive' as const
      : ['queued', 'processing', 'indexing', 'extracting', 'chunking', 'embedding', 'waiting_for_terra', 'deleting'].includes(state) ? 'warning' as const
        : 'secondary' as const;
}

function stageLabel(value: string) {
  return String(value || 'queued').replaceAll('_', ' ');
}

export function KnowledgeBaseWorkspacePage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const requestSequence = useRef(0);
  const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeBase | null>(null);
  const [documents, setDocuments] = useState<KnowledgeBaseDocument[]>([]);
  const [jobs, setJobs] = useState<KnowledgeIndexingJob[]>([]);
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [graphError, setGraphError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [tab, setTab] = useState<WorkspaceTab>('documents');
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [working, setWorking] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState({ name: '', description: '', privacy: 'space' as KnowledgeBasePrivacy, terraContextEnabled: false });
  const [query, setQuery] = useState('');
  const [searchResult, setSearchResult] = useState<KnowledgeSearchResult | null>(null);
  const [runtime, setRuntime] = useState<RuntimePayload | null>(null);
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [runtimeError, setRuntimeError] = useState('');

  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    const [baseResult, documentResult, jobResult] = await Promise.allSettled([
      getKnowledgeBase(id), getKnowledgeDocuments(id), getKnowledgeIndexingJobs(id)
    ]);
    if (sequence !== requestSequence.current) return;
    if (baseResult.status === 'fulfilled') {
      setKnowledgeBase(baseResult.value);
      setSettings({
        name: baseResult.value.name,
        description: baseResult.value.description,
        privacy: baseResult.value.privacy,
        terraContextEnabled: baseResult.value.terraContextEnabled
      });
    }
    if (documentResult.status === 'fulfilled') setDocuments(documentResult.value);
    if (jobResult.status === 'fulfilled') setJobs(jobResult.value);
    const failures = [baseResult, documentResult, jobResult].filter((result) => result.status === 'rejected') as PromiseRejectedResult[];
    setError(failures.map((failure) => failure.reason instanceof Error ? failure.reason.message : 'Workspace data could not load.').join(' '));
    setLastRefreshed(new Date());
    setLoading(false);
  }, [id]);

  const loadGraph = useCallback(async () => {
    try { setGraph(await getKnowledgeGraph(id)); setGraphError(''); }
    catch (reason) { setGraphError(reason instanceof Error ? reason.message : 'Knowledge graph could not load.'); }
  }, [id]);

  const loadRuntime = useCallback(async () => {
    setRuntimeLoading(true);
    try { setRuntime(await api<RuntimePayload>('/api/runtime')); setRuntimeError(''); }
    catch (reason) { setRuntimeError(reason instanceof Error ? reason.message : 'Knowledge runtime status could not load.'); }
    finally { setRuntimeLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useLiveRefresh(load);
  const activeJobs = useMemo(() => jobs.filter((job) => ['queued', 'processing', 'waiting_for_terra'].includes(job.state)), [jobs]);
  useEffect(() => {
    if (!activeJobs.length) return;
    const timer = window.setInterval(() => void load(), 1_500);
    return () => window.clearInterval(timer);
  }, [activeJobs.length, load]);
  useEffect(() => { if (tab === 'graph') void loadGraph(); }, [tab, loadGraph, knowledgeBase?.lastIndexedAt]);
  useEffect(() => {
    if (tab !== 'runtime') return;
    void loadRuntime();
    const timer = window.setInterval(() => void loadRuntime(), 5_000);
    return () => window.clearInterval(timer);
  }, [tab, loadRuntime]);

  function addFiles(next: File[]) {
    setFiles((current) => {
      const keyed = new Map(current.map((file) => [`${file.name}:${file.size}:${file.lastModified}`, file]));
      for (const file of next) keyed.set(`${file.name}:${file.size}:${file.lastModified}`, file);
      return [...keyed.values()].slice(0, 25);
    });
  }

  async function upload() {
    if (!files.length) return;
    setWorking('upload');
    try {
      await uploadKnowledgeDocuments(id, files);
      setFiles([]);
      if (fileInput.current) fileInput.current.value = '';
      toast.success('Documents accepted for durable indexing.');
      await load();
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Documents could not be uploaded.'); }
    finally { setWorking(''); }
  }

  async function saveSettings() {
    if (settings.name.trim().length < 2) return;
    setWorking('settings');
    try {
      const updated = await updateKnowledgeBase(id, { ...settings, name: settings.name.trim(), description: settings.description.trim() });
      setKnowledgeBase(updated); setSettingsOpen(false); toast.success('Knowledge base settings saved.');
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Settings could not be saved.'); }
    finally { setWorking(''); }
  }

  async function removeKnowledgeBase() {
    if (!knowledgeBase || !window.confirm(`Delete “${knowledgeBase.name}”, its documents, index, graph, and job history?`)) return;
    setWorking('delete-base');
    try { await deleteKnowledgeBase(id); toast.success('Knowledge base deleted.'); navigate('/knowledge-bases'); }
    catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Knowledge base could not be deleted.'); setWorking(''); }
  }

  async function removeDocument(document: KnowledgeBaseDocument) {
    if (!window.confirm(`Delete “${document.name}” and its indexed chunks?`)) return;
    setWorking(`delete:${document.id}`);
    try { await deleteKnowledgeDocument(id, document.id); toast.success('Document deleted.'); await load(); }
    catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Document could not be deleted.'); }
    finally { setWorking(''); }
  }

  async function retryDocument(document: KnowledgeBaseDocument) {
    setWorking(`retry:${document.id}`);
    try { await retryKnowledgeDocument(id, document.id); toast.success('Document returned to the durable indexing queue.'); await load(); }
    catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Document could not be retried.'); }
    finally { setWorking(''); }
  }

  async function search() {
    if (query.trim().length < 3) return;
    setWorking('search'); setSearchResult(null);
    try { setSearchResult(await searchKnowledgeBase(id, query.trim(), knowledgeBase?.terraContextEnabled === true)); }
    catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Search could not be completed.'); }
    finally { setWorking(''); }
  }

  if (loading) return <div className="grid min-h-[55vh] place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (!knowledgeBase) return <div className="mx-auto max-w-xl border bg-card p-6"><h1 className="text-lg font-semibold">Knowledge base unavailable</h1><p className="mt-2 text-sm text-muted-foreground">{error || 'This knowledge base no longer exists or is not available in the current space.'}</p><Button className="mt-5" variant="outline" asChild><Link to="/knowledge-bases"><ArrowLeft />Back to knowledge bases</Link></Button></div>;

  const PrivacyIcon = knowledgeBase.privacy === 'private' ? LockKeyhole : Users;
  return <div className="space-y-5">
    <Button variant="ghost" size="sm" asChild><Link to="/knowledge-bases"><ArrowLeft />Back to knowledge bases</Link></Button>
    <header className="flex flex-col justify-between gap-4 border-b pb-5 sm:flex-row sm:items-start">
      <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h1 className="page-title truncate">{knowledgeBase.name}</h1><Badge variant={stateVariant(knowledgeBase.state)}>{knowledgeBase.state}</Badge></div><p className="page-description">{knowledgeBase.description || 'No description has been added.'}</p><div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><PrivacyIcon className="h-3.5 w-3.5" />{knowledgeBase.privacy === 'private' ? 'Private to you' : 'Available to this space'}</span><span>Terra context {knowledgeBase.terraContextEnabled ? 'allowed when selected' : 'disabled'}</span><span>{knowledgeBase.documentCount} documents</span></div></div>
      <div className="flex shrink-0 gap-2"><Button size="sm" variant="outline" onClick={() => void load()}><RefreshCw />Refresh</Button><Button size="sm" variant="outline" onClick={() => setSettingsOpen(true)}><Pencil />Edit settings</Button></div>
    </header>
    {error && <div className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="status">Some live data could not refresh. {error}</div>}

    <div className="grid divide-y border bg-card sm:grid-cols-4 sm:divide-x sm:divide-y-0">
      <Summary label="Ready documents" value={`${knowledgeBase.readyDocumentCount || documents.filter((document) => document.state === 'ready').length} / ${knowledgeBase.documentCount || documents.length}`} />
      <Summary label="Indexed chunks" value={String(knowledgeBase.chunkCount)} />
      <Summary label="Graph" value={`${knowledgeBase.entityCount} entities · ${knowledgeBase.relationshipCount} links`} />
      <Summary label="Live status" value={activeJobs.length ? `${activeJobs.length} indexing` : `Updated ${lastRefreshed ? lastRefreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'now'}`} />
    </div>

    <Tabs value={tab} onValueChange={(value) => setTab(value as WorkspaceTab)}>
      <TabsList className="overflow-x-auto"><TabsTrigger value="documents">Documents</TabsTrigger><TabsTrigger value="search">Search & test</TabsTrigger><TabsTrigger value="graph">Graph & provenance</TabsTrigger><TabsTrigger value="history">Indexing history</TabsTrigger><TabsTrigger value="runtime">Runtime</TabsTrigger></TabsList>
      <TabsContent value="documents"><DocumentsWorkspace files={files} setFiles={setFiles} addFiles={addFiles} dragging={dragging} setDragging={setDragging} fileInput={fileInput} upload={upload} working={working} documents={documents} jobs={jobs} removeDocument={removeDocument} retryDocument={retryDocument} /></TabsContent>
      <TabsContent value="search"><SearchWorkspace query={query} setQuery={setQuery} working={working} search={search} result={searchResult} ready={documents.some((document) => document.state === 'ready')} terraAnswerEnabled={knowledgeBase.terraContextEnabled} /></TabsContent>
      <TabsContent value="graph"><GraphWorkspace graph={graph} error={graphError} loading={!graph && !graphError} refresh={loadGraph} /></TabsContent>
      <TabsContent value="history"><JobHistory jobs={jobs} /></TabsContent>
      <TabsContent value="runtime"><RuntimeWorkspace payload={runtime} loading={runtimeLoading} error={runtimeError} refresh={loadRuntime} /></TabsContent>
    </Tabs>

    <div className="flex justify-end border-t pt-4"><Button size="sm" variant="ghost" className="text-destructive hover:bg-red-50 hover:text-destructive" disabled={working === 'delete-base'} onClick={() => void removeKnowledgeBase()}>{working === 'delete-base' ? <Loader2 className="animate-spin" /> : <Trash2 />}Delete knowledge base</Button></div>

    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}><DialogContent><DialogHeader><DialogTitle>Edit knowledge base</DialogTitle><DialogDescription>Access and Terra use are separate. A member must explicitly select an allowed knowledge base for each supported AI request.</DialogDescription></DialogHeader><div className="space-y-4"><div><Label htmlFor="knowledge-edit-name">Name</Label><Input id="knowledge-edit-name" value={settings.name} maxLength={120} onChange={(event) => setSettings((current) => ({ ...current, name: event.target.value }))} /></div><div><Label htmlFor="knowledge-edit-description">Description</Label><Textarea id="knowledge-edit-description" rows={3} value={settings.description} maxLength={500} onChange={(event) => setSettings((current) => ({ ...current, description: event.target.value }))} /></div><div><Label htmlFor="knowledge-edit-privacy">Access</Label><select id="knowledge-edit-privacy" className="mt-2 h-10 w-full rounded-md border-input bg-background text-sm" value={settings.privacy} onChange={(event) => setSettings((current) => ({ ...current, privacy: event.target.value as KnowledgeBasePrivacy }))}><option value="space">Everyone in this space</option><option value="private">Private to me</option></select></div><label className="flex items-center justify-between gap-4 border px-3 py-3"><span><span className="block text-sm font-medium">Allow as Terra context</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">Turning this off prevents new AI requests from selecting it.</span></span><input type="checkbox" className="h-4 w-4" checked={settings.terraContextEnabled} onChange={(event) => setSettings((current) => ({ ...current, terraContextEnabled: event.target.checked }))} /></label></div><DialogFooter><Button variant="outline" onClick={() => setSettingsOpen(false)} disabled={working === 'settings'}>Cancel</Button><Button onClick={() => void saveSettings()} disabled={working === 'settings' || settings.name.trim().length < 2}>{working === 'settings' ? <Loader2 className="animate-spin" /> : <Check />}Save settings</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="px-4 py-3"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 text-sm font-semibold">{value}</div></div>;
}

function runtimeText(record: Record<string, unknown> | undefined, key: string, fallback = '—') {
  const value = record?.[key];
  return value === undefined || value === null || value === '' ? fallback : String(value);
}

function runtimeBytes(value?: number) {
  if (!Number.isFinite(value)) return '—';
  return `${((value || 0) / 1024 / 1024).toFixed(0)} MB`;
}

function runtimeDuration(seconds?: number) {
  if (!Number.isFinite(seconds)) return '—';
  const total = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function RuntimeWorkspace({ payload, loading, error, refresh }: { payload: RuntimePayload | null; loading: boolean; error: string; refresh: () => Promise<void> }) {
  const runtime = payload?.knowledge?.runtime;
  const services = runtime?.services || {};
  const serviceRows = [
    ['arango', 'ArangoDB', 'Documents, vectors, graph, and provenance'],
    ['gteEmbedding', 'GTE embedding worker', 'CPU embeddings for indexing and retrieval'],
    ['reranker', 'BGE reranker', 'Reorders retrieved evidence'],
    ['docling', 'Docling', 'Document extraction and OCR'],
    ['terra', 'Terra gateway', 'Graph extraction and grounded answers']
  ] as const;
  const profile = runtime?.gte?.profile || {};
  const migration = runtime?.migration || {};
  const vectorIndexes = runtime?.search?.vectorIndexes || {};
  const provider = runtime?.providers?.['gte-node'] || {};
  const qwen = runtime?.providers?.['qwen-tei'] || {};
  const appWorker = payload?.knowledge?.worker || {};
  const activeQueue = runtime?.queue?.active || {};
  const eventLoop = runtime?.resources?.eventLoop || {};

  return <div className="space-y-5">
    <section className="border bg-card"><header className="flex flex-col justify-between gap-3 border-b px-4 py-3 sm:flex-row sm:items-center"><div><h2 className="text-sm font-semibold">Knowledge runtime</h2><p className="mt-1 text-xs text-muted-foreground">Signed local status. Refreshes every five seconds while this tab is open.</p></div><div className="flex items-center gap-3"><span className="text-xs text-muted-foreground">{runtime?.checkedAt ? `Checked ${formatDate(runtime.checkedAt)}` : 'Not checked yet'}</span><Button size="sm" variant="outline" disabled={loading} onClick={() => void refresh()}>{loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}Refresh</Button></div></header>
      {!runtime && loading ? <div className="grid min-h-44 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div> : error && !runtime ? <div className="px-4 py-8 text-sm text-destructive">{error}</div> : <div className="divide-y"><RuntimeRow label="Runtime" value={runtime?.reachable && runtime.ready ? 'Ready' : runtime?.reachable ? 'Degraded' : 'Unavailable'} detail={`Uptime ${runtimeDuration(runtime?.uptimeSeconds)} · ${runtime?.tenantDatabases ?? 0} tenant database${runtime?.tenantDatabases === 1 ? '' : 's'}`} state={runtime?.reachable && runtime.ready ? 'ready' : 'failed'} />{serviceRows.map(([key, label, detail]) => { const service = services[key] || {}; const healthy = service.healthy === true || service.ready === true; return <RuntimeRow key={key} label={label} value={healthy ? 'Healthy' : service.state || 'Unavailable'} detail={`${detail}${typeof service.latencyMs === 'number' ? ` · ${service.latencyMs} ms` : ''}`} state={healthy ? 'ready' : 'failed'} />; })}</div>}
    </section>
    {error && runtime && <div className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">The last refresh failed. Showing the most recent runtime snapshot. {error}</div>}

    <div className="grid gap-5 xl:grid-cols-2">
      <section className="border bg-card"><header className="border-b px-4 py-3"><h2 className="text-sm font-semibold">Embedding</h2><p className="mt-1 text-xs text-muted-foreground">The active vector-space contract and CPU worker.</p></header><dl className="divide-y text-sm"><RuntimeDetail label="Provider" value={runtime?.activeEmbeddingProvider || '—'} /><RuntimeDetail label="Model" value={runtimeText(profile, 'modelId')} /><RuntimeDetail label="Revision" value={runtimeText(profile, 'revision')} mono /><RuntimeDetail label="Execution" value={`${runtimeText(profile, 'execution')} · ${runtimeText(profile, 'dtype')} · ${runtimeText(profile, 'dimension')} dimensions`} /><RuntimeDetail label="Index version" value={runtimeText(profile, 'vectorIndexVersion')} /><RuntimeDetail label="Worker" value={`${runtime?.gte?.state || 'unknown'} · accepting ${runtime?.gte?.accepting ? 'yes' : 'no'} · generation ${runtimeText(runtime?.gte?.worker, 'generation')}`} /><RuntimeDetail label="GTE activity" value={`${runtimeText(provider, 'embeddings', '0')} requests · ${runtimeText(provider, 'texts', '0')} texts · ${runtimeText(provider, 'failures', '0')} failures`} /><RuntimeDetail label="Qwen activity" value={`${runtimeText(qwen, 'embeddings', '0')} requests · rollback ${runtimeText(migration, 'dualWrite', 'false') === 'true' ? 'retained' : 'retired'}`} /></dl></section>

      <section className="border bg-card"><header className="border-b px-4 py-3"><h2 className="text-sm font-semibold">Queue and workers</h2><p className="mt-1 text-xs text-muted-foreground">Runtime retrieval work and durable application indexing.</p></header><dl className="divide-y text-sm"><RuntimeDetail label="Runtime queue" value={`${runtime?.queue?.waiting || 0} waiting · ${runtime?.queue?.accepting ? 'accepting work' : 'paused'}`} /><RuntimeDetail label="Active work" value={`${activeQueue.retrieve || 0} retrieval · ${activeQueue.graph || 0} graph`} /><RuntimeDetail label="Runtime totals" value={`${runtime?.queue?.completed || 0} completed · ${runtime?.queue?.failed || 0} failed`} /><RuntimeDetail label="Oldest wait" value={`${runtime?.queue?.oldestWaitMs || 0} ms`} /><RuntimeDetail label="Indexing worker" value={`${runtimeText(appWorker, 'active', '0')} active · ${runtimeText(appWorker, 'queued', '0')} queued · concurrency ${runtimeText(appWorker, 'concurrency', '1')}`} /><RuntimeDetail label="GTE queue" value={`${runtimeText(runtime?.gte?.queue, 'waiting', '0')} waiting · capacity ${runtimeText(runtime?.gte?.queue, 'capacity')}`} /></dl></section>

      <section className="border bg-card"><header className="border-b px-4 py-3"><h2 className="text-sm font-semibold">Retrieval and indexes</h2><p className="mt-1 text-xs text-muted-foreground">Search channels and vector-index readiness.</p></header><dl className="divide-y text-sm"><RuntimeDetail label="Lexical search" value={runtime?.search?.lexical || '—'} /><RuntimeDetail label="Vector search" value={runtime?.search?.vector || '—'} /><RuntimeDetail label="Observed indexes" value={runtimeText(vectorIndexes, 'observed', '0')} /><RuntimeDetail label="Ready indexes" value={runtimeText(vectorIndexes, 'ready', '0')} /><RuntimeDetail label="Training" value={runtimeText(vectorIndexes, 'training', '0')} /><RuntimeDetail label="Rollout" value={`${runtimeText(migration, 'configuredProvider', runtime?.activeEmbeddingProvider || '—')} · ${runtimeText(migration, 'rolloutPercent', '100')}% · shadow ${runtimeText(migration, 'shadowPercent', '0')}%`} /></dl></section>

      <section className="border bg-card"><header className="border-b px-4 py-3"><h2 className="text-sm font-semibold">Runtime process</h2><p className="mt-1 text-xs text-muted-foreground">Local Node process health, not total machine usage.</p></header><dl className="divide-y text-sm"><RuntimeDetail label="Resident memory" value={runtimeBytes(runtime?.resources?.memory?.rssBytes)} /><RuntimeDetail label="Heap used" value={runtimeBytes(runtime?.resources?.memory?.heapUsedBytes)} /><RuntimeDetail label="CPU" value={typeof runtime?.resources?.cpuPercent === 'number' ? `${runtime.resources.cpuPercent.toFixed(1)}%` : '—'} /><RuntimeDetail label="Event loop p95" value={typeof eventLoop.p95Ms === 'number' ? `${eventLoop.p95Ms.toFixed(1)} ms` : '—'} /><RuntimeDetail label="PID" value={runtime?.healthy ? 'Healthy process' : 'Process status unavailable'} /></dl></section>
    </div>
  </div>;
}

function RuntimeRow({ label, value, detail, state }: { label: string; value: string; detail: string; state: string }) {
  return <div className="flex flex-col justify-between gap-2 px-4 py-3 sm:flex-row sm:items-center"><div><div className="text-sm font-medium">{label}</div><div className="mt-1 text-xs text-muted-foreground">{detail}</div></div><Badge variant={stateVariant(state)}>{value}</Badge></div>;
}

function RuntimeDetail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="grid gap-1 px-4 py-3 sm:grid-cols-[140px_1fr]"><dt className="text-xs text-muted-foreground">{label}</dt><dd className={`min-w-0 break-words text-sm ${mono ? 'font-mono text-xs' : 'font-medium'}`}>{value}</dd></div>;
}

function DocumentsWorkspace({ files, setFiles, addFiles, dragging, setDragging, fileInput, upload, working, documents, jobs, removeDocument, retryDocument }: {
  files: File[]; setFiles: (files: File[]) => void; addFiles: (files: File[]) => void; dragging: boolean; setDragging: (value: boolean) => void;
  fileInput: React.RefObject<HTMLInputElement | null>; upload: () => Promise<void>; working: string; documents: KnowledgeBaseDocument[]; jobs: KnowledgeIndexingJob[];
  removeDocument: (document: KnowledgeBaseDocument) => Promise<void>; retryDocument: (document: KnowledgeBaseDocument) => Promise<void>;
}) {
  const active = jobs.filter((job) => ['queued', 'processing', 'waiting_for_terra'].includes(job.state));
  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
    <div className="space-y-5">
      <section className="border bg-card p-5"><div className="flex items-start gap-3"><Upload className="mt-0.5 h-5 w-5 text-muted-foreground" /><div><h2 className="text-sm font-semibold">Upload documents</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">PDF, DOCX, PPTX, XLSX, CSV, text, Markdown, HTML, PNG, JPEG, and TIFF. Up to 25 files per upload.</p></div></div><div
        className={`mt-4 flex min-h-32 flex-col items-center justify-center border border-dashed px-5 py-7 text-center ${dragging ? 'border-foreground bg-muted/45' : 'bg-muted/15'}`}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles([...event.dataTransfer.files]); }}
      ><input ref={fileInput} className="sr-only" type="file" multiple accept={acceptedExtensions} onChange={(event) => addFiles([...(event.target.files || [])])} /><File className="h-6 w-6 text-muted-foreground" /><p className="mt-3 text-sm font-medium">Drop files here or choose from your computer</p><Button className="mt-3" size="sm" type="button" variant="outline" onClick={() => fileInput.current?.click()}>Choose files</Button></div>
        {files.length > 0 && <div className="mt-4 border"><div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2"><span className="text-xs font-semibold">Ready to upload ({files.length})</span><button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setFiles([])}>Clear</button></div><div className="max-h-48 divide-y overflow-y-auto">{files.map((file) => <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs" key={`${file.name}:${file.size}:${file.lastModified}`}><span className="truncate">{file.name}</span><span className="shrink-0 text-muted-foreground">{formatBytes(file.size)}</span></div>)}</div><div className="flex justify-end border-t p-3"><Button size="sm" onClick={() => void upload()} disabled={working === 'upload'}>{working === 'upload' ? <Loader2 className="animate-spin" /> : <Upload />}Upload and index</Button></div></div>}
      </section>

      <section className="overflow-hidden border bg-card"><header className="border-b px-4 py-3"><h2 className="text-sm font-semibold">Documents</h2><p className="mt-1 text-xs text-muted-foreground">Deleting a document also removes its chunks, embeddings, and graph provenance.</p></header>{documents.length ? <div className="overflow-x-auto"><table className="data-table min-w-[760px]"><thead><tr><th>Document</th><th>Status</th><th>Pages</th><th>Chunks</th><th>Added</th><th className="w-24">Actions</th></tr></thead><tbody>{documents.map((document) => <tr key={document.id}><td><div className="max-w-sm truncate font-medium">{document.name}</div><div className="mt-1 text-xs text-muted-foreground">{document.mimeType} · {formatBytes(document.size)}</div>{document.error && <div className="mt-1 text-xs text-destructive">{document.error}</div>}</td><td><Badge variant={stateVariant(document.state)}>{stageLabel(document.state)}</Badge>{document.state !== 'ready' && document.state !== 'failed' && <div className="mt-2 h-1 w-28 overflow-hidden rounded-sm bg-muted"><div className="h-full bg-primary" style={{ width: `${Math.max(2, document.progress)}%` }} /></div>}</td><td>{document.pageCount ?? '—'}</td><td>{document.chunkCount}</td><td className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(document.createdAt)}</td><td><div className="flex gap-1">{document.state === 'failed' && <Button size="icon" variant="ghost" aria-label={`Retry ${document.name}`} disabled={Boolean(working)} onClick={() => void retryDocument(document)}>{working === `retry:${document.id}` ? <Loader2 className="animate-spin" /> : <RotateCcw />}</Button>}<Button size="icon" variant="ghost" className="text-destructive hover:text-destructive" aria-label={`Delete ${document.name}`} disabled={Boolean(working)} onClick={() => void removeDocument(document)}>{working === `delete:${document.id}` ? <Loader2 className="animate-spin" /> : <Trash2 />}</Button></div></td></tr>)}</tbody></table></div> : <div className="px-4 py-14 text-center"><Database className="mx-auto h-6 w-6 text-muted-foreground" /><div className="mt-3 text-sm font-medium">No documents yet</div><p className="mt-1 text-sm text-muted-foreground">Upload source files above to begin indexing.</p></div>}</section>
    </div>
    <aside><section className="border bg-card"><header className="border-b px-4 py-3"><div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">Live indexing</h2>{active.length > 0 && <span className="text-xs text-amber-700">Updating</span>}</div><p className="mt-1 text-xs leading-5 text-muted-foreground">Jobs survive navigation, runtime outages, and restarts.</p></header>{active.length ? <div className="divide-y">{active.map((job) => <JobRow job={job} key={job.id} />)}</div> : <p className="px-4 py-8 text-sm text-muted-foreground">No active indexing jobs.</p>}</section></aside>
  </div>;
}

function JobRow({ job }: { job: KnowledgeIndexingJob }) {
  return <div className="px-4 py-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate text-sm font-medium">{job.documentName || 'Document indexing'}</div><div className="mt-1 text-xs capitalize text-muted-foreground">{stageLabel(job.stage)} · attempt {job.attempt}</div></div><span className="shrink-0 text-xs font-medium tabular-nums">{job.progress}%</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-sm bg-muted"><div className="h-full bg-primary transition-[width] duration-200" style={{ width: `${Math.max(2, job.progress)}%` }} /></div>{job.state === 'waiting_for_terra' && <p className="mt-2 text-xs leading-5 text-amber-700">Waiting for Terra. The job remains queued.</p>}{job.error && <p className="mt-2 text-xs leading-5 text-destructive">{job.error}</p>}</div>;
}

function SearchWorkspace({ query, setQuery, working, search, result, ready, terraAnswerEnabled }: { query: string; setQuery: (value: string) => void; working: string; search: () => Promise<void>; result: KnowledgeSearchResult | null; ready: boolean; terraAnswerEnabled: boolean }) {
  const citations = result?.citations?.length ? result.citations : result?.matches || [];
  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]"><section className="border bg-card p-5"><h2 className="text-sm font-semibold">Search and test retrieval</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">Ask a question to inspect matched chunks and exact source citations before attaching this knowledge base elsewhere.</p>{!terraAnswerEnabled && <p className="mt-3 border-l-2 border-amber-500 pl-3 text-xs leading-5 text-amber-800">Local retrieval is available. A generated Terra answer is disabled until Terra context is explicitly enabled in settings.</p>}<div className="mt-4 flex gap-2"><div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Knowledge search query" className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void search(); }} placeholder="What does the onboarding policy say about account ownership?" /></div><Button disabled={!ready || query.trim().length < 3 || working === 'search'} onClick={() => void search()}>{working === 'search' ? <Loader2 className="animate-spin" /> : <FileSearch />}Search</Button></div>{!ready && <p className="mt-3 text-xs text-amber-700">At least one document must finish indexing before search is available.</p>}{result && <div className="mt-6 space-y-5">{terraAnswerEnabled && <section><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">Answer</h3>{typeof result.tookMs === 'number' && <span className="text-xs text-muted-foreground">{result.tookMs} ms</span>}</div><p className="mt-2 whitespace-pre-wrap text-sm leading-7">{result.answer || 'The available evidence was insufficient for a generated answer. Review the matched passages.'}</p></section>}{result.matches?.length > 0 && <section><h3 className="text-sm font-semibold">Matched passages</h3><div className="mt-2 divide-y border">{result.matches.map((match, index) => <article className="px-4 py-3" key={match.sourceRef || match.id || match.chunkId || index}><div className="flex items-center justify-between gap-3 text-xs"><span className="font-medium">{match.documentName}</span>{typeof match.score === 'number' && <span className="text-muted-foreground">{Math.round(match.score * 100)}% match</span>}</div><p className="mt-2 text-sm leading-6 text-muted-foreground">{match.excerpt || match.text}</p></article>)}</div></section>}</div>}</section><aside className="border bg-card"><header className="border-b px-4 py-3"><h2 className="text-sm font-semibold">Citations</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Every generated answer resolves to indexed source text.</p></header>{citations.length ? <div className="divide-y">{citations.map((citation, index) => <Citation citation={citation} index={index} key={citation.sourceRef || citation.id || citation.chunkId || index} />)}</div> : <p className="px-4 py-8 text-sm text-muted-foreground">Run a search to inspect source citations.</p>}</aside></div>;
}

function Citation({ citation, index }: { citation: KnowledgeCitation; index: number }) {
  return <article className="px-4 py-3"><div className="text-xs font-semibold">[{citation.sourceRef || index + 1}] {citation.documentName}</div><div className="mt-1 text-[11px] text-muted-foreground">{citation.page ? `Page ${citation.page}` : 'Page not supplied'}{citation.section ? ` · ${citation.section}` : ''}</div><blockquote className="mt-2 border-l-2 pl-3 text-xs leading-5 text-muted-foreground">{citation.excerpt}</blockquote></article>;
}

function GraphWorkspace({ graph, error, loading, refresh }: { graph: KnowledgeGraph | null; error: string; loading: boolean; refresh: () => Promise<void> }) {
  return <div className="space-y-5">{error && <div className="flex items-center justify-between gap-3 border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="alert"><span>{error}</span><Button size="sm" variant="outline" onClick={() => void refresh()}>Retry</Button></div>}{loading ? <div className="grid min-h-[320px] place-items-center border"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div> : graph ? <><div className="grid divide-y border bg-card sm:grid-cols-4 sm:divide-x sm:divide-y-0"><Summary label="Documents" value={String(graph.stats.documents)} /><Summary label="Chunks" value={String(graph.stats.chunks)} /><Summary label="Entities" value={String(graph.stats.entities)} /><Summary label="Relationships" value={String(graph.stats.relationships)} /></div><div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]"><section className="overflow-hidden border bg-card"><header className="flex items-center justify-between gap-3 border-b px-4 py-3"><div><h2 className="text-sm font-semibold">Knowledge graph</h2><p className="mt-1 text-xs text-muted-foreground">A compact view of indexed entities and their relationships.</p></div><span className="text-xs text-muted-foreground">Updated {formatDate(graph.updatedAt)}</span></header><GraphPlot nodes={graph.nodes} edges={graph.edges} /></section><section className="border bg-card"><header className="border-b px-4 py-3"><h2 className="text-sm font-semibold">Relationship provenance</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Evidence behind graph connections, including source document and page.</p></header>{graph.edges.length ? <div className="max-h-[520px] divide-y overflow-y-auto">{graph.edges.map((edge) => <article className="px-4 py-3" key={edge.id}><div className="text-sm font-medium">{edge.label}</div><div className="mt-1 text-xs text-muted-foreground">{edge.documentName || 'Source document'}{edge.page ? ` · page ${edge.page}` : ''}{typeof edge.confidence === 'number' ? ` · ${Math.round(edge.confidence * 100)}% confidence` : ''}</div>{edge.excerpt && <blockquote className="mt-2 border-l-2 pl-3 text-xs leading-5 text-muted-foreground">{edge.excerpt}</blockquote>}</article>)}</div> : <p className="px-4 py-8 text-sm text-muted-foreground">No graph relationships have been indexed yet.</p>}</section></div></> : null}</div>;
}

function GraphPlot({ nodes, edges }: { nodes: KnowledgeGraphNode[]; edges: KnowledgeGraph['edges'] }) {
  const visible = nodes.slice(0, 24);
  const positions = new Map(visible.map((node, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(1, visible.length) - Math.PI / 2;
    const ring = index % 3 === 0 ? 95 : 125;
    return [node.id, { x: 320 + Math.cos(angle) * ring, y: 180 + Math.sin(angle) * ring }];
  }));
  return visible.length ? <div className="overflow-x-auto p-3"><svg className="min-w-[640px]" viewBox="0 0 640 360" role="img" aria-label={`Knowledge graph with ${nodes.length} entities and ${edges.length} relationships`}>
    {edges.slice(0, 80).map((edge) => { const source = positions.get(edge.source); const target = positions.get(edge.target); return source && target ? <line key={edge.id} x1={source.x} y1={source.y} x2={target.x} y2={target.y} stroke="hsl(var(--border))" strokeWidth="1.5" /> : null; })}
    {visible.map((node) => { const point = positions.get(node.id)!; return <g key={node.id}><circle cx={point.x} cy={point.y} r={node.kind === 'document' ? 21 : 17} fill="hsl(var(--card))" stroke="hsl(var(--foreground) / 0.55)" strokeWidth="1.5" /><text x={point.x} y={point.y + 32} textAnchor="middle" className="fill-foreground text-[10px]">{node.label.length > 18 ? `${node.label.slice(0, 16)}…` : node.label}</text><title>{node.label} · {node.kind}</title></g>; })}
  </svg>{nodes.length > visible.length && <p className="border-t px-2 pt-3 text-xs text-muted-foreground">Showing 24 of {nodes.length} entities. Search remains available across the full index.</p>}</div> : <div className="grid min-h-[320px] place-items-center text-center"><div><GitBranch className="mx-auto h-6 w-6 text-muted-foreground" /><p className="mt-3 text-sm font-medium">No graph entities yet</p><p className="mt-1 text-sm text-muted-foreground">Graph data appears after indexed documents produce entities and relationships.</p></div></div>;
}

function JobHistory({ jobs }: { jobs: KnowledgeIndexingJob[] }) {
  return <section className="overflow-hidden border bg-card"><header className="border-b px-4 py-3"><h2 className="text-sm font-semibold">Indexing history</h2><p className="mt-1 text-xs text-muted-foreground">Durable attempts remain visible after completion or failure.</p></header>{jobs.length ? <div className="overflow-x-auto"><table className="data-table min-w-[850px]"><thead><tr><th>Created</th><th>Document</th><th>Status</th><th>Stage</th><th>Attempt</th><th>Duration</th><th>Detail</th></tr></thead><tbody>{jobs.map((job) => { const duration = job.startedAt && job.completedAt ? Math.max(0, new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()) : null; return <tr key={job.id}><td className="whitespace-nowrap text-xs">{formatDate(job.createdAt)}</td><td className="max-w-xs truncate">{job.documentName || job.documentId || 'Batch indexing'}</td><td><Badge variant={stateVariant(job.state)}>{stageLabel(job.state)}</Badge></td><td className="capitalize">{stageLabel(job.stage)}</td><td>{job.attempt}</td><td>{duration === null ? '—' : `${(duration / 1000).toFixed(1)}s`}</td><td className="max-w-sm text-xs text-muted-foreground">{job.error || (job.completedAt ? `Completed ${formatDate(job.completedAt)}` : `${job.progress}% complete`)}</td></tr>; })}</tbody></table></div> : <div className="px-4 py-14 text-center"><BookOpenText className="mx-auto h-6 w-6 text-muted-foreground" /><p className="mt-3 text-sm font-medium">No indexing history</p><p className="mt-1 text-sm text-muted-foreground">Upload a document to create the first durable job.</p></div>}</section>;
}
