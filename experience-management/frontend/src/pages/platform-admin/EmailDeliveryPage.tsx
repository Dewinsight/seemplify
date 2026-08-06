import { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, Loader2, RefreshCw, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { usePlatformAdminAccess } from '@/components/platform-admin/PlatformAdminShell';
import { platformAdminApi, platformAdminErrorMessage, platformAdminJson } from '@/lib/platformAdminApi';
import type { PlatformMailDeliveryAppView, PlatformMailDeliveryEnvironmentView, PlatformMailDeliveryOverview, PlatformMailDeliverySyncResult } from './types';
import { AdminError, AdminLoading, AdminPageHeader, formatAdminDate } from './shared';

function CredentialValue({ value, masked }: { value: string | null; masked: string | null }) {
  const [revealed, setRevealed] = useState(false);
  const display = revealed ? value : masked;
  if (!display) return <span className="text-muted-foreground">Not set</span>;
  return <div className="flex items-center gap-2">
    <code className="max-w-full overflow-x-auto rounded bg-muted px-2 py-1 text-xs">{display}</code>
    <Button type="button" size="sm" variant="outline" onClick={() => setRevealed((current) => !current)}>
      {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      {revealed ? 'Hide' : 'Show'}
    </Button>
  </div>;
}

function EnvironmentCard({ title, environment, note }: { title: string; environment: PlatformMailDeliveryEnvironmentView | null; note?: string | null }) {
  return <section className="rounded-lg border bg-card">
    <div className="border-b px-5 py-4">
      <h2 className="section-title">{title}</h2>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </div>
    {!environment ? <div className="px-5 py-4 text-sm text-muted-foreground">Unavailable</div> : <dl className="divide-y text-sm">
      <div className="grid gap-2 px-5 py-3 sm:grid-cols-[180px_minmax(0,1fr)]"><dt className="text-muted-foreground">Base URL</dt><dd className="break-all font-medium">{environment.baseUrl || 'Not set'}</dd></div>
      <div className="grid gap-2 px-5 py-3 sm:grid-cols-[180px_minmax(0,1fr)]"><dt className="text-muted-foreground">From email</dt><dd className="break-all font-medium">{environment.fromEmail || 'Not set'}</dd></div>
      <div className="grid gap-2 px-5 py-3 sm:grid-cols-[180px_minmax(0,1fr)]"><dt className="text-muted-foreground">From name</dt><dd className="font-medium">{environment.fromName || 'Not set'}</dd></div>
      <div className="grid gap-2 px-5 py-3 sm:grid-cols-[180px_minmax(0,1fr)]"><dt className="text-muted-foreground">API key</dt><dd><CredentialValue value={environment.token.value} masked={environment.token.masked} /></dd></div>
      <div className="grid gap-2 px-5 py-3 sm:grid-cols-[180px_minmax(0,1fr)]"><dt className="text-muted-foreground">Key id</dt><dd className="font-mono text-xs">{environment.token.keyId || 'Not set'}</dd></div>
      <div className="grid gap-2 px-5 py-3 sm:grid-cols-[180px_minmax(0,1fr)]"><dt className="text-muted-foreground">Fingerprint</dt><dd className="font-mono text-xs">{environment.token.fingerprint || 'Not set'}</dd></div>
      <div className="grid gap-2 px-5 py-3 sm:grid-cols-[180px_minmax(0,1fr)]"><dt className="text-muted-foreground">Source</dt><dd className="break-all text-xs text-muted-foreground">{environment.token.source || 'Unknown'}</dd></div>
    </dl>}
  </section>;
}

function AppRow({ app }: { app: PlatformMailDeliveryAppView }) {
  return <section className="overflow-hidden rounded-lg border bg-card">
    <div className="border-b px-5 py-4">
      <h2 className="section-title">{app.label}</h2>
      <p className="mt-1 text-xs text-muted-foreground">Local env: {app.localEnvPath}</p>
    </div>
    <div className="grid gap-6 p-5 xl:grid-cols-2">
      <EnvironmentCard title="Local wiring" environment={app.local} note="This is what the repo-local .env and token file currently resolve to." />
      <EnvironmentCard
        title="Production Dokploy env"
        environment={app.production.environment}
        note={app.production.error
          ? app.production.error
          : `Application ${app.production.applicationName} (${app.production.applicationId})`}
      />
    </div>
  </section>;
}

export function PlatformAdminEmailDeliveryPage() {
  const access = usePlatformAdminAccess();
  const [data, setData] = useState<PlatformMailDeliveryOverview | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [syncReason, setSyncReason] = useState('Sync transactional mail env from local token files to Dokploy production apps.');
  const [working, setWorking] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    try {
      setData(await platformAdminApi<PlatformMailDeliveryOverview>('/api/platform-admin/email-delivery'));
      setError('');
    } catch (reason) {
      setError(platformAdminErrorMessage(reason, 'Could not load email delivery status.'));
    } finally {
      if (!quiet) setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const summary = useMemo(() => {
    if (!data) return null;
    const productionReady = data.apps.filter((app) => app.production.environment?.baseUrl && app.production.environment?.token.value).length;
    return { total: data.apps.length, productionReady };
  }, [data]);

  async function syncProduction() {
    setWorking(true);
    try {
      const result = await platformAdminApi<PlatformMailDeliverySyncResult>(
        '/api/platform-admin/email-delivery/sync',
        platformAdminJson('POST', { reason: syncReason.trim(), deploy: true, publicBaseUrl: data?.publicBaseUrl })
      );
      const failed = result.apps.filter((app) => app.error);
      toast.success(failed.length ? `Sync finished with ${failed.length} app issue${failed.length === 1 ? '' : 's'}.` : 'Dokploy mail env synced and deployments triggered.');
      await load();
    } catch (reason) {
      toast.error(platformAdminErrorMessage(reason, 'Could not sync Dokploy mail env.'));
    } finally {
      setWorking(false);
    }
  }

  return <div className="space-y-6" data-testid="platform-admin-email-delivery">
    <AdminPageHeader
      title="Email delivery"
      description="See the transactional mail API key wiring locally and in Dokploy production, then push the same values live from this screen."
      actions={<div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={refreshing} onClick={() => void load()}><RefreshCw className={refreshing ? 'animate-spin' : ''} />Refresh</Button>
        <Button size="sm" disabled={working || !access.root || syncReason.trim().length < 5} onClick={() => void syncProduction()}>
          {working ? <Loader2 className="animate-spin" /> : <Send className="h-4 w-4" />}
          Sync Dokploy env
        </Button>
      </div>}
    />
    {error && <AdminError message={error} onRetry={() => void load()} />}
    {!data ? !error && <AdminLoading label="Loading transactional mail status..." /> : <>
      <section className="rounded-lg border bg-card">
        <div className="border-b px-5 py-4">
          <h2 className="section-title">Mail control summary</h2>
          <p className="mt-1 text-xs text-muted-foreground">Public mail API URL: {data.publicBaseUrl}</p>
        </div>
        <div className="grid gap-4 p-5 lg:grid-cols-3">
          <div className="rounded border p-4"><div className="text-xs uppercase tracking-wide text-muted-foreground">Apps in scope</div><div className="mt-2 text-2xl font-semibold">{summary?.total || 0}</div></div>
          <div className="rounded border p-4"><div className="text-xs uppercase tracking-wide text-muted-foreground">Production wired</div><div className="mt-2 text-2xl font-semibold">{summary?.productionReady || 0}</div></div>
          <div className="rounded border p-4"><div className="text-xs uppercase tracking-wide text-muted-foreground">Dokploy</div><div className="mt-2 text-sm font-medium">{data.dokploy.available ? `${data.dokploy.projectName || 'Connected'} · token ${data.dokploy.tokenFingerprint || 'n/a'}` : data.dokploy.error || 'Unavailable'}</div></div>
        </div>
        <div className="border-t px-5 py-4">
          <label className="field-label" htmlFor="mail-sync-reason">Audit reason for production sync</label>
          <textarea id="mail-sync-reason" className="mt-1 min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm" value={syncReason} onChange={(event) => setSyncReason(event.target.value)} />
          <p className="mt-2 text-xs text-muted-foreground">Docs: {data.docs.integrationGuide} · Service repo: {data.docs.localServiceRepo}</p>
        </div>
      </section>

      {data.apps.map((app) => <AppRow app={app} key={app.id} />)}

      <p className="text-right text-xs text-muted-foreground">Root-only mail configuration view · refreshed {formatAdminDate(new Date().toISOString())}</p>
    </>}
  </div>;
}

