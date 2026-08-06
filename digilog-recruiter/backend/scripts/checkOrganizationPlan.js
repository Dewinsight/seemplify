const mongoose = require('mongoose');
const Organization = require('../models/Organization');
require('dotenv').config();

const checkOrganizationPlan = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    
    console.log('Connected to MongoDB');
    
    // Find organization by name (case insensitive)
    const organization = await Organization.findOne({ 
      name: { $regex: 'joevess', $options: 'i' } 
    });
    
    if (!organization) {
      console.log('❌ Organization "joevess" not found');
      
      // List all organizations to help identify the correct name
      const allOrgs = await Organization.find({}, 'name subscription.plan').limit(10);
      console.log('📋 Available organizations:');
      allOrgs.forEach(org => {
        console.log(`  - ${org.name} (Plan: ${org.subscription?.plan || 'undefined'})`);
      });
    } else {
      console.log('✅ Organization found:', organization.name);
      console.log('📊 Subscription details:', {
        plan: organization.subscription?.plan || 'undefined',
        memberLimit: organization.subscription?.memberLimit || 'undefined',
        jobLimit: organization.subscription?.jobLimit || 'undefined',
        candidateLimit: organization.subscription?.candidateLimit || 'undefined',
        licenseStatus: organization.subscription?.licenseStatus || 'undefined',
        licenseKey: organization.subscription?.licenseKey || 'undefined'
      });
      console.log('📝 Admin notes:', organization.subscription?.adminNotes || []);
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error checking organization plan:', error);
    process.exit(1);
  }
};

checkOrganizationPlan();
