'use strict';

/**
 * Standalone Kenya monthly payroll calculator for the 2026 calendar year.
 *
 * This adapter is deliberately not registered with TaxJurisdictionService. It
 * accepts an explicit, evidence-bearing input contract and fails closed for
 * benefits, reimbursements, exemptions, or reliefs that it cannot value from
 * the data supplied by the caller.
 */

const statutoryMoneyService = require('../StatutoryMoneyService');
const statutoryLiabilityLedgerService = require('../StatutoryLiabilityLedgerService');
const { ROUNDING_MODES } = require('../StatutoryMoneyService');

const MONEY = Object.freeze({ currency: 'KES', minorUnits: 2 });
const HALF_UP = ROUNDING_MODES.HALF_UP;

const OFFICIAL_SOURCES = deepFreeze({
  KRA_PAYE_CURRENT: {
    authority: 'Kenya Revenue Authority',
    title: 'Pay As You Earn (PAYE)',
    url: 'https://www.kra.go.ke/individual/filing-paying/types-of-taxes/paye',
    effectiveFrom: '2023-07-01',
    supports: [
      'monthly PAYE bands',
      'KES 2,400 resident personal relief',
      '15% insurance relief capped at KES 60,000 annually',
      'AHL and SHIF PAYE deductions',
      'PAYE filing and payment by the ninth day of the following month',
    ],
  },
  KRA_EMPLOYER_EVIDENCE_GUIDANCE_2025: {
    authority: 'Kenya Revenue Authority',
    title: 'Guidance on Employer Obligations in Applying Income Tax Deductions, Reliefs and Exemptions',
    url: 'https://www.kra.go.ke/news-center/public-notices/2307-guidance-on-employer-obligations-in-applying-income-tax-deductions%2C-reliefs-and-exemptions',
    effectiveFrom: '2025-10-06',
    supports: ['employer application of documented deductions, reliefs, and exemptions'],
  },
  KENYA_INCOME_TAX_ACT_2026: {
    authority: 'National Council for Law Reporting (Kenya Law)',
    title: 'Income Tax Act, Cap. 470 — version dated 1 January 2026',
    url: 'https://new.kenyalaw.org/akn/ke/act/1973/16/eng%402026-01-01',
    effectiveFrom: '2026-01-01',
    supports: [
      'section 22A registered-pension deduction limits',
      '30% of pensionable-income limit',
      'KES 360,000 annual / KES 30,000 part-month limit',
      'section 31 resident insurance relief eligibility and evidence',
    ],
  },
  KRA_PAYE_EMPLOYERS_GUIDE_AGGREGATE: {
    authority: 'Kenya Revenue Authority',
    title: "Employer's Guide to PAYE in Kenya",
    url: 'https://www.kra.go.ke/images/publications/PAYE_Guide-2.pdf',
    effectiveFrom: '2017-01-01',
    supports: ['KRA administration position that NSSF and registered-fund employee deductions share an aggregate monthly ceiling'],
    caveat: 'The guide contains the former KES 20,000 ceiling; this adapter takes only the aggregation rule from the guide and the current KES 30,000 ceiling from the 2026 Income Tax Act/KRA current PAYE page.',
  },
  KRA_NSSF_CALCULATOR_2026: {
    authority: 'Kenya Revenue Authority',
    title: 'NSSF Calculator',
    url: 'https://ecitizen.kra.go.ke/calculators/nssf-calculator',
    effectiveFrom: '2026-02-01',
    supports: [
      'Year 3 LEL KES 8,000 and UEL KES 72,000',
      'Year 4 LEL KES 9,000 and UEL KES 108,000',
      '6% employee and 6% employer rates',
      'NSSF as a pre-tax deduction',
    ],
  },
  NSSF_YEAR_4_NOTICE_2026: {
    authority: 'National Social Security Fund',
    title: 'Notice to Employers — Year 4 (2026) NSSF Contribution Rates',
    url: 'https://www.nssf.or.ke/notice-to-employers-year-4-2026-nssf-contribution-rates',
    effectiveFrom: '2026-02-01',
    supports: ['Year 4 rates effective February 2026'],
  },
  KENYA_NSSF_ACT: {
    authority: 'National Council for Law Reporting (Kenya Law)',
    title: 'National Social Security Fund Act, Cap. 258',
    url: 'https://new.kenyalaw.org/akn/ke/act/2013/45/eng%402022-12-31',
    effectiveFrom: '2014-01-10',
    supports: [
      'mandatory Pension Fund membership from age 18 until age 60',
      '6% employee and employer contributions',
      'Tier I and Tier II',
      'Tier I remains payable to NSSF when Tier II is contracted out',
      'monthly contribution due date',
    ],
  },
  KENYA_NSSF_CONTRACTING_OUT_REGULATIONS: {
    authority: 'National Council for Law Reporting (Kenya Law)',
    title: 'National Social Security Fund (Contracting Out by Employers) Regulations, 2014',
    url: 'https://new.kenyalaw.org/akn/ke/act/ln/2014/85',
    effectiveFrom: '2014-06-20',
    supports: [
      'in-force contracting-out certificate requirement',
      'employee and employer Tier II minimum-payment routing',
      'approved contracted-out scheme evidence',
    ],
  },
  KENYA_AFFORDABLE_HOUSING_ACT: {
    authority: 'National Council for Law Reporting (Kenya Law)',
    title: 'Affordable Housing Act, 2024',
    url: 'https://new.kenyalaw.org/akn/ke/act/2024/2/eng%402024-03-21',
    effectiveFrom: '2024-03-19',
    supports: [
      '1.5% employee levy',
      '1.5% matching employer levy',
      'remittance by the ninth working day after month end',
    ],
  },
  KENYA_SHIF_REGULATIONS: {
    authority: 'National Council for Law Reporting (Kenya Law)',
    title: 'Social Health Insurance Regulations, 2024',
    url: 'https://new.kenyalaw.org/akn/ke/act/ln/2024/49/eng%402025-02-28',
    effectiveFrom: '2024-10-01',
    supports: ['2.75% of gross salary or wage', 'KES 300 monthly minimum', 'remittance by the ninth day'],
  },
  KENYA_INDUSTRIAL_TRAINING_ACT_2024: {
    authority: 'National Council for Law Reporting (Kenya Law)',
    title: 'Industrial Training Act, Cap. 237 — version dated 26 April 2024',
    url: 'https://new.kenyalaw.org/akn/ke/act/1959/48/eng%402024-04-26',
    effectiveFrom: '2024-04-26',
    supports: [
      'employer-only training levy',
      'payment when salary is payable',
      'remittance to the Commissioner-General by the ninth day of the following month',
    ],
  },
  NITA_OPERATIONAL_GUIDANCE: {
    authority: 'National Industrial Training Authority',
    title: 'Levy Inspectorate',
    url: 'https://www.nita.go.ke/our-services/levy-inspectorate.html',
    effectiveFrom: '2020-02-28',
    supports: ['KES 50 per employee per month', 'employer-only levy'],
    conflict: 'The page still states last-working-day payment; the 2024 Industrial Training Act states the ninth day of the following month.',
  },
  KENYA_PWD_EXEMPTION_ORDER: {
    authority: 'National Council for Law Reporting (Kenya Law)',
    title: 'Persons with Disabilities (Income Tax Deductions and Exemptions) Order, 2010',
    url: 'https://new.kenyalaw.org/akn/ke/act/ln/2010/36/eng%402022-12-31',
    effectiveFrom: '2010-04-01',
    supports: ['income-tax exemption on the first KES 150,000 of total monthly income', 'certificate requirement'],
  },
  KRA_PWD_CERTIFICATE_GUIDANCE: {
    authority: 'Kenya Revenue Authority',
    title: 'Getting an Exemption Certificate',
    url: 'https://www.kra.go.ke/individual/special-needs/people-with-disability/people-with-disability/129-getting-an-exemption-certificate',
    effectiveFrom: '2025-05-27',
    supports: ['NCPWD registration', 'KRA certificate issuance and verification', 'current five-year operational validity guidance'],
  },
});

