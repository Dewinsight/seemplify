import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const rowCount = Number.parseInt(process.env.PHASE2_METRIC_LOAD_ROWS || '2000', 10);
const rebuildBudgetMs = Number.parseInt(process.env.PHASE2_REBUILD_BUDGET_MS || '5000', 10);
if (!Number.isSafeInteger(rowCount) || rowCount < 100 || rowCount > 100_000) {
  throw new Error('PHASE2_METRIC_LOAD_ROWS must be an integer between 100 and 100000.');
}
if (!Number.isSafeInteger(rebuildBudgetMs) || rebuildBudgetMs < 100 || rebuildBudgetMs > 120_000) {
  throw new Error('PHASE2_REBUILD_BUDGET_MS must be an integer between 100 and 120000.');
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-phase2-load-'));
const secret = (name: string, value: string | Buffer) => {
  const file = path.join(root, name);
  fs.writeFileSync(file, value);
  return file;
};
const password = 'Phase2-Load-Probe-2026!';
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'probe.sqlite'),
  UPLOAD_DIR: path.join(root, 'uploads'),
  KNOWLEDGE_STORAGE_DIR: path.join(root, 'knowledge'),
  FRONTEND_DIST: path.join(root, 'missing-frontend'),
  PUBLIC_URL: 'http://127.0.0.1:5412',
  ADMIN_EMAIL: 'phase2-load@seemplify.local',
  ADMIN_PASSWORD_FILE: secret('admin-password', password),
  SESSION_SECRET_FILE: secret('session-secret', 'phase2-load-session-secret-that-is-long-enough'),
  TERRA_GATEWAY_SHARED_SECRET_FILE: secret('terra-secret', 'phase2-load-terra-secret-that-is-long-enough'),
  LOCAL_LLM_SHARED_SECRET_FILE: path.join(root, 'terra-secret'),
  EMAIL_MODE: 'log',
  X_CREDENTIAL_ENCRYPTION_KEY_FILE: secret('x-key', Buffer.alloc(32, 81).toString('base64url')),
  ESIGN_STORAGE_DIR: path.join(root, 'esign'),
  ESIGN_ENCRYPTION_KEY_FILE: secret('esign-key', Buffer.alloc(32, 82).toString('base64url')),
  JOURNEY_IDENTITY_HASH_KEY_FILE: secret('identity-key', Buffer.alloc(32, 83)),
  X_SEED_CONSUMER_KEY_FILE: path.join(root, 'missing-x-key'),
  X_SEED_CONSUMER_SECRET_FILE: path.join(root, 'missing-x-secret'),
  X_SEED_BEARER_TOKEN_FILE: path.join(root, 'missing-x-bearer'),
  X_SEED_ACCESS_TOKEN_FILE: path.join(root, 'missing-x-token'),
  X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(root, 'missing-x-token-secret')
});

const round = (value: number) => Math.round(value * 100) / 100;
const startedAt = new Date().toISOString();

