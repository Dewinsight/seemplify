'use strict';

const statutoryMoneyService = require('../StatutoryMoneyService');
const {
  ExactDecimal,
  StatutoryMoney,
  ROUNDING_MODES,
} = require('../StatutoryMoneyService');

const currency = (currencyCode, minorUnits) => ({ currency: currencyCode, minorUnits });

describe('StatutoryMoneyService exact arithmetic', () => {
  test('keeps 0.1 + 0.2 exact instead of leaking binary floating-point drift', () => {
    const fromStrings = statutoryMoneyService
      .create('0.1', currency('CAD', 2))
      .add('0.2');
    const fromNumbers = statutoryMoneyService
      .create(0.1, currency('CAD', 2))
      .add(0.2);

    expect(fromStrings.toString()).toBe('0.3');
    expect(fromStrings.toFixed()).toBe('0.30');
    expect(fromNumbers.toString()).toBe('0.3');
  });

  test('adds and subtracts exact decimal tax bases', () => {
    const taxablePay = statutoryMoneyService
      .create('1000.10', currency('CAD', 2))
      .subtract('0.20')
      .add('0.05');

    expect(taxablePay.toString()).toBe('999.95');
    expect(taxablePay.toMinorUnits()).toBe(99995n);
  });

  test('multiplies an amount by a decimal rate without rounding the intermediate result', () => {
    const liability = statutoryMoneyService
      .create('1234.56', currency('CAD', 2))
      .multiplyByRate('0.0765');

    expect(liability.toString()).toBe('94.44384');
    expect(() => liability.toFixed()).toThrow(/round at a declared statutory stage/i);
    expect(
      liability.roundToMinorUnit({
        mode: ROUNDING_MODES.HALF_UP,
        stage: 'ca.federal.final_liability',
      }).toFixed()
    ).toBe('94.44');
  });

  test('supports exact construction from and conversion back to integer minor units', () => {
    const amount = statutoryMoneyService.fromMinorUnits(12345n, currency('CAD', 2));

    expect(amount.toString()).toBe('123.45');
    expect(amount.toMinorUnits()).toBe(12345n);
  });

  test('rejects unsafe integer numbers so lost source precision is not disguised', () => {
    expect(() => statutoryMoneyService.create(9007199254740992, currency('CAD', 2)))
      .toThrow(/unsafe integer/i);
  });

  test('does not permit implicit coercion back to binary floating point', () => {
    const amount = statutoryMoneyService.create('1.25', currency('CAD', 2));

    expect(() => Number(amount)).toThrow(/cannot be coerced/i);
  });
});
describe('currency minor-unit contracts', () => {
  test.each(['JPY', 'CLP', 'PYG'])(
    '%s rounds and formats in whole currency units',
    (currencyCode) => {
      const rounded = statutoryMoneyService
        .create('123.5', currency(currencyCode, 0))
        .roundToMinorUnit({ mode: ROUNDING_MODES.HALF_UP, stage: `${currencyCode}.final` });

      expect(rounded.toFixed()).toBe('124');
      expect(rounded.toMinorUnits()).toBe(124n);
    }
  );

  test('BHD supports three decimals with half-up rounding', () => {
    const rounded = statutoryMoneyService
      .create('1.2345', currency('BHD', 3))
      .roundToMinorUnit({ mode: ROUNDING_MODES.HALF_UP, stage: 'bh.final' });

    expect(rounded.toFixed()).toBe('1.235');
    expect(rounded.toMinorUnits()).toBe(1235n);
  });

  test('KWD supports three decimals with half-even rounding', () => {
    const evenTie = statutoryMoneyService
      .create('1.2345', currency('KWD', 3))
      .roundToMinorUnit({ mode: ROUNDING_MODES.HALF_EVEN, stage: 'kw.final' });
    const oddTie = statutoryMoneyService
      .create('1.2355', currency('KWD', 3))
      .roundToMinorUnit({ mode: ROUNDING_MODES.HALF_EVEN, stage: 'kw.final' });

    expect(evenTie.toFixed()).toBe('1.234');
    expect(oddTie.toFixed()).toBe('1.236');
  });

  test('only the currently required 0, 2, and 3 minor-unit scales are accepted', () => {
    expect(() => statutoryMoneyService.create('1', currency('USD', 1)))
      .toThrow(/0, 2, or 3/i);
  });
});

