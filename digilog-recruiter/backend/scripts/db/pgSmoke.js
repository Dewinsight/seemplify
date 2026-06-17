// Slice 1 end-to-end smoke test for the Postgres/Prisma foundation.
//
// Proves: connectivity, ObjectId-format id auto-generation (query extension),
// the computed `_id = id` field (result extension), and basic CRUD — without
// touching the live (still Mongoose-based) server boot.
//
//   node scripts/db/pgSmoke.js
require('dotenv').config();
const prisma = require('../../db/client');
const { isObjectIdLike } = require('../../db/objectId');

(async () => {
  const email = `pg-smoke-${Date.now()}@local.test`;
  let createdId = null;
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('✅ Connected to PostgreSQL');

    const created = await prisma.admin.create({
      data: { email, name: 'PG Smoke', role: 'support' },
    });
    createdId = created.id;
    console.log(`   created admin  id=${created.id}  _id=${created._id}`);
    if (!isObjectIdLike(created.id)) throw new Error('generated id is not ObjectId-format');
    if (created._id !== created.id) throw new Error('computed _id missing / mismatched');

    const found = await prisma.admin.findUnique({ where: { id: created.id } });
    if (!found) throw new Error('read-back failed');
    console.log(`   read back      email=${found.email}  _id=${found._id}`);

    await prisma.admin.delete({ where: { id: created.id } });
    createdId = null;
    console.log('🧹 cleaned up smoke row');

    console.log('✅ Slice 1 verified: id generated, _id mirrored, create/read/delete OK');
  } catch (err) {
    console.error('❌ Smoke test failed:', err.message);
    process.exitCode = 1;
    if (createdId) {
      try { await prisma.admin.delete({ where: { id: createdId } }); } catch (_) {}
    }
  } finally {
    await prisma.$disconnect();
  }
})();
