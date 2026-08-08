import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';
import { signupVerifyAndOnboard } from './authTestHelper.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-journey-rich-cards-'));
const passwordFile = path.join(root, 'admin-password');
const sessionFile = path.join(root, 'session-secret');
const xKeyFile = path.join(root, 'x-key');
const esignKeyFile = path.join(root, 'esign-key');
fs.writeFileSync(passwordFile, 'Journey-Rich-Card-Test-Password-2026!');
fs.writeFileSync(sessionFile, 'journey-rich-card-test-session-secret-that-is-long-enough');
fs.writeFileSync(xKeyFile, Buffer.alloc(32, 41).toString('base64url'));
fs.writeFileSync(esignKeyFile, Buffer.alloc(32, 42).toString('base64url'));
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'test.sqlite'), UPLOAD_DIR: path.join(root, 'uploads'),
  FRONTEND_DIST: path.join(root, 'missing-frontend'), PUBLIC_URL: 'http://127.0.0.1:5412',
  ADMIN_EMAIL: 'journey-rich-cards@seemplify.local', ADMIN_PASSWORD_FILE: passwordFile,
  SESSION_SECRET_FILE: sessionFile, EMAIL_MODE: 'log', X_CREDENTIAL_ENCRYPTION_KEY_FILE: xKeyFile,
  ESIGN_STORAGE_DIR: path.join(root, 'esign'), ESIGN_ENCRYPTION_KEY_FILE: esignKeyFile,
  X_SEED_CONSUMER_KEY_FILE: path.join(root, 'missing-x-key'),
  X_SEED_CONSUMER_SECRET_FILE: path.join(root, 'missing-x-secret'),
  X_SEED_BEARER_TOKEN_FILE: path.join(root, 'missing-x-bearer'),
  X_SEED_ACCESS_TOKEN_FILE: path.join(root, 'missing-x-token'),
  X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(root, 'missing-x-token-secret')
});

const { app } = await import('../src/app.js');
const { db } = await import('../src/database.js');
const maps = await import('../src/journeyMaps.js');
const rich = await import('../src/journeyRichCards.js');
const { JourneyAssetRetentionWorker } = await import('../src/journeyAssetRetentionWorker.js');

