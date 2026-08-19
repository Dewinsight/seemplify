'use strict';

const PayrollEmployerEntity = require('../models/PayrollEmployerEntity');
const employerEntityService = require('./PayrollEmployerEntityService');
const organizationCurrencyService = require('./OrganizationCurrencyService');
const taxJurisdictionService = require('./TaxJurisdictionService');
const { normalizeTaxCountry } = require('./tax/TaxCurrencyCatalog');

const AUTO_REVIEW_PREFIX = 'Automatic payroll setup: ';
const MANUAL_REVIEW_MARKER = ' Manual review: ';
const MANUAL_EXCLUSION_REASON = 'Excluded from payroll run by payroll admin.';
const LEGACY_AUTOMATIC_EXCLUSION_REASONS = new Set([
  'Automatically excluded from payroll until onboarding is completed.',
  'Automatically excluded from payroll until a payroll profile is created.',
  'Automatically excluded from payroll until payroll configuration is prepared.',
  'Automatically excluded from payroll until payroll setup is completed.',
]);

const BANK_RULES = Object.freeze({
  US: Object.freeze({ accountLabel: 'Account number', accountPattern: /^\d{4,17}$/, localLabel: '9-digit ABA routing number', localKey: 'routingNumber', localPattern: /^\d{9}$/ }),
  GB: Object.freeze({ accountLabel: '8-digit account number', accountPattern: /^\d{8}$/, localLabel: '6-digit sort code', localKey: 'branchCode', localPattern: /^\d{6}$/ }),
  NG: Object.freeze({ accountLabel: '10-digit NUBAN account number', accountPattern: /^\d{10}$/, localLabel: '3-digit bank code', localKey: 'branchCode', localPattern: /^\d{3}$/ }),
  GH: Object.freeze({ accountLabel: 'Account number', accountPattern: /^[A-Z0-9-]{6,24}$/i, localLabel: 'Bank or branch code', localKey: 'branchCode', localPattern: /^[A-Z0-9-]{3,12}$/i }),
  KE: Object.freeze({ accountLabel: 'Account number', accountPattern: /^[A-Z0-9-]{6,24}$/i, localLabel: 'Bank or branch code', localKey: 'branchCode', localPattern: /^[A-Z0-9-]{3,12}$/i }),
  ZA: Object.freeze({ accountLabel: 'Account number', accountPattern: /^\d{5,16}$/, localLabel: '6-digit branch code', localKey: 'branchCode', localPattern: /^\d{6}$/ }),
  CA: Object.freeze({ accountLabel: 'Account number', accountPattern: /^[A-Z0-9-]{5,20}$/i, localLabel: 'Institution and transit number', localKey: 'branchCode', localPattern: /^(?:0\d{8}|\d{8})$/ }),
  CM: Object.freeze({ accountLabel: 'Account or RIB number', accountPattern: /^[A-Z0-9-]{6,34}$/i, localLabel: 'Bank or branch code', localKey: 'branchCode', localPattern: /^[A-Z0-9-]{2,12}$/i }),
  MZ: Object.freeze({ accountLabel: 'Account or NIB number', accountPattern: /^[A-Z0-9-]{6,34}$/i, localLabel: '', localKey: '', localPattern: null }),
  EU: Object.freeze({ accountLabel: 'IBAN', accountPattern: null, localLabel: '', localKey: '', localPattern: null, requiresIban: true }),
});

function serviceError(message, code, details = {}) {
  const error = new Error(message);
  error.statusCode = 422;
  error.code = code;
  error.details = details;
  return error;
}

function plain(value) {
  return value?.toObject?.() || value || {};
}

function text(value) {
  return String(value || '').trim();
}

function compact(value) {
  return text(value).replace(/[\s-]+/g, '');
}

function hasBankValue(account = {}) {
  return ['bankName', 'accountName', 'accountNumber', 'branchCode', 'routingNumber', 'iban', 'swiftCode']
    .some((field) => text(account[field]));
}

