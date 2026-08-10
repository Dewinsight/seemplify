'use strict';

const {
  calculate,
  calculatePayeBands,
  NigeriaPayrollAdapterError,
  OFFICIAL_SOURCES,
  SOURCE_VERSIONS,
} = require('../countryAdapters/Nigeria2026PayrollAdapter');
const {
  sourceUrls,
  buildBaseInput,
  payeBandCases,
  goldenCases,
} = require('../countryAdapters/fixtures/Nigeria2026OfficialFixtures');

function liability(result, code) {
  return result.liabilityLedger.entries.find((entry) => entry.liabilityCode === code);
}

function expectAdapterError(fn, code) {
  try {
    fn();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(NigeriaPayrollAdapterError);
    expect(error.code).toBe(code);
  }
}

function januaryInput() {
  const input = buildBaseInput();
  input.payDate = '2026-01-31';
  input.ytd = {
    monthsCompleted: 0,
    grossEmoluments: '0.00',
    employeePension: '0.00',
    employeeNhf: '0.00',
    employeeNhia: '0.00',
    payeDeducted: '0.00',
    reconciliationStatus: 'no_midyear_adjustments',
    evidenceReference: 'FIXTURE_ZERO_YTD',
  };
  input.nhia.currentContributionDueDate = '2026-02-10';
  input.nsitf.assessmentDueDate = '2026-02-28';
  return input;
}

