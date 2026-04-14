/**
 * Compare MongoDB plans & credit packs to config/creditEconomics.js recommendations.
 * Usage: node scripts/auditCreditEconomics.js
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
  console.error('Set MONGODB_URI or MONGO_URI in recruiter/backend/.env');
  process.exit(1);
}

function diffCosts(current, recommended) {
  const keys = new Set([...Object.keys(current || {}), ...Object.keys(recommended)]);
  const rows = [];
  for (const k of keys) {
    const a = current?.[k];
    const b = recommended[k];
    if (a !== b) rows.push({ action: k, db: a, recommended: b });
  }
  return rows;
}

async function main() {
  await mongoose.connect(uri);
  console.log('=== Plans (published) ===\n');
  const plans = await Plan.find({ isPublished: true }).sort({ displayOrder: 1 });
  for (const p of plans) {
    const code = p.code;
    const recCredits = RECOMMENDED_MONTHLY_CREDITS_BY_PLAN_CODE[code];
    const recPrice = RECOMMENDED_PLAN_LIST_PRICES_USD[code];
    console.log(`${p.name} (${code})  price=$${p.price}  monthlyCredits=${p.credits?.totalCredits}`);
    if (recCredits != null) {
      const d = diffCosts(p.credits?.creditCosts, RECOMMENDED_CREDIT_COSTS);
      if (d.length) {
        console.log('  creditCosts vs recommended:', d);
      } else {
        console.log('  creditCosts: OK vs recommended');
      }
      if (p.credits?.totalCredits !== recCredits) {
        console.log(`  monthly credits: DB=${p.credits?.totalCredits} recommended=${recCredits}`);
      }
      if (recPrice != null && p.price !== recPrice) {
        console.log(`  list price: DB=${p.price} recommended=${recPrice}`);
      }
    } else {
      console.log('  (no fixed recommendation for this code — custom plan?)');
    }
    console.log('');
  }

  console.log('=== Credit packs (active) ===\n');
  const packs = await CreditPack.find({}).sort({ displayOrder: 1 });
  const byCode = new Map(RECOMMENDED_CREDIT_PACKS.map((x) => [x.code, x]));
  for (const pack of packs) {
    const rec = byCode.get(pack.code);
    console.log(`${pack.name} (${pack.code})  credits=${pack.credits} bonus=${pack.bonusCredits || 0} price=$${pack.price}`);
    if (rec) {
      const total = pack.credits + (pack.bonusCredits || 0);
      const recTotal = rec.credits + (rec.bonusCredits || 0);
      if (pack.price !== rec.price || total !== recTotal) {
        console.log(`  recommended: totalCredits=${recTotal} price=$${rec.price}`);
      }
    }
    console.log('');
  }

  await mongoose.disconnect();
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
