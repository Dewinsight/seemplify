'use strict';

const usFederal2026 = require('../tax/adapters/USFederalPayrollAdapter2026');

const P15T_URL = 'https://www.irs.gov/pub/irs-pdf/p15t.pdf';
const P15_URL = 'https://www.irs.gov/publications/p15';

const OFFICIAL_CASES = Object.freeze({
  STANDARD: Object.freeze({
    fixtureId: 'US26-P15T-W1A-SINGLE-BIWEEKLY-001',
    officialRuleId: 'IRS-P15T-2026-WORKSHEET-1A',
    sourceUrl: P15T_URL,
  }),
  ADJUSTMENTS: Object.freeze({
    fixtureId: 'US26-P15T-W1A-STEPS-3-4-002',
    officialRuleId: 'IRS-P15T-2026-WORKSHEET-1A',
    sourceUrl: P15T_URL,
  }),
  MULTIPLE_JOBS: Object.freeze({
    fixtureId: 'US26-P15T-W1A-STEP2-CHECKBOX-003',
    officialRuleId: 'IRS-P15T-2026-WORKSHEET-1A',
    sourceUrl: P15T_URL,
  }),
  BRIDGE: Object.freeze({
    fixtureId: 'US26-P15T-COMPUTATIONAL-BRIDGE-004',
    officialRuleId: 'IRS-P15T-2026-COMPUTATIONAL-BRIDGE-W4-2019',
    sourceUrl: P15T_URL,
  }),
  NRA: Object.freeze({
    fixtureId: 'US26-P15T-NRA-TABLE2-BIWEEKLY-005',
    officialRuleId: 'IRS-P15T-2026-NRA-TABLE-2',
    sourceUrl: P15T_URL,
  }),
  SUPPLEMENTAL_EXAMPLE_3: Object.freeze({
    fixtureId: 'IRS-P15-2026-SECTION7-EXAMPLE-3',
    officialRuleId: 'IRS-P15-2026-SUPPLEMENTAL-WAGES',
    sourceUrl: P15_URL,
  }),
  FICA: Object.freeze({
    fixtureId: 'US26-P15-FICA-WAGE-BASE-CROSSING-006',
    officialRuleId: 'IRS-P15-2026-FICA',
    sourceUrl: P15_URL,
  }),
  FUTA: Object.freeze({
    fixtureId: 'US26-P15-FUTA-GENERAL-BASE-CROSSING-007',
    officialRuleId: 'IRS-P15-2026-FUTA',
    sourceUrl: P15_URL,
  }),
});

function certifiedCompanion(kind, jurisdictionCode, overrides = {}) {
  return {
    kind,
    jurisdictionCode,
    applicability: 'applicable',
    certificationStatus: 'certified',
    certificationId: `cert-${kind}-${jurisdictionCode}`,
    versionId: `2026-${jurisdictionCode}`,
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-12-31',
    ...overrides,
  };
}

function companions(overrides = {}) {
  return {
    stateWithholding: certifiedCompanion('state_withholding', 'US-NY'),
    localWithholding: certifiedCompanion('local_withholding', 'US-NY-NYC'),
    stateUnemployment: certifiedCompanion('state_unemployment', 'US-NY', { futaCreditRate: '0.054' }),
    ...overrides,
  };
}

function payload(overrides = {}) {
  const base = {
    taxYear: 2026,
    payDate: '2026-01-15',
    payFrequency: 'biweekly',
    regularTaxableWages: '2500.00',
    ficaTaxableWages: '2500.00',
    futaTaxableWages: '2500.00',
    ytd: {
      socialSecurityWages: '0.00',
      medicareWages: '0.00',
      futaWages: '0.00',
      supplementalWagesCommonControl: '0.00',
    },
    w4: {
      version: '2020_or_later',
      filingStatus: 'single_or_married_filing_separately',
      multipleJobs: false,
      credits: '0.00',
      otherIncome: '0.00',
      deductions: '0.00',
      additionalWithholding: '0.00',
      exempt: false,
    },
    nonresidentAlien: { applies: false },
    supplemental: {
      taxableWages: '0.00',
      method: 'optional_flat',
      regularIncomeTaxWithheldInCurrentOrPriorYear: true,
    },
    employerFuta: {
      category: 'general',
      maxQuarterlyWages2025: '0.00',
      maxQuarterlyWages2026: '1500.00',
      weeksWithEmployee2025: 0,
      weeksWithEmployee2026: 0,
    },
    workLocation: {
      countryCode: 'US',
      subdivisionCode: 'US-NY',
      localityCode: 'US-NY-NYC',
    },
    companionAdapters: companions(),
  };

  return {
    ...base,
    ...overrides,
    ytd: { ...base.ytd, ...(overrides.ytd || {}) },
    w4: { ...base.w4, ...(overrides.w4 || {}) },
    nonresidentAlien: { ...base.nonresidentAlien, ...(overrides.nonresidentAlien || {}) },
    supplemental: { ...base.supplemental, ...(overrides.supplemental || {}) },
    employerFuta: { ...base.employerFuta, ...(overrides.employerFuta || {}) },
    workLocation: { ...base.workLocation, ...(overrides.workLocation || {}) },
  };
}

