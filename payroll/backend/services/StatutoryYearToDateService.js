'use strict';

/**
 * Builds an exact, auditable statutory year-to-date snapshot.
 *
 * Country adapters must decide what a tax year means and which prior payments
 * are legally included. This service enforces the mechanical invariants that
 * should never vary by jurisdiction: date-only UTC chronology, immutable
 * source receipts, one calculation currency, exact minor units, deterministic
 * ordering/digesting, and an explicit refund policy for cumulative tax deltas.
 */

const crypto = require('crypto');
const statutoryMoneyService = require('./StatutoryMoneyService');

const FINAL_STATUSES = Object.freeze(['approved', 'exported', 'paid']);
const REFUND_POLICIES = Object.freeze({
  ALLOW: 'allow_refund',
  CLAMP_ZERO: 'clamp_zero',
  BLOCK: 'block_negative',
});
class StatutoryYearToDateError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'StatutoryYearToDateError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new StatutoryYearToDateError(code, message, details);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
  );
}

function digest(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function requiredText(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) fail('STATUTORY_YTD_REQUIRED', `${label} is required`);
  return normalized;
}

function parseDateOnly(value, label) {
  const text = requiredText(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    fail('STATUTORY_YTD_INVALID_DATE', `${label} must use YYYY-MM-DD`, { value });
  }
  const [year, month, day] = text.split('-').map(Number);
  const utc = Date.UTC(year, month - 1, day);
  const date = new Date(utc);
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    fail('STATUTORY_YTD_INVALID_DATE', `${label} is not a calendar date`, { value });
  }
  return { text, utc };
}

function normalizeSequence(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail('STATUTORY_YTD_INVALID_SEQUENCE', `${label} must be a positive integer`, { value });
  }
  return value;
}

function normalizeMoney(value, moneyOptions, label, { allowNegative = false } = {}) {
  if (typeof value !== 'string' || !/^[+-]?\d+(?:\.\d+)?$/.test(value.trim())) {
    fail(
      'STATUTORY_YTD_INVALID_MONEY',
      `${label} must be an exact base-10 decimal string`,
      { value }
    );
  }

  let money;
  try {
    money = statutoryMoneyService.create(value.trim(), moneyOptions);
    // Fail closed when a caller supplies fractions below the legal currency
    // unit. Adapters must perform and evidence any statutory rounding first.
    money.toFixed(moneyOptions.minorUnits);
  } catch (error) {
    fail('STATUTORY_YTD_INVALID_MONEY', `${label} is not representable at the currency minor unit`, {
      value,
      cause: error.message,
    });
  }

  if (!allowNegative && money.decimal.compare('0') < 0) {
    fail('STATUTORY_YTD_NEGATIVE_AMOUNT', `${label} cannot be negative`, { value });
  }

  return money;
}

function serializeMoney(money) {
  return Object.freeze({
    amount: money.toFixed(),
    currency: money.currency,
    minorUnits: money.minorUnits,
  });
}

function assertChronology(periodStart, periodEnd, paymentDate, label) {
  if (periodStart.utc > periodEnd.utc) {
    fail('STATUTORY_YTD_INVALID_PERIOD', `${label}.periodStart must not be after periodEnd`);
  }
  if (periodEnd.utc > paymentDate.utc) {
    fail('STATUTORY_YTD_INVALID_PERIOD', `${label}.periodEnd must not be after paymentDate`);
  }
}

function comparePaymentOrder(left, right) {
  if (left.paymentDate.utc !== right.paymentDate.utc) {
    return left.paymentDate.utc - right.paymentDate.utc;
  }
  if (left.sequence !== right.sequence) return left.sequence - right.sequence;
  return left.sourceId.localeCompare(right.sourceId);
}

