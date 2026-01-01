const mongoose = require('mongoose');
const CreditPack = require('../models/CreditPack');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/smarthr', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('✅ Connected to MongoDB');
}).catch(err => {
  console.error('❌ MongoDB connection error:', err);
  process.exit(1);
});

// Default credit packs configuration
const defaultCreditPacks = [
  {
    name: 'Starter Pack',
    code: 'starter-100',
    credits: 100,
    bonusCredits: 0,
    price: 49,
    currency: 'USD',
    description: 'Perfect for small teams getting started',
    displayOrder: 1,
    isActive: true,
    isPopular: false,
    features: [
      '100 credits',
      'Create ~20 job postings',
      'Process ~33 candidate applications',
      'Valid for 6 months'
    ]
  },
  {
    name: 'Professional Pack',
    code: 'pro-250',
    credits: 250,
    bonusCredits: 25,
    price: 99,
    currency: 'USD',
    description: 'Most popular choice for growing companies',
    displayOrder: 2,
    isActive: true,
    isPopular: true,
    features: [
      '250 credits + 25 bonus',
      '275 total credits',
      'Create ~55 job postings',
      'Process ~91 candidate applications',
      '10% bonus credits',
      'Valid for 12 months'
    ]
  },
  {
    name: 'Business Pack',
    code: 'business-500',
    credits: 500,
    bonusCredits: 75,
    price: 179,
    currency: 'USD',
    description: 'Great value for active recruiters',
    displayOrder: 3,
    isActive: true,
    isPopular: false,
    features: [
      '500 credits + 75 bonus',
      '575 total credits',
      'Create ~115 job postings',
      'Process ~191 candidate applications',
      '15% bonus credits',
      'Valid for 12 months',
      'Priority support'
    ]
  },
  {
    name: 'Enterprise Pack',
    code: 'enterprise-1000',
    credits: 1000,
    bonusCredits: 200,
    price: 299,
    currency: 'USD',
    description: 'Maximum value for high-volume hiring',
    displayOrder: 4,
    isActive: true,
    isPopular: false,
    features: [
      '1000 credits + 200 bonus',
      '1200 total credits',
      'Create ~240 job postings',
      'Process ~400 candidate applications',
      '20% bonus credits',
      'Valid for 12 months',
      'Priority support',
      'Dedicated account manager'
    ]
  },
  {
    name: 'Mega Pack',
    code: 'mega-2500',
    credits: 2500,
    bonusCredits: 625,
    price: 649,
    currency: 'USD',
    description: 'Ultimate pack for enterprise-scale operations',
    displayOrder: 5,
    isActive: true,
    isPopular: false,
    features: [
      '2500 credits + 625 bonus',
      '3125 total credits',
      'Create ~625 job postings',
      'Process ~1041 candidate applications',
      '25% bonus credits',
      'Valid for 12 months',
      'Priority support',
      'Dedicated account manager',
      'Custom integrations available'
    ]
  }
];

async function seedCreditPacks() {
  try {
    console.log('🚀 Starting to seed credit packs...');
    
    // Clear existing credit packs (optional - comment out to keep existing)
    console.log('🗑️ Removing existing credit packs...');
    await CreditPack.deleteMany({});
    console.log('✅ Existing credit packs removed');
    
    // Create new credit packs
    console.log('📝 Creating new credit packs...');
    
    for (const packData of defaultCreditPacks) {
      const pack = new CreditPack(packData);
      await pack.save();
      console.log(`✅ Created credit pack: ${pack.name} - $${pack.price} (${pack.totalCredits} total credits)`);
    }
    
    console.log('\n🎉 Successfully seeded credit packs!');
    console.log('\n📊 Credit Packs Summary:');
    console.log('   1. Starter Pack - $49 (100 credits)');
    console.log('   2. Professional Pack - $99 (275 total credits) - POPULAR');
    console.log('   3. Business Pack - $179 (575 total credits)');
    console.log('   4. Enterprise Pack - $299 (1200 total credits)');
    console.log('   5. Mega Pack - $649 (3125 total credits)');
    console.log('\n💡 Next Steps:');
    console.log('   - Credit packs are now available via API');
    console.log('   - Users can request credit purchases');
    console.log('   - Admins can approve/reject requests');
    
  } catch (error) {
    console.error('❌ Error seeding credit packs:', error);
  } finally {
    // Close MongoDB connection
    await mongoose.connection.close();
    console.log('\n🔌 Database connection closed');
    process.exit(0);
  }
}

// Run the seeding
seedCreditPacks();

