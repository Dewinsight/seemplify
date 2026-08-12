'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');
const request = require('supertest');

const aiGatewayService = require('../services/aiGatewayService');
const chatGptAccountService = require('../services/chatGptAccountService');
const sharedAIAccountService = require('../services/sharedAIAccountService');
const aiAccountRoutes = require('../routes/aiAccount');

const sessionUser = {
  sub: 'idp-performance-user',
  email: 'person@example.test',
  currentOrganization: {
    id: 'org-performance', name: 'Performance Org', role: 'employee',
    appAccess: { mode: 'all', appIds: [] }
  },
  organizations: [{
    id: 'org-performance', name: 'Performance Org', role: 'employee',
    appAccess: { mode: 'all', appIds: [] }
  }],
  teams: []
};

function performancePreferences() {
  return {
    defaults: {
      override: { codexModel: null, reasoningEffort: null },
      effective: { codexModel: null, reasoningEffort: null },
      provenance: { codexModel: 'admin_default', reasoningEffort: 'admin_default' }
    },
    activities: [
      { activity: 'performance.review', app: 'performance', label: 'Review', group: 'Performance' },
      { activity: 'recruiter.job', app: 'recruiter', label: 'Job', group: 'Recruiter' }
    ],
    models: [{ id: 'gpt-test', displayName: 'GPT Test' }]
  };
}

function accountDocument() {
  const value = {
    status: 'connected', connectedEmail: 'person@example.test', routable: true,
    runtimePreference: 'chatgpt'
  };
  return { ...value, toPublicJSON: () => value };
}

function testApp(cookies = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { user: structuredClone(sessionUser) };
    req.cookies = cookies;
    next();
  });
  app.use('/api/ai-account', aiAccountRoutes);
  return app;
}

test('shared account state and preference mutations stay on the shared authority and expose only Performance activities', async () => {
  const originals = {
    status: sharedAIAccountService.status,
    preferences: sharedAIAccountService.preferences,
    writePreference: sharedAIAccountService.writePreference,
    deletePreference: sharedAIAccountService.deletePreference
  };
  const calls = [];
  const sharedResult = { account: accountDocument().toPublicJSON(), preferences: performancePreferences() };
  sharedAIAccountService.status = async (identity) => { calls.push(['status', identity]); return sharedResult; };
  sharedAIAccountService.preferences = async (identity) => { calls.push(['read', identity]); return performancePreferences(); };
  sharedAIAccountService.writePreference = async (identity, value) => { calls.push(['write', identity, value]); return performancePreferences(); };
  sharedAIAccountService.deletePreference = async (identity, value) => { calls.push(['delete', identity, value]); return performancePreferences(); };

  try {
    const state = await chatGptAccountService.readAccountState(sessionUser, { strict: true });
    const read = await chatGptAccountService.readPreferences(sessionUser);
    const written = await chatGptAccountService.writePreference(sessionUser, {
      scope: 'activity', activity: 'performance.review', codexModel: 'gpt-test'
    });
    const removed = await chatGptAccountService.deletePreference(sessionUser, {
      scope: 'activity', activity: 'performance.review'
    });

    for (const result of [state.preferences, read, written, removed]) {
      assert.deepEqual(result.activities.map((activity) => activity.activity), ['performance.review']);
    }
    assert.equal(state.account.status, 'connected');
    assert.equal(calls.length, 4);
    assert.deepEqual(calls[0][1], {
      sub: sessionUser.sub,
      email: sessionUser.email,
      organizationId: 'org-performance',
      organizationName: 'Performance Org'
    });
    assert.equal(calls[2][2].activity, 'performance.review');
  } finally {
    Object.assign(sharedAIAccountService, originals);
  }
});

test('Performance account routes return the envelope, policy, cookie preference, and working preference endpoints', async () => {
  const originals = {
    readAccountState: chatGptAccountService.readAccountState,
    readPreferences: chatGptAccountService.readPreferences,
    writePreference: chatGptAccountService.writePreference,
    deletePreference: chatGptAccountService.deletePreference,
    policy: aiGatewayService.policy
  };
  const preferences = {
    ...performancePreferences(),
    activities: performancePreferences().activities.filter((item) => item.app === 'performance')
  };
  const mutations = [];
  chatGptAccountService.readAccountState = async () => ({ account: accountDocument(), preferences });
  chatGptAccountService.readPreferences = async () => preferences;
  chatGptAccountService.writePreference = async (_user, value) => { mutations.push(['write', value]); return preferences; };
  chatGptAccountService.deletePreference = async (_user, value) => { mutations.push(['delete', value]); return preferences; };
  aiGatewayService.policy = async ({ organizationId }) => ({
    organizationId, localEnabled: true, chatgptEnabled: true, defaultRuntime: 'local'
  });

  try {
    const app = testApp({ performance_ai_runtime: 'chatgpt' });
    const accountResponse = await request(app).get('/api/ai-account').expect(200);
    assert.equal(accountResponse.body.success, true);
    assert.equal(accountResponse.body.data.account.status, 'connected');
    assert.equal(accountResponse.body.data.policy.organizationId, 'org-performance');
    assert.equal(accountResponse.body.data.runtimePreference, 'chatgpt');
    assert.deepEqual(accountResponse.body.data.preferences.activities.map((item) => item.activity), ['performance.review']);

    const readResponse = await request(app).get('/api/ai-account/preferences').expect(200);
    assert.equal(readResponse.body.success, true);
    assert.equal(readResponse.body.data.models[0].id, 'gpt-test');

    const update = { scope: 'activity', activity: 'performance.review', codexModel: 'gpt-test' };
    await request(app).put('/api/ai-account/preferences').send(update).expect(200);
    await request(app).delete('/api/ai-account/preferences').send({ scope: 'activity', activity: 'performance.review' }).expect(200);
    assert.deepEqual(mutations, [
      ['write', update],
      ['delete', { scope: 'activity', activity: 'performance.review' }]
    ]);
  } finally {
    Object.assign(chatGptAccountService, originals);
    aiGatewayService.policy = originals.policy;
  }
});
