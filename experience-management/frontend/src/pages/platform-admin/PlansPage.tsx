import { useCallback, useEffect, useState } from 'react';
import { Loader2, Pencil, RefreshCw, RotateCcw, Save } from 'lucide-react';
import { toast } from 'sonner';
import { usePlatformAdminAccess } from '@/components/platform-admin/PlatformAdminShell';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { platformAdminApi, platformAdminErrorMessage, platformAdminJson } from '@/lib/platformAdminApi';
import { platformAdminHasPermission, type PlatformManagedPlan } from './types';
import { AdminError, AdminLoading, AdminPageHeader, formatAdminDate, formatBytes } from './shared';

const featureOptions: Array<{ key: keyof PlatformManagedPlan['features']; label: string; description: string }> = [
  { key: 'surveys', label: 'Surveys', description: 'Create, publish, and collect survey responses.' },
  { key: 'campaigns', label: 'Campaigns', description: 'Distribute surveys through managed campaigns.' },
  { key: 'agreements', label: 'Agreements', description: 'Prepare and route electronic agreements.' },
  { key: 'serviceRecovery', label: 'Service recovery', description: 'Open and manage recovery cases.' },
  { key: 'socialListening', label: 'Social Listening', description: 'Connect X accounts and run social workflows.' },
  { key: 'knowledgeBases', label: 'Knowledge Bases', description: 'Store, index, and retrieve workspace knowledge.' },
  { key: 'terra', label: 'AI runtime', description: 'Use local or connected ChatGPT intelligence actions.' }
];

const limitOptions: Array<{ key: Exclude<keyof PlatformManagedPlan['limits'], 'knowledgeStorageBytes'>; label: string }> = [
  { key: 'seats', label: 'Seats' },
  { key: 'activeSurveys', label: 'Active surveys' },
  { key: 'monthlyAiActions', label: 'AI actions per month' }
];

const gigabyte = 1024 * 1024 * 1024;

function copyPlan(plan: PlatformManagedPlan) {
  return { ...plan, features: { ...plan.features }, limits: { ...plan.limits } };
}

