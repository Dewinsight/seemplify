'use strict';

const crypto = require('crypto');
const { normalizeTaxCountry } = require('./tax/TaxCurrencyCatalog');
const { validateBankAccount } = require('./PayrollCountryAutomationService');

function text(value) {
  return String(value || '').trim();
}

function compact(value) {
  return text(value).replace(/[\s-]+/g, '');
}

function normalizeAccount(input = {}, fallbackCountryCode = '') {
  const country = normalizeTaxCountry(input.countryCode || input.country || fallbackCountryCode);
  if (!country) {
    const error = new Error('Select a supported payroll bank country.');
    error.statusCode = 422;
    error.code = 'PAYROLL_BANK_COUNTRY_UNSUPPORTED';
    throw error;
  }

  const account = {
    isPrimary: true,
    country: country.countryName,
    countryCode: country.countryCode,
    accountName: text(input.accountName || input.accountHolderName),
    accountNumber: compact(input.accountNumber || input.iban),
    bankName: text(input.bankName),
    branchName: text(input.branchName),
    branchCode: compact(input.branchCode || input.sortCode || input.bankCode),
    swiftCode: compact(input.swiftCode || input.bicSwift).toUpperCase(),
    routingNumber: compact(input.routingNumber),
    iban: compact(input.iban).toUpperCase(),
    accountType: ['checking', 'savings', 'current'].includes(text(input.accountType).toLowerCase())
      ? text(input.accountType).toLowerCase()
      : 'checking',
    splitPercentage: 100,
  };

  validateBankAccount(account, country.countryCode);
  return account;
}

function accountFingerprint(account = {}) {
  const stable = [
    text(account.countryCode || account.country).toUpperCase(),
    text(account.bankName).toLowerCase(),
    text(account.accountName).toLowerCase(),
    compact(account.accountNumber),
    compact(account.branchCode),
    compact(account.routingNumber),
    compact(account.iban).toUpperCase(),
    compact(account.swiftCode).toUpperCase(),
    text(account.accountType).toLowerCase(),
  ].join('|');
  return crypto.createHash('sha256').update(stable).digest('hex');
}

function accountSummary(account = {}) {
  const accountReference = compact(account.accountNumber || account.iban);
  return {
    bankName: text(account.bankName),
    countryCode: text(account.countryCode || account.country).toUpperCase(),
    accountLast4: accountReference.slice(-4),
    accountType: text(account.accountType),
  };
}

function publicAccount(account = {}) {
  return {
    isPrimary: account.isPrimary !== false,
    country: text(account.country),
    countryCode: text(account.countryCode),
    accountName: text(account.accountName),
    accountNumber: text(account.accountNumber),
    bankName: text(account.bankName),
    branchName: text(account.branchName),
    branchCode: text(account.branchCode),
    swiftCode: text(account.swiftCode),
    routingNumber: text(account.routingNumber),
    iban: text(account.iban),
    accountType: text(account.accountType) || 'checking',
    splitPercentage: Number(account.splitPercentage || 100),
    isVerified: account.isVerified === true,
    verifiedAt: account.verifiedAt || null,
  };
}

function approvalAccount(account = {}, reviewer = {}) {
  return {
    ...publicAccount(account),
    isPrimary: true,
    splitPercentage: 100,
    isVerified: true,
    verifiedAt: reviewer.reviewedAt || new Date(),
  };
}

module.exports = {
  accountFingerprint,
  accountSummary,
  approvalAccount,
  normalizeAccount,
  publicAccount,
};
