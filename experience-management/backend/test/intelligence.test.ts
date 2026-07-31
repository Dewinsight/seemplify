import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';
import { signupVerifyAndOnboard } from './authTestHelper.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-intelligence-'));
const passwordFile = path.join(root, 'admin-password');
const sessionFile = path.join(root, 'session-secret');
const terraFile = path.join(root, 'terra-secret');
const knowledgeFile = path.join(root, 'knowledge-secret');
const xKeyFile = path.join(root, 'x-key');
const esignKeyFile = path.join(root, 'esign-key');
fs.writeFileSync(passwordFile, 'Intelligence-Test-Password-2026!');
fs.writeFileSync(sessionFile, 'intelligence-test-session-secret-that-is-long-enough');
fs.writeFileSync(terraFile, 'intelligence-test-terra-secret-that-is-long-enough');
fs.writeFileSync(knowledgeFile, 'intelligence-test-knowledge-secret-that-is-long-enough');
fs.writeFileSync(xKeyFile, Buffer.alloc(32, 21).toString('base64url'));
fs.writeFileSync(esignKeyFile, Buffer.alloc(32, 22).toString('base64url'));
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'test.sqlite'), UPLOAD_DIR: path.join(root, 'uploads'), FRONTEND_DIST: path.join(root, 'missing-frontend'),
  PUBLIC_URL: 'http://127.0.0.1:5414', ADMIN_EMAIL: 'intelligence@seemplify.local', ADMIN_PASSWORD_FILE: passwordFile,
  SESSION_SECRET_FILE: sessionFile, TERRA_GATEWAY_SHARED_SECRET_FILE: terraFile, LOCAL_LLM_SHARED_SECRET_FILE: terraFile,
  KNOWLEDGE_RUNTIME_BASE_URL: 'http://knowledge.test', KNOWLEDGE_RUNTIME_SHARED_SECRET_FILE: knowledgeFile,
  EMAIL_MODE: 'log', X_CREDENTIAL_ENCRYPTION_KEY_FILE: xKeyFile, ESIGN_STORAGE_DIR: path.join(root, 'esign'),
  ESIGN_ENCRYPTION_KEY_FILE: esignKeyFile, X_SEED_CONSUMER_KEY_FILE: path.join(root, 'missing-x-key'),
  X_SEED_CONSUMER_SECRET_FILE: path.join(root, 'missing-x-secret'), X_SEED_BEARER_TOKEN_FILE: path.join(root, 'missing-x-bearer'),
  X_SEED_ACCESS_TOKEN_FILE: path.join(root, 'missing-x-token'), X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(root, 'missing-x-token-secret'),
  X_SEED_CLIENT_ID_FILE: path.join(root, 'missing-client-id'), X_SEED_CLIENT_SECRET_FILE: path.join(root, 'missing-client-secret')
});

const { app } = await import('../src/app.js');
const { createJob, db, getJob, insertInsight, updateJob } = await import('../src/database.js');
const { executeAiJob } = await import('../src/aiJobs.js');
const { socialListeningJsonSchemaFor, socialListeningResult, socialListeningResultFor } = await import('../src/aiSchemas.js');
const { createSocialReplyDraft, IntelligenceError, validateSocialListeningEvidence } = await import('../src/intelligence.js');
const originalFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = originalFetch;
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

