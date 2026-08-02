import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { aiJsonSchemas } from '../src/aiSchemas.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-terra-signing-'));
const secretFile = path.join(root, 'secret'); const secret = 'terra-test-secret-that-is-long-enough'; fs.writeFileSync(secretFile, secret);
process.env.TERRA_GATEWAY_SHARED_SECRET_FILE = secretFile;
const { completeWithTerra, TerraError } = await import('../src/terraClient.js');
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; fs.rmSync(root, { recursive: true, force: true }); });

test('Experience schemas constrain confidence and strength to decimal unit values', () => {
  const insights = aiJsonSchemas.insights as any;
  assert.deepEqual(insights.properties.drivers.items.properties.strength, { type: 'number', minimum: 0, maximum: 1 });
  assert.deepEqual(insights.properties.forecast.properties.confidence, { type: 'number', minimum: 0, maximum: 1 });
  assert.deepEqual(insights.properties.healthScore, { type: 'number', minimum: 0, maximum: 100 });
  const social = aiJsonSchemas.socialListening as any;
  assert.equal(social.properties.mentions.items.required.includes('evidence'), true);
  assert.equal(social.properties.mentions.items.properties.evidence.minLength, 1);
  assert.equal(social.properties.themes.items.properties.evidence.minItems, 1);
  assert.equal(social.properties.themes.items.properties.evidence.items.minLength, 1);
  const combined = aiJsonSchemas.crossSourceIntelligence as any;
  const combinedEvidence = combined.properties.themes.items.properties.evidence;
  assert.equal(combinedEvidence.minItems, 1);
  assert.equal(combinedEvidence.items.properties.excerpt.minLength, 12);
  assert.equal(combinedEvidence.items.properties.relevance.minLength, 3);
});

test('signs Terra requests and supplies durable metering identity', async () => {
  const eventIds: string[] = [];
  const executionIds: string[] = [];
  const requestIds: string[] = [];
  const activities: string[] = [];
  globalThis.fetch = async (_url, init) => {
    const body = String(init?.body || ''); const headers = init?.headers as Record<string, string>;
    const expected = crypto.createHmac('sha256', secret).update(`${headers['x-seemplify-timestamp']}\n${headers['x-seemplify-nonce']}\nPOST\n/v1/complete\n${body}`).digest('base64url');
    assert.equal(headers['x-seemplify-signature'], expected);
    const payload = JSON.parse(body);
    activities.push(payload.activity);
    assert.equal(payload.executionMode, 'local-only');
    assert.equal(payload.runtimeProfile, 'experience-management');
    assert.match(payload.metering.eventId, /^usage_[a-f0-9]{48}$/);
    eventIds.push(payload.metering.eventId);
    assert.match(payload.metering.gatewayExecutionId, /^localexec_[a-f0-9]{48}$/);
    executionIds.push(payload.metering.gatewayExecutionId);
    requestIds.push(payload.metering.requestId);
    assert.equal(payload.metering.record, true);
    return new Response(JSON.stringify({ data: { answer: 'Grounded' }, runtimeProfile: 'experience-management', provider: 'local-codex', engine: 'codex', model: 'gpt-5.6-terra', usage: { total_tokens: 10 }, metrics: { latencyMs: 50 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const result = await completeWithTerra({ activity: 'experience.analyst_chat', requestId: 'job-1', messages: [{ role: 'user', content: 'Question' }] });
  assert.deepEqual(result.data, { answer: 'Grounded' });
  assert.equal(result.runtime.model, 'gpt-5.6-terra');
  await completeWithTerra({ activity: 'experience.analyst_chat', requestId: 'job-1', messages: [{ role: 'user', content: 'Question' }] });
  assert.equal(eventIds[0], eventIds[1], 'a retried durable job must keep one metering identity');
  assert.equal(executionIds[0], executionIds[1], 'automatic attempts must keep one gateway execution identity');
  await completeWithTerra({ activity: 'experience.analyst_chat', requestId: 'job-1', executionRevision: 1, messages: [{ role: 'user', content: 'Question' }] });
  assert.notEqual(eventIds[0], eventIds[2], 'an explicit retry must receive a new metering identity');
  assert.notEqual(executionIds[0], executionIds[2], 'an explicit retry must receive a new gateway execution identity');
  assert.deepEqual(requestIds.slice(0, 3), ['job-1', 'job-1', 'job-1'],
    'all provider executions must retain the logical durable job identity');
  await completeWithTerra({ activity: 'experience.social_listening', requestId: 'job-social', messages: [{ role: 'user', content: 'Mentions' }] });
  await completeWithTerra({ activity: 'experience.journey_mapping', requestId: 'job-journey', messages: [{ role: 'user', content: 'Journey brief' }] });
  assert.deepEqual(activities, ['experience.analyst_chat', 'experience.analyst_chat', 'experience.analyst_chat', 'experience.social_listening', 'experience.journey_mapping']);
});

test('rejects a successful gateway response that did not honor the Experience profile', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: { answer: 'Wrong runtime' },
    runtimeProfile: 'global',
    provider: 'local-codex',
    engine: 'codex',
    model: 'gpt-5.6-terra'
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  await assert.rejects(
    () => completeWithTerra({ activity: 'experience.analyst_chat', requestId: 'wrong-runtime', messages: [{ role: 'user', content: 'Question' }] }),
    (error: unknown) => error instanceof TerraError
      && error.code === 'EXPERIENCE_PROFILE_MISMATCH'
      && error.retryable === true
  );
});

test('preserves the gateway code and activity when a Terra route is rejected', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ code: 'ACTIVITY_NOT_ALLOWED', retryable: false }), {
    status: 403,
    headers: { 'content-type': 'application/json' }
  });
  await assert.rejects(
    () => completeWithTerra({ activity: 'experience.social_reply_draft', requestId: 'blocked-route', messages: [{ role: 'user', content: 'Draft a reply' }] }),
    (error: unknown) => error instanceof TerraError
      && error.code === 'ACTIVITY_NOT_ALLOWED'
      && error.status === 403
      && error.retryable === false
      && error.message === 'Terra rejected experience.social_reply_draft: ACTIVITY_NOT_ALLOWED (HTTP 403)'
  );
});
