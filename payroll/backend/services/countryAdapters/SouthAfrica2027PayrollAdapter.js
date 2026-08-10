'use strict';

/**
 * South Africa 2027 year-of-assessment payroll adapter (Wave 1).
 *
 * The 2027 year of assessment runs from 1 March 2026 through 28 February
 * 2027. This module is intentionally standalone and non-postable. It accepts
 * only ordinary monthly remuneration and evidence-bearing statutory bases;
 * it is not registered with TaxJurisdictionService.
 *
 * All monetary inputs are unsigned ZAR decimal strings with no more than two
 * decimal places. PAYE table lookup explicitly disregards remuneration cents,
 * while contribution calculations retain cents and round at named stages.
 */

const statutoryMoneyService = require('../StatutoryMoneyService');
const statutoryLiabilityLedgerService = require('../StatutoryLiabilityLedgerService');
const { ROUNDING_MODES, StatutoryMoney } = require('../StatutoryMoneyService');
const ANNUAL_TABLE_ROWS = require('./fixtures/SouthAfrica2027AnnualTableRows');

const ZAR = Object.freeze({ currency: 'ZAR', minorUnits: 2 });
const HALF_UP = ROUNDING_MODES.HALF_UP;
const TRUNCATE = ROUNDING_MODES.TRUNCATE;
const EFFECTIVE_FROM = '2026-03-01';
const EFFECTIVE_TO = '2027-02-28';
const ASSESSMENT_DATE = '2027-02-28';

const OFFICIAL_SOURCES = deepFreeze({
  SARS_EMPLOYER_GUIDE_2027: {
    authority: 'South African Revenue Service',
    title: 'Guide for Employers in Respect of Employees\' Tax (2027)',
    url: 'https://www.sars.gov.za/guide-for-employers-in-respect-of-employees-tax-2027/',
    effectiveFrom: EFFECTIVE_FROM,
    supports: [
      '2027 year-of-assessment dates',
      'annual-equivalent treatment',
      'PAYE, SDL, and UIF bases',
      'IRP5 codes 4102, 4141, and 4142',
      'EMP201 remittance timing',
    ],
  },
  SARS_TAX_DEDUCTION_GUIDE_2027: {
    authority: 'South African Revenue Service',
    title: 'PAYE-GEN-01-G01 Guide for Employers in respect of Tax Deduction Tables, revision 16',
    url: 'https://www.sars.gov.za/wp-content/uploads/Ops/Guides/PAYE-GEN-01-G01-Guide-for-Employers-in-respect-of-Tax-Deduction-Tables-External-Guide.pdf',
    effectiveFrom: EFFECTIVE_FROM,
    supports: [
      'statutory rates and age rebates',
      'medical scheme fees tax credits',
      'official monthly R18,600 example',
      'manual-table and statutory-program alternatives',
    ],
  },
  SARS_MONTHLY_TABLE_2027: {
    authority: 'South African Revenue Service',
    title: 'PAYE-GEN-01-G01-A03 Monthly Tax Deduction Tables (2027 Tax Year)',
    url: 'https://www.sars.gov.za/wp-content/uploads/Docs/PAYE/Tables/tables2026/PAYE-GEN-01-G01-A03-Monthly-Tax-Deduction-Tables-2027-External-Annexure.pdf',
    effectiveFrom: EFFECTIVE_FROM,
    supports: [
      'monthly remuneration ranges',
      'whole-rand table deductions by age band',
      'above-table 45% formula and cents-disregarded result',
    ],
  },
  SARS_ANNUAL_TABLE_2027: {
    authority: 'South African Revenue Service',
    title: 'PAYE-GEN-01-G01-A04 Annual Tax Deduction Tables (2027 Tax Year)',
    url: 'https://www.sars.gov.za/wp-content/uploads/Docs/PAYE/Tables/tables2026/PAYE-GEN-01-G01-A04-Annual-Tax-Deduction-Tables-2027-External-Annexure.pdf',
    effectiveFrom: EFFECTIVE_FROM,
    supports: [
      'annual-equivalent table deductions',
      'above-table 45% formula and cents-disregarded result',
    ],
  },
  SARS_UIF: {
    authority: 'South African Revenue Service',
    title: 'Unemployment Insurance Fund',
    url: 'https://www.sars.gov.za/types-of-tax/unemployment-insurance-fund/',
    effectiveFrom: '2021-06-01',
    supports: [
      '1% employee and 1% employer contributions',
      'R17,712 monthly ceiling',
      'covered-employee exclusions',
      'EMP201 filing and payment',
    ],
  },
  SARS_UIF_CEILING: {
    authority: 'South African Revenue Service',
    title: 'Unemployment Insurance Fund ceiling earnings',
    url: 'https://www.sars.gov.za/latest-news/unemployment-insurance-fund-ceiling-earnings/',
    effectiveFrom: '2021-06-01',
    supports: ['R17,712 monthly ceiling and R177.12 maximum per-side contribution'],
  },
  SARS_SDL: {
    authority: 'South African Revenue Service',
    title: 'Skills Development Levy',
    url: 'https://www.sars.gov.za/types-of-tax/skills-development-levy/',
    effectiveFrom: '2001-04-01',
    supports: ['1% employer levy', 'R500,000 next-12-month threshold exemption'],
  },
  SARS_SDL_EMPLOYER_GUIDE: {
    authority: 'South African Revenue Service',
    title: 'SDL-GEN-01-G01 Guide for Employers in respect of Skills Development Levy',
    url: 'https://www.sars.gov.za/wp-content/uploads/Ops/Guides/SDL-GEN-01-G01-Guide-for-Employers-in-respect-of-Skills-Development-Levy-External-Guide.pdf',
    effectiveFrom: '2019-03-29',
    supports: ['statutory exemptions', 'reasonable-grounds forecast evidence', 'R500,000 threshold'],
  },
  SARS_EMPLOYER_REGISTRATION: {
    authority: 'South African Revenue Service',
    title: 'Registering for Employees\' Tax (PAYE)',
    url: 'https://www.sars.gov.za/types-of-tax/pay-as-you-earn/registering/',
    effectiveFrom: '2024-10-21',
    supports: ['PAYE, SDL, and UIF employer registration obligations'],
  },
  SARS_EMP201: {
    authority: 'South African Revenue Service',
    title: 'Completing the Monthly Employer Declaration (EMP201)',
    url: 'https://www.sars.gov.za/types-of-tax/pay-as-you-earn/completing-the-monthly-employer-declaration-emp201/',
    effectiveFrom: '2025-01-01',
    supports: ['monthly declaration', 'separate PAYE, SDL, and UIF allocations', 'payment channels'],
  },
});

