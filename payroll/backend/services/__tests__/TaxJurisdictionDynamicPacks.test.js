'use strict';

const mongoose = require('mongoose');
const taxJurisdictionService = require('../TaxJurisdictionService');
const TaxJurisdictionConfig = require('../../models/TaxJurisdictionConfig');

const editor = Object.freeze({
  userId: 'owner-1',
  name: 'Organization owner',
  role: 'owner',
});

function nationalDraft(overrides = {}) {
  return {
    countryCode: 'FR',
    countryName: 'France',
    jurisdictionLevel: 'national',
    displayName: 'France payroll tax',
    provenanceReference: 'PAYROLL-TAX-142',
    version: {
      label: 'Research draft',
      effectiveFrom: '2027-01-01',
      calculationCurrency: 'EUR',
      coverage: {
        level: 'national',
        modules: ['income_tax', 'social_security'],
        exclusions: ['benefits_in_kind_not_yet_researched'],
      },
      ...overrides.version,
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'version')),
  };
}

function automatedGateFixtures() {
  const makeCase = ({ name, category, grossPay, boundary, employerCost = false, ytd = false }) => ({
    name,
    category,
    sourceReferences: ['Official authority'],
    ...(boundary ? { boundary } : {}),
    inputs: {
      grossPay,
      taxableIncome: grossPay,
      ytdGrossPay: ytd ? 12000 : 0,
      ytdTaxableIncome: ytd ? 12000 : 0,
      ytdIncomeTax: ytd ? 1200 : 0,
      ...(employerCost ? { employerInputs: { includeCertificationLiability: true } } : {}),
    },
    expected: {
      taxAmount: Math.round(grossPay * 0.1 * 100) / 100,
      employeeStatutory: 0,
      employerStatutory: employerCost ? 75 : 0,
      employeeLiabilities: {},
      employerLiabilities: employerCost ? { TEST_EMPLOYER_LIABILITY: 75 } : {},
      incomeTaxMethod: 'flat_rate',
      calculationCurrency: 'USD',
      payrollRunnable: true,
    },
  });
  const boundary = {
    group: 'taxable-income-1500',
    inputPath: 'taxableIncome',
    threshold: 1500,
    roundingUnit: 0.01,
  };
  return [
    makeCase({ name: 'Zero', category: 'zero_income', grossPay: 0 }),
    makeCase({ name: 'Ordinary', category: 'ordinary_period', grossPay: 1000 }),
    makeCase({ name: 'Below', category: 'threshold_boundary', grossPay: 1499.99, boundary: { ...boundary, position: 'below' } }),
    makeCase({ name: 'Exact', category: 'threshold_boundary', grossPay: 1500, boundary: { ...boundary, position: 'exact' } }),
    makeCase({ name: 'Above', category: 'threshold_boundary', grossPay: 1500.01, boundary: { ...boundary, position: 'above' } }),
    makeCase({ name: 'High', category: 'high_income', grossPay: 10000 }),
    makeCase({ name: 'YTD', category: 'year_to_date', grossPay: 1250, ytd: true }),
    makeCase({ name: 'Employer cost', category: 'employer_cost', grossPay: 2000, employerCost: true }),
  ];
}

function technicallyCompleteRow() {
  return new TaxJurisdictionConfig({
    scope: 'organization',
    organizationId: 'org-a',
    countryCode: 'FR',
    countryName: 'France',
    jurisdictionLevel: 'national',
    displayName: 'France research pack',
    versions: [{
      label: 'Research draft',
      versionNumber: 1,
      status: 'draft',
      effectiveFrom: new Date('2027-01-01'),
      validationStatus: 'draft',
      calculationStatus: 'blocked',
      calculationCurrency: 'USD',
      coverage: {
        level: 'national',
        modules: ['income_tax', 'employer_liability'],
        exclusions: ['benefits_in_kind'],
      },
      sourceLinks: [{
        label: 'Official authority',
        url: 'https://authority.example.test/payroll',
        authorityType: 'tax_authority',
        isPrimary: true,
        checkedAt: new Date('2026-08-09'),
        retrievedAt: new Date('2026-08-09'),
        effectiveFrom: new Date('2027-01-01'),
        contentDigestSha256: 'c'.repeat(64),
        archiveReference: 'evidence://official-authority/2027',
      }],
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
      testCases: automatedGateFixtures(),
    }],
  });
}

