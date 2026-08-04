import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ChevronDown, ChevronUp, Cpu, Loader2, RotateCcw, Server, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { api, json } from '@/lib/api';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { JobStatus } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { formatDate, humanizeActivity } from '@/lib/utils';
import type { AiJob } from '@/types';

function KnowledgeAudit({ job }: { job: AiJob }) {
  const context = job.knowledgeContext;
  if (!context) return <p className="text-sm text-muted-foreground">This activity did not use a knowledge snapshot.</p>;
  const profile = context.metrics?.embeddingProfile || {};
  const reranker = context.metrics?.reranker || {};
  const timings = context.metrics?.timings || {};
  const facts = [
    ['Embedding', `${profile.model || 'Unknown'}${profile.provider ? ` · ${profile.provider}` : ''}`],
    ['Fusion', context.metrics?.fusion || 'Not reported'],
    ['Reranker', `${reranker.model || 'Not reported'}${reranker.executed === true ? ' · executed' : ''}`],
    ['Reranker latency', Number.isFinite(timings.rerankerMs) ? `${timings.rerankerMs} ms` : 'Not reported']
  ];
  return <div className="space-y-4">
    <div className="grid gap-px overflow-hidden border bg-border/50 sm:grid-cols-2 xl:grid-cols-4">
      {facts.map(([label, value]) => <div className="bg-card p-3" key={label}><div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-1 break-words text-xs font-medium">{value}</div></div>)}
    </div>
    <div><div className="text-xs font-medium text-muted-foreground">Retrieval query</div><p className="mt-1 text-sm leading-6">{context.query}</p></div>
    <div><div className="text-xs font-medium text-muted-foreground">Pinned knowledge</div><div className="mt-2 divide-y border">{context.knowledgeBases.map((base) => <div className="flex items-center justify-between gap-4 px-3 py-2 text-sm" key={base.id}><span className="font-medium">{base.name}</span><span className="font-mono text-[11px] text-muted-foreground">index {base.indexVersion}</span></div>)}</div></div>
    <div><div className="text-xs font-medium text-muted-foreground">Retrieved evidence ({context.citations.length})</div>{context.citations.length ? <div className="mt-2 divide-y border">{context.citations.map((citation) => <div className="px-3 py-3" key={citation.sourceRef}><div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="font-medium">{citation.documentName}{citation.page ? ` · page ${citation.page}` : ''}</span><span className="font-mono text-[11px] text-muted-foreground">{citation.sourceRef}</span></div><p className="mt-1.5 text-xs leading-5 text-muted-foreground">{citation.excerpt}</p></div>)}</div> : <p className="mt-2 text-sm text-muted-foreground">The selected sources returned no relevant excerpts.</p>}</div>
  </div>;
}

function retryReason(job: AiJob) {
  if (job.retry?.reason) return job.retry.reason;
  if (job.state !== 'failed') return 'Retry becomes available only after a job has failed.';
  return 'This activity cannot be retried safely from the queue.';
}

function runtimeModel(job: AiJob) {
  const runtime = job.runtime;
  return {
    model: runtime?.model || (runtime?.status === 'planned' ? 'Selected at execution' : 'Not recorded'),
    label: runtime?.status === 'actual' ? 'Used' : runtime?.status === 'planned' ? 'Planned' : 'Not recorded',
    provider: runtime?.providerLabel || runtime?.provider?.replaceAll('-', ' ') || ''
  };
}

function JobAudit({ job }: { job: AiJob }) {
  const execution = runtimeModel(job);
  const facts = [
    ['State', job.state],
    ['Stage', job.stage.replaceAll('_', ' ')],
    ['Attempt', String(job.attempt)],
    [job.runtime?.status === 'actual' ? 'Model used' : 'Planned model', execution.model],
    ['Last update', formatDate(job.updatedAt)]
  ];
  return <div className="space-y-5">
    <div className="grid divide-y border bg-card sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-5">
      {facts.map(([label, value]) => <div className="p-3" key={label}><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 text-sm font-medium capitalize">{value}</div></div>)}
    </div>
    {job.error && <div className="border border-destructive/30 bg-destructive/5 px-4 py-3" role="alert"><div className="text-xs font-medium text-destructive">Recorded failure</div><p className="mt-1 text-sm leading-6 text-destructive">{job.error}</p></div>}
    {job.state === 'failed' && <div aria-label="Retry status"><div className="text-xs font-medium text-muted-foreground">Retry</div><p className="mt-1 text-sm leading-6">{job.retry?.eligible ? 'Available. The same durable job and saved inputs will be used; no duplicate activity is created.' : retryReason(job)}</p></div>}
    <KnowledgeAudit job={job} />
  </div>;
}

export function AiQueuePage() {
  const [jobs, setJobs] = useState<AiJob[]>([]);
  const [runtime, setRuntime] = useState<any>(null);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [jobDetails, setJobDetails] = useState<Record<string, AiJob>>({});
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);
  const [retryErrors, setRetryErrors] = useState<Record<string, string>>({});
  const load = useCallback(() => Promise.all([api<AiJob[]>('/api/ai/jobs?limit=500'), api('/api/runtime')]).then(([nextJobs, nextRuntime]) => { setJobs(nextJobs); setRuntime(nextRuntime); }), []);
  useEffect(() => { void load(); }, [load]);
  useLiveRefresh(load);

  async function toggleAudit(jobId: string) {
    if (expandedJobId === jobId) { setExpandedJobId(null); return; }
    setExpandedJobId(jobId);
    if (jobDetails[jobId]) return;
    setDetailLoading(jobId);
    try {
      const detail = await api<AiJob>(`/api/ai/jobs/${jobId}`);
      setJobDetails((current) => ({ ...current, [jobId]: detail }));
      setDetailErrors((current) => ({ ...current, [jobId]: '' }));
    } catch (error) {
      setDetailErrors((current) => ({ ...current, [jobId]: error instanceof Error ? error.message : 'Audit details could not load.' }));
    } finally {
      setDetailLoading((current) => current === jobId ? null : current);
    }
  }

  async function retryJob(job: AiJob) {
    if (!job.retry?.eligible || retryingJobId) return;
    setRetryingJobId(job.id);
    setRetryErrors((current) => ({ ...current, [job.id]: '' }));
    try {
      const retried = await api<{ job: AiJob; restarted: boolean }>(`/api/ai/jobs/${encodeURIComponent(job.id)}/retry`, json('POST', {}));
      setJobs((current) => current.map((item) => item.id === job.id ? retried.job : item));
      setJobDetails((current) => current[job.id]
        ? { ...current, [job.id]: { ...current[job.id], ...retried.job, knowledgeContext: current[job.id].knowledgeContext } }
        : current);
      toast.success(retried.restarted ? 'Retry queued for the same durable job.' : 'This job was already queued or processing.');
      void load().catch(() => undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'This job could not be retried.';
      setRetryErrors((current) => ({ ...current, [job.id]: message }));
      toast.error(message);
      void load().catch(() => undefined);
    } finally {
      setRetryingJobId((current) => current === job.id ? null : current);
    }
  }

  const counts = useMemo(() => Object.fromEntries(['queued', 'processing', 'completed', 'failed'].map((state) => [state, jobs.filter((job) => job.state === state).length])), [jobs]);
  const managedRuntime = runtime?.ai || runtime?.terra;
  const metrics = [['Queued', counts.queued], ['Processing', counts.processing], ['Completed', counts.completed], ['Failed', counts.failed], ['Worker slots', `${runtime?.worker?.active || 0}/${runtime?.worker?.concurrency || 1}`], ['Runtime', managedRuntime?.ready === true ? (managedRuntime?.providerLabel || 'Ready') : 'Unavailable']];
  return <div className="space-y-6">
    <div><h1 className="page-title">Experience AI queue</h1><p className="page-description">Live and historical view of every Experience AI request. Open an audit to inspect the exact GTE retrieval and BGE reranking snapshot used before Terra.</p></div>
    <div className="grid overflow-hidden rounded-lg border bg-card sm:grid-cols-2 lg:grid-cols-6">{metrics.map(([label, value]) => <div className="border-b border-r p-4" key={label}><div className="text-xs font-medium text-muted-foreground">{label}</div><div className="mt-2 text-xl font-semibold">{value}</div></div>)}</div>
    <div className="overflow-hidden rounded-lg border bg-card"><div className="overflow-x-auto"><table className="data-table"><thead><tr><th>Activity</th><th>Survey</th><th>Status</th><th>Attempt</th><th>Model</th><th>Progress</th><th>Queued</th><th>Completed</th><th>Error</th><th>Action</th><th>Audit</th></tr></thead><tbody>{jobs.length ? jobs.map((job) => <Fragment key={job.id}><tr>
      <td><div className="font-medium">{humanizeActivity(job.kind)}</div><div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{job.id.slice(0, 8)}</div></td>
      <td className="font-mono text-xs">{job.surveyId?.slice(0, 8) || '—'}</td><td><JobStatus job={job} /></td><td>{job.attempt}</td>
      <td className="min-w-44"><div className="max-w-52 truncate font-mono text-xs font-medium" title={runtimeModel(job).model}>{runtimeModel(job).model}</div><div className="mt-0.5 text-[11px] text-muted-foreground">{runtimeModel(job).label}{runtimeModel(job).provider ? ` · ${runtimeModel(job).provider}` : ''}</div></td>
      <td><div className="w-24"><div className="h-1.5 bg-muted"><div className="h-full bg-primary" style={{ width: `${job.progress}%` }} /></div><div className="mt-1 text-[11px] text-muted-foreground">{job.stage.replaceAll('_', ' ')}</div></div></td>
      <td>{formatDate(job.createdAt)}</td><td>{job.completedAt ? formatDate(job.completedAt) : '—'}</td><td className="max-w-xs truncate text-xs text-destructive" title={job.error || ''}>{job.error || '—'}</td>
      <td className="min-w-40">{job.state === 'failed' ? <div className="space-y-1.5"><Button type="button" size="sm" variant="outline" disabled={!job.retry?.eligible || Boolean(retryingJobId)} aria-busy={retryingJobId === job.id} onClick={() => void retryJob(job)}>{retryingJobId === job.id ? <Loader2 className="animate-spin" /> : <RotateCcw />}{retryingJobId === job.id ? 'Retrying' : 'Retry'}</Button>{!job.retry?.eligible && <p className="max-w-56 text-[11px] leading-4 text-muted-foreground">{retryReason(job)}</p>}{retryErrors[job.id] && <p className="max-w-56 text-[11px] leading-4 text-destructive" role="alert">{retryErrors[job.id]}</p>}</div> : <span className="text-muted-foreground">—</span>}</td>
      <td><button type="button" className="inline-flex items-center gap-1 text-xs font-medium hover:underline" onClick={() => void toggleAudit(job.id)} aria-expanded={expandedJobId === job.id}>{detailLoading === job.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : expandedJobId === job.id ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}Details</button></td>
    </tr>{expandedJobId === job.id && <tr><td className="bg-muted/15 p-5" colSpan={11}>{jobDetails[job.id] ? <JobAudit job={jobDetails[job.id]} /> : detailErrors[job.id] ? <p className="text-sm text-destructive" role="alert">{detailErrors[job.id]}</p> : <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading audit details</div>}</td></tr>}</Fragment>) : <tr><td colSpan={11} className="py-16 text-center text-sm text-muted-foreground"><Sparkles className="mx-auto mb-3 h-5 w-5" />No AI work has been queued yet.</td></tr>}</tbody></table></div></div>
    <div className="grid gap-4 border bg-card p-5 text-sm md:grid-cols-3"><div className="flex gap-3"><Activity className="h-4 w-4 text-primary" /><div><div className="font-medium">Durable dispatch</div><div className="mt-1 text-xs leading-5 text-muted-foreground">Jobs survive application restarts and retry while the selected runtime is offline.</div></div></div><div className="flex gap-3"><Cpu className="h-4 w-4 text-primary" /><div><div className="font-medium">Managed default</div><div className="mt-1 text-xs leading-5 text-muted-foreground">The Local Control Center owns the Experience profile. Its initial default is Codex gpt-5.6-terra.</div></div></div><div className="flex gap-3"><Server className="h-4 w-4 text-primary" /><div><div className="font-medium">Signed gateway</div><div className="mt-1 text-xs leading-5 text-muted-foreground">Every execution uses a timestamped HMAC request and durable metering identity.</div></div></div></div>
  </div>;
}
