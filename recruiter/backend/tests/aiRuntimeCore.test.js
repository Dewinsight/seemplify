const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const { createInternalServiceAuth } = require('../middleware/internalServiceAuth');
const { requirePermission, requireSuperAdmin } = require('../middleware/adminAuth');
const { createDefaultRuntimeSettings } = require('../config/aiRuntimeCatalog');
const AIAuditEvent = require('../models/AIAuditEvent');
const { createBootstrapSettings, mergeCatalogSettings } = require('../scripts/seedAIRuntime');
const { retryDelayMinutes } = require('../services/aiInterviewScoringRetryService');
const { decryptSecret, encryptSecret, fingerprintSecret, maskSecret } = require('../services/aiRuntime/secretCrypto');
const { getAIRequestContext, runWithAIRequestContext } = require('../services/aiRuntime/requestContext');
const { validateJsonSchema } = require('../services/aiRuntime/jsonSchemaValidator');
const {
  buildQuotaSnapshotSet,
  calculateEstimatedCost,
  normalizeUsage,
  parseDurationMs,
  parseRateLimitHeaders,
  sanitizeMessage,
  utcDay
} = require('../services/aiRuntime/usageService');

const TEST_KEY = crypto.randomBytes(32).toString('base64');
const TEST_ENV = {
  AI_PROVIDER_ENCRYPTION_KEY: TEST_KEY,
  AI_PROVIDER_ENCRYPTION_KEY_VERSION: 'test-v1'
};

test('AES-GCM credentials round-trip, mask, and reject the wrong key', () => {
  const secret = `gsk_${'x'.repeat(36)}`;
  const encrypted = encryptSecret(secret, { env: TEST_ENV });
  assert.equal(encrypted.algorithm, 'aes-256-gcm');
  assert.equal(encrypted.keyVersion, 'test-v1');
  assert.equal(decryptSecret(encrypted, { env: TEST_ENV }), secret);
  assert.equal(maskSecret(secret), `****${secret.slice(-4)}`);
  assert.equal(fingerprintSecret(secret).length, 64);
  assert.throws(() => decryptSecret(encrypted, {
    env: { ...TEST_ENV, AI_PROVIDER_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64') }
  }));
});

test('secret sanitization removes Groq and bearer credentials', () => {
  const message = sanitizeMessage(`bad ${`gsk_${'a'.repeat(32)}`} and Bearer abc.def.ghi`);
  assert.equal(message.includes('gsk_'), false);
  assert.equal(message.includes('abc.def.ghi'), false);
});

test('usage and price calculations include cached and reasoning tokens', () => {
  const usage = normalizeUsage({
    prompt_tokens: 1000,
    completion_tokens: 500,
    prompt_tokens_details: { cached_tokens: 200 },
    completion_tokens_details: { reasoning_tokens: 125 }
  });
  assert.deepEqual(usage, {
    inputTokens: 1000,
    outputTokens: 500,
    cachedInputTokens: 200,
    reasoningTokens: 125,
    totalTokens: 1500
  });
  assert.equal(calculateEstimatedCost(usage, {
    inputPerMillionUsd: 1,
    cachedInputPerMillionUsd: 0.5,
    outputPerMillionUsd: 2
  }), 0.0019);
});

test('Groq rate headers and reset durations are normalized', () => {
  const now = new Date('2026-07-21T12:00:00.000Z');
  const headers = new Headers({
    'x-ratelimit-limit-requests': '1000',
    'x-ratelimit-remaining-requests': '250',
    'x-ratelimit-reset-requests': '1h2m3.5s',
    'x-ratelimit-limit-tokens': '8000',
    'x-ratelimit-remaining-tokens': '4000',
    'x-ratelimit-reset-tokens': '750ms',
    'x-request-id': 'groq-request-1'
  });
  const parsed = parseRateLimitHeaders(headers, now);
  assert.equal(parsed.requestLimitDaily, 1000);
  assert.equal(parsed.requestRemainingDaily, 250);
  assert.equal(parsed.tokenRemainingMinute, 4000);
  assert.equal(parsed.requestResetAt.toISOString(), '2026-07-21T13:02:03.500Z');
  assert.equal(parsed.tokenResetAt.toISOString(), '2026-07-21T12:00:00.750Z');
  assert.equal(parsed.providerRequestId, 'groq-request-1');
  assert.equal(parseDurationMs('2m30s'), 150000);
  assert.equal(utcDay(now).toISOString(), '2026-07-21T00:00:00.000Z');
});

test('quota counters use atomic window-aware update expressions', () => {
  const observedAt = new Date('2026-07-21T12:34:56.000Z');
  const update = buildQuotaSnapshotSet({
    createdAt: observedAt,
    totalTokens: 42,
    status: 'success',
    rateLimit: { requestLimitDaily: 1000, requestRemainingDaily: 900 }
  }, observedAt);
  assert.deepEqual(update.localRequestsToday.$cond[1], {
    $add: [{ $ifNull: ['$localRequestsToday', 0] }, 1]
  });
  assert.deepEqual(update.localTokensMinute.$cond[1], {
    $add: [{ $ifNull: ['$localTokensMinute', 0] }, 42]
  });
  assert.equal(update.localDay.toISOString(), '2026-07-21T00:00:00.000Z');
  assert.equal(update.localMinute.toISOString(), '2026-07-21T12:34:00.000Z');
  assert.equal(update.requestRemainingDaily, 900);
  assert.deepEqual(update.blockedUntil, {
    $cond: [{ $gt: ['$blockedUntil', observedAt] }, '$blockedUntil', null]
  });
});

test('JSON Schema validation covers strict objects and nested arrays', () => {
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'scores'],
    properties: {
      name: { type: 'string', minLength: 2 },
      scores: { type: 'array', minItems: 1, items: { type: 'number', minimum: 0, maximum: 5 } }
    }
  };
  assert.equal(validateJsonSchema({ name: 'Ada', scores: [5, 4] }, schema).valid, true);
  const invalid = validateJsonSchema({ name: 'A', scores: [8], extra: true }, schema);
  assert.equal(invalid.valid, false);
  assert.equal(invalid.errors.length, 3);
});

