jest.mock('../../models/OrganizationCurrencyPolicy', () => ({
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));

jest.mock('../../models/PayrollProfile', () => ({
  distinct: jest.fn().mockResolvedValue([]),
}));

const organizationCurrencyService = require('../OrganizationCurrencyService');
const OrganizationCurrencyPolicy = require('../../models/OrganizationCurrencyPolicy');
const PayrollProfile = require('../../models/PayrollProfile');
const taxJurisdictionService = require('../TaxJurisdictionService');
const {
  TAX_CURRENCY_CATALOG_VERSION,
  TAX_CURRENCY_CODES,
} = require('../tax/TaxCurrencyCatalog');

describe('organization currency policy validation', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    OrganizationCurrencyPolicy.findOne.mockReset();
    OrganizationCurrencyPolicy.findOneAndUpdate.mockReset();
    PayrollProfile.distinct.mockReset().mockResolvedValue([]);
  });

  test('tax currency catalogue covers every built-in jurisdiction currency', () => {
    const seededCurrencies = [...new Set(taxJurisdictionService.seedDefinitions
      .map((definition) => definition.version?.calculationCurrency)
      .filter(Boolean))].sort();

    expect(TAX_CURRENCY_CODES).toEqual(seededCurrencies);
  });

  test('existing organizations receive current tax currencies once, including NGN', async () => {
    const policy = {
      functionalCurrency: 'USD',
      reportingCurrency: 'USD',
      enabledCurrencies: [{ code: 'USD', isActive: true, paymentEnabled: true }],
      customCurrencies: [],
      taxCurrencyCatalogVersion: 0,
      save: jest.fn().mockResolvedValue(undefined),
    };
    OrganizationCurrencyPolicy.findOne.mockResolvedValue(policy);

    const migrated = await organizationCurrencyService.getPolicy('org-1', { userId: 'admin-1' });

    expect(migrated.taxCurrencyCatalogVersion).toBe(TAX_CURRENCY_CATALOG_VERSION);
    expect(migrated.enabledCurrencies).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'NGN', isActive: true, paymentEnabled: true }),
      expect.objectContaining({ code: 'GBP', isActive: true, paymentEnabled: true }),
      expect.objectContaining({ code: 'XAF', isActive: true, paymentEnabled: false }),
    ]));
    expect(policy.save).toHaveBeenCalledTimes(1);
  });

  test('accepts ISO currencies and rejects custom codes that collide with ISO', () => {
    expect(organizationCurrencyService.assertIsoCurrency('gbp')).toBe('GBP');
    expect(() => organizationCurrencyService.normalizeCustomCurrency({
      code: 'USD', name: 'Internal dollar', symbol: '$', minorUnits: 2,
    })).toThrow(/already an ISO currency/i);
  });

  test('custom currencies are constrained to non-statutory reporting use', () => {
    expect(organizationCurrencyService.normalizeCustomCurrency({
      code: 'QPX', name: 'Internal points', symbol: 'pt', minorUnits: 0,
    })).toMatchObject({
      code: 'QPX',
      usage: 'reporting_only',
      nonStatutoryOnly: true,
      minorUnits: 0,
    });
  });

  test('catalogue distinguishes statutory ISO currencies from custom reporting units', () => {
    const catalogue = organizationCurrencyService.buildCatalog({
      enabledCurrencies: [{ code: 'GBP', isActive: true, paymentEnabled: true }],
      customCurrencies: [{ code: 'QPX', name: 'Points', symbol: 'pt', minorUnits: 0, isActive: true }],
    });
    expect(catalogue.find((entry) => entry.code === 'GBP')).toMatchObject({ enabled: true, statutoryEligible: true });
    expect(catalogue.find((entry) => entry.code === 'QPX')).toMatchObject({ paymentEnabled: false, statutoryEligible: false });
    expect(catalogue.find((entry) => entry.code === 'JPY')).toMatchObject({ payrollCalculationReady: false });
    expect(catalogue.find((entry) => entry.code === 'BHD')).toMatchObject({ payrollCalculationReady: false });
  });

  test('zero- and three-decimal currencies stay reporting-only until calculation rounding is certified', async () => {
    expect(() => organizationCurrencyService.assertPayrollCalculationCurrency('JPY')).toThrow(/remain blocked/i);
    expect(() => organizationCurrencyService.assertPayrollCalculationCurrency('BHD')).toThrow(/remain blocked/i);
    expect(organizationCurrencyService.assertPayrollCalculationCurrency('GBP')).toBe('GBP');
  });

  test('policy updates keep the functional currency active and preserve an omitted enforcement flag', async () => {
    const current = {
      functionalCurrency: 'USD',
      reportingCurrency: 'USD',
      enabledCurrencies: [{ code: 'USD', isActive: true, paymentEnabled: true }],
      customCurrencies: [],
      requireConfiguredPaymentCurrency: false,
      save: jest.fn().mockResolvedValue(undefined),
    };
    jest.spyOn(organizationCurrencyService, 'getPolicy').mockResolvedValue(current);

    const updated = await organizationCurrencyService.updatePolicy('org-1', {
      enabledCurrencies: [{ code: 'USD', isActive: false, paymentEnabled: true }],
    }, { userId: 'admin-1' });

    expect(updated.enabledCurrencies).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'USD', isActive: true }),
    ]));
    expect(updated.requireConfiguredPaymentCurrency).toBe(false);
  });

  test('an inactive ISO currency cannot be selected for reporting', async () => {
    const current = {
      functionalCurrency: 'USD',
      reportingCurrency: 'USD',
      enabledCurrencies: [{ code: 'USD', isActive: true, paymentEnabled: true }],
      customCurrencies: [],
      requireConfiguredPaymentCurrency: true,
      save: jest.fn().mockResolvedValue(undefined),
    };
    jest.spyOn(organizationCurrencyService, 'getPolicy').mockResolvedValue(current);

    await expect(organizationCurrencyService.updatePolicy('org-1', {
      reportingCurrency: 'GBP',
      enabledCurrencies: [
        { code: 'USD', isActive: true, paymentEnabled: true },
        { code: 'GBP', isActive: false, paymentEnabled: true },
      ],
    })).rejects.toThrow(/reporting currency/i);
  });

  test('rejects malformed arrays and duplicate custom codes instead of deleting policy state', async () => {
    const current = {
      functionalCurrency: 'USD',
      reportingCurrency: 'USD',
      enabledCurrencies: [{ code: 'USD', isActive: true, paymentEnabled: true }],
      customCurrencies: [],
      requireConfiguredPaymentCurrency: true,
      save: jest.fn().mockResolvedValue(undefined),
    };
    jest.spyOn(organizationCurrencyService, 'getPolicy').mockResolvedValue(current);

    await expect(organizationCurrencyService.updatePolicy('org-1', {
      enabledCurrencies: { code: 'USD' },
    })).rejects.toThrow(/array/i);
    await expect(organizationCurrencyService.updatePolicy('org-1', {
      customCurrencies: [
        { code: 'QPX', name: 'Points', symbol: 'p', minorUnits: 0 },
        { code: 'QPX', name: 'Points again', symbol: 'q', minorUnits: 0 },
      ],
    })).rejects.toThrow(/unique/i);
  });

  test('blocks disabling a payment currency referenced by an active profile', async () => {
    const current = {
      functionalCurrency: 'USD',
      reportingCurrency: 'USD',
      enabledCurrencies: [
        { code: 'USD', isActive: true, paymentEnabled: true },
        { code: 'GBP', isActive: true, paymentEnabled: true },
      ],
      customCurrencies: [],
      requireConfiguredPaymentCurrency: true,
      save: jest.fn().mockResolvedValue(undefined),
    };
    jest.spyOn(organizationCurrencyService, 'getPolicy').mockResolvedValue(current);
    PayrollProfile.distinct.mockResolvedValue(['GBP']);

    await expect(organizationCurrencyService.updatePolicy('org-1', {
      enabledCurrencies: [{ code: 'USD', isActive: true, paymentEnabled: true }],
    })).rejects.toThrow(/active payroll profiles/i);
  });
});
