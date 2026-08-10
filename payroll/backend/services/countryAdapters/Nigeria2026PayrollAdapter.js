'use strict';

/**
 * Nigeria 2026 payroll Wave 1.
 *
 * This is a standalone, pure, preview-only adapter. It is intentionally not
 * registered with TaxJurisdictionService and cannot create postable payroll.
 * The supported contract is deliberately narrow: an ordinary resident
 * private-sector employee, employed on unchanged monthly cash terms for all
 * of 2026 by an organisation with at least five employees, with certified
 * pinned synthetic State/FCT preview routing and complete statutory evidence.
 */

const statutoryMoneyService = require('../StatutoryMoneyService');
const statutoryLiabilityLedgerService = require('../StatutoryLiabilityLedgerService');
const { ROUNDING_MODES } = require('../StatutoryMoneyService');

const MONEY = Object.freeze({ currency: 'NGN', minorUnits: 2 });
const HALF_UP = ROUNDING_MODES.HALF_UP;

const SOURCE_VERSIONS = Object.freeze({
  JRB_PIT_2026: 'JRB_PIT_GUIDELINES_2026_2026-02-24',
});

const OFFICIAL_SOURCES = deepFreeze({
  NIGERIA_TAX_ACT_2025: {
    authority: 'National Assembly of the Federal Republic of Nigeria',
    title: 'Nigeria Tax Act, 2025 (official authenticated copy)',
    url: 'https://nass.gov.ng/documents/download/11249',
    effectiveFrom: '2026-01-01',
    supports: [
      'individual eligible deductions in sections 30 to 32',
      'minimum-wage employment exemption in section 162(1)(t)',
      'individual rates in section 58 and the Fourth Schedule',
      'absence of the former consolidated relief allowance from the enacted 2026 deductions',
    ],
  },
  STATE_HOUSE_COMMENCEMENT_2026: {
    authority: 'State House, Federal Republic of Nigeria',
    title: 'New tax laws will commence on January 1, 2026 as planned',
    url: 'https://statehouse.gov.ng/new-tax-laws-will-commence-on-january-1-2026-as-planned/',
    effectiveFrom: '2026-01-01',
    supports: ['1 January 2026 commencement date for the new tax laws'],
  },
  JRB_PIT_GUIDELINES_2026: {
    authority: 'Joint Revenue Board of Nigeria',
    title: 'Personal Income Tax Guidelines, 2026',
    url: 'https://www.jrb.gov.ng/assets/2026-pit-guidelines-TJG3n9-T.pdf',
    effectiveFrom: '2026-01-01',
    supports: [
      'PAYE registration, records, annual computation template and tax bands',
      'actual evidenced pension, NHF and NHIA deductions',
      'rent relief evidence and annual attribution',
      'monthly PAYE remittance by the tenth day of the following month',
      'State/FCT resident employee routing and Nigeria Revenue Service special-population routing',
      'year-to-date cumulative payroll and corresponding-tax records',
      'NGN 70,000 current monthly minimum-wage exempt return threshold',
    ],
  },
  PENCOM_PRA_2014: {
    authority: 'National Pension Commission',
    title: 'Pension Reform Act, 2014',
    url: 'https://www.pencom.gov.ng/wp-content/uploads/2018/01/PRA_2014.pdf',
    effectiveFrom: '2014-07-01',
    supports: [
      'mandatory private-sector CPS participation from three employees',
      'minimum employer 10% and employee 8% contributions',
      'monthly emoluments contract base not below basic, housing and transport',
      'seven-working-day remittance and statutory exemptions',
      'group life cover of at least three times annual total emoluments',
    ],
  },
  PENCOM_COMPLIANCE_CIRCULAR_2025: {
    authority: 'National Pension Commission',
    title: 'Circular on compliance with the PRA 2014 by service providers and vendors',
    url: 'https://www.pencom.gov.ng/wp-content/uploads/2025/05/CIRCULAR-ON-COMPLIANCE-WITH-PROVISIONS-OF-PRA-APPROVED.docx.pdf',
    effectiveFrom: '2025-05-01',
    supports: ['current PenCom confirmation of remittance not later than seven working days after salary payment'],
  },
  PENCOM_PERSONAL_PENSION_PLAN: {
    authority: 'National Pension Commission',
    title: 'Personal Pension Plan',
    url: 'https://www.pencom.gov.ng/personal-pension-plan-ppp/',
    effectiveFrom: '2025-01-01',
    supports: ['employees of organisations with fewer than three employees use a separate voluntary plan'],
  },
  FMBN_NHF_ACT: {
    authority: 'Federal Mortgage Bank of Nigeria',
    title: 'National Housing Fund Act, Cap. N45',
    url: 'https://fmbn.gov.ng/documents/National_Housing_Fund_Act.pdf',
    effectiveFrom: '1992-01-31',
    supports: ['employee 2.5% contribution', 'NGN 3,000 annual basic-salary threshold', 'remittance within one month'],
  },
  FMBN_CURRENT_LEGAL_FRAMEWORK: {
    authority: 'Federal Mortgage Bank of Nigeria',
    title: 'National Housing Fund Scheme — Legal Framework',
    url: 'https://fmbn.gov.ng/products/nhf-scheme/legal-framework',
    effectiveFrom: '1992-01-31',
    supports: ['current FMBN confirmation that Act 3 of 1992 remains the NHF legal framework while amendment work continues'],
  },
  NSITF_ECS_2026: {
    authority: 'Nigeria Social Insurance Trust Fund',
    title: 'Employees Compensation Scheme official guidance',
    url: 'https://nsitf.gov.ng/publications/',
    effectiveFrom: '2010-12-17',
    supports: [
      'current published 1% employer rate on total monthly employee payroll, subject to NSITF assessment',
      'employee deductions prohibited',
      'all employees other than Armed Forces covered',
      'ECS RE01 registration and ECS RE03 payment schedule',
      'payment after NSITF assessment',
    ],
  },
  ITF_AMENDMENT_ACT_2011: {
    authority: 'Industrial Training Fund',
    title: 'Industrial Training Fund (Amendment) Act, 2011',
    url: 'https://www.itf.gov.ng/ftp/ITF-ACT-2011.pdf',
    effectiveFrom: '2011-06-03',
    supports: [
      '1% of total annual payroll',
      'five-employee or NGN 50 million turnover liability tests',
      'broad statutory payroll definition',
      '1 April of the following year prescribed date',
    ],
  },
  ITF_FORM_5A: {
    authority: 'Industrial Training Fund',
    title: 'ITF Form 5A employer annual return and payroll guide',
    url: 'https://www.itf.gov.ng/ftp/ITF_Form_5A%282021%29.pdf',
    effectiveFrom: '2021-01-01',
    supports: ['certified annual payroll return basis and included remuneration categories'],
  },
  ITF_CURRENT_REVENUE_GUIDANCE: {
    authority: 'Industrial Training Fund',
    title: 'Revenue, Inspectorate and Compliance — Sources of Revenue',
    url: 'https://itf.gov.ng/departments/revenue.html',
    effectiveFrom: '2011-06-03',
    supports: ['current ITF operational confirmation of the 1% statutory annual-payroll contribution'],
  },
  NHIA_ACT_2022: {
    authority: 'National Health Insurance Authority',
    title: 'National Health Insurance Authority Act, 2022 (gazetted copy)',
    url: 'https://www.nhia.gov.ng/wp-content/uploads/2024/03/NHIA-Act-2022-Gazetted-Copy.pdf',
    effectiveFrom: '2022-05-19',
    supports: ['mandatory health-insurance framework', 'employer and employee contributions as tax-deductible expenses'],
  },
  NHIA_FORMAL_SECTOR_FAQ: {
    authority: 'National Health Insurance Authority',
    title: 'Formal Sector Social Health Insurance Programme FAQ',
    url: 'https://www.nhia.gov.ng/faq/',
    effectiveFrom: '2022-05-19',
    supports: ['basic-salary method of 10% employer and 5% employee paid monthly'],
  },
  NHIA_OPSSHIP: {
    authority: 'National Health Insurance Authority',
    title: 'Organized Private Sector Social Health Insurance Programme',
    url: 'https://www.nhia.gov.ng/service/gifship/',
    effectiveFrom: '2022-05-19',
    supports: ['organised private-sector scope from five employees and employer enrolment'],
  },
  NHIA_OPSSHIP_REGISTRATION: {
    authority: 'National Health Insurance Authority',
    title: 'Registration requirements for Organized Private Sector',
    url: 'https://www.nhia.gov.ng/requirement-for-organized-private-sector/',
    effectiveFrom: '2022-05-19',
    supports: ['NGN 30,000 minimum basic salary', 'NHIA-computed funding and explicit contribution evidence'],
  },
});

