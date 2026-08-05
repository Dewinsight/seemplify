import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  calculateJourneyOperationalMeasure,
  JourneyOperationalMeasureError,
  type JourneyOperationalMeasureDefinition,
  type JourneyOperationalMeasureRequest,
  type JourneyOperationalObservation,
  type JourneyOperationalSourceLineage,
  type JourneyStageOperationalDefinition
} from '../src/journeyOperationalMeasures.js';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(
  path.join(testDirectory, 'fixtures', 'journey-operational-measures', 'v1', 'golden.json'),
  'utf8'
)) as {
  fixtureVersion: string;
  cases: Array<{ name: string; request: JourneyOperationalMeasureRequest; expectedSha256: string }>;
};

const sourceLineage: JourneyOperationalSourceLineage = {
  sourceRef: 'events:test',
  sourceVersion: 'source/v1',
  schemaVersion: 'schema/v1',
  projectionVersion: 'projection/v1',
  journeyId: 'test-journey',
  journeyVersion: 'journey/v1',
  ruleSetVersion: 'rules/v1'
};

const commonDefinition = {
  measureId: 'test-measure',
  definitionVersion: 'measure/v1',
  label: 'Test measure',
  sourceLineages: [sourceLineage],
  minimumSampleSize: 1,
  freshnessMaxAgeSeconds: 86400,
  decimalPlaces: 2
};

function observation(
  observationId: string,
  subjectId: string,
  subjectType: JourneyOperationalObservation['subjectType'],
  eventType: string,
  hour: number,
  overrides: Partial<JourneyOperationalObservation> = {}
): JourneyOperationalObservation {
  return {
    observationId,
    sourceLineage,
    sourceRecordId: `record-${observationId}`,
    subjectId,
    subjectType,
    eventType,
    occurredAt: `2026-08-01T${String(hour).padStart(2, '0')}:00:00.000Z`,
    ...overrides
  };
}

function calculate(definition: JourneyOperationalMeasureDefinition, observations: JourneyOperationalObservation[]) {
  return calculateJourneyOperationalMeasure({
    definition,
    period: { start: '2026-08-01T00:00:00.000Z', end: '2026-08-02T00:00:00.000Z', timezone: 'UTC' },
    asOf: '2026-08-02T00:00:00.000Z',
    observations
  });
}

test('golden fixtures lock version, lineage, corrections, trends, duration percentiles, and warnings', () => {
  assert.equal(fixture.fixtureVersion, 'journey-operational-measures-golden/v1');
  for (const goldenCase of fixture.cases) {
    const result = calculateJourneyOperationalMeasure(goldenCase.request);
    const digest = crypto.createHash('sha256').update(JSON.stringify(result)).digest('hex');
    assert.equal(digest, goldenCase.expectedSha256, goldenCase.name);
    assert.equal(result.calculationVersion, 'journey-operational-measure/v1');
    assert.equal(result.definitionVersion, goldenCase.request.definition.definitionVersion);
    assert.deepEqual(result.period, goldenCase.request.period);
    assert.deepEqual(result.sourceLineages, goldenCase.request.definition.sourceLineages);
    assert.equal(result.interpretation.mode, 'descriptive_only');
    assert.match(result.interpretation.statement, /does not establish causation, statistical significance/u);
  }
});

test('stage entry, completion, and explicit dropout retain distinct-subject denominators', () => {
  const stageBase = {
    ...commonDefinition,
    subjectType: 'journey_instance' as const,
    stageId: 'checkout',
    populationEventType: 'journey.eligible',
    entryEventType: 'stage.entry',
    completionEventType: 'stage.complete',
    dropoutEventType: 'stage.dropout'
  };
  const observations = [
    ...['a', 'b', 'c', 'd'].map((id, index) => observation(`eligible-${id}`, id, 'journey_instance', 'journey.eligible', 1 + index)),
    ...['a', 'b', 'c'].map((id, index) => observation(`entry-${id}`, id, 'journey_instance', 'stage.entry', 6 + index, { stageId: 'checkout' })),
    observation('complete-a', 'a', 'journey_instance', 'stage.complete', 10, { stageId: 'checkout' }),
    observation('complete-b', 'b', 'journey_instance', 'stage.complete', 11, { stageId: 'checkout' }),
    observation('dropout-c', 'c', 'journey_instance', 'stage.dropout', 12, { stageId: 'checkout' })
  ];
  const entry = calculate({ ...stageBase, kind: 'stage_entry' }, observations);
  const completion = calculate({ ...stageBase, kind: 'stage_completion' }, observations);
  const dropout = calculate({ ...stageBase, kind: 'stage_dropout' }, observations);
  assert.deepEqual(entry.summary, { value: 75, unit: 'percent', numerator: 3, denominator: 4, sampleSize: 4 });
  assert.deepEqual(completion.summary, { value: 66.67, unit: 'percent', numerator: 2, denominator: 3, sampleSize: 3 });
  assert.deepEqual(dropout.summary, { value: 33.33, unit: 'percent', numerator: 1, denominator: 3, sampleSize: 3 });
  assert.match(dropout.formula, /explicit dropout/u);
});

