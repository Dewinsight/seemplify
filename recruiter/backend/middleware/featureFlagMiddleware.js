const { PLATFORM_FEATURE_DEFINITIONS } = require('../config/platformFeatures');
const { getPlatformFeatureSettings } = require('../services/platformFeatureService');

function createRequireFeature(
  featureKey,
  { loadFeatureSettings = getPlatformFeatureSettings } = {}
) {
  const definition = PLATFORM_FEATURE_DEFINITIONS[featureKey];
  if (!definition) {
    throw new Error(`Unknown platform feature: ${featureKey}`);
  }

  return async (req, res, next) => {
    try {
      const { features } = await loadFeatureSettings();
      if (features[featureKey]) {
        return next();
      }

      return res.status(403).json({
        success: false,
        code: 'FEATURE_DISABLED',
        feature: featureKey,
        msg: `${definition.label} is currently unavailable.`,
        message: `${definition.label} is currently unavailable.`
      });
    } catch (error) {
      console.error(`Failed to evaluate feature flag ${featureKey}:`, error);
      return res.status(503).json({
        success: false,
        code: 'FEATURE_SETTINGS_UNAVAILABLE',
        msg: 'Platform feature settings are temporarily unavailable.'
      });
    }
  };
}

const requireFeature = (featureKey) => createRequireFeature(featureKey);

module.exports = {
  createRequireFeature,
  requireFeature
};