function isValidIban(value) {
  const iban = compact(value).toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let remainder = 0;
  for (const character of rearranged) {
    const part = /[A-Z]/.test(character) ? String(character.charCodeAt(0) - 55) : character;
    for (const digit of part) remainder = ((remainder * 10) + Number(digit)) % 97;
  }
  return remainder === 1;
}

function isValidAbaRoutingNumber(value) {
  const digits = compact(value);
  if (!/^\d{9}$/.test(digits)) return false;
  const checksum = digits.split('').reduce((sum, digit, index) => (
    sum + (Number(digit) * [3, 7, 1][index % 3])
  ), 0);
  return checksum > 0 && checksum % 10 === 0;
}

function validateBankAccount(account = {}, expectedCountryCode = '') {
  if (!hasBankValue(account)) return { complete: false, errors: [] };
  const definition = normalizeTaxCountry(account.countryCode || account.country || expectedCountryCode);
  if (!definition) {
    throw serviceError('Select a supported payroll bank country.', 'PAYROLL_BANK_COUNTRY_UNSUPPORTED');
  }
  if (expectedCountryCode && definition.countryCode !== expectedCountryCode) {
    throw serviceError(
      `The salary account country must match the employee payroll country (${expectedCountryCode}).`,
      'PAYROLL_BANK_COUNTRY_MISMATCH',
      { expectedCountryCode, receivedCountryCode: definition.countryCode }
    );
  }

  const rule = BANK_RULES[definition.countryCode];
  const errors = [];
  if (!text(account.bankName)) errors.push('Bank name is required.');
  if (!text(account.accountName)) errors.push('Account holder name is required.');

  const accountNumber = compact(account.accountNumber);
  const iban = compact(account.iban).toUpperCase();
  if (rule?.requiresIban) {
    if (!iban) errors.push('IBAN is required.');
    else if (!isValidIban(iban)) errors.push('Enter a valid IBAN.');
  } else if (!accountNumber) {
    errors.push(`${rule?.accountLabel || 'Account number'} is required.`);
  } else if (rule?.accountPattern && !rule.accountPattern.test(accountNumber)) {
    errors.push(`Enter a valid ${rule.accountLabel.toLowerCase()}.`);
  }

  if (rule?.localKey) {
    const localValue = compact(account[rule.localKey]);
    if (!localValue) errors.push(`${rule.localLabel} is required.`);
    else if (rule.localPattern && !rule.localPattern.test(localValue)) errors.push(`Enter a valid ${rule.localLabel.toLowerCase()}.`);
    if (definition.countryCode === 'US' && localValue && !isValidAbaRoutingNumber(localValue)) {
      errors.push('The ABA routing-number checksum is invalid.');
    }
  }
  if (iban && !isValidIban(iban)) errors.push('Enter a valid IBAN.');
  if (text(account.swiftCode) && !/^[A-Z0-9]{8}(?:[A-Z0-9]{3})?$/i.test(compact(account.swiftCode))) {
    errors.push('SWIFT/BIC must contain 8 or 11 letters and numbers.');
  }
  if (errors.length) {
    throw serviceError(errors.join(' '), 'PAYROLL_BANK_DETAILS_INVALID', { errors });
  }
  return { complete: true, errors: [], country: definition };
}

async function findAutomaticEmployer(organizationId, countryCode) {
  const candidates = await PayrollEmployerEntity.find({
    organizationId,
    countryCode,
    status: { $ne: 'inactive' },
  }).sort({ status: 1, legalName: 1 });
  const active = candidates.filter((entry) => entry.status === 'active');
  if (active.length === 1) return { entity: active[0], ambiguous: false };
  if (active.length > 1) return { entity: null, ambiguous: true };
  if (candidates.length === 1) return { entity: candidates[0], ambiguous: false };
  return { entity: null, ambiguous: candidates.length > 1 };
}

