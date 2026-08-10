'use strict';

/**
 * Official-source fixtures for Nigeria 2026 Wave 1.
 *
 * Expected values are independently calculated from the Nigeria Tax Act
 * Fourth Schedule, JRB Appendix 1 and the cited social-security statutes.
 * They are intentionally written out rather than derived by adapter helpers.
 */

const {
  SOURCE_VERSIONS,
  OFFICIAL_SOURCES,
} = require('../Nigeria2026PayrollAdapter');

const EVIDENCE = Object.freeze({
  employment: 'FIXTURE_NG_2026_FULL_YEAR_EMPLOYMENT_CONTRACT',
  residency: 'FIXTURE_NG_2026_LAGOS_RESIDENCY_CERTIFICATION',
  groupLife: 'FIXTURE_PENCOM_GROUP_LIFE_POLICY_3X_ANNUAL_EMOLUMENT',
  earnings: 'FIXTURE_NG_JUNE_2026_PAYROLL_REGISTER',
  ytd: 'FIXTURE_NG_YTD_REGISTER_THROUGH_MAY_2026',
  taxRoute: 'FIXTURE_CERTIFIED_LIRS_2026_ROUTE_ADAPTER',
  employerPayeRegistration: 'FIXTURE_LIRS_EMPLOYER_PAYE_REGISTRATION',
  employeeTaxId: 'FIXTURE_JRB_EMPLOYEE_TAX_ID',
  pensionRsa: 'FIXTURE_PENCOM_RSA_PIN',
  pensionRegistration: 'FIXTURE_PENCOM_EMPLOYER_CPS_REGISTRATION',
  nhfEmployer: 'FIXTURE_FMBN_EMPLOYER_NUMBER',
  nhfParticipant: 'FIXTURE_FMBN_EMPLOYEE_PARTICIPATION_NUMBER',
  nhiaEnrolment: 'FIXTURE_NHIA_OPSSHIP_ENROLMENT',
  nhiaFunding: 'FIXTURE_NHIA_EMPLOYER_FUNDING_SCHEDULE',
  nhiaCurrent: 'FIXTURE_NHIA_CURRENT_REMITTANCE_COMMITMENT',
  nsitfRegistration: 'FIXTURE_NSITF_ECS_RE01',
  nsitfAssessment: 'FIXTURE_NSITF_JUNE_2026_ASSESSMENT',
  itfRegistration: 'FIXTURE_ITF_EMPLOYER_NUMBER',
  itfForm5A: 'FIXTURE_CERTIFIED_ITF_FORM_5A_ALLOCATION_2026',
  calendar: 'FIXTURE_NIGERIA_OFFICIAL_HOLIDAY_CALENDAR_2026',
  rentReceipt: 'FIXTURE_2026_RENT_RECEIPT_AND_TENANCY',
  rentDeclaration: 'FIXTURE_SIGNED_2026_RENT_RELIEF_DECLARATION',
});

