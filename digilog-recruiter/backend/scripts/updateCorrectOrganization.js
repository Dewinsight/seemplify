const mongoose = require('mongoose');
const Organization = require('../models/Organization');
require('dotenv').config();

const updateCorrectOrganization = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    
    console.log('Connected to MongoDB');
    
    // Find the JOEVEES organization (uppercase) that the user is actually in
    const organization = await Organization.findById('6892ba86b08ad55ca4852186');
    
    if (!organization) {
      console.log('❌ Organization not found');
      process.exit(1);
    }
    
    console.log('✅ Found organization:', organization.name);
    console.log('📊 Current subscription:', {
      plan: organization.subscription?.plan,
      memberLimit: organization.subscription?.memberLimit,
      jobLimit: organization.subscription?.jobLimit,
      candidateLimit: organization.subscription?.candidateLimit
    });
    
    // Update to enterprise plan
    organization.subscription.plan = 'enterprise';
    organization.subscription.memberLimit = 1000;
    organization.subscription.jobLimit = 1000;
    organization.subscription.candidateLimit = 10000;
    organization.subscription.licenseStatus = 'active';
    
    // Add admin note
    if (!organization.subscription.adminNotes) {
      organization.subscription.adminNotes = [];
    }
    organization.subscription.adminNotes.push({
      note: 'Plan upgraded to enterprise (corrected organization)',
      addedBy: new mongoose.Types.ObjectId(), // Placeholder admin ID
      addedAt: new Date()
    });
    
    await organization.save();
    
    console.log('✅ Organization updated successfully!');
    console.log('📊 New subscription:', {
      plan: organization.subscription.plan,
      memberLimit: organization.subscription.memberLimit,
      jobLimit: organization.subscription.jobLimit,
      candidateLimit: organization.subscription.candidateLimit
    });
    
    process.exit(0);
  } catch (error) {
    console.error('Error updating organization:', error);
    process.exit(1);
  }
};

updateCorrectOrganization();
