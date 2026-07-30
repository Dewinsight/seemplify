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
const xKeyFile = path.join(root, 'x-key');
const esignKeyFile = path.join(root, 'esign-key');
fs.writeFileSync(passwordFile, 'Intelligence-Test-Password-2026!');
fs.writeFileSync(sessionFile, 'intelligence-test-session-secret-that-is-long-enough');
fs.writeFileSync(terraFile, 'intelligence-test-terra-secret-that-is-long-enough');
fs.writeFileSync(xKeyFile, Buffer.alloc(32, 21).toString('base64url'));
fs.writeFileSync(esignKeyFile, Buffer.alloc(32, 22).toString('base64url'));
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'test.sqlite'), UPLOAD_DIR: path.join(root, 'uploads'), FRONTEND_DIST: path.join(root, 'missing-frontend'),
  PUBLIC_URL: 'http://127.0.0.1:5414', ADMIN_EMAIL: 'intelligence@seemplify.local', ADMIN_PASSWORD_FILE: passwordFile,
  SESSION_SECRET_FILE: sessionFile, TERRA_GATEWAY_SHARED_SECRET_FILE: terraFile, LOCAL_LLM_SHARED_SECRET_FILE: terraFile,
  EMAIL_MODE: 'log', X_CREDENTIAL_ENCRYPTION_KEY_FILE: xKeyFile, ESIGN_STORAGE_DIR: path.join(root, 'esign'),
  ESIGN_ENCRYPTION_KEY_FILE: esignKeyFile, X_SEED_CONSUMER_KEY_FILE: path.join(root, 'missing-x-key'),
  X_SEED_CONSUMER_SECRET_FILE: path.join(root, 'missing-x-secret'), X_SEED_BEARER_TOKEN_FILE: path.join(root, 'missing-x-bearer'),
  X_SEED_ACCESS_TOKEN_FILE: path.join(root, 'missing-x-token'), X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(root, 'missing-x-token-secret'),
  X_SEED_CLIENT_ID_FILE: path.join(root, 'missing-client-id'), X_SEED_CLIENT_SECRET_FILE: path.join(root, 'missing-client-secret')
});

const { app } = await import('../src/app.js');
const { createJob, db, getJob, insertInsight, updateJob } = await import('../src/database.js');
const { executeAiJob } = await import('../src/aiJobs.js');
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
    themes: [{ name: 'Onboarding friction', mentions: 1, sentiment: 'negative', evidence: [postText] }],
    emergingTrends: [], risks: [{ issue: 'Setup abandonment', severity: 'medium', evidence: [postText], action: 'Review the first-time setup flow.' }],
    opportunities: [{ opportunity: 'Clarify setup guidance', evidence: [postText], action: 'Test revised onboarding guidance.' }],
    mentions: [{ mentionId: sourceRef, sentiment: 'negative', sentimentScore: -0.7, emotions: ['frustration'], themes: ['onboarding'], summary: 'The author reports difficult onboarding.', risk: 'medium', evidence: postText }]
  });
  const reports = await owner.get(`/api/social/reports?connectionId=${connectionId}`).expect(200);
  assert.equal(reports.body[0].state, 'completed');
  assert.equal(reports.body[0].mentionIds[0], mentionId);
  assert.equal(reports.body[0].runtime.usage.total_tokens, 200);
  const completedReportReplay = await owner.post('/api/social/reports').set('Idempotency-Key', socialReportKey).send({ connectionId, title: 'Onboarding listening report', mentionIds: [mentionId] }).expect(202);
  assert.equal(completedReportReplay.body.jobId, queuedReport.body.jobId);

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
  const socialReport = db.prepare("SELECT id,result_json FROM social_intelligence_reports WHERE state='completed' ORDER BY created_at DESC LIMIT 1").get() as any;
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

test('grounds mixed short and long social posts without letting one short post poison the batch', () => {
  const sources = [
    { sourceRef: 'short-post', content: 'Thanks!' },
    { sourceRef: 'long-post', content: 'The onboarding guide made account setup much easier today.' }
  ];
  const result = {
    sentiment: { negative: 0, neutral: 1, positive: 1, mixed: 0 },
    themes: [{ name: 'Feedback', mentions: 2, sentiment: 'positive', evidence: ['Thanks!', 'onboarding guide'] }],
    emergingTrends: [], risks: [], opportunities: [],
    mentions: [
      { mentionId: 'short-post', evidence: 'Thanks!' },
      { mentionId: 'long-post', evidence: 'onboarding guide' }
    ]
  };
  assert.doesNotThrow(() => validateSocialListeningEvidence(sources, result));
  assert.throws(() => validateSocialListeningEvidence(sources, {
    ...result, mentions: [{ mentionId: 'short-post', evidence: 'Thanks' }, result.mentions[1]]
  }), /ungrounded evidence/u);
});

test('deleting a user deletes their private AI payloads instead of making them globally visible', () => {
  const member = db.prepare('SELECT id,active_space_id FROM users WHERE email=?').get('research-member@seemplify.local') as { id: string; active_space_id: string };
  const privateJob = createJob('social.analyze', { mentionIds: ['private-source-id'] }, member.active_space_id, null, null, member.id);
  assert.ok(getJob(privateJob.id));
  db.prepare('DELETE FROM spaces WHERE id=?').run(member.active_space_id);
  db.prepare('DELETE FROM users WHERE id=?').run(member.id);
  assert.equal(getJob(privateJob.id), null);
});