function entry(result, liabilityCode) {
  return result.liabilityLedger.entries.find((item) => item.liabilityCode === liabilityCode);
}

describe('USFederalPayrollAdapter2026 - Pub. 15-T percentage method', () => {
  test(`${OFFICIAL_CASES.STANDARD.fixtureId} follows Worksheet 1A using exact rational per-period rounding`, () => {
    const result = usFederal2026.calculate(payload());

    expect(result.status).toBe('preview');
    expect(result.runnable).toBe(false);
    expect(result.postingAllowed).toBe(false);
    expect(result.adapter.roundingPolicy)
      .toBe('no_wage_rounding_exact_rational_calculation_final_cent_half_up');
    expect(result.calculation.regularFederalIncomeTax).toBe('216.15');
    expect(result.calculation.regularFitWorksheet).toMatchObject({
      ruleId: OFFICIAL_CASES.STANDARD.officialRuleId,
      line1cAnnualizedWages: '65000.00',
      line1gStandardAdjustment: '8600.00',
      line1iAdjustedAnnualWages: '56400.00',
      tableSchedule: 'standard',
      tableRow: { minimum: '19900.00', maximum: '57900.00', baseTax: '1240.00', rate: '0.1200' },
      finalPerPeriodWithholding: '216.15',
    });
    expect(entry(result, 'US_FIT_REGULAR_EMPLOYEE').calculation.roundingHistory).toEqual([
      expect.objectContaining({
        stage: 'us.fit.regular.final_per_period',
        mode: 'half_up',
        unit: '0.01',
        input: expect.stringContaining('/'),
        output: '216.15',
      }),
    ]);
    expect(result.officialRules.P15T_WORKSHEET_1A.url).toBe(OFFICIAL_CASES.STANDARD.sourceUrl);
  });

  test(`${OFFICIAL_CASES.ADJUSTMENTS.fixtureId} applies other income, deductions, credits, and additional withholding in their statutory order`, () => {
    const result = usFederal2026.calculate(payload({
      w4: {
        otherIncome: '10000.00',
        deductions: '2000.00',
        credits: '3000.00',
        additionalWithholding: '15.00',
      },
    }));

    expect(result.calculation.regularFederalIncomeTax).toBe('177.69');
    expect(result.calculation.regularFitWorksheet).toMatchObject({
      line1dOtherIncome: '10000.00',
      line1fDeductions: '2000.00',
      line1iAdjustedAnnualWages: '64400.00',
      line3AnnualCredits: '3000.00',
      line4cAdditionalWithholding: '15.00',
    });
  });

  test(`${OFFICIAL_CASES.MULTIPLE_JOBS.fixtureId} uses the Step 2 checkbox schedule and removes the standard adjustment`, () => {
    const result = usFederal2026.calculate(payload({ w4: { multipleJobs: true } }));

    expect(result.calculation.regularFederalIncomeTax).toBe('383.35');
    expect(result.calculation.regularFitWorksheet).toMatchObject({
      line1gStandardAdjustment: '0.00',
      line1iAdjustedAnnualWages: '65000.00',
      tableSchedule: 'step_2_checkbox',
      tableRow: { minimum: '60900.00', baseTax: '8983.00', rate: '0.2400' },
    });
  });

  test.each([
    ['married_filing_jointly', false, '132.31'],
    ['head_of_household', false, '174.92'],
    ['married_filing_jointly', true, '216.15'],
    ['head_of_household', true, '311.37'],
  ])('covers the %s schedule with multipleJobs=%s', (filingStatus, multipleJobs, expected) => {
    const result = usFederal2026.calculate(payload({ w4: { filingStatus, multipleJobs } }));
    expect(result.calculation.regularFederalIncomeTax).toBe(expected);
  });

  test('floors withholding after annual credits at zero before adding Step 4(c)', () => {
    const result = usFederal2026.calculate(payload({
      w4: { credits: '100000.00', additionalWithholding: '12.34' },
    }));
    expect(result.calculation.regularFederalIncomeTax).toBe('12.34');
  });

  test('uses the published 37% row for a high-income percentage-method case', () => {
    const result = usFederal2026.calculate(payload({ regularTaxableWages: '50000.00' }));
    expect(result.calculation.regularFederalIncomeTax).toBe('16576.93');
    expect(result.calculation.regularFitWorksheet.tableRow).toMatchObject({
      minimum: '648100.00',
      maximum: null,
      baseTax: '192979.25',
      rate: '0.3700',
    });
  });

  test(`${OFFICIAL_CASES.BRIDGE.fixtureId} implements the pre-2020 computational bridge without changing the stored election`, () => {
    const result = usFederal2026.calculate(payload({
      w4: {
        version: '2019_or_earlier',
        maritalStatus: 'single',
        allowances: 2,
        continuedInEffect: true,
        additionalWithholding: '5.00',
      },
    }));

    expect(result.calculation.regularFederalIncomeTax).toBe('221.15');
    expect(entry(result, 'US_FIT_REGULAR_EMPLOYEE').metadata.bridge).toEqual({
      maritalStatus: 'single',
      allowances: 2,
      step4aOtherIncome: '8600.00',
      step4bDeductions: '8600.00',
      ruleId: OFFICIAL_CASES.BRIDGE.officialRuleId,
    });
  });

  test('fails closed for a pre-2020 form that is not certified as continuing in effect or has a lock-in letter', () => {
    expect(() => usFederal2026.calculate(payload({
      w4: { version: '2019_or_earlier', maritalStatus: 'single', allowances: 0 },
    }))).toThrow(expect.objectContaining({ code: 'US_W4_BRIDGE_CONTINUITY_REQUIRED' }));
    expect(() => usFederal2026.calculate(payload({ w4: { lockInLetter: { received: true } } })))
      .toThrow(expect.objectContaining({ code: 'US_W4_LOCK_IN_NOT_IMPLEMENTED' }));
  });
});

