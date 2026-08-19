const Payslip = require('../../models/Payslip');
const currencyService = require('../CurrencyService');
const taxCalculationService = require('../TaxCalculationService');
const taxJurisdictionService = require('../TaxJurisdictionService');
const PayrollEngineService = require('../PayrollEngineService');
const organizationCurrencyService = require('../OrganizationCurrencyService');
const { isVariableCompensationEnabled, daysBetweenInclusive, employmentPeriod } = require('../PayrollEngineService');

describe('payroll compliance calculations', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('non-cash benefits increase the taxable base without increasing employee cash pay', () => {
    const payslip = new Payslip({
      payslipNumber: 'PS-2026-08-TEST',
      payrollRunId: '66b5b1d0a3f771ac83111111',
      userId: 'employee-1',
      organizationId: 'org-1',
      payPeriod: {
        type: 'monthly',
        startDate: new Date('2026-08-01'),
        endDate: new Date('2026-08-31'),
        paymentDate: new Date('2026-08-31'),
        month: 8,
        year: 2026,
      },
      employeeSnapshot: { name: 'Test Employee' },
      earnings: [],
      deductions: [],
      employerContributions: [],
    });

    payslip.addEarning('basic', 'Basic Salary', 1000, { taxable: true });
    payslip.addEarning('benefit_in_kind', 'Employer housing', 200, {
      taxable: true,
      taxableAmount: 100,
      cashPayable: false,
      classificationCode: 'housing_benefit',
    });

    expect(payslip.earningsSummary.cashGrossPay).toBe(1000);
    expect(payslip.earningsSummary.taxableGrossPay).toBe(1100);
    expect(payslip.earningsSummary.taxableBenefits).toBe(100);
    expect(payslip.netPay).toBe(1000);
  });

  test('bonus, commission, and overtime controls are independent', () => {
    const settings = { includeBonuses: true, includeCommissions: false, includeOvertime: false };
    expect(isVariableCompensationEnabled('bonus', settings)).toBe(true);
    expect(isVariableCompensationEnabled('incentive', settings)).toBe(true);
    expect(isVariableCompensationEnabled('commission', settings)).toBe(false);
    expect(isVariableCompensationEnabled('overtime', settings)).toBe(false);
  });

  test('statutory rules run in legal currency and return converted payroll liabilities with an FX trace', async () => {
    jest.spyOn(currencyService, 'convert').mockResolvedValue({
      originalAmount: 1,
      originalCurrency: 'USD',
      convertedAmount: 130,
      targetCurrency: 'KES',
      rate: 130,
      effectiveDate: new Date('2026-08-31'),
      source: 'manual',
      exchangeRateId: 'rate-1',
    });
    const kenya = taxJurisdictionService.seedDefinitions.find((entry) => entry.countryCode === 'KE');

    const result = await taxCalculationService.calculatePayrollTaxes({
      organizationId: 'org-1',
      currency: 'USD',
      grossPay: 1000,
      taxableIncome: 1000,
      basicSalary: 1000,
      preTaxDeductions: 0,
      statutoryBases: { pensionablePay: 1000, socialSecurityPay: 1000, insurablePay: 1000 },
      statutoryContributions: {},
      payFrequency: 'monthly',
      paymentDate: new Date('2026-08-31'),
      taxConfig: {
        jurisdictionCode: 'KE',
        employeeTaxInputs: {
          residencyStatus: 'resident',
          monthlyMortgageInterest: 0,
          monthlyRegisteredPension: 0,
          monthlyPostRetirementMedicalFund: 0,
          annualQualifyingInsurancePremium: 0,
          additionalWithholding: 0,
        },
      },
      versionDefinition: kenya.version,
      configDefinition: kenya,
    });

    const employerAhl = result.statutoryContributions.components
      .find((component) => component.liabilityCode === 'KE_AHL_EMPLOYER');
    expect(result.calculationCurrency).toBe('KES');
    expect(result.payrollCurrency).toBe('USD');
    expect(result.currencyConversion).toMatchObject({ from: 'USD', to: 'KES', rate: 130, exchangeRateId: 'rate-1' });
    expect(employerAhl).toMatchObject({ calculationAmount: 1950, amount: 15, calculationCurrency: 'KES', payrollCurrency: 'USD' });
    expect(result.payrollRunnable).toBe(true);
    expect(result.compliance.calculationStatus).toBe('runnable');
  });

  test('stored and reporting amounts preserve zero- and three-decimal units', () => {
    const makePayslip = (currency, amount) => new Payslip({
      payslipNumber: `PS-2026-08-${currency}`,
      payrollRunId: '66b5b1d0a3f771ac83111111',
      userId: `employee-${currency}`,
      organizationId: 'org-1',
      currency,
      payPeriod: {
        type: 'monthly', startDate: new Date('2026-08-01'), endDate: new Date('2026-08-31'),
        paymentDate: new Date('2026-08-31'), month: 8, year: 2026,
      },
      employeeSnapshot: { name: currency },
      earnings: [{ type: 'basic', name: 'Basic', amount, taxableAmount: amount }],
      deductions: [],
      employerContributions: [],
    });
    const jpy = makePayslip('JPY', 1000.6).normalizeCurrencyAmounts();
    const bhd = makePayslip('BHD', 1.2346).normalizeCurrencyAmounts();

    expect(jpy.earnings[0].amount).toBe(1001);
    expect(bhd.earnings[0].amount).toBe(1.235);
  });

  test('run summaries retain three-decimal amounts instead of truncating to cents', async () => {
    jest.spyOn(organizationCurrencyService, 'getMinorUnits').mockResolvedValue(3);
    const run = {
      organizationId: 'org-1',
      payPeriod: { paymentDate: new Date('2026-08-31') },
      settings: {},
      summary: {},
    };
    const payslips = [1.001, 1.002].map((grossPay) => ({
      currency: 'BHD',
      earningsSummary: { grossPay },
      deductionsSummary: { totalDeductions: 0 },
      netPay: grossPay,
      taxBreakdown: { taxAmount: 0 },
      totalEmployerContributions: 0,
    }));

    await new PayrollEngineService().applyRunCurrencySummary(run, payslips);
    expect(run.summary.totalGrossPayroll).toBe(2.003);
    expect(run.summary.currencyBreakdown[0].totalGrossPayroll).toBe(2.003);
  });

  test('employment proration is UTC date-only and excludes employees outside the pay period', () => {
    expect(daysBetweenInclusive('2026-03-01T00:00:00Z', '2026-03-31T00:00:00Z')).toBe(31);
    expect(employmentPeriod({ employeeInfo: { dateOfJoining: '2026-09-01' } }, '2026-08-01', '2026-08-31'))
      .toMatchObject({ eligible: false, employedDays: 0, factor: 0 });
    expect(employmentPeriod({ terminationDate: '2026-07-31' }, '2026-08-01', '2026-08-31'))
      .toMatchObject({ eligible: false, employedDays: 0, factor: 0 });
    expect(employmentPeriod({ employeeInfo: { dateOfJoining: '2026-08-16' } }, '2026-08-01', '2026-08-31'))
      .toMatchObject({ eligible: true, employedDays: 16, factor: 16 / 31 });
  });
});
