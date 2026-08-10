'use strict';

/**
 * Canada 2026 / Ontario payroll preview adapter.
 *
 * This module is deliberately standalone. It is not registered with
 * TaxJurisdictionService and its result is explicitly non-postable until the
 * source fixture and payroll/legal reviews have been certified.
 *
 * Supported calculation: CRA T4127 Option 1 for ordinary periodic salary or
 * wages, Ontario province of employment, the T4127 year-to-date CPP/EI credit
 * method, CPP/CPP2, and standard-rate EI. Inputs and outputs remain decimal
 * strings; JavaScript floating-point arithmetic is not used.
 */

const statutoryMoneyService = require('../StatutoryMoneyService');
const statutoryLiabilityLedgerService = require('../StatutoryLiabilityLedgerService');

const MONEY = Object.freeze({ currency: 'CAD', minorUnits: 2 });
const HALF_UP = 'half_up';

const SOURCE_VERSIONS = Object.freeze({
  JANUARY: 'CRA_T4127_122_2026-01-01',
  JULY: 'CRA_T4127_123_2026-07-01',
});

const OFFICIAL_SOURCES = Object.freeze({
  CRA_T4127_122_JAN_2026: Object.freeze({
    title: 'Payroll Deductions Formulas, 122nd Edition, effective January 1, 2026',
    url: 'https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4127-payroll-deductions-formulas/t4127-jan/t4127-jan-payroll-deductions-formulas-computer-programs.html',
    effectiveFrom: '2026-01-01',
  }),
  CRA_T4127_123_JUL_2026: Object.freeze({
    title: 'Payroll Deductions Formulas, 123rd Edition, effective July 1, 2026',
    url: 'https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4127-payroll-deductions-formulas/t4127-jul/t4127-jul-payroll-deductions-formulas.html',
    effectiveFrom: '2026-07-01',
  }),
  CRA_T4032_ON_JAN_2026: Object.freeze({
    title: 'T4032-ON Payroll Deductions Tables, January 2026',
    url: 'https://www.canada.ca/content/dam/cra-arc/migration/cra-arc/tx/bsnss/tpcs/pyrll/t4032/2026/t4032-on-1-26e.pdf',
    effectiveFrom: '2026-01-01',
  }),
  CRA_TD1_2026: Object.freeze({
    title: 'TD1 forms for 2026 for pay received on January 1, 2026 or later',
    url: 'https://www.canada.ca/en/revenue-agency/services/forms-publications/td1-personal-tax-credits-returns/td1-forms-pay-received-on-january-1-later.html',
    effectiveFrom: '2026-01-01',
  }),
  CRA_CPP_2026: Object.freeze({
    title: 'CPP contribution rates, maximums and exemptions',
    url: 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/canada-pension-plan-cpp/cpp-contribution-rates-maximums-exemptions.html',
    effectiveFrom: '2026-01-01',
  }),
  CRA_CPP2_2026: Object.freeze({
    title: 'Second additional CPP contribution rates, maximums and exemptions',
    url: 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/calculating-deductions/making-deductions/second-additional-cpp-contribution-rates-maximums.html',
    effectiveFrom: '2026-01-01',
  }),
  CRA_EI_2026: Object.freeze({
    title: 'EI premium rates and maximums',
    url: 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/employment-insurance-ei/ei-premium-rates-maximums.html',
    effectiveFrom: '2026-01-01',
  }),
  CRA_REMIT_DUE_DATES: Object.freeze({
    title: 'When to remit (pay) payroll deductions and contributions',
    url: 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/remitting-source-deductions/how-when-remit-due-dates.html',
    effectiveFrom: '2026-01-01',
  }),
  CRA_PAYROLL_CORRESPONDENCE: Object.freeze({
    title: 'Payroll correspondence you need to remit (pay)',
    url: 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/remitting-source-deductions/how-when-remit-overview.html',
    effectiveFrom: '2026-01-01',
  }),
});

const FEDERAL_BRACKETS = Object.freeze([
  Object.freeze({ threshold: '0.00', rate: '0.1400', constant: '0.00' }),
  Object.freeze({ threshold: '58523.00', rate: '0.2050', constant: '3804.00' }),
  Object.freeze({ threshold: '117045.00', rate: '0.2600', constant: '10241.00' }),
  Object.freeze({ threshold: '181440.00', rate: '0.2900', constant: '15685.00' }),
  Object.freeze({ threshold: '258482.00', rate: '0.3300', constant: '26024.00' }),
]);

const ONTARIO_BRACKETS = Object.freeze([
  Object.freeze({ threshold: '0.00', rate: '0.0505', constant: '0.00' }),
  Object.freeze({ threshold: '53891.00', rate: '0.0915', constant: '2210.00' }),
  Object.freeze({ threshold: '107785.00', rate: '0.1116', constant: '4376.00' }),
  Object.freeze({ threshold: '150000.00', rate: '0.1216', constant: '5876.00' }),
  Object.freeze({ threshold: '220000.00', rate: '0.1316', constant: '8076.00' }),
]);

const LIMITS = Object.freeze({
  ybe: '3500.00',
  ympe: '74600.00',
  yampe: '85000.00',
  cppRate: '0.0595',
  cppBaseRate: '0.0495',
  cppFirstAdditionalRate: '0.0100',
  cppMaximum: '4230.45',
  cppBaseMaximum: '3519.45',
  cpp2Rate: '0.0400',
  cpp2Maximum: '416.00',
  eiMaximumInsurableEarnings: '68900.00',
  eiEmployeeRate: '0.0163',
  eiEmployerRate: '0.02282',
  eiEmployerMultiplier: '1.4',
  eiEmployeeMaximum: '1123.07',
  eiEmployerMaximum: '1572.30',
  canadaEmploymentAmount: '1501.00',
  ontarioTaxReductionBase: '300.00',
  ontarioDependentReductionAmount: '554.00',
});

const PAY_FREQUENCIES = Object.freeze({
  monthly: Object.freeze([12]),
  semi_monthly: Object.freeze([24]),
  biweekly: Object.freeze([26, 27]),
  weekly: Object.freeze([52, 53]),
});

