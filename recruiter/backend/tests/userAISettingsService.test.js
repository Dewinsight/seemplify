'use strict';

const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const test = require('node:test');

const AIUserRuntimeAccount = require('../models/AIUserRuntimeAccount');
const { ACTIVITY_DEFINITIONS } = require('../config/aiRuntimeCatalog');
const aiRuntimeService = require('../services/aiRuntime/aiRuntimeService');
const codexAccountService = require('../services/aiRuntime/codexAccountService');
const {
  PROVENANCE,
  buildPreferences,
  deletePreference,
  normalizeUpdate,
  resolveActivityPreference,
  validateUpdate,
  writePreference
} = require('../services/aiRuntime/userAISettingsService');

const models = [{
  id: 'gpt-5.6-sol',
  displayName: 'GPT-5.6 Sol',
  supportedReasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max']
}, {
  id: 'gpt-5.6-terra',
  displayName: 'GPT-5.6 Terra',
  supportedReasoningEfforts: [{ reasoningEffort: 'none' }, { reasoningEffort: 'low' }, { reasoningEffort: 'medium' }]
}];

function route(activity = 'job.description', overrides = {}) {
  return {
    activity,
    codexModel: 'gpt-5.6-sol',
    reasoningEffort: 'medium',
    enabled: true,
    ...overrides
  };
}

test('preference resolution is field-aware and reports provenance', () => {
  const account = {
    aiDefaults: { codexModel: 'gpt-5.6-terra', reasoningEffort: null },
    activityOverrides: [{ activity: 'job.description', codexModel: null, reasoningEffort: 'high' }]
  };
  const resolved = resolveActivityPreference('job.description', route(), account);
  assert.deepEqual(resolved.effective, { codexModel: 'gpt-5.6-terra', reasoningEffort: 'high' });
  assert.deepEqual(resolved.provenance, {
    codexModel: PROVENANCE.ACCOUNT,
    reasoningEffort: PROVENANCE.ACTIVITY
  });
});

test('shared preferences include Performance activities and context-free defaults stay nullable', () => {
  const account = { aiDefaults: {}, activityOverrides: [] };
  const settings = { routes: [route('performance.general', { reasoningEffort: 'low' })] };
  const payload = buildPreferences({ settings, account, models });
  const performance = payload.activities.find((item) => item.activity === 'performance.general');
  assert.equal(ACTIVITY_DEFINITIONS['performance.general'].app, 'performance');
  assert.equal(performance.app, 'performance');
  assert.deepEqual(payload.defaults.effective, { codexModel: null, reasoningEffort: null });
  assert.equal(performance.effective.reasoningEffort, 'low');
  assert.equal(performance.provenance.reasoningEffort, PROVENANCE.ADMIN);
  assert.ok(payload.models[0].supportedReasoningEfforts.length > 0);
});

test('only models and efforts advertised by the connected account are accepted', () => {
  const settings = { routes: [route()] };
  const account = { aiDefaults: {}, activityOverrides: [] };
  assert.throws(
    () => validateUpdate({ scope: 'activity', activity: 'job.description', codexModel: 'missing', reasoningEffort: null }, models, settings, account),
    (error) => error.code === 'CHATGPT_MODEL_NOT_AVAILABLE'
  );
  assert.throws(
    () => validateUpdate({ scope: 'activity', activity: 'job.description', codexModel: 'gpt-5.6-terra', reasoningEffort: 'high' }, models, settings, account),
    (error) => error.code === 'CHATGPT_REASONING_NOT_SUPPORTED'
  );
  assert.doesNotThrow(() => validateUpdate(
    { scope: 'activity', activity: 'job.description', codexModel: 'gpt-5.6-sol', reasoningEffort: 'max' },
    models,
    settings,
    account
  ));
});

test('model and effort validation checks the final merged activity pair', () => {
  const settings = { routes: [route()] };
  assert.throws(
    () => validateUpdate(
      normalizeUpdate({ scope: 'activity', activity: 'job.description', codexModel: 'gpt-5.6-terra' }),
      models,
      settings,
      {
        aiDefaults: {},
        activityOverrides: [{ activity: 'job.description', codexModel: 'gpt-5.6-sol', reasoningEffort: 'high' }]
      }
    ),
    (error) => error.code === 'CHATGPT_REASONING_NOT_SUPPORTED'
  );
  assert.throws(
    () => validateUpdate(
      normalizeUpdate({ scope: 'activity', activity: 'job.description', reasoningEffort: 'high' }),
      models,
      settings,
      {
        aiDefaults: {},
        activityOverrides: [{ activity: 'job.description', codexModel: 'gpt-5.6-terra', reasoningEffort: 'medium' }]
      }
    ),
    (error) => error.code === 'CHATGPT_REASONING_NOT_SUPPORTED'
  );
});

test('an account model update is rejected when its persisted default effort is unsupported', () => {
  assert.throws(
    () => validateUpdate(
      normalizeUpdate({ scope: 'default', codexModel: 'gpt-5.6-terra' }),
      models,
      { routes: Object.keys(ACTIVITY_DEFINITIONS).map((activity) => route(activity)) },
      { aiDefaults: { codexModel: 'gpt-5.6-sol', reasoningEffort: 'high' }, activityOverrides: [] }
    ),
    (error) => error.code === 'CHATGPT_REASONING_NOT_SUPPORTED'
  );
});

