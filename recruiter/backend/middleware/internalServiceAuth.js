const crypto = require('crypto');

function timingSafeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createInternalServiceAuth({ env = process.env, now = () => Date.now() } = {}) {
  return (req, res, next) => {
    const secret = String(env.AI_GATEWAY_HMAC_SECRET || '');
    if (!secret) {
      return res.status(503).json({ code: 'AI_GATEWAY_NOT_CONFIGURED', message: 'Internal AI gateway authentication is not configured' });
    }

    const service = String(req.get('x-seemplify-service') || '');
    const timestamp = String(req.get('x-seemplify-timestamp') || '');
    const signature = String(req.get('x-seemplify-signature') || '');
    const timestampMs = Number(timestamp);

    if (!service || !timestamp || !signature || !Number.isFinite(timestampMs)) {
      return res.status(401).json({ code: 'AI_GATEWAY_AUTH_INVALID', message: 'Missing internal service signature' });
    }

    const allowedServices = new Set(String(env.AI_GATEWAY_ALLOWED_SERVICES || 'ai-interview')
      .split(',').map((item) => item.trim()).filter(Boolean));
    if (!allowedServices.has(service)) {
      return res.status(403).json({ code: 'AI_GATEWAY_SERVICE_FORBIDDEN', message: 'Internal service is not authorized for the AI gateway' });
    }

    if (Math.abs(now() - timestampMs) > 5 * 60 * 1000) {
      return res.status(401).json({ code: 'AI_GATEWAY_AUTH_EXPIRED', message: 'Internal service signature has expired' });
    }

    const rawBody = Buffer.isBuffer(req.rawBody)
      ? req.rawBody.toString('utf8')
      : JSON.stringify(req.body || {});
    const canonical = [timestamp, service, req.method.toUpperCase(), req.originalUrl.split('?')[0], rawBody].join('\n');
    const expected = crypto.createHmac('sha256', secret).update(canonical).digest('hex');

    if (!timingSafeEqual(signature, expected)) {
      return res.status(401).json({ code: 'AI_GATEWAY_AUTH_INVALID', message: 'Invalid internal service signature' });
    }

    req.internalService = service;
    next();
  };
}

module.exports = { createInternalServiceAuth, timingSafeEqual };
