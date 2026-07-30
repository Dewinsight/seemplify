import { useEffect, useState } from 'react';
import { FileText, Languages, Lightbulb, Loader2, MessageSquareText, ShieldCheck, WandSparkles } from 'lucide-react';
import { toast } from 'sonner';
import { api, json, waitForJob } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { KnowledgeBasePicker } from '@/components/knowledge/KnowledgeBasePicker';
import type { AiJob, Survey } from '@/types';

type Insight = { id: string; kind: string; payload: any; createdAt: string };

export function AiTab({ survey, onApplyImprovement, refreshKey }: { survey: Survey; onApplyImprovement: (values: any) => void; refreshKey: number }) {
  const [job, setJob] = useState<AiJob | null>(null);
  const [question, setQuestion] = useState('What should the team prioritise, and which responses support that conclusion?');
  const [language, setLanguage] = useState('French');
  const [answer, setAnswer] = useState<any>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [knowledgeBaseIds, setKnowledgeBaseIds] = useState<string[]>([]);
  useEffect(() => { api<Insight[]>(`/api/surveys/${survey.id}/insights`).then(setInsights); }, [survey.id, refreshKey, job?.state]);

  async function run(path: string, body: Record<string, unknown> = {}) {
    try {
      setJob(null);
      const groundedBody = path === 'translate' ? body : { ...body, knowledgeBaseIds };
      const queued = await api<{ jobId: string }>(`/api/surveys/${survey.id}/ai/${path}`, json('POST', groundedBody));
      const done = await waitForJob(queued.jobId, setJob);
      const output = done.result?.output;
      if (path === 'ask') setAnswer(output);
      if (path === 'improve') onApplyImprovement(output);
      toast.success('Terra completed the request');
      return output;
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Terra request failed'); return null; }
  }
  const busy = job && ['queued', 'processing'].includes(job.state);
  return <><div className="mb-5 border bg-card p-4"><KnowledgeBasePicker value={knowledgeBaseIds} onChange={setKnowledgeBaseIds} disabled={Boolean(busy)} description="Optional grounding for Ask, quality review, insights, and reports. Translation uses only the survey." /></div><div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
    <div className="space-y-5">
      <Card><CardHeader><CardTitle>Ask the research</CardTitle><CardDescription>Terra can query responses, calculated metrics, and prior insights. Answers must cite the supplied evidence.</CardDescription></CardHeader><CardContent className="space-y-3"><Textarea rows={4} value={question} onChange={(event) => setQuestion(event.target.value)} /><Button disabled={Boolean(busy) || question.trim().length < 5} onClick={() => run('ask', { question })}>{busy ? <Loader2 className="animate-spin" /> : <MessageSquareText />}Ask Terra</Button>{answer && <div className="border bg-muted/25 p-5"><div className="text-sm font-semibold">Answer</div><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{answer.answer}</p>{answer.evidence?.length > 0 && <div className="mt-4 border-t pt-3"><div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Evidence</div>{answer.evidence.map((citation: any, index: number) => <div className="mt-2 text-xs" key={`${citation.responseId}-${index}`}><span className="font-mono text-muted-foreground">{citation.responseId?.slice(0, 8)}</span> — “{citation.excerpt}”</div>)}</div>}</div>}</CardContent></Card>
      <Card><CardHeader><CardTitle>Generated intelligence</CardTitle><CardDescription>Saved outputs remain attached to this survey for later review and reporting.</CardDescription></CardHeader><CardContent className="px-0 pb-0">{insights.length ? <div className="divide-y border-t">{insights.map((item) => <details className="group px-5 py-4" key={item.id}><summary className="cursor-pointer list-none text-sm font-medium capitalize">{item.kind.replaceAll('_', ' ')}<span className="float-right text-xs font-normal text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</span></summary><pre className="mt-4 max-h-80 overflow-auto whitespace-pre-wrap border bg-muted/30 p-3 text-xs leading-5">{JSON.stringify(item.payload, null, 2)}</pre></details>)}</div> : <div className="border-t px-5 py-10 text-center text-sm text-muted-foreground">Generate insights, a report, or a translation to build the research record.</div>}</CardContent></Card>
    </div>
    <div className="space-y-5"><Card><CardHeader><CardTitle>Experience AI tools</CardTitle><CardDescription>Every action is queued durably and uses the Experience default managed in Local Control Center.</CardDescription></CardHeader><CardContent className="space-y-2"><Button variant="outline" className="h-auto w-full justify-start py-3" disabled={Boolean(busy)} onClick={() => run('improve')}><WandSparkles /><span className="text-left"><span className="block">Quality review</span><span className="block text-xs font-normal text-muted-foreground">Bias, wording, effort and metric fit</span></span></Button><Button variant="outline" className="h-auto w-full justify-start py-3" disabled={Boolean(busy)} onClick={() => run('insights')}><Lightbulb /><span className="text-left"><span className="block">Generate insights</span><span className="block text-xs font-normal text-muted-foreground">Themes, risks and recommendations</span></span></Button><Button variant="outline" className="h-auto w-full justify-start py-3" disabled={Boolean(busy)} onClick={() => run('report', { audience: 'executive leadership' })}><FileText /><span className="text-left"><span className="block">Executive report</span><span className="block text-xs font-normal text-muted-foreground">Evidence, limitations and actions</span></span></Button><div className="flex gap-2 pt-2"><Input value={language} onChange={(event) => setLanguage(event.target.value)} aria-label="Translation language" /><Button variant="outline" disabled={Boolean(busy) || !language.trim()} onClick={() => run('translate', { language })}><Languages /><span className="sr-only sm:not-sr-only">Translate</span></Button></div></CardContent></Card>
      {job && <Card><CardHeader><div className="flex items-center justify-between"><CardTitle>Current AI job</CardTitle><span className="text-xs font-medium capitalize text-muted-foreground">{job.state}</span></div></CardHeader><CardContent><div className="h-1.5 overflow-hidden rounded-sm bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${job.progress}%` }} /></div><div className="mt-3 flex justify-between text-xs text-muted-foreground"><span>{job.stage.replaceAll('_', ' ')}</span><span>{job.progress}%</span></div>{job.stage === 'waiting_for_terra' && <p className="mt-3 text-xs leading-5 text-amber-700">Terra is unavailable. The job remains in the durable queue and will resume automatically.</p>}</CardContent></Card>}
      <div className="flex gap-3 border bg-card p-4 text-sm"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p className="leading-5 text-muted-foreground">Respondent text is treated as untrusted data. Generated claims are constrained to survey metrics and supplied response evidence.</p></div>
    </div>
  </div></>;
}
