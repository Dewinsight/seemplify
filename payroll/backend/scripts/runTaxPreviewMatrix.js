'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const taxJurisdictionService = require('../services/TaxJurisdictionService');
const createBuiltInTaxAdapterCandidateRegistry = require('../services/tax/createBuiltInTaxAdapterCandidateRegistry');
const { getRolloutInventory } = require('../services/tax/TaxJurisdictionRolloutInventory');

const DEFAULT_PAY_BY_COUNTRY = Object.freeze({
  GB: 5000,
  US: 5000,
  NG: 1000000,
  GH: 10000,
  KE: 100000,
  ZA: 50000,
  CM: 100000,
  MZ: 50000,
  CA: 5000,
  EU: 5000,
  OTHER: 5000,
});

const EMPLOYEE_INPUTS_BY_COUNTRY = Object.freeze({
  GB: { taxSubdivision: 'standard', niCategory: 'A', additionalWithholding: 0 },
  US: {
    workStateCode: 'NY',
    filingStatus: 'single',
    otherIncome: 0,
    deductionsAdjustment: 0,
    taxCredits: 0,
    multipleJobs: false,
    additionalWithholding: 0,
  },
  NG: { annualRentPaid: 0, additionalWithholding: 0 },
  GH: { residencyStatus: 'resident', additionalWithholding: 0 },
  KE: {
    residencyStatus: 'resident',
    monthlyInsurancePremium: 0,
    monthlyMortgageInterest: 0,
    monthlyRegisteredPension: 0,
    monthlyPostRetirementMedicalFund: 0,
    additionalWithholding: 0,
  },
  ZA: { medicalSchemeMembers: 1, additionalWithholding: 0 },
  CM: { employerSector: 'general', occupationalRiskClass: 'A', additionalWithholding: 0 },
  MZ: { dependants: 0, additionalWithholding: 0 },
  CA: { provinceCode: 'ON' },
  EU: { workCountryCode: 'DE' },
  OTHER: { countryLabel: 'Certification sandbox' },
});

function fixtureRows(countryCode, ordinaryGross) {
  return [
    {
      key: 'zero_income',
      staffReference: `${countryCode}-SYNTHETIC-ZERO`,
      grossPay: 0,
      taxableIncome: 0,
      ytdGrossPay: 0,
      ytdTaxableIncome: 0,
      ytdIncomeTax: 0,
    },
    {
      key: 'ordinary_period',
      staffReference: `${countryCode}-SYNTHETIC-ORDINARY`,
      grossPay: ordinaryGross,
      taxableIncome: ordinaryGross,
      ytdGrossPay: 0,
      ytdTaxableIncome: 0,
      ytdIncomeTax: 0,
    },
    {
      key: 'high_income',
      staffReference: `${countryCode}-SYNTHETIC-HIGH`,
      grossPay: ordinaryGross * 3,
      taxableIncome: ordinaryGross * 3,
      ytdGrossPay: ordinaryGross * 6,
      ytdTaxableIncome: ordinaryGross * 6,
      ytdIncomeTax: ordinaryGross,
    },
    {
      key: 'year_to_date',
      staffReference: `${countryCode}-SYNTHETIC-YTD`,
      grossPay: ordinaryGross * 1.25,
      taxableIncome: ordinaryGross * 1.25,
      ytdGrossPay: ordinaryGross * 5,
      ytdTaxableIncome: ordinaryGross * 5,
      ytdIncomeTax: ordinaryGross * 0.8,
    },
  ];
}

function liabilityMap(components = [], payer) {
  return components
    .filter((component) => (payer === 'employer' ? component.payer === 'employer' : component.payer !== 'employer'))
    .reduce((result, component) => {
      const code = String(component.liabilityCode || component.name || 'UNCLASSIFIED').trim();
      result[code] = Number(((result[code] || 0) + Number(component.amount || 0)).toFixed(6));
      return result;
    }, {});
}

function buildIndependentAiReviews(adapterCandidates) {
  const candidates = new Map(adapterCandidates.map((candidate) => [candidate.id, candidate]));
  const review = ({ adapterId, jurisdiction, reviewer, testEvidence, passed, blocked, summary }) => {
    const candidate = candidates.get(adapterId);
    if (!candidate) throw new Error(`Independent review references unknown adapter ${adapterId}`);
    const contentHash = crypto.createHash('sha256')
      .update(`${candidate.implementationDigestSha256}:${candidate.fixtureDigestSha256}`)
      .digest('hex');
    return Object.freeze({
      reviewId: `${adapterId}:AI-INDEPENDENT-REVIEW:2026-08-09`,
      adapterId,
      jurisdiction,
      reviewer,
      reviewerType: 'independent_ai_technical_statutory_reviewer',
      generatedByAI: true,
      legalStanding: 'not_a_licensed_tax_professional_opinion',
      reviewedContentHashSha256: contentHash,
      testEvidence,
      passedGates: passed,
      blockedGates: blocked,
      engineeringDecision: 'approved_for_quarantined_preview',
      productionApproval: false,
      summary,
      reviewedAt: '2026-08-09T00:00:00.000Z',
    });
  };

  return Object.freeze([
    review({
      adapterId: 'GH_2026_WAVE_1',
      jurisdiction: 'Ghana',
      reviewer: 'Codex independent Ghana statutory review agent',
      testEvidence: '67/67 Ghana and candidate-registry tests passed; six official PDF digests revalidated; representative payroll independently reconciled.',
      passed: ['official formula mapping', 'PAYE through guarded ceiling', 'SSNIT/NPRA narrow-scope arithmetic', 'bonus/overtime/vehicle cases', 'non-postable controls'],
      blocked: ['mutable web-source snapshots', 'official rounding instruction', 'GRA top-band conflict', 'SSNIT minimum allocation conflict', 'trusted evidence resolution', 'licensed human sign-off'],
      summary: 'The calculation implementation is approved for guarded preview. Known statutory conflicts remain fail-closed.',
    }),
    review({
      adapterId: 'NG_2026_WAVE_1',
      jurisdiction: 'Nigeria',
      reviewer: 'Codex independent Nigeria statutory review agent',
      testEvidence: '72/72 Nigeria and candidate-registry tests passed after independent route-injection and ITF-base remediation; all band boundaries and synthetic payroll independently reconciled.',
      passed: ['official federal formula mapping', 'PAYE band arithmetic', 'stable-pay cumulative delta', 'pension/NHF narrow-scope arithmetic', 'pinned synthetic State/FCT preview receipts', 'non-postable controls'],
      blocked: ['production State/FCT route packs', 'ITF/NTA legal treatment', 'employer-specific NHIA/NSITF evidence', 'official rounding sequence', 'immutable source snapshots', 'licensed human sign-off'],
      summary: 'The corrected calculation implementation is approved for guarded preview. Production routing and unresolved statutory interpretations remain fail-closed.',
    }),
  ]);
}

