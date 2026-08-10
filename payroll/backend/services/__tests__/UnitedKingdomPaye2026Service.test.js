'use strict';

const paye2026 = require('../UnitedKingdomPaye2026Service');
const {
  UnsupportedPayeCaseError,
  SOURCE_HASHES,
} = require('../UnitedKingdomPaye2026Service');
const officialCorpus = require('./fixtures/unitedKingdomPaye2026.hmrc.json');

const MONTHLY_PAY_DATES = Object.freeze([
  '2026-04-30',
  '2026-05-29',
  '2026-06-30',
  '2026-07-31',
  '2026-08-31',
  '2026-09-30',
  '2026-10-30',
  '2026-11-30',
  '2026-12-31',
  '2027-01-29',
  '2027-02-26',
  '2027-03-31',
]);

function payDateFor(payFrequency, periodNumber) {
  if (payFrequency === 'monthly') return MONTHLY_PAY_DATES[periodNumber - 1];
  return new Date(Date.UTC(2026, 3, 10 + ((periodNumber - 1) * 7))).toISOString().slice(0, 10);
}

function calculateFixture(fixture, overrides = {}) {
  return paye2026.calculate({
    ...fixture.input,
    payDate: payDateFor(fixture.input.payFrequency, fixture.input.periodNumber),
    remittanceMethod: 'electronic',
    remittanceFrequency: 'monthly',
    ...overrides,
  });
}

function baseInput(overrides = {}) {
  return {
    payFrequency: 'monthly',
    basis: 'week1_month1',
    periodNumber: 1,
    grossPay: '1000.00',
    taxCode: '1257L',
    payDate: '2026-04-30',
    remittanceMethod: 'electronic',
    remittanceFrequency: 'monthly',
    ...overrides,
  };
}

describe('UnitedKingdomPaye2026Service — official HMRC PAYE Tax v1.1 corpus', () => {
  test('fixture corpus is source-addressable and pinned to the downloaded official asset', () => {
    expect(officialCorpus.cases).toHaveLength(52);
    expect(new Set(officialCorpus.cases.map((fixture) => fixture.sourceCaseId)).size).toBe(52);
    expect(officialCorpus.unsupportedOfficialCases).toHaveLength(6);
    expect(officialCorpus.corpus.sha256).toBe(SOURCE_HASHES.testDataSha256);

    for (const fixture of officialCorpus.cases) {
      expect(fixture.sourceCaseId).toMatch(/^HMRC-PAYE-2026-27-v1\.1\/.+\/row-\d+$/);
      expect(fixture.workbook).toMatch(/\.xlsx$/);
      expect(fixture.sheet).toBeTruthy();
      expect(Number.isInteger(fixture.row)).toBe(true);
    }
  });

  test.each(officialCorpus.cases)('$sourceCaseId', (fixture) => {
    const result = calculateFixture(fixture);

    expect(result.taxDue).toBe(fixture.expected.taxDue);
    expect(result.taxLiabilityToDate).toBe(fixture.expected.taxLiabilityToDate);
    expect(result.status).toBe('standalone_preview_only');
    expect(result.runnable).toBe(false);
  });

  test.each(officialCorpus.unsupportedOfficialCases)(
    'fails closed for excluded official case $sourceCaseId',
    (fixture) => {
      const weekly = fixture.sourceCaseId.includes('_wkly/');
      expect(() => paye2026.calculate(baseInput({
        payFrequency: weekly ? 'weekly' : 'monthly',
        grossPay: fixture.grossPay,
        taxCode: fixture.taxCode,
      }))).toThrow(UnsupportedPayeCaseError);
    }
  );
});

