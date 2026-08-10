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

async function consolidateExactInstantDuplicates(collection) {
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
  for (const group of groups) {
    const rows = await collection.find(
      { _id: { $in: group.rowIds } },
      {
        projection: {
          rate: 1,
          isActive: 1,
          expiresAt: 1,
          source: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      }
    ).toArray();

    const calculationVariants = new Set(rows.map(calculationFingerprint));
    if (calculationVariants.size !== 1) {
      throw conflictingDuplicateError(group);
    }

    const [canonical, ...redundant] = [...rows].sort(canonicalRowComparator);
    if (!canonical || redundant.length === 0) continue;

    const result = await collection.deleteMany({
      _id: { $in: redundant.map((row) => row._id) },
    });
    removedCount += result.deletedCount || 0;
  }

  return {
    duplicateGroups: groups.length,
    removedCount,
  };
}

module.exports = {
  consolidateExactInstantDuplicates,
  calculationFingerprint,
  canonicalRowComparator,
};
