import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertJourneyNativeMeasureSupported, completeJourneyNativeMeasureConfiguration,
  journeyNativeMetricFeature, journeyNativeMetricLineages, journeyNativeMetricPublic,
  journeyNativeMetricPublicSourceType, parseJourneyNativeMetricSource, JourneyNativeMetricSourceError,
  JOURNEY_NATIVE_METRIC_SOURCE_VERSION
} from '../src/journeyNativeMetricSources.js';
import {
  calculateJourneyOperationalMeasure, JourneyOperationalMeasureError,
  type JourneyOperationalMeasureDefinition, type JourneyOperationalObservation
} from '../src/journeyOperationalMeasures.js';

const ticketConfig = {
  configVersion: JOURNEY_NATIVE_METRIC_SOURCE_VERSION, adapter: 'service_recovery_tickets',
  adapterVersion: '1', sourceIds: ['survey-b', 'survey-a'], stageAssociation: null
};
const socialConfig = {
  configVersion: JOURNEY_NATIVE_METRIC_SOURCE_VERSION, adapter: 'social_mentions',
  adapterVersion: '1', sourceIds: ['connection-1'], stageAssociation: null
};

function code(run: () => unknown) {
  try { run(); } catch (value) {
    assert.ok(value instanceof JourneyNativeMetricSourceError, `expected a native source error, saw ${String(value)}`);
    return { code: value.code, status: value.status };
  }
  assert.fail('expected the native source contract to fail closed');
}

test('an absent discriminator leaves ordinary operational imports untouched', () => {
  // The regression control for every existing governed import: no
  // `nativeSource` key means no native behaviour at all, not a default adapter.
  assert.equal(parseJourneyNativeMetricSource(undefined), null);
  assert.equal(parseJourneyNativeMetricSource(null), null);
  assert.equal(parseJourneyNativeMetricSource(
    ({ label: 'Imported tickets' } as Record<string, unknown>).nativeSource), null);
});

test('the discriminator canonicalises its scope so the content hash is stable', () => {
  const parsed = parseJourneyNativeMetricSource(ticketConfig)!;
  assert.deepEqual(parsed.sourceIds, ['survey-a', 'survey-b']);
  assert.equal(parsed.stageAssociation, null);
  assert.deepEqual(parseJourneyNativeMetricSource({ ...ticketConfig, sourceIds: ['survey-a', 'survey-b'] })!.sourceIds,
    parsed.sourceIds);
  assert.equal(journeyNativeMetricPublicSourceType(parsed), 'native_service_recovery_ticket');
  assert.equal(journeyNativeMetricFeature(parsed), 'serviceRecovery');
  assert.equal(journeyNativeMetricFeature(parseJourneyNativeMetricSource(socialConfig)!), 'socialListening');
});

test('a malformed discriminator fails closed instead of falling back to the import path', () => {
  // Falling back would be an entitlement escalation: the ordinary import path
  // asserts `journeyConnected` while the native path asserts the source
  // feature, so an unparsed discriminator must never silently pick either.
  assert.equal(code(() => parseJourneyNativeMetricSource({ ...ticketConfig, adapter: 'invented_adapter' })).code,
    'JOURNEY_METRIC_NATIVE_ADAPTER_UNSUPPORTED');
  assert.equal(code(() => parseJourneyNativeMetricSource({ ...ticketConfig, configVersion: 'v0' })).code,
    'JOURNEY_METRIC_NATIVE_CONFIG_VERSION_UNSUPPORTED');
  assert.equal(code(() => parseJourneyNativeMetricSource({ ...ticketConfig, adapterVersion: '2' })).code,
    'JOURNEY_METRIC_NATIVE_ADAPTER_UNSUPPORTED');
  for (const sourceIds of [[], Array.from({ length: 21 }, (_, index) => `survey-${index}`), ['bad id'], [''], [7]]) {
    assert.equal(code(() => parseJourneyNativeMetricSource({ ...ticketConfig, sourceIds })).code,
      'JOURNEY_METRIC_NATIVE_CONFIG_INVALID', `sourceIds ${JSON.stringify(sourceIds)} must be refused`);
  }
  assert.equal(code(() => parseJourneyNativeMetricSource({ ...ticketConfig, sourceIds: ['a', 'a'] })).code,
    'JOURNEY_METRIC_NATIVE_CONFIG_INVALID');
  assert.equal(code(() => parseJourneyNativeMetricSource({ ...ticketConfig, surveyIds: ['a'] })).code,
    'JOURNEY_METRIC_NATIVE_CONFIG_INVALID');
  assert.equal(code(() => parseJourneyNativeMetricSource(['service_recovery_tickets'])).code,
    'JOURNEY_METRIC_NATIVE_CONFIG_INVALID');
});

