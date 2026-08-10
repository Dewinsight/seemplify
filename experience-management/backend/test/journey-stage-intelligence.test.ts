import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import {
  buildJourneyStageComparisons, buildJourneyStageTrends, exportJourneyStageComparisons, JourneyStageIntelligenceError,
  type JourneyStageIntelligenceFact
} from '../src/journeyStageIntelligence.js';

const sha = 'a'.repeat(64);
const base: Omit<JourneyStageIntelligenceFact, 'subjectKey' | 'dimensions'> = {
  spaceId: 'space-1', stageId: 'stage-consider', metricDefinitionId: 'metric-nps',
  metricDefinitionVersionId: 'metric-nps-v3', metricDefinitionVersionSha256: sha,
  metricName: 'Stage NPS', metricUnit: 'score', value: 40, sentiment: 'positive', emotions: ['trust'],
  occurredAt: '2026-08-02T12:00:00.000Z', consentState: 'granted', allowedPurposes: ['analytics'],
  retentionExpiresAt: '2027-08-02T12:00:00.000Z', deletedAt: null,
  lineage: { sourceType: 'survey', sourceId: 'survey-nps', sourceVersion: '12', schemaVersion: 'survey/v2',
    projectionVersion: 'journey-metric/v3' }
};

function fact(subjectKey: string, dimensions: JourneyStageIntelligenceFact['dimensions'],
  overrides: Partial<JourneyStageIntelligenceFact> = {}): JourneyStageIntelligenceFact {
  return { ...base, subjectKey, dimensions, ...overrides };
}

function run(facts: JourneyStageIntelligenceFact[], minimumSampleSize = 3) {
  return buildJourneyStageComparisons({ spaceId: 'space-1', actorSpaceId: 'space-1', actorRole: 'member',
    purpose: 'analytics', from: '2026-08-01T00:00:00.000Z', to: '2026-08-04T00:00:00.000Z',
    asOf: '2026-08-04T01:00:00.000Z', minimumSampleSize, facts });
}

test('compares stages across persona, segment, cohort and channel with exact deterministic lineage', () => {
  const facts = Array.from({ length: 6 }, (_, index) => fact(`subject-${index}`, {
    persona: ['buyer'], segment: [index < 3 ? 'enterprise' : 'smb'], cohort: ['august-signups'],
    channel: [index % 2 ? 'mobile' : 'web']
  }, { value: index * 10, sentiment: index < 2 ? 'negative' : index < 5 ? 'positive' : null,
    emotions: index < 2 ? ['frustration'] : index < 5 ? ['trust'] : [] }));
  const result = run(facts);
  assert.equal(result.schemaVersion, 'journey-stage-intelligence/v1');
  assert.equal(result.rows.length, 6);
  const persona = result.rows.find((row) => row.dimension === 'persona');
  assert.equal(persona?.sampleSize, 6);
  assert.equal(persona?.value, 25);
  assert.deepEqual(persona?.sentiment, { negative: 33.33, neutral: 0, positive: 50, mixed: 0, unknown: 16.67 });
  assert.equal(persona?.emotions.unknown, 16.67);
  assert.equal(persona?.metricDefinitionVersionSha256, sha);
  assert.deepEqual(persona?.window, { from: '2026-08-01T00:00:00.000Z', to: '2026-08-04T00:00:00.000Z',
    asOf: '2026-08-04T01:00:00.000Z' });
  assert.equal(persona?.lineage[0].projectionVersion, 'journey-metric/v3');
  assert.equal(persona?.lineage[0].sourceIdSha256.length, 64);
  assert.equal(JSON.stringify(persona?.lineage).includes('survey-nps'), false);
});

test('applies primary and deterministic complementary suppression without leaking a denominator', () => {
  const facts = [
    ...Array.from({ length: 2 }, (_, index) => fact(`small-${index}`, { segment: ['small'] })),
    ...Array.from({ length: 4 }, (_, index) => fact(`medium-${index}`, { segment: ['medium'] })),
    ...Array.from({ length: 7 }, (_, index) => fact(`large-${index}`, { segment: ['large'] }))
  ];
  const result = run(facts, 3);
  const small = result.rows.find((row) => row.dimensionId === 'small')!;
  const medium = result.rows.find((row) => row.dimensionId === 'medium')!;
  const large = result.rows.find((row) => row.dimensionId === 'large')!;
  assert.deepEqual(small.suppression, { suppressed: true, kind: 'primary', reason: 'BELOW_MINIMUM_SAMPLE',
    minimumSampleSize: 3 });
  assert.equal(medium.suppression.kind, 'secondary');
  assert.equal(large.suppression.suppressed, false);
  for (const hidden of [small, medium]) {
    assert.equal(hidden.sampleSize, null); assert.equal(hidden.value, null);
    assert.equal(hidden.sentiment.positive, null); assert.equal(hidden.emotions.trust, null);
    assert.deepEqual(hidden.lineage, []); assert.equal(hidden.lineageTruncated, false);
  }
});

