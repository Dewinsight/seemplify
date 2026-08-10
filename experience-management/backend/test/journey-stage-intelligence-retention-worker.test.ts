import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-stage-retention-'));
const passwordFile = path.join(root, 'admin-password'); const sessionFile = path.join(root, 'session-secret');
const terraFile = path.join(root, 'terra-secret'); const identityFile = path.join(root, 'identity-key');
fs.writeFileSync(passwordFile, 'Stage-Retention-Test-2026!');
fs.writeFileSync(sessionFile, 'stage-retention-session-secret-long-enough');
fs.writeFileSync(terraFile, 'stage-retention-terra-secret-long-enough'); fs.writeFileSync(identityFile, Buffer.alloc(32, 73));
Object.assign(process.env, { DATABASE_PATH: path.join(root, 'test.sqlite'), UPLOAD_DIR: path.join(root, 'uploads'),
  KNOWLEDGE_STORAGE_DIR: path.join(root, 'knowledge'), FRONTEND_DIST: path.join(root, 'missing-frontend'),
  PUBLIC_URL: 'http://127.0.0.1:5482', ADMIN_EMAIL: 'stage-retention@seemplify.local',
  ADMIN_PASSWORD_FILE: passwordFile, SESSION_SECRET_FILE: sessionFile, TERRA_GATEWAY_SHARED_SECRET_FILE: terraFile,
  LOCAL_LLM_SHARED_SECRET_FILE: terraFile, EMAIL_MODE: 'log', JOURNEY_IDENTITY_HASH_KEY_FILE: identityFile,
  X_SEED_CONSUMER_KEY_FILE: path.join(root, 'missing'), X_SEED_CONSUMER_SECRET_FILE: path.join(root, 'missing'),
  X_SEED_BEARER_TOKEN_FILE: path.join(root, 'missing'), X_SEED_ACCESS_TOKEN_FILE: path.join(root, 'missing'),
  X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(root, 'missing') });

const { db } = await import('../src/database.js');
await import('../src/spaces.js');
const { ensurePlatformSchema } = await import('../src/platformSchema.js'); ensurePlatformSchema();
const { ensureJourneyMetricSchema } = await import('../src/journeyMetricSchema.js'); ensureJourneyMetricSchema();
const { JourneyStageIntelligenceRepository } = await import('../src/journeyStageIntelligenceRepository.js');
const { SqlJourneyStageIntelligenceStorage, purgeExpiredJourneyStageIntelligenceFacts } =
  await import('../src/journeyStageIntelligenceSqlRepository.js');
const { JourneyStageIntelligenceRetentionWorker } = await import('../src/journeyStageIntelligenceRetentionWorker.js');
after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });

const seededAt = '2026-08-01T00:00:00.000Z';
const actor = crypto.randomUUID();
const stageId = 'discover';

type Tenant = { spaceId: string; journeyId: string; definitionId: string; versionId: string; sha256: string };

function seedTenant(label: string, sha256: string): Tenant {
  const tenant: Tenant = { spaceId: crypto.randomUUID(), journeyId: crypto.randomUUID(),
    definitionId: crypto.randomUUID(), versionId: crypto.randomUUID(), sha256 };
  db.transaction(() => {
    db.prepare(`INSERT INTO spaces (id,name,slug,created_by_user_id,personal_for_user_id,created_at,updated_at)
      VALUES (?,?,?,?,NULL,?,?)`).run(tenant.spaceId, `Space ${label}`, `stage-${tenant.spaceId}`, actor, seededAt, seededAt);
    db.prepare('INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at) VALUES (?,?,\'owner\',?,?)')
      .run(tenant.spaceId, actor, seededAt, seededAt);
    db.prepare(`INSERT INTO journey_definitions
      (id,space_id,name,purpose,experience_type,map_type,mode,status,owner_user_id,review_cadence_days,revision,created_at,updated_at)
      VALUES (?,?,?,'Governed comparisons','customer','current_state','connected','draft',?,0,1,?,?)`)
      .run(tenant.journeyId, tenant.spaceId, `Journey ${label}`, actor, seededAt, seededAt);
    db.prepare(`INSERT INTO journey_metric_definitions
      (id,space_id,journey_definition_id,target_type,target_id,stage_id,touchpoint_id,persona_id,segment_id,name,state,
      current_version_id,revision,idempotency_key,intent_sha256,created_by_user_id,created_at,updated_at)
      VALUES (?,?,?,'journey',?,NULL,NULL,NULL,NULL,'Stage completion','active',?,1,?,?,?,?,?)`)
      .run(tenant.definitionId, tenant.spaceId, tenant.journeyId, tenant.journeyId, tenant.versionId,
        `definition-${label}`, '1'.repeat(64), actor, seededAt, seededAt);
    db.prepare(`INSERT INTO journey_metric_definition_versions
      (id,definition_id,space_id,version_number,source_kind,binding_id,calculator_kind,aggregation,direction,window_seconds,
      timezone,minimum_sample_size,freshness_max_age_seconds,baseline_value,target_value,population_json,filters_json,
      formula_json,configuration_json,content_sha256,idempotency_key,intent_sha256,created_by_user_id,created_at)
      VALUES (?,?,?,1,'operational_import',NULL,'operational','count','neutral',86400,'UTC',3,86400,NULL,NULL,'{}','{}','{}','{}',
        ?,?,?,?,?)`).run(tenant.versionId, tenant.definitionId, tenant.spaceId, tenant.sha256,
        `version-${label}`, '2'.repeat(64), actor, seededAt);
  })();
  return tenant;
}

