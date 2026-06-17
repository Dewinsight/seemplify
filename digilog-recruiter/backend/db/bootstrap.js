// Automatic, idempotent startup bootstrap so a fresh deployment "just works"
// with NO manual migration or seed steps:
//   1. Apply pending Prisma migrations (`prisma migrate deploy`).
//   2. Run idempotent reference-data seeders, each tracked in SeedHistory so it
//      runs at most once (and the seeders themselves are create-if-missing).
//
// Safe to call on every server start. Controlled by env:
//   DATABASE_URL        — if unset, the whole bootstrap is skipped.
//   BOOTSTRAP_MIGRATE   — 'false' to skip migrate deploy (e.g. local dev with
//                         nodemon, where you run `prisma migrate dev` by hand).
//   BOOTSTRAP_SEED      — 'false' to skip seeding.
//   VERCEL              — serverless: migrate deploy is skipped (read-only fs).
const path = require('path');
const { execSync } = require('child_process');
const prisma = require('./client');
const seeders = require('./seed');

// One-time, tracked seeds (run once via SeedHistory, also guarded to skip a
// non-empty table).
const SEED_STEPS = [
  { name: 'system-currencies@v1', run: seeders.seedCurrencies },
  { name: 'default-plans@v1', run: seeders.seedPlans },
  { name: 'credit-packs@v1', run: seeders.seedCreditPacks },
  { name: 'super-admin@v1', run: seeders.seedSuperAdmin },
];

// Idempotent ENSURES that run on EVERY boot (not tracked) — mirror the existing
// startup bootstraps that must re-assert state each start.
const ENSURE_STEPS = [
  { name: 'nylas-default-account', run: seeders.ensureDefaultNylasAccount },
];

function runMigrations() {
  if (process.env.VERCEL) { console.log('[bootstrap] serverless (VERCEL) — skipping migrate deploy'); return; }
  if (process.env.BOOTSTRAP_MIGRATE === 'false') { console.log('[bootstrap] BOOTSTRAP_MIGRATE=false — skipping migrate deploy'); return; }
  console.log('[bootstrap] applying Prisma migrations (migrate deploy)…');
  execSync('npx prisma migrate deploy', { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
  console.log('[bootstrap] ✅ migrations up to date');
}

async function runSeeders() {
  if (process.env.BOOTSTRAP_SEED === 'false') { console.log('[bootstrap] BOOTSTRAP_SEED=false — skipping seeders'); return; }
  for (const step of SEED_STEPS) {
    try {
      const already = await prisma.seedHistory.findUnique({ where: { name: step.name } });
      if (already) { console.log(`[bootstrap] seed ${step.name}: already applied — skip`); continue; }
      const result = await step.run();
      await prisma.seedHistory.create({ data: { name: step.name } });
      console.log(`[bootstrap] seed ${step.name}: ${JSON.stringify(result)}`);
    } catch (e) {
      // Non-fatal: a seed failure shouldn't take down the server. It will be
      // retried on the next start (no SeedHistory row was written).
      console.error(`[bootstrap] seed ${step.name} FAILED (non-fatal): ${e.message}`);
    }
  }
}

async function runEnsures() {
  if (process.env.BOOTSTRAP_SEED === 'false') return;
  for (const step of ENSURE_STEPS) {
    try {
      const result = await step.run();
      console.log(`[bootstrap] ensure ${step.name}: ${JSON.stringify(result)}`);
    } catch (e) {
      console.error(`[bootstrap] ensure ${step.name} FAILED (non-fatal): ${e.message}`);
    }
  }
}

async function runBootstrap() {
  if (!process.env.DATABASE_URL) {
    console.log('[bootstrap] no DATABASE_URL — skipping Postgres bootstrap');
    return;
  }
  try {
    runMigrations();
  } catch (e) {
    console.error('[bootstrap] ❌ migrate deploy FAILED (non-fatal):', e.message);
  }
  await runSeeders();
  await runEnsures();
  console.log('[bootstrap] ✅ complete');
}

module.exports = { runBootstrap, runMigrations, runSeeders, runEnsures, SEED_STEPS, ENSURE_STEPS };
