'use strict';

const {
  calculate,
  CanadaOntarioPayrollAdapterError,
  SOURCE_VERSIONS,
  OFFICIAL_SOURCES,
  LIMITS,
  selectFederalBracket,
  selectOntarioBracket,
} = require('../countryAdapters/Canada2026OntarioPayrollAdapter');
const fixtures = require('../countryAdapters/fixtures/Canada2026OntarioOfficialFixtures');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fixture(id) {
  const value = fixtures.goldenCases.find((item) => item.id === id);
  if (!value) throw new Error(`Unknown fixture ${id}`);
  return value;
}

function liability(result, code) {
  return result.liabilityLedger.entries.find((entry) => entry.liabilityCode === code);
}

function expectAdapterError(fn, code) {
  try {
    fn();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(CanadaOntarioPayrollAdapterError);
    expect(error.code).toBe(code);
  }
}

function baseInput() {
  return clone(fixtures.baseInput);
}

describe('Canada2026OntarioPayrollAdapter primary-source contract', () => {
  test('fixture registry is the exact adapter registry and uses official Canada hosts', () => {
    expect(fixtures.sourceRegistry).toEqual(OFFICIAL_SOURCES);
    for (const source of Object.values(OFFICIAL_SOURCES)) {
      expect(new URL(source.url).hostname).toBe('www.canada.ca');
      expect(source.effectiveFrom).toMatch(/^2026-\d{2}-\d{2}$/);
    }
  });

  test('pins the 122nd release before July and the 123rd release from July', () => {
    const january = calculate(baseInput());
    const july = calculate(clone(fixture('ON_MONTHLY_JUL_UNCHANGED_RULES_STEADY_PAY').input));
    expect(january.adapter.formulaSourceVersion).toBe(SOURCE_VERSIONS.JANUARY);
    expect(july.adapter.formulaSourceVersion).toBe(SOURCE_VERSIONS.JULY);
    expect(liability(july, 'CA_ON_INCOME_TAX').sourceReferences).toEqual(expect.arrayContaining([
      'CRA_T4127_123_JUL_2026',
      'CRA_T4127_122_JAN_2026',
      'CRA_T4032_ON_JAN_2026',
    ]));
    expect(liability(july, 'CA_ON_INCOME_TAX').sourceEffectiveFrom).toBe('2026-07-01');
    expect(liability(july, 'CA_CPP_EMPLOYEE').sourceEffectiveFrom).toBe('2026-01-01');
    expect(liability(july, 'CA_EI_EMPLOYER').sourceEffectiveFrom).toBe('2026-01-01');
  });

  test('is frozen, standalone, preview-only, and non-postable', () => {
    const result = calculate(baseInput());
    expect(result.adapter).toMatchObject({
      code: 'CA_ON_2026_STANDALONE_PREVIEW',
      integrationStatus: 'standalone_not_integrated',
      previewOnly: true,
      postable: false,
    });
    expect(result.adapter.confidence).toMatch(/^preview_pending_/);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.liabilityLedger.entries)).toBe(true);
  });

  test('publishes the official 2026 annual bases, rates, and maxima', () => {
    expect(LIMITS).toMatchObject({
      ybe: '3500.00', ympe: '74600.00', yampe: '85000.00',
      cppRate: '0.0595', cppMaximum: '4230.45', cpp2Rate: '0.0400', cpp2Maximum: '416.00',
      eiMaximumInsurableEarnings: '68900.00', eiEmployeeRate: '0.0163', eiEmployerRate: '0.02282',
      eiEmployeeMaximum: '1123.07', eiEmployerMaximum: '1572.30',
    });
    expect(calculate(baseInput()).annualParameters).toEqual(LIMITS);
  });

  test('treats published bracket ceilings as inclusive before advancing by one cent', () => {
    expect(selectFederalBracket('58523.00').rate).toBe('0.1400');
    expect(selectFederalBracket('58523.01').rate).toBe('0.2050');
    expect(selectFederalBracket('117045.00').rate).toBe('0.2050');
    expect(selectFederalBracket('117045.01').rate).toBe('0.2600');
    expect(selectOntarioBracket('53891.00').rate).toBe('0.0505');
    expect(selectOntarioBracket('53891.01').rate).toBe('0.0915');
    expect(selectOntarioBracket('220000.00').rate).toBe('0.1216');
    expect(selectOntarioBracket('220000.01').rate).toBe('0.1316');
  });
});

