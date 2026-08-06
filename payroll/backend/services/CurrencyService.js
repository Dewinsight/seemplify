const ExchangeRate = require('../models/ExchangeRate');

const FALLBACK_CURRENCY_CODES = [
  'USD', 'EUR', 'GBP', 'NGN', 'KES', 'ZAR', 'GHS', 'UGX', 'TZS', 'INR',
  'AED', 'SAR', 'QAR', 'BHD', 'CAD', 'AUD', 'NZD', 'CHF', 'CNY', 'JPY',
  'HKD', 'SGD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'TRY', 'EGP', 'MAD',
  'XOF', 'XAF', 'BRL', 'MXN', 'ARS', 'CLP', 'COP', 'PEN', 'PKR', 'BDT',
  'MYR', 'THB', 'PHP', 'IDR', 'KRW',
];

const PINNED_CURRENCY_CODES = [
  'USD', 'EUR', 'GBP', 'NGN', 'KES', 'ZAR', 'GHS', 'UGX', 'TZS', 'INR',
  'AED', 'SAR', 'QAR', 'BHD', 'CAD', 'AUD', 'NZD', 'CHF', 'CNY', 'JPY',
  'HKD', 'SGD',
];

let supportedCurrencyCache = null;

function normalizeCurrencyCode(code) {
  return String(code || '').trim().toUpperCase();
}

function getIntlCurrencyCodes() {
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
      const supported = Intl.supportedValuesOf('currency') || [];
      if (supported.length > 0) {
        return supported.map(normalizeCurrencyCode);
      }
    }
  } catch (err) {
    console.warn('Failed to read Intl currency catalog, using fallback list:', err.message);
  }

  return FALLBACK_CURRENCY_CODES;
}

function getCurrencyDisplayName(code) {
  try {
    const displayNames = new Intl.DisplayNames(['en'], { type: 'currency' });
    return displayNames.of(code) || code;
  } catch (err) {
    return code;
  }
}

function getCurrencySymbol(code) {
  try {
    const parts = new Intl.NumberFormat('en', {
      style: 'currency',
      currency: code,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).formatToParts(0);

    return parts.find((part) => part.type === 'currency')?.value || code;
  } catch (err) {
    return code;
  }
}

function getCurrencyDecimals(code) {
  try {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency: code,
    }).resolvedOptions().maximumFractionDigits;
  } catch (err) {
    return 2;
  }
}

function buildCurrencyMetadata(code) {
  const normalizedCode = normalizeCurrencyCode(code);
  const name = getCurrencyDisplayName(normalizedCode);

  return {
    code: normalizedCode,
    name,
    symbol: getCurrencySymbol(normalizedCode),
    decimals: getCurrencyDecimals(normalizedCode),
    label: `${normalizedCode} - ${name}`,
  };
}

function compareCurrencies(a, b) {
  const pinnedIndexA = PINNED_CURRENCY_CODES.indexOf(a.code);
  const pinnedIndexB = PINNED_CURRENCY_CODES.indexOf(b.code);

  if (pinnedIndexA !== -1 || pinnedIndexB !== -1) {
    if (pinnedIndexA === -1) return 1;
    if (pinnedIndexB === -1) return -1;
    return pinnedIndexA - pinnedIndexB;
  }

  return a.code.localeCompare(b.code);
}

/**
 * Currency Service
 * Handles currency conversion and exchange rate management
 */
class CurrencyService {
  buildSupportedCurrencyCatalog() {
    if (supportedCurrencyCache) {
      return supportedCurrencyCache;
    }

    const codes = Array.from(new Set(getIntlCurrencyCodes().map(normalizeCurrencyCode)))
      .filter((code) => code.length === 3);

    supportedCurrencyCache = codes
      .map(buildCurrencyMetadata)
      .sort(compareCurrencies);

    return supportedCurrencyCache;
  }

  /**
   * Get all supported currencies
   */
  getSupportedCurrencies() {
    return this.buildSupportedCurrencyCatalog();
  }

  /**
   * Get all supported currency codes
   */
  getSupportedCurrencyCodes() {
    return this.getSupportedCurrencies().map((currency) => currency.code);
  }

  /**
   * Get currency info by code
   */
  getCurrencyInfo(code) {
    const normalizedCode = normalizeCurrencyCode(code);
    return this.getSupportedCurrencies().find((currency) => currency.code === normalizedCode)
      || (normalizedCode.length === 3 ? buildCurrencyMetadata(normalizedCode) : null);
  }

