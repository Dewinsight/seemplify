import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  normalizePlatformAdminPage, platformAdminApi, platformAdminErrorMessage,
  platformAdminQuery, type PlatformAdminPage
} from '@/lib/platformAdminApi';
import type { PlatformActivityItem } from './types';
import { AdminEmptyRow, AdminError, AdminLoading, AdminPageHeader, AdminStatus, formatAdminDate, Pagination } from './shared';

const pageSize = 50;
const humanize = (value: string | null | undefined) => String(value || 'Not recorded').replace(/[._-]+/g, ' ');

export function PlatformAdminActivityPage() {
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [filters, setFilters] = useState({ search: '', type: '' });
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<PlatformAdminPage<PlatformActivityItem> | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const value = await platformAdminApi<unknown>(platformAdminQuery('/api/platform-admin/activity', {
        ...filters,
        offset: (page - 1) * pageSize,
        limit: pageSize
      }));
      const nextPage = normalizePlatformAdminPage<PlatformActivityItem>(value, page, pageSize);
      setResult({ ...nextPage, items: nextPage.items.map((item) => item.actorRestricted && !item.actor
        ? { ...item, actor: { id: '', name: 'Restricted user' } }
        : item) });
      setError('');
    } catch (cause) {
      setError(platformAdminErrorMessage(cause, 'Could not load platform activity.'));
    } finally {
      setRefreshing(false);
    }
  }, [filters, page]);

  useEffect(() => { void load(); }, [load]);

  function apply(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setFilters({ search: search.trim(), type: type.trim() });
  }

  return <div className="space-y-6" data-testid="platform-admin-activity">
    <AdminPageHeader title="Activity" description="Privacy-safe product events across spaces, people, and operational records." actions={<Button size="sm" variant="outline" disabled={refreshing} onClick={() => void load()}><RefreshCw className={refreshing ? 'animate-spin' : ''} />Refresh</Button>} />
    <form onSubmit={apply} className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-[minmax(0,1fr)_minmax(220px,0.45fr)_auto] sm:items-end">
      <div><label className="field-label" htmlFor="admin-activity-search">Search activity</label><Input id="admin-activity-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Actor, space, entity, kind, or status" /></div>
      <div><label className="field-label" htmlFor="admin-activity-type">Activity type</label><select id="admin-activity-type" value={type} onChange={(event) => setType(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">All activity</option><option value="account">Accounts</option><option value="space">Spaces</option><option value="survey">Surveys</option><option value="response">Responses</option><option value="campaign">Campaigns</option><option value="agreement">Agreements</option><option value="knowledge_base">Knowledge bases</option><option value="ai_job">AI jobs</option></select></div>
      <Button type="submit"><Search />Apply</Button>
    </form>
    {error && <AdminError message={error} onRetry={() => void load()} />}
    {!result ? !error && <AdminLoading label="Loading platform activity..." /> : <div className="overflow-hidden rounded-lg border bg-card"><div className="overflow-x-auto"><table className="data-table"><thead><tr><th>Time</th><th>Activity</th><th>Status</th><th>Entity</th><th>Actor</th><th>Space</th></tr></thead><tbody>{result.items.length ? result.items.map((item) => <tr key={item.id} data-testid={`admin-activity-row-${item.id}`}><td className="whitespace-nowrap">{formatAdminDate(item.occurredAt)}</td><td><div className="font-medium capitalize">{humanize(item.type)}</div><div className="mt-0.5 text-xs capitalize text-muted-foreground">{humanize(item.kind)}</div></td><td><AdminStatus value={item.status} /></td><td><div className="capitalize">{humanize(item.entityType)}</div><div className="mt-0.5 max-w-48 truncate font-mono text-[11px] text-muted-foreground" title={item.entityId}>{item.entityId}</div></td><td>{item.actor ? <><div className="font-medium">{item.actor.name}</div><div className="mt-0.5 text-xs text-muted-foreground">{item.actor.email || item.actor.id}</div></> : 'System'}</td><td>{item.space ? <><div className="font-medium">{item.space.name}</div><div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{item.space.id}</div></> : 'Global'}</td></tr>) : <AdminEmptyRow columns={6}>No activity matches these filters.</AdminEmptyRow>}</tbody></table></div><Pagination {...result} onPage={setPage} /></div>}
  </div>;
}
