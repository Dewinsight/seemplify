import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const liveKnowledge = process.env.KNOWLEDGE_E2E_LIVE === '1';
const repositoryRoot = path.resolve(process.cwd(), '..');
const liveRunId = crypto.randomBytes(16).toString('hex');
const liveSpaceId = `knowledge-live-benchmark-${liveRunId}`;
const state = liveKnowledge
  ? fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-knowledge-e2e-'))
  : path.resolve(repositoryRoot, '.local-runtime', 'experience-management', 'e2e');
if (!liveKnowledge) fs.rmSync(state, { recursive: true, force: true });
fs.mkdirSync(state, { recursive: true });
const passwordFile = path.join(state, 'admin-password'); const sessionFile = path.join(state, 'session-secret');
const xKeyFile = path.join(state, 'x-credential-encryption-key');
const esignKeyFile = path.join(state, 'esign-encryption-key');
const knowledgeSecretFile = liveKnowledge
  ? path.join(repositoryRoot, '.local-runtime', 'knowledge', 'service-secret')
  : path.join(state, 'knowledge-secret');
const terraSecretFile = path.join(repositoryRoot, '.local-runtime', 'llm', 'service-secret');
const knowledgeRuntimeBaseUrl = String(process.env.KNOWLEDGE_RUNTIME_BASE_URL || 'http://127.0.0.1:11540').replace(/\/+$/, '');
const terraGatewayBaseUrl = String(process.env.TERRA_GATEWAY_BASE_URL || 'http://127.0.0.1:11435').replace(/\/+$/, '');
const knowledgeStagingRoot = process.env.SEEMPLIFY_KNOWLEDGE_STAGING_DIR
  || path.join(path.resolve(process.env.SEEMPLIFY_KNOWLEDGE_DATA_ROOT || 'D:\\SeemplifyKnowledge'), 'staging');
const knowledgeStorageDir = liveKnowledge ? path.join(knowledgeStagingRoot, `experience-e2e-${liveRunId}`) : path.join(state, 'knowledge');
fs.writeFileSync(passwordFile, 'Playwright-Test-Password-2026!'); fs.writeFileSync(sessionFile, 'playwright-session-secret-longer-than-twenty-characters'); fs.writeFileSync(xKeyFile, Buffer.alloc(32, 11).toString('base64url')); fs.writeFileSync(esignKeyFile, Buffer.alloc(32, 12).toString('base64url'));
if (liveKnowledge) {
  for (const filename of [knowledgeSecretFile, terraSecretFile]) {
    if (!fs.existsSync(filename) || fs.readFileSync(filename, 'utf8').trim().length < 32) {
      throw new Error(`KNOWLEDGE_E2E_LIVE requires the configured local runtime secret: ${filename}`);
    }
  }
} else {
  fs.writeFileSync(knowledgeSecretFile, 'playwright-knowledge-secret-longer-than-thirty-two-characters');
}
Object.assign(process.env, {
  HOST: '127.0.0.1', PORT: '5412', PUBLIC_URL: 'http://127.0.0.1:5412', DATABASE_PATH: path.join(state, 'e2e.sqlite'), UPLOAD_DIR: path.join(state, 'uploads'),
  ADMIN_EMAIL: 'qa@seemplify.local', ADMIN_PASSWORD_FILE: passwordFile, SESSION_SECRET_FILE: sessionFile, EMAIL_MODE: 'log', AI_WORKER_CONCURRENCY: '1', LOCAL_LLM_BASE_URL: 'http://127.0.0.1:9',
  ESIGN_STORAGE_DIR: path.join(state, 'esign'), ESIGN_ENCRYPTION_KEY_FILE: esignKeyFile, ESIGN_WORKER_POLL_MS: '250',
  KNOWLEDGE_STORAGE_DIR: knowledgeStorageDir, KNOWLEDGE_RUNTIME_SHARED_SECRET_FILE: knowledgeSecretFile,
  KNOWLEDGE_RUNTIME_BASE_URL: liveKnowledge ? knowledgeRuntimeBaseUrl : 'http://127.0.0.1:9', KNOWLEDGE_WORKER_POLL_MS: liveKnowledge ? '1000' : '250',
  ...(liveKnowledge ? {
    TERRA_GATEWAY_BASE_URL: terraGatewayBaseUrl,
    TERRA_GATEWAY_SHARED_SECRET_FILE: terraSecretFile,
    LOCAL_LLM_SHARED_SECRET_FILE: terraSecretFile
  } : {}),
  X_CREDENTIAL_ENCRYPTION_KEY_FILE: xKeyFile, X_SEED_CONSUMER_KEY_FILE: path.join(state, 'no-x-consumer-key'), X_SEED_CONSUMER_SECRET_FILE: path.join(state, 'no-x-consumer-secret'), X_SEED_BEARER_TOKEN_FILE: path.join(state, 'no-x-bearer-token'), X_SEED_ACCESS_TOKEN_FILE: path.join(state, 'no-x-access-token'), X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(state, 'no-x-access-token-secret')
});
const { app } = await import('../src/app.js'); const { aiJobRunner } = await import('../src/aiJobs.js');
const { bootstrapAdminAccount, currentSessionUser, issueEmailVerificationToken } = await import('../src/auth.js');
const { campaignRunner } = await import('../src/campaigns.js');
const { db } = await import('../src/database.js');
const { esignWorker } = await import('../src/esign.js');
const { getKnowledgeRuntimeStatus } = await import('../src/knowledgeClient.js');
const { knowledgeJobRunner } = await import('../src/knowledgeJobs.js');
const { getTerraStatus } = await import('../src/terraClient.js');
const { saveTutorialProgress, tutorialKeys } = await import('../src/tutorialProgress.js');

