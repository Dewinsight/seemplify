'use strict';

const crypto = require('node:crypto');
const { configuredConsumers } = require('./consumer-registry.cjs');

const PERFORMANCE_PROXY_KEY_CONTEXT = 'seemplify-internal-ai-v1:performance-management';
const MESSAGING_PROXY_KEY_CONTEXT = 'seemplify-internal-ai-v1:messaging';
const IDP_WEBHOOK_KEY_CONTEXT = 'seemplify-idp-webhook-v2';
const IDP_WEBHOOK_TARGET_KEY_CONTEXT = 'seemplify-idp-webhook-target-v1';
const LOCAL_LLM_SERVICE_KEY_CONTEXT = 'seemplify-local-llm-service-v2';
const IDP_WEBHOOK_TARGETS = Object.freeze({
  recruiter: 'RECRUITER',
  'leave-management': 'LEAVE_MANAGEMENT',
  payroll: 'PAYROLL',
  'performance-management': 'PERFORMANCE_MANAGEMENT'
});
const IDP_TARGET_SECRET_KEYS = Object.values(IDP_WEBHOOK_TARGETS)
  .map((suffix) => `IDP_WEBHOOK_SECRET_${suffix}`);
const INSECURE_WEBHOOK_SECRET = 'your-webhook-secret-key';
const IDP_WEBHOOK_PREVIOUS_PROOF_KEY = 'IDP_WEBHOOK_SECRET_PREVIOUS_PROOF';
const ROTATION_RETIREMENT_LEDGER_KEY = 'SEEMPLIFY_ROTATION_RETIREMENT_LEDGER';
const ROTATION_RETIREMENT_LEDGER_CONTEXT = 'seemplify-rotation-retirement-ledger-v1';

function normalizeRetiredKeys(retiredKeys) {
  const value = retiredKeys && typeof retiredKeys === 'object' ? retiredKeys : {};
  const webhookEntries = Object.entries(value.webhooks && typeof value.webhooks === 'object'
    && !Array.isArray(value.webhooks) ? value.webhooks : {});
  const webhooks = {};
  for (const [target, secret] of webhookEntries) {
    if (!Object.prototype.hasOwnProperty.call(IDP_WEBHOOK_TARGETS, target)) {
      throw new Error(`Retirement ledger contains an unknown webhook target: ${target}`);
    }
    const normalized = String(secret || '').trim();
    if (normalized) webhooks[target] = normalized;
  }
  return {
    gateway: String(value.gateway || '').trim(),
    performanceProxy: String(value.performanceProxy || '').trim(),
    webhooks
  };
}

function retirementLedgerKey(operatorMaster, salt) {
  const master = String(operatorMaster || '').trim();
  // Reuse the validation for the already operator-only IdP master, but derive
  // a separate encryption key so webhook signing and ledger encryption never
  // share key material directly.
  deriveIdpWebhookSecret(master);
  return crypto.hkdfSync(
    'sha256',
    Buffer.from(master, 'utf8'),
    salt,
    Buffer.from(ROTATION_RETIREMENT_LEDGER_CONTEXT, 'utf8'),
    32
  );
}

function encryptRetirementLedger(retiredKeys, operatorMaster, gatewayId, {
  randomBytes = crypto.randomBytes,
  now = Date.now
} = {}) {
  const applicationId = String(gatewayId || '').trim();
  if (!applicationId) throw new Error('A gateway application ID is required for the retirement ledger');
  const salt = randomBytes(32);
  const iv = randomBytes(12);
  const key = retirementLedgerKey(operatorMaster, salt);
  const aad = Buffer.from(`${ROTATION_RETIREMENT_LEDGER_CONTEXT}\n${applicationId}`, 'utf8');
  const plaintext = Buffer.from(JSON.stringify({
    version: 1,
    gatewayId: applicationId,
    createdAt: new Date(now()).toISOString(),
    retiredKeys: normalizeRetiredKeys(retiredKeys)
  }), 'utf8');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', salt, iv, tag, ciphertext].map((part) => (
    Buffer.isBuffer(part) ? part.toString('base64url') : part
  )).join('.');
}

function decryptRetirementLedger(serialized, operatorMaster, gatewayId) {
  const applicationId = String(gatewayId || '').trim();
  const value = String(serialized || '').trim();
  if (!applicationId || !value) throw new Error('An unfinished retirement ledger is required');
  if (Buffer.byteLength(value, 'utf8') > 64 * 1024) {
    throw new Error('Retirement ledger is too large');
  }
  try {
    const parts = value.split('.');
    if (parts.length !== 5 || parts[0] !== 'v1') throw new Error('invalid envelope');
    const [salt, iv, tag, ciphertext] = parts.slice(1).map(part => Buffer.from(part, 'base64url'));
    if (salt.length !== 32 || iv.length !== 12 || tag.length !== 16 || !ciphertext.length) {
      throw new Error('invalid envelope');
    }
    const decipher = crypto.createDecipheriv('aes-256-gcm', retirementLedgerKey(operatorMaster, salt), iv);
    decipher.setAAD(Buffer.from(`${ROTATION_RETIREMENT_LEDGER_CONTEXT}\n${applicationId}`, 'utf8'));
    decipher.setAuthTag(tag);
    const payload = JSON.parse(Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]).toString('utf8'));
    if (payload?.version !== 1 || payload.gatewayId !== applicationId
        || !payload.retiredKeys || typeof payload.createdAt !== 'string') {
      throw new Error('invalid payload');
    }
    return normalizeRetiredKeys(payload.retiredKeys);
  } catch (error) {
    if (/IDP_WEBHOOK_MASTER_SECRET/.test(String(error?.message || ''))) throw error;
    throw new Error('Retirement ledger authentication failed; use the original operator master and an untampered ledger');
  }
}

function previousWebhookSecretProof(webhookMaster, targetId, secret) {
  return crypto.createHmac('sha256', String(webhookMaster || '').trim())
    .update(`seemplify-idp-webhook-previous-v1:${String(targetId || '').trim()}:${String(secret || '').trim()}`)
    .digest('hex');
}

function forbiddenWebhookKeysForTarget(id) {
  return [
    'IDP_WEBHOOK_MASTER_SECRET',
    ...(id === 'identity-provider' ? [] : IDP_TARGET_SECRET_KEYS)
  ];
}

function safePreviousWebhookSecret(application, targetId, source = process.env, idpApplication = null) {
  const rawMaster = String(source.IDP_WEBHOOK_MASTER_SECRET || '').trim();
  const root = deriveIdpWebhookSecret(source.IDP_WEBHOOK_MASTER_SECRET);
  const targetSecrets = new Map(Object.keys(IDP_WEBHOOK_TARGETS).map((id) => [
    id,
    deriveIdpWebhookTargetSecret(root, id)
  ]));
  const priorRawMaster = applicationEnvironmentValue(idpApplication, 'IDP_WEBHOOK_MASTER_SECRET');
  const priorRoot = applicationEnvironmentValue(idpApplication, 'IDP_WEBHOOK_SECRET');
  const priorTargetSecrets = new Map(Object.entries(IDP_WEBHOOK_TARGETS).map(([id, suffix]) => [
    id,
    applicationEnvironmentValue(idpApplication, `IDP_WEBHOOK_SECRET_${suffix}`)
  ]));
  const priorKeysWereTargetIsolated = [...priorTargetSecrets.values()].some(Boolean);
  const stagedCurrent = applicationEnvironmentValue(application, 'IDP_WEBHOOK_SECRET');
  const stagedPrevious = applicationEnvironmentValue(application, 'IDP_WEBHOOK_SECRET_PREVIOUS');
  const stagedPreviousProof = applicationEnvironmentValue(application, IDP_WEBHOOK_PREVIOUS_PROOF_KEY);
  const expectedStagedProof = stagedPrevious
    ? previousWebhookSecretProof(rawMaster, targetId, stagedPrevious)
    : '';
  const trustedInterruptedStage = stagedCurrent === targetSecrets.get(targetId)
    && Boolean(stagedPrevious)
    && stagedPreviousProof === expectedStagedProof;
  const candidates = [
    applicationEnvironmentValue(application, 'IDP_WEBHOOK_SECRET'),
    applicationEnvironmentValue(application, 'IDP_WEBHOOK_SECRET_PREVIOUS')
  ].map(value => String(value || '').trim()).filter(Boolean);
  for (const candidate of candidates) {
    if (candidate === rawMaster
        || candidate === root
        || candidate === targetSecrets.get(targetId)
        || candidate === priorRawMaster
        || (priorKeysWereTargetIsolated && candidate === priorRoot)) continue;
    if (idpApplication) {
      const authorizedPriorKey = priorKeysWereTargetIsolated
        ? priorTargetSecrets.get(targetId)
        : priorRoot;
      // Once the IdP advertises its pre-cutover key map, no unknown key has a
      // legitimate compatibility purpose. This also cleans up a stale sibling
      // left behind by a previously interrupted rotation.
      const authorizedInterruptedStageKey = trustedInterruptedStage && candidate === stagedPrevious;
      if ((!authorizedPriorKey || candidate !== authorizedPriorKey) && !authorizedInterruptedStageKey) continue;
    }
    let sibling = false;
    for (const [id, secret] of targetSecrets) {
      if (id !== targetId && candidate === secret) sibling = true;
    }
    for (const [id, secret] of priorTargetSecrets) {
      if (id !== targetId && secret && candidate === secret) sibling = true;
    }
    if (!sibling) {
      if (Buffer.byteLength(candidate, 'utf8') < 32 || candidate === INSECURE_WEBHOOK_SECRET) {
        throw new Error(`${targetId} has a weak legacy webhook key that cannot be preserved for a seamless rotation`);
      }
      return candidate;
    }
  }
  return '';
}

