const crypto = require('crypto');

const TOKEN_PREFIX = 'ais1';
const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

function getSigningSecret() {
  const secret = process.env.AI_INTERVIEW_PUBLIC_LINK_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    const error = new Error('AI_INTERVIEW_PUBLIC_LINK_SECRET or JWT_SECRET must be configured');
    error.code = 'AI_INTERVIEW_LINK_SECRET_MISSING';
    throw error;
  }
  return secret;
}

function signatureFor(value, secret = getSigningSecret()) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function createRecruiterPublicToken(sessionId, { secret } = {}) {
  const normalizedSessionId = String(sessionId || '').trim();
  if (!OBJECT_ID_PATTERN.test(normalizedSessionId)) {
    throw new Error('A valid AI interview session id is required');
  }

  const payload = `${TOKEN_PREFIX}.${normalizedSessionId}`;
  return `${payload}.${signatureFor(payload, secret)}`;
}

function verifyRecruiterPublicToken(token, { secret } = {}) {
  const [prefix, sessionId, suppliedSignature, ...extra] = String(token || '').split('.');
  if (prefix !== TOKEN_PREFIX || extra.length || !OBJECT_ID_PATTERN.test(sessionId || '') || !suppliedSignature) {
    return null;
  }

  const payload = `${prefix}.${sessionId}`;
  const expectedSignature = signatureFor(payload, secret);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    return null;
  }

  return sessionId;
}

function getRecruiterPublicPath(sessionId, options) {
  return `/public/ai-interview/${createRecruiterPublicToken(sessionId, options)}`;
}

module.exports = {
  createRecruiterPublicToken,
  getRecruiterPublicPath,
  verifyRecruiterPublicToken
};
