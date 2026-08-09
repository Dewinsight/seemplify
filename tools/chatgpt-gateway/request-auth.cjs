'use strict';

const crypto = require('node:crypto');

function signatureFor(secret, { timestamp, nonce, method, path, body }) {
  const key = String(secret || '').trim();
  if (!key) throw new TypeError('A gateway request secret is required');
  return crypto.createHmac('sha256', key)
    .update(`${timestamp}\n${nonce}\n${String(method || '').toUpperCase()}\n${path}\n${body}`)
    .digest('base64url');
}

function signatureMatches(secret, input, supplied) {
  const expected = signatureFor(secret, input);
  const actualBuffer = Buffer.from(String(supplied || ''));
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function signatureMatchesAny(secrets, input, supplied) {
  return [...new Set((Array.isArray(secrets) ? secrets : [secrets])
    .map((secret) => String(secret || '').trim())
    .filter(Boolean))]
    .some((secret) => signatureMatches(secret, input, supplied));
}

module.exports = { signatureFor, signatureMatches, signatureMatchesAny };
