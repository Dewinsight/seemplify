const PlatformSettings = require('../models/PlatformSettings');
const {
  normalizePlatformFeatureFlags,
  validatePlatformFeatureUpdates
} = require('../config/platformFeatures');

const GLOBAL_SETTINGS_KEY = 'global';
const DEFAULT_CACHE_TTL_MS = 5000;
let cachedSettings = null;
let cacheExpiresAt = 0;

function getCacheTtlMs() {
  const configured = Number(process.env.PLATFORM_FEATURE_CACHE_TTL_MS);
  return Number.isFinite(configured) && configured >= 0
    ? configured
    : DEFAULT_CACHE_TTL_MS;
}

function cachePlatformFeatureSettings(settings) {
  cachedSettings = settings;
  cacheExpiresAt = Date.now() + getCacheTtlMs();
  return settings;
}

function resetPlatformFeatureCache() {
  cachedSettings = null;
  cacheExpiresAt = 0;
}

async function getPlatformFeatureSettings({
  settingsModel = PlatformSettings,
  forceRefresh = false
} = {}) {
  const useCache = settingsModel === PlatformSettings;
  if (useCache && !forceRefresh && cachedSettings && Date.now() < cacheExpiresAt) {
    return cachedSettings;
  }

  const settings = await settingsModel.findOne({ key: GLOBAL_SETTINGS_KEY }).lean();
  const result = {
    features: normalizePlatformFeatureFlags(settings?.featureFlags),
    updatedAt: settings?.updatedAt || null,
    updatedBy: settings?.updatedBy || null
  };

  return useCache ? cachePlatformFeatureSettings(result) : result;
}

async function updatePlatformFeatureSettings(
  updates,
  updatedBy,
  { settingsModel = PlatformSettings } = {}
) {
  const validatedUpdates = validatePlatformFeatureUpdates(updates);
  const featureUpdates = Object.fromEntries(
    Object.entries(validatedUpdates).map(([key, enabled]) => [
      `featureFlags.${key}`,
      enabled
    ])
  );

  const settings = await settingsModel.findOneAndUpdate(
    { key: GLOBAL_SETTINGS_KEY },
    {
      $set: {
        ...featureUpdates,
        updatedBy: updatedBy || null
      },
      $setOnInsert: { key: GLOBAL_SETTINGS_KEY }
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
      runValidators: true
    }
  ).lean();

  const result = {
    features: normalizePlatformFeatureFlags(settings.featureFlags),
    updatedAt: settings.updatedAt || null,
    updatedBy: settings.updatedBy || null
  };

  return settingsModel === PlatformSettings
    ? cachePlatformFeatureSettings(result)
    : result;
}

module.exports = {
  getPlatformFeatureSettings,
  updatePlatformFeatureSettings,
  resetPlatformFeatureCache
};
