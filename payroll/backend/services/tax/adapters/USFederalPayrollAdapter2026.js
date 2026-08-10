'use strict';

/**
 * United States federal payroll adapter, 2026 Wave 1.
 *
 * This module is deliberately not wired into TaxJurisdictionService. It is a
 * federal-only, preview-stage adapter and always prevents payroll posting. A
 * caller must also resolve certified state withholding, local withholding (or
 * a certified no-tax determination), and state unemployment adapters for the
 * employee's exact work location.
 *
 * Monetary inputs are unsigned USD decimal strings with at most two decimal
 * places. YTD values must exclude the current payment. This strict boundary is
 * intentional: payroll code must not hide binary floating-point loss or guess
 * which taxable wage base applies to a liability.
 */

const statutoryMoneyService = require('../../StatutoryMoneyService');
const statutoryLiabilityLedgerService = require('../../StatutoryLiabilityLedgerService');
const { StatutoryMoney, ExactDecimal } = require('../../StatutoryMoneyService');

const USD = Object.freeze({ currency: 'USD', minorUnits: 2 });
const TAX_YEAR = 2026;
const EFFECTIVE_FROM = '2026-01-01';
const EFFECTIVE_TO = '2026-12-31';

const OFFICIAL_RULES = Object.freeze({
  P15T_WORKSHEET_1A: Object.freeze({
    id: 'IRS-P15T-2026-WORKSHEET-1A',
    title: 'Publication 15-T (2026), Worksheet 1A and annual percentage method tables',
    url: 'https://www.irs.gov/pub/irs-pdf/p15t.pdf',
    pages: '9-12',
  }),
  P15T_COMPUTATIONAL_BRIDGE: Object.freeze({
    id: 'IRS-P15T-2026-COMPUTATIONAL-BRIDGE-W4-2019',
    title: 'Publication 15-T (2026), computational bridge for 2019 and earlier Forms W-4',
    url: 'https://www.irs.gov/pub/irs-pdf/p15t.pdf',
    pages: '4-5',
  }),
  P15T_NRA_TABLE_2: Object.freeze({
    id: 'IRS-P15T-2026-NRA-TABLE-2',
    title: 'Publication 15-T (2026), nonresident-alien withholding adjustment Table 2',
    url: 'https://www.irs.gov/pub/irs-pdf/p15t.pdf',
    pages: '5-6',
  }),
  P15_EXEMPT_W4: Object.freeze({
    id: 'IRS-P15-2026-W4-EXEMPTION',
    title: 'Publication 15 (2026), exemption from federal income tax withholding',
    url: 'https://www.irs.gov/publications/p15',
    section: '9',
  }),
  P15_SUPPLEMENTAL: Object.freeze({
    id: 'IRS-P15-2026-SUPPLEMENTAL-WAGES',
    title: 'Publication 15 (2026), supplemental wages: optional 22% and mandatory 37%',
    url: 'https://www.irs.gov/publications/p15',
    section: '7',
  }),
  P15_FICA: Object.freeze({
    id: 'IRS-P15-2026-FICA',
    title: 'Publication 15 (2026), Social Security, Medicare, and Additional Medicare Tax',
    url: 'https://www.irs.gov/publications/p15',
    section: '9',
  }),
  P15_FUTA: Object.freeze({
    id: 'IRS-P15-2026-FUTA',
    title: 'Publication 15 (2026), Federal Unemployment (FUTA) Tax',
    url: 'https://www.irs.gov/publications/p15',
    section: '14',
  }),
  I941_2026: Object.freeze({
    id: 'IRS-I941-2026',
    title: 'Instructions for Form 941 (03/2026)',
    url: 'https://www.irs.gov/instructions/i941',
  }),
});

const PAY_PERIODS = Object.freeze({
  annual: 1,
  semiannual: 2,
  quarterly: 4,
  monthly: 12,
  semimonthly: 24,
  biweekly: 26,
  weekly: 52,
  daily: 260,
});

const NRA_TABLE_2 = Object.freeze({
  annual: '16100.00',
  semiannual: '8050.00',
  quarterly: '4025.00',
  monthly: '1341.70',
  semimonthly: '670.80',
  biweekly: '619.20',
  weekly: '309.60',
  daily: '61.90',
});

const STATES_AND_DC = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI',
  'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN',
  'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH',
  'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA',
  'WV', 'WI', 'WY',
]);

const STANDARD_SCHEDULES = Object.freeze({
  married_filing_jointly: Object.freeze([
    ['0.00', '19300.00', '0.00', 0],
    ['19300.00', '44100.00', '0.00', 1000],
    ['44100.00', '120100.00', '2480.00', 1200],
    ['120100.00', '230700.00', '11600.00', 2200],
    ['230700.00', '422850.00', '35932.00', 2400],
    ['422850.00', '531750.00', '82048.00', 3200],
    ['531750.00', '788000.00', '116896.00', 3500],
    ['788000.00', null, '206583.50', 3700],
  ]),
  single_or_married_filing_separately: Object.freeze([
    ['0.00', '7500.00', '0.00', 0],
    ['7500.00', '19900.00', '0.00', 1000],
    ['19900.00', '57900.00', '1240.00', 1200],
    ['57900.00', '113200.00', '5800.00', 2200],
    ['113200.00', '209275.00', '17966.00', 2400],
    ['209275.00', '263725.00', '41024.00', 3200],
    ['263725.00', '648100.00', '58448.00', 3500],
    ['648100.00', null, '192979.25', 3700],
  ]),
  head_of_household: Object.freeze([
    ['0.00', '15550.00', '0.00', 0],
    ['15550.00', '33250.00', '0.00', 1000],
    ['33250.00', '83000.00', '1770.00', 1200],
    ['83000.00', '121250.00', '7740.00', 2200],
    ['121250.00', '217300.00', '16155.00', 2400],
    ['217300.00', '271750.00', '39207.00', 3200],
    ['271750.00', '656150.00', '56631.00', 3500],
    ['656150.00', null, '191171.00', 3700],
  ]),
});

