import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const sourceRoot = path.resolve(import.meta.dirname, '..', 'src');
const clientPath = path.join(sourceRoot, 'lib', 'journeySavedViews.ts');
const bar = fs.readFileSync(path.join(sourceRoot, 'components', 'journeys', 'JourneySavedViewBar.tsx'), 'utf8');

const bundled = await build({
  entryPoints: [clientPath], bundle: true, write: false, format: 'esm', platform: 'browser',
  alias: { '@': sourceRoot }, minify: false, logLevel: 'silent'
});
const client = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

const configuration = (overrides = {}) => ({
  schemaVersion: 1,
  binding: { policy: 'exact', versionId: 'version-1' },
  filters: {
    personaIds: [], segmentIds: [], cohortIds: [], channelIds: [], evidenceLinkIds: [],
    evidenceStates: [], cardKinds: [], laneKeys: [], timeWindow: null, ...(overrides.filters || {})
  },
  comparisonTarget: overrides.comparisonTarget ?? null,
  presentation: {
    density: 'comfortable', showEvidenceLegend: true, showResearchGaps: true,
    showEmptyLanes: true, title: '', ...(overrides.presentation || {})
  },
  ...(overrides.root || {})
});

const view = (overrides = {}) => ({
  id: 'view-1', definitionId: 'definition-1', name: 'Emotions only', visibility: 'private',
  ownerUserId: 'user-1', revision: 3, schemaVersion: 1, checksum: 'a'.repeat(64), state: 'active',
  config: configuration(), createdAt: '2026-08-05T10:00:00.000Z', updatedAt: '2026-08-05T10:00:00.000Z',
  deletedAt: null, retentionExpiresAt: null, ...overrides
});

const mapEnvelope = () => ({
  definition: {
    id: 'definition-1', spaceId: 'space-1', legacyJourneyId: null, name: 'Renewal', purpose: '',
    experienceType: 'customer', mapType: 'current_state', mode: 'designed', status: 'draft',
    ownerUserId: 'user-1', currentVersionId: 'version-1', publishedVersionId: null, reviewCadenceDays: 30,
    revision: 2, stageCount: 1, cardCount: 1, evidenceLinkCount: 0, personaCount: 0,
    createdAt: '2026-08-05T10:00:00.000Z', updatedAt: '2026-08-05T10:00:00.000Z'
  },
  version: {
    id: 'version-1', versionNumber: 1, schemaVersion: 1, state: 'draft', authorUserId: 'user-1',
    sourceJobId: null, publishedAt: null, createdAt: '2026-08-05T10:00:00.000Z', mapType: 'current_state',
    mode: 'designed', experienceType: 'customer', objective: '', industry: '', summary: '',
    legacyAudience: '', provenance: {}
  },
  stages: [{ id: 'stage-1', stageKey: 'discover', name: 'Discover', goal: '', description: '', ordinal: 0 }],
  lanes: [{ id: 'lane-1', laneType: 'emotions', title: 'Emotions', description: '', ordinal: 0, visible: true }],
  cards: [{
    id: 'card-1', stageKey: 'discover', laneType: 'emotions', kind: 'emotion', title: 'Anxious',
    content: '', ordinal: 0, personaId: null, status: 'active', origin: 'workspace',
    evidence: { state: 'hypothesis', supporting: 0, contradicting: 0, neutral: 0, stale: 0, inaccessible: 0, reason: '' },
    evidenceLinkCount: 0, createdAt: '2026-08-05T10:00:00.000Z', updatedAt: '2026-08-05T10:00:00.000Z'
  }],
  personas: [],
  versions: [{
    id: 'version-1', versionNumber: 1, schemaVersion: 1, state: 'draft', authorUserId: 'user-1',
    sourceJobId: null, publishedAt: null, createdAt: '2026-08-05T10:00:00.000Z'
  }],
  researchGaps: [{
    stageKey: 'discover', stageName: 'Discover', laneType: 'emotions', cardId: 'card-1',
    cardTitle: 'Anxious', state: 'hypothesis', reason: 'No evidence linked.'
  }],
  evidenceSummary: { hypothesis: 1 }
});

