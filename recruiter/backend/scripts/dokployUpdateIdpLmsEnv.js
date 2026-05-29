/**
 * Removes Frappe LMS_URL from identity-provider Dokploy env; sets SIMPLE_LMS_URL.
 */
const axios = require('axios');

const BASE = (process.env.DOKPLOY_URL || 'http://4.180.153.209:3000/api').replace(/\/$/, '');
const TOKEN = process.env.DOKPLOY_TOKEN;
const APP_ID = process.env.IDENTITY_PROVIDER_APP_ID || '8e1fIo8p0MwhkMiSBtb8U';

const REMOVE_KEYS = new Set(['LMS_URL']);
const UPDATES = {
  SIMPLE_LMS_URL: 'https://auth.seemplifyai.com/simple-lms',
};

function mergeEnv(envStr) {
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
    if (REMOVE_KEYS.has(key)) continue;
    map.set(key, line.slice(idx + 1));
  }

  for (const [key, value] of Object.entries(UPDATES)) {
    map.set(key, value);
  }

  return [...map.entries()].map(([k, v]) => `${k}=${v}`).concat(trailing).join('\n');
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

  const body = {
    applicationId: APP_ID,
    env: mergeEnv(app.env),
    buildArgs: app.buildArgs ?? '',
    buildSecrets: app.buildSecrets ?? '',
    createEnvFile: app.createEnvFile ?? false,
  };

  await axios.post(`${BASE}/application.saveEnvironment`, body, { headers: h, timeout: 120000 });
  console.log('✅ identity-provider env updated (LMS_URL removed, SIMPLE_LMS_URL set)');

  await axios.post(`${BASE}/application.deploy`, { applicationId: APP_ID }, { headers: h, timeout: 120000 });
  console.log('✅ identity-provider deployment triggered');
}

main().catch((e) => {
  console.error(e.response?.data || e.message);
  process.exit(1);
});
