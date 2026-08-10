const taxJurisdictionService = require('../TaxJurisdictionService');
const payComponentTaxService = require('../PayComponentTaxService');
const TaxJurisdictionConfig = require('../../models/TaxJurisdictionConfig');

function seed(code) {
  const definition = taxJurisdictionService.seedDefinitions.find((entry) => entry.countryCode === code);
  if (!definition) throw new Error(`Missing ${code} seed`);
  return definition;
}

async function calculate(code, input = {}) {
  const definition = seed(code);
  return taxJurisdictionService.calculate({
    versionDefinition: definition.version,
    configDefinition: {
      countryCode: definition.countryCode,
      countryName: definition.countryName,
      displayName: definition.displayName,
    },
    taxConfig: {
      jurisdictionCode: code,
      employeeTaxInputs: input.employeeTaxInputs || {},
    },
    grossPay: input.grossPay || 0,
    taxableIncome: input.taxableIncome ?? input.grossPay ?? 0,
    basicSalary: input.basicSalary ?? input.grossPay ?? 0,
    preTaxDeductions: input.preTaxDeductions || 0,
    statutoryBases: input.statutoryBases || { pensionablePay: input.grossPay || 0 },
    statutoryContributions: input.statutoryContributions || {},
    employeeInfo: input.employeeInfo || {},
    payFrequency: input.payFrequency || 'monthly',
    paymentDate: input.paymentDate || new Date('2026-08-31T00:00:00.000Z'),
    ytdGrossPay: input.ytdGrossPay || 0,
    ytdTaxableIncome: input.ytdTaxableIncome || 0,
  });
}

function certifiedFlatRateCases(sourceReference = 'Authority') {
  const makeCase = ({
    name,
    category,
    grossPay,
    ytdGrossPay = 0,
    ytdTaxableIncome = 0,
    ytdIncomeTax = 0,
    boundary,
    employerCost = false,
  }) => ({
    name,
    category,
    sourceReferences: [sourceReference],
    ...(boundary ? { boundary } : {}),
    inputs: {
      grossPay,
      taxableIncome: grossPay,
      ytdGrossPay,
      ytdTaxableIncome,
      ytdIncomeTax,
      ...(employerCost ? { employerInputs: { includeCertificationLiability: true } } : {}),
    },
    expected: {
      taxAmount: Math.round((grossPay * 10) / 100 * 100) / 100,
      employeeStatutory: 0,
      employerStatutory: employerCost ? 75 : 0,
      employeeLiabilities: {},
      employerLiabilities: employerCost ? { TEST_EMPLOYER_LIABILITY: 75 } : {},
      incomeTaxMethod: 'flat_rate',
      calculationCurrency: 'USD',
      payrollRunnable: true,
    },
  });

  const threshold = 1500;
  const roundingUnit = 0.01;
  const boundaryDeclaration = {
    group: 'monthly-taxable-income-1500',
    inputPath: 'taxableIncome',
    threshold,
    roundingUnit,
  };

  return [
    makeCase({ name: 'Certified zero income', category: 'zero_income', grossPay: 0 }),
    makeCase({ name: 'Certified ordinary period', category: 'ordinary_period', grossPay: 1000 }),
    makeCase({
      name: 'Certified threshold below',
      category: 'threshold_boundary',
      grossPay: threshold - roundingUnit,
      boundary: { ...boundaryDeclaration, position: 'below' },
    }),
    makeCase({
      name: 'Certified threshold exact',
      category: 'threshold_boundary',
      grossPay: threshold,
      boundary: { ...boundaryDeclaration, position: 'exact' },
    }),
    makeCase({
      name: 'Certified threshold above',
      category: 'threshold_boundary',
      grossPay: threshold + roundingUnit,
      boundary: { ...boundaryDeclaration, position: 'above' },
    }),
    makeCase({ name: 'Certified high income', category: 'high_income', grossPay: 10000 }),
    makeCase({
      name: 'Certified year to date',
      category: 'year_to_date',
      grossPay: 1250,
      ytdGrossPay: 12000,
      ytdTaxableIncome: 12000,
      ytdIncomeTax: 1200,
    }),
    makeCase({
      name: 'Certified employer cost',
      category: 'employer_cost',
      grossPay: 2000,
      employerCost: true,
    }),
  ];
}

function certifiedPrimarySource(overrides = {}) {
  return {
    label: 'Authority',
    url: 'https://authority.example.test/rules',
    authorityType: 'tax_authority',
    isPrimary: true,
    checkedAt: new Date('2026-08-09T00:00:00.000Z'),
    retrievedAt: new Date('2026-08-09T00:00:00.000Z'),
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    contentDigestSha256: 'b'.repeat(64),
    archiveReference: 'fixture://authority/2026-08-09',
    ...overrides,
  };
}

