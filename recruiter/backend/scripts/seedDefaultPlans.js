/**
 * Script to seed default subscription plans
 * Usage: node seedDefaultPlans.js
 * Force overwrite price/credits/limits from this file for default plan codes:
 *   node seedDefaultPlans.js --force-sync
 */

const mongoose = require('mongoose');
require('dotenv').config();

const forceSync =
  process.argv.includes('--force-sync') || process.env.FORCE_SYNC_DEFAULT_PLANS === '1';
const Plan = require('../models/Plan');
const {
  RECOMMENDED_MONTHLY_CREDITS_BY_PLAN_CODE,
  RECOMMENDED_CREDIT_COSTS,
  RECOMMENDED_PLAN_LIST_PRICES_USD,
} = require('../config/creditEconomics');

function planCredits(code) {
  return {
    totalCredits: RECOMMENDED_MONTHLY_CREDITS_BY_PLAN_CODE[code] ?? 80,
    creditCosts: { ...RECOMMENDED_CREDIT_COSTS },
    rolloverEnabled: false,
    rolloverPercentage: 0,
  };
}

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected...'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Default plans — list prices $99 → $4,999 / mo (see creditEconomics.js)
const defaultPlans = [
  {
    name: 'Free',
    code: 'free',
    price: RECOMMENDED_PLAN_LIST_PRICES_USD.free,
    billingCycle: 'monthly',
    credits: planCredits('free'),
    features: [
      { name: 'Basic Candidate Management' },
      { name: 'Limited Job Postings (5)' },
      { name: 'Manual CV Parsing' },
      { name: 'Up to 3 Team Members' }
    ],
    limits: {
      memberLimit: 3,
      storageLimit: 100,
      apiCallsLimit: 100
    },
    displayOrder: 1,
    isDefault: true,
    isPublished: true
  },
  {
    name: 'Starter',
    code: 'basic',
    price: RECOMMENDED_PLAN_LIST_PRICES_USD.basic,
    billingCycle: 'monthly',
    credits: planCredits('basic'),
    features: [
      { name: 'Enhanced Candidate Management' },
      { name: 'Up to 15 Job Postings' },
      { name: 'AI-powered CV Parsing' },
      { name: 'Up to 10 Team Members' },
      { name: 'Basic Interview Scheduling' }
    ],
    limits: {
      memberLimit: 10,
      storageLimit: 1024,
      apiCallsLimit: 500
    },
    displayOrder: 2,
    isDefault: true,
    isPublished: true
  },
  {
    name: 'Professional',
    code: 'pro',
    price: RECOMMENDED_PLAN_LIST_PRICES_USD.pro,
    billingCycle: 'monthly',
    credits: planCredits('pro'),
    features: [
      { name: 'Advanced Candidate Management' },
      { name: 'Up to 50 Job Postings' },
      { name: 'AI Candidate Matching' },
      { name: 'Up to 25 Team Members' },
      { name: 'Advanced Interview Scheduling' },
      { name: 'Interview AI Assistant' },
      { name: 'Custom Pipelines' }
    ],
    limits: {
      memberLimit: 25,
      storageLimit: 5120,
      apiCallsLimit: 2000
    },
    displayOrder: 3,
    isDefault: true,
    isPublished: true
  },
  {
    name: 'Business',
    code: 'business',
    price: RECOMMENDED_PLAN_LIST_PRICES_USD.business,
    billingCycle: 'monthly',
    credits: planCredits('business'),
    features: [
      { name: 'Everything in Professional' },
      { name: 'Higher monthly AI credits' },
      { name: 'Priority email support' },
      { name: 'Expanded storage' }
    ],
    limits: {
      memberLimit: 50,
      storageLimit: 20480,
      apiCallsLimit: 10000
    },
    displayOrder: 4,
    isDefault: true,
    isPublished: true
  },
  {
    name: 'Premium',
    code: 'premium',
    price: RECOMMENDED_PLAN_LIST_PRICES_USD.premium,
    billingCycle: 'monthly',
    credits: planCredits('premium'),
    features: [
      { name: 'Everything in Business' },
      { name: 'Large monthly AI credit pool' },
      { name: 'Priority support' },
      { name: 'Advanced analytics' }
    ],
    limits: {
      memberLimit: 150,
      storageLimit: 102400,
      apiCallsLimit: 50000
    },
    displayOrder: 5,
    isDefault: true,
    isPublished: true
  },
  {
    name: 'Enterprise',
    code: 'enterprise',
    price: RECOMMENDED_PLAN_LIST_PRICES_USD.enterprise,
    billingCycle: 'monthly',
    credits: planCredits('enterprise'),
    features: [
      { name: 'Unlimited Candidates' },
      { name: 'Unlimited Job Postings' },
      { name: 'Unlimited Team Members' },
      { name: 'Maximum monthly AI credits' },
      { name: 'Dedicated support' },
      { name: 'Custom Branding' },
      { name: 'API Access' },
      { name: 'Custom Integrations' },
      { name: 'Dedicated Account Manager' }
    ],
    limits: {
      memberLimit: 'unlimited',
      storageLimit: 'unlimited',
      apiCallsLimit: 'unlimited'
    },
    displayOrder: 6,
    isDefault: true,
    isPublished: true
  }
];

// Seed function
async function seedDefaultPlans() {
  try {
    // Check if we already have default plans
    const existingPlans = await Plan.find({ isDefault: true });
    
    if (existingPlans.length > 0) {
      console.log(`Found ${existingPlans.length} existing default plans.`);
      
      // Update existing plans to ensure they match our defaults
      for (const planConfig of defaultPlans) {
        const existingPlan = await Plan.findOne({ code: planConfig.code, isDefault: true });
        
        if (existingPlan) {
          console.log(`Updating existing default plan: ${planConfig.name}`);
          
          existingPlan.name = planConfig.name;
          existingPlan.features = planConfig.features;
          existingPlan.isPublished = true;
          existingPlan.isDefault = true;
          if (planConfig.credits) {
            existingPlan.credits = planConfig.credits;
          }

          if (forceSync) {
            existingPlan.price = planConfig.price;
            existingPlan.limits = planConfig.limits;
            console.log(`  (force-sync: price & limits overwritten from defaults)`);
          } else if (existingPlan.price === 0 || !existingPlan.limits) {
            existingPlan.price = planConfig.price;
            existingPlan.limits = planConfig.limits;
          }
          
          await existingPlan.save();
        } else {
          console.log(`Creating missing default plan: ${planConfig.name}`);
          await Plan.create(planConfig);
        }
      }
    } else {
      // No default plans found, create them all
      console.log('No default plans found. Creating all default plans...');
      await Plan.insertMany(defaultPlans);
    }
    
    console.log('Default plans seeded successfully!');
  } catch (error) {
    console.error('Error seeding default plans:', error);
  } finally {
    mongoose.connection.close();
  }
}

// Run the seed function
seedDefaultPlans();
