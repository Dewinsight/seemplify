const mongoose = require('mongoose');
const Currency = require('../models/Currency');
require('dotenv').config();

async function checkCurrencies() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    const totalCount = await Currency.countDocuments({});
    const systemCount = await Currency.countDocuments({ isSystem: true });
    const orgCount = await Currency.countDocuments({ isSystem: false });

    console.log('=== CURRENCY DATABASE STATUS ===');
    console.log(`Total currencies: ${totalCount}`);
    console.log(`System currencies: ${systemCount}`);
    console.log(`Organization currencies: ${orgCount}\n`);

    // Get all currencies
    const allCurrencies = await Currency.find({})
      .select('code name symbol isSystem organization createdAt')
      .sort({ isSystem: -1, code: 1 });

    console.log('=== ALL CURRENCIES ===');
    allCurrencies.forEach(c => {
      const type = c.isSystem ? 'SYSTEM' : 'ORG';
      const orgId = c.organization ? c.organization.toString().substring(0, 8) : 'null';
      console.log(`[${type}] ${c.code} - ${c.symbol} ${c.name} (org: ${orgId})`);
    });

    await mongoose.disconnect();
    console.log('\n✅ Disconnected');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkCurrencies();

