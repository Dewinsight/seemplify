import crypto from 'node:crypto';
import type { JourneyActualPathAnalyticsResultEnvelope } from './journeyActualPathAnalytics.js';

export const JOURNEY_PATH_INTELLIGENCE_VERSION = 'journey-path-intelligence/v1' as const;

export type JourneyPathIntelligenceInput = {
  journeyDefinitionId: string;
  subjectScope: 'anonymous_only' | 'known_profiles';
  window: { start: string; end: string; asOf: string };
  minimumSampleSize: number;
  secondarySuppressionThreshold: number;
  actualPaths: JourneyActualPathAnalyticsResultEnvelope;
};

export type JourneyPathIndicator = {
  code: 'HIGH_STAGE_DROP_OFF' | 'OBSERVED_LOOP' | 'UNEXPECTED_TRANSITION' | 'PROLONGED_STAGE_DURATION';
  severity: 'warning' | 'critical';
  stageId: string | null;
  fromStageId: string | null;
  toStageId: string | null;
  observed: { count: number; denominator: number | null; percentage: number | null; durationMs: number | null };
  threshold: { kind: 'percentage' | 'count' | 'duration_ms'; value: number };
  explanation: string;
  limitations: string[];
};

export type JourneyStageInferenceRecommendation = {
  key: string;
  kind: 'review_stage_inference_rule';
  fromStageId: string;
  inferredStageId: string;
  evidence: { occurrenceCount: number; sampleSize: number; percentage: number | null };
  confidence: {
    sampleSufficiency: { observed: number; required: number; met: boolean };
    recurrence: { observed: number; required: number; met: boolean };
    visibility: { suppressed: boolean };
  };
  rationale: string;
  limitations: string[];
  applyMode: 'human_review_only';
};

export type JourneyPathIntelligenceResult = {
  detectorVersion: typeof JOURNEY_PATH_INTELLIGENCE_VERSION;
  provenance: {
    journeyDefinitionId: string;
    journeyMapVersionId: string;
    subjectScope: 'anonymous_only' | 'known_profiles';
    identityModel: 'anonymous_instance_scoped' | 'known_profile_stitched';
    window: { start: string; end: string; asOf: string };
    analyticsVersion: string;
  };
  sample: {
    acceptedInstanceCount: number | null;
    acceptedVisitCount: number | null;
    minimumSampleSize: number;
    secondarySuppressionThreshold: number;
    sufficient: boolean;
    suppressed: boolean;
  };
  status: 'detected' | 'abstained';
  abstentionReasons: string[];
  indicators: JourneyPathIndicator[];
  recommendations: JourneyStageInferenceRecommendation[];
  limitations: string[];
  interpretation: { mode: 'descriptive_rules_only'; statement: string };
};

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stable(item)]));
  return value;
}

export function stableJourneyPathIntelligenceJson(result: JourneyPathIntelligenceResult) {
  return JSON.stringify(stable(result));
}

export function journeyPathIntelligenceSha256(result: JourneyPathIntelligenceResult) {
  return crypto.createHash('sha256').update(stableJourneyPathIntelligenceJson(result)).digest('hex');
}

