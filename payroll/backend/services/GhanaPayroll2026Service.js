'use strict';

/**
 * Ghana 2026 Wave 1 payroll preview.
 *
 * This pure adapter is deliberately not registered with TaxJurisdictionService.
 * It accepts decimal strings and evidence-bearing inputs, and fails closed where
 * the official corpus does not establish a unique payroll result.
 */

const statutoryMoneyService = require('./StatutoryMoneyService');
const statutoryLiabilityLedgerService = require('./StatutoryLiabilityLedgerService');
const { ROUNDING_MODES } = require('./StatutoryMoneyService');

const MONEY = Object.freeze({ currency: 'GHS', minorUnits: 2 });
const HALF_UP = ROUNDING_MODES.HALF_UP;
const TAX_YEAR = '2026';
const LAW_BUNDLE = 'GH_GRA_2024_SSNIT_2026_WAVE1_V1';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const OFFICIAL_SOURCES = deepFreeze({
  GRA_PAYE_CURRENT: {
    authority: 'Ghana Revenue Authority',
    title: 'Pay As You Earn (PAYE)',
    url: 'https://gra.gov.gh/domestic-tax/tax-types/paye/',
    effectiveFrom: '2024-01-01',
    supports: [
      '2024 resident monthly bands currently published by GRA',
      '25% regular non-resident employment withholding',
      '5.5% basic-salary pension deduction before PAYE',
      'resident and non-resident bonus and overtime treatment',
      'PAYE return and payment by the fifteenth day of the following month',
    ],
  },
  GRA_ACT_1111_IMPLEMENTATION: {
    authority: 'Ghana Revenue Authority',
    title: 'Implementation of New Tax Laws and Amendments',
    url: 'https://gra.gov.gh/implementation-of-new-tax-laws-and-amendments/',
    effectiveFrom: '2024-01-01',
    supports: ['Act 1111 annual resident individual tax bands effective 1 January 2024'],
  },
  GRA_PERSONAL_RELIEF: {
    authority: 'Ghana Revenue Authority',
    title: 'Personal Tax Relief',
    url: 'https://gra.gov.gh/domestic-tax/personal-tax-relief/',
    effectiveFrom: '2024-01-01',
    supports: ['Commissioner-General relief application and current relief categories'],
  },
  GRA_EMPLOYMENT_PRACTICE_NOTE: {
    authority: 'Ghana Revenue Authority',
    title: 'Practice Note on Gains or Profits from Employment',
    url: 'https://gra.gov.gh/wp-content/uploads/2020/09/Practice-Note-on-Gains-or-Profits-from-Employment.pdf',
    effectiveFrom: '2016-01-01',
    sha256: 'DBB59E89B5E87A677A80939EE2E9BE37373BA5C79B90ABEF64E829D33154CE82',
    supports: [
      'upfront monthly relief categories',
      'qualifying junior overtime rules and examples',
      'bonus annual-cap rules and examples',
      'employment benefit principles',
    ],
  },
  GRA_ACT_1094: {
    authority: 'Ghana Revenue Authority',
    title: 'Income Tax (Amendment) Act, 2023 (Act 1094)',
    url: 'https://gra.gov.gh/wp-content/uploads/2023/04/INCOME-TAX-AMENDMENT-ACT-2023-ACT-1094.pdf',
    effectiveFrom: '2023-04-03',
    sha256: '26BA452EBF63D609D6B0AFC15C191B458359F705F6EFB94C4A6A383DD8F3F586',
    supports: ['vehicle and fuel benefit rates and monthly caps'],
  },
  SSNIT_2026_MIN_MAX_NOTICE: {
    authority: 'Social Security and National Insurance Trust',
    title: '2026 Minimum and Maximum Insurable Earnings',
    url: 'https://www.ssnit.org.gh/wp-content/uploads/2026/01/Public-Notice-Min-Max-Insurable.pdf',
    effectiveFrom: '2026-01-01',
    sha256: '71DF42F118D1F7AEFA135D3AA57C4AB6A846E0298CC1A8F3AF506785BBA756BA',
    supports: [
      'GHS 587.80 minimum insurable earnings',
      'GHS 69,000 maximum insurable earnings',
      'published GHS 79.40 minimum and GHS 9,315 maximum first-tier contributions',
    ],
  },
  SSNIT_EMPLOYER_GUIDANCE: {
    authority: 'Social Security and National Insurance Trust',
    title: 'Become an Employer',
    url: 'https://www.ssnit.org.gh/become-an-employer/',
    effectiveFrom: '2026-01-01',
    supports: [
      '5.5% employee and 13% employer economic contributions',
      '13.5% first-tier and 5% second-tier routing',
      'remittance within fourteen days after month end',
    ],
  },
  SSNIT_FAQ: {
    authority: 'Social Security and National Insurance Trust',
    title: 'Frequently Asked Questions',
    url: 'https://www.ssnit.org.gh/faqs/',
    effectiveFrom: '2026-01-01',
    supports: ['2.5% NHIA transfer and 11% retained by SSNIT from the 13.5% first tier'],
  },
  SSNIT_OMNIBUS: {
    authority: 'Social Security and National Insurance Trust',
    title: 'SSNIT Omnibus',
    url: 'https://www.ssnit.org.gh/wp-content/uploads/2023/08/SSNIT-Omnibus.pdf',
    effectiveFrom: '2023-08-01',
    sha256: 'B665FDC98CEB9DB137BBE35B31781BDC7D20F1A74BCD77BA9486636E040CAF89',
    supports: ['official GHS 1,500 salary contribution and routing example'],
  },
  NPRA_ACT_766: {
    authority: 'National Pensions Regulatory Authority',
    title: 'National Pensions Act, 2008 (Act 766)',
    url: 'https://www.npra.gov.gh/regulations/act/',
    documentUrl: 'https://npra-live.s3.amazonaws.com/public/documents/NPRA_2008_Act_766.pdf',
    effectiveFrom: '2010-01-01',
    sha256: 'C838AA9BE09E709D9199BDA1B51E4AC643FE023454BF790B0479B21CFFB68728',
    supports: ['5.5% employee, 13% employer, 13.5% first-tier and 5% second-tier contributions'],
  },
  NPRA_TIER2_PAYMENT_GUIDELINES: {
    authority: 'National Pensions Regulatory Authority',
    title: 'Guidelines for the Payment of Monthly Contributions to Registered Pension Schemes',
    url: 'https://npra.gov.gh/assets/documents/Guidelines-for-the-payment-of-contributions.pdf',
    effectiveFrom: '2013-01-01',
    sha256: '716BC15D193CEEC156F425E85D04DD50B454A75D52FD566B2031C4D0EC845BD9',
    supports: [
      '5% second-tier contribution',
      'payment on or before the fourteenth day of the following month',
      'Monthly Contribution Report and Monthly Remittance Statement requirements',
    ],
  },
});

const RESIDENT_MONTHLY_BANDS = deepFreeze([
  { code: 'BAND_0', width: '490.00', rate: '0' },
  { code: 'BAND_5', width: '110.00', rate: '0.05' },
  { code: 'BAND_10', width: '130.00', rate: '0.10' },
  { code: 'BAND_17_5', width: '3166.67', rate: '0.175' },
  { code: 'BAND_25', width: '16000.00', rate: '0.25' },
  { code: 'BAND_30_CONFLICT_GUARDED', width: '30520.00', rate: '0.30' },
]);