test('stage conversion requires a target entry after the source entry', () => {
  const definition: JourneyStageOperationalDefinition = {
    ...commonDefinition,
    kind: 'stage_conversion', subjectType: 'journey_instance', stageId: 'evaluate', targetStageId: 'buy',
    populationEventType: 'journey.eligible', entryEventType: 'stage.entry',
    completionEventType: 'stage.complete', dropoutEventType: 'stage.dropout'
  };
  const result = calculate(definition, [
    observation('a-source', 'a', 'journey_instance', 'stage.entry', 8, { stageId: 'evaluate' }),
    observation('a-target', 'a', 'journey_instance', 'stage.entry', 9, { stageId: 'buy' }),
    observation('b-target-before', 'b', 'journey_instance', 'stage.entry', 7, { stageId: 'buy' }),
    observation('b-source', 'b', 'journey_instance', 'stage.entry', 8, { stageId: 'evaluate' })
  ]);
  assert.deepEqual(result.summary, { value: 50, unit: 'percent', numerator: 1, denominator: 2, sampleSize: 2 });
});

test('ticket, repeat-contact, and recovery rates use explicit eligible populations', () => {
  const ticket = calculate({
    ...commonDefinition, kind: 'ticket_rate', subjectType: 'profile',
    populationEventType: 'experience.observed', ticketEventType: 'ticket.created'
  }, [
    ...['a', 'b', 'c', 'd'].map((id, index) => observation(`experience-${id}`, id, 'profile', 'experience.observed', 1 + index)),
    observation('ticket-a', 'a', 'profile', 'ticket.created', 8),
    observation('ticket-c', 'c', 'profile', 'ticket.created', 9),
    observation('ticket-c-2', 'c', 'profile', 'ticket.created', 10)
  ]);
  assert.deepEqual(ticket.summary, { value: 50, unit: 'percent', numerator: 2, denominator: 4, sampleSize: 4 });

  const repeat = calculate({
    ...commonDefinition, kind: 'repeat_contact_rate', subjectType: 'profile',
    contactEventType: 'support.contact', repeatThreshold: 2
  }, [
    observation('a-1', 'a', 'profile', 'support.contact', 1), observation('a-2', 'a', 'profile', 'support.contact', 2),
    observation('b-1', 'b', 'profile', 'support.contact', 3),
    observation('c-1', 'c', 'profile', 'support.contact', 4), observation('c-2', 'c', 'profile', 'support.contact', 5),
    observation('c-3', 'c', 'profile', 'support.contact', 6)
  ]);
  assert.deepEqual(repeat.summary, { value: 66.67, unit: 'percent', numerator: 2, denominator: 3, sampleSize: 3 });

  const recovery = calculate({
    ...commonDefinition, kind: 'recovery_rate', subjectType: 'ticket',
    eligibleEventType: 'recovery.eligible', successEventType: 'recovery.succeeded'
  }, [
    ...['t1', 't2', 't3'].map((id, index) => observation(`eligible-${id}`, id, 'ticket', 'recovery.eligible', 1 + index)),
    observation('success-t1', 't1', 'ticket', 'recovery.succeeded', 8),
    observation('success-t3', 't3', 'ticket', 'recovery.succeeded', 9),
    observation('success-without-eligibility', 't4', 'ticket', 'recovery.succeeded', 10)
  ]);
  assert.deepEqual(recovery.summary, { value: 66.67, unit: 'percent', numerator: 2, denominator: 3, sampleSize: 3 });
});

test('sentiment distribution uses the latest valid observation per social post', () => {
  const result = calculate({
    ...commonDefinition, kind: 'sentiment_distribution', subjectType: 'social_post',
    sentimentEventType: 'sentiment.observed'
  }, [
    observation('p1-old', 'p1', 'social_post', 'sentiment.observed', 1, { sentiment: 'negative' }),
    observation('p1-new', 'p1', 'social_post', 'sentiment.observed', 2, { sentiment: 'positive' }),
    observation('p2', 'p2', 'social_post', 'sentiment.observed', 3, { sentiment: 'positive' }),
    observation('p3', 'p3', 'social_post', 'sentiment.observed', 4, { sentiment: 'neutral' }),
    observation('p4', 'p4', 'social_post', 'sentiment.observed', 5, { sentiment: 'unknown' })
  ]);
  assert.equal(result.summary, null);
  assert.deepEqual(Object.fromEntries(result.rows.map((row) => [row.key, row.current.value])), {
    negative: 0, neutral: 25, positive: 50, unknown: 25
  });
  assert.ok(result.rows.every((row) => row.current.denominator === 4 && row.current.sampleSize === 4));
});

