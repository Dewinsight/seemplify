const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createRecruiterPublicToken,
  getRecruiterPublicPath,
  verifyRecruiterPublicToken
} = require('../services/aiInterviewPublicLinkService');

const sessionId = '507f1f77bcf86cd799439011';
const secret = 'test-ai-interview-link-secret';

test('creates a stable candidate interview path for a recruiter session', () => {
  const first = getRecruiterPublicPath(sessionId, { secret });
  const second = getRecruiterPublicPath(sessionId, { secret });

  assert.equal(first, second);
  assert.match(first, /^\/public\/ai-interview\/ais1\./);
  assert.equal(verifyRecruiterPublicToken(first.split('/').at(-1), { secret }), sessionId);
});

test('rejects tampered and foreign-secret recruiter interview tokens', () => {
  const token = createRecruiterPublicToken(sessionId, { secret });
  const tampered = token.replace(sessionId, '507f1f77bcf86cd799439012');

  assert.equal(verifyRecruiterPublicToken(tampered, { secret }), null);
  assert.equal(verifyRecruiterPublicToken(token, { secret: 'another-secret' }), null);
  assert.equal(verifyRecruiterPublicToken('ordinary-email-token', { secret }), null);
});

test('requires a valid MongoDB object id when creating a link', () => {
  assert.throws(
    () => createRecruiterPublicToken('not-a-session-id', { secret }),
    /valid AI interview session id/
  );
});
