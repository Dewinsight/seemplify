'use strict';
// Dry-run by default. Build the replacement unique index before removing the
// old constraint. Never delete or rewrite a frozen assessment definition.
require('dotenv').config();
const mongoose = require('mongoose');
async function migrate(db, apply = false) {
  const collection = db.collection('competencyassessments');
  const indexes = await collection.indexes();
  const oldKeys = { organizationId: 1, cycleId: 1, cycleVersion: 1, 'participant.userId': 1 };
  const old = indexes.find(index => index.unique && JSON.stringify(index.key) === JSON.stringify(oldKeys));
  const missing = await collection.countDocuments({ occurrenceKey: { $exists: false } });
  if (!apply) return { dryRun: true, legacyBackfill: missing, oldIndex: old?.name || null, replacement: 'competency_occurrence_participant' };
  // Backfill is safe under the old uniqueness guarantee. Existing new runs
  // already carry an occurrence key and are never changed.
  const backfill = await collection.updateMany({ occurrenceKey: { $exists: false } }, { $set: { occurrenceKey: 'legacy' } });
  await collection.createIndex({ organizationId: 1, cycleId: 1, cycleVersion: 1, occurrenceKey: 1, 'participant.userId': 1 }, { unique: true, name: 'competency_occurrence_participant' });
  const replacement = (await collection.indexes()).find(index => index.name === 'competency_occurrence_participant');
  if (!replacement?.unique) throw new Error('Replacement uniqueness was not verified. Old index retained.');
  if (old) await collection.dropIndex(old.name);
  return { dryRun: false, backfilled: backfill.modifiedCount, removedIndex: old?.name || null, replacement: replacement.name };
}
if (require.main === module) (async () => {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  try { console.log(JSON.stringify(await migrate(mongoose.connection.db, process.argv.includes('--apply')))); }
  finally { await mongoose.disconnect(); }
})().catch(error => { console.error(error.code || error.name); process.exitCode = 1; });
module.exports = { migrate };
