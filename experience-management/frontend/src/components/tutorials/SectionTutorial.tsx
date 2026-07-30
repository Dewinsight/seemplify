import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, CircleHelp } from 'lucide-react';
import { api, json } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { SectionTutorialDefinition, TutorialStep } from '@/lib/tutorials';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type TutorialStatus = 'in_progress' | 'completed' | 'dismissed';

interface TutorialProgress {
  tutorialKey: string;
  version: number;
  status: TutorialStatus;
  lastStep: number | null;
  firstOpenedAt: string;
  completedAt: string | null;
  dismissedAt: string | null;
  updatedAt: string;
}

interface TutorialProgressResponse {
  progress: TutorialProgress[];
}

function boundedStep(value: number | null | undefined, total: number) {
  return Math.max(0, Math.min(total - 1, Number.isInteger(value) ? Number(value) : 0));
}

function TutorialVisual({ step }: { step: TutorialStep }) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [step.image]);

  return <div>
    <div className="relative aspect-[16/10] overflow-hidden border bg-muted/30">
      {!imageFailed ? <img src={step.image} alt={step.imageAlt} className="h-full w-full object-cover" onError={() => setImageFailed(true)} />
        : <div className="grid h-full place-items-center px-6 text-center text-sm text-muted-foreground">The lesson image could not be loaded. The numbered guide below contains the same instructions.</div>}
      {!imageFailed && step.callouts.map((callout, index) => <span
        aria-hidden="true"
        className="absolute grid h-7 w-7 place-items-center rounded-full border-2 border-background bg-primary text-xs font-bold text-primary-foreground shadow-sm"
        key={`${callout.label}-${index}`}
        style={{ left: `${callout.x}%`, top: `${callout.y}%`, marginLeft: '-0.875rem', marginTop: '-0.875rem' }}
      >{index + 1}</span>)}
    </div>
    <ol className="mt-3 grid gap-2 sm:grid-cols-2" aria-label="Image callouts">
      {step.callouts.map((callout, index) => <li className="flex min-w-0 gap-2.5 text-xs leading-5" key={`${callout.label}-legend`}>
        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded border bg-secondary text-[11px] font-bold text-secondary-foreground">{index + 1}</span>
        <span><strong className="font-semibold text-foreground">{callout.label}.</strong> <span className="text-muted-foreground">{callout.detail}</span></span>
      </li>)}
    </ol>
  </div>;
}

