import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3, BookOpenText, CheckSquare, ClipboardList, FileSearch, Loader2, MessageSquare,
  RefreshCw, Search, Send, Square
} from 'lucide-react';
import { toast } from 'sonner';
import { api, json } from '@/lib/api';
import { askResearchSources, type ResearchConversationMessage } from '@/lib/researchChat';
import { updateKnowledgeBase } from '@/lib/knowledgeBases';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { IntelligenceReport, IntelligenceSource, ResearchChatResult } from '@/types';

function formatDate(value?: string | null) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Not yet';
}

function Findings({ title, items }: { title: string; items?: any[] }) {
  if (!items?.length) return null;
  return <section><h3 className="text-sm font-semibold">{title}</h3><div className="mt-2 divide-y border">{items.map((item, index) => <article className="p-4" key={`${item.title || item.action}-${index}`}><div className="flex items-start justify-between gap-3"><div className="text-sm font-semibold">{item.title || item.action}</div>{typeof item.confidence === 'number' && <span className="shrink-0 text-xs text-muted-foreground">{Math.round(item.confidence * 100)}% confidence</span>}{item.priority && <Badge variant="outline">{item.priority}</Badge>}</div><p className="mt-2 text-sm leading-6 text-muted-foreground">{item.detail || item.rationale}</p>{item.evidence?.length > 0 && <details className="mt-3"><summary className="cursor-pointer text-xs font-medium">Evidence ({item.evidence.length})</summary><div className="mt-2 space-y-2">{item.evidence.map((evidence: any, evidenceIndex: number) => <blockquote className="border-l-2 pl-3 text-xs leading-5 text-muted-foreground" key={evidenceIndex}><span className="font-medium text-foreground">{evidence.sourceRef}</span><br />“{evidence.excerpt}”<br />{evidence.relevance}</blockquote>)}</div></details>}</article>)}</div></section>;
}