function validatePriorOrder(prior, current, taxYear) {
  if (prior.paymentDate.utc < taxYear.start.utc || prior.paymentDate.utc > taxYear.end.utc) {
    fail('STATUTORY_YTD_OUTSIDE_TAX_YEAR', `${prior.sourceId} is outside the declared tax year`);
  }
  if (prior.paymentDate.utc > current.paymentDate.utc) {
    fail('STATUTORY_YTD_FUTURE_PAYMENT', `${prior.sourceId} is after the current payment`);
  }
  if (
    prior.paymentDate.utc === current.paymentDate.utc
    && prior.sequence >= current.sequence
  ) {
    fail(
      'STATUTORY_YTD_PAYMENT_ORDER_CONFLICT',
      `${prior.sourceId} is not earlier than the current payment on the same date`,
      { priorSequence: prior.sequence, currentSequence: current.sequence }
    );
  }
}

function normalizeLiabilities(value, moneyOptions, sourceId) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    fail('STATUTORY_YTD_INVALID_LIABILITIES', `${sourceId}.liabilities must be an array`);
  }

  const seen = new Set();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      fail('STATUTORY_YTD_INVALID_LIABILITY', `${sourceId}.liabilities[${index}] must be an object`);
    }
    const code = requiredText(entry.code, `${sourceId}.liabilities[${index}].code`).toUpperCase();
    if (!/^[A-Z][A-Z0-9_:-]{1,63}$/.test(code)) {
      fail('STATUTORY_YTD_INVALID_LIABILITY', `${sourceId}.liabilities[${index}].code is invalid`);
    }
    const payer = requiredText(entry.payer, `${sourceId}.liabilities[${index}].payer`).toLowerCase();
    if (!['employee', 'employer'].includes(payer)) {
      fail('STATUTORY_YTD_INVALID_LIABILITY', `${sourceId}.liabilities[${index}].payer is invalid`);
    }
    const identity = `${payer}:${code}`;
    if (seen.has(identity)) {
      fail('STATUTORY_YTD_DUPLICATE_LIABILITY', `${sourceId} contains duplicate liability ${identity}`);
    }
    seen.add(identity);
    const amount = normalizeMoney(
      entry.amount,
      moneyOptions,
      `${sourceId}.liabilities[${index}].amount`,
      { allowNegative: true }
    );
    return { code, payer, amount };
  });
}

function normalizePriorPayment(value, moneyOptions, index) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('STATUTORY_YTD_INVALID_PAYMENT', `priorPayments[${index}] must be an object`);
  }
  const sourceId = requiredText(value.sourceId, `priorPayments[${index}].sourceId`);
  const sourceHash = requiredText(value.sourceHash, `${sourceId}.sourceHash`).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sourceHash)) {
    fail('STATUTORY_YTD_INVALID_SOURCE_HASH', `${sourceId}.sourceHash must be a SHA-256 digest`);
  }
  const status = requiredText(value.status, `${sourceId}.status`).toLowerCase();
  if (!FINAL_STATUSES.includes(status)) {
    fail('STATUTORY_YTD_UNPOSTED_PAYMENT', `${sourceId} is not an approved/exported/paid payment`, {
      status,
    });
  }
  const paymentDate = parseDateOnly(value.paymentDate, `${sourceId}.paymentDate`);
  const periodStart = parseDateOnly(value.periodStart, `${sourceId}.periodStart`);
  const periodEnd = parseDateOnly(value.periodEnd, `${sourceId}.periodEnd`);
  assertChronology(periodStart, periodEnd, paymentDate, sourceId);

  return {
    sourceId,
    sourceHash,
    calculationVersionId: requiredText(value.calculationVersionId, `${sourceId}.calculationVersionId`),
    status,
    paymentDate,
    periodStart,
    periodEnd,
    sequence: normalizeSequence(value.sequence || 1, `${sourceId}.sequence`),
    grossPay: normalizeMoney(value.grossPay, moneyOptions, `${sourceId}.grossPay`),
    taxableIncome: normalizeMoney(value.taxableIncome, moneyOptions, `${sourceId}.taxableIncome`),
    incomeTax: normalizeMoney(value.incomeTax, moneyOptions, `${sourceId}.incomeTax`, {
      allowNegative: true,
    }),
    liabilities: normalizeLiabilities(value.liabilities, moneyOptions, sourceId),
  };
}

