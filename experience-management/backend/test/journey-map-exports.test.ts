import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import {
  buildJourneyMapExport, formulaSafeCsvCell, JOURNEY_MAP_EXPORT_SCHEMA, sanitizeJourneyMapForExport
} from '../src/journeyMapExports.js';
import type { JourneyMapReadModel } from '../src/journeyMaps.js';
import type { JourneyRichMapSnapshot } from '../src/journeyRichCards.js';

const generatedAt = '2026-08-04T12:00:00.000Z';

function evidence(state: JourneyMapReadModel['cards'][number]['evidence']['state'] = 'hypothesis', overrides = {}) {
  return {
    state, supporting: 0, contradicting: 0, neutral: 0, stale: 0, inaccessible: 0,
    reason: state === 'hypothesis' ? 'no_evidence_attached' : 'single_qualitative_source',
    ...overrides
  };
}

function fixture(options: { empty?: boolean; large?: boolean; formulas?: boolean } = {}): JourneyMapReadModel {
  const formulas = Boolean(options.formulas);
  const stages = options.empty ? [] : [
    { id: 'stage-two-id', stageKey: 'stage-two', name: 'Use', goal: 'Complete the job', description: '', ordinal: 1 },
    { id: 'stage-one-id', stageKey: 'stage-one', name: formulas ? '\n=HYPERLINK("https://bad")' : 'Discover', goal: 'Find the service', description: '', ordinal: 0 }
  ];
  const lanes = [
    { id: 'lane-emotions', laneType: 'emotions' as const, title: 'Emotions', description: '', ordinal: 2, visible: true },
    { id: 'lane-actions', laneType: 'customer_actions' as const, title: 'Customer actions', description: '', ordinal: 0, visible: true }
  ];
  const cards: JourneyMapReadModel['cards'] = options.empty ? [] : [
    {
      id: 'card-three', stageKey: 'stage-two', laneType: 'customer_actions', kind: 'action',
      title: 'Complete checkout', content: 'Confirm details', ordinal: 0, personaId: null,
      status: 'active', origin: 'workspace', evidence: evidence(), evidenceLinkCount: 0,
      createdAt: generatedAt, updatedAt: generatedAt
    },
    {
      id: 'card-two', stageKey: 'stage-one', laneType: 'emotions', kind: 'emotion',
      title: formulas ? '@SUM(1+1)' : 'Curious', content: formulas ? '\t+cmd|test' : 'Customer wants clear options',
      ordinal: 0, personaId: null, status: 'active', origin: 'workspace',
      evidence: evidence('hypothesis', {
        inaccessible: 3, reason: 'all_links_inaccessible', sourceRef: 'private-source', excerpt: 'never export me'
      }), evidenceLinkCount: 3, createdAt: generatedAt, updatedAt: generatedAt
    } as JourneyMapReadModel['cards'][number],
    {
      id: 'card-one', stageKey: 'stage-one', laneType: 'customer_actions', kind: 'action',
      title: 'Compare options', content: 'Read the product page', ordinal: 0, personaId: 'persona-id',
      status: 'active', origin: 'workspace',
      evidence: evidence('anecdotal', { supporting: 1 }), evidenceLinkCount: 1,
      createdAt: generatedAt, updatedAt: generatedAt
    }
  ];
  if (options.large) {
    for (let index = 0; index < 48; index += 1) cards.push({
      id: `large-card-${index}`, stageKey: index % 2 ? 'stage-two' : 'stage-one',
      laneType: index % 3 ? 'customer_actions' : 'emotions', kind: index % 3 ? 'action' : 'emotion',
      title: `Large map card ${String(index).padStart(2, '0')}`,
      content: `This deliberately long card forces deterministic pagination while remaining within the bounded export model. ${'Detail '.repeat(25)}`,
      ordinal: index + 1, personaId: null, status: 'active', origin: 'workspace',
      evidence: evidence(index % 2 ? 'supported' : 'hypothesis', index % 2 ? { supporting: 2 } : {}),
      evidenceLinkCount: index % 2 ? 2 : 0, createdAt: generatedAt, updatedAt: generatedAt
    });
  }
  return {
    definition: {
      id: '11111111-2222-4333-8444-555555555555', spaceId: 'private-space-id', legacyJourneyId: null,
      name: formulas ? '=WEBSERVICE("https://bad")' : 'Customer onboarding', purpose: 'Understand onboarding',
      experienceType: 'customer', mapType: 'current_state', mode: 'designed', status: 'draft',
      ownerUserId: 'private-owner-id', currentVersionId: 'private-version-id', publishedVersionId: null,
      reviewCadenceDays: 90, revision: 1, stageCount: stages.length, cardCount: cards.length,
      evidenceLinkCount: 1, personaCount: 1, createdAt: generatedAt, updatedAt: generatedAt
    },
    version: {
      id: 'private-version-id', versionNumber: 3, schemaVersion: 2, state: 'draft',
      authorUserId: 'private-author-id', sourceJobId: 'private-source-job-id', publishedAt: null,
      createdAt: generatedAt, mapType: 'current_state', mode: 'designed', experienceType: 'customer',
      objective: 'Reduce effort', industry: 'Services', summary: 'A governed export fixture.',
      legacyAudience: 'Legacy audience', provenance: { secret: 'never export provenance' }
    },
    stages,
    lanes,
    cards,
    personas: [{
      id: 'persona-id', name: 'New customer', summary: 'Needs confidence', lifecycleState: 'active',
      ownerUserId: 'private-persona-owner-id', source: 'workspace', attributes: { Segment: 'New' },
      goals: ['Start quickly'], behaviours: ['Compares options'], needs: ['Clarity'], barriers: ['Complexity'],
      reviewAt: null, revision: 1, createdAt: generatedAt, updatedAt: generatedAt
    }],
    versions: [], researchGaps: [], evidenceSummary: {
      hypothesis: cards.filter((card) => card.evidence.state === 'hypothesis').length,
      anecdotal: cards.filter((card) => card.evidence.state === 'anecdotal').length,
      supported: cards.filter((card) => card.evidence.state === 'supported').length,
      strongly_supported: 0, contradicted: 0, stale: 0, invalidated: 0
    }
  };
}