test('an unguided stage mapping is refused; only a governed research link is accepted', () => {
  const governed = parseJourneyNativeMetricSource({ ...socialConfig,
    stageAssociation: { stageId: 'stage-1', via: 'research_link' } })!;
  assert.deepEqual(governed.stageAssociation, { stageId: 'stage-1', via: 'research_link' });
  assert.equal(code(() => parseJourneyNativeMetricSource({ ...socialConfig,
    stageAssociation: { stageId: 'stage-1', via: 'inferred' } })).code, 'JOURNEY_METRIC_NATIVE_STAGE_UNGOVERNED');
  assert.equal(code(() => parseJourneyNativeMetricSource({ ...socialConfig,
    stageAssociation: { stageId: 'stage-1', via: 'research_link', confidence: 0.9 } })).code,
  'JOURNEY_METRIC_NATIVE_CONFIG_INVALID');
});

test('lineage is derived from the pinned scope and never accepted from the caller', () => {
  const source = parseJourneyNativeMetricSource(ticketConfig)!;
  assert.deepEqual(journeyNativeMetricLineages(source).map((lineage) => lineage.sourceRef),
    ['seemplify-native:service_recovery_tickets:survey-a', 'seemplify-native:service_recovery_tickets:survey-b']);
  for (const lineage of journeyNativeMetricLineages(source)) {
    // The journey trio stays null: a native aggregate asserts no journey
    // instance, journey version or rule-set version.
    assert.equal(lineage.journeyId, null);
    assert.equal(lineage.journeyVersion, null);
    assert.equal(lineage.ruleSetVersion, null);
    assert.equal(lineage.schemaVersion, JOURNEY_NATIVE_METRIC_SOURCE_VERSION);
  }
  // A governed event-ingest lineage mixed into a native measure is refused
  // rather than quietly replaced.
  const conflict = code(() => completeJourneyNativeMeasureConfiguration(source, { kind: 'ticket_rate',
    label: 'Ticket rate', decimalPlaces: 1,
    sourceLineages: [{ sourceRef: 'journey-event:source-1:production', sourceVersion: '1', schemaVersion: '1',
      projectionVersion: '1', journeyId: null, journeyVersion: null, ruleSetVersion: null }] }));
  assert.equal(conflict.code, 'JOURNEY_METRIC_NATIVE_LINEAGE_INVALID');
  assert.equal(conflict.status, 422);
});

test('only measures the source facts support are accepted, with the adapter event vocabulary pinned', () => {
  const ticket = parseJourneyNativeMetricSource(ticketConfig)!;
  const social = parseJourneyNativeMetricSource(socialConfig)!;
  for (const kind of ['ticket_rate', 'repeat_contact_rate', 'recovery_rate'] as const) {
    const completed = completeJourneyNativeMeasureConfiguration(ticket, { kind, label: kind, decimalPlaces: 1 });
    assert.equal(completed.nativeSource, ticket);
    assert.equal((completed as Record<string, unknown>).subjectType, kind === 'ticket_rate' ? 'profile' : 'ticket');
  }
  for (const kind of ['sentiment_distribution', 'sentiment_trend'] as const) {
    assert.equal((completeJourneyNativeMeasureConfiguration(social,
      { kind, label: kind, decimalPlaces: 1 }) as Record<string, unknown>).subjectType, 'social_post');
  }
  // Cross-adapter and free-form measures fail closed rather than silently
  // producing an unsupported projection.
  for (const [source, kind] of [[ticket, 'sentiment_distribution'], [social, 'ticket_rate'],
    [ticket, 'custom_count'], [ticket, 'stage_entry'], [social, 'custom_duration']] as const) {
    assert.equal(code(() => completeJourneyNativeMeasureConfiguration(source,
      { kind, label: 'x', decimalPlaces: 1 })).code, 'JOURNEY_METRIC_NATIVE_MEASURE_UNSUPPORTED');
  }
  assert.equal(code(() => completeJourneyNativeMeasureConfiguration(ticket,
    { kind: 'ticket_rate', label: 'x', decimalPlaces: 1, ticketEventType: 'anything.i.like' })).code,
  'JOURNEY_METRIC_NATIVE_EVENT_MAP_INVALID');
  assert.equal(code(() => completeJourneyNativeMeasureConfiguration(ticket,
    { kind: 'recovery_rate', label: 'x', decimalPlaces: 1, subjectType: 'profile' })).code,
  'JOURNEY_METRIC_NATIVE_MEASURE_UNSUPPORTED');
});

