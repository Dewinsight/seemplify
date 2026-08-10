'use strict';

/**
 * Golden fixtures for Kenya2026PayrollAdapter.
 *
 * Expected values are written as decimal strings and were independently
 * derived from the primary-source rules identified by sourceReferences. The
 * fixtures intentionally exercise the published monthly PAYE table directly;
 * they do not annualize and divide the tax calculation.
 */

const SOURCE_URLS = Object.freeze({
  KRA_PAYE_CURRENT: 'https://www.kra.go.ke/individual/filing-paying/types-of-taxes/paye',
  KRA_EMPLOYER_EVIDENCE_GUIDANCE_2025: 'https://www.kra.go.ke/news-center/public-notices/2307-guidance-on-employer-obligations-in-applying-income-tax-deductions%2C-reliefs-and-exemptions',
  KENYA_INCOME_TAX_ACT_2026: 'https://new.kenyalaw.org/akn/ke/act/1973/16/eng%402026-01-01',
  KRA_PAYE_EMPLOYERS_GUIDE_AGGREGATE: 'https://www.kra.go.ke/images/publications/PAYE_Guide-2.pdf',
  KRA_NSSF_CALCULATOR_2026: 'https://ecitizen.kra.go.ke/calculators/nssf-calculator',
  NSSF_YEAR_4_NOTICE_2026: 'https://www.nssf.or.ke/notice-to-employers-year-4-2026-nssf-contribution-rates',
  KENYA_NSSF_ACT: 'https://new.kenyalaw.org/akn/ke/act/2013/45/eng%402022-12-31',
  KENYA_NSSF_CONTRACTING_OUT_REGULATIONS: 'https://new.kenyalaw.org/akn/ke/act/ln/2014/85',
  KENYA_AFFORDABLE_HOUSING_ACT: 'https://new.kenyalaw.org/akn/ke/act/2024/2/eng%402024-03-21',
  KENYA_SHIF_REGULATIONS: 'https://new.kenyalaw.org/akn/ke/act/ln/2024/49/eng%402025-02-28',
  KENYA_INDUSTRIAL_TRAINING_ACT_2024: 'https://new.kenyalaw.org/akn/ke/act/1959/48/eng%402024-04-26',
  NITA_OPERATIONAL_GUIDANCE: 'https://www.nita.go.ke/our-services/levy-inspectorate.html',
  KENYA_PWD_EXEMPTION_ORDER: 'https://new.kenyalaw.org/akn/ke/act/ln/2010/36/eng%402022-12-31',
  KRA_PWD_CERTIFICATE_GUIDANCE: 'https://www.kra.go.ke/individual/special-needs/people-with-disability/people-with-disability/129-getting-an-exemption-certificate',
});

function clone(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(clone);
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
}

function merge(target, overrides) {
  for (const [key, value] of Object.entries(overrides || {})) {
    if (
      value !== null
      && typeof value === 'object'
      && !Array.isArray(value)
      && target[key] !== null
      && typeof target[key] === 'object'
      && !Array.isArray(target[key])
    ) {
      merge(target[key], value);
    } else {
      target[key] = clone(value);
    }
  }
  return target;
}

function buildBaseInput(overrides = {}) {
  return merge({
    payDate: '2026-02-28',
    grossCashPay: '100000.00',
    residencyStatus: 'resident',
    dateOfBirth: '1990-01-01',
    nssfPensionableEarnings: '100000.00',
    pensionableIncomeForTax: '100000.00',
    employeeRegisteredPension: {
      employeeContribution: '0.00',
    },
    insuranceRelief: {
      monthlyPremiumPaid: '0.00',
    },
    pwdTaxExemption: null,
    nssf: {
      contractedOutTierII: false,
    },
    nita: {
      applicable: true,
    },
    businessCalendar: {
      publicHolidays: [],
      evidenceReference: 'FIXTURE_2026_KENYA_CALENDAR_REVIEWED_NO_HOLIDAY_IN_DUE_WINDOW',
    },
    benefits: [],
    reimbursements: [],
  }, overrides);
}