describe('UnitedKingdomPaye2026Service — tax code and basis contracts', () => {
  test.each([
    ['0T', '200.00', 'rest_of_uk'],
    ['S0T', '196.69', 'scotland'],
    ['C0T', '200.00', 'wales'],
  ])('supports zero-allowance code %s', (taxCode, expectedTax, expectedRegion) => {
    const result = paye2026.calculate(baseInput({ taxCode }));

    expect(result.taxDue).toBe(expectedTax);
    expect(result.taxCode.region).toBe(expectedRegion);
    expect(result.calculation.codeAdjustmentToDate).toBe('0.00');
  });

  test.each(['L', 'M', 'N', 'T'])('uses the numeric allowance for suffix %s', (suffix) => {
    const result = paye2026.calculate(baseInput({ taxCode: `1257${suffix}` }));

    expect(result.taxCode).toMatchObject({ type: 'suffix', numericPart: 1257, suffix });
    expect(result.calculation.codeAdjustmentToDate).toBe('1048.26');
    expect(result.taxDue).toBe('0.00');
  });

  test('supports Welsh CK additional-pay codes using the Welsh rate table', () => {
    const result = paye2026.calculate(baseInput({ taxCode: 'CK1' }));

    expect(result.taxCode).toMatchObject({ region: 'wales', type: 'k', numericPart: 1 });
    expect(result.calculation.codeAdjustmentToDate).toBe('1.59');
    expect(result.taxDue).toBe('200.20');
  });

  test('treats NT on week 1/month 1 as no tax and never invents a prior-period refund', () => {
    const result = paye2026.calculate(baseInput({ taxCode: 'NT', grossPay: '5000.00' }));

    expect(result.taxDue).toBe('0.00');
    expect(result.taxRefunded).toBe('0.00');
    expect(result.taxLiabilityToDate).toBe('0.00');
  });

  test('uses period 1 constants for a later month operated on the W1/M1 basis', () => {
    const monthOne = paye2026.calculate(baseInput({ grossPay: '1156.25' }));
    const monthTwelve = paye2026.calculate(baseInput({
      periodNumber: 12,
      payDate: '2027-03-31',
      grossPay: '1156.25',
    }));

    expect(monthTwelve.taxDue).toBe(monthOne.taxDue);
    expect(monthTwelve.calculation.codeAdjustmentToDate).toBe(monthOne.calculation.codeAdjustmentToDate);
  });

  test('applies the 50% regulatory limit to cash pay excluding payrolled benefits', () => {
    const result = paye2026.calculate(baseInput({
      grossPay: '100.00',
      payrolledBenefitsInKind: '20.00',
      taxCode: 'K999999',
    }));

    expect(result.calculation.regulatoryLimit).toBe('40.00');
    expect(result.calculation.regulatoryLimitApplied).toBe(true);
    expect(result.taxDue).toBe('40.00');
    expect(result.taxLiabilityToDate).toBe('40.00');
  });

  test('keeps HMRC rounding stages visible on an exact money result', () => {
    const result = paye2026.calculate(baseInput({ grossPay: '10450.24', taxCode: '45L' }));
    const stages = result.calculation.roundingHistory.map((event) => event.stage);

    expect(stages).toContain('gb.paye.tax_formula_4dp');
    expect(stages).toContain('gb.paye.liability_penny_down');
  });
});

