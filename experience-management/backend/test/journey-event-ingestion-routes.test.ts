import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-journey-ingest-'));
const passwordFile = path.join(root, 'admin-password');
const sessionFile = path.join(root, 'session-secret');
const xKeyFile = path.join(root, 'x-key');
const esignKeyFile = path.join(root, 'esign-key');
const identityKeyFile = path.join(root, 'journey-identity-key');
fs.writeFileSync(passwordFile, 'Journey-Ingest-Test-2026!');
fs.writeFileSync(sessionFile, 'journey-ingest-session-secret-that-is-long-enough');
fs.writeFileSync(xKeyFile, Buffer.alloc(32, 41).toString('base64url'));
fs.writeFileSync(esignKeyFile, Buffer.alloc(32, 42).toString('base64url'));
fs.writeFileSync(identityKeyFile, crypto.randomBytes(48));
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'test.sqlite'),
  UPLOAD_DIR: path.join(root, 'uploads'),
  FRONTEND_DIST: path.join(root, 'missing-frontend'),
  PUBLIC_URL: 'http://127.0.0.1:5412',
  ADMIN_EMAIL: 'journey-ingest@seemplify.local',
  ADMIN_PASSWORD_FILE: passwordFile,
  SESSION_SECRET_FILE: sessionFile,
  EMAIL_MODE: 'log',
  X_CREDENTIAL_ENCRYPTION_KEY_FILE: xKeyFile,
  ESIGN_STORAGE_DIR: path.join(root, 'esign'),
  ESIGN_ENCRYPTION_KEY_FILE: esignKeyFile,
  JOURNEY_IDENTITY_HASH_KEY_FILE: identityKeyFile,
  X_SEED_CONSUMER_KEY_FILE: path.join(root, 'missing-x-key'),
  X_SEED_CONSUMER_SECRET_FILE: path.join(root, 'missing-x-secret'),
  X_SEED_BEARER_TOKEN_FILE: path.join(root, 'missing-x-bearer'),
  X_SEED_ACCESS_TOKEN_FILE: path.join(root, 'missing-x-token'),
  X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(root, 'missing-x-token-secret')
});

const { app } = await import('../src/app.js');
const { db } = await import('../src/database.js');
const {
  authenticateJourneyEventCredential,
  ingestJourneyEvent,
  JourneyEventIngestionError
} = await import('../src/journeyEventIngestionRepository.js');
const { signupVerifyAndOnboard } = await import('./authTestHelper.js');

