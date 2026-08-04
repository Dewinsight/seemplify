import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';
import { signupVerifyAndOnboard } from './authTestHelper.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-deep-analysis-'));
const passwordFile = path.join(root, 'admin-password');
const sessionFile = path.join(root, 'session-secret');
const terraFile = path.join(root, 'terra-secret');
const knowledgeFile = path.join(root, 'knowledge-secret');
const xKeyFile = path.join(root, 'x-key');
const esignKeyFile = path.join(root, 'esign-key');
fs.writeFileSync(passwordFile, 'Deep-Analysis-Test-Password-2026!');
fs.writeFileSync(sessionFile, 'deep-analysis-session-secret-that-is-long-enough');
fs.writeFileSync(terraFile, 'deep-analysis-terra-secret-that-is-long-enough');
fs.writeFileSync(knowledgeFile, 'deep-analysis-knowledge-secret-that-is-long-enough');
fs.writeFileSync(xKeyFile, Buffer.alloc(32, 31).toString('base64url'));
fs.writeFileSync(esignKeyFile, Buffer.alloc(32, 32).toString('base64url'));
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'test.sqlite'), UPLOAD_DIR: path.join(root, 'uploads'),
  FRONTEND_DIST: path.join(root, 'missing-frontend'), PUBLIC_URL: 'http://127.0.0.1:5425',
  ADMIN_EMAIL: 'deep-analysis@seemplify.local', ADMIN_PASSWORD_FILE: passwordFile,
  SESSION_SECRET_FILE: sessionFile, TERRA_GATEWAY_SHARED_SECRET_FILE: terraFile, LOCAL_LLM_SHARED_SECRET_FILE: terraFile,
  KNOWLEDGE_RUNTIME_BASE_URL: 'http://knowledge.test', KNOWLEDGE_RUNTIME_SHARED_SECRET_FILE: knowledgeFile,
  EMAIL_MODE: 'log', X_CREDENTIAL_ENCRYPTION_KEY_FILE: xKeyFile, ESIGN_STORAGE_DIR: path.join(root, 'esign'),
  ESIGN_ENCRYPTION_KEY_FILE: esignKeyFile, X_SEED_CONSUMER_KEY_FILE: path.join(root, 'missing-x-key'),
  X_SEED_CONSUMER_SECRET_FILE: path.join(root, 'missing-x-secret'), X_SEED_BEARER_TOKEN_FILE: path.join(root, 'missing-x-bearer'),
  X_SEED_ACCESS_TOKEN_FILE: path.join(root, 'missing-x-token'), X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(root, 'missing-x-token-secret'),
  X_SEED_CLIENT_ID_FILE: path.join(root, 'missing-client-id'), X_SEED_CLIENT_SECRET_FILE: path.join(root, 'missing-client-secret')
});

const { app } = await import('../src/app.js');
const { db, getJob, updateJob } = await import('../src/database.js');
const { executeAiJob } = await import('../src/aiJobs.js');
const { recoverDeepAnalysisRuns } = await import('../src/deepAnalysis.js');
const { config } = await import('../src/config.js');
const originalFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = originalFetch;
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

function providerResponse(data: unknown) {
  return new Response(JSON.stringify({ data, runtimeProfile: 'experience-management', provider: 'local-codex',
    engine: 'codex', model: 'gpt-5.6-terra', usage: { input_tokens: 500, output_tokens: 200, total_tokens: 700 },
    metrics: { latencyMs: 20, queueWaitMs: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function firstEvidence(prompt: string) {
  const sourceRef = /"sourceRef":"([^"]+)"/u.exec(prompt)?.[1] || 'missing-source';
  const excerpt = /"excerpt":"([^"]{8,200})"/u.exec(prompt)?.[1]
    || /"summary":"([^"]{8,200})"/u.exec(prompt)?.[1]
    || 'Partition summary supported by exact evidence.';
  return { sourceRef, excerpt: excerpt.replaceAll('\\n', ' ') };
}