describe('Canada/Ontario independently calculated golden cases', () => {
  test.each(fixtures.goldenCases)('$id', ({ input, independentlyCalculated: expected }) => {
    const result = calculate(clone(input));
    const values = {
      cpp: result.employeeContributions.cpp.amount,
      cpp2: result.employeeContributions.cpp2.amount,
      eiEmployee: result.employeeContributions.ei.amount,
      eiEmployer: result.employerContributions.ei.amount,
      combinedIncomeTax: result.incomeTax.combined.amount,
      federalIncomeTaxAllocation: result.incomeTax.federal.amount,
      ontarioIncomeTaxAllocation: result.incomeTax.ontario.amount,
      employeeStatutoryDeductions: result.totals.employeeStatutoryDeductions.amount,
      netCashPay: result.totals.netCashPay.amount,
      employerStatutoryCost: result.totals.employerStatutoryCost.amount,
      remittanceDueDate: result.remittance.dueDate,
    };
    for (const [key, actual] of Object.entries(values)) {
      if (expected[key] !== undefined) expect(actual).toBe(expected[key]);
    }
    if (expected.employeeCpp2YtdAfter) expect(result.ytdAfterPeriod.employeeCpp2.amount).toBe(expected.employeeCpp2YtdAfter);
    if (expected.employeeEiYtdAfter) expect(result.ytdAfterPeriod.employeeEi.amount).toBe(expected.employeeEiYtdAfter);
    if (expected.employerEiYtdAfter) expect(result.ytdAfterPeriod.employerEi.amount).toBe(expected.employerEiYtdAfter);
    if (expected.cpp2Base) expect(liability(result, 'CA_CPP2_EMPLOYEE').baseAmount.amount).toBe(expected.cpp2Base);
    if (expected.annualOntarioHealthPremium) expect(result.incomeTax.factors.V2Exact).toBe(`${Number(expected.annualOntarioHealthPremium)}/1`);
    if (expected.annualOntarioSurtaxExact) expect(result.incomeTax.factors.V1Exact).toBe(expected.annualOntarioSurtaxExact);
  });

  test('federal plus Ontario allocation always equals the CRA combined withholding', () => {
    for (const item of fixtures.goldenCases) {
      const result = calculate(clone(item.input));
      const allocatedCents = BigInt(result.incomeTax.federal.amount.replace('.', ''))
        + BigInt(result.incomeTax.ontario.amount.replace('.', ''));
      expect(allocatedCents).toBe(BigInt(result.incomeTax.combined.amount.replace('.', '')));
    }
  });
});

