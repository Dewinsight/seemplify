import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

/** Scope note: the workspace test proves the *presentation* contract from the
 * source text. This file runs the strict client itself, so a drifted response —
 * a suppressed cell that still carries a count, a delta that is not explained by
 * its own two counts, or more rows than the bound the response reports — fails
 * here rather than reaching the flow table as if it were an observation. */

const sourceRoot = path.resolve(import.meta.dirname, '..', 'src');
const bundled = await build({ entryPoints: [path.join(sourceRoot, 'lib', 'journeyActualPathComparison.ts')],
  bundle: true, write: false, format: 'esm', platform: 'browser', alias: { '@': sourceRoot }, logLevel: 'silent' });
const client = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const parse = client.parseJourneyActualPathComparison;

const now = '2026-08-07T12:00:00.000Z';
const pathRow = { signatureSha256: 'e'.repeat(64), stageIds: ['stage-discover', 'stage-activate'],
  baseline: { value: 8, suppression: 'none' }, current: { value: 13, suppression: 'none' }, delta: 5,
  status: 'descriptive_change' };
const comparison = {
  comparisonVersion: 'journey-actual-path-comparison/v2', status: 'compared', abstentionReasons: [],
  provenance: { journeyDefinitionId: 'journey-1', journeyMapVersionId: 'version-1', subjectScope: 'anonymous_only',
    identityModel: 'anonymous_instance_scoped',
    baselineRuleSetVersion: 'rules-baseline', currentRuleSetVersion: 'rules-current',
    baselineProjectionVersion: 'projection-baseline', currentProjectionVersion: 'projection-current',
    baselineIdentityModel: 'anonymous_instance_scoped', currentIdentityModel: 'anonymous_instance_scoped',
    baselineWindow: { start: '2026-06-03T00:00:00.000Z', end: '2026-07-04T00:00:00.000Z', timezone: 'UTC' },
    currentWindow: { start: '2026-07-04T00:00:00.000Z', end: now, timezone: 'UTC' },
    sourceCitations: [{ window: 'baseline', analyticsContentSha256: 'b'.repeat(64),
      correction: { projectionFreshness: 'current_as_of_window', latestCompletedReprojection: null } },
    { window: 'current', analyticsContentSha256: 'c'.repeat(64),
      correction: { projectionFreshness: 'corrected_after_window',
        latestCompletedReprojection: { id: 'reprojection-1', completedAt: now, sourceScopeSha256: 'd'.repeat(64) } } }] },
  sample: { baselineAcceptedInstanceCount: 20, currentAcceptedInstanceCount: 20, minimumSampleSize: 10,
    secondarySuppressionThreshold: 3 },
  cohorts: { gaps: [{ stageId: 'stage-activate', cohort: 'observed_gap' }], loops: [],
    abandonment: [{ stageId: 'stage-discover', cohort: 'window_drop_off', percentage: 55 }],
    deterioration: [{ stageId: 'stage-discover', percentagePointDelta: 25, cohort: 'deteriorated' }] },
  comparisons: { paths: [pathRow], stages: [{ stageId: 'stage-discover', baselineDropOffPercentage: 30,
    currentDropOffPercentage: 55, percentagePointDelta: 25, cohort: 'deteriorated' },
  { stageId: 'stage-activate', baselineDropOffPercentage: null, currentDropOffPercentage: null,
    percentagePointDelta: null, cohort: 'unknown' }],
  bounds: { requestedLimit: 20, appliedLimit: 20, maximumLimit: 50, totalCandidatePathCount: null,
    omittedPathCount: null, suppressedPathCells: true, suppressedStageCells: true } },
  interpretation: { mode: 'descriptive_comparison_only', statement: 'Observed version-matched changes only.' }
};
const withPaths = (paths) => ({ ...comparison, comparisons: { ...comparison.comparisons, paths } });

test('the strict client exposes bounded visible paths with their exact stage order and counts', () => {
  const parsed = parse(comparison);
  assert.equal(parsed.comparisons.paths.length, 1);
  const [row] = parsed.comparisons.paths;
  assert.deepEqual(row.stageIds, ['stage-discover', 'stage-activate']);
  assert.equal(row.baseline.value, 8);
  assert.equal(row.current.value, 13);
  assert.equal(row.delta, 5);
  assert.equal(row.status, 'descriptive_change');
  assert.equal(row.signatureSha256, 'e'.repeat(64));
  // The abstained shape carries no path rows at all, so nothing can read as zero.
  assert.deepEqual(parse({ ...withPaths([]), status: 'abstained',
    abstentionReasons: ['CURRENT_SAMPLE_UNKNOWN_OR_INSUFFICIENT'] }).comparisons.paths, []);
});