const VEHICLE_BENEFITS = deepFreeze({
  driver_vehicle_fuel: { rate: '0.125', monthlyCap: '1500.00' },
  vehicle_fuel: { rate: '0.10', monthlyCap: '1250.00' },
  vehicle_only: { rate: '0.05', monthlyCap: '625.00' },
  fuel_only: { rate: '0.05', monthlyCap: '625.00' },
});

const UPFRONT_RELIEF_CATEGORIES = new Set([
  'dependant_spouse_or_children',
  'child_education',
  'disability',
  'old_age',
  'aged_dependent',
]);

const ADAPTER_METADATA = deepFreeze({
  code: 'GH_2026_WAVE1_STANDALONE',
  taxYear: TAX_YEAR,
  lawBundle: LAW_BUNDLE,
  integrationStatus: 'standalone_not_integrated',
  confidence: 'preview_pending_ghana_legal_and_payroll_signoff',
  calculationBasis: 'monthly_non_cumulative',
  runnable: false,
  postable: false,
});

class GhanaPayroll2026Error extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'GhanaPayroll2026Error';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new GhanaPayroll2026Error(code, message, details);
}

function assertPlainObject(value, label, code = 'GH_INVALID_INPUT') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(code, `${label} must be an object`);
  }
}

function assertOnlyKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail('GH_UNSUPPORTED_INPUT', `${label}.${key} is not supported by the Ghana 2026 Wave 1 adapter`, {
        path: `${label}.${key}`,
      });
    }
  }
}

function requiredText(value, label, code = 'GH_REQUIRED_EVIDENCE_MISSING') {
  const text = String(value || '').trim();
  if (!text) fail(code, `${label} is required`);
  return text;
}

function requireSha256(value, label) {
  const hash = requiredText(value, label);
  if (!/^[A-Fa-f0-9]{64}$/.test(hash)) {
    fail('GH_INVALID_EVIDENCE_HASH', `${label} must be a 64-character SHA-256 digest`);
  }
  return hash.toUpperCase();
}

function parseDateOnly(value, label) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    fail('GH_INVALID_DATE', `${label} must use YYYY-MM-DD`);
  }
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    fail('GH_INVALID_DATE', `${label} is not a valid calendar date`);
  }
  return { text, date };
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function monthPeriod(payDate) {
  const year = payDate.getUTCFullYear();
  const month = payDate.getUTCMonth();
  return {
    start: isoDate(new Date(Date.UTC(year, month, 1))),
    end: isoDate(new Date(Date.UTC(year, month + 1, 0))),
    ssnitAndTier2Due: isoDate(new Date(Date.UTC(year, month + 1, 14))),
    payeDue: isoDate(new Date(Date.UTC(year, month + 1, 15))),
  };
}

function validatePayDate(taxYear, payDateValue) {
  if (String(taxYear || '') !== TAX_YEAR) {
    fail('GH_UNSUPPORTED_TAX_YEAR', 'This law bundle supports tax year 2026 only');
  }
  const payDate = parseDateOnly(payDateValue, 'payDate');
  if (!payDate.text.startsWith(`${TAX_YEAR}-`)) {
    fail('GH_UNSUPPORTED_TAX_YEAR', 'payDate must fall in calendar year 2026');
  }
  return payDate;
}

function inputMoney(value, label) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(value.trim())) {
    fail('GH_INVALID_MONEY', `${label} must be a non-negative base-10 GHS decimal string with at most two decimals`);
  }
  try {
    const amount = statutoryMoneyService.create(value.trim(), MONEY);
    amount.toMinorUnits();
    return amount;
  } catch (error) {
    fail('GH_INVALID_MONEY', `${label} is not an exact GHS amount`, { cause: error.message });
  }
}

function fixedMoney(value) {
  return statutoryMoneyService.create(value, MONEY);
}

function zeroMoney() {
  return fixedMoney('0.00');
}

function minMoney(left, right) {
  return left.decimal.compare(right.decimal) <= 0 ? left : right;
}

function maxZero(value) {
  return value.decimal.compare('0') < 0 ? zeroMoney() : value;
}

function serializeMoney(amount) {
  return {
    amount: amount.toFixed(),
    currency: MONEY.currency,
    minorUnits: MONEY.minorUnits,
    roundingHistory: amount.roundingHistory.map((event) => ({ ...event })),
  };
}

function serializeUnrounded(amount) {
  return {
    amount: amount.toString(),
    currency: MONEY.currency,
    status: 'unrounded_formula_result',
  };
}

function exactCentRate(amount, rate, stage, code = 'GH_UNCERTIFIED_COMPONENT_ROUNDING') {
  const result = amount.multiplyByRate(rate);
  try {
    result.toMinorUnits();
  } catch (error) {
    fail(code, `Official evidence does not establish how to round ${stage}`, {
      stage,
      rawAmount: result.toString(),
      rate,
    });
  }
  return result;
}

function roundedHalfUpRate(amount, rate, stage) {
  return amount.multiplyByRate(rate).roundToMinorUnit({ mode: HALF_UP, stage });
}

function validateEvidenceWindow(value, label, payDate) {
  const effectiveFrom = parseDateOnly(value.effectiveFrom, `${label}.effectiveFrom`);
  const effectiveTo = parseDateOnly(value.effectiveTo, `${label}.effectiveTo`);
  if (effectiveFrom.text > effectiveTo.text) {
    fail('GH_EVIDENCE_INACTIVE', `${label}.effectiveFrom cannot be after effectiveTo`);
  }
  if (payDate.text < effectiveFrom.text || payDate.text > effectiveTo.text) {
    fail('GH_EVIDENCE_INACTIVE', `${label} is not effective on payDate`, {
      payDate: payDate.text,
      effectiveFrom: effectiveFrom.text,
      effectiveTo: effectiveTo.text,
    });
  }
  return { effectiveFrom: effectiveFrom.text, effectiveTo: effectiveTo.text };
}

function normalizeTier2Scheme(value, payDate) {
  assertPlainObject(value, 'tier2Scheme', 'GH_TIER2_EVIDENCE_REQUIRED');
  assertOnlyKeys(value, new Set([
    'schemeName',
    'trusteeName',
    'custodianName',
    'npraRegistrationReference',
    'evidenceHashSha256',
    'effectiveFrom',
    'effectiveTo',
  ]), 'tier2Scheme');
  const schemeName = requiredText(value.schemeName, 'tier2Scheme.schemeName', 'GH_TIER2_EVIDENCE_REQUIRED');
  const trusteeName = requiredText(value.trusteeName, 'tier2Scheme.trusteeName', 'GH_TIER2_EVIDENCE_REQUIRED');
  const custodianName = requiredText(value.custodianName, 'tier2Scheme.custodianName', 'GH_TIER2_EVIDENCE_REQUIRED');
  const npraRegistrationReference = requiredText(
    value.npraRegistrationReference,
    'tier2Scheme.npraRegistrationReference',
    'GH_TIER2_EVIDENCE_REQUIRED'
  );
  const evidenceHashSha256 = requireSha256(value.evidenceHashSha256, 'tier2Scheme.evidenceHashSha256');
  const window = validateEvidenceWindow(value, 'tier2Scheme', payDate);
  return {
    schemeName,
    trusteeName,
    custodianName,
    npraRegistrationReference,
    evidenceHashSha256,
    ...window,
  };
}

