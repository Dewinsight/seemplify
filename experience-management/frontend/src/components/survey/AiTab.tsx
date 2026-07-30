import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronDown, ChevronUp, FileText, Languages, Lightbulb, Loader2, MessageSquareText, ShieldCheck, WandSparkles
} from 'lucide-react';
import { toast } from 'sonner';
import { api, json, waitForJob } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { KnowledgeBasePicker } from '@/components/knowledge/KnowledgeBasePicker';
import type { AiJob, Survey } from '@/types';

type TranslationPayload = {
  language?: string;
  title?: string;
  description?: string;
  thankYouMessage?: string;
  questions?: Array<{ questionId?: string; title?: string; description?: string; options?: string[] }>;
};

type Insight = { id: string; kind: string; payload: any; createdAt: string };

const savedInsightKind: Record<string, string> = {
  insights: 'ai_insights',
  report: 'executive_report',
  translate: 'translation'
};

function insightLabel(insight: Insight) {
  if (insight.kind === 'translation') {
    const language = String((insight.payload as TranslationPayload)?.language || '').trim();
    return language ? `${language} translation` : 'Translation';
  }
  if (insight.kind === 'ai_insights') return 'AI insights';
  if (insight.kind === 'executive_report') return 'Executive report';
  return insight.kind.replaceAll('_', ' ');
}

function TranslationDetails({ payload }: { payload: TranslationPayload }) {
  const questions = Array.isArray(payload.questions) ? payload.questions : [];
  return <div className="space-y-5">
    <dl className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2"><dt className="text-xs font-medium text-muted-foreground">Survey title</dt><dd className="mt-1 text-sm leading-6">{payload.title || 'No translated title returned.'}</dd></div>
      <div className="sm:col-span-2"><dt className="text-xs font-medium text-muted-foreground">Description</dt><dd className="mt-1 whitespace-pre-wrap text-sm leading-6">{payload.description || 'No translated description returned.'}</dd></div>
      <div className="sm:col-span-2"><dt className="text-xs font-medium text-muted-foreground">Thank-you message</dt><dd className="mt-1 whitespace-pre-wrap text-sm leading-6">{payload.thankYouMessage || 'No translated thank-you message returned.'}</dd></div>
    </dl>
    {questions.length > 0 && <div className="border">
      <div className="border-b px-4 py-3 text-sm font-semibold">Translated questions ({questions.length})</div>
      <div className="divide-y">{questions.map((question, index) => <div className="px-4 py-3" key={question.questionId || `${index}-${question.title || 'question'}`}>
        <div className="text-sm font-medium">{index + 1}. {question.title || 'Untitled question'}</div>
        {question.description && <p className="mt-1 text-xs leading-5 text-muted-foreground">{question.description}</p>}
        {Array.isArray(question.options) && question.options.length > 0 && <p className="mt-2 text-xs leading-5 text-muted-foreground">Options: {question.options.join(' · ')}</p>}
      </div>)}</div>
    </div>}
  </div>;
}

function InsightDetails({ insight }: { insight: Insight }) {
  if (insight.kind === 'translation') return <TranslationDetails payload={(insight.payload || {}) as TranslationPayload} />;
  return <pre className="max-h-80 overflow-auto whitespace-pre-wrap border bg-muted/30 p-3 text-xs leading-5">{JSON.stringify(insight.payload, null, 2)}</pre>;
}

