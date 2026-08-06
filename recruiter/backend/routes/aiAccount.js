const express = require('express');
const auth = require('../middleware/authMiddleware');
const { normalizeRuntimePolicy } = require('../config/aiRuntimeCatalog');
const aiRuntimeService = require('../services/aiRuntime/aiRuntimeService');
const codexAccountService = require('../services/aiRuntime/codexAccountService');

const router = express.Router();

/**
 * A recruiter's own ChatGPT connection. Every route is scoped to the
 * authenticated user; there is no user id in any path or body, so one account
 * can never address another's connection.
 */

function sendError(response, error) {
  const status = Number(error?.statusCode) || 500;
  return response.status(status).json({
    msg: error?.message || 'The ChatGPT connection request failed',
    code: error?.code || 'CHATGPT_REQUEST_FAILED',
    retryable: error?.retryable === true
  });
}

router.get('/', auth, async (request, response) => {
  try {
    const account = await codexAccountService.readAccount(request.user);
    // The policy travels with the account so the client can tell "you may
    // connect ChatGPT" from "you must, because it is the default runtime".
    const settings = await aiRuntimeService.getSettings();
    return response.json({
      account: account.toPublicJSON(),
      runtimePolicy: normalizeRuntimePolicy(settings.runtimePolicy)
    });
  } catch (error) { return sendError(response, error); }
});

router.post('/login', auth, async (request, response) => {
  try {
    const { login, account } = await codexAccountService.startLogin(request.user);
    return response.json({ login, account: account.toPublicJSON() });
  } catch (error) { return sendError(response, error); }
});

router.post('/login/cancel', auth, async (request, response) => {
  try {
    const { result, account } = await codexAccountService.cancelLogin(request.user);
    return response.json({ ...result, account: account.toPublicJSON() });
  } catch (error) { return sendError(response, error); }
});

router.post('/consent', auth, async (request, response) => {
  try {
    const acknowledged = request.body?.acknowledged === true;
    const account = await codexAccountService.setConsent(request.user, acknowledged);
    return response.json({ account: account.toPublicJSON() });
  } catch (error) { return sendError(response, error); }
});

router.get('/models', auth, async (request, response) => {
  try {
    return response.json({ models: await codexAccountService.listModels(request.user) });
  } catch (error) { return sendError(response, error); }
});

router.delete('/', auth, async (request, response) => {
  try {
    const account = await codexAccountService.disconnect(request.user);
    return response.json({ account: account.toPublicJSON() });
  } catch (error) { return sendError(response, error); }
});

module.exports = router;