export function IntelligencePage() {
  const [sources, setSources] = useState<IntelligenceSource[]>([]);
  const [reports, setReports] = useState<IntelligenceReport[]>([]);
  const [selectedRefs, setSelectedRefs] = useState<string[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [mode, setMode] = useState<'analysis' | 'chat'>('analysis');
  const [title, setTitle] = useState('Combined experience intelligence');
  const [objective, setObjective] = useState('Identify the strongest shared signals, disagreements, risks, and actions across the selected research.');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [enablingId, setEnablingId] = useState('');
  const [error, setError] = useState('');
  const reportRequest = useRef({ fingerprint: '', key: '' });

  const load = useCallback(async () => {
    const [sourceResult, reportResult] = await Promise.allSettled([
      api<IntelligenceSource[]>('/api/intelligence/sources'),
      api<IntelligenceReport[]>('/api/intelligence/reports')
    ]);
    if (sourceResult.status === 'fulfilled') setSources(sourceResult.value);
    if (reportResult.status === 'fulfilled') {
      setReports(reportResult.value);
      setSelectedReportId((current) => current && reportResult.value.some((report) => report.id === current)
        ? current : reportResult.value[0]?.id || null);
    }
    const failures = [sourceResult, reportResult].filter((result) => result.status === 'rejected') as PromiseRejectedResult[];
    setError(failures.map((failure) => failure.reason instanceof Error ? failure.reason.message : 'Intelligence data could not load.').join(' '));
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useLiveRefresh(useCallback(() => { void load(); }, [load]));

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return term ? sources.filter((source) => `${source.title} ${source.preview} ${source.kind}`.toLocaleLowerCase().includes(term)) : sources;
  }, [search, sources]);
  const sourceGroups = [
    { title: 'Survey intelligence', type: 'survey' as const, icon: ClipboardList },
    { title: 'Social intelligence', type: 'social' as const, icon: BarChart3 },
    { title: 'Knowledge bases', type: 'knowledge' as const, icon: BookOpenText }
  ];
  const selectedReport = reports.find((report) => report.id === selectedReportId) || null;

  function toggle(ref: string) {
    const source = sources.find((item) => item.ref === ref);
    if (source?.available === false) return;
    setSelectedRefs((current) => current.includes(ref)
      ? current.filter((item) => item !== ref)
      : current.length < 12 ? [...current, ref] : current);
  }

  async function enableKnowledge(source: IntelligenceSource) {
    if (!source.knowledgeBaseId || source.terraContextEnabled !== false) return;
    setEnablingId(source.knowledgeBaseId);
    try {
      await updateKnowledgeBase(source.knowledgeBaseId, { terraContextEnabled: true });
      await load();
      setSelectedRefs((current) => current.includes(source.ref) || current.length >= 12 ? current : [...current, source.ref]);
      toast.success(`${source.title} can now be used by Terra and has been selected.`);
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : 'Terra context could not be enabled.');
    } finally { setEnablingId(''); }
  }

  async function createReport() {
    if (selectedRefs.length < 2) return toast.error('Select at least two evidence sources.');
    setWorking(true);
    try {
      const body = { title, objective, sourceRefs: selectedRefs };
      const fingerprint = JSON.stringify(body);
      if (reportRequest.current.fingerprint !== fingerprint) reportRequest.current = { fingerprint, key: crypto.randomUUID() };
      const result = await api<{ report: IntelligenceReport }>('/api/intelligence/reports', {
        ...json('POST', body), headers: { 'idempotency-key': reportRequest.current.key }
      });
      reportRequest.current = { fingerprint: '', key: '' };
      setSelectedReportId(result.report.id);
      await load();
      toast.success('Combined intelligence queued durably.');
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Could not queue combined intelligence.'); }
    finally { setWorking(false); }
  }

  if (loading) return <div className="grid min-h-[55vh] place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return <div className="space-y-6">
    <header className="flex flex-col justify-between gap-4 border-b pb-5 sm:flex-row sm:items-start">
      <div><h1 className="page-title">Intelligence</h1><p className="page-description max-w-3xl">Bring survey findings, social intelligence, and knowledge bases into one evidence set. Create a saved analysis or ask grounded follow-up questions.</p></div>
      <Button size="sm" variant="outline" onClick={() => void load()}><RefreshCw />Refresh</Button>
    </header>
    {error && <div className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="status">{error}</div>}

    <nav className="flex gap-6 border-b" aria-label="Intelligence workflow">
      <button className={`border-b-2 px-1 pb-3 text-sm font-medium ${mode === 'analysis' ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`} onClick={() => setMode('analysis')}>Build an analysis</button>
      <button className={`border-b-2 px-1 pb-3 text-sm font-medium ${mode === 'chat' ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`} onClick={() => setMode('chat')}>Ask selected sources</button>
    </nav>

    <section className="border bg-card">
      <header className="flex flex-col justify-between gap-3 border-b px-4 py-4 xl:flex-row xl:items-center">
        <div><h2 className="text-sm font-semibold">Evidence sources</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Choose 2–12 sources for a saved analysis, or one or more sources for chat. Knowledge bases count as sources.</p></div>
        <div className="flex items-center gap-3"><div className="relative w-full sm:w-72"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Find evidence sources" className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find surveys, reports, or knowledge" /></div><span className="shrink-0 text-xs text-muted-foreground">{selectedRefs.length} / 12 selected</span></div>
      </header>
      <div className="grid divide-y xl:grid-cols-3 xl:divide-x xl:divide-y-0">
        {sourceGroups.map((group) => <SourceGroup key={group.type} title={group.title} icon={group.icon} sources={filtered.filter((source) => source.type === group.type)} selected={selectedRefs} toggle={toggle} enablingId={enablingId} enableKnowledge={enableKnowledge} />)}
      </div>
    </section>

    {mode === 'chat' ? <ResearchChat sourceRefs={selectedRefs} title="Ask the selected evidence" description="Terra answers from this evidence set only and cites the exact reports or indexed passages it used." /> : <>
      <section className="border bg-card">
        <header className="border-b px-4 py-3"><h2 className="text-sm font-semibold">Create saved analysis</h2><p className="mt-1 text-xs text-muted-foreground">Source snapshots are captured before the Terra job is queued and remain attached to the result.</p></header>
        <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div><Label htmlFor="intelligence-title">Report title</Label><Input id="intelligence-title" className="mt-2" value={title} maxLength={180} onChange={(event) => setTitle(event.target.value)} /></div>
          <div><Label htmlFor="intelligence-objective">Analysis objective</Label><Textarea id="intelligence-objective" className="mt-2 min-h-24" value={objective} maxLength={1000} onChange={(event) => setObjective(event.target.value)} /></div>
        </div>
        <footer className="flex flex-col justify-between gap-3 border-t px-4 py-3 sm:flex-row sm:items-center"><span className="text-xs text-muted-foreground">{selectedRefs.length < 2 ? `Select ${2 - selectedRefs.length} more source${2 - selectedRefs.length === 1 ? '' : 's'} to continue.` : `${selectedRefs.length} evidence sources will be snapshotted.`}</span><Button disabled={working || selectedRefs.length < 2 || title.trim().length < 2} onClick={() => void createReport()}>{working ? <Loader2 className="animate-spin" /> : <FileSearch />}Run analysis</Button></footer>
      </section>

      <section className="space-y-4">
        <div><h2 className="text-sm font-semibold">Saved analyses</h2><p className="mt-1 text-xs text-muted-foreground">Open a result to review its findings or continue with grounded questions.</p></div>
        {reports.length > 0 && <div className="flex gap-2 overflow-x-auto border-b pb-3" aria-label="Intelligence history">{reports.map((report) => <button key={report.id} onClick={() => setSelectedReportId(report.id)} aria-pressed={selectedReportId === report.id} className={`min-w-[210px] border px-3 py-2 text-left ${selectedReportId === report.id ? 'border-foreground bg-muted/60' : 'hover:bg-muted/30'}`}><span className="block truncate text-sm font-medium">{report.title}</span><span className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>{formatDate(report.createdAt)}</span><span className={report.state === 'failed' ? 'text-destructive' : report.state === 'completed' ? 'text-emerald-700' : 'text-amber-700'}>{report.state}</span></span></button>)}</div>}
        {!selectedReport ? <div className="border bg-card py-16 text-center"><FileSearch className="mx-auto h-7 w-7 text-muted-foreground" /><div className="mt-3 text-sm font-medium">No combined intelligence yet</div><p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">Select any two survey, social, or knowledge sources above to create the first saved analysis.</p></div> : <IntelligenceReportView report={selectedReport} sources={sources} />}
      </section>
    </>}
  </div>;
}

function SourceGroup({ title, icon: Icon, sources, selected, toggle, enablingId, enableKnowledge }: {
  title: string; icon: typeof ClipboardList; sources: IntelligenceSource[]; selected: string[]; toggle: (ref: string) => void;
  enablingId: string; enableKnowledge: (source: IntelligenceSource) => Promise<void>;
}) {
  return <section className="min-w-0"><div className="flex items-center gap-2 border-b bg-muted/25 px-4 py-2.5 text-xs font-semibold"><Icon className="h-3.5 w-3.5" />{title}<span className="ml-auto text-muted-foreground">{sources.length}</span></div>{sources.length ? <div className="max-h-80 divide-y overflow-y-auto">{sources.map((source) => {
    const active = selected.includes(source.ref);
    const unavailable = source.available === false;
    const canEnable = source.type === 'knowledge' && source.terraContextEnabled === false && Boolean(source.knowledgeBaseId);
    return <div className={active ? 'bg-accent/40' : ''} key={source.ref}><button type="button" onClick={() => toggle(source.ref)} disabled={unavailable} className="flex w-full gap-3 px-4 py-3 text-left hover:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-60"><span className="mt-0.5 text-muted-foreground">{active ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}</span><span className="min-w-0"><span className="block text-sm font-medium">{source.title}</span><span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">{source.preview}</span><span className="mt-1 block text-[11px] text-muted-foreground">{source.type === 'knowledge' ? `${source.documentCount || 0} documents` : formatDate(source.createdAt)}</span></span></button>{unavailable && <div className="px-4 pb-3 pl-11 text-xs leading-5 text-muted-foreground"><span>{source.disabledReason}</span>{canEnable && <Button className="ml-1 h-auto p-0 text-xs" variant="link" disabled={enablingId === source.knowledgeBaseId} onClick={() => void enableKnowledge(source)}>{enablingId === source.knowledgeBaseId ? 'Enabling…' : 'Enable and select'}</Button>}</div>}</div>;
  })}</div> : <p className="px-4 py-8 text-sm text-muted-foreground">No matching sources.</p>}</section>;
}

type ChatLine = ResearchConversationMessage & { result?: ResearchChatResult };

function ResearchChat({ sourceRefs = [], reportId, title, description }: { sourceRefs?: string[]; reportId?: string; title: string; description: string }) {
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<ChatLine[]>([]);
  const [working, setWorking] = useState(false);
  const enabled = Boolean(reportId || sourceRefs.length);

  async function ask() {
    const value = question.trim();
    if (!enabled || value.length < 3 || working) return;
    const history = messages.map(({ role, content }) => ({ role, content }));
    setQuestion('');
    setMessages((current) => [...current, { role: 'user', content: value }]);
    setWorking(true);
    try {
      const result = await askResearchSources({ sourceRefs, reportId, question: value, history });
      setMessages((current) => [...current, { role: 'assistant', content: result.answer, result }]);
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : 'Terra could not answer from the selected evidence.');
    } finally { setWorking(false); }
  }

  return <section className="border bg-card">
    <header className="border-b px-4 py-3"><div className="flex items-center gap-2"><MessageSquare className="h-4 w-4" /><h2 className="text-sm font-semibold">{title}</h2></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p></header>
    <div className="min-h-64">
      {!messages.length ? <div className="px-5 py-12 text-center"><MessageSquare className="mx-auto h-6 w-6 text-muted-foreground" /><p className="mt-3 text-sm font-medium">Ask a grounded question</p><p className="mx-auto mt-1 max-w-lg text-sm leading-6 text-muted-foreground">{enabled ? 'Compare findings, probe a recommendation, or ask what the evidence does not yet establish.' : 'Select at least one source above to begin.'}</p></div> : <div className="divide-y">{messages.map((message, index) => <article className="px-5 py-4" key={`${message.role}-${index}`}><div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{message.role === 'user' ? 'You' : 'Terra'}</div><p className="mt-2 whitespace-pre-wrap text-sm leading-7">{message.content}</p>{message.result?.citations.length ? <details className="mt-3"><summary className="cursor-pointer text-xs font-medium">Sources used ({message.result.citations.length})</summary><div className="mt-2 divide-y border">{message.result.citations.map((citation) => <div className="px-3 py-2" key={citation.sourceRef}><div className="text-xs font-semibold">[{citation.sourceRef}] {citation.title}</div>{citation.documentName && <div className="mt-1 text-[11px] text-muted-foreground">{citation.documentName}{citation.page ? ` · page ${citation.page}` : ''}</div>}<p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">{citation.excerpt}</p></div>)}</div></details> : null}</article>)}</div>}
      {working && <div className="flex items-center gap-2 border-t px-5 py-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Terra is checking the selected evidence…</div>}
    </div>
    <footer className="border-t p-4"><Label htmlFor={`research-question-${reportId || 'selection'}`}>Question</Label><div className="mt-2 flex flex-col gap-2 sm:flex-row"><Textarea id={`research-question-${reportId || 'selection'}`} className="min-h-20 flex-1" value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void ask(); } }} placeholder="What do these sources agree on, and where is the evidence still weak?" /><Button className="sm:self-end" disabled={!enabled || question.trim().length < 3 || working} onClick={() => void ask()}>{working ? <Loader2 className="animate-spin" /> : <Send />}Ask Terra</Button></div></footer>
  </section>;
}

function IntelligenceReportView({ report, sources }: { report: IntelligenceReport; sources: IntelligenceSource[] }) {
  const sourceMap = new Map(sources.map((source) => [source.ref, source]));
  const result = report.result;
  const totalTokens = report.runtime?.usage?.totalTokens || report.runtime?.usage?.total_tokens;
  const refs = [...report.sourceRefs.survey, ...report.sourceRefs.social, ...report.knowledgeBaseIds.map((id) => `knowledge-base:${id}`)];
  return <div className="space-y-4"><section className="border bg-card"><header className="border-b px-5 py-4"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><h2 className="text-base font-semibold">{report.title}</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">{report.objective}</p></div><Badge variant={report.state === 'completed' ? 'success' : report.state === 'failed' ? 'destructive' : 'warning'}>{report.state}</Badge></div></header><div className="space-y-7 p-5"><section><h3 className="text-sm font-semibold">Sources</h3><div className="mt-2 divide-y border">{refs.map((ref) => <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs" key={ref}><span>{sourceMap.get(ref)?.title || ref}</span><span className="capitalize text-muted-foreground">{sourceMap.get(ref)?.type || 'evidence'}</span></div>)}</div></section>{report.state === 'queued' && <div className="flex items-center gap-3 border px-4 py-5 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Terra analysis is queued or processing. It remains available after navigation or restart.</div>}{report.error && <div className="border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">{report.error}</div>}{result && <><section><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">Executive summary</h3><span className="text-xs text-muted-foreground">{Math.round((result.confidence || 0) * 100)}% overall confidence</span></div><p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{result.executiveSummary}</p></section><Findings title="Themes" items={result.themes} /><Findings title="Where sources converge" items={result.convergence} /><Findings title="Where sources diverge" items={result.divergence} /><Findings title="Risks" items={result.risks} /><Findings title="Opportunities" items={result.opportunities} /><Findings title="Recommended actions" items={result.recommendations} />{result.limitations?.length > 0 && <section><h3 className="text-sm font-semibold">Limitations</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-muted-foreground">{result.limitations.map((limitation: string, index: number) => <li key={index}>{limitation}</li>)}</ul></section>}</>}{report.runtime && <section className="border-t pt-4 text-xs text-muted-foreground">Runtime: {report.runtime.provider || report.runtime.model || 'Terra'}{totalTokens ? ` · ${totalTokens} tokens` : ''}{report.runtime.latencyMs ? ` · ${report.runtime.latencyMs} ms` : ''}</section>}</div></section>{report.state === 'completed' && <ResearchChat key={report.id} reportId={report.id} title="Ask this analysis" description="Continue from the saved result and its immutable source evidence. Answers cite the material used." />}</div>;
}