async function requireJsonResponse(response, label) {
  try {
    return await response.json();
  } catch {
    throw new Error(`${label} returned an invalid JSON response`);
  }
}

function resolveGatewaySecrets(currentEnvironment, bootstrapStorageSecret, randomBytes = crypto.randomBytes) {
  const current = parseEnv(currentEnvironment).values;
  const existingRequestSecret = String(current.get('RECRUITER_CHATGPT_GATEWAY_SECRET') || '').trim();
  const legacySecret = String(current.get('CHATGPT_GATEWAY_SHARED_SECRET') || '').trim();
  const storageSecret = String(
    current.get('CHATGPT_GATEWAY_STORAGE_SECRET')
    || legacySecret
    || bootstrapStorageSecret
    || ''
  ).trim();
  if (!storageSecret) throw new Error('A gateway storage/bootstrap secret is required');
  return {
    // Never derive this from the legacy master: any former consumer that knew
    // that value must be unable to calculate the rotated Recruiter credential.
    requestSecret: existingRequestSecret || randomBytes(48).toString('base64url'),
    previousRequestSecret: String(
      current.get('RECRUITER_CHATGPT_GATEWAY_PREVIOUS_SECRET')
      || (!existingRequestSecret ? legacySecret : '')
      || ''
    ).trim(),
    storageSecret
  };
}

function derivePerformanceProxySecret(gatewayMaster) {
  const master = String(gatewayMaster || '').trim();
  if (!master) throw new Error('CHATGPT_GATEWAY_SHARED_SECRET is required');
  return crypto.createHmac('sha256', master).update(PERFORMANCE_PROXY_KEY_CONTEXT).digest('hex');
}

function deriveMessagingProxySecret(gatewayMaster) {
  const master = String(gatewayMaster || '').trim();
  if (!master) throw new Error('CHATGPT_GATEWAY_SHARED_SECRET is required');
  return crypto.createHmac('sha256', master).update(MESSAGING_PROXY_KEY_CONTEXT).digest('hex');
}

function deriveIdpWebhookSecret(webhookMasterSecret) {
  const secret = String(webhookMasterSecret || '').trim();
  const normalized = secret.toLowerCase();
  const looksPlaceholder = /(?:change[-_ ]?me|placeholder|example|password|development|your[-_ ]?webhook|test[-_ ]?secret)/.test(normalized);
  if (Buffer.byteLength(secret, 'utf8') < 32 || looksPlaceholder || new Set(secret).size < 8) {
    throw new Error('IDP_WEBHOOK_MASTER_SECRET must be at least 32 high-entropy bytes and must not be a placeholder');
  }
  return crypto.createHmac('sha256', secret).update(IDP_WEBHOOK_KEY_CONTEXT).digest('hex');
}

function deriveIdpWebhookTargetSecret(webhookRootSecret, targetId) {
  const root = String(webhookRootSecret || '').trim();
  const target = String(targetId || '').trim().toLowerCase();
  if (!root) throw new Error('An IdP webhook root secret is required');
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(target)) {
    throw new Error(`Invalid IdP webhook target: ${target || '(empty)'}`);
  }
  return crypto.createHmac('sha256', root)
    .update(`${IDP_WEBHOOK_TARGET_KEY_CONTEXT}:${target}`)
    .digest('hex');
}

function deriveLocalLlmServiceSecret(localGatewayMaster, serviceId) {
  const master = String(localGatewayMaster || '').trim();
  const service = String(serviceId || '').trim().toLowerCase();
  if (!master) throw new Error('LOCAL_LLM_SHARED_SECRET is required');
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(service)) throw new Error('A valid Local LLM service id is required');
  return crypto.createHmac('sha256', master)
    .update(`${LOCAL_LLM_SERVICE_KEY_CONTEXT}:${service}`)
    .digest('base64url');
}

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

function platformUsageSinkUrl(source = process.env) {
  const base = String(
    source.SEEMPLIFY_SHARED_AI_URL
    || source.RECRUITER_BACKEND_URL
    || 'https://api.seemplifyai.com'
  ).replace(/\/+$/, '');
  const configured = String(source.PLATFORM_AI_USAGE_SINK_URL || `${base}/api/internal/ai/v1/chatgpt-usage/events`).trim();
  const parsed = new URL(configured);
  if (parsed.pathname !== '/api/internal/ai/v1/chatgpt-usage/events') {
    throw new Error('PLATFORM_AI_USAGE_SINK_URL must target the Recruiter ChatGPT usage ingestion route');
  }
  if (String(source.NODE_ENV || '').toLowerCase() === 'production' && parsed.protocol !== 'https:') {
    throw new Error('PLATFORM_AI_USAGE_SINK_URL must use HTTPS in production');
  }
  return parsed.toString().replace(/\/$/, '');
}

