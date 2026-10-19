// Read-only by default; use --apply after reviewing the preview. The old unique
// constraint remains until replacement verification; no writer pause or evidence
// edits are needed. A failed index build leaves existing constraints intact.
require('dotenv').config();
const mongoose = require('mongoose');
const { migrateGoalCheckInIdempotencyIndex } = require('../services/goalCheckInIdempotencyIndex');

async function main() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false });
  const report = await migrateGoalCheckInIdempotencyIndex(mongoose.connection.db.collection('goalcheckins'), {
    apply: process.argv.includes('--apply')
  });
  console.log(JSON.stringify(report));
}

if (require.main === module) main().catch(() => {
  // Driver errors can contain connection strings. Do not expose them in logs.
  console.error('Check-in index migration failed; evidence and unrelated indexes were not changed. Review the indexes before retrying.');
  process.exitCode = 1;
}).finally(() => mongoose.disconnect());