const MULTIPLE_JOBS_SCHEDULES = Object.freeze({
  married_filing_jointly: Object.freeze([
    ['0.00', '16100.00', '0.00', 0],
    ['16100.00', '28500.00', '0.00', 1000],
    ['28500.00', '66500.00', '1240.00', 1200],
    ['66500.00', '121800.00', '5800.00', 2200],
    ['121800.00', '217875.00', '17966.00', 2400],
    ['217875.00', '272325.00', '41024.00', 3200],
    ['272325.00', '400450.00', '58448.00', 3500],
    ['400450.00', null, '103291.75', 3700],
  ]),
  single_or_married_filing_separately: Object.freeze([
    ['0.00', '8050.00', '0.00', 0],
    ['8050.00', '14250.00', '0.00', 1000],
    ['14250.00', '33250.00', '620.00', 1200],
    ['33250.00', '60900.00', '2900.00', 2200],
    ['60900.00', '108938.00', '8983.00', 2400],
    ['108938.00', '136163.00', '20512.00', 3200],
    ['136163.00', '328350.00', '29224.00', 3500],
    ['328350.00', null, '96489.63', 3700],
  ]),
  head_of_household: Object.freeze([
    ['0.00', '12075.00', '0.00', 0],
    ['12075.00', '20925.00', '0.00', 1000],
    ['20925.00', '45800.00', '885.00', 1200],
    ['45800.00', '64925.00', '3870.00', 2200],
    ['64925.00', '112950.00', '8077.50', 2400],
    ['112950.00', '140175.00', '19603.50', 3200],
    ['140175.00', '332375.00', '28315.50', 3500],
    ['332375.00', null, '95585.50', 3700],
  ]),
});

function gcd(left, right) {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a || 1n;
}

class Rational {
  constructor(numerator, denominator = 1n) {
    if (denominator === 0n) throw new RangeError('Rational denominator cannot be zero');
    let n = BigInt(numerator);
    let d = BigInt(denominator);
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const divisor = gcd(n, d);
    this.numerator = n / divisor;
    this.denominator = d / divisor;
    Object.freeze(this);
  }

  add(other) {
    const right = other instanceof Rational ? other : new Rational(other);
    return new Rational(
      this.numerator * right.denominator + right.numerator * this.denominator,
      this.denominator * right.denominator
    );
  }

  subtract(other) {
    const right = other instanceof Rational ? other : new Rational(other);
    return new Rational(
      this.numerator * right.denominator - right.numerator * this.denominator,
      this.denominator * right.denominator
    );
  }

  multiply(numerator, denominator = 1n) {
    return new Rational(this.numerator * BigInt(numerator), this.denominator * BigInt(denominator));
  }

  divide(integer) {
    const divisor = BigInt(integer);
    if (divisor <= 0n) throw new RangeError('Rational divisor must be positive');
    return new Rational(this.numerator, this.denominator * divisor);
  }

  clampAtZero() {
    return this.numerator < 0n ? new Rational(0n) : this;
  }

  roundHalfUpToInteger() {
    if (this.numerator < 0n) throw new RangeError('Payroll liability cannot be negative');
    const quotient = this.numerator / this.denominator;
    const remainder = this.numerator % this.denominator;
    return remainder * 2n >= this.denominator ? quotient + 1n : quotient;
  }

  toFractionString() {
    return `${this.numerator}/${this.denominator}`;
  }
}

function adapterError(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    adapterError('US_FEDERAL_INVALID_INPUT', `${label} is required`);
  }
  return value;
}

function moneyToCents(value, label, { defaultValue } = {}) {
  const input = value === undefined || value === null || value === '' ? defaultValue : value;
  if (typeof input !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(input)) {
    adapterError(
      'US_FEDERAL_INVALID_MONEY',
      `${label} must be an unsigned USD decimal string with at most two decimal places`
    );
  }
  const [whole, fraction = ''] = input.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

function centsToFixed(cents) {
  return statutoryMoneyService.fromMinorUnits(cents, USD).toFixed();
}

function integerInput(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    adapterError('US_FEDERAL_INVALID_INPUT', `${label} must be a nonnegative integer`);
  }
  return value;
}

function strictDateOnly(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    adapterError('US_FEDERAL_INVALID_DATE', `${label} must use YYYY-MM-DD`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    adapterError('US_FEDERAL_INVALID_DATE', `${label} must be a real calendar date`);
  }
  return value;
}

function rationalMoney(rationalMinorUnits, stage) {
  const roundedCents = rationalMinorUnits.roundHalfUpToInteger();
  const decimal = new ExactDecimal(roundedCents, 2);
  return new StatutoryMoney(decimal, USD, [{
    stage,
    mode: 'half_up',
    unit: '0.01',
    input: `${rationalMinorUnits.toFractionString()} minor_units`,
    output: decimal.toFixed(2),
  }]);
}

function rateMoney(baseCents, rate, stage) {
  return statutoryMoneyService
    .fromMinorUnits(baseCents, USD)
    .multiplyByRate(rate)
    .roundToMinorUnit({ mode: 'half_up', stage });
}

function minimumBigInt(left, right) {
  return left < right ? left : right;
}

