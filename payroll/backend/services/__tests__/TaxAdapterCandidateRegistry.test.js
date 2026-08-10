'use strict';

const {
  TaxAdapterCandidateRegistry,
  TaxAdapterCandidateRegistryError,
} = require('../tax/TaxAdapterCandidateRegistry');
const createBuiltInRegistry = require('../tax/createBuiltInTaxAdapterCandidateRegistry');
const { ghanaRepresentativeInput } = require('../tax/createBuiltInTaxAdapterCandidateRegistry');
const canadaFixtures = require('../countryAdapters/fixtures/Canada2026OntarioOfficialFixtures');
const { buildBaseInput } = require('../countryAdapters/fixtures/Kenya2026OfficialFixtures');
const nigeriaFixtures = require('../countryAdapters/fixtures/Nigeria2026OfficialFixtures');
const southAfricaFixtures = require('../countryAdapters/fixtures/SouthAfrica2027OfficialFixtures');

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);

function descriptor(overrides = {}) {
  return {
    id: 'EX_TEST_2026',
    countryCode: 'GB',
    jurisdictionCode: 'GB',
    displayName: 'Example candidate',
    currency: 'GBP',
    minorUnits: 2,
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-12-31',
    releaseStatus: 'standalone_preview_only',
    implementationDigestSha256: DIGEST_A,
    fixtureDigestSha256: DIGEST_B,
    fixtureSuite: 'example.test.js',
    officialSources: ['https://www.gov.uk/example'],
    supportedScope: ['ordinary monthly case'],
    blockers: ['not independently certified'],
    calculate: (input) => ({ runnable: false, answer: input.amount }),
    ...overrides,
  };
}

function usInput() {
  const certified = (kind, jurisdictionCode, extras = {}) => ({
    kind,
    jurisdictionCode,
    applicability: 'applicable',
    certificationStatus: 'certified',
    certificationId: `cert-${kind}`,
    versionId: `2026-${jurisdictionCode}`,
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-12-31',
    ...extras,
  });
  return {
    taxYear: 2026,
    payDate: '2026-01-15',
    payFrequency: 'biweekly',
    regularTaxableWages: '2500.00',
    ficaTaxableWages: '2500.00',
    futaTaxableWages: '2500.00',
    ytd: {
      socialSecurityWages: '0.00', medicareWages: '0.00', futaWages: '0.00',
      supplementalWagesCommonControl: '0.00',
    },
    w4: {
      version: '2020_or_later', filingStatus: 'single_or_married_filing_separately',
      multipleJobs: false, credits: '0.00', otherIncome: '0.00', deductions: '0.00',
      additionalWithholding: '0.00', exempt: false,
    },
    nonresidentAlien: { applies: false },
    supplemental: {
      taxableWages: '0.00', method: 'optional_flat',
      regularIncomeTaxWithheldInCurrentOrPriorYear: true,
    },
    employerFuta: {
      category: 'general', maxQuarterlyWages2025: '0.00', maxQuarterlyWages2026: '1500.00',
      weeksWithEmployee2025: 0, weeksWithEmployee2026: 0,
    },
    workLocation: { countryCode: 'US', subdivisionCode: 'US-NY', localityCode: 'US-NY-NYC' },
    companionAdapters: {
      stateWithholding: certified('state_withholding', 'US-NY'),
      localWithholding: certified('local_withholding', 'US-NY-NYC'),
      stateUnemployment: certified('state_unemployment', 'US-NY', { futaCreditRate: '0.054' }),
    },
  };
}