const PAYE_BANDS = deepFreeze([
  { code: 'BAND_1', width: '800000.00', rate: '0.00' },
  { code: 'BAND_2', width: '2200000.00', rate: '0.15' },
  { code: 'BAND_3', width: '9000000.00', rate: '0.18' },
  { code: 'BAND_4', width: '13000000.00', rate: '0.21' },
  { code: 'BAND_5', width: '25000000.00', rate: '0.23' },
  { code: 'BAND_6', width: null, rate: '0.25' },
]);

// Wave 1 has no production State/FCT route registry. These exact receipts
// exist only so source-backed calculation fixtures can exercise the liability
// shape without accepting caller-asserted authority data. A published pack
// must resolve its route from the trusted effective-dated server registry.
const PREVIEW_ROUTE_RECEIPTS = deepFreeze({
  'NG-LA-2026-LIRS-SYNTHETIC-PREVIEW': {
    authorityType: 'state_irs',
    authorityCode: 'LIRS',
    authorityName: 'Lagos State Internal Revenue Service',
    jurisdictionCode: 'NG-LA',
    formCode: 'LIRS_PAYE_MONTHLY',
    paymentChannel: 'certified LIRS employer portal route',
    routeCertificationReference: 'FIXTURE_CERTIFIED_LIRS_2026_ROUTE_ADAPTER',
  },
  'NG-FC-2026-FCTIRS-SYNTHETIC-PREVIEW': {
    authorityType: 'fct_irs',
    authorityCode: 'FCT_IRS',
    authorityName: 'Federal Capital Territory Internal Revenue Service',
    jurisdictionCode: 'NG-FC',
    formCode: 'FCT_IRS_PAYE_MONTHLY',
    paymentChannel: 'synthetic FCT IRS employer portal route',
    routeCertificationReference: 'FIXTURE_CERTIFIED_FCT_2026_ROUTE_ADAPTER',
  },
});

const TOP_LEVEL_KEYS = new Set([
  'payDate',
  'taxYear',
  'taxSourceVersion',
  'employment',
  'earnings',
  'benefits',
  'reimbursements',
  'nonPeriodicPayments',
  'ytd',
  'reliefs',
  'taxAuthority',
  'pension',
  'nhf',
  'nhia',
  'nsitf',
  'itf',
  'businessCalendar',
]);

class NigeriaPayrollAdapterError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'NigeriaPayrollAdapterError';
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
  throw new NigeriaPayrollAdapterError(code, message, details);
}

function requiredText(value, label, code = 'NIGERIA_REQUIRED_EVIDENCE_MISSING') {
  const text = String(value || '').trim();
  if (!text) fail(code, `${label} is required`);
  return text;
}

function assertObject(value, label, code = 'NIGERIA_INVALID_INPUT') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(code, `${label} must be an object`);
  }
}

function assertOnlyKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail('NIGERIA_UNSUPPORTED_INPUT', `${label}.${key} is not supported`, { path: `${label}.${key}` });
    }
  }
}

function parseDateOnly(value, label, code = 'NIGERIA_INVALID_DATE') {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) fail(code, `${label} must use YYYY-MM-DD`);
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    fail(code, `${label} is not a valid calendar date`);
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

function nextMonthDay(date, day) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, day));
}

function oneCalendarMonthAfter(date) {
  const targetMonth = date.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(date.getUTCFullYear(), targetMonth, Math.min(date.getUTCDate(), lastDay)));
}

function addWorkingDays(date, count, holidays) {
  const cursor = new Date(date.getTime());
  let added = 0;
  while (added < count) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day === 0 || day === 6 || holidays.has(isoDate(cursor))) continue;
    added += 1;
  }
  return cursor;
}

function inputMoney(value, label) {
  let amount;
  try {
    amount = statutoryMoneyService.create(value, MONEY);
    amount.toMinorUnits();
  } catch (error) {
    fail('NIGERIA_INVALID_MONEY', `${label} must be a non-negative NGN amount with at most two decimal places`, {
      cause: error.message,
    });
  }
  if (amount.decimal.compare('0') < 0) fail('NIGERIA_INVALID_MONEY', `${label} cannot be negative`);
  return amount;
}

function zeroMoney() {
  return statutoryMoneyService.create('0.00', MONEY);
}

function fixedMoney(value) {
  return statutoryMoneyService.create(value, MONEY);
}

function minMoney(left, right) {
  return left.decimal.compare(right.decimal) <= 0 ? left : right;
}

function maxZero(value) {
  return value.decimal.compare('0') < 0 ? zeroMoney() : value;
}

function roundMoney(amount, stage) {
  return amount.roundToMinorUnit({ mode: HALF_UP, stage });
}

function roundedRate(amount, rate, stage) {
  return roundMoney(amount.multiplyByRate(rate), stage);
}

function roundPositiveRational(numerator, denominator) {
  if (numerator < 0n || denominator <= 0n) throw new RangeError('Positive rational expected');
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return quotient + (remainder * 2n >= denominator ? 1n : 0n);
}

function roundedCentsFraction(amount, numerator, denominator, stage) {
  const cents = roundPositiveRational(amount.toMinorUnits() * BigInt(numerator), BigInt(denominator));
  return statutoryMoneyService.fromMinorUnits(cents, MONEY).roundToMinorUnit({ mode: HALF_UP, stage });
}

function serializeMoney(amount) {
  return {
    amount: amount.toFixed(),
    currency: MONEY.currency,
    minorUnits: MONEY.minorUnits,
    roundingHistory: amount.roundingHistory.map((event) => ({ ...event })),
  };
}

function normalizeEmployment(value) {
  assertObject(value, 'employment');
  assertOnlyKeys(value, new Set([
    'workerCategory', 'employerSector', 'employeeCount', 'employmentStartDate', 'expectedEmploymentEndDate',
    'stableMonthlyTermsFor2026', 'residentInSameJurisdictionFor2026', 'evidenceReference',
    'residencyEvidenceReference', 'groupLifePolicyEvidenceReference',
  ]), 'employment');
  if (value.workerCategory !== 'ordinary_resident_private_employee') {
    fail('NIGERIA_UNSUPPORTED_WORKER_CATEGORY', 'Only ordinary resident private-sector employees are supported');
  }
  if (value.employerSector !== 'organized_private') {
    fail('NIGERIA_UNSUPPORTED_EMPLOYER_SECTOR', 'Only organised private-sector employers are supported');
  }
  if (!Number.isSafeInteger(value.employeeCount) || value.employeeCount < 5) {
    fail('NIGERIA_UNSUPPORTED_EMPLOYER_SIZE', 'Wave 1 requires at least five employees so CPS, OPSSHIP and ITF scope are evidenced');
  }
  const start = parseDateOnly(value.employmentStartDate, 'employment.employmentStartDate');
  const end = parseDateOnly(value.expectedEmploymentEndDate, 'employment.expectedEmploymentEndDate');
  if (start.text > '2026-01-01' || end.text < '2026-12-31' || value.stableMonthlyTermsFor2026 !== true) {
    fail('NIGERIA_UNSUPPORTED_MIDYEAR_CORRECTION', 'Starters, leavers, pay changes and other mid-year projections are outside Wave 1');
  }
  if (value.residentInSameJurisdictionFor2026 !== true) {
    fail('NIGERIA_STATE_ROUTE_REQUIRED', 'Residence in one certified State/FCT jurisdiction for all of 2026 must be confirmed');
  }
  return {
    ...value,
    evidenceReference: requiredText(value.evidenceReference, 'employment.evidenceReference'),
    residencyEvidenceReference: requiredText(value.residencyEvidenceReference, 'employment.residencyEvidenceReference'),
    groupLifePolicyEvidenceReference: requiredText(
      value.groupLifePolicyEvidenceReference,
      'employment.groupLifePolicyEvidenceReference'
    ),
  };
}

