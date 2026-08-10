'use strict';

const {
  calculate,
  calculateMonthlyTablePaye,
  calculateAnnualTableTax,
  calculateUif,
  OFFICIAL_SOURCES,
  SouthAfricaPayrollAdapterError,
} = require('../countryAdapters/SouthAfrica2027PayrollAdapter');
const {
  SOURCE_URLS,
  buildBaseInput,
  publishedMonthlyGuideFixture,
  publishedCumulativeFixture,
  monthlyBoundaryFixtures,
  ageBoundaryFixtures,
} = require('../countryAdapters/fixtures/SouthAfrica2027OfficialFixtures');
const statutoryMoneyService = require('../StatutoryMoneyService');
const ANNUAL_TABLE_ROWS = require('../countryAdapters/fixtures/SouthAfrica2027AnnualTableRows');

const ZAR = Object.freeze({ currency: 'ZAR', minorUnits: 2 });

function liability(result, code) {
  return result.liabilityLedger.entries.find((entry) => entry.liabilityCode === code);
}

function expectAdapterError(fn, code) {
  try {
    fn();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(SouthAfricaPayrollAdapterError);
    expect(error.code).toBe(code);
  }
}

function withoutMedical(overrides = {}) {
  return buildBaseInput({
    medicalScheme: {
      personsCovered: 0,
      monthlyContributionPaidByTaxpayer: '0.00',
      registeredSchemeReference: '',
      evidenceReference: '',
    },
    ...overrides,
  });
}

function inputAtBalance(balance, overrides = {}) {
  return withoutMedical({
    remuneration: {
      ordinaryCashRemuneration: balance,
      allowableRetirementFundDeduction: '0.00',
      balanceOfRemunerationForPaye: balance,
      uifRemuneration: balance,
      sdlLeviableAmount: balance,
      retirementFundEvidenceReference: 'FIXTURE_NO_RETIREMENT_DEDUCTION_CERTIFIED',
    },
    ...overrides,
  });
}