test('filters denied consent, wrong purpose, expired retention, deletion, foreign tenants and the open interval', () => {
  const eligible = [fact('one', { cohort: ['retained'] }), fact('two', { cohort: ['retained'] }),
    fact('three', { cohort: ['retained'] })];
  const result = run([...eligible,
    fact('denied', { cohort: ['retained'] }, { consentState: 'denied' }),
    fact('purpose', { cohort: ['retained'] }, { allowedPurposes: ['research'] }),
    fact('expired', { cohort: ['retained'] }, { retentionExpiresAt: '2026-08-04T01:00:00.000Z' }),
    fact('deleted', { cohort: ['retained'] }, { deletedAt: '2026-08-03T00:00:00.000Z' }),
    fact('foreign', { cohort: ['retained'] }, { spaceId: 'space-2' }),
    fact('boundary', { cohort: ['retained'] }, { occurredAt: '2026-08-04T00:00:00.000Z' })]);
  assert.equal(result.rows[0].sampleSize, 3);
  assert.deepEqual(result.exclusions, { total: 6, suppressed: false });
  const oneExcluded = run([...eligible, fact('only-denied', { cohort: ['retained'] }, { consentState: 'denied' })]);
  assert.deepEqual(oneExcluded.exclusions, { total: null, suppressed: true });
  assert.throws(() => buildJourneyStageComparisons({ spaceId: 'space-1', actorSpaceId: 'space-2', actorRole: 'member',
    purpose: 'analytics', from: '2026-08-01T00:00:00.000Z', to: '2026-08-04T00:00:00.000Z',
    asOf: '2026-08-04T01:00:00.000Z', minimumSampleSize: 3, facts: eligible }),
  (error: unknown) => error instanceof JourneyStageIntelligenceError && error.status === 404);
});

test('repeated subject facts use one deterministic latest contribution and cannot inflate shares above 100 percent', () => {
  const repeated = [
    fact('same', { persona: ['buyer'] }, { occurredAt: '2026-08-02T09:00:00.000Z', sentiment: 'negative',
      emotions: ['frustration'], value: 10 }),
    fact('same', { persona: ['buyer'] }, { occurredAt: '2026-08-02T10:00:00.000Z', sentiment: 'positive',
      emotions: ['trust'], value: 90 }),
    fact('two', { persona: ['buyer'] }, { sentiment: 'positive', emotions: ['trust'], value: 60 }),
    fact('three', { persona: ['buyer'] }, { sentiment: 'neutral', emotions: [], value: 30 })
  ];
  const result = run(repeated); const row = result.rows[0];
  assert.equal(row.sampleSize, 3);
  assert.equal(row.value, 60);
  assert.deepEqual(row.sentiment, { negative: 0, neutral: 33.33, positive: 66.67, mixed: 0, unknown: 0 });
  assert.equal(Object.values(row.sentiment).reduce((sum, value) => sum + Number(value), 0), 100);
});

test('never infers sentiment or emotion from text-like source identities and fails closed on lineage conflict', () => {
  const unknown = run(Array.from({ length: 3 }, (_, index) => fact(`subject-${index}`, { persona: ['buyer'] },
    { sentiment: null, emotions: [], lineage: { ...base.lineage, sourceId: '=HYPERLINK("https://invalid.example")' } })));
  assert.equal(unknown.rows[0].sentiment.unknown, 100);
  assert.equal(unknown.rows[0].sentiment.neutral, 0);
  assert.equal(unknown.rows[0].emotions.unknown, 100);
  assert.throws(() => run([
    fact('one', { persona: ['buyer'] }),
    fact('two', { persona: ['buyer'] }, { metricDefinitionVersionSha256: 'b'.repeat(64) }),
    fact('three', { persona: ['buyer'] })
  ]), /lineage conflicts/u);
});