async function gatewayReadinessProbe(source = process.env, { fetchImpl = fetch, now = Date.now } = {}) {
  const gatewayBase = String(source.CHATGPT_GATEWAY_BASE_URL || '').replace(/\/+$/, '');
  const gatewaySecret = String(source.CHATGPT_GATEWAY_SHARED_SECRET || '').trim();
  if (!gatewayBase || !gatewaySecret) throw new Error('Current gateway URL and request key are required for readiness verification');

  const gatewayPath = '/v1/codex/account';
  const gatewayBody = JSON.stringify({ sourceApp: 'recruiter', subjectId: 'deployment-readiness-probe' });
  const gatewayTimestamp = String(now());
  const gatewayNonce = crypto.randomBytes(24).toString('base64url');
  const gatewaySignature = crypto.createHmac('sha256', gatewaySecret)
    .update(`${gatewayTimestamp}\n${gatewayNonce}\nPOST\n${gatewayPath}\n${gatewayBody}`)
    .digest('base64url');
  const gatewayResponse = await fetchImpl(`${gatewayBase}${gatewayPath}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-seemplify-timestamp': gatewayTimestamp,
      'x-seemplify-nonce': gatewayNonce,
      'x-seemplify-signature': gatewaySignature
    },
    body: gatewayBody
  });
  if (!gatewayResponse.ok) throw new Error(`Gateway current-key readiness probe failed with HTTP ${gatewayResponse.status}`);
  const gatewayStatus = await requireJsonResponse(gatewayResponse, 'Gateway current-key readiness probe');
  if (typeof gatewayStatus?.connected !== 'boolean') {
    throw new Error('Gateway current-key readiness probe returned an invalid account status');
  }
  return true;
}

async function gatewayConsumerRegistrationProbe(source = process.env, { fetchImpl = fetch } = {}) {
  const gatewayBase = String(source.CHATGPT_GATEWAY_BASE_URL || '').replace(/\/+$/, '');
  if (!gatewayBase) throw new Error('Current gateway URL is required for consumer readiness verification');
  const response = await fetchImpl(`${gatewayBase}/health`, {
    method: 'GET',
    headers: { accept: 'application/json' },
    redirect: 'error'
  });
  if (!response.ok) throw new Error(`Gateway consumer readiness probe failed with HTTP ${response.status}`);
  const status = await requireJsonResponse(response, 'Gateway consumer readiness probe');
  if (status?.ok !== true
      || status.service !== 'seemplify-ai-gateway'
      || status.runtime !== 'codex-app-server'
      || status.ownership !== 'seemplify-platform'
      || !Array.isArray(status.consumers)
      || !status.consumers.includes('messaging')
      || (String(source.SEEMPLIFY_GATEWAY_RELEASE_SHA || '').trim()
        && status.release !== String(source.SEEMPLIFY_GATEWAY_RELEASE_SHA).trim().toLowerCase())) {
    throw new Error('Gateway consumer readiness probe did not register Messaging');
  }
  return true;
}

async function waitForGatewayReadiness(source = process.env, {
  fetchImpl = fetch,
  now = Date.now,
  attempts = 60,
  delayMs = 2_000,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await gatewayReadinessProbe(source, { fetchImpl, now });
      return true;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await wait(delayMs);
    }
  }
  throw new Error(`Gateway did not accept the staged current key: ${lastError?.message || 'readiness timeout'}`);
}

async function recruiterProxyReadinessProbe(source = process.env, {
  fetchImpl = fetch,
  now = Date.now,
  secretOverride = ''
} = {}) {
  const sharedAiBase = String(source.SEEMPLIFY_SHARED_AI_URL || 'https://api.seemplifyai.com').replace(/\/+$/, '');
  const gatewaySecret = String(source.CHATGPT_GATEWAY_SHARED_SECRET || '').trim();
  const performanceSecret = String(secretOverride || derivePerformanceProxySecret(gatewaySecret));
  const proxyPath = '/api/internal/ai/v1/health';
  const proxyBody = '{}';
  const proxyTimestamp = String(now());
  const proxyNonce = crypto.randomBytes(24).toString('base64url');
  const proxySignature = crypto.createHmac('sha256', performanceSecret)
    .update(`${proxyTimestamp}\n${proxyNonce}\nperformance-management\nPOST\n${proxyPath}\n${proxyBody}`)
    .digest('hex');
  const proxyResponse = await fetchImpl(`${sharedAiBase}${proxyPath}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-seemplify-service': 'performance-management',
      'x-seemplify-signature-version': '2',
      'x-seemplify-timestamp': proxyTimestamp,
      'x-seemplify-nonce': proxyNonce,
      'x-seemplify-signature': proxySignature
    },
    body: proxyBody
  });
  if (!proxyResponse.ok) throw new Error(`Performance proxy current-key readiness probe failed with HTTP ${proxyResponse.status}`);
  const proxyStatus = await requireJsonResponse(proxyResponse, 'Performance proxy current-key readiness probe');
  if (proxyStatus?.ok !== true
      || proxyStatus.service !== 'seemplify-shared-ai-account'
      || proxyStatus.consumer !== 'performance-management'
      || proxyStatus.signatureVersion !== '2') {
    throw new Error('Performance proxy current-key readiness probe returned an invalid service identity');
  }
  return true;
}

async function performanceDeploymentReadinessProbe(source = process.env, { fetchImpl = fetch, now = Date.now } = {}) {
  const performanceBase = String(
    source.PERFORMANCE_MANAGEMENT_API_URL
    || source.PERFORMANCE_API_URL
    || 'https://api-performance.seemplifyai.com'
  ).replace(/\/+$/, '');
  const secret = derivePerformanceProxySecret(String(source.CHATGPT_GATEWAY_SHARED_SECRET || '').trim());
  const pathname = '/api/ai-account/deployment-health';
  const body = '{}';
  const timestamp = String(now());
  const nonce = crypto.randomBytes(24).toString('base64url');
  const signature = crypto.createHmac('sha256', secret)
    .update([timestamp, nonce, 'performance-management', 'POST', pathname, body].join('\n'))
    .digest('hex');
  const response = await fetchImpl(`${performanceBase}${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-seemplify-service': 'performance-management',
      'x-seemplify-signature-version': '2',
      'x-seemplify-timestamp': timestamp,
      'x-seemplify-nonce': nonce,
      'x-seemplify-signature': signature
    },
    body
  });
  if (!response.ok) throw new Error(`Performance end-to-end readiness probe failed with HTTP ${response.status}`);
  const result = await response.json().catch(() => ({}));
  if (result.ok !== true || result.shared?.ok !== true) {
    throw new Error('Performance end-to-end readiness probe did not reach Recruiter');
  }
  return true;
}

async function idpWebhookReadinessProbe(source = process.env, { fetchImpl = fetch, now = Date.now } = {}) {
  const idpBase = String(source.OIDC_ISSUER || source.IDP_ISSUER_URL || 'https://auth.seemplifyai.com').replace(/\/+$/, '');
  const rootSecret = deriveIdpWebhookSecret(source.IDP_WEBHOOK_MASTER_SECRET);
  const pathname = '/api/internal/webhook-readiness';
  const body = '{}';
  const timestamp = String(now());
  const nonce = crypto.randomBytes(24).toString('base64url');
  const signature = crypto.createHmac('sha256', rootSecret)
    .update([timestamp, nonce, 'POST', pathname, body].join('\n'))
    .digest('hex');
  const response = await fetchImpl(`${idpBase}${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-seemplify-timestamp': timestamp,
      'x-seemplify-nonce': nonce,
      'x-seemplify-signature': signature
    },
    body
  });
  if (!response.ok) throw new Error(`IdP webhook end-to-end readiness probe failed with HTTP ${response.status}`);
  const result = await response.json().catch(() => ({}));
  const requiredTargets = new Set(['smarthr', 'leaveManagement', 'payroll', 'performance']);
  const reached = new Set(Array.isArray(result.targets) ? result.targets : []);
  if (result.ok !== true || [...requiredTargets].some(target => !reached.has(target))) {
    throw new Error('IdP webhook readiness did not reach every required receiver');
  }
  return true;
}

function webhookReceiverUrl(targetId, source = process.env) {
  const explicit = {
    recruiter: source.SMARTHR_WEBHOOK_URL,
    'performance-management': source.PERFORMANCE_WEBHOOK_URL,
    'leave-management': source.LEAVE_WEBHOOK_URL,
    payroll: source.PAYROLL_WEBHOOK_URL
  }[targetId];
  const base = {
    recruiter: source.SEEMPLIFY_SHARED_AI_URL || 'https://api.seemplifyai.com',
    'performance-management': source.PERFORMANCE_MANAGEMENT_API_URL || source.PERFORMANCE_API_URL || 'https://api-performance.seemplifyai.com',
    'leave-management': source.LEAVE_MANAGEMENT_API_URL || 'https://api-leave.seemplifyai.com',
    payroll: source.PAYROLL_MANAGEMENT_API_URL || 'https://api-payroll.seemplifyai.com'
  }[targetId];
  const url = String(explicit || (base ? `${String(base).replace(/\/+$/, '')}/api/webhooks/idp` : '')).trim();
  if (!url) return '';
  const parsed = new URL(url);
  if (String(source.NODE_ENV || '').toLowerCase() === 'production' && parsed.protocol !== 'https:') {
    throw new Error(`${targetId} webhook readiness URL must use HTTPS in production`);
  }
  return parsed.toString().replace(/\/$/, '');
}

function deploymentSourceWithIdpWebhookDestinations(source, idpApplication) {
  const merged = { ...source };
  for (const key of ['SMARTHR_WEBHOOK_URL', 'PERFORMANCE_WEBHOOK_URL', 'LEAVE_WEBHOOK_URL', 'PAYROLL_WEBHOOK_URL']) {
    const operatorValue = String(source?.[key] || '').trim();
    const savedValue = applicationEnvironmentValue(idpApplication, key);
    if (operatorValue) merged[key] = operatorValue;
    else if (savedValue) merged[key] = savedValue;
  }
  return merged;
}

