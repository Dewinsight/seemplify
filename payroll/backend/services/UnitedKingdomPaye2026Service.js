'use strict';

const statutoryMoneyService = require('./StatutoryMoneyService');
const statutoryLiabilityLedgerService = require('./StatutoryLiabilityLedgerService');

const GBP = Object.freeze({ currency: 'GBP', minorUnits: 2 });
const TAX_YEAR = '2026-27';
const TAX_YEAR_START = '2026-04-06';
const TAX_YEAR_END = '2027-04-05';

const SOURCES = Object.freeze({
  specificationPage: 'https://www.gov.uk/government/publications/payroll-technical-specifications-income-tax',
  specificationAsset: 'https://assets.publishing.service.gov.uk/media/698c9824bd090be481c2879a/PAYErout-v24-0.odt',
  testDataPage: 'https://www.gov.uk/government/publications/software-developers-payroll-test-data-2026-to-2027',
  testDataAsset: 'https://assets.publishing.service.gov.uk/media/696f9b5f2b64f0e8c32e33a4/Tax-test-data-examples-2026-27-v1-1.zip',
  fpsGuidance: 'https://www.gov.uk/running-payroll/reporting-to-hmrc',
  payePaymentGuidance: 'https://www.gov.uk/pay-paye-tax/overview',
});

const SOURCE_HASHES = Object.freeze({
  specificationSha256: '799609B7BA81B5399015B32EBDAED774683CE4992CAFF33D67BBF68BA57F5599',
  testDataSha256: '163B18BD7DCFB699B8D77EC621AC1D4509372299DE72DAA1A5A027564CAF188C',
});

const REGION_TABLES = Object.freeze({
  rest_of_uk: Object.freeze({
    prefix: '',
    rates: Object.freeze(['0.10', '0.20', '0.40', '0.45']),
    cumulativeBandwidths: Object.freeze(['0', '37700', '125140']),
    cumulativeAnnualTax: Object.freeze(['0', '7540', '42516']),
    basicRateIndex: 1,
  }),
  scotland: Object.freeze({
    prefix: 'S',
    rates: Object.freeze(['0.19', '0.20', '0.21', '0.42', '0.45', '0.48']),
    cumulativeBandwidths: Object.freeze(['3967', '16956', '31092', '62430', '125140']),
    cumulativeAnnualTax: Object.freeze(['753.73', '3351.53', '6320.09', '19482.05', '47701.55']),
    basicRateIndex: 1,
  }),
  wales: Object.freeze({
    prefix: 'C',
    rates: Object.freeze(['0.10', '0.20', '0.40', '0.45']),
    cumulativeBandwidths: Object.freeze(['0', '37700', '125140']),
    cumulativeAnnualTax: Object.freeze(['0', '7540', '42516']),
    basicRateIndex: 1,
  }),
});

const SUPPORTED_BASES = new Set(['cumulative', 'week1_month1']);
const SUPPORTED_FREQUENCIES = Object.freeze({ weekly: 52, monthly: 12 });
const SUPPORTED_METHODS = new Set(['standard']);

class UnsupportedPayeCaseError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'UnsupportedPayeCaseError';
    this.code = 'HMRC_PAYE_2026_UNSUPPORTED';
    this.details = Object.freeze({ ...details });
  }
}

function unsupported(message, details) {
  throw new UnsupportedPayeCaseError(message, details);
}

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}

function money(value, label = 'Money amount') {
  if (typeof value !== 'string' && typeof value !== 'bigint') {
    throw new TypeError(`${label} must be supplied as an exact decimal string or bigint`);
  }
  const result = statutoryMoneyService.create(value, GBP);
  result.toMinorUnits();
  return result;
}

function rawMoney(value) {
  return statutoryMoneyService.create(value, GBP);
}

function zeroMoney() {
  return rawMoney('0');
}

