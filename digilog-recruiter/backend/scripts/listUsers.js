const mongoose = require('mongoose');
const User = require('../models/User');
const Organization = require('../models/Organization');
require('dotenv').config();

const listUsers = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    
    console.log('Connected to MongoDB');
    
    // Find all users with michael in email or name
    const users = await User.find({
      $or: [
        { email: { $regex: 'michael', $options: 'i' } },
        { 'profile.firstName': { $regex: 'michael', $options: 'i' } },
        { 'profile.lastName': { $regex: 'egbo', $options: 'i' } }
      ]
    }, 'email profile.firstName profile.lastName organizationMemberships currentOrganization').populate('organizationMemberships.organization', 'name subscription.plan');
    
    console.log(`\n📋 Found ${users.length} users matching "michael" or "egbo":`);
    
    users.forEach((user, index) => {
      console.log(`\n👤 User ${index + 1}:`);
      console.log('  - Email:', user.email);
      console.log('  - Name:', `${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`.trim() || 'No name');
      console.log('  - Current Org ID:', user.currentOrganization || 'none');
      console.log('  - Organizations:', user.organizationMemberships.length);
      
      if (user.organizationMemberships.length > 0) {
        user.organizationMemberships.forEach((membership, orgIndex) => {
          if (membership.organization) {
            console.log(`    ${orgIndex + 1}. ${membership.organization.name} (${membership.role}) - Plan: ${membership.organization.subscription?.plan || 'undefined'}`);
          }
        });
      }
    });
    
    // Also list all users with any organization memberships
    console.log('\n📋 All users with organizations:');
    const allUsersWithOrgs = await User.find({
      'organizationMemberships.0': { $exists: true }
    }, 'email profile.firstName profile.lastName organizationMemberships').populate('organizationMemberships.organization', 'name subscription.plan').limit(10);
    
    allUsersWithOrgs.forEach((user, index) => {
      console.log(`\n👤 User ${index + 1}: ${user.email}`);
      user.organizationMemberships.forEach((membership, orgIndex) => {
        if (membership.organization) {
          console.log(`  - ${membership.organization.name} (${membership.role}) - Plan: ${membership.organization.subscription?.plan || 'undefined'}`);
        }
      });
    });
    
    process.exit(0);
  } catch (error) {
    console.error('Error listing users:', error);
    process.exit(1);
  }
};

listUsers();