function normalizedW4(w4Input, nonresidentAlien) {
  const w4 = requireObject(w4Input, 'w4');
  if (w4.lockInLetter) {
    adapterError(
      'US_W4_LOCK_IN_NOT_IMPLEMENTED',
      'IRS lock-in letter instructions require a separately modelled withholding order'
    );
  }

  if (w4.version === '2020_or_later') {
    const filingStatus = String(w4.filingStatus || '');
    if (!STANDARD_SCHEDULES[filingStatus]) {
      adapterError('US_W4_INVALID_FILING_STATUS', 'A supported 2020-or-later Form W-4 filing status is required');
    }
    const normalized = {
      sourceVersion: '2020_or_later',
      filingStatus,
      multipleJobs: w4.multipleJobs === true,
      creditsCents: moneyToCents(w4.credits, 'w4.credits', { defaultValue: '0.00' }),
      otherIncomeCents: moneyToCents(w4.otherIncome, 'w4.otherIncome', { defaultValue: '0.00' }),
      deductionsCents: moneyToCents(w4.deductions, 'w4.deductions', { defaultValue: '0.00' }),
      additionalWithholdingCents: moneyToCents(
        w4.additionalWithholding,
        'w4.additionalWithholding',
        { defaultValue: '0.00' }
      ),
      exempt: w4.exempt === true,
      bridge: null,
    };

    if (normalized.exempt) {
      if (w4.exemptTaxYear !== TAX_YEAR || w4.signed !== true) {
        adapterError(
          'US_W4_EXEMPT_CERTIFICATION_REQUIRED',
          'Exempt withholding requires a signed Form W-4 certification for tax year 2026'
        );
      }
      if (normalized.multipleJobs
        || normalized.creditsCents !== 0n
        || normalized.otherIncomeCents !== 0n
        || normalized.deductionsCents !== 0n
        || normalized.additionalWithholdingCents !== 0n) {
        adapterError(
          'US_W4_EXEMPT_FORM_INVALID',
          'An exempt Form W-4 cannot also contain Step 2, Step 3, or Step 4 entries'
        );
      }
    }
    return normalized;
  }

  if (w4.version === '2019_or_earlier') {
    if (w4.continuedInEffect !== true) {
      adapterError(
        'US_W4_BRIDGE_CONTINUITY_REQUIRED',
        'The computational bridge only applies to a valid pre-2020 Form W-4 that remains in effect'
      );
    }
    if (w4.exempt === true) {
      adapterError(
        'US_W4_OLD_EXEMPT_NOT_VALID',
        'A pre-2020 exemption election cannot be carried into tax year 2026'
      );
    }
    const maritalStatus = String(w4.maritalStatus || '');
    const filingStatus = maritalStatus === 'married'
      ? 'married_filing_jointly'
      : ['single', 'married_but_withhold_at_higher_single'].includes(maritalStatus)
        ? 'single_or_married_filing_separately'
        : '';
    if (!filingStatus) {
      adapterError('US_W4_INVALID_MARITAL_STATUS', 'A supported pre-2020 Form W-4 marital status is required');
    }
    const allowances = integerInput(w4.allowances, 'w4.allowances');
    const bridgeOtherIncomeCents = nonresidentAlien.applies
      ? moneyToCents('4300.00', 'NRA bridge adjustment')
      : moneyToCents(filingStatus === 'married_filing_jointly' ? '12900.00' : '8600.00', 'Bridge adjustment');
    return {
      sourceVersion: '2019_or_earlier',
      filingStatus,
      multipleJobs: false,
      creditsCents: 0n,
      otherIncomeCents: bridgeOtherIncomeCents,
      deductionsCents: BigInt(allowances) * moneyToCents('4300.00', 'Allowance value'),
      additionalWithholdingCents: moneyToCents(
        w4.additionalWithholding,
        'w4.additionalWithholding',
        { defaultValue: '0.00' }
      ),
      exempt: false,
      bridge: {
        maritalStatus,
        allowances,
        step4aOtherIncome: centsToFixed(bridgeOtherIncomeCents),
        step4bDeductions: centsToFixed(BigInt(allowances) * 430000n),
        ruleId: OFFICIAL_RULES.P15T_COMPUTATIONAL_BRIDGE.id,
      },
    };
  }

  adapterError('US_W4_VERSION_UNSUPPORTED', 'w4.version must be 2020_or_later or 2019_or_earlier');
}

function normalizeNra(input = {}) {
  const nra = input && typeof input === 'object' ? input : {};
  if (nra.indiaStudentOrBusinessApprentice === true && nra.indiaExceptionCertified !== true) {
    adapterError(
      'US_NRA_INDIA_EXCEPTION_CERTIFICATION_REQUIRED',
      'The India student/business-apprentice exception requires a certified eligibility determination'
    );
  }
  return {
    applies: nra.applies === true,
    indiaStudentOrBusinessApprentice: nra.indiaStudentOrBusinessApprentice === true,
    dependentCreditEligibilityCertified: nra.dependentCreditEligibilityCertified === true,
  };
}

function scheduleRow(filingStatus, multipleJobs, adjustedAnnualWagesCents) {
  const schedules = multipleJobs ? MULTIPLE_JOBS_SCHEDULES : STANDARD_SCHEDULES;
  const rows = schedules[filingStatus];
  const row = rows.find(([minimum, maximum]) => {
    const lower = moneyToCents(minimum, 'Schedule minimum');
    const upper = maximum === null ? null : moneyToCents(maximum, 'Schedule maximum');
    return adjustedAnnualWagesCents >= lower && (upper === null || adjustedAnnualWagesCents < upper);
  });
  if (!row) adapterError('US_FIT_TABLE_ROW_NOT_FOUND', 'No 2026 percentage-method row matched the adjusted annual wages');
  return {
    minimumCents: moneyToCents(row[0], 'Schedule minimum'),
    maximumCents: row[1] === null ? null : moneyToCents(row[1], 'Schedule maximum'),
    baseTaxCents: moneyToCents(row[2], 'Schedule base tax'),
    rateBasisPoints: BigInt(row[3]),
  };
}

