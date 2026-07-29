import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-terra-signing-'));
const secretFile = path.join(root, 'secret'); const secret = 'terra-test-secret-that-is-long-enough'; fs.writeFileSync(secretFile, secret);
process.env.LOCAL_LLM_SHARED_SECRET_FILE = secretFile;
const { completeWithTerra } = await import('../src/terraClient.js');
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; fs.rmSync(root, { recursive: true, force: true }); });

test('signs Terra requests and supplies durable metering identity', async () => {
  const eventIds: string[] = [];
  globalThis.fetch = async (_url, init) => {
    const body = String(init?.body || ''); const headers = init?.headers as Record<string, string>;
    const expected = crypto.createHmac('sha256', secret).update(`${headers['x-seemplify-timestamp']}\n${headers['x-seemplify-nonce']}\nPOST\n/v1/complete\n${body}`).digest('base64url');
    assert.equal(headers['x-seemplify-signature'], expected);
    const payload = JSON.parse(body);
    assert.equal(payload.activity, 'experience.analyst_chat');
    assert.equal(payload.executionMode, 'local-only');
    assert.match(payload.metering.eventId, /^usage_[a-f0-9]{48}$/);
    eventIds.push(payload.metering.eventId);
    assert.equal(payload.metering.record, true);
    return new Response(JSON.stringify({ data: { answer: 'Grounded' }, provider: 'local-ollama', model: 'gpt-5.6-terra', usage: { total_tokens: 10 }, metrics: { latencyMs: 50 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const result = await completeWithTerra({ activity: 'experience.analyst_chat', requestId: 'job-1', messages: [{ role: 'user', content: 'Question' }] });
  assert.deepEqual(result.data, { answer: 'Grounded' });
  assert.equal(result.runtime.model, 'gpt-5.6-terra');
  await completeWithTerra({ activity: 'experience.analyst_chat', requestId: 'job-1:attempt:2', messages: [{ role: 'user', content: 'Question' }] });
  assert.notEqual(eventIds[0], eventIds[1]);
});
