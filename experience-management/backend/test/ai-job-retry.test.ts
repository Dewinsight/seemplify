import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';
import { signupVerifyAndOnboard } from './authTestHelper.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-ai-retry-'));
const files = {
  password: path.join(root, 'admin-password'), session: path.join(root, 'session-secret'),
  terra: path.join(root, 'terra-secret'), knowledge: path.join(root, 'knowledge-secret'),
  xKey: path.join(root, 'x-key'), esignKey: path.join(root, 'esign-key')
};
fs.writeFileSync(files.password, 'AI-Retry-Test-Password-2026!');
fs.writeFileSync(files.session, 'ai-retry-test-session-secret-that-is-long-enough');
fs.writeFileSync(files.terra, 'ai-retry-test-terra-secret-that-is-long-enough');
fs.writeFileSync(files.knowledge, 'ai-retry-test-knowledge-secret-that-is-long-enough');
fs.writeFileSync(files.xKey, Buffer.alloc(32, 91).toString('base64url'));
fs.writeFileSync(files.esignKey, Buffer.alloc(32, 92).toString('base64url'));

Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'retry.sqlite'), UPLOAD_DIR: path.join(root, 'uploads'),
  FRONTEND_DIST: path.join(root, 'missing-frontend'), PUBLIC_URL: 'http://127.0.0.1:5581',
  ADMIN_EMAIL: 'ai-retry@example.test', ADMIN_PASSWORD_FILE: files.password,
  SESSION_SECRET_FILE: files.session, TERRA_GATEWAY_SHARED_SECRET_FILE: files.terra,
  KNOWLEDGE_RUNTIME_BASE_URL: 'http://knowledge.test', KNOWLEDGE_RUNTIME_SHARED_SECRET_FILE: files.knowledge,
  EMAIL_MODE: 'log', SUBSCRIPTION_ENFORCEMENT_ENABLED: 'false',
  X_CREDENTIAL_ENCRYPTION_KEY_FILE: files.xKey, ESIGN_STORAGE_DIR: path.join(root, 'esign'),
  ESIGN_ENCRYPTION_KEY_FILE: files.esignKey,
  X_SEED_CONSUMER_KEY_FILE: path.join(root, 'missing-x-key'),
  X_SEED_CONSUMER_SECRET_FILE: path.join(root, 'missing-x-secret'),
  X_SEED_BEARER_TOKEN_FILE: path.join(root, 'missing-x-bearer'),
  X_SEED_ACCESS_TOKEN_FILE: path.join(root, 'missing-x-token'),
  X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(root, 'missing-x-token-secret'),
  X_SEED_CLIENT_ID_FILE: path.join(root, 'missing-client-id'),
  X_SEED_CLIENT_SECRET_FILE: path.join(root, 'missing-client-secret')
});

const { app } = await import('../src/app.js');
const { createJob, db, getJob } = await import('../src/database.js');
const { executeAiJob } = await import('../src/aiJobs.js');
const { TerraError } = await import('../src/terraClient.js');

