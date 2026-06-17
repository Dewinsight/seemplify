// Slice 2 ETL: copy `usersessions` (JWT access/refresh sessions) Atlas -> Postgres.
// Preserves accessTokenId/refreshTokenHash so already-issued tokens keep validating.
// Requires users to be copied first (FK). Idempotent (upsert on preserved _id).
//
//   node scripts/etl/sessions.js
const { prisma, getSource, closeSource, SOURCE_DB, oid, asDate, safe } = require('./lib');

async function copyUserSessions(db, stats, userIds) {
  const docs = await db.collection('usersessions').find({}).toArray();
  stats.total = docs.length;
  for (const d of docs) {
    const id = oid(d._id);
    const userId = oid(d.user);
    if (!userIds.has(userId)) { stats.skippedOrphanUser = (stats.skippedOrphanUser || 0) + 1; continue; }
    const data = {
      userId,
      fingerprint: d.fingerprint ?? 'unknown',
      userAgent: d.userAgent ?? null,
      ip: d.ip ?? null,
      refreshTokenHash: d.refreshTokenHash ?? '',
      accessTokenId: d.accessTokenId ?? id,
      expiresAt: asDate(d.expiresAt) ?? new Date(),
      revoked: d.revoked ?? false,
      revokedAt: asDate(d.revokedAt),
      reason: d.reason ?? null,
      riskSignals: Array.isArray(d.riskSignals) ? d.riskSignals : [],
      createdAt: asDate(d.createdAt) ?? new Date(),
      lastActivityAt: asDate(d.lastActivityAt),
    };
    await safe(stats, 'copied', () =>
      prisma.userSession.upsert({ where: { id }, create: { id, ...data }, update: data }));
  }
}

(async () => {
  const { db } = await getSource();
  console.log(`ETL source: Atlas db="${SOURCE_DB}"  (usersessions)`);
  const userIds = new Set((await prisma.user.findMany({ select: { id: true } })).map((u) => u.id));
  const stats = {};
  await copyUserSessions(db, stats, userIds);

  const pg = await prisma.userSession.count();
  const expected = (stats.total || 0) - (stats.skippedOrphanUser || 0);
  console.log(`\n  usersessions   mongo=${stats.total}  copied=${stats.copied || 0}  pg=${pg}  (skipped ${stats.skippedOrphanUser || 0} orphan-user)`);
  if (stats.failed) { console.log(`  ⚠️ ${stats.failed} failed:`); for (const e of stats.errors) console.log('   - ' + e); }

  // FK integrity
  const broken = (await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM "UserSession" s LEFT JOIN "User" u ON s."userId"=u.id WHERE u.id IS NULL`))[0].n;
  const ok = pg === expected && broken === 0 && !stats.failed;
  console.log(`  FK broken (must be 0): ${broken}`);
  console.log(ok ? '✅ usersessions ETL OK' : '❌ usersessions ETL issues');

  await closeSource();
  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
})().catch(async (e) => {
  console.error('❌ failed:', e);
  try { await closeSource(); await prisma.$disconnect(); } catch (_) {}
  process.exit(1);
});