after(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

async function ownerIdentity() {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({
    email: 'journey-rich-cards@seemplify.local', password: 'Journey-Rich-Card-Test-Password-2026!'
  }).expect(200);
  const session = await agent.get('/api/auth/session').expect(200);
  const spaceId = String(session.body.activeSpace.id);
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(spaceId);
  return { agent, userId: String(session.body.user.id), spaceId };
}

async function secondUser() {
  const agent = request.agent(app);
  const email = `rich-card-member-${crypto.randomUUID()}@example.test`;
  await signupVerifyAndOnboard(agent, { name: 'Journey member', email, password: 'Strong-test-password-2026!' });
  const session = await agent.get('/api/auth/session').expect(200);
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?")
    .run(String(session.body.activeSpace.id));
  return { agent, userId: String(session.body.user.id), spaceId: String(session.body.activeSpace.id) };
}

test('rich-text and external-reference validation is strict, bounded, and private-host safe', () => {
  assert.deepEqual(rich.normalizeJourneyRichText({ version: 1, blocks: [{
    type: 'paragraph', text: 'Review the assisted path', marks: [{ type: 'bold', start: 0, end: 6 }]
  }] }), { version: 1, blocks: [{
    type: 'paragraph', text: 'Review the assisted path', marks: [{ type: 'bold', start: 0, end: 6 }]
  }] });
  assert.throws(() => rich.normalizeJourneyRichText({ version: 1, blocks: [], html: '<script />' }),
    (error: any) => error.code === 'JOURNEY_RICH_TEXT_INVALID');
  assert.throws(() => rich.normalizeJourneyRichText({ version: 1, blocks: [{
    type: 'paragraph', text: 'Unsafe', marks: [{ type: 'link', start: 0, end: 6, href: 'http://localhost/admin' }]
  }] }), (error: any) => error.code === 'JOURNEY_ASSET_URL_INVALID');
  assert.throws(() => rich.normalizeJourneyRichText({ version: 1, blocks: [{
    type: 'paragraph', text: 'Overlapping links', marks: [
      { type: 'link', start: 0, end: 11, href: 'https://research.example.com/one' },
      { type: 'link', start: 5, end: 17, href: 'https://research.example.com/two' }
    ]
  }] }), (error: any) => error.code === 'JOURNEY_RICH_TEXT_INVALID');
  assert.throws(() => rich.normalizeJourneyRichText({ version: 1, blocks: [{
    type: 'paragraph', text: 'Script', marks: [{ type: 'link', start: 0, end: 6, href: 'javascript:alert(1)' }]
  }] }), (error: any) => error.code === 'JOURNEY_ASSET_URL_INVALID');
  assert.equal(rich.normalizeExternalJourneyUrl('https://research.example.com/report#private-fragment'),
    'https://research.example.com/report');
});

test('retention worker restarts after a redacted failed pass', () => {
  const telemetry: Array<{ level: string; event: Record<string, unknown> }> = [];
  const first = new JourneyAssetRetentionWorker(3_600_000, () => {
    throw new Error('sensitive filesystem detail must not be logged');
  }, (level, event) => telemetry.push({ level, event }));
  first.start(); first.stop();
  assert.equal(telemetry[0]?.level, 'error');
  assert.match(String(telemetry[0]?.event.errorFingerprint), /^[a-f0-9]{64}$/u);
  assert.doesNotMatch(JSON.stringify(telemetry), /sensitive filesystem detail/u);

  let recovered = 0;
  const second = new JourneyAssetRetentionWorker(3_600_000, () => {
    recovered += 1;
    return { purged: 0, blobsScheduled: 0, blobsRetained: 0, blobsPurged: 1,
      blobFileErrors: [], purgeReceiptsClaimed: 1, purgeReceiptsFailed: 0 };
  }, (level, event) => telemetry.push({ level, event }));
  second.start(); second.stop();
  assert.equal(recovered, 1);
  assert.ok(telemetry.some((entry) => entry.event.event === 'journey_asset_retention_pass'
    && entry.event.blobsPurged === 1));
});

test('catalogue versions, exact emotion points, pinned links, optimistic writes, and publication copies are durable', async () => {
  const { agent, userId, spaceId } = await ownerIdentity();
  const definition = maps.createJourneyMap(spaceId, userId, {
    name: 'Assisted purchase', purpose: 'Understand effort', stageNames: ['Discover', 'Complete']
  });
  let map = maps.getJourneyMap(spaceId, definition.id, undefined, userId)!;
  map = maps.addJourneyCard(spaceId, definition.id, map.definition.revision, {
    stageKey: map.stages[0].stageKey, laneType: 'emotions', kind: 'emotion', title: 'Uncertain'
  }, userId);
  const card = map.cards.find((item) => item.kind === 'emotion')!;

  const channel = await agent.post('/api/journey-rich-cards/channels').send({
    name: 'Website', description: 'Authenticated web experience', category: 'web'
  }).expect(201);
  const touchpoint = await agent.post('/api/journey-rich-cards/touchpoints').send({
    name: 'Checkout', description: 'Order confirmation flow', channelId: channel.body.id
  }).expect(201);
  let linked = await agent.post(`/api/journey-rich-cards/maps/${definition.id}/cards/${card.id}/touchpoints`).send({
    expectedRevision: map.definition.revision, touchpointId: touchpoint.body.id
  }).expect(201);
  map = maps.getJourneyMap(spaceId, definition.id, undefined, userId)!;
  const updated = await agent.put(`/api/journey-rich-cards/maps/${definition.id}/cards/${card.id}`).send({
    expectedRevision: map.definition.revision,
    expectedDetailRevision: linked.body.revision,
    richText: { version: 1, blocks: [
      { type: 'paragraph', text: 'Customers pause before confirming payment.', marks: [] },
      { type: 'bullet', text: 'Review reassurance copy', marks: [{ type: 'bold', start: 7, end: 18 }] }
    ] },
    emotion: { valence: -3, intensity: 4, label: 'Uncertain before payment' }
  }).expect(200);
  assert.equal(updated.body.plainText, 'Customers pause before confirming payment.\nReview reassurance copy');
  assert.deepEqual(updated.body.emotion, { valence: -3, intensity: 4, label: 'Uncertain before payment' });
  assert.equal(updated.body.touchpoints[0].versionId, touchpoint.body.versionId);

  await agent.put(`/api/journey-rich-cards/maps/${definition.id}/cards/${card.id}`).send({
    expectedRevision: map.definition.revision,
    expectedDetailRevision: linked.body.revision,
    richText: { version: 1, blocks: [] }
  }).expect(409);

  await agent.patch(`/api/journey-rich-cards/touchpoints/${touchpoint.body.id}`).send({
    expectedRevision: touchpoint.body.revision, name: 'Checkout confirmation'
  }).expect(200);
  const pinned = await agent.get(`/api/journey-rich-cards/maps/${definition.id}/cards/${card.id}`).expect(200);
  assert.equal(pinned.body.touchpoints[0].name, 'Checkout');
  assert.equal(pinned.body.touchpoints[0].versionId, touchpoint.body.versionId);

  const snapshot = await agent.get(`/api/journey-rich-cards/maps/${definition.id}`).expect(200);
  assert.deepEqual(snapshot.body.emotionalCurve, [{
    cardId: card.id, stageKey: map.stages[0].stageKey, stageName: 'Discover', stageOrdinal: 0,
    cardOrdinal: card.ordinal, valence: -3, intensity: 4, label: 'Uncertain before payment'
  }]);

  map = maps.getJourneyMap(spaceId, definition.id, undefined, userId)!;
  const published = maps.publishJourneyMap(spaceId, definition.id, map.definition.revision, userId);
  const publishedDetail = rich.getJourneyCardRichDetail(spaceId, definition.id, card.id);
  const draftMap = maps.getJourneyMap(spaceId, definition.id, published.draftVersionId, userId)!;
  const draftCard = draftMap.cards.find((item) => item.kind === 'emotion')!;
  const draftDetail = rich.getJourneyCardRichDetail(spaceId, definition.id, draftCard.id);
  assert.deepEqual(draftDetail.richText, publishedDetail.richText);
  assert.deepEqual(draftDetail.emotion, publishedDetail.emotion);
  assert.equal(draftDetail.touchpoints[0].versionId, touchpoint.body.versionId);

  assert.throws(() => db.prepare(
    'UPDATE journey_touchpoint_versions SET name=? WHERE id=?'
  ).run('Rewritten history', touchpoint.body.versionId), /immutable/iu);
});

test('governed image lifecycle denies cross-space, changed, deleted and expired content and purges last-reference blobs', async () => {
  const { agent, userId, spaceId } = await ownerIdentity();
  const definition = maps.createJourneyMap(spaceId, userId, { name: 'Media lifecycle', stageNames: ['Use'] });
  let map = maps.getJourneyMap(spaceId, definition.id, undefined, userId)!;
  map = maps.addJourneyCard(spaceId, definition.id, map.definition.revision, {
    stageKey: map.stages[0].stageKey, laneType: 'touchpoints', kind: 'touchpoint', title: 'Account page'
  }, userId);
  const card = map.cards[0];
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('bounded-test-image')]);
  const upload = await agent.post('/api/uploads').attach('file', png, {
    filename: 'account-page.png', contentType: 'image/png'
  }).expect(201);
  const attached = await agent.post(`/api/journey-rich-cards/maps/${definition.id}/cards/${card.id}/assets`).send({
    expectedRevision: map.definition.revision, kind: 'image', uploadId: upload.body.id,
    altText: 'Account page showing the confirmation message', caption: 'Reviewed design reference'
  }).expect(201);
  const assetId = String(attached.body.asset.id);
  await agent.get(`/api/journey-rich-cards/assets/${assetId}/content`).expect(200)
    .expect('X-Content-Type-Options', 'nosniff').expect('Content-Type', /image\/png/u);

  const outsider = await secondUser();
  await outsider.agent.get(`/api/journey-rich-cards/assets/${assetId}/content`).expect(404);

  const uploadRow = db.prepare('SELECT stored_filename FROM uploads WHERE id=?').get(upload.body.id) as any;
  const storedPath = path.resolve(process.env.UPLOAD_DIR!, uploadRow.stored_filename);
  fs.appendFileSync(storedPath, 'changed');
  await agent.get(`/api/journey-rich-cards/assets/${assetId}/content`).expect(410);
  fs.writeFileSync(storedPath, png);

  map = maps.getJourneyMap(spaceId, definition.id, undefined, userId)!;
  await agent.delete(`/api/journey-rich-cards/maps/${definition.id}/cards/${card.id}/assets/${assetId}`).send({
    expectedRevision: map.definition.revision
  }).expect(200);
  await agent.get(`/api/journey-rich-cards/assets/${assetId}/content`).expect(404);
  map = maps.getJourneyMap(spaceId, definition.id, undefined, userId)!;
  await agent.post(`/api/journey-rich-cards/maps/${definition.id}/cards/${card.id}/assets/${assetId}/restore`).send({
    expectedRevision: map.definition.revision
  }).expect(200);
  await agent.get(`/api/journey-rich-cards/assets/${assetId}/content`).expect(200);

  map = maps.getJourneyMap(spaceId, definition.id, undefined, userId)!;
  await agent.delete(`/api/journey-rich-cards/maps/${definition.id}/cards/${card.id}/assets/${assetId}`).send({
    expectedRevision: map.definition.revision
  }).expect(200);
  db.prepare("UPDATE journey_card_assets SET retention_expires_at='2026-01-01T00:00:00.000Z' WHERE id=?")
    .run(assetId);
  const purged = rich.purgeExpiredJourneyCardAssets('2026-08-05T00:00:00.000Z', {
    removeFile: () => { throw new Error('injected unlink failure'); }
  });
  assert.equal(purged.purged, 1);
  assert.equal(purged.blobsScheduled, 1);
  assert.equal(purged.blobsPurged, 0);
  assert.equal(purged.blobsRetained, 0);
  assert.equal(purged.purgeReceiptsClaimed, 1);
  assert.equal(purged.purgeReceiptsFailed, 1);
  assert.equal(purged.blobFileErrors.length, 1);
  assert.equal(db.prepare('SELECT id FROM uploads WHERE id=?').get(upload.body.id), undefined);
  assert.equal(fs.existsSync(storedPath), true);
  const failedReceipt = db.prepare(`SELECT * FROM journey_asset_blob_purge_outbox
    WHERE source_upload_id=?`).get(upload.body.id) as any;
  assert.equal(failedReceipt.state, 'failed');
  assert.match(String(failedReceipt.last_error_fingerprint), /^[a-f0-9]{64}$/u);
  assert.doesNotMatch(JSON.stringify(failedReceipt), /injected unlink failure/u);

  const retried = rich.processJourneyAssetBlobPurgeOutbox({ asOf: '2030-08-05T00:03:00.000Z' });
  assert.deepEqual(retried, { claimed: 1, completed: 1, failed: 0, failedReceiptIds: [] });
  assert.equal(fs.existsSync(storedPath), false);
  assert.equal((db.prepare('SELECT state FROM journey_asset_blob_purge_outbox WHERE id=?')
    .get(failedReceipt.id) as any).state, 'completed');
  const audit = rich.listJourneyRichCardAudit(spaceId, 20);
  assert.ok(audit.some((event) => event.action === 'card.asset_purged' && event.targetId === assetId));
});

