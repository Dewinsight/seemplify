'use strict';

const service = require('../StatutoryYearToDateService');

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function base(overrides = {}) {
  return {
    jurisdictionCode: 'GB',
    currency: 'GBP',
    minorUnits: 2,
    taxYear: { label: '2026/27', start: '2026-04-06', end: '2027-04-05' },
    currentPayment: {
      paymentDate: '2026-06-30',
      periodStart: '2026-06-01',
      periodEnd: '2026-06-30',
      sequence: 1,
    },
    priorPayments: [],
    ...overrides,
  };
}

function payment(overrides = {}) {
  return {
    sourceId: 'PS-APRIL',
    sourceHash: HASH_A,
    calculationVersionId: 'GB-2026-V1',
    status: 'paid',
    paymentDate: '2026-04-30',
    periodStart: '2026-04-06',
    periodEnd: '2026-04-30',
    sequence: 1,
    grossPay: '1000.10',
    taxableIncome: '900.20',
    incomeTax: '100.30',
    liabilities: [
      { code: 'PAYE', payer: 'employee', amount: '100.30' },
      { code: 'NIC_ER', payer: 'employer', amount: '70.05' },
    ],
    ...overrides,
  };
}

describe('StatutoryYearToDateService', () => {
  test('builds an immutable zero snapshot with a deterministic digest', () => {
    const context = service.buildContext(base());
    expect(context.priorPaymentCount).toBe(0);
    expect(context.totals.grossPay.amount).toBe('0.00');
    expect(context.totals.taxableIncome.amount).toBe('0.00');
    expect(context.totals.incomeTax.amount).toBe('0.00');
    expect(context.snapshotDigestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.totals)).toBe(true);
  });

  test('sums prior payments and liabilities exactly without binary floating point', () => {
    const context = service.buildContext(base({
      priorPayments: [
        payment({ grossPay: '0.10', taxableIncome: '0.10', incomeTax: '0.10' }),
        payment({
          sourceId: 'PS-MAY',
          sourceHash: HASH_B,
          paymentDate: '2026-05-31',
          periodStart: '2026-05-01',
          periodEnd: '2026-05-31',
          grossPay: '0.20',
          taxableIncome: '0.20',
          incomeTax: '0.20',
          liabilities: [
            { code: 'PAYE', payer: 'employee', amount: '0.20' },
            { code: 'NIC_ER', payer: 'employer', amount: '0.20' },
          ],
        }),
      ],
    }));
    expect(context.totals.grossPay.amount).toBe('0.30');
    expect(context.totals.taxableIncome.amount).toBe('0.30');
    expect(context.totals.incomeTax.amount).toBe('0.30');
    expect(context.totals.liabilities).toEqual([
      expect.objectContaining({ code: 'PAYE', payer: 'employee', amount: expect.objectContaining({ amount: '100.50' }) }),
      expect.objectContaining({ code: 'NIC_ER', payer: 'employer', amount: expect.objectContaining({ amount: '70.25' }) }),
    ]);
  });

  test('sorts source receipts before hashing so caller order cannot change the snapshot', () => {
    const april = payment();
    const may = payment({
      sourceId: 'PS-MAY', sourceHash: HASH_B, paymentDate: '2026-05-31',
      periodStart: '2026-05-01', periodEnd: '2026-05-31',
    });
    const first = service.buildContext(base({ priorPayments: [may, april] }));
    const second = service.buildContext(base({ priorPayments: [april, may] }));
    expect(first.sourceIds).toEqual(['PS-APRIL', 'PS-MAY']);
    expect(first.snapshotDigestSha256).toBe(second.snapshotDigestSha256);
  });

  test('same-day payments require an earlier explicit sequence', () => {
    const context = service.buildContext(base({
      currentPayment: {
        paymentDate: '2026-06-30', periodStart: '2026-06-01', periodEnd: '2026-06-30', sequence: 2,
      },
      priorPayments: [payment({
        paymentDate: '2026-06-30', periodStart: '2026-06-01', periodEnd: '2026-06-30', sequence: 1,
      })],
    }));
    expect(context.sourceIds).toEqual(['PS-APRIL']);

    expect(() => service.buildContext(base({
      currentPayment: {
        paymentDate: '2026-06-30', periodStart: '2026-06-01', periodEnd: '2026-06-30', sequence: 2,
      },
      priorPayments: [payment({
        paymentDate: '2026-06-30', periodStart: '2026-06-01', periodEnd: '2026-06-30', sequence: 2,
      })],
    }))).toThrow(expect.objectContaining({ code: 'STATUTORY_YTD_PAYMENT_ORDER_CONFLICT' }));
  });

  test.each([
    ['future payment', payment({ paymentDate: '2026-07-01', periodStart: '2026-07-01', periodEnd: '2026-07-01' }), 'STATUTORY_YTD_FUTURE_PAYMENT'],
    ['outside tax year', payment({ paymentDate: '2026-04-05', periodStart: '2026-04-01', periodEnd: '2026-04-05' }), 'STATUTORY_YTD_OUTSIDE_TAX_YEAR'],
    ['unposted status', payment({ status: 'calculated' }), 'STATUTORY_YTD_UNPOSTED_PAYMENT'],
    ['invalid source digest', payment({ sourceHash: 'abc' }), 'STATUTORY_YTD_INVALID_SOURCE_HASH'],
    ['negative gross', payment({ grossPay: '-1.00' }), 'STATUTORY_YTD_NEGATIVE_AMOUNT'],
    ['sub-minor-unit amount', payment({ grossPay: '1.001' }), 'STATUTORY_YTD_INVALID_MONEY'],
  ])('rejects %s', (_label, prior, code) => {
    expect(() => service.buildContext(base({ priorPayments: [prior] })))
      .toThrow(expect.objectContaining({ code }));
  });

  test('rejects duplicate source receipts and duplicate component identities', () => {
    expect(() => service.buildContext(base({ priorPayments: [payment(), payment()] })))
      .toThrow(expect.objectContaining({ code: 'STATUTORY_YTD_DUPLICATE_SOURCE' }));
    expect(() => service.buildContext(base({ priorPayments: [payment({ liabilities: [
      { code: 'PAYE', payer: 'employee', amount: '10.00' },
      { code: 'PAYE', payer: 'employee', amount: '20.00' },
    ] })] })))
      .toThrow(expect.objectContaining({ code: 'STATUTORY_YTD_DUPLICATE_LIABILITY' }));
  });

  test('permits an evidenced prior-period refund and carries its signed exact total', () => {
    const context = service.buildContext(base({
      priorPayments: [payment({ incomeTax: '-5.25', liabilities: [
        { code: 'PAYE', payer: 'employee', amount: '-5.25' },
      ] })],
    }));
    expect(context.totals.incomeTax.amount).toBe('-5.25');
    expect(context.totals.liabilities[0].amount.amount).toBe('-5.25');
  });

  test('computes a positive cumulative current-period delta', () => {
    const context = service.buildContext(base({ priorPayments: [payment()] }));
    const delta = service.calculateCumulativeDelta({
      context,
      targetCumulativeIncomeTax: '180.30',
      refundPolicy: service.REFUND_POLICIES.ALLOW,
      stage: 'gb.paye.period3.cumulative_delta',
    });
    expect(delta.previousCumulativeIncomeTax.amount).toBe('100.30');
    expect(delta.rawCurrentPeriodDelta.amount).toBe('80.00');
    expect(delta.appliedCurrentPeriodDelta.amount).toBe('80.00');
    expect(delta.adjustment).toBe('none');
  });

  test('makes cumulative refund handling explicit per adapter', () => {
    const context = service.buildContext(base({ priorPayments: [payment()] }));
    const allowed = service.calculateCumulativeDelta({
      context,
      targetCumulativeIncomeTax: '90.30',
      refundPolicy: service.REFUND_POLICIES.ALLOW,
      stage: 'gb.paye.refund',
    });
    expect(allowed.appliedCurrentPeriodDelta.amount).toBe('-10.00');
    expect(allowed.adjustment).toBe('refund_allowed');

    const clamped = service.calculateCumulativeDelta({
      context,
      targetCumulativeIncomeTax: '90.30',
      refundPolicy: service.REFUND_POLICIES.CLAMP_ZERO,
      stage: 'example.no_refund',
    });
    expect(clamped.rawCurrentPeriodDelta.amount).toBe('-10.00');
    expect(clamped.appliedCurrentPeriodDelta.amount).toBe('0.00');
    expect(clamped.adjustment).toBe('negative_delta_clamped_to_zero');

    expect(() => service.calculateCumulativeDelta({
      context,
      targetCumulativeIncomeTax: '90.30',
      refundPolicy: service.REFUND_POLICIES.BLOCK,
      stage: 'example.uncertified_refund',
    })).toThrow(expect.objectContaining({ code: 'STATUTORY_YTD_NEGATIVE_DELTA_BLOCKED' }));
  });

  test.each([
    ['JPY', 0, '100', '100'],
    ['GBP', 2, '100.25', '100.25'],
    ['BHD', 3, '100.125', '100.125'],
  ])('supports %s minor-unit YTD snapshots', (currency, minorUnits, amount, expected) => {
    const context = service.buildContext(base({
      jurisdictionCode: currency === 'JPY' ? 'JP' : currency === 'BHD' ? 'BH' : 'GB',
      currency,
      minorUnits,
      priorPayments: [payment({
        grossPay: amount,
        taxableIncome: amount,
        incomeTax: amount,
        liabilities: [],
      })],
    }));
    expect(context.totals.grossPay.amount).toBe(expected);
  });

  test('uses UTC date-only rules around leap-day tax years', () => {
    const context = service.buildContext(base({
      jurisdictionCode: 'ZA',
      currency: 'ZAR',
      taxYear: { label: '2028', start: '2027-03-01', end: '2028-02-29' },
      currentPayment: {
        paymentDate: '2028-02-29', periodStart: '2028-02-01', periodEnd: '2028-02-29', sequence: 1,
      },
      priorPayments: [payment({
        paymentDate: '2027-03-01', periodStart: '2027-03-01', periodEnd: '2027-03-01',
      })],
    }));
    expect(context.taxYear.end).toBe('2028-02-29');
  });

  test('changes the snapshot digest whenever a legal source amount changes', () => {
    const first = service.buildContext(base({ priorPayments: [payment()] }));
    const second = service.buildContext(base({ priorPayments: [payment({ incomeTax: '100.31' })] }));
    expect(first.snapshotDigestSha256).not.toBe(second.snapshotDigestSha256);
  });
});
