import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeAnalytics } from '../src/analytics.js';
import type { ResponseRecord, Survey } from '../src/types.js';

const survey = {
  id: 'survey', title: 'Test', description: '', purpose: 'customer_experience', audience: '', status: 'live', primaryMetric: 'nps', language: 'English', thankYouMessage: 'Thanks', theme: {}, settings: {}, createdAt: '', updatedAt: '', publishedAt: '',
  questions: [
    { id: 'nps', surveyId: 'survey', page: 1, position: 0, type: 'nps', title: 'Recommend?', description: '', required: true, options: [], settings: {}, logic: [] },
    { id: 'driver', surveyId: 'survey', page: 1, position: 1, type: 'rating', title: 'Easy?', description: '', required: true, options: [], settings: {}, logic: [] }
  ]
} satisfies Survey;
function response(id: string, nps: number, driver: number, analysis: any = null): ResponseRecord { return { id, surveyId: survey.id, collectorId: 'collector', respondentToken: id, status: 'completed', answers: { nps, driver }, metadata: {}, startedAt: '2026-07-01T00:00:00.000Z', completedAt: '2026-07-01T00:01:00.000Z', durationSeconds: 60, aiAnalysis: analysis, analyzedAt: analysis ? '2026-07-01T00:02:00.000Z' : null }; }

test('computes exact NPS, distributions, sentiment and key drivers', () => {
  const result = computeAnalytics(survey, [response('1', 10, 5, { sentiment: 'positive', topics: [{ name: 'Ease' }] }), response('2', 9, 4), response('3', 5, 1, { sentiment: 'negative', topics: [{ name: 'Friction' }] })]);
  assert.equal(result.metrics.nps, 33);
  assert.equal(result.metrics.promoters, 2);
  assert.equal(result.metrics.detractors, 1);
  assert.equal(result.totals.completionRate, 100);
  assert.equal(result.totals.analyzedResponses, 2);
  assert.equal(result.drivers[0].title, 'Easy?');
  assert.ok(result.drivers[0].correlation! > 0.9);
  assert.deepEqual(result.themes, [{ name: 'Ease', count: 1 }, { name: 'Friction', count: 1 }]);
});
