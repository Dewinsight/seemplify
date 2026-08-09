'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { validateAdminRoutePreference } = require('../services/aiRuntime/adminModelCatalogService');

const models = [
  {
    id: 'gpt-sol',
    supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'medium' }, { reasoningEffort: 'high' }]
  },
  {
    id: 'gpt-terra',
    supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'medium' }]
  }
];

test('admin partial model update validates the final model and persisted effort pair', () => {
  assert.throws(
    () => validateAdminRoutePreference(
      { codexModel: 'gpt-sol', reasoningEffort: 'high' },
      { codexModel: 'gpt-terra' },
      models
    ),
    (error) => error.code === 'CHATGPT_REASONING_NOT_SUPPORTED'
  );
});

test('admin partial effort update validates against the persisted model', () => {
  assert.throws(
    () => validateAdminRoutePreference(
      { codexModel: 'gpt-terra', reasoningEffort: 'medium' },
      { reasoningEffort: 'high' },
      models
    ),
    (error) => error.code === 'CHATGPT_REASONING_NOT_SUPPORTED'
  );
});

test('admin route rejects unavailable models and accepts full supported effort set values', () => {
  assert.throws(
    () => validateAdminRoutePreference(
      { codexModel: 'gpt-sol', reasoningEffort: 'medium' },
      { codexModel: 'missing' },
      models
    ),
    (error) => error.code === 'CHATGPT_MODEL_NOT_AVAILABLE'
  );
  assert.deepEqual(
    validateAdminRoutePreference(
      { codexModel: 'gpt-sol', reasoningEffort: 'medium' },
      { reasoningEffort: 'low' },
      models
    ),
    { codexModel: 'gpt-sol', reasoningEffort: 'low' }
  );
});
