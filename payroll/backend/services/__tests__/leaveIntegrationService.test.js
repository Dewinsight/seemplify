'use strict';

const crypto = require('node:crypto');
const axios = require('axios');
const LeaveIntegrationService = require('../LeaveIntegrationService');

jest.mock('axios');

const SECRET = '9f4cf94333a1496b806f7d875af89ba31f0bca4e569b4a908783462d95e68f5e';
const NOW = 1786276800000;
const NONCE = '0123456789abcdef0123456789abcdef0123456789abcdef';
const PATH = '/api/internal/payroll/unpaid-leave-summary';

function service() {
  return new LeaveIntegrationService({
    sharedSecret: SECRET,
    serviceId: 'payroll',
    leaveServiceUrl: 'http://leave.internal/',
    clock: () => NOW,
    nonceFactory: () => NONCE,
    environment: 'production',
  });
}

function validResponse(overrides = {}) {
  return {
    data: {
      organizationId: 'org-1',
      userId: 'employee-1',
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      unpaidDays: 2,
      workingDaysInPeriod: 21,
      matchedRequestCount: 1,
      timezone: 'Africa/Nairobi',
      ...overrides,
    },
  };
}

describe('LeaveIntegrationService payroll boundary', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  test('sends an exact raw POST body with the service-bound HMAC v2 signature', async () => {
    axios.post.mockResolvedValue(validResponse());

    await expect(service().getUnpaidLeaveSummary(
      'org-1',
      'employee-1',
      new Date('2026-08-01T00:00:00.000Z'),
      new Date('2026-08-31T00:00:00.000Z')
    )).resolves.toMatchObject({ unpaidDays: 2, matchedRequestCount: 1 });

    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, rawBody, config] = axios.post.mock.calls[0];
    expect(url).toBe(`http://leave.internal${PATH}`);
    expect(rawBody).toBe(JSON.stringify({
      organizationId: 'org-1',
      userId: 'employee-1',
      startDate: '2026-08-01',
      endDate: '2026-08-31',
    }));
    expect(config).toMatchObject({ timeout: 10000, maxRedirects: 0 });
    expect(config.headers).toMatchObject({
      'x-seemplify-service-id': 'payroll',
      'x-seemplify-timestamp': String(NOW),
      'x-seemplify-nonce': NONCE,
      'content-type': 'application/json',
    });

    const canonical = Buffer.concat([
      Buffer.from(`v2\npayroll\n${NOW}\n${NONCE}\nPOST\n${PATH}\n`, 'utf8'),
      Buffer.from(rawBody, 'utf8'),
    ]);
    const expected = crypto.createHmac('sha256', SECRET).update(canonical).digest('hex');
    expect(config.headers['x-seemplify-signature']).toBe(`v2=${expected}`);
  });

  test('fails closed when approved unpaid-leave data cannot be read', async () => {
    axios.post.mockRejectedValue(new Error('connection refused'));

    await expect(service().getUnpaidLeaveSummary(
      'org-1',
      'employee-1',
      '2026-08-01',
      '2026-08-31'
    )).rejects.toMatchObject({ code: 'LEAVE_DATA_UNAVAILABLE', statusCode: 503 });
  });

  test('rejects malformed or cross-tenant leave summaries instead of treating them as zero leave', async () => {
    axios.post.mockResolvedValue(validResponse({ organizationId: 'org-2', unpaidDays: 'unknown' }));

    await expect(service().getUnpaidLeaveSummary(
      'org-1',
      'employee-1',
      '2026-08-01',
      '2026-08-31'
    )).rejects.toMatchObject({ code: 'LEAVE_DATA_UNAVAILABLE' });
  });

  test('calculates a deduction only from a validated approved summary', async () => {
    axios.post.mockResolvedValue(validResponse());

    await expect(service().calculateUnpaidLeaveDeduction(
      'org-1',
      'employee-1',
      3000,
      '2026-08-01',
      '2026-08-31'
    )).resolves.toEqual({ days: 2, amount: 285.72 });
  });

  test('fails closed without the dedicated shared secret', async () => {
    const unsigned = new LeaveIntegrationService({
      sharedSecret: '',
      leaveServiceUrl: 'http://leave.internal',
      environment: 'production',
    });

    await expect(unsigned.getUnpaidLeaveSummary(
      'org-1',
      'employee-1',
      '2026-08-01',
      '2026-08-31'
    )).rejects.toMatchObject({ code: 'LEAVE_DATA_UNAVAILABLE', statusCode: 503 });
    expect(axios.post).not.toHaveBeenCalled();
  });
});