const TAX_BANDS = deepFreeze([
  { ceiling: 245100n, base: 0n, threshold: 0n, ratePercent: 18n },
  // The manual tables apply each published next-band lower bound when
  // generating their representative-row value. This one-rand convention,
  // together with ties-down rounding, reproduces all 1,300 published monthly
  // rows and intentionally differs slightly from statutory-rate programs.
  { ceiling: 383100n, base: 44118n, threshold: 245101n, ratePercent: 26n },
  { ceiling: 530200n, base: 79998n, threshold: 383101n, ratePercent: 31n },
  { ceiling: 695800n, base: 125599n, threshold: 530201n, ratePercent: 36n },
  { ceiling: 887000n, base: 185215n, threshold: 695801n, ratePercent: 39n },
  { ceiling: 1878600n, base: 259783n, threshold: 887001n, ratePercent: 41n },
  { ceiling: null, base: 666339n, threshold: 1878601n, ratePercent: 45n },
]);

const REBATES = Object.freeze({ primary: 17820n, secondary: 9765n, tertiary: 3249n });
const MEDICAL_CREDITS = Object.freeze({ taxpayer: 376n, firstDependent: 376n, additional: 254n });
const UIF_CEILING_CENTS = 1771200n;
const SDL_THRESHOLD_CENTS = 50000000n;

const MONTHLY_TABLE_GROUPS = deepFreeze([
  { start: 4980n, end: 14978n, width: 101n, midpointOffset: 50n },
  { start: 14979n, end: 105578n, width: 151n, midpointOffset: 75n },
  { start: 105579n, end: 226178n, width: 201n, midpointOffset: 100n },
]);

const TOP_LEVEL_KEYS = new Set([
  'payDate',
  'payFrequency',
  'calculationMethod',
  'employee',
  'remuneration',
  'medicalScheme',
  'employer',
  'businessCalendar',
  'cumulative',
  'unsupported',
]);

class SouthAfricaPayrollAdapterError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SouthAfricaPayrollAdapterError';
    this.code = code;
    this.details = details;
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function fail(code, message, details = {}) {
  throw new SouthAfricaPayrollAdapterError(code, message, details);
}

function assertPlainObject(value, label, code = 'ZA_INVALID_INPUT') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(code, `${label} must be an object`);
  }
}

function assertOnlyKeys(value, allowedKeys, label) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      fail('ZA_UNSUPPORTED_INPUT', `${label}.${key} is not supported by the South Africa 2027 Wave 1 adapter`, {
        path: `${label}.${key}`,
      });
    }
  }
}

function requiredText(value, label, code = 'ZA_REQUIRED_EVIDENCE_MISSING') {
  const normalized = String(value || '').trim();
  if (!normalized) fail(code, `${label} is required`);
  return normalized;
}

function exactBoolean(value, label, code = 'ZA_REQUIRED_EVIDENCE_MISSING') {
  if (value !== true && value !== false) fail(code, `${label} must be explicitly true or false`);
  return value;
}

function parseDateOnly(value, label) {
  const normalized = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    fail('ZA_INVALID_DATE', `${label} must use YYYY-MM-DD`);
  }
  const [year, month, day] = normalized.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    fail('ZA_INVALID_DATE', `${label} is not a valid calendar date`);
  }
  return { text: normalized, date };
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function daysInMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function ageOn(dob, assessmentDate) {
  let age = assessmentDate.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday = assessmentDate.getUTCMonth() < dob.getUTCMonth()
    || (assessmentDate.getUTCMonth() === dob.getUTCMonth()
      && assessmentDate.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

function exactZar(value, label) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value.trim())) {
    fail('ZA_INVALID_MONEY', `${label} must be an unsigned ZAR decimal string with at most two decimal places`);
  }
  try {
    const amount = statutoryMoneyService.create(value.trim(), ZAR);
    amount.toMinorUnits();
    return amount;
  } catch (error) {
    fail('ZA_INVALID_MONEY', `${label} is not an exact ZAR amount`, { cause: error.message });
  }
}

function zarFromCents(cents) {
  return statutoryMoneyService.fromMinorUnits(cents, ZAR);
}

function zarFromRands(rands, stage, mode = HALF_UP) {
  return statutoryMoneyService.create(rands.toString(), ZAR).round({ unit: '1', mode, stage });
}

function zarWithTableRounding(rands, { input, mode, stage }) {
  return new StatutoryMoney(rands.toString(), ZAR, [{
    stage,
    mode,
    unit: '1',
    input: String(input),
    output: rands.toString(),
  }]);
}

function serializeMoney(amount) {
  return {
    amount: amount.toFixed(),
    currency: ZAR.currency,
    minorUnits: ZAR.minorUnits,
    roundingHistory: amount.roundingHistory.map((event) => ({ ...event })),
  };
}

function maxZero(amount) {
  return amount.decimal.compare('0') < 0 ? statutoryMoneyService.create('0', ZAR) : amount;
}

function roundHalfDownPositive(numerator, denominator) {
  if (numerator < 0n || denominator <= 0n) fail('ZA_INTERNAL_RULE_ERROR', 'Invalid positive rounding operands');
  return (numerator * 2n + denominator - 1n) / (denominator * 2n);
}

function roundHalfUpPositive(numerator, denominator) {
  if (numerator < 0n || denominator <= 0n) fail('ZA_INTERNAL_RULE_ERROR', 'Invalid positive rounding operands');
  return (numerator * 2n + denominator) / (denominator * 2n);
}

function rebateForAge(age) {
  let rebate = REBATES.primary;
  if (age >= 65) rebate += REBATES.secondary;
  if (age >= 75) rebate += REBATES.tertiary;
  return rebate;
}

