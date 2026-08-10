'use strict';

/**
 * Primary-source fixture pack for Canada/Ontario 2026 Wave 1.
 *
 * The expected values below are independently calculated from the cited CRA
 * T4127 formulas with integer fractions, not copied from the implementation.
 * T4032 table results can differ slightly because the printed tables use range
 * midpoints; CRA states that the T4127 formulas are generally more precise.
 */

const { SOURCE_VERSIONS, OFFICIAL_SOURCES } = require('../Canada2026OntarioPayrollAdapter');

const EVIDENCE = Object.freeze({
  payPeriod: 'FIXTURE_PAYROLL_REGISTER_2026',
  employment: 'FIXTURE_EMPLOYMENT_CPP_EI_CLASSIFICATION_2026',
  td1Federal: 'FIXTURE_SIGNED_TD1_2026',
  td1Ontario: 'FIXTURE_SIGNED_TD1ON_2026',
  ytd: 'FIXTURE_YTD_REGISTER_BEFORE_CURRENT_PAY',
  remitter: 'FIXTURE_CRA_REGULAR_REMITTER_NOTICE',
  payrollAccount: 'FIXTURE_CRA_RP_ACCOUNT',
  calendar: 'FIXTURE_CRA_RECOGNIZED_HOLIDAY_CALENDAR_2026',
});

const ZERO_YTD = Object.freeze({
  pensionableEarnings: '0.00',
  insurableEarnings: '0.00',
  employeeCpp: '0.00',
  employeeCpp2: '0.00',
  employeeEi: '0.00',
  employerCpp: '0.00',
  employerCpp2: '0.00',
  employerEi: '0.00',
  evidenceReference: EVIDENCE.ytd,
});

const BASE_INPUT = Object.freeze({
  payDate: '2026-01-31',
  provinceOfEmployment: 'ON',
  formulaSourceVersion: SOURCE_VERSIONS.JANUARY,
  payFrequency: 'monthly',
  payPeriodsPerYear: 12,
  payPeriodNumber: 1,
  payPeriod: Object.freeze({ start: '2026-01-01', end: '2026-01-31', evidenceReference: EVIDENCE.payPeriod }),
  grossCashPay: '5000.00',
  pensionableEarnings: '5000.00',
  insurableEarnings: '5000.00',
  benefits: Object.freeze([]),
  deductions: Object.freeze([]),
  nonPeriodicPayments: Object.freeze([]),
  employment: Object.freeze({
    type: 'salary_or_wages',
    cppStatus: 'contributing_full_year',
    cppContributoryMonths: 12,
    eiReducedRate: false,
    provinceTransfer: false,
    evidenceReference: EVIDENCE.employment,
  }),
  td1: Object.freeze({
    federal: Object.freeze({
      taxYear: 2026,
      totalClaimAmount: '16452.00',
      claimExempt: false,
      signedAt: '2026-01-02',
      evidenceReference: EVIDENCE.td1Federal,
    }),
    ontario: Object.freeze({
      taxYear: 2026,
      totalClaimAmount: '12989.00',
      claimExempt: false,
      disabledDependants: 0,
      dependantsUnder19: 0,
      signedAt: '2026-01-02',
      evidenceReference: EVIDENCE.td1Ontario,
    }),
    additionalTaxPerPeriod: '0.00',
  }),
  ytd: ZERO_YTD,
  remitterProfile: Object.freeze({
    type: 'regular',
    evidenceReference: EVIDENCE.remitter,
    payrollProgramAccountEvidenceReference: EVIDENCE.payrollAccount,
  }),
  businessCalendar: Object.freeze({
    recognizedHolidays: Object.freeze(['2026-02-16']),
    evidenceReference: EVIDENCE.calendar,
  }),
});

