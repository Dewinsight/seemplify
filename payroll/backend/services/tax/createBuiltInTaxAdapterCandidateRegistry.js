'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { TaxAdapterCandidateRegistry } = require('./TaxAdapterCandidateRegistry');

const uk = require('../UnitedKingdomPaye2026Service');
const ghana = require('../GhanaPayroll2026Service');
const canadaOntario = require('../countryAdapters/Canada2026OntarioPayrollAdapter');
const kenya = require('../countryAdapters/Kenya2026PayrollAdapter');
const nigeria = require('../countryAdapters/Nigeria2026PayrollAdapter');
const southAfrica = require('../countryAdapters/SouthAfrica2027PayrollAdapter');
const usFederal = require('./adapters/USFederalPayrollAdapter2026');

function fileDigest(relativePath) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.resolve(__dirname, relativePath)))
    .digest('hex');
}

function fileSetDigest(relativePaths) {
  const hash = crypto.createHash('sha256');
  for (const relativePath of [...relativePaths].sort()) {
    const content = fs.readFileSync(path.resolve(__dirname, relativePath));
    hash.update(relativePath);
    hash.update('\0');
    hash.update(String(content.length));
    hash.update('\0');
    hash.update(content);
  }
  return hash.digest('hex');
}

function ghanaRepresentativeInput() {
  return {
    taxYear: '2026',
    payDate: '2026-02-28',
    payFrequency: 'monthly',
    workerType: 'regular_permanent',
    residency: 'resident',
    pensionCoverage: 'mandatory_act_766',
    basicSalary: '5000.00',
    taxableCashAllowances: [{ code: 'TRANSPORT', amount: '500.00' }],
    benefits: [],
    reliefCertificate: null,
    bonus: { amount: '0.00' },
    overtime: { amount: '0.00' },
    tier2Scheme: {
      schemeName: 'Registry representative Tier 2 scheme',
      trusteeName: 'Registry representative trustee',
      custodianName: 'Registry representative custodian',
      npraRegistrationReference: 'NPRA-REGISTRY-REPRESENTATIVE-2026',
      evidenceHashSha256: 'a'.repeat(64),
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-12-31',
    },
  };
}

