const ExcelJS = require('exceljs');
const { buildPayrollRegisterCsv, buildPayrollRegisterWorkbook } = require('../payrollExportService');

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
      deductions: [{
        type: 'payroll_tax',
        name: 'Employee levy',
        amount: 10,
        metadata: { liabilityCode: 'KE_AHL_EMPLOYEE', remittanceAuthority: 'Kenya Revenue Authority' },
      }],
      earningsSummary: { basicSalary: 2000, grossPay: 2000 },
      deductionsSummary: { totalDeductions: 10 },
      netPay: 1990,
      employerContributions: [{
        type: 'payroll_tax',
        name: 'Employer levy',
        amount: 10,
        liabilityCode: 'KE_AHL_EMPLOYER',
        remittanceAuthority: 'Kenya Revenue Authority',
      }],
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
      'Statutory liabilities',
      'Period summary',
      'Contract work',
    ]);
    expect(workbook.getWorksheet('Contract work').rowCount).toBe(2);
    expect(workbook.getWorksheet('Statutory liabilities').rowCount).toBe(3);
    expect(workbook.getWorksheet('Statutory liabilities').getRow(2).values).toEqual(expect.arrayContaining([
      'Employee', 'KE_AHL_EMPLOYEE', 'Kenya Revenue Authority',
    ]));

    const csv = buildPayrollRegisterCsv({
      payslips: [payslip],
      runById: new Map([['run-1', { runNumber: 'PR-2026-02-001', status: 'approved' }]]),
      profileByUserId: new Map(),
    }).csv;
    expect(csv).toContain('Payroll Tax / Levy (Employee)');
    expect(csv).toContain('KE_AHL_EMPLOYEE');
    expect(csv).toContain('KE_AHL_EMPLOYER');
  });
});
