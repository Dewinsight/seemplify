const {
  calculateContractBasePay,
  getContractOverlap,
  hasPayConfiguration,
} = require('../contractPayService');

const february = {
  startDate: new Date('2026-02-01T00:00:00.000Z'),
  endDate: new Date('2026-02-28T00:00:00.000Z'),
};

describe('contractPayService', () => {
  test('calculates approved hourly units', () => {
    const result = calculateContractBasePay(
      { workTerms: { payBasis: 'hourly', rate: 25 } },
      february,
      { regularHours: 80 }
    );
    expect(result).toMatchObject({ eligible: true, amount: 2000, units: 80, unitLabel: 'hours' });
  });

  test('requires period input for hourly workers', () => {
    expect(() => calculateContractBasePay(
      { workTerms: { payBasis: 'hourly', rate: 25 } },
      february,
      {}
    )).toThrow('Regular hours are required');
  });

  test('calculates daily-paid work', () => {
    const result = calculateContractBasePay(
      { workTerms: { payBasis: 'daily', rate: 180 } },
      february,
      { daysWorked: 12.5 }
    );
    expect(result.amount).toBe(2250);
  });

  test('spreads a fixed contract total across overlapping calendar days', () => {
    const result = calculateContractBasePay({
      workTerms: {
        payBasis: 'fixed_contract',
        contractAmount: 9000,
        contractAmountFrequency: 'contract_total',
        contractStartDate: '2026-01-01',
        contractEndDate: '2026-03-31',
      },
    }, february);
    expect(result.amount).toBe(2800);
    expect(result.units).toBe(28);
  });

  test('excludes contracts outside the pay period', () => {
    const overlap = getContractOverlap({
      contractStartDate: '2026-03-01',
      contractEndDate: '2026-03-31',
    }, february.startDate, february.endDate);
    expect(overlap.active).toBe(false);
  });

  test('recognizes non-salary profiles as payroll-ready', () => {
    expect(hasPayConfiguration({ basicSalary: 0, workTerms: { payBasis: 'hourly', rate: 20 } })).toBe(true);
    expect(hasPayConfiguration({ basicSalary: 0, workTerms: { payBasis: 'fixed_contract', contractAmount: 5000 } })).toBe(true);
    expect(hasPayConfiguration({ basicSalary: 0, workTerms: { payBasis: 'salary' } })).toBe(false);
  });
});
