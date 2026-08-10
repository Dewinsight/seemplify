'use strict';

const crypto = require('crypto');

const ALLOWED_RELEASE_STATUSES = Object.freeze([
  'blocked',
  'standalone_preview_only',
  'certification_candidate',
]);

class TaxAdapterCandidateRegistryError extends Error {
  constructor(code, message, details = {}, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'TaxAdapterCandidateRegistryError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details, cause) {
  throw new TaxAdapterCandidateRegistryError(code, message, details, cause);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function requiredText(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) fail('TAX_ADAPTER_CANDIDATE_INVALID', `${label} is required`);
  return normalized;
}

function dateOnly(value, label) {
  const normalized = requiredText(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    fail('TAX_ADAPTER_CANDIDATE_INVALID', `${label} must use YYYY-MM-DD`);
  }
  const [year, month, day] = normalized.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    fail('TAX_ADAPTER_CANDIDATE_INVALID', `${label} is not a valid calendar date`);
  }
  return normalized;
}

function canonicalize(value, stack = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('TAX_ADAPTER_CANDIDATE_NON_JSON', 'Preview payload contains a non-finite number');
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => canonicalize(item, stack));
  if (!value || typeof value !== 'object') {
    fail('TAX_ADAPTER_CANDIDATE_NON_JSON', 'Preview payload must contain JSON-compatible values only');
  }
  if (stack.has(value)) fail('TAX_ADAPTER_CANDIDATE_NON_JSON', 'Preview payload cannot contain cycles');
  stack.add(value);
  const normalized = Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key], stack)])
  );
  stack.delete(value);
  return normalized;
}

function sha256Json(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function normalizeDigest(value, label) {
  const normalized = requiredText(value, label).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    fail('TAX_ADAPTER_CANDIDATE_INVALID', `${label} must be a SHA-256 digest`);
  }
  return normalized;
}

function normalizeSources(value) {
  if (!Array.isArray(value) || value.length === 0) {
    fail('TAX_ADAPTER_CANDIDATE_INVALID', 'officialSources must contain at least one primary URL');
  }
  return [...new Set(value.map((source, index) => {
    const url = requiredText(source, `officialSources[${index}]`);
    let parsed;
    try {
      parsed = new URL(url);
    } catch (_error) {
      fail('TAX_ADAPTER_CANDIDATE_INVALID', `officialSources[${index}] is not a URL`);
    }
    if (parsed.protocol !== 'https:') {
      fail('TAX_ADAPTER_CANDIDATE_INVALID', `officialSources[${index}] must use HTTPS`);
    }
    return parsed.toString();
  }))].sort();
}

function normalizeDescriptor(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('TAX_ADAPTER_CANDIDATE_INVALID', 'Adapter descriptor must be an object');
  }
  const id = requiredText(value.id, 'id').toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_.:-]{2,127}$/.test(id)) {
    fail('TAX_ADAPTER_CANDIDATE_INVALID', 'id contains unsupported characters');
  }
  const countryCode = requiredText(value.countryCode, 'countryCode').toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    fail('TAX_ADAPTER_CANDIDATE_INVALID', 'countryCode must be ISO alpha-2');
  }
  const jurisdictionCode = requiredText(value.jurisdictionCode || countryCode, 'jurisdictionCode').toUpperCase();
  if (!/^[A-Z]{2}(?:-[A-Z0-9]{1,12})*$/.test(jurisdictionCode)) {
    fail('TAX_ADAPTER_CANDIDATE_INVALID', 'jurisdictionCode is invalid');
  }
  const currency = requiredText(value.currency, 'currency').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) fail('TAX_ADAPTER_CANDIDATE_INVALID', 'currency is invalid');
  if (![0, 2, 3].includes(value.minorUnits)) {
    fail('TAX_ADAPTER_CANDIDATE_INVALID', 'minorUnits must be 0, 2, or 3');
  }
  const releaseStatus = requiredText(value.releaseStatus, 'releaseStatus');
  if (!ALLOWED_RELEASE_STATUSES.includes(releaseStatus)) {
    fail(
      'TAX_ADAPTER_CANDIDATE_POSTING_FORBIDDEN',
      `Candidate registry cannot accept release status ${releaseStatus}`
    );
  }
  if (typeof value.calculate !== 'function') {
    fail('TAX_ADAPTER_CANDIDATE_INVALID', 'calculate must be a function');
  }
  const effectiveFrom = dateOnly(value.effectiveFrom, 'effectiveFrom');
  const effectiveTo = dateOnly(value.effectiveTo, 'effectiveTo');
  if (effectiveFrom > effectiveTo) {
    fail('TAX_ADAPTER_CANDIDATE_INVALID', 'effectiveFrom must not be after effectiveTo');
  }
  const supportedScope = Array.isArray(value.supportedScope)
    ? value.supportedScope.map((entry, index) => requiredText(entry, `supportedScope[${index}]`))
    : [];
  const blockers = Array.isArray(value.blockers)
    ? value.blockers.map((entry, index) => requiredText(entry, `blockers[${index}]`))
    : [];
  const goldenEvidence = Array.isArray(value.goldenEvidence)
    ? value.goldenEvidence.map((entry, index) => requiredText(entry, `goldenEvidence[${index}]`))
    : [];
  if (blockers.length === 0) {
    fail('TAX_ADAPTER_CANDIDATE_INVALID', 'A non-postable candidate must disclose at least one blocker');
  }

  return deepFreeze({
    id,
    countryCode,
    jurisdictionCode,
    displayName: requiredText(value.displayName, 'displayName'),
    currency,
    minorUnits: value.minorUnits,
    effectiveFrom,
    effectiveTo,
    releaseStatus,
    implementationDigestSha256: normalizeDigest(value.implementationDigestSha256, 'implementationDigestSha256'),
    fixtureDigestSha256: normalizeDigest(value.fixtureDigestSha256, 'fixtureDigestSha256'),
    fixtureSuite: requiredText(value.fixtureSuite, 'fixtureSuite'),
    officialSources: normalizeSources(value.officialSources),
    supportedScope,
    goldenEvidence,
    blockers,
    calculate: value.calculate,
  });
}