function normalizeEarnings(value) {
  assertObject(value, 'earnings');
  assertOnlyKeys(value, new Set([
    'basicSalary', 'housingAllowance', 'transportAllowance', 'otherRegularCash',
    'pensionableMonthlyEmoluments', 'evidenceReference',
  ]), 'earnings');
  const basic = inputMoney(value.basicSalary, 'earnings.basicSalary');
  const housing = inputMoney(value.housingAllowance, 'earnings.housingAllowance');
  const transport = inputMoney(value.transportAllowance, 'earnings.transportAllowance');
  const other = inputMoney(value.otherRegularCash, 'earnings.otherRegularCash');
  const pensionable = inputMoney(value.pensionableMonthlyEmoluments, 'earnings.pensionableMonthlyEmoluments');
  const gross = basic.add(housing).add(transport).add(other);
  const statutoryMinimumPensionBase = basic.add(housing).add(transport);
  if (pensionable.decimal.compare(statutoryMinimumPensionBase.decimal) < 0 || pensionable.decimal.compare(gross.decimal) > 0) {
    fail(
      'NIGERIA_INVALID_PENSION_BASE',
      'Pensionable monthly emoluments must be at least basic plus housing plus transport and cannot exceed cash gross in this no-benefit adapter'
    );
  }
  return {
    basic, housing, transport, other, pensionable, gross,
    evidenceReference: requiredText(value.evidenceReference, 'earnings.evidenceReference'),
  };
}

function assertEmptyArray(value, label, code) {
  if (!Array.isArray(value)) fail('NIGERIA_INVALID_INPUT', `${label} must be an explicit array`);
  if (value.length > 0) fail(code, `${label} are outside the Wave 1 valuation contract`);
}

function normalizeTaxAuthority(value) {
  assertObject(value, 'taxAuthority', 'NIGERIA_STATE_ROUTE_REQUIRED');
  assertOnlyKeys(value, new Set([
    'authorityType', 'authorityCode', 'authorityName', 'jurisdictionCode', 'formCode', 'paymentChannel',
    'employerRegistrationReference', 'employeeTaxIdReference', 'routeCertificationReference', 'previewRouteReceiptId',
  ]), 'taxAuthority');
  if (!new Set(['state_irs', 'fct_irs']).has(value.authorityType)) {
    fail('NIGERIA_STATE_ROUTE_REQUIRED', 'A State IRS or FCT IRS route is required; NRS special-population routes are excluded');
  }
  const jurisdictionCode = requiredText(value.jurisdictionCode, 'taxAuthority.jurisdictionCode', 'NIGERIA_STATE_ROUTE_REQUIRED').toUpperCase();
  if (!/^NG-[A-Z]{2}$/.test(jurisdictionCode)) {
    fail('NIGERIA_STATE_ROUTE_REQUIRED', 'taxAuthority.jurisdictionCode must be an ISO-style NG-XX subdivision code');
  }
  if (value.authorityType === 'fct_irs' && jurisdictionCode !== 'NG-FC') {
    fail('NIGERIA_STATE_ROUTE_REQUIRED', 'FCT IRS routing requires jurisdictionCode NG-FC');
  }
  if (value.authorityType === 'state_irs' && jurisdictionCode === 'NG-FC') {
    fail('NIGERIA_STATE_ROUTE_REQUIRED', 'NG-FC must use the FCT IRS route type');
  }
  const previewRouteReceiptId = requiredText(
    value.previewRouteReceiptId,
    'taxAuthority.previewRouteReceiptId',
    'NIGERIA_STATE_ADAPTER_NOT_CERTIFIED'
  );
  const receipt = PREVIEW_ROUTE_RECEIPTS[previewRouteReceiptId];
  if (!receipt) {
    fail(
      'NIGERIA_STATE_ADAPTER_NOT_CERTIFIED',
      'The route is not an exact pinned synthetic preview receipt; production routes must come from the trusted effective-dated registry'
    );
  }
  for (const field of [
    'authorityType', 'authorityCode', 'authorityName', 'jurisdictionCode',
    'formCode', 'paymentChannel', 'routeCertificationReference',
  ]) {
    if (value[field] !== receipt[field]) {
      fail(
        'NIGERIA_STATE_ADAPTER_NOT_CERTIFIED',
        `taxAuthority.${field} does not match pinned preview route receipt ${previewRouteReceiptId}`
      );
    }
  }
  return {
    authorityType: value.authorityType,
    authorityCode: requiredText(value.authorityCode, 'taxAuthority.authorityCode'),
    authorityName: requiredText(value.authorityName, 'taxAuthority.authorityName'),
    jurisdictionCode,
    formCode: requiredText(value.formCode, 'taxAuthority.formCode'),
    paymentChannel: requiredText(value.paymentChannel, 'taxAuthority.paymentChannel'),
    employerRegistrationReference: requiredText(value.employerRegistrationReference, 'taxAuthority.employerRegistrationReference'),
    employeeTaxIdReference: requiredText(value.employeeTaxIdReference, 'taxAuthority.employeeTaxIdReference'),
    routeCertificationReference: requiredText(value.routeCertificationReference, 'taxAuthority.routeCertificationReference'),
    previewRouteReceiptId,
  };
}

function normalizePension(value) {
  assertObject(value, 'pension');
  assertOnlyKeys(value, new Set([
    'scheme', 'exemptionStatus', 'employeeRate', 'employerRate', 'rsaPinEvidenceReference',
    'pfaCode', 'pfaName', 'pfcCode', 'pfcName', 'registrationEvidenceReference',
  ]), 'pension');
  if (value.scheme !== 'pra2014_standard_cps' || value.exemptionStatus !== 'none') {
    fail('NIGERIA_UNSUPPORTED_PENSION_SCHEME', 'Only the non-exempt standard PRA 2014 CPS split is supported');
  }
  if (String(value.employeeRate) !== '0.08' || String(value.employerRate) !== '0.10') {
    fail('NIGERIA_UNSUPPORTED_PENSION_RATE', 'Wave 1 supports the statutory minimum 8% employee and 10% employer split only');
  }
  return {
    ...value,
    rsaPinEvidenceReference: requiredText(value.rsaPinEvidenceReference, 'pension.rsaPinEvidenceReference'),
    pfaCode: requiredText(value.pfaCode, 'pension.pfaCode'),
    pfaName: requiredText(value.pfaName, 'pension.pfaName'),
    pfcCode: requiredText(value.pfcCode, 'pension.pfcCode'),
    pfcName: requiredText(value.pfcName, 'pension.pfcName'),
    registrationEvidenceReference: requiredText(value.registrationEvidenceReference, 'pension.registrationEvidenceReference'),
  };
}