function createBuiltInTaxAdapterCandidateRegistry() {
  const registry = new TaxAdapterCandidateRegistry();

  registry.register({
    id: 'CA_ON_2026_WAVE_1',
    countryCode: 'CA',
    jurisdictionCode: 'CA-ON',
    displayName: 'Canada / Ontario Payroll 2026 Wave 1',
    currency: 'CAD',
    minorUnits: 2,
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-12-31',
    releaseStatus: 'certification_candidate',
    implementationDigestSha256: fileDigest('../countryAdapters/Canada2026OntarioPayrollAdapter.js'),
    fixtureDigestSha256: fileDigest('../countryAdapters/fixtures/Canada2026OntarioOfficialFixtures.js'),
    fixtureSuite: 'services/__tests__/Canada2026OntarioPayrollAdapter.test.js',
    officialSources: Object.values(canadaOntario.OFFICIAL_SOURCES).map((source) => source.url),
    supportedScope: [
      'ordinary periodic salary or wages with Ontario as the province of employment',
      'CRA T4127 Option 1 federal and Ontario withholding, CPP, CPP2, and standard-rate EI',
      'documented TD1/TD1ON, exact YTD caps, regular-remitter calendar, and PD7A liability metadata',
    ],
    goldenEvidence: [
      'Monthly CAD 5,000: CPP 280.15, employee EI 81.50, employer EI 114.10, federal tax 444.86, Ontario tax 248.47, net pay 3,945.02',
      'CPP2 and EI annual-maximum crossings are asserted to the cent with YTD context',
      '55 adapter tests and official January/July source-version selection fixtures',
    ],
    blockers: [
      'credentialed Canadian federal and Ontario tax-law, payroll-calculation, and independent-QA reviews are not recorded',
      'Quebec and every province or territory other than Ontario require separate certified adapters',
      'benefits, non-periodic pay, partial-year CPP, reduced-rate EI, non-regular remitters, corrections, and T4 filing remain excluded',
      'the adapter is not bound to a published effective-dated jurisdiction pack',
    ],
    calculate: canadaOntario.calculate,
  });

  registry.register({
    id: 'GB_PAYE_2026_WAVE_1',
    countryCode: 'GB',
    jurisdictionCode: 'GB',
    displayName: 'United Kingdom PAYE 2026/27 Wave 1',
    currency: 'GBP',
    minorUnits: 2,
    effectiveFrom: '2026-04-06',
    effectiveTo: '2027-04-05',
    releaseStatus: 'certification_candidate',
    implementationDigestSha256: fileDigest('../UnitedKingdomPaye2026Service.js'),
    fixtureDigestSha256: fileDigest('../__tests__/fixtures/unitedKingdomPaye2026.hmrc.json'),
    fixtureSuite: 'services/__tests__/UnitedKingdomPaye2026Service.test.js',
    officialSources: [
      'https://www.gov.uk/government/publications/payroll-technical-specifications-income-tax',
      'https://www.gov.uk/government/publications/software-developers-payroll-test-data-2026-to-2027',
    ],
    supportedScope: [
      'regular weekly and monthly cumulative or week-1/month-1 PAYE',
      'rest-of-UK, Scottish, and Welsh tax-code tables through D2',
      'HMRC regulatory deduction cap, refunds, FPS and remittance metadata',
    ],
    goldenEvidence: [
      '162 supported HMRC 2026/27 workbook rows independently replayed with zero mismatches',
      '91 adapter tests cover cumulative, W1/M1, regional, K, BR, D0-D2, 0T and NT cases',
    ],
    blockers: [
      'credentialed UK tax-law, payroll-calculation, and independent-QA reviews are not recorded',
      'SD3, week 53+, irregular intervals, free-of-tax calculations, and quarterly remitters remain excluded',
      'the adapter is not bound to a published effective-dated jurisdiction pack',
    ],
    calculate: (input) => uk.calculate(input),
  });

  registry.register({
    id: 'GH_2026_WAVE_1',
    countryCode: 'GH',
    jurisdictionCode: 'GH',
    displayName: 'Ghana Payroll 2026 Wave 1',
    currency: 'GHS',
    minorUnits: 2,
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-12-31',
    releaseStatus: 'certification_candidate',
    implementationDigestSha256: fileDigest('../GhanaPayroll2026Service.js'),
    fixtureDigestSha256: fileDigest('../__tests__/fixtures/ghanaPayroll2026.official.json'),
    fixtureSuite: 'services/__tests__/GhanaPayroll2026Service.test.js',
    officialSources: Object.values(ghana.OFFICIAL_SOURCES).map((source) => source.url),
    supportedScope: [
      'resident and non-resident ordinary monthly PAYE below the guarded top-band conflict',
      'SSNIT employee/employer amounts with Tier 1, Tier 2 and NHIA routing plus registered-scheme evidence',
      'evidence-bound reliefs, concessionary bonus, junior overtime and Act 1094 vehicle/fuel benefits',
    ],
    goldenEvidence: [
      'Monthly GHS 5,000 basic plus 500 allowance: PAYE 904.75, net pay 4,320.25',
      'GHS 1,500 pension base: employee 82.50, employer 195.00, Tier 1 202.50, Tier 2 75.00, NHIA 37.50',
      '51 adapter tests cover PAYE boundaries, pension min/max, bonus, overtime, benefits and liabilities',
    ],
    blockers: [
      'credentialed Ghana tax-law, payroll-calculation, and independent-QA reviews are not recorded',
      'GRA top-band widths and labels conflict; resident monthly chargeable income above GHS 50,000 is rejected',
      'SSNIT minimum Tier 1 allocation and fractional-pesewa rounding lack an unambiguous official rule',
      'casual/temporary/seasonal/expatriate cases, cumulative true-ups, salary changes and holiday-adjusted due dates remain excluded',
      'the adapter is not bound to a published effective-dated jurisdiction pack',
    ],
    calculate: ghana.calculate,
  });

  registry.register({
    id: 'KE_2026_MONTHLY_STANDALONE',
    countryCode: 'KE',
    jurisdictionCode: 'KE',
    displayName: 'Kenya Monthly Payroll 2026 Wave 1',
    currency: 'KES',
    minorUnits: 2,
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-12-31',
    releaseStatus: 'certification_candidate',
    implementationDigestSha256: fileDigest('../countryAdapters/Kenya2026PayrollAdapter.js'),
    fixtureDigestSha256: fileDigest('../countryAdapters/fixtures/Kenya2026OfficialFixtures.js'),
    fixtureSuite: 'services/__tests__/Kenya2026PayrollAdapter.test.js',
    officialSources: Object.values(kenya.OFFICIAL_SOURCES).map((source) => source.url),
    supportedScope: [
      'ordinary monthly resident/non-resident PAYE',
      'AHL, SHIF, NSSF Year 3/4, contracted-out Tier II, aggregate pension cap, PWD, and NITA',
      'exact component-level liability and remittance metadata',
    ],
    goldenEvidence: [
      'Monthly KES 100,000: PAYE 19,308.35, employee statutory 29,558.35, employer statutory 7,550.00, net pay 70,441.65',
      '40 adapter tests cover PAYE bands, NSSF years/ages, pension cap, PWD, NITA and liability metadata',
    ],
    blockers: [
      'credentialed Kenya tax-law, payroll-calculation, and independent-QA reviews are not recorded',
      'benefit/reimbursement valuation, annual reconciliation, multiple employments, and prior-period corrections remain excluded',
      'NITA statutory and operational due-date guidance conflicts and needs counsel sign-off',
      'the adapter is not bound to a published effective-dated jurisdiction pack',
    ],
    calculate: kenya.calculate,
  });

  registry.register({
    id: 'NG_2026_WAVE_1',
    countryCode: 'NG',
    jurisdictionCode: 'NG-LA',
    displayName: 'Nigeria Payroll 2026 Wave 1',
    currency: 'NGN',
    minorUnits: 2,
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-12-31',
    releaseStatus: 'certification_candidate',
    implementationDigestSha256: fileDigest('../countryAdapters/Nigeria2026PayrollAdapter.js'),
    fixtureDigestSha256: fileDigest('../countryAdapters/fixtures/Nigeria2026OfficialFixtures.js'),
    fixtureSuite: 'services/__tests__/Nigeria2026PayrollAdapter.test.js',
    officialSources: Object.values(nigeria.OFFICIAL_SOURCES).map((source) => source.url),
    supportedScope: [
      'ordinary resident organised-private-sector employee with at least five employees and stable monthly terms',
      '2026 JRB/Nigeria Tax Act cumulative PAYE delta with a pinned synthetic State/FCT preview route',
      'PRA pension, NHF, evidenced OPSSHIP/NHIA and NSITF, ITF provision and liability metadata',
    ],
    goldenEvidence: [
      'Monthly NGN 1,000,000 June payroll: PAYE 138,230.00, employee statutory deductions 239,730.00, net pay 760,270.00',
      'Employer pension/NHIA/NSITF/ITF cost and provision total 150,900.00 using the visible minimum Form 5A fixture basis',
      '56 adapter tests cover all PAYE band boundaries, cumulative YTD, contributions, evidence and fail-closed exclusions',
    ],
    blockers: [
      'the review evidence is AI-generated and is not a licensed Nigerian tax-professional opinion',
      'each State or FCT filing route, registration, form and local administrative overlay requires separate certification',
      'variable pay, starters/leavers, corrections, benefits and other non-periodic cases lack a certified cumulative method',
      'NHIA and NSITF due dates/risk rates plus the ITF Form 5A basis require employer evidence or Nigerian counsel',
      'the declared kobo rounding sequence is not prescribed by the pinned national sources',
      'the adapter is not bound to a published effective-dated jurisdiction pack',
    ],
    calculate: nigeria.calculate,
  });

  registry.register({
    id: 'US_FEDERAL_2026_WAVE1',
    countryCode: 'US',
    jurisdictionCode: 'US',
    displayName: 'United States Federal Payroll 2026 Wave 1',
    currency: 'USD',
    minorUnits: 2,
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-12-31',
    releaseStatus: 'certification_candidate',
    implementationDigestSha256: fileDigest('adapters/USFederalPayrollAdapter2026.js'),
    fixtureDigestSha256: fileDigest('../__tests__/USFederalPayrollAdapter2026.test.js'),
    fixtureSuite: 'services/__tests__/USFederalPayrollAdapter2026.test.js',
    officialSources: [
      'https://www.irs.gov/pub/irs-pdf/p15t.pdf',
      'https://www.irs.gov/publications/p15',
      'https://www.irs.gov/instructions/i941',
    ],
    supportedScope: [
      '2026 federal income-tax withholding for current and 2019-or-earlier W-4',
      'exempt, NRA adjustment, supplemental flat methods, FICA, Additional Medicare, and FUTA',
      'Form 941/940 component liability metadata',
    ],
    goldenEvidence: [
      'Biweekly USD 2,500 single W-4: federal income tax 216.15, employee FICA 191.25, employer FICA 191.25, net FUTA 15.00',
      '31 adapter tests cover current/old W-4, NRA, supplemental wages, FICA caps and FUTA',
    ],
    blockers: [
      'credentialed US federal tax-law, payroll-calculation, and independent-QA reviews are not recorded',
      'all state, local, and SUTA determinations require separately certified effective-dated companion adapters',
      'lock-in letters, aggregate supplemental method, and multi-day daily payroll remain excluded',
      'the adapter is not bound to a published effective-dated jurisdiction pack',
    ],
    calculate: usFederal.calculate,
  });

  registry.register({
    id: 'ZA_2027_WAVE_1',
    countryCode: 'ZA',
    jurisdictionCode: 'ZA',
    displayName: 'South Africa Payroll 2027 Year of Assessment Wave 1',
    currency: 'ZAR',
    minorUnits: 2,
    effectiveFrom: '2026-03-01',
    effectiveTo: '2027-02-28',
    releaseStatus: 'certification_candidate',
    implementationDigestSha256: fileDigest('../countryAdapters/SouthAfrica2027PayrollAdapter.js'),
    fixtureDigestSha256: fileSetDigest([
      '../countryAdapters/fixtures/SouthAfrica2027OfficialFixtures.js',
      '../countryAdapters/fixtures/SouthAfrica2027AnnualTableRows.js',
    ]),
    fixtureSuite: 'services/__tests__/SouthAfrica2027PayrollAdapter.test.js',
    officialSources: Object.values(southAfrica.OFFICIAL_SOURCES).map((source) => source.url),
    supportedScope: [
      'ordinary monthly PAYE using the SARS A03 table and cumulative annual-equivalent PAYE using A04',
      'all 1,635 published annual-table rows, age/rebate boundaries and medical scheme fee tax credits',
      'UIF, SDL and EMP201 liability/remittance metadata with employer-registration evidence',
    ],
    goldenEvidence: [
      'Monthly ZAR 18,600 less certified retirement deductions: PAYE 908.00, UIF 177.12 each side, SDL 175.00',
      'Cumulative ZAR 110,000 over seven months: annual-equivalent 188,571, annual table tax 16,156, seven-month target 9,424.33',
      '57 adapter tests plus all 1,635 exact contiguous SARS annual annexure rows',
    ],
    blockers: [
      'credentialed South African tax-law, payroll-calculation, and independent-QA reviews are not recorded',
      'bonuses, directors, fringe benefits, allowances, ETI, expatriates, AMTC/disability, UIF exclusions and SDL exemptions remain excluded',
      'generic UIF/SDL fractional-cent rounding and the acknowledged manual-table versus statutory-program differences require professional sign-off',
      'the adapter is not bound to a published effective-dated jurisdiction pack',
    ],
    calculate: southAfrica.calculate,
  });

  return registry;
}

module.exports = createBuiltInTaxAdapterCandidateRegistry;
module.exports.ghanaRepresentativeInput = ghanaRepresentativeInput;
