import { api } from '@/lib/api';

export type JourneyActualPathComparison = {
  comparisonVersion: 'journey-actual-path-comparison/v2';
  status: 'compared' | 'abstained'; abstentionReasons: string[];
  provenance: { journeyMapVersionId: string; baselineWindow: { start: string; end: string };
    currentWindow: { start: string; end: string }; baselineRuleSetVersion: string; currentRuleSetVersion: string;
    baselineProjectionVersion: string; currentProjectionVersion: string;
    baselineIdentityModel: string; currentIdentityModel: string; sourceCitations: Array<{ window: 'baseline' | 'current';
      analyticsContentSha256: string; correction: { projectionFreshness: string; latestCompletedReprojection: { id: string; completedAt: string } | null } }> };
  cohorts: { gaps: Array<{ stageId: string }>; loops: Array<{ fromStageId: string; toStageId: string }>;
    abandonment: Array<{ stageId: string; percentage: number }>; deterioration: Array<{ stageId: string; percentagePointDelta: number | null }> };
  comparisons: { paths: Array<{ signatureSha256: string; stageIds: string[];
    baseline: { value: number; suppression: 'none' }; current: { value: number; suppression: 'none' };
    delta: number; status: 'descriptive_change' }>;
    stages: Array<{ stageId: string; baselineDropOffPercentage: number | null;
    currentDropOffPercentage: number | null; percentagePointDelta: number | null; cohort: 'deteriorated' | 'not_deteriorated' | 'unknown' }>;
    bounds: { appliedLimit: number; maximumLimit: number; totalCandidatePathCount: number | null;
      omittedPathCount: number | null; suppressedPathCells: boolean; suppressedStageCells: boolean } };
  interpretation: { mode: 'descriptive_comparison_only'; statement: string };
};

