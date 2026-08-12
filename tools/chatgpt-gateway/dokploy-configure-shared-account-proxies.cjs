'use strict';

/**
 * Configure only the first-party proxies that reach Recruiter's central
 * ChatGPT-account authority. This deliberately does not touch or deploy the
 * credential gateway: its /data volume still requires the separately enforced
 * Dokploy backup preflight before any gateway migration can run.
 */

const crypto = require('node:crypto');
const {
  configureApplication,
  deriveMessagingProxySecret,
  derivePerformanceProxySecret,
  resolveMessagingConsumer,
  waitForReadiness
} = require('./dokploy-configure.cjs');

const SHARED_ACCOUNT_HEALTH_PATH = '/api/internal/ai/v1/health';
const PROXY_SERVICE_IDS = new Set(['performance-management', 'messaging']);

function apiBase(value) {
  const root = String(value || '').replace(/\/+$/, '');
  if (!root) throw new Error('DOKPLOY_URL is required');
  return root.endsWith('/api') ? root : `${root}/api`;
}

async function dokployRequest(pathname, options = {}, source = process.env, fetchImpl = fetch) {
  const response = await fetchImpl(`${apiBase(source.DOKPLOY_URL)}${pathname}`, {
    ...options,
    headers: {
      'x-api-key': String(source.DOKPLOY_TOKEN || '').trim(),
      accept: 'application/json',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || `Dokploy returned HTTP ${response.status}`);
  return payload;
}

function requiredSource(source = process.env) {
  const required = [
    'DOKPLOY_URL',
    'DOKPLOY_TOKEN',
    'CHATGPT_GATEWAY_SHARED_SECRET',
    'RECRUITER_BACKEND_APP_ID',
    'PERFORMANCE_BACKEND_APP_ID'
  ];
  const missing = required.filter((key) => !String(source[key] || '').trim());
  if (missing.length) throw new Error(`Missing required configuration: ${missing.join(', ')}`);
  return {
    ...source,
    DOKPLOY_URL: String(source.DOKPLOY_URL).trim(),
    DOKPLOY_TOKEN: String(source.DOKPLOY_TOKEN).trim(),
    CHATGPT_GATEWAY_SHARED_SECRET: String(source.CHATGPT_GATEWAY_SHARED_SECRET).trim(),
    RECRUITER_BACKEND_APP_ID: String(source.RECRUITER_BACKEND_APP_ID).trim(),
    PERFORMANCE_BACKEND_APP_ID: String(source.PERFORMANCE_BACKEND_APP_ID).trim(),
    SEEMPLIFY_SHARED_AI_URL: String(
      source.SEEMPLIFY_SHARED_AI_URL || 'https://api.seemplifyai.com'
    ).replace(/\/+$/, '')
  };
}

function proxySecret(serviceId, source) {
  if (serviceId === 'performance-management') {
    return derivePerformanceProxySecret(source.CHATGPT_GATEWAY_SHARED_SECRET);
  }
  if (serviceId === 'messaging') {
    return deriveMessagingProxySecret(source.CHATGPT_GATEWAY_SHARED_SECRET);
  }
  throw new Error(`Unsupported shared-account proxy service: ${serviceId || '(empty)'}`);
}

function sharedProxyEnvironment(id, source) {
  const baseUrl = String(source.SEEMPLIFY_SHARED_AI_URL || 'https://api.seemplifyai.com')
    .replace(/\/+$/, '');
  if (id === 'recruiter') {
    return {
      PERFORMANCE_AI_SHARED_SECRET: proxySecret('performance-management', source),
      MESSAGING_AI_SHARED_SECRET: proxySecret('messaging', source)
    };
  }
  if (!PROXY_SERVICE_IDS.has(id)) {
    throw new Error(`Unsupported shared-account proxy target: ${id || '(empty)'}`);
  }
  return {
    SEEMPLIFY_AI_SOURCE_APP: id,
    SEEMPLIFY_SHARED_AI_URL: baseUrl,
    [id === 'messaging' ? 'MESSAGING_AI_SHARED_SECRET' : 'PERFORMANCE_AI_SHARED_SECRET']:
      proxySecret(id, source)
  };
}

function sharedProxyRemovedKeys(id) {
  return id === 'recruiter'
    ? []
    : [
        'CHATGPT_GATEWAY_BASE_URL',
        'CHATGPT_GATEWAY_SHARED_SECRET',
        'RECRUITER_CHATGPT_GATEWAY_SECRET',
        'RECRUITER_CHATGPT_GATEWAY_PREVIOUS_SECRET',
        'CHATGPT_GATEWAY_STORAGE_SECRET'
      ];
}

async function sharedAccountProxyReadinessProbe(serviceId, source = process.env, {
  fetchImpl = fetch,
  now = Date.now,
  randomBytes = crypto.randomBytes
} = {}) {
  if (!PROXY_SERVICE_IDS.has(serviceId)) {
    throw new Error(`Unsupported shared-account proxy service: ${serviceId || '(empty)'}`);
  }
  const timestamp = String(now());
  const nonce = randomBytes(24).toString('base64url');
  const body = '{}';
  const signature = crypto.createHmac('sha256', proxySecret(serviceId, source))
    .update([
      timestamp,
      nonce,
      serviceId,
      'POST',
      SHARED_ACCOUNT_HEALTH_PATH,
      body
    ].join('\n'))
    .digest('hex');
  const baseUrl = String(source.SEEMPLIFY_SHARED_AI_URL || 'https://api.seemplifyai.com')
    .replace(/\/+$/, '');
  const response = await fetchImpl(`${baseUrl}${SHARED_ACCOUNT_HEALTH_PATH}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      connection: 'close',
      'x-seemplify-service': serviceId,
      'x-seemplify-signature-version': '2',
      'x-seemplify-timestamp': timestamp,
      'x-seemplify-nonce': nonce,
      'x-seemplify-signature': signature
    },
    body
  });
  if (!response.ok) {
    throw new Error(`${serviceId} shared-account health probe failed with HTTP ${response.status}`);
  }
  const status = await response.json().catch(() => ({}));
  if (status?.ok !== true
      || status.service !== 'seemplify-shared-ai-account'
      || status.consumer !== serviceId
      || status.signatureVersion !== '2') {
    throw new Error(`${serviceId} shared-account health probe returned an invalid service identity`);
  }
  return true;
}

async function waitForSharedAccountProxyReadiness(serviceId, source = process.env, {
  probeImpl = sharedAccountProxyReadinessProbe,
  waitForReadinessImpl = waitForReadiness
} = {}) {
  return waitForReadinessImpl(
    `${serviceId} shared ChatGPT account proxy`,
    () => probeImpl(serviceId, source)
  );
}

async function configureSharedAccountProxies(source = process.env, options = {}) {
  const deploymentSource = requiredSource(source);
  const requestImpl = options.requestImpl
    || ((pathname, requestOptions) => dokployRequest(
      pathname,
      requestOptions,
      deploymentSource,
      options.fetchImpl || fetch
    ));
  const configureImpl = options.configureImpl || configureApplication;
  const resolveMessagingImpl = options.resolveMessagingImpl || resolveMessagingConsumer;
  const readinessImpl = options.readinessImpl || waitForSharedAccountProxyReadiness;
  const messaging = await resolveMessagingImpl(deploymentSource, { requestImpl });
  const targets = [
    { id: 'recruiter', applicationId: deploymentSource.RECRUITER_BACKEND_APP_ID },
    { id: 'performance-management', applicationId: deploymentSource.PERFORMANCE_BACKEND_APP_ID },
    messaging
  ].map((target) => ({
    id: String(target?.id || '').trim(),
    applicationId: String(target?.applicationId || '').trim()
  }));

  if (targets.some((target) => !target.id || !target.applicationId)) {
    throw new Error('Every shared-account proxy target requires an application ID');
  }
  const duplicateApplicationIds = targets
    .filter((target, index) => (
      targets.findIndex((candidate) => candidate.applicationId === target.applicationId) !== index
    ))
    .map((target) => target.applicationId);
  if (duplicateApplicationIds.length) {
    throw new Error(
      `Shared-account proxy application IDs must be unique: ${[...new Set(duplicateApplicationIds)].join(', ')}`
    );
  }

  // Resolve every target before the first environment write. A typo or stale
  // application ID must not leave Recruiter rotated while a consumer remains
  // on the previous key.
  const applications = new Map(await Promise.all(targets.map(async (target) => {
    const application = await requestImpl(
      `/application.one?applicationId=${encodeURIComponent(target.applicationId)}`
    );
    if (!application || typeof application !== 'object' || Array.isArray(application)) {
      throw new Error(`Dokploy application ${target.id} could not be verified`);
    }
    return [target.applicationId, application];
  })));

  const releaseId = new Date().toISOString();
  for (const target of targets) {
    await configureImpl(
      target.applicationId,
      sharedProxyEnvironment(target.id, deploymentSource),
      sharedProxyRemovedKeys(target.id),
      applications.get(target.applicationId),
      {
        requestImpl,
        title: `Shared ChatGPT ${target.id} proxy ${releaseId}`
      }
    );
    if (PROXY_SERVICE_IDS.has(target.id)) {
      // configureApplication waits for the target deployment record to finish;
      // this signed probe then proves Recruiter loaded and accepts that exact
      // target-bound key. Together they cover both sides without exposing the
      // gateway credential or requiring product-specific diagnostic routes.
      await readinessImpl(target.id, deploymentSource);
    }
  }
  return targets;
}

async function main() {
  const targets = await configureSharedAccountProxies();
  console.log(`Configured shared ChatGPT account proxy for: ${targets.map((target) => target.id).join(', ')}.`);
}

if (require.main === module) main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

module.exports = {
  SHARED_ACCOUNT_HEALTH_PATH,
  apiBase,
  configureSharedAccountProxies,
  dokployRequest,
  proxySecret,
  requiredSource,
  sharedAccountProxyReadinessProbe,
  sharedProxyEnvironment,
  sharedProxyRemovedKeys,
  waitForSharedAccountProxyReadiness
};