function publicDescriptor(descriptor) {
  const { calculate: _calculate, ...publicValue } = descriptor;
  return publicValue;
}

class TaxAdapterCandidateRegistry {
  constructor() {
    this.adapters = new Map();
  }

  register(value) {
    const descriptor = normalizeDescriptor(value);
    if (this.adapters.has(descriptor.id)) {
      fail('TAX_ADAPTER_CANDIDATE_DUPLICATE', `Adapter ${descriptor.id} is already registered`);
    }
    this.adapters.set(descriptor.id, descriptor);
    return deepFreeze(publicDescriptor(descriptor));
  }

  list() {
    return deepFreeze(
      [...this.adapters.values()]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((descriptor) => publicDescriptor(descriptor))
    );
  }

  get(id) {
    const normalized = requiredText(id, 'adapterId').toUpperCase();
    const descriptor = this.adapters.get(normalized);
    if (!descriptor) fail('TAX_ADAPTER_CANDIDATE_NOT_FOUND', `Adapter ${normalized} is not registered`);
    return deepFreeze(publicDescriptor(descriptor));
  }

  calculatePreview(id, input) {
    const normalized = requiredText(id, 'adapterId').toUpperCase();
    const descriptor = this.adapters.get(normalized);
    if (!descriptor) fail('TAX_ADAPTER_CANDIDATE_NOT_FOUND', `Adapter ${normalized} is not registered`);
    const canonicalInput = canonicalize(input);
    let result;
    try {
      result = descriptor.calculate(canonicalInput);
    } catch (error) {
      fail(
        'TAX_ADAPTER_CANDIDATE_CALCULATION_FAILED',
        `${normalized} rejected the preview input: ${error.message}`,
        { adapterId: normalized, adapterErrorCode: error.code || '', inputDigestSha256: sha256Json(canonicalInput) },
        error
      );
    }
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      fail('TAX_ADAPTER_CANDIDATE_UNSAFE_OUTPUT', `${normalized} returned a non-object result`);
    }
    const canonicalResult = canonicalize(result);
    if (canonicalResult.runnable === true || canonicalResult.postingAllowed === true) {
      fail(
        'TAX_ADAPTER_CANDIDATE_UNSAFE_OUTPUT',
        `${normalized} attempted to authorize payroll posting from the candidate registry`
      );
    }

    return deepFreeze({
      execution: {
        mode: 'preview_only',
        postingAllowed: false,
        adapterId: descriptor.id,
        jurisdictionCode: descriptor.jurisdictionCode,
        releaseStatus: descriptor.releaseStatus,
        implementationDigestSha256: descriptor.implementationDigestSha256,
        fixtureDigestSha256: descriptor.fixtureDigestSha256,
        inputDigestSha256: sha256Json(canonicalInput),
        outputDigestSha256: sha256Json(canonicalResult),
      },
      result: canonicalResult,
    });
  }
}

module.exports = Object.freeze({
  TaxAdapterCandidateRegistry,
  TaxAdapterCandidateRegistryError,
  ALLOWED_RELEASE_STATUSES,
  sha256Json,
});
