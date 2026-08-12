const crypto = require('crypto');
const AIUserRuntimeAccount = require('../../models/AIUserRuntimeAccount');
const User = require('../../models/User');
const { recruiterOrganizationAuthorized } = require('../sharedAIUserSecurity');
const { AIRuntimeError, signGatewayRequest } = require('./aiRuntimeService');

/**
 * The Recruiter side of a user's own ChatGPT connection.
 *
 * Device login, account status, the model catalogue, and sign-out all live on
 * the hosted gateway, because that is where the Codex CLI and the per-subject
 * credential store are. This service is the authenticated proxy plus the
 * durable connection state.
 */

const SOURCE_APP = 'recruiter';
const CREDENTIAL_NAMESPACE_VERSION = 2;

function gatewayBaseUrl() {
  const baseUrl = String(process.env.CHATGPT_GATEWAY_BASE_URL || '').replace(/\/+$/, '');
  if (!baseUrl) {
    throw new AIRuntimeError('The hosted ChatGPT gateway URL is not configured', {
      code: 'CHATGPT_GATEWAY_NOT_CONFIGURED', statusCode: 503, retryable: true
    });
  }
  return baseUrl;
}

function gatewaySecret() {
  const secret = String(process.env.CHATGPT_GATEWAY_SHARED_SECRET || '').trim();
  if (!secret) {
    throw new AIRuntimeError('The ChatGPT gateway is not configured', {
      code: 'CHATGPT_GATEWAY_NOT_CONFIGURED', statusCode: 503, retryable: true
    });
  }
  return secret;
}

/** Mirrors the gateway's own derivation so the stored key and the key the
 * gateway computes can be compared rather than assumed equal. */
function subjectKeyForUser(idpSubject) {
  const subjectId = String(idpSubject || '').trim();
  if (!subjectId) {
    throw new AIRuntimeError('A ChatGPT connection requires an authenticated user', {
      code: 'CHATGPT_SUBJECT_UNRESOLVED', statusCode: 401, retryable: false
    });
  }
  // The separator is part of the hosted gateway's canonical subject key. The
  // key is metadata only; inference continues to send sourceApp + subjectId,
  // so healing an older row cannot orphan its existing credential directory.
  return crypto.createHash('sha256').update(`${SOURCE_APP}\x1f${subjectId}`).digest('hex');
}

function credentialNamespaceVersion(account) {
  return Number(account?.credentialNamespaceVersion || 1);
}

function credentialSubjectForAccount(account) {
  return credentialNamespaceVersion(account) >= CREDENTIAL_NAMESPACE_VERSION
    ? String(account.idpSubject || '').trim()
    : String(account.user || '').trim();
}

function gatewayDoesNotSupportAdoption(error) {
  // `account/adopt` was added after the original per-user account endpoints.
  // During a rolling upgrade an older gateway returns its normal 404 for the
  // unknown operation. Keep using the existing Recruiter-owned credential
  // until that gateway is upgraded; every first-party app still reaches it
  // through this central service rather than owning a second OpenAI login.
  return Number(error?.statusCode) === 404;
}