function calculateRegularFit({ regularTaxableWagesCents, payFrequency, w4, nonresidentAlien }) {
  const periods = PAY_PERIODS[payFrequency];
  let nraAdjustmentCents = 0n;
  if (nonresidentAlien.applies && !nonresidentAlien.indiaStudentOrBusinessApprentice) {
    nraAdjustmentCents = moneyToCents(NRA_TABLE_2[payFrequency], 'NRA Table 2 adjustment');
  }

  if (nonresidentAlien.applies) {
    if (w4.exempt) {
      adapterError('US_NRA_EXEMPT_NOT_ALLOWED', 'A nonresident alien cannot claim exemption on Form W-4');
    }
    if (w4.filingStatus !== 'single_or_married_filing_separately') {
      adapterError('US_NRA_SINGLE_STATUS_REQUIRED', 'A nonresident alien must request withholding as single');
    }
    if (w4.creditsCents > 0n && !nonresidentAlien.dependentCreditEligibilityCertified) {
      adapterError(
        'US_NRA_CREDIT_ELIGIBILITY_REQUIRED',
        'A nonresident alien Step 3 credit requires certified treaty/statutory eligibility'
      );
    }
  }

  const line1aCents = regularTaxableWagesCents + nraAdjustmentCents;
  if (regularTaxableWagesCents === 0n || w4.exempt) {
    return {
      amount: statutoryMoneyService.fromMinorUnits(0n, USD),
      actualTaxableWagesCents: regularTaxableWagesCents,
      nraAdjustmentCents,
      adjustedAnnualWagesCents: 0n,
      worksheet: {
        method: 'IRS Publication 15-T Worksheet 1A automated percentage method',
        exempt: w4.exempt,
        line1aActualTaxableWages: centsToFixed(regularTaxableWagesCents),
        line1aNraAdjustment: centsToFixed(nraAdjustmentCents),
        line1aWithNraAdjustment: centsToFixed(line1aCents),
        line1bPayPeriods: periods,
      },
    };
  }

  const line1cCents = line1aCents * BigInt(periods);
  const line1gCents = w4.multipleJobs
    ? 0n
    : moneyToCents(w4.filingStatus === 'married_filing_jointly' ? '12900.00' : '8600.00', 'Worksheet 1A line 1g');
  const totalDeductionsCents = w4.deductionsCents + line1gCents;
  const adjustedAnnualWagesCents = line1cCents + w4.otherIncomeCents > totalDeductionsCents
    ? line1cCents + w4.otherIncomeCents - totalDeductionsCents
    : 0n;
  const row = scheduleRow(w4.filingStatus, w4.multipleJobs, adjustedAnnualWagesCents);
  const excessCents = adjustedAnnualWagesCents - row.minimumCents;
  const annualTentativeCents = new Rational(row.baseTaxCents)
    .add(new Rational(excessCents).multiply(row.rateBasisPoints, 10000n));
  const annualAfterCreditsCents = annualTentativeCents
    .subtract(new Rational(w4.creditsCents))
    .clampAtZero();
  const perPeriodBeforeAdditionalCents = annualAfterCreditsCents.divide(periods);
  const finalPerPeriodCents = perPeriodBeforeAdditionalCents.add(w4.additionalWithholdingCents);
  const amount = rationalMoney(finalPerPeriodCents, 'us.fit.regular.final_per_period');

  return {
    amount,
    actualTaxableWagesCents: regularTaxableWagesCents,
    nraAdjustmentCents,
    adjustedAnnualWagesCents,
    worksheet: {
      method: 'IRS Publication 15-T Worksheet 1A automated percentage method',
      ruleId: OFFICIAL_RULES.P15T_WORKSHEET_1A.id,
      line1aActualTaxableWages: centsToFixed(regularTaxableWagesCents),
      line1aNraAdjustment: centsToFixed(nraAdjustmentCents),
      line1aWithNraAdjustment: centsToFixed(line1aCents),
      line1bPayPeriods: periods,
      line1cAnnualizedWages: centsToFixed(line1cCents),
      line1dOtherIncome: centsToFixed(w4.otherIncomeCents),
      line1fDeductions: centsToFixed(w4.deductionsCents),
      line1gStandardAdjustment: centsToFixed(line1gCents),
      line1iAdjustedAnnualWages: centsToFixed(adjustedAnnualWagesCents),
      tableSchedule: w4.multipleJobs ? 'step_2_checkbox' : 'standard',
      tableRow: {
        minimum: centsToFixed(row.minimumCents),
        maximum: row.maximumCents === null ? null : centsToFixed(row.maximumCents),
        baseTax: centsToFixed(row.baseTaxCents),
        rate: (Number(row.rateBasisPoints) / 10000).toFixed(4),
      },
      annualTentativeTaxFractionMinorUnits: annualTentativeCents.toFractionString(),
      line3AnnualCredits: centsToFixed(w4.creditsCents),
      line4cAdditionalWithholding: centsToFixed(w4.additionalWithholdingCents),
      finalPerPeriodWithholding: amount.toFixed(),
    },
  };
}

function calculateSupplemental(input, ytdSupplementalWagesCents) {
  const supplemental = input && typeof input === 'object' ? input : {};
  const taxableWagesCents = moneyToCents(
    supplemental.taxableWages,
    'supplemental.taxableWages',
    { defaultValue: '0.00' }
  );
  if (taxableWagesCents === 0n) {
    return {
      amount: statutoryMoneyService.fromMinorUnits(0n, USD),
      taxableWagesCents,
      optional22BaseCents: 0n,
      mandatory37BaseCents: 0n,
    };
  }
  if (supplemental.method !== 'optional_flat') {
    adapterError(
      'US_SUPPLEMENTAL_AGGREGATE_NOT_IMPLEMENTED',
      'Only separately identified supplemental wages using the optional flat method are implemented in Wave 1'
    );
  }

  const thresholdCents = moneyToCents('1000000.00', 'Supplemental wage threshold');
  const remainingBelowThreshold = ytdSupplementalWagesCents < thresholdCents
    ? thresholdCents - ytdSupplementalWagesCents
    : 0n;
  const optional22BaseCents = minimumBigInt(taxableWagesCents, remainingBelowThreshold);
  const mandatory37BaseCents = taxableWagesCents - optional22BaseCents;
  if (optional22BaseCents > 0n && supplemental.regularIncomeTaxWithheldInCurrentOrPriorYear !== true) {
    adapterError(
      'US_SUPPLEMENTAL_FLAT_NOT_ELIGIBLE',
      'The optional 22% method requires federal income tax withheld from regular wages in the current or prior year'
    );
  }

  const optionalAmount = rateMoney(optional22BaseCents, '0.22', 'us.fit.supplemental.optional_22.final');
  const mandatoryAmount = rateMoney(mandatory37BaseCents, '0.37', 'us.fit.supplemental.mandatory_37.final');
  const combinedAmount = optionalAmount.add(mandatoryAmount);
  const amount = new StatutoryMoney(combinedAmount.decimal, USD, [
    ...optionalAmount.roundingHistory,
    ...mandatoryAmount.roundingHistory,
  ]);
  return {
    amount,
    taxableWagesCents,
    optional22BaseCents,
    mandatory37BaseCents,
    components: {
      optional22Amount: optionalAmount.toFixed(),
      mandatory37Amount: mandatoryAmount.toFixed(),
      ytdSupplementalWagesAllCommonControl: centsToFixed(ytdSupplementalWagesCents),
    },
  };
}