test('AsyncLocalStorage propagates and overrides AI request dimensions', async () => {
  await runWithAIRequestContext({ sourceApp: 'recruiter', organizationId: 'org-1' }, async () => {
    await Promise.resolve();
    assert.deepEqual(getAIRequestContext({ actorId: 'user-1' }), {
      sourceApp: 'recruiter', organizationId: 'org-1', actorId: 'user-1'
    });
  });
  assert.deepEqual(getAIRequestContext(), {});
});

function createResponseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

test('internal gateway accepts exact HMAC signatures and rejects stale or unknown services', () => {
  const now = 1784635200000;
  const secret = 'test-hmac-secret';
  const body = JSON.stringify({ activity: 'ai_interview.scoring' });
  const timestamp = String(now);
  const path = '/api/internal/ai/v1/complete';
  const canonical = [timestamp, 'ai-interview', 'POST', path, body].join('\n');
  const signature = crypto.createHmac('sha256', secret).update(canonical).digest('hex');
  const middleware = createInternalServiceAuth({
    env: { AI_GATEWAY_HMAC_SECRET: secret, AI_GATEWAY_ALLOWED_SERVICES: 'ai-interview' },
    now: () => now
  });
  const request = {
    method: 'POST', originalUrl: path, rawBody: Buffer.from(body),
    get(name) { return ({ 'x-seemplify-service': 'ai-interview', 'x-seemplify-timestamp': timestamp, 'x-seemplify-signature': signature })[name]; }
  };
  let nextCalled = false;
  middleware(request, createResponseRecorder(), () => { nextCalled = true; });
  assert.equal(nextCalled, true);

  const stale = createResponseRecorder();
  middleware({ ...request, get(name) { return ({ 'x-seemplify-service': 'ai-interview', 'x-seemplify-timestamp': String(now - 600000), 'x-seemplify-signature': signature })[name]; } }, stale, () => {});
  assert.equal(stale.statusCode, 401);

  const forbidden = createResponseRecorder();
  middleware({ ...request, get(name) { return ({ 'x-seemplify-service': 'unknown', 'x-seemplify-timestamp': timestamp, 'x-seemplify-signature': signature })[name]; } }, forbidden, () => {});
  assert.equal(forbidden.statusCode, 403);
});

