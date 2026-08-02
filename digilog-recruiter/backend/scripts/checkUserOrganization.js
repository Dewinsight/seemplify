const mongoose = require('mongoose');
const User = require('../models/User');
const Organization = require('../models/Organization');
require('dotenv').config();

const checkUserOrganization = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    
    console.log('Connected to MongoDB');
    
    // Find user by email
    const user = await User.findOne({ 
      email: 'michael.egbo@gmail.com'
    }).populate('organizationMemberships.organization');
    
    if (!user) {
      console.log('❌ User michael.egbo@gmail.com not found');
      
      // Try alternative email
      const altUser = await User.findOne({ 
        email: 'michael.egbo@aiinnigeria.com'
      }).populate('organizationMemberships.organization');
      
      if (altUser) {
        console.log('✅ Found user with alternative email:', altUser.email);
        await displayUserOrganizations(altUser);
      } else {
        console.log('❌ No user found with either email');
      }
    } else {
      console.log('✅ User found:', user.email);
      await displayUserOrganizations(user);
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error checking user organization:', error);
    process.exit(1);
  }
};

const displayUserOrganizations = async (user) => {
  console.log('\n📊 User Organization Details:');
  console.log('👤 User:', user.email);
  console.log('🏢 Current Organization ID:', user.currentOrganization || 'none');
  console.log('📋 Organization Memberships:', user.organizationMemberships.length);
  
  if (user.organizationMemberships.length > 0) {
    for (let i = 0; i < user.organizationMemberships.length; i++) {
      const membership = user.organizationMemberships[i];
      console.log(`\n🏢 Organization ${i + 1}:`);
      console.log('  - ID:', membership.organization._id);
      console.log('  - Name:', membership.organization.name);
      console.log('  - User Role:', membership.role);
      console.log('  - Is Active:', membership.isActive);
      console.log('  - Plan:', membership.organization.subscription?.plan || 'undefined');
      console.log('  - Member Limit:', membership.organization.subscription?.memberLimit || 'undefined');
      console.log('  - Job Limit:', membership.organization.subscription?.jobLimit || 'undefined');
      console.log('  - Candidate Limit:', membership.organization.subscription?.candidateLimit || 'undefined');
      console.log('  - License Status:', membership.organization.subscription?.licenseStatus || 'undefined');
      
      if (membership.organization.subscription?.adminNotes?.length > 0) {
        console.log('  - Admin Notes:');
        membership.organization.subscription.adminNotes.forEach((note, idx) => {
          console.log(`    ${idx + 1}. ${note.note} (${new Date(note.addedAt).toLocaleString()})`);
        });
      }
    }
  } else {
    console.log('❌ User has no organization memberships');
  }
  
  // Also check which organization is set as current
  if (user.currentOrganization) {
    const currentOrg = await Organization.findById(user.currentOrganization);
    if (currentOrg) {
      console.log('\n🎯 Current Active Organization:');
      console.log('  - ID:', currentOrg._id);
      console.log('  - Name:', currentOrg.name);
      console.log('  - Plan:', currentOrg.subscription?.plan || 'undefined');
      console.log('  - Member Limit:', currentOrg.subscription?.memberLimit || 'undefined');
    }
  }
};

checkUserOrganization();
