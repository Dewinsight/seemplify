const mongoose = require('mongoose');
const Currency = require('../models/Currency');
require('dotenv').config();

// System currencies that should always be available
const SYSTEM_CURRENCIES = [
  // Major Global Currencies
  { code: 'USD', symbol: '$', name: 'US Dollar', locale: 'en-US' },
  { code: 'EUR', symbol: '€', name: 'Euro', locale: 'de-DE' },
  { code: 'GBP', symbol: '£', name: 'British Pound', locale: 'en-GB' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen', locale: 'ja-JP' },
  { code: 'CNY', symbol: '¥', name: 'Chinese Yuan', locale: 'zh-CN' },
  
  // African Currencies (Expanded)
  { code: 'NGN', symbol: '₦', name: 'Nigerian Naira', locale: 'en-NG' },
  { code: 'ZAR', symbol: 'R', name: 'South African Rand', locale: 'en-ZA' },
  { code: 'KES', symbol: 'KSh', name: 'Kenyan Shilling', locale: 'en-KE' },
  { code: 'GHS', symbol: '₵', name: 'Ghanaian Cedi', locale: 'en-GH' },
  { code: 'EGP', symbol: '£', name: 'Egyptian Pound', locale: 'ar-EG' },
  { code: 'MAD', symbol: 'د.م.', name: 'Moroccan Dirham', locale: 'ar-MA' },
  { code: 'TND', symbol: 'د.ت', name: 'Tunisian Dinar', locale: 'ar-TN' },
  { code: 'ETB', symbol: 'Br', name: 'Ethiopian Birr', locale: 'am-ET' },
  { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', locale: 'en-UG' },
  { code: 'TZS', symbol: 'TSh', name: 'Tanzanian Shilling', locale: 'sw-TZ' },
  { code: 'XOF', symbol: 'CFA', name: 'West African CFA Franc', locale: 'fr-SN' },
  { code: 'XAF', symbol: 'FCFA', name: 'Central African CFA Franc', locale: 'fr-CM' },
  { code: 'BWP', symbol: 'P', name: 'Botswana Pula', locale: 'en-BW' },
  { code: 'ZMW', symbol: 'K', name: 'Zambian Kwacha', locale: 'en-ZM' },
  { code: 'MWK', symbol: 'MK', name: 'Malawian Kwacha', locale: 'en-MW' },
  
  // Other Regional Currencies
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar', locale: 'en-CA' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar', locale: 'en-AU' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee', locale: 'en-IN' },
  { code: 'BRL', symbol: 'R$', name: 'Brazilian Real', locale: 'pt-BR' },
  { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham', locale: 'ar-AE' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar', locale: 'en-SG' },
  { code: 'HKD', symbol: 'HK$', name: 'Hong Kong Dollar', locale: 'zh-HK' },
  { code: 'MXN', symbol: 'Mex$', name: 'Mexican Peso', locale: 'es-MX' }
];

async function seedCurrencies() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ MongoDB connected for currency seeding');

    let created = 0;
    let skipped = 0;

    for (const currencyData of SYSTEM_CURRENCIES) {
      // Check if currency already exists
      const existing = await Currency.findOne({
        code: currencyData.code,
        organization: null,
        isSystem: true
      });

      if (existing) {
        console.log(`⏭️  Skipping ${currencyData.code} - already exists`);
        skipped++;
        continue;
      }

      // Create system currency
      await Currency.create({
        ...currencyData,
        isSystem: true,
        organization: null, // System currencies belong to no organization
        createdBy: null
      });

      console.log(`✅ Created system currency: ${currencyData.code} (${currencyData.name})`);
      created++;
    }

    console.log('\n📊 Currency Seeding Summary:');
    console.log(`   ✅ Created: ${created}`);
    console.log(`   ⏭️  Skipped: ${skipped}`);
    console.log(`   📦 Total: ${SYSTEM_CURRENCIES.length}`);

    // Disconnect
    await mongoose.disconnect();
    console.log('\n✅ Database disconnected');
    process.exit(0);

  } catch (error) {
    console.error('❌ Error seeding currencies:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  seedCurrencies();
}

module.exports = seedCurrencies;
