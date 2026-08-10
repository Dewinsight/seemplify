'use strict';

const {
  calculate,
  calculatePension,
  calculateResidentPaye,
  calculateBonus,
  calculateOvertime,
  calculateVehicleBenefit,
  GhanaPayroll2026Error,
  OFFICIAL_SOURCES,
  ADAPTER_METADATA,
} = require('../GhanaPayroll2026Service');
const official = require('./fixtures/ghanaPayroll2026.official.json');

const HASH_A = 'A'.repeat(64);
const HASH_B = 'B'.repeat(64);
const HASH_C = 'C'.repeat(64);

function tier2Scheme(overrides = {}) {
  return {
    schemeName: 'Fixture Registered Tier 2 Scheme',
    trusteeName: 'Fixture Approved Trustee',
    custodianName: 'Fixture Approved Custodian',
    npraRegistrationReference: 'NPRA-FIXTURE-2026-001',
    evidenceHashSha256: HASH_A,
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-12-31',
    ...overrides,
  };
}

function buildBaseInput(overrides = {}) {
  return {
    taxYear: '2026',
    payDate: '2026-02-28',
    payFrequency: 'monthly',
    workerType: 'regular_permanent',
    residency: 'resident',
    pensionCoverage: 'mandatory_act_766',
    basicSalary: '5000.00',
    taxableCashAllowances: [{ code: 'TRANSPORT', amount: '500.00' }],
    benefits: [],
    reliefCertificate: null,
    bonus: { amount: '0.00' },
    overtime: { amount: '0.00' },
    tier2Scheme: tier2Scheme(),
    ...overrides,
  };
}

function bonusHistory() {
  return {
    sourceId: 'FIXTURE-PAYROLL-YTD-2026',
    evidenceHashSha256: HASH_B,
    taxYear: '2026',
  };
}

function overtimeEvidence(overrides = {}) {
  return {
    juniorStaff: true,
    annualQualifyingEmploymentIncome: '8400.00',
    sourceId: 'FIXTURE-EMPLOYMENT-CLASSIFICATION',
    evidenceHashSha256: HASH_C,
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-12-31',
    ...overrides,
  };
}

function expectAdapterError(fn, code) {
  try {
    fn();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(GhanaPayroll2026Error);
    expect(error.code).toBe(code);
  }
}

function liability(result, code) {
  return result.liabilityLedger.entries.find((entry) => entry.liabilityCode === code);
}

