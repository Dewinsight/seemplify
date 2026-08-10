const currencyService = require('./CurrencyService');
const organizationCurrencyService = require('./OrganizationCurrencyService');

const AMOUNT_KEYS = Object.freeze([
  'grossPay',
  'netPay',
  'totalDeductions',
  'totalTax',
  'totalEmployerContributions',
  'totalEmployerCost',
]);

function normalizeCurrencyCode(value, fallback = 'USD') {
  return String(value || fallback || 'USD').trim().toUpperCase() || fallback;
}

function finiteAmount(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function roundAmount(value, minorUnits = 2) {
  const precision = Number.isInteger(minorUnits) ? minorUnits : 2;
  const factor = 10 ** precision;
  return Math.round((finiteAmount(value) + Number.EPSILON) * factor) / factor;
}

function sumIncomeTaxDeductions(payslip) {
  return (payslip?.deductions || [])
    .filter((item) => item?.type === 'income_tax')
    .reduce((sum, item) => sum + finiteAmount(item?.amount), 0);
}

function getTaxAmount(payslip) {
  const rawTax = payslip?.taxBreakdown?.taxAmount;
  if (rawTax === null || rawTax === undefined || rawTax === '') {
    return sumIncomeTaxDeductions(payslip);
  }
  const explicitTax = Number(rawTax);
  return Number.isFinite(explicitTax) ? explicitTax : sumIncomeTaxDeductions(payslip);
}

function extractAmounts(payslip) {
  const grossPay = finiteAmount(payslip?.earningsSummary?.grossPay);
  const rawCashGrossPay = payslip?.earningsSummary?.cashGrossPay;
  const cashGrossPay = rawCashGrossPay === null || rawCashGrossPay === undefined
    ? grossPay
    : finiteAmount(rawCashGrossPay);
  const totalEmployerContributions = finiteAmount(payslip?.totalEmployerContributions);
  return {
    grossPay,
    netPay: finiteAmount(payslip?.netPay),
    totalDeductions: finiteAmount(payslip?.deductionsSummary?.totalDeductions),
    totalTax: getTaxAmount(payslip),
    totalEmployerContributions,
    totalEmployerCost: cashGrossPay + totalEmployerContributions,
  };
}

function emptyAmounts(value = 0) {
  return AMOUNT_KEYS.reduce((result, key) => {
    result[key] = value;
    return result;
  }, {});
}

function addAmounts(target, amounts) {
  AMOUNT_KEYS.forEach((key) => {
    target[key] = finiteAmount(target[key]) + finiteAmount(amounts?.[key]);
  });
}

function roundAmounts(amounts, minorUnits) {
  return AMOUNT_KEYS.reduce((result, key) => {
    result[key] = roundAmount(amounts?.[key], minorUnits);
    return result;
  }, {});
}

function isValidDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function paymentDateFor(payslip) {
  const rawPaymentDate = payslip?.payPeriod?.paymentDate;
  if (rawPaymentDate === null || rawPaymentDate === undefined || rawPaymentDate === '') return null;
  const paymentDate = new Date(rawPaymentDate);
  return isValidDate(paymentDate) ? paymentDate : null;
}

function payslipReference(payslip) {
  return String(payslip?.payslipNumber || payslip?._id || '').trim() || null;
}

class PayrollReportingService {
  async preparePayslips(organizationId, payslips = [], options = {}) {
    const policy = await organizationCurrencyService.getPolicy(organizationId);
    const requestedCurrency = normalizeCurrencyCode(
      options.reportingCurrency || policy.reportingCurrency || policy.functionalCurrency
    );
    const reportingCurrency = await organizationCurrencyService.assertReportingCurrency(
      organizationId,
      requestedCurrency
    );
    const reportingMinorUnits = await organizationCurrencyService.getMinorUnits(
      organizationId,
      reportingCurrency
    );
    const rateCache = new Map();
    const minorUnitCache = new Map([[reportingCurrency, reportingMinorUnits]]);

    const getMinorUnits = async (currency) => {
      if (!minorUnitCache.has(currency)) {
        minorUnitCache.set(
          currency,
          await organizationCurrencyService.getMinorUnits(organizationId, currency)
        );
      }
      return minorUnitCache.get(currency);
    };

    const getRate = async (sourceCurrency, paymentDate) => {
      if (sourceCurrency === reportingCurrency) {
        return { rate: 1, direct: true, exchangeRateId: null, rateLegs: [] };
      }
      if (!paymentDate) {
        throw new Error('A valid payslip payment date is required for historical currency conversion.');
      }

      const key = `${sourceCurrency}|${reportingCurrency}|${paymentDate.toISOString().slice(0, 10)}`;
      if (!rateCache.has(key)) {
        rateCache.set(key, currencyService.convert(
          organizationId,
          1,
          sourceCurrency,
          reportingCurrency,
          paymentDate
        ));
      }
      return rateCache.get(key);
    };

    const rows = [];
    for (const payslip of payslips || []) {
      const sourceCurrency = String(payslip?.currency || '').trim().toUpperCase() || 'UNKNOWN';
      const sourceAmounts = extractAmounts(payslip);
      const paymentDate = paymentDateFor(payslip);
      let sourceMinorUnits = 2;
      let conversion = null;
      let convertedAmounts = null;
      let conversionWarning = null;
      let warningCode = 'MISSING_EXCHANGE_RATE';

      try {
        if (sourceCurrency === 'UNKNOWN') {
          warningCode = 'MISSING_SOURCE_CURRENCY';
          throw new Error('The payslip does not contain a source currency.');
        }
        try {
          sourceMinorUnits = await getMinorUnits(sourceCurrency);
        } catch (error) {
          warningCode = 'CURRENCY_CONFIGURATION_ERROR';
          throw error;
        }
        if (sourceCurrency !== reportingCurrency && !paymentDate) {
          warningCode = 'MISSING_PAYMENT_DATE';
        }
        conversion = await getRate(sourceCurrency, paymentDate);
        const rate = Number(conversion?.rate);
        if (!Number.isFinite(rate) || rate <= 0) {
          throw new Error(`Invalid exchange rate returned for ${sourceCurrency} to ${reportingCurrency}.`);
        }
        convertedAmounts = AMOUNT_KEYS.reduce((result, key) => {
          result[key] = roundAmount(sourceAmounts[key] * rate, reportingMinorUnits);
          return result;
        }, {});
      } catch (error) {
        conversionWarning = {
          code: warningCode,
          message: error.message,
          payslipId: payslipReference(payslip),
          fromCurrency: sourceCurrency,
          toCurrency: reportingCurrency,
          paymentDate: paymentDate ? paymentDate.toISOString() : null,
        };
      }

      rows.push({
        payslip,
        sourceCurrency,
        sourceMinorUnits,
        sourceAmounts: roundAmounts(sourceAmounts, sourceMinorUnits),
        paymentDate,
        reportingCurrency,
        reportingMinorUnits,
        reportingRate: convertedAmounts ? Number(conversion.rate) : null,
        rateMetadata: convertedAmounts ? {
          direct: conversion.direct !== false,
          via: conversion.via || null,
          effectiveDate: conversion.effectiveDate || null,
          exchangeRateId: conversion.exchangeRateId || null,
          rateLegs: conversion.rateLegs || [],
        } : null,
        convertedAmounts,
        conversionWarning,
      });
    }

    return {
      rows,
      ...this.aggregatePreparedRows(rows, { reportingCurrency, reportingMinorUnits }),
    };
  }

  aggregatePreparedRows(rows = [], options = {}) {
    const reportingCurrency = normalizeCurrencyCode(
      options.reportingCurrency || rows[0]?.reportingCurrency
    );
    const reportingMinorUnits = Number.isInteger(options.reportingMinorUnits)
      ? options.reportingMinorUnits
      : (rows[0]?.reportingMinorUnits ?? 2);
    const bucketMap = new Map();
    const reportingTotals = emptyAmounts();
    const conversionWarnings = [];
    const employees = new Set();

    rows.forEach((row) => {
      const currency = normalizeCurrencyCode(row?.sourceCurrency);
      const bucket = bucketMap.get(currency) || {
        currency,
        minorUnits: row?.sourceMinorUnits ?? 2,
        payslipCount: 0,
        employeeIds: new Set(),
        amounts: emptyAmounts(),
      };
      bucket.payslipCount += 1;
      if (row?.payslip?.userId !== undefined && row?.payslip?.userId !== null) {
        const employeeId = String(row.payslip.userId);
        bucket.employeeIds.add(employeeId);
        employees.add(employeeId);
      }
      addAmounts(bucket.amounts, row?.sourceAmounts);
      bucketMap.set(currency, bucket);

      if (row?.convertedAmounts) {
        addAmounts(reportingTotals, row.convertedAmounts);
      } else if (row?.conversionWarning) {
        conversionWarnings.push(row.conversionWarning);
      }
    });

    const currencyBreakdown = Array.from(bucketMap.values())
      .map((bucket) => ({
        currency: bucket.currency,
        minorUnits: bucket.minorUnits,
        payslipCount: bucket.payslipCount,
        employeeCount: bucket.employeeIds.size,
        ...roundAmounts(bucket.amounts, bucket.minorUnits),
      }))
      .sort((a, b) => a.currency.localeCompare(b.currency));
    const hasAggregateTotals = conversionWarnings.length === 0;
    const currencies = currencyBreakdown.map((entry) => entry.currency);

    return {
      reportingCurrency,
      reportingMinorUnits,
      currency: reportingCurrency,
      hasAggregateTotals,
      isMultiCurrency: currencies.length > 1,
      currencies,
      unconvertedCurrencies: Array.from(new Set(
        conversionWarnings.map((warning) => warning.fromCurrency).filter(Boolean)
      )).sort(),
      conversionWarnings,
      currencyBreakdown,
      payslipCount: rows.length,
      employeeCount: employees.size,
      totals: hasAggregateTotals
        ? roundAmounts(reportingTotals, reportingMinorUnits)
        : emptyAmounts(null),
    };
  }

  aggregateLineItems(rows = [], fieldName) {
    if (!['earnings', 'deductions', 'employerContributions'].includes(fieldName)) {
      throw new Error('Unsupported payroll line-item collection.');
    }

    const groups = new Map();
    rows.forEach((row) => {
      (row?.payslip?.[fieldName] || []).forEach((item) => {
        const type = String(item?.type || 'other');
        const name = String(item?.name || type);
        const key = `${type}|${name}`;
        const group = groups.get(key) || {
          type,
          name,
          native: new Map(),
          reportingTotal: 0,
          hasAggregateTotals: true,
          conversionWarnings: [],
          reportingCurrency: row.reportingCurrency,
          reportingMinorUnits: row.reportingMinorUnits,
        };
        const amount = finiteAmount(item?.amount);
        const nativeEntry = group.native.get(row.sourceCurrency) || {
          total: 0,
          minorUnits: row.sourceMinorUnits,
        };
        nativeEntry.total += amount;
        group.native.set(row.sourceCurrency, nativeEntry);
        if (row.convertedAmounts && Number.isFinite(row.reportingRate)) {
          group.reportingTotal += roundAmount(amount * row.reportingRate, row.reportingMinorUnits);
        } else if (amount !== 0) {
          group.hasAggregateTotals = false;
          if (row.conversionWarning) group.conversionWarnings.push(row.conversionWarning);
        }
        groups.set(key, group);
      });
    });

    return Array.from(groups.values()).map((group) => ({
      type: group.type,
      name: group.name,
      currency: group.reportingCurrency,
      total: group.hasAggregateTotals
        ? roundAmount(group.reportingTotal, group.reportingMinorUnits)
        : null,
      hasAggregateTotals: group.hasAggregateTotals,
      conversionWarnings: group.conversionWarnings,
      currencyBreakdown: Array.from(group.native.entries())
        .map(([currency, entry]) => ({
          currency,
          total: roundAmount(entry.total, entry.minorUnits),
        }))
        .sort((a, b) => a.currency.localeCompare(b.currency)),
    }));
  }
}

module.exports = new PayrollReportingService();
module.exports.PayrollReportingService = PayrollReportingService;
module.exports.AMOUNT_KEYS = AMOUNT_KEYS;