try {
  await import('../backend/src/app.js');
  const { db } = await import('../backend/src/database.js');
  const { bootstrapAdminAccount } = await import('../backend/src/auth.js');
  const { createJourneyMap } = await import('../backend/src/journeyMaps.js');
  const { runOneJourneyMetricRebuild } = await import('../backend/src/journeyMetricRebuild.js');
  const {
    createJourneyMetricBinding,
    createJourneyMetricDefinition,
    listJourneyMetricObservations,
    queueJourneyMetricRebuild
  } = await import('../backend/src/journeyMetrics.js');

  try {
    bootstrapAdminAccount();
    const identity = db.prepare(`SELECT user_row.id user_id,membership.space_id FROM users user_row
      JOIN space_memberships membership ON membership.user_id=user_row.id
      WHERE lower(user_row.email)=lower(?) ORDER BY membership.joined_at LIMIT 1`)
      .get('phase2-load@seemplify.local') as { user_id: string; space_id: string } | undefined;
    assert.ok(identity, 'bootstrap admin identity must exist');
    db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(identity.space_id);

    const occurredAt = '2026-08-07T12:00:00.000Z';
    const asOf = '2026-08-07T12:00:30.000Z';
    const surveyId = crypto.randomUUID();
    const collectorId = crypto.randomUUID();
    const questionId = crypto.randomUUID();
    db.prepare(`INSERT INTO surveys
      (id,space_id,title,description,purpose,audience,status,primary_metric,created_at,updated_at)
      VALUES (?,?,'Phase 2 load','','customer_experience','','active','nps',?,?)`)
      .run(surveyId, identity.space_id, occurredAt, occurredAt);
    db.prepare(`INSERT INTO questions
      (id,survey_id,page,position,type,title,description,required,options_json,settings_json,logic_json)
      VALUES (?,?,1,0,'nps','Recommend?','',1,'[]','{}','[]')`).run(questionId, surveyId);
    db.prepare(`INSERT INTO collectors (id,survey_id,name,type,slug,status,settings_json,created_at)
      VALUES (?,?,'Phase 2','web',?,'open','{}',?)`)
      .run(collectorId, surveyId, `phase2-${collectorId}`, occurredAt);

    const insertResponse = db.prepare(`INSERT INTO responses
      (id,survey_id,collector_id,respondent_token,status,answers_json,metadata_json,started_at,completed_at,duration_seconds)
      VALUES (?,?,?,?,'completed',?,'{}',?,?,10)`);
    const responseIds: string[] = [];
    const values: number[] = [];
    const seedStarted = performance.now();
    db.transaction(() => {
      for (let index = 0; index < rowCount; index += 1) {
        const id = crypto.randomUUID();
        const value = index % 11;
        responseIds.push(id);
        values.push(value);
        insertResponse.run(id, surveyId, collectorId, `subject-${index}`,
          JSON.stringify({ [questionId]: value }), occurredAt, occurredAt);
      }
    })();
    const seedDurationMs = performance.now() - seedStarted;

    const map = createJourneyMap(identity.space_id, identity.user_id, {
      name: 'Phase 2 metric load probe', purpose: 'Local release-gate characterization', stageNames: ['Measure']
    });
    const binding = createJourneyMetricBinding({
      spaceId: identity.space_id, actorUserId: identity.user_id, journeyDefinitionId: map.id,
      targetType: 'journey', targetId: map.id, surveyId, collectorId, questionId,
      idempotencyKey: 'phase2-load-binding', now: occurredAt
    }).binding;
    const definition = createJourneyMetricDefinition({
      spaceId: identity.space_id, actorUserId: identity.user_id, journeyDefinitionId: map.id,
      targetType: 'journey', targetId: map.id, name: 'Phase 2 NPS', idempotencyKey: 'phase2-load-definition',
      versionIdempotencyKey: 'phase2-load-definition-v1', now: occurredAt,
      version: {
        sourceKind: 'survey', bindingId: binding.id, calculatorKind: 'nps', aggregation: 'net_promoter_score',
        direction: 'higher_is_better', windowSeconds: 86_400, timezone: 'UTC', minimumSampleSize: 1,
        freshnessMaxAgeSeconds: 60, population: { status: 'completed' }, filters: {},
        formula: { kind: 'net_promoter_score' }, configuration: {
          label: 'Phase 2 NPS', scale: { minimum: 0, maximum: 10, step: 1 }, decimalPlaces: 1,
          formula: { kind: 'net_promoter_score', detractorMaximum: 6, promoterMinimum: 9 }
        }
      }
    }).definition;

    const runRebuild = async (idempotencyKey: string, reason: 'manual' | 'source_corrected' | 'source_deleted') => {
      const before = performance.now();
      queueJourneyMetricRebuild({ spaceId: identity.space_id, actorUserId: identity.user_id,
        definitionId: definition.id, reason, asOf, idempotencyKey });
      assert.equal(await runOneJourneyMetricRebuild(`phase2-load-${reason}`), true);
      return performance.now() - before;
    };

    const initialRebuildMs = await runRebuild('phase2-load-initial', 'manual');
    let latest = listJourneyMetricObservations({ spaceId: identity.space_id, definitionId: definition.id }).observations[0]!;
    const promoters = values.filter((value) => value >= 9).length;
    const detractors = values.filter((value) => value <= 6).length;
    const expectedNps = Math.round(((promoters - detractors) / rowCount) * 1_000) / 10;
    assert.equal(latest.value, expectedNps, 'materialised NPS must match source calculation');
    assert.equal(latest.sampleSize, rowCount);
    assert.equal(latest.freshnessStatus, 'fresh');
    assert.equal(latest.sourceCount, rowCount);
    assert.ok(latest.period.start && latest.period.end && latest.asOf,
      'renderable metric metadata must retain window and as-of values');

    const correctedValue = values[0] === 10 ? 0 : 10;
    db.prepare('UPDATE responses SET answers_json=? WHERE id=?')
      .run(JSON.stringify({ [questionId]: correctedValue }), responseIds[0]);
    const correctionRebuildMs = await runRebuild('phase2-load-correction', 'source_corrected');
    latest = listJourneyMetricObservations({ spaceId: identity.space_id, definitionId: definition.id }).observations[0]!;
    assert.equal(latest.revision, 2);
    assert.equal(latest.sampleSize, rowCount);

    db.prepare('DELETE FROM responses WHERE id=?').run(responseIds[1]);
    const deletionRebuildMs = await runRebuild('phase2-load-deletion', 'source_deleted');
    latest = listJourneyMetricObservations({ spaceId: identity.space_id, definitionId: definition.id }).observations[0]!;
    assert.equal(latest.revision, 3);
    assert.equal(latest.sampleSize, rowCount - 1);
    assert.equal(latest.sourceCount, rowCount - 1);
    assert.equal(latest.freshnessStatus, 'fresh');

    const timings = { seedDurationMs: round(seedDurationMs), initialRebuildMs: round(initialRebuildMs),
      correctionRebuildMs: round(correctionRebuildMs), deletionRebuildMs: round(deletionRebuildMs) };
    const candidateBudgetPassed = [initialRebuildMs, correctionRebuildMs, deletionRebuildMs]
      .every((duration) => duration <= rebuildBudgetMs);
    assert.equal(candidateBudgetPassed, true,
      `each candidate rebuild must complete within ${rebuildBudgetMs} ms`);

    console.log(JSON.stringify({
      ok: true,
      probe: 'phase2-metric-load/v1',
      startedAt,
      completedAt: new Date().toISOString(),
      profile: {
        status: 'local_candidate_unratified',
        rows: rowCount,
        rebuildBudgetMs,
        runtime: { node: process.version, platform: process.platform, arch: process.arch,
          logicalCpuCount: os.cpus().length, totalMemoryBytes: os.totalmem() }
      },
      assertions: {
        sourceParity: true,
        initialFreshness: 'fresh',
        correctionRevision: 2,
        deletionRevision: 3,
        deletionSampleSize: rowCount - 1,
        metadataComplete: true,
        candidateBudgetPassed
      },
      timings
    }));
  } finally {
    db.close();
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
