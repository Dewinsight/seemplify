const mongoose = require('mongoose');
const Currency = require('../models/Currency');
require('dotenv').config();

async function cleanBadCurrency() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // Delete the SLV currency with null organization
    const result = await Currency.deleteOne({ code: 'SLV', organization: null });
    
    if (result.deletedCount > 0) {
      console.log('✅ Deleted bad currency: SLV (with organization: null)');
    } else {
      console.log('ℹ️  No bad currency found to delete');
    }

    // Show remaining currencies
    const totalCount = await Currency.countDocuments({});
    const systemCount = await Currency.countDocuments({ isSystem: true });
    const orgCount = await Currency.countDocuments({ isSystem: false });

    console.log('\n=== CURRENCY COUNT AFTER CLEANUP ===');
    console.log(`Total: ${totalCount}`);
    console.log(`System: ${systemCount}`);
    console.log(`Organization: ${orgCount}`);

    await mongoose.disconnect();
    console.log('\n✅ Disconnected');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

cleanBadCurrency();