function richFixture(map: JourneyMapReadModel): JourneyRichMapSnapshot {
  const card = map.cards.find((item) => item.id === 'card-two')!;
  return {
    definitionId: map.definition.id,
    versionId: map.version.id,
    cards: [{
      cardId: card.id, revision: 2,
      richText: { version: 1, blocks: [
        { type: 'heading', text: 'Payment confidence', marks: [{ type: 'bold', start: 0, end: 7 }] },
        { type: 'bullet', text: 'Explain the final charge', marks: [
          { type: 'link', start: 0, end: 7, href: 'https://private.example.test/signed?token=secret' }
        ] }
      ] },
      plainText: 'Payment confidence\nExplain the final charge',
      emotion: { valence: -3, intensity: 4, label: 'Uncertain' },
      touchpoints: [{
        id: 'private-touchpoint-id', spaceId: 'private-space-id', status: 'active', revision: 2,
        versionId: 'private-touchpoint-version-id', versionNumber: 2, name: 'Checkout', description: 'Confirm payment',
        channel: { id: 'private-channel-id', versionId: 'private-channel-version-id', versionNumber: 3,
          name: 'Website', category: 'web' }, createdAt: generatedAt, updatedAt: generatedAt
      }],
      assets: [{
        id: 'private-asset-id', cardId: card.id, kind: 'image', sourceKind: 'upload', displayName: 'Checkout state.png',
        mimeType: 'image/png', byteSize: 4120, sha256: 'a'.repeat(64), altText: 'Checkout confirmation state',
        caption: 'The confirmation screen', externalUrl: null, contentUrl: '/api/private/content', ordinal: 0,
        state: 'active', deletedAt: null, retentionExpiresAt: null, createdAt: generatedAt
      }],
      updatedAt: generatedAt
    }],
    emotionalCurve: [{
      cardId: card.id, stageKey: card.stageKey, stageName: 'Discover', stageOrdinal: 0, cardOrdinal: card.ordinal,
      valence: -3, intensity: 4, label: 'Uncertain'
    }],
    catalog: { channels: [], touchpoints: [] },
    limits: {
      richTextBlocks: 40, richTextCharacters: 8000, richTextMarksPerBlock: 20, blockCharacters: 2000,
      catalogNameCharacters: 120, catalogDescriptionCharacters: 1000, touchpointsPerCard: 8, assetsPerCard: 8,
      imagesPerCard: 4, imageBytes: 10485760, attachmentBytes: 26214400, assetBytesPerCard: 52428800,
      assetNameCharacters: 255, altTextCharacters: 500, captionCharacters: 1000, externalUrlCharacters: 2048,
      deletedAssetRetentionDays: 30
    }
  };
}

