const ExchangeRate = require('../models/ExchangeRate');
const Payslip = require('../models/Payslip');

const REPORT_LOCKED_PAYSLIP_STATUSES = Object.freeze(['approved', 'exported', 'paid']);

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

function immutableRateError() {
  const error = new Error('An exchange rate already exists at this exact effective time. Historical rates are immutable; add the correction with a later effective time.');
  error.code = 'EXCHANGE_RATE_IMMUTABLE';
  error.statusCode = 409;
  return error;
}

function historicalReportLockError() {
  const error = new Error('This effective time is on or before an approved or finalized payroll payment date. Adding the rate would restate historical payroll reports; use a later effective time.');
  error.code = 'EXCHANGE_RATE_HISTORY_LOCKED';
  error.statusCode = 409;
  return error;
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

  isSupportedCurrencyCode(code) {
    const normalizedCode = normalizeCurrencyCode(code);
    return this.getSupportedCurrencyCodes().includes(normalizedCode);
  }

  /**
   * Get currency info by code
   */
  getCurrencyInfo(code) {
    const normalizedCode = normalizeCurrencyCode(code);
    return this.getSupportedCurrencies().find((currency) => currency.code === normalizedCode)
      || (normalizedCode.length === 3 ? buildCurrencyMetadata(normalizedCode) : null);
  }

  getMinorUnits(code) {
    const currency = this.getCurrencyInfo(code);
    return Number.isInteger(currency?.decimals) ? currency.decimals : 2;
  }

  roundAmount(amount, currencyCode) {
    const numericAmount = Number(amount || 0);
    const precision = this.getMinorUnits(currencyCode);
    const factor = 10 ** precision;
    return Math.round((numericAmount + Number.EPSILON) * factor) / factor;
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

    const numericRate = Number(rate);
    if (!Number.isFinite(numericRate) || numericRate <= 0) {
      throw new Error('Exchange rate must be a finite number greater than zero');
    }
    const effectiveDate = options.effectiveDate ? new Date(options.effectiveDate) : new Date();
    if (Number.isNaN(effectiveDate.getTime())) {
      throw new Error('Exchange-rate effective date is invalid');
    }
    const requestedExpiry = options.expiresAt ? new Date(options.expiresAt) : null;
    if (requestedExpiry && (Number.isNaN(requestedExpiry.getTime()) || requestedExpiry < effectiveDate)) {
      throw new Error('Exchange-rate expiry must be on or after its effective date');
    }
    const source = options.source || 'manual';
    const timelineQuery = {
      organizationId,
      baseCurrency: normalizedBase,
      targetCurrency: normalizedTarget,
    };

    const existingAtDate = await ExchangeRate.findOne({ ...timelineQuery, effectiveDate });
    if (existingAtDate) {
      if (Number(existingAtDate.rate) === numericRate && existingAtDate.isActive !== false) {
        // Treat a retry as a repair operation, not an opportunity to change
        // the already-persisted expiry of an immutable point.
        await this.reconcileRateWindow(
          existingAtDate,
          timelineQuery,
          existingAtDate.expiresAt || null
        );
        return existingAtDate;
      }
      throw immutableRateError();
    }

    // Approved/finalized reports currently resolve their stored payslip values
    // through the immutable rate timeline. Refuse a new point that could alter
    // any such historical payment-date conversion.
    const lockedPayroll = await Payslip.exists({
      organizationId,
      status: { $in: REPORT_LOCKED_PAYSLIP_STATUSES },
      'payPeriod.paymentDate': { $gte: effectiveDate },
    });
    if (lockedPayroll) {
      throw historicalReportLockError();
    }

    const exchangeRate = new ExchangeRate({
      organizationId,
      baseCurrency: normalizedBase,
      targetCurrency: normalizedTarget,
      rate: numericRate,
      effectiveDate,
      expiresAt: requestedExpiry,
      source,
      notes: options.notes,
      createdBy: options.createdBy,
      createdByName: options.createdByName,
      isActive: true,
    });

    try {
      // Insert first. If the boundary update below is interrupted, the newer
      // row still wins deterministic as-of lookup; updating the older row
      // first could instead create a historical coverage gap.
      await exchangeRate.save();
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const concurrent = await ExchangeRate.findOne({ ...timelineQuery, effectiveDate });
      if (concurrent && Number(concurrent.rate) === numericRate && concurrent.isActive !== false) {
        await this.reconcileRateWindow(
          concurrent,
          timelineQuery,
          concurrent.expiresAt || null
        );
        return concurrent;
      }
      throw immutableRateError();
    }

    await this.reconcileRateWindow(exchangeRate, timelineQuery, requestedExpiry);

    return exchangeRate;
  }

  async reconcileRateWindow(exchangeRate, timelineQuery, requestedExpiry = null) {
    const effectiveDate = new Date(exchangeRate.effectiveDate);
    const nextRate = await ExchangeRate.findOne({
      ...timelineQuery,
      _id: { $ne: exchangeRate._id },
      isActive: true,
      effectiveDate: { $gt: effectiveDate },
    }).sort({ effectiveDate: 1 });
    const nextBoundary = nextRate
      ? new Date(new Date(nextRate.effectiveDate).getTime() - 1)
      : null;
    const expiresAt = requestedExpiry && nextBoundary
      ? new Date(Math.min(requestedExpiry.getTime(), nextBoundary.getTime()))
      : (requestedExpiry || nextBoundary);

    if (expiresAt) {
      await ExchangeRate.updateOne(
        { _id: exchangeRate._id, isActive: true },
        { $set: { expiresAt } }
      );
      exchangeRate.expiresAt = expiresAt;
    }

    // This happens only after the new row exists. If this update is interrupted,
    // latest-effective-date lookup still selects the inserted row, and an
    // idempotent retry repairs the windows.
    await ExchangeRate.updateMany({
      ...timelineQuery,
      _id: { $ne: exchangeRate._id },
      isActive: true,
      effectiveDate: { $lt: effectiveDate },
      $or: [
        { expiresAt: { $exists: false } },
        { expiresAt: null },
        { expiresAt: { $gte: effectiveDate } },
      ],
    }, {
      $set: { expiresAt: new Date(effectiveDate.getTime() - 1) },
    });
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
