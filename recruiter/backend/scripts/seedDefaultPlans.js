/**
 * Script to seed default subscription plans
 * Usage: node seedDefaultPlans.js
 */

const mongoose = require('mongoose');
require('dotenv').config();
const Plan = require('../models/Plan');

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected...'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Default plans configuration
const defaultPlans = [
  {
    name: 'Free',
    code: 'free',
    price: 0,
    billingCycle: 'monthly',
    features: [
      { name: 'Basic Candidate Management' },
      { name: 'Limited Job Postings (5)' },
      { name: 'Manual CV Parsing' },
      { name: 'Up to 3 Team Members' }
    ],
    limits: {
      memberLimit: 3,
      storageLimit: 100, // 100MB
      apiCallsLimit: 100
    },
    displayOrder: 1,
    isDefault: true,
    isPublished: true
  },
  {
    name: 'Basic',
    code: 'basic',
    price: 49,
    billingCycle: 'monthly',
    features: [
      { name: 'Enhanced Candidate Management' },
      { name: 'Up to 15 Job Postings' },
      { name: 'AI-powered CV Parsing' },
      { name: 'Up to 10 Team Members' },
      { name: 'Basic Interview Scheduling' }
    ],
    limits: {
      memberLimit: 10,
      storageLimit: 1024, // 1GB
      apiCallsLimit: 500
    },
    displayOrder: 2,
    isDefault: true,
    isPublished: true
  },
  {
    name: 'Professional',
    code: 'pro',
    price: 99,
    billingCycle: 'monthly',
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
      storageLimit: 5120, // 5GB
      apiCallsLimit: 2000
    },
    displayOrder: 3,
    isDefault: true,
    isPublished: true
  },
  {
    name: 'Enterprise',
    code: 'enterprise',
    price: 299,
    billingCycle: 'monthly',
    features: [
      { name: 'Unlimited Candidates' },
      { name: 'Unlimited Job Postings' },
      { name: 'Unlimited Team Members' },
      { name: 'Priority Support' },
      { name: 'Custom Branding' },
      { name: 'API Access' },
      { name: 'Advanced Analytics' },
      { name: 'Custom Integrations' },
      { name: 'Dedicated Account Manager' }
    ],
    limits: {
      memberLimit: 'unlimited',
      storageLimit: 'unlimited',
      apiCallsLimit: 'unlimited'
    },
    displayOrder: 4,
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
          
          // Update plan with latest default values but preserve custom modifications
          existingPlan.name = planConfig.name;
          existingPlan.features = planConfig.features;
          existingPlan.isPublished = true; // Always ensure default plans are published
          existingPlan.isDefault = true;
          
          // Only update price and limits if they haven't been customized
          if (existingPlan.price === 0 || !existingPlan.limits) {
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

