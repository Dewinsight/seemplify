const express = require('express');
const auth = require('../middleware/authMiddleware');
const { normalizeRuntimePolicy } = require('../config/aiRuntimeCatalog');
const aiRuntimeService = require('../services/aiRuntime/aiRuntimeService');
const codexAccountService = require('../services/aiRuntime/codexAccountService');
const userAISettingsService = require('../services/aiRuntime/userAISettingsService');

const router = express.Router();

/**
 * A recruiter's own ChatGPT connection. Every route is scoped to the
 * authenticated user; there is no user id in any path or body, so one account
 * can never address another's connection.
 */

function sendError(response, error) {
  const status = Number(error?.statusCode) || 500;
  const retryAfterSeconds = Number(error?.retryAfterSeconds) || 0;
  if (retryAfterSeconds > 0) response.set('Retry-After', String(retryAfterSeconds));
  return response.status(status).json({
    msg: error?.message || 'The ChatGPT connection request failed',
    code: error?.code || 'CHATGPT_REQUEST_FAILED',
    retryable: error?.retryable === true,
    ...(retryAfterSeconds > 0 ? { retryAfterSeconds } : {})
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

router.post('/login/reset', auth, async (request, response) => {
  try {
    const { result, account } = await codexAccountService.resetLogin(request.user);
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

router.put('/runtime-preference', auth, async (request, response) => {
  try {
    const preference = String(request.body?.runtimePreference || 'default');
    if (!['default', 'local', 'chatgpt'].includes(preference)) {
      return response.status(400).json({ code: 'AI_RUNTIME_PREFERENCE_INVALID', msg: 'Choose default, local, or ChatGPT.' });
    }
    const settings = await aiRuntimeService.getSettings();
    const policy = normalizeRuntimePolicy(settings.runtimePolicy);
    if (preference === 'local' && !policy.localEnabled) {
      return response.status(409).json({ code: 'AI_RUNTIME_LOCAL_DISABLED', msg: 'Local inference is not enabled.' });
    }
    if (preference === 'chatgpt' && !policy.chatgptEnabled) {
      return response.status(409).json({ code: 'AI_RUNTIME_CHATGPT_DISABLED', msg: 'ChatGPT is not enabled.' });
    }
    const account = await codexAccountService.readAccount(request.user);
    account.runtimePreference = preference;
    await account.save();
    return response.json({ account: account.toPublicJSON(), runtimePolicy: policy });
  } catch (error) { return sendError(response, error); }
});

router.get('/models', auth, async (request, response) => {
  try {
    return response.json({ models: await codexAccountService.listModels(request.user) });
  } catch (error) { return sendError(response, error); }
});

router.get('/activity-overrides', auth, async (request, response) => {
  try {
    return response.json(await userAISettingsService.readPreferences(request.user));
  } catch (error) { return sendError(response, error); }
});

router.put('/activity-overrides', auth, async (request, response) => {
  try {
    return response.json(await userAISettingsService.writePreference(request.user, request.body));
  } catch (error) { return sendError(response, error); }
});

router.delete('/activity-overrides', auth, async (request, response) => {
  try {
    return response.json(await userAISettingsService.deletePreference(request.user, request.body));
  } catch (error) { return sendError(response, error); }
});

router.delete('/', auth, async (request, response) => {
  try {
    const account = await codexAccountService.disconnect(request.user);
    return response.json({ account: account.toPublicJSON() });
  } catch (error) { return sendError(response, error); }
});

module.exports = router;
