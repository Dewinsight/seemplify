const mongoose = require('mongoose');
const Plan = require('../models/Plan');
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

// 2 ORGANIZATION Plans Configuration - Only organizations have plans now
const clearPlans = [
  // ORGANIZATION PLANS - Control Internal Organization Resource Limits
  {
    name: 'Starter',
    code: 'org-starter',
    price: 99,
    currency: 'USD',
    billingCycle: 'monthly',
    features: [
      { 
        name: 'Team Collaboration',
        description: 'Up to 10 team members with role-based access',
        included: true
      },
      { 
        name: 'Job Management',
        description: 'Manage up to 25 active job postings',
        included: true
      },
      { 
        name: 'Candidate Database',
        description: 'Track up to 500 candidates',
        included: true
      },
      { 
        name: 'Basic Analytics',
        description: 'Standard hiring reports and analytics',
        included: true
      },
      { 
        name: 'Email Support',
        description: 'Email support during business hours',
        included: true
      },
      { 
        name: 'File Storage',
        description: '5GB storage for documents and files',
        included: true
      }
    ],
    limits: {
      memberLimit: 10,               // 10 team members max
      storageLimit: 5120,            // 5GB storage (in MB)
      apiCallsLimit: 1000            // 1000 API calls per month
    },
    trialDays: 14,
    isPublished: true,
    displayOrder: 1,
    planType: 'organization',  // This is an organization plan
    isDefault: true,           // Default plan for organizations
    isCustom: false
  },
  {
    name: 'Enterprise',
    code: 'org-enterprise',
    price: 299,
    currency: 'USD',
    billingCycle: 'monthly',
    features: [
      { 
        name: 'Unlimited Team Members',
        description: 'No limit on team members and user roles',
        included: true
      },
      { 
        name: 'Unlimited Job Postings',
        description: 'Create unlimited job postings and manage hiring pipelines',
        included: true
      },
      { 
        name: 'Unlimited Candidates',
        description: 'Track unlimited candidates with full profiles',
        included: true
      },
      { 
        name: 'Advanced Analytics',
        description: 'Advanced reporting, insights, and predictive analytics',
        included: true
      },
      { 
        name: 'Priority Support',
        description: '24/7 priority support with dedicated account manager',
        included: true
      },
      { 
        name: 'Unlimited Storage',
        description: 'Unlimited file storage and document management',
        included: true
      },
      { 
        name: 'API Access',
        description: 'Full API access with unlimited calls',
        included: true
      },
      { 
        name: 'Custom Integrations',
        description: 'Custom integrations and white-label options',
        included: true
      }
    ],
    limits: {
      memberLimit: 'unlimited',      // Unlimited team members
      storageLimit: 'unlimited',     // Unlimited storage
      apiCallsLimit: 'unlimited'     // Unlimited API calls
    },
    trialDays: 30,
    isPublished: true,
    displayOrder: 2,
    planType: 'organization',  // This is an organization plan
    isDefault: false,
    isCustom: false
  }
];

async function seedClearPlans() {
  try {
    console.log('🚀 Starting to seed 2 ORGANIZATION plans only...');
    
    // Clear existing plans (optional - comment out to keep existing)
    console.log('🗑️ Removing existing plans...');
    await Plan.deleteMany({});
    console.log('✅ Existing plans removed');
    
    // Create new ORGANIZATION plans only
    console.log('📝 Creating new ORGANIZATION plans...');
    
    for (const planData of clearPlans) {
      // Check if plan already exists
      const existingPlan = await Plan.findOne({ code: planData.code });
      
      if (existingPlan) {
        console.log(`⚠️ Plan '${planData.name}' (${planData.code}) already exists, updating...`);
        await Plan.findOneAndUpdate({ code: planData.code }, planData, { new: true });
        console.log(`✅ Updated plan: ${planData.name}`);
      } else {
        const newPlan = new Plan(planData);
        await newPlan.save();
        console.log(`✅ Created plan: ${planData.name} - $${planData.price}/month`);
      }
    }
    
    console.log('\n🎉 Successfully seeded 2 ORGANIZATION plans!');
    console.log('\n📊 Plan Summary:');
    console.log('   👥 Users: Can create UNLIMITED organizations (no user plans)');
    console.log('\n   🏢 ORGANIZATION PLANS (Control Internal Resources):');
    console.log('   1. Starter - $99/month (10 members) - Credits manage jobs/candidates');
    console.log('   2. Enterprise - $299/month (unlimited members) - Credits manage jobs/candidates');
    console.log('\n💡 Next Steps:');
    console.log('   - Remove user plan references from frontend and admin');
    console.log('   - Update frontend to only show organization plans');
    console.log('   - Test organization plan management');
    
  } catch (error) {
    console.error('❌ Error seeding plans:', error);
  } finally {
    // Close MongoDB connection
    await mongoose.connection.close();
    console.log('\n🔌 Database connection closed');
    process.exit(0);
  }
}

// Run the seeding
seedClearPlans();