async function reconcileProfile(profile, organizationId, options = {}) {
  const requestedCountry = normalizeTaxCountry(
    options.countryHint
      || profile.taxAssignment?.workCountryCode
      || profile.employeeInfo?.countryCode
      || profile.bankAccounts?.[0]?.country
  );
  let employer = null;
  if (profile.employerEntityId) {
    employer = await PayrollEmployerEntity.findOne({
      _id: profile.employerEntityId,
      organizationId,
      status: { $ne: 'inactive' },
    });
  }

  let employerCountry = employer ? normalizeTaxCountry(employer.countryCode) : null;
  if (employer && requestedCountry && employerCountry?.countryCode !== requestedCountry.countryCode) {
    employer = null;
    employerCountry = null;
    profile.employerEntityId = null;
  }
  const country = requestedCountry || employerCountry;
  if (!country) {
    profile.currency = await organizationCurrencyService.assertPaymentCurrency(organizationId, profile.currency || 'USD');
    return { country: null, employer, employerAmbiguous: false, paymentReady: true, bankComplete: false, taxErrors: [] };
  }

  let employerAmbiguous = false;
  if (!employer && options.autoAssignEmployer !== false) {
    const automatic = await findAutomaticEmployer(organizationId, country.countryCode);
    employer = automatic.entity;
    employerAmbiguous = automatic.ambiguous;
    if (!employer && !employerAmbiguous && options.autoCreateEmployer) {
      employer = await employerEntityService.ensureDefaultDraft(
        organizationId,
        country.countryCode,
        options.actor || {}
      );
    }
    if (employer) profile.employerEntityId = employer._id;
  }

  const currencyCode = String(employer?.defaultCurrency || country.currencyCode).toUpperCase();
  let paymentReady = true;
  try {
    profile.currency = await organizationCurrencyService.assertPaymentCurrency(organizationId, currencyCode);
  } catch (error) {
    if (organizationCurrencyService.getIsoCurrency(currencyCode)?.decimals !== 2) {
      profile.currency = currencyCode;
      paymentReady = false;
    } else {
      throw error;
    }
  }

  const currentTaxConfig = plain(profile.taxConfig);
  const requestedConfigId = employer?.taxJurisdictionConfigId || '';
  const taxResolution = await taxJurisdictionService.resolveJurisdictionConfig({
    organizationId,
    taxConfig: {
      ...currentTaxConfig,
      calculationMode: 'configured',
      jurisdictionCode: country.countryCode,
      jurisdictionConfigId: requestedConfigId,
      jurisdictionVersionId: '',
    },
    paymentDate: options.paymentDate || new Date(),
  });
  const config = taxResolution.config;
  const taxErrors = Array.isArray(taxResolution.validationErrors) ? taxResolution.validationErrors : [];
  profile.taxConfig = {
    ...currentTaxConfig,
    calculationMode: 'configured',
    jurisdictionCode: country.countryCode,
    jurisdictionName: config?.displayName || config?.countryName || country.countryName,
    jurisdictionConfigId: config?._id || requestedConfigId || null,
    jurisdictionVersionId: null,
    employeeTaxInputs: taxResolution.employeeTaxInputs || currentTaxConfig.employeeTaxInputs || {},
    taxValidation: {
      status: taxErrors.length ? 'warning' : 'valid',
      messages: taxErrors,
      validatedAt: new Date(),
    },
  };
  profile.taxAssignment = {
    ...plain(profile.taxAssignment),
    workCountryCode: country.countryCode,
    workJurisdictionCode: employer?.jurisdictionCode || country.countryCode,
    taxJurisdictionCode: employer?.jurisdictionCode || country.countryCode,
    determinationReason: text(profile.taxAssignment?.determinationReason)
      || `Automatically determined from the employee payroll country (${country.countryName}).`,
    effectiveFrom: profile.taxAssignment?.effectiveFrom || new Date(),
  };
  profile.employeeInfo = {
    ...plain(profile.employeeInfo),
    countryCode: country.countryCode,
    countryName: country.countryName,
  };

  const statutory = plain(profile.statutoryContributions);
  if (country.countryCode === 'NG') {
    profile.statutoryContributions = {
      ...statutory,
      socialSecurityOptIn: false,
      pensionOptIn: statutory.pensionOptIn !== false,
      pensionContributionPercent: Number(statutory.pensionContributionPercent || 0) > 0
        ? Number(statutory.pensionContributionPercent)
        : 8,
      employerPensionPercent: Number(statutory.employerPensionPercent || 0) > 0
        ? Number(statutory.employerPensionPercent)
        : 10,
    };
  }

  const accounts = (profile.bankAccounts || []).map((account) => {
    const rawAccount = plain(account);
    const accountCountry = normalizeTaxCountry(rawAccount.countryCode || rawAccount.country);
    return {
      ...rawAccount,
      country: accountCountry?.bankCountry || country.bankCountry,
      countryCode: accountCountry?.countryCode || country.countryCode,
    };
  });
  profile.bankAccounts = accounts;
  let bankResult = { complete: false, errors: [] };
  if (accounts.length) {
    try {
      bankResult = validateBankAccount(
        accounts.find((account) => account.isPrimary !== false) || accounts[0],
        country.countryCode
      );
    } catch (error) {
      if (options.validateBankDetails !== false) throw error;
      bankResult = { complete: false, errors: error.details?.errors || [error.message] };
    }
  }

  return {
    country,
    employer,
    employerAmbiguous,
    paymentReady,
    bankComplete: bankResult.complete,
    bankErrors: bankResult.errors,
    taxErrors,
    taxPackStatus: taxResolution.version?.calculationStatus || 'blocked',
  };
}

