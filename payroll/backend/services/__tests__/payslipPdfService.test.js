const { createPayslipPdf } = require('../payslipPdfService');

function makePayslip(overrides = {}) {
  return {
    payslipNumber: 'PS-2026-08-0001',
    status: 'paid',
    currency: 'USD',
    userId: 'employee-1',
    payPeriod: {
      startDate: new Date('2026-08-01T00:00:00Z'),
      endDate: new Date('2026-08-31T00:00:00Z'),
      paymentDate: new Date('2026-08-28T00:00:00Z'),
      month: 8,
      year: 2026,
    },
    employeeSnapshot: {
      name: 'Sample Employee',
      employeeId: 'EMP-001',
      department: 'Engineering',
      designation: 'Software Engineer',
      bankAccount: { bankName: 'Example Bank', accountNumber: '12345678' },
    },
    earnings: [{ type: 'basic', name: 'Basic salary', amount: 1000, taxable: true }],
    earningsSummary: { basicSalary: 1000, taxableGrossPay: 1000, grossPay: 1000 },
    deductions: [{ type: 'income_tax', name: 'Income tax', amount: 200 }],
    deductionsSummary: { taxDeductions: 200, totalDeductions: 200 },
    taxBreakdown: { netTaxableIncome: 1000, taxAmount: 200, jurisdictionCode: 'US' },
    employerContributions: [],
    totalEmployerContributions: 0,
    netPay: 800,
    ytdSummary: { grossEarnings: 8000, totalDeductions: 1600, totalTax: 1600, netPay: 6400 },
    paymentDetails: { method: 'bank_transfer' },
    ...overrides,
  };
}

function finishDocument(document) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    document.on('data', (chunk) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
    document.end();
  });
}

describe('payslipPdfService', () => {
  const organization = {
    name: 'Example Company',
    registrationNumber: '12345678',
    address: {
      line1: '1 Payroll Street',
      city: 'London',
      postalCode: 'EC1A 1AA',
      country: 'United Kingdom',
    },
  };

  test('renders a normal payslip on one A4 page', async () => {
    const document = createPayslipPdf({ payslip: makePayslip(), organization });

    expect(document.bufferedPageRange().count).toBe(1);
    const output = await finishDocument(document);
    expect(output.subarray(0, 4).toString()).toBe('%PDF');
    expect(output.length).toBeGreaterThan(3000);
  });

  test('adds controlled continuation pages for long deduction lists', async () => {
    const deductions = Array.from({ length: 27 }, (_, index) => ({
      type: 'other',
      name: `Deduction ${index + 1}`,
      amount: 10,
    }));
    const payslip = makePayslip({
      deductions,
      deductionsSummary: { totalDeductions: 270 },
      netPay: 730,
    });
    const document = createPayslipPdf({ payslip, organization });

    expect(document.bufferedPageRange().count).toBe(3);
    const output = await finishDocument(document);
    expect(output.subarray(0, 4).toString()).toBe('%PDF');
  });

  test('falls back to summary rows when detailed line items are unavailable', async () => {
    const payslip = makePayslip({
      earnings: [],
      earningsSummary: {
        basicSalary: 900,
        totalAllowances: 100,
        taxableGrossPay: 1000,
        grossPay: 1000,
      },
      deductions: [],
      deductionsSummary: {
        taxDeductions: 150,
        statutoryDeductions: 50,
        totalDeductions: 200,
      },
    });
    const document = createPayslipPdf({ payslip, organization });

    expect(document.bufferedPageRange().count).toBe(1);
    const output = await finishDocument(document);
    expect(output.subarray(0, 4).toString()).toBe('%PDF');
  });
});