describe('CPP, CPP2, EI, tax, and staged rounding', () => {
  test('truncates the monthly CPP basic exemption to CAD 291.66', () => {
    const result = calculate(baseInput());
    expect(liability(result, 'CA_CPP_EMPLOYEE').metadata.periodBasicExemption).toBe('291.66');
    expect(result.employeeContributions.cpp.amount).toBe('280.15');
  });

  test('does not deduct CPP at the exact monthly basic exemption', () => {
    const input = baseInput();
    input.grossCashPay = '291.66';
    input.pensionableEarnings = '291.66';
    input.insurableEarnings = '0.00';
    const result = calculate(input);
    expect(result.employeeContributions.cpp.amount).toBe('0.00');
  });

  test('rounds the first positive CPP half-cent boundary half-up', () => {
    const input = baseInput();
    input.grossCashPay = '291.75';
    input.pensionableEarnings = '291.75';
    input.insurableEarnings = '0.00';
    const result = calculate(input);
    expect(result.employeeContributions.cpp.amount).toBe('0.01');
    expect(result.employerContributions.cpp.amount).toBe('0.01');
  });

  test.each([
    ['monthly', 12, '291.66'],
    ['semi_monthly', 24, '145.83'],
    ['biweekly', 26, '134.61'],
    ['biweekly', 27, '129.62'],
    ['weekly', 52, '67.30'],
    ['weekly', 53, '66.03'],
  ])('uses the official %s/%i CPP period exemption %s', (frequency, periods, expectedExemption) => {
    const input = baseInput();
    input.payFrequency = frequency;
    input.payPeriodsPerYear = periods;
    input.payPeriodNumber = 1;
    if (frequency !== 'monthly') {
      input.payDate = '2026-01-09';
      input.payPeriod = { start: '2026-01-03', end: '2026-01-09', evidenceReference: 'PAYRUN-FREQUENCY-BOUNDARY' };
    }
    const result = calculate(input);
    expect(liability(result, 'CA_CPP_EMPLOYEE').metadata.periodBasicExemption).toBe(expectedExemption);
  });

  test('activates CPP2 only above YMPE and caps it at CAD 416 YTD', () => {
    const active = calculate(clone(fixture('ON_MONTHLY_CPP2_ACTIVE_AFTER_YMPE').input));
    const capped = calculate(clone(fixture('ON_MONTHLY_CPP2_AND_EI_FINAL_MAXIMUMS').input));
    expect(active.employeeContributions.cpp2.amount).toBe('320.00');
    expect(capped.employeeContributions.cpp2.amount).toBe('40.00');
    expect(capped.ytdAfterPeriod.employeeCpp2.amount).toBe('416.00');
    expect(capped.ytdAfterPeriod.employerCpp2.amount).toBe('416.00');
  });

  test('caps employee and employer EI independently at their annual maxima', () => {
    const result = calculate(clone(fixture('ON_MONTHLY_CPP2_AND_EI_FINAL_MAXIMUMS').input));
    expect(result.employeeContributions.ei.amount).toBe('3.07');
    expect(result.employerContributions.ei.amount).toBe('4.30');
    expect(result.ytdAfterPeriod.employeeEi.amount).toBe('1123.07');
    expect(result.ytdAfterPeriod.employerEi.amount).toBe('1572.30');
  });

  test('uses standard employer CPP matching and 1.4-times EI share', () => {
    const result = calculate(baseInput());
    expect(result.employerContributions.cpp.amount).toBe(result.employeeContributions.cpp.amount);
    expect(result.employerContributions.cpp2.amount).toBe(result.employeeContributions.cpp2.amount);
    expect(result.employeeContributions.ei.amount).toBe('81.50');
    expect(result.employerContributions.ei.amount).toBe('114.10');
  });

  test('applies requested additional TD1 tax to federal allocation', () => {
    const ordinary = calculate(baseInput());
    const input = baseInput();
    input.td1.additionalTaxPerPeriod = '25.00';
    const additional = calculate(input);
    expect(additional.incomeTax.combined.amount).toBe('718.33');
    expect(additional.incomeTax.federal.amount).toBe('469.86');
    expect(additional.incomeTax.ontario.amount).toBe(ordinary.incomeTax.ontario.amount);
  });

  test('calculates Ontario surtax and the top Ontario Health Premium', () => {
    const result = calculate(clone(fixture('ON_MONTHLY_HIGH_INCOME_SURTAX_AND_OHP').input));
    expect(result.incomeTax.factors.V1Exact).not.toBe('0/1');
    expect(result.incomeTax.factors.V2Exact).toBe('900/1');
    expect(result.incomeTax.brackets.ontario).toMatchObject({ rate: '0.1316', constant: '8076.00' });
  });

  test('Ontario Y dependants can only reduce Ontario tax, never OHP', () => {
    const withoutDependants = calculate(baseInput());
    const input = baseInput();
    input.td1.ontario.disabledDependants = 1;
    input.td1.ontario.dependantsUnder19 = 1;
    const withDependants = calculate(input);
    expect(withDependants.incomeTax.federal.amount).toBe(withoutDependants.incomeTax.federal.amount);
    expect(Number(withDependants.incomeTax.ontario.amount)).toBeLessThanOrEqual(Number(withoutDependants.incomeTax.ontario.amount));
    expect(withDependants.incomeTax.factors.V2Exact).toBe(withoutDependants.incomeTax.factors.V2Exact);
  });

  test('records named statutory rounding stages on all eight liabilities', () => {
    const result = calculate(baseInput());
    expect(result.liabilityLedger.entries).toHaveLength(8);
    for (const entry of result.liabilityLedger.entries) {
      expect(entry.calculation.roundingStage).toMatch(/^ca\./);
      expect(entry.calculation.roundingHistory.length).toBeGreaterThan(0);
      expect(entry.calculation.roundingHistory.at(-1).mode).toBe('half_up');
    }
  });
});