const TOP_LEVEL_KEYS = new Set([
  'payDate',
  'provinceOfEmployment',
  'formulaSourceVersion',
  'payFrequency',
  'payPeriodsPerYear',
  'payPeriodNumber',
  'payPeriod',
  'grossCashPay',
  'pensionableEarnings',
  'insurableEarnings',
  'benefits',
  'deductions',
  'nonPeriodicPayments',
  'employment',
  'td1',
  'ytd',
  'remitterProfile',
  'businessCalendar',
]);

class CanadaOntarioPayrollAdapterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CanadaOntarioPayrollAdapterError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new CanadaOntarioPayrollAdapterError(code, message);
}

function gcd(left, right) {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a || 1n;
}

class Fraction {
  constructor(numerator, denominator = 1n) {
    if (denominator === 0n) throw new RangeError('Fraction denominator cannot be zero');
    let n = BigInt(numerator);
    let d = BigInt(denominator);
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const divisor = gcd(n, d);
    this.n = n / divisor;
    this.d = d / divisor;
    Object.freeze(this);
  }

  static fromDecimal(value, label = 'Decimal value') {
    const text = String(value).trim();
    const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text);
    if (!match) fail('CANADA_INVALID_DECIMAL', `${label} must be a base-10 decimal string`);
    const scale = (match[3] || '').length;
    const denominator = 10n ** BigInt(scale);
    const coefficient = BigInt(`${match[2]}${match[3] || ''}`) * (match[1] === '-' ? -1n : 1n);
    return new Fraction(coefficient, denominator);
  }

  static fromCents(cents) {
    return new Fraction(cents, 100n);
  }

  add(other) {
    const value = toFraction(other);
    return new Fraction((this.n * value.d) + (value.n * this.d), this.d * value.d);
  }

  subtract(other) {
    const value = toFraction(other);
    return new Fraction((this.n * value.d) - (value.n * this.d), this.d * value.d);
  }

  multiply(other) {
    const value = toFraction(other);
    return new Fraction(this.n * value.n, this.d * value.d);
  }

  divide(other) {
    const value = toFraction(other);
    if (value.n === 0n) throw new RangeError('Cannot divide by zero');
    return new Fraction(this.n * value.d, this.d * value.n);
  }

  compare(other) {
    const value = toFraction(other);
    const difference = (this.n * value.d) - (value.n * this.d);
    return difference < 0n ? -1 : difference > 0n ? 1 : 0;
  }

  max(other) {
    const value = toFraction(other);
    return this.compare(value) >= 0 ? this : value;
  }

  min(other) {
    const value = toFraction(other);
    return this.compare(value) <= 0 ? this : value;
  }

  exactText() {
    return `${this.n}/${this.d}`;
  }
}

function toFraction(value) {
  if (value instanceof Fraction) return value;
  if (typeof value === 'bigint') return new Fraction(value);
  if (Number.isSafeInteger(value)) return new Fraction(BigInt(value));
  return Fraction.fromDecimal(value);
}

const ZERO = new Fraction(0n);

function maxZero(value) {
  const fraction = toFraction(value);
  return fraction.compare(ZERO) < 0 ? ZERO : fraction;
}

function roundHalfUpInteger(numerator, denominator) {
  if (denominator <= 0n) throw new RangeError('Rounding denominator must be positive');
  const sign = numerator < 0n ? -1n : 1n;
  const absolute = numerator < 0n ? -numerator : numerator;
  let quotient = absolute / denominator;
  const remainder = absolute % denominator;
  if ((remainder * 2n) >= denominator) quotient += 1n;
  return quotient * sign;
}

function roundFractionToCents(value) {
  const fraction = toFraction(value);
  return roundHalfUpInteger(fraction.n * 100n, fraction.d);
}

function centsText(cents) {
  const value = BigInt(cents);
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(3, '0');
  return `${negative ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

function roundedMoney(value, stage) {
  const expectedCents = roundFractionToCents(value);
  const money = statutoryMoneyService.create(centsText(expectedCents), MONEY).roundToMinorUnit({
    mode: HALF_UP,
    stage,
  });
  if (money.toMinorUnits() !== expectedCents) {
    throw new Error(`Internal statutory rounding invariant failed at ${stage}`);
  }
  return money;
}

function fixedMoneyFromCents(cents, stage) {
  return statutoryMoneyService.fromMinorUnits(cents, MONEY).roundToMinorUnit({ mode: HALF_UP, stage });
}

function serializeMoney(money) {
  return Object.freeze({ amount: money.toFixed(), currency: MONEY.currency, minorUnits: MONEY.minorUnits });
}

function moneyFraction(value, label) {
  if (typeof value !== 'string') fail('CANADA_INVALID_MONEY', `${label} must be supplied as an exact decimal string`);
  let money;
  try {
    money = statutoryMoneyService.create(value, MONEY);
    const cents = money.toMinorUnits();
    if (cents < 0n) fail('CANADA_NEGATIVE_AMOUNT', `${label} cannot be negative`);
    return Fraction.fromCents(cents);
  } catch (error) {
    if (error instanceof CanadaOntarioPayrollAdapterError) throw error;
    fail('CANADA_INVALID_MONEY', `${label} must be a non-negative CAD amount with no fractions of a cent`);
  }
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('CANADA_REQUIRED_EVIDENCE', `${label} must be an object`);
  }
}

function assertOnlyKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail('CANADA_UNSUPPORTED_INPUT', `${label}.${key} is outside this preview adapter`);
  }
}

function requiredText(value, label) {
  const text = String(value || '').trim();
  if (!text) fail('CANADA_REQUIRED_EVIDENCE', `${label} is required`);
  return text;
}

function integer(value, label, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail('CANADA_INVALID_INTEGER', `${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function parseDate(value, label) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) fail('CANADA_INVALID_DATE', `${label} must use YYYY-MM-DD`);
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    fail('CANADA_INVALID_DATE', `${label} must be a valid calendar date`);
  }
  return { text, date };
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function monthBounds(date) {
  return {
    start: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)),
    end: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)),
  };
}

function nextMonthFifteenth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 15));
}

function normalizeCalendar(value) {
  assertObject(value, 'businessCalendar');
  assertOnlyKeys(value, new Set(['recognizedHolidays', 'evidenceReference']), 'businessCalendar');
  requiredText(value.evidenceReference, 'businessCalendar.evidenceReference');
  if (!Array.isArray(value.recognizedHolidays)) {
    fail('CANADA_REQUIRED_EVIDENCE', 'businessCalendar.recognizedHolidays must be an explicit array');
  }
  const holidays = new Set(value.recognizedHolidays.map((item, index) => parseDate(item, `businessCalendar.recognizedHolidays[${index}]`).text));
  return { holidays, evidenceReference: value.evidenceReference.trim() };
}