describe('declared-stage rounding contracts', () => {
  test('records the declared stage, rule, unit, input, and output', () => {
    const rounded = statutoryMoneyService
      .create('1.005', currency('CAD', 2))
      .round({ unit: '0.01', mode: ROUNDING_MODES.HALF_UP, stage: 'ca.payroll.final' });

    expect(rounded.toFixed()).toBe('1.01');
    expect(rounded.roundingHistory).toEqual([
      {
        stage: 'ca.payroll.final',
        mode: 'half_up',
        unit: '0.01',
        input: '1.005',
        output: '1.01',
      },
    ]);
  });

  test('service rounding helpers accept an existing money value without repeated currency metadata', () => {
    const amount = statutoryMoneyService.create('1.005', currency('CAD', 2));
    const rounded = statutoryMoneyService.roundToMinorUnit(amount, {
      mode: 'half_up',
      stage: 'ca.payroll.final',
    });

    expect(rounded.toFixed()).toBe('1.01');
  });

  test('requires a statutory stage and a positive rounding unit', () => {
    const amount = statutoryMoneyService.create('1.005', currency('CAD', 2));

    expect(() => amount.round({ unit: '0.01', mode: 'half_up' }))
      .toThrow(/rounding stage is required/i);
    expect(() => amount.round({ unit: '0', mode: 'half_up', stage: 'final' }))
      .toThrow(/greater than zero/i);
  });

  test('distinguishes half-up and half-even cent ties', () => {
    const amount = statutoryMoneyService.create('10.125', currency('CAD', 2));

    expect(amount.round({ unit: '0.01', mode: 'half_up', stage: 'cent' }).toFixed()).toBe('10.13');
    expect(amount.round({ unit: '0.01', mode: 'half_even', stage: 'cent' }).toFixed()).toBe('10.12');
  });

  test('supports Canadian nickel rounding as an arbitrary 0.05 unit', () => {
    const down = statutoryMoneyService
      .create('10.02', currency('CAD', 2))
      .round({ unit: '0.05', mode: 'half_up', stage: 'ca.cash_total' });
    const up = statutoryMoneyService
      .create('10.03', currency('CAD', 2))
      .round({ unit: '0.05', mode: 'half_up', stage: 'ca.cash_total' });

    expect(down.toFixed()).toBe('10.00');
    expect(up.toFixed()).toBe('10.05');
  });

  test('supports whole-unit rounding independently of the currency minor units', () => {
    const amount = statutoryMoneyService.create('152.5', currency('CAD', 2));

    expect(amount.round({ unit: '1', mode: 'half_up', stage: 'whole' }).toFixed()).toBe('153.00');
    expect(amount.round({ unit: '1', mode: 'half_even', stage: 'whole' }).toFixed()).toBe('152.00');
  });

  test('truncates a third Canadian decimal rather than rounding it', () => {
    const positive = statutoryMoneyService
      .create('12.349', currency('CAD', 2))
      .round({ unit: '0.01', mode: 'truncate', stage: 'ca.statutory_truncation' });
    const negative = statutoryMoneyService
      .create('-12.349', currency('CAD', 2))
      .round({ unit: '0.01', mode: 'trunc', stage: 'ca.statutory_truncation' });

    expect(positive.toFixed()).toBe('12.34');
    expect(negative.toFixed()).toBe('-12.34');
  });

  test('keeps floor, truncate, and ceil semantics distinct for negative values', () => {
    const amount = statutoryMoneyService.create('-12.341', currency('CAD', 2));

    expect(amount.round({ unit: '0.01', mode: 'floor', stage: 'floor' }).toFixed()).toBe('-12.35');
    expect(amount.round({ unit: '0.01', mode: 'truncate', stage: 'truncate' }).toFixed()).toBe('-12.34');
    expect(amount.round({ unit: '0.01', mode: 'ceil', stage: 'ceil' }).toFixed()).toBe('-12.34');
  });

  test('rounds negative half ties away from zero for half-up', () => {
    const rounded = statutoryMoneyService
      .create('-10.025', currency('CAD', 2))
      .round({ unit: '0.05', mode: 'half_up', stage: 'ca.cash_total' });

    expect(rounded.toFixed()).toBe('-10.05');
  });
});

describe('validation and compatibility boundaries', () => {
  test('rejects addition across currencies', () => {
    const cad = StatutoryMoney.from('1.00', currency('CAD', 2));
    const usd = StatutoryMoney.from('1.00', currency('USD', 2));

    expect(() => cad.add(usd)).toThrow(/different currencies/i);
  });

  test('accepts decimal exponent notation exactly', () => {
    expect(ExactDecimal.from('1.25e-3').toString()).toBe('0.00125');
    expect(ExactDecimal.from('1.25e3').toString()).toBe('1250');
  });

  test.each(['nearest', 'bankers', '', undefined])('rejects unsupported mode %p', (mode) => {
    const amount = statutoryMoneyService.create('1.00', currency('CAD', 2));

    expect(() => amount.round({ unit: '0.01', mode, stage: 'final' }))
      .toThrow(/unsupported rounding mode/i);
  });

  test.each(['NaN', 'Infinity', '1,000.00', '$1.00', ''])('rejects invalid decimal input %p', (input) => {
    expect(() => statutoryMoneyService.create(input, currency('CAD', 2)))
      .toThrow();
  });
});