function buildMinimumAllocationConflict(pensionableSalary, clampReason, tier2Scheme) {
  const raw = {
    employeeEconomic: pensionableSalary.multiplyByRate('0.055'),
    employerEconomic: pensionableSalary.multiplyByRate('0.13'),
    combinedEconomic: pensionableSalary.multiplyByRate('0.185'),
    firstTier: pensionableSalary.multiplyByRate('0.135'),
    secondTier: pensionableSalary.multiplyByRate('0.05'),
    nhiaTransfer: pensionableSalary.multiplyByRate('0.025'),
    ssnitRetained: pensionableSalary.multiplyByRate('0.11'),
  };
  return deepFreeze({
    status: 'blocked_official_minimum_allocation_conflict',
    postable: false,
    pensionableSalary: serializeMoney(pensionableSalary),
    clampReason,
    rates: {
      employee: '0.055',
      employer: '0.13',
      firstTier: '0.135',
      secondTier: '0.05',
      nhiaTransferFromFirstTier: '0.025',
      ssnitRetainedFromFirstTier: '0.11',
    },
    formulaResults: Object.fromEntries(
      Object.entries(raw).map(([key, amount]) => [key, serializeUnrounded(amount)])
    ),
    officialPublishedFirstTierContribution: serializeMoney(fixedMoney('79.40')),
    conflict: {
      code: 'GH_SSNIT_2026_MINIMUM_ALLOCATION_CONFLICT',
      message: 'The official GHS 79.40 minimum first-tier contribution differs from 13.5% of GHS 587.80 (GHS 79.353); no employee/employer/Tier allocation is inferred.',
      rawFirstTier: '79.353',
      publishedFirstTier: '79.40',
      difference: '0.047',
      requiredResolution: 'SSNIT payroll rounding/allocation instruction or certified developer table',
    },
    tier2Scheme,
    sourceReferences: ['SSNIT_2026_MIN_MAX_NOTICE', 'NPRA_ACT_766', 'SSNIT_EMPLOYER_GUIDANCE'],
  });
}

function calculatePension(payload = {}) {
  assertPlainObject(payload, 'pensionInput');
  assertOnlyKeys(payload, new Set(['taxYear', 'payDate', 'basicSalary', 'tier2Scheme']), 'pensionInput');
  const payDate = validatePayDate(payload.taxYear, payload.payDate);
  const basicSalary = inputMoney(payload.basicSalary, 'basicSalary');
  if (basicSalary.decimal.compare('0') <= 0) {
    fail('GH_INVALID_MONEY', 'basicSalary must be greater than zero');
  }
  const tier2Scheme = normalizeTier2Scheme(payload.tier2Scheme, payDate);
  const minimum = fixedMoney('587.80');
  const maximum = fixedMoney('69000.00');
  let pensionableSalary = basicSalary;
  let clampReason = 'within_2026_bounds';
  if (basicSalary.decimal.compare(minimum.decimal) <= 0) {
    pensionableSalary = minimum;
    clampReason = basicSalary.decimal.compare(minimum.decimal) < 0
      ? 'clamped_to_2026_minimum'
      : 'at_2026_minimum';
  } else if (basicSalary.decimal.compare(maximum.decimal) > 0) {
    pensionableSalary = maximum;
    clampReason = 'clamped_to_2026_maximum';
  }

  if (pensionableSalary.decimal.compare(minimum.decimal) === 0) {
    return buildMinimumAllocationConflict(pensionableSalary, clampReason, tier2Scheme);
  }

  const components = {
    employeeEconomic: exactCentRate(
      pensionableSalary,
      '0.055',
      'gh.pension.employee_5_5',
      'GH_SSNIT_ROUNDING_UNCERTIFIED'
    ),
    employerEconomic: exactCentRate(
      pensionableSalary,
      '0.13',
      'gh.pension.employer_13',
      'GH_SSNIT_ROUNDING_UNCERTIFIED'
    ),
    combinedEconomic: exactCentRate(
      pensionableSalary,
      '0.185',
      'gh.pension.combined_18_5',
      'GH_SSNIT_ROUNDING_UNCERTIFIED'
    ),
    firstTier: exactCentRate(
      pensionableSalary,
      '0.135',
      'gh.pension.first_tier_13_5',
      'GH_SSNIT_ROUNDING_UNCERTIFIED'
    ),
    employeeFirstTier: exactCentRate(
      pensionableSalary,
      '0.055',
      'gh.pension.first_tier_employee_5_5',
      'GH_SSNIT_ROUNDING_UNCERTIFIED'
    ),
    employerFirstTier: exactCentRate(
      pensionableSalary,
      '0.08',
      'gh.pension.first_tier_employer_8',
      'GH_SSNIT_ROUNDING_UNCERTIFIED'
    ),
    secondTier: exactCentRate(
      pensionableSalary,
      '0.05',
      'gh.pension.second_tier_5',
      'GH_SSNIT_ROUNDING_UNCERTIFIED'
    ),
    nhiaTransfer: exactCentRate(
      pensionableSalary,
      '0.025',
      'gh.pension.nhia_transfer_2_5',
      'GH_SSNIT_ROUNDING_UNCERTIFIED'
    ),
    ssnitRetained: exactCentRate(
      pensionableSalary,
      '0.11',
      'gh.pension.ssnit_retained_11',
      'GH_SSNIT_ROUNDING_UNCERTIFIED'
    ),
  };

  return deepFreeze({
    status: 'calculated_preview',
    postable: false,
    pensionableSalary: serializeMoney(pensionableSalary),
    declaredBasicSalary: serializeMoney(basicSalary),
    clampReason,
    rates: {
      employee: '0.055',
      employer: '0.13',
      combined: '0.185',
      firstTier: '0.135',
      secondTier: '0.05',
      nhiaTransferFromFirstTier: '0.025',
      ssnitRetainedFromFirstTier: '0.11',
    },
    contributions: Object.fromEntries(
      Object.entries(components).map(([key, amount]) => [key, serializeMoney(amount)])
    ),
    tier2Scheme,
    sourceReferences: [
      'SSNIT_2026_MIN_MAX_NOTICE',
      'SSNIT_EMPLOYER_GUIDANCE',
      'SSNIT_FAQ',
      'NPRA_ACT_766',
      'NPRA_TIER2_PAYMENT_GUIDELINES',
    ],
  });
}

