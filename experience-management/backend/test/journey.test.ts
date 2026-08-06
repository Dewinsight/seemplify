import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-journey-'));
const passwordFile = path.join(root, 'admin-password');
const sessionFile = path.join(root, 'session-secret');
const terraSecretFile = path.join(root, 'terra-secret');
const xKeyFile = path.join(root, 'x-key');
const esignKeyFile = path.join(root, 'esign-key');
fs.writeFileSync(passwordFile, 'Journey-Test-Password-2026!');
fs.writeFileSync(sessionFile, 'journey-test-session-secret-that-is-long-enough');
fs.writeFileSync(terraSecretFile, 'journey-test-terra-secret-that-is-long-enough');
fs.writeFileSync(xKeyFile, Buffer.alloc(32, 11).toString('base64url'));
fs.writeFileSync(esignKeyFile, Buffer.alloc(32, 12).toString('base64url'));
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'test.sqlite'), UPLOAD_DIR: path.join(root, 'uploads'), FRONTEND_DIST: path.join(root, 'missing-frontend'),
  PUBLIC_URL: 'http://127.0.0.1:5412', ADMIN_EMAIL: 'journeys@seemplify.local', ADMIN_PASSWORD_FILE: passwordFile,
  SESSION_SECRET_FILE: sessionFile, TERRA_GATEWAY_SHARED_SECRET_FILE: terraSecretFile, LOCAL_LLM_SHARED_SECRET_FILE: terraSecretFile,
  EMAIL_MODE: 'log', X_CREDENTIAL_ENCRYPTION_KEY_FILE: xKeyFile, ESIGN_STORAGE_DIR: path.join(root, 'esign'),
  ESIGN_ENCRYPTION_KEY_FILE: esignKeyFile, X_SEED_CONSUMER_KEY_FILE: path.join(root, 'missing-x-key'),
  X_SEED_CONSUMER_SECRET_FILE: path.join(root, 'missing-x-secret'), X_SEED_BEARER_TOKEN_FILE: path.join(root, 'missing-x-bearer'),
  X_SEED_ACCESS_TOKEN_FILE: path.join(root, 'missing-x-token'), X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(root, 'missing-x-token-secret')
});

const { app } = await import('../src/app.js');
const { db, deleteJourney, getJob, getJourney, getJourneyVersion, listJourneyVersionSummaries, updateJob, updateJourney } = await import('../src/database.js');
const { executeAiJob } = await import('../src/aiJobs.js');
const { TerraError } = await import('../src/terraClient.js');
const {
  applyJourneySuggestionRun, purgeJourneySuggestionAuditForMaintenance, reviewJourneySuggestionChange
} = await import('../src/journeySuggestions.js');
const originalFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = originalFetch;
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const stages = [
  {
    name: 'Discover', goal: 'Understand the product', touchpoints: ['Website'], customerActions: ['Compare options'],
    emotions: ['Curious'], painPoints: ['Unclear fit'], metrics: ['Qualified visits'], opportunities: ['Clarify value'],
    recommendedActions: ['Publish use-case guidance']
  },
  {
    name: 'Activate', goal: 'Reach first value', touchpoints: ['Onboarding'], customerActions: ['Configure a workspace'],
    emotions: ['Hopeful'], painPoints: ['Too many steps'], metrics: ['Time to value'], opportunities: ['Progressive setup'],
    recommendedActions: ['Reduce required fields']
  },
  {
    name: 'Adopt', goal: 'Build a habit', touchpoints: ['Product'], customerActions: ['Invite teammates'],
    emotions: ['Confident'], painPoints: ['Role confusion'], metrics: ['Weekly active teams'], opportunities: ['Role guidance'],
    recommendedActions: ['Add a role-based checklist']
  }
];

