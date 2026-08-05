import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { computeAnalytics } from '../src/analytics.js';
import {
  calculateJourneyMetric,
  JOURNEY_METRIC_CALCULATION_VERSION,
  JourneyMetricConfigurationError,
  type JourneyMetricCalculationRequest,
  type JourneyMetricCalculationResult,
  type JourneyRatingMetricDefinition
} from '../src/journeyMetricCalculations.js';
import type { ResponseRecord, Survey } from '../src/types.js';

interface GoldenFixture {
  fixtureVersion: string;
  cases: Array<{
    name: string;
    request: JourneyMetricCalculationRequest;
    expected: JourneyMetricCalculationResult;
  }>;
}

const golden = JSON.parse(readFileSync(
  new URL('./fixtures/journey-metrics/v1/golden.json', import.meta.url),
  'utf8'
)) as GoldenFixture;

test('v1 NPS, CSAT, and CES golden calculations remain exact and order-independent', () => {
  assert.equal(golden.fixtureVersion, 'journey-metric-golden/v1');
  assert.equal(JOURNEY_METRIC_CALCULATION_VERSION, 'journey-metric-calculation/v1');
  assert.equal(golden.cases.length, 4);
  for (const fixture of golden.cases) {
    assert.deepEqual(calculateJourneyMetric(fixture.request), fixture.expected, fixture.name);
    assert.deepEqual(calculateJourneyMetric({
      ...fixture.request,
      samples: [...fixture.request.samples].reverse()
    }), fixture.expected, `${fixture.name} (reversed input order)`);
  }
});

function surveyResponse(id: string, nps: number, csat: number, ces: number): ResponseRecord {
  return {
    id,
    surveyId: 'legacy-parity',
    collectorId: 'collector',
    respondentToken: id,
    status: 'completed',
    answers: { nps, csat, ces },
    metadata: {},
    startedAt: '2026-07-01T00:00:00.000Z',
    completedAt: '2026-07-01T00:01:00.000Z',
    durationSeconds: 60,
    aiAnalysis: null,
    analyzedAt: null
  };
}

test('standard NPS and mean rating definitions reconcile with existing survey analytics', () => {
  const survey = {
    id: 'legacy-parity', title: 'Legacy parity', description: '', purpose: 'customer_experience', audience: '',
    status: 'live', primaryMetric: 'nps', language: 'English', thankYouMessage: 'Thanks', theme: {}, settings: {},
    createdAt: '', updatedAt: '', publishedAt: '', questions: [
      { id: 'nps', surveyId: 'legacy-parity', page: 1, position: 0, type: 'nps', title: 'Recommend?', description: '', required: true, options: [], settings: {}, logic: [] },
      { id: 'csat', surveyId: 'legacy-parity', page: 1, position: 1, type: 'csat', title: 'Satisfied?', description: '', required: true, options: [], settings: {}, logic: [] },
      { id: 'ces', surveyId: 'legacy-parity', page: 1, position: 2, type: 'ces', title: 'Effort?', description: '', required: true, options: [], settings: {}, logic: [] }
    ]
  } satisfies Survey;
  const responses = [surveyResponse('one', 10, 5, 1), surveyResponse('two', 9, 4, 2), surveyResponse('three', 5, 3, 6)];
  const legacy = computeAnalytics(survey, responses);
  const common = {
    period: { start: '2026-07-01T00:00:00.000Z', end: '2026-07-02T00:00:00.000Z', timezone: 'UTC' },
    asOf: '2026-07-02T00:00:00.000Z'
  };
  const samples = (field: 'nps' | 'csat' | 'ces') => responses.map((response) => ({
    sampleId: response.id,
    sourceRef: `survey:legacy-parity/question:${field}`,
    value: response.answers[field],
    occurredAt: response.completedAt!
  }));
  const nps = calculateJourneyMetric({ ...common, definition: {
    metricId: 'nps', metricDefinitionVersion: 'v1', label: 'NPS', metricType: 'nps',
    scale: { minimum: 0, maximum: 10, step: 1 }, direction: 'higher_is_better',
    formula: { kind: 'net_promoter_score', detractorMaximum: 6, promoterMinimum: 9 },
    sourceRefs: ['survey:legacy-parity/question:nps'], minimumSampleSize: 1,
    freshnessMaxAgeSeconds: 172800, decimalPlaces: 0
  }, samples: samples('nps') });
  const ratingDefinition = (metricType: 'csat' | 'ces', direction: 'higher_is_better' | 'lower_is_better'): JourneyRatingMetricDefinition => ({
    metricId: metricType, metricDefinitionVersion: 'v1', label: metricType.toUpperCase(), metricType,
    scale: metricType === 'csat' ? { minimum: 1, maximum: 5, step: 1 } : { minimum: 1, maximum: 7, step: 1 },
    direction, formula: { kind: 'mean' },
    favourable: direction === 'higher_is_better' ? { operator: 'gte', threshold: 4 } : { operator: 'lte', threshold: 3 },
    sourceRefs: [`survey:legacy-parity/question:${metricType}`], minimumSampleSize: 1,
    freshnessMaxAgeSeconds: 172800, decimalPlaces: 6
  });
  const csat = calculateJourneyMetric({ ...common, definition: ratingDefinition('csat', 'higher_is_better'), samples: samples('csat') });
  const ces = calculateJourneyMetric({ ...common, definition: ratingDefinition('ces', 'lower_is_better'), samples: samples('ces') });
  assert.equal(nps.value, legacy.metrics.nps);
  assert.equal(csat.value, legacy.metrics.csat);
  assert.equal(ces.value, legacy.metrics.ces);
});