function calculateResidentPaye(chargeableIncomeValue) {
  const chargeableIncome = inputMoney(chargeableIncomeValue, 'chargeableIncome');
  if (chargeableIncome.decimal.compare('50000.00') > 0) {
    fail(
      'GH_GRA_TOP_BAND_SOURCE_CONFLICT',
      'Resident monthly chargeable income above GHS 50,000 is blocked because the official band widths and published top-band threshold conflict',
      {
        monthlyWidthsReach: '50416.67',
        publishedTopBandStartsAbove: '50000.00',
        annualWidthsReach: '605000.00',
        publishedAnnualTopBandStartsAbove: '600000.00',
      }
    );
  }

  let remaining = chargeableIncome;
  let grossTax = zeroMoney();
  const bands = [];
  for (const band of RESIDENT_MONTHLY_BANDS) {
    if (remaining.decimal.compare('0') <= 0) break;
    const width = fixedMoney(band.width);
    const taxableAmount = minMoney(remaining, width);
    const tax = roundedHalfUpRate(taxableAmount, band.rate, `gh.paye.${band.code.toLowerCase()}.tax`);
    bands.push({
      code: band.code,
      officialWidth: band.width,
      rate: band.rate,
      taxableAmount: serializeMoney(taxableAmount),
      tax: serializeMoney(tax),
    });
    grossTax = grossTax.add(tax);
    remaining = remaining.subtract(taxableAmount);
  }

  return deepFreeze({
    residency: 'resident',
    basis: 'monthly_non_cumulative',
    chargeableIncome: serializeMoney(chargeableIncome),
    bands,
    amount: serializeMoney(grossTax),
    roundingRule: 'half_up_per_band_to_GHS_0.01',
    supportedBoundary: 'chargeable_income_at_or_below_GHS_50000_due_to_official_top_band_conflict',
    sourceReferences: ['GRA_PAYE_CURRENT', 'GRA_ACT_1111_IMPLEMENTATION'],
  });
}

function calculateNonresidentPaye(chargeableIncome) {
  const tax = exactCentRate(
    chargeableIncome,
    '0.25',
    'gh.paye.nonresident_regular_25',
    'GH_NONRESIDENT_PAYE_ROUNDING_UNCERTIFIED'
  );
  return {
    residency: 'nonresident',
    basis: 'monthly_non_cumulative_flat_rate',
    chargeableIncome: serializeMoney(chargeableIncome),
    bands: [{
      code: 'NONRESIDENT_FLAT_25',
      rate: '0.25',
      taxableAmount: serializeMoney(chargeableIncome),
      tax: serializeMoney(tax),
    }],
    amount: serializeMoney(tax),
    roundingRule: 'exact_cent_only_otherwise_fail_closed',
    sourceReferences: ['GRA_PAYE_CURRENT'],
  };
}

function normalizeRelief(value, residency, payDate) {
  if (value === null) {
    return { amount: zeroMoney(), certificate: null };
  }
  if (residency !== 'resident') {
    fail('GH_RELIEF_NOT_AVAILABLE_TO_NONRESIDENT', 'Payroll relief is supported only for resident employees');
  }
  assertPlainObject(value, 'reliefCertificate', 'GH_RELIEF_EVIDENCE_REQUIRED');
  assertOnlyKeys(value, new Set([
    'issuer',
    'approvalReference',
    'verificationReference',
    'evidenceHashSha256',
    'effectiveFrom',
    'effectiveTo',
    'annualApprovedAmount',
    'monthlyAuthorizedAmount',
    'claimedYtdBefore',
    'categories',
  ]), 'reliefCertificate');
  if (requiredText(value.issuer, 'reliefCertificate.issuer', 'GH_RELIEF_EVIDENCE_REQUIRED') !== 'GRA') {
    fail('GH_RELIEF_EVIDENCE_REQUIRED', 'reliefCertificate.issuer must be GRA');
  }
  const window = validateEvidenceWindow(value, 'reliefCertificate', payDate);
  if (!Array.isArray(value.categories) || value.categories.length === 0) {
    fail('GH_RELIEF_EVIDENCE_REQUIRED', 'reliefCertificate.categories must identify at least one approved upfront category');
  }
  const categories = [...new Set(value.categories.map((category) => requiredText(category, 'relief category')))];
  for (const category of categories) {
    if (!UPFRONT_RELIEF_CATEGORIES.has(category)) {
      fail('GH_RELIEF_NOT_SUPPORTED_UPFRONT', `${category} is not certified for upfront monthly payroll relief`);
    }
  }
  const annualApprovedAmount = inputMoney(value.annualApprovedAmount, 'reliefCertificate.annualApprovedAmount');
  const monthlyAuthorizedAmount = inputMoney(value.monthlyAuthorizedAmount, 'reliefCertificate.monthlyAuthorizedAmount');
  const claimedYtdBefore = inputMoney(value.claimedYtdBefore, 'reliefCertificate.claimedYtdBefore');
  if (monthlyAuthorizedAmount.decimal.compare('0') <= 0) {
    fail('GH_RELIEF_EVIDENCE_REQUIRED', 'reliefCertificate.monthlyAuthorizedAmount must be greater than zero');
  }
  if (claimedYtdBefore.add(monthlyAuthorizedAmount).decimal.compare(annualApprovedAmount.decimal) > 0) {
    fail('GH_RELIEF_CERTIFICATE_LIMIT_EXCEEDED', 'Authorized monthly relief would exceed the certificate annual amount');
  }
  const certificate = {
    issuer: 'GRA',
    approvalReference: requiredText(
      value.approvalReference,
      'reliefCertificate.approvalReference',
      'GH_RELIEF_EVIDENCE_REQUIRED'
    ),
    verificationReference: requiredText(
      value.verificationReference,
      'reliefCertificate.verificationReference',
      'GH_RELIEF_EVIDENCE_REQUIRED'
    ),
    evidenceHashSha256: requireSha256(value.evidenceHashSha256, 'reliefCertificate.evidenceHashSha256'),
    ...window,
    categories,
    annualApprovedAmount: serializeMoney(annualApprovedAmount),
    monthlyAuthorizedAmount: serializeMoney(monthlyAuthorizedAmount),
    claimedYtdBefore: serializeMoney(claimedYtdBefore),
    claimedYtdAfter: serializeMoney(claimedYtdBefore.add(monthlyAuthorizedAmount)),
  };
  return { amount: monthlyAuthorizedAmount, certificate };
}

