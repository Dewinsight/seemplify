jest.mock('../../models/PayrollEmployerEntity', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
}));

jest.mock('../OrganizationCurrencyService', () => ({
  assertPaymentCurrency: jest.fn(async (_organizationId, code) => code),
  getIsoCurrency: jest.fn((code) => ({ code, decimals: code === 'XAF' ? 0 : 2 })),
}));

jest.mock('../TaxJurisdictionService', () => ({
  resolveJurisdictionConfig: jest.fn(),
}));

const PayrollEmployerEntity = require('../../models/PayrollEmployerEntity');
const employerEntityService = require('../PayrollEmployerEntityService');
const taxJurisdictionService = require('../TaxJurisdictionService');
const {
  applyReadiness,
  isValidAbaRoutingNumber,
  isValidIban,
  reconcileProfile,
  validateBankAccount,
} = require('../PayrollCountryAutomationService');

function queryResult(rows) {
  return { sort: jest.fn().mockResolvedValue(rows) };
}

describe('Payroll country automation', () => {
  afterEach(() => jest.restoreAllMocks());

  beforeEach(() => {
    jest.clearAllMocks();
    PayrollEmployerEntity.find.mockReturnValue(queryResult([]));
    PayrollEmployerEntity.findOne.mockResolvedValue(null);
    taxJurisdictionService.resolveJurisdictionConfig.mockResolvedValue({
      config: { _id: 'tax-ng', displayName: 'Nigeria PAYE', countryName: 'Nigeria' },
      version: { calculationStatus: 'runnable' },
      employeeTaxInputs: { residencyStatus: 'resident' },
      validationErrors: [],
    });
  });

  test('derives Nigeria currency, tax pack, pension and bank country from one country selection', async () => {
    const employer = {
      _id: 'employer-ng',
      countryCode: 'NG',
      jurisdictionCode: 'NG-LA',
      defaultCurrency: 'NGN',
      taxJurisdictionConfigId: 'tax-ng',
      status: 'active',
    };
    PayrollEmployerEntity.find.mockReturnValue(queryResult([employer]));
    const profile = {
      currency: 'USD',
      employeeInfo: {},
      taxAssignment: {},
      taxConfig: {},
      statutoryContributions: {},
      bankAccounts: [{
        country: 'Nigeria', countryCode: 'NG', bankName: 'Access Bank', accountName: 'Ada Okafor',
        accountNumber: '1234567890', branchCode: '044', accountType: 'current', isPrimary: true,
      }],
      payrollFlags: { includeInNextRun: true },
    };

    const result = await reconcileProfile(profile, 'org-1', { countryHint: 'Nigeria' });

    expect(profile).toMatchObject({
      employerEntityId: 'employer-ng',
      currency: 'NGN',
      employeeInfo: { countryCode: 'NG', countryName: 'Nigeria' },
      taxAssignment: { workCountryCode: 'NG', workJurisdictionCode: 'NG-LA', taxJurisdictionCode: 'NG-LA' },
      taxConfig: { jurisdictionCode: 'NG', jurisdictionConfigId: 'tax-ng', calculationMode: 'configured' },
      statutoryContributions: { pensionOptIn: true, pensionContributionPercent: 8, employerPensionPercent: 10 },
      bankAccounts: [{ country: 'Nigeria', countryCode: 'NG' }],
    });
    expect(result).toMatchObject({ paymentReady: true, bankComplete: true, employerAmbiguous: false });
  });

  test('creates and assigns a safe draft employer when a supported country has no employer setup', async () => {
    const defaultEmployer = {
      _id: 'default-ng',
      countryCode: 'NG',
      jurisdictionCode: 'NG-LA',
      defaultCurrency: 'NGN',
      taxJurisdictionConfigId: 'tax-ng',
      status: 'draft',
    };
    const ensureDefaultDraft = jest.spyOn(employerEntityService, 'ensureDefaultDraft').mockResolvedValue(defaultEmployer);
    const profile = {
      currency: 'USD', employeeInfo: {}, taxAssignment: {}, taxConfig: {}, statutoryContributions: {},
      bankAccounts: [], payrollFlags: { includeInNextRun: false },
    };

    const result = await reconcileProfile(profile, 'org-1', {
      countryHint: 'Nigeria',
      autoCreateEmployer: true,
      actor: { userId: 'admin-1', organizationName: 'Example Limited' },
    });

    expect(ensureDefaultDraft).toHaveBeenCalledWith('org-1', 'NG', {
      userId: 'admin-1', organizationName: 'Example Limited',
    });
    expect(profile).toMatchObject({ employerEntityId: 'default-ng', currency: 'NGN' });
    expect(result.employer).toBe(defaultEmployer);
  });

  test('replaces an old employer assignment when the authoritative payroll country changes', async () => {
    PayrollEmployerEntity.findOne.mockResolvedValue({
      _id: 'employer-us', countryCode: 'US', jurisdictionCode: 'US', defaultCurrency: 'USD', status: 'active',
    });
    PayrollEmployerEntity.find.mockReturnValue(queryResult([{
      _id: 'employer-ng', countryCode: 'NG', jurisdictionCode: 'NG-LA', defaultCurrency: 'NGN', status: 'active',
    }]));
    const profile = {
      employerEntityId: 'employer-us', currency: 'USD', employeeInfo: {}, taxAssignment: {}, taxConfig: {},
      statutoryContributions: {}, bankAccounts: [], payrollFlags: { includeInNextRun: false },
    };

    await reconcileProfile(profile, 'org-1', { countryHint: 'Nigeria' });

    expect(profile).toMatchObject({
      employerEntityId: 'employer-ng',
      currency: 'NGN',
      employeeInfo: { countryCode: 'NG' },
      taxAssignment: { workCountryCode: 'NG', workJurisdictionCode: 'NG-LA' },
    });
  });

  test('validates local bank identifiers rather than accepting plausible-looking values', () => {
    expect(() => validateBankAccount({
      country: 'Nigeria', bankName: 'Access Bank', accountName: 'Ada Okafor',
      accountNumber: '1234', branchCode: '44',
    }, 'NG')).toThrow(expect.objectContaining({ code: 'PAYROLL_BANK_DETAILS_INVALID' }));

    expect(validateBankAccount({
      country: 'Canada', bankName: 'Example Bank', accountName: 'Taylor Smith',
      accountNumber: '1234567', branchCode: '00112345',
    }, 'CA')).toMatchObject({ complete: true });
  });

  test('uses checksum validation for ABA routing numbers and IBANs', () => {
    expect(isValidAbaRoutingNumber('021000021')).toBe(true);
    expect(isValidAbaRoutingNumber('021000022')).toBe(false);
    expect(isValidIban('GB82 WEST 1234 5698 7654 32')).toBe(true);
    expect(isValidIban('GB82 WEST 1234 5698 7654 33')).toBe(false);
  });

  test('holds a profile when the country has multiple legal employers', async () => {
    PayrollEmployerEntity.find.mockReturnValue(queryResult([
      { _id: 'one', countryCode: 'NG', status: 'active' },
      { _id: 'two', countryCode: 'NG', status: 'active' },
    ]));
    const profile = {
      currency: 'USD', employeeInfo: {}, taxAssignment: {}, taxConfig: {}, statutoryContributions: {},
      bankAccounts: [], payrollFlags: { includeInNextRun: true },
    };

    const result = await reconcileProfile(profile, 'org-1', { countryHint: 'NG' });
    const blockers = applyReadiness(profile, result);

    expect(result.employerAmbiguous).toBe(true);
    expect(profile.payrollFlags).toMatchObject({ includeInNextRun: false, requiresReview: true });
    expect(blockers.join(' ')).toMatch(/more than one legal employer/i);
    expect(profile.payrollFlags.reviewReason).toMatch(/^Automatic payroll setup:/);
  });

  test('clears an automatic review hold after setup is complete without clearing a manual hold', () => {
    const automaticProfile = {
      currency: 'NGN',
      payrollFlags: {
        includeInNextRun: false,
        requiresReview: true,
        reviewReason: 'Automatic payroll setup: Add the required local salary bank details.',
      },
    };
    applyReadiness(automaticProfile, {
      country: { countryCode: 'NG' }, employer: { _id: 'employer-ng' }, paymentReady: true,
      bankComplete: true, taxErrors: [], taxPackStatus: 'runnable',
    });
    expect(automaticProfile.payrollFlags).toMatchObject({ requiresReview: false, reviewReason: '' });

    const manualProfile = {
      currency: 'NGN',
      payrollFlags: { includeInNextRun: false, requiresReview: true, reviewReason: 'Confirm salary change.' },
    };
    applyReadiness(manualProfile, {
      country: { countryCode: 'NG' }, employer: { _id: 'employer-ng' }, paymentReady: true,
      bankComplete: true, taxErrors: [], taxPackStatus: 'runnable',
    });
    expect(manualProfile.payrollFlags).toMatchObject({ requiresReview: true, reviewReason: 'Confirm salary change.' });
  });
});