describe('versioned statutory country packs', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('content hashing accepts Mongoose embedded version documents without following parent cycles', () => {
    const row = new TaxJurisdictionConfig({
      scope: 'organization',
      organizationId: 'org-1',
      countryCode: 'ZZ',
      countryName: 'Test jurisdiction',
      displayName: 'Test jurisdiction',
      versions: [{
        label: 'Draft 1',
        versionNumber: 1,
        effectiveFrom: new Date('2026-01-01'),
        calculationCurrency: 'USD',
      }],
    });

    expect(() => taxJurisdictionService.contentHash(row.versions[0])).not.toThrow();
    expect(taxJurisdictionService.contentHash(row.versions[0])).toMatch(/^[a-f0-9]{64}$/);
  });

  test('compliance hashes ignore persistence ids while retaining material rule metadata', () => {
    const makeRow = () => new TaxJurisdictionConfig({
      scope: 'organization',
      organizationId: 'org-1',
      countryCode: 'KE',
      countryName: 'Kenya',
      displayName: 'Kenya',
      versions: [{
        packKey: 'KE-2026',
        label: '2026 rules',
        versionNumber: 1,
        effectiveFrom: new Date('2026-01-01'),
        sourceDate: new Date('2025-10-06'),
        sourceLinks: [{ label: 'Authority', url: 'https://example.test/authority' }],
        validationStatus: 'validated',
        calculationStatus: 'runnable',
        calculationCurrency: 'KES',
        coverage: { level: 'national', modules: ['paye'] },
      }],
    });
    const first = makeRow().versions[0];
    const second = makeRow().versions[0];

    expect(String(first.sourceLinks[0]._id)).not.toBe(String(second.sourceLinks[0]._id));
    expect(taxJurisdictionService.contentHash(taxJurisdictionService.canonicalVersionContent(first)))
      .toBe(taxJurisdictionService.contentHash(taxJurisdictionService.canonicalVersionContent(second)));
  });

  test('South African tax year changes on March 1, including leap-year February', () => {
    const version = { taxYear: { mode: 'south_africa_mar_1' } };
    expect(taxJurisdictionService.buildTaxYearContext(version, new Date('2027-02-28T12:00:00Z')).label).toBe('2027');
    expect(taxJurisdictionService.buildTaxYearContext(version, new Date('2027-03-01T12:00:00Z')).label).toBe('2028');
    expect(taxJurisdictionService.buildTaxYearContext(version, new Date('2028-02-29T12:00:00Z')).label).toBe('2028');
  });

  test('UK tax-year boundaries use the UTC payroll date', () => {
    const version = { taxYear: { mode: 'uk_apr_6' } };
    expect(taxJurisdictionService.buildTaxYearContext(version, new Date('2027-04-05T23:59:59Z')).label).toBe('2026/27');
    expect(taxJurisdictionService.buildTaxYearContext(version, new Date('2027-04-06T00:00:00Z')).label).toBe('2027/28');
  });

  test('publishing rejects fictitious statutory and fixed-field currencies', async () => {
    const row = new TaxJurisdictionConfig({
      scope: 'organization',
      organizationId: 'org-1',
      countryCode: 'ZZ',
      countryName: 'Test',
      displayName: 'Test',
      versions: [{
        label: 'Draft',
        versionNumber: 1,
        effectiveFrom: new Date('2026-01-01'),
        sourceLinks: [{ label: 'Authority', url: 'https://example.test' }],
        validationStatus: 'validated',
        calculationCurrency: 'ZZZ',
      }],
    });
    jest.spyOn(TaxJurisdictionConfig, 'findOne').mockResolvedValue(row);
    await expect(taxJurisdictionService.publishVersion(row._id, row.versions[0]._id, 'org-1'))
      .rejects.toThrow(/supported ISO 4217/i);

    row.versions[0].calculationCurrency = 'USD';
    row.versions[0].fieldDefinitions = [{
      key: 'fixedAmount', label: 'Fixed amount', type: 'currency', currencyCode: 'ZZZ',
    }];
    await expect(taxJurisdictionService.publishVersion(row._id, row.versions[0]._id, 'org-1'))
      .rejects.toThrow(/unsupported fixed currency/i);
  });

  test('publishing blocks runnable packs whose statutory minor-unit pipeline is not certified', async () => {
    const row = new TaxJurisdictionConfig({
      scope: 'organization',
      organizationId: 'org-1',
      countryCode: 'JP',
      countryName: 'Japan',
      displayName: 'Japan',
      versions: [{
        label: 'Draft',
        versionNumber: 1,
        effectiveFrom: new Date('2026-01-01'),
        sourceLinks: [{ label: 'Authority', url: 'https://example.test' }],
        validationStatus: 'validated',
        calculationStatus: 'runnable',
        calculationCurrency: 'JPY',
      }],
    });
    jest.spyOn(TaxJurisdictionConfig, 'findOne').mockResolvedValue(row);

    await expect(taxJurisdictionService.publishVersion(row._id, row.versions[0]._id, 'org-1'))
      .rejects.toThrow(/two-decimal calculation currency/i);
  });

  test('publishing compiles formulas and requires executable expected-value cases for runnable packs', async () => {
    const row = new TaxJurisdictionConfig({
      scope: 'organization',
      organizationId: 'org-1',
      countryCode: 'ZZ',
      countryName: 'Test',
      displayName: 'Test',
      versions: [{
        label: 'Draft',
        versionNumber: 1,
        effectiveFrom: new Date('2026-01-01'),
        sourceLinks: [{ label: 'Authority', url: 'https://example.test' }],
        validationStatus: 'validated',
        calculationStatus: 'runnable',
        calculationCurrency: 'USD',
        incomeTax: { taxableIncomeFormula: 'grossPay + (' },
        testCases: [],
      }],
    });
    jest.spyOn(TaxJurisdictionConfig, 'findOne').mockResolvedValue(row);

    await expect(taxJurisdictionService.publishVersion(row._id, row.versions[0]._id, 'org-1'))
      .rejects.toMatchObject({ message: expect.stringMatching(/invalid formulas/i) });

    row.versions[0].incomeTax = { method: 'flat', rate: 10 };
    await expect(taxJurisdictionService.publishVersion(row._id, row.versions[0]._id, 'org-1'))
      .rejects.toThrow(/boundary test cases/i);

    row.versions[0].testCases = [{ name: 'No expected values', inputs: { grossPay: 1000, taxableIncome: 1000 } }];
    await expect(taxJurisdictionService.publishVersion(row._id, row.versions[0]._id, 'org-1'))
      .rejects.toMatchObject({ message: expect.stringMatching(/failed its publication test cases/i) });
  });

  test('global seed installation cannot bypass the runnable-pack boundary-case gate', async () => {
    const originalSeeds = taxJurisdictionService.seedDefinitions;
    taxJurisdictionService.seedDefinitions = [{
      countryCode: 'ZZ',
      countryName: 'Test',
      displayName: 'Test',
      version: {
        label: 'Unsafe runnable seed',
        validationStatus: 'validated',
        calculationStatus: 'runnable',
        calculationCurrency: 'USD',
        sourceLinks: [{ label: 'Authority', url: 'https://example.test' }],
        testCases: [],
      },
    }];

    try {
      await expect(taxJurisdictionService.seedGlobalDefaults())
        .rejects.toThrow(/boundary test cases/i);
    } finally {
      taxJurisdictionService.seedDefinitions = originalSeeds;
    }
  });

  test.each([
    [
      'normalized input fingerprints are duplicated',
      (cases) => {
        const ordinary = cases.find((testCase) => testCase.category === 'ordinary_period');
        const high = cases.find((testCase) => testCase.category === 'high_income');
        high.inputs = { ...ordinary.inputs, unusedFixtureNonce: 'does-not-change-calculation' };
      },
      /fixture inputs duplicate/i,
    ],
    [
      'zero income carries prior context',
      (cases) => {
        cases.find((testCase) => testCase.category === 'zero_income').inputs.ytdIncomeTax = 1;
      },
      /zero_income fixture must explicitly set/i,
    ],
    [
      'year-to-date has no prior context',
      (cases) => {
        const ytd = cases.find((testCase) => testCase.category === 'year_to_date').inputs;
        ytd.ytdGrossPay = 0;
        ytd.ytdTaxableIncome = 0;
        ytd.ytdIncomeTax = 0;
      },
      /year_to_date fixture must include a non-zero/i,
    ],
    [
      'high income does not exceed the ordinary period',
      (cases) => {
        const high = cases.find((testCase) => testCase.category === 'high_income');
        high.inputs.grossPay = 900;
        high.inputs.taxableIncome = 900;
      },
      /high_income fixture must have grossPay and taxableIncome above/i,
    ],
    [
      'a threshold group omits one of below, exact, or above',
      (cases) => {
        const above = cases.find((testCase) => (
          testCase.category === 'threshold_boundary' && testCase.boundary.position === 'above'
        ));
        above.boundary.position = 'exact';
      },
      /exactly one below, exact, and above fixture is required/i,
    ],
    [
      'a threshold point is not one rounding unit from its boundary',
      (cases) => {
        const above = cases.find((testCase) => (
          testCase.category === 'threshold_boundary' && testCase.boundary.position === 'above'
        ));
        above.inputs.grossPay = above.boundary.threshold + (above.boundary.roundingUnit * 2);
        above.inputs.taxableIncome = above.inputs.grossPay;
      },
      /boundary input taxableIncome must equal threshold above by/i,
    ],
    [
      'employer cost only asserts its aggregate',
      (cases) => {
        cases.find((testCase) => testCase.category === 'employer_cost')
          .expected.employerLiabilities = {};
      },
      /employer_cost fixture must assert at least one positive component-level/i,
    ],
  ])('runnable certification rejects fixtures when %s', async (_description, mutateCases, expectedFailure) => {
    const testCases = certifiedFlatRateCases();
    mutateCases(testCases);
    const version = {
      label: 'Semantic certification gate',
      effectiveFrom: new Date('2026-01-01'),
      sourceLinks: [certifiedPrimarySource()],
      validationStatus: 'validated',
      calculationStatus: 'runnable',
      calculationCurrency: 'USD',
      incomeTax: {
        strategy: 'flat_rate',
        annualRateFormula: '10',
        annualTaxAfterFormula: 'annualTaxBeforeAdjustments',
      },
      statutoryRules: [{
        strategy: 'fixed_amount',
        name: 'Certification employer liability',
        liabilityCode: 'TEST_EMPLOYER_LIABILITY',
        payer: 'employer',
        whenFormula: 'employerInputs.includeCertificationLiability',
        amountFormula: '75',
        baseFormula: 'grossPay',
      }],
      testCases,
    };

    await expect(taxJurisdictionService.validateVersionForPublish(version, {
      countryCode: 'ZZ',
      countryName: 'Test',
      displayName: 'Test',
    })).rejects.toMatchObject({
      message: expect.stringMatching(/failed its publication test cases/i),
      details: expect.arrayContaining([expect.stringMatching(expectedFailure)]),
    });
  });

  test('runnable publication binds primary sources to retrieved content digests and legal check dates', async () => {
    const version = {
      label: 'Source snapshot gate',
      effectiveFrom: new Date('2026-01-01'),
      sourceLinks: [certifiedPrimarySource({
        checkedAt: null,
        retrievedAt: null,
        effectiveFrom: null,
        contentDigestSha256: '',
        archiveReference: '',
      })],
      validationStatus: 'validated',
      calculationStatus: 'runnable',
      calculationCurrency: 'USD',
      incomeTax: {
        strategy: 'flat_rate',
        annualRateFormula: '10',
        annualTaxAfterFormula: 'annualTaxBeforeAdjustments',
      },
      statutoryRules: [{
        strategy: 'fixed_amount',
        name: 'Certification employer liability',
        liabilityCode: 'TEST_EMPLOYER_LIABILITY',
        payer: 'employer',
        whenFormula: 'employerInputs.includeCertificationLiability',
        amountFormula: '75',
        baseFormula: 'grossPay',
      }],
      testCases: certifiedFlatRateCases(),
    };

    await expect(taxJurisdictionService.validateVersionForPublish(version, {
      countryCode: 'ZZ', countryName: 'Test', displayName: 'Test',
    })).rejects.toMatchObject({
      message: expect.stringMatching(/failed its publication test cases/i),
      details: expect.arrayContaining([
        expect.stringMatching(/SHA-256 digest/i),
        expect.stringMatching(/content was retrieved/i),
        expect.stringMatching(/legal currency check date/i),
        expect.stringMatching(/recorded effective-from date/i),
        expect.stringMatching(/immutable archive or evidence reference/i),
      ]),
    });
  });

  test('an owner can authorize a verified organization member for multiple review roles', async () => {
    const row = new TaxJurisdictionConfig({
      scope: 'organization',
      organizationId: 'org-1',
      countryCode: 'ZZ',
      countryName: 'Test',
      displayName: 'Test',
      versions: [],
    });
    row.save = jest.fn().mockResolvedValue(row);
    jest.spyOn(TaxJurisdictionConfig, 'findOne').mockResolvedValue(row);

    const result = await taxJurisdictionService.authorizeReviewer(
      row._id,
      'org-1',
      {
        userId: 'member-1',
        name: 'Untrusted client name',
        roles: ['payroll_calculation', 'independent_qa'],
        credentialType: 'internal_appointment',
        credentialReference: 'APPOINTMENT-2026-17',
        expiresAt: '2099-12-31',
      },
      { userId: 'owner-1', name: 'Organization owner', role: 'owner' },
      { userId: 'member-1', name: 'Canonical Member', email: 'member@example.test' }
    );

    expect(result.authorization).toMatchObject({
      userId: 'member-1',
      name: 'Canonical Member',
      roles: ['payroll_calculation', 'independent_qa'],
      credentialType: 'internal_appointment',
      credentialReference: 'APPOINTMENT-2026-17',
      status: 'active',
      verifiedBy: { userId: 'owner-1', name: 'Organization owner' },
    });
    expect(result.authorization.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(row.save).toHaveBeenCalledTimes(1);
    await expect(taxJurisdictionService.authorizeReviewer(
      row._id,
      'org-1',
      {
        userId: 'member-1', roles: ['independent_qa'],
        credentialType: 'internal_appointment', credentialReference: 'REPLACEMENT-1',
        expiresAt: '2099-12-31',
      },
      { userId: 'owner-1', name: 'Organization owner', role: 'owner' },
      { userId: 'member-1', name: 'Canonical Member' }
    )).rejects.toMatchObject({ code: 'TAX_REVIEWER_AUTHORIZATION_OVERLAP' });
  });

  test('reviewer authorization rejects non-admin, self-verified, non-member, unlawful, and expired grants', async () => {
    const row = new TaxJurisdictionConfig({
      scope: 'organization', organizationId: 'org-1', countryCode: 'ZZ',
      countryName: 'Test', displayName: 'Test', versions: [],
    });
    row.save = jest.fn().mockResolvedValue(row);
    jest.spyOn(TaxJurisdictionConfig, 'findOne').mockResolvedValue(row);
    const basePayload = {
      userId: 'member-1', roles: ['tax_law'], credentialType: 'professional_license',
      credentialReference: 'LAW-LICENCE-1', expiresAt: '2099-12-31',
    };
    const member = { userId: 'member-1', name: 'Member One' };

    await expect(taxJurisdictionService.authorizeReviewer(
      row._id, 'org-1', basePayload,
      { userId: 'hr-1', name: 'HR manager', role: 'hr_manager' }, member
    )).rejects.toMatchObject({ code: 'TAX_REVIEWER_REGISTRY_ADMIN_REQUIRED' });
    await expect(taxJurisdictionService.authorizeReviewer(
      row._id, 'org-1', basePayload,
      { userId: 'member-1', name: 'Member One', role: 'owner' }, member
    )).rejects.toMatchObject({ code: 'TAX_REVIEWER_SELF_VERIFICATION_FORBIDDEN' });
    await expect(taxJurisdictionService.authorizeReviewer(
      row._id, 'org-1', basePayload,
      { userId: 'owner-1', name: 'Owner', role: 'owner' },
      { userId: 'different-member', name: 'Different Member' }
    )).rejects.toMatchObject({ code: 'TAX_REVIEWER_ORGANIZATION_MEMBERSHIP_REQUIRED' });
    await expect(taxJurisdictionService.authorizeReviewer(
      row._id, 'org-1', { ...basePayload, credentialType: 'internal_appointment' },
      { userId: 'owner-1', name: 'Owner', role: 'owner' }, member
    )).rejects.toMatchObject({ code: 'TAX_LAW_EXTERNAL_CREDENTIAL_REQUIRED' });
    await expect(taxJurisdictionService.authorizeReviewer(
      row._id, 'org-1', { ...basePayload, expiresAt: '2020-01-01' },
      { userId: 'owner-1', name: 'Owner', role: 'owner' }, member
    )).rejects.toMatchObject({ code: 'TAX_REVIEWER_FUTURE_EXPIRY_REQUIRED' });
    expect(row.reviewTeam).toHaveLength(0);
    expect(row.save).not.toHaveBeenCalled();
  });

  test('reviews inherit an exact registry credential and revocation immediately invalidates them', async () => {
    const row = new TaxJurisdictionConfig({
      scope: 'organization',
      organizationId: 'org-1',
      countryCode: 'ZZ',
      countryName: 'Test',
      displayName: 'Test',
      reviewTeam: [{
        userId: 'law-1', name: 'Registered Counsel', roles: ['tax_law'],
        credentialType: 'professional_membership', credentialReference: 'BAR-2026-88',
        verifiedBy: { userId: 'owner-1', name: 'Owner' },
        expiresAt: new Date('2099-01-01'), status: 'active',
      }],
      versions: [{
        label: 'Draft', versionNumber: 1, status: 'draft', effectiveFrom: new Date('2026-01-01'),
        sourceLinks: [{ label: 'Authority', url: 'https://authority.example.test', isPrimary: true }],
        authoredBy: { userId: 'author-1', name: 'Author' },
      }],
    });
    row.save = jest.fn().mockResolvedValue(row);
    jest.spyOn(TaxJurisdictionConfig, 'findOne').mockResolvedValue(row);
    const version = row.versions[0];

    const submitted = await taxJurisdictionService.submitCertificationReview(
      row._id,
      version._id,
      'org-1',
      {
        role: 'tax_law',
        decision: 'approved',
        credentialReference: 'CLIENT-CANNOT-OVERRIDE',
        sourceReferences: ['Authority'],
      },
      { userId: 'law-1', name: 'Session Name' }
    );
    const review = version.certificationReviews[0];
    expect(review.reviewer).toMatchObject({
      userId: 'law-1',
      name: 'Registered Counsel',
      credentialType: 'professional_membership',
      credentialReference: 'BAR-2026-88',
    });
    expect(String(review.reviewer.authorizationId)).toBe(String(row.reviewTeam[0]._id));
    expect(submitted.certification.approvedRoles).toContain('tax_law');

    await taxJurisdictionService.revokeReviewer(
      row._id,
      row.reviewTeam[0]._id,
      'org-1',
      { reason: 'Engagement ended' },
      { userId: 'admin-2', name: 'Registry admin', role: 'admin' }
    );
    const status = taxJurisdictionService.getCertificationStatus(version, { reviewTeam: row.reviewTeam });
    expect(row.reviewTeam[0]).toMatchObject({
      status: 'revoked',
      revocationReason: 'Engagement ended',
      revokedBy: { userId: 'admin-2', name: 'Registry admin' },
    });
    expect(status.approvedRoles).not.toContain('tax_law');
    expect(status.problems.join(' ')).toMatch(/revoked/i);
  });

  test('review submission rejects an expired or wrong-role authorization', async () => {
    const row = new TaxJurisdictionConfig({
      scope: 'organization', organizationId: 'org-1', countryCode: 'ZZ',
      countryName: 'Test', displayName: 'Test',
      reviewTeam: [{
        userId: 'reviewer-1', name: 'Reviewer', roles: ['payroll_calculation'],
        credentialType: 'internal_appointment', credentialReference: 'PAYROLL-1',
        verifiedBy: { userId: 'owner-1', name: 'Owner' },
        expiresAt: new Date('2020-01-01'), status: 'active',
      }],
      versions: [{ label: 'Draft', versionNumber: 1, status: 'draft', effectiveFrom: new Date('2026-01-01') }],
    });
    jest.spyOn(TaxJurisdictionConfig, 'findOne').mockResolvedValue(row);

    await expect(taxJurisdictionService.submitCertificationReview(
      row._id, row.versions[0]._id, 'org-1',
      { role: 'payroll_calculation', decision: 'changes_requested' },
      { userId: 'reviewer-1', name: 'Reviewer' }
    )).rejects.toMatchObject({ code: 'TAX_REVIEWER_AUTHORIZATION_REQUIRED' });
    row.reviewTeam[0].expiresAt = new Date('2099-01-01');
    await expect(taxJurisdictionService.submitCertificationReview(
      row._id, row.versions[0]._id, 'org-1',
      { role: 'independent_qa', decision: 'changes_requested' },
      { userId: 'reviewer-1', name: 'Reviewer' }
    )).rejects.toMatchObject({ code: 'TAX_REVIEWER_AUTHORIZATION_REQUIRED' });
  });

  test('an authorized non-admin reviewer can fetch only their review context', async () => {
    const row = new TaxJurisdictionConfig({
      scope: 'organization', organizationId: 'org-1', countryCode: 'ZZ',
      countryName: 'Test', displayName: 'Test jurisdiction', description: 'Review this pack',
      reviewTeam: [{
        userId: 'reviewer-1', name: 'Payroll Reviewer', roles: ['payroll_calculation'],
        credentialType: 'internal_appointment', credentialReference: 'PAYROLL-2026',
        verifiedBy: { userId: 'owner-1', name: 'Owner' },
        expiresAt: new Date('2099-01-01'), status: 'active',
      }, {
        userId: 'other-1', name: 'Other Reviewer', roles: ['tax_law'],
        credentialType: 'professional_license', credentialReference: 'PRIVATE-LICENCE',
        verifiedBy: { userId: 'owner-1', name: 'Owner' },
        expiresAt: new Date('2099-01-01'), status: 'active',
      }],
      versions: [{
        label: 'Review draft', versionNumber: 1, status: 'draft',
        effectiveFrom: new Date('2026-01-01'), calculationCurrency: 'USD',
        coverage: { level: 'national', modules: ['income_tax'], exclusions: ['benefits'] },
        certificationReviews: [{
          role: 'tax_law', decision: 'approved', contentHash: 'stale-hash',
          reviewer: {
            userId: 'other-1', name: 'Other Reviewer',
            credentialType: 'professional_license', credentialReference: 'PRIVATE-LICENCE',
          },
        }],
      }],
    });
    jest.spyOn(TaxJurisdictionConfig, 'findOne').mockResolvedValue(row);

    const context = await taxJurisdictionService.getCertificationReviewContext(
      row._id,
      row.versions[0]._id,
      'org-1',
      { userId: 'reviewer-1', name: 'Payroll Reviewer', role: 'member' }
    );
    expect(context.jurisdiction).toMatchObject({ countryCode: 'ZZ', displayName: 'Test jurisdiction' });
    expect(context.version).toMatchObject({ label: 'Review draft', calculationCurrency: 'USD' });
    expect(context.authorizations).toHaveLength(1);
    expect(context.authorizations[0]).toMatchObject({
      userId: 'reviewer-1', roles: ['payroll_calculation'], credentialReference: 'PAYROLL-2026',
    });
    expect(JSON.stringify(context)).not.toContain('PRIVATE-LICENCE');
    expect(context.version.certificationReviews[0].reviewer).toEqual({
      userId: 'other-1', name: 'Other Reviewer',
    });
  });

  test('review context rejects unregistered and expired reviewers', async () => {
    const row = new TaxJurisdictionConfig({
      scope: 'organization', organizationId: 'org-1', countryCode: 'ZZ',
      countryName: 'Test', displayName: 'Test',
      reviewTeam: [{
        userId: 'expired-1', name: 'Expired', roles: ['independent_qa'],
        credentialType: 'internal_appointment', credentialReference: 'QA-OLD',
        verifiedBy: { userId: 'owner-1', name: 'Owner' },
        expiresAt: new Date('2020-01-01'), status: 'active',
      }],
      versions: [{ label: 'Draft', versionNumber: 1, status: 'draft', effectiveFrom: new Date('2026-01-01') }],
    });
    jest.spyOn(TaxJurisdictionConfig, 'findOne').mockResolvedValue(row);

    await expect(taxJurisdictionService.getCertificationReviewContext(
      row._id, row.versions[0]._id, 'org-1', { userId: 'expired-1', name: 'Expired' }
    )).rejects.toMatchObject({ code: 'TAX_REVIEWER_AUTHORIZATION_REQUIRED' });
    await expect(taxJurisdictionService.getCertificationReviewContext(
      row._id, row.versions[0]._id, 'org-1', { userId: 'unknown-1', name: 'Unknown' }
    )).rejects.toMatchObject({ code: 'TAX_REVIEWER_AUTHORIZATION_REQUIRED' });
  });

  test('runnable publication requires source-bound fixtures and three independent current-content approvals', async () => {
    const row = new TaxJurisdictionConfig({
      scope: 'organization',
      organizationId: 'org-1',
      countryCode: 'ZZ',
      countryName: 'Test',
      displayName: 'Test',
      reviewTeam: [{
        userId: 'law-1', name: 'Tax counsel', roles: ['tax_law'],
        credentialType: 'engagement', credentialReference: 'ENGAGEMENT-2026-1',
        verifiedBy: { userId: 'registry-admin', name: 'Registry admin' },
        expiresAt: new Date('2099-01-01'), status: 'active',
      }, {
        userId: 'payroll-1', name: 'Payroll reviewer', roles: ['payroll_calculation'],
        credentialType: 'internal_appointment', credentialReference: 'PAYROLL-APPOINTMENT-1',
        verifiedBy: { userId: 'registry-admin', name: 'Registry admin' },
        expiresAt: new Date('2099-01-01'), status: 'active',
      }, {
        userId: 'qa-1', name: 'Independent QA', roles: ['independent_qa'],
        credentialType: 'internal_appointment', credentialReference: 'QA-APPOINTMENT-1',
        verifiedBy: { userId: 'registry-admin', name: 'Registry admin' },
        expiresAt: new Date('2099-01-01'), status: 'active',
      }],
      versions: [{
        label: 'Certified draft',
        versionNumber: 1,
        status: 'draft',
        effectiveFrom: new Date('2026-01-01'),
        sourceLinks: [certifiedPrimarySource()],
        validationStatus: 'validated',
        calculationStatus: 'runnable',
        calculationCurrency: 'USD',
        coverage: {
          level: 'national',
          modules: ['income_tax', 'employer_liability'],
          exclusions: ['none'],
        },
        authoredBy: { userId: 'author-1', name: 'Rule author' },
        incomeTax: {
          strategy: 'flat_rate',
          annualRateFormula: '10',
          annualTaxAfterFormula: 'annualTaxBeforeAdjustments',
        },
        statutoryRules: [{
          strategy: 'fixed_amount',
          name: 'Certification employer liability',
          liabilityCode: 'TEST_EMPLOYER_LIABILITY',
          payer: 'employer',
          whenFormula: 'employerInputs.includeCertificationLiability',
          amountFormula: '75',
          baseFormula: 'grossPay',
        }],
        testCases: certifiedFlatRateCases(),
      }],
    });
    const version = row.versions[0];
    const approvedHash = taxJurisdictionService.contentHash(
      taxJurisdictionService.canonicalVersionContent(version)
    );
    const authorizationByRole = Object.fromEntries(row.reviewTeam.flatMap((authorization) => (
      authorization.roles.map((role) => [role, authorization])
    )));
    version.certificationReviews = [{
      role: 'tax_law',
      decision: 'approved',
      contentHash: approvedHash,
      reviewer: {
        userId: 'law-1', name: 'Tax counsel', credentialType: 'engagement',
        credentialReference: 'ENGAGEMENT-2026-1', authorizationId: authorizationByRole.tax_law._id,
      },
      sourceReferences: ['Authority'],
    }, {
      role: 'payroll_calculation',
      decision: 'approved',
      contentHash: approvedHash,
      reviewer: {
        userId: 'payroll-1', name: 'Payroll reviewer', credentialType: 'internal_appointment',
        credentialReference: 'PAYROLL-APPOINTMENT-1', authorizationId: authorizationByRole.payroll_calculation._id,
      },
    }, {
      role: 'independent_qa',
      decision: 'approved',
      contentHash: approvedHash,
      reviewer: {
        userId: 'qa-1', name: 'Independent QA', credentialType: 'internal_appointment',
        credentialReference: 'QA-APPOINTMENT-1', authorizationId: authorizationByRole.independent_qa._id,
      },
      fixtureRunReference: 'jest:tax-pack-certification:2026-08-09',
    }];
    row.save = jest.fn().mockResolvedValue(row);
    jest.spyOn(TaxJurisdictionConfig, 'findOne').mockResolvedValue(row);

    authorizationByRole.tax_law.status = 'revoked';
    await expect(taxJurisdictionService.publishVersion(
      row._id,
      version._id,
      'org-1',
      { userId: 'publisher-1', name: 'Independent publisher' }
    )).rejects.toMatchObject({ code: 'TAX_PACK_CERTIFICATION_INCOMPLETE' });
    authorizationByRole.tax_law.status = 'active';
    expect(taxJurisdictionService.getCertificationStatus(version, { reviewTeam: row.reviewTeam }))
      .toMatchObject({ ready: true, problems: [] });

    await expect(taxJurisdictionService.publishVersion(
      row._id,
      version._id,
      'org-1',
      { userId: 'publisher-1', name: 'Independent publisher' }
    )).resolves.toBe(row);
    expect(version.status).toBe('published');
    expect(version.contentHash).toBe(approvedHash);
    expect(row.save).toHaveBeenCalledTimes(1);
  });

  test('any rule edit makes prior certification reviews stale', () => {
    const reviewTeam = [{
      _id: 'authorization-law', userId: 'law-1', name: 'Law', roles: ['tax_law'],
      credentialType: 'professional_license', credentialReference: 'LAW-1',
      verifiedBy: { userId: 'registry-admin', name: 'Registry admin' },
      expiresAt: new Date('2099-01-01'), status: 'active',
    }, {
      _id: 'authorization-payroll', userId: 'payroll-1', name: 'Payroll', roles: ['payroll_calculation'],
      credentialType: 'internal_appointment', credentialReference: 'PAYROLL-1',
      verifiedBy: { userId: 'registry-admin', name: 'Registry admin' },
      expiresAt: new Date('2099-01-01'), status: 'active',
    }, {
      _id: 'authorization-qa', userId: 'qa-1', name: 'QA', roles: ['independent_qa'],
      credentialType: 'internal_appointment', credentialReference: 'QA-1',
      verifiedBy: { userId: 'registry-admin', name: 'Registry admin' },
      expiresAt: new Date('2099-01-01'), status: 'active',
    }];
    const version = {
      label: 'Draft',
      effectiveFrom: new Date('2026-01-01'),
      validationStatus: 'validated',
      calculationStatus: 'runnable',
      calculationCurrency: 'USD',
      authoredBy: { userId: 'author-1', name: 'Author' },
      constants: { allowance: 100 },
      sourceLinks: [{ label: 'Authority', url: 'https://authority.example.test', isPrimary: true }],
      testCases: certifiedFlatRateCases(),
    };
    const approvedHash = taxJurisdictionService.contentHash(
      taxJurisdictionService.canonicalVersionContent(version)
    );
    version.certificationReviews = [{
      role: 'tax_law', decision: 'approved', contentHash: approvedHash,
      reviewer: {
        userId: 'law-1', name: 'Law', credentialType: 'professional_license',
        credentialReference: 'LAW-1', authorizationId: 'authorization-law',
      },
      sourceReferences: ['Authority'],
    }, {
      role: 'payroll_calculation', decision: 'approved', contentHash: approvedHash,
      reviewer: {
        userId: 'payroll-1', name: 'Payroll', credentialType: 'internal_appointment',
        credentialReference: 'PAYROLL-1', authorizationId: 'authorization-payroll',
      },
    }, {
      role: 'independent_qa', decision: 'approved', contentHash: approvedHash,
      reviewer: {
        userId: 'qa-1', name: 'QA', credentialType: 'internal_appointment',
        credentialReference: 'QA-1', authorizationId: 'authorization-qa',
      }, fixtureRunReference: 'RUN-1',
    }];

    expect(taxJurisdictionService.getCertificationStatus(version, { reviewTeam }).ready).toBe(true);
    version.constants.allowance = 101;
    const status = taxJurisdictionService.getCertificationStatus(version, { reviewTeam });
    expect(status.ready).toBe(false);
    expect(status.approvedRoles).toEqual([]);
    expect(status.staleReviewCount).toBe(3);
  });

  test('Nigeria 2026 uses NTA bands and separates employee and employer pension', async () => {
    const result = await calculate('NG', {
      grossPay: 300000,
      statutoryBases: { pensionablePay: 300000 },
      employeeTaxInputs: { annualRentPaid: 0, additionalWithholding: 0 },
    });

    expect(result.payrollRunnable).toBe(false);
    expect(result.compliance.calculationStatus).toBe('preview_only');
    expect(result.incomeTax.taxAmount).toBe(32180);
    expect(result.statutoryContributions.totalEmployeeAmount).toBe(24000);
    expect(result.statutoryContributions.totalEmployerAmount).toBe(30000);
    expect(result.statutoryContributions.employeeComponents).toHaveLength(1);
    expect(result.statutoryContributions.employerComponents).toHaveLength(1);
  });

  test('Kenya applies AHL, SHIF, and NSSF Year 4 to the correct payer ledgers', async () => {
    const result = await calculate('KE', {
      grossPay: 100000,
      employeeTaxInputs: {
        residencyStatus: 'resident',
        monthlyMortgageInterest: 0,
        monthlyRegisteredPension: 0,
        monthlyPostRetirementMedicalFund: 0,
        annualQualifyingInsurancePremium: 0,
        additionalWithholding: 0,
      },
    });

    expect(result.payrollRunnable).toBe(false);
    expect(result.compliance.calculationStatus).toBe('preview_only');
    expect(result.statutoryContributions.totalEmployeeAmount).toBe(10250);
    expect(result.statutoryContributions.totalEmployerAmount).toBe(7500);
    expect(result.incomeTax.taxAmount).toBe(19308.33);
  });

  test('tax inputs cannot make withholding negative or inject an unsupported select value', async () => {
    const negative = await calculate('KE', {
      grossPay: 100000,
      employeeTaxInputs: { residencyStatus: 'resident', additionalWithholding: -999999 },
    });
    const invalidSelect = await calculate('KE', {
      grossPay: 100000,
      employeeTaxInputs: { residencyStatus: 'alien', additionalWithholding: 0 },
    });

    expect(negative.employeeTaxInputs.additionalWithholding).toBe(0);
    expect(negative.incomeTax.taxAmount).toBeGreaterThanOrEqual(0);
    expect(invalidSelect.payrollRunnable).toBe(false);
    expect(invalidSelect.validationErrors.join(' ')).toMatch(/unsupported value/i);
  });

  test('mandatory statutory deductions cannot be disabled by a bare opt-out flag', async () => {
    const result = await calculate('KE', {
      grossPay: 100000,
      employeeTaxInputs: { residencyStatus: 'resident', additionalWithholding: 0 },
      statutoryContributions: { socialSecurityOptIn: false },
    });

    expect(result.payrollRunnable).toBe(false);
    expect(result.statutoryContributions.components.some((item) => item.liabilityCode === 'KE_NSSF_TIER1_EMPLOYEE')).toBe(true);
    expect(result.blockingErrors.join(' ')).toMatch(/cannot be disabled/i);
  });

  test('Ghana SSNIT employee and employer liabilities are separated and capped by period', async () => {
    const result = await calculate('GH', {
      grossPay: 10000,
      basicSalary: 10000,
      employeeTaxInputs: { residencyStatus: 'resident', additionalWithholding: 0 },
    });

    expect(result.payrollRunnable).toBe(false);
    expect(result.compliance.calculationStatus).toBe('preview_only');
    expect(result.statutoryContributions.totalEmployeeAmount).toBe(550);
    expect(result.statutoryContributions.totalEmployerAmount).toBe(1300);
  });

  test('preview-only country packs return calculations but cannot finalize payroll', async () => {
    const uk = await calculate('GB', {
      grossPay: 5000,
      employeeTaxInputs: { taxSubdivision: 'standard', niCategory: 'A', additionalWithholding: 0 },
    });
    const mozambique = await calculate('MZ', {
      grossPay: 33000,
      employeeTaxInputs: { dependants: 0, additionalWithholding: 0 },
    });

    expect(uk.payrollRunnable).toBe(false);
    expect(uk.statutoryContributions.totalEmployerAmount).toBeGreaterThan(0);
    expect(mozambique.payrollRunnable).toBe(false);
    expect(mozambique.incomeTax.taxAmount).toBe(1825);
  });

  test('Cameroon preview posts fixed levies and percentage contributions to the correct ledgers', async () => {
    const result = await calculate('CM', {
      grossPay: 100000,
      employeeTaxInputs: {
        employerSector: 'general',
        occupationalRiskClass: 'A',
        additionalWithholding: 0,
      },
    });

    expect(result.payrollRunnable).toBe(false);
    expect(result.statutoryContributions.totalEmployeeAmount).toBe(6450);
    expect(result.statutoryContributions.totalEmployerAmount).toBe(15450);
    expect(result.statutoryContributions.components.find((item) => item.liabilityCode === 'CM_CRTV_EMPLOYEE')?.amount).toBe(750);
    expect(result.statutoryContributions.components.find((item) => item.liabilityCode === 'CM_TDL_EMPLOYEE')?.amount).toBe(500);
  });

  test('EU is a blocked grouping rather than a fabricated tax jurisdiction', async () => {
    const result = await calculate('EU', { grossPay: 5000, employeeTaxInputs: { workCountryCode: 'DE' } });
    expect(result.payrollRunnable).toBe(false);
    expect(result.compliance.coverage.level).toBe('template');
    expect(result.incomeTax.taxAmount).toBe(0);
  });
});

