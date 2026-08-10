'use strict';

/**
 * Primary-source fixtures for SouthAfrica2027PayrollAdapter.
 *
 * Published SARS examples retain their source document identifier and the
 * numeric derivation is kept outside the calculator under test.
 */

const SOURCE_URLS = Object.freeze({
  SARS_EMPLOYER_GUIDE_2027: 'https://www.sars.gov.za/guide-for-employers-in-respect-of-employees-tax-2027/',
  SARS_TAX_DEDUCTION_GUIDE_2027: 'https://www.sars.gov.za/wp-content/uploads/Ops/Guides/PAYE-GEN-01-G01-Guide-for-Employers-in-respect-of-Tax-Deduction-Tables-External-Guide.pdf',
  SARS_MONTHLY_TABLE_2027: 'https://www.sars.gov.za/wp-content/uploads/Docs/PAYE/Tables/tables2026/PAYE-GEN-01-G01-A03-Monthly-Tax-Deduction-Tables-2027-External-Annexure.pdf',
  SARS_ANNUAL_TABLE_2027: 'https://www.sars.gov.za/wp-content/uploads/Docs/PAYE/Tables/tables2026/PAYE-GEN-01-G01-A04-Annual-Tax-Deduction-Tables-2027-External-Annexure.pdf',
  SARS_UIF: 'https://www.sars.gov.za/types-of-tax/unemployment-insurance-fund/',
  SARS_UIF_CEILING: 'https://www.sars.gov.za/latest-news/unemployment-insurance-fund-ceiling-earnings/',
  SARS_SDL: 'https://www.sars.gov.za/types-of-tax/skills-development-levy/',
  SARS_SDL_EMPLOYER_GUIDE: 'https://www.sars.gov.za/wp-content/uploads/Ops/Guides/SDL-GEN-01-G01-Guide-for-Employers-in-respect-of-Skills-Development-Levy-External-Guide.pdf',
  SARS_EMPLOYER_REGISTRATION: 'https://www.sars.gov.za/types-of-tax/pay-as-you-earn/registering/',
  SARS_EMP201: 'https://www.sars.gov.za/types-of-tax/pay-as-you-earn/completing-the-monthly-employer-declaration-emp201/',
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
    payDate: '2026-04-30',
    payFrequency: 'monthly',
    calculationMethod: 'monthly_table',
    employee: {
      dateOfBirth: '1990-01-01',
      identityType: 'south_african_id',
      identityNumber: '9001015009087',
      incomeTaxReferenceNumber: '0123456789',
      taxResidency: 'south_africa_only',
    },
    remuneration: {
      ordinaryCashRemuneration: '18600.00',
      allowableRetirementFundDeduction: '1100.00',
      balanceOfRemunerationForPaye: '17500.00',
      uifRemuneration: '18600.00',
      sdlLeviableAmount: '17500.00',
      retirementDeductionCertified: true,
      retirementFundEvidenceReference: 'FIXTURE_SARS_REGISTERED_FUNDS_AND_SECTION_11F_DEDUCTION',
      classificationCertified: true,
      classificationEvidenceReference: 'FIXTURE_ORDINARY_MONTHLY_REMUNERATION_CLASSIFICATION',
      uifClassification: 'covered',
      uifClassificationEvidenceReference: 'FIXTURE_UIF_COVERED_EMPLOYEE_CLASSIFICATION',
      hoursWorkedInMonth: '160.00',
    },
    medicalScheme: {
      personsCovered: 2,
      monthlyContributionPaidByTaxpayer: '900.00',
      registeredSchemeReference: 'CMS-REGISTERED-SCHEME-FIXTURE',
      evidenceReference: 'FIXTURE_MEDICAL_SCHEME_CONTRIBUTION_AND_BENEFICIARIES',
    },
    employer: {
      payeRegistrationNumber: '7123456789',
      payeRegistrationVerified: true,
      uifRegistrationNumber: 'U123456789',
      uifRegistrationAuthority: 'SARS',
      uifRegistrationVerified: true,
      registrationEvidenceReference: 'FIXTURE_SARS_EMPLOYER_REGISTRATION_EVIDENCE',
      sdlStatus: 'liable',
      sdlRegistrationNumber: 'L123456789',
      sdlRegistrationVerified: true,
      anticipatedLeviableRemunerationNext12Months: '600000.00',
      sdlStatusEvidenceReference: 'FIXTURE_SDL_LIABILITY_FORECAST_AND_REGISTRATION',
    },
    businessCalendar: {
      publicHolidays: [],
      evidenceReference: 'FIXTURE_SOUTH_AFRICA_PUBLIC_HOLIDAY_CALENDAR_REVIEWED',
    },
    cumulative: null,
    unsupported: {
      bonusOrAnnualPayment: false,
      directorRemuneration: false,
      fringeBenefitsOrAllowances: false,
      employmentTaxIncentive: false,
      foreignOrExpat: false,
      disabilityOrAdditionalMedicalCredit: false,
    },
  }, overrides);
}

