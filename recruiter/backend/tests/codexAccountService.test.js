const test = require('node:test');
const assert = require('node:assert/strict');

const AIUserRuntimeAccount = require('../models/AIUserRuntimeAccount');
const codexAccountService = require('../services/aiRuntime/codexAccountService');

test('a transient hosted-gateway outage never disconnects a verified account', async () => {
  const originalFindOne = AIUserRuntimeAccount.findOne;
  const originalUrl = process.env.CHATGPT_GATEWAY_BASE_URL;
  const originalSecret = process.env.CHATGPT_GATEWAY_SHARED_SECRET;
  const account = {
    user: '507f191e810c19729de860ea',
    organization: '507f191e810c19729de860eb',
    status: 'connected',
    lastError: '',
    isRoutable() { return this.status === 'connected'; },
    async save() { return this; }
  };
  AIUserRuntimeAccount.findOne = async () => account;
  process.env.CHATGPT_GATEWAY_BASE_URL = 'http://hosted-gateway.test:11435';
  process.env.CHATGPT_GATEWAY_SHARED_SECRET = 'hosted-test-secret';

  try {
    const result = await codexAccountService.readAccount(
      { id: account.user },
      { fetchImpl: async () => { throw new Error('rolling deployment'); } }
    );
    assert.equal(result.status, 'connected');
    assert.equal(result.isRoutable(), true);
    assert.match(result.lastError, /gateway is unreachable/i);
  } finally {
    AIUserRuntimeAccount.findOne = originalFindOne;
    if (originalUrl === undefined) delete process.env.CHATGPT_GATEWAY_BASE_URL;
    else process.env.CHATGPT_GATEWAY_BASE_URL = originalUrl;
    if (originalSecret === undefined) delete process.env.CHATGPT_GATEWAY_SHARED_SECRET;
    else process.env.CHATGPT_GATEWAY_SHARED_SECRET = originalSecret;
  }
});