function calculateBonusInternal(value, residency) {
  assertPlainObject(value, 'bonus', 'GH_COMPONENT_DECLARATION_REQUIRED');
  assertOnlyKeys(value, new Set([
    'amount',
    'annualBasicSalary',
    'paidYtdBefore',
    'historyEvidence',
  ]), 'bonus');
  const amount = inputMoney(value.amount, 'bonus.amount');
  if (amount.decimal.compare('0') === 0) {
    return {
      amount,
      concessionAmount: zeroMoney(),
      regularTaxableExcess: zeroMoney(),
      finalWithholding: zeroMoney(),
      annualCap: zeroMoney(),
      paidYtdBefore: zeroMoney(),
      treatment: 'none',
      evidenceReference: '',
    };
  }

  if (residency === 'nonresident') {
    return {
      amount,
      concessionAmount: amount,
      regularTaxableExcess: zeroMoney(),
      finalWithholding: exactCentRate(
        amount,
        '0.20',
        'gh.bonus.nonresident_20',
        'GH_BONUS_ROUNDING_UNCERTIFIED'
      ),
      annualCap: zeroMoney(),
      paidYtdBefore: zeroMoney(),
      treatment: 'nonresident_final_20_percent',
      evidenceReference: '',
    };
  }

  const annualBasicSalary = inputMoney(value.annualBasicSalary, 'bonus.annualBasicSalary');
  const paidYtdBefore = inputMoney(value.paidYtdBefore, 'bonus.paidYtdBefore');
  assertPlainObject(value.historyEvidence, 'bonus.historyEvidence', 'GH_BONUS_HISTORY_EVIDENCE_REQUIRED');
  assertOnlyKeys(
    value.historyEvidence,
    new Set(['sourceId', 'evidenceHashSha256', 'taxYear']),
    'bonus.historyEvidence'
  );
  if (String(value.historyEvidence.taxYear || '') !== TAX_YEAR) {
    fail('GH_BONUS_HISTORY_EVIDENCE_REQUIRED', 'bonus.historyEvidence.taxYear must be 2026');
  }
  const evidenceReference = requiredText(
    value.historyEvidence.sourceId,
    'bonus.historyEvidence.sourceId',
    'GH_BONUS_HISTORY_EVIDENCE_REQUIRED'
  );
  requireSha256(value.historyEvidence.evidenceHashSha256, 'bonus.historyEvidence.evidenceHashSha256');
  const annualCap = exactCentRate(
    annualBasicSalary,
    '0.15',
    'gh.bonus.annual_cap_15',
    'GH_BONUS_CAP_ROUNDING_UNCERTIFIED'
  );
  const remainingCap = maxZero(annualCap.subtract(paidYtdBefore));
  const concessionAmount = minMoney(amount, remainingCap);
  const regularTaxableExcess = amount.subtract(concessionAmount);
  const finalWithholding = exactCentRate(
    concessionAmount,
    '0.05',
    'gh.bonus.resident_concession_5',
    'GH_BONUS_ROUNDING_UNCERTIFIED'
  );
  return {
    amount,
    concessionAmount,
    regularTaxableExcess,
    finalWithholding,
    annualCap,
    paidYtdBefore,
    treatment: regularTaxableExcess.decimal.compare('0') > 0
      ? 'resident_5_percent_with_excess_added_to_regular_paye'
      : 'resident_5_percent_within_annual_cap',
    evidenceReference,
  };
}

function serializeBonus(result) {
  return deepFreeze({
    amount: serializeMoney(result.amount),
    annualConcessionCap: serializeMoney(result.annualCap),
    paidYtdBefore: serializeMoney(result.paidYtdBefore),
    concessionAmount: serializeMoney(result.concessionAmount),
    regularTaxableExcess: serializeMoney(result.regularTaxableExcess),
    finalWithholding: serializeMoney(result.finalWithholding),
    treatment: result.treatment,
    evidenceReference: result.evidenceReference,
    sourceReferences: ['GRA_PAYE_CURRENT', 'GRA_EMPLOYMENT_PRACTICE_NOTE'],
  });
}

function calculateBonus(payload = {}) {
  assertPlainObject(payload, 'bonusInput');
  assertOnlyKeys(payload, new Set(['residency', 'bonus']), 'bonusInput');
  if (!new Set(['resident', 'nonresident']).has(payload.residency)) {
    fail('GH_INVALID_RESIDENCY', 'residency must be resident or nonresident');
  }
  return serializeBonus(calculateBonusInternal(payload.bonus, payload.residency));
}

function calculateOvertimeInternal(value, residency, basicSalary, payDate) {
  assertPlainObject(value, 'overtime', 'GH_COMPONENT_DECLARATION_REQUIRED');
  assertOnlyKeys(value, new Set(['amount', 'eligibilityEvidence']), 'overtime');
  const amount = inputMoney(value.amount, 'overtime.amount');
  if (amount.decimal.compare('0') === 0) {
    return {
      amount,
      concessionAtFive: zeroMoney(),
      concessionAtTen: zeroMoney(),
      regularTaxableAmount: zeroMoney(),
      finalWithholding: zeroMoney(),
      treatment: 'none',
      evidenceReference: '',
    };
  }

  if (residency === 'nonresident') {
    return {
      amount,
      concessionAtFive: zeroMoney(),
      concessionAtTen: amount,
      regularTaxableAmount: zeroMoney(),
      finalWithholding: exactCentRate(
        amount,
        '0.20',
        'gh.overtime.nonresident_20',
        'GH_OVERTIME_ROUNDING_UNCERTIFIED'
      ),
      treatment: 'nonresident_final_20_percent',
      evidenceReference: '',
    };
  }

  assertPlainObject(value.eligibilityEvidence, 'overtime.eligibilityEvidence', 'GH_OVERTIME_EVIDENCE_REQUIRED');
  assertOnlyKeys(value.eligibilityEvidence, new Set([
    'juniorStaff',
    'annualQualifyingEmploymentIncome',
    'sourceId',
    'evidenceHashSha256',
    'effectiveFrom',
    'effectiveTo',
  ]), 'overtime.eligibilityEvidence');
  if (typeof value.eligibilityEvidence.juniorStaff !== 'boolean') {
    fail('GH_OVERTIME_EVIDENCE_REQUIRED', 'overtime.eligibilityEvidence.juniorStaff must be boolean');
  }
  const window = validateEvidenceWindow(value.eligibilityEvidence, 'overtime.eligibilityEvidence', payDate);
  const annualIncome = inputMoney(
    value.eligibilityEvidence.annualQualifyingEmploymentIncome,
    'overtime.eligibilityEvidence.annualQualifyingEmploymentIncome'
  );
  const evidenceReference = requiredText(
    value.eligibilityEvidence.sourceId,
    'overtime.eligibilityEvidence.sourceId',
    'GH_OVERTIME_EVIDENCE_REQUIRED'
  );
  requireSha256(
    value.eligibilityEvidence.evidenceHashSha256,
    'overtime.eligibilityEvidence.evidenceHashSha256'
  );
  const qualifies = value.eligibilityEvidence.juniorStaff
    && annualIncome.decimal.compare('18000.00') <= 0;
  if (!qualifies) {
    return {
      amount,
      concessionAtFive: zeroMoney(),
      concessionAtTen: zeroMoney(),
      regularTaxableAmount: amount,
      finalWithholding: zeroMoney(),
      treatment: 'resident_not_qualifying_added_to_regular_paye',
      evidenceReference,
      eligibility: {
        juniorStaff: value.eligibilityEvidence.juniorStaff,
        annualQualifyingEmploymentIncome: serializeMoney(annualIncome),
        threshold: serializeMoney(fixedMoney('18000.00')),
        ...window,
      },
    };
  }

  const halfBasic = exactCentRate(
    basicSalary,
    '0.50',
    'gh.overtime.fifty_percent_basic_threshold',
    'GH_OVERTIME_THRESHOLD_ROUNDING_UNCERTIFIED'
  );
  const concessionAtFive = minMoney(amount, halfBasic);
  const concessionAtTen = amount.subtract(concessionAtFive);
  const fiveTax = exactCentRate(
    concessionAtFive,
    '0.05',
    'gh.overtime.qualifying_5',
    'GH_OVERTIME_ROUNDING_UNCERTIFIED'
  );
  const tenTax = exactCentRate(
    concessionAtTen,
    '0.10',
    'gh.overtime.qualifying_excess_10',
    'GH_OVERTIME_ROUNDING_UNCERTIFIED'
  );
  return {
    amount,
    concessionAtFive,
    concessionAtTen,
    regularTaxableAmount: zeroMoney(),
    finalWithholding: fiveTax.add(tenTax),
    treatment: concessionAtTen.decimal.compare('0') > 0
      ? 'qualifying_junior_5_percent_then_10_percent_excess'
      : 'qualifying_junior_5_percent',
    evidenceReference,
    eligibility: {
      juniorStaff: true,
      annualQualifyingEmploymentIncome: serializeMoney(annualIncome),
      threshold: serializeMoney(fixedMoney('18000.00')),
      fiftyPercentBasic: serializeMoney(halfBasic),
      ...window,
    },
  };
}