const publishedMonthlyGuideFixture = Object.freeze({
  id: 'SARS-PAYE-GEN-01-G01-REV16-MONTHLY-EXAMPLE',
  sourceReferences: ['SARS_TAX_DEDUCTION_GUIDE_2027', 'SARS_MONTHLY_TABLE_2027'],
  sourceLocation: 'PAYE-GEN-01-G01 revision 16, page 5 of 6',
  input: buildBaseInput(),
  expected: {
    ordinaryCashRemuneration: '18600.00',
    pensionFundContribution: '775.00',
    retirementAnnuityContribution: '325.00',
    balanceOfRemuneration: '17500.00',
    tableTaxBeforeMedicalCredit: '1660.00',
    medicalSchemeFeeTaxCredit: '752.00',
    paye: '908.00',
    uifEmployee: '177.12',
    uifEmployer: '177.12',
    sdlEmployer: '175.00',
    employeeStatutoryLiabilities: '1085.12',
    employerStatutoryCost: '352.12',
    combinedStatutoryLiabilities: '1437.24',
    emp201DueDate: '2026-05-07',
  },
  derivation: 'SARS publishes R18,600 less R775 pension and R325 retirement annuity = R17,500; table PAYE R1,660 less R752 medical credit = R908. UIF is capped at R17,712 per side and SDL is 1% of the R17,500 leviable amount.',
});

const publishedCumulativeFixture = Object.freeze({
  id: 'SARS-PAYE-GEN-01-G21-2027-SEVEN-MONTH-ANNUAL-EQUIVALENT',
  sourceReferences: ['SARS_EMPLOYER_GUIDE_2027', 'SARS_ANNUAL_TABLE_2027'],
  sourceLocation: 'Annual Equivalent Calculation example: monthly employee worked seven full months',
  input: buildBaseInput({
    payDate: '2026-09-30',
    calculationMethod: 'cumulative_annual_equivalent',
    remuneration: {
      ordinaryCashRemuneration: '16000.00',
      allowableRetirementFundDeduction: '0.00',
      balanceOfRemunerationForPaye: '16000.00',
      uifRemuneration: '16000.00',
      sdlLeviableAmount: '16000.00',
      retirementFundEvidenceReference: 'FIXTURE_NO_RETIREMENT_DEDUCTION_CERTIFIED',
    },
    medicalScheme: {
      personsCovered: 0,
      monthlyContributionPaidByTaxpayer: '0.00',
      registeredSchemeReference: '',
      evidenceReference: '',
    },
    cumulative: {
      fullMonthsWorkedIncludingCurrent: 7,
      balanceOfRemunerationIncludingCurrent: '110000.00',
      payeWithheldBeforeCurrent: '0.00',
      sourceReceiptEvidenceReference: 'FIXTURE_SEVEN_POSTED_MONTHS_RECONCILED',
    },
  }),
  expected: {
    annualEquivalent: '188571.00',
    annualTableTax: '16156.00',
    cumulativeTaxForSevenMonths: '9424.33',
    currentPayeTrueUp: '9424.33',
  },
  derivation: 'SARS publishes R110,000 / 7 x 12 = R188,571; annual table tax R16,156; R16,156 / 12 x 7 = R9,424.33.',
});