test('sanitization preserves stage, lane, and card ordering without leaking internal or inaccessible evidence fields', async () => {
  const unsafe = fixture();
  unsafe.cards[0].content = 'x'.repeat(5_000);
  const safe = sanitizeJourneyMapForExport(unsafe);
  assert.deepEqual(safe.stages.map((stage) => stage.stageKey), ['stage-one', 'stage-two']);
  assert.deepEqual(safe.lanes.map((lane) => lane.laneType), ['customer_actions', 'emotions']);
  assert.deepEqual(safe.cards.map((card) => card.title), ['Compare options', 'Curious', 'Complete checkout']);
  assert.equal(safe.cards[1].evidence.accessibleLinkCount, 0);
  assert.equal(safe.cards[1].evidence.reason, 'no_accessible_evidence');
  assert.equal(safe.cards[2].content.length, 2_000, 'renderable card content must stay bounded');

  const artifact = await buildJourneyMapExport(fixture(), 'json', generatedAt);
  const text = artifact.bytes.toString('utf8');
  const parsed = JSON.parse(text);
  assert.equal(parsed.metadata.exportSchema, JOURNEY_MAP_EXPORT_SCHEMA);
  assert.equal(parsed.mode, 'designed');
  assert.equal(parsed.versionNumber, 3);
  assert.equal(parsed.journeyMap.cards[0].title, 'Compare options');
  assert.equal(artifact.filename, 'journey-map-11111111-2222-4333-8444-555555555555-v3.json');
  for (const forbidden of [
    'private-space-id', 'private-owner-id', 'private-author-id', 'private-source-job-id',
    'private-persona-owner-id', 'private-source', 'never export me', 'never export provenance',
    'all_links_inaccessible', '"inaccessible"'
  ]) assert.equal(text.includes(forbidden), false, `JSON export leaked ${forbidden}`);
});