test('exhaustive analysis fans out every chunk, checkpoints lifecycle actions, verifies, and completes with measured coverage', async () => {
  const owner = request.agent(app);
  await signupVerifyAndOnboard(owner, { name: 'Deep Owner', email: 'deep-analysis@seemplify.local', password: 'Deep-Analysis-Test-Password-2026!' });
  const user = db.prepare('SELECT id,active_space_id FROM users WHERE email=?').get('deep-analysis@seemplify.local') as { id: string; active_space_id: string };
  const timestamp = new Date().toISOString();
  const base = await owner.post('/api/knowledge-bases').send({ name: 'Enterprise corpus', description: 'Pinned exhaustive-analysis corpus', privacy: 'space', terraContextEnabled: true }).expect(201);
  const baseId = base.body.knowledgeBase.id as string; const documentId = crypto.randomUUID();
  const profile = config.knowledgeEmbeddingProfile;
  db.prepare(`UPDATE knowledge_bases SET status='ready',embedding_provider=?,embedding_model=?,embedding_revision=?,embedding_dtype=?,
    embedding_dimension=?,vector_index_version=?,current_version=1,last_allocated_version=1,last_indexed_at=?,updated_at=? WHERE id=? AND space_id=?`)
    .run(profile.provider, profile.model, profile.revision, profile.dtype, profile.dimensions, profile.vectorIndexVersion,
      timestamp, timestamp, baseId, user.active_space_id);
  db.prepare('DELETE FROM knowledge_base_embedding_profiles WHERE knowledge_base_id=? AND space_id=?').run(baseId, user.active_space_id);
  db.prepare(`INSERT INTO knowledge_base_embedding_profiles
    (space_id,knowledge_base_id,vector_index_version,mode,state,current_version,created_at,updated_at)
    VALUES (?,?,?,'primary','ready',1,?,?)`).run(user.active_space_id, baseId, profile.vectorIndexVersion, timestamp, timestamp);
  db.prepare(`INSERT INTO knowledge_documents
    (id,space_id,knowledge_base_id,created_by,stored_filename,original_name,mime_type,size_bytes,sha256,state,index_version,
      page_count,chunk_count,language,created_at,updated_at,indexed_at)
    VALUES (?,?,?,?,?,?,?,?,?,'ready',1,4,33,'en',?,?,?)`).run(documentId, user.active_space_id, baseId, user.id,
      `${documentId}.md`, 'enterprise-policy.md', 'text/markdown', 50_000, 'd'.repeat(64), timestamp, timestamp, timestamp);

  const requestKey = crypto.randomUUID();
  const requestBody = {
    title: 'Enterprise policy audit', objective: 'Analyze every policy chunk and identify supported risks and contradictions.',
    mode: 'exhaustive', sourceRefs: [`knowledge-base:${baseId}`]
  };
  const queued = await owner.post('/api/intelligence/deep-runs').set('Idempotency-Key', requestKey).send(requestBody).expect(202);
  const replay = await owner.post('/api/intelligence/deep-runs').set('Idempotency-Key', requestKey).send(requestBody).expect(202);
  assert.equal(replay.body.run.id, queued.body.run.id);
  assert.equal(replay.body.deduplicated, true);
  assert.equal(queued.body.run.estimate.estimatedInputTokens, 36_750);
  assert.equal(queued.body.run.estimate.mapPartitions, 3);
  assert.equal(queued.body.run.estimate.graphPartitions, 1);
  assert.equal(queued.body.run.estimate.specialistPartitions, 3);
  assert.equal(queued.body.run.totalPartitions, 4);

  await owner.post(`/api/intelligence/deep-runs/${queued.body.run.id}/pause`).send({}).expect(200);
  assert.equal(Number((db.prepare("SELECT COUNT(*) count FROM ai_jobs WHERE kind='intelligence.deep_analysis' AND state='paused'").get() as any).count), 4);
  await owner.post(`/api/intelligence/deep-runs/${queued.body.run.id}/resume`).send({}).expect(200);
  assert.equal(Number((db.prepare("SELECT COUNT(*) count FROM ai_jobs WHERE kind='intelligence.deep_analysis' AND state='queued'").get() as any).count), 4);

  const cancelled = await owner.post('/api/intelligence/deep-runs').set('Idempotency-Key', crypto.randomUUID()).send({
    ...requestBody, title: 'Cancelled enterprise audit', mode: 'deep'
  }).expect(202);
  await owner.post(`/api/intelligence/deep-runs/${cancelled.body.run.id}/cancel`).send({}).expect(200);
  assert.equal(Number((db.prepare("SELECT COUNT(*) count FROM deep_analysis_partitions WHERE run_id=? AND state='cancelled'").get(cancelled.body.run.id) as any).count), 4);

  const outsider = request.agent(app);
  await signupVerifyAndOnboard(outsider, { name: 'Deep Outsider', email: 'deep-outsider@seemplify.local', password: 'Deep-Outsider-Test-Password-2026!' });
  await outsider.get(`/api/intelligence/deep-runs/${queued.body.run.id}`).expect(404);

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); const body = JSON.parse(String(init?.body || '{}')) as any;
    if (url.hostname === 'knowledge.test') {
      assert.equal(body.spaceId, user.active_space_id);
      if (url.pathname === '/v1/graph') {
        assert.equal(body.knowledgeBase.id, baseId); assert.equal(body.knowledgeBase.indexVersion, 1); assert.equal(body.limit, 160);
        return new Response(JSON.stringify({
          nodes: [
            { id: 'policy', type: 'control', name: 'Material exception policy', aliases: [], supportingSourceCount: 3 },
            { id: 'committee', type: 'organization', name: 'Approval committee', aliases: [], supportingSourceCount: 2 },
            { id: 'orphan', type: 'risk', name: 'Disconnected legacy risk', aliases: [], supportingSourceCount: 1 }
          ],
          edges: [{ id: 'requires', source: 'policy', target: 'committee', type: 'requires approval from', confidence: 0.96,
            supports: [{ documentId, documentName: 'enterprise-policy.md', sourceRef: `${baseId}:${documentId}:chunk-4`,
              quote: 'Document evidence chunk 4 states that dual approval is required for material policy exceptions.', page: 1, section: 'Policy 4' }] }],
          metrics: { indexVersion: 1, truncated: false }
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      assert.equal(url.pathname, '/v1/scan'); assert.equal(body.knowledgeBaseId, baseId); assert.equal(body.documentId, documentId);
      const items = Array.from({ length: body.limit }, (_, index) => {
        const ordinal = body.offset + index;
        return { sourceRef: `${baseId}:${documentId}:chunk-${ordinal}`, knowledgeBaseId: baseId, documentId,
          documentName: 'enterprise-policy.md', indexVersion: 1, ordinal,
          text: `Document evidence chunk ${ordinal} states that dual approval is required for material policy exceptions.`,
          tokenEstimate: 750, page: Math.floor(ordinal / 9) + 1, section: `Policy ${ordinal}`, contentHash: `${ordinal}`.padStart(64, '0') };
      });
      return new Response(JSON.stringify({ requestId: body.requestId, items, offset: body.offset,
        nextOffset: body.offset + body.limit < 33 ? body.offset + body.limit : null,
        complete: body.offset + body.limit >= 33 }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const prompt = String(body.messages?.find((message: any) => message.role === 'user')?.content || '');
    const citation = firstEvidence(prompt);
    if (body.schemaName === 'experience_deep_analysis_final') {
      const coverageText = /coverage exactly: (\{[^\n]+\})/u.exec(prompt)?.[1]; assert.ok(coverageText);
      return providerResponse({ executiveSummary: 'The complete pinned corpus was analyzed through bounded partitions and independent audit passes.',
        findings: [{ kind: 'finding', statement: 'Material policy exceptions require dual approval.', confidence: 0.94,
          significance: 'This control should be tested consistently across business units.', citations: [citation] }],
        contradictions: [], recommendations: [{ action: 'Audit exception approvals quarterly.', rationale: 'The corpus establishes a dual-approval requirement.', priority: 'high', citations: [citation] }],
        limitations: ['The run covers only the pinned corpus version.'], openQuestions: [], coverage: JSON.parse(coverageText) });
    }
    return providerResponse({ summary: 'Partition summary supported by exact evidence.',
      findings: [{ kind: 'finding', statement: 'The supplied evidence requires dual approval for material exceptions.', confidence: 0.92,
        significance: 'The requirement is relevant to policy-control assurance.', citations: [citation] }],
      limitations: [], openQuestions: [], coverage: { recordsAnalyzed: 1, tokenEstimate: 750, scope: 'Every supplied record in this bounded partition.' } });
  };

  for (let cycle = 0; cycle < 10; cycle += 1) {
    const rows = db.prepare("SELECT id FROM ai_jobs WHERE kind='intelligence.deep_analysis' AND state='queued' ORDER BY created_at,rowid").all() as Array<{ id: string }>;
    if (!rows.length) break;
    for (const row of rows) {
      const job = getJob(row.id); assert.ok(job);
      const result = await executeAiJob(job);
      updateJob(job.id, { state: 'completed', stage: 'completed', progress: 100, result, error: null, completedAt: new Date().toISOString() });
    }
  }
  const completed = await owner.get(`/api/intelligence/deep-runs/${queued.body.run.id}`).expect(200);
  assert.equal(completed.body.state, 'completed');
  assert.equal(completed.body.stage, 'completed');
  assert.equal(completed.body.totalPartitions, 8);
  assert.equal(completed.body.completedPartitions, 8);
  assert.equal(completed.body.failedPartitions, 0);
  assert.equal(completed.body.result.coverage.documentsScheduled, 1);
  assert.equal(completed.body.result.coverage.chunksScheduled, 33);
  assert.equal(completed.body.result.coverage.chunksAnalyzed, 33);
  assert.equal(completed.body.result.coverage.graphBasesScheduled, 1);
  assert.equal(completed.body.result.coverage.graphBasesAnalyzed, 1);
  assert.equal(completed.body.result.coverage.graphNodesAnalyzed, 3);
  assert.equal(completed.body.result.coverage.graphEdgesAnalyzed, 1);
  assert.equal(completed.body.result.coverage.exhaustive, true);
  assert.ok(completed.body.evidence.length >= 6);
  assert.equal(Number((db.prepare('SELECT COUNT(*) count FROM deep_analysis_partitions WHERE run_id=? AND kind=?').get(queued.body.run.id, 'specialist') as any).count), 3);
  const graphPartition = db.prepare('SELECT source_json FROM deep_analysis_partitions WHERE run_id=? AND kind=?').get(queued.body.run.id, 'graph') as any;
  assert.ok(JSON.parse(graphPartition.source_json).graphSnapshot.capturedAt);
  assert.match(JSON.parse(graphPartition.source_json).graphSnapshot.sha256, /^[a-f0-9]{64}$/u);
  assert.equal(JSON.parse(graphPartition.source_json).snapshotRecords[0].componentCount, 2);
  assert.equal(Number((db.prepare('SELECT COUNT(*) count FROM deep_analysis_partitions WHERE run_id=? AND kind=?').get(queued.body.run.id, 'final') as any).count), 1);

  const recovering = await owner.post('/api/intelligence/deep-runs').set('Idempotency-Key', crypto.randomUUID()).send({
    ...requestBody, title: 'Restart recovery audit', mode: 'deep'
  }).expect(202);
  const recoveryOutput = JSON.stringify({ summary: 'Recovered partition summary.', findings: [], limitations: [], openQuestions: [],
    coverage: { recordsAnalyzed: 16, tokenEstimate: 12_000, scope: 'Recovered test partition.' } });
  const recoveredAt = new Date().toISOString();
  db.prepare("UPDATE deep_analysis_partitions SET state='completed',output_json=?,runtime_json='{}',completed_at=?,updated_at=? WHERE run_id=?")
    .run(recoveryOutput, recoveredAt, recoveredAt, recovering.body.run.id);
  db.prepare("UPDATE ai_jobs SET state='completed',stage='completed',progress=100,completed_at=?,updated_at=? WHERE id IN (SELECT ai_job_id FROM deep_analysis_partitions WHERE run_id=?)")
    .run(recoveredAt, recoveredAt, recovering.body.run.id);
  assert.ok(recoverDeepAnalysisRuns() >= 1);
  assert.equal(Number((db.prepare("SELECT COUNT(*) count FROM deep_analysis_partitions WHERE run_id=? AND kind='final' AND state='queued'").get(recovering.body.run.id) as any).count), 1);
  await owner.post(`/api/intelligence/deep-runs/${recovering.body.run.id}/cancel`).send({}).expect(200);
});