function serializePriorPayment(payment) {
  return {
    sourceId: payment.sourceId,
    sourceHash: payment.sourceHash,
    calculationVersionId: payment.calculationVersionId,
    status: payment.status,
    paymentDate: payment.paymentDate.text,
    periodStart: payment.periodStart.text,
    periodEnd: payment.periodEnd.text,
    sequence: payment.sequence,
    grossPay: payment.grossPay.toFixed(),
    taxableIncome: payment.taxableIncome.toFixed(),
    incomeTax: payment.incomeTax.toFixed(),
    liabilities: payment.liabilities.map((entry) => ({
      code: entry.code,
      payer: entry.payer,
      amount: entry.amount.toFixed(),
    })),
  };
}

function buildContext(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('STATUTORY_YTD_INVALID_INPUT', 'A year-to-date input object is required');
  }

  const jurisdictionCode = requiredText(input.jurisdictionCode, 'jurisdictionCode').toUpperCase();
  if (!/^[A-Z]{2}(?:-[A-Z0-9]{1,12})*$/.test(jurisdictionCode)) {
    fail('STATUTORY_YTD_INVALID_JURISDICTION', 'jurisdictionCode is invalid');
  }
  const moneyOptions = {
    currency: requiredText(input.currency, 'currency').toUpperCase(),
    minorUnits: input.minorUnits,
  };
  // Ask the shared primitive to validate ISO-shape and supported scale now.
  statutoryMoneyService.create('0', moneyOptions);

  if (!input.taxYear || typeof input.taxYear !== 'object' || Array.isArray(input.taxYear)) {
    fail('STATUTORY_YTD_REQUIRED', 'taxYear is required');
  }
  const taxYear = {
    label: requiredText(input.taxYear.label, 'taxYear.label'),
    start: parseDateOnly(input.taxYear.start, 'taxYear.start'),
    end: parseDateOnly(input.taxYear.end, 'taxYear.end'),
  };
  if (taxYear.start.utc > taxYear.end.utc) {
    fail('STATUTORY_YTD_INVALID_TAX_YEAR', 'taxYear.start must not be after taxYear.end');
  }

  if (!input.currentPayment || typeof input.currentPayment !== 'object' || Array.isArray(input.currentPayment)) {
    fail('STATUTORY_YTD_REQUIRED', 'currentPayment is required');
  }
  const current = {
    paymentDate: parseDateOnly(input.currentPayment.paymentDate, 'currentPayment.paymentDate'),
    periodStart: parseDateOnly(input.currentPayment.periodStart, 'currentPayment.periodStart'),
    periodEnd: parseDateOnly(input.currentPayment.periodEnd, 'currentPayment.periodEnd'),
    sequence: normalizeSequence(input.currentPayment.sequence || 1, 'currentPayment.sequence'),
  };
  assertChronology(current.periodStart, current.periodEnd, current.paymentDate, 'currentPayment');
  if (current.paymentDate.utc < taxYear.start.utc || current.paymentDate.utc > taxYear.end.utc) {
    fail('STATUTORY_YTD_OUTSIDE_TAX_YEAR', 'currentPayment.paymentDate is outside taxYear');
  }

  if (!Array.isArray(input.priorPayments)) {
    fail('STATUTORY_YTD_INVALID_PAYMENTS', 'priorPayments must be an array');
  }
  const payments = input.priorPayments.map((payment, index) => (
    normalizePriorPayment(payment, moneyOptions, index)
  ));
  const ids = new Set();
  for (const payment of payments) {
    if (ids.has(payment.sourceId)) {
      fail('STATUTORY_YTD_DUPLICATE_SOURCE', `Duplicate prior payment ${payment.sourceId}`);
    }
    ids.add(payment.sourceId);
    validatePriorOrder(payment, current, taxYear);
  }
  payments.sort(comparePaymentOrder);

  let grossPay = statutoryMoneyService.create('0', moneyOptions);
  let taxableIncome = statutoryMoneyService.create('0', moneyOptions);
  let incomeTax = statutoryMoneyService.create('0', moneyOptions);
  const liabilityTotals = new Map();
  for (const payment of payments) {
    grossPay = grossPay.add(payment.grossPay);
    taxableIncome = taxableIncome.add(payment.taxableIncome);
    incomeTax = incomeTax.add(payment.incomeTax);
    for (const entry of payment.liabilities) {
      const key = `${entry.payer}:${entry.code}`;
      const existing = liabilityTotals.get(key);
      liabilityTotals.set(key, {
        code: entry.code,
        payer: entry.payer,
        amount: existing ? existing.amount.add(entry.amount) : entry.amount,
        sourceIds: existing ? [...existing.sourceIds, payment.sourceId] : [payment.sourceId],
      });
    }
  }

  const serializedPayments = payments.map(serializePriorPayment);
  const snapshot = {
    schemaVersion: 1,
    jurisdictionCode,
    currency: moneyOptions.currency,
    minorUnits: moneyOptions.minorUnits,
    taxYear: {
      label: taxYear.label,
      start: taxYear.start.text,
      end: taxYear.end.text,
    },
    currentPayment: {
      paymentDate: current.paymentDate.text,
      periodStart: current.periodStart.text,
      periodEnd: current.periodEnd.text,
      sequence: current.sequence,
    },
    priorPayments: serializedPayments,
  };

  return deepFreeze({
    ...snapshot,
    snapshotDigestSha256: digest(snapshot),
    priorPaymentCount: payments.length,
    sourceIds: payments.map((payment) => payment.sourceId),
    totals: {
      grossPay: serializeMoney(grossPay),
      taxableIncome: serializeMoney(taxableIncome),
      incomeTax: serializeMoney(incomeTax),
      liabilities: [...liabilityTotals.values()]
        .sort((left, right) => `${left.payer}:${left.code}`.localeCompare(`${right.payer}:${right.code}`))
        .map((entry) => ({
          code: entry.code,
          payer: entry.payer,
          amount: serializeMoney(entry.amount),
          sourceIds: [...entry.sourceIds],
        })),
    },
  });
}

