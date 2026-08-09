'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const {
  deriveLocalExecutionId,
  ingestLocalUsageEnvelope,
  validateLocalUsageEnvelope,
  verifyAndClaimLocalUsageSignature
} = require('../services/aiRuntime/localUsageIngestionService');

const SECRET = 'local-runtime-shared-secret';
const NOW = 1786276800000;

function envelope(overrides = {}) {
  const eventId = `usage_${'a'.repeat(48)}`;
  return {
    schemaVersion: 1,
    event: {
      eventId,
      gatewayExecutionId: deriveLocalExecutionId(eventId),
      requestId: 'request-local-1',
      sourceApp: 'performance-management',
      organizationId: 'idp-org-a',
      organizationName: 'Organization A',
      actorId: 'idp-subject-a',
      activity: 'performance.general',
      provider: 'local-claude-code',
      model: 'claude-sonnet',
      status: 'success',
      inputTokens: 10,
      cachedInputTokens: 2,
      outputTokens: 5,
      reasoningTokens: 1,
      totalTokens: 15,
      usageReported: true,
      occurredAt: new Date(NOW).toISOString(),
      ...overrides
    }
  };
}

function signedRequest(body, nonce = 'local-usage-nonce-000001') {
  const timestamp = String(NOW);
  const requestPath = '/api/internal/ai/v1/local-usage/events';
  return {
    headers: {
      'x-seemplify-timestamp': timestamp,
      'x-seemplify-nonce': nonce,
      'x-seemplify-signature': crypto.createHmac('sha256', SECRET)
        .update(`${timestamp}\n${nonce}\nPOST\n${requestPath}\n${body}`)
        .digest('base64url')
    },
    method: 'POST', requestPath, rawBody: body, secret: SECRET, now: NOW
  };
}

test('local usage signatures use a shared atomic replay claim', async () => {
  const claimed = new Set();
  const claimNonce = async key => !claimed.has(key) && Boolean(claimed.add(key));
  const body = JSON.stringify(envelope());
  assert.equal((await verifyAndClaimLocalUsageSignature(signedRequest(body), { claimNonce })).ok, true);
  const replay = await verifyAndClaimLocalUsageSignature(signedRequest(body), { claimNonce });
  assert.equal(replay.ok, false);
  assert.equal(replay.code, 'LOCAL_USAGE_REPLAY_REJECTED');
  assert.equal(replay.statusCode, 409);
});

test('local usage validates provider/execution identity and records canonical actor/org/source dimensions', async () => {
  const payload = envelope();
  assert.equal(validateLocalUsageEnvelope(payload).provider, 'local-claude-code');
  let recorded;
  const result = await ingestLocalUsageEnvelope(payload, {
    recordUsageImpl: async input => { recorded = input; return {}; }
  });
  assert.equal(result.accepted, true);
  assert.equal(recorded.meteringOrigin, 'local-gateway-at-source');
  assert.equal(recorded.sourceApp, 'performance-management');
  assert.equal(recorded.actorId, 'idp-subject-a');
  assert.equal(recorded.organizationId, 'idp-org-a');
  assert.equal(recorded.usage.total_tokens, 15);
  assert.throws(() => validateLocalUsageEnvelope(envelope({
    gatewayExecutionId: `localexec_${'b'.repeat(48)}`
  })), /execution identity/);
  assert.throws(() => validateLocalUsageEnvelope(envelope({ provider: 'chatgpt-connect' })), /provider metadata/);
});
