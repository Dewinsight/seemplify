export const JOURNEY_OPERATIONAL_MEASURE_VERSION = 'journey-operational-measure/v1' as const;

export interface JourneyOperationalSourceLineage {
  sourceRef: string;
  sourceVersion: string;
  schemaVersion: string;
  projectionVersion: string;
  journeyId: string | null;
  journeyVersion: string | null;
  ruleSetVersion: string | null;
}

export interface JourneyOperationalPeriod {
  start: string;
  end: string;
  timezone: string;
}

interface JourneyOperationalDefinitionBase {
  measureId: string;
  definitionVersion: string;
  label: string;
  subjectType: 'journey_instance' | 'profile' | 'ticket' | 'social_post' | 'custom';
  sourceLineages: JourneyOperationalSourceLineage[];
  minimumSampleSize: number;
  freshnessMaxAgeSeconds: number;
  decimalPlaces: number;
}

export interface JourneyStageOperationalDefinition extends JourneyOperationalDefinitionBase {
  kind: 'stage_entry' | 'stage_completion' | 'stage_conversion' | 'stage_dropout';
  subjectType: 'journey_instance';
  stageId: string;
  targetStageId?: string;
  populationEventType: string;
  entryEventType: string;
  completionEventType: string;
  dropoutEventType: string;
}

export interface JourneyTicketRateDefinition extends JourneyOperationalDefinitionBase {
  kind: 'ticket_rate';
  subjectType: 'profile' | 'journey_instance';
  populationEventType: string;
  ticketEventType: string;
}

export interface JourneyRepeatContactRateDefinition extends JourneyOperationalDefinitionBase {
  kind: 'repeat_contact_rate';
  subjectType: 'profile' | 'ticket';
  contactEventType: string;
  repeatThreshold: number;
}

export interface JourneyRecoveryRateDefinition extends JourneyOperationalDefinitionBase {
  kind: 'recovery_rate';
  subjectType: 'ticket';
  eligibleEventType: string;
  successEventType: string;
}

export interface JourneySentimentDistributionDefinition extends JourneyOperationalDefinitionBase {
  kind: 'sentiment_distribution';
  subjectType: 'social_post';
  sentimentEventType: string;
}

export interface JourneySentimentTrendDefinition extends JourneyOperationalDefinitionBase {
  kind: 'sentiment_trend';
  subjectType: 'social_post';
  sentimentEventType: string;
  comparisonPeriod: JourneyOperationalPeriod;
}

export interface JourneyCustomCountDefinition extends JourneyOperationalDefinitionBase {
  kind: 'custom_count';
  eventType: string;
  aggregation: 'events' | 'distinct_subjects';
}

export interface JourneyCustomRateDefinition extends JourneyOperationalDefinitionBase {
  kind: 'custom_rate';
  denominatorEventType: string;
  numeratorEventType: string;
  requireNumeratorAfterDenominator: boolean;
}

export interface JourneyCustomDurationDefinition extends JourneyOperationalDefinitionBase {
  kind: 'custom_duration';
  startEventType: string;
  endEventType: string;
  maximumDurationMs: number;
}

export type JourneyOperationalMeasureDefinition =
  | JourneyStageOperationalDefinition
  | JourneyTicketRateDefinition
  | JourneyRepeatContactRateDefinition
  | JourneyRecoveryRateDefinition
  | JourneySentimentDistributionDefinition
  | JourneySentimentTrendDefinition
  | JourneyCustomCountDefinition
  | JourneyCustomRateDefinition
  | JourneyCustomDurationDefinition;

export type JourneySentiment = 'positive' | 'neutral' | 'negative' | 'unknown';

export interface JourneyOperationalObservation {
  observationId: string;
  revision?: number;
  sourceLineage: JourneyOperationalSourceLineage;
  sourceRecordId: string;
  subjectId: string;
  subjectType: JourneyOperationalDefinitionBase['subjectType'];
  eventType: string;
  occurredAt: string;
  stageId?: string | null;
  sentiment?: JourneySentiment | null;
  invalidReason?: string | null;
}

export interface JourneyOperationalMeasureRequest {
  definition: JourneyOperationalMeasureDefinition;
  period: JourneyOperationalPeriod;
  asOf: string;
  observations: JourneyOperationalObservation[];
}

export type JourneyOperationalUnit = 'count' | 'percent' | 'milliseconds' | 'percentage_points';

export interface JourneyOperationalMeasureValue {
  value: number | null;
  unit: JourneyOperationalUnit;
  numerator: number | null;
  denominator: number;
  sampleSize: number;
}

