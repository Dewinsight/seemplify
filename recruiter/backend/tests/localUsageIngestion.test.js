const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { afterEach, test } = require('node:test');
const {
  ingestLocalUsageEnvelope,
  resetLocalUsageNonceStoreForTests,
  validateLocalUsageEnvelope,
  verifyLocalUsageSignature
} = require('../services/aiRuntime/localUsageIngestionService');

const secret = 'hosted-local-usage-secret';
const requestPath = '/api/internal/ai/v1/local-usage/events';

function envelope(overrides = {}) {
  const eventId = overrides.eventId || `usage_${'b'.repeat(48)}`;
  return {
    schemaVersion: 1,
    event: {
      eventId,
      gatewayExecutionId: `localexec_${crypto.createHash('sha256').update(eventId).digest('hex').slice(0, 48)}`,
      requestId: 'opaque-request-1',
      sourceApp: 'recruiter',
      activity: 'candidate.cv_parse',
      provider: 'local-codex',
      model: 'gpt-5.6-terra',
      providerRequestId: 'terra-provider-1',
      status: 'success',
      httpStatus: 200,
      latencyMs: 800,
      usageReported: true,
      usageSource: 'codex-response',
      inputTokens: 1000,
      cachedInputTokens: 600,
      outputTokens: 100,
      reasoningTokens: 25,
      totalTokens: 1100,
      occurredAt: '2026-07-25T10:00:00.000Z',
      ...overrides
    }
  };
}

function signedHeaders(rawBody, { now = Date.now(), nonce = 'nonce_abcdefghijklmnop' } = {}) {
  const timestamp = String(now);
  const signature = crypto.createHmac('sha256', secret)
    .update(`${timestamp}\n${nonce}\nPOST\n${requestPath}\n${rawBody}`)
    .digest('base64url');
  return {
    'x-seemplify-timestamp': timestamp,
    'x-seemplify-nonce': nonce,
    'x-seemplify-signature': signature
  };
}

afterEach(() => resetLocalUsageNonceStoreForTests());

test('hosted ingestion accepts an exact signature once and rejects replay', () => {
  const rawBody = JSON.stringify(envelope());
  const headers = signedHeaders(rawBody);
  const first = verifyLocalUsageSignature({
    headers,
    rawBody,
    secret,
    requestPath
  });
  const replay = verifyLocalUsageSignature({
    headers,
    rawBody,
    secret,
    requestPath
  });
  assert.equal(first.ok, true);
  assert.equal(replay.code, 'LOCAL_USAGE_REPLAY_REJECTED');
});

test('hosted ingestion rejects expired and tampered requests', () => {
  const now = Date.now();
  const rawBody = JSON.stringify(envelope());
  const expired = verifyLocalUsageSignature({
    headers: signedHeaders(rawBody, { now: now - 6 * 60_000 }),
    rawBody,
    secret,
    requestPath,
    now
  });
  const tampered = verifyLocalUsageSignature({
    headers: signedHeaders(rawBody, { now, nonce: 'nonce_tamper_abcdefghijkl' }),
    rawBody: `${rawBody} `,
    secret,
    requestPath,
    now
  });
  assert.equal(expired.code, 'LOCAL_USAGE_SIGNATURE_EXPIRED');
  assert.equal(tampered.code, 'LOCAL_USAGE_SIGNATURE_INVALID');
});

test('ingestion maps operational identity but never request content into the authoritative usage write', async () => {
  let recorded;
  const payload = envelope({
    candidateName: 'Must not be copied',
    cvText: 'Must not be copied',
    organizationName: 'Acme Ltd',
    actorId: 'user-1',
    actorName: 'Ada User',
    actorEmail: 'ada@example.test'
  });
  const result = await ingestLocalUsageEnvelope(payload, {
    recordUsageImpl: async (event) => {
      recorded = event;
      return { duplicate: false, reconciled: false };
    }
  });

  assert.equal(result.accepted, true);
  assert.equal(recorded.meteringOrigin, 'local-gateway-at-source');
  assert.equal(recorded.atSourceOnly, true);
  assert.equal(recorded.usage.prompt_tokens, 1000);
  assert.equal(recorded.usage.prompt_tokens_details.cached_tokens, 600);
  assert.equal(recorded.usage.completion_tokens, 100);
  assert.equal(recorded.usage.completion_tokens_details.reasoning_tokens, 25);
  assert.equal(recorded.candidateName, undefined);
  assert.equal(recorded.cvText, undefined);
  assert.equal(recorded.organizationName, 'Acme Ltd');
  assert.equal(recorded.actorId, 'user-1');
  assert.equal(recorded.actorName, 'Ada User');
  assert.equal(recorded.actorEmail, 'ada@example.test');
});

test('ingestion accepts Claude Code local-cloud usage metadata', () => {
  const event = validateLocalUsageEnvelope(envelope({
    provider: 'local-claude',
    model: 'sonnet',
    providerRequestId: 'claude-provider-1',
    usageSource: 'claude-response'
  }));

  assert.equal(event.provider, 'local-claude');
  assert.equal(event.model, 'sonnet');
  assert.equal(event.usageSource, 'claude-response');
});

test('ingestion recognises Experience knowledge and assistant activities', () => {
  for (const activity of [
    'experience.knowledge_answer',
    'experience.knowledge_graph_extract',
    'experience.cross_source_intelligence',
    'experience.assistant.email_summarise',
    'experience.assistant.email_draft'
  ]) {
    assert.equal(validateLocalUsageEnvelope(envelope({ activity })).activity, activity);
  }
});

test('ingestion rejects forged execution IDs and inconsistent token composition', () => {
  assert.throws(
    () => validateLocalUsageEnvelope(envelope({ gatewayExecutionId: `localexec_${'0'.repeat(48)}` })),
    (error) => error.code === 'LOCAL_USAGE_EVENT_INVALID'
  );
  assert.throws(
    () => validateLocalUsageEnvelope(envelope({ cachedInputTokens: 1001 })),
    (error) => error.code === 'LOCAL_USAGE_EVENT_INVALID'
  );
  assert.throws(
    () => validateLocalUsageEnvelope(envelope({ totalTokens: 1099 })),
    (error) => error.code === 'LOCAL_USAGE_EVENT_INVALID'
  );
});