describe('Nigeria2026PayrollAdapter official-source contract', () => {
  test('fixture URLs exactly match the adapter registry', () => {
    expect(Object.keys(sourceUrls).sort()).toEqual(Object.keys(OFFICIAL_SOURCES).sort());
    for (const [key, source] of Object.entries(OFFICIAL_SOURCES)) {
      expect(sourceUrls[key]).toBe(source.url);
      expect(source.authority).toBeTruthy();
      expect(source.supports.length).toBeGreaterThan(0);
    }
  });

  test('uses only primary Nigerian public authorities', () => {
    const hosts = new Set([
      'nass.gov.ng', 'statehouse.gov.ng', 'www.jrb.gov.ng', 'www.pencom.gov.ng',
      'fmbn.gov.ng', 'www.fmbn.gov.ng', 'nsitf.gov.ng', 'itf.gov.ng', 'www.itf.gov.ng',
      'www.nhia.gov.ng',
    ]);
    for (const source of Object.values(OFFICIAL_SOURCES)) {
      expect(hosts.has(new URL(source.url).hostname)).toBe(true);
      expect(source.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  test('is standalone, preview-only, non-postable and deeply frozen', () => {
    const result = calculate(buildBaseInput());
    expect(result.adapter).toMatchObject({
      code: 'NG_2026_STANDALONE_PREVIEW',
      integrationStatus: 'standalone_not_integrated',
      previewOnly: true,
      postable: false,
      taxSourceVersion: SOURCE_VERSIONS.JRB_PIT_2026,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.liabilityLedger.entries)).toBe(true);
  });

  test('publishes unresolved state, cumulative, remittance, ITF and rounding questions', () => {
    const questions = calculate(buildBaseInput()).unresolvedLegalQuestions.join(' ');
    expect(questions).toContain('cumulative');
    expect(questions).toContain('State/FCT');
    expect(questions).toContain('NHIA and NSITF');
    expect(questions).toContain('ITF');
    expect(questions).toContain('rounding');
  });
});

describe('Nigeria Tax Act 2025 Fourth Schedule bands', () => {
  test.each(payeBandCases)('$name', ({ chargeableIncome, expectedAnnualTax }) => {
    expect(calculatePayeBands(chargeableIncome).annualTax.amount).toBe(expectedAnnualTax);
  });

  test('rejects chargeable-income precision beyond one kobo', () => {
    expectAdapterError(() => calculatePayeBands('800000.001'), 'NIGERIA_INVALID_MONEY');
  });
});

describe('Nigeria 2026 numeric golden payroll', () => {
  test.each(goldenCases)('$id', ({ input, independentlyCalculated: expected }) => {
    const result = calculate(JSON.parse(JSON.stringify(input)));
    expect(result.totals.grossCashPay.amount).toBe(expected.monthlyGross);
    expect(result.bases.annualGrossEmploymentIncome.amount).toBe(expected.annualGross);
    expect(result.employeeContributions.pension.amount).toBe(expected.employeePension);
    expect(result.employerContributions.pension.amount).toBe(expected.employerPension);
    expect(result.employeeContributions.nhf.amount).toBe(expected.employeeNhf);
    expect(result.employeeContributions.nhia.amount).toBe(expected.employeeNhia);
    expect(result.employerContributions.nhia.amount).toBe(expected.employerNhia);
    expect(result.employerContributions.nsitf.amount).toBe(expected.employerNsitf);
    expect(result.employerContributions.itfMonthlyProvisionComponent.amount).toBe(expected.employerItfMonthlyProvision);
    expect(result.incomeTax.annualDeductions.rentRelief.amount).toBe(expected.annualRentRelief);
    expect(result.bases.annualEligibleDeductions.amount).toBe(expected.annualEligibleDeductions);
    expect(result.bases.annualChargeableIncome.amount).toBe(expected.annualChargeableIncome);
    expect(result.incomeTax.annualTax.amount).toBe(expected.annualPaye);
    expect(result.incomeTax.cumulativeTargetThroughCurrent.amount).toBe(expected.cumulativePayeThroughJune);
    expect(result.incomeTax.currentPaye.amount).toBe(expected.currentPaye);
    expect(result.totals.employeeStatutoryDeductions.amount).toBe(expected.employeeStatutoryDeductions);
    expect(result.totals.netCashPay.amount).toBe(expected.netCashPay);
    expect(result.totals.employerStatutoryCostAndProvision.amount).toBe(expected.employerStatutoryCostAndProvision);
    expect(liability(result, 'NG_PENSION_EMPLOYEE').remittance.dueDate).toBe(expected.pensionDueDate);
    expect(liability(result, 'NG_PAYE').remittance.dueDate).toBe(expected.payeDueDate);
    expect(liability(result, 'NG_NHF_EMPLOYEE').remittance.dueDate).toBe(expected.nhfDueDate);
    expect(liability(result, 'NG_ITF_EMPLOYER_PROVISION').remittance.dueDate).toBe(expected.itfDueDate);
  });

  test('uses cumulative target less exact YTD PAYE and permits one-kobo prior rounding variance', () => {
    const input = buildBaseInput();
    input.ytd.payeDeducted = '691149.99';
    const result = calculate(input);
    expect(result.incomeTax.currentPaye.amount).toBe('138230.01');
    expect(result.ytdAfterPeriod.payeDeducted.amount).toBe('829380.00');
  });

  test('fails a purported correction beyond the one-kobo rounding tolerance', () => {
    const input = buildBaseInput();
    input.ytd.payeDeducted = '691149.98';
    expectAdapterError(() => calculate(input), 'NIGERIA_UNSUPPORTED_MIDYEAR_CORRECTION');
  });

  test('applies the rent relief cap of NGN 500,000', () => {
    const input = buildBaseInput();
    input.reliefs.rent.annualRentAttributableTo2026 = '3000000.00';
    input.ytd.payeDeducted = '683650.00';
    const result = calculate(input);
    expect(result.incomeTax.annualDeductions.rentRelief.amount).toBe('500000.00');
    expect(result.incomeTax.annualTax.amount).toBe('1640760.00');
    expect(result.incomeTax.currentPaye.amount).toBe('136730.00');
  });

  test('supports evidenced owner-occupied mortgage interest and prior-year life premium', () => {
    const input = buildBaseInput();
    input.reliefs.mortgageInterest = {
      annualInterestAttributableTo2026: '100000.00',
      ownerOccupiedPrincipalResidence: true,
      lenderReference: 'FIXTURE_MORTGAGE_LENDER',
      evidenceReference: 'FIXTURE_MORTGAGE_INTEREST_CERTIFICATE',
    };
    input.reliefs.lifeOrDeferredAnnuity = {
      annualPremiumPaidIn2025: '50000.00',
      contractType: 'life_insurance',
      insuredRelationship: 'self',
      evidenceReference: 'FIXTURE_2025_LIFE_PREMIUM_CERTIFICATE',
    };
    input.ytd.payeDeducted = '679900.00';
    const result = calculate(input);
    expect(result.incomeTax.annualDeductions.ownerOccupiedMortgageInterest.amount).toBe('100000.00');
    expect(result.incomeTax.annualDeductions.priorYearLifeOrDeferredAnnuityPremium.amount).toBe('50000.00');
    expect(result.incomeTax.annualTax.amount).toBe('1631760.00');
    expect(result.incomeTax.currentPaye.amount).toBe('135980.00');
  });

  test('does not apply the repealed legacy consolidated relief allowance', () => {
    const result = calculate(buildBaseInput());
    expect(result.incomeTax.legacyConsolidatedReliefAllowanceApplied).toBe(false);
    expect(result.bases.annualEligibleDeductions.amount).toBe('1618000.00');
  });

  test('applies the statutory minimum-wage employment exemption at NGN 70,000 gross monthly', () => {
    const input = januaryInput();
    input.earnings = {
      basicSalary: '30000.00', housingAllowance: '20000.00', transportAllowance: '10000.00',
      otherRegularCash: '10000.00', pensionableMonthlyEmoluments: '70000.00', evidenceReference: 'FIXTURE_MINIMUM_WAGE_CONTRACT',
    };
    input.itf.form5AAnnualPayrollAllocation = '840000.00';
    input.reliefs.rent = null;
    const result = calculate(input);
    expect(result.incomeTax.minimumWageExempt).toBe(true);
    expect(result.incomeTax.currentPaye.amount).toBe('0.00');
    expect(result.employeeContributions.pension.amount).toBe('5600.00');
    expect(result.employeeContributions.nhf.amount).toBe('750.00');
    expect(result.employeeContributions.nhia.amount).toBe('1500.00');
  });

  test('rounds each contribution half-up to kobo at its declared liability stage', () => {
    const input = januaryInput();
    input.earnings = {
      basicSalary: '33333.40', housingAllowance: '20000.00', transportAllowance: '10000.00',
      otherRegularCash: '36666.60', pensionableMonthlyEmoluments: '63333.40', evidenceReference: 'FIXTURE_ROUNDING_CONTRACT',
    };
    input.itf.form5AAnnualPayrollAllocation = '1200000.00';
    input.reliefs.rent = null;
    const result = calculate(input);
    expect(result.employeeContributions.nhf.amount).toBe('833.34');
    expect(result.employeeContributions.pension.amount).toBe('5066.67');
    expect(result.employerContributions.pension.amount).toBe('6333.34');
    expect(result.employeeContributions.nhia.amount).toBe('1666.67');
    expect(result.employerContributions.nhia.amount).toBe('3333.34');
    expect(result.employerContributions.itfMonthlyProvisionComponent.amount).toBe('1000.00');
  });

  test('has no statutory pension monetary cap in the supported standard CPS path', () => {
    const input = januaryInput();
    input.earnings = {
      basicSalary: '20000000.00', housingAllowance: '10000000.00', transportAllowance: '10000000.00',
      otherRegularCash: '10000000.00', pensionableMonthlyEmoluments: '50000000.00', evidenceReference: 'FIXTURE_HIGH_PAY_CONTRACT',
    };
    input.itf.form5AAnnualPayrollAllocation = '600000000.00';
    input.reliefs.rent = null;
    const result = calculate(input);
    expect(result.employeeContributions.pension.amount).toBe('4000000.00');
    expect(result.employerContributions.pension.amount).toBe('5000000.00');
    expect(liability(result, 'NG_PENSION_EMPLOYER').metadata.noMonetaryCap).toBe(true);
  });
});

describe('component liabilities and remittance evidence', () => {
  test('creates all eight national/state employee and employer components', () => {
    const result = calculate(buildBaseInput());
    expect(result.liabilityLedger.entries.map((entry) => entry.liabilityCode)).toEqual([
      'NG_PAYE', 'NG_PENSION_EMPLOYEE', 'NG_PENSION_EMPLOYER', 'NG_NHF_EMPLOYEE',
      'NG_NHIA_EMPLOYEE', 'NG_NHIA_EMPLOYER', 'NG_NSITF_EMPLOYER', 'NG_ITF_EMPLOYER_PROVISION',
    ]);
    expect(result.liabilityLedger.employeeTotal.amount).toBe('239730.00');
    expect(result.liabilityLedger.employerTotal.amount).toBe('150900.00');
    expect(result.liabilityLedger.combinedTotal.amount).toBe('390630.00');
  });

  test('records monthly PAYE and annual employer return obligations separately', () => {
    const result = calculate(buildBaseInput());
    const paye = liability(result, 'NG_PAYE');
    expect(paye.remittance).toMatchObject({ frequency: 'monthly', dueDate: '2026-07-10' });
    expect(paye.metadata.annualReturnDueDate).toBe('2027-01-31');
    expect(paye.authority).toMatchObject({ code: 'LIRS', level: 'subdivision', jurisdictionCode: 'NG-LA' });
  });

  test('records pension PFA/PFC routing and seven-working-day calendar evidence', () => {
    const entry = liability(calculate(buildBaseInput()), 'NG_PENSION_EMPLOYEE');
    expect(entry.authority.code).toBe('PFC_FIXTURE');
    expect(entry.metadata.pfaCode).toBe('PFA_FIXTURE');
    expect(entry.metadata.dueRule).toBe('seven_working_days_after_salary_payment');
    expect(entry.metadata.calendarEvidenceReference).toBeTruthy();
  });

  test('records NHIA and NSITF due dates as evidence-specific rather than inferred law dates', () => {
    const result = calculate(buildBaseInput());
    expect(liability(result, 'NG_NHIA_EMPLOYEE').metadata.dueRule).toBe('evidenced_employer_specific_NHIA_funding_schedule');
    expect(liability(result, 'NG_NSITF_EMPLOYER').metadata.dueRule).toBe('assessment_specific_due_date_not_inferred');
  });

  test('treats ITF as an annual filing component and not a monthly remittance', () => {
    const entry = liability(calculate(buildBaseInput()), 'NG_ITF_EMPLOYER_PROVISION');
    expect(entry.remittance).toMatchObject({
      frequency: 'annual', periodStart: '2026-01-01', periodEnd: '2026-12-31', dueDate: '2027-04-01',
    });
    expect(entry.rate).toBe('');
    expect(entry.metadata).toMatchObject({
      isProvision: true,
      statutoryAnnualRate: '0.01',
      provisionFraction: '1/12',
      aggregationScope: 'employee_component_for_employer_annual_return',
    });
  });

  test('supports a separately certified FCT route', () => {
    const input = buildBaseInput();
    input.taxAuthority = {
      ...input.taxAuthority,
      authorityType: 'fct_irs', authorityCode: 'FCT_IRS', authorityName: 'Federal Capital Territory Internal Revenue Service',
      jurisdictionCode: 'NG-FC', formCode: 'FCT_IRS_PAYE_MONTHLY',
      paymentChannel: 'synthetic FCT IRS employer portal route',
      routeCertificationReference: 'FIXTURE_CERTIFIED_FCT_2026_ROUTE_ADAPTER',
      previewRouteReceiptId: 'NG-FC-2026-FCTIRS-SYNTHETIC-PREVIEW',
    };
    const result = calculate(input);
    expect(liability(result, 'NG_PAYE').authority).toMatchObject({ code: 'FCT_IRS', jurisdictionCode: 'NG-FC' });
  });

  test('each liability carries registered primary-source references and non-postable metadata', () => {
    for (const entry of calculate(buildBaseInput()).liabilityLedger.entries) {
      expect(entry.sourceReferences.length).toBeGreaterThan(0);
      for (const source of entry.sourceReferences) expect(OFFICIAL_SOURCES[source]).toBeTruthy();
      expect(entry.metadata.postable).toBe(false);
      expect(entry.metadata.previewOnly).toBe(true);
    }
  });
});

describe('fail-closed scope and evidence gates', () => {
  test.each([
    ['benefits', { type: 'vehicle', value: '1000.00' }, 'NIGERIA_UNSUPPORTED_BENEFIT_VALUATION'],
    ['reimbursements', { type: 'travel', value: '1000.00' }, 'NIGERIA_UNSUPPORTED_REIMBURSEMENT'],
    ['nonPeriodicPayments', { type: 'bonus', value: '1000.00' }, 'NIGERIA_UNSUPPORTED_NONPERIODIC_PAY'],
  ])('rejects non-empty %s', (field, item, code) => {
    const input = buildBaseInput();
    input[field] = [item];
    expectAdapterError(() => calculate(input), code);
  });

  test.each(['nonresident_employee', 'armed_forces', 'public_sector_employee', 'self_employed'])('rejects worker category %s', (category) => {
    const input = buildBaseInput();
    input.employment.workerCategory = category;
    expectAdapterError(() => calculate(input), 'NIGERIA_UNSUPPORTED_WORKER_CATEGORY');
  });

  test('rejects fewer than five employees in the combined Wave 1 route', () => {
    const input = buildBaseInput();
    input.employment.employeeCount = 4;
    expectAdapterError(() => calculate(input), 'NIGERIA_UNSUPPORTED_EMPLOYER_SIZE');
  });

  test('rejects a mid-year starter or changed monthly terms', () => {
    const input = buildBaseInput();
    input.employment.employmentStartDate = '2026-03-01';
    expectAdapterError(() => calculate(input), 'NIGERIA_UNSUPPORTED_MIDYEAR_CORRECTION');
    input.employment.employmentStartDate = '2025-01-01';
    input.employment.stableMonthlyTermsFor2026 = false;
    expectAdapterError(() => calculate(input), 'NIGERIA_UNSUPPORTED_MIDYEAR_CORRECTION');
  });

  test('rejects inconsistent YTD gross and statutory deductions', () => {
    const gross = buildBaseInput();
    gross.ytd.grossEmoluments = '4999999.99';
    expectAdapterError(() => calculate(gross), 'NIGERIA_UNSUPPORTED_MIDYEAR_CORRECTION');
    const pension = buildBaseInput();
    pension.ytd.employeePension = '319999.99';
    expectAdapterError(() => calculate(pension), 'NIGERIA_UNSUPPORTED_MIDYEAR_CORRECTION');
  });

  test('requires a certified State/FCT route and consistent FCT code', () => {
    const input = buildBaseInput();
    input.taxAuthority.previewRouteReceiptId = 'CALLER_ASSERTED_ROUTE';
    expectAdapterError(() => calculate(input), 'NIGERIA_STATE_ADAPTER_NOT_CERTIFIED');
    const fct = buildBaseInput();
    fct.taxAuthority.authorityType = 'fct_irs';
    expectAdapterError(() => calculate(fct), 'NIGERIA_STATE_ROUTE_REQUIRED');
  });

  test('rejects a caller-asserted fake State authority even when all text fields are present', () => {
    const input = buildBaseInput();
    input.taxAuthority = {
      ...input.taxAuthority,
      authorityCode: 'FAKE',
      authorityName: 'Fake Authority',
      jurisdictionCode: 'NG-ZZ',
      formCode: 'FAKE_FORM',
      paymentChannel: 'fake channel',
      routeCertificationReference: 'SELF_ASSERTED',
      previewRouteReceiptId: 'NG-ZZ-2026-SELF-ASSERTED',
    };
    expectAdapterError(() => calculate(input), 'NIGERIA_STATE_ADAPTER_NOT_CERTIFIED');
  });

  test('requires State/FCT registration and route evidence', () => {
    const input = buildBaseInput();
    delete input.taxAuthority.routeCertificationReference;
    expectAdapterError(() => calculate(input), 'NIGERIA_STATE_ADAPTER_NOT_CERTIFIED');
  });

  test('requires pension and group-life evidence', () => {
    const pension = buildBaseInput();
    pension.pension.rsaPinEvidenceReference = '';
    expectAdapterError(() => calculate(pension), 'NIGERIA_REQUIRED_EVIDENCE_MISSING');
    const life = buildBaseInput();
    life.employment.groupLifePolicyEvidenceReference = '';
    expectAdapterError(() => calculate(life), 'NIGERIA_REQUIRED_EVIDENCE_MISSING');
  });

  test('rejects pensionable emoluments below basic plus housing plus transport', () => {
    const input = buildBaseInput();
    input.earnings.pensionableMonthlyEmoluments = '799999.99';
    expectAdapterError(() => calculate(input), 'NIGERIA_INVALID_PENSION_BASE');
  });

  test('rejects alternative pension or NHIA splits', () => {
    const pension = buildBaseInput();
    pension.pension.employeeRate = '0.10';
    expectAdapterError(() => calculate(pension), 'NIGERIA_UNSUPPORTED_PENSION_RATE');
    const nhia = buildBaseInput();
    nhia.nhia.employerPaysEmployeeShare = true;
    expectAdapterError(() => calculate(nhia), 'NIGERIA_UNSUPPORTED_NHIA_RATE');
  });

  test('requires employer-specific NHIA and NSITF due-date evidence', () => {
    const nhia = buildBaseInput();
    delete nhia.nhia.currentContributionDueDate;
    expectAdapterError(() => calculate(nhia), 'NIGERIA_REMITTANCE_EVIDENCE_REQUIRED');
    const nsitf = buildBaseInput();
    delete nsitf.nsitf.assessmentDueDate;
    expectAdapterError(() => calculate(nsitf), 'NIGERIA_REMITTANCE_EVIDENCE_REQUIRED');
  });

  test('requires an exact current NSITF assessment rather than inferring a risk-based rate', () => {
    const input = buildBaseInput();
    input.nsitf.assessedRate = '0.0125';
    expectAdapterError(() => calculate(input), 'NIGERIA_NSITF_ASSESSMENT_REQUIRED');
  });

  test('rejects remittance due dates before the period end', () => {
    const input = buildBaseInput();
    input.nhia.currentContributionDueDate = '2026-06-29';
    expectAdapterError(() => calculate(input), 'NIGERIA_REMITTANCE_EVIDENCE_REQUIRED');
  });

  test('requires a certified ITF Form 5A allocation instead of inferring the broad annual base', () => {
    const input = buildBaseInput();
    delete input.itf.form5ABasisEvidenceReference;
    expectAdapterError(() => calculate(input), 'NIGERIA_REQUIRED_EVIDENCE_MISSING');
    const zero = buildBaseInput();
    zero.itf.form5AAnnualPayrollAllocation = '0.00';
    expectAdapterError(() => calculate(zero), 'NIGERIA_ITF_BASIS_REQUIRED');
  });

  test('requires rent declaration and payment evidence when relief is claimed', () => {
    const input = buildBaseInput();
    input.reliefs.rent.declarationReference = '';
    expectAdapterError(() => calculate(input), 'NIGERIA_REQUIRED_EVIDENCE_MISSING');
  });

  test('requires an explicit official-holiday calendar for seven-working-day pension remittance', () => {
    const input = buildBaseInput();
    delete input.businessCalendar.publicHolidays;
    expectAdapterError(() => calculate(input), 'NIGERIA_BUSINESS_CALENDAR_REQUIRED');
  });

  test('rejects an unpinned source version or non-2026 pay date', () => {
    const source = buildBaseInput();
    source.taxSourceVersion = 'latest';
    expectAdapterError(() => calculate(source), 'NIGERIA_SOURCE_VERSION_REQUIRED');
    const year = buildBaseInput();
    year.payDate = '2027-01-31';
    expectAdapterError(() => calculate(year), 'NIGERIA_UNSUPPORTED_TAX_YEAR');
  });

  test('rejects unknown input fields and unsafe money precision', () => {
    const unknown = buildBaseInput();
    unknown.allowPosting = true;
    expectAdapterError(() => calculate(unknown), 'NIGERIA_UNSUPPORTED_INPUT');
    const money = buildBaseInput();
    money.earnings.basicSalary = '500000.001';
    expectAdapterError(() => calculate(money), 'NIGERIA_INVALID_MONEY');
  });
});
