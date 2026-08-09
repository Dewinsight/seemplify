'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { signatureFor, signatureMatches, signatureMatchesAny } = require('./request-auth.cjs');

test('a rotated Recruiter request key rejects signatures made by the legacy distributed master', () => {
  const input = {
    timestamp: '1786233600000',
    nonce: 'gateway-rotation-nonce-0001',
    method: 'POST',
    path: '/v1/codex/account',
    body: JSON.stringify({ sourceApp: 'recruiter', subjectId: 'user-1' })
  };
  const legacySignature = signatureFor('legacy-master-known-to-old-consumers', input);
  const rotatedSignature = signatureFor('fresh-recruiter-only-request-secret', input);
  assert.equal(signatureMatches('fresh-recruiter-only-request-secret', input, legacySignature), false);
  assert.equal(signatureMatches('fresh-recruiter-only-request-secret', input, rotatedSignature), true);
});

test('a staged rotation accepts the current and previous request keys', () => {
  const input = {
    timestamp: '1786276800000',
    nonce: 'rotation-nonce-1234567890',
    method: 'POST',
    path: '/v1/codex/account',
    body: '{"sourceApp":"recruiter","subjectId":"user-a"}'
  };
  const previousSignature = signatureFor('previous-request-key', input);
  assert.equal(
    signatureMatchesAny(['current-request-key', 'previous-request-key'], input, previousSignature),
    true
  );
  assert.equal(signatureMatchesAny(['current-request-key'], input, previousSignature), false);
});
