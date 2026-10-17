const INDEX_KEY = { organizationId: 1, 'assignment.idempotencyKey': 1 };
const INDEX_NAME = 'okr_assignment_idempotency_v2';
const INDEX_OPTIONS = {
  name: INDEX_NAME,
  unique: true,
  partialFilterExpression: { 'assignment.idempotencyKey': { $type: 'string' } }
};
const LEGACY_NAME = 'organizationId_1_assignment.idempotencyKey_1';

function sameKey(index) {
  return JSON.stringify(index.key) === JSON.stringify(INDEX_KEY);
}

function validReplacement(index) {
  return index && sameKey(index) && index.unique === true && !index.sparse
    && JSON.stringify(index.partialFilterExpression) === JSON.stringify(INDEX_OPTIONS.partialFilterExpression);
}

// Build and verify the replacement before retiring the old constraint. Never
// sync/drop unrelated indexes or rewrite goal documents during this repair.
async function migrateGoalIdempotencyIndex(collection, { apply = false } = {}) {
  let indexes;
  try { indexes = await collection.indexes(); }
  catch (error) { if (error.code === 26) indexes = []; else throw error; }
  const legacy = indexes.find((index) => index.name === LEGACY_NAME);
  const replacement = indexes.find((index) => index.name === INDEX_NAME);
  if (legacy && (!sameKey(legacy) || legacy.unique !== true || legacy.sparse !== true || legacy.partialFilterExpression)) {
    throw new Error('Legacy goal index has unexpected options; refusing to remove it');
  }
  if (replacement && !validReplacement(replacement)) {
    throw new Error('Replacement goal index has unexpected options; refusing to continue');
  }
  const report = { mode: apply ? 'apply' : 'dry-run', replacementExists: Boolean(replacement), legacyExists: Boolean(legacy), created: false, retired: false };
  if (!apply) return report;
  if (!replacement) {
    await collection.createIndex(INDEX_KEY, INDEX_OPTIONS);
    report.created = true;
  }
  indexes = await collection.indexes();
  if (!validReplacement(indexes.find((index) => index.name === INDEX_NAME))) throw new Error('Replacement goal index verification failed');
  if (legacy) {
    await collection.dropIndex(LEGACY_NAME);
    report.retired = true;
  }
  return report;
}

module.exports = { INDEX_KEY, INDEX_NAME, INDEX_OPTIONS, migrateGoalIdempotencyIndex };