db.prepare(`INSERT INTO users (id,email,name,password_hash,role,session_version,created_at,updated_at)
  VALUES (?,?,?,'test-hash','member',1,?,?)`).run(actor, 'stage-retention@example.test', 'Stage owner', seededAt, seededAt);

const expiredTenant = seedTenant('expired', 'a'.repeat(64));
const liveTenant = seedTenant('live', 'b'.repeat(64));
const chainTenant = seedTenant('chain', 'c'.repeat(64));
const consentTenant = seedTenant('consent', 'e'.repeat(64));

const storage = new SqlJourneyStageIntelligenceStorage();
const repository = new JourneyStageIntelligenceRepository(storage);
const principalFor = (tenant: Tenant) => ({ kind: 'server_secret' as const, spaceId: tenant.spaceId,
  sourceId: 'governed-source' });

function fact(tenant: Tenant, subjectId: string, externalRecordId: string,
  overrides: Record<string, unknown> = {}, revision = 1) {
  return { operation: 'upsert' as const, metricDefinitionId: tenant.definitionId, externalRecordId, revision,
    idempotencyKey: `${tenant.spaceId}-${externalRecordId}-${revision}`, journeyDefinitionId: tenant.journeyId,
    subjectId, stageId, metricDefinitionVersionId: tenant.versionId, metricDefinitionVersionSha256: tenant.sha256,
    metricUnit: 'percent' as const, value: 75, dimensions: { channel: ['web'] },
    sentiment: 'positive' as const, emotions: ['trust' as const], occurredAt: '2026-08-02T12:00:00.000Z',
    consentState: 'granted' as const, purposes: ['analytics' as const],
    retentionExpiresAt: '2027-01-01T00:00:00.000Z',
    lineage: { sourceType: 'journey_event' as const, sourceVersion: '1', schemaVersion: 'event/v1',
      projectionVersion: 'stage/v1' }, ...overrides };
}

const factCount = (spaceId: string) => (db.prepare(
  'SELECT COUNT(*) count FROM journey_stage_intelligence_facts WHERE space_id=?').get(spaceId) as { count: number }).count;
const auditCount = (spaceId: string) => (db.prepare(
  "SELECT COUNT(*) count FROM journey_stage_intelligence_audit WHERE space_id=? AND action='retention.purged'")
  .get(spaceId) as { count: number }).count;

test('an idle pass purges nothing and writes no retention receipt', () => {
  for (let index = 0; index < 2; index += 1) {
    storage.ingestFact(principalFor(liveTenant), fact(liveTenant, `live-subject-${index}`, `live-${index}`),
      '2026-08-03T00:00:00.000Z');
  }
  const outcome = purgeExpiredJourneyStageIntelligenceFacts('2026-08-08T00:00:00.000Z');
  assert.equal(outcome.spacesScanned, 0);
  assert.equal(outcome.purgedCount, 0);
  assert.equal(outcome.failedSpaces, 0);
  assert.equal(factCount(liveTenant.spaceId), 2);
  assert.equal(auditCount(liveTenant.spaceId), 0,
    'a no-op pass must not append an unprunable receipt to the append-only ledger');
});

