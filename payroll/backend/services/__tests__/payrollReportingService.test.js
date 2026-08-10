jest.mock('../CurrencyService', () => ({
  convert: jest.fn(),
}));

jest.mock('../OrganizationCurrencyService', () => ({
  getPolicy: jest.fn(),
  assertReportingCurrency: jest.fn(),
  getMinorUnits: jest.fn(),
}));

const currencyService = require('../CurrencyService');
const organizationCurrencyService = require('../OrganizationCurrencyService');
const payrollReportingService = require('../PayrollReportingService');

function buildPayslip({
  id,
  userId,
  currency,
  paymentDate,
  grossPay,
  deductions,
  tax,
  netPay,
  employerContributions = 0,
  earningType = 'basic',
}) {
  return {
    _id: id,
    payslipNumber: id,
    userId,
    currency,
    payPeriod: { paymentDate: new Date(paymentDate), month: 1, year: 2026 },
    earningsSummary: { grossPay, basicSalary: grossPay },
    deductionsSummary: { totalDeductions: deductions },
    taxBreakdown: { taxAmount: tax },
    netPay,
    totalEmployerContributions: employerContributions,
    earnings: [{ type: earningType, name: 'Base pay', amount: grossPay }],
    deductions: [{ type: 'income_tax', name: 'Income tax', amount: tax }],
  };
}

