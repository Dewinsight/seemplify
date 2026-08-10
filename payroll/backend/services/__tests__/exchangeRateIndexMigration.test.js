const { consolidateExactInstantDuplicates } = require('../ExchangeRateIndexMigrationService');

function fakeCollection(groups, rows) {
  return {
    aggregate: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue(groups) })),
    find: jest.fn((filter) => ({
      toArray: jest.fn().mockResolvedValue(
        rows.filter((row) => filter._id.$in.includes(row._id))
      ),
    })),
    deleteMany: jest.fn(async (filter) => ({
      acknowledged: true,
      deletedCount: filter._id.$in.length,
    })),
  };
}

const duplicateKey = {
  organizationId: 'org-1',
  baseCurrency: 'USD',
  targetCurrency: 'AED',
  effectiveDate: new Date('2026-04-03T06:47:31.000Z'),
};

describe('ExchangeRate exact-instant index migration', () => {
  test('keeps one deterministic provenance row when duplicate calculations are identical', async () => {
    const groups = [{ _id: duplicateKey, rowIds: ['api-row', 'manual-row'], count: 2 }];
    const collection = fakeCollection(groups, [
      {
        _id: 'api-row',
        rate: 3.6725,
        source: 'api',
        isActive: true,
        expiresAt: null,
        updatedAt: new Date('2026-04-04T00:00:00.000Z'),
      },
      {
        _id: 'manual-row',
        rate: 3.6725,
        source: 'manual',
        isActive: true,
        expiresAt: null,
        updatedAt: new Date('2026-04-03T00:00:00.000Z'),
      },
    ]);

    await expect(consolidateExactInstantDuplicates(collection)).resolves.toEqual({
      duplicateGroups: 1,
      removedCount: 1,
    });
    expect(collection.deleteMany).toHaveBeenCalledWith({
      _id: { $in: ['api-row'] },
    });
  });

  test('fails closed and preserves every row when same-instant calculations conflict', async () => {
    const groups = [{ _id: duplicateKey, rowIds: ['rate-a', 'rate-b'], count: 2 }];
    const collection = fakeCollection(groups, [
      { _id: 'rate-a', rate: 3.6725, source: 'api', isActive: true, expiresAt: null },
      { _id: 'rate-b', rate: 3.68, source: 'manual', isActive: true, expiresAt: null },
    ]);

    await expect(consolidateExactInstantDuplicates(collection)).rejects.toMatchObject({
      code: 'EXCHANGE_RATE_DUPLICATE_CONFLICT',
      details: {
        baseCurrency: 'USD',
        targetCurrency: 'AED',
        duplicateCount: 2,
      },
    });
    expect(collection.deleteMany).not.toHaveBeenCalled();
  });

  test('does nothing when the collection has no duplicate exact instants', async () => {
    const collection = fakeCollection([], []);

    await expect(consolidateExactInstantDuplicates(collection)).resolves.toEqual({
      duplicateGroups: 0,
      removedCount: 0,
    });
    expect(collection.find).not.toHaveBeenCalled();
    expect(collection.deleteMany).not.toHaveBeenCalled();
  });
});
