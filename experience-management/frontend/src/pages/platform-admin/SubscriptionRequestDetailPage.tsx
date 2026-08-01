import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Check, Loader2, RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Link, useParams } from '@/lib/router';
import { PlatformAdminApiError, platformAdminApi, platformAdminErrorMessage, platformAdminJson } from '@/lib/platformAdminApi';
import type { PlatformSubscriptionRequestDetail } from './types';
import { AdminError, AdminLoading, AdminPageHeader, AdminStatus, formatAdminDate, safeJson } from './shared';

interface AdminCapabilities { capabilities: { decideSubscriptions: boolean } }

export function PlatformAdminSubscriptionRequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<PlatformSubscriptionRequestDetail | null>(null);
  const [canDecide, setCanDecide] = useState(false);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [working, setWorking] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const [breakGlass, setBreakGlass] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setRefreshing(true);
    try {
      const [next, me] = await Promise.all([
        platformAdminApi<PlatformSubscriptionRequestDetail>(`/api/platform-admin/subscription-requests/${encodeURIComponent(id)}`),
        platformAdminApi<AdminCapabilities>('/api/platform-admin/me')
      ]);
      setDetail(next);
      setCanDecide(me.capabilities.decideSubscriptions);
      setReviewNote(next.request.reviewNote || '');
      setBreakGlass(false);
      setError('');
    } catch (cause) {
      setError(platformAdminErrorMessage(cause, 'Could not load this subscription request.'));
    } finally {
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function decide(decision: 'approved' | 'rejected') {
    if (!id || !detail || reviewNote.trim().length < 5) return;
    if (detail.decisionConflict?.approvalForbidden) return;
    if (detail.decisionConflict?.breakGlassRequired && !breakGlass) return;
    const action = decision === 'approved' ? 'approve' : 'reject';
    if (!window.confirm(`${action[0].toUpperCase()}${action.slice(1)} this request? This decision is recorded in the audit log.`)) return;
    setWorking(decision);
    try {
      const next = await platformAdminApi<PlatformSubscriptionRequestDetail>(
        `/api/platform-admin/subscription-requests/${encodeURIComponent(id)}/decision`,
        platformAdminJson('POST', {
          decision,
          reviewNote: reviewNote.trim(),
          expectedVersion: detail.request.version,
          breakGlass: Boolean(detail.decisionConflict?.breakGlassRequired && breakGlass)
        }, crypto.randomUUID())
      );
      setDetail(next);
      toast.success(`Request ${decision}.`);
    } catch (cause) {
      toast.error(platformAdminErrorMessage(cause, `Could not ${action} the request.`));
      if (cause instanceof PlatformAdminApiError && cause.status === 409) await load();
    } finally {
      setWorking('');
    }
  }

  const request = detail?.request;
  return <div className="space-y-6">
    <Button asChild variant="ghost" size="sm" className="-ml-3"><Link to="/admin/subscription-requests"><ArrowLeft />All requests</Link></Button>
    <AdminPageHeader title={request?.space?.name || 'Subscription request'} description={request ? `${request.requestType.replaceAll('_', ' ')} · submitted ${formatAdminDate(request.createdAt)}` : 'Request context, current subscription, and decision.'} actions={<Button variant="outline" size="sm" disabled={refreshing} onClick={() => void load()}><RefreshCw className={refreshing ? 'animate-spin' : ''} />Refresh</Button>} />
    {error && <AdminError message={error} onRetry={() => void load()} />}
    {!detail ? !error && <AdminLoading label="Loading request..." /> : request && <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="space-y-6">
        <section className="rounded-lg border bg-card" aria-labelledby="request-detail-heading"><div className="border-b px-5 py-4"><div className="flex items-center justify-between gap-4"><h2 id="request-detail-heading" className="section-title">Request</h2><AdminStatus value={request.status} /></div></div><dl className="grid gap-px bg-border sm:grid-cols-2">{[
          ['Space', request.space?.name || request.spaceId],
          ['Request type', request.requestType.replaceAll('_', ' ')],
          ['Requested plan', request.requestedPlan?.name || request.requestedPlanCode || 'Not applicable'],
          ['Requester', request.requestedBy?.name || 'Unknown'],
          ['Requester email', request.requestedBy?.email || 'Not recorded'],
          ['Submitted', formatAdminDate(request.createdAt)],
          ['Decision date', formatAdminDate(request.decisionAt)],
          ['Reviewed by', request.reviewedBy?.name || 'Not reviewed']
        ].map(([label, value]) => <div className="bg-card p-4" key={String(label)}><dt className="text-xs font-medium text-muted-foreground">{label}</dt><dd className="mt-1.5 text-sm capitalize">{value}</dd></div>)}</dl>{request.requestNote && <div className="border-t px-5 py-4"><div className="text-xs font-medium text-muted-foreground">Customer note</div><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{request.requestNote}</p></div>}</section>

        <section className="rounded-lg border bg-card" aria-labelledby="current-subscription-heading"><div className="border-b px-5 py-4"><h2 id="current-subscription-heading" className="section-title">Current managed subscription</h2></div>{detail.subscription ? <dl className="grid gap-px bg-border sm:grid-cols-2">{[
          ['Plan', detail.subscription.plan?.name || detail.subscription.planCode],
          ['Status', <AdminStatus value={detail.subscription.status} />],
          ['Effective', formatAdminDate(detail.subscription.effectiveAt)],
          ['Expires', formatAdminDate(detail.subscription.expiresAt)],
          ['Version', detail.subscription.version],
          ['Source request', detail.subscription.sourceRequestId || 'Not recorded']
        ].map(([label, value]) => <div className="bg-card p-4" key={String(label)}><dt className="text-xs font-medium text-muted-foreground">{label}</dt><dd className="mt-1.5 text-sm">{value}</dd></div>)}</dl> : <p className="p-5 text-sm text-muted-foreground">No managed subscription is active. Starter defaults apply.</p>}</section>
      </div>

      <section className="rounded-lg border bg-card" aria-labelledby="request-decision-heading"><div className="border-b px-5 py-4"><h2 id="request-decision-heading" className="section-title">Decision</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">A review note of at least five characters is required and will be audited.</p></div><div className="space-y-4 p-5">{request.status === 'pending' ? <>{canDecide ? <><div><label className="field-label" htmlFor="subscription-review-note">Review note</label><Textarea id="subscription-review-note" value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} maxLength={2000} rows={5} placeholder="Explain why this request is approved or rejected." /></div>{detail.decisionConflict?.approvalForbidden && <div className="border border-destructive/35 bg-destructive/5 px-3 py-3 text-sm text-destructive" role="alert"><div className="font-medium">Conflict of interest</div><p className="mt-1 leading-5">A delegated approver cannot decide a request they created or one belonging to their own workspace.</p></div>}{detail.decisionConflict?.breakGlassRequired && <label className="flex items-start gap-3 border border-amber-200 bg-amber-50/50 px-3 py-3 text-sm"><input type="checkbox" className="mt-0.5 h-4 w-4" checked={breakGlass} onChange={(event) => setBreakGlass(event.target.checked)} /><span><span className="block font-medium">Use root break-glass approval</span><span className="mt-1 block leading-5 text-muted-foreground">I acknowledge that I am connected to this workspace. This exceptional decision and its reason will be recorded separately in the audit log.</span></span></label>}<div className="flex flex-wrap gap-2"><Button disabled={working !== '' || reviewNote.trim().length < 5 || Boolean(detail.decisionConflict?.approvalForbidden) || Boolean(detail.decisionConflict?.breakGlassRequired && !breakGlass)} onClick={() => void decide('approved')}>{working === 'approved' ? <Loader2 className="animate-spin" /> : <Check />}Approve request</Button><Button variant="destructive" disabled={working !== '' || reviewNote.trim().length < 5 || Boolean(detail.decisionConflict?.approvalForbidden) || Boolean(detail.decisionConflict?.breakGlassRequired && !breakGlass)} onClick={() => void decide('rejected')}>{working === 'rejected' ? <Loader2 className="animate-spin" /> : <X />}Reject request</Button></div></> : <p className="text-sm leading-6 text-muted-foreground">Your administrator role can view this request but cannot make billing decisions.</p>}</> : <><AdminStatus value={request.status} />{request.reviewNote && <div><div className="text-xs font-medium text-muted-foreground">Review note</div><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{request.reviewNote}</p></div>}</>}</div>
        <details className="border-t px-5 py-4 text-xs text-muted-foreground"><summary className="cursor-pointer font-medium">Technical reference</summary><pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-all">{safeJson({ requestId: request.id, version: request.version, spaceId: request.spaceId })}</pre></details>
      </section>
    </div>}
  </div>;
}
