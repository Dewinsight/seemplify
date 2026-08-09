const crypto = require('crypto');

let nonceIndexReady;
const SIGNATURE_WINDOW_MS = 5 * 60 * 1000;

function timingSafeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

async function claimMongoNonce(key, expiresAt) {
  const InternalServiceNonce = require('../models/InternalServiceNonce');
  try {
    // Do not assume production autoIndex is enabled. Replay protection is only
    // cross-replica when the unique index exists, so build/verify it once and
    // fail closed if Mongo cannot provide that guarantee.
    nonceIndexReady ||= InternalServiceNonce.init();
    await nonceIndexReady;
    await InternalServiceNonce.create({ key, expiresAt: new Date(expiresAt) });
    return true;
  } catch (error) {
    if (error?.code === 11000) return false;
    throw error;
  }
}

function mapNonceClaimer(nonceStore) {
  return async (key, expiresAt, currentTime) => {
    for (const [storedNonce, storedExpiry] of nonceStore) {
      if (storedExpiry <= currentTime) nonceStore.delete(storedNonce);
    }
    if (nonceStore.has(key)) return false;
    nonceStore.set(key, expiresAt);
    return true;
  };
}

function createInternalServiceAuth({ env = process.env, now = () => Date.now(), nonceStore, claimNonce } = {}) {
  const claimReplayNonce = claimNonce || (nonceStore ? mapNonceClaimer(nonceStore) : claimMongoNonce);
  return async (req, res, next) => {
    const service = String(req.get('x-seemplify-service') || '');
    const timestamp = String(req.get('x-seemplify-timestamp') || '');
    const signatureVersion = String(req.get('x-seemplify-signature-version') || '1');
    const nonce = String(req.get('x-seemplify-nonce') || '');
    const signature = String(req.get('x-seemplify-signature') || '');
    const timestampMs = Number(timestamp);

    if (!service || !timestamp || !signature || !Number.isFinite(timestampMs)) {
      return res.status(401).json({ code: 'AI_GATEWAY_AUTH_INVALID', message: 'Missing internal service signature' });
    }

    // Performance is a built-in consumer of the shared account authority. It
    // remains allowed even when an older deployment explicitly configures an
    // allow-list containing only ai-interview. Arbitrary additional services
    // still require an explicit entry.
    const allowedServices = new Set(['performance-management', ...String(env.AI_GATEWAY_ALLOWED_SERVICES || 'ai-interview')
      .split(',').map((item) => item.trim()).filter(Boolean)]);
    if (!allowedServices.has(service)) {
      return res.status(403).json({ code: 'AI_GATEWAY_SERVICE_FORBIDDEN', message: 'Internal service is not authorized for the AI gateway' });
    }

    // Performance receives only this service-bound proxy key. It never holds
    // the hosted ChatGPT gateway master, so it cannot mint a Recruiter gateway
    // subject or call another gateway namespace directly.
    const secrets = service === 'performance-management'
      ? [...new Set([
        env.PERFORMANCE_AI_SHARED_SECRET,
        env.PERFORMANCE_AI_SHARED_SECRET_PREVIOUS
      ].map((value) => String(value || '').trim()).filter(Boolean))]
      : [String(env.AI_GATEWAY_HMAC_SECRET || '').trim()].filter(Boolean);
    if (!secrets.length) {
      return res.status(503).json({ code: 'AI_GATEWAY_NOT_CONFIGURED', message: 'Internal AI gateway authentication is not configured' });
    }

    const currentTime = now();
    if (Math.abs(currentTime - timestampMs) > SIGNATURE_WINDOW_MS) {
      return res.status(401).json({ code: 'AI_GATEWAY_AUTH_EXPIRED', message: 'Internal service signature has expired' });
    }

    const rawBody = Buffer.isBuffer(req.rawBody)
      ? req.rawBody.toString('utf8')
      : JSON.stringify(req.body || {});
    // Version 1 is retained for the existing AI Interview worker. New shared
    // account consumers use v2, which binds a nonce into the signature and
    // rejects replay during the timestamp window.
    if (service === 'performance-management' && signatureVersion !== '2') {
      return res.status(401).json({ code: 'AI_GATEWAY_AUTH_VERSION_REQUIRED', message: 'Signature version 2 is required' });
    }
    if (signatureVersion === '2' && !/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) {
      return res.status(401).json({ code: 'AI_GATEWAY_NONCE_INVALID', message: 'Missing or invalid internal service nonce' });
    }
    const requestPath = req.originalUrl.split('?')[0];
    const canonical = signatureVersion === '2'
      ? [timestamp, nonce, service, req.method.toUpperCase(), requestPath, rawBody].join('\n')
      : [timestamp, service, req.method.toUpperCase(), requestPath, rawBody].join('\n');
    const validSignature = secrets.some((secret) => {
      const expected = crypto.createHmac('sha256', secret).update(canonical).digest('hex');
      return timingSafeEqual(signature, expected);
    });

    if (!validSignature) {
      return res.status(401).json({ code: 'AI_GATEWAY_AUTH_INVALID', message: 'Invalid internal service signature' });
    }

    if (signatureVersion === '2') {
      const replayKey = `${service}:${nonce}`;
      let claimed;
      try {
        // A request timestamp may be up to one window in the future. Keep its
        // nonce until the entire accepted signature window has elapsed, not
        // merely one window from the first replica that saw it.
        const replayExpiresAt = Math.max(currentTime, timestampMs) + SIGNATURE_WINDOW_MS;
        claimed = await claimReplayNonce(replayKey, replayExpiresAt, currentTime);
      } catch (error) {
        console.error('Internal AI replay guard unavailable:', error.message);
        return res.status(503).json({
          code: 'AI_GATEWAY_REPLAY_GUARD_UNAVAILABLE',
          message: 'Internal AI replay protection is unavailable'
        });
      }
      if (!claimed) {
        return res.status(409).json({ code: 'AI_GATEWAY_REPLAY_REJECTED', message: 'This internal service request was already used' });
      }
    }

    req.internalService = service;
    req.internalSignatureVersion = signatureVersion;
    next();
  };
}

module.exports = { SIGNATURE_WINDOW_MS, claimMongoNonce, createInternalServiceAuth, mapNonceClaimer, timingSafeEqual };
