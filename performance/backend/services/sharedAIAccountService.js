'use strict';

const crypto = require('node:crypto');

const SERVICE_ID = 'performance-management';
const INTERNAL_PATH = '/api/internal/ai/v1';

class SharedAIAccountError extends Error {
  constructor(message, { code = 'SHARED_AI_REQUEST_FAILED', statusCode = 503, retryable = false, retryAfterSeconds = 0 } = {}) {
    super(message);
    this.name = 'SharedAIAccountError';
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function serviceBaseUrl() {
  const configured = String(
    process.env.SEEMPLIFY_SHARED_AI_URL
      || process.env.SEEMPLIFY_PLATFORM_API_URL
      || (process.env.NODE_ENV === 'production' ? 'https://api.seemplifyai.com' : 'http://localhost:5001')
  ).replace(/\/+$/, '');
  return configured.endsWith(INTERNAL_PATH) ? configured : `${configured}${INTERNAL_PATH}`;
}

function signingSecret() {
  // Performance receives a service-bound proxy credential, never Recruiter's
  // hosted-gateway master secret. Recruiter verifies this credential before it
  // resolves the user's shared connected account.
  const secret = String(process.env.PERFORMANCE_AI_SHARED_SECRET || '').trim();
  if (!secret) {
    throw new SharedAIAccountError('The shared AI account service is not configured.', {
      code: 'SHARED_AI_NOT_CONFIGURED', statusCode: 503, retryable: true
    });
  }
  return secret;
}

function identityFromUser(user = {}, organization = null) {
  const userinfo = user.userinfo || {};
  const selectedOrganization = organization
    || user.currentOrganization
    || userinfo.currentOrganization
    || userinfo.current_organization
    || (user.organizations || userinfo.organizations || [])[0]
    || null;
  // Keep the cross-app account keyed to the stable OIDC subject. Never fall
  // back to a product-local database identifier.
  const sub = String(user.idpSub || user.sub || userinfo.sub || '').trim();
  const email = String(user.email || userinfo.email || '').trim().toLowerCase();
  if (!sub || !email) {
    throw new SharedAIAccountError('An authenticated Seemplify identity is required for AI account access.', {
      code: 'SHARED_AI_IDENTITY_REQUIRED', statusCode: 401
    });
  }
  const organizationId = String(selectedOrganization?.id || selectedOrganization?._id || selectedOrganization?.organizationId || '').trim();
  const organizationName = String(selectedOrganization?.name || '').trim();
  return {
    sub,
    email,
    ...(organizationId ? { organizationId } : {}),
    ...(organizationName ? { organizationName } : {}),
    ...(user.name || userinfo.name ? { displayName: String(user.name || userinfo.name) } : {})
  };
}

function identityFromRequest(req) {
  const user = req?.session?.user || {};
  const organization = req?.currentOrganization
    || (req?.session?.currentOrganizationId ? { id: req.session.currentOrganizationId } : null);
  return identityFromUser(user, organization);
}

function signedHeaders(secret, pathname, rawBody) {
  const timestamp = String(Date.now());
  const nonce = crypto.randomBytes(24).toString('base64url');
  const canonical = `${timestamp}\n${nonce}\n${SERVICE_ID}\nPOST\n${pathname}\n${rawBody}`;
  return {
    'content-type': 'application/json',
    'x-seemplify-service': SERVICE_ID,
    'x-seemplify-signature-version': '2',
    'x-seemplify-timestamp': timestamp,
    'x-seemplify-nonce': nonce,
    'x-seemplify-signature': crypto.createHmac('sha256', secret).update(canonical).digest('hex')
  };
}

class SharedAIAccountService {
  constructor({ fetchImpl = global.fetch } = {}) {
    this.fetch = fetchImpl;
  }

  async request(operation, identity, payload = {}, { timeoutMs = 30_000 } = {}) {
    const pathname = `${INTERNAL_PATH}/${String(operation || '').replace(/^\/+/, '')}`;
    // The authenticated server-session identity is authoritative even if a
    // caller accidentally includes an `identity` field in the operation data.
    const body = JSON.stringify({ ...payload, identity });
    let response;
    try {
      response = await this.fetch(`${serviceBaseUrl()}/${String(operation || '').replace(/^\/+/, '')}`, {
        method: 'POST',
        headers: signedHeaders(signingSecret(), pathname, body),
        body,
        signal: AbortSignal.timeout(Math.max(1000, Number(timeoutMs) || 30_000))
      });
    } catch (error) {
      throw new SharedAIAccountError(`The shared AI account service could not be reached: ${error.message}`, {
        code: 'SHARED_AI_UNAVAILABLE', statusCode: 503, retryable: true
      });
    }

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const retryAfterSeconds = Number(result.retryAfterSeconds)
        || Number(response.headers?.get?.('retry-after')) || 0;
      throw new SharedAIAccountError(result.error || result.message || result.msg || 'The shared AI request failed.', {
        code: String(result.code || 'SHARED_AI_REQUEST_FAILED'),
        statusCode: response.status,
        retryable: result.retryable === true,
        retryAfterSeconds
      });
    }
    return result;
  }

  async health({ timeoutMs = 10_000 } = {}) {
    const pathname = `${INTERNAL_PATH}/health`;
    const body = '{}';
    let response;
    try {
      response = await this.fetch(`${serviceBaseUrl()}/health`, {
        method: 'POST',
        headers: signedHeaders(signingSecret(), pathname, body),
        body,
        signal: AbortSignal.timeout(Math.max(1000, Number(timeoutMs) || 10_000))
      });
    } catch (error) {
      throw new SharedAIAccountError(`The shared AI account service could not be reached: ${error.message}`, {
        code: 'SHARED_AI_UNAVAILABLE', statusCode: 503, retryable: true
      });
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok !== true) {
      throw new SharedAIAccountError(result.message || 'The shared AI account health check failed.', {
        code: result.code || 'SHARED_AI_UNAVAILABLE', statusCode: response.status || 503, retryable: true
      });
    }
    return result;
  }

  status(identity, options) { return this.request('account/status', identity, {}, options); }
  startLogin(identity, options) { return this.request('account/login/start', identity, {}, options); }
  cancelLogin(identity, options) { return this.request('account/login/cancel', identity, {}, options); }
  resetLogin(identity, options) { return this.request('account/login/reset', identity, {}, options); }
  consent(identity, acknowledged, options) { return this.request('account/consent', identity, { acknowledged: acknowledged === true }, options); }
  disconnect(identity, options) { return this.request('account/disconnect', identity, {}, options); }
  models(identity, options) { return this.request('account/models', identity, {}, options); }
  preferences(identity, options) { return this.request('account/preferences/read', identity, {}, options); }
  writePreference(identity, preference, options) { return this.request('account/preferences/write', identity, preference, options); }
  deletePreference(identity, preference, options) { return this.request('account/preferences/delete', identity, preference, options); }
  complete(identity, input, options) { return this.request('complete', identity, input, { timeoutMs: 240_000, ...options }); }
}

const sharedAIAccountService = new SharedAIAccountService();

module.exports = sharedAIAccountService;
module.exports.SharedAIAccountService = SharedAIAccountService;
module.exports.SharedAIAccountError = SharedAIAccountError;
module.exports.identityFromRequest = identityFromRequest;
module.exports.identityFromUser = identityFromUser;
module.exports.signedHeaders = signedHeaders;
module.exports.INTERNAL_PATH = INTERNAL_PATH;
module.exports.SERVICE_ID = SERVICE_ID;