function serializeOvertime(result) {
  return deepFreeze({
    amount: serializeMoney(result.amount),
    concessionAtFivePercent: serializeMoney(result.concessionAtFive),
    concessionAtTenPercent: serializeMoney(result.concessionAtTen),
    regularTaxableAmount: serializeMoney(result.regularTaxableAmount),
    finalWithholding: serializeMoney(result.finalWithholding),
    treatment: result.treatment,
    evidenceReference: result.evidenceReference,
    eligibility: result.eligibility || null,
    sourceReferences: ['GRA_PAYE_CURRENT', 'GRA_EMPLOYMENT_PRACTICE_NOTE'],
  });
}

function calculateOvertime(payload = {}) {
  assertPlainObject(payload, 'overtimeInput');
  assertOnlyKeys(payload, new Set(['taxYear', 'payDate', 'residency', 'basicSalary', 'overtime']), 'overtimeInput');
  const payDate = validatePayDate(payload.taxYear, payload.payDate);
  if (!new Set(['resident', 'nonresident']).has(payload.residency)) {
    fail('GH_INVALID_RESIDENCY', 'residency must be resident or nonresident');
  }
  const basicSalary = inputMoney(payload.basicSalary, 'basicSalary');
  return serializeOvertime(
    calculateOvertimeInternal(payload.overtime, payload.residency, basicSalary, payDate)
  );
}

function calculateVehicleBenefitInternal(type, totalCashEmoluments) {
  const rule = VEHICLE_BENEFITS[type];
  if (!rule) {
    fail('GH_UNSUPPORTED_BENEFIT_VALUATION', `${type || 'Benefit'} is not supported by the Ghana Wave 1 benefit table`);
  }
  const raw = totalCashEmoluments.multiplyByRate(rule.rate);
  const cap = fixedMoney(rule.monthlyCap);
  let amount;
  let capApplied;
  if (raw.decimal.compare(cap.decimal) > 0) {
    amount = cap;
    capApplied = true;
  } else {
    try {
      raw.toMinorUnits();
    } catch (error) {
      fail('GH_BENEFIT_ROUNDING_UNCERTIFIED', 'Official evidence does not establish sub-pesewa vehicle-benefit rounding', {
        type,
        rawAmount: raw.toString(),
      });
    }
    amount = raw;
    capApplied = false;
  }
  return { type, totalCashEmoluments, rate: rule.rate, monthlyCap: cap, amount, capApplied };
}

function serializeVehicleBenefit(result) {
  return deepFreeze({
    type: result.type,
    totalCashEmoluments: serializeMoney(result.totalCashEmoluments),
    rate: result.rate,
    monthlyCap: serializeMoney(result.monthlyCap),
    taxableValue: serializeMoney(result.amount),
    capApplied: result.capApplied,
    sourceReferences: ['GRA_ACT_1094', 'GRA_EMPLOYMENT_PRACTICE_NOTE'],
  });
}

function calculateVehicleBenefit(payload = {}) {
  assertPlainObject(payload, 'benefitInput');
  assertOnlyKeys(payload, new Set(['type', 'totalCashEmoluments']), 'benefitInput');
  const totalCashEmoluments = inputMoney(payload.totalCashEmoluments, 'totalCashEmoluments');
  return serializeVehicleBenefit(calculateVehicleBenefitInternal(payload.type, totalCashEmoluments));
}

function normalizeAllowances(values) {
  if (!Array.isArray(values)) {
    fail('GH_COMPONENT_DECLARATION_REQUIRED', 'taxableCashAllowances must be an explicit array');
  }
  let total = zeroMoney();
  const normalized = values.map((value, index) => {
    assertPlainObject(value, `taxableCashAllowances[${index}]`);
    assertOnlyKeys(value, new Set(['code', 'amount']), `taxableCashAllowances[${index}]`);
    const code = requiredText(value.code, `taxableCashAllowances[${index}].code`);
    const amount = inputMoney(value.amount, `taxableCashAllowances[${index}].amount`);
    total = total.add(amount);
    return { code, amount: serializeMoney(amount) };
  });
  return { normalized, total };
}

function normalizeBenefits(values, totalCashEmoluments, hasBonusOrOvertime) {
  if (!Array.isArray(values)) {
    fail('GH_COMPONENT_DECLARATION_REQUIRED', 'benefits must be an explicit array');
  }
  if (values.length === 0) return { normalized: [], total: zeroMoney() };
  if (values.length > 1) {
    fail('GH_UNSUPPORTED_BENEFIT_VALUATION', 'Wave 1 supports at most one statutory vehicle/fuel benefit');
  }
  const value = values[0];
  assertPlainObject(value, 'benefits[0]');
  assertOnlyKeys(value, new Set(['type']), 'benefits[0]');
  if (hasBonusOrOvertime) {
    fail(
      'GH_BENEFIT_CASH_EMOLUMENTS_BASIS_UNCERTIFIED',
      'Vehicle-benefit total cash emoluments are not certified for periods containing bonus or overtime'
    );
  }
  const benefit = calculateVehicleBenefitInternal(value.type, totalCashEmoluments);
  return { normalized: [serializeVehicleBenefit(benefit)], total: benefit.amount };
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
  period,
  dueDate,
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
      periodStart: period.start,
      periodEnd: period.end,
      dueDate,
      paymentChannel: authority.code === 'GRA' ? 'GRA Taxpayer Portal' : 'Authority or registered-scheme channel',
      accountReferenceField: authority.code === 'GRA' ? 'Employer TIN' : 'Employer and member identifiers',
    },
    calculation: { method: calculationMethod, roundingStage },
    sourceReferences,
    sourceEffectiveFrom,
    evidenceReference,
    metadata,
  }, MONEY);
}