test('custom count and rate remain declarative and expose supporting samples', () => {
  const observations = [
    observation('a-denominator', 'a', 'custom', 'flow.started', 2),
    observation('b-numerator-before', 'b', 'custom', 'flow.finished', 1),
    observation('b-denominator', 'b', 'custom', 'flow.started', 2),
    observation('c-denominator', 'c', 'custom', 'flow.started', 2),
    observation('c-numerator', 'c', 'custom', 'flow.finished', 3),
    observation('c-numerator-2', 'c', 'custom', 'flow.finished', 4)
  ];
  const count = calculate({
    ...commonDefinition, kind: 'custom_count', subjectType: 'custom', eventType: 'flow.finished', aggregation: 'events'
  }, observations);
  assert.deepEqual(count.summary, { value: 3, unit: 'count', numerator: 3, denominator: 2, sampleSize: 2 });
  const rate = calculate({
    ...commonDefinition, kind: 'custom_rate', subjectType: 'custom',
    denominatorEventType: 'flow.started', numeratorEventType: 'flow.finished', requireNumeratorAfterDenominator: true
  }, observations);
  assert.deepEqual(rate.summary, { value: 33.33, unit: 'percent', numerator: 1, denominator: 3, sampleSize: 3 });
});

test('correction, exact lineage, conflict, duplicate, freshness, and sample warnings are deterministic', () => {
  const definition: JourneyOperationalMeasureDefinition = {
    ...commonDefinition,
    kind: 'custom_count', subjectType: 'custom', eventType: 'thing.happened', aggregation: 'events',
    minimumSampleSize: 3,
    freshnessMaxAgeSeconds: 3600
  };
  const mismatchedLineage = { ...sourceLineage, sourceVersion: 'source/v0' };
  const observations = [
    observation('valid', 'a', 'custom', 'thing.happened', 8),
    observation('valid', 'a', 'custom', 'thing.happened', 8),
    observation('conflict', 'b', 'custom', 'thing.happened', 9, { revision: 2 }),
    observation('conflict', 'b', 'custom', 'thing.happened', 10, { revision: 2, sourceRecordId: 'other-conflict' }),
    observation('wrong-lineage', 'c', 'custom', 'thing.happened', 11, { sourceLineage: mismatchedLineage }),
    observation('wrong-subject', 'd', 'profile', 'thing.happened', 12),
    observation('retracted', 'e', 'custom', 'thing.happened', 13, { invalidReason: 'Withdrawn.' })
  ];
  const first = calculate(definition, observations);
  const second = calculate(definition, [...observations].reverse());
  assert.deepEqual(first, second);
  assert.deepEqual(first.summary, { value: 1, unit: 'count', numerator: 1, denominator: 1, sampleSize: 1 });
  assert.equal(first.minimumSampleWarning.active, true);
  assert.equal(first.freshness.status, 'stale');
  assert.deepEqual(Object.fromEntries(first.exclusions.filter((row) => row.count).map((row) => [row.reason, row.count])), {
    SOURCE_MARKED_INVALID: 1,
    CONFLICTING_LATEST_REVISION: 2,
    LINEAGE_MISMATCH: 1,
    SUBJECT_TYPE_MISMATCH: 1,
    EXACT_DUPLICATE: 1
  });
});

test('unsafe definitions and incomparable sentiment windows fail explicitly', () => {
  const base: JourneyOperationalMeasureDefinition = {
    ...commonDefinition, kind: 'custom_count', subjectType: 'custom', eventType: 'safe.event', aggregation: 'events'
  };
  assert.throws(() => calculate({ ...base, eventType: 'unsafe event' }, []),
    (error) => error instanceof JourneyOperationalMeasureError && error.code === 'OPERATIONAL_EVENT_TYPE_INVALID');
  assert.throws(() => calculate({
    ...commonDefinition,
    kind: 'sentiment_trend', subjectType: 'social_post', sentimentEventType: 'sentiment.observed',
    comparisonPeriod: { start: '2026-07-31T00:00:00.000Z', end: '2026-08-01T12:00:00.000Z', timezone: 'UTC' }
  }, []), (error) => error instanceof JourneyOperationalMeasureError && error.code === 'OPERATIONAL_COMPARISON_PERIOD_INVALID');
});
