'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { verifyAndClaimChatGptUsageSignature } = require('../services/aiRuntime/chatGptUsageIngestionService');

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
