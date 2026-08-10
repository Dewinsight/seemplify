'use strict';

const crypto = require('node:crypto');

const SIGNATURE_VERSION = 'v2';
const DEFAULT_SERVICE_ID = 'payroll';
const INSECURE_SECRET_PATTERN = /(change[-_ ]?me|replace[-_ ]?me|your[-_ ]|example|internal-secret|secret-key)/i;

class PayrollLeaveSigningConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PayrollLeaveSigningConfigurationError';
    this.code = 'PAYROLL_LEAVE_SIGNING_UNAVAILABLE';
  }
}

function assertStrongSharedSecret(secret, environment = process.env.NODE_ENV) {
  const value = String(secret || '');
  const isProduction = String(environment || '').toLowerCase() === 'production';
  if (
    !value
    || Buffer.byteLength(value, 'utf8') < 32
    || (isProduction && (INSECURE_SECRET_PATTERN.test(value) || new Set(value).size < 8))
  ) {
    throw new PayrollLeaveSigningConfigurationError(
      'PAYROLL_LEAVE_SHARED_SECRET must be a strong service-specific secret.'
    );
  }
  return value;
}

function getPayrollLeaveSigningReadiness({
  secret = process.env.PAYROLL_LEAVE_SHARED_SECRET,
  environment = process.env.NODE_ENV,
} = {}) {
  try {
    assertStrongSharedSecret(secret, environment);
    return { configured: true, code: null };
  } catch (error) {
    return {
      configured: false,
      code: error?.code || 'PAYROLL_LEAVE_SIGNING_UNAVAILABLE',
    };
  }
}

function canonicalRequestBuffer({ serviceId, timestamp, nonce, method, path, rawBody }) {
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8');
  const prefix = [
    SIGNATURE_VERSION,
    serviceId,
    timestamp,
    nonce,
    String(method || '').toUpperCase(),
    path,
    '',
  ].join('\n');
  return Buffer.concat([Buffer.from(prefix, 'utf8'), body]);
}

function signPayrollLeaveRequest({
  rawBody,
  path,
  method = 'POST',
  secret = process.env.PAYROLL_LEAVE_SHARED_SECRET,
  serviceId = process.env.PAYROLL_LEAVE_SERVICE_ID || DEFAULT_SERVICE_ID,
  timestamp = String(Date.now()),
  nonce = crypto.randomBytes(24).toString('base64url'),
  environment = process.env.NODE_ENV,
} = {}) {
  const normalizedServiceId = String(serviceId || '').trim();
  if (!normalizedServiceId) {
    throw new PayrollLeaveSigningConfigurationError(
      'PAYROLL_LEAVE_SERVICE_ID must identify the payroll service.'
    );
  }

  const digest = crypto
    .createHmac('sha256', assertStrongSharedSecret(secret, environment))
    .update(canonicalRequestBuffer({
      serviceId: normalizedServiceId,
      timestamp: String(timestamp),
      nonce: String(nonce),
      method,
      path,
      rawBody,
    }))
    .digest('hex');

  return {
    'x-seemplify-service-id': normalizedServiceId,
    'x-seemplify-timestamp': String(timestamp),
    'x-seemplify-nonce': String(nonce),
    'x-seemplify-signature': `${SIGNATURE_VERSION}=${digest}`,
  };
}

module.exports = {
  DEFAULT_SERVICE_ID,
  PayrollLeaveSigningConfigurationError,
  SIGNATURE_VERSION,
  assertStrongSharedSecret,
  canonicalRequestBuffer,
  getPayrollLeaveSigningReadiness,
  signPayrollLeaveRequest,
};
