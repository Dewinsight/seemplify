'use strict';

const crypto = require('node:crypto');

const DEPLOYMENT_HEALTH_PATH = '/api/ai-account/deployment-health';
const DEPLOYMENT_HEALTH_SERVICE = 'performance-management';
const SIGNATURE_VERSION = '2';
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

function defaultNonceModel() {
  // Load Mongoose only when a valid signed request reaches the nonce claim.
  // This keeps signature helpers independently testable.
  return require('../models/DeploymentHealthNonce');
}

function nonceExpiry(timestampMs, nowMs, clockSkewMs = MAX_CLOCK_SKEW_MS) {
  return new Date(Math.max(nowMs, timestampMs) + clockSkewMs);
}

async function claimDeploymentHealthNonce({ nonce, timestampMs }, {
  nonceModel,
  nowMs = Date.now(),
  clockSkewMs = MAX_CLOCK_SKEW_MS
} = {}) {
  const model = nonceModel || defaultNonceModel();
  const expiresAt = nonceExpiry(timestampMs, nowMs, clockSkewMs);
  try {
    await model.create({
      _id: nonce,
      nonce,
      requestTimestamp: new Date(timestampMs),
      expiresAt
    });
    return { claimed: true, expiresAt };
  } catch (error) {
    if (Number(error?.code) === 11000) return { claimed: false, expiresAt };
    throw error;
  }
}

function invalidSignature(res) {
  return res.status(401).json({
    code: 'DEPLOYMENT_HEALTH_AUTH_INVALID',
    message: 'Invalid deployment health signature'
  });
}

function createDeploymentHealthVerifier({
  nonceModel,
  now = () => Date.now(),
  secret = () => process.env.PERFORMANCE_AI_SHARED_SECRET,
  logger = console
} = {}) {
  return async function verifyDeploymentHealth(req, res, next) {
    const sharedSecret = String(typeof secret === 'function' ? secret() : secret || '').trim();
    const timestamp = String(req.get('x-seemplify-timestamp') || '');
    const nonce = String(req.get('x-seemplify-nonce') || '');
    const service = String(req.get('x-seemplify-service') || '');
    const version = String(req.get('x-seemplify-signature-version') || '');
    const signature = String(req.get('x-seemplify-signature') || '');
    const timestampMs = Number(timestamp);
    const nowMs = Number(now());

    if (!sharedSecret || version !== SIGNATURE_VERSION || service !== DEPLOYMENT_HEALTH_SERVICE
        || !Number.isFinite(timestampMs) || !Number.isFinite(nowMs)
        || Math.abs(nowMs - timestampMs) > MAX_CLOCK_SKEW_MS
        || !/^[A-Za-z0-9_-]{16,128}$/.test(nonce)
        || !/^[a-f0-9]{64}$/i.test(signature)) {
      return invalidSignature(res);
    }

    const body = JSON.stringify(req.body || {});
    const canonical = [
      timestamp,
      nonce,
      service,
      'POST',
      DEPLOYMENT_HEALTH_PATH,
      body
    ].join('\n');
    const expected = crypto.createHmac('sha256', sharedSecret).update(canonical).digest();
    const supplied = Buffer.from(signature, 'hex');
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
      return invalidSignature(res);
    }

    try {
      const claim = await claimDeploymentHealthNonce({ nonce, timestampMs }, {
        nonceModel,
        nowMs,
        clockSkewMs: MAX_CLOCK_SKEW_MS
      });
      if (!claim.claimed) {
        return res.status(401).json({
          code: 'DEPLOYMENT_HEALTH_REPLAY_DETECTED',
          message: 'Deployment health signature has already been used'
        });
      }
    } catch (error) {
      logger?.error?.('Deployment health nonce claim failed', error);
      return res.status(503).json({
        code: 'DEPLOYMENT_HEALTH_REPLAY_PROTECTION_UNAVAILABLE',
        message: 'Deployment health replay protection is unavailable'
      });
    }

    return next();
  };
}

module.exports = {
  DEPLOYMENT_HEALTH_PATH,
  DEPLOYMENT_HEALTH_SERVICE,
  SIGNATURE_VERSION,
  MAX_CLOCK_SKEW_MS,
  nonceExpiry,
  claimDeploymentHealthNonce,
  createDeploymentHealthVerifier
};
