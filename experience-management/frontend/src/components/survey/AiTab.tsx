import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpenCheck, Braces, ChevronDown, ChevronUp, Copy, FileText, Lightbulb, Loader2, MessageSquareText, ShieldCheck, WandSparkles
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { api, json, waitForJob } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { KnowledgeBasePicker } from '@/components/knowledge/KnowledgeBasePicker';
import type { AiJob, Survey } from '@/types';

type Insight = { id: string; kind: string; payload: any; createdAt: string };

type ResearchEvidence = {
  responseId?: string;
  excerpt?: string;
  relevance?: string;
};

type ResearchAnswerPayload = {
  question?: string;
  answer?: string;
  evidence?: ResearchEvidence[];
  caveats?: string[];
  suggestedQuestions?: string[];
  [key: string]: unknown;
};

const savedInsightKind: Record<string, string> = {
  insights: 'ai_insights',
  report: 'executive_report',
  ask: 'research_answer'
};

function insightLabel(insight: Insight) {
  if (insight.kind === 'ai_insights') return 'AI insights';
  if (insight.kind === 'executive_report') return 'Executive report';
  if (insight.kind === 'research_answer') return 'Research answer';
  return insight.kind.replaceAll('_', ' ');
}

function FormattedText({ children }: { children: string }) {
  return <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    components={{
      h1: ({ children: value }) => <h4 className="mb-2 mt-5 text-base font-semibold first:mt-0">{value}</h4>,
      h2: ({ children: value }) => <h4 className="mb-2 mt-5 text-base font-semibold first:mt-0">{value}</h4>,
      h3: ({ children: value }) => <h5 className="mb-2 mt-4 text-sm font-semibold first:mt-0">{value}</h5>,
      p: ({ children: value }) => <p className="my-3 text-sm leading-6 first:mt-0 last:mb-0">{value}</p>,
      strong: ({ children: value }) => <strong className="font-semibold text-foreground">{value}</strong>,
      ol: ({ children: value }) => <ol className="my-3 list-decimal space-y-2 pl-5 text-sm leading-6">{value}</ol>,
      ul: ({ children: value }) => <ul className="my-3 list-disc space-y-2 pl-5 text-sm leading-6">{value}</ul>,
      li: ({ children: value }) => <li className="pl-1">{value}</li>,
      blockquote: ({ children: value }) => <blockquote className="my-3 border-l-2 border-border pl-4 text-muted-foreground">{value}</blockquote>,
      code: ({ children: value }) => <code className="bg-muted px-1 py-0.5 font-mono text-[0.9em]">{value}</code>,
      a: ({ children: value, href }) => <a className="font-medium text-primary underline underline-offset-2" href={href} rel="noreferrer" target="_blank">{value}</a>
    }}
  >{children}</ReactMarkdown>;
}

function CollapsibleSection({ title, count, open = false, children }: { title: string; count?: number; open?: boolean; children: React.ReactNode }) {
  return <details className="border" open={open}>
    <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold hover:bg-muted/25 [&::-webkit-details-marker]:hidden">
      <ChevronDown className="h-4 w-4 text-muted-foreground" />
      <span>{title}</span>
      {typeof count === 'number' && <span className="font-normal text-muted-foreground">({count})</span>}
    </summary>
    <div className="border-t">{children}</div>
  </details>;
}

function RawDataDetails({ payload }: { payload: unknown }) {
  const serialized = JSON.stringify(payload, null, 2);
  async function copyRawData() {
    try {
      await navigator.clipboard.writeText(serialized);
      toast.success('Raw data copied');
    } catch {
      toast.error('Could not copy the raw data.');
    }
  }
  return <details className="border">
    <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium hover:bg-muted/25 [&::-webkit-details-marker]:hidden">
      <Braces className="h-4 w-4 text-muted-foreground" />
      View raw data
    </summary>
    <div className="border-t bg-muted/20">
      <div className="flex justify-end border-b px-3 py-2"><Button type="button" size="sm" variant="ghost" onClick={() => void copyRawData()}><Copy />Copy JSON</Button></div>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap p-4 text-xs leading-5">{serialized}</pre>
    </div>
  </details>;
}