function normalizeNhf(value) {
  assertObject(value, 'nhf');
  assertOnlyKeys(value, new Set(['registered', 'employerNumberEvidenceReference', 'participationNumberEvidenceReference']), 'nhf');
  if (value.registered !== true) fail('NIGERIA_NHF_REGISTRATION_REQUIRED', 'NHF registration must be confirmed');
  return {
    employerNumberEvidenceReference: requiredText(value.employerNumberEvidenceReference, 'nhf.employerNumberEvidenceReference'),
    participationNumberEvidenceReference: requiredText(value.participationNumberEvidenceReference, 'nhf.participationNumberEvidenceReference'),
  };
}

function normalizeSchemeDueDate(value, label, payPeriodEnd) {
  const due = parseDateOnly(value, label, 'NIGERIA_REMITTANCE_EVIDENCE_REQUIRED');
  if (due.date < payPeriodEnd) {
    fail('NIGERIA_REMITTANCE_EVIDENCE_REQUIRED', `${label} cannot be before the payroll period end`);
  }
  return due;
}

function normalizeNhia(value, payPeriodEnd) {
  assertObject(value, 'nhia');
  assertOnlyKeys(value, new Set([
    'programme', 'basisMethod', 'employeeRate', 'employerRate', 'employerPaysEmployeeShare',
    'enrolmentEvidenceReference', 'fundingScheduleEvidenceReference', 'currentContributionDueDate',
    'currentRemittanceCommitmentEvidenceReference',
  ]), 'nhia');
  if (value.programme !== 'opsship' || value.basisMethod !== 'basic_salary') {
    fail('NIGERIA_UNSUPPORTED_NHIA_PROGRAMME', 'Only evidenced OPSSHIP on the basic-salary method is supported');
  }
  if (String(value.employeeRate) !== '0.05' || String(value.employerRate) !== '0.10' || value.employerPaysEmployeeShare !== false) {
    fail('NIGERIA_UNSUPPORTED_NHIA_RATE', 'Wave 1 supports the 5% employee / 10% employer basic-salary split only');
  }
  return {
    dueDate: normalizeSchemeDueDate(value.currentContributionDueDate, 'nhia.currentContributionDueDate', payPeriodEnd),
    enrolmentEvidenceReference: requiredText(value.enrolmentEvidenceReference, 'nhia.enrolmentEvidenceReference'),
    fundingScheduleEvidenceReference: requiredText(value.fundingScheduleEvidenceReference, 'nhia.fundingScheduleEvidenceReference'),
    currentRemittanceCommitmentEvidenceReference: requiredText(
      value.currentRemittanceCommitmentEvidenceReference,
      'nhia.currentRemittanceCommitmentEvidenceReference'
    ),
  };
}

function normalizeNsitf(value, payPeriodEnd) {
  assertObject(value, 'nsitf');
  assertOnlyKeys(value, new Set([
    'registered', 'assessedRate', 'employerRegistrationReference', 'assessmentEvidenceReference',
    'assessmentDueDate', 'paymentChannel',
  ]), 'nsitf');
  if (value.registered !== true || String(value.assessedRate) !== '0.01') {
    fail('NIGERIA_NSITF_ASSESSMENT_REQUIRED', 'A current 1% NSITF registration and assessment are required');
  }
  return {
    dueDate: normalizeSchemeDueDate(value.assessmentDueDate, 'nsitf.assessmentDueDate', payPeriodEnd),
    employerRegistrationReference: requiredText(value.employerRegistrationReference, 'nsitf.employerRegistrationReference'),
    assessmentEvidenceReference: requiredText(value.assessmentEvidenceReference, 'nsitf.assessmentEvidenceReference'),
    paymentChannel: requiredText(value.paymentChannel, 'nsitf.paymentChannel'),
  };
}

function normalizeItf(value, employeeCount) {
  assertObject(value, 'itf');
  assertOnlyKeys(value, new Set([
    'registered', 'liableBy', 'employerRegistrationReference', 'form5AAnnualPayrollAllocation',
    'form5ABasisEvidenceReference', 'calculationScope',
  ]), 'itf');
  if (value.registered !== true || !new Set(['employee_count', 'annual_turnover']).has(value.liableBy)) {
    fail('NIGERIA_ITF_BASIS_REQUIRED', 'ITF registration and a statutory liability test are required');
  }
  if (value.liableBy === 'employee_count' && employeeCount < 5) {
    fail('NIGERIA_ITF_BASIS_REQUIRED', 'The employee-count ITF route requires at least five employees');
  }
  if (value.calculationScope !== 'employee_component_for_employer_aggregate') {
    fail('NIGERIA_ITF_BASIS_REQUIRED', 'ITF must be calculated as an employee component for employer-level aggregation');
  }
  const annualPayrollAllocation = inputMoney(value.form5AAnnualPayrollAllocation, 'itf.form5AAnnualPayrollAllocation');
  if (annualPayrollAllocation.decimal.compare('0') <= 0) fail('NIGERIA_ITF_BASIS_REQUIRED', 'ITF Form 5A annual payroll allocation must be positive');
  return {
    annualPayrollAllocation,
    employerRegistrationReference: requiredText(value.employerRegistrationReference, 'itf.employerRegistrationReference'),
    form5ABasisEvidenceReference: requiredText(value.form5ABasisEvidenceReference, 'itf.form5ABasisEvidenceReference'),
    liableBy: value.liableBy,
  };
}

function normalizeCalendar(value) {
  assertObject(value, 'businessCalendar', 'NIGERIA_BUSINESS_CALENDAR_REQUIRED');
  assertOnlyKeys(value, new Set(['publicHolidays', 'evidenceReference']), 'businessCalendar');
  if (!Array.isArray(value.publicHolidays)) {
    fail('NIGERIA_BUSINESS_CALENDAR_REQUIRED', 'businessCalendar.publicHolidays must be an explicit array');
  }
  return {
    holidays: new Set(value.publicHolidays.map((entry, index) => parseDateOnly(entry, `businessCalendar.publicHolidays[${index}]`).text)),
    evidenceReference: requiredText(value.evidenceReference, 'businessCalendar.evidenceReference', 'NIGERIA_BUSINESS_CALENDAR_REQUIRED'),
  };
}

function normalizeReliefMoney(value, key, amountKey, allowedExtraKeys, validator) {
  if (value === null) return { amount: zeroMoney(), evidenceReference: '', metadata: {} };
  assertObject(value, `reliefs.${key}`);
  assertOnlyKeys(value, new Set([amountKey, 'evidenceReference', ...allowedExtraKeys]), `reliefs.${key}`);
  const amount = inputMoney(value[amountKey], `reliefs.${key}.${amountKey}`);
  if (amount.decimal.compare('0') === 0) return { amount, evidenceReference: '', metadata: {} };
  if (validator) validator(value);
  return {
    amount,
    evidenceReference: requiredText(value.evidenceReference, `reliefs.${key}.evidenceReference`),
    metadata: { ...value, [amountKey]: amount.toFixed(), evidenceReference: undefined },
  };
}

