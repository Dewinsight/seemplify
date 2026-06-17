// Tests that a FRESH production deploy self-bootstraps with zero manual steps:
// creates a throwaway database, points the app at it, runs the real
// db/bootstrap (migrate deploy + seeders), verifies reference data exists, runs
// bootstrap AGAIN to prove idempotency, then drops the throwaway database.
//
//   node scripts/db/bootstrapTest.js
require('dotenv').config(); // load NYLAS_* etc. first; overrides below win
const { execSync } = require('child_process');

const TEST_DB = 'digilog_boot_test';
// Point the whole process at the throwaway DB BEFORE requiring the Prisma client.
process.env.DATABASE_URL = `postgresql://digilog:digilog_local@localhost:5544/${TEST_DB}?schema=public`;
// Force migrate deploy on (the local .env sets BOOTSTRAP_MIGRATE=false for dev).
process.env.BOOTSTRAP_MIGRATE = 'true';
process.env.SUPER_ADMIN_EMAIL = 'boot-test-admin@local.test';
process.env.SUPER_ADMIN_PASSWORD = 'BootTestPass123!';

function psql(sql) {
  // Run as the digilog superuser inside the container against the default db.
  execSync(`docker exec digilog-postgres psql -U digilog -d digilog -c "${sql}"`, { stdio: 'pipe' });
}

let pass = 0;
function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg);
  pass++;
  console.log('  ✓ ' + msg);
}

(async () => {
  let failed = false;
  let prisma;
  try {
    console.log(`[test] (re)creating throwaway db "${TEST_DB}"…`);
    psql(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    psql(`CREATE DATABASE ${TEST_DB}`);

    const { runBootstrap } = require('../../db/bootstrap');
    prisma = require('../../db/client');
    const { SYSTEM_CURRENCIES, DEFAULT_PLANS } = require('../../db/seed');
    const { RECOMMENDED_CREDIT_PACKS } = require('../../config/creditEconomics');

    console.log('\n[test] ===== first bootstrap (fresh deploy) =====');
    await runBootstrap();

    console.log('\n[test] verifying reference data…');
    const curr = await prisma.currency.count({ where: { isSystem: true } });
    const plans = await prisma.plan.count();
    const packs = await prisma.creditPack.count();
    const admin = await prisma.admin.findUnique({ where: { email: 'boot-test-admin@local.test' } });
    const history = await prisma.seedHistory.count();
    assert(curr === SYSTEM_CURRENCIES.length, `system currencies seeded (${curr}/${SYSTEM_CURRENCIES.length})`);
    assert(plans === DEFAULT_PLANS.length, `default plans seeded (${plans}/${DEFAULT_PLANS.length})`);
    assert(packs === RECOMMENDED_CREDIT_PACKS.length, `credit packs seeded (${packs}/${RECOMMENDED_CREDIT_PACKS.length})`);
    assert(!!admin && admin.role === 'super_admin', 'super-admin seeded from env with super_admin role');
    assert(admin.password && admin.password.startsWith('$2'), 'super-admin password is bcrypt-hashed');
    assert(history === 4, `all 4 seed steps recorded in SeedHistory (${history})`);
    const nylas = await prisma.nylasAccount.count();
    const nylasAcct = await prisma.nylasAccount.findFirst();
    assert(nylas === 1, `default Nylas account ensured from env (${nylas})`);
    assert(nylasAcct.isDefault && nylasAcct.active && nylasAcct.verified, 'Nylas account is default + active + verified');

    console.log('\n[test] ===== second bootstrap (idempotency) =====');
    await runBootstrap();
    const curr2 = await prisma.currency.count({ where: { isSystem: true } });
    const plans2 = await prisma.plan.count();
    const packs2 = await prisma.creditPack.count();
    const admins2 = await prisma.admin.count();
    const history2 = await prisma.seedHistory.count();
    assert(curr2 === curr, `currencies unchanged on re-run (${curr2})`);
    assert(plans2 === plans, `plans unchanged on re-run (${plans2})`);
    assert(packs2 === packs, `credit packs unchanged on re-run (${packs2})`);
    assert(admins2 === 1, `still exactly one admin on re-run (${admins2})`);
    assert(history2 === 4, `SeedHistory unchanged on re-run (${history2})`);
    const nylas2 = await prisma.nylasAccount.count();
    assert(nylas2 === 1, `Nylas account ensured, not duplicated on re-run (${nylas2})`);

    console.log(`\n✅ BOOTSTRAP TEST PASSED (${pass} assertions) — fresh deploy auto-migrates + seeds, idempotent`);
  } catch (e) {
    failed = true;
    console.error('\n❌ ' + e.message);
  } finally {
    if (prisma) { try { await prisma.$disconnect(); } catch (_) {} }
    try {
      console.log(`[test] dropping throwaway db "${TEST_DB}"…`);
      psql(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    } catch (_) {}
    process.exit(failed ? 1 : 0);
  }
})();
