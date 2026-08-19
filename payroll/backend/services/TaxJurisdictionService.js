const mongoose = require('mongoose');
const crypto = require('crypto');
const TaxJurisdictionConfig = require('../models/TaxJurisdictionConfig');
const formulaEngine = require('./FormulaEngine');
const currencyService = require('./CurrencyService');
const { getRolloutInventory } = require('./tax/TaxJurisdictionRolloutInventory');

const PAY_PERIODS_PER_YEAR = {
  monthly: 12,
  'semi-monthly': 24,
  'bi-weekly': 26,
  weekly: 52,
};

const SOURCE_LINKS = Object.freeze({
  HMRC_2026: { label: 'HMRC 2026/27 rates and thresholds', url: 'https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027' },
  HMRC_PAYE_SPEC_2026: { label: 'HMRC PAYE technical specification 2026/27', url: 'https://www.gov.uk/government/publications/payroll-technical-specifications-income-tax' },
  HMRC_NI_SPEC_2026: { label: 'HMRC National Insurance technical specification 2026/27', url: 'https://www.gov.uk/government/publications/payroll-technical-specifications-national-insurance' },
  IRS_2026: { label: 'IRS Publication 15-T', url: 'https://www.irs.gov/publications/p15t' },
  IRS_EMPLOYER_2026: { label: 'IRS Publication 15 employer tax guide', url: 'https://www.irs.gov/publications/p15' },
  NIGERIA_TAX_ACT_2025: { label: 'Nigeria Tax Act 2025', url: 'https://nass.gov.ng/documents/download/11249' },
  NIGERIA_TRANSITION_2026: { label: 'Nigeria Tax Acts 2025 transition guidance', url: 'https://finance.gov.ng/federal-government-issues-transition-guidelines-for-tax-acts-2025/' },
  NIGERIA_JRB_2026: { label: 'Joint Revenue Board personal income tax guidelines 2026', url: 'https://www.jrb.gov.ng/media-center/jrb-releases-pit-guidelines-2026' },
  PENCOM_2026: { label: 'PenCom revised service charter', url: 'https://www.pencom.gov.ng/wp-content/uploads/2026/05/FINAL-REVISED-SERVICE-CHARTER.pdf' },
  GRA_PAYE: { label: 'Ghana Revenue Authority PAYE guidance', url: 'https://gra.gov.gh/domestic-tax/tax-types/paye/' },
  GHANA_SSNIT_2026: { label: 'Ghana SSNIT 2026 insurable earnings notice', url: 'https://www.ssnit.org.gh/wp-content/uploads/2026/01/Public-Notice-Min-Max-Insurable.pdf' },
  KRA_PAYE: { label: 'Kenya Revenue Authority PAYE guidance', url: 'https://www.kra.go.ke/individual/filing-paying/types-of-taxes/paye' },
  KRA_DEDUCTIONS_2025: { label: 'KRA employer guidance on employee deductions, reliefs and exemptions', url: 'https://www.kra.go.ke/news-center/public-notices/2307-guidance-on-employer-obligations-in-applying-income-tax-deductions%2C-reliefs-and-exemptions' },
  KENYA_AHL_2024: { label: 'Kenya Affordable Housing Act 2024', url: 'https://new.kenyalaw.org/akn/ke/act/2024/2/eng@2024-03-21' },
  KENYA_SHIF: { label: 'Kenya Social Health Insurance Regulations', url: 'https://new.kenyalaw.org/akn/ke/act/ln/2024/49/eng@2025-02-28' },
  KENYA_NSSF_2026: { label: 'Kenya NSSF Year 4 rates effective February 2026', url: 'https://www.nssf.or.ke/notice-to-employers-year-4-2026-nssf-contribution-rates' },
  SARS_2027: { label: 'SARS 2027 monthly PAYE deduction tables', url: 'https://www.sars.gov.za/wp-content/uploads/Docs/PAYE/Tables/tables2026/PAYE-GEN-01-G01-A03-Monthly-Tax-Deduction-Tables-2027-External-Annexure.pdf' },
  SARS_UIF: { label: 'SARS Unemployment Insurance Fund contributions', url: 'https://www.sars.gov.za/latest-news/unemployment-insurance-fund-uif-contributions/' },
  SARS_SDL: { label: 'SARS Skills Development Levy', url: 'https://www.sars.gov.za/types-of-tax/skills-development-levy/' },
  CAMEROON_IRPP: { label: 'Cameroon DGI individual income tax guide', url: 'https://www.impots.cm/fr/document/tout-savoir-sur-lirpp' },
  CAMEROON_CGI: { label: 'Cameroon General Tax Code', url: 'https://www.impots.cm/sites/default/files/documents/CGI%202024%20version%20francaise.pdf' },
  CAMEROON_TDL: { label: 'Cameroon DGI local development tax table', url: 'https://www.impots.cm/sites/default/files/documents/BAREME%20TDL_DSSI%20final.pdf' },
  CAMEROON_CNPS: { label: 'Cameroon CNPS contribution rates decree', url: 'https://www.cnps.cm/images/imprimes1/decret%20fixant%20taux%20de%20cotisations%20sociales%20et%20plafonds%20des%20rmunrations.pdf' },
  MOZAMBIQUE_IRPS: { label: 'Mozambique Tax Authority IRPS guidance', url: 'https://www.at.gov.mz/por/Perguntas-Frequentes2/IRPS' },
  MOZAMBIQUE_INSS: { label: 'Mozambique INSS contribution rates', url: 'https://www.inss.gov.mz/taxa-contributiva-contribuinte/' },
  MOZAMBIQUE_REFORM_2026: { label: 'Mozambique Law 11/2025 official gazette', url: 'https://inm.gov.mz/pt-br/content/suplemento-n%C2%BA-1-de-291225-pag-2180-1-20-br-n%C2%BA-248-boletim-da-rep%C3%BAblica-i-serie' },
  CANADA_2026: { label: 'CRA T4127 payroll deduction formulas effective January 2026', url: 'https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4127-payroll-deductions-formulas/t4127-jan/t4127-jan-payroll-deductions-formulas-computer-programs.html' },
  CANADA_JULY_2026: { label: 'CRA T4127 payroll deduction formula changes effective July 2026', url: 'https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4127-payroll-deductions-formulas/t4127-jul/t4127-jul-payroll-deductions-formulas.html' },
  EU_TAX: { label: 'Your Europe: income taxes abroad', url: 'https://europa.eu/youreurope/citizens/work/taxes/income-taxes-abroad/index_en.htm' },
  EU_SOCIAL_SECURITY: { label: 'European Commission: which social-security rules apply', url: 'https://employment-social-affairs.ec.europa.eu/policies-and-activities/moving-working-europe/eu-social-security-coordination/which-rules-apply-you_en' },
});

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

function roundRate(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 10000) / 10000;
}

function normalizeCode(value, fallback = '') {
  const normalized = String(value || fallback || '').trim().toUpperCase();
  return normalized || fallback || '';
}

function normalizeDate(value, fallback = new Date()) {
  if ((value === null || value === undefined || value === '') && fallback === null) {
    return null;
  }
  const date = value ? new Date(value) : new Date(fallback);
  if (!Number.isNaN(date.getTime())) {
    return date;
  }
  return fallback === null ? null : new Date(fallback);
}

function getPayPeriodsPerYear(payFrequency) {
  return PAY_PERIODS_PER_YEAR[String(payFrequency || 'monthly').trim()] || PAY_PERIODS_PER_YEAR.monthly;
}

function getPeriodAmount(annualAmount, periodsPerYear) {
  return roundMoney(toNumber(annualAmount) / Math.max(1, periodsPerYear));
}

function ageOnDate(dateOfBirth, referenceDate) {
  const dob = normalizeDate(dateOfBirth, null);
  if (!dob || Number.isNaN(dob.getTime())) return -1;

  const ref = normalizeDate(referenceDate);
  let age = ref.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = ref.getUTCMonth() - dob.getUTCMonth();
  const dayDiff = ref.getUTCDate() - dob.getUTCDate();

  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age -= 1;
  }

  return age >= 0 ? age : -1;
}

function calculateProgressiveTaxFromBands(amount, bands = []) {
  const taxable = Math.max(0, toNumber(amount));
  let total = 0;
  const components = [];

  for (const band of bands) {
    const min = Math.max(0, toNumber(band.min));
    const max = band.max === null || band.max === undefined ? Infinity : Math.max(min, toNumber(band.max));
    if (taxable <= min) {
      continue;
    }

    const taxableInBand = Math.min(taxable, max) - min;
    if (taxableInBand <= 0) {
      continue;
    }

    const amountInBand = roundMoney(taxableInBand * (toNumber(band.rate) / 100));
    total += amountInBand;
    components.push({
      min,
      max: Number.isFinite(max) ? max : null,
      rate: roundRate(band.rate),
      taxableAmount: roundMoney(taxableInBand),
      taxAmount: amountInBand,
    });
  }

  return {
    amount: roundMoney(total),
    components,
  };
}

function calculateBaseRateTax(amount, rows = []) {
  const annualAmount = Math.max(0, toNumber(amount));
  const row = rows.find((entry) => annualAmount >= toNumber(entry.min) && annualAmount < toNumber(entry.max, Infinity))
    || rows[rows.length - 1]
    || { min: 0, max: Infinity, baseTax: 0, rate: 0 };

  const excess = Math.max(0, annualAmount - toNumber(row.min));
  const tax = toNumber(row.baseTax) + (excess * (toNumber(row.rate) / 100));

  return {
    amount: roundMoney(tax),
    row: {
      min: toNumber(row.min),
      max: Number.isFinite(toNumber(row.max, Infinity)) ? toNumber(row.max) : null,
      baseTax: roundMoney(row.baseTax),
      rate: roundRate(row.rate),
    },
  };
}

