import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { signedKnowledgeRequest } from './knowledge-runtime-request.mjs';
const require = createRequire(import.meta.url);
const { verifyRequest, createReplayGuard } = require('../../tools/local-knowledge/auth.cjs');

test('migration requests use the same HMAC and replay contract as the runtime', async () => {
  const secret = 'synthetic-nomic-migration-service-secret';
  await signedKnowledgeRequest('http://runtime', secret, '/v1/migrate-nomic', { source: 'test' }, async (url, request) => {
    const replayGuard = createReplayGuard({});
    const input = { headers: request.headers, requestPath: '/v1/migrate-nomic', rawBody: request.body,
      method: 'POST', secret, replayGuard };
    assert.equal(url, 'http://runtime/v1/migrate-nomic');
    assert.equal(verifyRequest(input).ok, true);
    assert.equal(verifyRequest(input).ok, false);
    return Response.json({ prepared: true });
  });
  await assert.rejects(signedKnowledgeRequest('http://runtime', secret, '/v1/migrate-nomic', {},
    async () => Response.json({ code: 'SOURCE_CHANGED' }, { status: 409 })), /SOURCE_CHANGED/);
});
