import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const sourceRoot = path.resolve(import.meta.dirname, '..', 'src');
const page = fs.readFileSync(path.join(sourceRoot, 'pages', 'JourneyMetricsPage.tsx'), 'utf8');

const bundled = await build({
  entryPoints: [path.join(sourceRoot, 'lib', 'journeyMetrics.ts')], bundle: true, write: false, format: 'esm',
  platform: 'browser', alias: { '@': sourceRoot }, minify: false, logLevel: 'silent'
});
const client = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

const period = { start: '2026-08-01T00:00:00.000Z', end: '2026-08-04T00:00:00.000Z', timezone: 'UTC' };
const published = {
  id: 'o1', definitionId: 'd1', definitionVersionId: 'v1', revision: 1, supersedesObservationId: null,
  status: 'available', value: 42, unit: 'nps_score', numerator: 21, denominator: 50, sampleSize: 50,
  period, asOf: period.end, calculatedAt: period.end, freshnessStatus: 'fresh', latestObservedAt: period.start,
  minimumSampleWarning: false, sourceCount: 50, result: { formula: 'nps' }, sentiment: null,
  privacy: { suppressed: false, reasonCode: null, minimumSampleSize: 30, privacyVersion: 1 },
  rebuildRunId: null
};
const suppressed = {
  ...published, id: 'o2', value: null, numerator: null, denominator: null, sampleSize: null, sourceCount: null,
  minimumSampleWarning: true, sentiment: null,
  privacy: { suppressed: true, reasonCode: 'SMALL_SAMPLE_SUPPRESSED', minimumSampleSize: 30, privacyVersion: 1 }
};

test('the observation parser accepts published and suppressed shapes', () => {
  const open = client.parseJourneyMetricObservation(published);
  assert.equal(open.value, 42);
  assert.equal(open.sampleSize, 50);
  assert.equal(open.privacy.suppressed, false);

  const shut = client.parseJourneyMetricObservation(suppressed);
  assert.equal(shut.value, null);
  assert.equal(shut.denominator, null);
  assert.equal(shut.sampleSize, null);
  assert.equal(shut.sourceCount, null);
  assert.equal(shut.privacy.reasonCode, 'SMALL_SAMPLE_SUPPRESSED');
});

test('the parser fails closed when a suppressed observation still carries a number', () => {
  // Each of these is a backend regression that would leak exactly what the
  // suppression flag promised to protect, so the client refuses the response
  // rather than rendering it.
  for (const [field, value] of [['value', 42], ['numerator', 21], ['denominator', 50],
    ['sampleSize', 50], ['sourceCount', 50]]) {
    assert.throws(() => client.parseJourneyMetricObservation({ ...suppressed, [field]: value }),
      new RegExp(`suppressed observation must not disclose ${field}`, 'u'), `${field} must be refused`);
  }
  assert.throws(() => client.parseJourneyMetricObservation({ ...suppressed,
    sentiment: { kind: 'sentiment_trend', rows: [{ key: 'positive', label: 'Positive', currentValue: 70,
      currentUnit: 'percent', previousValue: null, changeValue: null, changeUnit: null }],
    period: null, comparisonPeriod: null, formula: null, subjectType: 'social_post', aggregateOnly: true } }),
  /must not disclose a sentiment lane/u);
  assert.throws(() => client.parseJourneyMetricObservation({ ...suppressed,
    lineage: [{ sourceType: 'survey_response', sourceRecordId: 'response-1',
      sourceRevisionSha256: 'a'.repeat(64), occurredAt: period.start, included: true, exclusionCode: null }] }),
  /must not disclose per-record lineage/u);
});

test('the parser rejects unknown observation fields so a silent contract change cannot pass', () => {
  assert.throws(() => client.parseJourneyMetricObservation({ ...published, explanation: '3 of 4 were promoters' }),
    /unexpected field explanation/u);
  assert.throws(() => client.parseJourneyMetricObservation({ ...published, privacy: undefined }),
    /observation.privacy must be an object/u);
});

test('a sentiment lane must be aggregate only and carries labelled shares', () => {
  const lane = { kind: 'sentiment_trend', rows: [
    { key: 'negative', label: 'Negative', currentValue: 10, currentUnit: 'percent', previousValue: 12,
      changeValue: -2, changeUnit: 'percentage_points' },
    { key: 'positive', label: 'Positive', currentValue: 70, currentUnit: 'percent', previousValue: 60,
      changeValue: 10, changeUnit: 'percentage_points' }
  ], period, comparisonPeriod: null, formula: 'current minus comparison', subjectType: 'social_post',
  aggregateOnly: true };
  const parsed = client.parseJourneyMetricObservation({ ...published, sentiment: lane });
  assert.equal(parsed.sentiment.rows.length, 2);
  assert.equal(parsed.sentiment.rows[0].label, 'Negative');
  assert.equal(parsed.sentiment.rows[1].changeValue, 10);
  // A lane that is not aggregate-only would be individual social posts drawn as
  // a customer path.
  assert.throws(() => client.parseJourneyMetricObservation({ ...published,
    sentiment: { ...lane, aggregateOnly: false } }), /must be aggregate only/u);
  assert.throws(() => client.parseJourneyMetricObservation({ ...published,
    sentiment: { ...lane, subjectType: 'profile' } }), /subjectType is not an allowed value/u);
});