test('feature, role, tenant and media-source controls fail closed', async () => {
  const owner = await ownerIdentity();
  const definition = maps.createJourneyMap(owner.spaceId, owner.userId, { name: 'Access controls', stageNames: ['Use'] });
  let map = maps.getJourneyMap(owner.spaceId, definition.id, undefined, owner.userId)!;
  map = maps.addJourneyCard(owner.spaceId, definition.id, map.definition.revision, {
    stageKey: map.stages[0].stageKey, laneType: 'touchpoints', kind: 'touchpoint', title: 'Help centre'
  }, owner.userId);
  const card = map.cards[0];
  const member = await secondUser();
  const otherUpload = await member.agent.post('/api/uploads').attach('file',
    Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('other')]),
    { filename: 'other.png', contentType: 'image/png' }).expect(201);
  const timestamp = new Date().toISOString();
  db.prepare(`INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at)
    VALUES (?,?,'member',?,?)`).run(owner.spaceId, member.userId, timestamp, timestamp);
  await member.agent.post(`/api/spaces/${owner.spaceId}/select`).send({}).expect(200);
  await member.agent.get(`/api/journey-rich-cards/maps/${definition.id}`).expect(200);
  await member.agent.put(`/api/journey-rich-cards/maps/${definition.id}/cards/${card.id}`).send({
    expectedRevision: map.definition.revision, expectedDetailRevision: 0,
    richText: { version: 1, blocks: [] }
  }).expect(403);

  await owner.agent.post(`/api/journey-rich-cards/maps/${definition.id}/cards/${card.id}/assets`).send({
    expectedRevision: map.definition.revision, kind: 'image', uploadId: otherUpload.body.id, altText: 'Other space image'
  }).expect(404);

  db.prepare("UPDATE platform_subscriptions SET plan_code='starter' WHERE space_id=?").run(owner.spaceId);
  await owner.agent.get(`/api/journey-rich-cards/maps/${definition.id}`).expect(403);
});
