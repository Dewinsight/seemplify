import { api, json } from '@/lib/api';

export type JourneyMetricTargetType = 'journey' | 'stage' | 'touchpoint' | 'persona' | 'segment';
export type JourneyMetricSourceKind = 'survey' | 'operational_import';
export type JourneyMetricCalculatorKind = 'nps' | 'csat' | 'ces' | 'operational';
export type JourneyMetricDirection = 'higher_is_better' | 'lower_is_better' | 'neutral';

export interface JourneyMetricSegment {
  id: string; journeyDefinitionId: string; name: string; description: string;
  rule: Record<string, unknown>; state: 'active' | 'retired'; revision: number;
  createdByUserId: string | null; createdAt: string; updatedAt: string;
}

export interface JourneyMetricBinding {
  id: string; journeyDefinitionId: string; targetType: JourneyMetricTargetType; targetId: string;
  surveyId: string | null; collectorId: string | null; questionId: string | null;
  sourceRef: string; sourceState: 'available' | 'deleted'; state: 'active' | 'retired'; revision: number;
  createdByUserId: string | null; createdAt: string; updatedAt: string;
}

export const journeyNativeMetricAdapters = ['service_recovery_tickets', 'social_mentions'] as const;
export type JourneyNativeMetricAdapter = typeof journeyNativeMetricAdapters[number];
export type JourneyNativeMetricSourceType = 'native_service_recovery_ticket' | 'native_social_mention';

/** Content-free descriptor of a first-party native source. `sourceIds` are the
 * exact authorised same-space survey or connection identities the definition is
 * pinned to; nothing here carries ticket or mention content. */
export interface JourneyMetricNativeSource {
  configVersion: string; adapter: JourneyNativeMetricAdapter; adapterVersion: string;
  sourceType: JourneyNativeMetricSourceType; label: string; sourceIds: string[]; sourceCount: number;
  stageId: string | null; stageAssociationVia: 'research_link' | null;
}

export interface JourneyMetricVersion {
  id: string; definitionId: string; versionNumber: number; sourceKind: JourneyMetricSourceKind;
  nativeSource: JourneyMetricNativeSource | null;
  bindingId: string | null; calculatorKind: JourneyMetricCalculatorKind; aggregation: string;
  direction: JourneyMetricDirection; windowSeconds: number; timezone: string; minimumSampleSize: number;
  freshnessMaxAgeSeconds: number; baselineValue: number | null; targetValue: number | null;
  population: Record<string, unknown>; filters: Record<string, unknown>; formula: Record<string, unknown>;
  configuration: Record<string, unknown>; contentSha256: string; createdByUserId: string | null; createdAt: string;
}

export interface JourneyMetricDefinition {
  id: string; journeyDefinitionId: string; targetType: JourneyMetricTargetType; targetId: string;
  name: string; state: 'active' | 'retired'; currentVersionId: string | null; revision: number;
  currentVersion: JourneyMetricVersion | null; createdByUserId: string | null; createdAt: string; updatedAt: string;
}

export interface JourneyMetricRebuild {
  id: string; definitionId: string; definitionVersionId: string; reason:
    'manual' | 'source_created' | 'source_corrected' | 'source_deleted' | 'reconcile' | 'scheduled';
  asOf: string; state: 'pending' | 'leased' | 'retryable' | 'completed' | 'failed'; availableAt: string;
  attemptCount: number; maxAttempts: number; observationId: string | null; errorCode: string | null;
  createdAt: string; updatedAt: string; completedAt: string | null;
}

export interface JourneyMetricLineageItem {
  sourceType: 'survey_response' | 'operational_import' | JourneyNativeMetricSourceType; sourceRecordId: string;
  sourceRevisionSha256: string; occurredAt: string; included: boolean; exclusionCode: string | null;
}

export type JourneyMetricPrivacyReason =
  'PRIVACY_SUPPRESSED_SOURCE' | 'SMALL_SAMPLE_SUPPRESSED' | 'DEFINITION_VERSION_UNAVAILABLE';

export interface JourneyMetricPrivacy {
  suppressed: boolean; reasonCode: JourneyMetricPrivacyReason | null;
  minimumSampleSize: number; privacyVersion: number;
}

export interface JourneyMetricSentimentRow {
  key: string; label: string; currentValue: number | null; currentUnit: string;
  previousValue: number | null; changeValue: number | null; changeUnit: string | null;
}

export interface JourneyMetricSentimentLane {
  kind: 'sentiment_distribution' | 'sentiment_trend'; rows: JourneyMetricSentimentRow[];
  period: Record<string, unknown> | null; comparisonPeriod: Record<string, unknown> | null;
  formula: string | null; subjectType: 'social_post'; aggregateOnly: boolean;
}

export interface JourneyMetricFacet { id: string; name: string }

export interface JourneyMetricAppliedFilters {
  journeyDefinitionId: string | null; definitionId: string | null;
  window: { from: string | null; to: string | null };
  targetTypes: JourneyMetricTargetType[]; personas: JourneyMetricFacet[];
  segments: JourneyMetricFacet[]; channels: JourneyMetricFacet[];
  cohortsSupported: boolean; selection: 'materialised_authorised_observations';
  limit: number; offset: number; truncated: boolean;
}