test('CSV export neutralizes formulas after leading whitespace and retains governed metadata', async () => {
  assert.equal(formulaSafeCsvCell('\n=CMD()'), '"\'\n=CMD()"');
  assert.equal(formulaSafeCsvCell('  @SUM(1)'), '"\'  @SUM(1)"');
  assert.equal(formulaSafeCsvCell('normal'), '"normal"');
  const artifact = await buildJourneyMapExport(fixture({ formulas: true }), 'csv', generatedAt);
  const csv = artifact.bytes.toString('utf8');
  assert.match(csv, new RegExp(`^# .*${JOURNEY_MAP_EXPORT_SCHEMA}`, 'u'));
  assert.match(csv, /"'=HYPERLINK\(""https:\/\/bad""\)"/u);
  assert.match(csv, /"'@SUM\(1\+1\)"/u);
  assert.match(csv, /"'\+cmd\|test"/u);
  assert.doesNotMatch(csv.split('\r\n').slice(2).join('\n'), /,"[\s]*[=+\-@]/u);
  assert.equal(artifact.mimeType, 'text/csv; charset=utf-8');
});

test('rich-card export preserves safe structure, pinned names, governed media metadata, and exact emotion values', async () => {
  const map = fixture();
  const rich = richFixture(map);
  const safe = sanitizeJourneyMapForExport(map, rich);
  const card = safe.cards.find((item) => item.title === 'Curious')!;
  assert.equal(card.rich?.blocks[1].type, 'bullet');
  assert.deepEqual(card.rich?.blocks[1].marks, [{ type: 'link', start: 0, end: 7 }]);
  assert.deepEqual(card.rich?.emotion, { valence: -3, intensity: 4, label: 'Uncertain' });
  assert.equal(card.rich?.touchpoints[0].channel.name, 'Website');
  assert.equal(card.rich?.assets[0].altText, 'Checkout confirmation state');
  assert.deepEqual(safe.emotionalCurve[0], {
    stageKey: 'stage-one', stageName: 'Discover', stageOrdinal: 0, cardOrdinal: 0,
    valence: -3, intensity: 4, label: 'Uncertain'
  });

  const json = (await buildJourneyMapExport(map, 'json', generatedAt, undefined, rich)).bytes.toString('utf8');
  assert.match(json, /Payment confidence/u);
  assert.match(json, /Checkout confirmation state/u);
  assert.match(json, /"exactEmotionPointCount": 1/u);
  for (const forbidden of [
    'private.example.test', 'token=secret', 'private-touchpoint-id', 'private-touchpoint-version-id',
    'private-channel-id', 'private-asset-id', '/api/private/content', 'aaaaaaaaaaaaaaaa'
  ]) assert.equal(json.includes(forbidden), false, `rich export leaked ${forbidden}`);

  const csv = (await buildJourneyMapExport(map, 'csv', generatedAt, undefined, rich)).bytes.toString('utf8');
  assert.match(csv, /"emotionValence"/u);
  assert.match(csv, /"Uncertain","'-3","4"/u);
  assert.match(csv, /"Checkout \(Website\)"/u);
  assert.match(csv, /"Checkout state.png \[image\]"/u);
});

test('PDF and PPTX exports handle empty and large maps with real pagination', async () => {
  const emptyPdf = await buildJourneyMapExport(fixture({ empty: true }), 'pdf', generatedAt);
  assert.equal(emptyPdf.bytes.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.equal((await PDFDocument.load(emptyPdf.bytes)).getPageCount(), emptyPdf.pageCount);
  assert.ok((emptyPdf.pageCount || 0) >= 2);

  const emptyPptx = await buildJourneyMapExport(fixture({ empty: true }), 'pptx', generatedAt);
  assert.equal(emptyPptx.bytes.subarray(0, 2).toString('ascii'), 'PK');
  assert.equal(emptyPptx.slideCount, 3);
  assert.ok(emptyPptx.bytes.length > 5_000);

  const large = fixture({ large: true });
  const largePdf = await buildJourneyMapExport(large, 'pdf', generatedAt);
  assert.equal((await PDFDocument.load(largePdf.bytes)).getPageCount(), largePdf.pageCount);
  assert.ok((largePdf.pageCount || 0) > large.stages.length + 1, 'large PDF should span continuation pages');

  const largePptx = await buildJourneyMapExport(large, 'pptx', generatedAt);
  assert.equal(largePptx.bytes.subarray(0, 2).toString('ascii'), 'PK');
  assert.ok((largePptx.slideCount || 0) > large.stages.length + 2, 'large deck should span continuation slides');
  assert.ok(largePptx.bytes.length < 10 * 1024 * 1024, 'bounded deck should remain a practical download size');
});

test('PNG export rasterizes the sanitized map into a bounded portable image', async () => {
  const artifact = await buildJourneyMapExport(fixture({ large: true, formulas: true }), 'png', generatedAt);
  assert.equal(artifact.mimeType, 'image/png');
  assert.equal(artifact.filename, 'journey-map-11111111-2222-4333-8444-555555555555-v3.png');
  assert.deepEqual([...artifact.bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const metadata = await sharp(artifact.bytes).metadata();
  assert.equal(metadata.format, 'png');
  assert.ok((metadata.width || 0) >= 1_200);
  assert.ok((metadata.height || 0) >= 600);
  assert.ok((metadata.width || 0) * (metadata.height || 0) <= 60_000_000);
  assert.ok(artifact.bytes.length < 12 * 1024 * 1024, 'bounded PNG should remain a practical download size');
});
