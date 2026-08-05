import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  calculateJourneyPathAnalytics,
  JourneyPathAnalyticsConfigurationError,
  type JourneyPathAnalyticsRequest,
  type JourneyStageVisit
} from '../src/journeyPathAnalytics.js';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(
  path.join(testDirectory, 'fixtures', 'journey-path-analytics', 'v1', 'golden.json'),
  'utf8'
)) as {
  fixtureVersion: string;
  cases: Array<{
    name: string;
    request: JourneyPathAnalyticsRequest;
    expected: {
      sha256: string;
      acceptedInstanceCount: number;
      acceptedVisitCount: number;
      visiblePathCount: number;
      visibleTransitionCount: number;
      visibleLoopCount: number;
      visibleRepeatCount: number;
      visibleSkippedTransitionCount: number;
      finalFunnelCompletionNumerator: number;
      discoverDurationP95Ms: number;
    };
  }>;
};

const lineage = {
  journeyId: 'checkout',
  journeyVersion: 'journey/v3',
  ruleSetVersion: 'rules/v2',
  projectionVersion: 'projection/v1'
};

function visit(
  visitId: string,
  journeyInstanceId: string,
  profileId: string,
  stageId: string,
  occurredAt: string,
  overrides: Partial<JourneyStageVisit> = {}
): JourneyStageVisit {
  return {
    ...lineage,
    visitId,
    sourceEventId: `event-${visitId}`,
    journeyInstanceId,
    profileId,
    accountId: `account-${profileId}`,
    cohortIds: ['paid'],
    stageId,
    occurredAt,
    ...overrides
  };
}

function request(visits: JourneyStageVisit[], overrides: Partial<JourneyPathAnalyticsRequest> = {}): JourneyPathAnalyticsRequest {
  return {
    lineage,
    designedStageOrder: ['discover', 'evaluate', 'buy', 'onboard'],
    period: { start: '2026-08-01T00:00:00.000Z', end: '2026-08-02T00:00:00.000Z', timezone: 'UTC' },
    asOf: '2026-08-03T00:00:00.000Z',
    cohortId: 'paid',
    minimumCohortSize: 1,
    visits,
    ...overrides
  };
}

test('the v1 golden fixture locks every table and its version/period/sample lineage', () => {
  assert.equal(fixture.fixtureVersion, 'journey-path-analytics-golden/v1');
  const goldenCase = fixture.cases[0];
  const result = calculateJourneyPathAnalytics(goldenCase.request);
  const digest = crypto.createHash('sha256').update(JSON.stringify(result)).digest('hex');
  assert.equal(digest, goldenCase.expected.sha256, goldenCase.name);
  assert.equal(result.sample.acceptedInstanceCount, goldenCase.expected.acceptedInstanceCount);
  assert.equal(result.sample.acceptedVisitCount, goldenCase.expected.acceptedVisitCount);
  assert.equal(result.tables.pathSignatures.rows.length, goldenCase.expected.visiblePathCount);
  assert.equal(result.tables.transitionMatrix.rows.length, goldenCase.expected.visibleTransitionCount);
  assert.equal(result.tables.loops.rows.length, goldenCase.expected.visibleLoopCount);
  assert.equal(result.tables.repeats.rows.length, goldenCase.expected.visibleRepeatCount);
  assert.equal(result.tables.skippedTransitions.rows.length, goldenCase.expected.visibleSkippedTransitionCount);
  assert.equal(result.tables.funnel.rows.at(-1)?.completionMeasure.numerator,
    goldenCase.expected.finalFunnelCompletionNumerator);
  assert.equal(result.tables.stageDurations.rows.find((row) => row.stageId === 'discover')?.p95Ms,
    goldenCase.expected.discoverDurationP95Ms);
  assert.deepEqual(result.lineage.period, goldenCase.request.period);
  assert.equal(result.lineage.journeyVersion, goldenCase.request.lineage.journeyVersion);
  assert.equal(result.interpretation.mode, 'descriptive_only');
  assert.match(result.interpretation.statement, /do not establish causation, statistical significance/u);
});

test('out-of-order input is immaterial and corrected revisions are applied before period filtering', () => {
  const stable = visit('stable', 'stable-instance', 'stable-profile', 'discover', '2026-08-01T08:00:00.000Z');
  const original = visit('corrected', 'corrected-instance', 'corrected-profile', 'discover', '2026-08-01T09:00:00.000Z', {
    revision: 1,
    sourceEventId: 'event-corrected-v1'
  });
  const correction = visit('corrected', 'corrected-instance', 'corrected-profile', 'discover', '2026-07-31T09:00:00.000Z', {
    revision: 2,
    sourceEventId: 'event-corrected-v2'
  });
  const forward = calculateJourneyPathAnalytics(request([correction, stable, original]));
  const reversed = calculateJourneyPathAnalytics(request([original, stable, correction]));
  assert.deepEqual(forward, reversed);
  assert.equal(forward.sample.acceptedInstanceCount, 1);
  assert.equal(forward.sample.acceptedVisitCount, 1);
  assert.equal(forward.tables.pathSignatures.rows[0].measure.numerator, 1);
  assert.equal(forward.dataQuality.find((row) => row.reason === 'SUPERSEDED_REVISION')?.count, 1);
  assert.equal(forward.dataQuality.find((row) => row.reason === 'OUTSIDE_PERIOD')?.count, 1);
});