export interface JourneyMetricObservation {
  id: string; definitionId: string; definitionVersionId: string; revision: number;
  supersedesObservationId: string | null; status: 'available' | 'unavailable' | 'retracted';
  value: number | null; unit: string; numerator: number | null; denominator: number | null;
  sampleSize: number | null;
  period: { start: string; end: string; timezone: string }; asOf: string; calculatedAt: string;
  freshnessStatus: 'fresh' | 'stale' | 'unavailable'; latestObservedAt: string | null;
  minimumSampleWarning: boolean; sourceCount: number | null; result: Record<string, unknown>;
  sentiment: JourneyMetricSentimentLane | null; privacy: JourneyMetricPrivacy;
  rebuildRunId: string | null; lineage?: JourneyMetricLineageItem[];
}

export interface JourneyMetricVersionInput {
  sourceKind: JourneyMetricSourceKind; bindingId?: string | null; calculatorKind: JourneyMetricCalculatorKind;
  aggregation: string; direction: JourneyMetricDirection; windowSeconds: number; timezone: string;
  minimumSampleSize: number; freshnessMaxAgeSeconds: number; baselineValue?: number | null;
  targetValue?: number | null; population?: Record<string, unknown>; filters?: Record<string, unknown>;
  formula?: Record<string, unknown>; configuration: Record<string, unknown>;
}

export class JourneyMetricResponseError extends Error {
  constructor(message: string) {
    super(`Invalid journey metric response: ${message}`);
    this.name = 'JourneyMetricResponseError';
  }
}

type JsonRecord = Record<string, unknown>;

function fail(message: string): never { throw new JourneyMetricResponseError(message); }
function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${label} must be an object`);
  return value as JsonRecord;
}
function exact(value: unknown, label: string, keys: readonly string[]): JsonRecord {
  const row = record(value, label);
  const allowed = new Set(keys);
  const extra = Object.keys(row).filter((key) => !allowed.has(key));
  if (extra.length) fail(`${label} contains unexpected field ${extra[0]}`);
  return row;
}
function text(value: unknown, label: string) {
  if (typeof value !== 'string') fail(`${label} must be a string`); return value;
}
function nonempty(value: unknown, label: string) {
  const result = text(value, label); if (!result.length) fail(`${label} must not be empty`); return result;
}
function nullableText(value: unknown, label: string) { return value === null ? null : text(value, label); }
function finite(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${label} must be a finite number`); return value;
}
function integer(value: unknown, label: string, minimum = 0) {
  const result = finite(value, label); if (!Number.isSafeInteger(result) || result < minimum) fail(`${label} must be an integer of at least ${minimum}`);
  return result;
}
function nullableFinite(value: unknown, label: string) { return value === null ? null : finite(value, label); }
function bool(value: unknown, label: string) { if (typeof value !== 'boolean') fail(`${label} must be boolean`); return value; }
function iso(value: unknown, label: string) {
  const result = nonempty(value, label); if (!Number.isFinite(Date.parse(result))) fail(`${label} must be an ISO timestamp`); return result;
}
function nullableIso(value: unknown, label: string) { return value === null ? null : iso(value, label); }
function enumValue<T extends string>(value: unknown, label: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) fail(`${label} is not an allowed value`); return value as T;
}
function jsonRecord(value: unknown, label: string) { return record(value, label); }
function nullableId(value: unknown, label: string) { return value === null ? null : nonempty(value, label); }
function array(value: unknown, label: string) { if (!Array.isArray(value)) fail(`${label} must be an array`); return value; }

const targetTypes = ['journey', 'stage', 'touchpoint', 'persona', 'segment'] as const;
const sourceKinds = ['survey', 'operational_import'] as const;
const nativeSourceTypes = ['native_service_recovery_ticket', 'native_social_mention'] as const;
const lineageSourceTypes = ['survey_response', 'operational_import', ...nativeSourceTypes] as const;
const calculatorKinds = ['nps', 'csat', 'ces', 'operational'] as const;
const directions = ['higher_is_better', 'lower_is_better', 'neutral'] as const;

export function parseJourneyMetricSegment(value: unknown): JourneyMetricSegment {
  const row = exact(value, 'segment', ['id', 'journeyDefinitionId', 'name', 'description', 'rule', 'state', 'revision',
    'createdByUserId', 'createdAt', 'updatedAt']);
  return { id: nonempty(row.id, 'segment.id'), journeyDefinitionId: nonempty(row.journeyDefinitionId, 'segment.journeyDefinitionId'),
    name: nonempty(row.name, 'segment.name'), description: text(row.description, 'segment.description'),
    rule: jsonRecord(row.rule, 'segment.rule'), state: enumValue(row.state, 'segment.state', ['active', 'retired']),
    revision: integer(row.revision, 'segment.revision', 1), createdByUserId: nullableId(row.createdByUserId, 'segment.createdByUserId'),
    createdAt: iso(row.createdAt, 'segment.createdAt'), updatedAt: iso(row.updatedAt, 'segment.updatedAt') };
}

