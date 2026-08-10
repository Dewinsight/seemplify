'use strict';

const {
  calculateSignature,
  createInternalPayrollAuth,
} = require('../internalPayrollSecurity');

const SECRET = '9f4cf94333a1496b806f7d875af89ba31f0bca4e569b4a908783462d95e68f5e';
const SERVICE_ID = 'payroll';
const PATH = '/api/internal/payroll/unpaid-leave-summary';
const NOW = 1786276800000;
const NONCE = '0123456789abcdef0123456789abcdef0123456789abcdef';

function signedRequest(overrides = {}) {
  const rawBody = Buffer.from(overrides.body || JSON.stringify({
    organizationId: 'org-a',
    userId: 'user-a',
    startDate: '2026-08-01',
    endDate: '2026-08-31',
  }));
  const timestamp = String(overrides.timestamp ?? NOW);
  const serviceId = overrides.serviceId || SERVICE_ID;
  const nonce = overrides.nonce || NONCE;
  const signature = `v2=${calculateSignature({
    secret: SECRET,
    serviceId,
    timestamp,
    nonce,
    method: 'POST',
    path: PATH,
    rawBody,
  }).toString('hex')}`;

  return {
    method: 'POST',
    originalUrl: PATH,
    rawBody: overrides.rawBody || rawBody,
    headers: {
      'x-seemplify-service-id': serviceId,
      'x-seemplify-timestamp': timestamp,
      'x-seemplify-nonce': nonce,
      'x-seemplify-signature': overrides.signature || signature,
    },
    get(name) {
      return this.headers[String(name).toLowerCase()];
    },
  };
}

function invoke(middleware, req) {
  return new Promise((resolve) => middleware(req, {}, resolve));
}

describe('internal payroll HMAC v2 authentication', () => {
  test('authenticates exact raw bytes and durably reserves a future-skewed nonce', async () => {
    const nonceModel = { create: jest.fn().mockResolvedValue({}) };
    const timestamp = NOW + (5 * 60 * 1000);
    const request = signedRequest({ timestamp });
    const middleware = createInternalPayrollAuth({
      nonceModel,
      clock: () => NOW,
      secret: SECRET,
      serviceId: SERVICE_ID,
      environment: 'production',
    });

    await expect(invoke(middleware, request)).resolves.toBeUndefined();
    expect(request.internalService).toMatchObject({ id: SERVICE_ID, signatureVersion: 'v2' });
    expect(nonceModel.create).toHaveBeenCalledTimes(1);
    const stored = nonceModel.create.mock.calls[0][0];
    expect(stored.serviceId).toBe(SERVICE_ID);
    expect(stored.nonceHash).toMatch(/^[a-f0-9]{64}$/);
    // Future timestamp + two full replay windows, so TTL cleanup cannot race
    // acceptance at the exact clock-skew boundary.
    expect(stored.expiresAt.getTime()).toBe(NOW + (15 * 60 * 1000));
  });

  test('rejects body tampering and a caller from a different service before storage', async () => {
    const nonceModel = { create: jest.fn() };
    const middleware = createInternalPayrollAuth({
      nonceModel,
      clock: () => NOW,
      secret: SECRET,
      serviceId: SERVICE_ID,
      environment: 'production',
    });

    const tampered = signedRequest({ rawBody: Buffer.from('{"organizationId":"org-b"}') });
    await expect(invoke(middleware, tampered)).resolves.toMatchObject({
      statusCode: 401,
      code: 'INTERNAL_REQUEST_INVALID_SIGNATURE',
    });

    const foreignService = signedRequest({ serviceId: 'recruiter' });
    await expect(invoke(middleware, foreignService)).resolves.toMatchObject({
      statusCode: 401,
      code: 'INTERNAL_REQUEST_STALE_OR_MALFORMED',
    });
    expect(nonceModel.create).not.toHaveBeenCalled();
  });

  test('rejects a replay using the database unique constraint', async () => {
    const nonceModel = { create: jest.fn().mockRejectedValue({ code: 11000 }) };
    const middleware = createInternalPayrollAuth({
      nonceModel,
      clock: () => NOW,
      secret: SECRET,
      serviceId: SERVICE_ID,
      environment: 'production',
    });

    await expect(invoke(middleware, signedRequest())).resolves.toMatchObject({
      statusCode: 409,
      code: 'INTERNAL_REQUEST_REPLAYED',
    });
  });

  test('fails closed when durable replay storage is unavailable', async () => {
    const nonceModel = { create: jest.fn().mockRejectedValue(new Error('Mongo unavailable')) };
    const middleware = createInternalPayrollAuth({
      nonceModel,
      clock: () => NOW,
      secret: SECRET,
      serviceId: SERVICE_ID,
      environment: 'production',
    });

    await expect(invoke(middleware, signedRequest())).resolves.toMatchObject({
      statusCode: 503,
      code: 'INTERNAL_REQUEST_REPLAY_PROTECTION_UNAVAILABLE',
    });
  });

  test('does not accept a weak production secret', async () => {
    const middleware = createInternalPayrollAuth({
      nonceModel: { create: jest.fn() },
      clock: () => NOW,
      secret: 'internal-secret-key',
      serviceId: SERVICE_ID,
      environment: 'production',
    });

    await expect(invoke(middleware, signedRequest())).resolves.toMatchObject({
      statusCode: 503,
      code: 'INTERNAL_REQUEST_VERIFICATION_UNAVAILABLE',
    });
  });
});