async function webhookReceiverReadinessProbe(targetId, source = process.env, {
  fetchImpl = fetch,
  now = Date.now,
  secretOverride = ''
} = {}) {
  const url = webhookReceiverUrl(targetId, source);
  if (!url) throw new Error(`No webhook readiness URL is configured for ${targetId}`);
  const root = deriveIdpWebhookSecret(source.IDP_WEBHOOK_MASTER_SECRET);
  const secret = String(secretOverride || deriveIdpWebhookTargetSecret(root, targetId));
  const occurredAt = new Date(now()).toISOString();
  const payload = {
    eventId: crypto.randomUUID(),
    event: 'system.webhook_probe',
    data: { purpose: 'pre-cutover-receiver-readiness' },
    occurredAt,
    timestamp: occurredAt,
    idpVersion: '1.0'
  };
  const body = JSON.stringify(payload);
  const deliveryTimestamp = new Date(now()).toISOString();
  const signature = crypto.createHmac('sha256', secret)
    .update(`${deliveryTimestamp}\n${body}`)
    .digest('hex');
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-idp-event': payload.event,
      'x-idp-delivery-timestamp': deliveryTimestamp,
      'x-idp-signature-v2': signature
    },
    body
  });
  if (!response.ok) throw new Error(`${targetId} webhook receiver rejected its staged key with HTTP ${response.status}`);
  const acknowledgement = await requireJsonResponse(response, `${targetId} webhook receiver readiness probe`);
  if (acknowledgement?.received !== true
      || acknowledgement.event !== payload.event
      || acknowledgement.eventId !== payload.eventId) {
    throw new Error(`${targetId} webhook receiver returned an invalid event acknowledgement`);
  }
  return true;
}

function captureRetiredKeys({ gatewaySecrets, consumers, applications }) {
  const recruiter = consumers.find(consumer => consumer.id === 'recruiter');
  return {
    gateway: String(gatewaySecrets.previousRequestSecret || '').trim(),
    performanceProxy: recruiter
      ? applicationEnvironmentValue(applications.get(recruiter.applicationId), 'PERFORMANCE_AI_SHARED_SECRET_PREVIOUS')
      : '',
    webhooks: Object.fromEntries(consumers
      .filter(consumer => Object.prototype.hasOwnProperty.call(IDP_WEBHOOK_TARGETS, consumer.id))
      .map(consumer => [
        consumer.id,
        applicationEnvironmentValue(applications.get(consumer.applicationId), 'IDP_WEBHOOK_SECRET_PREVIOUS')
      ])
      .filter(([, secret]) => Boolean(secret)))
  };
}

async function retiredCredentialResponse(kind, secret, source, { fetchImpl = fetch, now = Date.now } = {}) {
  const timestamp = String(now());
  const nonce = crypto.randomBytes(24).toString('base64url');
  if (kind === 'gateway') {
    const pathname = '/v1/codex/account';
    const body = JSON.stringify({ sourceApp: 'recruiter', subjectId: 'retired-key-probe' });
    const signature = crypto.createHmac('sha256', secret)
      .update(`${timestamp}\n${nonce}\nPOST\n${pathname}\n${body}`)
      .digest('base64url');
    return fetchImpl(`${String(source.CHATGPT_GATEWAY_BASE_URL).replace(/\/+$/, '')}${pathname}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json', 'cache-control': 'no-store', connection: 'close',
        'x-seemplify-timestamp': timestamp, 'x-seemplify-nonce': nonce, 'x-seemplify-signature': signature
      },
      body
    });
  }
  if (kind === 'performanceProxy') {
    const pathname = '/api/internal/ai/v1/health';
    const body = '{}';
    const signature = crypto.createHmac('sha256', secret)
      .update(`${timestamp}\n${nonce}\nperformance-management\nPOST\n${pathname}\n${body}`)
      .digest('hex');
    return fetchImpl(`${String(source.SEEMPLIFY_SHARED_AI_URL || 'https://api.seemplifyai.com').replace(/\/+$/, '')}${pathname}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json', 'cache-control': 'no-store', connection: 'close',
        'x-seemplify-service': 'performance-management', 'x-seemplify-signature-version': '2',
        'x-seemplify-timestamp': timestamp, 'x-seemplify-nonce': nonce, 'x-seemplify-signature': signature
      },
      body
    });
  }
  const targetId = kind.replace(/^webhook:/, '');
  const occurredAt = new Date(now()).toISOString();
  const payload = {
    eventId: crypto.randomUUID(), event: 'system.webhook_probe',
    data: { purpose: 'retired-key-rejection' }, occurredAt, timestamp: occurredAt, idpVersion: '1.0'
  };
  const body = JSON.stringify(payload);
  const deliveryTimestamp = new Date(now()).toISOString();
  const signature = crypto.createHmac('sha256', secret)
    .update(`${deliveryTimestamp}\n${body}`)
    .digest('hex');
  return fetchImpl(webhookReceiverUrl(targetId, source), {
    method: 'POST',
    headers: {
      'content-type': 'application/json', 'cache-control': 'no-store', connection: 'close',
      'x-idp-event': payload.event,
      'x-idp-delivery-timestamp': deliveryTimestamp,
      'x-idp-signature-v2': signature
    },
    body
  });
}

async function assertRetiredKeysRejected(retiredKeys, source = process.env, {
  fetchImpl = fetch,
  now = Date.now,
  attempts
} = {}) {
  const attemptCount = attempts == null
    ? Number(source.SEEMPLIFY_ROTATION_RETIREMENT_PROBE_ATTEMPTS || 5)
    : Number(attempts);
  if (!Number.isInteger(attemptCount) || attemptCount < 3 || attemptCount > 50) {
    throw new Error('SEEMPLIFY_ROTATION_RETIREMENT_PROBE_ATTEMPTS must be an integer from 3 to 50');
  }
  const probes = [
    ...(retiredKeys.gateway ? [['gateway', retiredKeys.gateway]] : []),
    ...(retiredKeys.performanceProxy ? [['performanceProxy', retiredKeys.performanceProxy]] : []),
    ...Object.entries(retiredKeys.webhooks || {}).map(([target, secret]) => [`webhook:${target}`, secret])
  ];
  for (const [kind, secret] of probes) {
    for (let attempt = 0; attempt < attemptCount; attempt += 1) {
      const response = await retiredCredentialResponse(kind, secret, source, { fetchImpl, now });
      if (response.status !== 401) {
        throw new Error(`Retired ${kind} credential was not rejected (HTTP ${response.status})`);
      }
    }
  }
  return true;
}

async function waitForReadiness(label, probe, {
  attempts = 60,
  delayMs = 2_000,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await probe();
      return true;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await wait(delayMs);
    }
  }
  throw new Error(`${label} did not become ready: ${lastError?.message || 'readiness timeout'}`);
}

async function publicHealthProbe(url, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(String(url));
  if (!response.ok) throw new Error(`Health endpoint returned HTTP ${response.status}`);
  return true;
}

async function rotationReadinessSmoke(source = process.env, { fetchImpl = fetch, now = Date.now } = {}) {
  await gatewayReadinessProbe(source, { fetchImpl, now });
  await performanceDeploymentReadinessProbe(source, { fetchImpl, now });
  await idpWebhookReadinessProbe(source, { fetchImpl, now });
  return { gateway: true, performanceProxy: true, webhookTargets: true };
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

async function waitForDeploymentCompletion(applicationId, title, {
  requestImpl = request,
  attempts = 300,
  delayMs = 2_000,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
} = {}) {
  let lastStatus = 'queued';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const payload = await requestImpl(`/deployment.all?applicationId=${encodeURIComponent(applicationId)}`);
    const deployments = responseItems(payload, ['deployments', 'items']);
    const deployment = deployments.find((item) => String(item?.title || '') === title);
    if (deployment) {
      lastStatus = String(deployment.status || 'running').toLowerCase();
      if (lastStatus === 'done') return deployment;
      if (lastStatus === 'error' || lastStatus === 'cancelled') {
        throw new Error(`Dokploy deployment ${title} ${lastStatus}: ${deployment.errorMessage || 'no error detail'}`);
      }
    }
    if (attempt < attempts) await wait(delayMs);
  }
  throw new Error(`Dokploy deployment ${title} did not complete (last status: ${lastStatus})`);
}

async function saveApplicationEnvironment(
  applicationId,
  required,
  removed = [],
  currentApplication = null,
  { requestImpl = request } = {}
) {
  const app = currentApplication
    || await requestImpl(`/application.one?applicationId=${encodeURIComponent(applicationId)}`);
  const next = configureEnvironment(app.env, required, removed);
  if (next.changed.length) {
    await requestImpl('/application.saveEnvironment', {
      method: 'POST',
      body: JSON.stringify({
        applicationId, env: next.env, buildArgs: app.buildArgs || '',
        buildSecrets: app.buildSecrets || '', createEnvFile: app.createEnvFile === true
      })
    });
    // Keep the preflight snapshot aligned with Dokploy's saved environment.
    // This prevents a later save in the same run from resurrecting a key that
    // an earlier save removed.
    app.env = next.env;
    console.log(`Updated ${next.changed.length} environment keys for application ${applicationId}.`);
  }
  return { application: app, changed: next.changed, env: next.env };
}

