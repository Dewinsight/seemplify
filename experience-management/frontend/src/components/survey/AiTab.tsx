import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpenCheck, Check, ChevronDown, ChevronUp, FileText, Languages, Lightbulb, Loader2, MessageSquareText, ShieldCheck, WandSparkles
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

type TranslationRun = {
  phase: 'submitting' | 'queued' | 'processing' | 'completed' | 'error';
  language: string;
  progress: number;
  insightId?: string;
  error?: string;
};

type Insight = { id: string; kind: string; payload: any; createdAt: string };

const savedInsightKind: Record<string, string> = {
  insights: 'ai_insights',
  report: 'executive_report',
  translate: 'translation',
  ask: 'research_answer'
};

function insightLabel(insight: Insight) {
  if (insight.kind === 'translation') {
    const language = String((insight.payload as TranslationPayload)?.language || '').trim();
    return language ? `${language} translation` : 'Translation';
  }
  if (insight.kind === 'ai_insights') return 'AI insights';
  if (insight.kind === 'executive_report') return 'Executive report';
  if (insight.kind === 'research_answer') return 'Research answer';
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

export function AiTab({ survey, hasUnsavedChanges, onApplyImprovement, refreshKey }: { survey: Survey; hasUnsavedChanges: boolean; onApplyImprovement: (values: any) => void; refreshKey: number }) {
  const [job, setJob] = useState<AiJob | null>(null);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [question, setQuestion] = useState('What should the team prioritise, and which responses support that conclusion?');
  const [language, setLanguage] = useState('French');
  const [translationRun, setTranslationRun] = useState<TranslationRun | null>(null);
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
      const next = loaded.filter((item) => ['ai_insights', 'executive_report', 'research_answer', 'translation'].includes(item.kind));
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
    setTranslationRun(null);
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

  function viewSavedInsight(insightId: string) {
    setExpandedInsightId(insightId);
    window.requestAnimationFrame(() => {
      const row = document.getElementById(`insight-row-${insightId}`);
      row?.scrollIntoView({ block: 'nearest' });
      row?.querySelector<HTMLButtonElement>('button')?.focus();
    });
  }

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
    const targetLanguage = path === 'translate' ? String(body.language || '').trim() : '';
    try {
      setActiveAction(path);
      setJob(null);
      if (path === 'translate') setTranslationRun({ phase: 'submitting', language: targetLanguage, progress: 0 });
      const requestBody = path === 'translate'
        ? { ...body, language: targetLanguage }
        : knowledgeBaseIds === null ? body : { ...body, knowledgeBaseIds };
      const queued = await api<{ jobId: string }>(`/api/surveys/${survey.id}/ai/${path}`, json('POST', requestBody));
      if (path === 'translate') setTranslationRun({ phase: 'queued', language: targetLanguage, progress: 0 });
      const done = await waitForJob(queued.jobId, (nextJob) => {
        setJob(nextJob);
        if (path === 'translate' && (nextJob.state === 'queued' || nextJob.state === 'processing')) {
          setTranslationRun({ phase: nextJob.state, language: targetLanguage, progress: nextJob.progress });
        }
      });
      const output = done.result?.output;
      if (path === 'ask') setAnswer(output);
      if (path === 'improve') onApplyImprovement(output);
      let savedInsightId: string | undefined;
      if (savedInsightKind[path]) {
        const refreshedInsights = await loadInsights(savedInsightKind[path]);
        savedInsightId = refreshedInsights.find((item) => item.kind === savedInsightKind[path])?.id;
      }
      if (path === 'translate') setTranslationRun({ phase: 'completed', language: targetLanguage, progress: 100, insightId: savedInsightId });
      toast.success(path === 'translate' ? `${targetLanguage} translation saved` : 'Terra completed the request');
      return output;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Terra request failed';
      if (path === 'translate') setTranslationRun({ phase: 'error', language: targetLanguage, progress: 0, error: message });
      toast.error(message);
      return null;
    } finally {
      setActiveAction(null);
    }
  }

  const busy = Boolean(activeAction) || Boolean(job && ['queued', 'processing'].includes(job.state));
  const actionsDisabled = busy || hasUnsavedChanges || knowledgeSelectionLoading || knowledgeSelectionSaving;
  const trimmedLanguage = language.trim();
  const hasQuestions = (survey.questions?.length || 0) > 0;
  const translating = translationRun ? ['submitting', 'queued', 'processing'].includes(translationRun.phase) : false;
  const translateButtonLabel = translationRun?.phase === 'submitting' ? 'Queuing'
    : translationRun?.phase === 'queued' ? 'Queued'
      : translationRun?.phase === 'processing' ? 'Translating' : 'Translate';
  return <><div className="mb-5 border bg-card p-4"><KnowledgeBasePicker value={knowledgeBaseIds || []} onChange={(ids) => void saveKnowledgeSelection(ids)} disabled={actionsDisabled} description={knowledgeBaseIds === null ? 'Loading the survey’s saved knowledge selection.' : knowledgeSelectionSaving ? 'Saving this selection for survey AI and automatic response analysis.' : 'Saved grounding for Ask, quality review, response analysis, survey intelligence, reports, and publishing reviewed answers.'} /></div><div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
    <div className="space-y-5">
      <Card><CardHeader><CardTitle>Ask the research</CardTitle><CardDescription>Terra can query responses, calculated metrics, and prior insights. Answers must cite the supplied evidence.</CardDescription></CardHeader><CardContent className="space-y-3"><Textarea rows={4} value={question} onChange={(event) => setQuestion(event.target.value)} /><Button disabled={actionsDisabled || question.trim().length < 5} onClick={() => run('ask', { question })}>{busy ? <Loader2 className="animate-spin" /> : <MessageSquareText />}Ask Terra</Button>{answer && <div className="border bg-muted/25 p-5"><div className="text-sm font-semibold">Answer</div><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{answer.answer}</p>{answer.evidence?.length > 0 && <div className="mt-4 border-t pt-3"><div className="text-xs font-medium text-muted-foreground">Evidence</div>{answer.evidence.map((citation: any, index: number) => <div className="mt-2 text-xs" key={`${citation.responseId}-${index}`}><span className="font-mono text-muted-foreground">{citation.responseId?.slice(0, 8)}</span> — “{citation.excerpt}”</div>)}</div>}</div>}</CardContent></Card>
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
    <div className="space-y-5"><Card><CardHeader><CardTitle>Experience AI tools</CardTitle><CardDescription>Every action is queued durably and uses the Experience default managed in Local Control Center.</CardDescription></CardHeader><CardContent className="space-y-2">{hasUnsavedChanges && <p className="mb-3 border px-3 py-2 text-xs leading-5 text-amber-700">Save changes before using Terra so it works from the latest survey.</p>}<Button variant="outline" className="h-auto w-full justify-start py-3" disabled={actionsDisabled} onClick={() => run('improve')}><WandSparkles /><span className="text-left"><span className="block">Quality review</span><span className="block text-xs font-normal text-muted-foreground">Bias, wording, effort and metric fit</span></span></Button><Button variant="outline" className="h-auto w-full justify-start py-3" disabled={actionsDisabled} onClick={() => run('insights')}><Lightbulb /><span className="text-left"><span className="block">Generate insights</span><span className="block text-xs font-normal text-muted-foreground">Themes, risks and recommendations</span></span></Button><Button variant="outline" className="h-auto w-full justify-start py-3" disabled={actionsDisabled} onClick={() => run('report', { audience: 'executive leadership' })}><FileText /><span className="text-left"><span className="block">Executive report</span><span className="block text-xs font-normal text-muted-foreground">Evidence, limitations and actions</span></span></Button><div className="border-t pt-4"><Label htmlFor="survey-translation-language">Translate survey</Label><p className="mt-1 text-xs leading-5 text-muted-foreground">Enter the language for a saved respondent-facing version.</p><div className="mt-2 flex gap-2"><Input id="survey-translation-language" value={language} onChange={(event) => setLanguage(event.target.value)} placeholder="e.g. French" autoComplete="off" /><Button variant="outline" aria-busy={translating} disabled={actionsDisabled || !trimmedLanguage || !hasQuestions} onClick={() => run('translate', { language: trimmedLanguage })}>{translating ? <Loader2 className="animate-spin" /> : <Languages />}{translateButtonLabel}</Button></div>{!hasQuestions && <p className="mt-2 text-xs leading-5 text-amber-700">Add at least one question before translating.</p>}{translationRun && <div className={`mt-3 border px-3 py-2 text-xs ${translationRun.phase === 'error' ? 'border-destructive/40 text-destructive' : 'text-muted-foreground'}`} role={translationRun.phase === 'error' ? 'alert' : 'status'} aria-live="polite"><div className="flex flex-col items-start gap-2"><span className="leading-5">{translationRun.phase === 'submitting' && `Sending the ${translationRun.language} translation request.`}{translationRun.phase === 'queued' && `${translationRun.language} translation queued. Waiting for Terra.`}{translationRun.phase === 'processing' && `Translating survey into ${translationRun.language}, ${translationRun.progress}% complete.`}{translationRun.phase === 'completed' && `${translationRun.language} translation saved.`}{translationRun.phase === 'error' && (translationRun.error || `${translationRun.language} translation failed.`)}</span>{translationRun.phase === 'completed' && translationRun.insightId && <Button type="button" size="sm" variant="outline" onClick={() => viewSavedInsight(translationRun.insightId!)}>View saved translation</Button>}</div></div>}</div></CardContent></Card>
      {job && <Card><CardHeader><div className="flex items-center justify-between"><CardTitle>Current AI job</CardTitle><span className="text-xs font-medium capitalize text-muted-foreground">{job.state}</span></div></CardHeader><CardContent><div className="h-1.5 overflow-hidden rounded-sm bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${job.progress}%` }} /></div><div className="mt-3 flex justify-between text-xs text-muted-foreground"><span>{job.stage.replaceAll('_', ' ')}</span><span>{job.progress}%</span></div>{job.stage === 'waiting_for_terra' && <p className="mt-3 text-xs leading-5 text-amber-700">Terra is unavailable. The job remains in the durable queue and will resume automatically.</p>}</CardContent></Card>}
      <div className="flex gap-3 border bg-card p-4 text-sm"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p className="leading-5 text-muted-foreground">Respondent text is treated as untrusted data. Generated claims are constrained to survey metrics and supplied response evidence.</p></div>
    </div>
  </div></>;
}
