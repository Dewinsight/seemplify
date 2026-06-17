// One-off Atlas connectivity + baseline collection-count probe for the ETL.
//   node scripts/etl/probe.js
require('dotenv').config();
const { MongoClient } = require('mongodb');

(async () => {
  const client = new MongoClient(process.env.MONGO_URI);
  await client.connect();
  const db = client.db();
  console.log(`✅ Connected to Atlas db="${db.databaseName}"`);

  const cols = (await db.listCollections().toArray()).map((c) => c.name).sort();
  console.log(`\ncollections (${cols.length}):`, cols.join(', '));

  const want = [
    'users', 'admins', 'organizations', 'departments',
    'sessions', 'usersessions', 'feedbackotps',
    'candidates', 'jobs', 'interviews',
  ];
  console.log('\nbaseline counts:');
  for (const n of want) {
    try {
      const count = await db.collection(n).countDocuments();
      console.log(`  ${n.padEnd(16)} ${count}`);
    } catch (e) {
      console.log(`  ${n.padEnd(16)} (missing)`);
    }
  }
  await client.close();
})().catch((e) => {
  console.error('❌ probe failed:', e.message);
  process.exit(1);
});
