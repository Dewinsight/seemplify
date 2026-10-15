// Run with writers paused. Dry-run by default; builds replacement before dropping the legacy constraint.
const mongoose = require('mongoose');
const definitions = [
  { collection: 'okrs', field: 'assignment.idempotencyKey', key: { organizationId: 1, 'assignment.idempotencyKey': 1 }, name: 'goal_assignment_key_unique' },
  { collection: 'goalcheckins', field: 'idempotencyKey', key: { organizationId: 1, goalId: 1, idempotencyKey: 1 }, name: 'goal_checkin_key_unique' }
];
async function migrateGoalIdempotencyIndexes(db, { apply = false } = {}) {
  const report = [];
  for (const definition of definitions) {
    const collection = db.collection(definition.collection);
    const filter = { [definition.field]: { $type: 'string', $gt: '' } };
    let indexes;
    try { indexes = await collection.indexes(); } catch (error) {
      if (error.code !== 26) throw error;
      if (!apply) { report.push({ collection: definition.collection, action: 'create-on-first-use' }); continue; }
      await db.createCollection(definition.collection); indexes = await collection.indexes();
    }
    const duplicate = await collection.aggregate([
      { $match: filter },
      { $group: { _id: Object.fromEntries(Object.keys(definition.key).map((field) => [field.replaceAll('.', '_'), `$${field}`])), count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } }, { $limit: 1 }
    ]).hasNext();
    if (duplicate) throw new Error(`Resolve populated idempotency-key duplicates in ${definition.collection} before migrating`);
    const legacy = indexes.filter(index => JSON.stringify(index.key) === JSON.stringify(definition.key) && index.sparse === true && index.unique === true);
    if (apply) {
      await collection.createIndex(definition.key, { name: definition.name, unique: true, partialFilterExpression: filter });
      for (const index of legacy) await collection.dropIndex(index.name);
    }
    report.push({ collection: definition.collection, applied: apply, replacement: definition.name, legacyIndexes: legacy.map(index => index.name) });
  }
  return report;
}
if (require.main === module) {
  require('dotenv').config();
  (async () => {
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
    await mongoose.connect(process.env.MONGO_URI, { autoIndex: false });
    console.log(JSON.stringify(await migrateGoalIdempotencyIndexes(mongoose.connection.db, { apply: process.argv.includes('--apply') }), null, 2));
  })().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
}
module.exports = { migrateGoalIdempotencyIndexes };