describe('TaxAdapterCandidateRegistry quarantine contract', () => {
  test('registers and lists immutable preview candidates', () => {
    const registry = new TaxAdapterCandidateRegistry();
    const registered = registry.register(descriptor());
    expect(registered.id).toBe('EX_TEST_2026');
    expect(registered.calculate).toBeUndefined();
    expect(Object.isFrozen(registered)).toBe(true);
    expect(registry.list()).toHaveLength(1);
  });

  test.each(['runnable', 'published', 'production'])('rejects posting-capable status %s', (releaseStatus) => {
    const registry = new TaxAdapterCandidateRegistry();
    expect(() => registry.register(descriptor({ releaseStatus })))
      .toThrow(expect.objectContaining({ code: 'TAX_ADAPTER_CANDIDATE_POSTING_FORBIDDEN' }));
  });

  test('requires pinned code/fixture digests, primary HTTPS sources, and explicit blockers', () => {
    const cases = [
      descriptor({ implementationDigestSha256: 'abc' }),
      descriptor({ fixtureDigestSha256: '' }),
      descriptor({ officialSources: ['http://example.com'] }),
      descriptor({ blockers: [] }),
    ];
    for (const candidate of cases) {
      const registry = new TaxAdapterCandidateRegistry();
      expect(() => registry.register(candidate)).toThrow(TaxAdapterCandidateRegistryError);
    }
  });

  test('returns a deterministic, non-postable preview receipt', () => {
    const registry = new TaxAdapterCandidateRegistry();
    registry.register(descriptor());
    const first = registry.calculatePreview('ex_test_2026', { amount: '12.34', nested: { b: 2, a: 1 } });
    const second = registry.calculatePreview('EX_TEST_2026', { nested: { a: 1, b: 2 }, amount: '12.34' });
    expect(first.execution).toMatchObject({
      mode: 'preview_only', postingAllowed: false, adapterId: 'EX_TEST_2026',
    });
    expect(first.execution.inputDigestSha256).toBe(second.execution.inputDigestSha256);
    expect(first.execution.outputDigestSha256).toBe(second.execution.outputDigestSha256);
    expect(first.result.answer).toBe('12.34');
    expect(Object.isFrozen(first)).toBe(true);
  });

  test('blocks a candidate implementation that tries to authorize posting', () => {
    const registry = new TaxAdapterCandidateRegistry();
    registry.register(descriptor({ calculate: () => ({ runnable: true, postingAllowed: true }) }));
    expect(() => registry.calculatePreview('EX_TEST_2026', {}))
      .toThrow(expect.objectContaining({ code: 'TAX_ADAPTER_CANDIDATE_UNSAFE_OUTPUT' }));
  });

  test('preserves the adapter error as a fail-closed preview receipt failure', () => {
    const registry = new TaxAdapterCandidateRegistry();
    const cause = Object.assign(new Error('unsupported case'), { code: 'EX_UNSUPPORTED' });
    registry.register(descriptor({ calculate: () => { throw cause; } }));
    try {
      registry.calculatePreview('EX_TEST_2026', { amount: '1.00' });
      throw new Error('expected failure');
    } catch (error) {
      expect(error.code).toBe('TAX_ADAPTER_CANDIDATE_CALCULATION_FAILED');
      expect(error.details.adapterErrorCode).toBe('EX_UNSUPPORTED');
      expect(error.cause).toBe(cause);
    }
  });
});