function calculateCumulativeDelta({ context, targetCumulativeIncomeTax, refundPolicy, stage }) {
  if (!context || typeof context !== 'object' || !context.totals?.incomeTax) {
    fail('STATUTORY_YTD_INVALID_CONTEXT', 'A context built by buildContext is required');
  }
  const policy = requiredText(refundPolicy, 'refundPolicy');
  if (!Object.values(REFUND_POLICIES).includes(policy)) {
    fail('STATUTORY_YTD_INVALID_REFUND_POLICY', `Unsupported refund policy ${policy}`);
  }
  const moneyOptions = { currency: context.currency, minorUnits: context.minorUnits };
  const target = normalizeMoney(
    targetCumulativeIncomeTax,
    moneyOptions,
    'targetCumulativeIncomeTax'
  );
  const previous = normalizeMoney(
    context.totals.incomeTax.amount,
    moneyOptions,
    'context.totals.incomeTax',
    { allowNegative: true }
  );
  const rawDelta = target.subtract(previous);
  let applied = rawDelta;
  let adjustment = 'none';
  if (rawDelta.decimal.compare('0') < 0) {
    if (policy === REFUND_POLICIES.BLOCK) {
      fail(
        'STATUTORY_YTD_NEGATIVE_DELTA_BLOCKED',
        'The cumulative calculation creates a refund, but this adapter has not certified refunds',
        { target: target.toFixed(), previous: previous.toFixed(), rawDelta: rawDelta.toFixed() }
      );
    }
    if (policy === REFUND_POLICIES.CLAMP_ZERO) {
      applied = statutoryMoneyService.create('0', moneyOptions);
      adjustment = 'negative_delta_clamped_to_zero';
    } else {
      adjustment = 'refund_allowed';
    }
  }

  return deepFreeze({
    stage: requiredText(stage, 'stage'),
    refundPolicy: policy,
    previousCumulativeIncomeTax: serializeMoney(previous),
    targetCumulativeIncomeTax: serializeMoney(target),
    rawCurrentPeriodDelta: serializeMoney(rawDelta),
    appliedCurrentPeriodDelta: serializeMoney(applied),
    adjustment,
    ytdSnapshotDigestSha256: context.snapshotDigestSha256,
  });
}

module.exports = Object.freeze({
  buildContext,
  calculateCumulativeDelta,
  REFUND_POLICIES,
  FINAL_STATUSES,
  StatutoryYearToDateError,
});