function normalizeReliefs(value) {
  assertObject(value, 'reliefs');
  assertOnlyKeys(value, new Set(['mortgageInterest', 'lifeOrDeferredAnnuity', 'rent']), 'reliefs');
  const mortgage = normalizeReliefMoney(
    value.mortgageInterest,
    'mortgageInterest',
    'annualInterestAttributableTo2026',
    ['ownerOccupiedPrincipalResidence', 'lenderReference'],
    (entry) => {
      if (entry.ownerOccupiedPrincipalResidence !== true) {
        fail('NIGERIA_UNSUPPORTED_RELIEF', 'Mortgage-interest relief requires an owner-occupied principal residence');
      }
      requiredText(entry.lenderReference, 'reliefs.mortgageInterest.lenderReference');
    }
  );
  const life = normalizeReliefMoney(
    value.lifeOrDeferredAnnuity,
    'lifeOrDeferredAnnuity',
    'annualPremiumPaidIn2025',
    ['contractType', 'insuredRelationship'],
    (entry) => {
      if (!new Set(['life_insurance', 'deferred_annuity']).has(entry.contractType)
        || !new Set(['self', 'spouse']).has(entry.insuredRelationship)) {
        fail('NIGERIA_UNSUPPORTED_RELIEF', 'Life/deferred-annuity relief supports only self or spouse and an enacted contract type');
      }
    }
  );

  let rent = { annualRent: zeroMoney(), relief: zeroMoney(), evidenceReference: '', declarationReference: '', metadata: {} };
  if (value.rent !== null) {
    assertObject(value.rent, 'reliefs.rent');
    assertOnlyKeys(value.rent, new Set([
      'annualRentAttributableTo2026', 'legalTenantName', 'periodCovered', 'landlordReference',
      'propertyAddress', 'evidenceReference', 'declarationReference',
    ]), 'reliefs.rent');
    const annualRent = inputMoney(value.rent.annualRentAttributableTo2026, 'reliefs.rent.annualRentAttributableTo2026');
    if (annualRent.decimal.compare('0') > 0) {
      requiredText(value.rent.legalTenantName, 'reliefs.rent.legalTenantName');
      requiredText(value.rent.periodCovered, 'reliefs.rent.periodCovered');
      requiredText(value.rent.landlordReference, 'reliefs.rent.landlordReference');
      requiredText(value.rent.propertyAddress, 'reliefs.rent.propertyAddress');
      rent = {
        annualRent,
        relief: roundMoney(minMoney(annualRent.multiplyByRate('0.20'), fixedMoney('500000.00')), 'ng.paye.rent_relief.annual.final'),
        evidenceReference: requiredText(value.rent.evidenceReference, 'reliefs.rent.evidenceReference'),
        declarationReference: requiredText(value.rent.declarationReference, 'reliefs.rent.declarationReference'),
        metadata: { legalTenantName: value.rent.legalTenantName, periodCovered: value.rent.periodCovered },
      };
    }
  }
  return { mortgage, life, rent };
}

function normalizeYtd(value, monthNumber, earnings, employeePension, employeeNhf, employeeNhia) {
  assertObject(value, 'ytd');
  assertOnlyKeys(value, new Set([
    'monthsCompleted', 'grossEmoluments', 'employeePension', 'employeeNhf', 'employeeNhia',
    'payeDeducted', 'reconciliationStatus', 'evidenceReference',
  ]), 'ytd');
  const monthsCompleted = monthNumber - 1;
  if (value.monthsCompleted !== monthsCompleted || value.reconciliationStatus !== 'no_midyear_adjustments') {
    fail('NIGERIA_UNSUPPORTED_MIDYEAR_CORRECTION', 'YTD must cover exactly the completed 2026 months with no mid-year adjustments');
  }
  const fields = {
    grossEmoluments: inputMoney(value.grossEmoluments, 'ytd.grossEmoluments'),
    employeePension: inputMoney(value.employeePension, 'ytd.employeePension'),
    employeeNhf: inputMoney(value.employeeNhf, 'ytd.employeeNhf'),
    employeeNhia: inputMoney(value.employeeNhia, 'ytd.employeeNhia'),
    payeDeducted: inputMoney(value.payeDeducted, 'ytd.payeDeducted'),
  };
  const expected = {
    grossEmoluments: earnings.gross.multiplyByRate(String(monthsCompleted)),
    employeePension: employeePension.multiplyByRate(String(monthsCompleted)),
    employeeNhf: employeeNhf.multiplyByRate(String(monthsCompleted)),
    employeeNhia: employeeNhia.multiplyByRate(String(monthsCompleted)),
  };
  for (const key of Object.keys(expected)) {
    if (fields[key].decimal.compare(expected[key].decimal) !== 0) {
      fail('NIGERIA_UNSUPPORTED_MIDYEAR_CORRECTION', `ytd.${key} is inconsistent with unchanged full-year monthly terms`, {
        expected: expected[key].toFixed(), actual: fields[key].toFixed(),
      });
    }
  }
  return {
    ...fields,
    monthsCompleted,
    evidenceReference: requiredText(value.evidenceReference, 'ytd.evidenceReference'),
  };
}

function calculatePayeBands(chargeableIncome) {
  const chargeable = inputMoney(chargeableIncome, 'chargeableIncome');
  let remaining = chargeable;
  let tax = zeroMoney();
  const bands = [];
  for (const band of PAYE_BANDS) {
    if (remaining.decimal.compare('0') <= 0) {
      bands.push({ ...band, taxable: '0.00', taxExact: '0' });
      continue;
    }
    const taxable = band.width === null ? remaining : minMoney(remaining, fixedMoney(band.width));
    const bandTax = taxable.multiplyByRate(band.rate);
    tax = tax.add(bandTax);
    remaining = remaining.subtract(taxable);
    bands.push({ ...band, taxable: taxable.toFixed(), taxExact: bandTax.toString() });
  }
  return {
    chargeableIncome: serializeMoney(chargeable),
    annualTax: serializeMoney(roundMoney(tax, 'ng.paye.annual_band_tax.final')),
    bands,
  };
}

function createLiability({
  liabilityCode, name, payer, amount, baseAmount, rate, authority, formCode, frequency,
  periodStart, periodEnd, dueDate, paymentChannel, calculationMethod, roundingStage,
  sourceReferences, sourceEffectiveFrom, evidenceReference, metadata,
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
      frequency,
      periodStart,
      periodEnd,
      dueDate,
      paymentChannel,
      accountReferenceField: 'registration_or_participation_reference',
    },
    calculation: { method: calculationMethod, roundingStage },
    sourceReferences,
    sourceEffectiveFrom,
    evidenceReference,
    metadata: { previewOnly: true, postable: false, ...metadata },
  }, MONEY);
}

