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

function ensureAIRuntimeEnv(envText, randomBytes = crypto.randomBytes) {
  const parsed = parseEnv(envText);
  const added = [];
  const ensure = (key, createValue) => {
    if (String(parsed.values.get(key) || '').trim()) return;
    parsed.values.set(key, createValue());
    added.push(key);
  };

  ensure('AI_PROVIDER_ENCRYPTION_KEY', () => randomBytes(32).toString('base64'));
  ensure('AI_PROVIDER_ENCRYPTION_KEY_VERSION', () => 'v1');
  ensure('AI_GATEWAY_HMAC_SECRET', () => randomBytes(48).toString('base64'));
  ensure('AI_GATEWAY_ALLOWED_SERVICES', () => 'ai-interview');

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
  if (!token) throw new Error('DOKPLOY_TOKEN is required');
  if (!applicationId) throw new Error('RECRUITER_BACKEND_APP_ID is required');

  const base = apiBase(process.env.DOKPLOY_URL);
  const app = await dokployRequest(`${base}/application.one?applicationId=${encodeURIComponent(applicationId)}`, token);
  const result = ensureAIRuntimeEnv(app.env);
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
