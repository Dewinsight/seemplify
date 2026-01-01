/**
 * Script to assign default plan to organizations without a plan
 * 
 * Usage: node backend/scripts/assignDefaultPlan.js
 */

const mongoose = require('mongoose');
const Organization = require('../models/Organization');
const Plan = require('../models/Plan');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('🔌 MongoDB Connected');
  assignDefaultPlans();
}).catch(err => {
  console.error('❌ MongoDB Connection Error:', err);
  process.exit(1);
});

async function assignDefaultPlans() {
  try {
    console.log('\n🔧 ASSIGNING DEFAULT PLANS\n');
    console.log('='.repeat(50));
    
    // Get the Free plan as default
    const freePlan = await Plan.findOne({ code: 'free' });
    
    if (!freePlan) {
      console.error('❌ Free plan not found! Please create it first.');
      mongoose.disconnect();
      process.exit(1);
    }
    
    console.log(`✅ Found Free plan: "${freePlan.name}"`);
    console.log(`   Total credits: ${freePlan.credits?.totalCredits || 'NOT SET'}`);
    
    // Get organizations without a plan
    const organizations = await Organization.find({
      $or: [
        { 'subscription.plan': { $exists: false } },
        { 'subscription.plan': null },
        { 'subscription.plan': '' }
      ]
    });
    
    console.log(`\nFound ${organizations.length} organizations without a plan\n`);
    
    let assigned = 0;
    
    for (const org of organizations) {
      console.log(`Organization: "${org.name}" (${org._id})`);
      
      // Assign Free plan
      if (!org.subscription) {
        org.subscription = {};
      }
      
      org.subscription.plan = 'free';
      
      // If no credits, initialize them
      if (!org.subscription.creditUsage || org.subscription.creditUsage.totalCredits === undefined) {
        org.subscription.creditUsage = {
          totalCredits: freePlan.credits.totalCredits,
          usedCredits: 0,
          remainingCredits: freePlan.credits.totalCredits,
          currentCycleStart: new Date(),
          currentCycleEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          transactions: [{
            action: 'cycleReset',
            credits: freePlan.credits.totalCredits,
            timestamp: new Date(),
            balanceAfter: freePlan.credits.totalCredits,
            metadata: { reason: 'Assigned Free plan and initialized credits' }
          }],
          rolloverCredits: 0,
          creditPurchases: [],
          lowCreditWarning: { enabled: true, threshold: 20 }
        };
      }
      
      await org.save();
      console.log(`  ✅ Assigned Free plan with ${freePlan.credits.totalCredits} credits`);
      assigned++;
    }
    
    console.log(`\n📊 Summary:`);
    console.log(`   Organizations processed: ${organizations.length}`);
    console.log(`   Plans assigned: ${assigned}`);
    
    console.log('\n✅ COMPLETE!');
    console.log('\nAll organizations now have a plan and credits.');
    console.log('Credits will be deducted when users perform actions.\n');
    
    mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error);
    mongoose.disconnect();
    process.exit(1);
  }
}
