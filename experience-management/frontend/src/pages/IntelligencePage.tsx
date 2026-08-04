import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, BarChart3, BookOpenText, Check, CheckCircle2, CheckSquare, ChevronRight,
  CircleAlert, ClipboardList, Clock3, Copy, FileSearch, FileText, Layers3, Loader2,
  MessageSquare, Pause, Play, RefreshCw, Search, Send, Square, StopCircle, X
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
import { cn } from '@/lib/utils';
import type { DeepAnalysisMode, DeepAnalysisRun, IntelligenceReport, IntelligenceSource, ResearchChatResult } from '@/types';

type SourceFilter = 'all' | IntelligenceSource['type'] | 'selected';
type ReportFilter = 'all' | IntelligenceReport['state'];
type ReportSection = 'summary' | 'findings' | 'actions' | 'sources';

const sourceGroups = [
  { title: 'Survey intelligence', type: 'survey' as const, icon: ClipboardList },
  { title: 'Social intelligence', type: 'social' as const, icon: BarChart3 },
  { title: 'Knowledge bases', type: 'knowledge' as const, icon: BookOpenText }
];

const sourceFilterLabels: Array<{ value: SourceFilter; label: string }> = [
  { value: 'all', label: 'All sources' },
  { value: 'survey', label: 'Surveys' },
  { value: 'social', label: 'Social' },
  { value: 'knowledge', label: 'Knowledge bases' },
  { value: 'selected', label: 'Selected' }
];

function formatDate(value?: string | null) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Not yet';
}

function reportRefs(report: IntelligenceReport) {
  return [
    ...(report.sourceRefs?.survey || []),
    ...(report.sourceRefs?.social || []),
    ...(report.knowledgeBaseIds || []).map((id) => `knowledge-base:${id}`)
  ];
}

