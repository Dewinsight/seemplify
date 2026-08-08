const ExcelJS = require('exceljs');
const { buildPayrollRegisterWorkbook } = require('../payrollExportService');

describe('payroll export workbook', () => {
  test('includes register, period summary, and contract work sheets', async () => {
    const payslip = {
      payrollRunId: 'run-1',
      userId: 'user-1',
      payslipNumber: 'PS-2026-02-001',
      status: 'approved',
      currency: 'USD',
      payPeriod: { month: 2, year: 2026, startDate: '2026-02-01', endDate: '2026-02-28' },
      employeeSnapshot: { name: 'Contract Worker', employmentType: 'contract' },
      calculationBasis: { payBasis: 'hourly', rate: 25, units: 80, unitLabel: 'hours' },
      earnings: [{ type: 'basic', amount: 2000 }],
      deductions: [],
      earningsSummary: { basicSalary: 2000, grossPay: 2000 },
      deductionsSummary: { totalDeductions: 0 },
      netPay: 2000,
      employerContributions: [],
    };
    const buffer = await buildPayrollRegisterWorkbook({
      payslips: [payslip],
      runById: new Map([['run-1', { runNumber: 'PR-2026-02-001', status: 'approved' }]]),
      profileByUserId: new Map(),
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    expect(workbook.worksheets.map(sheet => sheet.name)).toEqual([
      'Payroll register',
      'Period summary',
      'Contract work',
    ]);
    expect(workbook.getWorksheet('Contract work').rowCount).toBe(2);
  });
});