describe('Ghana 2026 official source contract and deployment boundary', () => {
  test('fixture URLs exactly match the adapter official-source registry', () => {
    expect(Object.keys(official.sourceUrls).sort()).toEqual(Object.keys(OFFICIAL_SOURCES).sort());
    for (const [sourceId, source] of Object.entries(OFFICIAL_SOURCES)) {
      expect(source.url).toBe(official.sourceUrls[sourceId]);
      expect(source.authority).toBeTruthy();
      expect(source.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(source.supports.length).toBeGreaterThan(0);
    }
  });

  test('uses only official GRA, SSNIT, and NPRA hosts', () => {
    const allowedHosts = new Set(['gra.gov.gh', 'www.ssnit.org.gh', 'npra.gov.gh', 'www.npra.gov.gh']);
    for (const source of Object.values(OFFICIAL_SOURCES)) {
      expect(allowedHosts.has(new URL(source.url).hostname)).toBe(true);
    }
  });

  test('pins every audited source document to its recorded SHA-256', () => {
    const pdfSources = Object.values(OFFICIAL_SOURCES).filter((source) => source.sha256);
    expect(pdfSources.length).toBeGreaterThanOrEqual(6);
    for (const source of pdfSources) expect(source.sha256).toMatch(/^[A-F0-9]{64}$/);
    expect(OFFICIAL_SOURCES.NPRA_ACT_766.documentUrl)
      .toBe('https://npra-live.s3.amazonaws.com/public/documents/NPRA_2008_Act_766.pdf');
  });

  test('is standalone, preview-only, non-runnable, and non-postable', () => {
    const result = calculate(buildBaseInput());
    expect(ADAPTER_METADATA).toMatchObject({
      code: 'GH_2026_WAVE1_STANDALONE',
      lawBundle: official.lawBundle,
      integrationStatus: 'standalone_not_integrated',
      runnable: false,
      postable: false,
    });
    expect(result.status).toBe('preview_calculated_non_postable');
    expect(result.reviewFlags).toContainEqual(expect.objectContaining({
      code: 'GH_PREVIEW_NOT_POSTABLE',
      severity: 'blocking',
    }));
    expect(Object.isFrozen(result)).toBe(true);
  });
});

describe('GRA 2024-in-force resident monthly PAYE table', () => {
  test.each(official.residentPayeCases)('$caseId', ({ chargeableIncome, expectedTax }) => {
    expect(calculateResidentPaye(chargeableIncome).amount.amount).toBe(expectedTax);
  });

  test('records half-up rounding at each official PAYE band stage', () => {
    const result = calculateResidentPaye('3896.67');
    const band = result.bands.find((row) => row.code === 'BAND_17_5');
    expect(band.tax).toMatchObject({ amount: '554.17' });
    expect(band.tax.roundingHistory).toEqual([
      {
        stage: 'gh.paye.band_17_5.tax',
        mode: 'half_up',
        unit: '0.01',
        input: '554.16725',
        output: '554.17',
      },
    ]);
  });

  test('fails closed above GHS 50,000 because official widths and labels conflict', () => {
    expectAdapterError(
      () => calculateResidentPaye('50000.01'),
      'GH_GRA_TOP_BAND_SOURCE_CONFLICT'
    );
  });
});

describe('2026 SSNIT and Tier 2 contribution routing', () => {
  test('reproduces the official SSNIT Omnibus GHS 1,500 example', () => {
    const fixture = official.pensionCases.find((row) => row.caseId === 'SSNIT_OMNIBUS_KOFI_EDEM_GHS_1500');
    const result = calculatePension({
      taxYear: '2026',
      payDate: '2026-02-28',
      basicSalary: fixture.basicSalary,
      tier2Scheme: tier2Scheme(),
    });
    for (const [component, expected] of Object.entries(fixture.expected)) {
      expect(result.contributions[component].amount).toBe(expected);
    }
    expect(result.status).toBe('calculated_preview');
  });

  test('surfaces the official GHS 79.40 minimum conflict without guessing an allocation', () => {
    const fixture = official.pensionCases.find((row) => row.caseId === 'SSNIT_2026_NOTICE_MINIMUM_587_80');
    const result = calculatePension({
      taxYear: '2026',
      payDate: '2026-01-31',
      basicSalary: fixture.basicSalary,
      tier2Scheme: tier2Scheme(),
    });
    expect(result.status).toBe(fixture.expectedStatus);
    expect(result.formulaResults.firstTier.amount).toBe(fixture.rawFirstTierFormula);
    expect(result.officialPublishedFirstTierContribution.amount).toBe(fixture.officialPublishedFirstTier);
    expect(result.conflict).toMatchObject({
      code: 'GH_SSNIT_2026_MINIMUM_ALLOCATION_CONFLICT',
      difference: fixture.difference,
    });
    expect(result.postable).toBe(false);
  });

  test('uses the same blocked minimum path when salary is clamped upward', () => {
    const result = calculatePension({
      taxYear: '2026',
      payDate: '2026-01-31',
      basicSalary: '500.00',
      tier2Scheme: tier2Scheme(),
    });
    expect(result).toMatchObject({
      status: 'blocked_official_minimum_allocation_conflict',
      clampReason: 'clamped_to_2026_minimum',
      pensionableSalary: { amount: '587.80' },
    });
  });

  test('reproduces the official 2026 maximum and all statutory routes', () => {
    const fixture = official.pensionCases.find((row) => row.caseId === 'SSNIT_2026_NOTICE_MAXIMUM_69000');
    const result = calculatePension({
      taxYear: '2026',
      payDate: '2026-12-31',
      basicSalary: fixture.basicSalary,
      tier2Scheme: tier2Scheme(),
    });
    for (const [component, expected] of Object.entries(fixture.expected)) {
      expect(result.contributions[component].amount).toBe(expected);
    }
    expect(result.contributions.employerFirstTier.amount).toBe('5520.00');
  });

  test('caps a higher salary at GHS 69,000', () => {
    const result = calculatePension({
      taxYear: '2026',
      payDate: '2026-12-31',
      basicSalary: '100000.00',
      tier2Scheme: tier2Scheme(),
    });
    expect(result).toMatchObject({
      clampReason: 'clamped_to_2026_maximum',
      pensionableSalary: { amount: '69000.00' },
      contributions: { firstTier: { amount: '9315.00' } },
    });
  });

  test('requires current evidence for the registered Tier 2 route', () => {
    expectAdapterError(() => calculatePension({
      taxYear: '2026',
      payDate: '2026-02-28',
      basicSalary: '1500.00',
      tier2Scheme: {},
    }), 'GH_TIER2_EVIDENCE_REQUIRED');
    expectAdapterError(() => calculatePension({
      taxYear: '2026',
      payDate: '2026-02-28',
      basicSalary: '1500.00',
      tier2Scheme: tier2Scheme({ effectiveTo: '2026-01-31' }),
    }), 'GH_EVIDENCE_INACTIVE');
  });

  test('fails closed when SSNIT percentage products require uncertified sub-pesewa rounding', () => {
    expectAdapterError(() => calculatePension({
      taxYear: '2026',
      payDate: '2026-02-28',
      basicSalary: '1000.01',
      tier2Scheme: tier2Scheme(),
    }), 'GH_SSNIT_ROUNDING_UNCERTIFIED');
  });
});

describe('GRA bonus annual-cap and YTD treatment', () => {
  test.each(official.bonusCases)('$caseId', (fixture) => {
    const result = calculateBonus({
      residency: 'resident',
      bonus: {
        amount: fixture.currentBonus,
        annualBasicSalary: fixture.annualBasicSalary,
        paidYtdBefore: fixture.paidYtdBefore,
        historyEvidence: bonusHistory(),
      },
    });
    expect(result).toMatchObject({
      annualConcessionCap: { amount: fixture.expected.annualCap },
      concessionAmount: { amount: fixture.expected.concessionAmount },
      finalWithholding: { amount: fixture.expected.tax },
      regularTaxableExcess: { amount: fixture.expected.regularTaxableExcess },
    });
  });

  test('uses evidenced prior bonus YTD to split a cap-crossing payment', () => {
    const result = calculateBonus({
      residency: 'resident',
      bonus: {
        amount: '1000.00',
        annualBasicSalary: '60000.00',
        paidYtdBefore: '8500.00',
        historyEvidence: bonusHistory(),
      },
    });
    expect(result).toMatchObject({
      annualConcessionCap: { amount: '9000.00' },
      concessionAmount: { amount: '500.00' },
      finalWithholding: { amount: '25.00' },
      regularTaxableExcess: { amount: '500.00' },
    });
  });

  test('taxes a non-resident bonus at the published final 20% rate', () => {
    const result = calculateBonus({ residency: 'nonresident', bonus: { amount: '1000.00' } });
    expect(result).toMatchObject({
      finalWithholding: { amount: '200.00' },
      treatment: 'nonresident_final_20_percent',
    });
  });

  test('requires resident YTD evidence and rejects uncertified fractional-cent tax', () => {
    expectAdapterError(() => calculateBonus({
      residency: 'resident',
      bonus: { amount: '1000.00', annualBasicSalary: '60000.00', paidYtdBefore: '0.00' },
    }), 'GH_BONUS_HISTORY_EVIDENCE_REQUIRED');
    expectAdapterError(() => calculateBonus({
      residency: 'resident',
      bonus: {
        amount: '0.01',
        annualBasicSalary: '60000.00',
        paidYtdBefore: '0.00',
        historyEvidence: bonusHistory(),
      },
    }), 'GH_BONUS_ROUNDING_UNCERTIFIED');
  });
});

describe('GRA qualifying overtime treatment', () => {
  test.each(official.overtimeCases)('$caseId', (fixture) => {
    const result = calculateOvertime({
      taxYear: '2026',
      payDate: '2026-07-31',
      residency: 'resident',
      basicSalary: fixture.basicSalary,
      overtime: {
        amount: fixture.overtime,
        eligibilityEvidence: overtimeEvidence({
          annualQualifyingEmploymentIncome: fixture.annualQualifyingEmploymentIncome,
        }),
      },
    });
    expect(result.finalWithholding.amount).toBe(fixture.expectedTax);
    if (fixture.expectedFivePercentBase) {
      expect(result.concessionAtFivePercent.amount).toBe(fixture.expectedFivePercentBase);
      expect(result.concessionAtTenPercent.amount).toBe(fixture.expectedTenPercentBase);
    }
  });

  test('adds overtime to regular PAYE when junior status or the GHS 18,000 annual threshold fails', () => {
    for (const evidence of [
      overtimeEvidence({ juniorStaff: false }),
      overtimeEvidence({ annualQualifyingEmploymentIncome: '18000.01' }),
    ]) {
      const result = calculateOvertime({
        taxYear: '2026',
        payDate: '2026-07-31',
        residency: 'resident',
        basicSalary: '2000.00',
        overtime: { amount: '500.00', eligibilityEvidence: evidence },
      });
      expect(result).toMatchObject({
        regularTaxableAmount: { amount: '500.00' },
        finalWithholding: { amount: '0.00' },
        treatment: 'resident_not_qualifying_added_to_regular_paye',
      });
    }
  });

  test('taxes non-resident overtime at the published final 20% rate', () => {
    const result = calculateOvertime({
      taxYear: '2026',
      payDate: '2026-07-31',
      residency: 'nonresident',
      basicSalary: '5000.00',
      overtime: { amount: '500.00' },
    });
    expect(result).toMatchObject({
      finalWithholding: { amount: '100.00' },
      treatment: 'nonresident_final_20_percent',
    });
  });

  test('requires current classification evidence and exact-cent component results', () => {
    expectAdapterError(() => calculateOvertime({
      taxYear: '2026',
      payDate: '2026-07-31',
      residency: 'resident',
      basicSalary: '700.00',
      overtime: { amount: '50.00' },
    }), 'GH_OVERTIME_EVIDENCE_REQUIRED');
    expectAdapterError(() => calculateOvertime({
      taxYear: '2026',
      payDate: '2026-07-31',
      residency: 'resident',
      basicSalary: '700.00',
      overtime: { amount: '0.01', eligibilityEvidence: overtimeEvidence() },
    }), 'GH_OVERTIME_ROUNDING_UNCERTIFIED');
  });
});

describe('Act 1094 vehicle and fuel benefit values', () => {
  test.each(official.vehicleBenefitCases)('$caseId', (fixture) => {
    const result = calculateVehicleBenefit({
      type: fixture.type,
      totalCashEmoluments: fixture.totalCashEmoluments,
    });
    expect(result.taxableValue.amount).toBe(fixture.expectedTaxableValue);
    expect(result.capApplied).toBe(fixture.expectedCapApplied);
  });

  test('supports each statutory vehicle row', () => {
    expect(calculateVehicleBenefit({ type: 'vehicle_fuel', totalCashEmoluments: '10000.00' }).taxableValue.amount)
      .toBe('1000.00');
    expect(calculateVehicleBenefit({ type: 'vehicle_only', totalCashEmoluments: '10000.00' }).taxableValue.amount)
      .toBe('500.00');
    expect(calculateVehicleBenefit({ type: 'fuel_only', totalCashEmoluments: '20000.00' }).taxableValue.amount)
      .toBe('625.00');
  });

  test('fails closed for unsupported valuations and sub-pesewa uncapped results', () => {
    expectAdapterError(() => calculateVehicleBenefit({
      type: 'accommodation',
      totalCashEmoluments: '5000.00',
    }), 'GH_UNSUPPORTED_BENEFIT_VALUATION');
    expectAdapterError(() => calculateVehicleBenefit({
      type: 'vehicle_only',
      totalCashEmoluments: '1000.01',
    }), 'GH_BENEFIT_ROUNDING_UNCERTIFIED');
  });
});

describe('Ghana 2026 end-to-end monthly preview goldens', () => {
  test.each(official.derivedMonthlyPayrollCases)('$caseId', (fixture) => {
    const nonresident = fixture.caseId.includes('NONRESIDENT');
    const result = calculate(buildBaseInput({ residency: nonresident ? 'nonresident' : 'resident' }));
    expect(result.paye.chargeableIncome.amount).toBe(fixture.expected.chargeableIncome);
    expect(result.paye.amount.amount).toBe(fixture.expected.regularPaye);
    expect(result.totals.employeePension.amount).toBe(fixture.expected.employeePension);
    expect(result.totals.employerPension.amount).toBe(fixture.expected.employerPension);
    expect(result.totals.netCashPay.amount).toBe(fixture.expected.netCashPay);
  });

  test('applies an evidenced GRA monthly relief without deriving an uncertified monthly amount', () => {
    const result = calculate(buildBaseInput({
      reliefCertificate: {
        issuer: 'GRA',
        approvalReference: 'GRA-RELIEF-APPROVAL-2026-001',
        verificationReference: 'GRA-RELIEF-VERIFY-2026-001',
        evidenceHashSha256: HASH_B,
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-12-31',
        annualApprovedAmount: '1200.00',
        monthlyAuthorizedAmount: '100.00',
        claimedYtdBefore: '100.00',
        categories: ['dependant_spouse_or_children'],
      },
    }));
    expect(result.relief).toMatchObject({
      amount: { amount: '100.00' },
      certificate: { claimedYtdAfter: { amount: '200.00' } },
    });
    expect(result.paye.chargeableIncome.amount).toBe('5125.00');
    expect(result.paye.amount.amount).toBe('879.75');
    expect(result.totals.netCashPay.amount).toBe('4345.25');
  });

  test('combines resident bonus YTD split with regular PAYE without double taxing the concession', () => {
    const result = calculate(buildBaseInput({
      taxableCashAllowances: [],
      bonus: {
        amount: '1000.00',
        annualBasicSalary: '60000.00',
        paidYtdBefore: '8500.00',
        historyEvidence: bonusHistory(),
      },
    }));
    expect(result.bonus).toMatchObject({
      concessionAmount: { amount: '500.00' },
      regularTaxableExcess: { amount: '500.00' },
      finalWithholding: { amount: '25.00' },
    });
    expect(result.paye).toMatchObject({
      chargeableIncome: { amount: '5225.00' },
      amount: { amount: '904.75' },
    });
    expect(result.totals).toMatchObject({
      totalTaxWithholding: { amount: '929.75' },
      netCashPay: { amount: '4795.25' },
    });
  });

  test('combines qualifying overtime with regular PAYE as separate final withholding', () => {
    const result = calculate(buildBaseInput({
      basicSalary: '700.00',
      taxableCashAllowances: [],
      overtime: { amount: '500.00', eligibilityEvidence: overtimeEvidence() },
    }));
    expect(result.overtime.finalWithholding.amount).toBe('32.50');
    expect(result.paye).toMatchObject({
      chargeableIncome: { amount: '661.50' },
      amount: { amount: '11.65' },
    });
    expect(result.totals).toMatchObject({
      totalTaxWithholding: { amount: '44.15' },
      netCashPay: { amount: '1117.35' },
    });
  });

  test('adds non-qualifying resident overtime to regular graduated PAYE', () => {
    const result = calculate(buildBaseInput({
      basicSalary: '2000.00',
      taxableCashAllowances: [],
      overtime: {
        amount: '500.00',
        eligibilityEvidence: overtimeEvidence({ annualQualifyingEmploymentIncome: '24000.00' }),
      },
    }));
    expect(result.overtime).toMatchObject({
      regularTaxableAmount: { amount: '500.00' },
      finalWithholding: { amount: '0.00' },
    });
    expect(result.paye).toMatchObject({
      chargeableIncome: { amount: '2390.00' },
      amount: { amount: '309.00' },
    });
    expect(result.totals.netCashPay.amount).toBe('2081.00');
  });

  test('applies non-resident 25% regular and 20% variable withholding separately', () => {
    const result = calculate(buildBaseInput({
      residency: 'nonresident',
      taxableCashAllowances: [],
      bonus: { amount: '1000.00' },
      overtime: { amount: '500.00' },
    }));
    expect(result.paye.amount.amount).toBe('1181.25');
    expect(result.bonus.finalWithholding.amount).toBe('200.00');
    expect(result.overtime.finalWithholding.amount).toBe('100.00');
    expect(result.totals).toMatchObject({
      totalTaxWithholding: { amount: '1481.25' },
      netCashPay: { amount: '4743.75' },
    });
  });

  test('includes a supported non-cash vehicle benefit in PAYE but not gross cash', () => {
    const result = calculate(buildBaseInput({
      basicSalary: '8000.00',
      taxableCashAllowances: [],
      benefits: [{ type: 'driver_vehicle_fuel' }],
    }));
    expect(result.earnings).toMatchObject({
      taxableBenefitTotal: { amount: '1000.00' },
      grossCashPay: { amount: '8000.00' },
    });
    expect(result.paye.chargeableIncome.amount).toBe('8560.00');
  });

  test('builds reconciled component liabilities and exact statutory due dates', () => {
    const result = calculate(buildBaseInput());
    expect(result.liabilityLedger.entries).toHaveLength(6);
    expect(result.liabilityLedger).toMatchObject({
      employeeTotal: { amount: '1179.75' },
      employerTotal: { amount: '650.00' },
      combinedTotal: { amount: '1829.75' },
    });
    expect(liability(result, 'GH_SSNIT_TIER1_EMPLOYEE')).toMatchObject({
      amount: { amount: '275.00' },
      remittance: { dueDate: '2026-03-14' },
      authority: { code: 'SSNIT' },
    });
    expect(liability(result, 'GH_SSNIT_TIER1_EMPLOYER').amount.amount).toBe('400.00');
    expect(liability(result, 'GH_NPRA_TIER2_EMPLOYER')).toMatchObject({
      amount: { amount: '250.00' },
      remittance: { dueDate: '2026-03-14' },
      authority: { code: 'NPRA_REGISTERED_TIER2_SCHEME', name: 'Fixture Registered Tier 2 Scheme' },
      evidenceReference: 'NPRA-FIXTURE-2026-001',
    });
    expect(liability(result, 'GH_PAYE_REGULAR')).toMatchObject({
      amount: { amount: '904.75' },
      remittance: { dueDate: '2026-03-15' },
      authority: { code: 'GRA' },
    });
  });

  test('returns a blocked full preview with no ledger at the SSNIT minimum', () => {
    const result = calculate(buildBaseInput({ basicSalary: '587.80', taxableCashAllowances: [] }));
    expect(result).toMatchObject({
      status: 'blocked_preview',
      pension: { status: 'blocked_official_minimum_allocation_conflict' },
      paye: null,
      liabilityLedger: null,
      totals: null,
    });
  });
});

describe('Ghana Wave 1 fail-closed boundaries', () => {
  test.each(['casual', 'temporary', 'seasonal'])('rejects unsupported worker type %s', (workerType) => {
    expectAdapterError(() => calculate(buildBaseInput({ workerType })), 'GH_UNSUPPORTED_WORKER_TYPE');
  });

  test('rejects stale law years, non-monthly payroll, and unsupported coverage', () => {
    expectAdapterError(() => calculate(buildBaseInput({
      taxYear: '2027',
      payDate: '2027-01-31',
    })), 'GH_UNSUPPORTED_TAX_YEAR');
    expectAdapterError(() => calculate(buildBaseInput({ payFrequency: 'weekly' })), 'GH_UNSUPPORTED_PAY_FREQUENCY');
    expectAdapterError(() => calculate(buildBaseInput({ pensionCoverage: 'expatriate_exempt' })), 'GH_UNSUPPORTED_PENSION_COVERAGE');
  });

  test('requires explicit component declarations and rejects undeclared keys', () => {
    const missingBenefits = buildBaseInput();
    delete missingBenefits.benefits;
    expectAdapterError(() => calculate(missingBenefits), 'GH_COMPONENT_DECLARATION_REQUIRED');
    expectAdapterError(() => calculate({ ...buildBaseInput(), stockOptions: '100.00' }), 'GH_UNSUPPORTED_INPUT');
  });

  test('fails closed for unsupported benefits and uncertain variable-pay benefit basis', () => {
    expectAdapterError(() => calculate(buildBaseInput({
      benefits: [{ type: 'accommodation' }],
    })), 'GH_UNSUPPORTED_BENEFIT_VALUATION');
    expectAdapterError(() => calculate(buildBaseInput({
      benefits: [{ type: 'vehicle_only' }],
      bonus: {
        amount: '1000.00',
        annualBasicSalary: '60000.00',
        paidYtdBefore: '0.00',
        historyEvidence: bonusHistory(),
      },
    })), 'GH_BENEFIT_CASH_EMOLUMENTS_BASIS_UNCERTIFIED');
  });

  test('requires active GRA relief evidence and blocks non-resident or return-only reliefs', () => {
    const relief = {
      issuer: 'GRA',
      approvalReference: 'GRA-R',
      verificationReference: 'GRA-V',
      evidenceHashSha256: HASH_B,
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-12-31',
      annualApprovedAmount: '1200.00',
      monthlyAuthorizedAmount: '100.00',
      claimedYtdBefore: '0.00',
      categories: ['dependant_spouse_or_children'],
    };
    expectAdapterError(() => calculate(buildBaseInput({
      residency: 'nonresident',
      reliefCertificate: relief,
    })), 'GH_RELIEF_NOT_AVAILABLE_TO_NONRESIDENT');
    expectAdapterError(() => calculate(buildBaseInput({
      reliefCertificate: { ...relief, effectiveTo: '2026-01-31' },
    })), 'GH_EVIDENCE_INACTIVE');
    expectAdapterError(() => calculate(buildBaseInput({
      reliefCertificate: { ...relief, categories: ['training_cost'] },
    })), 'GH_RELIEF_NOT_SUPPORTED_UPFRONT');
    expectAdapterError(() => calculate(buildBaseInput({
      reliefCertificate: {
        ...relief,
        annualApprovedAmount: '100.00',
        claimedYtdBefore: '100.00',
      },
    })), 'GH_RELIEF_CERTIFICATE_LIMIT_EXCEEDED');
  });

  test('rejects JavaScript numbers at every statutory money boundary', () => {
    expectAdapterError(() => calculate(buildBaseInput({ basicSalary: 5000 })), 'GH_INVALID_MONEY');
    expectAdapterError(() => calculateResidentPaye(5000), 'GH_INVALID_MONEY');
  });
});
