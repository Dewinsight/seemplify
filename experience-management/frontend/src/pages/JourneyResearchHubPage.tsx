import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, BookOpenText, CircleAlert, History, LoaderCircle, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useAuthSession, useSessionFeature } from '@/lib/authSessionContext';
import {
  applyLatestJourneyResearchSnapshot,
  assessJourneyResearchLink,
  catalogueJourneyResearchSource,
  createJourneyResearchGap,
  createJourneyResearchIntake,
  createJourneyResearchLink,
  createJourneyResearchMonitor,
  getJourneyResearchLink,
  getJourneyResearchSource,
  listJourneyResearchAudit,
  listJourneyResearchCatalogue,
  listJourneyResearchGaps,
  listJourneyResearchInbox,
  listJourneyResearchIntakes,
  listJourneyResearchLinks,
  listJourneyResearchMonitors,
  listJourneyResearchNotifications,
  listJourneyResearchRefreshRuns,
  queueJourneyResearchRefresh,
  updateJourneyResearchGap,
  updateJourneyResearchMonitor,
  updateJourneyResearchNotification,
  type JourneyResearchCatalogueItem,
  type JourneyResearchGap,
  type JourneyResearchInboxItem,
  type JourneyResearchIntake,
  type JourneyResearchLinkDetail,
  type JourneyResearchLinkSummary,
  type JourneyResearchMonitor,
  type JourneyResearchNotification,
  type JourneyResearchClassification,
  type JourneyResearchRelationship,
  type JourneyResearchRefreshRun,
  type JourneyResearchSourceSummary,
  type JourneyResearchSnapshot,
  type JourneyResearchTargetType
} from '@/lib/journeyResearch';
import { getKnowledgeBases } from '@/lib/knowledgeBases';
import { evidenceSourceLabels, listJourneyMaps, readJourneyMap, type JourneyMapReadModel } from '@/lib/journeyMaps';
import type { KnowledgeBase } from '@/types';

type SourceDetail = {
  source: JourneyResearchSourceSummary;
  current: Record<string, unknown>;
  latestSnapshot: JourneyResearchSnapshot | null;
};

function readable(value: string) {
  return value.replace(/[._-]+/gu, ' ').replace(/^./u, (letter) => letter.toUpperCase());
}

