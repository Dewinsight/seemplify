'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const account = require('../services/chatGptAccountService');
const shared = require('../services/sharedAIAccountService');
test('Performance model settings display Terra inheritance and preserve explicit personal choices', async t => {
  t.mock.method(shared, 'preferences', async () => ({ activities: [
    { app: 'performance', activity: 'performance.general', adminDefault: { codexModel: 'gpt-5.6-sol' }, effective: { codexModel: 'gpt-5.6-sol' }, provenance: { codexModel: 'admin_default' } },
    { app: 'performance', activity: 'performance.meeting.analysis', effective: { codexModel: 'gpt-5.6-luna' }, provenance: { codexModel: 'activity_override' } },
    { app: 'recruiter', activity: 'recruiter.general' }
  ] }));
  const preferences = await account.readPreferences({ sub: 'own-person', email: 'own@example.test' });
  assert.equal(preferences.activities.length, 2);
  assert.equal(preferences.activities[0].effective.codexModel, 'gpt-5.6-terra');
  assert.equal(preferences.activities[1].effective.codexModel, 'gpt-5.6-luna');
});
