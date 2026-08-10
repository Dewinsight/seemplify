'use strict';

const crypto = require('node:crypto');

const { AppError } = require('../middleware/errorHandler');
const { InternalServiceNonce } = require('../models');

const SIGNATURE_VERSION = 'v2';
const DEFAULT_SERVICE_ID = 'payroll';
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const SIGNATURE_PATTERN = /^v2=([a-f0-9]{64})$/i;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const INSECURE_SECRET_PATTERN = /(change[-_ ]?me|replace[-_ ]?me|your[-_ ]|example|internal-secret|secret-key)/i;

function toRawBodyBuffer(rawBody) {
  if (Buffer.isBuffer(rawBody)) return rawBody;
  if (typeof rawBody === 'string') return Buffer.from(rawBody, 'utf8');
  throw new AppError(
    'The signed request body is unavailable.',
    400,
    'INTERNAL_REQUEST_RAW_BODY_REQUIRED'
  );
}

function assertStrongSharedSecret(secret, environment = process.env.NODE_ENV) {
  const value = String(secret || '');
  const isProduction = String(environment || '').toLowerCase() === 'production';
  const tooShort = Buffer.byteLength(value, 'utf8') < 32;
  const knownPlaceholder = INSECURE_SECRET_PATTERN.test(value);
  const lowDiversity = new Set(value).size < 8;

  if (!value || tooShort || (isProduction && (knownPlaceholder || lowDiversity))) {
    throw new AppError(
      'Payroll-to-leave request verification is not configured securely.',
      503,
      'INTERNAL_REQUEST_VERIFICATION_UNAVAILABLE'
    );
  }

  return value;
}

function canonicalRequestBuffer({
  version = SIGNATURE_VERSION,
  serviceId,
  timestamp,
  nonce,
  method,
  path,
  rawBody,
}) {
  const prefix = [
    version,
    serviceId,
    timestamp,
    nonce,
    String(method || '').toUpperCase(),
    path,
    '',
  ].join('\n');

  return Buffer.concat([
    Buffer.from(prefix, 'utf8'),
    toRawBodyBuffer(rawBody),
  ]);
}

function calculateSignature({ secret, ...request }) {
  return crypto
    .createHmac('sha256', assertStrongSharedSecret(secret))
    .update(canonicalRequestBuffer(request))
    .digest();
}

function timingSafeSignatureMatches(suppliedSignature, expectedSignature) {
  const match = SIGNATURE_PATTERN.exec(String(suppliedSignature || ''));
  const supplied = match ? Buffer.from(match[1], 'hex') : Buffer.alloc(expectedSignature.length);
  const equal = crypto.timingSafeEqual(supplied, expectedSignature);
  return Boolean(match) && equal;
}

function requestPath(req) {
  return String(req.originalUrl || req.url || '');
}

function readHeader(req, name) {
  if (typeof req.get === 'function') return req.get(name);
  return req.headers?.[name.toLowerCase()];
}

function duplicateKeyError(error) {
  return Number(error?.code) === 11000;
}

function createInternalPayrollAuth(options = {}) {
  const nonceModel = options.nonceModel || InternalServiceNonce;
  const clock = options.clock || (() => Date.now());
  const expectedPath = options.expectedPath || '/api/internal/payroll/unpaid-leave-summary';
  const maxClockSkewMs = Number(options.maxClockSkewMs || MAX_CLOCK_SKEW_MS);

  return async function internalPayrollAuth(req, _res, next) {
    try {
      const now = Number(clock());
      const serviceId = String(readHeader(req, 'x-seemplify-service-id') || '');
      const timestamp = String(readHeader(req, 'x-seemplify-timestamp') || '');
      const nonce = String(readHeader(req, 'x-seemplify-nonce') || '');
      const suppliedSignature = String(readHeader(req, 'x-seemplify-signature') || '');
      const expectedServiceId = String(
        options.serviceId || process.env.PAYROLL_LEAVE_SERVICE_ID || DEFAULT_SERVICE_ID
      );
      const secret = assertStrongSharedSecret(
        options.secret ?? process.env.PAYROLL_LEAVE_SHARED_SECRET,
        options.environment ?? process.env.NODE_ENV
      );
      const path = requestPath(req);
      const timestampMs = /^\d{13}$/.test(timestamp) ? Number(timestamp) : NaN;

      if (
        serviceId !== expectedServiceId
        || path !== expectedPath
        || String(req.method || '').toUpperCase() !== 'POST'
        || !NONCE_PATTERN.test(nonce)
        || !Number.isSafeInteger(timestampMs)
        || Math.abs(now - timestampMs) > maxClockSkewMs
      ) {
        throw new AppError(
          'The internal request is stale or malformed.',
          401,
          'INTERNAL_REQUEST_STALE_OR_MALFORMED'
        );
      }

      const rawBody = toRawBodyBuffer(req.rawBody);
      const expectedSignature = calculateSignature({
        secret,
        serviceId,
        timestamp,
        nonce,
        method: req.method,
        path,
        rawBody,
      });

      if (!timingSafeSignatureMatches(suppliedSignature, expectedSignature)) {
        throw new AppError(
          'The internal request signature is invalid.',
          401,
          'INTERNAL_REQUEST_INVALID_SIGNATURE'
        );
      }

      const nonceHash = crypto
        .createHash('sha256')
        .update(`${serviceId}\0${nonce}`, 'utf8')
        .digest('hex');

      // Keep every accepted nonce beyond the full replay window measured from
      // both receipt time and signed time. A request signed five minutes in the
      // future therefore cannot outlive its durable replay record.
      const expiresAt = new Date(Math.max(now, timestampMs) + (2 * maxClockSkewMs));
      try {
        await nonceModel.create({
          serviceId,
          nonceHash,
          requestTimestamp: new Date(timestampMs),
          expiresAt,
        });
      } catch (error) {
        if (duplicateKeyError(error)) {
          throw new AppError(
            'The internal request has already been processed.',
            409,
            'INTERNAL_REQUEST_REPLAYED'
          );
        }

        throw new AppError(
          'Replay protection storage is unavailable.',
          503,
          'INTERNAL_REQUEST_REPLAY_PROTECTION_UNAVAILABLE'
        );
      }

      req.internalService = {
        id: serviceId,
        signatureVersion: SIGNATURE_VERSION,
        timestamp: new Date(timestampMs),
      };
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

function assertInternalPayrollConfiguration(environment = process.env.NODE_ENV) {
  return assertStrongSharedSecret(process.env.PAYROLL_LEAVE_SHARED_SECRET, environment);
}

module.exports = {
  DEFAULT_SERVICE_ID,
  MAX_CLOCK_SKEW_MS,
  SIGNATURE_VERSION,
  assertInternalPayrollConfiguration,
  assertStrongSharedSecret,
  calculateSignature,
  canonicalRequestBuffer,
  createInternalPayrollAuth,
  timingSafeSignatureMatches,
};