test('the saved-view configuration parser enforces the exact stored contract', () => {
  assert.deepEqual(client.parseJourneySavedViewConfiguration(configuration()).binding,
    { policy: 'exact', versionId: 'version-1' });
  // An unknown key means the browser and server disagree about the schema.
  assert.throws(() => client.parseJourneySavedViewConfiguration(configuration({ root: { extra: 1 } })),
    /Invalid saved-view configuration response shape/u);
  assert.throws(() => client.parseJourneySavedViewConfiguration(
    configuration({ root: { binding: { policy: 'exact', versionId: null } } })), /binding shape/u);
  assert.throws(() => client.parseJourneySavedViewConfiguration(
    configuration({ root: { binding: { policy: 'follows_current', versionId: 'version-1' } } })), /binding shape/u);
  assert.throws(() => client.parseJourneySavedViewConfiguration(configuration({
    filters: { timeWindow: { from: '2026-08-05T12:00:00.000Z', to: '2026-08-05T10:00:00.000Z', timezone: 'UTC' } }
  })), /Invalid time window response/u);
  assert.throws(() => client.parseJourneySavedViewConfiguration(configuration({
    filters: { personaIds: ['persona-1', 'persona-1'] }
  })), /Invalid persona filters response/u);
  assert.throws(() => client.parseJourneySavedViewConfiguration(configuration({
    filters: { cardKinds: ['not_a_card_kind'] }
  })), /Invalid card-kind filters response/u);
});

test('an unavailable saved view can never carry configuration or a checksum to the browser', () => {
  const list = client.parseJourneySavedViewList({
    views: [{ ...view({ id: 'view-2' }), config: null, checksum: null, availability: 'unavailable' }],
    selected: null, unavailableCount: 1,
    settings: { enabled: true, retentionDays: 30, revision: 1, updatedAt: '2026-08-05T10:00:00.000Z' },
    limits: { nameCharacters: 160, referencesPerKind: 50, configurationBytes: 32768,
      presentationTitleCharacters: 200, retentionDays: { minimum: 1, maximum: 3650 } }
  });
  assert.equal(list.views[0].availability, 'unavailable');
  assert.equal(list.views[0].config, null);
  // A server that marks a view unavailable but still ships its configuration is
  // leaking references the caller was told it may not resolve.
  assert.throws(() => client.parseJourneySavedViewList({
    views: [{ ...view({ id: 'view-2' }), checksum: null, availability: 'unavailable' }],
    selected: null, unavailableCount: 1,
    settings: { enabled: true, retentionDays: 30, revision: 1, updatedAt: null },
    limits: { nameCharacters: 160, referencesPerKind: 50, configurationBytes: 32768,
      presentationTitleCharacters: 200, retentionDays: { minimum: 1, maximum: 3650 } }
  }), /Unavailable saved view leaked configuration/u);
});

test('the resolved saved-view envelope is parsed exactly and rejects drift in the map contract', () => {
  const resolved = client.parseJourneySavedViewResolved({
    view: view(), map: mapEnvelope(), comparisonMap: null,
    analytics: { applied: { segmentIds: [], cohortIds: [], timeWindow: null }, segments: [], observations: [], truncated: false }
  });
  assert.equal(resolved.view.revision, 3);
  assert.deepEqual(resolved.map.cards.map((card) => card.id), ['card-1']);
  assert.deepEqual(resolved.map.researchGaps.map((gap) => gap.cardId), ['card-1']);
  // Server-only tenancy fields are parsed but must not reach view components.
  assert.equal('spaceId' in resolved.map.definition, false);

  const drifted = mapEnvelope();
  drifted.version.unexpectedField = 'added by a future server';
  assert.throws(() => client.parseJourneySavedViewResolved({
    view: view(), map: drifted, comparisonMap: null,
    analytics: { applied: { segmentIds: [], cohortIds: [], timeWindow: null }, segments: [], observations: [], truncated: false }
  }), /Invalid saved-view map version response shape/u);

  assert.throws(() => client.parseJourneySavedViewResolved({
    view: { ...view(), config: null, checksum: null, availability: 'unavailable' },
    map: mapEnvelope(), comparisonMap: null,
    analytics: { applied: { segmentIds: [], cohortIds: [], timeWindow: null }, segments: [], observations: [], truncated: false }
  }), /resolved saved view cannot be unavailable/u);
});

