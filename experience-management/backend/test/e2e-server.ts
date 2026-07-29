import fs from 'node:fs';
import path from 'node:path';

const state = path.resolve(process.cwd(), '..', '.local-runtime', 'experience-management', 'e2e');
fs.rmSync(state, { recursive: true, force: true }); fs.mkdirSync(state, { recursive: true });
const passwordFile = path.join(state, 'admin-password'); const sessionFile = path.join(state, 'session-secret');
const xKeyFile = path.join(state, 'x-credential-encryption-key');
fs.writeFileSync(passwordFile, 'Playwright-Test-Password-2026!'); fs.writeFileSync(sessionFile, 'playwright-session-secret-longer-than-twenty-characters'); fs.writeFileSync(xKeyFile, Buffer.alloc(32, 11).toString('base64url'));
Object.assign(process.env, {
  HOST: '127.0.0.1', PORT: '5412', PUBLIC_URL: 'http://127.0.0.1:5412', DATABASE_PATH: path.join(state, 'e2e.sqlite'), UPLOAD_DIR: path.join(state, 'uploads'),
  ADMIN_EMAIL: 'qa@seemplify.local', ADMIN_PASSWORD_FILE: passwordFile, SESSION_SECRET_FILE: sessionFile, EMAIL_MODE: 'log', AI_WORKER_CONCURRENCY: '1', LOCAL_LLM_BASE_URL: 'http://127.0.0.1:9',
  X_CREDENTIAL_ENCRYPTION_KEY_FILE: xKeyFile, X_SEED_CONSUMER_KEY_FILE: path.join(state, 'no-x-consumer-key'), X_SEED_CONSUMER_SECRET_FILE: path.join(state, 'no-x-consumer-secret'), X_SEED_BEARER_TOKEN_FILE: path.join(state, 'no-x-bearer-token'), X_SEED_ACCESS_TOKEN_FILE: path.join(state, 'no-x-access-token'), X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(state, 'no-x-access-token-secret')
});
const { app } = await import('../src/app.js'); const { aiJobRunner } = await import('../src/aiJobs.js');
const { campaignRunner } = await import('../src/campaigns.js');
aiJobRunner.start(); campaignRunner.start();
const server = app.listen(5412, '127.0.0.1', () => console.log('E2E server ready on 5412'));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { aiJobRunner.stop(); campaignRunner.stop(); server.close(() => process.exit(0)); });