function nextCraBusinessDay(date, holidays) {
  const result = new Date(date.getTime());
  while (result.getUTCDay() === 0 || result.getUTCDay() === 6 || holidays.has(isoDate(result))) {
    result.setUTCDate(result.getUTCDate() + 1);
  }
  return result;
}

function normalizePayPeriod(value, payDate) {
  assertObject(value, 'payPeriod');
  assertOnlyKeys(value, new Set(['start', 'end', 'evidenceReference']), 'payPeriod');
  const start = parseDate(value.start, 'payPeriod.start');
  const end = parseDate(value.end, 'payPeriod.end');
  const evidenceReference = requiredText(value.evidenceReference, 'payPeriod.evidenceReference');
  if (start.text > end.text) fail('CANADA_INVALID_PAY_PERIOD', 'payPeriod.start cannot be after payPeriod.end');
  if (payDate.text < start.text || payDate.text > end.text) fail('CANADA_INVALID_PAY_PERIOD', 'payDate must fall within payPeriod');
  return { start: start.text, end: end.text, evidenceReference };
}

function normalizeTd1(value, payDate) {
  assertObject(value, 'td1');
  assertOnlyKeys(value, new Set(['federal', 'ontario', 'additionalTaxPerPeriod']), 'td1');
  const normalizeForm = (form, label, ontario = false) => {
    assertObject(form, label);
    const keys = ontario
      ? new Set(['taxYear', 'totalClaimAmount', 'claimExempt', 'disabledDependants', 'dependantsUnder19', 'signedAt', 'evidenceReference'])
      : new Set(['taxYear', 'totalClaimAmount', 'claimExempt', 'signedAt', 'evidenceReference']);
    assertOnlyKeys(form, keys, label);
    if (form.taxYear !== 2026) fail('CANADA_TD1_NOT_2026', `${label}.taxYear must be 2026`);
    if (form.claimExempt !== false) fail('CANADA_UNSUPPORTED_TD1_EXEMPTION', `${label}.claimExempt must be false; claim code E is outside this preview`);
    const signedAt = parseDate(form.signedAt, `${label}.signedAt`);
    if (signedAt.text > payDate.text) fail('CANADA_INVALID_TD1', `${label}.signedAt cannot be after payDate`);
    const normalized = {
      totalClaimAmount: moneyFraction(form.totalClaimAmount, `${label}.totalClaimAmount`),
      signedAt: signedAt.text,
      evidenceReference: requiredText(form.evidenceReference, `${label}.evidenceReference`),
    };
    if (ontario) {
      normalized.disabledDependants = integer(form.disabledDependants, `${label}.disabledDependants`, { maximum: 100 });
      normalized.dependantsUnder19 = integer(form.dependantsUnder19, `${label}.dependantsUnder19`, { maximum: 100 });
    }
    return normalized;
  };
  return {
    federal: normalizeForm(value.federal, 'td1.federal'),
    ontario: normalizeForm(value.ontario, 'td1.ontario', true),
    additionalTaxPerPeriod: moneyFraction(value.additionalTaxPerPeriod, 'td1.additionalTaxPerPeriod'),
  };
}

function normalizeEmployment(value) {
  assertObject(value, 'employment');
  assertOnlyKeys(value, new Set(['type', 'cppStatus', 'cppContributoryMonths', 'eiReducedRate', 'provinceTransfer', 'evidenceReference']), 'employment');
  if (value.type !== 'salary_or_wages') fail('CANADA_UNSUPPORTED_PAY_TYPE', 'Only ordinary periodic salary_or_wages is supported');
  if (value.cppStatus !== 'contributing_full_year' || value.cppContributoryMonths !== 12) {
    fail('CANADA_UNSUPPORTED_CPP_STATUS', 'Only an employee contributing to CPP for all 12 months is supported; age, CPT30, disability, death, or partial-year PM cases require a certified extension');
  }
  if (value.eiReducedRate !== false) fail('CANADA_UNSUPPORTED_EI_RATE', 'Only the standard EI employer rate is supported');
  if (value.provinceTransfer !== false) fail('CANADA_UNSUPPORTED_PROVINCE_TRANSFER', 'Interprovincial and Quebec transfer formulas are outside this preview');
  return { evidenceReference: requiredText(value.evidenceReference, 'employment.evidenceReference') };
}

function normalizeYtd(value) {
  assertObject(value, 'ytd');
  assertOnlyKeys(value, new Set([
    'pensionableEarnings', 'insurableEarnings', 'employeeCpp', 'employeeCpp2', 'employeeEi',
    'employerCpp', 'employerCpp2', 'employerEi', 'evidenceReference',
  ]), 'ytd');
  const result = {
    pensionableEarnings: moneyFraction(value.pensionableEarnings, 'ytd.pensionableEarnings'),
    insurableEarnings: moneyFraction(value.insurableEarnings, 'ytd.insurableEarnings'),
    employeeCpp: moneyFraction(value.employeeCpp, 'ytd.employeeCpp'),
    employeeCpp2: moneyFraction(value.employeeCpp2, 'ytd.employeeCpp2'),
    employeeEi: moneyFraction(value.employeeEi, 'ytd.employeeEi'),
    employerCpp: moneyFraction(value.employerCpp, 'ytd.employerCpp'),
    employerCpp2: moneyFraction(value.employerCpp2, 'ytd.employerCpp2'),
    employerEi: moneyFraction(value.employerEi, 'ytd.employerEi'),
    evidenceReference: requiredText(value.evidenceReference, 'ytd.evidenceReference'),
  };
  const caps = [
    ['employeeCpp', LIMITS.cppMaximum], ['employerCpp', LIMITS.cppMaximum],
    ['employeeCpp2', LIMITS.cpp2Maximum], ['employerCpp2', LIMITS.cpp2Maximum],
    ['employeeEi', LIMITS.eiEmployeeMaximum], ['employerEi', LIMITS.eiEmployerMaximum],
  ];
  for (const [key, cap] of caps) {
    if (result[key].compare(Fraction.fromDecimal(cap)) > 0) fail('CANADA_YTD_OVER_MAXIMUM', `ytd.${key} exceeds the 2026 annual maximum`);
  }
  if (result.employeeCpp.compare(result.employerCpp) !== 0 || result.employeeCpp2.compare(result.employerCpp2) !== 0) {
    fail('CANADA_UNSUPPORTED_YTD_CORRECTION', 'Standard-scope employer CPP and CPP2 YTD must equal employee YTD amounts');
  }
  return result;
}