test('applied filters parse exactly and echo the selection semantics', () => {
  const applied = {
    journeyDefinitionId: 'j1', definitionId: null,
    window: { from: period.start, to: period.end }, targetTypes: ['stage', 'segment'],
    personas: [{ id: 'p1', name: 'Buyer' }], segments: [{ id: 's1', name: 'Enterprise' }], channels: [],
    cohortsSupported: false, selection: 'materialised_authorised_observations',
    limit: 100, offset: 0, truncated: true
  };
  const parsed = client.parseJourneyMetricAppliedFilters(applied);
  assert.equal(parsed.selection, 'materialised_authorised_observations');
  assert.equal(parsed.cohortsSupported, false);
  assert.equal(parsed.truncated, true);
  assert.deepEqual(parsed.segments, [{ id: 's1', name: 'Enterprise' }]);
  // Claiming live recomputation is not an accepted value.
  assert.throws(() => client.parseJourneyMetricAppliedFilters({ ...applied, selection: 'recomputed' }),
    /selection is not an allowed value/u);
  assert.throws(() => client.parseJourneyMetricAppliedFilters({ ...applied, cohorts: [] }),
    /unexpected field cohorts/u);
});

test('the analytics workspace renders suppressed states, a sentiment lane and governed export controls', () => {
  // Suppressed measures must never fall back to a raw number in any cell.
  // Every site that formats a sample or source count must either route through
  // the suppression helpers or carry an explicit null guard on the same line.
  assert.match(page, /function suppressedCount\(/u);
  assert.match(page, /function suppressedMetric\(/u);
  const countSites = [...page.matchAll(/(sampleSize|sourceCount)\.toLocaleString\(\)/gu)];
  assert.ok(countSites.length > 0, 'expected at least one count rendering site');
  for (const site of countSites) {
    // JSX wraps, so the guard may sit on the preceding line; look back a short
    // window rather than only at the matched line.
    const context = page.slice(Math.max(0, site.index - 220), site.index);
    assert.ok(/=== null \?|suppressedCount\(/u.test(context),
      `unguarded count rendering near: ${page.slice(site.index - 60, site.index + 40).replace(/\n/gu, ' ')}`);
  }
  // The raw formatter must not be reachable for a value that may be suppressed.
  assert.equal(/\{formatMetric\(current\?\.value/u.test(page), false);
  assert.equal(/\{formatMetric\(observation\.value/u.test(page), false);

  // The filter echo is rendered from the server response, not the local draft.
  assert.match(page, /appliedFilters\.segments\.length/u);
  assert.match(page, /appliedFilters\.personas\.length/u);
  assert.match(page, /not recomputed when you change a filter/u);
  assert.match(page, /no governed cohort catalogue/u);
  assert.match(page, /appliedFilters\.truncated/u);

  // Sentiment lane: chart plus an exact table alternative, aggregate only.
  assert.match(page, /function SentimentLane\(/u);
  assert.match(page, /role="img"/u);
  assert.match(page, /the text alternative to the chart/u);
  // The lane carries one shared privacy notice rather than a bespoke sentence,
  // and that notice now also promises authors and post content are never read.
  assert.match(page, /Individual posts are never shown\. \{NATIVE_SOCIAL_NOTICE\}/u);
  assert.match(page, /const NATIVE_SOCIAL_NOTICE = 'Aggregate shares of authorised social posts only\./u);
  assert.match(page, /authors and post content are never read into a measure, and a social measure is not an individual customer path\./u);

  // Governed export controls, gated on the export entitlement.
  assert.match(page, /downloadJourneyMetricAnalyticsExport/u);
  assert.match(page, /exportsEnabled && /u);
  assert.match(page, /journeyMetricAnalyticsExportFormats\.map/u);

  // Responsive: a stacked non-scrolling alternative exists beside the wide table.
  assert.match(page, /journey-metrics-current-stacked/u);
  assert.match(page, /divide-y lg:hidden/u);
  assert.match(page, /hidden overflow-x-auto lg:block/u);
});
