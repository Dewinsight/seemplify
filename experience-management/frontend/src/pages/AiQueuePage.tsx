import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Cpu, Server, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { JobStatus } from '@/components/StatusBadge';
import { formatDate, humanizeActivity } from '@/lib/utils';
import type { AiJob } from '@/types';

export function AiQueuePage() {
  const [jobs, setJobs] = useState<AiJob[]>([]);
  const [runtime, setRuntime] = useState<any>(null);
  const load = useCallback(() => Promise.all([api<AiJob[]>('/api/ai/jobs?limit=500'), api('/api/runtime')]).then(([nextJobs, nextRuntime]) => { setJobs(nextJobs); setRuntime(nextRuntime); }), []);
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load);
  const counts = useMemo(() => Object.fromEntries(['queued', 'processing', 'completed', 'failed'].map((state) => [state, jobs.filter((job) => job.state === state).length])), [jobs]);
  const managedRuntime = runtime?.ai || runtime?.terra;
  const metrics = [['Queued', counts.queued], ['Processing', counts.processing], ['Completed', counts.completed], ['Failed', counts.failed], ['Worker slots', `${runtime?.worker?.active || 0}/${runtime?.worker?.concurrency || 1}`], ['Runtime', managedRuntime?.ready === true ? (managedRuntime?.providerLabel || 'Ready') : 'Unavailable']];
  return <div className="space-y-6">
    <div><h1 className="page-title">Experience AI queue</h1><p className="page-description">Live and historical view of every Experience AI request. A single request uses the same durable queue as a burst.</p></div>
    <div className="grid overflow-hidden rounded-lg border bg-card sm:grid-cols-2 lg:grid-cols-6">{metrics.map(([label, value]) => <div className="border-b border-r p-4" key={label}><div className="text-xs font-medium text-muted-foreground">{label}</div><div className="mt-2 text-xl font-semibold">{value}</div></div>)}</div>
    <div className="overflow-hidden rounded-lg border bg-card"><div className="overflow-x-auto"><table className="data-table"><thead><tr><th>Activity</th><th>Survey</th><th>Status</th><th>Attempt</th><th>Progress</th><th>Queued</th><th>Completed</th><th>Error</th></tr></thead><tbody>{jobs.length ? jobs.map((job) => <tr key={job.id}>
      <td><div className="font-medium">{humanizeActivity(job.kind)}</div><div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{job.id.slice(0, 8)}</div></td>
      <td className="font-mono text-xs">{job.surveyId?.slice(0, 8) || '—'}</td><td><JobStatus job={job} /></td><td>{job.attempt}</td>
      <td><div className="w-24"><div className="h-1.5 bg-muted"><div className="h-full bg-primary" style={{ width: `${job.progress}%` }} /></div><div className="mt-1 text-[11px] text-muted-foreground">{job.stage.replaceAll('_', ' ')}</div></div></td>
      <td>{formatDate(job.createdAt)}</td><td>{job.completedAt ? formatDate(job.completedAt) : '—'}</td><td className="max-w-xs truncate text-xs text-destructive" title={job.error || ''}>{job.error || '—'}</td>
    </tr>) : <tr><td colSpan={8} className="py-16 text-center text-sm text-muted-foreground"><Sparkles className="mx-auto mb-3 h-5 w-5" />No AI work has been queued yet.</td></tr>}</tbody></table></div></div>
    <div className="grid gap-4 border bg-card p-5 text-sm md:grid-cols-3"><div className="flex gap-3"><Activity className="h-4 w-4 text-primary" /><div><div className="font-medium">Durable dispatch</div><div className="mt-1 text-xs leading-5 text-muted-foreground">Jobs survive application restarts and retry while the selected runtime is offline.</div></div></div><div className="flex gap-3"><Cpu className="h-4 w-4 text-primary" /><div><div className="font-medium">Managed default</div><div className="mt-1 text-xs leading-5 text-muted-foreground">The Local Control Center owns the Experience profile. Its initial default is Codex gpt-5.6-terra.</div></div></div><div className="flex gap-3"><Server className="h-4 w-4 text-primary" /><div><div className="font-medium">Signed gateway</div><div className="mt-1 text-xs leading-5 text-muted-foreground">Every execution uses a timestamped HMAC request and durable metering identity.</div></div></div></div>
  </div>;
}
