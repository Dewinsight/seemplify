const crypto = require('crypto');

function parseEnv(envText) {
  const values = new Map();
  const passthrough = [];
  for (const line of String(envText || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const separator = line.indexOf('=');
    if (separator < 1) {
      passthrough.push(line);
      continue;
    }
    values.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return { values, passthrough };
}

function serializeEnv({ values, passthrough }) {
  return [
    ...Array.from(values, ([key, value]) => `${key}=${value}`),
    ...passthrough
  ].join('\n');
}

function ensureAIRuntimeEnv(envText, randomBytes = crypto.randomBytes, localRuntime = {}) {
  const parsed = parseEnv(envText);
  const added = [];
  const ensure = (key, createValue) => {
    if (String(parsed.values.get(key) || '').trim()) return;
    parsed.values.set(key, createValue());
    added.push(key);
  };
  const requireExact = (key, expectedValue) => {
    const expected = String(expectedValue).trim();
    const current = String(parsed.values.get(key) || '').trim();
    if (current && current !== expected) {
      throw new Error(`${key} must be ${expected}`);
    }
    ensure(key, () => expected);
  };
  const setExact = (key, expectedValue) => {
    const expected = String(expectedValue).trim();
    if (String(parsed.values.get(key) || '').trim() === expected) return;
    parsed.values.set(key, expected);
    added.push(key);
  };
  const remove = (key) => {
    if (!parsed.values.has(key)) return;
    parsed.values.delete(key);
    added.push(key);
  };

  ensure('AI_PROVIDER_ENCRYPTION_KEY', () => randomBytes(32).toString('base64'));
  ensure('AI_PROVIDER_ENCRYPTION_KEY_VERSION', () => 'v1');
  ensure('AI_GATEWAY_HMAC_SECRET', () => randomBytes(48).toString('base64'));
  ensure('AI_GATEWAY_ALLOWED_SERVICES', () => 'ai-interview');
  // Sign-in dies with "OIDC_ISSUER not configured" without these; the client
  // credentials must match the Identity Provider's clients.json registry.
  if (String(localRuntime.oidcIssuer || '').trim()) {
    ensure('OIDC_ISSUER', () => String(localRuntime.oidcIssuer).trim());
    ensure('OIDC_CLIENT_ID', () => String(localRuntime.oidcClientId || 'smarthr-backend').trim());
    if (String(localRuntime.oidcClientSecret || '').trim()) {
      ensure('OIDC_CLIENT_SECRET', () => String(localRuntime.oidcClientSecret).trim());
    }
  }
  requireExact('AI_USAGE_OUTBOX_ENABLED', localRuntime.usageOutboxEnabled || 'true');
  requireExact('AI_USAGE_REDIS_HOST', localRuntime.usageRedisHost || 'dokploy-redis');
  if (String(localRuntime.chatgptBaseUrl || '').trim()) {
    setExact('CHATGPT_GATEWAY_BASE_URL', localRuntime.chatgptBaseUrl);
  }
  if (String(localRuntime.chatgptSharedSecret || '').trim()) {
    setExact('CHATGPT_GATEWAY_SHARED_SECRET', localRuntime.chatgptSharedSecret);
  }
  if (String(localRuntime.statusTokenSecret || '').trim()) {
    ensure('CV_STATUS_TOKEN_SECRET', () => String(localRuntime.statusTokenSecret).trim());
  }
  if (String(localRuntime.concurrency || '').trim()) {
    setExact('CV_ANALYSIS_QUEUE_CONCURRENCY', localRuntime.concurrency);
  }
  setExact('LOCAL_CONTROL_CENTER_TELEMETRY_ENABLED', localRuntime.telemetryEnabled || 'false');

  if (localRuntime.disableLocalRuntime === true) {
    remove('LOCAL_LLM_BASE_URL');
    remove('LOCAL_LLM_SHARED_SECRET');
  } else if (String(localRuntime.sharedSecret || '').trim()) {
    ensure('LOCAL_LLM_SHARED_SECRET', () => String(localRuntime.sharedSecret).trim());
    ensure('LOCAL_LLM_BASE_URL', () => String(localRuntime.baseUrl || 'https://cv-llm.aiinnigeria.com').trim());
  }

  return { env: serializeEnv(parsed), added };
}

function apiBase(value) {
  const root = String(value || '').replace(/\/+$/, '');
  if (!root) throw new Error('DOKPLOY_URL is required');
  return root.endsWith('/api') ? root : `${root}/api`;
}

async function dokployRequest(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      accept: 'application/json',
      'x-api-key': token,
      ...(options.headers || {})
    }
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Dokploy request failed with HTTP ${response.status}`);
  return body ? JSON.parse(body) : {};
}

async function main() {
  const token = String(process.env.DOKPLOY_TOKEN || '');
  const applicationId = String(process.env.RECRUITER_BACKEND_APP_ID || '');
  const chatgptSharedSecret = String(process.env.CHATGPT_GATEWAY_SHARED_SECRET || '').trim();
  const chatgptBaseUrl = String(process.env.CHATGPT_GATEWAY_BASE_URL || '').trim();
  const cvStatusTokenSecret = String(process.env.CV_STATUS_TOKEN_SECRET || '').trim();
  const usageOutboxEnabled = String(process.env.AI_USAGE_OUTBOX_ENABLED || '').trim();
  const usageRedisHost = String(process.env.AI_USAGE_REDIS_HOST || '').trim();
  if (!token) throw new Error('DOKPLOY_TOKEN is required');
  if (!applicationId) throw new Error('RECRUITER_BACKEND_APP_ID is required');
  if (!chatgptSharedSecret) throw new Error('CHATGPT_GATEWAY_SHARED_SECRET is required');
  if (!chatgptBaseUrl) throw new Error('CHATGPT_GATEWAY_BASE_URL is required');
  if (!cvStatusTokenSecret) throw new Error('CV_STATUS_TOKEN_SECRET is required');
  if (usageOutboxEnabled !== 'true') throw new Error('AI_USAGE_OUTBOX_ENABLED must be true');
  if (!usageRedisHost) throw new Error('AI_USAGE_REDIS_HOST is required');

  const base = apiBase(process.env.DOKPLOY_URL);
  const app = await dokployRequest(`${base}/application.one?applicationId=${encodeURIComponent(applicationId)}`, token);
  const result = ensureAIRuntimeEnv(app.env, crypto.randomBytes, {
    sharedSecret: process.env.LOCAL_LLM_SHARED_SECRET || '',
    baseUrl: process.env.LOCAL_LLM_BASE_URL || 'https://cv-llm.aiinnigeria.com',
    chatgptBaseUrl,
    chatgptSharedSecret,
    statusTokenSecret: cvStatusTokenSecret,
    concurrency: process.env.CV_ANALYSIS_QUEUE_CONCURRENCY || '4',
    telemetryEnabled: process.env.LOCAL_CONTROL_CENTER_TELEMETRY_ENABLED || 'false',
    disableLocalRuntime: String(process.env.RECRUITER_DISABLE_LOCAL_RUNTIME || '').trim().toLowerCase() === 'true',
    usageOutboxEnabled,
    usageRedisHost,
    oidcIssuer: process.env.OIDC_ISSUER || 'https://auth.seemplifyai.com',
    oidcClientId: process.env.OIDC_CLIENT_ID || 'smarthr-backend',
    oidcClientSecret: process.env.OIDC_CLIENT_SECRET || ''
  });
  if (!result.added.length) {
    console.log('AI Runtime security environment is already configured; no values changed.');
    return;
  }

  await dokployRequest(`${base}/application.saveEnvironment`, token, {
    method: 'POST',
    body: JSON.stringify({
      applicationId,
      env: result.env,
      buildArgs: app.buildArgs || '',
      buildSecrets: app.buildSecrets || '',
      createEnvFile: app.createEnvFile === true
    })
  });
  console.log(`Configured missing AI Runtime variables: ${result.added.join(', ')}`);

  if (process.env.SKIP_DEPLOY !== '1') {
    await dokployRequest(`${base}/application.deploy`, token, {
      method: 'POST',
      body: JSON.stringify({ applicationId })
    });
    console.log('Recruiter backend deployment triggered.');
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { apiBase, ensureAIRuntimeEnv, parseEnv, serializeEnv };