function compare(left, right) {
  const rightDecimal = right && right.decimal ? right.decimal : right;
  return left.decimal.compare(rightDecimal);
}

function isNegative(value) {
  return compare(value, '0') < 0;
}

function absoluteMoney(value) {
  return isNegative(value) ? zeroMoney().subtract(value) : value;
}

function powerOfTen(exponent) {
  let result = 1n;
  for (let index = 0; index < exponent; index += 1) result *= 10n;
  return result;
}

function scaledIntegerToDecimal(value, scale) {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, '0');
  if (scale === 0) return `${negative ? '-' : ''}${digits}`;
  return `${negative ? '-' : ''}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

/**
 * HMRC Definitions 9 and 11 require division to four decimal places without
 * correcting the final place. Inputs here are non-negative statutory constants.
 */
function divideToFourDecimals(amount, multiplier, divisor, stage) {
  const decimal = amount.decimal;
  if (decimal.coefficient < 0n) throw new RangeError('HMRC proportional constants cannot be negative');
  if (!Number.isInteger(multiplier) || multiplier < 0) throw new RangeError('Multiplier must be a non-negative integer');
  if (!Number.isInteger(divisor) || divisor <= 0) throw new RangeError('Divisor must be a positive integer');

  let numerator = decimal.coefficient * BigInt(multiplier);
  let denominator = BigInt(divisor);
  if (decimal.scale <= 4) numerator *= powerOfTen(4 - decimal.scale);
  else denominator *= powerOfTen(decimal.scale - 4);

  const truncated = numerator / denominator;
  return rawMoney(scaledIntegerToDecimal(truncated, 4)).round({
    unit: '0.0001',
    mode: 'truncate',
    stage,
  });
}

function normalizeText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} is required`);
  return value.trim().toLowerCase();
}