export function parseJourneyMetricBinding(value: unknown): JourneyMetricBinding {
  const row = exact(value, 'binding', ['id', 'journeyDefinitionId', 'targetType', 'targetId', 'surveyId', 'collectorId',
    'questionId', 'sourceRef', 'sourceState', 'state', 'revision', 'createdByUserId', 'createdAt', 'updatedAt']);
  return { id: nonempty(row.id, 'binding.id'), journeyDefinitionId: nonempty(row.journeyDefinitionId, 'binding.journeyDefinitionId'),
    targetType: enumValue(row.targetType, 'binding.targetType', targetTypes), targetId: nonempty(row.targetId, 'binding.targetId'),
    surveyId: nullableId(row.surveyId, 'binding.surveyId'), collectorId: nullableId(row.collectorId, 'binding.collectorId'),
    questionId: nullableId(row.questionId, 'binding.questionId'), sourceRef: nonempty(row.sourceRef, 'binding.sourceRef'),
    sourceState: enumValue(row.sourceState, 'binding.sourceState', ['available', 'deleted']),
    state: enumValue(row.state, 'binding.state', ['active', 'retired']), revision: integer(row.revision, 'binding.revision', 1),
    createdByUserId: nullableId(row.createdByUserId, 'binding.createdByUserId'), createdAt: iso(row.createdAt, 'binding.createdAt'),
    updatedAt: iso(row.updatedAt, 'binding.updatedAt') };
}

/** A native source descriptor is only meaningful on an operational-kind version:
 * the pinned runtime schema stores `operational_import` for a native definition
 * and the server derives the real identity back out of the immutable version.
 * Anything else is a backend regression and is refused rather than rendered. */
function parseNativeSource(value: unknown): JourneyMetricNativeSource {
  const row = exact(value, 'definitionVersion.nativeSource', ['configVersion', 'adapter', 'adapterVersion',
    'sourceType', 'label', 'sourceIds', 'sourceCount', 'stageId', 'stageAssociationVia']);
  const sourceIds = array(row.sourceIds, 'nativeSource.sourceIds')
    .map((entry) => nonempty(entry, 'nativeSource.sourceIds entry'));
  const sourceCount = integer(row.sourceCount, 'nativeSource.sourceCount', 1);
  if (sourceCount !== sourceIds.length) fail('nativeSource.sourceCount must match the pinned source identities');
  return { configVersion: nonempty(row.configVersion, 'nativeSource.configVersion'),
    adapter: enumValue(row.adapter, 'nativeSource.adapter', journeyNativeMetricAdapters),
    adapterVersion: nonempty(row.adapterVersion, 'nativeSource.adapterVersion'),
    sourceType: enumValue(row.sourceType, 'nativeSource.sourceType', nativeSourceTypes),
    label: nonempty(row.label, 'nativeSource.label'), sourceIds, sourceCount,
    stageId: nullableId(row.stageId, 'nativeSource.stageId'),
    stageAssociationVia: row.stageAssociationVia === null
      ? null : enumValue(row.stageAssociationVia, 'nativeSource.stageAssociationVia', ['research_link'] as const) };
}

export function parseJourneyMetricVersion(value: unknown): JourneyMetricVersion {
  const row = exact(value, 'definition version', ['id', 'definitionId', 'versionNumber', 'sourceKind', 'nativeSource',
    'bindingId', 'calculatorKind', 'aggregation', 'direction', 'windowSeconds', 'timezone', 'minimumSampleSize',
    'freshnessMaxAgeSeconds', 'baselineValue', 'targetValue', 'population', 'filters', 'formula', 'configuration',
    'contentSha256', 'createdByUserId', 'createdAt']);
  const contentSha256 = nonempty(row.contentSha256, 'definitionVersion.contentSha256');
  if (!/^[a-f0-9]{64}$/u.test(contentSha256)) fail('definitionVersion.contentSha256 must be a SHA-256 digest');
  const sourceKind = enumValue(row.sourceKind, 'definitionVersion.sourceKind', sourceKinds);
  const nativeSource = row.nativeSource === null || row.nativeSource === undefined
    ? null : parseNativeSource(row.nativeSource);
  if (nativeSource && sourceKind !== 'operational_import') {
    fail('definitionVersion.nativeSource is only valid on an operational source kind');
  }
  return { id: nonempty(row.id, 'definitionVersion.id'), definitionId: nonempty(row.definitionId, 'definitionVersion.definitionId'),
    versionNumber: integer(row.versionNumber, 'definitionVersion.versionNumber', 1),
    sourceKind, nativeSource,
    bindingId: nullableId(row.bindingId, 'definitionVersion.bindingId'),
    calculatorKind: enumValue(row.calculatorKind, 'definitionVersion.calculatorKind', calculatorKinds),
    aggregation: nonempty(row.aggregation, 'definitionVersion.aggregation'),
    direction: enumValue(row.direction, 'definitionVersion.direction', directions),
    windowSeconds: integer(row.windowSeconds, 'definitionVersion.windowSeconds', 60),
    timezone: nonempty(row.timezone, 'definitionVersion.timezone'),
    minimumSampleSize: integer(row.minimumSampleSize, 'definitionVersion.minimumSampleSize', 1),
    freshnessMaxAgeSeconds: integer(row.freshnessMaxAgeSeconds, 'definitionVersion.freshnessMaxAgeSeconds', 1),
    baselineValue: nullableFinite(row.baselineValue, 'definitionVersion.baselineValue'),
    targetValue: nullableFinite(row.targetValue, 'definitionVersion.targetValue'),
    population: jsonRecord(row.population, 'definitionVersion.population'), filters: jsonRecord(row.filters, 'definitionVersion.filters'),
    formula: jsonRecord(row.formula, 'definitionVersion.formula'), configuration: jsonRecord(row.configuration, 'definitionVersion.configuration'),
    contentSha256, createdByUserId: nullableId(row.createdByUserId, 'definitionVersion.createdByUserId'),
    createdAt: iso(row.createdAt, 'definitionVersion.createdAt') };
}