function ageBand(age) {
  if (age >= 75) return '75_and_over';
  if (age >= 65) return '65_to_74';
  return 'under_65';
}

function annualTaxAfterRebatesCents(annualRemunerationRands, age) {
  const band = TAX_BANDS.find(({ ceiling }) => ceiling === null || annualRemunerationRands <= ceiling);
  const normalTaxCents = band.base * 100n
    + (annualRemunerationRands - band.threshold) * band.ratePercent;
  const afterRebates = normalTaxCents - rebateForAge(age) * 100n;
  return afterRebates > 0n ? afterRebates : 0n;
}

function tableRowFor(valueRands, groups) {
  const group = groups.find(({ start, end }) => valueRands >= start && valueRands <= end);
  if (!group) return null;
  const index = (valueRands - group.start) / group.width;
  const lower = group.start + index * group.width;
  return {
    lower,
    upper: lower + group.width - 1n,
    representative: lower + group.midpointOffset,
  };
}

function calculateMonthlyTablePaye(balanceOfRemuneration, age) {
  const lookupAmount = balanceOfRemuneration.round({
    unit: '1',
    mode: TRUNCATE,
    stage: 'za.paye.monthly_table.lookup_remuneration_cents_disregarded',
  });
  const valueRands = lookupAmount.toMinorUnits() / 100n;
  let grossTaxRands;
  let tableRow;
  let method;
  let roundingInput;
  let roundingMode;

  if (valueRands < 4980n) {
    grossTaxRands = 0n;
    tableRow = { lower: 0n, upper: 4979n, representative: 4979n, annualEquivalent: 59748n };
    method = 'sars_monthly_table_zero_range';
    roundingInput = 'published zero range R0-R4979';
    roundingMode = 'sars_published_table_lookup';
  } else if (valueRands <= 226178n) {
    const row = tableRowFor(valueRands, MONTHLY_TABLE_GROUPS);
    if (!row) fail('ZA_INTERNAL_RULE_ERROR', 'Monthly table row could not be resolved');
    const annualEquivalent = row.representative * 12n;
    const annualTaxCents = annualTaxAfterRebatesCents(annualEquivalent, age);
    grossTaxRands = roundHalfDownPositive(annualTaxCents, 1200n);
    tableRow = { ...row, annualEquivalent };
    method = 'sars_monthly_deduction_table';
    roundingInput = `${annualTaxCents.toString()} cents / 12 / 100`;
    roundingMode = 'nearest_rand_ties_down';
  } else {
    const baseByAge = {
      under_65: 85331n,
      '65_to_74': 84517n,
      '75_and_over': 84246n,
    };
    const base = baseByAge[ageBand(age)];
    const excessCents = balanceOfRemuneration.toMinorUnits() - 22607800n;
    grossTaxRands = base + (excessCents * 45n) / 10000n;
    tableRow = {
      lower: 226179n,
      upper: null,
      representative: 226078n,
      annualEquivalent: null,
    };
    method = 'sars_monthly_table_inadequate_45_percent_formula';
    roundingInput = `R${base.toString()} + 45% x (actual remuneration - R226078)`;
    roundingMode = 'truncate';
  }

  const amount = zarWithTableRounding(grossTaxRands, {
    input: roundingInput,
    mode: roundingMode,
    stage: 'za.paye.monthly_table.gross_tax_whole_rand',
  });
  return deepFreeze({
    amount,
    lookupAmount,
    method,
    ageBand: ageBand(age),
    tableRow: {
      lower: tableRow.lower.toString(),
      upper: tableRow.upper === null ? null : tableRow.upper.toString(),
      representative: tableRow.representative.toString(),
      annualEquivalent: tableRow.annualEquivalent === null ? null : tableRow.annualEquivalent.toString(),
    },
    sourceReferences: ['SARS_MONTHLY_TABLE_2027', 'SARS_TAX_DEDUCTION_GUIDE_2027'],
  });
}

function calculateAnnualTableTax(annualEquivalentRands, age) {
  let grossTaxRands;
  let tableRow;
  let method;
  let roundingInput;
  let roundingMode;

  if (annualEquivalentRands < 84299n) {
    grossTaxRands = 0n;
    tableRow = { lower: 0n, upper: 84298n, representative: 84298n };
    method = 'sars_annual_table_zero_range';
    roundingInput = 'published zero range below first annexure row';
    roundingMode = 'sars_published_table_lookup';
  } else if (annualEquivalentRands <= 2103433n) {
    const numericAnnualEquivalent = Number(annualEquivalentRands);
    let low = 0;
    let high = ANNUAL_TABLE_ROWS.length - 1;
    let row = null;
    while (low <= high) {
      const index = Math.floor((low + high) / 2);
      const candidate = ANNUAL_TABLE_ROWS[index];
      if (numericAnnualEquivalent < candidate[0]) high = index - 1;
      else if (numericAnnualEquivalent > candidate[1]) low = index + 1;
      else {
        row = candidate;
        break;
      }
    }
    if (!row) fail('ZA_INTERNAL_RULE_ERROR', 'Official annual table row could not be resolved');
    const taxColumn = age >= 75 ? 4 : (age >= 65 ? 3 : 2);
    grossTaxRands = BigInt(row[taxColumn]);
    tableRow = {
      lower: BigInt(row[0]),
      upper: BigInt(row[1]),
      representative: BigInt(Math.floor((row[0] + row[1]) / 2)),
    };
    method = 'sars_annual_deduction_table';
    roundingInput = `published row R${row[0]}-R${row[1]}, age column ${ageBand(age)}`;
    roundingMode = 'sars_published_table_lookup';
  } else {
    const baseByAge = {
      under_65: 749018n,
      '65_to_74': 739253n,
      '75_and_over': 736004n,
    };
    const base = baseByAge[ageBand(age)];
    const excessRands = annualEquivalentRands - 2101933n;
    grossTaxRands = base + (excessRands * 45n) / 100n;
    tableRow = { lower: 2103434n, upper: null, representative: 2101933n };
    method = 'sars_annual_table_inadequate_45_percent_formula';
    roundingInput = `R${base.toString()} + 45% x (actual annual remuneration - R2101933)`;
    roundingMode = 'truncate';
  }

  return deepFreeze({
    amount: zarWithTableRounding(grossTaxRands, {
      input: roundingInput,
      mode: roundingMode,
      stage: 'za.paye.annual_table.gross_tax_whole_rand',
    }),
    method,
    ageBand: ageBand(age),
    tableRow: {
      lower: tableRow.lower.toString(),
      upper: tableRow.upper === null ? null : tableRow.upper.toString(),
      representative: tableRow.representative.toString(),
    },
    sourceReferences: ['SARS_ANNUAL_TABLE_2027', 'SARS_EMPLOYER_GUIDE_2027'],
  });
}