describe('USFederalPayrollAdapter2026 - exempt and nonresident-alien handling', () => {
  test('a signed current-year exempt W-4 zeros FIT but does not zero Social Security or Medicare', () => {
    const result = usFederal2026.calculate(payload({
      w4: { exempt: true, exemptTaxYear: 2026, signed: true },
    }));

    expect(result.calculation).toMatchObject({
      regularFederalIncomeTax: '0.00',
      socialSecurityEmployee: '155.00',
      medicareEmployee: '36.25',
    });
    expect(entry(result, 'US_FIT_REGULAR_EMPLOYEE')).toMatchObject({
      amount: { amount: '0.00' },
      metadata: { exempt: true },
      evidenceReference: 'IRS-P15-2026-W4-EXEMPTION',
    });
  });

  test('rejects an expired/unsigned exemption and an exemption mixed with Step 2-4 entries', () => {
    expect(() => usFederal2026.calculate(payload({ w4: { exempt: true, exemptTaxYear: 2025, signed: true } })))
      .toThrow(expect.objectContaining({ code: 'US_W4_EXEMPT_CERTIFICATION_REQUIRED' }));
    expect(() => usFederal2026.calculate(payload({
      w4: { exempt: true, exemptTaxYear: 2026, signed: true, credits: '1.00' },
    }))).toThrow(expect.objectContaining({ code: 'US_W4_EXEMPT_FORM_INVALID' }));
  });

  test(`${OFFICIAL_CASES.NRA.fixtureId} adds Table 2 only to FIT wages and leaves FICA/FUTA bases unchanged`, () => {
    const result = usFederal2026.calculate(payload({ nonresidentAlien: { applies: true } }));

    expect(result.calculation.regularFederalIncomeTax).toBe('346.61');
    expect(result.calculation.regularFitWorksheet).toMatchObject({
      line1aActualTaxableWages: '2500.00',
      line1aNraAdjustment: '619.20',
      line1aWithNraAdjustment: '3119.20',
      line1iAdjustedAnnualWages: '72499.20',
    });
    expect(entry(result, 'US_SOCIAL_SECURITY_EMPLOYEE').baseAmount.amount).toBe('2500.00');
    expect(entry(result, 'US_FUTA_EMPLOYER').baseAmount.amount).toBe('2500.00');
    expect(result.officialRules.P15T_NRA_TABLE_2.url).toBe(OFFICIAL_CASES.NRA.sourceUrl);
  });

  test('honours the India student/business-apprentice exception and fails closed on invalid NRA elections', () => {
    const india = usFederal2026.calculate(payload({
      nonresidentAlien: {
        applies: true,
        indiaStudentOrBusinessApprentice: true,
        indiaExceptionCertified: true,
      },
    }));
    expect(india.calculation.regularFitWorksheet.line1aNraAdjustment).toBe('0.00');
    expect(india.calculation.regularFederalIncomeTax).toBe('216.15');

    expect(() => usFederal2026.calculate(payload({
      nonresidentAlien: { applies: true },
      w4: { filingStatus: 'married_filing_jointly' },
    }))).toThrow(expect.objectContaining({ code: 'US_NRA_SINGLE_STATUS_REQUIRED' }));
    expect(() => usFederal2026.calculate(payload({
      nonresidentAlien: { applies: true },
      w4: { exempt: true, exemptTaxYear: 2026, signed: true },
    }))).toThrow(expect.objectContaining({ code: 'US_NRA_EXEMPT_NOT_ALLOWED' }));
    expect(() => usFederal2026.calculate(payload({
      nonresidentAlien: { applies: true },
      w4: { credits: '100.00' },
    }))).toThrow(expect.objectContaining({ code: 'US_NRA_CREDIT_ELIGIBILITY_REQUIRED' }));
    expect(() => usFederal2026.calculate(payload({
      nonresidentAlien: { applies: true, indiaStudentOrBusinessApprentice: true },
    }))).toThrow(expect.objectContaining({ code: 'US_NRA_INDIA_EXCEPTION_CERTIFICATION_REQUIRED' }));
  });
});

