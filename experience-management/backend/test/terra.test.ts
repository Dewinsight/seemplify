import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-terra-signing-'));
const secretFile = path.join(root, 'secret'); const secret = 'terra-test-secret-that-is-long-enough'; fs.writeFileSync(secretFile, secret);
process.env.TERRA_GATEWAY_SHARED_SECRET_FILE = secretFile;
const { completeWithTerra, TerraError } = await import('../src/terraClient.js');
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; fs.rmSync(root, { recursive: true, force: true }); });

test('signs Terra requests and supplies durable metering identity', async () => {
  const eventIds: string[] = [];
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
    assert.equal(payload.metering.record, true);
    return new Response(JSON.stringify({ data: { answer: 'Grounded' }, runtimeProfile: 'experience-management', provider: 'local-codex', engine: 'codex', model: 'gpt-5.6-terra', usage: { total_tokens: 10 }, metrics: { latencyMs: 50 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const result = await completeWithTerra({ activity: 'experience.analyst_chat', requestId: 'job-1', messages: [{ role: 'user', content: 'Question' }] });
  assert.deepEqual(result.data, { answer: 'Grounded' });
  assert.equal(result.runtime.model, 'gpt-5.6-terra');
  await completeWithTerra({ activity: 'experience.analyst_chat', requestId: 'job-1:attempt:2', messages: [{ role: 'user', content: 'Question' }] });
  assert.notEqual(eventIds[0], eventIds[1]);
  await completeWithTerra({ activity: 'experience.social_listening', requestId: 'job-social', messages: [{ role: 'user', content: 'Mentions' }] });
  await completeWithTerra({ activity: 'experience.journey_mapping', requestId: 'job-journey', messages: [{ role: 'user', content: 'Journey brief' }] });
  assert.deepEqual(activities, ['experience.analyst_chat', 'experience.analyst_chat', 'experience.social_listening', 'experience.journey_mapping']);
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
