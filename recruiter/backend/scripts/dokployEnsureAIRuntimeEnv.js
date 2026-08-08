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
  if (String(localRuntime.sharedSecret || '').trim()) {
    ensure('LOCAL_LLM_SHARED_SECRET', () => String(localRuntime.sharedSecret).trim());
    ensure('LOCAL_LLM_BASE_URL', () => String(localRuntime.baseUrl || 'https://cv-llm.aiinnigeria.com').trim());
    if (String(localRuntime.chatgptBaseUrl || '').trim()) {
      const target = String(localRuntime.chatgptBaseUrl).trim();
      if (String(parsed.values.get('CHATGPT_GATEWAY_BASE_URL') || '').trim() !== target) {
        parsed.values.set('CHATGPT_GATEWAY_BASE_URL', target);
        added.push('CHATGPT_GATEWAY_BASE_URL');
      }
    }
    ensure('CV_STATUS_TOKEN_SECRET', () => String(localRuntime.statusTokenSecret || localRuntime.sharedSecret).trim());
    ensure('CV_ANALYSIS_QUEUE_CONCURRENCY', () => String(localRuntime.concurrency || 1));
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
  const localSharedSecret = String(process.env.LOCAL_LLM_SHARED_SECRET || '').trim();
  const cvStatusTokenSecret = String(process.env.CV_STATUS_TOKEN_SECRET || '').trim();
  const usageOutboxEnabled = String(process.env.AI_USAGE_OUTBOX_ENABLED || '').trim();
  const usageRedisHost = String(process.env.AI_USAGE_REDIS_HOST || '').trim();
  if (!token) throw new Error('DOKPLOY_TOKEN is required');
  if (!applicationId) throw new Error('RECRUITER_BACKEND_APP_ID is required');
  if (!localSharedSecret) throw new Error('LOCAL_LLM_SHARED_SECRET is required');
  if (!cvStatusTokenSecret) throw new Error('CV_STATUS_TOKEN_SECRET is required');
  if (usageOutboxEnabled !== 'true') throw new Error('AI_USAGE_OUTBOX_ENABLED must be true');
  if (!usageRedisHost) throw new Error('AI_USAGE_REDIS_HOST is required');

  const base = apiBase(process.env.DOKPLOY_URL);
  const app = await dokployRequest(`${base}/application.one?applicationId=${encodeURIComponent(applicationId)}`, token);
  const result = ensureAIRuntimeEnv(app.env, crypto.randomBytes, {
    sharedSecret: localSharedSecret,
    baseUrl: process.env.LOCAL_LLM_BASE_URL || 'https://cv-llm.aiinnigeria.com',
    chatgptBaseUrl: process.env.CHATGPT_GATEWAY_BASE_URL || '',
    statusTokenSecret: cvStatusTokenSecret,
    concurrency: process.env.CV_ANALYSIS_QUEUE_CONCURRENCY || '1',
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
