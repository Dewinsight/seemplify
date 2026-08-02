/**
 * Updates Azure embedding and AI runtime security env vars on Dokploy recruiter-backend.
 * Usage:
 *   Set the required embedding, encryption, and HMAC variables listed below, then run this script.
 *   DOKPLOY_TOKEN=... RECRUITER_BACKEND_APP_ID=dev-rec-be-001-seemp node scripts/dokployUpdateAzureAiEnv.js
 */
const axios = require('axios');

const BASE = (process.env.DOKPLOY_URL || 'http://4.180.153.209:3000/api').replace(/\/$/, '');
const TOKEN = process.env.DOKPLOY_TOKEN;
const APP_ID = process.env.RECRUITER_BACKEND_APP_ID || 'tPMolDg5OEdQUBZ4MKMFh';

const REQUIRED_UPDATE_KEYS = [
  'azure_openai_embedding_url',
  'azure_openai_embedding_key',
  'AI_PROVIDER_ENCRYPTION_KEY',
  'AI_PROVIDER_ENCRYPTION_KEY_VERSION',
  'AI_GATEWAY_HMAC_SECRET',
  'AI_GATEWAY_ALLOWED_SERVICES'
];

function getUpdatesFromEnv() {
  const missing = REQUIRED_UPDATE_KEYS.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Set required env values before updating Dokploy: ${missing.join(', ')}`);
  }

  return Object.fromEntries(REQUIRED_UPDATE_KEYS.map((key) => [key, process.env[key]]));
}

function mergeEnv(envStr, updates) {
  const lines = String(envStr || '').split(/\r?\n/);
  const map = new Map();
  const trailing = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    const idx = line.indexOf('=');
    if (idx === -1) {
      trailing.push(line);
      continue;
    }
    const key = line.slice(0, idx);
    map.set(key, line.slice(idx + 1));
  }

  for (const [key, value] of Object.entries(updates)) {
    map.set(key, value);
  }

  const merged = [...map.entries()].map(([k, v]) => `${k}=${v}`);
  return [...merged, ...trailing].join('\n');
}

async function main() {
  if (!TOKEN) {
    console.error('Set DOKPLOY_TOKEN');
    process.exit(1);
  }

  const h = { 'x-api-key': TOKEN, 'Content-Type': 'application/json' };
  const { data: app } = await axios.get(`${BASE}/application.one`, {
    params: { applicationId: APP_ID },
    headers: h,
    timeout: 60000,
  });

  const newEnv = mergeEnv(app.env, getUpdatesFromEnv());
  const body = {
    applicationId: APP_ID,
    env: newEnv,
    buildArgs: app.buildArgs ?? '',
    buildSecrets: app.buildSecrets ?? '',
    createEnvFile: app.createEnvFile ?? false,
  };

  await axios.post(`${BASE}/application.saveEnvironment`, body, { headers: h, timeout: 120000 });
  console.log(`Dokploy env updated for application ${APP_ID}`);

  const deploy = process.env.SKIP_DEPLOY !== '1';
  if (deploy) {
    await axios.post(`${BASE}/application.deploy`, { applicationId: APP_ID }, { headers: h, timeout: 120000 });
    console.log('Deployment triggered');
  }
}

main().catch((e) => {
  console.error(e.response?.data || e.message);
  process.exit(1);
});