function buildLiabilityLedger({
  period,
  pension,
  paye,
  bonus,
  overtime,
  tier2Scheme,
}) {
  const pensionBase = fixedMoney(pension.pensionableSalary.amount);
  const employeePension = fixedMoney(pension.contributions.employeeEconomic.amount);
  const employerFirstTier = fixedMoney(pension.contributions.employerFirstTier.amount);
  const tier2 = fixedMoney(pension.contributions.secondTier.amount);
  const payeAmount = fixedMoney(paye.amount.amount);
  const regularChargeable = fixedMoney(paye.chargeableIncome.amount);
  const bonusTax = bonus.finalWithholding;
  const overtimeTax = overtime.finalWithholding;
  const ssnitAuthority = {
    code: 'SSNIT',
    name: 'Social Security and National Insurance Trust',
    level: 'social_security',
    jurisdictionCode: 'GH',
  };
  const graAuthority = {
    code: 'GRA',
    name: 'Ghana Revenue Authority',
    level: 'national',
    jurisdictionCode: 'GH',
  };

  const pensionMetadata = {
    firstTierIncludesNhiaRate: '0.025',
    ssnitRetainedRate: '0.11',
    economicAndRoutingReconciliation: 'employee_5_5_to_first_tier; employer_8_to_first_tier; employer_5_to_second_tier',
  };
  const entries = [
    createLiability({
      liabilityCode: 'GH_SSNIT_TIER1_EMPLOYEE',
      name: 'Employee mandatory first-tier pension contribution',
      payer: 'employee',
      amount: employeePension,
      baseAmount: pensionBase,
      rate: '0.055',
      authority: ssnitAuthority,
      formCode: 'SSNIT_CONTRIBUTION_REPORT',
      period,
      dueDate: period.ssnitAndTier2Due,
      calculationMethod: '5.5% of clamped insurable basic salary; exact-cent cases only',
      roundingStage: 'gh.pension.employee_5_5.exact_cent_no_rounding',
      sourceReferences: ['NPRA_ACT_766', 'SSNIT_EMPLOYER_GUIDANCE', 'SSNIT_2026_MIN_MAX_NOTICE'],
      sourceEffectiveFrom: '2026-01-01',
      metadata: pensionMetadata,
    }),
    createLiability({
      liabilityCode: 'GH_SSNIT_TIER1_EMPLOYER',
      name: 'Employer portion routed to mandatory first tier',
      payer: 'employer',
      amount: employerFirstTier,
      baseAmount: pensionBase,
      rate: '0.08',
      authority: ssnitAuthority,
      formCode: 'SSNIT_CONTRIBUTION_REPORT',
      period,
      dueDate: period.ssnitAndTier2Due,
      calculationMethod: '8% employer residual routed with employee 5.5% to reconcile first-tier 13.5%',
      roundingStage: 'gh.pension.first_tier_employer_8.exact_cent_no_rounding',
      sourceReferences: ['NPRA_ACT_766', 'SSNIT_EMPLOYER_GUIDANCE', 'SSNIT_2026_MIN_MAX_NOTICE'],
      sourceEffectiveFrom: '2026-01-01',
      metadata: pensionMetadata,
    }),
    createLiability({
      liabilityCode: 'GH_NPRA_TIER2_EMPLOYER',
      name: 'Employer mandatory second-tier occupational pension contribution',
      payer: 'employer',
      amount: tier2,
      baseAmount: pensionBase,
      rate: '0.05',
      authority: {
        code: 'NPRA_REGISTERED_TIER2_SCHEME',
        name: tier2Scheme.schemeName,
        level: 'social_security',
        jurisdictionCode: 'GH',
      },
      formCode: 'NPRA_MONTHLY_CONTRIBUTION_REPORT',
      period,
      dueDate: period.ssnitAndTier2Due,
      calculationMethod: '5% of clamped insurable basic salary routed to evidenced registered Tier 2 scheme',
      roundingStage: 'gh.pension.second_tier_5.exact_cent_no_rounding',
      sourceReferences: ['NPRA_ACT_766', 'NPRA_TIER2_PAYMENT_GUIDELINES'],
      sourceEffectiveFrom: '2026-01-01',
      evidenceReference: tier2Scheme.npraRegistrationReference,
      metadata: {
        trusteeName: tier2Scheme.trusteeName,
        custodianName: tier2Scheme.custodianName,
        schemeEvidenceHashSha256: tier2Scheme.evidenceHashSha256,
        reportDueRule: 'last_working_day_of_current_month_not_computed_without_certified_business_calendar',
      },
    }),
    createLiability({
      liabilityCode: 'GH_PAYE_REGULAR',
      name: 'Regular employment PAYE',
      payer: 'employee',
      amount: payeAmount,
      baseAmount: regularChargeable,
      rate: '',
      authority: graAuthority,
      formCode: 'GRA_MONTHLY_PAYE_RETURN',
      period,
      dueDate: period.payeDue,
      calculationMethod: paye.residency === 'resident'
        ? '2024-in-force GRA resident monthly bands'
        : '25% non-resident regular employment rate',
      roundingStage: paye.residency === 'resident'
        ? 'gh.paye.half_up_per_band_to_cent'
        : 'gh.paye.nonresident_exact_cent_no_rounding',
      sourceReferences: paye.sourceReferences,
      sourceEffectiveFrom: '2024-01-01',
    }),
    createLiability({
      liabilityCode: 'GH_PAYE_BONUS_FINAL',
      name: 'Final withholding on bonus concession portion',
      payer: 'employee',
      amount: bonusTax,
      baseAmount: bonus.concessionAmount,
      rate: bonus.treatment === 'nonresident_final_20_percent' ? '0.20' : '0.05',
      authority: graAuthority,
      formCode: 'GRA_MONTHLY_PAYE_RETURN',
      period,
      dueDate: period.payeDue,
      calculationMethod: bonus.treatment,
      roundingStage: 'gh.bonus.exact_cent_no_rounding',
      sourceReferences: ['GRA_PAYE_CURRENT', 'GRA_EMPLOYMENT_PRACTICE_NOTE'],
      sourceEffectiveFrom: '2024-01-01',
      evidenceReference: bonus.evidenceReference,
    }),
    createLiability({
      liabilityCode: 'GH_PAYE_OVERTIME_FINAL',
      name: 'Final withholding on qualifying or non-resident overtime',
      payer: 'employee',
      amount: overtimeTax,
      baseAmount: overtime.amount.subtract(overtime.regularTaxableAmount),
      rate: overtime.treatment === 'nonresident_final_20_percent' ? '0.20' : '',
      authority: graAuthority,
      formCode: 'GRA_MONTHLY_PAYE_RETURN',
      period,
      dueDate: period.payeDue,
      calculationMethod: overtime.treatment,
      roundingStage: 'gh.overtime.exact_cent_no_rounding',
      sourceReferences: ['GRA_PAYE_CURRENT', 'GRA_EMPLOYMENT_PRACTICE_NOTE'],
      sourceEffectiveFrom: '2024-01-01',
      evidenceReference: overtime.evidenceReference,
    }),
  ];
  return statutoryLiabilityLedgerService.buildLedger(entries);
}

function blockedCalculation(payload, payDate, period, pension) {
  return deepFreeze({
    adapter: ADAPTER_METADATA,
    status: 'blocked_preview',
    payDate: payDate.text,
    period,
    worker: {
      workerType: payload.workerType,
      residency: payload.residency,
    },
    pension,
    paye: null,
    liabilityLedger: null,
    totals: null,
    blockingReasons: [pension.conflict],
    reviewFlags: [
      { code: 'GH_PREVIEW_NOT_POSTABLE', severity: 'blocking' },
      { code: 'GH_SSNIT_2026_MINIMUM_ALLOCATION_CONFLICT', severity: 'blocking' },
    ],
  });
}