function calculateFica(ficaTaxableWagesCents, ytd) {
  const socialSecurityWageBaseCents = moneyToCents('184500.00', 'Social Security wage base');
  const additionalMedicareThresholdCents = moneyToCents('200000.00', 'Additional Medicare threshold');
  const remainingSocialSecurityBase = ytd.socialSecurityWagesCents < socialSecurityWageBaseCents
    ? socialSecurityWageBaseCents - ytd.socialSecurityWagesCents
    : 0n;
  const socialSecurityTaxableCents = minimumBigInt(ficaTaxableWagesCents, remainingSocialSecurityBase);
  const beforeAdditional = ytd.medicareWagesCents > additionalMedicareThresholdCents
    ? ytd.medicareWagesCents - additionalMedicareThresholdCents
    : 0n;
  const afterAdditional = ytd.medicareWagesCents + ficaTaxableWagesCents > additionalMedicareThresholdCents
    ? ytd.medicareWagesCents + ficaTaxableWagesCents - additionalMedicareThresholdCents
    : 0n;
  const additionalMedicareTaxableCents = afterAdditional - beforeAdditional;

  return {
    socialSecurityTaxableCents,
    medicareTaxableCents: ficaTaxableWagesCents,
    additionalMedicareTaxableCents,
    employeeSocialSecurity: rateMoney(socialSecurityTaxableCents, '0.062', 'us.fica.social_security.employee.per_payment'),
    employerSocialSecurity: rateMoney(socialSecurityTaxableCents, '0.062', 'us.fica.social_security.employer.per_payment'),
    employeeMedicare: rateMoney(ficaTaxableWagesCents, '0.0145', 'us.fica.medicare.employee.per_payment'),
    employerMedicare: rateMoney(ficaTaxableWagesCents, '0.0145', 'us.fica.medicare.employer.per_payment'),
    employeeAdditionalMedicare: rateMoney(
      additionalMedicareTaxableCents,
      '0.009',
      'us.fica.additional_medicare.employee.per_payment'
    ),
  };
}

function futaEligibility(input) {
  const futa = requireObject(input, 'employerFuta');
  const category = String(futa.category || '');
  const dollars = (field) => moneyToCents(futa[field], `employerFuta.${field}`, { defaultValue: '0.00' });
  const weeks = (field) => integerInput(futa[field] ?? 0, `employerFuta.${field}`);

  if (category === 'general') {
    const wageTest = dollars('maxQuarterlyWages2025') >= 150000n
      || dollars('maxQuarterlyWages2026') >= 150000n;
    const employeeTest = weeks('weeksWithEmployee2025') >= 20 || weeks('weeksWithEmployee2026') >= 20;
    return { category, subject: wageTest || employeeTest, tests: { wageTest, employeeTest } };
  }
  if (category === 'household') {
    const householdCashWageTest = dollars('maxQuarterlyCashWages2025') >= 100000n
      || dollars('maxQuarterlyCashWages2026') >= 100000n;
    return { category, subject: householdCashWageTest, tests: { householdCashWageTest } };
  }
  if (category === 'farm') {
    const farmCashWageTest = dollars('maxQuarterlyCashWages2025') >= 2000000n
      || dollars('maxQuarterlyCashWages2026') >= 2000000n;
    const farmworkerTest = weeks('weeksWithTenFarmworkers2025') >= 20
      || weeks('weeksWithTenFarmworkers2026') >= 20;
    return { category, subject: farmCashWageTest || farmworkerTest, tests: { farmCashWageTest, farmworkerTest } };
  }
  adapterError(
    'US_FUTA_CATEGORY_NOT_IMPLEMENTED',
    'FUTA Wave 1 supports only the Pub. 15 general, household, and farmworker eligibility tests'
  );
}

function blockingReason(code, message, layer) {
  return Object.freeze({ code, message, layer });
}

function certificationProblem(companion, { kind, jurisdictionCode, payDate, allowNotApplicable = false }) {
  if (!companion || typeof companion !== 'object') return 'missing';
  if (companion.kind !== kind) return `kind must be ${kind}`;
  if (companion.jurisdictionCode !== jurisdictionCode) return `jurisdiction must be ${jurisdictionCode}`;
  if (companion.certificationStatus !== 'certified') return 'certificationStatus must be certified';
  if (!String(companion.certificationId || '').trim() || !String(companion.versionId || '').trim()) {
    return 'certificationId and versionId are required';
  }
  if (!allowNotApplicable && companion.applicability === 'certified_not_applicable') {
    return 'a not-applicable determination is not valid for this layer';
  }
  if (allowNotApplicable
    && !['applicable', 'certified_not_applicable'].includes(companion.applicability)) {
    return 'applicability must be applicable or certified_not_applicable';
  }
  try {
    const from = strictDateOnly(companion.effectiveFrom, 'Companion effectiveFrom');
    const to = strictDateOnly(companion.effectiveTo, 'Companion effectiveTo');
    if (from > payDate || to < payDate) return `certification does not cover ${payDate}`;
  } catch (error) {
    return error.message;
  }
  return '';
}