async function callGateway(operation, idpSubject, {
  timeoutMs = 30_000, fetchImpl = fetch, payload = {}, signal
} = {}) {
  const secret = gatewaySecret();
  const requestPath = `/v1/codex/${operation}`;
  const body = JSON.stringify({ sourceApp: SOURCE_APP, subjectId: String(idpSubject), ...payload });
  const signed = signGatewayRequest(secret, body, { method: 'POST', path: requestPath });
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
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    throw new AIRuntimeError(`The ChatGPT gateway is unreachable: ${error.message}`, {
      code: 'CHATGPT_GATEWAY_UNAVAILABLE', statusCode: 503, retryable: true
    });
  }
  const responsePayload = await response.json().catch(() => ({}));
  if (!response.ok) {
    // A rate-limited sign-in is only actionable if the wait travels with it,
    // so it is carried as data rather than buried in the message text.
    const retryAfterSeconds = Number(responsePayload.retryAfterSeconds)
      || Number(response.headers?.get?.('retry-after')) || 0;
    const error = new AIRuntimeError(responsePayload.message || `ChatGPT ${operation} failed`, {
      code: String(responsePayload.code || 'CHATGPT_CONTROL_FAILED'),
      statusCode: response.status,
      retryable: responsePayload.retryable === true
    });
    if (retryAfterSeconds > 0) error.retryAfterSeconds = retryAfterSeconds;
    throw error;
  }
  return responsePayload;
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
  const hydrated = user?.idpSubject
    ? user
    : await User.findById(userId).select('idpSubject currentOrganization').lean();
  const idpSubject = String(hydrated?.idpSubject || '').trim();
  if (!idpSubject) {
    throw new AIRuntimeError('A connected Seemplify identity is required for ChatGPT.', {
      code: 'CHATGPT_IDP_IDENTITY_REQUIRED', statusCode: 409, retryable: false
    });
  }
  const existing = await AIUserRuntimeAccount.findOne({ user: userId });
  if (existing) {
    let changed = false;
    const expectedSubjectKey = subjectKeyForUser(
      credentialNamespaceVersion(existing) >= CREDENTIAL_NAMESPACE_VERSION
        ? idpSubject
        : userId
    );
    if (existing.subjectKey !== expectedSubjectKey) {
      existing.subjectKey = expectedSubjectKey;
      changed = true;
    }
    if (existing.idpSubject !== idpSubject) {
      existing.idpSubject = idpSubject;
      changed = true;
    }
    if (!existing.organization) {
      const organization = await organizationForUser(user, userId);
      if (organization) {
        existing.organization = organization;
        changed = true;
      }
    }
    if (changed) await existing.save();
    return existing;
  }
  return AIUserRuntimeAccount.create({
    user: userId,
    organization: await organizationForUser(user, userId),
    idpSubject,
    subjectKey: subjectKeyForUser(userId),
    status: 'disconnected',
    credentialNamespaceVersion: 1
  });
}

async function ensureCanonicalCredential(account, options = {}) {
  if (credentialNamespaceVersion(account) >= CREDENTIAL_NAMESPACE_VERSION) return true;
  try {
    await callGateway('account/adopt', account.idpSubject, {
      ...options,
      payload: {
        legacySubjects: [
          { sourceApp: 'recruiter', subjectId: String(account.user) },
          { sourceApp: 'performance-management', subjectId: account.idpSubject }
        ]
      }
    });
  } catch (error) {
    if (!gatewayDoesNotSupportAdoption(error)) throw error;
    const legacySubjectKey = subjectKeyForUser(String(account.user));
    if (account.subjectKey !== legacySubjectKey) {
      account.subjectKey = legacySubjectKey;
      await account.save();
    }
    return false;
  }
  account.credentialNamespaceVersion = CREDENTIAL_NAMESPACE_VERSION;
  account.subjectKey = subjectKeyForUser(account.idpSubject);
  await account.save();
  return true;
}

function applyStatus(account, status) {
  const connected = status?.connected === true;
  account.status = connected ? 'connected' : status?.pendingLogin ? 'pending' : 'disconnected';
  account.connectedEmail = connected
    ? (status?.email === undefined ? account.connectedEmail : String(status.email || ''))
    : '';
  account.planType = connected
    ? (status?.planType === undefined ? account.planType : String(status.planType || ''))
    : '';
  account.lastVerifiedAt = new Date();
  if (connected && !account.connectedAt) account.connectedAt = new Date();
  if (!connected) account.connectedAt = null;
  // Limits belong to a connection, so they clear with it. While connected a
  // reading is only ever replaced by a newer one: an unreachable gateway must
  // not erase the last thing we knew about the plan.
  if (!connected) {
    account.rateLimits = null;
    account.usageLimit = null;
  } else {
    if (status?.rateLimits) account.rateLimits = status.rateLimits;
    if (status?.usageLimit !== undefined) account.usageLimit = status.usageLimit;
  }
  account.lastError = String(status?.loginError || '').slice(0, 500);
  return account;
}