describe('PayrollReportingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    organizationCurrencyService.getPolicy.mockResolvedValue({
      functionalCurrency: 'USD',
      reportingCurrency: 'USD',
    });
    organizationCurrencyService.assertReportingCurrency.mockImplementation(async (_organizationId, code) => code);
    organizationCurrencyService.getMinorUnits.mockImplementation(async (_organizationId, code) => (
      code === 'JPY' ? 0 : 2
    ));
  });

  test('converts every payslip at its payment-date rate and retains native buckets', async () => {
    const payslips = [
      buildPayslip({
        id: 'PS-USD', userId: 'u1', currency: 'USD', paymentDate: '2026-01-31',
        grossPay: 100, deductions: 20, tax: 10, netPay: 80, employerContributions: 5,
      }),
      buildPayslip({
        id: 'PS-GBP-JAN', userId: 'u2', currency: 'GBP', paymentDate: '2026-01-31',
        grossPay: 100, deductions: 20, tax: 10, netPay: 80, employerContributions: 5,
      }),
      buildPayslip({
        id: 'PS-GBP-FEB', userId: 'u2', currency: 'GBP', paymentDate: '2026-02-28',
        grossPay: 100, deductions: 20, tax: 10, netPay: 80, employerContributions: 5,
      }),
    ];
    currencyService.convert.mockImplementation(async (_org, amount, from, to, date) => ({
      rate: date.toISOString().startsWith('2026-01') ? 1.2 : 1.3,
      convertedAmount: amount * (date.toISOString().startsWith('2026-01') ? 1.2 : 1.3),
      originalCurrency: from,
      targetCurrency: to,
    }));

    const result = await payrollReportingService.preparePayslips('org-1', payslips);

    expect(result).toMatchObject({
      reportingCurrency: 'USD',
      hasAggregateTotals: true,
      isMultiCurrency: true,
      totals: {
        grossPay: 350,
        netPay: 280,
        totalDeductions: 70,
        totalTax: 35,
        totalEmployerContributions: 17.5,
        totalEmployerCost: 367.5,
      },
    });
    expect(result.currencyBreakdown).toEqual([
      expect.objectContaining({ currency: 'GBP', grossPay: 200, netPay: 160, payslipCount: 2 }),
      expect.objectContaining({ currency: 'USD', grossPay: 100, netPay: 80, payslipCount: 1 }),
    ]);
    expect(currencyService.convert).toHaveBeenCalledTimes(2);
    expect(currencyService.convert.mock.calls.map((call) => call[4].toISOString())).toEqual([
      '2026-01-31T00:00:00.000Z',
      '2026-02-28T00:00:00.000Z',
    ]);
  });

  test('returns null reporting totals and warnings when any historical rate is missing', async () => {
    const payslips = [
      buildPayslip({
        id: 'PS-USD', userId: 'u1', currency: 'USD', paymentDate: '2026-01-31',
        grossPay: 100, deductions: 20, tax: 10, netPay: 80,
      }),
      buildPayslip({
        id: 'PS-GHS', userId: 'u2', currency: 'GHS', paymentDate: '2026-01-31',
        grossPay: 1000, deductions: 200, tax: 100, netPay: 800,
      }),
    ];
    currencyService.convert.mockRejectedValue(new Error('No exchange rate found for GHS to USD'));

    const result = await payrollReportingService.preparePayslips('org-1', payslips);

    expect(result.hasAggregateTotals).toBe(false);
    expect(result.totals).toEqual({
      grossPay: null,
      netPay: null,
      totalDeductions: null,
      totalTax: null,
      totalEmployerContributions: null,
      totalEmployerCost: null,
    });
    expect(result.unconvertedCurrencies).toEqual(['GHS']);
    expect(result.conversionWarnings).toEqual([
      expect.objectContaining({
        code: 'MISSING_EXCHANGE_RATE',
        payslipId: 'PS-GHS',
        fromCurrency: 'GHS',
        toCurrency: 'USD',
      }),
    ]);
    expect(result.currencyBreakdown).toEqual([
      expect.objectContaining({ currency: 'GHS', grossPay: 1000, netPay: 800 }),
      expect.objectContaining({ currency: 'USD', grossPay: 100, netPay: 80 }),
    ]);

    const usdOnly = payrollReportingService.aggregatePreparedRows(
      result.rows.filter((row) => row.sourceCurrency === 'USD'),
      result
    );
    expect(usdOnly.hasAggregateTotals).toBe(true);
    expect(usdOnly.totals.grossPay).toBe(100);
  });

  test('does not convert a foreign-currency payslip without a payment date', async () => {
    const payslip = buildPayslip({
      id: 'PS-NO-DATE', userId: 'u1', currency: 'GBP', paymentDate: '2026-01-31',
      grossPay: 100, deductions: 20, tax: 10, netPay: 80,
    });
    payslip.payPeriod.paymentDate = null;

    const result = await payrollReportingService.preparePayslips('org-1', [payslip]);

    expect(result.hasAggregateTotals).toBe(false);
    expect(result.conversionWarnings[0]).toMatchObject({
      code: 'MISSING_PAYMENT_DATE',
      payslipId: 'PS-NO-DATE',
      paymentDate: null,
    });
    expect(currencyService.convert).not.toHaveBeenCalled();
  });

  test('does not silently treat a missing source currency as USD', async () => {
    const payslip = buildPayslip({
      id: 'PS-NO-CURRENCY', userId: 'u1', currency: 'USD', paymentDate: '2026-01-31',
      grossPay: 100, deductions: 20, tax: 10, netPay: 80,
    });
    payslip.currency = null;

    const result = await payrollReportingService.preparePayslips('org-1', [payslip]);

    expect(result.hasAggregateTotals).toBe(false);
    expect(result.currencyBreakdown[0]).toMatchObject({ currency: 'UNKNOWN', grossPay: 100 });
    expect(result.conversionWarnings[0]).toMatchObject({
      code: 'MISSING_SOURCE_CURRENCY',
      fromCurrency: 'UNKNOWN',
    });
    expect(currencyService.convert).not.toHaveBeenCalled();
  });

  test('applies configured minor units to native and reporting totals', async () => {
    organizationCurrencyService.getPolicy.mockResolvedValue({
      functionalCurrency: 'JPY',
      reportingCurrency: 'JPY',
    });
    const result = await payrollReportingService.preparePayslips('org-1', [
      buildPayslip({
        id: 'PS-JPY', userId: 'u1', currency: 'JPY', paymentDate: '2026-01-31',
        grossPay: 100.4, deductions: 20.4, tax: 10.4, netPay: 80.4,
      }),
    ]);

    expect(result.reportingMinorUnits).toBe(0);
    expect(result.totals).toMatchObject({
      grossPay: 100,
      totalDeductions: 20,
      totalTax: 10,
      netPay: 80,
    });
    expect(result.currencyBreakdown[0]).toMatchObject({
      currency: 'JPY',
      minorUnits: 0,
      grossPay: 100,
    });
  });

  test('falls back to income-tax deductions when the tax snapshot is null', async () => {
    const payslip = buildPayslip({
      id: 'PS-TAX', userId: 'u1', currency: 'USD', paymentDate: '2026-01-31',
      grossPay: 100, deductions: 20, tax: null, netPay: 80,
    });
    payslip.deductions[0].amount = 12;

    const result = await payrollReportingService.preparePayslips('org-1', [payslip]);

    expect(result.totals.totalTax).toBe(12);
  });

  test('line-item breakdowns use prepared reporting rates instead of mixing native amounts', async () => {
    currencyService.convert.mockResolvedValue({ rate: 2 });
    const result = await payrollReportingService.preparePayslips('org-1', [
      buildPayslip({
        id: 'PS-USD', userId: 'u1', currency: 'USD', paymentDate: '2026-01-31',
        grossPay: 100, deductions: 20, tax: 10, netPay: 80,
      }),
      buildPayslip({
        id: 'PS-GBP', userId: 'u2', currency: 'GBP', paymentDate: '2026-01-31',
        grossPay: 100, deductions: 20, tax: 10, netPay: 80,
      }),
    ]);

    expect(payrollReportingService.aggregateLineItems(result.rows, 'earnings')).toEqual([
      expect.objectContaining({
        type: 'basic',
        total: 300,
        currency: 'USD',
        hasAggregateTotals: true,
        currencyBreakdown: [
          { currency: 'GBP', total: 100 },
          { currency: 'USD', total: 100 },
        ],
      }),
    ]);
  });
});
