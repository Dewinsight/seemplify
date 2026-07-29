import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, CircleGauge, Loader2, Map, Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, json, waitForJob } from '@/lib/api';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { formatDate } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { AiJob, Journey, JourneyStage } from '@/types';

function DetailList({ title, values }: { title: string; values: string[] }) {
  return <div><div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>{values.length ? <ul className="space-y-1.5 text-xs leading-5">{values.slice(0, 4).map((value) => <li className="flex gap-2" key={value}><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary" />{value}</li>)}</ul> : <div className="text-xs text-muted-foreground">Not specified</div>}</div>;
}

function StageCard({ stage, index }: { stage: JourneyStage; index: number }) {
  return <article className="relative border bg-card p-5 shadow-panel">
    <div className="mb-4 flex items-start gap-3"><div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-secondary text-xs font-semibold text-secondary-foreground">{index + 1}</div><div><h3 className="text-sm font-semibold">{stage.name}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{stage.goal}</p></div></div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1"><DetailList title="Touchpoints" values={stage.touchpoints} /><DetailList title="Customer actions" values={stage.customerActions} /><DetailList title="Emotions" values={stage.emotions} /><DetailList title="Pain points" values={stage.painPoints} /><DetailList title="Measures" values={stage.metrics} /><DetailList title="Recommended actions" values={stage.recommendedActions} /></div>
  </article>;
}

export function JourneysPage() {
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [jobs, setJobs] = useState<AiJob[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [brief, setBrief] = useState('Map the complete experience from first discovery through onboarding, regular use, support, renewal, and advocacy.');
  const [audience, setAudience] = useState('New and existing customers');
  const [industry, setIndustry] = useState('B2B software');
  const [objective, setObjective] = useState('Reduce onboarding friction and improve retention');
  const [focus, setFocus] = useState('Find missing touchpoints, friction, ownership gaps, and measurable improvements.');
  const [working, setWorking] = useState(false);

  const load = useCallback(() => Promise.all([api<Journey[]>('/api/journeys'), api<AiJob[]>('/api/ai/jobs?limit=500')]).then(([nextJourneys, nextJobs]) => {
    setJourneys(nextJourneys); setJobs(nextJobs);
    setSelectedId((current) => current && nextJourneys.some((journey) => journey.id === current) ? current : (nextJourneys[0]?.id || ''));
  }), []);
  useEffect(() => { void load(); }, [load]);
  useLiveRefresh(load);
  const selected = journeys.find((journey) => journey.id === selectedId) || null;
  const journeyJobs = useMemo(() => jobs.filter((job) => job.kind === 'journey.generate' || job.kind === 'journey.optimize'), [jobs]);
  const activeJobs = journeyJobs.filter((job) => job.state === 'queued' || job.state === 'processing');

  async function generateJourney() {
    if (brief.trim().length < 10) return toast.error('Add a more detailed journey brief.');
    setWorking(true);
    try {
      const queued = await api<{ jobId: string }>('/api/ai/journeys', json('POST', { brief, audience, industry, objective }));
      toast.success('Journey generation queued with Terra.');
      const job = await waitForJob(queued.jobId, () => void load());
      const journey = job.result?.output?.journey as Journey | undefined;
      await load(); if (journey?.id) setSelectedId(journey.id);
      toast.success('Journey map is ready.');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not generate journey.'); }
    finally { setWorking(false); }
  }

  async function optimizeJourney() {
    if (!selected) return;
    setWorking(true);
    try {
      const queued = await api<{ jobId: string }>(`/api/journeys/${selected.id}/ai/optimize`, json('POST', { focus }));
      toast.success('Journey audit queued with Terra.');
      await waitForJob(queued.jobId, () => void load()); await load();
      toast.success('Journey improvements applied.');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not optimize journey.'); }
    finally { setWorking(false); }
  }

  async function removeJourney() {
    if (!selected || !window.confirm(`Delete “${selected.name}”?`)) return;
    try { await api(`/api/journeys/${selected.id}`, { method: 'DELETE' }); setSelectedId(''); await load(); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not delete journey.'); }
  }

  return <div className="space-y-6">
    <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
      <div><h1 className="page-title">Customer journeys</h1><p className="page-description">Map every stage, touchpoint, emotion, friction point, and measure—then ask Terra to expose gaps and strengthen the plan.</p></div>
      <div className="flex items-center gap-2"><Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw />Refresh</Button>{activeJobs.length > 0 && <Badge variant="warning">{activeJobs.length} Terra job{activeJobs.length === 1 ? '' : 's'} active</Badge>}</div>
    </div>

    <div className="grid items-start gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
      <div className="space-y-6">
        <Card>
          <CardHeader><CardTitle>Generate a journey</CardTitle><CardDescription>Describe the real customer lifecycle and the decision this map needs to support.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2"><Label htmlFor="journey-brief">Journey brief</Label><Textarea id="journey-brief" rows={5} value={brief} onChange={(event) => setBrief(event.target.value)} /></div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1"><div className="space-y-2"><Label htmlFor="journey-audience">Audience</Label><Input id="journey-audience" value={audience} onChange={(event) => setAudience(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="journey-industry">Industry</Label><Input id="journey-industry" value={industry} onChange={(event) => setIndustry(event.target.value)} /></div></div>
            <div className="space-y-2"><Label htmlFor="journey-objective">Business objective</Label><Textarea id="journey-objective" rows={3} value={objective} onChange={(event) => setObjective(event.target.value)} /></div>
            <Button className="w-full" onClick={generateJourney} disabled={working}>{working ? <Loader2 className="animate-spin" /> : <Sparkles />}Generate with Terra</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Saved maps</CardTitle><CardDescription>{journeys.length} journey{journeys.length === 1 ? '' : 's'} in this workspace</CardDescription></CardHeader>
          <CardContent className="space-y-2">{journeys.length ? journeys.map((journey) => <button key={journey.id} onClick={() => setSelectedId(journey.id)} className={`w-full border p-3 text-left transition-colors hover:bg-muted/40 ${selectedId === journey.id ? 'border-primary bg-secondary/60' : ''}`}><div className="text-sm font-medium">{journey.name}</div><div className="mt-1 flex items-center justify-between gap-3 text-xs text-muted-foreground"><span>{journey.stages.length} stages</span><span>{formatDate(journey.updatedAt)}</span></div></button>) : <div className="py-8 text-center text-sm text-muted-foreground"><Map className="mx-auto mb-3 h-5 w-5" />No journey maps yet.</div>}</CardContent>
        </Card>
      </div>

      {selected ? <div className="space-y-6">
        <Card>
          <CardHeader className="border-b"><div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start"><div><div className="mb-2 flex flex-wrap items-center gap-2"><Badge variant="secondary">{selected.industry || 'General'}</Badge><Badge variant="outline">{selected.stages.length} stages</Badge></div><CardTitle className="text-xl">{selected.name}</CardTitle><CardDescription className="mt-2 max-w-3xl leading-6">{selected.summary}</CardDescription></div><Button variant="ghost" size="icon" aria-label="Delete journey" onClick={removeJourney}><Trash2 /></Button></div></CardHeader>
          <CardContent className="grid gap-4 pt-5 md:grid-cols-2"><div><div className="text-xs font-medium text-muted-foreground">Audience</div><div className="mt-1 text-sm">{selected.audience || 'Not specified'}</div></div><div><div className="text-xs font-medium text-muted-foreground">Objective</div><div className="mt-1 text-sm">{selected.objective || 'Not specified'}</div></div></CardContent>
        </Card>

        <section aria-label="Journey stages"><div className="mb-3 flex items-center justify-between"><h2 className="text-base font-semibold">Journey stages</h2><span className="text-xs text-muted-foreground">Discovery <ArrowRight className="mx-1 inline h-3 w-3" /> Outcome</span></div><div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">{selected.stages.map((stage, index) => <StageCard key={`${stage.name}-${index}`} stage={stage} index={index} />)}</div></section>

        <Card>
          <CardHeader><div className="flex items-start gap-3"><CircleGauge className="mt-0.5 h-5 w-5 text-primary" /><div><CardTitle>Audit this journey with Terra</CardTitle><CardDescription className="mt-1">Use a specific focus to identify missing touchpoints, weak measures, and actions without an owner or outcome.</CardDescription></div></div></CardHeader>
          <CardContent className="space-y-3"><Label htmlFor="journey-focus">Audit focus</Label><Textarea id="journey-focus" rows={3} value={focus} onChange={(event) => setFocus(event.target.value)} /><Button onClick={optimizeJourney} disabled={working}>{working ? <Loader2 className="animate-spin" /> : <Sparkles />}Audit and improve</Button></CardContent>
        </Card>
      </div> : <Card className="min-h-[460px]"><CardContent className="grid min-h-[460px] place-items-center"><div className="max-w-md text-center"><Map className="mx-auto h-8 w-8 text-muted-foreground" /><h2 className="mt-4 text-base font-semibold">Build the first journey map</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Give Terra a concrete customer lifecycle and business objective. The resulting map will remain editable and available after restarts.</p><Button className="mt-5" onClick={generateJourney} disabled={working}>{working ? <Loader2 className="animate-spin" /> : <Plus />}Generate journey</Button></div></CardContent></Card>}
    </div>
  </div>;
}
