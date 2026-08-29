const { resolveProfileHourlyRate } = require('../PayrollEngineService');

describe('payroll hourly rate resolution', () => {
  test('uses configured standard monthly hours for salaried overtime', () => {
    expect(resolveProfileHourlyRate(
      { workTerms: { standardHoursPerMonth: 160 } },
      { payBasis: 'salary' },
      3200
    )).toBe(20);
  });

  test('uses the configured hourly rate for hourly workers', () => {
    expect(resolveProfileHourlyRate(
      { workTerms: { standardHoursPerMonth: 160 } },
      { payBasis: 'hourly', rate: 18.5 },
      0
    )).toBe(18.5);
  });
});
