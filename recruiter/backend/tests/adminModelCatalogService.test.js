'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adminModelCatalog, cleanModels } = require('../services/aiRuntime/adminModelCatalogService');

test('cleanModels returns unique visible model options', () => {
  assert.deepEqual(cleanModels([
    { id: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol', isDefault: true, defaultReasoningEffort: 'medium' },
    { id: 'gpt-5.6-sol', displayName: 'Duplicate' },
    { id: 'hidden', displayName: 'Hidden', hidden: true },
    { id: 'gpt-5.6-terra', displayName: 'GPT-5.6 Terra', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] }
  ]), [
    {
      id: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol', isDefault: true,
      defaultReasoningEffort: 'medium', supportedReasoningEfforts: []
    },
    {
      id: 'gpt-5.6-terra', displayName: 'GPT-5.6 Terra', isDefault: false,
      defaultReasoningEffort: null, supportedReasoningEfforts: [{ reasoningEffort: 'low' }]
    }
  ]);
});

test('adminModelCatalog loads models from the matching connected Recruiter account', async () => {
  const result = await adminModelCatalog({ email: 'Admin@Example.com' }, {
    findUserByEmail: async (email) => {
      assert.equal(email, 'admin@example.com');
      return { _id: 'user-1' };
    },
    findRuntimeAccount: async (userId) => {
      assert.equal(userId, 'user-1');
      return { status: 'connected' };
    },
    listModels: async (user) => {
      assert.equal(user.id, 'user-1');
      return [{ id: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol' }];
    }
  });

  assert.equal(result.available, true);
  assert.equal(result.models[0].id, 'gpt-5.6-sol');
  assert.equal(result.message, null);
});

test('adminModelCatalog explains when the matching account is not connected', async () => {
  const result = await adminModelCatalog({ email: 'admin@example.com' }, {
    findUserByEmail: async () => ({ id: 'user-1' }),
    findRuntimeAccount: async () => ({ status: 'disconnected' }),
    listModels: async () => { throw new Error('should not run'); }
  });

  assert.equal(result.available, false);
  assert.deepEqual(result.models, []);
  assert.match(result.message, /Connect ChatGPT/);
});