export function AiTab({ survey, onApplyImprovement, refreshKey }: { survey: Survey; onApplyImprovement: (values: any) => void; refreshKey: number }) {
  const [job, setJob] = useState<AiJob | null>(null);
  const [question, setQuestion] = useState('What should the team prioritise, and which responses support that conclusion?');
  const [language, setLanguage] = useState('French');
  const [answer, setAnswer] = useState<any>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(true);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [expandedInsightId, setExpandedInsightId] = useState<string | null>(null);
  const [knowledgeBaseIds, setKnowledgeBaseIds] = useState<string[]>([]);
  const insightRequestRef = useRef(0);

  const loadInsights = useCallback(async (revealKind?: string) => {
    const requestId = ++insightRequestRef.current;
    setInsightsLoading(true);
    try {
      const next = await api<Insight[]>(`/api/surveys/${survey.id}/insights`);
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
  }, [survey.id]);

  useEffect(() => { void loadInsights(); }, [loadInsights, refreshKey]);

  async function run(path: string, body: Record<string, unknown> = {}) {
    try {
      setJob(null);
      const targetLanguage = path === 'translate' ? String(body.language || '').trim() : '';
      const requestBody = path === 'translate' ? { ...body, language: targetLanguage } : { ...body, knowledgeBaseIds };
      const queued = await api<{ jobId: string }>(`/api/surveys/${survey.id}/ai/${path}`, json('POST', requestBody));
      const done = await waitForJob(queued.jobId, setJob);
      const output = done.result?.output;
      if (path === 'ask') setAnswer(output);
      if (path === 'improve') onApplyImprovement(output);
      if (savedInsightKind[path]) await loadInsights(savedInsightKind[path]);
      toast.success(path === 'translate' ? `${targetLanguage} translation saved` : 'Terra completed the request');
      return output;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Terra request failed');
      return null;
    }
  }

  const busy = job && ['queued', 'processing'].includes(job.state);
  const trimmedLanguage = language.trim();
  return <><div className="mb-5 border bg-card p-4"><KnowledgeBasePicker value={knowledgeBaseIds} onChange={setKnowledgeBaseIds} disabled={Boolean(busy)} description="Optional grounding for Ask, quality review, insights, and reports. Translation uses only the survey." /></div><div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
    <div className="space-y-5">
      <Card><CardHeader><CardTitle>Ask the research</CardTitle><CardDescription>Terra can query responses, calculated metrics, and prior insights. Answers must cite the supplied evidence.</CardDescription></CardHeader><CardContent className="space-y-3"><Textarea rows={4} value={question} onChange={(event) => setQuestion(event.target.value)} /><Button disabled={Boolean(busy) || question.trim().length < 5} onClick={() => run('ask', { question })}>{busy ? <Loader2 className="animate-spin" /> : <MessageSquareText />}Ask Terra</Button>{answer && <div className="border bg-muted/25 p-5"><div className="text-sm font-semibold">Answer</div><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{answer.answer}</p>{answer.evidence?.length > 0 && <div className="mt-4 border-t pt-3"><div className="text-xs font-medium text-muted-foreground">Evidence</div>{answer.evidence.map((citation: any, index: number) => <div className="mt-2 text-xs" key={`${citation.responseId}-${index}`}><span className="font-mono text-muted-foreground">{citation.responseId?.slice(0, 8)}</span> — “{citation.excerpt}”</div>)}</div>}</div>}</CardContent></Card>
      <Card><CardHeader><CardTitle>Generated intelligence</CardTitle><CardDescription>Saved outputs remain attached to this survey for later review and reporting.</CardDescription></CardHeader><CardContent className="px-0 pb-0">
        {insightsError && <div className="flex items-center justify-between gap-4 border-t px-5 py-4 text-sm text-destructive"><span>{insightsError}</span><Button size="sm" variant="outline" onClick={() => void loadInsights()}>Retry</Button></div>}
        {!insightsError && insightsLoading && insights.length === 0 && <div className="flex items-center justify-center gap-2 border-t px-5 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading saved intelligence</div>}
        {!insightsError && !insightsLoading && insights.length === 0 && <div className="border-t px-5 py-10 text-center text-sm text-muted-foreground">Generate insights, a report, or a translation to build the research record.</div>}
        {insights.length > 0 && <ul className="divide-y border-t" aria-label="Generated intelligence history">{insights.map((item) => {
          const expanded = expandedInsightId === item.id;
          const contentId = `insight-${item.id}`;
          return <li key={item.id}>
            <button type="button" className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-muted/25" aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpandedInsightId(expanded ? null : item.id)}>
              <span className="min-w-0 flex-1 text-sm font-medium">{insightLabel(item)}</span>
              <time className="shrink-0 text-xs font-normal text-muted-foreground" dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>
              {expanded ? <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
            </button>
            {expanded && <div id={contentId} className="border-t bg-muted/10 px-5 py-4"><InsightDetails insight={item} /></div>}
          </li>;
        })}</ul>}
      </CardContent></Card>
    </div>
    <div className="space-y-5"><Card><CardHeader><CardTitle>Experience AI tools</CardTitle><CardDescription>Every action is queued durably and uses the Experience default managed in Local Control Center.</CardDescription></CardHeader><CardContent className="space-y-2"><Button variant="outline" className="h-auto w-full justify-start py-3" disabled={Boolean(busy)} onClick={() => run('improve')}><WandSparkles /><span className="text-left"><span className="block">Quality review</span><span className="block text-xs font-normal text-muted-foreground">Bias, wording, effort and metric fit</span></span></Button><Button variant="outline" className="h-auto w-full justify-start py-3" disabled={Boolean(busy)} onClick={() => run('insights')}><Lightbulb /><span className="text-left"><span className="block">Generate insights</span><span className="block text-xs font-normal text-muted-foreground">Themes, risks and recommendations</span></span></Button><Button variant="outline" className="h-auto w-full justify-start py-3" disabled={Boolean(busy)} onClick={() => run('report', { audience: 'executive leadership' })}><FileText /><span className="text-left"><span className="block">Executive report</span><span className="block text-xs font-normal text-muted-foreground">Evidence, limitations and actions</span></span></Button><div className="border-t pt-4"><Label htmlFor="survey-translation-language">Translate survey</Label><p className="mt-1 text-xs leading-5 text-muted-foreground">Enter the language for a saved respondent-facing version.</p><div className="mt-2 flex gap-2"><Input id="survey-translation-language" value={language} onChange={(event) => setLanguage(event.target.value)} placeholder="e.g. French" autoComplete="off" /><Button variant="outline" disabled={Boolean(busy) || !trimmedLanguage} onClick={() => run('translate', { language: trimmedLanguage })}><Languages />Translate</Button></div></div></CardContent></Card>
      {job && <Card><CardHeader><div className="flex items-center justify-between"><CardTitle>Current AI job</CardTitle><span className="text-xs font-medium capitalize text-muted-foreground">{job.state}</span></div></CardHeader><CardContent><div className="h-1.5 overflow-hidden rounded-sm bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${job.progress}%` }} /></div><div className="mt-3 flex justify-between text-xs text-muted-foreground"><span>{job.stage.replaceAll('_', ' ')}</span><span>{job.progress}%</span></div>{job.stage === 'waiting_for_terra' && <p className="mt-3 text-xs leading-5 text-amber-700">Terra is unavailable. The job remains in the durable queue and will resume automatically.</p>}</CardContent></Card>}
      <div className="flex gap-3 border bg-card p-4 text-sm"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p className="leading-5 text-muted-foreground">Respondent text is treated as untrusted data. Generated claims are constrained to survey metrics and supplied response evidence.</p></div>
    </div>
  </div></>;
}
