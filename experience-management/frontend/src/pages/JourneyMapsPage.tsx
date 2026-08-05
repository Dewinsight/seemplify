import { lazy, startTransition, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronDown, ClipboardPaste, Copy, Download, Eye, EyeOff,
  Layers, ListChecks, Loader2, Pencil, Plus, Printer, Redo2, RefreshCw, Send, Table2, Trash2, Undo2, UsersRound, X
} from 'lucide-react';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api';
import { useAuthSession, useSessionFeature } from '@/lib/authSessionContext';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { Link, useNavigate } from '@/lib/router';
import { formatDateTime } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/EmptyState';
import { JourneyMapComparison } from '@/components/journeys/JourneyMapComparison';
import { JourneyRichCardReadView } from '@/components/journeys/JourneyRichCardReadView';
import { JourneyEmotionalCurve } from '@/components/journeys/JourneyEmotionalCurve';
import { JourneySavedViewBar } from '@/components/journeys/JourneySavedViewBar';
import {
  JourneyCardGrid, JourneyCardOutline, type JourneyCardSurfaceActions
} from '@/components/journeys/JourneyCardSurface';
import { JourneyStageRulesWorkspace } from '@/components/journeys/JourneyStageRulesWorkspace';
import { JourneyTemplateManager } from '@/components/journeys/JourneyTemplateManager';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  applyOptimisticJourneyOperation, createJourneyCardClipboard, journeyEditorOperationLabel,
  pasteJourneyCardOperations, reconcileAffectedCellMove, validateJourneyCardPaste,
  type JourneyBulkCardPatch, type JourneyCardClipboard, type JourneyEditorOperation
} from '@/lib/journeyMapEditorSession';
import {
  addCard, addLane, addStage, attachEvidence, bulkPatchCards, cardKindLabels, createJourneyMap, createPersona,
  detachEvidence, discoverableEvidenceSourceTypes, draftPersonaFromLegacyAudience, evidenceSourceLabels, evidenceStateLabels,
  journeyModeLabels, laneCardKinds, laneLabels, linkPersona, listEvidence, listJourneyMaps,
  JourneyCompactMoveResponseError, moveCard, moveCardAffectedCells, moveLane, moveStage, publishJourneyMap,
  readEvidenceSource, readJourneyMap, refreshEvidence, removeCard,
  removeLane, removeStage, requestJourneyMapExport, searchEvidenceSources, setLaneVisibility, unlinkPersona, updateCard,
  updateLane, updatePersona,
  type DiscoverableEvidenceSourceType, type JourneyEvidenceLink, type JourneyEvidenceSourceView,
  type JourneyEvidenceSnapshotField,
  type JourneyMapCard, type JourneyMapExportFormat, type JourneyMapIndex, type JourneyMapLane, type JourneyMapReadModel,
  type JourneyMapType, type JourneyPersona, type JourneyPersonaWriteInput
} from '@/lib/journeyMaps';
import {
  createJourneySuggestion, listJourneySuggestionEvidence, listJourneySuggestions,
  type JourneySuggestionEvidenceOption, type JourneySuggestionRun, type JourneySuggestionState
} from '@/lib/journeySuggestions';
import {
  readJourneyRichMap, type JourneyCardRichDetail, type JourneyRichMapSnapshot
} from '@/lib/journeyRichCards';
import type {
  JourneySavedView, JourneySavedViewConfiguration, JourneySavedViewResolved
} from '@/lib/journeySavedViews';

const JourneyRichCardWorkspace = lazy(async () => ({
  default: (await import('@/components/journeys/JourneyRichCardWorkspace')).JourneyRichCardWorkspace
}));

type Busy = '' | 'create' | 'stage' | 'lane' | 'card' | 'move' | 'publish' | 'persona' | 'evidence' | 'delete';
type SaveState = 'loaded' | 'saving' | 'saved' | 'conflict' | 'error';
type MutationResult = 'saved' | 'conflict' | 'failed';

interface EditorHistoryEntry {
  label: string;
  operation: JourneyEditorOperation;
}

interface ConflictRecovery {
  label: string;
  operation: JourneyEditorOperation;
  completed: number;
  total: number;
}

const mapTypeLabels: Record<JourneyMapType, string> = {
  current_state: 'Current state', future_state: 'Future state',
  ideal_state: 'Ideal state', service_blueprint: 'Service blueprint'
};

const journeyExportOptions: Array<{ format: JourneyMapExportFormat; label: string; detail: string }> = [
  { format: 'json', label: 'JSON', detail: 'Structured archive' },
  { format: 'csv', label: 'CSV', detail: 'Tabular cards' },
  { format: 'pdf', label: 'PDF', detail: 'Portable document' },
  { format: 'png', label: 'PNG', detail: 'Map image' },
  { format: 'pptx', label: 'PPTX', detail: 'PowerPoint presentation' }
];

const evidenceSnapshotFieldLabels: Record<JourneyEvidenceSnapshotField, string> = {
  sourceLabel: 'Source name', excerpt: 'Excerpt', population: 'Population', sampleSize: 'Sample size',
  collectedAt: 'Collection date', windowStart: 'Window start', windowEnd: 'Window end',
  sourceUpdatedAt: 'Source update time'
};

const journeySuggestionStateLabels: Record<JourneySuggestionState, string> = {
  queued: 'Queued', generating: 'Generating', review: 'In review', ready_to_apply: 'Ready to apply',
  applied: 'Applied', dismissed: 'Dismissed', superseded: 'Base changed', failed: 'Failed'
};

function errorMessage(reason: unknown, fallback: string) {
  if (reason instanceof ApiError) return reason.message;
  return reason instanceof Error ? reason.message : fallback;
}

function setJourneyGridMutationLock(locked: boolean) {
  const grid = document.querySelector<HTMLElement>('[data-testid="journey-grid"]');
  if (!grid) return;
  grid.dataset.requestLocked = locked ? 'true' : 'false';
  if (locked) {
    grid.setAttribute('aria-busy', 'true');
    grid.setAttribute('aria-disabled', 'true');
  } else {
    grid.removeAttribute('aria-busy');
    grid.removeAttribute('aria-disabled');
  }
}

async function waitForJourneyGridRevision(revision: number) {
  for (let frame = 0; frame < 12; frame += 1) {
    const rendered = document.querySelector<HTMLElement>('[data-testid="journey-grid"]')
      ?.dataset.renderedMapRevision;
    if (rendered === String(revision)) return true;
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  }
  return false;
}

function saveExportBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function EvidenceBadge({ card }: { card: JourneyMapCard }) {
  const descriptor = evidenceStateLabels[card.evidence.state];
  return <span
    data-testid={`card-evidence-${card.id}`}
    data-evidence-state={card.evidence.state}
    title={`${descriptor.description} (${card.evidence.reason.replaceAll('_', ' ')})`}
    className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium ${descriptor.tone}`}
  >
    {descriptor.label}
    {card.evidenceLinkCount > 0 && <span className="opacity-70">· {card.evidenceLinkCount}</span>}
  </span>;
}

function JourneyPresentation({ map, richMap, evidenceEnabled, personasEnabled, presentation, onExit }: {
  map: JourneyMapReadModel;
  richMap: JourneyRichMapSnapshot | null;
  evidenceEnabled: boolean;
  personasEnabled: boolean;
  presentation?: JourneySavedViewConfiguration['presentation'];
  onExit: () => void;
}) {
  const [view, setView] = useState<'stages' | 'outline'>('stages');
  const mode = journeyModeLabels[map.version.mode];
  const lanes = map.lanes.filter((lane) => lane.visible);
  const laneTitles = new Map(map.lanes.map((lane) => [
    lane.laneType, lane.title || laneLabels[lane.laneType] || lane.laneType
  ]));
  const laneTitleFor = (laneType: string) => laneTitles.get(laneType) || laneLabels[laneType] || laneType;
  const cardsByCell = useMemo(() => {
    const cells = new Map<string, JourneyMapCard[]>();
    for (const card of map.cards) {
      const key = `${card.stageKey}|${card.laneType}`;
      cells.set(key, [...(cells.get(key) || []), card]);
    }
    return cells;
  }, [map.cards]);
  const cardsFor = (stageKey: string, laneType: string) => cardsByCell.get(`${stageKey}|${laneType}`) || [];
  const richDetailFor = (cardId: string) => richMap?.cards.find((detail) => detail.cardId === cardId) || null;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.dataset.journeyPresentation = 'true';
    document.body.style.overflow = 'hidden';
    const exitOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onExit();
    };
    window.addEventListener('keydown', exitOnEscape);
    return () => {
      window.removeEventListener('keydown', exitOnEscape);
      delete document.body.dataset.journeyPresentation;
      document.body.style.overflow = previousOverflow;
    };
  }, [onExit]);

  return <div className="fixed inset-0 z-[80] overflow-y-auto bg-background" role="dialog" aria-modal="true"
    aria-labelledby="journey-presentation-title" data-testid="journey-presentation">
    <style>{`@media print {
      body[data-journey-presentation="true"] #root header,
      body[data-journey-presentation="true"] #root aside,
      body[data-journey-presentation="true"] #root nav { display: none !important; }
      body[data-journey-presentation="true"] [data-testid="journey-presentation"] {
        position: static !important; overflow: visible !important; background: white !important;
      }
      body[data-journey-presentation="true"] .journey-presentation-print-hidden { display: none !important; }
      body[data-journey-presentation="true"] [data-testid="presentation-stage-grid"] { display: block !important; }
      body[data-journey-presentation="true"] [data-testid="presentation-stage-cards"] { display: none !important; }
    }`}</style>
    <div className="mx-auto min-h-screen w-full max-w-[1600px] px-4 py-5 sm:px-7 lg:px-10">
      <div className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Journey presentation</p>
          <h1 id="journey-presentation-title" className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            {presentation?.title || map.definition.name}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <Badge data-testid="presentation-mode" variant={map.version.mode === 'designed' ? 'warning' : 'success'}>
              {mode.label}
            </Badge>
            <Badge variant="outline">{mapTypeLabels[map.version.mapType]}</Badge>
            <Badge variant="outline" data-testid="presentation-version">
              v{map.version.versionNumber} · {map.version.state}
            </Badge>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{mode.description}</p>
        </div>
        <div className="journey-presentation-print-hidden flex shrink-0 flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => window.print()} data-testid="print-presentation">
            <Printer className="mr-2 h-4 w-4" />Print
          </Button>
          <Button type="button" size="sm" onClick={onExit} autoFocus data-testid="exit-presentation">
            <X className="mr-2 h-4 w-4" />Exit presentation <span className="ml-2 text-[10px] opacity-70">Esc</span>
          </Button>
        </div>
      </div>

      <div className="journey-presentation-print-hidden mt-5 flex gap-1 border-b" role="tablist" aria-label="Presentation view">
        <button type="button" role="tab" aria-selected={view === 'stages'} data-testid="presentation-tab-stages"
          className={`border-b-2 px-3 py-2 text-sm font-medium ${view === 'stages'
            ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          onClick={() => setView('stages')}>Stage view</button>
        <button type="button" role="tab" aria-selected={view === 'outline'} data-testid="presentation-tab-outline"
          className={`border-b-2 px-3 py-2 text-sm font-medium ${view === 'outline'
            ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          onClick={() => setView('outline')}>Outline</button>
      </div>

      {richMap && <section className="mt-5" aria-labelledby="presentation-emotional-curve-title">
        <h2 id="presentation-emotional-curve-title" className="mb-2 text-sm font-semibold">Emotional curve</h2>
        <JourneyEmotionalCurve points={richMap.emotionalCurve} compact />
      </section>}

      {view === 'stages' && <div className="mt-5" role="tabpanel">
        {map.stages.length === 0 ? <div className="border px-5 py-12 text-center text-sm text-muted-foreground">
          This journey has no stages yet.
        </div> : <>
          <div className="hidden overflow-x-auto border lg:block" data-testid="presentation-stage-grid">
            <table className="w-full min-w-[880px] border-collapse text-sm">
              <caption className="sr-only">Read-only journey stage view. Stages are columns and lanes are rows.</caption>
              <thead><tr><th scope="col" className="w-44 border-b border-r bg-muted/40 p-3 text-left text-xs">Lane</th>
                {map.stages.map((stage) => <th scope="col" className="min-w-60 border-b border-r bg-muted/40 p-3 text-left align-top"
                  key={stage.id}><span className="font-semibold">{stage.name}</span>
                  {stage.goal && <span className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">{stage.goal}</span>}
                </th>)}</tr></thead>
              <tbody>{lanes.map((lane) => <tr key={lane.id}><th scope="row" className="border-b border-r bg-muted/20 p-3 text-left align-top text-xs">
                {laneTitleFor(lane.laneType)}</th>
                {map.stages.map((stage) => <td className="border-b border-r p-3 align-top" key={`${lane.id}-${stage.id}`}>
                  <ul className={presentation?.density === 'compact' ? 'space-y-1' : 'space-y-2'}>{cardsFor(stage.stageKey, lane.laneType).map((card) => <li className={`border bg-background ${presentation?.density === 'compact' ? 'p-2' : 'p-3'}`} key={card.id}>
                    <p className="text-sm font-medium">{card.title}</p>
                    <div className="mt-1 text-xs text-muted-foreground">
                      <JourneyRichCardReadView card={card} detail={richDetailFor(card.id)} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span>{cardKindLabels[card.kind] || card.kind}</span>
                      {personasEnabled && card.personaId && <span>· {map.personas.find((persona) => persona.id === card.personaId)?.name || 'Persona-specific'}</span>}
                      {evidenceEnabled && presentation?.showEvidenceLegend !== false && <EvidenceBadge card={card} />}
                    </div>
                  </li>)}</ul>
                </td>)}</tr>)}</tbody>
            </table>
          </div>

          <div className="space-y-4 lg:hidden" data-testid="presentation-stage-cards">
            {map.stages.map((stage) => <section className="border" key={stage.id} aria-labelledby={`presentation-${stage.id}`}>
              <div className="border-b bg-muted/30 px-4 py-3"><h2 id={`presentation-${stage.id}`} className="font-semibold">{stage.name}</h2>
                {stage.goal && <p className="mt-1 text-xs leading-5 text-muted-foreground">{stage.goal}</p>}</div>
              <div className="divide-y">{lanes.map((lane) => {
                const cards = cardsFor(stage.stageKey, lane.laneType);
                if (!cards.length) return null;
                return <div className="px-4 py-3" key={lane.id}><h3 className="text-xs font-semibold text-muted-foreground">
                  {laneTitleFor(lane.laneType)}</h3><ul className="mt-2 space-y-2">
                  {cards.map((card) => <li className="border-l-2 border-primary/30 pl-3" key={card.id}>
                    <p className="text-sm font-medium">{card.title}</p>
                    <div className="mt-1 text-xs text-muted-foreground">
                      <JourneyRichCardReadView card={card} detail={richDetailFor(card.id)} />
                    </div>
                    {evidenceEnabled && presentation?.showEvidenceLegend !== false && <div className="mt-2"><EvidenceBadge card={card} /></div>}
                  </li>)}</ul></div>;
              })}</div>
            </section>)}
          </div>
        </>}
      </div>}

      {view === 'outline' && <div className="mt-5 overflow-x-auto border" role="tabpanel" data-testid="presentation-outline">
        <table className="w-full min-w-[680px] border-collapse text-sm">
          <caption className="sr-only">Read-only linear outline of every journey card.</caption>
          <thead><tr className="bg-muted/40 text-left text-xs"><th scope="col" className="border-b p-3">Stage</th>
            <th scope="col" className="border-b p-3">Lane</th><th scope="col" className="border-b p-3">Kind</th>
            <th scope="col" className="border-b p-3">Card</th>
            {evidenceEnabled && presentation?.showEvidenceLegend !== false && <th scope="col" className="border-b p-3">Evidence</th>}</tr></thead>
          <tbody>{map.cards.map((card) => <tr key={card.id}><td className="border-b p-3">{
            map.stages.find((stage) => stage.stageKey === card.stageKey)?.name || card.stageKey}</td>
            <td className="border-b p-3">{laneTitleFor(card.laneType)}</td>
            <td className="border-b p-3">{cardKindLabels[card.kind] || card.kind}</td>
            <td className="border-b p-3"><span className="font-medium">{card.title}</span>
              <div className="mt-1 text-xs leading-5 text-muted-foreground">
                <JourneyRichCardReadView card={card} detail={richDetailFor(card.id)} />
              </div></td>
            {evidenceEnabled && presentation?.showEvidenceLegend !== false && <td className="border-b p-3"><EvidenceBadge card={card} /></td>}
          </tr>)}
          {!map.cards.length && <tr><td className="p-5 text-center text-muted-foreground" colSpan={evidenceEnabled && presentation?.showEvidenceLegend !== false ? 5 : 4}>
            This journey has no cards yet.
          </td></tr>}</tbody>
        </table>
      </div>}
    </div>
  </div>;
}

/** The evidence drawer shows exactly what the state was computed from. A badge
 * on its own would invite people to read it as a verdict rather than a rule. */
function EvidenceDrawer({ card, onClose, onChanged }: {
  card: JourneyMapCard; onClose: () => void; onChanged: () => void;
}) {
  const [links, setLinks] = useState<JourneyEvidenceLink[] | null>(null);
  const [sourceViews, setSourceViews] = useState<Record<string, JourneyEvidenceSourceView>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshingLinkId, setRefreshingLinkId] = useState('');
  const [searching, setSearching] = useState(false);
  const [sourceType, setSourceType] = useState<DiscoverableEvidenceSourceType>('knowledge_document');
  const [query, setQuery] = useState('');
  const [sources, setSources] = useState<JourneyEvidenceSourceView[] | null>(null);
  const [selectedSourceRef, setSelectedSourceRef] = useState('');

  const load = useCallback(async () => {
    try {
      const result = await listEvidence('card', card.id);
      const readableLinks = result.links.filter((link) => link.sourceAccess === 'available');
      const resolved = await Promise.all(readableLinks.map(async (link) => {
        try { return [link.id, (await readEvidenceSource(link.id)).source] as const; }
        catch { return null; }
      }));
      setSourceViews(Object.fromEntries(resolved.filter((item) => item !== null)));
      setLinks(result.links);
    } catch (reason) {
      setError(errorMessage(reason, 'Evidence could not be loaded.'));
    }
  }, [card.id]);
  useEffect(() => { void load(); }, [load]);

  const discover = useCallback(async (searchQuery: string) => {
    setSearching(true); setError('');
    try {
      const result = await searchEvidenceSources(sourceType, searchQuery, 20);
      setSources(result.sources);
      setSelectedSourceRef((current) => result.sources.some((source) => source.sourceRef === current) ? current : '');
    } catch (reason) {
      setSources([]);
      setError(errorMessage(reason, 'Evidence sources could not be searched.'));
    } finally { setSearching(false); }
  }, [sourceType]);

  useEffect(() => {
    setQuery('');
    setSelectedSourceRef('');
    void discover('');
  }, [discover]);

  async function attach() {
    if (!selectedSourceRef) { setError('Choose an evidence source first.'); return; }
    setBusy(true); setError('');
    try {
      await attachEvidence({
        targetType: 'card', targetId: card.id, sourceType, sourceRef: selectedSourceRef
      });
      setSelectedSourceRef('');
      await load();
      onChanged();
    } catch (reason) {
      setError(errorMessage(reason, 'The evidence link could not be attached.'));
    } finally { setBusy(false); }
  }

  async function detach(linkId: string) {
    setBusy(true); setError('');
    try { await detachEvidence(linkId); await load(); onChanged(); }
    catch (reason) { setError(errorMessage(reason, 'The evidence link could not be removed.')); }
    finally { setBusy(false); }
  }

  async function refresh(link: JourneyEvidenceLink) {
    setRefreshingLinkId(link.id); setError('');
    try {
      await refreshEvidence(link.id, link.snapshotFingerprint);
      await load();
      onChanged();
      toast.success('Evidence snapshot refreshed from the source.');
    } catch (reason) {
      setError(errorMessage(reason, 'The evidence snapshot could not be refreshed.'));
    } finally { setRefreshingLinkId(''); }
  }

  const descriptor = evidenceStateLabels[card.evidence.state];
  return <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
    <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" data-testid="evidence-drawer">
      <DialogHeader>
        <DialogTitle>Evidence for “{card.title}”</DialogTitle>
        <DialogDescription>{descriptor.description}</DialogDescription>
      </DialogHeader>
      <p className="text-xs text-muted-foreground">
        Computed state <strong>{descriptor.label}</strong> because <code>{card.evidence.reason}</code>.
        Supporting {card.evidence.supporting} · contradicting {card.evidence.contradicting} · stale {card.evidence.stale}.
      </p>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      {links === null
        ? <p className="text-sm text-muted-foreground">Loading evidence…</p>
        : links.length === 0
          ? <p className="text-sm text-muted-foreground">No evidence is linked yet, so this card is a hypothesis.</p>
          : <ul className="space-y-2" data-testid="evidence-links">
            {links.map((link) => {
              const source = sourceViews[link.id];
              if (link.sourceAccess === 'inaccessible') {
                return <li key={link.id} className="border border-amber-300 bg-amber-50 p-3 text-sm"
                  data-testid={`evidence-unavailable-${link.id}`}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium text-amber-950">Linked source unavailable</p>
                      <p className="mt-1 text-xs text-amber-900">
                        This source was removed or you no longer have access. Its saved content is hidden and does not
                        contribute to the journey evidence state.
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => detach(link.id)}>Remove</Button>
                  </div>
                </li>;
              }
              return <li key={link.id} className="border p-3 text-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium">{link.sourceLabel}</p>
                    <p className="mt-1 break-all text-xs text-muted-foreground">
                      {evidenceSourceLabels[link.sourceType] || link.sourceType} · {link.sourceRef}
                      {source?.state && ` · ${source.state}`}
                      {link.sampleSize !== null && ` · sample ${link.sampleSize}`}
                    </p>
                    {link.population && <p className="mt-1 text-xs text-muted-foreground">Population: {link.population}</p>}
                    {link.collectedAt && <p className="mt-1 text-xs text-muted-foreground">
                      Collected {formatDateTime(link.collectedAt)}
                    </p>}
                    <p className="mt-1 text-xs text-muted-foreground" data-testid={`evidence-validated-${link.id}`}>
                      Last validated {link.lastValidatedAt ? formatDateTime(link.lastValidatedAt) : 'not recorded'}
                    </p>
                    {link.excerpt && <p className="mt-2 border-l-2 pl-2 text-xs">{link.excerpt}</p>}
                    {link.refreshStatus === 'changed' && <div
                      className="mt-3 border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950"
                      data-testid={`evidence-changed-${link.id}`}>
                      <p className="font-medium">Source changed</p>
                      <p className="mt-1">
                        Updated fields: {link.changedFields.map((field) => evidenceSnapshotFieldLabels[field]).join(', ')}.
                        Refresh the saved snapshot before relying on the new source content.
                      </p>
                    </div>}
                    {link.invalidatedAt && <p className="mt-1 text-xs text-red-600">Invalidated: {link.invalidatedReason}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {link.refreshStatus === 'changed' && <Button variant="outline" size="sm"
                      data-testid={`refresh-evidence-${link.id}`}
                      disabled={busy || Boolean(refreshingLinkId)} onClick={() => refresh(link)}>
                      {refreshingLinkId === link.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Refresh snapshot
                    </Button>}
                    {source?.path && <Button variant="outline" size="sm" asChild>
                      <Link to={source.path}>Open source</Link>
                    </Button>}
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => detach(link.id)}>Remove</Button>
                  </div>
                </div>
              </li>;
            })}
          </ul>}
      <div className="grid gap-3 border-t pt-4">
        <p className="text-sm font-medium">Attach a source</p>
        <p className="text-xs text-muted-foreground">
          Labels, excerpts, dates, samples, and source links come from the current authorised record.
        </p>
        <Label htmlFor="evidence-source-type">Source type</Label>
        <select
          id="evidence-source-type" className="h-9 border px-2 text-sm" value={sourceType}
          onChange={(event) => setSourceType(event.target.value as DiscoverableEvidenceSourceType)}
        >
          {discoverableEvidenceSourceTypes.map((value) => <option key={value} value={value}>
            {evidenceSourceLabels[value] || value}
          </option>)}
        </select>
        <form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); void discover(query); }}>
          <div className="min-w-0 flex-1">
            <Label htmlFor="evidence-source-search">Search available sources</Label>
            <Input id="evidence-source-search" data-testid="evidence-source-search" value={query}
              placeholder="Search by title or record ID" onChange={(event) => setQuery(event.target.value)} />
          </div>
          <Button type="submit" variant="outline" data-testid="search-evidence-sources" disabled={searching}>
            {searching && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Search
          </Button>
        </form>
        {sources === null || searching
          ? <p className="text-sm text-muted-foreground">Searching available sources…</p>
          : sources.length === 0
            ? <p className="text-sm text-muted-foreground">No authorised sources match this search.</p>
            : <div className="max-h-72 space-y-2 overflow-y-auto" data-testid="evidence-source-results">
              {sources.map((source) => {
                const alreadyLinked = Boolean(links?.some((link) => link.sourceRef === source.sourceRef));
                return <div key={source.sourceRef} className="border p-3 text-sm">
                  <div className="flex items-start gap-3">
                    <input
                      type="radio" name="evidence-source" value={source.sourceRef}
                      aria-label={`Select ${source.label}`} data-testid="evidence-source-choice"
                      checked={selectedSourceRef === source.sourceRef}
                      disabled={alreadyLinked}
                      onChange={() => setSelectedSourceRef(source.sourceRef)}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{source.label}</p>
                      <p className="mt-1 break-all text-xs text-muted-foreground">
                        {source.sourceRef} · {source.state}
                        {source.sampleSize !== null && ` · sample ${source.sampleSize}`}
                        {alreadyLinked && ' · already linked'}
                      </p>
                      {source.population && <p className="mt-1 text-xs text-muted-foreground">Population: {source.population}</p>}
                      {source.excerpt && <p className="mt-2 line-clamp-3 border-l-2 pl-2 text-xs">{source.excerpt}</p>}
                      <Button className="mt-2" variant="outline" size="sm" asChild>
                        <Link to={source.path}>Open source</Link>
                      </Button>
                    </div>
                  </div>
                </div>;
              })}
            </div>}
      </div>
      <DialogFooter>
        <Button variant="outline" data-testid="close-evidence" onClick={onClose}>Close</Button>
        <Button data-testid="attach-evidence" disabled={busy || !selectedSourceRef} onClick={attach}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Attach evidence
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

function listText(values: string[]) {
  return values.join('\n');
}

function parseList(value: string) {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function attributesText(values: Record<string, string>) {
  return Object.entries(values).map(([key, value]) => `${key}: ${value}`).join('\n');
}

function parseAttributes(value: string) {
  const attributes: Record<string, string> = {};
  for (const line of value.split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const item = line.slice(separator + 1).trim();
    if (key && item) attributes[key] = item;
  }
  return attributes;
}

function PersonaEditor({ persona, busy, onClose, onSave }: {
  persona: JourneyPersona | null;
  busy: boolean;
  onClose: () => void;
  onSave: (input: JourneyPersonaWriteInput) => Promise<void>;
}) {
  const [error, setError] = useState('');
  const [draft, setDraft] = useState(() => ({
    name: persona?.name || '',
    summary: persona?.summary || '',
    lifecycleState: persona?.lifecycleState || 'draft',
    attributes: attributesText(persona?.attributes || {}),
    goals: listText(persona?.goals || []),
    behaviours: listText(persona?.behaviours || []),
    needs: listText(persona?.needs || []),
    barriers: listText(persona?.barriers || []),
    reviewAt: persona?.reviewAt?.slice(0, 10) || ''
  }));

  async function submit() {
    if (!draft.name.trim()) { setError('A persona requires a name.'); return; }
    setError('');
    try {
      await onSave({
        name: draft.name.trim(), summary: draft.summary.trim(),
        lifecycleState: draft.lifecycleState as JourneyPersona['lifecycleState'],
        attributes: parseAttributes(draft.attributes), goals: parseList(draft.goals),
        behaviours: parseList(draft.behaviours), needs: parseList(draft.needs),
        barriers: parseList(draft.barriers),
        reviewAt: draft.reviewAt ? `${draft.reviewAt}T00:00:00.000Z` : null
      });
    } catch (reason) {
      setError(errorMessage(reason, 'The persona could not be saved.'));
    }
  }

  return <Dialog open onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
    <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto" data-testid="persona-editor">
      <DialogHeader>
        <DialogTitle>{persona ? `Edit ${persona.name}` : 'Create a persona'}</DialogTitle>
        <DialogDescription>
          Keep archetypes separate from individual customers. Add research evidence before moving a persona to active.
        </DialogDescription>
      </DialogHeader>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="persona-name">Name</Label>
          <Input id="persona-name" data-testid="persona-name" autoFocus value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="persona-state">Lifecycle state</Label>
          <select id="persona-state" className="h-9 w-full border px-2 text-sm" value={draft.lifecycleState}
            onChange={(event) => setDraft({ ...draft, lifecycleState: event.target.value as JourneyPersona['lifecycleState'] })}>
            <option value="draft">Draft</option>
            <option value="in_review">In review</option>
            <option value="active">Active</option>
            <option value="retired">Retired</option>
          </select>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="persona-summary">Summary</Label>
        <Textarea id="persona-summary" rows={3} value={draft.summary}
          onChange={(event) => setDraft({ ...draft, summary: event.target.value })} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {([
          ['goals', 'Goals'], ['behaviours', 'Behaviours'], ['needs', 'Needs'], ['barriers', 'Barriers']
        ] as const).map(([field, label]) => <div key={field} className="space-y-2">
          <Label htmlFor={`persona-${field}`}>{label} <span className="font-normal text-muted-foreground">(one per line)</span></Label>
          <Textarea id={`persona-${field}`} rows={4} value={draft[field]}
            onChange={(event) => setDraft({ ...draft, [field]: event.target.value })} />
        </div>)}
      </div>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <div className="space-y-2">
          <Label htmlFor="persona-attributes">Attributes <span className="font-normal text-muted-foreground">(key: value)</span></Label>
          <Textarea id="persona-attributes" rows={4} value={draft.attributes}
            placeholder={'Role: Operations lead\nTeam size: 20–100'}
            onChange={(event) => setDraft({ ...draft, attributes: event.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="persona-review-at">Review date</Label>
          <Input id="persona-review-at" type="date" value={draft.reviewAt}
            onChange={(event) => setDraft({ ...draft, reviewAt: event.target.value })} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button data-testid="save-persona" disabled={busy || !draft.name.trim()} onClick={submit}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save persona
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

function CardInspector({
  card, richDetail, stageName, laneName, personaName, evidenceEnabled, editable, onClose, onEdit
}: {
  card: JourneyMapCard;
  richDetail: JourneyCardRichDetail | null;
  stageName: string;
  laneName: string;
  personaName: string;
  evidenceEnabled: boolean;
  editable: boolean;
  onClose: () => void;
  onEdit: () => void;
}) {
  return <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
    <DialogContent data-testid="card-inspector">
      <DialogHeader>
        <DialogTitle>{card.title}</DialogTitle>
        <DialogDescription>{stageName} / {laneName}</DialogDescription>
      </DialogHeader>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-xs text-muted-foreground">Kind</dt><dd>{cardKindLabels[card.kind] || card.kind}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Status</dt><dd className="capitalize">{card.status}</dd></div>
        {personaName && <div><dt className="text-xs text-muted-foreground">Persona layer</dt><dd>{personaName}</dd></div>}
        {evidenceEnabled && <div><dt className="text-xs text-muted-foreground">Evidence</dt><dd className="mt-1"><EvidenceBadge card={card} /></dd></div>}
      </dl>
      <div>
        <p className="text-xs text-muted-foreground">Details</p>
        <div className="mt-1"><JourneyRichCardReadView card={card} detail={richDetail} /></div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Close</Button>
        {editable && <Button data-testid="inspect-edit-card" onClick={onEdit}><Pencil className="mr-2 h-4 w-4" />Edit card</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

function CardEditor({ card, personas, personasEnabled, busy, onClose, onSave }: {
  card: JourneyMapCard;
  personas: JourneyPersona[];
  personasEnabled: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (input: {
    title: string; content: string; kind: string; personaId: string | null; status: JourneyMapCard['status'];
  }) => Promise<MutationResult>;
}) {
  const [draft, setDraft] = useState({
    title: card.title, content: card.content, kind: card.kind,
    personaId: card.personaId || '', status: card.status
  });
  const lastSavedSignature = useRef(JSON.stringify({
    title: card.title.trim(), content: card.content.trim(), kind: card.kind,
    personaId: card.personaId || null, status: card.status
  }));
  const timer = useRef<number | null>(null);
  const saveInFlight = useRef(false);
  const onSaveRef = useRef(onSave);
  const [localSaveState, setLocalSaveState] = useState<'ready' | 'saving' | 'saved' | 'conflict' | 'error'>('ready');
  onSaveRef.current = onSave;
  const payload = {
    title: draft.title.trim(), content: draft.content.trim(), kind: draft.kind,
    personaId: draft.personaId || null, status: draft.status
  };
  const signature = JSON.stringify(payload);

  const saveNow = useCallback(async (closeAfterSave: boolean) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    if (saveInFlight.current || busy || !payload.title) return;
    if (signature === lastSavedSignature.current) {
      if (closeAfterSave) onClose();
      return;
    }
    saveInFlight.current = true;
    setLocalSaveState('saving');
    const result = await onSaveRef.current(payload);
    saveInFlight.current = false;
    if (result === 'saved') {
      lastSavedSignature.current = signature;
      setLocalSaveState('saved');
      if (closeAfterSave) onClose();
    } else {
      setLocalSaveState(result === 'conflict' ? 'conflict' : 'error');
    }
  }, [busy, onClose, payload, signature]);

  useEffect(() => {
    if (
      localSaveState === 'conflict' ||
      localSaveState === 'error' ||
      signature === lastSavedSignature.current ||
      busy ||
      !payload.title
    ) return;
    setLocalSaveState('ready');
    timer.current = window.setTimeout(() => { void saveNow(false); }, 700);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    };
  }, [busy, localSaveState, payload.title, saveNow, signature]);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const requestClose = () => {
    if (localSaveState === 'conflict') onClose();
    else void saveNow(true);
  };

  return <Dialog open onOpenChange={(next) => { if (!next && !busy) requestClose(); }}>
    <DialogContent data-testid="edit-card-dialog">
      <DialogHeader>
        <DialogTitle>Edit card</DialogTitle>
        <DialogDescription>{personasEnabled
          ? 'Assigning a persona makes this card specific to that layer. Leave it shared when it applies to everyone.'
          : 'Update this card without changing any persona assignment retained on the map.'}</DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="edit-card-title">Title</Label>
        <Input id="edit-card-title" data-testid="edit-card-title" autoFocus value={draft.title}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="edit-card-content">Details</Label>
        <Textarea id="edit-card-content" rows={4} value={draft.content}
          onChange={(event) => setDraft({ ...draft, content: event.target.value })} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="edit-card-kind">Kind</Label>
          <select id="edit-card-kind" className="h-9 w-full border px-2 text-sm" value={draft.kind}
            onChange={(event) => setDraft({ ...draft, kind: event.target.value })}>
            {(laneCardKinds[card.laneType] || [card.kind]).map((kind) => <option key={kind} value={kind}>
              {cardKindLabels[kind] || kind}
            </option>)}
          </select>
        </div>
        {personasEnabled && <div className="space-y-2">
          <Label htmlFor="edit-card-persona">Persona layer</Label>
          <select id="edit-card-persona" data-testid="edit-card-persona" className="h-9 w-full border px-2 text-sm"
            value={draft.personaId} onChange={(event) => setDraft({ ...draft, personaId: event.target.value })}>
            <option value="">Shared across personas</option>
            {personas.map((persona) => <option key={persona.id} value={persona.id}>{persona.name}</option>)}
          </select>
        </div>}
        <div className="space-y-2">
          <Label htmlFor="edit-card-status">Status</Label>
          <select id="edit-card-status" className="h-9 w-full border px-2 text-sm" value={draft.status}
            onChange={(event) => setDraft({ ...draft, status: event.target.value as JourneyMapCard['status'] })}>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="retired">Retired</option>
          </select>
        </div>
      </div>
      <p className="text-xs text-muted-foreground" role="status" aria-live="polite" data-testid="card-autosave-state">
        {localSaveState === 'saving' && 'Saving changes...'}
        {localSaveState === 'saved' && 'Changes saved.'}
        {localSaveState === 'conflict' && 'A newer server version was loaded. Your draft is retained for review.'}
        {localSaveState === 'error' && 'Changes were not saved. Your draft is retained.'}
        {localSaveState === 'ready' && 'Changes autosave after you pause.'}
      </p>
      <DialogFooter>
        <Button variant="outline" disabled={busy || saveInFlight.current} onClick={requestClose}>Close</Button>
        <Button data-testid="save-card-edit" disabled={busy || localSaveState === 'conflict' || !draft.title.trim()}
          onClick={() => void saveNow(true)}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save card
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

interface EditorExecution {
  map: JourneyMapReadModel;
  inverse: JourneyEditorOperation;
}

interface EditorExecutionOptions {
  compactMoveLimits?: { cardsPerCell: number; titleChars: number; contentChars: number };
}

class PartialEditorExecutionError extends Error {
  readonly savedMap: JourneyMapReadModel;
  readonly inverse: JourneyEditorOperation | null;
  readonly remaining: JourneyEditorOperation;
  readonly completed: number;
  readonly total: number;
  readonly reason: unknown;

  constructor(input: {
    savedMap: JourneyMapReadModel;
    inverse: JourneyEditorOperation | null;
    remaining: JourneyEditorOperation;
    completed: number;
    total: number;
    reason: unknown;
  }) {
    super(errorMessage(input.reason, 'The remaining changes could not be saved.'));
    this.name = 'PartialEditorExecutionError';
    this.savedMap = input.savedMap;
    this.inverse = input.inverse;
    this.remaining = input.remaining;
    this.completed = input.completed;
    this.total = input.total;
    this.reason = input.reason;
  }
}

function flattenEditorOperations(operation: JourneyEditorOperation): JourneyEditorOperation[] {
  return operation.type === 'composite'
    ? operation.operations.flatMap(flattenEditorOperations)
    : [operation];
}

async function executeSingleEditorOperation(
  map: JourneyMapReadModel,
  operation: Exclude<JourneyEditorOperation, { type: 'composite' }>,
  options: EditorExecutionOptions = {}
): Promise<EditorExecution> {
  const definitionId = map.definition.id;
  const revision = map.definition.revision;
  switch (operation.type) {
    case 'add_card': {
      const beforeIds = new Set(map.cards.map((card) => card.id));
      const next = await addCard(definitionId, revision, operation.card);
      const added = next.cards.find((card) => !beforeIds.has(card.id));
      if (!added) throw new Error('The server did not return the newly created card. Refresh before continuing.');
      return { map: next, inverse: { type: 'remove_card', cardId: added.id, requireNoEvidence: true } };
    }
    case 'remove_card': {
      const current = map.cards.find((card) => card.id === operation.cardId);
      if (!current) throw new Error('The card no longer exists.');
      if (operation.requireNoEvidence && current.evidenceLinkCount > 0) {
        throw new Error('This card now has evidence. It cannot be removed by session undo.');
      }
      const next = await removeCard(definitionId, revision, operation.cardId);
      return {
        map: next,
        inverse: {
          type: 'add_card',
          card: {
            stageKey: current.stageKey, laneType: current.laneType, kind: current.kind,
            title: current.title, content: current.content, personaId: current.personaId, status: current.status
          }
        }
      };
    }
    case 'update_card': {
      const current = map.cards.find((card) => card.id === operation.cardId);
      if (!current) throw new Error('The card no longer exists.');
      const inverse: typeof operation.patch = {};
      if (operation.patch.kind !== undefined) inverse.kind = current.kind;
      if (operation.patch.title !== undefined) inverse.title = current.title;
      if (operation.patch.content !== undefined) inverse.content = current.content;
      if (operation.patch.personaId !== undefined) inverse.personaId = current.personaId;
      if (operation.patch.status !== undefined) inverse.status = current.status;
      return {
        map: await updateCard(definitionId, revision, operation.cardId, operation.patch),
        inverse: { type: 'update_card', cardId: operation.cardId, patch: inverse }
      };
    }
    case 'move_card': {
      const current = map.cards.find((card) => card.id === operation.cardId);
      if (!current) throw new Error('The card no longer exists.');
      let next: JourneyMapReadModel;
      if (options.compactMoveLimits !== undefined) {
        const target = {
          stageKey: operation.target.stageKey || current.stageKey,
          laneType: operation.target.laneType || current.laneType,
          ordinal: operation.target.ordinal
        };
        try {
          const compact = await moveCardAffectedCells(definitionId, revision, operation.cardId, operation.target, {
            versionId: map.version.id,
            source: { stageKey: current.stageKey, laneType: current.laneType },
            target,
            limits: options.compactMoveLimits
          });
          next = reconcileAffectedCellMove(map, compact);
        } catch (reason) {
          if (!(reason instanceof JourneyCompactMoveResponseError)) throw reason;
          const recovered = await readJourneyMap(definitionId);
          const moved = recovered.cards.find((card) => card.id === operation.cardId);
          if (recovered.definition.id !== definitionId || recovered.version.id !== map.version.id
            || recovered.definition.revision < revision + 1 || !moved
            || moved.stageKey !== target.stageKey || moved.laneType !== target.laneType
            || (target.ordinal !== undefined && moved.ordinal !== target.ordinal)) {
            throw new JourneyCompactMoveResponseError(
              'The compact response was invalid and the full-map recovery did not confirm the requested move.'
            );
          }
          next = recovered;
        }
      } else {
        next = await moveCard(definitionId, revision, operation.cardId, operation.target);
      }
      return {
        map: next,
        inverse: {
          type: 'move_card', cardId: operation.cardId,
          target: { stageKey: current.stageKey, laneType: current.laneType, ordinal: current.ordinal }
        }
      };
    }
    case 'bulk_patch_cards': {
      const selected = operation.cardIds.map((cardId) => map.cards.find((card) => card.id === cardId));
      if (selected.some((card) => !card)) throw new Error('One or more selected cards no longer exist.');
      const inverseGroups = new Map<string, { patch: JourneyBulkCardPatch; cardIds: string[] }>();
      for (const card of selected as JourneyMapCard[]) {
        const patch: JourneyBulkCardPatch = {};
        if (operation.patch.status !== undefined) patch.status = card.status;
        if (operation.patch.personaId !== undefined) patch.personaId = card.personaId;
        if (operation.patch.stageKey !== undefined) patch.stageKey = card.stageKey;
        if (operation.patch.laneType !== undefined) patch.laneType = card.laneType;
        const key = JSON.stringify(patch);
        const group = inverseGroups.get(key) || { patch, cardIds: [] };
        group.cardIds.push(card.id);
        inverseGroups.set(key, group);
      }
      const inverseOperations: JourneyEditorOperation[] = [...inverseGroups.values()].map((group) => ({
        type: 'bulk_patch_cards', label: operation.label, cardIds: group.cardIds, patch: group.patch
      }));
      return {
        map: await bulkPatchCards(definitionId, revision, {
          cardIds: operation.cardIds,
          patch: operation.patch
        }),
        inverse: inverseOperations.length === 1 ? inverseOperations[0] : {
          type: 'composite', label: `Undo ${operation.label}`, operations: inverseOperations
        }
      };
    }
    case 'add_stage': {
      const beforeKeys = new Set(map.stages.map((stage) => stage.stageKey));
      const next = await addStage(definitionId, revision, operation.stage);
      const added = next.stages.find((stage) => !beforeKeys.has(stage.stageKey));
      if (!added) throw new Error('The server did not return the newly created stage. Refresh before continuing.');
      return { map: next, inverse: { type: 'remove_stage', stageKey: added.stageKey, requireEmpty: true } };
    }
    case 'remove_stage': {
      const current = map.stages.find((stage) => stage.stageKey === operation.stageKey);
      if (!current) throw new Error('The stage no longer exists.');
      if (operation.requireEmpty && map.cards.some((card) => card.stageKey === operation.stageKey)) {
        throw new Error('This stage now contains cards. It cannot be removed by session undo.');
      }
      return {
        map: await removeStage(definitionId, revision, operation.stageKey),
        inverse: { type: 'add_stage', stage: { name: current.name, goal: current.goal } }
      };
    }
    case 'move_stage': {
      const from = [...map.stages].sort((left, right) => left.ordinal - right.ordinal)
        .findIndex((stage) => stage.stageKey === operation.stageKey);
      if (from < 0) throw new Error('The stage no longer exists.');
      return {
        map: await moveStage(definitionId, revision, operation.stageKey, operation.toOrdinal),
        inverse: { type: 'move_stage', stageKey: operation.stageKey, toOrdinal: from }
      };
    }
    case 'add_lane': {
      const beforeKeys = new Set(map.lanes.map((lane) => lane.laneType));
      const next = await addLane(definitionId, revision, operation.lane);
      const added = next.lanes.find((lane) => !beforeKeys.has(lane.laneType));
      if (!added) throw new Error('The server did not return the newly created lane. Refresh before continuing.');
      return { map: next, inverse: { type: 'remove_lane', laneKey: added.laneType, requireEmpty: true } };
    }
    case 'remove_lane': {
      const current = map.lanes.find((lane) => lane.laneType === operation.laneKey);
      if (!current) throw new Error('The lane no longer exists.');
      if (operation.requireEmpty && map.cards.some((card) => card.laneType === operation.laneKey)) {
        throw new Error('This lane now contains cards. It cannot be removed by session undo.');
      }
      return {
        map: await removeLane(definitionId, revision, operation.laneKey),
        inverse: {
          type: 'add_lane',
          lane: { laneKey: current.laneType, title: current.title, description: current.description }
        }
      };
    }
    case 'update_lane': {
      const current = map.lanes.find((lane) => lane.laneType === operation.laneKey);
      if (!current) throw new Error('The lane no longer exists.');
      const inverse: { title?: string; description?: string } = {};
      if (operation.patch.title !== undefined) inverse.title = current.title;
      if (operation.patch.description !== undefined) inverse.description = current.description;
      return {
        map: await updateLane(definitionId, revision, operation.laneKey, operation.patch),
        inverse: { type: 'update_lane', laneKey: operation.laneKey, patch: inverse }
      };
    }
    case 'move_lane': {
      const from = [...map.lanes].sort((left, right) => left.ordinal - right.ordinal)
        .findIndex((lane) => lane.laneType === operation.laneKey);
      if (from < 0) throw new Error('The lane no longer exists.');
      return {
        map: await moveLane(definitionId, revision, operation.laneKey, operation.toOrdinal),
        inverse: { type: 'move_lane', laneKey: operation.laneKey, toOrdinal: from }
      };
    }
    case 'set_lane_visibility': {
      const current = map.lanes.find((lane) => lane.laneType === operation.laneKey);
      if (!current) throw new Error('The lane no longer exists.');
      return {
        map: await setLaneVisibility(definitionId, revision, operation.laneKey, operation.visible),
        inverse: { type: 'set_lane_visibility', laneKey: operation.laneKey, visible: current.visible }
      };
    }
  }
}

async function executeEditorOperation(
  map: JourneyMapReadModel,
  operation: JourneyEditorOperation,
  options: EditorExecutionOptions = {}
): Promise<EditorExecution> {
  const operations = flattenEditorOperations(operation);
  let current = map;
  const inverses: JourneyEditorOperation[] = [];
  for (const [position, item] of operations.entries()) {
    try {
      const result = await executeSingleEditorOperation(
        current, item as Exclude<JourneyEditorOperation, { type: 'composite' }>, options
      );
      current = result.map;
      inverses.unshift(result.inverse);
    } catch (reason) {
      if (position === 0) throw reason;
      const remaining = operations.slice(position);
      throw new PartialEditorExecutionError({
        savedMap: current,
        inverse: inverses.length ? { type: 'composite', label: `Undo ${journeyEditorOperationLabel(operation)}`, operations: inverses } : null,
        remaining: remaining.length === 1 ? remaining[0] : {
          type: 'composite', label: `Finish ${journeyEditorOperationLabel(operation)}`, operations: remaining
        },
        completed: position,
        total: operations.length,
        reason
      });
    }
  }
  return {
    map: current,
    inverse: inverses.length === 1 ? inverses[0] : {
      type: 'composite', label: `Undo ${journeyEditorOperationLabel(operation)}`, operations: inverses
    }
  };
}

export function JourneyMapsPage() {
  const session = useAuthSession();
  const navigate = useNavigate();
  const designEnabled = useSessionFeature('journeyDesign');
  const aiEnabled = useSessionFeature('journeyAi');
  const personasEnabled = useSessionFeature('journeyPersonas');
  const evidenceEnabled = useSessionFeature('journeyEvidence');
  const exportsEnabled = useSessionFeature('journeyExports');
  const metricsEnabled = useSessionFeature('journeyMetrics');
  const connectedEnabled = useSessionFeature('journeyConnected');
  const richCardsEnabled = useSessionFeature('journeyRichCards');
  const savedViewsEnabled = useSessionFeature('journeySavedViews');
  const [index, setIndex] = useState<JourneyMapIndex | null>(null);
  const [map, setMap] = useState<JourneyMapReadModel | null>(null);
  const [richMap, setRichMap] = useState<JourneyRichMapSnapshot | null>(null);
  const [richMapLoading, setRichMapLoading] = useState(false);
  const [richMapError, setRichMapError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<Busy>('');
  const [newMapName, setNewMapName] = useState('');
  const [newMapType, setNewMapType] = useState<JourneyMapType>('current_state');
  const [newStageName, setNewStageName] = useState('');
  const [newLaneTitle, setNewLaneTitle] = useState('');
  const [newLaneDescription, setNewLaneDescription] = useState('');
  const [editingLane, setEditingLane] = useState<JourneyMapLane | null>(null);
  const [laneEditTitle, setLaneEditTitle] = useState('');
  const [laneEditDescription, setLaneEditDescription] = useState('');
  const [cardDraft, setCardDraft] = useState<{ stageKey: string; laneType: string } | null>(null);
  const [cardTitle, setCardTitle] = useState('');
  const [cardContent, setCardContent] = useState('');
  const [cardPersonaId, setCardPersonaId] = useState('');
  const [cardKind, setCardKind] = useState('');
  const [evidenceCard, setEvidenceCard] = useState<JourneyMapCard | null>(null);
  const [editingCard, setEditingCard] = useState<JourneyMapCard | null>(null);
  const [personaEditor, setPersonaEditor] = useState<JourneyPersona | 'new' | null>(null);
  const [comparePersonas, setComparePersonas] = useState<[string, string]>(['', '']);
  const [activeTab, setActiveTab] = useState('map');
  const [exporting, setExporting] = useState<JourneyMapExportFormat | null>(null);
  const [presenting, setPresenting] = useState(false);
  const [activeSavedView, setActiveSavedView] = useState<JourneySavedViewResolved | null>(null);
  const [authoritativeMap, setAuthoritativeMap] = useState<JourneyMapReadModel | null>(null);
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(() => new Set());
  const [activeCell, setActiveCell] = useState<{ stageKey: string; laneType: string } | null>(null);
  const [clipboard, setClipboard] = useState<JourneyCardClipboard | null>(null);
  const [bulkStatus, setBulkStatus] = useState<JourneyMapCard['status']>('active');
  const [bulkPersonaId, setBulkPersonaId] = useState('');
  const [bulkStageKey, setBulkStageKey] = useState('');
  const [pasteStageKey, setPasteStageKey] = useState('');
  const [pasteLaneType, setPasteLaneType] = useState('');
  const [undoStack, setUndoStack] = useState<EditorHistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<EditorHistoryEntry[]>([]);
  const [conflictRecovery, setConflictRecovery] = useState<ConflictRecovery | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('loaded');
  const [lastSavedAt, setLastSavedAt] = useState('');
  const [inspectingCard, setInspectingCard] = useState<JourneyMapCard | null>(null);
  const [suggestionOpen, setSuggestionOpen] = useState(false);
  const [suggestionBusy, setSuggestionBusy] = useState<'' | 'load' | 'create'>('');
  const [suggestionError, setSuggestionError] = useState('');
  const [suggestionFocus, setSuggestionFocus] = useState('');
  const [suggestionEvidence, setSuggestionEvidence] = useState<JourneySuggestionEvidenceOption[]>([]);
  const [selectedSuggestionEvidence, setSelectedSuggestionEvidence] = useState<Set<string>>(() => new Set());
  const [suggestionRuns, setSuggestionRuns] = useState<JourneySuggestionRun[]>([]);
  const selectedRef = useRef('');
  const mapRef = useRef<JourneyMapReadModel | null>(null);
  const mutationInFlightRef = useRef(false);
  const exportMenuRef = useRef<HTMLDetailsElement | null>(null);
  const presentationTriggerRef = useRef<HTMLButtonElement | null>(null);
  selectedRef.current = selectedId;
  const commitMap = useCallback((next: JourneyMapReadModel | null) => {
    mapRef.current = next;
    setMap(next);
    setAuthoritativeMap(next);
  }, []);

  /** A saved view renders a filtered projection. The authoritative unfiltered
   * map is kept so the saved-view editor still offers every persona, lane and
   * card kind rather than only those that survived the applied filter. */
  const commitSavedViewMap = useCallback((next: JourneyMapReadModel) => {
    mapRef.current = next;
    setMap(next);
  }, []);

  const applySavedView = useCallback((resolved: JourneySavedViewResolved) => {
    setActiveSavedView(resolved);
    commitSavedViewMap(resolved.map);
    if (resolved.comparisonMap) setActiveTab('structure-compare');
  }, [commitSavedViewMap]);

  const presentSavedView = useCallback((resolved: JourneySavedViewResolved) => {
    setActiveSavedView(resolved);
    commitSavedViewMap(resolved.map);
    setPresenting(true);
  }, [commitSavedViewMap]);

  const loadIndex = useCallback(async () => {
    try {
      const result = await listJourneyMaps();
      setIndex(result);
      setError('');
      if (!selectedRef.current && result.journeyMaps[0]) setSelectedId(result.journeyMaps[0].id);
    } catch (reason) {
      setError(errorMessage(reason, 'Journey maps could not be loaded.'));
    } finally { setLoading(false); }
  }, []);

  const loadMap = useCallback(async (definitionId: string) => {
    if (!definitionId) { commitMap(null); return null; }
    try {
      const loaded = await readJourneyMap(definitionId);
      commitMap(loaded);
      setSaveState('loaded');
      setLastSavedAt(loaded.definition.updatedAt);
      return loaded;
    }
    catch (reason) { setError(errorMessage(reason, 'This journey map could not be loaded.')); return null; }
  }, [commitMap]);

  const loadRichMap = useCallback(async (definitionId: string, versionId?: string) => {
    if (!richCardsEnabled || !definitionId) { setRichMap(null); setRichMapError(''); return null; }
    setRichMapLoading(true);
    try {
      const loaded = await readJourneyRichMap(definitionId, versionId);
      setRichMap(loaded); setRichMapError(''); return loaded;
    } catch (reason) {
      setRichMap(null); setRichMapError(errorMessage(reason, 'Rich journey cards could not be loaded.')); return null;
    } finally { setRichMapLoading(false); }
  }, [richCardsEnabled]);

  useEffect(() => { void loadIndex(); }, [loadIndex]);
  useEffect(() => { void loadMap(selectedId); }, [loadMap, selectedId]);
  useEffect(() => {
    if (!map || !richCardsEnabled) { setRichMap(null); setRichMapError(''); return; }
    void loadRichMap(map.definition.id, map.version.id);
  }, [loadRichMap, map?.definition.id, map?.definition.revision, map?.version.id, richCardsEnabled]);
  useEffect(() => {
    setRichMap(null);
    setRichMapError('');
    setSelectedCardIds(new Set());
    setClipboard(null);
    setUndoStack([]);
    setRedoStack([]);
    setConflictRecovery(null);
    setActiveCell(null);
    setInspectingCard(null);
    setSuggestionOpen(false);
    setSuggestionError('');
    setSuggestionFocus('');
    setSuggestionEvidence([]);
    setSelectedSuggestionEvidence(new Set());
    setSuggestionRuns([]);
    setActiveSavedView(null);
  }, [selectedId]);
  useEffect(() => {
    if (richCardsEnabled) return;
    setActiveTab((current) => current === 'rich-cards' ? 'map' : current);
  }, [richCardsEnabled]);
  useEffect(() => {
    if (!map) return;
    const firstStage = map.stages[0]?.stageKey || '';
    const firstLane = map.lanes.find((lane) => lane.visible)?.laneType || map.lanes[0]?.laneType || '';
    setActiveCell((current) => current
      && map.stages.some((stage) => stage.stageKey === current.stageKey)
      && map.lanes.some((lane) => lane.laneType === current.laneType && lane.visible)
      ? current
      : (firstStage && firstLane ? { stageKey: firstStage, laneType: firstLane } : null));
    setPasteStageKey((current) => map.stages.some((stage) => stage.stageKey === current) ? current : firstStage);
    setPasteLaneType((current) => map.lanes.some((lane) => lane.laneType === current) ? current : firstLane);
    setBulkStageKey((current) => map.stages.some((stage) => stage.stageKey === current) ? current : firstStage);
    const availableIds = new Set(map.cards.map((card) => card.id));
    setSelectedCardIds((current) => {
      const next = new Set([...current].filter((id) => availableIds.has(id)));
      return next.size === current.size ? current : next;
    });
    if (inspectingCard && !availableIds.has(inspectingCard.id)) setInspectingCard(null);
  }, [inspectingCard, map]);
  useEffect(() => {
    if (!map || !personasEnabled) return;
    setComparePersonas((current) => {
      const linked = new Set(map.personas.map((persona) => persona.id));
      const first = linked.has(current[0]) ? current[0] : (map.personas[0]?.id || '');
      const second = linked.has(current[1]) && current[1] !== first
        ? current[1]
        : (map.personas.find((persona) => persona.id !== first)?.id || '');
      return current[0] === first && current[1] === second ? current : [first, second];
    });
  }, [map, personasEnabled]);
  useEffect(() => {
    if (personasEnabled) return;
    setPersonaEditor(null);
    setCardPersonaId('');
    setComparePersonas(['', '']);
    setActiveTab((current) => ['personas', 'persona-compare'].includes(current) ? 'map' : current);
  }, [personasEnabled]);
  useEffect(() => {
    if (!evidenceEnabled) {
      setEvidenceCard(null);
      setActiveTab((current) => current === 'gaps' ? 'map' : current);
    }
  }, [evidenceEnabled]);
  useEffect(() => {
    if (exportsEnabled) return;
    exportMenuRef.current?.removeAttribute('open');
    setExporting(null);
  }, [exportsEnabled]);
  useLiveRefresh(useCallback(() => { void loadIndex(); }, [loadIndex]));

  /** Every mutation returns the whole map, so a conflict is recoverable by
   * reloading rather than by asking the author to reconstruct their edit. */
  const apply = useCallback(async (action: Busy, run: () => Promise<JourneyMapReadModel>) => {
    setBusy(action); setError('');
    try {
      const next = await run();
      commitMap(next);
      void loadIndex();
      return next;
    } catch (reason) {
      const message = errorMessage(reason, 'The change could not be saved.');
      setError(message);
      if (reason instanceof ApiError && reason.code === 'JOURNEY_MAP_REVISION_CONFLICT') {
        toast.error('This map changed elsewhere. It has been refreshed.');
        setUndoStack([]);
        setRedoStack([]);
        await loadMap(selectedRef.current);
        setSaveState('conflict');
      } else {
        toast.error(message);
      }
      return null;
    } finally { setBusy(''); }
  }, [commitMap, loadIndex, loadMap]);

  const applyEditorChange = useCallback(async (
    operation: JourneyEditorOperation,
    action: Busy,
    recordHistory = true,
    deferVisualCommit = false,
    compactMoveLimits?: { cardsPerCell: number; titleChars: number; contentChars: number }
  ): Promise<{ status: MutationResult; inverse?: JourneyEditorOperation; map?: JourneyMapReadModel }> => {
    const current = mapRef.current;
    if (!current || current.version.state !== 'draft') return { status: 'failed' };
    if (mutationInFlightRef.current) return { status: 'failed' };
    mutationInFlightRef.current = true;
    let keepGridLocked = false;
    if (deferVisualCommit) setJourneyGridMutationLock(true);
    else {
      setBusy(action);
      setError('');
      setSaveState('saving');
    }
    const optimistic = applyOptimisticJourneyOperation(current, operation);
    if (!deferVisualCommit && optimistic !== current) commitMap(optimistic);
    try {
      const result = await executeEditorOperation(current, operation, { compactMoveLimits });
      if (deferVisualCommit) {
        mapRef.current = result.map;
        window.setTimeout(() => {
          startTransition(() => {
            setMap(result.map);
            setError('');
            setSaveState('saved');
            setLastSavedAt(result.map.definition.updatedAt);
            setConflictRecovery(null);
            if (recordHistory) {
              setUndoStack((history) => [...history.slice(-49), {
                label: journeyEditorOperationLabel(operation), operation: result.inverse
              }]);
              setRedoStack([]);
            }
          });
        }, 0);
      } else {
        commitMap(result.map);
        setSaveState('saved');
        setLastSavedAt(result.map.definition.updatedAt);
        setConflictRecovery(null);
        if (recordHistory) {
          setUndoStack((history) => [...history.slice(-49), {
            label: journeyEditorOperationLabel(operation), operation: result.inverse
          }]);
          setRedoStack([]);
        }
      }
      if (deferVisualCommit) window.setTimeout(() => { void loadIndex(); }, 0);
      else void loadIndex();
      return { status: 'saved', inverse: result.inverse, map: result.map };
    } catch (reason) {
      const partial = reason instanceof PartialEditorExecutionError ? reason : null;
      const underlying = partial?.reason ?? reason;
      const conflict = underlying instanceof ApiError && underlying.code === 'JOURNEY_MAP_REVISION_CONFLICT';
      if (partial) {
        commitMap(partial.savedMap);
        setLastSavedAt(partial.savedMap.definition.updatedAt);
        if (!conflict && recordHistory && partial.inverse) {
          setUndoStack((history) => [...history.slice(-49), {
            label: `Partial ${journeyEditorOperationLabel(operation)}`, operation: partial.inverse!
          }]);
          setRedoStack([]);
        }
      } else {
        commitMap(current);
      }
      if (conflict) {
        keepGridLocked = true;
        try {
          const remote = await readJourneyMap(current.definition.id);
          commitMap(remote);
          setLastSavedAt(remote.definition.updatedAt);
        } catch (refreshReason) {
          const refreshMessage = errorMessage(refreshReason, 'The newer server version could not be loaded.');
          setError(refreshMessage);
          toast.error(refreshMessage);
          setSaveState('error');
          keepGridLocked = false;
          return { status: 'failed' };
        }
        const retained = partial?.remaining ?? operation;
        const completed = partial?.completed ?? 0;
        const total = partial?.total ?? flattenEditorOperations(operation).length;
        setConflictRecovery({
          label: journeyEditorOperationLabel(operation), operation: retained, completed, total
        });
        setUndoStack([]);
        setRedoStack([]);
        setSaveState('conflict');
        const message = completed
          ? `${completed} of ${total} changes saved before a newer server version was found. Review it, then reapply the remaining changes.`
          : 'A newer server version was loaded. Your change is retained so you can review and reapply it.';
        setError('');
        toast.error(message);
        return { status: 'conflict' };
      }
      const message = partial
        ? `${partial.completed} of ${partial.total} changes were saved. ${errorMessage(underlying, 'The remaining changes failed.')}`
        : errorMessage(reason, 'The change could not be saved.');
      setError(message);
      setSaveState('error');
      toast.error(message);
      return { status: 'failed', inverse: partial?.inverse ?? undefined };
    } finally {
      mutationInFlightRef.current = false;
      if (deferVisualCommit) {
        if (!keepGridLocked) setJourneyGridMutationLock(false);
      } else setBusy('');
    }
  }, [commitMap, loadIndex]);

  const revision = map?.definition.revision ?? 0;
  const editable = map?.version.state === 'draft' && !activeSavedView;
  const canManageSuggestions = Boolean(session?.activeSpace && session.activeSpace.role !== 'member');
  const visibleLanes = useMemo(() => (map?.lanes || []).filter((lane) => lane.visible), [map]);
  const laneTitlesByKey = useMemo(() => new Map((map?.lanes || []).map((lane) => [
    lane.laneType, lane.title || laneLabels[lane.laneType] || lane.laneType
  ])), [map]);
  const cardsByCell = useMemo(() => {
    const cells = new Map<string, JourneyMapCard[]>();
    for (const card of map?.cards || []) {
      const key = `${card.stageKey}|${card.laneType}`;
      cells.set(key, [...(cells.get(key) || []), card]);
    }
    return cells;
  }, [map]);
  const cellCards = (stageKey: string, laneType: string) => cardsByCell.get(`${stageKey}|${laneType}`) || [];

  async function onCreateMap() {
    if (!newMapName.trim()) return;
    setBusy('create'); setError('');
    try {
      const created = await createJourneyMap({ name: newMapName.trim(), mapType: newMapType });
      setNewMapName('');
      await loadIndex();
      setSelectedId(created.id);
      toast.success('Journey map created as a designed hypothesis.');
    } catch (reason) {
      const message = errorMessage(reason, 'The journey map could not be created.');
      setError(message); toast.error(message);
    } finally { setBusy(''); }
  }

  async function onAddStage() {
    if (!map || !newStageName.trim()) return;
    const result = await applyEditorChange({
      type: 'add_stage', stage: { name: newStageName.trim() }
    }, 'stage');
    if (result.status === 'saved') setNewStageName('');
  }

  async function onAddLane() {
    if (!designEnabled || !map || !newLaneTitle.trim()) return;
    const result = await applyEditorChange({
      type: 'add_lane', lane: { title: newLaneTitle.trim(), description: newLaneDescription.trim() }
    }, 'lane');
    if (result.status === 'saved') { setNewLaneTitle(''); setNewLaneDescription(''); }
  }

  function openLaneEditor(lane: JourneyMapLane) {
    if (!designEnabled) return;
    setEditingLane(lane);
    setLaneEditTitle(lane.title);
    setLaneEditDescription(lane.description);
  }

  async function onSaveLane() {
    if (!designEnabled || !map || !editingLane || !laneEditTitle.trim()) return;
    const result = await applyEditorChange({
      type: 'update_lane', laneKey: editingLane.laneType,
      patch: { title: laneEditTitle.trim(), description: laneEditDescription.trim() }
    }, 'lane');
    if (result.status === 'saved') setEditingLane(null);
  }

  async function onMoveLane(lane: JourneyMapLane, toOrdinal: number) {
    if (!designEnabled || !map) return;
    await applyEditorChange({ type: 'move_lane', laneKey: lane.laneType, toOrdinal }, 'move');
  }

  async function onSetLaneVisibility(lane: JourneyMapLane, visible: boolean) {
    if (!designEnabled || !map) return;
    await applyEditorChange({ type: 'set_lane_visibility', laneKey: lane.laneType, visible }, 'lane');
  }

  async function onRemoveLane(lane: JourneyMapLane) {
    if (!designEnabled || !map || !lane.laneType.startsWith('custom_')) return;
    await applyEditorChange({ type: 'remove_lane', laneKey: lane.laneType, requireEmpty: true }, 'delete');
  }

  async function onAddCard() {
    if (!map || !cardDraft || !cardTitle.trim()) return;
    const kind = cardKind || laneCardKinds[cardDraft.laneType]?.[0] || 'note';
    const result = await applyEditorChange({
      type: 'add_card',
      card: {
        stageKey: cardDraft.stageKey, laneType: cardDraft.laneType, kind, title: cardTitle.trim(),
        content: cardContent.trim(), personaId: personasEnabled ? cardPersonaId || null : null, status: 'active'
      }
    }, 'card');
    if (result.status === 'saved') {
      setCardTitle(''); setCardContent(''); setCardPersonaId(''); setCardDraft(null); setCardKind('');
    }
  }

  async function onPublish() {
    const currentMap = mapRef.current;
    if (!currentMap) return;
    setBusy('publish'); setError('');
    try {
      const result = await publishJourneyMap(currentMap.definition.id, currentMap.definition.revision);
      commitMap(result.journeyMap);
      setUndoStack([]);
      setRedoStack([]);
      setSelectedCardIds(new Set());
      setClipboard(null);
      setConflictRecovery(null);
      setSaveState('saved');
      setLastSavedAt(result.journeyMap.definition.updatedAt);
      void loadIndex();
      toast.success('Version published. A new draft is now open for editing.');
    } catch (reason) {
      const message = errorMessage(reason, 'This version could not be published.');
      setError(message); toast.error(message);
    } finally { setBusy(''); }
  }

  async function onDraftPersona() {
    if (!map || !personasEnabled) return;
    setBusy('persona'); setError('');
    try {
      const result = await draftPersonaFromLegacyAudience(map.definition.id);
      commitMap(result.journeyMap);
      void loadIndex();
      toast.success(evidenceEnabled
        ? `“${result.persona.name}” added as a draft persona. Attach evidence before relying on it.`
        : `“${result.persona.name}” added as a draft persona.`);
    } catch (reason) {
      const message = errorMessage(reason, 'The legacy audience could not be converted.');
      setError(message); toast.error(message);
    } finally { setBusy(''); }
  }

  async function onSavePersona(input: JourneyPersonaWriteInput) {
    if (!personasEnabled) return;
    setBusy('persona'); setError('');
    try {
      if (personaEditor === 'new') {
        const persona = await createPersona(input);
        if (map) commitMap(await linkPersona(map.definition.id, persona.id));
        toast.success('Persona created and linked to this journey.');
      } else if (personaEditor) {
        await updatePersona(personaEditor.id, personaEditor.revision, input);
        if (map) await loadMap(map.definition.id);
        toast.success('Persona updated everywhere it is reused.');
      }
      await loadIndex();
      setPersonaEditor(null);
    } catch (reason) {
      const message = errorMessage(reason, 'The persona could not be created.');
      setError(message); toast.error(message); throw reason;
    } finally { setBusy(''); }
  }

  async function onSaveCard(input: {
    title: string; content: string; kind: string; personaId: string | null; status: JourneyMapCard['status'];
  }) {
    if (!map || !editingCard) return 'failed' as const;
    const result = await applyEditorChange({
      type: 'update_card', cardId: editingCard.id,
      patch: { ...input, personaId: personasEnabled ? input.personaId : editingCard.personaId }
    }, 'card');
    return result.status;
  }

  function openCardDraft(stageKey: string, laneType: string) {
    if (!editable || busy) return;
    setActiveCell({ stageKey, laneType });
    setCardDraft({ stageKey, laneType });
    setCardKind(laneCardKinds[laneType]?.[0] || 'note');
    setCardTitle('');
    setCardContent('');
    setCardPersonaId('');
  }

  function toggleCardSelection(cardId: string, selected?: boolean) {
    setSelectedCardIds((current) => {
      const next = new Set(current);
      const shouldSelect = selected ?? !next.has(cardId);
      if (shouldSelect) next.add(cardId); else next.delete(cardId);
      return next;
    });
  }

  function copyCards(cardIds = selectedCardIds) {
    const currentMap = mapRef.current;
    if (!currentMap) return;
    const cards = currentMap.cards.filter((card) => cardIds.has(card.id));
    if (!cards.length) {
      toast.error('Select at least one card to copy.');
      return;
    }
    setClipboard(createJourneyCardClipboard(currentMap.definition.id, cards, personasEnabled));
    toast.success(cards.length === 1 ? 'Card copied to this editing session.' : `${cards.length} cards copied to this editing session.`);
  }

  async function pasteCards(target = { stageKey: pasteStageKey, laneType: pasteLaneType }) {
    const currentMap = mapRef.current;
    if (!currentMap || !clipboard || !index) return;
    const validation = validateJourneyCardPaste(currentMap, clipboard, target, index.limits);
    if (validation) { toast.error(validation); return; }
    setPasteStageKey(target.stageKey);
    setPasteLaneType(target.laneType);
    setActiveCell(target);
    const operation = pasteJourneyCardOperations(
      clipboard,
      target,
      new Set(currentMap.personas.map((persona) => persona.id)),
      personasEnabled
    );
    const result = await applyEditorChange(operation, 'card');
    if (result.status === 'saved') toast.success(clipboard.items.length === 1 ? 'Card pasted.' : `${clipboard.items.length} cards pasted.`);
  }

  async function applyBulkCardPatch(
    label: string,
    patch: JourneyBulkCardPatch
  ) {
    const currentMap = mapRef.current;
    if (!currentMap || selectedCardIds.size === 0) return;
    const cardIds = currentMap.cards
      .filter((card) => selectedCardIds.has(card.id))
      .filter((card) => (
        (patch.status !== undefined && card.status !== patch.status)
        || (patch.personaId !== undefined && card.personaId !== patch.personaId)
        || (patch.stageKey !== undefined && card.stageKey !== patch.stageKey)
        || (patch.laneType !== undefined && card.laneType !== patch.laneType)
      ))
      .map((card) => card.id);
    if (!cardIds.length) {
      toast.success('The selected cards already have that value.');
      return;
    }
    const result = await applyEditorChange({ type: 'bulk_patch_cards', label, cardIds, patch }, 'card');
    if (result.status === 'saved') toast.success(`${cardIds.length} selected card${cardIds.length === 1 ? '' : 's'} updated atomically.`);
  }

  async function onUndo() {
    const entry = undoStack.at(-1);
    if (!entry) return;
    const result = await applyEditorChange(entry.operation, 'move', false);
    if (result.status !== 'saved' || !result.inverse) return;
    setUndoStack((history) => history.slice(0, -1));
    setRedoStack((history) => [...history.slice(-49), { label: entry.label, operation: result.inverse! }]);
    toast.success(`Undid: ${entry.label}.`);
  }

  async function onRedo() {
    const entry = redoStack.at(-1);
    if (!entry) return;
    const result = await applyEditorChange(entry.operation, 'move', false);
    if (result.status !== 'saved' || !result.inverse) return;
    setRedoStack((history) => history.slice(0, -1));
    setUndoStack((history) => [...history.slice(-49), { label: entry.label, operation: result.inverse! }]);
    toast.success(`Redid: ${entry.label}.`);
  }

  async function reapplyConflict() {
    if (!conflictRecovery) return;
    const result = await applyEditorChange(conflictRecovery.operation, 'card');
    if (result.status === 'saved') toast.success('Your retained change was applied to the newer server version.');
  }

  async function deleteCardPermanently(card: JourneyMapCard) {
    const current = mapRef.current;
    if (!current) return;
    const warning = card.evidenceLinkCount > 0
      ? `Delete "${card.title}" and its ${card.evidenceLinkCount} evidence link${card.evidenceLinkCount === 1 ? '' : 's'}? This cannot be undone.`
      : `Delete "${card.title}"? This cannot be undone.`;
    if (!window.confirm(warning)) return;
    setUndoStack([]);
    setRedoStack([]);
    const next = await apply('delete', () => removeCard(current.definition.id, current.definition.revision, card.id));
    if (next) toggleCardSelection(card.id, false);
  }

  async function deleteStagePermanently(stageKey: string, stageName: string) {
    const current = mapRef.current;
    if (!current) return;
    const count = current.cards.filter((card) => card.stageKey === stageKey).length;
    if (!window.confirm(`Delete "${stageName}"${count ? ` and its ${count} card${count === 1 ? '' : 's'}` : ''}? This cannot be undone.`)) return;
    setUndoStack([]);
    setRedoStack([]);
    await apply('delete', () => removeStage(current.definition.id, current.definition.revision, stageKey));
  }

  async function moveCardByKeyboard(card: JourneyMapCard, key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown') {
    const current = mapRef.current;
    if (!current || current.version.state !== 'draft' || mutationInFlightRef.current || busy || saveState === 'conflict') return;
    const currentCard = current.cards.find((item) => item.id === card.id);
    if (!currentCard) return;
    const stageIndex = current.stages.findIndex((stage) => stage.stageKey === currentCard.stageKey);
    const laneIndex = visibleLanes.findIndex((lane) => lane.laneType === currentCard.laneType);
    const targetStage = key === 'ArrowLeft' ? current.stages[stageIndex - 1]
      : key === 'ArrowRight' ? current.stages[stageIndex + 1] : current.stages[stageIndex];
    const targetLane = key === 'ArrowUp' ? visibleLanes[laneIndex - 1]
      : key === 'ArrowDown' ? visibleLanes[laneIndex + 1] : visibleLanes[laneIndex];
    if (!targetStage || !targetLane) return;
    if (targetLane.laneType.startsWith('custom_') && currentCard.kind !== 'note') {
      toast.error('Only note cards can move into a custom lane.');
      return;
    }
    const target = { stageKey: targetStage.stageKey, laneType: targetLane.laneType };
    const result = await applyEditorChange({ type: 'move_card', cardId: currentCard.id, target }, 'move');
    if (result.status === 'saved') {
      setActiveCell(target);
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`[data-card-focus="${CSS.escape(currentCard.id)}"]`)?.focus();
      });
    }
  }

  async function moveCardFromSurface(
    card: JourneyMapCard,
    target: { stageKey: string; laneType: string; ordinal: number }
  ) {
    const current = mapRef.current;
    if (!current || current.version.state !== 'draft' || mutationInFlightRef.current || busy
      || saveState === 'conflict' || conflictRecovery) {
      return { status: 'failed' as const, message: 'The card was not moved because editing is currently unavailable.' };
    }
    if (!current.cards.some((item) => item.id === card.id)) {
      return { status: 'failed' as const, message: 'The card no longer exists. Its authoritative placement is unchanged.' };
    }
    const compactMoveLimits = current.definition.legacyJourneyId ? undefined : index?.limits;
    if (!current.definition.legacyJourneyId && !compactMoveLimits) {
      return { status: 'failed' as const, message: 'The server card limit is unavailable. Refresh before moving a card.' };
    }
    const result = await applyEditorChange(
      { type: 'move_card', cardId: card.id, target }, 'move', true, true, compactMoveLimits
    );
    if (result.status === 'saved') {
      window.setTimeout(() => {
        startTransition(() => setActiveCell({ stageKey: target.stageKey, laneType: target.laneType }));
      }, 0);
      return {
        status: 'saved' as const,
        authoritativeRevision: result.map?.definition.revision,
        authoritativeMap: result.map
      };
    }
    if (result.status === 'conflict') {
      return {
        status: 'conflict' as const,
        message: 'A newer server revision was loaded. The authoritative placement is shown and your move is retained for review.'
      };
    }
    return { status: 'failed' as const, message: 'The move failed. The authoritative placement has been restored.' };
  }

  function focusAdjacentCell(
    stageKey: string,
    laneType: string,
    key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'
  ) {
    if (!map) return;
    const stageIndex = map.stages.findIndex((stage) => stage.stageKey === stageKey);
    const laneIndex = visibleLanes.findIndex((lane) => lane.laneType === laneType);
    const targetStage = key === 'ArrowLeft' ? map.stages[stageIndex - 1]
      : key === 'ArrowRight' ? map.stages[stageIndex + 1] : map.stages[stageIndex];
    const targetLane = key === 'ArrowUp' ? visibleLanes[laneIndex - 1]
      : key === 'ArrowDown' ? visibleLanes[laneIndex + 1] : visibleLanes[laneIndex];
    if (!targetStage || !targetLane) return;
    const target = { stageKey: targetStage.stageKey, laneType: targetLane.laneType };
    setActiveCell(target);
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-cell-focus="${CSS.escape(`${target.stageKey}|${target.laneType}`)}"]`)?.focus();
    });
  }

  async function onExport(format: JourneyMapExportFormat) {
    if (!exportsEnabled || !map || exporting) return;
    exportMenuRef.current?.removeAttribute('open');
    setExporting(format);
    setError('');
    try {
      const artifact = await requestJourneyMapExport(
        map.definition.id,
        map.version.id,
        format,
        activeSavedView ? { id: activeSavedView.view.id, revision: activeSavedView.view.revision } : undefined
      );
      saveExportBlob(artifact.blob, artifact.filename);
      toast.success(`${format.toUpperCase()} export downloaded.`);
    } catch (reason) {
      const detail = errorMessage(reason, 'The journey export could not be downloaded.');
      setError(detail);
      toast.error(detail);
    } finally { setExporting(null); }
  }

  async function onSavedViewExport(format: JourneyMapExportFormat, view: JourneySavedView) {
    if (!exportsEnabled || exporting) return;
    setExporting(format);
    setError('');
    try {
      const artifact = await requestJourneyMapExport(
        view.definitionId,
        undefined,
        format,
        { id: view.id, revision: view.revision }
      );
      saveExportBlob(artifact.blob, artifact.filename);
      toast.success(`${format.toUpperCase()} saved-view export downloaded.`);
    } catch (reason) {
      const detail = errorMessage(reason, 'The saved-view export could not be downloaded.');
      setError(detail);
      toast.error(detail);
    } finally { setExporting(null); }
  }

  const resetSavedView = useCallback(async () => {
    setActiveSavedView(null);
    await loadMap(selectedRef.current);
  }, [loadMap]);

  async function openSuggestionWorkspace() {
    const current = mapRef.current;
    if (!current || !aiEnabled) return;
    setSuggestionOpen(true);
    setSuggestionBusy('load');
    setSuggestionError('');
    try {
      const [runs, evidence] = await Promise.all([
        listJourneySuggestions(current.definition.id),
        evidenceEnabled
          ? listJourneySuggestionEvidence(current.definition.id)
          : Promise.resolve({ evidence: [] as JourneySuggestionEvidenceOption[] })
      ]);
      setSuggestionRuns(runs.suggestions);
      setSuggestionEvidence(evidence.evidence);
      const eligible = new Set(evidence.evidence.map((item) => item.linkId));
      setSelectedSuggestionEvidence((selected) => new Set([...selected].filter((id) => eligible.has(id))));
    } catch (reason) {
      setSuggestionError(errorMessage(reason, 'AI suggestion history could not be loaded.'));
    } finally { setSuggestionBusy(''); }
  }

  function toggleSuggestionEvidence(linkId: string, checked: boolean) {
    setSelectedSuggestionEvidence((current) => {
      const next = new Set(current);
      if (checked) {
        if (next.size >= 20) {
          toast.error('Choose at most 20 evidence records.');
          return current;
        }
        next.add(linkId);
      } else next.delete(linkId);
      return next;
    });
  }

  async function generateJourneySuggestions() {
    const current = mapRef.current;
    if (!current || !aiEnabled || !canManageSuggestions || current.version.state !== 'draft') return;
    setSuggestionBusy('create');
    setSuggestionError('');
    try {
      const result = await createJourneySuggestion(current.definition.id, {
        focus: suggestionFocus.trim() || undefined,
        evidenceLinkIds: [...selectedSuggestionEvidence]
      });
      setSuggestionRuns((runs) => [result.suggestion.run, ...runs.filter((run) => run.id !== result.suggestion.run.id)]);
      setSuggestionOpen(false);
      navigate(`/journey-maps/suggestions/${result.suggestion.run.id}`);
    } catch (reason) {
      setSuggestionError(errorMessage(reason, 'The AI suggestion request could not be started.'));
    } finally { setSuggestionBusy(''); }
  }

  const exitPresentation = useCallback(() => {
    setPresenting(false);
    window.requestAnimationFrame(() => presentationTriggerRef.current?.focus());
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!editable || busy || !(event.ctrlKey || event.metaKey)) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey && undoStack.length) {
        event.preventDefault(); void onUndo();
      } else if ((key === 'y' || (key === 'z' && event.shiftKey)) && redoStack.length) {
        event.preventDefault(); void onRedo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, editable, onRedo, onUndo, redoStack.length, undoStack.length]);

  if (loading) {
    return <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />Loading journey maps…
    </div>;
  }

  const mode = map ? journeyModeLabels[map.definition.mode] : null;
  const cardSurfaceActions: JourneyCardSurfaceActions = {
    setActiveCell,
    focusAdjacentCell,
    openCardDraft,
    pasteCards,
    copyCard: (cardId) => copyCards(new Set([cardId])),
    toggleCardSelection,
    inspectCard: setInspectingCard,
    editCard: setEditingCard,
    openEvidence: setEvidenceCard,
    deleteCard: deleteCardPermanently,
    moveCardByKeyboard,
    moveCard: moveCardFromSurface,
    moveStage: async (stage, toOrdinal) => {
      await applyEditorChange({ type: 'move_stage', stageKey: stage.stageKey, toOrdinal }, 'move');
    },
    deleteStage: async (stage) => {
      await deleteStagePermanently(stage.stageKey, stage.name);
    }
  };

  if (presenting && map) {
    return <JourneyPresentation map={map} richMap={richMap} evidenceEnabled={evidenceEnabled} personasEnabled={personasEnabled}
      presentation={activeSavedView?.view.config.presentation} onExit={exitPresentation} />;
  }

  return <div className="space-y-6 p-6" data-testid="journey-maps-page">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold">Journey maps</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          {evidenceEnabled
            ? 'Stages run across, lanes run down. A map stays a designed hypothesis until its claims cite authorised evidence.'
            : 'Stages run across and lanes run down. Build and publish the journey structure for this space.'}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <JourneyTemplateManager onMapCreated={(definitionId) => {
          setSelectedId(definitionId);
          void loadIndex();
        }} />
        <Button variant="outline" size="sm" onClick={() => { void loadIndex(); void loadMap(selectedId); }}>
          <RefreshCw className="mr-2 h-4 w-4" />Refresh
        </Button>
      </div>
    </header>

    {error && <p className="border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert" data-testid="journey-map-error">{error}</p>}

    <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">New journey map</CardTitle>
            <CardDescription className="text-xs">Created as a designed hypothesis.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Label htmlFor="new-map-name" className="text-xs">Name</Label>
            <Input id="new-map-name" data-testid="new-map-name" value={newMapName}
              onChange={(event) => setNewMapName(event.target.value)} placeholder="Renewal journey" />
            <Label htmlFor="new-map-type" className="text-xs">Map type</Label>
            <select
              id="new-map-type" data-testid="new-map-type" className="h-9 w-full border px-2 text-sm" value={newMapType}
              onChange={(event) => setNewMapType(event.target.value as JourneyMapType)}
            >
              {Object.entries(mapTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <Button className="w-full" data-testid="create-map" disabled={busy === 'create' || !newMapName.trim()} onClick={onCreateMap}>
              {busy === 'create' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Create map
            </Button>
          </CardContent>
        </Card>

        <nav aria-label="Journey maps" className="space-y-1" data-testid="journey-map-list">
          {(index?.journeyMaps || []).map((item) => <button
            key={item.id} type="button" onClick={() => setSelectedId(item.id)}
            data-testid={`journey-map-item-${item.id}`}
            aria-current={item.id === selectedId ? 'true' : undefined}
            className={`w-full border p-3 text-left text-sm ${item.id === selectedId ? 'border-primary bg-muted/60' : 'hover:bg-muted/40'}`}
          >
            <span className="block font-medium">{item.name}</span>
            <span className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              <Badge variant={item.mode === 'designed' ? 'warning' : 'success'}>{journeyModeLabels[item.mode].label}</Badge>
              <span>{item.stageCount} stages · {item.cardCount} cards</span>
              {item.legacyJourneyId && <Badge variant="outline">Converted</Badge>}
            </span>
          </button>)}
          {!index?.journeyMaps.length && <p className="text-sm text-muted-foreground">No journey maps yet.</p>}
        </nav>
      </aside>

      {!map
        ? <EmptyState icon={Layers} title="No journey map selected"
          description="Create a map, or open one converted from an existing journey." />
        : <section className="min-w-0 space-y-4" data-testid="journey-workspace">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
            <div>
              <h2 className="text-lg font-semibold" data-testid="journey-map-name">{map.definition.name}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <Badge data-testid="journey-mode" variant={map.definition.mode === 'designed' ? 'warning' : 'success'}>
                  {mode?.label}
                </Badge>
                <Badge variant="outline">{mapTypeLabels[map.version.mapType]}</Badge>
                <Badge variant="outline" data-testid="journey-version">
                  v{map.version.versionNumber} · {map.version.state}
                </Badge>
                <span className="text-muted-foreground">Updated {formatDateTime(map.definition.updatedAt)}</span>
              </div>
              <p className="mt-2 max-w-2xl text-xs text-muted-foreground">{mode?.description}</p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex flex-wrap justify-end gap-2">
                {aiEnabled && <Button type="button" size="sm" variant="outline"
                  data-testid="journey-ai-suggestions" onClick={() => void openSuggestionWorkspace()}>
                  <ListChecks className="mr-2 h-4 w-4" />AI suggestions
                </Button>}
                <Button ref={presentationTriggerRef} type="button" size="sm" variant="outline"
                  data-testid="open-presentation" onClick={() => setPresenting(true)}>
                  <Eye className="mr-2 h-4 w-4" />Present
                </Button>
                {exportsEnabled && <details className="relative" ref={exportMenuRef} data-testid="journey-export-menu">
                  <summary className={`flex h-9 cursor-pointer list-none items-center rounded-md border border-input bg-background px-3 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                    exporting ? 'pointer-events-none opacity-60' : ''}`}
                    aria-disabled={Boolean(exporting)}>
                    {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                    Export <ChevronDown className="ml-2 h-3.5 w-3.5" />
                  </summary>
                  <div className="absolute right-0 z-30 mt-1 w-56 border bg-popover p-1 shadow-panel">
                    {journeyExportOptions.map((option) => <button type="button" key={option.format}
                      data-testid={`export-journey-${option.format}`} disabled={Boolean(exporting)}
                      className="flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-muted disabled:opacity-50"
                      onClick={() => void onExport(option.format)}>
                      <span className="min-w-12 text-xs font-semibold">{option.label}</span>
                      <span className="text-xs leading-4 text-muted-foreground">{option.detail}</span>
                    </button>)}
                  </div>
                </details>}
                <Button size="sm" data-testid="publish-map" disabled={!editable || Boolean(busy)} onClick={onPublish}>
                  {busy === 'publish' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                  Publish version
                </Button>
              </div>
              {exporting && <p className="text-xs text-muted-foreground" role="status" data-testid="journey-export-progress">
                Preparing {exporting.toUpperCase()} download…
              </p>}
            </div>
          </div>

          {savedViewsEnabled && index && session?.user && session.activeSpace && <JourneySavedViewBar
            map={map}
            optionsMap={authoritativeMap || map}
            index={index}
            currentUserId={session.user.id}
            spaceRole={session.activeSpace.role}
            metricsEnabled={metricsEnabled}
            richCardsEnabled={richCardsEnabled}
            evidenceEnabled={evidenceEnabled}
            onApply={applySavedView}
            onReset={resetSavedView}
            onPresent={presentSavedView}
            onExport={onSavedViewExport}
          />}

          {activeSavedView && <div className="border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-950"
            role="status" data-testid="active-journey-saved-view">
            Viewing “{activeSavedView.view.name}” at revision {activeSavedView.view.revision}. This filtered snapshot is read-only; reset the view to edit the authoritative map.
          </div>}

          {editable && <div className="flex flex-wrap items-center justify-between gap-3 border px-3 py-2" data-testid="editor-session-toolbar">
            <div className="flex items-center gap-1">
              <Button type="button" size="sm" variant="ghost" data-testid="journey-undo"
                aria-label={undoStack.length ? `Undo ${undoStack.at(-1)?.label}` : 'Undo'}
                disabled={!undoStack.length || Boolean(busy)} onClick={() => void onUndo()}>
                <Undo2 className="mr-1 h-4 w-4" />Undo
              </Button>
              <Button type="button" size="sm" variant="ghost" data-testid="journey-redo"
                aria-label={redoStack.length ? `Redo ${redoStack.at(-1)?.label}` : 'Redo'}
                disabled={!redoStack.length || Boolean(busy)} onClick={() => void onRedo()}>
                <Redo2 className="mr-1 h-4 w-4" />Redo
              </Button>
            </div>
            <p className="text-xs text-muted-foreground" role="status" aria-live="polite" data-testid="journey-save-state">
              {saveState === 'loaded' && 'Server version loaded.'}
              {saveState === 'saving' && 'Saving changes...'}
              {saveState === 'saved' && `Saved${lastSavedAt ? ` ${formatDateTime(lastSavedAt)}` : ''}.`}
              {saveState === 'conflict' && 'Newer server version loaded. Review the retained change below.'}
              {saveState === 'error' && 'Some changes are not saved. Review the error below.'}
            </p>
            <p className="basis-full text-xs text-muted-foreground">
              In the map, use arrow keys between cells, N or Enter to add, Enter on a card to inspect, and Alt+Arrow to move a card.
            </p>
          </div>}

          {conflictRecovery && <div className="border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
            role="alert" data-testid="journey-conflict-recovery">
            <p className="font-medium">A newer server version replaced the optimistic view.</p>
            <p className="mt-1 text-xs leading-5">
              Your {conflictRecovery.label.toLowerCase()} is retained. {conflictRecovery.completed > 0
                ? `${conflictRecovery.completed} of ${conflictRecovery.total} sequential changes were already saved. `
                : ''}Review the refreshed map before applying the remaining change.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button type="button" size="sm" data-testid="reapply-conflict" disabled={Boolean(busy)}
                onClick={() => void reapplyConflict()}>Reapply retained change</Button>
              <Button type="button" size="sm" variant="outline" data-testid="dismiss-conflict"
                disabled={Boolean(busy)} onClick={() => { setConflictRecovery(null); setSaveState('loaded'); }}>
                Discard retained change
              </Button>
            </div>
          </div>}

          {personasEnabled && map.version.legacyAudience && <div className="flex flex-wrap items-center gap-3 border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1">
              Legacy audience “{map.version.legacyAudience}” is unvalidated free text, not a researched persona.
            </span>
            <Button size="sm" variant="outline" data-testid="convert-audience" disabled={busy === 'persona'} onClick={onDraftPersona}>
              Convert to persona draft
            </Button>
          </div>}

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="w-full max-w-full justify-start overflow-x-auto">
              <TabsTrigger value="map" data-testid="tab-map">Map</TabsTrigger>
              <TabsTrigger value="outline" data-testid="tab-outline">Outline</TabsTrigger>
              {richCardsEnabled && <TabsTrigger value="rich-cards" data-testid="tab-rich-cards">Rich cards</TabsTrigger>}
              <TabsTrigger value="structure-compare" data-testid="tab-compare">Compare</TabsTrigger>
              {evidenceEnabled && <TabsTrigger value="gaps" data-testid="tab-gaps">Research gaps ({map.researchGaps.length})</TabsTrigger>}
              {personasEnabled && <TabsTrigger value="personas" data-testid="tab-personas">Personas ({map.personas.length})</TabsTrigger>}
              {personasEnabled && <TabsTrigger value="persona-compare" data-testid="tab-persona-compare">Compare personas</TabsTrigger>}
              {connectedEnabled && <TabsTrigger value="event-rules" data-testid="tab-event-rules">Event rules</TabsTrigger>}
            </TabsList>

            <TabsContent value="map">
              {editable && <section className="mb-4 border p-3" aria-label="Card editing tools" data-testid="card-bulk-toolbar">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{selectedCardIds.size} card{selectedCardIds.size === 1 ? '' : 's'} selected</p>
                  <div className="flex flex-wrap gap-1">
                    <Button type="button" size="sm" variant="ghost" disabled={!map.cards.length || Boolean(busy)}
                      data-testid="select-all-cards" onClick={() => setSelectedCardIds(new Set(map.cards.map((card) => card.id)))}>
                      Select all
                    </Button>
                    <Button type="button" size="sm" variant="ghost" disabled={!selectedCardIds.size || Boolean(busy)}
                      data-testid="clear-card-selection" onClick={() => setSelectedCardIds(new Set())}>Clear</Button>
                    <Button type="button" size="sm" variant="outline" disabled={!selectedCardIds.size || Boolean(busy)}
                      data-testid="copy-selected-cards" onClick={() => copyCards()}>
                      <Copy className="mr-1 h-4 w-4" />Copy selected
                    </Button>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 lg:grid-cols-3">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
                    <div><Label htmlFor="bulk-card-status" className="text-xs">Set status</Label>
                      <select id="bulk-card-status" data-testid="bulk-card-status" className="mt-1 h-9 w-full border px-2 text-sm"
                        value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value as JourneyMapCard['status'])}>
                        <option value="draft">Draft</option><option value="active">Active</option><option value="retired">Retired</option>
                      </select></div>
                    <Button type="button" size="sm" data-testid="apply-bulk-status"
                      disabled={!selectedCardIds.size || Boolean(busy)} onClick={() => void applyBulkCardPatch(
                        'Set selected card status',
                        { status: bulkStatus }
                      )}>Apply</Button>
                  </div>

                  {personasEnabled && <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
                    <div><Label htmlFor="bulk-card-persona" className="text-xs">Set persona layer</Label>
                      <select id="bulk-card-persona" data-testid="bulk-card-persona" className="mt-1 h-9 w-full border px-2 text-sm"
                        value={bulkPersonaId} onChange={(event) => setBulkPersonaId(event.target.value)}>
                        <option value="">Shared across personas</option>
                        {map.personas.map((persona) => <option key={persona.id} value={persona.id}>{persona.name}</option>)}
                      </select></div>
                    <Button type="button" size="sm" data-testid="apply-bulk-persona"
                      disabled={!selectedCardIds.size || Boolean(busy)} onClick={() => void applyBulkCardPatch(
                        'Set selected card persona',
                        { personaId: bulkPersonaId || null }
                      )}>Apply</Button>
                  </div>}

                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
                    <div><Label htmlFor="bulk-card-stage" className="text-xs">Move to stage</Label>
                      <select id="bulk-card-stage" data-testid="bulk-card-stage" className="mt-1 h-9 w-full border px-2 text-sm"
                        value={bulkStageKey} onChange={(event) => setBulkStageKey(event.target.value)}>
                        {map.stages.map((stage) => <option key={stage.id} value={stage.stageKey}>{stage.name}</option>)}
                      </select></div>
                    <Button type="button" size="sm" data-testid="apply-bulk-stage"
                      disabled={!selectedCardIds.size || !bulkStageKey || Boolean(busy)} onClick={() => void applyBulkCardPatch(
                        'Move selected cards',
                        { stageKey: bulkStageKey }
                      )}>Move</Button>
                  </div>
                </div>

                <div className="mt-3 grid gap-2 border-t pt-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                  <div><Label htmlFor="paste-card-stage" className="text-xs">Paste into stage</Label>
                    <select id="paste-card-stage" data-testid="paste-card-stage" className="mt-1 h-9 w-full border px-2 text-sm"
                      value={pasteStageKey} onChange={(event) => setPasteStageKey(event.target.value)}>
                      {map.stages.map((stage) => <option key={stage.id} value={stage.stageKey}>{stage.name}</option>)}
                    </select></div>
                  <div><Label htmlFor="paste-card-lane" className="text-xs">Paste into lane</Label>
                    <select id="paste-card-lane" data-testid="paste-card-lane" className="mt-1 h-9 w-full border px-2 text-sm"
                      value={pasteLaneType} onChange={(event) => setPasteLaneType(event.target.value)}>
                      {visibleLanes.map((lane) => <option key={lane.id} value={lane.laneType}>
                        {lane.title || laneLabels[lane.laneType] || lane.laneType}
                      </option>)}
                    </select></div>
                  <Button type="button" size="sm" variant="outline" data-testid="paste-cards"
                    disabled={!clipboard?.items.length || !pasteStageKey || !pasteLaneType || Boolean(busy)}
                    onClick={() => void pasteCards()}>
                    <ClipboardPaste className="mr-1 h-4 w-4" />Paste {clipboard?.items.length || ''}
                  </Button>
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  The session clipboard copies card text and an available persona layer, never evidence links. A multi-select edit is one
                  revision-checked transaction: every selected card is saved, or none are.
                </p>
              </section>}

              {map.stages.length === 0
                ? <EmptyState icon={Layers} title="No stages yet"
                  description="Add the first stage a participant goes through. Stages are phases defined by their goal, not internal departments." />
                : <JourneyCardGrid
                  map={map}
                  visibleLanes={visibleLanes}
                  editable={Boolean(editable)}
                  mutationLocked={Boolean(busy) || saveState === 'conflict'}
                  selectedCardIds={selectedCardIds}
                  activeCell={activeCell}
                  personasEnabled={personasEnabled}
                  evidenceEnabled={evidenceEnabled}
                  cardsPerCell={index?.limits.cardsPerCell ?? 40}
                  renderEvidence={(card) => <EvidenceBadge card={card} />}
                  actions={cardSurfaceActions}
                />}

              {designEnabled && editable && <details className="mt-4 border" data-testid="lane-manager">
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                  Manage lanes <span className="ml-1 text-xs font-normal text-muted-foreground">{map.lanes.length} of {index?.limits.lanes ?? 24}</span>
                </summary>
                <div className="border-t p-4">
                  <ol className="divide-y border" data-testid="lane-list">
                    {map.lanes.map((lane, laneIndex) => {
                      const custom = lane.laneType.startsWith('custom_');
                      const cardCount = map.cards.filter((card) => card.laneType === lane.laneType).length;
                      return <li key={lane.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-start sm:justify-between"
                        data-testid={`lane-row-${lane.laneType}`}>
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{lane.title || laneLabels[lane.laneType] || lane.laneType}</p>
                          <p className="mt-0.5 break-all text-xs text-muted-foreground">
                            {lane.laneType}{lane.visible ? '' : ' · hidden'} · {cardCount} {cardCount === 1 ? 'card' : 'cards'}
                          </p>
                          {lane.description && <p className="mt-1 text-xs leading-5 text-muted-foreground">{lane.description}</p>}
                          {custom && cardCount > 0 && <p className="mt-1 text-xs text-muted-foreground">
                            Move or remove every card before deleting this lane.
                          </p>}
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-1">
                          <Button type="button" variant="ghost" size="sm" className="h-8 px-2"
                            aria-label={`Move lane ${lane.title} earlier`} data-testid={`lane-move-up-${lane.laneType}`}
                            disabled={busy === 'move' || laneIndex === 0}
                            onClick={() => void onMoveLane(lane, laneIndex - 1)}><ArrowUp className="h-3.5 w-3.5" /></Button>
                          <Button type="button" variant="ghost" size="sm" className="h-8 px-2"
                            aria-label={`Move lane ${lane.title} later`} data-testid={`lane-move-down-${lane.laneType}`}
                            disabled={busy === 'move' || laneIndex === map.lanes.length - 1}
                            onClick={() => void onMoveLane(lane, laneIndex + 1)}><ArrowDown className="h-3.5 w-3.5" /></Button>
                          <Button type="button" variant="ghost" size="sm" className="h-8 px-2"
                            aria-label={`Edit lane ${lane.title}`} data-testid={`lane-edit-${lane.laneType}`}
                            disabled={busy === 'lane'} onClick={() => openLaneEditor(lane)}>
                            <Pencil className="mr-1 h-3.5 w-3.5" />Edit
                          </Button>
                          <Button type="button" variant="ghost" size="sm" className="h-8 px-2"
                            aria-label={`${lane.visible ? 'Hide' : 'Show'} lane ${lane.title}`}
                            data-testid={`lane-visibility-${lane.laneType}`} disabled={busy === 'lane'}
                            onClick={() => void onSetLaneVisibility(lane, !lane.visible)}>
                            {lane.visible ? <EyeOff className="mr-1 h-3.5 w-3.5" /> : <Eye className="mr-1 h-3.5 w-3.5" />}
                            {lane.visible ? 'Hide' : 'Show'}
                          </Button>
                          {custom && <Button type="button" variant="ghost" size="sm" className="h-8 px-2"
                            aria-label={`Delete lane ${lane.title}`} data-testid={`lane-delete-${lane.laneType}`}
                            title={cardCount > 0 ? 'Move or remove every card before deleting this lane.' : undefined}
                            disabled={busy === 'delete' || cardCount > 0} onClick={() => void onRemoveLane(lane)}>
                            <Trash2 className="mr-1 h-3.5 w-3.5" />Delete
                          </Button>}
                        </div>
                      </li>;
                    })}
                  </ol>
                  <form className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end"
                    onSubmit={(event) => { event.preventDefault(); void onAddLane(); }}>
                    <div><Label htmlFor="new-lane-title" className="text-xs">New custom lane</Label>
                      <Input id="new-lane-title" data-testid="new-lane-title" value={newLaneTitle}
                        maxLength={index?.limits.titleChars ?? 200} placeholder="Customer commitments"
                        onChange={(event) => setNewLaneTitle(event.target.value)} /></div>
                    <div><Label htmlFor="new-lane-description" className="text-xs">Description</Label>
                      <Input id="new-lane-description" data-testid="new-lane-description" value={newLaneDescription}
                        maxLength={index?.limits.contentChars ?? 2000} placeholder="Optional guidance for authors"
                        onChange={(event) => setNewLaneDescription(event.target.value)} /></div>
                    <Button type="submit" data-testid="add-lane"
                      disabled={busy === 'lane' || !newLaneTitle.trim() || map.lanes.length >= (index?.limits.lanes ?? 24)}>
                      {busy === 'lane' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                      Add lane
                    </Button>
                  </form>
                </div>
              </details>}

              {editable && <div className="mt-4 flex flex-wrap items-end gap-2">
                <div className="min-w-56 flex-1">
                  <Label htmlFor="new-stage-name" className="text-xs">New stage</Label>
                  <Input id="new-stage-name" data-testid="new-stage-name" value={newStageName}
                    placeholder="Discover" onChange={(event) => setNewStageName(event.target.value)} />
                </div>
                <Button data-testid="add-stage" disabled={busy === 'stage' || !newStageName.trim()} onClick={onAddStage}>
                  {busy === 'stage' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                  Add stage
                </Button>
              </div>}
            </TabsContent>

            {/* A linear, screen-reader friendly rendering of the same data. The
                grid is convenient; this is the one that has to be complete. */}
            <TabsContent value="outline">
              <JourneyCardOutline
                map={map}
                editable={Boolean(editable)}
                mutationLocked={Boolean(busy) || saveState === 'conflict'}
                selectedCardIds={selectedCardIds}
                personasEnabled={personasEnabled}
                evidenceEnabled={evidenceEnabled}
                actions={cardSurfaceActions}
              />
            </TabsContent>

            {richCardsEnabled && <TabsContent value="rich-cards">
              {richMapLoading && !richMap
                ? <div className="flex items-center gap-2 border px-4 py-8 text-sm text-muted-foreground" role="status">
                  <Loader2 className="h-4 w-4 animate-spin" />Loading rich cards…
                </div>
                : richMapError
                  ? <div className="border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
                    {richMapError}
                    <Button type="button" size="sm" variant="outline" className="ml-3"
                      onClick={() => void loadRichMap(map.definition.id, map.version.id)}>Retry</Button>
                  </div>
                  : richMap && <Suspense fallback={<div className="flex items-center gap-2 border px-4 py-8 text-sm text-muted-foreground" role="status">
                    <Loader2 className="h-4 w-4 animate-spin" />Opening rich-card editor…
                  </div>}><JourneyRichCardWorkspace map={map} snapshot={richMap}
                      editable={Boolean(editable && session?.activeSpace?.role !== 'member')}
                      onChanged={async () => {
                        const loaded = await loadMap(map.definition.id);
                        await Promise.all([
                          loadIndex(),
                          loadRichMap(map.definition.id, loaded?.version.id || map.version.id)
                        ]);
                      }} /></Suspense>}
            </TabsContent>}

            <TabsContent value="structure-compare">
              <JourneyMapComparison
                currentMap={map}
                definitions={index?.journeyMaps || []}
                personasEnabled={personasEnabled}
                evidenceEnabled={evidenceEnabled}
                savedComparisonMap={activeSavedView?.comparisonMap}
              />
            </TabsContent>

            {evidenceEnabled && <TabsContent value="gaps">
              {map.researchGaps.length === 0
                ? <EmptyState icon={Table2} title="No open research gaps"
                  description="Every claim card on this map cites sufficient evidence for its declared population." />
                : <ul className="space-y-2" data-testid="research-gaps">
                  {map.researchGaps.map((gap) => <li key={gap.cardId} className="border p-3 text-sm">
                    <p className="font-medium">{gap.cardTitle}</p>
                    <p className="text-xs text-muted-foreground">
                      {gap.stageName} · {laneTitlesByKey.get(gap.laneType) || gap.laneType} · {evidenceStateLabels[gap.state].label}
                      {' '}({gap.reason.replaceAll('_', ' ')})
                    </p>
                  </li>)}
                </ul>}
            </TabsContent>}

            {personasEnabled && <TabsContent value="personas">
              <div className="space-y-4">
                <div className="flex justify-end">
                  <Button data-testid="create-persona" disabled={busy === 'persona'} onClick={() => setPersonaEditor('new')}>
                    <UsersRound className="mr-2 h-4 w-4" />Create and link
                  </Button>
                </div>
                {map.personas.length === 0
                  ? <p className="text-sm text-muted-foreground">No personas are linked to this map yet.</p>
                  : <ul className="space-y-2" data-testid="journey-personas">
                    {map.personas.map((persona) => <li key={persona.id} className="flex items-start justify-between gap-3 border p-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{persona.name}</p>
                        <p className="text-xs text-muted-foreground">{persona.summary || 'No summary yet.'}</p>
                        {(persona.goals.length > 0 || persona.needs.length > 0 || persona.barriers.length > 0) && <p className="mt-1 text-xs text-muted-foreground">
                          {persona.goals.length} goals · {persona.needs.length} needs · {persona.barriers.length} barriers
                        </p>}
                        <div className="mt-1 flex flex-wrap gap-1">
                          <Badge variant="outline">{persona.lifecycleState.replaceAll('_', ' ')}</Badge>
                          {evidenceEnabled && persona.evidenceState && <Badge variant="outline">
                            {evidenceStateLabels[persona.evidenceState].label}
                          </Badge>}
                          {persona.source === 'legacy_audience_draft' && <Badge variant="warning">From legacy audience</Badge>}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button variant="ghost" size="sm" disabled={busy === 'persona'}
                          data-testid={`edit-persona-${persona.id}`} onClick={() => setPersonaEditor(persona)}>
                          <Pencil className="mr-1 h-3.5 w-3.5" />Edit
                        </Button>
                        <Button
                          variant="ghost" size="sm" disabled={busy === 'persona'}
                          data-testid={`unlink-persona-${persona.id}`}
                          onClick={() => apply('persona', () => unlinkPersona(map.definition.id, persona.id))}
                        >Unlink</Button>
                      </div>
                    </li>)}
                  </ul>}
                {index && index.personas.length > map.personas.length && <details className="border p-3">
                  <summary className="flex cursor-pointer items-center gap-1 text-sm font-medium">
                    <ChevronDown className="h-4 w-4" />Reuse an existing persona
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {index.personas
                      .filter((persona) => !map.personas.some((linked) => linked.id === persona.id))
                      .map((persona) => <li key={persona.id} className="flex items-center justify-between gap-2 text-sm">
                        <span>{persona.name} <span className="text-xs text-muted-foreground">
                          · used by {persona.linkedJourneyCount ?? 0} map(s)</span></span>
                        <Button
                          variant="ghost" size="sm" data-testid={`link-persona-${persona.id}`} disabled={busy === 'persona'}
                          onClick={() => apply('persona', () => linkPersona(map.definition.id, persona.id))}
                        >Link</Button>
                      </li>)}
                  </ul>
                </details>}
              </div>
            </TabsContent>}

            {personasEnabled && <TabsContent value="persona-compare">
              {map.personas.length < 2
                ? <EmptyState icon={UsersRound} title="Link two personas to compare"
                  description="Persona comparison uses the same journey. Shared cards appear for both personas; persona-specific cards remain separate." />
                : <div className="space-y-4" data-testid="persona-comparison">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {([0, 1] as const).map((position) => <div key={position} className="space-y-2">
                      <Label htmlFor={`compare-persona-${position}`}>Persona {position === 0 ? 'A' : 'B'}</Label>
                      <select id={`compare-persona-${position}`} className="h-9 w-full border px-2 text-sm"
                        value={comparePersonas[position]}
                        onChange={(event) => setComparePersonas(position === 0
                          ? [event.target.value, comparePersonas[1]]
                          : [comparePersonas[0], event.target.value])}>
                        {map.personas.map((persona) => <option key={persona.id} value={persona.id}
                          disabled={persona.id === comparePersonas[position === 0 ? 1 : 0]}>{persona.name}</option>)}
                      </select>
                    </div>)}
                  </div>
                  <div className="overflow-x-auto border">
                    <table className="w-full min-w-[720px] border-collapse text-sm">
                      <caption className="sr-only">Journey content compared for two linked personas. Shared cards are included in both columns.</caption>
                      <thead>
                        <tr className="bg-muted/30">
                          <th scope="col" className="border-b p-2 text-left">Stage and lane</th>
                          {comparePersonas.map((personaId, position) => <th key={`${personaId}-${position}`} scope="col" className="border-b p-2 text-left">
                            {map.personas.find((persona) => persona.id === personaId)?.name || `Persona ${position + 1}`}
                          </th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {map.stages.flatMap((stage) => visibleLanes.map((lane) => {
                          const cards = cellCards(stage.stageKey, lane.laneType);
                          const compared = comparePersonas.map((personaId) => cards.filter((card) => !card.personaId || card.personaId === personaId));
                          if (compared.every((items) => items.length === 0)) return null;
                          return <tr key={`${stage.id}-${lane.id}`}>
                            <th scope="row" className="border-b p-2 text-left align-top text-xs font-medium">
                              {stage.name}<span className="block font-normal text-muted-foreground">{lane.title || laneLabels[lane.laneType] || lane.laneType}</span>
                            </th>
                            {compared.map((items, position) => <td key={position} className="border-b p-2 align-top">
                              {items.length === 0 ? <span className="text-xs text-muted-foreground">No applicable cards</span> : <ul className="space-y-1">
                                {items.map((card) => <li key={card.id} className="border p-2 text-xs">
                                  <span className="font-medium">{card.title}</span>
                                  {!card.personaId && <span className="ml-1 text-muted-foreground">· Shared</span>}
                                </li>)}
                              </ul>}
                            </td>)}
                          </tr>;
                        }))}
                      </tbody>
                    </table>
                  </div>
                </div>}
            </TabsContent>}
            {connectedEnabled && <TabsContent value="event-rules">
              <JourneyStageRulesWorkspace key={map.definition.id} map={map} onConnectedChange={() => {
                void loadIndex(); void loadMap(map.definition.id);
              }} />
            </TabsContent>}
          </Tabs>
        </section>}
    </div>

    {designEnabled && editingLane && <Dialog open onOpenChange={(next) => { if (!next) setEditingLane(null); }}>
      <DialogContent data-testid="edit-lane-dialog">
        <DialogHeader>
          <DialogTitle>Edit lane</DialogTitle>
          <DialogDescription>The stable key remains unchanged so cards, versions, templates, and exports keep their identity.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1"><Label htmlFor="edit-lane-key" className="text-xs">Stable key</Label>
          <Input id="edit-lane-key" value={editingLane.laneType} disabled aria-readonly="true" /></div>
        <div className="space-y-1"><Label htmlFor="edit-lane-title" className="text-xs">Title</Label>
          <Input id="edit-lane-title" data-testid="edit-lane-title" value={laneEditTitle} autoFocus
            maxLength={index?.limits.titleChars ?? 200} onChange={(event) => setLaneEditTitle(event.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="edit-lane-description" className="text-xs">Description</Label>
          <Textarea id="edit-lane-description" data-testid="edit-lane-description" rows={3}
            maxLength={index?.limits.contentChars ?? 2000} value={laneEditDescription}
            onChange={(event) => setLaneEditDescription(event.target.value)} /></div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setEditingLane(null)}>Cancel</Button>
          <Button type="button" data-testid="save-lane" disabled={busy === 'lane' || !laneEditTitle.trim()}
            onClick={() => void onSaveLane()}>
            {busy === 'lane' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save lane
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>}

    {cardDraft && <Dialog open onOpenChange={(next) => { if (!next) setCardDraft(null); }}>
      <DialogContent data-testid="add-card-dialog">
        <DialogHeader>
          <DialogTitle>Add a card</DialogTitle>
          <DialogDescription>{evidenceEnabled
            ? 'New cards start as hypotheses. Attach evidence to change how they are labelled.'
            : 'Add a structured claim to this stage and lane.'}</DialogDescription>
        </DialogHeader>
        <Label htmlFor="card-kind" className="text-xs">Kind</Label>
        <select
          id="card-kind" data-testid="card-kind" className="h-9 w-full border px-2 text-sm" value={cardKind}
          onChange={(event) => setCardKind(event.target.value)}
        >
          {(laneCardKinds[cardDraft.laneType] || ['note']).map((kind) => <option key={kind} value={kind}>
            {cardKindLabels[kind] || kind}
          </option>)}
        </select>
        <Label htmlFor="card-title" className="text-xs">Title</Label>
        <Input id="card-title" data-testid="card-title" value={cardTitle} autoFocus
          onChange={(event) => setCardTitle(event.target.value)} />
        <Label htmlFor="card-content" className="text-xs">Details</Label>
        <Textarea id="card-content" rows={3} value={cardContent}
          onChange={(event) => setCardContent(event.target.value)} />
        {personasEnabled && <>
          <Label htmlFor="card-persona" className="text-xs">Persona layer</Label>
          <select id="card-persona" className="h-9 w-full border px-2 text-sm" value={cardPersonaId}
            onChange={(event) => setCardPersonaId(event.target.value)}>
            <option value="">Shared across personas</option>
            {map?.personas.map((persona) => <option key={persona.id} value={persona.id}>{persona.name}</option>)}
          </select>
        </>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setCardDraft(null)}>Cancel</Button>
          <Button data-testid="save-card" disabled={busy === 'card' || !cardTitle.trim()} onClick={onAddCard}>
            {busy === 'card' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Add card
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>}

    {inspectingCard && map && (() => {
      const currentCard = map.cards.find((card) => card.id === inspectingCard.id) || inspectingCard;
      return <CardInspector
        card={currentCard}
        richDetail={richMap?.cards.find((detail) => detail.cardId === currentCard.id) || null}
        stageName={map.stages.find((stage) => stage.stageKey === currentCard.stageKey)?.name || currentCard.stageKey}
        laneName={laneTitlesByKey.get(currentCard.laneType) || currentCard.laneType}
        personaName={personasEnabled && currentCard.personaId
          ? map.personas.find((persona) => persona.id === currentCard.personaId)?.name || 'Persona-specific'
          : ''}
        evidenceEnabled={evidenceEnabled}
        editable={editable}
        onClose={() => setInspectingCard(null)}
        onEdit={() => { setInspectingCard(null); setEditingCard(currentCard); }}
      />;
    })()}

    {editingCard && map && <CardEditor
      card={editingCard}
      personas={map.personas}
      personasEnabled={personasEnabled}
      busy={busy === 'card'}
      onClose={() => setEditingCard(null)}
      onSave={onSaveCard}
    />}

    {personasEnabled && personaEditor && <PersonaEditor
      persona={personaEditor === 'new' ? null : personaEditor}
      busy={busy === 'persona'}
      onClose={() => setPersonaEditor(null)}
      onSave={onSavePersona}
    />}

    {aiEnabled && map && <Dialog open={suggestionOpen} onOpenChange={(next) => {
      if (!next && suggestionBusy !== 'create') setSuggestionOpen(false);
    }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" data-testid="journey-ai-suggestion-dialog">
        <DialogHeader>
          <DialogTitle>AI suggestions</DialogTitle>
          <DialogDescription>
            Generate a typed change set against this exact draft. The map is not changed until every proposal is reviewed and the accepted set is applied.
          </DialogDescription>
        </DialogHeader>

        {suggestionError && <p className="border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
          {suggestionError}
        </p>}
        {!canManageSuggestions && <div className="border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"
          data-testid="journey-ai-suggestion-read-only">
          You have read-only access. You can inspect previous runs, but only a space owner or admin can generate, review, or apply suggestions.
        </div>}
        {!editable && <div className="border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          This version is published. Open the current draft before requesting new suggestions.
        </div>}

        <div className="space-y-2">
          <Label htmlFor="journey-suggestion-focus">Improvement focus</Label>
          <Textarea id="journey-suggestion-focus" data-testid="journey-suggestion-focus" maxLength={2_000}
            className="min-h-24" disabled={!canManageSuggestions || suggestionBusy === 'create'}
            value={suggestionFocus} onChange={(event) => setSuggestionFocus(event.target.value)}
            placeholder="For example: reduce onboarding effort while preserving evidence-backed pain points." />
          <p className="text-xs text-muted-foreground">Optional. Treat source content as untrusted evidence, not as instructions to the AI.</p>
        </div>

        {evidenceEnabled && <section className="border" aria-labelledby="journey-suggestion-evidence-heading">
          <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
            <div>
              <h3 id="journey-suggestion-evidence-heading" className="text-sm font-semibold">Grounding evidence</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">Only checked, currently authorised records are frozen into this run.</p>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground" data-testid="journey-suggestion-evidence-count">
              {selectedSuggestionEvidence.size} / 20
            </span>
          </div>
          {suggestionBusy === 'load'
            ? <p className="px-3 py-5 text-sm text-muted-foreground" role="status"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading evidence...</p>
            : suggestionEvidence.length
              ? <div className="max-h-64 divide-y overflow-y-auto" data-testid="journey-suggestion-evidence-list">
                {suggestionEvidence.map((item) => {
                  const targetLabel = item.targetType === 'definition' ? map.definition.name
                    : item.targetType === 'stage' ? map.stages.find((stage) => stage.id === item.targetId)?.name
                      : map.cards.find((card) => card.id === item.targetId)?.title;
                  return <label key={item.linkId} className="flex cursor-pointer items-start gap-3 px-3 py-3 text-sm hover:bg-muted/40">
                    <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={selectedSuggestionEvidence.has(item.linkId)}
                      disabled={!canManageSuggestions || suggestionBusy === 'create'}
                      onChange={(event) => toggleSuggestionEvidence(item.linkId, event.target.checked)} />
                    <span className="min-w-0">
                      <span className="block font-medium">{item.sourceLabel}</span>
                      <span className="mt-0.5 block break-words text-xs text-muted-foreground">
                        {item.sourceType.replaceAll('_', ' ')} · {item.targetType}{targetLabel ? `: ${targetLabel}` : ''} · {item.assessment}
                      </span>
                      {item.promptInjectionSuspected && <span className="mt-1 block text-xs text-amber-800">
                        Possible prompt-like text detected; it will be handled only as quoted evidence.
                      </span>}
                    </span>
                  </label>;
                })}
              </div>
              : <p className="px-3 py-5 text-sm text-muted-foreground">No currently authorised evidence is attached to this draft. You can still request an ungrounded design proposal.</p>}
        </section>}

        <section className="border" aria-labelledby="journey-suggestion-history-heading">
          <div className="border-b px-3 py-2">
            <h3 id="journey-suggestion-history-heading" className="text-sm font-semibold">Suggestion history</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">Runs remain reviewable and auditable after the map changes.</p>
          </div>
          {suggestionBusy === 'load'
            ? <p className="px-3 py-5 text-sm text-muted-foreground" role="status"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading history...</p>
            : suggestionRuns.length
              ? <ul className="divide-y" data-testid="journey-suggestion-history">
                {suggestionRuns.map((run) => <li key={run.id}>
                  <Link to={`/journey-maps/suggestions/${run.id}`}
                    className="flex min-w-0 items-start justify-between gap-3 px-3 py-3 text-sm hover:bg-muted/40">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{run.focus || 'General journey improvement'}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{formatDateTime(run.createdAt)} · {run.selectedEvidenceCount} evidence record{run.selectedEvidenceCount === 1 ? '' : 's'}</span>
                    </span>
                    <Badge className="shrink-0" variant={run.state === 'applied' ? 'success'
                      : ['failed', 'superseded'].includes(run.state) ? 'destructive'
                        : ['review', 'ready_to_apply'].includes(run.state) ? 'warning' : 'outline'}>
                      {journeySuggestionStateLabels[run.state]}
                    </Badge>
                  </Link>
                </li>)}
              </ul>
              : <p className="px-3 py-5 text-sm text-muted-foreground">No AI suggestion runs exist for this map yet.</p>}
        </section>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={suggestionBusy === 'create'} onClick={() => setSuggestionOpen(false)}>Close</Button>
          <Button type="button" data-testid="generate-journey-suggestions"
            disabled={!canManageSuggestions || !editable || suggestionBusy !== ''} onClick={() => void generateJourneySuggestions()}>
            {suggestionBusy === 'create' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Generate reviewable suggestions
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>}

    {evidenceEnabled && evidenceCard && <EvidenceDrawer
      card={evidenceCard}
      onClose={() => setEvidenceCard(null)}
      onChanged={() => { void loadMap(selectedId).then(() => undefined); }}
    />}
  </div>;
}