function subnationalGate(workLocationInput, companionsInput, payDate) {
  const workLocation = requireObject(workLocationInput, 'workLocation');
  if (workLocation.countryCode !== 'US') {
    adapterError('US_WORK_LOCATION_COUNTRY_INVALID', 'The U.S. federal adapter only accepts countryCode US');
  }
  const subdivisionCode = String(workLocation.subdivisionCode || '').toUpperCase();
  const stateCode = subdivisionCode.startsWith('US-') ? subdivisionCode.slice(3) : '';
  if (!STATES_AND_DC.has(stateCode)) {
    adapterError(
      'US_STATE_OR_DC_WORK_LOCATION_REQUIRED',
      'A 50-state or District of Columbia work-location subdivisionCode is required; territories are out of scope'
    );
  }
  const localityCode = String(workLocation.localityCode || '').toUpperCase();
  const companions = companionsInput && typeof companionsInput === 'object' ? companionsInput : {};
  const blockers = [];

  const stateProblem = certificationProblem(companions.stateWithholding, {
    kind: 'state_withholding', jurisdictionCode: subdivisionCode, payDate, allowNotApplicable: true,
  });
  if (stateProblem) {
    blockers.push(blockingReason(
      'US_STATE_WITHHOLDING_ADAPTER_REQUIRED',
      `Certified ${subdivisionCode} withholding adapter required: ${stateProblem}`,
      'state_withholding'
    ));
  }

  if (!localityCode) {
    blockers.push(blockingReason(
      'US_LOCALITY_RESOLUTION_REQUIRED',
      'An exact localityCode is required before local withholding applicability can be certified',
      'local_withholding'
    ));
  } else {
    const localProblem = certificationProblem(companions.localWithholding, {
      kind: 'local_withholding', jurisdictionCode: localityCode, payDate, allowNotApplicable: true,
    });
    if (localProblem) {
      blockers.push(blockingReason(
        'US_LOCAL_WITHHOLDING_ADAPTER_REQUIRED',
        `Certified ${localityCode} withholding adapter or no-tax determination required: ${localProblem}`,
        'local_withholding'
      ));
    }
  }

  const sutaProblem = certificationProblem(companions.stateUnemployment, {
    kind: 'state_unemployment', jurisdictionCode: subdivisionCode, payDate,
  });
  if (sutaProblem) {
    blockers.push(blockingReason(
      'US_SUTA_ADAPTER_REQUIRED',
      `Certified ${subdivisionCode} state unemployment adapter required: ${sutaProblem}`,
      'state_unemployment'
    ));
  }

  return { workLocation: { countryCode: 'US', subdivisionCode, localityCode }, companions, blockers };
}

function calculateFuta(futaTaxableWagesCents, ytdFutaWagesCents, eligibility, gate) {
  const wageBaseCents = moneyToCents('7000.00', 'FUTA wage base');
  const remainingBaseCents = eligibility.subject && ytdFutaWagesCents < wageBaseCents
    ? wageBaseCents - ytdFutaWagesCents
    : 0n;
  const taxableBaseCents = minimumBigInt(futaTaxableWagesCents, remainingBaseCents);
  const grossAmount = rateMoney(taxableBaseCents, '0.06', 'us.futa.gross_per_payment');
  const suta = gate.companions.stateUnemployment;
  const hasCertifiedSuta = !certificationProblem(suta, {
    kind: 'state_unemployment',
    jurisdictionCode: gate.workLocation.subdivisionCode,
    payDate: gate.payDate,
  });

  if (!hasCertifiedSuta || taxableBaseCents === 0n) {
    return {
      eligibility,
      taxableBaseCents,
      grossAmount,
      creditRate: null,
      creditAmount: null,
      netAmount: taxableBaseCents === 0n ? statutoryMoneyService.fromMinorUnits(0n, USD) : null,
    };
  }

  const creditRateInput = suta.futaCreditRate;
  if (typeof creditRateInput !== 'string') {
    gate.blockers.push(blockingReason(
      'US_FUTA_CREDIT_DETERMINATION_REQUIRED',
      'The certified SUTA adapter must provide the effective Form 940 credit rate; 5.4% is not assumed',
      'state_unemployment'
    ));
    return {
      eligibility,
      taxableBaseCents,
      grossAmount,
      creditRate: null,
      creditAmount: null,
      netAmount: null,
    };
  }
  let creditRate;
  try {
    creditRate = ExactDecimal.from(creditRateInput, 'FUTA credit rate');
  } catch (error) {
    adapterError('US_FUTA_CREDIT_RATE_INVALID', error.message);
  }
  if (creditRate.compare('0') < 0 || creditRate.compare('0.054') > 0) {
    adapterError('US_FUTA_CREDIT_RATE_INVALID', 'FUTA credit rate must be between 0 and 0.054');
  }
  const effectiveRate = ExactDecimal.from('0.06').subtract(creditRate).toString();
  return {
    eligibility,
    taxableBaseCents,
    grossAmount,
    creditRate: creditRate.toString(),
    creditAmount: rateMoney(taxableBaseCents, creditRate.toString(), 'us.futa.certified_state_credit'),
    netAmount: rateMoney(taxableBaseCents, effectiveRate, 'us.futa.net_after_certified_state_credit'),
    effectiveRate,
  };
}

function quarterMetadata(payDate) {
  const month = Number(payDate.slice(5, 7));
  if (month <= 3) {
    return { quarter: 1, start: '2026-01-01', end: '2026-03-31', form941Due: '2026-04-30', futaDepositDue: '2026-04-30' };
  }
  if (month <= 6) {
    return { quarter: 2, start: '2026-04-01', end: '2026-06-30', form941Due: '2026-07-31', futaDepositDue: '2026-07-31' };
  }
  if (month <= 9) {
    return { quarter: 3, start: '2026-07-01', end: '2026-09-30', form941Due: '2026-11-02', futaDepositDue: '2026-11-02' };
  }
  return { quarter: 4, start: '2026-10-01', end: '2026-12-31', form941Due: '2027-02-01', futaDepositDue: '2027-02-01' };
}

