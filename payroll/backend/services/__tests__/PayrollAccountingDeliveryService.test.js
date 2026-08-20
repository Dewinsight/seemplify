const { PayrollAccountingDeliveryService, sha256 } = require('../PayrollAccountingDeliveryService');

describe('Payroll accounting delivery security', () => {
  test('hashes opaque delivery tokens without storing their plaintext value', () => {
    const token = 'opaque-recipient-token';
    expect(sha256(token)).toHaveLength(64);
    expect(sha256(token)).not.toContain(token);
    expect(sha256(token)).toBe(sha256(token));
  });

  test('expires an old link and records the expiry without returning an artifact', async () => {
    const token = 'expired-token';
    const delivery = { tokenHash: sha256(token), status: 'sent', expiresAt: new Date(Date.now() - 1000), audit: [], save: jest.fn().mockResolvedValue(undefined) };
    const Delivery = { findOne: jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(delivery) }) };
    const service = new PayrollAccountingDeliveryService({ Delivery });
    await expect(service.download('delivery-1', token)).rejects.toMatchObject({ code: 'PAYROLL_DELIVERY_EXPIRED', statusCode: 410 });
    expect(delivery.status).toBe('expired');
    expect(delivery.audit[0].action).toBe('expired');
  });

  test('rejects an invalid opaque token using a non-revealing response', async () => {
    const delivery = { tokenHash: sha256('correct-token'), status: 'sent', expiresAt: new Date(Date.now() + 1000), audit: [] };
    const Delivery = { findOne: jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue(delivery) }) };
    const service = new PayrollAccountingDeliveryService({ Delivery });
    await expect(service.download('delivery-1', 'wrong-token')).rejects.toMatchObject({ code: 'PAYROLL_DELIVERY_LINK_INVALID', statusCode: 404 });
  });
});