/** Reads live gateway state rather than trusting the stored row: a session can
 * be signed out on the host, and a stale "connected" would route work that then
 * fails at inference time. */
async function readAccount(user, options = {}) {
  const account = await accountForUser(user);
  try {
    await ensureCanonicalCredential(account, options);
    applyStatus(account, await callGateway('account', credentialSubjectForAccount(account), options));
  } catch (error) {
    // A rolling deployment or short network interruption does not mean the
    // user's durable credential disappeared. Marking a connected row as
    // `error` made background CV jobs unroutable forever, even after the
    // gateway recovered, until somebody happened to reopen this page.
    // A successful gateway response still changes the state through
    // applyStatus (including a real logout); transport failures preserve the
    // last verified connection and only surface diagnostic text.
    account.lastError = String(error.message || '').slice(0, 500);
  }
  await account.save();
  return account;
}

async function startLogin(user, options = {}) {
  const account = await accountForUser(user);
  await ensureCanonicalCredential(account, options);
  const login = await callGateway('login/start', credentialSubjectForAccount(account), options);
  if (login.connected) {
    applyStatus(account, login);
  } else {
    account.status = 'pending';
    account.lastError = '';
  }
  await account.save();
  return { login, account };
}

async function cancelLogin(user, options = {}) {
  const account = await accountForUser(user);
  await ensureCanonicalCredential(account, options);
  const result = await callGateway('login/cancel', credentialSubjectForAccount(account), options);
  account.status = account.status === 'connected' ? account.status : 'disconnected';
  account.lastError = '';
  await account.save();
  return { result, account };
}

async function resetLogin(user, options = {}) {
  const account = await accountForUser(user);
  await ensureCanonicalCredential(account, options);
  const result = await callGateway('login/reset', credentialSubjectForAccount(account), options);
  account.status = account.status === 'connected' ? account.status : 'disconnected';
  account.lastError = '';
  await account.save();
  return { result, account };
}

/**
 * Consent is revocable at any time and the revocation path never depends on the
 * gateway: an unreachable host must not be able to keep a user's content
 * flowing to OpenAI.
 */
async function setConsent(user, acknowledged, { app = 'recruiter' } = {}) {
  const account = await accountForUser(user);
  if (app === 'performance') {
    account.performanceDataSharingAcknowledgedAt = acknowledged ? new Date() : null;
  } else if (app === 'messaging') {
    account.messagingDataSharingAcknowledgedAt = acknowledged ? new Date() : null;
  } else {
    account.dataSharingAcknowledgedAt = acknowledged ? new Date() : null;
  }
  await account.save();
  return account;
}

async function disconnect(user, options = {}) {
  const account = await accountForUser(user);
  // Consent and application state are cleared first so a gateway failure cannot leave
  // the account routable.
  account.dataSharingAcknowledgedAt = null;
  account.performanceDataSharingAcknowledgedAt = null;
  account.messagingDataSharingAcknowledgedAt = null;
  account.status = 'disconnected';
  account.connectedEmail = '';
  account.planType = '';
  account.connectedAt = null;
  account.disconnectedAt = new Date();
  account.rateLimits = null;
  account.usageLimit = null;
  await account.save();
  await ensureCanonicalCredential(account, options);
  await callGateway('logout', credentialSubjectForAccount(account), options);
  return account;
}

async function listModels(user, options = {}) {
  const account = await accountForUser(user);
  if (account.status !== 'connected') {
    throw new AIRuntimeError('Connect a ChatGPT account before listing its models', {
      code: 'CHATGPT_NOT_CONNECTED', statusCode: 409, retryable: false
    });
  }
  await ensureCanonicalCredential(account, options);
  const payload = await callGateway('models', credentialSubjectForAccount(account), options);
  return Array.isArray(payload.models) ? payload.models : [];
}

/**
 * Resolves the subject an inference should run as, or null when it must fall
 * fail closed. Returning null lets the caller present the connection gate
 * decision in the caller, which owns the failover policy.
 */
