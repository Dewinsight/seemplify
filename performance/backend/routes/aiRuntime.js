'use strict';

const express = require('express');
const { requireAuth, requireHRAdmin } = require('../middleware/rbac');
const AIRuntimeSettings = require('../models/AIRuntimeSettings');
const aiGatewayService = require('../services/aiGatewayService');

const router = express.Router();

function organizationId(req) {
  return require('../services/sharedAIAccountService').identityFromRequest(req).organizationId;
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const policy = await aiGatewayService.policy({ organizationId: organizationId(req) });
    const runtimePreference = ['local', 'chatgpt'].includes(req.cookies?.performance_ai_runtime)
      ? req.cookies.performance_ai_runtime : 'default';
    return res.json({ policy, runtimePreference });
  } catch (error) {
    return aiGatewayService.sendPerformanceAIError(res, error, 'The AI runtime policy could not be loaded.');
  }
});

router.put('/preference', requireAuth, async (req, res) => {
  try {
    const preference = String(req.body?.runtimePreference || 'default');
    if (!['default', 'local', 'chatgpt'].includes(preference)) {
      return res.status(400).json({ code: 'AI_RUNTIME_PREFERENCE_INVALID', error: 'Choose default, local, or ChatGPT.' });
    }
    const policy = await aiGatewayService.policy({ organizationId: organizationId(req) });
    if (preference === 'local' && !policy.localEnabled) return res.status(409).json({ code: 'AI_RUNTIME_LOCAL_DISABLED' });
    if (preference === 'chatgpt' && !policy.chatgptEnabled) return res.status(409).json({ code: 'AI_RUNTIME_CHATGPT_DISABLED' });
    res.cookie('performance_ai_runtime', preference, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 365 * 24 * 60 * 60 * 1000
    });
    return res.json({ policy, runtimePreference: preference });
  } catch (error) {
    return aiGatewayService.sendPerformanceAIError(res, error, 'The AI runtime preference could not be saved.');
  }
});

router.put('/policy', requireAuth, requireHRAdmin, async (req, res) => {
  try {
    const currentOrganizationId = organizationId(req);
    if (!currentOrganizationId) {
      return res.status(400).json({ code: 'AI_RUNTIME_ORGANIZATION_REQUIRED', error: 'Choose an organization first.' });
    }
    const localEnabled = req.body?.localEnabled === true;
    const chatgptEnabled = req.body?.chatgptEnabled === true;
    if (!localEnabled && !chatgptEnabled) {
      return res.status(400).json({ code: 'AI_RUNTIME_REQUIRED', error: 'Enable at least one runtime.' });
    }
    let defaultRuntime = req.body?.defaultRuntime === 'chatgpt' ? 'chatgpt' : 'local';
    if (defaultRuntime === 'local' && !localEnabled) defaultRuntime = 'chatgpt';
    if (defaultRuntime === 'chatgpt' && !chatgptEnabled) defaultRuntime = 'local';
    await AIRuntimeSettings.updateOne(
      { key: `organization:${currentOrganizationId}` },
      { $set: { localEnabled, chatgptEnabled, defaultRuntime, updatedBy: String(req.user?.sub || req.user?.id || '') } },
      { upsert: true }
    );
    aiGatewayService.invalidatePolicyCache(currentOrganizationId);
    return res.json({ policy: await aiGatewayService.policy({ force: true, organizationId: currentOrganizationId }) });
  } catch (error) {
    return aiGatewayService.sendPerformanceAIError(res, error, 'The workspace AI runtime policy could not be saved.');
  }
});

module.exports = router;
