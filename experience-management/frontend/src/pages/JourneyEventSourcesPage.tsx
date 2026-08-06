import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Bug, Code2, Inbox, KeyRound, ListChecks, LoaderCircle, Plus, ScrollText, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/EmptyState';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CreateEventSourceDialog } from '@/components/journey-events/CreateEventSourceDialog';
import { CredentialSecretDialog } from '@/components/journey-events/CredentialSecretDialog';
import { EventSourceAudit } from '@/components/journey-events/EventSourceAudit';
import { EventSourceConfiguration } from '@/components/journey-events/EventSourceConfiguration';
import { EventSourceCredentials } from '@/components/journey-events/EventSourceCredentials';
import { EventSourceDeadLetters } from '@/components/journey-events/EventSourceDeadLetters';
import { EventSourceDebugger } from '@/components/journey-events/EventSourceDebugger';
import { EventSourceUsage } from '@/components/journey-events/EventSourceUsage';
import { TrackingPlanWorkspace } from '@/components/journey-events/TrackingPlanWorkspace';
import { controlSelectClass, StatusLabel } from '@/components/journey-events/shared';
import { useAuthSession, useSessionFeature } from '@/lib/authSessionContext';
import {
  listJourneyEventSources,
  type JourneyEventSource,
  type JourneyIssuedCredential
} from '@/lib/journeyEventControlPlane';
import { cn } from '@/lib/utils';

