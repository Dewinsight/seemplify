import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, ArrowLeft, ArrowRight, CheckSquare, ChevronLeft, ChevronRight, CircleGauge,
  FileJson, FileSpreadsheet, History, Loader2, Map, MessageSquareText, MousePointer2,
  Pencil, Plus, RefreshCw, RotateCcw, Search, Sparkles, Target, Trash2, UsersRound
} from 'lucide-react';
import { Link } from 'wouter';
import { toast } from 'sonner';
import { api, ApiError, json, spaceScopedApiUrl, waitForJob } from '@/lib/api';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { formatDate, formatDateTime } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { AiJob, Journey, JourneyStage, JourneyVersion } from '@/types';

type WorkingAction = 'generate' | 'optimize' | 'save' | 'restore' | 'delete' | null;

interface MetadataDraft {
  name: string;
  audience: string;
  industry: string;
  objective: string;
  summary: string;
}

interface StageDraft {
  name: string;
  goal: string;
  touchpoints: string;
  customerActions: string;
  emotions: string;
  painPoints: string;
  opportunities: string;
  recommendedActions: string;
  metrics: string;
}

interface StageEditorState {
  index: number | null;
  expectedUpdatedAt: string;
  draft: StageDraft;
}

const emptyStageDraft: StageDraft = {
  name: '', goal: '', touchpoints: '', customerActions: '', emotions: '', painPoints: '', opportunities: '',
  recommendedActions: '', metrics: ''
};

function toStageDraft(stage: JourneyStage): StageDraft {
  return {
    name: stage.name,
    goal: stage.goal,
    touchpoints: stage.touchpoints.join('\n'),
    customerActions: stage.customerActions.join('\n'),
    emotions: stage.emotions.join('\n'),
    painPoints: stage.painPoints.join('\n'),
    opportunities: stage.opportunities.join('\n'),
    recommendedActions: stage.recommendedActions.join('\n'),
    metrics: stage.metrics.join('\n')
  };
}

function parseLines(value: string) {
  return Array.from(new Set(value.split('\n').map((item) => item.trim()).filter(Boolean)));
}

function fromStageDraft(draft: StageDraft): JourneyStage {
  return {
    name: draft.name.trim(),
    goal: draft.goal.trim(),
    touchpoints: parseLines(draft.touchpoints),
    customerActions: parseLines(draft.customerActions),
    emotions: parseLines(draft.emotions),
    painPoints: parseLines(draft.painPoints),
    opportunities: parseLines(draft.opportunities),
    recommendedActions: parseLines(draft.recommendedActions),
    metrics: parseLines(draft.metrics)
  };
}

function DetailGroup({ title, values, empty }: { title: string; values: string[]; empty: string }) {
  return <section className="border-t px-4 py-4 first:border-t-0" aria-label={title}>
    <h4 className="text-sm font-semibold">{title}</h4>
    {values.length ? <ul className="mt-2 space-y-2 text-sm leading-5">
      {values.map((value) => <li className="flex gap-2.5" key={value}>
        <span className="mt-[0.55rem] h-1 w-1 shrink-0 rounded-full bg-muted-foreground" aria-hidden="true" />
        <span>{value}</span>
      </li>)}
    </ul> : <p className="mt-1.5 text-sm text-muted-foreground">{empty}</p>}
  </section>;
}