const GOLDEN_CASES = Object.freeze([
  Object.freeze({
    id: 'ON_MONTHLY_JAN_STANDARD_5000',
    sourceBasis: Object.freeze([
      'CRA_T4127_122_JAN_2026',
      'CRA_T4032_ON_JAN_2026',
      'CRA_TD1_2026',
      'CRA_CPP_2026',
      'CRA_CPP2_2026',
      'CRA_EI_2026',
    ]),
    input: BASE_INPUT,
    independentlyCalculated: Object.freeze({
      periodCppBasicExemption: '291.66',
      cpp: '280.15',
      cpp2: '0.00',
      eiEmployee: '81.50',
      eiEmployer: '114.10',
      combinedIncomeTax: '693.33',
      federalIncomeTaxAllocation: '444.86',
      ontarioIncomeTaxAllocation: '248.47',
      employeeStatutoryDeductions: '1054.98',
      netCashPay: '3945.02',
      employerStatutoryCost: '394.25',
      remittanceDueDate: '2026-02-17',
      trace: Object.freeze({
        cpp: 'round(min(4230.45, 0.0595 * (5000.00 - trunc(3500/12, 0.01))), 0.01)',
        eiEmployee: 'round(min(1123.07, 0.0163 * 5000.00), 0.01)',
        eiEmployer: 'round(1.4 * 81.50, 0.01)',
        tax: 'round((T1 + Ontario T2) / 12, 0.01), using direct TD1 totals and YTD CPP/EI credit method',
      }),
    }),
  }),
  Object.freeze({
    id: 'ON_MONTHLY_JUL_UNCHANGED_RULES_STEADY_PAY',
    sourceBasis: Object.freeze([
      'CRA_T4127_123_JUL_2026',
      'CRA_T4127_122_JAN_2026',
      'CRA_T4032_ON_JAN_2026',
      'CRA_TD1_2026',
      'CRA_CPP_2026',
      'CRA_CPP2_2026',
      'CRA_EI_2026',
    ]),
    input: Object.freeze({
      ...BASE_INPUT,
      payDate: '2026-07-31',
      formulaSourceVersion: SOURCE_VERSIONS.JULY,
      payPeriodNumber: 7,
      payPeriod: Object.freeze({ start: '2026-07-01', end: '2026-07-31', evidenceReference: EVIDENCE.payPeriod }),
      ytd: Object.freeze({
        pensionableEarnings: '30000.00', insurableEarnings: '30000.00',
        employeeCpp: '1680.90', employeeCpp2: '0.00', employeeEi: '489.00',
        employerCpp: '1680.90', employerCpp2: '0.00', employerEi: '684.60',
        evidenceReference: EVIDENCE.ytd,
      }),
      businessCalendar: Object.freeze({ recognizedHolidays: Object.freeze([]), evidenceReference: EVIDENCE.calendar }),
    }),
    independentlyCalculated: Object.freeze({
      cpp: '280.15', cpp2: '0.00', eiEmployee: '81.50', eiEmployer: '114.10',
      combinedIncomeTax: '693.33', federalIncomeTaxAllocation: '444.86', ontarioIncomeTaxAllocation: '248.47',
      employeeStatutoryDeductions: '1054.98', netCashPay: '3945.02', employerStatutoryCost: '394.25',
      remittanceDueDate: '2026-08-17',
      trace: Object.freeze({
        sourceSelection: 'T4127 123rd says Ontario has no July change and unreproduced sections use the 122nd edition',
        projectedBaseCppCredit: '(1680.90 * 0.0495/0.0595) + (6 * 280.15 * 0.0495/0.0595)',
        projectedEiCredit: '489.00 + (6 * 81.50)',
      }),
    }),
  }),
  Object.freeze({
    id: 'ON_MONTHLY_CPP2_ACTIVE_AFTER_YMPE',
    sourceBasis: Object.freeze(['CRA_T4127_123_JUL_2026', 'CRA_T4127_122_JAN_2026', 'CRA_CPP2_2026']),
    input: Object.freeze({
      ...BASE_INPUT,
      payDate: '2026-10-31',
      formulaSourceVersion: SOURCE_VERSIONS.JULY,
      payPeriodNumber: 10,
      payPeriod: Object.freeze({ start: '2026-10-01', end: '2026-10-31', evidenceReference: EVIDENCE.payPeriod }),
      grossCashPay: '8000.00', pensionableEarnings: '8000.00', insurableEarnings: '8000.00',
      ytd: Object.freeze({
        pensionableEarnings: '75000.00', insurableEarnings: '75000.00',
        employeeCpp: '4230.45', employeeCpp2: '16.00', employeeEi: '1123.07',
        employerCpp: '4230.45', employerCpp2: '16.00', employerEi: '1572.30',
        evidenceReference: EVIDENCE.ytd,
      }),
      businessCalendar: Object.freeze({ recognizedHolidays: Object.freeze([]), evidenceReference: EVIDENCE.calendar }),
    }),
    independentlyCalculated: Object.freeze({
      cpp: '0.00',
      cpp2: '320.00',
      cpp2Base: '8000.00',
      eiEmployee: '0.00',
      eiEmployer: '0.00',
      combinedIncomeTax: '1500.64',
      federalIncomeTaxAllocation: '993.79',
      ontarioIncomeTaxAllocation: '506.85',
      employeeStatutoryDeductions: '1820.64',
      netCashPay: '6179.36',
      employerStatutoryCost: '320.00',
      remittanceDueDate: '2026-11-16',
      trace: Object.freeze({ cpp2: 'min(416.00 - 16.00, (75000.00 + 8000.00 - max(75000.00, 74600.00)) * 0.04)' }),
    }),
  }),
  Object.freeze({
    id: 'ON_MONTHLY_CPP2_AND_EI_FINAL_MAXIMUMS',
    sourceBasis: Object.freeze(['CRA_T4127_123_JUL_2026', 'CRA_T4127_122_JAN_2026', 'CRA_CPP2_2026']),
    input: Object.freeze({
      ...BASE_INPUT,
      payDate: '2026-12-31',
      formulaSourceVersion: SOURCE_VERSIONS.JULY,
      payPeriodNumber: 12,
      payPeriod: Object.freeze({ start: '2026-12-01', end: '2026-12-31', evidenceReference: EVIDENCE.payPeriod }),
      grossCashPay: '5000.00', pensionableEarnings: '5000.00', insurableEarnings: '1000.00',
      ytd: Object.freeze({
        pensionableEarnings: '84000.00', insurableEarnings: '68800.00',
        employeeCpp: '4230.45', employeeCpp2: '376.00', employeeEi: '1120.00',
        employerCpp: '4230.45', employerCpp2: '376.00', employerEi: '1568.00',
        evidenceReference: EVIDENCE.ytd,
      }),
      businessCalendar: Object.freeze({ recognizedHolidays: Object.freeze([]), evidenceReference: EVIDENCE.calendar }),
    }),
    independentlyCalculated: Object.freeze({
      cpp: '0.00', cpp2: '40.00', eiEmployee: '3.07', eiEmployer: '4.30',
      employeeCpp2YtdAfter: '416.00', employeeEiYtdAfter: '1123.07', employerEiYtdAfter: '1572.30',
      combinedIncomeTax: '681.66', federalIncomeTaxAllocation: '436.19', ontarioIncomeTaxAllocation: '245.47',
      employeeStatutoryDeductions: '724.73', netCashPay: '4275.27', employerStatutoryCost: '44.30',
      remittanceDueDate: '2027-01-15',
      trace: Object.freeze({
        cpp2: 'min(416.00 - 376.00, (84000.00 + 5000.00 - 84000.00) * 0.04) = 40.00',
        eiEmployee: 'min(1123.07 - 1120.00, 1000.00 * 0.0163) = 3.07',
        eiEmployer: 'round(min(1572.30 - 1568.00, 3.07 * 1.4), 0.01) = 4.30',
      }),
    }),
  }),
  Object.freeze({
    id: 'ON_MONTHLY_HIGH_INCOME_SURTAX_AND_OHP',
    sourceBasis: Object.freeze(['CRA_T4127_122_JAN_2026', 'CRA_T4032_ON_JAN_2026', 'CRA_TD1_2026']),
    input: Object.freeze({
      ...BASE_INPUT,
      grossCashPay: '20000.00', pensionableEarnings: '20000.00', insurableEarnings: '20000.00',
    }),
    independentlyCalculated: Object.freeze({
      cpp: '1172.65', cpp2: '0.00', eiEmployee: '326.00', eiEmployer: '456.40',
      combinedIncomeTax: '6826.63', federalIncomeTaxAllocation: '4172.15', ontarioIncomeTaxAllocation: '2654.48',
      annualOntarioHealthPremium: '900.00',
      annualOntarioSurtaxExact: '22969680037/2656250',
      employeeStatutoryDeductions: '8325.28', netCashPay: '11674.72', employerStatutoryCost: '1629.05',
      remittanceDueDate: '2026-02-17',
    }),
  }),
]);

module.exports = Object.freeze({
  sourceRegistry: OFFICIAL_SOURCES,
  sourceVersions: SOURCE_VERSIONS,
  evidence: EVIDENCE,
  baseInput: BASE_INPUT,
  goldenCases: GOLDEN_CASES,
});
