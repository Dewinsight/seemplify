import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link, useParams } from '@/lib/router';
import { platformAdminApi, platformAdminErrorMessage } from '@/lib/platformAdminApi';
import type { PlatformAuditEvent } from './types';
import { AdminError, AdminLoading, AdminPageHeader, formatAdminDate, safeJson } from './shared';

const humanize = (value: string) => value.replace(/[._-]+/g, ' ');

function targetRoute(event: PlatformAuditEvent) {
  if (!event.targetId) return null;
  if (event.targetType === 'user') return `/admin/users/${event.targetId}`;
  if (event.targetType === 'space') return `/admin/spaces/${event.targetId}`;
  if (event.targetType === 'subscription_request') return `/admin/subscription-requests/${event.targetId}`;
  return null;
}

export function PlatformAdminAuditDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [event, setEvent] = useState<PlatformAuditEvent | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setRefreshing(true);
    try {
      const value = await platformAdminApi<{ event: PlatformAuditEvent }>(`/api/platform-admin/audit-events/${encodeURIComponent(id)}`);
      setEvent(value.event);
      setError('');
    } catch (cause) {
      setError(platformAdminErrorMessage(cause, 'Could not load this audit event.'));
    } finally {
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const relatedRoute = event ? targetRoute(event) : null;
  return <div className="space-y-6">
    <Button asChild variant="ghost" size="sm" className="-ml-3"><Link to="/admin/audit"><ArrowLeft />Audit log</Link></Button>
    <AdminPageHeader title={event ? humanize(event.action) : 'Audit event'} description={event ? `Recorded ${formatAdminDate(event.createdAt)}` : 'Actor, target, request context, and redacted state changes.'} actions={<div className="flex gap-2">{relatedRoute && <Button asChild size="sm" variant="outline"><Link to={relatedRoute}>Open target<ExternalLink /></Link></Button>}<Button variant="outline" size="sm" disabled={refreshing} onClick={() => void load()}><RefreshCw className={refreshing ? 'animate-spin' : ''} />Refresh</Button></div>} />
    {error && <AdminError message={error} onRetry={() => void load()} />}
    {!event ? !error && <AdminLoading label="Loading audit event..." /> : <>
      <section className="rounded-lg border bg-card" aria-labelledby="audit-context-heading"><div className="border-b px-5 py-4"><h2 id="audit-context-heading" className="section-title">Event context</h2></div><dl className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">{[
        ['Actor', event.actor?.name || 'System'],
        ['Actor role', humanize(event.actorRole)],
        ['Action', humanize(event.action)],
        ['Target type', humanize(event.targetType)],
        ['Target ID', event.targetId || 'Not recorded'],
        ['Space ID', event.spaceId || 'Global'],
        ['Request ID', event.requestId || 'Not recorded'],
        ['IP address', event.ipAddress || 'Not recorded']
      ].map(([label, value]) => <div className="min-w-0 bg-card p-4" key={String(label)}><dt className="text-xs font-medium text-muted-foreground">{label}</dt><dd className="mt-1.5 break-all text-sm capitalize">{value}</dd></div>)}</dl>{event.reason && <div className="border-t px-5 py-4"><div className="text-xs font-medium text-muted-foreground">Administrator reason</div><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{event.reason}</p></div>}</section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="overflow-hidden rounded-lg border bg-card" aria-labelledby="audit-before-heading"><div className="border-b px-5 py-4"><h2 id="audit-before-heading" className="section-title">Before</h2><p className="mt-1 text-xs text-muted-foreground">Sensitive keys are redacted in the browser.</p></div><pre className="max-h-[460px] overflow-auto whitespace-pre-wrap break-all p-5 text-xs leading-6">{safeJson(event.before)}</pre></section>
        <section className="overflow-hidden rounded-lg border bg-card" aria-labelledby="audit-after-heading"><div className="border-b px-5 py-4"><h2 id="audit-after-heading" className="section-title">After</h2><p className="mt-1 text-xs text-muted-foreground">Sensitive keys are redacted in the browser.</p></div><pre className="max-h-[460px] overflow-auto whitespace-pre-wrap break-all p-5 text-xs leading-6">{safeJson(event.after)}</pre></section>
      </div>

      {event.userAgent && <details className="rounded-lg border bg-card px-5 py-4 text-sm"><summary className="cursor-pointer font-medium">Client context</summary><p className="mt-3 break-all text-xs leading-6 text-muted-foreground">{event.userAgent}</p></details>}
    </>}
  </div>;
}
