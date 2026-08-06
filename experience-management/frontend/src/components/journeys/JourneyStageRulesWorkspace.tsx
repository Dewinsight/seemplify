import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ChevronRight, CircleDot, FlaskConical, Loader2, Plus, RefreshCw, Trash2
} from 'lucide-react';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api';
import { useAuthSession } from '@/lib/authSessionContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  listJourneyEventSchemas, listJourneyEventSources, type JourneyEventEnvironment,
  type JourneyEventPropertyDefinition, type JourneyEventSchema, type JourneyEventSource
} from '@/lib/journeyEventControlPlane';
import { readJourneyMap, type JourneyMapReadModel } from '@/lib/journeyMaps';
import {
  compatibleEventNames, compatibleOperationalProperties, createJourneyStageRule,
  journeyStageRuleRoles, listJourneyAnonymousInstances, listJourneyStageRules,
  publishJourneyStageRule, readJourneyAnonymousInstance, readJourneyStageAggregates,
  readJourneyStageDecision, retireJourneyStageRule, simulateJourneyStageRules,
  updateJourneyStageRuleDraft,
  type JourneyAnonymousInstance, type JourneyAnonymousVisit, type JourneyRuleScalar,
  type JourneyStageAggregates, type JourneyStageDecision, type JourneyStagePredicate,
  type JourneyStagePredicateOperator, type JourneyStageRuleDefinition, type JourneyStageRuleDraftInput,
  type JourneyStageRuleLimits, type JourneyStageRuleSimulation, type JourneyStageRuleVersion
} from '@/lib/journeyStageRules';
import { formatDateTime } from '@/lib/utils';

type RuleSaveState = 'clean' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'error';
type OperationalTab = 'rules' | 'simulate' | 'observed';

const environments: JourneyEventEnvironment[] = ['development', 'staging', 'production'];
const numericOperators: JourneyStagePredicateOperator[] = [
  'equals', 'not_equals', 'in', 'greater_than', 'at_least', 'less_than', 'at_most', 'exists'
];
const scalarOperators: JourneyStagePredicateOperator[] = ['equals', 'not_equals', 'in', 'exists'];
const forbiddenSimulationProperty = /(?:^|_)(?:prompt|body|content|document|transcript|password|secret|token|credential|access_token|refresh_token|email|phone|name|address|survey_response|raw_payload)(?:_|$)/u;

function message(reason: unknown, fallback: string) {
  if (reason instanceof ApiError) return reason.message;
  return reason instanceof Error ? reason.message : fallback;
}

function ruleVersion(rule: JourneyStageRuleDefinition | undefined) {
  if (!rule) return null;
  return rule.versions.find((version) => version.id === rule.draftVersionId)
    || rule.versions.find((version) => version.id === rule.publishedVersionId)
    || rule.versions[0] || null;
}

function toDraft(rule: JourneyStageRuleDefinition, version: JourneyStageRuleVersion): JourneyStageRuleDraftInput {
  return {
    name: rule.name, journeyMapVersionId: version.journeyMapVersionId, stageKey: version.stageKey,
    role: version.role, priority: version.priority, eventName: version.eventName,
    sourceIds: [...version.sourceIds], environments: [...version.environments],
    predicates: version.predicates.map((predicate) => ({ ...predicate,
      value: Array.isArray(predicate.value) ? [...predicate.value] : predicate.value })),
    requiredPriorEvents: version.requiredPriorEvents.map((prior) => ({ ...prior })),
    excludedEventNames: [...version.excludedEventNames], effectiveAt: version.effectiveAt, expiresAt: version.expiresAt
  };
}

function emptyDraft(map: JourneyMapReadModel): JourneyStageRuleDraftInput {
  return {
    name: '', journeyMapVersionId: map.definition.publishedVersionId || map.version.id,
    stageKey: map.stages[0]?.stageKey || '', role: 'entry', priority: 0, eventName: '', sourceIds: [],
    environments: [], predicates: [], requiredPriorEvents: [], excludedEventNames: [], effectiveAt: null, expiresAt: null
  };
}

