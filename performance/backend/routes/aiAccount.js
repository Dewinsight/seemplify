'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/rbac');
const aiGatewayService = require('../services/aiGatewayService');
const chatGptAccountService = require('../services/chatGptAccountService');

const router = express.Router();

function userFor(req) {
  return req.session?.user || {};
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
    const account = await chatGptAccountService.readAccount(userFor(req));
    return res.json({ success: true, data: { account: account.toPublicJSON(), policy: await aiGatewayService.policy() } });
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

router.delete('/', requireAuth, async (req, res) => {
  try {
    const account = await chatGptAccountService.disconnect(userFor(req));
    return res.json({ success: true, data: { account: account.toPublicJSON() } });
  } catch (error) { return sendError(res, error); }
});

module.exports = router;