const PAYE_BANDS = deepFreeze([
  { code: 'BAND_1', width: '24000.00', rate: '0.10' },
  { code: 'BAND_2', width: '8333.00', rate: '0.25' },
  { code: 'BAND_3', width: '467667.00', rate: '0.30' },
  { code: 'BAND_4', width: '300000.00', rate: '0.325' },
  { code: 'BAND_5', width: null, rate: '0.35' },
]);

const NSSF_SCHEDULES = deepFreeze({
  YEAR_3_JANUARY_2026: {
    code: 'YEAR_3',
    effectiveFrom: '2025-02-01',
    effectiveTo: '2026-01-31',
    lowerEarningsLimit: '8000.00',
    upperEarningsLimit: '72000.00',
    rate: '0.06',
    sourceReferences: ['KRA_NSSF_CALCULATOR_2026', 'KENYA_NSSF_ACT'],
  },
  YEAR_4_FROM_FEBRUARY_2026: {
    code: 'YEAR_4',
    effectiveFrom: '2026-02-01',
    effectiveTo: '2026-12-31',
    lowerEarningsLimit: '9000.00',
    upperEarningsLimit: '108000.00',
    rate: '0.06',
    sourceReferences: ['NSSF_YEAR_4_NOTICE_2026', 'KRA_NSSF_CALCULATOR_2026', 'KENYA_NSSF_ACT'],
  },
});

const TOP_LEVEL_KEYS = new Set([
  'payDate',
  'grossCashPay',
  'residencyStatus',
  'dateOfBirth',
  'nssfPensionableEarnings',
  'pensionableIncomeForTax',
  'employeeRegisteredPension',
  'insuranceRelief',
  'pwdTaxExemption',
  'nssf',
  'nita',
  'businessCalendar',
  'benefits',
  'reimbursements',
]);

class KenyaPayrollAdapterError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'KenyaPayrollAdapterError';
    this.code = code;
    this.details = details;
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function fail(code, message, details) {
  throw new KenyaPayrollAdapterError(code, message, details);
}

function requiredText(value, label, code = 'KENYA_REQUIRED_EVIDENCE_MISSING') {
  const normalized = String(value || '').trim();
  if (!normalized) fail(code, `${label} is required`);
  return normalized;
}

function assertPlainObject(value, label, code = 'KENYA_INVALID_INPUT') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(code, `${label} must be an object`);
  }
}

function assertOnlyKeys(value, allowedKeys, label) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      fail('KENYA_UNSUPPORTED_INPUT', `${label}.${key} is not supported by the Kenya 2026 standalone adapter`, {
        path: `${label}.${key}`,
      });
    }
  }
}

function parseDateOnly(value, label) {
  const normalized = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    fail('KENYA_INVALID_DATE', `${label} must use YYYY-MM-DD`);
  }
  const [year, month, day] = normalized.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    fail('KENYA_INVALID_DATE', `${label} is not a valid calendar date`);
  }
  return { text: normalized, date };
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function monthPeriod(payDate) {
  const year = payDate.getUTCFullYear();
  const month = payDate.getUTCMonth();
  return {
    start: new Date(Date.UTC(year, month, 1)),
    end: new Date(Date.UTC(year, month + 1, 0)),
  };
}

function ninthOfFollowingMonth(periodEnd) {
  return new Date(Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth() + 1, 9));
}

function addWorkingDaysAfter(date, count, publicHolidays) {
  const cursor = new Date(date.getTime());
  let included = 0;
  while (included < count) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day === 0 || day === 6 || publicHolidays.has(isoDate(cursor))) continue;
    included += 1;
  }
  return cursor;
}

