'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const AIInterviewRuntimeAccount = require('../models/AIInterviewRuntimeAccount');
const service = require('../services/aiRuntime/interviewCodexAccountService');

function account() {
  return {
    session: '507f191e810c19729de87001',
    status: 'connected',
    connectedEmail: 'candidate@example.test',
    planType: 'pro',
    connectedAt: new Date(),
    dataSharingAcknowledgedAt: new Date(),
    credentialCleanup: { status: 'idle', attempts: 0 },
    saves: 0,
    async save() { this.saves += 1; return this; }
  };
}

test('terminal disconnect clears consent immediately and retries hosted credential deletion', async () => {
  const originalFindOne = AIInterviewRuntimeAccount.findOne;
  const originalFind = AIInterviewRuntimeAccount.find;
  const originalUrl = process.env.CHATGPT_GATEWAY_BASE_URL;
  const originalSecret = process.env.CHATGPT_GATEWAY_SHARED_SECRET;
  const runtimeAccount = account();
  AIInterviewRuntimeAccount.findOne = async () => runtimeAccount;
  process.env.CHATGPT_GATEWAY_BASE_URL = 'https://gateway.example.test';
  process.env.CHATGPT_GATEWAY_SHARED_SECRET = 'candidate-lifecycle-test-secret';

  try {
    await service.disconnect({ _id: runtimeAccount.session }, {
      terminal: true,
      reason: 'scoring_completed',
      fetchImpl: async () => { throw new Error('temporary outage'); }
    });

    assert.equal(runtimeAccount.status, 'disconnected');
    assert.equal(runtimeAccount.dataSharingAcknowledgedAt, null);
    assert.equal(runtimeAccount.credentialCleanup.status, 'pending');
    assert.equal(runtimeAccount.credentialCleanup.attempts, 1);
    assert.ok(runtimeAccount.credentialCleanup.nextAttemptAt instanceof Date);
    assert.ok(runtimeAccount.purgeAfter instanceof Date);

    AIInterviewRuntimeAccount.find = () => ({
      sort() { return this; },
      async limit() { return [runtimeAccount]; }
    });
    const processed = await service.processPendingCredentialCleanup(5, {
      fetchImpl: async () => new Response(JSON.stringify({ connected: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    });

    assert.equal(processed, 1);
    assert.equal(runtimeAccount.credentialCleanup.status, 'completed');
    assert.ok(runtimeAccount.credentialCleanup.completedAt instanceof Date);
    assert.equal(runtimeAccount.credentialCleanup.lastError, '');
  } finally {
    AIInterviewRuntimeAccount.findOne = originalFindOne;
    AIInterviewRuntimeAccount.find = originalFind;
    if (originalUrl === undefined) delete process.env.CHATGPT_GATEWAY_BASE_URL;
    else process.env.CHATGPT_GATEWAY_BASE_URL = originalUrl;
    if (originalSecret === undefined) delete process.env.CHATGPT_GATEWAY_SHARED_SECRET;
    else process.env.CHATGPT_GATEWAY_SHARED_SECRET = originalSecret;
  }
});

test('credential cleanup retry uses a bounded exponential delay', () => {
  const now = Date.UTC(2026, 7, 9, 12, 0, 0);
  assert.equal(service.cleanupRetryAt(1, now).getTime(), now + 2 * 60_000);
  assert.equal(service.cleanupRetryAt(99, now).getTime(), now + 60 * 60_000);
});