const monthlyBoundaryFixtures = Object.freeze([
  {
    id: 'SARS-A03-2027-TIE-DOWN-RANGE-9525-9625',
    balance: '9525.00',
    expectedTableTax: '238.00',
    expectedLower: '9525',
    expectedUpper: '9625',
  },
  {
    id: 'SARS-A03-2027-NEXT-BAND-LOWER-BOUND-CONVENTION',
    balance: '22227.00',
    expectedTableTax: '2679.00',
    expectedLower: '22227',
    expectedUpper: '22377',
  },
  {
    id: 'SARS-A03-2027-RANGE-17244-17394',
    balance: '17394.99',
    expectedTableTax: '1632.00',
    expectedLower: '17244',
    expectedUpper: '17394',
  },
  {
    id: 'SARS-A03-2027-RANGE-17395-17545-LOWER',
    balance: '17395.00',
    expectedTableTax: '1660.00',
    expectedLower: '17395',
    expectedUpper: '17545',
  },
  {
    id: 'SARS-A03-2027-RANGE-17395-17545-UPPER-CENTS-DISREGARDED',
    balance: '17545.99',
    expectedTableTax: '1660.00',
    expectedLower: '17395',
    expectedUpper: '17545',
  },
  {
    id: 'SARS-A03-2027-RANGE-17546-17696',
    balance: '17546.00',
    expectedTableTax: '1687.00',
    expectedLower: '17546',
    expectedUpper: '17696',
  },
  {
    id: 'SARS-A03-2027-INTERVAL-TRANSITION-14978',
    balance: '14978.99',
    expectedTableTax: '1202.00',
    expectedLower: '14878',
    expectedUpper: '14978',
  },
  {
    id: 'SARS-A03-2027-INTERVAL-TRANSITION-14979',
    balance: '14979.00',
    expectedTableTax: '1225.00',
    expectedLower: '14979',
    expectedUpper: '15129',
  },
  {
    id: 'SARS-A03-2027-INTERVAL-TRANSITION-105579',
    balance: '105579.00',
    expectedTableTax: '33186.00',
    expectedLower: '105579',
    expectedUpper: '105779',
  },
]);

const ageBoundaryFixtures = Object.freeze([
  {
    id: 'TURNS-65-ON-ASSESSMENT-YEAR-END',
    dateOfBirth: '1962-02-28',
    expectedAge: 65,
    expectedAgeBand: '65_to_74',
    expectedTableTax: '846.00',
  },
  {
    id: 'TURNS-65-DAY-AFTER-ASSESSMENT-YEAR-END',
    dateOfBirth: '1962-03-01',
    expectedAge: 64,
    expectedAgeBand: 'under_65',
    expectedTableTax: '1660.00',
  },
  {
    id: 'TURNS-75-ON-ASSESSMENT-YEAR-END',
    dateOfBirth: '1952-02-28',
    expectedAge: 75,
    expectedAgeBand: '75_and_over',
    expectedTableTax: '575.00',
  },
  {
    id: 'TURNS-75-DAY-AFTER-ASSESSMENT-YEAR-END',
    dateOfBirth: '1952-03-01',
    expectedAge: 74,
    expectedAgeBand: '65_to_74',
    expectedTableTax: '846.00',
  },
]);

module.exports = {
  SOURCE_URLS,
  buildBaseInput,
  publishedMonthlyGuideFixture,
  publishedCumulativeFixture,
  monthlyBoundaryFixtures,
  ageBoundaryFixtures,
};