function applyReadiness(profile, result = {}) {
  const flags = { ...plain(profile.payrollFlags) };
  const existingReason = text(flags.reviewReason);
  const carriedReviewReason = existingReason.startsWith(AUTO_REVIEW_PREFIX)
    ? text(existingReason.split(MANUAL_REVIEW_MARKER)[1])
    : (LEGACY_AUTOMATIC_EXCLUSION_REASONS.has(existingReason) ? '' : existingReason);
  const legacyManualExclusion = existingReason === MANUAL_EXCLUSION_REASON
    || carriedReviewReason === MANUAL_EXCLUSION_REASON;
  const manuallyExcluded = flags.excludeFromNextRun === true || legacyManualExclusion;
  const manualReviewReason = carriedReviewReason === MANUAL_EXCLUSION_REASON
    ? ''
    : carriedReviewReason;
  flags.excludeFromNextRun = manuallyExcluded;
  const blockers = [];
  if (!result.country) blockers.push('Select a supported payroll country.');
  if (!result.employer) blockers.push(result.employerAmbiguous
    ? 'More than one legal employer matches this country; select the employing entity.'
    : 'Add or select the legal employer for this payroll country.');
  if (result.paymentReady === false) blockers.push(`${profile.currency} payroll rounding is not yet certified.`);
  if (!result.bankComplete) blockers.push('Add the required local salary bank details.');
  if (result.taxErrors?.length) blockers.push('Complete the employee-specific tax fields required by the country pack.');
  if (result.taxPackStatus && result.taxPackStatus !== 'runnable') {
    blockers.push(`The selected country tax pack is ${result.taxPackStatus.replaceAll('_', ' ')}.`);
  }
  if (blockers.length) {
    flags.includeInNextRun = false;
    flags.requiresReview = true;
    flags.reviewReason = `${AUTO_REVIEW_PREFIX}${blockers.join(' ')}`
      + (manualReviewReason ? `${MANUAL_REVIEW_MARKER}${manualReviewReason}` : '');
  } else {
    flags.includeInNextRun = !manuallyExcluded && !manualReviewReason;
    flags.requiresReview = !!manualReviewReason;
    flags.reviewReason = manuallyExcluded ? MANUAL_EXCLUSION_REASON : manualReviewReason;
  }
  profile.payrollFlags = flags;
  return blockers;
}

module.exports = {
  BANK_RULES,
  applyReadiness,
  findAutomaticEmployer,
  isValidAbaRoutingNumber,
  isValidIban,
  reconcileProfile,
  validateBankAccount,
};