async function prepareRetirementLedger({
  rotationPhase,
  gatewayId,
  gatewayApplication,
  retiredKeys,
  operatorMaster,
  requestImpl = request,
  randomBytes = crypto.randomBytes,
  now = Date.now
}) {
  const saved = applicationEnvironmentValue(gatewayApplication, ROTATION_RETIREMENT_LEDGER_KEY);
  if (rotationPhase === 'stage') {
    if (saved) {
      throw new Error('An unfinished rotation retirement ledger exists; resume finalization before staging another rotation');
    }
    return { serialized: '', retiredKeys: null, resumed: false };
  }
  if (rotationPhase !== 'finalize') throw new Error('Rotation phase must be stage or finalize');
  if (saved) {
    return {
      serialized: saved,
      retiredKeys: decryptRetirementLedger(saved, operatorMaster, gatewayId),
      resumed: true
    };
  }
  const serialized = encryptRetirementLedger(retiredKeys, operatorMaster, gatewayId, { randomBytes, now });
  await saveApplicationEnvironment(
    gatewayId,
    { [ROTATION_RETIREMENT_LEDGER_KEY]: serialized },
    [],
    gatewayApplication,
    { requestImpl }
  );
  return { serialized, retiredKeys: normalizeRetiredKeys(retiredKeys), resumed: false };
}

async function clearRetirementLedger(gatewayId, gatewayApplication, { requestImpl = request } = {}) {
  return saveApplicationEnvironment(
    gatewayId,
    {},
    [ROTATION_RETIREMENT_LEDGER_KEY],
    gatewayApplication,
    { requestImpl }
  );
}

async function configureApplication(
  applicationId,
  required,
  removed = [],
  currentApplication = null,
  {
    requestImpl = request,
    waitForDeploymentImpl = waitForDeploymentCompletion,
    title = `Seemplify secret rotation ${new Date().toISOString()} ${crypto.randomBytes(6).toString('hex')}`,
    readinessProbe = null,
    acceptRunningDeploymentWhenReady = false,
    skipDeploymentWhenEnvironmentExact = false
  } = {}
) {
  const { application: app, changed } = await saveApplicationEnvironment(
    applicationId,
    required,
    removed,
    currentApplication,
    { requestImpl }
  );
  if (!changed.length && skipDeploymentWhenEnvironmentExact) {
    console.log(`Application ${applicationId} already has the exact release environment; deferring live proof to the deployment boundary.`);
    return { status: 'environment-exact' };
  }
  if (!changed.length && readinessProbe) {
    try {
      await readinessProbe();
      console.log(`Application ${applicationId} already has the exact environment and is ready; skipping redeploy.`);
      return { status: 'already-ready' };
    } catch {
      // Exact saved configuration is not sufficient: deploy when the live
      // revision cannot prove the required behavior.
    }
  }
  await requestImpl('/application.deploy', {
    method: 'POST',
    body: JSON.stringify({ applicationId, title, description: 'Staged Seemplify service credential rotation' })
  });
  console.log(`Deployment triggered for application ${applicationId}.`);
  let deployment;
  try {
    deployment = await waitForDeploymentImpl(applicationId, title, { requestImpl });
  } catch (error) {
    const staleRunningStatus = new RegExp(
      `^Dokploy deployment ${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} did not complete \\(last status: (?:running|queued)\\)$`
    ).test(String(error?.message || ''));
    if (!acceptRunningDeploymentWhenReady || !readinessProbe || !staleRunningStatus) throw error;
    await readinessProbe();
    console.log(`Dokploy still reports ${applicationId} in progress, but exact application readiness passed.`);
    return { status: 'ready-after-running-timeout' };
  }
  console.log(`Deployment completed for application ${applicationId}.`);
  return deployment;
}

function requiredConsumerIds(source = process.env) {
  const required = [
    ['identity-provider', 'IDENTITY_PROVIDER_APP_ID'],
    ['leave-management', 'LEAVE_BACKEND_APP_ID'],
    ['payroll', 'PAYROLL_BACKEND_APP_ID'],
    ['performance-management', 'PERFORMANCE_BACKEND_APP_ID'],
    ['recruiter', 'RECRUITER_BACKEND_APP_ID']
  ];
  const missing = required.filter(([, environmentName]) => !String(source[environmentName] || '').trim());
  if (missing.length) {
    throw new Error(`Required consumer application IDs are missing: ${missing.map(([, name]) => name).join(', ')}`);
  }
  return required.map(([id, environmentName]) => ({
    id,
    applicationId: String(source[environmentName]).trim()
  }));
}

function collectApplications(payload, applications = new Map()) {
  if (!payload || typeof payload !== 'object') return [...applications.values()];
  if (Array.isArray(payload)) {
    for (const item of payload) collectApplications(item, applications);
    return [...applications.values()];
  }
  const applicationId = String(payload.applicationId || '').trim();
  if (applicationId) applications.set(applicationId, payload);
  for (const value of Object.values(payload)) collectApplications(value, applications);
  return [...applications.values()];
}

function normalizedApplicationHost(value) {
  const candidate = String(value || '').trim().toLowerCase();
  if (!candidate) return '';
  try {
    return new URL(candidate.includes('://') ? candidate : `https://${candidate}`).hostname;
  } catch {
    return candidate.split('/')[0].split(':')[0];
  }
}

function applicationHosts(application) {
  const values = [application?.domain, application?.domainName, application?.url];
  for (const domain of Array.isArray(application?.domains) ? application.domains : []) {
    if (typeof domain === 'string') values.push(domain);
    else values.push(domain?.host, domain?.domain, domain?.domainName, domain?.url);
  }
  return new Set(values.map(normalizedApplicationHost).filter(Boolean));
}

async function resolveMessagingConsumer(source = process.env, { requestImpl = request } = {}) {
  const explicit = String(source.MESSAGING_BACKEND_APP_ID || '').trim();
  if (explicit) return { id: 'messaging', applicationId: explicit };

  const applications = collectApplications(await requestImpl('/project.all'));
  const domainMatches = applications.filter((application) => (
    applicationHosts(application).has('api-messaging.seemplifyai.com')
  ));
  const nameMatches = applications.filter((application) => (
    ['name', 'appName'].some((key) => (
      String(application?.[key] || '').trim().toLowerCase() === 'messaging-backend'
    ))
  ));
  const matches = domainMatches.length ? domainMatches : nameMatches;
  if (matches.length !== 1) {
    const reason = matches.length ? 'matched more than one application' : 'was not found';
    throw new Error(`Messaging backend ${reason}; set MESSAGING_BACKEND_APP_ID explicitly`);
  }
  return { id: 'messaging', applicationId: String(matches[0].applicationId).trim() };
}

function responseItems(payload, keys) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) if (Array.isArray(payload?.[key])) return payload[key];
  if (Array.isArray(payload?.data)) return payload.data;
  if (payload?.data && typeof payload.data === 'object') return responseItems(payload.data, keys);
  return [];
}

