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

export interface JourneyActualPathMeasure {
  numerator: number | null; denominator: number | null; sampleSize: number | null; percentage: number | null; suppressed: boolean;
}
export interface JourneyActualPathSignatureRow {
  signature: string; stageIds: string[]; visitCount: number; distinctStageCount: number; measure: JourneyActualPathMeasure;
}
export interface JourneyActualPathTransitionRow {
  fromStageId: string; toStageId: string; classification: 'expected' | 'skipped_forward' | 'backward_loop' | 'repeated_stage' | 'unexpected_unknown_stage';
  missingStageIds: string[]; occurrenceCount: number; measure: JourneyActualPathMeasure;
}
export interface JourneyActualPathLoopRow {
  fromStageId: string; toStageId: string; kind: 'backward_loop' | 'repeated_stage'; occurrenceCount: number; measure: JourneyActualPathMeasure;
}
export interface JourneyActualPathFunnelRow {
  stageId: string; stageIndex: number; entrantMeasure: JourneyActualPathMeasure; completionMeasure: JourneyActualPathMeasure;
  dropOffBeforeNextMeasure: JourneyActualPathMeasure;
}
export interface JourneyActualPathResult {
  analytics: {
    analyticsVersion: string;
    lineage: {
      journeyId: string; journeyVersion: string; ruleSetVersion: string; projectionVersion: string;
      period: { start: string; end: string; timezone: string };
      asOf: string; cohortId: string | null; designedStageOrder: string[];
    };
    sample: {
      inputRecordCount: number | null; acceptedVisitCount: number | null; acceptedInstanceCount: number | null;
      distinctProfileCount: number | null; distinctAccountCount: number | null; suppressed: boolean;
    };
    dataQuality: Array<{ reason: string; count: number | null; suppressed: boolean }>;
    tables: {
      pathSignatures: { rows: JourneyActualPathSignatureRow[]; suppression: { applied: boolean; minimumCohortSize: number; reason: string | null } };
      transitionMatrix: { rows: JourneyActualPathTransitionRow[]; suppression: { applied: boolean; minimumCohortSize: number; reason: string | null } };
      funnel: { rows: JourneyActualPathFunnelRow[]; suppression: { applied: boolean; minimumCohortSize: number; reason: string | null } };
      loops: { rows: JourneyActualPathLoopRow[]; suppression: { applied: boolean; minimumCohortSize: number; reason: string | null } };
      skippedTransitions: { rows: JourneyActualPathTransitionRow[]; suppression: { applied: boolean; minimumCohortSize: number; reason: string | null } };
      unexpectedTransitions: { rows: JourneyActualPathTransitionRow[]; suppression: { applied: boolean; minimumCohortSize: number; reason: string | null } };
    };
    interpretation: { mode: 'descriptive_only'; statement: string };
  };
  designedVsObserved: {
    stageRows: Array<{
      stageId: string; stageName: string; designedIndex: number;
      entrantPercentage: number | null; completionPercentage: number | null; dropOffBeforeNextPercentage: number | null;
      skippedInboundTransitions: number | null; loopTransitions: number | null; status: 'unobserved' | 'at_risk' | 'aligned';
    }>;
    summary: {
      unobservedStageCount: number; atRiskStageCount: number;
      skippedForwardTransitionCount: number | null; loopTransitionCount: number | null;
    };
  };
  scope: {
    subjectKind: 'anonymous_only' | 'known_profiles';
    identityModel: 'anonymous_instance_scoped' | 'known_profile_stitched';
    designVersionSource: 'published' | 'current';
    designVersionId: string;
    stitchedSubjectSummary?: {
      stitchedKnownProfileCount: number;
      stitchedAccountCount: number;
      anonymousInstanceCount: number;
    };
    notes: string[];
  };
}

export type JourneyActualPathSubjectKind = 'anonymous_only' | 'known_profiles';