test('the completed configuration calculates and its assertion is idempotent', () => {
  const source = parseJourneyNativeMetricSource(socialConfig)!;
  const period = { start: '2026-07-05T00:00:00.000Z', end: '2026-08-04T00:00:00.000Z', timezone: 'UTC' };
  const definition = { ...completeJourneyNativeMeasureConfiguration(source,
    { kind: 'sentiment_distribution', label: 'Native sentiment', decimalPlaces: 1 }),
  measureId: 'metric-1', definitionVersion: '1', minimumSampleSize: 1,
  freshnessMaxAgeSeconds: 86_400 } as unknown as JourneyOperationalMeasureDefinition;
  const lineage = journeyNativeMetricLineages(source)[0]!;
  const observation = (id: string, sentiment: 'positive' | 'negative' | 'unknown' | null):
  JourneyOperationalObservation => ({ observationId: `m.${id}`, revision: 1, sourceLineage: lineage,
    sourceRecordId: id, subjectId: id, subjectType: 'social_post', eventType: 'social.sentiment_observed',
    occurredAt: '2026-08-01T00:00:00.000Z', stageId: null, sentiment });
  const result = calculateJourneyOperationalMeasure({ definition, period, asOf: period.end,
    observations: [observation('a1', 'positive'), observation('b2', 'negative'),
      observation('c3', 'unknown'), observation('d4', null)] });
  // `mixed` arrives as `unknown` and stays in the denominator; only an absent or
  // unrecognised classification is excluded. Three posts are classified, so
  // each classified share is one third.
  const share = (key: string) => result.rows.find((row) => row.key === key)?.current;
  assert.equal(share('positive')?.denominator, 3);
  assert.equal(share('unknown')?.value, 33.3);
  assert.equal(result.exclusions.find((entry) => entry.reason === 'INVALID_SENTIMENT')?.count, 1);
  assert.doesNotThrow(() => assertJourneyNativeMeasureSupported(source, definition));
});

test('an unsupported measure kind fails closed rather than raising an opaque server error', () => {
  // `eventFields` previously fell out of its switch as `undefined` and the
  // caller's `.some(...)` raised a TypeError, which surfaced as a 500.
  assert.throws(() => calculateJourneyOperationalMeasure({
    definition: { kind: 'invented_measure', measureId: 'm', definitionVersion: '1', label: 'x',
      subjectType: 'social_post', decimalPlaces: 1, minimumSampleSize: 1, freshnessMaxAgeSeconds: 60,
      sourceLineages: [{ sourceRef: 'a', sourceVersion: '1', schemaVersion: '1', projectionVersion: '1',
        journeyId: null, journeyVersion: null, ruleSetVersion: null }] } as unknown as JourneyOperationalMeasureDefinition,
    period: { start: '2026-08-01T00:00:00.000Z', end: '2026-08-04T00:00:00.000Z', timezone: 'UTC' },
    asOf: '2026-08-04T00:00:00.000Z', observations: []
  }), (value: unknown) => value instanceof JourneyOperationalMeasureError
    && value.code === 'OPERATIONAL_KIND_UNSUPPORTED');
});

test('the published descriptor carries identities and counts, never source content', () => {
  const published = journeyNativeMetricPublic(parseJourneyNativeMetricSource({ ...ticketConfig,
    stageAssociation: { stageId: 'stage-9', via: 'research_link' } })!);
  assert.deepEqual(Object.keys(published).sort(), ['adapter', 'adapterVersion', 'configVersion', 'label',
    'sourceCount', 'sourceIds', 'sourceType', 'stageAssociationVia', 'stageId']);
  assert.equal(published.sourceCount, 2);
  assert.equal(published.sourceType, 'native_service_recovery_ticket');
  assert.match(published.label, /aggregate/iu);
});
