const OrganizationFeatureConfig = require('../models/OrganizationFeatureConfig');
const { resolveOrganizationId } = require('./tenantPolicy');

const ORGANIZATION_FEATURE_KEYS = Object.freeze([
  'canonicalAppraisals',
  'goalPeriods',
  'notifications',
  'continuousPerformance',
  'performanceSupportPlans',
  'recognition',
  'projectFeedback',
  'managerPracticeInsights',
  'continuousCoachingAi',
  'talentPlanning'
]);

const DEFAULT_ORGANIZATION_FEATURES = Object.freeze(
  Object.fromEntries(ORGANIZATION_FEATURE_KEYS.map(key => [key, true]))
);

function normalizeOrganizationId(value) {
  const organizationId = String(value || '').trim();
  if (!organizationId) throw new TypeError('Organization ID is required.');
  return organizationId;
}

function effectiveOrganizationFeatures(overrides = {}) {
  return Object.fromEntries(ORGANIZATION_FEATURE_KEYS.map(key => [
    key,
    overrides?.[key] !== false
  ]));
}

function configuredFeatureOverrides(overrides = {}) {
  return Object.fromEntries(ORGANIZATION_FEATURE_KEYS
    .filter(key => typeof overrides?.[key] === 'boolean')
    .map(key => [key, overrides[key]]));
}

async function getOrganizationFeatureState(organizationId) {
  const safeOrganizationId = normalizeOrganizationId(organizationId);
  const config = await OrganizationFeatureConfig.findOne({ organizationId: safeOrganizationId })
    .select('organizationId features createdAt updatedAt createdBy updatedBy')
    .lean();
  const overrides = configuredFeatureOverrides(config?.features);
  return {
    organizationId: safeOrganizationId,
    configured: Boolean(config),
    features: effectiveOrganizationFeatures(overrides),
    overrides,
    createdAt: config?.createdAt || null,
    updatedAt: config?.updatedAt || null,
    createdBy: config?.createdBy || null,
    updatedBy: config?.updatedBy || null
  };
}

function validateFeaturePatch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Features must be an object.');
  }
  const suppliedKeys = Object.keys(input);
  if (suppliedKeys.length === 0) throw new TypeError('At least one feature flag is required.');
  const unknown = suppliedKeys.filter(key => !ORGANIZATION_FEATURE_KEYS.includes(key));
  if (unknown.length > 0) throw new TypeError(`Unknown feature flag: ${unknown[0]}.`);
  for (const key of suppliedKeys) {
    if (typeof input[key] !== 'boolean' && input[key] !== null) {
      throw new TypeError(`${key} must be true, false, or null.`);
    }
  }
  return Object.fromEntries(suppliedKeys.map(key => [key, input[key]]));
}

async function updateOrganizationFeatures({ organizationId, changes, actorId }) {
  const safeOrganizationId = normalizeOrganizationId(organizationId);
  const patch = validateFeaturePatch(changes);
  const safeActorId = String(actorId || '').trim();
  const update = {
    $set: {
      ...(safeActorId ? { updatedBy: safeActorId } : {})
    },
    $setOnInsert: {
      organizationId: safeOrganizationId,
      ...(safeActorId ? { createdBy: safeActorId } : {})
    }
  };

  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      update.$unset = { ...(update.$unset || {}), [`features.${key}`]: '' };
    } else {
      update.$set[`features.${key}`] = value;
    }
  }
  if (Object.keys(update.$set).length === 0) delete update.$set;

  const config = await OrganizationFeatureConfig.findOneAndUpdate(
    { organizationId: safeOrganizationId },
    update,
    { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
  ).lean();
  const overrides = configuredFeatureOverrides(config.features);
  return {
    organizationId: safeOrganizationId,
    configured: true,
    features: effectiveOrganizationFeatures(overrides),
    overrides,
    createdAt: config.createdAt || null,
    updatedAt: config.updatedAt || null,
    createdBy: config.createdBy || null,
    updatedBy: config.updatedBy || null
  };
}

function requireOrganizationFeature(featureKey, { loader = getOrganizationFeatureState } = {}) {
  if (!ORGANIZATION_FEATURE_KEYS.includes(featureKey)) {
    throw new TypeError(`Unknown organization feature: ${featureKey}.`);
  }
  return async (req, res, next) => {
    try {
      const organizationId = req.organizationId || resolveOrganizationId(req);
      if (!organizationId) {
        return res.status(403).json({
          success: false,
          error: 'Select an organization before accessing this feature.',
          code: 'ORGANIZATION_REQUIRED'
        });
      }
      const state = req.organizationFeatureState?.organizationId === String(organizationId)
        ? req.organizationFeatureState
        : await loader(String(organizationId));
      req.organizationFeatureState = state;
      req.organizationFeatures = state.features;
      if (state.features[featureKey] !== true) {
        return res.status(403).json({
          success: false,
          error: 'This feature is not enabled for the active organization.',
          code: 'ORGANIZATION_FEATURE_DISABLED',
          feature: featureKey
        });
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = {
  DEFAULT_ORGANIZATION_FEATURES,
  ORGANIZATION_FEATURE_KEYS,
  configuredFeatureOverrides,
  effectiveOrganizationFeatures,
  getOrganizationFeatureState,
  requireOrganizationFeature,
  updateOrganizationFeatures,
  validateFeaturePatch
};
