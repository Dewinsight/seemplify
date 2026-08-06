const crypto = require('crypto');
const AIUserRuntimeAccount = require('../../models/AIUserRuntimeAccount');
const { AIRuntimeError, signLocalRequest } = require('./aiRuntimeService');

/**
 * The Recruiter side of a user's own ChatGPT connection.
 *
 * Device login, account status, the model catalogue, and sign-out all live on
 * the gateway host, because that is where the Codex CLI and the per-subject
 * credential store are. This service is the authenticated proxy plus the
 * durable connection state.
 */

const SOURCE_APP = 'recruiter';

function gatewayBaseUrl() {
  return String(process.env.LOCAL_LLM_BASE_URL || 'http://127.0.0.1:11435').replace(/\/+$/, '');
}

function gatewaySecret() {
  const secret = String(process.env.LOCAL_LLM_SHARED_SECRET || '').trim();
  if (!secret) {
    throw new AIRuntimeError('The local AI gateway is not configured', {
      code: 'AI_LOCAL_NOT_CONFIGURED', statusCode: 503, retryable: true
    });
  }
  return secret;
}

/** Mirrors the gateway's own derivation so the stored key and the key the
 * gateway computes can be compared rather than assumed equal. */
function subjectKeyForUser(userId) {
  const subjectId = String(userId || '').trim();
  if (!subjectId) {
    throw new AIRuntimeError('A ChatGPT connection requires an authenticated user', {
      code: 'CHATGPT_SUBJECT_UNRESOLVED', statusCode: 401, retryable: false
    });
  }
  return crypto.createHash('sha256').update(`${SOURCE_APP}${subjectId}`).digest('hex');
}

async function callGateway(operation, userId, { timeoutMs = 30_000, fetchImpl = fetch } = {}) {
  const secret = gatewaySecret();
  const requestPath = `/v1/codex/${operation}`;
  const body = JSON.stringify({ sourceApp: SOURCE_APP, subjectId: String(userId) });
  const signed = signLocalRequest(secret, body, { method: 'POST', path: requestPath });
  let response;
  try {
    response = await fetchImpl(`${gatewayBaseUrl()}${requestPath}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-seemplify-timestamp': signed.timestamp,
        'x-seemplify-nonce': signed.nonce,
        'x-seemplify-signature': signed.signature
      },
      body,
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    throw new AIRuntimeError(`The local AI gateway is unreachable: ${error.message}`, {
      code: 'CHATGPT_GATEWAY_UNAVAILABLE', statusCode: 503, retryable: true
    });
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new AIRuntimeError(payload.message || `ChatGPT ${operation} failed`, {
      code: String(payload.code || 'CHATGPT_CONTROL_FAILED'),
      statusCode: response.status,
      retryable: payload.retryable === true
    });
  }
  return payload;
}

/** The auth token only carries a user id, so the organization is resolved
 * from the user document — and healed onto older account rows that were
 * created before it was known, because background work (public CV analysis)
 * finds the workspace's runtime account by organization. */
async function organizationForUser(user, userId) {
  if (user?.currentOrganization) return user.currentOrganization;
  const User = require('../../models/User');
  const document = await User.findById(userId).select('currentOrganization').lean();
  return document?.currentOrganization || undefined;
}

async function accountForUser(user) {
  const userId = String(user?.id || user?._id || '');
  const existing = await AIUserRuntimeAccount.findOne({ user: userId });
  if (existing) {
    if (!existing.organization) {
      const organization = await organizationForUser(user, userId);
      if (organization) {
        existing.organization = organization;
        await existing.save();
      }
    }
    return existing;
  }
  return AIUserRuntimeAccount.create({
    user: userId,
    organization: await organizationForUser(user, userId),
    subjectKey: subjectKeyForUser(userId),
    status: 'disconnected'
  });
}

function applyStatus(account, status) {
  const connected = status?.connected === true;
  account.status = connected ? 'connected' : status?.pendingLogin ? 'pending' : 'disconnected';
  account.connectedEmail = connected ? String(status.email || '') : '';
  account.planType = connected ? String(status.planType || '') : '';
  account.lastVerifiedAt = new Date();
  if (connected && !account.connectedAt) account.connectedAt = new Date();
  if (!connected) account.connectedAt = null;
  account.lastError = String(status?.loginError || '').slice(0, 500);
  return account;
}

/** Reads live gateway state rather than trusting the stored row: a session can
 * be signed out on the host, and a stale "connected" would route work that then
 * fails at inference time. */
async function readAccount(user, options = {}) {
  const account = await accountForUser(user);
  try {
    applyStatus(account, await callGateway('account', account.user, options));
  } catch (error) {
    account.status = account.status === 'connected' ? 'error' : account.status;
    account.lastError = String(error.message || '').slice(0, 500);
  }
  await account.save();
  return account;
}

async function startLogin(user, options = {}) {
  const account = await accountForUser(user);
  const login = await callGateway('login/start', account.user, options);
  if (login.connected) {
    applyStatus(account, { connected: true });
  } else {
    account.status = 'pending';
    account.lastError = '';
  }
  await account.save();
  return { login, account };
}

async function cancelLogin(user, options = {}) {
  const account = await accountForUser(user);
  const result = await callGateway('login/cancel', account.user, options);
  account.status = account.status === 'pending' ? 'disconnected' : account.status;
  await account.save();
  return { result, account };
}

/**
 * Consent is revocable at any time and the revocation path never depends on the
 * gateway: an unreachable host must not be able to keep a user's content
 * flowing to OpenAI.
 */
async function setConsent(user, acknowledged) {
  const account = await accountForUser(user);
  account.dataSharingAcknowledgedAt = acknowledged ? new Date() : null;
  await account.save();
  return account;
}

async function disconnect(user, options = {}) {
  const account = await accountForUser(user);
  // Consent and local state are cleared first so a gateway failure cannot leave
  // the account routable.
  account.dataSharingAcknowledgedAt = null;
  account.status = 'disconnected';
  account.connectedEmail = '';
  account.planType = '';
  account.connectedAt = null;
  account.disconnectedAt = new Date();
  await account.save();
  await callGateway('logout', account.user, options);
  return account;
}

async function listModels(user, options = {}) {
  const account = await accountForUser(user);
  if (account.status !== 'connected') {
    throw new AIRuntimeError('Connect a ChatGPT account before listing its models', {
      code: 'CHATGPT_NOT_CONNECTED', statusCode: 409, retryable: false
    });
  }
  const payload = await callGateway('models', account.user, options);
  return Array.isArray(payload.models) ? payload.models : [];
}

/**
 * Resolves the subject an inference should run as, or null when it must fall
 * back to the managed runtime. Returning null rather than throwing keeps the
 * decision in the caller, which owns the failover policy.
 */
async function resolveRoutableSubject(userId) {
  const subjectId = String(userId || '').trim();
  if (!subjectId) return null;
  const account = await AIUserRuntimeAccount.findOne({ user: subjectId });
  if (!account || !account.isRoutable()) return null;
  return { subjectId, subjectKey: account.subjectKey, sourceApp: SOURCE_APP };
}

module.exports = {
  SOURCE_APP,
  accountForUser,
  callGateway,
  cancelLogin,
  disconnect,
  listModels,
  readAccount,
  resolveRoutableSubject,
  setConsent,
  startLogin,
  subjectKeyForUser
};
