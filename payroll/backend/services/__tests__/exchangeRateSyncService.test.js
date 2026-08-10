jest.mock('../../models/CurrencySyncSettings', () => ({
  findOneAndUpdate: jest.fn(),
  updateOne: jest.fn(),
}));

jest.mock('../../models/ExchangeRate', () => ({}));
jest.mock('../../models/PayrollProfile', () => ({}));

const CurrencySyncSettings = require('../../models/CurrencySyncSettings');
const exchangeRateSyncService = require('../ExchangeRateSyncService');

describe('ExchangeRateSyncService settings', () => {
  afterEach(() => jest.clearAllMocks());

  test('rejects a provider base outside the shared ISO payroll catalogue', async () => {
    await expect(exchangeRateSyncService.updateSettings('org-1', {
      providerBaseCurrency: 'ZZZ',
    })).rejects.toMatchObject({
      code: 'CURRENCY_NOT_SUPPORTED',
      statusCode: 400,
    });
    expect(CurrencySyncSettings.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('normalizes a supported provider base before saving it', async () => {
    CurrencySyncSettings.findOneAndUpdate.mockResolvedValue({ providerBaseCurrency: 'NGN' });

    await exchangeRateSyncService.updateSettings('org-1', {
      providerBaseCurrency: 'ngn',
    });

    expect(CurrencySyncSettings.findOneAndUpdate).toHaveBeenCalledWith(
      { organizationId: 'org-1' },
      expect.objectContaining({ $set: expect.objectContaining({ providerBaseCurrency: 'NGN' }) }),
      expect.objectContaining({ new: true, upsert: true })
    );
  });
});
