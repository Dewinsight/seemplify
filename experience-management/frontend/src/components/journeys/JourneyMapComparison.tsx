import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Loader2, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { compareJourneyMaps, type JourneyComparisonChange, type JourneyComparisonMatch } from '@/lib/journeyMapComparison';
import {
  cardKindLabels, evidenceStateLabels, journeyModeLabels, laneLabels, readJourneyMap,
  type JourneyDefinitionSummary, type JourneyMapCard, type JourneyMapReadModel, type JourneyMapStage
} from '@/lib/journeyMaps';

type ComparisonScope = 'versions' | 'maps';

const mapTypeLabels: Record<string, string> = {
  current_state: 'Current state', future_state: 'Future state', ideal_state: 'Ideal state',
  service_blueprint: 'Service blueprint'
};

const changeLabels: Record<JourneyComparisonChange, string> = {
  added: 'Added', removed: 'Removed', changed: 'Changed', reordered: 'Reordered'
};

const matchLabels: Record<JourneyComparisonMatch, string> = {
  stage_key: 'Exact stage key',
  card_id: 'Exact card ID',
  exact_content: 'Unique exact content',
  structural_slot: 'Exact structural slot; identity unavailable',
  unmatched: 'Unmatched; kept separate'
};

function readableField(field: string) {
  const labels: Record<string, string> = {
    name: 'name', goal: 'goal', description: 'description', kind: 'kind', title: 'title', content: 'details',
    status: 'status', origin: 'origin', personaId: 'persona', evidence: 'evidence', evidenceLinkCount: 'evidence links'
  };
  return labels[field] || field.replaceAll('_', ' ');
}

function TruthCard({ side, map }: { side: 'From' | 'To'; map: JourneyMapReadModel }) {
  const mode = journeyModeLabels[map.version.mode];
  return <section className="border bg-background p-4" data-testid={`compare-${side.toLowerCase()}-truth`}>
    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{side}</p>
    <div className="mt-2 flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">{map.definition.name}</h3>
      <Badge variant={map.version.mode === 'designed' ? 'warning' : 'success'}>{mode.label}</Badge></div>
    <div className="mt-2 flex flex-wrap gap-2 text-xs"><Badge variant="outline">{mapTypeLabels[map.version.mapType]}</Badge>
      <Badge variant="outline">v{map.version.versionNumber} · {map.version.state}</Badge></div>
    <p className="mt-2 text-xs leading-5 text-muted-foreground">{mode.description}</p>
    <dl className="mt-3 grid gap-1 border-t pt-3 text-[11px] sm:grid-cols-[88px_minmax(0,1fr)]">
      <dt className="text-muted-foreground">Definition ID</dt><dd className="break-all font-mono">{map.definition.id}</dd>
      <dt className="text-muted-foreground">Version ID</dt><dd className="break-all font-mono">{map.version.id}</dd>
    </dl>
  </section>;
}

function ChangeBadges({ changes }: { changes: JourneyComparisonChange[] }) {
  return <div className="flex flex-wrap gap-1">{changes.map((change) => <Badge variant={
    change === 'added' ? 'success' : change === 'removed' ? 'destructive' : change === 'changed' ? 'warning' : 'outline'
  } key={change}>{changeLabels[change]}</Badge>)}</div>;
}

function Summary({ title, values, testId }: {
  title: string;
  values: Record<JourneyComparisonChange, number>;
  testId: string;
}) {
  return <div className="border bg-background p-4" data-testid={testId}><h3 className="text-sm font-semibold">{title}</h3>
    <dl className="mt-3 grid grid-cols-4 gap-3">{(['added', 'removed', 'changed', 'reordered'] as const).map((change) => <div key={change}>
      <dt className="text-[11px] text-muted-foreground">{changeLabels[change]}</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{values[change]}</dd>
    </div>)}</dl>
  </div>;
}

function stageDescription(stage: JourneyMapStage | null) {
  if (!stage) return 'Not present';
  return `${stage.name} · position ${stage.ordinal + 1}${stage.goal ? ` · ${stage.goal}` : ''}`;
}

function cardDescription(card: JourneyMapCard | null, map: JourneyMapReadModel) {
  if (!card) return 'Not present';
  const stage = map.stages.find((item) => item.stageKey === card.stageKey);
  return `${card.title} · ${stage?.name || card.stageKey} / ${laneLabels[card.laneType] || card.laneType} / position ${card.ordinal + 1}`;
}

