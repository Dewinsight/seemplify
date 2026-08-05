export const JOURNEY_PATH_ANALYTICS_VERSION = 'journey-path-analytics/v1' as const;

export interface JourneyPathVersionLineage {
  journeyId: string;
  journeyVersion: string;
  ruleSetVersion: string;
  projectionVersion: string;
}

export interface JourneyPathPeriod {
  start: string;
  end: string;
  timezone: string;
}

export interface JourneyStageVisit extends JourneyPathVersionLineage {
  visitId: string;
  revision?: number;
  sourceEventId: string;
  journeyInstanceId: string;
  profileId: string;
  accountId?: string | null;
  cohortIds: string[];
  stageId: string;
  occurredAt: string;
  invalidReason?: string | null;
}

export interface JourneyPathAnalyticsRequest {
  lineage: JourneyPathVersionLineage;
  designedStageOrder: string[];
  period: JourneyPathPeriod;
  asOf: string;
  cohortId?: string | null;
  minimumCohortSize: number;
  visits: JourneyStageVisit[];
}

export type JourneyTransitionClassification =
  | 'expected'
  | 'skipped_forward'
  | 'backward_loop'
  | 'repeated_stage'
  | 'unexpected_unknown_stage';

export type JourneyPathExclusionReason =
  | 'INVALID_RECORD'
  | 'SOURCE_MARKED_INVALID'
  | 'CONFLICTING_LATEST_REVISION'
  | 'LINEAGE_MISMATCH'
  | 'INSTANCE_IDENTITY_CONFLICT'
  | 'OUTSIDE_PERIOD'
  | 'AFTER_AS_OF'
  | 'COHORT_FILTERED';

export interface JourneyPathMeasure {
  numerator: number | null;
  denominator: number | null;
  sampleSize: number | null;
  percentage: number | null;
  suppressed: boolean;
}

export interface JourneyPathTable<T> {
  rows: T[];
  suppression: {
    applied: boolean;
    minimumCohortSize: number;
    reason: 'cohort_too_small' | 'small_groups_omitted' | null;
  };
}

export interface JourneyPathSignatureRow {
  signature: string;
  stageIds: string[];
  visitCount: number;
  distinctStageCount: number;
  measure: JourneyPathMeasure;
}

export interface JourneyTransitionRow {
  fromStageId: string;
  toStageId: string;
  classification: JourneyTransitionClassification;
  missingStageIds: string[];
  occurrenceCount: number;
  measure: JourneyPathMeasure;
}

export interface JourneyFunnelRow {
  stageId: string;
  stageIndex: number;
  entrantMeasure: JourneyPathMeasure;
  completionMeasure: JourneyPathMeasure;
  dropOffBeforeNextMeasure: JourneyPathMeasure;
}

export interface JourneyLoopRow {
  fromStageId: string;
  toStageId: string;
  kind: 'backward_loop' | 'repeated_stage';
  occurrenceCount: number;
  measure: JourneyPathMeasure;
}

export interface JourneyRepeatRow {
  stageId: string;
  extraVisitCount: number;
  measure: JourneyPathMeasure;
}

export interface JourneyEntryExitRow {
  boundary: 'entry' | 'exit';
  stageId: string;
  measure: JourneyPathMeasure;
}

export interface JourneyStageDurationRow {
  stageId: string;
  totalDurationMs: number | null;
  durationObservationCount: number | null;
  minimumMs: number | null;
  meanMs: number | null;
  p50Ms: number | null;
  p90Ms: number | null;
  p95Ms: number | null;
  maximumMs: number | null;
  measure: JourneyPathMeasure;
}

export interface JourneyPathDataQualityRow {
  reason: JourneyPathExclusionReason | 'SUPERSEDED_REVISION' | 'EXACT_DUPLICATE' | 'AMBIGUOUS_TIMESTAMP_ORDER';
  count: number | null;
  suppressed: boolean;
}

