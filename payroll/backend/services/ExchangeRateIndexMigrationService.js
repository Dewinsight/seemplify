const SOURCE_PRIORITY = Object.freeze({
  manual: 0,
  import: 1,
  api: 2,
});

function dateKey(value) {
  if (!value) return null;
  return new Date(value).toISOString();
}

function calculationFingerprint(row) {
  return JSON.stringify({
    rate: Number(row.rate),
    isActive: row.isActive !== false,
    expiresAt: dateKey(row.expiresAt),
  });
}

function canonicalRowComparator(left, right) {
  const leftActive = left.isActive !== false ? 1 : 0;
  const rightActive = right.isActive !== false ? 1 : 0;
  if (leftActive !== rightActive) return rightActive - leftActive;

  const leftPriority = SOURCE_PRIORITY[left.source] ?? Number.MAX_SAFE_INTEGER;
  const rightPriority = SOURCE_PRIORITY[right.source] ?? Number.MAX_SAFE_INTEGER;
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;

  const updatedDifference = new Date(right.updatedAt || right.createdAt || 0).getTime()
    - new Date(left.updatedAt || left.createdAt || 0).getTime();
  if (updatedDifference !== 0) return updatedDifference;

  return String(right._id).localeCompare(String(left._id));
}

function conflictingDuplicateError(group) {
  const error = new Error(
    'Conflicting exchange rates exist for the same currency pair and effective instant; '
      + 'currency history must be reviewed before payroll can start.'
  );
  error.code = 'EXCHANGE_RATE_DUPLICATE_CONFLICT';
  error.details = {
    baseCurrency: group._id.baseCurrency,
    targetCurrency: group._id.targetCurrency,
    effectiveDate: dateKey(group._id.effectiveDate),
    duplicateCount: group.count,
  };
  return error;
}

function conflictResolutionKey(group) {
  return [
    String(group._id.organizationId),
    group._id.baseCurrency,
    group._id.targetCurrency,
    dateKey(group._id.effectiveDate),
  ].join(':');
}

async function archiveConflictingRows(archiveCollection, group, rows, canonical) {
  if (!archiveCollection?.bulkWrite) throw conflictingDuplicateError(group);

  const archivedAt = new Date();
  const resolutionKey = conflictResolutionKey(group);
  await archiveCollection.bulkWrite(rows.map((row) => ({
    updateOne: {
      filter: {
        resolutionKey,
        originalExchangeRateId: row._id,
      },
      update: {
        $setOnInsert: {
          resolutionKey,
          originalExchangeRateId: row._id,
          organizationId: group._id.organizationId,
          baseCurrency: group._id.baseCurrency,
          targetCurrency: group._id.targetCurrency,
          effectiveDate: group._id.effectiveDate,
          original: row,
          resolution: {
            canonicalExchangeRateId: canonical._id,
            canonicalSource: canonical.source,
            reason: 'same_instant_conflict',
            strategy: 'manual_then_import_then_api_then_latest',
          },
          archivedAt,
        },
      },
      upsert: true,
    },
  })), { ordered: true });
}

async function consolidateExactInstantDuplicates(collection, options = {}) {
  const groups = await collection.aggregate([
    {
      $group: {
        _id: {
          organizationId: '$organizationId',
          baseCurrency: '$baseCurrency',
          targetCurrency: '$targetCurrency',
          effectiveDate: '$effectiveDate',
        },
        rowIds: { $push: '$_id' },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]).toArray();

  let removedCount = 0;
  let resolvedConflictGroups = 0;
  let archivedConflictRows = 0;
  for (const group of groups) {
    const rows = await collection.find({ _id: { $in: group.rowIds } }).toArray();

    const calculationVariants = new Set(rows.map(calculationFingerprint));
    const [canonical, ...redundant] = [...rows].sort(canonicalRowComparator);
    if (!canonical || redundant.length === 0) continue;

    if (calculationVariants.size !== 1) {
      await archiveConflictingRows(options.conflictArchiveCollection, group, rows, canonical);
      resolvedConflictGroups += 1;
      archivedConflictRows += rows.length;
    }

    const result = await collection.deleteMany({
      _id: { $in: redundant.map((row) => row._id) },
    });
    removedCount += result.deletedCount || 0;
  }

  return {
    duplicateGroups: groups.length,
    removedCount,
    resolvedConflictGroups,
    archivedConflictRows,
  };
}

module.exports = {
  consolidateExactInstantDuplicates,
  calculationFingerprint,
  canonicalRowComparator,
  conflictResolutionKey,
};