function medicalCreditForPersons(personsCovered) {
  if (!Number.isSafeInteger(personsCovered) || personsCovered < 0) {
    fail('ZA_INVALID_MEDICAL_COVERAGE', 'medicalScheme.personsCovered must be a non-negative integer');
  }
  if (personsCovered === 0) return 0n;
  if (personsCovered === 1) return MEDICAL_CREDITS.taxpayer;
  return MEDICAL_CREDITS.taxpayer
    + MEDICAL_CREDITS.firstDependent
    + BigInt(personsCovered - 2) * MEDICAL_CREDITS.additional;
}

function validateUnsupported(input) {
  assertPlainObject(input, 'unsupported');
  const keys = new Set([
    'bonusOrAnnualPayment',
    'directorRemuneration',
    'fringeBenefitsOrAllowances',
    'employmentTaxIncentive',
    'foreignOrExpat',
    'disabilityOrAdditionalMedicalCredit',
  ]);
  assertOnlyKeys(input, keys, 'unsupported');
  for (const key of keys) {
    const value = exactBoolean(input[key], `unsupported.${key}`);
    if (value) {
      fail(
        'ZA_UNSUPPORTED_REMUNERATION_CLASS',
        `${key} requires a SARS directive or a rule set outside South Africa 2027 Wave 1`,
        { feature: key }
      );
    }
  }
}

function validateEmployee(input) {
  assertPlainObject(input, 'employee');
  assertOnlyKeys(input, new Set([
    'dateOfBirth',
    'identityType',
    'identityNumber',
    'incomeTaxReferenceNumber',
    'taxResidency',
  ]), 'employee');
  const dob = parseDateOnly(input.dateOfBirth, 'employee.dateOfBirth');
  const assessment = parseDateOnly(ASSESSMENT_DATE, 'assessment date');
  const age = ageOn(dob.date, assessment.date);
  if (age < 15 || age > 100) fail('ZA_INVALID_EMPLOYEE_AGE', 'employee age is outside the supported employment range');
  const identityType = requiredText(input.identityType, 'employee.identityType');
  if (!['south_african_id', 'passport'].includes(identityType)) {
    fail('ZA_INVALID_EMPLOYEE_IDENTITY', 'employee.identityType must be south_african_id or passport');
  }
  const taxResidency = requiredText(input.taxResidency, 'employee.taxResidency');
  if (taxResidency !== 'south_africa_only') {
    fail('ZA_FOREIGN_OR_EXPAT_NOT_SUPPORTED', 'Wave 1 supports only employees certified as South Africa-only tax residents');
  }
  return {
    dateOfBirth: dob.text,
    ageAtAssessmentYearEnd: age,
    ageBand: ageBand(age),
    identityType,
    identityNumber: requiredText(input.identityNumber, 'employee.identityNumber'),
    incomeTaxReferenceNumber: requiredText(input.incomeTaxReferenceNumber, 'employee.incomeTaxReferenceNumber'),
    taxResidency,
  };
}

function validateRemuneration(input) {
  assertPlainObject(input, 'remuneration');
  assertOnlyKeys(input, new Set([
    'ordinaryCashRemuneration',
    'allowableRetirementFundDeduction',
    'balanceOfRemunerationForPaye',
    'uifRemuneration',
    'sdlLeviableAmount',
    'retirementDeductionCertified',
    'retirementFundEvidenceReference',
    'classificationCertified',
    'classificationEvidenceReference',
    'uifClassification',
    'uifClassificationEvidenceReference',
    'hoursWorkedInMonth',
  ]), 'remuneration');

  const ordinary = exactZar(input.ordinaryCashRemuneration, 'remuneration.ordinaryCashRemuneration');
  const retirement = exactZar(input.allowableRetirementFundDeduction, 'remuneration.allowableRetirementFundDeduction');
  const balance = exactZar(input.balanceOfRemunerationForPaye, 'remuneration.balanceOfRemunerationForPaye');
  const uif = exactZar(input.uifRemuneration, 'remuneration.uifRemuneration');
  const sdl = exactZar(input.sdlLeviableAmount, 'remuneration.sdlLeviableAmount');
  if (!ordinary.subtract(retirement).equals(balance)) {
    fail('ZA_PAYE_BASE_MISMATCH', 'ordinary remuneration less the certified allowable retirement deduction must equal the PAYE balance');
  }
  if (!sdl.equals(balance)) {
    fail('ZA_SDL_BASE_MISMATCH', 'ordinary Wave 1 requires the SDL leviable amount to equal the certified balance of remuneration');
  }
  if (uif.decimal.compare(ordinary.decimal) > 0) {
    fail('ZA_UIF_BASE_MISMATCH', 'UIF remuneration cannot exceed ordinary cash remuneration in Wave 1');
  }
  if (exactBoolean(input.retirementDeductionCertified, 'remuneration.retirementDeductionCertified') !== true) {
    fail('ZA_REMUNERATION_EVIDENCE_NOT_VERIFIED', 'The allowable retirement-fund deduction must be certified');
  }
  const retirementFundEvidenceReference = requiredText(
    input.retirementFundEvidenceReference,
    'remuneration.retirementFundEvidenceReference'
  );
  if (exactBoolean(input.classificationCertified, 'remuneration.classificationCertified') !== true) {
    fail('ZA_REMUNERATION_EVIDENCE_NOT_VERIFIED', 'The ordinary-remuneration classification must be certified');
  }
  const classificationEvidenceReference = requiredText(
    input.classificationEvidenceReference,
    'remuneration.classificationEvidenceReference'
  );
  if (requiredText(input.uifClassification, 'remuneration.uifClassification') !== 'covered') {
    fail('ZA_UIF_EXCLUSION_NOT_SUPPORTED', 'Wave 1 requires a certified UIF-covered employee');
  }
  const uifClassificationEvidenceReference = requiredText(
    input.uifClassificationEvidenceReference,
    'remuneration.uifClassificationEvidenceReference'
  );
  const hours = exactZar(input.hoursWorkedInMonth, 'remuneration.hoursWorkedInMonth');
  if (hours.decimal.compare('24') < 0) {
    fail('ZA_UIF_EXCLUSION_NOT_SUPPORTED', 'Employees working fewer than 24 hours in the month require exclusion handling outside Wave 1');
  }

  return {
    ordinary,
    retirement,
    balance,
    uif,
    sdl,
    retirementFundEvidenceReference,
    classificationEvidenceReference,
    uifClassificationEvidenceReference,
  };
}