function assertPersistentGatewayStorage(mountPayload, backupPayload, source = process.env) {
  const mounts = responseItems(mountPayload, ['mounts', 'items']);
  // `mounts.allNamedByApplicationId` returns Docker's live MountPoint shape
  // (`Type`, `Name`, `Destination`). Tests and older Dokploy releases may
  // expose the persisted mount-record shape (`type`, `volumeName`,
  // `mountPath`), so normalize both before applying the same fail-closed
  // persistence check.
  const dataMount = mounts.map((mount) => ({
    ...mount,
    type: String(mount?.type ?? mount?.Type ?? '').trim().toLowerCase(),
    volumeName: String(mount?.volumeName ?? mount?.Name ?? '').trim(),
    mountPath: String(mount?.mountPath ?? mount?.Destination ?? '').trim()
  })).find((mount) => (
    mount.mountPath.replace(/\/+$/, '') === '/data'
    && mount.type === 'volume'
    && mount.volumeName
  ));
  if (!dataMount) {
    throw new Error('ChatGPT gateway /data must be a Docker named-volume mount before deployment');
  }
  const backups = responseItems(backupPayload, ['volumeBackups', 'backups', 'items']);
  const backup = backups.find((item) => (
    String(item?.volumeName || '').trim() === String(dataMount.volumeName).trim()
    && item?.enabled === true
  ));
  const hostSnapshotVolume = String(source.CHATGPT_GATEWAY_HOST_SNAPSHOT_VOLUME || '').trim();
  const hostSnapshotArchive = String(source.CHATGPT_GATEWAY_HOST_SNAPSHOT_ARCHIVE || '').trim();
  const hostSnapshotSha256 = String(source.CHATGPT_GATEWAY_HOST_SNAPSHOT_SHA256 || '').trim().toLowerCase();
  const hostSnapshot = !backup
    && hostSnapshotVolume === dataMount.volumeName
    && /^chatgpt-gateway-\d{8}T\d{6}Z\.tar\.gz$/.test(hostSnapshotArchive)
    && /^[a-f0-9]{64}$/.test(hostSnapshotSha256)
    ? {
        type: 'verified-host-snapshot',
        volumeName: hostSnapshotVolume,
        archiveName: hostSnapshotArchive,
        sha256: hostSnapshotSha256
      }
    : null;
  if (!backup && !hostSnapshot) {
    throw new Error(`ChatGPT gateway volume ${dataMount.volumeName} requires an enabled Dokploy volume backup before deployment`);
  }
  return { dataMount, backup: backup || hostSnapshot };
}

async function deploymentPreflight(gatewayId, consumers) {
  const targets = [{ id: 'chatgpt-gateway', applicationId: gatewayId }, ...consumers];
  const duplicateApplicationIds = targets
    .filter((target, index) => targets.findIndex((candidate) => candidate.applicationId === target.applicationId) !== index)
    .map((target) => target.applicationId);
  if (duplicateApplicationIds.length) {
    throw new Error(`Dokploy application IDs must be unique across the gateway and consumers: ${[...new Set(duplicateApplicationIds)].join(', ')}`);
  }
  const uniqueTargets = targets;
  const applications = new Map(await Promise.all(uniqueTargets.map(async (target) => {
    const application = await request(`/application.one?applicationId=${encodeURIComponent(target.applicationId)}`);
    if (!application || typeof application !== 'object') {
      throw new Error(`Dokploy application ${target.id} could not be verified`);
    }
    return [target.applicationId, application];
  })));
  const [mounts, backups] = await Promise.all([
    request(`/mounts.allNamedByApplicationId?applicationId=${encodeURIComponent(gatewayId)}`),
    request(`/volumeBackups.list?id=${encodeURIComponent(gatewayId)}&volumeBackupType=application`)
  ]);
  const persistence = assertPersistentGatewayStorage(mounts, backups);
  return { applications, persistence };
}

function consumerEnvironment(id, source = process.env, { previousWebhookSecret = '' } = {}) {
  if (id === 'messaging') {
    return {
      SEEMPLIFY_AI_SOURCE_APP: id,
      SEEMPLIFY_SHARED_AI_URL: source.SEEMPLIFY_SHARED_AI_URL || 'https://api.seemplifyai.com',
      MESSAGING_AI_SHARED_SECRET: deriveMessagingProxySecret(source.CHATGPT_GATEWAY_SHARED_SECRET)
    };
  }
  const webhookRootSecret = deriveIdpWebhookSecret(source.IDP_WEBHOOK_MASTER_SECRET);
  const targetWebhookSecret = deriveIdpWebhookTargetSecret(webhookRootSecret, id);
  const localRuntime = {
    SEEMPLIFY_AI_SOURCE_APP: id,
    LOCAL_LLM_BASE_URL: source.LOCAL_LLM_BASE_URL,
    LOCAL_LLM_SERVICE_SECRET: deriveLocalLlmServiceSecret(source.LOCAL_LLM_SHARED_SECRET, id),
    // Each receiver gets a distinct target-bound key. A compromised product
    // therefore cannot forge IdP authorization events for another product.
    IDP_WEBHOOK_SECRET: targetWebhookSecret,
    ...(previousWebhookSecret && previousWebhookSecret !== targetWebhookSecret
      ? {
        IDP_WEBHOOK_SECRET_PREVIOUS: previousWebhookSecret,
        [IDP_WEBHOOK_PREVIOUS_PROOF_KEY]: previousWebhookSecretProof(
          source.IDP_WEBHOOK_MASTER_SECRET,
          id,
          previousWebhookSecret
        )
      }
      : {})
  };
  if (id === 'identity-provider') {
    return {
      ...localRuntime,
      IDP_WEBHOOK_SECRET: webhookRootSecret,
      ...Object.fromEntries(Object.entries(IDP_WEBHOOK_TARGETS).map(([target, suffix]) => [
        `IDP_WEBHOOK_SECRET_${suffix}`,
        deriveIdpWebhookTargetSecret(webhookRootSecret, target)
      ]))
    };
  }
  if (id === 'recruiter') return {
    ...localRuntime,
    // Recruiter is the signed usage sink for the Local gateway. It alone keeps
    // the master; request traffic still prefers its derived service key above.
    LOCAL_LLM_SHARED_SECRET: source.LOCAL_LLM_SHARED_SECRET,
    CHATGPT_GATEWAY_BASE_URL: source.CHATGPT_GATEWAY_BASE_URL,
    CHATGPT_GATEWAY_SHARED_SECRET: source.CHATGPT_GATEWAY_SHARED_SECRET,
    PERFORMANCE_AI_SHARED_SECRET: derivePerformanceProxySecret(source.CHATGPT_GATEWAY_SHARED_SECRET),
    MESSAGING_AI_SHARED_SECRET: deriveMessagingProxySecret(source.CHATGPT_GATEWAY_SHARED_SECRET),
    CV_STATUS_TOKEN_SECRET: source.CV_STATUS_TOKEN_SECRET,
    CV_ANALYSIS_QUEUE_CONCURRENCY: source.CV_ANALYSIS_QUEUE_CONCURRENCY || '4',
    // AI matching is a shipped Recruiter capability. Keep the legacy alias
    // readable in the service, but make the provider-neutral flag explicit in
    // Dokploy so a connected ChatGPT or Local runtime can actually be used.
    ENABLE_LLM_MATCHING: source.ENABLE_LLM_MATCHING || 'true',
    AI_USAGE_OUTBOX_ENABLED: 'true', AI_USAGE_REDIS_HOST: source.AI_USAGE_REDIS_HOST || 'dokploy-redis',
    OIDC_ISSUER: source.OIDC_ISSUER || 'https://auth.seemplifyai.com',
    OIDC_CLIENT_ID: source.OIDC_CLIENT_ID || 'smarthr-backend', OIDC_CLIENT_SECRET: source.OIDC_CLIENT_SECRET
  };
  if (id === 'performance-management') return {
    ...localRuntime,
    SEEMPLIFY_SHARED_AI_URL: source.SEEMPLIFY_SHARED_AI_URL || 'https://api.seemplifyai.com',
    PERFORMANCE_AI_SHARED_SECRET: derivePerformanceProxySecret(source.CHATGPT_GATEWAY_SHARED_SECRET),
    PERFORMANCE_AI_LOCAL_ENABLED: source.PERFORMANCE_AI_LOCAL_ENABLED || 'true',
    PERFORMANCE_AI_CHATGPT_ENABLED: source.PERFORMANCE_AI_CHATGPT_ENABLED || 'true',
    PERFORMANCE_AI_DEFAULT_RUNTIME: source.PERFORMANCE_AI_DEFAULT_RUNTIME || 'local'
  };
  // ChatGPT Connect is account-scoped and now flows through Recruiter's
  // shared account authority. Products that have not yet integrated that
  // proxy retain Local inference only; distributing the hosted gateway master
  // would let any one of them mint another product's credential namespace.
  return localRuntime;
}

function applicationEnvironmentValue(application, key) {
  return String(parseEnv(application?.env || '').values.get(key) || '').trim();
}

