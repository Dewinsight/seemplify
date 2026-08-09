'use strict';

const express = require('express');
const { adminAuth, requirePermission } = require('../middleware/adminAuth');
const AIRuntimeSettings = require('../models/AIRuntimeSettings');
const aiRuntimeService = require('../services/aiRuntime/aiRuntimeService');
const cvAnalysisQueue = require('../services/cvAnalysisQueueService');
const {
  adminModelCatalog,
} = require('../services/aiRuntime/adminModelCatalogService');
const { updateAdminActivityRoute } = require('../services/aiRuntime/adminRouteSettingsService');
const { ACTIVITY_DEFINITIONS, normalizeRuntimePolicy } = require('../config/aiRuntimeCatalog');

const router = express.Router();
const canView = [adminAuth, requirePermission('viewAnalytics')];
const canManage = [adminAuth, requirePermission('systemSettings')];

function fail(response, error, fallback = 'The AI runtime request failed') {
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

router.get('/models', ...canView, async (request, response) => {
  try { return response.json(await adminModelCatalog(request.admin)); }
  catch (error) { return fail(response, error, 'Failed to load the ChatGPT model catalogue'); }
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
    const runtimePolicy = normalizeRuntimePolicy(request.body);
    if (!runtimePolicy.localEnabled && !runtimePolicy.chatgptEnabled) {
      return response.status(400).json({ code: 'AI_RUNTIME_REQUIRED', msg: 'Enable at least one AI runtime.' });
    }
    await AIRuntimeSettings.updateOne(
      { key: 'global' },
      { $set: { runtimePolicy }, $inc: { version: 1 } },
      { upsert: true }
    );
    aiRuntimeService.invalidateSettingsCache();
    return response.json(await aiRuntimeService.getSettings({ force: true }));
  } catch (error) { return fail(response, error, 'Failed to update AI runtime policy'); }
});

router.put('/routes/:activity', ...canManage, async (request, response) => {
  try {
    const activity = String(request.params.activity || '');
    if (!ACTIVITY_DEFINITIONS[activity]) return response.status(404).json({ code: 'AI_ACTIVITY_UNKNOWN', msg: 'Unknown activity' });
    const changesPreference = Object.prototype.hasOwnProperty.call(request.body || {}, 'codexModel')
      || Object.prototype.hasOwnProperty.call(request.body || {}, 'reasoningEffort');
    let models = [];
    if (changesPreference) {
      const catalogue = await adminModelCatalog(request.admin);
      if (!catalogue.available) {
        const error = new Error(catalogue.message || 'The live ChatGPT model catalogue is unavailable.');
        error.code = 'CHATGPT_MODEL_CATALOG_UNAVAILABLE';
        error.statusCode = 409;
        throw error;
      }
      models = catalogue.models;
    }
    await updateAdminActivityRoute({
      settingsModel: AIRuntimeSettings,
      activity,
      changes: request.body || {},
      models
    });
    aiRuntimeService.invalidateSettingsCache();
    return response.json(await aiRuntimeService.getSettings({ force: true }));
  } catch (error) { return fail(response, error, 'Failed to update ChatGPT activity'); }
});

module.exports = router;