async function resolveRoutableSubject(userId, options = {}) {
  const consentApp = ['performance', 'messaging'].includes(options.consentApp)
    ? options.consentApp : 'recruiter';
  const organizationId = String(options.organizationId || '').trim();
  const explainUnavailable = options.explainUnavailable === true;
  const unavailable = (reason, message) => {
    if (!explainUnavailable) return null;
    throw new AIRuntimeError(message, {
      code: 'AI_RUNTIME_ACCOUNT_REQUIRED',
      statusCode: 409,
      retryable: false,
      details: { reason }
    });
  };
  const findUser = options.findUser || ((id) => User.findById(id)
    .select('idpSubject sharedAIOnly organizationMemberships recruiterAuthorizedOrganizations recruiterAppAccessSyncedAt')
    .lean());
  const gatewayOptions = { ...options };
  delete gatewayOptions.consentApp;
  delete gatewayOptions.organizationId;
  delete gatewayOptions.findUser;
  delete gatewayOptions.explainUnavailable;
  const subjectId = String(userId || '').trim();
  if (!subjectId) {
    return unavailable(
      'actor_missing',
      'Your signed-in Recruiter identity was not available to the AI runtime. Sign in again and retry.'
    );
  }
  // Identity-only Performance shadows are never valid Recruiter actors, even
  // if an older record accidentally carries legacy Recruiter consent.
  if (consentApp === 'recruiter') {
    const actor = await Promise.resolve(findUser(subjectId)).catch(() => null);
    if (!actor || actor.sharedAIOnly === true) {
      return unavailable(
        'actor_not_eligible',
        'This identity is not an active Recruiter account. Sign in through Recruiter and retry.'
      );
    }
    // Recruiter consent is organization-scoped. Missing tenant context cannot
    // be interpreted as permission to use whichever sticky organization was
    // last saved on the account.
    if (!organizationId) {
      return unavailable(
        'organization_missing',
        'Select an active Recruiter workspace before using ChatGPT.'
      );
    }
    if (!recruiterOrganizationAuthorized(actor, organizationId)) {
      return unavailable(
        'organization_not_authorized',
        'Your ChatGPT connection is not authorized for the selected Recruiter workspace. Sign in to Recruiter again to refresh workspace access.'
      );
    }
  }
  // An actor id that is not a real user reference is simply "no connected
  // account": it must reach the runtime gate, not surface a database cast
  // error with no machine-readable code for callers to route on.
  let account = null;
  try {
    account = await AIUserRuntimeAccount.findOne({ user: subjectId });
  } catch (error) {
    console.warn('ChatGPT subject lookup failed:', error.message);
    return unavailable(
      'account_lookup_failed',
      'Your ChatGPT connection could not be verified right now. Retry in a moment.'
    );
  }
  if (!account?.isRoutable(consentApp)) {
    // Background jobs may outlive a rolling deployment or a transient gateway
    // outage that left their durable snapshot stale. Verify the hosted account
    // on demand so queues recover by themselves instead of requiring the user
    // to open Settings and press Refresh before every retry.
    try {
      account = await readAccount({ id: subjectId, idpSubject: account?.idpSubject }, gatewayOptions);
    } catch (error) {
      console.warn('ChatGPT subject refresh failed:', error.message);
    }
  }
  if (!account?.isRoutable(consentApp)) {
    return unavailable(
      account ? 'account_not_routable' : 'account_missing',
      'Refresh your ChatGPT connection and confirm data-sharing consent before retrying.'
    );
  }
  return {
    subjectId: credentialSubjectForAccount(account),
    subjectKey: account.subjectKey,
    sourceApp: SOURCE_APP
  };
}

module.exports = {
  SOURCE_APP,
  accountForUser,
  callGateway,
  cancelLogin,
  disconnect,
  listModels,
  readAccount,
  resetLogin,
  resolveRoutableSubject,
  setConsent,
  startLogin,
  subjectKeyForUser
};