const BASE_INPUT = Object.freeze({
  payDate: '2026-06-30',
  taxYear: 2026,
  taxSourceVersion: SOURCE_VERSIONS.JRB_PIT_2026,
  employment: Object.freeze({
    workerCategory: 'ordinary_resident_private_employee',
    employerSector: 'organized_private',
    employeeCount: 25,
    employmentStartDate: '2025-01-01',
    expectedEmploymentEndDate: '2026-12-31',
    stableMonthlyTermsFor2026: true,
    residentInSameJurisdictionFor2026: true,
    evidenceReference: EVIDENCE.employment,
    residencyEvidenceReference: EVIDENCE.residency,
    groupLifePolicyEvidenceReference: EVIDENCE.groupLife,
  }),
  earnings: Object.freeze({
    basicSalary: '500000.00',
    housingAllowance: '200000.00',
    transportAllowance: '100000.00',
    otherRegularCash: '200000.00',
    pensionableMonthlyEmoluments: '800000.00',
    evidenceReference: EVIDENCE.earnings,
  }),
  benefits: Object.freeze([]),
  reimbursements: Object.freeze([]),
  nonPeriodicPayments: Object.freeze([]),
  ytd: Object.freeze({
    monthsCompleted: 5,
    grossEmoluments: '5000000.00',
    employeePension: '320000.00',
    employeeNhf: '62500.00',
    employeeNhia: '125000.00',
    payeDeducted: '691150.00',
    reconciliationStatus: 'no_midyear_adjustments',
    evidenceReference: EVIDENCE.ytd,
  }),
  reliefs: Object.freeze({
    mortgageInterest: null,
    lifeOrDeferredAnnuity: null,
    rent: Object.freeze({
      annualRentAttributableTo2026: '2000000.00',
      legalTenantName: 'Fixture Employee',
      periodCovered: '2026-01-01/2026-12-31',
      landlordReference: 'FIXTURE_LANDLORD_TAX_ID',
      propertyAddress: 'Fixture Residence, Lagos, Nigeria',
      evidenceReference: EVIDENCE.rentReceipt,
      declarationReference: EVIDENCE.rentDeclaration,
    }),
  }),
  taxAuthority: Object.freeze({
    authorityType: 'state_irs',
    authorityCode: 'LIRS',
    authorityName: 'Lagos State Internal Revenue Service',
    jurisdictionCode: 'NG-LA',
    formCode: 'LIRS_PAYE_MONTHLY',
    paymentChannel: 'certified LIRS employer portal route',
    employerRegistrationReference: EVIDENCE.employerPayeRegistration,
    employeeTaxIdReference: EVIDENCE.employeeTaxId,
    routeCertificationReference: EVIDENCE.taxRoute,
    previewRouteReceiptId: 'NG-LA-2026-LIRS-SYNTHETIC-PREVIEW',
  }),
  pension: Object.freeze({
    scheme: 'pra2014_standard_cps',
    exemptionStatus: 'none',
    employeeRate: '0.08',
    employerRate: '0.10',
    rsaPinEvidenceReference: EVIDENCE.pensionRsa,
    pfaCode: 'PFA_FIXTURE',
    pfaName: 'Fixture Licensed Pension Fund Administrator',
    pfcCode: 'PFC_FIXTURE',
    pfcName: 'Fixture Licensed Pension Fund Custodian',
    registrationEvidenceReference: EVIDENCE.pensionRegistration,
  }),
  nhf: Object.freeze({
    registered: true,
    employerNumberEvidenceReference: EVIDENCE.nhfEmployer,
    participationNumberEvidenceReference: EVIDENCE.nhfParticipant,
  }),
  nhia: Object.freeze({
    programme: 'opsship',
    basisMethod: 'basic_salary',
    employeeRate: '0.05',
    employerRate: '0.10',
    employerPaysEmployeeShare: false,
    enrolmentEvidenceReference: EVIDENCE.nhiaEnrolment,
    fundingScheduleEvidenceReference: EVIDENCE.nhiaFunding,
    currentContributionDueDate: '2026-07-10',
    currentRemittanceCommitmentEvidenceReference: EVIDENCE.nhiaCurrent,
  }),
  nsitf: Object.freeze({
    registered: true,
    assessedRate: '0.01',
    employerRegistrationReference: EVIDENCE.nsitfRegistration,
    assessmentEvidenceReference: EVIDENCE.nsitfAssessment,
    assessmentDueDate: '2026-07-31',
    paymentChannel: 'NSITF Remita assessment route',
  }),
  itf: Object.freeze({
    registered: true,
    liableBy: 'employee_count',
    employerRegistrationReference: EVIDENCE.itfRegistration,
    // Visible minimum Form 5A basis: annual cash payroll 12,000,000 plus
    // employer pension 960,000 and employer NSITF 120,000. The adapter still
    // requires a certified employer Form 5A allocation rather than inferring it.
    form5AAnnualPayrollAllocation: '13080000.00',
    form5ABasisEvidenceReference: EVIDENCE.itfForm5A,
    calculationScope: 'employee_component_for_employer_aggregate',
  }),
  businessCalendar: Object.freeze({
    publicHolidays: Object.freeze([]),
    evidenceReference: EVIDENCE.calendar,
  }),
});