describe('USFederalPayrollAdapter2026 - supplemental wages', () => {
  test(`${OFFICIAL_CASES.SUPPLEMENTAL_EXAMPLE_3.fixtureId} reproduces Pub. 15 Example 3: $1,000 x 22% = $220`, () => {
    const result = usFederal2026.calculate(payload({
      payFrequency: 'semimonthly',
      regularTaxableWages: '2000.00',
      ficaTaxableWages: '3000.00',
      futaTaxableWages: '3000.00',
      supplemental: { taxableWages: '1000.00' },
    }));

    expect(result.calculation.supplementalFederalIncomeTax).toBe('220.00');
    expect(result.calculation.supplemental).toMatchObject({
      optional22Amount: '220.00',
      mandatory37Amount: '0.00',
    });
    expect(entry(result, 'US_FIT_SUPPLEMENTAL_EMPLOYEE')).toMatchObject({
      baseAmount: { amount: '1000.00' },
      evidenceReference: OFFICIAL_CASES.SUPPLEMENTAL_EXAMPLE_3.officialRuleId,
    });
    expect(entry(result, 'US_FIT_SUPPLEMENTAL_EMPLOYEE').calculation.roundingHistory)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ stage: 'us.fit.supplemental.optional_22.final' }),
        expect.objectContaining({ stage: 'us.fit.supplemental.mandatory_37.final' }),
      ]));
  });

  test('splits a threshold-crossing payment between optional 22% and mandatory 37%', () => {
    const result = usFederal2026.calculate(payload({
      ytd: { supplementalWagesCommonControl: '999500.00' },
      supplemental: { taxableWages: '1000.00' },
    }));

    expect(result.calculation.supplementalFederalIncomeTax).toBe('295.00');
    expect(result.calculation.supplemental).toMatchObject({
      optional22Amount: '110.00',
      mandatory37Amount: '185.00',
      ytdSupplementalWagesAllCommonControl: '999500.00',
    });
  });

  test('applies mandatory 37% above $1 million even without optional-flat eligibility', () => {
    const result = usFederal2026.calculate(payload({
      ytd: { supplementalWagesCommonControl: '1000000.00' },
      supplemental: {
        taxableWages: '1000.00',
        regularIncomeTaxWithheldInCurrentOrPriorYear: false,
      },
    }));

    expect(result.calculation.supplementalFederalIncomeTax).toBe('370.00');
  });

  test('fails closed when 22% eligibility is absent or an unimplemented aggregate method is requested', () => {
    expect(() => usFederal2026.calculate(payload({
      supplemental: { taxableWages: '1000.00', regularIncomeTaxWithheldInCurrentOrPriorYear: false },
    }))).toThrow(expect.objectContaining({ code: 'US_SUPPLEMENTAL_FLAT_NOT_ELIGIBLE' }));
    expect(() => usFederal2026.calculate(payload({
      supplemental: { taxableWages: '1000.00', method: 'aggregate' },
    }))).toThrow(expect.objectContaining({ code: 'US_SUPPLEMENTAL_AGGREGATE_NOT_IMPLEMENTED' }));
  });
});