test('bounded exports consume only the suppressed projection and are formula safe', () => {
  const result = run([
    fact('small-1', { channel: ['=WEBSERVICE("https://invalid.example")'] }),
    fact('small-2', { channel: ['=WEBSERVICE("https://invalid.example")'] })
  ]);
  const csv = exportJourneyStageComparisons(result, 'csv');
  const text = csv.bytes.toString('utf8');
  assert.match(text, /'=WEBSERVICE/u);
  assert.doesNotMatch(text, /,2,40,/u);
  assert.equal(csv.suppressedRowCount, 1);
  const json = JSON.parse(exportJourneyStageComparisons(result, 'json').bytes.toString('utf8'));
  assert.equal(json.rows[0].sampleSize, null);
  assert.equal(json.rows[0].sentiment.positive, null);
  assert.throws(() => exportJourneyStageComparisons(result, 'csv', { maximumRows: 0 }), /row limit/u);
  assert.throws(() => exportJourneyStageComparisons(result, 'json', { maximumBytes: 100 }), /byte limit/u);
});

test('product-scale comparison remains bounded and deterministic', { timeout: 10_000 }, () => {
  const facts = Array.from({ length: 20_000 }, (_, index) => fact(`subject-${index}`, {
    persona: [`persona-${index % 20}`], segment: [`segment-${index % 40}`], cohort: [`cohort-${index % 12}`],
    channel: [`channel-${index % 8}`]
  }, { value: index % 101, sentiment: index % 3 === 0 ? 'negative' : 'positive',
    emotions: index % 3 === 0 ? ['frustration'] : ['trust'] }));
  const started = performance.now(); const first = run(facts, 30); const elapsed = performance.now() - started;
  const second = run(facts, 30);
  assert.equal(first.rows.length, 80);
  assert.equal(first.fingerprint, second.fingerprint);
  assert.ok(elapsed < 5_000, `comparison took ${elapsed.toFixed(0)}ms`);
  assert.equal(first.rows.every((row) => row.sampleSize !== null && row.sampleSize >= 30), true);
});

test('builds explicit independently suppressed sentiment and emotion trend buckets', () => {
  const trendFacts = [
    ...Array.from({ length: 3 }, (_, index) => fact(`early-${index}`, { persona: ['buyer'] }, {
      occurredAt: `2026-08-0${index + 1}T12:00:00.000Z`, sentiment: 'negative', emotions: ['frustration'], value: 20 })),
    ...Array.from({ length: 3 }, (_, index) => fact(`late-${index}`, { persona: ['buyer'] }, {
      occurredAt: `2026-08-0${index + 4}T12:00:00.000Z`, sentiment: 'positive', emotions: ['trust'], value: 80 }))
  ];
  const result = buildJourneyStageTrends({ spaceId: 'space-1', actorSpaceId: 'space-1', actorRole: 'member',
    purpose: 'analytics', from: '2026-08-01T00:00:00.000Z', to: '2026-08-08T00:00:00.000Z',
    asOf: '2026-08-08T01:00:00.000Z', minimumSampleSize: 3, dimensions: ['persona'], bucketDays: 3,
    facts: trendFacts });
  assert.equal(result.schemaVersion, 'journey-stage-trends/v1');
  assert.equal(result.buckets.length, 3);
  assert.equal(result.buckets[0].rows[0].sentiment.negative, 100);
  assert.equal(result.buckets[1].rows[0].sentiment.positive, 100);
  assert.equal(result.buckets[2].rows.length, 0, 'an empty bucket must remain explicit rather than becoming zero');
  assert.match(result.fingerprint, /^[a-f0-9]{64}$/u);
  assert.throws(() => buildJourneyStageTrends({ spaceId: 'space-1', actorSpaceId: 'space-1', actorRole: 'member',
    purpose: 'analytics', from: '2026-01-01T00:00:00.000Z', to: '2026-08-08T00:00:00.000Z',
    asOf: '2026-08-08T01:00:00.000Z', minimumSampleSize: 3, bucketDays: 1, facts: trendFacts }),
  /bucket limit/u);
});

test('trend buckets never use a broad-window sample to reveal a small period', () => {
  const trendFacts = [
    ...Array.from({ length: 2 }, (_, index) => fact(`early-${index}`, { cohort: ['retained'] }, {
      occurredAt: '2026-08-01T12:00:00.000Z' })),
    ...Array.from({ length: 4 }, (_, index) => fact(`late-${index}`, { cohort: ['retained'] }, {
      occurredAt: '2026-08-05T12:00:00.000Z' }))
  ];
  const result = buildJourneyStageTrends({ spaceId: 'space-1', actorSpaceId: 'space-1', actorRole: 'member',
    purpose: 'analytics', from: '2026-08-01T00:00:00.000Z', to: '2026-08-08T00:00:00.000Z',
    asOf: '2026-08-08T01:00:00.000Z', minimumSampleSize: 3, dimensions: ['cohort'], bucketDays: 4,
    facts: trendFacts });
  assert.equal(result.buckets[0].rows[0].suppression.kind, 'primary');
  assert.equal(result.buckets[0].rows[0].sampleSize, null);
  assert.equal(result.buckets[0].rows[0].sentiment.positive, null);
  assert.deepEqual(result.buckets[0].rows[0].lineage, []);
  assert.equal(result.buckets[1].rows[0].sampleSize, 4);
});