after(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

function insertMention(spaceId: string, content: string) {
  const id = crypto.randomUUID(); const timestamp = new Date().toISOString();
  db.prepare(`INSERT INTO social_mentions
    (id,space_id,source,external_id,author,content,url,language,published_at,metadata_json,created_at)
    VALUES (?,?,'other',?,? ,?,'','en',?,'{}',?)`)
    .run(id, spaceId, crypto.randomUUID(), '@retry-test', content, timestamp, timestamp);
  return id;
}

function failJob(id: string, error = 'Terra returned malformed structured output.') {
  const timestamp = new Date().toISOString();
  db.prepare(`UPDATE ai_jobs SET state='failed',stage='failed',progress=100,attempt=3,error=?,retry_at=NULL,
    completed_at=?,updated_at=? WHERE id=?`).run(error, timestamp, timestamp, id);
}

function socialOutput(mentionIds: string[]) {
  return {
    executiveSummary: 'The saved source set contains customer feedback.',
    sentiment: { negative: mentionIds.length, neutral: 0, positive: 0, mixed: 0 },
    themes: [{ name: 'Service friction', mentions: mentionIds.length, sentiment: 'negative', evidence: mentionIds }],
    emergingTrends: [], risks: [], opportunities: [],
    mentions: mentionIds.map((id) => ({
      mentionId: id, sentiment: 'negative', sentimentScore: -0.6, emotions: ['frustration'],
      themes: ['service'], summary: 'The source reports service friction.', risk: 'medium', evidence: id
    }))
  };
}

test('retries only failed same-space social analysis jobs with bounded, auditable identities', async () => {
  const owner = request.agent(app);
  await signupVerifyAndOnboard(owner, {
    name: 'Retry Owner', email: 'ai-retry@example.test', password: 'AI-Retry-Test-Password-2026!'
  });
  const user = db.prepare('SELECT id,active_space_id FROM users WHERE email=?').get('ai-retry@example.test') as {
    id: string; active_space_id: string;
  };
  const mentionIds = [
    insertMention(user.active_space_id, 'The onboarding flow is difficult to complete.'),
    insertMention(user.active_space_id, 'Support response time is too slow for urgent issues.')
  ];
  const job = createJob('social.analyze', { mentionIds }, user.active_space_id, null, null, user.id);
  const output = socialOutput(mentionIds);
  db.prepare('UPDATE ai_jobs SET provider_result_json=? WHERE id=?').run(JSON.stringify({
    activity: 'experience.social_listening', schemaName: 'experience_social_listening', output,
    runtime: { model: 'gpt-5.6-terra' }
  }), job.id);
  failJob(job.id, 'Initial structured result could not be applied.');

  const detail = await owner.get(`/api/ai/jobs/${job.id}`).expect(200);
  assert.deepEqual(detail.body.retry, { eligible: true, reason: null });
  assert.equal(detail.body.runtime.source, 'provider_result');
  assert.equal(detail.body.runtime.status, 'actual');
  assert.equal(detail.body.runtime.model, 'gpt-5.6-terra');
  const listed = await owner.get('/api/ai/jobs').expect(200);
  assert.equal(listed.body.find((item: any) => item.id === job.id)?.runtime.model, 'gpt-5.6-terra');
  await owner.post(`/api/ai/jobs/${job.id}/retry`).send({ force: true }).expect(400);
  const retries = await Promise.all([
    owner.post(`/api/ai/jobs/${job.id}/retry`).send({}),
    owner.post(`/api/ai/jobs/${job.id}/retry`).send({})
  ]);
  assert.deepEqual(retries.map((response) => response.status).sort(), [202, 202]);
  assert.deepEqual(retries.map((response) => response.body.restarted).sort(), [false, true]);
  assert.ok(retries.every((response) => response.body.jobId === job.id));
  const queued = getJob(job.id); assert.ok(queued);
  assert.equal(queued.state, 'queued');
  assert.equal(queued.attempt, 0);
  assert.equal(queued.error, null);
  assert.equal(queued.startedAt, null);
  assert.equal(queued.completedAt, null);
  assert.equal(queued.input.terraExecutionGeneration, 1);
  assert.equal(queued.input.terraManualRetryCount, 1);
  assert.equal(Array.isArray(queued.input.terraManualRetryHistory), true);
  assert.equal((queued.input.terraManualRetryHistory as any[])[0].attempt, 3);
  assert.equal((queued.input.terraManualRetryHistory as any[])[0].providerJournalRetained, true);
  assert.match(String((queued.input.terraManualRetryHistory as any[])[0].sourceIdsSha256), /^[a-f0-9]{64}$/u);
  assert.equal(queued.input.mentionSnapshot, undefined);
  assert.equal(retries.find((response) => response.body.restarted)?.body.journalReused, true);

  for (const expectedGeneration of [2, 3]) {
    failJob(job.id, `Failure before manual retry ${expectedGeneration}.`);
    const next = await owner.post(`/api/ai/jobs/${job.id}/retry`).send({}).expect(202);
    assert.equal(next.body.restarted, true);
    assert.equal(getJob(job.id)?.input.terraExecutionGeneration, expectedGeneration);
  }
  failJob(job.id, 'Retry ceiling reached.');
  const exhausted = await owner.get(`/api/ai/jobs/${job.id}`).expect(200);
  assert.equal(exhausted.body.retry.eligible, false);
  assert.match(exhausted.body.retry.reason, /limit of three manual retries/u);
  const rejectedCeiling = await owner.post(`/api/ai/jobs/${job.id}/retry`).send({}).expect(409);
  assert.equal(rejectedCeiling.body.code, 'AI_JOB_RETRY_EXHAUSTED');
  assert.equal(getJob(job.id)?.input.terraExecutionGeneration, 3);

  const outsider = request.agent(app);
  await signupVerifyAndOnboard(outsider, {
    name: 'Other Tenant', email: 'ai-retry-outsider@example.test', password: 'Other-Tenant-Password-2026!'
  });
  await outsider.get(`/api/ai/jobs/${job.id}`).expect(404);
  await outsider.post(`/api/ai/jobs/${job.id}/retry`).send({}).expect(404);
});

test('advertises missing sources as ineligible and execution never analyzes a surviving subset', async () => {
  const owner = request.agent(app);
  await owner.post('/api/auth/login').send({
    email: 'ai-retry@example.test', password: 'AI-Retry-Test-Password-2026!'
  }).expect(200);
  const user = db.prepare('SELECT id,active_space_id FROM users WHERE email=?').get('ai-retry@example.test') as {
    id: string; active_space_id: string;
  };

  const missingId = insertMention(user.active_space_id, 'This source will be removed before retry.');
  const missingJob = createJob('social.analyze', { mentionIds: [missingId] }, user.active_space_id, null, null, user.id);
  failJob(missingJob.id);
  db.prepare('DELETE FROM social_mentions WHERE id=? AND space_id=?').run(missingId, user.active_space_id);
  const missingDetail = await owner.get(`/api/ai/jobs/${missingJob.id}`).expect(200);
  assert.equal(missingDetail.body.retry.eligible, false);
  assert.match(missingDetail.body.retry.reason, /no longer exist in this space/u);
  const missingRetry = await owner.post(`/api/ai/jobs/${missingJob.id}/retry`).send({}).expect(409);
  assert.equal(missingRetry.body.code, 'AI_JOB_SOURCE_SNAPSHOT_UNAVAILABLE');
  assert.equal(getJob(missingJob.id)?.state, 'failed');

  const first = insertMention(user.active_space_id, 'First preserved source.');
  const second = insertMention(user.active_space_id, 'Second source deleted after requeue.');
  const racedJob = createJob('social.analyze', { mentionIds: [first, second] }, user.active_space_id, null, null, user.id);
  failJob(racedJob.id);
  await owner.post(`/api/ai/jobs/${racedJob.id}/retry`).send({}).expect(202);
  db.prepare('DELETE FROM social_mentions WHERE id=? AND space_id=?').run(second, user.active_space_id);
  await assert.rejects(
    () => executeAiJob(getJob(racedJob.id)!),
    (error: unknown) => error instanceof TerraError
      && error.code === 'MENTION_SNAPSHOT_UNAVAILABLE'
      && error.retryable === false
  );

  const unsupported = createJob('report.generate', {}, user.active_space_id, null, null, user.id);
  failJob(unsupported.id);
  const unsupportedDetail = await owner.get(`/api/ai/jobs/${unsupported.id}`).expect(200);
  assert.equal(unsupportedDetail.body.retry.eligible, false);
  const unsupportedRetry = await owner.post(`/api/ai/jobs/${unsupported.id}/retry`).send({}).expect(409);
  assert.equal(unsupportedRetry.body.code, 'AI_JOB_RETRY_UNSUPPORTED');
});

test('requires live authorized knowledge unless an immutable retrieval context was already saved', async () => {
  const owner = request.agent(app);
  await owner.post('/api/auth/login').send({
    email: 'ai-retry@example.test', password: 'AI-Retry-Test-Password-2026!'
  }).expect(200);
  const user = db.prepare('SELECT id,active_space_id FROM users WHERE email=?').get('ai-retry@example.test') as {
    id: string; active_space_id: string;
  };
  const mentionId = insertMention(user.active_space_id, 'Knowledge-grounded retry source.');
  const missingBaseId = crypto.randomUUID();
  const ref = {
    id: missingBaseId, name: 'Removed knowledge base', indexVersion: 1,
    embeddingModel: 'Alibaba-NLP/gte-modernbert-base', embeddingDimension: 768, chunkerVersion: 'v1',
    embeddingProfile: {
      provider: 'gte-node', model: 'Alibaba-NLP/gte-modernbert-base', revision: 'a'.repeat(40),
      dtype: 'q8', dimensions: 768, vectorIndexVersion: 'gte-modernbert-v1'
    }
  };
  const unavailable = createJob('social.analyze', { mentionIds: [mentionId], knowledgeBaseRefs: [ref] },
    user.active_space_id, null, null, user.id);
  failJob(unavailable.id);
  const unavailableDetail = await owner.get(`/api/ai/jobs/${unavailable.id}`).expect(200);
  assert.equal(unavailableDetail.body.retry.eligible, false);
  assert.match(unavailableDetail.body.retry.reason, /Knowledge base not found/u);
  await owner.post(`/api/ai/jobs/${unavailable.id}/retry`).send({}).expect(404);

  const saved = createJob('social.analyze', { mentionIds: [mentionId], knowledgeBaseRefs: [ref] },
    user.active_space_id, null, null, user.id);
  failJob(saved.id);
  const timestamp = new Date().toISOString();
  db.prepare(`INSERT INTO ai_job_knowledge_contexts
    (ai_job_id,space_id,query_text,knowledge_refs_json,citations_json,context_text,metrics_json,context_bytes,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(saved.id, user.active_space_id, 'saved query', JSON.stringify([ref]), '[]',
      'AUTHORIZED KNOWLEDGE SNAPSHOT\nSaved evidence.', '{}', 45, timestamp);
  const savedDetail = await owner.get(`/api/ai/jobs/${saved.id}`).expect(200);
  assert.deepEqual(savedDetail.body.retry, { eligible: true, reason: null });
  const retried = await owner.post(`/api/ai/jobs/${saved.id}/retry`).send({}).expect(202);
  assert.equal(retried.body.jobId, saved.id);
  assert.equal(retried.body.restarted, true);
});