function liabilityEntry({ code, name, payer, amount, baseCents, rate, method, stage, form, quarter, sourceRule, metadata = {} }) {
  const remittance = form === 'FORM_941'
    ? {
      formCode: 'FORM_941', frequency: 'quarterly', periodStart: quarter.start,
      periodEnd: quarter.end, dueDate: quarter.form941Due, paymentChannel: 'EFT', accountReferenceField: 'EIN',
    }
    : {
      formCode: 'FORM_940', frequency: 'annual', periodStart: EFFECTIVE_FROM,
      periodEnd: EFFECTIVE_TO, dueDate: '2027-02-01', paymentChannel: 'EFT', accountReferenceField: 'EIN',
    };
  return statutoryLiabilityLedgerService.createEntry({
    liabilityCode: code,
    name,
    payer,
    amount,
    baseAmount: statutoryMoneyService.fromMinorUnits(baseCents, USD),
    rate,
    authority: { code: 'IRS', name: 'Internal Revenue Service', level: 'federal', jurisdictionCode: 'US' },
    remittance,
    calculation: { method, roundingStage: stage },
    sourceReferences: [
      sourceRule.id,
      sourceRule.url,
      ...(form === 'FORM_941' ? [OFFICIAL_RULES.I941_2026.id, OFFICIAL_RULES.I941_2026.url] : []),
    ],
    sourceEffectiveFrom: EFFECTIVE_FROM,
    evidenceReference: sourceRule.id,
    metadata: {
      adapterId: 'US-FEDERAL-2026-WAVE1',
      releaseStatus: 'preview_only',
      form941DepositScheduleMustBeResolvedFromEmployerLookback: form === 'FORM_941',
      futaQuarterlyDepositDue: form === 'FORM_940' ? quarter.futaDepositDue : undefined,
      ...metadata,
    },
  }, USD);
}

