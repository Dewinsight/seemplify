import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';
import { signupVerifyAndOnboard } from './authTestHelper.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-journey-event-control-'));
const passwordFile = path.join(root, 'admin-password');
const sessionFile = path.join(root, 'session-secret');
const terraSecretFile = path.join(root, 'terra-secret');
const xKeyFile = path.join(root, 'x-key');
const esignKeyFile = path.join(root, 'esign-key');
fs.writeFileSync(passwordFile, 'Journey-Event-Control-Test-2026!');
fs.writeFileSync(sessionFile, 'journey-event-control-session-secret-that-is-long-enough');
fs.writeFileSync(terraSecretFile, 'journey-event-control-terra-secret-that-is-long-enough');
fs.writeFileSync(xKeyFile, Buffer.alloc(32, 41).toString('base64url'));
fs.writeFileSync(esignKeyFile, Buffer.alloc(32, 42).toString('base64url'));
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'test.sqlite'),
  UPLOAD_DIR: path.join(root, 'uploads'),
  FRONTEND_DIST: path.join(root, 'missing-frontend'),
  PUBLIC_URL: 'http://127.0.0.1:5412',
  ADMIN_EMAIL: 'journey-event-control@seemplify.local',
  ADMIN_PASSWORD_FILE: passwordFile,
  SESSION_SECRET_FILE: sessionFile,
  TERRA_GATEWAY_SHARED_SECRET_FILE: terraSecretFile,
  LOCAL_LLM_SHARED_SECRET_FILE: terraSecretFile,
  EMAIL_MODE: 'log',
  X_CREDENTIAL_ENCRYPTION_KEY_FILE: xKeyFile,
  ESIGN_STORAGE_DIR: path.join(root, 'esign'),
  ESIGN_ENCRYPTION_KEY_FILE: esignKeyFile,
  X_SEED_CONSUMER_KEY_FILE: path.join(root, 'missing-x-key'),
  X_SEED_CONSUMER_SECRET_FILE: path.join(root, 'missing-x-secret'),
  X_SEED_BEARER_TOKEN_FILE: path.join(root, 'missing-x-bearer'),
  X_SEED_ACCESS_TOKEN_FILE: path.join(root, 'missing-x-token'),
  X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(root, 'missing-x-token-secret')
});

const { app } = await import('../src/app.js');
const { db } = await import('../src/database.js');
const { verifyStoredJourneyEventCredential } = await import('../src/journeyEventControlPlaneRepository.js');

