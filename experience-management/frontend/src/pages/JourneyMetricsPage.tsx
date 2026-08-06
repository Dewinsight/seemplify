import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Activity, BarChart3, Bell, CircleAlert, Database, Download, Eye, Gauge, Layers3, LoaderCircle, Plus, RefreshCw,
  RotateCcw, Save, Settings2, ShieldCheck
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useAuthSession, useSessionFeature } from '@/lib/authSessionContext';
import { api } from '@/lib/api';
import { listJourneyMaps, readJourneyMap, type JourneyMapReadModel } from '@/lib/journeyMaps';
import { listJourneyRichCardCatalog } from '@/lib/journeyRichCards';
import {
  createJourneyMetricBinding, createJourneyMetricDefinition, createJourneyMetricDefinitionVersion,
  createJourneyMetricSegment, downloadJourneyMetricAnalyticsExport, journeyMetricAnalyticsExportFormats,
  journeyNativeSocialMeasureKinds, journeyNativeTicketMeasureKinds,
  createJourneyActualPathSnapshot, listJourneyActualPathSnapshots, materializeJourneyActualPathRollup,
  readJourneyActualPathSnapshot, readJourneyActualPaths, readLatestJourneyActualPathRollup, readLatestJourneyActualPathSnapshot,
  listJourneyMetricBindings, listJourneyMetricDefinitions, listJourneyMetricNativeSources,
  listJourneyMetricObservations,
  listJourneyMetricRebuilds, listJourneyMetricSegments, nativeMetricVersion, queueJourneyMetricRebuild,
  readJourneyMetricDefinition, readJourneyMetricObservationLineage,
  surveyMetricVersion, updateJourneyMetricBinding, updateJourneyMetricSegment,
  type JourneyActualPathResult, type JourneyActualPathRollup, type JourneyActualPathSnapshot, type JourneyActualPathSubjectKind,
  type JourneyMetricAnalyticsExportFormat, type JourneyMetricAppliedFilters, type JourneyMetricBinding,
  type JourneyMetricComparison, type JourneyMetricDefinition, type JourneyMetricNativeSourceCatalog,
  type JourneyMetricObservation, type JourneyMetricRebuild,
  type JourneyMetricSegment, type JourneyMetricTargetType, type JourneyMetricVersion,
  type JourneyNativeMeasureKind, type JourneyNativeMetricAdapter
} from '@/lib/journeyMetrics';
import type { Survey, SurveyDetail } from '@/types';
import {
  createJourneyMetricAlertDefinition, createJourneyMetricAlertVersion, evaluateJourneyMetricAlerts,
  listJourneyMetricAlertDefinitions, listJourneyMetricAlertNotifications, listJourneyMetricAlertRuns,
  listJourneyMetricAlerts, readJourneyMetricAlertNotificationPreference, transitionJourneyMetricAlert,
  updateJourneyMetricAlertDefinition, updateJourneyMetricAlertNotification,
  updateJourneyMetricAlertNotificationPreference,
  type JourneyMetricAlert, type JourneyMetricAlertDefinition, type JourneyMetricAlertNotification,
  type JourneyMetricAlertNotificationPreference, type JourneyMetricAlertRuleKind, type JourneyMetricAlertRun
} from '@/lib/journeyMetricAlerts';

type MetricSourceMode = 'survey' | JourneyNativeMetricAdapter;
type MetricDraft = {
  name: string; targetType: JourneyMetricTargetType; targetId: string; bindingId: string;
  calculatorKind: 'nps' | 'csat' | 'ces'; windowDays: string; freshnessHours: string;
  minimumSampleSize: string; baselineValue: string; targetValue: string;
  sourceMode: MetricSourceMode; nativeSourceIds: string[]; nativeKind: JourneyNativeMeasureKind;
  nativeStageTargeted: boolean;
};
type BindingDraft = {
  targetType: JourneyMetricTargetType; targetId: string; surveyId: string; collectorId: string; questionId: string;
};
type SegmentDraft = { name: string; description: string; rule: string };
type AlertDraft = { name: string; metricDefinitionId: string; ruleKind: JourneyMetricAlertRuleKind;
  thresholdValue: string; windowDays: string; cooldownHours: string; minimumSampleSize: string;
  staleHours: string; contradictionRatio: string };

const emptyMetricDraft: MetricDraft = { name: '', targetType: 'journey', targetId: '', bindingId: '', calculatorKind: 'nps',
  windowDays: '30', freshnessHours: '48', minimumSampleSize: '30', baselineValue: '', targetValue: '',
  sourceMode: 'survey', nativeSourceIds: [], nativeKind: 'ticket_rate', nativeStageTargeted: false };

const NATIVE_ADAPTER_LABEL: Record<JourneyNativeMetricAdapter, string> = {
  service_recovery_tickets: 'Native · Service recovery tickets (aggregate)',
  social_mentions: 'Native · Social mentions (aggregate)'
};
const NATIVE_MEASURE_LABEL: Record<JourneyNativeMeasureKind, string> = {
  ticket_rate: 'Ticket rate — respondents with a recovery case',
  repeat_contact_rate: 'Repeat contact rate — cases reopened at least once',
  recovery_rate: 'Recovery rate — cases closed after being raised',
  sentiment_distribution: 'Sentiment distribution — aggregate shares',
  sentiment_trend: 'Sentiment trend — aggregate shares versus the prior window'
};
/** Rendered wherever a native aggregate is described. Social posts are counted
 * in aggregate and are never an individual customer path. */
const NATIVE_SOCIAL_NOTICE = 'Aggregate shares of authorised social posts only. Individual posts are never shown; '
  + 'authors and post content are never read into a measure, and a social measure is not an individual customer path.';
const emptyBindingDraft: BindingDraft = { targetType: 'journey', targetId: '', surveyId: '', collectorId: '', questionId: '' };
const emptySegmentDraft: SegmentDraft = { name: '', description: '', rule: '{\n  "conditions": []\n}' };
const emptyAlertDraft: AlertDraft = { name: '', metricDefinitionId: '', ruleKind: 'falling_metric',
  thresholdValue: '5', windowDays: '30', cooldownHours: '24', minimumSampleSize: '30', staleHours: '48',
  contradictionRatio: '0.2' };

function errorMessage(value: unknown) { return value instanceof Error ? value.message : 'The journey metrics request failed.'; }
function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
}
function formatMetric(value: number | null, unit: string) {
  if (value === null) return 'Unavailable';
  if (unit === 'percent') return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}${unit === 'scale_points' ? ' points' : ''}`;
}
function formatWindow(seconds: number) {
  if (seconds % 86_400 === 0) return `${seconds / 86_400} day${seconds === 86_400 ? '' : 's'}`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600} hour${seconds === 3_600 ? '' : 's'}`;
  return `${seconds.toLocaleString()} seconds`;
}
function label(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/gu, (match) => match.toUpperCase()); }
function safeNumber(value: string, field: string, minimum?: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || (minimum !== undefined && parsed < minimum)) throw new Error(`${field} must be ${minimum === undefined ? 'a number' : `at least ${minimum}`}.`);
  return parsed;
}
function optionalNumber(value: string) { return value.trim() ? safeNumber(value, 'Baseline and target') : null; }
function dateBoundary(value: string, endExclusive = false) {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (endExclusive) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}

function deltaLabel(value: number | null, suffix = '') {
  if (value === null) return 'Unavailable';
  if (value === 0) return `No change${suffix}`;
  return `${value > 0 ? '+' : ''}${value.toLocaleString()}${suffix}`;
}

function latestByDefinition(observations: JourneyMetricObservation[]) {
  const result = new Map<string, JourneyMetricObservation[]>();
  for (const observation of observations) {
    const rows = result.get(observation.definitionId) || [];
    rows.push(observation); result.set(observation.definitionId, rows);
  }
  for (const rows of result.values()) rows.sort((a, b) => Date.parse(b.period.end) - Date.parse(a.period.end) || b.revision - a.revision);
  return result;
}

function comparablePrevious(current: JourneyMetricObservation | undefined, rows: JourneyMetricObservation[]) {
  if (!current) return undefined;
  return rows.slice(1).find((row) => row.definitionVersionId === current.definitionVersionId && row.unit === current.unit
    && (row.period.start !== current.period.start || row.period.end !== current.period.end)
    && row.status === 'available' && row.value !== null);
}

const SUPPRESSED_LABEL = 'Suppressed';
const SUPPRESSION_REASON: Record<string, string> = {
  PRIVACY_SUPPRESSED_SOURCE: 'The source marked this observation privacy suppressed.',
  SMALL_SAMPLE_SUPPRESSED: 'The sample is below the configured privacy minimum for this definition version.',
  DEFINITION_VERSION_UNAVAILABLE: 'The immutable definition version for this observation could not be resolved.'
};

function suppressionNote(observation: JourneyMetricObservation | undefined) {
  if (!observation?.privacy.suppressed) return null;
  return SUPPRESSION_REASON[observation.privacy.reasonCode || ''] || 'This observation is privacy suppressed.';
}

/** A suppressed observation renders no number anywhere: no value, no sample, no
 * source count, and no denominator. Showing a percentage without its
 * denominator is prohibited, so a partial redaction is not an option. */
function suppressedCount(observation: JourneyMetricObservation | undefined, value: number | null | undefined) {
  if (observation?.privacy.suppressed) return SUPPRESSED_LABEL;
  return value === null || value === undefined ? '—' : value.toLocaleString();
}
function suppressedMetric(observation: JourneyMetricObservation | undefined, value: number | null, unit: string) {
  if (observation?.privacy.suppressed) return SUPPRESSED_LABEL;
  return formatMetric(value, unit);
}

function metricHealth(definition: JourneyMetricDefinition, observation: JourneyMetricObservation | undefined) {
  const version = definition.currentVersion;
  if (observation?.privacy.suppressed) return { text: 'Suppressed sample', tone: 'text-amber-700' };
  if (!version || !observation || observation.status !== 'available' || observation.value === null) return { text: 'Unavailable', tone: 'text-slate-600' };
  if (observation.freshnessStatus !== 'fresh') return { text: 'Stale evidence', tone: 'text-amber-700' };
  if (observation.minimumSampleWarning) return { text: 'Limited sample', tone: 'text-amber-700' };
  if (version.targetValue === null || version.direction === 'neutral') return { text: 'Monitoring', tone: 'text-slate-700' };
  const met = version.direction === 'higher_is_better' ? observation.value >= version.targetValue : observation.value <= version.targetValue;
  return met ? { text: 'Target met', tone: 'text-emerald-700' } : {
    text: version.direction === 'higher_is_better' ? 'Below target' : 'Above target',
    tone: 'text-rose-700'
  };
}

function targetName(map: JourneyMapReadModel, segments: JourneyMetricSegment[], type: JourneyMetricTargetType, id: string) {
  if (type === 'journey') return map.definition.name;
  if (type === 'stage') return map.stages.find((stage) => stage.id === id)?.name || `Stage ${id.slice(0, 8)}`;
  if (type === 'touchpoint') return map.cards.find((card) => card.id === id)?.title || `Touchpoint ${id.slice(0, 8)}`;
  if (type === 'persona') return map.personas.find((persona) => persona.id === id)?.name || `Persona ${id.slice(0, 8)}`;
  return segments.find((segment) => segment.id === id)?.name || `Segment ${id.slice(0, 8)}`;
}

function targetOptions(map: JourneyMapReadModel | null, segments: JourneyMetricSegment[], type: JourneyMetricTargetType) {
  if (!map) return [];
  if (type === 'journey') return [{ id: map.definition.id, name: map.definition.name }];
  if (type === 'stage') return map.stages.map((stage) => ({ id: stage.id, name: stage.name }));
  if (type === 'touchpoint') return map.cards.filter((card) => card.kind === 'touchpoint').map((card) => ({ id: card.id, name: card.title }));
  if (type === 'persona') return map.personas.map((persona) => ({ id: persona.id, name: persona.name }));
  return segments.filter((segment) => segment.state === 'active').map((segment) => ({ id: segment.id, name: segment.name }));
}