function ReviewColumn({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <section className="overflow-hidden border bg-card">
    <header className="border-b bg-muted/25 px-4 py-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
    </header>
    {children}
  </section>;
}

function StageTimeline({
  stages, selectedIndex, onSelect, onAdd
}: { stages: JourneyStage[]; selectedIndex: number; onSelect: (index: number) => void; onAdd: () => void }) {
  const selectedButton = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    selectedButton.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, [selectedIndex, stages.length]);

  if (!stages.length) return <div className="border border-dashed bg-muted/15 p-8 text-center">
    <Map className="mx-auto h-6 w-6 text-muted-foreground" />
    <p className="mt-3 text-sm font-medium">This journey has no stages</p>
    <p className="mt-1 text-sm text-muted-foreground">Add the first stage to map what the customer is trying to accomplish.</p>
    <Button className="mt-4" size="sm" onClick={onAdd}><Plus />Add stage</Button>
  </div>;

  return <div className="overflow-x-auto pb-2" tabIndex={0} aria-label="Scrollable journey stages">
    <ol className="flex min-w-max items-stretch" aria-label="Journey stages">
      {stages.map((stage, index) => <li className="flex items-center" key={`${stage.name}-${index}`}>
        <button
          type="button"
          ref={selectedIndex === index ? selectedButton : undefined}
          aria-current={selectedIndex === index ? 'step' : undefined}
          aria-label={`Stage ${index + 1}: ${stage.name}`}
          onClick={() => onSelect(index)}
          className={`min-h-[154px] w-[220px] border bg-card p-4 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${selectedIndex === index ? 'border-primary bg-accent/45 shadow-panel' : 'hover:border-input hover:bg-muted/25'}`}
        >
          <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <span className={`grid h-5 w-5 place-items-center rounded-sm border ${selectedIndex === index ? 'border-primary bg-primary text-primary-foreground' : 'bg-background'}`}>{index + 1}</span>
            Stage {index + 1}
          </span>
          <span className="mt-3 block text-sm font-semibold text-foreground">{stage.name || 'Untitled stage'}</span>
          <span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">{stage.goal || 'No customer goal recorded.'}</span>
          <span className="mt-3 block border-t pt-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Measure:</span> {stage.metrics[0] || 'Not set'}
          </span>
        </button>
        {index < stages.length - 1 && <ArrowRight className="mx-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
      </li>)}
      <li className="ml-3 flex items-center">
        <Button variant="outline" size="sm" onClick={onAdd}><Plus />Add stage</Button>
      </li>
    </ol>
  </div>;
}

function StageTextArea({
  id, label, value, onChange, placeholder, rows = 3
}: { id: string; label: string; value: string; onChange: (value: string) => void; placeholder: string; rows?: number }) {
  return <div className="space-y-1.5">
    <Label htmlFor={id}>{label}</Label>
    <Textarea id={id} rows={rows} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    <p className="text-xs text-muted-foreground">One item per line</p>
  </div>;
}

function EvidenceNotice({ journey }: { journey: Journey }) {
  const basis = journey.provenance?.evidenceBasis || 'unknown';
  const explanation = basis === 'brief_only'
    ? 'Terra created this map from the written brief. It has not analysed survey responses, interviews, tickets, or social posts for this map.'
    : basis === 'workspace_authored'
      ? 'Your team authored or edited this map. The statements are still working assumptions until they are checked against customer research.'
      : 'The evidence source for this older map is unknown. Treat its statements as assumptions until they are checked against customer research.';

  return <aside className="border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950" aria-label="Journey evidence status">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex max-w-3xl gap-3">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold">Evidence level: hypothesis</p>
          <p className="mt-1 text-sm leading-5">{explanation}</p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button variant="outline" size="sm" asChild><Link to="/surveys">Validate with surveys</Link></Button>
        <Button variant="outline" size="sm" asChild><Link to="/social-listening">Check social evidence</Link></Button>
      </div>
    </div>
  </aside>;
}

function versionReason(reason: JourneyVersion['reason']) {
  if (reason === 'terra_optimize') return 'Before a Terra audit';
  if (reason === 'restore_displaced') return 'Before a version restore';
  return 'Before a workspace edit';
}

export function JourneysPage() {
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [jobs, setJobs] = useState<AiJob[]>([]);
  const [versions, setVersions] = useState<JourneyVersion[]>([]);
  const [versionsError, setVersionsError] = useState('');
  const loadRequest = useRef(0);
  const versionsRequest = useRef(0);
  const [selectedId, setSelectedId] = useState('');
  const [selectedStageIndex, setSelectedStageIndex] = useState(0);
  const [search, setSearch] = useState('');
  const [brief, setBrief] = useState('Map the complete experience from first discovery through onboarding, regular use, support, renewal, and advocacy.');
  const [audience, setAudience] = useState('New and existing customers');
  const [industry, setIndustry] = useState('B2B software');
  const [objective, setObjective] = useState('Reduce onboarding friction and improve retention');
  const [focus, setFocus] = useState('Find missing touchpoints, friction, ownership gaps, and measurable improvements.');
  const [workingAction, setWorkingAction] = useState<WorkingAction>(null);
  const [restoringVersionId, setRestoringVersionId] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [metadataExpectedUpdatedAt, setMetadataExpectedUpdatedAt] = useState('');
  const [metadataDraft, setMetadataDraft] = useState<MetadataDraft>({ name: '', audience: '', industry: '', objective: '', summary: '' });
  const [stageEditor, setStageEditor] = useState<StageEditorState | null>(null);

  const load = useCallback(async () => {
    const request = ++loadRequest.current;
    try {
      const [nextJourneys, nextJobs] = await Promise.all([
        api<Journey[]>('/api/journeys'), api<AiJob[]>('/api/ai/jobs?limit=500')
      ]);
      if (request !== loadRequest.current) return;
      setJourneys(nextJourneys);
      setJobs(nextJobs);
      setSelectedId((current) => current && nextJourneys.some((journey) => journey.id === current)
        ? current
        : (nextJourneys[0]?.id || ''));
      setLoadError('');
    } catch (error) {
      if (request !== loadRequest.current) return;
      setLoadError(error instanceof Error ? error.message : 'Could not load journey maps.');
    } finally {
      if (request === loadRequest.current) setLoading(false);
    }
  }, []);

  const loadVersions = useCallback(async (journeyId: string) => {
    const request = ++versionsRequest.current;
    if (!journeyId) {
      setVersions([]);
      setVersionsError('');
      return;
    }
    setVersions([]);
    setVersionsError('');
    try {
      const nextVersions = await api<JourneyVersion[]>(`/api/journeys/${journeyId}/versions?limit=10`);
      if (request !== versionsRequest.current) return;
      setVersions(nextVersions);
      setVersionsError('');
    } catch (error) {
      if (request !== versionsRequest.current) return;
      setVersionsError(error instanceof Error ? error.message : 'Could not load version history.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useLiveRefresh(load);

  const selected = journeys.find((journey) => journey.id === selectedId) || null;
  const selectedStage = selected?.stages[selectedStageIndex] || null;
  const visibleJourneys = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? journeys.filter((journey) => [journey.name, journey.audience, journey.industry].some((value) => value.toLowerCase().includes(query))) : journeys;
  }, [journeys, search]);
  const journeyJobs = useMemo(() => jobs.filter((job) => job.kind === 'journey.generate' || job.kind === 'journey.optimize'), [jobs]);
  const activeJobs = journeyJobs.filter((job) => job.state === 'queued' || job.state === 'processing');
  const currentJob = activeJobs[0] || null;

  useEffect(() => { setSelectedStageIndex(0); }, [selectedId]);
  useEffect(() => { void loadVersions(selectedId); }, [loadVersions, selectedId, selected?.updatedAt]);
  useEffect(() => {
    if (selected && selectedStageIndex >= selected.stages.length) setSelectedStageIndex(Math.max(0, selected.stages.length - 1));
  }, [selected, selectedStageIndex]);

  async function generateJourney() {
    if (brief.trim().length < 10) return toast.error('Add a more detailed journey brief.');
    setWorkingAction('generate');
    try {
      const queued = await api<{ jobId: string }>('/api/ai/journeys', json('POST', { brief, audience, industry, objective }));
      setCreateOpen(false);
      toast.success('Journey generation queued with Experience AI.');
      await load();
      const job = await waitForJob(queued.jobId, () => void load());
      const journey = job.result?.output?.journey as Journey | undefined;
      await load();
      if (journey?.id) setSelectedId(journey.id);
      toast.success('Journey map is ready. Review its assumptions before acting on it.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not generate journey.');
    } finally {
      setWorkingAction(null);
    }
  }

  async function optimizeJourney() {
    if (!selected) return;
    setWorkingAction('optimize');
    try {
      const queued = await api<{ jobId: string; deduplicated: boolean }>(`/api/journeys/${selected.id}/ai/optimize`, json('POST', { focus }));
      toast.success(queued.deduplicated ? 'This exact audit is already active. Following its progress.' : 'Journey audit queued with Experience AI.');
      await load();
      await waitForJob(queued.jobId, () => void load());
      await load();
      toast.success('Journey improvements applied. They remain hypotheses until validated.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not optimize journey.');
    } finally {
      setWorkingAction(null);
    }
  }

  async function updateJourney(
    updates: Partial<Pick<Journey, 'name' | 'audience' | 'industry' | 'objective' | 'summary' | 'stages'>>,
    expectedUpdatedAt = selected?.updatedAt || ''
  ) {
    if (!selected) return null;
    setWorkingAction('save');
    try {
      const updated = await api<Journey>(`/api/journeys/${selected.id}`, json('PATCH', {
        ...updates,
        expectedUpdatedAt
      }));
      setJourneys((current) => current.map((journey) => journey.id === updated.id ? updated : journey));
      toast.success('Journey map saved.');
      return updated;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setMetadataOpen(false);
        setStageEditor(null);
        await load();
        toast.error('This map changed in another session. The latest version is loaded; review it and try again.');
      } else {
        toast.error(error instanceof Error ? error.message : 'Could not save journey map.');
      }
      return null;
    } finally {
      setWorkingAction(null);
    }
  }

  function openMetadataEditor() {
    if (!selected) return;
    setMetadataDraft({
      name: selected.name,
      audience: selected.audience,
      industry: selected.industry,
      objective: selected.objective,
      summary: selected.summary
    });
    setMetadataExpectedUpdatedAt(selected.updatedAt);
    setMetadataOpen(true);
  }

  async function saveMetadata() {
    if (metadataDraft.name.trim().length < 2) return toast.error('Give this journey a clear name.');
    const updated = await updateJourney({
      ...metadataDraft,
      name: metadataDraft.name.trim(),
      audience: metadataDraft.audience.trim(),
      industry: metadataDraft.industry.trim(),
      objective: metadataDraft.objective.trim(),
      summary: metadataDraft.summary.trim()
    }, metadataExpectedUpdatedAt);
    if (updated) setMetadataOpen(false);
  }

  function openStageEditor(index: number | null) {
    const stage = index === null ? null : selected?.stages[index];
    if (!selected) return;
    setStageEditor({ index, expectedUpdatedAt: selected.updatedAt, draft: stage ? toStageDraft(stage) : { ...emptyStageDraft } });
  }

  async function saveStage() {
    if (!selected || !stageEditor) return;
    if (!stageEditor.draft.name.trim()) return toast.error('Give this stage a name.');
    if (!stageEditor.draft.goal.trim()) return toast.error('Describe what the customer is trying to achieve at this stage.');
    const nextStage = fromStageDraft(stageEditor.draft);
    const stages = [...selected.stages];
    const targetIndex = stageEditor.index === null ? stages.length : stageEditor.index;
    if (stageEditor.index === null) stages.push(nextStage);
    else stages[stageEditor.index] = nextStage;
    const updated = await updateJourney({ stages }, stageEditor.expectedUpdatedAt);
    if (updated) {
      setSelectedStageIndex(targetIndex);
      setStageEditor(null);
    }
  }

  async function removeStage() {
    if (!selected || !stageEditor || stageEditor.index === null) return;
    if (selected.stages.length === 1) return toast.error('A journey map needs at least one stage.');
    if (!window.confirm(`Delete the “${selected.stages[stageEditor.index].name}” stage?`)) return;
    const stages = selected.stages.filter((_, index) => index !== stageEditor.index);
    const updated = await updateJourney({ stages }, stageEditor.expectedUpdatedAt);
    if (updated) {
      setSelectedStageIndex(Math.min(stageEditor.index, stages.length - 1));
      setStageEditor(null);
    }
  }

  async function moveStage(direction: -1 | 1) {
    if (!selected || !selectedStage) return;
    const target = selectedStageIndex + direction;
    if (target < 0 || target >= selected.stages.length) return;
    const stages = [...selected.stages];
    [stages[selectedStageIndex], stages[target]] = [stages[target], stages[selectedStageIndex]];
    const updated = await updateJourney({ stages });
    if (updated) setSelectedStageIndex(target);
  }

  async function removeJourney() {
    if (!selected || !window.confirm(`Delete “${selected.name}”? This cannot be undone.`)) return;
    setWorkingAction('delete');
    try {
      await api(`/api/journeys/${selected.id}`, json('DELETE', { expectedUpdatedAt: selected.updatedAt }));
      setSelectedId('');
      await load();
      toast.success('Journey map deleted.');
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        await load();
        toast.error('This map changed in another session. The latest version is loaded; review it before deleting.');
      } else {
        toast.error(error instanceof Error ? error.message : 'Could not delete journey.');
      }
    } finally {
      setWorkingAction(null);
    }
  }

  async function restoreVersion(version: JourneyVersion) {
    if (!selected || !window.confirm(`Restore “${version.name}” from ${formatDateTime(version.snapshotUpdatedAt)}? The current map will be preserved in history.`)) return;
    setWorkingAction('restore');
    setRestoringVersionId(version.id);
    try {
      const restored = await api<Journey>(`/api/journeys/${selected.id}/versions/${version.id}/restore`, json('POST', {
        expectedUpdatedAt: selected.updatedAt
      }));
      setJourneys((current) => current.map((journey) => journey.id === restored.id ? restored : journey));
      setSelectedStageIndex(0);
      await loadVersions(restored.id);
      toast.success('Earlier journey version restored. The displaced version is still available.');
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        await load();
        toast.error('This map changed in another session. The latest version is loaded; review it before restoring.');
      } else {
        toast.error(error instanceof Error ? error.message : 'Could not restore this journey version.');
      }
    } finally {
      setWorkingAction(null);
      setRestoringVersionId('');
    }
  }

  function downloadExport(format: 'json' | 'csv') {
    if (!selected) return;
    const link = document.createElement('a');
    link.href = spaceScopedApiUrl(`/api/journeys/${encodeURIComponent(selected.id)}/export.${format}`);
    link.download = `${selected.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'journey-map'}.${format}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  if (loading) return <div className="flex min-h-[420px] items-center justify-center" role="status">
    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    <span className="ml-3 text-sm text-muted-foreground">Loading journey maps…</span>
  </div>;

  return <div className="space-y-5">
    <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <h1 className="page-title">Journey maps</h1>
        <p className="page-description">Map what customers try to accomplish across a lifecycle, then review the touchpoints, friction, evidence gaps, and improvements at each stage.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw />Refresh</Button>
        <Button size="sm" onClick={() => setCreateOpen(true)}><Plus />New map</Button>
      </div>
    </header>

    {loadError && <div className="flex items-start justify-between gap-4 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900" role="alert">
      <span className="flex gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{loadError}</span>
      <Button variant="outline" size="sm" onClick={() => void load()}>Try again</Button>
    </div>}

    <section className="border bg-card" aria-labelledby="journey-workflow-title">
      <div className="border-b px-4 py-3">
        <h2 id="journey-workflow-title" className="text-sm font-semibold">How this workspace works</h2>
        <p className="mt-1 text-sm text-muted-foreground">A journey map is an internal decision tool. It does not contact customers, distribute a survey, or prove what customers think.</p>
      </div>
      <ol className="grid divide-y md:grid-cols-3 md:divide-x md:divide-y-0">
        <li className="flex gap-3 px-4 py-3">
          <span className="font-semibold text-muted-foreground">1</span>
          <div><p className="text-sm font-medium">Define the lifecycle</p><p className="mt-0.5 text-xs leading-5 text-muted-foreground">Stages describe the customer goal from discovery to outcome.</p></div>
        </li>
        <li className="flex gap-3 px-4 py-3">
          <span className="font-semibold text-muted-foreground">2</span>
          <div><p className="text-sm font-medium">Review each stage</p><p className="mt-0.5 text-xs leading-5 text-muted-foreground">Record actions, touchpoints, emotions, pain points, and evidence gaps.</p></div>
        </li>
        <li className="flex gap-3 px-4 py-3">
          <span className="font-semibold text-muted-foreground">3</span>
          <div><p className="text-sm font-medium">Choose improvements</p><p className="mt-0.5 text-xs leading-5 text-muted-foreground">Turn validated friction into measurable actions for the team.</p></div>
        </li>
      </ol>
    </section>

    {currentJob && <div className="border bg-card px-4 py-3" role="status" aria-live="polite">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm font-medium"><Loader2 className="h-4 w-4 animate-spin" />{currentJob.kind === 'journey.generate' ? 'Experience AI is generating a journey map' : 'Experience AI is auditing a journey map'}</div>
        <span className="text-xs text-muted-foreground">{currentJob.state === 'queued' ? 'Waiting in the durable AI queue' : `${Math.max(0, Math.min(100, currentJob.progress || 0))}% · ${currentJob.stage || 'Processing'}`}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden bg-muted" aria-hidden="true"><div className="h-full bg-primary transition-[width]" style={{ width: `${Math.max(3, Math.min(100, currentJob.progress || 3))}%` }} /></div>
    </div>}

    {journeys.length > 0 && <div className="space-y-1.5 lg:hidden">
      <Label htmlFor="mobile-journey-select">Journey map{selected ? `: ${selected.name}` : ''}</Label>
      <select id="mobile-journey-select" value={selectedId} onChange={(event) => setSelectedId(event.target.value)} className="block h-10 w-full rounded-md border-input bg-background text-sm focus:border-ring focus:ring-ring">
        {journeys.map((journey) => <option value={journey.id} key={journey.id}>{journey.name}</option>)}
      </select>
    </div>}

    <div className="grid items-start gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="hidden overflow-hidden border bg-card lg:block" aria-label="Journey map library">
        <div className="border-b p-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Saved maps</h2>
            <span className="text-xs text-muted-foreground">{journeys.length}</span>
          </div>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input aria-label="Search journey maps" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search maps" className="h-9 pl-9" />
          </div>
        </div>
        <nav className="max-h-[620px] overflow-y-auto p-1.5" aria-label="Saved journey maps">
          {visibleJourneys.length ? visibleJourneys.map((journey) => <button
            type="button"
            key={journey.id}
            onClick={() => setSelectedId(journey.id)}
            aria-current={selectedId === journey.id ? 'page' : undefined}
            className={`w-full border-l-2 px-3 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${selectedId === journey.id ? 'border-primary bg-accent/45' : 'border-transparent hover:bg-muted/35'}`}
          >
            <span className="block truncate text-sm font-medium">{journey.name}</span>
            <span className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>{journey.stages.length} stages</span><span>{formatDate(journey.updatedAt)}</span></span>
          </button>) : <p className="px-3 py-8 text-center text-sm text-muted-foreground">{search ? 'No matching maps.' : 'No journey maps yet.'}</p>}
        </nav>
      </aside>

      <div className="min-w-0 space-y-5">
        {selected ? <>
          <section className="border bg-card" aria-labelledby="selected-journey-title">
            <div className="border-b px-4 py-4 sm:px-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge variant="warning">Hypothesis</Badge>
                    <Badge variant="outline">{selected.industry || 'General'}</Badge>
                    <span className="text-xs text-muted-foreground">Updated {formatDate(selected.updatedAt)}</span>
                  </div>
                  <h2 id="selected-journey-title" className="text-xl font-semibold tracking-[-0.02em]">{selected.name}</h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{selected.summary || 'No summary has been recorded for this journey.'}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => downloadExport('csv')}><FileSpreadsheet />Export CSV</Button>
                  <Button variant="outline" size="sm" onClick={() => downloadExport('json')}><FileJson />Export JSON</Button>
                  <Button variant="outline" size="sm" onClick={openMetadataEditor}><Pencil />Edit details</Button>
                </div>
              </div>
            </div>
            <dl className="grid divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0">
              <div className="px-4 py-3 sm:px-5"><dt className="text-xs font-medium text-muted-foreground">Customer group</dt><dd className="mt-1 text-sm">{selected.audience || 'Not specified'}</dd></div>
              <div className="px-4 py-3 sm:px-5"><dt className="text-xs font-medium text-muted-foreground">Business objective</dt><dd className="mt-1 text-sm">{selected.objective || 'Not specified'}</dd></div>
            </dl>
          </section>

          <EvidenceNotice journey={selected} />

          <section aria-labelledby="journey-stages-title">
            <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div><h2 id="journey-stages-title" className="section-title">Journey stages</h2><p className="mt-1 text-sm text-muted-foreground">Select a stage to inspect the customer experience and improvement plan.</p></div>
              <span className="text-xs text-muted-foreground">Discovery <ArrowRight className="mx-1 inline h-3 w-3" /> Outcome</span>
            </div>
            <StageTimeline stages={selected.stages} selectedIndex={selectedStageIndex} onSelect={setSelectedStageIndex} onAdd={() => openStageEditor(null)} />
          </section>

          {selectedStage && <section aria-labelledby="selected-stage-title" className="space-y-4">
            <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><MousePointer2 className="h-3.5 w-3.5" />Selected stage {selectedStageIndex + 1} of {selected.stages.length}</div>
                <h2 id="selected-stage-title" className="mt-2 text-lg font-semibold">{selectedStage.name}</h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground"><span className="font-medium text-foreground">Customer goal:</span> {selectedStage.goal || 'Not recorded'}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="icon" aria-label="Move stage earlier" disabled={selectedStageIndex === 0 || workingAction === 'save'} onClick={() => void moveStage(-1)}><ChevronLeft /></Button>
                <Button variant="outline" size="icon" aria-label="Move stage later" disabled={selectedStageIndex === selected.stages.length - 1 || workingAction === 'save'} onClick={() => void moveStage(1)}><ChevronRight /></Button>
                <Button variant="outline" size="sm" onClick={() => openStageEditor(selectedStageIndex)}><Pencil />Edit stage</Button>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-3">
              <ReviewColumn title="Experience assumptions" description="What the customer may do, encounter, and feel at this stage. Validate these statements with research.">
                <DetailGroup title="Customer actions" values={selectedStage.customerActions} empty="No customer actions recorded." />
                <DetailGroup title="Touchpoints" values={selectedStage.touchpoints} empty="No touchpoints recorded." />
                <DetailGroup title="Emotions" values={selectedStage.emotions} empty="No emotions recorded." />
              </ReviewColumn>
              <ReviewColumn title="Findings to validate" description="Suspected friction and possible ways to improve it.">
                <DetailGroup title="Pain points" values={selectedStage.painPoints} empty="No pain points recorded." />
                <DetailGroup title="Opportunities" values={selectedStage.opportunities} empty="No opportunities recorded." />
              </ReviewColumn>
              <ReviewColumn title="Improvement plan" description="Concrete team actions and measures that show whether they worked.">
                <DetailGroup title="Recommended actions" values={selectedStage.recommendedActions} empty="No recommended actions recorded." />
                <DetailGroup title="Measures" values={selectedStage.metrics} empty="No success measures recorded." />
              </ReviewColumn>
            </div>

            <div className="flex items-center justify-between gap-3 border-t pt-3">
              <Button variant="ghost" size="sm" disabled={selectedStageIndex === 0} onClick={() => setSelectedStageIndex((current) => Math.max(0, current - 1))}><ArrowLeft />Previous stage</Button>
              <Button variant="ghost" size="sm" disabled={selectedStageIndex === selected.stages.length - 1} onClick={() => setSelectedStageIndex((current) => Math.min(selected.stages.length - 1, current + 1))}>Next stage<ArrowRight /></Button>
            </div>
          </section>}

          <section className="overflow-hidden border bg-card" aria-labelledby="journey-history-title">
            <header className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <History className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <div>
                  <h2 id="journey-history-title" className="text-sm font-semibold">Version history</h2>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">A restorable snapshot is saved before every workspace edit, Terra audit, and restore.</p>
                </div>
              </div>
              <span className="text-xs text-muted-foreground">{versions.length ? `${versions.length} recent version${versions.length === 1 ? '' : 's'}` : 'No saved versions'}</span>
            </header>
            {versionsError ? <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-destructive" role="alert">
              <span>{versionsError}</span>
              <Button variant="outline" size="sm" onClick={() => void loadVersions(selected.id)}>Retry</Button>
            </div> : versions.length ? <div className="divide-y">
              {versions.slice(0, 10).map((version) => <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between" key={version.id}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate text-sm font-medium">{version.name}</span>
                    <span className="text-xs text-muted-foreground">{version.stageCount} stage{version.stageCount === 1 ? '' : 's'}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{versionReason(version.reason)} · map updated {formatDateTime(version.snapshotUpdatedAt)}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => void restoreVersion(version)} disabled={workingAction !== null} aria-label={`Restore ${version.name} from ${formatDateTime(version.snapshotUpdatedAt)}`}>
                  {restoringVersionId === version.id ? <Loader2 className="animate-spin" /> : <RotateCcw />}Restore
                </Button>
              </div>)}
            </div> : <p className="px-4 py-5 text-sm text-muted-foreground">No previous versions yet. The first edit will preserve the current map here.</p>}
          </section>

          <Card>
            <CardHeader>
              <div className="flex items-start gap-3"><CircleGauge className="mt-0.5 h-5 w-5 text-muted-foreground" /><div><CardTitle>Audit this journey with Experience AI</CardTitle><CardDescription className="mt-1 leading-5">Ask Experience AI to find missing stages, weak measures, and unsupported actions. An audit improves the working hypothesis; it does not add customer evidence.</CardDescription></div></div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"><strong>This revises the current map.</strong> A restorable snapshot is saved automatically before Terra applies its changes.</div>
              <Label htmlFor="journey-focus">Audit focus</Label>
              <Textarea id="journey-focus" rows={3} value={focus} onChange={(event) => setFocus(event.target.value)} />
              <Button onClick={optimizeJourney} disabled={workingAction !== null}>{workingAction === 'optimize' ? <Loader2 className="animate-spin" /> : <Sparkles />}Audit and improve</Button>
            </CardContent>
          </Card>

          <div className="flex justify-end border-t pt-4">
            <Button variant="ghost" size="sm" className="text-destructive hover:bg-red-50 hover:text-destructive" onClick={removeJourney} disabled={workingAction !== null}><Trash2 />Delete map</Button>
          </div>
        </> : <div className="grid min-h-[460px] place-items-center border border-dashed bg-muted/15 p-8 text-center">
          <div className="max-w-md">
            <Map className="mx-auto h-7 w-7 text-muted-foreground" />
            <h2 className="mt-4 text-base font-semibold">Create the first journey map</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">Describe the customer lifecycle and decision you need to make. Terra will draft a hypothesis that your team can edit and validate with research.</p>
            <Button className="mt-5" onClick={() => setCreateOpen(true)}><Plus />New map</Button>
          </div>
        </div>}
      </div>
    </div>

    <Dialog open={createOpen} onOpenChange={setCreateOpen}>
      <DialogContent className="max-h-[calc(100vh-2rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Generate a journey map</DialogTitle>
          <DialogDescription>Terra uses only this brief to draft the map. No survey responses, interviews, tickets, or social posts are included automatically.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label htmlFor="journey-brief">Customer lifecycle brief</Label><Textarea id="journey-brief" rows={5} value={brief} onChange={(event) => setBrief(event.target.value)} /><p className="text-xs text-muted-foreground">Describe the starting point, desired outcome, important transitions, and known touchpoints.</p></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="journey-audience">Customer group</Label><Input id="journey-audience" value={audience} onChange={(event) => setAudience(event.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="journey-industry">Industry</Label><Input id="journey-industry" value={industry} onChange={(event) => setIndustry(event.target.value)} /></div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="journey-objective">Business objective</Label><Textarea id="journey-objective" rows={3} value={objective} onChange={(event) => setObjective(event.target.value)} /></div>
          <div className="border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950"><strong>Output:</strong> an editable hypothesis. Validate pain points and opportunities with customer research before prioritising work.</div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button onClick={generateJourney} disabled={workingAction !== null}>{workingAction === 'generate' ? <Loader2 className="animate-spin" /> : <Sparkles />}Generate with Experience AI</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={metadataOpen} onOpenChange={setMetadataOpen}>
      <DialogContent className="max-h-[calc(100vh-2rem)] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>Edit journey details</DialogTitle><DialogDescription>Keep the scope specific so every stage describes the same customer group and outcome.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label htmlFor="journey-name-edit">Map name</Label><Input id="journey-name-edit" value={metadataDraft.name} onChange={(event) => setMetadataDraft((current) => ({ ...current, name: event.target.value }))} /></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="journey-audience-edit">Customer group</Label><Input id="journey-audience-edit" value={metadataDraft.audience} onChange={(event) => setMetadataDraft((current) => ({ ...current, audience: event.target.value }))} /></div>
            <div className="space-y-1.5"><Label htmlFor="journey-industry-edit">Industry</Label><Input id="journey-industry-edit" value={metadataDraft.industry} onChange={(event) => setMetadataDraft((current) => ({ ...current, industry: event.target.value }))} /></div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="journey-objective-edit">Business objective</Label><Textarea id="journey-objective-edit" rows={3} value={metadataDraft.objective} onChange={(event) => setMetadataDraft((current) => ({ ...current, objective: event.target.value }))} /></div>
          <div className="space-y-1.5"><Label htmlFor="journey-summary-edit">Map summary</Label><Textarea id="journey-summary-edit" rows={4} value={metadataDraft.summary} onChange={(event) => setMetadataDraft((current) => ({ ...current, summary: event.target.value }))} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setMetadataOpen(false)}>Cancel</Button><Button onClick={saveMetadata} disabled={workingAction === 'save'}>{workingAction === 'save' ? <Loader2 className="animate-spin" /> : <CheckSquare />}Save details</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={stageEditor !== null} onOpenChange={(open) => { if (!open) setStageEditor(null); }}>
      <DialogContent className="max-h-[calc(100vh-2rem)] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{stageEditor?.index === null ? 'Add journey stage' : `Edit stage ${stageEditor ? stageEditor.index + 1 : ''}`}</DialogTitle>
          <DialogDescription>Separate observations from proposed improvements. Use one item per line where a stage has several entries.</DialogDescription>
        </DialogHeader>
        {stageEditor && <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="stage-name">Stage name</Label><Input id="stage-name" value={stageEditor.draft.name} onChange={(event) => setStageEditor((current) => current && ({ ...current, draft: { ...current.draft, name: event.target.value } }))} placeholder="For example: Onboarding" /></div>
            <div className="space-y-1.5"><Label htmlFor="stage-goal">Customer goal</Label><Input id="stage-goal" value={stageEditor.draft.goal} onChange={(event) => setStageEditor((current) => current && ({ ...current, draft: { ...current.draft, goal: event.target.value } }))} placeholder="What is the customer trying to achieve?" /></div>
          </div>
          <div>
            <div className="mb-3 flex items-center gap-2"><UsersRound className="h-4 w-4 text-muted-foreground" /><h3 className="text-sm font-semibold">Experience assumptions</h3></div>
            <div className="grid gap-4 md:grid-cols-3">
              <StageTextArea id="stage-actions" label="Customer actions" value={stageEditor.draft.customerActions} onChange={(value) => setStageEditor((current) => current && ({ ...current, draft: { ...current.draft, customerActions: value } }))} placeholder={'Compares available plans\nInvites a colleague'} />
              <StageTextArea id="stage-touchpoints" label="Touchpoints" value={stageEditor.draft.touchpoints} onChange={(value) => setStageEditor((current) => current && ({ ...current, draft: { ...current.draft, touchpoints: value } }))} placeholder={'Pricing page\nWelcome email'} />
              <StageTextArea id="stage-emotions" label="Emotions" value={stageEditor.draft.emotions} onChange={(value) => setStageEditor((current) => current && ({ ...current, draft: { ...current.draft, emotions: value } }))} placeholder={'Curious\nUnsure'} />
            </div>
          </div>
          <div>
            <div className="mb-3 flex items-center gap-2"><MessageSquareText className="h-4 w-4 text-muted-foreground" /><h3 className="text-sm font-semibold">Findings to validate</h3></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <StageTextArea id="stage-pain" label="Pain points" value={stageEditor.draft.painPoints} onChange={(value) => setStageEditor((current) => current && ({ ...current, draft: { ...current.draft, painPoints: value } }))} placeholder={'Pricing is difficult to compare\nSetup takes too long'} />
              <StageTextArea id="stage-opportunities" label="Opportunities" value={stageEditor.draft.opportunities} onChange={(value) => setStageEditor((current) => current && ({ ...current, draft: { ...current.draft, opportunities: value } }))} placeholder={'Clarify the plan differences\nOffer guided setup'} />
            </div>
          </div>
          <div>
            <div className="mb-3 flex items-center gap-2"><Target className="h-4 w-4 text-muted-foreground" /><h3 className="text-sm font-semibold">Improvement plan</h3></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <StageTextArea id="stage-recommendations" label="Recommended actions" value={stageEditor.draft.recommendedActions} onChange={(value) => setStageEditor((current) => current && ({ ...current, draft: { ...current.draft, recommendedActions: value } }))} placeholder={'Publish a plan comparison\nReduce required setup fields'} />
              <StageTextArea id="stage-metrics" label="Measures" value={stageEditor.draft.metrics} onChange={(value) => setStageEditor((current) => current && ({ ...current, draft: { ...current.draft, metrics: value } }))} placeholder={'Pricing-to-trial conversion\nTime to first value'} />
            </div>
          </div>
        </div>}
        <DialogFooter className="items-center sm:justify-between">
          <div>{stageEditor && stageEditor.index !== null && <Button variant="ghost" className="text-destructive hover:bg-red-50 hover:text-destructive" onClick={removeStage} disabled={workingAction === 'save'}><Trash2 />Delete stage</Button>}</div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row"><Button variant="outline" onClick={() => setStageEditor(null)}>Cancel</Button><Button onClick={saveStage} disabled={workingAction === 'save'}>{workingAction === 'save' ? <Loader2 className="animate-spin" /> : <CheckSquare />}{stageEditor?.index === null ? 'Add stage' : 'Save stage'}</Button></div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