function terraResponse(data: unknown) {
  return new Response(JSON.stringify({
    data, runtimeProfile: 'experience-management', provider: 'local-codex', engine: 'codex', model: 'gpt-5.6-terra',
    usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 }, metrics: { latencyMs: 25, queueWaitMs: 3 }
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

const gteProfile = { provider: 'gte-node', model: 'Alibaba-NLP/gte-modernbert-base',
  revision: 'e7f32e3c00f91d699e8c43b53106206bcc72bb22', dtype: 'q8', dimensions: 768,
  vectorIndexVersion: 'gte-modernbert-v1' } as const;
const bgeReranker = { model: 'BAAI/bge-reranker-v2-m3',
  revision: '953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e', executed: true,
  inputCount: 1, outputCount: 1 } as const;

async function completeQueuedJob(jobId: string, data: unknown) {
  const job = getJob(jobId); assert.ok(job);
  globalThis.fetch = async () => terraResponse(data);
  const result = await executeAiJob(job);
  updateJob(job.id, { state: 'completed', stage: 'completed', progress: 100, result, completedAt: new Date().toISOString() });
  return result;
}

test('saves Terra reply drafts and social intelligence without any automatic X posting capability', async () => {
  const owner = request.agent(app);
  await signupVerifyAndOnboard(owner, { name: 'Research Owner', email: 'intelligence@seemplify.local', password: 'Intelligence-Test-Password-2026!' });
  const user = db.prepare('SELECT id,active_space_id FROM users WHERE email=?').get('intelligence@seemplify.local') as { id: string; active_space_id: string };
  const connectionId = crypto.randomUUID(); const mentionId = crypto.randomUUID(); const timestamp = new Date().toISOString();
  db.prepare(`INSERT INTO x_apps (id,credential_version,configured_by,created_at,updated_at) VALUES ('workspace-x-app',1,?,?,?)`)
    .run(user.id, timestamp, timestamp);
  db.prepare(`INSERT INTO x_connections (id,space_id,user_id,app_id,access_token_enc,auth_type,x_user_id,username,display_name,status,created_at,updated_at)
    VALUES (?,?,?,?,'test-envelope','oauth2','800000000000000001','researcher','Researcher','connected',?,?)`)
    .run(connectionId, user.active_space_id, user.id, 'workspace-x-app', timestamp, timestamp);
  const postText = 'Acme onboarding is confusing and slow for a first-time administrator.';
  db.prepare(`INSERT INTO social_mentions (id,space_id,source,external_id,x_connection_id,ingestion_kind,author,content,url,language,published_at,metadata_json,created_at)
    VALUES (?,?,'x','180000000000000001',?,'mention','@customer',?,'https://x.com/customer/status/180000000000000001','en',?,'{}',?)`)
    .run(mentionId, user.active_space_id, connectionId, postText, timestamp, timestamp);
  db.prepare(`INSERT INTO x_connection_mentions (connection_id,mention_id,streams_json,query_ids_json,discovered_at,last_seen_at)
    VALUES (?,?,'["mention"]','[]',?,?)`).run(connectionId, mentionId, timestamp, timestamp);

  const draftKey = crypto.randomUUID();
  const queuedDraft = await owner.post(`/api/social/mentions/${mentionId}/reply-drafts`).set('Idempotency-Key', draftKey).send({ tone: 'empathetic', instructions: 'Acknowledge the onboarding friction.' }).expect(202);
  const duplicateDraft = await owner.post(`/api/social/mentions/${mentionId}/reply-drafts`).set('Idempotency-Key', draftKey).send({ tone: 'empathetic', instructions: 'Acknowledge the onboarding friction.' }).expect(202);
  assert.equal(duplicateDraft.body.jobId, queuedDraft.body.jobId);
  assert.equal(duplicateDraft.body.deduplicated, true);
  await owner.patch(`/api/social/reply-drafts/${queuedDraft.body.draft.id}`).send({ content: 'Too early to edit.' }).expect(409);
  const storedDraft = db.prepare('SELECT * FROM social_reply_drafts WHERE id=?').get(queuedDraft.body.draft.id) as any;
  assert.match(storedDraft.source_snapshot_json, /onboarding is confusing/);
  assert.equal(storedDraft.generated_content, '');
  await completeQueuedJob(queuedDraft.body.jobId, {
    reply: 'Thanks for sharing this. We hear the onboarding friction and would value the chance to understand where the setup became unclear.',
    rationale: 'Acknowledges the reported friction without claiming a fix or posting automatically.', safetyFlags: []
  });
  const readyDrafts = await owner.get(`/api/social/mentions/${mentionId}/reply-drafts`).expect(200);
  assert.equal(readyDrafts.body[0].state, 'ready');
  assert.equal(readyDrafts.body[0].runtime.model, 'gpt-5.6-terra');
  const completedDraftReplay = await owner.post(`/api/social/mentions/${mentionId}/reply-drafts`).set('Idempotency-Key', draftKey).send({ tone: 'empathetic', instructions: 'Acknowledge the onboarding friction.' }).expect(202);
  assert.equal(completedDraftReplay.body.jobId, queuedDraft.body.jobId);
  assert.equal(completedDraftReplay.body.deduplicated, true);
  await owner.post(`/api/social/mentions/${mentionId}/reply-drafts`).set('Idempotency-Key', draftKey)
    .send({ tone: 'concise', instructions: 'Acknowledge the onboarding friction.' }).expect(409);
  let replayProviderCalls = 0;
  globalThis.fetch = async () => { replayProviderCalls += 1; throw new Error('completed artifact replay must not call Terra'); };
  const replayJob = getJob(queuedDraft.body.jobId); assert.ok(replayJob);
  const replayed = await executeAiJob(replayJob);
  assert.equal(replayProviderCalls, 0);
  assert.equal((replayed as any).output.generatedContent, readyDrafts.body[0].generatedContent);
  await owner.patch(`/api/social/reply-drafts/${queuedDraft.body.draft.id}`).send({ content: 'Thank you for the clear feedback. We are reviewing the onboarding steps you described.' }).expect(200);
  await owner.post(`/api/social/reply-drafts/${queuedDraft.body.draft.id}/post`).send({}).expect(404);

  const socialReportKey = crypto.randomUUID();
  const queuedReport = await owner.post('/api/social/reports').set('Idempotency-Key', socialReportKey).send({ connectionId, title: 'Onboarding listening report', mentionIds: [mentionId] }).expect(202);
  const duplicateReport = await owner.post('/api/social/reports').set('Idempotency-Key', socialReportKey).send({ connectionId, title: 'Onboarding listening report', mentionIds: [mentionId] }).expect(202);
  assert.equal(duplicateReport.body.jobId, queuedReport.body.jobId);
  assert.equal(duplicateReport.body.deduplicated, true);
  const sourceRef = `x-post:${mentionId}`;
  await completeQueuedJob(queuedReport.body.jobId, {
    executiveSummary: 'One saved X post reports onboarding friction.', sentiment: { negative: 1, neutral: 0, positive: 0, mixed: 0 },
    themes: [{ name: 'Onboarding friction', mentions: 1, sentiment: 'negative', evidence: [sourceRef] }],
    emergingTrends: [], risks: [{ issue: 'Setup abandonment', severity: 'medium', evidence: [sourceRef], action: 'Review the first-time setup flow.' }],
    opportunities: [{ opportunity: 'Clarify setup guidance', evidence: [sourceRef], action: 'Test revised onboarding guidance.' }],
    mentions: [{ mentionId: sourceRef, sentiment: 'negative', sentimentScore: -0.7, emotions: ['frustration'], themes: ['onboarding'], summary: 'The author reports difficult onboarding.', risk: 'medium', evidence: sourceRef }]
  });
  const reports = await owner.get(`/api/social/reports?connectionId=${connectionId}`).expect(200);
  assert.equal(reports.body[0].state, 'completed');
  assert.equal(reports.body[0].mentionIds[0], mentionId);
  assert.equal(reports.body[0].runtime.usage.total_tokens, 200);
  const completedReportReplay = await owner.post('/api/social/reports').set('Idempotency-Key', socialReportKey).send({ connectionId, title: 'Onboarding listening report', mentionIds: [mentionId] }).expect(202);
  assert.equal(completedReportReplay.body.jobId, queuedReport.body.jobId);

  const failedReport = await owner.post('/api/social/reports').set('Idempotency-Key', crypto.randomUUID())
    .send({ connectionId, title: 'Recoverable onboarding report', mentionIds: [mentionId] }).expect(202);
  const failedReportOutput = {
    executiveSummary: 'One saved X post reports onboarding friction.',
    sentiment: { negative: 1, neutral: 0, positive: 0, mixed: 0 },
    themes: [{ name: 'Onboarding friction', mentions: 1, sentiment: 'negative', evidence: [`“${postText}”`] }],
    emergingTrends: [], risks: [], opportunities: [],
    mentions: [{ mentionId: sourceRef, sentiment: 'negative', sentimentScore: -0.7, emotions: ['frustration'],
      themes: ['onboarding'], summary: 'The author reports difficult onboarding.', risk: 'medium', evidence: `“${postText}”` }]
  };
  const failedAt = new Date().toISOString();
  db.prepare(`UPDATE ai_jobs SET state='failed',stage='failed',progress=100,attempt=3,error=?,
    provider_result_json=?,completed_at=?,updated_at=? WHERE id=?`).run(
      'Terra returned evidence that was not present in the saved sources.',
      JSON.stringify({
        activity: 'experience.social_listening', schemaName: 'experience_social_listening_report',
        output: failedReportOutput, runtime: { model: 'gpt-5.6-terra', usage: { total_tokens: 200 } }
      }),
      failedAt, failedAt, failedReport.body.jobId
    );
  db.prepare(`UPDATE social_intelligence_reports SET state='failed',error=?,completed_at=?,updated_at=? WHERE id=?`).run(
    'Terra returned evidence that was not present in the saved sources.', failedAt, failedAt, failedReport.body.report.id
  );

  let retryProviderCalls = 0;
  globalThis.fetch = async () => {
    retryProviderCalls += 1;
    throw new Error('a valid durable provider journal must be reused without calling Terra');
  };
  const retriedReport = await owner.post(`/api/social/reports/${failedReport.body.report.id}/retry`).send({}).expect(202);
  assert.equal(retriedReport.body.report.id, failedReport.body.report.id);
  assert.equal(retriedReport.body.jobId, failedReport.body.jobId);
  assert.equal(retriedReport.body.state, 'queued');
  assert.equal(retriedReport.body.journalReused, true);
  assert.equal(retriedReport.body.deduplicated, false);
  assert.equal(getJob(failedReport.body.jobId)?.input.terraExecutionGeneration, 1);
  const duplicateRetry = await owner.post(`/api/social/reports/${failedReport.body.report.id}/retry`).send({}).expect(202);
  assert.equal(duplicateRetry.body.jobId, failedReport.body.jobId);
  assert.equal(duplicateRetry.body.deduplicated, true);
  assert.equal(getJob(failedReport.body.jobId)?.input.terraExecutionGeneration, 1);
  const retryJob = getJob(failedReport.body.jobId); assert.ok(retryJob);
  assert.equal(retryJob.state, 'queued');
  assert.equal(retryJob.attempt, 0);
  const recoveredReport = await executeAiJob(retryJob);
  assert.equal(retryProviderCalls, 0);
  assert.equal((recoveredReport as any).output.id, failedReport.body.report.id);
  assert.equal((recoveredReport as any).output.state, 'completed');
  updateJob(retryJob.id, {
    state: 'completed', stage: 'completed', progress: 100, result: recoveredReport,
    completedAt: new Date().toISOString()
  });

  const staleJournalReport = await owner.post('/api/social/reports').set('Idempotency-Key', crypto.randomUUID())
    .send({ connectionId, title: 'Stale journal recovery report', mentionIds: [mentionId] }).expect(202);
  db.prepare('UPDATE ai_jobs SET provider_result_json=? WHERE id=?').run(JSON.stringify({
    activity: 'experience.social_listening', schemaName: 'experience_social_listening_report',
    output: { malformed: true }, runtime: { model: 'gpt-5.6-terra' }
  }), staleJournalReport.body.jobId);
  const staleFailedAt = new Date().toISOString();
  db.prepare(`UPDATE ai_jobs SET state='failed',stage='failed',progress=100,attempt=3,error=?,
    completed_at=?,updated_at=? WHERE id=?`).run(
      'Terra returned evidence that was not present in the saved sources.',
      staleFailedAt, staleFailedAt, staleJournalReport.body.jobId
    );
  db.prepare(`UPDATE social_intelligence_reports SET state='failed',error=?,completed_at=?,updated_at=? WHERE id=?`).run(
    'Terra returned evidence that was not present in the saved sources.',
    staleFailedAt, staleFailedAt, staleJournalReport.body.report.id
  );
  const freshRetry = await owner.post(`/api/social/reports/${staleJournalReport.body.report.id}/retry`).send({}).expect(202);
  assert.equal(freshRetry.body.report.id, staleJournalReport.body.report.id);
  assert.equal(freshRetry.body.jobId, staleJournalReport.body.jobId);
  assert.equal(freshRetry.body.journalReused, false);
  assert.equal(getJob(staleJournalReport.body.jobId)?.input.terraExecutionGeneration, 1);
  let replacementProviderCalls = 0;
  globalThis.fetch = async (_url, init) => {
    replacementProviderCalls += 1;
    const requestBody = JSON.parse(String(init?.body || '{}'));
    assert.equal(requestBody.metering.requestId, staleJournalReport.body.jobId);
    const originalEventId = `usage_${crypto.createHash('sha256')
      .update(`experience:${staleJournalReport.body.jobId}`).digest('hex').slice(0, 48)}`;
    assert.notEqual(requestBody.metering.eventId, originalEventId);
    return terraResponse({
      executiveSummary: 'One saved X post reports onboarding friction.',
      sentiment: { negative: 1, neutral: 0, positive: 0, mixed: 0 },
      themes: [{ name: 'Onboarding friction', mentions: 1, sentiment: 'negative', evidence: [sourceRef] }],
      emergingTrends: [], risks: [], opportunities: [],
      mentions: [{ mentionId: sourceRef, sentiment: 'negative', sentimentScore: -0.7, emotions: ['frustration'],
        themes: ['onboarding'], summary: 'The author reports difficult onboarding.', risk: 'medium', evidence: sourceRef }]
    });
  };
  const staleJournalJob = getJob(staleJournalReport.body.jobId); assert.ok(staleJournalJob);
  const replacedJournalResult = await executeAiJob(staleJournalJob);
  assert.equal(replacementProviderCalls, 1);
  assert.equal((replacedJournalResult as any).output.id, staleJournalReport.body.report.id);
  assert.equal((replacedJournalResult as any).output.state, 'completed');
  updateJob(staleJournalJob.id, {
    state: 'completed', stage: 'completed', progress: 100, result: replacedJournalResult,
    completedAt: new Date().toISOString()
  });

  const correctiveReport = await owner.post('/api/social/reports').set('Idempotency-Key', crypto.randomUUID())
    .send({ connectionId, title: 'Corrective execution report', mentionIds: [mentionId] }).expect(202);
  db.prepare(`UPDATE ai_jobs SET state='processing',stage='dispatching',attempt=3 WHERE id=?`)
    .run(correctiveReport.body.jobId);
  const invalidEvidenceOutput = {
    executiveSummary: 'One saved X post reports onboarding friction.',
    sentiment: { negative: 1, neutral: 0, positive: 0, mixed: 0 },
    themes: [{ name: 'Onboarding friction', mentions: 1, sentiment: 'negative',
      evidence: ['This evidence was not supplied by the saved post.'] }],
    emergingTrends: [], risks: [], opportunities: [],
    mentions: [{ mentionId: sourceRef, sentiment: 'negative', sentimentScore: -0.7, emotions: ['frustration'],
      themes: ['onboarding'], summary: 'The author reports difficult onboarding.', risk: 'medium', evidence: sourceRef }]
  };
  const correctedEvidenceOutput = {
    ...invalidEvidenceOutput,
    themes: [{ name: 'Onboarding friction', mentions: 1, sentiment: 'negative', evidence: [sourceRef] }]
  };
  const correctionBodies: any[] = [];
  globalThis.fetch = async (_url, init) => {
    correctionBodies.push(JSON.parse(String(init?.body || '{}')));
    return terraResponse(correctionBodies.length === 1 ? invalidEvidenceOutput : correctedEvidenceOutput);
  };
  const firstCorrectiveJob = getJob(correctiveReport.body.jobId); assert.ok(firstCorrectiveJob);
  await assert.rejects(() => executeAiJob(firstCorrectiveJob),
    (error: any) => error?.code === 'TERRA_EVIDENCE_RETRY' && error?.retryable === true);
  const correctionScheduled = getJob(correctiveReport.body.jobId); assert.ok(correctionScheduled);
  assert.equal(correctionScheduled.input.terraExecutionGeneration, 1);
  assert.equal(correctionScheduled.input.terraCorrectionRequired, true);
  assert.equal(correctionScheduled.input.terraExecutionReason, 'semantic_correction');
  assert.equal(correctionScheduled.input.terraSemanticCorrectionCount, 1);
  db.prepare(`UPDATE ai_jobs SET attempt=4 WHERE id=?`).run(correctiveReport.body.jobId);
  const secondCorrectiveJob = getJob(correctiveReport.body.jobId); assert.ok(secondCorrectiveJob);
  const correctedResult = await executeAiJob(secondCorrectiveJob);
  updateJob(secondCorrectiveJob.id, {
    state: 'completed', stage: 'completed', progress: 100, result: correctedResult,
    completedAt: new Date().toISOString()
  });
  assert.equal(correctionBodies.length, 2);
  assert.equal(correctionBodies[0].metering.requestId, correctiveReport.body.jobId);
  assert.equal(correctionBodies[1].metering.requestId, correctiveReport.body.jobId);
  assert.notEqual(correctionBodies[0].metering.eventId, correctionBodies[1].metering.eventId);
  assert.match(correctionBodies[1].messages[1].content, /Corrective attempt:/);
  assert.equal((correctedResult as any).output.id, correctiveReport.body.report.id);
  assert.equal((correctedResult as any).output.state, 'completed');

  const repeatedRetryReport = await owner.post('/api/social/reports').set('Idempotency-Key', crypto.randomUUID())
    .send({ connectionId, title: 'Repeated manual retry report', mentionIds: [mentionId] }).expect(202);
  const failRepeatedRetry = () => {
    const failedAt = new Date().toISOString();
    db.prepare(`UPDATE ai_jobs SET state='failed',stage='failed',progress=100,error='test failure',
      completed_at=?,updated_at=? WHERE id=?`).run(failedAt, failedAt, repeatedRetryReport.body.jobId);
    db.prepare(`UPDATE social_intelligence_reports SET state='failed',error='test failure',
      completed_at=?,updated_at=? WHERE id=?`).run(failedAt, failedAt, repeatedRetryReport.body.report.id);
  };
  failRepeatedRetry();
  const concurrentRetries = await Promise.all([
    owner.post(`/api/social/reports/${repeatedRetryReport.body.report.id}/retry`).send({}),
    owner.post(`/api/social/reports/${repeatedRetryReport.body.report.id}/retry`).send({})
  ]);
  assert.deepEqual(concurrentRetries.map((response) => response.status).sort(), [202, 202]);
  assert.deepEqual(concurrentRetries.map((response) => response.body.deduplicated).sort(), [false, true]);
  assert.equal(getJob(repeatedRetryReport.body.jobId)?.input.terraExecutionGeneration, 1);
  assert.equal(getJob(repeatedRetryReport.body.jobId)?.input.terraSemanticCorrectionCount, 0);
  assert.equal(getJob(repeatedRetryReport.body.jobId)?.input.terraCorrectionRequired, false);
  failRepeatedRetry();
  const secondManualRetry = await owner.post(`/api/social/reports/${repeatedRetryReport.body.report.id}/retry`).send({}).expect(202);
  assert.equal(secondManualRetry.body.jobId, repeatedRetryReport.body.jobId);
  assert.equal(getJob(repeatedRetryReport.body.jobId)?.input.terraExecutionGeneration, 2);

  const groundedBase = await owner.post('/api/knowledge-bases').send({
    name: 'Support policy', description: 'Approved support guidance', privacy: 'space', terraContextEnabled: true
  }).expect(201);
  const knowledgeBaseId = groundedBase.body.knowledgeBase.id as string;
  const knowledgeDocumentId = crypto.randomUUID();
  db.prepare(`UPDATE knowledge_bases SET status='ready',embedding_provider=?,embedding_model=?,embedding_revision=?,
    embedding_dtype=?,embedding_dimension=?,vector_index_version=?,current_version=1,last_allocated_version=1,
    last_indexed_at=?,updated_at=? WHERE id=? AND space_id=?`).run(gteProfile.provider, gteProfile.model,
      gteProfile.revision, gteProfile.dtype, gteProfile.dimensions, gteProfile.vectorIndexVersion, timestamp, timestamp,
      knowledgeBaseId, user.active_space_id);
  db.prepare(`DELETE FROM knowledge_base_embedding_profiles WHERE knowledge_base_id=? AND space_id=?`)
    .run(knowledgeBaseId, user.active_space_id);
  db.prepare(`INSERT INTO knowledge_base_embedding_profiles
    (space_id,knowledge_base_id,vector_index_version,mode,state,current_version,created_at,updated_at)
    VALUES (?,?,?,'primary','ready',1,?,?)`).run(user.active_space_id, knowledgeBaseId,
      gteProfile.vectorIndexVersion, timestamp, timestamp);
  db.prepare(`INSERT INTO knowledge_documents
    (id,space_id,knowledge_base_id,created_by,stored_filename,original_name,mime_type,size_bytes,sha256,state,index_version,
      page_count,chunk_count,language,created_at,updated_at,indexed_at)
    VALUES (?,?,?,?,?,?,?,?,?,'ready',1,1,1,'en',?,?,?)`).run(knowledgeDocumentId, user.active_space_id,
      knowledgeBaseId, user.id, `${knowledgeDocumentId}.md`, 'support-policy.md', 'text/markdown', 128, 'a'.repeat(64),
      timestamp, timestamp, timestamp);

  const groundedAnalysis = await owner.post('/api/social/analyze').send({
    mentionIds: [mentionId], knowledgeBaseIds: [knowledgeBaseId]
  }).expect(202);
  const groundedAnalysisJob = getJob(groundedAnalysis.body.jobId); assert.ok(groundedAnalysisJob);
  assert.equal(groundedAnalysisJob.input.knowledgeBaseIds, undefined);
  assert.deepEqual((groundedAnalysisJob.input.knowledgeBaseRefs as any[]).map((ref) => ref.id), [knowledgeBaseId]);

  const groundedReportKey = crypto.randomUUID();
  const groundedReportInput = {
    connectionId, title: 'Grounded onboarding report', mentionIds: [mentionId], knowledgeBaseIds: [knowledgeBaseId]
  };
  const groundedReport = await owner.post('/api/social/reports').set('Idempotency-Key', groundedReportKey)
    .send(groundedReportInput).expect(202);
  const groundedReportJob = getJob(groundedReport.body.jobId); assert.ok(groundedReportJob);
  assert.deepEqual((groundedReportJob.input.knowledgeBaseRefs as any[]).map((ref) => ref.id), [knowledgeBaseId]);
  assert.deepEqual(groundedReport.body.report.knowledgeBaseIds, [knowledgeBaseId]);
  const groundedReportReplay = await owner.post('/api/social/reports').set('Idempotency-Key', groundedReportKey)
    .send(groundedReportInput).expect(202);
  assert.equal(groundedReportReplay.body.jobId, groundedReport.body.jobId);
  assert.equal(groundedReportReplay.body.deduplicated, true);
  const changedKnowledgeReplay = await owner.post('/api/social/reports').set('Idempotency-Key', groundedReportKey)
    .send({ connectionId, title: groundedReportInput.title, mentionIds: [mentionId] }).expect(409);
  assert.match(changedKnowledgeReplay.body.error, /different knowledge selection/u);
  await owner.post('/api/social/reports')
    .send({ connectionId, title: groundedReportInput.title, mentionIds: [mentionId] }).expect(409);

  const privateBase = await owner.post('/api/knowledge-bases').send({
    name: 'Private notes', privacy: 'private', terraContextEnabled: true
  }).expect(201);
  const privateSelection = await owner.post('/api/social/analyze').send({
    mentionIds: [mentionId], knowledgeBaseIds: [privateBase.body.knowledgeBase.id]
  }).expect(409);
  assert.equal(privateSelection.body.code, 'KNOWLEDGE_PRIVATE_CONTEXT_NOT_SHAREABLE');
  const tooManyKnowledgeBases = Array.from({ length: 6 }, () => crypto.randomUUID());
  await owner.post('/api/social/analyze').send({ mentionIds: [mentionId], knowledgeBaseIds: tooManyKnowledgeBases }).expect(400);
  await owner.post('/api/social/reports').send({
    connectionId, title: 'Too many knowledge bases', mentionIds: [mentionId], knowledgeBaseIds: tooManyKnowledgeBases
  }).expect(400);

  let activeGroundedJob: { id: string; kind: 'social.analyze' | 'social.report' } | null = null;
  const retrievalCalls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === 'knowledge.test') {
      const payload = JSON.parse(String(init?.body || '{}')) as any;
      assert.equal(url.pathname, '/v1/retrieve');
      assert.equal(payload.requestId, `${activeGroundedJob?.id}:knowledge`);
      assert.deepEqual(payload.embeddingProfile, gteProfile);
      assert.deepEqual(payload.knowledgeBases.map((base: any) => base.id), [knowledgeBaseId]);
      assert.deepEqual(payload.knowledgeBases[0].embeddingProfile, gteProfile);
      assert.deepEqual(payload.retrieval, { vector: true, bm25: true, fusion: 'rrf', rerank: true });
      retrievalCalls.push(activeGroundedJob!.kind);
      return new Response(JSON.stringify({
        citations: [{ sourceRef: `${knowledgeBaseId}:${knowledgeDocumentId}:support`, knowledgeBaseId,
          documentId: knowledgeDocumentId, documentName: 'support-policy.md', page: 1,
          excerpt: 'Approved support guidance requires acknowledging onboarding friction.', score: 0.97 }],
        metrics: { fusion: 'weighted-rrf+local-reranker', rerankedCount: 1,
          timings: { vectorMs: 2, bm25Ms: 1, rrfMs: 1, rerankerMs: 3 }, reranker: bgeReranker,
          embeddingProfile: gteProfile, providerFallback: null, providerRouting: null }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const context = db.prepare(`SELECT knowledge_refs_json,metrics_json,context_text FROM ai_job_knowledge_contexts
      WHERE ai_job_id=? AND space_id=?`).get(activeGroundedJob!.id, user.active_space_id) as any;
    assert.ok(context, `${activeGroundedJob!.kind} must persist the exact retrieval snapshot before Terra dispatch`);
    assert.deepEqual(JSON.parse(context.knowledge_refs_json).map((ref: any) => ref.id), [knowledgeBaseId]);
    const metrics = JSON.parse(context.metrics_json);
    assert.equal(metrics.fusion, 'weighted-rrf+local-reranker');
    assert.equal(metrics.rerankedCount, 1);
    assert.equal(metrics.timings.rerankerMs, 3);
    assert.deepEqual(metrics.embeddingProfile, gteProfile);
    assert.deepEqual(metrics.reranker, bgeReranker);
    assert.match(context.context_text, /Approved support guidance/u);
    const sourceRef = activeGroundedJob!.kind === 'social.report' ? `x-post:${mentionId}` : mentionId;
    return terraResponse({
      executiveSummary: 'One saved X post reports onboarding friction.',
      sentiment: { negative: 1, neutral: 0, positive: 0, mixed: 0 },
      themes: [{ name: 'Onboarding friction', mentions: 1, sentiment: 'negative', evidence: [sourceRef] }],
      emergingTrends: [], risks: [], opportunities: [],
      mentions: [{ mentionId: sourceRef, sentiment: 'negative', sentimentScore: -0.7,
        emotions: ['frustration'], themes: ['onboarding'], summary: 'The author reports difficult onboarding.',
        risk: 'medium', evidence: sourceRef }]
    });
  };

  for (const groundedJob of [groundedAnalysisJob, groundedReportJob]) {
    activeGroundedJob = { id: groundedJob.id, kind: groundedJob.kind as 'social.analyze' | 'social.report' };
    const result = await executeAiJob(groundedJob);
    updateJob(groundedJob.id, { state: 'completed', stage: 'completed', progress: 100, result,
      completedAt: new Date().toISOString() });
    const snapshot = db.prepare('SELECT metrics_json FROM ai_job_knowledge_contexts WHERE ai_job_id=? AND space_id=?')
      .get(groundedJob.id, user.active_space_id) as any;
    assert.ok(snapshot);
    assert.equal(Number((db.prepare(`SELECT COUNT(*) count FROM knowledge_audit_events
      WHERE ai_job_id=? AND action='knowledge.context_snapshot_created'`).get(groundedJob.id) as any).count), 1);
  }
  assert.deepEqual(retrievalCalls, ['social.analyze', 'social.report']);

  const journaledDraft = createSocialReplyDraft({ id: user.id } as any, user.active_space_id, { mentionId, tone: 'professional', instructions: 'Keep this for recovery.' });
  const journaledOutput = { reply: 'Thank you for describing the onboarding difficulty so clearly.', rationale: 'Acknowledges only the supplied issue.', safetyFlags: [] };
  db.prepare('UPDATE ai_jobs SET provider_result_json=? WHERE id=?').run(JSON.stringify({
    activity: 'experience.social_reply_draft', schemaName: 'experience_social_reply_draft', output: journaledOutput,
    runtime: { model: 'gpt-5.6-terra', usage: { total_tokens: 200 } }
  }), journaledDraft.job.id);
  let recoveryProviderCalls = 0;
  globalThis.fetch = async () => { recoveryProviderCalls += 1; throw new Error('journal recovery must not call Terra'); };
  const recovered = await executeAiJob(getJob(journaledDraft.job.id)!);
  assert.equal(recoveryProviderCalls, 0);
  assert.equal((recovered as any).output.generatedContent, journaledOutput.reply);
  updateJob(journaledDraft.job.id, { state: 'completed', stage: 'completed', progress: 100, result: recovered, completedAt: new Date().toISOString() });

  const member = request.agent(app);
  await signupVerifyAndOnboard(member, { name: 'Research Member', email: 'research-member@seemplify.local', password: 'Research-Member-Password-2026!' });
  await member.get(`/api/ai/jobs/${queuedDraft.body.jobId}`).expect(404);
  await member.post('/api/social/analyze').send({ mentionIds: [mentionId] }).expect(404);
  assert.deepEqual((await member.get('/api/social/reply-drafts').expect(200)).body, []);
  assert.deepEqual((await member.get('/api/social/reports').expect(200)).body, []);
  await member.post(`/api/social/reports/${failedReport.body.report.id}/retry`).send({}).expect(404);
  const unattributedPrivateJob = createJob('social.analyze', { mentionIds: [mentionId] }, user.active_space_id);
  await owner.get(`/api/ai/jobs/${unattributedPrivateJob.id}`).expect(200);
  await member.get(`/api/ai/jobs/${unattributedPrivateJob.id}`).expect(404);
});

test('combines selected historical survey and social reports with immutable evidence snapshots', async () => {
  const owner = request.agent(app);
  await owner.post('/api/auth/login').send({ email: 'intelligence@seemplify.local', password: 'Intelligence-Test-Password-2026!' }).expect(200);
  const survey = await owner.post('/api/surveys').send({ title: 'Onboarding experience', description: 'First-time setup research', questions: [] }).expect(201);
  const surveySummary = 'Survey participants said onboarding instructions were difficult to follow.';
  const insight = insertInsight(survey.body.id, 'ai_insights', { executiveSummary: surveySummary, healthScore: 48 });
  const socialReport = db.prepare("SELECT id,result_json FROM social_intelligence_reports WHERE state='completed' AND title='Onboarding listening report' LIMIT 1").get() as any;
  assert.ok(socialReport);
  const sources = await owner.get('/api/intelligence/sources').expect(200);
  const surveyRef = `survey-insight:${insight.id}`; const socialRef = `social-report:${socialReport.id}`;
  assert.ok(sources.body.some((source: any) => source.ref === surveyRef));
  assert.ok(sources.body.some((source: any) => source.ref === socialRef));

  const combinedKey = crypto.randomUUID();
  const queued = await owner.post('/api/intelligence/reports').set('Idempotency-Key', combinedKey).send({
    title: 'Onboarding evidence synthesis', objective: 'Find shared onboarding risks.', sourceRefs: [surveyRef, socialRef]
  }).expect(202);
  const duplicate = await owner.post('/api/intelligence/reports').set('Idempotency-Key', combinedKey).send({
    title: 'Onboarding evidence synthesis', objective: 'Find shared onboarding risks.', sourceRefs: [socialRef, surveyRef]
  }).expect(202);
  assert.equal(duplicate.body.jobId, queued.body.jobId);
  assert.equal(duplicate.body.deduplicated, true);
  const snapshotBeforeExecution = db.prepare('SELECT source_snapshot_json,result_json FROM intelligence_reports WHERE id=?').get(queued.body.report.id) as any;
  assert.match(snapshotBeforeExecution.source_snapshot_json, /Onboarding experience/);
  assert.match(snapshotBeforeExecution.source_snapshot_json, /Onboarding listening report/);
  assert.equal(snapshotBeforeExecution.result_json, null);
  const surveyEvidence = surveySummary;
  const socialEvidence = 'One saved X post reports onboarding friction.';
  await completeQueuedJob(queued.body.jobId, {
    title: 'Onboarding evidence synthesis', executiveSummary: 'Survey and social evidence both identify onboarding friction.', confidence: 0.84,
    themes: [{ title: 'Onboarding clarity', detail: 'Both sources identify setup difficulty.', confidence: 0.84,
      evidence: [{ sourceRef: surveyRef, excerpt: surveyEvidence, relevance: 'Direct survey finding.' }, { sourceRef: socialRef, excerpt: socialEvidence, relevance: 'Direct social report summary.' }] }],
    convergence: [{ title: 'Shared friction', detail: 'The sources converge on onboarding.', confidence: 0.8,
      evidence: [{ sourceRef: surveyRef, excerpt: surveyEvidence, relevance: 'Survey signal.' }, { sourceRef: socialRef, excerpt: socialEvidence, relevance: 'Social signal.' }] }],
    divergence: [], risks: [], opportunities: [],
    recommendations: [{ action: 'Test clearer first-time setup guidance.', priority: 'now', rationale: 'Both selected sources identify onboarding friction.',
      evidence: [{ sourceRef: surveyRef, excerpt: surveyEvidence, relevance: 'Supports intervention.' }, { sourceRef: socialRef, excerpt: socialEvidence, relevance: 'Supports intervention.' }] }],
    limitations: ['The selected social report contains one X post.']
  });
  const history = await owner.get('/api/intelligence/reports').expect(200);
  assert.equal(history.body[0].state, 'completed');
  assert.equal(history.body[0].runtime.usage.total_tokens, 200);
  assert.deepEqual(history.body[0].sourceRefs, { survey: [surveyRef], social: [socialRef] });
  const completedReplay = await owner.post('/api/intelligence/reports').set('Idempotency-Key', combinedKey).send({
    title: 'Onboarding evidence synthesis', objective: 'Find shared onboarding risks.', sourceRefs: [surveyRef, socialRef]
  }).expect(202);
  assert.equal(completedReplay.body.jobId, queued.body.jobId);

  const invalid = await owner.post('/api/intelligence/reports').send({ title: 'Invalid evidence run', sourceRefs: [surveyRef, socialRef] }).expect(202);
  const invalidJob = getJob(invalid.body.jobId); assert.ok(invalidJob);
  globalThis.fetch = async () => terraResponse({
    title: 'Invalid', executiveSummary: 'Invalid evidence.', confidence: 0.5,
    themes: [{ title: 'Fabricated', detail: 'This must be rejected.', confidence: 0.5,
      evidence: [{ sourceRef: surveyRef, excerpt: 'A quote that is absent from every selected source.', relevance: 'Invalid.' }] }],
    convergence: [], divergence: [], risks: [], opportunities: [], recommendations: [], limitations: []
  });
  await assert.rejects(executeAiJob(invalidJob), (error: unknown) => error instanceof IntelligenceError && error.status === 400);
});

test('pins the social-listening JSON schema to the exact saved source set', () => {
  const schema = socialListeningJsonSchemaFor(['x-post:first', ' x-post:second ', 'x-post:first']) as any;
  const expected = ['x-post:first', 'x-post:second'];
  for (const section of ['themes', 'emergingTrends', 'risks', 'opportunities']) {
    assert.deepEqual(schema.properties[section].items.properties.evidence.items.enum, expected);
    assert.equal(schema.properties[section].items.properties.evidence.maxItems, 200);
  }
  assert.equal(schema.properties.mentions.minItems, 2);
  assert.equal(schema.properties.mentions.maxItems, 2);
  assert.deepEqual(schema.properties.mentions.items.properties.mentionId.enum, expected);
  assert.deepEqual(schema.properties.mentions.items.properties.evidence.enum, expected);
  assert.throws(() => socialListeningJsonSchemaFor([]), /At least one social source reference/u);
});

test('canonicalizes oversized grounded social evidence without weakening source validation', () => {
  const sourceRefs = Array.from({ length: 25 }, (_, index) => `x-post:${index + 1}`);
  const payload = {
    executiveSummary: 'The bounded source set contains one recurring theme.',
    sentiment: { negative: 0, neutral: 25, positive: 0, mixed: 0 },
    themes: [{
      name: 'Recurring feedback',
      mentions: 25,
      sentiment: 'neutral',
      evidence: [...sourceRefs, sourceRefs[0], sourceRefs[1]]
    }],
    emergingTrends: [],
    risks: [],
    opportunities: [],
    mentions: sourceRefs.map((sourceRef) => ({
      mentionId: sourceRef,
      sentiment: 'neutral',
      sentimentScore: 0,
      emotions: [],
      themes: ['Recurring feedback'],
      summary: 'A saved post contributes to the recurring theme.',
      risk: 'low',
      evidence: sourceRef
    }))
  };
  assert.equal(socialListeningResult.safeParse(payload).success, false);
  const parsed = socialListeningResultFor(sourceRefs).safeParse(payload);
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.deepEqual(parsed.data.themes[0].evidence, sourceRefs.slice(0, 20));

  const fabricated = socialListeningResultFor(sourceRefs).safeParse({
    ...payload,
    themes: [{
      ...payload.themes[0],
      evidence: [...sourceRefs.slice(0, 20), 'x-post:not-supplied']
    }]
  });
  assert.equal(fabricated.success, false);
});

test('accepts source references and presentation-only quote or ellipsis changes while rejecting fabricated social evidence', () => {
  const sources = [
    { sourceRef: 'short-post', content: 'Thanks!' },
    { sourceRef: 'quoted-post', content: 'The customer said "setup is confusing" before adding that support fixed it.' },
    { sourceRef: 'long-post', content: 'The onboarding guide made account setup much easier today, although account permissions remained hard to understand for new administrators.' }
  ];
  const resultFor = (evidence: string[]) => ({
    sentiment: { negative: 0, neutral: sources.length, positive: 0, mixed: 0 },
    themes: [{ name: 'Feedback', mentions: sources.length, sentiment: 'neutral', evidence }],
    emergingTrends: [], risks: [], opportunities: [],
    mentions: sources.map((source) => ({ mentionId: source.sourceRef, evidence: source.sourceRef }))
  });

  assert.doesNotThrow(() => validateSocialListeningEvidence(sources, resultFor(sources.map((source) => source.sourceRef))));
  assert.doesNotThrow(() => validateSocialListeningEvidence(sources, resultFor([
    '“The customer said ‘setup is confusing’ before adding that support fixed it.”'
  ])));
  assert.doesNotThrow(() => validateSocialListeningEvidence(sources, resultFor([
    'The onboarding guide made account setup much easier … account permissions remained hard to understand'
  ])));

  assert.throws(() => validateSocialListeningEvidence(sources, resultFor([
    'account permissions remained hard to understand … The onboarding guide made account setup much easier'
  ])), /not present in the saved sources/u);
  assert.throws(() => validateSocialListeningEvidence(sources, resultFor([
    'The customer said setup is confusing … account permissions remained hard to understand'
  ])), /not present in the saved sources/u);
  assert.throws(() => validateSocialListeningEvidence(sources, resultFor(['onboarding'])),
    /not present in the saved sources/u);
  assert.throws(() => validateSocialListeningEvidence(sources, resultFor([
    'Customers said onboarding takes several hours and blocks every administrator.'
  ])), /not present in the saved sources/u);
  assert.throws(() => validateSocialListeningEvidence(sources, {
    ...resultFor(['short-post']),
    mentions: [
      { mentionId: 'short-post', evidence: 'quoted-post' },
      { mentionId: 'quoted-post', evidence: 'quoted-post' },
      { mentionId: 'long-post', evidence: 'long-post' }
    ]
  }), /ungrounded evidence for short-post/u);
});

test('deleting a user deletes their private AI payloads instead of making them globally visible', () => {
  const member = db.prepare('SELECT id,active_space_id FROM users WHERE email=?').get('research-member@seemplify.local') as { id: string; active_space_id: string };
  const privateJob = createJob('social.analyze', { mentionIds: ['private-source-id'] }, member.active_space_id, null, null, member.id);
  assert.ok(getJob(privateJob.id));
  db.prepare('DELETE FROM spaces WHERE id=?').run(member.active_space_id);
  db.prepare('DELETE FROM users WHERE id=?').run(member.id);
  assert.equal(getJob(privateJob.id), null);
});
