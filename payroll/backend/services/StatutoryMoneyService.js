'use strict';

/**
 * Exact decimal money arithmetic for statutory payroll calculations.
 *
 * Amounts and rates should cross application boundaries as decimal strings. A
 * JavaScript number is accepted for convenience, but it is interpreted from
 * its canonical string representation; precision already lost by a caller
 * before this service receives the number cannot be recovered.
 *
 * Rounding is always explicit and requires a named statutory stage. This lets
 * jurisdiction packs decide both when and how rounding occurs instead of
 * silently rounding every intermediate calculation to the currency scale.
 */

const MAX_DECIMAL_SCALE = 10000;
const SUPPORTED_MINOR_UNITS = Object.freeze([0, 2, 3]);
const ROUNDING_MODES = Object.freeze({
  HALF_UP: 'half_up',
  HALF_EVEN: 'half_even',
  FLOOR: 'floor',
  TRUNCATE: 'truncate',
  CEIL: 'ceil',
});

const powersOfTen = [1n];

function powerOfTen(exponent) {
  if (!Number.isSafeInteger(exponent) || exponent < 0 || exponent > MAX_DECIMAL_SCALE) {
    throw new RangeError(`Decimal scale must be between 0 and ${MAX_DECIMAL_SCALE}`);
  }

  while (powersOfTen.length <= exponent) {
    powersOfTen.push(powersOfTen[powersOfTen.length - 1] * 10n);
  }

  return powersOfTen[exponent];
}

function normalizeParts(coefficient, scale) {
  if (typeof coefficient !== 'bigint') {
    throw new TypeError('Decimal coefficient must be a bigint');
  }
  if (!Number.isSafeInteger(scale) || scale < 0 || scale > MAX_DECIMAL_SCALE) {
    throw new RangeError(`Decimal scale must be between 0 and ${MAX_DECIMAL_SCALE}`);
  }

  if (coefficient === 0n) {
    return { coefficient: 0n, scale: 0 };
  }

  let normalizedCoefficient = coefficient;
  let normalizedScale = scale;
  while (normalizedScale > 0 && normalizedCoefficient % 10n === 0n) {
    normalizedCoefficient /= 10n;
    normalizedScale -= 1;
  }

  return { coefficient: normalizedCoefficient, scale: normalizedScale };
}

