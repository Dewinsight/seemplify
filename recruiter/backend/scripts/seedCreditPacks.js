const mongoose = require('mongoose');
const CreditPack = require('../models/CreditPack');
const { RECOMMENDED_CREDIT_PACKS } = require('../config/creditEconomics');
require('dotenv').config();

const forceSync =
  process.argv.includes('--force-sync') || process.env.FORCE_SYNC_CREDIT_PACKS === '1';

const defaultCreditPacks = RECOMMENDED_CREDIT_PACKS.map((p) => ({
  name: p.name,
  code: p.code,
  credits: p.credits,
  bonusCredits: p.bonusCredits || 0,
  price: p.price,
  currency: p.currency || 'USD',
  description: p.description || '',
  displayOrder: p.displayOrder,
  isActive: true,
  isPopular: !!p.isPopular,
  features: p.features || []
}));

async function seedCreditPacks() {
  try {
    let created = 0;
    let preserved = 0;
    let updated = 0;

    for (const packData of defaultCreditPacks) {
      const existingPack = await CreditPack.findOne({ code: packData.code });

      if (!existingPack) {
        const pack = await CreditPack.create(packData);
        created += 1;
        console.log(`Created missing credit pack: ${pack.name} (${pack.code})`);
        continue;
      }

      if (!forceSync) {
        preserved += 1;
        console.log(`Preserved existing credit pack: ${existingPack.name} (${existingPack.code})`);
        continue;
      }

      Object.assign(existingPack, packData);
      await existingPack.save();
      updated += 1;
      console.log(`Force-synced credit pack: ${existingPack.name} (${existingPack.code})`);
    }

    console.log(`Recruiter credit packs seeded: ${created} created, ${preserved} preserved, ${updated} updated.`);
    return { created, preserved, updated, total: defaultCreditPacks.length };
  } catch (error) {
    console.error('Error seeding credit packs:', error);
    throw error;
  }
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI or MONGO_URI is required');
  await mongoose.connect(uri);
  console.log('MongoDB connected...');
  try {
    await seedCreditPacks();
  } finally {
    await mongoose.connection.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('Recruiter credit-pack seed failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { defaultCreditPacks, seedCreditPacks };
