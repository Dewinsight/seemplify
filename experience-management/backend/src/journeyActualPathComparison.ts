import crypto from 'node:crypto';
import type { JourneyActualPathAnalyticsResultEnvelope } from './journeyActualPathAnalytics.js';

export const JOURNEY_ACTUAL_PATH_COMPARISON_VERSION = 'journey-actual-path-comparison/v2' as const;
export const MAX_ACTUAL_PATH_COMPARISON_ROWS = 50;
export const MAX_ACTUAL_PATH_CANDIDATE_ROWS = 10_000;

export type ActualPathCorrectionLineage = {
  latestCompletedReprojection: { id: string; completedAt: string; sourceScopeSha256: string; windowStart: string | null; windowEnd: string | null } | null;
  projectionFreshness: 'current_as_of_window' | 'corrected_after_window' | 'no_completed_reprojection';
};

export type ActualPathComparisonInput = {
  journeyDefinitionId: string;
  subjectScope: 'anonymous_only' | 'known_profiles';
  current: JourneyActualPathAnalyticsResultEnvelope;
  baseline: JourneyActualPathAnalyticsResultEnvelope;
  minimumSampleSize: number;
  secondarySuppressionThreshold: number;
  limit?: number;
  correctionLineage: { current: ActualPathCorrectionLineage; baseline: ActualPathCorrectionLineage };
};

type VisibleCount = { value: number | null; suppression: 'none' | 'primary' | 'secondary' };

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
const sha256 = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

function assertInput(input: ActualPathComparisonInput) {
  if (!Number.isInteger(input.minimumSampleSize) || input.minimumSampleSize < 3 || input.minimumSampleSize > 1_000)
    throw new Error('minimumSampleSize must be an integer from 3 through 1000.');
  if (!Number.isInteger(input.secondarySuppressionThreshold) || input.secondarySuppressionThreshold < 3
    || input.secondarySuppressionThreshold > 100) throw new Error('secondarySuppressionThreshold must be an integer from 3 through 100.');
  for (const envelope of [input.current, input.baseline]) {
    if (envelope.scope.designVersionId !== input.current.scope.designVersionId)
      throw new Error('Actual-path comparisons require one exact designed journey version.');
    if (envelope.scope.subjectKind !== input.subjectScope) throw new Error('Actual-path comparison subject scope mismatch.');
    if (envelope.analytics.lineage.journeyId !== input.journeyDefinitionId
      || envelope.analytics.lineage.journeyVersion !== envelope.scope.designVersionId)
      throw new Error('Actual-path comparison journey lineage mismatch.');
  }
  if (input.current.scope.identityModel !== input.baseline.scope.identityModel)
    throw new Error('Actual-path comparisons require one exact identity model.');
  const currentStart = Date.parse(input.current.analytics.lineage.period.start);
  const currentEnd = Date.parse(input.current.analytics.lineage.period.end);
  const baselineStart = Date.parse(input.baseline.analytics.lineage.period.start);
  const baselineEnd = Date.parse(input.baseline.analytics.lineage.period.end);
  if (![currentStart, currentEnd, baselineStart, baselineEnd].every(Number.isFinite) || currentStart >= currentEnd || baselineStart >= baselineEnd)
    throw new Error('Actual-path comparison windows must be valid non-empty intervals.');
  if (baselineEnd > currentStart) throw new Error('Baseline and current actual-path windows must not overlap.');
}

/** Protects totals from revealing a single small complementary cell. */
function suppressCounts(values: number[], threshold: number): VisibleCount[] {
  const primary = new Set(values.map((value, index) => value > 0 && value < threshold ? index : -1).filter((index) => index >= 0));
  const secondary = new Set<number>();
  if (primary.size > 0) {
    const candidates = values.map((value, index) => ({ value, index }))
      .filter(({ value, index }) => value >= threshold && !primary.has(index))
      .sort((a, b) => a.value - b.value || a.index - b.index);
    if (candidates[0]) secondary.add(candidates[0].index);
  }
  return values.map((value, index) => primary.has(index)
    ? { value: null, suppression: 'primary' }
    : secondary.has(index) ? { value: null, suppression: 'secondary' } : { value, suppression: 'none' });
}

function countBySignature(envelope: JourneyActualPathAnalyticsResultEnvelope) {
  return new Map(envelope.analytics.tables.pathSignatures.rows.map((row) => [row.signature,
    { count: row.measure.numerator ?? 0, stageIds: row.stageIds, suppressed: row.measure.suppressed }]));
}

