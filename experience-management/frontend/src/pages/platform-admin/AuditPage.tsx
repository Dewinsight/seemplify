import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Link } from '@/lib/router';
import { normalizePlatformAdminPage, platformAdminApi, platformAdminErrorMessage, platformAdminQuery, type PlatformAdminPage } from '@/lib/platformAdminApi';
import type { PlatformAuditEvent } from './types';
import { AdminEmptyRow, AdminError, AdminLoading, AdminPageHeader, formatAdminDate, Pagination } from './shared';

const pageSize = 50;
const humanize = (value: string) => value.replace(/[._-]+/g, ' ');

export function PlatformAdminAuditPage() {
  const [query, setQuery] = useState('');
  const [action, setAction] = useState('');
  const [filters, setFilters] = useState({ search: '', action: '' });
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<PlatformAdminPage<PlatformAuditEvent> | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const value = await platformAdminApi<unknown>(platformAdminQuery('/api/platform-admin/audit-events', {
        search: filters.search,
        action: filters.action,
        offset: (page - 1) * pageSize,
        limit: pageSize
      }));
      setResult(normalizePlatformAdminPage<PlatformAuditEvent>(value, page, pageSize));
      setError('');
    } catch (cause) {
      setError(platformAdminErrorMessage(cause, 'Could not load the audit log.'));
    } finally {
      setRefreshing(false);
    }
  }, [filters, page]);

  useEffect(() => { void load(); }, [load]);

  function apply(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setFilters({ search: query.trim(), action: action.trim() });
  }

  return <div className="space-y-6">
    <AdminPageHeader title="Audit log" description="Append-only platform administrator actions with actor, target, reason, and request references." actions={<Button size="sm" variant="outline" disabled={refreshing} onClick={() => void load()}><RefreshCw className={refreshing ? 'animate-spin' : ''} />Refresh</Button>} />
    <form onSubmit={apply} className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-[minmax(0,1fr)_minmax(220px,0.5fr)_auto] sm:items-end">
      <div><label htmlFor="admin-audit-search" className="field-label">Search events</label><Input id="admin-audit-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Action, target type, or target ID" /></div>
      <div><label htmlFor="admin-audit-action" className="field-label">Exact action</label><Input id="admin-audit-action" value={action} onChange={(event) => setAction(event.target.value)} placeholder="user.status_changed" /></div>
      <Button type="submit"><Search />Apply filters</Button>
    </form>
    {error && <AdminError message={error} onRetry={() => void load()} />}
    {!result ? !error && <AdminLoading label="Loading audit events..." /> : <div className="overflow-hidden rounded-lg border bg-card"><div className="overflow-x-auto"><table className="data-table"><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>Space</th><th>Request ID</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{result.items.length ? result.items.map((event) => <tr key={event.id}><td className="whitespace-nowrap">{formatAdminDate(event.createdAt)}</td><td><div className="font-medium">{event.actor?.name || 'System'}</div><div className="mt-0.5 text-xs text-muted-foreground capitalize">{humanize(event.actorRole)}</div></td><td className="font-medium capitalize">{humanize(event.action)}</td><td><div className="capitalize">{humanize(event.targetType)}</div><div className="mt-0.5 max-w-48 truncate font-mono text-[11px] text-muted-foreground" title={event.targetId}>{event.targetId || 'No target'}</div></td><td><span className="block max-w-40 truncate font-mono text-[11px]" title={event.spaceId || ''}>{event.spaceId || 'Global'}</span></td><td><span className="block max-w-40 truncate font-mono text-[11px]" title={event.requestId}>{event.requestId || 'Not recorded'}</span></td><td className="text-right"><Button asChild variant="outline" size="sm"><Link to={`/admin/audit/${event.id}`}>Open</Link></Button></td></tr>) : <AdminEmptyRow columns={7}>No audit events match these filters.</AdminEmptyRow>}</tbody></table></div><Pagination {...result} onPage={setPage} /></div>}
  </div>;
}
