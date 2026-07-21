const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_PLATFORM_FEATURE_FLAGS,
  normalizePlatformFeatureFlags,
  validatePlatformFeatureUpdates
} = require('../config/platformFeatures');
const {
  getPlatformFeatureSettings,
  updatePlatformFeatureSettings,
  resetPlatformFeatureCache
} = require('../services/platformFeatureService');
const PlatformSettings = require('../models/PlatformSettings');
const { createRequireFeature } = require('../middleware/featureFlagMiddleware');
const { allowFeatureUpgrade } = require('../middleware/websocketFeatureGuard');

function createSettingsModel(initialDocument = null) {
  let document = initialDocument;

  return {
    findOne() {
      return { lean: async () => document };
    },
    findOneAndUpdate(filter, update) {
      return {
        lean: async () => {
          const featureFlags = { ...(document?.featureFlags || {}) };
          for (const [path, value] of Object.entries(update.$set)) {
            if (path.startsWith('featureFlags.')) {
              featureFlags[path.slice('featureFlags.'.length)] = value;
            }
          }
          document = {
            key: filter.key,
            featureFlags,
            updatedBy: update.$set.updatedBy,
            updatedAt: new Date('2026-07-21T12:00:00.000Z')
          };
          return document;
        }
      };
    }
  };
}

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    }
  };
}

test('platform features default to enabled and retain stored boolean values', () => {
  assert.deepEqual(normalizePlatformFeatureFlags(), DEFAULT_PLATFORM_FEATURE_FLAGS);
  assert.deepEqual(normalizePlatformFeatureFlags({ aiInterviews: false, bulkCvUpload: true }), {
    ...DEFAULT_PLATFORM_FEATURE_FLAGS,
    aiInterviews: false,
    bulkCvUpload: true
  });
});

test('platform feature updates reject unknown keys and non-boolean values', () => {
  assert.throws(
    () => validatePlatformFeatureUpdates({ unknownFeature: false }),
    /Unknown platform feature/
  );
  assert.throws(
    () => validatePlatformFeatureUpdates({ aiInterviews: 'false' }),
    /must be true or false/
  );
});

test('updating one feature preserves every other platform feature', async () => {
  const settingsModel = createSettingsModel({
    featureFlags: { aiInterviews: false, peopleTransitions: false },
    updatedAt: null,
    updatedBy: null
  });

  const before = await getPlatformFeatureSettings({ settingsModel });
  assert.equal(before.features.aiInterviews, false);
  assert.equal(before.features.peopleTransitions, false);
  assert.equal(before.features.bulkCvUpload, true);

  const after = await updatePlatformFeatureSettings(
    { aiInterviews: true },
    'admin-id',
    { settingsModel }
  );

  assert.equal(after.features.aiInterviews, true);
  assert.equal(after.features.peopleTransitions, false);
  assert.equal(after.features.bulkCvUpload, true);
  assert.equal(after.updatedBy, 'admin-id');
});

test('default platform feature reads are cached and can be force refreshed', async () => {
  const originalFindOne = PlatformSettings.findOne;
  let reads = 0;
  PlatformSettings.findOne = () => ({
    lean: async () => {
      reads += 1;
      return { featureFlags: { aiInterviews: reads > 1 } };
    }
  });
  resetPlatformFeatureCache();

  try {
    const first = await getPlatformFeatureSettings();
    const cached = await getPlatformFeatureSettings();
    const refreshed = await getPlatformFeatureSettings({ forceRefresh: true });

    assert.equal(first.features.aiInterviews, false);
    assert.equal(cached.features.aiInterviews, false);
    assert.equal(refreshed.features.aiInterviews, true);
    assert.equal(reads, 2);
  } finally {
    PlatformSettings.findOne = originalFindOne;
    resetPlatformFeatureCache();
  }
});

test('feature middleware allows enabled requests and blocks disabled requests', async () => {
  let nextCalls = 0;
  const allow = createRequireFeature('aiInterviews', {
    loadFeatureSettings: async () => ({ features: { aiInterviews: true } })
  });
  await allow({}, createResponse(), () => { nextCalls += 1; });
  assert.equal(nextCalls, 1);

  const denyResponse = createResponse();
  const deny = createRequireFeature('aiInterviews', {
    loadFeatureSettings: async () => ({ features: { aiInterviews: false } })
  });
  await deny({}, denyResponse, () => { nextCalls += 1; });

  assert.equal(nextCalls, 1);
  assert.equal(denyResponse.statusCode, 403);
  assert.equal(denyResponse.body.code, 'FEATURE_DISABLED');
  assert.equal(denyResponse.body.feature, 'aiInterviews');
});

test('WebSocket upgrades are rejected when their platform feature is disabled', async () => {
  const writes = [];
  const socket = {
    destroyed: false,
    write(value) { writes.push(value); },
    destroy() { this.destroyed = true; }
  };

  const allowed = await allowFeatureUpgrade('aiAssistant', socket, {
    loadFeatureSettings: async () => ({ features: { aiAssistant: false } })
  });

  assert.equal(allowed, false);
  assert.equal(socket.destroyed, true);
  assert.match(writes.join(''), /403 Forbidden/);
});
