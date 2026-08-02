import { useEffect, useState } from 'react';
import { ArrowLeft, Check, FilePlus2, Loader2, Sparkles } from 'lucide-react';
import { Link, useNavigate } from '@/lib/router';
import { toast } from 'sonner';
import { api, json, waitForJob } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { KnowledgeBasePicker } from '@/components/knowledge/KnowledgeBasePicker';
import type { AiJob, Survey, Template } from '@/types';

export function CreateSurveyPage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [brief, setBrief] = useState('');
  const [purpose, setPurpose] = useState('customer_experience');
  const [audience, setAudience] = useState('');
  const [language, setLanguage] = useState('English');
  const [knowledgeBaseIds, setKnowledgeBaseIds] = useState<string[]>([]);
  const [working, setWorking] = useState<string | null>(null);
  const [job, setJob] = useState<AiJob | null>(null);
  useEffect(() => { api<Template[]>('/api/templates').then(setTemplates); }, []);
  async function generate() {
    try {
      setWorking('ai');
      const queued = await api<{ jobId: string }>('/api/ai/surveys', json('POST', { brief, purpose, audience, language, numberOfQuestions: 10, knowledgeBaseIds }));
      const completed = await waitForJob(queued.jobId, setJob);
      const id = completed.result?.output?.survey?.id;
      if (!id) throw new Error('Generated survey was not returned.');
      toast.success('Survey draft created');
      navigate(`/surveys/${id}`);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not generate survey'); setWorking(null); }
  }
  async function createFromTemplate(template: Template) {
    try { setWorking(template.id); const result = await api<{ survey: Survey }>(`/api/templates/${template.id}/create`, json('POST')); navigate(`/surveys/${result.survey.id}`); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not create survey'); setWorking(null); }
  }
  async function createBlank() {
    try { setWorking('blank'); const survey = await api<Survey>('/api/surveys', json('POST', { title: 'Untitled survey', description: '', purpose: 'customer_experience', primaryMetric: 'custom', questions: [] })); navigate(`/surveys/${survey.id}`); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not create survey'); setWorking(null); }
  }
  return <div className="mx-auto max-w-5xl space-y-6">
    <Button variant="ghost" size="sm" asChild><Link to="/surveys"><ArrowLeft />Back to surveys</Link></Button>
    <div><h1 className="page-title">Create a survey</h1><p className="page-description">Start with a proven research structure or describe the decision you need to make.</p></div>
    <Tabs defaultValue="ai">
      <TabsList><TabsTrigger value="ai">Generate with Experience AI</TabsTrigger><TabsTrigger value="templates">Templates</TabsTrigger><TabsTrigger value="blank">Start blank</TabsTrigger></TabsList>
      <TabsContent value="ai">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <Card><CardHeader><CardTitle>Research brief</CardTitle><CardDescription>Terra will turn the objective into an unbiased, decision-ready survey.</CardDescription></CardHeader><CardContent className="space-y-4">
            <div><Label htmlFor="brief" className="field-label">What do you need to learn?</Label><Textarea id="brief" rows={7} placeholder="We need to understand why recently onboarded customers abandon setup, which steps create the most effort, and what would make them confident enough to activate..." value={brief} onChange={(event) => setBrief(event.target.value)} /></div>
            <div className="grid gap-4 sm:grid-cols-2"><div><Label className="field-label">Programme</Label><select className="h-9 w-full rounded-md border-input bg-background text-sm focus:border-ring focus:ring-ring" value={purpose} onChange={(event) => setPurpose(event.target.value)}><option value="customer_experience">Customer experience</option><option value="employee_experience">Employee experience</option><option value="market_research">Market research</option></select></div><div><Label className="field-label">Language</Label><Input value={language} onChange={(event) => setLanguage(event.target.value)} /></div></div>
            <div><Label className="field-label">Audience</Label><Input placeholder="e.g. customers in their first 30 days" value={audience} onChange={(event) => setAudience(event.target.value)} /></div>
            <KnowledgeBasePicker value={knowledgeBaseIds} onChange={setKnowledgeBaseIds} disabled={Boolean(working)} description="Optional. Select up to five sources to ground survey terminology and context." />
            <Button onClick={generate} disabled={brief.trim().length < 10 || Boolean(working)}>{working === 'ai' ? <Loader2 className="animate-spin" /> : <Sparkles />}Generate survey</Button>
            {job && <div className="border bg-muted/30 p-4 text-sm"><div className="flex justify-between"><span className="font-medium">{job.stage.replaceAll('_', ' ')}</span><span>{job.progress}%</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-sm bg-secondary"><div className="h-full bg-primary transition-all" style={{ width: `${job.progress}%` }} /></div><p className="mt-2 text-xs text-muted-foreground">This job is durable. You can leave the page while Terra works.</p></div>}
          </CardContent></Card>
          <div className="border bg-card p-5"><div className="font-semibold">What Terra checks</div><ul className="mt-4 space-y-3 text-sm text-muted-foreground">{['Metric fit and decision relevance', 'Neutral and inclusive wording', 'Respondent effort and survey length', 'Closed and open evidence balance', 'Actionable follow-up questions'].map((item) => <li className="flex gap-2" key={item}><Check className="mt-0.5 h-4 w-4 text-primary" />{item}</li>)}</ul></div>
        </div>
      </TabsContent>
      <TabsContent value="templates"><div className="grid gap-4 md:grid-cols-2">{templates.map((template) => <Card key={template.id} className="flex flex-col"><CardHeader><CardTitle>{template.name}</CardTitle><CardDescription>{template.description}</CardDescription></CardHeader><CardContent className="mt-auto"><div className="mb-4 flex gap-4 text-xs text-muted-foreground"><span>{template.questions.length} questions</span><span className="uppercase">{template.primaryMetric}</span></div><Button variant="outline" onClick={() => createFromTemplate(template)} disabled={Boolean(working)}>{working === template.id ? <Loader2 className="animate-spin" /> : <FilePlus2 />}Use template</Button></CardContent></Card>)}</div></TabsContent>
      <TabsContent value="blank"><Card><CardHeader><CardTitle>Blank survey</CardTitle><CardDescription>Create the structure yourself and use Terra later for quality review or translation.</CardDescription></CardHeader><CardContent><Button onClick={createBlank} disabled={Boolean(working)}>{working === 'blank' ? <Loader2 className="animate-spin" /> : <FilePlus2 />}Create blank survey</Button></CardContent></Card></TabsContent>
    </Tabs>
  </div>;
}