describe('USFederalPayrollAdapter2026 - FICA and FUTA', () => {
  test(`${OFFICIAL_CASES.FICA.fixtureId} caps Social Security and withholds Additional Medicare only for the employee`, () => {
    const result = usFederal2026.calculate(payload({
      regularTaxableWages: '0.00',
      ficaTaxableWages: '2000.00',
      futaTaxableWages: '0.00',
      ytd: { socialSecurityWages: '184000.00', medicareWages: '199500.00' },
    }));

    expect(result.calculation).toMatchObject({
      socialSecurityEmployee: '31.00',
      socialSecurityEmployer: '31.00',
      medicareEmployee: '29.00',
      medicareEmployer: '29.00',
      additionalMedicareEmployee: '13.50',
    });
    expect(entry(result, 'US_SOCIAL_SECURITY_EMPLOYEE').baseAmount.amount).toBe('500.00');
    expect(entry(result, 'US_ADDITIONAL_MEDICARE_EMPLOYEE')).toMatchObject({
      baseAmount: { amount: '1500.00' },
      rate: '0.009',
      metadata: { employerShare: false },
    });
    expect(result.liabilityLedger.entries.some((item) => item.liabilityCode === 'US_ADDITIONAL_MEDICARE_EMPLOYER'))
      .toBe(false);
  });

  test(`${OFFICIAL_CASES.FUTA.fixtureId} derives general-test eligibility and caps the annual employee wage base`, () => {
    const result = usFederal2026.calculate(payload({
      regularTaxableWages: '0.00',
      ficaTaxableWages: '0.00',
      futaTaxableWages: '1000.00',
      ytd: { futaWages: '6500.00' },
    }));

    expect(result.calculation.futaEligibility).toEqual({
      category: 'general',
      subject: true,
      tests: { wageTest: true, employeeTest: false },
    });
    expect(result.calculation).toMatchObject({ futaGrossEmployer: '30.00', futaNetEmployer: '3.00' });
    expect(entry(result, 'US_FUTA_EMPLOYER')).toMatchObject({
      payer: 'employer',
      baseAmount: { amount: '500.00' },
      rate: '0.006',
      remittance: { formCode: 'FORM_940', frequency: 'annual' },
      evidenceReference: OFFICIAL_CASES.FUTA.officialRuleId,
    });
  });

  test.each([
    ['household', { maxQuarterlyCashWages2026: '1000.00' }, { householdCashWageTest: true }],
    ['farm', { maxQuarterlyCashWages2026: '20000.00' }, { farmCashWageTest: true, farmworkerTest: false }],
    ['farm', { weeksWithTenFarmworkers2026: 20 }, { farmCashWageTest: false, farmworkerTest: true }],
  ])('implements Pub. 15 %s employer eligibility tests', (category, fields, tests) => {
    const result = usFederal2026.calculate(payload({
      employerFuta: { category, ...fields },
    }));
    expect(result.calculation.futaEligibility).toMatchObject({ category, subject: true, tests });
  });

  test('returns zero FUTA when neither general employer test is met', () => {
    const result = usFederal2026.calculate(payload({
      employerFuta: {
        category: 'general',
        maxQuarterlyWages2026: '1499.99',
        weeksWithEmployee2026: 19,
      },
    }));
    expect(result.calculation.futaEligibility.subject).toBe(false);
    expect(result.calculation.futaGrossEmployer).toBe('0.00');
    expect(result.calculation.futaNetEmployer).toBe('0.00');
  });
});