function calculate(payload = {}) {
  if (payload.taxYear !== TAX_YEAR) {
    adapterError('US_FEDERAL_TAX_YEAR_UNSUPPORTED', 'This adapter is effective only for tax year 2026');
  }
  const payDate = strictDateOnly(payload.payDate, 'payDate');
  if (payDate < EFFECTIVE_FROM || payDate > EFFECTIVE_TO) {
    adapterError('US_FEDERAL_PAY_DATE_OUT_OF_RANGE', 'payDate must fall within calendar year 2026');
  }
  const payFrequency = String(payload.payFrequency || '');
  if (!PAY_PERIODS[payFrequency]) {
    adapterError('US_FEDERAL_PAY_FREQUENCY_UNSUPPORTED', `Unsupported payFrequency "${payFrequency}"`);
  }
  if (payFrequency === 'daily' && payload.daysInPayrollPeriod !== 1) {
    adapterError(
      'US_DAILY_MULTI_DAY_NOT_IMPLEMENTED',
      'Daily or miscellaneous payments covering more than one day require an explicit days-worked implementation'
    );
  }

  const regularTaxableWagesCents = moneyToCents(payload.regularTaxableWages, 'regularTaxableWages');
  const ficaTaxableWagesCents = moneyToCents(payload.ficaTaxableWages, 'ficaTaxableWages');
  const futaTaxableWagesCents = moneyToCents(payload.futaTaxableWages, 'futaTaxableWages');
  const ytdInput = requireObject(payload.ytd, 'ytd');
  const ytd = {
    socialSecurityWagesCents: moneyToCents(ytdInput.socialSecurityWages, 'ytd.socialSecurityWages'),
    medicareWagesCents: moneyToCents(ytdInput.medicareWages, 'ytd.medicareWages'),
    futaWagesCents: moneyToCents(ytdInput.futaWages, 'ytd.futaWages'),
    supplementalWagesCommonControlCents: moneyToCents(
      ytdInput.supplementalWagesCommonControl,
      'ytd.supplementalWagesCommonControl'
    ),
  };
  const nonresidentAlien = normalizeNra(payload.nonresidentAlien);
  const w4 = normalizedW4(payload.w4, nonresidentAlien);
  const regularFit = calculateRegularFit({ regularTaxableWagesCents, payFrequency, w4, nonresidentAlien });
  const supplementalFit = calculateSupplemental(payload.supplemental, ytd.supplementalWagesCommonControlCents);
  const fica = calculateFica(ficaTaxableWagesCents, ytd);
  const eligibility = futaEligibility(payload.employerFuta);
  const gate = subnationalGate(payload.workLocation, payload.companionAdapters, payDate);
  gate.payDate = payDate;
  const futa = calculateFuta(futaTaxableWagesCents, ytd.futaWagesCents, eligibility, gate);
  const quarter = quarterMetadata(payDate);

  const entries = [
    liabilityEntry({
      code: 'US_FIT_REGULAR_EMPLOYEE', name: 'Federal income tax withholding - regular wages', payer: 'employee',
      amount: regularFit.amount, baseCents: regularTaxableWagesCents, rate: '',
      method: 'pub15t_worksheet_1a_automated_percentage', stage: 'us.fit.regular.final_per_period',
      form: 'FORM_941', quarter, sourceRule: w4.exempt ? OFFICIAL_RULES.P15_EXEMPT_W4 : OFFICIAL_RULES.P15T_WORKSHEET_1A,
      metadata: { exempt: w4.exempt, w4SourceVersion: w4.sourceVersion, bridge: w4.bridge },
    }),
    liabilityEntry({
      code: 'US_SOCIAL_SECURITY_EMPLOYEE', name: 'Social Security tax - employee', payer: 'employee',
      amount: fica.employeeSocialSecurity, baseCents: fica.socialSecurityTaxableCents, rate: '0.062',
      method: 'covered_wages_times_rate_subject_to_annual_base', stage: 'us.fica.social_security.employee.per_payment',
      form: 'FORM_941', quarter, sourceRule: OFFICIAL_RULES.P15_FICA,
      metadata: { annualWageBase: '184500.00', ytdBaseExcludesCurrentPayment: true },
    }),
    liabilityEntry({
      code: 'US_MEDICARE_EMPLOYEE', name: 'Medicare tax - employee', payer: 'employee',
      amount: fica.employeeMedicare, baseCents: fica.medicareTaxableCents, rate: '0.0145',
      method: 'covered_wages_times_rate', stage: 'us.fica.medicare.employee.per_payment',
      form: 'FORM_941', quarter, sourceRule: OFFICIAL_RULES.P15_FICA,
    }),
    liabilityEntry({
      code: 'US_SOCIAL_SECURITY_EMPLOYER', name: 'Social Security tax - employer', payer: 'employer',
      amount: fica.employerSocialSecurity, baseCents: fica.socialSecurityTaxableCents, rate: '0.062',
      method: 'covered_wages_times_rate_subject_to_annual_base', stage: 'us.fica.social_security.employer.per_payment',
      form: 'FORM_941', quarter, sourceRule: OFFICIAL_RULES.P15_FICA,
      metadata: { annualWageBase: '184500.00', ytdBaseExcludesCurrentPayment: true },
    }),
    liabilityEntry({
      code: 'US_MEDICARE_EMPLOYER', name: 'Medicare tax - employer', payer: 'employer',
      amount: fica.employerMedicare, baseCents: fica.medicareTaxableCents, rate: '0.0145',
      method: 'covered_wages_times_rate', stage: 'us.fica.medicare.employer.per_payment',
      form: 'FORM_941', quarter, sourceRule: OFFICIAL_RULES.P15_FICA,
    }),
  ];

  if (supplementalFit.taxableWagesCents > 0n) {
    entries.push(liabilityEntry({
      code: 'US_FIT_SUPPLEMENTAL_EMPLOYEE', name: 'Federal income tax withholding - supplemental wages', payer: 'employee',
      amount: supplementalFit.amount, baseCents: supplementalFit.taxableWagesCents, rate: '',
      method: 'separately_identified_optional_and_mandatory_flat_rates', stage: 'us.fit.supplemental.final',
      form: 'FORM_941', quarter, sourceRule: OFFICIAL_RULES.P15_SUPPLEMENTAL,
      metadata: {
        optional22Base: centsToFixed(supplementalFit.optional22BaseCents),
        mandatory37Base: centsToFixed(supplementalFit.mandatory37BaseCents),
      },
    }));
  }

  if (fica.additionalMedicareTaxableCents > 0n) {
    entries.push(liabilityEntry({
      code: 'US_ADDITIONAL_MEDICARE_EMPLOYEE', name: 'Additional Medicare Tax - employee', payer: 'employee',
      amount: fica.employeeAdditionalMedicare, baseCents: fica.additionalMedicareTaxableCents, rate: '0.009',
      method: 'covered_wages_over_employer_annual_threshold', stage: 'us.fica.additional_medicare.employee.per_payment',
      form: 'FORM_941', quarter, sourceRule: OFFICIAL_RULES.P15_FICA,
      metadata: { employerWithholdingThreshold: '200000.00', employerShare: false },
    }));
  }

  const futaLedgerAmount = futa.netAmount || futa.grossAmount;
  entries.push(liabilityEntry({
    code: futa.netAmount ? 'US_FUTA_EMPLOYER' : 'US_FUTA_GROSS_PRE_CREDIT_EMPLOYER',
    name: futa.netAmount ? 'Federal unemployment tax - employer' : 'Federal unemployment tax gross before state credit',
    payer: 'employer', amount: futaLedgerAmount, baseCents: futa.taxableBaseCents,
    rate: futa.effectiveRate || '0.06', method: futa.netAmount
      ? 'futa_wage_base_times_rate_after_certified_state_credit'
      : 'futa_wage_base_times_gross_rate_credit_not_applied',
    stage: futa.netAmount ? 'us.futa.net_after_certified_state_credit' : 'us.futa.gross_per_payment',
    form: 'FORM_940', quarter, sourceRule: OFFICIAL_RULES.P15_FUTA,
    metadata: {
      annualWageBase: '7000.00',
      grossRate: '0.06',
      grossAmount: futa.grossAmount.toFixed(),
      certifiedStateCreditRate: futa.creditRate,
      certifiedStateCreditAmount: futa.creditAmount ? futa.creditAmount.toFixed() : null,
      eligibility,
      ytdBaseExcludesCurrentPayment: true,
      quarterlyDepositOnlyWhenUndepositedLiabilityExceeds500: true,
    },
  }));

  const ledger = statutoryLiabilityLedgerService.buildLedger(entries);
  const blocked = gate.blockers.length > 0;
  return Object.freeze({
    adapter: Object.freeze({
      id: 'US-FEDERAL-2026-WAVE1',
      countryCode: 'US',
      scope: 'federal_only',
      taxYear: TAX_YEAR,
      effectiveFrom: EFFECTIVE_FROM,
      effectiveTo: EFFECTIVE_TO,
      releaseStatus: 'preview_only',
      nationwideRunnable: false,
      roundingPolicy: 'no_wage_rounding_exact_rational_calculation_final_cent_half_up',
    }),
    status: blocked ? 'blocked' : 'preview',
    runnable: false,
    postingAllowed: false,
    blockingReasons: Object.freeze([...gate.blockers]),
    workLocation: Object.freeze(gate.workLocation),
    calculation: Object.freeze({
      payDate,
      payFrequency,
      regularFederalIncomeTax: regularFit.amount.toFixed(),
      supplementalFederalIncomeTax: supplementalFit.amount.toFixed(),
      socialSecurityEmployee: fica.employeeSocialSecurity.toFixed(),
      socialSecurityEmployer: fica.employerSocialSecurity.toFixed(),
      medicareEmployee: fica.employeeMedicare.toFixed(),
      medicareEmployer: fica.employerMedicare.toFixed(),
      additionalMedicareEmployee: fica.employeeAdditionalMedicare.toFixed(),
      futaGrossEmployer: futa.grossAmount.toFixed(),
      futaNetEmployer: futa.netAmount ? futa.netAmount.toFixed() : null,
      regularFitWorksheet: regularFit.worksheet,
      supplemental: supplementalFit.components || null,
      futaEligibility: eligibility,
    }),
    filing: Object.freeze({
      form941Quarter: quarter.quarter,
      form941PeriodStart: quarter.start,
      form941PeriodEnd: quarter.end,
      form941DueDate: quarter.form941Due,
      form941DepositSchedule: 'employer_specific_lookback_and_next_day_rules_not_inferred',
      form940PeriodStart: EFFECTIVE_FROM,
      form940PeriodEnd: EFFECTIVE_TO,
      form940OrdinaryDueDate: '2027-02-01',
      futaQuarterlyDepositDueDate: quarter.futaDepositDue,
    }),
    liabilityLedger: ledger,
    officialRules: OFFICIAL_RULES,
  });
}

module.exports = Object.freeze({
  calculate,
  OFFICIAL_RULES,
  TAX_YEAR,
  EFFECTIVE_FROM,
  EFFECTIVE_TO,
});