const observation = (overrides = {}) => ({
  id: 'observation-1', metricDefinitionId: 'metric-1', metricName: 'Renewal NPS', segmentId: 'segment-1',
  revision: 1, status: 'available', value: 42, unit: 'nps_score', sampleSize: 40,
  period: { from: '2026-07-01T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z', timezone: 'UTC' },
  freshnessStatus: 'fresh', minimumSampleWarning: false,
  privacy: { suppressed: false, reasonCode: null, minimumSampleSize: 5, privacyVersion: 1 },
  ...overrides
});
const analytics = (observations) => ({
  applied: { segmentIds: [], cohortIds: [], timeWindow: null }, segments: [], observations, truncated: false
});
const resolve = (observations) => client.parseJourneySavedViewResolved({
  view: view(), map: mapEnvelope(), comparisonMap: null, analytics: analytics(observations)
});

test('saved-view analytics carry the privacy decision and fail closed on a leaking response', () => {
  const suppressed = observation({
    value: null, sampleSize: null, minimumSampleWarning: true,
    privacy: { suppressed: true, reasonCode: 'SMALL_SAMPLE_SUPPRESSED', minimumSampleSize: 30, privacyVersion: 1 }
  });
  const parsed = resolve([observation(), suppressed]);
  assert.deepEqual(parsed.analytics.observations.map((row) => row.sampleSize), [40, null]);
  assert.equal(parsed.analytics.observations[1].privacy.reasonCode, 'SMALL_SAMPLE_SUPPRESSED');
  // The warning state carries no count, so it survives suppression.
  assert.equal(parsed.analytics.observations[1].minimumSampleWarning, true);

  // A backend regression that claims suppression while still disclosing the
  // measure must fail here rather than reach a component and render.
  for (const leak of [{ value: 42 }, { sampleSize: 40 }]) {
    assert.throws(() => resolve([{ ...suppressed, ...leak }]),
      /Invalid saved-view metric observation response shape/u);
  }
  const withoutPrivacy = observation();
  delete withoutPrivacy.privacy;
  assert.throws(() => resolve([withoutPrivacy]), /Invalid saved-view metric observation response shape/u);
  assert.throws(() => resolve([observation({ privacy: { suppressed: false, reasonCode: 'INVENTED_REASON',
    minimumSampleSize: 5, privacyVersion: 1 } })]), /Invalid metric observation privacy reason response/u);
});

test('the saved-view editor commits the mode it was opened in, never the current selection', () => {
  // Regression guard: the primary action used to be chosen from selection
  // state, so "Save current" opened a blank editor whose button overwrote the
  // selected view with a default configuration.
  assert.match(bar, /const \[mode, setMode\] = useState<'new' \| 'edit'>\('new'\)/u);
  assert.match(bar, /mode === 'edit' && availableSelected && canManageSelected\s*\n?\s*\? <Button[\s\S]{0,200}saveChanges\(\)/u);
  assert.match(bar, /if \(mode !== 'edit' \|\| !availableSelected \|\| !canManageSelected\) return;/u);
  assert.match(bar, /<DialogTitle>\{mode === 'edit' \? 'Edit saved view' : 'Save journey view'\}<\/DialogTitle>/u);
  // The destructive retention control must not appear while creating a view.
  assert.match(bar, /\{mode === 'edit' && availableSelected && canManageSelected && <div className="border-t pt-3">/u);
});