function calculate(payload = {}) {
  assertPlainObject(payload, 'payrollInput');
  assertOnlyKeys(payload, new Set([
    'taxYear',
    'payDate',
    'payFrequency',
    'workerType',
    'residency',
    'pensionCoverage',
    'basicSalary',
    'taxableCashAllowances',
    'benefits',
    'reliefCertificate',
    'bonus',
    'overtime',
    'tier2Scheme',
  ]), 'payrollInput');
  const payDate = validatePayDate(payload.taxYear, payload.payDate);
  if (payload.payFrequency !== 'monthly') {
    fail('GH_UNSUPPORTED_PAY_FREQUENCY', 'Wave 1 supports monthly payroll only');
  }
  if (payload.workerType !== 'regular_permanent') {
    fail(
      'GH_UNSUPPORTED_WORKER_TYPE',
      'Casual, temporary, seasonal, expatriate, and other edge-case worker classifications remain uncertified'
    );
  }
  if (!new Set(['resident', 'nonresident']).has(payload.residency)) {
    fail('GH_INVALID_RESIDENCY', 'residency must be resident or nonresident');
  }
  if (payload.pensionCoverage !== 'mandatory_act_766') {
    fail('GH_UNSUPPORTED_PENSION_COVERAGE', 'Wave 1 supports only mandatory Act 766 coverage');
  }
  const basicSalary = inputMoney(payload.basicSalary, 'basicSalary');
  if (basicSalary.decimal.compare('0') <= 0) {
    fail('GH_INVALID_MONEY', 'basicSalary must be greater than zero');
  }
  const period = monthPeriod(payDate.date);
  const tier2Scheme = normalizeTier2Scheme(payload.tier2Scheme, payDate);
  const pension = calculatePension({
    taxYear: payload.taxYear,
    payDate: payload.payDate,
    basicSalary: payload.basicSalary,
    tier2Scheme: payload.tier2Scheme,
  });
  if (pension.status !== 'calculated_preview') {
    return blockedCalculation(payload, payDate, period, pension);
  }

  const allowances = normalizeAllowances(payload.taxableCashAllowances);
  const bonus = calculateBonusInternal(payload.bonus, payload.residency);
  const overtime = calculateOvertimeInternal(
    payload.overtime,
    payload.residency,
    basicSalary,
    payDate
  );
  const hasBonusOrOvertime = bonus.amount.decimal.compare('0') > 0
    || overtime.amount.decimal.compare('0') > 0;
  const regularCashBeforeVariablePay = basicSalary.add(allowances.total);
  const benefits = normalizeBenefits(
    payload.benefits,
    regularCashBeforeVariablePay,
    hasBonusOrOvertime
  );
  const relief = normalizeRelief(payload.reliefCertificate, payload.residency, payDate);
  const employeePension = fixedMoney(pension.contributions.employeeEconomic.amount);
  const regularChargeableIncome = maxZero(
    regularCashBeforeVariablePay
      .add(benefits.total)
      .add(bonus.regularTaxableExcess)
      .add(overtime.regularTaxableAmount)
      .subtract(employeePension)
      .subtract(relief.amount)
  );
  const paye = payload.residency === 'resident'
    ? calculateResidentPaye(regularChargeableIncome.toFixed())
    : deepFreeze(calculateNonresidentPaye(regularChargeableIncome));
  const regularPaye = fixedMoney(paye.amount.amount);
  const totalWithholding = regularPaye.add(bonus.finalWithholding).add(overtime.finalWithholding);
  const grossCashPay = regularCashBeforeVariablePay.add(bonus.amount).add(overtime.amount);
  const netCashPay = grossCashPay.subtract(employeePension).subtract(totalWithholding);
  if (netCashPay.decimal.compare('0') < 0) {
    fail('GH_NEGATIVE_NET_PAY_UNSUPPORTED', 'Wave 1 does not certify negative net pay or arrears recovery handling');
  }
  const employerPension = fixedMoney(pension.contributions.employerEconomic.amount);
  const liabilityLedger = buildLiabilityLedger({
    period,
    pension,
    paye,
    bonus,
    overtime,
    tier2Scheme,
  });

  return deepFreeze({
    adapter: ADAPTER_METADATA,
    status: 'preview_calculated_non_postable',
    payDate: payDate.text,
    period: {
      ...period,
      dueDateConvention: 'fixed_calendar_day; weekend_and_public_holiday_adjustments_not_certified',
      tier2ReportRule: 'monthly reports by last working day; date not computed without a certified Ghana business calendar',
    },
    worker: {
      workerType: payload.workerType,
      residency: payload.residency,
      pensionCoverage: payload.pensionCoverage,
    },
    earnings: {
      basicSalary: serializeMoney(basicSalary),
      taxableCashAllowances: allowances.normalized,
      taxableCashAllowanceTotal: serializeMoney(allowances.total),
      benefits: benefits.normalized,
      taxableBenefitTotal: serializeMoney(benefits.total),
      grossCashPay: serializeMoney(grossCashPay),
    },
    pension,
    relief: {
      amount: serializeMoney(relief.amount),
      certificate: relief.certificate,
    },
    bonus: serializeBonus(bonus),
    overtime: serializeOvertime(overtime),
    paye,
    liabilityLedger,
    totals: {
      employeePension: serializeMoney(employeePension),
      employerPension: serializeMoney(employerPension),
      totalTaxWithholding: serializeMoney(totalWithholding),
      employeeStatutoryDeductions: serializeMoney(employeePension.add(totalWithholding)),
      employerStatutoryCost: serializeMoney(employerPension),
      netCashPay: serializeMoney(netCashPay),
      totalEmployerCashCost: serializeMoney(grossCashPay.add(employerPension)),
    },
    reviewFlags: [
      { code: 'GH_PREVIEW_NOT_POSTABLE', severity: 'blocking' },
      {
        code: 'GH_GRA_TOP_BAND_SOURCE_CONFLICT',
        severity: 'guarded',
        detail: 'Resident monthly chargeable income above GHS 50,000 is rejected.',
      },
      {
        code: 'GH_SSNIT_2026_MINIMUM_ALLOCATION_CONFLICT',
        severity: 'guarded',
        detail: 'The GHS 587.80 minimum earnings case is returned blocked, not rounded by inference.',
      },
      {
        code: 'GH_DUE_DATE_ADJUSTMENT_UNCERTIFIED',
        severity: 'review',
        detail: 'Weekend/public-holiday movement and the Tier 2 last-working-day report date require a certified business calendar.',
      },
    ],
  });
}

module.exports = {
  calculate,
  calculatePension,
  calculateResidentPaye,
  calculateBonus,
  calculateOvertime,
  calculateVehicleBenefit,
  GhanaPayroll2026Error,
  OFFICIAL_SOURCES,
  RESIDENT_MONTHLY_BANDS,
  VEHICLE_BENEFITS,
  ADAPTER_METADATA,
};