after(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const controlBase = '/api/journey-event-control-plane';
const ingestBase = '/v1';
const origin = 'https://journey.example.test';

function idempotency(value: string) { return { 'Idempotency-Key': value }; }
function auth(secret: string) { return { Authorization: `Bearer ${secret}` }; }

async function identity(agent: ReturnType<typeof request.agent>) {
  const response = await agent.get('/api/auth/session').expect(200);
  return { userId: String(response.body.user.id), spaceId: String(response.body.activeSpace.id) };
}

async function ownerAgent() {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({
    email: 'journey-ingest@seemplify.local', password: 'Journey-Ingest-Test-2026!'
  }).expect(200);
  const current = await identity(agent);
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(current.spaceId);
  return { agent, ...current };
}

async function userAgent(name: string, email: string) {
  const agent = request.agent(app);
  await signupVerifyAndOnboard(agent, {
    name, email, password: 'Journey-Ingest-User-2026!', spaceName: `${name} space`
  });
  const current = await identity(agent);
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(current.spaceId);
  return { agent, ...current };
}

function envelope(eventId: string, overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return JSON.parse(JSON.stringify({
    protocolVersion: '1.0', eventId, call: 'track', event: 'workspace_created', eventVersion: 1,
    occurredAt: now, anonymousId: 'private-anonymous-id', properties: { plan_id: 'team' },
    context: { page: { url: 'https://journey.example.test/start?secret=value#fragment' },
      library: { name: '@seemplify/journey-browser-sdk', version: '0.1.0' } },
    consent: { analytics: 'granted', source: 'test-cmp', updatedAt: now }, ...overrides
  }));
}

async function createTrackingSource(owner: Awaited<ReturnType<typeof ownerAgent>>) {
  const created = await owner.agent.post(`${controlBase}/sources`).set(idempotency('ingest-source'))
    .send({
      name: 'Journey web', environment: 'production', validationMode: 'enforce', allowedOrigins: [origin],
      allowedBundleIds: ['com.seemplify.test'], eventsPerMinute: 100, bytesPerMinute: 10_000_000
    }).expect(201);
  const sourceId = String(created.body.source.id);
  const issued = await owner.agent.post(`${controlBase}/sources/${sourceId}/credentials`)
    .set(idempotency('ingest-public-key')).send({ kind: 'public_write' }).expect(201);
  const server = await owner.agent.post(`${controlBase}/sources/${sourceId}/credentials`)
    .set(idempotency('ingest-server-key')).send({ kind: 'server_secret' }).expect(201);
  const schema = await owner.agent.post(`${controlBase}/sources/${sourceId}/schemas`)
    .set(idempotency('ingest-schema')).send({ eventName: 'workspace_created' }).expect(201);
  const version = await owner.agent.post(`${controlBase}/schemas/${schema.body.schema.id}/versions`)
    .set(idempotency('ingest-schema-v1')).send({
      version: '1.0', properties: [{
        name: 'plan_id', type: 'string', required: true, dataClass: 'operational', description: 'Plan at creation.'
      }]
    }).expect(201);
  await owner.agent.post(`${controlBase}/schema-versions/${version.body.version.id}/publish`).send({}).expect(200);
  return {
    sourceId,
    secret: String(issued.body.secret),
    publicCredentialId: String(issued.body.credential.id),
    serverSecret: String(server.body.secret)
  };
}

function count(table: string, where = '', ...parameters: unknown[]) {
  return Number((db.prepare(`SELECT COUNT(*) count FROM ${table}${where ? ` WHERE ${where}` : ''}`)
    .get(...parameters) as { count: number | string }).count);
}

test('durable public ingestion, idempotency, admission, debugger, and replay satisfy the SQLite contract', async () => {
  const owner = await ownerAgent();
  const { sourceId, secret, publicCredentialId, serverSecret } = await createTrackingSource(owner);

  db.prepare("UPDATE platform_subscriptions SET plan_code='team' WHERE space_id=?").run(owner.spaceId);
  await request(app).post(`${ingestBase}/events`).set(auth(secret)).set('Origin', origin)
    .send(envelope(crypto.randomUUID())).expect(403);
  assert.equal(count('journey_event_ingest_receipts', 'space_id=?', owner.spaceId), 0,
    'disabled connected-journey entitlement fails before durable customer writes');
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(owner.spaceId);

  const acceptedId = crypto.randomUUID();
  const accepted = await request(app).post(`${ingestBase}/events`).set(auth(secret)).set('Origin', origin)
    .send(envelope(acceptedId)).expect(202);
  assert.equal(accepted.body.status, 'accepted');
  assert.equal(accepted.headers['access-control-allow-origin'], origin);
  assert.equal(count('journey_raw_events', 'space_id=? AND source_id=?', owner.spaceId, sourceId), 1);
  assert.equal(count('journey_event_deduplication', 'space_id=? AND source_id=?', owner.spaceId, sourceId), 1);
  assert.equal(count('journey_event_ingest_receipts', 'space_id=? AND source_id=?', owner.spaceId, sourceId), 1);
  assert.equal(count('journey_event_processing_inbox', 'space_id=? AND source_id=?', owner.spaceId, sourceId), 1);
  assert.equal(count('platform_usage_events', "space_id=? AND meter='monthlyTrackedEvents'", owner.spaceId), 1);
  const raw = db.prepare(`SELECT anonymous_id_hash,payload_json,context_json,envelope_sha256,ingest_state
    FROM journey_raw_events WHERE event_id=?`).get(acceptedId) as Record<string, unknown>;
  assert.match(String(raw.anonymous_id_hash), /^[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(raw).includes('private-anonymous-id'), false);
  assert.equal(String(raw.context_json).includes('?secret='), false, 'URL query and fragment are removed before persistence');

  const duplicate = await request(app).post(`${ingestBase}/events`).set(auth(secret)).set('Origin', origin)
    .send(envelope(acceptedId, { occurredAt: accepted.body.receivedAt })).expect(409);
  assert.equal(duplicate.body.code, 'EVENT_ID_CONFLICT', 'different occurredAt is a content conflict');
  const originalEnvelope = envelope(crypto.randomUUID());
  const stableId = originalEnvelope.eventId;
  await request(app).post(`${ingestBase}/events`).set(auth(secret)).set('Origin', origin).send(originalEnvelope).expect(202);
  const stableDuplicate = await request(app).post(`${ingestBase}/events`).set(auth(secret)).set('Origin', origin)
    .send({ ...originalEnvelope, properties: { plan_id: 'team' } }).expect(200);
  assert.equal(stableDuplicate.body.status, 'duplicate');
  assert.equal(stableDuplicate.body.duplicate, true);
  assert.equal(count('journey_raw_events', 'event_id=?', stableId), 1);
  assert.equal(count('platform_usage_events', "space_id=? AND meter='monthlyTrackedEvents'", owner.spaceId), 2);
  assert.equal(count('journey_event_ingest_receipts', 'event_id=?', stableId), 2);
  assert.equal((db.prepare(`SELECT outcome FROM journey_event_ingest_receipts WHERE event_id=?
    ORDER BY attempt_ordinal DESC LIMIT 1`).get(stableId) as any).outcome, 'duplicate');
  assert.equal((db.prepare(`SELECT outcome FROM journey_event_ingest_receipts WHERE event_id=?
    ORDER BY received_at DESC,id DESC LIMIT 1`).get(acceptedId) as any).outcome, 'content_conflict');
  const identityKeyBackup = `${identityKeyFile}.bak`;
  fs.renameSync(identityKeyFile, identityKeyBackup);
  try {
    await request(app).post(`${ingestBase}/events`).set(auth(secret)).set('Origin', origin)
      .send(originalEnvelope).expect(200);
  } finally {
    fs.renameSync(identityKeyBackup, identityKeyFile);
  }

  const serverEvent = envelope(crypto.randomUUID(), { consent: undefined });
  const serverResponse = await request(app).post(`${ingestBase}/events`).set(auth(serverSecret))
    .set('Origin', 'https://arbitrary-server-origin.example.test').send(serverEvent).expect(202);
  assert.equal(serverResponse.headers['access-control-allow-origin'], undefined,
    'trusted server calls never opt into browser CORS, even when Origin is supplied');

  const mismatched = await request(app).post(`${ingestBase}/events`).set(auth(secret))
    .set('Origin', 'https://evil.example.test').set('X-Seemplify-Bundle-Id', 'com.seemplify.test')
    .send(envelope(crypto.randomUUID())).expect(403);
  assert.equal(mismatched.body.error.code, 'EVENT_CLIENT_BINDING_FORBIDDEN');
  assert.equal(mismatched.headers['access-control-allow-origin'], undefined);

  const protocolId = crypto.randomUUID();
  const invalidProtocol = envelope(protocolId);
  delete invalidProtocol.anonymousId;
  const invalid = await request(app).post(`${ingestBase}/events`).set(auth(secret)).set('Origin', origin)
    .send(invalidProtocol).expect(422);
  assert.equal(invalid.body.error.code, 'PROTOCOL_SUBJECT_REQUIRED');
  assert.equal(invalid.headers['access-control-allow-origin'], origin);
  assert.equal(count('journey_event_rejections', 'event_id=? AND code=?', protocolId, 'PROTOCOL_SUBJECT_REQUIRED'), 1);
  assert.equal(count('journey_event_deduplication', 'event_id=?', protocolId), 0);

  const unplannedId = crypto.randomUUID();
  const unplanned = await request(app).post(`${ingestBase}/events`).set(auth(secret)).set('Origin', origin)
    .send(envelope(unplannedId, { event: 'unplanned_event' })).expect(422);
  assert.equal(unplanned.body.code, 'EVENT_SCHEMA_NOT_PUBLISHED');
  assert.equal(unplanned.body.retryable, false);
  assert.equal(count('journey_event_deduplication', 'event_id=?', unplannedId), 0);

  db.prepare("UPDATE journey_event_sources SET validation_mode='warn' WHERE id=? AND space_id=?")
    .run(sourceId, owner.spaceId);
  const quarantinedId = crypto.randomUUID();
  const quarantined = await request(app).post(`${ingestBase}/events`).set(auth(secret)).set('Origin', origin)
    .send(envelope(quarantinedId, { event: 'unplanned_quarantined_event' })).expect(202);
  assert.equal(quarantined.body.status, 'quarantined');
  assert.equal(count('journey_raw_events', "event_id=? AND ingest_state='quarantined'", quarantinedId), 1);
  assert.equal(count('journey_event_processing_inbox', 'event_id=?', quarantinedId), 0,
    'quarantined facts remain durable but cannot silently enter stage processing');
  db.prepare("UPDATE journey_event_sources SET validation_mode='enforce' WHERE id=? AND space_id=?")
    .run(sourceId, owner.spaceId);

  const deniedId = crypto.randomUUID();
  const deniedAt = new Date().toISOString();
  const denied = await request(app).post(`${ingestBase}/events`).set(auth(secret)).set('Origin', origin)
    .send(envelope(deniedId, { consent: { analytics: 'denied', source: 'cmp', updatedAt: deniedAt } })).expect(403);
  assert.equal(denied.body.code, 'EVENT_CONSENT_DENIED');
  assert.equal((db.prepare('SELECT outcome FROM journey_event_ingest_receipts WHERE event_id=?')
    .get(deniedId) as any).outcome, 'consent_denied');

  const plan = db.prepare("SELECT limits_json FROM platform_subscription_plans WHERE code='enterprise'").get() as { limits_json: string };
  const originalLimits = plan.limits_json;
  const limits = JSON.parse(originalLimits);
  const currentlyUsed = Number((db.prepare(`SELECT COALESCE(SUM(quantity),0) used FROM platform_usage_events
    WHERE space_id=? AND meter='monthlyTrackedEvents'`).get(owner.spaceId) as any).used);
  limits.monthlyTrackedEvents = currentlyUsed;
  db.prepare("UPDATE platform_subscription_plans SET limits_json=? WHERE code='enterprise'").run(JSON.stringify(limits));
  const quotaId = crypto.randomUUID();
  const quotaEnvelope = envelope(quotaId);
  const overQuota = await request(app).post(`${ingestBase}/events`).set(auth(secret)).set('Origin', origin)
    .send(quotaEnvelope).expect(429);
  assert.equal(overQuota.body.code, 'EVENT_MONTHLY_QUOTA_EXCEEDED');
  assert.equal(overQuota.body.retryable, true);
  assert.equal(count('journey_event_deduplication', 'event_id=?', quotaId), 0);
  assert.equal((db.prepare('SELECT outcome FROM journey_event_ingest_receipts WHERE event_id=? ORDER BY received_at DESC LIMIT 1')
    .get(quotaId) as any).outcome, 'over_quota');
  limits.monthlyTrackedEvents = 1_000;
  db.prepare("UPDATE platform_subscription_plans SET limits_json=? WHERE code='enterprise'").run(JSON.stringify(limits));
  await request(app).post(`${ingestBase}/events`).set(auth(secret)).set('Origin', origin).send(quotaEnvelope).expect(202);

  const failureId = crypto.randomUUID();
  const failureEnvelope = envelope(failureId);
  const principal = authenticateJourneyEventCredential(secret);
  assert.throws(() => ingestJourneyEvent({
    principal, envelope: failureEnvelope, binding: { origin, bundleId: null },
    beforeCommit: () => { throw new Error('injected-before-commit'); }
  }), (error) => error instanceof JourneyEventIngestionError && error.code === 'EVENT_DURABLE_STORAGE_UNAVAILABLE');
  assert.equal(count('journey_raw_events', 'event_id=?', failureId), 0);
  assert.equal(count('journey_event_deduplication', 'event_id=?', failureId), 0);
  assert.equal(count('platform_usage_events', "source_type='journey_event' AND source_id=?", failureId), 0);
  await request(app).post(`${ingestBase}/events`).set(auth(secret)).set('Origin', origin).send(failureEnvelope).expect(202);

  const batch = await request(app).post(`${ingestBase}/batch`).set(auth(secret)).set('Origin', origin).send({
    protocolVersion: '1.0', batchId: crypto.randomUUID(), sentAt: new Date().toISOString(),
    events: [envelope(crypto.randomUUID()), envelope(crypto.randomUUID(), { event: 'missing_schema' })]
  }).expect(207);
  assert.deepEqual(batch.body.results.map((entry: any) => entry.status), ['accepted', 'rejected']);
  assert.deepEqual(batch.body.results.map((entry: any) => entry.index), [0, 1]);

  const raceEnvelope = envelope(crypto.randomUUID());
  const raceUsageBefore = count('platform_usage_events', "source_type='journey_event' AND source_id=?", raceEnvelope.eventId);
  const race = await Promise.all([
    request(app).post(`${ingestBase}/events`).set(auth(secret)).set('Origin', origin).send(raceEnvelope),
    request(app).post(`${ingestBase}/events`).set(auth(secret)).set('Origin', origin).send(raceEnvelope)
  ]);
  assert.deepEqual(race.map((entry) => entry.status).sort(), [200, 202]);
  assert.equal(count('journey_raw_events', 'event_id=?', raceEnvelope.eventId), 1);
  assert.equal(count('platform_usage_events', "source_type='journey_event' AND source_id=?", raceEnvelope.eventId), raceUsageBefore + 1);

  db.prepare('UPDATE journey_event_sources SET events_per_minute=1 WHERE id=? AND space_id=?').run(sourceId, owner.spaceId);
  const rateA = envelope(crypto.randomUUID());
  const rateB = envelope(crypto.randomUUID());
  const rateResponses = [];
  rateResponses.push(await request(app).post(`${ingestBase}/events`).set(auth(secret)).set('Origin', origin).send(rateA));
  rateResponses.push(await request(app).post(`${ingestBase}/events`).set(auth(secret)).set('Origin', origin).send(rateB));
  const rateLimitedIndex = rateResponses.findIndex((entry) => entry.status === 429);
  assert.notEqual(rateLimitedIndex, -1);
  const rateLimitedEnvelope = rateLimitedIndex === 0 ? rateA : rateB;
  assert.equal(rateResponses[rateLimitedIndex]!.body.retryable, true);
  assert.equal(rateResponses[rateLimitedIndex]!.body.code, 'EVENT_SOURCE_RATE_LIMITED');
  assert.equal(count('journey_event_deduplication', 'event_id=?', rateLimitedEnvelope.eventId), 0);
  db.prepare('UPDATE journey_event_sources SET events_per_minute=1000 WHERE id=? AND space_id=?').run(sourceId, owner.spaceId);
  await request(app).post(`${ingestBase}/events`).set(auth(secret)).set('Origin', origin)
    .send(rateLimitedEnvelope).expect(202);

  const debug = await owner.agent.get(`${controlBase}/sources/${sourceId}/debug-events`).query({ limit: 100 }).expect(200);
  assert.ok(debug.body.events.length >= 10);
  const allowedDebugFields = ['receiptId', 'receivedAt', 'eventId', 'outcome', 'call', 'eventName', 'version',
    'schemaVersionId', 'code', 'requestId', 'batchId', 'payloadBytes', 'sdkName', 'sdkVersion', 'issues', 'processingState'].sort();
  assert.deepEqual(Object.keys(debug.body.events[0]).sort(), allowedDebugFields);
  const serializedDebug = JSON.stringify(debug.body);
  for (const forbidden of ['payload_json', 'context_json', 'consent_json', 'envelope_sha256', 'anonymous_id_hash',
    'private-anonymous-id', 'secret=value']) assert.equal(serializedDebug.includes(forbidden), false, forbidden);
  const usage = await owner.agent.get(`${controlBase}/sources/${sourceId}/ingestion-usage`).expect(200);
  assert.equal(usage.body.monthlyTrackedEvents.quota, 'monthlyTrackedEvents');
  assert.ok(['normal', 'approaching', 'warning', 'exhausted'].includes(usage.body.monthlyTrackedEvents.warningLevel));

  const deadRaw = db.prepare(`SELECT received_at,id,space_id,source_id,environment,event_id,event_name
    FROM journey_raw_events WHERE event_id=?`).get(failureId) as any;
  db.prepare(`UPDATE journey_event_processing_inbox SET state='dead_lettered',updated_at=?
    WHERE raw_received_at=? AND raw_event_id=? AND processor='connected_journey_v1'`)
    .run(new Date().toISOString(), deadRaw.received_at, deadRaw.id);
  const deadId = crypto.randomUUID();
  const deadAt = new Date().toISOString();
  db.prepare(`INSERT INTO journey_event_dead_letters
    (id,raw_received_at,raw_event_id,space_id,source_id,environment,event_id,processor,state,failure_code,
      redacted_detail_json,attempt_count,replay_eligible,replay_after,last_processing_receipt_id,
      last_processing_attempted_at,resolved_at,resolution_code,updated_at,retention_expires_at)
    VALUES (?,?,?,?,?,?,?,'connected_journey_v1','pending','EVENT_PROCESSING_ATTEMPTS_EXHAUSTED',
      '{"internal":"do-not-leak"}',3,1,?,NULL,NULL,NULL,NULL,?,?)`)
    .run(deadId, deadRaw.received_at, deadRaw.id, owner.spaceId, sourceId, deadRaw.environment,
      deadRaw.event_id, deadAt, deadAt, new Date(Date.parse(deadAt) + 14 * 24 * 60 * 60_000).toISOString());
  const deadList = await owner.agent.get(`${controlBase}/sources/${sourceId}/dead-letters`).expect(200);
  assert.equal(deadList.body.deadLetters[0].id, deadId);
  assert.deepEqual(Object.keys(deadList.body.deadLetters[0]).sort(), ['attempts', 'eventId', 'eventName', 'failedAt',
    'failure', 'id', 'processor', 'replayEligible', 'replayIneligibleReason', 'state'].sort());
  assert.equal(JSON.stringify(deadList.body).includes('redacted_detail_json'), false);
  assert.equal(JSON.stringify(deadList.body).includes('do-not-leak'), false);
  assert.equal(count('journey_event_data_audit', "action='dead_letter.viewed' AND target_id=?", deadId), 1);
  const replay = await owner.agent.post(`${controlBase}/dead-letters/${deadId}/replay`)
    .send({ confirmation: true }).expect(200);
  assert.equal(replay.body.replayed, false);
  assert.equal(replay.body.deadLetter.state, 'replay_scheduled');
  assert.equal((db.prepare(`SELECT state FROM journey_event_processing_inbox
    WHERE raw_received_at=? AND raw_event_id=? AND processor='connected_journey_v1'`)
    .get(deadRaw.received_at, deadRaw.id) as any).state, 'pending');
  assert.equal(count('journey_event_data_audit', "action='dead_letter.replay_requested' AND target_id=?", deadId), 1);
  const replayAgain = await owner.agent.post(`${controlBase}/dead-letters/${deadId}/replay`)
    .send({ confirmation: true }).expect(200);
  assert.equal(replayAgain.body.replayed, true);

  const viewer = await userAgent('Journey viewer', 'journey-ingest-viewer@example.test');
  const joinedAt = new Date().toISOString();
  db.prepare(`INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at)
    VALUES (?,?,'member',?,?)`).run(owner.spaceId, viewer.userId, joinedAt, joinedAt);
  await viewer.agent.get(`${controlBase}/sources/${sourceId}/debug-events`)
    .set('X-Seemplify-Space', owner.spaceId).expect(200);
  await viewer.agent.post(`${controlBase}/dead-letters/${deadId}/replay`)
    .set('X-Seemplify-Space', owner.spaceId).send({ confirmation: true }).expect(403);

  const outsider = await userAgent('Journey outsider', 'journey-ingest-outsider@example.test');
  await outsider.agent.get(`${controlBase}/sources/${sourceId}/debug-events`).expect(404);

  const receiptsBeforeUnauthenticated = count('journey_event_ingest_receipts');
  await request(app).post(`${ingestBase}/batch`).send({ protocolVersion: '1.0' }).expect(401);
  assert.equal(count('journey_event_ingest_receipts'), receiptsBeforeUnauthenticated,
    'unauthenticated invalid batches cannot create durable customer rows');
  const invalidBatch = await request(app).post(`${ingestBase}/batch`).set(auth(secret)).set('Origin', origin)
    .send({ protocolVersion: '1.0' }).expect(422);
  assert.equal(invalidBatch.body.error.code, 'PROTOCOL_UUID');
  assert.equal(count('journey_event_ingest_receipts'), receiptsBeforeUnauthenticated + 1,
    'authenticated structurally invalid batches leave one redacted durable rejection');

  const receiptsBeforeOversize = count('journey_event_ingest_receipts');
  await request(app).post(`${ingestBase}/events`).set(auth(secret)).set('Content-Type', 'application/json')
    .send(JSON.stringify({ huge: 'x'.repeat(600 * 1024) })).expect(413);
  assert.equal(count('journey_event_ingest_receipts'), receiptsBeforeOversize,
    'body-parser failures happen before credential extraction and stay out of customer tables');

  const receiptsBeforeRevocation = count('journey_event_ingest_receipts');
  await owner.agent.post(`${controlBase}/credentials/${publicCredentialId}/revoke`).send({}).expect(200);
  await request(app).post(`${ingestBase}/events`).set(auth(secret)).set('Origin', origin)
    .send(envelope(crypto.randomUUID())).expect(401);
  assert.equal(count('journey_event_ingest_receipts'), receiptsBeforeRevocation);
  db.prepare("UPDATE platform_subscription_plans SET limits_json=? WHERE code='enterprise'").run(originalLimits);
});
