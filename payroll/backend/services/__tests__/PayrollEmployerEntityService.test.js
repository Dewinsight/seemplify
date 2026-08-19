'use strict';

const mongoose = require('mongoose');
const PayrollEmployerEntity = require('../../models/PayrollEmployerEntity');
const PayrollRun = require('../../models/PayrollRun');
const employerEntityService = require('../PayrollEmployerEntityService');
const taxJurisdictionService = require('../TaxJurisdictionService');
const { normalizePayload, readiness } = require('../PayrollEmployerEntityService');
const nigeriaFixtures = require('../countryAdapters/fixtures/Nigeria2026OfficialFixtures');

function objectId() {
  return new mongoose.Types.ObjectId();
}

function entity(overrides = {}) {
  return new PayrollEmployerEntity({
    _id: objectId(),
    organizationId: 'org-1',
    code: 'NG-LAGOS',
    legalName: 'Seemplify Nigeria Limited',
    employerType: 'company',
    countryCode: 'NG',
    jurisdictionCode: 'NG-LA',
    defaultCurrency: 'NGN',
    taxJurisdictionConfigId: objectId(),
    taxJurisdictionVersionId: objectId(),
    taxAdapterCandidateId: 'NG_2026_WAVE_1',
    status: 'active',
    createdBy: 'admin-1',
    taxRegistrations: [{
      authorityCode: 'LIRS',
      registrationType: 'PAYE employer registration',
      registrationReference: 'SYNTHETIC-LIRS-EMPLOYER',
      evidenceReference: 'SYNTHETIC-EVIDENCE-RECEIPT',
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      effectiveTo: new Date('2026-12-31T23:59:59Z'),
      status: 'reviewed',
      reviewedBy: 'reviewer-1',
      reviewedAt: new Date('2026-01-01T00:00:00Z'),
    }],
    ...overrides,
  });
}

