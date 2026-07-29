import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, CheckSquare, ClipboardList, FileSearch, Loader2, RefreshCw, Search, Square } from 'lucide-react';
import { toast } from 'sonner';
import { api, json } from '@/lib/api';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { IntelligenceReport, IntelligenceSource } from '@/types';

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
  const [title, setTitle] = useState('Combined experience intelligence');
  const [objective, setObjective] = useState('Identify the strongest shared signals, disagreements, risks, and actions across the selected research.');
  const [search, setSearch] = useState(''); const [loading, setLoading] = useState(true); const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const reportRequest = useRef({ fingerprint: '', key: '' });

  const load = useCallback(async () => {
    const [sourceResult, reportResult] = await Promise.allSettled([
      api<IntelligenceSource[]>('/api/intelligence/sources'), api<IntelligenceReport[]>('/api/intelligence/reports')
    ]);
    if (sourceResult.status === 'fulfilled') setSources(sourceResult.value);
    if (reportResult.status === 'fulfilled') {
      setReports(reportResult.value);
      setSelectedReportId((current) => current && reportResult.value.some((report) => report.id === current) ? current : reportResult.value[0]?.id || null);
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
  const surveySources = filtered.filter((source) => source.type === 'survey');
  const socialSources = filtered.filter((source) => source.type === 'social');
  const selectedReport = reports.find((report) => report.id === selectedReportId) || null;

  function toggle(ref: string) {
    setSelectedRefs((current) => current.includes(ref) ? current.filter((item) => item !== ref) : current.length < 12 ? [...current, ref] : current);
  }
  async function createReport() {
    if (selectedRefs.length < 2) return toast.error('Select at least two historical reports.');
    setWorking(true);
    try {
      const body = { title, objective, sourceRefs: selectedRefs };
      const fingerprint = JSON.stringify(body);
      if (reportRequest.current.fingerprint !== fingerprint) reportRequest.current = { fingerprint, key: crypto.randomUUID() };
      const result = await api<{ report: IntelligenceReport }>('/api/intelligence/reports', { ...json('POST', body), headers: { 'idempotency-key': reportRequest.current.key } });
      reportRequest.current = { fingerprint: '', key: '' };
      setSelectedReportId(result.report.id); setSelectedRefs([]); await load(); toast.success('Combined intelligence queued durably.');
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Could not queue combined intelligence.'); }
    finally { setWorking(false); }
  }

  if (loading) return <div className="grid min-h-[55vh] place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return <div className="space-y-5">
    <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><h1 className="text-2xl font-semibold tracking-tight">Intelligence</h1><p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">Select historical survey and social reports, then ask Terra to synthesize the evidence into a saved cross-source analysis.</p></div><Button size="sm" variant="outline" onClick={() => void load()}><RefreshCw />Refresh</Button></header>
    {error && <div className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="status">{error}</div>}

    <div className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
      <aside className="space-y-4">
        <Card><CardHeader className="border-b"><CardTitle>Build an analysis</CardTitle><CardDescription>Choose 2–12 saved reports. Source snapshots are captured before the Terra job is queued.</CardDescription></CardHeader><CardContent className="space-y-4 pt-5"><div><Label htmlFor="intelligence-title">Report title</Label><Input id="intelligence-title" value={title} maxLength={180} onChange={(event) => setTitle(event.target.value)} /></div><div><Label htmlFor="intelligence-objective">Analysis objective</Label><Textarea id="intelligence-objective" value={objective} maxLength={1000} onChange={(event) => setObjective(event.target.value)} /></div><div><Label htmlFor="source-search">Find reports</Label><div className="relative mt-2"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input id="source-search" className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Survey, report, topic…" /></div></div><div className="max-h-[430px] overflow-y-auto border"><SourceGroup title="Survey reports" icon={ClipboardList} sources={surveySources} selected={selectedRefs} toggle={toggle} /><SourceGroup title="Social reports" icon={BarChart3} sources={socialSources} selected={selectedRefs} toggle={toggle} /></div><div className="flex items-center justify-between gap-3"><span className="text-xs text-muted-foreground">{selectedRefs.length} of 12 selected</span><Button disabled={working || selectedRefs.length < 2 || title.trim().length < 2} onClick={() => void createReport()}>{working ? <Loader2 className="animate-spin" /> : <FileSearch />}Run analysis</Button></div></CardContent></Card>
      </aside>

      <div className="min-w-0 space-y-4">
        {reports.length > 0 && <div className="flex gap-2 overflow-x-auto border-b pb-3" aria-label="Intelligence history">{reports.map((report) => <button key={report.id} onClick={() => setSelectedReportId(report.id)} aria-pressed={selectedReportId === report.id} className={`min-w-[190px] border px-3 py-2 text-left ${selectedReportId === report.id ? 'border-foreground bg-muted/60' : 'hover:bg-muted/30'}`}><span className="block truncate text-sm font-medium">{report.title}</span><span className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>{formatDate(report.createdAt)}</span><span className={report.state === 'failed' ? 'text-destructive' : report.state === 'completed' ? 'text-emerald-700' : 'text-amber-700'}>{report.state}</span></span></button>)}</div>}
        {!selectedReport ? <Card><CardContent className="py-20 text-center"><FileSearch className="mx-auto h-7 w-7 text-muted-foreground" /><div className="mt-3 text-sm font-medium">No combined intelligence yet</div><p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">Generate survey insights or executive reports and a social-intelligence report, then select them on the left.</p></CardContent></Card> : <IntelligenceReportView report={selectedReport} sources={sources} />}
      </div>
    </div>
  </div>;
}

function SourceGroup({ title, icon: Icon, sources, selected, toggle }: { title: string; icon: typeof ClipboardList; sources: IntelligenceSource[]; selected: string[]; toggle: (ref: string) => void }) {
  return <section className="border-b last:border-b-0"><div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2 text-xs font-semibold"><Icon className="h-3.5 w-3.5" />{title}<span className="ml-auto text-muted-foreground">{sources.length}</span></div>{sources.length ? <div className="divide-y">{sources.map((source) => { const active = selected.includes(source.ref); return <button key={source.ref} onClick={() => toggle(source.ref)} className="flex w-full gap-3 px-3 py-3 text-left hover:bg-muted/30"><span className="mt-0.5 text-muted-foreground">{active ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}</span><span className="min-w-0"><span className="block text-sm font-medium">{source.title}</span><span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">{source.preview}</span><span className="mt-1 block text-[11px] text-muted-foreground">{formatDate(source.createdAt)}</span></span></button>; })}</div> : <p className="px-3 py-5 text-xs text-muted-foreground">No matching reports.</p>}</section>;
}