describe('USFederalPayrollAdapter2026 - subnational gate, filing, and fail-closed inputs', () => {
  test('returns blocking status and gross-only FUTA when state, local, and SUTA adapters are absent', () => {
    const result = usFederal2026.calculate(payload({ companionAdapters: {} }));

    expect(result.status).toBe('blocked');
    expect(result.runnable).toBe(false);
    expect(result.postingAllowed).toBe(false);
    expect(result.blockingReasons.map((reason) => reason.code)).toEqual([
      'US_STATE_WITHHOLDING_ADAPTER_REQUIRED',
      'US_LOCAL_WITHHOLDING_ADAPTER_REQUIRED',
      'US_SUTA_ADAPTER_REQUIRED',
    ]);
    expect(result.calculation.futaNetEmployer).toBeNull();
    expect(entry(result, 'US_FUTA_GROSS_PRE_CREDIT_EMPLOYER')).toMatchObject({
      amount: { amount: '150.00' },
      metadata: { certifiedStateCreditRate: null },
    });
  });

  test('accepts certified no-tax determinations but requires exact current jurisdiction/version coverage', () => {
    const noTax = companions({
      stateWithholding: certifiedCompanion('state_withholding', 'US-NY', {
        applicability: 'certified_not_applicable',
      }),
      localWithholding: certifiedCompanion('local_withholding', 'US-NY-NYC', {
        applicability: 'certified_not_applicable',
      }),
    });
    expect(usFederal2026.calculate(payload({ companionAdapters: noTax })).status).toBe('preview');

    const expired = companions({
      stateWithholding: certifiedCompanion('state_withholding', 'US-NY', { effectiveTo: '2025-12-31' }),
    });
    const blocked = usFederal2026.calculate(payload({ companionAdapters: expired }));
    expect(blocked.status).toBe('blocked');
    expect(blocked.blockingReasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'US_STATE_WITHHOLDING_ADAPTER_REQUIRED' }),
    ]));
  });

  test('does not assume a 5.4% FUTA credit when a certified SUTA adapter omits its determination', () => {
    const result = usFederal2026.calculate(payload({
      companionAdapters: companions({
        stateUnemployment: certifiedCompanion('state_unemployment', 'US-NY'),
      }),
    }));

    expect(result.status).toBe('blocked');
    expect(result.blockingReasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'US_FUTA_CREDIT_DETERMINATION_REQUIRED' }),
    ]));
    expect(result.calculation.futaNetEmployer).toBeNull();
  });

  test('emits component-level 941/940 filing liabilities, exact totals, and official source links', () => {
    const result = usFederal2026.calculate(payload());

    expect(result.filing).toMatchObject({
      form941Quarter: 1,
      form941PeriodStart: '2026-01-01',
      form941PeriodEnd: '2026-03-31',
      form941DueDate: '2026-04-30',
      form940PeriodStart: '2026-01-01',
      form940PeriodEnd: '2026-12-31',
      form940OrdinaryDueDate: '2027-02-01',
    });
    expect(result.liabilityLedger).toMatchObject({
      currency: 'USD',
      employeeTotal: { amount: '407.40' },
      employerTotal: { amount: '206.25' },
      combinedTotal: { amount: '613.65' },
    });
    expect(result.liabilityLedger.filingGroups).toHaveLength(2);
    expect(entry(result, 'US_SOCIAL_SECURITY_EMPLOYER').sourceReferences).toEqual([
      'IRS-P15-2026-FICA', P15_URL,
      'IRS-I941-2026', 'https://www.irs.gov/instructions/i941',
    ]);
    expect(result.officialRules.I941_2026.url).toBe('https://www.irs.gov/instructions/i941');
  });

  test('rolls weekend Q3 filing/deposit dates to the next business day', () => {
    const result = usFederal2026.calculate(payload({ payDate: '2026-08-15' }));
    expect(result.filing).toMatchObject({
      form941Quarter: 3,
      form941DueDate: '2026-11-02',
      futaQuarterlyDepositDueDate: '2026-11-02',
    });
  });

  test('rejects territories, out-of-year dates, binary-number money, and unsupported FUTA categories', () => {
    expect(() => usFederal2026.calculate(payload({
      workLocation: { subdivisionCode: 'US-PR', localityCode: 'US-PR-SJU' },
    }))).toThrow(expect.objectContaining({ code: 'US_STATE_OR_DC_WORK_LOCATION_REQUIRED' }));
    expect(() => usFederal2026.calculate(payload({ payDate: '2027-01-01' })))
      .toThrow(expect.objectContaining({ code: 'US_FEDERAL_PAY_DATE_OUT_OF_RANGE' }));
    expect(() => usFederal2026.calculate(payload({ regularTaxableWages: 2500 })))
      .toThrow(expect.objectContaining({ code: 'US_FEDERAL_INVALID_MONEY' }));
    expect(() => usFederal2026.calculate(payload({ employerFuta: { category: 'government' } })))
      .toThrow(expect.objectContaining({ code: 'US_FUTA_CATEGORY_NOT_IMPLEMENTED' }));
  });
});