describe('liability and remittance metadata', () => {
  test('emits component-level employee and employer liabilities', () => {
    const result = calculate(baseInput());
    expect(result.liabilityLedger.entries.map((entry) => entry.liabilityCode).sort()).toEqual([
      'CA_CPP2_EMPLOYEE', 'CA_CPP2_EMPLOYER', 'CA_CPP_EMPLOYEE', 'CA_CPP_EMPLOYER',
      'CA_EI_EMPLOYEE', 'CA_EI_EMPLOYER', 'CA_FEDERAL_INCOME_TAX', 'CA_ON_INCOME_TAX',
    ]);
    expect(result.liabilityLedger.employeeTotal.amount).toBe('1054.98');
    expect(result.liabilityLedger.employerTotal.amount).toBe('394.25');
  });

  test('uses the calendar month, PD7A, regular-remitter rule, and next CRA business day', () => {
    const result = calculate(baseInput());
    for (const entry of result.liabilityLedger.entries) {
      expect(entry.remittance).toMatchObject({
        formCode: 'PD7A', frequency: 'monthly', periodStart: '2026-01-01', periodEnd: '2026-01-31', dueDate: '2026-02-17',
      });
      expect(entry.metadata).toMatchObject({
        remitterType: 'regular',
        dueRule: '15th_day_of_following_month_adjusted_to_next_CRA_business_day',
        previewOnly: true,
        postable: false,
      });
    }
  });

  test('carries TD1, YTD, employment, pay-period, calendar, remitter, and RP evidence', () => {
    const result = calculate(baseInput());
    expect(Object.values(result.evidence).every(Boolean)).toBe(true);
    expect(liability(result, 'CA_FEDERAL_INCOME_TAX').evidenceReference).toBe(fixtures.evidence.td1Federal);
    expect(liability(result, 'CA_ON_INCOME_TAX').evidenceReference).toBe(fixtures.evidence.td1Ontario);
    expect(liability(result, 'CA_CPP_EMPLOYEE').evidenceReference).toBe(fixtures.evidence.ytd);
  });
});

