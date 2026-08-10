const ExchangeRate = require('../../models/ExchangeRate');
const Payslip = require('../../models/Payslip');
const currencyService = require('../CurrencyService');

function sortedQuery(value) {
  return { sort: jest.fn().mockResolvedValue(value) };
}

function installSuccessfulWriteMocks({ nextRate = null, callOrder = [] } = {}) {
  jest.spyOn(ExchangeRate, 'findOne').mockImplementation((query) => {
    if (query.effectiveDate instanceof Date) return Promise.resolve(null);
    if (query.effectiveDate?.$gt) return sortedQuery(nextRate);
    return Promise.resolve(null);
  });
  jest.spyOn(Payslip, 'exists').mockResolvedValue(null);
  jest.spyOn(ExchangeRate.prototype, 'save').mockImplementation(async function save() {
    callOrder.push('save');
    return this;
  });
  jest.spyOn(ExchangeRate, 'updateOne').mockImplementation(async () => {
    callOrder.push('updateOne');
    return { acknowledged: true, modifiedCount: 1 };
  });
  jest.spyOn(ExchangeRate, 'updateMany').mockImplementation(async () => {
    callOrder.push('updateMany');
    return { acknowledged: true };
  });
}

describe('CurrencyService exchange-rate history', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('uses one exact-instant unique key for the pair regardless of source', () => {
    const [, uniqueOptions] = ExchangeRate.schema.indexes().find(([, options]) => (
      options.name === 'exchange_rate_pair_effective_instant_unique'
    ));
    const [uniqueFields] = ExchangeRate.schema.indexes().find(([, options]) => (
      options.name === 'exchange_rate_pair_effective_instant_unique'
    ));

    expect(uniqueOptions.unique).toBe(true);
    expect(uniqueFields).toEqual({
      organizationId: 1,
      baseCurrency: 1,
      targetCurrency: 1,
      effectiveDate: 1,
    });
    expect(uniqueFields).not.toHaveProperty('source');
  });

  test('inserts before changing any existing window and clips itself to the next rate found after insert', async () => {
    const callOrder = [];
    const nextRate = {
      _id: 'next-rate',
      effectiveDate: new Date('2026-03-01T00:00:00.000Z'),
    };
    installSuccessfulWriteMocks({ nextRate, callOrder });

    const result = await currencyService.setRate('org-1', 'gbp', 'usd', 1.25, {
      source: 'api',
      effectiveDate: '2026-02-01T00:00:00.000Z',
    });

    expect(callOrder).toEqual(['save', 'updateOne', 'updateMany']);
    expect(result.expiresAt.toISOString()).toBe('2026-02-28T23:59:59.999Z');
    expect(ExchangeRate.updateOne).toHaveBeenCalledWith(
      { _id: result._id, isActive: true },
      { $set: { expiresAt: new Date('2026-02-28T23:59:59.999Z') } }
    );
    expect(ExchangeRate.updateMany.mock.calls[0][0]).toMatchObject({
      organizationId: 'org-1',
      baseCurrency: 'GBP',
      targetCurrency: 'USD',
      _id: { $ne: result._id },
      isActive: true,
      effectiveDate: { $lt: new Date('2026-02-01T00:00:00.000Z') },
    });
    expect(ExchangeRate.updateMany.mock.calls[0][0]).not.toHaveProperty('source');
  });

  test('repairs windows when an older concurrent writer finishes after the newer writer', async () => {
    const rows = [];
    let releaseOlderSave;
    let markOlderSaveStarted;
    const olderSaveStarted = new Promise((resolve) => { markOlderSaveStarted = resolve; });
    const olderSaveRelease = new Promise((resolve) => { releaseOlderSave = resolve; });

    jest.spyOn(Payslip, 'exists').mockResolvedValue(null);
    jest.spyOn(ExchangeRate, 'findOne').mockImplementation((query) => {
      if (query.effectiveDate instanceof Date) {
        return Promise.resolve(rows.find((row) => (
          row.effectiveDate.getTime() === query.effectiveDate.getTime()
        )) || null);
      }
      if (query.effectiveDate?.$gt) {
        return {
          sort: jest.fn().mockImplementation(async () => rows
            .filter((row) => row.isActive !== false
              && row.effectiveDate > query.effectiveDate.$gt
              && String(row._id) !== String(query._id?.$ne))
            .sort((a, b) => a.effectiveDate - b.effectiveDate)[0] || null),
        };
      }
      return Promise.resolve(null);
    });
    jest.spyOn(ExchangeRate.prototype, 'save').mockImplementation(async function save() {
      if (this.effectiveDate.toISOString() === '2026-02-01T00:00:00.000Z') {
        markOlderSaveStarted();
        await olderSaveRelease;
      }
      rows.push(this);
      return this;
    });
    jest.spyOn(ExchangeRate, 'updateOne').mockImplementation(async (filter, update) => {
      const row = rows.find((entry) => String(entry._id) === String(filter._id));
      if (row) row.expiresAt = update.$set.expiresAt;
      return { acknowledged: true, modifiedCount: row ? 1 : 0 };
    });
    jest.spyOn(ExchangeRate, 'updateMany').mockImplementation(async (filter, update) => {
      rows.forEach((row) => {
        if (String(row._id) === String(filter._id?.$ne)) return;
        if (row.effectiveDate >= filter.effectiveDate.$lt) return;
        if (row.expiresAt && row.expiresAt < filter.effectiveDate.$lt) return;
        row.expiresAt = update.$set.expiresAt;
      });
      return { acknowledged: true };
    });

    const olderWrite = currencyService.setRate('org-1', 'GBP', 'USD', 1.2, {
      effectiveDate: '2026-02-01T00:00:00.000Z',
    });
    await olderSaveStarted;
    const newerRate = await currencyService.setRate('org-1', 'GBP', 'USD', 1.3, {
      source: 'api',
      effectiveDate: '2026-03-01T00:00:00.000Z',
    });
    releaseOlderSave();
    const olderRate = await olderWrite;

    expect(rows).toHaveLength(2);
    expect(newerRate.expiresAt).toBeNull();
    expect(olderRate.expiresAt.toISOString()).toBe('2026-02-28T23:59:59.999Z');
  });

  test('treats a same-value duplicate-key race as an idempotent success and repairs boundaries', async () => {
    const concurrent = new ExchangeRate({
      organizationId: 'org-1',
      baseCurrency: 'GBP',
      targetCurrency: 'USD',
      rate: 1.2,
      effectiveDate: new Date('2026-02-01T00:00:00.000Z'),
      source: 'api',
      isActive: true,
    });
    let exactReads = 0;
    jest.spyOn(ExchangeRate, 'findOne').mockImplementation((query) => {
      if (query.effectiveDate instanceof Date) {
        exactReads += 1;
        return Promise.resolve(exactReads === 1 ? null : concurrent);
      }
      if (query.effectiveDate?.$gt) return sortedQuery(null);
      return Promise.resolve(null);
    });
    jest.spyOn(Payslip, 'exists').mockResolvedValue(null);
    jest.spyOn(ExchangeRate.prototype, 'save').mockRejectedValue(Object.assign(new Error('duplicate'), { code: 11000 }));
    jest.spyOn(ExchangeRate, 'updateOne').mockResolvedValue({ acknowledged: true });
    jest.spyOn(ExchangeRate, 'updateMany').mockResolvedValue({ acknowledged: true });

    await expect(currencyService.setRate('org-1', 'GBP', 'USD', 1.2, {
      source: 'manual',
      effectiveDate: '2026-02-01T00:00:00.000Z',
    })).resolves.toBe(concurrent);

    expect(ExchangeRate.updateMany).toHaveBeenCalledTimes(1);
    expect(ExchangeRate.updateMany.mock.calls[0][0]).not.toHaveProperty('source');
  });

  test('rejects a conflicting same-instant concurrent value with a stable 409 code', async () => {
    const concurrent = new ExchangeRate({
      organizationId: 'org-1',
      baseCurrency: 'GBP',
      targetCurrency: 'USD',
      rate: 1.3,
      effectiveDate: new Date('2026-02-01T00:00:00.000Z'),
      source: 'api',
      isActive: true,
    });
    let exactReads = 0;
    jest.spyOn(ExchangeRate, 'findOne').mockImplementation((query) => {
      if (query.effectiveDate instanceof Date) {
        exactReads += 1;
        return Promise.resolve(exactReads === 1 ? null : concurrent);
      }
      return sortedQuery(null);
    });
    jest.spyOn(Payslip, 'exists').mockResolvedValue(null);
    jest.spyOn(ExchangeRate.prototype, 'save').mockRejectedValue(Object.assign(new Error('duplicate'), { code: 11000 }));

    await expect(currencyService.setRate('org-1', 'GBP', 'USD', 1.2, {
      effectiveDate: '2026-02-01T00:00:00.000Z',
    })).rejects.toMatchObject({
      code: 'EXCHANGE_RATE_IMMUTABLE',
      statusCode: 409,
    });
  });

  test('blocks a new backdated point that could restate approved or finalized reports', async () => {
    jest.spyOn(ExchangeRate, 'findOne').mockResolvedValue(null);
    jest.spyOn(Payslip, 'exists').mockResolvedValue({ _id: 'approved-payslip' });
    const saveSpy = jest.spyOn(ExchangeRate.prototype, 'save');

    await expect(currencyService.setRate('org-1', 'GBP', 'USD', 1.2, {
      effectiveDate: '2026-01-15T00:00:00.000Z',
    })).rejects.toMatchObject({
      code: 'EXCHANGE_RATE_HISTORY_LOCKED',
      statusCode: 409,
    });

    expect(Payslip.exists).toHaveBeenCalledWith({
      organizationId: 'org-1',
      status: { $in: ['approved', 'exported', 'paid'] },
      'payPeriod.paymentDate': { $gte: new Date('2026-01-15T00:00:00.000Z') },
    });
    expect(saveSpy).not.toHaveBeenCalled();
  });

  test('an exact same-value retry cannot change the immutable stored expiry', async () => {
    const existing = new ExchangeRate({
      organizationId: 'org-1',
      baseCurrency: 'GBP',
      targetCurrency: 'USD',
      rate: 1.2,
      effectiveDate: new Date('2026-02-01T00:00:00.000Z'),
      expiresAt: new Date('2026-02-28T23:59:59.999Z'),
      source: 'manual',
      isActive: true,
    });
    jest.spyOn(ExchangeRate, 'findOne').mockImplementation((query) => (
      query.effectiveDate instanceof Date ? Promise.resolve(existing) : sortedQuery(null)
    ));
    jest.spyOn(Payslip, 'exists');
    jest.spyOn(ExchangeRate, 'updateOne').mockResolvedValue({ acknowledged: true });
    jest.spyOn(ExchangeRate, 'updateMany').mockResolvedValue({ acknowledged: true });

    await currencyService.setRate('org-1', 'GBP', 'USD', 1.2, {
      effectiveDate: '2026-02-01T00:00:00.000Z',
      expiresAt: '2026-12-31T23:59:59.999Z',
    });

    expect(ExchangeRate.updateOne).toHaveBeenCalledWith(
      { _id: existing._id, isActive: true },
      { $set: { expiresAt: new Date('2026-02-28T23:59:59.999Z') } }
    );
    expect(Payslip.exists).not.toHaveBeenCalled();
  });
});