export function JourneyEventSourcesPage() {
  const session = useAuthSession();
  const connectedJourneysEnabled = useSessionFeature('journeyConnected');
  const canManage = ['owner', 'admin'].includes(session?.activeSpace?.role || '');
  const [sources, setSources] = useState<JourneyEventSource[]>([]);
  const [quota, setQuota] = useState<{ used: number; limit: number; remaining: number } | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [issued, setIssued] = useState<JourneyIssuedCredential | null>(null);

  const load = useCallback(async (preferredId = '') => {
    if (!connectedJourneysEnabled) return;
    try {
      setLoading(true);
      setError('');
      const result = await listJourneyEventSources();
      setSources(result.sources);
      setQuota(result.quota);
      setSelectedId((current) => preferredId || (result.sources.some((source) => source.id === current) ? current : result.sources[0]?.id || ''));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Event sources could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [connectedJourneysEnabled]);

  useEffect(() => {
    if (!connectedJourneysEnabled) return;
    void load();
  }, [connectedJourneysEnabled, load]);

  const selected = useMemo(() => sources.find((source) => source.id === selectedId) || null, [selectedId, sources]);

  if (!connectedJourneysEnabled) return null;

  function created(source: JourneyEventSource) {
    setSources((current) => [source, ...current.filter((item) => item.id !== source.id)]);
    setQuota((current) => current ? { ...current, used: Math.max(current.used, sources.length + 1) } : current);
    setSelectedId(source.id);
    setCreateOpen(false);
  }

  function changed(source: JourneyEventSource) {
    setSources((current) => current.map((item) => item.id === source.id ? source : item));
  }

  const quotaReached = Boolean(quota && quota.limit >= 0 && quota.used >= quota.limit);
  return <div className="mx-auto w-full max-w-[1440px] space-y-5 px-4 py-5 sm:px-6 sm:py-6">
    <header className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="page-title">Event sources</h1>
        <p className="page-description">Connect product instrumentation to journey analytics and govern each event through a versioned tracking plan.</p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {quota && <span className="text-xs text-muted-foreground">{quota.used} of {quota.limit < 0 ? 'unlimited' : quota.limit} sources</span>}
        {canManage && <Button disabled={quotaReached} title={quotaReached ? 'The event-source limit for this plan has been reached.' : undefined} onClick={() => setCreateOpen(true)}><Plus />Create source</Button>}
      </div>
    </header>

    {!canManage && <div className="border bg-muted/35 px-4 py-3 text-sm">You have viewer access. Space owners and admins can change source policies, credentials, and tracking plans.</div>}
    {error && <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-destructive" role="alert">{error}</div>}

    {loading && sources.length === 0 ? <div className="flex min-h-64 items-center justify-center gap-2 border bg-card text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" />Loading event sources…</div>
      : sources.length === 0 ? <EmptyState icon={Code2} title="No event sources" description="Create a source for a web, mobile, or server application. Credentials and the tracking plan are managed after the source exists." action={canManage && !quotaReached ? <Button onClick={() => setCreateOpen(true)}><Plus />Create source</Button> : undefined} />
        : <div className="grid items-start gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="border bg-card" aria-label="Event sources">
            <div className="border-b p-3 lg:hidden"><label className="sr-only" htmlFor="event-source-mobile-select">Event source</label><select id="event-source-mobile-select" className={controlSelectClass} value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{sources.map((source) => <option key={source.id} value={source.id}>{source.name} — {source.environment}</option>)}</select></div>
            <ul className="hidden divide-y lg:block">{sources.map((source) => <li key={source.id}><button type="button" aria-current={source.id === selectedId ? 'page' : undefined} className={cn('w-full px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', source.id === selectedId ? 'bg-muted' : 'hover:bg-muted/40')} onClick={() => setSelectedId(source.id)}><span className="block truncate text-sm font-medium">{source.name}</span><span className="mt-1 block text-xs capitalize text-muted-foreground">{source.environment} · {source.status}</span></button></li>)}</ul>
          </aside>

          {selected && <main className="min-w-0 space-y-4">
            <div className="flex flex-col gap-3 border bg-card px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold">{selected.name}</h2><StatusLabel status={selected.status} /></div><p className="mt-1 text-xs capitalize text-muted-foreground">{selected.environment} · {selected.validationMode} validation · {selected.activeSchemaCount} active schemas</p></div>
              <code className="break-all text-xs text-muted-foreground">{selected.id}</code>
            </div>

            <Tabs defaultValue="policy" className="min-w-0">
              <div className="overflow-x-auto"><TabsList className="min-w-max" aria-label="Event source settings">
                <TabsTrigger value="policy"><Settings2 className="mr-2 h-4 w-4" />Policy</TabsTrigger>
                <TabsTrigger value="credentials"><KeyRound className="mr-2 h-4 w-4" />Credentials</TabsTrigger>
                <TabsTrigger value="tracking-plan"><ListChecks className="mr-2 h-4 w-4" />Tracking plan</TabsTrigger>
                <TabsTrigger value="debugger"><Bug className="mr-2 h-4 w-4" />Debugger</TabsTrigger>
                <TabsTrigger value="dead-letters"><Inbox className="mr-2 h-4 w-4" />Dead letters</TabsTrigger>
                <TabsTrigger value="usage"><BarChart3 className="mr-2 h-4 w-4" />Usage</TabsTrigger>
                <TabsTrigger value="audit"><ScrollText className="mr-2 h-4 w-4" />Audit</TabsTrigger>
              </TabsList></div>
              <TabsContent value="policy"><EventSourceConfiguration source={selected} canManage={canManage} onChanged={changed} /></TabsContent>
              <TabsContent value="credentials"><EventSourceCredentials source={selected} canManage={canManage} onIssued={setIssued} /></TabsContent>
              <TabsContent value="tracking-plan"><TrackingPlanWorkspace source={selected} canManage={canManage} /></TabsContent>
              <TabsContent value="debugger"><EventSourceDebugger source={selected} /></TabsContent>
              <TabsContent value="dead-letters"><EventSourceDeadLetters source={selected} canManage={canManage} /></TabsContent>
              <TabsContent value="usage"><EventSourceUsage source={selected} /></TabsContent>
              <TabsContent value="audit"><EventSourceAudit source={selected} /></TabsContent>
            </Tabs>
          </main>}
        </div>}

    {canManage && <CreateEventSourceDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={created} />}
    {issued && selected && <CredentialSecretDialog issued={issued} sourceName={selected.name} onDismiss={() => setIssued(null)} />}
  </div>;
}
