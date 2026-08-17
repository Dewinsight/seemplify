'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const {
  validateChatGptUsageEnvelope,
  verifyAndClaimChatGptUsageSignature
} = require('../services/aiRuntime/chatGptUsageIngestionService');

test('ChatGPT usage ingestion preserves connected-account ownership', () => {
  const eventId = `usage_${'a'.repeat(48)}`;
  const event = validateChatGptUsageEnvelope({
    schemaVersion: 1,
    event: {
      eventId,
      gatewayExecutionId: `chatgptexec_${crypto.createHash('sha256').update(eventId).digest('hex').slice(0, 48)}`,
      requestId: 'request-1',
      sourceApp: 'messaging',
      runtimeOwner: 'user',
      actorName: 'Michael Egbo',
      actorEmail: 'michael.egbo@dewinsight.com',
      activity: 'messaging.chat',
      provider: 'chatgpt-connect',
      model: 'gpt-5.6-sol',
      status: 'success',
      usageReported: false,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      occurredAt: '2026-08-17T18:59:10.000Z'
    }
  });

  assert.equal(event.runtimeOwner, 'user');
  assert.equal(event.actorName, 'Michael Egbo');
  assert.equal(event.actorEmail, 'michael.egbo@dewinsight.com');
});

test('ChatGPT usage ingestion claims its nonce in shared replay storage', async () => {
  const secret = 'rotated-chatgpt-request-secret';
  const now = 1786276800000;
  const timestamp = String(now);
  const nonce = 'chatgpt-usage-nonce-0001';
  const requestPath = '/api/internal/ai/v1/chatgpt-usage/events';
  const rawBody = JSON.stringify({ schemaVersion: 1, event: {} });
  const signature = crypto.createHmac('sha256', secret)
    .update(`${timestamp}\n${nonce}\nPOST\n${requestPath}\n${rawBody}`)
    .digest('base64url');
  const input = {
    headers: {
      'x-seemplify-timestamp': timestamp,
      'x-seemplify-nonce': nonce,
      'x-seemplify-signature': signature
    },
    method: 'POST', requestPath, rawBody, secret, now
  };
  const claims = new Set();
  const claimNonce = async key => !claims.has(key) && Boolean(claims.add(key));
  assert.equal((await verifyAndClaimChatGptUsageSignature(input, { claimNonce })).ok, true);
  const replay = await verifyAndClaimChatGptUsageSignature(input, { claimNonce });
  assert.equal(replay.ok, false);
  assert.equal(replay.code, 'CHATGPT_USAGE_REPLAY_REJECTED');
});
