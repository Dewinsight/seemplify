const crypto = require('crypto');

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const seenSignatures = new Map();

function configuredSecret() {
  return process.env.PERFORMANCE_MANAGEMENT_WEBHOOK_SECRET
    || process.env.INTERNAL_SERVICE_SECRET
    || process.env.IDP_PERFORMANCE_SERVICE_SECRET
    || '';
}

function safeEqualHex(left, right) {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function pruneSeen(now) {
  for (const [signature, expiresAt] of seenSignatures.entries()) {
    if (expiresAt <= now) seenSignatures.delete(signature);
  }
}

function internalServiceAuth(req, res, next) {
  const secret = configuredSecret();
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(503).json({ success: false, error: 'Internal service authentication is not configured' });
    }
    if (req.get('x-internal-request') !== 'true') {
      return res.status(401).json({ success: false, error: 'Internal service authentication is required' });
    }
    req.serviceId = String(req.get('x-service-id') || 'development-service');
    return next();
  }

  const timestamp = String(req.get('x-service-timestamp') || '');
  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > MAX_CLOCK_SKEW_MS) {
    return res.status(401).json({ success: false, error: 'Expired or invalid service timestamp' });
  }
  const received = String(req.get('x-service-signature') || '').replace(/^sha256=/, '');
  const serializedBody = JSON.stringify(req.body || {});
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${serializedBody}`).digest('hex');
  if (!safeEqualHex(received, expected)) {
    return res.status(401).json({ success: false, error: 'Invalid service signature' });
  }

  const now = Date.now();
  pruneSeen(now);
  if (seenSignatures.has(received)) {
    return res.status(409).json({ success: false, error: 'Replayed service request' });
  }
  seenSignatures.set(received, now + MAX_CLOCK_SKEW_MS);
  req.serviceId = String(req.get('x-service-id') || 'unknown-service');
  next();
}

module.exports = { internalServiceAuth };