function normalizeInteger(value, label) {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${label} must be an integer`);
  return value;
}

function normalizeDateOnly(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError(`${label} must be an ISO date in YYYY-MM-DD format`);
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new TypeError(`${label} must be a valid calendar date`);
  }
  return value;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function taxMonthForPayment(payDate, remittanceMethod) {
  const normalizedPayDate = normalizeDateOnly(payDate, 'payDate');
  if (normalizedPayDate < TAX_YEAR_START || normalizedPayDate > TAX_YEAR_END) {
    unsupported('payDate is outside the 2026 to 2027 UK tax year', { payDate: normalizedPayDate });
  }

  if (!['electronic', 'post'].includes(remittanceMethod)) {
    unsupported('remittanceMethod must be electronic or post', { remittanceMethod });
  }

  const [year, month, day] = normalizedPayDate.split('-').map(Number);
  const startMonthOffset = day >= 6 ? month - 1 : month - 2;
  const start = new Date(Date.UTC(year, startMonthOffset, 6));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 5));
  const dueDay = remittanceMethod === 'electronic' ? 22 : 19;
  const due = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), dueDay));

  return Object.freeze({
    periodStart: formatDate(start),
    periodEnd: formatDate(end),
    dueDate: formatDate(due),
    fpsDueDate: normalizedPayDate,
  });
}

function parseTaxCode(value) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('taxCode is required');
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9]+$/.test(normalized)) {
    unsupported('Tax code contains unsupported characters', { taxCode: normalized });
  }

  let region = 'rest_of_uk';
  let body = normalized;
  if (body.startsWith('S')) {
    region = 'scotland';
    body = body.slice(1);
  } else if (body.startsWith('C')) {
    region = 'wales';
    body = body.slice(1);
  }

  if (body === 'NT') {
    if (region !== 'rest_of_uk') unsupported('NT must not have a Scottish or Welsh prefix', { taxCode: normalized });
    return Object.freeze({ normalized, region, type: 'nt', numericPart: null, suffix: 'NT' });
  }

  if (body === 'BR') {
    return Object.freeze({ normalized, region, type: 'br', numericPart: null, suffix: 'BR' });
  }

  const dCode = /^D([0-9])$/.exec(body);
  if (dCode) {
    const level = Number(dCode[1]);
    if (level > 2) {
      unsupported('Wave 1 supports D0, D1 and D2 only', { taxCode: normalized });
    }
    const table = REGION_TABLES[region];
    const rateIndex = table.basicRateIndex + 1 + level;
    if (rateIndex >= table.rates.length) {
      unsupported(`${normalized} has no rate in the 2026 to 2027 ${region} table`, { taxCode: normalized });
    }
    return Object.freeze({ normalized, region, type: 'd', level, rateIndex, numericPart: null, suffix: `D${level}` });
  }

  const kCode = /^K(\d{1,6})$/.exec(body);
  if (kCode) {
    const numericPart = Number(kCode[1]);
    if (numericPart === 0) unsupported('K0, SK0 and CK0 are not valid PAYE tax codes', { taxCode: normalized });
    return Object.freeze({ normalized, region, type: 'k', numericPart, suffix: 'K' });
  }

  const suffixCode = /^(\d{1,6})([LMNT])$/.exec(body);
  if (suffixCode) {
    return Object.freeze({
      normalized,
      region,
      type: 'suffix',
      numericPart: Number(suffixCode[1]),
      suffix: suffixCode[2],
    });
  }

  unsupported('Unsupported PAYE tax code for the Wave 1 adapter', { taxCode: normalized });
}

function periodOneCodeAdjustment(numericPart, periodsPerYear) {
  if (numericPart === 0) return zeroMoney();

  const quotient = Math.floor((numericPart - 1) / 500);
  const remainder = ((numericPart - 1) % 500) + 1;
  const remainderAnnual = rawMoney(String((remainder * 10) + 9));
  const remainderPeriod = divideToFourDecimals(
    remainderAnnual,
    1,
    periodsPerYear,
    'gb.paye.code_adjustment_division_4dp'
  ).round({
    unit: '0.01',
    mode: 'ceil',
    stage: 'gb.paye.code_adjustment_penny_up',
  });

  if (quotient === 0) return remainderPeriod;

  const blockPeriod = divideToFourDecimals(
    rawMoney('5000'),
    1,
    periodsPerYear,
    'gb.paye.code_500_block_division_4dp'
  ).round({
    unit: '0.01',
    mode: 'ceil',
    stage: 'gb.paye.code_500_block_penny_up',
  });

  return remainderPeriod.add(blockPeriod.multiplyByRate(String(quotient)));
}

function proportionalConstant(annualValue, periodNumber, periodsPerYear, stage) {
  return divideToFourDecimals(rawMoney(annualValue), periodNumber, periodsPerYear, stage);
}

function progressiveLiability(taxablePay, table, periodNumber, periodsPerYear) {
  if (compare(taxablePay, '0') <= 0) {
    return {
      liability: zeroMoney(),
      taxablePayForTax: zeroMoney(),
      topRate: '',
      bandIndex: -1,
    };
  }

  const thresholds = table.cumulativeBandwidths.map((annualValue) => proportionalConstant(
    annualValue,
    periodNumber,
    periodsPerYear,
    'gb.paye.band_threshold_division_4dp'
  ));
  const thresholdTaxes = table.cumulativeAnnualTax.map((annualValue) => proportionalConstant(
    annualValue,
    periodNumber,
    periodsPerYear,
    'gb.paye.threshold_tax_division_4dp'
  ));

  let bandIndex = table.rates.length - 1;
  for (let index = 0; index < thresholds.length; index += 1) {
    const cValue = thresholds[index].round({
      unit: '1',
      mode: 'ceil',
      stage: 'gb.paye.band_test_whole_pound_up',
    });
    if (compare(taxablePay, cValue) <= 0) {
      bandIndex = index;
      break;
    }
  }

  const taxablePayForTax = taxablePay.round({
    unit: '1',
    mode: 'floor',
    stage: 'gb.paye.taxable_pay_whole_pound_down',
  });
  let formulaResult;
  if (bandIndex === 0) {
    formulaResult = taxablePayForTax.multiplyByRate(table.rates[0]);
  } else {
    formulaResult = thresholdTaxes[bandIndex - 1].add(
      taxablePayForTax
        .subtract(thresholds[bandIndex - 1])
        .multiplyByRate(table.rates[bandIndex])
    );
  }

  const liability = formulaResult
    .round({ unit: '0.0001', mode: 'truncate', stage: 'gb.paye.tax_formula_4dp' })
    .round({ unit: '0.01', mode: 'floor', stage: 'gb.paye.liability_penny_down' });

  return {
    liability,
    taxablePayForTax,
    topRate: table.rates[bandIndex],
    bandIndex,
  };
}

function flatRateLiability(pay, rate) {
  if (compare(pay, '0') <= 0) {
    return { liability: zeroMoney(), taxablePayForTax: zeroMoney(), topRate: rate, bandIndex: null };
  }
  const taxablePayForTax = pay.round({
    unit: '1',
    mode: 'floor',
    stage: 'gb.paye.taxable_pay_whole_pound_down',
  });
  const liability = taxablePayForTax
    .multiplyByRate(rate)
    .round({ unit: '0.0001', mode: 'truncate', stage: 'gb.paye.tax_formula_4dp' })
    .round({ unit: '0.01', mode: 'floor', stage: 'gb.paye.liability_penny_down' });
  return { liability, taxablePayForTax, topRate: rate, bandIndex: null };
}

function regulatoryLimit(grossPay, payrolledBenefitsInKind) {
  return grossPay
    .subtract(payrolledBenefitsInKind)
    .multiplyByRate('0.50')
    .round({ unit: '0.0001', mode: 'truncate', stage: 'gb.paye.regulatory_limit_4dp' })
    .round({ unit: '0.01', mode: 'floor', stage: 'gb.paye.regulatory_limit_penny_down' });
}

function serializeMoney(value) {
  return value.toFixed();
}

function authorityMetadata() {
  return Object.freeze({
    code: 'HMRC',
    name: 'HM Revenue and Customs',
    level: 'national',
    jurisdictionCode: 'GB',
  });
}

function reportingMetadata(taxMonth, remittanceMethod, remittanceFrequency) {
  return Object.freeze({
    authority: authorityMetadata(),
    formCode: 'FPS',
    filingFrequency: 'per_payroll',
    fpsDueDate: taxMonth.fpsDueDate,
    remittanceFrequency,
    remittancePeriodStart: taxMonth.periodStart,
    remittancePeriodEnd: taxMonth.periodEnd,
    remittanceDueDate: taxMonth.dueDate,
    remittanceMethod,
  });
}

function buildLiabilityOutput({
  taxDue,
  cashPay,
  taxCode,
  basis,
  payFrequency,
  periodNumber,
  taxMonth,
  remittanceMethod,
  remittanceFrequency,
  calculationMethod,
}) {
  const reporting = reportingMetadata(taxMonth, remittanceMethod, remittanceFrequency);
  const isRefund = isNegative(taxDue);
  const entry = isRefund ? null : statutoryLiabilityLedgerService.createEntry({
    liabilityCode: 'GB_PAYE_INCOME_TAX',
    name: 'PAYE Income Tax deduction',
    payer: 'employee',
    amount: taxDue,
    baseAmount: cashPay,
    rate: '',
    authority: reporting.authority,
    remittance: {
      formCode: reporting.formCode,
      frequency: reporting.remittanceFrequency,
      periodStart: reporting.remittancePeriodStart,
      periodEnd: reporting.remittancePeriodEnd,
      dueDate: reporting.remittanceDueDate,
      paymentChannel: remittanceMethod,
      accountReferenceField: 'Accounts Office reference',
    },
    calculation: {
      method: calculationMethod,
      roundingStage: taxDue.roundingHistory.at(-1)?.stage || 'gb.paye.no_tax_due',
    },
    sourceReferences: [SOURCES.specificationAsset, SOURCES.fpsGuidance, SOURCES.payePaymentGuidance],
    sourceEffectiveFrom: TAX_YEAR_START,
    evidenceReference: 'HMRC PAYE Tax Table Routines v24.0',
    metadata: {
      taxCode,
      basis,
      payFrequency,
      periodNumber,
      fpsDueDate: reporting.fpsDueDate,
      direction: 'deduction',
    },
  }, GBP);

  const liabilityLedger = statutoryLiabilityLedgerService.buildLedger(entry ? [entry] : []);
  const refundComponent = isRefund ? freezeDeep({
    liabilityCode: 'GB_PAYE_INCOME_TAX_REFUND',
    name: 'PAYE Income Tax refund',
    payer: 'employee',
    direction: 'refund',
    amount: {
      amount: absoluteMoney(taxDue).toFixed(),
      currency: 'GBP',
      minorUnits: 2,
    },
    authority: reporting.authority,
    reporting: {
      formCode: 'FPS',
      dueDate: reporting.fpsDueDate,
    },
    sourceReferences: [SOURCES.specificationAsset, SOURCES.fpsGuidance],
  }) : null;

  return { reporting, liabilityLedger, refundComponent };
}

function validateCalculationInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('PAYE calculation input must be an object');
  }
  if (input.taxYear !== undefined && input.taxYear !== TAX_YEAR) {
    unsupported('This adapter supports tax year 2026-27 only', { taxYear: input.taxYear });
  }

  const calculationMethod = normalizeText(input.calculationMethod ?? 'standard', 'calculationMethod');
  if (!SUPPORTED_METHODS.has(calculationMethod)) {
    unsupported('Unsupported PAYE calculation method for Wave 1', { calculationMethod });
  }

  const payFrequency = normalizeText(input.payFrequency, 'payFrequency');
  const periodsPerYear = SUPPORTED_FREQUENCIES[payFrequency];
  if (!periodsPerYear) {
    unsupported('Wave 1 supports regular weekly and monthly payrolls only', { payFrequency });
  }

  const basis = normalizeText(input.basis, 'basis');
  if (!SUPPORTED_BASES.has(basis)) {
    unsupported('basis must be cumulative or week1_month1', { basis });
  }

  const periodNumber = normalizeInteger(input.periodNumber, 'periodNumber');
  if (periodNumber < 1 || periodNumber > periodsPerYear) {
    unsupported(`periodNumber must be between 1 and ${periodsPerYear} for ${payFrequency}`, {
      periodNumber,
      payFrequency,
    });
  }

  const taxCode = parseTaxCode(input.taxCode);
  const grossPay = money(input.grossPay, 'grossPay');
  const payrolledBenefitsInKind = money(input.payrolledBenefitsInKind ?? '0.00', 'payrolledBenefitsInKind');
  if (isNegative(grossPay)) unsupported('Negative pay is outside Wave 1', { grossPay: grossPay.toString() });
  if (isNegative(payrolledBenefitsInKind) || compare(payrolledBenefitsInKind, grossPay) > 0) {
    throw new RangeError('payrolledBenefitsInKind must be between zero and grossPay');
  }

  let cumulativePayToDate;
  let previousTaxPaidToDate;
  if (basis === 'cumulative') {
    cumulativePayToDate = money(input.cumulativePayToDate, 'cumulativePayToDate');
    previousTaxPaidToDate = money(input.previousTaxPaidToDate, 'previousTaxPaidToDate');
    if (isNegative(cumulativePayToDate) || compare(cumulativePayToDate, grossPay) < 0) {
      throw new RangeError('cumulativePayToDate must be non-negative and include the current grossPay');
    }
    if (isNegative(previousTaxPaidToDate)) {
      throw new RangeError('previousTaxPaidToDate cannot be negative');
    }
  } else {
    cumulativePayToDate = grossPay;
    previousTaxPaidToDate = zeroMoney();
    if (input.previousTaxPaidToDate !== undefined && money(input.previousTaxPaidToDate, 'previousTaxPaidToDate').toMinorUnits() !== 0n) {
      throw new RangeError('previousTaxPaidToDate must be zero or omitted for week1_month1');
    }
  }

  const remittanceMethod = normalizeText(input.remittanceMethod, 'remittanceMethod');
  const remittanceFrequency = normalizeText(input.remittanceFrequency, 'remittanceFrequency');
  if (remittanceFrequency !== 'monthly') {
    unsupported('Wave 1 due-date output supports monthly PAYE remitters only', { remittanceFrequency });
  }
  const taxMonth = taxMonthForPayment(input.payDate, remittanceMethod);

  return {
    calculationMethod,
    payFrequency,
    periodsPerYear,
    basis,
    periodNumber,
    taxCode,
    grossPay,
    payrolledBenefitsInKind,
    cumulativePayToDate,
    previousTaxPaidToDate,
    remittanceMethod,
    remittanceFrequency,
    taxMonth,
  };
}

class UnitedKingdomPaye2026Service {
  /**
   * Calculate one regular weekly or monthly PAYE payment for 2026/27.
   *
   * Monetary inputs are exact decimal strings. grossPay includes any payrolled
   * benefits in kind. On the cumulative basis, cumulativePayToDate includes
   * the current payment and previousTaxPaidToDate is the actual adjusted PAYE
   * liability carried from the prior calculation (after any regulatory cap).
   * W1/M1 calculations deliberately ignore all earlier pay and tax.
   *
   * payDate, remittanceMethod and remittanceFrequency do not alter tax; they
   * provide the independently auditable FPS and PAYE payment metadata.
   */
  calculate(input) {
    const context = validateCalculationInput(input);
    const {
      calculationMethod,
      payFrequency,
      periodsPerYear,
      basis,
      periodNumber,
      taxCode,
      grossPay,
      payrolledBenefitsInKind,
      cumulativePayToDate,
      previousTaxPaidToDate,
      remittanceMethod,
      remittanceFrequency,
      taxMonth,
    } = context;
    const table = REGION_TABLES[taxCode.region];
    const calculationPeriod = basis === 'cumulative' ? periodNumber : 1;
    const payForTax = basis === 'cumulative' ? cumulativePayToDate : grossPay;

    let codeAdjustment = zeroMoney();
    let taxablePay = payForTax;
    let taxResult;
    if (taxCode.type === 'suffix' || taxCode.type === 'k') {
      const periodOneAdjustment = periodOneCodeAdjustment(taxCode.numericPart, periodsPerYear);
      codeAdjustment = periodOneAdjustment.multiplyByRate(String(calculationPeriod));
      taxablePay = taxCode.type === 'k'
        ? payForTax.add(codeAdjustment)
        : payForTax.subtract(codeAdjustment);
      taxResult = progressiveLiability(taxablePay, table, calculationPeriod, periodsPerYear);
    } else if (taxCode.type === 'br') {
      taxResult = flatRateLiability(payForTax, table.rates[table.basicRateIndex]);
    } else if (taxCode.type === 'd') {
      taxResult = flatRateLiability(payForTax, table.rates[taxCode.rateIndex]);
    } else if (taxCode.type === 'nt') {
      taxResult = {
        liability: zeroMoney(),
        taxablePayForTax: zeroMoney(),
        topRate: '0',
        bandIndex: null,
      };
    } else {
      unsupported('Parsed PAYE tax code type is not executable', { taxCode: taxCode.normalized });
    }

    const computedTaxLiabilityToDate = taxResult.liability;
    let taxDue = basis === 'cumulative'
      ? computedTaxLiabilityToDate.subtract(previousTaxPaidToDate)
      : computedTaxLiabilityToDate;
    let taxLiabilityToDate = computedTaxLiabilityToDate;
    const maximumDeduction = regulatoryLimit(grossPay, payrolledBenefitsInKind);
    let regulatoryLimitApplied = false;

    if (compare(taxDue, '0') > 0 && compare(taxDue, maximumDeduction) > 0) {
      regulatoryLimitApplied = true;
      taxDue = maximumDeduction;
      taxLiabilityToDate = basis === 'cumulative'
        ? previousTaxPaidToDate.add(maximumDeduction)
        : maximumDeduction;
    }

    const cashPay = grossPay.subtract(payrolledBenefitsInKind);
    const liabilityOutput = buildLiabilityOutput({
      taxDue,
      cashPay,
      taxCode: taxCode.normalized,
      basis,
      payFrequency,
      periodNumber,
      taxMonth,
      remittanceMethod,
      remittanceFrequency,
      calculationMethod: 'HMRC PAYE Tax Table Routines v24.0',
    });

    return freezeDeep({
      adapter: 'GB_PAYE_2026_WAVE_1',
      status: 'standalone_preview_only',
      taxYear: TAX_YEAR,
      sourceEffectiveFrom: TAX_YEAR_START,
      sourceEffectiveTo: TAX_YEAR_END,
      taxCode,
      basis,
      payFrequency,
      periodNumber,
      calculation: {
        method: calculationMethod,
        grossPay: serializeMoney(grossPay),
        payrolledBenefitsInKind: serializeMoney(payrolledBenefitsInKind),
        cashPay: serializeMoney(cashPay),
        cumulativePayToDate: serializeMoney(cumulativePayToDate),
        previousTaxPaidToDate: serializeMoney(previousTaxPaidToDate),
        codeAdjustmentType: taxCode.type === 'k' ? 'additional_pay' : (taxCode.type === 'suffix' ? 'free_pay' : 'none'),
        codeAdjustmentToDate: serializeMoney(codeAdjustment),
        taxablePayBeforeWholePoundRounding: taxablePay.toString(),
        taxablePayForTax: serializeMoney(taxResult.taxablePayForTax),
        topRate: taxResult.topRate,
        bandIndex: taxResult.bandIndex,
        computedTaxLiabilityToDate: serializeMoney(computedTaxLiabilityToDate),
        regulatoryLimit: serializeMoney(maximumDeduction),
        regulatoryLimitApplied,
        roundingHistory: taxDue.roundingHistory,
      },
      taxDue: serializeMoney(taxDue),
      taxDeducted: isNegative(taxDue) ? '0.00' : serializeMoney(taxDue),
      taxRefunded: isNegative(taxDue) ? serializeMoney(absoluteMoney(taxDue)) : '0.00',
      taxLiabilityToDate: serializeMoney(taxLiabilityToDate),
      reporting: liabilityOutput.reporting,
      components: liabilityOutput.liabilityLedger.entries,
      refundComponent: liabilityOutput.refundComponent,
      liabilityLedger: liabilityOutput.liabilityLedger,
      sources: {
        ...SOURCES,
        ...SOURCE_HASHES,
        specificationVersion: '24.0 (February 2026)',
        developerTestDataVersion: '1.1 (20 January 2026)',
      },
      runnable: false,
      remittanceFrequency,
    });
  }
}

const unitedKingdomPaye2026Service = new UnitedKingdomPaye2026Service();

module.exports = unitedKingdomPaye2026Service;
module.exports.UnitedKingdomPaye2026Service = UnitedKingdomPaye2026Service;
module.exports.UnsupportedPayeCaseError = UnsupportedPayeCaseError;
module.exports.REGION_TABLES = REGION_TABLES;
module.exports.SOURCES = SOURCES;
module.exports.SOURCE_HASHES = SOURCE_HASHES;