describe('UnitedKingdomPaye2026Service — liability, filing and remittance output', () => {
  test('emits an exact HMRC/FPS liability component and electronic payment due date', () => {
    const fixture = officialCorpus.cases[0];
    const result = calculateFixture(fixture);
    const component = result.components[0];

    expect(component).toMatchObject({
      liabilityCode: 'GB_PAYE_INCOME_TAX',
      payer: 'employee',
      amount: { amount: '21.40', currency: 'GBP', minorUnits: 2 },
      authority: { code: 'HMRC', jurisdictionCode: 'GB' },
      remittance: {
        formCode: 'FPS',
        frequency: 'monthly',
        periodStart: '2026-04-06',
        periodEnd: '2026-05-05',
        dueDate: '2026-05-22',
      },
    });
    expect(result.reporting.fpsDueDate).toBe('2026-04-30');
    expect(result.liabilityLedger.employeeTotal.amount).toBe('21.40');
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('uses the 19th for a PAYE payment made by post', () => {
    const result = calculateFixture(officialCorpus.cases[0], { remittanceMethod: 'post' });

    expect(result.reporting.remittanceDueDate).toBe('2026-05-19');
    expect(result.components[0].remittance.dueDate).toBe('2026-05-19');
  });

  test('represents a cumulative refund separately instead of forcing a negative liability into the ledger', () => {
    const fixture = officialCorpus.cases.find((item) => item.sourceCaseId.endsWith('/rest-of-UK/Gen_cumul-mthly/row-14'));
    const result = calculateFixture(fixture);

    expect(result.taxDue).toBe('-29406.05');
    expect(result.taxDeducted).toBe('0.00');
    expect(result.taxRefunded).toBe('29406.05');
    expect(result.components).toEqual([]);
    expect(result.liabilityLedger.entries).toEqual([]);
    expect(result.refundComponent).toMatchObject({
      liabilityCode: 'GB_PAYE_INCOME_TAX_REFUND',
      direction: 'refund',
      amount: { amount: '29406.05', currency: 'GBP' },
      authority: { code: 'HMRC' },
      reporting: { formCode: 'FPS' },
    });
  });
});

describe('UnitedKingdomPaye2026Service — fail-closed Wave 1 boundary', () => {
  test.each([
    ['wrong tax year', { taxYear: '2025-26' }],
    ['fortnightly payroll', { payFrequency: 'fortnightly' }],
    ['week 53', { payFrequency: 'weekly', periodNumber: 53, payDate: '2027-04-05' }],
    ['unsupported basis', { basis: 'annual' }],
    ['free-of-tax calculation', { calculationMethod: 'free_of_tax' }],
    ['rest-of-UK D2 without a rate', { taxCode: 'D2' }],
    ['Welsh D2 without a rate', { taxCode: 'CD2' }],
    ['Scottish D3 outside Wave 1', { taxCode: 'SD3' }],
    ['invalid K0', { taxCode: 'K0' }],
    ['invalid Scottish NT', { taxCode: 'SNT' }],
    ['unsupported suffix', { taxCode: '1257X' }],
    ['date outside tax year', { payDate: '2027-04-06' }],
  ])('rejects %s', (_label, overrides) => {
    expect(() => paye2026.calculate(baseInput(overrides))).toThrow(UnsupportedPayeCaseError);
  });

  test('requires exact decimal strings at the adapter boundary', () => {
    expect(() => paye2026.calculate(baseInput({ grossPay: 0.1 + 0.2 })))
      .toThrow(/exact decimal string/i);
  });

  test('requires cumulative pay and previous tax state for cumulative calculations', () => {
    expect(() => paye2026.calculate(baseInput({
      basis: 'cumulative',
      cumulativePayToDate: '1000.00',
      previousTaxPaidToDate: undefined,
    }))).toThrow(/previousTaxPaidToDate/i);

    expect(() => paye2026.calculate(baseInput({
      basis: 'cumulative',
      cumulativePayToDate: undefined,
      previousTaxPaidToDate: '0.00',
    }))).toThrow(/cumulativePayToDate/i);
  });

  test('requires the remittance channel because it changes the due date', () => {
    expect(() => paye2026.calculate(baseInput({ remittanceMethod: undefined })))
      .toThrow(/remittanceMethod/i);
  });

  test('fails closed for a quarterly remitter until that due-date calendar is implemented', () => {
    expect(() => paye2026.calculate(baseInput({ remittanceFrequency: 'quarterly' })))
      .toThrow(UnsupportedPayeCaseError);
  });

  test('rejects impossible pay and benefit bases', () => {
    expect(() => paye2026.calculate(baseInput({ grossPay: '-1.00' })))
      .toThrow(UnsupportedPayeCaseError);
    expect(() => paye2026.calculate(baseInput({ grossPay: '10.00', payrolledBenefitsInKind: '10.01' })))
      .toThrow(/between zero and grossPay/i);
  });
});