function validateMedicalScheme(input, age, calculationMethod) {
  assertPlainObject(input, 'medicalScheme');
  assertOnlyKeys(input, new Set([
    'personsCovered',
    'monthlyContributionPaidByTaxpayer',
    'registeredSchemeReference',
    'evidenceReference',
  ]), 'medicalScheme');
  const creditRands = medicalCreditForPersons(input.personsCovered);
  const contribution = exactZar(input.monthlyContributionPaidByTaxpayer, 'medicalScheme.monthlyContributionPaidByTaxpayer');
  if (creditRands > 0n) {
    if (contribution.decimal.compare('0') <= 0) {
      fail('ZA_MEDICAL_EVIDENCE_MISSING', 'A positive contribution is required when medical scheme persons are covered');
    }
    requiredText(input.registeredSchemeReference, 'medicalScheme.registeredSchemeReference', 'ZA_MEDICAL_EVIDENCE_MISSING');
    requiredText(input.evidenceReference, 'medicalScheme.evidenceReference', 'ZA_MEDICAL_EVIDENCE_MISSING');
    if (age >= 65) {
      fail('ZA_ADDITIONAL_MEDICAL_CREDIT_NOT_SUPPORTED', 'Age 65+ medical cases require the additional medical expenses tax credit calculation');
    }
    if (calculationMethod === 'cumulative_annual_equivalent') {
      fail('ZA_CUMULATIVE_MEDICAL_CREDIT_NOT_SUPPORTED', 'Wave 1 cumulative final calculations do not yet aggregate medical-credit months');
    }
  } else if (contribution.decimal.compare('0') !== 0) {
    fail('ZA_MEDICAL_COVERAGE_MISMATCH', 'A medical contribution cannot be supplied with zero persons covered');
  }
  return {
    personsCovered: input.personsCovered,
    contribution,
    credit: zarFromRands(creditRands, 'za.paye.medical_scheme_fee_tax_credit'),
  };
}

function validateEmployer(input) {
  assertPlainObject(input, 'employer');
  assertOnlyKeys(input, new Set([
    'payeRegistrationNumber',
    'payeRegistrationVerified',
    'uifRegistrationNumber',
    'uifRegistrationAuthority',
    'uifRegistrationVerified',
    'registrationEvidenceReference',
    'sdlStatus',
    'sdlRegistrationNumber',
    'sdlRegistrationVerified',
    'anticipatedLeviableRemunerationNext12Months',
    'sdlStatusEvidenceReference',
  ]), 'employer');

  const payeRegistrationNumber = requiredText(input.payeRegistrationNumber, 'employer.payeRegistrationNumber');
  if (exactBoolean(input.payeRegistrationVerified, 'employer.payeRegistrationVerified') !== true) {
    fail('ZA_EMPLOYER_REGISTRATION_NOT_VERIFIED', 'PAYE registration must be verified');
  }
  const uifRegistrationNumber = requiredText(input.uifRegistrationNumber, 'employer.uifRegistrationNumber');
  const uifRegistrationAuthority = requiredText(input.uifRegistrationAuthority, 'employer.uifRegistrationAuthority');
  if (!['SARS', 'UI_COMMISSIONER'].includes(uifRegistrationAuthority)) {
    fail('ZA_EMPLOYER_REGISTRATION_NOT_VERIFIED', 'UIF registration authority must be SARS or UI_COMMISSIONER');
  }
  if (exactBoolean(input.uifRegistrationVerified, 'employer.uifRegistrationVerified') !== true) {
    fail('ZA_EMPLOYER_REGISTRATION_NOT_VERIFIED', 'UIF registration must be verified');
  }
  const registrationEvidenceReference = requiredText(input.registrationEvidenceReference, 'employer.registrationEvidenceReference');
  const anticipated = exactZar(
    input.anticipatedLeviableRemunerationNext12Months,
    'employer.anticipatedLeviableRemunerationNext12Months'
  );
  const sdlStatus = requiredText(input.sdlStatus, 'employer.sdlStatus');
  const sdlStatusEvidenceReference = requiredText(input.sdlStatusEvidenceReference, 'employer.sdlStatusEvidenceReference');
  let sdlRegistrationNumber = '';

  if (sdlStatus === 'liable') {
    if (anticipated.toMinorUnits() <= SDL_THRESHOLD_CENTS) {
      fail('ZA_SDL_STATUS_MISMATCH', 'SDL-liable status requires anticipated leviable remuneration above R500,000');
    }
    sdlRegistrationNumber = requiredText(input.sdlRegistrationNumber, 'employer.sdlRegistrationNumber');
    if (exactBoolean(input.sdlRegistrationVerified, 'employer.sdlRegistrationVerified') !== true) {
      fail('ZA_EMPLOYER_REGISTRATION_NOT_VERIFIED', 'SDL registration must be verified for a liable employer');
    }
  } else if (sdlStatus === 'threshold_exempt') {
    if (anticipated.toMinorUnits() > SDL_THRESHOLD_CENTS) {
      fail('ZA_SDL_STATUS_MISMATCH', 'Threshold exemption requires anticipated leviable remuneration not exceeding R500,000');
    }
    if (input.sdlRegistrationVerified !== false) {
      fail('ZA_SDL_STATUS_MISMATCH', 'Threshold-exempt status must explicitly set sdlRegistrationVerified to false');
    }
    if (String(input.sdlRegistrationNumber || '').trim()) {
      fail('ZA_SDL_STATUS_MISMATCH', 'Threshold-exempt status must not provide an SDL registration number');
    }
  } else {
    fail('ZA_SDL_EXEMPTION_NOT_SUPPORTED', 'Wave 1 supports only SDL-liable employers and the R500,000 threshold exemption');
  }

  return {
    payeRegistrationNumber,
    uifRegistrationNumber,
    uifRegistrationAuthority,
    registrationEvidenceReference,
    sdlStatus,
    sdlRegistrationNumber,
    anticipated,
    sdlStatusEvidenceReference,
  };
}