export interface JourneyPathAnalyticsResult {
  analyticsVersion: typeof JOURNEY_PATH_ANALYTICS_VERSION;
  lineage: JourneyPathVersionLineage & {
    period: JourneyPathPeriod;
    asOf: string;
    cohortId: string | null;
    designedStageOrder: string[];
  };
  sample: {
    inputRecordCount: number | null;
    acceptedVisitCount: number | null;
    acceptedInstanceCount: number | null;
    distinctProfileCount: number | null;
    distinctAccountCount: number | null;
    suppressed: boolean;
  };
  dataQuality: JourneyPathDataQualityRow[];
  tables: {
    pathSignatures: JourneyPathTable<JourneyPathSignatureRow>;
    transitionMatrix: JourneyPathTable<JourneyTransitionRow>;
    funnel: JourneyPathTable<JourneyFunnelRow>;
    loops: JourneyPathTable<JourneyLoopRow>;
    repeats: JourneyPathTable<JourneyRepeatRow>;
    skippedTransitions: JourneyPathTable<JourneyTransitionRow>;
    unexpectedTransitions: JourneyPathTable<JourneyTransitionRow>;
    entryExit: JourneyPathTable<JourneyEntryExitRow>;
    stageDurations: JourneyPathTable<JourneyStageDurationRow>;
  };
  interpretation: {
    mode: 'descriptive_only';
    statement: string;
  };
}

export class JourneyPathAnalyticsConfigurationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'JourneyPathAnalyticsConfigurationError';
  }
}

interface PreparedVisit extends JourneyStageVisit {
  revision: number;
  accountId: string | null;
  cohortIds: string[];
  occurredAtMs: number;
}

interface PreparedInstance {
  journeyInstanceId: string;
  profileId: string;
  accountId: string | null;
  cohortIds: string[];
  visits: PreparedVisit[];
}

interface MutableQualityCounts {
  INVALID_RECORD: number;
  SOURCE_MARKED_INVALID: number;
  CONFLICTING_LATEST_REVISION: number;
  LINEAGE_MISMATCH: number;
  INSTANCE_IDENTITY_CONFLICT: number;
  OUTSIDE_PERIOD: number;
  AFTER_AS_OF: number;
  COHORT_FILTERED: number;
  SUPERSEDED_REVISION: number;
  EXACT_DUPLICATE: number;
  AMBIGUOUS_TIMESTAMP_ORDER: number;
}

const QUALITY_ORDER = [
  'INVALID_RECORD',
  'SOURCE_MARKED_INVALID',
  'CONFLICTING_LATEST_REVISION',
  'LINEAGE_MISMATCH',
  'INSTANCE_IDENTITY_CONFLICT',
  'OUTSIDE_PERIOD',
  'AFTER_AS_OF',
  'COHORT_FILTERED',
  'SUPERSEDED_REVISION',
  'EXACT_DUPLICATE',
  'AMBIGUOUS_TIMESTAMP_ORDER'
] as const;

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function fail(code: string, message: string): never {
  throw new JourneyPathAnalyticsConfigurationError(code, message);
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requireText(value: string, field: string) {
  if (typeof value !== 'string' || !value.trim()) fail('PATH_CONFIGURATION_INVALID', `${field} must be a non-empty string.`);
}

function requireIdentifier(value: string, field: string) {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    fail('PATH_CONFIGURATION_INVALID', `${field} must be a stable identifier using letters, numbers, dot, underscore, colon, or hyphen.`);
  }
}

function parseInstant(value: string) {
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number, places = 2) {
  const factor = 10 ** places;
  const rounded = Math.round((value + Number.EPSILON) * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function canonicalCohorts(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !IDENTIFIER_PATTERN.test(item))) return null;
  return [...new Set(value)].sort(compareText);
}

function sameLineage(left: JourneyPathVersionLineage, right: JourneyPathVersionLineage) {
  return left.journeyId === right.journeyId
    && left.journeyVersion === right.journeyVersion
    && left.ruleSetVersion === right.ruleSetVersion
    && left.projectionVersion === right.projectionVersion;
}