function terraResponse(data: unknown) {
  return new Response(JSON.stringify({
    data, runtimeProfile: 'experience-management', provider: 'local-codex', engine: 'codex', model: 'gpt-5.6-terra',
    usage: { input_tokens: 100, output_tokens: 200, total_tokens: 300 }, metrics: { latencyMs: 20 }
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

async function authenticatedAgent() {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email: 'journeys@seemplify.local', password: 'Journey-Test-Password-2026!' }).expect(200);
  return agent;
}

test('Terra journey generation persists a transparent hypothesis with bounded structured stages', async () => {
  const agent = await authenticatedAgent();
  const queued = await agent.post('/api/ai/journeys').send({
    brief: 'Map the customer lifecycle from discovery through repeat product adoption.', audience: 'New customers', industry: 'Software'
  }).expect(202);
  const job = getJob(queued.body.jobId);
  assert.ok(job);
  let terraRequest: any;
  let terraCalls = 0;
  globalThis.fetch = async (_url, init) => {
    terraCalls += 1;
    terraRequest = JSON.parse(String(init?.body || '{}'));
    return terraResponse({
      name: 'Customer adoption journey', audience: 'New customers', objective: 'Improve activation', industry: 'Software',
      summary: 'A planning hypothesis for the adoption lifecycle.', stages
    });
  };
  const result = await executeAiJob(job);
  const replayed = await executeAiJob(job);
  const journey = (result.output as any).journey;
  assert.equal((replayed.output as any).journey.id, journey.id);
  assert.equal(terraCalls, 1);
  assert.equal((db.prepare('SELECT COUNT(*) count FROM journey_ai_applications WHERE job_id=?').get(job.id) as any).count, 1);
  assert.equal(terraRequest.activity, 'experience.journey_mapping');
  assert.match(terraRequest.messages[1].content, /planning hypothesis/);
  assert.equal(journey.provenance.origin, 'terra');
  assert.equal(journey.provenance.evidenceBasis, 'brief_only');
  assert.equal(journey.provenance.evidenceLevel, 'hypothesis');
  assert.equal(getJourney(journey.id)?.stages.length, 3);
  updateJob(job.id, { state: 'completed', stage: 'completed', progress: 100, result, completedAt: new Date().toISOString() });
  assert.match(String((db.prepare('SELECT result_json FROM ai_jobs WHERE id=?').get(job.id) as any).result_json), new RegExp(journey.id));
  await agent.delete(`/api/journeys/${journey.id}`).send({ expectedUpdatedAt: journey.updatedAt }).expect(204);
  assert.equal(getJourney(journey.id), null);
  assert.equal(getJob(job.id), null);
  assert.equal((db.prepare('SELECT COUNT(*) count FROM journey_ai_applications WHERE journey_id=?').get(journey.id) as any).count, 0);
});

test('an in-flight Terra optimization cannot overwrite a newer workspace edit', async () => {
  const agent = await authenticatedAgent();
  const created = await agent.post('/api/journeys').send({
    name: 'Concurrent journey', audience: 'Customers', objective: 'Improve adoption', industry: 'Software',
    summary: 'Original summary', stages
  }).expect(201);
  const queued = await agent.post(`/api/journeys/${created.body.id}/ai/optimize`).send({ focus: 'Make actions measurable' }).expect(202);
  const job = getJob(queued.body.jobId);
  assert.ok(job);

  let releaseTerra!: () => void;
  let terraStarted!: () => void;
  const started = new Promise<void>((resolve) => { terraStarted = resolve; });
  const release = new Promise<void>((resolve) => { releaseTerra = resolve; });
  globalThis.fetch = async () => {
    terraStarted();
    await release;
    return terraResponse({
      summary: 'A bounded set of journey changes for explicit human review.',
      changes: [{ operation: 'stage.update', stageKey: 's01-discover', name: null,
        goal: 'A proposed goal that must not win', description: null,
        rationale: 'Proposes a clearer stage outcome without replacing the journey map.', evidenceRefs: [] }]
    });
  };

  const execution = executeAiJob(job);
  await started;
  const edited = await agent.patch(`/api/journeys/${created.body.id}`).send({
    expectedUpdatedAt: created.body.updatedAt, summary: 'Workspace edit made while Terra was running'
  }).expect(200);
  releaseTerra();
  let review = (await execution).output as any;
  review = reviewJourneySuggestionChange({ spaceId: job.spaceId, runId: review.run.id,
    changeId: review.changes[0].id, expectedRunRevision: review.run.revision,
    decision: 'accepted', reason: 'Apply only if the compatibility base is safe.', actorUserId: job.requestedBy! });
  assert.throws(() => applyJourneySuggestionRun({ spaceId: job.spaceId, runId: review.run.id,
    expectedRunRevision: review.run.revision, expectedDefinitionRevision: review.run.baseDefinitionRevision,
    actorUserId: job.requestedBy! }), (error: any) => error.code === 'JOURNEY_SUGGESTION_LEGACY_DUAL_WRITE_UNSUPPORTED');
  const persisted = getJourney(created.body.id);
  assert.equal(persisted?.summary, edited.body.summary);
  assert.equal(persisted?.updatedAt, edited.body.updatedAt);
  assert.equal(persisted?.provenance.lastModifiedBy, 'workspace');
});

test('a committed Terra optimization replays its recorded result without a second call or version', async () => {
  const agent = await authenticatedAgent();
  const created = await agent.post('/api/journeys').send({
    name: 'Replay-safe journey', audience: 'Customers', objective: 'Improve adoption', industry: 'Software',
    summary: 'Original summary', stages
  }).expect(201);
  const queued = await agent.post(`/api/journeys/${created.body.id}/ai/optimize`).send({ focus: 'Improve the measures' }).expect(202);
  const job = getJob(queued.body.jobId);
  assert.ok(job);
  let terraCalls = 0;
  globalThis.fetch = async () => {
    terraCalls += 1;
    return terraResponse({
      summary: 'A replay-safe set of reviewed journey map suggestions.',
      changes: [{ operation: 'stage.update', stageKey: 's01-discover', name: null,
        goal: 'Improved only after review', description: null,
        rationale: 'Proposes a measurable stage outcome without directly changing the map.', evidenceRefs: [] }]
    });
  };

  const first = await executeAiJob(job);
  const replayed = await executeAiJob(job);
  assert.equal(terraCalls, 1);
  assert.deepEqual(replayed, first);
  assert.equal((first.output as any).run.state, 'review');
  assert.equal((first.output as any).changes.length, 1);
  assert.equal(getJourney(created.body.id)?.summary, 'Original summary');
  const versions = listJourneyVersionSummaries(created.body.id, 20);
  assert.equal(versions.length, 0);
  assert.equal((db.prepare('SELECT COUNT(*) count FROM journey_ai_applications WHERE job_id=?').get(job.id) as any).count, 0);
  assert.equal((db.prepare('SELECT COUNT(*) count FROM journey_ai_suggestion_changes WHERE run_id=?')
    .get(queued.body.suggestionId) as any).count, 1);
  updateJob(job.id, { state: 'completed', stage: 'completed', progress: 100, result: first, completedAt: new Date().toISOString() });
  assert.match(String((db.prepare('SELECT result_json FROM ai_jobs WHERE id=?').get(job.id) as any).result_json), /review/u);
  const current = getJourney(created.body.id)!;
  const retained = await agent.delete(`/api/journeys/${created.body.id}`)
    .send({ expectedUpdatedAt: current.updatedAt }).expect(409);
  assert.equal(retained.body.code, 'JOURNEY_AI_AUDIT_RETENTION');
  process.env.JOURNEY_AUDIT_MAINTENANCE_MODE = 'privacy-purge';
  try {
    purgeJourneySuggestionAuditForMaintenance({ spaceId: job.spaceId, definitionId: queued.body.definitionId,
      reasonCode: 'privacy_erasure', changeTicket: 'TEST-PRIVACY-2026' });
  } finally { delete process.env.JOURNEY_AUDIT_MAINTENANCE_MODE; }
  await agent.delete(`/api/journeys/${created.body.id}`).send({ expectedUpdatedAt: current.updatedAt }).expect(204);
  assert.equal(getJob(job.id), null);
  assert.equal((db.prepare('SELECT COUNT(*) count FROM journey_ai_applications WHERE journey_id=?').get(created.body.id) as any).count, 0);
  assert.equal((db.prepare('SELECT COUNT(*) count FROM journey_versions WHERE journey_id=?').get(created.body.id) as any).count, 0);
});

test('journey history is newest-first, metadata-only, and bounded by count and bytes', async () => {
  const agent = await authenticatedAgent();
  const created = await agent.post('/api/journeys').send({
    name: 'Bounded history journey', audience: 'Customers', objective: 'Improve adoption', industry: 'Software',
    summary: 'Version zero', stages
  }).expect(201);
  let current = created.body;
  for (let index = 1; index <= 24; index += 1) {
    current = (await agent.patch(`/api/journeys/${created.body.id}`).send({
      expectedUpdatedAt: current.updatedAt, summary: `Version ${index}`
    }).expect(200)).body;
  }
  assert.equal((db.prepare('SELECT COUNT(*) count FROM journey_versions WHERE journey_id=?').get(created.body.id) as any).count, 20);
  const defaultHistory = await agent.get(`/api/journeys/${created.body.id}/versions`).expect(200);
  assert.equal(defaultHistory.body.length, 10);
  assert.equal('snapshot' in defaultHistory.body[0], false);
  assert.deepEqual(Object.keys(defaultHistory.body[0]).sort(), [
    'actor', 'createdAt', 'id', 'journeyId', 'name', 'reason', 'snapshotUpdatedAt', 'sourceJobId', 'stageCount'
  ]);
  const completeHistory = await agent.get(`/api/journeys/${created.body.id}/versions?limit=20`).expect(200);
  assert.equal(completeHistory.body.length, 20);
  for (let index = 1; index < completeHistory.body.length; index += 1) {
    assert.ok(completeHistory.body[index - 1].snapshotUpdatedAt >= completeHistory.body[index].snapshotUpdatedAt);
  }
  const expectedNewestId = completeHistory.body[0].id;
  db.prepare('UPDATE journey_versions SET created_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z', expectedNewestId);
  db.prepare('UPDATE journey_versions SET created_at=? WHERE id=?').run('2099-01-01T00:00:00.000Z', completeHistory.body.at(-1).id);
  const snapshotOrdered = await agent.get(`/api/journeys/${created.body.id}/versions?limit=20`).expect(200);
  assert.equal(snapshotOrdered.body[0].id, expectedNewestId);
  await agent.get(`/api/journeys/${created.body.id}/versions?limit=21`).expect(400);

  const largeJourney = await agent.post('/api/journeys').send({
    name: 'Byte-bounded history', audience: 'Customers', objective: 'Test retention', industry: 'Software',
    summary: 'Small initial snapshot', stages
  }).expect(201);
  let largeCurrent = getJourney(largeJourney.body.id)!;
  for (let index = 0; index < 8; index += 1) {
    largeCurrent = updateJourney(largeCurrent.id, { summary: `${index}:${'x'.repeat(2_500_000)}` }, largeCurrent.updatedAt,
      { reason: 'workspace_edit', actor: 'workspace' })!;
  }
  const retained = db.prepare(`SELECT id,snapshot_bytes,snapshot_updated_at FROM journey_versions WHERE journey_id=?
    ORDER BY snapshot_updated_at DESC,id DESC`).all(largeCurrent.id) as any[];
  assert.ok(retained.length > 0 && retained.length < 8);
  assert.ok(retained.reduce((total, row) => total + Number(row.snapshot_bytes), 0) <= 16 * 1024 * 1024);
  assert.match(getJourneyVersion(largeCurrent.id, retained[0].id)?.snapshot.summary || '', /^6:/);
  assert.equal(deleteJourney(largeCurrent.id, largeCurrent.updatedAt), 'deleted');
  assert.equal(deleteJourney(current.id, current.updatedAt), 'deleted');
});

test('legacy journey IDs cannot escape export filenames and leading-line-feed formulas are neutralized', async () => {
  const agent = await authenticatedAgent();
  const id = 'legacy-id"\r\nX-Injected: yes';
  const now = new Date().toISOString();
  const spaceId = (db.prepare('SELECT active_space_id FROM users LIMIT 1').get() as { active_space_id: string }).active_space_id;
  const legacyStages = [{ ...stages[0], metrics: ['\n\t=WEBSERVICE("https://invalid.example")'] }];
  db.prepare(`INSERT INTO journeys (id,space_id,name,audience,objective,industry,stages_json,summary,provenance_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, spaceId, 'Legacy / unsafe export', '', '', '', JSON.stringify(legacyStages), '', '{}', now, now);

  const encodedId = encodeURIComponent(id);
  const exportedCsv = await agent.get(`/api/journeys/${encodedId}/export.csv`).expect(200);
  assert.match(String(exportedCsv.headers['content-disposition']), /^attachment; filename="journey-map-[a-f0-9]{16}\.csv"$/);
  assert.doesNotMatch(String(exportedCsv.headers['content-disposition']), /legacy|X-Injected/i);
  assert.match(exportedCsv.text, /"metric","'\n\t=WEBSERVICE/);
  const exportedJson = await agent.get(`/api/journeys/${encodedId}/export.json`).expect(200);
  assert.match(String(exportedJson.headers['content-disposition']), /^attachment; filename="journey-map-[a-f0-9]{16}\.json"$/);
});