describe('PayrollEmployerEntityService multi-jurisdiction controls', () => {
  afterEach(() => jest.restoreAllMocks());

  test('normalizes a Nigeria legal employer without treating the parent organization as the tax employer', () => {
    expect(normalizePayload({
      code: ' ng-lagos ',
      legalName: 'Seemplify Nigeria Limited',
      countryCode: 'ng',
      jurisdictionCode: 'ng-la',
      defaultCurrency: 'ngn',
      taxAdapterCandidateId: 'ng_2026_wave_1',
    })).toMatchObject({
      code: 'NG-LAGOS',
      countryCode: 'NG',
      jurisdictionCode: 'NG-LA',
      defaultCurrency: 'NGN',
      taxAdapterCandidateId: 'NG_2026_WAVE_1',
    });
  });

  test('derives an operational employer from country, organization and published software defaults', async () => {
    const jurisdictionId = objectId();
    const versionId = objectId();
    jest.spyOn(PayrollEmployerEntity, 'findOne').mockResolvedValue(null);
    jest.spyOn(taxJurisdictionService, 'findGlobalByCountryCode').mockResolvedValue({
      _id: jurisdictionId,
      publishedVersionId: versionId,
      getPublishedVersion: () => ({ _id: versionId, calculationCurrency: 'NGN' }),
    });
    const create = jest.spyOn(employerEntityService, 'create').mockResolvedValue({ _id: 'default-ng' });

    const result = await employerEntityService.ensureDefaultDraft('org-1', 'Nigeria', {
      userId: 'admin-1',
      organizationName: 'Example Limited',
    });

    expect(create).toHaveBeenCalledWith('org-1', expect.objectContaining({
      code: 'NG-DEFAULT',
      legalName: 'Example Limited',
      countryCode: 'NG',
      jurisdictionCode: 'NG-LA',
      defaultCurrency: 'NGN',
      taxJurisdictionConfigId: jurisdictionId,
      taxJurisdictionVersionId: versionId,
      taxAdapterCandidateId: 'NG_2026_WAVE_1',
      taxRegistrations: [],
      status: 'active',
    }), { userId: 'admin-1' });
    expect(result).toEqual({ _id: 'default-ng' });
  });

  test('provisions an employer setup for every immutable runnable platform pack', async () => {
    const ensureDefaultDraft = jest.spyOn(employerEntityService, 'ensureDefaultDraft')
      .mockImplementation(async (_organizationId, countryCode) => ({ _id: `default-${countryCode}` }));

    const result = await employerEntityService.ensurePlatformDefaults('org-1', {
      userId: 'admin-1',
      organizationName: 'Example Limited',
    });

    expect(result.supportedCountries).toEqual(['GB', 'US', 'NG', 'GH', 'KE', 'ZA', 'CM', 'MZ']);
    expect(result.provisionedCountries).toEqual(result.supportedCountries);
    expect(ensureDefaultDraft).toHaveBeenCalledTimes(8);
    expect(ensureDefaultDraft).toHaveBeenCalledWith('org-1', 'GB', {
      userId: 'admin-1',
      organizationName: 'Example Limited',
    });
    expect(ensureDefaultDraft).not.toHaveBeenCalledWith('org-1', 'CA', expect.anything());
    expect(ensureDefaultDraft).not.toHaveBeenCalledWith('org-1', 'EU', expect.anything());
    expect(ensureDefaultDraft).not.toHaveBeenCalledWith('org-1', 'OTHER', expect.anything());
  });

  test('rejects a jurisdiction that does not belong to the legal employer country', () => {
    expect(() => normalizePayload({
      code: 'WRONG', legalName: 'Wrong entity', countryCode: 'NG', jurisdictionCode: 'GB', defaultCurrency: 'NGN',
    })).toThrow(expect.objectContaining({ code: 'EMPLOYER_JURISDICTION_COUNTRY_MISMATCH' }));
  });

  test('keeps Nigeria preview-only until its published pack is runnable', () => {
    const row = entity().toObject();
    const result = readiness(row, {
      candidate: employerEntityService.listAdapterCandidates().find((candidate) => candidate.id === 'NG_2026_WAVE_1'),
      version: {
        _id: row.taxJurisdictionVersionId,
        label: 'Nigeria 2026 preview',
        calculationStatus: 'preview_only',
        calculationCurrency: 'NGN',
        contentHash: 'a'.repeat(64),
      },
    });

    expect(result.payrollRunnable).toBe(false);
    expect(result.mode).toBe('preview_only');
    expect(result.blockingIssues).toContain('Tax pack is preview_only and cannot finalize payroll.');
  });

  test('a released pack can calculate before registration metadata is added', () => {
    const row = entity().toObject();
    row.taxRegistrations = [];
    const result = readiness(row, {
      candidate: employerEntityService.listAdapterCandidates().find((candidate) => candidate.id === 'NG_2026_WAVE_1'),
      version: {
        _id: row.taxJurisdictionVersionId,
        label: 'Nigeria 2026 certified',
        calculationStatus: 'runnable',
        calculationCurrency: 'NGN',
        contentHash: 'b'.repeat(64),
      },
    });

    expect(result).toMatchObject({
      payrollRunnable: true,
      mode: 'runnable',
      blockingIssues: [],
      warnings: [expect.stringMatching(/registration is not yet verified/i)],
    });
  });

  test('a platform-released pack does not require a separate candidate binding', () => {
    const row = entity({ taxAdapterCandidateId: '' }).toObject();
    const result = readiness(row, {
      version: {
        _id: row.taxJurisdictionVersionId,
        label: 'Nigeria 2026 platform release',
        calculationStatus: 'runnable',
        calculationCurrency: 'NGN',
        contentHash: 'b'.repeat(64),
        platformRelease: { releaseId: 'platform:NG-2026-NTA:2026-08-19' },
      },
    });

    expect(result).toMatchObject({ payrollRunnable: true, mode: 'runnable', blockingIssues: [] });
  });

  test('upgrades a preview binding to the current published platform release', async () => {
    const currentVersionId = objectId();
    const publishedVersionId = objectId();
    const row = entity({ taxJurisdictionVersionId: currentVersionId });
    jest.spyOn(PayrollEmployerEntity, 'find').mockResolvedValue([row]);
    jest.spyOn(taxJurisdictionService, 'getJurisdictionById').mockResolvedValue({
      publishedVersionId,
      versions: [
        { _id: currentVersionId, calculationStatus: 'preview_only', calculationCurrency: 'NGN' },
        {
          _id: publishedVersionId,
          status: 'published',
          validationStatus: 'validated',
          calculationStatus: 'runnable',
          calculationCurrency: 'NGN',
          effectiveFrom: '2026-01-01',
          platformRelease: { releaseId: 'platform:NG-2026-NTA:2026-08-19' },
        },
      ],
      getPublishedVersion() {
        return this.versions[1];
      },
    });
    const save = jest.spyOn(row, 'save').mockResolvedValue(row);

    await expect(employerEntityService.upgradePlatformTaxBindings(new Date('2026-08-19')))
      .resolves.toBe(1);
    expect(row.taxJurisdictionVersionId).toEqual(publishedVersionId);
    expect(row.lastModifiedBy).toBe('system-tax-release-migration');
    expect(save).toHaveBeenCalledTimes(1);
  });

  test('runs the source-pinned Nigeria candidate through the entity preview boundary', () => {
    const result = employerEntityService.calculateCandidatePreview(entity(), nigeriaFixtures.buildBaseInput());

    expect(result.execution).toMatchObject({
      mode: 'preview_only',
      postingAllowed: false,
      adapterId: 'NG_2026_WAVE_1',
      jurisdictionCode: 'NG-LA',
    });
    expect(result.result.totals).toMatchObject({
      grossCashPay: expect.objectContaining({ amount: '1000000.00' }),
      netCashPay: expect.objectContaining({ amount: '760270.00' }),
    });
    expect(result.result.incomeTax.currentPaye).toMatchObject({ amount: '138230.00' });
  });

  test('accepts a Nigerian employee only for the Nigerian legal employer', () => {
    const row = entity();
    const profile = {
      employerEntityId: row._id,
      currency: 'NGN',
      taxConfig: { jurisdictionCode: 'NG', jurisdictionConfigId: row.taxJurisdictionConfigId },
      taxAssignment: { taxJurisdictionCode: 'NG-LA' },
    };
    expect(employerEntityService.assertProfileAssignment(profile, row)).toBe(true);
  });

  test('allows a blocked draft employer without a bound pack to retain country tax defaults', () => {
    const row = entity({ taxJurisdictionConfigId: null, taxJurisdictionVersionId: null, taxAdapterCandidateId: '', status: 'draft' });
    const profile = {
      employerEntityId: row._id,
      currency: 'NGN',
      taxConfig: { jurisdictionCode: 'NG', jurisdictionConfigId: objectId() },
      taxAssignment: { taxJurisdictionCode: 'NG-LA' },
    };

    expect(employerEntityService.assertProfileAssignment(profile, row)).toBe(true);
  });

  test.each([
    ['another legal employer', { employerEntityId: objectId(), currency: 'NGN', taxAssignment: { taxJurisdictionCode: 'NG-LA' } }, 'PAYROLL_EMPLOYEE_EMPLOYER_MISMATCH'],
    ['GBP instead of NGN', { currency: 'GBP', taxAssignment: { taxJurisdictionCode: 'NG-LA' } }, 'PAYROLL_EMPLOYEE_CURRENCY_MISMATCH'],
    ['UK tax on a Nigeria entity', { currency: 'NGN', taxAssignment: { taxJurisdictionCode: 'GB' } }, 'PAYROLL_EMPLOYEE_TAX_JURISDICTION_MISMATCH'],
  ])('rejects %s', (_label, override, expectedCode) => {
    const row = entity();
    const profile = {
      employerEntityId: row._id,
      currency: 'NGN',
      taxConfig: { jurisdictionCode: 'NG' },
      taxAssignment: { taxJurisdictionCode: 'NG-LA' },
      ...override,
    };
    expect(() => employerEntityService.assertProfileAssignment(profile, row))
      .toThrow(expect.objectContaining({ code: expectedCode }));
  });

  test('supports a separate UK subsidiary and GBP employee without mixing it into Nigeria payroll', () => {
    const ukEntity = entity({
      code: 'UK-SUB',
      legalName: 'Seemplify UK Limited',
      employerType: 'subsidiary',
      countryCode: 'GB',
      jurisdictionCode: 'GB',
      defaultCurrency: 'GBP',
      taxAdapterCandidateId: 'GB_PAYE_2026_WAVE_1',
    });
    const ukProfile = {
      employerEntityId: ukEntity._id,
      currency: 'GBP',
      taxConfig: { jurisdictionCode: 'GB', jurisdictionConfigId: ukEntity.taxJurisdictionConfigId },
      taxAssignment: { workCountryCode: 'GB', taxJurisdictionCode: 'GB' },
    };

    expect(employerEntityService.assertProfileAssignment(ukProfile, ukEntity)).toBe(true);
    expect(() => employerEntityService.assertProfileAssignment(ukProfile, entity()))
      .toThrow(expect.objectContaining({ code: 'PAYROLL_EMPLOYEE_EMPLOYER_MISMATCH' }));
  });

  test('uses legal-employer identity in the active-period uniqueness key', async () => {
    const ngRun = new PayrollRun({
      runNumber: 'PR-2026-08-001', organizationId: 'org-1', employerEntityId: objectId(), createdBy: 'admin',
      payPeriod: { type: 'monthly', month: 8, year: 2026, startDate: '2026-08-01', endDate: '2026-08-31', paymentDate: '2026-08-31' },
    });
    const gbRun = new PayrollRun({
      runNumber: 'PR-2026-08-002', organizationId: 'org-1', employerEntityId: objectId(), createdBy: 'admin',
      payPeriod: { type: 'monthly', month: 8, year: 2026, startDate: '2026-08-01', endDate: '2026-08-31', paymentDate: '2026-08-31' },
    });
    await ngRun.validate();
    await gbRun.validate();

    expect(ngRun.activePeriodKey).toBe('monthly:2026:08');
    expect(gbRun.activePeriodKey).toBe('monthly:2026:08');
    expect(PayrollRun.schema.indexes()).toContainEqual([
      { organizationId: 1, employerEntityId: 1, activePeriodKey: 1 },
      expect.objectContaining({
        unique: true,
        partialFilterExpression: {
          employerEntityId: { $type: 'objectId' },
          activePeriodKey: { $type: 'string' },
        },
      }),
    ]);
  });
});