test('admin permission boundaries keep secrets super-admin only', () => {
  const denied = createResponseRecorder();
  requirePermission('systemSettings')({ admin: { role: 'admin', permissions: {} } }, denied, () => {});
  assert.equal(denied.statusCode, 403);

  let allowed = false;
  requirePermission('systemSettings')({ admin: { role: 'admin', permissions: { systemSettings: true } } }, createResponseRecorder(), () => { allowed = true; });
  assert.equal(allowed, true);

  const secretDenied = createResponseRecorder();
  requireSuperAdmin({ admin: { role: 'admin' } }, secretDenied, () => {});
  assert.equal(secretDenied.statusCode, 403);
  requireSuperAdmin({ admin: { role: 'super_admin' } }, createResponseRecorder(), () => { allowed = true; });
  assert.equal(allowed, true);
});

test('default catalog covers all declared activities with Groq routes', () => {
  const settings = createDefaultRuntimeSettings();
  assert.ok(settings.routes.length >= 25);
  assert.equal(settings.routes.every((route) => route.provider === 'groq'), true);
  assert.equal(settings.models.some((model) => model.id === 'openai/gpt-oss-120b'), true);
  assert.equal(settings.models.some((model) => model.id === 'openai/gpt-oss-20b'), true);
  assert.deepEqual(settings.rollout, {
    groqPercent: 100,
    azureBaselineEnabled: false,
    samplingSalt: 'groq-gpt-oss-v1'
  });
});

test('fresh bootstrap starts at the deterministic ten percent canary', () => {
  assert.deepEqual(createBootstrapSettings({}).rollout, {
    groqPercent: 10,
    azureBaselineEnabled: true,
    samplingSalt: 'groq-gpt-oss-v1'
  });
  assert.equal(createBootstrapSettings({ GROQ_BOOTSTRAP_ROLLOUT_PERCENT: '100' }).rollout.azureBaselineEnabled, false);
  assert.throws(() => createBootstrapSettings({ GROQ_BOOTSTRAP_ROLLOUT_PERCENT: '25' }));
});

test('runtime seed merges catalog updates without overwriting admin routing', () => {
  const defaults = createDefaultRuntimeSettings();
  const merged = mergeCatalogSettings({
    providerEnabled: false,
    models: [{
      ...defaults.models[0],
      enabled: false,
      available: true,
      pricing: { inputPerMillionUsd: 999 }
    }],
    routes: [{ ...defaults.routes[0], model: 'openai/gpt-oss-20b', routeVersion: 7 }],
    quotaGroups: [{ id: 'existing', label: 'Existing', enabled: true }],
    alerts: { recipients: ['ops@example.com'] },
    rollout: { groqPercent: 50, azureBaselineEnabled: true, samplingSalt: 'existing-salt' }
  }, defaults);
  assert.equal(merged.providerEnabled, false);
  assert.equal(merged.models[0].enabled, false);
  assert.equal(merged.models[0].available, true);
  assert.deepEqual(merged.models[0].pricing, defaults.models[0].pricing);
  assert.equal(merged.models.length, defaults.models.length);
  assert.equal(merged.routes[0].model, 'openai/gpt-oss-20b');
  assert.equal(merged.routes[0].routeVersion, 7);
  assert.equal(merged.routes.length, defaults.routes.length);
  assert.deepEqual(merged.alerts.recipients, ['ops@example.com']);
  assert.equal(merged.rollout.groqPercent, 50);
  assert.equal(merged.rollout.samplingSalt, 'existing-salt');
});

test('bootstrap replaces only an untouched auto-created Groq-only rollout', () => {
  const runtimeDefaults = createDefaultRuntimeSettings();
  const bootstrapDefaults = createBootstrapSettings({});
  const merged = mergeCatalogSettings(runtimeDefaults, bootstrapDefaults);
  assert.equal(merged.rollout.groqPercent, 10);
  assert.equal(merged.rollout.azureBaselineEnabled, true);

  const completed = mergeCatalogSettings({
    ...runtimeDefaults,
    updatedBy: 'admin-1',
    rollout: { ...runtimeDefaults.rollout, updatedAt: new Date(), updatedBy: 'admin-1' }
  }, bootstrapDefaults);
  assert.equal(completed.rollout.groqPercent, 100);
  assert.equal(completed.rollout.azureBaselineEnabled, false);
});

test('alert reservations are protected by a unique sparse dedupe key', () => {
  const dedupeIndex = AIAuditEvent.schema.indexes().find(([fields]) => fields.dedupeKey === 1);
  assert.ok(dedupeIndex);
  assert.equal(dedupeIndex[1].unique, true);
  assert.equal(dedupeIndex[1].sparse, true);
});

test('interview scoring retries back off without becoming permanently failed', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 10].map(retryDelayMinutes), [2, 4, 8, 16, 32, 32]);
});
