'use strict';

const { allowedConsumerIds, configuredConsumers } = require('./consumer-registry.cjs');

function parseEnv(text) {
  const values = new Map(); const passthrough = [];
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
  const parsed = parseEnv(current); const changed = [];
  for (const [key, value] of Object.entries(required)) {
    const normalized = String(value || '').trim();
    if (!normalized) throw new Error(`${key} is required`);
    if (parsed.values.get(key) === normalized) continue;
    parsed.values.set(key, normalized); changed.push(key);
  }
  for (const key of removed) if (parsed.values.delete(key)) changed.push(key);
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
    headers: { 'content-type': 'application/json', accept: 'application/json', 'x-api-key': token, ...(options.headers || {}) }
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Dokploy request failed with HTTP ${response.status}`);
  return body ? JSON.parse(body) : {};
}

async function configureApplication(applicationId, required, removed = []) {
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
  await request('/application.deploy', { method: 'POST', body: JSON.stringify({ applicationId }) });
  console.log(`Deployment triggered for application ${applicationId}.`);
}

function consumerEnvironment(id, source = process.env) {
  const common = {
    SEEMPLIFY_AI_SOURCE_APP: id,
    CHATGPT_GATEWAY_BASE_URL: source.CHATGPT_GATEWAY_BASE_URL,
    CHATGPT_GATEWAY_SHARED_SECRET: source.CHATGPT_GATEWAY_SHARED_SECRET,
    LOCAL_LLM_BASE_URL: source.LOCAL_LLM_BASE_URL,
    LOCAL_LLM_SHARED_SECRET: source.LOCAL_LLM_SHARED_SECRET
  };
  if (id === 'recruiter') return {
    ...common,
    CV_STATUS_TOKEN_SECRET: source.CV_STATUS_TOKEN_SECRET,
    CV_ANALYSIS_QUEUE_CONCURRENCY: source.CV_ANALYSIS_QUEUE_CONCURRENCY || '4',
    AI_USAGE_OUTBOX_ENABLED: 'true', AI_USAGE_REDIS_HOST: source.AI_USAGE_REDIS_HOST || 'dokploy-redis',
    OIDC_ISSUER: source.OIDC_ISSUER || 'https://auth.seemplifyai.com',
    OIDC_CLIENT_ID: source.OIDC_CLIENT_ID || 'smarthr-backend', OIDC_CLIENT_SECRET: source.OIDC_CLIENT_SECRET
  };
  if (id === 'performance-management') return {
    ...common,
    PERFORMANCE_AI_LOCAL_ENABLED: source.PERFORMANCE_AI_LOCAL_ENABLED || 'true',
    PERFORMANCE_AI_CHATGPT_ENABLED: source.PERFORMANCE_AI_CHATGPT_ENABLED || 'true',
    PERFORMANCE_AI_DEFAULT_RUNTIME: source.PERFORMANCE_AI_DEFAULT_RUNTIME || 'local'
  };
  return common;
}

async function main() {
  const gatewayId = String(process.env.CHATGPT_GATEWAY_APP_ID || '').trim();
  if (!gatewayId) throw new Error('CHATGPT_GATEWAY_APP_ID is required');
  if (!String(process.env.LOCAL_LLM_BASE_URL || '').trim()) {
    throw new Error('LOCAL_LLM_BASE_URL is required; Local inference must remain independent of ChatGPT Connect');
  }
  if (!String(process.env.LOCAL_LLM_SHARED_SECRET || '').trim()) throw new Error('LOCAL_LLM_SHARED_SECRET is required');

  await configureApplication(gatewayId, {
    CHATGPT_GATEWAY_SHARED_SECRET: process.env.CHATGPT_GATEWAY_SHARED_SECRET,
    CODEX_PER_USER_SESSIONS: 'true',
    CODEX_SUBJECT_SOURCE_APPS: allowedConsumerIds().join(',')
  }, ['RECRUITER_BACKEND_URL', 'LOCAL_LLM_BASE_URL', 'LOCAL_LLM_SHARED_SECRET', 'LOCAL_CONTROL_CENTER_TELEMETRY_ENABLED']);

  const consumers = configuredConsumers(process.env);
  if (!consumers.length) throw new Error('At least one shared Seemplify AI consumer application ID is required');
  for (const consumer of consumers) {
    const removed = consumer.id === 'performance-management' ? ['AZURE_OPENAI_API_KEY', 'OPENAI_API_KEY']
      : consumer.id === 'recruiter' ? ['LOCAL_CONTROL_CENTER_TELEMETRY_ENABLED', 'RECRUITER_DISABLE_LOCAL_RUNTIME', 'AI_PROVIDER_ENCRYPTION_KEY', 'AI_PROVIDER_ENCRYPTION_KEY_VERSION']
        : [];
    await configureApplication(consumer.applicationId, consumerEnvironment(consumer.id), removed);
  }
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = {
  apiBase,
  configureApplication,
  configureEnvironment,
  consumerEnvironment,
  main,
  parseEnv,
  serializeEnv
};