export interface JourneyOperationalMeasureRow {
  key: string;
  label: string;
  current: JourneyOperationalMeasureValue;
  previous: JourneyOperationalMeasureValue | null;
  change: JourneyOperationalMeasureValue | null;
}

export interface JourneyOperationalDurationDistribution {
  observationCount: number;
  minimumMs: number | null;
  p50Ms: number | null;
  p90Ms: number | null;
  p95Ms: number | null;
  maximumMs: number | null;
}

export type JourneyOperationalExclusionReason =
  | 'INVALID_RECORD'
  | 'SOURCE_MARKED_INVALID'
  | 'CONFLICTING_LATEST_REVISION'
  | 'LINEAGE_MISMATCH'
  | 'SUBJECT_TYPE_MISMATCH'
  | 'AFTER_AS_OF'
  | 'OUTSIDE_PERIOD'
  | 'SUPERSEDED_REVISION'
  | 'EXACT_DUPLICATE'
  | 'INVALID_SENTIMENT'
  | 'UNPAIRED_DURATION'
  | 'DURATION_EXCEEDS_MAXIMUM';

export interface JourneyOperationalMeasureResult {
  calculationVersion: typeof JOURNEY_OPERATIONAL_MEASURE_VERSION;
  measureId: string;
  definitionVersion: string;
  kind: JourneyOperationalMeasureDefinition['kind'];
  sourceLineages: JourneyOperationalSourceLineage[];
  period: JourneyOperationalPeriod;
  comparisonPeriod: JourneyOperationalPeriod | null;
  asOf: string;
  summary: JourneyOperationalMeasureValue | null;
  rows: JourneyOperationalMeasureRow[];
  durationDistribution: JourneyOperationalDurationDistribution | null;
  freshness: {
    status: 'fresh' | 'stale' | 'unavailable';
    latestObservedAt: string | null;
    ageSeconds: number | null;
    maximumAgeSeconds: number;
    asOf: string;
  };
  minimumSampleWarning: {
    active: boolean;
    minimumSampleSize: number;
    actualSampleSize: number;
    message: string | null;
  };
  exclusions: Array<{ reason: JourneyOperationalExclusionReason; count: number }>;
  formula: string;
  explanation: string;
  interpretation: {
    mode: 'descriptive_only';
    statement: string;
  };
}

export class JourneyOperationalMeasureError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'JourneyOperationalMeasureError';
  }
}

interface PreparedObservation extends JourneyOperationalObservation {
  revision: number;
  stageId: string | null;
  sentiment: JourneySentiment | null;
  occurredAtMs: number;
}

type QualityCounts = Record<JourneyOperationalExclusionReason, number>;

const EXCLUSION_ORDER: JourneyOperationalExclusionReason[] = [
  'INVALID_RECORD',
  'SOURCE_MARKED_INVALID',
  'CONFLICTING_LATEST_REVISION',
  'LINEAGE_MISMATCH',
  'SUBJECT_TYPE_MISMATCH',
  'AFTER_AS_OF',
  'OUTSIDE_PERIOD',
  'SUPERSEDED_REVISION',
  'EXACT_DUPLICATE',
  'INVALID_SENTIMENT',
  'UNPAIRED_DURATION',
  'DURATION_EXCEEDS_MAXIMUM'
];
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const EVENT_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/u;
const SENTIMENTS: JourneySentiment[] = ['negative', 'neutral', 'positive', 'unknown'];

