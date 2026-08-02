const DEFAULT_PLATFORM_FEATURES = Object.freeze({
  aiInterviews: true
});

function normalizeFeatures(value = {}) {
  return Object.keys(DEFAULT_PLATFORM_FEATURES).reduce((features, key) => {
    features[key] = typeof value?.[key] === 'boolean'
      ? value[key]
      : DEFAULT_PLATFORM_FEATURES[key];
    return features;
  }, {});
}

function resolvePlatformApiBaseUrl(env = process.env) {
  const configured = String(env.SEEMPLIFY_PLATFORM_API_URL || '').trim();
  if (configured) return configured.replace(/\/$/, '');

  const frontendUrl = String(env.AI_INTERVIEW_FRONTEND_URL || env.CORS_ORIGIN || '').trim();
  const isHostedFrontend = frontendUrl && !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(frontendUrl);
  return env.NODE_ENV === 'production' || isHostedFrontend
    ? 'https://api.seemplifyai.com'
    : '';
}

function createPlatformFeatureClient({
  baseUrl = resolvePlatformApiBaseUrl(),
  fetchImpl = global.fetch,
  cacheMs = Number(process.env.PLATFORM_FEATURE_CACHE_MS || 15_000),
  timeoutMs = 3_000
} = {}) {
  let cachedFeatures = { ...DEFAULT_PLATFORM_FEATURES };
  let cacheExpiresAt = 0;
  let hasRemoteValue = false;

  async function getFeatures({ force = false } = {}) {
    if (!baseUrl || typeof fetchImpl !== 'function') {
      return { features: { ...cachedFeatures }, stale: false, source: 'local-default' };
    }

    if (!force && cacheExpiresAt > Date.now()) {
      return { features: { ...cachedFeatures }, stale: false, source: 'cache' };
    }

    try {
      const signal = typeof globalThis.AbortSignal?.timeout === 'function'
        ? globalThis.AbortSignal.timeout(timeoutMs)
        : undefined;
      const response = await fetchImpl(`${baseUrl}/api/platform/features`, {
        headers: { Accept: 'application/json' },
        signal
      });
      if (!response.ok) {
        throw new Error(`Platform feature API returned ${response.status}`);
      }

      const payload = await response.json();
      if (typeof payload?.features?.aiInterviews !== 'boolean') {
        throw new Error('Platform feature API returned an invalid payload');
      }
      cachedFeatures = normalizeFeatures(payload.features);
      cacheExpiresAt = Date.now() + Math.max(1_000, cacheMs);
      hasRemoteValue = true;
      return { features: { ...cachedFeatures }, stale: false, source: 'platform-api' };
    } catch (error) {
      console.warn('Could not refresh Seemplify platform features:', error.message);
      cacheExpiresAt = Date.now() + Math.max(1_000, cacheMs);
      return {
        features: { ...cachedFeatures },
        stale: hasRemoteValue,
        source: hasRemoteValue ? 'stale-cache' : 'local-default'
      };
    }
  }

  async function isFeatureEnabled(featureKey) {
    if (!(featureKey in DEFAULT_PLATFORM_FEATURES)) {
      throw new Error(`Unknown platform feature: ${featureKey}`);
    }
    const { features } = await getFeatures();
    return features[featureKey];
  }

  return { getFeatures, isFeatureEnabled };
}

const platformFeatureClient = createPlatformFeatureClient();

function requirePlatformFeature(featureKey, { featureClient = platformFeatureClient } = {}) {
  return async (req, res, next) => {
    try {
      if (await featureClient.isFeatureEnabled(featureKey)) return next();
      return res.status(403).json({
        error: 'FEATURE_DISABLED',
        code: 'FEATURE_DISABLED',
        feature: featureKey,
        message: 'AI Interviews are currently unavailable.'
      });
    } catch (error) {
      console.error(`Could not evaluate platform feature ${featureKey}:`, error);
      return res.status(503).json({
        error: 'FEATURE_SETTINGS_UNAVAILABLE',
        code: 'FEATURE_SETTINGS_UNAVAILABLE',
        message: 'Platform feature settings are temporarily unavailable.'
      });
    }
  };
}

module.exports = {
  DEFAULT_PLATFORM_FEATURES,
  createPlatformFeatureClient,
  normalizeFeatures,
  platformFeatureClient,
  requirePlatformFeature,
  resolvePlatformApiBaseUrl
};
