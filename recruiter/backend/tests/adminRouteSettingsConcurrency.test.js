'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createDefaultRuntimeSettings } = require('../config/aiRuntimeCatalog');
const { updateAdminActivityRoute } = require('../services/aiRuntime/adminRouteSettingsService');

function fakeSettingsModel() {
  const store = structuredClone(createDefaultRuntimeSettings());
  return {
    store,
    findOne() {
      const snapshot = structuredClone(store);
      return { lean: async () => snapshot };
    },
    async updateOne(filter, update) {
      if (Number(filter.version) !== Number(store.version)) return { modifiedCount: 0 };
      store.routes = structuredClone(update.$set.routes);
      store.version += Number(update.$inc.version || 0);
      return { modifiedCount: 1 };
    }
  };
}

test('concurrent admin changes to different activities are merged instead of clobbered', async () => {
  const model = fakeSettingsModel();
  const [firstActivity, secondActivity] = model.store.routes.slice(0, 2).map((route) => route.activity);

  await Promise.all([
    updateAdminActivityRoute({ settingsModel: model, activity: firstActivity, changes: { enabled: false } }),
    updateAdminActivityRoute({ settingsModel: model, activity: secondActivity, changes: { enabled: false } })
  ]);

  assert.equal(model.store.routes.find((route) => route.activity === firstActivity).enabled, false);
  assert.equal(model.store.routes.find((route) => route.activity === secondActivity).enabled, false);
  assert.equal(model.store.version, createDefaultRuntimeSettings().version + 2);
});