test('retention is tenant-scoped: only the expired tenant is purged and audited', () => {
  for (let index = 0; index < 3; index += 1) {
    storage.ingestFact(principalFor(expiredTenant), fact(expiredTenant, `expired-subject-${index}`, `expired-${index}`,
      { occurredAt: '2025-01-02T00:00:00.000Z', retentionExpiresAt: '2026-01-01T00:00:00.000Z' }),
    '2025-01-01T00:00:00.000Z');
  }
  assert.equal(factCount(expiredTenant.spaceId), 3);

  const outcome = purgeExpiredJourneyStageIntelligenceFacts('2026-08-08T00:00:00.000Z');
  assert.equal(outcome.spacesPurged, 1);
  assert.equal(outcome.purgedCount, 3);
  assert.equal(outcome.failedSpaces, 0);
  assert.equal(factCount(expiredTenant.spaceId), 0);
  assert.equal(factCount(liveTenant.spaceId), 2, 'an unexpired tenant must be untouched by another tenant purge');
  assert.equal(auditCount(expiredTenant.spaceId), 1);
  assert.equal(auditCount(liveTenant.spaceId), 0);

  const receipt = db.prepare(`SELECT detail_json FROM journey_stage_intelligence_audit
    WHERE space_id=? AND action='retention.purged'`).get(expiredTenant.spaceId) as { detail_json: string };
  assert.equal(receipt.detail_json.includes('expired-subject'), false,
    'the surviving receipt must never carry a purged subject');
});

test('a live correction pinning an expired revision refuses that tenant without stopping the pass', () => {
  storage.ingestFact(principalFor(chainTenant), fact(chainTenant, 'chain-subject', 'chain-record',
    { occurredAt: '2025-01-02T00:00:00.000Z', retentionExpiresAt: '2026-01-01T00:00:00.000Z' }),
  '2025-01-01T00:00:00.000Z');
  const corrected = storage.ingestFact(principalFor(chainTenant), fact(chainTenant, 'chain-subject', 'chain-record',
    { value: 90 }, 2), '2025-01-03T00:00:00.000Z');
  assert.equal(corrected.revision, 2);

  for (let index = 0; index < 2; index += 1) {
    storage.ingestFact(principalFor(expiredTenant), fact(expiredTenant, `second-subject-${index}`, `second-${index}`,
      { occurredAt: '2025-01-02T00:00:00.000Z', retentionExpiresAt: '2026-01-01T00:00:00.000Z' }),
    '2025-01-01T00:00:00.000Z');
  }

  const outcome = purgeExpiredJourneyStageIntelligenceFacts('2026-08-08T00:00:00.000Z');
  assert.equal(outcome.spacesScanned, 2, 'both tenants holding an expired fact must be visited');
  assert.equal(outcome.failedSpaces, 1, 'the pinned chain must be refused rather than half-purged');
  assert.equal(outcome.spacesPurged, 1);
  assert.equal(outcome.purgedCount, 2, 'the healthy tenant is still purged in the same pass');
  assert.equal(factCount(expiredTenant.spaceId), 0);
  assert.equal(factCount(chainTenant.spaceId), 2, 'the refused tenant keeps its whole revision chain intact');
});

test('the worker runs the real coordinator and honours start, stop and drain', async () => {
  for (let index = 0; index < 2; index += 1) {
    storage.ingestFact(principalFor(expiredTenant), fact(expiredTenant, `worker-subject-${index}`, `worker-${index}`,
      { occurredAt: '2025-01-02T00:00:00.000Z', retentionExpiresAt: '2026-01-01T00:00:00.000Z' }),
    '2025-01-01T00:00:00.000Z');
  }
  const telemetry: Array<Record<string, unknown>> = [];
  const worker = new JourneyStageIntelligenceRetentionWorker(3_600_000,
    purgeExpiredJourneyStageIntelligenceFacts, (_level, event) => { telemetry.push(event); });

  assert.equal(worker.runOnce('2026-08-08T00:00:00.000Z'), null, 'a stopped worker must not touch tenant data');
  assert.equal(factCount(expiredTenant.spaceId), 2);

  worker.start();
  try {
    const result = worker.runOnce('2026-08-08T00:00:00.000Z');
    assert.ok(result);
    assert.equal(factCount(expiredTenant.spaceId), 0);
    assert.equal(await worker.drain(1_000), true);
  } finally { worker.stop(); }

  assert.equal(worker.runOnce('2026-08-08T00:00:00.000Z'), null, 'stop must make later passes inert');
  assert.ok(telemetry.some((event) => event.event === 'journey_stage_intelligence_retention_pass'));
  assert.equal(JSON.stringify(telemetry).includes('worker-subject'), false,
    'telemetry carries counts only, never a subject');
});

