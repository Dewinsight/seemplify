require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('node:fs');
const { seedAllOrganizations } = require('../services/quarterlyAppraisalService');
const AppraisalCycle = require('../models/AppraisalCycle');
const { BSON } = require('mongodb');

async function migrateQuarterlyReviews(db, { apply = false, backupPath } = {}) {
  const migrationId = 'quarterly-colleague-reviews-v1';
  if (await db.collection('performancemigrations').findOne({ _id: migrationId })) return { apply, alreadyApplied: true, recordsDeleted: 0 };
  const collection = db.collection('appraisals');
  const oldCycles = await db.collection('appraisalcycles').find({
    defaultQuarterKey: { $exists: false }, retiredAt: null
  }).toArray();
  const report = { apply, cyclesToRetire: oldCycles.length, recordsDeleted: 0 };
  if (!apply) return report;
  if (!backupPath) throw new Error('A backup path is required');
  // Exclusive creation prevents silently overwriting the rollback inventory.
  fs.writeFileSync(backupPath, BSON.EJSON.stringify({ savedAt: new Date(), cycles: oldCycles }, { relaxed: false }), { flag: 'wx', mode: 0o600 });
  await collection.createIndex({ cycleId: 1, 'employee.userId': 1, 'manager.userId': 1 }, { unique: true });
  const indexes = await collection.indexes();
  const legacy = indexes.find((index) => index.unique && Object.keys(index.key).length === 2 && index.key.cycleId === 1 && index.key['employee.userId'] === 1);
  if (legacy) await collection.dropIndex(legacy.name);
  await AppraisalCycle.createIndexes();
  await seedAllOrganizations();
  if (oldCycles.length) await db.collection('appraisalcycles').updateMany({ _id: { $in: oldCycles.map((cycle) => cycle._id) } }, { $set: { retiredAt: new Date() } });
  await db.collection('performancemigrations').updateOne({ _id: migrationId }, { $setOnInsert: { completedAt: new Date(), cyclesRetired: oldCycles.length, backupPath } }, { upsert: true });
  return { ...report, retired: oldCycles.length };
}

if (require.main === module) {
  const apply = process.argv.includes('--apply');
  const backupArg = process.argv.find((arg) => arg.startsWith('--backup='));
  (async () => {
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
    await mongoose.connect(process.env.MONGO_URI, { autoIndex: false });
    console.log(JSON.stringify(await migrateQuarterlyReviews(mongoose.connection.db, { apply, backupPath: backupArg?.slice(9) })));
  })().catch(() => {
    console.error('Quarterly review migration failed. Check the protected backup and database before retrying.');
    process.exitCode = 1;
  }).finally(() => mongoose.disconnect());
}
module.exports = { migrateQuarterlyReviews };