export function parseJourneyMetricDefinition(value: unknown): JourneyMetricDefinition {
  const row = exact(value, 'definition', ['id', 'journeyDefinitionId', 'targetType', 'targetId', 'name', 'state',
    'currentVersionId', 'revision', 'currentVersion', 'createdByUserId', 'createdAt', 'updatedAt']);
  const definition = { id: nonempty(row.id, 'definition.id'),
    journeyDefinitionId: nonempty(row.journeyDefinitionId, 'definition.journeyDefinitionId'),
    targetType: enumValue(row.targetType, 'definition.targetType', targetTypes), targetId: nonempty(row.targetId, 'definition.targetId'),
    name: nonempty(row.name, 'definition.name'), state: enumValue(row.state, 'definition.state', ['active', 'retired']),
    currentVersionId: nullableId(row.currentVersionId, 'definition.currentVersionId'), revision: integer(row.revision, 'definition.revision', 1),
    currentVersion: row.currentVersion === null ? null : parseJourneyMetricVersion(row.currentVersion),
    createdByUserId: nullableId(row.createdByUserId, 'definition.createdByUserId'), createdAt: iso(row.createdAt, 'definition.createdAt'),
    updatedAt: iso(row.updatedAt, 'definition.updatedAt') } satisfies JourneyMetricDefinition;
  if (definition.currentVersion && (definition.currentVersion.definitionId !== definition.id
      || definition.currentVersion.id !== definition.currentVersionId)) fail('definition current version identity does not match');
  return definition;
}

export function parseJourneyMetricRebuild(value: unknown): JourneyMetricRebuild {
  const row = exact(value, 'rebuild', ['id', 'definitionId', 'definitionVersionId', 'reason', 'asOf', 'state', 'availableAt',
    'attemptCount', 'maxAttempts', 'observationId', 'errorCode', 'createdAt', 'updatedAt', 'completedAt']);
  return { id: nonempty(row.id, 'rebuild.id'), definitionId: nonempty(row.definitionId, 'rebuild.definitionId'),
    definitionVersionId: nonempty(row.definitionVersionId, 'rebuild.definitionVersionId'),
    reason: enumValue(row.reason, 'rebuild.reason', ['manual', 'source_created', 'source_corrected', 'source_deleted', 'reconcile', 'scheduled']),
    asOf: iso(row.asOf, 'rebuild.asOf'), state: enumValue(row.state, 'rebuild.state', ['pending', 'leased', 'retryable', 'completed', 'failed']),
    availableAt: iso(row.availableAt, 'rebuild.availableAt'), attemptCount: integer(row.attemptCount, 'rebuild.attemptCount'),
    maxAttempts: integer(row.maxAttempts, 'rebuild.maxAttempts', 1), observationId: nullableId(row.observationId, 'rebuild.observationId'),
    errorCode: nullableText(row.errorCode, 'rebuild.errorCode'), createdAt: iso(row.createdAt, 'rebuild.createdAt'),
    updatedAt: iso(row.updatedAt, 'rebuild.updatedAt'), completedAt: nullableIso(row.completedAt, 'rebuild.completedAt') };
}

function parseLineage(value: unknown): JourneyMetricLineageItem {
  const row = exact(value, 'observation lineage item', ['sourceType', 'sourceRecordId', 'sourceRevisionSha256', 'occurredAt',
    'included', 'exclusionCode']);
  const digest = nonempty(row.sourceRevisionSha256, 'lineage.sourceRevisionSha256');
  if (!/^[a-f0-9]{64}$/u.test(digest)) fail('lineage.sourceRevisionSha256 must be a SHA-256 digest');
  return { sourceType: enumValue(row.sourceType, 'lineage.sourceType', lineageSourceTypes),
    sourceRecordId: nonempty(row.sourceRecordId, 'lineage.sourceRecordId'), sourceRevisionSha256: digest,
    occurredAt: iso(row.occurredAt, 'lineage.occurredAt'), included: bool(row.included, 'lineage.included'),
    exclusionCode: nullableText(row.exclusionCode, 'lineage.exclusionCode') };
}

function nullableInteger(value: unknown, label: string) { return value === null ? null : integer(value, label); }

const privacyReasons = ['PRIVACY_SUPPRESSED_SOURCE', 'SMALL_SAMPLE_SUPPRESSED', 'DEFINITION_VERSION_UNAVAILABLE'] as const;

function parsePrivacy(value: unknown): JourneyMetricPrivacy {
  const row = exact(value, 'observation.privacy', ['suppressed', 'reasonCode', 'minimumSampleSize', 'privacyVersion']);
  return { suppressed: bool(row.suppressed, 'observation.privacy.suppressed'),
    reasonCode: row.reasonCode === null ? null : enumValue(row.reasonCode, 'observation.privacy.reasonCode', privacyReasons),
    minimumSampleSize: integer(row.minimumSampleSize, 'observation.privacy.minimumSampleSize'),
    privacyVersion: integer(row.privacyVersion, 'observation.privacy.privacyVersion', 1) };
}

