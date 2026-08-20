const RELATIONSHIPS = new Set(['spouse', 'domestic_partner', 'child', 'parent', 'sibling', 'other']);
const NAME_PATTERN = /^[\p{L}][\p{L}\p{M}\s.'-]*$/u;

function clean(value, maxLength = 120) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function parseDate(value) {
  const raw = clean(value, 10);
  const date = new Date(`${raw}T00:00:00.000Z`);
  return raw && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === raw ? date : null;
}

function validationError(fieldErrors) {
  const error = new Error('Check the highlighted dependent fields and try again.');
  error.statusCode = 422;
  error.code = 'DEPENDENT_VALIDATION_FAILED';
  error.details = { fieldErrors };
  return error;
}

function normalizeDependent(input = {}) {
  const fieldErrors = {};
  const name = clean(input.name);
  const relationship = clean(input.relationship, 40).toLowerCase();
  const dateOfBirth = parseDate(input.dateOfBirth);
  const beneficiaryPercentage = input.isBeneficiary ? Number(input.beneficiaryPercentage || 0) : 0;
  if (name.length < 2 || !NAME_PATTERN.test(name)) fieldErrors.name = 'Enter the dependent’s full name.';
  if (!RELATIONSHIPS.has(relationship)) fieldErrors.relationship = 'Select a valid relationship.';
  if (!dateOfBirth) fieldErrors.dateOfBirth = 'Enter a valid date of birth.';
  else if (dateOfBirth > new Date()) fieldErrors.dateOfBirth = 'Date of birth cannot be in the future.';
  if (!Number.isFinite(beneficiaryPercentage) || beneficiaryPercentage < 0 || beneficiaryPercentage > 100) fieldErrors.beneficiaryPercentage = 'Enter a percentage from 0 to 100.';
  if (Object.keys(fieldErrors).length) throw validationError(fieldErrors);
  return {
    name, relationship, dateOfBirth,
    taxDependent: input.taxDependent !== false,
    benefitEligible: input.benefitEligible !== false,
    isBeneficiary: input.isBeneficiary === true,
    beneficiaryPercentage,
  };
}

function synchronizeDependentSummary(profile, now = new Date()) {
  const dependents = Array.isArray(profile.dependents) ? profile.dependents : [];
  profile.taxConfig = profile.taxConfig || {};
  profile.taxConfig.dependents = dependents.filter((dependent) => dependent.taxDependent !== false).length;
  profile.dependentsDeclaration = {
    status: dependents.length ? 'provided' : (profile.dependentsDeclaration?.status === 'none' ? 'none' : 'pending'),
    confirmedAt: dependents.length ? (profile.dependentsDeclaration?.confirmedAt || now) : profile.dependentsDeclaration?.confirmedAt,
    lastUpdated: now,
  };
  return profile;
}

function publicDependent(dependent) {
  const value = dependent?.toObject ? dependent.toObject() : { ...dependent };
  return value;
}

module.exports = { normalizeDependent, publicDependent, synchronizeDependentSummary };