function validateRequest(request: JourneyPathAnalyticsRequest) {
  requireIdentifier(request.lineage.journeyId, 'lineage.journeyId');
  requireText(request.lineage.journeyVersion, 'lineage.journeyVersion');
  requireText(request.lineage.ruleSetVersion, 'lineage.ruleSetVersion');
  requireText(request.lineage.projectionVersion, 'lineage.projectionVersion');
  if (!Array.isArray(request.designedStageOrder) || request.designedStageOrder.length === 0) {
    fail('PATH_STAGE_ORDER_INVALID', 'designedStageOrder must contain at least one stage identifier.');
  }
  request.designedStageOrder.forEach((stageId, index) => requireIdentifier(stageId, `designedStageOrder[${index}]`));
  if (new Set(request.designedStageOrder).size !== request.designedStageOrder.length) {
    fail('PATH_STAGE_ORDER_INVALID', 'designedStageOrder must not contain duplicate stage identifiers.');
  }
  if (!Number.isInteger(request.minimumCohortSize) || request.minimumCohortSize < 1) {
    fail('PATH_SUPPRESSION_INVALID', 'minimumCohortSize must be a positive integer.');
  }
  if (request.cohortId !== undefined && request.cohortId !== null) requireIdentifier(request.cohortId, 'cohortId');
  requireText(request.period.timezone, 'period.timezone');
  const startMs = parseInstant(request.period.start);
  const endMs = parseInstant(request.period.end);
  const asOfMs = parseInstant(request.asOf);
  if (startMs === null || endMs === null || startMs >= endMs) {
    fail('PATH_PERIOD_INVALID', 'period.start and period.end must be valid instants and start must be before end.');
  }
  if (asOfMs === null) fail('PATH_AS_OF_INVALID', 'asOf must be a valid instant.');
  if (!Array.isArray(request.visits)) fail('PATH_VISITS_INVALID', 'visits must be an array.');
  return { startMs, endMs, asOfMs };
}

function emptyQualityCounts(): MutableQualityCounts {
  return {
    INVALID_RECORD: 0,
    SOURCE_MARKED_INVALID: 0,
    CONFLICTING_LATEST_REVISION: 0,
    LINEAGE_MISMATCH: 0,
    INSTANCE_IDENTITY_CONFLICT: 0,
    OUTSIDE_PERIOD: 0,
    AFTER_AS_OF: 0,
    COHORT_FILTERED: 0,
    SUPERSEDED_REVISION: 0,
    EXACT_DUPLICATE: 0,
    AMBIGUOUS_TIMESTAMP_ORDER: 0
  };
}

function structurallyPrepare(visit: JourneyStageVisit): PreparedVisit | null {
  const revision = visit.revision ?? 1;
  const occurredAtMs = parseInstant(visit.occurredAt);
  const cohortIds = canonicalCohorts(visit.cohortIds);
  if (!IDENTIFIER_PATTERN.test(visit.visitId)
    || !Number.isInteger(revision) || revision < 1
    || !IDENTIFIER_PATTERN.test(visit.sourceEventId)
    || !IDENTIFIER_PATTERN.test(visit.journeyInstanceId)
    || !IDENTIFIER_PATTERN.test(visit.profileId)
    || (visit.accountId !== undefined && visit.accountId !== null && !IDENTIFIER_PATTERN.test(visit.accountId))
    || !IDENTIFIER_PATTERN.test(visit.stageId)
    || occurredAtMs === null
    || cohortIds === null
    || typeof visit.journeyId !== 'string' || !visit.journeyId.trim()
    || typeof visit.journeyVersion !== 'string' || !visit.journeyVersion.trim()
    || typeof visit.ruleSetVersion !== 'string' || !visit.ruleSetVersion.trim()
    || typeof visit.projectionVersion !== 'string' || !visit.projectionVersion.trim()) return null;
  return {
    ...visit,
    revision,
    accountId: visit.accountId ?? null,
    cohortIds,
    occurredAtMs
  };
}