function pathPercent(value: number | null | undefined, suppressed = false) {
  if (suppressed) return SUPPRESSED_LABEL;
  return value === null || value === undefined ? '—' : `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}

function pathCount(value: number | null | undefined, suppressed = false) {
  if (suppressed) return SUPPRESSED_LABEL;
  return value === null || value === undefined ? '—' : value.toLocaleString();
}

function MetricNumberButton({ observation, definition, children, onInspect, labelText }: {
  observation?: JourneyMetricObservation; definition: JourneyMetricDefinition; children: React.ReactNode;
  onInspect: (observation: JourneyMetricObservation, definition: JourneyMetricDefinition) => void; labelText: string;
}) {
  if (!observation) return <span>{children}</span>;
  return <button type="button" className="rounded-sm text-left font-medium underline decoration-border underline-offset-4 hover:decoration-foreground focus:outline-none focus:ring-2 focus:ring-ring"
    aria-label={`${labelText}. Inspect definition and observation lineage`} onClick={() => onInspect(observation, definition)}>{children}</button>;
}

function Sparkline({ rows, name }: { rows: JourneyMetricObservation[]; name: string }) {
  const periods = new Set<string>();
  const values = rows.filter((row) => {
    const key = `${row.definitionVersionId}:${row.unit}:${row.period.start}:${row.period.end}`;
    if (row.status !== 'available' || row.value === null || periods.has(key)) return false;
    periods.add(key); return true;
  }).slice().reverse();
  if (values.length < 2) return <span className="text-xs text-muted-foreground">A trend needs at least two comparable observations.</span>;
  const numbers = values.map((row) => row.value as number); const min = Math.min(...numbers); const max = Math.max(...numbers);
  const points = numbers.map((value, index) => {
    const x = values.length === 1 ? 0 : (index / (values.length - 1)) * 220;
    const y = max === min ? 32 : 58 - ((value - min) / (max - min)) * 52;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const summary = `${name} changed from ${formatMetric(numbers[0]!, values[0]!.unit)} to ${formatMetric(numbers.at(-1)!, values.at(-1)!.unit)} across ${values.length} observations.`;
  return <div className="min-w-[230px]"><svg viewBox="0 0 220 64" className="h-16 w-[220px] max-w-full" role="img" aria-label={summary}>
    <title>{summary}</title><line x1="0" y1="58" x2="220" y2="58" className="stroke-border" />
    <polyline points={points} fill="none" className="stroke-primary" strokeWidth="2" vectorEffect="non-scaling-stroke" />
  </svg><p className="sr-only">The observation table in this section is the exact text alternative for this trend.</p></div>;
}

/** Checkbox group rather than a multi-select: it is reachable with a single Tab
 * per option, announces its own group name, and stacks without overflow at
 * 320 CSS px where a wide multi-select would not. */
function FacetSelect({ id, title, options, selected, onChange }: {
  id: string; title: string; options: Array<{ id: string; name: string }>; selected: string[];
  onChange: (next: string[]) => void;
}) {
  return <fieldset className="min-w-0">
    <legend className="field-label" id={`${id}-legend`}>{title}</legend>
    {options.length === 0
      ? <p className="mt-1 text-xs text-muted-foreground">None configured for this journey.</p>
      : <div className="mt-1 max-h-32 space-y-1 overflow-y-auto pr-1" role="group" aria-labelledby={`${id}-legend`}>
        {options.map((option) => {
          const checked = selected.includes(option.id);
          return <label key={option.id} className="flex items-center gap-2 text-sm" htmlFor={`${id}-${option.id}`}>
            <input type="checkbox" id={`${id}-${option.id}`} checked={checked}
              className="h-4 w-4 rounded border-input"
              onChange={() => onChange(checked ? selected.filter((value) => value !== option.id)
                : [...selected, option.id])} />
            <span className="min-w-0 truncate">{option.name}</span>
          </label>;
        })}
      </div>}
  </fieldset>;
}

/** Emotional/sentiment lane. The chart is decorative: the adjacent semantic
 * table is the exact alternative, and both read the labelled aggregate shares
 * rather than `observation.value`, which for a sentiment trend is the *negative*
 * share stored as an unlabelled percent. */
function SentimentLane({ observation, definition }: {
  observation: JourneyMetricObservation; definition: JourneyMetricDefinition;
}) {
  const lane = observation.sentiment;
  if (!lane) return null;
  const rows = lane.rows;
  const tone: Record<string, string> = { negative: 'fill-rose-500', neutral: 'fill-slate-400',
    positive: 'fill-emerald-500', unknown: 'fill-slate-300' };
  const summary = `${definition.name} ${lane.kind === 'sentiment_trend' ? 'sentiment trend' : 'sentiment distribution'}: `
    + rows.map((row) => `${row.label} ${row.currentValue === null ? 'unavailable' : `${row.currentValue}%`}`
      + (row.changeValue === null ? '' : ` (${row.changeValue > 0 ? '+' : ''}${row.changeValue} points)`)).join(', ')
    + `. Based on ${observation.sampleSize === null ? 'an unavailable' : observation.sampleSize.toLocaleString()} `
    + 'aggregated social posts.';
  const maximum = Math.max(1, ...rows.map((row) => row.currentValue ?? 0));
  return <div className="grid gap-4 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
    <div>
      <svg viewBox="0 0 240 96" className="h-24 w-full max-w-[240px]" role="img" aria-label={summary}>
        <title>{summary}</title>
        {rows.map((row, index) => {
          const height = ((row.currentValue ?? 0) / maximum) * 70;
          return <rect key={row.key} x={index * 60 + 12} y={82 - height} width="36" height={Math.max(1, height)}
            className={tone[row.key] || 'fill-slate-400'} />;
        })}
        <line x1="0" y1="82" x2="240" y2="82" className="stroke-border" />
      </svg>
      <p className="mt-2 text-xs text-muted-foreground">
        Individual posts are never shown. {NATIVE_SOCIAL_NOTICE}
      </p>
    </div>
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Exact sentiment shares for {definition.name}; the text alternative to the chart.</caption>
        <thead><tr className="border-b text-left text-xs">
          <th className="px-3 py-2" scope="col">Sentiment</th><th className="px-3 py-2" scope="col">Current</th>
          <th className="px-3 py-2" scope="col">Comparison period</th><th className="px-3 py-2" scope="col">Change</th>
        </tr></thead>
        <tbody>{rows.map((row) => <tr className="border-b last:border-b-0" key={row.key}>
          <th className="px-3 py-2 text-left font-medium" scope="row">{row.label}</th>
          <td className="px-3 py-2 tabular-nums">{row.currentValue === null ? 'Unavailable' : `${row.currentValue}%`}</td>
          <td className="px-3 py-2 tabular-nums">{row.previousValue === null ? '—' : `${row.previousValue}%`}</td>
          <td className="px-3 py-2 tabular-nums">{row.changeValue === null ? '—'
            : `${row.changeValue > 0 ? '+' : ''}${row.changeValue} pts`}</td>
        </tr>)}</tbody>
      </table>
      <dl className="mt-3 grid gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
        <div><dt className="inline font-medium text-foreground">Sample: </dt>
          <dd className="inline">{observation.sampleSize === null ? 'Suppressed'
            : `${observation.sampleSize.toLocaleString()} social posts`}</dd></div>
        <div><dt className="inline font-medium text-foreground">Source: </dt>
          <dd className="inline">{definition.currentVersion?.nativeSource?.label
            || 'Governed operational import (social posts)'}</dd></div>
        <div><dt className="inline font-medium text-foreground">Window: </dt>
          <dd className="inline">{formatDate(observation.period.start)} to {formatDate(observation.period.end)}</dd></div>
        <div><dt className="inline font-medium text-foreground">Freshness: </dt>
          <dd className="inline">{observation.freshnessStatus}, observed {formatDate(observation.latestObservedAt)}</dd></div>
      </dl>
      {lane.formula && <p className="mt-2 text-xs text-muted-foreground">Definition: {lane.formula}</p>}
    </div>
  </div>;
}

export function JourneyMetricsPage() {
  const enabled = useSessionFeature('journeyMetrics'); const session = useAuthSession();
  const richCardsEnabled = useSessionFeature('journeyRichCards');
  const exportsEnabled = useSessionFeature('journeyExports');
  const actualPathsEnabled = useSessionFeature('journeyActualPaths');
  const canManage = Boolean(session?.activeSpace && session.activeSpace.role !== 'member');
  const [journeys, setJourneys] = useState<Array<{ id: string; name: string }>>([]);
  const [journeyId, setJourneyId] = useState(''); const [map, setMap] = useState<JourneyMapReadModel | null>(null);
  const [definitions, setDefinitions] = useState<JourneyMetricDefinition[]>([]);
  const [bindings, setBindings] = useState<JourneyMetricBinding[]>([]); const [segments, setSegments] = useState<JourneyMetricSegment[]>([]);
  const [observations, setObservations] = useState<JourneyMetricObservation[]>([]); const [rebuilds, setRebuilds] = useState<JourneyMetricRebuild[]>([]);
  const [alertDefinitions, setAlertDefinitions] = useState<JourneyMetricAlertDefinition[]>([]);
  const [alerts, setAlerts] = useState<JourneyMetricAlert[]>([]); const [alertRuns, setAlertRuns] = useState<JourneyMetricAlertRun[]>([]);
  const [alertNotifications, setAlertNotifications] = useState<JourneyMetricAlertNotification[]>([]);
  const [alertPreference, setAlertPreference] = useState<JourneyMetricAlertNotificationPreference | null>(null);
  const [surveys, setSurveys] = useState<Survey[]>([]); const [surveyDetail, setSurveyDetail] = useState<SurveyDetail | null>(null);
  const [metricSurveyDetail, setMetricSurveyDetail] = useState<SurveyDetail | null>(null);
  const [loading, setLoading] = useState(true); const [working, setWorking] = useState<string | null>(null); const [error, setError] = useState('');
  const [rangeDraft, setRangeDraft] = useState({ from: '', to: '' });
  const [range, setRange] = useState({ from: '', to: '' });
  const [comparisonDraft, setComparisonDraft] = useState<JourneyMetricComparison>({});
  const [comparison, setComparison] = useState<JourneyMetricComparison>({});
  const [appliedFilters, setAppliedFilters] = useState<JourneyMetricAppliedFilters | null>(null);
  const [actualPaths, setActualPaths] = useState<JourneyActualPathResult | null>(null);
  const [actualPathSubjectKind, setActualPathSubjectKind] = useState<JourneyActualPathSubjectKind>('anonymous_only');
  const [latestActualPathRollup, setLatestActualPathRollup] = useState<JourneyActualPathRollup | null>(null);
  const [latestActualPathSnapshot, setLatestActualPathSnapshot] = useState<JourneyActualPathSnapshot | null>(null);
  const [actualPathSnapshots, setActualPathSnapshots] = useState<JourneyActualPathSnapshot[]>([]);
  const [selectedActualPathSnapshotId, setSelectedActualPathSnapshotId] = useState<string | null>(null);
  const [channels, setChannels] = useState<Array<{ id: string; name: string }>>([]);
  const [exporting, setExporting] = useState<JourneyMetricAnalyticsExportFormat | null>(null);
  const [metricOpen, setMetricOpen] = useState(false); const [editingDefinition, setEditingDefinition] = useState<JourneyMetricDefinition | null>(null);
  const [metricDraft, setMetricDraft] = useState<MetricDraft>(emptyMetricDraft);
  const [nativeSources, setNativeSources] = useState<JourneyMetricNativeSourceCatalog | null>(null);
  const [bindingOpen, setBindingOpen] = useState(false); const [bindingDraft, setBindingDraft] = useState<BindingDraft>(emptyBindingDraft);
  const [segmentOpen, setSegmentOpen] = useState(false); const [editingSegment, setEditingSegment] = useState<JourneyMetricSegment | null>(null);
  const [segmentDraft, setSegmentDraft] = useState<SegmentDraft>(emptySegmentDraft); const [segmentRuleError, setSegmentRuleError] = useState('');
  const [lineageOpen, setLineageOpen] = useState(false); const [lineageLoading, setLineageLoading] = useState(false);
  const [lineageObservation, setLineageObservation] = useState<JourneyMetricObservation | null>(null);
  const [lineageDefinition, setLineageDefinition] = useState<JourneyMetricDefinition | null>(null);
  const [lineageVersion, setLineageVersion] = useState<JourneyMetricVersion | null>(null);
  const [alertOpen, setAlertOpen] = useState(false); const [editingAlertDefinition, setEditingAlertDefinition] = useState<JourneyMetricAlertDefinition | null>(null);
  const [alertDraft, setAlertDraft] = useState<AlertDraft>(emptyAlertDraft);

  const loadJourney = useCallback(async (selected: string) => {
    if (!selected) { setMap(null); setDefinitions([]); setBindings([]); setSegments([]); setObservations([]); setRebuilds([]);
      setAlertDefinitions([]); setAlerts([]); setAlertRuns([]); setAlertNotifications([]); setAlertPreference(null);
      setActualPaths(null); setLatestActualPathRollup(null); setLatestActualPathSnapshot(null); setActualPathSnapshots([]); setSelectedActualPathSnapshotId(null); return; }
    setLoading(true); setError('');
    try {
      const [nextMap, nextDefinitions, nextBindings, nextSegments, surveyRows] = await Promise.all([
        readJourneyMap(selected), listJourneyMetricDefinitions(selected), listJourneyMetricBindings(selected),
        listJourneyMetricSegments(selected), api<Survey[]>('/api/surveys')
      ]);
      const [nextObservations, nextRebuilds, nextAlertDefinitions, nextAlerts, nextAlertRuns,
        nextAlertNotifications, nextAlertPreference, nextActualPaths, nextActualPathRollup,
        nextActualPathSnapshot, nextActualPathSnapshots] = await Promise.all([
        listJourneyMetricObservations({ journeyDefinitionId: selected },
          { from: dateBoundary(range.from), to: dateBoundary(range.to, true) }, comparison),
        listJourneyMetricRebuilds({ journeyDefinitionId: selected }), listJourneyMetricAlertDefinitions(selected),
        listJourneyMetricAlerts(selected), listJourneyMetricAlertRuns(selected), listJourneyMetricAlertNotifications(),
        readJourneyMetricAlertNotificationPreference(),
        actualPathsEnabled ? readJourneyActualPaths(selected, { from: dateBoundary(range.from), to: dateBoundary(range.to, true) }, actualPathSubjectKind) : Promise.resolve(null),
        actualPathsEnabled ? readLatestJourneyActualPathRollup(selected, actualPathSubjectKind) : Promise.resolve(null),
        actualPathsEnabled ? readLatestJourneyActualPathSnapshot(selected, actualPathSubjectKind) : Promise.resolve(null),
        actualPathsEnabled ? listJourneyActualPathSnapshots(selected, actualPathSubjectKind) : Promise.resolve([])
      ]);
      setMap(nextMap); setDefinitions(nextDefinitions); setBindings(nextBindings); setSegments(nextSegments);
      setObservations(nextObservations.observations); setAppliedFilters(nextObservations.appliedFilters);
      setRebuilds(nextRebuilds); setSurveys(surveyRows);
      setAlertDefinitions(nextAlertDefinitions); setAlerts(nextAlerts); setAlertRuns(nextAlertRuns);
      setAlertNotifications(nextAlertNotifications); setAlertPreference(nextAlertPreference); setActualPaths(nextActualPaths);
      setLatestActualPathRollup(nextActualPathRollup);
      setLatestActualPathSnapshot(nextActualPathSnapshot);
      setActualPathSnapshots(nextActualPathSnapshots);
      setSelectedActualPathSnapshotId(null);
    } catch (value) { setError(errorMessage(value)); setObservations([]); setAppliedFilters(null); setActualPaths(null); setLatestActualPathRollup(null); setLatestActualPathSnapshot(null); setActualPathSnapshots([]); }
    finally { setLoading(false); }
  }, [range.from, range.to, comparison, actualPathsEnabled, actualPathSubjectKind]);

  useEffect(() => {
    if (!enabled) return;
    let active = true; setLoading(true);
    listJourneyMaps().then((result) => {
      if (!active) return; const rows = result.journeyMaps.map((journey) => ({ id: journey.id, name: journey.name }));
      setJourneys(rows); setJourneyId((current) => current || rows[0]?.id || '');
      if (!rows.length) setLoading(false);
    }).catch((value) => { if (active) { setError(errorMessage(value)); setLoading(false); } });
    return () => { active = false; };
  }, [enabled]);
  useEffect(() => { if (enabled && journeyId) void loadJourney(journeyId); }, [enabled, journeyId, loadJourney]);

  // Members never see the native source catalogue: it is an editor-gated
  // management affordance, and a read-only role has no configuration to make.
  useEffect(() => {
    if (!enabled || !canManage) { setNativeSources(null); return; }
    let active = true;
    listJourneyMetricNativeSources().then((result) => { if (active) setNativeSources(result); })
      .catch(() => { if (active) setNativeSources(null); });
    return () => { active = false; };
  }, [enabled, canManage]);

  // The channel facet only exists where rich cards are entitled; without it the
  // control is hidden rather than shown and silently ignored.
  useEffect(() => {
    if (!enabled || !richCardsEnabled) { setChannels([]); return; }
    let active = true;
    listJourneyRichCardCatalog().then((result) => {
      if (active) setChannels(result.channels.map((channel) => ({ id: channel.id, name: channel.name })));
    }).catch(() => { if (active) setChannels([]); });
    return () => { active = false; };
  }, [enabled, richCardsEnabled]);

  const exportAnalytics = useCallback(async (format: JourneyMetricAnalyticsExportFormat) => {
    if (!journeyId) return;
    setExporting(format);
    try {
      const result = await downloadJourneyMetricAnalyticsExport({ journeyDefinitionId: journeyId, format,
        range: { from: dateBoundary(range.from), to: dateBoundary(range.to, true) }, comparison });
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = result.filename;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      URL.revokeObjectURL(url);
      toast.success(result.usageReplayed ? 'Export replayed from the existing usage receipt.'
        : `Exported ${observations.length} observation${observations.length === 1 ? '' : 's'} for the current filters.`);
    } catch (value) { toast.error(errorMessage(value)); }
    finally { setExporting(null); }
  }, [journeyId, range.from, range.to, comparison, observations.length]);

  useEffect(() => {
    if (!bindingOpen || !bindingDraft.surveyId) { setSurveyDetail(null); return; }
    let active = true;
    api<SurveyDetail>(`/api/surveys/${encodeURIComponent(bindingDraft.surveyId)}`)
      .then((detail) => { if (active) setSurveyDetail(detail); })
      .catch((value) => { if (active) toast.error(errorMessage(value)); });
    return () => { active = false; };
  }, [bindingOpen, bindingDraft.surveyId]);

  useEffect(() => {
    const binding = bindings.find((candidate) => candidate.id === metricDraft.bindingId);
    if (!metricOpen || !binding?.surveyId || !binding.questionId) { setMetricSurveyDetail(null); return; }
    let active = true; setMetricSurveyDetail(null);
    api<SurveyDetail>(`/api/surveys/${encodeURIComponent(binding.surveyId)}`).then((detail) => {
      if (!active) return; setMetricSurveyDetail(detail);
      const type = detail.survey.questions?.find((question) => question.id === binding.questionId)?.type;
      if (type === 'nps' || type === 'csat' || type === 'ces') {
        setMetricDraft((current) => ({ ...current, calculatorKind: type }));
      }
    }).catch((value) => { if (active) toast.error(errorMessage(value)); });
    return () => { active = false; };
  }, [metricOpen, metricDraft.bindingId, bindings]);

  const observationsByDefinition = useMemo(() => latestByDefinition(observations), [observations]);
  const activeDefinitions = useMemo(() => definitions.filter((definition) => definition.state === 'active'), [definitions]);
  const activeBindings = useMemo(() => bindings.filter((binding) => binding.state === 'active'), [bindings]);
  const definitionBindings = useMemo(() => activeBindings.filter((binding) => binding.sourceState === 'available' && binding.questionId), [activeBindings]);
  const metricBindingOptions = definitionBindings.filter((binding) => binding.targetType === metricDraft.targetType
    && binding.targetId === metricDraft.targetId);
  const selectedMetricBinding = metricBindingOptions.find((binding) => binding.id === metricDraft.bindingId);
  const selectedMetricQuestion = metricSurveyDetail?.survey.questions?.find((question) => question.id === selectedMetricBinding?.questionId);
  const nativeModes = useMemo(() => ([
    ...(nativeSources?.ticketsEntitled && nativeSources.tickets.length ? ['service_recovery_tickets' as const] : []),
    ...(nativeSources?.socialEntitled && nativeSources.social.length ? ['social_mentions' as const] : [])
  ]), [nativeSources]);
  const nativeChoices = metricDraft.sourceMode === 'service_recovery_tickets' ? nativeSources?.tickets || []
    : metricDraft.sourceMode === 'social_mentions' ? nativeSources?.social || [] : [];
  const nativeMeasureKinds: readonly JourneyNativeMeasureKind[] = metricDraft.sourceMode === 'social_mentions'
    ? journeyNativeSocialMeasureKinds : journeyNativeTicketMeasureKinds;
  const canCreateMetric = Boolean(definitionBindings.length) || nativeModes.length > 0;
  const definedStageIds = useMemo(() => new Set(activeDefinitions.filter((definition) => definition.targetType === 'stage').map((definition) => definition.targetId)), [activeDefinitions]);
  const stageCoverage = useMemo(() => {
    if (!map) return [];
    return map.stages.map((stage) => {
      const cards = map.cards.filter((card) => card.stageKey === stage.stageKey);
      const metricDefinitions = activeDefinitions.filter((definition) => definition.targetType === 'stage' && definition.targetId === stage.id);
      const freshMetrics = metricDefinitions.filter((definition) => observationsByDefinition.get(definition.id)?.[0]?.freshnessStatus === 'fresh').length;
      const researchBackedCards = cards.filter((card) => card.evidenceLinkCount > 0
        && !['hypothesis', 'stale', 'invalidated'].includes(card.evidence.state)).length;
      const warningCards = cards.filter((card) => ['hypothesis', 'stale', 'contradicted', 'invalidated'].includes(card.evidence.state)).length;
      return { stage, cards: cards.length, metricDefinitions: metricDefinitions.length, freshMetrics, researchBackedCards, warningCards };
    });
  }, [map, activeDefinitions, observationsByDefinition]);
  const researchCoveredStageCount = stageCoverage.filter((row) => row.researchBackedCards > 0).length;
  const targetTypeOptions = useMemo(() => ([...new Set(activeDefinitions.map((definition) => definition.targetType))]
    .sort().map((type) => ({ id: type, name: label(type) }))), [activeDefinitions]);
  const personaOptions = useMemo(() => (map?.personas || []).map((persona) => ({ id: persona.id, name: persona.name })), [map]);
  const segmentOptions = useMemo(() => segments.filter((segment) => segment.state === 'active')
    .map((segment) => ({ id: segment.id, name: segment.name })), [segments]);
  const comparisonKeys = useMemo(() => Object.values(comparison).flatMap((value) => value || []), [comparison]);
  const suppressedCountTotal = observations.filter((observation) => observation.privacy.suppressed).length;
  const sentimentObservations = useMemo(() => activeDefinitions
    .map((definition) => ({ definition, observation: observationsByDefinition.get(definition.id)
      ?.find((row) => row.sentiment !== null) }))
    .filter((row): row is { definition: JourneyMetricDefinition; observation: JourneyMetricObservation } =>
      Boolean(row.observation)), [activeDefinitions, observationsByDefinition]);
  const freshCount = activeDefinitions.filter((definition) => {
    const current = observationsByDefinition.get(definition.id)?.[0]; return current?.status === 'available' && current.value !== null && current.freshnessStatus === 'fresh';
  }).length;
  const stageNameById = useMemo(() => new Map((map?.stages || []).map((stage) => [stage.id, stage.name])), [map]);

  async function saveActualPathSnapshot() {
    if (!journeyId) return;
    setWorking('actual-path-snapshot');
    try {
      const result = await createJourneyActualPathSnapshot({
        journeyDefinitionId: journeyId,
        from: dateBoundary(range.from),
        to: dateBoundary(range.to, true),
        minimumCohortSize: 5,
        subjectKind: actualPathSubjectKind
      });
      setLatestActualPathSnapshot(result.snapshot);
      setActualPaths(result.snapshot.result);
      setSelectedActualPathSnapshotId(result.snapshot.id);
      setActualPathSnapshots((current) => {
        const without = current.filter((item) => item.id !== result.snapshot.id);
        return [result.snapshot, ...without].slice(0, 20);
      });
      toast.success(result.replayed ? 'The same actual-path snapshot already exists for this scope.' : 'Actual-path snapshot saved.');
    } catch (value) { toast.error(errorMessage(value)); }
    finally { setWorking(null); }
  }

  async function refreshActualPathRollup() {
    if (!journeyId) return;
    setWorking('actual-path-rollup');
    try {
      const result = await materializeJourneyActualPathRollup({
        journeyDefinitionId: journeyId,
        from: dateBoundary(range.from),
        to: dateBoundary(range.to, true),
        minimumCohortSize: 5,
        subjectKind: actualPathSubjectKind
      });
      setLatestActualPathRollup(result.rollup);
      setActualPaths(result.rollup.result);
      setSelectedActualPathSnapshotId(null);
      toast.success(result.updated ? 'Actual-path rollup refreshed.' : 'Actual-path rollup materialized.');
    } catch (value) { toast.error(errorMessage(value)); }
    finally { setWorking(null); }
  }

  async function inspectActualPathSnapshot(snapshotId: string) {
    if (!journeyId) return;
    setWorking(`actual-path-open-${snapshotId}`);
    try {
      const snapshot = await readJourneyActualPathSnapshot(snapshotId, journeyId, actualPathSubjectKind);
      setActualPaths(snapshot.result);
      setSelectedActualPathSnapshotId(snapshot.id);
      toast.success('Actual-path snapshot opened.');
    } catch (value) { toast.error(errorMessage(value)); }
    finally { setWorking(null); }
  }

  const targets = useMemo(() => {
    if (!map) return [];
    return [{ type: 'journey' as const, id: map.definition.id, name: map.definition.name },
      ...map.stages.map((stage) => ({ type: 'stage' as const, id: stage.id, name: stage.name })),
      ...map.cards.filter((card) => card.kind === 'touchpoint').map((card) => ({ type: 'touchpoint' as const, id: card.id, name: card.title })),
      ...map.personas.map((persona) => ({ type: 'persona' as const, id: persona.id, name: persona.name })),
      ...segments.filter((segment) => segment.state === 'active').map((segment) => ({ type: 'segment' as const, id: segment.id, name: segment.name }))];
  }, [map, segments]);

  function openMetric(definition?: JourneyMetricDefinition) {
    if (!map) return; setEditingDefinition(definition || null);
    if (definition?.currentVersion) {
      const version = definition.currentVersion;
      const native = version.nativeSource;
      setMetricDraft({ name: definition.name, targetType: definition.targetType, targetId: definition.targetId,
        bindingId: version.bindingId || '', calculatorKind: version.calculatorKind === 'operational' ? 'nps' : version.calculatorKind,
        windowDays: String(version.windowSeconds / 86_400), freshnessHours: String(version.freshnessMaxAgeSeconds / 3_600),
        minimumSampleSize: String(version.minimumSampleSize), baselineValue: version.baselineValue === null ? '' : String(version.baselineValue),
        targetValue: version.targetValue === null ? '' : String(version.targetValue),
        sourceMode: native?.adapter || 'survey', nativeSourceIds: native?.sourceIds || [],
        nativeKind: (String(version.configuration.kind || 'ticket_rate') as JourneyNativeMeasureKind),
        nativeStageTargeted: Boolean(native?.stageId) });
    } else {
      const firstBinding = definitionBindings[0];
      setMetricDraft({ ...emptyMetricDraft, targetType: firstBinding?.targetType || 'journey',
        targetId: firstBinding?.targetId || map.definition.id, bindingId: firstBinding?.id || '' });
    }
    setMetricOpen(true);
  }

  function nativeVersionDraft() {
    const adapter = metricDraft.sourceMode as JourneyNativeMetricAdapter;
    if (!metricDraft.nativeSourceIds.length) {
      throw new Error(adapter === 'service_recovery_tickets'
        ? 'Choose at least one authorised survey whose recovery cases this measure may read.'
        : 'Choose at least one authorised social connection this measure may read.');
    }
    // Stage targeting is only offered for a stage target and is refused by the
    // server unless a governed research link already attaches this source type
    // to that exact stage. Nothing is inferred from an unlinked source.
    const stageId = metricDraft.nativeStageTargeted && metricDraft.targetType === 'stage'
      ? metricDraft.targetId : null;
    return nativeMetricVersion({ name: metricDraft.name.trim(), adapter, sourceIds: metricDraft.nativeSourceIds,
      kind: metricDraft.nativeKind, stageId, windowDays: safeNumber(metricDraft.windowDays, 'Window days', 1),
      freshnessHours: safeNumber(metricDraft.freshnessHours, 'Freshness hours', 1),
      minimumSampleSize: safeNumber(metricDraft.minimumSampleSize, 'Minimum sample', 1),
      baselineValue: optionalNumber(metricDraft.baselineValue), targetValue: optionalNumber(metricDraft.targetValue),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' });
  }

  async function saveMetric(event: FormEvent) {
    event.preventDefault(); if (!map) return;
    try {
      if (metricDraft.sourceMode === 'survey' && (!selectedMetricQuestion
        || selectedMetricQuestion.type !== metricDraft.calculatorKind)) {
        throw new Error('Choose a question whose NPS, CSAT, or CES type matches the calculator.');
      }
      const version = metricDraft.sourceMode === 'survey'
        ? surveyMetricVersion({ name: metricDraft.name.trim(), bindingId: metricDraft.bindingId,
          calculatorKind: metricDraft.calculatorKind, windowDays: safeNumber(metricDraft.windowDays, 'Window days', 1),
          freshnessHours: safeNumber(metricDraft.freshnessHours, 'Freshness hours', 1),
          minimumSampleSize: safeNumber(metricDraft.minimumSampleSize, 'Minimum sample', 1),
          baselineValue: optionalNumber(metricDraft.baselineValue), targetValue: optionalNumber(metricDraft.targetValue),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' })
        : nativeVersionDraft();
      setWorking('metric-save');
      if (editingDefinition) await createJourneyMetricDefinitionVersion(editingDefinition.id, { expectedRevision: editingDefinition.revision, version });
      else await createJourneyMetricDefinition({ journeyDefinitionId: map.definition.id, targetType: metricDraft.targetType,
        targetId: metricDraft.targetId, name: metricDraft.name.trim(), version });
      toast.success(editingDefinition ? 'Metric definition version created.' : 'Metric definition created.');
      setMetricOpen(false); await loadJourney(map.definition.id);
    } catch (value) { toast.error(errorMessage(value)); }
    finally { setWorking(null); }
  }

  function openBinding() {
    if (!map) return; const surveyId = surveys[0]?.id || '';
    setBindingDraft({ ...emptyBindingDraft, targetId: map.definition.id, surveyId }); setBindingOpen(true);
  }
  async function saveBinding(event: FormEvent) {
    event.preventDefault(); if (!map) return; setWorking('binding-save');
    try {
      await createJourneyMetricBinding({ journeyDefinitionId: map.definition.id, targetType: bindingDraft.targetType,
        targetId: bindingDraft.targetId, surveyId: bindingDraft.surveyId, collectorId: bindingDraft.collectorId || null,
        questionId: bindingDraft.questionId || null });
      toast.success('Survey source bound to the journey target.'); setBindingOpen(false); await loadJourney(map.definition.id);
    } catch (value) { toast.error(errorMessage(value)); }
    finally { setWorking(null); }
  }
  async function changeBindingState(binding: JourneyMetricBinding) {
    if (!map) return; setWorking(`binding-${binding.id}`);
    try { await updateJourneyMetricBinding(binding.id, { expectedRevision: binding.revision,
      state: binding.state === 'active' ? 'retired' : 'active' }); await loadJourney(map.definition.id); }
    catch (value) { toast.error(errorMessage(value)); } finally { setWorking(null); }
  }

  function openSegment(segment?: JourneyMetricSegment) {
    setEditingSegment(segment || null); setSegmentRuleError('');
    setSegmentDraft(segment ? { name: segment.name, description: segment.description, rule: JSON.stringify(segment.rule, null, 2) } : emptySegmentDraft);
    setSegmentOpen(true);
  }
  async function saveSegment(event: FormEvent) {
    event.preventDefault(); if (!map) return; let rule: Record<string, unknown>;
    try { const parsed = JSON.parse(segmentDraft.rule) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Rule must be a JSON object.');
      rule = parsed as Record<string, unknown>; setSegmentRuleError('');
    } catch (value) { setSegmentRuleError(value instanceof Error ? value.message : 'Rule must be valid JSON.'); return; }
    setWorking('segment-save');
    try {
      if (editingSegment) await updateJourneyMetricSegment(editingSegment.id, { expectedRevision: editingSegment.revision,
        name: segmentDraft.name.trim(), description: segmentDraft.description.trim(), rule });
      else await createJourneyMetricSegment({ journeyDefinitionId: map.definition.id, name: segmentDraft.name.trim(),
        description: segmentDraft.description.trim(), rule });
      toast.success(editingSegment ? 'Segment updated.' : 'Segment created.'); setSegmentOpen(false); await loadJourney(map.definition.id);
    } catch (value) { toast.error(errorMessage(value)); } finally { setWorking(null); }
  }
  async function changeSegmentState(segment: JourneyMetricSegment) {
    if (!map) return; setWorking(`segment-${segment.id}`);
    try { await updateJourneyMetricSegment(segment.id, { expectedRevision: segment.revision,
      state: segment.state === 'active' ? 'retired' : 'active' }); await loadJourney(map.definition.id); }
    catch (value) { toast.error(errorMessage(value)); } finally { setWorking(null); }
  }

  async function rebuild(definition: JourneyMetricDefinition) {
    if (!map) return; setWorking(`rebuild-${definition.id}`);
    try { await queueJourneyMetricRebuild(definition.id); toast.success('Metric rebuild queued.'); await loadJourney(map.definition.id); }
    catch (value) { toast.error(errorMessage(value)); } finally { setWorking(null); }
  }

  function openAlertDefinition(definition?: JourneyMetricAlertDefinition) {
    const version = definition?.currentVersion; const metric = definitions.find((item) => item.id === definition?.metricDefinitionId);
    setEditingAlertDefinition(definition || null); setAlertDraft({
      name: definition?.name || '', metricDefinitionId: definition?.metricDefinitionId || activeDefinitions[0]?.id || '',
      ruleKind: version?.ruleKind || 'falling_metric', thresholdValue: String(version?.thresholdValue || 5),
      windowDays: String((version?.windowSeconds || 2_592_000) / 86_400),
      cooldownHours: String((version?.cooldownSeconds || 86_400) / 3_600),
      minimumSampleSize: String(version?.minimumSampleSize || metric?.currentVersion?.minimumSampleSize || 30),
      staleHours: String((version?.staleAfterSeconds || 172_800) / 3_600),
      contradictionRatio: String(version?.contradictionMinRatio || 0.2)
    }); setAlertOpen(true);
  }
  async function saveAlert(event: FormEvent) {
    event.preventDefault(); if (!map) return; const metric = definitions.find((item) => item.id === alertDraft.metricDefinitionId);
    if (!metric?.currentVersion) { toast.error('Select an active metric definition.'); return; }
    const falling = alertDraft.ruleKind === 'falling_metric';
    if (falling && metric.currentVersion.direction === 'neutral') { toast.error('A falling alert needs a metric with a higher- or lower-is-better direction.'); return; }
    const version = { ruleKind: alertDraft.ruleKind,
      direction: falling ? (metric.currentVersion.direction === 'lower_is_better' ? 'increase' as const : 'decrease' as const) : 'any' as const,
      thresholdValue: falling ? safeNumber(alertDraft.thresholdValue, 'Threshold', 0.000001) : 0,
      windowSeconds: Math.round(safeNumber(alertDraft.windowDays, 'Window', 1 / 1_440) * 86_400),
      cooldownSeconds: Math.round(safeNumber(alertDraft.cooldownHours, 'Cooldown', 1 / 60) * 3_600),
      minimumSampleSize: Math.round(safeNumber(alertDraft.minimumSampleSize, 'Minimum sample size', 2)),
      staleAfterSeconds: Math.round(safeNumber(alertDraft.staleHours, 'Stale age', 1 / 60) * 3_600),
      contradictionMinRatio: safeNumber(alertDraft.contradictionRatio, 'Contradiction ratio', 0.01) };
    if (version.contradictionMinRatio > 0.5) { toast.error('Contradiction ratio cannot exceed 0.5.'); return; }
    setWorking('alert-save');
    try {
      if (editingAlertDefinition) {
        await createJourneyMetricAlertVersion(editingAlertDefinition.id, editingAlertDefinition.revision, version);
        if (alertDraft.name.trim() !== editingAlertDefinition.name) await updateJourneyMetricAlertDefinition(
          editingAlertDefinition.id, { expectedRevision: editingAlertDefinition.revision + 1, name: alertDraft.name.trim() });
      } else await createJourneyMetricAlertDefinition({ journeyDefinitionId: map.definition.id,
        metricDefinitionId: metric.id, name: alertDraft.name.trim(), version });
      setAlertOpen(false); toast.success(editingAlertDefinition ? 'Alert definition version created.' : 'Alert definition created.');
      await loadJourney(map.definition.id);
    } catch (value) { toast.error(errorMessage(value)); } finally { setWorking(null); }
  }
  async function evaluateAlerts() {
    if (!map) return; setWorking('alert-evaluate'); try { const run = await evaluateJourneyMetricAlerts(map.definition.id);
      toast.success(`Evaluated ${run.evaluatedCount} alert definition${run.evaluatedCount === 1 ? '' : 's'}.`); await loadJourney(map.definition.id);
    } catch (value) { toast.error(errorMessage(value)); } finally { setWorking(null); }
  }
  async function changeAlertDefinitionState(definition: JourneyMetricAlertDefinition) {
    if (!map) return; setWorking(`alert-definition-${definition.id}`); try {
      await updateJourneyMetricAlertDefinition(definition.id, { expectedRevision: definition.revision,
        state: definition.state === 'active' ? 'disabled' : 'active' }); await loadJourney(map.definition.id);
    } catch (value) { toast.error(errorMessage(value)); } finally { setWorking(null); }
  }
  async function changeAlert(alert: JourneyMetricAlert, action: 'acknowledge' | 'snooze' | 'resolve') {
    if (!map) return; setWorking(`alert-${alert.id}-${action}`); try {
      await transitionJourneyMetricAlert(alert.id, { expectedRevision: alert.revision, action,
        ...(action === 'snooze' ? { snoozedUntil: new Date(Date.now() + 86_400_000).toISOString() } : {}) });
      await loadJourney(map.definition.id);
    } catch (value) { toast.error(errorMessage(value)); } finally { setWorking(null); }
  }
  async function changeNotification(notification: JourneyMetricAlertNotification, state: 'read' | 'dismissed') {
    if (!map) return; setWorking(`alert-notification-${notification.id}`); try {
      await updateJourneyMetricAlertNotification(notification.id, notification.revision, state); await loadJourney(map.definition.id);
    } catch (value) { toast.error(errorMessage(value)); } finally { setWorking(null); }
  }
  async function toggleAlertPreference() {
    if (!map || !alertPreference?.eligible) return; setWorking('alert-preference'); try {
      await updateJourneyMetricAlertNotificationPreference(!alertPreference.enabled, alertPreference.revision);
      await loadJourney(map.definition.id);
    } catch (value) { toast.error(errorMessage(value)); } finally { setWorking(null); }
  }

  async function inspect(observation: JourneyMetricObservation, definition: JourneyMetricDefinition) {
    setLineageOpen(true); setLineageDefinition(definition); setLineageObservation(observation);
    setLineageVersion(definition.currentVersion?.id === observation.definitionVersionId ? definition.currentVersion : null);
    setLineageLoading(true);
    try {
      const [exactObservation, detail] = await Promise.all([
        readJourneyMetricObservationLineage(observation.id), readJourneyMetricDefinition(definition.id)
      ]);
      const exactVersion = detail.versions.find((version) => version.id === exactObservation.definitionVersionId);
      if (!exactVersion) throw new Error('The immutable definition version for this observation is unavailable.');
      setLineageDefinition(detail.definition); setLineageVersion(exactVersion); setLineageObservation(exactObservation);
    }
    catch (value) { toast.error(errorMessage(value)); }
    finally { setLineageLoading(false); }
  }

  if (!enabled) return null;
  return <div className="mx-auto w-full max-w-[1440px] space-y-5 px-4 py-5 sm:px-6 sm:py-6" data-testid="journey-metrics-page">
    <header className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-start lg:justify-between">
      <div><h1 className="page-title">Journey Metrics</h1><p className="page-description">
        Connect governed measures to journey targets, compare real observations, and inspect the evidence behind every reported value.
      </p></div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div><Label htmlFor="journey-metric-map" className="field-label">Journey map</Label>
          <select id="journey-metric-map" className="h-9 min-w-[240px] rounded-md border border-input bg-background px-3 text-sm"
            value={journeyId} onChange={(event) => setJourneyId(event.target.value)}>
            {journeys.map((journey) => <option key={journey.id} value={journey.id}>{journey.name}</option>)}
          </select></div>
        <Button variant="outline" disabled={loading || !journeyId} onClick={() => void loadJourney(journeyId)}>
          {loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}Refresh
        </Button>
      </div>
    </header>

    {!canManage && <div className="border bg-muted/30 px-4 py-3 text-sm" data-testid="journey-metrics-read-only">
      You have read-only access. You can inspect definitions, observations, and exact source lineage; owners and administrators manage sources and rebuilds.
    </div>}
    {error && <div role="alert" className="border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">{error}</div>}
    {!loading && journeys.length === 0 && <div className="border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
      Create a journey map before configuring metrics.
    </div>}

    {map && <Tabs defaultValue="analytics">
      <div className="overflow-x-auto"><TabsList className="min-w-max" aria-label="Journey metric workspace sections">
        <TabsTrigger value="analytics"><BarChart3 className="mr-2 h-4 w-4" />Analytics</TabsTrigger>
        <TabsTrigger value="definitions"><Gauge className="mr-2 h-4 w-4" />Definitions ({definitions.length})</TabsTrigger>
        <TabsTrigger value="sources"><Database className="mr-2 h-4 w-4" />Sources ({activeBindings.length})</TabsTrigger>
        <TabsTrigger value="segments"><Layers3 className="mr-2 h-4 w-4" />Segments ({segments.length})</TabsTrigger>
        <TabsTrigger value="alerts"><Bell className="mr-2 h-4 w-4" />Alerts ({alerts.filter((alert) => alert.state !== 'resolved').length})</TabsTrigger>
        <TabsTrigger value="activity"><Activity className="mr-2 h-4 w-4" />Rebuild activity ({rebuilds.length})</TabsTrigger>
      </TabsList></div>

      <TabsContent value="analytics" className="space-y-4">
        <form className="border bg-card" onSubmit={(event) => {
          event.preventDefault();
          if (rangeDraft.from && rangeDraft.to && rangeDraft.from > rangeDraft.to) { toast.error('The start date must not be after the end date.'); return; }
          setRange({ ...rangeDraft }); setComparison({ ...comparisonDraft });
        }}>
          <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-end">
          <div><Label htmlFor="metric-range-from" className="field-label">Period from</Label><Input id="metric-range-from" type="date" value={rangeDraft.from}
            onChange={(event) => setRangeDraft((current) => ({ ...current, from: event.target.value }))} /></div>
          <div><Label htmlFor="metric-range-to" className="field-label">Period to</Label><Input id="metric-range-to" type="date" value={rangeDraft.to}
            onChange={(event) => setRangeDraft((current) => ({ ...current, to: event.target.value }))} /></div>
          <Button type="submit" variant="outline" disabled={loading}>Apply filters</Button>
          {(range.from || range.to || comparisonKeys.length > 0) && <Button type="button" variant="ghost" onClick={() => {
            setRangeDraft({ from: '', to: '' }); setRange({ from: '', to: '' });
            setComparisonDraft({}); setComparison({});
          }}>Clear</Button>}
          <p className="text-xs text-muted-foreground sm:ml-auto sm:max-w-sm">Up to 100 immutable observations for the selected journey are shown. The selected period filters by observation window.</p>
        </div>
        <fieldset className="grid gap-3 border-t px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
          <legend className="sr-only">Compare authorised observations by target type, persona, segment and channel</legend>
          <FacetSelect id="metric-facet-target" title="Target type" options={targetTypeOptions}
            selected={comparisonDraft.targetTypes || []}
            onChange={(next) => setComparisonDraft((current) => ({ ...current,
              targetTypes: next as JourneyMetricTargetType[] }))} />
          <FacetSelect id="metric-facet-persona" title="Persona" options={personaOptions}
            selected={comparisonDraft.personaIds || []}
            onChange={(next) => setComparisonDraft((current) => ({ ...current, personaIds: next }))} />
          <FacetSelect id="metric-facet-segment" title="Segment" options={segmentOptions}
            selected={comparisonDraft.segmentIds || []}
            onChange={(next) => setComparisonDraft((current) => ({ ...current, segmentIds: next }))} />
          {richCardsEnabled && <FacetSelect id="metric-facet-channel" title="Channel" options={channels}
            selected={comparisonDraft.channelIds || []}
            onChange={(next) => setComparisonDraft((current) => ({ ...current, channelIds: next }))} />}
        </fieldset>
      </form>

      {appliedFilters && <section className="border bg-card px-4 py-3" aria-labelledby="applied-filters-heading"
        data-testid="journey-metrics-applied-filters">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="applied-filters-heading" className="text-sm font-semibold">Filters applied by the server</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              These are the filters the backend actually applied. Values are selected from materialised authorised
              observations for this scope; they are not recomputed when you change a filter.
            </p>
            <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
              <div><dt className="inline font-medium">Window: </dt><dd className="inline text-muted-foreground">
                {appliedFilters.window.from || appliedFilters.window.to
                  ? `${formatDate(appliedFilters.window.from)} to ${formatDate(appliedFilters.window.to)}`
                  : 'All observation windows'}</dd></div>
              <div><dt className="inline font-medium">Target types: </dt><dd className="inline text-muted-foreground">
                {appliedFilters.targetTypes.length ? appliedFilters.targetTypes.map(label).join(', ') : 'All'}</dd></div>
              <div><dt className="inline font-medium">Personas: </dt><dd className="inline text-muted-foreground">
                {appliedFilters.personas.length ? appliedFilters.personas.map((row) => row.name).join(', ') : 'All'}</dd></div>
              <div><dt className="inline font-medium">Segments: </dt><dd className="inline text-muted-foreground">
                {appliedFilters.segments.length ? appliedFilters.segments.map((row) => row.name).join(', ') : 'All'}</dd></div>
              <div><dt className="inline font-medium">Channels: </dt><dd className="inline text-muted-foreground">
                {richCardsEnabled ? (appliedFilters.channels.length
                  ? appliedFilters.channels.map((row) => row.name).join(', ') : 'All')
                  : 'Unavailable on this plan'}</dd></div>
              <div><dt className="inline font-medium">Cohorts: </dt><dd className="inline text-muted-foreground">
                Not available — this space has no governed cohort catalogue, so cohort comparison is not offered.</dd></div>
            </dl>
            {appliedFilters.truncated && <p className="mt-2 text-xs text-amber-700" role="status">
              More than {appliedFilters.limit} observations match. This view and any export are truncated to the first
              {' '}{appliedFilters.limit}; narrow the window or filters for a complete set.
            </p>}
          </div>
          {exportsEnabled && <div className="flex flex-wrap gap-2">
            {journeyMetricAnalyticsExportFormats.map((format) => <Button key={format} size="sm" variant="outline"
              disabled={Boolean(exporting) || loading || !observations.length}
              onClick={() => void exportAnalytics(format)}>
              {exporting === format ? <LoaderCircle className="animate-spin" /> : <Download />}
              Export {format.toUpperCase()}
            </Button>)}
          </div>}
        </div>
      </section>}
        <section className="border bg-card" aria-labelledby="metric-health-heading">
          <div className="border-b px-4 py-3"><h2 id="metric-health-heading" className="text-sm font-semibold">Measurement health</h2>
            <p className="mt-1 text-sm text-muted-foreground">Coverage is descriptive only; it does not imply that a metric caused a journey outcome.</p></div>
          <dl className="grid divide-y text-sm sm:grid-cols-2 sm:divide-x lg:grid-cols-4 lg:divide-y-0">
            <div className="px-4 py-3"><dt className="text-muted-foreground">Active definitions</dt><dd className="mt-1 font-semibold">{activeDefinitions.length} configured</dd></div>
            <div className="px-4 py-3"><dt className="text-muted-foreground">Fresh current observations</dt><dd className="mt-1 font-semibold">{freshCount} of {activeDefinitions.length}</dd></div>
            <div className="px-4 py-3"><dt className="text-muted-foreground">Stage metric coverage</dt><dd className="mt-1 font-semibold">{definedStageIds.size} of {map.stages.length} stages</dd></div>
            <div className="px-4 py-3"><dt className="text-muted-foreground">Stage research coverage</dt><dd className="mt-1 font-semibold">{researchCoveredStageCount} of {map.stages.length} stages</dd></div>
          </dl>
        </section>

        {actualPathsEnabled && <section className="overflow-hidden border bg-card" aria-labelledby="actual-paths-heading">
          <div className="border-b px-4 py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 id="actual-paths-heading" className="text-sm font-semibold">
                  Actual paths ({actualPathSubjectKind === 'known_profiles' ? 'known-profile stitched view' : 'anonymous observed journeys'})
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {actualPathSubjectKind === 'known_profiles'
                    ? 'This view reuses existing anonymous bindings and current account memberships to stitch observed paths onto known profiles where deterministic identity links already exist.'
                    : 'This view stays anonymous-instance scoped. It compares observed paths against one designed journey version and stays descriptive only.'}
                </p>
              </div>
              <div className="inline-flex rounded-md border bg-background p-1">
                <Button
                  size="sm"
                  variant={actualPathSubjectKind === 'anonymous_only' ? 'default' : 'ghost'}
                  onClick={() => setActualPathSubjectKind('anonymous_only')}
                  disabled={loading || working === 'actual-path-rollup' || working === 'actual-path-snapshot'}
                >
                  Anonymous
                </Button>
                <Button
                  size="sm"
                  variant={actualPathSubjectKind === 'known_profiles' ? 'default' : 'ghost'}
                  onClick={() => setActualPathSubjectKind('known_profiles')}
                  disabled={loading || working === 'actual-path-rollup' || working === 'actual-path-snapshot'}
                >
                  Known profiles
                </Button>
              </div>
            </div>
          </div>
          {!actualPaths && <div className="px-4 py-8 text-sm text-muted-foreground">No observed path analytics are available for this journey and period yet.</div>}
          {actualPaths && <div className="space-y-4 p-4">
            {actualPaths.scope.subjectKind === 'known_profiles' && actualPaths.scope.stitchedSubjectSummary && <div className="grid gap-3 rounded-md border bg-muted/20 px-4 py-3 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">Stitched known profiles</p>
                <p className="mt-1 text-sm font-semibold">{actualPaths.scope.stitchedSubjectSummary.stitchedKnownProfileCount}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Stitched accounts</p>
                <p className="mt-1 text-sm font-semibold">{actualPaths.scope.stitchedSubjectSummary.stitchedAccountCount}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Observed anonymous instances</p>
                <p className="mt-1 text-sm font-semibold">{actualPaths.scope.stitchedSubjectSummary.anonymousInstanceCount}</p>
              </div>
            </div>}
            <div className="flex flex-col gap-3 rounded-md border bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium">Durable rollup</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {latestActualPathRollup
                    ? `Latest materialized ${actualPathSubjectKind === 'known_profiles' ? 'known-profile stitched' : 'anonymous'} rollup refreshed ${formatDate(latestActualPathRollup.materializedAt)} for this journey.`
                    : `No durable ${actualPathSubjectKind === 'known_profiles' ? 'known-profile stitched' : 'anonymous'} actual-path rollup has been materialized for this journey yet.`}
                </p>
                {latestActualPathRollup && <p className={`mt-2 text-xs ${latestActualPathRollup.freshness.status === 'current' ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {latestActualPathRollup.freshness.status === 'current'
                    ? `This durable rollup is current for the latest observed ${actualPathSubjectKind === 'known_profiles' ? 'known-profile stitched' : 'anonymous-path'} data we can see right now.`
                    : `This durable rollup is stale. ${latestActualPathRollup.freshness.staleReasons.includes('newer_observed_visit')
                      ? 'Newer observed visits arrived after the current rollup. ' : ''}${latestActualPathRollup.freshness.staleReasons.includes('newer_completed_reprojection')
                      ? 'A newer completed stage reprojection exists for this journey version.' : ''}`}
                </p>}
                {latestActualPathRollup && <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-md border bg-background px-3 py-2">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Accepted instances</p>
                    <p className="mt-1 text-xs font-medium">{pathCount(latestActualPathRollup.summary.acceptedInstanceCount)}</p>
                  </div>
                  <div className="rounded-md border bg-background px-3 py-2">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Accepted visits</p>
                    <p className="mt-1 text-xs font-medium">{pathCount(latestActualPathRollup.summary.acceptedVisitCount)}</p>
                  </div>
                  <div className="rounded-md border bg-background px-3 py-2">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Unobserved stages</p>
                    <p className="mt-1 text-xs font-medium">{latestActualPathRollup.summary.unobservedStageCount}</p>
                  </div>
                  <div className="rounded-md border bg-background px-3 py-2">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">At-risk stages</p>
                    <p className="mt-1 text-xs font-medium">{latestActualPathRollup.summary.atRiskStageCount}</p>
                  </div>
                </div>}
              </div>
              {canManage && <Button variant="outline" onClick={() => void refreshActualPathRollup()}
                disabled={working === 'actual-path-rollup'}>
                {working === 'actual-path-rollup' ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
                {latestActualPathRollup ? 'Refresh rollup' : 'Materialize rollup'}
              </Button>}
            </div>
            <div className="flex flex-col gap-3 rounded-md border bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium">Durable snapshot</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {latestActualPathSnapshot
                    ? `Latest persisted ${actualPathSubjectKind === 'known_profiles' ? 'known-profile stitched' : 'anonymous'} snapshot saved ${formatDate(latestActualPathSnapshot.createdAt)} for this journey.`
                    : `No persisted ${actualPathSubjectKind === 'known_profiles' ? 'known-profile stitched' : 'anonymous'} actual-path snapshot has been saved for this journey yet.`}
                </p>
                {selectedActualPathSnapshotId && <p className="mt-2 text-xs text-muted-foreground">
                  Viewing saved snapshot {selectedActualPathSnapshotId === latestActualPathSnapshot?.id ? '(latest)' : '(historical)'}.
                </p>}
                {latestActualPathSnapshot && <p className={`mt-2 text-xs ${latestActualPathSnapshot.freshness.status === 'current' ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {latestActualPathSnapshot.freshness.status === 'current'
                    ? `This snapshot is current for the latest observed ${actualPathSubjectKind === 'known_profiles' ? 'known-profile stitched' : 'anonymous-path'} data we can see right now.`
                    : `This snapshot is stale. ${latestActualPathSnapshot.freshness.staleReasons.includes('newer_observed_visit')
                      ? 'Newer observed visits arrived after the snapshot scope. ' : ''}${latestActualPathSnapshot.freshness.staleReasons.includes('newer_completed_reprojection')
                      ? 'A newer completed stage reprojection exists for this journey version.' : ''}`}
                </p>}
                {selectedActualPathSnapshotId && (() => {
                  const viewedSnapshot = actualPathSnapshots.find((snapshot) => snapshot.id === selectedActualPathSnapshotId)
                    || (latestActualPathSnapshot?.id === selectedActualPathSnapshotId ? latestActualPathSnapshot : null);
                  if (!viewedSnapshot) return null;
                  return <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                    <div className="rounded-md border bg-background px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Current lineage as of</p>
                      <p className="mt-1 text-xs font-medium">{formatDate(viewedSnapshot.reconciliation.currentAsOf)}</p>
                    </div>
                    <div className="rounded-md border bg-background px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Accepted instances delta</p>
                      <p className="mt-1 text-xs font-medium">{deltaLabel(viewedSnapshot.reconciliation.deltas.acceptedInstanceCount)}</p>
                    </div>
                    <div className="rounded-md border bg-background px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Accepted visits delta</p>
                      <p className="mt-1 text-xs font-medium">{deltaLabel(viewedSnapshot.reconciliation.deltas.acceptedVisitCount)}</p>
                    </div>
                    <div className="rounded-md border bg-background px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Unobserved stages delta</p>
                      <p className="mt-1 text-xs font-medium">{deltaLabel(viewedSnapshot.reconciliation.deltas.unobservedStageCount)}</p>
                    </div>
                    <div className="rounded-md border bg-background px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">At-risk stages delta</p>
                      <p className="mt-1 text-xs font-medium">{deltaLabel(viewedSnapshot.reconciliation.deltas.atRiskStageCount)}</p>
                    </div>
                    <div className="rounded-md border bg-background px-3 py-2 sm:col-span-2 xl:col-span-5">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Design version reconciliation</p>
                      <p className="mt-1 text-xs font-medium">
                        {viewedSnapshot.reconciliation.designVersionChanged
                          ? 'The current designed journey version differs from the version saved in this snapshot.'
                          : 'The current designed journey version still matches the version saved in this snapshot.'}
                      </p>
                    </div>
                  </div>;
                })()}
              </div>
              {canManage && <Button variant="outline" onClick={() => void saveActualPathSnapshot()}
                disabled={working === 'actual-path-snapshot'}>
                {working === 'actual-path-snapshot' ? <LoaderCircle className="animate-spin" /> : <Save />}
                Save snapshot
              </Button>}
            </div>
            {!!actualPathSnapshots.length && <section className="overflow-hidden border">
              <div className="border-b px-4 py-3">
                <h3 className="text-sm font-semibold">Snapshot history</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Recent persisted {actualPathSubjectKind === 'known_profiles' ? 'known-profile stitched' : 'anonymous'} path snapshots for this journey, with freshness status.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] border-collapse text-sm">
                  <thead><tr className="border-b bg-muted/30 text-left text-xs"><th className="px-4 py-2">Saved</th><th className="px-4 py-2">Window</th><th className="px-4 py-2">As of</th><th className="px-4 py-2">Accepted instances</th><th className="px-4 py-2">Unobserved stages</th><th className="px-4 py-2">At-risk stages</th><th className="px-4 py-2">Freshness</th><th className="px-4 py-2 text-right">Action</th></tr></thead>
                  <tbody>{actualPathSnapshots.map((snapshot) => <tr key={snapshot.id} className="border-b last:border-b-0">
                    <td className="px-4 py-3">{formatDate(snapshot.createdAt)}</td>
                    <td className="px-4 py-3">{formatDate(snapshot.period.start)} to {formatDate(snapshot.period.end)}</td>
                    <td className="px-4 py-3">{formatDate(snapshot.asOf)}</td>
                    <td className="px-4 py-3">{pathCount(snapshot.summary.acceptedInstanceCount)}</td>
                    <td className="px-4 py-3">{snapshot.summary.unobservedStageCount}</td>
                    <td className="px-4 py-3">{snapshot.summary.atRiskStageCount}</td>
                    <td className={`px-4 py-3 font-medium ${snapshot.freshness.status === 'current' ? 'text-emerald-700' : 'text-amber-700'}`}>
                      {label(snapshot.freshness.status)}
                    </td>
                    <td className="px-4 py-3 text-right"><Button size="sm" variant={selectedActualPathSnapshotId === snapshot.id ? 'default' : 'outline'}
                      disabled={working === `actual-path-open-${snapshot.id}`}
                      onClick={() => void inspectActualPathSnapshot(snapshot.id)}>
                      {working === `actual-path-open-${snapshot.id}` ? <LoaderCircle className="animate-spin" /> : <Eye />}
                      Open
                    </Button></td>
                  </tr>)}</tbody>
                </table>
              </div>
            </section>}
            <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="border bg-muted/20 px-3 py-3"><dt className="text-xs text-muted-foreground">Accepted instances</dt>
                <dd className="mt-1 text-sm font-semibold">{pathCount(actualPaths.analytics.sample.acceptedInstanceCount, actualPaths.analytics.sample.suppressed)}</dd></div>
              <div className="border bg-muted/20 px-3 py-3"><dt className="text-xs text-muted-foreground">Accepted visits</dt>
                <dd className="mt-1 text-sm font-semibold">{pathCount(actualPaths.analytics.sample.acceptedVisitCount, actualPaths.analytics.sample.suppressed)}</dd></div>
              <div className="border bg-muted/20 px-3 py-3"><dt className="text-xs text-muted-foreground">Journey version</dt>
                <dd className="mt-1 text-sm font-semibold capitalize">{actualPaths.scope.designVersionSource}</dd></div>
              <div className="border bg-muted/20 px-3 py-3"><dt className="text-xs text-muted-foreground">Suppression threshold</dt>
                <dd className="mt-1 text-sm font-semibold">{actualPaths.analytics.tables.pathSignatures.suppression.minimumCohortSize}</dd></div>
            </dl>

            <div className="grid gap-4 xl:grid-cols-2">
              <section className="overflow-hidden border">
                <div className="border-b px-4 py-3">
                  <h3 className="text-sm font-semibold">Most common observed paths</h3>
                  <p className="mt-1 text-xs text-muted-foreground">Top anonymous path signatures for the selected period and version.</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[680px] border-collapse text-sm">
                    <thead><tr className="border-b bg-muted/30 text-left text-xs"><th className="px-4 py-2">Observed path</th><th className="px-4 py-2">Instances</th><th className="px-4 py-2">Share</th></tr></thead>
                    <tbody>{actualPaths.analytics.tables.pathSignatures.rows.slice(0, 8).map((row) => <tr key={row.signature} className="border-b last:border-b-0">
                      <td className="px-4 py-3">{row.stageIds.map((stageId) => stageNameById.get(stageId) || stageId).join(' → ')}</td>
                      <td className="px-4 py-3">{pathCount(row.measure.numerator, row.measure.suppressed)}</td>
                      <td className="px-4 py-3">{pathPercent(row.measure.percentage, row.measure.suppressed)}</td>
                    </tr>)}{!actualPaths.analytics.tables.pathSignatures.rows.length && <tr><td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">No accepted paths in this period.</td></tr>}</tbody>
                  </table>
                </div>
              </section>

              <section className="overflow-hidden border">
                <div className="border-b px-4 py-3">
                  <h3 className="text-sm font-semibold">Designed funnel versus observed progression</h3>
                  <p className="mt-1 text-xs text-muted-foreground">Observed progression through the selected designed stage order.</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[680px] border-collapse text-sm">
                    <thead><tr className="border-b bg-muted/30 text-left text-xs"><th className="px-4 py-2">Stage</th><th className="px-4 py-2">Entrants</th><th className="px-4 py-2">Completed</th><th className="px-4 py-2">Drop-off before next</th></tr></thead>
                    <tbody>{actualPaths.analytics.tables.funnel.rows.map((row) => <tr key={row.stageId} className="border-b last:border-b-0">
                      <td className="px-4 py-3">{stageNameById.get(row.stageId) || row.stageId}</td>
                      <td className="px-4 py-3">{pathPercent(row.entrantMeasure.percentage, row.entrantMeasure.suppressed)}</td>
                      <td className="px-4 py-3">{pathPercent(row.completionMeasure.percentage, row.completionMeasure.suppressed)}</td>
                      <td className="px-4 py-3">{pathPercent(row.dropOffBeforeNextMeasure.percentage, row.dropOffBeforeNextMeasure.suppressed)}</td>
                    </tr>)}</tbody>
                  </table>
                </div>
              </section>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <section className="overflow-hidden border">
                <div className="border-b px-4 py-3">
                  <h3 className="text-sm font-semibold">Designed versus observed stage alignment</h3>
                  <p className="mt-1 text-xs text-muted-foreground">This compares the designed stage order with anonymous observed progression for the selected lineage and period.</p>
                </div>
                <div className="grid gap-3 border-b bg-muted/20 px-4 py-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div><p className="text-xs text-muted-foreground">Unobserved designed stages</p><p className="mt-1 text-sm font-semibold">{actualPaths.designedVsObserved.summary.unobservedStageCount}</p></div>
                  <div><p className="text-xs text-muted-foreground">At-risk designed stages</p><p className="mt-1 text-sm font-semibold">{actualPaths.designedVsObserved.summary.atRiskStageCount}</p></div>
                  <div><p className="text-xs text-muted-foreground">Skipped-forward transitions</p><p className="mt-1 text-sm font-semibold">{pathCount(actualPaths.designedVsObserved.summary.skippedForwardTransitionCount)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Loop transitions</p><p className="mt-1 text-sm font-semibold">{pathCount(actualPaths.designedVsObserved.summary.loopTransitionCount)}</p></div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[840px] border-collapse text-sm">
                    <thead><tr className="border-b bg-muted/30 text-left text-xs"><th className="px-4 py-2">Designed stage</th><th className="px-4 py-2">Observed entrants</th><th className="px-4 py-2">Observed completion</th><th className="px-4 py-2">Drop-off before next</th><th className="px-4 py-2">Skipped inbound</th><th className="px-4 py-2">Loops</th><th className="px-4 py-2">Status</th></tr></thead>
                    <tbody>{actualPaths.designedVsObserved.stageRows.map((row) => <tr key={row.stageId} className="border-b last:border-b-0">
                      <td className="px-4 py-3"><div className="font-medium">{row.stageName}</div><div className="text-xs text-muted-foreground">Designed position {row.designedIndex + 1}</div></td>
                      <td className="px-4 py-3">{pathPercent(row.entrantPercentage)}</td>
                      <td className="px-4 py-3">{pathPercent(row.completionPercentage)}</td>
                      <td className="px-4 py-3">{pathPercent(row.dropOffBeforeNextPercentage)}</td>
                      <td className="px-4 py-3">{pathCount(row.skippedInboundTransitions)}</td>
                      <td className="px-4 py-3">{pathCount(row.loopTransitions)}</td>
                      <td className={`px-4 py-3 font-medium ${row.status === 'aligned' ? 'text-emerald-700' : row.status === 'at_risk' ? 'text-amber-700' : 'text-slate-600'}`}>{label(row.status)}</td>
                    </tr>)}</tbody>
                  </table>
                </div>
              </section>

              <section className="overflow-hidden border">
                <div className="border-b px-4 py-3"><h3 className="text-sm font-semibold">Skipped transitions</h3></div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[680px] border-collapse text-sm">
                    <thead><tr className="border-b bg-muted/30 text-left text-xs"><th className="px-4 py-2">Transition</th><th className="px-4 py-2">Missing designed stages</th><th className="px-4 py-2">Occurrences</th></tr></thead>
                    <tbody>{actualPaths.analytics.tables.skippedTransitions.rows.slice(0, 8).map((row, index) => <tr key={`${row.fromStageId}-${row.toStageId}-${index}`} className="border-b last:border-b-0">
                      <td className="px-4 py-3">{stageNameById.get(row.fromStageId) || row.fromStageId} → {stageNameById.get(row.toStageId) || row.toStageId}</td>
                      <td className="px-4 py-3">{row.missingStageIds.length ? row.missingStageIds.map((stageId) => stageNameById.get(stageId) || stageId).join(', ') : '—'}</td>
                      <td className="px-4 py-3">{pathCount(row.measure.numerator, row.measure.suppressed)}</td>
                    </tr>)}{!actualPaths.analytics.tables.skippedTransitions.rows.length && <tr><td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">No skipped transitions detected.</td></tr>}</tbody>
                  </table>
                </div>
              </section>

              <section className="overflow-hidden border">
                <div className="border-b px-4 py-3"><h3 className="text-sm font-semibold">Loops and repeats</h3></div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[680px] border-collapse text-sm">
                    <thead><tr className="border-b bg-muted/30 text-left text-xs"><th className="px-4 py-2">Transition</th><th className="px-4 py-2">Classification</th><th className="px-4 py-2">Occurrences</th></tr></thead>
                    <tbody>{actualPaths.analytics.tables.loops.rows.slice(0, 8).map((row, index) => <tr key={`${row.fromStageId}-${row.toStageId}-${index}`} className="border-b last:border-b-0">
                      <td className="px-4 py-3">{stageNameById.get(row.fromStageId) || row.fromStageId} → {stageNameById.get(row.toStageId) || row.toStageId}</td>
                      <td className="px-4 py-3">{label(row.kind)}</td>
                      <td className="px-4 py-3">{pathCount(row.measure.numerator, row.measure.suppressed)}</td>
                    </tr>)}{!actualPaths.analytics.tables.loops.rows.length && <tr><td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">No backward loops or repeated-stage transitions detected.</td></tr>}</tbody>
                  </table>
                </div>
              </section>
            </div>

            <div className="border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
              <p>{actualPaths.analytics.interpretation.statement}</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {actualPaths.scope.notes.map((note) => <li key={note}>{note}</li>)}
              </ul>
            </div>
          </div>}
        </section>}

        <section className="overflow-hidden border bg-card" aria-labelledby="current-metrics-heading">
          <div className="border-b px-4 py-3"><h2 id="current-metrics-heading" className="text-sm font-semibold">Current measures and comparisons</h2>
            {suppressedCountTotal > 0 && <p className="mt-1 text-sm text-amber-700" data-testid="journey-metrics-suppression-note">
              {suppressedCountTotal} of {observations.length} observations are privacy suppressed. Suppressed measures
              show no value, sample, denominator or source count anywhere in this workspace or its exports.
            </p>}</div>
          {/* Stacked alternative for narrow viewports: the wide table below
              scrolls horizontally, which the quality budget only permits when an
              equivalent non-scrolling outline exists. */}
          <ul className="divide-y lg:hidden" data-testid="journey-metrics-current-stacked">
            {activeDefinitions.map((definition) => {
              const current = (observationsByDefinition.get(definition.id) || [])[0];
              const health = metricHealth(definition, current);
              const note = suppressionNote(current);
              return <li key={definition.id} className="px-4 py-3">
                <p className="text-sm font-medium">{definition.name}</p>
                <p className="text-xs text-muted-foreground">{targetName(map, segments, definition.targetType, definition.targetId)} · {label(definition.targetType)}</p>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  <div><dt className="text-xs text-muted-foreground">Current</dt>
                    <dd className="font-medium"><MetricNumberButton observation={current} definition={definition}
                      onInspect={inspect} labelText={`${definition.name} current value`}>
                      {suppressedMetric(current, current?.value ?? null, current?.unit || '')}</MetricNumberButton></dd></div>
                  <div><dt className="text-xs text-muted-foreground">Sample</dt>
                    <dd><MetricNumberButton observation={current} definition={definition} onInspect={inspect}
                      labelText={`${definition.name} sample size`}>
                      {suppressedCount(current, current?.sampleSize)}</MetricNumberButton></dd></div>
                  <div><dt className="text-xs text-muted-foreground">Window</dt>
                    <dd>{definition.currentVersion ? formatWindow(definition.currentVersion.windowSeconds) : '—'}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Health</dt>
                    <dd className={health.tone}>{health.text}</dd></div>
                </dl>
                {note && <p className="mt-1 text-xs text-amber-700">{note}</p>}
                {current && <Button size="sm" variant="outline" className="mt-2" onClick={() => void inspect(current, definition)}>
                  <Eye />Inspect</Button>}
              </li>;
            })}
            {!activeDefinitions.length && <li className="px-4 py-8 text-center text-sm text-muted-foreground">
              No metric definitions have been configured for this journey.</li>}
          </ul>
          <div className="hidden overflow-x-auto lg:block"><table className="w-full min-w-[1180px] border-collapse text-sm">
            <caption className="sr-only">Current journey metrics with targets, baselines, samples, windows, freshness and prior-period comparisons.</caption>
            <thead><tr className="border-b bg-muted/30 text-left text-xs"><th className="px-4 py-2" scope="col">Measure</th>
              <th className="px-4 py-2" scope="col">Target</th><th className="px-4 py-2" scope="col">Current</th>
              <th className="px-4 py-2" scope="col">Baseline</th><th className="px-4 py-2" scope="col">Goal</th>
              <th className="px-4 py-2" scope="col">Comparable change</th><th className="px-4 py-2" scope="col">Sample</th>
              <th className="px-4 py-2" scope="col">Window</th><th className="px-4 py-2" scope="col">Freshness</th>
              <th className="px-4 py-2" scope="col">Health</th><th className="px-4 py-2 text-right" scope="col">Evidence</th></tr></thead>
            <tbody>{activeDefinitions.map((definition) => {
              const rows = observationsByDefinition.get(definition.id) || []; const current = rows[0];
              const previous = comparablePrevious(current, rows); const version = definition.currentVersion;
              const delta = current?.value !== null && current?.value !== undefined && previous?.value !== null && previous?.value !== undefined
                ? current.value - previous.value : null; const health = metricHealth(definition, current);
              return <tr className="border-b last:border-b-0" key={definition.id}><th className="px-4 py-3 text-left font-medium" scope="row">
                {definition.name}<span className="mt-1 block text-xs font-normal text-muted-foreground">{label(version?.calculatorKind || 'unconfigured')} · v{version?.versionNumber || '—'}</span></th>
                <td className="px-4 py-3">{targetName(map, segments, definition.targetType, definition.targetId)}<span className="mt-1 block text-xs text-muted-foreground">{label(definition.targetType)}</span></td>
                <td className="px-4 py-3"><MetricNumberButton observation={current} definition={definition} onInspect={inspect} labelText={`${definition.name} current value`}>
                  {suppressedMetric(current, current?.value ?? null, current?.unit || '')}</MetricNumberButton>
                  {suppressionNote(current) && <span className="mt-1 block text-xs text-amber-700">{suppressionNote(current)}</span>}</td>
                <td className="px-4 py-3"><MetricNumberButton observation={current} definition={definition} onInspect={inspect} labelText={`${definition.name} baseline`}>
                  {version?.baselineValue === null || version?.baselineValue === undefined ? 'Not set' : formatMetric(version.baselineValue, current?.unit || '')}</MetricNumberButton></td>
                <td className="px-4 py-3"><MetricNumberButton observation={current} definition={definition} onInspect={inspect} labelText={`${definition.name} target`}>
                  {version?.targetValue === null || version?.targetValue === undefined ? 'Not set' : formatMetric(version.targetValue, current?.unit || '')}</MetricNumberButton></td>
                <td className="px-4 py-3">{delta === null ? <span className="text-muted-foreground">No comparable prior period</span>
                  : <MetricNumberButton observation={current} definition={definition} onInspect={inspect} labelText={`${definition.name} comparable change`}>
                    {delta > 0 ? '+' : ''}{formatMetric(delta, current?.unit || '')}</MetricNumberButton>}</td>
                <td className="px-4 py-3"><MetricNumberButton observation={current} definition={definition} onInspect={inspect} labelText={`${definition.name} sample size`}>
                  {suppressedCount(current, current?.sampleSize)}</MetricNumberButton>{current?.minimumSampleWarning && !current.privacy.suppressed && <span className="mt-1 block text-xs text-amber-700">Below minimum {version?.minimumSampleSize}</span>}</td>
                <td className="px-4 py-3"><MetricNumberButton observation={current} definition={definition} onInspect={inspect} labelText={`${definition.name} measurement window`}>
                  {version ? formatWindow(version.windowSeconds) : '—'}</MetricNumberButton></td>
                <td className="px-4 py-3 capitalize">{current?.freshnessStatus || 'unavailable'}<span className="mt-1 block text-xs text-muted-foreground">Observed {formatDate(current?.latestObservedAt || null)}</span></td>
                <td className={`px-4 py-3 font-medium ${health.tone}`}>{health.text}</td>
                <td className="px-4 py-3 text-right">{current ? <Button size="sm" variant="outline" onClick={() => void inspect(current, definition)}><Eye />Inspect</Button> : '—'}</td>
              </tr>;
            })}{!activeDefinitions.length && <tr><td colSpan={11} className="px-4 py-10 text-center text-muted-foreground">No metric definitions have been configured for this journey.</td></tr>}</tbody>
          </table></div>
        </section>

        <section className="overflow-hidden border bg-card" aria-labelledby="target-overlay-heading">
          <div className="border-b px-4 py-3"><h2 id="target-overlay-heading" className="text-sm font-semibold">Stage and target overlay</h2>
            <p className="mt-1 text-sm text-muted-foreground">Measures stay attached to stable journey, stage, touchpoint, persona, or segment identities.</p></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[760px] border-collapse text-sm"><caption className="sr-only">Journey targets and their current metric overlays.</caption>
            <thead><tr className="border-b bg-muted/30 text-left text-xs"><th className="px-4 py-2" scope="col">Target</th><th className="px-4 py-2" scope="col">Type</th>
              <th className="px-4 py-2" scope="col">Measures</th><th className="px-4 py-2" scope="col">Evidence state</th></tr></thead>
            <tbody>{targets.map((target) => { const targetDefinitions = activeDefinitions.filter((definition) => definition.targetType === target.type && definition.targetId === target.id);
              return <tr key={`${target.type}:${target.id}`} className="border-b last:border-b-0"><th scope="row" className="px-4 py-3 text-left font-medium">{target.name}</th>
                <td className="px-4 py-3">{label(target.type)}</td><td className="px-4 py-3">{targetDefinitions.length ? <div className="space-y-2">{targetDefinitions.map((definition) => {
                  const current = observationsByDefinition.get(definition.id)?.[0]; return <div key={definition.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span>{definition.name}:</span><MetricNumberButton observation={current} definition={definition} onInspect={inspect} labelText={`${definition.name} target overlay value`}>
                      {suppressedMetric(current, current?.value ?? null, current?.unit || '')}</MetricNumberButton></div>; })}</div> : <span className="text-muted-foreground">No measure attached</span>}</td>
                <td className="px-4 py-3">{targetDefinitions.length ? `${targetDefinitions.filter((definition) => observationsByDefinition.get(definition.id)?.[0]?.freshnessStatus === 'fresh').length} fresh of ${targetDefinitions.length}` : 'Uncovered'}</td></tr>; })}</tbody>
          </table></div>
        </section>

        <section className="overflow-hidden border bg-card" aria-labelledby="evidence-coverage-heading">
          <div className="border-b px-4 py-3"><h2 id="evidence-coverage-heading" className="text-sm font-semibold">Evidence coverage by stage</h2>
            <p className="mt-1 text-sm text-muted-foreground">Metric coverage and linked research evidence are shown separately. Neither state upgrades a hypothesis automatically.</p></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[760px] border-collapse text-sm"><caption className="sr-only">Metric and research evidence coverage for each journey stage.</caption>
            <thead><tr className="border-b bg-muted/30 text-left text-xs"><th className="px-4 py-2" scope="col">Stage</th><th className="px-4 py-2" scope="col">Metric definitions</th>
              <th className="px-4 py-2" scope="col">Fresh metrics</th><th className="px-4 py-2" scope="col">Research-backed cards</th><th className="px-4 py-2" scope="col">Evidence warnings</th></tr></thead>
            <tbody>{stageCoverage.map((row) => <tr className="border-b last:border-b-0" key={row.stage.id}><th className="px-4 py-3 text-left font-medium" scope="row">{row.stage.name}</th>
              <td className="px-4 py-3">{row.metricDefinitions}</td><td className="px-4 py-3">{row.freshMetrics} of {row.metricDefinitions}</td>
              <td className="px-4 py-3">{row.researchBackedCards} of {row.cards} cards</td><td className={`px-4 py-3 ${row.warningCards ? 'text-amber-700' : 'text-muted-foreground'}`}>
                {row.warningCards ? `${row.warningCards} hypothesis, stale, contradicted, or invalidated` : 'None detected'}</td></tr>)}</tbody>
          </table></div>
        </section>

        <section className="overflow-hidden border bg-card" aria-labelledby="sentiment-heading"
          data-testid="journey-metrics-sentiment">
          <div className="border-b px-4 py-3"><h2 id="sentiment-heading" className="text-sm font-semibold">Emotional and sentiment lanes</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Aggregate sentiment shares from governed social imports, with the sample, source, window and freshness
              behind each lane. Every chart has an exact table alternative.
            </p></div>
          <div className="divide-y">
            {sentimentObservations.map(({ definition, observation }) => <div key={definition.id} className="px-4 py-4">
              <h3 className="mb-3 text-sm font-semibold">{definition.name}</h3>
              <SentimentLane observation={observation} definition={definition} />
            </div>)}
            {!sentimentObservations.length && <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {observations.some((observation) => observation.privacy.suppressed)
                ? 'No sentiment lane is available. Sentiment observations in this scope are privacy suppressed.'
                : 'No sentiment measure is configured for this journey. Sentiment lanes require a governed operational sentiment definition.'}
            </p>}
          </div>
        </section>

        <section className="overflow-hidden border bg-card" aria-labelledby="trends-heading">
          <div className="border-b px-4 py-3"><h2 id="trends-heading" className="text-sm font-semibold">Trends and exact observation table</h2>
            <p className="mt-1 text-sm text-muted-foreground">Comparisons only use observations from the same immutable definition version and unit.</p></div>
          <div className="divide-y">{activeDefinitions.map((definition) => <div key={definition.id} className="grid gap-4 px-4 py-4 lg:grid-cols-[240px_minmax(0,1fr)]">
            <div><h3 className="text-sm font-semibold">{definition.name}</h3><div className="mt-3"><Sparkline rows={observationsByDefinition.get(definition.id) || []} name={definition.name} /></div></div>
            <div className="min-w-0 overflow-x-auto"><table className="w-full min-w-[760px] border-collapse text-sm"><caption className="sr-only">Exact observations for {definition.name}; this is the text alternative to its trend.</caption>
              <thead><tr className="border-b text-left text-xs"><th className="px-3 py-2" scope="col">Period end</th><th className="px-3 py-2" scope="col">Value</th>
                <th className="px-3 py-2" scope="col">Sample</th><th className="px-3 py-2" scope="col">Sources</th><th className="px-3 py-2" scope="col">Freshness</th><th className="px-3 py-2" scope="col">Revision</th></tr></thead>
              <tbody>{(observationsByDefinition.get(definition.id) || []).map((observation) => <tr className="border-b last:border-b-0" key={observation.id}>
                <td className="px-3 py-2">{formatDate(observation.period.end)}</td><td className="px-3 py-2"><MetricNumberButton observation={observation} definition={definition} onInspect={inspect} labelText={`${definition.name} observation value`}>
                  {suppressedMetric(observation, observation.value, observation.unit)}</MetricNumberButton></td><td className="px-3 py-2"><MetricNumberButton observation={observation} definition={definition} onInspect={inspect} labelText={`${definition.name} observation sample`}>
                    {suppressedCount(observation, observation.sampleSize)}</MetricNumberButton></td><td className="px-3 py-2"><MetricNumberButton observation={observation} definition={definition} onInspect={inspect} labelText={`${definition.name} observation source count`}>
                    {suppressedCount(observation, observation.sourceCount)}</MetricNumberButton></td><td className="px-3 py-2 capitalize">{observation.freshnessStatus}</td>
                <td className="px-3 py-2"><MetricNumberButton observation={observation} definition={definition} onInspect={inspect} labelText={`${definition.name} observation revision`}>
                  {observation.revision}</MetricNumberButton></td></tr>)}{!(observationsByDefinition.get(definition.id) || []).length && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">No observations yet.</td></tr>}</tbody>
            </table></div></div>)}</div>
        </section>
      </TabsContent>

      <TabsContent value="definitions" className="space-y-4">
        <div className="flex flex-col gap-3 border bg-card px-4 py-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-sm font-semibold">Versioned metric definitions</h2>
          <p className="mt-1 text-sm text-muted-foreground">A change creates a new immutable version; prior observations retain their original definition.</p></div>
          {canManage && <Button onClick={() => openMetric()} disabled={!canCreateMetric}><Plus />New definition</Button>}</div>
        {!definitionBindings.length && canManage && <div className="border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">Create an active question-scoped survey binding before defining NPS, CSAT, or CES. Native ticket and social measures do not need a binding.</div>}
        <div className="overflow-hidden border bg-card"><div className="overflow-x-auto"><table className="w-full min-w-[980px] border-collapse text-sm"><caption className="sr-only">Journey metric definitions and management actions.</caption>
          <thead><tr className="border-b bg-muted/30 text-left text-xs"><th className="px-4 py-2" scope="col">Definition</th><th className="px-4 py-2" scope="col">Target</th>
            <th className="px-4 py-2" scope="col">Calculator</th><th className="px-4 py-2" scope="col">Version</th><th className="px-4 py-2" scope="col">Window / freshness</th>
            <th className="px-4 py-2" scope="col">Content identity</th>{canManage && <th className="px-4 py-2 text-right" scope="col">Actions</th>}</tr></thead>
          <tbody>{definitions.map((definition) => { const version = definition.currentVersion; return <tr className="border-b last:border-b-0" key={definition.id}>
            <th scope="row" className="px-4 py-3 text-left font-medium">{definition.name}<span className="mt-1 block text-xs font-normal text-muted-foreground capitalize">{definition.state}</span></th>
            <td className="px-4 py-3">{targetName(map, segments, definition.targetType, definition.targetId)}<span className="mt-1 block text-xs text-muted-foreground">{label(definition.targetType)}</span></td>
            <td className="px-4 py-3">{label(version?.calculatorKind || 'unconfigured')}<span className="mt-1 block text-xs text-muted-foreground">
              {version?.nativeSource ? `${version.nativeSource.label} · ${version.nativeSource.sourceCount} authorised source${version.nativeSource.sourceCount === 1 ? '' : 's'}`
                : version?.sourceKind === 'operational_import' ? 'Governed operational import' : 'Survey source'}</span></td>
            <td className="px-4 py-3">{version?.versionNumber || '—'}</td><td className="px-4 py-3">{version ? formatWindow(version.windowSeconds) : '—'}<span className="mt-1 block text-xs text-muted-foreground">Fresh for {version ? formatWindow(version.freshnessMaxAgeSeconds) : '—'}</span></td>
            <td className="px-4 py-3 font-mono text-xs">{version?.contentSha256.slice(0, 12) || '—'}…</td>{canManage && <td className="px-4 py-3"><div className="flex justify-end gap-2">
              {(version?.sourceKind === 'survey' || version?.nativeSource) && <Button size="sm" variant="outline" onClick={() => openMetric(definition)}><Settings2 />New version</Button>}
              <Button size="sm" variant="outline" disabled={working === `rebuild-${definition.id}`} onClick={() => void rebuild(definition)}>
                {working === `rebuild-${definition.id}` ? <LoaderCircle className="animate-spin" /> : <RotateCcw />}Rebuild</Button></div></td>}</tr>; })}
          </tbody></table></div></div>
        <div className="border bg-muted/20 px-4 py-3 text-sm text-muted-foreground" data-testid="journey-metrics-adapter-boundary">
          <strong className="font-medium text-foreground">Current adapter boundary:</strong> survey definitions, governed
          operational imports, and first-party native adapters for this space's service recovery cases and social
          mentions. Native measures read only deterministic aggregates from the authorised source of record — never
          ticket notes, mention content, authors or profiles. {NATIVE_SOCIAL_NOTICE}</div>
      </TabsContent>

      <TabsContent value="sources" className="space-y-4">
        <div className="flex flex-col gap-3 border bg-card px-4 py-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-sm font-semibold">Survey source bindings</h2>
          <p className="mt-1 text-sm text-muted-foreground">Bindings pin a survey, optional collector, and optional question to a stable journey target.</p></div>
          {canManage && <Button onClick={openBinding} disabled={!surveys.length}><Plus />Bind survey source</Button>}</div>
        <div className="overflow-hidden border bg-card"><div className="overflow-x-auto"><table className="w-full min-w-[960px] border-collapse text-sm"><caption className="sr-only">Survey bindings used by journey metrics.</caption>
          <thead><tr className="border-b bg-muted/30 text-left text-xs"><th className="px-4 py-2" scope="col">Source</th><th className="px-4 py-2" scope="col">Target</th>
            <th className="px-4 py-2" scope="col">Question</th><th className="px-4 py-2" scope="col">Availability</th><th className="px-4 py-2" scope="col">State</th>
            <th className="px-4 py-2" scope="col">Revision</th>{canManage && <th className="px-4 py-2 text-right" scope="col">Action</th>}</tr></thead>
          <tbody>{bindings.map((binding) => <tr className="border-b last:border-b-0" key={binding.id}><th scope="row" className="px-4 py-3 text-left font-medium">
            {surveys.find((survey) => survey.id === binding.surveyId)?.title || (binding.surveyId ? `Survey ${binding.surveyId.slice(0, 8)}` : 'Deleted survey')}
            <span className="mt-1 block max-w-[300px] truncate font-mono text-xs font-normal text-muted-foreground">{binding.sourceRef}</span></th>
            <td className="px-4 py-3">{targetName(map, segments, binding.targetType, binding.targetId)}<span className="mt-1 block text-xs text-muted-foreground">{label(binding.targetType)}</span></td>
            <td className="px-4 py-3">{binding.questionId ? `Question ${binding.questionId.slice(0, 8)}` : 'All compatible responses'}<span className="mt-1 block text-xs text-muted-foreground">{binding.collectorId ? `Collector ${binding.collectorId.slice(0, 8)}` : 'All collectors'}</span></td>
            <td className={`px-4 py-3 ${binding.sourceState === 'deleted' ? 'text-rose-700' : 'text-emerald-700'}`}>{label(binding.sourceState)}</td>
            <td className="px-4 py-3 capitalize">{binding.state}</td><td className="px-4 py-3">{binding.revision}</td>{canManage && <td className="px-4 py-3 text-right">
              <Button size="sm" variant="outline" disabled={working === `binding-${binding.id}` || (binding.sourceState === 'deleted' && binding.state === 'retired')}
                onClick={() => void changeBindingState(binding)}>{binding.state === 'active' ? 'Retire' : 'Reactivate'}</Button></td>}</tr>)}
            {!bindings.length && <tr><td colSpan={canManage ? 7 : 6} className="px-4 py-10 text-center text-muted-foreground">No survey sources are bound to this journey.</td></tr>}</tbody>
        </table></div></div>
        <section className="overflow-hidden border bg-card" aria-labelledby="native-sources-heading"
          data-testid="journey-metrics-native-sources">
          <div className="border-b px-4 py-3"><h2 id="native-sources-heading" className="text-sm font-semibold">First-party native sources</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Native measures read this space's own service recovery cases and social mentions directly. They need no
              binding and no import. Only sources this space is currently authorised to read are offered, and a
              measure is retracted rather than partly recomputed if one is later revoked or deleted.
            </p></div>
          <ul className="divide-y">
            {activeDefinitions.filter((definition) => definition.currentVersion?.nativeSource)
              .map((definition) => { const native = definition.currentVersion!.nativeSource!;
                return <li key={definition.id} className="px-4 py-3">
                  <p className="text-sm font-medium">{definition.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{native.label} · {native.sourceCount} authorised
                    source{native.sourceCount === 1 ? '' : 's'}
                    {native.stageId ? ' · stage targeted through a governed research link' : ''}</p>
                </li>; })}
            {!activeDefinitions.some((definition) => definition.currentVersion?.nativeSource)
              && <li className="px-4 py-6 text-center text-sm text-muted-foreground">
                No native measure is configured for this journey.
                {canManage && nativeModes.length === 0
                  ? ' This space has no authorised service recovery or social source to read.' : ''}</li>}
          </ul>
        </section>
        <div className="border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"><CircleAlert className="mr-2 inline h-4 w-4" />
          Governed operational imports still require an authorised server source and a published schema. A native
          definition never accepts an import, and an ordinary import is never reported as native.</div>
      </TabsContent>

      <TabsContent value="segments" className="space-y-4">
        <div className="flex flex-col gap-3 border bg-card px-4 py-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-sm font-semibold">Reusable metric segments</h2>
          <p className="mt-1 text-sm text-muted-foreground">Segment rules are versioned independently and may be targeted by bindings and definitions.</p></div>
          {canManage && <Button onClick={() => openSegment()}><Plus />New segment</Button>}</div>
        <div className="overflow-hidden border bg-card"><div className="overflow-x-auto"><table className="w-full min-w-[820px] border-collapse text-sm"><caption className="sr-only">Reusable journey metric segments.</caption>
          <thead><tr className="border-b bg-muted/30 text-left text-xs"><th className="px-4 py-2" scope="col">Segment</th><th className="px-4 py-2" scope="col">Rule</th>
            <th className="px-4 py-2" scope="col">State</th><th className="px-4 py-2" scope="col">Revision</th><th className="px-4 py-2" scope="col">Updated</th>
            {canManage && <th className="px-4 py-2 text-right" scope="col">Actions</th>}</tr></thead>
          <tbody>{segments.map((segment) => <tr className="border-b last:border-b-0" key={segment.id}><th scope="row" className="px-4 py-3 text-left font-medium">{segment.name}<span className="mt-1 block text-xs font-normal text-muted-foreground">{segment.description || 'No description'}</span></th>
            <td className="px-4 py-3"><code className="block max-w-[380px] truncate text-xs">{JSON.stringify(segment.rule)}</code></td><td className="px-4 py-3 capitalize">{segment.state}</td>
            <td className="px-4 py-3">{segment.revision}</td><td className="px-4 py-3">{formatDate(segment.updatedAt)}</td>{canManage && <td className="px-4 py-3"><div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => openSegment(segment)}>Edit</Button><Button size="sm" variant="outline" disabled={working === `segment-${segment.id}`}
                onClick={() => void changeSegmentState(segment)}>{segment.state === 'active' ? 'Retire' : 'Reactivate'}</Button></div></td>}</tr>)}
            {!segments.length && <tr><td colSpan={canManage ? 6 : 5} className="px-4 py-10 text-center text-muted-foreground">No reusable segments have been configured.</td></tr>}</tbody>
        </table></div></div>
      </TabsContent>

      <TabsContent value="alerts" className="space-y-4" data-testid="journey-metric-alerts">
        <div className="flex flex-col gap-3 border bg-card px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="text-sm font-semibold">Metric and evidence alerts</h2><p className="mt-1 text-sm text-muted-foreground">
            Deterministic rules show the exact metric, source lineage, window, and reason. Alerts describe observed conditions and do not claim causation.
          </p></div>
          {canManage && <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void evaluateAlerts()} disabled={working === 'alert-evaluate' || !alertDefinitions.some((item) => item.state === 'active')} data-testid="evaluate-alerts">
            {working === 'alert-evaluate' ? <LoaderCircle className="animate-spin" /> : <Activity />}Evaluate now</Button>
            <Button onClick={() => openAlertDefinition()} disabled={!activeDefinitions.length}><Plus />New alert</Button></div>}
        </div>

        <section className="overflow-hidden border bg-card" aria-labelledby="open-alerts-heading"><div className="border-b px-4 py-3"><h3 id="open-alerts-heading" className="text-sm font-semibold">Detected conditions</h3></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[900px] border-collapse text-sm"><caption className="sr-only">Journey metric alerts and review actions.</caption>
            <thead><tr className="border-b bg-muted/30 text-left text-xs"><th className="px-4 py-2">Alert</th><th className="px-4 py-2">Reason</th><th className="px-4 py-2">Severity</th><th className="px-4 py-2">State</th><th className="px-4 py-2">Sample</th><th className="px-4 py-2">Last evaluated</th>{canManage && <th className="px-4 py-2 text-right">Actions</th>}</tr></thead>
            <tbody>{alerts.map((alert) => <tr key={alert.id} className="border-b last:border-b-0"><th scope="row" className="px-4 py-3 text-left font-medium">{alert.definitionName || alert.alertDefinitionId.slice(0, 8)}<span className="mt-1 block font-mono text-xs font-normal text-muted-foreground">v{alert.alertDefinitionVersionId.slice(0, 8)}</span></th>
              <td className="px-4 py-3">{label(alert.reasonCode)}</td><td className={`px-4 py-3 font-medium ${alert.severity === 'strong' ? 'text-rose-700' : 'text-amber-700'}`}>{label(alert.severity)}</td><td className="px-4 py-3">{label(alert.state)}</td><td className="px-4 py-3 tabular-nums">{alert.sampleSize === null ? 'Suppressed' : alert.sampleSize.toLocaleString()}</td><td className="px-4 py-3">{formatDate(alert.lastEvaluatedAt)}</td>
              {canManage && <td className="px-4 py-3"><div className="flex justify-end gap-2">{alert.state === 'open' && <Button size="sm" variant="outline" onClick={() => void changeAlert(alert, 'acknowledge')} data-testid={`ack-alert-${alert.id}`}>Acknowledge</Button>}{alert.state !== 'resolved' && <><Button size="sm" variant="outline" onClick={() => void changeAlert(alert, 'snooze')}>Snooze 24h</Button><Button size="sm" variant="outline" onClick={() => void changeAlert(alert, 'resolve')}>Resolve</Button></>}</div></td>}
            </tr>)}{!alerts.length && <tr><td colSpan={canManage ? 7 : 6} className="px-4 py-8 text-center text-muted-foreground">No alert conditions have been recorded.</td></tr>}</tbody>
          </table></div>
        </section>

        <section className="overflow-hidden border bg-card" aria-labelledby="alert-definitions-heading"><div className="border-b px-4 py-3"><h3 id="alert-definitions-heading" className="text-sm font-semibold">Alert definitions</h3></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[860px] border-collapse text-sm"><caption className="sr-only">Versioned journey metric alert definitions.</caption>
            <thead><tr className="border-b bg-muted/30 text-left text-xs"><th className="px-4 py-2">Definition</th><th className="px-4 py-2">Metric</th><th className="px-4 py-2">Rule</th><th className="px-4 py-2">Window</th><th className="px-4 py-2">State</th>{canManage && <th className="px-4 py-2 text-right">Actions</th>}</tr></thead>
            <tbody>{alertDefinitions.map((definition) => <tr key={definition.id} className="border-b last:border-b-0"><th scope="row" className="px-4 py-3 text-left font-medium">{definition.name}<span className="mt-1 block text-xs font-normal text-muted-foreground">Version {definition.currentVersion?.versionNumber || '—'}</span></th><td className="px-4 py-3">{definitions.find((item) => item.id === definition.metricDefinitionId)?.name || definition.metricDefinitionId.slice(0, 8)}</td><td className="px-4 py-3">{label(definition.currentVersion?.ruleKind || 'unconfigured')}</td><td className="px-4 py-3">{definition.currentVersion ? formatWindow(definition.currentVersion.windowSeconds) : '—'}</td><td className="px-4 py-3">{label(definition.state)}</td>
              {canManage && <td className="px-4 py-3"><div className="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => openAlertDefinition(definition)}><Settings2 />New version</Button>{definition.state !== 'retired' && <Button size="sm" variant="outline" onClick={() => void changeAlertDefinitionState(definition)}>{definition.state === 'active' ? 'Disable' : 'Enable'}</Button>}</div></td>}
            </tr>)}{!alertDefinitions.length && <tr><td colSpan={canManage ? 6 : 5} className="px-4 py-8 text-center text-muted-foreground">No alert definitions are configured.</td></tr>}</tbody>
          </table></div>
        </section>

        {alertPreference?.eligible && <section className="border bg-card" aria-labelledby="alert-inbox-heading"><div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div><h3 id="alert-inbox-heading" className="text-sm font-semibold">Your alert inbox</h3><p className="mt-1 text-sm text-muted-foreground">Only current space owners and administrators receive these content-free notifications.</p></div><Button size="sm" variant="outline" onClick={() => void toggleAlertPreference()} disabled={working === 'alert-preference'}>{alertPreference.enabled ? 'Turn off notifications' : 'Turn on notifications'}</Button></div>
          <div className="divide-y">{alertNotifications.map((notification) => <div key={notification.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium">{notification.definitionName}</p><p className="mt-1 text-xs text-muted-foreground">{label(notification.reasonCode)} · {formatDate(notification.createdAt)} · {label(notification.state)}</p></div>{notification.state === 'unread' && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => void changeNotification(notification, 'read')}>Mark read</Button><Button size="sm" variant="ghost" onClick={() => void changeNotification(notification, 'dismissed')}>Dismiss</Button></div>}</div>)}{!alertNotifications.length && <p className="px-4 py-6 text-center text-sm text-muted-foreground">No notifications.</p>}</div>
        </section>}

        <section className="overflow-hidden border bg-card" aria-labelledby="alert-runs-heading"><div className="border-b px-4 py-3"><h3 id="alert-runs-heading" className="text-sm font-semibold">Evaluation history</h3></div><div className="overflow-x-auto"><table className="w-full min-w-[700px] border-collapse text-sm"><thead><tr className="border-b bg-muted/30 text-left text-xs"><th className="px-4 py-2">As of</th><th className="px-4 py-2">Evaluated</th><th className="px-4 py-2">Strong</th><th className="px-4 py-2">Warnings</th><th className="px-4 py-2">Resolved</th><th className="px-4 py-2">State</th></tr></thead><tbody>{alertRuns.map((run) => <tr key={run.id} className="border-b last:border-b-0"><td className="px-4 py-3">{formatDate(run.asOf)}</td><td className="px-4 py-3">{run.evaluatedCount}</td><td className="px-4 py-3">{run.triggeredCount}</td><td className="px-4 py-3">{run.warningCount}</td><td className="px-4 py-3">{run.resolvedCount}</td><td className="px-4 py-3">{label(run.state)}</td></tr>)}{!alertRuns.length && <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">No evaluations yet.</td></tr>}</tbody></table></div></section>
      </TabsContent>

      <TabsContent value="activity" className="space-y-4">
        <div className="border bg-card px-4 py-4"><h2 className="text-sm font-semibold">Rebuild queue and outcomes</h2><p className="mt-1 text-sm text-muted-foreground">Every run is pinned to the definition version and as-of time used for its observation.</p></div>
        <div className="overflow-hidden border bg-card"><div className="overflow-x-auto"><table className="w-full min-w-[980px] border-collapse text-sm"><caption className="sr-only">Journey metric rebuild queue and outcomes.</caption>
          <thead><tr className="border-b bg-muted/30 text-left text-xs"><th className="px-4 py-2" scope="col">Definition</th><th className="px-4 py-2" scope="col">State</th>
            <th className="px-4 py-2" scope="col">Reason</th><th className="px-4 py-2" scope="col">As of</th><th className="px-4 py-2" scope="col">Attempts</th>
            <th className="px-4 py-2" scope="col">Outcome</th><th className="px-4 py-2" scope="col">Updated</th></tr></thead>
          <tbody>{rebuilds.map((run) => <tr className="border-b last:border-b-0" key={run.id}><th scope="row" className="px-4 py-3 text-left font-medium">
            {definitions.find((definition) => definition.id === run.definitionId)?.name || run.definitionId.slice(0, 8)}<span className="mt-1 block font-mono text-xs font-normal text-muted-foreground">{run.definitionVersionId.slice(0, 12)}</span></th>
            <td className="px-4 py-3 capitalize">{run.state}</td><td className="px-4 py-3">{label(run.reason)}</td><td className="px-4 py-3">{formatDate(run.asOf)}</td>
            <td className="px-4 py-3">{run.attemptCount} of {run.maxAttempts}</td><td className="px-4 py-3">{run.errorCode || (run.observationId ? `Observation ${run.observationId.slice(0, 8)}` : 'Pending')}</td>
            <td className="px-4 py-3">{formatDate(run.updatedAt)}</td></tr>)}{!rebuilds.length && <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">No rebuilds have been queued.</td></tr>}</tbody>
        </table></div></div>
      </TabsContent>
    </Tabs>}

    <Dialog open={alertOpen} onOpenChange={(open) => { if (!working) setAlertOpen(open); }}><DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto" data-testid="alert-definition-dialog">
      <DialogHeader><DialogTitle>{editingAlertDefinition ? 'New alert definition version' : 'New metric alert'}</DialogTitle><DialogDescription>
        Rules are deterministic and versioned. Small or privacy-suppressed samples can only produce a warning, never a strong alert.
      </DialogDescription></DialogHeader>
      <form className="space-y-4" onSubmit={(event) => void saveAlert(event)}><div><Label htmlFor="alert-name">Name</Label><Input id="alert-name" required maxLength={160} value={alertDraft.name} onChange={(event) => setAlertDraft((current) => ({ ...current, name: event.target.value }))} /></div>
        <div><Label htmlFor="alert-metric">Metric definition</Label><select id="alert-metric" required disabled={Boolean(editingAlertDefinition)} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={alertDraft.metricDefinitionId} onChange={(event) => setAlertDraft((current) => ({ ...current, metricDefinitionId: event.target.value }))}>{activeDefinitions.map((definition) => <option value={definition.id} key={definition.id}>{definition.name}</option>)}</select></div>
        <div><Label htmlFor="alert-rule">Rule</Label><select id="alert-rule" className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={alertDraft.ruleKind} onChange={(event) => setAlertDraft((current) => ({ ...current, ruleKind: event.target.value as JourneyMetricAlertRuleKind }))}>
          <option value="falling_metric">Metric deterioration</option><option value="stale_source">Stale source observation</option><option value="small_sample">Small-sample warning</option><option value="contradictory_evidence">Contradictory reviewed research</option>
        </select></div>
        <div className="grid gap-4 sm:grid-cols-2">{alertDraft.ruleKind === 'falling_metric' && <div><Label htmlFor="alert-threshold">Change threshold</Label><Input id="alert-threshold" type="number" min="0.000001" step="any" required value={alertDraft.thresholdValue} onChange={(event) => setAlertDraft((current) => ({ ...current, thresholdValue: event.target.value }))} /></div>}
          <div><Label htmlFor="alert-window">Evaluation window (days)</Label><Input id="alert-window" type="number" min="0.001" step="any" required value={alertDraft.windowDays} onChange={(event) => setAlertDraft((current) => ({ ...current, windowDays: event.target.value }))} /></div>
          <div><Label htmlFor="alert-minimum">Minimum sample</Label><Input id="alert-minimum" type="number" min="2" step="1" required value={alertDraft.minimumSampleSize} onChange={(event) => setAlertDraft((current) => ({ ...current, minimumSampleSize: event.target.value }))} /></div>
          <div><Label htmlFor="alert-cooldown">Notification cooldown (hours)</Label><Input id="alert-cooldown" type="number" min="0.017" step="any" required value={alertDraft.cooldownHours} onChange={(event) => setAlertDraft((current) => ({ ...current, cooldownHours: event.target.value }))} /></div>
          <div><Label htmlFor="alert-stale">Stale after (hours)</Label><Input id="alert-stale" type="number" min="0.017" step="any" required value={alertDraft.staleHours} onChange={(event) => setAlertDraft((current) => ({ ...current, staleHours: event.target.value }))} /></div>
          <div><Label htmlFor="alert-contradiction">Contradiction ratio</Label><Input id="alert-contradiction" type="number" min="0.01" max="0.5" step="0.01" required value={alertDraft.contradictionRatio} onChange={(event) => setAlertDraft((current) => ({ ...current, contradictionRatio: event.target.value }))} /></div></div>
        <DialogFooter><Button type="button" variant="outline" onClick={() => setAlertOpen(false)}>Cancel</Button><Button type="submit" disabled={working === 'alert-save'}>{working === 'alert-save' ? <LoaderCircle className="animate-spin" /> : null}Save version</Button></DialogFooter>
      </form>
    </DialogContent></Dialog>

    <Dialog open={metricOpen} onOpenChange={(open) => { if (!working) setMetricOpen(open); }}><DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
      <DialogHeader><DialogTitle>{editingDefinition ? `Create a new ${editingDefinition.name} version` : 'New metric definition'}</DialogTitle>
        <DialogDescription>Survey measures use fixed, reviewable NPS, CSAT, or CES calculation semantics. Native
          measures read this space's own service recovery cases or social mentions and publish deterministic
          aggregates only. Saving an edit creates a new immutable version.</DialogDescription></DialogHeader>
      <form className="space-y-4" onSubmit={(event) => void saveMetric(event)}><div><Label htmlFor="metric-name">Name</Label><Input id="metric-name" required maxLength={160} value={metricDraft.name}
        onChange={(event) => setMetricDraft((current) => ({ ...current, name: event.target.value }))} /></div>
        <div><Label htmlFor="metric-source-mode">Measure source</Label>
          <select id="metric-source-mode" className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            disabled={Boolean(editingDefinition)} value={metricDraft.sourceMode}
            aria-describedby="metric-source-mode-help"
            onChange={(event) => { const mode = event.target.value as MetricSourceMode;
              setMetricDraft((current) => ({ ...current, sourceMode: mode, nativeSourceIds: [],
                nativeKind: mode === 'social_mentions' ? 'sentiment_distribution' : 'ticket_rate' })); }}>
            <option value="survey">Survey binding (NPS, CSAT, CES)</option>
            {nativeModes.map((mode) => <option key={mode} value={mode}>{NATIVE_ADAPTER_LABEL[mode]}</option>)}
          </select>
          <p id="metric-source-mode-help" className="mt-1 text-xs text-muted-foreground">
            {metricDraft.sourceMode === 'survey'
              ? 'Survey measures read the bound question’s responses.'
              : metricDraft.sourceMode === 'social_mentions' ? NATIVE_SOCIAL_NOTICE
                : 'Native ticket measures read recovery case lifecycle events only — never a case title, note or owner.'}
          </p></div>
        {metricDraft.sourceMode !== 'survey' && <div className="space-y-4" data-testid="metric-native-scope">
          <fieldset className="min-w-0">
            <legend className="field-label" id="metric-native-scope-legend">
              {metricDraft.sourceMode === 'service_recovery_tickets'
                ? 'Authorised surveys whose recovery cases this measure reads'
                : 'Authorised social connections this measure reads'}</legend>
            {nativeChoices.length === 0
              ? <p className="mt-1 text-xs text-muted-foreground">No authorised source is available in this space.</p>
              : <div className="mt-1 max-h-40 space-y-1 overflow-y-auto pr-1" role="group"
                aria-labelledby="metric-native-scope-legend">
                {nativeChoices.map((choice) => { const checked = metricDraft.nativeSourceIds.includes(choice.id);
                  return <label key={choice.id} className="flex items-center gap-2 text-sm" htmlFor={`metric-native-${choice.id}`}>
                    <input type="checkbox" id={`metric-native-${choice.id}`} checked={checked} className="h-4 w-4 rounded border-input"
                      onChange={() => setMetricDraft((current) => ({ ...current,
                        nativeSourceIds: checked ? current.nativeSourceIds.filter((value) => value !== choice.id)
                          : [...current.nativeSourceIds, choice.id] }))} />
                    <span className="min-w-0 truncate">{choice.name}</span></label>; })}
              </div>}
          </fieldset>
          <div><Label htmlFor="metric-native-kind">Native measure</Label>
            <select id="metric-native-kind" className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={metricDraft.nativeKind}
              onChange={(event) => setMetricDraft((current) => ({ ...current,
                nativeKind: event.target.value as JourneyNativeMeasureKind }))}>
              {nativeMeasureKinds.map((kind) => <option key={kind} value={kind}>{NATIVE_MEASURE_LABEL[kind]}</option>)}
            </select></div>
          {!editingDefinition && metricDraft.targetType === 'stage' && <label className="flex items-start gap-2 text-sm"
            htmlFor="metric-native-stage">
            <input type="checkbox" id="metric-native-stage" className="mt-1 h-4 w-4 rounded border-input"
              checked={metricDraft.nativeStageTargeted}
              onChange={(event) => setMetricDraft((current) => ({ ...current, nativeStageTargeted: event.target.checked }))} />
            <span className="min-w-0">Restrict to sources governed onto this stage.
              <span className="mt-1 block text-xs text-muted-foreground">Only sources with an active Journey Research
                Hub link to this exact stage contribute. Without one the server refuses the definition rather than
                inferring a stage.</span></span></label>}
        </div>}
        {!editingDefinition && <div className="grid gap-4 sm:grid-cols-2"><div><Label htmlFor="metric-target-type">Target type</Label><select id="metric-target-type" className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={metricDraft.targetType}
          onChange={(event) => { const type = event.target.value as JourneyMetricTargetType; const targetId = targetOptions(map, segments, type)[0]?.id || '';
            setMetricDraft((current) => ({ ...current, targetType: type, targetId,
              bindingId: definitionBindings.find((binding) => binding.targetType === type && binding.targetId === targetId)?.id || '' })); }}>
          {(['journey', 'stage', 'touchpoint', 'persona', 'segment'] as const).map((type) => <option key={type} value={type}>{label(type)}</option>)}</select></div>
          <div><Label htmlFor="metric-target">Target</Label><select id="metric-target" required className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={metricDraft.targetId}
            onChange={(event) => { const targetId = event.target.value; setMetricDraft((current) => ({ ...current, targetId,
              bindingId: definitionBindings.find((binding) => binding.targetType === current.targetType && binding.targetId === targetId)?.id || '' })); }}>
            {targetOptions(map, segments, metricDraft.targetType).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></div></div>}
        {metricDraft.sourceMode === 'survey' && <><div><Label htmlFor="metric-binding">Survey binding</Label><select id="metric-binding" required className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={metricDraft.bindingId}
          onChange={(event) => setMetricDraft((current) => ({ ...current, bindingId: event.target.value }))}><option value="">Select a matching binding</option>{metricBindingOptions.map((binding) => <option key={binding.id} value={binding.id}>
            {surveys.find((survey) => survey.id === binding.surveyId)?.title || binding.sourceRef} → {targetName(map!, segments, binding.targetType, binding.targetId)}</option>)}</select></div>
        <div className="border bg-muted/20 px-3 py-2 text-sm">Calculator: <strong>{selectedMetricQuestion ? label(selectedMetricQuestion.type) : 'Loading bound question…'}</strong>
          {selectedMetricQuestion && !['nps', 'csat', 'ces'].includes(selectedMetricQuestion.type) && <span className="ml-2 text-rose-700">This question type cannot produce a governed survey metric.</span>}</div></>}
        <div className="grid gap-4 sm:grid-cols-3">{metricDraft.sourceMode === 'survey' && <div><Label htmlFor="metric-calculator">Calculator</Label><select id="metric-calculator" disabled className="mt-2 h-10 w-full rounded-md border border-input bg-muted px-3 text-sm" value={metricDraft.calculatorKind}
          onChange={(event) => setMetricDraft((current) => ({ ...current, calculatorKind: event.target.value as MetricDraft['calculatorKind'] }))}>
          <option value="nps">NPS</option><option value="csat">CSAT mean</option><option value="ces">CES mean</option></select></div>}
          <div><Label htmlFor="metric-window">Window (days)</Label><Input id="metric-window" type="number" min="1" max="3650" required value={metricDraft.windowDays} onChange={(event) => setMetricDraft((current) => ({ ...current, windowDays: event.target.value }))} /></div>
          <div><Label htmlFor="metric-freshness">Freshness (hours)</Label><Input id="metric-freshness" type="number" min="1" required value={metricDraft.freshnessHours} onChange={(event) => setMetricDraft((current) => ({ ...current, freshnessHours: event.target.value }))} /></div></div>
        <div className="grid gap-4 sm:grid-cols-3"><div><Label htmlFor="metric-minimum">Minimum sample</Label><Input id="metric-minimum" type="number" min="1" required value={metricDraft.minimumSampleSize} onChange={(event) => setMetricDraft((current) => ({ ...current, minimumSampleSize: event.target.value }))} /></div>
          <div><Label htmlFor="metric-baseline">Baseline (optional)</Label><Input id="metric-baseline" type="number" step="any" value={metricDraft.baselineValue} onChange={(event) => setMetricDraft((current) => ({ ...current, baselineValue: event.target.value }))} /></div>
          <div><Label htmlFor="metric-goal">Target (optional)</Label><Input id="metric-goal" type="number" step="any" value={metricDraft.targetValue} onChange={(event) => setMetricDraft((current) => ({ ...current, targetValue: event.target.value }))} /></div></div>
        <DialogFooter><Button type="button" variant="outline" onClick={() => setMetricOpen(false)} disabled={Boolean(working)}>Cancel</Button><Button type="submit" disabled={working === 'metric-save' || !metricDraft.name.trim() || !metricDraft.targetId
          || (metricDraft.sourceMode === 'survey'
            ? (!metricDraft.bindingId || !selectedMetricQuestion || selectedMetricQuestion.type !== metricDraft.calculatorKind)
            : metricDraft.nativeSourceIds.length === 0)}>
          {working === 'metric-save' ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />}{editingDefinition ? 'Create version' : 'Create definition'}</Button></DialogFooter></form>
    </DialogContent></Dialog>

    <Dialog open={bindingOpen} onOpenChange={(open) => { if (!working) setBindingOpen(open); }}><DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
      <DialogHeader><DialogTitle>Bind a survey source</DialogTitle><DialogDescription>Choose a stable journey target and the exact survey scope that may contribute observations.</DialogDescription></DialogHeader>
      <form className="space-y-4" onSubmit={(event) => void saveBinding(event)}><div className="grid gap-4 sm:grid-cols-2"><div><Label htmlFor="binding-target-type">Target type</Label><select id="binding-target-type" className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={bindingDraft.targetType}
        onChange={(event) => { const type = event.target.value as JourneyMetricTargetType; setBindingDraft((current) => ({ ...current, targetType: type, targetId: targetOptions(map, segments, type)[0]?.id || '' })); }}>
        {(['journey', 'stage', 'touchpoint', 'persona', 'segment'] as const).map((type) => <option key={type} value={type}>{label(type)}</option>)}</select></div>
        <div><Label htmlFor="binding-target">Target</Label><select id="binding-target" required className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={bindingDraft.targetId}
          onChange={(event) => setBindingDraft((current) => ({ ...current, targetId: event.target.value }))}>{targetOptions(map, segments, bindingDraft.targetType).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></div></div>
        <div><Label htmlFor="binding-survey">Survey</Label><select id="binding-survey" required className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={bindingDraft.surveyId}
          onChange={(event) => setBindingDraft((current) => ({ ...current, surveyId: event.target.value, collectorId: '', questionId: '' }))}>{surveys.map((survey) => <option key={survey.id} value={survey.id}>{survey.title}</option>)}</select></div>
        <div className="grid gap-4 sm:grid-cols-2"><div><Label htmlFor="binding-collector">Collector scope</Label><select id="binding-collector" className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={bindingDraft.collectorId}
          onChange={(event) => setBindingDraft((current) => ({ ...current, collectorId: event.target.value }))}><option value="">All collectors</option>{surveyDetail?.collectors.map((collector) => <option key={collector.id} value={collector.id}>{collector.name}</option>)}</select></div>
          <div><Label htmlFor="binding-question">Metric question</Label><select id="binding-question" required className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={bindingDraft.questionId}
            onChange={(event) => setBindingDraft((current) => ({ ...current, questionId: event.target.value }))}><option value="">Select NPS, CSAT, or CES question</option>{surveyDetail?.survey.questions?.filter((question) => ['nps', 'csat', 'ces'].includes(question.type)).map((question) => <option key={question.id} value={question.id}>{question.title} ({label(question.type)})</option>)}</select></div></div>
        <DialogFooter><Button type="button" variant="outline" onClick={() => setBindingOpen(false)} disabled={Boolean(working)}>Cancel</Button><Button type="submit" disabled={working === 'binding-save' || !bindingDraft.targetId || !bindingDraft.surveyId || !bindingDraft.questionId}>
          {working === 'binding-save' ? <LoaderCircle className="animate-spin" /> : <Database />}Create binding</Button></DialogFooter></form>
    </DialogContent></Dialog>

    <Dialog open={segmentOpen} onOpenChange={(open) => { if (!working) setSegmentOpen(open); }}><DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
      <DialogHeader><DialogTitle>{editingSegment ? `Edit ${editingSegment.name}` : 'New metric segment'}</DialogTitle><DialogDescription>
        Store an explicit JSON rule for downstream metric populations. Rule interpretation must be implemented by the source adapter before it changes an observation.
      </DialogDescription></DialogHeader><form className="space-y-4" onSubmit={(event) => void saveSegment(event)}>
        <div><Label htmlFor="segment-name">Name</Label><Input id="segment-name" required maxLength={160} value={segmentDraft.name} onChange={(event) => setSegmentDraft((current) => ({ ...current, name: event.target.value }))} /></div>
        <div><Label htmlFor="segment-description">Description</Label><Textarea id="segment-description" rows={3} maxLength={2000} value={segmentDraft.description} onChange={(event) => setSegmentDraft((current) => ({ ...current, description: event.target.value }))} /></div>
        <div><Label htmlFor="segment-rule">Rule JSON</Label><Textarea id="segment-rule" rows={9} className="font-mono text-xs" value={segmentDraft.rule} onChange={(event) => setSegmentDraft((current) => ({ ...current, rule: event.target.value }))} aria-describedby={segmentRuleError ? 'segment-rule-error' : undefined} />
          {segmentRuleError && <p id="segment-rule-error" role="alert" className="mt-2 text-sm text-rose-700">{segmentRuleError}</p>}</div>
        <DialogFooter><Button type="button" variant="outline" onClick={() => setSegmentOpen(false)} disabled={Boolean(working)}>Cancel</Button><Button type="submit" disabled={working === 'segment-save' || !segmentDraft.name.trim()}>
          {working === 'segment-save' ? <LoaderCircle className="animate-spin" /> : <Layers3 />}{editingSegment ? 'Save segment' : 'Create segment'}</Button></DialogFooter></form>
    </DialogContent></Dialog>

    <Dialog open={lineageOpen} onOpenChange={setLineageOpen}><DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto" data-testid="journey-metric-lineage-dialog">
      <DialogHeader><DialogTitle>Definition and observation evidence</DialogTitle><DialogDescription>
        This view pins the displayed value to its immutable definition version, observation revision, period, and contributing source revisions.
      </DialogDescription></DialogHeader>
      {lineageLoading ? <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" />Loading exact lineage…</div>
        : lineageDefinition && lineageObservation && <div className="space-y-5"><dl className="grid border text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div className="border-b px-3 py-3 sm:border-r"><dt className="text-xs text-muted-foreground">Definition</dt><dd className="mt-1 font-medium">{lineageDefinition.name}</dd></div>
          <div className="border-b px-3 py-3 lg:border-r"><dt className="text-xs text-muted-foreground">Definition version</dt><dd className="mt-1">{lineageVersion?.versionNumber || '—'} · {lineageObservation.definitionVersionId.slice(0, 12)}</dd></div>
          <div className="border-b px-3 py-3 sm:border-r"><dt className="text-xs text-muted-foreground">Observation revision</dt><dd className="mt-1">{lineageObservation.revision}</dd></div>
          <div className="border-b px-3 py-3"><dt className="text-xs text-muted-foreground">Value</dt><dd className="mt-1 font-medium">{formatMetric(lineageObservation.value, lineageObservation.unit)}</dd></div>
          <div className="px-3 py-3 sm:border-r"><dt className="text-xs text-muted-foreground">Period</dt><dd className="mt-1">{formatDate(lineageObservation.period.start)} – {formatDate(lineageObservation.period.end)}</dd></div>
          <div className="px-3 py-3 lg:border-r"><dt className="text-xs text-muted-foreground">Sample / sources</dt>
            <dd className="mt-1">{lineageObservation.privacy.suppressed ? SUPPRESSED_LABEL
              : `${lineageObservation.sampleSize} / ${lineageObservation.sourceCount}`}</dd></div>
          <div className="px-3 py-3 sm:border-r"><dt className="text-xs text-muted-foreground">Freshness</dt><dd className="mt-1 capitalize">{lineageObservation.freshnessStatus}</dd></div>
          <div className="px-3 py-3"><dt className="text-xs text-muted-foreground">Definition hash</dt><dd className="mt-1 break-all font-mono text-xs">{lineageVersion?.contentSha256 || '—'}</dd></div>
        </dl><section aria-labelledby="lineage-source-heading"><h3 id="lineage-source-heading" className="text-sm font-semibold">Source revisions</h3>
          <div className="mt-2 overflow-x-auto border"><table className="w-full min-w-[760px] border-collapse text-sm"><caption className="sr-only">Exact source revisions included or excluded from this observation.</caption>
            <thead><tr className="border-b bg-muted/30 text-left text-xs"><th className="px-3 py-2" scope="col">Source type</th><th className="px-3 py-2" scope="col">Record</th>
              <th className="px-3 py-2" scope="col">Revision digest</th><th className="px-3 py-2" scope="col">Occurred</th><th className="px-3 py-2" scope="col">Decision</th></tr></thead>
            <tbody>{lineageObservation.lineage?.map((source) => <tr className="border-b last:border-b-0" key={`${source.sourceType}:${source.sourceRecordId}:${source.sourceRevisionSha256}`}>
              <td className="px-3 py-2">{label(source.sourceType)}</td><td className="px-3 py-2 font-mono text-xs">{source.sourceRecordId}</td><td className="px-3 py-2 font-mono text-xs">{source.sourceRevisionSha256.slice(0, 16)}…</td>
              <td className="px-3 py-2">{formatDate(source.occurredAt)}</td><td className={`px-3 py-2 ${source.included ? 'text-emerald-700' : 'text-amber-700'}`}>{source.included ? 'Included' : `Excluded: ${source.exclusionCode || 'unspecified'}`}</td></tr>)}
              {!lineageObservation.lineage?.length && <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">This observation has no contributing source rows.</td></tr>}</tbody>
          </table></div></section></div>}
      <DialogFooter><Button data-testid="close-journey-metric-lineage" variant="outline"
        onClick={() => setLineageOpen(false)}>Close</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
}