export function SectionTutorial({ tutorial, className }: { tutorial: SectionTutorialDefinition | null; className?: string }) {
  const [progress, setProgress] = useState<TutorialProgress[]>([]);
  const [progressReady, setProgressReady] = useState(false);
  const [progressAvailable, setProgressAvailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [syncError, setSyncError] = useState('');
  const autoOpened = useRef(new Set<string>());
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const pendingSaves = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void api<TutorialProgressResponse>('/api/tutorials/progress').then((result) => {
      if (cancelled) return;
      setProgress(Array.isArray(result.progress) ? result.progress : []);
      setProgressAvailable(true);
    }).catch(() => {
      if (!cancelled) setProgressAvailable(false);
    }).finally(() => {
      if (!cancelled) setProgressReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  const record = useMemo(() => tutorial
    ? progress.find((item) => item.tutorialKey === tutorial.key && item.version === tutorial.version) || null
    : null, [progress, tutorial]);

  const persist = useCallback(async (definition: SectionTutorialDefinition, status: TutorialStatus, lastStep: number) => {
    pendingSaves.current += 1; setSaving(true); setSyncError('');
    try {
      const request = saveQueue.current.then(() => api(`/api/tutorials/progress/${encodeURIComponent(definition.key)}`, json('PUT', {
          version: definition.version,
          status,
          lastStep
        })));
      saveQueue.current = request.catch(() => undefined);
      await request;
      const timestamp = new Date().toISOString();
      setProgress((current) => {
        const retained = current.filter((item) => !(item.tutorialKey === definition.key && item.version === definition.version));
        const existing = current.find((item) => item.tutorialKey === definition.key && item.version === definition.version);
        return [...retained, {
          tutorialKey: definition.key,
          version: definition.version,
          status,
          lastStep,
          firstOpenedAt: existing?.firstOpenedAt || timestamp,
          completedAt: status === 'completed' ? timestamp : existing?.completedAt || null,
          dismissedAt: status === 'dismissed' ? timestamp : null,
          updatedAt: timestamp
        }];
      });
      setProgressAvailable(true);
    } catch {
      setSyncError('Progress could not be saved. You can still continue this lesson.');
    } finally {
      pendingSaves.current = Math.max(0, pendingSaves.current - 1);
      setSaving(pendingSaves.current > 0);
    }
  }, []);

  useEffect(() => {
    setOpen(false);
    if (!tutorial) return;
    setStepIndex(record?.status === 'completed' ? 0 : boundedStep(record?.lastStep, tutorial.steps.length));
  }, [tutorial?.key]); // A route change always closes the prior section lesson.

  useEffect(() => {
    if (!tutorial || !progressReady || !progressAvailable || record || autoOpened.current.has(tutorial.key)) return;
    autoOpened.current.add(tutorial.key);
    setStepIndex(0); setOpen(true);
    void persist(tutorial, 'in_progress', 0);
  }, [persist, progressAvailable, progressReady, record, tutorial]);

  if (!tutorial) return null;
  const step = tutorial.steps[stepIndex] || tutorial.steps[0];
  const finalStep = stepIndex === tutorial.steps.length - 1;

  function openTutorial() {
    const start = record?.status === 'completed' ? 0 : boundedStep(record?.lastStep, tutorial!.steps.length);
    setStepIndex(start); setOpen(true); setSyncError('');
    void persist(tutorial!, 'in_progress', start);
  }

  function changeStep(next: number) {
    const bounded = boundedStep(next, tutorial!.steps.length);
    setStepIndex(bounded);
    void persist(tutorial!, 'in_progress', bounded);
  }

  function closeAsDismissed() {
    setOpen(false);
    void persist(tutorial!, 'dismissed', stepIndex);
  }

  function finish() {
    setOpen(false);
    void persist(tutorial!, 'completed', stepIndex);
  }

  return <>
    <Button type="button" variant="outline" size="sm" className={cn('shrink-0 px-2 sm:px-3', className)} aria-label="Tutorial" title="Open this section tutorial" onClick={openTutorial}>
      <CircleHelp /><span className="hidden sm:inline">Tutorial</span>
    </Button>
    <Dialog open={open} onOpenChange={(next) => { if (next) setOpen(true); else closeAsDismissed(); }}>
      <DialogContent className="max-h-[calc(100vh-2rem)] max-w-5xl gap-0 overflow-y-auto p-0">
        <DialogHeader className="border-b px-5 py-4 pr-12 sm:px-6">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
            <DialogTitle>{tutorial.section} lesson</DialogTitle>
            <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">Step {stepIndex + 1} of {tutorial.steps.length}</span>
          </div>
          <DialogDescription>{tutorial.description}</DialogDescription>
        </DialogHeader>

        <div className="grid lg:grid-cols-[minmax(0,1.55fr)_minmax(260px,0.75fr)]">
          <section className="border-b p-4 sm:p-6 lg:border-b-0 lg:border-r" aria-label="Lesson visual">
            <TutorialVisual step={step} />
          </section>
          <section className="p-5 sm:p-6" aria-live="polite" aria-atomic="true">
            <h2 className="text-base font-semibold tracking-[-0.01em]">{step.title}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.description}</p>
            <ul className="mt-5 space-y-3">
              {step.points.map((point) => <li className="flex gap-2.5 text-sm leading-5" key={point}><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span>{point}</span></li>)}
            </ul>
            {step.note && <p className="mt-5 border-l-2 border-primary/50 pl-3 text-xs leading-5 text-muted-foreground">{step.note}</p>}
          </section>
        </div>

        <footer className="flex flex-col gap-3 border-t bg-muted/20 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-1" aria-label="Tutorial steps">
            {tutorial.steps.map((item, index) => <button
              type="button"
              className={cn('h-8 min-w-8 rounded border px-2 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', index === stepIndex ? 'border-primary bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:text-foreground')}
              aria-label={`Open step ${index + 1}: ${item.title}`}
              aria-current={index === stepIndex ? 'step' : undefined}
              onClick={() => changeStep(index)}
              key={item.title}
            >{index + 1}</button>)}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
            {syncError && <span className="text-xs text-amber-800" role="status">{syncError}</span>}
            <Button type="button" variant="ghost" onClick={closeAsDismissed} disabled={saving}>Maybe later</Button>
            <Button type="button" variant="outline" onClick={() => changeStep(stepIndex - 1)} disabled={stepIndex === 0}><ChevronLeft />Previous</Button>
            {finalStep
              ? <Button type="button" onClick={finish}><Check />Finish tutorial</Button>
              : <Button type="button" onClick={() => changeStep(stepIndex + 1)}>Next<ChevronRight /></Button>}
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  </>;
}