function visitFingerprint(visit: PreparedVisit) {
  return JSON.stringify({
    visitId: visit.visitId,
    revision: visit.revision,
    sourceEventId: visit.sourceEventId,
    journeyInstanceId: visit.journeyInstanceId,
    journeyId: visit.journeyId,
    journeyVersion: visit.journeyVersion,
    ruleSetVersion: visit.ruleSetVersion,
    projectionVersion: visit.projectionVersion,
    profileId: visit.profileId,
    accountId: visit.accountId,
    cohortIds: visit.cohortIds,
    stageId: visit.stageId,
    occurredAt: visit.occurredAt,
    invalidReason: visit.invalidReason?.trim() || null
  });
}

function prepareInstances(
  request: JourneyPathAnalyticsRequest,
  bounds: { startMs: number; endMs: number; asOfMs: number },
  quality: MutableQualityCounts
) {
  const revisionsByVisit = new Map<string, PreparedVisit[]>();
  for (const visit of request.visits) {
    const prepared = structurallyPrepare(visit);
    if (!prepared) {
      quality.INVALID_RECORD += 1;
      continue;
    }
    const revisions = revisionsByVisit.get(prepared.visitId) || [];
    revisions.push(prepared);
    revisionsByVisit.set(prepared.visitId, revisions);
  }

  const latestVisits: PreparedVisit[] = [];
  for (const [, revisions] of [...revisionsByVisit.entries()].sort(([left], [right]) => compareText(left, right))) {
    const latestRevision = Math.max(...revisions.map((visit) => visit.revision));
    const latest = revisions.filter((visit) => visit.revision === latestRevision)
      .sort((left, right) => compareText(visitFingerprint(left), visitFingerprint(right)));
    quality.SUPERSEDED_REVISION += revisions.filter((visit) => visit.revision < latestRevision).length;
    const firstFingerprint = visitFingerprint(latest[0]);
    if (latest.some((visit) => visitFingerprint(visit) !== firstFingerprint)) {
      quality.CONFLICTING_LATEST_REVISION += latest.length;
      continue;
    }
    quality.EXACT_DUPLICATE += latest.length - 1;
    const selected = latest[0];
    if (selected.invalidReason?.trim()) {
      quality.SOURCE_MARKED_INVALID += 1;
      continue;
    }
    if (!sameLineage(selected, request.lineage)) {
      quality.LINEAGE_MISMATCH += 1;
      continue;
    }
    if (selected.occurredAtMs > bounds.asOfMs) {
      quality.AFTER_AS_OF += 1;
      continue;
    }
    latestVisits.push(selected);
  }

  const byInstance = new Map<string, PreparedVisit[]>();
  for (const visit of latestVisits) {
    const visits = byInstance.get(visit.journeyInstanceId) || [];
    visits.push(visit);
    byInstance.set(visit.journeyInstanceId, visits);
  }

  const instances: PreparedInstance[] = [];
  for (const [journeyInstanceId, allVisits] of [...byInstance.entries()].sort(([left], [right]) => compareText(left, right))) {
    const identityFingerprints = new Set(allVisits.map((visit) => JSON.stringify({
      profileId: visit.profileId,
      accountId: visit.accountId,
      cohortIds: visit.cohortIds
    })));
    if (identityFingerprints.size !== 1) {
      quality.INSTANCE_IDENTITY_CONFLICT += allVisits.length;
      continue;
    }
    const first = allVisits[0];
    if (request.cohortId && !first.cohortIds.includes(request.cohortId)) {
      quality.COHORT_FILTERED += allVisits.length;
      continue;
    }
    const visits = allVisits.filter((visit) => {
      if (visit.occurredAtMs < bounds.startMs || visit.occurredAtMs >= bounds.endMs) {
        quality.OUTSIDE_PERIOD += 1;
        return false;
      }
      return true;
    }).sort((left, right) => left.occurredAtMs - right.occurredAtMs || compareText(left.visitId, right.visitId));
    if (!visits.length) continue;
    for (let index = 1; index < visits.length; index += 1) {
      if (visits[index - 1].occurredAtMs === visits[index].occurredAtMs) quality.AMBIGUOUS_TIMESTAMP_ORDER += 1;
    }
    instances.push({
      journeyInstanceId,
      profileId: first.profileId,
      accountId: first.accountId,
      cohortIds: first.cohortIds,
      visits
    });
  }
  return instances;
}

