import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-stage-intelligence-'));
const passwordFile = path.join(root, 'admin-password'); const sessionFile = path.join(root, 'session-secret');
const terraFile = path.join(root, 'terra-secret'); const identityFile = path.join(root, 'identity-key');
fs.writeFileSync(passwordFile, 'Stage-Intelligence-Test-2026!');
fs.writeFileSync(sessionFile, 'stage-intelligence-session-secret-long-enough');
fs.writeFileSync(terraFile, 'stage-intelligence-terra-secret-long-enough'); fs.writeFileSync(identityFile, Buffer.alloc(32, 91));
Object.assign(process.env, { DATABASE_PATH: path.join(root, 'test.sqlite'), UPLOAD_DIR: path.join(root, 'uploads'),
  KNOWLEDGE_STORAGE_DIR: path.join(root, 'knowledge'), FRONTEND_DIST: path.join(root, 'missing-frontend'),
  PUBLIC_URL: 'http://127.0.0.1:5481', ADMIN_EMAIL: 'stage-intelligence@seemplify.local',
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
after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });

const owner = { user_id: crypto.randomUUID(), space_id: crypto.randomUUID() }; const map = { id: crypto.randomUUID() };
const definitionId = crypto.randomUUID(); const version = { id: crypto.randomUUID(), contentSha256: 'd'.repeat(64) };
const seededAt = '2026-08-01T00:00:00.000Z';
db.transaction(() => {
  db.prepare(`INSERT INTO users (id,email,name,password_hash,role,session_version,created_at,updated_at)
    VALUES (?,?,?,'test-hash','member',1,?,?)`).run(owner.user_id, 'stage-owner@example.test', 'Stage owner', seededAt, seededAt);
  db.prepare(`INSERT INTO spaces (id,name,slug,created_by_user_id,personal_for_user_id,created_at,updated_at)
    VALUES (?,?,?, ?,NULL,?,?)`).run(owner.space_id, 'Stage space', `stage-${owner.space_id}`, owner.user_id, seededAt, seededAt);
  db.prepare(`INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at) VALUES (?,?,'owner',?,?)`)
    .run(owner.space_id, owner.user_id, seededAt, seededAt);
  db.prepare(`INSERT INTO journey_definitions
    (id,space_id,name,purpose,experience_type,map_type,mode,status,owner_user_id,review_cadence_days,revision,created_at,updated_at)
    VALUES (?,?,'Stage intelligence journey','Governed comparisons','customer','current_state','connected','draft',?,0,1,?,?)`)
    .run(map.id, owner.space_id, owner.user_id, seededAt, seededAt);
  db.prepare(`INSERT INTO journey_metric_definitions
    (id,space_id,journey_definition_id,target_type,target_id,stage_id,touchpoint_id,persona_id,segment_id,name,state,
    current_version_id,revision,idempotency_key,intent_sha256,created_by_user_id,created_at,updated_at)
    VALUES (?,?,?,'journey',?,NULL,NULL,NULL,NULL,'Stage completion','active',?,1,'stage-definition',?,?,?,?)`)
    .run(definitionId, owner.space_id, map.id, map.id, version.id, '1'.repeat(64), owner.user_id, seededAt, seededAt);
  db.prepare(`INSERT INTO journey_metric_definition_versions
    (id,definition_id,space_id,version_number,source_kind,binding_id,calculator_kind,aggregation,direction,window_seconds,
    timezone,minimum_sample_size,freshness_max_age_seconds,baseline_value,target_value,population_json,filters_json,formula_json,
    configuration_json,content_sha256,idempotency_key,intent_sha256,created_by_user_id,created_at)
    VALUES (?,?,?,1,'operational_import',NULL,'operational','count','neutral',86400,'UTC',3,86400,NULL,NULL,'{}','{}','{}','{}',
      ?,'stage-definition-v1',?,?,?)`).run(version.id, definitionId, owner.space_id, version.contentSha256,
      '2'.repeat(64), owner.user_id, seededAt);
})();
const stageId = 'discover';
const storage = new SqlJourneyStageIntelligenceStorage(); const repository = new JourneyStageIntelligenceRepository(storage);
const principal = { kind: 'server_secret' as const, spaceId: owner.space_id, sourceId: 'source-one' };