function remapBootstrapSpace(userId: string) {
  const current = db.prepare('SELECT active_space_id FROM users WHERE id=?').get(userId) as { active_space_id: string | null } | undefined;
  if (!current?.active_space_id) throw new Error('The live E2E bootstrap account has no active space.');
  const previous = current.active_space_id;
  db.pragma('foreign_keys = OFF');
  try {
    db.prepare('UPDATE spaces SET id=? WHERE id=?').run(liveSpaceId, previous);
    db.prepare('UPDATE space_memberships SET space_id=? WHERE space_id=?').run(liveSpaceId, previous);
    db.prepare('UPDATE users SET active_space_id=? WHERE id=?').run(liveSpaceId, userId);
  } finally {
    db.pragma('foreign_keys = ON');
  }
  const violations = db.pragma('foreign_key_check') as unknown[];
  if (violations.length) throw new Error(`Live E2E space remap violated ${violations.length} foreign keys.`);
}

function signedKnowledgeHeaders(rawBody: string, requestPath: string) {
  const timestamp = String(Date.now()); const nonce = crypto.randomBytes(24).toString('base64url');
  const secret = fs.readFileSync(knowledgeSecretFile, 'utf8').trim();
  const signature = crypto.createHmac('sha256', secret)
    .update(`${timestamp}\n${nonce}\nPOST\n${requestPath}\n${rawBody}`).digest('base64url');
  return { 'content-type': 'application/json', 'x-seemplify-timestamp': timestamp,
    'x-seemplify-nonce': nonce, 'x-seemplify-signature': signature };
}

async function cleanupLiveKnowledgeTenant() {
  if (!liveKnowledge) return { cleaned: false, live: false };
  const requestPath = '/v1/test/cleanup';
  const rawBody = JSON.stringify({ source: 'knowledge-live-benchmark', spaceId: liveSpaceId,
    confirmation: 'PURGE_SYNTHETIC_KNOWLEDGE_BENCHMARK' });
  const response = await fetch(`${knowledgeRuntimeBaseUrl}${requestPath}`, {
    method: 'POST', headers: signedKnowledgeHeaders(rawBody, requestPath), body: rawBody,
    signal: AbortSignal.timeout(120_000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Live knowledge cleanup failed (${response.status}): ${JSON.stringify(result)}`);
  fs.rmSync(knowledgeStorageDir, { recursive: true, force: true });
  return result;
}

let liveStateDisposed = false;
async function disposeLiveApplicationState() {
  if (!liveKnowledge || liveStateDisposed) return;
  liveStateDisposed = true;
  aiJobRunner.stop(); knowledgeJobRunner.stop();
  await Promise.allSettled([campaignRunner.stop(), esignWorker.stop()]);
  try { db.close(); } catch { /* already closed during Playwright teardown */ }
  fs.rmSync(state, { recursive: true, force: true });
}

const bootstrapUserId = bootstrapAdminAccount();
for (const tutorialKey of tutorialKeys) {
  saveTutorialProgress(bootstrapUserId, tutorialKey, {
    version: 1,
    status: 'completed',
    lastStep: null
  });
}

if (liveKnowledge) {
  remapBootstrapSpace(bootstrapUserId);
  const [knowledge, terra] = await Promise.all([getKnowledgeRuntimeStatus(), getTerraStatus()]);
  if (!knowledge.ready || !terra.ready) {
    throw new Error(`KNOWLEDGE_E2E_LIVE preflight failed: ${JSON.stringify({ knowledge, terra })}`);
  }
  app.post('/__e2e__/knowledge/live-cleanup', async (request, response) => {
    if (!currentSessionUser(request)) return response.status(401).json({ error: 'Authentication required.' });
    try {
      knowledgeJobRunner.stop();
      await knowledgeJobRunner.drain(120_000);
      const result = await cleanupLiveKnowledgeTenant();
      // This is the final request in the gated live test. Closing the isolated
      // database before replying makes cleanup deterministic even when the
      // Playwright web-server process is terminated immediately afterwards.
      await disposeLiveApplicationState();
      return response.json(result);
    } catch (error) {
      return response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
app.post('/__e2e__/auth/verification-token', (request, response) => {
  const issued = issueEmailVerificationToken(String(request.body?.email || ''), {
    requestId: request.body?.requestId ? String(request.body.requestId) : undefined
  });
  response.setHeader('Cache-Control', 'no-store');
  return issued
    ? response.json({ token: issued.token, expiresAt: issued.expiresAt })
    : response.status(404).json({ error: 'No unverified E2E account exists for that email.' });
});
app.post('/__e2e__/tutorials/reset', (request, response) => {
  const user = currentSessionUser(request);
  if (!user) return response.status(401).json({ error: 'Authentication required.' });
  const tutorialKey = String(request.body?.tutorialKey || '');
  if (!(tutorialKeys as readonly string[]).includes(tutorialKey)) {
    return response.status(400).json({ error: 'Unknown tutorial key.' });
  }
  db.prepare('DELETE FROM tutorial_progress WHERE user_id=? AND tutorial_key=?').run(user.id, tutorialKey);
  response.setHeader('Cache-Control', 'no-store');
  return response.json({ tutorialKey, reset: true });
});
aiJobRunner.start(); campaignRunner.start(); esignWorker.start(); knowledgeJobRunner.start();
const server = app.listen(5412, '127.0.0.1', () => console.log('E2E server ready on 5412'));
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  aiJobRunner.stop(); knowledgeJobRunner.stop();
  await Promise.allSettled([campaignRunner.stop(), esignWorker.stop()]);
  if (liveKnowledge) await cleanupLiveKnowledgeTenant().catch((error) => console.error(error));
  if (liveKnowledge) await disposeLiveApplicationState();
  server.close(() => {
    process.exit(0);
  });
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void shutdown());