function fail(code: string, message: string): never {
  throw new JourneyOperationalMeasureError(code, message);
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseInstant(value: string) {
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number, places: number) {
  const factor = 10 ** places;
  const rounded = Math.round((value + Number.EPSILON) * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function validatePeriod(period: JourneyOperationalPeriod, field: string) {
  const startMs = parseInstant(period.start);
  const endMs = parseInstant(period.end);
  if (startMs === null || endMs === null || startMs >= endMs || typeof period.timezone !== 'string' || !period.timezone.trim()) {
    fail('OPERATIONAL_PERIOD_INVALID', `${field} must contain an ordered interval and timezone.`);
  }
  return { startMs, endMs };
}

function canonicalLineage(lineage: JourneyOperationalSourceLineage): JourneyOperationalSourceLineage {
  const values = [lineage.sourceRef, lineage.sourceVersion, lineage.schemaVersion, lineage.projectionVersion];
  if (values.some((value) => typeof value !== 'string' || !value.trim())) {
    fail('OPERATIONAL_LINEAGE_INVALID', 'Source reference, source version, schema version, and projection version are required.');
  }
  const journeyValues = [lineage.journeyId, lineage.journeyVersion, lineage.ruleSetVersion];
  const populated = journeyValues.filter((value) => value !== null).length;
  if (populated !== 0 && populated !== journeyValues.length) {
    fail('OPERATIONAL_LINEAGE_INVALID', 'Journey ID, journey version, and rule-set version must be supplied together or all be null.');
  }
  return { ...lineage };
}

function lineageKey(lineage: JourneyOperationalSourceLineage) {
  return JSON.stringify([
    lineage.sourceRef,
    lineage.sourceVersion,
    lineage.schemaVersion,
    lineage.projectionVersion,
    lineage.journeyId,
    lineage.journeyVersion,
    lineage.ruleSetVersion
  ]);
}

function eventFields(definition: JourneyOperationalMeasureDefinition) {
  switch (definition.kind) {
    case 'stage_entry':
    case 'stage_completion':
    case 'stage_conversion':
    case 'stage_dropout':
      return [definition.populationEventType, definition.entryEventType, definition.completionEventType, definition.dropoutEventType];
    case 'ticket_rate': return [definition.populationEventType, definition.ticketEventType];
    case 'repeat_contact_rate': return [definition.contactEventType];
    case 'recovery_rate': return [definition.eligibleEventType, definition.successEventType];
    case 'sentiment_distribution':
    case 'sentiment_trend': return [definition.sentimentEventType];
    case 'custom_count': return [definition.eventType];
    case 'custom_rate': return [definition.denominatorEventType, definition.numeratorEventType];
    case 'custom_duration': return [definition.startEventType, definition.endEventType];
    // An unrecognised kind previously fell out of the switch as `undefined` and
    // the caller's `.some(...)` raised a TypeError, which surfaced as an opaque
    // 500. An unsupported measure must fail closed and say so.
    default: return fail('OPERATIONAL_KIND_UNSUPPORTED',
      `Measure kind ${String((definition as { kind?: unknown }).kind)} is not supported.`);
  }
}

function validateDefinition(definition: JourneyOperationalMeasureDefinition) {
  if (!ID_PATTERN.test(definition.measureId) || typeof definition.definitionVersion !== 'string' || !definition.definitionVersion.trim()
    || typeof definition.label !== 'string' || !definition.label.trim()) {
    fail('OPERATIONAL_DEFINITION_INVALID', 'Measure ID, definition version, and label are required.');
  }
  if (!Array.isArray(definition.sourceLineages) || !definition.sourceLineages.length) {
    fail('OPERATIONAL_LINEAGE_REQUIRED', 'At least one exact source lineage is required.');
  }
  const keys = definition.sourceLineages.map((lineage) => lineageKey(canonicalLineage(lineage)));
  if (new Set(keys).size !== keys.length) fail('OPERATIONAL_LINEAGE_DUPLICATE', 'Source lineages must be unique.');
  if (!Number.isInteger(definition.minimumSampleSize) || definition.minimumSampleSize < 1) {
    fail('OPERATIONAL_MINIMUM_SAMPLE_INVALID', 'minimumSampleSize must be a positive integer.');
  }
  if (!Number.isInteger(definition.freshnessMaxAgeSeconds) || definition.freshnessMaxAgeSeconds < 1) {
    fail('OPERATIONAL_FRESHNESS_INVALID', 'freshnessMaxAgeSeconds must be a positive integer.');
  }
  if (!Number.isInteger(definition.decimalPlaces) || definition.decimalPlaces < 0 || definition.decimalPlaces > 6) {
    fail('OPERATIONAL_PRECISION_INVALID', 'decimalPlaces must be an integer from zero to six.');
  }
  if (eventFields(definition).some((value) => !EVENT_PATTERN.test(value))) {
    fail('OPERATIONAL_EVENT_TYPE_INVALID', 'Event types must use stable event-name characters.');
  }
  if ('stageId' in definition && !ID_PATTERN.test(definition.stageId)) {
    fail('OPERATIONAL_STAGE_INVALID', 'stageId must be a stable identifier.');
  }
  if (definition.kind.startsWith('stage_')
    && definition.sourceLineages.some((lineage) => !lineage.journeyId || !lineage.journeyVersion || !lineage.ruleSetVersion)) {
    fail('OPERATIONAL_JOURNEY_LINEAGE_REQUIRED', 'Stage measures require exact journey, journey-version, and rule-set lineage.');
  }
  if (definition.kind === 'stage_conversion'
    && (!definition.targetStageId || !ID_PATTERN.test(definition.targetStageId) || definition.targetStageId === definition.stageId)) {
    fail('OPERATIONAL_STAGE_TARGET_INVALID', 'Stage conversion needs a distinct targetStageId.');
  }
  if (definition.kind === 'repeat_contact_rate'
    && (!Number.isInteger(definition.repeatThreshold) || definition.repeatThreshold < 2)) {
    fail('OPERATIONAL_REPEAT_THRESHOLD_INVALID', 'repeatThreshold must be an integer of at least two.');
  }
  if (definition.kind === 'custom_duration'
    && (!Number.isInteger(definition.maximumDurationMs) || definition.maximumDurationMs < 1)) {
    fail('OPERATIONAL_DURATION_MAXIMUM_INVALID', 'maximumDurationMs must be a positive integer.');
  }
}

function qualityCounts(): QualityCounts {
  return Object.fromEntries(EXCLUSION_ORDER.map((reason) => [reason, 0])) as QualityCounts;
}

function structurallyPrepare(observation: JourneyOperationalObservation): PreparedObservation | null {
  const revision = observation.revision ?? 1;
  const occurredAtMs = parseInstant(observation.occurredAt);
  if (!ID_PATTERN.test(observation.observationId)
    || !Number.isInteger(revision) || revision < 1
    || !ID_PATTERN.test(observation.sourceRecordId)
    || !ID_PATTERN.test(observation.subjectId)
    || !EVENT_PATTERN.test(observation.eventType)
    || occurredAtMs === null
    || (observation.stageId !== undefined && observation.stageId !== null && !ID_PATTERN.test(observation.stageId))) return null;
  try {
    canonicalLineage(observation.sourceLineage);
  } catch {
    return null;
  }
  return {
    ...observation,
    revision,
    stageId: observation.stageId ?? null,
    sentiment: observation.sentiment ?? null,
    occurredAtMs
  };
}

function observationFingerprint(observation: PreparedObservation) {
  return JSON.stringify({
    observationId: observation.observationId,
    revision: observation.revision,
    sourceLineage: observation.sourceLineage,
    sourceRecordId: observation.sourceRecordId,
    subjectId: observation.subjectId,
    subjectType: observation.subjectType,
    eventType: observation.eventType,
    occurredAt: observation.occurredAt,
    stageId: observation.stageId,
    sentiment: observation.sentiment,
    invalidReason: observation.invalidReason?.trim() || null
  });
}

function prepareObservations(
  request: JourneyOperationalMeasureRequest,
  current: { startMs: number; endMs: number },
  comparison: { startMs: number; endMs: number } | null,
  asOfMs: number,
  quality: QualityCounts
) {
  const byId = new Map<string, PreparedObservation[]>();
  for (const observation of request.observations) {
    const prepared = structurallyPrepare(observation);
    if (!prepared) {
      quality.INVALID_RECORD += 1;
      continue;
    }
    const revisions = byId.get(prepared.observationId) || [];
    revisions.push(prepared);
    byId.set(prepared.observationId, revisions);
  }
  const allowedLineages = new Set(request.definition.sourceLineages.map(lineageKey));
  const accepted: PreparedObservation[] = [];
  for (const [, revisions] of [...byId.entries()].sort(([left], [right]) => compareText(left, right))) {
    const latestRevision = Math.max(...revisions.map((observation) => observation.revision));
    const latest = revisions.filter((observation) => observation.revision === latestRevision)
      .sort((left, right) => compareText(observationFingerprint(left), observationFingerprint(right)));
    quality.SUPERSEDED_REVISION += revisions.filter((observation) => observation.revision < latestRevision).length;
    const fingerprint = observationFingerprint(latest[0]);
    if (latest.some((observation) => observationFingerprint(observation) !== fingerprint)) {
      quality.CONFLICTING_LATEST_REVISION += latest.length;
      continue;
    }
    quality.EXACT_DUPLICATE += latest.length - 1;
    const selected = latest[0];
    if (selected.invalidReason?.trim()) {
      quality.SOURCE_MARKED_INVALID += 1;
      continue;
    }
    if (!allowedLineages.has(lineageKey(selected.sourceLineage))) {
      quality.LINEAGE_MISMATCH += 1;
      continue;
    }
    if (selected.subjectType !== request.definition.subjectType) {
      quality.SUBJECT_TYPE_MISMATCH += 1;
      continue;
    }
    if (selected.occurredAtMs > asOfMs) {
      quality.AFTER_AS_OF += 1;
      continue;
    }
    const inCurrent = selected.occurredAtMs >= current.startMs && selected.occurredAtMs < current.endMs;
    const inComparison = comparison
      ? selected.occurredAtMs >= comparison.startMs && selected.occurredAtMs < comparison.endMs
      : false;
    if (!inCurrent && !inComparison) {
      quality.OUTSIDE_PERIOD += 1;
      continue;
    }
    accepted.push(selected);
  }
  return accepted.sort((left, right) => left.occurredAtMs - right.occurredAtMs
    || compareText(left.observationId, right.observationId));
}

function distinctSubjects(observations: PreparedObservation[]) {
  return new Set(observations.map((observation) => observation.subjectId));
}

function firstBySubject(observations: PreparedObservation[]) {
  const result = new Map<string, PreparedObservation>();
  for (const observation of observations) if (!result.has(observation.subjectId)) result.set(observation.subjectId, observation);
  return result;
}

function rateValue(numerator: number, denominator: number, sampleSize: number, places: number): JourneyOperationalMeasureValue {
  return {
    value: denominator ? round((numerator / denominator) * 100, places) : null,
    unit: 'percent',
    numerator,
    denominator,
    sampleSize
  };
}

function countValue(count: number, supportingSubjects: number): JourneyOperationalMeasureValue {
  return { value: count, unit: 'count', numerator: count, denominator: supportingSubjects, sampleSize: supportingSubjects };
}

function eventSubset(observations: PreparedObservation[], eventType: string, stageId?: string) {
  return observations.filter((observation) => observation.eventType === eventType
    && (stageId === undefined || observation.stageId === stageId));
}

function afterFirst(denominator: PreparedObservation[], numerator: PreparedObservation[]) {
  const firstDenominator = firstBySubject(denominator);
  return distinctSubjects(numerator.filter((observation) => {
    const start = firstDenominator.get(observation.subjectId);
    return start && observation.occurredAtMs >= start.occurredAtMs;
  }));
}

function singleRow(key: string, label: string, value: JourneyOperationalMeasureValue): JourneyOperationalMeasureRow[] {
  return [{ key, label, current: value, previous: null, change: null }];
}

function sentimentSnapshot(
  observations: PreparedObservation[],
  eventType: string,
  places: number,
  quality: QualityCounts
) {
  const candidates = eventSubset(observations, eventType);
  const latest = new Map<string, PreparedObservation>();
  for (const observation of candidates) latest.set(observation.subjectId, observation);
  const valid = [...latest.values()].filter((observation) => {
    if (!observation.sentiment || !SENTIMENTS.includes(observation.sentiment)) {
      quality.INVALID_SENTIMENT += 1;
      return false;
    }
    return true;
  });
  const denominator = valid.length;
  const counts = Object.fromEntries(SENTIMENTS.map((sentiment) => [sentiment,
    valid.filter((observation) => observation.sentiment === sentiment).length])) as Record<JourneySentiment, number>;
  return {
    sampleSize: denominator,
    values: Object.fromEntries(SENTIMENTS.map((sentiment) => [sentiment,
      rateValue(counts[sentiment], denominator, denominator, places)])) as Record<JourneySentiment, JourneyOperationalMeasureValue>
  };
}

function percentile(values: number[], quantile: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return Math.round(sorted[lower] + ((sorted[upper] - sorted[lower]) * (position - lower)));
}

function calculateCurrent(
  definition: JourneyOperationalMeasureDefinition,
  observations: PreparedObservation[],
  quality: QualityCounts
): {
  summary: JourneyOperationalMeasureValue | null;
  rows: JourneyOperationalMeasureRow[];
  durationDistribution: JourneyOperationalDurationDistribution | null;
  sampleSize: number;
  formula: string;
  explanation: string;
} {
  if (definition.kind === 'stage_entry') {
    const population = eventSubset(observations, definition.populationEventType);
    const eligible = distinctSubjects(population);
    const entered = afterFirst(population, eventSubset(observations, definition.entryEventType, definition.stageId));
    const numerator = [...entered].filter((subjectId) => eligible.has(subjectId)).length;
    const value = rateValue(numerator, eligible.size, eligible.size, definition.decimalPlaces);
    return { summary: value, rows: singleRow('stage_entry', definition.label, value), durationDistribution: null,
      sampleSize: eligible.size, formula: 'distinct eligible instances entering stage / distinct eligible instances x 100',
      explanation: `${numerator} of ${eligible.size} eligible journey instances entered stage ${definition.stageId}.` };
  }
  if (definition.kind === 'stage_completion' || definition.kind === 'stage_dropout') {
    const entries = eventSubset(observations, definition.entryEventType, definition.stageId);
    const entrants = distinctSubjects(entries);
    const outcomeType = definition.kind === 'stage_completion' ? definition.completionEventType : definition.dropoutEventType;
    const outcomes = afterFirst(entries, eventSubset(observations, outcomeType, definition.stageId));
    const numerator = [...outcomes].filter((subjectId) => entrants.has(subjectId)).length;
    const value = rateValue(numerator, entrants.size, entrants.size, definition.decimalPlaces);
    const noun = definition.kind === 'stage_completion' ? 'completed' : 'had an explicit dropout event for';
    return { summary: value, rows: singleRow(definition.kind, definition.label, value), durationDistribution: null,
      sampleSize: entrants.size,
      formula: `distinct stage entrants with ${definition.kind === 'stage_completion' ? 'completion' : 'explicit dropout'} / distinct stage entrants x 100`,
      explanation: `${numerator} of ${entrants.size} entrants ${noun} stage ${definition.stageId}.` };
  }
  if (definition.kind === 'stage_conversion') {
    const entries = eventSubset(observations, definition.entryEventType, definition.stageId);
    const entrants = distinctSubjects(entries);
    const converted = afterFirst(entries, eventSubset(observations, definition.entryEventType, definition.targetStageId));
    const numerator = [...converted].filter((subjectId) => entrants.has(subjectId)).length;
    const value = rateValue(numerator, entrants.size, entrants.size, definition.decimalPlaces);
    return { summary: value, rows: singleRow('stage_conversion', definition.label, value), durationDistribution: null,
      sampleSize: entrants.size, formula: 'distinct source-stage entrants later entering target stage / distinct source-stage entrants x 100',
      explanation: `${numerator} of ${entrants.size} entrants to ${definition.stageId} later entered ${definition.targetStageId}.` };
  }
  if (definition.kind === 'ticket_rate') {
    const population = eventSubset(observations, definition.populationEventType);
    const eligible = distinctSubjects(population);
    const tickets = afterFirst(population, eventSubset(observations, definition.ticketEventType));
    const numerator = [...tickets].filter((subjectId) => eligible.has(subjectId)).length;
    const value = rateValue(numerator, eligible.size, eligible.size, definition.decimalPlaces);
    return { summary: value, rows: singleRow('ticket_rate', definition.label, value), durationDistribution: null,
      sampleSize: eligible.size, formula: 'distinct eligible subjects with one or more tickets / distinct eligible subjects x 100',
      explanation: `${numerator} of ${eligible.size} eligible subjects had one or more observed tickets.` };
  }
  if (definition.kind === 'repeat_contact_rate') {
    const contacts = eventSubset(observations, definition.contactEventType);
    const counts = new Map<string, number>();
    contacts.forEach((observation) => counts.set(observation.subjectId, (counts.get(observation.subjectId) || 0) + 1));
    const denominator = counts.size;
    const numerator = [...counts.values()].filter((count) => count >= definition.repeatThreshold).length;
    const value = rateValue(numerator, denominator, denominator, definition.decimalPlaces);
    return { summary: value, rows: singleRow('repeat_contact_rate', definition.label, value), durationDistribution: null,
      sampleSize: denominator, formula: `subjects with at least ${definition.repeatThreshold} contacts / subjects with at least one contact x 100`,
      explanation: `${numerator} of ${denominator} contacted subjects had at least ${definition.repeatThreshold} contacts.` };
  }
  if (definition.kind === 'recovery_rate') {
    const eligibleEvents = eventSubset(observations, definition.eligibleEventType);
    const eligible = distinctSubjects(eligibleEvents);
    const recovered = afterFirst(eligibleEvents, eventSubset(observations, definition.successEventType));
    const numerator = [...recovered].filter((subjectId) => eligible.has(subjectId)).length;
    const value = rateValue(numerator, eligible.size, eligible.size, definition.decimalPlaces);
    return { summary: value, rows: singleRow('recovery_rate', definition.label, value), durationDistribution: null,
      sampleSize: eligible.size, formula: 'eligible tickets with later observed recovery success / eligible tickets x 100',
      explanation: `${numerator} of ${eligible.size} eligible tickets had a later observed recovery success.` };
  }
  if (definition.kind === 'sentiment_distribution') {
    const snapshot = sentimentSnapshot(observations, definition.sentimentEventType, definition.decimalPlaces, quality);
    const rows = SENTIMENTS.map((sentiment) => ({
      key: sentiment, label: sentiment[0].toUpperCase() + sentiment.slice(1), current: snapshot.values[sentiment], previous: null, change: null
    }));
    return { summary: null, rows, durationDistribution: null, sampleSize: snapshot.sampleSize,
      formula: 'posts in sentiment category / posts with a valid latest sentiment observation x 100',
      explanation: `Distribution uses the latest valid sentiment observation for each of ${snapshot.sampleSize} social posts in the period.` };
  }
  if (definition.kind === 'custom_count') {
    const matches = eventSubset(observations, definition.eventType);
    const subjects = distinctSubjects(matches).size;
    const count = definition.aggregation === 'events' ? matches.length : subjects;
    const value = countValue(count, subjects);
    return { summary: value, rows: singleRow('custom_count', definition.label, value), durationDistribution: null,
      sampleSize: subjects, formula: definition.aggregation === 'events' ? 'count accepted matching events' : 'count distinct subjects with a matching event',
      explanation: `${count} ${definition.aggregation === 'events' ? 'events' : 'distinct subjects'} matched ${definition.eventType}; ${subjects} distinct subjects support the count.` };
  }
  if (definition.kind === 'custom_rate') {
    const denominators = eventSubset(observations, definition.denominatorEventType);
    const eligible = distinctSubjects(denominators);
    const numeratorSubjects = definition.requireNumeratorAfterDenominator
      ? afterFirst(denominators, eventSubset(observations, definition.numeratorEventType))
      : distinctSubjects(eventSubset(observations, definition.numeratorEventType));
    const numerator = [...numeratorSubjects].filter((subjectId) => eligible.has(subjectId)).length;
    const value = rateValue(numerator, eligible.size, eligible.size, definition.decimalPlaces);
    return { summary: value, rows: singleRow('custom_rate', definition.label, value), durationDistribution: null,
      sampleSize: eligible.size,
      formula: `distinct denominator subjects with ${definition.requireNumeratorAfterDenominator ? 'a later ' : 'a '}numerator event / distinct denominator subjects x 100`,
      explanation: `${numerator} of ${eligible.size} denominator subjects matched the safe numerator rule.` };
  }
  if (definition.kind === 'custom_duration') {
    const starts = firstBySubject(eventSubset(observations, definition.startEventType));
    const ends = eventSubset(observations, definition.endEventType);
    const durations: number[] = [];
    for (const [subjectId, start] of starts) {
      const end = ends.find((candidate) => candidate.subjectId === subjectId && candidate.occurredAtMs >= start.occurredAtMs);
      if (!end) {
        quality.UNPAIRED_DURATION += 1;
        continue;
      }
      const duration = end.occurredAtMs - start.occurredAtMs;
      if (duration > definition.maximumDurationMs) {
        quality.DURATION_EXCEEDS_MAXIMUM += 1;
        continue;
      }
      durations.push(duration);
    }
    const total = durations.reduce((sum, duration) => sum + duration, 0);
    const count = durations.length;
    const value: JourneyOperationalMeasureValue = {
      value: count ? round(total / count, definition.decimalPlaces) : null,
      unit: 'milliseconds', numerator: count ? total : null, denominator: count, sampleSize: count
    };
    return {
      summary: value,
      rows: singleRow('custom_duration', definition.label, value),
      durationDistribution: {
        observationCount: count,
        minimumMs: count ? Math.min(...durations) : null,
        p50Ms: percentile(durations, 0.5), p90Ms: percentile(durations, 0.9), p95Ms: percentile(durations, 0.95),
        maximumMs: count ? Math.max(...durations) : null
      },
      sampleSize: count,
      formula: 'sum(first end after first start duration per subject) / paired subjects',
      explanation: `${count} subjects had a valid first-start to first-later-end pair within ${definition.maximumDurationMs} ms.`
    };
  }
  fail('OPERATIONAL_KIND_UNREACHABLE', 'Sentiment trend is calculated with its comparison period.');
}

function calculateSentimentTrend(
  definition: JourneySentimentTrendDefinition,
  currentObservations: PreparedObservation[],
  previousObservations: PreparedObservation[],
  quality: QualityCounts
) {
  const current = sentimentSnapshot(currentObservations, definition.sentimentEventType, definition.decimalPlaces, quality);
  const previous = sentimentSnapshot(previousObservations, definition.sentimentEventType, definition.decimalPlaces, quality);
  const rows = SENTIMENTS.map((sentiment) => {
    const currentValue = current.values[sentiment];
    const previousValue = previous.values[sentiment];
    const changeValue = currentValue.value === null || previousValue.value === null
      ? null : round(currentValue.value - previousValue.value, definition.decimalPlaces);
    return {
      key: sentiment,
      label: sentiment[0].toUpperCase() + sentiment.slice(1),
      current: currentValue,
      previous: previousValue,
      change: {
        value: changeValue,
        unit: 'percentage_points' as const,
        numerator: changeValue,
        denominator: 1,
        sampleSize: Math.min(current.sampleSize, previous.sampleSize)
      }
    };
  });
  return {
    summary: null,
    rows,
    durationDistribution: null,
    sampleSize: Math.min(current.sampleSize, previous.sampleSize),
    formula: 'current sentiment percentage - comparison-period sentiment percentage, in percentage points',
    explanation: `Trend compares ${current.sampleSize} current posts with ${previous.sampleSize} comparison-period posts using the latest valid observation per post.`
  };
}

export function calculateJourneyOperationalMeasure(request: JourneyOperationalMeasureRequest): JourneyOperationalMeasureResult {
  validateDefinition(request.definition);
  if (!Array.isArray(request.observations)) fail('OPERATIONAL_OBSERVATIONS_INVALID', 'observations must be an array.');
  const currentBounds = validatePeriod(request.period, 'period');
  const comparisonBounds = request.definition.kind === 'sentiment_trend'
    ? validatePeriod(request.definition.comparisonPeriod, 'comparisonPeriod') : null;
  if (request.definition.kind === 'sentiment_trend') {
    const currentDuration = currentBounds.endMs - currentBounds.startMs;
    const comparisonDuration = (comparisonBounds as { startMs: number; endMs: number }).endMs
      - (comparisonBounds as { startMs: number; endMs: number }).startMs;
    if (request.period.timezone !== request.definition.comparisonPeriod.timezone || currentDuration !== comparisonDuration
      || (comparisonBounds as { endMs: number }).endMs > currentBounds.startMs) {
      fail('OPERATIONAL_COMPARISON_PERIOD_INVALID', 'Sentiment trend periods must be non-overlapping, equally sized, and use the same timezone.');
    }
  }
  const asOfMs = parseInstant(request.asOf);
  if (asOfMs === null) fail('OPERATIONAL_AS_OF_INVALID', 'asOf must be a valid instant.');
  const quality = qualityCounts();
  const accepted = prepareObservations(request, currentBounds, comparisonBounds, asOfMs, quality);
  const relevantEventTypes = new Set(eventFields(request.definition));
  const relevant = accepted.filter((observation) => relevantEventTypes.has(observation.eventType));
  const current = relevant.filter((observation) => observation.occurredAtMs >= currentBounds.startMs
    && observation.occurredAtMs < currentBounds.endMs);
  const comparison = comparisonBounds ? relevant.filter((observation) =>
    observation.occurredAtMs >= comparisonBounds.startMs && observation.occurredAtMs < comparisonBounds.endMs) : [];
  const calculated = request.definition.kind === 'sentiment_trend'
    ? calculateSentimentTrend(request.definition, current, comparison, quality)
    : calculateCurrent(request.definition, current, quality);
  const latest = current.at(-1) || null;
  const ageSeconds = latest ? Math.floor((asOfMs - latest.occurredAtMs) / 1000) : null;
  const freshnessStatus = ageSeconds === null ? 'unavailable' as const
    : ageSeconds <= request.definition.freshnessMaxAgeSeconds ? 'fresh' as const : 'stale' as const;
  const minimumActive = calculated.sampleSize < request.definition.minimumSampleSize;
  const lineages = [...request.definition.sourceLineages].map(canonicalLineage)
    .sort((left, right) => compareText(lineageKey(left), lineageKey(right)));
  return {
    calculationVersion: JOURNEY_OPERATIONAL_MEASURE_VERSION,
    measureId: request.definition.measureId,
    definitionVersion: request.definition.definitionVersion,
    kind: request.definition.kind,
    sourceLineages: lineages,
    period: { ...request.period },
    comparisonPeriod: request.definition.kind === 'sentiment_trend' ? { ...request.definition.comparisonPeriod } : null,
    asOf: request.asOf,
    summary: calculated.summary,
    rows: calculated.rows,
    durationDistribution: calculated.durationDistribution,
    freshness: {
      status: freshnessStatus,
      latestObservedAt: latest?.occurredAt || null,
      ageSeconds,
      maximumAgeSeconds: request.definition.freshnessMaxAgeSeconds,
      asOf: request.asOf
    },
    minimumSampleWarning: {
      active: minimumActive,
      minimumSampleSize: request.definition.minimumSampleSize,
      actualSampleSize: calculated.sampleSize,
      message: minimumActive
        ? `Only ${calculated.sampleSize} supporting subjects are available; at least ${request.definition.minimumSampleSize} are configured.`
        : null
    },
    exclusions: EXCLUSION_ORDER.map((reason) => ({ reason, count: quality[reason] })),
    formula: calculated.formula,
    explanation: calculated.explanation,
    interpretation: {
      mode: 'descriptive_only',
      statement: 'This measure describes accepted observations for the stated sources, versions, population, and periods. It does not establish causation, statistical significance, representativeness, or why an outcome changed.'
    }
  };
}
