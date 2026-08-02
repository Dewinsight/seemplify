const crypto = require('crypto');

const seenNonces = new Map();

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function pruneNonces(now) {
  for (const [nonce, expiresAt] of seenNonces) {
    if (expiresAt <= now) seenNonces.delete(nonce);
  }
}

function signLocalHistoryRequest(secret, method, requestPath, timestamp, nonce) {
  return crypto.createHmac('sha256', secret)
    .update(`${timestamp}\n${nonce}\n${String(method).toUpperCase()}\n${requestPath}`)
    .digest('base64url');
}

function createLocalRuntimeHistoryAuth({ env = process.env, now = () => Date.now() } = {}) {
  return (req, res, next) => {
    const secret = String(env.LOCAL_LLM_SHARED_SECRET || '').trim();
    if (!secret) {
      return res.status(503).json({ code: 'LOCAL_RUNTIME_NOT_CONFIGURED', message: 'Local runtime history authentication is not configured' });
    }
    const timestamp = String(req.get('x-seemplify-timestamp') || '');
    const nonce = String(req.get('x-seemplify-nonce') || '');
    const signature = String(req.get('x-seemplify-signature') || '');
    const timestampMs = Number(timestamp);
    const currentTime = now();
    pruneNonces(currentTime);
    if (!Number.isFinite(timestampMs) || Math.abs(currentTime - timestampMs) > 5 * 60 * 1000) {
      return res.status(401).json({ code: 'LOCAL_HISTORY_SIGNATURE_EXPIRED', message: 'History signature has expired' });
    }
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce) || seenNonces.has(nonce)) {
      return res.status(401).json({ code: 'LOCAL_HISTORY_NONCE_REJECTED', message: 'History nonce is invalid or was already used' });
    }
    const requestPath = String(req.originalUrl || '').split('#')[0];
    const expected = signLocalHistoryRequest(secret, req.method, requestPath, timestamp, nonce);
    if (!safeEqual(expected, signature)) {
      return res.status(401).json({ code: 'LOCAL_HISTORY_SIGNATURE_INVALID', message: 'History signature is invalid' });
    }
    seenNonces.set(nonce, currentTime + 10 * 60 * 1000);
    return next();
  };
}

module.exports = { createLocalRuntimeHistoryAuth, signLocalHistoryRequest };