function input(subjectId: string, externalRecordId: string, revision = 1) {
  return { operation: 'upsert' as const, metricDefinitionId: definitionId, externalRecordId, revision,
    idempotencyKey: `stage-fact-${externalRecordId}-${revision}`, journeyDefinitionId: map.id, subjectId, stageId,
    metricDefinitionVersionId: version.id, metricDefinitionVersionSha256: version.contentSha256, metricUnit: 'percent' as const,
    value: 75, dimensions: { persona: ['buyer'], segment: ['enterprise'], cohort: ['august'], channel: ['web'] },
    sentiment: 'positive' as const, emotions: ['trust' as const], occurredAt: '2026-08-02T12:00:00.000Z',
    consentState: 'granted' as const, purposes: ['analytics' as const], retentionExpiresAt: '2027-01-01T00:00:00.000Z',
    lineage: { sourceType: 'journey_event' as const, sourceVersion: '1', schemaVersion: 'event/v1',
      projectionVersion: 'stage/v1' } };
}

test('durable policy is server-owned, revisioned and manager-CAS protected', async () => {
  const member = { userId: owner.user_id, spaceId: owner.space_id, role: 'member' as const,
    capabilities: new Set<'journeys.read' | 'journeys.edit'>(['journeys.read']) };
  const manager = { ...member, role: 'owner' as const,
    capabilities: new Set<'journeys.read' | 'journeys.edit'>(['journeys.read', 'journeys.edit']) };
  assert.equal((await repository.readPolicy(member)).minimumSampleSize, 30);
  await assert.rejects(repository.updatePolicy(member, { expectedRevision: 1, minimumSampleSize: 3,
    dimensions: ['persona'], maximumRows: 100 }), /permission/u);
  const updated = await repository.updatePolicy(manager, { expectedRevision: 1, minimumSampleSize: 3,
    dimensions: ['persona', 'segment', 'cohort', 'channel'], maximumRows: 500 });
  assert.equal(updated.revision, 2);
  await assert.rejects(repository.updatePolicy(manager, { expectedRevision: 1, minimumSampleSize: 3,
    dimensions: ['persona'], maximumRows: 100 }), /Policy changed/u);
  assert.equal((db.prepare('SELECT COUNT(*) count FROM journey_stage_intelligence_policy_history WHERE space_id=?')
    .get(owner.space_id) as { count: number }).count, 2);
});