function calculatePeriodAndDueDate(payDate, businessCalendar) {
  assertPlainObject(businessCalendar, 'businessCalendar');
  assertOnlyKeys(businessCalendar, new Set(['publicHolidays', 'evidenceReference']), 'businessCalendar');
  if (!Array.isArray(businessCalendar.publicHolidays)) {
    fail('ZA_BUSINESS_CALENDAR_EVIDENCE_MISSING', 'businessCalendar.publicHolidays must be an explicit array');
  }
  const evidenceReference = requiredText(
    businessCalendar.evidenceReference,
    'businessCalendar.evidenceReference',
    'ZA_BUSINESS_CALENDAR_EVIDENCE_MISSING'
  );
  const holidays = new Set(businessCalendar.publicHolidays.map((value, index) => (
    parseDateOnly(value, `businessCalendar.publicHolidays[${index}]`).text
  )));
  const year = payDate.date.getUTCFullYear();
  const monthIndex = payDate.date.getUTCMonth();
  const periodStart = new Date(Date.UTC(year, monthIndex, 1));
  const periodEnd = new Date(Date.UTC(year, monthIndex, daysInMonth(year, monthIndex)));
  let dueDate = new Date(Date.UTC(year, monthIndex + 1, 7));
  while (dueDate.getUTCDay() === 0 || dueDate.getUTCDay() === 6 || holidays.has(isoDate(dueDate))) {
    dueDate.setUTCDate(dueDate.getUTCDate() - 1);
  }
  return {
    periodStart: isoDate(periodStart),
    periodEnd: isoDate(periodEnd),
    dueDate: isoDate(dueDate),
    evidenceReference,
  };
}

function calculateCumulativePaye(input, currentBalance, age) {
  assertPlainObject(input, 'cumulative');
  assertOnlyKeys(input, new Set([
    'fullMonthsWorkedIncludingCurrent',
    'balanceOfRemunerationIncludingCurrent',
    'payeWithheldBeforeCurrent',
    'sourceReceiptEvidenceReference',
  ]), 'cumulative');
  const months = input.fullMonthsWorkedIncludingCurrent;
  if (!Number.isSafeInteger(months) || months < 1 || months > 11) {
    fail('ZA_INVALID_CUMULATIVE_PERIOD', 'cumulative.fullMonthsWorkedIncludingCurrent must be an integer from 1 through 11');
  }
  const ytdBalance = exactZar(
    input.balanceOfRemunerationIncludingCurrent,
    'cumulative.balanceOfRemunerationIncludingCurrent'
  );
  const priorPaye = exactZar(input.payeWithheldBeforeCurrent, 'cumulative.payeWithheldBeforeCurrent');
  const evidenceReference = requiredText(
    input.sourceReceiptEvidenceReference,
    'cumulative.sourceReceiptEvidenceReference',
    'ZA_CUMULATIVE_EVIDENCE_MISSING'
  );
  if (ytdBalance.decimal.compare(currentBalance.decimal) < 0) {
    fail('ZA_CUMULATIVE_BASE_MISMATCH', 'Cumulative balance cannot be lower than the current-period balance');
  }

  const annualEquivalentRands = (ytdBalance.toMinorUnits() * 12n) / (BigInt(months) * 100n);
  const annualTable = calculateAnnualTableTax(annualEquivalentRands, age);
  const cumulativeTargetCents = roundHalfUpPositive(
    annualTable.amount.toMinorUnits() * BigInt(months),
    12n
  );
  const cumulativeTarget = zarFromCents(cumulativeTargetCents).round({
    unit: '0.01',
    mode: HALF_UP,
    stage: 'za.paye.cumulative.annual_tax_prorated_to_months',
  });
  if (priorPaye.decimal.compare(cumulativeTarget.decimal) > 0) {
    fail('ZA_CUMULATIVE_OVERWITHHOLDING_REQUIRES_REVIEW', 'Prior PAYE exceeds the cumulative table target; Wave 1 will not create a negative withholding');
  }
  const currentAmount = cumulativeTarget.subtract(priorPaye).round({
    unit: '0.01',
    mode: HALF_UP,
    stage: 'za.paye.cumulative.current_true_up',
  });

  return deepFreeze({
    amount: currentAmount,
    grossTableTax: annualTable.amount,
    medicalCredit: statutoryMoneyService.create('0', ZAR),
    method: 'sars_cumulative_annual_equivalent_final_calculation',
    annualEquivalent: zarFromRands(annualEquivalentRands, 'za.paye.cumulative.annual_equivalent_cents_disregarded', TRUNCATE),
    annualTable,
    cumulativeTarget,
    priorPaye,
    months,
    ytdBalance,
    evidenceReference,
    sourceReferences: ['SARS_EMPLOYER_GUIDE_2027', 'SARS_ANNUAL_TABLE_2027'],
  });
}

function calculateMonthlyPaye(balance, medical, age) {
  const table = calculateMonthlyTablePaye(balance, age);
  const amount = maxZero(table.amount.subtract(medical.credit)).round({
    unit: '1',
    mode: HALF_UP,
    stage: 'za.paye.monthly_table.after_medical_credit_whole_rand',
  });
  return deepFreeze({
    amount,
    grossTableTax: table.amount,
    medicalCredit: medical.credit,
    method: table.method,
    monthlyTable: table,
    sourceReferences: [
      'SARS_MONTHLY_TABLE_2027',
      'SARS_TAX_DEDUCTION_GUIDE_2027',
      'SARS_EMPLOYER_GUIDE_2027',
    ],
  });
}

