'use strict';

const statutoryMoneyService = require('./StatutoryMoneyService');
const { StatutoryMoney, ExactDecimal } = require('./StatutoryMoneyService');

const PAYERS = new Set(['employee', 'employer']);
const AUTHORITY_LEVELS = new Set([
  'national',
  'federal',
  'subdivision',
  'local',
  'social_security',
  'sector',
]);
const FILING_FREQUENCIES = new Set([
  'per_payroll',
  'monthly',
  'quarterly',
  'annual',
  'event',
]);

function requiredText(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
}

function normalizeCode(value, label) {
  const normalized = requiredText(value, label).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_.:-]*$/.test(normalized)) {
    throw new TypeError(`${label} contains unsupported characters`);
  }
  return normalized;
}

function normalizeDateOnly(value, label, { optional = false } = {}) {
  if ((value === undefined || value === null || value === '') && optional) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`${label} must be a valid date`);
  return date.toISOString().slice(0, 10);
}

function normalizeReferences(values, label) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError(`${label} requires at least one registered source reference`);
  }
  const unique = [...new Set(values.map((value) => requiredText(value, 'Source reference')))];
  return Object.freeze(unique);
}

function exactMoney(value, currencyOptions, label) {
  const amount = value instanceof StatutoryMoney
    ? statutoryMoneyService.create(value, currencyOptions)
    : statutoryMoneyService.create(value, currencyOptions);
  if (amount.decimal.compare(ExactDecimal.from('0')) < 0) {
    throw new RangeError(`${label} cannot be negative`);
  }
  amount.toMinorUnits();
  return amount;
}

function normalizeRate(value) {
  if (value === undefined || value === null || value === '') return '';
  const rate = ExactDecimal.from(value, 'Liability rate');
  if (rate.compare('0') < 0) throw new RangeError('Liability rate cannot be negative');
  return rate.toString();
}

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}

function serializeMoney(value) {
  return {
    amount: value.toFixed(),
    currency: value.currency,
    minorUnits: value.minorUnits,
  };
}

class StatutoryLiabilityLedgerService {
  createEntry(payload = {}, currencyOptions = {}) {
    const payer = requiredText(payload.payer, 'Liability payer').toLowerCase();
    if (!PAYERS.has(payer)) throw new TypeError('Liability payer must be employee or employer');

    const authorityLevel = requiredText(payload.authority?.level, 'Authority level').toLowerCase();
    if (!AUTHORITY_LEVELS.has(authorityLevel)) {
      throw new TypeError(`Unsupported authority level "${authorityLevel}"`);
    }

    const frequency = requiredText(payload.remittance?.frequency, 'Filing frequency').toLowerCase();
    if (!FILING_FREQUENCIES.has(frequency)) {
      throw new TypeError(`Unsupported filing frequency "${frequency}"`);
    }

    const amount = exactMoney(payload.amount, currencyOptions, 'Liability amount');
    const baseAmount = payload.baseAmount === undefined || payload.baseAmount === null
      ? null
      : exactMoney(payload.baseAmount, currencyOptions, 'Liability base amount');
    const periodStart = normalizeDateOnly(payload.remittance?.periodStart, 'Remittance period start');
    const periodEnd = normalizeDateOnly(payload.remittance?.periodEnd, 'Remittance period end');
    const dueDate = normalizeDateOnly(payload.remittance?.dueDate, 'Remittance due date');
    if (periodStart > periodEnd) throw new RangeError('Remittance period start cannot be after period end');
    if (dueDate < periodEnd) throw new RangeError('Remittance due date cannot be before period end');

    const calculationMethod = requiredText(payload.calculation?.method, 'Calculation method');
    const roundingStage = requiredText(payload.calculation?.roundingStage, 'Statutory rounding stage');
    const sourceReferences = normalizeReferences(payload.sourceReferences, 'Liability');

    const entry = {
      liabilityCode: normalizeCode(payload.liabilityCode, 'Liability code'),
      name: requiredText(payload.name, 'Liability name'),
      payer,
      amount: serializeMoney(amount),
      baseAmount: baseAmount ? serializeMoney(baseAmount) : null,
      rate: normalizeRate(payload.rate),
      authority: {
        code: normalizeCode(payload.authority?.code, 'Authority code'),
        name: requiredText(payload.authority?.name, 'Authority name'),
        level: authorityLevel,
        jurisdictionCode: normalizeCode(payload.authority?.jurisdictionCode, 'Authority jurisdiction code'),
      },
      remittance: {
        formCode: normalizeCode(payload.remittance?.formCode, 'Return or form code'),
        frequency,
        periodStart,
        periodEnd,
        dueDate,
        paymentChannel: String(payload.remittance?.paymentChannel || '').trim(),
        accountReferenceField: String(payload.remittance?.accountReferenceField || '').trim(),
      },
      calculation: {
        method: calculationMethod,
        roundingStage,
        roundingHistory: Object.freeze(amount.roundingHistory.map((event) => Object.freeze({ ...event }))),
      },
      sourceReferences,
      sourceEffectiveFrom: normalizeDateOnly(payload.sourceEffectiveFrom, 'Source effective date'),
      evidenceReference: String(payload.evidenceReference || '').trim(),
      metadata: payload.metadata && typeof payload.metadata === 'object'
        ? JSON.parse(JSON.stringify(payload.metadata))
        : {},
    };

    return freezeDeep(entry);
  }

