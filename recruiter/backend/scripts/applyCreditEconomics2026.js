/**
 * Apply RECOMMENDED_* from config/creditEconomics.js to MongoDB.
 *
 * Usage:
 *   node scripts/applyCreditEconomics2026.js --dry-run
 *   node scripts/applyCreditEconomics2026.js --apply
 *   node scripts/applyCreditEconomics2026.js --apply --replace-packs
 *
 * --apply updates:
 *   - Plan: creditCosts, credits.totalCredits, price (for known plan codes + legacy aliases)
 *   - CreditPack: by default, updates rows whose `code` matches RECOMMENDED_CREDIT_PACKS
 *
 * --replace-packs (requires --apply):
 *   - Deletes ALL credit packs and inserts RECOMMENDED_CREDIT_PACKS from config
 *   - Use this when the DB still has old junk packs (e.g. "Jumbo", "MEGA") that never matched codes
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Plan = require('../models/Plan');
const CreditPack = require('../models/CreditPack');
const {
  RECOMMENDED_CREDIT_COSTS,
  RECOMMENDED_MONTHLY_CREDITS_BY_PLAN_CODE,
  RECOMMENDED_PLAN_LIST_PRICES_USD,
  RECOMMENDED_CREDIT_PACKS,
  LEGACY_PLAN_CODE_ECONOMICS_MAP,
} = require('../config/creditEconomics');

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) {
  console.error('Set MONGODB_URI or MONGO_URI');
  process.exit(1);
}

const dryRun = !process.argv.includes('--apply');
const replacePacks = process.argv.includes('--replace-packs');

function buildCreditsPayload(plan, totalCredits) {
  return {
    totalCredits,
    creditCosts: { ...RECOMMENDED_CREDIT_COSTS },
    rolloverEnabled: plan.credits?.rolloverEnabled ?? false,
    rolloverPercentage: plan.credits?.rolloverPercentage ?? 0,
  };
}

async function syncPlanByCode(code, label = code) {
  const plan = await Plan.findOne({ code });
  if (!plan) {
    console.log(`[plan] skip missing code=${code} (${label})`);
    return;
  }
  const monthly = RECOMMENDED_MONTHLY_CREDITS_BY_PLAN_CODE[code];
  const listPrice = RECOMMENDED_PLAN_LIST_PRICES_USD[code];
  if (monthly == null || listPrice == null) {
    console.log(`[plan] skip no economics for code=${code}`);
    return;
  }
  const nextCredits = buildCreditsPayload(plan, monthly);
  console.log(
    `[plan] ${label}: price $${plan.price} -> $${listPrice}, monthlyCredits ${plan.credits?.totalCredits} -> ${monthly}, aiMatching ${plan.credits?.creditCosts?.aiMatching} -> ${RECOMMENDED_CREDIT_COSTS.aiMatching}`
  );
  if (!dryRun) {
    plan.price = listPrice;
    plan.credits = nextCredits;
    await plan.save();
  }
}

async function syncCanonicalPlans() {
  const codes = Object.keys(RECOMMENDED_MONTHLY_CREDITS_BY_PLAN_CODE);
  for (const code of codes) {
    await syncPlanByCode(code);
  }
}

async function syncLegacyAliasPlans() {
  const entries = Object.entries(LEGACY_PLAN_CODE_ECONOMICS_MAP || {});
  for (const [legacyCode, canonical] of entries) {
    const plan = await Plan.findOne({ code: legacyCode });
    if (!plan) continue;
    const monthly = RECOMMENDED_MONTHLY_CREDITS_BY_PLAN_CODE[canonical];
    const listPrice = RECOMMENDED_PLAN_LIST_PRICES_USD[canonical];
    if (monthly == null || listPrice == null) continue;

    const nextCredits = buildCreditsPayload(plan, monthly);
    console.log(
      `[plan] LEGACY ${legacyCode} -> economics of "${canonical}": price $${plan.price} -> $${listPrice}, monthlyCredits ${plan.credits?.totalCredits} -> ${monthly}`
    );
    if (!dryRun) {
      plan.price = listPrice;
      plan.credits = nextCredits;
      await plan.save();
    }
  }
}

async function syncPacksByCode() {
  for (const rec of RECOMMENDED_CREDIT_PACKS) {
    const pack = await CreditPack.findOne({ code: rec.code });
    if (!pack) {
      console.log(`[pack] missing ${rec.code} — run with --apply --replace-packs to insert catalog`);
      continue;
    }
    console.log(
      `[pack] ${rec.code}: credits ${pack.credits}+${pack.bonusCredits || 0} @$${pack.price} -> ${rec.credits}+${rec.bonusCredits} @$${rec.price}`
    );
    if (!dryRun) {
      pack.credits = rec.credits;
      pack.bonusCredits = rec.bonusCredits || 0;
      pack.price = rec.price;
      pack.currency = rec.currency || 'USD';
      pack.description = rec.description || '';
      pack.features = rec.features;
      pack.name = rec.name;
      pack.displayOrder = rec.displayOrder;
      pack.isPopular = rec.isPopular;
      await pack.save();
    }
  }
}

async function replaceAllPacksFromConfig() {
  if (dryRun) {
    console.log('[pack] DRY RUN: would delete ALL credit packs and insert', RECOMMENDED_CREDIT_PACKS.length, 'from config');
    return;
  }
  const deleted = await CreditPack.deleteMany({});
  console.log(`[pack] removed ${deleted.deletedCount} existing pack(s)`);
  for (const rec of RECOMMENDED_CREDIT_PACKS) {
    const doc = {
      name: rec.name,
      code: rec.code,
      credits: rec.credits,
      bonusCredits: rec.bonusCredits || 0,
      price: rec.price,
      currency: rec.currency || 'USD',
      description: rec.description || '',
      displayOrder: rec.displayOrder,
      isActive: true,
      isPopular: !!rec.isPopular,
      features: rec.features || [],
    };
    const pack = new CreditPack(doc);
    await pack.save();
    console.log(`[pack] created ${rec.code}: ${pack.name} — ${pack.totalCredits} credits @ $${pack.price}`);
  }
}

async function main() {
  if (replacePacks && dryRun) {
    console.log('Note: --replace-packs only performs writes with --apply.\n');
  }
  console.log(dryRun ? 'DRY RUN (no writes). Use --apply to persist.\n' : 'APPLYING changes...\n');
  await mongoose.connect(uri);

  await syncCanonicalPlans();
  await syncLegacyAliasPlans();

  if (replacePacks) {
    await replaceAllPacksFromConfig();
  } else {
    await syncPacksByCode();
  }

  await mongoose.disconnect();
  console.log('\nFinished.');
  if (!replacePacks && !dryRun) {
    console.log('Tip: if the UI still shows old pack names, run: node scripts/applyCreditEconomics2026.js --apply --replace-packs');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
