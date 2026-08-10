'use strict';

const {
  calculate,
  calculateMonthlyPaye,
  calculatePayeBands,
  KenyaPayrollAdapterError,
  OFFICIAL_SOURCES,
} = require('../countryAdapters/Kenya2026PayrollAdapter');
const {
  SOURCE_URLS,
  buildBaseInput,
  payeBandCases,
  monthlyGoldenCases,
  ageBoundaryCases,
} = require('../countryAdapters/fixtures/Kenya2026OfficialFixtures');

function liability(result, code) {
  return result.liabilityLedger.entries.find((entry) => entry.liabilityCode === code);
}

function expectAdapterError(fn, code) {
  try {
    fn();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(KenyaPayrollAdapterError);
    expect(error.code).toBe(code);
  }
}

describe('Kenya2026PayrollAdapter official source contract', () => {
  test('fixture source URLs exactly match the adapter source registry', () => {
    expect(Object.keys(OFFICIAL_SOURCES).sort()).toEqual(Object.keys(SOURCE_URLS).sort());
    for (const [sourceId, source] of Object.entries(OFFICIAL_SOURCES)) {
      expect(source.url).toBe(SOURCE_URLS[sourceId]);
    }
  });

  test('uses only primary official authorities in the fixture registry', () => {
    const allowedHosts = new Set([
      'www.kra.go.ke',
      'ecitizen.kra.go.ke',
      'new.kenyalaw.org',
      'www.nssf.or.ke',
      'www.nita.go.ke',
    ]);
    for (const source of Object.values(OFFICIAL_SOURCES)) {
      expect(allowedHosts.has(new URL(source.url).hostname)).toBe(true);
      expect(source.authority).toBeTruthy();
      expect(source.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(source.supports.length).toBeGreaterThan(0);
    }
  });

  test('keeps the adapter standalone and explicitly unpromoted', () => {
    const result = calculate(buildBaseInput());
    expect(result.adapter).toMatchObject({
      code: 'KE_2026_MONTHLY_STANDALONE',
      integrationStatus: 'standalone_not_integrated',
      confidence: 'preview_pending_kenya_legal_and_payroll_signoff',
      calculationBasis: 'monthly_non_cumulative',
    });
    expect(Object.isFrozen(result)).toBe(true);
  });
});
describe('Kenya 2026 PAYE monthly table', () => {
  test.each(payeBandCases)('$name', ({ chargeableIncome, expectedGrossTax }) => {
    expect(calculatePayeBands(chargeableIncome).grossTax.toFixed()).toBe(expectedGrossTax);
  });

  test('grants KES 2,400 personal relief only to residents', () => {
    expect(calculateMonthlyPaye({
      chargeableIncome: '89750.00',
      residencyStatus: 'resident',
    }).amount.amount).toBe('19308.35');
    expect(calculateMonthlyPaye({
      chargeableIncome: '89750.00',
      residencyStatus: 'non_resident',
    }).amount.amount).toBe('21708.35');
  });

  test('floors PAYE at zero after reliefs', () => {
    const result = calculateMonthlyPaye({
      chargeableIncome: '10000.00',
      residencyStatus: 'resident',
    });
    expect(result.grossTax.amount).toBe('1000.00');
    expect(result.amount.amount).toBe('0.00');
  });

  test('rejects insurance relief for a non-resident', () => {
    expectAdapterError(() => calculateMonthlyPaye({
      chargeableIncome: '100000.00',
      residencyStatus: 'non_resident',
      insuranceRelief: '1.00',
    }), 'KENYA_RELIEF_NOT_AVAILABLE_TO_NON_RESIDENT');
  });
});

describe('Kenya 2026 independently calculated monthly golden fixtures', () => {
  test.each(monthlyGoldenCases)('$name', ({ input, expected }) => {
    const result = calculate(input);
    expect(result.statutoryDeductions.nssf.schedule).toBe(expected.nssfSchedule);
    expect(result.statutoryDeductions.nssf.employeeTotal.amount).toBe(expected.nssfEmployee);
    expect(result.statutoryDeductions.nssf.employerTotal.amount).toBe(expected.nssfEmployer);
    expect(result.paye.chargeableIncome.amount).toBe(expected.chargeableIncome);
    expect(result.paye.amount.amount).toBe(expected.paye);
    expect(result.statutoryDeductions.ahlEmployee.amount).toBe(expected.ahlEmployee);
    expect(result.statutoryDeductions.shifEmployee.amount).toBe(expected.shifEmployee);
    expect(result.employerContributions.nita.amount).toBe(expected.nitaEmployer);
    expect(result.totals.employeeStatutoryLiabilities.amount).toBe(expected.employeeStatutoryLiabilities);
    expect(result.totals.employerStatutoryCost.amount).toBe(expected.employerStatutoryCost);
    expect(result.totals.netCashPay.amount).toBe(expected.netCashPay);
    expect(liability(result, 'KE_AHL_EMPLOYEE').remittance.dueDate).toBe(expected.ahlDueDate);

    if (expected.registeredPensionDeductible) {
      expect(result.statutoryDeductions.pensionTax.registeredContributionDeductible.amount)
        .toBe(expected.registeredPensionDeductible);
      expect(result.statutoryDeductions.pensionTax.registeredContributionExcess.amount)
        .toBe(expected.registeredPensionExcess);
      expect(result.statutoryDeductions.pensionTax.totalDeductibleIncludingNssf.amount)
        .toBe(expected.totalPensionDeductible);
    }
    if (expected.insuranceRelief) {
      expect(result.paye.reliefs.insurance.amount).toBe(expected.insuranceRelief);
    }
    if (expected.pwdExemption) {
      expect(result.paye.pwdExemption.amount).toBe(expected.pwdExemption);
    }
  });

  test('builds nine component-level liabilities with exact totals', () => {
    const result = calculate(buildBaseInput());
    expect(result.liabilityLedger.entries).toHaveLength(9);
    expect(result.liabilityLedger.employeeTotal.amount).toBe('29558.35');
    expect(result.liabilityLedger.employerTotal.amount).toBe('7550.00');
    expect(result.liabilityLedger.combinedTotal.amount).toBe('37108.35');
    for (const entry of result.liabilityLedger.entries) {
      expect(entry.authority.jurisdictionCode).toBe('KE');
      expect(entry.remittance.frequency).toBe('monthly');
      expect(entry.remittance.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.sourceReferences.length).toBeGreaterThan(0);
      expect(entry.calculation.roundingStage).toBeTruthy();
    }
  });

  test('rounds each statutory component and each PAYE band half-up to KES 0.01', () => {
    const result = calculate(buildBaseInput({
      grossCashPay: '100000.34',
      nssfPensionableEarnings: '100000.34',
      pensionableIncomeForTax: '100000.34',
    }));
    expect(result.statutoryDeductions.ahlEmployee.amount).toBe('1500.01');
    expect(result.statutoryDeductions.shifEmployee.amount).toBe('2750.01');
    expect(result.statutoryDeductions.nssf.employeeTotal.amount).toBe('6000.02');
    expect(liability(result, 'KE_AHL_EMPLOYEE').calculation.roundingHistory).toEqual([
      expect.objectContaining({ mode: 'half_up', unit: '0.01', stage: 'ke.ahl.employee.final' }),
    ]);
    expect(result.paye.bands[2].tax.roundingHistory[0]).toMatchObject({
      mode: 'half_up',
      unit: '0.01',
      stage: 'ke.paye.band_3.tax',
    });
  });
});

describe('Kenya 2026 NSSF coverage and routing', () => {
  test.each(ageBoundaryCases)('$name', ({ dateOfBirth, covered, age }) => {
    const result = calculate(buildBaseInput({ dateOfBirth }));
    expect(result.employee).toMatchObject({ age, nssfCovered: covered });
    expect(result.statutoryDeductions.nssf.employeeTotal.amount)
      .toBe(covered ? '6000.00' : '0.00');
  });

  test('caps Year 4 contributions at the KES 108,000 UEL', () => {
    const result = calculate(buildBaseInput({
      grossCashPay: '200000.00',
      nssfPensionableEarnings: '200000.00',
      pensionableIncomeForTax: '200000.00',
    }));
    expect(result.statutoryDeductions.nssf).toMatchObject({
      tierOneEmployee: { amount: '540.00' },
      tierTwoEmployee: { amount: '5940.00' },
      employeeTotal: { amount: '6480.00' },
    });
  });

  test('rounds a fractional Tier II contribution only at its declared component stage', () => {
    const result = calculate(buildBaseInput({
      grossCashPay: '9000.09',
      nssfPensionableEarnings: '9000.09',
      pensionableIncomeForTax: '9000.09',
    }));
    expect(result.statutoryDeductions.nssf.tierOneEmployee.amount).toBe('540.00');
    expect(result.statutoryDeductions.nssf.tierTwoEmployee.amount).toBe('0.01');
    expect(result.statutoryDeductions.nssf.employeeTotal.amount).toBe('540.01');
  });

  test('routes both employee and employer Tier II to an evidenced contracted-out scheme while Tier I stays with NSSF', () => {
    const result = calculate(buildBaseInput({
      grossCashPay: '108000.00',
      nssfPensionableEarnings: '108000.00',
      pensionableIncomeForTax: '108000.00',
      nssf: {
        contractedOutTierII: true,
        contractedOutScheme: {
          schemeName: 'Fixture Approved Occupational Scheme',
          schemeRegistrationReference: 'RBA-SCHEME-001',
          contractingOutCertificateNumber: 'RBA-CONTRACT-001',
          certificateEffectiveFrom: '2025-01-01',
          certificateEffectiveTo: '2027-12-31',
          authorityApprovalReference: 'FIXTURE-RBA-APPROVAL-001',
        },
      },
    }));
    expect(liability(result, 'KE_NSSF_TIER_I_EMPLOYEE').authority.code).toBe('NSSF');
    for (const code of ['KE_NSSF_TIER_II_EMPLOYEE', 'KE_NSSF_TIER_II_EMPLOYER']) {
      expect(liability(result, code)).toMatchObject({
        authority: { code: 'RBA_CONTRACTED_SCHEME', name: 'Fixture Approved Occupational Scheme' },
        remittance: { formCode: 'CONTRACTED_TIER_II_SCHEDULE' },
        evidenceReference: 'FIXTURE-RBA-APPROVAL-001',
        metadata: {
          route: 'CONTRACTED_OUT_SCHEME',
          contractingOutCertificateNumber: 'RBA-CONTRACT-001',
        },
      });
    }
  });

  test('fails closed for missing or inactive contracting-out evidence', () => {
    expectAdapterError(() => calculate(buildBaseInput({
      nssf: { contractedOutTierII: true, contractedOutScheme: {} },
    })), 'KENYA_NSSF_CONTRACT_EVIDENCE_REQUIRED');
    expectAdapterError(() => calculate(buildBaseInput({
      nssf: {
        contractedOutTierII: true,
        contractedOutScheme: {
          schemeName: 'Expired Scheme',
          schemeRegistrationReference: 'RBA-SCHEME-X',
          contractingOutCertificateNumber: 'RBA-CONTRACT-X',
          certificateEffectiveFrom: '2020-01-01',
          certificateEffectiveTo: '2025-12-31',
          authorityApprovalReference: 'RBA-APPROVAL-X',
        },
      },
    })), 'KENYA_NSSF_CONTRACT_CERTIFICATE_INACTIVE');
  });
});

describe('Kenya 2026 evidence-bound reliefs and exemptions', () => {
  test('treats both PWD certificate endpoints as inclusive', () => {
    for (const payDate of ['2026-02-01', '2026-02-28']) {
      const result = calculate(buildBaseInput({
        payDate,
        pwdTaxExemption: {
          certificateNumber: 'PWD-BOUNDARY',
          ncpwdRegistrationNumber: 'NCPWD-BOUNDARY',
          effectiveFrom: '2026-02-01',
          effectiveTo: '2026-02-28',
          kraVerificationReference: 'KRA-VERIFY-BOUNDARY',
        },
      }));
      expect(result.paye.pwdExemption.amount).toBe('100000.00');
      expect(result.paye.amount.amount).toBe('0.00');
    }
  });

  test('fails closed when a PWD certificate is outside its effective dates or lacks KRA verification', () => {
    expectAdapterError(() => calculate(buildBaseInput({
      payDate: '2026-03-01',
      pwdTaxExemption: {
        certificateNumber: 'PWD-EXPIRED',
        ncpwdRegistrationNumber: 'NCPWD-EXPIRED',
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-02-28',
        kraVerificationReference: 'KRA-VERIFY-EXPIRED',
      },
    })), 'KENYA_PWD_CERTIFICATE_INACTIVE');
    expectAdapterError(() => calculate(buildBaseInput({
      pwdTaxExemption: {
        certificateNumber: 'PWD-NO-VERIFY',
        ncpwdRegistrationNumber: 'NCPWD-NO-VERIFY',
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-12-31',
      },
    })), 'KENYA_PWD_EVIDENCE_REQUIRED');
  });

  test('requires registered-pension evidence when a contribution is declared', () => {
    expectAdapterError(() => calculate(buildBaseInput({
      employeeRegisteredPension: { employeeContribution: '1000.00' },
    })), 'KENYA_REQUIRED_EVIDENCE_MISSING');
  });

  test('requires qualifying insurance evidence and a ten-year education term', () => {
    expectAdapterError(() => calculate(buildBaseInput({
      insuranceRelief: {
        monthlyPremiumPaid: '1000.00',
        policyType: 'health',
        policyStartDate: '2020-01-01',
        insuredRelationship: 'self',
        benefitsPayableInKenyaShillings: true,
      },
    })), 'KENYA_INSURANCE_EVIDENCE_REQUIRED');
    expectAdapterError(() => calculate(buildBaseInput({
      insuranceRelief: {
        monthlyPremiumPaid: '1000.00',
        policyType: 'education',
        policyStartDate: '2020-01-01',
        policyMaturityDate: '2029-12-31',
        insuredRelationship: 'self',
        benefitsPayableInKenyaShillings: true,
        policyEvidenceReference: 'POLICY-X',
        insurerLicenceEvidenceReference: 'IRA-X',
      },
    })), 'KENYA_UNSUPPORTED_INSURANCE_POLICY');
  });

  test('fails closed instead of valuing benefits or reimbursements', () => {
    expectAdapterError(() => calculate(buildBaseInput({
      benefits: [{ type: 'company_car', value: '10000.00' }],
    })), 'KENYA_UNSUPPORTED_BENEFIT_VALUATION');
    expectAdapterError(() => calculate(buildBaseInput({
      reimbursements: [{ type: 'mileage', value: '10000.00' }],
    })), 'KENYA_UNSUPPORTED_REIMBURSEMENT_VALUATION');
  });

  test('requires explicit empty component declarations and holiday evidence', () => {
    const missingBenefits = buildBaseInput();
    delete missingBenefits.benefits;
    expectAdapterError(() => calculate(missingBenefits), 'KENYA_COMPONENT_DECLARATION_REQUIRED');

    const missingCalendarEvidence = buildBaseInput();
    delete missingCalendarEvidence.businessCalendar.evidenceReference;
    expectAdapterError(() => calculate(missingCalendarEvidence), 'KENYA_BUSINESS_CALENDAR_REQUIRED');
  });

  test('rejects undeclared input fields and unsupported tax years', () => {
    expectAdapterError(() => calculate({ ...buildBaseInput(), mortgageInterest: '1000.00' }), 'KENYA_UNSUPPORTED_INPUT');
    expectAdapterError(() => calculate(buildBaseInput({ payDate: '2027-01-31' })), 'KENYA_UNSUPPORTED_TAX_YEAR');
  });
});

describe('Kenya 2026 NITA liability metadata', () => {
  test('applies the current Act due date and exposes the operational-guidance conflict', () => {
    const result = calculate(buildBaseInput());
    const nita = liability(result, 'KE_NITA_EMPLOYER');
    expect(nita).toMatchObject({
      payer: 'employer',
      amount: { amount: '50.00' },
      remittance: { dueDate: '2026-03-09' },
      metadata: {
        dueRuleApplied: 'ninth_day_of_following_month_under_current_act',
        operationalGuidanceConflict: true,
        legalReviewBeforeIntegration: true,
      },
    });
    expect(result.reviewFlags).toContainEqual(expect.objectContaining({
      code: 'KE_NITA_DUE_GUIDANCE_CONFLICT',
    }));
  });

  test('supports only an evidenced in-force NITA exemption', () => {
    const result = calculate(buildBaseInput({
      nita: {
        applicable: false,
        exemptionReference: 'NITA-EXEMPTION-001',
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-12-31',
      },
    }));
    expect(result.employerContributions.nita.amount).toBe('0.00');
    expect(liability(result, 'KE_NITA_EMPLOYER').evidenceReference).toBe('NITA-EXEMPTION-001');

    expectAdapterError(() => calculate(buildBaseInput({
      nita: { applicable: false },
    })), 'KENYA_NITA_EXEMPTION_EVIDENCE_REQUIRED');
  });
});