function ResearchAnswerDetails({ payload }: { payload: ResearchAnswerPayload }) {
  const evidence = Array.isArray(payload.evidence) ? payload.evidence : [];
  const caveats = Array.isArray(payload.caveats) ? payload.caveats.filter(Boolean) : [];
  const suggestedQuestions = Array.isArray(payload.suggestedQuestions) ? payload.suggestedQuestions.filter(Boolean) : [];
  return <div className="space-y-4">
    {payload.question && <div className="border-b pb-4">
      <div className="text-xs font-medium text-muted-foreground">Question</div>
      <p className="mt-1 text-sm font-medium leading-6">{payload.question}</p>
    </div>}
    <section aria-labelledby="research-answer-heading">
      <h4 id="research-answer-heading" className="text-sm font-semibold">Answer</h4>
      <div className="mt-2 border-l-2 border-primary/60 pl-4"><FormattedText>{String(payload.answer || 'No answer was returned.')}</FormattedText></div>
    </section>
    {evidence.length > 0 && <CollapsibleSection title="Supporting evidence" count={evidence.length} open>
      <ol className="divide-y">{evidence.map((citation, index) => {
        const responseId = String(citation?.responseId || 'Unknown response');
        return <li className="p-4" key={`${responseId}-${index}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-medium">Evidence {index + 1}</span>
            <span className="font-mono text-xs text-muted-foreground" title={responseId}>{responseId}</span>
          </div>
          {citation?.excerpt && <blockquote className="mt-3 border-l-2 border-border pl-3 text-sm leading-6">“{citation.excerpt}”</blockquote>}
          {citation?.relevance && <p className="mt-3 text-xs leading-5 text-muted-foreground"><span className="font-medium text-foreground">Why it matters:</span> {citation.relevance}</p>}
        </li>;
      })}</ol>
    </CollapsibleSection>}
    {caveats.length > 0 && <CollapsibleSection title="Limitations and caveats" count={caveats.length}>
      <ul className="divide-y">{caveats.map((caveat, index) => <li className="px-4 py-3 text-sm leading-6" key={`${index}-${caveat}`}>{caveat}</li>)}</ul>
    </CollapsibleSection>}
    {suggestedQuestions.length > 0 && <CollapsibleSection title="Suggested follow-up questions" count={suggestedQuestions.length}>
      <ol className="divide-y">{suggestedQuestions.map((suggestion, index) => <li className="flex gap-3 px-4 py-3 text-sm leading-6" key={`${index}-${suggestion}`}><span className="text-muted-foreground">{index + 1}.</span><span>{suggestion}</span></li>)}</ol>
    </CollapsibleSection>}
    <RawDataDetails payload={payload} />
  </div>;
}

function InsightDetails({ insight }: { insight: Insight }) {
  if (insight.kind === 'research_answer') return <ResearchAnswerDetails payload={(insight.payload || {}) as ResearchAnswerPayload} />;
  return <pre className="max-h-80 overflow-auto whitespace-pre-wrap border bg-muted/30 p-3 text-xs leading-5">{JSON.stringify(insight.payload, null, 2)}</pre>;
}

export function AiTab({ survey, hasUnsavedChanges, onApplyImprovement, refreshKey }: { survey: Survey; hasUnsavedChanges: boolean; onApplyImprovement: (values: any) => void; refreshKey: number }) {
  const [job, setJob] = useState<AiJob | null>(null);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [question, setQuestion] = useState('What should the team prioritise, and which responses support that conclusion?');
  const [answer, setAnswer] = useState<any>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(true);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [expandedInsightId, setExpandedInsightId] = useState<string | null>(null);
  const [knowledgeBaseIds, setKnowledgeBaseIds] = useState<string[] | null>(null);
  const [knowledgeSelectionLoading, setKnowledgeSelectionLoading] = useState(true);
  const [knowledgeSelectionSaving, setKnowledgeSelectionSaving] = useState(false);
  const [promotingId, setPromotingId] = useState('');
  const insightRequestRef = useRef(0);

  const loadInsights = useCallback(async (revealKind?: string) => {
    const requestId = ++insightRequestRef.current;
    setInsightsLoading(true);
    try {
      const loaded = await api<Insight[]>(`/api/surveys/${survey.id}/insights`);
      const next = loaded.filter((item) => ['ai_insights', 'executive_report', 'research_answer'].includes(item.kind));
      if (requestId !== insightRequestRef.current) return next;
      setInsights(next);
      setInsightsError(null);
      if (revealKind) {
        const latestMatching = next.find((item) => item.kind === revealKind);
        if (latestMatching) setExpandedInsightId(latestMatching.id);
      }
      return next;
    } catch (error) {
      if (requestId === insightRequestRef.current) {
        setInsightsError(error instanceof Error ? error.message : 'Could not load saved intelligence.');
      }
      return [];
    } finally {
      if (requestId === insightRequestRef.current) setInsightsLoading(false);
    }
  }, [survey.id]);

  useEffect(() => {
    setInsights([]);
    setExpandedInsightId(null);
    setActiveAction(null);
    setJob(null);
    setKnowledgeBaseIds(null);
  }, [survey.id]);

  useEffect(() => {
    let active = true;
    setKnowledgeSelectionLoading(true);
    void api<{ knowledgeBaseIds?: string[] }>(`/api/surveys/${survey.id}/knowledge-bases`)
      .then((result) => { if (active) setKnowledgeBaseIds(Array.isArray(result.knowledgeBaseIds) ? result.knowledgeBaseIds : []); })
      .catch(() => { if (active) setKnowledgeBaseIds(null); })
      .finally(() => { if (active) setKnowledgeSelectionLoading(false); });
    return () => { active = false; };
  }, [survey.id]);

  useEffect(() => { void loadInsights(); }, [loadInsights, refreshKey]);

  async function saveKnowledgeSelection(nextIds: string[]) {
    const previous = knowledgeBaseIds;
    setKnowledgeBaseIds(nextIds);
    setKnowledgeSelectionSaving(true);
    try {
      const saved = await api<{ knowledgeBaseIds?: string[] }>(`/api/surveys/${survey.id}/knowledge-bases`,
        json('PUT', { knowledgeBaseIds: nextIds }));
      setKnowledgeBaseIds(Array.isArray(saved.knowledgeBaseIds) ? saved.knowledgeBaseIds : nextIds);
      toast.success('Survey knowledge grounding saved');
    } catch (error) {
      setKnowledgeBaseIds(previous);
      toast.error(error instanceof Error ? error.message : 'Could not save survey knowledge grounding.');
    } finally {
      setKnowledgeSelectionSaving(false);
    }
  }

  async function promoteToKnowledge(insight: Insight) {
    if (!knowledgeBaseIds?.length) { toast.error('Select at least one knowledge base first.'); return; }
    try {
      setPromotingId(insight.id);
      await api(`/api/surveys/${survey.id}/insights/${insight.id}/knowledge`,
        json('POST', { knowledgeBaseIds, reviewed: true }));
      toast.success('Research answer queued for knowledge indexing');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not add this answer to knowledge.');
    } finally { setPromotingId(''); }
  }

  async function run(path: string, body: Record<string, unknown> = {}) {
    try {
      setActiveAction(path);
      setJob(null);
      const requestBody = knowledgeBaseIds === null ? body : { ...body, knowledgeBaseIds };
      const queued = await api<{ jobId: string }>(`/api/surveys/${survey.id}/ai/${path}`, json('POST', requestBody));
      const done = await waitForJob(queued.jobId, (nextJob) => {
        setJob(nextJob);
      });
      const output = done.result?.output;
      if (path === 'ask') setAnswer(output);
      if (path === 'improve') onApplyImprovement(output);
      if (savedInsightKind[path]) {
        await loadInsights(savedInsightKind[path]);
      }
      toast.success('Terra completed the request');
      return output;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Terra request failed';
      toast.error(message);
      return null;
    } finally {
      setActiveAction(null);
    }
  }

  const busy = Boolean(activeAction) || Boolean(job && ['queued', 'processing'].includes(job.state));
  const actionsDisabled = busy || hasUnsavedChanges || knowledgeSelectionLoading || knowledgeSelectionSaving;
  return <><div className="mb-5 border bg-card p-4"><KnowledgeBasePicker value={knowledgeBaseIds || []} onChange={(ids) => void saveKnowledgeSelection(ids)} disabled={actionsDisabled} description={knowledgeBaseIds === null ? 'Loading the survey’s saved knowledge selection.' : knowledgeSelectionSaving ? 'Saving this selection for survey AI and automatic response analysis.' : 'Saved grounding for Ask, quality review, response analysis, survey intelligence, reports, and publishing reviewed answers.'} /></div><div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
    <div className="space-y-5">
      <Card>
        <CardHeader><CardTitle>Ask the research</CardTitle><CardDescription>Terra can query responses, calculated metrics, and prior insights. Answers must cite the supplied evidence.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <Textarea rows={4} value={question} onChange={(event) => setQuestion(event.target.value)} />
          <Button disabled={actionsDisabled || question.trim().length < 5} onClick={() => run('ask', { question })}>{busy ? <Loader2 className="animate-spin" /> : <MessageSquareText />}Ask Terra</Button>
          {answer && <div className="border bg-muted/10 p-5"><ResearchAnswerDetails payload={{ question, ...answer }} /></div>}
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle>Saved survey intelligence</CardTitle><CardDescription>Decision-ready findings, research answers, and reports remain attached to this survey.</CardDescription></CardHeader><CardContent className="px-0 pb-0">
        {insightsError && <div className="flex items-center justify-between gap-4 border-t px-5 py-4 text-sm text-destructive"><span>{insightsError}</span><Button size="sm" variant="outline" onClick={() => void loadInsights()}>Retry</Button></div>}
        {!insightsError && insightsLoading && insights.length === 0 && <div className="flex items-center justify-center gap-2 border-t px-5 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading saved intelligence</div>}
        {!insightsError && !insightsLoading && insights.length === 0 && <div className="border-t px-5 py-10 text-center text-sm text-muted-foreground">Ask the research, generate survey intelligence, or create an executive report to build the research record.</div>}
        {insights.length > 0 && <ul className="divide-y border-t" aria-label="Generated intelligence history">{insights.map((item) => {
          const expanded = expandedInsightId === item.id;
          const contentId = `insight-${item.id}`;
          return <li id={`insight-row-${item.id}`} key={item.id}>
            <button type="button" className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-muted/25" aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpandedInsightId(expanded ? null : item.id)}>
              <span className="min-w-0 flex-1 text-sm font-medium">{insightLabel(item)}</span>
              <time className="shrink-0 text-xs font-normal text-muted-foreground" dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>
              {expanded ? <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
            </button>
            {expanded && <div id={contentId} className="space-y-4 border-t bg-muted/10 px-5 py-4"><InsightDetails insight={item} />{item.kind === 'research_answer' && <Button size="sm" variant="outline" disabled={promotingId === item.id} onClick={() => promoteToKnowledge(item)}>{promotingId === item.id ? <Loader2 className="animate-spin" /> : <BookOpenCheck />}Add to selected knowledge base</Button>}</div>}
          </li>;
        })}</ul>}
      </CardContent></Card>
    </div>
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Experience AI tools</CardTitle>
          <CardDescription>Every action is queued durably and uses the Experience default managed in Local Control Center.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {hasUnsavedChanges && <p className="mb-3 border px-3 py-2 text-xs leading-5 text-amber-700">Save changes before using Terra so it works from the latest survey.</p>}
          <Button variant="outline" className="h-auto w-full justify-start py-3" disabled={actionsDisabled} onClick={() => run('improve')}>
            <WandSparkles />
            <span className="text-left"><span className="block">Quality review</span><span className="block text-xs font-normal text-muted-foreground">Bias, wording, effort and metric fit</span></span>
          </Button>
          <Button variant="outline" className="h-auto w-full justify-start py-3" disabled={actionsDisabled} onClick={() => run('insights')}>
            <Lightbulb />
            <span className="text-left"><span className="block">Generate insights</span><span className="block text-xs font-normal text-muted-foreground">Themes, risks and recommendations</span></span>
          </Button>
          <Button variant="outline" className="h-auto w-full justify-start py-3" disabled={actionsDisabled} onClick={() => run('report', { audience: 'executive leadership' })}>
            <FileText />
            <span className="text-left"><span className="block">Executive report</span><span className="block text-xs font-normal text-muted-foreground">Evidence, limitations and actions</span></span>
          </Button>
        </CardContent>
      </Card>
      {job && <Card><CardHeader><div className="flex items-center justify-between"><CardTitle>Current AI job</CardTitle><span className="text-xs font-medium capitalize text-muted-foreground">{job.state}</span></div></CardHeader><CardContent><div className="h-1.5 overflow-hidden rounded-sm bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${job.progress}%` }} /></div><div className="mt-3 flex justify-between text-xs text-muted-foreground"><span>{job.stage.replaceAll('_', ' ')}</span><span>{job.progress}%</span></div>{job.stage === 'waiting_for_terra' && <p className="mt-3 text-xs leading-5 text-amber-700">Terra is unavailable. The job remains in the durable queue and will resume automatically.</p>}</CardContent></Card>}
      <div className="flex gap-3 border bg-card p-4 text-sm"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p className="leading-5 text-muted-foreground">Respondent text is treated as untrusted data. Generated claims are constrained to survey metrics and supplied response evidence.</p></div>
    </div>
  </div></>;
}
