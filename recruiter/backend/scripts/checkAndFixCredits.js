/**
 * Script to check and fix credits configuration
 * 
 * This script will:
 * 1. Check if all plans have credits configured
 * 2. Check if all organizations have credits initialized
 * 3. Fix any issues found
 * 
 * Usage: node backend/scripts/checkAndFixCredits.js
 */

const mongoose = require('mongoose');
const Organization = require('../models/Organization');
const Plan = require('../models/Plan');
const { RECOMMENDED_CREDIT_COSTS } = require('../config/creditEconomics');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('🔌 MongoDB Connected');
  checkAndFix();
}).catch(err => {
  console.error('❌ MongoDB Connection Error:', err);
  process.exit(1);
});

async function checkAndFix() {
  try {
    console.log('\n🔍 CREDITS SYSTEM DIAGNOSTIC\n');
    console.log('='.repeat(50));
    
    // Step 1: Check Plans
    console.log('\n📋 STEP 1: Checking Plans Configuration\n');
    
    const plans = await Plan.find({});
    console.log(`Found ${plans.length} plans`);
    
    let plansWithoutCredits = 0;
    let plansFixed = 0;
    
    for (const plan of plans) {
      console.log(`\nPlan: "${plan.name}" (${plan.code})`);
      
      if (!plan.credits || !plan.credits.totalCredits) {
        console.log(`  ❌ No credits configured`);
        plansWithoutCredits++;
        
        // Fix: Add default credits configuration
        plan.credits = {
          totalCredits: 430,
          creditCosts: { ...RECOMMENDED_CREDIT_COSTS },
          rolloverEnabled: false,
          rolloverPercentage: 0
        };
        
        await plan.save();
        console.log(`  ✅ Added credits configuration: 430 total credits (Basic-equivalent default)`);
        plansFixed++;
      } else {
        console.log(`  ✅ Credits configured: ${plan.credits.totalCredits} total credits`);
        console.log(`     Cost to create job: ${plan.credits.creditCosts?.createJob || 'NOT SET'} credits`);
      }
    }
    
    console.log(`\n📊 Plans Summary:`);
    console.log(`   Total plans: ${plans.length}`);
    console.log(`   Plans without credits: ${plansWithoutCredits}`);
    console.log(`   Plans fixed: ${plansFixed}`);
    
    // Step 2: Check Organizations
    console.log('\n\n🏢 STEP 2: Checking Organizations\n');
    
    const organizations = await Organization.find({});
    console.log(`Found ${organizations.length} organizations`);
    
    let orgsWithoutCredits = 0;
    let orgsFixed = 0;
    let orgsSkipped = 0;
    
    for (const org of organizations) {
      console.log(`\nOrganization: "${org.name}" (${org._id})`);
      console.log(`  Plan: ${org.subscription?.plan || 'NO PLAN'}`);
      
      // Check if has credits
      if (!org.subscription?.creditUsage || org.subscription.creditUsage.totalCredits === undefined) {
        console.log(`  ❌ No credits initialized`);
        orgsWithoutCredits++;
        
        // Get plan to initialize from
        const planCode = org.subscription?.plan;
        if (!planCode) {
          console.log(`  ⚠️ No plan assigned - skipping (assign a plan first)`);
          orgsSkipped++;
          continue;
        }
        
        const plan = await Plan.findOne({ code: planCode });
        if (!plan || !plan.credits) {
          console.log(`  ⚠️ Plan has no credits - skipping`);
          orgsSkipped++;
          continue;
        }
        
        // Initialize credits
        if (!org.subscription) {
          org.subscription = { plan: planCode };
        }
        
        org.subscription.creditUsage = {
          totalCredits: plan.credits.totalCredits,
          usedCredits: 0,
          remainingCredits: plan.credits.totalCredits,
          currentCycleStart: new Date(),
          currentCycleEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          transactions: [{
            action: 'cycleReset',
            credits: plan.credits.totalCredits,
            timestamp: new Date(),
            balanceAfter: plan.credits.totalCredits,
            metadata: { reason: 'Auto-initialization via checkAndFixCredits script' }
          }],
          rolloverCredits: 0,
          creditPurchases: [],
          lowCreditWarning: { enabled: true, threshold: 20 }
        };
        
        await org.save();
        console.log(`  ✅ Initialized with ${plan.credits.totalCredits} credits`);
        orgsFixed++;
      } else {
        console.log(`  ✅ Credits initialized:`);
        console.log(`     Total: ${org.subscription.creditUsage.totalCredits}`);
        console.log(`     Used: ${org.subscription.creditUsage.usedCredits}`);
        console.log(`     Remaining: ${org.subscription.creditUsage.remainingCredits}`);
        console.log(`     Transactions: ${org.subscription.creditUsage.transactions?.length || 0}`);
      }
    }
    
    console.log(`\n📊 Organizations Summary:`);
    console.log(`   Total organizations: ${organizations.length}`);
    console.log(`   Organizations without credits: ${orgsWithoutCredits}`);
    console.log(`   Organizations fixed: ${orgsFixed}`);
    console.log(`   Organizations skipped (no plan): ${orgsSkipped}`);
    
    // Step 3: Final Status
    console.log('\n\n✅ DIAGNOSTIC COMPLETE\n');
    console.log('='.repeat(50));
    
    if (plansFixed > 0 || orgsFixed > 0) {
      console.log(`\n🎉 Fixed ${plansFixed} plans and ${orgsFixed} organizations`);
      console.log(`   Credits system should now be working!`);
    } else if (orgsSkipped > 0) {
      console.log(`\n⚠️ ${orgsSkipped} organizations have no plan assigned`);
      console.log(`   Assign plans to these organizations via admin panel`);
    } else {
      console.log(`\n✅ All plans and organizations are properly configured!`);
    }
    
    console.log('\n📝 Next Steps:');
    console.log('   1. Try creating a job/candidate/interview');
    console.log('   2. Check Settings → Credits to see transaction');
    console.log('   3. Check backend logs for credit deduction messages');
    
    mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error during diagnostic:', error);
    mongoose.disconnect();
    process.exit(1);
  }
}