describe('SouthAfrica2027PayrollAdapter official-source and release contract', () => {
  test('fixture URLs exactly match the adapter source registry', () => {
    expect(Object.keys(OFFICIAL_SOURCES).sort()).toEqual(Object.keys(SOURCE_URLS).sort());
    for (const [sourceId, source] of Object.entries(OFFICIAL_SOURCES)) {
      expect(source.url).toBe(SOURCE_URLS[sourceId]);
      expect(source.authority).toBe('South African Revenue Service');
      expect(new URL(source.url).hostname).toBe('www.sars.gov.za');
      expect(source.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(source.supports.length).toBeGreaterThan(0);
    }
  });

  test('ships the complete contiguous 1,635-row official annual annexure dataset', () => {
    expect(ANNUAL_TABLE_ROWS).toHaveLength(1635);
    expect(ANNUAL_TABLE_ROWS[0]).toEqual([84299, 84799, 0, 0, 0]);
    expect(ANNUAL_TABLE_ROWS.at(-1)).toEqual([2100433, 2103433, 749018, 739253, 736004]);
    for (let index = 1; index < ANNUAL_TABLE_ROWS.length; index += 1) {
      expect(ANNUAL_TABLE_ROWS[index][0]).toBe(ANNUAL_TABLE_ROWS[index - 1][1] + 1);
    }
  });

  test('is standalone, preview-only, immutable, and non-postable pending two credentialed reviewers', () => {
    const result = calculate(publishedMonthlyGuideFixture.input);
    expect(result.adapter).toMatchObject({
      code: 'ZA_2027_YOA_WAVE1_STANDALONE',
      jurisdictionCode: 'ZA',
      assessmentYear: 2027,
      integrationStatus: 'standalone_not_integrated',
      releaseStatus: 'preview_only_pending_credentialed_review',
      runnable: false,
      postingAllowed: false,
    });
    expect(result.releaseBlockingReasons).toEqual([
      expect.objectContaining({ code: 'ZA_CREDENTIALLED_TAX_LAW_REVIEW_REQUIRED', role: 'tax_law' }),
      expect.objectContaining({ code: 'ZA_CREDENTIALLED_PAYROLL_QA_REVIEW_REQUIRED', role: 'payroll_operations' }),
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.liabilityLedger.entries[0])).toBe(true);
  });
});

describe('SARS published 2027 PAYE golden fixtures', () => {
  test(publishedMonthlyGuideFixture.id, () => {
    const { expected } = publishedMonthlyGuideFixture;
    const result = calculate(publishedMonthlyGuideFixture.input);
    expect(result.remuneration.ordinaryCashRemuneration.amount).toBe(expected.ordinaryCashRemuneration);
    expect(result.remuneration.balanceOfRemunerationForPaye.amount).toBe(expected.balanceOfRemuneration);
    expect(result.paye.grossTableTax.amount).toBe(expected.tableTaxBeforeMedicalCredit);
    expect(result.paye.medicalCredit.amount).toBe(expected.medicalSchemeFeeTaxCredit);
    expect(result.paye.amount.amount).toBe(expected.paye);
    expect(result.uif.employee.amount).toBe(expected.uifEmployee);
    expect(result.uif.employer.amount).toBe(expected.uifEmployer);
    expect(result.sdl.amount.amount).toBe(expected.sdlEmployer);
    expect(result.totals.employeeStatutoryLiabilities.amount).toBe(expected.employeeStatutoryLiabilities);
    expect(result.totals.employerStatutoryCost.amount).toBe(expected.employerStatutoryCost);
    expect(result.totals.combinedStatutoryLiabilities.amount).toBe(expected.combinedStatutoryLiabilities);
    expect(result.period.dueDate).toBe(expected.emp201DueDate);
  });

  test(publishedCumulativeFixture.id, () => {
    const { expected } = publishedCumulativeFixture;
    const result = calculate(publishedCumulativeFixture.input);
    expect(result.paye.annualEquivalent.amount).toBe(expected.annualEquivalent);
    expect(result.paye.grossTableTax.amount).toBe(expected.annualTableTax);
    expect(result.paye.cumulativeTarget.amount).toBe(expected.cumulativeTaxForSevenMonths);
    expect(result.paye.amount.amount).toBe(expected.currentPayeTrueUp);
    expect(result.paye.annualTable.tableRow).toMatchObject({
      lower: '188507',
      upper: '189007',
      representative: '188757',
    });
  });

  test('subtracts signed prior posted PAYE from the cumulative final target', () => {
    const input = buildBaseInput(publishedCumulativeFixture.input);
    input.cumulative.payeWithheldBeforeCurrent = '8000.00';
    const result = calculate(input);
    expect(result.paye.cumulativeTarget.amount).toBe('9424.33');
    expect(result.paye.priorPaye.amount).toBe('8000.00');
    expect(result.paye.amount.amount).toBe('1424.33');
  });
});

describe('2027 monthly and annual SARS table ranges and exact rounding', () => {
  test.each(monthlyBoundaryFixtures)('$id', ({ balance, expectedTableTax, expectedLower, expectedUpper }) => {
    const result = calculate(inputAtBalance(balance));
    expect(result.paye.grossTableTax.amount).toBe(expectedTableTax);
    expect(result.paye.monthlyTable.tableRow).toMatchObject({
      lower: expectedLower,
      upper: expectedUpper,
    });
  });

  test('records cents-disregarded remuneration lookup and whole-rand table tax stages', () => {
    const result = calculate(inputAtBalance('17545.99'));
    expect(result.paye.monthlyTable.lookupAmount.amount).toBe('17545.00');
    expect(result.paye.monthlyTable.lookupAmount.roundingHistory).toEqual([
      expect.objectContaining({
        stage: 'za.paye.monthly_table.lookup_remuneration_cents_disregarded',
        mode: 'truncate',
        unit: '1',
      }),
    ]);
    expect(result.paye.grossTableTax.roundingHistory).toEqual([
      expect.objectContaining({ stage: 'za.paye.monthly_table.gross_tax_whole_rand', unit: '1' }),
    ]);
  });

  test('applies the annexure above-table formula and disregards result cents', () => {
    const table = calculateMonthlyTablePaye(
      statutoryMoneyService.create('226179.99', ZAR),
      40
    );
    expect(table.method).toBe('sars_monthly_table_inadequate_45_percent_formula');
    expect(table.amount.toFixed()).toBe('85376.00');
    expect(table.tableRow.representative).toBe('226078');
  });

  test('implements every published annual interval regime and the annual above-table formula', () => {
    const cases = [
      ['188571', '188507', '189007', '16156.00'],
      ['409949', '409949', '410949', '70656.00'],
      ['510049', '510049', '511549', '101764.00'],
      ['1012884', '1012884', '1014884', '293985.00'],
      ['1461108', '1461108', '1462608', '477654.00'],
      ['1629220', '1629220', '1631220', '546683.00'],
      ['1965388', '1965388', '1968388', '688248.00'],
    ];
    for (const [annual, lower, upper, tax] of cases) {
      const result = calculateAnnualTableTax(BigInt(annual), 40);
      expect(result.tableRow).toMatchObject({ lower, upper });
      expect(result.amount.toFixed()).toBe(tax);
    }
    const above = calculateAnnualTableTax(2103434n, 40);
    expect(above.method).toBe('sars_annual_table_inadequate_45_percent_formula');
    expect(above.amount.toFixed()).toBe('749693.00');
  });
});

describe('2027 age rebates and medical scheme fee tax credits', () => {
  test.each(ageBoundaryFixtures)('$id', ({ dateOfBirth, expectedAge, expectedAgeBand, expectedTableTax }) => {
    const result = calculate(withoutMedical({ employee: { dateOfBirth } }));
    expect(result.employee.ageAtAssessmentYearEnd).toBe(expectedAge);
    expect(result.employee.ageBand).toBe(expectedAgeBand);
    expect(result.paye.grossTableTax.amount).toBe(expectedTableTax);
  });

  test.each([
    [0, '0.00', '1660.00'],
    [1, '376.00', '1284.00'],
    [2, '752.00', '908.00'],
    [4, '1260.00', '400.00'],
    [10, '2784.00', '0.00'],
  ])('covers %i medical-scheme persons', (personsCovered, credit, paye) => {
    const result = calculate(buildBaseInput({
      medicalScheme: personsCovered === 0 ? {
        personsCovered: 0,
        monthlyContributionPaidByTaxpayer: '0.00',
        registeredSchemeReference: '',
        evidenceReference: '',
      } : {
        personsCovered,
        monthlyContributionPaidByTaxpayer: '900.00',
        registeredSchemeReference: 'CMS-REGISTERED-SCHEME-FIXTURE',
        evidenceReference: 'FIXTURE_MEDICAL_SCHEME_CONTRIBUTION_AND_BENEFICIARIES',
      },
    }));
    expect(result.medicalScheme.credit.amount).toBe(credit);
    expect(result.paye.amount.amount).toBe(paye);
  });

  test('fails closed for an age-65+ medical case that also requires additional medical credit', () => {
    expectAdapterError(
      () => calculate(buildBaseInput({ employee: { dateOfBirth: '1960-01-01' } })),
      'ZA_ADDITIONAL_MEDICAL_CREDIT_NOT_SUPPORTED'
    );
  });
});

describe('UIF and SDL contributions', () => {
  test.each([
    ['0.00', '0.00', '0.00'],
    ['10000.55', '100.01', '10000.55'],
    ['17711.99', '177.12', '17711.99'],
    ['17712.00', '177.12', '17712.00'],
    ['17712.01', '177.12', '17712.00'],
    ['50000.00', '177.12', '17712.00'],
  ])('UIF base %s produces %s per side', (remuneration, contribution, base) => {
    const result = calculateUif(statutoryMoneyService.create(remuneration, ZAR));
    expect(result.base.toFixed()).toBe(base);
    expect(result.employee.toFixed()).toBe(contribution);
    expect(result.employer.toFixed()).toBe(contribution);
    expect(result.employee.roundingHistory[0]).toMatchObject({
      stage: 'za.uif.one_percent_per_side',
      mode: 'half_up',
      unit: '0.01',
    });
  });

  test('applies employer-only SDL at 1% with a component-level liability', () => {
    const result = calculate(publishedMonthlyGuideFixture.input);
    expect(result.sdl.amount.amount).toBe('175.00');
    expect(liability(result, 'ZA_SDL_EMPLOYER')).toMatchObject({
      payer: 'employer',
      amount: { amount: '175.00', currency: 'ZAR' },
      baseAmount: { amount: '17500.00', currency: 'ZAR' },
      rate: '0.01',
      metadata: { irp5Code: '4142', sdlStatus: 'liable' },
    });
  });

  test('permits the threshold exemption at exactly R500,000 with evidence', () => {
    const result = calculate(buildBaseInput({
      employer: {
        sdlStatus: 'threshold_exempt',
        sdlRegistrationNumber: '',
        sdlRegistrationVerified: false,
        anticipatedLeviableRemunerationNext12Months: '500000.00',
        sdlStatusEvidenceReference: 'FIXTURE_REASONABLE_GROUNDS_THRESHOLD_EXEMPTION',
      },
    }));
    expect(result.sdl.amount.amount).toBe('0.00');
    expect(liability(result, 'ZA_SDL_EMPLOYER').amount.amount).toBe('0.00');
  });

  test('rejects an SDL threshold status inconsistent with the 12-month forecast', () => {
    expectAdapterError(() => calculate(buildBaseInput({
      employer: {
        sdlStatus: 'threshold_exempt',
        sdlRegistrationNumber: '',
        sdlRegistrationVerified: false,
        anticipatedLeviableRemunerationNext12Months: '500000.01',
        sdlStatusEvidenceReference: 'FIXTURE_INVALID_THRESHOLD_EXEMPTION',
      },
    })), 'ZA_SDL_STATUS_MISMATCH');
  });
});

describe('EMP201 component ledger and remittance metadata', () => {
  test('emits separate PAYE, employee UIF, employer UIF, and SDL entries', () => {
    const result = calculate(publishedMonthlyGuideFixture.input);
    expect(result.liabilityLedger.entries.map((entry) => entry.liabilityCode)).toEqual([
      'ZA_PAYE_EMPLOYEE',
      'ZA_UIF_EMPLOYEE',
      'ZA_UIF_EMPLOYER',
      'ZA_SDL_EMPLOYER',
    ]);
    for (const entry of result.liabilityLedger.entries) {
      expect(entry.authority).toMatchObject({
        code: 'SARS',
        level: 'national',
        jurisdictionCode: 'ZA',
      });
      expect(entry.remittance).toMatchObject({
        formCode: 'EMP201',
        frequency: 'monthly',
        periodStart: '2026-04-01',
        periodEnd: '2026-04-30',
        dueDate: '2026-05-07',
      });
      expect(entry.metadata).toMatchObject({ previewOnly: true, postingAllowed: false });
      expect(entry.sourceReferences.length).toBeGreaterThan(0);
      expect(entry.evidenceReference).toBeTruthy();
    }
  });

  test('moves a public-holiday seventh to the preceding business day', () => {
    const result = calculate(buildBaseInput({
      businessCalendar: {
        publicHolidays: ['2026-05-07'],
        evidenceReference: 'FIXTURE_2026_05_07_DECLARED_NON_BUSINESS_DAY',
      },
    }));
    expect(result.period.dueDate).toBe('2026-05-06');
  });

  test('moves a Sunday seventh to the preceding Friday', () => {
    const result = calculate(buildBaseInput({ payDate: '2027-01-31' }));
    expect(result.period.dueDate).toBe('2027-02-05');
  });
});

describe('Wave 1 fail-closed boundaries', () => {
  test.each([
    'bonusOrAnnualPayment',
    'directorRemuneration',
    'fringeBenefitsOrAllowances',
    'employmentTaxIncentive',
    'foreignOrExpat',
    'disabilityOrAdditionalMedicalCredit',
  ])('rejects unsupported remuneration feature %s', (feature) => {
    expectAdapterError(
      () => calculate(buildBaseInput({ unsupported: { [feature]: true } })),
      'ZA_UNSUPPORTED_REMUNERATION_CLASS'
    );
  });

  test.each([
    ['employer.payeRegistrationVerified', { employer: { payeRegistrationVerified: false } }],
    ['employer.uifRegistrationVerified', { employer: { uifRegistrationVerified: false } }],
    ['employer.registrationEvidenceReference', { employer: { registrationEvidenceReference: '' } }],
    ['remuneration.classificationCertified', { remuneration: { classificationCertified: false } }],
    ['remuneration.retirementDeductionCertified', { remuneration: { retirementDeductionCertified: false } }],
  ])('rejects missing or unverified employer/remuneration evidence: %s', (_name, override) => {
    expect(() => calculate(buildBaseInput(override))).toThrow(SouthAfricaPayrollAdapterError);
  });

  test('rejects a PAYE base not reconciled to ordinary remuneration and certified deduction', () => {
    expectAdapterError(
      () => calculate(buildBaseInput({ remuneration: { balanceOfRemunerationForPaye: '17499.99', sdlLeviableAmount: '17499.99' } })),
      'ZA_PAYE_BASE_MISMATCH'
    );
  });

  test('rejects a hidden/unknown input field', () => {
    expectAdapterError(
      () => calculate(buildBaseInput({ taxDirective: { percentage: '20' } })),
      'ZA_UNSUPPORTED_INPUT'
    );
  });

  test('rejects foreign residency even when unsupported flags are false', () => {
    expectAdapterError(
      () => calculate(buildBaseInput({ employee: { taxResidency: 'dual_resident' } })),
      'ZA_FOREIGN_OR_EXPAT_NOT_SUPPORTED'
    );
  });

  test('rejects UIF-excluded employees instead of silently charging or exempting them', () => {
    expectAdapterError(
      () => calculate(buildBaseInput({ remuneration: { hoursWorkedInMonth: '23.99' } })),
      'ZA_UIF_EXCLUSION_NOT_SUPPORTED'
    );
  });

  test('rejects cumulative calculations without posted-source evidence', () => {
    const input = buildBaseInput(publishedCumulativeFixture.input);
    input.cumulative.sourceReceiptEvidenceReference = '';
    expectAdapterError(() => calculate(input), 'ZA_CUMULATIVE_EVIDENCE_MISSING');
  });

  test('rejects pay dates outside the 2027 year of assessment', () => {
    expectAdapterError(
      () => calculate(buildBaseInput({ payDate: '2027-03-01' })),
      'ZA_OUTSIDE_2027_ASSESSMENT_YEAR'
    );
  });
});