after(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const base = '/api/journey-event-control-plane';

async function identity(agent: ReturnType<typeof request.agent>) {
  const response = await agent.get('/api/auth/session').expect(200);
  return { userId: String(response.body.user.id), spaceId: String(response.body.activeSpace.id) };
}

async function adminAgent() {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({
    email: 'journey-event-control@seemplify.local',
    password: 'Journey-Event-Control-Test-2026!'
  }).expect(200);
  const current = await identity(agent);
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(current.spaceId);
  return { agent, ...current };
}

async function userAgent(input: { name: string; email: string; password: string; plan?: 'starter' | 'team' | 'enterprise' }) {
  const agent = request.agent(app);
  await signupVerifyAndOnboard(agent, {
    name: input.name,
    email: input.email,
    password: input.password,
    spaceName: `${input.name} space`
  });
  const current = await identity(agent);
  db.prepare('UPDATE platform_subscriptions SET plan_code=? WHERE space_id=?')
    .run(input.plan || 'enterprise', current.spaceId);
  return { agent, ...current };
}

function key(value: string) {
  return { 'Idempotency-Key': value };
}

const baseSource = {
  name: 'Experience web',
  environment: 'production',
  validationMode: 'enforce',
  allowedOrigins: ['https://experience.example.test'],
  allowedBundleIds: [],
  eventsPerMinute: 5_000,
  bytesPerMinute: 8_000_000
};

const baseProperties = [
  {
    name: 'survey_id',
    type: 'string',
    required: true,
    dataClass: 'operational',
    description: 'Stable survey identifier.',
    maximumLength: 128
  },
  {
    name: 'question_count',
    type: 'number',
    required: false,
    dataClass: 'operational',
    description: 'Number of published questions.'
  }
];

function temporarilySetEnterpriseLimit(quota: string, value: number) {
  const row = db.prepare("SELECT limits_json FROM platform_subscription_plans WHERE code='enterprise'")
    .get() as { limits_json: string };
  const original = row.limits_json;
  const limits = JSON.parse(original) as Record<string, number>;
  limits[quota] = value;
  db.prepare("UPDATE platform_subscription_plans SET limits_json=? WHERE code='enterprise'").run(JSON.stringify(limits));
  return () => db.prepare("UPDATE platform_subscription_plans SET limits_json=? WHERE code='enterprise'").run(original);
}

test('connected-journey control plane is tenant-scoped, governed, idempotent, and write-only', async () => {
  const owner = await adminAgent();

  await request(app).get(`${base}/sources`).expect(401);
  const missingKey = await owner.agent.post(`${base}/sources`).send(baseSource).expect(400);
  assert.equal(missingKey.body.code, 'JOURNEY_EVENT_IDEMPOTENCY_KEY_INVALID');

  const created = await owner.agent.post(`${base}/sources`).set(key('source-create-production'))
    .send(baseSource).expect(201);
  const source = created.body.source;
  assert.equal(created.body.replayed, false);
  assert.equal(source.environment, 'production');
  assert.equal(source.revision, 1);
  assert.deepEqual(source.allowedOrigins, ['https://experience.example.test']);

  const sourceReplay = await owner.agent.post(`${base}/sources`).set(key('source-create-production'))
    .send(baseSource).expect(200);
  assert.equal(sourceReplay.body.replayed, true);
  assert.equal(sourceReplay.body.source.id, source.id);
  const sourceConflict = await owner.agent.post(`${base}/sources`).set(key('source-create-production'))
    .send({ ...baseSource, name: 'Different intent' }).expect(409);
  assert.equal(sourceConflict.body.code, 'JOURNEY_EVENT_IDEMPOTENCY_CONFLICT');

  const development = await owner.agent.post(`${base}/sources`).set(key('source-create-development'))
    .send({ ...baseSource, environment: 'development' }).expect(201);
  assert.notEqual(development.body.source.id, source.id, 'the same display name is isolated by environment');
  const productionList = await owner.agent.get(`${base}/sources`).query({ environment: 'production' }).expect(200);
  assert.deepEqual(productionList.body.sources.map((entry: any) => entry.id), [source.id]);
  assert.deepEqual(productionList.body.quota, { used: 2, limit: 100, remaining: 98 });
  assert.equal(productionList.body.sources[0].credentialCount, 0);
  assert.equal(productionList.body.sources[0].activeSchemaCount, 0);
  assert.equal(productionList.body.sources[0].revision, 1);
  await owner.agent.patch(`${base}/sources/${source.id}`).send({
    expectedRevision: 1,
    environment: 'development'
  }).expect(400);
  const updated = await owner.agent.patch(`${base}/sources/${source.id}`).send({
    expectedRevision: 1,
    validationMode: 'warn',
    allowedOrigins: ['http://localhost:5173', 'https://experience.example.test']
  }).expect(200);
  assert.equal(updated.body.source.revision, 2);
  assert.deepEqual(updated.body.source.allowedOrigins, ['http://localhost:5173', 'https://experience.example.test']);
  const stale = await owner.agent.patch(`${base}/sources/${source.id}`).send({
    expectedRevision: 1,
    validationMode: 'observe'
  }).expect(409);
  assert.equal(stale.body.code, 'JOURNEY_EVENT_SOURCE_REVISION_CONFLICT');

  const issued = await owner.agent.post(`${base}/sources/${source.id}/credentials`)
    .set(key('credential-public-first')).send({ kind: 'public_write' }).expect(201);
  const firstSecret = String(issued.body.secret);
  const firstCredential = issued.body.credential;
  assert.equal(issued.body.issuedCredential, undefined, 'credential writes use the repository-native top-level envelope');
  assert.match(firstSecret, /^jpk_live\.key_[A-Za-z0-9_-]+\./u);
  assert.ok(!('digest' in firstCredential));
  assert.ok(!('salt' in firstCredential));
  assert.equal(verifyStoredJourneyEventCredential(firstSecret)?.sourceId, source.id);

  const keyReplay = await owner.agent.post(`${base}/sources/${source.id}/credentials`)
    .set(key('credential-public-first')).send({ kind: 'public_write' }).expect(200);
  assert.equal(keyReplay.body.replayed, true);
  assert.equal(keyReplay.body.credential.id, firstCredential.id);
  assert.equal(keyReplay.body.secret, undefined, 'one-time plaintext must not be recoverable on replay');
  await owner.agent.post(`${base}/sources/${source.id}/credentials`)
    .set(key('credential-public-first')).send({ kind: 'server_secret' }).expect(409);

  const storedCredential = db.prepare(`SELECT display_prefix,salt,digest,idempotency_key,intent_hash
    FROM journey_event_credentials WHERE id=?`).get(firstCredential.id) as Record<string, unknown>;
  assert.equal(JSON.stringify(storedCredential).includes(firstSecret), false);
  assert.equal(JSON.stringify(storedCredential).includes(firstSecret.split('.')[2]), false);
  const listedKeys = await owner.agent.get(`${base}/sources/${source.id}/credentials`).expect(200);
  assert.equal(JSON.stringify(listedKeys.body).includes(firstSecret), false);
  assert.equal(JSON.stringify(listedKeys.body).includes(String(storedCredential.digest)), false);
  assert.equal(JSON.stringify(listedKeys.body).includes(String(storedCredential.salt)), false);

  const rotated = await owner.agent.post(`${base}/credentials/${firstCredential.id}/rotate`)
    .set(key('credential-public-rotate')).send({ overlapSeconds: 600 }).expect(201);
  const secondSecret = String(rotated.body.secret);
  assert.equal(rotated.body.credential.rotatedFromId, firstCredential.id);
  assert.equal(verifyStoredJourneyEventCredential(firstSecret)?.credentialId, firstCredential.id);
  assert.equal(verifyStoredJourneyEventCredential(secondSecret)?.credentialId, rotated.body.credential.id);
  const paused = await owner.agent.patch(`${base}/sources/${source.id}`).send({
    expectedRevision: 2,
    status: 'paused'
  }).expect(200);
  assert.equal(paused.body.source.status, 'paused');
  assert.equal(verifyStoredJourneyEventCredential(firstSecret), null);
  assert.equal(verifyStoredJourneyEventCredential(secondSecret), null);
  const resumed = await owner.agent.patch(`${base}/sources/${source.id}`).send({
    expectedRevision: 3,
    status: 'active'
  }).expect(200);
  assert.equal(resumed.body.source.status, 'active');
  assert.equal(verifyStoredJourneyEventCredential(secondSecret)?.credentialId, rotated.body.credential.id);
  const rotateReplay = await owner.agent.post(`${base}/credentials/${firstCredential.id}/rotate`)
    .set(key('credential-public-rotate')).send({ overlapSeconds: 600 }).expect(200);
  assert.equal(rotateReplay.body.replayed, true);
  assert.equal(rotateReplay.body.secret, undefined);
  const rotateConflict = await owner.agent.post(`${base}/credentials/${firstCredential.id}/rotate`)
    .set(key('credential-public-rotate')).send({ overlapSeconds: 601 }).expect(409);
  assert.equal(rotateConflict.body.code, 'JOURNEY_EVENT_IDEMPOTENCY_CONFLICT');

  const revoked = await owner.agent.post(`${base}/credentials/${rotated.body.credential.id}/revoke`).send({}).expect(200);
  assert.equal(revoked.body.credential.status, 'revoked');
  assert.equal(verifyStoredJourneyEventCredential(secondSecret), null);
  const revokeReplay = await owner.agent.post(`${base}/credentials/${rotated.body.credential.id}/revoke`).send({}).expect(200);
  assert.equal(revokeReplay.body.replayed, true);
  await request(app).get(`${base}/sources`).set('Authorization', `Bearer ${firstSecret}`).expect(401);
  await request(app).get(`${base}/sources`)
    .set('Cookie', `seemplify_experience_session=${encodeURIComponent(firstSecret)}`).expect(401);

  const terminal = await owner.agent.patch(`${base}/sources/${development.body.source.id}`).send({
    expectedRevision: 1,
    status: 'revoked'
  }).expect(200);
  assert.equal(terminal.body.source.status, 'revoked');
  const terminalConflict = await owner.agent.patch(`${base}/sources/${development.body.source.id}`).send({
    expectedRevision: 2,
    status: 'active'
  }).expect(409);
  assert.equal(terminalConflict.body.code, 'JOURNEY_EVENT_SOURCE_REVOKED');

  const schemaCreated = await owner.agent.post(`${base}/sources/${source.id}/schemas`)
    .set(key('schema-survey-published')).send({ eventName: 'survey_published' }).expect(201);
  const schema = schemaCreated.body.schema;
  assert.equal(schema.eventName, 'survey_published');
  const schemaReplay = await owner.agent.post(`${base}/sources/${source.id}/schemas`)
    .set(key('schema-survey-published')).send({ eventName: 'survey_published' }).expect(200);
  assert.equal(schemaReplay.body.schema.id, schema.id);
  await owner.agent.post(`${base}/sources/${source.id}/schemas`)
    .set(key('schema-survey-published')).send({ eventName: 'survey_closed' }).expect(409);

  const firstVersion = await owner.agent.post(`${base}/schemas/${schema.id}/versions`)
    .set(key('schema-version-1-0')).send({ version: '1.0', properties: baseProperties }).expect(201);
  assert.equal(firstVersion.body.schema, undefined, 'version writes return the repository-native version envelope');
  assert.equal(firstVersion.body.version.schemaId, schema.id);
  const firstVersionId = firstVersion.body.version.id;
  await owner.agent.post(`${base}/schema-versions/${firstVersionId}/publish`).send({}).expect(200);
  const publishedOnce = await owner.agent.post(`${base}/schema-versions/${firstVersionId}/publish`).send({}).expect(200);
  assert.equal(publishedOnce.body.replayed, true);

  const compatibleProperties = [...baseProperties, {
    name: 'channel',
    type: 'string',
    required: false,
    dataClass: 'operational',
    description: 'Publication channel.',
    enumValues: ['web', 'email']
  }];
  const secondVersion = await owner.agent.post(`${base}/schemas/${schema.id}/versions`)
    .set(key('schema-version-1-1')).send({ version: '1.1', properties: compatibleProperties }).expect(201);
  const secondPublished = await owner.agent.post(`${base}/schema-versions/${secondVersion.body.version.id}/publish`)
    .send({}).expect(200);
  assert.equal(secondPublished.body.version.state, 'published');
  const schemaDetail = await owner.agent.get(`${base}/schemas/${schema.id}`).expect(200);
  assert.ok(Array.isArray(schemaDetail.body.schema.versions));
  assert.equal(schemaDetail.body.schema.versions.length, 2);
  assert.equal(schemaDetail.body.schema.versions.find((entry: any) => entry.id === firstVersionId).state, 'deprecated');

  const breakingProperty = {
    name: baseProperties[0].name,
    type: 'number',
    required: baseProperties[0].required,
    dataClass: baseProperties[0].dataClass,
    description: baseProperties[0].description
  };
  const breakingVersion = await owner.agent.post(`${base}/schemas/${schema.id}/versions`)
    .set(key('schema-version-2-0-breaking')).send({
      version: '2.0',
      properties: [breakingProperty]
    }).expect(201);
  const incompatible = await owner.agent.post(`${base}/schema-versions/${breakingVersion.body.version.id}/publish`)
    .send({}).expect(409);
  assert.equal(incompatible.body.code, 'JOURNEY_EVENT_SCHEMA_INCOMPATIBLE');
  assert.ok(incompatible.body.details.issues.some((issue: any) => issue.code === 'EVENT_PROPERTY_TYPE_CHANGED'));
  const immutable = db.prepare(`SELECT properties_json,content_sha256,state FROM journey_event_schema_versions WHERE id=?`)
    .get(breakingVersion.body.version.id) as any;
  assert.deepEqual(JSON.parse(immutable.properties_json), [breakingProperty]);
  assert.equal(immutable.state, 'draft');
  assert.throws(() => db.prepare(`UPDATE journey_event_schema_versions
    SET state='published',published_by_user_id=?,published_at=? WHERE id=?`).run(
      owner.userId, new Date().toISOString(), breakingVersion.body.version.id
    ), /publication attribution and compatibility|publication attribution must be set exactly/u,
  'direct SQL cannot publish a draft without a derived compatibility result');
  assert.throws(() => db.prepare(`UPDATE journey_event_schema_versions SET compatibility_json='{}' WHERE id=?`)
    .run(secondVersion.body.version.id), /compatibility_json may change only/u,
  'compatibility lineage is immutable after publication');
  assert.throws(() => db.prepare(`UPDATE journey_event_schema_versions SET published_by_user_id=NULL WHERE id=?`)
    .run(secondVersion.body.version.id), /publication attribution/u,
  'publication attribution is immutable after publication');
  await owner.agent.post(`${base}/schemas/${schema.id}/versions`)
    .set(key('schema-version-2-0-breaking')).send({ version: '2.0', properties: compatibleProperties }).expect(409);
  const deprecatedCurrent = await owner.agent.post(`${base}/schema-versions/${secondVersion.body.version.id}/deprecate`)
    .send({}).expect(200);
  assert.equal(deprecatedCurrent.body.version.state, 'deprecated');
  assert.throws(() => db.prepare(`UPDATE journey_event_schema_versions SET deprecated_at=? WHERE id=?`)
    .run(new Date(Date.now() + 60_000).toISOString(), secondVersion.body.version.id), /deprecation attribution/u,
  'deprecation attribution is immutable after deprecation');
  const deprecateReplay = await owner.agent.post(`${base}/schema-versions/${secondVersion.body.version.id}/deprecate`)
    .send({}).expect(200);
  assert.equal(deprecateReplay.body.replayed, true);

  const audit = await owner.agent.get(`${base}/sources/${source.id}/audit`).query({ limit: 3 }).expect(200);
  assert.equal(audit.body.events.length, 3);
  assert.equal(typeof audit.body.nextCursor, 'string');
  assert.ok(audit.body.events.every((entry: any) => entry.targetKind === entry.targetType));
  assert.ok(audit.body.events.every((entry: any) => typeof entry.summary === 'string' && entry.summary.length > 0));
  assert.ok(audit.body.events.every((entry: any) => entry.actor?.name && !('email' in entry.actor)));
  assert.ok(audit.body.events.every((entry: any) => /^[a-f0-9]{64}$/u.test(entry.afterFingerprint || entry.beforeFingerprint)));
  assert.equal(JSON.stringify(audit.body).includes(firstSecret), false);
  assert.equal(JSON.stringify(audit.body).includes(secondSecret), false);
  const earlierAudit = await owner.agent.get(`${base}/sources/${source.id}/audit`)
    .query({ limit: 3, cursor: audit.body.nextCursor }).expect(200);
  assert.equal(earlierAudit.body.events.some((entry: any) => audit.body.events.some((current: any) => current.id === entry.id)), false);
  const invalidAuditCursor = await owner.agent.get(`${base}/sources/${source.id}/audit`)
    .query({ cursor: 'not-a-valid-cursor' }).expect(400);
  assert.equal(invalidAuditCursor.body.code, 'JOURNEY_EVENT_AUDIT_CURSOR_INVALID');
  const sourceWithCounts = await owner.agent.get(`${base}/sources/${source.id}`).expect(200);
  assert.equal(sourceWithCounts.body.source.credentialCount, 2);
  assert.equal(sourceWithCounts.body.source.activeSchemaCount, 0, 'the explicit deprecation removed the current published schema');

  const outsider = await userAgent({
    name: 'Control outsider',
    email: 'journey-control-outsider@example.test',
    password: 'Journey-Control-Outsider-2026!',
    plan: 'enterprise'
  });
  await outsider.agent.get(`${base}/sources/${source.id}`).expect(404);
  await outsider.agent.get(`${base}/schemas/${schema.id}`).expect(404);
  await outsider.agent.post(`${base}/credentials/${firstCredential.id}/revoke`).send({}).expect(404);

  const viewer = await userAgent({
    name: 'Control viewer',
    email: 'journey-control-viewer@example.test',
    password: 'Journey-Control-Viewer-2026!',
    plan: 'enterprise'
  });
  const joinedAt = new Date().toISOString();
  db.prepare(`INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at)
    VALUES (?,?,'member',?,?)`).run(owner.spaceId, viewer.userId, joinedAt, joinedAt);
  await viewer.agent.get(`${base}/sources/${source.id}`).set('X-Seemplify-Space', owner.spaceId).expect(200);
  const viewerDenied = await viewer.agent.post(`${base}/sources`).set('X-Seemplify-Space', owner.spaceId)
    .set(key('viewer-denied')).send({ ...baseSource, name: 'Viewer injection' }).expect(403);
  assert.equal(viewerDenied.body.code, 'JOURNEY_EVENT_CONTROL_FORBIDDEN');

  const disabled = await userAgent({
    name: 'Control disabled',
    email: 'journey-control-disabled@example.test',
    password: 'Journey-Control-Disabled-2026!',
    plan: 'team'
  });
  const disabledResponse = await disabled.agent.get(`${base}/sources`).expect(403);
  assert.equal(disabledResponse.body.code, 'SUBSCRIPTION_FEATURE_REQUIRED');
  assert.equal(disabledResponse.body.details.feature, 'journeyConnected');
});

test('resource admission is atomic for source, schema, and active-key races', async () => {
  const quotaOwner = await userAgent({
    name: 'Control quota',
    email: 'journey-control-quota@example.test',
    password: 'Journey-Control-Quota-2026!',
    plan: 'enterprise'
  });

  const restoreSources = temporarilySetEnterpriseLimit('eventSources', 1);
  let sourceResponses: Array<request.Response>;
  try {
    sourceResponses = await Promise.all([
      quotaOwner.agent.post(`${base}/sources`).set(key('quota-source-a'))
        .send({ ...baseSource, name: 'Quota source A' }),
      quotaOwner.agent.post(`${base}/sources`).set(key('quota-source-b'))
        .send({ ...baseSource, name: 'Quota source B', environment: 'staging' })
    ]);
  } finally { restoreSources(); }
  assert.deepEqual(sourceResponses!.map((response) => response.status).sort(), [201, 409]);
  const deniedSource = sourceResponses!.find((response) => response.status === 409)!;
  assert.equal(deniedSource.body.code, 'SUBSCRIPTION_QUOTA_EXCEEDED');
  assert.equal(deniedSource.body.details.quota, 'eventSources');
  const sourceId = String(sourceResponses!.find((response) => response.status === 201)!.body.source.id);
  assert.equal(Number((db.prepare("SELECT COUNT(*) count FROM journey_event_sources WHERE space_id=? AND status!='revoked'")
    .get(quotaOwner.spaceId) as any).count), 1);

  const credentialResponses = await Promise.all([
    quotaOwner.agent.post(`${base}/sources/${sourceId}/credentials`).set(key('key-race-a')).send({ kind: 'server_secret' }),
    quotaOwner.agent.post(`${base}/sources/${sourceId}/credentials`).set(key('key-race-b')).send({ kind: 'server_secret' })
  ]);
  assert.deepEqual(credentialResponses.map((response) => response.status).sort(), [201, 409]);
  assert.equal(Number((db.prepare(`SELECT COUNT(*) count FROM journey_event_credentials
    WHERE source_id=? AND kind='server_secret' AND status='active'`).get(sourceId) as any).count), 1);

  const restoreSchemas = temporarilySetEnterpriseLimit('schemaDefinitions', 1);
  let schemaResponses: Array<request.Response>;
  try {
    schemaResponses = await Promise.all([
      quotaOwner.agent.post(`${base}/sources/${sourceId}/schemas`).set(key('schema-race-a'))
        .send({ eventName: 'survey_created' }),
      quotaOwner.agent.post(`${base}/sources/${sourceId}/schemas`).set(key('schema-race-b'))
        .send({ eventName: 'survey_published' })
    ]);
  } finally { restoreSchemas(); }
  assert.deepEqual(schemaResponses!.map((response) => response.status).sort(), [201, 409]);
  const deniedSchema = schemaResponses!.find((response) => response.status === 409)!;
  assert.equal(deniedSchema.body.code, 'SUBSCRIPTION_QUOTA_EXCEEDED');
  assert.equal(deniedSchema.body.details.quota, 'schemaDefinitions');
  assert.equal(Number((db.prepare('SELECT COUNT(*) count FROM journey_event_schemas WHERE space_id=?')
    .get(quotaOwner.spaceId) as any).count), 1);
});