export function detectJourneyPathIntelligence(input: JourneyPathIntelligenceInput): JourneyPathIntelligenceResult {
  const analytics = input.actualPaths.analytics;
  const instances = analytics.sample.acceptedInstanceCount;
  const visits = analytics.sample.acceptedVisitCount;
  const abstentionReasons: string[] = [];
  if (analytics.sample.suppressed || instances === null || visits === null) abstentionReasons.push('PRIMARY_SAMPLE_SUPPRESSED');
  else if (instances < input.minimumSampleSize) abstentionReasons.push('MINIMUM_SAMPLE_NOT_MET');
  if (analytics.lineage.journeyVersion !== input.actualPaths.scope.designVersionId) abstentionReasons.push('VERSION_PROVENANCE_MISMATCH');
  const sufficient = abstentionReasons.length === 0;
  const limitations = [
    'Indicators are deterministic descriptions of observed paths, not causal findings or predictions.',
    'A recommendation asks a human to review stage-inference rules and is never applied automatically.',
    'Counts below the configured secondary threshold are omitted.'
  ];
  const base: JourneyPathIntelligenceResult = {
    detectorVersion: JOURNEY_PATH_INTELLIGENCE_VERSION,
    provenance: {
      journeyDefinitionId: input.journeyDefinitionId,
      journeyMapVersionId: input.actualPaths.scope.designVersionId,
      subjectScope: input.subjectScope,
      identityModel: input.actualPaths.scope.identityModel,
      window: input.window,
      analyticsVersion: analytics.analyticsVersion
    },
    sample: {
      acceptedInstanceCount: instances,
      acceptedVisitCount: visits,
      minimumSampleSize: input.minimumSampleSize,
      secondarySuppressionThreshold: input.secondarySuppressionThreshold,
      sufficient,
      suppressed: analytics.sample.suppressed
    },
    status: sufficient ? 'detected' : 'abstained', abstentionReasons,
    indicators: [], recommendations: [], limitations,
    interpretation: { mode: 'descriptive_rules_only', statement: 'Fixed, versioned rules flag observable path conditions; they do not estimate causality or future outcomes.' }
  };
  if (!sufficient) return base;
  const secondary = input.secondarySuppressionThreshold;
  for (const row of analytics.tables.funnel.rows) {
    const count = row.dropOffBeforeNextMeasure.numerator;
    const percentage = row.dropOffBeforeNextMeasure.percentage;
    if (!row.dropOffBeforeNextMeasure.suppressed && count !== null && count >= secondary && percentage !== null && percentage >= 40) {
      base.indicators.push({ code: 'HIGH_STAGE_DROP_OFF', severity: percentage >= 60 ? 'critical' : 'warning',
        stageId: row.stageId, fromStageId: null, toStageId: null,
        observed: { count, denominator: row.dropOffBeforeNextMeasure.denominator, percentage, durationMs: null },
        threshold: { kind: 'percentage', value: 40 }, explanation: `Observed drop-off before the next designed stage is ${percentage}%.`, limitations });
    }
  }
  for (const row of analytics.tables.loops.rows) {
    if (!row.measure.suppressed && row.occurrenceCount >= secondary) base.indicators.push({
      code: 'OBSERVED_LOOP', severity: row.occurrenceCount >= secondary * 2 ? 'critical' : 'warning',
      stageId: null, fromStageId: row.fromStageId, toStageId: row.toStageId,
      observed: { count: row.occurrenceCount, denominator: row.measure.denominator, percentage: row.measure.percentage, durationMs: null },
      threshold: { kind: 'count', value: secondary }, explanation: 'The same backward or repeated transition recurred above the disclosure threshold.', limitations
    });
  }
  for (const row of analytics.tables.unexpectedTransitions.rows) {
    if (row.measure.suppressed || row.occurrenceCount < secondary) continue;
    base.indicators.push({ code: 'UNEXPECTED_TRANSITION', severity: 'warning', stageId: null,
      fromStageId: row.fromStageId, toStageId: row.toStageId,
      observed: { count: row.occurrenceCount, denominator: row.measure.denominator, percentage: row.measure.percentage, durationMs: null },
      threshold: { kind: 'count', value: secondary }, explanation: 'An observed transition is not adjacent in the selected designed journey version.', limitations });
    base.recommendations.push({ key: `${row.fromStageId}->${row.toStageId}`, kind: 'review_stage_inference_rule',
      fromStageId: row.fromStageId, inferredStageId: row.toStageId,
      evidence: { occurrenceCount: row.occurrenceCount, sampleSize: row.measure.sampleSize || instances!, percentage: row.measure.percentage },
      confidence: { sampleSufficiency: { observed: instances!, required: input.minimumSampleSize, met: true },
        recurrence: { observed: row.occurrenceCount, required: secondary, met: true }, visibility: { suppressed: false } },
      rationale: 'Review whether deterministic stage rules should recognise this recurrent observed transition.', limitations,
      applyMode: 'human_review_only' });
  }
  const day = 86_400_000;
  for (const row of analytics.tables.stageDurations.rows) {
    if (!row.measure.suppressed && (row.durationObservationCount || 0) >= secondary && (row.p90Ms || 0) >= day) base.indicators.push({
      code: 'PROLONGED_STAGE_DURATION', severity: (row.p90Ms || 0) >= day * 3 ? 'critical' : 'warning',
      stageId: row.stageId, fromStageId: null, toStageId: null,
      observed: { count: row.durationObservationCount!, denominator: row.measure.denominator, percentage: null, durationMs: row.p90Ms },
      threshold: { kind: 'duration_ms', value: day }, explanation: 'The observed p90 time to the next visit is at least 24 hours.', limitations
    });
  }
  base.indicators.sort((a, b) => a.code.localeCompare(b.code) || String(a.stageId || a.fromStageId).localeCompare(String(b.stageId || b.fromStageId)) || String(a.toStageId).localeCompare(String(b.toStageId)));
  base.recommendations.sort((a, b) => a.key.localeCompare(b.key));
  return base;
}