function dateTimeLocal(value: string | null) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const shifted = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function isoFromLocal(value: string) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function human(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function operatorsFor(property: JourneyEventPropertyDefinition | undefined) {
  if (!property || property.type === 'object' || property.type === 'array') return ['exists'] as JourneyStagePredicateOperator[];
  return property.type === 'number' ? numericOperators : scalarOperators;
}

function parseScalar(value: string, type: JourneyEventPropertyDefinition['type']): JourneyRuleScalar {
  if (type === 'number') return Number(value);
  if (type === 'boolean') return value === 'true';
  return value;
}

function predicateTextValue(predicate: JourneyStagePredicate) {
  return Array.isArray(predicate.value) ? predicate.value.join(', ') : String(predicate.value ?? '');
}

function isSafeSimulationProperty(property: JourneyEventPropertyDefinition) {
  return property.dataClass === 'operational' && !forbiddenSimulationProperty.test(property.name)
    && !['object', 'array'].includes(property.type);
}

function versionLabel(map: JourneyMapReadModel, versionId: string) {
  const version = map.versions.find((item) => item.id === versionId);
  return version ? `Version ${version.versionNumber} / ${human(version.state)}` : versionId;
}

function RuleState({ rule }: { rule: JourneyStageRuleDefinition }) {
  return <div className="flex flex-wrap gap-1">
    {rule.draftVersionId && <Badge variant="warning">Draft</Badge>}
    {rule.publishedVersionId && <Badge variant="success">Published</Badge>}
    {!rule.draftVersionId && !rule.publishedVersionId && <Badge variant="secondary">Retired</Badge>}
    <span className="text-xs text-muted-foreground">Revision {rule.revision}</span>
  </div>;
}

function SourceSelector({ sources, value, onChange, disabled }: {
  sources: JourneyEventSource[]; value: string[]; onChange: (next: string[]) => void; disabled?: boolean;
}) {
  return <fieldset className="space-y-2" disabled={disabled}>
    <legend className="text-sm font-medium">Event sources</legend>
    <p className="text-xs leading-5 text-muted-foreground">
      Select every source this rule may evaluate. The environment is shown from the source record.
    </p>
    <div className="grid gap-2 sm:grid-cols-2" data-testid="rule-source-selector">
      {sources.map((source) => <label key={source.id}
        className="flex min-w-0 cursor-pointer items-start gap-2 border bg-background p-2.5 text-sm focus-within:ring-2 focus-within:ring-ring">
        <input type="checkbox" className="mt-0.5 h-4 w-4" checked={value.includes(source.id)}
          disabled={disabled || (!value.includes(source.id) && value.length >= 100)}
          onChange={(event) => onChange(event.target.checked
            ? [...value, source.id] : value.filter((id) => id !== source.id))} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{source.name}</span>
          <span className="block text-xs text-muted-foreground">
            {human(source.environment)} / {human(source.status)} / {source.activeSchemaCount} published schema{source.activeSchemaCount === 1 ? '' : 's'}
          </span>
        </span>
      </label>)}
      {!sources.length && <p className="text-sm text-muted-foreground">No event sources exist in this space.</p>}
    </div>
  </fieldset>;
}

function PredicateEditor({ predicates, properties, limit, onChange, disabled }: {
  predicates: JourneyStagePredicate[]; properties: JourneyEventPropertyDefinition[]; limit: number;
  onChange: (next: JourneyStagePredicate[]) => void; disabled?: boolean;
}) {
  const update = (index: number, next: JourneyStagePredicate) => onChange(predicates.map((item, position) =>
    position === index ? next : item));
  return <fieldset className="space-y-2" disabled={disabled} data-testid="predicate-builder">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <legend className="text-sm font-medium">Operational predicates</legend>
        <p className="text-xs leading-5 text-muted-foreground">
          Only operational properties shared by every selected source's published schema are available.
        </p>
      </div>
      <Button type="button" size="sm" variant="outline" data-testid="add-predicate"
        disabled={!properties.length || predicates.length >= limit || disabled}
        onClick={() => {
          const property = properties[0]!; const existenceOnly = property.type === 'object' || property.type === 'array';
          onChange([...predicates, { path: property.name, operator: existenceOnly ? 'exists' : 'equals', value:
            existenceOnly ? true : property.type === 'number' ? 0 : property.type === 'boolean' ? true : '' }]);
        }}>
        <Plus className="mr-1 h-4 w-4" />Add condition
      </Button>
    </div>
    {predicates.map((predicate, index) => {
      const property = properties.find((candidate) => candidate.name === predicate.path);
      const operators = operatorsFor(property);
      return <div key={`${index}-${predicate.path}`} className="grid gap-2 border p-2.5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto]">
        <div><Label htmlFor={`predicate-property-${index}`} className="text-xs">Property</Label>
          <select id={`predicate-property-${index}`} data-testid={`predicate-property-${index}`}
            className="mt-1 h-9 w-full border bg-background px-2 text-sm" value={predicate.path}
            onChange={(event) => {
              const nextProperty = properties.find((candidate) => candidate.name === event.target.value)!;
              const existenceOnly = nextProperty.type === 'object' || nextProperty.type === 'array';
              update(index, { path: nextProperty.name, operator: existenceOnly ? 'exists' : 'equals',
                value: existenceOnly ? true : nextProperty.type === 'number' ? 0 : nextProperty.type === 'boolean' ? true : '' });
            }}>
            {!property && <option value={predicate.path}>{predicate.path} / unavailable</option>}
            {properties.map((candidate) => <option key={candidate.name} value={candidate.name}>
              {candidate.name} / {candidate.type}
            </option>)}
          </select></div>
        <div><Label htmlFor={`predicate-operator-${index}`} className="text-xs">Operator</Label>
          <select id={`predicate-operator-${index}`} className="mt-1 h-9 w-full border bg-background px-2 text-sm"
            value={predicate.operator} onChange={(event) => {
              const operator = event.target.value as JourneyStagePredicateOperator;
              update(index, { ...predicate, operator, value: operator === 'exists' ? true
                : operator === 'in' ? [predicate.value as JourneyRuleScalar ?? ''] : predicate.value });
            }}>
            {operators.map((operator) => <option key={operator} value={operator}>{human(operator)}</option>)}
          </select></div>
        <div><Label htmlFor={`predicate-value-${index}`} className="text-xs">Value</Label>
          {predicate.operator === 'exists' ? <select id={`predicate-value-${index}`}
            className="mt-1 h-9 w-full border bg-background px-2 text-sm" value={predicate.value === false ? 'false' : 'true'}
            onChange={(event) => update(index, { ...predicate, value: event.target.value === 'true' })}>
            <option value="true">Property exists</option><option value="false">Property does not exist</option>
          </select> : property?.type === 'boolean' && predicate.operator !== 'in' ? <select id={`predicate-value-${index}`}
            className="mt-1 h-9 w-full border bg-background px-2 text-sm" value={String(predicate.value)}
            onChange={(event) => update(index, { ...predicate, value: event.target.value === 'true' })}>
            <option value="true">True</option><option value="false">False</option>
          </select> : property?.enumValues?.length && predicate.operator !== 'in' ? <select id={`predicate-value-${index}`}
            className="mt-1 h-9 w-full border bg-background px-2 text-sm" value={String(predicate.value ?? '')}
            onChange={(event) => update(index, { ...predicate, value: parseScalar(event.target.value, property.type) })}>
            {property.enumValues.map((value) => <option key={String(value)} value={String(value)}>{String(value)}</option>)}
          </select> : <Input id={`predicate-value-${index}`} value={predicateTextValue(predicate)}
            type={property?.type === 'number' && predicate.operator !== 'in' ? 'number' : 'text'}
            maxLength={property?.type === 'string' ? Math.min(500, property.maximumLength || 500) : undefined}
            placeholder={predicate.operator === 'in' ? 'Comma-separated values' : undefined}
            onChange={(event) => update(index, { ...predicate, value: predicate.operator === 'in'
              ? event.target.value.split(',').map((item) => item.trim()).filter(Boolean)
                .map((item) => parseScalar(item, property?.type || 'string'))
              : parseScalar(event.target.value, property?.type || 'string') })} />}</div>
        <Button type="button" variant="ghost" size="sm" className="self-end" aria-label={`Remove predicate ${index + 1}`}
          onClick={() => onChange(predicates.filter((_item, position) => position !== index))}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>;
    })}
    {!predicates.length && <p className="border border-dashed p-3 text-sm text-muted-foreground">
      No property conditions. Event, source, environment, time, and prior-event controls still apply.
    </p>}
  </fieldset>;
}

function TraceView({ result, stageName }: {
  result: JourneyStageRuleSimulation; stageName: (key: string) => string;
}) {
  return <div className="space-y-3" data-testid="simulation-trace" aria-live="polite">
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant={result.matches.length ? 'success' : 'secondary'}>
        {result.matches.length} matched rule{result.matches.length === 1 ? '' : 's'}
      </Badge>
      <span className="text-xs text-muted-foreground">{result.traces.length} rules evaluated</span>
    </div>
    <div className="overflow-x-auto border">
      <table className="min-w-[720px] w-full text-left text-sm">
        <thead className="bg-muted/50 text-xs text-muted-foreground"><tr>
          <th className="px-3 py-2 font-medium">Outcome</th><th className="px-3 py-2 font-medium">Stage / role</th>
          <th className="px-3 py-2 font-medium">Version</th><th className="px-3 py-2 font-medium">Priority</th>
          <th className="px-3 py-2 font-medium">Trace reasons</th>
        </tr></thead>
        <tbody>{result.traces.map((trace) => <tr key={`${trace.ruleId}-${trace.ruleVersion}`} className="border-t align-top">
          <td className="px-3 py-2"><span className={trace.matched ? 'text-emerald-700' : 'text-muted-foreground'}>
            {trace.matched ? 'Matched' : 'Not matched'}</span></td>
          <td className="px-3 py-2"><span className="font-medium">{stageName(trace.stageKey)}</span>
            <span className="block text-xs text-muted-foreground">{human(trace.role)}</span></td>
          <td className="px-3 py-2 tabular-nums">{trace.ruleVersion}</td><td className="px-3 py-2 tabular-nums">{trace.priority}</td>
          <td className="px-3 py-2"><ul className="space-y-1">{trace.reasons.map((reason) =>
            <li key={reason} className="font-mono text-xs">{reason}</li>)}</ul></td>
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}

export function JourneyStageRulesWorkspace({ map, onConnectedChange }: {
  map: JourneyMapReadModel; onConnectedChange?: () => void;
}) {
  const session = useAuthSession();
  const canManage = Boolean(session?.activeSpace && session.activeSpace.role !== 'member');
  const [tab, setTab] = useState<OperationalTab>('rules');
  const [rules, setRules] = useState<JourneyStageRuleDefinition[]>([]);
  const [limits, setLimits] = useState<JourneyStageRuleLimits>({ rules: 500, predicates: 20, priorEvents: 20, history: 10_000 });
  const [sources, setSources] = useState<JourneyEventSource[]>([]);
  const [schemasBySource, setSchemasBySource] = useState<Record<string, JourneyEventSchema[]>>({});
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [targetMap, setTargetMap] = useState<JourneyMapReadModel>(map);
  const [selectedRuleId, setSelectedRuleId] = useState('');
  const [draft, setDraft] = useState<JourneyStageRuleDraftInput>(() => emptyDraft(map));
  const [saveState, setSaveState] = useState<RuleSaveState>('clean');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [aggregates, setAggregates] = useState<JourneyStageAggregates>({ total: 0, byState: {}, byStage: {} });
  const [instances, setInstances] = useState<JourneyAnonymousInstance[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<{ instance: JourneyAnonymousInstance; visits: JourneyAnonymousVisit[] } | null>(null);
  const [decision, setDecision] = useState<JourneyStageDecision | null>(null);
  const [simSourceId, setSimSourceId] = useState('');
  const [simEventName, setSimEventName] = useState('');
  const [simMessageId, setSimMessageId] = useState(() => `simulation-${crypto.randomUUID()}`);
  const [simSubjectId, setSimSubjectId] = useState('anonymous-simulation-subject');
  const [simTimestamp, setSimTimestamp] = useState(() => dateTimeLocal(new Date().toISOString()));
  const [simProperties, setSimProperties] = useState<Record<string, unknown>>({});
  const [simHistory, setSimHistory] = useState<Array<{ eventName: string; timestamp: string }>>([]);
  const [useDrafts, setUseDrafts] = useState(true);
  const [simulation, setSimulation] = useState<JourneyStageRuleSimulation | null>(null);
  const [simulationError, setSimulationError] = useState('');

  const selectedRule = rules.find((rule) => rule.id === selectedRuleId);
  const selectedVersion = ruleVersion(selectedRule);
  const activeSources = sources.filter((source) => source.status === 'active');
  const selectedSources = draft.sourceIds.map((id) => sources.find((source) => source.id === id)).filter(Boolean) as JourneyEventSource[];

  const loadOperations = useCallback(async () => {
    const [aggregateResult, instanceResult] = await Promise.all([
      readJourneyStageAggregates(map.definition.id), listJourneyAnonymousInstances(map.definition.id, 50)
    ]);
    setAggregates(aggregateResult); setInstances(instanceResult.instances);
  }, [map.definition.id]);

  const loadWorkspace = useCallback(async (preserveDraft = false) => {
    setLoading(true);
    try {
      const [ruleResult, sourceResult, aggregateResult, instanceResult] = await Promise.all([
        listJourneyStageRules(map.definition.id), listJourneyEventSources(),
        readJourneyStageAggregates(map.definition.id), listJourneyAnonymousInstances(map.definition.id, 50)
      ]);
      setRules(ruleResult.rules); setLimits(ruleResult.limits); setSources(sourceResult.sources);
      setAggregates(aggregateResult); setInstances(instanceResult.instances); setError('');
      setSimSourceId((current) => sourceResult.sources.some((source) => source.id === current && source.status === 'active')
        ? current : (sourceResult.sources.find((source) => source.status === 'active')?.id || ''));
      if (!preserveDraft) {
        const next = ruleResult.rules[0]; const version = ruleVersion(next);
        setSelectedRuleId(next?.id || '');
        setDraft(next && version ? toDraft(next, version) : emptyDraft(map));
        setSaveState('clean');
      }
    } catch (reason) { setError(message(reason, 'Journey stage rules could not be loaded.')); }
    finally { setLoading(false); }
  }, [map]);

  useEffect(() => { void loadWorkspace(); }, [loadWorkspace]);

  const requiredSchemaSources = useMemo(() => [...new Set([...draft.sourceIds, simSourceId].filter(Boolean))],
    [draft.sourceIds, simSourceId]);
  useEffect(() => {
    const missing = requiredSchemaSources.filter((sourceId) => schemasBySource[sourceId] === undefined);
    if (!missing.length) return;
    let cancelled = false;
    setSchemaLoading(true);
    Promise.all(missing.map(async (sourceId) => [sourceId, (await listJourneyEventSchemas(sourceId)).schemas] as const))
      .then((entries) => { if (!cancelled) setSchemasBySource((current) => ({ ...current, ...Object.fromEntries(entries) })); })
      .catch((reason) => { if (!cancelled) setError(message(reason, 'Published event schemas could not be loaded.')); })
      .finally(() => { if (!cancelled) setSchemaLoading(false); });
    return () => { cancelled = true; };
  }, [requiredSchemaSources, schemasBySource]);

  useEffect(() => {
    let cancelled = false;
    if (draft.journeyMapVersionId === map.version.id) { setTargetMap(map); return; }
    void readJourneyMap(map.definition.id, draft.journeyMapVersionId).then((loaded) => {
      if (!cancelled) setTargetMap(loaded);
    }).catch((reason) => { if (!cancelled) setError(message(reason, 'The selected map version could not be loaded.')); });
    return () => { cancelled = true; };
  }, [draft.journeyMapVersionId, map]);

  const eventNames = useMemo(() => compatibleEventNames(draft.sourceIds, schemasBySource),
    [draft.sourceIds, schemasBySource]);
  const operationalProperties = useMemo(() => compatibleOperationalProperties(draft.sourceIds, draft.eventName, schemasBySource),
    [draft.eventName, draft.sourceIds, schemasBySource]);
  const targetVersionReady = targetMap.version.id === draft.journeyMapVersionId;
  const targetStages = targetVersionReady ? targetMap.stages : [];
  const selectedSchemaBindings = selectedSources.map((source) => {
    const schema = (schemasBySource[source.id] || []).find((candidate) => candidate.eventName === draft.eventName);
    const version = schema?.versions.find((candidate) => candidate.state === 'published') || null;
    return { source, schema, version };
  });
  const priorEventNames = useMemo(() => [...new Set(draft.sourceIds.flatMap((sourceId) =>
    (schemasBySource[sourceId] || []).filter((schema) => schema.versions.some((version) => version.state === 'published'))
      .map((schema) => schema.eventName)))].sort(), [draft.sourceIds, schemasBySource]);
  const simSchemas = useMemo(() => schemasBySource[simSourceId] || [], [schemasBySource, simSourceId]);
  const simEventNames = useMemo(() => simSchemas
    .filter((schema) => schema.versions.some((version) => version.state === 'published'))
    .map((schema) => schema.eventName).sort(), [simSchemas]);
  const simSchema = useMemo(() => simSchemas.find((schema) => schema.eventName === simEventName),
    [simEventName, simSchemas]);
  const simSchemaVersion = simSchema?.versions.find((version) => version.state === 'published') || null;
  const simSource = sources.find((source) => source.id === simSourceId);
  const simPropertiesCatalog = (simSchemaVersion?.properties || []).filter(isSafeSimulationProperty);

  useEffect(() => {
    if (simEventNames.includes(simEventName)) return;
    setSimEventName(simEventNames[0] || ''); setSimProperties({}); setSimulation(null);
  }, [simEventName, simEventNames]);

  function changeDraft(patch: Partial<JourneyStageRuleDraftInput>) {
    setDraft((current) => ({ ...current, ...patch })); setSaveState('dirty'); setError('');
  }

  function changeSources(sourceIds: string[]) {
    const sourceEnvironments = [...new Set(sourceIds.map((id) => sources.find((source) => source.id === id)?.environment)
      .filter(Boolean))] as JourneyEventEnvironment[];
    changeDraft({ sourceIds, environments: draft.environments.filter((environment) => sourceEnvironments.includes(environment)),
      eventName: '', predicates: [] });
  }

  function openRule(rule: JourneyStageRuleDefinition) {
    const version = ruleVersion(rule); if (!version) return;
    setSelectedRuleId(rule.id); setDraft(toDraft(rule, version)); setSaveState('clean'); setError('');
  }

  function beginRule() {
    setSelectedRuleId(''); setDraft(emptyDraft(map)); setSaveState('dirty'); setError('');
  }

  function validationError() {
    if (!draft.name.trim() || !draft.stageKey || !draft.eventName) return 'Name, stage, and event are required.';
    if (!targetStages.some((stage) => stage.stageKey === draft.stageKey)) {
      return 'Choose a real stage from the selected governed map version.';
    }
    if (!draft.sourceIds.length) return 'Select at least one real event source.';
    if (schemaLoading) return 'Wait for the selected sources and schemas to finish loading.';
    if (!eventNames.includes(draft.eventName)) return 'The event needs a published schema on every selected source.';
    if (selectedSources.some((source) => !draft.environments.includes(source.environment))) {
      return 'Include the environment of every selected source.';
    }
    const paths = new Set(operationalProperties.map((property) => property.name));
    if (draft.predicates.some((predicate) => !paths.has(predicate.path))) {
      return 'Remove predicates that are not operational and compatible across every selected schema.';
    }
    for (const predicate of draft.predicates) {
      const property = operationalProperties.find((candidate) => candidate.name === predicate.path)!;
      const values = Array.isArray(predicate.value) ? predicate.value : [predicate.value];
      if (predicate.operator === 'in' && (!Array.isArray(predicate.value) || predicate.value.length < 1 || predicate.value.length > 100)) {
        return `Condition ${predicate.path} needs between 1 and 100 values.`;
      }
      if (predicate.operator !== 'exists' && values.some((value) => value === undefined
          || value === null || (property.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value)))
          || (property.type === 'string' && (typeof value !== 'string'
            || value.length > Math.min(500, property.maximumLength || 500)))
          || (property.type === 'boolean' && typeof value !== 'boolean')
          || (property.enumValues?.length && !property.enumValues.some((allowed) => Object.is(allowed, value))))) {
        return `Condition ${predicate.path} needs a valid ${property.type} value.`;
      }
    }
    if (draft.requiredPriorEvents.some((prior) => !priorEventNames.includes(prior.eventName)
        || (prior.withinSeconds !== null && prior.withinSeconds !== undefined
          && (!Number.isInteger(prior.withinSeconds) || prior.withinSeconds < 0 || prior.withinSeconds > 31_622_400)))) {
      return 'Every required prior event needs a published event name and a window between 0 and 31,622,400 seconds.';
    }
    if (draft.effectiveAt && draft.expiresAt && Date.parse(draft.expiresAt) <= Date.parse(draft.effectiveAt)) {
      return 'The expiry must be later than the effective time.';
    }
    return '';
  }

  async function saveRule() {
    const invalid = validationError(); if (invalid) { setError(invalid); return; }
    setBusy('save'); setSaveState('saving'); setError('');
    try {
      const response = selectedRule
        ? await updateJourneyStageRuleDraft(map.definition.id, selectedRule.id, selectedRule.revision, draft)
        : await createJourneyStageRule(map.definition.id, draft);
      setRules((current) => [response.rule, ...current.filter((rule) => rule.id !== response.rule.id)]);
      setSelectedRuleId(response.rule.id); setSaveState('saved'); toast.success('Rule draft saved.');
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) {
        await loadWorkspace(true); setSaveState('conflict');
        setError('This rule changed on the server. The local draft is retained; review the refreshed revision before retrying.');
      } else { setSaveState('error'); setError(message(reason, 'The rule draft could not be saved.')); }
    } finally { setBusy(''); }
  }

  async function publishRule() {
    if (!canManage || !selectedRule || saveState === 'dirty' || saveState === 'conflict') return;
    if (draft.journeyMapVersionId !== map.definition.publishedVersionId) {
      setError('Publish the map version first, or move this draft to the exact currently published map version.'); return;
    }
    if (selectedSources.some((source) => source.status !== 'active')) {
      setError('Every selected source must be active before this rule can be published.'); return;
    }
    if (!window.confirm('Publish this rule to live event processing? Its immutable version will begin matching accepted events.')) return;
    setBusy('publish'); setError('');
    try {
      const result = await publishJourneyStageRule(map.definition.id, selectedRule.id, selectedRule.revision);
      setRules((current) => [result.rule, ...current.filter((rule) => rule.id !== result.rule.id)]);
      setDraft(toDraft(result.rule, ruleVersion(result.rule)!)); setSaveState('clean');
      toast.success(result.replayed ? 'Rule was already published.' : 'Rule published.'); onConnectedChange?.();
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) { await loadWorkspace(true); setSaveState('conflict'); }
      setError(message(reason, 'The rule could not be published.'));
    } finally { setBusy(''); }
  }

  async function retireRule() {
    if (!canManage || !selectedRule?.publishedVersionId) return;
    if (!window.confirm('Retire the published rule? New events will stop matching it; historical decisions remain intact.')) return;
    setBusy('retire'); setError('');
    try {
      const result = await retireJourneyStageRule(map.definition.id, selectedRule.id, selectedRule.revision);
      setRules((current) => [result.rule, ...current.filter((rule) => rule.id !== result.rule.id)]);
      const version = ruleVersion(result.rule); if (version) setDraft(toDraft(result.rule, version));
      setSaveState('clean'); toast.success(result.replayed ? 'Rule was already retired.' : 'Published rule retired.');
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) { await loadWorkspace(true); setSaveState('conflict'); }
      setError(message(reason, 'The rule could not be retired.'));
    } finally { setBusy(''); }
  }

  async function runSimulation() {
    if (!canManage || !simSource || !simEventName || !simSchemaVersion || !simMessageId.trim() || !simSubjectId.trim()) {
      setSimulationError('Select a source and published schema, then provide message and anonymous subject identifiers.'); return;
    }
    setBusy('simulate'); setSimulationError(''); setSimulation(null);
    try {
      const timestamp = isoFromLocal(simTimestamp);
      if (!timestamp) throw new Error('Choose a valid event timestamp.');
      const history = simHistory.map((prior, index) => ({
        messageId: `${simMessageId}-history-${index + 1}`, eventName: prior.eventName,
        timestamp: isoFromLocal(prior.timestamp) || '', subjectId: simSubjectId,
        sourceId: simSource.id, environment: simSource.environment, properties: {}
      }));
      if (history.some((event) => !event.timestamp || !event.eventName)) throw new Error('Every prior event needs a real event name and timestamp.');
      const result = await simulateJourneyStageRules(map.definition.id, useDrafts, {
        messageId: simMessageId, eventName: simEventName, timestamp, subjectId: simSubjectId,
        sourceId: simSource.id, environment: simSource.environment, properties: simProperties
      }, history);
      setSimulation(result);
    } catch (reason) { setSimulationError(message(reason, 'The rule simulation failed.')); }
    finally { setBusy(''); }
  }

  async function inspectInstance(instanceId: string) {
    setBusy('instance'); setDecision(null); setError('');
    try { setSelectedInstance(await readJourneyAnonymousInstance(map.definition.id, instanceId)); }
    catch (reason) { setError(message(reason, 'The anonymous journey instance could not be loaded.')); }
    finally { setBusy(''); }
  }

  async function inspectDecision(decisionId: string) {
    setBusy('decision'); setError('');
    try { setDecision((await readJourneyStageDecision(map.definition.id, decisionId)).decision); }
    catch (reason) { setError(message(reason, 'The stage decision could not be explained.')); }
    finally { setBusy(''); }
  }

  const stageName = (key: string | null) => {
    if (!key) return 'No current stage';
    const stage = targetMap.stages.find((candidate) => candidate.stageKey === key);
    return stage ? `${stage.name} / ${key}` : key;
  };

  if (loading) return <div className="flex items-center gap-2 border p-4 text-sm text-muted-foreground">
    <Loader2 className="h-4 w-4 animate-spin" />Loading event rules and observed journeys...
  </div>;

  return <section className="min-w-0 max-w-full space-y-4 overflow-hidden" aria-label="Connected journey event rules" data-testid="journey-stage-rules-workspace">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-3">
      <div>
        <h2 className="text-base font-semibold">Connected journey rules</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
          Map accepted events from explicit published tracking plans to governed journey stages. Draft simulation never changes observed journeys.
        </p>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={() => void loadWorkspace()} disabled={Boolean(busy)}>
        <RefreshCw className="mr-1 h-4 w-4" />Refresh rules
      </Button>
    </div>

    {error && <div role="alert" className="flex items-start gap-2 border border-red-300 bg-red-50 p-3 text-sm text-red-800" data-testid="stage-rule-error">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span>
    </div>}
    {saveState === 'conflict' && <div className="border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" data-testid="stage-rule-conflict">
      Revision conflict: the server revision is now shown in the rule list. Your local draft remains in the editor and will not be retried automatically.
    </div>}
    {!canManage && <div className="border bg-muted/40 p-3 text-sm text-muted-foreground" data-testid="stage-rule-read-only">
      Read-only access: a space owner or administrator must create, simulate, publish, or retire event rules.
    </div>}

    <Tabs className="min-w-0 max-w-full" value={tab} onValueChange={(value) => setTab(value as OperationalTab)}>
      <TabsList className="w-full justify-start overflow-x-auto">
        <TabsTrigger value="rules" data-testid="stage-rules-tab">Rules ({rules.length})</TabsTrigger>
        <TabsTrigger value="simulate" data-testid="stage-simulator-tab">Simulator</TabsTrigger>
        <TabsTrigger value="observed" data-testid="stage-observed-tab">Observed ({aggregates.total})</TabsTrigger>
      </TabsList>

      <TabsContent value="rules" className="min-w-0 max-w-full mt-4">
        <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="min-w-0 border" aria-label="Stage rule list">
            <div className="flex items-center justify-between border-b p-3">
              <div><p className="text-sm font-medium">Rule definitions</p>
                <p className="text-xs text-muted-foreground">{rules.length} of {limits.rules}</p></div>
              <Button type="button" size="sm" data-testid="new-stage-rule" onClick={beginRule} disabled={!canManage || rules.length >= limits.rules}>
                <Plus className="mr-1 h-4 w-4" />New
              </Button>
            </div>
            <div className="max-h-[720px] overflow-y-auto">
              {rules.map((rule) => <button key={rule.id} type="button" onClick={() => openRule(rule)}
                data-testid={`stage-rule-${rule.id}`} aria-current={selectedRuleId === rule.id ? 'true' : undefined}
                className={`block w-full border-b p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${selectedRuleId === rule.id ? 'bg-muted' : 'hover:bg-muted/50'}`}>
                <span className="flex items-start justify-between gap-2"><span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{rule.name}</span>
                  <span className="mt-1 block"><RuleState rule={rule} /></span>
                </span><ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" /></span>
              </button>)}
              {!rules.length && <p className="p-4 text-sm leading-6 text-muted-foreground">
                No rules yet. Create a draft from a real map version, source, and published event schema.
              </p>}
            </div>
          </aside>

          <Card className="min-w-0 rounded-none shadow-none">
            <CardHeader className="border-b">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><CardTitle className="text-base">{selectedRule ? selectedRule.name : 'New rule draft'}</CardTitle>
                  <CardDescription>{selectedRule
                    ? `Definition revision ${selectedRule.revision}. Published versions are immutable.`
                    : 'The draft remains inert until it is explicitly published.'}</CardDescription></div>
                {selectedRule && <RuleState rule={selectedRule} />}
              </div>
            </CardHeader>
            <CardContent className="space-y-5 pt-5">
              <fieldset disabled={!canManage || Boolean(busy)} className="contents">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="md:col-span-2"><Label htmlFor="rule-name">Rule name</Label>
                  <Input id="rule-name" data-testid="stage-rule-name" maxLength={160} value={draft.name}
                    onChange={(event) => changeDraft({ name: event.target.value })} /></div>
                <div><Label htmlFor="rule-map-version">Governed map version</Label>
                  <select id="rule-map-version" data-testid="stage-rule-map-version" value={draft.journeyMapVersionId}
                    className="mt-1 h-10 w-full border bg-background px-2 text-sm"
                    onChange={(event) => changeDraft({ journeyMapVersionId: event.target.value, stageKey: '', predicates: [] })}>
                    {map.versions.map((version) => <option key={version.id} value={version.id}>
                      Version {version.versionNumber} / {human(version.state)}
                    </option>)}
                  </select></div>
                <div><Label htmlFor="rule-stage">Stage</Label>
                  <select id="rule-stage" data-testid="stage-rule-stage" value={draft.stageKey}
                    disabled={!targetVersionReady}
                    className="mt-1 h-10 w-full border bg-background px-2 text-sm"
                    onChange={(event) => changeDraft({ stageKey: event.target.value })}>
                    <option value="">Select a real stage</option>
                    {!targetStages.length && <option value={draft.stageKey}>{draft.stageKey || 'Loading the exact governed version...'}</option>}
                    {targetStages.map((stage) => <option key={stage.stageKey} value={stage.stageKey}>{stage.name} / {stage.stageKey}</option>)}
                  </select></div>
                <div><Label htmlFor="rule-role">Stage transition</Label>
                  <select id="rule-role" value={draft.role} className="mt-1 h-10 w-full border bg-background px-2 text-sm"
                    onChange={(event) => changeDraft({ role: event.target.value as JourneyStageRuleDraftInput['role'] })}>
                    {journeyStageRuleRoles.map((role) => <option key={role} value={role}>{human(role)}</option>)}
                  </select></div>
                <div><Label htmlFor="rule-priority">Priority</Label>
                  <Input id="rule-priority" type="number" min={-1_000_000} max={1_000_000} value={draft.priority}
                    onChange={(event) => changeDraft({ priority: Number(event.target.value) })} /></div>
                <div><Label htmlFor="rule-effective">Effective from</Label>
                  <Input id="rule-effective" type="datetime-local" value={dateTimeLocal(draft.effectiveAt)}
                    onChange={(event) => changeDraft({ effectiveAt: isoFromLocal(event.target.value) })} /></div>
                <div><Label htmlFor="rule-expires">Expires at</Label>
                  <Input id="rule-expires" type="datetime-local" value={dateTimeLocal(draft.expiresAt)}
                    onChange={(event) => changeDraft({ expiresAt: isoFromLocal(event.target.value) })} /></div>
              </div>

              <SourceSelector sources={sources} value={draft.sourceIds} onChange={changeSources} disabled={!canManage || Boolean(busy)} />

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Environments</legend>
                <p className="text-xs text-muted-foreground">Select the explicit environments this rule accepts. Every selected source's environment must be included.</p>
                <div className="flex flex-wrap gap-3">{environments.map((environment) => {
                  const hasSource = selectedSources.some((source) => source.environment === environment);
                  return <label key={environment} className={`flex items-center gap-2 text-sm ${hasSource ? '' : 'text-muted-foreground'}`}>
                    <input type="checkbox" checked={draft.environments.includes(environment)} disabled={!hasSource || Boolean(busy)}
                      onChange={(event) => changeDraft({ environments: event.target.checked
                        ? [...draft.environments, environment] : draft.environments.filter((item) => item !== environment) })} />
                    {human(environment)}{hasSource ? '' : ' / no selected source'}
                  </label>;
                })}</div>
              </fieldset>

              <div><Label htmlFor="rule-event-name">Published event schema</Label>
                <select id="rule-event-name" data-testid="stage-rule-event" value={draft.eventName}
                  disabled={!draft.sourceIds.length || schemaLoading} className="mt-1 h-10 w-full border bg-background px-2 text-sm"
                  onChange={(event) => changeDraft({ eventName: event.target.value, predicates: [] })}>
                  <option value="">{schemaLoading ? 'Loading published schemas...' : 'Select an event shared by every source'}</option>
                  {draft.eventName && !eventNames.includes(draft.eventName) && <option value={draft.eventName}>
                    {draft.eventName} / unavailable on the selected source set
                  </option>}
                  {eventNames.map((eventName) => <option key={eventName} value={eventName}>{eventName}</option>)}
                </select>
                {draft.eventName && <p className="mt-1 text-xs text-muted-foreground">
                  Predicate catalog: {operationalProperties.length} compatible operational properties.
                </p>}
                {draft.eventName && selectedSchemaBindings.length > 0 && <dl className="mt-2 grid gap-1 border p-2 text-xs" data-testid="selected-schema-bindings">
                  {selectedSchemaBindings.map(({ source, schema, version }) => <div key={source.id} className="grid gap-1 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)]">
                    <dt className="truncate font-medium">{source.name}</dt><dd className="min-w-0 break-all text-muted-foreground">
                      {schema && version ? `${schema.eventName} / schema ${version.version} / ${version.id}` : 'No active published schema for this event'}
                    </dd>
                  </div>)}
                </dl>}
              </div>

              <PredicateEditor predicates={draft.predicates} properties={operationalProperties} limit={limits.predicates}
                disabled={!canManage || Boolean(busy)} onChange={(predicates) => changeDraft({ predicates })} />

              <fieldset className="space-y-2" data-testid="prior-event-builder">
                <div className="flex flex-wrap items-center justify-between gap-2"><div>
                  <legend className="text-sm font-medium">Required prior events</legend>
                  <p className="text-xs text-muted-foreground">Require an earlier event for the same anonymous subject, optionally within a bounded window.</p>
                </div><Button type="button" variant="outline" size="sm" disabled={!priorEventNames.length || draft.requiredPriorEvents.length >= limits.priorEvents}
                  data-testid="add-prior-event" onClick={() => changeDraft({ requiredPriorEvents: [...draft.requiredPriorEvents,
                    { eventName: priorEventNames[0]!, withinSeconds: null }] })}><Plus className="mr-1 h-4 w-4" />Add prior event</Button></div>
                {draft.requiredPriorEvents.map((prior, index) => <div key={`${prior.eventName}-${index}`}
                  className="grid gap-2 border p-2.5 sm:grid-cols-[minmax(0,1fr)_180px_auto]">
                  <div><Label htmlFor={`prior-event-${index}`} className="text-xs">Published event</Label>
                    <select id={`prior-event-${index}`} className="mt-1 h-9 w-full border bg-background px-2 text-sm" value={prior.eventName}
                      onChange={(event) => changeDraft({ requiredPriorEvents: draft.requiredPriorEvents.map((item, position) =>
                        position === index ? { ...item, eventName: event.target.value } : item) })}>
                      {!priorEventNames.includes(prior.eventName) && <option value={prior.eventName}>{prior.eventName} / unavailable</option>}
                      {priorEventNames.map((eventName) => <option key={eventName} value={eventName}>{eventName}</option>)}
                    </select></div>
                  <div><Label htmlFor={`prior-window-${index}`} className="text-xs">Within seconds</Label>
                    <Input id={`prior-window-${index}`} type="number" min={0} max={31_622_400}
                      placeholder="Any earlier time" value={prior.withinSeconds ?? ''}
                      onChange={(event) => changeDraft({ requiredPriorEvents: draft.requiredPriorEvents.map((item, position) =>
                        position === index ? { ...item, withinSeconds: event.target.value === '' ? null : Number(event.target.value) } : item) })} /></div>
                  <Button type="button" variant="ghost" size="sm" className="self-end" aria-label={`Remove required prior event ${index + 1}`}
                    onClick={() => changeDraft({ requiredPriorEvents: draft.requiredPriorEvents.filter((_item, position) => position !== index) })}>
                    <Trash2 className="h-4 w-4" /></Button>
                </div>)}
              </fieldset>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Excluded prior events</legend>
                <p className="text-xs text-muted-foreground">A selected earlier event for the same subject prevents this rule from matching.</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{priorEventNames.map((eventName) => <label key={eventName}
                  className="flex items-center gap-2 border p-2 text-sm"><input type="checkbox"
                    disabled={!draft.excludedEventNames.includes(eventName) && draft.excludedEventNames.length >= 100}
                    checked={draft.excludedEventNames.includes(eventName)} onChange={(event) => changeDraft({ excludedEventNames: event.target.checked
                      ? [...draft.excludedEventNames, eventName] : draft.excludedEventNames.filter((item) => item !== eventName) })} />{eventName}</label>)}</div>
              </fieldset>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <p className="text-xs text-muted-foreground" aria-live="polite" data-testid="stage-rule-save-state">
                  {saveState === 'clean' && 'No unsaved draft changes.'}{saveState === 'dirty' && 'Unsaved draft changes.'}
                  {saveState === 'saving' && 'Saving draft...'}{saveState === 'saved' && 'Draft saved.'}
                  {saveState === 'conflict' && 'Local draft retained after a revision conflict.'}{saveState === 'error' && 'Draft save failed.'}
                </p>
                <div className="flex flex-wrap gap-2">
                  {selectedRule?.publishedVersionId && <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => void retireRule()}>
                    Retire published rule</Button>}
                  <Button type="button" variant="outline" data-testid="save-stage-rule"
                    disabled={Boolean(busy) || saveState === 'clean' || !targetVersionReady}
                    onClick={() => void saveRule()}>{busy === 'save' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                    {saveState === 'conflict' ? 'Retry retained draft' : 'Save draft'}</Button>
                  {selectedRule?.draftVersionId && <Button type="button" data-testid="publish-stage-rule"
                    disabled={Boolean(busy) || saveState === 'dirty' || saveState === 'conflict'} onClick={() => void publishRule()}>
                    Publish to event processing</Button>}
                </div>
              </div>
              {selectedVersion && <p className="text-xs text-muted-foreground">
                Loaded version {selectedVersion.versionNumber} / {human(selectedVersion.state)} / map {versionLabel(map, selectedVersion.journeyMapVersionId)}
              </p>}
              </fieldset>
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="simulate" className="min-w-0 max-w-full mt-4">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
          <Card className="rounded-none shadow-none"><CardHeader><CardTitle className="text-base">Simulation input</CardTitle>
            <CardDescription>Uses real source and published schema identifiers. It does not persist a decision or journey visit.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div><Label htmlFor="sim-source">Active event source</Label><select id="sim-source" data-testid="sim-source"
                value={simSourceId} className="mt-1 h-10 w-full border bg-background px-2 text-sm"
                onChange={(event) => { setSimSourceId(event.target.value); setSimEventName(''); setSimProperties({}); setSimulation(null); }}>
                <option value="">Select a source</option>{activeSources.map((source) => <option key={source.id} value={source.id}>
                  {source.name} / {human(source.environment)}</option>)}</select></div>
              <div><Label htmlFor="sim-environment">Source environment</Label>
                <Input id="sim-environment" value={simSource ? human(simSource.environment) : ''} disabled aria-readonly="true" /></div>
              <div><Label htmlFor="sim-event">Published event schema</Label><select id="sim-event" data-testid="sim-event"
                value={simEventName} disabled={!simSourceId || schemaLoading} className="mt-1 h-10 w-full border bg-background px-2 text-sm"
                onChange={(event) => { setSimEventName(event.target.value); setSimProperties({}); setSimulation(null); }}>
                <option value="">Select an event</option>{simEventNames.map((eventName) => <option key={eventName} value={eventName}>{eventName}</option>)}</select>
                {simSchemaVersion && <p className="mt-1 break-all text-xs text-muted-foreground">
                  Schema {simSchemaVersion.version} / {simSchemaVersion.id}
                </p>}</div>
              <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="sim-message">Message ID</Label>
                <Input id="sim-message" value={simMessageId} onChange={(event) => setSimMessageId(event.target.value)} /></div>
                <div><Label htmlFor="sim-subject">Anonymous subject handle</Label>
                  <Input id="sim-subject" value={simSubjectId} onChange={(event) => setSimSubjectId(event.target.value)} /></div></div>
              <div><Label htmlFor="sim-time">Event timestamp</Label><Input id="sim-time" type="datetime-local" value={simTimestamp}
                onChange={(event) => setSimTimestamp(event.target.value)} /></div>
              <fieldset className="space-y-2"><legend className="text-sm font-medium">Operational event properties</legend>
                <p className="text-xs leading-5 text-muted-foreground">Personal, sensitive, content, object, and array properties are intentionally unavailable here.</p>
                {simPropertiesCatalog.map((property) => <div key={property.name}><Label htmlFor={`sim-property-${property.name}`} className="text-xs">
                  {property.name} / {property.type}{property.required ? ' / required by tracking plan' : ''}</Label>
                  {property.type === 'boolean' ? <select id={`sim-property-${property.name}`}
                    className="mt-1 h-9 w-full border bg-background px-2 text-sm" value={String(simProperties[property.name] ?? '')}
                    onChange={(event) => setSimProperties((current) => ({ ...current, [property.name]: event.target.value === '' ? undefined : event.target.value === 'true' }))}>
                    <option value="">Not provided</option><option value="true">True</option><option value="false">False</option></select>
                  : property.enumValues?.length ? <select id={`sim-property-${property.name}`}
                    className="mt-1 h-9 w-full border bg-background px-2 text-sm" value={String(simProperties[property.name] ?? '')}
                    onChange={(event) => setSimProperties((current) => ({ ...current, [property.name]: event.target.value === ''
                      ? undefined : parseScalar(event.target.value, property.type) }))}>
                    <option value="">Not provided</option>{property.enumValues.map((value) => <option key={String(value)} value={String(value)}>{String(value)}</option>)}</select>
                  : <Input id={`sim-property-${property.name}`} type={property.type === 'number' ? 'number' : 'text'}
                    value={String(simProperties[property.name] ?? '')} onChange={(event) => setSimProperties((current) => {
                      const next = { ...current }; if (!event.target.value) delete next[property.name];
                      else next[property.name] = parseScalar(event.target.value, property.type); return next;
                    })} />}</div>)}
                {simSchemaVersion && !simPropertiesCatalog.length && <p className="border border-dashed p-3 text-sm text-muted-foreground">
                  This published schema exposes no safe operational scalar properties to the simulator.
                </p>}
              </fieldset>
              <fieldset className="space-y-2"><div className="flex items-center justify-between gap-2"><legend className="text-sm font-medium">Prior event history</legend>
                <Button type="button" variant="outline" size="sm" disabled={!simEventNames.length || simHistory.length >= Math.min(limits.priorEvents, 20)}
                  data-testid="add-sim-history" onClick={() => setSimHistory((current) => [...current,
                    { eventName: simEventNames[0]!, timestamp: dateTimeLocal(new Date(Date.now() - 60_000).toISOString()) }])}>
                  <Plus className="mr-1 h-4 w-4" />Add</Button></div>
                {simHistory.map((prior, index) => <div key={index} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <select aria-label={`Prior event ${index + 1}`} value={prior.eventName} className="h-9 border bg-background px-2 text-sm"
                    onChange={(event) => setSimHistory((current) => current.map((item, position) => position === index ? { ...item, eventName: event.target.value } : item))}>
                    {simEventNames.map((eventName) => <option key={eventName} value={eventName}>{eventName}</option>)}</select>
                  <Input aria-label={`Prior event timestamp ${index + 1}`} type="datetime-local" value={prior.timestamp}
                    onChange={(event) => setSimHistory((current) => current.map((item, position) => position === index ? { ...item, timestamp: event.target.value } : item))} />
                  <Button type="button" variant="ghost" size="sm" aria-label={`Remove simulation prior event ${index + 1}`}
                    onClick={() => setSimHistory((current) => current.filter((_item, position) => position !== index))}><Trash2 className="h-4 w-4" /></Button>
                </div>)}</fieldset>
              <label className="flex items-start gap-2 border p-3 text-sm"><input type="checkbox" className="mt-0.5" checked={useDrafts}
                onChange={(event) => setUseDrafts(event.target.checked)} /><span><span className="block font-medium">Evaluate current drafts</span>
                  <span className="text-xs text-muted-foreground">The server chooses each definition's draft when present, otherwise its published version.</span></span></label>
              <Button type="button" data-testid="run-stage-simulation" disabled={!canManage || busy === 'simulate' || !simSchemaVersion} onClick={() => void runSimulation()}>
                {busy === 'simulate' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FlaskConical className="mr-1 h-4 w-4" />}Run simulation
              </Button>
              {simulationError && <p role="alert" className="text-sm text-red-700">{simulationError}</p>}
            </CardContent>
          </Card>
          <Card className="min-w-0 rounded-none shadow-none"><CardHeader><CardTitle className="text-base">Deterministic trace</CardTitle>
            <CardDescription>Reasons are returned by the evaluator in priority and specificity order.</CardDescription></CardHeader>
            <CardContent>{simulation ? <TraceView result={simulation} stageName={stageName} />
              : <div className="border border-dashed p-6 text-sm text-muted-foreground">Run a simulation to inspect every evaluated rule and match reason.</div>}</CardContent>
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="observed" className="min-w-0 max-w-full mt-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-semibold">Anonymous journey projections</h3>
          <p className="mt-1 text-sm text-muted-foreground">Aggregates and instances come from durable published-rule decisions, never the simulator.</p></div>
          <Button type="button" variant="outline" size="sm" disabled={Boolean(busy)} onClick={() => void loadOperations()}>
            <RefreshCw className="mr-1 h-4 w-4" />Refresh observations</Button></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="border p-3"><p className="text-xs text-muted-foreground">Total anonymous instances</p><p className="mt-1 text-2xl font-semibold tabular-nums">{aggregates.total}</p></div>
          {Object.entries(aggregates.byState).map(([state, count]) => <div key={state} className="border p-3"><p className="text-xs text-muted-foreground">{human(state)}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{count}</p></div>)}
        </div>
        {Object.keys(aggregates.byStage).length > 0 && <div className="mt-3 border p-3"><p className="text-sm font-medium">Current stage distribution</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(aggregates.byStage).map(([stageKey, count]) =>
            <div key={stageKey} className="flex items-center justify-between border px-3 py-2 text-sm"><span>{stageName(stageKey)}</span><strong className="tabular-nums">{count}</strong></div>)}</div></div>}
        <div className="mt-4 min-w-0 max-w-full grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]">
          <ul className="space-y-2 md:hidden" aria-label="Anonymous journey instances">
            {instances.map((instance) => <li key={instance.id} className="min-w-0 border p-3 text-sm">
              <p className="break-all font-mono text-xs">{instance.id}</p>
              <div className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                <span className="text-muted-foreground">Source</span><span className="break-words">{sources.find((source) => source.id === instance.sourceId)?.name || instance.sourceId} / {human(instance.environment)}</span>
                <span className="text-muted-foreground">Journey</span><span>{human(instance.state)} / {stageName(instance.currentStageKey)}</span>
                <span className="text-muted-foreground">Latest</span><span>{formatDateTime(instance.latestEventAt)}</span>
              </div>
              <Button type="button" variant="outline" size="sm" className="mt-3"
                data-testid={`inspect-instance-mobile-${instance.id}`} onClick={() => void inspectInstance(instance.id)}>Inspect</Button>
            </li>)}
            {!instances.length && <li className="border border-dashed p-4 text-sm text-muted-foreground">No anonymous instances have been projected for this journey.</li>}
          </ul>
          <div className="hidden min-w-0 overflow-x-auto border md:block"><table className="min-w-[760px] w-full text-left text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Anonymous instance</th>
              <th className="px-3 py-2 font-medium">Source / environment</th><th className="px-3 py-2 font-medium">State / stage</th>
              <th className="px-3 py-2 font-medium">Latest event</th><th className="px-3 py-2 font-medium"><span className="sr-only">Action</span></th></tr></thead>
            <tbody>{instances.map((instance) => <tr key={instance.id} className="border-t"><td className="px-3 py-2 font-mono text-xs">{instance.id}</td>
              <td className="px-3 py-2"><span className="block">{sources.find((source) => source.id === instance.sourceId)?.name || instance.sourceId}</span>
                <span className="text-xs text-muted-foreground">{human(instance.environment)}</span></td>
              <td className="px-3 py-2"><span className="block">{human(instance.state)}</span><span className="text-xs text-muted-foreground">{stageName(instance.currentStageKey)}</span></td>
              <td className="px-3 py-2">{formatDateTime(instance.latestEventAt)}</td><td className="px-3 py-2 text-right">
                <Button type="button" variant="outline" size="sm" data-testid={`inspect-instance-${instance.id}`} onClick={() => void inspectInstance(instance.id)}>Inspect</Button></td></tr>)}</tbody>
            {!instances.length && <tbody><tr><td colSpan={5} className="p-6 text-center text-sm text-muted-foreground">No anonymous instances have been projected for this journey.</td></tr></tbody>}
          </table></div>
          <div className="min-w-0 border p-4" data-testid="instance-inspector">
            {!selectedInstance ? <p className="text-sm text-muted-foreground">Choose an anonymous instance to inspect its immutable stage visits and decisions.</p> : <div className="space-y-4">
              <div><p className="font-mono text-xs break-all">{selectedInstance.instance.id}</p><p className="mt-1 text-sm font-medium">{human(selectedInstance.instance.state)} / {stageName(selectedInstance.instance.currentStageKey)}</p></div>
              <ol className="space-y-2">{selectedInstance.visits.map((visit) => <li key={visit.id} className="border p-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-medium">{stageName(visit.stageKey)} / {human(visit.role)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(visit.eventOccurredAt)} / rule version {visit.ruleVersionNumber}</p></div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => void inspectDecision(visit.decisionId)}>Explain decision</Button></div>
                {(visit.isLate || visit.isOutOfOrder || !visit.appliedToCurrent) && <p className="mt-2 text-xs text-amber-800">
                  {visit.isLate ? 'Late event. ' : ''}{visit.isOutOfOrder ? 'Out of order. ' : ''}
                  {visit.nonApplicationReason === 'out_of_order' ? 'Recorded without changing the current stage because an event with a later occurrence time was already applied.' : ''}
                  {visit.nonApplicationReason === 'terminal_absorbing' ? 'Recorded without changing the current stage because this journey instance had already reached a terminal state.' : ''}
                  {!visit.appliedToCurrent && !visit.nonApplicationReason ? 'Recorded without changing the current stage; the backend did not provide a reason.' : ''}</p>}
              </li>)}</ol>
              {!selectedInstance.visits.length && <p className="text-sm text-muted-foreground">This instance has no visible stage visits.</p>}
            </div>}
            {decision && <div className="mt-4 border-t pt-4" data-testid="decision-explanation"><div className="flex items-center gap-2">
              <CircleDot className="h-4 w-4 text-emerald-700" /><p className="text-sm font-semibold">Decision {human(decision.outcome)}</p></div>
              <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
                <dt className="text-muted-foreground">Stage</dt><dd>{stageName(decision.stageKey)}</dd>
                <dt className="text-muted-foreground">Rule version</dt><dd>{decision.matchedRuleVersionNumber ?? 'No match'}</dd>
                <dt className="text-muted-foreground">Schema version</dt><dd className="break-all">{decision.provenance.schemaVersionId || 'Not recorded'}</dd>
                <dt className="text-muted-foreground">Source</dt><dd className="break-all">{decision.provenance.sourceId || 'Not recorded'} / {decision.provenance.environment || 'unknown'}</dd>
                <dt className="text-muted-foreground">Processor</dt><dd>{decision.processor} / {decision.processorVersion}</dd>
                <dt className="text-muted-foreground">Evaluated</dt><dd>{formatDateTime(decision.evaluatedAt)}</dd>
              </dl>
              <details className="mt-3"><summary className="cursor-pointer text-xs font-medium">Stored evaluator trace</summary>
                <pre className="mt-2 max-h-64 overflow-auto border bg-muted/30 p-2 text-[11px]">{JSON.stringify(decision.trace, null, 2)}</pre></details>
            </div>}
          </div>
        </div>
      </TabsContent>
    </Tabs>
  </section>;
}
