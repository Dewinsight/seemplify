const INDEX_KEY = { organizationId: 1, goalId: 1, idempotencyKey: 1 };
const INDEX_NAME = 'goal_checkin_idempotency_v2';
const INDEX_OPTIONS = {
  name: INDEX_NAME,
  unique: true,
  partialFilterExpression: { idempotencyKey: { $type: 'string', $gt: '' } }
};
const LEGACY_NAME = 'organizationId_1_goalId_1_idempotencyKey_1';

function sameKey(index) {
  return JSON.stringify(index.key) === JSON.stringify(INDEX_KEY);
}

function simpleCollation(index) {
  return !index.collation || index.collation.locale === 'simple';
}

function validReplacement(index) {
  return index && sameKey(index) && index.unique === true && !index.sparse && simpleCollation(index)
    && JSON.stringify(index.partialFilterExpression) === JSON.stringify(INDEX_OPTIONS.partialFilterExpression);
}

// Build and verify the replacement before removing the known legacy constraint;
// both enforce populated-key uniqueness while writers continue. A duplicate that
// races an unindexed install fails the build, never removes evidence records.
// After new unkeyed writes, restoring the old constraint may be impossible, so
// failures retain existing indexes rather than attempting destructive rollback.
async function migrateGoalCheckInIdempotencyIndex(collection, { apply = false } = {}) {
  let indexes;
  try { indexes = await collection.indexes(); }
  catch (error) { if (error.code === 26) indexes = []; else throw error; }
  const legacy = indexes.find(index => index.name === LEGACY_NAME);
  const replacement = indexes.find(index => index.name === INDEX_NAME);
  if (legacy && (!sameKey(legacy) || legacy.unique !== true || legacy.sparse !== true || legacy.partialFilterExpression || !simpleCollation(legacy))) {
    throw new Error('Legacy check-in index has unexpected options; refusing to remove it');
  }
  if (replacement && !validReplacement(replacement)) {
    throw new Error('Replacement check-in index has unexpected options; refusing to continue');
  }
  const duplicates = await collection.aggregate([
    { $match: INDEX_OPTIONS.partialFilterExpression },
    { $group: { _id: { organizationId: '$organizationId', goalId: '$goalId', idempotencyKey: '$idempotencyKey' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 1 }
  ], { maxTimeMS: 30000 }).hasNext();
  if (duplicates) throw new Error('Duplicate populated check-in retry keys must be resolved before migration');
  const report = {
    mode: apply ? 'apply' : 'dry-run', replacementExists: Boolean(replacement),
    legacyExists: Boolean(legacy), created: false, retired: false
  };
  if (!apply) return report;
  if (!replacement) {
    await collection.createIndex(INDEX_KEY, INDEX_OPTIONS);
    report.created = true;
  }
  indexes = await collection.indexes();
  if (!validReplacement(indexes.find(index => index.name === INDEX_NAME))) {
    throw new Error('Replacement check-in index verification failed; legacy index retained');
  }
  if (legacy) {
    await collection.dropIndex(LEGACY_NAME);
    report.retired = true;
  }
  return report;
}

module.exports = { INDEX_KEY, INDEX_NAME, INDEX_OPTIONS, LEGACY_NAME, migrateGoalCheckInIdempotencyIndex };
