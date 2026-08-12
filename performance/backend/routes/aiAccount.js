'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/rbac');
const aiGatewayService = require('../services/aiGatewayService');
const chatGptAccountService = require('../services/chatGptAccountService');
const sharedAIAccountService = require('../services/sharedAIAccountService');
const { identityFromRequest } = sharedAIAccountService;
const {
  DEPLOYMENT_HEALTH_SERVICE,
  SIGNATURE_VERSION,
  createDeploymentHealthVerifier
} = require('../services/deploymentHealthSecurity');

const router = express.Router();

const DEPLOYMENT_HEALTH_RESPONSE_SERVICE = 'seemplify-shared-ai-consumer-deployment';
const SHARED_AUTHORITY_SERVICE = 'seemplify-shared-ai-account';

/**
 * Deployment automation signs this request with the same service-bound secret
 * that Performance must use when it calls Recruiter's shared AI authority.
 * Keeping the probe ahead of every user-authenticated route lets a deployment
 * prove the complete secret path without creating or exposing a user account.
 */
router.post('/deployment-health', createDeploymentHealthVerifier(), async (_req, res) => {
  try {
    const shared = await sharedAIAccountService.health();
    if (shared?.ok !== true
        || shared.service !== SHARED_AUTHORITY_SERVICE
        || shared.consumer !== DEPLOYMENT_HEALTH_SERVICE
        || shared.signatureVersion !== SIGNATURE_VERSION) {
      return res.status(503).json({
        ok: false,
        code: 'DEPLOYMENT_HEALTH_AUTHORITY_IDENTITY_INVALID',
        message: 'The shared AI authority returned an unexpected service identity'
      });
    }
    return res.json({
      ok: true,
      service: DEPLOYMENT_HEALTH_RESPONSE_SERVICE,
      consumer: DEPLOYMENT_HEALTH_SERVICE,
      signatureVersion: SIGNATURE_VERSION,
      shared: {
        ok: true,
        service: shared.service,
        consumer: shared.consumer,
        signatureVersion: shared.signatureVersion
      }
    });
  } catch (_error) {
    return res.status(503).json({
      ok: false,
      code: 'DEPLOYMENT_HEALTH_SHARED_AUTHORITY_UNAVAILABLE',
      message: 'Performance could not verify the shared AI authority'
    });
  }
});

function userFor(req) {
  return req.session?.user || {};
}

function runtimePreferenceFor(req) {
  return ['local', 'chatgpt'].includes(req.cookies?.performance_ai_runtime)
    ? req.cookies.performance_ai_runtime
    : 'default';
}

function sendError(res, error) {
  const status = Number(error?.statusCode) || 500;
  const retryAfterSeconds = Number(error?.retryAfterSeconds) || 0;
  if (retryAfterSeconds > 0) res.set('Retry-After', String(retryAfterSeconds));
  return res.status(status).json({
    success: false,
    error: error?.message || 'The ChatGPT connection request failed.',
    code: error?.code || 'CHATGPT_REQUEST_FAILED',
    retryable: error?.retryable === true,
    ...(retryAfterSeconds > 0 ? { retryAfterSeconds } : {})
  });
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const organizationId = identityFromRequest(req).organizationId;
    const [{ account, preferences }, policy] = await Promise.all([
      chatGptAccountService.readAccountState(userFor(req)),
      aiGatewayService.policy({ organizationId })
    ]);
    return res.json({
      success: true,
      data: {
        account: account.toPublicJSON(),
        policy,
        runtimePreference: runtimePreferenceFor(req),
        ...(preferences ? { preferences } : {})
      }
    });
  } catch (error) { return sendError(res, error); }
});

router.post('/login', requireAuth, async (req, res) => {
  try {
    const { login, account } = await chatGptAccountService.startLogin(userFor(req));
    return res.json({ success: true, data: { login, account: account.toPublicJSON() } });
  } catch (error) { return sendError(res, error); }
});

router.post('/login/cancel', requireAuth, async (req, res) => {
  try {
    const { result, account } = await chatGptAccountService.cancelLogin(userFor(req));
    return res.json({ success: true, data: { ...result, account: account.toPublicJSON() } });
  } catch (error) { return sendError(res, error); }
});

router.post('/login/reset', requireAuth, async (req, res) => {
  try {
    const { result, account } = await chatGptAccountService.resetLogin(userFor(req));
    return res.json({ success: true, data: { ...result, account: account.toPublicJSON() } });
  } catch (error) { return sendError(res, error); }
});

router.post('/consent', requireAuth, async (req, res) => {
  try {
    const account = await chatGptAccountService.setConsent(userFor(req), req.body?.acknowledged === true);
    return res.json({ success: true, data: { account: account.toPublicJSON() } });
  } catch (error) { return sendError(res, error); }
});

router.get('/preferences', requireAuth, async (req, res) => {
  try {
    const preferences = await chatGptAccountService.readPreferences(userFor(req));
    return res.json({ success: true, data: preferences });
  } catch (error) { return sendError(res, error); }
});

router.put('/preferences', requireAuth, async (req, res) => {
  try {
    const preferences = await chatGptAccountService.writePreference(userFor(req), req.body || {});
    return res.json({ success: true, data: preferences });
  } catch (error) { return sendError(res, error); }
});

router.delete('/preferences', requireAuth, async (req, res) => {
  try {
    const preferences = await chatGptAccountService.deletePreference(userFor(req), req.body || {});
    return res.json({ success: true, data: preferences });
  } catch (error) { return sendError(res, error); }
});

router.delete('/', requireAuth, async (req, res) => {
  try {
    const account = await chatGptAccountService.disconnect(userFor(req));
    return res.json({ success: true, data: { account: account.toPublicJSON() } });
  } catch (error) { return sendError(res, error); }
});

module.exports = router;