function dateTime(value: string | null | undefined) {
  if (!value) return 'Not recorded';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function stringField(value: Record<string, unknown>, key: string) {
  return typeof value[key] === 'string' ? String(value[key]) : '';
}

function ErrorNotice({ message }: { message: string }) {
  if (!message) return null;
  return <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-destructive" role="alert">{message}</div>;
}

function EmptyRow({ columns, children }: { columns: number; children: string }) {
  return <tr><td colSpan={columns} className="px-4 py-8 text-center text-sm text-muted-foreground">{children}</td></tr>;
}

function SourceViewer({ detail }: { detail: SourceDetail | null }) {
  if (!detail) return <div className="border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
    Select a catalogued source to inspect its current authorised record and pinned research snapshot.
  </div>;
  const snapshot = detail.latestSnapshot;
  const currentLabel = stringField(detail.current, 'sourceLabel') || 'Current authorised source';
  const currentExcerpt = stringField(detail.current, 'excerpt');
  const currentPopulation = stringField(detail.current, 'population');
  return <section className="border bg-card" aria-labelledby="research-source-viewer-heading">
    <div className="border-b px-4 py-3">
      <h2 id="research-source-viewer-heading" className="text-sm font-semibold">Authorised source viewer</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {evidenceSourceLabels[detail.source.sourceType] || readable(detail.source.sourceType)} · {detail.source.state} · revision {detail.source.revision}
      </p>
    </div>
    <dl className="grid gap-px bg-border sm:grid-cols-3">
      <div className="bg-background px-4 py-3"><dt className="text-xs text-muted-foreground">Current access</dt><dd className="mt-1 text-sm">{detail.source.state}</dd></div>
      <div className="bg-background px-4 py-3"><dt className="text-xs text-muted-foreground">Last resolved</dt><dd className="mt-1 text-sm">{dateTime(detail.source.lastResolvedAt)}</dd></div>
      <div className="bg-background px-4 py-3"><dt className="text-xs text-muted-foreground">Snapshot</dt><dd className="mt-1 text-sm">{snapshot ? `Version ${snapshot.version}` : 'None'}</dd></div>
    </dl>
    <div className="border-b px-4 py-4"><p className="text-xs font-medium text-muted-foreground">Current authorised record</p>
      <h3 className="mt-1 text-sm font-medium">{currentLabel}</h3><p className="mt-1 whitespace-pre-wrap text-sm leading-6">{currentExcerpt || 'No current excerpt is available.'}</p>
      {currentPopulation && <p className="mt-2 text-xs text-muted-foreground">Population: {currentPopulation}</p>}
    </div>
    {snapshot ? <div className="space-y-3 px-4 py-4">
      <div><p className="text-xs font-medium text-muted-foreground">Latest retained snapshot</p><h3 className="mt-1 text-sm font-medium">{snapshot.sourceLabel}</h3><p className="mt-1 whitespace-pre-wrap text-sm leading-6">{snapshot.excerpt || 'No excerpt was retained.'}</p></div>
      <dl className="grid gap-3 text-xs text-muted-foreground sm:grid-cols-2">
        <div><dt>Population and sample</dt><dd className="mt-1 text-foreground">{snapshot.population || 'Not specified'}{snapshot.sampleSize === null ? '' : ` · n=${snapshot.sampleSize}`}</dd></div>
        <div><dt>Evidence window</dt><dd className="mt-1 text-foreground">{dateTime(snapshot.windowStart)} — {dateTime(snapshot.windowEnd)}</dd></div>
        <div><dt>Source updated</dt><dd className="mt-1 text-foreground">{dateTime(snapshot.sourceUpdatedAt)}</dd></div>
        <div><dt>Retention expires</dt><dd className="mt-1 text-foreground">{dateTime(snapshot.retentionExpiresAt)}</dd></div>
      </dl>
    </div> : <p className="px-4 py-6 text-sm text-muted-foreground">This source does not yet have a retained snapshot.</p>}
  </section>;
}

function inboxDescription(item: JourneyResearchInboxItem) {
  if (item.itemKind === 'notification') return `${readable(item.kind)} · ${dateTime(item.createdAt)}`;
  if (item.itemKind === 'gap') return `${readable(item.priority)} priority · ${readable(item.status)}`;
  if (item.itemKind === 'source_state') return `Source is ${readable(item.state)} · ${dateTime(item.updatedAt)}`;
  return `${readable(item.refreshStatus)} · ${readable(item.access)} · ${item.changedFields.length} changed field${item.changedFields.length === 1 ? '' : 's'}`;
}

export function JourneyResearchHubPage() {
  const session = useAuthSession();
  const enabled = useSessionFeature('journeyEvidence');
  const canManage = Boolean(session?.activeSpace && session.activeSpace.role !== 'member');
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [catalogue, setCatalogue] = useState<JourneyResearchCatalogueItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [sourceDetail, setSourceDetail] = useState<SourceDetail | null>(null);
  const [links, setLinks] = useState<JourneyResearchLinkSummary[]>([]);
  const [linkDetail, setLinkDetail] = useState<JourneyResearchLinkDetail | null>(null);
  const [inbox, setInbox] = useState<JourneyResearchInboxItem[]>([]);
  const [gaps, setGaps] = useState<JourneyResearchGap[]>([]);
  const [intakes, setIntakes] = useState<JourneyResearchIntake[]>([]);
  const [monitors, setMonitors] = useState<JourneyResearchMonitor[]>([]);
  const [runs, setRuns] = useState<JourneyResearchRefreshRun[]>([]);
  const [notifications, setNotifications] = useState<JourneyResearchNotification[]>([]);
  const [audit, setAudit] = useState<Array<{ id: string; action: string; targetType: string; targetId: string; createdAt: string }>>([]);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [maps, setMaps] = useState<Array<{ id: string; name: string }>>([]);
  const [targetMap, setTargetMap] = useState<JourneyMapReadModel | null>(null);
  const [targetMapId, setTargetMapId] = useState('');
  const [targetType, setTargetType] = useState<JourneyResearchTargetType>('definition');
  const [targetId, setTargetId] = useState('');
  const [intakeDraft, setIntakeDraft] = useState({
    knowledgeBaseId: '', kind: 'research_note' as JourneyResearchIntake['kind'], method: '', markdown: '',
    population: '', tags: '', consentBasis: 'documented' as JourneyResearchIntake['consentBasis'],
    retentionExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10)
  });
  const [gapDraft, setGapDraft] = useState({ title: '', description: '', priority: 'medium' as JourneyResearchGap['priority'] });
  const [assessmentDraft, setAssessmentDraft] = useState<{
    relationship: JourneyResearchRelationship; classification: JourneyResearchClassification;
    confidence: string; freshnessDays: string; reason: string;
  }>({
    relationship: 'supports',
    classification: 'supported',
    confidence: '0.75', freshnessDays: '90', reason: ''
  });

  const loadCatalogue = useCallback(async (search = query, cursor?: string | null, append = false) => {
    const result = await listJourneyResearchCatalogue({ query: search.trim() || undefined, limit: 25, cursor: cursor || undefined });
    setCatalogue((current) => append ? [...current, ...result.items] : result.items);
    setNextCursor(result.nextCursor);
  }, [query]);

  const loadWorkspace = useCallback(async () => {
    if (!enabled) return;
    setLoading(true); setError('');
    try {
      const [catalogueResult, inboxResult, gapsResult, intakesResult, monitorsResult, runsResult,
        notificationsResult, auditResult, mapIndex, bases] = await Promise.all([
        listJourneyResearchCatalogue({ limit: 25 }), listJourneyResearchInbox(), listJourneyResearchGaps(),
        listJourneyResearchIntakes(), listJourneyResearchMonitors(), listJourneyResearchRefreshRuns(),
        listJourneyResearchNotifications(), listJourneyResearchAudit(), listJourneyMaps().catch(() => null),
        getKnowledgeBases().catch(() => [] as KnowledgeBase[])
      ]);
      setCatalogue(catalogueResult.items); setNextCursor(catalogueResult.nextCursor);
      setInbox(inboxResult.items); setGaps(gapsResult.gaps); setIntakes(intakesResult.intakes);
      setMonitors(monitorsResult.monitors); setRuns(runsResult.runs); setNotifications(notificationsResult.notifications);
      setAudit(auditResult.events); setMaps((mapIndex?.journeyMaps || []).map((map) => ({ id: map.id, name: map.name })));
      setKnowledgeBases(bases);
      setTargetMapId((current) => current || mapIndex?.journeyMaps[0]?.id || '');
      setIntakeDraft((current) => ({ ...current, knowledgeBaseId: current.knowledgeBaseId || bases[0]?.id || '' }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The Research Hub could not be loaded.');
    } finally { setLoading(false); }
  }, [enabled]);

  useEffect(() => { void loadWorkspace(); }, [loadWorkspace]);

  useEffect(() => {
    if (!targetMapId) { setTargetMap(null); setTargetId(''); return; }
    let current = true;
    void readJourneyMap(targetMapId).then((map) => {
      if (!current) return;
      setTargetMap(map); setTargetType('definition'); setTargetId(map.definition.id);
    }).catch((reason) => { if (current) setError(reason instanceof Error ? reason.message : 'The journey target could not be loaded.'); });
    return () => { current = false; };
  }, [targetMapId]);

  const targetOptions = useMemo(() => {
    if (!targetMap) return [];
    if (targetType === 'definition') return [{ id: targetMap.definition.id, label: targetMap.definition.name }];
    if (targetType === 'stage') return targetMap.stages.map((stage) => ({ id: stage.id, label: stage.name }));
    if (targetType === 'card') return targetMap.cards.map((card) => ({ id: card.id, label: card.title }));
    return targetMap.personas.map((persona) => ({ id: persona.id, label: persona.name }));
  }, [targetMap, targetType]);

  useEffect(() => { setTargetId(targetOptions[0]?.id || ''); }, [targetOptions]);

  useEffect(() => {
    if (!targetId) { setLinks([]); setLinkDetail(null); return; }
    let current = true;
    void listJourneyResearchLinks({ targetType, targetId }).then((result) => {
      if (!current) return;
      setLinks(result.links);
      setLinkDetail((selected) => selected && result.links.some((link) => link.id === selected.link.id) ? selected : null);
    }).catch((reason) => { if (current) setError(reason instanceof Error ? reason.message : 'Linked evidence could not be loaded.'); });
    return () => { current = false; };
  }, [targetId, targetType]);

  async function act(key: string, action: () => Promise<void>) {
    setWorking(key); setError('');
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'The Research Hub action failed.'); }
    finally { setWorking(''); }
  }

  async function selectSource(sourceId: string) {
    setSelectedSourceId(sourceId); setSourceDetail(null);
    if (!sourceId) return;
    await act(`view:${sourceId}`, async () => { setSourceDetail(await getJourneyResearchSource(sourceId)); });
  }

  async function catalogueSource(item: JourneyResearchCatalogueItem) {
    await act(`catalogue:${item.sourceId}`, async () => {
      const result = await catalogueJourneyResearchSource({ sourceType: item.sourceType, sourceRef: item.sourceRef });
      await loadCatalogue(query);
      await selectSource(result.source.id);
    });
  }

  async function linkSelectedSource() {
    if (!selectedSourceId || !targetId) return;
    await act('link', async () => {
      await createJourneyResearchLink({ sourceId: selectedSourceId, targetType, targetId });
      setLinks((await listJourneyResearchLinks({ targetType, targetId })).links);
      setInbox((await listJourneyResearchInbox()).items);
    });
  }

  async function inspectLink(linkId: string) {
    await act(`link-view:${linkId}`, async () => {
      const detail = await getJourneyResearchLink(linkId);
      setLinkDetail(detail);
      if (detail.assessment) setAssessmentDraft({
        relationship: detail.assessment.relationship === 'contradicts' ? 'contradicts' : detail.assessment.relationship === 'neutral' ? 'neutral' : 'supports',
        classification: detail.assessment.classification === 'strongly_supported' ? 'strongly_supported'
          : detail.assessment.classification === 'contradicted' ? 'contradicted'
            : detail.assessment.classification === 'stale' ? 'stale'
              : detail.assessment.classification === 'invalidated' ? 'invalidated'
                : detail.assessment.classification === 'anecdotal' ? 'anecdotal'
                  : detail.assessment.classification === 'hypothesis' ? 'hypothesis' : 'supported',
        confidence: String(detail.assessment.confidence),
        freshnessDays: detail.assessment.freshnessDays === null ? '' : String(detail.assessment.freshnessDays),
        reason: detail.assessment.reason
      });
    });
  }

  async function saveAssessment() {
    if (!linkDetail) return;
    await act(`assessment:${linkDetail.link.id}`, async () => {
      const confidence = Number(assessmentDraft.confidence);
      const freshnessDays = assessmentDraft.freshnessDays ? Number(assessmentDraft.freshnessDays) : null;
      const detail = await assessJourneyResearchLink(linkDetail.link.id, {
        expectedRevision: linkDetail.link.revision,
        relationship: assessmentDraft.relationship,
        classification: assessmentDraft.classification,
        confidence,
        freshnessDays,
        reason: assessmentDraft.reason.trim(),
        method: 'human_review'
      });
      setLinkDetail(detail);
      setLinks((await listJourneyResearchLinks({ targetType, targetId })).links);
    });
  }

  async function createGap() {
    if (!targetId || !gapDraft.title.trim()) return;
    await act('gap-create', async () => {
      await createJourneyResearchGap({ targetType, targetId, title: gapDraft.title.trim(),
        description: gapDraft.description.trim(), priority: gapDraft.priority });
      setGapDraft((current) => ({ ...current, title: '', description: '' }));
      setGaps((await listJourneyResearchGaps()).gaps); setInbox((await listJourneyResearchInbox()).items);
    });
  }

  async function submitIntake() {
    if (!intakeDraft.knowledgeBaseId || !intakeDraft.method.trim() || !intakeDraft.markdown.trim()) return;
    await act('intake-create', async () => {
      await createJourneyResearchIntake({
        knowledgeBaseId: intakeDraft.knowledgeBaseId, kind: intakeDraft.kind, method: intakeDraft.method.trim(),
        markdown: intakeDraft.markdown.trim(), population: intakeDraft.population.trim(),
        tags: intakeDraft.tags.split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 20),
        consentBasis: intakeDraft.consentBasis,
        retentionExpiresAt: new Date(`${intakeDraft.retentionExpiresAt}T23:59:59.000Z`).toISOString()
      });
      setIntakeDraft((current) => ({ ...current, method: '', markdown: '', population: '', tags: '' }));
      setIntakes((await listJourneyResearchIntakes()).intakes); await loadCatalogue(query);
    });
  }

  if (!enabled) return null;

  return <div className="mx-auto w-full max-w-[1440px] space-y-5 px-4 py-5 sm:px-6 sm:py-6" data-testid="journey-research-hub-page">
    <header className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-start sm:justify-between">
      <div><h1 className="page-title">Journey Research Hub</h1><p className="page-description">
        Find authorised evidence, retain reviewable snapshots, track research gaps, and monitor source changes.
      </p></div>
      <Button variant="outline" disabled={loading || Boolean(working)} onClick={() => void loadWorkspace()}>
        {loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}Refresh
      </Button>
    </header>
    {!canManage && <div className="border bg-muted/30 px-4 py-3 text-sm">You have viewer access. Space owners and administrators manage links, intakes, monitors, and assessments.</div>}
    <ErrorNotice message={error} />

    <Tabs defaultValue="sources">
      <div className="overflow-x-auto"><TabsList className="min-w-max" aria-label="Research Hub sections">
        <TabsTrigger value="sources"><Search className="mr-2 h-4 w-4" />Sources</TabsTrigger>
        <TabsTrigger value="inbox"><Bell className="mr-2 h-4 w-4" />Inbox ({inbox.length})</TabsTrigger>
        <TabsTrigger value="gaps"><CircleAlert className="mr-2 h-4 w-4" />Research gaps ({gaps.length})</TabsTrigger>
        <TabsTrigger value="intake"><BookOpenText className="mr-2 h-4 w-4" />Research intake</TabsTrigger>
        <TabsTrigger value="operations"><History className="mr-2 h-4 w-4" />Monitoring and audit</TabsTrigger>
      </TabsList></div>

      <TabsContent value="sources" className="space-y-4">
        <form className="flex gap-2 border bg-card p-3" onSubmit={(event) => {
          event.preventDefault(); void act('search', () => loadCatalogue(query));
        }}>
          <Label htmlFor="research-source-search" className="sr-only">Search authorised sources</Label>
          <Input id="research-source-search" value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder="Search authorised evidence" maxLength={120} />
          <Button type="submit" variant="outline" disabled={working === 'search'}><Search />Search</Button>
        </form>
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
          <section className="min-w-0 overflow-hidden border bg-card" aria-labelledby="research-catalogue-heading">
            <div className="border-b px-4 py-3"><h2 id="research-catalogue-heading" className="text-sm font-semibold">Authorised source catalogue</h2></div>
            <div className="overflow-x-auto"><table className="w-full min-w-[760px] border-collapse text-sm">
              <caption className="sr-only">Research sources currently visible to you in this space.</caption>
              <thead><tr className="border-b bg-muted/30 text-left text-xs">
                <th scope="col" className="px-4 py-2">Source</th><th scope="col" className="px-4 py-2">State</th>
                <th scope="col" className="px-4 py-2">Updated</th><th scope="col" className="px-4 py-2">Links</th>
                <th scope="col" className="px-4 py-2 text-right">Action</th>
              </tr></thead>
              <tbody className="divide-y">{catalogue.map((item) => <tr key={`${item.sourceType}:${item.sourceId}`}>
                <td className="px-4 py-3"><span className="font-medium">{item.label}</span><span className="mt-0.5 block text-xs text-muted-foreground">{readable(item.sourceType)}</span></td>
                <td className="px-4 py-3 text-xs">{item.researchSourceState ? readable(item.researchSourceState) : 'Not catalogued'}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{dateTime(item.updatedAt)}</td>
                <td className="px-4 py-3 text-xs">{item.existingEvidenceLinkCount}</td>
                <td className="px-4 py-3 text-right">{item.researchSourceId
                  ? <Button size="sm" variant={selectedSourceId === item.researchSourceId ? 'secondary' : 'outline'}
                      disabled={working === `view:${item.researchSourceId}`} onClick={() => void selectSource(item.researchSourceId!)}>Inspect</Button>
                  : canManage && <Button size="sm" variant="outline" disabled={working === `catalogue:${item.sourceId}`}
                      onClick={() => void catalogueSource(item)}>Catalogue</Button>}</td>
              </tr>)}
              {!catalogue.length && <EmptyRow columns={5}>No authorised sources match this search.</EmptyRow>}</tbody>
            </table></div>
            {nextCursor && <div className="border-t p-3 text-center"><Button variant="outline" size="sm"
              disabled={working === 'more'} onClick={() => void act('more', () => loadCatalogue(query, nextCursor, true))}>Load more</Button></div>}
          </section>
          <div className="space-y-4">
            <SourceViewer detail={sourceDetail} />
            {canManage && selectedSourceId && <section className="border bg-card p-4" aria-labelledby="research-link-heading">
              <h2 id="research-link-heading" className="text-sm font-semibold">Use this evidence</h2>
              <div className="mt-3 grid gap-3">
                <div><Label htmlFor="research-target-map">Journey</Label><select id="research-target-map" className="mt-1 h-10 w-full border bg-background px-3 text-sm"
                  value={targetMapId} onChange={(event) => setTargetMapId(event.target.value)}><option value="">Select a journey</option>
                  {maps.map((map) => <option key={map.id} value={map.id}>{map.name}</option>)}</select></div>
                <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="research-target-type">Target type</Label><select id="research-target-type"
                  className="mt-1 h-10 w-full border bg-background px-3 text-sm" value={targetType}
                  onChange={(event) => setTargetType(event.target.value as JourneyResearchTargetType)}>
                  <option value="definition">Journey</option><option value="stage">Stage</option><option value="card">Card</option><option value="persona">Persona</option>
                </select></div><div><Label htmlFor="research-target-id">Target</Label><select id="research-target-id"
                  className="mt-1 h-10 w-full border bg-background px-3 text-sm" value={targetId} onChange={(event) => setTargetId(event.target.value)}>
                  <option value="">Select a target</option>{targetOptions.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}
                </select></div></div>
                <div className="flex flex-wrap gap-2"><Button size="sm" disabled={!targetId || working === 'link'} onClick={() => void linkSelectedSource()}>Link evidence</Button>
                  <Button size="sm" variant="outline" disabled={working === 'monitor'} onClick={() => void act('monitor', async () => {
                    await createJourneyResearchMonitor(selectedSourceId, 86_400); setMonitors((await listJourneyResearchMonitors()).monitors);
                  })}>Monitor daily</Button>
                  <Button size="sm" variant="outline" disabled={working === 'refresh'} onClick={() => void act('refresh', async () => {
                    await queueJourneyResearchRefresh(selectedSourceId); setRuns((await listJourneyResearchRefreshRuns()).runs);
                  })}>Refresh now</Button></div>
              </div>
            </section>}
            {targetId && <section className="border bg-card" aria-labelledby="linked-research-heading">
              <div className="border-b px-4 py-3"><h2 id="linked-research-heading" className="text-sm font-semibold">Linked evidence for this target</h2></div>
              <ul className="divide-y">{links.map((link) => <li key={link.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0"><p className="text-sm font-medium">{link.access === 'inaccessible' ? 'Inaccessible evidence' : link.classification ? readable(link.classification) : 'Awaiting assessment'}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{link.relationship ? readable(link.relationship) : 'No relationship reviewed'}
                    {link.confidence === null ? '' : ` · ${Math.round(link.confidence * 100)}% confidence`}
                    {link.isStale ? ' · stale' : ''}{link.isContradictory ? ' · contradictory' : ''}</p></div>
                {link.access === 'available' && <Button size="sm" variant="ghost" disabled={working === `link-view:${link.id}`}
                  onClick={() => void inspectLink(link.id)}>Review</Button>}
              </li>)}{!links.length && <li className="px-4 py-6 text-center text-sm text-muted-foreground">No Research Hub evidence is linked to this target.</li>}</ul>
              {linkDetail && <div className="border-t p-4" data-testid="research-assessment-editor">
                <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-semibold">Evidence assessment</h3>
                  <p className="mt-1 text-xs text-muted-foreground">Snapshot version {linkDetail.snapshot.version} · reviewed changes never overwrite the source.</p></div>
                  {canManage && sourceDetail?.latestSnapshot && sourceDetail.latestSnapshot.id !== linkDetail.link.snapshotId && <Button size="sm" variant="outline"
                    disabled={working === `snapshot:${linkDetail.link.id}`} onClick={() => void act(`snapshot:${linkDetail.link.id}`, async () => {
                      await applyLatestJourneyResearchSnapshot(linkDetail.link.id, linkDetail.link.revision);
                      await inspectLink(linkDetail.link.id); setLinks((await listJourneyResearchLinks({ targetType, targetId })).links);
                    })}>Apply latest snapshot</Button>}
                </div>
                <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2"><div><dt className="text-muted-foreground">Pinned source</dt><dd className="mt-1">{linkDetail.snapshot.sourceLabel}</dd></div>
                  <div><dt className="text-muted-foreground">Evidence window</dt><dd className="mt-1">{dateTime(linkDetail.snapshot.windowStart)} — {dateTime(linkDetail.snapshot.windowEnd)}</dd></div></dl>
                {canManage ? <div className="mt-4 grid gap-3">
                  <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="assessment-relationship">Relationship</Label><select id="assessment-relationship"
                    className="mt-1 h-10 w-full border bg-background px-3 text-sm" value={assessmentDraft.relationship}
                    onChange={(event) => setAssessmentDraft((current) => ({ ...current, relationship: event.target.value as JourneyResearchRelationship }))}>
                    <option value="supports">Supports</option><option value="contradicts">Contradicts</option><option value="neutral">Neutral</option></select></div>
                    <div><Label htmlFor="assessment-classification">Classification</Label><select id="assessment-classification"
                      className="mt-1 h-10 w-full border bg-background px-3 text-sm" value={assessmentDraft.classification}
                      onChange={(event) => setAssessmentDraft((current) => ({ ...current, classification: event.target.value as JourneyResearchClassification }))}>
                      <option value="hypothesis">Hypothesis</option><option value="anecdotal">Anecdotal</option><option value="supported">Supported</option>
                      <option value="strongly_supported">Strongly supported</option><option value="contradicted">Contradicted</option><option value="stale">Stale</option><option value="invalidated">Invalidated</option>
                    </select></div></div>
                  <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="assessment-confidence">Confidence, 0 to 1</Label><Input id="assessment-confidence" type="number" min="0" max="1" step="0.01"
                    value={assessmentDraft.confidence} onChange={(event) => setAssessmentDraft((current) => ({ ...current, confidence: event.target.value }))} /></div>
                    <div><Label htmlFor="assessment-freshness">Freshness window, days</Label><Input id="assessment-freshness" type="number" min="1" max="3650"
                      value={assessmentDraft.freshnessDays} onChange={(event) => setAssessmentDraft((current) => ({ ...current, freshnessDays: event.target.value }))} /></div></div>
                  <div><Label htmlFor="assessment-reason">Review rationale</Label><Textarea id="assessment-reason" maxLength={4096}
                    value={assessmentDraft.reason} onChange={(event) => setAssessmentDraft((current) => ({ ...current, reason: event.target.value }))} /></div>
                  <Button size="sm" className="justify-self-start" disabled={working === `assessment:${linkDetail.link.id}`
                    || !Number.isFinite(Number(assessmentDraft.confidence)) || Number(assessmentDraft.confidence) < 0 || Number(assessmentDraft.confidence) > 1
                    || Boolean(assessmentDraft.freshnessDays) && Number(assessmentDraft.freshnessDays) < 1}
                    onClick={() => void saveAssessment()}>Save human assessment</Button>
                </div> : <p className="mt-4 text-xs text-muted-foreground">Only space owners and administrators can change the assessment.</p>}
              </div>}
            </section>}
          </div>
        </div>
      </TabsContent>

      <TabsContent value="inbox">
        <section className="border bg-card"><div className="border-b px-4 py-3"><h2 className="text-sm font-semibold">Evidence requiring attention</h2></div>
          <ul className="divide-y">{inbox.map((item) => <li key={`${item.itemKind}:${'id' in item ? item.id : 'sourceId' in item ? item.sourceId : item.linkId}`} className="flex items-start justify-between gap-4 px-4 py-3">
            <div><p className="text-sm font-medium">{item.itemKind === 'gap' ? item.label : readable(item.itemKind)}</p><p className="mt-1 text-xs text-muted-foreground">{inboxDescription(item)}</p></div>
            {item.itemKind === 'notification' && item.state === 'unread' && <Button size="sm" variant="ghost" onClick={() => void act(`notification:${item.id}`, async () => {
              await updateJourneyResearchNotification(item.id, { expectedRevision: item.revision, state: 'read' });
              setInbox((await listJourneyResearchInbox()).items); setNotifications((await listJourneyResearchNotifications()).notifications);
            })}>Mark read</Button>}
          </li>)}{!inbox.length && <li className="px-4 py-8 text-center text-sm text-muted-foreground">No research items currently require attention.</li>}</ul>
        </section>
      </TabsContent>

      <TabsContent value="gaps" className="space-y-4">
        {canManage && <section className="border bg-card p-4"><h2 className="text-sm font-semibold">Record a research gap</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2"><div><Label htmlFor="research-gap-title">Gap</Label><Input id="research-gap-title" maxLength={800}
            value={gapDraft.title} onChange={(event) => setGapDraft((current) => ({ ...current, title: event.target.value }))} /></div>
            <div><Label htmlFor="research-gap-priority">Priority</Label><select id="research-gap-priority" className="mt-1 h-10 w-full border bg-background px-3 text-sm"
              value={gapDraft.priority} onChange={(event) => setGapDraft((current) => ({ ...current, priority: event.target.value as JourneyResearchGap['priority'] }))}>
              <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
            </select></div></div>
          <div className="mt-3"><Label htmlFor="research-gap-description">Description</Label><Textarea id="research-gap-description" maxLength={8192}
            value={gapDraft.description} onChange={(event) => setGapDraft((current) => ({ ...current, description: event.target.value }))} /></div>
          <p className="mt-2 text-xs text-muted-foreground">The gap will be attached to the target selected in the Sources tab.</p>
          <Button className="mt-3" size="sm" disabled={!targetId || !gapDraft.title.trim() || working === 'gap-create'} onClick={() => void createGap()}>Create gap</Button>
        </section>}
        <section className="overflow-hidden border bg-card"><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm">
          <caption className="sr-only">Open and completed journey research gaps.</caption><thead><tr className="border-b bg-muted/30 text-left text-xs">
            <th className="px-4 py-2">Target</th><th className="px-4 py-2">Priority</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Due</th>
          </tr></thead><tbody className="divide-y">{gaps.map((gap) => <tr key={gap.id}><td className="px-4 py-3"><span className="font-medium">{gap.label}</span><code className="mt-1 block text-xs text-muted-foreground">{gap.targetType}:{gap.targetId}</code></td>
            <td className="px-4 py-3 text-xs">{readable(gap.priority)}</td><td className="px-4 py-3">{canManage ? <select aria-label={`Status for research gap ${gap.id}`}
              className="h-8 border bg-background px-2 text-xs" value={gap.status} onChange={(event) => void act(`gap:${gap.id}`, async () => {
                await updateJourneyResearchGap(gap.id, { expectedRevision: gap.revision, status: event.target.value as JourneyResearchGap['status'] });
                setGaps((await listJourneyResearchGaps()).gaps); setInbox((await listJourneyResearchInbox()).items);
              })}><option value="open">Open</option><option value="planned">Planned</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option></select> : readable(gap.status)}</td>
            <td className="px-4 py-3 text-xs text-muted-foreground">{dateTime(gap.dueAt)}</td></tr>)}
            {!gaps.length && <EmptyRow columns={4}>No research gaps have been recorded.</EmptyRow>}</tbody></table></div></section>
      </TabsContent>

      <TabsContent value="intake" className="space-y-4">
        {canManage && <section className="border bg-card p-4" aria-labelledby="research-intake-heading"><h2 id="research-intake-heading" className="text-sm font-semibold">Add a research note</h2>
          <p className="mt-1 text-xs text-muted-foreground">The note enters the existing knowledge document and indexing pipeline; the Research Hub stores only its structured linkage.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div><Label htmlFor="intake-knowledge-base">Knowledge base</Label><select id="intake-knowledge-base" className="mt-1 h-10 w-full border bg-background px-3 text-sm"
            value={intakeDraft.knowledgeBaseId} onChange={(event) => setIntakeDraft((current) => ({ ...current, knowledgeBaseId: event.target.value }))}>
            <option value="">Select a knowledge base</option>{knowledgeBases.map((base) => <option key={base.id} value={base.id}>{base.name}</option>)}</select></div>
            <div><Label htmlFor="intake-kind">Kind</Label><select id="intake-kind" className="mt-1 h-10 w-full border bg-background px-3 text-sm" value={intakeDraft.kind}
              onChange={(event) => setIntakeDraft((current) => ({ ...current, kind: event.target.value as JourneyResearchIntake['kind'] }))}>
              <option value="interview">Interview</option><option value="observation">Observation</option><option value="research_note">Research note</option></select></div>
            <div><Label htmlFor="intake-method">Method</Label><Input id="intake-method" maxLength={120} value={intakeDraft.method}
              onChange={(event) => setIntakeDraft((current) => ({ ...current, method: event.target.value }))} /></div>
            <div><Label htmlFor="intake-retention">Retain until</Label><Input id="intake-retention" type="date" value={intakeDraft.retentionExpiresAt}
              onChange={(event) => setIntakeDraft((current) => ({ ...current, retentionExpiresAt: event.target.value }))} /></div></div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2"><div><Label htmlFor="intake-population">Population</Label><Input id="intake-population" maxLength={800} value={intakeDraft.population}
            onChange={(event) => setIntakeDraft((current) => ({ ...current, population: event.target.value }))} /></div><div><Label htmlFor="intake-tags">Tags, comma separated</Label><Input id="intake-tags" value={intakeDraft.tags}
              onChange={(event) => setIntakeDraft((current) => ({ ...current, tags: event.target.value }))} /></div></div>
          <div className="mt-3"><Label htmlFor="intake-markdown">Research content</Label><Textarea id="intake-markdown" className="min-h-44" maxLength={1_000_000}
            value={intakeDraft.markdown} onChange={(event) => setIntakeDraft((current) => ({ ...current, markdown: event.target.value }))} /></div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox"
            checked={intakeDraft.consentBasis === 'documented'} onChange={(event) => setIntakeDraft((current) => ({ ...current, consentBasis: event.target.checked ? 'documented' : 'not_required' }))} />Documented consent basis</label>
            <Button size="sm" disabled={!intakeDraft.knowledgeBaseId || !intakeDraft.method.trim() || !intakeDraft.markdown.trim() || working === 'intake-create'}
              onClick={() => void submitIntake()}>Add to knowledge and research</Button></div>
        </section>}
        <section className="overflow-hidden border bg-card"><div className="border-b px-4 py-3"><h2 className="text-sm font-semibold">Research intake history</h2></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead><tr className="border-b bg-muted/30 text-left text-xs"><th className="px-4 py-2">Kind</th><th className="px-4 py-2">Method</th><th className="px-4 py-2">Population</th><th className="px-4 py-2">Knowledge document</th><th className="px-4 py-2">Retention</th></tr></thead>
            <tbody className="divide-y">{intakes.map((item) => <tr key={item.id}><td className="px-4 py-3">{readable(item.kind)}</td><td className="px-4 py-3">{item.method}</td><td className="px-4 py-3 text-xs">{item.population || 'Not specified'}</td><td className="px-4 py-3"><code className="text-xs">{item.knowledgeDocumentId}</code></td><td className="px-4 py-3 text-xs">{dateTime(item.retentionExpiresAt)}</td></tr>)}
              {!intakes.length && <EmptyRow columns={5}>No interview, observation, or research-note intake has been recorded.</EmptyRow>}</tbody></table></div></section>
      </TabsContent>

      <TabsContent value="operations" className="space-y-4">
        <section className="overflow-hidden border bg-card"><div className="border-b px-4 py-3"><h2 className="text-sm font-semibold">Source monitors</h2></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-sm"><thead><tr className="border-b bg-muted/30 text-left text-xs"><th className="px-4 py-2">Source</th><th className="px-4 py-2">State</th><th className="px-4 py-2">Interval</th><th className="px-4 py-2">Next run</th><th className="px-4 py-2">Action</th></tr></thead>
            <tbody className="divide-y">{monitors.map((monitor) => <tr key={monitor.id}><td className="px-4 py-3"><code className="text-xs">{monitor.sourceId}</code></td><td className="px-4 py-3">{readable(monitor.state)}</td><td className="px-4 py-3 text-xs">{Math.round(monitor.intervalSeconds / 3600)} hours</td><td className="px-4 py-3 text-xs">{dateTime(monitor.nextRunAt)}</td><td className="px-4 py-3">{canManage && <Button size="sm" variant="ghost" onClick={() => void act(`monitor:${monitor.id}`, async () => {
                await updateJourneyResearchMonitor(monitor.id, { expectedRevision: monitor.revision, state: monitor.state === 'active' ? 'paused' : 'active' });
                setMonitors((await listJourneyResearchMonitors()).monitors);
              })}>{monitor.state === 'active' ? 'Pause' : 'Resume'}</Button>}</td></tr>)}{!monitors.length && <EmptyRow columns={5}>No source monitors are configured.</EmptyRow>}</tbody></table></div></section>
        <section className="overflow-hidden border bg-card"><div className="border-b px-4 py-3"><h2 className="text-sm font-semibold">Refresh runs</h2></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead><tr className="border-b bg-muted/30 text-left text-xs"><th className="px-4 py-2">Source</th><th className="px-4 py-2">Trigger</th><th className="px-4 py-2">State</th><th className="px-4 py-2">Attempts</th><th className="px-4 py-2">Changes</th><th className="px-4 py-2">Updated</th></tr></thead>
            <tbody className="divide-y">{runs.map((run) => <tr key={run.id}><td className="px-4 py-3"><code className="text-xs">{run.sourceId}</code></td><td className="px-4 py-3">{readable(run.trigger)}</td><td className="px-4 py-3">{readable(run.state)}{run.errorCode && <span className="mt-1 block text-xs text-destructive">{run.errorCode}</span>}</td><td className="px-4 py-3 text-xs">{run.attemptCount} of {run.maxAttempts}</td><td className="px-4 py-3 text-xs">{run.changedFields.join(', ') || 'None'}</td><td className="px-4 py-3 text-xs">{dateTime(run.updatedAt)}</td></tr>)}
              {!runs.length && <EmptyRow columns={6}>No explicit or scheduled refresh has run.</EmptyRow>}</tbody></table></div></section>
        <section className="grid gap-4 lg:grid-cols-2"><div className="border bg-card"><div className="border-b px-4 py-3"><h2 className="text-sm font-semibold">Notifications</h2></div><ul className="divide-y">{notifications.map((item) => <li key={item.id} className="flex items-start justify-between gap-3 px-4 py-3"><div><p className="text-sm">{readable(item.kind)}</p><p className="mt-1 text-xs text-muted-foreground">{dateTime(item.createdAt)} · {readable(item.state)}</p></div>{item.state === 'unread' && <Button size="sm" variant="ghost" onClick={() => void act(`notification:${item.id}`, async () => {
            await updateJourneyResearchNotification(item.id, { expectedRevision: item.revision, state: 'dismissed' }); setNotifications((await listJourneyResearchNotifications()).notifications); setInbox((await listJourneyResearchInbox()).items);
          })}>Dismiss</Button>}</li>)}{!notifications.length && <li className="px-4 py-8 text-center text-sm text-muted-foreground">No research notifications.</li>}</ul></div>
          <div className="border bg-card"><div className="border-b px-4 py-3"><h2 className="text-sm font-semibold">Content-free audit</h2></div><ul className="divide-y">{audit.map((event) => <li key={event.id} className="px-4 py-3"><p className="text-sm">{readable(event.action)}</p><p className="mt-1 text-xs text-muted-foreground">{event.targetType}:{event.targetId} · {dateTime(event.createdAt)}</p></li>)}{!audit.length && <li className="px-4 py-8 text-center text-sm text-muted-foreground">No Research Hub audit events.</li>}</ul></div></section>
      </TabsContent>
    </Tabs>
    {loading && <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />Loading Research Hub data…</p>}
  </div>;
}
