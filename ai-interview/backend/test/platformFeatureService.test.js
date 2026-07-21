const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createPlatformFeatureClient,
  requirePlatformFeature,
  resolvePlatformApiBaseUrl
} = require('../src/platformFeatureService');

test('standalone production deployments default to the central Seemplify API', () => {
  assert.equal(
    resolvePlatformApiBaseUrl({ AI_INTERVIEW_FRONTEND_URL: 'https://interview.seemplifyai.com' }),
    'https://api.seemplifyai.com'
  );
  assert.equal(
    resolvePlatformApiBaseUrl({ AI_INTERVIEW_FRONTEND_URL: 'http://localhost:5200' }),
    ''
  );
});

test('standalone AI Interview reads the central Seemplify feature switch', async () => {
  const client = createPlatformFeatureClient({
    baseUrl: 'https://platform.example',
    fetchImpl: async (url) => {
      assert.equal(url, 'https://platform.example/api/platform/features');
      return {
        ok: true,
        json: async () => ({ features: { aiInterviews: false } })
      };
    }
  });

  assert.equal(await client.isFeatureEnabled('aiInterviews'), false);
});

test('standalone AI Interview defaults on when central settings are not configured', async () => {
  const client = createPlatformFeatureClient({ baseUrl: '' });
  assert.equal(await client.isFeatureEnabled('aiInterviews'), true);
});

test('standalone AI Interview keeps the last known switch after an invalid response', async () => {
  let requestCount = 0;
  const client = createPlatformFeatureClient({
    baseUrl: 'https://platform.example',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ++requestCount === 1
        ? { features: { aiInterviews: false } }
        : { features: {} }
    })
  });

  assert.equal((await client.getFeatures()).features.aiInterviews, false);
  assert.equal((await client.getFeatures({ force: true })).features.aiInterviews, false);
});

test('standalone interview middleware returns FEATURE_DISABLED when switched off', async () => {
  const middleware = requirePlatformFeature('aiInterviews', {
    featureClient: { isFeatureEnabled: async () => false }
  });
  let nextCalls = 0;
  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };

  await middleware({}, response, () => { nextCalls += 1; });

  assert.equal(nextCalls, 0);
  assert.equal(response.statusCode, 403);
  assert.equal(response.body.code, 'FEATURE_DISABLED');
});