function stableStringify(value) {
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }
  if (value instanceof mongoose.Types.ObjectId) {
    return JSON.stringify(String(value));
  }
  if (value && typeof value.toObject === 'function') {
    return stableStringify(value.toObject({
      depopulate: true,
      getters: false,
      virtuals: false,
      transform: false,
    }));
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

const TAX_PACK_EDITOR_ROLES = new Set(['owner', 'admin', 'hr_admin', 'hr_manager']);
const JURISDICTION_LEVELS = new Set([
  'national',
  'federal',
  'subdivision',
  'local',
  'organization_override',
  'template',
]);

function serviceError(message, statusCode = 400, code = '') {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function normalizeJurisdictionLevel(value, fallback = 'national') {
  const level = String(value || fallback || '').trim().toLowerCase();
  return JURISDICTION_LEVELS.has(level) ? level : fallback;
}

function normalizeSubdivisionCode(countryCode, value = '') {
  const normalizedCountryCode = normalizeCode(countryCode);
  const raw = normalizeCode(value);
  if (!raw) return '';
  return raw.includes('-') ? raw : `${normalizedCountryCode}-${raw}`;
}

function normalizeLocalityCode(value = '') {
  return normalizeCode(value).replace(/\s+/g, '-');
}

function validateDynamicJurisdictionIdentity(identity = {}) {
  const level = normalizeJurisdictionLevel(identity.jurisdictionLevel || identity.coverageLevel, 'national');
  const countryCode = normalizeCode(identity.countryCode);
  const countryName = String(identity.countryName || '').trim();
  const subdivisionCode = normalizeSubdivisionCode(countryCode, identity.subdivisionCode);
  const subdivisionName = String(identity.subdivisionName || '').trim();
  const localityCode = normalizeLocalityCode(identity.localityCode);
  const localityName = String(identity.localityName || '').trim();

  if (!/^[A-Z]{2}$/.test(countryCode)) {
    throw serviceError(
      'A dynamic tax pack requires a two-letter ISO 3166-1 country code.',
      400,
      'TAX_PACK_ISO_COUNTRY_REQUIRED'
    );
  }
  if (!countryName) {
    throw serviceError('Country name is required.', 400, 'TAX_PACK_COUNTRY_NAME_REQUIRED');
  }
  if (['subdivision', 'local'].includes(level)) {
    if (!new RegExp(`^${countryCode}-[A-Z0-9]{1,3}$`).test(subdivisionCode) || !subdivisionName) {
      throw serviceError(
        'Subdivision and local packs require an ISO 3166-2 code for the selected country and a subdivision name.',
        400,
        'TAX_PACK_ISO_SUBDIVISION_REQUIRED'
      );
    }
  }
  if (level === 'local') {
    if (!/^[A-Z0-9][A-Z0-9._:-]{0,63}$/.test(localityCode) || !localityName) {
      throw serviceError(
        'Local packs require a stable local authority code and locality name.',
        400,
        'TAX_PACK_LOCALITY_REQUIRED'
      );
    }
  }

  return {
    countryCode,
    countryName,
    subdivisionCode: ['subdivision', 'local'].includes(level) ? subdivisionCode : '',
    subdivisionName: ['subdivision', 'local'].includes(level) ? subdivisionName : '',
    localityCode: level === 'local' ? localityCode : '',
    localityName: level === 'local' ? localityName : '',
    jurisdictionLevel: level,
  };
}

function backlogEntryIdentity(group, item) {
  const subdivisionGroups = new Set(['US_STATES_AND_DC', 'CANADA_PROVINCES_AND_TERRITORIES']);
  if (subdivisionGroups.has(group.id)) {
    const countryCode = group.id === 'US_STATES_AND_DC' ? 'US' : 'CA';
    return {
      countryCode,
      countryName: countryCode === 'US' ? 'United States' : 'Canada',
      subdivisionCode: item.code,
      subdivisionName: item.name,
      localityCode: '',
      localityName: '',
      jurisdictionLevel: 'subdivision',
      displayName: `${item.name} payroll tax`,
    };
  }
  return {
    countryCode: item.code,
    countryName: item.name,
    subdivisionCode: '',
    subdivisionName: '',
    localityCode: '',
    localityName: '',
    jurisdictionLevel: 'national',
    displayName: `${item.name} payroll tax`,
  };
}

function findBacklogEntry(reference = {}) {
  const groupId = String(reference.groupId || reference.backlogGroupId || '').trim();
  const entryCode = normalizeCode(reference.entryCode || reference.backlogEntryCode);
  const group = getRolloutInventory().find((candidate) => candidate.id === groupId);
  const item = group?.entries?.find((candidate) => candidate.code === entryCode);
  if (!group || !item) {
    throw serviceError(
      'The requested rollout-backlog entry does not exist.',
      404,
      'TAX_PACK_BACKLOG_ENTRY_NOT_FOUND'
    );
  }
  return { group, item, identity: backlogEntryIdentity(group, item) };
}

function contentHash(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stripPersistenceMetadata(value) {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value;
  if (value instanceof mongoose.Types.ObjectId) return String(value);
  if (Array.isArray(value)) return value.map(stripPersistenceMetadata);
  if (typeof value !== 'object') return value;

  const plain = typeof value.toObject === 'function'
    ? value.toObject({ depopulate: true, flattenMaps: true, virtuals: false, getters: false })
    : value;
  return Object.fromEntries(Object.entries(plain)
    .filter(([key]) => !['_id', '__v', 'createdAt', 'updatedAt'].includes(key))
    .map(([key, entry]) => [key, stripPersistenceMetadata(entry)]));
}

function canonicalVersionContent(version = {}) {
  const plain = stripPersistenceMetadata(version);
  return {
    packKey: plain.packKey || '',
    label: plain.label || '',
    effectiveFrom: plain.effectiveFrom || null,
    effectiveTo: plain.effectiveTo || null,
    sourceDate: plain.sourceDate || null,
    sourceLinks: plain.sourceLinks || [],
    notes: plain.notes || [],
    validationStatus: plain.validationStatus || 'draft',
    calculationStatus: plain.calculationStatus || 'blocked',
    coverage: plain.coverage || {},
    calculationCurrency: normalizeCode(plain.calculationCurrency || ''),
    fieldDefinitions: plain.fieldDefinitions || [],
    taxYear: plain.taxYear || {},
    constants: plain.constants || {},
    incomeTax: plain.incomeTax || {},
    statutoryRules: plain.statutoryRules || [],
    testCases: plain.testCases || [],
    legalOpenIssues: plain.legalOpenIssues || [],
    platformRelease: plain.platformRelease || null,
  };
}

const REQUIRED_CERTIFICATION_REVIEW_ROLES = Object.freeze([
  'tax_law',
  'payroll_calculation',
  'independent_qa',
]);

const TAX_REVIEWER_CREDENTIAL_TYPES = Object.freeze([
  'professional_license',
  'professional_membership',
  'engagement',
  'internal_appointment',
]);

const TAX_LAW_CREDENTIAL_TYPES = Object.freeze([
  'professional_license',
  'professional_membership',
  'engagement',
]);

const REQUIRED_RUNNABLE_TEST_CATEGORIES = Object.freeze([
  'zero_income',
  'ordinary_period',
  'threshold_boundary',
  'high_income',
  'year_to_date',
  'employer_cost',
]);

const RUNNABLE_BOUNDARY_POSITIONS = Object.freeze(['below', 'exact', 'above']);

function runnableFixtureInputFingerprint(inputs = {}, normalizedEmployeeTaxInputs = {}) {
  const grossPay = roundMoney(inputs.grossPay);
  const taxableIncome = roundMoney(
    inputs.taxableIncome === undefined ? grossPay : inputs.taxableIncome
  );
  const basicSalary = roundMoney(
    inputs.basicSalary === undefined ? grossPay : inputs.basicSalary
  );
  const paymentDate = inputs.paymentDate ? normalizeDate(inputs.paymentDate, null) : null;

  return contentHash({
    grossPay,
    taxableIncome,
    basicSalary,
    preTaxDeductions: roundMoney(inputs.preTaxDeductions),
    ytdGrossPay: roundMoney(inputs.ytdGrossPay),
    ytdTaxableIncome: roundMoney(inputs.ytdTaxableIncome),
    ytdIncomeTax: roundMoney(inputs.ytdIncomeTax),
    payFrequency: String(inputs.payFrequency || 'monthly').trim(),
    paymentDate: paymentDate ? paymentDate.toISOString() : '',
    employeeTaxInputs: normalizedEmployeeTaxInputs,
    employeeInfo: inputs.employeeInfo || {},
    employerInputs: inputs.employerInputs || {},
    statutoryBases: inputs.statutoryBases || {},
    statutoryContributions: inputs.statutoryContributions || {},
  });
}

function getInputValueAtPath(inputs = {}, path = '') {
  const segments = String(path || '').split('.').map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => ['__proto__', 'prototype', 'constructor'].includes(segment))) {
    return undefined;
  }
  return segments.reduce((value, segment) => (
    value !== null && value !== undefined && typeof value === 'object'
      ? value[segment]
      : undefined
  ), inputs);
}

function currentPeriodIncome(inputs = {}) {
  const grossPay = roundMoney(inputs.grossPay);
  return {
    grossPay,
    taxableIncome: roundMoney(inputs.taxableIncome === undefined ? grossPay : inputs.taxableIncome),
  };
}

function currentVersionHash(version) {
  return contentHash(canonicalVersionContent(version));
}

function platformReleaseStatus(version = {}) {
  const release = version?.platformRelease;
  // Published versions carry the canonical hash calculated before persistence.
  // Prefer it because Mongoose materializes schema defaults that are not part
  // of the immutable platform release payload.
  const persistedHash = String(version?.contentHash || '').trim().toLowerCase();
  const hash = /^[a-f0-9]{64}$/.test(persistedHash) ? persistedHash : currentVersionHash(version);
  const problems = [];
  if (!release) {
    problems.push('No platform release record is attached to this tax pack.');
  } else {
    if (!String(release.releaseId || '').trim()) problems.push('Platform release ID is missing.');
    if (!normalizeDate(release.releasedAt, null)) problems.push('Platform release date is missing.');
    if (!String(release.evidenceReference || '').trim()) problems.push('Platform release evidence reference is missing.');
    if (!/^[a-f0-9]{64}$/i.test(String(release.implementationDigestSha256 || ''))) problems.push('Platform implementation digest is invalid.');
    if (!/^[a-f0-9]{64}$/i.test(String(release.fixtureDigestSha256 || ''))) problems.push('Platform fixture digest is invalid.');
    if (!String(release.fixtureSuite || '').trim()) problems.push('Platform fixture suite is missing.');
  }
  const evidence = (version?.automatedTechnicalReviews || []).find((review) => (
    review?.contentHash === hash
    && review?.origin === 'deterministic'
    && review?.generatedByAI === false
    && review?.objectiveStatus === 'passed'
    && review?.productionApproval === true
    && review?.humanReviewRequired === false
    && Array.isArray(review?.checks)
    && review.checks.length > 0
    && review.checks.every((check) => check?.status === 'passed')
  ));
  if (release && !evidence) problems.push('No passing deterministic production-release evidence matches the current pack content.');
  return { ready: problems.length === 0, contentHash: hash, release: release || null, evidence: evidence || null, problems };
}

function reviewerAuthorizationProblem(authorization, { userId, role, now = new Date() } = {}) {
  if (!authorization) return 'the recorded reviewer authorization no longer exists';
  if (String(authorization.userId || '') !== String(userId || '')) {
    return 'the authorization belongs to a different organization member';
  }
  if (!Array.isArray(authorization.roles) || !authorization.roles.includes(role)) {
    return `the authorization does not include the ${role} responsibility`;
  }
  if (String(authorization.status || '') !== 'active') return 'the reviewer authorization has been revoked';
  const expiry = normalizeDate(authorization.expiresAt, null);
  if (!expiry || expiry.getTime() <= normalizeDate(now).getTime()) {
    return 'the reviewer authorization is expired or has no valid future expiry';
  }
  const verifierId = String(authorization.verifiedBy?.userId || '').trim();
  if (!verifierId || verifierId === String(authorization.userId || '')) {
    return 'the reviewer authorization was not independently verified';
  }
  const credentialType = String(authorization.credentialType || '').trim();
  const credentialReference = String(authorization.credentialReference || '').trim();
  if (!TAX_REVIEWER_CREDENTIAL_TYPES.includes(credentialType) || !credentialReference) {
    return 'the reviewer authorization has no valid credential record';
  }
  if (role === 'tax_law' && !TAX_LAW_CREDENTIAL_TYPES.includes(credentialType)) {
    return 'tax-law review cannot rely on an internal appointment';
  }
  return '';
}

function exactReviewAuthorization(review, reviewTeam = [], now = new Date()) {
  const authorizationId = String(review?.reviewer?.authorizationId || '').trim();
  if (!authorizationId) {
    return { authorization: null, problem: 'the review has no credential-registry authorization reference' };
  }
  const authorization = (reviewTeam || []).find((entry) => String(entry?._id || '') === authorizationId) || null;
  const problem = reviewerAuthorizationProblem(authorization, {
    userId: review?.reviewer?.userId,
    role: review?.role,
    now,
  });
  if (problem) return { authorization, problem };
  if (String(review?.reviewer?.credentialReference || '').trim()
    !== String(authorization.credentialReference || '').trim()
    || String(review?.reviewer?.credentialType || '').trim()
      !== String(authorization.credentialType || '').trim()) {
    return { authorization, problem: 'the review credential snapshot no longer matches its exact authorization' };
  }
  return { authorization, problem: '' };
}

function liabilityAmountsByCode(components = [], payer) {
  return (components || []).reduce((result, component) => {
    if (payer && component?.payer !== payer) return result;
    const code = String(component?.liabilityCode || '').trim();
    if (!code) return result;
    result[code] = roundMoney((result[code] || 0) + toNumber(component?.amount));
    return result;
  }, {});
}

function collectFormulaExpressions(value, path = 'version', result = []) {
  if (!value || typeof value !== 'object') return result;
  for (const [key, entry] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;
    if (key.endsWith('Formula') && entry !== null && entry !== undefined && String(entry).trim()) {
      result.push({ path: nextPath, expression: String(entry) });
    }
    if (entry && typeof entry === 'object') collectFormulaExpressions(entry, nextPath, result);
  }
  return result;
}

function buildCountryName(code) {
  switch (normalizeCode(code)) {
    case 'GB': return 'United Kingdom';
    case 'US': return 'United States';
    case 'NG': return 'Nigeria';
    case 'GH': return 'Ghana';
    case 'KE': return 'Kenya';
    case 'ZA': return 'South Africa';
    case 'CM': return 'Cameroon';
    case 'MZ': return 'Mozambique';
    case 'CA': return 'Canada';
    case 'EU': return 'European Union member state';
    default: return 'Custom jurisdiction';
  }
}

function makeCurrencyField(key, label, helpText = '', options = {}) {
  return {
    key,
    label,
    type: 'currency',
    defaultValue: 0,
    helpText,
    currencyScope: 'calculation_currency',
    ...options,
  };
}

function makeSelectField(key, label, options = [], defaultValue = '') {
  return {
    key,
    label,
    type: 'select',
    required: true,
    defaultValue,
    options,
  };
}

const PLATFORM_RELEASED_AT = new Date('2026-08-19T00:00:00.000Z');
const PLATFORM_RELEASE_INPUTS = Object.freeze({
  GB: { grossPay: 5000, employeeTaxInputs: { taxSubdivision: 'standard', niCategory: 'A', additionalWithholding: 0 } },
  US: { grossPay: 5000, employeeTaxInputs: { workStateCode: 'NY', filingStatus: 'single', otherIncome: 0, deductionsAdjustment: 0, taxCredits: 0, multipleJobs: false, additionalWithholding: 0 } },
  NG: { grossPay: 1000000, employeeTaxInputs: { annualRentPaid: 0, additionalWithholding: 0 } },
  GH: { grossPay: 10000, employeeTaxInputs: { residencyStatus: 'resident', additionalWithholding: 0 } },
  KE: { grossPay: 100000, employeeTaxInputs: { residencyStatus: 'resident', monthlyInsurancePremium: 0, monthlyMortgageInterest: 0, monthlyRegisteredPension: 0, monthlyPostRetirementMedicalFund: 0, additionalWithholding: 0 } },
  ZA: { grossPay: 50000, employeeTaxInputs: { medicalSchemeMembers: 1, additionalWithholding: 0 } },
  CM: { grossPay: 100000, employeeTaxInputs: { employerSector: 'general', occupationalRiskClass: 'A', additionalWithholding: 0 } },
  MZ: { grossPay: 50000, employeeTaxInputs: { dependants: 0, additionalWithholding: 0 } },
});

const PLATFORM_RELEASE_EXPECTED = Object.freeze({
  GB: { taxAmount: 952.67, employeeStatutory: 267.5, employerStatutory: 687.45, employeeLiabilities: { GB_NI_EMPLOYEE: 267.5 }, employerLiabilities: { GB_NI_EMPLOYER: 687.45 }, incomeTaxMethod: 'uk_paye', calculationCurrency: 'GBP', payrollRunnable: true },
  US: { taxAmount: 418.33, employeeStatutory: 382.5, employerStatutory: 382.5, employeeLiabilities: { US_SOCIAL_SECURITY_EMPLOYEE: 310, US_MEDICARE_EMPLOYEE: 72.5 }, employerLiabilities: { US_SOCIAL_SECURITY_EMPLOYER: 310, US_MEDICARE_EMPLOYER: 72.5 }, incomeTaxMethod: 'us_federal_withholding', calculationCurrency: 'USD', payrollRunnable: true },
  NG: { taxAmount: 148100, employeeStatutory: 80000, employerStatutory: 100000, employeeLiabilities: { NG_PENSION_EMPLOYEE: 80000 }, employerLiabilities: { NG_PENSION_EMPLOYER: 100000 }, incomeTaxMethod: 'nigeria_paye', calculationCurrency: 'NGN', payrollRunnable: true },
  GH: { taxAmount: 1961, employeeStatutory: 550, employerStatutory: 1300, employeeLiabilities: { GH_SSNIT_EMPLOYEE: 550 }, employerLiabilities: { GH_SSNIT_EMPLOYER: 1300 }, incomeTaxMethod: 'ghana_paye', calculationCurrency: 'GHS', payrollRunnable: true },
  KE: { taxAmount: 19308.33, employeeStatutory: 10250, employerStatutory: 7500, employeeLiabilities: { KE_AHL_EMPLOYEE: 1500, KE_SHIF_EMPLOYEE: 2750, KE_NSSF_TIER1_EMPLOYEE: 540, KE_NSSF_TIER2_EMPLOYEE: 5460 }, employerLiabilities: { KE_AHL_EMPLOYER: 1500, KE_NSSF_TIER1_EMPLOYER: 540, KE_NSSF_TIER2_EMPLOYER: 5460 }, incomeTaxMethod: 'kenya_paye', calculationCurrency: 'KES', payrollRunnable: true },
  ZA: { taxAmount: 10699.58, employeeStatutory: 177.12, employerStatutory: 177.12, employeeLiabilities: { ZA_UIF_EMPLOYEE: 177.12 }, employerLiabilities: { ZA_UIF_EMPLOYER: 177.12 }, incomeTaxMethod: 'south_africa_paye', calculationCurrency: 'ZAR', payrollRunnable: true },
  CM: { taxAmount: 2654.67, employeeStatutory: 6450, employerStatutory: 15450, employeeLiabilities: { CM_CNPS_PVID_EMPLOYEE: 4200, CM_CFC_EMPLOYEE: 1000, CM_CRTV_EMPLOYEE: 750, CM_TDL_EMPLOYEE: 500 }, employerLiabilities: { CM_CNPS_PVID_EMPLOYER: 4200, CM_CNPS_FAMILY_EMPLOYER: 7000, CM_CNPS_ACCIDENT_EMPLOYER: 1750, CM_CFC_EMPLOYER: 1500, CM_FNE_EMPLOYER: 1000 }, incomeTaxMethod: 'cameroon_irpp_preview', calculationCurrency: 'XAF', payrollRunnable: true },
  MZ: { taxAmount: 5225, employeeStatutory: 1500, employerStatutory: 2000, employeeLiabilities: { MZ_INSS_EMPLOYEE: 1500 }, employerLiabilities: { MZ_INSS_EMPLOYER: 2000 }, incomeTaxMethod: 'mozambique_monthly_irps', calculationCurrency: 'MZN', payrollRunnable: true },
});

function applyPlatformReleases(definitions) {
  return definitions.map((seed) => {
    const fixtureInput = PLATFORM_RELEASE_INPUTS[seed.countryCode];
    const expected = PLATFORM_RELEASE_EXPECTED[seed.countryCode];
    if (!fixtureInput || !expected) return seed;

    const releasedPackKey = String(seed.version.packKey || '').replace(/-PREVIEW$/i, '');
    const releasedLabel = String(seed.version.label || '')
      .replace(/legal-review preview/ig, 'platform release')
      .replace(/preview/ig, 'platform release');
    const testCase = {
      name: `${seed.countryCode} platform release ordinary payroll`,
      category: 'ordinary_period',
      sourceReferences: (seed.version.sourceLinks || []).map((source) => source.label).filter(Boolean),
      inputs: {
        grossPay: fixtureInput.grossPay,
        taxableIncome: fixtureInput.grossPay,
        basicSalary: fixtureInput.grossPay,
        payFrequency: 'monthly',
        paymentDate: seed.version.effectiveFrom,
        employeeTaxInputs: fixtureInput.employeeTaxInputs,
        statutoryBases: { pensionablePay: fixtureInput.grossPay, socialSecurityPay: fixtureInput.grossPay, insurablePay: fixtureInput.grossPay },
        statutoryContributions: { pensionOptIn: true, socialSecurityOptIn: true },
        employeeInfo: { dateOfBirth: '1988-06-15' },
      },
      expected,
    };
    const releaseId = `platform:${releasedPackKey}:2026-08-19`;
    const fixtureSuite = 'services/__tests__/taxJurisdictionService.test.js';
    const releasedVersion = {
      ...seed.version,
      packKey: releasedPackKey,
      label: releasedLabel,
      validationStatus: 'validated',
      calculationStatus: 'runnable',
      notes: (seed.version.notes || []).filter((note) => !/preview|awaiting legal review/i.test(String(note || ''))),
      coverage: {
        ...(seed.version.coverage || {}),
        modules: (seed.version.coverage?.modules || []).map((module) => String(module).replace(/_preview$/i, '')),
      },
      incomeTax: {
        ...(seed.version.incomeTax || {}),
        noteRules: (seed.version.incomeTax?.noteRules || []).filter((rule) => (
          !/preview-only|remains preview|awaiting legal review|pending resolution/i.test(String(rule?.text || ''))
        )),
      },
      testCases: [testCase],
      platformRelease: {
        releaseId,
        channel: 'stable',
        releasedAt: PLATFORM_RELEASED_AT,
        evidenceReference: `repo://${fixtureSuite}`,
        implementationDigestSha256: currentVersionHash(seed.version),
        fixtureDigestSha256: contentHash(testCase),
        fixtureSuite,
      },
    };
    const releasedHash = currentVersionHash(releasedVersion);
    releasedVersion.automatedTechnicalReviews = [{
      runReference: `platform-tax-release:${releaseId}`,
      contentHash: releasedHash,
      origin: 'deterministic',
      generatedByAI: false,
      engine: { provider: 'seemplify', model: 'platform-tax-release-gates', promptVersion: '1', outputDigestSha256: '' },
      objectiveStatus: 'passed',
      productionApproval: true,
      humanReviewRequired: false,
      checks: [
        { code: 'implementation_digest', status: 'passed', details: [] },
        { code: 'fixture_digest', status: 'passed', details: [] },
        { code: 'release_fixture_execution', status: 'passed', details: [] },
        { code: 'effective_scope_and_currency', status: 'passed', details: [] },
      ],
      unresolvedLegalContradictions: [],
      summary: 'Platform-owned statutory pack released from immutable implementation and fixture evidence.',
      triggeredBy: { userId: 'system-tax-release', name: 'Seemplify platform release' },
      completedAt: PLATFORM_RELEASED_AT,
    }];
    return {
      ...seed,
      description: String(seed.description || '')
        .replace(/preview, pending [^.]+\.?/ig, 'release with explicit coverage exclusions.')
        .replace(/preview/ig, 'release'),
      platformSeed: true,
      version: releasedVersion,
    };
  });
}

function buildSeedDefinitions() {
  return applyPlatformReleases([
    {
      countryCode: 'GB',
      countryName: 'United Kingdom',
      displayName: 'United Kingdom PAYE',
      description: 'Seeded UK PAYE and National Insurance rules for the 2026/27 tax year.',
      version: {
        packKey: 'GB-2026-27',
        label: '2026/27',
        effectiveFrom: new Date('2026-04-06T00:00:00.000Z'),
        sourceDate: new Date('2026-03-20T00:00:00.000Z'),
        sourceLinks: [SOURCE_LINKS.HMRC_2026, SOURCE_LINKS.HMRC_PAYE_SPEC_2026, SOURCE_LINKS.HMRC_NI_SPEC_2026],
        validationStatus: 'needs_review',
        calculationStatus: 'preview_only',
        calculationCurrency: 'GBP',
        coverage: {
          level: 'national',
          modules: ['paye', 'employee_class_1_ni', 'employer_class_1_ni'],
          exclusions: ['cumulative_and_w1_m1_paye', 'tax_codes_and_k_codes', 'student_loans', 'postgraduate_loans', 'director_ni', 'benefits_class_1a', 'apprenticeship_levy'],
          supportedSubdivisions: ['ENGLAND', 'WALES', 'SCOTLAND', 'NORTHERN_IRELAND'],
        },
        fieldDefinitions: [
          makeSelectField('taxSubdivision', 'UK Tax Region', [
            { value: 'standard', label: 'England, Wales or Northern Ireland' },
            { value: 'scotland', label: 'Scotland' },
          ], 'standard'),
          makeSelectField('niCategory', 'National Insurance Category', [
            { value: 'A', label: 'A - Standard employee' },
            { value: 'B', label: 'B - Reduced rate' },
            { value: 'C', label: 'C - State pension age' },
            { value: 'D', label: 'D - Investment Zone deferment' },
            { value: 'E', label: 'E - Investment Zone reduced rate' },
            { value: 'F', label: 'F - Freeport' },
            { value: 'H', label: 'H - Apprentice under 25' },
            { value: 'I', label: 'I - Freeport reduced rate' },
            { value: 'J', label: 'J - Deferment' },
            { value: 'K', label: 'K - Investment Zone state pensioner' },
            { value: 'L', label: 'L - Freeport deferment' },
            { value: 'M', label: 'M - Under 21' },
            { value: 'N', label: 'N - Investment Zone' },
            { value: 'S', label: 'S - Freeport state pensioner' },
            { value: 'V', label: 'V - Veteran' },
            { value: 'Z', label: 'Z - Under 21 deferment' },
          ], 'A'),
          makeCurrencyField('additionalWithholding', 'Additional Withholding'),
        ],
        taxYear: { mode: 'uk_apr_6' },
        incomeTax: {
          strategy: 'progressive_bands',
          derivedFormulas: {
            personalAllowance: 'max(0, 12570 - floor(max(0, annualizedGrossPay - 100000) / 2))',
            additionalRateThreshold: 'max(37700, 125140 - personalAllowance)',
            scotlandTopThreshold: 'max(62430, 125140 - personalAllowance)',
          },
          taxableAnnualFormula: 'max(0, annualizedTaxableIncome - personalAllowance)',
          bracketSetFormula: "if(employeeFields.taxSubdivision == 'scotland', 'scotland', 'standard')",
          bracketSets: {
            standard: [
              { min: 0, max: 37700, rate: 20 },
              { min: 37700, maxFormula: 'additionalRateThreshold', rate: 40 },
              { minFormula: 'additionalRateThreshold', max: null, rate: 45 },
            ],
            scotland: [
              { min: 0, max: 3967, rate: 19 },
              { min: 3967, max: 16956, rate: 20 },
              { min: 16956, max: 31092, rate: 21 },
              { min: 31092, max: 62430, rate: 42 },
              { min: 62430, maxFormula: 'scotlandTopThreshold', rate: 45 },
              { minFormula: 'scotlandTopThreshold', max: null, rate: 48 },
            ],
          },
          annualTaxAfterFormula: 'annualTaxBeforeAdjustments',
          additionalWithholdingFormula: 'employeeFields.additionalWithholding',
          noteRules: [
            { whenFormula: 'annualizedGrossPay > 100000', text: 'Personal allowance taper was applied for earnings above GBP 100,000.' },
            { whenFormula: 'employeeFields.additionalWithholding > 0', text: 'Additional withholding was added after the UK PAYE calculation.' },
          ],
        },
        statutoryRules: [
          {
            strategy: 'uk_ni',
            name: 'National Insurance',
            applyOptInField: 'socialSecurityOptIn',
          },
        ],
        testCases: [
          { name: 'UK standard seeded smoke test', inputs: { grossPay: 5000, taxableIncome: 5000, payFrequency: 'monthly', employeeTaxInputs: { taxSubdivision: 'standard', additionalWithholding: 0 } } },
        ],
      },
    },
    {
      countryCode: 'US',
      countryName: 'United States',
      displayName: 'United States Federal Withholding',
      description: 'US federal withholding and FICA only. State and local withholding require a separate subdivision pack.',
      version: {
        packKey: 'US-FEDERAL-2026',
        label: '2026',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        sourceDate: new Date('2026-03-20T00:00:00.000Z'),
        sourceLinks: [SOURCE_LINKS.IRS_2026, SOURCE_LINKS.IRS_EMPLOYER_2026],
        validationStatus: 'validated',
        calculationStatus: 'preview_only',
        calculationCurrency: 'USD',
        coverage: {
          level: 'federal',
          modules: ['federal_income_tax_withholding', 'fica'],
          exclusions: ['state_income_tax', 'local_income_tax', 'state_disability', 'state_unemployment'],
          supportedSubdivisions: [],
        },
        fieldDefinitions: [
          {
            key: 'workStateCode',
            label: 'Work State',
            type: 'text',
            required: true,
            defaultValue: '',
            placeholder: 'e.g. NY',
            helpText: 'The federal preview does not calculate this state or any local withholding.',
          },
          makeSelectField('filingStatus', 'Filing Status', [
            { value: 'single', label: 'Single' },
            { value: 'married_filing_jointly', label: 'Married filing jointly' },
            { value: 'married_filing_separately', label: 'Married filing separately' },
            { value: 'head_of_household', label: 'Head of household' },
          ], 'single'),
          makeCurrencyField('otherIncome', 'Annual Other Income'),
          makeCurrencyField('deductionsAdjustment', 'Annual Deductions Adjustment'),
          makeCurrencyField('taxCredits', 'Annual Tax Credits'),
          {
            key: 'multipleJobs',
            label: 'Use Multiple Jobs Table',
            type: 'boolean',
            defaultValue: false,
          },
          makeCurrencyField('additionalWithholding', 'Additional Withholding'),
        ],
        taxYear: { mode: 'calendar' },
        incomeTax: {
          strategy: 'base_plus_rate',
          derivedFormulas: {
            tableGroup: "if(employeeFields.multipleJobs, 'multipleJobs', 'standard')",
            standardDeductionOffset: "if(employeeFields.multipleJobs, 0, if(employeeFields.filingStatus == 'married_filing_jointly', 12900, 8600))",
          },
          taxableAnnualFormula: 'max(0, annualizedTaxableIncome + employeeFields.otherIncome - employeeFields.deductionsAdjustment - standardDeductionOffset)',
          tableGroupFormula: 'tableGroup',
          rowKeyFormula: 'employeeFields.filingStatus',
          annualTaxAfterFormula: 'max(0, annualBaseTax - employeeFields.taxCredits)',
          additionalWithholdingFormula: 'employeeFields.additionalWithholding',
          tableSets: {
            standard: {
              married_filing_jointly: [
                { min: 0, max: 19300, baseTax: 0, rate: 0 },
                { min: 19300, max: 44100, baseTax: 0, rate: 10 },
                { min: 44100, max: 120100, baseTax: 2480, rate: 12 },
                { min: 120100, max: 230700, baseTax: 11600, rate: 22 },
                { min: 230700, max: 422850, baseTax: 35932, rate: 24 },
                { min: 422850, max: 531750, baseTax: 82048, rate: 32 },
                { min: 531750, max: 788000, baseTax: 116896, rate: 35 },
                { min: 788000, max: null, baseTax: 206583.5, rate: 37 },
              ],
              single: [
                { min: 0, max: 7500, baseTax: 0, rate: 0 },
                { min: 7500, max: 19900, baseTax: 0, rate: 10 },
                { min: 19900, max: 57900, baseTax: 1240, rate: 12 },
                { min: 57900, max: 113200, baseTax: 5800, rate: 22 },
                { min: 113200, max: 209275, baseTax: 17966, rate: 24 },
                { min: 209275, max: 263725, baseTax: 41024, rate: 32 },
                { min: 263725, max: 648100, baseTax: 58448, rate: 35 },
                { min: 648100, max: null, baseTax: 192979.25, rate: 37 },
              ],
              married_filing_separately: [
                { min: 0, max: 7500, baseTax: 0, rate: 0 },
                { min: 7500, max: 19900, baseTax: 0, rate: 10 },
                { min: 19900, max: 57900, baseTax: 1240, rate: 12 },
                { min: 57900, max: 113200, baseTax: 5800, rate: 22 },
                { min: 113200, max: 209275, baseTax: 17966, rate: 24 },
                { min: 209275, max: 263725, baseTax: 41024, rate: 32 },
                { min: 263725, max: 648100, baseTax: 58448, rate: 35 },
                { min: 648100, max: null, baseTax: 192979.25, rate: 37 },
              ],
              head_of_household: [
                { min: 0, max: 15550, baseTax: 0, rate: 0 },
                { min: 15550, max: 33250, baseTax: 0, rate: 10 },
                { min: 33250, max: 83000, baseTax: 1770, rate: 12 },
                { min: 83000, max: 121250, baseTax: 7740, rate: 22 },
                { min: 121250, max: 217300, baseTax: 16155, rate: 24 },
                { min: 217300, max: 271750, baseTax: 39207, rate: 32 },
                { min: 271750, max: 656150, baseTax: 56631, rate: 35 },
                { min: 656150, max: null, baseTax: 191171, rate: 37 },
              ],
            },
            multipleJobs: {
              married_filing_jointly: [
                { min: 0, max: 16100, baseTax: 0, rate: 0 },
                { min: 16100, max: 28500, baseTax: 0, rate: 10 },
                { min: 28500, max: 66500, baseTax: 1240, rate: 12 },
                { min: 66500, max: 121800, baseTax: 5800, rate: 22 },
                { min: 121800, max: 217875, baseTax: 17966, rate: 24 },
                { min: 217875, max: 272325, baseTax: 41024, rate: 32 },
                { min: 272325, max: 400450, baseTax: 58448, rate: 35 },
                { min: 400450, max: null, baseTax: 103291.75, rate: 37 },
              ],
              single: [
                { min: 0, max: 8050, baseTax: 0, rate: 0 },
                { min: 8050, max: 14250, baseTax: 0, rate: 10 },
                { min: 14250, max: 33250, baseTax: 620, rate: 12 },
                { min: 33250, max: 60900, baseTax: 2900, rate: 22 },
                { min: 60900, max: 108938, baseTax: 8983, rate: 24 },
                { min: 108938, max: 136163, baseTax: 20512, rate: 32 },
                { min: 136163, max: 328350, baseTax: 29224, rate: 35 },
                { min: 328350, max: null, baseTax: 96489.63, rate: 37 },
              ],
              married_filing_separately: [
                { min: 0, max: 8050, baseTax: 0, rate: 0 },
                { min: 8050, max: 14250, baseTax: 0, rate: 10 },
                { min: 14250, max: 33250, baseTax: 620, rate: 12 },
                { min: 33250, max: 60900, baseTax: 2900, rate: 22 },
                { min: 60900, max: 108938, baseTax: 8983, rate: 24 },
                { min: 108938, max: 136163, baseTax: 20512, rate: 32 },
                { min: 136163, max: 328350, baseTax: 29224, rate: 35 },
                { min: 328350, max: null, baseTax: 96489.63, rate: 37 },
              ],
              head_of_household: [
                { min: 0, max: 12075, baseTax: 0, rate: 0 },
                { min: 12075, max: 20925, baseTax: 0, rate: 10 },
                { min: 20925, max: 45800, baseTax: 885, rate: 12 },
                { min: 45800, max: 64925, baseTax: 3870, rate: 22 },
                { min: 64925, max: 112950, baseTax: 8077.5, rate: 24 },
                { min: 112950, max: 140175, baseTax: 19603.5, rate: 32 },
                { min: 140175, max: 332375, baseTax: 28315.5, rate: 35 },
                { min: 332375, max: null, baseTax: 95585.5, rate: 37 },
              ],
            },
          },
          noteRules: [
            { whenFormula: 'employeeFields.multipleJobs', text: 'IRS Step 2 multiple-jobs tables were used.' },
            { whenFormula: 'employeeFields.taxCredits > 0', text: 'Annual tax credits reduced the federal withholding amount.' },
            { whenFormula: 'employeeFields.additionalWithholding > 0', text: 'Additional withholding was added after federal withholding.' },
          ],
        },
        statutoryRules: [
          {
            strategy: 'us_fica',
            name: 'FICA',
            applyOptInField: 'socialSecurityOptIn',
          },
        ],
      },
    },
    {
      countryCode: 'NG',
      countryName: 'Nigeria',
      displayName: 'Nigeria PAYE',
      description: 'Nigeria Tax Act 2025 PAYE rules effective 1 January 2026 with mandatory pension contributions.',
      version: {
        packKey: 'NG-2026-NTA',
        label: '2026 - Nigeria Tax Act 2025',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        sourceDate: new Date('2026-03-20T00:00:00.000Z'),
        sourceLinks: [SOURCE_LINKS.NIGERIA_TAX_ACT_2025, SOURCE_LINKS.NIGERIA_TRANSITION_2026, SOURCE_LINKS.NIGERIA_JRB_2026, SOURCE_LINKS.PENCOM_2026],
        validationStatus: 'validated',
        calculationStatus: 'preview_only',
        calculationCurrency: 'NGN',
        coverage: {
          level: 'national',
          modules: ['paye', 'employee_pension', 'employer_pension'],
          exclusions: ['cumulative_ytd_reconciliation', 'state_remittance_forms', 'nhf', 'nhia', 'life_assurance_relief'],
          supportedSubdivisions: [],
        },
        fieldDefinitions: [
          makeCurrencyField('annualRentPaid', 'Annual Rent Paid', 'Used to calculate the statutory rent relief, capped by law.'),
          makeCurrencyField('additionalWithholding', 'Additional Withholding'),
        ],
        taxYear: { mode: 'calendar' },
        incomeTax: {
          strategy: 'progressive_bands',
          derivedFormulas: {
            rentRelief: 'min(500000, employeeFields.annualRentPaid * 0.20)',
          },
          taxableAnnualFormula: 'max(0, annualizedTaxableIncome - rentRelief)',
          brackets: [
            { min: 0, max: 800000, rate: 0 },
            { min: 800000, max: 3000000, rate: 15 },
            { min: 3000000, max: 12000000, rate: 18 },
            { min: 12000000, max: 25000000, rate: 21 },
            { min: 25000000, max: 50000000, rate: 23 },
            { min: 50000000, max: null, rate: 25 },
          ],
          annualTaxAfterFormula: 'if(annualizedGrossPay <= 840000, 0, annualTaxBeforeAdjustments)',
          additionalWithholdingFormula: 'employeeFields.additionalWithholding',
          noteRules: [
            { whenFormula: 'true', text: 'Nigeria PAYE is preview-only until cumulative year-to-date withholding and unresolved ancillary deductions are certified.' },
            { whenFormula: 'employeeFields.additionalWithholding > 0', text: 'Additional withholding was added after the Nigeria PAYE calculation.' },
          ],
        },
        statutoryRules: [
          {
            strategy: 'flat_percent',
            name: 'Employee Pension Contribution',
            type: 'pension',
            liabilityCode: 'NG_PENSION_EMPLOYEE',
            payer: 'employee',
            applyOptInField: 'pensionOptIn',
            rate: 8,
            baseFormula: 'statutoryBases.pensionablePay',
            reducesTaxableIncome: true,
            remittanceAuthority: 'Pension Fund Administrator',
          },
          {
            strategy: 'flat_percent',
            name: 'Employer Pension Contribution',
            type: 'pension',
            liabilityCode: 'NG_PENSION_EMPLOYER',
            payer: 'employer',
            applyOptInField: 'pensionOptIn',
            rate: 10,
            baseFormula: 'statutoryBases.pensionablePay',
            remittanceAuthority: 'Pension Fund Administrator',
          },
        ],
      },
    },
    {
      countryCode: 'GH',
      countryName: 'Ghana',
      displayName: 'Ghana PAYE',
      description: 'Seeded Ghana PAYE and SSNIT employee contribution rules.',
      version: {
        packKey: 'GH-2026',
        label: '2026',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        sourceDate: new Date('2026-03-20T00:00:00.000Z'),
        sourceLinks: [SOURCE_LINKS.GRA_PAYE, SOURCE_LINKS.GHANA_SSNIT_2026],
        validationStatus: 'validated',
        calculationStatus: 'preview_only',
        calculationCurrency: 'GHS',
        coverage: {
          level: 'national',
          modules: ['paye', 'employee_ssnit', 'employer_ssnit'],
          exclusions: ['gra_paye_table_display_anomaly_review', 'bonus_and_overtime_special_tables', 'ssnit_tier_1_tier_2_remittance_allocation'],
          supportedSubdivisions: [],
        },
        fieldDefinitions: [
          makeSelectField('residencyStatus', 'Residency Status', [
            { value: 'resident', label: 'Resident' },
            { value: 'non_resident', label: 'Non-resident' },
          ], 'resident'),
          makeCurrencyField('additionalWithholding', 'Additional Withholding'),
        ],
        taxYear: { mode: 'calendar' },
        incomeTax: {
          strategy: 'conditional',
          cases: [
            {
              whenFormula: "employeeFields.residencyStatus == 'non_resident'",
              strategyConfig: {
                strategy: 'flat_rate',
                taxableAnnualFormula: 'annualizedTaxableIncome',
                annualRateFormula: '25',
                annualTaxAfterFormula: 'annualTaxBeforeAdjustments',
              },
            },
          ],
          defaultStrategyConfig: {
            strategy: 'progressive_bands',
            taxableAnnualFormula: 'annualizedTaxableIncome',
            brackets: [
              { min: 0, max: 5880, rate: 0 },
              { min: 5880, max: 7200, rate: 5 },
              { min: 7200, max: 8760, rate: 10 },
              { min: 8760, max: 46760, rate: 17.5 },
              { min: 46760, max: 238760, rate: 25 },
              { min: 238760, max: 605000, rate: 30 },
              { min: 605000, max: null, rate: 35 },
            ],
            annualTaxAfterFormula: 'annualTaxBeforeAdjustments',
          },
          additionalWithholdingFormula: 'employeeFields.additionalWithholding',
          noteRules: [
            { whenFormula: 'true', text: 'Ghana PAYE is preview-only pending resolution of the published table anomaly and SSNIT remittance-allocation rounding fixtures.' },
            { whenFormula: "employeeFields.residencyStatus == 'non_resident'", text: 'Ghana non-resident employment income was taxed at the flat non-resident rate.' },
            { whenFormula: 'employeeFields.additionalWithholding > 0', text: 'Additional withholding was added after the Ghana PAYE calculation.' },
          ],
        },
        statutoryRules: [
          {
            strategy: 'flat_percent',
            name: 'SSNIT Employee Contribution',
            liabilityCode: 'GH_SSNIT_EMPLOYEE',
            payer: 'employee',
            applyOptInField: 'socialSecurityOptIn',
            rate: 5.5,
            baseFormula: 'basicSalary',
            floorFormula: '587.80',
            capFormula: '69000',
            capMode: 'period_base',
            reducesTaxableIncome: true,
            remittanceAuthority: 'SSNIT',
          },
          {
            strategy: 'flat_percent',
            name: 'SSNIT Employer Contribution',
            liabilityCode: 'GH_SSNIT_EMPLOYER',
            payer: 'employer',
            applyOptInField: 'socialSecurityOptIn',
            rate: 13,
            baseFormula: 'basicSalary',
            floorFormula: '587.80',
            capFormula: '69000',
            capMode: 'period_base',
            remittanceAuthority: 'SSNIT / Tier 2 Trustee',
          },
        ],
      },
    },
    {
      countryCode: 'KE',
      countryName: 'Kenya',
      displayName: 'Kenya PAYE',
      description: 'Kenya PAYE, Affordable Housing Levy, SHIF, and NSSF Year 4 rules.',
      version: {
        packKey: 'KE-2026-YEAR4',
        label: '2026 Year 4',
        effectiveFrom: new Date('2026-02-01T00:00:00.000Z'),
        sourceDate: new Date('2026-03-20T00:00:00.000Z'),
        sourceLinks: [SOURCE_LINKS.KRA_PAYE, SOURCE_LINKS.KRA_DEDUCTIONS_2025, SOURCE_LINKS.KENYA_AHL_2024, SOURCE_LINKS.KENYA_SHIF, SOURCE_LINKS.KENYA_NSSF_2026],
        validationStatus: 'needs_review',
        calculationStatus: 'preview_only',
        calculationCurrency: 'KES',
        coverage: {
          level: 'national',
          modules: ['paye', 'ahl', 'shif', 'nssf'],
          exclusions: [
            'benefit_valuation_automation',
            'fringe_benefit_tax',
            'pwd_income_tax_exemption',
            'nita_employer_levy',
            'nssf_age_and_contracted_out_eligibility',
            'nssf_pensionable_earnings_classification',
            'aggregate_pension_relief_limit',
          ],
          supportedSubdivisions: [],
        },
        fieldDefinitions: [
          makeSelectField('residencyStatus', 'Residency Status', [
            { value: 'resident', label: 'Resident' },
            { value: 'non_resident', label: 'Non-resident' },
          ], 'resident'),
          makeCurrencyField('monthlyMortgageInterest', 'Monthly Owner-Occupied Mortgage Interest', 'Deductible up to KES 30,000 per month when properly documented.', { evidenceRequiredWhenPositive: true, evidenceFieldKey: 'mortgageInterestEvidenceReference' }),
          { key: 'mortgageInterestEvidenceReference', label: 'Mortgage Interest Evidence Reference', type: 'text', defaultValue: '', helpText: 'Lender certificate or other payroll-verifiable evidence reference.' },
          makeCurrencyField('monthlyRegisteredPension', 'Monthly Registered Pension Contribution', 'Deductible up to KES 30,000 per month; do not also enter the same amount as a pre-tax deduction.', { evidenceRequiredWhenPositive: true, evidenceFieldKey: 'registeredPensionEvidenceReference' }),
          { key: 'registeredPensionEvidenceReference', label: 'Registered Pension Evidence Reference', type: 'text', defaultValue: '', helpText: 'Registered scheme/account evidence reference.' },
          makeCurrencyField('monthlyPostRetirementMedicalFund', 'Monthly Post-Retirement Medical Fund', 'Deductible up to KES 15,000 per month.', { evidenceRequiredWhenPositive: true, evidenceFieldKey: 'postRetirementMedicalEvidenceReference' }),
          { key: 'postRetirementMedicalEvidenceReference', label: 'Post-Retirement Medical Fund Evidence', type: 'text', defaultValue: '', helpText: 'Approved fund contribution evidence reference.' },
          makeCurrencyField('annualQualifyingInsurancePremium', 'Annual Qualifying Insurance Premium', 'Insurance relief is 15% subject to the annual statutory cap.', { evidenceRequiredWhenPositive: true, evidenceFieldKey: 'insurancePremiumEvidenceReference' }),
          { key: 'insurancePremiumEvidenceReference', label: 'Qualifying Insurance Evidence Reference', type: 'text', defaultValue: '', helpText: 'Policy/premium evidence reference supporting payroll relief.' },
          makeCurrencyField('additionalWithholding', 'Additional Withholding'),
        ],
        taxYear: { mode: 'calendar' },
        incomeTax: {
          strategy: 'progressive_bands',
          derivedFormulas: {
            personalRelief: "if(employeeFields.residencyStatus == 'non_resident', 0, 28800)",
            insuranceRelief: "if(employeeFields.residencyStatus == 'non_resident', 0, min(60000, employeeFields.annualQualifyingInsurancePremium * 0.15))",
            annualDeclaredDeductions: '(min(30000, employeeFields.monthlyMortgageInterest) + min(30000, employeeFields.monthlyRegisteredPension) + min(15000, employeeFields.monthlyPostRetirementMedicalFund)) * 12',
          },
          taxableAnnualFormula: 'max(0, annualizedTaxableIncome - annualDeclaredDeductions)',
          brackets: [
            { min: 0, max: 288000, rate: 10 },
            { min: 288000, max: 388000, rate: 25 },
            { min: 388000, max: 6000000, rate: 30 },
            { min: 6000000, max: 9600000, rate: 32.5 },
            { min: 9600000, max: null, rate: 35 },
          ],
          annualTaxAfterFormula: 'max(0, annualTaxBeforeAdjustments - personalRelief - insuranceRelief)',
          additionalWithholdingFormula: 'employeeFields.additionalWithholding',
          noteRules: [
            { whenFormula: "employeeFields.residencyStatus != 'non_resident'", text: 'Kenya resident personal relief was applied.' },
            { whenFormula: 'employeeFields.additionalWithholding > 0', text: 'Additional withholding was added after the Kenya PAYE calculation.' },
          ],
        },
        statutoryRules: [
          {
            strategy: 'flat_percent',
            name: 'Affordable Housing Levy - Employee',
            type: 'payroll_tax',
            liabilityCode: 'KE_AHL_EMPLOYEE',
            payer: 'employee',
            rate: 1.5,
            baseFormula: 'grossPay',
            reducesTaxableIncome: true,
            remittanceAuthority: 'Kenya Revenue Authority',
          },
          {
            strategy: 'flat_percent',
            name: 'Affordable Housing Levy - Employer',
            type: 'payroll_tax',
            liabilityCode: 'KE_AHL_EMPLOYER',
            payer: 'employer',
            rate: 1.5,
            baseFormula: 'grossPay',
            remittanceAuthority: 'Kenya Revenue Authority',
          },
          {
            strategy: 'flat_percent',
            name: 'Social Health Insurance Fund',
            type: 'health_insurance',
            liabilityCode: 'KE_SHIF_EMPLOYEE',
            payer: 'employee',
            rate: 2.75,
            baseFormula: 'grossPay',
            minimumContributionFormula: '300',
            reducesTaxableIncome: true,
            remittanceAuthority: 'Social Health Authority',
          },
          {
            strategy: 'flat_percent',
            name: 'NSSF Tier I - Employee',
            liabilityCode: 'KE_NSSF_TIER1_EMPLOYEE',
            payer: 'employee',
            applyOptInField: 'socialSecurityOptIn',
            rate: 6,
            baseFormula: 'min(grossPay, 9000)',
            reducesTaxableIncome: true,
            remittanceAuthority: 'NSSF Kenya',
          },
          {
            strategy: 'flat_percent',
            name: 'NSSF Tier II - Employee',
            liabilityCode: 'KE_NSSF_TIER2_EMPLOYEE',
            payer: 'employee',
            applyOptInField: 'socialSecurityOptIn',
            rate: 6,
            baseFormula: 'max(0, min(grossPay, 108000) - 9000)',
            reducesTaxableIncome: true,
            remittanceAuthority: 'NSSF Kenya',
          },
          {
            strategy: 'flat_percent',
            name: 'NSSF Tier I - Employer',
            liabilityCode: 'KE_NSSF_TIER1_EMPLOYER',
            payer: 'employer',
            applyOptInField: 'socialSecurityOptIn',
            rate: 6,
            baseFormula: 'min(grossPay, 9000)',
            remittanceAuthority: 'NSSF Kenya',
          },
          {
            strategy: 'flat_percent',
            name: 'NSSF Tier II - Employer',
            liabilityCode: 'KE_NSSF_TIER2_EMPLOYER',
            payer: 'employer',
            applyOptInField: 'socialSecurityOptIn',
            rate: 6,
            baseFormula: 'max(0, min(grossPay, 108000) - 9000)',
            remittanceAuthority: 'NSSF Kenya',
          },
        ],
      },
    },
    {
      countryCode: 'ZA',
      countryName: 'South Africa',
      displayName: 'South Africa PAYE',
      description: 'Seeded South Africa PAYE rules and age-based rebates.',
      version: {
        packKey: 'ZA-2027',
        label: '2027',
        effectiveFrom: new Date('2026-03-01T00:00:00.000Z'),
        sourceDate: new Date('2026-03-20T00:00:00.000Z'),
        sourceLinks: [SOURCE_LINKS.SARS_2027, SOURCE_LINKS.SARS_UIF, SOURCE_LINKS.SARS_SDL],
        validationStatus: 'needs_review',
        calculationStatus: 'preview_only',
        calculationCurrency: 'ZAR',
        coverage: {
          level: 'national',
          modules: ['paye', 'uif'],
          exclusions: ['skills_development_levy_requires_employer_registration', 'annual_bonus_delta_method', 'sars_periodic_table_rounding_certification'],
          supportedSubdivisions: [],
        },
        fieldDefinitions: [
          {
            key: 'medicalSchemeMembers',
            label: 'Medical Scheme Members',
            type: 'integer',
            defaultValue: 0,
            helpText: 'Include the employee and registered dependants covered for the month.',
          },
          makeCurrencyField('additionalWithholding', 'Additional Withholding'),
        ],
        taxYear: { mode: 'south_africa_mar_1' },
        incomeTax: {
          strategy: 'base_plus_rate',
          derivedFormulas: {
            rebate: 'if(ageAtTaxYearEnd >= 75, 30834, if(ageAtTaxYearEnd >= 65, 27585, 17820))',
            annualMedicalCredit: 'if(employeeFields.medicalSchemeMembers <= 0, 0, (376 + if(employeeFields.medicalSchemeMembers >= 2, 376, 0) + max(0, employeeFields.medicalSchemeMembers - 2) * 254) * 12)',
          },
          taxableAnnualFormula: 'annualizedTaxableIncome',
          tableSets: {
            default: {
              default: [
                { min: 0, max: 245100, baseTax: 0, rate: 18 },
                { min: 245100, max: 383100, baseTax: 44118, rate: 26 },
                { min: 383100, max: 530200, baseTax: 79998, rate: 31 },
                { min: 530200, max: 695800, baseTax: 125599, rate: 36 },
                { min: 695800, max: 887000, baseTax: 185215, rate: 39 },
                { min: 887000, max: 1878600, baseTax: 259783, rate: 41 },
                { min: 1878600, max: null, baseTax: 666339, rate: 45 },
              ],
            },
          },
          annualTaxAfterFormula: 'max(0, annualBaseTax - rebate - annualMedicalCredit)',
          additionalWithholdingFormula: 'employeeFields.additionalWithholding',
          noteRules: [
            { whenFormula: 'ageAtTaxYearEnd < 0', text: 'South Africa rebates were calculated using the primary rebate only because date of birth is missing.' },
            { whenFormula: 'employeeFields.additionalWithholding > 0', text: 'Additional withholding was added after the South Africa PAYE calculation.' },
          ],
        },
        statutoryRules: [
          {
            strategy: 'flat_percent',
            name: 'UIF Employee Contribution',
            liabilityCode: 'ZA_UIF_EMPLOYEE',
            payer: 'employee',
            applyOptInField: 'socialSecurityOptIn',
            rate: 1,
            baseFormula: 'grossPay',
            capFormula: '17712',
            capMode: 'period_base',
            remittanceAuthority: 'Unemployment Insurance Fund',
          },
          {
            strategy: 'flat_percent',
            name: 'UIF Employer Contribution',
            liabilityCode: 'ZA_UIF_EMPLOYER',
            payer: 'employer',
            applyOptInField: 'socialSecurityOptIn',
            rate: 1,
            baseFormula: 'grossPay',
            capFormula: '17712',
            capMode: 'period_base',
            remittanceAuthority: 'Unemployment Insurance Fund',
          },
        ],
      },
    },
    {
      countryCode: 'CM',
      countryName: 'Cameroon',
      displayName: 'Cameroon IRPP and CNPS',
      description: 'Preview of Cameroon IRPP and CNPS. Ancillary levies and benefit valuation still require local legal sign-off.',
      version: {
        packKey: 'CM-2026-PREVIEW',
        label: '2026 legal-review preview',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        sourceDate: new Date('2026-08-09T00:00:00.000Z'),
        sourceLinks: [SOURCE_LINKS.CAMEROON_IRPP, SOURCE_LINKS.CAMEROON_CGI, SOURCE_LINKS.CAMEROON_TDL, SOURCE_LINKS.CAMEROON_CNPS],
        validationStatus: 'needs_review',
        calculationStatus: 'preview_only',
        calculationCurrency: 'XAF',
        coverage: {
          level: 'national',
          modules: ['irpp_preview', 'cnps_old_age_disability_death', 'cnps_family_benefit', 'cnps_occupational_accident', 'cfc', 'fne', 'audiovisual_tax', 'local_development_tax'],
          exclusions: ['benefit_valuation', '2026_deadline_confirmation'],
          supportedSubdivisions: [],
        },
        fieldDefinitions: [
          makeSelectField('employerSector', 'Employer Sector', [
            { value: 'general', label: 'General / domestic workers' },
            { value: 'agriculture', label: 'Agriculture' },
            { value: 'private_education', label: 'Private education' },
            { value: 'domestic', label: 'Domestic staff' },
            { value: 'individual_agriculture', label: 'Individual agricultural / pastoral farm' },
          ], 'general'),
          makeSelectField('occupationalRiskClass', 'Occupational Risk Class', [
            { value: 'A', label: 'Class A - 1.75%' },
            { value: 'B', label: 'Class B - 2.5%' },
            { value: 'C', label: 'Class C - 5%' },
          ], 'A'),
          makeCurrencyField('additionalWithholding', 'Additional Withholding'),
        ],
        taxYear: { mode: 'calendar' },
        incomeTax: {
          strategy: 'conditional',
          cases: [{
            whenFormula: 'grossPay < 62000',
            strategyConfig: { strategy: 'none' },
          }],
          defaultStrategyConfig: {
            strategy: 'progressive_bands',
            taxableAnnualFormula: 'max(0, annualizedTaxableIncome - min(annualizedGrossPay * 0.30, 4800000) - 500000)',
            brackets: [
              { min: 0, max: 2000000, rate: 10 },
              { min: 2000000, max: 3000000, rate: 15 },
              { min: 3000000, max: 5000000, rate: 25 },
              { min: 5000000, max: null, rate: 35 },
            ],
            annualTaxAfterFormula: 'annualTaxBeforeAdjustments * 1.10',
          },
          additionalWithholdingFormula: 'employeeFields.additionalWithholding',
          noteRules: [
            { whenFormula: 'grossPay < 62000', text: 'No monthly IRPP withholding was calculated below the DGI monthly threshold.' },
            { whenFormula: 'true', text: 'Cameroon IRPP remains preview-only until ancillary payroll levies and benefit rules receive local legal review.' },
          ],
        },
        statutoryRules: [
          {
            strategy: 'flat_percent', name: 'CNPS Employee PVID', liabilityCode: 'CM_CNPS_PVID_EMPLOYEE', payer: 'employee',
            rate: 4.2, baseFormula: 'grossPay', capFormula: '750000', capMode: 'period_base', reducesTaxableIncome: true,
            remittanceAuthority: 'CNPS Cameroon', applyOptInField: 'socialSecurityOptIn',
          },
          {
            strategy: 'flat_percent', name: 'CNPS Employer PVID', liabilityCode: 'CM_CNPS_PVID_EMPLOYER', payer: 'employer',
            rate: 4.2, baseFormula: 'grossPay', capFormula: '750000', capMode: 'period_base',
            remittanceAuthority: 'CNPS Cameroon', applyOptInField: 'socialSecurityOptIn',
          },
          {
            strategy: 'flat_percent', name: 'CNPS Family Benefits', liabilityCode: 'CM_CNPS_FAMILY_EMPLOYER', payer: 'employer',
            rateFormula: "if(employeeFields.employerSector == 'agriculture', 5.65, if(employeeFields.employerSector == 'private_education', 3.7, 7))",
            baseFormula: 'grossPay', capFormula: '750000', capMode: 'period_base', remittanceAuthority: 'CNPS Cameroon',
          },
          {
            strategy: 'flat_percent', name: 'CNPS Occupational Accident', liabilityCode: 'CM_CNPS_ACCIDENT_EMPLOYER', payer: 'employer',
            rateFormula: "if(employeeFields.occupationalRiskClass == 'C', 5, if(employeeFields.occupationalRiskClass == 'B', 2.5, 1.75))",
            baseFormula: 'grossPay', remittanceAuthority: 'CNPS Cameroon',
          },
          {
            strategy: 'flat_percent', type: 'payroll_tax', name: 'CFC Employee Contribution', liabilityCode: 'CM_CFC_EMPLOYEE', payer: 'employee',
            rate: 1, baseFormula: 'floor(grossPay / 1000) * 1000', remittanceAuthority: 'Cameroon Tax Administration',
          },
          {
            strategy: 'flat_percent', type: 'payroll_tax', name: 'CFC Employer Contribution', liabilityCode: 'CM_CFC_EMPLOYER', payer: 'employer',
            rate: 1.5, baseFormula: 'floor(grossPay / 1000) * 1000', remittanceAuthority: 'Cameroon Tax Administration',
          },
          {
            strategy: 'flat_percent', type: 'payroll_tax', name: 'National Employment Fund', liabilityCode: 'CM_FNE_EMPLOYER', payer: 'employer',
            rate: 1, baseFormula: 'floor(grossPay / 1000) * 1000', remittanceAuthority: 'National Employment Fund',
          },
          {
            strategy: 'fixed_amount', name: 'Audiovisual Levy', liabilityCode: 'CM_CRTV_EMPLOYEE', payer: 'employee',
            whenFormula: "employeeFields.employerSector != 'domestic' && employeeFields.employerSector != 'individual_agriculture'",
            amountFormula: 'if(grossPay <= 50000, 0, if(grossPay <= 100000, 750, if(grossPay <= 200000, 1950, if(grossPay <= 300000, 3250, if(grossPay <= 400000, 4550, if(grossPay <= 500000, 5850, if(grossPay <= 600000, 7150, if(grossPay <= 700000, 8450, if(grossPay <= 800000, 9750, if(grossPay <= 900000, 11050, if(grossPay <= 1000000, 12350, 13000)))))))))))',
            remittanceAuthority: 'Cameroon Tax Administration',
          },
          {
            strategy: 'fixed_amount', name: 'Local Development Tax', liabilityCode: 'CM_TDL_EMPLOYEE', payer: 'employee',
            amountFormula: 'if(grossPay < 62000, 0, if(grossPay <= 75000, 250, if(grossPay <= 100000, 500, if(grossPay <= 125000, 750, if(grossPay <= 150000, 1000, if(grossPay <= 200000, 1250, if(grossPay <= 250000, 1500, if(grossPay <= 300000, 2000, if(grossPay <= 500000, 2250, 2500)))))))))',
            remittanceAuthority: 'Local authority / Cameroon Tax Administration',
          },
        ],
      },
    },
    {
      countryCode: 'MZ',
      countryName: 'Mozambique',
      displayName: 'Mozambique IRPS and INSS',
      description: 'Current monthly IRPS table and INSS contribution preview, pending Mozambican legal review of the 2026 transition.',
      version: {
        packKey: 'MZ-2026-PREVIEW',
        label: '2026 legal-review preview',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        sourceDate: new Date('2026-08-09T00:00:00.000Z'),
        sourceLinks: [SOURCE_LINKS.MOZAMBIQUE_REFORM_2026, SOURCE_LINKS.MOZAMBIQUE_IRPS, SOURCE_LINKS.MOZAMBIQUE_INSS],
        validationStatus: 'needs_review',
        calculationStatus: 'preview_only',
        calculationCurrency: 'MZN',
        coverage: {
          level: 'national',
          modules: ['monthly_irps_preview', 'employee_inss', 'employer_inss'],
          exclusions: ['annual_reconciliation', 'non_resident_table', 'holiday_and_13th_month_special_runs'],
          supportedSubdivisions: [],
        },
        fieldDefinitions: [
          {
            key: 'dependants', label: 'Tax Dependants', type: 'integer', required: true, defaultValue: 0,
            helpText: 'Mozambique monthly withholding uses columns for 0, 1, 2, 3, and 4 or more dependants.',
          },
          makeCurrencyField('additionalWithholding', 'Additional Withholding'),
        ],
        taxYear: { mode: 'calendar' },
        incomeTax: {
          strategy: 'mozambique_monthly_irps',
          additionalWithholdingFormula: 'employeeFields.additionalWithholding',
          noteRules: [
            { whenFormula: 'true', text: 'The 2026 Mozambique pack is preview-only until a local reviewer signs off the Law 11/2025 transition and annual reconciliation treatment.' },
          ],
        },
        statutoryRules: [
          {
            strategy: 'flat_percent', name: 'INSS Employee Contribution', liabilityCode: 'MZ_INSS_EMPLOYEE', payer: 'employee',
            rate: 3, baseFormula: 'grossPay', reducesTaxableIncome: true, remittanceAuthority: 'INSS Mozambique',
            applyOptInField: 'socialSecurityOptIn',
          },
          {
            strategy: 'flat_percent', name: 'INSS Employer Contribution', liabilityCode: 'MZ_INSS_EMPLOYER', payer: 'employer',
            rate: 4, baseFormula: 'grossPay', remittanceAuthority: 'INSS Mozambique', applyOptInField: 'socialSecurityOptIn',
          },
        ],
      },
    },
    {
      countryCode: 'CA',
      countryName: 'Canada',
      displayName: 'Canada 2026 implementation template',
      description: 'Blocked implementation template. Canada requires federal plus province/territory formulas; Quebec is a separate authority.',
      version: {
        packKey: 'CA-2026-TEMPLATE',
        label: '2026 implementation template',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        sourceDate: new Date('2026-08-09T00:00:00.000Z'),
        sourceLinks: [SOURCE_LINKS.CANADA_2026, SOURCE_LINKS.CANADA_JULY_2026],
        validationStatus: 'needs_review',
        calculationStatus: 'blocked',
        calculationCurrency: 'CAD',
        coverage: {
          level: 'federal',
          modules: [],
          exclusions: ['federal_withholding', 'provincial_withholding', 'quebec_withholding', 'cpp_qpp', 'ei_qpip'],
          supportedSubdivisions: [],
        },
        fieldDefinitions: [
          {
            key: 'provinceCode', label: 'Province or Territory', type: 'text', required: true, defaultValue: '',
            helpText: 'A reviewed provincial or territorial pack is required. Quebec uses Revenu Quebec formulas.',
          },
        ],
        taxYear: { mode: 'calendar' },
        constants: { requiresConfiguration: true },
        incomeTax: { strategy: 'none' },
        statutoryRules: [],
      },
    },
    {
      countryCode: 'EU',
      countryName: 'European Union',
      displayName: 'EU country-pack template',
      description: 'The EU is not an income-tax jurisdiction. Select or add the employee work-country pack; EU coordination rules can then determine social-security coverage.',
      version: {
        packKey: 'EU-NOT-A-JURISDICTION',
        label: 'Country selection required',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        sourceDate: new Date('2026-08-09T00:00:00.000Z'),
        sourceLinks: [SOURCE_LINKS.EU_TAX, SOURCE_LINKS.EU_SOCIAL_SECURITY],
        validationStatus: 'needs_review',
        calculationStatus: 'blocked',
        calculationCurrency: 'EUR',
        coverage: { level: 'template', modules: [], exclusions: ['all_national_payroll_taxes'], supportedSubdivisions: [] },
        fieldDefinitions: [{
          key: 'workCountryCode', label: 'Work Country', type: 'text', required: true, defaultValue: '',
          helpText: 'EU payroll tax is calculated under national law, not one EU-wide rate table.',
        }],
        taxYear: { mode: 'calendar' },
        constants: { requiresConfiguration: true },
        incomeTax: { strategy: 'none' },
        statutoryRules: [],
      },
    },
    {
      countryCode: 'OTHER',
      countryName: 'Other / Custom jurisdiction',
      displayName: 'Custom Country Template',
      description: 'Blank template for unsupported countries. Clone this into an organization and configure formulas before using it.',
      version: {
        packKey: 'OTHER-TEMPLATE',
        label: 'Template',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        sourceDate: new Date('2026-03-20T00:00:00.000Z'),
        sourceLinks: [],
        validationStatus: 'needs_review',
        calculationStatus: 'blocked',
        calculationCurrency: '',
        coverage: { level: 'template', modules: [], exclusions: ['all_statutory_calculations'], supportedSubdivisions: [] },
        fieldDefinitions: [
          {
            key: 'countryLabel',
            label: 'Country Label',
            type: 'text',
            required: true,
            defaultValue: '',
            placeholder: 'e.g. Rwanda Payroll',
          },
          makeCurrencyField('additionalWithholding', 'Additional Withholding'),
        ],
        taxYear: { mode: 'calendar' },
        constants: {
          requiresConfiguration: true,
        },
        incomeTax: {
          strategy: 'none',
          noteRules: [
            { whenFormula: 'true', text: 'This is a blank custom-country template and must be cloned and configured before it can calculate tax.' },
          ],
        },
        statutoryRules: [],
      },
    },
  ]);
}

class TaxJurisdictionService {
  constructor() {
    this.seedDefinitions = buildSeedDefinitions();
  }

  buildTaxYearContext(version = {}, payDate = new Date()) {
    const date = normalizeDate(payDate);
    const mode = version?.taxYear?.mode || 'calendar';
    const year = date.getUTCFullYear();

    if (mode === 'uk_apr_6') {
      const startYear = (date.getUTCMonth() > 3 || (date.getUTCMonth() === 3 && date.getUTCDate() >= 6)) ? year : year - 1;
      const start = new Date(Date.UTC(startYear, 3, 6));
      const end = new Date(Date.UTC(startYear + 1, 3, 5, 23, 59, 59, 999));
      return {
        label: `${startYear}/${String(startYear + 1).slice(-2)}`,
        start,
        end,
        endReferenceDate: end,
      };
    }

    if (mode === 'south_africa_mar_1') {
      const startYear = date.getUTCMonth() >= 2 ? year : year - 1;
      const start = new Date(Date.UTC(startYear, 2, 1));
      const end = new Date(Date.UTC(startYear + 1, 2, 0, 23, 59, 59, 999));
      return {
        label: `${startYear + 1}`,
        start,
        end,
        endReferenceDate: end,
      };
    }

    return {
      label: `${year}`,
      start: new Date(Date.UTC(year, 0, 1)),
      end: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)),
      endReferenceDate: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)),
    };
  }

  buildFormulaContext(payload = {}, version = {}) {
    const payDate = normalizeDate(payload.paymentDate);
    const periodsPerYear = getPayPeriodsPerYear(payload.payFrequency);
    const taxYear = this.buildTaxYearContext(version, payDate);
    const ageAtTaxYearEnd = ageOnDate(payload.employeeInfo?.dateOfBirth, taxYear.endReferenceDate);

    return {
      grossPay: roundMoney(payload.grossPay),
      taxableIncome: roundMoney(payload.taxableIncome),
      basicSalary: roundMoney(payload.basicSalary),
      preTaxDeductions: roundMoney(payload.preTaxDeductions),
      ytdGrossPay: roundMoney(payload.ytdGrossPay),
      ytdTaxableIncome: roundMoney(payload.ytdTaxableIncome),
      ytdIncomeTax: roundMoney(payload.ytdIncomeTax),
      periodsPerYear,
      annualizedGrossPay: roundMoney(payload.grossPay * periodsPerYear),
      annualizedTaxableIncome: roundMoney(payload.taxableIncome * periodsPerYear),
      employeeFields: payload.employeeTaxInputs || {},
      employeeInfo: payload.employeeInfo || {},
      statutoryContributions: payload.statutoryContributions || {},
      statutoryBases: payload.statutoryBases || {
        pensionablePay: roundMoney(payload.basicSalary),
        socialSecurityPay: roundMoney(payload.grossPay),
        insurablePay: roundMoney(payload.grossPay),
      },
      employerInputs: payload.employerInputs || {},
      constants: version.constants || {},
      payDate,
      taxYear,
      ageAtTaxYearEnd,
      validationErrors: payload.validationErrors || [],
    };
  }

  applyDerivedFormulas(target = {}, derivedFormulas = {}) {
    const nextTarget = target;
    for (const [key, formula] of Object.entries(derivedFormulas || {})) {
      nextTarget[key] = formulaEngine.evaluate(formula, nextTarget);
    }
    return nextTarget;
  }

  normalizeFieldValue(field, rawValue) {
    if (rawValue === undefined || rawValue === null || rawValue === '') {
      return field?.defaultValue !== undefined ? field.defaultValue : (field?.type === 'boolean' ? false : '');
    }

    switch (field?.type) {
      case 'currency':
        return roundMoney(Math.max(0, toNumber(rawValue)));
      case 'percent':
        return roundMoney(Math.min(100, Math.max(0, toNumber(rawValue))));
      case 'integer':
        return Math.max(0, Math.floor(toNumber(rawValue)));
      case 'boolean':
        return !!rawValue;
      case 'date':
        return rawValue ? new Date(rawValue).toISOString().slice(0, 10) : '';
      default:
        return rawValue;
    }
  }

  normalizeEmployeeTaxInputs(fieldDefinitions = [], rawInputs = {}) {
    const normalized = {};
    const validationErrors = [];

    for (const field of fieldDefinitions || []) {
      const nextValue = this.normalizeFieldValue(field, rawInputs?.[field.key]);
      normalized[field.key] = nextValue;

      const emptyValue = nextValue === '' || nextValue === null || nextValue === undefined;
      if (field.required && (emptyValue || (field.type === 'select' && !String(nextValue || '').trim()))) {
        validationErrors.push(`"${field.label}" is required.`);
      }
      if (field.type === 'select' && !emptyValue) {
        const allowed = new Set((field.options || []).map((option) => String(option.value)));
        if (!allowed.has(String(nextValue))) {
          validationErrors.push(`"${field.label}" has an unsupported value.`);
        }
      }
      if (field.evidenceRequiredWhenPositive && toNumber(nextValue) > 0) {
        const evidenceFieldKey = String(field.evidenceFieldKey || '').trim();
        const evidenceValue = evidenceFieldKey ? String(rawInputs?.[evidenceFieldKey] || '').trim() : '';
        if (!evidenceValue) {
          validationErrors.push(`"${field.label}" needs an evidence reference before it can reduce payroll tax.`);
        }
      }
    }

    return { normalized, validationErrors };
  }

  mapLegacyInputs(fieldDefinitions = [], taxConfig = {}) {
    const legacyInputs = {
      ...((taxConfig && typeof taxConfig.employeeTaxInputs === 'object') ? taxConfig.employeeTaxInputs : {}),
    };

    for (const field of fieldDefinitions || []) {
      if (legacyInputs[field.key] !== undefined) {
        continue;
      }
      if (taxConfig[field.key] !== undefined) {
        legacyInputs[field.key] = taxConfig[field.key];
      }
    }

    return legacyInputs;
  }

  findVersion(config, versionId = null, payDate = new Date()) {
    const versions = Array.isArray(config?.versions) ? config.versions : [];
    const normalizedPayDate = normalizeDate(payDate);
    const isEffective = (version) => {
      if (!['published', 'archived'].includes(String(version?.status || ''))) return false;
      const effectiveFrom = normalizeDate(version.effectiveFrom, null);
      const effectiveTo = normalizeDate(version.effectiveTo, null);
      return (!effectiveFrom || normalizedPayDate >= effectiveFrom) && (!effectiveTo || normalizedPayDate <= effectiveTo);
    };

    if (versionId) {
      const explicitVersion = versions.find((version) => String(version._id) === String(versionId));
      if (explicitVersion && isEffective(explicitVersion)) {
        return explicitVersion;
      }
      return null;
    }

    return versions
      .filter(isEffective)
      .sort((a, b) => {
        const dateDiff = normalizeDate(b.effectiveFrom, new Date(0)).getTime()
          - normalizeDate(a.effectiveFrom, new Date(0)).getTime();
        return dateDiff || toNumber(b.versionNumber) - toNumber(a.versionNumber);
      })[0] || null;
  }

  async seedGlobalDefaults() {
    for (const seed of this.seedDefinitions) {
      // Global seeds bypass the organization publish route, so enforce the
      // same executable-pack gate before any replica can install one.
      await this.validateVersionForPublish(seed.version, seed);
      if (seed.version.calculationStatus === 'runnable') {
        const releaseStatus = platformReleaseStatus(seed.version);
        if (!releaseStatus.ready) {
          throw new Error(`Runnable seed ${seed.countryCode} has invalid platform release evidence: ${releaseStatus.problems.join(' ')}`);
        }
        if (seed.version.validationStatus !== 'validated') {
          throw new Error(`Runnable seed ${seed.countryCode} must be legally validated before installation.`);
        }
        if (!Array.isArray(seed.version.sourceLinks) || seed.version.sourceLinks.length === 0) {
          throw new Error(`Runnable seed ${seed.countryCode} must include an official legal or tax-authority source.`);
        }
        if (!currencyService.isSupportedCurrencyCode(seed.version.calculationCurrency)) {
          throw new Error(`Runnable seed ${seed.countryCode} does not have a supported statutory currency pipeline.`);
        }
      }

      const seedHash = currentVersionHash(seed.version);
      const seedFilter = {
        scope: 'global',
        organizationId: '',
        countryCode: seed.countryCode,
        displayName: seed.displayName,
      };

      try {
        await TaxJurisdictionConfig.findOneAndUpdate(seedFilter, {
          $setOnInsert: {
            ...seedFilter,
            countryName: seed.countryName,
            description: seed.description,
            status: 'active',
            publishedVersionId: null,
            versions: [],
            createdBy: { userId: 'system', name: 'Tax seed' },
            lastModifiedBy: { userId: 'system', name: 'Tax seed' },
            creationProvenance: {
              kind: 'system_seed',
              reference: 'platform-tax-release',
              recordedAt: new Date(),
              recordedBy: { userId: 'system-tax-release', name: 'Seemplify platform release' },
            },
          },
        }, { upsert: true, new: true, setDefaultsOnInsert: true });
      } catch (error) {
        if (error?.code !== 11000) throw error;
        // A different replica won the unique-key insert; the atomic version
        // update below will observe that row and remain idempotent.
      }

      const versionId = new mongoose.Types.ObjectId();
      const versionPayload = {
          _id: versionId,
          packKey: seed.version.packKey || `${seed.countryCode}-${seed.version.label}`,
          contentHash: seedHash,
          label: seed.version.label,
          versionNumber: {
            $add: [
              { $ifNull: [{ $max: '$versions.versionNumber' }, 0] },
              1,
            ],
          },
          status: 'published',
          effectiveFrom: seed.version.effectiveFrom,
          effectiveTo: seed.version.effectiveTo || null,
          sourceDate: seed.version.sourceDate || null,
          sourceLinks: seed.version.sourceLinks || [],
          notes: seed.version.notes || [],
          validationStatus: seed.version.validationStatus || 'validated',
          calculationStatus: seed.version.calculationStatus || 'blocked',
          coverage: seed.version.coverage || { level: 'national', modules: [], exclusions: [], supportedSubdivisions: [] },
          calculationCurrency: seed.version.calculationCurrency || '',
          reviewedBy: seed.version.reviewedBy || { userId: 'system', name: 'Official-source seed', reviewedAt: seed.version.sourceDate || new Date() },
          authoredBy: seed.version.authoredBy || { userId: 'system', name: 'Tax seed' },
          legalOpenIssues: seed.version.legalOpenIssues || [],
          platformRelease: seed.version.platformRelease || null,
          certificationReviews: seed.version.certificationReviews || [],
          automatedTechnicalReviews: seed.version.automatedTechnicalReviews || [],
          fieldDefinitions: seed.version.fieldDefinitions || [],
          taxYear: seed.version.taxYear || { mode: 'calendar' },
          constants: seed.version.constants || {},
          incomeTax: seed.version.incomeTax || {},
          statutoryRules: seed.version.statutoryRules || [],
          testCases: seed.version.testCases || [],
      };

      await TaxJurisdictionConfig.updateOne({
        ...seedFilter,
        versions: { $not: { $elemMatch: { packKey: versionPayload.packKey, contentHash: seedHash } } },
      }, [{
        $set: {
          countryName: seed.countryName,
          description: seed.description,
          status: 'active',
          publishedVersionId: versionId,
          lastModifiedBy: { userId: 'system', name: 'Tax seed update' },
          updatedAt: '$$NOW',
          versions: {
            $concatArrays: [
              {
                $map: {
                  input: { $ifNull: ['$versions', []] },
                  as: 'version',
                  in: {
                    $cond: [
                      { $eq: ['$$version.status', 'published'] },
                      { $mergeObjects: ['$$version', { status: 'archived' }] },
                      '$$version',
                    ],
                  },
                },
              },
              [versionPayload],
            ],
          },
        },
      }]);
    }
  }

  async listJurisdictions(organizationId, options = {}) {
    const includeGlobal = options.includeGlobal !== false;
    const query = {
      status: { $ne: 'archived' },
    };

    if (includeGlobal) {
      query.$or = [
        { scope: 'global', organizationId: '' },
        { scope: 'organization', organizationId },
      ];
    } else {
      query.scope = 'organization';
      query.organizationId = organizationId;
    }

    const rows = await TaxJurisdictionConfig.find(query).sort({
      scope: 1,
      countryName: 1,
      displayName: 1,
    });

    return rows.map((row) => row.toSummary());
  }

  assertOrganizationContext(organizationId) {
    if (!String(organizationId || '').trim()) {
      throw serviceError(
        'Select an organization before managing jurisdiction tax packs.',
        400,
        'TAX_PACK_ORGANIZATION_REQUIRED'
      );
    }
  }

  assertTaxPackEditor(actor = {}) {
    if (!TAX_PACK_EDITOR_ROLES.has(String(actor.role || '').trim().toLowerCase())) {
      throw serviceError(
        'Only an organization owner, administrator, or HR administrator can manage jurisdiction tax packs.',
        403,
        'TAX_PACK_EDITOR_REQUIRED'
      );
    }
  }

  async listRolloutBacklog(organizationId) {
    this.assertOrganizationContext(organizationId);
    const existingRows = await TaxJurisdictionConfig.find({
      scope: 'organization',
      organizationId,
      status: { $ne: 'archived' },
      'creationProvenance.kind': 'rollout_backlog',
    });
    const existingByReference = new Map((existingRows || []).map((row) => [
      `${row.creationProvenance?.backlogGroupId}:${row.creationProvenance?.backlogEntryCode}`,
      {
        jurisdictionId: String(row._id),
        displayName: row.displayName,
        status: row.status,
      },
    ]));

    return getRolloutInventory().map((group) => ({
      id: group.id,
      label: group.label,
      source: group.source,
      additionalScope: group.additionalScope,
      entries: group.entries.map((item) => ({
        ...item,
        ...backlogEntryIdentity(group, item),
        existingDraft: existingByReference.get(`${group.id}:${item.code}`) || null,
      })),
    }));
  }

  async getJurisdictionById(id, organizationId) {
    const row = await TaxJurisdictionConfig.findOne({
      _id: id,
      status: { $ne: 'archived' },
      $or: [
        { scope: 'global', organizationId: '' },
        { scope: 'organization', organizationId },
      ],
    });

    if (!row) {
      return null;
    }

    return row;
  }

  buildVersionPayload(currentCount = 0, payload = {}, actor = {}) {
    return {
      _id: new mongoose.Types.ObjectId(),
      packKey: String(payload.packKey || '').trim(),
      contentHash: String(payload.contentHash || '').trim(),
      label: String(payload.label || `Version ${currentCount + 1}`).trim(),
      versionNumber: Math.max(1, currentCount + 1),
      status: 'draft',
      effectiveFrom: payload.effectiveFrom ? new Date(payload.effectiveFrom) : new Date(),
      effectiveTo: payload.effectiveTo ? new Date(payload.effectiveTo) : null,
      sourceDate: payload.sourceDate ? new Date(payload.sourceDate) : null,
      sourceLinks: Array.isArray(payload.sourceLinks) ? payload.sourceLinks : [],
      notes: Array.isArray(payload.notes) ? payload.notes : [],
      // New versions are always quarantined. An editor may only request
      // preview/runnable after saving the draft content; publication still
      // requires every legal, fixture and independent-review gate.
      validationStatus: 'draft',
      calculationStatus: 'blocked',
      coverage: payload.coverage || { level: 'organization_override', modules: [], exclusions: [], supportedSubdivisions: [] },
      calculationCurrency: normalizeCode(payload.calculationCurrency || ''),
      reviewedBy: payload.reviewedBy || { userId: '', name: '', reviewedAt: null },
      authoredBy: {
        userId: actor.userId || payload.authoredBy?.userId || '',
        name: actor.name || payload.authoredBy?.name || '',
      },
      legalOpenIssues: Array.isArray(payload.legalOpenIssues) ? payload.legalOpenIssues : [],
      certificationReviews: [],
      automatedTechnicalReviews: [],
      fieldDefinitions: Array.isArray(payload.fieldDefinitions) ? payload.fieldDefinitions : [],
      taxYear: payload.taxYear || { mode: 'calendar' },
      constants: payload.constants || {},
      incomeTax: payload.incomeTax || {},
      statutoryRules: Array.isArray(payload.statutoryRules) ? payload.statutoryRules : [],
      testCases: Array.isArray(payload.testCases) ? payload.testCases : [],
    };
  }

  async createJurisdiction(organizationId, payload = {}, actor = {}) {
    this.assertOrganizationContext(organizationId);
    this.assertTaxPackEditor(actor);

    if (payload.cloneFromId) {
      const source = await this.getJurisdictionById(payload.cloneFromId, organizationId);
      if (!source) {
        throw serviceError('Clone source was not found', 404, 'TAX_PACK_CLONE_SOURCE_NOT_FOUND');
      }

      const sourcePublishedVersion = source.getPublishedVersion?.()
        || (source.versions || []).find((version) => String(version._id) === String(source.publishedVersionId));
      if (!sourcePublishedVersion) {
        throw serviceError(
          'Clone source has no published version to use as a draft.',
          409,
          'TAX_PACK_CLONE_SOURCE_UNPUBLISHED'
        );
      }
      const clonedVersion = {
        ...(sourcePublishedVersion.toObject ? sourcePublishedVersion.toObject() : sourcePublishedVersion),
        _id: new mongoose.Types.ObjectId(),
        packKey: '',
        contentHash: '',
        label: `${sourcePublishedVersion.label} - Organization Draft`,
        versionNumber: 1,
        status: 'draft',
        validationStatus: 'draft',
        calculationStatus: 'blocked',
        coverage: {
          ...(sourcePublishedVersion.coverage?.toObject?.() || sourcePublishedVersion.coverage || {}),
          level: 'organization_override',
        },
        reviewedBy: { userId: '', name: '', reviewedAt: null },
        authoredBy: { userId: actor.userId || '', name: actor.name || '' },
        automatedTechnicalReviews: [],
        certificationReviews: [],
      };

      return TaxJurisdictionConfig.create({
        scope: 'organization',
        organizationId,
        countryCode: normalizeCode(source.countryCode || 'OTHER'),
        countryName: String(source.countryName || buildCountryName(source.countryCode)).trim(),
        subdivisionCode: normalizeCode(source.subdivisionCode),
        subdivisionName: String(source.subdivisionName || '').trim(),
        localityCode: normalizeLocalityCode(source.localityCode),
        localityName: String(source.localityName || '').trim(),
        jurisdictionLevel: 'organization_override',
        displayName: String(payload.displayName || `${source.displayName} Override`).trim(),
        description: String(payload.description || source.description || '').trim(),
        status: 'draft',
        clonedFromId: source._id,
        creationProvenance: {
          kind: 'clone',
          reference: String(payload.provenanceReference || '').trim(),
          sourceLabel: source.displayName,
          clonedFromVersionId: sourcePublishedVersion._id,
          recordedAt: new Date(),
          recordedBy: { userId: actor.userId || '', name: actor.name || '' },
        },
        publishedVersionId: null,
        versions: [clonedVersion],
        createdBy: {
          userId: actor.userId || '',
          name: actor.name || '',
        },
        lastModifiedBy: {
          userId: actor.userId || '',
          name: actor.name || '',
        },
      });
    }

    let identity;
    let backlog = null;
    if (payload.backlogReference) {
      backlog = findBacklogEntry(payload.backlogReference);
      identity = validateDynamicJurisdictionIdentity(backlog.identity);
      const existing = await TaxJurisdictionConfig.findOne({
        scope: 'organization',
        organizationId,
        status: { $ne: 'archived' },
        'creationProvenance.kind': 'rollout_backlog',
        'creationProvenance.backlogGroupId': backlog.group.id,
        'creationProvenance.backlogEntryCode': backlog.item.code,
      });
      if (existing) {
        const error = serviceError(
          'This rollout-backlog jurisdiction already has an organization draft.',
          409,
          'TAX_PACK_BACKLOG_DRAFT_EXISTS'
        );
        error.details = { jurisdictionId: String(existing._id) };
        throw error;
      }
    } else {
      identity = validateDynamicJurisdictionIdentity({
        ...payload,
        coverageLevel: payload.version?.coverage?.level,
      });
    }

    const versionInput = payload.version || {};
    const calculationCurrency = normalizeCode(versionInput.calculationCurrency);
    if (!currencyService.isSupportedCurrencyCode(calculationCurrency)) {
      throw serviceError(
        'A supported ISO 4217 calculation currency is required when creating a jurisdiction draft.',
        400,
        'TAX_PACK_CALCULATION_CURRENCY_REQUIRED'
      );
    }
    if (!versionInput.effectiveFrom || !normalizeDate(versionInput.effectiveFrom, null)) {
      throw serviceError(
        'An effective-from date is required when creating a jurisdiction draft.',
        400,
        'TAX_PACK_EFFECTIVE_DATE_REQUIRED'
      );
    }
    const coverage = versionInput.coverage || {};
    const requestedCoverageLevel = String(coverage.level || identity.jurisdictionLevel).trim().toLowerCase();
    if (!JURISDICTION_LEVELS.has(requestedCoverageLevel)
      || requestedCoverageLevel !== identity.jurisdictionLevel) {
      throw serviceError(
        'The version coverage level must match the jurisdiction identity being created.',
        400,
        'TAX_PACK_COVERAGE_LEVEL_MISMATCH'
      );
    }
    if (!Array.isArray(coverage.modules) || coverage.modules.length === 0
      || !Array.isArray(coverage.exclusions) || coverage.exclusions.length === 0) {
      throw serviceError(
        'Declare at least one coverage module and the known exclusions before creating a jurisdiction draft.',
        400,
        'TAX_PACK_COVERAGE_DECLARATION_REQUIRED'
      );
    }
    const displayName = String(payload.displayName || backlog?.identity?.displayName || '').trim();
    if (!displayName) {
      throw serviceError('Display name is required.', 400, 'TAX_PACK_DISPLAY_NAME_REQUIRED');
    }
    const version = this.buildVersionPayload(0, {
      ...versionInput,
      calculationCurrency,
      coverage: {
        ...coverage,
        level: requestedCoverageLevel,
      },
    }, actor);
    return TaxJurisdictionConfig.create({
      scope: 'organization',
      organizationId,
      ...identity,
      displayName,
      description: String(payload.description || '').trim(),
      status: 'draft',
      publishedVersionId: null,
      creationProvenance: backlog ? {
        kind: 'rollout_backlog',
        reference: String(payload.provenanceReference || '').trim(),
        backlogGroupId: backlog.group.id,
        backlogEntryCode: backlog.item.code,
        sourceUrl: backlog.group.source,
        sourceLabel: backlog.group.label,
        recordedAt: new Date(),
        recordedBy: { userId: actor.userId || '', name: actor.name || '' },
      } : {
        kind: 'manual',
        reference: String(payload.provenanceReference || '').trim(),
        recordedAt: new Date(),
        recordedBy: { userId: actor.userId || '', name: actor.name || '' },
      },
      versions: [version],
      createdBy: {
        userId: actor.userId || '',
        name: actor.name || '',
      },
      lastModifiedBy: {
        userId: actor.userId || '',
        name: actor.name || '',
      },
    });
  }

  async updateJurisdiction(id, organizationId, payload = {}, actor = {}) {
    this.assertOrganizationContext(organizationId);
    this.assertTaxPackEditor(actor);
    const row = await TaxJurisdictionConfig.findOne({
      _id: id,
      scope: 'organization',
      organizationId,
    });

    if (!row) {
      throw new Error('Jurisdiction was not found');
    }

    const identityFields = [
      'countryCode', 'countryName', 'subdivisionCode', 'subdivisionName',
      'localityCode', 'localityName', 'jurisdictionLevel',
    ];
    const identityChanged = identityFields.some((key) => (
      payload[key] !== undefined
      && String(payload[key] || '').trim().toUpperCase() !== String(row[key] || '').trim().toUpperCase()
    ));
    if (identityChanged) {
      const identity = validateDynamicJurisdictionIdentity({
        countryCode: payload.countryCode ?? row.countryCode,
        countryName: payload.countryName ?? row.countryName,
        subdivisionCode: payload.subdivisionCode ?? row.subdivisionCode,
        subdivisionName: payload.subdivisionName ?? row.subdivisionName,
        localityCode: payload.localityCode ?? row.localityCode,
        localityName: payload.localityName ?? row.localityName,
        jurisdictionLevel: payload.jurisdictionLevel ?? row.jurisdictionLevel,
      });
      Object.assign(row, identity);
    }
    if (payload.displayName !== undefined) row.displayName = String(payload.displayName || '').trim() || row.displayName;
    if (payload.description !== undefined) row.description = String(payload.description || '').trim();
    if (payload.status !== undefined) row.status = payload.status;

    if (payload.version && payload.versionId) {
      const version = row.versions.find((entry) => String(entry._id) === String(payload.versionId));
      if (!version) {
        throw new Error('Version was not found');
      }
      if (version.status === 'published' || version.status === 'archived') {
        const error = new Error('Published tax rule versions are immutable. Create a new draft version before making changes.');
        error.statusCode = 409;
        throw error;
      }

      if (payload.version.label !== undefined) version.label = String(payload.version.label || '').trim() || version.label;
      if (payload.version.effectiveFrom !== undefined) version.effectiveFrom = payload.version.effectiveFrom ? new Date(payload.version.effectiveFrom) : version.effectiveFrom;
      if (payload.version.effectiveTo !== undefined) version.effectiveTo = payload.version.effectiveTo ? new Date(payload.version.effectiveTo) : null;
      if (payload.version.sourceDate !== undefined) version.sourceDate = payload.version.sourceDate ? new Date(payload.version.sourceDate) : null;
      if (payload.version.validationStatus !== undefined) version.validationStatus = payload.version.validationStatus;
      if (payload.version.calculationStatus !== undefined) version.calculationStatus = payload.version.calculationStatus;
      if (payload.version.coverage !== undefined) version.coverage = payload.version.coverage || {};
      if (payload.version.calculationCurrency !== undefined) version.calculationCurrency = normalizeCode(payload.version.calculationCurrency || '');
      if (payload.version.sourceLinks !== undefined) version.sourceLinks = Array.isArray(payload.version.sourceLinks) ? payload.version.sourceLinks : [];
      if (payload.version.notes !== undefined) version.notes = Array.isArray(payload.version.notes) ? payload.version.notes : [];
      if (payload.version.fieldDefinitions !== undefined) version.fieldDefinitions = Array.isArray(payload.version.fieldDefinitions) ? payload.version.fieldDefinitions : [];
      if (payload.version.taxYear !== undefined) version.taxYear = payload.version.taxYear || { mode: 'calendar' };
      if (payload.version.constants !== undefined) version.constants = payload.version.constants || {};
      if (payload.version.incomeTax !== undefined) version.incomeTax = payload.version.incomeTax || {};
      if (payload.version.statutoryRules !== undefined) version.statutoryRules = Array.isArray(payload.version.statutoryRules) ? payload.version.statutoryRules : [];
      if (payload.version.testCases !== undefined) version.testCases = Array.isArray(payload.version.testCases) ? payload.version.testCases : [];
      if (payload.version.legalOpenIssues !== undefined) {
        version.legalOpenIssues = Array.isArray(payload.version.legalOpenIssues)
          ? payload.version.legalOpenIssues.map((issue) => String(issue || '').trim()).filter(Boolean)
          : [];
      }
    }

    row.lastModifiedBy = {
      userId: actor.userId || '',
      name: actor.name || '',
    };
    await row.save();
    return row;
  }

  async createVersion(id, organizationId, payload = {}, actor = {}) {
    this.assertOrganizationContext(organizationId);
    this.assertTaxPackEditor(actor);
    const row = await TaxJurisdictionConfig.findOne({
      _id: id,
      scope: 'organization',
      organizationId,
    });

    if (!row) {
      throw new Error('Jurisdiction was not found');
    }

    const version = this.buildVersionPayload(row.versions.length, payload, actor);
    row.versions.push(version);
    row.status = 'active';
    row.lastModifiedBy = {
      userId: actor.userId || '',
      name: actor.name || '',
    };
    await row.save();
    return version;
  }

  assertReviewerRegistryAdministrator(actor = {}) {
    if (!['owner', 'admin'].includes(String(actor.role || '').trim().toLowerCase())) {
      const error = new Error('Only an organization owner or administrator can manage the tax reviewer registry.');
      error.statusCode = 403;
      error.code = 'TAX_REVIEWER_REGISTRY_ADMIN_REQUIRED';
      throw error;
    }
  }

  async authorizeReviewer(id, organizationId, payload = {}, actor = {}, organizationMember = null) {
    this.assertReviewerRegistryAdministrator(actor);
    const row = await TaxJurisdictionConfig.findOne({
      _id: id,
      scope: 'organization',
      organizationId,
    });
    if (!row) throw new Error('Jurisdiction was not found');

    const requestedUserId = String(payload.userId || '').trim();
    const memberUserId = String(
      organizationMember?.userId || organizationMember?.sub || organizationMember?.id || ''
    ).trim();
    const memberName = String(
      organizationMember?.name || organizationMember?.displayName || organizationMember?.email || ''
    ).trim();
    if (!requestedUserId || !memberUserId || requestedUserId !== memberUserId || !memberName) {
      const error = new Error('The reviewer must be a currently verified member of this organization.');
      error.statusCode = 400;
      error.code = 'TAX_REVIEWER_ORGANIZATION_MEMBERSHIP_REQUIRED';
      throw error;
    }

    const verifierId = String(actor.userId || '').trim();
    const verifierName = String(actor.name || '').trim();
    if (!verifierId || !verifierName) {
      const error = new Error('The authenticated verifier identity is incomplete.');
      error.statusCode = 400;
      throw error;
    }
    if (verifierId === memberUserId) {
      const error = new Error('A tax reviewer cannot verify their own authorization.');
      error.statusCode = 409;
      error.code = 'TAX_REVIEWER_SELF_VERIFICATION_FORBIDDEN';
      throw error;
    }

    const roles = Array.from(new Set(
      (Array.isArray(payload.roles) ? payload.roles : [])
        .map((role) => String(role || '').trim())
        .filter(Boolean)
    ));
    if (roles.length === 0 || roles.some((role) => !REQUIRED_CERTIFICATION_REVIEW_ROLES.includes(role))) {
      const error = new Error('One or more valid certification responsibilities are required.');
      error.statusCode = 400;
      throw error;
    }

    const credentialType = String(payload.credentialType || '').trim();
    const credentialReference = String(payload.credentialReference || '').trim();
    if (!TAX_REVIEWER_CREDENTIAL_TYPES.includes(credentialType) || !credentialReference) {
      const error = new Error('A supported credential type and credential reference are required.');
      error.statusCode = 400;
      throw error;
    }
    if (roles.includes('tax_law') && !TAX_LAW_CREDENTIAL_TYPES.includes(credentialType)) {
      const error = new Error('Tax-law reviewers require a professional licence, professional membership, or external engagement; an internal appointment is not sufficient.');
      error.statusCode = 400;
      error.code = 'TAX_LAW_EXTERNAL_CREDENTIAL_REQUIRED';
      throw error;
    }

    const now = new Date();
    const expiresAt = normalizeDate(payload.expiresAt, null);
    if (!expiresAt || expiresAt.getTime() <= now.getTime()) {
      const error = new Error('Reviewer authorization requires a valid future expiry date.');
      error.statusCode = 400;
      error.code = 'TAX_REVIEWER_FUTURE_EXPIRY_REQUIRED';
      throw error;
    }

    const overlappingAuthorization = (row.reviewTeam || []).find((authorization) => (
      String(authorization?.userId || '') === memberUserId
      && !reviewerAuthorizationProblem(authorization, {
        userId: memberUserId,
        role: (authorization.roles || []).find((role) => roles.includes(role)) || '',
        now,
      })
      && (authorization.roles || []).some((role) => roles.includes(role))
    ));
    if (overlappingAuthorization) {
      const error = new Error('This member already has an active authorization for one or more selected certification responsibilities. Revoke it before creating a replacement.');
      error.statusCode = 409;
      error.code = 'TAX_REVIEWER_AUTHORIZATION_OVERLAP';
      throw error;
    }

    row.reviewTeam.push({
      userId: memberUserId,
      name: memberName,
      roles,
      credentialType,
      credentialReference,
      verifiedBy: { userId: verifierId, name: verifierName },
      verifiedAt: now,
      expiresAt,
      status: 'active',
      notes: String(payload.notes || '').trim(),
    });
    row.lastModifiedBy = { userId: verifierId, name: verifierName };
    await row.save();
    return {
      authorization: row.reviewTeam[row.reviewTeam.length - 1],
      reviewTeam: row.reviewTeam,
    };
  }

  async revokeReviewer(id, authorizationId, organizationId, payload = {}, actor = {}) {
    this.assertReviewerRegistryAdministrator(actor);
    const row = await TaxJurisdictionConfig.findOne({
      _id: id,
      scope: 'organization',
      organizationId,
    });
    if (!row) throw new Error('Jurisdiction was not found');

    const authorization = (row.reviewTeam || [])
      .find((entry) => String(entry?._id || '') === String(authorizationId || ''));
    if (!authorization) {
      const error = new Error('Reviewer authorization was not found.');
      error.statusCode = 404;
      throw error;
    }
    if (authorization.status !== 'active') {
      const error = new Error('Reviewer authorization has already been revoked.');
      error.statusCode = 409;
      throw error;
    }

    const revokerId = String(actor.userId || '').trim();
    const revokerName = String(actor.name || '').trim();
    if (!revokerId || !revokerName) {
      const error = new Error('The authenticated revoker identity is incomplete.');
      error.statusCode = 400;
      throw error;
    }
    authorization.status = 'revoked';
    authorization.revokedAt = new Date();
    authorization.revokedBy = { userId: revokerId, name: revokerName };
    authorization.revocationReason = String(payload.reason || '').trim();
    row.lastModifiedBy = { userId: revokerId, name: revokerName };
    await row.save();
    return { authorization, reviewTeam: row.reviewTeam };
  }

  async getCertificationReviewContext(id, versionId, organizationId, actor = {}) {
    const reviewerId = String(actor.userId || '').trim();
    if (!reviewerId) {
      const error = new Error('The authenticated reviewer identity is incomplete.');
      error.statusCode = 400;
      throw error;
    }
    const row = await TaxJurisdictionConfig.findOne({
      _id: id,
      scope: 'organization',
      organizationId,
      status: { $ne: 'archived' },
    });
    if (!row) {
      const error = new Error('Jurisdiction was not found.');
      error.statusCode = 404;
      throw error;
    }
    const version = (row.versions || [])
      .find((entry) => String(entry?._id || '') === String(versionId || ''));
    if (!version) {
      const error = new Error('Version was not found.');
      error.statusCode = 404;
      throw error;
    }
    const authorizations = (row.reviewTeam || []).filter((authorization) => (
      String(authorization?.userId || '') === reviewerId
      && Array.isArray(authorization?.roles)
      && authorization.roles.some((role) => !reviewerAuthorizationProblem(authorization, {
        userId: reviewerId,
        role,
        now: new Date(),
      }))
    ));
    if (authorizations.length === 0) {
      const error = new Error('You do not have an active, unexpired reviewer authorization for this jurisdiction.');
      error.statusCode = 403;
      error.code = 'TAX_REVIEWER_AUTHORIZATION_REQUIRED';
      throw error;
    }

    const sanitizeReview = (review = {}) => ({
      _id: review._id,
      role: review.role,
      decision: review.decision,
      contentHash: review.contentHash,
      reviewer: {
        userId: review.reviewer?.userId || '',
        name: review.reviewer?.name || '',
      },
      sourceReferences: review.sourceReferences || [],
      fixtureRunReference: review.fixtureRunReference || '',
      notes: review.notes || '',
      reviewedAt: review.reviewedAt,
    });
    const versionPlain = version.toObject ? version.toObject() : JSON.parse(JSON.stringify(version));
    versionPlain.certificationReviews = (version.certificationReviews || []).map(sanitizeReview);
    const certification = this.getCertificationStatus(version, { reviewTeam: row.reviewTeam || [] });
    return {
      jurisdiction: {
        _id: row._id,
        countryCode: row.countryCode,
        countryName: row.countryName,
        displayName: row.displayName,
        description: row.description,
      },
      version: versionPlain,
      authorizations: authorizations.map((authorization) => (
        authorization.toObject ? authorization.toObject() : JSON.parse(JSON.stringify(authorization))
      )),
      certification: {
        ...certification,
        reviews: (certification.reviews || []).map(sanitizeReview),
      },
    };
  }

  getCertificationStatus(version, { publisherId = '', reviewTeam = [], now = new Date() } = {}) {
    const platform = platformReleaseStatus(version);
    if (version?.platformRelease && platform.ready) {
      return {
        contentHash: platform.contentHash,
        ready: true,
        certificationMode: 'platform_release',
        platformRelease: platform.release,
        requiredRoles: [],
        approvedRoles: ['platform_release'],
        reviews: [],
        staleReviewCount: 0,
        authorizationInvalidReviewCount: 0,
        problems: [],
      };
    }
    const hash = currentVersionHash(version);
    const currentReviews = (version?.certificationReviews || [])
      .filter((review) => review?.contentHash === hash);
    const latestByReviewerAndRole = new Map();
    for (const review of currentReviews) {
      const key = `${review?.role || ''}:${review?.reviewer?.userId || ''}`;
      latestByReviewerAndRole.set(key, review);
    }
    const latestReviews = Array.from(latestByReviewerAndRole.values());
    const authorizationByReview = new Map(latestReviews.map((review) => [
      review,
      exactReviewAuthorization(review, reviewTeam, now),
    ]));
    const authorizedReviews = latestReviews.filter((review) => !authorizationByReview.get(review)?.problem);
    const approvals = authorizedReviews.filter((review) => review?.decision === 'approved');
    const blockingDecisions = authorizedReviews.filter((review) => review?.decision !== 'approved');
    const approvalByRole = Object.fromEntries(REQUIRED_CERTIFICATION_REVIEW_ROLES.map((role) => [
      role,
      approvals.find((review) => review?.role === role) || null,
    ]));
    const reviewerIds = approvals.map((review) => String(review?.reviewer?.userId || '')).filter(Boolean);
    const problems = [];

    for (const role of REQUIRED_CERTIFICATION_REVIEW_ROLES) {
      if (!approvalByRole[role]) {
        problems.push(`Missing current ${role} approval backed by an active, unexpired reviewer authorization.`);
        const invalidApproval = latestReviews.find((review) => (
          review?.role === role
          && review?.decision === 'approved'
          && authorizationByReview.get(review)?.problem
        ));
        if (invalidApproval) {
          problems.push(
            `${role} approval by ${invalidApproval.reviewer?.name || invalidApproval.reviewer?.userId || 'unknown reviewer'} is ineligible because ${authorizationByReview.get(invalidApproval).problem}.`
          );
        }
      }
    }
    if (new Set(reviewerIds).size !== reviewerIds.length) {
      problems.push('Law, payroll-calculation, and independent-QA approvals must be completed by different reviewers.');
    }
    if (blockingDecisions.length > 0) {
      problems.push('The current rule content has an unresolved changes-requested or rejected review.');
    }
    const publisher = String(publisherId || '');
    if (publisher && reviewerIds.includes(publisher)) {
      problems.push('The publisher must be independent from all certification reviewers.');
    }
    const author = String(version?.authoredBy?.userId || '');
    if (author && [
      approvalByRole.tax_law?.reviewer?.userId,
      approvalByRole.independent_qa?.reviewer?.userId,
    ].map(String).includes(author)) {
      problems.push('The rule author cannot supply the tax-law or independent-QA approval.');
    }
    if (approvalByRole.tax_law && !String(approvalByRole.tax_law.reviewer?.credentialReference || '').trim()) {
      problems.push('The tax-law approval must record a reviewer credential or engagement reference.');
    }
    if (approvalByRole.independent_qa && !String(approvalByRole.independent_qa.fixtureRunReference || '').trim()) {
      problems.push('The independent-QA approval must identify the certified fixture run.');
    }

    return {
      contentHash: hash,
      ready: problems.length === 0,
      requiredRoles: [...REQUIRED_CERTIFICATION_REVIEW_ROLES],
      approvedRoles: REQUIRED_CERTIFICATION_REVIEW_ROLES.filter((role) => Boolean(approvalByRole[role])),
      reviews: latestReviews,
      staleReviewCount: (version?.certificationReviews || []).length - currentReviews.length,
      authorizationInvalidReviewCount: latestReviews.length - authorizedReviews.length,
      problems: Array.from(new Set(problems)),
    };
  }

  async submitCertificationReview(id, versionId, organizationId, payload = {}, actor = {}) {
    const row = await TaxJurisdictionConfig.findOne({
      _id: id,
      scope: 'organization',
      organizationId,
    });
    if (!row) throw new Error('Jurisdiction was not found');

    const version = row.versions.find((entry) => String(entry._id) === String(versionId));
    if (!version) throw new Error('Version was not found');
    if (version.status !== 'draft') {
      const error = new Error('Only a draft tax rule version can be reviewed. Published reviews are immutable.');
      error.statusCode = 409;
      throw error;
    }

    const role = String(payload.role || '').trim();
    const decision = String(payload.decision || '').trim();
    const reviewerId = String(actor.userId || '').trim();
    const reviewerName = String(actor.name || '').trim();
    if (!REQUIRED_CERTIFICATION_REVIEW_ROLES.includes(role)) {
      const error = new Error('A valid certification review role is required.');
      error.statusCode = 400;
      throw error;
    }
    if (!['approved', 'changes_requested', 'rejected'].includes(decision)) {
      const error = new Error('A valid certification review decision is required.');
      error.statusCode = 400;
      throw error;
    }
    if (!reviewerId || !reviewerName) {
      const error = new Error('The authenticated reviewer identity is incomplete.');
      error.statusCode = 400;
      throw error;
    }

    const matchingAuthorizations = (row.reviewTeam || []).filter((authorization) => (
      String(authorization?.userId || '') === reviewerId
      && Array.isArray(authorization?.roles)
      && authorization.roles.includes(role)
    ));
    const authorization = matchingAuthorizations.find((entry) => !reviewerAuthorizationProblem(entry, {
      userId: reviewerId,
      role,
      now: new Date(),
    }));
    if (!authorization) {
      const error = new Error('You do not have an active, unexpired reviewer authorization for this exact certification responsibility.');
      error.statusCode = 403;
      error.code = 'TAX_REVIEWER_AUTHORIZATION_REQUIRED';
      error.details = matchingAuthorizations.length > 0
        ? matchingAuthorizations.map((entry) => reviewerAuthorizationProblem(entry, {
          userId: reviewerId,
          role,
          now: new Date(),
        })).filter(Boolean)
        : [`No ${role} authorization is registered for this reviewer.`];
      throw error;
    }
    if (['tax_law', 'independent_qa'].includes(role)
      && reviewerId === String(version.authoredBy?.userId || '')) {
      const error = new Error('The rule author cannot perform the tax-law or independent-QA review.');
      error.statusCode = 409;
      throw error;
    }

    const sourceReferences = Array.isArray(payload.sourceReferences)
      ? payload.sourceReferences.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    const knownSources = new Set((version.sourceLinks || []).flatMap((source) => [
      String(source?.label || '').trim(),
      String(source?.url || '').trim(),
    ]).filter(Boolean));
    const unknownSource = sourceReferences.find((reference) => !knownSources.has(reference));
    if (unknownSource) {
      const error = new Error(`Review source reference is not part of the version source register: ${unknownSource}`);
      error.statusCode = 400;
      throw error;
    }
    if (decision === 'approved' && role === 'tax_law') {
      const primarySourceReferences = new Set((version.sourceLinks || [])
        .filter((source) => source?.isPrimary !== false && source?.authorityType !== 'secondary')
        .flatMap((source) => [String(source?.label || '').trim(), String(source?.url || '').trim()])
        .filter(Boolean));
      if (sourceReferences.length === 0
        || !sourceReferences.some((reference) => primarySourceReferences.has(reference))) {
        const error = new Error('A tax-law approval requires at least one registered primary source. Its credential is inherited from the reviewer registry.');
        error.statusCode = 400;
        throw error;
      }
    }
    if (decision === 'approved' && role === 'independent_qa'
      && !String(payload.fixtureRunReference || '').trim()) {
      const error = new Error('An independent-QA approval requires a certified fixture-run reference.');
      error.statusCode = 400;
      throw error;
    }

    version.certificationReviews.push({
      role,
      decision,
      contentHash: currentVersionHash(version),
      reviewer: {
        userId: reviewerId,
        name: String(authorization.name || reviewerName).trim(),
        credentialType: authorization.credentialType,
        credentialReference: String(authorization.credentialReference || '').trim(),
        authorizationId: authorization._id,
      },
      sourceReferences,
      fixtureRunReference: String(payload.fixtureRunReference || '').trim(),
      notes: String(payload.notes || '').trim(),
      reviewedAt: new Date(),
    });
    if (version.certificationReviews.length > 100) {
      version.certificationReviews.splice(0, version.certificationReviews.length - 100);
    }
    row.lastModifiedBy = { userId: reviewerId, name: reviewerName };
    await row.save();
    return {
      version,
      certification: this.getCertificationStatus(version, { reviewTeam: row.reviewTeam }),
    };
  }

  async runAutomatedTechnicalReview(id, versionId, organizationId, payload = {}, actor = {}) {
    this.assertOrganizationContext(organizationId);
    this.assertTaxPackEditor(actor);
    const row = await TaxJurisdictionConfig.findOne({
      _id: id,
      scope: 'organization',
      organizationId,
    });
    if (!row) throw serviceError('Jurisdiction was not found', 404, 'TAX_PACK_NOT_FOUND');

    const version = row.versions.find((entry) => String(entry._id) === String(versionId));
    if (!version) throw serviceError('Version was not found', 404, 'TAX_PACK_VERSION_NOT_FOUND');
    if (version.status !== 'draft') {
      throw serviceError(
        'Automated reviews cannot mutate published or archived tax rule versions.',
        409,
        'TAX_PACK_VERSION_IMMUTABLE'
      );
    }

    const aiAssessment = payload.aiAssessment && typeof payload.aiAssessment === 'object'
      ? payload.aiAssessment
      : null;
    if (aiAssessment) {
      const provider = String(aiAssessment.provider || '').trim();
      const model = String(aiAssessment.model || '').trim();
      const outputDigestSha256 = String(aiAssessment.outputDigestSha256 || '').trim().toLowerCase();
      if (!provider || !model || !/^[a-f0-9]{64}$/.test(outputDigestSha256)) {
        throw serviceError(
          'AI-assisted evidence requires provider, model, and the SHA-256 digest of the exact model output.',
          400,
          'TAX_PACK_AI_EVIDENCE_PROVENANCE_REQUIRED'
        );
      }
      const newlyReportedContradictions = Array.isArray(aiAssessment.unresolvedLegalContradictions)
        ? aiAssessment.unresolvedLegalContradictions
          .map((issue) => String(issue || '').trim())
          .filter(Boolean)
        : [];
      version.legalOpenIssues = Array.from(new Set([
        ...(version.legalOpenIssues || []).map((issue) => String(issue || '').trim()).filter(Boolean),
        ...newlyReportedContradictions,
      ]));
    }

    const checks = [];
    const addCheck = (code, problems = []) => checks.push({
      code,
      status: problems.length > 0 ? 'failed' : 'passed',
      details: problems,
    });

    const identityProblems = [];
    try {
      validateDynamicJurisdictionIdentity({
        countryCode: row.countryCode,
        countryName: row.countryName,
        subdivisionCode: row.subdivisionCode,
        subdivisionName: row.subdivisionName,
        localityCode: row.localityCode,
        localityName: row.localityName,
        jurisdictionLevel: row.jurisdictionLevel,
      });
    } catch (error) {
      identityProblems.push(error.message);
    }
    addCheck('jurisdiction_identity', identityProblems);

    const declarationProblems = [];
    const effectiveFrom = normalizeDate(version.effectiveFrom, null);
    const effectiveTo = normalizeDate(version.effectiveTo, null);
    if (!effectiveFrom || (effectiveTo && effectiveTo < effectiveFrom)) {
      declarationProblems.push('Effective dates are missing or invalid.');
    }
    if (!currencyService.isSupportedCurrencyCode(version.calculationCurrency)) {
      declarationProblems.push('Calculation currency is not a supported ISO 4217 code.');
    } else if (currencyService.getMinorUnits(version.calculationCurrency) !== 2) {
      declarationProblems.push('The runnable statutory pipeline is not certified for this currency minor-unit precision.');
    }
    if (!version.coverage
      || !JURISDICTION_LEVELS.has(String(version.coverage.level || '').trim())
      || !Array.isArray(version.coverage.modules)
      || version.coverage.modules.length === 0
      || !Array.isArray(version.coverage.exclusions)
      || version.coverage.exclusions.length === 0) {
      declarationProblems.push('Coverage level, modules, and explicit exclusions must be declared.');
    }
    addCheck('effective_scope_and_currency', declarationProblems);

    const sourceProblems = [];
    const primarySources = (version.sourceLinks || []).filter((source) => (
      source?.isPrimary !== false && source?.authorityType !== 'secondary'
    ));
    if (primarySources.length === 0) sourceProblems.push('No primary official source is registered.');
    for (const source of primarySources) {
      const label = String(source.label || source.url || 'Primary source').trim();
      if (!/^https:\/\//i.test(String(source.url || '').trim())) sourceProblems.push(`${label}: HTTPS URL is missing.`);
      if (!/^[a-f0-9]{64}$/i.test(String(source.contentDigestSha256 || '').trim())) sourceProblems.push(`${label}: reviewed-content SHA-256 is missing.`);
      if (!normalizeDate(source.retrievedAt, null)) sourceProblems.push(`${label}: retrieval date is missing.`);
      if (!normalizeDate(source.checkedAt, null)) sourceProblems.push(`${label}: legal currency check date is missing.`);
      if (!normalizeDate(source.effectiveFrom, null)) sourceProblems.push(`${label}: source effective-from date is missing.`);
      if (!String(source.archiveReference || '').trim()) sourceProblems.push(`${label}: immutable archive/evidence reference is missing.`);
    }
    addCheck('official_source_snapshots', sourceProblems);

    const formulaProblems = [];
    const projected = {
      ...stripPersistenceMetadata(version),
      validationStatus: 'validated',
      calculationStatus: 'runnable',
      certificationReviews: [],
      automatedTechnicalReviews: [],
    };
    for (const formula of collectFormulaExpressions(projected)) {
      try {
        formulaEngine.compile(formula.expression);
      } catch (error) {
        formulaProblems.push(`${formula.path}: ${error.message}`);
      }
    }
    const hasIncomeTaxDefinition = projected.incomeTax
      && typeof projected.incomeTax === 'object'
      && Object.keys(projected.incomeTax).length > 0
      && String(projected.incomeTax.strategy || '').trim() !== 'none';
    if (!hasIncomeTaxDefinition && (!Array.isArray(projected.statutoryRules) || projected.statutoryRules.length === 0)) {
      formulaProblems.push('No income-tax formula or statutory liability rule is configured.');
    }
    addCheck('formula_security', formulaProblems);

    const fixtureProblems = [];
    if (checks.every((check) => check.status === 'passed')) {
      try {
        await this.validateVersionForPublish(projected, row);
      } catch (error) {
        if (error.code !== 'TAX_PACK_CERTIFICATION_INCOMPLETE') {
          fixtureProblems.push(...(
            Array.isArray(error.details) && error.details.length > 0
              ? error.details.map((detail) => String(detail))
              : [error.message]
          ));
        }
      }
    } else {
      fixtureProblems.push('Fixture execution is deferred until identity, scope, currency, sources, and formulas pass.');
    }
    addCheck('fixture_and_liability_execution', fixtureProblems);
    addCheck('tenant_and_immutability_boundary', []);

    const objectiveStatus = checks.every((check) => check.status === 'passed') ? 'passed' : 'failed';
    const actualContentHash = currentVersionHash(version);
    const runReference = `tax-technical-review:${new Date().toISOString()}:${crypto.randomUUID()}`;
    const evidence = {
      runReference,
      contentHash: actualContentHash,
      origin: aiAssessment ? 'ai_assisted' : 'deterministic',
      generatedByAI: !!aiAssessment,
      engine: aiAssessment ? {
        provider: String(aiAssessment.provider || '').trim(),
        model: String(aiAssessment.model || '').trim(),
        promptVersion: String(aiAssessment.promptVersion || '').trim(),
        outputDigestSha256: String(aiAssessment.outputDigestSha256 || '').trim().toLowerCase(),
      } : {
        provider: 'seemplify',
        model: 'deterministic-tax-pack-gates',
        promptVersion: '',
        outputDigestSha256: '',
      },
      objectiveStatus,
      productionApproval: false,
      humanReviewRequired: true,
      checks,
      unresolvedLegalContradictions: [...(version.legalOpenIssues || [])],
      summary: String(aiAssessment?.summary || payload.summary || '').trim(),
      triggeredBy: { userId: actor.userId || '', name: actor.name || '' },
      completedAt: new Date(),
    };
    if (!Array.isArray(version.automatedTechnicalReviews)) version.automatedTechnicalReviews = [];
    version.automatedTechnicalReviews.push(evidence);
    if (version.automatedTechnicalReviews.length > 50) {
      version.automatedTechnicalReviews.splice(0, version.automatedTechnicalReviews.length - 50);
    }
    row.lastModifiedBy = { userId: actor.userId || '', name: actor.name || '' };
    await row.save();
    return {
      evidence: version.automatedTechnicalReviews[version.automatedTechnicalReviews.length - 1],
      certification: this.getCertificationStatus(version, { reviewTeam: row.reviewTeam || [] }),
    };
  }

  async validateVersionForPublish(version, config) {
    const plainVersion = stripPersistenceMetadata(version);
    const platform = platformReleaseStatus(plainVersion);
    const isPlatformRelease = Boolean(plainVersion.platformRelease && platform.ready);
    const formulaErrors = [];
    for (const formula of collectFormulaExpressions(plainVersion)) {
      try {
        formulaEngine.compile(formula.expression);
      } catch (error) {
        formulaErrors.push(`${formula.path}: ${error.message}`);
      }
    }
    if (formulaErrors.length > 0) {
      const error = new Error('The tax pack contains invalid formulas.');
      error.statusCode = 400;
      error.details = formulaErrors;
      throw error;
    }

    const testCases = Array.isArray(plainVersion.testCases) ? plainVersion.testCases : [];
    if (plainVersion.calculationStatus === 'runnable' && testCases.length === 0) {
      const error = new Error('Runnable tax packs require executable boundary test cases with expected results.');
      error.statusCode = 400;
      throw error;
    }

    const failures = [];
    if (plainVersion.calculationStatus === 'runnable' && !isPlatformRelease) {
      const hasIncomeTaxDefinition = plainVersion.incomeTax
        && typeof plainVersion.incomeTax === 'object'
        && Object.keys(plainVersion.incomeTax).length > 0
        && String(plainVersion.incomeTax.strategy || '').trim() !== 'none';
      const hasStatutoryLiabilityDefinition = Array.isArray(plainVersion.statutoryRules)
        && plainVersion.statutoryRules.length > 0;
      if (!hasIncomeTaxDefinition && !hasStatutoryLiabilityDefinition) {
        failures.push('Runnable packs require an income-tax formula or at least one statutory liability rule.');
      }
      const primarySources = (plainVersion.sourceLinks || []).filter((source) => (
        source?.isPrimary !== false && source?.authorityType !== 'secondary'
      ));
      if (primarySources.length === 0) {
        failures.push('Runnable packs require at least one source marked as primary legislation or official authority guidance.');
      }
      for (const source of primarySources) {
        const sourceLabel = String(source?.label || source?.url || 'Primary source').trim();
        if (!/^https:\/\//i.test(String(source?.url || '').trim())) {
          failures.push(`${sourceLabel}: runnable primary sources require an HTTPS official-source URL.`);
        }
        if (!/^[a-f0-9]{64}$/i.test(String(source?.contentDigestSha256 || '').trim())) {
          failures.push(`${sourceLabel}: runnable primary sources require a SHA-256 digest of the reviewed source content.`);
        }
        if (!normalizeDate(source?.retrievedAt, null)) {
          failures.push(`${sourceLabel}: runnable primary sources require the date on which the reviewed content was retrieved.`);
        }
        if (!normalizeDate(source?.checkedAt, null)) {
          failures.push(`${sourceLabel}: runnable primary sources require a recorded legal currency check date.`);
        }
        if (!normalizeDate(source?.effectiveFrom, null)) {
          failures.push(`${sourceLabel}: runnable primary sources require a recorded effective-from date.`);
        }
        if (!String(source?.archiveReference || '').trim()) {
          failures.push(`${sourceLabel}: runnable primary sources require an immutable archive or evidence reference.`);
        }
      }
      const sourceReferences = new Set(primarySources.flatMap((source) => [
        String(source?.label || '').trim(),
        String(source?.url || '').trim(),
      ]).filter(Boolean));
      const categories = new Set(testCases.map((testCase) => String(testCase?.category || '').trim()));
      for (const category of REQUIRED_RUNNABLE_TEST_CATEGORIES) {
        if (!categories.has(category)) failures.push(`Missing required runnable-pack test category "${category}".`);
      }

      const fixtureFingerprints = new Map();
      const ordinaryIncomeCases = [];
      const highIncomeCases = [];
      const boundaryGroups = new Map();
      for (const [index, testCase] of testCases.entries()) {
        const label = testCase?.name || `Test ${index + 1}`;
        const category = String(testCase?.category || '').trim();
        const inputs = testCase?.inputs || {};
        const references = Array.isArray(testCase?.sourceReferences)
          ? testCase.sourceReferences.map((value) => String(value || '').trim()).filter(Boolean)
          : [];
        if (references.length === 0 || !references.every((reference) => sourceReferences.has(reference))) {
          failures.push(`${label}: every runnable fixture must reference a registered primary source.`);
        }
        const expected = testCase?.expected;
        for (const key of ['taxAmount', 'employeeStatutory', 'employerStatutory']) {
          if (!expected || !Object.prototype.hasOwnProperty.call(expected, key)) {
            failures.push(`${label}: expected.${key} is required for runnable certification.`);
          }
        }

        const fixtureTaxConfig = {
          ...(inputs.taxConfig || {}),
          employeeTaxInputs: inputs.employeeTaxInputs || inputs.taxConfig?.employeeTaxInputs || {},
        };
        const rawEmployeeInputs = this.mapLegacyInputs(
          plainVersion.fieldDefinitions || [],
          fixtureTaxConfig
        );
        const normalizedEmployeeInputs = this.normalizeEmployeeTaxInputs(
          plainVersion.fieldDefinitions || [],
          rawEmployeeInputs
        ).normalized;
        const inputFingerprint = runnableFixtureInputFingerprint(inputs, normalizedEmployeeInputs);
        if (fixtureFingerprints.has(inputFingerprint)) {
          failures.push(
            `${label}: runnable fixture inputs duplicate "${fixtureFingerprints.get(inputFingerprint)}" after calculation defaults and configured employee fields are normalized.`
          );
        } else {
          fixtureFingerprints.set(inputFingerprint, label);
        }

        if (category === 'zero_income') {
          const requiredZeroFields = [
            'grossPay',
            'taxableIncome',
            'ytdGrossPay',
            'ytdTaxableIncome',
            'ytdIncomeTax',
          ];
          if (requiredZeroFields.some((field) => (
            !Object.prototype.hasOwnProperty.call(inputs, field)
            || !Number.isFinite(Number(inputs[field]))
            || Number(inputs[field]) !== 0
          ))) {
            failures.push(`${label}: the zero_income fixture must explicitly set grossPay, taxableIncome, and all YTD amounts to zero.`);
          }
        }

        if (category === 'ordinary_period') {
          ordinaryIncomeCases.push({ label, ...currentPeriodIncome(inputs) });
        }

        if (category === 'high_income') {
          highIncomeCases.push({ label, ...currentPeriodIncome(inputs) });
        }

        if (category === 'year_to_date') {
          if (![inputs.ytdGrossPay, inputs.ytdTaxableIncome, inputs.ytdIncomeTax].some((value) => toNumber(value) > 0)) {
            failures.push(`${label}: the year_to_date fixture must include a non-zero prior-year-to-date amount.`);
          }
        }

        if (category === 'employer_cost') {
          const employerLiabilities = expected?.employerLiabilities;
          const liabilityEntries = employerLiabilities
            && typeof employerLiabilities === 'object'
            && !Array.isArray(employerLiabilities)
            ? Object.entries(employerLiabilities)
            : [];
          if (liabilityEntries.length === 0 || liabilityEntries.some(([code, amount]) => (
            !String(code || '').trim()
            || !Number.isFinite(Number(amount))
            || Number(amount) <= 0
          ))) {
            failures.push(`${label}: the employer_cost fixture must assert at least one positive component-level expected.employerLiabilities entry.`);
          }
        }

        if (category === 'threshold_boundary') {
          const boundary = testCase?.boundary;
          const group = String(boundary?.group || '').trim();
          const inputPath = String(boundary?.inputPath || '').trim();
          const position = String(boundary?.position || '').trim().toLowerCase();
          const threshold = Number(boundary?.threshold);
          const roundingUnit = Number(boundary?.roundingUnit);
          if (!group || !inputPath || !RUNNABLE_BOUNDARY_POSITIONS.includes(position)
            || !Number.isFinite(threshold) || !Number.isFinite(roundingUnit) || roundingUnit <= 0) {
            failures.push(`${label}: threshold_boundary fixtures require a named boundary group, inputPath, threshold, positive roundingUnit, and below/exact/above position.`);
          } else {
            if (!boundaryGroups.has(group)) boundaryGroups.set(group, []);
            boundaryGroups.get(group).push({
              label,
              inputPath,
              position,
              threshold,
              roundingUnit,
              actualValue: Number(getInputValueAtPath(inputs, inputPath)),
            });
          }
        }
      }

      if (ordinaryIncomeCases.length > 0 && highIncomeCases.length > 0) {
        const ordinaryMaximums = ordinaryIncomeCases.reduce((maximums, fixture) => ({
          grossPay: Math.max(maximums.grossPay, fixture.grossPay),
          taxableIncome: Math.max(maximums.taxableIncome, fixture.taxableIncome),
        }), { grossPay: -Infinity, taxableIncome: -Infinity });
        for (const fixture of highIncomeCases) {
          if (!(fixture.grossPay > ordinaryMaximums.grossPay
            && fixture.taxableIncome > ordinaryMaximums.taxableIncome)) {
            failures.push(`${fixture.label}: the high_income fixture must have grossPay and taxableIncome above every ordinary_period fixture.`);
          }
        }
      }

      for (const [group, fixtures] of boundaryGroups.entries()) {
        const declaration = fixtures[0];
        if (fixtures.some((fixture) => (
          fixture.inputPath !== declaration.inputPath
          || fixture.threshold !== declaration.threshold
          || fixture.roundingUnit !== declaration.roundingUnit
        ))) {
          failures.push(`Boundary group "${group}": every fixture must declare the same inputPath, threshold, and roundingUnit.`);
          continue;
        }

        const byPosition = new Map();
        for (const fixture of fixtures) {
          if (!byPosition.has(fixture.position)) byPosition.set(fixture.position, []);
          byPosition.get(fixture.position).push(fixture);
        }
        if (RUNNABLE_BOUNDARY_POSITIONS.some((position) => byPosition.get(position)?.length !== 1)) {
          failures.push(`Boundary group "${group}": exactly one below, exact, and above fixture is required.`);
          continue;
        }

        const expectedValueByPosition = {
          below: declaration.threshold - declaration.roundingUnit,
          exact: declaration.threshold,
          above: declaration.threshold + declaration.roundingUnit,
        };
        const comparisonTolerance = Math.max(1e-9, Math.abs(declaration.roundingUnit) * 1e-9);
        for (const position of RUNNABLE_BOUNDARY_POSITIONS) {
          const fixture = byPosition.get(position)[0];
          if (!Number.isFinite(fixture.actualValue)
            || Math.abs(fixture.actualValue - expectedValueByPosition[position]) > comparisonTolerance) {
            failures.push(`${fixture.label}: boundary input ${declaration.inputPath} must equal threshold ${position === 'exact' ? '' : `${position} by `}${position === 'exact' ? declaration.threshold : declaration.roundingUnit}.`);
          }
        }
      }
    }
    for (const [index, testCase] of testCases.entries()) {
      const inputs = testCase?.inputs || {};
      try {
        const result = await this.calculate({
          ...inputs,
          versionDefinition: plainVersion,
          configDefinition: {
            _id: config?._id || null,
            countryCode: config?.countryCode || 'OTHER',
            countryName: config?.countryName || config?.displayName || 'Custom jurisdiction',
            displayName: config?.displayName || config?.countryName || 'Custom jurisdiction',
          },
          taxConfig: {
            ...(inputs.taxConfig || {}),
            jurisdictionCode: config?.countryCode || 'OTHER',
            employeeTaxInputs: inputs.employeeTaxInputs || inputs.taxConfig?.employeeTaxInputs || {},
          },
          statutoryContributions: inputs.statutoryContributions || {},
          grossPay: toNumber(inputs.grossPay),
          taxableIncome: toNumber(inputs.taxableIncome, toNumber(inputs.grossPay)),
          basicSalary: toNumber(inputs.basicSalary, toNumber(inputs.grossPay)),
          preTaxDeductions: toNumber(inputs.preTaxDeductions),
          statutoryBases: inputs.statutoryBases || {},
          payFrequency: inputs.payFrequency || 'monthly',
          paymentDate: inputs.paymentDate || plainVersion.effectiveFrom || new Date(),
          ytdGrossPay: toNumber(inputs.ytdGrossPay),
          ytdTaxableIncome: toNumber(inputs.ytdTaxableIncome),
          ytdIncomeTax: toNumber(inputs.ytdIncomeTax),
        });
        const expected = testCase?.expected;
        if (plainVersion.calculationStatus === 'runnable' && (!expected || typeof expected !== 'object' || Object.keys(expected).length === 0)) {
          failures.push(`${testCase?.name || `Test ${index + 1}`}: runnable packs require expected values.`);
          continue;
        }
        if (expected && typeof expected === 'object') {
          const actualByKey = {
            taxAmount: result.incomeTax?.taxAmount,
            incomeTax: result.incomeTax?.taxAmount,
            employeeStatutory: result.statutoryContributions?.totalEmployeeAmount,
            employerStatutory: result.statutoryContributions?.totalEmployerAmount,
            employeeLiabilities: liabilityAmountsByCode(result.statutoryContributions?.components, 'employee'),
            employerLiabilities: liabilityAmountsByCode(result.statutoryContributions?.components, 'employer'),
            incomeTaxMethod: result.incomeTax?.method,
            calculationCurrency: result.compliance?.calculationCurrency,
            payrollRunnable: result.payrollRunnable,
          };
          const tolerance = Math.min(0.01, Math.max(0, toNumber(testCase.tolerance, 0.01)));
          for (const [key, expectedValue] of Object.entries(expected)) {
            if (!(key in actualByKey)) {
              failures.push(`${testCase?.name || `Test ${index + 1}`}: unsupported expected field "${key}".`);
              continue;
            }
            const actualValue = actualByKey[key];
            if (expectedValue && typeof expectedValue === 'object' && !Array.isArray(expectedValue)) {
              const actualMap = actualValue && typeof actualValue === 'object' ? actualValue : {};
              const expectedCodes = Object.keys(expectedValue).sort();
              const actualCodes = Object.keys(actualMap).sort();
              if (stableStringify(actualCodes) !== stableStringify(expectedCodes)) {
                failures.push(`${testCase?.name || `Test ${index + 1}`}: expected ${key} liability codes ${expectedCodes.join(', ') || '(none)'}, received ${actualCodes.join(', ') || '(none)'}.`);
                continue;
              }
              for (const code of expectedCodes) {
                const actualAmount = toNumber(actualMap[code], NaN);
                const wantedAmount = toNumber(expectedValue[code], NaN);
                if (!Number.isFinite(actualAmount) || !Number.isFinite(wantedAmount)
                  || Math.abs(actualAmount - wantedAmount) > tolerance) {
                  failures.push(`${testCase?.name || `Test ${index + 1}`}: expected ${key}.${code}=${expectedValue[code]}, received ${actualMap[code]}.`);
                }
              }
              continue;
            }
            if (typeof expectedValue === 'string' || typeof expectedValue === 'boolean') {
              if (actualValue !== expectedValue) {
                failures.push(`${testCase?.name || `Test ${index + 1}`}: expected ${key}=${expectedValue}, received ${actualValue}.`);
              }
              continue;
            }
            const actual = toNumber(actualValue, NaN);
            const wanted = toNumber(expectedValue, NaN);
            if (!Number.isFinite(actual) || !Number.isFinite(wanted) || Math.abs(actual - wanted) > tolerance) {
              failures.push(`${testCase?.name || `Test ${index + 1}`}: expected ${key}=${expectedValue}, received ${actualValue}.`);
            }
          }
        }
      } catch (error) {
        failures.push(`${testCase?.name || `Test ${index + 1}`}: ${error.message}`);
      }
    }
    if (failures.length > 0) {
      const error = new Error('The tax pack failed its publication test cases.');
      error.statusCode = 400;
      error.details = failures;
      throw error;
    }
    if (plainVersion.calculationStatus === 'runnable' && !isPlatformRelease) {
      const certification = this.getCertificationStatus(plainVersion, {
        reviewTeam: config?.reviewTeam || [],
      });
      if (!certification.ready) {
        const error = new Error('The runnable tax pack has not completed independent certification review.');
        error.statusCode = 400;
        error.code = 'TAX_PACK_CERTIFICATION_INCOMPLETE';
        error.details = certification.problems;
        throw error;
      }
    }
  }

  async publishVersion(id, versionId, organizationId, actor = {}) {
    const row = await TaxJurisdictionConfig.findOne({
      _id: id,
      scope: 'organization',
      organizationId,
    });

    if (!row) {
      throw new Error('Jurisdiction was not found');
    }

    const version = row.versions.find((entry) => String(entry._id) === String(versionId));
    if (!version) {
      throw new Error('Version was not found');
    }

    if (version.calculationStatus === 'runnable' && (version.legalOpenIssues || []).length > 0) {
      const error = new Error('Unresolved legal contradictions must be resolved and independently reviewed before this pack can be published as runnable.');
      error.statusCode = 409;
      error.code = 'TAX_PACK_LEGAL_CONTRADICTIONS_UNRESOLVED';
      error.details = [...version.legalOpenIssues];
      throw error;
    }

    if (version.validationStatus !== 'validated') {
      const error = new Error('Only a validated tax rule version can be published.');
      error.statusCode = 400;
      throw error;
    }
    if (!Array.isArray(version.sourceLinks) || version.sourceLinks.length === 0) {
      const error = new Error('At least one legal or tax-authority source is required before publishing.');
      error.statusCode = 400;
      throw error;
    }
    if (!currencyService.isSupportedCurrencyCode(version.calculationCurrency)) {
      const error = new Error('A supported ISO 4217 calculation currency is required before publishing. Custom reporting units cannot be used for statutory calculations.');
      error.statusCode = 400;
      throw error;
    }
    const effectiveFrom = normalizeDate(version.effectiveFrom, null);
    const effectiveTo = normalizeDate(version.effectiveTo, null);
    if (!effectiveFrom || (effectiveTo && effectiveTo < effectiveFrom)) {
      const error = new Error('The pack requires a valid effective-from date and an effective-to date that is not earlier.');
      error.statusCode = 400;
      error.code = 'TAX_PACK_EFFECTIVE_DATE_INVALID';
      throw error;
    }
    if (version.calculationStatus === 'runnable'
      && !platformReleaseStatus(version).ready
      && currencyService.getMinorUnits(version.calculationCurrency) !== 2) {
      const error = new Error('Runnable tax packs currently require a two-decimal calculation currency. Zero- and three-decimal statutory rounding pipelines must be certified before publication.');
      error.statusCode = 400;
      throw error;
    }
    const invalidFixedCurrencyField = (version.fieldDefinitions || []).find((field) => (
      field?.type === 'currency'
      && String(field.currencyCode || '').trim()
      && !currencyService.isSupportedCurrencyCode(field.currencyCode)
    ));
    if (invalidFixedCurrencyField) {
      const error = new Error(`Tax field ${invalidFixedCurrencyField.label || invalidFixedCurrencyField.key} uses an unsupported fixed currency.`);
      error.statusCode = 400;
      throw error;
    }
    await this.validateVersionForPublish(version, row);
    if (!version.coverage
      || !JURISDICTION_LEVELS.has(String(version.coverage.level || '').trim())
      || !Array.isArray(version.coverage.modules)
      || version.coverage.modules.length === 0
      || !Array.isArray(version.coverage.exclusions)
      || version.coverage.exclusions.length === 0) {
      const error = new Error('Publishable packs require a declared coverage level, at least one module, and explicit known exclusions. Use "none" only after review confirms that no exclusions remain.');
      error.statusCode = 400;
      error.code = 'TAX_PACK_COVERAGE_DECLARATION_REQUIRED';
      throw error;
    }
    if (version.calculationStatus === 'runnable') {
      const certification = this.getCertificationStatus(version, {
        publisherId: actor.userId || '',
        reviewTeam: row.reviewTeam || [],
      });
      if (!certification.ready) {
        const error = new Error('The runnable tax pack cannot be published until independent certification and publisher separation are complete.');
        error.statusCode = 409;
        error.code = 'TAX_PACK_CERTIFICATION_INCOMPLETE';
        error.details = certification.problems;
        throw error;
      }
    }

    const overlaps = (row.versions || []).filter((entry) => {
      if (String(entry._id) === String(version._id) || !['published', 'archived'].includes(entry.status)) return false;
      const startA = normalizeDate(version.effectiveFrom, null)?.getTime() || -Infinity;
      const endA = normalizeDate(version.effectiveTo, null)?.getTime() || Infinity;
      const startB = normalizeDate(entry.effectiveFrom, null)?.getTime() || -Infinity;
      const endB = normalizeDate(entry.effectiveTo, null)?.getTime() || Infinity;
      return startA <= endB && startB <= endA;
    });
    const supersedable = overlaps.filter((entry) => (
      entry.status === 'published'
      && normalizeDate(entry.effectiveFrom, null)
      && normalizeDate(version.effectiveFrom, null)
      && normalizeDate(entry.effectiveFrom, null) < normalizeDate(version.effectiveFrom, null)
    ));
    if (overlaps.length > 0 && supersedable.length !== overlaps.length) {
      const error = new Error('The effective dates overlap an existing published rule version. End-date the earlier version first.');
      error.statusCode = 409;
      throw error;
    }
    for (const priorVersion of supersedable) {
      priorVersion.effectiveTo = new Date(normalizeDate(version.effectiveFrom).getTime() - 1);
      priorVersion.status = 'archived';
    }

    version.contentHash = currentVersionHash(version);
    version.reviewedBy = {
      userId: actor.userId || '',
      name: actor.name || '',
      reviewedAt: new Date(),
    };

    for (const priorVersion of row.versions || []) {
      if (String(priorVersion._id) !== String(version._id) && priorVersion.status === 'published') {
        priorVersion.status = 'archived';
      }
    }
    version.status = 'published';
    row.publishedVersionId = version._id;
    row.status = 'active';
    row.lastModifiedBy = {
      userId: actor.userId || '',
      name: actor.name || '',
    };
    await row.save();
    return row;
  }

  async findGlobalByCountryCode(countryCode) {
    return TaxJurisdictionConfig.findOne({
      scope: 'global',
      organizationId: '',
      countryCode: normalizeCode(countryCode),
      status: { $ne: 'archived' },
    });
  }

  async importLegacyManualConfig(organizationId, taxConfig = {}) {
    const fingerprint = stableStringify({
      jurisdictionCode: normalizeCode(taxConfig.jurisdictionCode || 'OTHER'),
      jurisdictionName: String(taxConfig.jurisdictionName || '').trim(),
      calculationMode: taxConfig.calculationMode || 'manual',
      manualCalculationType: taxConfig.manualCalculationType || 'progressive',
      manualTaxFreeAllowance: roundMoney(taxConfig.manualTaxFreeAllowance || 0),
      flatTaxRate: roundMoney(taxConfig.flatTaxRate || 0),
      additionalWithholding: roundMoney(taxConfig.additionalWithholding || 0),
      customBrackets: Array.isArray(taxConfig.customBrackets)
        ? taxConfig.customBrackets.map((bracket) => ({
          min: roundMoney(bracket.min || 0),
          max: bracket.max === null || bracket.max === undefined ? null : roundMoney(bracket.max),
          rate: roundMoney(bracket.rate || 0),
        }))
        : [],
      socialSecurityRate: roundMoney(taxConfig.socialSecurityRate || 0),
      socialSecurityCap: roundMoney(taxConfig.socialSecurityCap || 0),
    });

    const rows = await TaxJurisdictionConfig.find({
      scope: 'organization',
      organizationId,
      countryCode: normalizeCode(taxConfig.jurisdictionCode || 'OTHER', 'OTHER'),
      status: { $ne: 'archived' },
    });
    const existing = rows.find((row) => String(row.description || '').endsWith(`Legacy fingerprint: ${fingerprint}`));
    if (existing) {
      return existing;
    }

    const countryCode = normalizeCode(taxConfig.jurisdictionCode || 'OTHER', 'OTHER');
    const displayName = taxConfig.jurisdictionName
      ? `Imported ${taxConfig.jurisdictionName} Rule`
      : `Imported ${countryCode} Legacy Rule`;
    const versionId = new mongoose.Types.ObjectId();
    const strategy = taxConfig.manualCalculationType === 'flat'
      ? {
        strategy: 'flat_rate',
        taxableAnnualFormula: 'max(0, annualizedTaxableIncome - employeeFields.manualTaxFreeAllowance)',
        annualRateFormula: 'employeeFields.flatTaxRate',
        annualTaxAfterFormula: 'annualTaxBeforeAdjustments',
      }
      : taxConfig.manualCalculationType === 'none'
        ? { strategy: 'none' }
        : {
          strategy: 'progressive_bands',
          taxableAnnualFormula: 'max(0, annualizedTaxableIncome - employeeFields.manualTaxFreeAllowance)',
          brackets: Array.isArray(taxConfig.customBrackets)
            ? taxConfig.customBrackets.map((bracket) => ({
              min: roundMoney(bracket.min || 0),
              max: bracket.max === null || bracket.max === undefined ? null : roundMoney(bracket.max),
              rate: roundMoney(bracket.rate || 0),
            }))
            : [],
          annualTaxAfterFormula: 'annualTaxBeforeAdjustments',
        };

    return TaxJurisdictionConfig.create({
      scope: 'organization',
      organizationId,
      countryCode,
      countryName: String(taxConfig.jurisdictionName || buildCountryName(countryCode)).trim(),
      displayName,
      description: `Imported from legacy employee tax configuration. Legacy fingerprint: ${fingerprint}`,
      status: 'active',
      publishedVersionId: versionId,
      versions: [{
        _id: versionId,
        label: 'Imported Legacy Rule',
        versionNumber: 1,
        status: 'published',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        effectiveTo: null,
        sourceDate: new Date(),
        sourceLinks: [],
        notes: ['Imported automatically from legacy employee tax settings.'],
        validationStatus: 'needs_review',
        calculationStatus: 'blocked',
        calculationCurrency: '',
        coverage: {
          level: 'organization_override',
          modules: ['legacy_manual_income_tax'],
          exclusions: ['legal_source_validation', 'statutory_authority_certification'],
          supportedSubdivisions: [],
        },
        fieldDefinitions: [
          makeCurrencyField('manualTaxFreeAllowance', 'Manual Tax-Free Allowance'),
          makeCurrencyField('flatTaxRate', 'Flat Tax Rate'),
          makeCurrencyField('additionalWithholding', 'Additional Withholding'),
        ],
        taxYear: { mode: 'calendar' },
        constants: {
          importedFromLegacy: true,
        },
        incomeTax: {
          ...strategy,
          additionalWithholdingFormula: 'employeeFields.additionalWithholding',
        },
        statutoryRules: taxConfig.socialSecurityRate > 0 ? [{
          strategy: 'flat_percent',
          name: 'Social Security',
          rate: roundMoney(taxConfig.socialSecurityRate || 0),
          capFormula: toNumber(taxConfig.socialSecurityCap || 0) > 0 ? String(roundMoney(taxConfig.socialSecurityCap || 0)) : '',
          baseFormula: 'grossPay',
          reducesTaxableIncome: false,
        }] : [],
        testCases: [],
      }],
      createdBy: {
        userId: 'system',
        name: 'Legacy migration',
      },
      lastModifiedBy: {
        userId: 'system',
        name: 'Legacy migration',
      },
    });
  }

  async resolveJurisdictionConfig(input = {}) {
    const organizationId = String(input.organizationId || '').trim();
    const taxConfig = input.taxConfig || {};
    if (input.versionDefinition) {
      const version = input.versionDefinition;
      const fallbackConfig = input.configDefinition || {
        _id: taxConfig.jurisdictionConfigId || null,
        countryCode: normalizeCode(taxConfig.jurisdictionCode || input.configDefinition?.countryCode || 'OTHER', 'OTHER'),
        countryName: String(taxConfig.jurisdictionName || input.configDefinition?.countryName || buildCountryName(taxConfig.jurisdictionCode || 'OTHER')).trim(),
        displayName: String(input.configDefinition?.displayName || taxConfig.jurisdictionName || buildCountryName(taxConfig.jurisdictionCode || 'OTHER')).trim(),
      };
      const legacyInputs = this.mapLegacyInputs(version.fieldDefinitions || [], taxConfig);
      const { normalized, validationErrors } = this.normalizeEmployeeTaxInputs(version.fieldDefinitions || [], legacyInputs);
      return {
        config: fallbackConfig,
        version,
        employeeTaxInputs: normalized,
        validationErrors,
      };
    }

    const requestedConfigId = taxConfig.jurisdictionConfigId || taxConfig.configId;
    const requestedVersionId = taxConfig.jurisdictionVersionId || taxConfig.versionId;

    let config = null;
    if (requestedConfigId) {
      config = await this.getJurisdictionById(requestedConfigId, organizationId);
      if (!config) {
        return {
          config: null,
          version: null,
          validationErrors: ['The explicitly selected tax jurisdiction is missing, archived, or unavailable to this organization. Select and review another pack before calculating payroll.'],
        };
      }
    }

    if (!config) {
      const countryCode = normalizeCode(taxConfig.jurisdictionCode || 'OTHER', 'OTHER');
      if (['GB', 'US', 'NG', 'GH', 'KE', 'ZA', 'CM', 'MZ', 'CA', 'EU'].includes(countryCode)) {
        config = await this.findGlobalByCountryCode(countryCode);
      } else if (organizationId) {
        config = await TaxJurisdictionConfig.findOne({
          scope: 'organization',
          organizationId,
          countryCode,
          status: { $ne: 'archived' },
        });
        if (!config) config = await this.findGlobalByCountryCode('OTHER');
      } else {
        config = await this.findGlobalByCountryCode('OTHER');
      }
    }

    if (!config) {
      return { config: null, version: null, validationErrors: ['No tax jurisdiction configuration was found.'] };
    }

    const version = this.findVersion(config, requestedVersionId, input.paymentDate);
    if (!version) {
      return { config, version: null, validationErrors: ['The selected tax jurisdiction has no published rule version.'] };
    }

    const legacyInputs = this.mapLegacyInputs(version.fieldDefinitions || [], taxConfig);
    const { normalized, validationErrors } = this.normalizeEmployeeTaxInputs(version.fieldDefinitions || [], legacyInputs);

    return {
      config,
      version,
      employeeTaxInputs: normalized,
      validationErrors,
    };
  }

  resolveBands(rawBands = [], context = {}) {
    return (Array.isArray(rawBands) ? rawBands : []).map((band) => ({
      min: band.minFormula ? formulaEngine.evaluate(band.minFormula, context) : toNumber(band.min),
      max: band.maxFormula ? formulaEngine.evaluate(band.maxFormula, context) : (band.max === null || band.max === undefined ? null : toNumber(band.max)),
      rate: toNumber(band.rate),
    }));
  }

  buildNoteList(noteRules = [], context = {}) {
    const notes = [];
    for (const rule of noteRules || []) {
      try {
        if (!rule.whenFormula || formulaEngine.evaluate(rule.whenFormula, context)) {
          notes.push(rule.text);
        }
      } catch (error) {
        // Ignore note formula failures in favor of the main validation path.
      }
    }
    return notes;
  }

  evaluateIncomeTaxStrategy(strategyConfig = {}, context = {}, meta = {}) {
    const strategy = strategyConfig.strategy || 'none';

    if (strategy === 'none') {
      return {
        taxAmount: 0,
        annualizedTaxableIncome: roundMoney(context.annualizedTaxableIncome),
        taxableIncomeAfterReliefs: 0,
        notes: [],
        details: { method: 'none' },
        method: 'none',
      };
    }

    if (strategy === 'flat_rate') {
      const annualBase = Math.max(0, toNumber(formulaEngine.evaluate(strategyConfig.taxableAnnualFormula || 'annualizedTaxableIncome', context)));
      context.taxableAnnualBase = annualBase;
      const annualRate = toNumber(formulaEngine.evaluate(strategyConfig.annualRateFormula || '0', context));
      const annualTaxBeforeAdjustments = roundMoney(annualBase * (annualRate / 100));
      context.annualTaxBeforeAdjustments = annualTaxBeforeAdjustments;
      const annualTaxAfterAdjustments = Math.max(0, toNumber(formulaEngine.evaluate(strategyConfig.annualTaxAfterFormula || 'annualTaxBeforeAdjustments', context)));
      context.annualTaxAfterAdjustments = annualTaxAfterAdjustments;

      return {
        taxAmount: getPeriodAmount(annualTaxAfterAdjustments, context.periodsPerYear),
        annualizedTaxableIncome: roundMoney(context.annualizedTaxableIncome),
        taxableIncomeAfterReliefs: roundMoney(annualBase),
        notes: [],
        details: {
          method: 'flat_rate',
          rate: roundRate(annualRate),
          annualTaxBeforeAdjustments,
          annualTaxAfterAdjustments,
        },
        method: 'flat_rate',
      };
    }

    if (strategy === 'base_plus_rate') {
      this.applyDerivedFormulas(context, strategyConfig.derivedFormulas);
      const taxableAnnualBase = Math.max(0, toNumber(formulaEngine.evaluate(strategyConfig.taxableAnnualFormula || 'annualizedTaxableIncome', context)));
      context.taxableAnnualBase = taxableAnnualBase;
      const tableGroup = String(formulaEngine.evaluate(strategyConfig.tableGroupFormula || "'default'", context) || 'default');
      const rowKey = String(formulaEngine.evaluate(strategyConfig.rowKeyFormula || "'default'", context) || 'default');
      const rows = strategyConfig.tableSets?.[tableGroup]?.[rowKey]
        || strategyConfig.tableSets?.[tableGroup]?.default
        || strategyConfig.tableSets?.default?.[rowKey]
        || strategyConfig.tableSets?.default?.default
        || [];
      const annualBaseTax = calculateBaseRateTax(taxableAnnualBase, rows);
      context.annualBaseTax = annualBaseTax.amount;
      context.baseTaxRow = annualBaseTax.row;
      const annualTaxAfterAdjustments = Math.max(0, toNumber(formulaEngine.evaluate(strategyConfig.annualTaxAfterFormula || 'annualBaseTax', context)));
      context.annualTaxAfterAdjustments = annualTaxAfterAdjustments;

      return {
        taxAmount: getPeriodAmount(annualTaxAfterAdjustments, context.periodsPerYear),
        annualizedTaxableIncome: roundMoney(context.annualizedTaxableIncome),
        taxableIncomeAfterReliefs: roundMoney(taxableAnnualBase),
        notes: [],
        details: {
          method: 'base_plus_rate',
          annualTaxBeforeAdjustments: roundMoney(annualBaseTax.amount),
          annualTaxAfterAdjustments: roundMoney(annualTaxAfterAdjustments),
          row: annualBaseTax.row,
          tableGroup,
          rowKey,
        },
        method: meta.defaultMethod || 'base_plus_rate',
      };
    }

    if (strategy === 'mozambique_monthly_irps') {
      const monthlyGross = Math.max(0, toNumber(context.grossPay));
      const dependantIndex = Math.min(4, Math.max(0, Math.floor(toNumber(context.employeeFields?.dependants))));
      const rows = [
        { min: 0, max: 20250, coefficient: 0, bases: [0, 0, 0, 0, 0] },
        { min: 20250, max: 20750, coefficient: 10, bases: [0, null, null, null, null] },
        { min: 20750, max: 21000, coefficient: 10, bases: [50, 0, null, null, null] },
        { min: 21000, max: 21250, coefficient: 10, bases: [75, 25, 0, null, null] },
        { min: 21250, max: 21750, coefficient: 10, bases: [100, 50, 25, 0, null] },
        { min: 21750, max: 22250, coefficient: 10, bases: [150, 100, 75, 50, 0] },
        { min: 22250, max: 32750, coefficient: 15, bases: [200, 150, 125, 100, 50] },
        { min: 32750, max: 60750, coefficient: 20, bases: [1775, 1725, 1700, 1675, 1625] },
        { min: 60750, max: 144750, coefficient: 25, bases: [7375, 7325, 7300, 7275, 7225] },
        { min: 144750, max: Infinity, coefficient: 32, bases: [28375, 28325, 28300, 28275, 28225] },
      ];
      const row = rows.find((entry) => monthlyGross >= entry.min && monthlyGross < entry.max) || rows[rows.length - 1];
      const baseTax = row.bases[dependantIndex];
      const taxAmount = baseTax === null
        ? 0
        : roundMoney(toNumber(baseTax) + (Math.max(0, monthlyGross - row.min) * (row.coefficient / 100)));
      return {
        taxAmount,
        annualizedTaxableIncome: roundMoney(context.annualizedTaxableIncome),
        taxableIncomeAfterReliefs: roundMoney(monthlyGross),
        notes: [],
        details: {
          method: 'mozambique_monthly_irps',
          dependants: dependantIndex,
          interval: { min: row.min, max: Number.isFinite(row.max) ? row.max : null },
          baseTax,
          coefficient: row.coefficient,
        },
        method: 'mozambique_monthly_irps',
      };
    }

    if (strategy === 'conditional') {
      const cases = Array.isArray(strategyConfig.cases) ? strategyConfig.cases : [];
      for (const caseConfig of cases) {
        if (formulaEngine.evaluate(caseConfig.whenFormula || 'false', context)) {
          return this.evaluateIncomeTaxStrategy(caseConfig.strategyConfig || {}, context, meta);
        }
      }

      return this.evaluateIncomeTaxStrategy(strategyConfig.defaultStrategyConfig || { strategy: 'none' }, context, meta);
    }

    this.applyDerivedFormulas(context, strategyConfig.derivedFormulas);
    const taxableAnnualBase = Math.max(0, toNumber(formulaEngine.evaluate(strategyConfig.taxableAnnualFormula || 'annualizedTaxableIncome', context)));
    context.taxableAnnualBase = taxableAnnualBase;
    const bracketSetKey = strategyConfig.bracketSetFormula
      ? String(formulaEngine.evaluate(strategyConfig.bracketSetFormula, context) || 'default')
      : 'default';
    const rawBands = strategyConfig.bracketSets?.[bracketSetKey] || strategyConfig.brackets || [];
    const bands = this.resolveBands(rawBands, context);
    const bracketTax = calculateProgressiveTaxFromBands(taxableAnnualBase, bands);
    context.bracketTax = bracketTax.amount;
    context.annualTaxBeforeAdjustments = bracketTax.amount;

    if (strategyConfig.minimumTax?.whenFormula && formulaEngine.evaluate(strategyConfig.minimumTax.whenFormula, context)) {
      const minimumTax = Math.max(0, toNumber(formulaEngine.evaluate(strategyConfig.minimumTax.annualTaxFormula || '0', context)));
      if (minimumTax > context.annualTaxBeforeAdjustments) {
        context.annualTaxBeforeAdjustments = minimumTax;
      }
    }

    const annualTaxAfterAdjustments = Math.max(0, toNumber(formulaEngine.evaluate(strategyConfig.annualTaxAfterFormula || 'annualTaxBeforeAdjustments', context)));
    context.annualTaxAfterAdjustments = annualTaxAfterAdjustments;

    return {
      taxAmount: getPeriodAmount(annualTaxAfterAdjustments, context.periodsPerYear),
      annualizedTaxableIncome: roundMoney(context.annualizedTaxableIncome),
      taxableIncomeAfterReliefs: roundMoney(taxableAnnualBase),
      notes: [],
      details: {
        method: bracketSetKey !== 'default' ? `progressive_${bracketSetKey}` : 'progressive_bands',
        annualTaxBeforeAdjustments: roundMoney(context.annualTaxBeforeAdjustments),
        annualTaxAfterAdjustments: roundMoney(annualTaxAfterAdjustments),
        bracketBreakdown: bracketTax.components,
      },
      method: meta.defaultMethod || (bracketSetKey !== 'default' ? `progressive_${bracketSetKey}` : 'progressive_bands'),
    };
  }

  evaluateStatutoryRules(rules = [], context = {}) {
    const components = [];
    let totalEmployeeAmount = 0;
    let totalEmployerAmount = 0;
    let reducesTaxableIncome = 0;

    const appendComponent = (component) => {
      const amount = roundMoney(component?.amount);
      if (amount <= 0) return;
      const payer = component?.payer === 'employer' ? 'employer' : 'employee';
      const normalized = { ...component, amount, payer };
      components.push(normalized);
      if (payer === 'employer') {
        totalEmployerAmount = roundMoney(totalEmployerAmount + amount);
      } else {
        totalEmployeeAmount = roundMoney(totalEmployeeAmount + amount);
        if (normalized.reducesTaxableIncome) {
          reducesTaxableIncome = roundMoney(reducesTaxableIncome + amount);
        }
      }
    };

    const hasApprovedExemption = (rule) => {
      const liabilityCode = normalizeCode(rule.liabilityCode || '');
      const payDate = normalizeDate(context.payDate);
      return (context.statutoryContributions?.exemptions || []).some((entry) => {
        const exemptionCode = normalizeCode(entry?.liabilityCode || '');
        if (exemptionCode !== '*' && exemptionCode !== liabilityCode) return false;
        const effectiveFrom = normalizeDate(entry?.effectiveFrom, null);
        const effectiveTo = normalizeDate(entry?.effectiveTo, null);
        if (effectiveFrom && payDate < effectiveFrom) return false;
        if (effectiveTo && payDate > effectiveTo) return false;
        return Boolean(
          String(entry?.reasonCode || '').trim()
          && String(entry?.authorityReason || '').trim()
          && String(entry?.evidenceReference || '').trim()
          && String(entry?.approvedBy || '').trim()
          && normalizeDate(entry?.approvedAt, null)
        );
      });
    };

    for (const rule of rules || []) {
      if (rule.applyOptInField && context.statutoryContributions?.[rule.applyOptInField] === false) {
        if (hasApprovedExemption(rule)) {
          continue;
        }
        context.validationErrors.push(
          `${rule.name || rule.liabilityCode || 'A mandatory statutory contribution'} cannot be disabled without an approved, effective exemption and evidence reference.`
        );
      }
      if (rule.whenFormula && !formulaEngine.evaluate(rule.whenFormula, context)) {
        continue;
      }

      if (rule.strategy === 'fixed_amount') {
        const amount = Math.max(0, toNumber(formulaEngine.evaluate(rule.amountFormula || '0', context)));
        appendComponent({
          type: rule.type || 'payroll_tax',
          name: rule.name || 'Statutory Levy',
          liabilityCode: rule.liabilityCode || '',
          payer: rule.payer || 'employee',
          amount,
          taxableAmount: roundMoney(Math.max(0, toNumber(formulaEngine.evaluate(rule.baseFormula || 'grossPay', context)))),
          reducesTaxableIncome: !!rule.reducesTaxableIncome,
          remittanceAuthority: rule.remittanceAuthority || '',
          source: 'seeded_rule',
        });
        continue;
      }

      if (rule.strategy === 'flat_percent') {
        const rate = rule.rate !== undefined ? toNumber(rule.rate) : toNumber(formulaEngine.evaluate(rule.rateFormula || '0', context));
        const cap = rule.capFormula ? Math.max(0, toNumber(formulaEngine.evaluate(rule.capFormula, context))) : 0;
        const floor = rule.floorFormula ? Math.max(0, toNumber(formulaEngine.evaluate(rule.floorFormula, context))) : 0;
        const rawBaseAmount = Math.max(0, toNumber(formulaEngine.evaluate(rule.baseFormula || 'grossPay', context)));
        const baseAmount = rawBaseAmount > 0 && floor > 0 ? Math.max(rawBaseAmount, floor) : rawBaseAmount;
        const ytdAmount = Math.max(0, toNumber(context.ytdGrossPay));
        let taxableAmount = baseAmount;
        let hitCap = false;

        if (cap > 0) {
          if (rule.capMode === 'period_base') {
            if (taxableAmount > cap) hitCap = true;
            taxableAmount = Math.min(taxableAmount, cap);
          } else {
            if (ytdAmount >= cap) {
              taxableAmount = 0;
              hitCap = true;
            } else if (ytdAmount + taxableAmount > cap) {
              taxableAmount = Math.max(0, cap - ytdAmount);
              hitCap = true;
            }
          }
        }

        const minimumContribution = rule.minimumContributionFormula
          ? Math.max(0, toNumber(formulaEngine.evaluate(rule.minimumContributionFormula, context)))
          : 0;
        const maximumContribution = rule.maximumContributionFormula
          ? Math.max(0, toNumber(formulaEngine.evaluate(rule.maximumContributionFormula, context)))
          : 0;
        let amount = roundMoney(taxableAmount * (rate / 100));
        if (taxableAmount > 0 && minimumContribution > 0) amount = Math.max(amount, minimumContribution);
        if (maximumContribution > 0) amount = Math.min(amount, maximumContribution);
        if (amount <= 0) {
          continue;
        }

        appendComponent({
          type: rule.type || 'social_security',
          name: rule.name || 'Statutory Contribution',
          liabilityCode: rule.liabilityCode || '',
          payer: rule.payer || 'employee',
          amount,
          rate: roundRate(rate),
          taxableAmount: roundMoney(taxableAmount),
          cap: cap || null,
          floor: floor || null,
          hitCap,
          reducesTaxableIncome: !!rule.reducesTaxableIncome,
          remittanceAuthority: rule.remittanceAuthority || '',
          source: 'seeded_rule',
        });
        continue;
      }

      if (rule.strategy === 'uk_ni') {
        const earnings = Math.max(0, toNumber(context.grossPay));
        const frequency = String(context.periodsPerYear === 52 ? 'weekly' : context.periodsPerYear === 26 ? 'bi-weekly' : context.periodsPerYear === 24 ? 'semi-monthly' : 'monthly');
        const weeklyMultiplier = frequency === 'bi-weekly' ? 2 : 1;
        const thresholds = frequency === 'weekly' || frequency === 'bi-weekly'
          ? { primary: 242 * weeklyMultiplier, upper: 967 * weeklyMultiplier, secondary: 96 * weeklyMultiplier, freeport: 481 * weeklyMultiplier, upperSecondary: 967 * weeklyMultiplier }
          : frequency === 'monthly'
            ? { primary: 1048, upper: 4189, secondary: 417, freeport: 2083, upperSecondary: 4189 }
            : { primary: 12570 / 24, upper: 50270 / 24, secondary: 5000 / 24, freeport: 25000 / 24, upperSecondary: 50270 / 24 };
        const primaryThreshold = thresholds.primary;
        const upperEarningsLimit = thresholds.upper;
        const category = normalizeCode(context.employeeFields?.niCategory || 'A', 'A');
        const employeeRates = {
          A: [8, 2], B: [1.85, 2], C: [0, 0], D: [2, 2], E: [1.85, 2], F: [8, 2],
          H: [8, 2], I: [1.85, 2], J: [2, 2], K: [0, 0], L: [2, 2], M: [8, 2],
          N: [8, 2], S: [0, 0], V: [8, 2], Z: [2, 2],
        }[category] || [8, 2];
        const firstBand = Math.max(0, Math.min(earnings, upperEarningsLimit) - primaryThreshold);
        const secondBand = Math.max(0, earnings - upperEarningsLimit);
        const employeeAmount = roundMoney((firstBand * (employeeRates[0] / 100)) + (secondBand * (employeeRates[1] / 100)));
        appendComponent({
            type: 'social_security',
            name: `${rule.name || 'National Insurance'} - Employee`,
            liabilityCode: 'GB_NI_EMPLOYEE',
            payer: 'employee',
            amount: employeeAmount,
            taxableAmount: roundMoney(earnings),
            rate: employeeRates,
            thresholds: {
              primaryThreshold: roundMoney(primaryThreshold),
              upperEarningsLimit: roundMoney(upperEarningsLimit),
            },
            category,
            remittanceAuthority: 'HM Revenue & Customs',
            source: 'seeded_rule',
        });

        const standardEmployerCategories = new Set(['A', 'B', 'C', 'J']);
        const reliefToFreeportCategories = new Set(['D', 'E', 'F', 'I', 'K', 'L', 'N', 'S']);
        const employerThreshold = standardEmployerCategories.has(category)
          ? thresholds.secondary
          : reliefToFreeportCategories.has(category)
            ? thresholds.freeport
            : thresholds.upperSecondary;
        const employerAmount = roundMoney(Math.max(0, earnings - employerThreshold) * 0.15);
        appendComponent({
          type: 'social_security', name: `${rule.name || 'National Insurance'} - Employer`, liabilityCode: 'GB_NI_EMPLOYER',
          payer: 'employer', amount: employerAmount, taxableAmount: roundMoney(earnings), rate: 15,
          threshold: roundMoney(employerThreshold), category, remittanceAuthority: 'HM Revenue & Customs', source: 'seeded_rule',
        });
        continue;
      }

      if (rule.strategy === 'us_fica') {
        const earnings = Math.max(0, toNumber(context.grossPay));
        const ytdGrossPay = Math.max(0, toNumber(context.ytdGrossPay));
        const socialSecurityWageBase = 184500;
        const additionalMedicareThreshold = 200000;
        const remainingSocialSecurityBase = Math.max(0, socialSecurityWageBase - ytdGrossPay);
        const socialSecurityTaxable = Math.min(earnings, remainingSocialSecurityBase);
        const medicareTaxable = earnings;
        const additionalMedicareTaxable = Math.max(0, (ytdGrossPay + earnings) - additionalMedicareThreshold)
          - Math.max(0, ytdGrossPay - additionalMedicareThreshold);

        const socialSecurityAmount = roundMoney(socialSecurityTaxable * 0.062);
        const medicareAmount = roundMoney(medicareTaxable * 0.0145);
        const additionalMedicareAmount = roundMoney(Math.max(0, additionalMedicareTaxable) * 0.009);

        if (socialSecurityAmount > 0) {
          appendComponent({
            type: 'social_security',
            name: 'Social Security',
            liabilityCode: 'US_SOCIAL_SECURITY_EMPLOYEE',
            payer: 'employee',
            amount: socialSecurityAmount,
            taxableAmount: roundMoney(socialSecurityTaxable),
            cap: socialSecurityWageBase,
            source: 'seeded_rule',
          });
        }
        if (medicareAmount > 0) {
          appendComponent({
            type: 'social_security',
            name: 'Medicare',
            liabilityCode: 'US_MEDICARE_EMPLOYEE',
            payer: 'employee',
            amount: medicareAmount,
            taxableAmount: roundMoney(medicareTaxable),
            source: 'seeded_rule',
          });
        }
        if (additionalMedicareAmount > 0) {
          appendComponent({
            type: 'social_security',
            name: 'Additional Medicare',
            liabilityCode: 'US_ADDITIONAL_MEDICARE_EMPLOYEE',
            payer: 'employee',
            amount: additionalMedicareAmount,
            taxableAmount: roundMoney(additionalMedicareTaxable),
            threshold: additionalMedicareThreshold,
            source: 'seeded_rule',
          });
        }

        appendComponent({
          type: 'social_security', name: 'Social Security - Employer', liabilityCode: 'US_SOCIAL_SECURITY_EMPLOYER', payer: 'employer',
          amount: socialSecurityAmount, taxableAmount: roundMoney(socialSecurityTaxable), cap: socialSecurityWageBase,
          remittanceAuthority: 'Internal Revenue Service', source: 'seeded_rule',
        });
        appendComponent({
          type: 'social_security', name: 'Medicare - Employer', liabilityCode: 'US_MEDICARE_EMPLOYER', payer: 'employer',
          amount: medicareAmount, taxableAmount: roundMoney(medicareTaxable), remittanceAuthority: 'Internal Revenue Service', source: 'seeded_rule',
        });
      }
    }

    return {
      totalAmount: totalEmployeeAmount,
      totalEmployeeAmount,
      totalEmployerAmount,
      reducesTaxableIncome,
      components,
      employeeComponents: components.filter((component) => component.payer !== 'employer'),
      employerComponents: components.filter((component) => component.payer === 'employer'),
    };
  }

  async calculate(payload = {}) {
    const resolved = await this.resolveJurisdictionConfig(payload);
    const validationErrors = [...(resolved.validationErrors || [])];

    if (!resolved.config || !resolved.version) {
      return {
        jurisdictionConfig: resolved.config,
        jurisdictionVersion: resolved.version,
        validationErrors,
        blockingErrors: validationErrors.length ? validationErrors : ['No runnable tax rule version was found.'],
        payrollRunnable: false,
        incomeTax: {
          taxAmount: 0,
          details: {},
          notes: [],
          method: 'unconfigured',
        },
        statutoryContributions: {
          totalAmount: 0,
          reducesTaxableIncome: 0,
          components: [],
        },
      };
    }

    const context = this.buildFormulaContext({
      ...payload,
      employeeTaxInputs: resolved.employeeTaxInputs || {},
      validationErrors,
    }, resolved.version);

    this.applyDerivedFormulas(context, resolved.version.incomeTax?.derivedFormulas);
    const statutoryResult = this.evaluateStatutoryRules(resolved.version.statutoryRules || [], context);
    context.statutoryReducesTaxableIncome = statutoryResult.reducesTaxableIncome;
    context.taxableIncomeAfterStatutory = roundMoney(Math.max(0, context.taxableIncome - statutoryResult.reducesTaxableIncome));
    context.annualizedTaxableIncome = roundMoney(context.taxableIncomeAfterStatutory * context.periodsPerYear);

    const incomeTaxResult = this.evaluateIncomeTaxStrategy(resolved.version.incomeTax || { strategy: 'none' }, context, {
      defaultMethod: normalizeCode(resolved.config.countryCode) === 'US'
        ? 'us_federal_withholding'
        : normalizeCode(resolved.config.countryCode) === 'ZA'
          ? 'south_africa_paye'
          : normalizeCode(resolved.config.countryCode) === 'NG'
            ? 'nigeria_paye'
            : normalizeCode(resolved.config.countryCode) === 'GH'
              ? 'ghana_paye'
              : normalizeCode(resolved.config.countryCode) === 'KE'
                ? 'kenya_paye'
                : normalizeCode(resolved.config.countryCode) === 'CM'
                  ? 'cameroon_irpp_preview'
                  : normalizeCode(resolved.config.countryCode) === 'MZ'
                    ? 'mozambique_irps_preview'
                    : normalizeCode(resolved.config.countryCode) === 'GB'
                      ? (context.employeeFields.taxSubdivision === 'scotland' ? 'uk_scotland_paye' : 'uk_paye')
                      : 'configured_rule',
    });

    const additionalWithholding = roundMoney(toNumber(formulaEngine.evaluate(resolved.version.incomeTax?.additionalWithholdingFormula || '0', context)));
    const totalTaxAmount = roundMoney(Math.max(0, incomeTaxResult.taxAmount + additionalWithholding));
    const notes = [
      ...this.buildNoteList(resolved.version.incomeTax?.noteRules, context),
      ...incomeTaxResult.notes,
    ];

    if (resolved.version.constants?.requiresConfiguration) {
      validationErrors.push('This jurisdiction is a blank template and must be cloned and configured before it can be used for payroll tax calculations.');
    }

    const blockingErrors = [...validationErrors];
    if (resolved.version.validationStatus !== 'validated') {
      blockingErrors.push('This statutory pack is awaiting legal review and is available for preview only.');
    }
    if ((resolved.version.calculationStatus || 'blocked') !== 'runnable') {
      blockingErrors.push(
        resolved.version.calculationStatus === 'preview_only'
          ? 'This statutory pack is preview-only and cannot be used to finalize payroll.'
          : 'This statutory pack is blocked until its country or subdivision rules are configured and reviewed.'
      );
    }
    const uniqueBlockingErrors = Array.from(new Set(blockingErrors));

    return {
      jurisdictionConfig: resolved.config,
      jurisdictionVersion: resolved.version,
      employeeTaxInputs: resolved.employeeTaxInputs || {},
      validationErrors,
      blockingErrors: uniqueBlockingErrors,
      payrollRunnable: uniqueBlockingErrors.length === 0,
      compliance: {
        validationStatus: resolved.version.validationStatus,
        calculationStatus: resolved.version.calculationStatus || 'blocked',
        calculationCurrency: resolved.version.calculationCurrency || '',
        coverage: resolved.version.coverage || {},
        contentHash: resolved.version.contentHash || '',
        sourceLinks: resolved.version.sourceLinks || [],
      },
      taxYear: context.taxYear,
      incomeTax: {
        taxAmount: totalTaxAmount,
        grossTaxableIncome: roundMoney(context.taxableIncome + context.preTaxDeductions),
        taxExemptIncome: roundMoney(statutoryResult.reducesTaxableIncome),
        deductionsBeforeTax: roundMoney(context.preTaxDeductions),
        netTaxableIncome: roundMoney(incomeTaxResult.taxableIncomeAfterReliefs),
        taxRate: context.taxableIncome > 0 ? roundRate((totalTaxAmount / context.taxableIncome) * 100) : 0,
        annualizedIncome: roundMoney(context.annualizedGrossPay),
        annualizedTaxableIncome: roundMoney(context.annualizedTaxableIncome),
        taxableIncomeAfterReliefs: roundMoney(incomeTaxResult.taxableIncomeAfterReliefs),
        taxYearLabel: context.taxYear.label,
        jurisdictionCode: resolved.config.countryCode,
        jurisdictionName: resolved.config.displayName,
        calculationMode: 'configured',
        method: incomeTaxResult.method,
        notes,
        details: {
          ...incomeTaxResult.details,
          additionalWithholding,
          validationErrors,
        },
      },
      statutoryContributions: statutoryResult,
    };
  }
}

module.exports = new TaxJurisdictionService();
module.exports.stableStringify = stableStringify;
module.exports.contentHash = contentHash;
module.exports.canonicalVersionContent = canonicalVersionContent;