function parseSentimentRow(value: unknown): JourneyMetricSentimentRow {
  const row = exact(value, 'observation.sentiment row', ['key', 'label', 'currentValue', 'currentUnit',
    'previousValue', 'changeValue', 'changeUnit']);
  return { key: nonempty(row.key, 'sentiment.key'), label: nonempty(row.label, 'sentiment.label'),
    currentValue: nullableFinite(row.currentValue, 'sentiment.currentValue'),
    currentUnit: nonempty(row.currentUnit, 'sentiment.currentUnit'),
    previousValue: nullableFinite(row.previousValue, 'sentiment.previousValue'),
    changeValue: nullableFinite(row.changeValue, 'sentiment.changeValue'),
    changeUnit: nullableText(row.changeUnit, 'sentiment.changeUnit') };
}

function parseSentimentLane(value: unknown): JourneyMetricSentimentLane {
  const row = exact(value, 'observation.sentiment', ['kind', 'rows', 'period', 'comparisonPeriod', 'formula',
    'subjectType', 'aggregateOnly']);
  const lane = { kind: enumValue(row.kind, 'sentiment.kind', ['sentiment_distribution', 'sentiment_trend'] as const),
    rows: array(row.rows, 'sentiment.rows').map(parseSentimentRow),
    period: row.period === null ? null : jsonRecord(row.period, 'sentiment.period'),
    comparisonPeriod: row.comparisonPeriod === null ? null : jsonRecord(row.comparisonPeriod, 'sentiment.comparisonPeriod'),
    formula: nullableText(row.formula, 'sentiment.formula'),
    subjectType: enumValue(row.subjectType, 'sentiment.subjectType', ['social_post'] as const),
    aggregateOnly: bool(row.aggregateOnly, 'sentiment.aggregateOnly') };
  // A sentiment lane that is not aggregate-only would be a stream of individual
  // social posts rendered as a customer path. Refuse it rather than draw it.
  if (!lane.aggregateOnly) fail('observation.sentiment must be aggregate only');
  return lane;
}

export function parseJourneyMetricObservation(value: unknown, requireLineage = false): JourneyMetricObservation {
  const row = exact(value, 'observation', ['id', 'definitionId', 'definitionVersionId', 'revision', 'supersedesObservationId',
    'status', 'value', 'unit', 'numerator', 'denominator', 'sampleSize', 'period', 'asOf', 'calculatedAt', 'freshnessStatus',
    'latestObservedAt', 'minimumSampleWarning', 'sourceCount', 'result', 'sentiment', 'privacy', 'rebuildRunId', 'lineage']);
  const period = exact(row.period, 'observation.period', ['start', 'end', 'timezone']);
  if (requireLineage && !Array.isArray(row.lineage)) fail('observation.lineage must be present');
  const privacy = parsePrivacy(row.privacy);
  const observation = { id: nonempty(row.id, 'observation.id'), definitionId: nonempty(row.definitionId, 'observation.definitionId'),
    definitionVersionId: nonempty(row.definitionVersionId, 'observation.definitionVersionId'),
    revision: integer(row.revision, 'observation.revision', 1),
    supersedesObservationId: nullableId(row.supersedesObservationId, 'observation.supersedesObservationId'),
    status: enumValue(row.status, 'observation.status', ['available', 'unavailable', 'retracted']),
    value: nullableFinite(row.value, 'observation.value'), unit: nonempty(row.unit, 'observation.unit'),
    numerator: nullableFinite(row.numerator, 'observation.numerator'),
    denominator: nullableInteger(row.denominator, 'observation.denominator'),
    sampleSize: nullableInteger(row.sampleSize, 'observation.sampleSize'),
    period: { start: iso(period.start, 'observation.period.start'), end: iso(period.end, 'observation.period.end'),
      timezone: nonempty(period.timezone, 'observation.period.timezone') },
    asOf: iso(row.asOf, 'observation.asOf'), calculatedAt: iso(row.calculatedAt, 'observation.calculatedAt'),
    freshnessStatus: enumValue(row.freshnessStatus, 'observation.freshnessStatus', ['fresh', 'stale', 'unavailable']),
    latestObservedAt: nullableIso(row.latestObservedAt, 'observation.latestObservedAt'),
    minimumSampleWarning: bool(row.minimumSampleWarning, 'observation.minimumSampleWarning'),
    sourceCount: nullableInteger(row.sourceCount, 'observation.sourceCount'),
    result: jsonRecord(row.result, 'observation.result'),
    sentiment: row.sentiment === null ? null : parseSentimentLane(row.sentiment), privacy,
    rebuildRunId: nullableId(row.rebuildRunId, 'observation.rebuildRunId'),
    ...(Array.isArray(row.lineage) ? { lineage: row.lineage.map(parseLineage) } : {}) };
  // Fail closed on the client too: a response that claims suppression while
  // still carrying a value, a denominator or a sample is a backend regression,
  // and rendering it would leak exactly what the flag promised to protect.
  if (privacy.suppressed) {
    const leaked = ([['value', observation.value], ['numerator', observation.numerator],
      ['denominator', observation.denominator], ['sampleSize', observation.sampleSize],
      ['sourceCount', observation.sourceCount]] as const).find(([, item]) => item !== null);
    if (leaked) fail(`suppressed observation must not disclose ${leaked[0]}`);
    if (observation.sentiment) fail('suppressed observation must not disclose a sentiment lane');
    if (observation.lineage?.some((item) => item.sourceRecordId !== null)) {
      fail('suppressed observation must not disclose per-record lineage');
    }
  }
  return observation;
}