test('a failing coordinator is fingerprinted, not thrown, so the interval survives', () => {
  const telemetry: Array<Record<string, unknown>> = [];
  const worker = new JourneyStageIntelligenceRetentionWorker(3_600_000,
    () => { throw new Error('retention backend unavailable'); }, (_level, event) => { telemetry.push(event); });
  worker.start();
  try { assert.equal(worker.runOnce('2026-08-08T00:00:00.000Z'), null); } finally { worker.stop(); }
  const failure = telemetry.find((event) => event.event === 'journey_stage_intelligence_retention_pass_failed');
  assert.ok(failure);
  assert.match(String(failure.errorFingerprint), /^[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(telemetry).includes('retention backend unavailable'), false);
});

test('persisted comparisons exclude denied, withdrawn and wrong-purpose consent', async () => {
  const manager = { userId: actor, spaceId: consentTenant.spaceId, role: 'owner' as const,
    capabilities: new Set<'journeys.read' | 'journeys.edit'>(['journeys.read', 'journeys.edit']) };
  await repository.updatePolicy(manager, { expectedRevision: 1, minimumSampleSize: 3,
    dimensions: ['persona', 'segment', 'cohort', 'channel'], maximumRows: 500 });

  for (let index = 0; index < 4; index += 1) {
    storage.ingestFact(principalFor(consentTenant), fact(consentTenant, `granted-${index}`, `granted-${index}`),
      '2026-08-03T00:00:00.000Z');
  }
  storage.ingestFact(principalFor(consentTenant), fact(consentTenant, 'denied-subject', 'denied-record',
    { consentState: 'denied' }), '2026-08-03T00:00:00.000Z');
  storage.ingestFact(principalFor(consentTenant), fact(consentTenant, 'withdrawn-subject', 'withdrawn-record',
    { consentState: 'withdrawn' }), '2026-08-03T00:00:00.000Z');
  storage.ingestFact(principalFor(consentTenant), fact(consentTenant, 'research-subject', 'research-record',
    { purposes: ['research'] }), '2026-08-03T00:00:00.000Z');

  const comparison = await repository.compare({ ...manager, role: 'member',
    capabilities: new Set(['journeys.read'] as const) },
  { journeyDefinitionId: consentTenant.journeyId, purpose: 'analytics', from: '2026-08-01T00:00:00.000Z',
    to: '2026-08-04T00:00:00.000Z', asOf: '2026-08-04T01:00:00.000Z' });

  assert.equal(comparison.rows.length, 1);
  assert.equal(comparison.rows[0].dimension, 'channel');
  assert.equal(comparison.rows[0].sampleSize, 4, 'only the four granted analytics subjects may be counted');
  assert.equal(comparison.rows[0].suppression.suppressed, false);
  assert.equal(comparison.exclusions.total, 3,
    'denied, withdrawn and wrong-purpose facts are excluded, not counted');
  assert.equal(JSON.stringify(comparison).includes('denied-subject'), false);
});

test('a foreign tenant reads none of another tenant persisted facts', async () => {
  const foreign = { userId: actor, spaceId: liveTenant.spaceId, role: 'member' as const,
    capabilities: new Set(['journeys.read'] as const) };
  const comparison = await repository.compare(foreign,
    { journeyDefinitionId: consentTenant.journeyId, purpose: 'analytics', from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-04T00:00:00.000Z', asOf: '2026-08-04T01:00:00.000Z' });
  assert.equal(comparison.rows.length, 0,
    'another tenant journey id must resolve to nothing, never to its facts');
});