function ageOn(dateOfBirth, onDate) {
  let age = onDate.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const beforeBirthday = onDate.getUTCMonth() < dateOfBirth.getUTCMonth()
    || (onDate.getUTCMonth() === dateOfBirth.getUTCMonth()
      && onDate.getUTCDate() < dateOfBirth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

function addUtcYears(date, years) {
  const target = new Date(Date.UTC(
    date.getUTCFullYear() + years,
    date.getUTCMonth(),
    date.getUTCDate()
  ));
  if (target.getUTCMonth() !== date.getUTCMonth()) {
    return new Date(Date.UTC(date.getUTCFullYear() + years, date.getUTCMonth() + 1, 0));
  }
  return target;
}

function inputMoney(value, label) {
  let amount;
  try {
    amount = statutoryMoneyService.create(value, MONEY);
    amount.toMinorUnits();
  } catch (error) {
    fail('KENYA_INVALID_MONEY', `${label} must be a non-negative KES amount with at most two decimal places`, {
      cause: error.message,
    });
  }
  if (amount.decimal.compare('0') < 0) {
    fail('KENYA_INVALID_MONEY', `${label} cannot be negative`);
  }
  return amount;
}

function zeroMoney() {
  return statutoryMoneyService.create('0.00', MONEY);
}

function fixedMoney(value) {
  return statutoryMoneyService.create(value, MONEY);
}

function minMoney(...values) {
  return values.reduce((minimum, value) => (
    value.decimal.compare(minimum.decimal) < 0 ? value : minimum
  ));
}

function maxZero(value) {
  return value.decimal.compare('0') < 0 ? zeroMoney() : value;
}

function roundedRate(amount, rate, stage) {
  return amount.multiplyByRate(rate).roundToMinorUnit({ mode: HALF_UP, stage });
}

function roundedAmount(amount, stage) {
  return amount.roundToMinorUnit({ mode: HALF_UP, stage });
}

function serializeMoney(amount) {
  return {
    amount: amount.toFixed(),
    currency: MONEY.currency,
    minorUnits: MONEY.minorUnits,
    roundingHistory: amount.roundingHistory.map((event) => ({ ...event })),
  };
}

function normalizeBusinessCalendar(value) {
  assertPlainObject(value, 'businessCalendar', 'KENYA_BUSINESS_CALENDAR_REQUIRED');
  assertOnlyKeys(value, new Set(['publicHolidays', 'evidenceReference']), 'businessCalendar');
  if (!Array.isArray(value.publicHolidays)) {
    fail('KENYA_BUSINESS_CALENDAR_REQUIRED', 'businessCalendar.publicHolidays must be an explicit array');
  }
  const evidenceReference = requiredText(
    value.evidenceReference,
    'businessCalendar.evidenceReference',
    'KENYA_BUSINESS_CALENDAR_REQUIRED'
  );
  const publicHolidays = new Set(value.publicHolidays.map((holiday, index) => (
    parseDateOnly(holiday, `businessCalendar.publicHolidays[${index}]`).text
  )));
  return { publicHolidays, evidenceReference };
}

function normalizeRegisteredPension(value) {
  assertPlainObject(value, 'employeeRegisteredPension');
  assertOnlyKeys(
    value,
    new Set(['employeeContribution', 'registeredSchemeReference', 'evidenceReference']),
    'employeeRegisteredPension'
  );
  const contribution = inputMoney(value.employeeContribution, 'employeeRegisteredPension.employeeContribution');
  let registeredSchemeReference = '';
  let evidenceReference = '';
  if (contribution.decimal.compare('0') > 0) {
    registeredSchemeReference = requiredText(
      value.registeredSchemeReference,
      'employeeRegisteredPension.registeredSchemeReference'
    );
    evidenceReference = requiredText(
      value.evidenceReference,
      'employeeRegisteredPension.evidenceReference'
    );
  }
  return { contribution, registeredSchemeReference, evidenceReference };
}

function normalizeInsuranceRelief(value, residencyStatus, payDate) {
  assertPlainObject(value, 'insuranceRelief');
  assertOnlyKeys(value, new Set([
    'monthlyPremiumPaid',
    'policyType',
    'policyStartDate',
    'policyMaturityDate',
    'insuredRelationship',
    'insuredChildDateOfBirth',
    'benefitsPayableInKenyaShillings',
    'policyEvidenceReference',
    'insurerLicenceEvidenceReference',
  ]), 'insuranceRelief');

  const premium = inputMoney(value.monthlyPremiumPaid, 'insuranceRelief.monthlyPremiumPaid');
  if (premium.decimal.compare('0') === 0) {
    return { premium, relief: zeroMoney(), evidenceReference: '', policyType: '' };
  }
  if (residencyStatus !== 'resident') {
    fail('KENYA_RELIEF_NOT_AVAILABLE_TO_NON_RESIDENT', 'Insurance relief is available only to resident individuals');
  }

  const policyType = requiredText(value.policyType, 'insuranceRelief.policyType').toLowerCase();
  if (!new Set(['life', 'health', 'education']).has(policyType)) {
    fail('KENYA_UNSUPPORTED_INSURANCE_POLICY', `Unsupported insurance policy type "${policyType}"`);
  }
  const relationship = requiredText(value.insuredRelationship, 'insuranceRelief.insuredRelationship').toLowerCase();
  if (!new Set(['self', 'spouse', 'child']).has(relationship)) {
    fail('KENYA_UNSUPPORTED_INSURANCE_POLICY', 'insuredRelationship must be self, spouse, or child');
  }
  const policyStart = parseDateOnly(value.policyStartDate, 'insuranceRelief.policyStartDate');
  if (policyStart.date > payDate) {
    fail('KENYA_INSURANCE_POLICY_INACTIVE', 'The insurance policy starts after the payroll date');
  }
  const earliestStart = policyType === 'health' ? '2007-01-01' : '2003-01-01';
  if (policyStart.text < earliestStart) {
    fail('KENYA_UNSUPPORTED_INSURANCE_POLICY', `${policyType} policy start date predates the statutory eligibility date`);
  }
  if (policyType === 'education') {
    const maturity = parseDateOnly(value.policyMaturityDate, 'insuranceRelief.policyMaturityDate');
    if (maturity.date < addUtcYears(policyStart.date, 10)) {
      fail('KENYA_UNSUPPORTED_INSURANCE_POLICY', 'An education policy must have a maturity period of at least ten years');
    }
  }
  if (relationship === 'child') {
    const childBirth = parseDateOnly(value.insuredChildDateOfBirth, 'insuranceRelief.insuredChildDateOfBirth');
    if (ageOn(childBirth.date, payDate) >= 18) {
      fail('KENYA_UNSUPPORTED_INSURANCE_POLICY', 'The insured child must be under age 18 when the premium is paid');
    }
  }
  if (value.benefitsPayableInKenyaShillings !== true) {
    fail('KENYA_INSURANCE_EVIDENCE_REQUIRED', 'Insurance benefits payable in Kenya shillings must be explicitly confirmed');
  }
  const policyEvidenceReference = requiredText(
    value.policyEvidenceReference,
    'insuranceRelief.policyEvidenceReference',
    'KENYA_INSURANCE_EVIDENCE_REQUIRED'
  );
  requiredText(
    value.insurerLicenceEvidenceReference,
    'insuranceRelief.insurerLicenceEvidenceReference',
    'KENYA_INSURANCE_EVIDENCE_REQUIRED'
  );

  const rawRelief = premium.multiplyByRate('0.15');
  const relief = roundedAmount(
    minMoney(rawRelief, fixedMoney('5000.00')),
    'ke.paye.insurance_relief.final'
  );
  return { premium, relief, evidenceReference: policyEvidenceReference, policyType };
}

function normalizePwdExemption(value, residencyStatus, payDate) {
  if (value === null) {
    return { applied: false, exemption: zeroMoney(), evidenceReference: '', certificateNumber: '' };
  }
  assertPlainObject(value, 'pwdTaxExemption', 'KENYA_PWD_EVIDENCE_REQUIRED');
  assertOnlyKeys(value, new Set([
    'certificateNumber',
    'ncpwdRegistrationNumber',
    'effectiveFrom',
    'effectiveTo',
    'kraVerificationReference',
  ]), 'pwdTaxExemption');
  if (residencyStatus !== 'resident') {
    fail('KENYA_PWD_SCOPE_UNSUPPORTED', 'This adapter supports PWD PAYE exemption only for resident employees');
  }
  const certificateNumber = requiredText(
    value.certificateNumber,
    'pwdTaxExemption.certificateNumber',
    'KENYA_PWD_EVIDENCE_REQUIRED'
  );
  requiredText(
    value.ncpwdRegistrationNumber,
    'pwdTaxExemption.ncpwdRegistrationNumber',
    'KENYA_PWD_EVIDENCE_REQUIRED'
  );
  const effectiveFrom = parseDateOnly(value.effectiveFrom, 'pwdTaxExemption.effectiveFrom');
  const effectiveTo = parseDateOnly(value.effectiveTo, 'pwdTaxExemption.effectiveTo');
  if (effectiveFrom.date > effectiveTo.date) {
    fail('KENYA_PWD_CERTIFICATE_INACTIVE', 'PWD certificate effectiveFrom cannot be after effectiveTo');
  }
  if (payDate < effectiveFrom.date || payDate > effectiveTo.date) {
    fail('KENYA_PWD_CERTIFICATE_INACTIVE', 'PWD certificate is not in force on the payroll date', {
      effectiveFrom: effectiveFrom.text,
      effectiveTo: effectiveTo.text,
    });
  }
  const evidenceReference = requiredText(
    value.kraVerificationReference,
    'pwdTaxExemption.kraVerificationReference',
    'KENYA_PWD_EVIDENCE_REQUIRED'
  );
  return { applied: true, evidenceReference, certificateNumber };
}

function normalizeContractingOut(value, payDate) {
  assertPlainObject(value, 'nssf');
  assertOnlyKeys(value, new Set(['contractedOutTierII', 'contractedOutScheme']), 'nssf');
  if (typeof value.contractedOutTierII !== 'boolean') {
    fail('KENYA_NSSF_CONTRACT_STATUS_REQUIRED', 'nssf.contractedOutTierII must be explicitly true or false');
  }
  if (!value.contractedOutTierII) {
    if (value.contractedOutScheme !== undefined && value.contractedOutScheme !== null) {
      fail('KENYA_UNSUPPORTED_INPUT', 'nssf.contractedOutScheme must be null or omitted when Tier II is not contracted out');
    }
    return { contractedOut: false, evidenceReference: '', schemeName: '', certificateNumber: '' };
  }

  const scheme = value.contractedOutScheme;
  assertPlainObject(scheme, 'nssf.contractedOutScheme', 'KENYA_NSSF_CONTRACT_EVIDENCE_REQUIRED');
  assertOnlyKeys(scheme, new Set([
    'schemeName',
    'schemeRegistrationReference',
    'contractingOutCertificateNumber',
    'certificateEffectiveFrom',
    'certificateEffectiveTo',
    'authorityApprovalReference',
  ]), 'nssf.contractedOutScheme');
  const schemeName = requiredText(
    scheme.schemeName,
    'nssf.contractedOutScheme.schemeName',
    'KENYA_NSSF_CONTRACT_EVIDENCE_REQUIRED'
  );
  requiredText(
    scheme.schemeRegistrationReference,
    'nssf.contractedOutScheme.schemeRegistrationReference',
    'KENYA_NSSF_CONTRACT_EVIDENCE_REQUIRED'
  );
  const certificateNumber = requiredText(
    scheme.contractingOutCertificateNumber,
    'nssf.contractedOutScheme.contractingOutCertificateNumber',
    'KENYA_NSSF_CONTRACT_EVIDENCE_REQUIRED'
  );
  const effectiveFrom = parseDateOnly(
    scheme.certificateEffectiveFrom,
    'nssf.contractedOutScheme.certificateEffectiveFrom'
  );
  const effectiveTo = parseDateOnly(
    scheme.certificateEffectiveTo,
    'nssf.contractedOutScheme.certificateEffectiveTo'
  );
  if (effectiveFrom.date > effectiveTo.date || payDate < effectiveFrom.date || payDate > effectiveTo.date) {
    fail('KENYA_NSSF_CONTRACT_CERTIFICATE_INACTIVE', 'The Tier II contracting-out certificate is not in force on the payroll date');
  }
  const evidenceReference = requiredText(
    scheme.authorityApprovalReference,
    'nssf.contractedOutScheme.authorityApprovalReference',
    'KENYA_NSSF_CONTRACT_EVIDENCE_REQUIRED'
  );
  return { contractedOut: true, evidenceReference, schemeName, certificateNumber };
}

function normalizeNita(value, payDate) {
  assertPlainObject(value, 'nita', 'KENYA_NITA_STATUS_REQUIRED');
  assertOnlyKeys(value, new Set(['applicable', 'exemptionReference', 'effectiveFrom', 'effectiveTo']), 'nita');
  if (typeof value.applicable !== 'boolean') {
    fail('KENYA_NITA_STATUS_REQUIRED', 'nita.applicable must be explicitly true or false');
  }
  if (value.applicable) return { amount: fixedMoney('50.00'), evidenceReference: '', exempt: false };

  const exemptionReference = requiredText(
    value.exemptionReference,
    'nita.exemptionReference',
    'KENYA_NITA_EXEMPTION_EVIDENCE_REQUIRED'
  );
  const effectiveFrom = parseDateOnly(value.effectiveFrom, 'nita.effectiveFrom');
  const effectiveTo = parseDateOnly(value.effectiveTo, 'nita.effectiveTo');
  if (effectiveFrom.date > effectiveTo.date || payDate < effectiveFrom.date || payDate > effectiveTo.date) {
    fail('KENYA_NITA_EXEMPTION_INACTIVE', 'The NITA exemption evidence is not in force on the payroll date');
  }
  return { amount: zeroMoney(), evidenceReference: exemptionReference, exempt: true };
}

function nssfScheduleFor(payDateText) {
  return payDateText <= '2026-01-31'
    ? NSSF_SCHEDULES.YEAR_3_JANUARY_2026
    : NSSF_SCHEDULES.YEAR_4_FROM_FEBRUARY_2026;
}

function calculatePayeBands(chargeableIncomeInput) {
  const chargeableIncome = inputMoney(chargeableIncomeInput, 'chargeableIncome');
  let remaining = chargeableIncome;
  let grossTax = zeroMoney();
  const bands = [];

  for (const band of PAYE_BANDS) {
    const taxableInBand = band.width === null
      ? remaining
      : minMoney(remaining, fixedMoney(band.width));
    const tax = roundedRate(taxableInBand, band.rate, `ke.paye.${band.code.toLowerCase()}.tax`);
    grossTax = grossTax.add(tax);
    bands.push({
      code: band.code,
      width: band.width,
      rate: band.rate,
      taxableAmount: serializeMoney(taxableInBand),
      tax: serializeMoney(tax),
    });
    remaining = remaining.subtract(taxableInBand);
  }

  grossTax = roundedAmount(grossTax, 'ke.paye.gross_tax.total');
  return { chargeableIncome, grossTax, bands };
}

function calculateMonthlyPaye({ chargeableIncome, residencyStatus, insuranceRelief = '0.00' }) {
  if (!new Set(['resident', 'non_resident']).has(residencyStatus)) {
    fail('KENYA_INVALID_RESIDENCY', 'residencyStatus must be resident or non_resident');
  }
  const insurance = inputMoney(insuranceRelief, 'insuranceRelief');
  if (residencyStatus === 'non_resident' && insurance.decimal.compare('0') > 0) {
    fail('KENYA_RELIEF_NOT_AVAILABLE_TO_NON_RESIDENT', 'Insurance relief is available only to resident individuals');
  }
  const result = calculatePayeBands(chargeableIncome);
  const personalRelief = residencyStatus === 'resident'
    ? roundedAmount(fixedMoney('2400.00'), 'ke.paye.personal_relief.final')
    : roundedAmount(zeroMoney(), 'ke.paye.personal_relief.final');
  const paye = roundedAmount(
    maxZero(result.grossTax.subtract(personalRelief).subtract(insurance)),
    'ke.paye.net_withholding.final'
  );
  return deepFreeze({
    chargeableIncome: serializeMoney(result.chargeableIncome),
    bands: result.bands,
    grossTax: serializeMoney(result.grossTax),
    reliefs: {
      personal: serializeMoney(personalRelief),
      insurance: serializeMoney(insurance),
    },
    amount: serializeMoney(paye),
    basis: 'monthly_non_cumulative',
  });
}

function createLiability({
  liabilityCode,
  name,
  payer,
  amount,
  baseAmount,
  rate,
  authority,
  formCode,
  periodStart,
  periodEnd,
  dueDate,
  paymentChannel,
  accountReferenceField,
  calculationMethod,
  roundingStage,
  sourceReferences,
  sourceEffectiveFrom,
  evidenceReference = '',
  metadata = {},
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
      formCode,
      frequency: 'monthly',
      periodStart,
      periodEnd,
      dueDate,
      paymentChannel,
      accountReferenceField,
    },
    calculation: {
      method: calculationMethod,
      roundingStage,
    },
    sourceReferences,
    sourceEffectiveFrom,
    evidenceReference,
    metadata,
  }, MONEY);
}