export function parseJourneyMetricAppliedFilters(value: unknown): JourneyMetricAppliedFilters {
  const row = exact(value, 'appliedFilters', ['journeyDefinitionId', 'definitionId', 'window', 'targetTypes',
    'personas', 'segments', 'channels', 'cohortsSupported', 'selection', 'limit', 'offset', 'truncated']);
  const window = exact(row.window, 'appliedFilters.window', ['from', 'to']);
  const facets = (item: unknown, label: string) => array(item, label).map((entry) => {
    const facet = exact(entry, label, ['id', 'name']);
    return { id: nonempty(facet.id, `${label}.id`), name: nonempty(facet.name, `${label}.name`) };
  });
  return { journeyDefinitionId: nullableId(row.journeyDefinitionId, 'appliedFilters.journeyDefinitionId'),
    definitionId: nullableId(row.definitionId, 'appliedFilters.definitionId'),
    window: { from: nullableIso(window.from, 'appliedFilters.window.from'),
      to: nullableIso(window.to, 'appliedFilters.window.to') },
    targetTypes: array(row.targetTypes, 'appliedFilters.targetTypes')
      .map((entry) => enumValue(entry, 'appliedFilters.targetTypes', targetTypes)),
    personas: facets(row.personas, 'appliedFilters.personas'),
    segments: facets(row.segments, 'appliedFilters.segments'),
    channels: facets(row.channels, 'appliedFilters.channels'),
    cohortsSupported: bool(row.cohortsSupported, 'appliedFilters.cohortsSupported'),
    selection: enumValue(row.selection, 'appliedFilters.selection', ['materialised_authorised_observations'] as const),
    limit: integer(row.limit, 'appliedFilters.limit', 1), offset: integer(row.offset, 'appliedFilters.offset'),
    truncated: bool(row.truncated, 'appliedFilters.truncated') };
}

function listQuery(path: string, query: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => { if (value !== undefined) params.set(key, String(value)); });
  const suffix = params.size ? `?${params.toString()}` : '';
  return `${path}${suffix}`;
}
function mutationKey(prefix: string) { return `${prefix}:${crypto.randomUUID()}`; }
function mutationOptions(method: 'POST' | 'PATCH', body: JsonRecord, idempotencyKey?: string) {
  return {
    ...json(method, body),
    ...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {})
  };
}
function parseEnvelope(value: unknown, key: string) { const row = exact(value, 'response', [key]); return row[key]; }
function parseReplayEnvelope(value: unknown, key: string) {
  const row = exact(value, 'mutation response', [key, 'replayed']); return { value: row[key], replayed: bool(row.replayed, 'response.replayed') };
}

export async function listJourneyMetricSegments(journeyDefinitionId: string) {
  const raw = await api<unknown>(listQuery('/api/journey-metrics/segments', { journeyDefinitionId, limit: 100 }));
  return array(parseEnvelope(raw, 'segments'), 'segments').map(parseJourneyMetricSegment);
}
export async function createJourneyMetricSegment(input: { journeyDefinitionId: string; name: string; description?: string;
  rule?: Record<string, unknown> }) {
  const key = mutationKey('metric-segment'); const raw = await api<unknown>('/api/journey-metrics/segments', mutationOptions('POST', input, key));
  const result = parseReplayEnvelope(raw, 'segment'); return { segment: parseJourneyMetricSegment(result.value), replayed: result.replayed };
}
export async function updateJourneyMetricSegment(segmentId: string, input: { expectedRevision: number; name?: string;
  description?: string; rule?: Record<string, unknown>; state?: 'active' | 'retired' }) {
  const raw = await api<unknown>(`/api/journey-metrics/segments/${encodeURIComponent(segmentId)}`, json('PATCH', input));
  return parseJourneyMetricSegment(parseEnvelope(raw, 'segment'));
}

export async function listJourneyMetricBindings(journeyDefinitionId: string) {
  const raw = await api<unknown>(listQuery('/api/journey-metrics/bindings', { journeyDefinitionId, limit: 100 }));
  return array(parseEnvelope(raw, 'bindings'), 'bindings').map(parseJourneyMetricBinding);
}
export async function createJourneyMetricBinding(input: { journeyDefinitionId: string; targetType: JourneyMetricTargetType;
  targetId: string; surveyId: string; collectorId?: string | null; questionId?: string | null }) {
  const key = mutationKey('metric-binding'); const raw = await api<unknown>('/api/journey-metrics/bindings', mutationOptions('POST', input, key));
  const result = parseReplayEnvelope(raw, 'binding'); return { binding: parseJourneyMetricBinding(result.value), replayed: result.replayed };
}
export async function updateJourneyMetricBinding(bindingId: string, input: { expectedRevision: number; state: 'active' | 'retired' }) {
  const raw = await api<unknown>(`/api/journey-metrics/bindings/${encodeURIComponent(bindingId)}`, json('PATCH', input));
  return parseJourneyMetricBinding(parseEnvelope(raw, 'binding'));
}

