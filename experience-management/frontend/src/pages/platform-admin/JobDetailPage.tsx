import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link, useParams } from '@/lib/router';
import { platformAdminApi, platformAdminErrorMessage } from '@/lib/platformAdminApi';
import type { PlatformAdminJob } from './types';
import { AdminError, AdminLoading, AdminPageHeader, AdminStatus, formatAdminDate } from './shared';

const humanize = (value: string | null | undefined) => String(value || 'Not recorded').replace(/[._-]+/g, ' ');

export function PlatformAdminJobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<PlatformAdminJob | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setRefreshing(true);
    try {
      const value = await platformAdminApi<{ job: PlatformAdminJob }>(`/api/platform-admin/jobs/${encodeURIComponent(id)}`);
      setJob(value.job.requesterRestricted && !value.job.requester
        ? { ...value.job, requester: { id: '', name: 'Restricted user' } }
        : value.job);
      setError('');
    } catch (cause) {
      setError(platformAdminErrorMessage(cause, 'Could not load this AI job.'));
    } finally {
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const facts = job ? [
    ['State', <AdminStatus value={job.state} />],
    ['Stage', humanize(job.stage)],
    ['Progress', `${job.progress}%`],
    ['Attempt', job.attempt],
    ['Created', formatAdminDate(job.createdAt)],
    ['Started', formatAdminDate(job.startedAt)],
    ['Completed', formatAdminDate(job.completedAt)],
    ['Updated', formatAdminDate(job.updatedAt)]
  ] : [];

  return <div className="space-y-6" data-testid="platform-admin-job-detail">
    <Button asChild variant="ghost" size="sm" className="-ml-3"><Link to="/admin/jobs"><ArrowLeft />All AI jobs</Link></Button>
    <AdminPageHeader title={job ? humanize(job.kind) : 'AI job'} description={job?.id || 'Operational execution details without prompt or customer-content payloads.'} actions={<Button size="sm" variant="outline" disabled={refreshing} onClick={() => void load()}><RefreshCw className={refreshing ? 'animate-spin' : ''} />Refresh</Button>} />
    {error && <AdminError message={error} onRetry={() => void load()} />}
    {!job ? !error && <AdminLoading label="Loading AI job..." /> : <>
      <section className="overflow-hidden rounded-lg border bg-card" aria-labelledby="admin-job-status-heading"><div className="border-b px-5 py-4"><h2 id="admin-job-status-heading" className="section-title">Execution</h2></div><dl className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">{facts.map(([label, value]) => <div key={String(label)} className="bg-card p-4"><dt className="text-xs font-medium text-muted-foreground">{label}</dt><dd className="mt-1.5 text-sm capitalize">{value}</dd></div>)}</dl></section>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border bg-card" aria-labelledby="admin-job-ownership-heading"><div className="border-b px-5 py-4"><h2 id="admin-job-ownership-heading" className="section-title">Ownership</h2></div><dl className="space-y-4 p-5 text-sm"><div><dt className="text-xs font-medium text-muted-foreground">Space</dt><dd className="mt-1">{job.space?.name || 'No space'}{job.space && <span className="ml-2 font-mono text-xs text-muted-foreground">{job.space.id}</span>}</dd></div><div><dt className="text-xs font-medium text-muted-foreground">Requester</dt><dd className="mt-1">{job.requester?.name || 'System'}{job.requester?.email && <span className="ml-2 text-xs text-muted-foreground">{job.requester.email}</span>}</dd></div></dl></section>
        <section className="rounded-lg border bg-card" aria-labelledby="admin-job-runtime-heading"><div className="border-b px-5 py-4"><h2 id="admin-job-runtime-heading" className="section-title">Runtime</h2></div><dl className="grid gap-4 p-5 text-sm sm:grid-cols-2"><div><dt className="text-xs font-medium text-muted-foreground">Provider</dt><dd className="mt-1 capitalize">{humanize(job.runtime?.provider)}</dd></div><div><dt className="text-xs font-medium text-muted-foreground">Source</dt><dd className="mt-1 capitalize">{humanize(job.runtime?.source)}</dd></div><div><dt className="text-xs font-medium text-muted-foreground">Model</dt><dd className="mt-1 break-all">{job.runtime?.model || 'Not recorded'}</dd></div><div><dt className="text-xs font-medium text-muted-foreground">Reasoning effort</dt><dd className="mt-1 capitalize">{humanize(job.runtime?.reasoningEffort)}</dd></div><div className="sm:col-span-2"><dt className="text-xs font-medium text-muted-foreground">AI action</dt><dd className="mt-1 font-mono text-xs">{job.runtime?.actionId || 'Not recorded'}</dd></div></dl></section>
      </div>
      {(job.error || job.retryAt) && <section className="rounded-lg border bg-card" aria-labelledby="admin-job-recovery-heading"><div className="border-b px-5 py-4"><h2 id="admin-job-recovery-heading" className="section-title">Recovery</h2></div><div className="space-y-3 p-5 text-sm">{job.retryAt && <p><span className="text-muted-foreground">Next retry:</span> {formatAdminDate(job.retryAt)}</p>}{job.error && <div className="border border-destructive/30 bg-destructive/5 p-3 text-destructive" role="alert"><p className="text-xs font-medium">{job.error.code}</p><p className="mt-1">{job.error.message}</p></div>}</div></section>}
    </>}
  </div>;
}