function normalizeRemitter(value) {
  assertObject(value, 'remitterProfile');
  assertOnlyKeys(value, new Set(['type', 'evidenceReference', 'payrollProgramAccountEvidenceReference']), 'remitterProfile');
  if (value.type !== 'regular') {
    fail('CANADA_UNSUPPORTED_REMITTER_TYPE', 'Only a CRA-assigned regular monthly remitter is supported in Wave 1');
  }
  return {
    type: value.type,
    evidenceReference: requiredText(value.evidenceReference, 'remitterProfile.evidenceReference'),
    accountEvidenceReference: requiredText(value.payrollProgramAccountEvidenceReference, 'remitterProfile.payrollProgramAccountEvidenceReference'),
  };
}

function validateExplicitEmptyArray(value, label, errorCode) {
  if (!Array.isArray(value)) fail('CANADA_COMPONENT_DECLARATION_REQUIRED', `${label} must be an explicit array`);
  if (value.length > 0) fail(errorCode, `${label} are outside this certified preview scope`);
}

function bracketFor(annualIncome, brackets) {
  let selected = brackets[0];
  for (const bracket of brackets) {
    // T4127/T4032 bracket limits are inclusive at the top of the lower
    // bracket (for example, 58,523.00 remains in the 14% federal bracket).
    if (annualIncome.compare(Fraction.fromDecimal(bracket.threshold)) > 0) selected = bracket;
  }
  return selected;
}

function selectFederalBracket(annualTaxableIncome) {
  return bracketFor(Fraction.fromDecimal(annualTaxableIncome, 'annualTaxableIncome'), FEDERAL_BRACKETS);
}

function selectOntarioBracket(annualTaxableIncome) {
  return bracketFor(Fraction.fromDecimal(annualTaxableIncome, 'annualTaxableIncome'), ONTARIO_BRACKETS);
}

function ontarioHealthPremium(annualIncome) {
  const A = annualIncome;
  if (A.compare('20000') <= 0) return ZERO;
  if (A.compare('36000') <= 0) return Fraction.fromDecimal('300').min(A.subtract('20000').multiply('0.06'));
  if (A.compare('48000') <= 0) return Fraction.fromDecimal('450').min(Fraction.fromDecimal('300').add(A.subtract('36000').multiply('0.06')));
  if (A.compare('72000') <= 0) return Fraction.fromDecimal('600').min(Fraction.fromDecimal('450').add(A.subtract('48000').multiply('0.25')));
  if (A.compare('200000') <= 0) return Fraction.fromDecimal('750').min(Fraction.fromDecimal('600').add(A.subtract('72000').multiply('0.25')));
  return Fraction.fromDecimal('900').min(Fraction.fromDecimal('750').add(A.subtract('200000').multiply('0.25')));
}

function ontarioSurtax(basicOntarioTax) {
  if (basicOntarioTax.compare('5818') <= 0) return ZERO;
  if (basicOntarioTax.compare('7446') <= 0) return basicOntarioTax.subtract('5818').multiply('0.20');
  return basicOntarioTax.subtract('5818').multiply('0.20')
    .add(basicOntarioTax.subtract('7446').multiply('0.36'));
}

function currentFormulaVersion(payDate) {
  return payDate.text < '2026-07-01' ? SOURCE_VERSIONS.JANUARY : SOURCE_VERSIONS.JULY;
}

function sourceReferencesFor(payDate) {
  const release = payDate.text < '2026-07-01'
    ? ['CRA_T4127_122_JAN_2026']
    : ['CRA_T4127_123_JUL_2026', 'CRA_T4127_122_JAN_2026'];
  return [...release, 'CRA_T4032_ON_JAN_2026'];
}

function createLiability({
  liabilityCode, name, payer, amount, baseAmount, rate, authority, periodStart, periodEnd,
  dueDate, calculationMethod, roundingStage, sourceReferences, sourceEffectiveFrom,
  evidenceReference, metadata,
}) {
  return statutoryLiabilityLedgerService.createEntry({
    liabilityCode,
    name,
    payer,
    amount,
    baseAmount,
    rate,
    authority,
    remittance: {
      formCode: 'PD7A',
      frequency: 'monthly',
      periodStart,
      periodEnd,
      dueDate,
      paymentChannel: 'CRA payroll remittance channel',
      accountReferenceField: 'CRA payroll program (RP) account number',
    },
    calculation: { method: calculationMethod, roundingStage },
    sourceReferences,
    sourceEffectiveFrom,
    evidenceReference,
    metadata,
  }, MONEY);
}

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}