const record = (value: unknown, label: string): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is invalid.`);
  return value as Record<string, any>;
};
const text = (value: unknown, label: string) => { if (typeof value !== 'string' || !value) throw new Error(`${label} is invalid.`); return value; };
const array = (value: unknown, label: string) => { if (!Array.isArray(value)) throw new Error(`${label} is invalid.`); return value; };
const nullableNumber = (value: unknown, label: string) => value === null ? null
  : typeof value === 'number' && Number.isFinite(value) ? value : (() => { throw new Error(`${label} is invalid.`); })();
const finiteNumber = (value: unknown, label: string) => {
  const parsed = nullableNumber(value, label);
  if (parsed === null) throw new Error(`${label} is invalid.`);
  return parsed;
};
const boolean = (value: unknown, label: string) => {
  if (typeof value !== 'boolean') throw new Error(`${label} is invalid.`);
  return value;
};

export function parseJourneyActualPathComparison(value: unknown): JourneyActualPathComparison {
  const row = record(value, 'Actual-path comparison'); const provenance = record(row.provenance, 'Comparison provenance');
  const cohorts = record(row.cohorts, 'Comparison cohorts'); const comparisons = record(row.comparisons, 'Comparisons');
  const bounds = record(comparisons.bounds, 'Comparison bounds'); const interpretation = record(row.interpretation, 'Interpretation');
  const period = (value: unknown, label: string) => { const item = record(value, label); return { start: text(item.start, `${label} start`), end: text(item.end, `${label} end`) }; };
  const stageRows = array(comparisons.stages, 'Stage comparisons').map((value, index) => { const item = record(value, `Stage ${index}`);
    const cohort = text(item.cohort, `Stage ${index} cohort`); if (!['deteriorated', 'not_deteriorated', 'unknown'].includes(cohort)) throw new Error('Stage cohort is invalid.');
    return { stageId: text(item.stageId, `Stage ${index} id`), baselineDropOffPercentage: nullableNumber(item.baselineDropOffPercentage, 'Baseline drop-off'),
      currentDropOffPercentage: nullableNumber(item.currentDropOffPercentage, 'Current drop-off'), percentagePointDelta: nullableNumber(item.percentagePointDelta, 'Drop-off delta'),
      cohort: cohort as 'deteriorated' | 'not_deteriorated' | 'unknown' }; });
  const pathRows = array(comparisons.paths, 'Path comparisons').map((value, index) => {
    const item = record(value, `Path ${index}`); const baseline = record(item.baseline, `Path ${index} baseline`);
    const current = record(item.current, `Path ${index} current`);
    const signatureSha256 = text(item.signatureSha256, `Path ${index} signature`);
    if (!/^[a-f0-9]{64}$/u.test(signatureSha256)) throw new Error(`Path ${index} signature is invalid.`);
    if (baseline.suppression !== 'none' || current.suppression !== 'none'
        || item.status !== 'descriptive_change') throw new Error(`Path ${index} visibility is invalid.`);
    const stageIds = array(item.stageIds, `Path ${index} stages`).map((stageId) => text(stageId, `Path ${index} stage`));
    if (!stageIds.length || stageIds.length > 200) throw new Error(`Path ${index} stages are invalid.`);
    const baselineValue = finiteNumber(baseline.value, `Path ${index} baseline value`);
    const currentValue = finiteNumber(current.value, `Path ${index} current value`);
    const delta = finiteNumber(item.delta, `Path ${index} delta`);
    /* The row is only descriptive if its own two visible counts explain it, so a
     * drifted or scored delta is refused rather than rendered as an observation. */
    if (delta !== currentValue - baselineValue) throw new Error(`Path ${index} delta is inconsistent.`);
    return { signatureSha256, stageIds, baseline: { value: baselineValue, suppression: 'none' as const },
      current: { value: currentValue, suppression: 'none' as const }, delta, status: 'descriptive_change' as const };
  });
  const simpleStages = (value: unknown, label: string) => array(value, label).map((entry, index) => ({ stageId: text(record(entry, `${label} ${index}`).stageId, `${label} stage`) }));
  const appliedLimit = finiteNumber(bounds.appliedLimit, 'Applied path limit');
  const maximumLimit = finiteNumber(bounds.maximumLimit, 'Maximum path limit');
  /* The server truncates to `appliedLimit`; a longer array means the response no
   * longer matches the bound it reports, so the render stays bounded by refusing. */
  if (appliedLimit > maximumLimit || pathRows.length > appliedLimit) throw new Error('Path comparisons exceed their declared bound.');
  if (row.comparisonVersion !== 'journey-actual-path-comparison/v2') throw new Error('Comparison version is unsupported.');
  return { comparisonVersion: 'journey-actual-path-comparison/v2',
    status: row.status === 'compared' ? 'compared' : row.status === 'abstained' ? 'abstained' : (() => { throw new Error('Comparison status is invalid.'); })(),
    abstentionReasons: array(row.abstentionReasons, 'Abstention reasons').map((item) => text(item, 'Abstention reason')),
    provenance: { journeyMapVersionId: text(provenance.journeyMapVersionId, 'Journey version'),
      baselineWindow: period(provenance.baselineWindow, 'Baseline window'), currentWindow: period(provenance.currentWindow, 'Current window'),
      baselineRuleSetVersion: text(provenance.baselineRuleSetVersion, 'Baseline rule-set version'),
      currentRuleSetVersion: text(provenance.currentRuleSetVersion, 'Current rule-set version'),
      baselineProjectionVersion: text(provenance.baselineProjectionVersion, 'Baseline projection version'),
      currentProjectionVersion: text(provenance.currentProjectionVersion, 'Current projection version'),
      baselineIdentityModel: text(provenance.baselineIdentityModel, 'Baseline identity model'),
      currentIdentityModel: text(provenance.currentIdentityModel, 'Current identity model'),
      sourceCitations: array(provenance.sourceCitations, 'Source citations').map((entry, index) => { const item = record(entry, `Citation ${index}`);
        const correction = record(item.correction, `Citation ${index} correction`); const latest = correction.latestCompletedReprojection === null ? null : record(correction.latestCompletedReprojection, 'Latest correction');
        if (item.window !== 'baseline' && item.window !== 'current') throw new Error('Citation window is invalid.');
        const digest = text(item.analyticsContentSha256, 'Citation digest'); if (!/^[a-f0-9]{64}$/u.test(digest)) throw new Error('Citation digest is invalid.');
        return { window: item.window as 'baseline' | 'current',
          analyticsContentSha256: digest, correction: { projectionFreshness: text(correction.projectionFreshness, 'Projection freshness'),
            latestCompletedReprojection: latest ? { id: text(latest.id, 'Correction id'), completedAt: text(latest.completedAt, 'Correction time') } : null } }; }) },
    cohorts: { gaps: simpleStages(cohorts.gaps, 'Gap cohorts'),
      loops: array(cohorts.loops, 'Loop cohorts').map((entry) => { const item = record(entry, 'Loop cohort'); return { fromStageId: text(item.fromStageId, 'Loop from'), toStageId: text(item.toStageId, 'Loop to') }; }),
      abandonment: array(cohorts.abandonment, 'Abandonment cohorts').map((entry) => { const item = record(entry, 'Abandonment cohort'); return { stageId: text(item.stageId, 'Abandonment stage'), percentage: finiteNumber(item.percentage, 'Abandonment percentage') }; }),
      deterioration: array(cohorts.deterioration, 'Deterioration cohorts').map((entry) => { const item = record(entry, 'Deterioration cohort'); return { stageId: text(item.stageId, 'Deterioration stage'), percentagePointDelta: nullableNumber(item.percentagePointDelta, 'Deterioration delta') }; }) },
    comparisons: { paths: pathRows, stages: stageRows,
      bounds: { appliedLimit, maximumLimit,
      totalCandidatePathCount: nullableNumber(bounds.totalCandidatePathCount, 'Candidate path count'), omittedPathCount: nullableNumber(bounds.omittedPathCount, 'Omitted path count'),
      suppressedPathCells: boolean(bounds.suppressedPathCells, 'Suppressed path cells'),
      suppressedStageCells: boolean(bounds.suppressedStageCells, 'Suppressed stage cells') } },
    interpretation: { mode: 'descriptive_comparison_only', statement: text(interpretation.statement, 'Interpretation') } };
}

export async function readActualPathComparison(input: { journeyDefinitionId: string; subjectScope: 'anonymous_only' | 'known_profiles';
  baselineFrom: string; baselineTo: string; currentFrom: string; currentTo: string }) {
  const query = new URLSearchParams({ ...input, minimumSampleSize: '10', secondarySuppressionThreshold: '3', limit: '20' });
  const raw = await api<unknown>(`/api/journey-metrics/actual-path-comparisons?${query}`);
  return parseJourneyActualPathComparison(record(raw, 'Comparison response').comparison);
}
