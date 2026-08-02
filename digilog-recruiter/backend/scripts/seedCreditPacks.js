const mongoose = require('mongoose');
const CreditPack = require('../models/CreditPack');
const { RECOMMENDED_CREDIT_PACKS } = require('../config/creditEconomics');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/smarthr', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('✅ Connected to MongoDB');
}).catch(err => {
  console.error('❌ MongoDB connection error:', err);
  process.exit(1);
});

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
    console.log('🚀 Starting to seed credit packs...');
    
    console.log('🗑️ Removing existing credit packs...');
    await CreditPack.deleteMany({});
    console.log('✅ Existing credit packs removed');
    
    console.log('📝 Creating new credit packs...');
    
    for (const packData of defaultCreditPacks) {
      const pack = new CreditPack(packData);
      await pack.save();
      console.log(`✅ Created credit pack: ${pack.name} - $${pack.price} (${pack.totalCredits} total credits)`);
    }
    
    console.log('\n🎉 Successfully seeded credit packs!');
    console.log('\n📊 Packs match config/creditEconomics.js (research-backed ladder).');
    console.log('\n💡 Next: approve purchase requests in admin; orgs use packs from API.');
    
  } catch (error) {
    console.error('❌ Error seeding credit packs:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Database connection closed');
    process.exit(0);
  }
}

seedCreditPacks();