const PAYE_BAND_CASES = Object.freeze([
  Object.freeze({ name: 'zero income', chargeableIncome: '0.00', expectedAnnualTax: '0.00' }),
  Object.freeze({ name: 'first band ceiling', chargeableIncome: '800000.00', expectedAnnualTax: '0.00' }),
  Object.freeze({ name: 'one naira into 15 percent band', chargeableIncome: '800001.00', expectedAnnualTax: '0.15' }),
  Object.freeze({ name: '15 percent band ceiling', chargeableIncome: '3000000.00', expectedAnnualTax: '330000.00' }),
  Object.freeze({ name: 'one naira into 18 percent band', chargeableIncome: '3000001.00', expectedAnnualTax: '330000.18' }),
  Object.freeze({ name: '18 percent band ceiling', chargeableIncome: '12000000.00', expectedAnnualTax: '1950000.00' }),
  Object.freeze({ name: 'one naira into 21 percent band', chargeableIncome: '12000001.00', expectedAnnualTax: '1950000.21' }),
  Object.freeze({ name: '21 percent band ceiling', chargeableIncome: '25000000.00', expectedAnnualTax: '4680000.00' }),
  Object.freeze({ name: 'one naira into 23 percent band', chargeableIncome: '25000001.00', expectedAnnualTax: '4680000.23' }),
  Object.freeze({ name: '23 percent band ceiling', chargeableIncome: '50000000.00', expectedAnnualTax: '10430000.00' }),
  Object.freeze({ name: 'one naira into 25 percent band', chargeableIncome: '50000001.00', expectedAnnualTax: '10430000.25' }),
]);

const GOLDEN_CASES = Object.freeze([
  Object.freeze({
    id: 'NG_LAGOS_JUNE_STABLE_MONTHLY_WITH_RENT_RELIEF',
    input: BASE_INPUT,
    sourceBasis: Object.freeze([
      'NIGERIA_TAX_ACT_2025', 'JRB_PIT_GUIDELINES_2026', 'PENCOM_PRA_2014',
      'FMBN_NHF_ACT', 'NHIA_FORMAL_SECTOR_FAQ', 'NSITF_ECS_2026', 'ITF_AMENDMENT_ACT_2011',
    ]),
    independentlyCalculated: Object.freeze({
      monthlyGross: '1000000.00',
      annualGross: '12000000.00',
      employeePension: '64000.00',
      employerPension: '80000.00',
      employeeNhf: '12500.00',
      employeeNhia: '25000.00',
      employerNhia: '50000.00',
      employerNsitf: '10000.00',
      employerItfMonthlyProvision: '10900.00',
      annualRentRelief: '400000.00',
      annualEligibleDeductions: '1618000.00',
      annualChargeableIncome: '10382000.00',
      annualPaye: '1658760.00',
      cumulativePayeThroughJune: '829380.00',
      currentPaye: '138230.00',
      employeeStatutoryDeductions: '239730.00',
      netCashPay: '760270.00',
      employerStatutoryCostAndProvision: '150900.00',
      pensionDueDate: '2026-07-09',
      payeDueDate: '2026-07-10',
      nhfDueDate: '2026-07-30',
      itfDueDate: '2027-04-01',
      trace: Object.freeze({
        chargeable: '12,000,000 - (64,000*12 + 12,500*12 + 25,000*12 + 400,000) = 10,382,000',
        annualPaye: '0 + 2,200,000*15% + 7,382,000*18% = 1,658,760',
        cumulativeDelta: 'round(1,658,760*6/12, NGN0.01) - 691,150 = 138,230',
        employer: '80,000 pension + 50,000 NHIA + 10,000 NSITF + 10,900 ITF provision = 150,900',
      }),
    }),
  }),
]);

function buildBaseInput() {
  return JSON.parse(JSON.stringify(BASE_INPUT));
}

module.exports = Object.freeze({
  sourceRegistry: OFFICIAL_SOURCES,
  sourceUrls: Object.freeze(Object.fromEntries(Object.entries(OFFICIAL_SOURCES).map(([key, source]) => [key, source.url]))),
  sourceVersions: SOURCE_VERSIONS,
  evidence: EVIDENCE,
  baseInput: BASE_INPUT,
  buildBaseInput,
  payeBandCases: PAYE_BAND_CASES,
  goldenCases: GOLDEN_CASES,
});