export async function listJourneyMetricDefinitions(journeyDefinitionId: string) {
  const raw = await api<unknown>(listQuery('/api/journey-metrics/definitions', { journeyDefinitionId, limit: 100 }));
  return array(parseEnvelope(raw, 'definitions'), 'definitions').map(parseJourneyMetricDefinition);
}
export async function readJourneyMetricDefinition(definitionId: string) {
  const raw = await api<unknown>(`/api/journey-metrics/definitions/${encodeURIComponent(definitionId)}`);
  const row = exact(raw, 'definition detail', ['definition', 'versions']);
  return { definition: parseJourneyMetricDefinition(row.definition),
    versions: array(row.versions, 'definition versions').map(parseJourneyMetricVersion) };
}
export async function createJourneyMetricDefinition(input: { journeyDefinitionId: string; targetType: JourneyMetricTargetType;
  targetId: string; name: string; version: JourneyMetricVersionInput }) {
  const key = mutationKey('metric-definition'); const versionKey = mutationKey('metric-version');
  const raw = await api<unknown>('/api/journey-metrics/definitions', mutationOptions('POST', { ...input,
    versionIdempotencyKey: versionKey }, key));
  const result = parseReplayEnvelope(raw, 'definition');
  return { definition: parseJourneyMetricDefinition(result.value), replayed: result.replayed };
}
export async function createJourneyMetricDefinitionVersion(definitionId: string, input: { expectedRevision: number;
  version: JourneyMetricVersionInput }) {
  const key = mutationKey('metric-version');
  const raw = await api<unknown>(`/api/journey-metrics/definitions/${encodeURIComponent(definitionId)}/versions`,
    mutationOptions('POST', input, key));
  const result = parseReplayEnvelope(raw, 'version'); return { version: parseJourneyMetricVersion(result.value), replayed: result.replayed };
}

export async function listJourneyMetricRebuilds(scope: { journeyDefinitionId?: string; definitionId?: string }) {
  const raw = await api<unknown>(listQuery('/api/journey-metrics/rebuilds', { ...scope, limit: 100 }));
  return array(parseEnvelope(raw, 'rebuilds'), 'rebuilds').map(parseJourneyMetricRebuild)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
export async function queueJourneyMetricRebuild(definitionId: string) {
  const key = mutationKey('metric-rebuild'); const raw = await api<unknown>('/api/journey-metrics/rebuilds',
    mutationOptions('POST', { definitionId, reason: 'manual', asOf: new Date().toISOString() }, key));
  const result = parseReplayEnvelope(raw, 'run'); return { run: parseJourneyMetricRebuild(result.value), replayed: result.replayed };
}

export type JourneyMetricComparison = {
  targetTypes?: JourneyMetricTargetType[]; personaIds?: string[]; segmentIds?: string[]; channelIds?: string[];
};

function comparisonQuery(comparison?: JourneyMetricComparison) {
  return {
    targetTypes: comparison?.targetTypes?.length ? comparison.targetTypes.join(',') : undefined,
    personaIds: comparison?.personaIds?.length ? comparison.personaIds.join(',') : undefined,
    segmentIds: comparison?.segmentIds?.length ? comparison.segmentIds.join(',') : undefined,
    channelIds: comparison?.channelIds?.length ? comparison.channelIds.join(',') : undefined
  };
}

export async function listJourneyMetricObservations(scope: { journeyDefinitionId?: string; definitionId?: string },
  range?: { from?: string; to?: string }, comparison?: JourneyMetricComparison) {
  const raw = await api<unknown>(listQuery('/api/journey-metrics/observations', {
    ...scope, from: range?.from, to: range?.to, ...comparisonQuery(comparison), limit: 100
  }));
  const row = exact(raw, 'observation list', ['observations', 'appliedFilters']);
  return {
    observations: array(row.observations, 'observations').map((item) => parseJourneyMetricObservation(item))
      .sort((a, b) => Date.parse(b.period.end) - Date.parse(a.period.end) || b.revision - a.revision),
    // Always the server's echo, never the local draft, so the UI cannot claim a
    // filter that the backend did not actually apply.
    appliedFilters: parseJourneyMetricAppliedFilters(row.appliedFilters)
  };
}

export const journeyMetricAnalyticsExportFormats = ['csv', 'json'] as const;
export type JourneyMetricAnalyticsExportFormat = typeof journeyMetricAnalyticsExportFormats[number];

/** Downloads exactly the current filter/window scope. The server re-applies the
 * filters and the suppression, so the file can never contain more than the
 * screen it was taken from. */
export async function downloadJourneyMetricAnalyticsExport(input: {
  journeyDefinitionId: string; format: JourneyMetricAnalyticsExportFormat;
  range?: { from?: string; to?: string }; comparison?: JourneyMetricComparison;
}) {
  const path = listQuery(`/api/journey-metrics/analytics-export.${input.format}`, {
    journeyDefinitionId: input.journeyDefinitionId, from: input.range?.from, to: input.range?.to,
    ...comparisonQuery(input.comparison), limit: 100
  });
  const response = await fetch(path, { credentials: 'include',
    headers: { 'Idempotency-Key': mutationKey('metric-analytics-export') } });
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(detail?.error || 'The analytics export failed.');
  }
  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition') || '';
  const match = /filename="([^"]+)"/u.exec(disposition);
  return { blob, filename: match?.[1] || `journey-metric-analytics.${input.format}`,
    usageReplayed: response.headers.get('X-Seemplify-Usage-Replayed') === 'true' };
}
export async function readJourneyMetricObservationLineage(observationId: string) {
  const raw = await api<unknown>(`/api/journey-metrics/observations/${encodeURIComponent(observationId)}/lineage`);
  return parseJourneyMetricObservation(parseEnvelope(raw, 'observation'), true);
}