function assertRotationFinalizationReady({ gatewayId, consumers, applications, deploymentSource, gatewaySecrets }) {
  if (String(process.env.SEEMPLIFY_SECRET_ROTATION_APPROVED || '').toLowerCase() !== 'true') {
    throw new Error('SEEMPLIFY_SECRET_ROTATION_APPROVED=true is required to remove previous rotation keys');
  }
  const expectedGatewayKey = gatewaySecrets.requestSecret;
  if (applicationEnvironmentValue(applications.get(gatewayId), 'RECRUITER_CHATGPT_GATEWAY_SECRET') !== expectedGatewayKey) {
    throw new Error('Gateway has not completed the staged request-key rollout');
  }
  for (const consumer of consumers) {
    const application = applications.get(consumer.applicationId);
    const expected = consumerEnvironment(consumer.id, deploymentSource);
    for (const [key, value] of Object.entries(expected)) {
      if (applicationEnvironmentValue(application, key) !== String(value)) {
        throw new Error(`${consumer.id} has not completed the staged ${key} rollout`);
      }
    }
  }
}

function orderedConsumersForRotation(consumers) {
  const priority = new Map([
    ['recruiter', 0],
    ['messaging', 1],
    ['performance-management', 2],
    ['leave-management', 3],
    ['payroll', 4],
    ['time-attendance', 5],
    ['identity-provider', 100]
  ]);
  return [...consumers].sort((left, right) => (
    (priority.get(left.id) ?? 50) - (priority.get(right.id) ?? 50)
  ));
}

function consumerHealthUrl(id, source = process.env) {
  const configured = {
    'leave-management': source.LEAVE_MANAGEMENT_API_URL || 'https://api-leave.seemplifyai.com',
    payroll: source.PAYROLL_MANAGEMENT_API_URL || 'https://api-payroll.seemplifyai.com'
  }[id];
  return configured ? `${String(configured).replace(/\/+$/, '')}/health` : '';
}

