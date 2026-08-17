function parseDatabase(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function resolveEnrichmentRedisConnection(env = process.env) {
  const enabled = env.REDIS_ENABLED
    ? env.REDIS_ENABLED !== 'false'
    : env.NODE_ENV === 'production' || Boolean(env.REDIS_HOST);
  if (!enabled) return null;

  const common = {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  };
  const explicitUrl = String(env.ENRICHMENT_REDIS_URL || '').trim();
  if (explicitUrl) return { url: explicitUrl, options: common };

  return {
    options: {
      ...common,
      host: env.REDIS_HOST || (env.NODE_ENV === 'production' ? 'dokploy-redis' : '127.0.0.1'),
      port: Number.parseInt(env.REDIS_PORT || '6379', 10),
      db: parseDatabase(env.ENRICHMENT_REDIS_DB || env.REDIS_DB),
      username: env.REDIS_USERNAME || undefined,
      password: env.REDIS_PASSWORD || undefined,
    },
  };
}

module.exports = { resolveEnrichmentRedisConnection };
