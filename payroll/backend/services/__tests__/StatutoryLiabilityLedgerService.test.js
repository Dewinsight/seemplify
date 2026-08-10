'use strict';

const statutoryMoneyService = require('../StatutoryMoneyService');
const ledgerService = require('../StatutoryLiabilityLedgerService');

const currency = { currency: 'KES', minorUnits: 2 };

function entry(overrides = {}) {
  return ledgerService.createEntry({
    liabilityCode: 'KE_AHL_EMPLOYEE',
    name: 'Affordable Housing Levy — employee',
    payer: 'employee',
    amount: statutoryMoneyService
      .create('1500.004', currency)
      .roundToMinorUnit({ mode: 'half_up', stage: 'ke.ahl.employee.final' }),
    baseAmount: '100000.00',
    rate: '0.015',
    authority: {
      code: 'KRA',
      name: 'Kenya Revenue Authority',
      level: 'national',
      jurisdictionCode: 'KE',
    },
    remittance: {
      formCode: 'AHL_MONTHLY',
      frequency: 'monthly',
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      dueDate: '2026-09-09',
      paymentChannel: 'iTax',
      accountReferenceField: 'KRA PIN',
    },
    calculation: {
      method: 'gross_salary_percent',
      roundingStage: 'ke.ahl.employee.final',
    },
    sourceReferences: ['Affordable Housing Act 2024 section 4'],
    sourceEffectiveFrom: '2024-03-19',
    ...overrides,
  }, currency);
}

describe('StatutoryLiabilityLedgerService', () => {
  test('preserves filing, authority, source, base, rate and rounding evidence', () => {
    const result = entry();

    expect(result.amount).toEqual({ amount: '1500.00', currency: 'KES', minorUnits: 2 });
    expect(result.baseAmount.amount).toBe('100000.00');
    expect(result.rate).toBe('0.015');
    expect(result.authority).toMatchObject({ code: 'KRA', jurisdictionCode: 'KE' });
    expect(result.remittance).toMatchObject({ formCode: 'AHL_MONTHLY', dueDate: '2026-09-09' });
    expect(result.calculation.roundingHistory).toEqual([
      expect.objectContaining({ stage: 'ke.ahl.employee.final', mode: 'half_up' }),
    ]);
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('groups liabilities by authority, form, period and due date with exact totals', () => {
    const employee = entry();
    const employer = entry({
      liabilityCode: 'KE_AHL_EMPLOYER',
      name: 'Affordable Housing Levy — employer',
      payer: 'employer',
      amount: '1500.00',
      calculation: { method: 'gross_salary_percent', roundingStage: 'ke.ahl.employer.final' },
    });

    const ledger = ledgerService.buildLedger([employee, employer]);

    expect(ledger.employeeTotal.amount).toBe('1500.00');
    expect(ledger.employerTotal.amount).toBe('1500.00');
    expect(ledger.combinedTotal.amount).toBe('3000.00');
    expect(ledger.filingGroups).toHaveLength(1);
    expect(ledger.filingGroups[0]).toMatchObject({
      liabilityCodes: ['KE_AHL_EMPLOYEE', 'KE_AHL_EMPLOYER'],
      combinedTotal: { amount: '3000.00' },
    });
  });

  test('keeps liabilities with different returns or due dates in separate filing groups', () => {
    const ahl = entry();
    const nita = entry({
      liabilityCode: 'KE_NITA_EMPLOYER',
      name: 'NITA levy',
      payer: 'employer',
      amount: '50.00',
      rate: '',
      authority: {
        code: 'NITA',
        name: 'National Industrial Training Authority',
        level: 'national',
        jurisdictionCode: 'KE',
      },
      remittance: {
        formCode: 'NITA_MONTHLY',
        frequency: 'monthly',
        periodStart: '2026-08-01',
        periodEnd: '2026-08-31',
        dueDate: '2026-08-31',
      },
      calculation: { method: 'fixed_employee_levy', roundingStage: 'ke.nita.final' },
      sourceReferences: ['Industrial Training (Levy) Order'],
    });

    expect(ledgerService.buildLedger([ahl, nita]).filingGroups).toHaveLength(2);
  });

  test.each([
    ['payer', { payer: 'government' }, /employee or employer/i],
    ['authority', { authority: { code: '', name: '', level: 'national', jurisdictionCode: 'KE' } }, /authority code/i],
    ['form', { remittance: { frequency: 'monthly', periodStart: '2026-08-01', periodEnd: '2026-08-31', dueDate: '2026-09-09' } }, /form code/i],
    ['source', { sourceReferences: [] }, /source reference/i],
  ])('fails closed when required %s metadata is missing', (_label, overrides, pattern) => {
    expect(() => entry(overrides)).toThrow(pattern);
  });

  test('rejects an unrounded amount with excess currency precision', () => {
    expect(() => entry({ amount: '10.001' })).toThrow(/excess precision/i);
  });

  test('rejects mixed-currency ledgers', () => {
    const kes = entry();
    const usd = {
      ...entry(),
      amount: { amount: '10.00', currency: 'USD', minorUnits: 2 },
    };

    expect(() => ledgerService.buildLedger([kes, usd])).toThrow(/cannot combine currencies/i);
  });

  test('rejects impossible remittance chronology', () => {
    expect(() => entry({
      remittance: {
        formCode: 'AHL_MONTHLY',
        frequency: 'monthly',
        periodStart: '2026-08-31',
        periodEnd: '2026-08-01',
        dueDate: '2026-09-09',
      },
    })).toThrow(/period start/i);
    expect(() => entry({
      remittance: {
        formCode: 'AHL_MONTHLY',
        frequency: 'monthly',
        periodStart: '2026-08-01',
        periodEnd: '2026-08-31',
        dueDate: '2026-08-30',
      },
    })).toThrow(/due date/i);
  });

  test('returns a typed empty ledger without inventing a currency', () => {
    expect(ledgerService.buildLedger([])).toEqual({
      currency: '',
      minorUnits: null,
      employeeTotal: null,
      employerTotal: null,
      combinedTotal: null,
      filingGroups: [],
      entries: [],
    });
  });
});