describe('built-in researched adapter candidates', () => {
  test('catalogues Canada/Ontario, Ghana, UK, Kenya, Nigeria, US, and South Africa without a posting path', () => {
    const registry = createBuiltInRegistry();
    expect(registry.list().map((entry) => entry.id)).toEqual([
      'CA_ON_2026_WAVE_1',
      'GB_PAYE_2026_WAVE_1',
      'GH_2026_WAVE_1',
      'KE_2026_MONTHLY_STANDALONE',
      'NG_2026_WAVE_1',
      'US_FEDERAL_2026_WAVE1',
      'ZA_2027_WAVE_1',
    ]);
    for (const candidate of registry.list()) {
      expect(candidate.releaseStatus).toBe('certification_candidate');
      expect(candidate.blockers.length).toBeGreaterThan(0);
      expect(candidate.goldenEvidence.length).toBeGreaterThan(0);
      expect(candidate.officialSources.length).toBeGreaterThan(0);
      expect(candidate.implementationDigestSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(candidate.fixtureDigestSha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  test('executes a Canada/Ontario official-scope preview but never authorizes payroll posting', () => {
    const receipt = createBuiltInRegistry().calculatePreview(
      'CA_ON_2026_WAVE_1',
      canadaFixtures.baseInput
    );
    expect(receipt.execution.postingAllowed).toBe(false);
    expect(receipt.result.adapter.previewOnly).toBe(true);
    expect(receipt.result.adapter.postable).toBe(false);
    expect(receipt.result.totals.netCashPay.amount).toBe('3945.02');
    expect(receipt.result.remittance.formCode).toBe('PD7A');
  });

  test('executes a UK official-scope preview but never authorizes payroll posting', () => {
    const receipt = createBuiltInRegistry().calculatePreview('GB_PAYE_2026_WAVE_1', {
      payFrequency: 'monthly', basis: 'week1_month1', periodNumber: 1, grossPay: '1000.00',
      taxCode: '1257L', payDate: '2026-04-30', remittanceMethod: 'electronic',
      remittanceFrequency: 'monthly',
    });
    expect(receipt.execution.postingAllowed).toBe(false);
    expect(receipt.result.taxDue).toBe('0.00');
    expect(receipt.result.runnable).toBe(false);
  });

  test('executes a Ghana official-scope preview but never authorizes payroll posting', () => {
    const receipt = createBuiltInRegistry().calculatePreview(
      'GH_2026_WAVE_1',
      ghanaRepresentativeInput()
    );
    expect(receipt.execution.postingAllowed).toBe(false);
    expect(receipt.result.adapter.runnable).toBe(false);
    expect(receipt.result.adapter.postable).toBe(false);
    expect(receipt.result.paye.amount.amount).toBe('904.75');
    expect(receipt.result.totals.netCashPay.amount).toBe('4320.25');
  });

  test('executes a Kenya official-scope preview but never authorizes payroll posting', () => {
    const receipt = createBuiltInRegistry().calculatePreview(
      'KE_2026_MONTHLY_STANDALONE',
      buildBaseInput()
    );
    expect(receipt.execution.postingAllowed).toBe(false);
    expect(receipt.result.paye.amount.amount).toBe('19308.35');
    expect(receipt.result.adapter.integrationStatus).toBe('standalone_not_integrated');
  });

  test('executes a US federal preview while preserving nationwide blockers', () => {
    const receipt = createBuiltInRegistry().calculatePreview('US_FEDERAL_2026_WAVE1', usInput());
    expect(receipt.execution.postingAllowed).toBe(false);
    expect(receipt.result.runnable).toBe(false);
    expect(receipt.result.postingAllowed).toBe(false);
    expect(receipt.result.adapter.scope).toBe('federal_only');
  });

  test('executes a Nigeria official-scope preview but never authorizes payroll posting', () => {
    const receipt = createBuiltInRegistry().calculatePreview(
      'NG_2026_WAVE_1',
      nigeriaFixtures.buildBaseInput()
    );
    expect(receipt.execution.postingAllowed).toBe(false);
    expect(receipt.result.adapter.previewOnly).toBe(true);
    expect(receipt.result.adapter.postable).toBe(false);
    expect(receipt.result.incomeTax.currentPaye.amount).toBe('138230.00');
    expect(receipt.result.totals.netCashPay.amount).toBe('760270.00');
  });

  test('executes a South Africa official-scope preview but never authorizes payroll posting', () => {
    const receipt = createBuiltInRegistry().calculatePreview(
      'ZA_2027_WAVE_1',
      southAfricaFixtures.buildBaseInput()
    );
    expect(receipt.execution.postingAllowed).toBe(false);
    expect(receipt.result.adapter.runnable).toBe(false);
    expect(receipt.result.adapter.postingAllowed).toBe(false);
    expect(receipt.result.paye.amount.amount).toBe('908.00');
    expect(receipt.result.uif.employee.amount).toBe('177.12');
    expect(receipt.result.sdl.amount.amount).toBe('175.00');
  });
});
