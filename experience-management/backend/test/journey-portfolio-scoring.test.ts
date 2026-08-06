import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calculateJourneyPortfolioScore, JourneyPortfolioScoreError
} from '../src/journeyPortfolioScoring.js';

test('calculates an exact, explained RICE score', () => {
  const result = calculateJourneyPortfolioScore('rice', {
    reach: 2_000, impact: 3, confidence: 0.8, effort: 12
  });

  assert.deepEqual(result, {
    method: 'rice', formulaVersion: 'rice.v1', status: 'calculated', value: 400, missing: [],
    inputs: { reach: 2_000, impact: 3, confidence: 0.8, effort: 12 },
    formula: '(reach × impact × confidence) ÷ effort',
    explanation: 'RICE 400 using (reach × impact × confidence) ÷ effort; reach 2000, impact 3, confidence 0.8, effort 12. Confidence is represented as a 0–1 fraction.'
  });
});

test('calculates ICE with stable two-decimal rounding', () => {
  const result = calculateJourneyPortfolioScore('ice', { impact: 7.25, confidence: 0.67, ease: 6.5 });
  assert.equal(result.value, 31.57);
  assert.equal(result.formulaVersion, 'ice.v1');
  assert.match(result.explanation, /impact 7\.25, confidence 0\.67, ease 6\.5/u);
});

test('reports missing inputs instead of silently treating them as zero', () => {
  const result = calculateJourneyPortfolioScore('rice', { reach: 100, confidence: 0.5 });
  assert.equal(result.status, 'incomplete');
  assert.equal(result.value, null);
  assert.deepEqual(result.missing, ['impact', 'effort']);
  assert.deepEqual(result.inputs, { reach: 100, confidence: 0.5 });
});

test('accepts deliberate zero impact/reach/ease but rejects ambiguous or unsafe values', () => {
  assert.equal(calculateJourneyPortfolioScore('rice', {
    reach: 0, impact: 4, confidence: 1, effort: 2
  }).value, 0);
  assert.equal(calculateJourneyPortfolioScore('ice', {
    impact: 4, confidence: 1, ease: 0
  }).value, 0);

  for (const [field, input] of [
    ['confidence', { reach: 10, impact: 2, confidence: 80, effort: 1 }],
    ['effort', { reach: 10, impact: 2, confidence: 0.8, effort: 0 }],
    ['reach', { reach: -1, impact: 2, confidence: 0.8, effort: 1 }],
    ['ease', { impact: 2, confidence: 0.8, ease: Number.NaN }]
  ] as const) {
    const method = field === 'ease' ? 'ice' : 'rice';
    assert.throws(
      () => calculateJourneyPortfolioScore(method, input),
      (error) => error instanceof JourneyPortfolioScoreError && error.field === field
    );
  }
});

const weightedDimensions = [
  { key: 'value', label: 'Customer value', weight: 3, minimum: 0, maximum: 10, direction: 'higher_is_better' },
  { key: 'cost', label: 'Delivery cost', weight: 1, minimum: 0, maximum: 100, direction: 'lower_is_better' }
] as const;

test('normalises weighted dimensions to a 0-100 scale before applying weights', () => {
  const result = calculateJourneyPortfolioScore('weighted', {
    dimensions: { value: 10, cost: 0 }
  }, weightedDimensions);
  assert.equal(result.status, 'calculated');
  assert.equal(result.formulaVersion, 'weighted.v1');
  // Both dimensions sit at their best end, so every weight contributes in full.
  assert.equal(result.value, 100);

  // value 5/10 ascending = 0.5; cost 25/100 descending = 0.75.
  // ((0.5 * 3) + (0.75 * 1)) / 4 * 100 = 56.25
  assert.equal(calculateJourneyPortfolioScore('weighted', {
    dimensions: { value: 5, cost: 25 }
  }, weightedDimensions).value, 56.25);
});

test('honours weighted direction rather than treating every dimension as ascending', () => {
  const ascending = calculateJourneyPortfolioScore('weighted', { dimensions: { cost: 0 } }, [weightedDimensions[1]]);
  const descending = calculateJourneyPortfolioScore('weighted', { dimensions: { cost: 100 } }, [weightedDimensions[1]]);
  assert.equal(ascending.value, 100);
  assert.equal(descending.value, 0);
});

test('reports missing weighted dimensions instead of scoring a partial policy', () => {
  const result = calculateJourneyPortfolioScore('weighted', { dimensions: { value: 4 } }, weightedDimensions);
  assert.equal(result.status, 'incomplete');
  assert.equal(result.value, null);
  assert.deepEqual(result.missing, ['cost']);
  assert.deepEqual(result.inputs, { value: 4 });
});

test('rejects weighted policies and inputs that cannot produce a trustworthy score', () => {
  assert.throws(() => calculateJourneyPortfolioScore('weighted', { dimensions: {} }, []),
    (error) => error instanceof JourneyPortfolioScoreError && error.field === 'dimensions');

  const duplicated = [weightedDimensions[0], { ...weightedDimensions[0], label: 'Duplicate key' }];
  assert.throws(() => calculateJourneyPortfolioScore('weighted', { dimensions: { value: 1 } }, duplicated),
    (error) => error instanceof JourneyPortfolioScoreError && error.field === 'value');

  for (const broken of [
    { ...weightedDimensions[0], weight: 0 },
    { ...weightedDimensions[0], minimum: 10, maximum: 0 },
    { ...weightedDimensions[0], label: '   ' }
  ]) {
    assert.throws(() => calculateJourneyPortfolioScore('weighted', { dimensions: { value: 1 } }, [broken]),
      (error) => error instanceof JourneyPortfolioScoreError && error.code === 'JOURNEY_SCORE_OUT_OF_RANGE');
  }

  assert.throws(() => calculateJourneyPortfolioScore('weighted', { dimensions: { value: 11 } }, [weightedDimensions[0]]),
    (error) => error instanceof JourneyPortfolioScoreError && error.code === 'JOURNEY_SCORE_OUT_OF_RANGE');
  assert.throws(() => calculateJourneyPortfolioScore('weighted', { dimensions: { value: Number.NaN } }, [weightedDimensions[0]]),
    (error) => error instanceof JourneyPortfolioScoreError && error.code === 'JOURNEY_SCORE_NOT_FINITE');
});

test('is deterministic and does not mutate input', () => {
  const input = Object.freeze({ reach: 113, impact: 2.75, confidence: 0.73, effort: 8 });
  const first = calculateJourneyPortfolioScore('rice', input);
  const second = calculateJourneyPortfolioScore('rice', input);
  assert.deepEqual(first, second);
  assert.deepEqual(input, { reach: 113, impact: 2.75, confidence: 0.73, effort: 8 });
});