  buildLedger(entries = []) {
    if (!Array.isArray(entries)) throw new TypeError('Liability entries must be an array');
    const normalizedEntries = entries.map((entry) => freezeDeep({ ...entry }));
    if (normalizedEntries.length === 0) {
      return freezeDeep({
        currency: '',
        minorUnits: null,
        employeeTotal: null,
        employerTotal: null,
        combinedTotal: null,
        filingGroups: [],
        entries: [],
      });
    }

    const firstAmount = normalizedEntries[0].amount;
    const currencyOptions = {
      currency: firstAmount.currency,
      minorUnits: firstAmount.minorUnits,
    };
    let employeeTotal = statutoryMoneyService.create('0', currencyOptions);
    let employerTotal = statutoryMoneyService.create('0', currencyOptions);
    const filingGroups = new Map();

    for (const entry of normalizedEntries) {
      if (entry.amount.currency !== currencyOptions.currency
        || entry.amount.minorUnits !== currencyOptions.minorUnits) {
        throw new RangeError('A statutory liability ledger cannot combine currencies');
      }
      const amount = statutoryMoneyService.create(entry.amount.amount, currencyOptions);
      if (entry.payer === 'employer') employerTotal = employerTotal.add(amount);
      else employeeTotal = employeeTotal.add(amount);

      const groupKey = [
        entry.authority.code,
        entry.remittance.formCode,
        entry.remittance.periodStart,
        entry.remittance.periodEnd,
        entry.remittance.dueDate,
      ].join('|');
      if (!filingGroups.has(groupKey)) {
        filingGroups.set(groupKey, {
          authority: entry.authority,
          remittance: entry.remittance,
          liabilityCodes: [],
          employeeTotal: statutoryMoneyService.create('0', currencyOptions),
          employerTotal: statutoryMoneyService.create('0', currencyOptions),
        });
      }
      const group = filingGroups.get(groupKey);
      group.liabilityCodes.push(entry.liabilityCode);
      if (entry.payer === 'employer') group.employerTotal = group.employerTotal.add(amount);
      else group.employeeTotal = group.employeeTotal.add(amount);
    }

    const serializeTotal = (amount) => freezeDeep(serializeMoney(amount));
    return freezeDeep({
      currency: currencyOptions.currency,
      minorUnits: currencyOptions.minorUnits,
      employeeTotal: serializeTotal(employeeTotal),
      employerTotal: serializeTotal(employerTotal),
      combinedTotal: serializeTotal(employeeTotal.add(employerTotal)),
      filingGroups: [...filingGroups.values()].map((group) => ({
        authority: group.authority,
        remittance: group.remittance,
        liabilityCodes: [...new Set(group.liabilityCodes)].sort(),
        employeeTotal: serializeTotal(group.employeeTotal),
        employerTotal: serializeTotal(group.employerTotal),
        combinedTotal: serializeTotal(group.employeeTotal.add(group.employerTotal)),
      })),
      entries: normalizedEntries,
    });
  }
}

module.exports = new StatutoryLiabilityLedgerService();
module.exports.StatutoryLiabilityLedgerService = StatutoryLiabilityLedgerService;