function calculate(input = {}) {
  assertObject(input, 'input');
  assertOnlyKeys(input, TOP_LEVEL_KEYS, 'input');
  const payDate = parseDateOnly(input.payDate, 'payDate');
  if (payDate.date.getUTCFullYear() !== 2026 || input.taxYear !== 2026) {
    fail('NIGERIA_UNSUPPORTED_TAX_YEAR', 'This adapter supports pay dates in the 2026 calendar year only');
  }
  if (input.taxSourceVersion !== SOURCE_VERSIONS.JRB_PIT_2026) {
    fail('NIGERIA_SOURCE_VERSION_REQUIRED', `taxSourceVersion must be ${SOURCE_VERSIONS.JRB_PIT_2026}`);
  }
  assertEmptyArray(input.benefits, 'benefits', 'NIGERIA_UNSUPPORTED_BENEFIT_VALUATION');
  assertEmptyArray(input.reimbursements, 'reimbursements', 'NIGERIA_UNSUPPORTED_REIMBURSEMENT');
  assertEmptyArray(input.nonPeriodicPayments, 'nonPeriodicPayments', 'NIGERIA_UNSUPPORTED_NONPERIODIC_PAY');

  const period = monthBounds(payDate.date);
  const monthNumber = payDate.date.getUTCMonth() + 1;
  const employment = normalizeEmployment(input.employment);
  const earnings = normalizeEarnings(input.earnings);
  const taxAuthority = normalizeTaxAuthority(input.taxAuthority);
  const pension = normalizePension(input.pension);
  const nhf = normalizeNhf(input.nhf);
  const nhia = normalizeNhia(input.nhia, period.end);
  const nsitf = normalizeNsitf(input.nsitf, period.end);
  const itf = normalizeItf(input.itf, employment.employeeCount);
  const calendar = normalizeCalendar(input.businessCalendar);
  const reliefs = normalizeReliefs(input.reliefs);

  if (earnings.basic.multiplyByRate('12').decimal.compare('3000') < 0) {
    fail('NIGERIA_NHF_SCOPE_UNSUPPORTED', 'The supported mandatory NHF route requires annual basic salary of at least NGN 3,000');
  }
  if (earnings.basic.decimal.compare('30000') < 0) {
    fail('NIGERIA_NHIA_SCOPE_UNSUPPORTED', 'The supported OPSSHIP registration route requires monthly basic salary of at least NGN 30,000');
  }

  const employeePension = roundedRate(earnings.pensionable, '0.08', 'ng.pension.employee.current.final');
  const employerPension = roundedRate(earnings.pensionable, '0.10', 'ng.pension.employer.current.final');
  const employeeNhf = roundedRate(earnings.basic, '0.025', 'ng.nhf.employee.current.final');
  const employeeNhia = roundedRate(earnings.basic, '0.05', 'ng.nhia.employee.current.final');
  const employerNhia = roundedRate(earnings.basic, '0.10', 'ng.nhia.employer.current.final');
  const employerNsitf = roundedRate(earnings.gross, '0.01', 'ng.nsitf.employer.current.final');
  const employerItfProvision = roundedCentsFraction(
    itf.annualPayrollAllocation,
    1,
    1200,
    'ng.itf.employer.monthly_provision.final'
  );

  const ytd = normalizeYtd(input.ytd, monthNumber, earnings, employeePension, employeeNhf, employeeNhia);
  const annualGross = earnings.gross.multiplyByRate('12');
  const annualDeductions = employeePension.multiplyByRate('12')
    .add(employeeNhf.multiplyByRate('12'))
    .add(employeeNhia.multiplyByRate('12'))
    .add(reliefs.mortgage.amount)
    .add(reliefs.life.amount)
    .add(reliefs.rent.relief);
  const annualChargeable = maxZero(annualGross.subtract(annualDeductions));
  const minimumWageExempt = earnings.gross.decimal.compare('70000') <= 0;
  const bandResult = calculatePayeBands(annualChargeable.toFixed());
  const annualPaye = minimumWageExempt
    ? roundMoney(zeroMoney(), 'ng.paye.minimum_wage_exemption.final')
    : fixedMoney(bandResult.annualTax.amount);

  const cumulativeTargetCents = roundPositiveRational(annualPaye.toMinorUnits() * BigInt(monthNumber), 12n);
  const previousTargetCents = roundPositiveRational(annualPaye.toMinorUnits() * BigInt(monthNumber - 1), 12n);
  const ytdPayeCents = ytd.payeDeducted.toMinorUnits();
  const priorVariance = ytdPayeCents >= previousTargetCents
    ? ytdPayeCents - previousTargetCents
    : previousTargetCents - ytdPayeCents;
  if (priorVariance > 1n || ytdPayeCents > cumulativeTargetCents) {
    fail('NIGERIA_UNSUPPORTED_MIDYEAR_CORRECTION', 'YTD PAYE differs from the stable annual projection beyond a one-kobo rounding variance', {
      previousCumulativeTarget: statutoryMoneyService.fromMinorUnits(previousTargetCents, MONEY).toFixed(),
      actualYtdPaye: ytd.payeDeducted.toFixed(),
    });
  }
  const currentPaye = statutoryMoneyService
    .fromMinorUnits(cumulativeTargetCents - ytdPayeCents, MONEY)
    .roundToMinorUnit({ mode: HALF_UP, stage: 'ng.paye.current_cumulative_delta.final' });

  const periodStart = isoDate(period.start);
  const periodEnd = isoDate(period.end);
  const payeDue = isoDate(nextMonthDay(payDate.date, 10));
  const pensionDue = isoDate(addWorkingDays(payDate.date, 7, calendar.holidays));
  const nhfDue = isoDate(oneCalendarMonthAfter(payDate.date));
  const annualReturnDue = '2027-01-31';
  const itfDue = '2027-04-01';
  const pensionAuthority = {
    code: pension.pfcCode,
    name: `${pension.pfcName} on instruction of ${pension.pfaName}`,
    level: 'social_security',
    jurisdictionCode: 'NG',
  };
  const federalAuthority = (code, name, level = 'social_security') => ({ code, name, level, jurisdictionCode: 'NG' });
  const liabilities = [
    createLiability({
      liabilityCode: 'NG_PAYE', name: 'Pay As You Earn income tax', payer: 'employee', amount: currentPaye,
      baseAmount: roundMoney(annualChargeable, 'ng.paye.annual_chargeable.display'), rate: '',
      authority: { code: taxAuthority.authorityCode, name: taxAuthority.authorityName, level: 'subdivision', jurisdictionCode: taxAuthority.jurisdictionCode },
      formCode: taxAuthority.formCode, frequency: 'monthly', periodStart, periodEnd, dueDate: payeDue,
      paymentChannel: taxAuthority.paymentChannel,
      calculationMethod: 'JRB_annual_stable_monthly_projection_cumulative_target_less_certified_YTD_tax',
      roundingStage: 'ng.paye.current_cumulative_delta.final',
      sourceReferences: ['NIGERIA_TAX_ACT_2025', 'STATE_HOUSE_COMMENCEMENT_2026', 'JRB_PIT_GUIDELINES_2026'],
      sourceEffectiveFrom: '2026-01-01', evidenceReference: taxAuthority.routeCertificationReference,
      metadata: {
        annualReturnDueDate: annualReturnDue,
        annualTax: annualPaye.toFixed(), cumulativeTargetThroughCurrent: statutoryMoneyService.fromMinorUnits(cumulativeTargetCents, MONEY).toFixed(),
        ytdTaxBeforeCurrent: ytd.payeDeducted.toFixed(), minimumWageExempt,
        dueRule: '10th_calendar_day_of_following_month_no_adjustment_encoded',
        employerRegistrationReference: taxAuthority.employerRegistrationReference,
        employeeTaxIdReference: taxAuthority.employeeTaxIdReference,
      },
    }),
    createLiability({
      liabilityCode: 'NG_PENSION_EMPLOYEE', name: 'Contributory Pension Scheme - employee', payer: 'employee',
      amount: employeePension, baseAmount: earnings.pensionable, rate: '0.08', authority: pensionAuthority,
      formCode: 'PENSION_SCHEDULE', frequency: 'monthly', periodStart, periodEnd, dueDate: pensionDue,
      paymentChannel: 'PFC account specified by employee PFA', calculationMethod: '8% of evidenced PRA monthly emoluments',
      roundingStage: 'ng.pension.employee.current.final', sourceReferences: ['PENCOM_PRA_2014', 'PENCOM_COMPLIANCE_CIRCULAR_2025'],
      sourceEffectiveFrom: '2014-07-01', evidenceReference: pension.rsaPinEvidenceReference,
      metadata: { dueRule: 'seven_working_days_after_salary_payment', pfaCode: pension.pfaCode, pfcCode: pension.pfcCode, noMonetaryCap: true, calendarEvidenceReference: calendar.evidenceReference },
    }),
    createLiability({
      liabilityCode: 'NG_PENSION_EMPLOYER', name: 'Contributory Pension Scheme - employer', payer: 'employer',
      amount: employerPension, baseAmount: earnings.pensionable, rate: '0.10', authority: pensionAuthority,
      formCode: 'PENSION_SCHEDULE', frequency: 'monthly', periodStart, periodEnd, dueDate: pensionDue,
      paymentChannel: 'PFC account specified by employee PFA', calculationMethod: '10% of evidenced PRA monthly emoluments',
      roundingStage: 'ng.pension.employer.current.final', sourceReferences: ['PENCOM_PRA_2014', 'PENCOM_COMPLIANCE_CIRCULAR_2025'],
      sourceEffectiveFrom: '2014-07-01', evidenceReference: pension.registrationEvidenceReference,
      metadata: { dueRule: 'seven_working_days_after_salary_payment', pfaCode: pension.pfaCode, pfcCode: pension.pfcCode, noMonetaryCap: true, groupLifePolicyEvidenceReference: employment.groupLifePolicyEvidenceReference, calendarEvidenceReference: calendar.evidenceReference },
    }),
    createLiability({
      liabilityCode: 'NG_NHF_EMPLOYEE', name: 'National Housing Fund contribution', payer: 'employee',
      amount: employeeNhf, baseAmount: earnings.basic, rate: '0.025',
      authority: federalAuthority('FMBN_NHF', 'Federal Mortgage Bank of Nigeria - National Housing Fund'),
      formCode: 'NHF_SCHEDULE', frequency: 'monthly', periodStart, periodEnd, dueDate: nhfDue,
      paymentChannel: 'FMBN employer contribution portal', calculationMethod: '2.5% of monthly basic earnings',
      roundingStage: 'ng.nhf.employee.current.final', sourceReferences: ['FMBN_NHF_ACT', 'FMBN_CURRENT_LEGAL_FRAMEWORK'],
      sourceEffectiveFrom: '1992-01-31', evidenceReference: nhf.participationNumberEvidenceReference,
      metadata: { dueRule: 'within_one_calendar_month_of_deduction', employerNumberEvidenceReference: nhf.employerNumberEvidenceReference },
    }),
    createLiability({
      liabilityCode: 'NG_NHIA_EMPLOYEE', name: 'NHIA OPSSHIP contribution - employee', payer: 'employee',
      amount: employeeNhia, baseAmount: earnings.basic, rate: '0.05', authority: federalAuthority('NHIA_OPSSHIP', 'National Health Insurance Authority - OPSSHIP'),
      formCode: 'OPSSHIP_SCHEDULE', frequency: 'monthly', periodStart, periodEnd, dueDate: nhia.dueDate.text,
      paymentChannel: 'NHIA Fund Account via Remita', calculationMethod: '5% of basic salary under evidenced OPSSHIP basic-salary method',
      roundingStage: 'ng.nhia.employee.current.final', sourceReferences: ['NHIA_ACT_2022', 'NHIA_FORMAL_SECTOR_FAQ', 'NHIA_OPSSHIP', 'NHIA_OPSSHIP_REGISTRATION'],
      sourceEffectiveFrom: '2022-05-19', evidenceReference: nhia.enrolmentEvidenceReference,
      metadata: { dueRule: 'evidenced_employer_specific_NHIA_funding_schedule', fundingScheduleEvidenceReference: nhia.fundingScheduleEvidenceReference, currentRemittanceCommitmentEvidenceReference: nhia.currentRemittanceCommitmentEvidenceReference },
    }),
    createLiability({
      liabilityCode: 'NG_NHIA_EMPLOYER', name: 'NHIA OPSSHIP contribution - employer', payer: 'employer',
      amount: employerNhia, baseAmount: earnings.basic, rate: '0.10', authority: federalAuthority('NHIA_OPSSHIP', 'National Health Insurance Authority - OPSSHIP'),
      formCode: 'OPSSHIP_SCHEDULE', frequency: 'monthly', periodStart, periodEnd, dueDate: nhia.dueDate.text,
      paymentChannel: 'NHIA Fund Account via Remita', calculationMethod: '10% of basic salary under evidenced OPSSHIP basic-salary method',
      roundingStage: 'ng.nhia.employer.current.final', sourceReferences: ['NHIA_ACT_2022', 'NHIA_FORMAL_SECTOR_FAQ', 'NHIA_OPSSHIP', 'NHIA_OPSSHIP_REGISTRATION'],
      sourceEffectiveFrom: '2022-05-19', evidenceReference: nhia.enrolmentEvidenceReference,
      metadata: { dueRule: 'evidenced_employer_specific_NHIA_funding_schedule', fundingScheduleEvidenceReference: nhia.fundingScheduleEvidenceReference },
    }),
    createLiability({
      liabilityCode: 'NG_NSITF_EMPLOYER', name: 'Employees Compensation Scheme contribution', payer: 'employer',
      amount: employerNsitf, baseAmount: earnings.gross, rate: '0.01', authority: federalAuthority('NSITF_ECS', 'Nigeria Social Insurance Trust Fund - Employees Compensation Scheme'),
      formCode: 'ECS_RE03', frequency: 'monthly', periodStart, periodEnd, dueDate: nsitf.dueDate.text,
      paymentChannel: nsitf.paymentChannel, calculationMethod: '1% of total monthly employee payroll under current NSITF assessment',
      roundingStage: 'ng.nsitf.employer.current.final', sourceReferences: ['NSITF_ECS_2026'],
      sourceEffectiveFrom: '2010-12-17', evidenceReference: nsitf.assessmentEvidenceReference,
      metadata: { dueRule: 'assessment_specific_due_date_not_inferred', employerRegistrationReference: nsitf.employerRegistrationReference, employeeDeductionProhibited: true, aggregationScope: 'employee_component_for_employer_monthly_payroll' },
    }),
    createLiability({
      liabilityCode: 'NG_ITF_EMPLOYER_PROVISION', name: 'Industrial Training Fund annual contribution - monthly provision component', payer: 'employer',
      amount: employerItfProvision, baseAmount: itf.annualPayrollAllocation, rate: '', authority: federalAuthority('ITF', 'Industrial Training Fund', 'sector'),
      formCode: 'ITF_FORM_5A', frequency: 'annual', periodStart: '2026-01-01', periodEnd: '2026-12-31', dueDate: itfDue,
      paymentChannel: 'ITF contribution and reimbursement portal', calculationMethod: 'one_twelfth_of_1%_of_certified_Form_5A_annual_payroll_allocation',
      roundingStage: 'ng.itf.employer.monthly_provision.final', sourceReferences: ['ITF_AMENDMENT_ACT_2011', 'ITF_FORM_5A', 'ITF_CURRENT_REVENUE_GUIDANCE'],
      sourceEffectiveFrom: '2011-06-03', evidenceReference: itf.form5ABasisEvidenceReference,
      metadata: { dueRule: 'not_later_than_1_April_of_following_year', statutoryAnnualRate: '0.01', provisionFraction: '1/12', liableBy: itf.liableBy, employerRegistrationReference: itf.employerRegistrationReference, aggregationScope: 'employee_component_for_employer_annual_return', isProvision: true },
    }),
  ];

  const ledger = statutoryLiabilityLedgerService.buildLedger(liabilities);
  const employeeTotal = fixedMoney(ledger.employeeTotal.amount);
  const employerTotal = fixedMoney(ledger.employerTotal.amount);
  const gross = roundMoney(earnings.gross, 'ng.gross_cash_pay.input');
  const net = gross.subtract(employeeTotal);
  if (net.decimal.compare('0') < 0) fail('NIGERIA_NEGATIVE_NET_PAY', 'Statutory employee deductions exceed gross cash pay');

  return deepFreeze({
    adapter: {
      code: 'NG_2026_STANDALONE_PREVIEW', countryCode: 'NG', taxYear: 2026,
      integrationStatus: 'standalone_not_integrated',
      confidence: 'preview_pending_Nigerian_tax_pension_social_security_state_authority_and_legal_certification',
      previewOnly: true, postable: false,
      taxMethod: 'JRB_annual_stable_monthly_projection_with_cumulative_YTD_delta',
      taxSourceVersion: SOURCE_VERSIONS.JRB_PIT_2026,
      currency: MONEY.currency, minorUnits: MONEY.minorUnits,
      rounding: {
        policy: 'implementation-declared because the cited national sources do not prescribe a payroll rounding convention',
        contributions: 'calculate exact statutory rate then round half-up to NGN 0.01 per liability component',
        paye: 'round annual band tax half-up to NGN 0.01; round cumulative annual-tax allocation to NGN 0.01; subtract exact YTD kobo',
        itfProvision: 'round one-twelfth of 1% of certified annual Form 5A allocation half-up to NGN 0.01',
      },
    },
    payPeriod: { payDate: payDate.text, periodStart, periodEnd, monthNumber },
    jurisdiction: {
      routeType: taxAuthority.authorityType, authorityCode: taxAuthority.authorityCode,
      authorityName: taxAuthority.authorityName, jurisdictionCode: taxAuthority.jurisdictionCode,
      routeCertificationMode: 'synthetic_fixture_only',
      previewRouteReceiptId: taxAuthority.previewRouteReceiptId,
    },
    bases: {
      basicSalary: serializeMoney(earnings.basic), housingAllowance: serializeMoney(earnings.housing),
      transportAllowance: serializeMoney(earnings.transport), otherRegularCash: serializeMoney(earnings.other),
      grossCashPay: serializeMoney(gross), pensionableMonthlyEmoluments: serializeMoney(earnings.pensionable),
      annualGrossEmploymentIncome: serializeMoney(roundMoney(annualGross, 'ng.paye.annual_gross.display')),
      annualEligibleDeductions: serializeMoney(roundMoney(annualDeductions, 'ng.paye.annual_deductions.display')),
      annualChargeableIncome: serializeMoney(roundMoney(annualChargeable, 'ng.paye.annual_chargeable.display')),
      itfForm5AAnnualPayrollAllocation: serializeMoney(itf.annualPayrollAllocation),
    },
    incomeTax: {
      annualTax: serializeMoney(annualPaye), currentPaye: serializeMoney(currentPaye), minimumWageExempt,
      legacyConsolidatedReliefAllowanceApplied: false,
      cumulativeTargetThroughCurrent: serializeMoney(statutoryMoneyService.fromMinorUnits(cumulativeTargetCents, MONEY)),
      ytdBeforeCurrent: serializeMoney(ytd.payeDeducted), bands: bandResult.bands,
      annualDeductions: {
        employeePension: serializeMoney(employeePension.multiplyByRate('12')),
        employeeNhf: serializeMoney(employeeNhf.multiplyByRate('12')),
        employeeNhia: serializeMoney(employeeNhia.multiplyByRate('12')),
        ownerOccupiedMortgageInterest: serializeMoney(reliefs.mortgage.amount),
        priorYearLifeOrDeferredAnnuityPremium: serializeMoney(reliefs.life.amount),
        rentRelief: serializeMoney(reliefs.rent.relief),
      },
    },
    employeeContributions: {
      pension: serializeMoney(employeePension), nhf: serializeMoney(employeeNhf), nhia: serializeMoney(employeeNhia),
    },
    employerContributions: {
      pension: serializeMoney(employerPension), nhia: serializeMoney(employerNhia), nsitf: serializeMoney(employerNsitf),
      itfMonthlyProvisionComponent: serializeMoney(employerItfProvision),
    },
    ytdAfterPeriod: {
      grossEmoluments: serializeMoney(ytd.grossEmoluments.add(earnings.gross)),
      employeePension: serializeMoney(ytd.employeePension.add(employeePension)),
      employeeNhf: serializeMoney(ytd.employeeNhf.add(employeeNhf)),
      employeeNhia: serializeMoney(ytd.employeeNhia.add(employeeNhia)),
      payeDeducted: serializeMoney(ytd.payeDeducted.add(currentPaye)),
    },
    totals: {
      grossCashPay: serializeMoney(gross), employeeStatutoryDeductions: serializeMoney(employeeTotal),
      netCashPay: serializeMoney(net), employerStatutoryCostAndProvision: serializeMoney(employerTotal),
      employerTotalCashCostAndProvision: serializeMoney(gross.add(employerTotal)),
    },
    liabilityLedger: ledger,
    evidence: {
      employment: employment.evidenceReference, residency: employment.residencyEvidenceReference,
      earnings: earnings.evidenceReference, ytd: ytd.evidenceReference,
      stateOrFctRoute: taxAuthority.routeCertificationReference,
      pension: pension.registrationEvidenceReference, nhf: nhf.participationNumberEvidenceReference,
      nhia: nhia.enrolmentEvidenceReference, nsitf: nsitf.assessmentEvidenceReference,
      itf: itf.form5ABasisEvidenceReference, businessCalendar: calendar.evidenceReference,
      groupLifePolicy: employment.groupLifePolicyEvidenceReference,
    },
    supportedCases: [
      'ordinary resident organised-private-sector employee with at least five employees',
      'unchanged full-year 2026 monthly cash salary split into basic, housing, transport and other regular cash',
      'pinned synthetic State/FCT preview routing plus employer registration and employee Tax ID fixture evidence',
      'JRB annual PAYE template allocated cumulatively by month with exact YTD tax delta',
      'enacted pension, NHF, NHIA, mortgage-interest, prior-year life/deferred-annuity and rent deductions',
      'standard PRA 2014 CPS 8% employee and 10% employer contributions with no monetary cap',
      'NHF 2.5% of basic earnings, OPSSHIP basic method 5% employee and 10% employer',
      'NSITF assessed 1% employer contribution and ITF 1% annual employer provision component',
    ],
    excludedCases: [
      'production posting, TaxJurisdictionService registration and automatic remittance',
      'non-residents, diplomats, Armed Forces, intelligence/secret services, military wages, public-sector workers and self-employed workers',
      'employers with fewer than five employees, Personal Pension Plan and non-OPSSHIP health schemes',
      'benefits in kind, reimbursements, bonuses, commissions, overtime, severance, retroactive or other non-periodic pay',
      'starters, leavers, pay or deduction changes, interstate residence changes, prior-period corrections and refunds',
      'alternative pension splits, voluntary pension, exempt/pre-2004 pension categories and employer-paid employee share',
      'NHIA consolidated-payroll method, employer-paid employee NHIA share and state health-insurance schemes',
      'NSITF risk-assessed contribution rates other than an evidenced current rate of exactly 1%',
      'ITF annual base inference, training reimbursements and employer filing totals before payroll-run aggregation',
      'tax-authority holiday adjustments not stated in the national PAYE guidance',
    ],
    unresolvedLegalQuestions: [
      'JRB publishes annual total/monthly tax and requires cumulative records, but does not prescribe a variable-pay cumulative algorithm; Wave 1 uses only stable full-year monthly terms.',
      'State/FCT filing forms, payment channels and local administrative overlays require separate authority certification.',
      'NHIA and NSITF public national materials do not give one universal payroll calendar due date; employer-specific scheme/assessment evidence is mandatory.',
      'NSITF states a current 1% rate but also contemplates risk-based assessment; an assessment other than exactly 1% needs a separately certified rate adapter.',
      'ITF Form 5A payroll is broader than cash gross and the Nigeria Tax Act has a broad conflict clause; counsel must certify the annual Form 5A basis and continuing treatment before posting.',
      'The national sources do not prescribe a kobo rounding sequence; the declared half-up stages require payroll/legal approval.',
    ],
    officialSources: OFFICIAL_SOURCES,
  });
}

module.exports = {
  calculate,
  calculatePayeBands,
  NigeriaPayrollAdapterError,
  SOURCE_VERSIONS,
  OFFICIAL_SOURCES,
  PAYE_BANDS,
  PREVIEW_ROUTE_RECEIPTS,
};
