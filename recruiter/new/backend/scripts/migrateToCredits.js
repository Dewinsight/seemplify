/**
 * Migration script to initialize credits for existing organizations
 * 
 * Usage:
 * node scripts/migrateToCredits.js
 */

const mongoose = require('mongoose');
const Organization = require('../models/Organization');
const Plan = require('../models/Plan');
const config = require('../config/db');

// Connect to MongoDB
mongoose.connect(config.mongoURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('🔌 MongoDB Connected');
  migrateOrganizations();
}).catch(err => {
  console.error('❌ MongoDB Connection Error:', err);
  process.exit(1);
});

/**
 * Convert organization's existing limits to credits
 */
async function migrateOrganizations() {
  try {
    console.log('🔄 Starting migration to credits system...');

    // Get all organizations
    const organizations = await Organization.find({}).populate('subscription.plan');
    console.log(`📊 Found ${organizations.length} organizations to migrate`);

    // Get all plans
    const plans = await Plan.find({});
    console.log(`📊 Found ${plans.length} plans`);

    // First, update plans with credit values if they don't have them
    for (const plan of plans) {
      if (!plan.credits || !plan.credits.totalCredits) {
        // Convert limits to credits
        const totalCredits = convertLimitsToCredits(plan.limits);
        
        plan.credits = {
          totalCredits,
          creditCosts: {
            createJob: 5,
            uploadCandidate: 3,
            scheduleInterview: 2,
            aiMatching: 10,
            generateQuestions: 5,
            aiAnalysis: 8,
            bulkUpload: 2,
            reEmbed: 1
          },
          rolloverEnabled: false,
          rolloverPercentage: 0
        };
        
        await plan.save();
        console.log(`✅ Updated plan "${plan.name}" with ${totalCredits} credits`);
      } else {
        console.log(`⏭️ Plan "${plan.name}" already has credits configuration`);
      }
    }
    
    // Then, initialize credits for each organization
    let updatedCount = 0;
    let skippedCount = 0;
    
    for (const org of organizations) {
      // Skip if already has credits
      if (org.subscription?.creditUsage?.totalCredits) {
        console.log(`⏭️ Organization ${org.name} already has credits initialized`);
        skippedCount++;
        continue;
      }
      
      try {
        // Get plan details
        const planCode = org.subscription?.plan;
        let totalCredits = 100; // Default
        
        if (planCode) {
          const plan = plans.find(p => p.code === planCode);
          if (plan?.credits?.totalCredits) {
            totalCredits = plan.credits.totalCredits;
          }
        }
        
        // Initialize credit usage
        if (!org.subscription) {
          org.subscription = {};
        }
        
        org.subscription.creditUsage = {
          totalCredits,
          usedCredits: 0,
          remainingCredits: totalCredits,
          currentCycleStart: new Date(),
          currentCycleEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
          transactions: [
            {
              action: 'cycleReset',
              credits: totalCredits,
              timestamp: new Date(),
              balanceAfter: totalCredits,
              metadata: { reason: 'Initial migration to credits system' }
            }
          ],
          rolloverCredits: 0,
          creditPurchases: [],
          lowCreditWarning: {
            enabled: true,
            threshold: 20
          }
        };
        
        await org.save();
        console.log(`✅ Initialized ${totalCredits} credits for organization "${org.name}"`);
        updatedCount++;
      } catch (orgError) {
        console.error(`❌ Error processing organization ${org._id}:`, orgError);
      }
    }
    
    console.log('\n🎉 Migration complete!');
    console.log(`📝 Summary:
- Total organizations: ${organizations.length}
- Organizations updated: ${updatedCount}
- Organizations skipped: ${skippedCount}
- Plans updated: ${plans.length}
    `);
    
    mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    mongoose.disconnect();
    process.exit(1);
  }
}

/**
 * Convert existing limits to a credit value
 * @param {Object} limits - Organization limits
 * @returns {Number} - Appropriate credit value
 */
function convertLimitsToCredits(limits) {
  // Base credit value - since job/candidate limits are removed,
  // we give fixed credits based on plan tier
  let baseCredits = 100;
  
  // Give generous credits for previously unlimited plans
  if (limits.memberLimit === 'unlimited' || limits.memberLimit > 100) {
    return 500;
  }
  
  // Mid-tier plans get 250 credits
  if (limits.memberLimit > 20) {
    return 250;
  }
  
  // Starter plans get base credits
  return baseCredits;
}