function reportStateVariant(state: IntelligenceReport['state']) {
  return state === 'completed' ? 'success' as const : state === 'failed' ? 'destructive' as const : 'warning' as const;
}

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function IntelligencePage() {
  const [sources, setSources] = useState<IntelligenceSource[]>([]);
  const [reports, setReports] = useState<IntelligenceReport[]>([]);
  const [deepRuns, setDeepRuns] = useState<DeepAnalysisRun[]>([]);
  const [selectedRefs, setSelectedRefs] = useState<string[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [selectedDeepRunId, setSelectedDeepRunId] = useState<string | null>(null);
  const [analysisDepth, setAnalysisDepth] = useState<'fast' | DeepAnalysisMode>('fast');
  const [mode, setMode] = useState<'analysis' | 'chat'>('analysis');
  const [title, setTitle] = useState('Combined experience intelligence');
  const [objective, setObjective] = useState('Identify the strongest shared signals, disagreements, risks, and actions across the selected research.');
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [historySearch, setHistorySearch] = useState('');
  const [historyFilter, setHistoryFilter] = useState<ReportFilter>('all');
  const [reportView, setReportView] = useState<'report' | 'chat'>('report');
  const [reportSection, setReportSection] = useState<ReportSection>('summary');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [enablingId, setEnablingId] = useState('');
  const [error, setError] = useState('');
  const reportRequest = useRef({ fingerprint: '', key: '' });

  const load = useCallback(async () => {
    const [sourceResult, reportResult, deepResult] = await Promise.allSettled([
      api<IntelligenceSource[]>('/api/intelligence/sources'),
      api<IntelligenceReport[]>('/api/intelligence/reports'),
      api<DeepAnalysisRun[]>('/api/intelligence/deep-runs')
    ]);
    if (sourceResult.status === 'fulfilled') setSources(sourceResult.value);
    if (reportResult.status === 'fulfilled') {
      setReports(reportResult.value);
      setSelectedReportId((current) => current && reportResult.value.some((report) => report.id === current)
        ? current : reportResult.value[0]?.id || null);
    }
    if (deepResult.status === 'fulfilled') {
      setDeepRuns(deepResult.value);
      setSelectedDeepRunId((current) => current && deepResult.value.some((run) => run.id === current)
        ? current : deepResult.value[0]?.id || null);
    }
    const failures = [sourceResult, reportResult, deepResult].filter((result) => result.status === 'rejected') as PromiseRejectedResult[];
    setError(failures.map((failure) => failure.reason instanceof Error ? failure.reason.message : 'Intelligence data could not load.').join(' '));
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useLiveRefresh(useCallback(() => { void load(); }, [load]));
  useEffect(() => {
    setReportView('report');
    setReportSection('summary');
  }, [selectedReportId]);

  const filteredSources = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return sources.filter((source) => {
      if (sourceFilter === 'selected' && !selectedRefs.includes(source.ref)) return false;
      if (sourceFilter !== 'all' && sourceFilter !== 'selected' && source.type !== sourceFilter) return false;
      return !term || `${source.title} ${source.preview} ${source.kind}`.toLocaleLowerCase().includes(term);
    });
  }, [search, selectedRefs, sourceFilter, sources]);

  const filteredReports = useMemo(() => {
    const term = historySearch.trim().toLocaleLowerCase();
    return reports.filter((report) => (historyFilter === 'all' || report.state === historyFilter)
      && (!term || `${report.title} ${report.objective}`.toLocaleLowerCase().includes(term)));
  }, [historyFilter, historySearch, reports]);

  const selectedReport = reports.find((report) => report.id === selectedReportId) || null;
  const selectedDeepRun = deepRuns.find((run) => run.id === selectedDeepRunId) || null;
  const selectedSources = selectedRefs.map((ref) => sources.find((source) => source.ref === ref)).filter(Boolean) as IntelligenceSource[];
  const availableSourceCount = sources.filter((source) => source.available !== false).length;

  function toggle(ref: string) {
    const source = sources.find((item) => item.ref === ref);
    if (source?.available === false) return;
    const maximum = analysisDepth === 'fast' ? 12 : 50;
    setSelectedRefs((current) => current.includes(ref)
      ? current.filter((item) => item !== ref)
      : current.length < maximum ? [...current, ref] : current);
  }

  async function enableKnowledge(source: IntelligenceSource) {
    if (!source.knowledgeBaseId || source.terraContextEnabled !== false) return;
    setEnablingId(source.knowledgeBaseId);
    try {
      await updateKnowledgeBase(source.knowledgeBaseId, { terraContextEnabled: true });
      await load();
      setSelectedRefs((current) => current.includes(source.ref) || current.length >= (analysisDepth === 'fast' ? 12 : 50) ? current : [...current, source.ref]);
      toast.success(`${source.title} can now be used by Terra and has been selected.`);
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : 'Terra context could not be enabled.');
    } finally { setEnablingId(''); }
  }

  async function createReport() {
    if (selectedRefs.length < (analysisDepth === 'fast' ? 2 : 1)) return toast.error(analysisDepth === 'fast' ? 'Select at least two evidence sources.' : 'Select at least one evidence source.');
    setWorking(true);
    try {
      const body = { title: title.trim(), objective: objective.trim(), sourceRefs: selectedRefs };
      const fingerprint = JSON.stringify({ ...body, analysisDepth });
      if (reportRequest.current.fingerprint !== fingerprint) reportRequest.current = { fingerprint, key: crypto.randomUUID() };
      const result = analysisDepth === 'fast'
        ? await api<{ report: IntelligenceReport }>('/api/intelligence/reports', {
          ...json('POST', body), headers: { 'idempotency-key': reportRequest.current.key }
        })
        : await api<{ run: DeepAnalysisRun }>('/api/intelligence/deep-runs', {
          ...json('POST', { ...body, mode: analysisDepth }), headers: { 'idempotency-key': reportRequest.current.key }
        });
      reportRequest.current = { fingerprint: '', key: '' };
      if ('report' in result) setSelectedReportId(result.report.id); else setSelectedDeepRunId(result.run.id);
      setSelectedRefs([]);
      await load();
      toast.success(analysisDepth === 'fast' ? 'Combined intelligence queued durably.' : `${analysisDepth === 'exhaustive' ? 'Exhaustive' : 'Deep'} analysis queued durably.`);
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Could not queue combined intelligence.'); }
    finally { setWorking(false); }
  }

  if (loading) return <div className="grid min-h-[55vh] place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return <div className="space-y-6">
    <header className="flex flex-col justify-between gap-4 border-b pb-5 sm:flex-row sm:items-start">
      <div>
        <h1 className="page-title">Intelligence</h1>
        <p className="page-description max-w-3xl">Combine survey findings, social intelligence, and knowledge bases into one grounded workspace. Build a durable analysis, then question the evidence behind it.</p>
      </div>
      <Button size="sm" variant="outline" onClick={() => void load()}><RefreshCw />Refresh</Button>
    </header>

    {error && <div className="flex items-start gap-3 border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="status"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}

    <nav className="flex gap-6 border-b" aria-label="Intelligence workflow">
      <button className={cn('border-b-2 px-1 pb-3 text-sm font-medium', mode === 'analysis' ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')} onClick={() => setMode('analysis')}>Build an analysis</button>
      <button className={cn('border-b-2 px-1 pb-3 text-sm font-medium', mode === 'chat' ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')} onClick={() => setMode('chat')}>Ask selected sources</button>
    </nav>

    <div className={cn('grid items-start gap-5', mode === 'analysis' ? 'xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.7fr)]' : 'xl:grid-cols-[minmax(0,0.92fr)_minmax(420px,1.08fr)]')}>
      <SourceLibrary
        sources={sources}
        filteredSources={filteredSources}
        selectedRefs={selectedRefs}
        selectedSources={selectedSources}
        filter={sourceFilter}
        search={search}
        enablingId={enablingId}
        availableSourceCount={availableSourceCount}
        onFilter={setSourceFilter}
        onSearch={setSearch}
        onToggle={toggle}
        onClear={() => setSelectedRefs([])}
        onEnable={enableKnowledge}
      />

      {mode === 'analysis'
        ? <AnalysisBrief title={title} objective={objective} selectedSources={selectedSources} working={working} depth={analysisDepth} onDepth={setAnalysisDepth} onTitle={setTitle} onObjective={setObjective} onRun={() => void createReport()} />
        : <div className="xl:sticky xl:top-20"><ResearchChat sourceRefs={selectedRefs} title="Ask the selected evidence" description="Terra answers from this evidence set only and cites the exact reports or indexed passages it used." /></div>}
    </div>

    {mode === 'analysis' && deepRuns.length > 0 && <DeepAnalysisWorkspace runs={deepRuns} selected={selectedDeepRun} onSelect={setSelectedDeepRunId} onChanged={load} />}

    {mode === 'analysis' && <section className="space-y-4" aria-labelledby="saved-analysis-heading">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div><h2 id="saved-analysis-heading" className="section-title">Saved analyses</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Durable research history. Select an analysis to inspect its evidence or continue the conversation.</p></div>
        <div className="relative w-full sm:w-72"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Search saved analyses" className="pl-9" value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="Search analyses" /></div>
      </div>

      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[292px_minmax(0,1fr)]">
        <AnalysisHistory reports={filteredReports} selectedReportId={selectedReportId} filter={historyFilter} total={reports.length} onFilter={setHistoryFilter} onSelect={setSelectedReportId} />
        {!selectedReport
          ? <div className="border bg-card py-16 text-center"><FileSearch className="mx-auto h-7 w-7 text-muted-foreground" /><div className="mt-3 text-sm font-medium">No analysis selected</div><p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">Choose a saved analysis from the history, or select any two sources above to create one.</p></div>
          : <IntelligenceReportView report={selectedReport} sources={sources} view={reportView} section={reportSection} onView={setReportView} onSection={setReportSection} />}
      </div>
    </section>}
  </div>;
}

function SourceLibrary({ sources, filteredSources, selectedRefs, selectedSources, filter, search, enablingId, availableSourceCount, onFilter, onSearch, onToggle, onClear, onEnable }: {
  sources: IntelligenceSource[]; filteredSources: IntelligenceSource[]; selectedRefs: string[]; selectedSources: IntelligenceSource[];
  filter: SourceFilter; search: string; enablingId: string; availableSourceCount: number;
  onFilter: (filter: SourceFilter) => void; onSearch: (search: string) => void; onToggle: (ref: string) => void;
  onClear: () => void; onEnable: (source: IntelligenceSource) => Promise<void>;
}) {
  return <section className="min-w-0 border bg-card" aria-labelledby="evidence-library-heading">
    <header className="flex flex-col justify-between gap-3 border-b px-4 py-4 sm:flex-row sm:items-start">
      <div>
        <div className="flex items-center gap-2"><Layers3 className="h-4 w-4 text-muted-foreground" /><h2 id="evidence-library-heading" className="text-sm font-semibold">Evidence library</h2></div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">Choose 2–12 sources for a saved analysis, or one or more for chat. Knowledge bases count as sources.</p>
      </div>
      <div className="shrink-0 text-xs text-muted-foreground"><span className="font-semibold text-foreground">{selectedRefs.length}</span> of 12 selected · {availableSourceCount} available</div>
    </header>

    <div className="border-b px-4 pt-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex max-w-full gap-5 overflow-x-auto" aria-label="Filter evidence sources">
          {sourceFilterLabels.map((item) => {
            const count = item.value === 'all' ? sources.length : item.value === 'selected' ? selectedRefs.length : sources.filter((source) => source.type === item.value).length;
            return <button type="button" key={item.value} aria-pressed={filter === item.value} className={cn('shrink-0 border-b-2 pb-2.5 text-xs font-medium', filter === item.value ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')} onClick={() => onFilter(item.value)}>{item.label} <span className="ml-1 font-normal text-muted-foreground">{count}</span></button>;
          })}
        </div>
        <div className="relative mb-3 w-full lg:w-64"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Find evidence sources" className="pl-9" value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search evidence" /></div>
      </div>
    </div>

    {selectedSources.length > 0 && <div className="flex min-w-0 items-center gap-3 border-b bg-muted/20 px-4 py-2.5">
      <span className="shrink-0 text-xs font-medium">Selected</span>
      <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-0.5">
        {selectedSources.map((source) => <button type="button" className="inline-flex shrink-0 items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs hover:bg-muted" key={source.ref} onClick={() => onToggle(source.ref)} title={`Remove ${source.title}`}><span className="max-w-48 truncate">{source.title}</span><X className="h-3 w-3 text-muted-foreground" /></button>)}
      </div>
      <button type="button" className="shrink-0 text-xs font-medium text-muted-foreground hover:text-foreground hover:underline" onClick={onClear}>Clear</button>
    </div>}

    <div className={cn('grid min-h-44', filter === 'all' && !search.trim() && filteredSources.length > 0 ? 'divide-y lg:grid-cols-3 lg:divide-x lg:divide-y-0' : '')}>
      {filteredSources.length > 0 ? sourceGroups.map((group) => {
        const groupSources = filteredSources.filter((source) => source.type === group.type);
        if (!groupSources.length) return null;
        return <SourceGroup key={group.type} title={group.title} icon={group.icon} sources={groupSources} selected={selectedRefs} toggle={onToggle} enablingId={enablingId} enableKnowledge={onEnable} />;
      }) : <div className="col-span-full grid min-h-44 place-items-center px-5 text-center"><div><FileSearch className="mx-auto h-5 w-5 text-muted-foreground" /><p className="mt-2 text-sm font-medium">{sources.length ? 'No matching evidence' : 'No evidence sources yet'}</p><p className="mt-1 text-xs text-muted-foreground">{sources.length ? 'Adjust the search or choose another source type.' : 'Completed survey and social reports, plus enabled knowledge bases, will appear here.'}</p></div></div>}
    </div>
  </section>;
}

function SourceGroup({ title, icon: Icon, sources, selected, toggle, enablingId, enableKnowledge }: {
  title: string; icon: typeof ClipboardList; sources: IntelligenceSource[]; selected: string[]; toggle: (ref: string) => void;
  enablingId: string; enableKnowledge: (source: IntelligenceSource) => Promise<void>;
}) {
  return <section className="min-w-0">
    <div className="flex items-center gap-2 border-b bg-muted/20 px-4 py-2.5 text-xs font-semibold"><Icon className="h-3.5 w-3.5" />{title}<span className="ml-auto font-normal text-muted-foreground">{sources.length}</span></div>
    {sources.length ? <div className="max-h-[310px] divide-y overflow-y-auto">{sources.map((source) => {
      const active = selected.includes(source.ref);
      const unavailable = source.available === false;
      const canEnable = source.type === 'knowledge' && source.terraContextEnabled === false && Boolean(source.knowledgeBaseId);
      return <div className={cn(active && 'bg-accent/35')} key={source.ref}>
        <button type="button" onClick={() => toggle(source.ref)} disabled={unavailable} aria-pressed={active} className="flex w-full gap-3 px-4 py-3 text-left outline-none hover:bg-muted/35 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60">
          <span className={cn('mt-0.5 shrink-0', active ? 'text-primary' : 'text-muted-foreground')}>{active ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{source.title}</span>
            <span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">{source.preview}</span>
            <span className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground"><span className="capitalize">{source.kind.replaceAll('_', ' ')}</span><span>{source.type === 'knowledge' ? countLabel(source.documentCount || 0, 'document') : formatDate(source.createdAt)}</span></span>
          </span>
        </button>
        {unavailable && <div className="border-t px-4 py-2.5 pl-11 text-xs leading-5 text-muted-foreground"><span>{source.disabledReason}</span>{canEnable && <Button className="ml-1 h-auto p-0 text-xs" variant="link" disabled={enablingId === source.knowledgeBaseId} onClick={() => void enableKnowledge(source)}>{enablingId === source.knowledgeBaseId ? 'Enabling…' : 'Enable and select'}</Button>}</div>}
      </div>;
    })}</div> : <p className="px-4 py-8 text-sm text-muted-foreground">No sources in this category.</p>}
  </section>;
}

function AnalysisBrief({ title, objective, selectedSources, working, depth, onDepth, onTitle, onObjective, onRun }: {
  title: string; objective: string; selectedSources: IntelligenceSource[]; working: boolean;
  depth: 'fast' | DeepAnalysisMode; onDepth: (value: 'fast' | DeepAnalysisMode) => void;
  onTitle: (value: string) => void; onObjective: (value: string) => void; onRun: () => void;
}) {
  const selectedCounts = sourceGroups.map((group) => ({ ...group, count: selectedSources.filter((source) => source.type === group.type).length }));
  const minimum = depth === 'fast' ? 2 : 1;
  const maximum = depth === 'fast' ? 12 : 50;
  const ready = selectedSources.length >= minimum && title.trim().length >= 2 && objective.trim().length >= 3;
  return <section className="border bg-card xl:sticky xl:top-20" aria-labelledby="analysis-brief-heading">
    <header className="border-b px-4 py-4">
      <div className="flex items-center gap-2"><FileText className="h-4 w-4 text-muted-foreground" /><h2 id="analysis-brief-heading" className="text-sm font-semibold">Build an analysis</h2></div>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">Source snapshots are captured before the Terra job is queued.</p>
    </header>
    <div className="space-y-4 p-4">
      <div><Label className="field-label" htmlFor="intelligence-title">Report title</Label><Input id="intelligence-title" value={title} maxLength={180} onChange={(event) => onTitle(event.target.value)} /></div>
      <div><Label className="field-label" htmlFor="intelligence-objective">Analysis objective</Label><Textarea id="intelligence-objective" className="min-h-28 resize-y" value={objective} maxLength={1000} onChange={(event) => onObjective(event.target.value)} /></div>
      <fieldset><legend className="field-label">Analysis depth</legend><div className="divide-y border">{([
        ['fast', 'Fast', 'One retrieval and synthesis pass.'],
        ['deep', 'Deep', 'Every selected document is partitioned and hierarchically analyzed.'],
        ['exhaustive', 'Exhaustive', 'Deep analysis plus contradiction, coverage, and independent verification passes.']
      ] as const).map(([value, label, description]) => <label className="flex cursor-pointer gap-3 px-3 py-2.5" key={value}><input type="radio" name="analysis-depth" value={value} checked={depth === value} onChange={() => onDepth(value)} /><span><span className="block text-xs font-medium">{label}</span><span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">{description}</span></span></label>)}</div></fieldset>
      <div className="border-t pt-3">
        <div className="mb-2 flex items-center justify-between text-xs"><span className="font-medium">Evidence set</span><span className="text-muted-foreground">{selectedSources.length} of {maximum}</span></div>
        <div className="divide-y border-y">{selectedCounts.map((item) => <div className="flex items-center gap-2 py-2 text-xs" key={item.type}><item.icon className="h-3.5 w-3.5 text-muted-foreground" /><span>{item.title}</span><span className={cn('ml-auto font-medium', item.count ? 'text-foreground' : 'text-muted-foreground')}>{item.count}</span></div>)}</div>
      </div>
    </div>
    <footer className="border-t p-4">
      <Button className="w-full" disabled={working || !ready} onClick={onRun}>{working ? <Loader2 className="animate-spin" /> : <FileSearch />}{working ? 'Queueing analysis' : 'Run analysis'}</Button>
      <p className={cn('mt-2 text-center text-xs leading-5', selectedSources.length < minimum ? 'text-muted-foreground' : 'text-emerald-700')}>{selectedSources.length < minimum ? `Choose ${minimum} or more source${minimum === 1 ? '' : 's'} · ${minimum - selectedSources.length} still needed` : <><Check className="mr-1 inline h-3.5 w-3.5" />Ready to snapshot {selectedSources.length} sources</>}</p>
    </footer>
  </section>;
}

function DeepAnalysisWorkspace({ runs, selected, onSelect, onChanged }: {
  runs: DeepAnalysisRun[]; selected: DeepAnalysisRun | null; onSelect: (id: string) => void; onChanged: () => Promise<void>;
}) {
  const [mutating, setMutating] = useState('');
  async function mutate(action: 'pause' | 'resume' | 'cancel') {
    if (!selected) return;
    setMutating(action);
    try {
      await api(`/api/intelligence/deep-runs/${selected.id}/${action}`, json('POST', {}));
      await onChanged();
      toast.success(action === 'pause' ? 'Analysis paused.' : action === 'resume' ? 'Analysis resumed.' : 'Analysis cancelled.');
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : `Could not ${action} the analysis.`); }
    finally { setMutating(''); }
  }
  const estimate = selected?.estimate || {};
  const duration = estimate.estimatedDurationSeconds ? Math.max(1, Math.round(estimate.estimatedDurationSeconds / 60)) : null;
  const findings = Array.isArray(selected?.result?.findings) ? selected.result.findings : [];
  const recommendations = Array.isArray(selected?.result?.recommendations) ? selected.result.recommendations : [];
  return <section className="space-y-4" aria-labelledby="deep-analysis-heading">
    <div><h2 id="deep-analysis-heading" className="section-title">Deep analysis runs</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Long-running corpus analysis with bounded partitions, checkpoints, and measured coverage.</p></div>
    <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[292px_minmax(0,1fr)]">
      <aside className="max-h-[520px] divide-y overflow-y-auto border bg-card" aria-label="Deep analysis history">{runs.map((run) => <button type="button" className={cn('flex w-full items-start gap-3 px-3 py-3 text-left hover:bg-muted/30', selected?.id === run.id && 'bg-accent/35')} key={run.id} onClick={() => onSelect(run.id)}><span className="mt-1">{run.state === 'completed' ? <CheckCircle2 className="h-4 w-4 text-emerald-700" /> : run.state === 'failed' || run.state === 'cancelled' ? <CircleAlert className="h-4 w-4 text-destructive" /> : run.state === 'paused' ? <Pause className="h-4 w-4 text-muted-foreground" /> : <Loader2 className="h-4 w-4 animate-spin text-amber-700" />}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{run.title}</span><span className="mt-1 block text-xs capitalize text-muted-foreground">{run.mode} · {run.stage.replaceAll('_', ' ')}</span><span className="mt-1 block text-[11px] text-muted-foreground">{run.completedPartitions} of {run.totalPartitions} steps · {run.progress}%</span></span></button>)}</aside>
      {selected && <div className="border bg-card">
        <header className="flex flex-col justify-between gap-3 border-b px-4 py-4 sm:flex-row sm:items-start"><div><div className="flex items-center gap-2"><FileSearch className="h-4 w-4 text-muted-foreground" /><h3 className="text-sm font-semibold">{selected.title}</h3><Badge variant={selected.state === 'completed' ? 'success' : selected.state === 'failed' || selected.state === 'cancelled' ? 'destructive' : 'warning'}>{selected.state}</Badge></div><p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">{selected.objective}</p></div><div className="flex gap-2">{['queued', 'processing'].includes(selected.state) && <Button size="sm" variant="outline" disabled={Boolean(mutating)} onClick={() => void mutate('pause')}><Pause />Pause</Button>}{selected.state === 'paused' && <Button size="sm" variant="outline" disabled={Boolean(mutating)} onClick={() => void mutate('resume')}><Play />Resume</Button>}{['queued', 'processing', 'paused'].includes(selected.state) && <Button size="sm" variant="outline" disabled={Boolean(mutating)} onClick={() => void mutate('cancel')}><StopCircle />Cancel</Button>}</div></header>
        <div className="space-y-5 p-4">
          <div><div className="mb-2 flex justify-between text-xs"><span className="font-medium capitalize">{selected.stage.replaceAll('_', ' ')}</span><span className="text-muted-foreground">{selected.progress}%</span></div><progress className="h-2 w-full" max={100} value={selected.progress} /></div>
          <dl className="grid gap-x-6 gap-y-3 border-y py-3 text-xs sm:grid-cols-2 lg:grid-cols-4"><div><dt className="text-muted-foreground">Estimated input</dt><dd className="mt-1 font-medium">{Number(estimate.estimatedInputTokens || 0).toLocaleString()} tokens</dd></div><div><dt className="text-muted-foreground">Planned calls</dt><dd className="mt-1 font-medium">{Number(estimate.estimatedCalls || 0).toLocaleString()}</dd></div><div><dt className="text-muted-foreground">Map partitions</dt><dd className="mt-1 font-medium">{Number(estimate.mapPartitions || 0).toLocaleString()}</dd></div><div><dt className="text-muted-foreground">Initial estimate</dt><dd className="mt-1 font-medium">{duration ? `About ${duration} min` : 'Calculating'}</dd></div></dl>
          {selected.error && <div className="border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{selected.error}</div>}
          {selected.result && <div className="space-y-5"><div><h4 className="text-sm font-semibold">Executive summary</h4><p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{selected.result.executiveSummary}</p></div>{findings.length > 0 && <div><h4 className="text-sm font-semibold">Findings</h4><div className="mt-2 divide-y border-y">{findings.map((finding: any, index: number) => <article className="py-3" key={`${finding.kind}-${index}`}><div className="flex justify-between gap-3"><span className="text-sm font-medium">{finding.statement}</span><span className="shrink-0 text-xs text-muted-foreground">{Math.round(Number(finding.confidence || 0) * 100)}%</span></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{finding.significance}</p><div className="mt-2 text-[11px] text-muted-foreground">{finding.citations?.length || 0} citation{finding.citations?.length === 1 ? '' : 's'}</div></article>)}</div></div>}{recommendations.length > 0 && <div><h4 className="text-sm font-semibold">Recommendations</h4><ol className="mt-2 divide-y border-y">{recommendations.map((item: any, index: number) => <li className="py-3 text-sm" key={index}><span className="font-medium">{item.action}</span><p className="mt-1 text-xs leading-5 text-muted-foreground">{item.rationale}</p></li>)}</ol></div>}</div>}
        </div>
      </div>}
    </div>
  </section>;
}

function AnalysisHistory({ reports, selectedReportId, filter, total, onFilter, onSelect }: {
  reports: IntelligenceReport[]; selectedReportId: string | null; filter: ReportFilter; total: number;
  onFilter: (filter: ReportFilter) => void; onSelect: (id: string) => void;
}) {
  const filters: Array<{ value: ReportFilter; label: string }> = [{ value: 'all', label: 'All' }, { value: 'completed', label: 'Complete' }, { value: 'queued', label: 'Active' }, { value: 'failed', label: 'Failed' }];
  return <aside className="min-w-0 border bg-card xl:sticky xl:top-20" aria-label="Analysis history">
    <div className="flex gap-4 overflow-x-auto border-b px-3 pt-3">{filters.map((item) => <button type="button" key={item.value} aria-pressed={filter === item.value} className={cn('shrink-0 border-b-2 pb-2 text-xs font-medium', filter === item.value ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')} onClick={() => onFilter(item.value)}>{item.label}</button>)}</div>
    <div className="max-h-[620px] divide-y overflow-y-auto">
      {reports.map((report) => {
        const active = report.id === selectedReportId;
        return <button type="button" key={report.id} aria-pressed={active} onClick={() => onSelect(report.id)} className={cn('group flex w-full items-start gap-3 px-3 py-3 text-left outline-none hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', active && 'bg-accent/35')}>
          <span className="mt-1">{report.state === 'completed' ? <CheckCircle2 className="h-4 w-4 text-emerald-700" /> : report.state === 'failed' ? <CircleAlert className="h-4 w-4 text-destructive" /> : <Clock3 className="h-4 w-4 text-amber-700" />}</span>
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{report.title}</span><span className="mt-1 block text-xs text-muted-foreground">{formatDate(report.createdAt)}</span><span className="mt-1 block text-[11px] text-muted-foreground">{countLabel(reportRefs(report).length, 'source')} · <span className="capitalize">{report.state}</span></span></span>
          <ChevronRight className={cn('mt-1 h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100', active && 'opacity-100')} />
        </button>;
      })}
      {!reports.length && <div className="px-4 py-10 text-center"><FileSearch className="mx-auto h-5 w-5 text-muted-foreground" /><p className="mt-2 text-sm font-medium">No matching analyses</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{total ? 'Try another status or search.' : 'New analyses will appear here.'}</p></div>}
    </div>
  </aside>;
}

type ChatLine = ResearchConversationMessage & { result?: ResearchChatResult };

function ResearchChat({ sourceRefs = [], reportId, title, description }: { sourceRefs?: string[]; reportId?: string; title: string; description: string }) {
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<ChatLine[]>([]);
  const [working, setWorking] = useState(false);
  const enabled = Boolean(reportId || sourceRefs.length);
  const suggestions = reportId
    ? ['What is the strongest finding?', 'Where is the evidence weakest?', 'What should we do next?']
    : ['What do these sources agree on?', 'Where do the sources disagree?', 'What evidence is still missing?'];

  async function ask(valueOverride?: string) {
    const value = (valueOverride ?? question).trim();
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

  return <section className="flex min-h-[480px] flex-col border bg-card">
    <header className="border-b px-4 py-4"><div className="flex items-center gap-2"><MessageSquare className="h-4 w-4 text-muted-foreground" /><h2 className="text-sm font-semibold">{title}</h2></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p></header>
    <div className="min-h-0 flex-1">
      {!messages.length ? <div className="flex min-h-64 flex-col items-center justify-center px-5 py-10 text-center"><MessageSquare className="h-6 w-6 text-muted-foreground" /><p className="mt-3 text-sm font-medium">Ask a grounded question</p><p className="mx-auto mt-1 max-w-lg text-sm leading-6 text-muted-foreground">{enabled ? 'Compare findings, challenge a recommendation, or ask what the evidence cannot yet establish.' : 'Select at least one source from the evidence library to begin.'}</p>{enabled && <div className="mt-5 flex max-w-xl flex-wrap justify-center gap-2">{suggestions.map((suggestion) => <Button type="button" size="sm" variant="outline" key={suggestion} onClick={() => void ask(suggestion)}>{suggestion}</Button>)}</div>}</div> : <div className="max-h-[460px] divide-y overflow-y-auto">{messages.map((message, index) => <article className={cn('px-5 py-4', message.role === 'user' && 'bg-muted/20')} key={`${message.role}-${index}`}><div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{message.role === 'user' ? 'You' : 'Terra'}</div><p className="mt-2 whitespace-pre-wrap text-sm leading-7">{message.content}</p>{message.result?.citations.length ? <details className="mt-3"><summary className="cursor-pointer text-xs font-medium">Sources used ({message.result.citations.length})</summary><div className="mt-2 divide-y border">{message.result.citations.map((citation, citationIndex) => <div className="px-3 py-2" key={`${citation.sourceRef}-${citationIndex}`}><div className="text-xs font-semibold">[{citation.sourceRef}] {citation.title}</div>{citation.documentName && <div className="mt-1 text-[11px] text-muted-foreground">{citation.documentName}{citation.page ? ` · page ${citation.page}` : ''}</div>}<p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">{citation.excerpt}</p></div>)}</div></details> : null}</article>)}</div>}
      {working && <div className="flex items-center gap-2 border-t px-5 py-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Terra is checking the selected evidence…</div>}
    </div>
    <footer className="border-t p-4"><Label className="field-label" htmlFor={`research-question-${reportId || 'selection'}`}>Question</Label><div className="flex flex-col gap-2 sm:flex-row"><Textarea id={`research-question-${reportId || 'selection'}`} className="min-h-20 flex-1 resize-y" value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void ask(); } }} placeholder="What does the evidence support?" /><Button className="sm:self-end" disabled={!enabled || question.trim().length < 3 || working} onClick={() => void ask()}>{working ? <Loader2 className="animate-spin" /> : <Send />}Ask Terra</Button></div><p className="mt-2 text-[11px] text-muted-foreground">Enter to send · Shift+Enter for a new line</p></footer>
  </section>;
}

function IntelligenceReportView({ report, sources, view, section, onView, onSection }: {
  report: IntelligenceReport; sources: IntelligenceSource[]; view: 'report' | 'chat'; section: ReportSection;
  onView: (view: 'report' | 'chat') => void; onSection: (section: ReportSection) => void;
}) {
  const sourceMap = new Map(sources.map((source) => [source.ref, source]));
  const result = report.result;
  const refs = reportRefs(report);
  const totalTokens = report.runtime?.usage?.totalTokens || report.runtime?.usage?.total_tokens;
  const sectionTabs: Array<{ value: ReportSection; label: string }> = [
    { value: 'summary', label: 'Summary' }, { value: 'findings', label: 'Findings' }, { value: 'actions', label: 'Actions' }, { value: 'sources', label: `Sources (${refs.length})` }
  ];

  async function copySummary() {
    if (!result?.executiveSummary) return;
    try { await navigator.clipboard.writeText(result.executiveSummary); toast.success('Executive summary copied.'); }
    catch { toast.error('The summary could not be copied.'); }
  }

  return <article className="min-w-0 border bg-card" aria-labelledby={`analysis-${report.id}`}>
    <header className="border-b px-5 py-4">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 id={`analysis-${report.id}`} className="text-lg font-semibold tracking-[-0.015em]">{report.title}</h2><Badge variant={reportStateVariant(report.state)} className="capitalize">{report.state}</Badge></div><p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{report.objective}</p><p className="mt-2 text-xs text-muted-foreground">Created {formatDate(report.createdAt)} · {countLabel(refs.length, 'source')}</p></div>
        <div className="flex shrink-0 flex-wrap gap-2">{result?.executiveSummary && <Button size="sm" variant="outline" onClick={() => void copySummary()}><Copy />Copy summary</Button>}{report.state === 'completed' && <Button size="sm" variant={view === 'chat' ? 'default' : 'outline'} onClick={() => onView(view === 'chat' ? 'report' : 'chat')}><MessageSquare />{view === 'chat' ? 'Back to report' : 'Ask Terra'}</Button>}</div>
      </div>
    </header>

    {view === 'chat' && report.state === 'completed'
      ? <ResearchChat key={report.id} reportId={report.id} title="Ask this analysis" description="Continue from the saved result and its immutable source evidence. Every answer cites the material used." />
      : <>
        <nav className="flex max-w-full gap-6 overflow-x-auto border-b px-5 pt-3" aria-label="Analysis sections">{sectionTabs.map((item) => <button type="button" key={item.value} aria-pressed={section === item.value} onClick={() => onSection(item.value)} className={cn('shrink-0 border-b-2 pb-3 text-sm font-medium', section === item.value ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>{item.label}</button>)}</nav>
        <div className="p-5 sm:p-6">
          {report.state === 'queued' && <div className="flex items-start gap-3 border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-950"><Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" /><div><div className="font-medium">Analysis in progress</div><p className="mt-1 text-xs leading-5">Terra analysis is queued or processing. It will remain available after navigation or restart.</p></div></div>}
          {report.error && <div className="flex items-start gap-3 border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /><span>{report.error}</span></div>}
          {result && section === 'summary' && <ReportSummary result={result} onSection={onSection} />}
          {result && section === 'findings' && <div className="grid gap-x-8 gap-y-7 2xl:grid-cols-2"><FindingSection title="Themes" items={result.themes} /><FindingSection title="Where sources converge" items={result.convergence} /><FindingSection title="Where sources diverge" items={result.divergence} /><FindingSection title="Risks" items={result.risks} /></div>}
          {result && section === 'actions' && <div className="grid gap-x-8 gap-y-7 2xl:grid-cols-2"><FindingSection title="Opportunities" items={result.opportunities} /><FindingSection title="Recommended actions" items={result.recommendations} />{result.limitations?.length > 0 && <section className="2xl:col-span-2"><div className="flex items-center gap-2 border-b pb-2"><AlertTriangle className="h-4 w-4 text-muted-foreground" /><h3 className="text-sm font-semibold">Limitations</h3><span className="ml-auto text-xs text-muted-foreground">{result.limitations.length}</span></div><ul className="mt-3 grid gap-2 text-sm leading-6 text-muted-foreground md:grid-cols-2">{result.limitations.map((limitation: string, index: number) => <li className="flex gap-2" key={index}><span className="mt-2 h-1 w-1 shrink-0 bg-muted-foreground" />{limitation}</li>)}</ul></section>}</div>}
          {section === 'sources' && <ReportSources refs={refs} sourceMap={sourceMap} report={report} totalTokens={totalTokens} />}
        </div>
      </>}
  </article>;
}

function ReportSummary({ result, onSection }: { result: any; onSection: (section: ReportSection) => void }) {
  const confidence = Math.max(0, Math.min(100, Math.round((result.confidence || 0) * 100)));
  const rows = [
    { label: 'Themes', count: result.themes?.length || 0, section: 'findings' as const },
    { label: 'Convergence', count: result.convergence?.length || 0, section: 'findings' as const },
    { label: 'Divergence', count: result.divergence?.length || 0, section: 'findings' as const },
    { label: 'Risks', count: result.risks?.length || 0, section: 'findings' as const },
    { label: 'Opportunities', count: result.opportunities?.length || 0, section: 'actions' as const },
    { label: 'Actions', count: result.recommendations?.length || 0, section: 'actions' as const }
  ];
  return <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_270px]">
    <section><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">Executive summary</h3><span className="text-xs font-medium text-muted-foreground">{confidence}% confidence</span></div><div className="mt-2 h-1.5 overflow-hidden bg-muted" aria-label={`${confidence}% overall confidence`}><div className="h-full bg-primary" style={{ width: `${confidence}%` }} /></div><p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{result.executiveSummary}</p></section>
    <aside><h3 className="text-sm font-semibold">Analysis map</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">Jump directly to the material you need.</p><div className="mt-3 divide-y border-y">{rows.map((row) => <button type="button" className="flex w-full items-center py-2.5 text-left text-sm hover:text-primary" key={row.label} onClick={() => onSection(row.section)}><span>{row.label}</span><span className="ml-auto text-xs text-muted-foreground">{row.count}</span><ChevronRight className="ml-2 h-3.5 w-3.5 text-muted-foreground" /></button>)}</div></aside>
  </div>;
}

function FindingSection({ title, items }: { title: string; items?: any[] }) {
  if (!items?.length) return null;
  return <section>
    <div className="flex items-center border-b pb-2"><h3 className="text-sm font-semibold">{title}</h3><span className="ml-auto text-xs text-muted-foreground">{items.length}</span></div>
    <div className="divide-y">{items.map((item, index) => <article className="py-4" key={`${item.title || item.action}-${index}`}>
      <div className="flex items-start justify-between gap-4"><div className="text-sm font-semibold leading-5">{item.title || item.action}</div><div className="flex shrink-0 items-center gap-2">{typeof item.confidence === 'number' && <span className="text-xs text-muted-foreground">{Math.round(item.confidence * 100)}%</span>}{item.priority && <Badge variant="outline" className="capitalize">{item.priority}</Badge>}</div></div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.detail || item.rationale}</p>
      {item.evidence?.length > 0 && <details className="mt-3"><summary className="cursor-pointer text-xs font-medium text-primary">Evidence ({item.evidence.length})</summary><div className="mt-2 space-y-3 border-l-2 pl-3">{item.evidence.map((evidence: any, evidenceIndex: number) => <blockquote className="text-xs leading-5 text-muted-foreground" key={evidenceIndex}><span className="font-semibold text-foreground">{evidence.sourceRef}</span><span className="mt-1 block">“{evidence.excerpt}”</span>{evidence.relevance && <span className="mt-1 block">{evidence.relevance}</span>}</blockquote>)}</div></details>}
    </article>)}</div>
  </section>;
}

function ReportSources({ refs, sourceMap, report, totalTokens }: {
  refs: string[]; sourceMap: Map<string, IntelligenceSource>; report: IntelligenceReport; totalTokens?: number;
}) {
  return <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_280px]">
    <section><h3 className="text-sm font-semibold">Evidence snapshot</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">These immutable sources were captured when the analysis was queued.</p><div className="mt-3 divide-y border-y">{refs.map((ref) => { const source = sourceMap.get(ref); return <div className="flex items-start gap-3 py-3" key={ref}><div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">{source?.type === 'survey' ? <ClipboardList className="h-3.5 w-3.5" /> : source?.type === 'social' ? <BarChart3 className="h-3.5 w-3.5" /> : <BookOpenText className="h-3.5 w-3.5" />}</div><div className="min-w-0"><div className="truncate text-sm font-medium">{source?.title || ref}</div><div className="mt-1 text-xs capitalize text-muted-foreground">{source?.type || 'evidence'} · {source?.kind?.replaceAll('_', ' ') || 'saved snapshot'}</div></div></div>; })}</div></section>
    <aside><h3 className="text-sm font-semibold">Run provenance</h3><dl className="mt-3 divide-y border-y text-xs"><div className="flex justify-between gap-3 py-2.5"><dt className="text-muted-foreground">Runtime</dt><dd className="text-right font-medium">{report.runtime?.provider || report.runtime?.model || 'Terra'}</dd></div><div className="flex justify-between gap-3 py-2.5"><dt className="text-muted-foreground">Completed</dt><dd className="text-right font-medium">{formatDate(report.completedAt)}</dd></div>{totalTokens ? <div className="flex justify-between gap-3 py-2.5"><dt className="text-muted-foreground">Tokens</dt><dd className="text-right font-medium">{totalTokens.toLocaleString()}</dd></div> : null}{report.runtime?.latencyMs ? <div className="flex justify-between gap-3 py-2.5"><dt className="text-muted-foreground">Latency</dt><dd className="text-right font-medium">{report.runtime.latencyMs.toLocaleString()} ms</dd></div> : null}</dl></aside>
  </div>;
}