  /**
   * Format amount with currency symbol
   */
  formatAmount(amount, currencyCode) {
    const numericAmount = Number(amount || 0);
    const normalizedCode = normalizeCurrencyCode(currencyCode) || 'USD';

    try {
      return new Intl.NumberFormat('en', {
        style: 'currency',
        currency: normalizedCode,
      }).format(numericAmount);
    } catch (err) {
      const currency = this.getCurrencyInfo(normalizedCode);
      const decimals = currency?.decimals ?? 2;
      return `${normalizedCode} ${numericAmount.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}`;
    }
  }

  /**
   * Convert amount between currencies
   */
  async convert(organizationId, amount, fromCurrency, toCurrency, date = new Date()) {
    const normalizedFrom = normalizeCurrencyCode(fromCurrency);
    const normalizedTo = normalizeCurrencyCode(toCurrency);

    if (!normalizedFrom || !normalizedTo) {
      throw new Error('Both source and target currencies are required');
    }

    if (normalizedFrom === normalizedTo) {
      return {
        originalAmount: amount,
        originalCurrency: normalizedFrom,
        convertedAmount: amount,
        targetCurrency: normalizedTo,
        rate: 1,
        direct: true,
      };
    }

    return ExchangeRate.convert(organizationId, amount, normalizedFrom, normalizedTo, date);
  }

  /**
   * Get current exchange rate
   */
  async getRate(organizationId, fromCurrency, toCurrency, date = new Date()) {
    return ExchangeRate.getCurrentRate(
      organizationId,
      normalizeCurrencyCode(fromCurrency),
      normalizeCurrencyCode(toCurrency),
      date
    );
  }

  /**
   * Get all active rates for organization
   */
  async getActiveRates(organizationId, baseCurrency = null) {
    return ExchangeRate.getActiveRates(
      organizationId,
      baseCurrency ? normalizeCurrencyCode(baseCurrency) : null
    );
  }

  /**
   * Set exchange rate
   */
  async setRate(organizationId, baseCurrency, targetCurrency, rate, options = {}) {
    const normalizedBase = normalizeCurrencyCode(baseCurrency);
    const normalizedTarget = normalizeCurrencyCode(targetCurrency);

    if (!normalizedBase || !normalizedTarget) {
      throw new Error('Both base and target currencies are required');
    }

    if (normalizedBase === normalizedTarget) {
      throw new Error('Base and target currency must be different');
    }

    const deactivateQuery = {
      organizationId,
      baseCurrency: normalizedBase,
      targetCurrency: normalizedTarget,
      isActive: true,
    };

    if (options.source === 'api' && options.preserveManualOverrides !== false) {
      deactivateQuery.source = { $ne: 'manual' };
    }

    await ExchangeRate.updateMany(
      deactivateQuery,
      {
        isActive: false,
        updatedAt: new Date(),
      }
    );

    const exchangeRate = new ExchangeRate({
      organizationId,
      baseCurrency: normalizedBase,
      targetCurrency: normalizedTarget,
      rate,
      effectiveDate: options.effectiveDate || new Date(),
      expiresAt: options.expiresAt,
      source: options.source || 'manual',
      notes: options.notes,
      createdBy: options.createdBy,
      createdByName: options.createdByName,
      isActive: true,
    });

    await exchangeRate.save();
    return exchangeRate;
  }

  /**
   * Bulk set rates (e.g., from API)
   */
  async setBulkRates(organizationId, baseCurrency, rates, options = {}) {
    const normalizedBase = normalizeCurrencyCode(baseCurrency);
    const results = [];

    for (const [targetCurrency, rate] of Object.entries(rates || {})) {
      const normalizedTarget = normalizeCurrencyCode(targetCurrency);
      if (!normalizedTarget || normalizedTarget === normalizedBase) {
        continue;
      }

      const result = await this.setRate(
        organizationId,
        normalizedBase,
        normalizedTarget,
        rate,
        options
      );
      results.push(result);
    }

    return results;
  }

  /**
   * Calculate payroll in multiple currencies
   */
  async convertPayrollAmount(organizationId, amount, employeeCurrency, orgBaseCurrency) {
    const normalizedEmployeeCurrency = normalizeCurrencyCode(employeeCurrency);
    const normalizedBaseCurrency = normalizeCurrencyCode(orgBaseCurrency);

    if (normalizedEmployeeCurrency === normalizedBaseCurrency) {
      return {
        originalAmount: amount,
        originalCurrency: normalizedEmployeeCurrency,
        convertedAmount: amount,
        baseCurrency: normalizedBaseCurrency,
        rate: 1,
      };
    }

    const conversion = await this.convert(
      organizationId,
      amount,
      normalizedEmployeeCurrency,
      normalizedBaseCurrency
    );

    return {
      originalAmount: amount,
      originalCurrency: normalizedEmployeeCurrency,
      convertedAmount: conversion.convertedAmount,
      baseCurrency: normalizedBaseCurrency,
      rate: conversion.rate,
    };
  }
}

module.exports = new CurrencyService();