test('internal ingestion stores HMAC identities, exact lineage, idempotent corrections and tombstones', async () => {
  for (let index = 0; index < 3; index += 1) {
    const accepted = storage.ingestFact(principal, input(`customer-secret-${index}`, `record-${index}`),
      '2026-08-03T00:00:00.000Z'); assert.equal(accepted.replayed, false);
    const replay = storage.ingestFact(principal, input(`customer-secret-${index}`, `record-${index}`),
      '2026-08-03T00:00:00.000Z'); assert.equal(replay.replayed, true);
  }
  const stored = db.prepare('SELECT * FROM journey_stage_intelligence_facts WHERE external_record_hmac=?')
    .get((db.prepare('SELECT external_record_hmac FROM journey_stage_intelligence_facts LIMIT 1').get() as any).external_record_hmac) as any;
  assert.notEqual(stored.subject_id_hmac, 'customer-secret-0'); assert.match(stored.subject_id_hmac, /^[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(stored).includes('customer-secret'), false);
  const corrected = storage.ingestFact(principal, { ...input('customer-secret-0', 'record-0', 2), value: 90 },
    '2026-08-03T01:00:00.000Z'); assert.equal(corrected.revision, 2);
  assert.throws(() => storage.ingestFact(principal, { ...input('customer-secret-0', 'record-0', 4),
    idempotencyKey: 'stage-fact-gap-revision' }), /consecutive/u);
  const deleted = storage.ingestFact(principal, { operation: 'delete', metricDefinitionId: definitionId,
    externalRecordId: 'record-1', revision: 2, idempotencyKey: 'stage-fact-record-1-delete' },
  '2026-08-03T02:00:00.000Z'); assert.equal(deleted.operation, 'delete');
  const comparison = await repository.compare({ userId: owner.user_id, spaceId: owner.space_id, role: 'member',
    capabilities: new Set(['journeys.read'] as const) },
    { journeyDefinitionId: map.id, purpose: 'analytics', from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-04T00:00:00.000Z', asOf: '2026-08-04T01:00:00.000Z' });
  assert.equal(comparison.rows.length, 4);
  assert.equal(comparison.rows.every((row) => row.suppression.suppressed), true,
    'two live subjects must stay below the durable sample policy');
  assert.equal(JSON.stringify(comparison).includes('customer-secret'), false);
});

test('raw text, non-allowlisted dimensions, stale metric lineage and idempotency conflicts fail closed', () => {
  assert.throws(() => storage.ingestFact(principal, { ...input('customer-four', 'record-raw'),
    dimensions: { persona: ['buyer'], rawText: ['secret feedback'] } as any }), /not allowlisted/u);
  assert.throws(() => storage.ingestFact(principal, { ...input('customer-four', 'record-lineage'),
    metricDefinitionVersionSha256: 'f'.repeat(64) }), /lineage is unavailable/u);
  storage.ingestFact(principal, input('customer-four', 'record-idempotent'));
  assert.throws(() => storage.ingestFact(principal, { ...input('customer-four', 'record-idempotent'), value: 10 }),
    /intent changed/u);
  assert.throws(() => storage.ingestFact({ kind: 'server_secret', spaceId: 'foreign-space', sourceId: 'source-one' },
    input('customer-four', 'record-foreign')), /FOREIGN KEY|Metric lineage is unavailable|constraint/iu);
});

test('fact and audit histories are append-only and content-safe', () => {
  assert.throws(() => db.prepare('UPDATE journey_stage_intelligence_facts SET value=1 WHERE space_id=?').run(owner.space_id),
    /append-only/u);
  assert.throws(() => db.prepare('DELETE FROM journey_stage_intelligence_audit WHERE space_id=?').run(owner.space_id),
    /append-only/u);
  const audit = db.prepare('SELECT detail_json FROM journey_stage_intelligence_audit WHERE space_id=?').all(owner.space_id) as any[];
  assert.ok(audit.length >= 4); assert.equal(JSON.stringify(audit).includes('customer-secret'), false);
});

test('authorised retention physically purges expired facts while immutable content-safe audit survives', () => {
  const expired = { ...input('expired-subject-secret', 'expired-record'), occurredAt: '2025-01-02T00:00:00.000Z',
    retentionExpiresAt: '2026-01-01T00:00:00.000Z', idempotencyKey: 'expired-record-ingest' };
  const accepted = storage.ingestFact(principal, expired, '2025-01-01T00:00:00.000Z');
  const live = db.prepare("SELECT id FROM journey_stage_intelligence_facts WHERE retention_expires_at>'2026-08-08' LIMIT 1")
    .get() as { id: string };
  assert.throws(() => db.prepare('DELETE FROM journey_stage_intelligence_facts WHERE id=?').run(live.id),
    /expired-retention purge/u);
  const purged = storage.purgeExpiredFacts({ kind: 'retention_worker', spaceId: owner.space_id,
    now: '2026-08-08T00:00:00.000Z' });
  assert.ok(purged.purgedCount >= 1);
  assert.equal(db.prepare('SELECT 1 ok FROM journey_stage_intelligence_facts WHERE id=?').get(accepted.factId), undefined);
  const retentionAudit = db.prepare("SELECT detail_json FROM journey_stage_intelligence_audit WHERE action='retention.purged' AND space_id=?")
    .get(owner.space_id) as { detail_json: string };
  assert.ok(retentionAudit); assert.equal(retentionAudit.detail_json.includes('expired-subject-secret'), false);
});

test('bounded retention advances beyond a failing early tenant and reaches more than 100 spaces', () => {
  const sourceId = 'retention-production-feed';
  const expiredAt = '2026-01-01T00:00:00.000Z';
  const futureAt = '2027-01-01T00:00:00.000Z';
  for (let index = 0; index < 102; index += 1) {
    const suffix = String(index).padStart(3, '0'); const spaceId = `retention-space-${suffix}`;
    const journeyId = `retention-journey-${suffix}`; const metricId = `retention-metric-${suffix}`;
    const metricVersionId = `retention-version-${suffix}`;
    const versionSha = crypto.createHash('sha256').update(`version-${suffix}`).digest('hex');
    db.transaction(() => {
      db.prepare(`INSERT INTO spaces (id,name,slug,created_by_user_id,personal_for_user_id,created_at,updated_at)
      VALUES (?,?,?, ?,NULL,?,?)`).run(spaceId, `Retention ${suffix}`, `retention-${suffix}`, owner.user_id, seededAt, seededAt);
      db.prepare(`INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at)
      VALUES (?,?,'owner',?,?)`).run(spaceId, owner.user_id, seededAt, seededAt);
      db.prepare(`INSERT INTO journey_definitions
      (id,space_id,name,purpose,experience_type,map_type,mode,status,owner_user_id,review_cadence_days,revision,created_at,updated_at)
      VALUES (?,?,?,'Retention','customer','current_state','connected','draft',?,0,1,?,?)`)
      .run(journeyId, spaceId, `Retention journey ${suffix}`, owner.user_id, seededAt, seededAt);
      db.prepare(`INSERT INTO journey_metric_definitions
      (id,space_id,journey_definition_id,target_type,target_id,stage_id,touchpoint_id,persona_id,segment_id,name,state,
       current_version_id,revision,idempotency_key,intent_sha256,created_by_user_id,created_at,updated_at)
      VALUES (?,?,?,'journey',?,NULL,NULL,NULL,NULL,'Retention count','active',?,1,?,?,?, ?,?)`)
      .run(metricId, spaceId, journeyId, journeyId, metricVersionId, `retention-definition-${suffix}`,
        crypto.createHash('sha256').update(`definition-${suffix}`).digest('hex'), owner.user_id, seededAt, seededAt);
      db.prepare(`INSERT INTO journey_metric_definition_versions
      (id,definition_id,space_id,version_number,source_kind,binding_id,calculator_kind,aggregation,direction,window_seconds,
       timezone,minimum_sample_size,freshness_max_age_seconds,baseline_value,target_value,population_json,filters_json,formula_json,
       configuration_json,content_sha256,idempotency_key,intent_sha256,created_by_user_id,created_at)
      VALUES (?,?,?,1,'operational_import',NULL,'operational','count','neutral',86400,'UTC',3,86400,NULL,NULL,'{}','{}','{}','{}',?,?,?,?,?)`)
      .run(metricVersionId, metricId, spaceId, versionSha, `retention-version-key-${suffix}`,
        crypto.createHash('sha256').update(`version-intent-${suffix}`).digest('hex'), owner.user_id, seededAt);
    })();
    const tenantStorage = new SqlJourneyStageIntelligenceStorage();
    const base = { operation: 'upsert' as const, metricDefinitionId: metricId, externalRecordId: `record-${suffix}`,
      revision: 1, idempotencyKey: `retention-fact-${suffix}-1`, journeyDefinitionId: journeyId,
      subjectId: `subject-${suffix}`, stageId: 'discover', metricDefinitionVersionId: metricVersionId,
      metricDefinitionVersionSha256: versionSha, metricUnit: 'count' as const, value: 1,
      dimensions: { channel: ['web'] }, sentiment: null, emotions: [], occurredAt: '2025-12-01T00:00:00.000Z',
      consentState: 'granted' as const, purposes: ['analytics' as const], retentionExpiresAt: expiredAt,
      lineage: { sourceType: 'journey_event' as const, sourceVersion: '1', schemaVersion: 'event/v1',
        projectionVersion: 'stage/v1' } };
    tenantStorage.ingestFact({ kind: 'server_secret', spaceId, sourceId }, base, '2025-12-01T00:00:00.000Z');
    if (index === 0) tenantStorage.ingestFact({ kind: 'server_secret', spaceId, sourceId }, {
      ...base, revision: 2, idempotencyKey: `retention-fact-${suffix}-2`, retentionExpiresAt: futureAt
    }, '2025-12-02T00:00:00.000Z');
  }
  const first = purgeExpiredJourneyStageIntelligenceFacts('2026-08-08T00:00:00.000Z', 100);
  assert.equal(first.spacesScanned, 100); assert.equal(first.failedSpaces, 1); assert.ok(first.nextCursor);
  const second = purgeExpiredJourneyStageIntelligenceFacts('2026-08-08T00:00:00.000Z', 100, first.nextCursor);
  assert.equal(second.spacesScanned, 2); assert.equal(second.spacesPurged, 2); assert.equal(second.nextCursor, null);
  assert.equal((db.prepare(`SELECT COUNT(*) count FROM journey_stage_intelligence_facts
    WHERE space_id='retention-space-101'`).get() as any).count, 0);
  assert.equal((db.prepare(`SELECT COUNT(*) count FROM journey_stage_intelligence_facts
    WHERE space_id='retention-space-000'`).get() as any).count, 2);
});
