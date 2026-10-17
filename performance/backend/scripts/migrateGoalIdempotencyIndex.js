require('dotenv').config();
const mongoose = require('mongoose');
const { migrateGoalIdempotencyIndex } = require('../services/goalIdempotencyIndex');

async function main() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false });
  const report = await migrateGoalIdempotencyIndex(mongoose.connection.db.collection('okrs'), { apply: process.argv.includes('--apply') });
  console.log(JSON.stringify(report));
}

main().catch(() => {
  // Database connection errors may contain connection strings; keep them out
  // of operational output. The migration deliberately fails closed.
  console.error('Goal index migration failed; no unrelated indexes or goal records were changed.');
  process.exitCode = 1;
}).finally(() => mongoose.disconnect());