export interface JourneyMetricNativeSourceChoice { id: string; name: string; adapter: JourneyNativeMetricAdapter }
export interface JourneyMetricNativeSourceCatalog {
  tickets: JourneyMetricNativeSourceChoice[]; social: JourneyMetricNativeSourceChoice[];
  ticketsEntitled: boolean; socialEntitled: boolean;
}

/** Exactly the same-space sources the server currently authorises. The picker
 * never offers a free-text identity, so a configuration cannot be assembled
 * from something this space does not hold. */
export async function listJourneyMetricNativeSources(): Promise<JourneyMetricNativeSourceCatalog> {
  const raw = await api<unknown>('/api/journey-metrics/native-sources');
  const row = exact(raw, 'native sources', ['tickets', 'social', 'ticketsEntitled', 'socialEntitled']);
  const choices = (value: unknown, label: string) => array(value, label).map((entry) => {
    const choice = exact(entry, label, ['id', 'name', 'adapter']);
    return { id: nonempty(choice.id, `${label}.id`), name: nonempty(choice.name, `${label}.name`),
      adapter: enumValue(choice.adapter, `${label}.adapter`, journeyNativeMetricAdapters) };
  });
  return { tickets: choices(row.tickets, 'native sources.tickets'),
    social: choices(row.social, 'native sources.social'),
    ticketsEntitled: bool(row.ticketsEntitled, 'native sources.ticketsEntitled'),
    socialEntitled: bool(row.socialEntitled, 'native sources.socialEntitled') };
}

export const journeyNativeTicketMeasureKinds = ['ticket_rate', 'repeat_contact_rate', 'recovery_rate'] as const;
export const journeyNativeSocialMeasureKinds = ['sentiment_distribution', 'sentiment_trend'] as const;
export type JourneyNativeMeasureKind =
  typeof journeyNativeTicketMeasureKinds[number] | typeof journeyNativeSocialMeasureKinds[number];

/** Builds the minimal native version body. The subject type, adapter event
 * vocabulary and source lineage are deliberately *not* sent: the server derives
 * them from the pinned adapter contract and refuses any conflicting value, so
 * this client cannot assert a source scope or an event mapping. */
export function nativeMetricVersion(input: { name: string; adapter: JourneyNativeMetricAdapter;
  sourceIds: string[]; kind: JourneyNativeMeasureKind; stageId?: string | null; windowDays: number;
  freshnessHours: number; minimumSampleSize: number; baselineValue: number | null; targetValue: number | null;
  repeatThreshold?: number; timezone?: string }): JourneyMetricVersionInput {
  return {
    sourceKind: 'operational_import', bindingId: null, calculatorKind: 'operational',
    aggregation: input.kind,
    // Only recovery is an improvement when it rises. A sentiment observation
    // stores the *negative* share as its scalar, because SENTIMENTS is ordered
    // negative-first, so pinning it lower-is-better keeps a deterioration alert
    // from firing when negativity actually falls.
    direction: input.kind === 'recovery_rate' ? 'higher_is_better' : 'lower_is_better',
    windowSeconds: input.windowDays * 86_400, timezone: input.timezone || 'UTC',
    minimumSampleSize: input.minimumSampleSize, freshnessMaxAgeSeconds: input.freshnessHours * 3_600,
    baselineValue: input.baselineValue, targetValue: input.targetValue, population: {}, filters: {},
    formula: { kind: input.kind },
    configuration: {
      kind: input.kind, label: input.name, decimalPlaces: 1,
      ...(input.kind === 'repeat_contact_rate' ? { repeatThreshold: input.repeatThreshold ?? 2 } : {}),
      nativeSource: {
        configVersion: 'journey-native-metric-source/v1', adapter: input.adapter, adapterVersion: '1',
        sourceIds: [...input.sourceIds].sort(),
        stageAssociation: input.stageId ? { stageId: input.stageId, via: 'research_link' } : null
      }
    }
  };
}

export function surveyMetricVersion(input: { name: string; bindingId: string; calculatorKind: 'nps' | 'csat' | 'ces';
  windowDays: number; freshnessHours: number; minimumSampleSize: number; baselineValue: number | null;
  targetValue: number | null; timezone?: string }): JourneyMetricVersionInput {
  const common = { sourceKind: 'survey' as const, bindingId: input.bindingId, calculatorKind: input.calculatorKind,
    direction: 'higher_is_better' as const, windowSeconds: input.windowDays * 86_400, timezone: input.timezone || 'UTC',
    minimumSampleSize: input.minimumSampleSize, freshnessMaxAgeSeconds: input.freshnessHours * 3_600,
    baselineValue: input.baselineValue, targetValue: input.targetValue, population: { status: 'completed' }, filters: {} };
  if (input.calculatorKind === 'nps') return { ...common, aggregation: 'net_promoter_score',
    formula: { kind: 'net_promoter_score' }, configuration: { label: input.name,
      scale: { minimum: 0, maximum: 10, step: 1 }, decimalPlaces: 1,
      formula: { kind: 'net_promoter_score', detractorMaximum: 6, promoterMinimum: 9 } } };
  const maximum = input.calculatorKind === 'csat' ? 5 : 7;
  const threshold = input.calculatorKind === 'csat' ? 4 : 5;
  return { ...common, aggregation: 'mean', formula: { kind: 'mean' }, configuration: { label: input.name,
    scale: { minimum: 1, maximum, step: 1 }, decimalPlaces: 1, formula: { kind: 'mean' },
    favourable: { operator: 'gte', threshold } } };
}