describe('pay component treatment', () => {
  test('statutorily taxable classifications cannot be weakened by free-form overrides', () => {
    const resolved = payComponentTaxService.resolveComponent({
      name: 'Employer housing',
      fairValue: 12000,
      classificationCode: 'housing_benefit',
      taxTreatment: 'non_taxable',
      taxAuthorityReason: 'Local administrator assertion',
      taxEvidenceReference: 'UPLOAD-1',
      taxTreatmentOverrides: [{
        periodKey: '2026-08',
        taxTreatment: 'non_taxable',
        authorityReason: 'Monthly administrator assertion',
        evidenceReference: 'UPLOAD-2',
      }],
    }, new Date('2026-08-31T00:00:00.000Z'), 'KE');

    expect(resolved.treatment).toBe('taxable');
    expect(resolved.taxablePercentage).toBe(100);
    expect(resolved.taxableAmount).toBe(12000);
    expect(resolved.source).toBe('jurisdiction_classification');
  });

  test('period overrides require and preserve an audit reason and evidence', () => {
    const resolved = payComponentTaxService.resolveComponent({
      name: 'Monthly meal benefit',
      fairValue: 7000,
      classificationCode: 'employer_meal',
      cashPayable: false,
      taxTreatmentOverrides: [{
        periodKey: '2026-08',
        taxTreatment: 'partially_taxable',
        taxablePercentage: 50,
        authorityReason: 'Documented statutory valuation for August',
        evidenceReference: 'KRA-CASE-2026-08',
      }],
    }, new Date('2026-08-31'), 'KE');

    expect(resolved.taxableAmount).toBe(3500);
    expect(resolved.cashPayable).toBe(false);
    expect(resolved.requiresReview).toBe(false);
    expect(resolved.source).toBe('period_override');
  });

  test('unknown benefits fail the compliance review instead of silently becoming exempt', () => {
    const resolved = payComponentTaxService.resolveComponent({
      name: 'Unclassified perk',
      fairValue: 1000,
      classificationCode: 'unknown_perk',
    }, new Date('2026-08-31'), 'GB');
    expect(resolved.requiresReview).toBe(true);
    expect(resolved.taxableAmount).toBe(1000);
  });

  test('legacy non-taxable flags require reclassification before payroll', () => {
    const resolved = payComponentTaxService.resolveComponent({
      name: 'Legacy untaxed allowance',
      amount: 500,
      isTaxable: false,
    }, new Date('2026-08-31'), 'KE');
    expect(resolved.requiresReview).toBe(true);
    expect(resolved.taxableAmount).toBe(0);
    expect(resolved.reviewMessage).toMatch(/reclassified/i);
  });
});
