'use strict';

function parseEnv(text) {
  const values = new Map();
  const passthrough = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const separator = line.indexOf('=');
    if (separator < 1) passthrough.push(line);
    else values.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return { values, passthrough };
}

function serializeEnv({ values, passthrough }) {
  return [...values].map(([key, value]) => `${key}=${value}`).concat(passthrough).join('\n');
}

function configureEnvironment(current, required, removed = []) {
  const parsed = parseEnv(current);
  const changed = [];
  for (const [key, value] of Object.entries(required)) {
    const normalized = String(value || '').trim();
    if (!normalized) throw new Error(`${key} is required`);
    if (parsed.values.get(key) === normalized) continue;
    parsed.values.set(key, normalized);
    changed.push(key);
  }
  for (const key of removed) {
    if (!parsed.values.delete(key)) continue;
    changed.push(key);
  }
  return { env: serializeEnv(parsed), changed };
}

function apiBase(value) {
  const root = String(value || '').replace(/\/+$/, '');
  if (!root) throw new Error('DOKPLOY_URL is required');
  return root.endsWith('/api') ? root : `${root}/api`;
}

async function request(path, options = {}) {
  const token = String(process.env.DOKPLOY_TOKEN || '').trim();
  if (!token) throw new Error('DOKPLOY_TOKEN is required');
  const response = await fetch(`${apiBase(process.env.DOKPLOY_URL)}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json', accept: 'application/json', 'x-api-key': token,
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Dokploy request failed with HTTP ${response.status}`);
  return text ? JSON.parse(text) : {};
}

async function configureApplication(applicationId, required, removed) {
  if (!applicationId) throw new Error('A Dokploy application ID is required');
  const app = await request(`/application.one?applicationId=${encodeURIComponent(applicationId)}`);
  const next = configureEnvironment(app.env, required, removed);
  if (next.changed.length) {
    await request('/application.saveEnvironment', {
      method: 'POST',
      body: JSON.stringify({
        applicationId, env: next.env, buildArgs: app.buildArgs || '',
        buildSecrets: app.buildSecrets || '', createEnvFile: app.createEnvFile === true
      })
    });
    console.log(`Updated ${next.changed.length} environment keys for application ${applicationId}.`);
  }
  await request('/application.deploy', {
    method: 'POST', body: JSON.stringify({ applicationId })
  });
  console.log(`Deployment triggered for application ${applicationId}.`);
}

async function main() {
  const sharedSecret = process.env.CHATGPT_GATEWAY_SHARED_SECRET;
  const gatewayId = String(process.env.CHATGPT_GATEWAY_APP_ID || '').trim();
  const recruiterId = String(process.env.RECRUITER_BACKEND_APP_ID || '').trim();
  const performanceId = String(process.env.PERFORMANCE_BACKEND_APP_ID || '').trim();
  const gatewayBaseUrl = process.env.CHATGPT_GATEWAY_BASE_URL;
  const localBaseUrl = String(process.env.LOCAL_LLM_BASE_URL || '').trim();
  const localSecret = String(process.env.LOCAL_LLM_SHARED_SECRET || '').trim();
  if (!localBaseUrl) throw new Error('LOCAL_LLM_BASE_URL is required; Local inference must not point at the ChatGPT gateway');
  if (!localSecret) throw new Error('LOCAL_LLM_SHARED_SECRET is required');
  await configureApplication(gatewayId, {
    CHATGPT_GATEWAY_SHARED_SECRET: sharedSecret,
    RECRUITER_BACKEND_URL: process.env.RECRUITER_BACKEND_URL || 'https://api.seemplifyai.com',
    CODEX_PER_USER_SESSIONS: 'true',
    CODEX_SUBJECT_SOURCE_APPS: 'recruiter,performance-management'
  }, ['LOCAL_LLM_BASE_URL', 'LOCAL_LLM_SHARED_SECRET', 'LOCAL_CONTROL_CENTER_TELEMETRY_ENABLED']);
  await configureApplication(recruiterId, {
    CHATGPT_GATEWAY_BASE_URL: gatewayBaseUrl,
    CHATGPT_GATEWAY_SHARED_SECRET: sharedSecret,
    LOCAL_LLM_BASE_URL: localBaseUrl,
    LOCAL_LLM_SHARED_SECRET: localSecret,
    CV_STATUS_TOKEN_SECRET: process.env.CV_STATUS_TOKEN_SECRET,
    CV_ANALYSIS_QUEUE_CONCURRENCY: process.env.CV_ANALYSIS_QUEUE_CONCURRENCY || '4',
    AI_USAGE_OUTBOX_ENABLED: 'true',
    AI_USAGE_REDIS_HOST: process.env.AI_USAGE_REDIS_HOST || 'dokploy-redis',
    OIDC_ISSUER: process.env.OIDC_ISSUER || 'https://auth.seemplifyai.com',
    OIDC_CLIENT_ID: process.env.OIDC_CLIENT_ID || 'smarthr-backend',
    OIDC_CLIENT_SECRET: process.env.OIDC_CLIENT_SECRET
  }, [
    'LOCAL_CONTROL_CENTER_TELEMETRY_ENABLED',
    'RECRUITER_DISABLE_LOCAL_RUNTIME', 'AI_PROVIDER_ENCRYPTION_KEY', 'AI_PROVIDER_ENCRYPTION_KEY_VERSION'
  ]);
  if (performanceId) {
    await configureApplication(performanceId, {
      CHATGPT_GATEWAY_BASE_URL: gatewayBaseUrl,
      CHATGPT_GATEWAY_SHARED_SECRET: sharedSecret,
      LOCAL_LLM_BASE_URL: localBaseUrl,
      LOCAL_LLM_SHARED_SECRET: localSecret,
      PERFORMANCE_AI_LOCAL_ENABLED: process.env.PERFORMANCE_AI_LOCAL_ENABLED || 'true',
      PERFORMANCE_AI_CHATGPT_ENABLED: process.env.PERFORMANCE_AI_CHATGPT_ENABLED || 'false',
      PERFORMANCE_AI_DEFAULT_RUNTIME: process.env.PERFORMANCE_AI_DEFAULT_RUNTIME || 'local'
    }, ['AZURE_OPENAI_API_KEY', 'OPENAI_API_KEY']);
  }
}

if (require.main === module) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { apiBase, configureEnvironment, parseEnv, serializeEnv };