test('a suppressed or unlabelled path cell is refused rather than rendered', () => {
  assert.throws(() => parse(withPaths([{ ...pathRow, baseline: { value: null, suppression: 'primary' } }])),
    /Path 0 visibility is invalid/u);
  assert.throws(() => parse(withPaths([{ ...pathRow, current: { value: 4, suppression: 'secondary' } }])),
    /Path 0 visibility is invalid/u);
  // A suppressed cell that still carries its count is the disclosure this guards.
  assert.throws(() => parse(withPaths([{ ...pathRow, baseline: { value: 8, suppression: 'primary' } }])),
    /Path 0 visibility is invalid/u);
  assert.throws(() => parse(withPaths([{ ...pathRow, baseline: { value: null, suppression: 'none' } }])),
    /Path 0 baseline value is invalid/u);
  assert.throws(() => parse(withPaths([{ ...pathRow, status: 'unknown' }])), /Path 0 visibility is invalid/u);
});

test('a path row must prove its own identity, stage bound and arithmetic', () => {
  assert.throws(() => parse(withPaths([{ ...pathRow, signatureSha256: 'not-a-digest' }])),
    /Path 0 signature is invalid/u);
  assert.throws(() => parse(withPaths([{ ...pathRow, signatureSha256: 'E'.repeat(64) }])),
    /Path 0 signature is invalid/u);
  assert.throws(() => parse(withPaths([{ ...pathRow, stageIds: [] }])), /Path 0 stages are invalid/u);
  assert.throws(() => parse(withPaths([{ ...pathRow, stageIds: Array.from({ length: 201 }, (_v, i) => `stage-${i}`) }])),
    /Path 0 stages are invalid/u);
  // A delta that its own two counts do not explain would be a score, not an observation.
  assert.throws(() => parse(withPaths([{ ...pathRow, delta: 9 }])), /Path 0 delta is inconsistent/u);
  assert.doesNotThrow(() => parse(withPaths([{ ...pathRow, baseline: { value: 13, suppression: 'none' },
    current: { value: 8, suppression: 'none' }, delta: -5 }])));
});

test('the response can never exceed the bound it reports', () => {
  const rows = ['a', 'b', 'c'].map((seed) => ({ ...pathRow, signatureSha256: seed.repeat(64) }));
  const bounded = { ...comparison, comparisons: { ...comparison.comparisons, paths: rows,
    bounds: { ...comparison.comparisons.bounds, appliedLimit: 2 } } };
  assert.throws(() => parse(bounded), /Path comparisons exceed their declared bound/u);
  const overMaximum = { ...comparison, comparisons: { ...comparison.comparisons,
    bounds: { ...comparison.comparisons.bounds, appliedLimit: 80, maximumLimit: 50 } } };
  assert.throws(() => parse(overMaximum), /Path comparisons exceed their declared bound/u);
});

test('citations keep their correction lineage and reject a drifted digest', () => {
  const parsed = parse(comparison);
  const current = parsed.provenance.sourceCitations.find((row) => row.window === 'current');
  assert.equal(current.correction.projectionFreshness, 'corrected_after_window');
  assert.equal(current.correction.latestCompletedReprojection.id, 'reprojection-1');
  assert.throws(() => parse({ ...comparison, provenance: { ...comparison.provenance,
    sourceCitations: [{ ...comparison.provenance.sourceCitations[0], analyticsContentSha256: 'short' }] } }),
  /Citation digest is invalid/u);
});

test('processing lineage is required independently for both comparison windows', () => {
  const parsed = parse(comparison);
  assert.equal(parsed.provenance.baselineRuleSetVersion, 'rules-baseline');
  assert.equal(parsed.provenance.currentProjectionVersion, 'projection-current');
  assert.equal(parsed.comparisons.bounds.suppressedStageCells, true);
  assert.throws(() => parse({ ...comparison, provenance: { ...comparison.provenance,
    baselineProjectionVersion: null } }), /Baseline projection version is invalid/u);
  assert.throws(() => parse({ ...comparison, comparisonVersion: 'journey-actual-path-comparison/v1' }),
    /Comparison version is unsupported/u);
});
