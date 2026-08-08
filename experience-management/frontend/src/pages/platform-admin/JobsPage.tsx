import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Link } from '@/lib/router';
import {
  normalizePlatformAdminPage, platformAdminApi, platformAdminErrorMessage,
  platformAdminQuery, type PlatformAdminPage
} from '@/lib/platformAdminApi';
import type { PlatformAdminJob, PlatformAdminJobSummary } from './types';
import {
  AdminEmptyRow, AdminError, AdminLoading, AdminPageHeader, AdminStatus,
  formatAdminDate, Pagination, SummaryStrip
} from './shared';

const pageSize = 50;
const humanize = (value: string | null | undefined) => String(value || 'Not recorded').replace(/[._-]+/g, ' ');

type JobsResponse = {
  items?: PlatformAdminJob[];
  jobs?: PlatformAdminJob[];
  total?: number;
  pagination?: { limit: number; offset: number; total: number; hasMore: boolean };
  summary?: PlatformAdminJobSummary;
};

export function PlatformAdminJobsPage() {
  const [search, setSearch] = useState('');
  const [state, setState] = useState('');
  const [provider, setProvider] = useState('');
  const [kind, setKind] = useState('');
  const [filters, setFilters] = useState({ search: '', state: '', provider: '', kind: '' });
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<PlatformAdminPage<PlatformAdminJob> | null>(null);
  const [summary, setSummary] = useState<PlatformAdminJobSummary | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const value = await platformAdminApi<JobsResponse>(platformAdminQuery('/api/platform-admin/jobs', {
        ...filters,
        offset: (page - 1) * pageSize,
        limit: pageSize
      }));
      const nextPage = normalizePlatformAdminPage<PlatformAdminJob>(value, page, pageSize);
      setResult({ ...nextPage, items: nextPage.items.map((job) => job.requesterRestricted && !job.requester
        ? { ...job, requester: { id: '', name: 'Restricted user' } }
        : job) });
      setSummary(value.summary || null);
      setError('');
    } catch (cause) {
      setError(platformAdminErrorMessage(cause, 'Could not load the platform AI queue.'));
    } finally {
      setRefreshing(false);
    }
  }, [filters, page]);

  useEffect(() => { void load(); }, [load]);

  function apply(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setFilters({ search: search.trim(), state, provider: provider.trim(), kind: kind.trim() });
  }

  return <div className="space-y-6" data-testid="platform-admin-jobs">
    <AdminPageHeader title="AI queue" description="Privacy-safe operational status for AI work across every space." actions={<Button size="sm" variant="outline" disabled={refreshing} onClick={() => void load()}><RefreshCw className={refreshing ? 'animate-spin' : ''} />Refresh</Button>} />
    {summary && <SummaryStrip items={[
      { label: 'All jobs', value: summary.total },
      { label: 'Active', value: summary.active, note: 'Queued or processing' },
      { label: 'Failed', value: summary.failed },
      { label: 'Completed', value: summary.byState.completed || 0 }
    ]} />}
    <form onSubmit={apply} className="grid gap-3 rounded-lg border bg-card p-4 md:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_170px_180px_180px_auto] xl:items-end">
      <div><label className="field-label" htmlFor="admin-job-search">Search jobs</label><Input id="admin-job-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Job ID, requester, space, or kind" /></div>
      <div><label className="field-label" htmlFor="admin-job-state">State</label><select id="admin-job-state" value={state} onChange={(event) => setState(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">All states</option><option value="queued">Queued</option><option value="processing">Processing</option><option value="completed">Completed</option><option value="failed">Failed</option></select></div>
      <div><label className="field-label" htmlFor="admin-job-provider">Provider</label><select id="admin-job-provider" value={provider} onChange={(event) => setProvider(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">All providers</option><option value="codex">ChatGPT / Codex</option></select></div>
      <div><label className="field-label" htmlFor="admin-job-kind">Action or kind</label><Input id="admin-job-kind" value={kind} onChange={(event) => setKind(event.target.value)} placeholder="analyst.chat" /></div>
      <Button type="submit"><Search />Apply</Button>
    </form>
    {error && <AdminError message={error} onRetry={() => void load()} />}
    {!result ? !error && <AdminLoading label="Loading global AI jobs..." /> : <div className="overflow-hidden rounded-lg border bg-card"><div className="overflow-x-auto"><table className="data-table"><thead><tr><th>Job</th><th>Space</th><th>Requester</th><th>Status</th><th>Runtime</th><th>Progress</th><th>Updated</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{result.items.length ? result.items.map((job) => <tr key={job.id} data-testid={`admin-job-row-${job.id}`}><td><div className="font-medium capitalize">{humanize(job.kind)}</div><div className="mt-0.5 max-w-44 truncate font-mono text-[11px] text-muted-foreground" title={job.id}>{job.id}</div></td><td>{job.space ? <><div className="font-medium">{job.space.name}</div><div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{job.space.id}</div></> : 'No space'}</td><td>{job.requester ? <><div>{job.requester.name}</div>{job.requester.email && <div className="mt-0.5 text-xs text-muted-foreground">{job.requester.email}</div>}</> : 'System'}</td><td><AdminStatus value={job.state} /><div className="mt-1 text-xs capitalize text-muted-foreground">{humanize(job.stage)}</div></td><td><div className="text-xs font-medium capitalize">{humanize(job.runtime?.provider)}</div><div className="mt-0.5 max-w-44 truncate text-xs text-muted-foreground" title={job.runtime?.model || ''}>{job.runtime?.model || 'Model not recorded'}{job.runtime?.reasoningEffort ? ` / ${humanize(job.runtime.reasoningEffort)}` : ''}</div></td><td><div className="w-24"><div className="h-1.5 bg-muted"><div className="h-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, Number(job.progress || 0)))}%` }} /></div><div className="mt-1 text-[11px] tabular-nums text-muted-foreground">{Number(job.progress || 0)}% / attempt {job.attempt}</div></div></td><td className="whitespace-nowrap">{formatAdminDate(job.updatedAt)}</td><td className="text-right"><Button asChild variant="outline" size="sm"><Link to={`/admin/jobs/${encodeURIComponent(job.id)}`}>Open</Link></Button></td></tr>) : <AdminEmptyRow columns={8}>No AI jobs match these filters.</AdminEmptyRow>}</tbody></table></div><Pagination {...result} onPage={setPage} /></div>}
  </div>;
}