describe('fail-closed scope and evidence controls', () => {
  test.each([
    ['QC', 'CANADA_QUEBEC_BLOCKED'],
    ['BC', 'CANADA_UNSUPPORTED_PROVINCE'],
    ['AB', 'CANADA_UNSUPPORTED_PROVINCE'],
  ])('blocks province %s', (province, code) => {
    const input = baseInput();
    input.provinceOfEmployment = province;
    expectAdapterError(() => calculate(input), code);
  });

  test('blocks non-2026 pay dates', () => {
    const input = baseInput();
    input.payDate = '2027-01-31';
    input.payPeriod = { start: '2027-01-01', end: '2027-01-31', evidenceReference: 'P' };
    expectAdapterError(() => calculate(input), 'CANADA_UNSUPPORTED_TAX_YEAR');
  });

  test.each([
    ['2026-01-31', SOURCE_VERSIONS.JULY],
    ['2026-07-31', SOURCE_VERSIONS.JANUARY],
    ['2026-07-31', 'unversioned-current'],
  ])('rejects source release %s / %s mismatch', (payDate, version) => {
    const input = baseInput();
    input.payDate = payDate;
    input.formulaSourceVersion = version;
    input.payPeriod = payDate.startsWith('2026-07')
      ? { start: '2026-07-01', end: '2026-07-31', evidenceReference: 'P' }
      : input.payPeriod;
    expectAdapterError(() => calculate(input), 'CANADA_FORMULA_SOURCE_NOT_PINNED');
  });

  test('requires explicit component arrays', () => {
    for (const key of ['benefits', 'deductions', 'nonPeriodicPayments']) {
      const input = baseInput();
      delete input[key];
      expectAdapterError(() => calculate(input), 'CANADA_COMPONENT_DECLARATION_REQUIRED');
    }
  });

  test.each([
    ['benefits', { type: 'vehicle', value: '100.00' }, 'CANADA_UNSUPPORTED_TAXABLE_BENEFIT'],
    ['deductions', { type: 'RPP', value: '100.00' }, 'CANADA_UNSUPPORTED_DEDUCTION'],
    ['nonPeriodicPayments', { type: 'bonus', value: '100.00' }, 'CANADA_UNSUPPORTED_NON_PERIODIC_PAYMENT'],
  ])('rejects nonempty %s', (key, item, code) => {
    const input = baseInput();
    input[key] = [item];
    expectAdapterError(() => calculate(input), code);
  });

  test('requires both signed 2026 TD1 records and their evidence', () => {
    let input = baseInput();
    delete input.td1;
    expectAdapterError(() => calculate(input), 'CANADA_REQUIRED_EVIDENCE');
    input = baseInput();
    input.td1.federal.evidenceReference = '';
    expectAdapterError(() => calculate(input), 'CANADA_REQUIRED_EVIDENCE');
    input = baseInput();
    input.td1.ontario.taxYear = 2025;
    expectAdapterError(() => calculate(input), 'CANADA_TD1_NOT_2026');
  });

  test('rejects claim-code E and future-dated TD1 evidence', () => {
    let input = baseInput();
    input.td1.federal.claimExempt = true;
    expectAdapterError(() => calculate(input), 'CANADA_UNSUPPORTED_TD1_EXEMPTION');
    input = baseInput();
    input.td1.ontario.signedAt = '2026-02-01';
    expectAdapterError(() => calculate(input), 'CANADA_INVALID_TD1');
  });

  test.each([
    ['type', 'commission', 'CANADA_UNSUPPORTED_PAY_TYPE'],
    ['cppContributoryMonths', 11, 'CANADA_UNSUPPORTED_CPP_STATUS'],
    ['eiReducedRate', true, 'CANADA_UNSUPPORTED_EI_RATE'],
    ['provinceTransfer', true, 'CANADA_UNSUPPORTED_PROVINCE_TRANSFER'],
  ])('rejects unsupported employment.%s', (key, value, code) => {
    const input = baseInput();
    input.employment[key] = value;
    expectAdapterError(() => calculate(input), code);
  });

  test('requires an evidenced regular remitter and evidenced RP account', () => {
    let input = baseInput();
    input.remitterProfile.type = 'threshold_1';
    expectAdapterError(() => calculate(input), 'CANADA_UNSUPPORTED_REMITTER_TYPE');
    input = baseInput();
    input.remitterProfile.payrollProgramAccountEvidenceReference = '';
    expectAdapterError(() => calculate(input), 'CANADA_REQUIRED_EVIDENCE');
  });

  test('requires a complete evidenced YTD record and rejects amounts over annual maxima', () => {
    let input = baseInput();
    input.ytd.evidenceReference = '';
    expectAdapterError(() => calculate(input), 'CANADA_REQUIRED_EVIDENCE');
    input = baseInput();
    input.ytd.employeeEi = '1123.08';
    expectAdapterError(() => calculate(input), 'CANADA_YTD_OVER_MAXIMUM');
  });

  test('rejects unsupported corrected CPP YTD where employer and employee do not match', () => {
    const input = baseInput();
    input.ytd.employeeCpp = '1.00';
    expectAdapterError(() => calculate(input), 'CANADA_UNSUPPORTED_YTD_CORRECTION');
  });

  test('requires an explicit evidenced CRA-recognized holiday calendar', () => {
    let input = baseInput();
    delete input.businessCalendar.recognizedHolidays;
    expectAdapterError(() => calculate(input), 'CANADA_REQUIRED_EVIDENCE');
    input = baseInput();
    input.businessCalendar.evidenceReference = '';
    expectAdapterError(() => calculate(input), 'CANADA_REQUIRED_EVIDENCE');
  });

  test('requires exact decimal strings and cent precision', () => {
    let input = baseInput();
    input.grossCashPay = 5000;
    expectAdapterError(() => calculate(input), 'CANADA_INVALID_MONEY');
    input = baseInput();
    input.grossCashPay = '5000.001';
    expectAdapterError(() => calculate(input), 'CANADA_INVALID_MONEY');
  });

  test('rejects unsupported keys, frequency combinations, and invalid bases', () => {
    let input = baseInput();
    input.taxOverride = '0.00';
    expectAdapterError(() => calculate(input), 'CANADA_UNSUPPORTED_INPUT');
    input = baseInput();
    input.payPeriodsPerYear = 13;
    expectAdapterError(() => calculate(input), 'CANADA_UNSUPPORTED_PAY_FREQUENCY');
    input = baseInput();
    input.pensionableEarnings = '5000.01';
    expectAdapterError(() => calculate(input), 'CANADA_INVALID_EARNINGS_BASE');
  });

  test('rejects a pay date outside the evidenced pay period', () => {
    const input = baseInput();
    input.payPeriod.end = '2026-01-30';
    expectAdapterError(() => calculate(input), 'CANADA_INVALID_PAY_PERIOD');
  });

  test('rejects a calculation whose deductions would make net pay negative', () => {
    const input = baseInput();
    input.grossCashPay = '1.00';
    input.pensionableEarnings = '0.00';
    input.insurableEarnings = '0.00';
    input.td1.additionalTaxPerPeriod = '10.00';
    expectAdapterError(() => calculate(input), 'CANADA_NEGATIVE_NET_PAY');
  });
});