test('the persistence schema accepts the live-catalog reasoning superset', () => {
  const account = new AIUserRuntimeAccount({
    user: new mongoose.Types.ObjectId(),
    subjectKey: 'subject-key-settings-test',
    aiDefaults: { reasoningEffort: 'ultra' },
    activityOverrides: [{ activity: 'job.description', reasoningEffort: 'none' }]
  });
  assert.equal(account.validateSync(), undefined);
  assert.equal(normalizeUpdate({ scope: 'default', reasoningEffort: 'minimal' }).reasoningEffort, 'minimal');
  assert.equal(normalizeUpdate({ scope: 'default', reasoningEffort: 'max' }).reasoningEffort, 'max');
});

test('a disconnected user can clear an override without calling the model catalogue', async () => {
  const originalFindOne = AIUserRuntimeAccount.findOne;
  const originalFindOneAndUpdate = AIUserRuntimeAccount.findOneAndUpdate;
  const originalGetSettings = aiRuntimeService.getSettings;
  const originalListModels = codexAccountService.listModels;
  let modelCalls = 0;
  const account = {
    _id: new mongoose.Types.ObjectId(),
    __v: 0,
    status: 'disconnected',
    aiDefaults: {},
    activityOverrides: [{ activity: 'job.description', codexModel: 'gpt-5.6-sol', reasoningEffort: 'high' }],
    async save() { return this; }
  };
  AIUserRuntimeAccount.findOne = async () => account;
  AIUserRuntimeAccount.findOneAndUpdate = async (_filter, operation) => {
    Object.assign(account, operation.$set);
    account.__v += 1;
    return account;
  };
  aiRuntimeService.getSettings = async () => ({ routes: [route()] });
  codexAccountService.listModels = async () => { modelCalls += 1; throw new Error('must not be called'); };
  try {
    const payload = await deletePreference(
      { id: '507f191e810c19729de860e4' },
      { scope: 'activity', activity: 'job.description' }
    );
    assert.equal(account.activityOverrides.length, 0);
    assert.equal(modelCalls, 0);
    assert.deepEqual(payload.models, []);
  } finally {
    AIUserRuntimeAccount.findOne = originalFindOne;
    AIUserRuntimeAccount.findOneAndUpdate = originalFindOneAndUpdate;
    aiRuntimeService.getSettings = originalGetSettings;
    codexAccountService.listModels = originalListModels;
  }
});

test('versioned preference writes preserve concurrent Recruiter and Performance activity edits', async () => {
  const originalFindOne = AIUserRuntimeAccount.findOne;
  const originalFindOneAndUpdate = AIUserRuntimeAccount.findOneAndUpdate;
  const originalGetSettings = aiRuntimeService.getSettings;
  const originalListModels = codexAccountService.listModels;
  const id = new mongoose.Types.ObjectId();
  const state = {
    _id: id,
    __v: 0,
    user: new mongoose.Types.ObjectId(),
    status: 'connected',
    aiDefaults: {},
    activityOverrides: []
  };
  const snapshot = () => ({
    ...state,
    aiDefaults: { ...state.aiDefaults },
    activityOverrides: state.activityOverrides.map((item) => ({ ...item }))
  });
  let initialReads = 0;
  let releaseReads;
  const bothRead = new Promise((resolve) => { releaseReads = resolve; });
  AIUserRuntimeAccount.findOne = async () => {
    initialReads += 1;
    if (initialReads <= 2) {
      if (initialReads === 2) releaseReads();
      await bothRead;
    }
    return snapshot();
  };
  AIUserRuntimeAccount.findOneAndUpdate = async (filter, operation) => {
    if (Number(filter.__v) !== state.__v) return null;
    Object.assign(state, operation.$set);
    state.__v += Number(operation.$inc?.__v || 0);
    return snapshot();
  };
  aiRuntimeService.getSettings = async () => ({
    routes: Object.keys(ACTIVITY_DEFINITIONS).map((activity) => route(activity))
  });
  codexAccountService.listModels = async () => models;
  try {
    await Promise.all([
      writePreference({ id: state.user }, {
        scope: 'activity', activity: 'job.description', codexModel: 'gpt-5.6-sol', reasoningEffort: 'high'
      }),
      writePreference({ id: state.user }, {
        scope: 'activity', activity: 'performance.self_assessment.chat', codexModel: 'gpt-5.6-terra', reasoningEffort: 'medium'
      })
    ]);
    assert.deepEqual(
      state.activityOverrides.map((item) => item.activity).sort(),
      ['job.description', 'performance.self_assessment.chat']
    );
    assert.equal(state.__v, 2);
  } finally {
    AIUserRuntimeAccount.findOne = originalFindOne;
    AIUserRuntimeAccount.findOneAndUpdate = originalFindOneAndUpdate;
    aiRuntimeService.getSettings = originalGetSettings;
    codexAccountService.listModels = originalListModels;
  }
});