function percentage(numerator: number, denominator: number) {
  return denominator === 0 ? null : round((numerator / denominator) * 100, 2);
}

function measure(
  numerator: number,
  denominator: number,
  sampleSize: number,
  minimumCohortSize: number,
  cohortSuppressed: boolean,
  includePercentage = true
): JourneyPathMeasure {
  const suppressed = cohortSuppressed || (sampleSize > 0 && sampleSize < minimumCohortSize);
  return suppressed
    ? { numerator: null, denominator: null, sampleSize: null, percentage: null, suppressed: true }
    : { numerator, denominator, sampleSize, percentage: includePercentage ? percentage(numerator, denominator) : null, suppressed: false };
}

function table<T>(rows: T[], minimumCohortSize: number, cohortSuppressed: boolean, smallGroupsOmitted = false): JourneyPathTable<T> {
  return {
    rows: cohortSuppressed ? [] : rows,
    suppression: {
      applied: cohortSuppressed || smallGroupsOmitted,
      minimumCohortSize,
      reason: cohortSuppressed ? 'cohort_too_small' : smallGroupsOmitted ? 'small_groups_omitted' : null
    }
  };
}

function transitionClassification(fromStageId: string, toStageId: string, stageIndex: Map<string, number>) {
  const fromIndex = stageIndex.get(fromStageId);
  const toIndex = stageIndex.get(toStageId);
  if (fromIndex === undefined || toIndex === undefined) {
    return { classification: 'unexpected_unknown_stage' as const, missingStageIds: [] };
  }
  const difference = toIndex - fromIndex;
  if (difference === 1) return { classification: 'expected' as const, missingStageIds: [] };
  if (difference === 0) return { classification: 'repeated_stage' as const, missingStageIds: [] };
  if (difference < 0) return { classification: 'backward_loop' as const, missingStageIds: [] };
  return { classification: 'skipped_forward' as const, missingStageIds: [] as string[] };
}

function percentile(sortedValues: number[], quantile: number) {
  if (!sortedValues.length) return null;
  const position = (sortedValues.length - 1) * quantile;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  if (lowerIndex === upperIndex) return sortedValues[lowerIndex];
  const weight = position - lowerIndex;
  return Math.round(sortedValues[lowerIndex] + ((sortedValues[upperIndex] - sortedValues[lowerIndex]) * weight));
}

function visibleGroup(sampleSize: number, minimumCohortSize: number, cohortSuppressed: boolean) {
  return !cohortSuppressed && sampleSize >= minimumCohortSize;
}

