'use strict';

const {
  apiBase,
  assertPersistentGatewayStorage,
  configureApplication,
  gatewayConsumerRegistrationProbe,
  gatewayReadinessProbe,
  parseEnv
} = require('./dokploy-configure.cjs');

function releaseSha(source = process.env) {
  const value = String(source.GITHUB_SHA || source.SEEMPLIFY_GATEWAY_RELEASE_SHA || '').trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(value)) throw new Error('GITHUB_SHA must be an exact 40-character commit SHA');
  return value;
}

async function request(path, options = {}, source = process.env) {
  const token = String(source.DOKPLOY_TOKEN || '').trim();
  if (!token) throw new Error('DOKPLOY_TOKEN is required');
  const response = await fetch(`${apiBase(source.DOKPLOY_URL)}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json', accept: 'application/json',
      'x-api-key': token, ...(options.headers || {})
    }
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Dokploy request failed with HTTP ${response.status}`);
  return body ? JSON.parse(body) : {};
}

async function waitForExactGatewayReadiness(source, {
  fetchImpl = fetch,
  attempts = 90,
  delayMs = 2_000,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await gatewayReadinessProbe(source, { fetchImpl });
      await gatewayConsumerRegistrationProbe(source, { fetchImpl });
      return true;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await wait(delayMs);
    }
  }
  throw new Error(`Exact gateway release did not become ready: ${lastError?.message || 'readiness timeout'}`);
}

async function deployGateway(source = process.env, {
  requestImpl = (path, options) => request(path, options, source),
  configureApplicationImpl = configureApplication,
  fetchImpl = fetch,
  wait = undefined,
  readinessAttempts = 90,
  readinessDelayMs = 2_000
} = {}) {
  const applicationId = String(source.CHATGPT_GATEWAY_APP_ID || '').trim();
  if (!applicationId) throw new Error('CHATGPT_GATEWAY_APP_ID is required');
  const release = releaseSha(source);
  const application = await requestImpl(`/application.one?applicationId=${encodeURIComponent(applicationId)}`);
  const [mounts, backups] = await Promise.all([
    requestImpl(`/mounts.allNamedByApplicationId?applicationId=${encodeURIComponent(applicationId)}`),
    requestImpl(`/volumeBackups.list?id=${encodeURIComponent(applicationId)}&volumeBackupType=application`)
  ]);
  assertPersistentGatewayStorage(mounts, backups, source);
  const currentSecret = String(parseEnv(application?.env || '').values.get('RECRUITER_CHATGPT_GATEWAY_SECRET') || '').trim();
  if (!currentSecret) throw new Error('The gateway application is missing its request authentication key');
  const readinessSource = {
    CHATGPT_GATEWAY_BASE_URL: source.CHATGPT_GATEWAY_BASE_URL,
    CHATGPT_GATEWAY_SHARED_SECRET: currentSecret,
    SEEMPLIFY_GATEWAY_RELEASE_SHA: release
  };
  const readinessProbe = () => waitForExactGatewayReadiness(readinessSource, {
    fetchImpl,
    attempts: readinessAttempts,
    delayMs: readinessDelayMs,
    ...(wait ? { wait } : {})
  });
  return configureApplicationImpl(
    applicationId,
    { SEEMPLIFY_GATEWAY_RELEASE_SHA: release },
    [],
    application,
    {
      requestImpl,
      title: `Seemplify ChatGPT gateway release ${release}`,
      readinessProbe,
      acceptRunningDeploymentWhenReady: true
    }
  );
}

async function main() {
  await deployGateway();
  console.log(`ChatGPT gateway release ${releaseSha()} is live and Messaging is registered.`);
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { deployGateway, releaseSha, waitForExactGatewayReadiness };