function decimalInputToString(value, label = 'Decimal value') {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new TypeError(`${label} cannot be empty`);
    }
    return trimmed;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${label} must be finite`);
    }
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new RangeError(`${label} is an unsafe integer; provide it as a decimal string`);
    }
    return String(value);
  }

  throw new TypeError(`${label} must be a decimal string, bigint, or finite number`);
}

function parseDecimal(value, label) {
  if (value instanceof ExactDecimal) {
    return value;
  }

  const input = decimalInputToString(value, label);
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(input);
  if (!match) {
    throw new TypeError(`${label || 'Decimal value'} must be a base-10 decimal`);
  }

  const sign = match[1] === '-' ? -1n : 1n;
  const integerDigits = match[2] || '0';
  const fractionalDigits = match[3] !== undefined ? match[3] : (match[4] || '');
  const exponentText = match[5] || '0';
  const exponent = Number(exponentText);

  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_DECIMAL_SCALE) {
    throw new RangeError(`Decimal exponent must be between -${MAX_DECIMAL_SCALE} and ${MAX_DECIMAL_SCALE}`);
  }

  let coefficient = BigInt(`${integerDigits}${fractionalDigits}`) * sign;
  let scale = fractionalDigits.length - exponent;

  if (scale < 0) {
    coefficient *= powerOfTen(-scale);
    scale = 0;
  }

  if (scale > MAX_DECIMAL_SCALE) {
    throw new RangeError(`Decimal scale must not exceed ${MAX_DECIMAL_SCALE}`);
  }

  return new ExactDecimal(coefficient, scale);
}

function normalizeRoundingMode(mode) {
  const normalized = mode === 'trunc' ? ROUNDING_MODES.TRUNCATE : mode;
  if (!Object.values(ROUNDING_MODES).includes(normalized)) {
    throw new RangeError(
      `Unsupported rounding mode "${mode}"; use ${Object.values(ROUNDING_MODES).join(', ')}`
    );
  }
  return normalized;
}

function normalizeRoundingStage(stage) {
  if (typeof stage !== 'string' || !stage.trim()) {
    throw new TypeError('A non-empty statutory rounding stage is required');
  }
  return stage.trim();
}

function normalizeCurrency(currency) {
  if (typeof currency !== 'string' || !/^[A-Za-z]{3}$/.test(currency.trim())) {
    throw new TypeError('Currency must be a three-letter ISO currency code');
  }
  return currency.trim().toUpperCase();
}

function normalizeMinorUnits(minorUnits) {
  if (!SUPPORTED_MINOR_UNITS.includes(minorUnits)) {
    throw new RangeError('minorUnits must be one of 0, 2, or 3');
  }
  return minorUnits;
}

function minorUnitDecimal(minorUnits) {
  return new ExactDecimal(1n, minorUnits);
}

class ExactDecimal {
  constructor(coefficient, scale) {
    const normalized = normalizeParts(coefficient, scale);
    this.coefficient = normalized.coefficient;
    this.scale = normalized.scale;
    Object.freeze(this);
  }

  static from(value, label = 'Decimal value') {
    return parseDecimal(value, label);
  }

  add(other) {
    const right = ExactDecimal.from(other);
    const commonScale = Math.max(this.scale, right.scale);
    const leftCoefficient = this.coefficient * powerOfTen(commonScale - this.scale);
    const rightCoefficient = right.coefficient * powerOfTen(commonScale - right.scale);
    return new ExactDecimal(leftCoefficient + rightCoefficient, commonScale);
  }

  subtract(other) {
    const right = ExactDecimal.from(other);
    const commonScale = Math.max(this.scale, right.scale);
    const leftCoefficient = this.coefficient * powerOfTen(commonScale - this.scale);
    const rightCoefficient = right.coefficient * powerOfTen(commonScale - right.scale);
    return new ExactDecimal(leftCoefficient - rightCoefficient, commonScale);
  }

  multiply(other) {
    const right = ExactDecimal.from(other);
    const resultScale = this.scale + right.scale;
    if (resultScale > MAX_DECIMAL_SCALE) {
      throw new RangeError(`Decimal scale must not exceed ${MAX_DECIMAL_SCALE}`);
    }
    return new ExactDecimal(this.coefficient * right.coefficient, resultScale);
  }

  compare(other) {
    const right = ExactDecimal.from(other);
    const commonScale = Math.max(this.scale, right.scale);
    const leftCoefficient = this.coefficient * powerOfTen(commonScale - this.scale);
    const rightCoefficient = right.coefficient * powerOfTen(commonScale - right.scale);
    if (leftCoefficient < rightCoefficient) return -1;
    if (leftCoefficient > rightCoefficient) return 1;
    return 0;
  }

  roundToUnit(unit, mode) {
    const roundingUnit = ExactDecimal.from(unit, 'Rounding unit');
    const normalizedMode = normalizeRoundingMode(mode);
    if (roundingUnit.coefficient <= 0n) {
      throw new RangeError('Rounding unit must be greater than zero');
    }

    const commonScale = Math.max(this.scale, roundingUnit.scale);
    const valueCoefficient = this.coefficient * powerOfTen(commonScale - this.scale);
    const unitCoefficient = roundingUnit.coefficient * powerOfTen(commonScale - roundingUnit.scale);
    let quotient = valueCoefficient / unitCoefficient;
    const remainder = valueCoefficient % unitCoefficient;

    if (remainder !== 0n) {
      const sign = valueCoefficient < 0n ? -1n : 1n;
      const absoluteRemainder = remainder < 0n ? -remainder : remainder;
      const twiceRemainder = absoluteRemainder * 2n;

      if (normalizedMode === ROUNDING_MODES.FLOOR && sign < 0n) {
        quotient -= 1n;
      } else if (normalizedMode === ROUNDING_MODES.CEIL && sign > 0n) {
        quotient += 1n;
      } else if (normalizedMode === ROUNDING_MODES.HALF_UP && twiceRemainder >= unitCoefficient) {
        quotient += sign;
      } else if (normalizedMode === ROUNDING_MODES.HALF_EVEN) {
        const isPastHalf = twiceRemainder > unitCoefficient;
        const isHalfOnOddUnit = twiceRemainder === unitCoefficient && (quotient < 0n ? -quotient : quotient) % 2n === 1n;
        if (isPastHalf || isHalfOnOddUnit) {
          quotient += sign;
        }
      }
    }

    return new ExactDecimal(quotient * unitCoefficient, commonScale);
  }

  toScaledInteger(decimalPlaces) {
    if (!Number.isSafeInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > MAX_DECIMAL_SCALE) {
      throw new RangeError(`Decimal places must be between 0 and ${MAX_DECIMAL_SCALE}`);
    }

    if (this.scale <= decimalPlaces) {
      return this.coefficient * powerOfTen(decimalPlaces - this.scale);
    }

    const divisor = powerOfTen(this.scale - decimalPlaces);
    if (this.coefficient % divisor !== 0n) {
      throw new RangeError('Value has excess precision; round at a declared statutory stage first');
    }
    return this.coefficient / divisor;
  }

  toFixed(decimalPlaces) {
    const scaledInteger = this.toScaledInteger(decimalPlaces);
    const negative = scaledInteger < 0n;
    const digits = (negative ? -scaledInteger : scaledInteger).toString();

    if (decimalPlaces === 0) {
      return `${negative ? '-' : ''}${digits}`;
    }

    const padded = digits.padStart(decimalPlaces + 1, '0');
    const integerPart = padded.slice(0, -decimalPlaces);
    const fractionalPart = padded.slice(-decimalPlaces);
    return `${negative ? '-' : ''}${integerPart}.${fractionalPart}`;
  }

  toString() {
    if (this.scale === 0) {
      return this.coefficient.toString();
    }

    const negative = this.coefficient < 0n;
    const digits = (negative ? -this.coefficient : this.coefficient)
      .toString()
      .padStart(this.scale + 1, '0');
    const integerPart = digits.slice(0, -this.scale);
    const fractionalPart = digits.slice(-this.scale);
    return `${negative ? '-' : ''}${integerPart}.${fractionalPart}`;
  }

  toJSON() {
    return this.toString();
  }
}

class StatutoryMoney {
  constructor(decimal, { currency, minorUnits }, roundingHistory = []) {
    this.currency = normalizeCurrency(currency);
    this.minorUnits = normalizeMinorUnits(minorUnits);
    this.decimal = ExactDecimal.from(decimal, 'Money amount');
    this.roundingHistory = Object.freeze(roundingHistory.map((event) => Object.freeze({ ...event })));
    Object.freeze(this);
  }

  static from(value, options) {
    if (value instanceof StatutoryMoney) {
      if (options) {
        const currency = normalizeCurrency(options.currency);
        const minorUnits = normalizeMinorUnits(options.minorUnits);
        if (value.currency !== currency || value.minorUnits !== minorUnits) {
          throw new RangeError('Money currency and minor-unit scale do not match');
        }
      }
      return value;
    }

    if (!options || typeof options !== 'object') {
      throw new TypeError('Money options with currency and minorUnits are required');
    }
    return new StatutoryMoney(value, options);
  }

  static fromMinorUnits(value, options) {
    if (!options || typeof options !== 'object') {
      throw new TypeError('Money options with currency and minorUnits are required');
    }
    const minorUnits = normalizeMinorUnits(options.minorUnits);
    const input = decimalInputToString(value, 'Minor-unit amount');
    if (!/^[+-]?\d+$/.test(input)) {
      throw new TypeError('Minor-unit amount must be an integer');
    }
    return new StatutoryMoney(new ExactDecimal(BigInt(input), minorUnits), options);
  }

  assertCompatible(other) {
    if (this.currency !== other.currency || this.minorUnits !== other.minorUnits) {
      throw new RangeError('Cannot combine money with different currencies or minor-unit scales');
    }
  }

  decimalOperand(value) {
    if (value instanceof StatutoryMoney) {
      this.assertCompatible(value);
      return value.decimal;
    }
    return ExactDecimal.from(value, 'Money operand');
  }

  withDecimal(decimal, roundingHistory = this.roundingHistory) {
    return new StatutoryMoney(decimal, this, roundingHistory);
  }

  add(other) {
    return this.withDecimal(this.decimal.add(this.decimalOperand(other)));
  }

  subtract(other) {
    return this.withDecimal(this.decimal.subtract(this.decimalOperand(other)));
  }

  multiplyByRate(rate) {
    if (rate instanceof StatutoryMoney) {
      throw new TypeError('A rate must be dimensionless, not a money value');
    }
    return this.withDecimal(this.decimal.multiply(ExactDecimal.from(rate, 'Rate')));
  }

  round({ unit, mode, stage } = {}) {
    let roundingUnit;
    if (unit instanceof StatutoryMoney) {
      this.assertCompatible(unit);
      roundingUnit = unit.decimal;
    } else {
      roundingUnit = ExactDecimal.from(unit, 'Rounding unit');
    }

    const normalizedMode = normalizeRoundingMode(mode);
    const normalizedStage = normalizeRoundingStage(stage);
    const rounded = this.decimal.roundToUnit(roundingUnit, normalizedMode);
    const event = {
      stage: normalizedStage,
      mode: normalizedMode,
      unit: roundingUnit.toString(),
      input: this.decimal.toString(),
      output: rounded.toString(),
    };

    return this.withDecimal(rounded, [...this.roundingHistory, event]);
  }

  roundToMinorUnit({ mode, stage } = {}) {
    return this.round({ unit: minorUnitDecimal(this.minorUnits), mode, stage });
  }

  toMinorUnits() {
    return this.decimal.toScaledInteger(this.minorUnits);
  }

  toFixed(decimalPlaces = this.minorUnits) {
    return this.decimal.toFixed(decimalPlaces);
  }

  toString() {
    return this.decimal.toString();
  }

  equals(other) {
    return other instanceof StatutoryMoney
      && this.currency === other.currency
      && this.minorUnits === other.minorUnits
      && this.decimal.compare(other.decimal) === 0;
  }

  toJSON() {
    return {
      amount: this.toString(),
      currency: this.currency,
      minorUnits: this.minorUnits,
      roundingHistory: this.roundingHistory,
    };
  }

  valueOf() {
    throw new TypeError('StatutoryMoney cannot be coerced to a JavaScript number');
  }
}

class StatutoryMoneyService {
  create(value, options) {
    return StatutoryMoney.from(value, options);
  }

  fromMinorUnits(value, options) {
    return StatutoryMoney.fromMinorUnits(value, options);
  }

  add(left, right, options) {
    return StatutoryMoney.from(left, options).add(right);
  }

  subtract(left, right, options) {
    return StatutoryMoney.from(left, options).subtract(right);
  }

  multiplyByRate(amount, rate, options) {
    return StatutoryMoney.from(amount, options).multiplyByRate(rate);
  }

  round(amount, { currency, minorUnits, unit, mode, stage }) {
    const options = amount instanceof StatutoryMoney ? undefined : { currency, minorUnits };
    return StatutoryMoney.from(amount, options).round({ unit, mode, stage });
  }

  roundToMinorUnit(amount, { currency, minorUnits, mode, stage }) {
    const options = amount instanceof StatutoryMoney ? undefined : { currency, minorUnits };
    return StatutoryMoney.from(amount, options).roundToMinorUnit({ mode, stage });
  }
}

const statutoryMoneyService = new StatutoryMoneyService();

module.exports = statutoryMoneyService;
module.exports.StatutoryMoneyService = StatutoryMoneyService;
module.exports.StatutoryMoney = StatutoryMoney;
module.exports.ExactDecimal = ExactDecimal;
module.exports.ROUNDING_MODES = ROUNDING_MODES;
module.exports.SUPPORTED_MINOR_UNITS = SUPPORTED_MINOR_UNITS;
