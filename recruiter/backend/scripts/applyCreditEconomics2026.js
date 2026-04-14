/**
 * Apply RECOMMENDED_* from config/creditEconomics.js to MongoDB.
 *
 * Usage:
 *   node scripts/applyCreditEconomics2026.js --dry-run
 *   node scripts/applyCreditEconomics2026.js --apply
 *
 * --apply updates:
 *   - Plan: creditCosts, credits.totalCredits, price (for known plan codes only)
 *   - CreditPack: credits, bonusCredits, price, features (matched by code)
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
} = require('../config/creditEconomics');

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) {
  console.error('Set MONGODB_URI or MONGO_URI');
  process.exit(1);
}

const dryRun = !process.argv.includes('--apply');

async function syncPlans() {
  const codes = Object.keys(RECOMMENDED_MONTHLY_CREDITS_BY_PLAN_CODE);
  for (const code of codes) {
    const plan = await Plan.findOne({ code });
    if (!plan) {
      console.log(`[plan] skip missing code=${code}`);
      continue;
    }
    const next = {
      price: RECOMMENDED_PLAN_LIST_PRICES_USD[code],
      credits: {
        ...plan.credits,
        totalCredits: RECOMMENDED_MONTHLY_CREDITS_BY_PLAN_CODE[code],
        creditCosts: { ...RECOMMENDED_CREDIT_COSTS },
        rolloverEnabled: plan.credits?.rolloverEnabled ?? false,
        rolloverPercentage: plan.credits?.rolloverPercentage ?? 0,
      },
    };
    console.log(`[plan] ${code}: price ${plan.price} -> ${next.price}, credits ${plan.credits?.totalCredits} -> ${next.credits.totalCredits}`);
    if (!dryRun) {
      plan.price = next.price;
      plan.credits = next.credits;
      await plan.save();
    }
  }
}

async function syncPacks() {
  for (const rec of RECOMMENDED_CREDIT_PACKS) {
    const pack = await CreditPack.findOne({ code: rec.code });
    if (!pack) {
      console.log(`[pack] would create ${rec.code} (not implemented — use seedCreditPacks.js)`);
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

async function main() {
  console.log(dryRun ? 'DRY RUN (no writes). Use --apply to persist.\n' : 'APPLYING changes...\n');
  await mongoose.connect(uri);
  await syncPlans();
  await syncPacks();
  await mongoose.disconnect();
  console.log('\nFinished.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