describe('governed dynamic jurisdiction-pack creation', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('creates an arbitrary ISO national pack in a fail-closed draft regardless of caller readiness flags', async () => {
    const create = jest.spyOn(TaxJurisdictionConfig, 'create').mockImplementation(async (value) => value);

    const created = await taxJurisdictionService.createJurisdiction('org-a', nationalDraft({
      version: {
        validationStatus: 'validated',
        calculationStatus: 'runnable',
        certificationReviews: [{ role: 'tax_law', decision: 'approved' }],
      },
    }), editor);

    expect(created).toMatchObject({
      scope: 'organization',
      organizationId: 'org-a',
      countryCode: 'FR',
      jurisdictionLevel: 'national',
      status: 'draft',
      publishedVersionId: null,
      creationProvenance: {
        kind: 'manual',
        reference: 'PAYROLL-TAX-142',
        recordedBy: { userId: 'owner-1' },
      },
    });
    expect(created.versions).toHaveLength(1);
    expect(created.versions[0]).toMatchObject({
      status: 'draft',
      validationStatus: 'draft',
      calculationStatus: 'blocked',
      calculationCurrency: 'EUR',
      certificationReviews: [],
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  test('requires an organization tenant and an authorized editor before writing', async () => {
    const create = jest.spyOn(TaxJurisdictionConfig, 'create').mockImplementation(async (value) => value);

    await expect(taxJurisdictionService.createJurisdiction('', nationalDraft(), editor))
      .rejects.toMatchObject({ code: 'TAX_PACK_ORGANIZATION_REQUIRED', statusCode: 400 });
    await expect(taxJurisdictionService.createJurisdiction(
      'org-a',
      nationalDraft(),
      { userId: 'employee-1', role: 'employee' }
    )).rejects.toMatchObject({ code: 'TAX_PACK_EDITOR_REQUIRED', statusCode: 403 });
    expect(create).not.toHaveBeenCalled();
  });

  test('requires ISO subdivision and stable locality identities at the relevant levels', async () => {
    const create = jest.spyOn(TaxJurisdictionConfig, 'create').mockImplementation(async (value) => value);

    await expect(taxJurisdictionService.createJurisdiction('org-a', nationalDraft({
      countryCode: 'US',
      countryName: 'United States',
      jurisdictionLevel: 'subdivision',
      version: {
        calculationCurrency: 'USD',
        coverage: {
          level: 'subdivision',
          modules: ['income_tax'],
          exclusions: ['local_tax'],
        },
      },
    }), editor)).rejects.toMatchObject({ code: 'TAX_PACK_ISO_SUBDIVISION_REQUIRED' });

    const local = await taxJurisdictionService.createJurisdiction('org-a', nationalDraft({
      countryCode: 'US',
      countryName: 'United States',
      jurisdictionLevel: 'local',
      subdivisionCode: 'US-NY',
      subdivisionName: 'New York',
      localityCode: 'NYC',
      localityName: 'New York City',
      displayName: 'New York City payroll tax',
      version: {
        calculationCurrency: 'USD',
        coverage: {
          level: 'local',
          modules: ['local_income_tax'],
          exclusions: ['state_and_federal_companions'],
        },
      },
    }), editor);
    expect(local).toMatchObject({
      countryCode: 'US',
      subdivisionCode: 'US-NY',
      localityCode: 'NYC',
      jurisdictionLevel: 'local',
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  test('creates a rollout-backlog entry using server-owned identity and persists its provenance', async () => {
    const findOne = jest.spyOn(TaxJurisdictionConfig, 'findOne').mockResolvedValue(null);
    jest.spyOn(TaxJurisdictionConfig, 'create').mockImplementation(async (value) => value);

    const created = await taxJurisdictionService.createJurisdiction('org-canada', {
      backlogReference: {
        groupId: 'CANADA_PROVINCES_AND_TERRITORIES',
        entryCode: 'CA-QC',
      },
      countryCode: 'US',
      countryName: 'Tampered client value',
      displayName: 'Quebec payroll tax research',
      version: {
        effectiveFrom: '2027-01-01',
        calculationCurrency: 'CAD',
        coverage: {
          level: 'subdivision',
          modules: ['income_tax', 'social_security'],
          exclusions: ['federal_companion', 'local_rules'],
        },
      },
    }, editor);

    expect(created).toMatchObject({
      organizationId: 'org-canada',
      countryCode: 'CA',
      countryName: 'Canada',
      subdivisionCode: 'CA-QC',
      subdivisionName: 'Quebec',
      jurisdictionLevel: 'subdivision',
      creationProvenance: {
        kind: 'rollout_backlog',
        backlogGroupId: 'CANADA_PROVINCES_AND_TERRITORIES',
        backlogEntryCode: 'CA-QC',
        sourceUrl: 'https://www.canada.ca/en/intergovernmental-affairs/services/provinces-territories.html',
      },
    });
    expect(created.versions[0]).toMatchObject({
      validationStatus: 'draft',
      calculationStatus: 'blocked',
    });
    expect(findOne).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'organization',
      organizationId: 'org-canada',
      'creationProvenance.backlogEntryCode': 'CA-QC',
    }));
  });

  test('does not duplicate a backlog draft within the same organization', async () => {
    jest.spyOn(TaxJurisdictionConfig, 'findOne').mockResolvedValue({
      _id: new mongoose.Types.ObjectId(),
    });
    const create = jest.spyOn(TaxJurisdictionConfig, 'create').mockImplementation(async (value) => value);

    await expect(taxJurisdictionService.createJurisdiction('org-a', {
      backlogReference: { groupId: 'EU_MEMBER_STATES', entryCode: 'DE' },
      version: {
        effectiveFrom: '2027-01-01',
        calculationCurrency: 'EUR',
        coverage: {
          level: 'national',
          modules: ['income_tax'],
          exclusions: ['social_security'],
        },
      },
    }, editor)).rejects.toMatchObject({
      code: 'TAX_PACK_BACKLOG_DRAFT_EXISTS',
      statusCode: 409,
    });
    expect(create).not.toHaveBeenCalled();
  });

  test('lists backlog-to-draft state using only the selected organization', async () => {
    const draftId = new mongoose.Types.ObjectId();
    const find = jest.spyOn(TaxJurisdictionConfig, 'find').mockResolvedValue([{
      _id: draftId,
      displayName: 'Germany research draft',
      status: 'draft',
      creationProvenance: {
        kind: 'rollout_backlog',
        backlogGroupId: 'EU_MEMBER_STATES',
        backlogEntryCode: 'DE',
      },
    }]);

    const groups = await taxJurisdictionService.listRolloutBacklog('org-eu');
    const germany = groups.find((group) => group.id === 'EU_MEMBER_STATES')
      .entries.find((entry) => entry.code === 'DE');
    const france = groups.find((group) => group.id === 'EU_MEMBER_STATES')
      .entries.find((entry) => entry.code === 'FR');

    expect(germany.existingDraft).toMatchObject({
      jurisdictionId: String(draftId),
      displayName: 'Germany research draft',
    });
    expect(france.existingDraft).toBeNull();
    expect(find).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'organization',
      organizationId: 'org-eu',
      'creationProvenance.kind': 'rollout_backlog',
    }));
  });

  test('clones only a tenant-visible source and strips all publication/certification state', async () => {
    const sourceVersionId = new mongoose.Types.ObjectId();
    const sourceId = new mongoose.Types.ObjectId();
    const source = {
      _id: sourceId,
      countryCode: 'GB',
      countryName: 'United Kingdom',
      displayName: 'United Kingdom PAYE',
      subdivisionCode: '',
      subdivisionName: '',
      localityCode: '',
      localityName: '',
      publishedVersionId: sourceVersionId,
      versions: [{
        _id: sourceVersionId,
        label: 'Published rules',
        versionNumber: 4,
        status: 'published',
        validationStatus: 'validated',
        calculationStatus: 'runnable',
        effectiveFrom: new Date('2027-04-06'),
        calculationCurrency: 'GBP',
        coverage: { level: 'national', modules: ['paye'], exclusions: ['none'] },
        contentHash: 'a'.repeat(64),
        certificationReviews: [{ role: 'tax_law', decision: 'approved' }],
      }],
      getPublishedVersion() { return this.versions[0]; },
    };
    const getById = jest.spyOn(taxJurisdictionService, 'getJurisdictionById').mockResolvedValue(source);
    jest.spyOn(TaxJurisdictionConfig, 'create').mockImplementation(async (value) => value);

    const clone = await taxJurisdictionService.createJurisdiction('org-uk', {
      cloneFromId: String(sourceId),
      displayName: 'United Kingdom organization override',
    }, editor);

    expect(getById).toHaveBeenCalledWith(String(sourceId), 'org-uk');
    expect(clone).toMatchObject({
      organizationId: 'org-uk',
      clonedFromId: sourceId,
      jurisdictionLevel: 'organization_override',
      creationProvenance: {
        kind: 'clone',
        clonedFromVersionId: sourceVersionId,
      },
    });
    expect(clone.versions[0]).toMatchObject({
      status: 'draft',
      validationStatus: 'draft',
      calculationStatus: 'blocked',
      contentHash: '',
      certificationReviews: [],
    });
  });

  test('new versions remain blocked even when copied from a runnable version', async () => {
    const row = new TaxJurisdictionConfig({
      scope: 'organization',
      organizationId: 'org-a',
      countryCode: 'FR',
      countryName: 'France',
      displayName: 'France payroll tax',
      versions: [],
    });
    row.save = jest.fn().mockResolvedValue(row);
    jest.spyOn(TaxJurisdictionConfig, 'findOne').mockResolvedValue(row);

    const version = await taxJurisdictionService.createVersion(row._id, 'org-a', {
      label: 'Copied rules',
      effectiveFrom: '2028-01-01',
      calculationCurrency: 'EUR',
      validationStatus: 'validated',
      calculationStatus: 'runnable',
      certificationReviews: [{ role: 'tax_law', decision: 'approved' }],
      coverage: {
        level: 'national',
        modules: ['income_tax'],
        exclusions: ['none'],
      },
    }, { ...editor, role: 'admin' });

    expect(version).toMatchObject({
      status: 'draft',
      validationStatus: 'draft',
      calculationStatus: 'blocked',
      certificationReviews: [],
    });
    expect(row.save).toHaveBeenCalledTimes(1);
  });

  test('automatically passes objective gates without fabricating a human approval', async () => {
    const row = technicallyCompleteRow();
    row.save = jest.fn().mockResolvedValue(row);
    jest.spyOn(TaxJurisdictionConfig, 'findOne').mockResolvedValue(row);

    const result = await taxJurisdictionService.runAutomatedTechnicalReview(
      row._id,
      row.versions[0]._id,
      'org-a',
      {},
      editor
    );

    expect(result.evidence).toMatchObject({
      origin: 'deterministic',
      generatedByAI: false,
      objectiveStatus: 'passed',
      productionApproval: false,
      humanReviewRequired: true,
    });
    expect(result.evidence.checks.every((check) => check.status === 'passed')).toBe(true);
    expect(row.versions[0].certificationReviews).toHaveLength(0);
    expect(result.certification.ready).toBe(false);
    expect(row.versions[0].validationStatus).toBe('draft');
    expect(row.versions[0].calculationStatus).toBe('blocked');
  });

  test('records AI-assisted evidence with provenance and makes reported contradictions fail closed', async () => {
    const row = technicallyCompleteRow();
    row.save = jest.fn().mockResolvedValue(row);
    jest.spyOn(TaxJurisdictionConfig, 'findOne').mockResolvedValue(row);

    const result = await taxJurisdictionService.runAutomatedTechnicalReview(
      row._id,
      row.versions[0]._id,
      'org-a',
      {
        aiAssessment: {
          provider: 'configured-runtime',
          model: 'tax-review-model',
          promptVersion: 'tax-technical-review-v1',
          outputDigestSha256: 'd'.repeat(64),
          summary: 'Technical comparison completed; one legal conflict remains.',
          unresolvedLegalContradictions: ['Official threshold table conflicts with the explanatory text.'],
        },
        productionApproval: true,
      },
      editor
    );

    expect(result.evidence).toMatchObject({
      origin: 'ai_assisted',
      generatedByAI: true,
      engine: {
        provider: 'configured-runtime',
        model: 'tax-review-model',
        outputDigestSha256: 'd'.repeat(64),
      },
      objectiveStatus: 'passed',
      productionApproval: false,
      humanReviewRequired: true,
      unresolvedLegalContradictions: ['Official threshold table conflicts with the explanatory text.'],
    });
    expect(row.versions[0].legalOpenIssues).toEqual([
      'Official threshold table conflicts with the explanatory text.',
    ]);
    expect(row.versions[0].certificationReviews).toHaveLength(0);
  });

  test('rejects untraceable AI evidence and never stores it', async () => {
    const row = technicallyCompleteRow();
    row.save = jest.fn().mockResolvedValue(row);
    jest.spyOn(TaxJurisdictionConfig, 'findOne').mockResolvedValue(row);

    await expect(taxJurisdictionService.runAutomatedTechnicalReview(
      row._id,
      row.versions[0]._id,
      'org-a',
      { aiAssessment: { provider: 'unknown', model: '', outputDigestSha256: 'not-a-digest' } },
      editor
    )).rejects.toMatchObject({ code: 'TAX_PACK_AI_EVIDENCE_PROVENANCE_REQUIRED' });
    expect(row.save).not.toHaveBeenCalled();
    expect(row.versions[0].automatedTechnicalReviews).toHaveLength(0);
  });

  test('unresolved legal contradictions block runnable publication before any approval can take effect', async () => {
    const row = technicallyCompleteRow();
    const version = row.versions[0];
    version.validationStatus = 'validated';
    version.calculationStatus = 'runnable';
    version.legalOpenIssues = ['Two primary authorities state different contribution ceilings.'];
    jest.spyOn(TaxJurisdictionConfig, 'findOne').mockResolvedValue(row);

    await expect(taxJurisdictionService.publishVersion(
      row._id,
      version._id,
      'org-a',
      { userId: 'publisher-1', name: 'Publisher' }
    )).rejects.toMatchObject({
      code: 'TAX_PACK_LEGAL_CONTRADICTIONS_UNRESOLVED',
      details: ['Two primary authorities state different contribution ceilings.'],
    });
  });
});