export function compareJourneyActualPaths(input: ActualPathComparisonInput) {
  assertInput(input);
  const limit = Math.max(1, Math.min(MAX_ACTUAL_PATH_COMPARISON_ROWS, Math.floor(input.limit || 20)));
  const currentCount = input.current.analytics.sample.acceptedInstanceCount;
  const baselineCount = input.baseline.analytics.sample.acceptedInstanceCount;
  const currentSufficient = currentCount !== null && !input.current.analytics.sample.suppressed && currentCount >= input.minimumSampleSize;
  const baselineSufficient = baselineCount !== null && !input.baseline.analytics.sample.suppressed && baselineCount >= input.minimumSampleSize;
  const sufficient = currentSufficient && baselineSufficient;
  const abstentionReasons = [
    ...(!baselineSufficient ? ['BASELINE_SAMPLE_UNKNOWN_OR_INSUFFICIENT'] : []),
    ...(!currentSufficient ? ['CURRENT_SAMPLE_UNKNOWN_OR_INSUFFICIENT'] : [])
  ];
  const currentPaths = countBySignature(input.current);
  const baselinePaths = countBySignature(input.baseline);
  const signatures = [...new Set([...currentPaths.keys(), ...baselinePaths.keys()])].sort();
  if (signatures.length > MAX_ACTUAL_PATH_CANDIDATE_ROWS)
    throw new Error(`Actual-path comparison exceeds the ${MAX_ACTUAL_PATH_CANDIDATE_ROWS} candidate-path bound.`);
  const currentVisibility = suppressCounts(signatures.map((key) => currentPaths.get(key)?.count || 0), input.secondarySuppressionThreshold)
    .map((visibility, index) => currentPaths.get(signatures[index]!)?.suppressed ? { value: null, suppression: 'primary' as const } : visibility);
  const baselineVisibility = suppressCounts(signatures.map((key) => baselinePaths.get(key)?.count || 0), input.secondarySuppressionThreshold)
    .map((visibility, index) => baselinePaths.get(signatures[index]!)?.suppressed ? { value: null, suppression: 'primary' as const } : visibility);
  const suppressedPathCells = signatures.some((_signature, index) => currentVisibility[index]!.suppression !== 'none'
    || baselineVisibility[index]!.suppression !== 'none');
  const pathRows = signatures.map((signature, index) => {
    const current = currentVisibility[index]!; const baseline = baselineVisibility[index]!;
    const visible = sufficient && current.suppression === 'none' && baseline.suppression === 'none';
    return {
      signatureSha256: sha256(signature),
      stageIds: (currentPaths.get(signature)?.stageIds || baselinePaths.get(signature)?.stageIds || []).slice(0, 200),
      baseline: visible ? baseline : { value: null, suppression: 'primary' as const },
      current: visible ? current : { value: null, suppression: 'primary' as const },
      delta: visible ? current.value! - baseline.value! : null,
      status: visible ? 'descriptive_change' as const : 'unknown' as const
    };
  }).filter((row) => row.status === 'descriptive_change')
    .sort((a, b) => Math.abs(b.delta || 0) - Math.abs(a.delta || 0) || a.signatureSha256.localeCompare(b.signatureSha256));

  const currentFunnel = new Map(input.current.analytics.tables.funnel.rows.map((row) => [row.stageId, row]));
  const baselineFunnel = new Map(input.baseline.analytics.tables.funnel.rows.map((row) => [row.stageId, row]));
  const comparedStageIds = input.current.analytics.lineage.designedStageOrder.slice(0, MAX_ACTUAL_PATH_COMPARISON_ROWS);
  const currentStageVisibility = suppressCounts(comparedStageIds.map((stageId) =>
    currentFunnel.get(stageId)?.dropOffBeforeNextMeasure?.numerator ?? 0), input.secondarySuppressionThreshold)
    .map((visibility, index) => currentFunnel.get(comparedStageIds[index]!)?.dropOffBeforeNextMeasure?.suppressed
      ? { value: null, suppression: 'primary' as const } : visibility);
  const baselineStageVisibility = suppressCounts(comparedStageIds.map((stageId) =>
    baselineFunnel.get(stageId)?.dropOffBeforeNextMeasure?.numerator ?? 0), input.secondarySuppressionThreshold)
    .map((visibility, index) => baselineFunnel.get(comparedStageIds[index]!)?.dropOffBeforeNextMeasure?.suppressed
      ? { value: null, suppression: 'primary' as const } : visibility);
  const suppressedStageCells = comparedStageIds.some((_stageId, index) =>
    currentStageVisibility[index]!.suppression !== 'none' || baselineStageVisibility[index]!.suppression !== 'none');
  const stageRows = comparedStageIds.map((stageId, index) => {
    const current = currentFunnel.get(stageId)?.dropOffBeforeNextMeasure;
    const baseline = baselineFunnel.get(stageId)?.dropOffBeforeNextMeasure;
    const visible = sufficient && currentStageVisibility[index]!.suppression === 'none'
      && baselineStageVisibility[index]!.suppression === 'none'
      && current?.percentage !== null && current?.percentage !== undefined
      && baseline?.percentage !== null && baseline?.percentage !== undefined;
    const delta = visible && current.percentage !== null && baseline.percentage !== null ? current.percentage - baseline.percentage : null;
    return { stageId, baselineDropOffPercentage: visible ? baseline!.percentage : null,
      currentDropOffPercentage: visible ? current!.percentage : null, percentagePointDelta: delta,
      cohort: delta !== null && delta >= 10 ? 'deteriorated' as const : delta !== null ? 'not_deteriorated' as const : 'unknown' as const,
      interpretation: 'descriptive_change_only' as const };
  });
  const unobserved = input.current.designedVsObserved.stageRows.filter((row) => row.status === 'unobserved')
    .slice(0, MAX_ACTUAL_PATH_COMPARISON_ROWS).map((row) => ({ stageId: row.stageId, cohort: 'observed_gap' as const }));
  const loopRows = input.current.analytics.tables.loops.rows;
  const loopVisibility = suppressCounts(loopRows.map((row) => row.occurrenceCount), input.secondarySuppressionThreshold);
  const loops = sufficient ? loopRows.map((row, index) => ({ row, visibility: row.measure?.suppressed
    ? { value: null, suppression: 'primary' as const } : loopVisibility[index]! }))
    .filter(({ visibility }) => visibility.suppression === 'none' && visibility.value !== 0)
    .map(({ row, visibility }) => ({ fromStageId: row.fromStageId, toStageId: row.toStageId,
      occurrenceCount: visibility, cohort: 'observed_loop' as const })).slice(0, MAX_ACTUAL_PATH_COMPARISON_ROWS) : [];
  const abandonment = stageRows.filter((row) => row.currentDropOffPercentage !== null && row.currentDropOffPercentage >= 40)
    .map((row) => ({ stageId: row.stageId, cohort: 'window_drop_off' as const, percentage: row.currentDropOffPercentage }));
  return {
    comparisonVersion: JOURNEY_ACTUAL_PATH_COMPARISON_VERSION,
    status: sufficient ? 'compared' as const : 'abstained' as const,
    abstentionReasons,
    provenance: {
      journeyDefinitionId: input.journeyDefinitionId, journeyMapVersionId: input.current.scope.designVersionId,
      subjectScope: input.subjectScope, identityModel: input.current.scope.identityModel,
      baselineWindow: input.baseline.analytics.lineage.period, currentWindow: input.current.analytics.lineage.period,
      baselineAsOf: input.baseline.analytics.lineage.asOf, currentAsOf: input.current.analytics.lineage.asOf,
      ruleSetVersion: input.current.analytics.lineage.ruleSetVersion,
      projectionVersion: input.current.analytics.lineage.projectionVersion,
      baselineRuleSetVersion: input.baseline.analytics.lineage.ruleSetVersion,
      currentRuleSetVersion: input.current.analytics.lineage.ruleSetVersion,
      baselineProjectionVersion: input.baseline.analytics.lineage.projectionVersion,
      currentProjectionVersion: input.current.analytics.lineage.projectionVersion,
      baselineIdentityModel: input.baseline.scope.identityModel,
      currentIdentityModel: input.current.scope.identityModel,
      sourceCitations: [
        { window: 'baseline' as const, analyticsContentSha256: sha256(input.baseline), correction: input.correctionLineage.baseline },
        { window: 'current' as const, analyticsContentSha256: sha256(input.current), correction: input.correctionLineage.current }
      ]
    },
    sample: { baselineAcceptedInstanceCount: baselineSufficient ? baselineCount : null,
      currentAcceptedInstanceCount: currentSufficient ? currentCount : null, minimumSampleSize: input.minimumSampleSize,
      secondarySuppressionThreshold: input.secondarySuppressionThreshold },
    cohorts: { gaps: unobserved, loops, abandonment,
      deterioration: stageRows.filter((row) => row.cohort === 'deteriorated') },
    comparisons: { paths: pathRows.slice(0, limit), stages: stageRows,
      bounds: { requestedLimit: input.limit || 20, appliedLimit: limit, maximumLimit: MAX_ACTUAL_PATH_COMPARISON_ROWS,
        maximumCandidatePathCount: MAX_ACTUAL_PATH_CANDIDATE_ROWS,
        totalCandidatePathCount: suppressedPathCells || !sufficient ? null : signatures.length,
        omittedPathCount: suppressedPathCells || !sufficient ? null : Math.max(0, signatures.length - limit),
        suppressedPathCells, suppressedStageCells } },
    interpretation: { mode: 'descriptive_comparison_only' as const,
      statement: 'These are bounded comparisons of observed, version-matched windows. Unknown and suppressed cells are not zero; no row is a causal finding, anomaly score, or prediction.' }
  };
}
