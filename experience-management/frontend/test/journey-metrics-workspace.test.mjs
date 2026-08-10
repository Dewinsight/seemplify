import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const sourceRoot = path.resolve(import.meta.dirname, '..', 'src');
const read = (...segments) => fs.readFileSync(path.join(sourceRoot, ...segments), 'utf8');
const client = read('lib', 'journeyMetrics.ts');
const page = read('pages', 'JourneyMetricsPage.tsx');
const backendRoutes = fs.readFileSync(path.resolve(sourceRoot, '..', '..', 'backend', 'src', 'journeyMetricRoutes.ts'), 'utf8');
const backendRepository = fs.readFileSync(path.resolve(sourceRoot, '..', '..', 'backend', 'src', 'journeyMetrics.ts'), 'utf8');

test('the strict client covers the permissioned metric workspace without caller-supplied tenant identity', () => {
  for (const suffix of [
    '/segments', '/bindings', '/definitions', '/versions', '/rebuilds', '/observations', '/lineage'
  ]) assert.ok(client.includes(suffix), `missing journey metric API resource ${suffix}`);
  assert.match(client, /class JourneyMetricResponseError/u);
  assert.match(client, /function exact\(/u);
  assert.match(client, /contains unexpected field/u);
  assert.match(client, /parseJourneyMetricObservation\(value: unknown, requireLineage = false\)/u);
  assert.match(client, /if \(requireLineage && !Array\.isArray\(row\.lineage\)\)/u);
  assert.match(client, /definition current version identity does not match/u);
  assert.match(client, /contentSha256 must be a SHA-256 digest/u);
  assert.match(client, /crypto\.randomUUID\(\)/u);
  assert.match(client, /headers: \{ 'Idempotency-Key': idempotencyKey \}/u);
  assert.doesNotMatch(client, /\(options\.headers as Record<string, string>\)\[/u,
    'mutation headers must be constructed rather than written through an undefined RequestInit.headers value');
  assert.match(client, /listJourneyMetricObservations\(scope: \{ journeyDefinitionId\?: string; definitionId\?: string \}/u);
  assert.match(client, /listJourneyMetricRebuilds\(scope: \{ journeyDefinitionId\?: string; definitionId\?: string \}/u);
  assert.doesNotMatch(client, /Promise\.all\(definitions\.map/u, 'journey-level metric reads must not fan out by definition');
  assert.doesNotMatch(client, /spaceId\??:/u, 'space identity must come from the authenticated API boundary');
});

test('journey-scoped observation and rebuild reads use one bounded tenant-safe backend query', () => {
  assert.match(backendRoutes, /definitionId: id\.optional\(\), journeyDefinitionId: id\.optional\(\)/u);
  assert.match(backendRoutes, /journeyDefinitionId: id\.optional\(\), \.\.\.page \}\)\.strict\(\)/u);
  assert.match(backendRepository, /definition\.id=observation\.definition_id AND definition\.space_id=observation\.space_id/u);
  assert.match(backendRepository, /definition\.id=run\.definition_id AND definition\.space_id=run\.space_id/u);
  assert.match(backendRepository, /definition\.journey_definition_id=\?/u);
});

test('members can inspect lineage while every mutation remains owner or administrator only', () => {
  assert.match(backendRoutes, /get\('\/observations\/:observationId\/lineage'[\s\S]*?context\(request\)/u);
  assert.doesNotMatch(backendRoutes, /get\('\/observations\/:observationId\/lineage'[\s\S]{0,160}?editor\(request\)/u);
  assert.match(page, /const canManage = Boolean\(session\?\.activeSpace && session\.activeSpace\.role !== 'member'\)/u);
  assert.match(page, /You have read-only access/u);
  assert.match(page, /readJourneyMetricObservationLineage/u);
  assert.match(page, /\{canManage && <Button onClick=\{\(\) => openMetric\(\)\}/u);
  assert.match(page, /\{canManage && <Button onClick=\{openBinding\}/u);
  assert.match(page, /\{canManage && <Button onClick=\{\(\) => openSegment\(\)\}/u);
});

test('analytics expose current, target, baseline, sample, window, freshness, overlays, comparisons and health', () => {
  for (const phrase of [
    'Current measures and comparisons', 'Baseline', 'Goal', 'Comparable change', 'Sample', 'Window', 'Freshness',
    'Stage and target overlay', 'Trends and exact observation table', 'Measurement health', 'Stage metric coverage',
    'Stage research coverage', 'Evidence coverage by stage'
  ]) assert.ok(page.includes(phrase), `missing metric analytics phrase ${phrase}`);
  assert.match(page, /row\.definitionVersionId === current\.definitionVersionId/u);
  assert.match(page, /row\.period\.start !== current\.period\.start \|\| row\.period\.end !== current\.period\.end/u);
  assert.match(page, /version\.direction === 'higher_is_better'/u);
  assert.match(page, /version\.direction === 'higher_is_better' \? 'Below target' : 'Above target'/u);
  assert.match(page, /minimumSampleWarning/u);
  assert.match(page, /freshnessStatus/u);
  assert.match(page, /type === 'touchpoint'/u);
  assert.match(page, /researchBackedCards/u);
  assert.match(page, /Neither state upgrades a hypothesis automatically/u);
});

test('each displayed measure opens the exact immutable definition version and source lineage', () => {
  assert.match(page, /function MetricNumberButton/u);
  assert.match(page, /Inspect definition and observation lineage/u);
  assert.match(page, /Promise\.all\(\[\s*readJourneyMetricObservationLineage\(observation\.id\), readJourneyMetricDefinition\(definition\.id\)/u);
  assert.match(page, /version\.id === exactObservation\.definitionVersionId/u);
  assert.match(page, /The immutable definition version for this observation is unavailable/u);
  assert.match(page, /Definition hash/u);
  assert.match(page, /Source revisions/u);
  assert.match(page, /sourceRevisionSha256/u);
});

test('controls provide versioned definitions, survey bindings, segments and rebuilds without inventing a source', () => {
  assert.match(page, /createJourneyMetricDefinitionVersion/u);
  assert.match(page, /surveyMetricVersion/u);
  assert.match(page, /createJourneyMetricBinding/u);
  assert.match(page, /updateJourneyMetricBinding/u);
  assert.match(page, /createJourneyMetricSegment/u);
  assert.match(page, /updateJourneyMetricSegment/u);
  assert.match(page, /queueJourneyMetricRebuild/u);
  assert.match(page, /Governed operational imports still require an authorised server source and a published schema\./u);
  assert.doesNotMatch(page, /mock metric|sample trend|demo observation/iu);
});

test('shipped native ticket and social adapters stay entitlement-gated, aggregate-only and distinct from an import', () => {
  // These adapters used to be absent, and the workspace said so. They now ship,
  // so the guarantee under test is no longer "nothing is offered" but "only an
  // authorised, content-free aggregate is offered".
  assert.match(client, /export const journeyNativeMetricAdapters = \['service_recovery_tickets', 'social_mentions'\] as const;/u);
  assert.match(client, /'\/api\/journey-metrics\/native-sources'/u);
  assert.match(client, /export function nativeMetricVersion\(/u);
  // The client builds a fixed, deterministic body: it pins the governed source
  // kind, sorts the pinned identities, and leaves the subject type and event
  // vocabulary to the server's adapter contract.
  assert.match(client, /sourceKind: 'operational_import', bindingId: null, calculatorKind: 'operational',/u);
  assert.match(client, /sourceIds: \[\.\.\.input\.sourceIds\]\.sort\(\),/u);
  assert.match(client, /subjectType: enumValue\(row\.subjectType, 'sentiment\.subjectType', \['social_post'\] as const\),/u);
  assert.match(client, /definitionVersion\.nativeSource is only valid on an operational source kind/u);
  assert.match(client, /nativeSource\.sourceCount must match the pinned source identities/u);

  // A native mode is only selectable where the space is both entitled and holds
  // at least one authorised source, and the catalogue is never fetched for a
  // member.
  assert.match(page, /nativeSources\?\.ticketsEntitled && nativeSources\.tickets\.length/u);
  assert.match(page, /nativeSources\?\.socialEntitled && nativeSources\.social\.length/u);
  assert.match(page, /if \(!enabled \|\| !canManage\) \{ setNativeSources\(null\); return; \}/u);
  assert.match(page, /listJourneyMetricNativeSources\(\)/u);
  assert.match(page, /data-testid="journey-metrics-native-sources"/u);

  // Content never reaches a measure, and native is never conflated with import.
  assert.match(page, /never\s+ticket notes, mention content, authors or profiles\./u);
  assert.match(page, /A native\s+definition never accepts an import, and an ordinary import is never reported as native\./u);
  assert.match(page, /a\s+measure is retracted rather than partly recomputed if one is later revoked or deleted\./u);
});

test('the workspace has contained responsive tables and exact text alternatives', () => {
  assert.match(page, /useSessionFeature\('journeyMetrics'\)/u);
  assert.match(page, /if \(!enabled\) return null/u);
  assert.match(page, /aria-label="Journey metric workspace sections"/u);
  assert.match(page, /role="img" aria-label=\{summary\}/u);
  assert.match(page, /text alternative for this trend/u);
  assert.ok((page.match(/overflow-x-auto/gu) || []).length >= 6, 'metric tables must be contained on narrow screens');
  assert.ok((page.match(/<caption className="sr-only"/gu) || []).length >= 6, 'metric tables need accessible captions');
  assert.doesNotMatch(page, /gradient|backdrop-blur|rounded-\[2/iu, 'the workspace stays within the existing calm product language');
  for (const [name, source] of [['journeyMetrics.ts', client], ['JourneyMetricsPage.tsx', page]]) {
    assert.doesNotMatch(source, /[\u00c2\u00c3]|\u00e2/u, `${name} contains a mis-decoded UTF-8 sequence`);
  }
});