function calculate(input) {
  assertObject(input, 'input');
  assertOnlyKeys(input, TOP_LEVEL_KEYS, 'input');
  const payDate = parseDate(input.payDate, 'payDate');
  if (payDate.date.getUTCFullYear() !== 2026) fail('CANADA_UNSUPPORTED_TAX_YEAR', 'This adapter supports pay dates only in calendar year 2026');

  const province = String(input.provinceOfEmployment || '').trim().toUpperCase();
  if (province === 'QC') fail('CANADA_QUEBEC_BLOCKED', 'Quebec requires Revenu Quebec provincial tax, QPP, QPIP, and Quebec EI rules');
  if (province !== 'ON') fail('CANADA_UNSUPPORTED_PROVINCE', 'Wave 1 supports Ontario province of employment only');

  const expectedVersion = currentFormulaVersion(payDate);
  if (input.formulaSourceVersion !== expectedVersion) {
    fail('CANADA_FORMULA_SOURCE_NOT_PINNED', `formulaSourceVersion must be ${expectedVersion} for this pay date`);
  }

  const payFrequency = String(input.payFrequency || '').trim().toLowerCase();
  const supportedPeriods = PAY_FREQUENCIES[payFrequency];
  if (!supportedPeriods || !supportedPeriods.includes(input.payPeriodsPerYear)) {
    fail('CANADA_UNSUPPORTED_PAY_FREQUENCY', 'payFrequency/payPeriodsPerYear must be monthly/12, semi_monthly/24, biweekly/26 or 27, or weekly/52 or 53');
  }
  const P = integer(input.payPeriodsPerYear, 'payPeriodsPerYear', { minimum: 1, maximum: 53 });
  const payPeriodNumber = integer(input.payPeriodNumber, 'payPeriodNumber', { minimum: 1, maximum: P });
  const PR = P - payPeriodNumber + 1;
  const payPeriod = normalizePayPeriod(input.payPeriod, payDate);

  validateExplicitEmptyArray(input.benefits, 'benefits', 'CANADA_UNSUPPORTED_TAXABLE_BENEFIT');
  validateExplicitEmptyArray(input.deductions, 'deductions', 'CANADA_UNSUPPORTED_DEDUCTION');
  validateExplicitEmptyArray(input.nonPeriodicPayments, 'nonPeriodicPayments', 'CANADA_UNSUPPORTED_NON_PERIODIC_PAYMENT');

  const employment = normalizeEmployment(input.employment);
  const td1 = normalizeTd1(input.td1, payDate);
  const ytd = normalizeYtd(input.ytd);
  const remitter = normalizeRemitter(input.remitterProfile);
  const calendar = normalizeCalendar(input.businessCalendar);

  const gross = moneyFraction(input.grossCashPay, 'grossCashPay');
  const pensionable = moneyFraction(input.pensionableEarnings, 'pensionableEarnings');
  const insurable = moneyFraction(input.insurableEarnings, 'insurableEarnings');
  if (pensionable.compare(gross) > 0 || insurable.compare(gross) > 0) {
    fail('CANADA_INVALID_EARNINGS_BASE', 'With benefits excluded, pensionableEarnings and insurableEarnings cannot exceed grossCashPay');
  }

  const basicExemptionCents = 350000n / BigInt(P); // T4127: drop cents beyond two decimals.
  const cppBasicExemption = Fraction.fromCents(basicExemptionCents);
  const cppUncappedBase = maxZero(pensionable.subtract(cppBasicExemption));
  const cppRemaining = Fraction.fromDecimal(LIMITS.cppMaximum).subtract(ytd.employeeCpp);
  const cppUnrounded = cppRemaining.min(cppUncappedBase.multiply(LIMITS.cppRate));
  const cppEmployee = roundedMoney(maxZero(cppUnrounded), 'ca.cpp.employee.current.final');
  const cppCurrent = Fraction.fromCents(cppEmployee.toMinorUnits());

  const cpp2Threshold = ytd.pensionableEarnings.max(Fraction.fromDecimal(LIMITS.ympe));
  const cpp2UncappedBase = maxZero(ytd.pensionableEarnings.add(pensionable).subtract(cpp2Threshold));
  const cpp2Remaining = Fraction.fromDecimal(LIMITS.cpp2Maximum).subtract(ytd.employeeCpp2);
  const cpp2Unrounded = cpp2Remaining.min(cpp2UncappedBase.multiply(LIMITS.cpp2Rate));
  const cpp2Employee = roundedMoney(maxZero(cpp2Unrounded), 'ca.cpp2.employee.current.final');
  const cpp2Current = Fraction.fromCents(cpp2Employee.toMinorUnits());

  const eiRemaining = Fraction.fromDecimal(LIMITS.eiEmployeeMaximum).subtract(ytd.employeeEi);
  const eiUnrounded = eiRemaining.min(insurable.multiply(LIMITS.eiEmployeeRate));
  const eiEmployee = roundedMoney(maxZero(eiUnrounded), 'ca.ei.employee.current.final');
  const eiCurrent = Fraction.fromCents(eiEmployee.toMinorUnits());

  const cppEmployer = fixedMoneyFromCents(cppEmployee.toMinorUnits(), 'ca.cpp.employer.match.final');
  const cpp2Employer = fixedMoneyFromCents(cpp2Employee.toMinorUnits(), 'ca.cpp2.employer.match.final');
  const eiEmployerRemaining = Fraction.fromDecimal(LIMITS.eiEmployerMaximum).subtract(ytd.employerEi);
  const eiEmployerUnrounded = eiEmployerRemaining.min(eiCurrent.multiply(LIMITS.eiEmployerMultiplier));
  const eiEmployer = roundedMoney(maxZero(eiEmployerUnrounded), 'ca.ei.employer.current.final');

  const firstAdditionalCppDeduction = cppCurrent.multiply(LIMITS.cppFirstAdditionalRate).divide(LIMITS.cppRate);
  const F5A = firstAdditionalCppDeduction.add(cpp2Current);
  const annualTaxableIncome = maxZero(gross.subtract(F5A).multiply(P));
  const annualGrossEmployment = gross.multiply(P);

  const projectedBaseCpp = Fraction.fromDecimal(LIMITS.cppBaseMaximum).min(
    ytd.employeeCpp.multiply(LIMITS.cppBaseRate).divide(LIMITS.cppRate)
      .add(cppCurrent.multiply(PR).multiply(LIMITS.cppBaseRate).divide(LIMITS.cppRate))
  );
  const projectedEi = Fraction.fromDecimal(LIMITS.eiEmployeeMaximum).min(ytd.employeeEi.add(eiCurrent.multiply(PR)));
  const projectedCreditBase = projectedBaseCpp.add(projectedEi);

  const federalBracket = bracketFor(annualTaxableIncome, FEDERAL_BRACKETS);
  const K1 = td1.federal.totalClaimAmount.multiply('0.14');
  const K2 = projectedCreditBase.multiply('0.14');
  const K4 = annualGrossEmployment.min(Fraction.fromDecimal(LIMITS.canadaEmploymentAmount)).multiply('0.14');
  const T3 = maxZero(
    annualTaxableIncome.multiply(federalBracket.rate)
      .subtract(federalBracket.constant)
      .subtract(K1)
      .subtract(K2)
      .subtract(K4)
  );
  const T1 = T3;

  const ontarioBracket = bracketFor(annualTaxableIncome, ONTARIO_BRACKETS);
  const K1P = td1.ontario.totalClaimAmount.multiply('0.0505');
  const K2P = projectedCreditBase.multiply('0.0505');
  const T4 = maxZero(
    annualTaxableIncome.multiply(ontarioBracket.rate)
      .subtract(ontarioBracket.constant)
      .subtract(K1P)
      .subtract(K2P)
  );
  const V1 = ontarioSurtax(T4);
  const V2 = ontarioHealthPremium(annualTaxableIncome);
  const Y = Fraction.fromDecimal(LIMITS.ontarioDependentReductionAmount)
    .multiply(td1.ontario.disabledDependants + td1.ontario.dependantsUnder19);
  const reductionCandidate = Fraction.fromDecimal(LIMITS.ontarioTaxReductionBase)
    .add(Y).multiply(2).subtract(T4.add(V1));
  const S = maxZero(T4.add(V1).min(reductionCandidate));
  const T2 = maxZero(T4.add(V1).add(V2).subtract(S));

  const totalTaxUnrounded = T1.add(T2).divide(P).add(td1.additionalTaxPerPeriod);
  const totalIncomeTax = roundedMoney(totalTaxUnrounded, 'ca.income_tax.combined.current.final');
  const federalAllocationUnrounded = T1.divide(P).add(td1.additionalTaxPerPeriod);
  let federalTaxCents = roundFractionToCents(maxZero(federalAllocationUnrounded));
  if (federalTaxCents > totalIncomeTax.toMinorUnits()) federalTaxCents = totalIncomeTax.toMinorUnits();
  const ontarioTaxCents = totalIncomeTax.toMinorUnits() - federalTaxCents;
  const federalIncomeTax = fixedMoneyFromCents(federalTaxCents, 'ca.income_tax.federal.allocation.final');
  const ontarioIncomeTax = fixedMoneyFromCents(ontarioTaxCents, 'ca.income_tax.ontario.residual_allocation.final');

  const remittanceMonth = monthBounds(payDate.date);
  const dueDate = nextCraBusinessDay(nextMonthFifteenth(payDate.date), calendar.holidays);
  const periodStart = isoDate(remittanceMonth.start);
  const periodEnd = isoDate(remittanceMonth.end);
  const dueDateText = isoDate(dueDate);
  const formulaSources = sourceReferencesFor(payDate);
  const sourceEffectiveFrom = payDate.text < '2026-07-01' ? '2026-01-01' : '2026-07-01';
  const commonRemittanceMetadata = {
    remitterType: remitter.type,
    dueRule: '15th_day_of_following_month_adjusted_to_next_CRA_business_day',
    remitterEvidenceReference: remitter.evidenceReference,
    accountEvidenceReference: remitter.accountEvidenceReference,
    calendarEvidenceReference: calendar.evidenceReference,
    previewOnly: true,
    postable: false,
  };
  const craAuthority = (code, name, level, jurisdictionCode) => ({ code, name, level, jurisdictionCode });

  const liabilities = [
    createLiability({
      liabilityCode: 'CA_FEDERAL_INCOME_TAX', name: 'Federal income tax withholding', payer: 'employee',
      amount: federalIncomeTax, baseAmount: roundedMoney(annualTaxableIncome, 'ca.income_tax.annual_taxable_income.display'), rate: federalBracket.rate,
      authority: craAuthority('CRA_FED', 'Canada Revenue Agency', 'federal', 'CA'),
      periodStart, periodEnd, dueDate: dueDateText, calculationMethod: 'T4127_option_1_federal_with_YTD_CPP_EI_credit',
      roundingStage: 'ca.income_tax.federal.allocation.final', sourceReferences: [...formulaSources, 'CRA_TD1_2026'],
      sourceEffectiveFrom, evidenceReference: td1.federal.evidenceReference,
      metadata: { ...commonRemittanceMetadata, combinedWithholdingRounding: 'T=round_half_up((T1+T2)/P+L,0.01)', allocation: 'federal rounded first; Ontario receives residual cent', annualT1Exact: T1.exactText(), additionalTaxPerPeriod: centsText(roundFractionToCents(td1.additionalTaxPerPeriod)) },
    }),
    createLiability({
      liabilityCode: 'CA_ON_INCOME_TAX', name: 'Ontario income tax withholding including Ontario Health Premium', payer: 'employee',
      amount: ontarioIncomeTax, baseAmount: roundedMoney(annualTaxableIncome, 'ca.on_income_tax.annual_taxable_income.display'), rate: ontarioBracket.rate,
      authority: craAuthority('CRA_ON', 'Canada Revenue Agency - Ontario withholding', 'subdivision', 'CA-ON'),
      periodStart, periodEnd, dueDate: dueDateText, calculationMethod: 'T4127_option_1_Ontario_T4_surtax_OHP_and_reduction',
      roundingStage: 'ca.income_tax.ontario.residual_allocation.final', sourceReferences: [...formulaSources, 'CRA_TD1_2026'],
      sourceEffectiveFrom, evidenceReference: td1.ontario.evidenceReference,
      metadata: { ...commonRemittanceMetadata, allocation: 'residual from CRA combined T rounding after federal allocation', annualT2Exact: T2.exactText(), annualBasicOntarioTaxExact: T4.exactText(), annualSurtaxExact: V1.exactText(), annualOntarioHealthPremiumExact: V2.exactText(), annualTaxReductionExact: S.exactText() },
    }),
    createLiability({
      liabilityCode: 'CA_CPP_EMPLOYEE', name: 'Canada Pension Plan contribution - employee', payer: 'employee',
      amount: cppEmployee, baseAmount: roundedMoney(cppUncappedBase, 'ca.cpp.current_base.display'), rate: LIMITS.cppRate,
      authority: craAuthority('CRA_CPP', 'Canada Revenue Agency - Canada Pension Plan', 'social_security', 'CA'),
      periodStart, periodEnd, dueDate: dueDateText, calculationMethod: 'lesser_of_annual_max_remaining_and_rate_times_PI_less_truncated_period_exemption',
      roundingStage: 'ca.cpp.employee.current.final', sourceReferences: [...formulaSources, 'CRA_CPP_2026'],
      sourceEffectiveFrom: '2026-01-01', evidenceReference: ytd.evidenceReference,
      metadata: { ...commonRemittanceMetadata, annualMaximum: LIMITS.cppMaximum, YBE: LIMITS.ybe, YMPE: LIMITS.ympe, periodBasicExemption: centsText(basicExemptionCents), ytdBeforePeriod: centsText(roundFractionToCents(ytd.employeeCpp)) },
    }),
    createLiability({
      liabilityCode: 'CA_CPP_EMPLOYER', name: 'Canada Pension Plan contribution - employer', payer: 'employer',
      amount: cppEmployer, baseAmount: roundedMoney(cppUncappedBase, 'ca.cpp.employer.current_base.display'), rate: LIMITS.cppRate,
      authority: craAuthority('CRA_CPP', 'Canada Revenue Agency - Canada Pension Plan', 'social_security', 'CA'),
      periodStart, periodEnd, dueDate: dueDateText, calculationMethod: 'employer_matches_employee_CPP_contribution',
      roundingStage: 'ca.cpp.employer.match.final', sourceReferences: [...formulaSources, 'CRA_CPP_2026'],
      sourceEffectiveFrom: '2026-01-01', evidenceReference: ytd.evidenceReference,
      metadata: { ...commonRemittanceMetadata, annualMaximum: LIMITS.cppMaximum, ytdBeforePeriod: centsText(roundFractionToCents(ytd.employerCpp)) },
    }),
    createLiability({
      liabilityCode: 'CA_CPP2_EMPLOYEE', name: 'Second additional CPP contribution - employee', payer: 'employee',
      amount: cpp2Employee, baseAmount: roundedMoney(cpp2UncappedBase, 'ca.cpp2.current_base.display'), rate: LIMITS.cpp2Rate,
      authority: craAuthority('CRA_CPP2', 'Canada Revenue Agency - second additional CPP', 'social_security', 'CA'),
      periodStart, periodEnd, dueDate: dueDateText, calculationMethod: 'lesser_of_CPP2_max_remaining_and_rate_times_PI_YTD_plus_PI_less_W',
      roundingStage: 'ca.cpp2.employee.current.final', sourceReferences: [...formulaSources, 'CRA_CPP2_2026'],
      sourceEffectiveFrom: '2026-01-01', evidenceReference: ytd.evidenceReference,
      metadata: { ...commonRemittanceMetadata, annualMaximum: LIMITS.cpp2Maximum, YMPE: LIMITS.ympe, YAMPE: LIMITS.yampe, WExact: cpp2Threshold.exactText(), ytdBeforePeriod: centsText(roundFractionToCents(ytd.employeeCpp2)) },
    }),
    createLiability({
      liabilityCode: 'CA_CPP2_EMPLOYER', name: 'Second additional CPP contribution - employer', payer: 'employer',
      amount: cpp2Employer, baseAmount: roundedMoney(cpp2UncappedBase, 'ca.cpp2.employer.current_base.display'), rate: LIMITS.cpp2Rate,
      authority: craAuthority('CRA_CPP2', 'Canada Revenue Agency - second additional CPP', 'social_security', 'CA'),
      periodStart, periodEnd, dueDate: dueDateText, calculationMethod: 'employer_matches_employee_CPP2_contribution',
      roundingStage: 'ca.cpp2.employer.match.final', sourceReferences: [...formulaSources, 'CRA_CPP2_2026'],
      sourceEffectiveFrom: '2026-01-01', evidenceReference: ytd.evidenceReference,
      metadata: { ...commonRemittanceMetadata, annualMaximum: LIMITS.cpp2Maximum, ytdBeforePeriod: centsText(roundFractionToCents(ytd.employerCpp2)) },
    }),
    createLiability({
      liabilityCode: 'CA_EI_EMPLOYEE', name: 'Employment Insurance premium - employee', payer: 'employee',
      amount: eiEmployee, baseAmount: roundedMoney(insurable, 'ca.ei.current_base.display'), rate: LIMITS.eiEmployeeRate,
      authority: craAuthority('CRA_EI', 'Canada Revenue Agency - Employment Insurance', 'social_security', 'CA'),
      periodStart, periodEnd, dueDate: dueDateText, calculationMethod: 'lesser_of_EI_max_remaining_and_rate_times_insurable_earnings',
      roundingStage: 'ca.ei.employee.current.final', sourceReferences: [...formulaSources, 'CRA_EI_2026'],
      sourceEffectiveFrom: '2026-01-01', evidenceReference: ytd.evidenceReference,
      metadata: { ...commonRemittanceMetadata, annualMaximumInsurableEarnings: LIMITS.eiMaximumInsurableEarnings, annualMaximumPremium: LIMITS.eiEmployeeMaximum, ytdBeforePeriod: centsText(roundFractionToCents(ytd.employeeEi)) },
    }),
    createLiability({
      liabilityCode: 'CA_EI_EMPLOYER', name: 'Employment Insurance premium - employer', payer: 'employer',
      amount: eiEmployer, baseAmount: roundedMoney(insurable, 'ca.ei.employer.current_base.display'), rate: LIMITS.eiEmployerRate,
      authority: craAuthority('CRA_EI', 'Canada Revenue Agency - Employment Insurance', 'social_security', 'CA'),
      periodStart, periodEnd, dueDate: dueDateText, calculationMethod: 'standard_employer_multiplier_times_employee_premium_capped_at_annual_maximum',
      roundingStage: 'ca.ei.employer.current.final', sourceReferences: [...formulaSources, 'CRA_EI_2026'],
      sourceEffectiveFrom: '2026-01-01', evidenceReference: ytd.evidenceReference,
      metadata: { ...commonRemittanceMetadata, employeePremiumMultiplier: LIMITS.eiEmployerMultiplier, annualMaximumPremium: LIMITS.eiEmployerMaximum, ytdBeforePeriod: centsText(roundFractionToCents(ytd.employerEi)) },
    }),
  ];

  const ledger = statutoryLiabilityLedgerService.buildLedger(liabilities);
  const employeeStatutory = statutoryMoneyService.create(ledger.employeeTotal.amount, MONEY);
  const employerStatutory = statutoryMoneyService.create(ledger.employerTotal.amount, MONEY);
  const grossMoney = roundedMoney(gross, 'ca.gross_cash_pay.input');
  const netPay = grossMoney.subtract(employeeStatutory);
  if (netPay.decimal.compare('0') < 0) fail('CANADA_NEGATIVE_NET_PAY', 'Statutory deductions exceed gross cash pay');

  return freezeDeep({
    adapter: {
      code: 'CA_ON_2026_STANDALONE_PREVIEW', countryCode: 'CA', subdivisionCode: 'CA-ON', taxYear: 2026,
      integrationStatus: 'standalone_not_integrated', confidence: 'preview_pending_Canadian_payroll_legal_and_source_fixture_certification',
      previewOnly: true, postable: false, taxMethod: 'CRA_T4127_Option_1_periodic', taxCreditProjectionMethod: 'CRA_recommended_year_to_date_CPP_EI_method',
      formulaSourceVersion: expectedVersion, currency: MONEY.currency, minorUnits: MONEY.minorUnits,
      rounding: { incomeTax: 'combined T rounded half-up to CAD 0.01; federal allocation first and Ontario residual', CPP: 'period basic exemption truncated to cents; contribution half-up to cents', CPP2: 'half-up to cents', EI: 'employee and employer half-up to cents' },
    },
    payPeriod: { ...payPeriod, payDate: payDate.text, payFrequency, payPeriodsPerYear: P, payPeriodNumber, remainingPayPeriodsIncludingCurrent: PR },
    annualParameters: LIMITS,
    bases: {
      grossCashPay: serializeMoney(grossMoney), pensionableEarnings: serializeMoney(roundedMoney(pensionable, 'ca.pensionable_earnings.input')),
      insurableEarnings: serializeMoney(roundedMoney(insurable, 'ca.insurable_earnings.input')),
      annualTaxableIncome: serializeMoney(roundedMoney(annualTaxableIncome, 'ca.annual_taxable_income.display')),
      annualTaxableIncomeExact: annualTaxableIncome.exactText(), annualGrossEmploymentExact: annualGrossEmployment.exactText(),
    },
    incomeTax: {
      combined: serializeMoney(totalIncomeTax), federal: serializeMoney(federalIncomeTax), ontario: serializeMoney(ontarioIncomeTax),
      factors: {
        F5AExact: F5A.exactText(), projectedBaseCppCreditExact: projectedBaseCpp.exactText(), projectedEiCreditExact: projectedEi.exactText(),
        T1Exact: T1.exactText(), T2Exact: T2.exactText(), T4Exact: T4.exactText(), V1Exact: V1.exactText(), V2Exact: V2.exactText(), SExact: S.exactText(),
      },
      brackets: { federal: federalBracket, ontario: ontarioBracket },
    },
    employeeContributions: { cpp: serializeMoney(cppEmployee), cpp2: serializeMoney(cpp2Employee), ei: serializeMoney(eiEmployee) },
    employerContributions: { cpp: serializeMoney(cppEmployer), cpp2: serializeMoney(cpp2Employer), ei: serializeMoney(eiEmployer) },
    ytdAfterPeriod: {
      pensionableEarnings: serializeMoney(roundedMoney(ytd.pensionableEarnings.add(pensionable), 'ca.ytd.pensionable.after.display')),
      insurableEarnings: serializeMoney(roundedMoney(ytd.insurableEarnings.add(insurable), 'ca.ytd.insurable.after.display')),
      employeeCpp: serializeMoney(roundedMoney(ytd.employeeCpp.add(cppCurrent), 'ca.ytd.cpp.employee.after.display')),
      employeeCpp2: serializeMoney(roundedMoney(ytd.employeeCpp2.add(cpp2Current), 'ca.ytd.cpp2.employee.after.display')),
      employeeEi: serializeMoney(roundedMoney(ytd.employeeEi.add(eiCurrent), 'ca.ytd.ei.employee.after.display')),
      employerCpp: serializeMoney(roundedMoney(ytd.employerCpp.add(cppCurrent), 'ca.ytd.cpp.employer.after.display')),
      employerCpp2: serializeMoney(roundedMoney(ytd.employerCpp2.add(cpp2Current), 'ca.ytd.cpp2.employer.after.display')),
      employerEi: serializeMoney(roundedMoney(ytd.employerEi.add(Fraction.fromCents(eiEmployer.toMinorUnits())), 'ca.ytd.ei.employer.after.display')),
    },
    totals: {
      grossCashPay: serializeMoney(grossMoney), employeeStatutoryDeductions: serializeMoney(employeeStatutory),
      netCashPay: serializeMoney(netPay), employerStatutoryCost: serializeMoney(employerStatutory),
      employerTotalCashCost: serializeMoney(grossMoney.add(employerStatutory)),
    },
    remittance: { type: remitter.type, periodStart, periodEnd, dueDate: dueDateText, formCode: 'PD7A', authority: 'CRA' },
    liabilityLedger: ledger,
    evidence: {
      federalTd1: td1.federal.evidenceReference, ontarioTd1: td1.ontario.evidenceReference,
      employment: employment.evidenceReference, ytd: ytd.evidenceReference, payPeriod: payPeriod.evidenceReference,
      remitterProfile: remitter.evidenceReference, payrollProgramAccount: remitter.accountEvidenceReference,
      businessCalendar: calendar.evidenceReference,
    },
    supportedCases: [
      'Ontario province-of-employment ordinary periodic salary or wages',
      'CRA T4127 Option 1 federal and Ontario income-tax withholding',
      'documented 2026 federal TD1 and TD1ON total claim amounts and Ontario Y dependants',
      'full-year standard CPP/CPP2 participation with employer matching and YTD annual maxima',
      'standard-rate EI with employee and 1.4-times employer premium and YTD annual maxima',
      'CRA regular monthly remitter with evidenced CRA-recognized holiday calendar',
      'January and July 2026 source releases explicitly pinned by pay date',
    ],
    excludedCases: [
      'Quebec and every province or territory other than Ontario',
      'taxable or non-cash benefits and reimbursement valuation',
      'bonuses, commissions, retroactive pay, pension payments, irregular and non-periodic payments',
      'RPP, RRSP, PRPP, RCA, union dues, prescribed-zone, authorized annual deductions, labour-fund credits, and garnishments',
      'TD1 claim code E, missing/implicit TD1 claims, and non-2026 TD1 evidence',
      'CPP partial-year PM, under-18/over-70 transitions, CPT30, disability/death, and Quebec transfers',
      'reduced-rate EI and province transfers',
      'quarterly, threshold-1, threshold-2, payment-on-filing, nil, and final remitters',
      'prior-period corrections, refunds, annual reconciliation, T4 filing, and production posting',
    ],
    officialSources: OFFICIAL_SOURCES,
  });
}

module.exports = {
  calculate,
  CanadaOntarioPayrollAdapterError,
  SOURCE_VERSIONS,
  OFFICIAL_SOURCES,
  FEDERAL_BRACKETS,
  ONTARIO_BRACKETS,
  LIMITS,
  selectFederalBracket,
  selectOntarioBracket,
};