test('empty periods return an explainable null observation and a minimum-sample warning', () => {
  const definition: JourneyRatingMetricDefinition = {
    metricId: 'empty-csat', metricDefinitionVersion: 'v1', label: 'Empty CSAT', metricType: 'csat',
    scale: { minimum: 1, maximum: 5, step: 1 }, direction: 'higher_is_better', formula: { kind: 'mean' },
    favourable: { operator: 'gte', threshold: 4 }, sourceRefs: ['survey:empty/question:csat'],
    minimumSampleSize: 10, freshnessMaxAgeSeconds: 86400, decimalPlaces: 2
  };
  const result = calculateJourneyMetric({
    definition,
    period: { start: '2026-07-01T00:00:00.000Z', end: '2026-07-02T00:00:00.000Z', timezone: 'UTC' },
    asOf: '2026-07-02T00:00:00.000Z',
    samples: []
  });
  assert.equal(result.value, null);
  assert.equal(result.numerator, null);
  assert.equal(result.denominator, 0);
  assert.equal(result.sampleSize, 0);
  assert.equal(result.freshness.status, 'unavailable');
  assert.equal(result.minimumSampleWarning.active, true);
  assert.match(result.explanation, /unavailable because no valid responses/u);
});

test('same-revision conflicts cannot be selected arbitrarily', () => {
  const definition: JourneyRatingMetricDefinition = {
    metricId: 'conflict-csat', metricDefinitionVersion: 'v1', label: 'Conflict CSAT', metricType: 'csat',
    scale: { minimum: 1, maximum: 5, step: 1 }, direction: 'higher_is_better', formula: { kind: 'mean' },
    favourable: { operator: 'gte', threshold: 4 }, sourceRefs: ['survey:conflict/question:csat'],
    minimumSampleSize: 1, freshnessMaxAgeSeconds: 86400, decimalPlaces: 2
  };
  const result = calculateJourneyMetric({
    definition,
    period: { start: '2026-07-01T00:00:00.000Z', end: '2026-07-02T00:00:00.000Z', timezone: 'UTC' },
    asOf: '2026-07-02T00:00:00.000Z',
    samples: [
      { sampleId: 'same', revision: 2, sourceRef: definition.sourceRefs[0], value: 4, occurredAt: '2026-07-01T12:00:00.000Z' },
      { sampleId: 'same', revision: 2, sourceRef: definition.sourceRefs[0], value: 5, occurredAt: '2026-07-01T12:00:00.000Z' }
    ]
  });
  assert.equal(result.sampleSize, 0);
  assert.equal(result.exclusions.invalid.count, 2);
  assert.ok(result.exclusions.invalid.records.every((record) => record.reason === 'CONFLICTING_DUPLICATE_REVISION'));
});

test('configuration rejects ambiguous direction and implicit non-standard NPS rules', () => {
  const common = {
    metricId: 'bad', metricDefinitionVersion: 'v1', label: 'Bad', sourceRefs: ['survey:bad/question:metric'],
    minimumSampleSize: 1, freshnessMaxAgeSeconds: 86400, decimalPlaces: 0
  };
  assert.throws(() => calculateJourneyMetric({
    definition: {
      ...common, metricType: 'csat', scale: { minimum: 1, maximum: 5, step: 1 }, direction: 'higher_is_better',
      formula: { kind: 'mean' }, favourable: { operator: 'lte', threshold: 2 }
    },
    period: { start: '2026-07-01T00:00:00.000Z', end: '2026-07-02T00:00:00.000Z', timezone: 'UTC' },
    asOf: '2026-07-02T00:00:00.000Z', samples: []
  }), (error) => error instanceof JourneyMetricConfigurationError && error.code === 'FAVOURABLE_DIRECTION_MISMATCH');
  assert.throws(() => calculateJourneyMetric({
    definition: {
      ...common, metricType: 'nps', scale: { minimum: 1, maximum: 5, step: 1 }, direction: 'higher_is_better',
      formula: { kind: 'net_promoter_score', detractorMaximum: 2, promoterMinimum: 4 }
    },
    period: { start: '2026-07-01T00:00:00.000Z', end: '2026-07-02T00:00:00.000Z', timezone: 'UTC' },
    asOf: '2026-07-02T00:00:00.000Z', samples: []
  }), (error) => error instanceof JourneyMetricConfigurationError && error.code === 'NPS_DEFINITION_INVALID');
});