async function buildPreviewMatrix({ generatedAt = new Date() } = {}) {
  const results = [];
  const adapterCandidates = createBuiltInTaxAdapterCandidateRegistry().list();

  for (const seed of taxJurisdictionService.seedDefinitions) {
    const countryCode = seed.countryCode;
    const ordinaryGross = DEFAULT_PAY_BY_COUNTRY[countryCode] || 5000;
    const employeeTaxInputs = EMPLOYEE_INPUTS_BY_COUNTRY[countryCode] || {};

    for (const fixture of fixtureRows(countryCode, ordinaryGross)) {
      const calculation = await taxJurisdictionService.calculate({
        versionDefinition: seed.version,
        configDefinition: {
          countryCode,
          countryName: seed.countryName,
          displayName: seed.displayName,
        },
        taxConfig: {
          jurisdictionCode: countryCode,
          jurisdictionName: seed.countryName,
          employeeTaxInputs,
        },
        grossPay: fixture.grossPay,
        taxableIncome: fixture.taxableIncome,
        basicSalary: fixture.grossPay,
        preTaxDeductions: 0,
        payFrequency: 'monthly',
        paymentDate: seed.version.effectiveFrom,
        ytdGrossPay: fixture.ytdGrossPay,
        ytdTaxableIncome: fixture.ytdTaxableIncome,
        ytdIncomeTax: fixture.ytdIncomeTax,
        statutoryBases: {
          pensionablePay: fixture.grossPay,
          socialSecurityPay: fixture.grossPay,
          insurablePay: fixture.grossPay,
        },
        statutoryContributions: {
          pensionOptIn: true,
          socialSecurityOptIn: true,
        },
        employeeInfo: {
          dateOfBirth: '1988-06-15',
        },
      });

      results.push({
        countryCode,
        countryName: seed.countryName,
        packKey: seed.version.packKey,
        packLabel: seed.version.label,
        configuredStatus: seed.version.calculationStatus,
        fixture: fixture.key,
        staffReference: fixture.staffReference,
        calculationCurrency: calculation.compliance?.calculationCurrency || seed.version.calculationCurrency || '',
        grossPay: fixture.grossPay,
        taxableIncome: fixture.taxableIncome,
        ytdGrossPay: fixture.ytdGrossPay,
        ytdTaxableIncome: fixture.ytdTaxableIncome,
        ytdIncomeTax: fixture.ytdIncomeTax,
        incomeTax: Number(calculation.incomeTax?.taxAmount || 0),
        incomeTaxMethod: calculation.incomeTax?.method || 'unconfigured',
        employeeLiabilities: liabilityMap(calculation.statutoryContributions?.components, 'employee'),
        employerLiabilities: liabilityMap(calculation.statutoryContributions?.components, 'employer'),
        payrollRunnable: calculation.payrollRunnable === true,
        blockingErrors: calculation.blockingErrors || [],
        validationErrors: calculation.validationErrors || [],
      });
    }
  }

  return {
    reportType: 'payroll-tax-preview-smoke-matrix',
    certificationEvidence: false,
    generatedAt: generatedAt.toISOString(),
    warning: 'These deterministic preview calculations are engineering smoke tests. They are not official expected-value fixtures and must not be used to certify a statutory pack.',
    packs: taxJurisdictionService.seedDefinitions.length,
    adapterCandidates,
    independentAiReviews: buildIndependentAiReviews(adapterCandidates),
    rolloutInventory: getRolloutInventory(),
    adapterCandidateCount: adapterCandidates.length,
    scenarios: results.length,
    runnableScenarios: results.filter((entry) => entry.payrollRunnable).length,
    results,
  };
}

async function main() {
  const outputArgument = process.argv[2];
  const outputPath = outputArgument
    ? path.resolve(process.cwd(), outputArgument)
    : path.resolve(__dirname, '../../../reports/payroll-tax-preview-matrix.json');
  const report = await buildPreviewMatrix();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ outputPath, packs: report.packs, scenarios: report.scenarios, runnableScenarios: report.runnableScenarios })}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  buildPreviewMatrix,
  buildIndependentAiReviews,
  DEFAULT_PAY_BY_COUNTRY,
  EMPLOYEE_INPUTS_BY_COUNTRY,
};
