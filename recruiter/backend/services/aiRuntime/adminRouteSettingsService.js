'use strict';

const { createDefaultRuntimeSettings } = require('../../config/aiRuntimeCatalog');
const { validateAdminRoutePreference } = require('./adminModelCatalogService');

function effectiveRoutes(stored = {}) {
  const defaults = createDefaultRuntimeSettings();
  const saved = new Map((stored.routes || []).map((route) => [route.activity, route]));
  return defaults.routes.map((route) => ({ ...route, ...(saved.get(route.activity) || {}) }));
}

async function updateAdminActivityRoute({
  settingsModel,
  activity,
  changes = {},
  models = [],
  maxAttempts = 5
}) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const stored = await settingsModel.findOne({ key: 'global' }).lean();
    if (!stored) {
      const error = new Error('AI runtime settings have not been initialized.');
      error.code = 'AI_RUNTIME_SETTINGS_NOT_INITIALIZED';
      error.statusCode = 409;
      throw error;
    }
    const routes = effectiveRoutes(stored);
    const currentRoute = routes.find((route) => route.activity === activity);
    if (!currentRoute) {
      const error = new Error('Unknown AI activity.');
      error.code = 'AI_ACTIVITY_UNKNOWN';
      error.statusCode = 404;
      throw error;
    }
    const changesPreference = Object.prototype.hasOwnProperty.call(changes, 'codexModel')
      || Object.prototype.hasOwnProperty.call(changes, 'reasoningEffort');
    const preference = changesPreference
      ? validateAdminRoutePreference(currentRoute, changes, models)
      : { codexModel: currentRoute.codexModel, reasoningEffort: currentRoute.reasoningEffort };
    const nextRoutes = routes.map((route) => route.activity === activity ? {
      ...route,
      enabled: changes.enabled !== false,
      codexModel: preference.codexModel,
      reasoningEffort: preference.reasoningEffort
    } : route);
    const result = await settingsModel.updateOne(
      { key: 'global', version: Number(stored.version || 0) },
      { $set: { routes: nextRoutes }, $inc: { version: 1 } }
    );
    if (Number(result.modifiedCount || 0) === 1) return nextRoutes;
  }
  const error = new Error('AI runtime settings changed while this activity was being saved. Try again.');
  error.code = 'AI_RUNTIME_SETTINGS_CONFLICT';
  error.statusCode = 409;
  throw error;
}

module.exports = { effectiveRoutes, updateAdminActivityRoute };
