'use strict';

const PayrollEmployerEntity = require('../models/PayrollEmployerEntity');
const PayrollRun = require('../models/PayrollRun');
const taxJurisdictionService = require('./TaxJurisdictionService');
const createBuiltInTaxAdapterCandidateRegistry = require('./tax/createBuiltInTaxAdapterCandidateRegistry');
const { normalizeTaxCountry } = require('./tax/TaxCurrencyCatalog');

const candidateRegistry = createBuiltInTaxAdapterCandidateRegistry();
const MATERIAL_FIELDS = Object.freeze([
  'countryCode',
  'jurisdictionCode',
  'defaultCurrency',
  'taxJurisdictionConfigId',
  'taxJurisdictionVersionId',
  'taxAdapterCandidateId',
]);

function serviceError(message, statusCode = 400, code = 'PAYROLL_EMPLOYER_ENTITY_INVALID', details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function text(value) {
  return String(value || '').trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function idText(value) {
  return value ? String(value) : '';
}

function normalizeRegistrations(value) {
  if (!Array.isArray(value)) return [];
  return value.map((registration) => ({
    authorityCode: upper(registration?.authorityCode),
    registrationType: text(registration?.registrationType),
    registrationReference: text(registration?.registrationReference),
    evidenceReference: text(registration?.evidenceReference),
    effectiveFrom: registration?.effectiveFrom ? new Date(registration.effectiveFrom) : null,
    effectiveTo: registration?.effectiveTo ? new Date(registration.effectiveTo) : null,
    status: text(registration?.status) || 'unverified',
    reviewedBy: text(registration?.reviewedBy),
    reviewedAt: registration?.reviewedAt ? new Date(registration.reviewedAt) : null,
  }));
}

function normalizePayload(payload = {}, existing = null) {
  const value = {
    code: upper(payload.code !== undefined ? payload.code : existing?.code),
    legalName: text(payload.legalName !== undefined ? payload.legalName : existing?.legalName),
    employerType: text(payload.employerType !== undefined ? payload.employerType : existing?.employerType) || 'company',
    countryCode: upper(payload.countryCode !== undefined ? payload.countryCode : existing?.countryCode),
    jurisdictionCode: upper(payload.jurisdictionCode !== undefined ? payload.jurisdictionCode : existing?.jurisdictionCode),
    defaultCurrency: upper(payload.defaultCurrency !== undefined ? payload.defaultCurrency : existing?.defaultCurrency),
    registeredAddress: payload.registeredAddress !== undefined
      ? { ...(payload.registeredAddress || {}), countryCode: upper(payload.registeredAddress?.countryCode || payload.countryCode || existing?.countryCode) }
      : (existing?.registeredAddress?.toObject?.() || existing?.registeredAddress || {}),
    taxRegistrations: payload.taxRegistrations !== undefined
      ? normalizeRegistrations(payload.taxRegistrations)
      : normalizeRegistrations(existing?.taxRegistrations || []),
    taxJurisdictionConfigId: payload.taxJurisdictionConfigId !== undefined
      ? (payload.taxJurisdictionConfigId || null)
      : (existing?.taxJurisdictionConfigId || null),
    taxJurisdictionVersionId: payload.taxJurisdictionVersionId !== undefined
      ? (payload.taxJurisdictionVersionId || null)
      : (existing?.taxJurisdictionVersionId || null),
    taxAdapterCandidateId: upper(payload.taxAdapterCandidateId !== undefined
      ? payload.taxAdapterCandidateId
      : existing?.taxAdapterCandidateId),
    status: text(payload.status !== undefined ? payload.status : existing?.status) || 'draft',
  };

  if (!value.code || !value.legalName || !value.countryCode || !value.jurisdictionCode || !value.defaultCurrency) {
    throw serviceError('Code, legal name, country, jurisdiction and default currency are required.');
  }
  if (!value.jurisdictionCode.startsWith(value.countryCode)) {
    throw serviceError('Jurisdiction code must belong to the legal employer country.', 422, 'EMPLOYER_JURISDICTION_COUNTRY_MISMATCH');
  }
  return value;
}

async function resolveBindings(value, organizationId) {
  let candidate = null;
  if (value.taxAdapterCandidateId) {
    candidate = candidateRegistry.get(value.taxAdapterCandidateId);
    if (candidate.countryCode !== value.countryCode
      || candidate.jurisdictionCode !== value.jurisdictionCode
      || candidate.currency !== value.defaultCurrency) {
      throw serviceError(
        'The selected tax adapter does not match the employer country, jurisdiction and currency.',
        422,
        'EMPLOYER_TAX_ADAPTER_MISMATCH',
        { adapterId: candidate.id }
      );
    }
  }

  let jurisdiction = null;
  let version = null;
  if (value.taxJurisdictionConfigId) {
    jurisdiction = await taxJurisdictionService.getJurisdictionById(value.taxJurisdictionConfigId, organizationId);
    if (!jurisdiction) {
      throw serviceError('The selected tax jurisdiction pack is unavailable to this organization.', 404, 'EMPLOYER_TAX_PACK_NOT_FOUND');
    }
    if (upper(jurisdiction.countryCode) !== value.countryCode) {
      throw serviceError('The tax jurisdiction pack country does not match the legal employer.', 422, 'EMPLOYER_TAX_PACK_COUNTRY_MISMATCH');
    }
    version = value.taxJurisdictionVersionId
      ? (jurisdiction.versions || []).find((entry) => idText(entry._id) === idText(value.taxJurisdictionVersionId))
      : jurisdiction.getPublishedVersion?.();
    if (!version) {
      throw serviceError('Select an available published tax-pack version for this legal employer.', 422, 'EMPLOYER_TAX_PACK_VERSION_REQUIRED');
    }
    if (upper(version.calculationCurrency) !== value.defaultCurrency) {
      throw serviceError('The tax pack calculation currency must match the legal employer currency.', 422, 'EMPLOYER_TAX_PACK_CURRENCY_MISMATCH');
    }
    value.taxJurisdictionVersionId = version._id;
  } else if (value.taxJurisdictionVersionId) {
    throw serviceError('A tax-pack version cannot be selected without its jurisdiction pack.', 422, 'EMPLOYER_TAX_PACK_REQUIRED');
  }

  return { candidate, jurisdiction, version };
}

function readiness(entity, bindings = {}) {
  const version = bindings.version || null;
  const candidate = bindings.candidate || null;
  const blockingIssues = [];
  const warnings = [];
  if (entity.status !== 'active') blockingIssues.push('Legal employer is not active.');
  if (!entity.taxJurisdictionConfigId || !version) blockingIssues.push('No published jurisdiction tax pack is bound.');
  if ((!entity.taxAdapterCandidateId || !candidate) && !version?.platformRelease) {
    blockingIssues.push('No independently tested adapter candidate is bound.');
  }
  if (version && version.calculationStatus !== 'runnable') {
    blockingIssues.push(`Tax pack is ${version.calculationStatus || 'blocked'} and cannot finalize payroll.`);
  }
  // The candidate registry is deliberately non-postable. A candidate becomes
  // runnable only through a separately published jurisdiction version whose
  // legal/test gates have promoted calculationStatus to runnable.
  const activeRegistration = (entity.taxRegistrations || []).some((registration) => (
    registration.status === 'reviewed'
    && registration.effectiveFrom
    && (!registration.effectiveTo || new Date(registration.effectiveTo) >= new Date())
  ));
  if (!activeRegistration) {
    warnings.push('Employer tax registration is not yet verified; calculation is available, but remittance exports may require the registration reference.');
  }

  return {
    payrollRunnable: blockingIssues.length === 0,
    mode: blockingIssues.length === 0 ? 'runnable' : (candidate ? 'preview_only' : 'blocked'),
    blockingIssues,
    warnings,
    adapter: candidate || null,
    taxPack: version ? {
      jurisdictionId: idText(entity.taxJurisdictionConfigId),
      versionId: idText(version._id),
      label: version.label,
      calculationStatus: version.calculationStatus,
      contentHash: version.contentHash || '',
      calculationCurrency: version.calculationCurrency,
    } : null,
  };
}

class PayrollEmployerEntityService {
  listAdapterCandidates() {
    return candidateRegistry.list();
  }

  async list(organizationId, options = {}) {
    const query = { organizationId };
    if (options.status) query.status = options.status;
    const rows = await PayrollEmployerEntity.find(query).sort({ legalName: 1, code: 1 });
    return Promise.all(rows.map((row) => this.withReadiness(row, organizationId)));
  }

  async get(id, organizationId) {
    const row = await PayrollEmployerEntity.findOne({ _id: id, organizationId });
    return row ? this.withReadiness(row, organizationId) : null;
  }

  async withReadiness(row, organizationId) {
    const plain = row.toObject?.() || row;
    let bindings = {};
    try {
      bindings = await resolveBindings(normalizePayload({}, row), organizationId);
    } catch (error) {
      bindings.bindingError = error;
    }
    const result = readiness(plain, bindings);
    if (bindings.bindingError) result.blockingIssues.unshift(bindings.bindingError.message);
    result.payrollRunnable = result.blockingIssues.length === 0;
    return { ...plain, payrollReadiness: result };
  }

  async create(organizationId, payload, actor = {}) {
    const value = normalizePayload(payload);
    await resolveBindings(value, organizationId);
    const row = await PayrollEmployerEntity.create({
      organizationId,
      ...value,
      createdBy: text(actor.userId),
      lastModifiedBy: text(actor.userId),
    });
    return this.withReadiness(row, organizationId);
  }

  /**
   * Create an operational employer default after an administrator chooses an
   * employee payroll country. Registration references remain visible warnings
   * for remittance/export workflows instead of blocking payroll calculation.
   */
  async ensureDefaultDraft(organizationId, countryInput, actor = {}) {
    const country = normalizeTaxCountry(countryInput);
    if (!country) return null;

    const existing = await PayrollEmployerEntity.findOne({
      organizationId,
      countryCode: country.countryCode,
    });
    if (existing) {
      return existing.status === 'inactive' ? null : this.withReadiness(existing, organizationId);
    }

    const jurisdiction = await taxJurisdictionService.findGlobalByCountryCode(country.countryCode);
    const published = jurisdiction?.getPublishedVersion?.()
      || (jurisdiction?.versions || []).find((version) => String(version._id) === String(jurisdiction?.publishedVersionId));
    const candidate = candidateRegistry.list().find((entry) => (
      entry.countryCode === country.countryCode
      && entry.currency === country.currencyCode
    ));
    const organizationName = text(actor.organizationName);

    const payload = {
      code: `${country.countryCode}-DEFAULT`,
      legalName: organizationName || `${country.countryName} payroll employer`,
      employerType: 'company',
      countryCode: country.countryCode,
      jurisdictionCode: candidate?.jurisdictionCode || country.countryCode,
      defaultCurrency: country.currencyCode,
      registeredAddress: { countryCode: country.countryCode },
      taxRegistrations: [],
      taxJurisdictionConfigId: jurisdiction && published ? jurisdiction._id : null,
      taxJurisdictionVersionId: published?._id || null,
      taxAdapterCandidateId: candidate?.id || '',
      status: 'active',
    };

    try {
      return await this.create(organizationId, payload, {
        userId: text(actor.userId) || 'system-payroll-defaults',
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const raced = await PayrollEmployerEntity.findOne({
        organizationId,
        countryCode: country.countryCode,
        status: { $ne: 'inactive' },
      });
      return raced ? this.withReadiness(raced, organizationId) : null;
    }
  }

  /**
   * Provision one operational legal-employer binding for every platform-owned
   * tax pack that has passed the immutable release gates. Blank templates and
   * certification candidates are intentionally excluded: they cannot produce
   * a valid statutory payroll run.
   *
   * Existing country setups are preserved, including an administrator's
   * deliberate decision to inactivate one. This method only fills missing
   * platform defaults and is therefore safe to run whenever the setup page is
   * opened.
   */
  async ensurePlatformDefaults(organizationId, actor = {}) {
    if (!text(organizationId)) {
      throw serviceError('An organization is required to provision payroll employers.', 400, 'PAYROLL_ORGANIZATION_REQUIRED');
    }

    const releasedCountries = taxJurisdictionService.seedDefinitions
      .filter((seed) => (
        seed?.version?.calculationStatus === 'runnable'
        && seed?.version?.validationStatus === 'validated'
        && seed?.version?.platformRelease
      ))
      .map((seed) => seed.countryCode);

    const results = [];
    for (const countryCode of releasedCountries) {
      const entity = await this.ensureDefaultDraft(organizationId, countryCode, actor);
      results.push({ countryCode, entity });
    }

    return {
      supportedCountries: releasedCountries,
      provisionedCountries: results.filter((entry) => entry.entity).map((entry) => entry.countryCode),
    };
  }

  async upgradePlatformTaxBindings(now = new Date()) {
    const employers = await PayrollEmployerEntity.find({
      status: { $ne: 'inactive' },
      taxJurisdictionConfigId: { $ne: null },
      taxJurisdictionVersionId: { $ne: null },
    });
    let upgradedCount = 0;

    for (const employer of employers) {
      const jurisdiction = await taxJurisdictionService.getJurisdictionById(
        employer.taxJurisdictionConfigId,
        employer.organizationId
      );
      const published = jurisdiction?.getPublishedVersion?.()
        || (jurisdiction?.versions || []).find((version) => (
          idText(version._id) === idText(jurisdiction?.publishedVersionId)
        ));
      const current = (jurisdiction?.versions || []).find((version) => (
        idText(version._id) === idText(employer.taxJurisdictionVersionId)
      ));
      const effectiveFrom = published?.effectiveFrom ? new Date(published.effectiveFrom) : null;
      const canAutoUpgrade = published
        && idText(published._id) !== idText(employer.taxJurisdictionVersionId)
        && published.status === 'published'
        && published.validationStatus === 'validated'
        && published.calculationStatus === 'runnable'
        && published.platformRelease
        && upper(published.calculationCurrency) === upper(employer.defaultCurrency)
        && (!effectiveFrom || effectiveFrom <= now)
        && (current?.calculationStatus !== 'runnable' || current?.platformRelease);

      if (!canAutoUpgrade) continue;
      employer.taxJurisdictionVersionId = published._id;
      employer.lastModifiedBy = 'system-tax-release-migration';
      await employer.save();
      upgradedCount += 1;
    }

    return upgradedCount;
  }

  async update(id, organizationId, payload, actor = {}) {
    const row = await PayrollEmployerEntity.findOne({ _id: id, organizationId });
    if (!row) throw serviceError('Legal employer not found.', 404, 'PAYROLL_EMPLOYER_ENTITY_NOT_FOUND');
    const value = normalizePayload(payload, row);
    const changedMaterialFields = MATERIAL_FIELDS.filter((field) => idText(row[field]) !== idText(value[field]));
    if (changedMaterialFields.length > 0) {
      const historicalRunExists = await PayrollRun.exists({ organizationId, employerEntityId: row._id });
      if (historicalRunExists) {
        throw serviceError(
          'Country, jurisdiction, currency and tax bindings cannot be changed after payroll history exists. Create a new legal employer or tax-pack version instead.',
          409,
          'PAYROLL_EMPLOYER_ENTITY_IMMUTABLE',
          { changedFields: changedMaterialFields }
        );
      }
    }
    await resolveBindings(value, organizationId);
    Object.assign(row, value, { lastModifiedBy: text(actor.userId) });
    await row.save();
    return this.withReadiness(row, organizationId);
  }

  async assertRunEntity(id, organizationId, paymentDate) {
    const row = await PayrollEmployerEntity.findOne({ _id: id, organizationId, status: 'active' });
    if (!row) throw serviceError('Select an active legal employer for this payroll run.', 422, 'PAYROLL_EMPLOYER_ENTITY_REQUIRED');
    const value = normalizePayload({}, row);
    const bindings = await resolveBindings(value, organizationId);
    const result = readiness(row.toObject?.() || row, bindings);
    if (!result.taxPack) {
      throw serviceError('The legal employer has no published tax pack.', 422, 'PAYROLL_EMPLOYER_TAX_PACK_REQUIRED');
    }
    const date = new Date(paymentDate);
    const from = new Date(bindings.version.effectiveFrom);
    const to = bindings.version.effectiveTo ? new Date(bindings.version.effectiveTo) : null;
    if (date < from || (to && date > to)) {
      throw serviceError('The legal employer tax-pack version is not effective on the payment date.', 422, 'PAYROLL_EMPLOYER_TAX_PACK_NOT_EFFECTIVE');
    }
    return { entity: row, readiness: result, bindings };
  }

  async assertAssignableEntity(id, organizationId) {
    if (!id) return null;
    const row = await PayrollEmployerEntity.findOne({ _id: id, organizationId, status: { $ne: 'inactive' } });
    if (!row) {
      throw serviceError('The selected legal employer is unavailable to this organization.', 404, 'PAYROLL_EMPLOYER_ENTITY_NOT_FOUND');
    }
    return row;
  }

  assertProfileAssignment(profile, entity) {
    if (!profile?.employerEntityId || idText(profile.employerEntityId) !== idText(entity?._id)) {
      throw serviceError(
        'Employee is not assigned to the legal employer selected for this payroll run.',
        422,
        'PAYROLL_EMPLOYEE_EMPLOYER_MISMATCH'
      );
    }
    const paymentCurrency = upper(profile.currency);
    if (paymentCurrency !== upper(entity.defaultCurrency)) {
      throw serviceError(
        `Employee payment currency ${paymentCurrency || '(missing)'} does not match legal employer currency ${entity.defaultCurrency}.`,
        422,
        'PAYROLL_EMPLOYEE_CURRENCY_MISMATCH'
      );
    }
    const assignedJurisdiction = upper(profile.taxAssignment?.taxJurisdictionCode || profile.taxConfig?.jurisdictionCode);
    if (assignedJurisdiction !== upper(entity.jurisdictionCode)
      && assignedJurisdiction !== upper(entity.countryCode)) {
      throw serviceError(
        `Employee tax jurisdiction ${assignedJurisdiction || '(missing)'} does not match legal employer jurisdiction ${entity.jurisdictionCode}.`,
        422,
        'PAYROLL_EMPLOYEE_TAX_JURISDICTION_MISMATCH'
      );
    }
    if (entity.taxJurisdictionConfigId
      && profile.taxConfig?.jurisdictionConfigId
      && idText(profile.taxConfig.jurisdictionConfigId) !== idText(entity.taxJurisdictionConfigId)) {
      throw serviceError(
        'Employee tax pack does not match the legal employer tax pack.',
        422,
        'PAYROLL_EMPLOYEE_TAX_PACK_MISMATCH'
      );
    }
    return true;
  }

  calculateCandidatePreview(entity, input) {
    if (!entity?.taxAdapterCandidateId) {
      throw serviceError('This legal employer has no adapter candidate for preview.', 422, 'PAYROLL_EMPLOYER_ADAPTER_REQUIRED');
    }
    return candidateRegistry.calculatePreview(entity.taxAdapterCandidateId, input);
  }
}

module.exports = new PayrollEmployerEntityService();
module.exports.serviceError = serviceError;
module.exports.normalizePayload = normalizePayload;
module.exports.readiness = readiness;
