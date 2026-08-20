const {
  applyTaxWithholdingTreatment,
  resolveTaxWithholdingTreatment,
} = require('../TaxWithholdingTreatmentService');
const PayrollProfile = require('../../models/PayrollProfile');

describe('TaxWithholdingTreatmentService', () => {
  const calculatedTax = {
    incomeTax: { taxAmount: 125 },
    statutoryContributions: {
      components: [
        { payer: 'employee', name: 'Employee social security', amount: 40 },
        { payer: 'employer', name: 'Employer social security', amount: 55 },
      ],
    },
  };

  test('suppresses employee tax and statutory withholding while retaining employer liabilities', () => {
    const result = applyTaxWithholdingTreatment(calculatedTax, {
      withholdingMode: 'employee_responsible',
      withholdingReason: 'Independent contractor handles personal filings',
      withholdingEffectiveFrom: '2026-01-01',
    }, '2026-08-20');

    expect(result).toMatchObject({
      employeeResponsible: true,
      incomeTaxAmount: 0,
      employeeStatutoryAmount: 0,
      suppressedIncomeTax: 125,
      suppressedEmployeeStatutoryAmount: 40,
      reason: 'Independent contractor handles personal filings',
    });
    expect(result.statutoryComponents).toEqual([
      expect.objectContaining({ payer: 'employer', amount: 55 }),
    ]);
  });

  test('uses normal payroll withholding before the effective period and after it expires', () => {
    const config = {
      withholdingMode: 'employee_responsible',
      withholdingEffectiveFrom: '2026-06-01',
      withholdingEffectiveTo: '2026-06-30T23:59:59.999Z',
    };

    expect(resolveTaxWithholdingTreatment(config, '2026-05-31').employeeResponsible).toBe(false);
    expect(resolveTaxWithholdingTreatment(config, '2026-06-15').employeeResponsible).toBe(true);
    expect(resolveTaxWithholdingTreatment(config, '2026-07-01').employeeResponsible).toBe(false);
    expect(applyTaxWithholdingTreatment(calculatedTax, config, '2026-07-01')).toMatchObject({
      incomeTaxAmount: 125,
      employeeStatutoryAmount: 40,
    });
  });

  test('persists the employee treatment and its HR audit history on the payroll profile', () => {
    const profile = new PayrollProfile({
      userId: 'employee-1',
      organizationId: 'organization-1',
      taxConfig: {
        withholdingMode: 'employee_responsible',
        withholdingReason: 'Contractor handles personal tax filings',
        withholdingEffectiveFrom: '2026-08-01',
      },
      taxTreatmentHistory: [{
        previousMode: 'payroll_withholding',
        newMode: 'employee_responsible',
        reason: 'Contractor handles personal tax filings',
        effectiveFrom: '2026-08-01',
        changedBy: 'admin-1',
        changedByName: 'Payroll Admin',
      }],
    });
    const validationError = profile.validateSync();

    expect(validationError).toBeUndefined();
    expect(profile.taxConfig.withholdingMode).toBe('employee_responsible');
    expect(profile.taxTreatmentHistory).toHaveLength(1);
    expect(profile.taxTreatmentHistory[0]).toMatchObject({
      previousMode: 'payroll_withholding',
      newMode: 'employee_responsible',
      changedBy: 'admin-1',
    });
  });
});