function calculate(input) {
  assertPlainObject(input, 'input');
  assertOnlyKeys(input, TOP_LEVEL_KEYS, 'input');

  const payDate = parseDateOnly(input.payDate, 'payDate');
  if (payDate.date.getUTCFullYear() !== 2026) {
    fail('KENYA_UNSUPPORTED_TAX_YEAR', 'Kenya2026PayrollAdapter supports pay dates only in calendar year 2026');
  }
  const period = monthPeriod(payDate.date);
  const periodStart = isoDate(period.start);
  const periodEnd = isoDate(period.end);
  const standardDueDate = isoDate(ninthOfFollowingMonth(period.end));

  if (!Array.isArray(input.benefits)) {
    fail('KENYA_COMPONENT_DECLARATION_REQUIRED', 'benefits must be an explicit array');
  }
  if (input.benefits.length > 0) {
    fail('KENYA_UNSUPPORTED_BENEFIT_VALUATION', 'Non-cash benefit valuation is outside this adapter; supply no benefits and value them upstream with a certified Kenya benefit module');
  }
  if (!Array.isArray(input.reimbursements)) {
    fail('KENYA_COMPONENT_DECLARATION_REQUIRED', 'reimbursements must be an explicit array');
  }
  if (input.reimbursements.length > 0) {
    fail('KENYA_UNSUPPORTED_REIMBURSEMENT_VALUATION', 'Reimbursement taxability is outside this adapter; supply no reimbursements and classify them upstream with evidence');
  }

  const grossCashPay = inputMoney(input.grossCashPay, 'grossCashPay');
  const nssfPensionableEarnings = inputMoney(input.nssfPensionableEarnings, 'nssfPensionableEarnings');
  const pensionableIncomeForTax = inputMoney(input.pensionableIncomeForTax, 'pensionableIncomeForTax');
  if (nssfPensionableEarnings.decimal.compare(grossCashPay.decimal) > 0) {
    fail('KENYA_INVALID_NSSF_BASE', 'nssfPensionableEarnings cannot exceed grossCashPay when benefits and reimbursements are excluded');
  }
  if (pensionableIncomeForTax.decimal.compare(grossCashPay.decimal) > 0) {
    fail('KENYA_INVALID_PENSIONABLE_INCOME', 'pensionableIncomeForTax cannot exceed grossCashPay when benefits and reimbursements are excluded');
  }

  const residencyStatus = String(input.residencyStatus || '').trim().toLowerCase();
  if (!new Set(['resident', 'non_resident']).has(residencyStatus)) {
    fail('KENYA_INVALID_RESIDENCY', 'residencyStatus must be resident or non_resident');
  }
  const birthDate = parseDateOnly(input.dateOfBirth, 'dateOfBirth');
  if (birthDate.date > payDate.date) fail('KENYA_INVALID_DATE', 'dateOfBirth cannot be after payDate');
  const age = ageOn(birthDate.date, payDate.date);

  const calendar = normalizeBusinessCalendar(input.businessCalendar);
  const ahlDueDate = isoDate(addWorkingDaysAfter(period.end, 9, calendar.publicHolidays));
  const registeredPension = normalizeRegisteredPension(input.employeeRegisteredPension);
  const insurance = normalizeInsuranceRelief(input.insuranceRelief, residencyStatus, payDate.date);
  const pwd = normalizePwdExemption(input.pwdTaxExemption, residencyStatus, payDate.date);
  const contractingOut = normalizeContractingOut(input.nssf, payDate.date);
  const nita = normalizeNita(input.nita, payDate.date);

  const ahlEmployee = roundedRate(grossCashPay, '0.015', 'ke.ahl.employee.final');
  const ahlEmployer = roundedRate(grossCashPay, '0.015', 'ke.ahl.employer.final');
  const calculatedShif = roundedRate(grossCashPay, '0.0275', 'ke.shif.employee.percentage');
  const shifEmployee = roundedAmount(
    calculatedShif.decimal.compare('300.00') < 0 ? fixedMoney('300.00') : calculatedShif,
    'ke.shif.employee.final'
  );

  const nssfCovered = age >= 18 && age < 60;
  const nssfSchedule = nssfScheduleFor(payDate.text);
  const nssfBase = nssfCovered
    ? minMoney(nssfPensionableEarnings, fixedMoney(nssfSchedule.upperEarningsLimit))
    : zeroMoney();
  const tierOneBase = minMoney(nssfBase, fixedMoney(nssfSchedule.lowerEarningsLimit));
  const tierTwoBase = maxZero(nssfBase.subtract(tierOneBase));
  const nssfTierOneEmployee = roundedRate(tierOneBase, nssfSchedule.rate, 'ke.nssf.tier_1.employee.final');
  const nssfTierOneEmployer = roundedRate(tierOneBase, nssfSchedule.rate, 'ke.nssf.tier_1.employer.final');
  const nssfTierTwoEmployee = roundedRate(tierTwoBase, nssfSchedule.rate, 'ke.nssf.tier_2.employee.final');
  const nssfTierTwoEmployer = roundedRate(tierTwoBase, nssfSchedule.rate, 'ke.nssf.tier_2.employer.final');
  const nssfEmployee = nssfTierOneEmployee.add(nssfTierTwoEmployee);
  const nssfEmployer = nssfTierOneEmployer.add(nssfTierTwoEmployer);

  const thirtyPercentPensionCap = roundedRate(
    pensionableIncomeForTax,
    '0.30',
    'ke.paye.registered_pension.thirty_percent_cap'
  );
  const aggregateRemainingAfterNssf = maxZero(fixedMoney('30000.00').subtract(nssfEmployee));
  const registeredPensionTaxDeduction = minMoney(
    registeredPension.contribution,
    thirtyPercentPensionCap,
    aggregateRemainingAfterNssf
  );
  const pensionTaxDeduction = nssfEmployee.add(registeredPensionTaxDeduction);
  const registeredPensionExcess = registeredPension.contribution.subtract(registeredPensionTaxDeduction);

  const taxableBeforePwd = maxZero(
    grossCashPay
      .subtract(ahlEmployee)
      .subtract(shifEmployee)
      .subtract(pensionTaxDeduction)
  );
  const pwdExemption = pwd.applied
    ? minMoney(grossCashPay, fixedMoney('150000.00'))
    : zeroMoney();
  const chargeableIncome = maxZero(taxableBeforePwd.subtract(pwdExemption));
  const paye = calculateMonthlyPaye({
    chargeableIncome: chargeableIncome.toFixed(),
    residencyStatus,
    insuranceRelief: insurance.relief,
  });
  const payeAmount = fixedMoney(paye.amount.amount).roundToMinorUnit({
    mode: HALF_UP,
    stage: 'ke.paye.liability.final',
  });

  const nssfAuthority = {
    code: 'NSSF',
    name: 'National Social Security Fund',
    level: 'social_security',
    jurisdictionCode: 'KE',
  };
  const tierTwoAuthority = contractingOut.contractedOut
    ? {
      code: 'RBA_CONTRACTED_SCHEME',
      name: contractingOut.schemeName,
      level: 'social_security',
      jurisdictionCode: 'KE',
    }
    : nssfAuthority;
  const tierTwoForm = contractingOut.contractedOut
    ? 'CONTRACTED_TIER_II_SCHEDULE'
    : 'NSSF_MONTHLY_RETURN';
  const tierTwoChannel = contractingOut.contractedOut
    ? 'Approved contracted-out scheme channel'
    : 'NSSF e-Service portal';

  const liabilities = [
    createLiability({
      liabilityCode: 'KE_PAYE',
      name: 'Pay As You Earn',
      payer: 'employee',
      amount: payeAmount,
      baseAmount: chargeableIncome,
      rate: '',
      authority: { code: 'KRA', name: 'Kenya Revenue Authority', level: 'national', jurisdictionCode: 'KE' },
      formCode: 'PAYE_RETURN',
      periodStart,
      periodEnd,
      dueDate: standardDueDate,
      paymentChannel: 'KRA iTax',
      accountReferenceField: 'Employer KRA PIN',
      calculationMethod: 'monthly_progressive_bands_less_reliefs',
      roundingStage: 'ke.paye.liability.final',
      sourceReferences: [
        'KRA_PAYE_CURRENT',
        'KENYA_INCOME_TAX_ACT_2026',
        'KRA_PAYE_EMPLOYERS_GUIDE_AGGREGATE',
      ],
      sourceEffectiveFrom: '2023-07-01',
      evidenceReference: pwd.evidenceReference || insurance.evidenceReference,
      metadata: {
        basis: 'monthly_non_cumulative',
        taxableBeforePwd: taxableBeforePwd.toFixed(),
        pwdExemption: pwdExemption.toFixed(),
        personalRelief: paye.reliefs.personal.amount,
        insuranceRelief: paye.reliefs.insurance.amount,
        bands: paye.bands,
      },
    }),
    createLiability({
      liabilityCode: 'KE_AHL_EMPLOYEE',
      name: 'Affordable Housing Levy — employee',
      payer: 'employee',
      amount: ahlEmployee,
      baseAmount: grossCashPay,
      rate: '0.015',
      authority: { code: 'KRA', name: 'Kenya Revenue Authority', level: 'national', jurisdictionCode: 'KE' },
      formCode: 'PAYE_SHEET_M_AHL',
      periodStart,
      periodEnd,
      dueDate: ahlDueDate,
      paymentChannel: 'KRA iTax / eCitizen',
      accountReferenceField: 'Employer KRA PIN',
      calculationMethod: 'gross_salary_percent',
      roundingStage: 'ke.ahl.employee.final',
      sourceReferences: ['KENYA_AFFORDABLE_HOUSING_ACT', 'KRA_PAYE_CURRENT'],
      sourceEffectiveFrom: '2024-03-19',
      evidenceReference: calendar.evidenceReference,
      metadata: { dueRule: 'ninth_working_day_after_month_end' },
    }),
    createLiability({
      liabilityCode: 'KE_SHIF_EMPLOYEE',
      name: 'Social Health Insurance Fund contribution',
      payer: 'employee',
      amount: shifEmployee,
      baseAmount: grossCashPay,
      rate: '0.0275',
      authority: { code: 'SHA', name: 'Social Health Authority', level: 'social_security', jurisdictionCode: 'KE' },
      formCode: 'SHA_EMPLOYER_RETURN',
      periodStart,
      periodEnd,
      dueDate: standardDueDate,
      paymentChannel: 'SHA Employer Portal',
      accountReferenceField: 'Employer SHA account',
      calculationMethod: 'gross_salary_percent_with_monthly_minimum',
      roundingStage: 'ke.shif.employee.final',
      sourceReferences: ['KENYA_SHIF_REGULATIONS', 'KRA_PAYE_CURRENT'],
      sourceEffectiveFrom: '2024-10-01',
      metadata: { minimum: '300.00', dueRule: 'ninth_day_of_following_month' },
    }),
    createLiability({
      liabilityCode: 'KE_NSSF_TIER_I_EMPLOYEE',
      name: 'NSSF Tier I — employee',
      payer: 'employee',
      amount: nssfTierOneEmployee,
      baseAmount: tierOneBase,
      rate: nssfSchedule.rate,
      authority: nssfAuthority,
      formCode: 'NSSF_MONTHLY_RETURN',
      periodStart,
      periodEnd,
      dueDate: standardDueDate,
      paymentChannel: 'NSSF e-Service portal',
      accountReferenceField: 'Employer NSSF number',
      calculationMethod: 'tiered_pensionable_earnings',
      roundingStage: 'ke.nssf.tier_1.employee.final',
      sourceReferences: nssfSchedule.sourceReferences,
      sourceEffectiveFrom: nssfSchedule.effectiveFrom,
      metadata: { schedule: nssfSchedule.code, route: 'NSSF', covered: nssfCovered, age },
    }),
    createLiability({
      liabilityCode: 'KE_NSSF_TIER_II_EMPLOYEE',
      name: 'NSSF Tier II — employee',
      payer: 'employee',
      amount: nssfTierTwoEmployee,
      baseAmount: tierTwoBase,
      rate: nssfSchedule.rate,
      authority: tierTwoAuthority,
      formCode: tierTwoForm,
      periodStart,
      periodEnd,
      dueDate: standardDueDate,
      paymentChannel: tierTwoChannel,
      accountReferenceField: contractingOut.contractedOut ? 'Contracting-out certificate number' : 'Employer NSSF number',
      calculationMethod: 'tiered_pensionable_earnings',
      roundingStage: 'ke.nssf.tier_2.employee.final',
      sourceReferences: contractingOut.contractedOut
        ? [...nssfSchedule.sourceReferences, 'KENYA_NSSF_CONTRACTING_OUT_REGULATIONS']
        : nssfSchedule.sourceReferences,
      sourceEffectiveFrom: nssfSchedule.effectiveFrom,
      evidenceReference: contractingOut.evidenceReference,
      metadata: {
        schedule: nssfSchedule.code,
        route: contractingOut.contractedOut ? 'CONTRACTED_OUT_SCHEME' : 'NSSF',
        contractingOutCertificateNumber: contractingOut.certificateNumber,
        covered: nssfCovered,
        age,
      },
    }),
    createLiability({
      liabilityCode: 'KE_AHL_EMPLOYER',
      name: 'Affordable Housing Levy — employer',
      payer: 'employer',
      amount: ahlEmployer,
      baseAmount: grossCashPay,
      rate: '0.015',
      authority: { code: 'KRA', name: 'Kenya Revenue Authority', level: 'national', jurisdictionCode: 'KE' },
      formCode: 'PAYE_SHEET_M_AHL',
      periodStart,
      periodEnd,
      dueDate: ahlDueDate,
      paymentChannel: 'KRA iTax / eCitizen',
      accountReferenceField: 'Employer KRA PIN',
      calculationMethod: 'gross_salary_percent',
      roundingStage: 'ke.ahl.employer.final',
      sourceReferences: ['KENYA_AFFORDABLE_HOUSING_ACT', 'KRA_PAYE_CURRENT'],
      sourceEffectiveFrom: '2024-03-19',
      evidenceReference: calendar.evidenceReference,
      metadata: { dueRule: 'ninth_working_day_after_month_end' },
    }),
    createLiability({
      liabilityCode: 'KE_NSSF_TIER_I_EMPLOYER',
      name: 'NSSF Tier I — employer',
      payer: 'employer',
      amount: nssfTierOneEmployer,
      baseAmount: tierOneBase,
      rate: nssfSchedule.rate,
      authority: nssfAuthority,
      formCode: 'NSSF_MONTHLY_RETURN',
      periodStart,
      periodEnd,
      dueDate: standardDueDate,
      paymentChannel: 'NSSF e-Service portal',
      accountReferenceField: 'Employer NSSF number',
      calculationMethod: 'tiered_pensionable_earnings',
      roundingStage: 'ke.nssf.tier_1.employer.final',
      sourceReferences: nssfSchedule.sourceReferences,
      sourceEffectiveFrom: nssfSchedule.effectiveFrom,
      metadata: { schedule: nssfSchedule.code, route: 'NSSF', covered: nssfCovered, age },
    }),
    createLiability({
      liabilityCode: 'KE_NSSF_TIER_II_EMPLOYER',
      name: 'NSSF Tier II — employer',
      payer: 'employer',
      amount: nssfTierTwoEmployer,
      baseAmount: tierTwoBase,
      rate: nssfSchedule.rate,
      authority: tierTwoAuthority,
      formCode: tierTwoForm,
      periodStart,
      periodEnd,
      dueDate: standardDueDate,
      paymentChannel: tierTwoChannel,
      accountReferenceField: contractingOut.contractedOut ? 'Contracting-out certificate number' : 'Employer NSSF number',
      calculationMethod: 'tiered_pensionable_earnings',
      roundingStage: 'ke.nssf.tier_2.employer.final',
      sourceReferences: contractingOut.contractedOut
        ? [...nssfSchedule.sourceReferences, 'KENYA_NSSF_CONTRACTING_OUT_REGULATIONS']
        : nssfSchedule.sourceReferences,
      sourceEffectiveFrom: nssfSchedule.effectiveFrom,
      evidenceReference: contractingOut.evidenceReference,
      metadata: {
        schedule: nssfSchedule.code,
        route: contractingOut.contractedOut ? 'CONTRACTED_OUT_SCHEME' : 'NSSF',
        contractingOutCertificateNumber: contractingOut.certificateNumber,
        covered: nssfCovered,
        age,
      },
    }),
    createLiability({
      liabilityCode: 'KE_NITA_EMPLOYER',
      name: 'Industrial Training Levy',
      payer: 'employer',
      amount: nita.amount,
      baseAmount: null,
      rate: '',
      authority: { code: 'KRA_NITA', name: 'Commissioner-General / National Industrial Training Authority', level: 'national', jurisdictionCode: 'KE' },
      formCode: 'NITA_LEVY_RETURN',
      periodStart,
      periodEnd,
      dueDate: standardDueDate,
      paymentChannel: 'Commissioner-General collection channel',
      accountReferenceField: 'Employer levy registration number',
      calculationMethod: 'fixed_amount_per_employee',
      roundingStage: 'ke.nita.employer.final',
      sourceReferences: ['KENYA_INDUSTRIAL_TRAINING_ACT_2024', 'NITA_OPERATIONAL_GUIDANCE'],
      sourceEffectiveFrom: '2024-04-26',
      evidenceReference: nita.evidenceReference,
      metadata: {
        fixedAmountPerEmployee: '50.00',
        exempt: nita.exempt,
        dueRuleApplied: 'ninth_day_of_following_month_under_current_act',
        operationalGuidanceConflict: true,
        legalReviewBeforeIntegration: true,
      },
    }),
  ];

  const ledger = statutoryLiabilityLedgerService.buildLedger(liabilities);
  const employeeStatutory = fixedMoney(ledger.employeeTotal.amount);
  const employerStatutory = fixedMoney(ledger.employerTotal.amount);
  const employeeCashDeductions = employeeStatutory.add(registeredPension.contribution);
  const netCashPay = grossCashPay.subtract(employeeCashDeductions);
  const employerTotalCashCost = grossCashPay.add(employerStatutory);

  return deepFreeze({
    adapter: {
      code: 'KE_2026_MONTHLY_STANDALONE',
      countryCode: 'KE',
      taxYear: 2026,
      integrationStatus: 'standalone_not_integrated',
      confidence: 'preview_pending_kenya_legal_and_payroll_signoff',
      calculationBasis: 'monthly_non_cumulative',
      currency: MONEY.currency,
      minorUnits: MONEY.minorUnits,
      rounding: {
        mode: HALF_UP,
        unit: '0.01',
        stages: 'each statutory component, each PAYE band, each relief, and final PAYE liability',
      },
    },
    period: { payDate: payDate.text, start: periodStart, end: periodEnd },
    employee: { age, nssfCovered, residencyStatus },
    paye: {
      ...paye,
      taxableBeforePwd: serializeMoney(taxableBeforePwd),
      pwdExemption: serializeMoney(pwdExemption),
      pwdCertificateNumber: pwd.certificateNumber,
    },
    statutoryDeductions: {
      ahlEmployee: serializeMoney(ahlEmployee),
      shifEmployee: serializeMoney(shifEmployee),
      nssf: {
        schedule: nssfSchedule.code,
        lowerEarningsLimit: nssfSchedule.lowerEarningsLimit,
        upperEarningsLimit: nssfSchedule.upperEarningsLimit,
        tierOneBase: serializeMoney(tierOneBase),
        tierTwoBase: serializeMoney(tierTwoBase),
        tierOneEmployee: serializeMoney(nssfTierOneEmployee),
        tierTwoEmployee: serializeMoney(nssfTierTwoEmployee),
        employeeTotal: serializeMoney(nssfEmployee),
        tierOneEmployer: serializeMoney(nssfTierOneEmployer),
        tierTwoEmployer: serializeMoney(nssfTierTwoEmployer),
        employerTotal: serializeMoney(nssfEmployer),
        tierTwoRoute: contractingOut.contractedOut ? 'CONTRACTED_OUT_SCHEME' : 'NSSF',
      },
      pensionTax: {
        employeeRegisteredContribution: serializeMoney(registeredPension.contribution),
        registeredContributionThirtyPercentCap: serializeMoney(thirtyPercentPensionCap),
        aggregateMonthlyCap: serializeMoney(fixedMoney('30000.00')),
        aggregateRemainingAfterNssf: serializeMoney(aggregateRemainingAfterNssf),
        registeredContributionDeductible: serializeMoney(registeredPensionTaxDeduction),
        registeredContributionExcess: serializeMoney(registeredPensionExcess),
        totalDeductibleIncludingNssf: serializeMoney(pensionTaxDeduction),
      },
    },
    employerContributions: {
      ahl: serializeMoney(ahlEmployer),
      nssf: serializeMoney(nssfEmployer),
      nita: serializeMoney(nita.amount),
    },
    totals: {
      grossCashPay: serializeMoney(grossCashPay),
      employeeStatutoryLiabilities: serializeMoney(employeeStatutory),
      employeeRegisteredPensionCashDeduction: serializeMoney(registeredPension.contribution),
      employeeCashDeductions: serializeMoney(employeeCashDeductions),
      netCashPay: serializeMoney(netCashPay),
      employerStatutoryCost: serializeMoney(employerStatutory),
      employerTotalCashCost: serializeMoney(employerTotalCashCost),
    },
    liabilityLedger: ledger,
    evidence: {
      businessCalendar: calendar.evidenceReference,
      registeredPension: registeredPension.evidenceReference,
      insurance: insurance.evidenceReference,
      pwd: pwd.evidenceReference,
      nssfContractingOut: contractingOut.evidenceReference,
      nitaExemption: nita.evidenceReference,
    },
    supportedCases: [
      'monthly cash employment pay with no non-cash benefits or reimbursements',
      'resident and non-resident PAYE',
      'documented resident life, health, or qualifying education insurance relief',
      'documented employee contribution to a registered pension/provident fund',
      'documented PWD income-tax exemption certificate active on the pay date',
      'NSSF mandatory membership from the 18th birthday until the day before the 60th birthday',
      'NSSF Tier II remittance to NSSF or an evidenced contracted-out scheme',
      'evidenced NITA applicability or in-force exemption',
    ],
    excludedCases: [
      'non-cash benefit valuation including housing, vehicles, loans, meals, medical cover, and general benefits',
      'mileage, business-expense, travel, subsistence, or other reimbursement classification',
      'employer pension contributions and any resulting taxable excess benefit',
      'mortgage-interest and post-retirement-medical-fund deductions',
      'PWD disability-expense deductions up to KES 50,000',
      'NSSF statutory exemptions other than the age 18/60 boundary',
      'multiple employments, irregular periods, annual reconciliation, prior-period corrections, and YTD calculations',
      'concrete payment instructions where an authority portal conflicts with the current statute',
    ],
    officialSources: OFFICIAL_SOURCES,
    reviewFlags: [
      {
        code: 'KE_NITA_DUE_GUIDANCE_CONFLICT',
        severity: 'legal_review_required_before_integration',
        appliedRule: 'ninth day of following month under the current Industrial Training Act',
        conflictingGuidance: 'NITA Levy Inspectorate page states last working day of the month',
      },
    ],
  });
}

module.exports = {
  calculate,
  calculateMonthlyPaye,
  calculatePayeBands,
  KenyaPayrollAdapterError,
  OFFICIAL_SOURCES,
  PAYE_BANDS,
  NSSF_SCHEDULES,
};
