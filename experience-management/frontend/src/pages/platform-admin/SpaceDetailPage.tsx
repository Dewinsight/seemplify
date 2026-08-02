import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Loader2, RefreshCw, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Link, useParams } from '@/lib/router';
import { platformAdminApi, platformAdminErrorMessage, platformAdminJson } from '@/lib/platformAdminApi';
import type { PlatformSpaceDetail } from './types';
import { AdminEmptyRow, AdminError, AdminLoading, AdminPageHeader, AdminStatus, formatAdminDate, SummaryStrip } from './shared';

interface AdminCapabilities { capabilities: { manageSpaces: boolean; decideSubscriptions: boolean } }

export function PlatformAdminSpaceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<PlatformSpaceDetail | null>(null);
  const [capabilities, setCapabilities] = useState<AdminCapabilities['capabilities'] | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [working, setWorking] = useState('');
  const [spaceStatus, setSpaceStatus] = useState('active');
  const [subscriptionStatus, setSubscriptionStatus] = useState('active');
  const [spaceReason, setSpaceReason] = useState('');
  const [subscriptionReason, setSubscriptionReason] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setRefreshing(true);
    try {
      const [next, me] = await Promise.all([
        platformAdminApi<PlatformSpaceDetail>(`/api/platform-admin/spaces/${encodeURIComponent(id)}`),
        platformAdminApi<AdminCapabilities>('/api/platform-admin/me')
      ]);
      setDetail(next);
      setCapabilities(me.capabilities);
      setSpaceStatus(next.space.status);
      setSubscriptionStatus(next.subscription?.status || 'active');
      setError('');
    } catch (cause) {
      setError(platformAdminErrorMessage(cause, 'Could not load this space.'));
    } finally {
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function updateSpaceStatus() {
    if (!id || spaceReason.trim().length < 5) return;
    if (!window.confirm(`Change this space to ${spaceStatus}?`)) return;
    setWorking('space');
    try {
      await platformAdminApi(`/api/platform-admin/spaces/${encodeURIComponent(id)}/status`, platformAdminJson('PATCH', { status: spaceStatus, reason: spaceReason.trim() }));
      toast.success('Space status updated.');
      setSpaceReason('');
      await load();
    } catch (cause) {
      toast.error(platformAdminErrorMessage(cause, 'Could not update the space.'));
    } finally {
      setWorking('');
    }
  }

  async function updateSubscriptionStatus() {
    if (!id || !detail?.subscription || subscriptionReason.trim().length < 5) return;
    if (!window.confirm(`Change this subscription to ${subscriptionStatus}?`)) return;
    setWorking('subscription');
    try {
      await platformAdminApi(`/api/platform-admin/spaces/${encodeURIComponent(id)}/subscription`, platformAdminJson('PATCH', {
        status: subscriptionStatus,
        reason: subscriptionReason.trim(),
        expectedVersion: detail.subscription.version
      }));
      toast.success('Subscription status updated.');
      setSubscriptionReason('');
      await load();
    } catch (cause) {
      toast.error(platformAdminErrorMessage(cause, 'Could not update the subscription.'));
      await load();
    } finally {
      setWorking('');
    }
  }

  const space = detail?.space;
  return <div className="space-y-6">
    <Button asChild variant="ghost" size="sm" className="-ml-3"><Link to="/admin/spaces"><ArrowLeft />All spaces</Link></Button>
    <AdminPageHeader title={space?.name || 'Space detail'} description={space ? `${space.slug} · ${space.personal ? 'Personal space' : 'Shared space'}` : 'Membership, usage, subscription, and access controls.'} actions={<Button variant="outline" size="sm" disabled={refreshing} onClick={() => void load()}><RefreshCw className={refreshing ? 'animate-spin' : ''} />Refresh</Button>} />
    {error && <AdminError message={error} onRetry={() => void load()} />}
    {!detail ? !error && <AdminLoading label="Loading space..." /> : space && <>
      <SummaryStrip items={[
        { label: 'Members', value: space.memberCount, note: space.owner ? `Owned by ${space.owner.name}` : 'No owner recorded' },
        { label: 'Surveys', value: detail.counts.surveys, note: `${detail.counts.responses} responses` },
        { label: 'Campaigns', value: detail.counts.campaigns, note: `${detail.counts.agreements} agreements` },
        { label: 'AI jobs', value: detail.counts.aiJobs, note: `${detail.counts.knowledgeBases} knowledge bases` }
      ]} />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <section className="overflow-hidden rounded-lg border bg-card" aria-labelledby="space-members-heading"><div className="border-b px-5 py-4"><h2 id="space-members-heading" className="section-title">Members</h2></div><div className="overflow-x-auto"><table className="data-table"><thead><tr><th>Member</th><th>Role</th><th>Joined</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{detail.members.length ? detail.members.map((member) => <tr key={member.id}><td><div className="font-medium">{member.name}</div><div className="mt-0.5 text-xs text-muted-foreground">{member.email}</div></td><td className="capitalize">{member.role}</td><td>{formatAdminDate(member.joinedAt)}</td><td className="text-right"><Button asChild variant="outline" size="sm"><Link to={`/admin/users/${member.id}`}>Open user</Link></Button></td></tr>) : <AdminEmptyRow columns={4}>No members are recorded for this space.</AdminEmptyRow>}</tbody></table></div></section>

        <div className="space-y-6">
          <section className="rounded-lg border bg-card" aria-labelledby="space-record-heading"><div className="border-b px-5 py-4"><h2 id="space-record-heading" className="section-title">Space record</h2></div><dl className="divide-y text-sm">{[
            ['Status', <AdminStatus value={space.status} />],
            ['Created', formatAdminDate(space.createdAt)],
            ['Updated', formatAdminDate(space.updatedAt)],
            ['Open recovery tickets', detail.counts.openTickets]
          ].map(([label, value]) => <div className="flex items-center justify-between gap-4 px-5 py-3" key={String(label)}><dt className="text-muted-foreground">{label}</dt><dd>{value}</dd></div>)}</dl></section>

          <section className="rounded-lg border bg-card" aria-labelledby="space-subscription-heading"><div className="border-b px-5 py-4"><h2 id="space-subscription-heading" className="section-title">Subscription</h2></div>{detail.subscription ? <dl className="divide-y text-sm"><div className="flex items-center justify-between gap-4 px-5 py-3"><dt className="text-muted-foreground">Plan</dt><dd className="font-medium">{detail.subscription.plan?.name || detail.subscription.planCode}</dd></div><div className="flex items-center justify-between gap-4 px-5 py-3"><dt className="text-muted-foreground">Status</dt><dd><AdminStatus value={detail.subscription.status} /></dd></div><div className="flex items-center justify-between gap-4 px-5 py-3"><dt className="text-muted-foreground">Effective</dt><dd>{formatAdminDate(detail.subscription.effectiveAt, true)}</dd></div><div className="flex items-center justify-between gap-4 px-5 py-3"><dt className="text-muted-foreground">Version</dt><dd>{detail.subscription.version}</dd></div></dl> : <p className="p-5 text-sm text-muted-foreground">No managed subscription. Starter defaults apply.</p>}</section>

          {capabilities?.manageSpaces && <section className="rounded-lg border bg-card" aria-labelledby="space-access-heading"><div className="border-b px-5 py-4"><h2 id="space-access-heading" className="section-title">Space access</h2><p className="mt-1 text-xs text-muted-foreground">Status changes are audited.</p></div><div className="space-y-3 p-5"><select aria-label="New space status" value={spaceStatus} onChange={(event) => setSpaceStatus(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="active">Active</option><option value="suspended">Suspended</option><option value="archived">Archived</option></select><Input aria-label="Reason for space status change" value={spaceReason} onChange={(event) => setSpaceReason(event.target.value)} maxLength={1000} placeholder="Required reason" /><Button size="sm" disabled={working !== '' || spaceReason.trim().length < 5 || spaceStatus === space.status} onClick={() => void updateSpaceStatus()}>{working === 'space' ? <Loader2 className="animate-spin" /> : <Save />}Apply space status</Button></div></section>}

          {capabilities?.decideSubscriptions && detail.subscription && <section className="rounded-lg border bg-card" aria-labelledby="subscription-access-heading"><div className="border-b px-5 py-4"><h2 id="subscription-access-heading" className="section-title">Subscription access</h2></div><div className="space-y-3 p-5"><select aria-label="New subscription status" value={subscriptionStatus} onChange={(event) => setSubscriptionStatus(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="active">Active</option><option value="suspended">Suspended</option><option value="cancelled">Cancelled</option></select><Input aria-label="Reason for subscription status change" value={subscriptionReason} onChange={(event) => setSubscriptionReason(event.target.value)} maxLength={1000} placeholder="Required reason" /><Button size="sm" disabled={working !== '' || subscriptionReason.trim().length < 5 || subscriptionStatus === detail.subscription.status} onClick={() => void updateSubscriptionStatus()}>{working === 'subscription' ? <Loader2 className="animate-spin" /> : <Save />}Apply subscription status</Button></div></section>}
        </div>
      </div>
    </>}
  </div>;
}