export interface JourneyActualPathSnapshot {
  id: string;
  journeyDefinitionId: string;
  journeyMapVersionId: string;
  createdByUserId: string | null;
  createdAt: string;
  period: { start: string; end: string };
  asOf: string;
  minimumCohortSize: number;
  analyticsVersion: string;
  scopeSubject: JourneyActualPathSubjectKind;
  summary: {
    acceptedInstanceCount: number | null;
    acceptedVisitCount: number | null;
    unobservedStageCount: number;
    atRiskStageCount: number;
  };
  freshness: {
    status: 'current' | 'stale';
    latestObservedEventAt: string | null;
    latestReprojectionCompletedAt: string | null;
    staleReasons: Array<'newer_observed_visit' | 'newer_completed_reprojection'>;
  };
  reconciliation: {
    currentJourneyMapVersionId: string;
    currentAsOf: string;
    designVersionChanged: boolean;
    deltas: {
      acceptedInstanceCount: number | null;
      acceptedVisitCount: number | null;
      unobservedStageCount: number;
      atRiskStageCount: number;
    };
  };
  result: JourneyActualPathResult;
}

export interface JourneyActualPathRollup {
  id: string;
  journeyDefinitionId: string;
  journeyMapVersionId: string;
  materializedByUserId: string | null;
  materializedAt: string;
  period: { start: string; end: string };
  lastAsOf: string;
  minimumCohortSize: number;
  analyticsVersion: string;
  scopeSubject: JourneyActualPathSubjectKind;
  summary: JourneyActualPathSnapshot['summary'];
  freshness: JourneyActualPathSnapshot['freshness'];
  result: JourneyActualPathResult;
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

function parseMeasure(value: unknown, label: string): JourneyActualPathMeasure {
  const row = exact(value, label, ['numerator', 'denominator', 'sampleSize', 'percentage', 'suppressed']);
  return {
    numerator: nullableFinite(row.numerator, `${label}.numerator`),
    denominator: nullableFinite(row.denominator, `${label}.denominator`),
    sampleSize: nullableFinite(row.sampleSize, `${label}.sampleSize`),
    percentage: nullableFinite(row.percentage, `${label}.percentage`),
    suppressed: bool(row.suppressed, `${label}.suppressed`)
  };
}

function parseActualPathResult(value: unknown): JourneyActualPathResult {
  const row = exact(value, 'actual path analytics response', ['analytics', 'designedVsObserved', 'scope']);
  const analytics = exact(row.analytics, 'actualPath.analytics', ['analyticsVersion', 'lineage', 'sample', 'dataQuality', 'tables', 'interpretation']);
  const lineage = exact(analytics.lineage, 'actualPath.analytics.lineage', [
    'journeyId', 'journeyVersion', 'ruleSetVersion', 'projectionVersion', 'period', 'asOf', 'cohortId', 'designedStageOrder'
  ]);
  const period = exact(lineage.period, 'actualPath.analytics.lineage.period', ['start', 'end', 'timezone']);
  const sample = exact(analytics.sample, 'actualPath.analytics.sample', [
    'inputRecordCount', 'acceptedVisitCount', 'acceptedInstanceCount', 'distinctProfileCount', 'distinctAccountCount', 'suppressed'
  ]);
  const tables = exact(analytics.tables, 'actualPath.analytics.tables', [
    'pathSignatures', 'transitionMatrix', 'funnel', 'loops', 'repeats', 'skippedTransitions', 'unexpectedTransitions', 'entryExit', 'stageDurations'
  ]);
  const parseSuppression = (value: unknown, label: string) => {
    const row = exact(value, label, ['applied', 'minimumCohortSize', 'reason']);
    return { applied: bool(row.applied, `${label}.applied`), minimumCohortSize: integer(row.minimumCohortSize, `${label}.minimumCohortSize`, 1), reason: row.reason === null ? null : text(row.reason, `${label}.reason`) };
  };
  const parseTable = <T>(value: unknown, label: string, parser: (entry: unknown, index: number) => T) => {
    const row = exact(value, label, ['rows', 'suppression']);
    return {
      rows: array(row.rows, `${label}.rows`).map(parser),
      suppression: parseSuppression(row.suppression, `${label}.suppression`)
    };
  };
  const parseTransition = (value: unknown, label: string): JourneyActualPathTransitionRow => {
    const row = exact(value, label, ['fromStageId', 'toStageId', 'classification', 'missingStageIds', 'occurrenceCount', 'measure']);
    return {
      fromStageId: nonempty(row.fromStageId, `${label}.fromStageId`),
      toStageId: nonempty(row.toStageId, `${label}.toStageId`),
      classification: enumValue(row.classification, `${label}.classification`, ['expected', 'skipped_forward', 'backward_loop', 'repeated_stage', 'unexpected_unknown_stage'] as const),
      missingStageIds: array(row.missingStageIds, `${label}.missingStageIds`).map((entry) => nonempty(entry, `${label}.missingStageIds[]`)),
      occurrenceCount: integer(row.occurrenceCount, `${label}.occurrenceCount`, 0),
      measure: parseMeasure(row.measure, `${label}.measure`)
    };
  };
  const scope = exact(row.scope, 'actualPath.scope', ['subjectKind', 'identityModel', 'designVersionSource', 'designVersionId', 'notes']);
  const designedVsObserved = exact(row.designedVsObserved, 'actualPath.designedVsObserved', ['stageRows', 'summary']);
  const designedSummary = exact(designedVsObserved.summary, 'actualPath.designedVsObserved.summary', [
    'unobservedStageCount', 'atRiskStageCount', 'skippedForwardTransitionCount', 'loopTransitionCount'
  ]);
  return {
    analytics: {
      analyticsVersion: nonempty(analytics.analyticsVersion, 'actualPath.analytics.analyticsVersion'),
      lineage: {
        journeyId: nonempty(lineage.journeyId, 'actualPath.analytics.lineage.journeyId'),
        journeyVersion: nonempty(lineage.journeyVersion, 'actualPath.analytics.lineage.journeyVersion'),
        ruleSetVersion: nonempty(lineage.ruleSetVersion, 'actualPath.analytics.lineage.ruleSetVersion'),
        projectionVersion: nonempty(lineage.projectionVersion, 'actualPath.analytics.lineage.projectionVersion'),
        period: { start: iso(period.start, 'actualPath.analytics.lineage.period.start'),
          end: iso(period.end, 'actualPath.analytics.lineage.period.end'),
          timezone: nonempty(period.timezone, 'actualPath.analytics.lineage.period.timezone') },
        asOf: iso(lineage.asOf, 'actualPath.analytics.lineage.asOf'),
        cohortId: nullableText(lineage.cohortId, 'actualPath.analytics.lineage.cohortId'),
        designedStageOrder: array(lineage.designedStageOrder, 'actualPath.analytics.lineage.designedStageOrder')
          .map((entry) => nonempty(entry, 'actualPath.analytics.lineage.designedStageOrder[]'))
      },
      sample: {
        inputRecordCount: nullableFinite(sample.inputRecordCount, 'actualPath.analytics.sample.inputRecordCount'),
        acceptedVisitCount: nullableFinite(sample.acceptedVisitCount, 'actualPath.analytics.sample.acceptedVisitCount'),
        acceptedInstanceCount: nullableFinite(sample.acceptedInstanceCount, 'actualPath.analytics.sample.acceptedInstanceCount'),
        distinctProfileCount: nullableFinite(sample.distinctProfileCount, 'actualPath.analytics.sample.distinctProfileCount'),
        distinctAccountCount: nullableFinite(sample.distinctAccountCount, 'actualPath.analytics.sample.distinctAccountCount'),
        suppressed: bool(sample.suppressed, 'actualPath.analytics.sample.suppressed')
      },
      dataQuality: array(analytics.dataQuality, 'actualPath.analytics.dataQuality').map((entry, index) => {
        const row = exact(entry, `actualPath.analytics.dataQuality[${index}]`, ['reason', 'count', 'suppressed']);
        return { reason: nonempty(row.reason, `actualPath.analytics.dataQuality[${index}].reason`),
          count: nullableFinite(row.count, `actualPath.analytics.dataQuality[${index}].count`),
          suppressed: bool(row.suppressed, `actualPath.analytics.dataQuality[${index}].suppressed`) };
      }),
      tables: {
        pathSignatures: parseTable(tables.pathSignatures, 'actualPath.analytics.tables.pathSignatures', (entry, index) => {
          const row = exact(entry, `actualPath.analytics.tables.pathSignatures.rows[${index}]`, ['signature', 'stageIds', 'visitCount', 'distinctStageCount', 'measure']);
          return { signature: nonempty(row.signature, `actualPath.analytics.tables.pathSignatures.rows[${index}].signature`),
            stageIds: array(row.stageIds, `actualPath.analytics.tables.pathSignatures.rows[${index}].stageIds`)
              .map((item) => nonempty(item, `actualPath.analytics.tables.pathSignatures.rows[${index}].stageIds[]`)),
            visitCount: integer(row.visitCount, `actualPath.analytics.tables.pathSignatures.rows[${index}].visitCount`, 0),
            distinctStageCount: integer(row.distinctStageCount, `actualPath.analytics.tables.pathSignatures.rows[${index}].distinctStageCount`, 0),
            measure: parseMeasure(row.measure, `actualPath.analytics.tables.pathSignatures.rows[${index}].measure`) };
        }),
        transitionMatrix: parseTable(tables.transitionMatrix, 'actualPath.analytics.tables.transitionMatrix', (entry, index) =>
          parseTransition(entry, `actualPath.analytics.tables.transitionMatrix.rows[${index}]`)),
        funnel: parseTable(tables.funnel, 'actualPath.analytics.tables.funnel', (entry, index) => {
          const row = exact(entry, `actualPath.analytics.tables.funnel.rows[${index}]`, ['stageId', 'stageIndex', 'entrantMeasure', 'completionMeasure', 'dropOffBeforeNextMeasure']);
          return {
            stageId: nonempty(row.stageId, `actualPath.analytics.tables.funnel.rows[${index}].stageId`),
            stageIndex: integer(row.stageIndex, `actualPath.analytics.tables.funnel.rows[${index}].stageIndex`, 0),
            entrantMeasure: parseMeasure(row.entrantMeasure, `actualPath.analytics.tables.funnel.rows[${index}].entrantMeasure`),
            completionMeasure: parseMeasure(row.completionMeasure, `actualPath.analytics.tables.funnel.rows[${index}].completionMeasure`),
            dropOffBeforeNextMeasure: parseMeasure(row.dropOffBeforeNextMeasure, `actualPath.analytics.tables.funnel.rows[${index}].dropOffBeforeNextMeasure`)
          };
        }),
        loops: parseTable(tables.loops, 'actualPath.analytics.tables.loops', (entry, index) => {
          const row = exact(entry, `actualPath.analytics.tables.loops.rows[${index}]`, ['fromStageId', 'toStageId', 'kind', 'occurrenceCount', 'measure']);
          return {
            fromStageId: nonempty(row.fromStageId, `actualPath.analytics.tables.loops.rows[${index}].fromStageId`),
            toStageId: nonempty(row.toStageId, `actualPath.analytics.tables.loops.rows[${index}].toStageId`),
            kind: enumValue(row.kind, `actualPath.analytics.tables.loops.rows[${index}].kind`, ['backward_loop', 'repeated_stage'] as const),
            occurrenceCount: integer(row.occurrenceCount, `actualPath.analytics.tables.loops.rows[${index}].occurrenceCount`, 0),
            measure: parseMeasure(row.measure, `actualPath.analytics.tables.loops.rows[${index}].measure`)
          };
        }),
        skippedTransitions: parseTable(tables.skippedTransitions, 'actualPath.analytics.tables.skippedTransitions', (entry, index) =>
          parseTransition(entry, `actualPath.analytics.tables.skippedTransitions.rows[${index}]`)),
        unexpectedTransitions: parseTable(tables.unexpectedTransitions, 'actualPath.analytics.tables.unexpectedTransitions', (entry, index) =>
          parseTransition(entry, `actualPath.analytics.tables.unexpectedTransitions.rows[${index}]`))
      },
      interpretation: exact(analytics.interpretation, 'actualPath.analytics.interpretation', ['mode', 'statement']) as { mode: 'descriptive_only'; statement: string }
    },
    designedVsObserved: {
      stageRows: array(designedVsObserved.stageRows, 'actualPath.designedVsObserved.stageRows').map((entry, index) => {
        const row = exact(entry, `actualPath.designedVsObserved.stageRows[${index}]`, [
          'stageId', 'stageName', 'designedIndex', 'entrantPercentage', 'completionPercentage',
          'dropOffBeforeNextPercentage', 'skippedInboundTransitions', 'loopTransitions', 'status'
        ]);
        return {
          stageId: nonempty(row.stageId, `actualPath.designedVsObserved.stageRows[${index}].stageId`),
          stageName: nonempty(row.stageName, `actualPath.designedVsObserved.stageRows[${index}].stageName`),
          designedIndex: integer(row.designedIndex, `actualPath.designedVsObserved.stageRows[${index}].designedIndex`, 0),
          entrantPercentage: nullableFinite(row.entrantPercentage, `actualPath.designedVsObserved.stageRows[${index}].entrantPercentage`),
          completionPercentage: nullableFinite(row.completionPercentage, `actualPath.designedVsObserved.stageRows[${index}].completionPercentage`),
          dropOffBeforeNextPercentage: nullableFinite(row.dropOffBeforeNextPercentage, `actualPath.designedVsObserved.stageRows[${index}].dropOffBeforeNextPercentage`),
          skippedInboundTransitions: nullableFinite(row.skippedInboundTransitions, `actualPath.designedVsObserved.stageRows[${index}].skippedInboundTransitions`),
          loopTransitions: nullableFinite(row.loopTransitions, `actualPath.designedVsObserved.stageRows[${index}].loopTransitions`),
          status: enumValue(row.status, `actualPath.designedVsObserved.stageRows[${index}].status`, ['unobserved', 'at_risk', 'aligned'] as const)
        };
      }),
      summary: {
        unobservedStageCount: integer(designedSummary.unobservedStageCount, 'actualPath.designedVsObserved.summary.unobservedStageCount', 0),
        atRiskStageCount: integer(designedSummary.atRiskStageCount, 'actualPath.designedVsObserved.summary.atRiskStageCount', 0),
        skippedForwardTransitionCount: nullableFinite(designedSummary.skippedForwardTransitionCount, 'actualPath.designedVsObserved.summary.skippedForwardTransitionCount'),
        loopTransitionCount: nullableFinite(designedSummary.loopTransitionCount, 'actualPath.designedVsObserved.summary.loopTransitionCount')
      }
    },
    scope: {
      subjectKind: enumValue(scope.subjectKind, 'actualPath.scope.subjectKind', ['anonymous_only', 'known_profiles'] as const),
      identityModel: enumValue(scope.identityModel, 'actualPath.scope.identityModel', ['anonymous_instance_scoped', 'known_profile_stitched'] as const),
      designVersionSource: enumValue(scope.designVersionSource, 'actualPath.scope.designVersionSource', ['published', 'current'] as const),
      designVersionId: nonempty(scope.designVersionId, 'actualPath.scope.designVersionId'),
      ...(scope.stitchedSubjectSummary === undefined ? {} : {
        stitchedSubjectSummary: (() => {
          const row = exact(scope.stitchedSubjectSummary, 'actualPath.scope.stitchedSubjectSummary', [
            'stitchedKnownProfileCount', 'stitchedAccountCount', 'anonymousInstanceCount'
          ]);
          return {
            stitchedKnownProfileCount: integer(row.stitchedKnownProfileCount, 'actualPath.scope.stitchedSubjectSummary.stitchedKnownProfileCount', 0),
            stitchedAccountCount: integer(row.stitchedAccountCount, 'actualPath.scope.stitchedSubjectSummary.stitchedAccountCount', 0),
            anonymousInstanceCount: integer(row.anonymousInstanceCount, 'actualPath.scope.stitchedSubjectSummary.anonymousInstanceCount', 0)
          };
        })()
      }),
      notes: array(scope.notes, 'actualPath.scope.notes').map((entry) => nonempty(entry, 'actualPath.scope.notes[]'))
    }
  };
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

export async function readJourneyActualPaths(journeyDefinitionId: string, range?: { from?: string; to?: string },
  subjectKind: JourneyActualPathSubjectKind = 'anonymous_only') {
  const raw = await api<unknown>(listQuery('/api/journey-metrics/actual-paths', {
    journeyDefinitionId, from: range?.from, to: range?.to, subjectKind, minimumCohortSize: 5
  }));
  return parseActualPathResult(raw);
}

function parseActualPathSnapshot(value: unknown): JourneyActualPathSnapshot {
  const row = exact(value, 'actual path snapshot', [
    'id', 'journeyDefinitionId', 'journeyMapVersionId', 'createdByUserId', 'createdAt', 'period',
    'asOf', 'minimumCohortSize', 'analyticsVersion', 'scopeSubject', 'summary', 'freshness', 'reconciliation', 'result'
  ]);
  const period = exact(row.period, 'actualPathSnapshot.period', ['start', 'end']);
  const summary = exact(row.summary, 'actualPathSnapshot.summary', [
    'acceptedInstanceCount', 'acceptedVisitCount', 'unobservedStageCount', 'atRiskStageCount'
  ]);
  const freshness = exact(row.freshness, 'actualPathSnapshot.freshness', [
    'status', 'latestObservedEventAt', 'latestReprojectionCompletedAt', 'staleReasons'
  ]);
  const reconciliation = exact(row.reconciliation, 'actualPathSnapshot.reconciliation', [
    'currentJourneyMapVersionId', 'currentAsOf', 'designVersionChanged', 'deltas'
  ]);
  const deltas = exact(reconciliation.deltas, 'actualPathSnapshot.reconciliation.deltas', [
    'acceptedInstanceCount', 'acceptedVisitCount', 'unobservedStageCount', 'atRiskStageCount'
  ]);
  return {
    id: nonempty(row.id, 'actualPathSnapshot.id'),
    journeyDefinitionId: nonempty(row.journeyDefinitionId, 'actualPathSnapshot.journeyDefinitionId'),
    journeyMapVersionId: nonempty(row.journeyMapVersionId, 'actualPathSnapshot.journeyMapVersionId'),
    createdByUserId: nullableId(row.createdByUserId, 'actualPathSnapshot.createdByUserId'),
    createdAt: iso(row.createdAt, 'actualPathSnapshot.createdAt'),
    period: { start: iso(period.start, 'actualPathSnapshot.period.start'), end: iso(period.end, 'actualPathSnapshot.period.end') },
    asOf: iso(row.asOf, 'actualPathSnapshot.asOf'),
    minimumCohortSize: integer(row.minimumCohortSize, 'actualPathSnapshot.minimumCohortSize', 1),
    analyticsVersion: nonempty(row.analyticsVersion, 'actualPathSnapshot.analyticsVersion'),
    scopeSubject: enumValue(row.scopeSubject, 'actualPathSnapshot.scopeSubject', ['anonymous_only', 'known_profiles'] as const),
    summary: {
      acceptedInstanceCount: nullableFinite(summary.acceptedInstanceCount, 'actualPathSnapshot.summary.acceptedInstanceCount'),
      acceptedVisitCount: nullableFinite(summary.acceptedVisitCount, 'actualPathSnapshot.summary.acceptedVisitCount'),
      unobservedStageCount: integer(summary.unobservedStageCount, 'actualPathSnapshot.summary.unobservedStageCount', 0),
      atRiskStageCount: integer(summary.atRiskStageCount, 'actualPathSnapshot.summary.atRiskStageCount', 0)
    },
    freshness: {
      status: enumValue(freshness.status, 'actualPathSnapshot.freshness.status', ['current', 'stale'] as const),
      latestObservedEventAt: nullableIso(freshness.latestObservedEventAt, 'actualPathSnapshot.freshness.latestObservedEventAt'),
      latestReprojectionCompletedAt: nullableIso(freshness.latestReprojectionCompletedAt, 'actualPathSnapshot.freshness.latestReprojectionCompletedAt'),
      staleReasons: array(freshness.staleReasons, 'actualPathSnapshot.freshness.staleReasons')
        .map((entry) => enumValue(entry, 'actualPathSnapshot.freshness.staleReasons[]', ['newer_observed_visit', 'newer_completed_reprojection'] as const))
    },
    reconciliation: {
      currentJourneyMapVersionId: nonempty(reconciliation.currentJourneyMapVersionId, 'actualPathSnapshot.reconciliation.currentJourneyMapVersionId'),
      currentAsOf: iso(reconciliation.currentAsOf, 'actualPathSnapshot.reconciliation.currentAsOf'),
      designVersionChanged: bool(reconciliation.designVersionChanged, 'actualPathSnapshot.reconciliation.designVersionChanged'),
      deltas: {
        acceptedInstanceCount: nullableFinite(deltas.acceptedInstanceCount, 'actualPathSnapshot.reconciliation.deltas.acceptedInstanceCount'),
        acceptedVisitCount: nullableFinite(deltas.acceptedVisitCount, 'actualPathSnapshot.reconciliation.deltas.acceptedVisitCount'),
        unobservedStageCount: integer(deltas.unobservedStageCount, 'actualPathSnapshot.reconciliation.deltas.unobservedStageCount'),
        atRiskStageCount: integer(deltas.atRiskStageCount, 'actualPathSnapshot.reconciliation.deltas.atRiskStageCount')
      }
    },
    result: parseActualPathResult(row.result)
  };
}

function parseActualPathRollup(value: unknown): JourneyActualPathRollup {
  const row = exact(value, 'actual path rollup', [
    'id', 'journeyDefinitionId', 'journeyMapVersionId', 'materializedByUserId', 'materializedAt', 'period',
    'lastAsOf', 'minimumCohortSize', 'analyticsVersion', 'scopeSubject', 'summary', 'freshness', 'result'
  ]);
  const period = exact(row.period, 'actualPathRollup.period', ['start', 'end']);
  const summary = exact(row.summary, 'actualPathRollup.summary', [
    'acceptedInstanceCount', 'acceptedVisitCount', 'unobservedStageCount', 'atRiskStageCount'
  ]);
  const freshness = exact(row.freshness, 'actualPathRollup.freshness', [
    'status', 'latestObservedEventAt', 'latestReprojectionCompletedAt', 'staleReasons'
  ]);
  return {
    id: nonempty(row.id, 'actualPathRollup.id'),
    journeyDefinitionId: nonempty(row.journeyDefinitionId, 'actualPathRollup.journeyDefinitionId'),
    journeyMapVersionId: nonempty(row.journeyMapVersionId, 'actualPathRollup.journeyMapVersionId'),
    materializedByUserId: nullableId(row.materializedByUserId, 'actualPathRollup.materializedByUserId'),
    materializedAt: iso(row.materializedAt, 'actualPathRollup.materializedAt'),
    period: { start: iso(period.start, 'actualPathRollup.period.start'), end: iso(period.end, 'actualPathRollup.period.end') },
    lastAsOf: iso(row.lastAsOf, 'actualPathRollup.lastAsOf'),
    minimumCohortSize: integer(row.minimumCohortSize, 'actualPathRollup.minimumCohortSize', 1),
    analyticsVersion: nonempty(row.analyticsVersion, 'actualPathRollup.analyticsVersion'),
    scopeSubject: enumValue(row.scopeSubject, 'actualPathRollup.scopeSubject', ['anonymous_only', 'known_profiles'] as const),
    summary: {
      acceptedInstanceCount: nullableFinite(summary.acceptedInstanceCount, 'actualPathRollup.summary.acceptedInstanceCount'),
      acceptedVisitCount: nullableFinite(summary.acceptedVisitCount, 'actualPathRollup.summary.acceptedVisitCount'),
      unobservedStageCount: integer(summary.unobservedStageCount, 'actualPathRollup.summary.unobservedStageCount', 0),
      atRiskStageCount: integer(summary.atRiskStageCount, 'actualPathRollup.summary.atRiskStageCount', 0)
    },
    freshness: {
      status: enumValue(freshness.status, 'actualPathRollup.freshness.status', ['current', 'stale'] as const),
      latestObservedEventAt: nullableIso(freshness.latestObservedEventAt, 'actualPathRollup.freshness.latestObservedEventAt'),
      latestReprojectionCompletedAt: nullableIso(freshness.latestReprojectionCompletedAt, 'actualPathRollup.freshness.latestReprojectionCompletedAt'),
      staleReasons: array(freshness.staleReasons, 'actualPathRollup.freshness.staleReasons')
        .map((entry) => enumValue(entry, 'actualPathRollup.freshness.staleReasons[]', ['newer_observed_visit', 'newer_completed_reprojection'] as const))
    },
    result: parseActualPathResult(row.result)
  };
}

export async function readLatestJourneyActualPathSnapshot(journeyDefinitionId: string,
  subjectKind: JourneyActualPathSubjectKind = 'anonymous_only') {
  const raw = await api<unknown>(listQuery('/api/journey-metrics/actual-path-snapshots/latest', { journeyDefinitionId, subjectKind }));
  const row = exact(raw, 'actual path latest snapshot response', ['snapshot']);
  return row.snapshot === null ? null : parseActualPathSnapshot(row.snapshot);
}

export async function readLatestJourneyActualPathRollup(journeyDefinitionId: string,
  subjectKind: JourneyActualPathSubjectKind = 'anonymous_only') {
  const raw = await api<unknown>(listQuery('/api/journey-metrics/actual-path-rollups/latest', { journeyDefinitionId, subjectKind }));
  const row = exact(raw, 'actual path latest rollup response', ['rollup']);
  return row.rollup === null ? null : parseActualPathRollup(row.rollup);
}

export async function materializeJourneyActualPathRollup(input: {
  journeyDefinitionId: string;
  from?: string;
  to?: string;
  asOf?: string;
  minimumCohortSize?: number;
  subjectKind?: JourneyActualPathSubjectKind;
}) {
  const raw = await api<unknown>('/api/journey-metrics/actual-path-rollups/materialize', mutationOptions('POST', {
    journeyDefinitionId: input.journeyDefinitionId,
    ...(input.from ? { from: input.from } : {}),
    ...(input.to ? { to: input.to } : {}),
    ...(input.asOf ? { asOf: input.asOf } : {}),
    ...(input.minimumCohortSize ? { minimumCohortSize: input.minimumCohortSize } : {}),
    ...(input.subjectKind ? { subjectKind: input.subjectKind } : {})
  }, mutationKey('actual-path-rollup')));
  const row = exact(raw, 'actual path rollup materialize response', ['rollup', 'updated']);
  return { rollup: parseActualPathRollup(row.rollup), updated: bool(row.updated, 'actual path rollup materialize response.updated') };
}

export async function listJourneyActualPathSnapshots(journeyDefinitionId: string,
  subjectKind: JourneyActualPathSubjectKind = 'anonymous_only') {
  const raw = await api<unknown>(listQuery('/api/journey-metrics/actual-path-snapshots', { journeyDefinitionId, limit: 20, subjectKind }));
  const row = exact(raw, 'actual path snapshot list response', ['snapshots']);
  return array(row.snapshots, 'actual path snapshot list response.snapshots').map(parseActualPathSnapshot);
}

export async function readJourneyActualPathSnapshot(snapshotId: string, journeyDefinitionId: string,
  subjectKind: JourneyActualPathSubjectKind = 'anonymous_only') {
  const raw = await api<unknown>(listQuery(`/api/journey-metrics/actual-path-snapshots/${encodeURIComponent(snapshotId)}`, { journeyDefinitionId, subjectKind }));
  const row = exact(raw, 'actual path snapshot read response', ['snapshot']);
  return parseActualPathSnapshot(row.snapshot);
}

export async function createJourneyActualPathSnapshot(input: {
  journeyDefinitionId: string;
  from?: string;
  to?: string;
  asOf?: string;
  minimumCohortSize?: number;
  subjectKind?: JourneyActualPathSubjectKind;
}) {
  const raw = await api<unknown>('/api/journey-metrics/actual-path-snapshots', mutationOptions('POST', {
    journeyDefinitionId: input.journeyDefinitionId,
    ...(input.from ? { from: input.from } : {}),
    ...(input.to ? { to: input.to } : {}),
    ...(input.asOf ? { asOf: input.asOf } : {}),
    ...(input.minimumCohortSize ? { minimumCohortSize: input.minimumCohortSize } : {}),
    ...(input.subjectKind ? { subjectKind: input.subjectKind } : {})
  }, mutationKey('actual-path-snapshot')));
  const row = exact(raw, 'actual path snapshot create response', ['snapshot', 'replayed']);
  return { snapshot: parseActualPathSnapshot(row.snapshot), replayed: bool(row.replayed, 'actual path snapshot create response.replayed') };
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