export function PlatformAdminPlansPage() {
  const access = usePlatformAdminAccess();
  const canManage = platformAdminHasPermission(access, 'subscriptions.manage');
  const [plans, setPlans] = useState<PlatformManagedPlan[] | null>(null);
  const [editing, setEditing] = useState<PlatformManagedPlan | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState<'save' | 'reset' | ''>('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const value = await platformAdminApi<{ plans: PlatformManagedPlan[] }>('/api/platform-admin/plans');
      setPlans(value.plans);
      setError('');
    } catch (cause) {
      setError(platformAdminErrorMessage(cause, 'Could not load subscription plans.'));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function openEditor(plan: PlatformManagedPlan) {
    setEditing(copyPlan(plan));
    setReason('');
  }

  function replacePlan(plan: PlatformManagedPlan) {
    setPlans((current) => current?.map((item) => item.code === plan.code ? plan : item) || [plan]);
    setEditing(copyPlan(plan));
  }

  async function save() {
    if (!editing) return;
    setWorking('save');
    try {
      const value = await platformAdminApi<{ plan: PlatformManagedPlan }>(
        `/api/platform-admin/plans/${editing.code}`,
        platformAdminJson('PUT', {
          name: editing.name,
          description: editing.description,
          requestable: editing.requestable,
          features: editing.features,
          limits: editing.limits,
          expectedVersion: editing.version,
          reason: reason.trim()
        })
      );
      replacePlan(value.plan);
      setReason('');
      toast.success(`${value.plan.name} plan saved.`);
    } catch (cause) {
      toast.error(platformAdminErrorMessage(cause, 'Could not save this plan.'));
    } finally {
      setWorking('');
    }
  }

  async function reset() {
    if (!editing || !window.confirm(`Restore the system defaults for ${editing.name}? Existing ${editing.code} subscriptions will receive the restored limits and features.`)) return;
    setWorking('reset');
    try {
      const value = await platformAdminApi<{ plan: PlatformManagedPlan }>(
        `/api/platform-admin/plans/${editing.code}/reset`,
        platformAdminJson('POST', { expectedVersion: editing.version, reason: reason.trim() })
      );
      replacePlan(value.plan);
      setReason('');
      toast.success(`${value.plan.name} defaults restored.`);
    } catch (cause) {
      toast.error(platformAdminErrorMessage(cause, 'Could not reset this plan.'));
    } finally {
      setWorking('');
    }
  }

  return <div className="space-y-6">
    <AdminPageHeader
      title="Plans"
      description="Features and usage allowances applied to workspace subscriptions. Changes affect every workspace currently using the plan."
      actions={<Button size="sm" variant="outline" disabled={refreshing} onClick={() => void load()}><RefreshCw className={refreshing ? 'animate-spin' : ''} />Refresh</Button>}
    />
    {error && <AdminError message={error} onRetry={() => void load()} />}
    {!plans ? !error && <AdminLoading label="Loading subscription plans..." /> : <div className="overflow-hidden rounded-lg border bg-card">
      <div className="overflow-x-auto"><table className="data-table"><thead><tr><th>Plan</th><th>Requestable</th><th>Included features</th><th>Seats</th><th>AI actions</th><th>Knowledge</th><th>Active spaces</th><th>Updated</th>{canManage && <th><span className="sr-only">Action</span></th>}</tr></thead><tbody>
        {plans.map((plan) => <tr key={plan.code}>
          <td><div className="font-medium">{plan.name}</div><div className="mt-0.5 font-mono text-xs text-muted-foreground">{plan.code}</div></td>
          <td>{plan.requestable ? 'Yes' : 'No'}</td>
          <td className="max-w-sm text-xs leading-5 text-muted-foreground">{featureOptions.filter((feature) => plan.features[feature.key]).map((feature) => feature.label).join(', ') || 'None'}</td>
          <td className="tabular-nums">{plan.limits.seats.toLocaleString()}</td>
          <td className="tabular-nums">{plan.limits.monthlyAiActions.toLocaleString()}</td>
          <td>{formatBytes(plan.limits.knowledgeStorageBytes)}</td>
          <td><div className="tabular-nums">{plan.activeSubscriptions.toLocaleString()}</div>{plan.pendingRequests > 0 && <div className="mt-0.5 text-xs text-amber-700">{plan.pendingRequests} pending</div>}</td>
          <td>{formatAdminDate(plan.updatedAt)}</td>
          {canManage && <td className="text-right"><Button size="sm" variant="outline" onClick={() => openEditor(plan)}><Pencil />Edit</Button></td>}
        </tr>)}
      </tbody></table></div>
    </div>}

    <Dialog open={Boolean(editing)} onOpenChange={(open) => { if (!open && !working) setEditing(null); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit {editing?.name || 'plan'}</DialogTitle>
          <DialogDescription>Saved features and limits take effect immediately for existing subscriptions. Pending requests keep their submitted terms and must be resubmitted after a change.</DialogDescription>
        </DialogHeader>
        {editing && <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label className="field-label" htmlFor="plan-name">Plan name</label><Input id="plan-name" value={editing.name} maxLength={80} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></div>
            <div><label className="field-label" htmlFor="plan-code">Code</label><Input id="plan-code" value={editing.code} disabled /></div>
          </div>
          <div><label className="field-label" htmlFor="plan-description">Description</label><Textarea id="plan-description" rows={3} maxLength={300} value={editing.description} onChange={(event) => setEditing({ ...editing, description: event.target.value })} /></div>
          <label className="flex items-start gap-3 border px-3 py-3 text-sm"><input type="checkbox" className="mt-0.5 h-4 w-4" checked={editing.requestable} onChange={(event) => setEditing({ ...editing, requestable: event.target.checked })} /><span><span className="block font-medium">Available for plan requests</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">Workspace owners can select this plan when submitting a subscription request.</span></span></label>

          <section aria-labelledby="plan-features-heading"><h2 id="plan-features-heading" className="text-sm font-semibold">Features</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Turning off a feature removes it from workspace navigation and blocks direct URL and API access.</p><div className="mt-2 grid border sm:grid-cols-2">
            {featureOptions.map((feature) => <label key={feature.key} className="flex items-start gap-3 border-b p-3 last:border-b-0 sm:border-r sm:[&:nth-last-child(-n+2)]:border-b-0"><input type="checkbox" className="mt-0.5 h-4 w-4" checked={editing.features[feature.key]} onChange={(event) => setEditing({ ...editing, features: { ...editing.features, [feature.key]: event.target.checked } })} /><span><span className="block text-sm font-medium">{feature.label}</span><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{feature.description}</span></span></label>)}
          </div></section>

          <section aria-labelledby="plan-limits-heading"><h2 id="plan-limits-heading" className="text-sm font-semibold">Usage limits</h2><div className="mt-2 grid gap-4 sm:grid-cols-2">
            {limitOptions.map((limit) => <div key={limit.key}><label className="field-label" htmlFor={`plan-limit-${limit.key}`}>{limit.label}</label><Input id={`plan-limit-${limit.key}`} type="number" min={limit.key === 'seats' ? 1 : 0} step={1} value={editing.limits[limit.key]} onChange={(event) => setEditing({ ...editing, limits: { ...editing.limits, [limit.key]: Math.max(limit.key === 'seats' ? 1 : 0, Math.floor(Number(event.target.value) || 0)) } })} /></div>)}
            <div><label className="field-label" htmlFor="plan-limit-storage">Knowledge storage (GB)</label><Input id="plan-limit-storage" type="number" min={0} max={10240} step={1} value={editing.limits.knowledgeStorageBytes / gigabyte} onChange={(event) => setEditing({ ...editing, limits: { ...editing.limits, knowledgeStorageBytes: Math.max(0, Math.round((Number(event.target.value) || 0) * gigabyte)) } })} /></div>
          </div></section>

          {editing.pendingRequests > 0 && <div className="border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="note">This plan has {editing.pendingRequests} pending request{editing.pendingRequests === 1 ? '' : 's'}. Saving new terms will require those workspaces to review and submit again.</div>}
          <div><label className="field-label" htmlFor="plan-change-reason">Reason for this change</label><Textarea id="plan-change-reason" rows={3} minLength={5} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Required for the administrator audit log" /></div>
        </div>}
        <DialogFooter className="sm:items-center sm:justify-between">
          <Button variant="outline" disabled={working !== '' || reason.trim().length < 5} onClick={() => void reset()}>{working === 'reset' ? <Loader2 className="animate-spin" /> : <RotateCcw />}Restore defaults</Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row"><Button variant="outline" disabled={working !== ''} onClick={() => setEditing(null)}>Cancel</Button><Button disabled={working !== '' || reason.trim().length < 5 || !editing || editing.name.trim().length < 2} onClick={() => void save()}>{working === 'save' ? <Loader2 className="animate-spin" /> : <Save />}Save plan</Button></div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