function personaName(card: JourneyMapCard | null, map: JourneyMapReadModel) {
  if (!card) return '—';
  if (!card.personaId) return 'Shared';
  return map.personas.find((persona) => persona.id === card.personaId)?.name || `Unmatched persona ${card.personaId}`;
}

export function JourneyMapComparison({ currentMap, definitions, personasEnabled, evidenceEnabled, savedComparisonMap }: {
  currentMap: JourneyMapReadModel;
  definitions: JourneyDefinitionSummary[];
  personasEnabled: boolean;
  evidenceEnabled: boolean;
  savedComparisonMap?: JourneyMapReadModel | null;
}) {
  const [scope, setScope] = useState<ComparisonScope>('versions');
  const [fromVersionId, setFromVersionId] = useState('');
  const [toVersionId, setToVersionId] = useState('');
  const [targetDefinitionId, setTargetDefinitionId] = useState('');
  const [maps, setMaps] = useState<{ from: JourneyMapReadModel; to: JourneyMapReadModel } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  const versions = useMemo(() => [...currentMap.versions].sort((left, right) => left.versionNumber - right.versionNumber),
    [currentMap.versions]);
  const targetDefinitions = useMemo(() => currentMap.version.mapType === 'current_state'
    ? definitions.filter((definition) => definition.id !== currentMap.definition.id
      && ['future_state', 'ideal_state'].includes(definition.mapType) && Boolean(definition.currentVersionId))
    : [], [currentMap.definition.id, currentMap.version.mapType, definitions]);
  const targetDefinition = targetDefinitions.find((definition) => definition.id === targetDefinitionId) || null;

  useEffect(() => {
    if (savedComparisonMap) {
      setScope('maps');
      setTargetDefinitionId(savedComparisonMap.definition.id);
      return;
    }
    const displayed = versions.find((version) => version.id === currentMap.version.id) || versions.at(-1);
    const earlier = [...versions].reverse().find((version) => version.id !== displayed?.id);
    setToVersionId(displayed?.id || '');
    setFromVersionId(earlier?.id || '');
    setTargetDefinitionId(targetDefinitions[0]?.id || '');
    setScope('versions');
  }, [currentMap.definition.id, currentMap.version.id, savedComparisonMap, targetDefinitions, versions]);

  useEffect(() => {
    let active = true;
    let request: Promise<[JourneyMapReadModel, JourneyMapReadModel]> | null = null;
    if (savedComparisonMap) {
      setMaps({ from: currentMap, to: savedComparisonMap });
      setLoading(false);
      setError('');
      return () => { active = false; };
    } else if (scope === 'versions' && fromVersionId && toVersionId && fromVersionId !== toVersionId) {
      request = Promise.all([
        readJourneyMap(currentMap.definition.id, fromVersionId),
        readJourneyMap(currentMap.definition.id, toVersionId)
      ]);
    } else if (scope === 'maps' && targetDefinition?.currentVersionId) {
      request = Promise.all([
        readJourneyMap(currentMap.definition.id, currentMap.version.id),
        readJourneyMap(targetDefinition.id, targetDefinition.currentVersionId)
      ]);
    }
    if (!request) {
      setMaps(null);
      setLoading(false);
      setError('');
      return () => { active = false; };
    }
    setLoading(true);
    setError('');
    setMaps(null);
    void request.then(([from, to]) => {
      if (active) setMaps({ from, to });
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : 'The selected comparison could not be loaded.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [currentMap, fromVersionId, reload, savedComparisonMap, scope, targetDefinition?.currentVersionId,
    targetDefinition?.id, toVersionId]);

  const comparison = useMemo(() => maps ? compareJourneyMaps(maps.from, maps.to, {
    includePersonas: personasEnabled, includeEvidence: evidenceEnabled
  }) : null, [evidenceEnabled, maps, personasEnabled]);
  const differenceCount = comparison ? comparison.stages.length + comparison.cards.length : 0;

  return <div className="space-y-5" data-testid="journey-map-comparison">
    <div className="flex flex-col justify-between gap-4 border p-4 sm:flex-row sm:items-start">
      <div><div className="flex items-center gap-2"><ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Compare exact journey structure</h2></div>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
          Read-only comparison of explicit definitions and versions. Unmatched content stays separate; titles are never fuzzy-matched.
        </p></div>
      {!savedComparisonMap && <div className="flex shrink-0 gap-1" role="tablist" aria-label="Comparison scope">
        <Button type="button" size="sm" variant={scope === 'versions' ? 'secondary' : 'ghost'} role="tab"
          aria-selected={scope === 'versions'} data-testid="compare-scope-versions" onClick={() => setScope('versions')}>
          Versions
        </Button>
        <Button type="button" size="sm" variant={scope === 'maps' ? 'secondary' : 'ghost'} role="tab"
          aria-selected={scope === 'maps'} data-testid="compare-scope-maps" disabled={!targetDefinitions.length}
          onClick={() => setScope('maps')}>Current vs future</Button>
      </div>}
    </div>

    {savedComparisonMap && <div className="border px-4 py-3 text-xs text-muted-foreground" role="status"
      data-testid="saved-view-comparison-target">
      Exact saved target: {savedComparisonMap.definition.name} · version {savedComparisonMap.version.versionNumber} · {savedComparisonMap.version.id}
    </div>}

    {!savedComparisonMap && (scope === 'versions' ? versions.length < 2
      ? <div className="border px-5 py-10 text-center"><h3 className="text-sm font-semibold">A second version is needed</h3>
        <p className="mt-1 text-xs text-muted-foreground">Publish or create another version before comparing this definition over time.</p></div>
      : <div className="grid gap-4 sm:grid-cols-2">
        <div><Label htmlFor="comparison-from-version">From version</Label><select id="comparison-from-version"
          data-testid="compare-from-version" className="mt-1 h-9 w-full border border-input bg-background px-3 text-sm"
          value={fromVersionId} onChange={(event) => setFromVersionId(event.target.value)}>
          {versions.map((version) => <option key={version.id} value={version.id} disabled={version.id === toVersionId}>
            v{version.versionNumber} · {version.state} · {version.id}
          </option>)}</select></div>
        <div><Label htmlFor="comparison-to-version">To version</Label><select id="comparison-to-version"
          data-testid="compare-to-version" className="mt-1 h-9 w-full border border-input bg-background px-3 text-sm"
          value={toVersionId} onChange={(event) => setToVersionId(event.target.value)}>
          {versions.map((version) => <option key={version.id} value={version.id} disabled={version.id === fromVersionId}>
            v{version.versionNumber} · {version.state} · {version.id}
          </option>)}</select></div>
      </div>
      : targetDefinitions.length === 0
        ? <div className="border px-5 py-10 text-center"><h3 className="text-sm font-semibold">No future journey is available</h3>
          <p className="mt-1 text-xs text-muted-foreground">This requires a selected current-state map and another future-state or ideal-state map in the space.</p></div>
        : <div className="grid gap-4 sm:grid-cols-2 sm:items-end">
          <div><p className="text-xs font-medium">Current-state source</p><p className="mt-2 text-sm">{currentMap.definition.name}</p>
            <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{currentMap.definition.id} / {currentMap.version.id}</p></div>
          <div><Label htmlFor="comparison-target-map">Future or ideal map</Label><select id="comparison-target-map"
            data-testid="compare-target-map" className="mt-1 h-9 w-full border border-input bg-background px-3 text-sm"
            value={targetDefinitionId} onChange={(event) => setTargetDefinitionId(event.target.value)}>
            {targetDefinitions.map((definition) => <option value={definition.id} key={definition.id}>
              {definition.name} · {mapTypeLabels[definition.mapType]} · {definition.currentVersionId}
            </option>)}</select></div>
        </div>)}

    {loading && <div className="flex items-center gap-2 border px-4 py-8 text-sm text-muted-foreground" role="status">
      <Loader2 className="h-4 w-4 animate-spin" />Loading both exact versions…
    </div>}
    {error && <div className="flex flex-wrap items-center justify-between gap-3 border border-destructive/35 bg-destructive/5 p-4"
      role="alert"><p className="text-sm text-destructive">{error}</p><Button type="button" size="sm" variant="outline"
        onClick={() => setReload((value) => value + 1)}><RefreshCw className="mr-2 h-4 w-4" />Retry</Button></div>}

    {maps && comparison && <>
      <div className="grid gap-4 lg:grid-cols-2"><TruthCard side="From" map={maps.from} /><TruthCard side="To" map={maps.to} /></div>
      <div className="grid gap-4 sm:grid-cols-2"><Summary title="Stage changes" values={comparison.summary.stages}
        testId="compare-stage-summary" /><Summary title="Card changes" values={comparison.summary.cards}
        testId="compare-card-summary" /></div>

      {differenceCount === 0 ? <div className="border px-5 py-10 text-center" data-testid="comparison-empty">
        <h3 className="text-sm font-semibold">No structural differences</h3>
        <p className="mt-1 text-xs text-muted-foreground">The selected versions have the same visible stages and cards under exact matching.</p>
      </div> : <div className="space-y-5" data-testid="comparison-differences">
        <section className="overflow-x-auto border" aria-labelledby="stage-differences-heading">
          <div className="border-b px-4 py-3"><h3 id="stage-differences-heading" className="text-sm font-semibold">Stage outline</h3></div>
          <table className="w-full min-w-[760px] border-collapse text-sm"><caption className="sr-only">
            Added, removed, changed, and reordered stages matched only by exact stage key.</caption>
            <thead><tr className="bg-muted/40 text-left text-xs"><th scope="col" className="border-b p-3">Change</th>
              <th scope="col" className="border-b p-3">Stage key</th><th scope="col" className="border-b p-3">From</th>
              <th scope="col" className="border-b p-3">To</th><th scope="col" className="border-b p-3">Match basis</th></tr></thead>
            <tbody>{comparison.stages.map((difference) => <tr key={`${difference.key}-${difference.changes.join('-')}`}>
              <td className="border-b p-3 align-top"><ChangeBadges changes={difference.changes} /></td>
              <td className="border-b p-3 align-top font-mono text-xs">{difference.key}</td>
              <td className="border-b p-3 align-top text-xs">{stageDescription(difference.before)}</td>
              <td className="border-b p-3 align-top text-xs">{stageDescription(difference.after)}
                {difference.changedFields.length > 0 && <span className="mt-1 block text-muted-foreground">
                  Changed: {difference.changedFields.map(readableField).join(', ')}</span>}</td>
              <td className="border-b p-3 align-top text-xs text-muted-foreground">{matchLabels[difference.match]}</td>
            </tr>)}
            {!comparison.stages.length && <tr><td colSpan={5} className="p-4 text-center text-xs text-muted-foreground">No stage differences.</td></tr>}</tbody>
          </table>
        </section>

        <section className="overflow-x-auto border" aria-labelledby="card-differences-heading">
          <div className="border-b px-4 py-3"><h3 id="card-differences-heading" className="text-sm font-semibold">Card outline</h3></div>
          <table className="w-full min-w-[920px] border-collapse text-sm"><caption className="sr-only">
            Card differences using only exact IDs, unique exact content, or exact structural slots. Unmatched cards remain separate.</caption>
            <thead><tr className="bg-muted/40 text-left text-xs"><th scope="col" className="border-b p-3">Change</th>
              <th scope="col" className="border-b p-3">From</th><th scope="col" className="border-b p-3">To</th>
              <th scope="col" className="border-b p-3">Match basis</th>
              {personasEnabled && <th scope="col" className="border-b p-3">Persona</th>}
              {evidenceEnabled && <th scope="col" className="border-b p-3">Evidence</th>}</tr></thead>
            <tbody>{comparison.cards.map((difference, index) => <tr key={`${difference.key}-${difference.changes.join('-')}-${index}`}>
              <td className="border-b p-3 align-top"><ChangeBadges changes={difference.changes} /></td>
              <td className="border-b p-3 align-top text-xs">{cardDescription(difference.before, maps.from)}
                {difference.before && <span className="mt-1 block break-all font-mono text-[10px] text-muted-foreground">{difference.before.id}</span>}</td>
              <td className="border-b p-3 align-top text-xs">{cardDescription(difference.after, maps.to)}
                {difference.after && <span className="mt-1 block break-all font-mono text-[10px] text-muted-foreground">{difference.after.id}</span>}
                {difference.changedFields.length > 0 && <span className="mt-1 block text-muted-foreground">
                  Changed: {difference.changedFields.map(readableField).join(', ')}</span>}</td>
              <td className="border-b p-3 align-top text-xs text-muted-foreground">{matchLabels[difference.match]}</td>
              {personasEnabled && <td className="border-b p-3 align-top text-xs">{personaName(difference.before, maps.from)} → {personaName(difference.after, maps.to)}</td>}
              {evidenceEnabled && <td className="border-b p-3 align-top text-xs">{
                difference.before ? evidenceStateLabels[difference.before.evidence.state].label : '—'} → {
                difference.after ? evidenceStateLabels[difference.after.evidence.state].label : '—'}</td>}
            </tr>)}
            {!comparison.cards.length && <tr><td colSpan={4 + Number(personasEnabled) + Number(evidenceEnabled)}
              className="p-4 text-center text-xs text-muted-foreground">No card differences.</td></tr>}</tbody>
          </table>
        </section>
      </div>}
    </>}
  </div>;
}