function calculateUif(uifRemuneration) {
  const baseCents = uifRemuneration.toMinorUnits() < UIF_CEILING_CENTS
    ? uifRemuneration.toMinorUnits()
    : UIF_CEILING_CENTS;
  const base = zarFromCents(baseCents);
  const contribution = base.multiplyByRate('0.01').round({
    unit: '0.01',
    mode: HALF_UP,
    stage: 'za.uif.one_percent_per_side',
  });
  return deepFreeze({
    base,
    employee: contribution,
    employer: contribution,
    rate: '0.01',
    ceiling: zarFromCents(UIF_CEILING_CENTS),
    sourceReferences: ['SARS_UIF', 'SARS_UIF_CEILING'],
  });
}

function calculateSdl(sdlLeviableAmount, employer) {
  const amount = employer.sdlStatus === 'liable'
    ? sdlLeviableAmount.multiplyByRate('0.01').round({
      unit: '0.01',
      mode: HALF_UP,
      stage: 'za.sdl.one_percent_employer_levy',
    })
    : statutoryMoneyService.create('0', ZAR).round({
      unit: '0.01',
      mode: HALF_UP,
      stage: 'za.sdl.threshold_exemption',
    });
  return deepFreeze({
    amount,
    base: sdlLeviableAmount,
    rate: employer.sdlStatus === 'liable' ? '0.01' : '0',
    status: employer.sdlStatus,
    threshold: zarFromCents(SDL_THRESHOLD_CENTS),
    sourceReferences: ['SARS_SDL', 'SARS_SDL_EMPLOYER_GUIDE', 'SARS_EMPLOYER_GUIDE_2027'],
  });
}

function createLiability({
  code,
  name,
  payer,
  amount,
  baseAmount,
  rate,
  period,
  calculationMethod,
  roundingStage,
  sourceReferences,
  sourceEffectiveFrom,
  evidenceReference,
  employer,
  metadata,
}) {
  return statutoryLiabilityLedgerService.createEntry({
    liabilityCode: code,
    name,
    payer,
    amount,
    baseAmount,
    rate,
    authority: {
      code: 'SARS',
      name: 'South African Revenue Service',
      level: 'national',
      jurisdictionCode: 'ZA',
    },
    remittance: {
      formCode: 'EMP201',
      frequency: 'monthly',
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      dueDate: period.dueDate,
      paymentChannel: 'eFiling, e@syFile Employer, or approved electronic payment channel',
      accountReferenceField: employer.payeRegistrationNumber,
    },
    calculation: { method: calculationMethod, roundingStage },
    sourceReferences,
    sourceEffectiveFrom,
    evidenceReference,
    metadata: {
      assessmentYear: 2027,
      previewOnly: true,
      postingAllowed: false,
      ...metadata,
    },
  }, ZAR);
}

function serializeMonthlyTable(table) {
  return {
    ...table,
    amount: serializeMoney(table.amount),
    lookupAmount: serializeMoney(table.lookupAmount),
  };
}

function serializeAnnualTable(table) {
  return {
    ...table,
    amount: serializeMoney(table.amount),
  };
}

function serializePaye(paye, calculationMethod) {
  if (calculationMethod === 'monthly_table') {
    return {
      ...paye,
      amount: serializeMoney(paye.amount),
      grossTableTax: serializeMoney(paye.grossTableTax),
      medicalCredit: serializeMoney(paye.medicalCredit),
      monthlyTable: serializeMonthlyTable(paye.monthlyTable),
    };
  }
  return {
    ...paye,
    amount: serializeMoney(paye.amount),
    grossTableTax: serializeMoney(paye.grossTableTax),
    medicalCredit: serializeMoney(paye.medicalCredit),
    annualEquivalent: serializeMoney(paye.annualEquivalent),
    annualTable: serializeAnnualTable(paye.annualTable),
    cumulativeTarget: serializeMoney(paye.cumulativeTarget),
    priorPaye: serializeMoney(paye.priorPaye),
    ytdBalance: serializeMoney(paye.ytdBalance),
  };
}

