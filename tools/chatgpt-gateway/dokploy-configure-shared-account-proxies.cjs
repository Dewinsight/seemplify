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
  configureEnvironment,
  deriveMessagingProxySecret,
  derivePerformanceProxySecret,
  resolveMessagingConsumer,
  waitForDeploymentCompletion,
  waitForReadiness
} = require('./dokploy-configure.cjs');

const SHARED_ACCOUNT_HEALTH_PATH = '/api/internal/ai/v1/health';
const PROXY_SERVICE_IDS = new Set(['performance-management', 'messaging']);
const CONSUMER_DEPLOYMENT_PATHS = Object.freeze({
  'performance-management': '/api/ai-account/deployment-health',
  messaging: '/api/workspace-ai/deployment-health'
});
const DEFAULT_DEPLOYMENT_WAIT_ATTEMPTS = 900;
const DEFAULT_DEPLOYMENT_WAIT_DELAY_MS = 2_000;
const DEFAULT_READINESS_WAIT_ATTEMPTS = 600;
const DEFAULT_READINESS_WAIT_DELAY_MS = 2_000;

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

function boundedInteger(source, key, fallback, { minimum, maximum }) {
  const raw = String(source[key] ?? '').trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${key} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function proxyRolloutTiming(source = process.env) {
  return {
    deploymentAttempts: boundedInteger(
      source,
      'SEEMPLIFY_PROXY_DEPLOYMENT_WAIT_ATTEMPTS',
      DEFAULT_DEPLOYMENT_WAIT_ATTEMPTS,
      { minimum: 300, maximum: 3_600 }
    ),
    deploymentDelayMs: boundedInteger(
      source,
      'SEEMPLIFY_PROXY_DEPLOYMENT_WAIT_DELAY_MS',
      DEFAULT_DEPLOYMENT_WAIT_DELAY_MS,
      { minimum: 500, maximum: 10_000 }
    ),
    readinessAttempts: boundedInteger(
      source,
      'SEEMPLIFY_PROXY_READINESS_WAIT_ATTEMPTS',
      DEFAULT_READINESS_WAIT_ATTEMPTS,
      { minimum: 60, maximum: 3_600 }
    ),
    readinessDelayMs: boundedInteger(
      source,
      'SEEMPLIFY_PROXY_READINESS_WAIT_DELAY_MS',
      DEFAULT_READINESS_WAIT_DELAY_MS,
      { minimum: 500, maximum: 10_000 }
    )
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

function sharedProxyEnvironmentMatches(application, id, source) {
  if (!application || typeof application !== 'object' || Array.isArray(application)) return false;
  return configureEnvironment(
    application.env,
    sharedProxyEnvironment(id, source),
    sharedProxyRemovedKeys(id)
  ).changed.length === 0;
}

function consumerDeploymentEndpoint(serviceId, source = process.env) {
  const base = serviceId === 'performance-management'
    ? source.PERFORMANCE_MANAGEMENT_API_URL
      || source.PERFORMANCE_API_URL
      || 'https://api-performance.seemplifyai.com'
    : serviceId === 'messaging'
      ? source.MESSAGING_API_URL || 'https://api-messaging.seemplifyai.com'
      : '';
  const pathname = CONSUMER_DEPLOYMENT_PATHS[serviceId];
  if (!base || !pathname) {
    throw new Error(`Unsupported shared-account proxy service: ${serviceId || '(empty)'}`);
  }
  const url = new URL(pathname, `${String(base).replace(/\/+$/, '')}/`);
  if (String(source.NODE_ENV || '').toLowerCase() === 'production' && url.protocol !== 'https:') {
    throw new Error(`${serviceId} deployment readiness URL must use HTTPS in production`);
  }
  return url.toString();
}

async function consumerDeploymentReadinessProbe(serviceId, source = process.env, {
  fetchImpl = fetch,
  now = Date.now,
  randomBytes = crypto.randomBytes
} = {}) {
  if (!PROXY_SERVICE_IDS.has(serviceId)) {
    throw new Error(`Unsupported shared-account proxy service: ${serviceId || '(empty)'}`);
  }
  const endpoint = new URL(consumerDeploymentEndpoint(serviceId, source));
  const pathname = endpoint.pathname;
  const timestamp = String(now());
  const nonce = randomBytes(24).toString('base64url');
  const body = '{}';
  const signature = crypto.createHmac('sha256', proxySecret(serviceId, source))
    .update([timestamp, nonce, serviceId, 'POST', pathname, body].join('\n'))
    .digest('hex');
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    redirect: 'error',
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
    throw new Error(`${serviceId} end-to-end deployment readiness probe failed with HTTP ${response.status}`);
  }
  if (!/^application\/json(?:\s*;|$)/i.test(String(response.headers?.get?.('content-type') || ''))) {
    throw new Error(`${serviceId} end-to-end deployment readiness probe returned a non-JSON response`);
  }
  const result = await response.json().catch(() => ({}));
  const shared = result?.shared;
  if (result?.ok !== true
      || result.service !== 'seemplify-shared-ai-consumer-deployment'
      || result.consumer !== serviceId
      || result.signatureVersion !== '2'
      || shared?.ok !== true
      || shared.service !== 'seemplify-shared-ai-account'
      || shared.consumer !== serviceId
      || shared.signatureVersion !== '2') {
    throw new Error(`${serviceId} end-to-end deployment readiness probe returned an invalid service identity`);
  }
  return true;
}

async function waitForConsumerDeploymentReadiness(serviceId, source = process.env, {
  probeImpl = consumerDeploymentReadinessProbe,
  waitForReadinessImpl = waitForReadiness,
  timing = proxyRolloutTiming(source)
} = {}) {
  return waitForReadinessImpl(
    `${serviceId} end-to-end deployment fallback`,
    () => probeImpl(serviceId, source),
    {
      attempts: timing.readinessAttempts,
      delayMs: timing.readinessDelayMs
    }
  );
}

function isStaleDeploymentTimeout(error, title) {
  const escapedTitle = String(title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `^Dokploy deployment ${escapedTitle} did not complete \\(last status: (?:running|queued)\\)$`
  ).test(String(error?.message || ''));
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
  waitForReadinessImpl = waitForReadiness,
  timing = proxyRolloutTiming(source)
} = {}) {
  return waitForReadinessImpl(
    `${serviceId} shared ChatGPT account proxy`,
    () => probeImpl(serviceId, source),
    {
      attempts: timing.readinessAttempts,
      delayMs: timing.readinessDelayMs
    }
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
  const deploymentWaitImpl = options.deploymentWaitImpl || waitForDeploymentCompletion;
  const resolveMessagingImpl = options.resolveMessagingImpl || resolveMessagingConsumer;
  const readinessImpl = options.readinessImpl || waitForSharedAccountProxyReadiness;
  const consumerDeploymentReadinessImpl = options.consumerDeploymentReadinessImpl
    || waitForConsumerDeploymentReadiness;
  const timing = proxyRolloutTiming(deploymentSource);
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
  const plans = targets.map((target) => ({
    ...target,
    application: applications.get(target.applicationId),
    environmentMatches: sharedProxyEnvironmentMatches(
      applications.get(target.applicationId),
      target.id,
      deploymentSource
    )
  }));
  const waitForDeploymentImpl = (applicationId, title, waitOptions = {}) => deploymentWaitImpl(
    applicationId,
    title,
    {
      ...waitOptions,
      attempts: timing.deploymentAttempts,
      delayMs: timing.deploymentDelayMs
    }
  );
  const deploy = async (target) => {
    const title = `Shared ChatGPT ${target.id} proxy ${releaseId}`;
    try {
      return await configureImpl(
        target.applicationId,
        sharedProxyEnvironment(target.id, deploymentSource),
        sharedProxyRemovedKeys(target.id),
        target.application,
        { requestImpl, waitForDeploymentImpl, title }
      );
    } catch (error) {
      // Dokploy can leave a successfully promoted revision labelled running.
      // Never trust that label alone: only a consumer-originated request signed
      // by the exact target key and carrying Recruiter's exact nested identity
      // can prove a timed-out consumer deployment complete.
      if (!PROXY_SERVICE_IDS.has(target.id) || !isStaleDeploymentTimeout(error, title)) throw error;
      console.warn(`${target.id} Dokploy deployment remained in progress; verifying exact end-to-end readiness.`);
      await consumerDeploymentReadinessImpl(target.id, deploymentSource, { timing });
      console.log(`${target.id} deployment accepted after exact end-to-end readiness verification.`);
      return { status: 'verified-ready', title };
    }
  };

  const authority = plans.find((target) => target.id === 'recruiter');
  if (authority.environmentMatches) {
    // A previous run can be interrupted after saveEnvironment and deploy. Do
    // not enqueue a second deployment for those same authority keys. The long
    // signed probes wait for that in-flight revision to reach the load balancer.
    console.log('Recruiter shared-account proxy keys already match; waiting for signed readiness without redeploying.');
  } else {
    await deploy(authority);
  }
  await Promise.all([...PROXY_SERVICE_IDS].map((serviceId) => (
    readinessImpl(serviceId, deploymentSource, { timing })
  )));

  for (const target of plans.filter((candidate) => candidate.id !== 'recruiter')) {
    if (target.environmentMatches) {
      // Authority readiness above proves the exact target-bound key is live.
      // The matching saved consumer environment means a retry must not create
      // a duplicate deployment while Dokploy may still be finishing that app.
      console.log(`${target.id} shared-account proxy environment already matches; skipping redeploy.`);
      continue;
    }
    await deploy(target);
    // Preserve a fail-closed post-deployment check for each changed consumer.
    await readinessImpl(target.id, deploymentSource, { timing });
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
  consumerDeploymentEndpoint,
  consumerDeploymentReadinessProbe,
  dokployRequest,
  isStaleDeploymentTimeout,
  proxySecret,
  proxyRolloutTiming,
  requiredSource,
  sharedAccountProxyReadinessProbe,
  sharedProxyEnvironment,
  sharedProxyEnvironmentMatches,
  sharedProxyRemovedKeys,
  waitForConsumerDeploymentReadiness,
  waitForSharedAccountProxyReadiness
};
