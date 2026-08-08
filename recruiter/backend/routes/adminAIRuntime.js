'use strict';

const express = require('express');
const { adminAuth, requirePermission } = require('../middleware/adminAuth');
const AIRuntimeSettings = require('../models/AIRuntimeSettings');
const aiRuntimeService = require('../services/aiRuntime/aiRuntimeService');
const cvAnalysisQueue = require('../services/cvAnalysisQueueService');
const { ACTIVITY_DEFINITIONS } = require('../config/aiRuntimeCatalog');

const router = express.Router();
const canView = [adminAuth, requirePermission('viewAnalytics')];
const canManage = [adminAuth, requirePermission('systemSettings')];

function fail(response, error, fallback = 'The ChatGPT runtime request failed') {
  console.error(fallback, error);
  return response.status(error.statusCode || 500).json({
    code: error.code || 'CHATGPT_RUNTIME_ADMIN_ERROR',
    msg: error.message || fallback
  });
}

router.get('/settings', ...canView, async (_request, response) => {
  try { return response.json(await aiRuntimeService.getSettings({ force: true })); }
  catch (error) { return fail(response, error, 'Failed to load ChatGPT settings'); }
});

router.get('/gateway/status', ...canView, async (_request, response) => {
  try { return response.json(await aiRuntimeService.getGatewayStatus()); }
  catch (error) { return fail(response, error, 'Failed to load ChatGPT gateway status'); }
});

router.get('/overview', ...canView, async (_request, response) => {
  try {
    const [settings, gateway, queue] = await Promise.all([
      aiRuntimeService.getSettings({ force: true }),
      aiRuntimeService.getGatewayStatus(),
      cvAnalysisQueue.adminTelemetry()
    ]);
    return response.json({ settings, gateway, queue });
  } catch (error) { return fail(response, error, 'Failed to load ChatGPT overview'); }
});

router.get('/live', ...canView, async (_request, response) => {
  try {
    const [gateway, queue] = await Promise.all([
      aiRuntimeService.getGatewayStatus(), cvAnalysisQueue.adminTelemetry()
    ]);
    return response.json({ gateway, queue, sampledAt: new Date().toISOString() });
  } catch (error) { return fail(response, error, 'Failed to load live ChatGPT status'); }
});

router.put('/provider', ...canManage, async (request, response) => {
  try {
    await AIRuntimeSettings.updateOne(
      { key: 'global' },
      { $set: { providerEnabled: request.body?.providerEnabled !== false }, $inc: { version: 1 } },
      { upsert: true }
    );
    aiRuntimeService.invalidateSettingsCache();
    return response.json(await aiRuntimeService.getSettings({ force: true }));
  } catch (error) { return fail(response, error, 'Failed to update ChatGPT availability'); }
});

router.put('/runtime-policy', ...canManage, async (request, response) => {
  try {
    await AIRuntimeSettings.updateOne(
      { key: 'global' },
      { $set: { runtimePolicy: {
        chatgptEnabled: request.body?.chatgptEnabled !== false,
        chatgptRequired: true,
        defaultRuntime: 'chatgpt'
      } }, $inc: { version: 1 } },
      { upsert: true }
    );
    aiRuntimeService.invalidateSettingsCache();
    return response.json(await aiRuntimeService.getSettings({ force: true }));
  } catch (error) { return fail(response, error, 'Failed to update ChatGPT policy'); }
});

router.put('/routes/:activity', ...canManage, async (request, response) => {
  try {
    const activity = String(request.params.activity || '');
    if (!ACTIVITY_DEFINITIONS[activity]) return response.status(404).json({ code: 'AI_ACTIVITY_UNKNOWN', msg: 'Unknown activity' });
    const current = await aiRuntimeService.getSettings({ force: true });
    const routes = current.routes.map((route) => route.activity === activity ? {
      ...route,
      enabled: request.body?.enabled !== false,
      reasoningEffort: ['low', 'medium', 'high', 'xhigh'].includes(request.body?.reasoningEffort)
        ? request.body.reasoningEffort : route.reasoningEffort,
      codexModel: String(request.body?.codexModel || route.codexModel).slice(0, 100)
    } : route);
    await AIRuntimeSettings.updateOne(
      { key: 'global' },
      { $setOnInsert: { key: 'global' }, $set: { routes }, $inc: { version: 1 } },
      { upsert: true }
    );
    aiRuntimeService.invalidateSettingsCache();
    return response.json(await aiRuntimeService.getSettings({ force: true }));
  } catch (error) { return fail(response, error, 'Failed to update ChatGPT activity'); }
});

module.exports = router;
