/**
 * Removes Pinecone + USE_WEAVIATE from recruiter-backend env in Dokploy (Weaviate-only backend).
 * Requires: DOKPLOY_URL (default http://4.180.153.209:3000/api), DOKPLOY_TOKEN, RECRUITER_BACKEND_APP_ID
 */
const axios = require('axios');

const BASE = (process.env.DOKPLOY_URL || 'http://4.180.153.209:3000/api').replace(/\/$/, '');
const TOKEN = process.env.DOKPLOY_TOKEN;
const APP_ID = process.env.RECRUITER_BACKEND_APP_ID || 'tPMolDg5OEdQUBZ4MKMFh';

async function main() {
  if (!TOKEN) {
    console.error('Set DOKPLOY_TOKEN');
    process.exit(1);
  }
  const h = { 'x-api-key': TOKEN, 'Content-Type': 'application/json' };
  const { data: app } = await axios.get(`${BASE}/application.one`, { params: { applicationId: APP_ID }, headers: h, timeout: 60000 });
  const envStr = String(app.env || '');
  const lines = envStr.split(/\r?\n/);
  const filtered = lines.filter((line) => !/^(PINECONE_|USE_WEAVIATE=)/.test(line));
  const newEnv = filtered.join('\n').trimEnd();
  const body = {
    applicationId: APP_ID,
    env: newEnv,
    buildArgs: app.buildArgs ?? '',
    buildSecrets: app.buildSecrets ?? '',
    createEnvFile: app.createEnvFile ?? false,
  };
  await axios.post(`${BASE}/application.saveEnvironment`, body, { headers: h, timeout: 120000 });
  console.log('✅ Dokploy env updated (Pinecone + USE_WEAVIATE lines removed). Redeploy recruiter-backend to apply.');
}

main().catch((e) => {
  console.error(e.response?.data || e.message);
  process.exit(1);
});
