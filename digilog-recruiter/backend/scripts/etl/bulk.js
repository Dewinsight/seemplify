// Generic bulk ETL runner for the lossless structural-copy pass.
// Consumes scripts/etl/generated.js: an array of
//   { prismaKey, collectionName, transform: (d) => ({...prismaData}) }
// (transform must NOT set id; the runner preserves the Mongo _id as the PK.)
//
//   node scripts/etl/bulk.js                 # copy + verify all
//   node scripts/etl/bulk.js --only=job,candidate
//   node scripts/etl/bulk.js --verify-only
const { prisma, getSource, closeSource, SOURCE_DB, oid, stripNul } = require('./lib');
const MODELS = require('./generated');

(async () => {
  const { db } = await getSource();
  console.log(`Bulk ETL source: Atlas db="${SOURCE_DB}"  (${MODELS.length} collections)\n`);

  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.split('=')[1].split(',') : null;
  const verifyOnly = process.argv.includes('--verify-only');
  const targets = MODELS.filter((m) => !only || only.includes(m.prismaKey));

  const report = [];
  for (const m of targets) {
    const coll = db.collection(m.collectionName);
    const mongoCount = await coll.countDocuments();
    const stats = { copied: 0, failed: 0, errors: [] };

    if (!verifyOnly && mongoCount > 0) {
      const docs = await coll.find({}).toArray();
      for (const d of docs) {
        const id = oid(d._id);
        let data;
        try {
          data = stripNul(m.transform(d));
        } catch (e) {
          stats.failed++;
          if (stats.errors.length < 3) stats.errors.push('transform: ' + e.message);
          continue;
        }
        try {
          await prisma[m.prismaKey].upsert({ where: { id }, create: { id, ...data }, update: data });
          stats.copied++;
        } catch (e) {
          stats.failed++;
          if (stats.errors.length < 3) stats.errors.push(`${id}: ${e.message.split('\n')[0]}`);
        }
      }
    }

    const pgCount = await prisma[m.prismaKey].count();
    report.push({ key: m.prismaKey, mongo: mongoCount, pg: pgCount, failed: stats.failed, errors: stats.errors });
  }

  console.log('================= BULK ETL REPORT =================');
  let allOk = true;
  for (const r of report) {
    const ok = r.pg === r.mongo && r.failed === 0;
    if (!ok) allOk = false;
    console.log(`  ${r.key.padEnd(24)} mongo=${String(r.mongo).padEnd(6)} pg=${String(r.pg).padEnd(6)} ${ok ? 'OK' : '*** CHECK ***'}${r.failed ? ` (failed ${r.failed})` : ''}`);
    for (const e of r.errors) console.log('       - ' + e);
  }
  console.log('==================================================');
  console.log(allOk ? '✅ ALL COLLECTIONS MATCH' : '⚠️  SOME COLLECTIONS NEED ATTENTION (see above)');

  await closeSource();
  await prisma.$disconnect();
  process.exit(allOk ? 0 : 1);
})().catch(async (e) => {
  console.error('❌ bulk ETL failed:', e);
  try { await closeSource(); await prisma.$disconnect(); } catch (_) {}
  process.exit(1);
});