function IntelligenceReportView({ report, sources }: { report: IntelligenceReport; sources: IntelligenceSource[] }) {
  const sourceMap = new Map(sources.map((source) => [source.ref, source])); const result = report.result;
  const totalTokens = report.runtime?.usage?.totalTokens || report.runtime?.usage?.total_tokens;
  return <Card><CardHeader className="border-b"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><CardTitle>{report.title}</CardTitle><CardDescription className="mt-1">{report.objective}</CardDescription></div><Badge variant={report.state === 'completed' ? 'success' : report.state === 'failed' ? 'destructive' : 'warning'}>{report.state}</Badge></div></CardHeader><CardContent className="space-y-7 pt-5"><section><h3 className="text-sm font-semibold">Sources</h3><div className="mt-2 flex flex-wrap gap-2">{[...report.sourceRefs.survey, ...report.sourceRefs.social].map((ref) => <span className="border px-2 py-1 text-xs" key={ref}>{sourceMap.get(ref)?.title || ref}</span>)}</div></section>{report.state === 'queued' && <div className="flex items-center gap-3 border px-4 py-5 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Terra analysis is queued or processing. It will remain available after navigation or restart.</div>}{report.error && <div className="border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">{report.error}</div>}{result && <><section><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">Executive summary</h3><span className="text-xs text-muted-foreground">{Math.round((result.confidence || 0) * 100)}% overall confidence</span></div><p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{result.executiveSummary}</p></section><Findings title="Themes" items={result.themes} /><Findings title="Where sources converge" items={result.convergence} /><Findings title="Where sources diverge" items={result.divergence} /><Findings title="Risks" items={result.risks} /><Findings title="Opportunities" items={result.opportunities} /><Findings title="Recommended actions" items={result.recommendations} />{result.limitations?.length > 0 && <section><h3 className="text-sm font-semibold">Limitations</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-muted-foreground">{result.limitations.map((limitation: string, index: number) => <li key={index}>{limitation}</li>)}</ul></section>}</>}{report.runtime && <section className="border-t pt-4 text-xs text-muted-foreground">Runtime: {report.runtime.provider || report.runtime.model || 'Terra'}{totalTokens ? ` · ${totalTokens} tokens` : ''}{report.runtime.latencyMs ? ` · ${report.runtime.latencyMs} ms` : ''}</section>}</CardContent></Card>;
}