function calculate(input = {}) {
  assertPlainObject(input, 'input');
  assertOnlyKeys(input, TOP_LEVEL_KEYS, 'input');
  const payDate = parseDateOnly(input.payDate, 'payDate');
  if (payDate.text < EFFECTIVE_FROM || payDate.text > EFFECTIVE_TO) {
    fail('ZA_OUTSIDE_2027_ASSESSMENT_YEAR', `payDate must be from ${EFFECTIVE_FROM} through ${EFFECTIVE_TO}`);
  }
  if (input.payFrequency !== 'monthly') {
    fail('ZA_PAY_FREQUENCY_NOT_SUPPORTED', 'South Africa 2027 Wave 1 supports monthly payroll only');
  }
  const calculationMethod = input.calculationMethod || 'monthly_table';
  if (!['monthly_table', 'cumulative_annual_equivalent'].includes(calculationMethod)) {
    fail('ZA_CALCULATION_METHOD_NOT_SUPPORTED', 'calculationMethod must be monthly_table or cumulative_annual_equivalent');
  }

  validateUnsupported(input.unsupported);
  const employee = validateEmployee(input.employee);
  const remuneration = validateRemuneration(input.remuneration);
  const medical = validateMedicalScheme(input.medicalScheme, employee.ageAtAssessmentYearEnd, calculationMethod);
  const employer = validateEmployer(input.employer);
  const period = calculatePeriodAndDueDate(payDate, input.businessCalendar);

  const paye = calculationMethod === 'monthly_table'
    ? calculateMonthlyPaye(remuneration.balance, medical, employee.ageAtAssessmentYearEnd)
    : calculateCumulativePaye(input.cumulative, remuneration.balance, employee.ageAtAssessmentYearEnd);
  if (calculationMethod === 'monthly_table' && input.cumulative !== null && input.cumulative !== undefined) {
    fail('ZA_UNSUPPORTED_INPUT', 'cumulative must be omitted for monthly_table calculations');
  }
  const uif = calculateUif(remuneration.uif);
  const sdl = calculateSdl(remuneration.sdl, employer);

  const liabilities = [
    createLiability({
      code: 'ZA_PAYE_EMPLOYEE',
      name: 'Pay As You Earn (employee withholding)',
      payer: 'employee',
      amount: paye.amount,
      baseAmount: remuneration.balance,
      rate: '',
      period,
      calculationMethod: paye.method,
      roundingStage: calculationMethod === 'monthly_table'
        ? 'za.paye.monthly_table.after_medical_credit_whole_rand'
        : 'za.paye.cumulative.current_true_up',
      sourceReferences: paye.sourceReferences,
      sourceEffectiveFrom: EFFECTIVE_FROM,
      evidenceReference: remuneration.classificationEvidenceReference,
      employer,
      metadata: { irp5Code: '4102', calculationMethod },
    }),
    createLiability({
      code: 'ZA_UIF_EMPLOYEE',
      name: 'Unemployment Insurance Fund contribution (employee)',
      payer: 'employee',
      amount: uif.employee,
      baseAmount: uif.base,
      rate: uif.rate,
      period,
      calculationMethod: 'one_percent_of_uif_remuneration_subject_to_monthly_ceiling',
      roundingStage: 'za.uif.one_percent_per_side',
      sourceReferences: uif.sourceReferences,
      sourceEffectiveFrom: '2021-06-01',
      evidenceReference: remuneration.uifClassificationEvidenceReference,
      employer,
      metadata: { irp5Code: '4141', contributionSide: 'employee' },
    }),
    createLiability({
      code: 'ZA_UIF_EMPLOYER',
      name: 'Unemployment Insurance Fund contribution (employer)',
      payer: 'employer',
      amount: uif.employer,
      baseAmount: uif.base,
      rate: uif.rate,
      period,
      calculationMethod: 'one_percent_of_uif_remuneration_subject_to_monthly_ceiling',
      roundingStage: 'za.uif.one_percent_per_side',
      sourceReferences: uif.sourceReferences,
      sourceEffectiveFrom: '2021-06-01',
      evidenceReference: remuneration.uifClassificationEvidenceReference,
      employer,
      metadata: { irp5Code: '4141', contributionSide: 'employer' },
    }),
    createLiability({
      code: 'ZA_SDL_EMPLOYER',
      name: 'Skills Development Levy (employer)',
      payer: 'employer',
      amount: sdl.amount,
      baseAmount: sdl.base,
      rate: sdl.rate,
      period,
      calculationMethod: employer.sdlStatus === 'liable'
        ? 'one_percent_of_sdl_leviable_amount'
        : 'next_12_month_leviable_amount_threshold_exemption',
      roundingStage: employer.sdlStatus === 'liable'
        ? 'za.sdl.one_percent_employer_levy'
        : 'za.sdl.threshold_exemption',
      sourceReferences: sdl.sourceReferences,
      sourceEffectiveFrom: '2001-04-01',
      evidenceReference: employer.sdlStatusEvidenceReference,
      employer,
      metadata: { irp5Code: '4142', sdlStatus: employer.sdlStatus },
    }),
  ];
  const liabilityLedger = statutoryLiabilityLedgerService.buildLedger(liabilities);

  return deepFreeze({
    adapter: {
      code: 'ZA_2027_YOA_WAVE1_STANDALONE',
      jurisdictionCode: 'ZA',
      currency: 'ZAR',
      assessmentYear: 2027,
      effectiveFrom: EFFECTIVE_FROM,
      effectiveTo: EFFECTIVE_TO,
      integrationStatus: 'standalone_not_integrated',
      releaseStatus: 'preview_only_pending_credentialed_review',
      runnable: false,
      postingAllowed: false,
      sourceSnapshotAsOf: '2026-08-09',
    },
    releaseBlockingReasons: [
      {
        code: 'ZA_CREDENTIALLED_TAX_LAW_REVIEW_REQUIRED',
        role: 'tax_law',
        jurisdiction: 'ZA',
      },
      {
        code: 'ZA_CREDENTIALLED_PAYROLL_QA_REVIEW_REQUIRED',
        role: 'payroll_operations',
        jurisdiction: 'ZA',
      },
    ],
    payDate: payDate.text,
    period,
    employee,
    remuneration: {
      ordinaryCashRemuneration: serializeMoney(remuneration.ordinary),
      allowableRetirementFundDeduction: serializeMoney(remuneration.retirement),
      balanceOfRemunerationForPaye: serializeMoney(remuneration.balance),
      uifRemuneration: serializeMoney(remuneration.uif),
      sdlLeviableAmount: serializeMoney(remuneration.sdl),
    },
    paye: serializePaye(paye, calculationMethod),
    medicalScheme: {
      ...medical,
      contribution: serializeMoney(medical.contribution),
      credit: serializeMoney(medical.credit),
    },
    uif: {
      ...uif,
      base: serializeMoney(uif.base),
      employee: serializeMoney(uif.employee),
      employer: serializeMoney(uif.employer),
      ceiling: serializeMoney(uif.ceiling),
    },
    sdl: {
      ...sdl,
      amount: serializeMoney(sdl.amount),
      base: serializeMoney(sdl.base),
      threshold: serializeMoney(sdl.threshold),
    },
    employer: {
      payeRegistrationNumber: employer.payeRegistrationNumber,
      uifRegistrationNumber: employer.uifRegistrationNumber,
      uifRegistrationAuthority: employer.uifRegistrationAuthority,
      sdlStatus: employer.sdlStatus,
      sdlRegistrationNumber: employer.sdlRegistrationNumber,
      anticipatedLeviableRemunerationNext12Months: serializeMoney(employer.anticipated),
    },
    liabilityLedger,
    totals: {
      employeeStatutoryLiabilities: liabilityLedger.employeeTotal,
      employerStatutoryCost: liabilityLedger.employerTotal,
      combinedStatutoryLiabilities: liabilityLedger.combinedTotal,
    },
    officialSources: OFFICIAL_SOURCES,
  });
}

module.exports = {
  calculate,
  calculateMonthlyTablePaye,
  calculateAnnualTableTax,
  calculateUif,
  OFFICIAL_SOURCES,
  SouthAfricaPayrollAdapterError,
};