test('small cohorts redact sample, quality counts, and every analytics table', () => {
  const result = calculateJourneyPathAnalytics(request([
    visit('one', 'instance-one', 'profile-one', 'discover', '2026-08-01T08:00:00.000Z'),
    visit('two', 'instance-two', 'profile-two', 'discover', '2026-08-01T09:00:00.000Z')
  ], { minimumCohortSize: 3 }));
  assert.deepEqual(result.sample, {
    inputRecordCount: null,
    acceptedVisitCount: null,
    acceptedInstanceCount: null,
    distinctProfileCount: null,
    distinctAccountCount: null,
    suppressed: true
  });
  assert.ok(Object.values(result.tables).every((analyticsTable) =>
    analyticsTable.rows.length === 0
      && analyticsTable.suppression.applied
      && analyticsTable.suppression.reason === 'cohort_too_small'));
  assert.ok(result.dataQuality.every((row) => row.count === null && row.suppressed));
});

test('designed-order comparison exposes skips, unknown transitions, loops, repeats, and actual boundaries', () => {
  const result = calculateJourneyPathAnalytics(request([
    visit('a', 'instance', 'profile', 'discover', '2026-08-01T08:00:00.000Z'),
    visit('b', 'instance', 'profile', 'buy', '2026-08-01T09:00:00.000Z'),
    visit('c', 'instance', 'profile', 'evaluate', '2026-08-01T10:00:00.000Z'),
    visit('d', 'instance', 'profile', 'evaluate', '2026-08-01T11:00:00.000Z'),
    visit('e', 'instance', 'profile', 'support', '2026-08-01T12:00:00.000Z')
  ]));
  assert.deepEqual(result.tables.skippedTransitions.rows.map((row) => ({
    from: row.fromStageId,
    to: row.toStageId,
    missing: row.missingStageIds
  })), [{ from: 'discover', to: 'buy', missing: ['evaluate'] }]);
  assert.deepEqual(result.tables.unexpectedTransitions.rows.map((row) => row.classification), [
    'backward_loop',
    'repeated_stage',
    'unexpected_unknown_stage'
  ]);
  assert.equal(result.tables.loops.rows.length, 2);
  assert.deepEqual(result.tables.repeats.rows.map((row) => row.stageId), ['evaluate']);
  assert.deepEqual(result.tables.entryExit.rows.map((row) => [row.boundary, row.stageId]), [
    ['entry', 'discover'],
    ['exit', 'support']
  ]);
});

test('same-revision conflicts and identity conflicts are never selected arbitrarily', () => {
  const result = calculateJourneyPathAnalytics(request([
    visit('stable', 'stable-instance', 'stable-profile', 'discover', '2026-08-01T08:00:00.000Z'),
    visit('conflict', 'conflict-instance', 'conflict-profile', 'discover', '2026-08-01T09:00:00.000Z', { revision: 2 }),
    visit('conflict', 'conflict-instance', 'conflict-profile', 'evaluate', '2026-08-01T09:00:00.000Z', {
      revision: 2,
      sourceEventId: 'event-conflict-other'
    }),
    visit('identity-a', 'identity-instance', 'identity-profile-a', 'discover', '2026-08-01T10:00:00.000Z'),
    visit('identity-b', 'identity-instance', 'identity-profile-b', 'evaluate', '2026-08-01T11:00:00.000Z')
  ]));
  assert.equal(result.sample.acceptedInstanceCount, 1);
  assert.equal(result.dataQuality.find((row) => row.reason === 'CONFLICTING_LATEST_REVISION')?.count, 2);
  assert.equal(result.dataQuality.find((row) => row.reason === 'INSTANCE_IDENTITY_CONFLICT')?.count, 2);
});

test('invalid stage orders, periods, and suppression policies fail explicitly', () => {
  const base = request([]);
  assert.throws(() => calculateJourneyPathAnalytics({ ...base, designedStageOrder: ['discover', 'discover'] }),
    (error) => error instanceof JourneyPathAnalyticsConfigurationError && error.code === 'PATH_STAGE_ORDER_INVALID');
  assert.throws(() => calculateJourneyPathAnalytics({ ...base, minimumCohortSize: 0 }),
    (error) => error instanceof JourneyPathAnalyticsConfigurationError && error.code === 'PATH_SUPPRESSION_INVALID');
  assert.throws(() => calculateJourneyPathAnalytics({
    ...base,
    period: { start: base.period.end, end: base.period.start, timezone: 'UTC' }
  }), (error) => error instanceof JourneyPathAnalyticsConfigurationError && error.code === 'PATH_PERIOD_INVALID');
});