const payeBandCases = Object.freeze([
  {
    name: 'zero chargeable income',
    chargeableIncome: '0.00',
    expectedGrossTax: '0.00',
    sourceReferences: ['KRA_PAYE_CURRENT'],
  },
  {
    name: 'end of 10 percent band',
    chargeableIncome: '24000.00',
    expectedGrossTax: '2400.00',
    sourceReferences: ['KRA_PAYE_CURRENT'],
  },
  {
    name: 'end of 25 percent band',
    chargeableIncome: '32333.00',
    expectedGrossTax: '4483.25',
    sourceReferences: ['KRA_PAYE_CURRENT'],
  },
  {
    name: 'end of 30 percent band',
    chargeableIncome: '500000.00',
    expectedGrossTax: '144783.35',
    sourceReferences: ['KRA_PAYE_CURRENT'],
  },
  {
    name: 'end of 32.5 percent band',
    chargeableIncome: '800000.00',
    expectedGrossTax: '242283.35',
    sourceReferences: ['KRA_PAYE_CURRENT'],
  },
  {
    name: 'first shilling in 35 percent band',
    chargeableIncome: '800001.00',
    expectedGrossTax: '242283.70',
    sourceReferences: ['KRA_PAYE_CURRENT'],
  },
]);

const monthlyGoldenCases = Object.freeze([
  {
    name: 'January uses NSSF Year 3 at KES 100,000 gross',
    input: buildBaseInput({ payDate: '2026-01-31' }),
    expected: {
      nssfSchedule: 'YEAR_3',
      nssfEmployee: '4320.00',
      nssfEmployer: '4320.00',
      chargeableIncome: '91430.00',
      paye: '19812.35',
      ahlEmployee: '1500.00',
      shifEmployee: '2750.00',
      nitaEmployer: '50.00',
      employeeStatutoryLiabilities: '28382.35',
      employerStatutoryCost: '5870.00',
      netCashPay: '71617.65',
      ahlDueDate: '2026-02-12',
    },
    derivation: 'PAYE base = 100000 - 1500 AHL - 2750 SHIF - 4320 NSSF = 91430; monthly table tax 22212.35 less 2400 relief.',
    sourceReferences: [
      'KRA_PAYE_CURRENT',
      'KRA_NSSF_CALCULATOR_2026',
      'KENYA_AFFORDABLE_HOUSING_ACT',
      'KENYA_SHIF_REGULATIONS',
    ],
  },
  {
    name: 'February uses NSSF Year 4 at KES 100,000 gross',
    input: buildBaseInput(),
    expected: {
      nssfSchedule: 'YEAR_4',
      nssfEmployee: '6000.00',
      nssfEmployer: '6000.00',
      chargeableIncome: '89750.00',
      paye: '19308.35',
      ahlEmployee: '1500.00',
      shifEmployee: '2750.00',
      nitaEmployer: '50.00',
      employeeStatutoryLiabilities: '29558.35',
      employerStatutoryCost: '7550.00',
      netCashPay: '70441.65',
      ahlDueDate: '2026-03-12',
    },
    derivation: 'PAYE base = 100000 - 1500 AHL - 2750 SHIF - 6000 NSSF = 89750; direct monthly bands produce 21708.35 before KES 2400 relief.',
    sourceReferences: [
      'KRA_PAYE_CURRENT',
      'NSSF_YEAR_4_NOTICE_2026',
      'KRA_NSSF_CALCULATOR_2026',
      'KENYA_AFFORDABLE_HOUSING_ACT',
      'KENYA_SHIF_REGULATIONS',
    ],
  },
  {
    name: 'Year 4 upper earnings limit at KES 108,000 gross',
    input: buildBaseInput({
      grossCashPay: '108000.00',
      nssfPensionableEarnings: '108000.00',
      pensionableIncomeForTax: '108000.00',
    }),
    expected: {
      nssfSchedule: 'YEAR_4',
      nssfEmployee: '6480.00',
      nssfEmployer: '6480.00',
      chargeableIncome: '96930.00',
      paye: '21462.35',
      ahlEmployee: '1620.00',
      shifEmployee: '2970.00',
      nitaEmployer: '50.00',
      employeeStatutoryLiabilities: '32532.35',
      employerStatutoryCost: '8150.00',
      netCashPay: '75467.65',
      ahlDueDate: '2026-03-12',
    },
    derivation: 'NSSF = 6% x 108000 = 6480 per side; PAYE base = 108000 - 1620 - 2970 - 6480 = 96930.',
    sourceReferences: ['NSSF_YEAR_4_NOTICE_2026', 'KRA_NSSF_CALCULATOR_2026', 'KRA_PAYE_CURRENT'],
  },
  {
    name: 'SHIF minimum and zero PAYE at KES 10,000 gross',
    input: buildBaseInput({
      grossCashPay: '10000.00',
      nssfPensionableEarnings: '10000.00',
      pensionableIncomeForTax: '10000.00',
    }),
    expected: {
      nssfSchedule: 'YEAR_4',
      nssfEmployee: '600.00',
      nssfEmployer: '600.00',
      chargeableIncome: '8950.00',
      paye: '0.00',
      ahlEmployee: '150.00',
      shifEmployee: '300.00',
      nitaEmployer: '50.00',
      employeeStatutoryLiabilities: '1050.00',
      employerStatutoryCost: '800.00',
      netCashPay: '8950.00',
      ahlDueDate: '2026-03-12',
    },
    derivation: '2.75% x 10000 = 275, replaced by the KES 300 SHIF minimum; PAYE before relief is KES 895 and floors to zero after personal relief.',
    sourceReferences: ['KENYA_SHIF_REGULATIONS', 'KRA_PAYE_CURRENT'],
  },
  {
    name: 'non-resident receives no personal relief',
    input: buildBaseInput({ residencyStatus: 'non_resident' }),
    expected: {
      nssfSchedule: 'YEAR_4',
      nssfEmployee: '6000.00',
      nssfEmployer: '6000.00',
      chargeableIncome: '89750.00',
      paye: '21708.35',
      ahlEmployee: '1500.00',
      shifEmployee: '2750.00',
      nitaEmployer: '50.00',
      employeeStatutoryLiabilities: '31958.35',
      employerStatutoryCost: '7550.00',
      netCashPay: '68041.65',
      ahlDueDate: '2026-03-12',
    },
    derivation: 'The direct monthly band tax on 89750 is 21708.35 and no resident personal relief is granted.',
    sourceReferences: ['KRA_PAYE_CURRENT', 'KENYA_INCOME_TAX_ACT_2026'],
  },
  {
    name: 'NSSF consumes the remaining KES 30,000 aggregate pension cap',
    input: buildBaseInput({
      grossCashPay: '500000.00',
      nssfPensionableEarnings: '500000.00',
      pensionableIncomeForTax: '100000.00',
      employeeRegisteredPension: {
        employeeContribution: '30000.00',
        registeredSchemeReference: 'RBA-REGISTERED-SCHEME-001',
        evidenceReference: 'FIXTURE-PENSION-EVIDENCE-001',
      },
    }),
    expected: {
      nssfSchedule: 'YEAR_4',
      nssfEmployee: '6480.00',
      nssfEmployer: '6480.00',
      registeredPensionDeductible: '23520.00',
      registeredPensionExcess: '6480.00',
      totalPensionDeductible: '30000.00',
      chargeableIncome: '448750.00',
      paye: '127008.35',
      ahlEmployee: '7500.00',
      shifEmployee: '13750.00',
      nitaEmployer: '50.00',
      employeeStatutoryLiabilities: '154738.35',
      employerStatutoryCost: '14030.00',
      netCashPay: '315261.65',
      ahlDueDate: '2026-03-12',
    },
    derivation: 'NSSF KES 6480 leaves KES 23520 within the KES 30000 aggregate; 30% of KES 100000 does not reduce that residual further.',
    sourceReferences: [
      'KENYA_INCOME_TAX_ACT_2026',
      'KRA_PAYE_EMPLOYERS_GUIDE_AGGREGATE',
      'KRA_NSSF_CALCULATOR_2026',
      'KRA_PAYE_CURRENT',
    ],
  },
  {
    name: '30 percent pensionable-income rule binds registered pension',
    input: buildBaseInput({
      pensionableIncomeForTax: '20000.00',
      employeeRegisteredPension: {
        employeeContribution: '20000.00',
        registeredSchemeReference: 'RBA-REGISTERED-SCHEME-002',
        evidenceReference: 'FIXTURE-PENSION-EVIDENCE-002',
      },
    }),
    expected: {
      nssfSchedule: 'YEAR_4',
      nssfEmployee: '6000.00',
      nssfEmployer: '6000.00',
      registeredPensionDeductible: '6000.00',
      registeredPensionExcess: '14000.00',
      totalPensionDeductible: '12000.00',
      chargeableIncome: '83750.00',
      paye: '17508.35',
      ahlEmployee: '1500.00',
      shifEmployee: '2750.00',
      nitaEmployer: '50.00',
      employeeStatutoryLiabilities: '27758.35',
      employerStatutoryCost: '7550.00',
      netCashPay: '52241.65',
      ahlDueDate: '2026-03-12',
    },
    derivation: '30% x KES 20000 pensionable income = KES 6000 registered-pension deduction; NSSF remains separately included in the aggregate.',
    sourceReferences: [
      'KENYA_INCOME_TAX_ACT_2026',
      'KRA_PAYE_EMPLOYERS_GUIDE_AGGREGATE',
      'KRA_PAYE_CURRENT',
    ],
  },
  {
    name: 'resident insurance relief is capped at KES 5,000 monthly',
    input: buildBaseInput({
      insuranceRelief: {
        monthlyPremiumPaid: '40000.00',
        policyType: 'health',
        policyStartDate: '2020-01-01',
        insuredRelationship: 'self',
        benefitsPayableInKenyaShillings: true,
        policyEvidenceReference: 'FIXTURE-HEALTH-POLICY-001',
        insurerLicenceEvidenceReference: 'FIXTURE-IRA-LICENCE-001',
      },
    }),
    expected: {
      nssfSchedule: 'YEAR_4',
      nssfEmployee: '6000.00',
      nssfEmployer: '6000.00',
      insuranceRelief: '5000.00',
      chargeableIncome: '89750.00',
      paye: '14308.35',
      ahlEmployee: '1500.00',
      shifEmployee: '2750.00',
      nitaEmployer: '50.00',
      employeeStatutoryLiabilities: '24558.35',
      employerStatutoryCost: '7550.00',
      netCashPay: '75441.65',
      ahlDueDate: '2026-03-12',
    },
    derivation: '15% x KES 40000 = KES 6000, capped at KES 60000 / 12 = KES 5000; PAYE 19308.35 - 5000.',
    sourceReferences: ['KENYA_INCOME_TAX_ACT_2026', 'KRA_PAYE_CURRENT'],
  },
  {
    name: 'active PWD certificate exempts first KES 150,000 of monthly total income',
    input: buildBaseInput({
      grossCashPay: '200000.00',
      nssfPensionableEarnings: '200000.00',
      pensionableIncomeForTax: '200000.00',
      pwdTaxExemption: {
        certificateNumber: 'PWD-EXEMPT-001',
        ncpwdRegistrationNumber: 'NCPWD-001',
        effectiveFrom: '2026-02-28',
        effectiveTo: '2031-02-27',
        kraVerificationReference: 'FIXTURE-KRA-VERIFY-001',
      },
    }),
    expected: {
      nssfSchedule: 'YEAR_4',
      nssfEmployee: '6480.00',
      nssfEmployer: '6480.00',
      pwdExemption: '150000.00',
      chargeableIncome: '35020.00',
      paye: '2889.35',
      ahlEmployee: '3000.00',
      shifEmployee: '5500.00',
      nitaEmployer: '50.00',
      employeeStatutoryLiabilities: '17869.35',
      employerStatutoryCost: '9530.00',
      netCashPay: '182130.65',
      ahlDueDate: '2026-03-12',
    },
    derivation: 'Taxable before PWD = 200000 - 3000 - 5500 - 6480 = 185020; after KES 150000 exemption, chargeable income is KES 35020.',
    sourceReferences: ['KENYA_PWD_EXEMPTION_ORDER', 'KRA_PWD_CERTIFICATE_GUIDANCE', 'KRA_PAYE_CURRENT'],
  },
]);

const ageBoundaryCases = Object.freeze([
  { name: 'day before 18th birthday', dateOfBirth: '2008-03-01', covered: false, age: 17 },
  { name: '18th birthday', dateOfBirth: '2008-02-28', covered: true, age: 18 },
  { name: 'day before 60th birthday', dateOfBirth: '1966-03-01', covered: true, age: 59 },
  { name: '60th birthday', dateOfBirth: '1966-02-28', covered: false, age: 60 },
]);

module.exports = {
  SOURCE_URLS,
  buildBaseInput,
  payeBandCases,
  monthlyGoldenCases,
  ageBoundaryCases,
};