export function calculateJourneyPathAnalytics(request: JourneyPathAnalyticsRequest): JourneyPathAnalyticsResult {
  const bounds = validateRequest(request);
  const quality = emptyQualityCounts();
  const instances = prepareInstances(request, bounds, quality);
  const instanceCount = instances.length;
  const cohortSuppressed = instanceCount < request.minimumCohortSize;
  const totalVisits = instances.reduce((total, instance) => total + instance.visits.length, 0);
  const stageIndex = new Map(request.designedStageOrder.map((stageId, index) => [stageId, index]));

  const pathGroups = new Map<string, { stageIds: string[]; instances: Set<string> }>();
  const transitionGroups = new Map<string, {
    fromStageId: string;
    toStageId: string;
    classification: JourneyTransitionClassification;
    missingStageIds: string[];
    occurrences: number;
    instances: Set<string>;
  }>();
  const entryGroups = new Map<string, Set<string>>();
  const exitGroups = new Map<string, Set<string>>();
  const repeatGroups = new Map<string, { extraVisits: number; instances: Set<string> }>();
  const durationGroups = new Map<string, { values: number[]; instances: Set<string> }>();

  for (const instance of instances) {
    const stageIds = instance.visits.map((visit) => visit.stageId);
    const signature = JSON.stringify(stageIds);
    const pathGroup = pathGroups.get(signature) || { stageIds, instances: new Set<string>() };
    pathGroup.instances.add(instance.journeyInstanceId);
    pathGroups.set(signature, pathGroup);

    const entry = entryGroups.get(stageIds[0]) || new Set<string>();
    entry.add(instance.journeyInstanceId);
    entryGroups.set(stageIds[0], entry);
    const exit = exitGroups.get(stageIds[stageIds.length - 1]) || new Set<string>();
    exit.add(instance.journeyInstanceId);
    exitGroups.set(stageIds[stageIds.length - 1], exit);

    const visitsByStage = new Map<string, number>();
    for (const stageId of stageIds) visitsByStage.set(stageId, (visitsByStage.get(stageId) || 0) + 1);
    for (const [stageId, count] of visitsByStage) {
      if (count < 2) continue;
      const repeat = repeatGroups.get(stageId) || { extraVisits: 0, instances: new Set<string>() };
      repeat.extraVisits += count - 1;
      repeat.instances.add(instance.journeyInstanceId);
      repeatGroups.set(stageId, repeat);
    }

    for (let index = 1; index < instance.visits.length; index += 1) {
      const from = instance.visits[index - 1];
      const to = instance.visits[index];
      const classified = transitionClassification(from.stageId, to.stageId, stageIndex);
      if (classified.classification === 'skipped_forward') {
        const fromIndex = stageIndex.get(from.stageId) as number;
        const toIndex = stageIndex.get(to.stageId) as number;
        classified.missingStageIds = request.designedStageOrder.slice(fromIndex + 1, toIndex);
      }
      const key = JSON.stringify([from.stageId, to.stageId, classified.classification]);
      const transition = transitionGroups.get(key) || {
        fromStageId: from.stageId,
        toStageId: to.stageId,
        classification: classified.classification,
        missingStageIds: classified.missingStageIds,
        occurrences: 0,
        instances: new Set<string>()
      };
      transition.occurrences += 1;
      transition.instances.add(instance.journeyInstanceId);
      transitionGroups.set(key, transition);

      const duration = to.occurredAtMs - from.occurredAtMs;
      const durationGroup = durationGroups.get(from.stageId) || { values: [], instances: new Set<string>() };
      durationGroup.values.push(duration);
      durationGroup.instances.add(instance.journeyInstanceId);
      durationGroups.set(from.stageId, durationGroup);
    }
  }

  let pathGroupsOmitted = false;
  const pathRows = [...pathGroups.entries()].sort(([left], [right]) => compareText(left, right)).flatMap(([signature, group]) => {
    const sampleSize = group.instances.size;
    if (!visibleGroup(sampleSize, request.minimumCohortSize, cohortSuppressed)) {
      pathGroupsOmitted = pathGroupsOmitted || !cohortSuppressed;
      return [];
    }
    return [{
      signature,
      stageIds: group.stageIds,
      visitCount: group.stageIds.length,
      distinctStageCount: new Set(group.stageIds).size,
      measure: measure(sampleSize, instanceCount, sampleSize, request.minimumCohortSize, cohortSuppressed)
    }];
  });

  let transitionGroupsOmitted = false;
  const hiddenTransitionClassifications = new Set<JourneyTransitionClassification>();
  const transitionRows = [...transitionGroups.values()]
    .sort((left, right) => compareText(left.fromStageId, right.fromStageId)
      || compareText(left.toStageId, right.toStageId)
      || compareText(left.classification, right.classification))
    .flatMap((group) => {
      const sampleSize = group.instances.size;
      if (!visibleGroup(sampleSize, request.minimumCohortSize, cohortSuppressed)) {
        transitionGroupsOmitted = transitionGroupsOmitted || !cohortSuppressed;
        hiddenTransitionClassifications.add(group.classification);
        return [];
      }
      return [{
        fromStageId: group.fromStageId,
        toStageId: group.toStageId,
        classification: group.classification,
        missingStageIds: group.missingStageIds,
        occurrenceCount: group.occurrences,
        measure: measure(group.occurrences, totalVisits - instanceCount, sampleSize, request.minimumCohortSize, cohortSuppressed)
      }];
    });

  const firstStageId = request.designedStageOrder[0];
  const completionSets = request.designedStageOrder.map(() => new Set<string>());
  for (const instance of instances) {
    const entryIndex = instance.visits.findIndex((visit) => visit.stageId === firstStageId);
    if (entryIndex < 0) continue;
    completionSets[0].add(instance.journeyInstanceId);
    let furthest = 0;
    for (const visit of instance.visits.slice(entryIndex + 1)) {
      if (visit.stageId === request.designedStageOrder[furthest + 1]) {
        furthest += 1;
        completionSets[furthest].add(instance.journeyInstanceId);
        if (furthest === request.designedStageOrder.length - 1) break;
      }
    }
  }
  const entrantCount = completionSets[0].size;
  const funnelRows: JourneyFunnelRow[] = request.designedStageOrder.map((stageId, index) => {
    const completions = completionSets[index].size;
    const nextCompletions = index + 1 < completionSets.length ? completionSets[index + 1].size : completions;
    const dropOff = completions - nextCompletions;
    return {
      stageId,
      stageIndex: index,
      entrantMeasure: measure(entrantCount, instanceCount, entrantCount, request.minimumCohortSize, cohortSuppressed),
      completionMeasure: measure(completions, entrantCount, completions, request.minimumCohortSize, cohortSuppressed),
      dropOffBeforeNextMeasure: measure(dropOff, completions, dropOff, request.minimumCohortSize, cohortSuppressed)
    };
  });
  const funnelGroupsSuppressed = !cohortSuppressed && funnelRows.some((row) =>
    row.entrantMeasure.suppressed || row.completionMeasure.suppressed || row.dropOffBeforeNextMeasure.suppressed);

  let repeatGroupsOmitted = false;
  const repeatRows = [...repeatGroups.entries()].sort(([left], [right]) => compareText(left, right)).flatMap(([stageId, group]) => {
    const sampleSize = group.instances.size;
    if (!visibleGroup(sampleSize, request.minimumCohortSize, cohortSuppressed)) {
      repeatGroupsOmitted = repeatGroupsOmitted || !cohortSuppressed;
      return [];
    }
    return [{
      stageId,
      extraVisitCount: group.extraVisits,
      measure: measure(group.extraVisits, totalVisits, sampleSize, request.minimumCohortSize, cohortSuppressed)
    }];
  });

  const loopRows: JourneyLoopRow[] = transitionRows.filter((row) =>
    row.classification === 'backward_loop' || row.classification === 'repeated_stage').map((row) => ({
    fromStageId: row.fromStageId,
    toStageId: row.toStageId,
    kind: row.classification as JourneyLoopRow['kind'],
    occurrenceCount: row.occurrenceCount,
    measure: row.measure
  }));

  let boundaryGroupsOmitted = false;
  const boundaryRows: JourneyEntryExitRow[] = [];
  for (const [boundary, groups] of [['entry', entryGroups], ['exit', exitGroups]] as const) {
    for (const [stageId, instanceIds] of [...groups.entries()].sort(([left], [right]) => compareText(left, right))) {
      const sampleSize = instanceIds.size;
      if (!visibleGroup(sampleSize, request.minimumCohortSize, cohortSuppressed)) {
        boundaryGroupsOmitted = boundaryGroupsOmitted || !cohortSuppressed;
        continue;
      }
      boundaryRows.push({
        boundary,
        stageId,
        measure: measure(sampleSize, instanceCount, sampleSize, request.minimumCohortSize, cohortSuppressed)
      });
    }
  }

  let durationGroupsOmitted = false;
  const durationRows = [...durationGroups.entries()].sort(([left], [right]) => compareText(left, right)).flatMap(([stageId, group]) => {
    const sampleSize = group.instances.size;
    if (!visibleGroup(sampleSize, request.minimumCohortSize, cohortSuppressed)) {
      durationGroupsOmitted = durationGroupsOmitted || !cohortSuppressed;
      return [];
    }
    const values = [...group.values].sort((left, right) => left - right);
    const totalDurationMs = values.reduce((total, value) => total + value, 0);
    return [{
      stageId,
      totalDurationMs,
      durationObservationCount: values.length,
      minimumMs: values[0],
      meanMs: round(totalDurationMs / values.length, 2),
      p50Ms: percentile(values, 0.5),
      p90Ms: percentile(values, 0.9),
      p95Ms: percentile(values, 0.95),
      maximumMs: values[values.length - 1],
      measure: measure(totalDurationMs, values.length, sampleSize, request.minimumCohortSize, cohortSuppressed, false)
    }];
  });

  const visibleCount = (count: number) => cohortSuppressed ? null : count;
  const dataQuality = QUALITY_ORDER.map((reason) => {
    const count = quality[reason];
    const suppressed = cohortSuppressed || (count > 0 && count < request.minimumCohortSize);
    return { reason, count: suppressed ? null : count, suppressed };
  });
  const profileCount = new Set(instances.map((instance) => instance.profileId)).size;
  const accountCount = new Set(instances.map((instance) => instance.accountId).filter((accountId): accountId is string => Boolean(accountId))).size;
  const unexpectedRows = transitionRows.filter((row) => row.classification !== 'expected' && row.classification !== 'skipped_forward');

  return {
    analyticsVersion: JOURNEY_PATH_ANALYTICS_VERSION,
    lineage: {
      ...request.lineage,
      period: { ...request.period },
      asOf: request.asOf,
      cohortId: request.cohortId ?? null,
      designedStageOrder: [...request.designedStageOrder]
    },
    sample: {
      inputRecordCount: visibleCount(request.visits.length),
      acceptedVisitCount: visibleCount(totalVisits),
      acceptedInstanceCount: visibleCount(instanceCount),
      distinctProfileCount: visibleCount(profileCount),
      distinctAccountCount: visibleCount(accountCount),
      suppressed: cohortSuppressed
    },
    dataQuality,
    tables: {
      pathSignatures: table(pathRows, request.minimumCohortSize, cohortSuppressed, pathGroupsOmitted),
      transitionMatrix: table(transitionRows, request.minimumCohortSize, cohortSuppressed, transitionGroupsOmitted),
      funnel: table(funnelRows, request.minimumCohortSize, cohortSuppressed, funnelGroupsSuppressed),
      loops: table(loopRows, request.minimumCohortSize, cohortSuppressed,
        hiddenTransitionClassifications.has('backward_loop') || hiddenTransitionClassifications.has('repeated_stage')),
      repeats: table(repeatRows, request.minimumCohortSize, cohortSuppressed, repeatGroupsOmitted),
      skippedTransitions: table(transitionRows.filter((row) => row.classification === 'skipped_forward'), request.minimumCohortSize, cohortSuppressed,
        hiddenTransitionClassifications.has('skipped_forward')),
      unexpectedTransitions: table(unexpectedRows, request.minimumCohortSize, cohortSuppressed,
        hiddenTransitionClassifications.has('backward_loop')
          || hiddenTransitionClassifications.has('repeated_stage')
          || hiddenTransitionClassifications.has('unexpected_unknown_stage')),
      entryExit: table(boundaryRows, request.minimumCohortSize, cohortSuppressed, boundaryGroupsOmitted),
      stageDurations: table(durationRows, request.minimumCohortSize, cohortSuppressed, durationGroupsOmitted)
    },
    interpretation: {
      mode: 'descriptive_only',
      statement: 'These aggregates describe observed, labelled stage sequences only. They do not establish causation, statistical significance, or the reason for any transition or drop-off.'
    }
  };
}
