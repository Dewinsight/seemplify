'use strict';

const express = require('express');
const { requireAuth, requireHRAdmin } = require('../middleware/rbac');
const AIRuntimeSettings = require('../models/AIRuntimeSettings');
const aiGatewayService = require('../services/aiGatewayService');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const policy = await aiGatewayService.policy();
  const runtimePreference = ['local', 'chatgpt'].includes(req.cookies?.performance_ai_runtime)
    ? req.cookies.performance_ai_runtime : 'default';
  res.json({ policy, runtimePreference });
});

router.put('/preference', requireAuth, async (req, res) => {
  const preference = String(req.body?.runtimePreference || 'default');
  if (!['default', 'local', 'chatgpt'].includes(preference)) {
    return res.status(400).json({ code: 'AI_RUNTIME_PREFERENCE_INVALID', error: 'Choose default, local, or ChatGPT.' });
  }
  const policy = await aiGatewayService.policy();
  if (preference === 'local' && !policy.localEnabled) return res.status(409).json({ code: 'AI_RUNTIME_LOCAL_DISABLED' });
  if (preference === 'chatgpt' && !policy.chatgptEnabled) return res.status(409).json({ code: 'AI_RUNTIME_CHATGPT_DISABLED' });
  res.cookie('performance_ai_runtime', preference, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 365 * 24 * 60 * 60 * 1000
  });
  return res.json({ policy, runtimePreference: preference });
});

router.put('/policy', requireAuth, requireHRAdmin, async (req, res) => {
  const localEnabled = req.body?.localEnabled === true;
  const chatgptEnabled = req.body?.chatgptEnabled === true;
  if (!localEnabled && !chatgptEnabled) {
    return res.status(400).json({ code: 'AI_RUNTIME_REQUIRED', error: 'Enable at least one runtime.' });
  }
  let defaultRuntime = req.body?.defaultRuntime === 'chatgpt' ? 'chatgpt' : 'local';
  if (defaultRuntime === 'local' && !localEnabled) defaultRuntime = 'chatgpt';
  if (defaultRuntime === 'chatgpt' && !chatgptEnabled) defaultRuntime = 'local';
  await AIRuntimeSettings.updateOne(
    { key: 'global' },
    { $set: { localEnabled, chatgptEnabled, defaultRuntime, updatedBy: String(req.user?.sub || req.user?.id || '') } },
    { upsert: true }
  );
  aiGatewayService.invalidatePolicyCache();
  return res.json({ policy: await aiGatewayService.policy({ force: true }) });
});

module.exports = router;