async function main() {
  const gatewayId = String(process.env.CHATGPT_GATEWAY_APP_ID || '').trim();
  if (!gatewayId) throw new Error('CHATGPT_GATEWAY_APP_ID is required');
  if (!String(process.env.LOCAL_LLM_BASE_URL || '').trim()) {
    throw new Error('LOCAL_LLM_BASE_URL is required; Local inference must remain independent of ChatGPT Connect');
  }
  if (!String(process.env.LOCAL_LLM_SHARED_SECRET || '').trim()) throw new Error('LOCAL_LLM_SHARED_SECRET is required');
  if (!String(process.env.IDP_WEBHOOK_MASTER_SECRET || '').trim()) {
    throw new Error('IDP_WEBHOOK_MASTER_SECRET is required and must remain outside every product consumer');
  }

  // Validate every webhook receiver before making even the first environment
  // mutation. Optional Local-only consumers may still be added, but the IdP
  // and all of its current webhook targets form one rotation set.
  const mandatoryConsumers = requiredConsumerIds(process.env);
  const messagingConsumer = await resolveMessagingConsumer(process.env);
  const configured = configuredConsumers({
    ...process.env,
    MESSAGING_BACKEND_APP_ID: messagingConsumer.applicationId
  });
  const consumers = [...new Map(
    [...mandatoryConsumers, ...configured].map((consumer) => [consumer.id, consumer])
  ).values()];
  const preflight = await deploymentPreflight(gatewayId, consumers);

  const gatewayApplication = preflight.applications.get(gatewayId);
  const gatewaySecrets = resolveGatewaySecrets(
    gatewayApplication.env,
    process.env.CHATGPT_GATEWAY_SHARED_SECRET
  );
  const idpConsumer = consumers.find(consumer => consumer.id === 'identity-provider');
  const deploymentSource = {
    ...deploymentSourceWithIdpWebhookDestinations(
      process.env,
      preflight.applications.get(idpConsumer.applicationId)
    ),
    // Recruiter keeps the established client variable name, but its value is
    // now the newly rotated request-only credential.
    CHATGPT_GATEWAY_SHARED_SECRET: gatewaySecrets.requestSecret
  };

  const rotationPhase = String(process.env.SEEMPLIFY_SECRET_ROTATION_PHASE || 'stage').trim().toLowerCase();
  if (!['stage', 'finalize'].includes(rotationPhase)) {
    throw new Error('SEEMPLIFY_SECRET_ROTATION_PHASE must be stage or finalize');
  }
  const capturedRetiredKeys = rotationPhase === 'finalize'
    ? captureRetiredKeys({ gatewaySecrets, consumers, applications: preflight.applications })
    : null;
  let retirementLedger = null;
  if (rotationPhase === 'stage') {
    // A leftover ledger means a prior finalization has not yet proven that
    // every retired credential is rejected. Never overwrite that evidence by
    // starting a new rotation.
    retirementLedger = await prepareRetirementLedger({
      rotationPhase,
      gatewayId,
      gatewayApplication,
      retiredKeys: null,
      operatorMaster: process.env.IDP_WEBHOOK_MASTER_SECRET
    });
  } else if (applicationEnvironmentValue(gatewayApplication, ROTATION_RETIREMENT_LEDGER_KEY)) {
    // Authenticate and recover the exact evidence before any further network
    // calls or mutations. A changed master or altered ciphertext fails closed.
    retirementLedger = await prepareRetirementLedger({
      rotationPhase,
      gatewayId,
      gatewayApplication,
      retiredKeys: capturedRetiredKeys,
      operatorMaster: process.env.IDP_WEBHOOK_MASTER_SECRET
    });
  }
  // Resolve every compatibility key before the gateway or any consumer is
  // mutated. A weak legacy key would make the newly deployed receiver fail
  // closed, so it must abort the whole staged rotation at preflight time.
  const previousWebhookSecrets = new Map(rotationPhase === 'stage'
    ? consumers
      .filter(consumer => Object.prototype.hasOwnProperty.call(IDP_WEBHOOK_TARGETS, consumer.id))
      .map(consumer => [
        consumer.id,
        safePreviousWebhookSecret(
          preflight.applications.get(consumer.applicationId),
          consumer.id,
          deploymentSource,
          preflight.applications.get(idpConsumer.applicationId)
        )
      ])
    : []);

  if (rotationPhase === 'finalize') {
    assertRotationFinalizationReady({
      gatewayId,
      consumers,
      applications: preflight.applications,
      deploymentSource,
      gatewaySecrets
    });
    await rotationReadinessSmoke(deploymentSource);
    if (!retirementLedger) {
      // Save authenticated ciphertext in Dokploy before removing a single
      // compatibility key. The operator-only master is never saved with it.
      retirementLedger = await prepareRetirementLedger({
        rotationPhase,
        gatewayId,
        gatewayApplication,
        retiredKeys: capturedRetiredKeys,
        operatorMaster: process.env.IDP_WEBHOOK_MASTER_SECRET
      });
    }
  }

  const gatewayRequired = {
    RECRUITER_CHATGPT_GATEWAY_SECRET: gatewaySecrets.requestSecret,
    CHATGPT_GATEWAY_STORAGE_SECRET: gatewaySecrets.storageSecret,
    PLATFORM_AI_USAGE_SINK_URL: platformUsageSinkUrl(process.env),
    CODEX_PER_USER_SESSIONS: 'true',
    CODEX_SUBJECT_SOURCE_APPS: 'recruiter',
    ...(rotationPhase === 'finalize'
      ? { [ROTATION_RETIREMENT_LEDGER_KEY]: retirementLedger.serialized }
      : {}),
    ...(rotationPhase === 'stage' && gatewaySecrets.previousRequestSecret
      && gatewaySecrets.previousRequestSecret !== gatewaySecrets.requestSecret
      ? { RECRUITER_CHATGPT_GATEWAY_PREVIOUS_SECRET: gatewaySecrets.previousRequestSecret }
      : {})
  };
  const gatewayRemoved = [
    'CHATGPT_GATEWAY_SHARED_SECRET',
    'RECRUITER_BACKEND_URL',
    'LOCAL_LLM_BASE_URL',
    'LOCAL_LLM_SHARED_SECRET',
    'LOCAL_CONTROL_CENTER_TELEMETRY_ENABLED',
    'IDP_WEBHOOK_MASTER_SECRET',
    'IDP_WEBHOOK_SECRET',
    'IDP_WEBHOOK_SECRET_PREVIOUS',
    ...IDP_TARGET_SECRET_KEYS,
    ...(rotationPhase === 'finalize' || !gatewayRequired.RECRUITER_CHATGPT_GATEWAY_PREVIOUS_SECRET
      ? ['RECRUITER_CHATGPT_GATEWAY_PREVIOUS_SECRET']
      : [])
  ];

  // Stage the gateway first with both request keys, so the still-running
  // Recruiter remains compatible. Finalization removes the overlap only after
  // an explicit, separately run approval verifies every staged environment.
  if (rotationPhase === 'stage') {
    const gatewayApplicationReadiness = async () => {
      await gatewayReadinessProbe(deploymentSource);
      await gatewayConsumerRegistrationProbe(deploymentSource);
      return true;
    };
    await configureApplication(gatewayId, gatewayRequired, gatewayRemoved, gatewayApplication, {
      readinessProbe: gatewayApplicationReadiness,
      acceptRunningDeploymentWhenReady: true
    });
    // Dokploy deploy is asynchronous. Do not start rotating Recruiter until
    // the live gateway proves it accepts the new current key (while also
    // retaining the previous key for the still-running Recruiter).
    await waitForGatewayReadiness(deploymentSource);
    await gatewayConsumerRegistrationProbe(deploymentSource);
    if (gatewaySecrets.previousRequestSecret
        && gatewaySecrets.previousRequestSecret !== gatewaySecrets.requestSecret) {
      await waitForReadiness('Gateway previous-key compatibility', () => (
        gatewayReadinessProbe({
          ...deploymentSource,
          CHATGPT_GATEWAY_SHARED_SECRET: gatewaySecrets.previousRequestSecret
        })
      ));
    }
  }

  for (const consumer of orderedConsumersForRotation(consumers)) {
    const currentApplication = preflight.applications.get(consumer.applicationId);
    const priorWebhookSecret = previousWebhookSecrets.get(consumer.id) || '';
    const required = consumerEnvironment(consumer.id, deploymentSource, {
      previousWebhookSecret: priorWebhookSecret
    });
    let priorProxySecret = '';
    if (consumer.id === 'recruiter' && rotationPhase === 'stage') {
      priorProxySecret = applicationEnvironmentValue(currentApplication, 'PERFORMANCE_AI_SHARED_SECRET_PREVIOUS')
        || applicationEnvironmentValue(currentApplication, 'PERFORMANCE_AI_SHARED_SECRET');
      if (priorProxySecret && priorProxySecret !== required.PERFORMANCE_AI_SHARED_SECRET) {
        required.PERFORMANCE_AI_SHARED_SECRET_PREVIOUS = priorProxySecret;
      }
    }
    const removed = consumer.id === 'recruiter'
      ? [
        'LOCAL_CONTROL_CENTER_TELEMETRY_ENABLED', 'RECRUITER_DISABLE_LOCAL_RUNTIME',
        'AI_PROVIDER_ENCRYPTION_KEY', 'AI_PROVIDER_ENCRYPTION_KEY_VERSION',
        ...forbiddenWebhookKeysForTarget(consumer.id),
        ...(rotationPhase === 'finalize' || !required.PERFORMANCE_AI_SHARED_SECRET_PREVIOUS
          ? ['PERFORMANCE_AI_SHARED_SECRET_PREVIOUS'] : []),
        ...(rotationPhase === 'finalize' || !required.IDP_WEBHOOK_SECRET_PREVIOUS
          ? ['IDP_WEBHOOK_SECRET_PREVIOUS', IDP_WEBHOOK_PREVIOUS_PROOF_KEY] : [])
      ]
      : [
        'AZURE_OPENAI_API_KEY', 'OPENAI_API_KEY', 'CHATGPT_GATEWAY_BASE_URL',
        'CHATGPT_GATEWAY_SHARED_SECRET', 'LOCAL_LLM_SHARED_SECRET',
        ...(consumer.id === 'messaging' ? ['IDP_WEBHOOK_SECRET'] : []),
        ...forbiddenWebhookKeysForTarget(consumer.id),
        ...(rotationPhase === 'finalize' || !required.IDP_WEBHOOK_SECRET_PREVIOUS
          ? ['IDP_WEBHOOK_SECRET_PREVIOUS', IDP_WEBHOOK_PREVIOUS_PROOF_KEY] : [])
      ];
    await configureApplication(
      consumer.applicationId,
      required,
      removed,
      currentApplication
    );

    // A completed Dokploy record proves the new revision finished deploying;
    // these probes additionally prove that the running process loaded the
    // staged key before its dependent caller/sender is rotated.
    if (consumer.id === 'recruiter') {
      await waitForReadiness('Recruiter Performance-proxy receiver', () => (
        recruiterProxyReadinessProbe(deploymentSource)
      ));
      if (rotationPhase === 'stage' && priorProxySecret
          && priorProxySecret !== required.PERFORMANCE_AI_SHARED_SECRET) {
        await waitForReadiness('Recruiter previous Performance-proxy compatibility', () => (
          recruiterProxyReadinessProbe(deploymentSource, { secretOverride: priorProxySecret })
        ));
      }
    } else if (consumer.id === 'performance-management') {
      await waitForReadiness('Performance-to-Recruiter shared AI path', () => (
        performanceDeploymentReadinessProbe(deploymentSource)
      ));
    } else if (consumer.id === 'identity-provider') {
      await waitForReadiness('IdP-to-product webhook fanout', () => (
        idpWebhookReadinessProbe(deploymentSource)
      ));
    } else {
      const healthUrl = consumerHealthUrl(consumer.id, deploymentSource);
      if (healthUrl) {
        await waitForReadiness(`${consumer.id} health`, () => publicHealthProbe(healthUrl));
      }
    }
    if (Object.prototype.hasOwnProperty.call(IDP_WEBHOOK_TARGETS, consumer.id)) {
      await waitForReadiness(`${consumer.id} staged webhook receiver`, () => (
        webhookReceiverReadinessProbe(consumer.id, deploymentSource)
      ));
      if (rotationPhase === 'stage' && priorWebhookSecret) {
        await waitForReadiness(`${consumer.id} previous webhook compatibility`, () => (
          webhookReceiverReadinessProbe(consumer.id, deploymentSource, {
            secretOverride: priorWebhookSecret
          })
        ));
      }
    }
  }

  if (rotationPhase === 'finalize') {
    await configureApplication(gatewayId, gatewayRequired, gatewayRemoved, gatewayApplication);
    // Prove the fully finalized revisions still communicate after every
    // previous-key compatibility window has been removed.
    await rotationReadinessSmoke(deploymentSource);
    await assertRetiredKeysRejected(retirementLedger.retiredKeys, deploymentSource);
    // This save intentionally does not deploy. Running code never consumes
    // the ciphertext, and saved evidence is removed only after every old key
    // has been rejected repeatedly through the public load balancers.
    await clearRetirementLedger(gatewayId, gatewayApplication);
  } else if (gatewaySecrets.previousRequestSecret) {
    console.log('Rotation staged. Verify signed gateway/proxy/webhook health, then rerun with SEEMPLIFY_SECRET_ROTATION_PHASE=finalize and SEEMPLIFY_SECRET_ROTATION_APPROVED=true.');
  }
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = {
  apiBase,
  assertPersistentGatewayStorage,
  assertRetiredKeysRejected,
  clearRetirementLedger,
  configureApplication,
  configureEnvironment,
  consumerEnvironment,
  decryptRetirementLedger,
  deploymentSourceWithIdpWebhookDestinations,
  captureRetiredKeys,
  derivePerformanceProxySecret,
  deriveMessagingProxySecret,
  deriveIdpWebhookSecret,
  deriveIdpWebhookTargetSecret,
  deriveLocalLlmServiceSecret,
  deploymentPreflight,
  encryptRetirementLedger,
  forbiddenWebhookKeysForTarget,
  safePreviousWebhookSecret,
  assertRotationFinalizationReady,
  main,
  parseEnv,
  platformUsageSinkUrl,
  previousWebhookSecretProof,
  prepareRetirementLedger,
  resolveGatewaySecrets,
  ROTATION_RETIREMENT_LEDGER_KEY,
  rotationReadinessSmoke,
  gatewayReadinessProbe,
  gatewayConsumerRegistrationProbe,
  idpWebhookReadinessProbe,
  performanceDeploymentReadinessProbe,
  publicHealthProbe,
  recruiterProxyReadinessProbe,
  waitForDeploymentCompletion,
  waitForReadiness,
  webhookReceiverReadinessProbe,
  webhookReceiverUrl,
  waitForGatewayReadiness,
  requiredConsumerIds,
  resolveMessagingConsumer,
  saveApplicationEnvironment,
  serializeEnv
};
